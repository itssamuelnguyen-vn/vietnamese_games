import { describe, expect, it } from 'vitest';
import type { RoomOptions } from '../types';
import { beats, classify, combosIn, hintPlays, instantWin, leftoverPenalties, quickPick, tienlenGame, type Card, type TienLenState } from './tienlen';

const RANKS = '3456789TJQKA2';
const SUITS = 'scdh'; // ♠ ♣ ♦ ♥
// "3s" = 3♠, "Th" = 10♥, "2h" = 2♥
const card = (code: string): Card => RANKS.indexOf(code[0]) * 4 + SUITS.indexOf(code[1]);
const cards = (codes: string) => codes.split(' ').map(card);
const combo = (codes: string) => classify(cards(codes))!;

const ctx = { now: 0 };
const options: RoomOptions = { timeControl: 'none', hostColor: 'random', handicap: 'none', turnTimer: 'none', houseRules: [] };

function table(hands: Record<string, string>, extra: Partial<TienLenState> = {}): TienLenState {
  const seats = Object.keys(hands);
  return {
    seats,
    hands: Object.fromEntries(seats.map((id) => [id, cards(hands[id]).sort((a, b) => a - b)])),
    rules: [],
    turn: seats[0],
    trick: null,
    passed: [],
    finished: [],
    out: [],
    frozen: [],
    played: [],
    mustPlay: null,
    result: null,
    log: [],
    turnLimitMs: null,
    turnDeadline: null,
    ...extra,
  };
}

function act(state: TienLenState, player: string, move: { type: 'pass' } | string) {
  const r = tienlenGame.applyMove(state, player, move === 'pass' || typeof move !== 'string' ? { type: 'pass' } : { type: 'play', cards: cards(move) }, ctx);
  if (!r.ok) throw new Error(`${player} ${JSON.stringify(move)}: ${r.error}`);
  return r.state;
}

describe('classify', () => {
  it('recognises sets of equal rank', () => {
    expect(combo('7s').type).toBe('single');
    expect(combo('7s 7h').type).toBe('pair');
    expect(combo('7s 7c 7h').type).toBe('triple');
    expect(combo('7s 7c 7d 7h').type).toBe('quad');
    expect(classify(cards('7s 8s'))).toBeNull();
  });

  it('recognises straights of 3+ without a 2', () => {
    expect(combo('3s 4h 5d')).toMatchObject({ type: 'straight', size: 3 });
    expect(combo('Js Qs Kh As')).toMatchObject({ type: 'straight', size: 4 });
    expect(classify(cards('Qs Kh As 2d'))).toBeNull();
    expect(classify(cards('3s 4h 6d'))).toBeNull();
  });

  it('recognises runs of 3+ consecutive pairs without a 2', () => {
    expect(combo('3s 3h 4s 4h 5c 5d')).toMatchObject({ type: 'pair-run', size: 6 });
    expect(classify(cards('3s 3h 4s 4h 6c 6d'))).toBeNull();
    expect(classify(cards('Ks Kh As Ah 2c 2d'))).toBeNull();
    expect(classify(cards('3s 3h 4s 4h'))).toBeNull();
  });

  it('rejects duplicates and empty plays', () => {
    expect(classify([])).toBeNull();
    expect(classify([card('3s'), card('3s')])).toBeNull();
  });
});

