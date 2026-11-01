import { TURN_TIMERS, type GameDefinition } from '../types';

// Co ti phu ("tycoon"): an original property-trading game on a loop through sixteen well-known
// streets of Ho Chi Minh City.
// Each month every player takes one turn. Players open businesses on streets and visitors pay
// every owner there. Holding a business in every street of three routes wins outright; otherwise
// whoever can't pay goes bankrupt, and the last player standing (or the richest) wins.
// Display names (streets, events, cards) live in the client locale files.

// Parts of the city: the old centre, the inner districts and the outer districts.
export type Area = 'center' | 'inner' | 'outer';
// What a street is known for; the month's event may favour (or shut) streets with a tag.
export type StreetTag = 'river' | 'flood' | 'night' | 'chinatown' | 'campus';
export type BizType = 'food' | 'inn' | 'shop';
export const BIZ_TYPES: BizType[] = ['food', 'inn', 'shop'];

export type StreetId =
  | 'phanvantri' | 'quangtrung' | 'phamvandong' | 'vovanngan' | 'xvnt' | 'dienbienphu'
  | 'tranhungdao' | 'nguyentrai' | 'namkykhoinghia' | 'vovantan' | 'xuanthuy' | 'quochuong'
  | 'buivien' | 'phamngulao' | 'dongkhoi' | 'nguyenhue';

// market: draw a luck card; deal: draw an opportunity card; rest: draw a move card.
export type SpecialKind = 'start' | 'market' | 'deal' | 'rest' | 'bank' | 'airport' | 'festival' | 'tax';

export interface StreetSquare {
  kind: 'street';
  id: StreetId;
  area: Area;
  // 1 (cheap) to 5 (Dong Khoi, Nguyen Hue): sets business prices and fees.
  tier: number;
  // How many businesses fit; each must be a different type.
  slots: number;
  tags: StreetTag[];
}

export interface SpecialSquare {
  kind: SpecialKind;
}

export type Square = StreetSquare | SpecialSquare;

const P = (id: StreetId, area: Area, tier: number, tags: StreetTag[] = [], slots = 2): StreetSquare => ({ kind: 'street', id, area, tier, slots, tags });
const S = (kind: SpecialKind): SpecialSquare => ({ kind });

// A loop of 28 squares, drawn as the edge of an 8×8 board: corners at 0, 7, 14 and 21. From the
// outer districts in towards the old centre; streets come in pairs (routes).
export const BOARD: Square[] = [
  S('start'),
  P('phanvantri', 'outer', 1), P('quangtrung', 'outer', 1),
  S('market'),
  P('phamvandong', 'outer', 2, ['campus']), P('vovanngan', 'outer', 2, ['campus']),
  S('rest'),
  S('bank'),
  P('xvnt', 'inner', 2, ['flood']), P('dienbienphu', 'inner', 2, ['flood']),
  S('festival'),
  P('tranhungdao', 'inner', 3, ['chinatown']), P('nguyentrai', 'inner', 3, ['chinatown']),
  S('deal'),
  S('airport'),
  P('namkykhoinghia', 'inner', 3), P('vovantan', 'inner', 3),
  S('market'),
  P('xuanthuy', 'outer', 4, ['river', 'flood']), P('quochuong', 'outer', 4, ['river', 'flood']),
  S('deal'),
  S('rest'),
  P('buivien', 'center', 4, ['night'], 3), P('phamngulao', 'center', 4, ['night']),
  S('tax'),
  P('dongkhoi', 'center', 5, ['river'], 3), P('nguyenhue', 'center', 5, ['river', 'night'], 3),
  S('deal'),
];

// Routes: each run of streets between two special squares. A player with a business on every
// street of a route earns double fees there; holding three routes wins the game outright.
export const ROUTES: number[][] = BOARD.reduce<number[][]>((routes, sq, i) => {
  if (sq.kind !== 'street') return routes;
  if (i > 0 && BOARD[i - 1].kind === 'street') routes[routes.length - 1].push(i);
  else routes.push([i]);
  return routes;
}, []);
export const ROUTES_TO_WIN = 3;
const ROUTE_FACTOR = 2;

export const routeOf = (square: number): number => ROUTES.findIndex((r) => r.includes(square));

export type EventId =
  | 'normal' | 'tet' | 'flood' | 'fireworks' | 'tourism' | 'boom' | 'crisis' | 'rates' | 'inflation' | 'school' | 'nightlife';
// One event per month, reshuffled every year; two quiet months a year.
const EVENT_DECK: EventId[] = ['normal', 'normal', 'tet', 'flood', 'fireworks', 'tourism', 'boom', 'crisis', 'rates', 'inflation', 'school', 'nightlife'];

// Cards: luck cards (mostly money, good or bad) are drawn at the markets, opportunity cards (an
// edge to play with) at the opportunity squares.
export type FortuneId =
  | 'lixi' | 'lottery' | 'birthday' | 'jam' | 'tax' | 'repair' | 'fine' | 'charity'
  | 'bonus' | 'scholarship' | 'investor' | 'press' | 'shield' | 'bus' | 'ticket' | 'upgrade';
export type Deck = 'luck' | 'deal';
const DECKS: Record<Deck, FortuneId[]> = {
  luck: ['lixi', 'lixi', 'lottery', 'birthday', 'jam', 'jam', 'tax', 'repair', 'fine', 'fine', 'charity', 'charity'],
  deal: ['scholarship', 'scholarship', 'investor', 'investor', 'press', 'shield', 'bus', 'ticket', 'upgrade', 'bonus'],
};
export const deckOf = (card: FortuneId): Deck => (DECKS.luck.includes(card) ? 'luck' : 'deal');
export const FORTUNE = {
  lixi: 100,
  lottery: 200,
  birthday: 20,
  bonusPerBusiness: 30,
  // Share of cash taken by a tax audit.
  taxRate: 0.1,
  repairPerLevel: 20,
  fine: 50,
  charity: 20,
  jamSteps: 3,
  pressFactor: 1.5,
  // An opportunity to upgrade, for someone with nothing to upgrade, pays this instead.
  upgradeFallback: 100,
};
// The tax office takes this share of cash, and at least the minimum.
export const TAX_RATE = 0.1;
export const TAX_MIN = 50;

export const YEAR = 12;
// If nobody has won by then, the richest player wins.
export const MAX_MONTHS = 36;
// Anyone can borrow up to this much plus half of what their businesses are worth.
export const LOAN_BASE = 500;
export const START_CASH = 2000;
export const SALARY = 50;
export const AIRPORT_FEE = 100;
export const FESTIVAL_GIFT = 30;
export const BANK_BONUS = 50;
export const HAND_SIZE = 3;
export const MAX_HAND = 5;
export const MAX_CARD = 8;
export const LOAN_STEP = 50;
export const OFFER_MS = 30_000;
// Taking over a rival's business costs this many times what they put into it.
export const TAKEOVER_RATE = 2;
// Auctions: a declined free slot goes under the hammer, starting at half price.
export const AUCTION_MS = 10_000;
// A bid near the end leaves at least this long for others to answer.
export const AUCTION_EXTEND_MS = 5_000;
export const BID_STEP = 10;
const TIER_PRICE = [0, 80, 120, 180, 250, 320];
const BIZ_FACTOR: Record<BizType, number> = { food: 1, inn: 1.5, shop: 2 };
// A visit pays this share of the business price, times the level multiplier.
const FEE_RATE = 1.5;
const LEVEL_FEE = [0, 1, 3, 6];
// A business at the top level is a landmark: it can't be taken over.
export const MAX_LEVEL = 3;
const UPGRADE_RATE = 0.6;
const YEAR_GROWTH = 1.5;
const LOG_LIMIT = 80;
const MAX_TRADE_CASH = 1_000_000;

// How long the client spends showing each step of play. The server holds bots and turn clocks
// until it's done, so the game moves at a pace people can follow.
export const ANIM = {
  // The dice tumble before the token sets off.
  roll: 1400,
  // Per square walked.
  step: 260,
  // The card showing what happened where the token landed.
  result: 1800,
  // Opening, upgrading or taking over a business; an auction's outcome.
  action: 1200,
  // The banner announcing a new month and its event.
  month: 2400,
  fly: 900,
};

export interface Business {
  id: string;
  square: number;
  owner: string;
  type: BizType;
  level: number;
  // Total paid for it (price plus upgrades, or the takeover or auction price); counts towards net worth.
  invested: number;
  // Month it last changed hands by trade: it doesn't count towards a route win that month.
  tradedMonth?: number;
}

