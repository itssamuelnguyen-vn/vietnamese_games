import { TURN_TIMERS, type GameDefinition } from '../types';

// Co ti phu ("tycoon"): an original property-trading game on a road through Vietnam's 34 provinces.
// A game lasts 12 months; each month every player takes one turn. Players open businesses in
// provinces, visitors pay every owner there, and the richest player after month 12 wins.
// Display names (provinces, events) live in the client locale files.

export type Region = 'north' | 'central' | 'south';
export type BizType = 'food' | 'inn' | 'shop';
export const BIZ_TYPES: BizType[] = ['food', 'inn', 'shop'];

export type ProvinceId =
  | 'laichau' | 'dienbien' | 'sonla' | 'laocai' | 'tuyenquang' | 'caobang' | 'langson' | 'thainguyen'
  | 'phutho' | 'bacninh' | 'hanoi' | 'hungyen' | 'haiphong' | 'quangninh' | 'ninhbinh'
  | 'thanhhoa' | 'nghean' | 'hatinh' | 'quangtri' | 'hue' | 'danang' | 'quangngai' | 'gialai'
  | 'daklak' | 'khanhhoa' | 'lamdong'
  | 'dongnai' | 'tayninh' | 'hcmc' | 'dongthap' | 'vinhlong' | 'cantho' | 'angiang' | 'camau';

export type SpecialKind = 'start' | 'market' | 'rest' | 'bank' | 'airport' | 'festival';

export interface ProvinceSquare {
  kind: 'province';
  id: ProvinceId;
  region: Region;
  // 1 (cheap) to 5 (Hanoi, Ho Chi Minh City): sets business prices and fees.
  tier: number;
  // How many businesses fit; each must be a different type.
  slots: number;
  beach: boolean;
  highland: boolean;
}

export interface SpecialSquare {
  kind: SpecialKind;
}

export type Square = ProvinceSquare | SpecialSquare;

const P = (id: ProvinceId, region: Region, tier: number, extra: { slots?: number; beach?: boolean; highland?: boolean } = {}): ProvinceSquare => ({
  kind: 'province',
  id,
  region,
  tier,
  slots: extra.slots ?? 2,
  beach: extra.beach ?? false,
  highland: extra.highland ?? false,
});
const S = (kind: SpecialKind): SpecialSquare => ({ kind });

// The road runs north to south and loops back to the bus station.
export const BOARD: Square[] = [
  S('start'),
  P('laichau', 'north', 1), P('dienbien', 'north', 1), P('sonla', 'north', 1),
  S('market'),
  P('laocai', 'north', 2), P('tuyenquang', 'north', 1), P('caobang', 'north', 1), P('langson', 'north', 1), P('thainguyen', 'north', 2),
  S('rest'),
  P('phutho', 'north', 2), P('bacninh', 'north', 3), P('hanoi', 'north', 5, { slots: 3 }), P('hungyen', 'north', 2),
  S('bank'),
  P('haiphong', 'north', 4, { beach: true }), P('quangninh', 'north', 3, { beach: true }), P('ninhbinh', 'north', 2),
  S('festival'),
  P('thanhhoa', 'central', 2, { beach: true }), P('nghean', 'central', 2, { beach: true }), P('hatinh', 'central', 1), P('quangtri', 'central', 1), P('hue', 'central', 3),
  S('airport'),
  P('danang', 'central', 4, { slots: 3, beach: true }), P('quangngai', 'central', 2, { beach: true }), P('gialai', 'central', 2, { beach: true, highland: true }),
  S('market'),
  P('daklak', 'central', 2, { beach: true, highland: true }), P('khanhhoa', 'central', 3, { beach: true }), P('lamdong', 'central', 3, { beach: true, highland: true }),
  S('rest'),
  P('dongnai', 'south', 3), P('tayninh', 'south', 2), P('hcmc', 'south', 5, { slots: 3, beach: true }), P('dongthap', 'south', 2),
  P('vinhlong', 'south', 2), P('cantho', 'south', 3), P('angiang', 'south', 3, { beach: true }), P('camau', 'south', 1),
];

