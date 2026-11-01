import { describe, expect, it } from 'vitest';
import type { RoomOptions } from '../types';
import { XD_REVEAL_MS, XD_START_CHIPS, xdHandValue, xdSettle, xiDachGame, type XdCard, type XiDachMove, type XiDachState } from './xidach';

const options = {} as RoomOptions;
// Cards by rank (1 = A … 13 = K), spades unless said otherwise.
const c = (rank: number, suit = 0): XdCard => (rank - 1) * 4 + suit;
const hand = (...ranks: number[]) => ranks.map((r, i) => c(r, i % 4));
const game = (ids = ['a', 'b']) => xiDachGame.setup(ids, options, { now: 0 }, null);
function act(s: XiDachState, id: string, move: XiDachMove, now = 0, random?: () => number) {
  const r = xiDachGame.applyMove(s, id, move, { now, random });
  if (!r.ok) throw new Error(`${id} ${JSON.stringify(move)}: ${r.error}`);
  return r.state;
}
// A round in play with fixed hands and deck.
function table(hands: Record<string, XdCard[]>, dealer: XdCard[], deck: XdCard[], turn = Object.keys(hands)[0]): XiDachState {
  const ids = Object.keys(hands);
  return {
    ...game(ids),
    phase: 'play',
    bets: Object.fromEntries(ids.map((id) => [id, 100])),
    chips: Object.fromEntries(ids.map((id) => [id, XD_START_CHIPS - 100])),
    hands,
    dealer,
    deck,
    turn,
  };
}

