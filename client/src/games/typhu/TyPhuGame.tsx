import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  AIRPORT_FEE,
  ANIM,
  BID_STEP,
  BOARD,
  LOAN_STEP,
  MAX_LEVEL,
  MAX_MONTHS,
  ROUTES,
  ROUTES_TO_WIN,
  YEAR,
  bizPrice,
  deckOf,
  eventFactor,
  freeTypes,
  heldRoutes,
  routeOf,
  salePrice,
  takeoverPrice,
  upgradable,
  upgradePrice,
  visitFee,
  yearFactor,
  type Business,
  type BizType,
  type Deck,
  type EventId,
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
import { Die } from '../../components/Die';
import { Ellipsis } from '../../components/Ellipsis';
import { toast } from '../../components/Toaster';
import { ChatCard, PlayersCard, RoomCodeCard, ScoreboardPanel } from '../../components/RoomPanels';
import { RulesButton } from '../../components/RulesDialog';
import { ChevronRightIcon, CloseIcon, ExitIcon, PlayIcon, TrophyIcon } from '../../components/icons';
import { loadSetting, saveSetting } from '../../settings';
import { playSound } from '../../sound';
import { freshEntries } from '../freshLog';

interface Props {
  room: RoomView;
  view: TyPhuView;
  onLeave: () => void;
}

// The loop runs round the edge of an 8×8 board, clockwise from the top-left corner; the middle
// 6×6 is the stage for the dice, what just happened, auctions and the month's banner.
const SIDE = 8;
function cellOf(i: number): { row: number; col: number } {
  if (i < SIDE) return { row: 0, col: i };
  if (i < 2 * SIDE - 2) return { row: i - (SIDE - 1), col: SIDE - 1 };
  if (i < 3 * SIDE - 2) return { row: SIDE - 1, col: 3 * SIDE - 3 - i };
  return { row: 4 * SIDE - 4 - i, col: 0 };
}
// Which edge a square sits on, so its route colour faces the middle of the board.
const edgeOf = (i: number) => {
  const { row, col } = cellOf(i);
  if (row === 0) return 'top';
  if (col === SIDE - 1) return 'right';
  if (row === SIDE - 1) return 'bottom';
  return 'left';
};

const BIZ_ICON: Record<BizType, string> = { food: '🍜', inn: '🏨', shop: '🛍️' };
const SPECIAL_ICON: Record<string, string> = { start: '🚩', market: '🎟️', deal: '💡', rest: '🚌', bank: '🏦', airport: '✈️', festival: '🎉', tax: '🧾' };
const DECK_ICON: Record<Deck, string> = { luck: '🎟️', deal: '💡' };
const SEAT_COLORS = ['#d64541', '#2e86de', '#27ae60', '#e67e22', '#8e44ad', '#16a085'];
const ROUTE_COLORS = ['#9b6b43', '#5c9ccc', '#d97a2b', '#c0392b', '#2c9a6f', '#b54d9b', '#e0a91d', '#2f4f9e'];

function squareName(t: Strings, sq: Square): string {
  return sq.kind === 'street' ? t.typhu.streets[sq.id] : t.typhu.specials[sq.kind];
}

const routeLabel = (t: Strings, r: number) => t.typhu.routeName(...(ROUTES[r].map((i) => squareName(t, BOARD[i])) as [string, string]));

// Re-renders periodically while `active`, for countdowns.
function useTicker(active: boolean, ms = 250) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

// Counts down from `ms` (as of `since`); only this small piece re-renders as time passes.
function Countdown({ ms, since, render }: { ms: number; since: number; render: (left: number) => ReactNode }) {
  useTicker(true);
  return <>{render(Math.max(0, ms - (performance.now() - since)))}</>;
}

// What the middle of the board shows after something happens.
interface StageCard {
  key: string;
  tone: 'good' | 'bad' | 'info' | 'big';
  icon: string;
  title: string;
  text?: string;
  deck?: Deck;
}