export type EventId =
  | 'normal' | 'tet' | 'storm' | 'summer' | 'fireworks' | 'boom' | 'crisis' | 'rates' | 'inflation' | 'harvest' | 'coffee';
// One event per month, shuffled at the start; two quiet months.
const EVENT_DECK: EventId[] = ['normal', 'normal', 'tet', 'storm', 'summer', 'fireworks', 'boom', 'crisis', 'rates', 'inflation', 'harvest', 'coffee'];

export const MONTHS = 12;
export const START_CASH = 2000;
export const SALARY = 150;
export const AIRPORT_FEE = 100;
export const FESTIVAL_GIFT = 30;
export const BANK_BONUS = 50;
export const HAND_SIZE = 3;
export const MAX_HAND = 5;
export const MAX_CARD = 8;
export const LOAN_STEP = 50;
export const OFFER_MS = 30_000;
const TIER_PRICE = [0, 80, 120, 180, 250, 320];
const BIZ_FACTOR: Record<BizType, number> = { food: 1, inn: 1.5, shop: 2 };
// A visit pays this share of the business price, times the level multiplier.
const FEE_RATE = 0.5;
const LEVEL_FEE = [0, 1, 2.5, 4.5];
export const MAX_LEVEL = 3;
const UPGRADE_RATE = 0.6;
const LOG_LIMIT = 80;
const MAX_TRADE_CASH = 1_000_000;

export interface Business {
  id: string;
  square: number;
  owner: string;
  type: BizType;
  level: number;
  // Total paid for it (price plus upgrades); counts towards net worth.
  invested: number;
}

