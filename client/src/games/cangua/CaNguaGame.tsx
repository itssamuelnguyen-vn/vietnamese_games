import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
import { freshEntries } from '../freshLog';

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

// The squares a horse passes over on its way from `from` to `to` (neither end included).
function pathCells(color: number, from: number, to: number, horse: number): Cell[] {
  if (from === STABLE) return [];
  const cells: Cell[] = [];
  for (let p = from + 1; p < to; p++) cells.push(cellOf(color, p, horse));
  return cells;
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

const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

// While rolling the die flicks through random faces before landing on the real one.
function Die({ value, rolling, color, onRoll, label }: { value: number | null; rolling: boolean; color?: string; onRoll?: () => void; label: string }) {
  const [face, setFace] = useState(value);
  useEffect(() => {
    if (!rolling) return;
    // Faces flick by quickly at first, then slow down as the die comes to rest.
    const start = performance.now();
    let id: ReturnType<typeof setTimeout>;
    const flick = () => {
      setFace((f) => 1 + ((f ?? 0) + Math.floor(Math.random() * 5)) % 6);
      const elapsed = (performance.now() - start) / ROLL_MS;
      id = setTimeout(flick, 60 + 260 * elapsed * elapsed);
    };
    flick();
    return () => clearTimeout(id);
  }, [rolling]);
  const shown = rolling ? face : value;
  const pips = Array.from({ length: 9 }, (_, i) => <span key={i} className={shown && PIPS[shown].includes(i) ? 'pip' : ''} />);
  const style = { '--die-c': color } as CSSProperties;
  const className = `cn-die ${rolling ? 'rolling' : ''}`;
  return onRoll ? (
    <button type="button" className={`${className} can-roll`} style={style} onClick={onRoll} aria-label={label} title={label}>
      {pips}
    </button>
  ) : (
    <span className={className} style={style} aria-label={value ? String(value) : ''}>
      {pips}
    </span>
  );
}

// How long the die tumbles; move choices stay hidden until it lands.
const ROLL_MS = 1400;

type Shown = Record<string, number[]>;
const STEP_MS = 260;

// Horses walk to where the server put them one square at a time; a kicked horse waits until the
// horse that kicked it has landed, then goes back to its stable.
function useWalkingHorses(seats: CaNguaView['seats']) {
  const target = useMemo<Shown>(() => Object.fromEntries(seats.map((s) => [s.id, s.horses])), [seats]);
  const [shown, setShown] = useState<Shown>(target);
  useEffect(() => {
    const settled = Object.entries(target).every(([id, horses]) => horses.every((p, i) => shown[id]?.[i] === p));
    if (settled) return;
    const id = setTimeout(() => {
      setShown((prev) => {
        const walking = Object.entries(target).some(([id, horses]) => horses.some((p, i) => (prev[id]?.[i] ?? p) >= 0 && p > (prev[id]?.[i] ?? p)));
        return Object.fromEntries(
          Object.entries(target).map(([id, horses]) => [
            id,
            horses.map((p, i) => {
              const at = prev[id]?.[i];
              if (at === undefined || at === p) return p;
              if (at >= 0 && p > at) return at + 1;
              if (p === STABLE && walking) return at;
              return p;
            }),
          ]),
        );
      });
    }, STEP_MS);
    return () => clearTimeout(id);
  }, [target, shown]);
  return (id: string, horse: number, real: number) => shown[id]?.[horse] ?? real;
}

function describe(t: Strings, e: CaNguaLogEntry, name: (id: string) => string): string {
  const L = t.cangua.log;
  switch (e.kind) {
    case 'roll':
      return (e.auto ? L.autoRoll : L.roll)(name(e.player), e.value);
    case 'release':
      return L.release(name(e.player), e.horse + 1) + (e.kicked ? L.kicked(name(e.kicked)) : '');
    case 'move':
      return L.move(name(e.player), e.horse + 1, e.to - e.from) + (e.kicked ? L.kicked(name(e.kicked)) : '');
    case 'climb':
      return L.climb(name(e.player), e.horse + 1, e.step);
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

  const sending = useRef(false);
  async function send(move: CaNguaMove) {
    // The clicked horse or button may vanish without a mouseleave, so drop the target marker now.
    setHover(null);
    sending.current = true;
    const r = await api.move(move).finally(() => (sending.current = false));
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
  // Logs keep only recent entries, so new ones are found by content, not by length.
  // A layout effect, so a fresh roll hides the move choices before they are ever painted.
  const seenLog = useRef(view.log);
  useLayoutEffect(() => {
    const fresh = freshEntries(seenLog.current, view.log);
    seenLog.current = view.log;
    if (fresh.some((e) => e.kind === 'roll')) {
      setRolling(true);
      const id = setTimeout(() => setRolling(false), ROLL_MS);
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

  const choices = rolling ? [] : view.choices;
  const movable = new Set(choices.map((c) => c.horse));
  const hovered = hover === null ? null : choices.find((c) => c.horse === hover);
  const targetCell = hovered && mySeat ? cellOf(mySeat.color, hovered.to, hovered.horse) : null;
  const pathPreview = hovered && mySeat ? pathCells(mySeat.color, mySeat.horses[hovered.horse], hovered.to, hovered.horse) : [];
  const shownAt = useWalkingHorses(view.seats);
  const canRoll = myTurn && view.phase === 'roll';

  // Keyboard: Space or Enter rolls, 1-4 moves that horse.
  useEffect(() => {
    if (!myTurn) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || sending.current) return;
      const el = e.target as HTMLElement | null;
      // Leave typing alone, and let a focused button handle its own Space/Enter.
      if (el?.closest('input, textarea, select, button, [contenteditable="true"]')) return;
      if (view.phase === 'roll' && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        send({ type: 'roll' });
      } else if (view.phase === 'move' && /^[1-4]$/.test(e.key) && movable.has(Number(e.key) - 1)) {
        e.preventDefault();
        send({ type: 'move', horse: Number(e.key) - 1 });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  let status: string;
  if (view.result) status = C.resultTitle;
  else if (!seated) status = C.turnOf(name(view.turn));
  else if (!myTurn) status = C.turnOf(name(view.turn)) + '…';
  else if (view.phase === 'roll') status = view.die === null && lastRoll?.kind === 'roll' && lastRoll.value === 6 && lastRoll.player === me ? C.rollAgain : C.yourRoll;
  else status = rolling ? C.rolling : C.pickHorse;

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
          <div className="cn-frame">
            <div className="cn-board">
              {[0, 1, 2, 3].map((color) => {
                const [r, c] = rotate([0, 0], color);
                const corner: CSSProperties = { top: r === 0 ? 0 : `${(9 / N) * 100}%`, left: c === 0 ? 0 : `${(9 / N) * 100}%` };
                const seat = view.seats.find((s) => s.color === color);
                const turn = !!seat && view.turn === seat.id && !view.result;
                return (
                  <div key={color} className={`cn-stable ${COLOR_CLASS[color]} ${seat ? '' : 'empty'} ${turn ? 'turn' : ''}`} style={corner}>
                    <span className="cn-stable-inner" />
                    {seat && (
                      <span className={`cn-owner ${r === 0 ? 'top' : 'bottom'}`}>
                        <span>
                          {name(seat.id)}
                          {seat.out ? ` · ${t.tienlen.left}` : ''}
                        </span>
                      </span>
                    )}
                  </div>
                );
              })}
              {view.seats.flatMap((seat) =>
                Array.from({ length: 4 }, (_, horse) => (
                  <span key={`slot-${seat.id}-${horse}`} className={`cn-slot ${COLOR_CLASS[seat.color]}`} style={pos(stableCell(seat.color, horse))}>
                    {horse + 1}
                  </span>
                )),
              )}
              {TRACK_CELLS.map((cell, i) => {
                const startOf = [0, 1, 2, 3].find((color) => squareOf(color, 0) === i);
                const gateOf = [0, 1, 2, 3].find((color) => squareOf(color, GATE) === i);
                return (
                  <span
                    key={i}
                    className={['cn-cell', startOf !== undefined ? `start ${COLOR_CLASS[startOf]}` : '', gateOf !== undefined ? `gate gate-${COLOR_CLASS[gateOf]}` : ''].join(' ')}
                    style={{ ...pos(cell), ...(startOf !== undefined ? ({ '--rot': `${startOf * 90}deg` } as CSSProperties) : {}) }}
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
              <span className="cn-center">
                <span className="cn-star" aria-hidden="true">
                  ★
                </span>
              </span>
              {mySeat &&
                pathPreview.map((cell, i) => <span key={`p${i}`} className={`cn-step ${COLOR_CLASS[mySeat.color]}`} style={pos(cell)} />)}
              {targetCell && <span className={`cn-target ${hovered?.kicks ? 'kick' : ''}`} style={pos(targetCell)} />}
              {view.seats.flatMap((seat) =>
                seat.out
                  ? []
                  : seat.horses.map((p, horse) => {
                      const mine = seat.id === me;
                      const canMove = mine && movable.has(horse);
                      const at = shownAt(seat.id, horse, p);
                      const label = `${name(seat.id)} · ${C.horse(horse + 1)}`;
                      return (
                        <button
                          key={`${seat.id}-${horse}`}
                          type="button"
                          className={[
                            'cn-horse',
                            COLOR_CLASS[seat.color],
                            canMove ? 'movable' : '',
                            canMove && hover === horse ? 'hovered' : '',
                            mine && myTurn && view.phase === 'move' && !canMove ? 'dim' : '',
                            at !== p ? 'walking' : '',
                          ].join(' ')}
                          style={pos(cellOf(seat.color, at, horse))}
                          disabled={!canMove}
                          onClick={() => send({ type: 'move', horse })}
                          onMouseEnter={() => canMove && setHover(horse)}
                          onMouseLeave={() => setHover(null)}
                          onFocus={() => canMove && setHover(horse)}
                          onBlur={() => setHover(null)}
                          aria-label={label}
                          title={label}
                        >
                          <span className="cn-glyph" aria-hidden="true">
                            ♞
                          </span>
                          <span className="cn-num" aria-hidden="true">
                            {horse + 1}
                          </span>
                        </button>
                      );
                    }),
              )}
            </div>
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
            {myTurn && turnLeft !== null && <span className="tl-seconds">{Math.ceil(turnLeft / 1000)}s</span>}
            <Die
              key={rollKey}
              value={view.die ?? (lastRoll?.kind === 'roll' ? lastRoll.value : null)}
              rolling={rolling}
              color={lastRoll?.kind === 'roll' ? COLORS[colorOf(lastRoll.player)] : undefined}
              onRoll={canRoll ? () => send({ type: 'roll' }) : undefined}
              label={C.roll}
            />
          </div>
          {myTurn && turnFraction !== null && <div className="tl-bar" style={{ '--left': turnFraction } as CSSProperties} />}
          {canRoll && (
            <div className="cn-actions">
              <button className="btn btn-primary btn-lg cn-roll" onClick={() => send({ type: 'roll' })}>
                🎲 {C.roll}
                <kbd className="cn-key">Space</kbd>
              </button>
            </div>
          )}
          {myTurn && view.phase === 'move' && (
            <div className="cn-actions">
              {choices.map((c) => (
                <button
                  key={c.horse}
                  type="button"
                  className={`cn-choice ${COLOR_CLASS[mySeat!.color]} ${hover === c.horse ? 'active' : ''} ${c.kicks ? 'kicks' : ''}`}
                  onMouseEnter={() => setHover(c.horse)}
                  onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(c.horse)}
                  onBlur={() => setHover(null)}
                  onClick={() => send({ type: 'move', horse: c.horse })}
                >
                  <span className="cn-token" aria-hidden="true">
                    ♞<b>{c.horse + 1}</b>
                  </span>
                  <span className="cn-choice-text">
                    <strong>{C.horse(c.horse + 1)}</strong>
                    <span>{choiceLabel(t, c, mySeat!.horses[c.horse], name)}</span>
                  </span>
                  <kbd className="cn-key">{c.horse + 1}</kbd>
                </button>
              ))}
            </div>
          )}
          {myTurn && <p className="cn-keys-hint muted small">{C.keysHint}</p>}
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