export interface TyPhuPlayer {
  id: string;
  position: number;
  cash: number;
  debt: number;
  // Move cards: each lets the player move exactly that many squares.
  hand: number[];
  // Left the table or went bankrupt: no longer playing.
  out: boolean;
  bankrupt: boolean;
  // Landed on the bank this month while in debt: no interest at month end.
  interestWaived: boolean;
  // Month a bot last proposed a trade, so it doesn't pester people.
  lastOfferMonth: number;
  // Opportunity card effects that last until the player's next turn starts (a full round, whatever
  // their seat): businesses can't be taken over, fees ×1.5.
  shielded: boolean;
  pressed: boolean;
  // The next business this player opens costs half.
  discount: boolean;
  // Flying from an opportunity card: no fee.
  freeFlight: boolean;
}

export interface TradeOffer {
  id: number;
  from: string;
  to: string;
  // What `from` hands over and what they ask for in return.
  giveCash: number;
  getCash: number;
  give: string[];
  get: string[];
  expiresAt: number;
}

export interface Auction {
  square: number;
  type: BizType;
  // The player who declined the slot; they don't bid.
  from: string;
  // The highest bid so far, or the opening price while nobody has bid.
  bid: number;
  leader: string | null;
  // Players who dropped out.
  passed: string[];
  endsAt: number;
}

export type Phase = 'move' | 'act' | 'fly' | 'auction';

export type ResultReason = 'routes' | 'last' | 'time';

export type TyPhuLogEntry =
  | { kind: 'roll'; player: string; dice: [number, number]; to: number; auto: boolean }
  | { kind: 'card'; player: string; value: number; to: number }
  | { kind: 'pay'; player: string; square: number; total: number; owners: { id: string; amount: number }[] }
  | { kind: 'buy'; player: string; square: number; biz: BizType; price: number }
  | { kind: 'upgrade'; player: string; square: number; biz: BizType; level: number; price: number }
  | { kind: 'takeover'; player: string; from: string; square: number; biz: BizType; price: number }
  // `amount` is the drawer's net change in cash, for display.
  | { kind: 'fortune'; player: string; card: FortuneId; amount: number }
  | { kind: 'tax'; player: string; amount: number }
  | { kind: 'rest'; player: string; drew: boolean }
  | { kind: 'bank'; player: string; bonus: number | null }
  | { kind: 'fly'; player: string; to: number }
  | { kind: 'festival'; player: string; total: number }
  | { kind: 'auction'; player: string; square: number; biz: BizType; start: number }
  | { kind: 'auctionWon'; player: string; square: number; biz: BizType; price: number }
  | { kind: 'auctionNone'; square: number; biz: BizType }
  | { kind: 'route'; player: string; route: number; count: number }
  | { kind: 'loan'; player: string; amount: number; auto: boolean }
  | { kind: 'repay'; player: string; amount: number }
  | { kind: 'interest'; player: string; amount: number }
  | { kind: 'sell'; player: string; square: number; biz: BizType; amount: number; forced: boolean }
  | { kind: 'bankrupt'; player: string }
  | { kind: 'trade'; from: string; to: string }
  | { kind: 'month'; month: number; event: EventId }
  | { kind: 'left'; player: string };

export interface TyPhuResult {
  // The winner first; then everyone else still playing by net worth, then in reverse order of
  // going bankrupt or leaving.
  ranking: string[];
  worth: Record<string, number>;
  reason: ResultReason;
}

export interface TyPhuState {
  // Turn order within each month.
  seats: string[];
  players: Record<string, TyPhuPlayer>;
  businesses: Business[];
  // Players who went bankrupt or left, in that order (the log is trimmed, so it can't tell).
  eliminated: string[];
  month: number;
  events: EventId[];
  // Cards left to draw in each deck; reshuffled when empty.
  decks: Record<Deck, FortuneId[]>;
  turn: string | null;
  phase: Phase;
  lastMove: { player: string; dice: [number, number] | null; value: number; from: number; to: number } | null;
  offers: TradeOffer[];
  nextOfferId: number;
  auction: Auction | null;
  log: TyPhuLogEntry[];
  result: TyPhuResult | null;
  turnLimitMs: number | null;
  turnDeadline: number | null;
  // Until when the client is still animating the latest turn; bots and turn clocks wait for it.
  busyUntil: number;
}

export type TyPhuMove =
  | { type: 'roll' }
  | { type: 'card'; index: number }
  | { type: 'buy'; biz: BizType }
  | { type: 'upgrade'; id: string }
  | { type: 'takeover'; id: string }
  | { type: 'end' }
  | { type: 'fly'; to: number }
  | { type: 'stay' }
  | { type: 'bid'; amount: number }
  | { type: 'pass' }
  | { type: 'borrow'; amount: number }
  | { type: 'repay'; amount: number }
  | { type: 'sell'; id: string }
  | { type: 'offer'; to: string; giveCash: number; getCash: number; give: string[]; get: string[] }
  | { type: 'accept'; id: number }
  | { type: 'decline'; id: number }
  | { type: 'cancel'; id: number };

export interface TyPhuView {
  seats: {
    id: string;
    position: number;
    cash: number;
    debt: number;
    worth: number;
    // How much more this player may borrow.
    credit: number;
    cards: number;
    out: boolean;
    bankrupt: boolean;
    // Opportunity card effects, until their next turn.
    shielded: boolean;
    pressed: boolean;
    discount: boolean;
    freeFlight: boolean;
  }[];
  businesses: Business[];
  // The viewer's own move cards (empty for spectators).
  hand: number[];
  month: number;
  event: EventId;
  nextEvent: EventId | null;
  turn: string | null;
  phase: Phase;
  lastMove: TyPhuState['lastMove'];
  // Offers the viewer made or received, with the time left as of this view.
  offers: (TradeOffer & { msLeft: number })[];
  auction: (Auction & { msLeft: number }) | null;
  log: TyPhuLogEntry[];
  result: TyPhuResult | null;
  turnMs: number | null;
  turnLimitMs: number | null;
}

// ---- Economy ----

const round10 = (n: number) => Math.round(n / 10) * 10;

export function eventOf(s: Pick<TyPhuState, 'events' | 'month'>): EventId {
  return s.events[s.month - 1] ?? 'normal';
}

// Price to open a business of this type here this month.
export function bizPrice(square: StreetSquare, type: BizType, event: EventId = 'normal'): number {
  return round10(TIER_PRICE[square.tier] * BIZ_FACTOR[type] * (event === 'inflation' ? 1.2 : 1));
}

export function upgradePrice(square: StreetSquare, type: BizType, event: EventId = 'normal'): number {
  return round10(bizPrice(square, type) * UPGRADE_RATE * (event === 'inflation' ? 1.2 : 1));
}

export function takeoverPrice(b: Business): number {
  return round10(b.invested * TAKEOVER_RATE);
}

// How much the month's event scales fees at this square.
export function eventFactor(event: EventId, square: StreetSquare): number {
  const tagged = (tag: StreetTag, factor: number) => (square.tags.includes(tag) ? factor : 1);
  switch (event) {
    case 'tet':
      return square.area === 'center' ? 2 : tagged('chinatown', 2);
    case 'flood':
      return tagged('flood', 0);
    case 'fireworks':
      return tagged('river', 3);
    case 'tourism':
      return square.area === 'center' ? 2 : 1;
    case 'school':
      return tagged('campus', 2);
    case 'nightlife':
      return tagged('night', 2);
    case 'boom':
      return 1.5;
    case 'crisis':
      return 0.5;
    default:
      return 1;
  }
}

export function interestRate(event: EventId): number {
  return event === 'rates' ? 0.15 : 0.1;
}

// Chain bonus: the same business type in two areas of the city earns ×1.25, in all three ×1.5.
export function chainFactor(businesses: Business[], owner: string, type: BizType): number {
  const areas = new Set(businesses.filter((b) => b.owner === owner && b.type === type).map((b) => (BOARD[b.square] as StreetSquare).area));
  return areas.size >= 3 ? 1.5 : areas.size === 2 ? 1.25 : 1;
}

// Whether `owner` has a business in every street of the route.
export function holdsRoute(businesses: Business[], owner: string, route: number): boolean {
  return ROUTES[route].every((sq) => businesses.some((b) => b.square === sq && b.owner === owner));
}

export function heldRoutes(businesses: Business[], owner: string): number[] {
  return ROUTES.map((_, r) => r).filter((r) => holdsRoute(businesses, owner, r));
}

// The economy grows: every new year all visit fees go up, so games can't drag on forever.
export function yearFactor(month: number): number {
  return 1 + Math.floor((month - 1) / YEAR) * YEAR_GROWTH;
}

