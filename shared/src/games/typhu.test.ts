import { describe, expect, it } from 'vitest';
import type { RoomOptions } from '../types';
import {
  BOARD,
  MONTHS,
  SALARY,
  START_CASH,
  bizPrice,
  chainFactor,
  netWorth,
  typhuGame,
  visitFee,
  type Business,
  type ProvinceSquare,
  type TyPhuMove,
  type TyPhuState,
} from './typhu';

const options: RoomOptions = { timeControl: 'none', hostColor: 'random', handicap: 'none', turnTimer: 'none', houseRules: [] };

// Deterministic randomness for shuffles, dice and cards.
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
// Feeds fixed values: a die showing d comes from (d - 0.5) / 6, a card c from (c - 0.5) / 8.
const fixed = (...values: number[]) => () => values.shift() ?? 0;
const die = (d: number) => (d - 0.5) / 6;

const index = (id: string) => BOARD.findIndex((s) => s.kind === 'province' && s.id === id);
const special = (kind: string) => BOARD.findIndex((s) => s.kind === kind);
const square = (id: string) => BOARD[index(id)] as ProvinceSquare;

// Two or more players at the bus station in seat order, with known hands.
function game(ids = ['a', 'b'], extra: Partial<TyPhuState> = {}): TyPhuState {
  const s = typhuGame.setup(ids, options, { now: 0, random: seeded(1) }, null);
  const players = Object.fromEntries(ids.map((id) => [id, { ...s.players[id], hand: [1, 2, 3] }]));
  return { ...s, seats: ids, players, turn: ids[0], events: Array(MONTHS).fill('normal'), ...extra };
}

function act(s: TyPhuState, player: string, move: TyPhuMove, random: () => number = seeded(2), now = 0) {
  const r = typhuGame.applyMove(s, player, move, { now, random });
  if (!r.ok) throw new Error(`${player} ${JSON.stringify(move)}: ${r.error}`);
  return r.state;
}

const at = (s: TyPhuState, id: string, position: number) => ({ ...s, players: { ...s.players, [id]: { ...s.players[id], position } } });
const biz = (owner: string, province: string, type: Business['type'], level = 1): Business => ({
  id: `${index(province)}-${type}`,
  square: index(province),
  owner,
  type,
  level,
  invested: bizPrice(square(province), type),
});

