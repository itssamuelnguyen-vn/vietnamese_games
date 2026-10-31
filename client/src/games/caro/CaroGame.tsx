import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { caroBoard, cellName, turnOf, type CaroMove, type CaroSide, type CaroView, type RoomView } from '@vg/shared';
import { api } from '../../socket';
import { useI18n, type Strings } from '../../i18n';
import { toast } from '../../components/Toaster';
import { DuelScreen, type BoardRenderProps } from '../duel/DuelScreen';

interface Props {
  room: RoomView;
  view: CaroView;
  onLeave: () => void;
}

interface BoardProps {
  size: number;
  moves: number[];
  // Highlighted winning row, if any.
  line: number[] | null;
  // The mark shown as a preview under the pointer when it's our move; null when we can't move.
  ghost: CaroSide | null;
  onPlace: (cell: number) => void;
}

// Drawn rather than typed, so marks fill the cell at any board size.
export function CaroMark({ side }: { side: CaroSide }) {
  return (
    <svg className={`caro-mark ${side}`} viewBox="0 0 10 10" aria-hidden="true">
      {side === 'x' ? <path d="M2 2l6 6M8 2l-6 6" /> : <circle cx="5" cy="5" r="3.2" />}
    </svg>
  );
}

// Memoized so the clock ticking in the surrounding screen doesn't redraw hundreds of cells.
const CaroBoard = memo(function CaroBoard({ size, moves, line, ghost, onPlace }: BoardProps) {
  const board = useMemo(() => caroBoard(moves, size), [moves, size]);
  const last = moves.at(-1);
  const winning = useMemo(() => new Set(line ?? []), [line]);
  return (
    <div className={`caro-board size-${size} ${ghost ? `ghost-${ghost}` : ''}`} style={{ gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))` }}>
      {board.map((mark, cell) => (
        <button
          key={cell}
          type="button"
          className={['caro-cell', mark ?? 'empty', cell === last ? 'last' : '', winning.has(cell) ? 'win' : ''].join(' ')}
          disabled={!ghost || mark !== null}
          onClick={() => onPlace(cell)}
          aria-label={`${cellName(cell, size)}${mark ? ` ${mark.toUpperCase()}` : ''}`}
          title={cellName(cell, size)}
        >
          {mark && <CaroMark side={mark} />}
        </button>
      ))}
    </div>
  );
});

export function CaroGame({ room, view, onLeave }: Props) {
  const { t } = useI18n();
  const playerId = room.you;
  const mySide: CaroSide | null = view.x === playerId ? 'x' : view.o === playerId ? 'o' : null;
  const names: Record<CaroSide, string | undefined> = {
    x: room.players.find((p) => p.id === view.x)?.name,
    o: room.players.find((p) => p.id === view.o)?.name,
  };

  // Show our mark immediately; the server confirms it, and it disappears if refused.
  const [pending, setPending] = useState<{ cell: number; ply: number } | null>(null);
  const optimistic = pending && pending.ply === view.moves.length ? pending.cell : null;
  const shownMoves = useMemo(() => (optimistic !== null ? [...view.moves, optimistic] : view.moves), [view.moves, optimistic]);
  useEffect(() => setPending(null), [view.moves.length]);

  async function send(move: CaroMove) {
    const r = await api.move(move);
    if (!r.ok) toast(t.errors[r.error]);
    return r.ok;
  }

  // Stable across renders (the board is memoized); reads the latest state through a ref.
  const canMoveRef = useRef(false);
  const place = useRef((_cell: number) => {});
  place.current = (cell: number) => {
    if (!canMoveRef.current || optimistic !== null) return;
    setPending({ cell, ply: view.moves.length });
    void send({ type: 'place', cell }).then((ok) => !ok && setPending(null));
  };
  const onPlace = useCallback((cell: number) => place.current(cell), []);

  const labels = useMemo(() => view.moves.map((cell) => cellName(cell, view.size)), [view.moves, view.size]);
  const last = view.moves.at(-1);
  const lastSide: CaroSide = view.moves.length % 2 === 1 ? 'x' : 'o';
  const lastMoveText =
    last === undefined ? null : t.caro.placed(lastSide === mySide ? t.room.you : (names[lastSide] ?? t.chess.opponent), cellName(last, view.size));

  // Moves per ply for review, memoized so the board only redraws when they change.
  const slices = useMemo(() => shownMoves.map((_, i) => shownMoves.slice(0, i + 1)), [shownMoves]);

  function renderBoard({ ply, reviewing, canMove }: BoardRenderProps) {
    canMoveRef.current = canMove;
    const moves = reviewing ? (slices[ply - 1] ?? EMPTY) : shownMoves;
    const line = !reviewing && view.result?.line ? view.result.line : null;
    const ghost = canMove && optimistic === null && mySide && turnOf(view.moves) === mySide ? mySide : null;
    return <CaroBoard size={view.size} moves={moves} line={line} ghost={ghost} onPlace={onPlace} />;
  }

  return (
    <DuelScreen
      room={room}
      view={view}
      sides={['x', 'o']}
      playerIds={{ x: view.x, o: view.o }}
      moveLabels={labels}
      sideName={(side) => (side === 'x' ? t.caro.x : t.caro.o)}
      sideToMove={(side) => (side === 'x' ? t.caro.xToMove : t.caro.oToMove)}
      endReason={(reason) => t.caro.endReasons[reason as keyof Strings['caro']['endReasons']]}
      gameStarted={t.caro.gameStarted}
      noMoves={t.caro.noMoves}
      lastMoveText={lastMoveText}
      soundForPly={() => 'move'}
      renderBoard={renderBoard}
      movesTools={<span className="muted small">{view.blockRule ? t.caro.blockTagOn : t.caro.blockTagOff}</span>}
      playerExtra={(side) => (
        <span className="caro-side">
          <CaroMark side={side as CaroSide} />
        </span>
      )}
      onLeave={onLeave}
      send={(action) => send(action)}
    />
  );
}

const EMPTY: number[] = [];