// What a visitor pays the owner of this business this month. `pressed` is whether the owner is in
// the papers (the press card, until their next turn).
export function visitFee(businesses: Business[], b: Business, event: EventId, month = 1, pressed = false): number {
  const square = BOARD[b.square] as StreetSquare;
  const route = holdsRoute(businesses, b.owner, routeOf(b.square)) ? ROUTE_FACTOR : 1;
  return round10(
    bizPrice(square, b.type) *
      FEE_RATE *
      LEVEL_FEE[b.level] *
      chainFactor(businesses, b.owner, b.type) *
      route *
      eventFactor(event, square) *
      yearFactor(month) *
      (pressed ? FORTUNE.pressFactor : 1),
  );
}

// The bank buys businesses back at half of what was put into them.
export function salePrice(b: Business): number {
  return Math.floor(b.invested / 20) * 10;
}

export function creditLimit(s: Pick<TyPhuState, 'businesses'>, id: string): number {
  const invested = s.businesses.filter((b) => b.owner === id).reduce((sum, b) => sum + b.invested, 0);
  return LOAN_BASE + Math.floor(invested / 2 / LOAN_STEP) * LOAN_STEP;
}

export function netWorth(s: Pick<TyPhuState, 'players' | 'businesses'>, id: string): number {
  const p = s.players[id];
  const assets = s.businesses.filter((b) => b.owner === id).reduce((sum, b) => sum + b.invested, 0);
  return p.cash + assets - p.debt;
}

// Business types still free on a street square.
export function freeTypes(s: Pick<TyPhuState, 'businesses'>, square: number): BizType[] {
  const sq = BOARD[square];
  if (sq.kind !== 'street') return [];
  const here = s.businesses.filter((b) => b.square === square);
  if (here.length >= sq.slots) return [];
  return BIZ_TYPES.filter((t) => !here.some((b) => b.type === t));
}

export function upgradable(s: Pick<TyPhuState, 'businesses'>, square: number, player: string): Business[] {
  return s.businesses.filter((b) => b.square === square && b.owner === player && b.level < MAX_LEVEL);
}

// Rivals' businesses here that `player` could take over: not landmarks, and not shielded.
export function takeoverTargets(s: Pick<TyPhuState, 'businesses' | 'players'>, square: number, player: string): Business[] {
  return s.businesses.filter((b) => {
    const owner = s.players[b.owner];
    return b.square === square && b.owner !== player && b.level < MAX_LEVEL && owner && !owner.out && !owner.shielded;
  });
}

const isPressed = (s: Pick<TyPhuState, 'players'>, owner: string) => !!s.players[owner]?.pressed;

// Fees a player would pay on landing here this month.
export function feesAt(s: Pick<TyPhuState, 'businesses' | 'players' | 'month'>, square: number, player: string, event: EventId): number {
  return s.businesses
    .filter((b) => b.square === square && b.owner !== player && !s.players[b.owner]?.out)
    .reduce((sum, b) => sum + visitFee(s.businesses, b, event, s.month, isPressed(s, b.owner)), 0);
}

// ---- State helpers ----

const withLog = (s: TyPhuState, ...entries: TyPhuLogEntry[]): TyPhuState => ({ ...s, log: [...s.log, ...entries].slice(-LOG_LIMIT) });

const activeIds = (s: TyPhuState) => s.seats.filter((id) => !s.players[id].out);

// The order players take their turns in this month. It reverses every month, so whoever went last
// starts the next month (two turns in a row): going early or late evens out. With a fixed order the
// first seats won far more often (all-bot games, 4 players: 31% vs 19%), mostly by getting first
// pick of the free slots.
export function turnOrder(s: Pick<TyPhuState, 'seats' | 'month'>): string[] {
  return s.month % 2 === 1 ? s.seats : [...s.seats].reverse();
}

const drawCard = (random: () => number) => 1 + Math.floor(random() * MAX_CARD);