// Picks the most telling thing that just happened, for the card in the middle of the board.
function stageCard(t: Strings, fresh: TyPhuLogEntry[], name: (id: string) => string): StageCard | null {
  const T = t.typhu;
  const S = T.stage;
  const m = T.money;
  const place = (i: number) => squareName(t, BOARD[i]);
  const order: TyPhuLogEntry['kind'][] = ['route', 'bankrupt', 'takeover', 'fortune', 'auctionWon', 'auctionNone', 'pay', 'upgrade', 'buy', 'tax', 'festival', 'bank', 'rest', 'fly'];
  const e = order.map((k) => fresh.findLast((x) => x.kind === k)).find(Boolean);
  if (!e) return null;
  const key = JSON.stringify(e);
  switch (e.kind) {
    case 'route':
      return { key, tone: 'big', icon: '🏆', title: S.route, text: S.routeText(name(e.player), routeLabel(t, e.route), e.count, ROUTES_TO_WIN) };
    case 'bankrupt':
      return { key, tone: 'bad', icon: '💥', title: S.bankrupt, text: name(e.player) };
    case 'takeover':
      return { key, tone: 'big', icon: '🤝', title: S.tookOver, text: S.tookOverText(name(e.player), T.biz[e.biz], name(e.from), m(e.price)) };
    case 'fortune': {
      const card = T.cards[e.card];
      const deck = deckOf(e.card);
      return { key, tone: e.amount < 0 ? 'bad' : 'good', icon: DECK_ICON[deck], title: card.title, text: card.text, deck };
    }
    case 'auctionWon':
      return { key, tone: 'good', icon: '🔨', title: S.auctionWon, text: T.log.auctionWon(name(e.player), T.biz[e.biz], place(e.square), m(e.price)) };
    case 'auctionNone':
      return { key, tone: 'info', icon: '🔨', title: S.auctionNone, text: T.log.auctionNone(T.biz[e.biz], place(e.square)) };
    case 'pay':
      return { key, tone: 'bad', icon: '💸', title: S.pay, text: `${S.payText(name(e.player), m(e.total))} ${S.paidTo(e.owners.map((o) => name(o.id)).join(', '))}` };
    case 'upgrade':
      return {
        key,
        tone: 'good',
        icon: e.level >= MAX_LEVEL ? '⭐' : '⬆️',
        title: e.level >= MAX_LEVEL ? S.landmark : S.upgraded,
        text: T.log.upgrade(name(e.player), T.biz[e.biz], place(e.square), e.level),
      };
    case 'buy':
      return { key, tone: 'good', icon: BIZ_ICON[e.biz], title: S.bought, text: T.log.buy(name(e.player), T.biz[e.biz], place(e.square), m(e.price)) };
    case 'tax':
      return { key, tone: 'bad', icon: '🧾', title: S.tax, text: S.taxText(name(e.player), m(e.amount)) };
    case 'festival':
      return { key, tone: 'good', icon: '🎉', title: S.festival, text: T.log.festival(name(e.player), m(e.total)) };
    case 'bank':
      return { key, tone: 'good', icon: '🏦', title: S.bank, text: T.log.bank(name(e.player), e.bonus === null ? null : m(e.bonus)) };
    case 'rest':
      return { key, tone: 'info', icon: '🚌', title: S.rest, text: T.log.rest(name(e.player), e.drew) };
    case 'fly':
      return { key, tone: 'info', icon: '✈️', title: S.fly, text: T.log.fly(name(e.player), place(e.to)) };
    default:
      return null;
  }
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
    case 'takeover':
      return L.takeover(name(e.player), t.typhu.biz[e.biz], place(e.square), name(e.from), m(e.price));
    case 'fortune':
      return L.fortune(name(e.player), t.typhu.decks[deckOf(e.card)], t.typhu.cards[e.card].title);
    case 'rest':
      return L.rest(name(e.player), e.drew);
    case 'tax':
      return L.tax(name(e.player), m(e.amount));
    case 'bank':
      return L.bank(name(e.player), e.bonus === null ? null : m(e.bonus));
    case 'fly':
      return L.fly(name(e.player), place(e.to));
    case 'festival':
      return L.festival(name(e.player), m(e.total));
    case 'auction':
      return L.auction(t.typhu.biz[e.biz], place(e.square), m(e.start));
    case 'auctionWon':
      return L.auctionWon(name(e.player), t.typhu.biz[e.biz], place(e.square), m(e.price));
    case 'auctionNone':
      return L.auctionNone(t.typhu.biz[e.biz], place(e.square));
    case 'route':
      return L.route(name(e.player), routeLabel(t, e.route), e.count);
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
    case 'sell':
      return (e.forced ? L.forcedSell : L.sell)(name(e.player), t.typhu.biz[e.biz], place(e.square), m(e.amount));
    case 'bankrupt':
      return L.bankrupt(name(e.player));
  }
}

function logTone(e: TyPhuLogEntry): string {
  if (e.kind === 'bankrupt' || (e.kind === 'sell' && e.forced) || e.kind === 'takeover') return 'chop';
  if (e.kind === 'pay' || e.kind === 'interest' || e.kind === 'tax') return 'pass';
  if (e.kind === 'buy' || e.kind === 'upgrade' || e.kind === 'trade' || e.kind === 'route' || e.kind === 'auctionWon') return 'finish';
  return '';
}

const logPlayer = (e: TyPhuLogEntry): string | null => ('player' in e ? e.player : 'from' in e ? e.from : null);

