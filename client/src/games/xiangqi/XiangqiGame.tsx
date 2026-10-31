import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { START_FEN, Xiangqi, squareName, type RoomView, type XMove, type XPieceType, type XiangqiMove, type XiangqiView, type XSide } from '@vg/shared';
import { api } from '../../socket';
import { useI18n, type Strings } from '../../i18n';
import { toast } from '../../components/Toaster';
import { CopyIcon, DownloadIcon } from '../../components/icons';
import { DuelScreen, type BoardRenderProps } from '../duel/DuelScreen';
import { replayXiangqi } from './notation';
import { findXiangqiOpening } from './openings';
import { GLYPHS, XiangqiBoard, type BoardPiece, type PieceFaces } from './XiangqiBoard';
import { loadSetting, saveSetting } from '../../settings';

interface Props {
  room: RoomView;
  view: XiangqiView;
  onLeave: () => void;
}

type SquarePair = { from: string; to: string };

// Common material values (chariot 9, cannon 4.5, horse 4, elephant/advisor 2, soldier 1).
const PIECE_VALUE: Record<XPieceType, number> = { r: 9, c: 4.5, n: 4, b: 2, a: 2, p: 1, k: 0 };

// What each side has captured by `ply`, most valuable first, and its material lead.
function captures(moves: XMove[], side: XSide, ply: number) {
  const taken = (s: XSide) =>
    moves
      .slice(0, ply)
      .filter((m) => m.side === s && m.captured)
      .map((m) => m.captured!)
      .sort((x, y) => PIECE_VALUE[y] - PIECE_VALUE[x]);
  const value = (pieces: XPieceType[]) => pieces.reduce((sum, p) => sum + PIECE_VALUE[p], 0);
  const mine = taken(side);
  return { pieces: mine, lead: value(mine) - value(taken(side === 'r' ? 'b' : 'r')) };
}
const NO_TARGETS: { square: string; capture: boolean }[] = [];

function piecesOf(game: Xiangqi): Omit<BoardPiece, 'id'>[] {
  const out: Omit<BoardPiece, 'id'>[] = [];
  game.board().forEach((row, i) =>
    row.forEach((p, file) => {
      if (p) out.push({ square: squareName(file, 9 - i), side: p.side, type: p.type });
    }),
  );
  return out;
}

// Pieces at every ply with ids that follow each piece through the game, so moves animate.
function trackPieces(moves: string[]): BoardPiece[][] {
  const game = new Xiangqi(START_FEN);
  const ids = new Map<string, string>();
  piecesOf(game).forEach((p, i) => ids.set(p.square, `p${i}`));
  const snapshot = () => piecesOf(game).map((p) => ({ ...p, id: ids.get(p.square)! }));
  const plies = [snapshot()];
  for (const m of moves) {
    const move = game.move(m);
    const id = ids.get(move.from)!;
    ids.delete(move.from);
    ids.set(move.to, id);
    plies.push(snapshot());
  }
  return plies;
}

