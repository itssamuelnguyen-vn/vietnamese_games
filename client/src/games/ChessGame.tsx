import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Chess, type Move, type PieceSymbol, type Square } from 'chess.js';
import { Chessboard, defaultPieces } from 'react-chessboard';
import type { ChessColor, ChessMove, ChessView, RoomView } from '@vg/shared';
import { api } from '../socket';
import { useI18n, type Strings } from '../i18n';
import { toast } from '../components/Toaster';
import { CopyIcon, DownloadIcon } from '../components/icons';
import { findOpening } from './chessOpenings';
import { DuelScreen, type BoardRenderProps } from './duel/DuelScreen';

interface Props {
  room: RoomView;
  view: ChessView;
  onLeave: () => void;
}

const PIECE_VALUE: Record<Exclude<PieceSymbol, 'k'>, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const CAPTURE_ORDER = ['q', 'r', 'b', 'n', 'p'] as const;

type Promotion = 'q' | 'r' | 'b' | 'n';
type SquarePair = { from: Square; to: Square };

const other = (c: ChessColor): ChessColor => (c === 'w' ? 'b' : 'w');
const pad = (n: number) => String(n).padStart(2, '0');

// Pieces each side has taken (from the moves, so a promoted pawn doesn't count as captured), and
// the material lead from what's on the board.
function capturedPieces(chess: Chess, played: Move[]) {
  const onBoard = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const row of chess.board()) {
    for (const sq of row) if (sq && sq.type !== 'k') onBoard[sq.color][sq.type]++;
  }
  const takenFrom = (color: ChessColor) =>
    CAPTURE_ORDER.flatMap((type) => played.filter((m) => m.color !== color && m.captured === type).map(() => type));
  const material = (color: ChessColor) =>
    CAPTURE_ORDER.reduce((sum, type) => sum + onBoard[color][type] * PIECE_VALUE[type], 0);
  const diff = material('w') - material('b');
  return {
    // White's trophies are black pieces and vice versa.
    w: { pieces: takenFrom('b'), advantage: Math.max(0, diff) },
    b: { pieces: takenFrom('w'), advantage: Math.max(0, -diff) },
  };
}

// Every position of the game so far, so any earlier move can be reviewed.
function replay(history: string[]) {
  const chess = new Chess();
  const fens = [chess.fen()];
  const moves: Move[] = [];
  for (const san of history) {
    moves.push(chess.move(san));
    fens.push(chess.fen());
  }
  return { fens, moves };
}

function describeMove(t: Strings, who: string, move: Move, prevWasCheck: boolean): string {
  const P = t.chess.pieces;
  const d = t.chess.describe;
  let text: string;
  if (move.isKingsideCastle()) text = d.castleKing(who);
  else if (move.isQueensideCastle()) text = d.castleQueen(who);
  else if (move.promotion) text = d.promote(who, P[move.promotion]);
  else if (prevWasCheck && move.piece === 'k') text = d.escape(who, move.to);
  else if (move.captured) text = d.capture(who, P[move.piece], P[move.captured], move.to);
  else if (prevWasCheck) text = d.block(who, P[move.piece], move.to);
  else text = d.move(who, P[move.piece], move.to);
  return move.san.endsWith('+') ? text + d.check : text;
}

