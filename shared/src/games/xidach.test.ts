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
    expect(view.dealer).toHaveLength(1);
  });

  it('needs 16 to stand; drawing past 21 is bust and passes the turn', () => {
    let s = table({ a: hand(10, 4), b: hand(10, 9) }, hand(10, 6), hand(9, 1));
    expect(() => act(s, 'a', { type: 'stand' })).toThrow('INVALID_MOVE');
    expect(() => act(s, 'b', { type: 'hit' })).toThrow('NOT_YOUR_TURN');
    s = act(s, 'a', { type: 'hit' });
    expect(s.hands.a).toHaveLength(3);
    expect(s.turn).toBe('b');
    expect(s.log.some((e) => e.kind === 'bust' && e.player === 'a')).toBe(true);
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
});
