import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  GATE,
  HOME_STEPS,
  STABLE,
  squareOf,
  type CaNguaChoice,
  type CaNguaLogEntry,
  type CaNguaMove,
  type CaNguaView,
  type RoomView,
} from '@vg/shared';
import { api } from '../../socket';
import { useI18n, type Strings } from '../../i18n';
import { Avatar } from '../../components/Avatar';
import { Ellipsis } from '../../components/Ellipsis';
import { toast } from '../../components/Toaster';
import { ChatCard, PlayersCard, RoomCodeCard, ScoreboardPanel } from '../../components/RoomPanels';
import { RulesButton } from '../../components/RulesDialog';
import { ChevronRightIcon, ExitIcon, PlayIcon, TrophyIcon } from '../../components/icons';
import { loadSetting, saveSetting } from '../../settings';
import { playSound } from '../../sound';

interface Props {
  room: RoomView;
  view: CaNguaView;
  onLeave: () => void;
}

// ---- Board geometry: a 15×15 cross. Colour slot 0 sits top-left; the others are its rotations. ----

const N = 15;
type Cell = [number, number];
const rotate = ([r, c]: Cell, times: number): Cell => {
  let cell: Cell = [r, c];
  for (let i = 0; i < times; i++) cell = [cell[1], N - 1 - cell[0]];
  return cell;
};

// The 52 track squares clockwise, starting at colour 0's start square.
const TRACK_CELLS: Cell[] = (() => {
  // One quarter of the loop (13 squares), then the same quarter rotated three times.
  const quarter: Cell[] = [];
  const run = (from: Cell, to: Cell) => {
    const [dr, dc] = [Math.sign(to[0] - from[0]), Math.sign(to[1] - from[1])];
    for (let cell = from; ; cell = [cell[0] + dr, cell[1] + dc]) {
      quarter.push(cell);
      if (cell[0] === to[0] && cell[1] === to[1]) break;
    }
  };
  run([6, 1], [6, 5]);
  run([5, 6], [0, 6]);
  run([0, 7], [0, 8]);
  return [0, 1, 2, 3].flatMap((k) => quarter.map((cell) => rotate(cell, k)));
})();

const homeCell = (color: number, step: number): Cell => rotate([7, step], color);
// Four stable spots in the colour's corner.
const stableCell = (color: number, horse: number): Cell => rotate([[1.5, 1.5], [1.5, 3.5], [3.5, 1.5], [3.5, 3.5]][horse] as Cell, color);

function cellOf(color: number, progress: number, horse: number): Cell {
  if (progress === STABLE) return stableCell(color, horse);
  if (progress <= GATE) return TRACK_CELLS[squareOf(color, progress)];
  return homeCell(color, progress - GATE);
}

const COLOR_CLASS = ['red', 'green', 'blue', 'yellow'];

// Re-renders periodically while `active`, for the turn countdown.
function useTicker(active: boolean, ms = 250) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

function Die({ value, rolling }: { value: number | null; rolling: boolean }) {
  const pips: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  return (
    <span className={`cn-die ${rolling ? 'rolling' : ''}`} aria-label={value ? String(value) : ''}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={value && pips[value].includes(i) ? 'pip' : ''} />
      ))}
    </span>
  );
}

function describe(t: Strings, e: CaNguaLogEntry, name: (id: string) => string): string {
  const L = t.cangua.log;
  switch (e.kind) {
    case 'roll':
      return (e.auto ? L.autoRoll : L.roll)(name(e.player), e.value);
    case 'release':
      return L.release(name(e.player)) + (e.kicked ? L.kicked(name(e.kicked)) : '');
    case 'move':
      return L.move(name(e.player), e.to - e.from) + (e.kicked ? L.kicked(name(e.kicked)) : '');
    case 'climb':
      return L.climb(name(e.player), e.step);
    case 'stuck':
      return L.stuck(name(e.player));
    case 'sixes':
      return L.sixes(name(e.player));
    case 'left':
      return L.left(name(e.player));
  }
}

function choiceLabel(t: Strings, c: CaNguaChoice, from: number, name: (id: string) => string): string {
  const C = t.cangua;
  const base = from === STABLE ? C.release : c.to > GATE ? C.climb(c.to - GATE) : c.to === GATE ? C.toGate : C.advance(c.to - from);
  return c.kicks ? `${base}, ${C.kick(name(c.kicks.player))}` : base;
}

