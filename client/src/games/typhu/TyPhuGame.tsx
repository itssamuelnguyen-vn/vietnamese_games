import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  AIRPORT_FEE,
  BOARD,
  LOAN_STEP,
  bizPrice,
  eventFactor,
  freeTypes,
  upgradable,
  upgradePrice,
  visitFee,
  type Business,
  type BizType,
  type RoomView,
  type Square,
  type TradeOffer,
  type TyPhuLogEntry,
  type TyPhuMove,
  type TyPhuView,
} from '@vg/shared';
import { api } from '../../socket';
import { useI18n, type Strings } from '../../i18n';
import { Avatar, initials } from '../../components/Avatar';
import { Ellipsis } from '../../components/Ellipsis';
import { toast } from '../../components/Toaster';
import { ChatCard, PlayersCard, RoomCodeCard, ScoreboardPanel } from '../../components/RoomPanels';
import { RulesButton } from '../../components/RulesDialog';
import { ChevronRightIcon, CloseIcon, ExitIcon, PlayIcon, TrophyIcon } from '../../components/icons';
import { loadSetting, saveSetting } from '../../settings';
import { playSound } from '../../sound';

interface Props {
  room: RoomView;
  view: TyPhuView;
  onLeave: () => void;
}

// The road winds across the board in rows of seven, alternating direction.
const COLS = 7;
function cellOf(i: number) {
  const row = Math.floor(i / COLS);
  return { row, col: row % 2 === 0 ? i % COLS : COLS - 1 - (i % COLS) };
}

const BIZ_ICON: Record<BizType, string> = { food: '🍜', inn: '🏨', shop: '🛍️' };
const SPECIAL_ICON: Record<string, string> = { start: '🚌', market: '🧺', rest: '☕', bank: '🏦', airport: '✈️', festival: '🎉' };
const SEAT_COLORS = ['#d64541', '#2e86de', '#27ae60', '#e67e22', '#8e44ad', '#16a085'];

function squareName(t: Strings, sq: Square): string {
  return sq.kind === 'province' ? t.typhu.provinces[sq.id] : t.typhu.specials[sq.kind];
}

// Re-renders periodically while `active`, for countdowns.
function useTicker(active: boolean, ms = 250) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

// Shows each token walking square by square after a roll or a move card.
function useShownPositions(view: TyPhuView): Record<string, number> {
  const target = useMemo(() => Object.fromEntries(view.seats.map((s) => [s.id, s.position])), [view.seats]);
  const [shown, setShown] = useState(target);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const key = view.seats.map((s) => s.position).join(',') + JSON.stringify(view.lastMove);
  useEffect(() => {
    const move = view.lastMove;
    const walking = move && move.value > 0 && shownRef.current[move.player] === move.from && target[move.player] === move.to;
    if (!walking) {
      setShown(target);
      return;
    }
    let pos = move.from;
    setShown({ ...target, [move.player]: pos });
    const id = setInterval(() => {
      pos = (pos + 1) % BOARD.length;
      setShown((s) => ({ ...s, [move.player]: pos }));
      if (pos === move.to) clearInterval(id);
    }, 120);
    return () => clearInterval(id);
  }, [key]);
  return shown;
}

function Die({ value }: { value: number }) {
  const pips: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  return (
    <span className="tp-die" aria-label={String(value)}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={pips[value]?.includes(i) ? 'pip' : ''} />
      ))}
    </span>
  );
}

function describe(t: Strings, e: TyPhuLogEntry, name: (id: string) => string): string {
  const L = t.typhu.log;
  const m = t.typhu.money;
  const place = (i: number) => squareName(t, BOARD[i]);
  switch (e.kind) {
    case 'roll':
      return (e.auto ? L.autoRoll : L.roll)(name(e.player), e.dice[0], e.dice[1], place(e.to));
    case 'card':
      return L.card(name(e.player), e.value, place(e.to));
    case 'pay':
      return L.pay(name(e.player), m(e.total), place(e.square));
    case 'buy':
      return L.buy(name(e.player), t.typhu.biz[e.biz], place(e.square), m(e.price));
    case 'upgrade':
      return L.upgrade(name(e.player), t.typhu.biz[e.biz], place(e.square), e.level);
    case 'market':
      return L.market(name(e.player), e.value);
    case 'bank':
      return L.bank(name(e.player), e.bonus === null ? null : m(e.bonus));
    case 'fly':
      return L.fly(name(e.player), place(e.to));
    case 'festival':
      return L.festival(name(e.player), m(e.total));
    case 'loan':
      return (e.auto ? L.autoLoan : L.loan)(name(e.player), m(e.amount));
    case 'repay':
      return L.repay(name(e.player), m(e.amount));
    case 'interest':
      return L.interest(name(e.player), m(e.amount));
    case 'trade':
      return L.trade(name(e.from), name(e.to));
    case 'month':
      return L.month(e.month, t.typhu.events[e.event]);
    case 'left':
      return L.left(name(e.player));
  }
}