describe('xi dach', () => {
  it('values hands: xì bàn, xì dách, ngũ linh, totals and bust', () => {
    expect(xdHandValue(hand(1, 1)).kind).toBe('xi-ban');
    expect(xdHandValue(hand(1, 12)).kind).toBe('xi-dach');
    expect(xdHandValue(hand(2, 3, 4, 2, 5))).toEqual({ kind: 'ngu-linh', total: 16 });
    expect(xdHandValue(hand(10, 7))).toEqual({ kind: 'points', total: 17 });
    expect(xdHandValue(hand(10, 7, 9)).kind).toBe('bust');
    // An ace counts 1, 10 or 11 in up to three cards, and 1 after that.
    expect(xdHandValue(hand(1, 5)).total).toBe(16);
    expect(xdHandValue(hand(1, 5, 5)).total).toBe(21);
    expect(xdHandValue(hand(1, 5, 5, 2)).total).toBe(13);
  });

  it('settles: specials pay more, both bust is a push', () => {
    const v = (...r: number[]) => xdHandValue(hand(...r));
    expect(xdSettle(v(10, 9), v(10, 7))).toBe(1);
    expect(xdSettle(v(10, 7), v(10, 9))).toBe(-1);
    expect(xdSettle(v(1, 13), v(10, 9))).toBe(2);
    expect(xdSettle(v(1, 1), v(1, 13))).toBe(3);
    expect(xdSettle(v(10, 9), v(1, 13))).toBe(-2);
    expect(xdSettle(v(10, 8, 9), v(10, 6, 9))).toBe(0);
    // Going bust costs the stake once, even against the dealer's xì dách.
    expect(xdSettle(v(10, 8, 9), v(1, 13))).toBe(-1);
    expect(xdSettle(v(10, 8), v(10, 8))).toBe(0);
  });

  it('bets, then deals two cards each once everyone is ready, hiding others’ cards', () => {
    let s = act(game(), 'a', { type: 'bet', amount: 100 });
    expect(() => act(s, 'a', { type: 'bet', amount: 30 })).toThrow('INVALID_MOVE');
    s = act(s, 'b', { type: 'bet', amount: 50 });
    s = act(s, 'a', { type: 'ready' });
    // A fixed shuffle, so the dealer can't be dealt xì dách and end the round at once (about 5% of deals).
    s = act(s, 'b', { type: 'ready' }, 0, () => 0.1);
    expect(s.phase).toBe('play');
    expect(s.hands.a).toHaveLength(2);
    expect(s.chips.a).toBe(XD_START_CHIPS - 100);
    const view = xiDachGame.playerView(s, 'a', { now: 0 });
    expect(Object.keys(view.hands)).toEqual(['a']);
    // The dealer's cards are all face down, as at a Vietnamese table.
    expect(view.dealer).toEqual([]);
    expect(view.dealerCards).toBe(2);
  });

  it('needs 16 to stand; a bust stays hidden until the player stands', () => {
    let s = table({ a: hand(10, 4), b: hand(10, 9) }, hand(10, 6), hand(9, 1));
    expect(() => act(s, 'a', { type: 'stand' })).toThrow('INVALID_MOVE');
    expect(() => act(s, 'b', { type: 'hit' })).toThrow('NOT_YOUR_TURN');
    s = act(s, 'a', { type: 'hit' });
    expect(s.hands.a).toHaveLength(3);
    expect(xdHandValue(s.hands.a).kind).toBe('bust');
    // Still a's turn, and nothing tells the others: a can't draw again, only stand.
    expect(s.turn).toBe('a');
    expect(xiDachGame.playerView(s, 'b', { now: 0 }).log.at(-1)).toEqual({ kind: 'hit', player: 'a', cards: 3 });
    expect(() => act(s, 'a', { type: 'hit' })).toThrow('INVALID_MOVE');
    s = act(s, 'a', { type: 'stand' });
    expect(s.turn).toBe('b');
  });

  it('five cards end the turn on their own', () => {
    const s = act(table({ a: hand(2, 3, 2, 4), b: hand(10, 9) }, hand(10, 6), hand(5)), 'a', { type: 'hit' });
    expect(xdHandValue(s.hands.a).kind).toBe('ngu-linh');
    expect(s.turn).toBe('b');
  });

  it('the dealer draws to 16, then everyone is paid', () => {
    // a stands on 19, b on 17; the dealer has 12, draws a 5 to 17.
    let s = table({ a: hand(10, 9), b: hand(10, 7) }, hand(10, 2), [c(5), c(9)]);
    s = act(s, 'a', { type: 'stand' });
    s = act(s, 'b', { type: 'stand' }, 1000);
    expect(s).toMatchObject({ phase: 'reveal', deadline: 1000 + XD_REVEAL_MS });
    expect(s.dealer).toHaveLength(3);
    expect(s.chips.a).toBe(XD_START_CHIPS + 100);
    expect(s.chips.b).toBe(XD_START_CHIPS);
    expect(xiDachGame.timeout!(s, { now: s.deadline })).toMatchObject({ round: 2, phase: 'bet' });
  });

  it('out of time: stands on 16 or more, draws below', () => {
    const s = { ...table({ a: hand(10, 4), b: hand(10, 9) }, hand(10, 6), hand(2, 1)), deadline: 5 };
    expect(xiDachGame.timeout!(s, { now: 5 }).hands.a).toHaveLength(3);
  });

  it('bots stake, draw below 17 and stand otherwise; games of bots run to the end', () => {
    let s = game(['bot:1', 'bot:2']);
    let now = 0;
    for (let steps = 0; !s.result; steps++) {
      expect(steps).toBeLessThan(3000);
      const mover = s.seats.find((id) => xiDachGame.botMove!(s, id, { now }));
      if (mover) s = act(s, mover, xiDachGame.botMove!(s, mover, { now })!, now);
      else {
        now = s.deadline;
        s = xiDachGame.timeout!(s, { now });
      }
    }
    expect(s.result.ranking).toHaveLength(2);
    // Chips only ever move between players and the house in whole stakes.
    for (const id of s.seats) expect(s.chips[id] % 10).toBe(0);
  });
  describe('a seated dealer', () => {
    const dealt = (dealer = 'd') => ({ ...options, dealer: dealer });
    // d deals to a and b, with fixed hands and deck.
    function dealerTable(hands: Record<string, XdCard[]>, dealerCards: XdCard[], deck: XdCard[], chips = XD_START_CHIPS): XiDachState {
      const ids = Object.keys(hands);
      return {
        ...xiDachGame.setup(['d', ...ids], dealt(), { now: 0 }, null),
        phase: 'play',
        bets: Object.fromEntries(ids.map((id) => [id, 100])),
        chips: { d: chips, ...Object.fromEntries(ids.map((id) => [id, XD_START_CHIPS - 100])) },
        hands,
        dealer: dealerCards,
        deck,
        turn: ids[0],
      };
    }

    it('is picked by the host if seated, otherwise the house deals', () => {
      expect(xiDachGame.setup(['a', 'd'], dealt(), { now: 0 }, null).dealerId).toBe('d');
      expect(xiDachGame.setup(['a', 'b'], dealt(), { now: 0 }, null).dealerId).toBeNull();
    });

    it("doesn't stake; the round is dealt once the players are ready", () => {
      let s = xiDachGame.setup(['d', 'a', 'b'], dealt(), { now: 0 }, null);
      expect(() => act(s, 'd', { type: 'bet', amount: 100 })).toThrow('INVALID_MOVE');
      expect(xiDachGame.botMove!(s, 'd', { now: 0 })).toBeNull();
      s = act(act(s, 'a', { type: 'bet', amount: 100 }), 'a', { type: 'ready' });
      s = act(act(s, 'b', { type: 'bet', amount: 50 }), 'b', { type: 'ready' }, 0, () => 0.1);
      expect(s.phase).toBe('play');
      expect(s.hands.d).toBeUndefined();
      // The dealer sees their whole hand; the others only its first card.
      expect(xiDachGame.playerView(s, 'd', { now: 0 }).dealer).toHaveLength(2);
      expect(xiDachGame.playerView(s, 'a', { now: 0 }).dealer).toEqual([]);
    });

    it('plays last, needs 16 to stand, and pays and collects from their own chips', () => {
      // a stands on 19, b on 17; the dealer has 12 and must draw: a 6 makes 18.
      let s = dealerTable({ a: hand(10, 9), b: hand(10, 7) }, hand(10, 2), [c(6), c(9)]);
      s = act(s, 'a', { type: 'stand' });
      s = act(s, 'b', { type: 'stand' });
      expect(s).toMatchObject({ phase: 'play', turn: 'd' });
      expect(() => act(s, 'd', { type: 'stand' })).toThrow('INVALID_MOVE');
      s = act(s, 'd', { type: 'hit' });
      expect(s.dealer).toHaveLength(3);
      s = act(s, 'd', { type: 'stand' });
      expect(s.phase).toBe('reveal');
      expect(s.chips).toEqual({ d: XD_START_CHIPS, a: XD_START_CHIPS + 100, b: XD_START_CHIPS - 100 });
      expect(s.log).toContainEqual(expect.objectContaining({ kind: 'dealer', player: 'd', net: 0 }));
    });

    it('with 16 or more, checks a player early (xét bài), then plays on against the rest', () => {
      // a stands on 19, b on 16. The dealer has 17: checks b and wins, then draws a 3 for 20 and beats a.
      let s = dealerTable({ a: hand(10, 9), b: hand(10, 6) }, hand(10, 7), [c(3)]);
      s = act(act(s, 'a', { type: 'stand' }), 'b', { type: 'stand' });
      expect(() => act(s, 'a', { type: 'check', player: 'b' })).toThrow('NOT_YOUR_TURN');
      s = act(s, 'd', { type: 'check', player: 'b' });
      expect(s).toMatchObject({ phase: 'play', turn: 'd', paid: { b: -100 } });
      expect(s.chips).toMatchObject({ d: XD_START_CHIPS + 100, b: XD_START_CHIPS - 100 });
      // Everyone now sees b's hand, but not a's.
      expect(Object.keys(xiDachGame.playerView(s, 'a', { now: 0 }).hands).toSorted()).toEqual(['a', 'b']);
      expect(() => act(s, 'd', { type: 'check', player: 'b' })).toThrow('INVALID_MOVE');
      s = act(act(s, 'd', { type: 'hit' }), 'd', { type: 'stand' });
      expect(s.phase).toBe('reveal');
      expect(s.chips).toMatchObject({ d: XD_START_CHIPS + 200, a: XD_START_CHIPS - 100 });
      expect(s.log).toContainEqual(expect.objectContaining({ kind: 'dealer', net: 200 }));
    });

    it("can't check below 16, and checking the last player ends the round", () => {
      let s = dealerTable({ a: hand(10, 9) }, hand(10, 5), [c(5)]);
      s = act(s, 'a', { type: 'stand' });
      expect(() => act(s, 'd', { type: 'check', player: 'a' })).toThrow('INVALID_MOVE');
      s = act(s, 'd', { type: 'hit' });
      s = act(s, 'd', { type: 'check', player: 'a' });
      expect(s.phase).toBe('reveal');
      expect(s.paid).toEqual({ a: -100 });
    });

    it('still plays when every player has gone bust, since busts stay hidden', () => {
      let s = dealerTable({ a: hand(10, 6), b: hand(10, 6) }, hand(10, 7), [c(10), c(10)]);
      for (const id of ['a', 'b']) s = act(act(s, id, { type: 'hit' }), id, { type: 'stand' });
      expect(s).toMatchObject({ phase: 'play', turn: 'd' });
      s = act(s, 'd', { type: 'stand' });
      expect(s.phase).toBe('reveal');
      expect(s.chips.d).toBe(XD_START_CHIPS + 200);
    });

    it('a short bank shares what it has among the winners, and the game ends', () => {
      // Both players hold xì dách (×2 = 200 each) but the dealer has only 300 after collecting nothing.
      let s = dealerTable({ a: hand(1, 13), b: hand(1, 12) }, hand(10, 2), [c(10)], 300);
      s = { ...s, stood: ['a', 'b'], turn: 'd' };
      s = act(s, 'd', { type: 'hit' });
      expect(s.phase).toBe('reveal');
      expect(s.chips).toEqual({ d: 0, a: XD_START_CHIPS + 150, b: XD_START_CHIPS + 150 });
      expect(s.log.some((e) => e.kind === 'bank-broke')).toBe(true);
      expect(xiDachGame.timeout!(s, { now: s.deadline }).result).not.toBeNull();
    });

    it('leaving mid-round hands the dealing to the house', () => {
      let s = dealerTable({ a: hand(10, 9), b: hand(10, 7) }, hand(10, 2), [c(5), c(9)]);
      s = act(s, 'a', { type: 'stand' });
      s = act(s, 'b', { type: 'stand' });
      s = xiDachGame.forfeit(s, 'd', { now: 0 }, 'left');
      // The house draws a 5 to 17 and settles.
      expect(s).toMatchObject({ dealerId: null, phase: 'reveal' });
      expect(s.dealer).toHaveLength(3);
      expect(s.chips.a).toBe(XD_START_CHIPS + 100);
      expect(s.chips.b).toBe(XD_START_CHIPS);
    });

    it('a player leaving mid-round leaves their stake to the dealer', () => {
      const s = xiDachGame.forfeit(dealerTable({ a: hand(10, 9), b: hand(10, 7) }, hand(10, 2), []), 'a', { now: 0 }, 'left');
      expect(s.chips.d).toBe(XD_START_CHIPS + 100);
      expect(s.turn).toBe('b');
    });

    it('games with a dealing bot run to the end', () => {
      let s = xiDachGame.setup(['bot:1', 'bot:2', 'bot:3'], dealt('bot:2'), { now: 0 }, null);
      let now = 0;
      const total = () => s.seats.reduce((sum, id) => sum + s.chips[id], 0);
      for (let steps = 0; !s.result; steps++) {
        expect(steps).toBeLessThan(3000);
        const mover = s.seats.find((id) => xiDachGame.botMove!(s, id, { now }));
        if (mover) s = act(s, mover, xiDachGame.botMove!(s, mover, { now })!, now);
        else {
          now = s.deadline;
          s = xiDachGame.timeout!(s, { now });
        }
        // Chips only move between the players and the dealer.
        if (s.phase !== 'play') expect(total()).toBe(3 * XD_START_CHIPS);
      }
      expect(s.log.some((e) => e.kind === 'hit' && e.player === 'bot:2') || s.log.some((e) => e.kind === 'stand' && e.player === 'bot:2')).toBe(true);
    });
  });
});