function shuffled<T>(items: T[], random: () => number): T[] {
  const deck = [...items];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function updatePlayer(s: TyPhuState, id: string, patch: Partial<TyPhuPlayer>): TyPhuState {
  return { ...s, players: { ...s.players, [id]: { ...s.players[id], ...patch } } };
}

// Drops trade offers that mention businesses which changed hands or closed.
function dropOffersFor(s: TyPhuState, bizIds: string[]): TyPhuState {
  return { ...s, offers: s.offers.filter((o) => ![...o.give, ...o.get].some((id) => bizIds.includes(id))) };
}

function sell(s: TyPhuState, b: Business, forced: boolean): TyPhuState {
  const amount = salePrice(b);
  let next = credit(s, b.owner, amount);
  next = dropOffersFor({ ...next, businesses: next.businesses.filter((x) => x.id !== b.id) }, [b.id]);
  return withLog(next, { kind: 'sell', player: b.owner, square: b.square, biz: b.type, amount, forced });
}

function goBankrupt(s: TyPhuState, id: string): TyPhuState {
  const next = updatePlayer(s, id, { out: true, bankrupt: true, cash: 0, debt: 0, hand: [] });
  return withLog(
    {
      ...next,
      eliminated: [...next.eliminated, id],
      businesses: next.businesses.filter((b) => b.owner !== id),
      offers: next.offers.filter((o) => o.from !== id && o.to !== id),
    },
    { kind: 'bankrupt', player: id },
  );
}

// Takes money from a player. Short of cash, they borrow up to their credit limit, then sell
// businesses to the bank (cheapest first); if even that isn't enough they go bankrupt.
// Returns the new state and how much was actually paid.
function charge(s: TyPhuState, id: string, amount: number): [TyPhuState, number] {
  let next = s;
  const p = s.players[id];
  if (p.cash >= amount) return [updatePlayer(next, id, { cash: p.cash - amount }), amount];
  const room = Math.max(0, creditLimit(next, id) - p.debt);
  const loan = Math.min(Math.ceil((amount - p.cash) / LOAN_STEP) * LOAN_STEP, Math.floor(room / LOAN_STEP) * LOAN_STEP);
  if (loan > 0) {
    next = withLog(updatePlayer(next, id, { cash: p.cash + loan, debt: p.debt + loan }), { kind: 'loan', player: id, amount: loan, auto: true });
  }
  const owned = next.businesses.filter((b) => b.owner === id).sort((a, b) => a.invested - b.invested);
  for (const b of owned) {
    if (next.players[id].cash >= amount) break;
    next = sell(next, b, true);
  }
  const cash = next.players[id].cash;
  if (cash >= amount) return [updatePlayer(next, id, { cash: cash - amount }), amount];
  return [goBankrupt(next, id), cash];
}

function credit(s: TyPhuState, id: string, amount: number): TyPhuState {
  return updatePlayer(s, id, { cash: s.players[id].cash + amount });
}

// A player's shield and press last until their own next turn starts.
function startTurn(s: TyPhuState, turn: string | null, now: number): TyPhuState {
  const next = turn && (s.players[turn].shielded || s.players[turn].pressed) ? updatePlayer(s, turn, { shielded: false, pressed: false }) : s;
  return { ...next, turn, phase: 'move', turnDeadline: turn && s.turnLimitMs ? now + s.turnLimitMs : null };
}

function finish(s: TyPhuState, reason: ResultReason, winner?: string): TyPhuState {
  const worth = Object.fromEntries(s.seats.map((id) => [id, netWorth(s, id)]));
  const rest = activeIds(s)
    .filter((id) => id !== winner)
    .sort((a, b) => worth[b] - worth[a] || s.seats.indexOf(a) - s.seats.indexOf(b));
  const ranking = [...(winner ? [winner] : []), ...rest, ...[...s.eliminated].reverse()];
  return { ...s, turn: null, turnDeadline: null, offers: [], auction: null, result: { ranking, worth, reason } };
}

// Logs routes a player newly holds after businesses changed hands. Routes don't win on the spot:
// the game is only decided at the end of the month (see routeWinner), so everyone has had the same
// number of turns, and the rest of the table a chance to break the routes up.
function checkRoutes(prev: TyPhuState, next: TyPhuState): TyPhuState {
  let s = next;
  for (const id of activeIds(next)) {
    const before = heldRoutes(prev.businesses, id);
    const after = heldRoutes(next.businesses, id);
    for (const route of after.filter((r) => !before.includes(r))) s = withLog(s, { kind: 'route', player: id, route, count: after.length });
  }
  return s;
}

// Routes that count towards winning at the end of this month. A business received by trade only
// counts from the next month on, so a gift can't crown anyone.
export function winningRoutes(s: Pick<TyPhuState, 'businesses' | 'month'>, owner: string): number[] {
  return heldRoutes(
    s.businesses.filter((b) => b.tradedMonth !== s.month),
    owner,
  );
}

// At the end of a month, whoever holds enough routes wins: the most routes, then the highest net
// worth, then the earlier seat.
export function routeWinner(s: TyPhuState): string | null {
  const contenders = activeIds(s)
    .map((id) => ({ id, routes: winningRoutes(s, id).length, worth: netWorth(s, id) }))
    .filter((c) => c.routes >= ROUTES_TO_WIN)
    .sort((a, b) => b.routes - a.routes || b.worth - a.worth);
  return contenders[0]?.id ?? null;
}

function endMonth(s: TyPhuState, now: number): TyPhuState {
  // Everyone has had their turn: routes are counted before salaries and interest.
  const winner = routeWinner(s);
  if (winner) return finish(s, 'routes', winner);
  const event = eventOf(s);
  let next = s;
  for (const id of activeIds(s)) {
    next = credit(next, id, SALARY);
    const p = next.players[id];
    if (p.debt > 0 && !p.interestWaived) {
      const interest = Math.ceil((p.debt * interestRate(event)) / 10) * 10;
      next = withLog(next, { kind: 'interest', player: id, amount: interest });
      [next] = charge(next, id, interest);
    }
    if (!next.players[id].out) next = updatePlayer(next, id, { interestWaived: false });
  }
  if (activeIds(next).length <= 1) return finish(next, 'last', activeIds(next)[0]);
  if (s.month >= MAX_MONTHS) return finish(next, 'time');
  next = { ...next, month: s.month + 1 };
  next = withLog(next, { kind: 'month', month: next.month, event: eventOf(next) });
  return startTurn(next, turnOrder(next).find((id) => !next.players[id].out) ?? null, now);
}

// Passes the turn on; after the last player of the month the month ends.
function endTurn(s: TyPhuState, now: number): TyPhuState {
  if (s.result) return s;
  if (activeIds(s).length <= 1) return finish(s, 'last', activeIds(s)[0]);
  const order = turnOrder(s);
  const i = s.turn ? order.indexOf(s.turn) : -1;
  const later = order.slice(i + 1).find((id) => !s.players[id].out);
  return later ? startTurn(s, later, now) : endMonth(s, now);
}

// Whether the player has a decision to make on the square they're standing on.
function hasChoice(s: TyPhuState, id: string): boolean {
  const pos = s.players[id].position;
  return freeTypes(s, pos).length > 0 || upgradable(s, pos, id).length > 0 || takeoverTargets(s, pos, id).length > 0;
}

// Draws from a deck and plays the card. Returns the state after its effect, and whether the card
// already settled the turn (it moved the player and they landed again, or they're off to the
// airport); otherwise the turn still has to end.
function drawFortune(s: TyPhuState, id: string, deckName: Deck, now: number, random: () => number): [TyPhuState, boolean] {
  const deck = s.decks[deckName].length > 0 ? s.decks[deckName] : shuffled(DECKS[deckName], random);
  const card = deck[0];
  let next: TyPhuState = { ...s, decks: { ...s.decks, [deckName]: deck.slice(1) } };
  const cashBefore = next.players[id].cash;
  const others = activeIds(next).filter((o) => o !== id);
  const pay = (amount: number) => {
    [next] = charge(next, id, amount);
  };
  switch (card) {
    case 'lixi':
      next = credit(next, id, FORTUNE.lixi);
      break;
    case 'lottery':
      next = credit(next, id, FORTUNE.lottery);
      break;
    case 'birthday':
      for (const o of others) {
        let paid: number;
        [next, paid] = charge(next, o, FORTUNE.birthday);
        next = credit(next, id, paid);
      }
      break;
    case 'bonus':
      next = credit(next, id, FORTUNE.bonusPerBusiness * next.businesses.filter((b) => b.owner === id).length);
      break;
    case 'scholarship': {
      const hand = next.players[id].hand;
      if (hand.length < MAX_HAND) next = updatePlayer(next, id, { hand: [...hand, drawCard(random)] });
      break;
    }
    case 'investor':
      next = updatePlayer(next, id, { discount: true });
      break;
    case 'press':
      next = updatePlayer(next, id, { pressed: true });
      break;
    case 'shield':
      next = updatePlayer(next, id, { shielded: true });
      break;
    case 'upgrade': {
      // The cheapest of the player's businesses that can still go up a level, for free.
      const target = next.businesses
        .filter((b) => b.owner === id && b.level < MAX_LEVEL)
        .sort((a, b) => upgradePrice(BOARD[a.square] as StreetSquare, a.type) - upgradePrice(BOARD[b.square] as StreetSquare, b.type))[0];
      if (target) {
        const value = upgradePrice(BOARD[target.square] as StreetSquare, target.type);
        next = { ...next, businesses: next.businesses.map((b) => (b === target ? { ...b, level: b.level + 1, invested: b.invested + value } : b)) };
      } else next = credit(next, id, FORTUNE.upgradeFallback);
      break;
    }
    case 'tax':
      pay(round10(next.players[id].cash * FORTUNE.taxRate));
      break;
    case 'repair':
      pay(FORTUNE.repairPerLevel * next.businesses.filter((b) => b.owner === id).reduce((sum, b) => sum + b.level, 0));
      break;
    case 'fine':
      pay(FORTUNE.fine);
      break;
    case 'charity':
      for (const o of others) {
        if (next.players[id].out) break;
        let paid: number;
        [next, paid] = charge(next, id, FORTUNE.charity);
        next = credit(next, o, paid);
      }
      break;
    case 'bus':
    case 'jam':
    case 'ticket':
      break;
  }
  const amount = next.players[id].out ? -cashBefore : next.players[id].cash - cashBefore;
  next = withLog(next, { kind: 'fortune', player: id, card, amount });
  if (next.players[id].out) return [next, false];
  if (card === 'bus') {
    // Straight on to the bus station: a new lap and its move card.
    const pos = next.players[id].position;
    // lastMove keeps the walk to the card's square; clients slide the token on from there.
    return [moveBy(next, id, BOARD.length - pos, random), false];
  }
  if (card === 'ticket') return [{ ...updatePlayer(next, id, { freeFlight: true }), phase: 'fly' }, true];
  if (card === 'jam') {
    const pos = next.players[id].position;
    const to = (pos - FORTUNE.jamSteps + BOARD.length) % BOARD.length;
    return [land(updatePlayer(next, id, { position: to }), id, now, random, false), true];
  }
  return [next, false];
}

// Resolves landing on the player's square. `fortune` is false when a fortune card moved the player
// here, so a market reached that way doesn't draw again.
function land(s: TyPhuState, id: string, now: number, random: () => number, fortune = true): TyPhuState {
  const pos = s.players[id].position;
  const square = BOARD[pos];
  const event = eventOf(s);
  let next = s;
  switch (square.kind) {
    case 'street': {
      const owners = s.businesses
        .filter((b) => b.square === pos && b.owner !== id && !s.players[b.owner].out)
        .map((b) => ({ id: b.owner, amount: visitFee(s.businesses, b, event, s.month, isPressed(s, b.owner)) }))
        .filter((o) => o.amount > 0);
      const total = owners.reduce((sum, o) => sum + o.amount, 0);
      if (total > 0) {
        next = withLog(next, { kind: 'pay', player: id, square: pos, total, owners });
        let paid: number;
        [next, paid] = charge(next, id, total);
        // A player who goes bankrupt pays out what they had, shared in proportion.
        for (const o of owners) next = credit(next, o.id, paid === total ? o.amount : Math.floor((o.amount * paid) / total));
      }
      if (next.players[id].out) return endTurn(next, now);
      return hasChoice(next, id) ? { ...next, phase: 'act' } : endTurn(next, now);
    }
    case 'market':
    case 'deal': {
      if (!fortune) return endTurn(next, now);
      let settled: boolean;
      [next, settled] = drawFortune(next, id, square.kind === 'market' ? 'luck' : 'deal', now, random);
      return settled ? next : endTurn(next, now);
    }
    case 'rest': {
      const hand = next.players[id].hand;
      const drew = hand.length < MAX_HAND;
      if (drew) next = updatePlayer(next, id, { hand: [...hand, drawCard(random)] });
      return endTurn(withLog(next, { kind: 'rest', player: id, drew }), now);
    }
    case 'tax': {
      const amount = Math.max(TAX_MIN, round10(next.players[id].cash * TAX_RATE));
      next = withLog(next, { kind: 'tax', player: id, amount });
      [next] = charge(next, id, amount);
      return endTurn(next, now);
    }
    case 'bank': {
      const inDebt = next.players[id].debt > 0;
      next = inDebt ? updatePlayer(next, id, { interestWaived: true }) : credit(next, id, BANK_BONUS);
      return endTurn(withLog(next, { kind: 'bank', player: id, bonus: inDebt ? null : BANK_BONUS }), now);
    }
    case 'festival': {
      let total = 0;
      for (const o of activeIds(next).filter((o) => o !== id)) {
        let paid: number;
        [next, paid] = charge(next, o, FESTIVAL_GIFT);
        total += paid;
      }
      next = credit(next, id, total);
      return endTurn(withLog(next, { kind: 'festival', player: id, total }), now);
    }
    case 'airport':
      return next.players[id].cash >= AIRPORT_FEE ? { ...next, phase: 'fly' } : endTurn(next, now);
    default:
      return endTurn(next, now);
  }
}

// Passing or reaching the bus station starts a new lap and earns a move card.
function moveBy(s: TyPhuState, id: string, steps: number, random: () => number): TyPhuState {
  const p = s.players[id];
  const lapped = p.position + steps >= BOARD.length;
  const hand = lapped && p.hand.length < MAX_HAND ? [...p.hand, drawCard(random)] : p.hand;
  return updatePlayer(s, id, { position: (p.position + steps) % BOARD.length, hand });
}

// The free type that goes to auction when a slot is declined: the cheapest.
function auctionType(s: TyPhuState, square: number): BizType | null {
  const sq = BOARD[square];
  if (sq.kind !== 'street') return null;
  return freeTypes(s, square).sort((a, b) => bizPrice(sq, a) - bizPrice(sq, b))[0] ?? null;
}

export const auctionStart = (square: StreetSquare, type: BizType) => Math.max(BID_STEP, round10(bizPrice(square, type) / 2));

// The player on turn passes on their square: a free slot goes to auction if anyone else could
// afford the opening bid; otherwise the turn just ends.
function decline(s: TyPhuState, now: number): TyPhuState {
  const id = s.turn!;
  const pos = s.players[id].position;
  const type = auctionType(s, pos);
  if (type) {
    const start = auctionStart(BOARD[pos] as StreetSquare, type);
    const bidders = activeIds(s).filter((o) => o !== id && s.players[o].cash >= start);
    if (bidders.length > 0) {
      const auction: Auction = { square: pos, type, from: id, bid: start, leader: null, passed: [], endsAt: now + AUCTION_MS };
      return withLog({ ...s, phase: 'auction', auction, turnDeadline: null }, { kind: 'auction', player: id, square: pos, biz: type, start });
    }
  }
  return endTurn(s, now);
}

// Everyone who can still bid has dropped out (or the leader is unopposed). Someone who couldn't
// raise the next bid even by borrowing up to their credit limit counts as out, so the table
// doesn't wait for them.
function auctionSettled(s: TyPhuState, a: Auction): boolean {
  const least = a.leader ? a.bid + BID_STEP : a.bid;
  const canBid = (id: string) => s.players[id].cash + Math.max(0, creditLimit(s, id) - s.players[id].debt) >= least;
  return activeIds(s).every((id) => id === a.from || id === a.leader || a.passed.includes(id) || !canBid(id));
}

function closeAuction(s: TyPhuState, now: number): TyPhuState {
  const a = s.auction!;
  let next: TyPhuState = { ...s, auction: null };
  const winner = a.leader && !next.players[a.leader].out && next.players[a.leader].cash >= a.bid ? a.leader : null;
  // The slot may have been taken meanwhile only by this auction, but check anyway.
  if (winner && freeTypes(next, a.square).includes(a.type)) {
    const biz: Business = { id: `${a.square}-${a.type}`, square: a.square, owner: winner, type: a.type, level: 1, invested: a.bid };
    next = updatePlayer(next, winner, { cash: next.players[winner].cash - a.bid });
    next = withLog({ ...next, businesses: [...next.businesses, biz] }, { kind: 'auctionWon', player: winner, square: a.square, biz: a.type, price: a.bid });
    next = checkRoutes(s, next);
  } else {
    next = withLog(next, { kind: 'auctionNone', square: a.square, biz: a.type });
  }
  return endTurn(next, now);
}

// Marks how long the client will be busy showing this turn step (plus a new month's banner), and
// starts the player's clock only once it's done.
function paced(prev: TyPhuState, next: TyPhuState, now: number, ms: number): TyPhuState {
  const busyUntil = now + ms + (next.month > prev.month ? ANIM.month : 0);
  const turnDeadline = next.turnDeadline !== null && next.turnLimitMs ? busyUntil + next.turnLimitMs : next.turnDeadline;
  return { ...next, busyUntil, turnDeadline };
}

// Client time for a move of `steps` squares, rolled or played as a card.
export const moveMs = (steps: number, rolled: boolean) => (rolled ? ANIM.roll : 0) + steps * ANIM.step + ANIM.result;

const isAmount = (n: unknown, max = MAX_TRADE_CASH): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= max;

function validOffer(s: TyPhuState, o: Omit<TradeOffer, 'id' | 'expiresAt'>): boolean {
  if (!Object.hasOwn(s.players, o.to) || s.players[o.to].out || o.to === o.from) return false;
  if (!isAmount(o.giveCash) || !isAmount(o.getCash)) return false;
  if (!Array.isArray(o.give) || !Array.isArray(o.get) || new Set(o.give).size !== o.give.length || new Set(o.get).size !== o.get.length) return false;
  const owns = (ids: string[], owner: string) => ids.every((bid) => s.businesses.some((b) => b.id === bid && b.owner === owner));
  return owns(o.give, o.from) && owns(o.get, o.to);
}

// Trades must be roughly fair, so nobody can hand a friend the game or dump businesses on an ally
// before going bankrupt:
// - at least one business changes hands, and both sides give something (no gifts);
// - whoever hands over businesses gets back at least what the bank would pay for them (salePrice,
//   half of what was put in), in cash or in businesses counted the same way.
// On top of that, businesses received by trade don't count towards a route win until the next
// month (see winningRoutes).
export type TradeProblem = 'noBusiness' | 'oneSided' | 'underpriced';
type TradeTerms = Pick<TradeOffer, 'giveCash' | 'getCash' | 'give' | 'get'>;

const bankValue = (businesses: Business[], ids: string[]) =>
  businesses.filter((b) => ids.includes(b.id)).reduce((sum, b) => sum + salePrice(b), 0);

// How much more each side would have to receive for the trade to be fair: `from` is the one
// making the offer, `to` the one it's made to.
export function tradeShortfall(businesses: Business[], o: TradeTerms): { from: number; to: number } {
  const give = bankValue(businesses, o.give);
  const get = bankValue(businesses, o.get);
  return { from: Math.max(0, give - o.getCash - get), to: Math.max(0, get - o.giveCash - give) };
}

export function tradeProblem(businesses: Business[], o: TradeTerms): TradeProblem | null {
  if (o.give.length + o.get.length === 0) return 'noBusiness';
  if (o.giveCash + o.give.length === 0 || o.getCash + o.get.length === 0) return 'oneSided';
  const short = tradeShortfall(businesses, o);
  return short.from > 0 || short.to > 0 ? 'underpriced' : null;
}

function applyTrade(s: TyPhuState, o: TradeOffer): TyPhuState | null {
  if (!validOffer(s, o) || tradeProblem(s.businesses, o)) return null;
  // Only money beyond what a player owes can change hands, so borrowed cash can't be passed to a
  // friend before going bankrupt or leaving.
  const spare = (id: string) => Math.max(0, s.players[id].cash - s.players[id].debt);
  if (spare(o.from) < o.giveCash || spare(o.to) < o.getCash) return null;
  let next = credit(credit(s, o.from, o.getCash - o.giveCash), o.to, o.giveCash - o.getCash);
  next = {
    ...next,
    businesses: next.businesses.map((b) =>
      o.give.includes(b.id)
        ? { ...b, owner: o.to, tradedMonth: s.month }
        : o.get.includes(b.id)
          ? { ...b, owner: o.from, tradedMonth: s.month }
          : b,
    ),
  };
  // Offers that relied on the traded businesses no longer make sense.
  next = dropOffersFor({ ...next, offers: next.offers.filter((x) => x.id !== o.id) }, [...o.give, ...o.get]);
  return checkRoutes(s, withLog(next, { kind: 'trade', from: o.from, to: o.to }));
}

const fail = { ok: false as const, error: 'INVALID_MOVE' as const };

// ---- Bots ----

// How many streets of a route the player already has a business in.
const routeProgress = (s: Pick<TyPhuState, 'businesses'>, id: string, route: number) =>
  ROUTES[route].filter((sq) => s.businesses.some((b) => b.square === sq && b.owner === id)).length;

// Whether a business at `square` would complete a route for the player.
const completesRoute = (s: Pick<TyPhuState, 'businesses'>, id: string, square: number) => {
  const route = routeOf(square);
  if (route < 0 || holdsRoute(s.businesses, id, route)) return false;
  return ROUTES[route].every((sq) => sq === square || s.businesses.some((b) => b.square === sq && b.owner === id));
};

// Whether taking over this business would stop its owner winning at the end of the month.
const stopsWin = (s: Pick<TyPhuState, 'businesses' | 'month'>, b: Business, by: string) =>
  winningRoutes(s, b.owner).length >= ROUTES_TO_WIN &&
  winningRoutes({ ...s, businesses: s.businesses.map((x) => (x.id === b.id ? { ...x, owner: by } : x)) }, b.owner).length < ROUTES_TO_WIN;

// How attractive landing on a square is for a player: fees count against, chances to invest for.
function landingScore(s: TyPhuState, id: string, square: number): number {
  const sq = BOARD[square];
  const event = eventOf(s);
  switch (sq.kind) {
    case 'street': {
      let score = -feesAt(s, square, id, event);
      if (freeTypes(s, square).length > 0) score += 30 + sq.tier * 10 + (completesRoute(s, id, square) ? 150 : 0);
      if (upgradable(s, square, id).length > 0) score += 40;
      const targets = takeoverTargets(s, square, id);
      if (targets.some((b) => completesRoute(s, id, b.square))) score += 120;
      if (targets.some((b) => stopsWin(s, b, id) && s.players[id].cash >= takeoverPrice(b))) score += 300;
      return score;
    }
    case 'market':
      return 5;
    case 'deal':
      return 30;
    case 'rest':
      return s.players[id].hand.length < MAX_HAND ? 25 : 0;
    case 'tax':
      return -Math.max(TAX_MIN, s.players[id].cash * TAX_RATE);
    case 'bank':
      return s.players[id].debt > 0 ? 40 : BANK_BONUS;
    case 'festival':
      return FESTIVAL_GIFT * (activeIds(s).length - 1);
    case 'airport':
      return 20;
    default:
      return 0;
  }
}

function botMoveChoice(s: TyPhuState, id: string): TyPhuMove {
  const pos = s.players[id].position;
  let dice = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) dice += landingScore(s, id, (pos + a + b) % BOARD.length) / 36;
  const hand = s.players[id].hand;
  let best = -1;
  // Cards are scarce, so keep them unless one is clearly better than taking a chance.
  let bestScore = dice + 80;
  hand.forEach((v, i) => {
    const score = landingScore(s, id, (pos + v) % BOARD.length);
    if (score > bestScore) [best, bestScore] = [i, score];
  });
  return best >= 0 ? { type: 'card', index: best } : { type: 'roll' };
}