describe('beats', () => {
  it('needs the same type and size with a higher top card (suits break ties)', () => {
    expect(beats(combo('3h'), combo('3s'))).toBe(true);
    expect(beats(combo('3s'), combo('3h'))).toBe(false);
    expect(beats(combo('8s 8h'), combo('8c 8d'))).toBe(true);
    expect(beats(combo('4s 5s 6h'), combo('3s 4s 5h'))).toBe(true);
    expect(beats(combo('4s 5s 6h 7h'), combo('3s 4s 5h'))).toBe(false);
    expect(beats(combo('9s 9h'), combo('2s'))).toBe(false);
  });

  it('lets bombs chop 2s and smaller bombs', () => {
    const run3 = combo('3s 3h 4s 4h 5c 5d');
    const quad = combo('7s 7c 7d 7h');
    const run4 = combo('3s 3h 4s 4h 5c 5d 6s 6h');
    expect(beats(run3, combo('2s'))).toBe(true);
    expect(beats(run3, combo('2s 2h'))).toBe(false);
    expect(beats(quad, combo('2h'))).toBe(true);
    expect(beats(quad, combo('2s 2h'))).toBe(true);
    expect(beats(quad, run3)).toBe(true);
    expect(beats(quad, run4)).toBe(false);
    expect(beats(run4, quad)).toBe(true);
    expect(beats(run4, combo('2s 2h'))).toBe(true);
    expect(beats(combo('3s 3h 4s 4h 5c 5d 6s 6h 7s 7h'), run4)).toBe(true);
    expect(beats(combo('8s 8c 8d 8h'), quad)).toBe(true);
    // Bombs don't beat ordinary cards they aren't meant to chop.
    expect(beats(quad, combo('As'))).toBe(false);
  });
});

describe('instantWin', () => {
  it('spots the winning deals', () => {
    expect(instantWin(cards('2s 2c 2d 2h 3s 4s 5s 6s 7s 8s 9s Ts Js'))).toBe('four-twos');
    expect(instantWin(cards('3s 4s 5s 6s 7s 8s 9s Ts Js Qs Ks As 2h'))).toBe('dragon');
    expect(instantWin(cards('3s 3h 5s 5h 7s 7h 9s 9h Js Jh Ks Kh 2h'))).toBe('six-pairs');
    expect(instantWin(cards('3s 3h 4s 4h 5s 5h 6s 6h 7s 7h Ks Ah 2h'))).toBe('five-pair-run');
    expect(instantWin(cards('3s 4h 6s 8h 9s Ts Jh Qs Kh As 2h 2s 5d'))).toBeNull();
  });
});

describe('hints', () => {
  const labels = (plays: Card[][]) => plays.map((p) => p.map((c) => RANKS[c >> 2] + SUITS[c & 3]).join(' '));

  it('lists sets, straights and pair runs in a hand', () => {
    const all = labels(combosIn(cards('3s 3h 4s 4h 5c 5d 7h')));
    expect(all).toContain('3s 3h');
    expect(all).toContain('3s 4s 5c');
    expect(all).toContain('3s 4s 5d');
    expect(all).toContain('3s 3h 4s 4h 5c 5d');
    expect(all).not.toContain('5c 7h');
  });

  it('suggests the smallest play that beats the table', () => {
    const hand = cards('4s 9h 9d Kc 2s');
    // 9♦ is lower than 9♥ (♦ < ♥), so it's the cheapest card that beats 8♣.
    expect(labels(hintPlays(hand, combo('8c'), null))[0]).toBe('9d');
    expect(labels(hintPlays(hand, combo('8c 8d'), null))).toEqual(['9d 9h']);
    expect(hintPlays(hand, combo('2h'), null)).toEqual([]);
  });

  it('offers bombs on a 2, but not on ordinary cards', () => {
    const hand = cards('7s 7c 7d 7h 9s');
    expect(labels(hintPlays(hand, combo('2h'), null))).toEqual(['7s 7c 7d 7h']);
    expect(labels(hintPlays(hand, combo('8c'), null))[0]).toBe('9s');
  });

  it('when leading, offloads the lowest cards in the longest combination, including a required card', () => {
    expect(labels(hintPlays(cards('3s 4h 5d 9c'), null, null))[0]).toBe('3s 4h 5d');
    expect(hintPlays(cards('3s 4h 5d 9c'), null, card('3s')).every((p) => p.includes(card('3s')))).toBe(true);
  });

  it('double-tap picks the whole set, or the longest run through a lone card', () => {
    const hand = cards('3s 6c 6d 6h 7s 8d 9c');
    expect(labels([quickPick(hand, card('6d'), null, null)!])).toEqual(['6c 6d 6h']);
    expect(labels([quickPick(hand, card('8d'), null, null)!])[0].split(' ')).toHaveLength(4);
    expect(quickPick(hand, card('3s'), combo('9h'), null)).toBeNull();
  });
});

