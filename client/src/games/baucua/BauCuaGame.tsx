import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BAUCUA_SYMBOLS, BC_CHIP_VALUES, BC_SHAKE_MS, type BauCuaLogEntry, type BauCuaMove, type BauCuaSymbol, type BauCuaView, type RoomView } from '@vg/shared';
import { api } from '../../socket';
import { useI18n, type Strings } from '../../i18n';
import { Avatar } from '../../components/Avatar';
import { Ellipsis } from '../../components/Ellipsis';
import { toast } from '../../components/Toaster';
import { AbsentPlayersNote, ChatCard, PlayersCard, RoomCodeCard, ScoreboardPanel } from '../../components/RoomPanels';
import { RulesButton } from '../../components/RulesDialog';
import { ExitIcon, PlayIcon, TrophyIcon } from '../../components/icons';
import { playSound } from '../../sound';
import { freshEntries } from '../freshLog';
import { useSettledView } from '../useSettledView';

interface Props {
  room: RoomView;
  view: BauCuaView;
  onLeave: () => void;
}

export const SYMBOL_ICON: Record<BauCuaSymbol, string> = { nai: '🦌', bau: '🍐', ga: '🐓', ca: '🐟', cua: '🦀', tom: '🦐' };
const SEAT_COLORS = ['#d64541', '#2e86de', '#27ae60', '#e67e22', '#8e44ad', '#16a085', '#c0392b', '#2c3e50', '#d35400', '#7f8c8d'];

function useTicker(active: boolean, ms = 250) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

function Countdown({ ms, since, total }: { ms: number; since: number; total: number }) {
  useTicker(true);
  const left = Math.max(0, ms - (performance.now() - since));
  return (
    <>
      <span className={`tl-seconds ${left < 5000 ? 'wc-urgent' : ''}`}>{Math.ceil(left / 1000)}s</span>
      <div className="tl-bar bc-bar" style={{ '--left': Math.min(1, left / total) } as CSSProperties} />
    </>
  );
}

function describe(t: Strings, e: BauCuaLogEntry, name: (id: string) => string): string {
  const L = t.baucua.log;
  switch (e.kind) {
    case 'round':
      return L.round(e.round);
    case 'roll':
      return L.roll(e.dice.map((d) => `${SYMBOL_ICON[d]} ${t.baucua.symbols[d]}`).join(' – '));
    case 'result':
      return e.net === 0 ? L.even(name(e.player)) : L.result(name(e.player), t.typhu.money(Math.abs(e.net)), e.net > 0);
    case 'left':
      return L.left(name(e.player));
    case 'bank':
      return e.net === 0 ? L.bankEven(name(e.player)) : L.bank(name(e.player), t.typhu.money(Math.abs(e.net)), e.net > 0);
    case 'bank-broke':
      return L.bankBroke(name(e.player));
  }
}

