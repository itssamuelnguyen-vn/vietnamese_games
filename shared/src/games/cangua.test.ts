import { describe, expect, it } from 'vitest';
import type { CaNguaRuleId, RoomOptions } from '../types';
import { GATE, STABLE, caNguaBotChoice, caNguaGame, choicesFor, squareOf, type CaNguaMove, type CaNguaState } from './cangua';

const options: RoomOptions = { timeControl: 'none', hostColor: 'random', handicap: 'none', turnTimer: 'none', houseRules: [], caroSize: '15', caroBlock: true, caNguaRules: [], stakes: 'points', walletStart: 200_000, stakePerPoint: 5_000, dealer: null, callSpeed: 'normal' };
const die = (...values: number[]) => () => (values.length ? (values.shift()! - 0.5) / 6 : 0);
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Players a (colour 0) and b (colour 2, opposite) with given horse positions; a to roll.
function table(a: number[], b: number[], rules: CaNguaRuleId[] = []): CaNguaState {
  const s = caNguaGame.setup(['a', 'b'], { ...options, caNguaRules: rules }, { now: 0 }, null);
  return { ...s, horses: { a, b } };
}

function act(s: CaNguaState, player: string, move: CaNguaMove, random?: () => number) {
  const r = caNguaGame.applyMove(s, player, move, { now: 0, random });
  if (!r.ok) throw new Error(`${player} ${JSON.stringify(move)}: ${r.error}`);
  return r.state;
}

// a rolls `value` (which must leave a choice) and moves `horse`.
const rollAndMove = (s: CaNguaState, value: number, horse: number) => act(act(s, 'a', { type: 'roll' }, die(value)), 'a', { type: 'move', horse });

const all = (p: number) => [p, p, p, p];