export interface TyPhuPlayer {
  id: string;
  position: number;
  cash: number;
  debt: number;
  // Move cards: each lets the player move exactly that many squares.
  hand: number[];
  out: boolean;
  // Landed on the bank this month while in debt: no interest at month end.
  interestWaived: boolean;
  // Month a bot last proposed a trade, so it doesn't pester people.
  lastOfferMonth: number;
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

export type Phase = 'move' | 'act' | 'fly';

export type TyPhuLogEntry =
  | { kind: 'roll'; player: string; dice: [number, number]; to: number; auto: boolean }
  | { kind: 'card'; player: string; value: number; to: number }
  | { kind: 'pay'; player: string; square: number; total: number; owners: { id: string; amount: number }[] }
  | { kind: 'buy'; player: string; square: number; biz: BizType; price: number }
  | { kind: 'upgrade'; player: string; square: number; biz: BizType; level: number; price: number }
  | { kind: 'market'; player: string; value: number | null }
  | { kind: 'bank'; player: string; bonus: number | null }
  | { kind: 'fly'; player: string; to: number }
  | { kind: 'festival'; player: string; total: number }
  | { kind: 'loan'; player: string; amount: number; auto: boolean }
  | { kind: 'repay'; player: string; amount: number }
  | { kind: 'interest'; player: string; amount: number }
  | { kind: 'trade'; from: string; to: string }
  | { kind: 'month'; month: number; event: EventId }
  | { kind: 'left'; player: string };

export interface TyPhuResult {
  // Richest first; players who left come last.
  ranking: string[];
  worth: Record<string, number>;
}

export interface TyPhuState {
  // Turn order within each month.
  seats: string[];
  players: Record<string, TyPhuPlayer>;
  businesses: Business[];
  month: number;
  events: EventId[];
  turn: string | null;
  phase: Phase;
  lastMove: { player: string; dice: [number, number] | null; value: number; from: number; to: number } | null;
  offers: TradeOffer[];
  nextOfferId: number;
  log: TyPhuLogEntry[];
  result: TyPhuResult | null;
  turnLimitMs: number | null;
  turnDeadline: number | null;
}

export type TyPhuMove =
  | { type: 'roll' }
  | { type: 'card'; index: number }
  | { type: 'buy'; biz: BizType }
  | { type: 'upgrade'; id: string }
  | { type: 'end' }
  | { type: 'fly'; to: number }
  | { type: 'stay' }
  | { type: 'borrow'; amount: number }
  | { type: 'repay'; amount: number }
  | { type: 'offer'; to: string; giveCash: number; getCash: number; give: string[]; get: string[] }
  | { type: 'accept'; id: number }
  | { type: 'decline'; id: number }
  | { type: 'cancel'; id: number };

export interface TyPhuView {
  seats: { id: string; position: number; cash: number; debt: number; worth: number; cards: number; out: boolean }[];
  businesses: Business[];
  // The viewer's own move cards (empty for spectators).
  hand: number[];
  month: number;
  event: EventId;
  nextEvent: EventId | null;
  turn: string | null;
  phase: Phase;
  lastMove: TyPhuState['lastMove'];
  // Offers the viewer made or received.
  offers: TradeOffer[];
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
export function bizPrice(square: ProvinceSquare, type: BizType, event: EventId = 'normal'): number {
  return round10(TIER_PRICE[square.tier] * BIZ_FACTOR[type] * (event === 'inflation' ? 1.2 : 1));
}

export function upgradePrice(square: ProvinceSquare, type: BizType, event: EventId = 'normal'): number {
  return round10(bizPrice(square, type) * UPGRADE_RATE * (event === 'inflation' ? 1.2 : 1));
}

// How much the month's event scales fees at this square.
export function eventFactor(event: EventId, square: ProvinceSquare): number {
  switch (event) {
    case 'tet':
      return square.region === 'central' ? 1 : 2;
    case 'storm':
      return square.region === 'central' ? 0 : 1;
    case 'summer':
      return square.beach ? 2 : 1;
    case 'fireworks':
      return square.id === 'danang' ? 3 : 1;
    case 'boom':
      return 1.5;
    case 'crisis':
      return 0.5;
    case 'harvest':
      return square.region === 'south' ? 1.5 : 1;
    case 'coffee':
      return square.highland ? 2 : 1;
    default:
      return 1;
  }
}

export function interestRate(event: EventId): number {
  return event === 'rates' ? 0.15 : 0.1;
}

// Chain bonus: the same business type in two regions earns ×1.25, in all three ×1.5.
export function chainFactor(businesses: Business[], owner: string, type: BizType): number {
  const regions = new Set(
    businesses.filter((b) => b.owner === owner && b.type === type).map((b) => (BOARD[b.square] as ProvinceSquare).region),
  );
  return regions.size >= 3 ? 1.5 : regions.size === 2 ? 1.25 : 1;
}

// What a visitor pays the owner of this business this month.
export function visitFee(businesses: Business[], b: Business, event: EventId): number {
  const square = BOARD[b.square] as ProvinceSquare;
  return round10(bizPrice(square, b.type) * FEE_RATE * LEVEL_FEE[b.level] * chainFactor(businesses, b.owner, b.type) * eventFactor(event, square));
}

export function netWorth(s: Pick<TyPhuState, 'players' | 'businesses'>, id: string): number {
  const p = s.players[id];
  const assets = s.businesses.filter((b) => b.owner === id).reduce((sum, b) => sum + b.invested, 0);
  return p.cash + assets - p.debt;
}

// Business types still free at a province square.
export function freeTypes(s: Pick<TyPhuState, 'businesses'>, square: number): BizType[] {
  const sq = BOARD[square];
  if (sq.kind !== 'province') return [];
  const here = s.businesses.filter((b) => b.square === square);
  if (here.length >= sq.slots) return [];
  return BIZ_TYPES.filter((t) => !here.some((b) => b.type === t));
}

export function upgradable(s: Pick<TyPhuState, 'businesses'>, square: number, player: string): Business[] {
  return s.businesses.filter((b) => b.square === square && b.owner === player && b.level < MAX_LEVEL);
}

// Fees a player would pay on landing here this month.
export function feesAt(s: Pick<TyPhuState, 'businesses' | 'players'>, square: number, player: string, event: EventId): number {
  return s.businesses
    .filter((b) => b.square === square && b.owner !== player && !s.players[b.owner]?.out)
    .reduce((sum, b) => sum + visitFee(s.businesses, b, event), 0);
}

// ---- State helpers ----

const withLog = (s: TyPhuState, ...entries: TyPhuLogEntry[]): TyPhuState => ({ ...s, log: [...s.log, ...entries].slice(-LOG_LIMIT) });

const activeIds = (s: TyPhuState) => s.seats.filter((id) => !s.players[id].out);

const drawCard = (random: () => number) => 1 + Math.floor(random() * MAX_CARD);

function updatePlayer(s: TyPhuState, id: string, patch: Partial<TyPhuPlayer>): TyPhuState {
  return { ...s, players: { ...s.players, [id]: { ...s.players[id], ...patch } } };
}

// Takes money from a player; whatever their cash can't cover is borrowed automatically.
function charge(s: TyPhuState, id: string, amount: number): TyPhuState {
  const p = s.players[id];
  const cash = p.cash - amount;
  if (cash >= 0) return updatePlayer(s, id, { cash });
  const loan = Math.ceil(-cash / LOAN_STEP) * LOAN_STEP;
  return withLog(updatePlayer(s, id, { cash: cash + loan, debt: p.debt + loan }), { kind: 'loan', player: id, amount: loan, auto: true });
}

function credit(s: TyPhuState, id: string, amount: number): TyPhuState {
  return updatePlayer(s, id, { cash: s.players[id].cash + amount });
}

function startTurn(s: TyPhuState, turn: string | null, now: number): TyPhuState {
  return { ...s, turn, phase: 'move', turnDeadline: turn && s.turnLimitMs ? now + s.turnLimitMs : null };
}

function finish(s: TyPhuState): TyPhuState {
  const worth = Object.fromEntries(s.seats.map((id) => [id, netWorth(s, id)]));
  const leftOrder = s.log.flatMap((e) => (e.kind === 'left' ? [e.player] : []));
  const ranking = [
    ...activeIds(s).sort((a, b) => worth[b] - worth[a] || s.seats.indexOf(a) - s.seats.indexOf(b)),
    ...leftOrder.reverse(),
  ];
  return { ...s, turn: null, turnDeadline: null, offers: [], result: { ranking, worth } };
}

function endMonth(s: TyPhuState, now: number): TyPhuState {
  const event = eventOf(s);
  let next = s;
  for (const id of activeIds(s)) {
    next = credit(next, id, SALARY);
    const p = next.players[id];
    if (p.debt > 0 && !p.interestWaived) {
      const interest = Math.ceil((p.debt * interestRate(event)) / 10) * 10;
      next = withLog(charge(next, id, interest), { kind: 'interest', player: id, amount: interest });
    }
    next = updatePlayer(next, id, { interestWaived: false });
  }
  if (s.month >= MONTHS) return finish({ ...next, month: MONTHS });
  next = { ...next, month: s.month + 1 };
  next = withLog(next, { kind: 'month', month: next.month, event: eventOf(next) });
  return startTurn(next, activeIds(next)[0] ?? null, now);
}

// Passes the turn on; after the last seat the month ends.
function endTurn(s: TyPhuState, now: number): TyPhuState {
  const from = s.turn;
  const i = from ? s.seats.indexOf(from) : -1;
  const later = s.seats.slice(i + 1).find((id) => !s.players[id].out);
  return later ? startTurn(s, later, now) : endMonth(s, now);
}

// Whether the player has a decision to make on the square they're standing on.
function hasChoice(s: TyPhuState, id: string): boolean {
  const pos = s.players[id].position;
  return freeTypes(s, pos).length > 0 || upgradable(s, pos, id).length > 0;
}

function land(s: TyPhuState, id: string, now: number, random: () => number): TyPhuState {
  const pos = s.players[id].position;
  const square = BOARD[pos];
  const event = eventOf(s);
  let next = s;
  switch (square.kind) {
    case 'province': {
      const owners = s.businesses
        .filter((b) => b.square === pos && b.owner !== id && !s.players[b.owner].out)
        .map((b) => ({ id: b.owner, amount: visitFee(s.businesses, b, event) }))
        .filter((o) => o.amount > 0);
      const total = owners.reduce((sum, o) => sum + o.amount, 0);
      if (total > 0) {
        next = withLog(next, { kind: 'pay', player: id, square: pos, total, owners });
        next = charge(next, id, total);
        for (const o of owners) next = credit(next, o.id, o.amount);
      }
      return hasChoice(next, id) ? { ...next, phase: 'act' } : endTurn(next, now);
    }
    case 'market': {
      const hand = next.players[id].hand;
      const value = hand.length < MAX_HAND ? drawCard(random) : null;
      if (value !== null) next = updatePlayer(next, id, { hand: [...hand, value] });
      return endTurn(withLog(next, { kind: 'market', player: id, value }), now);
    }
    case 'bank': {
      const inDebt = next.players[id].debt > 0;
      next = inDebt ? updatePlayer(next, id, { interestWaived: true }) : credit(next, id, BANK_BONUS);
      return endTurn(withLog(next, { kind: 'bank', player: id, bonus: inDebt ? null : BANK_BONUS }), now);
    }
    case 'festival': {
      const others = activeIds(next).filter((o) => o !== id);
      for (const o of others) next = charge(next, o, FESTIVAL_GIFT);
      next = credit(next, id, FESTIVAL_GIFT * others.length);
      return endTurn(withLog(next, { kind: 'festival', player: id, total: FESTIVAL_GIFT * others.length }), now);
    }
    case 'airport':
      return next.players[id].cash >= AIRPORT_FEE ? { ...next, phase: 'fly' } : endTurn(next, now);
    default:
      return endTurn(next, now);
  }
}

function moveBy(s: TyPhuState, id: string, steps: number): TyPhuState {
  return updatePlayer(s, id, { position: (s.players[id].position + steps) % BOARD.length });
}

const isAmount = (n: unknown, max = MAX_TRADE_CASH): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= max;

function validOffer(s: TyPhuState, o: Omit<TradeOffer, 'id' | 'expiresAt'>): boolean {
  if (!s.players[o.to] || s.players[o.to].out || o.to === o.from) return false;
  if (!isAmount(o.giveCash) || !isAmount(o.getCash)) return false;
  if (!Array.isArray(o.give) || !Array.isArray(o.get) || new Set(o.give).size !== o.give.length || new Set(o.get).size !== o.get.length) return false;
  const owns = (ids: string[], owner: string) => ids.every((bid) => s.businesses.some((b) => b.id === bid && b.owner === owner));
  if (!owns(o.give, o.from) || !owns(o.get, o.to)) return false;
  return o.giveCash + o.getCash + o.give.length + o.get.length > 0;
}

function applyTrade(s: TyPhuState, o: TradeOffer): TyPhuState | null {
  if (!validOffer(s, o)) return null;
  if (s.players[o.from].cash < o.giveCash || s.players[o.to].cash < o.getCash) return null;
  let next = credit(credit(s, o.from, o.getCash - o.giveCash), o.to, o.giveCash - o.getCash);
  next = {
    ...next,
    businesses: next.businesses.map((b) =>
      o.give.includes(b.id) ? { ...b, owner: o.to } : o.get.includes(b.id) ? { ...b, owner: o.from } : b,
    ),
  };
  // Offers that relied on the traded businesses no longer make sense.
  const moved = new Set([...o.give, ...o.get]);
  next = { ...next, offers: next.offers.filter((x) => x.id !== o.id && ![...x.give, ...x.get].some((id) => moved.has(id))) };
  return withLog(next, { kind: 'trade', from: o.from, to: o.to });
}

const fail = { ok: false as const, error: 'INVALID_MOVE' as const };

// ---- Bots ----

// How attractive landing on a square is for a player: fees count against, chances to invest for.
function landingScore(s: TyPhuState, id: string, square: number): number {
  const sq = BOARD[square];
  const event = eventOf(s);
  switch (sq.kind) {
    case 'province': {
      let score = -feesAt(s, square, id, event);
      if (freeTypes(s, square).length > 0) score += 30 + sq.tier * 10;
      if (upgradable(s, square, id).length > 0) score += 40;
      return score;
    }
    case 'market':
      return 25;
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
  let bestScore = dice + 15; // keep cards unless one is clearly better
  hand.forEach((v, i) => {
    const score = landingScore(s, id, (pos + v) % BOARD.length);
    if (score > bestScore) [best, bestScore] = [i, score];
  });
  return best >= 0 ? { type: 'card', index: best } : { type: 'roll' };
}

const BOT_RESERVE = 150;

function botAct(s: TyPhuState, id: string): TyPhuMove {
  const p = s.players[id];
  const square = BOARD[p.position] as ProvinceSquare;
  const event = eventOf(s);
  const types = freeTypes(s, p.position)
    .filter((t) => p.cash - bizPrice(square, t, event) >= BOT_RESERVE)
    // Prefer types that extend a chain, then the priciest affordable one.
    .sort((a, b) => chainFactor(s.businesses, id, b) - chainFactor(s.businesses, id, a) || bizPrice(square, b) - bizPrice(square, a));
  if (types.length > 0) return { type: 'buy', biz: types[0] };
  const up = upgradable(s, p.position, id)
    .filter((b) => p.cash - upgradePrice(square, b.type, event) >= BOT_RESERVE)
    .sort((a, b) => bizPrice(square, b.type) - bizPrice(square, a.type));
  if (up.length > 0) return { type: 'upgrade', id: up[0].id };
  return { type: 'end' };
}

function botFly(s: TyPhuState, id: string): TyPhuMove {
  if (s.players[id].cash < AIRPORT_FEE + 300) return { type: 'stay' };
  let best = -1;
  let bestScore = 60;
  BOARD.forEach((sq, i) => {
    if (sq.kind === 'airport') return;
    const score = landingScore(s, id, i);
    if (score > bestScore) [best, bestScore] = [i, score];
  });
  return best >= 0 ? { type: 'fly', to: best } : { type: 'stay' };
}

// A bot values its own businesses a little above cost, and more if they hold a chain together.
function botValue(s: TyPhuState, id: string, bizIds: string[], gaining: boolean): number {
  return bizIds.reduce((sum, bid) => {
    const b = s.businesses.find((x) => x.id === bid)!;
    const chainBefore = chainFactor(s.businesses, id, b.type);
    const after = s.businesses.map((x) => (x.id === bid ? { ...x, owner: gaining ? id : '' } : x));
    const chainAfter = chainFactor(after, id, b.type);
    const chainWorth = Math.abs(chainAfter - chainBefore) * 2 * b.invested;
    return sum + b.invested * (gaining ? 1 : 1.15) + chainWorth;
  }, 0);
}

function botAnswer(s: TyPhuState, id: string, o: TradeOffer): TyPhuMove {
  if (s.players[id].cash < o.getCash || s.players[o.from].cash < o.giveCash) return { type: 'decline', id: o.id };
  const gain = o.giveCash + botValue(s, id, o.give, true);
  const loss = o.getCash + botValue(s, id, o.get, false);
  return gain >= loss * 1.05 ? { type: 'accept', id: o.id } : { type: 'decline', id: o.id };
}

// Looks for one business that would complete a three-region chain and offers a premium for it.
function botProposal(s: TyPhuState, id: string): TyPhuMove | null {
  const p = s.players[id];
  if (s.month - p.lastOfferMonth < 3 || s.offers.some((o) => o.from === id)) return null;
  for (const type of BIZ_TYPES) {
    if (chainFactor(s.businesses, id, type) !== 1.25) continue;
    const mine = new Set(s.businesses.filter((b) => b.owner === id && b.type === type).map((b) => (BOARD[b.square] as ProvinceSquare).region));
    const target = s.businesses.find(
      (b) => b.type === type && b.owner !== id && !s.players[b.owner].out && !mine.has((BOARD[b.square] as ProvinceSquare).region),
    );
    if (!target) continue;
    const price = round10(target.invested * 1.4);
    if (p.cash - price < 300) continue;
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
    const seats = [...playerIds];
    for (let i = seats.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [seats[i], seats[j]] = [seats[j], seats[i]];
    }
    const events = [...EVENT_DECK];
    for (let i = events.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [events[i], events[j]] = [events[j], events[i]];
    }
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
          interestWaived: false,
          lastOfferMonth: 0,
        },
      ]),
    );
    const base: TyPhuState = {
      seats,
      players,
      businesses: [],
      month: 1,
      events,
      turn: null,
      phase: 'move',
      lastMove: null,
      offers: [],
      nextOfferId: 1,
      log: [{ kind: 'month', month: 1, event: events[0] }],
      result: null,
      turnLimitMs: TURN_TIMERS[options.turnTimer] ?? null,
      turnDeadline: null,
    };
    return startTurn(base, seats[0], now);
  },

  applyMove(state, playerId, move, { now, random = Math.random }) {
    if (state.result) return { ok: false, error: 'GAME_OVER' };
    const me = state.players[playerId];
    if (!me || me.out) return { ok: false, error: 'NOT_A_PLAYER' };
    if (typeof move !== 'object' || move === null) return fail;

    // Money and trades don't wait for your turn.
    switch (move.type) {
      case 'borrow': {
        if (!isAmount(move.amount, 100_000) || move.amount === 0 || move.amount % LOAN_STEP !== 0) return fail;
        const next = updatePlayer(state, playerId, { cash: me.cash + move.amount, debt: me.debt + move.amount });
        return { ok: true, state: withLog(next, { kind: 'loan', player: playerId, amount: move.amount, auto: false }) };
      }
      case 'repay': {
        const amount = Math.min(move.amount, me.debt, me.cash);
        if (!isAmount(move.amount) || amount <= 0) return fail;
        const next = updatePlayer(state, playerId, { cash: me.cash - amount, debt: me.debt - amount });
        return { ok: true, state: withLog(next, { kind: 'repay', player: playerId, amount }) };
      }
      case 'offer': {
        const offer = { from: playerId, to: move.to, giveCash: move.giveCash, getCash: move.getCash, give: move.give, get: move.get };
        if (!validOffer(state, offer)) return fail;
        const created: TradeOffer = { ...offer, give: [...offer.give], get: [...offer.get], id: state.nextOfferId, expiresAt: now + OFFER_MS };
        // One open offer per player: a new one replaces the old.
        const offers = [...state.offers.filter((o) => o.from !== playerId), created];
        const next = updatePlayer({ ...state, offers, nextOfferId: state.nextOfferId + 1 }, playerId, { lastOfferMonth: state.month });
        return { ok: true, state: next };
      }
      case 'accept':
      case 'decline':
      case 'cancel': {
        const offer = state.offers.find((o) => o.id === move.id);
        if (!offer || (move.type === 'cancel' ? offer.from : offer.to) !== playerId) return fail;
        if (move.type !== 'accept') return { ok: true, state: { ...state, offers: state.offers.filter((o) => o !== offer) } };
        const traded = applyTrade(state, offer);
        return traded ? { ok: true, state: traded } : fail;
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
          const hand = me.hand.filter((_, i) => i !== move.index);
          next = updatePlayer(next, playerId, { hand: [...hand, drawCard(random)] });
        }
        next = moveBy(next, playerId, steps);
        const to = next.players[playerId].position;
        next = { ...next, lastMove: { player: playerId, dice, value: steps, from: pos, to } };
        next = withLog(next, dice ? { kind: 'roll', player: playerId, dice, to, auto: false } : { kind: 'card', player: playerId, value: steps, to });
        return { ok: true, state: land(next, playerId, now, random) };
      }
      case 'buy': {
        const square = BOARD[pos];
        if (state.phase !== 'act' || square.kind !== 'province' || !freeTypes(state, pos).includes(move.biz)) return fail;
        const price = bizPrice(square, move.biz, eventOf(state));
        if (me.cash < price) return fail;
        const biz: Business = { id: `${pos}-${move.biz}`, square: pos, owner: playerId, type: move.biz, level: 1, invested: price };
        let next = updatePlayer(state, playerId, { cash: me.cash - price });
        next = withLog({ ...next, businesses: [...next.businesses, biz] }, { kind: 'buy', player: playerId, square: pos, biz: move.biz, price });
        return { ok: true, state: endTurn(next, now) };
      }
      case 'upgrade': {
        const square = BOARD[pos];
        const biz = upgradable(state, pos, playerId).find((b) => b.id === move.id);
        if (state.phase !== 'act' || square.kind !== 'province' || !biz) return fail;
        const price = upgradePrice(square, biz.type, eventOf(state));
        if (me.cash < price) return fail;
        let next = updatePlayer(state, playerId, { cash: me.cash - price });
        next = {
          ...next,
          businesses: next.businesses.map((b) => (b === biz ? { ...b, level: b.level + 1, invested: b.invested + price } : b)),
        };
        next = withLog(next, { kind: 'upgrade', player: playerId, square: pos, biz: biz.type, level: biz.level + 1, price });
        return { ok: true, state: endTurn(next, now) };
      }
      case 'end':
        return state.phase === 'act' ? { ok: true, state: endTurn(state, now) } : fail;
      case 'fly': {
        if (state.phase !== 'fly' || !Number.isInteger(move.to) || move.to < 0 || move.to >= BOARD.length) return fail;
        if (BOARD[move.to].kind === 'airport' || me.cash < AIRPORT_FEE) return fail;
        let next = updatePlayer(state, playerId, { cash: me.cash - AIRPORT_FEE, position: move.to });
        next = withLog({ ...next, phase: 'move', lastMove: { player: playerId, dice: null, value: 0, from: pos, to: move.to } }, { kind: 'fly', player: playerId, to: move.to });
        return { ok: true, state: land(next, playerId, now, random) };
      }
      case 'stay':
        return state.phase === 'fly' ? { ok: true, state: endTurn(state, now) } : fail;
    }
    return fail;
  },

  forfeit(state, playerId, { now }) {
    if (state.result || !state.players[playerId] || state.players[playerId].out) return state;
    // Their businesses close and the slots open up again.
    let next: TyPhuState = updatePlayer(state, playerId, { out: true, hand: [] });
    next = {
      ...next,
      businesses: next.businesses.filter((b) => b.owner !== playerId),
      offers: next.offers.filter((o) => o.from !== playerId && o.to !== playerId),
    };
    next = withLog(next, { kind: 'left', player: playerId });
    if (activeIds(next).length < 2) return finish(next);
    return state.turn === playerId ? endTurn(next, now) : next;
  },

  isOver(state) {
    return state.result !== null;
  },

  playerView(state, playerId, { now }) {
    return {
      seats: state.seats.map((id) => {
        const p = state.players[id];
        return { id, position: p.position, cash: p.cash, debt: p.debt, worth: netWorth(state, id), cards: p.hand.length, out: p.out };
      }),
      businesses: state.businesses,
      hand: state.players[playerId]?.hand ?? [],
      month: state.month,
      event: eventOf(state),
      nextEvent: state.month < MONTHS ? state.events[state.month] : null,
      turn: state.turn,
      phase: state.phase,
      lastMove: state.lastMove,
      offers: state.offers.filter((o) => o.from === playerId || o.to === playerId),
      log: state.log,
      result: state.result,
      turnMs: state.turnDeadline === null ? null : Math.max(0, state.turnDeadline - now),
      turnLimitMs: state.turnLimitMs,
    };
  },

  deadline(state) {
    if (state.result) return null;
    const times = [state.turnDeadline, ...state.offers.map((o) => o.expiresAt)].filter((t): t is number => t !== null);
    return times.length ? Math.min(...times) : null;
  },

  // Expired offers lapse; a player out of time rolls, skips buying or stays put.
  timeout(state, { now, random = Math.random }) {
    if (state.result) return state;
    let next = state;
    if (state.offers.some((o) => o.expiresAt <= now)) next = { ...next, offers: next.offers.filter((o) => o.expiresAt > now) };
    if (next.turn && next.turnDeadline !== null && now >= next.turnDeadline) {
      const player = next.turn;
      if (next.phase === 'move') {
        const r = typhuGame.applyMove(next, player, { type: 'roll' }, { now, random });
        if (r.ok) {
          // Mark the roll as automatic in the log.
          const i = r.state.log.map((e) => e.kind).lastIndexOf('roll');
          next = { ...r.state, log: r.state.log.map((e, j) => (j === i && e.kind === 'roll' ? { ...e, auto: true } : e)) };
        }
      } else next = endTurn(next, now);
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
};