export function BauCuaGame({ room, view, onLeave }: Props) {
  const { t } = useI18n();
  const B = t.baucua;
  const money = t.typhu.money;
  const me = room.you;
  const mySeat = view.seats.find((s) => s.id === me);
  const isHost = room.hostId === me;
  const iBank = view.dealerId === me;
  const name = (id: string) => (id === me ? t.room.you : ([...room.players, ...room.departed].find((p) => p.id === id)?.name ?? '…'));
  const player = (id: string) => room.players.find((p) => p.id === id);
  const color = (id: string) => SEAT_COLORS[Math.max(0, view.seats.findIndex((s) => s.id === id)) % SEAT_COLORS.length];
  const receivedAt = useMemo(() => performance.now(), [room]);
  const [chip, setChip] = useState(BC_CHIP_VALUES[1]);
  // Chip counts, history and log as the screen has shown them: nothing of a roll until the bowl lifts.
  const settled = useSettledView(view, (prev, next) => (freshEntries(prev.log, next.log).some((e) => e.kind === 'roll') ? BC_SHAKE_MS : 0));

  // The bowl shakes for a moment before it lifts on each new roll.
  const [shaking, setShaking] = useState(false);
  const [floats, setFloats] = useState<{ id: string; net: number; key: number }[]>([]);
  const seenLog = useRef(view.log);
  // Every room update (a chat line, someone's presence) brings a new log array, so these timers
  // must outlive the effect; they're only cleared when the screen goes away.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    const fresh = freshEntries(seenLog.current, view.log);
    seenLog.current = view.log;
    if (!fresh.some((e) => e.kind === 'roll')) return;
    setShaking(true);
    playSound('move');
    // Players' results and the banker's, for the floating +/− and the sound.
    const results = fresh.flatMap((e) => (e.kind === 'result' || e.kind === 'bank' ? [{ player: e.player, net: e.net }] : []));
    timers.current.push(
      setTimeout(() => {
        setShaking(false);
        playSound(results.some((r) => r.player === me && r.net > 0) ? 'end' : 'capture');
        setFloats(results.map((r) => ({ id: r.player, net: r.net, key: Date.now() + Math.random() })));
      }, BC_SHAKE_MS),
      setTimeout(() => setFloats([]), BC_SHAKE_MS + 2600),
    );
  }, [view.log]);

  async function send(move: BauCuaMove) {
    const r = await api.move(move);
    if (!r.ok) toast(t.errors[r.error]);
  }

  async function rematch() {
    const r = isHost ? await api.start() : await api.rematch();
    if (!r.ok) toast(t.errors[r.error]);
  }

  const betting = view.phase === 'bet' && !view.result && !!mySeat && !mySeat.out && !mySeat.ready && !iBank;
  const shown = view.phase === 'reveal' && !shaking ? view.dice : null;
  const hitsOf = (s: BauCuaSymbol) => (shown ? shown.filter((d) => d === s).length : 0);
  const myBets = view.bets[me] ?? {};
  const myPlace = view.result ? view.result.ranking.indexOf(me) + 1 : 0;

  let status: string;
  if (view.result) status = B.resultTitle;
  else if (view.phase === 'reveal') status = shaking ? B.shaking : B.revealed;
  else if (!mySeat || mySeat.out) status = B.round(view.round, view.rounds);
  else if (iBank) status = B.youBank;
  else if (mySeat.chips + mySeat.staked === 0) status = B.noChips;
  else if (mySeat.ready) status = B.waitingOthers;
  else status = B.betPrompt;

  return (
    <div className="tl-layout bc-layout">
      <aside className="game-left">
        <RoomCodeCard code={room.code} />
        <PlayersCard
          room={room}
          colorOf={color}
          subtitle={(id) => {
            const seat = settled.seats.find((s) => s.id === id);
            if (!seat) return null;
            const float = floats.find((f) => f.id === id);
            return (
              <>
                🪙 {money(seat.chips)}
                {id === view.dealerId && <span className="tag tag-gold bc-ready">🎩 {B.bankerTag}</span>}
                {seat.staked > 0 && view.phase === 'bet' && ` · ${B.staked} ${money(seat.staked)}`}
                {seat.ready && view.phase === 'bet' && <span className="tag tag-gold bc-ready">{B.readyTag}</span>}
                {float && (
                  <span key={float.key} className={`bc-float ${float.net >= 0 ? 'up' : 'down'}`}>
                    {float.net >= 0 ? '+' : '−'}
                    {money(Math.abs(float.net))}
                  </span>
                )}
              </>
            );
          }}
        />
        <RulesButton gameType="baucua" wide />
        <button className="btn btn-ghost" onClick={onLeave}>
          <ExitIcon /> {t.room.leave}
        </button>
      </aside>

      <section className="tl-main">
        <div className="card bc-table">
          <header className="bc-head">
            <strong>{B.round(view.round, view.rounds)}</strong>
            <ol className="bc-history" aria-label={B.history}>
              {settled.history.slice(-6).map((dice, i) => (
                <li key={i}>{dice.map((d) => SYMBOL_ICON[d]).join('')}</li>
              ))}
            </ol>
          </header>

          {/* The plate and bowl: the bowl covers the dice while betting, shakes, then lifts. */}
          <div className={`bc-plate ${shaking ? 'shaking' : ''} ${shown ? 'open' : ''}`} aria-label={B.plate}>
            <div className="bc-dice">
              {(shown ?? [null, null, null]).map((d, i) => (
                <span key={i} className="bc-die" style={{ '--i': i } as CSSProperties}>
                  {d ? SYMBOL_ICON[d] : ''}
                </span>
              ))}
            </div>
            <div className="bc-bowl" aria-hidden="true" />
          </div>

          <div className="bc-board">
            {BAUCUA_SYMBOLS.map((s) => {
              const bets = view.seats.filter((seat) => (view.bets[seat.id]?.[s] ?? 0) > 0);
              const hits = hitsOf(s);
              return (
                <button
                  key={s}
                  type="button"
                  className={`bc-tile sym-${s} ${hits ? 'hit' : shown ? 'miss' : ''}`}
                  disabled={!betting || (mySeat?.chips ?? 0) < chip}
                  onClick={() => send({ type: 'bet', symbol: s, amount: chip })}
                >
                  <span className="bc-icon">{SYMBOL_ICON[s]}</span>
                  <span className="bc-name">{B.symbols[s]}</span>
                  {hits > 0 && <span className="bc-hits">{B.hits(hits)}</span>}
                  {(myBets[s] ?? 0) > 0 && <span className="bc-mine">{money(myBets[s]!)}</span>}
                  <span className="bc-stakes">
                    {bets
                      .filter((seat) => seat.id !== me)
                      .map((seat) => (
                        <span key={seat.id} className="bc-stake" style={{ '--owner': color(seat.id) } as CSSProperties} title={`${name(seat.id)} · ${money(view.bets[seat.id]![s]!)}`}>
                          {money(view.bets[seat.id]![s]!)}
                        </span>
                      ))}
                  </span>
                </button>
              );
            })}
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
                  <h2>{myPlace === 1 ? B.youWon : myPlace ? B.youPlaced(myPlace) : B.resultTitle}</h2>
                  <p className="muted">{B.winnerIs(name(view.result.ranking[0]), money(view.result.chips[view.result.ranking[0]]))}</p>
                </header>
                <ol className="tl-podium">
                  {view.result.ranking.map((id, i) => (
                    <li key={id} className={`medal-${i === view.result!.ranking.length - 1 ? 'last' : i + 1} ${id === me ? 'me' : ''}`}>
                      <span className="tl-medal">{i + 1}</span>
                      <Avatar id={id} name={player(id)?.name ?? name(id)} size={38} color={color(id)} />
                      <span className="tl-podium-text">
                        <strong>{name(id)}</strong>
                      </span>
                      <span className="tl-points up">🪙 {money(view.result!.chips[id])}</span>
                    </li>
                  ))}
                </ol>
                <div className="tl-result-actions">
                  {mySeat ? (
                    <button className="btn btn-primary" disabled={!isHost && room.rematchVotes.includes(me)} onClick={rematch}>
                      <PlayIcon /> {isHost ? t.room.playAgain : room.rematchVotes.includes(me) ? t.room.rematchRequested : t.room.requestRematch}
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

        <div className={`tl-me card bc-me ${betting ? 'turn' : ''}`}>
          <div className="tl-me-head">
            {mySeat && <Avatar id={me} name={player(me)?.name ?? '?'} size={36} color={color(me)} />}
            <p className="tl-status">
              <Ellipsis text={status} />
            </p>
            {view.phase === 'bet' && !view.result && <Countdown key={view.round} ms={view.msLeft} since={receivedAt} total={20_000} />}
          </div>
          <AbsentPlayersNote room={room} />
          {mySeat && !mySeat.out && !view.result && !iBank && (
            <div className="bc-controls">
              <div className="chip-group" role="group" aria-label={B.chipValue}>
                {BC_CHIP_VALUES.map((v) => (
                  <button key={v} className={`bc-chip v${v}`} aria-pressed={chip === v} disabled={!betting || mySeat.chips < v} onClick={() => setChip(v)}>
                    {v}
                  </button>
                ))}
              </div>
              <span className="bc-wallet">
                🪙 {money(settled.seats.find((s) => s.id === me)?.chips ?? mySeat.chips)}
                {mySeat.staked > 0 && view.phase === 'bet' && <span className="muted"> · {B.staked} {money(mySeat.staked)}</span>}
              </span>
              <button className="btn btn-ghost" disabled={!betting || mySeat.staked === 0} onClick={() => send({ type: 'clear' })}>
                {B.clear}
              </button>
              <button className="btn btn-primary" disabled={!betting} onClick={() => send({ type: 'ready' })}>
                🎲 {B.ready}
              </button>
            </div>
          )}
        </div>
      </section>

      <aside className="game-right">
        <section className="card panel tl-log-panel open">
          <h2>{B.logTitle}</h2>
          <ol className="tl-log">
            {settled.log.slice(-14).map((e, i) =>
              e.kind === 'round' ? (
                <li key={i} className="tl-log-round">
                  {describe(t, e, name)}
                </li>
              ) : (
                <li key={i} className={`tl-log-row ${'player' in e && e.player === me ? 'mine' : ''} ${e.kind === 'result' ? (e.net > 0 ? 'finish' : e.net < 0 ? 'pass' : '') : ''}`}>
                  <span className="tl-log-text">{describe(t, e, name)}</span>
                </li>
              ),
            )}
          </ol>
        </section>
        <ScoreboardPanel room={room} />
        <ChatCard room={room} />
      </aside>
    </div>
  );
}