export function CaNguaGame({ room, view, onLeave }: Props) {
  const { t } = useI18n();
  const C = t.cangua;
  const me = room.you;
  const mySeat = view.seats.find((s) => s.id === me);
  const seated = !!mySeat && !mySeat.out;
  const myTurn = view.turn === me && !view.result && seated;
  const isHost = room.hostId === me;
  const name = (id: string) => (id === me ? t.room.you : ([...room.players, ...room.departed].find((p) => p.id === id)?.name ?? '…'));
  const player = (id: string) => room.players.find((p) => p.id === id);
  const colorOf = (id: string) => view.seats.find((s) => s.id === id)?.color ?? 0;
  const COLORS = ['#d63b30', '#2e9a4f', '#2f6fd1', '#e5b014'];

  const [hover, setHover] = useState<number | null>(null);
  const receivedAt = useMemo(() => performance.now(), [room]);
  useTicker(myTurn && view.turnMs !== null);
  const turnLeft = view.turnMs === null ? null : Math.max(0, view.turnMs - (performance.now() - receivedAt));
  const turnFraction = turnLeft !== null && view.turnLimitMs ? turnLeft / view.turnLimitMs : null;

  async function send(move: CaNguaMove) {
    const r = await api.move(move);
    if (!r.ok) toast(t.errors[r.error]);
    return r.ok;
  }

  async function rematch() {
    const r = isHost ? await api.start() : await api.rematch();
    if (!r.ok) toast(t.errors[r.error]);
  }

  // Roll animation: a short shake whenever a new roll arrives.
  const lastRoll = [...view.log].reverse().find((e) => e.kind === 'roll');
  const rollKey = view.log.length + (lastRoll && lastRoll.kind === 'roll' ? lastRoll.value : 0);
  const [rolling, setRolling] = useState(false);
  const seenLog = useRef(view.log.length);
  useEffect(() => {
    const fresh = view.log.slice(seenLog.current);
    seenLog.current = view.log.length;
    if (fresh.some((e) => e.kind === 'roll')) {
      setRolling(true);
      const id = setTimeout(() => setRolling(false), 450);
      if (fresh.some((e) => ('kicked' in e && e.kicked) || e.kind === 'sixes')) playSound('capture');
      else playSound('move');
      return () => clearTimeout(id);
    }
    if (fresh.some((e) => 'kicked' in e && e.kicked)) playSound('capture');
    else if (fresh.length) playSound('move');
  }, [view.log]);
  useEffect(() => {
    if (myTurn) playSound('notify');
  }, [myTurn]);
  const seenResult = useRef(view.result);
  useEffect(() => {
    if (view.result && !seenResult.current) playSound('end');
    seenResult.current = view.result;
  }, [view.result]);
  useEffect(() => {
    if (!myTurn) return;
    document.title = `● ${C.yourRoll} · ${t.appName}`;
    return () => {
      document.title = t.appName;
    };
  }, [myTurn, t]);

  const [logOpen, setLogOpen] = useState(() => loadSetting('vg:cnLog') !== 'closed');
  function toggleLog() {
    saveSetting('vg:cnLog', logOpen ? 'closed' : 'open');
    setLogOpen(!logOpen);
  }
  const logRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [view.log.length, logOpen]);

  const choices = view.choices;
  const movable = new Set(choices.map((c) => c.horse));
  const hovered = hover === null ? null : choices.find((c) => c.horse === hover);
  const targetCell = hovered && mySeat ? cellOf(mySeat.color, hovered.to, hovered.horse) : null;

  // Which colours sit at the table, for tinting the board's stables and home columns.
  const inPlay = new Set(view.seats.map((s) => s.color));

  let status: string;
  if (view.result) status = C.resultTitle;
  else if (!seated) status = C.turnOf(name(view.turn));
  else if (!myTurn) status = C.turnOf(name(view.turn)) + '…';
  else if (view.phase === 'roll') status = view.die === null && lastRoll?.kind === 'roll' && lastRoll.value === 6 && lastRoll.player === me ? C.rollAgain : C.yourRoll;
  else status = C.pickHorse;

  const myPlace = view.result ? view.result.ranking.indexOf(me) + 1 : 0;
  const pos = (cell: Cell): CSSProperties => ({ top: `${(cell[0] / N) * 100}%`, left: `${(cell[1] / N) * 100}%` });

  return (
    <div className="tl-layout cn-layout">
      <aside className="game-left">
        <RoomCodeCard code={room.code} />
        <PlayersCard
          room={room}
          colorOf={(id) => (view.seats.some((s) => s.id === id) ? COLORS[colorOf(id)] : undefined)}
          subtitle={(id) => {
            const seat = view.seats.find((s) => s.id === id);
            if (!seat) return null;
            const home = seat.horses.filter((p) => p > GATE).length;
            return `${C.colors[seat.color]} · ${C.homeCount(home)}`;
          }}
        />
        <RulesButton gameType="cangua" caNguaRules={view.rules} wide />
        <button className="btn btn-ghost" onClick={onLeave}>
          <ExitIcon /> {t.room.leave}
        </button>
      </aside>

      <section className="tl-main">
        <div className="cn-board-wrap">
          <div className="cn-board">
            {[0, 1, 2, 3].map((color) => {
              const [r, c] = rotate([0, 0], color);
              const corner: CSSProperties = { top: r === 0 ? 0 : `${(9 / N) * 100}%`, left: c === 0 ? 0 : `${(9 / N) * 100}%` };
              return (
                <div key={color} className={`cn-stable ${COLOR_CLASS[color]} ${inPlay.has(color) ? '' : 'empty'}`} style={corner}>
                  <span className="cn-stable-inner" />
                </div>
              );
            })}
            {TRACK_CELLS.map((cell, i) => {
              const startOf = [0, 1, 2, 3].find((color) => squareOf(color, 0) === i);
              const gateOf = [0, 1, 2, 3].find((color) => squareOf(color, GATE) === i);
              return (
                <span
                  key={i}
                  className={['cn-cell', startOf !== undefined ? `start ${COLOR_CLASS[startOf]}` : '', gateOf !== undefined ? `gate gate-${COLOR_CLASS[gateOf]}` : ''].join(' ')}
                  style={pos(cell)}
                />
              );
            })}
            {[0, 1, 2, 3].flatMap((color) =>
              Array.from({ length: HOME_STEPS }, (_, k) => (
                <span key={`h${color}-${k}`} className={`cn-cell home ${COLOR_CLASS[color]}`} style={pos(homeCell(color, k + 1))}>
                  {k + 1}
                </span>
              )),
            )}
            <span className="cn-center" />
            {targetCell && <span className="cn-target" style={pos(targetCell)} />}
            {view.seats.flatMap((seat) =>
              seat.out
                ? []
                : seat.horses.map((p, horse) => {
                    const canMove = seat.id === me && movable.has(horse);
                    return (
                      <button
                        key={`${seat.id}-${horse}`}
                        type="button"
                        className={`cn-horse ${COLOR_CLASS[seat.color]} ${canMove ? 'movable' : ''} ${view.turn === seat.id && !view.result ? 'turn' : ''}`}
                        style={pos(cellOf(seat.color, p, horse))}
                        disabled={!canMove}
                        onClick={() => send({ type: 'move', horse })}
                        onMouseEnter={() => canMove && setHover(horse)}
                        onMouseLeave={() => setHover(null)}
                        aria-label={`${name(seat.id)} · ${C.horse(horse + 1)}`}
                        title={`${name(seat.id)} · ${C.horse(horse + 1)}`}
                      >
                        ♞
                      </button>
                    );
                  }),
            )}
          </div>

          {view.result && (
            <div className="tl-result">
              <div className={`tl-result-card ${myPlace === 1 ? 'won' : ''}`}>
                {myPlace === 1 && (
                  <div className="confetti" aria-hidden="true">
                    {Array.from({ length: 18 }, (_, i) => (
                      <span key={i} style={{ '--i': i } as CSSProperties} />
                    ))}
                  </div>
                )}
                <header className="tl-result-head">
                  <span className="result-icon">
                    <TrophyIcon />
                  </span>
                  <h2>{myPlace === 1 ? C.youWon : myPlace ? C.youPlaced(myPlace) : C.resultTitle}</h2>
                  <p className="muted">{C.winnerIs(name(view.result.winner))}</p>
                </header>
                <ol className="tl-podium">
                  {view.result.ranking.map((id, i) => {
                    const seat = view.seats.find((s) => s.id === id)!;
                    return (
                      <li key={id} className={`medal-${i === view.result!.ranking.length - 1 ? 'last' : i + 1} ${id === me ? 'me' : ''}`}>
                        <span className="tl-medal">{i + 1}</span>
                        <Avatar id={id} name={player(id)?.name ?? name(id)} size={38} color={COLORS[seat.color]} />
                        <span className="tl-podium-text">
                          <strong>{name(id)}</strong>
                          <span className="muted small">
                            {C.colors[seat.color]} · {seat.out ? t.tienlen.left : C.homeCount(seat.horses.filter((p) => p > GATE).length)}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
                <div className="tl-result-actions">
                  {mySeat ? (
                    <button className="btn btn-primary" disabled={!isHost && room.rematchVotes.includes(me)} onClick={rematch}>
                      <PlayIcon />{' '}
                      {isHost ? t.room.playAgain : room.rematchVotes.includes(me) ? t.room.rematchRequested : t.room.requestRematch}
                    </button>
                  ) : (
                    <span className="muted">
                      <Ellipsis text={t.room.waitingForHost} />
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className={`tl-me card cn-me ${myTurn ? 'turn' : ''}`}>
          <div className="tl-me-head">
            <Avatar id={view.turn} name={player(view.turn)?.name ?? '?'} size={36} color={COLORS[colorOf(view.turn)]} />
            <p className="tl-status">
              <Ellipsis text={status} />
            </p>
            <Die key={rollKey} value={view.die ?? (lastRoll?.kind === 'roll' ? lastRoll.value : null)} rolling={rolling} />
            {myTurn && turnLeft !== null && <span className="tl-seconds">{Math.ceil(turnLeft / 1000)}s</span>}
          </div>
          {myTurn && turnFraction !== null && <div className="tl-bar" style={{ '--left': turnFraction } as CSSProperties} />}
          {myTurn && view.phase === 'roll' && (
            <div className="cn-actions">
              <button className="btn btn-primary btn-lg" onClick={() => send({ type: 'roll' })}>
                🎲 {C.roll}
              </button>
            </div>
          )}
          {myTurn && view.phase === 'move' && (
            <div className="cn-actions">
              {choices.map((c) => (
                <button
                  key={c.horse}
                  className={`btn btn-secondary cn-choice ${COLOR_CLASS[mySeat!.color]}`}
                  onMouseEnter={() => setHover(c.horse)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => send({ type: 'move', horse: c.horse })}
                >
                  ♞ {C.horse(c.horse + 1)}: {choiceLabel(t, c, mySeat!.horses[c.horse], name)}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <aside className="game-right">
        <section className={`card panel tl-log-panel ${logOpen ? 'open' : 'closed'}`}>
          <button className="panel-toggle" aria-expanded={logOpen} aria-controls="cn-log" onClick={toggleLog} title={logOpen ? C.hideLog : C.showLog}>
            <h2>{C.history}</h2>
            <ChevronRightIcon className="panel-chevron" />
          </button>
          {view.log.length === 0 ? (
            <p className="muted small">{C.noHistory}</p>
          ) : logOpen ? (
            <ol className="tl-log" id="cn-log" ref={logRef}>
              {view.log.map((entry, i) => (
                <li
                  key={i}
                  className={`tl-log-row ${entry.player === me ? 'mine' : ''} ${'kicked' in entry && entry.kicked ? 'chop' : entry.kind === 'climb' ? 'finish' : entry.kind === 'stuck' || entry.kind === 'sixes' ? 'pass' : ''}`}
                >
                  <Avatar id={entry.player} name={player(entry.player)?.name ?? '?'} size={22} color={COLORS[colorOf(entry.player)]} />
                  <span className="tl-log-text">{describe(t, entry, name)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="tl-log-latest muted small">{describe(t, view.log.at(-1)!, name)}</p>
          )}
        </section>
        <ScoreboardPanel room={room} />
        <ChatCard room={room} />
      </aside>
    </div>
  );
}