describe('co ca ngua', () => {
  it('two players sit opposite each other with every horse in the stable', () => {
    const s = caNguaGame.setup(['a', 'b'], options, { now: 0 }, null);
    expect(s.colors).toEqual([0, 2]);
    expect(s.horses).toEqual({ a: all(STABLE), b: all(STABLE) });
    expect(s).toMatchObject({ turn: 'a', phase: 'roll' });
    expect(caNguaGame.setup(['a', 'b', 'c', 'd'], options, { now: 0 }, null).colors).toEqual([0, 1, 2, 3]);
  });

  it('without a 6 nobody leaves the stable and the turn passes', () => {
    const s = act(table(all(STABLE), all(STABLE)), 'a', { type: 'roll' }, die(4));
    expect(s.turn).toBe('b');
    expect(s.log.map((e) => e.kind)).toEqual(['roll', 'stuck']);
  });

  it('a 6 brings a horse out and earns another roll', () => {
    const s = rollAndMove(table(all(STABLE), all(STABLE)), 6, 0);
    expect(s.horses.a).toEqual([0, STABLE, STABLE, STABLE]);
    expect(s).toMatchObject({ turn: 'a', phase: 'roll' });
  });

  it('three 6s in a row end the turn', () => {
    let s = rollAndMove(table(all(STABLE), all(STABLE)), 6, 0);
    // The start square is taken by our own horse, so the second 6 moves it on.
    s = rollAndMove(s, 6, 0);
    s = act(s, 'a', { type: 'roll' }, die(6));
    expect(s.turn).toBe('b');
    expect(s.log.at(-1)).toEqual({ kind: 'sixes', player: 'a' });
  });

  it('only a 6 brings a horse out, or a 1 too under one-out', () => {
    const s = table(all(STABLE), all(STABLE));
    expect(choicesFor(s, 'a', 1)).toEqual([]);
    expect(choicesFor({ ...s, rules: ['one-out'] }, 'a', 1).map((c) => c.to)).toEqual([0, 0, 0, 0]);
  });

  it('horses move by the roll but cannot jump over another horse', () => {
    const s = table([0, 3, STABLE, STABLE], all(STABLE));
    const roll5 = act(s, 'a', { type: 'roll' }, die(5));
    expect(choicesFor(roll5, 'a', 5).map((c) => c.horse)).toEqual([1]);
    expect(() => act(roll5, 'a', { type: 'move', horse: 0 })).toThrow('INVALID_MOVE');
    // Unless the table allows jumping.
    expect(choicesFor({ ...roll5, rules: ['jump'] }, 'a', 5).map((c) => c.horse)).toEqual([0, 1]);
  });

  it('landing on an opponent kicks it back to the stable', () => {
    // b's start square is 26 squares round the track from a's.
    const bProgress = (squareOf(0, 10) - squareOf(2, 0) + 52) % 52;
    const s = rollAndMove(table([7, STABLE, STABLE, STABLE], [bProgress, STABLE, STABLE, STABLE]), 3, 0);
    expect(s.horses.a[0]).toBe(10);
    expect(s.horses.b[0]).toBe(STABLE);
    expect(s.log.at(-1)).toMatchObject({ kind: 'move', kicked: 'b' });
  });

  it('a horse must stop exactly at its gate, then rolls to choose its home step', () => {
    const s = table([GATE - 2, STABLE, STABLE, STABLE], all(STABLE));
    expect(choicesFor(s, 'a', 3)).toEqual([]);
    const atGate = rollAndMove(s, 2, 0);
    expect(atGate.horses.a[0]).toBe(GATE);
    const home = rollAndMove({ ...atGate, turn: 'a' }, 4, 0);
    expect(home.horses.a[0]).toBe(GATE + 4);
  });

  it('climbing home needs the next step’s number, unless fast-home is on', () => {
    const s = table([GATE + 2, STABLE, STABLE, STABLE], all(STABLE));
    expect(choicesFor(s, 'a', 2)).toEqual([]);
    expect(choicesFor(s, 'a', 3)).toEqual([{ horse: 0, to: GATE + 3, kicks: null }]);
    expect(choicesFor({ ...s, rules: ['fast-home'] }, 'a', 2)).toEqual([{ horse: 0, to: GATE + 4, kicks: null }]);
  });

  it('wins with all four horses on the top four home steps', () => {
    const s = rollAndMove(table([GATE + 2, GATE + 4, GATE + 5, GATE + 6], [5, STABLE, STABLE, STABLE]), 3, 0);
    expect(s.result).toEqual({ winner: 'a', ranking: ['a', 'b'] });
    expect(caNguaGame.points!(s)).toEqual({ a: { place: 1, points: 1 }, b: { place: 2, points: -1 } });
  });

  it('only the player to move sees their choices', () => {
    const s = act(table([3, STABLE, STABLE, STABLE], all(STABLE)), 'a', { type: 'roll' }, die(2));
    expect(caNguaGame.playerView(s, 'a', { now: 0 }).choices).toHaveLength(1);
    expect(caNguaGame.playerView(s, 'b', { now: 0 }).choices).toEqual([]);
    expect(() => act(s, 'b', { type: 'roll' })).toThrow('NOT_YOUR_TURN');
  });

  it('out of time: rolls, then moves automatically', () => {
    const s = { ...table([3, STABLE, STABLE, STABLE], all(STABLE)), turnDeadline: 1000, turnLimitMs: 1000 };
    const rolled = caNguaGame.timeout!(s, { now: 1000, random: die(2) });
    expect(rolled.phase).toBe('move');
    const moved = caNguaGame.timeout!({ ...rolled, turnDeadline: 2000 }, { now: 2000 });
    expect(moved.horses.a[0]).toBe(5);
    expect(moved.turn).toBe('b');
  });

  it('the last player left wins', () => {
    const s = caNguaGame.forfeit(table(all(STABLE), all(STABLE)), 'a', { now: 0 }, 'left');
    expect(s.result).toEqual({ winner: 'b', ranking: ['b', 'a'] });
  });

  it('rolling gives a fresh turn timer for choosing the horse', () => {
    const s = { ...table([3, STABLE, STABLE, STABLE], all(STABLE)), turnLimitMs: 15_000, turnDeadline: 15_000 };
    const r = caNguaGame.applyMove(s, 'a', { type: 'roll' }, { now: 14_000, random: die(2) });
    expect(r.ok && r.state.turnDeadline).toBe(29_000);
  });

  it('bots prefer kicking an opponent', () => {
    const bProgress = (squareOf(0, 10) - squareOf(2, 0) + 52) % 52;
    const s = act(table([7, 20, STABLE, STABLE], [bProgress, STABLE, STABLE, STABLE]), 'a', { type: 'roll' }, die(3));
    expect(caNguaBotChoice(s, 'a')).toMatchObject({ horse: 0, kicks: { player: 'b', horse: 0 } });
  });

  it('bots play whole games to the end', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const ids = ['bot:1', 'bot:2', 'bot:3', 'bot:4'].slice(0, 2 + (seed % 3));
      const random = seeded(seed);
      let s = caNguaGame.setup(ids, { ...options, caNguaRules: seed % 2 ? ['jump', 'fast-home'] : [] }, { now: 0, random }, null);
      for (let i = 0; !s.result; i++) {
        expect(i).toBeLessThan(20_000);
        s = act(s, s.turn, caNguaGame.botMove!(s, s.turn, { now: 0 })!, random);
      }
      expect(s.result.ranking).toHaveLength(ids.length);
    }
  });
});
