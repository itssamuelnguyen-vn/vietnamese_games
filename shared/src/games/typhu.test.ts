import { describe, expect, it } from 'vitest';
import type { RoomOptions } from '../types';
import {
  ANIM,
  AUCTION_EXTEND_MS,
  AUCTION_MS,
  BID_STEP,
  BOARD,
  FORTUNE,
  LOAN_BASE,
  MAX_MONTHS,
  ROUTES,
  ROUTES_TO_WIN,
  SALARY,
  START_CASH,
  TAX_MIN,
  auctionStart,
  bizPrice,
  chainFactor,
  creditLimit,
  heldRoutes,
  moveMs,
  netWorth,
  salePrice,
  takeoverPrice,
  typhuGame,
  upgradePrice,
  visitFee,
  type Business,
  type Deck,
  type FortuneId,
  type StreetSquare,
  type TyPhuMove,
  type TyPhuState,
} from './typhu';

const options: RoomOptions = { timeControl: 'none', hostColor: 'random', handicap: 'none', turnTimer: 'none', houseRules: [], caroSize: '15', caroBlock: true, caNguaRules: [], stakes: 'points', walletStart: 200_000, stakePerPoint: 5_000, xiDachDealer: null };

// Deterministic randomness for shuffles, dice and cards.
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
// Feeds fixed values: a die showing d comes from (d - 0.5) / 6, a move card c from (c - 0.5) / 8.
const fixed = (...values: number[]) => () => values.shift() ?? 0;
const die = (d: number) => (d - 0.5) / 6;

const index = (id: string) => BOARD.findIndex((s) => s.kind === 'street' && s.id === id);
const special = (kind: string) => BOARD.findIndex((s) => s.kind === kind);
const street = (id: string) => BOARD[index(id)] as StreetSquare;

// Two or more players at the start in seat order, with known hands.
function game(ids = ['a', 'b'], extra: Partial<TyPhuState> = {}): TyPhuState {
  const s = typhuGame.setup(ids, options, { now: 0, random: seeded(1) }, null);
  const players = Object.fromEntries(ids.map((id) => [id, { ...s.players[id], hand: [1, 2, 3] }]));
  return { ...s, seats: ids, players, turn: ids[0], events: Array(MAX_MONTHS).fill('normal'), ...extra };
}

function act(s: TyPhuState, player: string, move: TyPhuMove, random: () => number = seeded(2), now = 0) {
  const r = typhuGame.applyMove(s, player, move, { now, random });
  if (!r.ok) throw new Error(`${player} ${JSON.stringify(move)}: ${r.error}`);
  return r.state;
}

const at = (s: TyPhuState, id: string, position: number) => ({ ...s, players: { ...s.players, [id]: { ...s.players[id], position } } });
const withCash = (s: TyPhuState, id: string, cash: number, debt = s.players[id].debt) => ({ ...s, players: { ...s.players, [id]: { ...s.players[id], cash, debt } } });
// The next card drawn from a deck.
const stack = (s: TyPhuState, deck: Deck, card: FortuneId) => ({ ...s, decks: { ...s.decks, [deck]: [card] } });
const biz = (owner: string, name: string, type: Business['type'], level = 1): Business => ({
  id: `${index(name)}-${type}`,
  square: index(name),
  owner,
  type,
  level,
  invested: bizPrice(street(name), type),
});
// Plays the move card that lands `player` exactly on `square`, from one square before it.
const landOn = (s: TyPhuState, player: string, square: number, random?: () => number, now?: number) =>
  act(at(s, player, (square - 1 + BOARD.length) % BOARD.length), player, { type: 'card', index: 0 }, random, now);

