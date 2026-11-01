import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { LOTO_BUY_MS, LOTO_COLORS, LOTO_KINH_MS, LOTO_MAX, lotoColor, rowNumbers, type LotoLogEntry, type LotoMove, type LotoTicket, type LotoView, type RoomView } from '@vg/shared';
import { api } from '../../socket';
import { useI18n, type Strings } from '../../i18n';
import { Avatar } from '../../components/Avatar';
import { Ellipsis } from '../../components/Ellipsis';
import { toast } from '../../components/Toaster';
import { AbsentPlayersNote, ChatCard, PlayersCard, RoomCodeCard, ScoreboardPanel } from '../../components/RoomPanels';
import { RulesButton } from '../../components/RulesDialog';
import { ChevronRightIcon, ExitIcon, PlayIcon, TrophyIcon } from '../../components/icons';
import { audioContext, isSoundOn, playSound } from '../../sound';
import { loadCalls, sayNumber } from './voice';
import { freshEntries } from '../freshLog';
import { loadSetting, saveSetting } from '../../settings';

interface Props {
  room: RoomView;
  view: LotoView;
  onLeave: () => void;
}

// The printed set's eight ticket colours, in set order (tickets 2k and 2k + 1 are colour k, see
// LOTO_COLOR_IDS: pink, red, orange, yellow, green, lime, blue, purple), and the ink for labels on them.
export const TICKET_COLORS = ['#e8478c', '#e8473a', '#f37b2b', '#f2cb27', '#3cae4a', '#a3cb3b', '#1f9ad6', '#8f4bc9'];
const TICKET_INK = ['#fff', '#fff', '#fff', '#3a2a00', '#fff', '#253500', '#fff', '#fff'];

const SEAT_COLORS = ['#d64541', '#2e86de', '#27ae60', '#e67e22', '#8e44ad', '#16a085', '#c0392b', '#2c3e50'];
const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

// How a caller reads a number out in Vietnamese: 21 "hai mươi mốt", 25 "hai mươi lăm", 24 "hai mươi tư".
export function vietnameseNumber(n: number): string {
  if (n < 10) return DIGITS[n];
  const tens = Math.floor(n / 10);
  const unit = n % 10;
  const head = tens === 1 ? 'mười' : `${DIGITS[tens]} mươi`;
  if (unit === 0) return head;
  if (unit === 1) return tens === 1 ? 'mười một' : `${head} mốt`;
  if (unit === 5) return `${head} lăm`;
  if (unit === 4 && tens > 1) return `${head} tư`;
  return `${head} ${DIGITS[unit]}`;
}

function useTicker(active: boolean, ms = 200) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

function describe(t: Strings, e: LotoLogEntry, name: (id: string) => string): string {
  const L = t.loto.log;
  switch (e.kind) {
    case 'buy':
      return L.buy(name(e.player), e.tickets.map((tk) => t.loto.ticketName(t.loto.colors[lotoColor(tk)], (tk % 2) + 1)).join(', '));
    case 'call':
      return L.call(e.number, e.count);
    case 'kinh':
      return L.kinh(name(e.player), e.row.join(' – '));
    case 'bust':
      return L.bust(name(e.player));
    case 'left':
      return L.left(name(e.player));
  }
}