describe('tienlenGame', () => {
  it('deals 13 cards each; the holder of the lowest card leads and must play it', () => {
    let seed = 42;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const s = tienlenGame.setup(['a', 'b', 'c'], options, { now: 0, random }, null);
    const all = Object.values(s.hands).flat();
    expect(Object.values(s.hands).every((h) => h.length === 13)).toBe(true);
    expect(new Set(all).size).toBe(39);
    if (!s.result) {
      expect(s.hands[s.turn!]).toContain(Math.min(...all));
      expect(s.mustPlay).toBe(Math.min(...all));
    }
  });

  it('the first play must include the required card', () => {
    const s = table({ a: '3s 4s 9h', b: '5h 6h 7h' }, { mustPlay: card('3s') });
    expect(tienlenGame.applyMove(s, 'a', { type: 'play', cards: cards('4s') }, ctx).ok).toBe(false);
    expect(act(s, 'a', '3s').turn).toBe('b');
  });

  it('rejects plays out of turn, cards not held, and weaker combinations', () => {
    const s = table({ a: '3s 9h', b: '5h 6h' });
    expect(tienlenGame.applyMove(s, 'b', { type: 'play', cards: cards('5h') }, ctx)).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
    expect(tienlenGame.applyMove(s, 'a', { type: 'play', cards: cards('5h') }, ctx).ok).toBe(false);
    const led = act(s, 'a', '9h');
    expect(tienlenGame.applyMove(led, 'b', { type: 'play', cards: cards('5h') }, ctx)).toEqual({ ok: false, error: 'INVALID_MOVE' });
  });

  it('the leader cannot pass; once everyone else passes the last player leads a new round', () => {
    const s = table({ a: '3s 9h Kd', b: '5h 6h', c: '4c 7c' });
    expect(tienlenGame.applyMove(s, 'a', { type: 'pass' }, ctx).ok).toBe(false);
    let t = act(s, 'a', '9h');
    t = act(t, 'b', 'pass');
    expect(t.turn).toBe('c');
    t = act(t, 'c', 'pass');
    expect(t).toMatchObject({ turn: 'a', trick: null, passed: [] });
    expect(t.log.at(-1)).toEqual({ kind: 'round', leader: 'a' });
  });

  it('players who passed sit out the rest of the round', () => {
    let t = table({ a: '3s 5s Kd', b: '4h 9h', c: '6c 8c' });
    t = act(t, 'a', '3s');
    t = act(t, 'b', 'pass');
    t = act(t, 'c', '6c');
    // b passed, so it's straight back to a.
    expect(t.turn).toBe('a');
  });

  it('ranks players as they go out and ends when one is left', () => {
    let t = table({ a: '3s', b: '4h 9h', c: '6c 8c' });
    t = act(t, 'a', '3s');
    expect(t.finished).toEqual(['a']);
    expect(t.turn).toBe('b');
    t = act(t, 'b', '4h');
    t = act(t, 'c', '6c');
    t = act(t, 'b', '9h');
    expect(t.result).toMatchObject({ ranking: ['a', 'b', 'c'], instant: null });
  });

  it('when the trick owner has gone out and the rest pass, the next player leads', () => {
    let t = table({ a: 'Ah', b: '4h 9h', c: '6c 8c' });
    t = act(t, 'a', 'Ah');
    t = act(t, 'b', 'pass');
    t = act(t, 'c', 'pass');
    expect(t).toMatchObject({ turn: 'b', trick: null });
  });

  it('logs chops', () => {
    let t = table({ a: '2h 3d', b: '7s 7c 7d 7h 9s' });
    t = act(t, 'a', '2h');
    t = act(t, 'b', '7s 7c 7d 7h');
    expect(t.log.find((e) => e.kind === 'play' && e.player === 'b')).toMatchObject({ combo: 'quad', chop: true });
  });

  it('times out by passing, or by leading the lowest card', () => {
    const timed = table({ a: '5s 9h', b: '4h 6h' }, { turnLimitMs: 30_000, turnDeadline: 30_000 });
    expect(tienlenGame.timeout!(timed, { now: 29_999 })).toBe(timed);
    const led = tienlenGame.timeout!(timed, { now: 30_000 });
    expect(led.log.at(-1)).toMatchObject({ kind: 'play', player: 'a', cards: [card('5s')], auto: true });
    expect(led).toMatchObject({ turn: 'b', turnDeadline: 60_000 });
    const passed = tienlenGame.timeout!(led, { now: 60_000 });
    expect(passed.log.at(-2)).toEqual({ kind: 'pass', player: 'b', auto: true });
    expect(passed.turn).toBe('a');
  });

  it('a player leaving mid-game ranks last and the others play on', () => {
    let t = table({ a: '3s 5s', b: '4h 9h', c: '6c 8c' });
    t = act(t, 'a', '3s');
    t = tienlenGame.forfeit(t, 'b', ctx, 'left');
    expect(t.turn).toBe('c');
    expect(t.result).toBeNull();
    t = act(t, 'c', '6c');
    t = act(t, 'a', 'pass');
    t = act(t, 'c', '8c');
    expect(t.result?.ranking).toEqual(['c', 'a', 'b']);
  });

  it('only shows each player their own hand until the game ends', () => {
    const t = table({ a: '3s 5s', b: '4h 9h' });
    const view = tienlenGame.playerView(t, 'a', ctx);
    expect(view.hand).toEqual(cards('3s 5s'));
    expect(JSON.stringify(view)).not.toContain(String(card('9h')));
    expect(view.revealed).toBeNull();
    expect(view.seats.find((s) => s.id === 'b')?.cards).toBe(2);
    expect(tienlenGame.playerView(t, 'spectator', ctx).hand).toEqual([]);
    // With two players the game ends as soon as one goes out.
    const over = act(table({ a: '3s', b: '4h 9h' }), 'a', '3s');
    expect(over.result?.ranking).toEqual(['a', 'b']);
    expect(tienlenGame.playerView(over, 'a', ctx).revealed?.b).toEqual(cards('4h 9h'));
  });

  it('the previous winner leads the next game with no required card', () => {
    const previous = { ...table({ a: '', b: '' }), result: { ranking: ['b', 'a'], instant: null, scores: {} } } as TienLenState;
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const s = tienlenGame.setup(['a', 'b'], options, { now: 0, random }, previous);
    if (!s.result) expect(s).toMatchObject({ turn: 'b', mustPlay: null });
  });

  describe('house rules', () => {
    it('no-two-finish: you cannot go out on a 2', () => {
      const s = table({ a: '2h', b: '4h 9h' }, { rules: ['no-two-finish'] });
      expect(tienlenGame.applyMove(s, 'a', { type: 'play', cards: cards('2h') }, ctx).ok).toBe(false);
      expect(act(table({ a: '2h', b: '4h 9h' }), 'a', '2h').result?.ranking).toEqual(['a', 'b']);
    });

    it('no-stack-chop: a chop cannot itself be chopped', () => {
      const hands = { a: '2h 3d', b: '7s 7c 7d 7h 9s', c: '8s 8c 8d 8h Ts' };
      const chopped = act(act(table(hands, { rules: ['no-stack-chop'] }), 'a', '2h'), 'b', '7s 7c 7d 7h');
      expect(tienlenGame.applyMove(chopped, 'c', { type: 'play', cards: cards('8s 8c 8d 8h') }, ctx).ok).toBe(false);
      const allowed = act(act(table(hands), 'a', '2h'), 'b', '7s 7c 7d 7h');
      expect(act(allowed, 'c', '8s 8c 8d 8h').trick?.by).toBe('c');
    });

    it('four-pairs-anytime: a 4-pair run chops a 2 out of turn, even after passing', () => {
      const hands = { a: '2h 3d', b: '9s Kd', c: '3s 3h 4s 4h 5c 5d 6s 6h Ac' };
      // c passes first, then a plays a 2 and it's b's turn.
      let s = table(hands, { rules: ['four-pairs-anytime'], turn: 'c', trick: { cards: [card('Qd')], combo: combo('Qd'), by: 'b', chop: false } });
      s = act(s, 'c', 'pass');
      s = act(s, 'a', '2h');
      expect(s.turn).toBe('b');
      const r = tienlenGame.applyMove(s, 'c', { type: 'play', cards: cards('3s 3h 4s 4h 5c 5d 6s 6h') }, ctx);
      expect(r.ok && r.state.trick).toMatchObject({ by: 'c', chop: true });
      expect(r.ok && r.state.passed).not.toContain('c');
      // Without the rule it's just not c's turn.
      const plain = act(act(table(hands, { turn: 'c', trick: { cards: [card('Qd')], combo: combo('Qd'), by: 'b', chop: false } }), 'c', 'pass'), 'a', '2h');
      expect(tienlenGame.applyMove(plain, 'c', { type: 'play', cards: cards('3s 3h 4s 4h 5c 5d 6s 6h') }, ctx)).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
    });
  });

  describe('scoring', () => {
    it('awards points by place', () => {
      let t = table({ a: '3s', b: '4h 9h', c: '6c 8c' });
      t = act(t, 'a', '3s');
      t = act(t, 'b', '4h');
      t = act(t, 'c', '6c');
      t = act(t, 'b', '9h');
      expect(Object.fromEntries(Object.entries(t.result!.scores).map(([id, sc]) => [id, sc.points]))).toEqual({ a: 2, b: 0, c: -2 });
    });

    it('penalises leftover 2s and bombs', () => {
      expect(leftoverPenalties(cards('2s 2h 3s'))).toEqual([
        { kind: 'black-two', points: -1 },
        { kind: 'red-two', points: -2 },
      ]);
      expect(leftoverPenalties(cards('7s 7c 7d 7h')).map((p) => p.kind)).toEqual(['quad']);
      expect(leftoverPenalties(cards('3s 3h 4s 4h 5c 5d 9s')).map((p) => p.kind)).toEqual(['pair-run']);
    });

    it('with the scoring rule, the last player pays for leftovers', () => {
      let t = table({ a: '3s', b: '2h 9h' }, { rules: ['penalties'], played: ['b'] });
      t = act(t, 'a', '3s');
      expect(t.result!.scores.b).toEqual({ place: 2, points: -1 - 2, penalties: [{ kind: 'red-two', points: -2 }] });
      expect(t.result!.scores.a.points).toBe(1);
    });

    it('with the scoring rule, players who never played are frozen when someone goes out', () => {
      // a goes out on the first play; b already played earlier, c never did.
      let t = table({ a: '9s', b: '3h 4h', c: '6c 8c' }, { rules: ['penalties'], played: ['b'] });
      t = act(t, 'a', '9s');
      expect(t.frozen).toEqual(['c']);
      expect(t.log.at(-1)).toMatchObject({ kind: 'frozen', player: 'c' });
      // Only b is left holding cards, so the game ends with c ranked behind b.
      expect(t.result?.ranking).toEqual(['a', 'b', 'c']);
      expect(t.result!.scores.c.penalties.map((p) => p.kind)).toContain('frozen');
    });
  });
});