export function TyPhuGame({ room, view, onLeave }: Props) {
  const { t } = useI18n();
  const T = t.typhu;
  const money = T.money;
  const me = room.you;
  const mySeat = view.seats.find((s) => s.id === me);
  const seated = !!mySeat && !mySeat.out;
  const myTurn = view.turn === me && !view.result;
  const isHost = room.hostId === me;
  const name = (id: string) => (id === me ? t.room.you : ([...room.players, ...room.departed].find((p) => p.id === id)?.name ?? '…'));
  const player = (id: string) => room.players.find((p) => p.id === id);
  const color = (id: string) => {
    const i = view.seats.findIndex((s) => s.id === id);
    return i < 0 ? undefined : SEAT_COLORS[i % SEAT_COLORS.length];
  };
  const initial = (id: string) => initials(player(id)?.name ?? name(id));
  const bizLabel = (b: Business) => `${BIZ_ICON[b.type]} ${T.biz[b.type]} · ${squareName(t, BOARD[b.square])} (${T.level(b.level)})`;

  const shown = useShownPositions(view);
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  const [tradeOpen, setTradeOpen] = useState(false);

  const receivedAt = useMemo(() => performance.now(), [room]);
  useTicker(!view.result && (view.turnMs !== null || view.offers.length > 0));
  const elapsed = () => performance.now() - receivedAt;
  const turnLeft = view.turnMs === null ? null : Math.max(0, view.turnMs - elapsed());
  const turnFraction = turnLeft !== null && view.turnLimitMs ? turnLeft / view.turnLimitMs : null;

  async function send(move: TyPhuMove) {
    const r = await api.move(move);
    if (!r.ok) toast(t.errors[r.error]);
    return r.ok;
  }

  async function rematch() {
    const r = isHost ? await api.start() : await api.rematch();
    if (!r.ok) toast(t.errors[r.error]);
  }

  // Sounds for moves, our turn and the end of the game.
  const seenLog = useRef(view.log.length);
  useEffect(() => {
    const fresh = view.log.slice(seenLog.current);
    seenLog.current = view.log.length;
    if (fresh.some((e) => e.kind === 'roll' || e.kind === 'card' || e.kind === 'fly')) playSound('move');
    else if (fresh.some((e) => e.kind === 'buy' || e.kind === 'upgrade' || e.kind === 'trade')) playSound('capture');
  }, [view.log]);
  useEffect(() => {
    if (myTurn) playSound('notify');
  }, [myTurn]);
  const incoming = view.offers.filter((o) => o.to === me);
  const incomingKey = incoming.map((o) => o.id).join(',');
  useEffect(() => {
    if (incomingKey) playSound('notify');
  }, [incomingKey]);
  const seenResult = useRef(view.result);
  useEffect(() => {
    if (view.result && !seenResult.current) playSound('end');
    seenResult.current = view.result;
  }, [view.result]);
  useEffect(() => {
    if (!myTurn) return;
    document.title = `● ${T.yourTurn} · ${t.appName}`;
    return () => {
      document.title = t.appName;
    };
  }, [myTurn, t]);

  const [logOpen, setLogOpen] = useState(() => loadSetting('vg:tpLog') !== 'closed');
  function toggleLog() {
    saveSetting('vg:tpLog', logOpen ? 'closed' : 'open');
    setLogOpen(!logOpen);
  }
  const logRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [view.log.length, logOpen]);

  const here = mySeat ? mySeat.position : 0;
  const hereSquare = BOARD[here];
  const cash = mySeat?.cash ?? 0;
  const flyTarget = myTurn && view.phase === 'fly' && selected !== null && BOARD[selected].kind !== 'airport' ? selected : null;
  const highlight = preview ?? flyTarget;

  function pickSquare(i: number) {
    setSelected((s) => (s === i && !(myTurn && view.phase === 'fly') ? null : i));
  }

  let status: string;
  if (view.result) status = T.resultTitle;
  else if (!seated) status = view.turn ? T.turnOf(name(view.turn)) : T.spectating;
  else if (!myTurn) status = view.turn ? T.turnOf(name(view.turn)) + '…' : '';
  else if (view.phase === 'move') status = T.movePrompt;
  else if (view.phase === 'fly') status = T.flyPrompt;
  else status = T.actPrompt(squareName(t, hereSquare));

  const myPlace = view.result ? view.result.ranking.indexOf(me) + 1 : 0;

  return (
    <div className="tl-layout tp-layout">
      <aside className="game-left">
        <RoomCodeCard code={room.code} />
        <PlayersCard
          room={room}
          colorOf={color}
          subtitle={(id) => {
            const seat = view.seats.find((s) => s.id === id);
            return (
              seat && (
                <>
                  <span className="tp-owner-dot" style={{ '--owner': color(id) } as CSSProperties} /> {T.worth} {money(seat.worth)}
                </>
              )
            );
          }}
        />
        <RulesButton gameType="typhu" wide />
        <button className="btn btn-ghost" onClick={onLeave}>
          <ExitIcon /> {t.room.leave}
        </button>
      </aside>

      <section className="tl-main">
        <div className="tp-calendar card">
          <div className="tp-month">
            <span className="tp-month-num">{T.month(view.month)}</span>
            {view.month === 12 && !view.result && <span className="tag tag-gold">{T.finalMonth}</span>}
          </div>
          <div className={`tp-event ev-${view.event}`}>
            <span className="eyebrow">{T.thisMonth}</span>
            <strong>{T.events[view.event]}</strong>
            <span className="muted small">{T.eventDetails[view.event]}</span>
          </div>
          {view.nextEvent && (
            <div className={`tp-event next ev-${view.nextEvent}`}>
              <span className="eyebrow">{T.nextMonth}</span>
              <strong>{T.events[view.nextEvent]}</strong>
              <span className="muted small">{T.eventDetails[view.nextEvent]}</span>
            </div>
          )}
        </div>

        <div className="tp-board-wrap">
          <div className={`tp-board ${myTurn && view.phase === 'fly' ? 'picking' : ''}`}>
            {BOARD.map((sq, i) => {
              const { row, col } = cellOf(i);
              const here = view.seats.filter((s) => !s.out && shown[s.id] === i);
              const businesses = view.businesses.filter((b) => b.square === i);
              const factor = sq.kind === 'province' ? eventFactor(view.event, sq) : 1;
              const turnEnd = col === (row % 2 === 0 ? COLS - 1 : 0) && i < BOARD.length - 1;
              return (
                <button
                  key={i}
                  type="button"
                  className={[
                    'tp-square',
                    sq.kind === 'province' ? `region-${sq.region}` : `special sp-${sq.kind}`,
                    highlight === i ? 'target' : '',
                    factor > 1 ? 'boost' : factor < 1 ? 'cut' : '',
                    selected === i ? 'selected' : '',
                    turnEnd ? (row % 2 === 0 ? 'bend-right' : 'bend-left') : '',
                  ].join(' ')}
                  style={{ gridRow: row + 1, gridColumn: col + 1 }}
                  onClick={() => pickSquare(i)}
                  aria-label={squareName(t, sq)}
                >
                  <span className="tp-sq-name">
                    {sq.kind !== 'province' && <span className="tp-sq-icon">{SPECIAL_ICON[sq.kind]}</span>}
                    {squareName(t, sq)}
                  </span>
                  {sq.kind === 'province' && (
                    <span className="tp-slots">
                      {Array.from({ length: sq.slots }, (_, k) => {
                        const b = businesses[k];
                        return b ? (
                          <span key={k} className="tp-slot taken" style={{ '--owner': color(b.owner) } as CSSProperties} title={`${name(b.owner)} · ${T.biz[b.type]} ${T.level(b.level)}`}>
                            {BIZ_ICON[b.type]}
                            {b.level > 1 && <sup>{b.level}</sup>}
                          </span>
                        ) : (
                          <span key={k} className="tp-slot" />
                        );
                      })}
                    </span>
                  )}
                  {here.length > 0 && (
                    <span className="tp-tokens">
                      {here.map((s) => (
                        <span
                          key={s.id}
                          className={`tp-token ${view.turn === s.id ? 'turn' : ''}`}
                          style={{ '--owner': color(s.id) } as CSSProperties}
                          title={name(s.id)}
                        >
                          {initial(s.id)}
                        </span>
                      ))}
                    </span>
                  )}
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
                  <h2>{myPlace === 1 ? T.youWon : myPlace ? T.youPlaced(myPlace) : T.resultTitle}</h2>
                </header>
                <ol className="tl-podium">
                  {view.result.ranking.map((id, i) => {
                    const seat = view.seats.find((s) => s.id === id)!;
                    const owned = view.businesses.filter((b) => b.owner === id).length;
                    const last = i === view.result!.ranking.length - 1;
                    return (
                      <li key={id} className={`medal-${last ? 'last' : i + 1} ${id === me ? 'me' : ''}`}>
                        <span className="tl-medal">{i + 1}</span>
                        <Avatar id={id} name={player(id)?.name ?? name(id)} size={38} color={color(id)} />
                        <span className="tl-podium-text">
                          <strong>{name(id)}</strong>
                          <span className="muted small">
                            {T.cash} {money(seat.cash)} · {T.debt} {money(seat.debt)} · 🏠 {owned}
                          </span>
                        </span>
                        <span className="tl-points up">{money(view.result!.worth[id])}</span>
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

        {selected !== null && (
          <SquareDetails
            index={selected}
            view={view}
            me={me}
            name={name}
            color={color}
            onClose={() => setSelected(null)}
            flyButton={
              flyTarget !== null && (
                <button className="btn btn-primary" disabled={cash < AIRPORT_FEE} onClick={() => send({ type: 'fly', to: flyTarget })}>
                  ✈️ {T.flyTo(squareName(t, BOARD[flyTarget]))}
                </button>
              )
            }
          />
        )}

        <div className={`tl-me card tp-me ${myTurn ? 'turn' : ''}`}>
          <div className="tl-me-head">
            {seated && <Avatar id={me} name={player(me)?.name ?? '?'} size={36} online color={color(me)} />}
            <p className="tl-status">
              <Ellipsis text={status} />
            </p>
            {view.lastMove?.dice && (
              <span className="tp-dice" key={JSON.stringify(view.lastMove)} title={name(view.lastMove.player)}>
                <Die value={view.lastMove.dice[0]} />
                <Die value={view.lastMove.dice[1]} />
              </span>
            )}
            {myTurn && turnLeft !== null && <span className="tl-seconds">{Math.ceil(turnLeft / 1000)}s</span>}
          </div>
          {myTurn && turnFraction !== null && <div className="tl-bar" style={{ '--left': turnFraction } as CSSProperties} />}

          {myTurn && view.phase === 'move' && (
            <div className="tp-move">
              <button className="btn btn-primary btn-lg" onClick={() => send({ type: 'roll' })}>
                🎲 {T.roll}
              </button>
              <div className="tp-cards" aria-label={T.cardsTitle}>
                {view.hand.map((v, i) => (
                  <button
                    key={i}
                    className="tp-card"
                    onMouseEnter={() => setPreview((here + v) % BOARD.length)}
                    onMouseLeave={() => setPreview(null)}
                    onFocus={() => setPreview((here + v) % BOARD.length)}
                    onBlur={() => setPreview(null)}
                    onClick={() => {
                      setPreview(null);
                      send({ type: 'card', index: i });
                    }}
                    title={squareName(t, BOARD[(here + v) % BOARD.length])}
                  >
                    <span className="tp-card-num">{v}</span>
                    <span className="tp-card-label">{squareName(t, BOARD[(here + v) % BOARD.length])}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {myTurn && view.phase === 'act' && hereSquare.kind === 'province' && (
            <div className="tp-choices">
              {freeTypes(view, here).map((type) => {
                const price = bizPrice(hereSquare, type, view.event);
                const fee = visitFee([], { id: '', square: here, owner: me, type, level: 1, invested: 0 }, 'normal');
                return (
                  <button key={type} className="btn btn-secondary tp-choice" disabled={cash < price} onClick={() => send({ type: 'buy', biz: type })}>
                    <span>
                      {BIZ_ICON[type]} {T.open(T.biz[type])}
                    </span>
                    <span className="tp-choice-sub">
                      {money(price)} · {T.feeEach(money(fee))}
                    </span>
                  </button>
                );
              })}
              {upgradable(view, here, me).map((b) => {
                const price = upgradePrice(hereSquare, b.type, view.event);
                const fee = visitFee([], { ...b, level: b.level + 1 }, 'normal');
                return (
                  <button key={b.id} className="btn btn-secondary tp-choice" disabled={cash < price} onClick={() => send({ type: 'upgrade', id: b.id })}>
                    <span>
                      ⬆️ {T.upgradeTo(T.biz[b.type], b.level + 1)}
                    </span>
                    <span className="tp-choice-sub">
                      {money(price)} · {T.feeEach(money(fee))}
                    </span>
                  </button>
                );
              })}
              <button className="btn btn-ghost" onClick={() => send({ type: 'end' })}>
                {T.skip}
              </button>
            </div>
          )}
          {myTurn &&
            view.phase === 'act' &&
            hereSquare.kind === 'province' &&
            freeTypes(view, here).every((type) => cash < bizPrice(hereSquare, type, view.event)) &&
            upgradable(view, here, me).every((b) => cash < upgradePrice(hereSquare, b.type, view.event)) && <p className="tl-hint error">{T.needCash}</p>}

          {myTurn && view.phase === 'fly' && (
            <div className="tp-choices">
              {flyTarget !== null && (
                <button className="btn btn-primary" onClick={() => send({ type: 'fly', to: flyTarget })}>
                  ✈️ {T.flyTo(squareName(t, BOARD[flyTarget]))}
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => send({ type: 'stay' })}>
                {T.stay}
              </button>
            </div>
          )}

          {seated && !view.result && (
            <div className="tp-wallet">
              <div className="tp-stat">
                <span className="muted small">{T.cash}</span>
                <strong>{money(mySeat!.cash)}</strong>
              </div>
              <div className="tp-stat">
                <span className="muted small">{T.debt}</span>
                <strong className={mySeat!.debt > 0 ? 'down' : ''}>{money(mySeat!.debt)}</strong>
              </div>
              <div className="tp-stat">
                <span className="muted small">{T.worthLong}</span>
                <strong>{money(mySeat!.worth)}</strong>
              </div>
              <div className="tp-bank" title={T.interestNote}>
                <span className="muted small">🏦 {T.bank}</span>
                <div className="tp-bank-buttons">
                  <button className="btn btn-secondary btn-sm" onClick={() => send({ type: 'borrow', amount: 100 })}>
                    {T.borrow(money(100))}
                  </button>
                  <button className="btn btn-secondary btn-sm" onClick={() => send({ type: 'borrow', amount: 500 })}>
                    {T.borrow(money(500))}
                  </button>
                  <button className="btn btn-secondary btn-sm" disabled={mySeat!.debt === 0 || mySeat!.cash < LOAN_STEP} onClick={() => send({ type: 'repay', amount: Math.min(mySeat!.debt, mySeat!.cash) })}>
                    {mySeat!.cash >= mySeat!.debt ? T.repayAll : T.repay(money(Math.min(mySeat!.debt, mySeat!.cash)))}
                  </button>
                </div>
              </div>
              <button className="btn btn-secondary tp-trade-btn" disabled={view.seats.filter((s) => !s.out).length < 2} onClick={() => setTradeOpen(true)}>
                🤝 {T.trade}
              </button>
            </div>
          )}
        </div>
      </section>

      <aside className="game-right">
        {view.offers.length > 0 && !view.result && (
          <section className="card panel tp-offers">
            <header className="panel-head">
              <h2>{T.offers}</h2>
            </header>
            {view.offers.map((o) => (
              <OfferCard key={o.id} offer={o} me={me} name={name} bizLabel={bizLabel} view={view} left={Math.max(0, Math.ceil((o.expiresAt - Date.now()) / 1000))} onSend={send} />
            ))}
          </section>
        )}
        <section className={`card panel tl-log-panel ${logOpen ? 'open' : 'closed'}`}>
          <button className="panel-toggle" aria-expanded={logOpen} aria-controls="tp-log" onClick={toggleLog} title={logOpen ? T.hideLog : T.showLog}>
            <h2>{T.history}</h2>
            <ChevronRightIcon className="panel-chevron" />
          </button>
          {view.log.length === 0 ? (
            <p className="muted small">{T.noHistory}</p>
          ) : logOpen ? (
            <ol className="tl-log" id="tp-log" ref={logRef}>
              {view.log.map((entry, i) =>
                entry.kind === 'month' ? (
                  <li key={i} className="tl-log-round">
                    {describe(t, entry, name)}
                  </li>
                ) : (
                  <li key={i} className={`tl-log-row ${'player' in entry && entry.player === me ? 'mine' : ''} ${entry.kind === 'pay' || entry.kind === 'interest' ? 'pass' : entry.kind === 'buy' || entry.kind === 'upgrade' || entry.kind === 'trade' ? 'finish' : ''}`}>
                    <Avatar id={'player' in entry ? entry.player : entry.from} name={player('player' in entry ? entry.player : entry.from)?.name ?? '?'} size={22} color={color('player' in entry ? entry.player : entry.from)} />
                    <span className="tl-log-text">{describe(t, entry, name)}</span>
                  </li>
                ),
              )}
            </ol>
          ) : (
            <p className="tl-log-latest muted small">{describe(t, view.log.at(-1)!, name)}</p>
          )}
        </section>
        <ScoreboardPanel room={room} />
        <ChatCard room={room} />
      </aside>

      {tradeOpen && mySeat && <TradeDialog view={view} me={me} name={name} bizLabel={bizLabel} onClose={() => setTradeOpen(false)} onSend={send} />}
    </div>
  );
}

function SquareDetails({
  index,
  view,
  me,
  name,
  color,
  onClose,
  flyButton,
}: {
  index: number;
  view: TyPhuView;
  me: string;
  name: (id: string) => string;
  color: (id: string) => string | undefined;
  onClose: () => void;
  flyButton: ReactNode;
}) {
  const { t } = useI18n();
  const T = t.typhu;
  const sq = BOARD[index];
  const businesses = view.businesses.filter((b) => b.square === index);
  return (
    <section className="card tp-details">
      <header className="tp-details-head">
        <div>
          <h3>{sq.kind === 'province' ? T.provinces[sq.id] : `${SPECIAL_ICON[sq.kind]} ${T.specials[sq.kind]}`}</h3>
          {sq.kind === 'province' && (
            <span className="muted small">
              {T.regions[sq.region]} · {T.tierLabel(sq.tier)} · {T.slots(businesses.length, sq.slots)}
            </span>
          )}
        </div>
        <button className="tool-btn" onClick={onClose} aria-label={T.closeDetails} title={T.closeDetails}>
          <CloseIcon />
        </button>
      </header>
      {sq.kind !== 'province' ? (
        <p className="muted">{T.specialDetails[sq.kind]}</p>
      ) : (
        <ul className="tp-details-list">
          {businesses.map((b) => (
            <li key={b.id}>
              <span className="tp-owner-dot" style={{ '--owner': color(b.owner) } as CSSProperties} />
              <span>
                {BIZ_ICON[b.type]} {T.biz[b.type]} · {T.level(b.level)} · {b.owner === me ? t.room.you : name(b.owner)}
              </span>
              <span className="muted small">
                {T.fee} {T.money(visitFee(view.businesses, b, view.event))}
              </span>
            </li>
          ))}
          {freeTypes(view, index).map((type) => (
            <li key={type} className="free">
              <span className="tp-owner-dot empty" />
              <span>
                {BIZ_ICON[type]} {T.biz[type]} · {T.freeSlot}
              </span>
              <span className="muted small">
                {T.price} {T.money(bizPrice(sq, type, view.event))}
              </span>
            </li>
          ))}
        </ul>
      )}
      {flyButton}
    </section>
  );
}

function OfferCard({
  offer,
  me,
  name,
  bizLabel,
  view,
  left,
  onSend,
}: {
  offer: TradeOffer;
  me: string;
  name: (id: string) => string;
  bizLabel: (b: Business) => string;
  view: TyPhuView;
  left: number;
  onSend: (move: TyPhuMove) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const T = t.typhu;
  const mine = offer.from === me;
  const items = (cash: number, ids: string[]) => {
    const list = [...(cash > 0 ? [T.money(cash)] : []), ...ids.map((id) => view.businesses.find((b) => b.id === id)).filter(Boolean).map((b) => bizLabel(b!))];
    return list.length ? list : [T.nothing];
  };
  return (
    <div className={`tp-offer ${mine ? 'mine' : 'incoming'}`}>
      <p className="tp-offer-head">
        <strong>{mine ? T.offerTo(name(offer.to)) : T.offerFrom(name(offer.from))}</strong>
        <span className="muted small">{T.secondsLeft(left)}</span>
      </p>
      <div className="tp-offer-cols">
        <div>
          <span className="eyebrow">{mine ? T.youGive : T.theyGive}</span>
          <ul>
            {items(offer.giveCash, offer.give).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div>
          <span className="eyebrow">{mine ? T.youGet : T.theyWant}</span>
          <ul>
            {items(offer.getCash, offer.get).map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="tp-offer-actions">
        {mine ? (
          <button className="btn btn-ghost btn-sm" onClick={() => onSend({ type: 'cancel', id: offer.id })}>
            {T.cancelOffer}
          </button>
        ) : (
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => onSend({ type: 'decline', id: offer.id })}>
              {T.decline}
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => onSend({ type: 'accept', id: offer.id })}>
              {T.accept}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function TradeDialog({
  view,
  me,
  name,
  bizLabel,
  onClose,
  onSend,
}: {
  view: TyPhuView;
  me: string;
  name: (id: string) => string;
  bizLabel: (b: Business) => string;
  onClose: () => void;
  onSend: (move: TyPhuMove) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const T = t.typhu;
  const others = view.seats.filter((s) => s.id !== me && !s.out);
  const [to, setTo] = useState(others[0]?.id ?? '');
  const [give, setGive] = useState<string[]>([]);
  const [get, setGet] = useState<string[]>([]);
  const [giveCash, setGiveCash] = useState(0);
  const [getCash, setGetCash] = useState(0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => setGet([]), [to]);

  const mine = view.businesses.filter((b) => b.owner === me);
  const theirs = view.businesses.filter((b) => b.owner === to);
  const toggle = (list: string[], set: (l: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const empty = giveCash + getCash + give.length + get.length === 0;
  const cashInput = (value: number, set: (n: number) => void) => (
    <label className="tp-cash-input">
      <span className="muted small">{T.cashField}</span>
      <input type="number" min={0} step={50} value={value} onChange={(e) => set(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
    </label>
  );

  async function submit() {
    if (empty) return toast(T.emptyOffer);
    if (await onSend({ type: 'offer', to, giveCash, getCash, give, get })) onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card tp-trade" role="dialog" aria-modal="true" aria-labelledby="trade-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2 id="trade-title">{T.tradeTitle}</h2>
          <button className="tool-btn" onClick={onClose} aria-label={t.room.close} title={t.room.close}>
            <CloseIcon />
          </button>
        </header>
        <div className="time-picker">
          <span className="field-label">{T.tradeWith}</span>
          <div className="chip-group">
            {others.map((s) => (
              <button key={s.id} className="chip" aria-pressed={to === s.id} onClick={() => setTo(s.id)}>
                {name(s.id)}
              </button>
            ))}
          </div>
        </div>
        <div className="tp-trade-cols">
          <section>
            <h3>{T.youGive}</h3>
            {cashInput(giveCash, setGiveCash)}
            {mine.length === 0 && <p className="muted small">{T.noBusinesses}</p>}
            {mine.map((b) => (
              <label key={b.id} className="tp-check">
                <input type="checkbox" checked={give.includes(b.id)} onChange={() => toggle(give, setGive, b.id)} />
                {bizLabel(b)}
              </label>
            ))}
          </section>
          <section>
            <h3>{T.youGet}</h3>
            {cashInput(getCash, setGetCash)}
            {theirs.length === 0 && <p className="muted small">{T.noBusinesses}</p>}
            {theirs.map((b) => (
              <label key={b.id} className="tp-check">
                <input type="checkbox" checked={get.includes(b.id)} onChange={() => toggle(get, setGet, b.id)} />
                {bizLabel(b)}
              </label>
            ))}
          </section>
        </div>
        <div className="tp-trade-actions">
          <button className="btn btn-primary" disabled={!to || empty} onClick={submit}>
            🤝 {T.sendOffer}
          </button>
        </div>
      </div>
    </div>
  );
}