const BOT_RESERVE = 150;

// The richest rival still playing, whose routes are worth breaking.
const leadingRival = (s: TyPhuState, id: string) =>
  activeIds(s)
    .filter((o) => o !== id)
    .sort((a, b) => netWorth(s, b) - netWorth(s, a))[0];

function botAct(s: TyPhuState, id: string): TyPhuMove {
  const p = s.players[id];
  const square = BOARD[p.position] as StreetSquare;
  const event = eventOf(s);
  const affordable = (price: number, reserve = BOT_RESERVE) => p.cash - price >= reserve;
  const openPrice = (t: BizType) => (p.discount ? round10(bizPrice(square, t, event) / 2) : bizPrice(square, t, event));

  const types = freeTypes(s, p.position);
  const targets = takeoverTargets(s, p.position, id).sort((a, b) => takeoverPrice(a) - takeoverPrice(b));
  // Someone holds enough routes to win at the end of the month: break one up at any price.
  const rescue = targets.find((b) => affordable(takeoverPrice(b), 0) && stopsWin(s, b, id));
  if (rescue) return { type: 'takeover', id: rescue.id };
  // Then completing a route matters most, whether by opening a business or taking one over.
  if (completesRoute(s, id, p.position)) {
    const t = types.filter((x) => affordable(openPrice(x), 0)).sort((a, b) => openPrice(a) - openPrice(b))[0];
    if (t) return { type: 'buy', biz: t };
    const b = targets.find((x) => affordable(takeoverPrice(x), 0));
    if (b) return { type: 'takeover', id: b.id };
  }
  // Break up a rival's route, or stop the leader from closing one in.
  const rival = leadingRival(s, id);
  const breaking = targets.find(
    (b) =>
      affordable(takeoverPrice(b)) &&
      (holdsRoute(s.businesses, b.owner, routeOf(b.square)) ||
        (b.owner === rival && routeProgress(s, b.owner, routeOf(b.square)) >= ROUTES[routeOf(b.square)].length - 1)),
  );
  if (breaking) return { type: 'takeover', id: breaking.id };

  // How much opening this type here would raise the bot's chain bonus for it.
  const chainGain = (type: BizType) =>
    chainFactor([...s.businesses, { id: '', square: p.position, owner: id, type, level: 1, invested: 0 }], id, type) - chainFactor(s.businesses, id, type);
  const buyable = types
    .filter((t) => affordable(openPrice(t)))
    // Prefer types that extend a chain, then the priciest affordable one.
    .sort((a, b) => chainGain(b) - chainGain(a) || bizPrice(square, b) - bizPrice(square, a));
  if (buyable.length > 0) return { type: 'buy', biz: buyable[0] };
  // Push a business to landmark level, where nobody can take it over.
  const up = upgradable(s, p.position, id)
    .filter((b) => affordable(upgradePrice(square, b.type, event)))
    .sort((a, b) => b.level - a.level || bizPrice(square, b.type) - bizPrice(square, a.type));
  if (up.length > 0) return { type: 'upgrade', id: up[0].id };
  // With money to spare, buy into a route the bot is building.
  const growing = targets.find((b) => affordable(takeoverPrice(b), BOT_RESERVE * 3) && routeProgress(s, id, routeOf(b.square)) > 0);
  if (growing) return { type: 'takeover', id: growing.id };
  return { type: 'end' };
}