export function XiangqiGame({ room, view, onLeave }: Props) {
  const { t } = useI18n();
  const playerId = room.you;
  const mySide: XSide | null = view.red === playerId ? 'r' : view.black === playerId ? 'b' : null;
  const myTurn = mySide === view.turn && !view.result;
  const names: Record<XSide, string | undefined> = {
    r: room.players.find((p) => p.id === view.red)?.name,
    b: room.players.find((p) => p.id === view.black)?.name,
  };

  // Chinese characters or plain letters on the pieces, remembered per browser.
  const [pieceStyle, setPieceStyle] = useState<'han' | 'letters'>(() => (loadSetting('vg:xqPieces') === 'letters' ? 'letters' : 'han'));
  const faces = useMemo<PieceFaces>(
    () => (pieceStyle === 'han' ? GLYPHS : { r: t.xiangqi.pieceLetters, b: t.xiangqi.pieceLetters }),
    [pieceStyle, t],
  );
  function togglePieceStyle() {
    const next = pieceStyle === 'han' ? 'letters' : 'han';
    saveSetting('vg:xqPieces', next);
    setPieceStyle(next);
  }

  const [selected, setSelected] = useState<string | null>(null);
  // A move queued while it's the opponent's turn; played as soon as it becomes legal.
  const [premove, setPremove] = useState<SquarePair | null>(null);
  // Show our move immediately; the server confirms it. If rejected, snap back.
  // `ply` is the game length it was made at, so it is dropped as soon as the server state moves on.
  const [pending, setPending] = useState<{ move: string; ply: number } | null>(null);
  const optimistic = pending && pending.ply === view.moves.length ? pending.move : null;

  const { fens, labels, moves } = useMemo(() => replayXiangqi(view.moves, t.xiangqi.notation), [view.fen, t]);
  const shownMoves = useMemo(() => (optimistic ? [...view.moves, optimistic] : view.moves), [view.fen, optimistic]);
  const tracked = useMemo(() => trackPieces(shownMoves), [shownMoves]);
  const live = useMemo(() => new Xiangqi(view.fen), [view.fen]);
  const opening = useMemo(() => findXiangqiOpening(view.moves), [view.fen]);
  const liveTargets = useMemo(
    () => (selected ? live.moves(selected).map((m) => ({ square: m.to, capture: !!m.captured })) : NO_TARGETS),
    [live, selected],
  );

  async function send(move: XiangqiMove) {
    const r = await api.move(move);
    if (!r.ok) toast(t.errors[r.error]);
    return r.ok;
  }

  async function play(from: string, to: string) {
    setSelected(null);
    setPending({ move: `${from}${to}`, ply: view.moves.length });
    if (!(await send({ type: 'move', from, to }))) setPending(null);
  }

  const isLegal = (from: string, to: string) => live.moves(from).some((m) => m.to === to);

  useEffect(() => {
    setSelected(null);
    setPending(null);
    // Fire a queued premove once it's our turn, if it's legal in the new position.
    if (!premove) return;
    if (view.result) return setPremove(null);
    if (!myTurn) return;
    setPremove(null);
    if (isLegal(premove.from, premove.to)) void play(premove.from, premove.to);
  }, [view.fen]);

  // Board callbacks stay the same function across renders (so the memoized board doesn't redraw
  // on every clock tick) and read the latest state through this ref.
  const latest = useRef({ canMove: false, canTouch: false });
  const handlers = useRef({ click: (_square: string) => {}, drop: (_from: string, _to: string) => {} });
  handlers.current = {
    click(square) {
      const { canMove, canTouch } = latest.current;
      if (!canTouch || optimistic) return;
      if (premove) {
        setPremove(null);
        setSelected(null);
        return;
      }
      const piece = live.get(square);
      if (piece && piece.side === mySide) {
        setSelected(square === selected ? null : square);
        return;
      }
      if (!selected) return;
      if (!canMove) {
        setPremove({ from: selected, to: square });
        setSelected(null);
      } else if (isLegal(selected, square)) void play(selected, square);
      else setSelected(null);
    },
    drop(from, to) {
      const { canMove, canTouch } = latest.current;
      if (!canTouch || optimistic) return;
      if (!canMove) {
        setPremove({ from, to });
        setSelected(null);
      } else if (isLegal(from, to)) void play(from, to);
      else setSelected(null);
    },
  };
  const onSquareClick = useCallback((square: string) => handlers.current.click(square), []);
  const onDrop = useCallback((from: string, to: string) => handlers.current.drop(from, to), []);

  // Full FEN (UCCI style) for the current position.
  const fullFen = `${view.fen} - - 0 ${Math.floor(view.moves.length / 2) + 1}`;

  async function copyFen() {
    try {
      await navigator.clipboard.writeText(fullFen);
      toast(t.chess.fenCopied);
    } catch {
      prompt(t.chess.copyFen, fullFen);
    }
  }

  // PGN with ICCS moves ("H2-E2"), which most xiangqi programs can import.
  function downloadRecord() {
    const pad = (n: number) => String(n).padStart(2, '0');
    const d = new Date();
    const result = !view.result ? '*' : !view.result.winner ? '1/2-1/2' : view.result.winner === view.red ? '1-0' : '0-1';
    const headers: [string, string][] = [
      ['Game', 'Chinese Chess'],
      ['Event', t.appName],
      ['Site', location.origin],
      ['Date', `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`],
      ['Red', names.r ?? t.xiangqi.red],
      ['Black', names.b ?? t.xiangqi.black],
      ['Result', result],
      ['Format', 'ICCS'],
    ];
    const iccs = view.moves.map((m) => `${m.slice(0, 2)}-${m.slice(2)}`.toUpperCase());
    const turns: string[] = [];
    for (let i = 0; i < iccs.length; i += 2) turns.push(`${i / 2 + 1}. ${iccs[i]}${iccs[i + 1] ? ` ${iccs[i + 1]}` : ''}`);
    const text = `${headers.map(([k, v]) => `[${k} "${v.replace(/"/g, "'")}"]`).join('\n')}\n\n${[...turns, result].join(' ')}\n`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'application/x-chess-pgn' }));
    link.download = `xiangqi-${room.code}.pgn`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const last = moves.at(-1);
  const lastMoveText = last ? describe(t, last.side === mySide ? t.room.you : (names[last.side] ?? t.chess.opponent), labels.at(-1)!, last) : null;

  function renderBoard({ bottom, ply, reviewing, canMove, canTouch }: BoardRenderProps) {
    latest.current = { canMove, canTouch };
    const shownPly = reviewing ? ply : shownMoves.length;
    const pieces = tracked[Math.min(shownPly, tracked.length - 1)];
    const lastShown = shownPly > 0 ? shownMoves[shownPly - 1] : null;
    const position = reviewing ? new Xiangqi(fens[ply]) : live;
    const general = pieces.find((p) => p.type === 'k' && p.side === position.turn());
    const checkSquare = !optimistic && position.inCheck() && general ? general.square : null;

    return (
      <XiangqiBoard
        pieces={pieces}
        bottom={bottom as XSide}
        selected={canTouch ? selected : null}
        targets={canMove && !optimistic ? liveTargets : NO_TARGETS}
        lastMove={lastShown}
        premove={premove ? `${premove.from}${premove.to}` : null}
        checkSquare={checkSquare}
        faces={faces}
        movable={canTouch && !optimistic ? mySide : null}
        onSquareClick={onSquareClick}
        onDrop={onDrop}
      />
    );
  }

  return (
    <DuelScreen
      room={room}
      view={view}
      sides={['r', 'b']}
      playerIds={{ r: view.red, b: view.black }}
      moveLabels={labels}
      sideName={(side) => (side === 'r' ? t.xiangqi.red : t.xiangqi.black)}
      sideToMove={(side) => (side === 'r' ? t.xiangqi.redToMove : t.xiangqi.blackToMove)}
      endReason={(reason) => t.xiangqi.endReasons[reason as keyof Strings['xiangqi']['endReasons']]}
      gameStarted={t.xiangqi.gameStarted}
      noMoves={t.xiangqi.noMoves}
      lastMoveText={lastMoveText}
      extraStatus={premove ? [t.chess.premove(premove.from, premove.to)] : []}
      soundForPly={(ply) => (moves[ply]?.check ? 'check' : moves[ply]?.captured ? 'capture' : 'move')}
      renderBoard={renderBoard}
      movesTools={
        <>
          {opening && <span className="muted small opening">{t.xiangqi.openings[opening]}</span>}
          <button
            className="tool-btn glyph-toggle"
            onClick={togglePieceStyle}
            aria-label={`${t.xiangqi.pieceStyleTitle}: ${t.xiangqi.pieceStyle[pieceStyle === 'han' ? 'letters' : 'han']}`}
            title={`${t.xiangqi.pieceStyleTitle}: ${t.xiangqi.pieceStyle[pieceStyle === 'han' ? 'letters' : 'han']}`}
          >
            {pieceStyle === 'han' ? 'Aa' : '漢'}
          </button>
          {view.moves.length > 0 && (
            <>
              <button className="tool-btn" onClick={copyFen} aria-label={t.chess.copyFen} title={t.chess.copyFen}>
                <CopyIcon />
              </button>
              <button className="tool-btn" onClick={downloadRecord} aria-label={t.chess.downloadPgn} title={t.chess.downloadPgn}>
                <DownloadIcon />
              </button>
            </>
          )}
        </>
      }
      playerExtra={(side, ply) => {
        const own = side as XSide;
        const enemy: XSide = own === 'r' ? 'b' : 'r';
        const { pieces, lead } = captures(moves, own, ply);
        return (
          <>
            <span className={`xq-side-dot ${own === 'r' ? 'red' : 'black'}`} />
            <span className="muted small">{lead > 0 ? `+${lead}` : t.chess.balanced}</span>
            <span className="captured">
              {pieces.map((type, i) => (
                <span key={i} className={`xq-mini ${enemy === 'r' ? 'red' : 'black'} ${pieceStyle}`} title={t.xiangqi.pieces[type]}>
                  {pieceStyle === 'han' ? GLYPHS[enemy][type] : t.xiangqi.pieceLetters[type]}
                </span>
              ))}
            </span>
          </>
        );
      }}
      onLeave={onLeave}
      send={(action) => send(action)}
    />
  );
}

function describe(t: Strings, who: string, notation: string, move: { captured?: string; check: boolean }): string {
  const d = t.xiangqi.describe;
  const captured = move.captured as keyof Strings['xiangqi']['pieces'] | undefined;
  const text = captured ? d.capture(who, notation, t.xiangqi.pieces[captured]) : d.move(who, notation);
  return move.check ? text + d.check : text;
}