// A ticket of the set, in its colour: "Đỏ 1" and "Đỏ 2" are the red pair.
function Ticket({ ticket, id, marked, onMark, highlight }: { ticket: LotoTicket; id: number; marked: (n: number) => boolean; onMark: (n: number) => void; highlight: Set<number> | null }) {
  const { t } = useI18n();
  const label = t.loto.ticketName(t.loto.colors[lotoColor(id)], (id % 2) + 1);
  return (
    <section className="lt-ticket" style={{ '--lt-color': TICKET_COLORS[lotoColor(id)], '--lt-ink': TICKET_INK[lotoColor(id)] } as CSSProperties} aria-label={label}>
      <header className="lt-ticket-head">{label}</header>
      <div className="lt-grid">
        {ticket.map((row, r) => {
          const full = rowNumbers(ticket, r).every(marked);
          return (
            <div key={r} className={`lt-row ${full ? 'full' : ''} ${r % 3 === 2 ? 'block-end' : ''}`}>
              {row.map((n, c) =>
                n === null ? (
                  <span key={c} className="lt-cell blank" />
                ) : (
                  <button key={c} type="button" className={`lt-cell ${marked(n) ? 'marked' : ''} ${highlight?.has(n) ? 'win' : ''}`} onClick={() => onMark(n)}>
                    {n}
                  </button>
                ),
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function LotoGame({ room, view, onLeave }: Props) {
  const { t } = useI18n();
  const T = t.loto;
  const money = t.typhu.money;
  const me = room.you;
  const mySeat = view.seats.find((s) => s.id === me);
  const isHost = room.hostId === me;
  const name = (id: string) => (id === me ? t.room.you : ([...room.players, ...room.departed].find((p) => p.id === id)?.name ?? '…'));
  const player = (id: string) => room.players.find((p) => p.id === id);
  const color = (id: string) => SEAT_COLORS[Math.max(0, view.seats.findIndex((s) => s.id === id)) % SEAT_COLORS.length];
  const receivedAt = useMemo(() => performance.now(), [room]);
  useTicker(!view.result);
  const msLeft = Math.max(0, view.msLeft - (performance.now() - receivedAt));

  // Dò số: marks are yours alone, kept on this screen; or let the game mark called numbers for you.
  const [auto, setAuto] = useState(() => loadSetting('vg:loto-auto') === 'on');
  const [voiceOn, setVoiceOn] = useState(() => loadSetting('vg:loto-voice') !== 'off');
  // The caller's recorded voice, loaded once when the screen opens.
  const [calls, setCalls] = useState<Awaited<ReturnType<typeof loadCalls>>>(null);
  useEffect(() => {
    let live = true;
    void loadCalls().then((c) => live && setCalls(c));
    return () => {
      live = false;
    };
  }, []);
  const [marks, setMarks] = useState<Set<number>>(new Set());
  // Your tickets this game; new tickets (or a new game) start unmarked.
  const myTickets = view.mine.map((id) => view.set[id]);
  const ticketsKey = `${view.mine.join(',')}|${view.set[0]?.flat().join(',')}`;
  useEffect(() => setMarks(new Set()), [ticketsKey]);
  const called = useMemo(() => new Set(view.called), [view.called]);
  const marked = (n: number) => (auto ? called.has(n) : marks.has(n));
  function toggleMark(n: number) {
    if (auto) return;
    setMarks((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }

  // Each new number: read it out, or a tick if the voice is off or couldn't load.
  const seenLog = useRef(view.log);
  useEffect(() => {
    const fresh = freshEntries(seenLog.current, view.log);
    seenLog.current = view.log;
    const call = fresh.filter((e) => e.kind === 'call').at(-1);
    if (call && call.kind === 'call') {
      if (!(voiceOn && sayNumber(calls, call.number))) playSound('move');
    }
    if (fresh.some((e) => e.kind === 'kinh')) playSound('end');
    if (fresh.some((e) => e.kind === 'bust')) playSound('capture');
  }, [view.log]);

  // The log folds away like the other games' logs, remembered per browser; folded, it shows the
  // latest line. Open, it keeps scrolled to the newest entry.
  const [logOpen, setLogOpen] = useState(() => loadSetting('vg:ltLog') !== 'closed');
  function toggleLog() {
    saveSetting('vg:ltLog', logOpen ? 'closed' : 'open');
    setLogOpen(!logOpen);
  }
  const logRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [view.log.length, logOpen]);

  async function send(move: LotoMove) {
    const r = await api.move(move);
    if (!r.ok) toast(t.errors[r.error]);
    return r.ok;
  }
  // Picking: tap a free ticket to add it (two at most), tap one of yours to put it back, or take
  // both of a colour in one go. The server has the last word on who holds what.
  function pick(tickets: number[]) {
    void send({ type: 'pick', tickets });
  }
  function tapTicket(tk: number) {
    if (view.mine.includes(tk)) return pick(view.mine.filter((x) => x !== tk));
    if (view.mine.length >= 2) return toast(T.twoMax);
    pick([...view.mine, tk]);
  }
  async function rematch() {
    const r = isHost ? await api.start() : await api.rematch();
    if (!r.ok) toast(t.errors[r.error]);
  }

  const wallet = room.wallets ? (room.wallets[me] ?? room.options.walletStart) : null;
  const buying = view.phase === 'buy' && !view.result && !!mySeat && !mySeat.out && !mySeat.ready;
  const playing = view.phase !== 'buy' && !view.result && !!mySeat && view.mine.length > 0 && !mySeat.busted && !mySeat.won;
  const rowReady = myTickets.some((tk) => tk.some((_, r) => rowNumbers(tk, r).every(marked)));
  const canAfford = (n: number) => wallet === null || wallet >= n * view.price;
  const last = view.called.at(-1);
  const winRows = new Set(view.winners.filter((w) => w.player === me).flatMap((w) => w.numbers));
  const myResult = view.result?.nets[me];

  let status: string;
  if (view.result) status = view.result.winners.length ? T.winnersAre(view.result.winners.map((w) => name(w.player)).join(', ')) : T.noWinner;
  else if (view.phase === 'buy') status = !mySeat || mySeat.out ? T.buyingOthers : mySeat.ready ? T.waitingOthers : T.buyPrompt;
  else if (view.phase === 'kinh') status = T.kinhCalled(view.winners.map((w) => name(w.player)).join(', '));
  else if (mySeat?.busted) status = T.busted;
  else if (!view.mine.length) status = T.watching;
  else status = auto ? T.autoHint : T.markHint;

  return (
    // Phones keep audio asleep until the page is touched: any tap here wakes it for the calls.
    <div className="tl-layout lt-layout" onPointerDown={() => audioContext()}>
      <aside className="game-left">
        <RoomCodeCard code={room.code} />
        <PlayersCard
          room={room}
          colorOf={color}
          subtitle={(id) => {
            const seat = view.seats.find((s) => s.id === id);
            if (!seat) return null;
            return (
              <>
                {seat.tickets.map((tk) => (
                  <span key={tk} className="lt-dot" style={{ background: TICKET_COLORS[lotoColor(tk)] }} title={T.ticketName(T.colors[lotoColor(tk)], (tk % 2) + 1)} />
                ))}
                {seat.ready && view.phase === 'buy' && <span className="tag tag-gold bc-ready">{t.baucua.readyTag}</span>}
                {seat.won && <span className="tag tag-gold bc-ready">🎉 {T.kinhTag}</span>}
                {seat.busted && <span className="tag tag-danger bc-ready">{T.bustTag}</span>}
              </>
            );
          }}
        />
        <RulesButton gameType="loto" wide />
        <button className="btn btn-ghost" onClick={onLeave}>
          <ExitIcon /> {t.room.leave}
        </button>
      </aside>

      <section className="tl-main">
        <div className="card lt-caller">
          <div className="lt-ball-wrap">
            <span key={last ?? 'none'} className={`lt-ball ${last === undefined ? 'empty' : ''}`} aria-live="polite">
              {last ?? '?'}
            </span>
            <div className="lt-caller-text">
              <strong>{last === undefined ? (view.phase === 'buy' ? T.buyTitle : T.firstSoon) : T.callCount(view.called.length, LOTO_MAX)}</strong>
              {last !== undefined && <span className="muted">{vietnameseNumber(last)}</span>}
            </div>
            <div className="lt-toggles">
              <label className="lt-toggle">
                <input
                  type="checkbox"
                  checked={voiceOn}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setVoiceOn(on);
                    saveSetting('vg:loto-voice', on ? 'on' : 'off');
                    if (!on) return;
                    // A sample right away (which also wakes audio on phones).
                    if (!isSoundOn()) return toast(T.soundOff);
                    void loadCalls().then((c) => sayNumber(c, view.called.at(-1) ?? 1));
                  }}
                />
                🔊 {T.voice}
              </label>
              <label className="lt-toggle">
                <input
                  type="checkbox"
                  checked={auto}
                  onChange={(e) => {
                    setAuto(e.target.checked);
                    saveSetting('vg:loto-auto', e.target.checked ? 'on' : 'off');
                  }}
                />
                ✅ {T.auto}
              </label>
            </div>
          </div>
          {!view.result && <div className="tl-bar" style={{ '--left': Math.min(1, msLeft / (view.phase === 'call' ? view.callMs : view.phase === 'kinh' ? LOTO_KINH_MS : LOTO_BUY_MS)) } as CSSProperties} />}
          <ol className="lt-board" aria-label={T.board}>
            {Array.from({ length: LOTO_MAX }, (_, i) => i + 1).map((n) => (
              <li key={n} className={`${called.has(n) ? 'called' : ''} ${n === last ? 'last' : ''}`}>
                {n}
              </li>
            ))}
          </ol>
        </div>

        <div className={`tl-me card lt-me ${buying || (playing && rowReady) ? 'turn' : ''}`}>
          <div className="tl-me-head">
            {mySeat && <Avatar id={me} name={player(me)?.name ?? '?'} size={36} color={color(me)} />}
            <p className="tl-status">
              <Ellipsis text={status} />
            </p>
            {view.phase === 'buy' && !view.result && <span className="tl-seconds">{Math.ceil(msLeft / 1000)}s</span>}
          </div>
          <AbsentPlayersNote room={room} />
          {buying && (
            <div className="lt-pick">
              <ol className="lt-colors">
                {Array.from({ length: LOTO_COLORS }, (_, k) => {
                  const pair = [2 * k, 2 * k + 1];
                  const pairFree = pair.every((tk) => view.holders[tk] === undefined || view.holders[tk] === me);
                  const minePair = pair.every((tk) => view.mine.includes(tk));
                  return (
                    <li key={k} className="lt-color" style={{ '--lt-color': TICKET_COLORS[k] } as CSSProperties}>
                      <strong>{T.colors[k]}</strong>
                      <div className="lt-color-tickets">
                        {pair.map((tk) => {
                          const holder = view.holders[tk];
                          const mineNow = holder === me;
                          return (
                            <button
                              key={tk}
                              type="button"
                              className={`lt-pick-ticket ${mineNow ? 'mine' : ''}`}
                              aria-pressed={mineNow}
                              disabled={(holder !== undefined && !mineNow) || (!mineNow && !canAfford(view.mine.length + 1))}
                              onClick={() => tapTicket(tk)}
                              title={holder && !mineNow ? name(holder) : undefined}
                            >
                              {holder && !mineNow ? <Avatar id={holder} name={player(holder)?.name ?? name(holder)} size={20} color={color(holder)} /> : `${(tk % 2) + 1}`}
                            </button>
                          );
                        })}
                      </div>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={!pairFree || minePair || !canAfford(2)} onClick={() => pick(pair)}>
                        {T.takePair}
                      </button>
                    </li>
                  );
                })}
              </ol>
              <div className="bc-controls">
                <span className="muted small">{view.mine.length ? T.picked(view.mine.length, room.wallets ? money(view.mine.length * view.price) : null) : T.pickHint}</span>
                <button className="btn btn-primary" disabled={!view.mine.length} onClick={() => send({ type: 'ready' })}>
                  🎫 {T.done}
                </button>
              </div>
            </div>
          )}
          {playing && (
            <button className={`btn btn-primary btn-lg lt-kinh ${rowReady ? 'ready' : ''}`} onClick={() => send({ type: 'kinh' })}>
              📣 {T.kinh}
            </button>
          )}
          {view.mine.length > 0 && (
            <div className={`lt-tickets count-${view.mine.length}`}>
              {view.mine.map((id) => (
                <Ticket key={id} ticket={view.set[id]} id={id} marked={marked} onMark={toggleMark} highlight={winRows.size ? winRows : null} />
              ))}
            </div>
          )}
        </div>

        {view.result && (
          <div className="tl-result">
            <div className={`tl-result-card ${view.result.winners.some((w) => w.player === me) ? 'won' : ''}`}>
              {view.result.winners.some((w) => w.player === me) && (
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
                <h2>{view.result.winners.some((w) => w.player === me) ? T.youWon : T.resultTitle}</h2>
                <p className="muted">{status}</p>
              </header>
              <ol className="tl-podium">
                {view.winners.map((w) => (
                  <li key={`${w.player}-${w.ticket}-${w.row}`} className={`medal-1 ${w.player === me ? 'me' : ''}`}>
                    <Avatar id={w.player} name={player(w.player)?.name ?? name(w.player)} size={38} color={color(w.player)} />
                    <span className="tl-podium-text">
                      <strong>{name(w.player)}</strong>
                      <span className="muted small">{w.numbers.join(' – ')}</span>
                    </span>
                    <span className="tl-points up">+{room.wallets ? money(view.result!.nets[w.player]) : T.ticketCount(view.result!.nets[w.player])}</span>
                  </li>
                ))}
              </ol>
              {myResult !== undefined && myResult < 0 && <p className="muted">{T.youPaid(room.wallets ? money(-myResult) : T.ticketCount(-myResult))}</p>}
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
      </section>

      <aside className="game-right">
        <section className={`card panel tl-log-panel ${logOpen ? 'open' : 'closed'}`}>
          <button className="panel-toggle" aria-expanded={logOpen} aria-controls="lt-log" onClick={toggleLog} title={logOpen ? T.hideLog : T.showLog}>
            <h2>{T.logTitle}</h2>
            <ChevronRightIcon className="panel-chevron" />
          </button>
          {view.log.length === 0 ? null : logOpen ? (
            <ol className="tl-log" id="lt-log" ref={logRef}>
              {view.log.map((e, i) => (
                <li key={i} className={`tl-log-row ${'player' in e && e.player === me ? 'mine' : ''} ${e.kind === 'kinh' ? 'finish' : e.kind === 'bust' ? 'chop' : ''}`}>
                  <span className="tl-log-text">{describe(t, e, name)}</span>
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