export function ChessGame({ room, view, onLeave }: Props) {
  const { t } = useI18n();
  const playerId = room.you;
  const myColor: ChessColor | null = view.white === playerId ? 'w' : view.black === playerId ? 'b' : null;
  const myTurn = myColor === view.turn && !view.result;
  const names: Record<ChessColor, string | undefined> = {
    w: room.players.find((p) => p.id === view.white)?.name,
    b: room.players.find((p) => p.id === view.black)?.name,
  };

  // Show our move immediately; the server confirms it. If rejected, snap back.
  const [optimisticFen, setOptimisticFen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Square | null>(null);
  // A move queued while it's the opponent's turn; played as soon as it becomes legal.
  const [premove, setPremove] = useState<SquarePair | null>(null);
  // A pawn move waiting for the player to pick the promotion piece.
  const [promotion, setPromotion] = useState<SquarePair | null>(null);

  // Also on a result: a move that arrived after the flag fell ends the game without changing the position.
  useEffect(() => {
    setOptimisticFen(null);
    setSelected(null);
  }, [view.fen, !!view.result]);

  const { fens, moves } = useMemo(() => replay(view.history), [view.fen]);
  const live = useMemo(() => new Chess(view.fen), [view.fen]);
  const opening = useMemo(() => findOpening(view.history), [view.fen]);

  async function send(move: ChessMove) {
    const r = await api.move(move);
    if (!r.ok) toast(t.errors[r.error]);
    return r.ok;
  }

  async function tryMove(from: Square, to: Square, promote?: Promotion) {
    const candidates = live.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (candidates.length === 0) return;
    if (!promote && candidates.some((m) => m.promotion)) {
      setSelected(null);
      setPromotion({ from, to });
      return;
    }
    const local = new Chess(view.fen);
    local.move({ from, to, promotion: promote ?? 'q' });
    setOptimisticFen(local.fen());
    setSelected(null);
    setPromotion(null);
    if (!(await send({ type: 'move', from, to, promotion: promote ?? 'q' }))) setOptimisticFen(null);
  }

  // Fire a queued premove once it's our turn, if it's legal in the new position.
  useEffect(() => {
    if (!premove) return;
    if (view.result) return setPremove(null);
    if (!myTurn) return;
    const queued = premove;
    setPremove(null);
    if (live.moves({ square: queued.from, verbose: true }).some((m) => m.to === queued.to)) {
      void tryMove(queued.from, queued.to, 'q');
    }
  }, [view.fen]);

  function downloadPgn() {
    const chess = new Chess();
    for (const san of view.history) chess.move(san);
    const result =
      !view.result || view.result.reason === 'aborted' ? '*' : !view.result.winner ? '1/2-1/2' : view.result.winner === view.white ? '1-0' : '0-1';
    const d = new Date();
    chess.setHeader('Event', t.appName);
    chess.setHeader('Site', location.origin);
    chess.setHeader('Date', `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`);
    chess.setHeader('White', names.w ?? t.chess.white);
    chess.setHeader('Black', names.b ?? t.chess.black);
    chess.setHeader('Result', result);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([`${chess.pgn()}\n`], { type: 'application/x-chess-pgn' }));
    link.download = `chess-${room.code}.pgn`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function copyFen(fen: string) {
    try {
      await navigator.clipboard.writeText(fen);
      toast(t.chess.fenCopied);
    } catch {
      prompt(t.chess.copyFen, fen);
    }
  }

  const last = moves.at(-1);
  const lastMoveText = last
    ? describeMove(
        t,
        (last.color === 'w' ? view.white : view.black) === playerId ? t.room.you : (names[last.color] ?? t.chess.opponent),
        last,
        moves.at(-2)?.san.endsWith('+') ?? false,
      )
    : null;

  function renderBoard({ bottom, ply, reviewing, canMove, canTouch }: BoardRenderProps) {
    const shownFen = reviewing ? fens[ply] : (optimisticFen ?? view.fen);
    const shown = new Chess(shownFen);
    const shownLastMove = ply > 0 ? moves[ply - 1] : null;

    function onSquareClick(square: Square) {
      if (!canTouch) return;
      if (premove) {
        setPremove(null);
        setSelected(null);
        return;
      }
      const piece = live.get(square);
      if (piece && piece.color === myColor) {
        setSelected(square === selected ? null : square);
        return;
      }
      if (!selected) return;
      if (canMove) void tryMove(selected, square);
      else {
        setPremove({ from: selected, to: square });
        setSelected(null);
      }
    }

    const squareStyles: Record<string, CSSProperties> = {};
    if (shownLastMove) {
      squareStyles[shownLastMove.from] = { background: 'var(--board-last)' };
      squareStyles[shownLastMove.to] = { background: 'var(--board-last)' };
    }
    if (shown.inCheck() && !optimisticFen) {
      const king = shown.findPiece({ type: 'k', color: shown.turn() })[0];
      if (king) squareStyles[king] = { background: 'var(--board-check)' };
    }
    if (premove) {
      squareStyles[premove.from] = { background: 'var(--board-premove)' };
      squareStyles[premove.to] = { background: 'var(--board-premove)' };
    }
    if (selected) squareStyles[selected] = { background: canMove ? 'var(--board-selected)' : 'var(--board-premove)' };
    if (selected && canMove) {
      for (const m of live.moves({ square: selected, verbose: true })) {
        squareStyles[m.to] = {
          background: m.captured
            ? 'radial-gradient(circle, transparent 56%, var(--board-hint) 58%)'
            : 'radial-gradient(circle, var(--board-hint) 20%, transparent 24%)',
          cursor: 'pointer',
        };
      }
    }

    return (
      <>
        <Chessboard
          options={{
            id: 'chess',
            position: shownFen,
            boardOrientation: bottom === 'b' ? 'black' : 'white',
            squareStyles,
            allowDrawingArrows: false,
            allowDragging: canTouch,
            animationDurationInMs: 220,
            darkSquareStyle: { backgroundColor: 'var(--board-dark)' },
            lightSquareStyle: { backgroundColor: 'var(--board-light)' },
            darkSquareNotationStyle: { color: 'var(--board-light)', fontWeight: 600 },
            lightSquareNotationStyle: { color: 'var(--board-dark)', fontWeight: 600 },
            canDragPiece: ({ piece }) => canTouch && piece.pieceType[0] === myColor,
            onPieceDrop: ({ sourceSquare, targetSquare }) => {
              if (!targetSquare || !canTouch || sourceSquare === targetSquare) return false;
              if (!canMove) {
                setPremove({ from: sourceSquare as Square, to: targetSquare as Square });
                return false;
              }
              const legal = live
                .moves({ square: sourceSquare as Square, verbose: true })
                .some((m) => m.to === targetSquare);
              if (legal) void tryMove(sourceSquare as Square, targetSquare as Square);
              return legal;
            },
            onSquareClick: ({ square }) => onSquareClick(square as Square),
          }}
        />
        {promotion && myColor && (
          <div className="promo-overlay" onClick={() => setPromotion(null)}>
            <div className="promo-card" onClick={(e) => e.stopPropagation()}>
              <p className="field-label">{t.chess.promoteTo}</p>
              <div className="promo-options">
                {(['q', 'r', 'b', 'n'] as const).map((p) => (
                  <button key={p} onClick={() => tryMove(promotion.from, promotion.to, p)} aria-label={t.chess.pieces[p]} title={t.chess.pieces[p]}>
                    {defaultPieces[`${myColor}${p.toUpperCase()}`]?.({ svgStyle: { width: 52, height: 52 } })}
                  </button>
                ))}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => setPromotion(null)}>
                {t.chess.cancel}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  function playerExtra(side: string, ply: number) {
    const color = side as ChessColor;
    const cap = capturedPieces(new Chess(fens[Math.min(ply, fens.length - 1)]), moves.slice(0, ply))[color];
    return (
      <>
        <span className="color-piece">{defaultPieces[`${color}P`]?.({ svgStyle: { width: 16, height: 16 } })}</span>
        <span className="muted small">{cap.advantage > 0 ? `+${cap.advantage}` : t.chess.balanced}</span>
        <span className="captured">
          {cap.pieces.map((type, i) => (
            <span key={i} className="captured-piece">
              {defaultPieces[`${other(color)}${type.toUpperCase()}`]?.({ svgStyle: { width: 16, height: 16 } })}
            </span>
          ))}
        </span>
      </>
    );
  }

  return (
    <DuelScreen
      room={room}
      view={view}
      sides={['w', 'b']}
      playerIds={{ w: view.white, b: view.black }}
      moveLabels={view.history}
      sideName={(side) => (side === 'w' ? t.chess.white : t.chess.black)}
      sideToMove={(side) => (side === 'w' ? t.chess.whiteToMove : t.chess.blackToMove)}
      endReason={(reason) => t.chess.endReasons[reason as keyof Strings['chess']['endReasons']]}
      gameStarted={t.chess.gameStarted}
      noMoves={t.chess.noMoves}
      lastMoveText={lastMoveText}
      extraStatus={premove ? [t.chess.premove(premove.from, premove.to)] : []}
      soundForPly={(ply) => (/[+#]/.test(moves[ply]?.san ?? '') ? 'check' : moves[ply]?.captured ? 'capture' : 'move')}
      renderBoard={renderBoard}
      playerExtra={playerExtra}
      movesTools={
        <>
          {opening && <span className="muted small opening">{t.chess.openings[opening]}</span>}
          {view.history.length > 0 && (
            <>
              <button className="tool-btn" onClick={() => copyFen(view.fen)} aria-label={t.chess.copyFen} title={t.chess.copyFen}>
                <CopyIcon />
              </button>
              <button className="tool-btn" onClick={downloadPgn} aria-label={t.chess.downloadPgn} title={t.chess.downloadPgn}>
                <DownloadIcon />
              </button>
            </>
          )}
        </>
      }
      onLeave={onLeave}
      send={(action) => send(action)}
    />
  );
}