function botFly(s: TyPhuState, id: string): TyPhuMove {
  if (!s.players[id].freeFlight && s.players[id].cash < AIRPORT_FEE + 300) return { type: 'stay' };
  let best = -1;
  let bestScore = 60;
  BOARD.forEach((sq, i) => {
    if (sq.kind === 'airport') return;
    const score = landingScore(s, id, i);
    if (score > bestScore) [best, bestScore] = [i, score];
  });
  return best >= 0 ? { type: 'fly', to: best } : { type: 'stay' };
}

// What a bot would pay at auction: the list price, more if it builds or completes one of its routes.
function botBidLimit(s: TyPhuState, id: string, a: Auction): number {
  const square = BOARD[a.square] as StreetSquare;
  const route = routeOf(a.square);
  const worth = bizPrice(square, a.type) * (completesRoute(s, id, a.square) ? 2 : routeProgress(s, id, route) > 0 ? 1.2 : 0.9);
  return Math.floor(Math.min(worth, s.players[id].cash - BOT_RESERVE) / BID_STEP) * BID_STEP;
}

function botAuction(s: TyPhuState, id: string): TyPhuMove | null {
  const a = s.auction!;
  if (id === a.from || id === a.leader || a.passed.includes(id)) return null;
  const next = a.leader ? a.bid + BID_STEP : a.bid;
  if (next > botBidLimit(s, id, a)) return { type: 'pass' };
  // Raise by about a tenth of the list price, so bidding wars between bots end quickly.
  const raise = round10(bizPrice(BOARD[a.square] as StreetSquare, a.type) / 10);
  return { type: 'bid', amount: Math.min(botBidLimit(s, id, a), Math.max(next, a.leader ? a.bid + raise : a.bid)) };
}

// A bot values its own businesses a little above cost, and more if they hold a chain or route together.
function botValue(s: TyPhuState, id: string, bizIds: string[], gaining: boolean): number {
  return bizIds.reduce((sum, bid) => {
    const b = s.businesses.find((x) => x.id === bid)!;
    const chainBefore = chainFactor(s.businesses, id, b.type);
    const after = s.businesses.map((x) => (x.id === bid ? { ...x, owner: gaining ? id : '' } : x));
    const chainAfter = chainFactor(after, id, b.type);
    const chainWorth = Math.abs(chainAfter - chainBefore) * 2 * b.invested;
    const route = routeOf(b.square);
    const routeWorth = holdsRoute(after, id, route) !== holdsRoute(s.businesses, id, route) ? 3 * b.invested : 0;
    return sum + b.invested * (gaining ? 1 : 1.15) + chainWorth + routeWorth;
  }, 0);
}

