import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Chess, type PieceSymbol, type Square } from 'chess.js';
import { Chessboard, defaultPieces } from 'react-chessboard';
import type { ChessColor, ChessMove, ChessView, RoomView } from '@vg/shared';
import { api, playerId } from '../socket';
import { useI18n, type Strings } from '../i18n';
import { Avatar } from '../components/Avatar';
import { toast } from '../components/Toaster';
import { startGame } from '../components/roomActions';
import { FlagIcon, FrownIcon, HandshakeIcon, PlayIcon, TrophyIcon } from '../components/icons';

interface Props {
  room: RoomView;
  view: ChessView;
}

const START_COUNT: Record<Exclude<PieceSymbol, 'k'>, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const PIECE_VALUE: Record<Exclude<PieceSymbol, 'k'>, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const CAPTURE_ORDER = ['q', 'r', 'b', 'n', 'p'] as const;

// Pieces each side has taken, derived from what is missing on the board.
function capturedPieces(chess: Chess) {
  const onBoard = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const row of chess.board()) {
    for (const sq of row) if (sq && sq.type !== 'k') onBoard[sq.color][sq.type]++;
  }
  const takenFrom = (color: ChessColor) =>
    CAPTURE_ORDER.flatMap((type) => Array(Math.max(0, START_COUNT[type] - onBoard[color][type])).fill(type) as PieceSymbol[]);
  const material = (color: ChessColor) =>
    CAPTURE_ORDER.reduce((sum, type) => sum + onBoard[color][type] * PIECE_VALUE[type], 0);
  const diff = material('w') - material('b');
  return {
    // White's trophies are black pieces and vice versa.
    w: { pieces: takenFrom('b'), advantage: Math.max(0, diff) },
    b: { pieces: takenFrom('w'), advantage: Math.max(0, -diff) },
  };
}