// Plays each change out at the pace the server allows for it: the dice tumble, the token walks
// square by square, then the result shows in the middle of the board with money floating off
// each player, and a new month gets its banner. Move choices wait until it's all over.
function useStage(view: TyPhuView, t: Strings, name: (id: string) => string) {
  const positions = useMemo(() => Object.fromEntries(view.seats.map((s) => [s.id, s.position])), [view.seats]);
  const [shown, setShown] = useState(positions);
  const [rolling, setRolling] = useState(false);
  const [card, setCard] = useState<StageCard | null>(null);
  const [banner, setBanner] = useState<{ month: number; event: EventId } | null>(null);
  const [floats, setFloats] = useState<{ id: string; amount: number; key: number }[]>([]);
  const [busyUntil, setBusyUntil] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  // The token being walked right now, which other updates must leave alone until it arrives.
  const walk = useRef<{ player: string; until: number } | null>(null);
  const latest = useRef(positions);
  latest.current = positions;
  const seenLog = useRef(view.log);
  const lastCash = useRef(Object.fromEntries(view.seats.map((s) => [s.id, s.cash])));
  const floatKey = useRef(0);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  };
  // Puts every token where the server has it, except one still walking.
  const settleTokens = () =>
    setShown((s) => {
      const w = walk.current && performance.now() < walk.current.until ? walk.current.player : null;
      return w ? { ...latest.current, [w]: s[w] } : latest.current;
    });

  useEffect(() => {
    const fresh = freshEntries(seenLog.current, view.log);
    seenLog.current = view.log;
    const cashNow = Object.fromEntries(view.seats.map((s) => [s.id, s.cash]));
    const deltas = view.seats.map((s) => ({ id: s.id, amount: s.cash - (lastCash.current[s.id] ?? s.cash) })).filter((d) => d.amount !== 0);
    lastCash.current = cashNow;
    if (fresh.length === 0) {
      settleTokens();
      return;
    }
    const move = view.lastMove;
    const stepped = fresh.find((e) => e.kind === 'roll' || e.kind === 'card');
    const flew = fresh.some((e) => e.kind === 'fly');
    // When the outcome shows: after the dice and the walk, or the flight.
    let landAt = 0;
    if (stepped && move && move.value > 0) {
      const delay = stepped.kind === 'roll' ? ANIM.roll : 0;
      if (stepped.kind === 'roll') {
        setRolling(true);
        later(ANIM.roll, () => setRolling(false));
      }
      landAt = delay + move.value * ANIM.step;
      // A card may have moved the player on (a jam, an express bus): they slide there once it's been read.
      const moved = positions[move.player] !== move.to;
      walk.current = { player: move.player, until: performance.now() + landAt + (moved ? ANIM.result : 0) };
      // Everyone else's token is where it is; the mover starts from where the move began.
      setShown({ ...positions, [move.player]: move.from });
      for (let k = 1; k <= move.value; k++) later(delay + k * ANIM.step, () => setShown((s) => ({ ...s, [move.player]: (move.from + k) % BOARD.length })));
      later(delay, () => playSound('move'));
      later(landAt + (moved ? ANIM.result : 0) + 10, settleTokens);
    } else {
      if (flew) {
        landAt = ANIM.fly;
        later(0, () => playSound('move'));
      }
      settleTokens();
    }
    const next = stageCard(t, fresh, name);
    const month = fresh.findLast((e) => e.kind === 'month');
    const settle = landAt + (next ? (stepped || flew ? ANIM.result : ANIM.action) : 0);
    later(landAt, () => {
      if (next) {
        setCard(next);
        playSound(next.tone === 'bad' || next.tone === 'big' ? 'capture' : 'notify');
      }
      if (deltas.length) {
        setFloats(deltas.map((d) => ({ ...d, key: ++floatKey.current })));
        later(1800, () => setFloats([]));
      }
    });
    if (next) later(settle + 1200, () => setCard((c) => (c?.key === next.key ? null : c)));
    if (month && month.kind === 'month') {
      // The banner takes over the stage from whatever card was showing.
      later(settle, () => {
        setCard(null);
        setBanner({ month: month.month, event: month.event });
      });
      later(settle + ANIM.month, () => setBanner(null));
    }
    const until = performance.now() + settle + (month ? ANIM.month : 0);
    setBusyUntil((b) => Math.max(b, until));
    // Only the log drives this; the other values are read as of the same update.
  }, [view.log]);

  const [, rerender] = useState(0);
  useEffect(() => {
    const left = busyUntil - performance.now();
    if (left <= 0) return;
    const id = setTimeout(() => rerender((n) => n + 1), left + 10);
    return () => clearTimeout(id);
  }, [busyUntil]);
  const busy = performance.now() < busyUntil;
  return { shown, rolling, card, banner, floats, busy };
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

  const stage = useStage(view, t, name);
  const ready = !stage.busy;
  const [selected, setSelected] = useState<number | null>(null);
  const [preview, setPreview] = useState<number | null>(null);
  // The card buttons can disappear under the pointer (e.g. an automatic roll), so clear the preview.
  useEffect(() => setPreview(null), [myTurn, view.phase]);
  const [tradeOpen, setTradeOpen] = useState(false);

  // Server times are relative to when this view arrived, so client clock skew doesn't matter.
  const receivedAt = useMemo(() => performance.now(), [room]);
  const turnMs = myTurn ? view.turnMs : null;

  async function send(move: TyPhuMove) {
    const r = await api.move(move);
    if (!r.ok) toast(t.errors[r.error]);
    return r.ok;
  }

  async function rematch() {
    const r = isHost ? await api.start() : await api.rematch();
    if (!r.ok) toast(t.errors[r.error]);
  }

  useEffect(() => {
    if (myTurn && ready) playSound('notify');
  }, [myTurn, ready]);
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
  const pressedOwners = new Set(view.seats.filter((s) => s.pressed).map((s) => s.id));
  const feeOf = (b: Business, event = view.event) => visitFee(view.businesses, b, event, view.month, pressedOwners.has(b.owner));
  // Repay everything if possible, otherwise as much as cash allows in steps of 50.
  const repayable = !mySeat ? 0 : cash >= mySeat.debt ? mySeat.debt : Math.floor(cash / LOAN_STEP) * LOAN_STEP;
  const flyFee = mySeat?.freeFlight ? 0 : AIRPORT_FEE;
  const canAct = myTurn && ready;
  const flyTarget = canAct && view.phase === 'fly' && selected !== null && BOARD[selected].kind !== 'airport' ? selected : null;
  const highlight = preview ?? flyTarget;
  // Rivals' businesses here that could be taken over: not landmarks, owner not shielded.
  const takeovers = view.businesses.filter((b) => {
    const owner = view.seats.find((s) => s.id === b.owner);
    return b.square === here && b.owner !== me && b.level < MAX_LEVEL && owner && !owner.out && !owner.shielded;
  });
  const routesOf = (id: string) => heldRoutes(view.businesses, id);

  function pickSquare(i: number) {
    setSelected((s) => (s === i && !(canAct && view.phase === 'fly') ? null : i));
  }

  let status: string;
  if (view.result) status = T.resultTitle;
  else if (mySeat?.bankrupt) status = T.youBankrupt;
  else if (!seated) status = view.turn ? T.turnOf(name(view.turn)) : T.spectating;
  else if (!myTurn) status = view.turn ? T.turnOf(name(view.turn)) + '…' : '';
  else if (!ready) status = T.watching;
  else if (view.phase === 'move') status = T.movePrompt;
  else if (view.phase === 'fly') status = mySeat?.freeFlight ? T.flyPrompt : T.flyPromptFee(money(AIRPORT_FEE));
  else if (view.phase === 'auction') status = T.auctionTitle;
  else status = T.actPrompt(squareName(t, hereSquare));

  const myPlace = view.result ? view.result.ranking.indexOf(me) + 1 : 0;
  const winner = view.result?.ranking[0];
  // Routes someone holds, by square, for marking them on the board.
  const routeHolder = (r: number) => view.seats.find((s) => !s.out && routesOf(s.id).includes(r))?.id;

  return (
    <div className="tl-layout tp-layout">
      <aside className="game-left">
        <RoomCodeCard code={room.code} />
        <PlayersCard
          room={room}
          colorOf={color}
          subtitle={(id) => {
            const seat = view.seats.find((s) => s.id === id);
            if (!seat) return null;
            if (seat.bankrupt) return <span className="tag tag-danger">{T.bankruptTag}</span>;
            return (
              <>
                <span className="tp-owner-dot" style={{ '--owner': color(id) } as CSSProperties} /> {T.worth} {money(seat.worth)}
                <span className="tp-routes-pill">🛣️ {T.routesShort(routesOf(id).length, ROUTES_TO_WIN)}</span>
                {seat.shielded && <span className="tp-perk">{T.perks.shielded}</span>}
                {seat.pressed && <span className="tp-perk">{T.perks.pressed}</span>}
                {seat.discount && <span className="tp-perk">{T.perks.discount}</span>}
              </>
            );
          }}
        />
        <RulesButton gameType="typhu" wide />
        <button className="btn btn-ghost" onClick={onLeave}>
          <ExitIcon /> {t.room.leave}
        </button>
      </aside>

      <section className="tl-main">
        <div className="tp-board-wrap">
          <div className={`tp-board ${canAct && view.phase === 'fly' ? 'picking' : ''}`}>
            {BOARD.map((sq, i) => {
              const { row, col } = cellOf(i);
              const tokens = view.seats.filter((s) => !s.out && stage.shown[s.id] === i);
              const floats = stage.floats.filter((f) => tokens.some((s) => s.id === f.id));
              const businesses = view.businesses.filter((b) => b.square === i);
              const factor = sq.kind === 'street' ? eventFactor(view.event, sq) : 1;
              const route = sq.kind === 'street' ? routeOf(i) : -1;
              const holder = route >= 0 ? routeHolder(route) : undefined;
              const corner = (row === 0 || row === SIDE - 1) && (col === 0 || col === SIDE - 1);
              return (
                <button
                  key={i}
                  type="button"
                  className={[
                    'tp-square',
                    `edge-${edgeOf(i)}`,
                    sq.kind === 'street' ? `street area-${sq.area}` : `special sp-${sq.kind}`,
                    corner ? 'corner' : '',
                    highlight === i ? 'target' : '',
                    factor > 1 ? 'boost' : factor < 1 ? 'cut' : '',
                    selected === i ? 'selected' : '',
                    holder ? 'held' : '',
                  ].join(' ')}
                  style={
                    {
                      gridRow: row + 1,
                      gridColumn: col + 1,
                      '--route': route >= 0 ? ROUTE_COLORS[route] : undefined,
                      '--holder': holder ? color(holder) : undefined,
                    } as CSSProperties
                  }
                  onClick={() => pickSquare(i)}
                  aria-label={squareName(t, sq)}
                >
                  {sq.kind === 'street' ? (
                    <>
                      <span className="tp-band">{holder && <span title={name(holder)}>👑</span>}</span>
                      <span className="tp-sq-name">{T.streets[sq.id]}</span>
                      <span className="tp-sq-sub">{T.districts[sq.id]}</span>
                      <span className="tp-slots">
                        {Array.from({ length: sq.slots }, (_, k) => {
                          const b = businesses[k];
                          return b ? (
                            <span
                              key={k}
                              className={`tp-slot taken ${b.level >= MAX_LEVEL ? 'landmark' : ''}`}
                              style={{ '--owner': color(b.owner) } as CSSProperties}
                              title={`${name(b.owner)} · ${T.biz[b.type]} ${T.level(b.level)}`}
                            >
                              {BIZ_ICON[b.type]}
                              {b.level > 1 && <sup>{b.level >= MAX_LEVEL ? '★' : b.level}</sup>}
                            </span>
                          ) : (
                            <span key={k} className="tp-slot" />
                          );
                        })}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="tp-sq-icon">{SPECIAL_ICON[sq.kind]}</span>
                      <span className="tp-sq-name">{T.specials[sq.kind]}</span>
                    </>
                  )}
                  {tokens.length > 0 && (
                    <span className="tp-tokens">
                      {tokens.map((s) => (
                        <span key={s.id} className={`tp-token ${view.turn === s.id ? 'turn' : ''}`} style={{ '--owner': color(s.id) } as CSSProperties} title={name(s.id)}>
                          {initial(s.id)}
                        </span>
                      ))}
                    </span>
                  )}
                  {floats.map((f) => (
                    <span key={f.key} className={`tp-float ${f.amount > 0 ? 'up' : 'down'}`} style={{ '--owner': color(f.id) } as CSSProperties}>
                      {f.amount > 0 ? '+' : '−'}
                      {money(Math.abs(f.amount))}
                    </span>
                  ))}
                </button>
              );
            })}

            <div className="tp-stage">
              <header className="tp-stage-head">
                <span className="tp-month-num">{T.month(view.month)}</span>
                <span className={`tp-event-pill ev-${view.event}`} title={T.eventDetails[view.event]}>
                  {T.events[view.event]}
                </span>
                {yearFactor(view.month) > 1 && <span className="tp-year-fees">{T.yearFees(money(yearFactor(view.month)))}</span>}
                {view.month > MAX_MONTHS - YEAR && !view.result && <span className="tag tag-gold">{T.finalYear}</span>}
              </header>
              <p className="tp-stage-event muted small">{T.eventDetails[view.event]}</p>

              <div className="tp-stage-main">
                {view.auction ? (
                  <AuctionPanel view={view} me={me} seated={seated} name={name} since={receivedAt} onSend={send} />
                ) : stage.card ? (
                  <div key={stage.card.key} className={`tp-card-reveal tone-${stage.card.tone} ${stage.card.deck ? `deck-${stage.card.deck}` : ''}`}>
                    {stage.card.deck && <span className="eyebrow">{T.decks[stage.card.deck]}</span>}
                    <span className="tp-card-icon">{stage.card.icon}</span>
                    <strong>{stage.card.title}</strong>
                    {stage.card.text && <span className="tp-card-text">{stage.card.text}</span>}
                  </div>
                ) : (
                  view.lastMove?.dice && (
                    <span className="tp-dice" title={name(view.lastMove.player)}>
                      <Die value={view.lastMove.dice[0]} rolling={stage.rolling} durationMs={ANIM.roll} color={color(view.lastMove.player)} className="tp-die" />
                      <Die value={view.lastMove.dice[1]} rolling={stage.rolling} durationMs={ANIM.roll} color={color(view.lastMove.player)} className="tp-die" />
                    </span>
                  )
                )}
              </div>

              {view.nextEvent && (
                <footer className="tp-stage-next muted small">
                  {T.nextMonth}: <strong>{T.events[view.nextEvent]}</strong>
                </footer>
              )}

              {stage.banner && (
                <div className={`tp-banner ev-${stage.banner.event}`} key={stage.banner.month}>
                  <span className="eyebrow">{T.month(stage.banner.month)}</span>
                  <strong>{T.events[stage.banner.event]}</strong>
                  <span>{T.eventDetails[stage.banner.event]}</span>
                </div>
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
                  <h2>{myPlace === 1 ? T.youWon : myPlace ? T.youPlaced(myPlace) : T.resultTitle}</h2>
                  <p className="muted">
                    {view.result.reason === 'routes' && winner ? T.routesWin(name(winner)) : view.result.reason === 'time' ? T.timeUp : T.lastStanding}
                  </p>
                </header>
                <ol className="tl-podium">
                  {view.result.ranking.map((id, i) => {
                    const seat = view.seats.find((s) => s.id === id)!;
                    const owned = view.businesses.filter((b) => b.owner === id).length;
                    const last = i === view.result!.ranking.length - 1;
                    const tag = seat.bankrupt ? T.bankruptTag : seat.out ? t.tienlen.left : null;
                    return (
                      <li key={id} className={`medal-${last ? 'last' : i + 1} ${id === me ? 'me' : ''}`}>
                        <span className="tl-medal">{i + 1}</span>
                        <Avatar id={id} name={player(id)?.name ?? name(id)} size={38} color={color(id)} />
                        <span className="tl-podium-text">
                          <strong>{name(id)}</strong>
                          <span className="muted small">
                            {T.cash} {money(seat.cash)} · {T.debt} {money(seat.debt)} · 🏠 {owned} · 🛣️ {routesOf(id).length}
                          </span>
                        </span>
                        {tag ? <span className="tag tag-danger tl-points">{tag}</span> : <span className="tl-points up">{money(view.result!.worth[id])}</span>}
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
            feeOf={feeOf}
            onClose={() => setSelected(null)}
            onSell={(id) => send({ type: 'sell', id })}
            flyButton={
              flyTarget !== null && (
                <button className="btn btn-primary" disabled={cash < flyFee} onClick={() => send({ type: 'fly', to: flyTarget })}>
                  ✈️ {T.flyTo(squareName(t, BOARD[flyTarget]))}
                </button>
              )
            }
          />
        )}

        <div className={`tl-me card tp-me ${canAct ? 'turn' : ''}`}>
          <div className="tl-me-head">
            {seated && <Avatar id={me} name={player(me)?.name ?? '?'} size={36} online color={color(me)} />}
            <p className="tl-status">
              <Ellipsis text={status} />
            </p>
            {turnMs !== null && <Countdown ms={turnMs} since={receivedAt} render={(left) => <span className="tl-seconds">{Math.ceil(left / 1000)}s</span>} />}
          </div>
          {turnMs !== null && view.turnLimitMs && (
            <Countdown ms={turnMs} since={receivedAt} render={(left) => <div className="tl-bar" style={{ '--left': Math.min(1, left / view.turnLimitMs!) } as CSSProperties} />} />
          )}

          {canAct && view.phase === 'move' && (
            <div className="tp-move">
              <button className="btn btn-primary btn-lg" onClick={() => send({ type: 'roll' })}>
                🎲 {T.roll}
              </button>
              {view.hand.length === 0 && <p className="muted small">{T.noCards}</p>}
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

          {canAct && view.phase === 'act' && hereSquare.kind === 'street' && (
            <>
              <div className="tp-choices">
                {freeTypes(view, here).map((type) => {
                  const full = bizPrice(hereSquare, type, view.event);
                  const price = mySeat?.discount ? Math.round(full / 20) * 10 : full;
                  const candidate = { id: '', square: here, owner: me, type, level: 1, invested: 0 };
                  const fee = visitFee([...view.businesses, candidate], candidate, 'normal', view.month);
                  return (
                    <button key={type} className="btn btn-secondary tp-choice" disabled={cash < price} onClick={() => send({ type: 'buy', biz: type })}>
                      <span>
                        {BIZ_ICON[type]} {T.open(T.biz[type])}
                      </span>
                      <span className="tp-choice-sub">
                        {money(price)}
                        {mySeat?.discount ? ` (${T.halfPrice})` : ''} · {T.feeEach(money(fee))}
                      </span>
                    </button>
                  );
                })}
                {upgradable(view, here, me).map((b) => {
                  const price = upgradePrice(hereSquare, b.type, view.event);
                  const fee = visitFee(view.businesses, { ...b, level: b.level + 1 }, 'normal', view.month);
                  return (
                    <button key={b.id} className="btn btn-secondary tp-choice" disabled={cash < price} onClick={() => send({ type: 'upgrade', id: b.id })}>
                      <span>
                        {b.level + 1 >= MAX_LEVEL ? '⭐' : '⬆️'} {T.upgradeTo(T.biz[b.type], b.level + 1)}
                        {b.level + 1 >= MAX_LEVEL ? ` · ${T.landmark}` : ''}
                      </span>
                      <span className="tp-choice-sub">
                        {money(price)} · {T.feeEach(money(fee))}
                      </span>
                    </button>
                  );
                })}
                {takeovers.map((b) => (
                  <button key={b.id} className="btn btn-secondary tp-choice takeover" disabled={cash < takeoverPrice(b)} onClick={() => send({ type: 'takeover', id: b.id })}>
                    <span>
                      🤝 {T.takeover(T.biz[b.type], name(b.owner))}
                    </span>
                    <span className="tp-choice-sub">
                      {money(takeoverPrice(b))} · {T.feeEach(money(feeOf(b, 'normal')))}
                    </span>
                  </button>
                ))}
                <button className="btn btn-ghost" onClick={() => send({ type: 'end' })}>
                  {freeTypes(view, here).length > 0 ? T.skipAuction : T.skip}
                </button>
              </div>
              {freeTypes(view, here).every((type) => cash < bizPrice(hereSquare, type, view.event)) &&
                upgradable(view, here, me).every((b) => cash < upgradePrice(hereSquare, b.type, view.event)) &&
                takeovers.every((b) => cash < takeoverPrice(b)) && <p className="tl-hint error">{T.needCash}</p>}
            </>
          )}

          {canAct && view.phase === 'fly' && (
            <div className="tp-choices">
              {mySeat?.freeFlight && <span className="tag tag-gold">🎫 {T.freeFlight}</span>}
              {flyTarget !== null && (
                <button className="btn btn-primary" disabled={cash < flyFee} onClick={() => send({ type: 'fly', to: flyTarget })}>
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
                <span className="muted small">
                  🏦 {T.bank} · {T.creditLeft(money(mySeat!.credit))}
                </span>
                <div className="tp-bank-buttons">
                  <button className="btn btn-secondary btn-sm" disabled={mySeat!.credit < 100} onClick={() => send({ type: 'borrow', amount: 100 })}>
                    {T.borrow(money(100))}
                  </button>
                  <button className="btn btn-secondary btn-sm" disabled={mySeat!.credit < 500} onClick={() => send({ type: 'borrow', amount: 500 })}>
                    {T.borrow(money(500))}
                  </button>
                  <button className="btn btn-secondary btn-sm" disabled={repayable === 0} onClick={() => send({ type: 'repay', amount: repayable })}>
                    {repayable === mySeat!.debt ? T.repayAll : T.repay(money(repayable))}
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
              <OfferCard key={o.id} offer={o} me={me} name={name} bizLabel={bizLabel} view={view} since={receivedAt} onSend={send} />
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
              {view.log.map((entry, i) => {
                const who = logPlayer(entry);
                return entry.kind === 'month' || !who ? (
                  <li key={i} className="tl-log-round">
                    {describe(t, entry, name)}
                  </li>
                ) : (
                  <li key={i} className={`tl-log-row ${who === me ? 'mine' : ''} ${logTone(entry)}`}>
                    <Avatar id={who} name={player(who)?.name ?? '?'} size={22} color={color(who)} />
                    <span className="tl-log-text">{describe(t, entry, name)}</span>
                  </li>
                );
              })}
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

// The auction in the middle of the board: everyone but the player who turned the slot down may bid.
function AuctionPanel({
  view,
  me,
  seated,
  name,
  since,
  onSend,
}: {
  view: TyPhuView;
  me: string;
  seated: boolean;
  name: (id: string) => string;
  since: number;
  onSend: (move: TyPhuMove) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const T = t.typhu;
  const a = view.auction!;
  const cash = view.seats.find((s) => s.id === me)?.cash ?? 0;
  const least = a.leader ? a.bid + BID_STEP : a.bid;
  const steps = [least, (a.leader ? a.bid : a.bid - BID_STEP) + 50, (a.leader ? a.bid : a.bid - BID_STEP) + 100].filter((n, i, all) => n >= least && all.indexOf(n) === i);
  const canBid = seated && me !== a.from && !a.passed.includes(me) && a.leader !== me;
  return (
    <div className="tp-auction">
      <span className="eyebrow">🔨 {T.auctionTitle}</span>
      <strong className="tp-auction-what">
        {BIZ_ICON[a.type]} {T.auctionFor(T.biz[a.type], squareName(t, BOARD[a.square]))}
      </strong>
      <span className="tp-auction-bid">{a.leader ? T.auctionLeader(name(a.leader), T.money(a.bid)) : T.auctionOpening(T.money(a.bid))}</span>
      <Countdown ms={a.msLeft} since={since} render={(left) => <div className="tl-bar tp-auction-bar" style={{ '--left': Math.min(1, left / 10_000) } as CSSProperties} />} />
      {canBid ? (
        <div className="tp-auction-actions">
          {steps.map((n) => (
            <button key={n} className="btn btn-primary btn-sm" disabled={cash < n} onClick={() => onSend({ type: 'bid', amount: n })}>
              {T.bid(T.money(n))}
            </button>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={() => onSend({ type: 'pass' })}>
            {T.pass}
          </button>
        </div>
      ) : seated ? (
        <span className="muted small">{a.leader === me ? T.youLead : me === a.from ? T.sellerWaits : T.youPassed}</span>
      ) : null}
    </div>
  );
}

function SquareDetails({
  index,
  view,
  me,
  name,
  color,
  feeOf,
  onClose,
  onSell,
  flyButton,
}: {
  index: number;
  view: TyPhuView;
  me: string;
  name: (id: string) => string;
  color: (id: string) => string | undefined;
  feeOf: (b: Business) => number;
  onClose: () => void;
  onSell: (id: string) => void;
  flyButton: ReactNode;
}) {
  const { t } = useI18n();
  const T = t.typhu;
  const sq = BOARD[index];
  const businesses = view.businesses.filter((b) => b.square === index);
  const partner = sq.kind === 'street' ? ROUTES[routeOf(index)].find((i) => i !== index) : undefined;
  return (
    <section className="card tp-details">
      <header className="tp-details-head">
        <div>
          <h3>{sq.kind === 'street' ? T.streets[sq.id] : `${SPECIAL_ICON[sq.kind]} ${T.specials[sq.kind]}`}</h3>
          {sq.kind === 'street' && (
            <span className="muted small">
              {T.districts[sq.id]} · {T.areas[sq.area]} · {T.tierLabel(sq.tier)} · {T.slots(businesses.length, sq.slots)}
              {partner !== undefined && ` · ${T.routeWith(squareName(t, BOARD[partner]))}`}
            </span>
          )}
        </div>
        <button className="tool-btn" onClick={onClose} aria-label={T.closeDetails} title={T.closeDetails}>
          <CloseIcon />
        </button>
      </header>
      {sq.kind !== 'street' ? (
        <p className="muted">{T.specialDetails[sq.kind]}</p>
      ) : (
        <ul className="tp-details-list">
          {businesses.map((b) => (
            <li key={b.id}>
              <span className="tp-owner-dot" style={{ '--owner': color(b.owner) } as CSSProperties} />
              <span>
                {BIZ_ICON[b.type]} {T.biz[b.type]} · {b.level >= MAX_LEVEL ? `⭐ ${T.landmark}` : T.level(b.level)} · {b.owner === me ? t.room.you : name(b.owner)}
              </span>
              <span className="muted small">
                {T.fee} {T.money(feeOf(b))}
                {b.level < MAX_LEVEL && b.owner !== me && ` · ${T.takeoverPrice} ${T.money(takeoverPrice(b))}`}
              </span>
              {b.owner === me && !view.result && (
                <button className="btn btn-ghost btn-sm tp-sell" title={T.sellHint} onClick={() => onSell(b.id)}>
                  {T.sellFor(T.money(salePrice(b)))}
                </button>
              )}
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
  since,
  onSend,
}: {
  offer: TradeOffer & { msLeft: number };
  me: string;
  name: (id: string) => string;
  bizLabel: (b: Business) => string;
  view: TyPhuView;
  since: number;
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
        <span className="muted small">
          <Countdown ms={offer.msLeft} since={since} render={(left) => T.secondsLeft(Math.ceil(left / 1000))} />
        </span>
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
  const theirs = view.businesses.filter((b) => b.owner === (others.some((s) => s.id === to) ? to : others[0]?.id));
  // Businesses can be sold, traded or lost while the dialog is open; only offer what's still owned.
  const giving = give.filter((id) => mine.some((b) => b.id === id));
  const getting = get.filter((id) => theirs.some((b) => b.id === id));
  const partner = others.some((s) => s.id === to) ? to : (others[0]?.id ?? '');
  const toggle = (list: string[], set: (l: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const empty = giveCash + getCash + giving.length + getting.length === 0;
  const cashInput = (value: number, set: (n: number) => void) => (
    <label className="tp-cash-input">
      <span className="muted small">{T.cashField}</span>
      <input type="number" min={0} step={50} value={value} onChange={(e) => set(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
    </label>
  );

  async function submit() {
    if (empty) return toast(T.emptyOffer);
    if (await onSend({ type: 'offer', to: partner, giveCash, getCash, give: giving, get: getting })) onClose();
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
              <button key={s.id} className="chip" aria-pressed={partner === s.id} onClick={() => setTo(s.id)}>
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
                <input type="checkbox" checked={giving.includes(b.id)} onChange={() => toggle(giving, setGive, b.id)} />
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
                <input type="checkbox" checked={getting.includes(b.id)} onChange={() => toggle(getting, setGet, b.id)} />
                {bizLabel(b)}
              </label>
            ))}
          </section>
        </div>
        <div className="tp-trade-actions">
          <button className="btn btn-primary" disabled={!partner || empty} onClick={submit}>
            🤝 {T.sendOffer}
          </button>
        </div>
      </div>
    </div>
  );
}