describe('co ti phu', () => {
  it('is a loop of 28 squares: 16 streets in 8 routes of two, and 12 special squares', () => {
    expect(BOARD).toHaveLength(28);
    expect(BOARD.filter((s) => s.kind === 'street')).toHaveLength(16);
    expect(new Set(BOARD.flatMap((s) => (s.kind === 'street' ? [s.id] : []))).size).toBe(16);
    expect(ROUTES).toHaveLength(8);
    expect(ROUTES.every((r) => r.length === 2)).toBe(true);
    // The corners are special squares.
    for (const corner of [0, 7, 14, 21]) expect(BOARD[corner].kind).not.toBe('street');
  });

  it('deals cash and three move cards, and starts month 1 once its banner has shown', () => {
    const s = typhuGame.setup(['a', 'b', 'c'], { ...options, turnTimer: '30' }, { now: 1000, random: seeded(3) }, null);
    expect(s.seats.toSorted()).toEqual(['a', 'b', 'c']);
    expect(s.turn).toBe(s.seats[0]);
    for (const id of s.seats) {
      expect(s.players[id]).toMatchObject({ cash: START_CASH, debt: 0, position: 0 });
      expect(s.players[id].hand).toHaveLength(3);
    }
    // Three years of events, each year a shuffle of the same twelve.
    expect(s.events).toHaveLength(36);
    expect(s.events.slice(12, 24).toSorted()).toEqual(s.events.slice(0, 12).toSorted());
    expect(s.log[0]).toEqual({ kind: 'month', month: 1, event: s.events[0] });
    expect(s.busyUntil).toBe(1000 + ANIM.month);
    expect(s.turnDeadline).toBe(1000 + ANIM.month + 30_000);
  });

  it('only shows a player their own move cards', () => {
    const view = typhuGame.playerView(game(), 'a', { now: 0 });
    expect(view.hand).toEqual([1, 2, 3]);
    expect(view.seats.find((p) => p.id === 'b')).toMatchObject({ cards: 3 });
    expect(JSON.stringify(view.seats)).not.toContain('hand');
  });

  it('rolls two dice, lands, and may open a business', () => {
    // 1 + 1 = 2 squares: Quang Trung.
    const s = act(game(), 'a', { type: 'roll' }, fixed(die(1), die(1)));
    expect(s.players.a.position).toBe(index('quangtrung'));
    expect(s.phase).toBe('act');
    const price = bizPrice(street('quangtrung'), 'inn');
    const bought = act(s, 'a', { type: 'buy', biz: 'inn' });
    expect(bought.players.a.cash).toBe(START_CASH - price);
    expect(bought.businesses).toEqual([biz('a', 'quangtrung', 'inn')]);
    expect(bought.turn).toBe('b');
    expect(() => act(bought, 'a', { type: 'roll' })).toThrow('NOT_YOUR_TURN');
  });

  it('a move card moves exactly that far and is used up', () => {
    const s = act(game(), 'a', { type: 'card', index: 1 }, fixed(0.99));
    expect(s.players.a.position).toBe(2);
    expect(s.players.a.hand).toEqual([1, 3]);
  });

  it('passing the start earns a new move card', () => {
    const s = act(at(game(), 'a', BOARD.length - 2), 'a', { type: 'card', index: 2 }, fixed(0.99));
    expect(s.players.a.position).toBe(1);
    expect(s.players.a.hand).toEqual([1, 2, 8]);
  });

  describe('pacing', () => {
    it('holds the clock and bots until the dice, the walk and the result have been shown', () => {
      const s = act({ ...game(), turnLimitMs: 30_000 }, 'a', { type: 'roll' }, fixed(die(3), die(4)), 5000);
      expect(s.busyUntil).toBe(5000 + moveMs(7, true));
      expect(moveMs(7, true)).toBe(ANIM.roll + 7 * ANIM.step + ANIM.result);
      expect(typhuGame.busyUntil!(s)).toBe(s.busyUntil);
      // Whoever is up next only starts their clock once it's all over.
      expect(s.turnDeadline).toBe(s.busyUntil + 30_000);
    });

    it('adds the new month banner when a move ends the month', () => {
      let s = landOn(game(), 'a', special('bank'), undefined, 0);
      s = landOn(s, 'b', special('bank'), undefined, 100);
      expect(s.month).toBe(2);
      expect(s.busyUntil).toBe(100 + moveMs(1, false) + ANIM.month);
    });
  });

  it('visitors pay every owner on a street', () => {
    const businesses = [biz('b', 'quangtrung', 'food'), biz('c', 'quangtrung', 'inn')];
    const s = act(game(['a', 'b', 'c'], { businesses }), 'a', { type: 'card', index: 1 });
    const food = visitFee(businesses, businesses[0], 'normal');
    const inn = visitFee(businesses, businesses[1], 'normal');
    expect(s.players.a.cash).toBe(START_CASH - food - inn);
    expect(s.players.b.cash).toBe(START_CASH + food);
    expect(s.players.c.cash).toBe(START_CASH + inn);
    expect(s.log.at(-1)).toMatchObject({ kind: 'pay', player: 'a', total: food + inn });
    // Both slots are taken, but a may take one over.
    expect(s.phase).toBe('act');
  });

  it('each business type appears once per street, up to its slots', () => {
    const s = at(game(['a', 'b'], { businesses: [biz('b', 'dongkhoi', 'food')] }), 'a', index('dongkhoi') - 1);
    const landed = act(s, 'a', { type: 'card', index: 0 });
    expect(() => act(landed, 'a', { type: 'buy', biz: 'food' })).toThrow('INVALID_MOVE');
    expect(act(landed, 'a', { type: 'buy', biz: 'shop' }).businesses).toHaveLength(2);
  });

  it('upgrades your own business when you land on it again', () => {
    const own = biz('a', 'quangtrung', 'food');
    const s = act(game(['a', 'b'], { businesses: [own] }), 'a', { type: 'card', index: 1 });
    expect(s.phase).toBe('act');
    const up = act(s, 'a', { type: 'upgrade', id: own.id });
    expect(up.businesses[0]).toMatchObject({ level: 2 });
    expect(up.businesses[0].invested).toBeGreaterThan(own.invested);
    expect(visitFee(up.businesses, up.businesses[0], 'normal')).toBeGreaterThan(visitFee([own], own, 'normal'));
  });

  it('chains of one business type across the city earn more', () => {
    const outer = biz('a', 'quangtrung', 'shop');
    const inner = biz('a', 'xvnt', 'shop');
    const center = biz('a', 'dongkhoi', 'shop');
    expect(chainFactor([outer], 'a', 'shop')).toBe(1);
    expect(chainFactor([outer, inner], 'a', 'shop')).toBe(1.25);
    expect(chainFactor([outer, inner, center], 'a', 'shop')).toBe(1.5);
    expect(chainFactor([outer, inner, center], 'a', 'food')).toBe(1);
  });

  it('events change fees: floods shut low streets, fireworks triple the riverside, Tet doubles the centre and Cho Lon', () => {
    const xvnt = biz('a', 'xvnt', 'inn');
    const dongkhoi = biz('a', 'dongkhoi', 'inn');
    const cholon = biz('a', 'tranhungdao', 'inn');
    const quangtrung = biz('a', 'quangtrung', 'inn');
    // Fees round to tens after the event's factor is applied.
    const near = (fee: number, expected: number) => expect(Math.abs(fee - expected)).toBeLessThanOrEqual(10);
    expect(visitFee([xvnt], xvnt, 'flood')).toBe(0);
    near(visitFee([dongkhoi], dongkhoi, 'fireworks'), 3 * visitFee([dongkhoi], dongkhoi, 'normal'));
    near(visitFee([cholon], cholon, 'tet'), 2 * visitFee([cholon], cholon, 'normal'));
    expect(visitFee([quangtrung], quangtrung, 'tet')).toBe(visitFee([quangtrung], quangtrung, 'normal'));
  });

  describe('routes', () => {
    it('a business on both streets of a route doubles its fees', () => {
      const one = [biz('a', 'phanvantri', 'food')];
      const both = [...one, biz('a', 'quangtrung', 'food')];
      expect(heldRoutes(one, 'a')).toEqual([]);
      expect(heldRoutes(both, 'a')).toEqual([0]);
      // Chain bonuses don't apply here: both are in the outer districts.
      expect(visitFee(both, both[0], 'normal')).toBe(2 * visitFee(one, one[0], 'normal'));
    });

    it('completing a third route wins the game outright', () => {
      const businesses = [
        biz('a', 'phanvantri', 'food'),
        biz('a', 'quangtrung', 'food'),
        biz('a', 'phamvandong', 'food'),
        biz('a', 'vovanngan', 'food'),
        biz('a', 'xvnt', 'food'),
      ];
      const s = landOn(game(['a', 'b', 'c'], { businesses }), 'a', index('dienbienphu'));
      expect(ROUTES_TO_WIN).toBe(3);
      const won = act(s, 'a', { type: 'buy', biz: 'food' });
      expect(won.result).toMatchObject({ reason: 'routes' });
      expect(won.result!.ranking[0]).toBe('a');
      expect(won.log.filter((e) => e.kind === 'route')).toEqual([{ kind: 'route', player: 'a', route: 2, count: 3 }]);
    });
  });

  describe('takeovers', () => {
    it('pay the owner twice what they put in, and the business changes hands', () => {
      const theirs = biz('b', 'quangtrung', 'food');
      const s = act(game(['a', 'b'], { businesses: [theirs] }), 'a', { type: 'card', index: 1 });
      const fee = visitFee([theirs], theirs, 'normal');
      const price = takeoverPrice(theirs);
      expect(price).toBe(2 * theirs.invested);
      const taken = act(s, 'a', { type: 'takeover', id: theirs.id });
      expect(taken.businesses[0]).toMatchObject({ owner: 'a', invested: price });
      expect(taken.players.a.cash).toBe(START_CASH - fee - price);
      expect(taken.players.b.cash).toBe(START_CASH + fee + price);
      expect(taken.log.some((e) => e.kind === 'takeover' && e.from === 'b' && e.price === price)).toBe(true);
      expect(taken.turn).toBe('b');
    });

    it('cannot touch landmarks (top level) or a shielded owner', () => {
      const landmark = biz('b', 'quangtrung', 'food', 3);
      const s = act(game(['a', 'b'], { businesses: [landmark] }), 'a', { type: 'card', index: 1 });
      // Nothing to decide on a full street of landmarks... the inn slot is still free, though.
      expect(() => act(s, 'a', { type: 'takeover', id: landmark.id })).toThrow('INVALID_MOVE');

      const plain = biz('b', 'quangtrung', 'food');
      const shielded = game(['a', 'b'], { businesses: [plain] });
      const guarded = { ...shielded, players: { ...shielded.players, b: { ...shielded.players.b, shieldMonth: 1 } } };
      const landed = act(guarded, 'a', { type: 'card', index: 1 });
      expect(() => act(landed, 'a', { type: 'takeover', id: plain.id })).toThrow('INVALID_MOVE');
    });

    it('drop trade offers that involved the business', () => {
      const theirs = biz('b', 'quangtrung', 'food');
      let s = game(['a', 'b', 'c'], { businesses: [theirs] });
      s = act(s, 'c', { type: 'offer', to: 'b', giveCash: 100, getCash: 0, give: [], get: [theirs.id] });
      s = act(s, 'a', { type: 'card', index: 1 });
      expect(act(s, 'a', { type: 'takeover', id: theirs.id }).offers).toEqual([]);
    });
  });

  describe('auctions', () => {
    // a lands on Phan Van Tri (free) and passes on it.
    const declined = (ids = ['a', 'b', 'c'], now = 0) => act(act(game(ids), 'a', { type: 'card', index: 0 }), 'a', { type: 'end' }, undefined, now);
    const start = auctionStart(street('phanvantri'), 'food');

    it('a declined free slot goes to auction at half price; the decliner sits it out', () => {
      const s = declined();
      expect(s.phase).toBe('auction');
      expect(s.auction).toMatchObject({ square: index('phanvantri'), type: 'food', from: 'a', bid: start, leader: null, endsAt: AUCTION_MS });
      expect(start).toBe(bizPrice(street('phanvantri'), 'food') / 2);
      expect(() => act(s, 'a', { type: 'bid', amount: start })).toThrow('INVALID_MOVE');
      expect(typhuGame.deadline!(s)).toBe(AUCTION_MS);
    });

    it('the highest bid wins once everyone else has passed', () => {
      let s = declined();
      s = act(s, 'b', { type: 'bid', amount: start });
      expect(() => act(s, 'c', { type: 'bid', amount: start })).toThrow('INVALID_MOVE');
      s = act(s, 'c', { type: 'bid', amount: start + 30 });
      s = act(s, 'b', { type: 'pass' });
      expect(s.auction).toBeNull();
      expect(s.businesses).toEqual([{ ...biz('c', 'phanvantri', 'food'), invested: start + 30 }]);
      expect(s.players.c.cash).toBe(START_CASH - start - 30);
      expect(s.log.some((e) => e.kind === 'auctionWon' && e.player === 'c' && e.price === start + 30)).toBe(true);
      expect(s.turn).toBe('b');
    });

    it('a late bid leaves time to answer, and the clock settles it', () => {
      let s = declined();
      s = act(s, 'b', { type: 'bid', amount: start }, undefined, AUCTION_MS - 1000);
      expect(s.auction!.endsAt).toBe(AUCTION_MS - 1000 + AUCTION_EXTEND_MS);
      expect(typhuGame.timeout!(s, { now: AUCTION_MS }).auction).not.toBeNull();
      const settled = typhuGame.timeout!(s, { now: s.auction!.endsAt });
      expect(settled.businesses.map((b) => b.owner)).toEqual(['b']);
      expect(settled.turn).toBe('b');
    });

    it('nobody bidding leaves the slot free', () => {
      let s = declined(['a', 'b']);
      s = act(s, 'b', { type: 'pass' });
      expect(s.businesses).toEqual([]);
      expect(s.log.at(-1)).toMatchObject({ kind: 'auctionNone' });
      expect(s.turn).toBe('b');
    });

    it("doesn't wait for players who couldn't raise the bid even on credit", () => {
      // c has the opening bid but nothing more, and has borrowed all they can.
      let s = declined(['a', 'b', 'c']);
      s = withCash(s, 'c', start, creditLimit(s, 'c'));
      s = act(s, 'b', { type: 'bid', amount: start + BID_STEP });
      expect(s.auction).toBeNull();
      expect(s.businesses.map((b) => b.owner)).toEqual(['b']);
    });

    it('skips the auction when nobody else could afford the opening bid', () => {
      const s = act(withCash(game(), 'b', 0), 'a', { type: 'card', index: 0 });
      expect(act(s, 'a', { type: 'end' }).turn).toBe('b');
    });

    it('bots bid up to what a slot is worth to them, then pass', () => {
      let s = declined(['a', 'bot', 'c']);
      expect(typhuGame.botMove!(s, 'bot', { now: 0 })).toMatchObject({ type: 'bid', amount: start });
      s = act(s, 'bot', { type: 'bid', amount: start });
      // Leading, it waits; outbid past what the slot is worth to it, it drops out.
      expect(typhuGame.botMove!(s, 'bot', { now: 0 })).toBeNull();
      s = act(s, 'c', { type: 'bid', amount: 2 * bizPrice(street('phanvantri'), 'food') });
      expect(typhuGame.botMove!(s, 'bot', { now: 0 })).toEqual({ type: 'pass' });
    });
  });

  describe('cards', () => {
    it('the market draws a luck card', () => {
      const s = landOn(stack(game(), 'luck', 'lixi'), 'a', special('market'));
      expect(s.players.a.cash).toBe(START_CASH + FORTUNE.lixi);
      expect(s.log.at(-1)).toEqual({ kind: 'fortune', player: 'a', card: 'lixi', amount: FORTUNE.lixi });
      expect(s.turn).toBe('b');
    });

    it('a traffic jam sends the player back three squares, where they land again', () => {
      // From the second market back to Vo Van Tan... no: three back from square 17 is 14, the airport.
      const s = landOn(stack(game(), 'luck', 'jam'), 'a', special('deal') + 4);
      expect(s.players.a.position).toBe(special('deal') + 1);
      expect(s.phase).toBe('fly');
    });

    it('opportunity cards: an investor halves the next opening, a ticket flies for free', () => {
      const deal = special('deal');
      const invested = landOn(stack(game(), 'deal', 'investor'), 'a', deal);
      expect(invested.players.a.discount).toBe(true);
      const cheap = act(landOn({ ...invested, turn: 'a' }, 'a', index('dongkhoi')), 'a', { type: 'buy', biz: 'food' });
      expect(cheap.players.a.cash).toBe(START_CASH - bizPrice(street('dongkhoi'), 'food') / 2);
      expect(cheap.players.a.discount).toBe(false);

      const ticket = landOn(stack(game(), 'deal', 'ticket'), 'a', deal);
      expect(ticket.phase).toBe('fly');
      const flown = act(ticket, 'a', { type: 'fly', to: index('dongkhoi') });
      expect(flown.players.a.cash).toBe(START_CASH);
      // Running out of time instead uses the ticket up, as staying put does.
      const late = typhuGame.timeout!({ ...ticket, turnDeadline: 0 }, { now: 0 });
      expect(late.players.a.freeFlight).toBe(false);
    });

    it('a free upgrade lifts the cheapest business that can still grow, or pays out', () => {
      const cheap = biz('a', 'quangtrung', 'food');
      const dear = biz('a', 'dongkhoi', 'shop');
      const s = landOn(stack(game(['a', 'b'], { businesses: [dear, cheap] }), 'deal', 'upgrade'), 'a', special('deal'));
      expect(s.businesses.find((b) => b.id === cheap.id)).toMatchObject({ level: 2, invested: cheap.invested + upgradePrice(street('quangtrung'), 'food') });
      expect(s.players.a.cash).toBe(START_CASH);
      const none = landOn(stack(game(), 'deal', 'upgrade'), 'a', special('deal'));
      expect(none.players.a.cash).toBe(START_CASH + FORTUNE.upgradeFallback);
    });

    it('the rest stop deals a move card, the tax office takes a tenth of cash', () => {
      const rest = landOn(game(), 'a', special('rest'));
      // The played card is replaced by a new one.
      expect(rest.players.a.hand).toHaveLength(3);
      const taxed = landOn(game(), 'a', special('tax'));
      expect(taxed.players.a.cash).toBe(START_CASH - START_CASH / 10);
      expect(landOn(withCash(game(), 'a', 100), 'a', special('tax')).players.a.cash).toBe(100 - TAX_MIN);
    });
  });

  it('a player short of cash borrows within their limit', () => {
    const businesses = [biz('b', 'quangtrung', 'inn')];
    const s0 = withCash(game(['a', 'b'], { businesses }), 'a', 10);
    const fee = visitFee(businesses, businesses[0], 'normal');
    expect(fee).toBeLessThan(LOAN_BASE);
    const s = act(s0, 'a', { type: 'card', index: 1 });
    expect(s.players.a.debt).toBe(Math.ceil((fee - 10) / 50) * 50);
    expect(s.players.a.cash).toBe(10 + s.players.a.debt - fee);
    expect(s.log.some((e) => e.kind === 'loan' && e.auto)).toBe(true);
  });

  it('past the credit limit, businesses are sold to the bank at half price, cheapest first', () => {
    const own = [biz('a', 'phanvantri', 'food'), biz('a', 'dongkhoi', 'shop')];
    const businesses = [...own, biz('b', 'quangtrung', 'shop', 3)];
    const s0 = game(['a', 'b'], { businesses });
    const fee = visitFee(businesses, businesses[2], 'normal');
    const limit = creditLimit(s0, 'a');
    const cash = fee - limit - salePrice(own[0]) + 10;
    const s = act(withCash(s0, 'a', cash), 'a', { type: 'card', index: 1 });
    expect(s.players.a.out).toBe(false);
    expect(s.players.a.debt).toBe(limit);
    // Only the cheap eatery had to go.
    expect(s.businesses.filter((b) => b.owner === 'a').map((b) => b.id)).toEqual([own[1].id]);
    expect(s.log.some((e) => e.kind === 'sell' && e.forced && e.amount === salePrice(own[0]))).toBe(true);
    expect(s.players.b.cash).toBe(START_CASH + fee);
  });

  it('a player who cannot pay at all goes bankrupt, and the last one standing wins', () => {
    const businesses = [biz('b', 'quangtrung', 'shop', 3), biz('a', 'phanvantri', 'food')];
    const broke = withCash(game(['a', 'b', 'c'], { businesses }), 'a', 0, 5000);
    const s = act(broke, 'a', { type: 'card', index: 1 });
    expect(s.players.a).toMatchObject({ out: true, bankrupt: true, cash: 0, debt: 0 });
    expect(s.businesses.map((b) => b.owner)).toEqual(['b']);
    // b only gets what a could raise: the eatery's sale.
    expect(s.players.b.cash).toBe(START_CASH + salePrice(businesses[1]));
    expect(s.log.at(-1)).toMatchObject({ kind: 'bankrupt', player: 'a' });
    expect(s.turn).toBe('b');
    expect(s.result).toBeNull();

    const over = typhuGame.forfeit(s, 'c', { now: 0 }, 'left');
    expect(over.result).toMatchObject({ ranking: ['b', 'c', 'a'], reason: 'last' });
  });

  it('borrowing stops at the credit limit, and businesses can be sold at any time', () => {
    const own = biz('b', 'dongkhoi', 'shop');
    const s = game(['a', 'b'], { businesses: [own] });
    const limit = creditLimit(s, 'b');
    expect(limit).toBe(LOAN_BASE + Math.floor(own.invested / 2 / 50) * 50);
    expect(() => act(s, 'b', { type: 'borrow', amount: limit + 50 })).toThrow('INVALID_MOVE');
    const sold = act(s, 'b', { type: 'sell', id: own.id });
    expect(sold.businesses).toEqual([]);
    expect(sold.players.b.cash).toBe(START_CASH + salePrice(own));
    expect(() => act(s, 'a', { type: 'sell', id: own.id })).toThrow('INVALID_MOVE');
  });

  it('visit fees grow every year', () => {
    const b = biz('a', 'dongkhoi', 'food');
    expect(visitFee([b], b, 'normal', 13)).toBeGreaterThan(visitFee([b], b, 'normal', 12));
    expect(visitFee([b], b, 'normal', 25)).toBeGreaterThan(visitFee([b], b, 'normal', 13));
  });

  it('loans can be taken and repaid at any time', () => {
    let s = act(game(), 'b', { type: 'borrow', amount: 500 });
    expect(s.players.b).toMatchObject({ cash: START_CASH + 500, debt: 500 });
    expect(() => act(s, 'b', { type: 'borrow', amount: 30 })).toThrow('INVALID_MOVE');
    s = act(s, 'b', { type: 'repay', amount: 200 });
    expect(s.players.b).toMatchObject({ cash: START_CASH + 300, debt: 300 });
    // Repayments go in steps of 50 unless they clear the debt.
    expect(() => act(s, 'b', { type: 'repay', amount: 120 })).toThrow('INVALID_MOVE');
    const odd = withCash(s, 'b', s.players.b.cash, 330);
    expect(act(odd, 'b', { type: 'repay', amount: 330 }).players.b.debt).toBe(0);
  });

  it('festival collects from everyone, the bank pays a bonus', () => {
    const festival = landOn(game(['a', 'b', 'c']), 'a', special('festival'));
    expect(festival.players.a.cash).toBe(START_CASH + 60);
    expect(festival.players.b.cash).toBe(START_CASH - 30);
    const bank = landOn(game(), 'a', special('bank'));
    expect(bank.players.a.cash).toBe(START_CASH + 50);
  });

  it('the airport flies you anywhere for a fee', () => {
    const s = landOn(game(), 'a', special('airport'));
    expect(s.phase).toBe('fly');
    expect(() => act(s, 'a', { type: 'fly', to: special('airport') })).toThrow('INVALID_MOVE');
    const flown = act(s, 'a', { type: 'fly', to: index('dongkhoi') });
    expect(flown.players.a).toMatchObject({ position: index('dongkhoi'), cash: START_CASH - 100 });
    expect(flown.phase).toBe('act');
    expect(act(s, 'a', { type: 'stay' }).turn).toBe('b');
  });

  it('pays salary and interest at month end, and the richest wins if time runs out', () => {
    let s = withCash(game(), 'b', 1000, 500);
    // Both players land on the bank's neighbour with no choice to make: a then b.
    s = landOn(s, 'a', special('airport'));
    s = act(s, 'a', { type: 'stay' });
    s = landOn(s, 'b', special('airport'));
    s = act(s, 'b', { type: 'stay' });
    expect(s.month).toBe(2);
    expect(s.players.a.cash).toBe(START_CASH + SALARY);
    expect(s.players.b.cash).toBe(1000 + SALARY - 50);
    expect(s.log.some((e) => e.kind === 'interest' && e.player === 'b' && e.amount === 50)).toBe(true);
    expect(s.turn).toBe('a');

    let end: TyPhuState = { ...s, month: MAX_MONTHS, players: { a: { ...s.players.a, hand: [1] }, b: { ...s.players.b, hand: [1] } } };
    end = act(landOn(end, 'a', special('airport')), 'a', { type: 'stay' });
    end = act(landOn(end, 'b', special('airport')), 'b', { type: 'stay' });
    expect(end.result).toMatchObject({ ranking: ['a', 'b'], reason: 'time' });
    expect(end.result?.worth.a).toBe(netWorth(end, 'a'));
    expect(typhuGame.points!(end)).toEqual({ a: { place: 1, points: 1 }, b: { place: 2, points: -1 } });
  });

  describe('trades', () => {
    it('a player in debt can only hand over cash beyond what they owe', () => {
      const s = withCash(game(['a', 'b']), 'a', 1000, 800);
      const big = act(s, 'a', { type: 'offer', to: 'b', giveCash: 500, getCash: 0, give: [], get: [] });
      expect(() => act(big, 'b', { type: 'accept', id: big.offers[0].id })).toThrow('INVALID_MOVE');
      const small = act(s, 'a', { type: 'offer', to: 'b', giveCash: 200, getCash: 0, give: [], get: [] });
      expect(act(small, 'b', { type: 'accept', id: small.offers[0].id }).players.b.cash).toBe(START_CASH + 200);
    });

    it('an offer can no longer be accepted once its time is up', () => {
      const s = act(game(['a', 'b']), 'a', { type: 'offer', to: 'b', giveCash: 50, getCash: 0, give: [], get: [] });
      expect(() => act(s, 'b', { type: 'accept', id: s.offers[0].id }, undefined, 30_000)).toThrow('INVALID_MOVE');
    });

    const businesses = [biz('a', 'dongkhoi', 'food'), biz('b', 'xvnt', 'inn')];

    it('swap businesses and cash when accepted', () => {
      let s = act(game(['a', 'b'], { businesses }), 'a', { type: 'offer', to: 'b', giveCash: 100, getCash: 0, give: [businesses[0].id], get: [businesses[1].id] });
      expect(typhuGame.playerView(s, 'b', { now: 0 }).offers).toHaveLength(1);
      expect(() => act(s, 'a', { type: 'accept', id: s.offers[0].id })).toThrow('INVALID_MOVE');
      s = act(s, 'b', { type: 'accept', id: s.offers[0].id });
      expect(s.businesses.map((b) => b.owner)).toEqual(['b', 'a']);
      expect(s.players.a.cash).toBe(START_CASH - 100);
      expect(s.players.b.cash).toBe(START_CASH + 100);
      expect(s.offers).toEqual([]);
    });

    it('reject offers for businesses the other side does not own', () => {
      expect(() => act(game(['a', 'b'], { businesses }), 'a', { type: 'offer', to: 'b', giveCash: 0, getCash: 0, give: [businesses[1].id], get: [] })).toThrow();
    });

    it('can be declined, cancelled, or lapse after 30 seconds', () => {
      const s = act(game(['a', 'b'], { businesses }), 'a', { type: 'offer', to: 'b', giveCash: 50, getCash: 0, give: [], get: [businesses[1].id] });
      expect(act(s, 'b', { type: 'decline', id: s.offers[0].id }).offers).toEqual([]);
      expect(act(s, 'a', { type: 'cancel', id: s.offers[0].id }).offers).toEqual([]);
      expect(typhuGame.deadline!(s)).toBe(30_000);
      expect(typhuGame.playerView(s, 'b', { now: 10_000 }).offers[0].msLeft).toBe(20_000);
      expect(typhuGame.timeout!(s, { now: 30_000 }).offers).toEqual([]);
    });

    it('bots never hand over the business that would win a rival the game', () => {
      const owned = [
        biz('a', 'phanvantri', 'food'),
        biz('a', 'quangtrung', 'food'),
        biz('a', 'phamvandong', 'food'),
        biz('a', 'vovanngan', 'food'),
        biz('a', 'xvnt', 'food'),
      ];
      const key = biz('bot', 'dienbienphu', 'food');
      const s = act(game(['a', 'bot'], { businesses: [...owned, key] }), 'a', { type: 'offer', to: 'bot', giveCash: 1500, getCash: 0, give: [], get: [key.id] });
      expect(typhuGame.botMove!(s, 'bot', { now: 0 })).toEqual({ type: 'decline', id: s.offers[0].id });
    });
  });

  it('a player who leaves closes their businesses; the game ends when one is left', () => {
    const s = game(['a', 'b', 'c'], { businesses: [biz('b', 'dongkhoi', 'food')] });
    const left = typhuGame.forfeit(s, 'b', { now: 0 }, 'left');
    expect(left.businesses).toEqual([]);
    expect(left.result).toBeNull();
    const over = typhuGame.forfeit(left, 'c', { now: 0 }, 'left');
    // The last to leave ranks above those who left earlier.
    expect(over.result?.ranking).toEqual(['a', 'c', 'b']);
  });

  it('out of time: rolls automatically, or passes on the square (which may start an auction)', () => {
    const s = { ...game(), turnLimitMs: 30_000, turnDeadline: 30_000 };
    const rolled = typhuGame.timeout!(s, { now: 30_000, random: fixed(die(1), die(1)) });
    expect(rolled.log.at(-1)).toMatchObject({ kind: 'roll', auto: true });
    expect(rolled.phase).toBe('act');
    const passed = typhuGame.timeout!({ ...rolled, turnDeadline: 60_000 }, { now: 60_000 });
    expect(passed.phase).toBe('auction');
  });

  it('bots open the business type that grows a chain', () => {
    // The bot already runs eateries in all three areas and shops in two; a shop completes the chain.
    const businesses = [biz('bot', 'quangtrung', 'food'), biz('bot', 'xvnt', 'food'), biz('bot', 'dongkhoi', 'food'), biz('bot', 'vovanngan', 'shop'), biz('bot', 'tranhungdao', 'shop')];
    const s = { ...at(game(['bot', 'b'], { businesses }), 'bot', index('buivien')), phase: 'act' as const };
    expect(typhuGame.botMove!(s, 'bot', { now: 0 })).toEqual({ type: 'buy', biz: 'shop' });
  });

  it('bots take over a business to break a rival’s route', () => {
    const businesses = [biz('b', 'phanvantri', 'food'), biz('b', 'quangtrung', 'food')];
    const s = { ...at(game(['bot', 'b'], { businesses }), 'bot', index('quangtrung')), phase: 'act' as const };
    expect(typhuGame.botMove!(s, 'bot', { now: 0 })).toEqual({ type: 'takeover', id: businesses[1].id });
  });

  it('bots play whole games to the end without getting stuck, and routes decide many of them', { timeout: 60_000 }, () => {
    const reasons: Record<string, number> = {};
    for (let seed = 1; seed <= 40; seed++) {
      const ids = Array.from({ length: 2 + (seed % 5) }, (_, i) => `bot:${i}`);
      const random = seeded(seed);
      let s = typhuGame.setup(ids, options, { now: 0, random }, null);
      for (let steps = 0; !s.result; steps++) {
        expect(steps).toBeLessThan(5000);
        const [id, move] = ids.map((p) => [p, typhuGame.botMove!(s, p, { now: 0 })] as const).find(([, m]) => m) ?? [];
        expect(move).toBeTruthy();
        s = act(s, id!, move!, random);
      }
      expect(s.result.ranking).toHaveLength(ids.length);
      reasons[s.result.reason] = (reasons[s.result.reason] ?? 0) + 1;
    }
    expect(reasons.routes).toBeGreaterThan(15);
    expect(reasons.last).toBeGreaterThan(3);
  });
});