function botAnswer(s: TyPhuState, id: string, o: TradeOffer): TyPhuMove {
  const spare = (pid: string) => Math.max(0, s.players[pid].cash - s.players[pid].debt);
  if (spare(id) < o.getCash || spare(o.from) < o.giveCash) return { type: 'decline', id: o.id };
  // Never hand a rival the business that would win them the game.
  const after = s.businesses.map((b) => (o.get.includes(b.id) ? { ...b, owner: o.from } : o.give.includes(b.id) ? { ...b, owner: id } : b));
  if (heldRoutes(after, o.from).length >= ROUTES_TO_WIN) return { type: 'decline', id: o.id };
  const gain = o.giveCash + botValue(s, id, o.give, true);
  const loss = o.getCash + botValue(s, id, o.get, false);
  return gain >= loss * 1.05 ? { type: 'accept', id: o.id } : { type: 'decline', id: o.id };
}

// Looks for one business that would complete a three-area chain and offers a premium for it.
function botProposal(s: TyPhuState, id: string): TyPhuMove | null {
  const p = s.players[id];
  if (s.month - p.lastOfferMonth < 3 || s.offers.some((o) => o.from === id)) return null;
  for (const type of BIZ_TYPES) {
    if (chainFactor(s.businesses, id, type) !== 1.25) continue;
    const mine = new Set(s.businesses.filter((b) => b.owner === id && b.type === type).map((b) => (BOARD[b.square] as StreetSquare).area));
    const target = s.businesses.find(
      (b) => b.type === type && b.owner !== id && !s.players[b.owner].out && !mine.has((BOARD[b.square] as StreetSquare).area),
    );
    if (!target) continue;
    const price = round10(target.invested * 1.4);
    if (p.cash - p.debt - price < 300) continue;
    return { type: 'offer', to: target.owner, giveCash: price, getCash: 0, give: [], get: [target.id] };
  }
  return null;
}

// The next thing a bot wants to do, or null when it's waiting on others.
export function typhuBotMove(s: TyPhuState, id: string): TyPhuMove | null {
  const p = s.players[id];
  if (s.result || !p || p.out) return null;
  const incoming = s.offers.find((o) => o.to === id);
  if (incoming) return botAnswer(s, id, incoming);
  if (s.phase === 'auction') return s.auction ? botAuction(s, id) : null;
  if (p.debt > 0 && p.cash > p.debt + 400) return { type: 'repay', amount: p.debt };
  if (s.turn !== id) return null;
  if (s.phase === 'move') return botProposal(s, id) ?? botMoveChoice(s, id);
  if (s.phase === 'fly') return botFly(s, id);
  return botAct(s, id);
}

// ---- Game definition ----