export function ChessGame({ room, view }: Props) {
  const { t } = useI18n();
  const myColor: ChessColor | null = view.white === playerId ? 'w' : view.black === playerId ? 'b' : null;
  const topColor: ChessColor = myColor === 'b' ? 'w' : 'b';
  const bottomColor: ChessColor = topColor === 'w' ? 'b' : 'w';
  const myTurn = myColor === view.turn && !view.result;
  const isHost = room.hostId === playerId;
  const playerOf = (color: ChessColor) => room.players.find((p) => p.id === (color === 'w' ? view.white : view.black));
  const opponent = playerOf(myColor === 'w' ? 'b' : 'w');

  // Show our move immediately; the server confirms it. If rejected, snap back.
  const [optimisticFen, setOptimisticFen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Square | null>(null);
  const [showResult, setShowResult] = useState(true);

  useEffect(() => {
    setOptimisticFen(null);
    setSelected(null);
  }, [view.fen]);

  useEffect(() => {
    setShowResult(true);
  }, [view.result]);

  const chess = useMemo(() => new Chess(view.fen), [view.fen]);
  const captured = useMemo(() => capturedPieces(chess), [chess]);

  const movesRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    movesRef.current?.scrollTo({ top: movesRef.current.scrollHeight, behavior: 'smooth' });
  }, [view.history.length]);

  async function tryMove(from: Square, to: Square): Promise<boolean> {
    if (!myTurn) return false;
    const local = new Chess(view.fen);
    try {
      // Always promote to a queen to keep things simple.
      local.move({ from, to, promotion: 'q' });
    } catch {
      return false;
    }
    setOptimisticFen(local.fen());
    setSelected(null);
    const move: ChessMove = { type: 'move', from, to, promotion: 'q' };
    const r = await api.move(move);
    if (!r.ok) {
      setOptimisticFen(null);
      toast(t.errors[r.error]);
    }
    return true;
  }

  function onSquareClick(square: Square) {
    if (!myTurn) return;
    const piece = chess.get(square);
    if (piece && piece.color === myColor) {
      setSelected(square === selected ? null : square);
      return;
    }
    if (selected) void tryMove(selected, square);
  }

  async function resign() {
    if (!confirm(t.chess.confirmResign)) return;
    const r = await api.move({ type: 'resign' } satisfies ChessMove);
    if (!r.ok) toast(t.errors[r.error]);
  }

  const squareStyles: Record<string, CSSProperties> = {};
  if (view.lastMove) {
    squareStyles[view.lastMove.from] = { background: 'var(--board-last)' };
    squareStyles[view.lastMove.to] = { background: 'var(--board-last)' };
  }
  if (view.inCheck && !optimisticFen) {
    const king = chess.findPiece({ type: 'k', color: view.turn })[0];
    if (king) squareStyles[king] = { background: 'var(--board-check)' };
  }
  if (selected) {
    squareStyles[selected] = { background: 'var(--board-selected)' };
    for (const m of chess.moves({ square: selected, verbose: true })) {
      squareStyles[m.to] = {
        background: m.captured
          ? 'radial-gradient(circle, transparent 56%, var(--board-hint) 58%)'
          : 'radial-gradient(circle, var(--board-hint) 20%, transparent 22%)',
        cursor: 'pointer',
      };
    }
  }

  let turnText: string;
  if (!myColor) turnText = view.turn === 'w' ? t.chess.whiteToMove : t.chess.blackToMove;
  else turnText = myTurn ? t.chess.yourTurn : t.chess.turnOf(opponent?.name ?? t.chess.opponent);

  const movePairs: [string, string | undefined][] = [];
  for (let i = 0; i < view.history.length; i += 2) {
    movePairs.push([view.history[i], view.history[i + 1]]);
  }

  const playerBar = (color: ChessColor) => {
    const p = playerOf(color);
    const active = view.turn === color && !view.result;
    const cap = captured[color];
    const capturedColor = color === 'w' ? 'b' : 'w';
    return (
      <div className={`player-bar ${active ? 'active' : ''}`}>
        <Avatar id={p?.id ?? color} name={p?.name ?? '?'} size={40} online={p?.connected} />
        <div className="player-bar-info">
          <span className="player-bar-name">
            {p?.name ?? '…'}
            {p?.id === playerId && <span className="tag">{t.room.you}</span>}
          </span>
          <span className="captured">
            {cap.pieces.map((type, i) => (
              <span key={i} className="captured-piece">
                {defaultPieces[`${capturedColor}${type.toUpperCase()}`]?.({ svgStyle: { width: 18, height: 18 } })}
              </span>
            ))}
            {cap.advantage > 0 && <span className="advantage">+{cap.advantage}</span>}
          </span>
        </div>
        <span className={`color-chip ${color}`} />
      </div>
    );
  };

  return (
    <div className="chess-layout">
      <div className="board-col">
        {playerBar(topColor)}
        <div className="board-frame">
          <Chessboard
            options={{
              id: 'chess',
              position: optimisticFen ?? view.fen,
              boardOrientation: myColor === 'b' ? 'black' : 'white',
              squareStyles,
              allowDrawingArrows: false,
              animationDurationInMs: 220,
              darkSquareStyle: { backgroundColor: 'var(--board-dark)' },
              lightSquareStyle: { backgroundColor: 'var(--board-light)' },
              darkSquareNotationStyle: { color: 'var(--board-light)', fontWeight: 600 },
              lightSquareNotationStyle: { color: 'var(--board-dark)', fontWeight: 600 },
              canDragPiece: ({ piece }) => myTurn && piece.pieceType[0] === myColor,
              onPieceDrop: ({ sourceSquare, targetSquare }) => {
                if (!targetSquare || !myTurn) return false;
                const legal = chess
                  .moves({ square: sourceSquare as Square, verbose: true })
                  .some((m) => m.to === targetSquare);
                if (legal) void tryMove(sourceSquare as Square, targetSquare as Square);
                return legal;
              },
              onSquareClick: ({ square }) => onSquareClick(square as Square),
            }}
          />
          {view.result && showResult && (
            <ResultOverlay view={view} room={room} isHost={isHost} onClose={() => setShowResult(false)} />
          )}
        </div>
        {playerBar(bottomColor)}
      </div>

      <aside className="chess-side">
        {view.result ? (
          <div className="turn-card over">
            <span className="turn-title">{resultHeadline(t, view)}</span>
            <span className="turn-sub">{resultReason(t, view)}</span>
          </div>
        ) : (
          <div className={`turn-card ${myTurn ? 'mine' : ''}`}>
            <span className="turn-title">{turnText}</span>
            {view.inCheck && <span className="check-badge">{t.chess.check}</span>}
          </div>
        )}

        <div className="card moves-card">
          <h3>{t.chess.moves}</h3>
          {movePairs.length === 0 ? (
            <p className="muted">{t.chess.noMoves}</p>
          ) : (
            <ol className="move-list" ref={movesRef}>
              {movePairs.map(([w, b], i) => (
                <li key={i}>
                  <span className="move-no">{i + 1}.</span>
                  <span className="move">{w}</span>
                  <span className="move">{b ?? ''}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        {myColor && !view.result && (
          <button className="btn btn-ghost danger" onClick={resign}>
            <FlagIcon /> {t.chess.resign}
          </button>
        )}
        {view.result &&
          (isHost ? (
            <button className="btn btn-primary btn-lg" onClick={() => startGame(t)}>
              <PlayIcon /> {t.room.playAgain}
            </button>
          ) : (
            <p className="muted center">{t.room.waitingForHost}</p>
          ))}
      </aside>
    </div>
  );
}

function resultHeadline(t: Strings, view: ChessView): string {
  const winner = view.result?.winner;
  if (!winner) return t.chess.resultDraw;
  return winner === playerId ? t.chess.resultWin : t.chess.resultLose;
}

function resultReason(t: Strings, view: ChessView): string {
  const result = view.result!;
  const lost = result.winner && result.winner !== playerId;
  return lost && result.reason === 'resign' ? t.chess.youResigned : t.chess.endReasons[result.reason];
}

interface OverlayProps {
  view: ChessView;
  room: RoomView;
  isHost: boolean;
  onClose: () => void;
}

function ResultOverlay({ view, room, isHost, onClose }: OverlayProps) {
  const { t } = useI18n();
  const winner = view.result?.winner;
  const kind = !winner ? 'draw' : winner === playerId ? 'win' : 'lose';
  const winnerName = room.players.find((p) => p.id === winner)?.name;
  const Icon = kind === 'win' ? TrophyIcon : kind === 'lose' ? FrownIcon : HandshakeIcon;

  return (
    <div className="result-overlay">
      <div className={`result-card ${kind}`}>
        {kind === 'win' && (
          <div className="confetti" aria-hidden="true">
            {Array.from({ length: 18 }, (_, i) => (
              <span key={i} style={{ '--i': i } as CSSProperties} />
            ))}
          </div>
        )}
        <span className="result-icon">
          <Icon />
        </span>
        <h2>{resultHeadline(t, view)}</h2>
        <p>
          {resultReason(t, view)}
          {kind === 'lose' && winnerName ? ` · ${t.chess.playerWins(winnerName)}` : ''}
        </p>
        <div className="result-actions">
          {isHost ? (
            <button className="btn btn-primary" onClick={() => startGame(t)}>
              <PlayIcon /> {t.room.playAgain}
            </button>
          ) : (
            <span className="muted">{t.room.waitingForHost}</span>
          )}
          <button className="btn btn-ghost" onClick={onClose}>
            {t.chess.reviewBoard}
          </button>
        </div>
      </div>
    </div>
  );
}