describe('cờ tỉ phú', () => {
  it('has the 34 provinces and 8 special squares', () => {
    expect(BOARD).toHaveLength(42);
    expect(BOARD.filter((s) => s.kind === 'province')).toHaveLength(34);
    expect(new Set(BOARD.flatMap((s) => (s.kind === 'province' ? [s.id] : []))).size).toBe(34);
  });

  it('deals cash and three move cards, and starts month 1', () => {
    const s = typhuGame.setup(['a', 'b', 'c'], options, { now: 0, random: seeded(3) }, null);
    expect(s.seats.toSorted()).toEqual(['a', 'b', 'c']);
    expect(s.turn).toBe(s.seats[0]);
    for (const id of s.seats) {
      expect(s.players[id]).toMatchObject({ cash: START_CASH, debt: 0, position: 0 });
      expect(s.players[id].hand).toHaveLength(3);
    }
    expect(s.events.toSorted()).toHaveLength(12);
    expect(s.log[0]).toEqual({ kind: 'month', month: 1, event: s.events[0] });
  });

  it('only shows a player their own move cards', () => {
    const view = typhuGame.playerView(game(), 'a', { now: 0 });
    expect(view.hand).toEqual([1, 2, 3]);
    expect(view.seats.find((p) => p.id === 'b')).toMatchObject({ cards: 3 });
    expect(JSON.stringify(view.seats)).not.toContain('hand');
  });

  it('rolls two dice, lands, and may open a business', () => {
    // 1 + 2 = 3 squares: Sơn La.
    const s = act(game(), 'a', { type: 'roll' }, fixed(die(1), die(2)));
    expect(s.players.a.position).toBe(index('sonla'));
    expect(s.phase).toBe('act');
    const price = bizPrice(square('sonla'), 'inn');
    const bought = act(s, 'a', { type: 'buy', biz: 'inn' });
    expect(bought.players.a.cash).toBe(START_CASH - price);
    expect(bought.businesses).toEqual([biz('a', 'sonla', 'inn')]);
    expect(bought.turn).toBe('b');
    expect(() => act(bought, 'a', { type: 'roll' })).toThrow('NOT_YOUR_TURN');
  });

  it('a move card moves exactly that far and is replaced', () => {
    const s = act(game(), 'a', { type: 'card', index: 1 }, fixed(0.99));
    expect(s.players.a.position).toBe(2);
    expect(s.players.a.hand).toEqual([1, 3, 8]);
  });

  it('visitors pay every owner at a province', () => {
    const businesses = [biz('b', 'dienbien', 'food'), biz('c', 'dienbien', 'inn')];
    const s = act(game(['a', 'b', 'c'], { businesses }), 'a', { type: 'card', index: 1 });
    const food = visitFee(businesses, businesses[0], 'normal');
    const inn = visitFee(businesses, businesses[1], 'normal');
    expect(s.players.a.cash).toBe(START_CASH - food - inn);
    expect(s.players.b.cash).toBe(START_CASH + food);
    expect(s.players.c.cash).toBe(START_CASH + inn);
    expect(s.log.at(-1)).toMatchObject({ kind: 'pay', player: 'a', total: food + inn });
    // Both slots are taken, so there is nothing to decide and the turn passes.
    expect(s.turn).toBe('b');
  });

  it('each business type appears once per province, up to its slots', () => {
    const s = at(game(['a', 'b'], { businesses: [biz('b', 'hanoi', 'food')] }), 'a', index('hanoi') - 1);
    const landed = act(s, 'a', { type: 'card', index: 0 });
    expect(() => act(landed, 'a', { type: 'buy', biz: 'food' })).toThrow('INVALID_MOVE');
    expect(act(landed, 'a', { type: 'buy', biz: 'shop' }).businesses).toHaveLength(2);
  });

  it('upgrades your own business when you land on it again', () => {
    const own = biz('a', 'dienbien', 'food');
    const s = act(game(['a', 'b'], { businesses: [own] }), 'a', { type: 'card', index: 1 });
    expect(s.phase).toBe('act');
    const up = act(s, 'a', { type: 'upgrade', id: own.id });
    expect(up.businesses[0]).toMatchObject({ level: 2 });
    expect(up.businesses[0].invested).toBeGreaterThan(own.invested);
    expect(visitFee(up.businesses, up.businesses[0], 'normal')).toBeGreaterThan(visitFee([own], own, 'normal'));
  });

  it('chains of one business type across regions earn more', () => {
    const north = biz('a', 'hanoi', 'shop');
    const central = biz('a', 'danang', 'shop');
    const south = biz('a', 'hcmc', 'shop');
    expect(chainFactor([north], 'a', 'shop')).toBe(1);
    expect(chainFactor([north, central], 'a', 'shop')).toBe(1.25);
    expect(chainFactor([north, central, south], 'a', 'shop')).toBe(1.5);
    expect(chainFactor([north, central, south], 'a', 'food')).toBe(1);
  });

  it('events change fees: storms close the centre, Tết doubles north and south', () => {
    const hue = biz('a', 'hue', 'inn');
    const hanoi = biz('a', 'hanoi', 'inn');
    expect(visitFee([hue], hue, 'storm')).toBe(0);
    expect(visitFee([hanoi], hanoi, 'tet')).toBe(2 * visitFee([hanoi], hanoi, 'normal'));
    expect(visitFee([hue], hue, 'tet')).toBe(visitFee([hue], hue, 'normal'));
  });

  it('borrows automatically when a player cannot pay', () => {
    const businesses = [biz('b', 'dienbien', 'inn', 3)];
    const s0 = game(['a', 'b'], { businesses });
    const poor = { ...s0, players: { ...s0.players, a: { ...s0.players.a, cash: 10 } } };
    const fee = visitFee(businesses, businesses[0], 'normal');
    const s = act(poor, 'a', { type: 'card', index: 1 });
    expect(s.players.a.debt).toBe(Math.ceil((fee - 10) / 50) * 50);
    expect(s.players.a.cash).toBe(10 + s.players.a.debt - fee);
    expect(s.log.some((e) => e.kind === 'loan' && e.auto)).toBe(true);
  });

  it('loans can be taken and repaid at any time', () => {
    let s = act(game(), 'b', { type: 'borrow', amount: 500 });
    expect(s.players.b).toMatchObject({ cash: START_CASH + 500, debt: 500 });
    expect(() => act(s, 'b', { type: 'borrow', amount: 30 })).toThrow('INVALID_MOVE');
    s = act(s, 'b', { type: 'repay', amount: 200 });
    expect(s.players.b).toMatchObject({ cash: START_CASH + 300, debt: 300 });
  });

  it('special squares: market draws a card, festival collects, bank pays a bonus', () => {
    const market = act(at(game(), 'a', special('market') - 1), 'a', { type: 'card', index: 0 }, fixed(0.3));
    expect(market.players.a.hand).toHaveLength(4);

    const festival = act(at(game(['a', 'b', 'c']), 'a', special('festival') - 1), 'a', { type: 'card', index: 0 }, fixed(0.3));
    expect(festival.players.a.cash).toBe(START_CASH + 60);
    expect(festival.players.b.cash).toBe(START_CASH - 30);

    const bank = act(at(game(), 'a', special('bank') - 1), 'a', { type: 'card', index: 0 }, fixed(0.3));
    expect(bank.players.a.cash).toBe(START_CASH + 50);
  });

  it('the airport flies you anywhere for a fee', () => {
    const s = act(at(game(), 'a', special('airport') - 1), 'a', { type: 'card', index: 0 }, fixed(0.3));
    expect(s.phase).toBe('fly');
    expect(() => act(s, 'a', { type: 'fly', to: special('airport') })).toThrow('INVALID_MOVE');
    const flown = act(s, 'a', { type: 'fly', to: index('hanoi') });
    expect(flown.players.a).toMatchObject({ position: index('hanoi'), cash: START_CASH - 100 });
    expect(flown.phase).toBe('act');
    expect(act(s, 'a', { type: 'stay' }).turn).toBe('b');
  });

  it('pays salary and interest at month end, and ends after month 12', () => {
    let s = game();
    s = { ...s, players: { ...s.players, b: { ...s.players.b, debt: 1000, cash: 1000 } } };
    // Both players land on rest stops with no choice to make: a then b.
    s = act(at(s, 'a', special('rest') - 1), 'a', { type: 'card', index: 0 });
    s = act(at(s, 'b', special('rest') - 1), 'b', { type: 'card', index: 0 });
    expect(s.month).toBe(2);
    expect(s.players.a.cash).toBe(START_CASH + SALARY);
    expect(s.players.b.cash).toBe(1000 + SALARY - 100);
    expect(s.log.some((e) => e.kind === 'interest' && e.player === 'b' && e.amount === 100)).toBe(true);
    expect(s.turn).toBe('a');

    const last = { ...s, month: MONTHS, players: { a: { ...s.players.a, hand: [1] }, b: { ...s.players.b, hand: [1] } } };
    let end = act(at(last, 'a', special('rest') - 1), 'a', { type: 'card', index: 0 });
    end = act(at(end, 'b', special('rest') - 1), 'b', { type: 'card', index: 0 });
    expect(end.result?.ranking).toEqual(['a', 'b']);
    expect(end.result?.worth.a).toBe(netWorth(end, 'a'));
    expect(typhuGame.points!(end)).toEqual({ a: { place: 1, points: 1 }, b: { place: 2, points: -1 } });
  });

  describe('trades', () => {
    const businesses = [biz('a', 'hanoi', 'food'), biz('b', 'hue', 'inn')];

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
      expect(typhuGame.timeout!(s, { now: 30_000 }).offers).toEqual([]);
    });
  });

  it('a player who leaves closes their businesses; the game ends when one is left', () => {
    const s = game(['a', 'b', 'c'], { businesses: [biz('b', 'hanoi', 'food')] });
    const left = typhuGame.forfeit(s, 'b', { now: 0 }, 'left');
    expect(left.businesses).toEqual([]);
    expect(left.result).toBeNull();
    const over = typhuGame.forfeit(left, 'c', { now: 0 }, 'left');
    // The last to leave ranks above those who left earlier.
    expect(over.result?.ranking).toEqual(['a', 'c', 'b']);
  });

  it('out of time: rolls automatically, or skips buying', () => {
    const s = { ...game(), turnLimitMs: 30_000, turnDeadline: 30_000 };
    const rolled = typhuGame.timeout!(s, { now: 30_000, random: fixed(die(1), die(2)) });
    expect(rolled.log.at(-1)).toMatchObject({ kind: 'roll', auto: true });
    expect(rolled.phase).toBe('act');
    const skipped = typhuGame.timeout!({ ...rolled, turnDeadline: 60_000 }, { now: 60_000 });
    expect(skipped.turn).toBe('b');
  });

  it('bots play whole games to the end without getting stuck', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const ids = Array.from({ length: 2 + (seed % 5) }, (_, i) => `bot:${i}`);
      const random = seeded(seed);
      let s = typhuGame.setup(ids, options, { now: 0, random }, null);
      for (let steps = 0; !s.result; steps++) {
        expect(steps).toBeLessThan(1000);
        const [id, move] = ids.map((p) => [p, typhuGame.botMove!(s, p, { now: 0 })] as const).find(([, m]) => m) ?? [];
        expect(move).toBeTruthy();
        s = act(s, id!, move!, random);
      }
      expect(s.result.ranking).toHaveLength(ids.length);
    }
  });
});