export const typhuGame: GameDefinition<TyPhuState, TyPhuMove, TyPhuView> = {
  type: 'typhu',

  setup(playerIds, options, { now, random = Math.random }) {
    const seats = shuffled(playerIds, random);
    const events: EventId[] = [];
    for (let year = 0; year < MAX_MONTHS / YEAR; year++) events.push(...shuffled(EVENT_DECK, random));
    const players = Object.fromEntries(
      seats.map((id) => [
        id,
        {
          id,
          position: 0,
          cash: START_CASH,
          debt: 0,
          hand: Array.from({ length: HAND_SIZE }, () => drawCard(random)),
          out: false,
          bankrupt: false,
          interestWaived: false,
          lastOfferMonth: 0,
          shielded: false,
          pressed: false,
          discount: false,
          freeFlight: false,
        },
      ]),
    );
    const base: TyPhuState = {
      seats,
      players,
      businesses: [],
      eliminated: [],
      month: 1,
      events,
      decks: { luck: shuffled(DECKS.luck, random), deal: shuffled(DECKS.deal, random) },
      turn: null,
      phase: 'move',
      lastMove: null,
      offers: [],
      nextOfferId: 1,
      auction: null,
      log: [{ kind: 'month', month: 1, event: events[0] }],
      result: null,
      turnLimitMs: TURN_TIMERS[options.turnTimer] ?? null,
      turnDeadline: null,
      busyUntil: now,
    };
    // The first month's banner shows before anyone moves.
    return { ...startTurn(base, seats[0], now + ANIM.month), busyUntil: now + ANIM.month };
  },

  applyMove(state, playerId, move, { now, random = Math.random }) {
    if (state.result) return { ok: false, error: 'GAME_OVER' };
    const me = state.players[playerId];
    if (!me || me.out) return { ok: false, error: 'NOT_A_PLAYER' };
    if (typeof move !== 'object' || move === null) return fail;

    // Money, trades and bids don't wait for your turn.
    switch (move.type) {
      case 'borrow': {
        if (!isAmount(move.amount, 100_000) || move.amount === 0 || move.amount % LOAN_STEP !== 0) return fail;
        if (me.debt + move.amount > creditLimit(state, playerId)) return fail;
        const next = updatePlayer(state, playerId, { cash: me.cash + move.amount, debt: me.debt + move.amount });
        return { ok: true, state: withLog(next, { kind: 'loan', player: playerId, amount: move.amount, auto: false }) };
      }
      case 'repay': {
        const amount = Math.min(move.amount, me.debt, me.cash);
        // In steps of 50, or whatever clears the debt.
        if (!isAmount(move.amount) || amount <= 0 || (amount !== me.debt && amount % LOAN_STEP !== 0)) return fail;
        const next = updatePlayer(state, playerId, { cash: me.cash - amount, debt: me.debt - amount });
        return { ok: true, state: withLog(next, { kind: 'repay', player: playerId, amount }) };
      }
      case 'sell': {
        const biz = state.businesses.find((b) => b.id === move.id && b.owner === playerId);
        return biz ? { ok: true, state: sell(state, biz, false) } : fail;
      }
      case 'offer': {
        const offer = { from: playerId, to: move.to, giveCash: move.giveCash, getCash: move.getCash, give: move.give, get: move.get };
        if (!validOffer(state, offer)) return fail;
        if (tradeProblem(state.businesses, offer)) return { ok: false, error: 'TRADE_UNFAIR' };
        const created: TradeOffer = { ...offer, give: [...offer.give], get: [...offer.get], id: state.nextOfferId, expiresAt: now + OFFER_MS };
        // One open offer per player: a new one replaces the old.
        const offers = [...state.offers.filter((o) => o.from !== playerId), created];
        const next = updatePlayer({ ...state, offers, nextOfferId: state.nextOfferId + 1 }, playerId, { lastOfferMonth: state.month });
        return { ok: true, state: next };
      }
      case 'accept':
      case 'decline':
      case 'cancel': {
        // An offer past its time is gone, even if the server hasn't swept it yet.
        const offer = state.offers.find((o) => o.id === move.id && o.expiresAt > now);
        if (!offer || (move.type === 'cancel' ? offer.from : offer.to) !== playerId) return fail;
        if (move.type !== 'accept') return { ok: true, state: { ...state, offers: state.offers.filter((o) => o !== offer) } };
        // Upgrades since the offer was made can leave it short of the bank price.
        if (validOffer(state, offer) && tradeProblem(state.businesses, offer)) return { ok: false, error: 'TRADE_UNFAIR' };
        const traded = applyTrade(state, offer);
        return traded ? { ok: true, state: traded } : fail;
      }
      case 'bid':
      case 'pass': {
        const a = state.auction;
        if (state.phase !== 'auction' || !a || a.endsAt <= now || playerId === a.from || a.passed.includes(playerId)) return fail;
        let auction: Auction;
        if (move.type === 'pass') {
          if (playerId === a.leader) return fail;
          auction = { ...a, passed: [...a.passed, playerId] };
        } else {
          const least = a.leader ? a.bid + BID_STEP : a.bid;
          if (!isAmount(move.amount) || move.amount < least || move.amount % BID_STEP !== 0 || move.amount > me.cash) return fail;
          auction = { ...a, bid: move.amount, leader: playerId, endsAt: Math.max(a.endsAt, now + AUCTION_EXTEND_MS) };
        }
        const next = { ...state, auction };
        return { ok: true, state: auctionSettled(next, auction) ? paced(state, closeAuction(next, now), now, ANIM.action) : next };
      }
    }

    if (state.turn !== playerId) return { ok: false, error: 'NOT_YOUR_TURN' };
    const pos = me.position;
    switch (move.type) {
      case 'roll':
      case 'card': {
        if (state.phase !== 'move') return fail;
        let steps: number;
        let dice: [number, number] | null = null;
        let next = state;
        if (move.type === 'roll') {
          dice = [1 + Math.floor(random() * 6), 1 + Math.floor(random() * 6)];
          steps = dice[0] + dice[1];
        } else {
          if (!Number.isInteger(move.index) || move.index < 0 || move.index >= me.hand.length) return fail;
          steps = me.hand[move.index];
          // Cards are scarce: new ones only come from passing the bus station (or a scholarship).
          next = updatePlayer(next, playerId, { hand: me.hand.filter((_, i) => i !== move.index) });
        }
        next = moveBy(next, playerId, steps, random);
        const to = next.players[playerId].position;
        next = { ...next, lastMove: { player: playerId, dice, value: steps, from: pos, to } };
        next = withLog(next, dice ? { kind: 'roll', player: playerId, dice, to, auto: false } : { kind: 'card', player: playerId, value: steps, to });
        return { ok: true, state: paced(state, land(next, playerId, now, random), now, moveMs(steps, !!dice)) };
      }
      case 'buy': {
        const square = BOARD[pos];
        if (state.phase !== 'act' || square.kind !== 'street' || !freeTypes(state, pos).includes(move.biz)) return fail;
        const full = bizPrice(square, move.biz, eventOf(state));
        const price = me.discount ? round10(full / 2) : full;
        if (me.cash < price) return fail;
        const biz: Business = { id: `${pos}-${move.biz}`, square: pos, owner: playerId, type: move.biz, level: 1, invested: price };
        let next = updatePlayer(state, playerId, { cash: me.cash - price, discount: false });
        next = withLog({ ...next, businesses: [...next.businesses, biz] }, { kind: 'buy', player: playerId, square: pos, biz: move.biz, price });
        return { ok: true, state: paced(state, endTurn(checkRoutes(state, next), now), now, ANIM.action) };
      }
      case 'upgrade': {
        const square = BOARD[pos];
        const biz = upgradable(state, pos, playerId).find((b) => b.id === move.id);
        if (state.phase !== 'act' || square.kind !== 'street' || !biz) return fail;
        const price = upgradePrice(square, biz.type, eventOf(state));
        if (me.cash < price) return fail;
        let next = updatePlayer(state, playerId, { cash: me.cash - price });
        next = {
          ...next,
          businesses: next.businesses.map((b) => (b === biz ? { ...b, level: b.level + 1, invested: b.invested + price } : b)),
        };
        next = withLog(next, { kind: 'upgrade', player: playerId, square: pos, biz: biz.type, level: biz.level + 1, price });
        return { ok: true, state: paced(state, endTurn(next, now), now, ANIM.action) };
      }
      case 'takeover': {
        const biz = takeoverTargets(state, pos, playerId).find((b) => b.id === move.id);
        if (state.phase !== 'act' || !biz) return fail;
        const price = takeoverPrice(biz);
        if (me.cash < price) return fail;
        let next = credit(updatePlayer(state, playerId, { cash: me.cash - price }), biz.owner, price);
        // A takeover isn't a trade: the business counts towards the new owner's routes at once.
        next = dropOffersFor(
          { ...next, businesses: next.businesses.map((b) => (b === biz ? { id: b.id, square: b.square, type: b.type, level: b.level, owner: playerId, invested: price } : b)) },
          [biz.id],
        );
        next = withLog(next, { kind: 'takeover', player: playerId, from: biz.owner, square: pos, biz: biz.type, price });
        return { ok: true, state: paced(state, endTurn(checkRoutes(state, next), now), now, ANIM.action) };
      }
      case 'end':
        return state.phase === 'act' ? { ok: true, state: paced(state, decline(state, now), now, 0) } : fail;
      case 'fly': {
        if (state.phase !== 'fly' || !Number.isInteger(move.to) || move.to < 0 || move.to >= BOARD.length) return fail;
        const fee = me.freeFlight ? 0 : AIRPORT_FEE;
        if (BOARD[move.to].kind === 'airport' || me.cash < fee) return fail;
        let next = updatePlayer(state, playerId, { cash: me.cash - fee, position: move.to, freeFlight: false });
        next = withLog({ ...next, phase: 'move', lastMove: { player: playerId, dice: null, value: 0, from: pos, to: move.to } }, { kind: 'fly', player: playerId, to: move.to });
        return { ok: true, state: paced(state, land(next, playerId, now, random), now, ANIM.fly + ANIM.result) };
      }
      case 'stay':
        return state.phase === 'fly' ? { ok: true, state: paced(state, endTurn(updatePlayer(state, playerId, { freeFlight: false }), now), now, 0) } : fail;
    }
    return fail;
  },

  forfeit(state, playerId, { now }) {
    if (state.result || !state.players[playerId] || state.players[playerId].out) return state;
    // Their businesses close and the slots open up again.
    let next: TyPhuState = updatePlayer(state, playerId, { out: true, hand: [] });
    next = {
      ...next,
      eliminated: [...next.eliminated, playerId],
      businesses: next.businesses.filter((b) => b.owner !== playerId),
      offers: next.offers.filter((o) => o.from !== playerId && o.to !== playerId),
    };
    next = withLog(next, { kind: 'left', player: playerId });
    if (activeIds(next).length < 2) return finish(next, 'last', activeIds(next)[0]);
    // An auction can't wait for someone who left; and if they were selling, it goes on without them.
    if (next.auction) {
      const auction = next.auction.leader === playerId ? { ...next.auction, leader: null, bid: auctionStart(BOARD[next.auction.square] as StreetSquare, next.auction.type) } : next.auction;
      next = { ...next, auction };
      return auctionSettled(next, auction) ? closeAuction(next, now) : next;
    }
    return state.turn === playerId ? endTurn(next, now) : next;
  },

  isOver(state) {
    return state.result !== null;
  },

  playerView(state, playerId, { now }) {
    return {
      seats: state.seats.map((id) => {
        const p = state.players[id];
        return {
          id,
          position: p.position,
          cash: p.cash,
          debt: p.debt,
          worth: netWorth(state, id),
          credit: Math.max(0, creditLimit(state, id) - p.debt),
          cards: p.hand.length,
          out: p.out,
          bankrupt: p.bankrupt,
          shielded: p.shielded,
          pressed: p.pressed,
          discount: p.discount,
          freeFlight: p.freeFlight,
        };
      }),
      businesses: state.businesses,
      hand: state.players[playerId]?.hand ?? [],
      month: state.month,
      event: eventOf(state),
      nextEvent: state.month < MAX_MONTHS ? state.events[state.month] : null,
      turn: state.turn,
      phase: state.phase,
      lastMove: state.lastMove,
      offers: state.offers.filter((o) => o.from === playerId || o.to === playerId).map((o) => ({ ...o, msLeft: Math.max(0, o.expiresAt - now) })),
      auction: state.auction && { ...state.auction, msLeft: Math.max(0, state.auction.endsAt - now) },
      log: state.log,
      result: state.result,
      turnMs: state.turnDeadline === null ? null : Math.max(0, state.turnDeadline - now),
      turnLimitMs: state.turnLimitMs,
    };
  },

  deadline(state) {
    if (state.result) return null;
    const times = [state.turnDeadline, state.auction?.endsAt ?? null, ...state.offers.map((o) => o.expiresAt)].filter((t): t is number => t !== null);
    return times.length ? Math.min(...times) : null;
  },

  // Expired offers lapse; an auction past its time is settled; a player out of time rolls, passes
  // on the square (which may start an auction) or stays put.
  timeout(state, { now, random = Math.random }) {
    if (state.result) return state;
    let next = state;
    if (state.offers.some((o) => o.expiresAt <= now)) next = { ...next, offers: next.offers.filter((o) => o.expiresAt > now) };
    if (next.auction && now >= next.auction.endsAt) return paced(next, closeAuction(next, now), now, ANIM.action);
    if (next.turn && next.turnDeadline !== null && now >= next.turnDeadline) {
      const player = next.turn;
      if (next.phase === 'move') {
        const r = typhuGame.applyMove(next, player, { type: 'roll' }, { now, random });
        if (r.ok) {
          // Mark the roll as automatic in the log.
          const i = r.state.log.map((e) => e.kind).lastIndexOf('roll');
          next = { ...r.state, log: r.state.log.map((e, j) => (j === i && e.kind === 'roll' ? { ...e, auto: true } : e)) };
        }
      } else if (next.phase === 'act') next = paced(next, decline(next, now), now, 0);
      // Out of time at the airport is staying put, which uses up a free flight just the same.
      else if (next.phase === 'fly') next = paced(next, endTurn(updatePlayer(next, player, { freeFlight: false }), now), now, 0);
      else next = paced(next, endTurn(next, now), now, 0);
    }
    return next;
  },

  points(state) {
    if (!state.result) return null;
    const n = state.result.ranking.length;
    return Object.fromEntries(state.result.ranking.map((id, i) => [id, { place: i + 1, points: n - 1 - 2 * i }]));
  },

  botMove(state, playerId) {
    return typhuBotMove(state, playerId);
  },

  busyUntil(state) {
    return state.result ? null : state.busyUntil;
  },
};
