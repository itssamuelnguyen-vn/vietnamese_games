import { useEffect, useMemo, useState } from 'react';
import { START_FEN, Xiangqi, squareName, type RoomView, type XiangqiMove, type XiangqiView, type XSide } from '@vg/shared';
import { api } from '../../socket';
import { useI18n, type Strings } from '../../i18n';
import { toast } from '../../components/Toaster';
import { DuelScreen, type BoardRenderProps } from '../duel/DuelScreen';
import { replayXiangqi } from './notation';
import { XiangqiBoard, type BoardPiece } from './XiangqiBoard';

interface Props {
  room: RoomView;
  view: XiangqiView;
  onLeave: () => void;
}

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
  const names: Record<XSide, string | undefined> = {
    r: room.players.find((p) => p.id === view.red)?.name,
    b: room.players.find((p) => p.id === view.black)?.name,
  };

  const [selected, setSelected] = useState<string | null>(null);
  // Show our move immediately; the server confirms it. If rejected, snap back.
  // `ply` is the game length it was made at, so it is dropped as soon as the server state moves on.
  const [pending, setPending] = useState<{ move: string; ply: number } | null>(null);
  const optimistic = pending && pending.ply === view.moves.length ? pending.move : null;
  useEffect(() => {
    setSelected(null);
    setPending(null);
  }, [view.fen]);

  const { labels, moves } = useMemo(() => replayXiangqi(view.moves, t.xiangqi.notation), [view.fen, t]);
  const shownMoves = optimistic ? [...view.moves, optimistic] : view.moves;
  const tracked = useMemo(() => trackPieces(shownMoves), [shownMoves.join(' ')]);
  const live = useMemo(() => new Xiangqi(view.fen), [view.fen]);

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

  const last = moves.at(-1);
  const lastMoveText = last ? describe(t, last.side === mySide ? t.room.you : (names[last.side] ?? t.chess.opponent), labels.at(-1)!, last) : null;

  function renderBoard({ bottom, ply, reviewing, canMove }: BoardRenderProps) {
    const shownPly = reviewing ? ply : shownMoves.length;
    const pieces = tracked[Math.min(shownPly, tracked.length - 1)];
    const lastShown = shownPly > 0 ? { from: shownMoves[shownPly - 1].slice(0, 2), to: shownMoves[shownPly - 1].slice(2) } : null;
    const position = reviewing ? new Xiangqi(replayXiangqi(view.moves.slice(0, ply), t.xiangqi.notation).fens.at(-1)) : live;
    const general = pieces.find((p) => p.type === 'k' && p.side === position.turn());
    const checkSquare = !optimistic && position.inCheck() && general ? general.square : null;
    const targets =
      selected && canMove && !optimistic
        ? live.moves(selected).map((m) => ({ square: m.to, capture: !!m.captured }))
        : [];

    function onSquareClick(square: string) {
      if (!canMove || optimistic) return;
      const piece = live.get(square);
      if (piece && piece.side === mySide) {
        setSelected(square === selected ? null : square);
        return;
      }
      if (selected && targets.some((m) => m.square === square)) void play(selected, square);
      else setSelected(null);
    }

    return (
      <XiangqiBoard
        pieces={pieces}
        bottom={bottom as XSide}
        selected={canMove ? selected : null}
        targets={targets}
        lastMove={lastShown}
        checkSquare={checkSquare}
        onSquareClick={onSquareClick}
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
      soundForPly={(ply) => (moves[ply]?.check ? 'check' : moves[ply]?.captured ? 'capture' : 'move')}
      renderBoard={renderBoard}
      playerExtra={(side) => <span className={`xq-side-dot ${side === 'r' ? 'red' : 'black'}`} />}
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
