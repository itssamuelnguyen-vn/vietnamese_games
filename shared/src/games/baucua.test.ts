import { describe, expect, it } from 'vitest';
import type { RoomOptions } from '../types';
import { BC_BET_MS, BC_REVEAL_MS, BC_ROUNDS, BC_START_CHIPS, bauCuaGame, bauCuaPayout, type BauCuaMove, type BauCuaState, type Dice } from './baucua';

const options = {} as RoomOptions;
// Dice faces in symbol order: nai 0, bau 1, ga 2, ca 3, cua 4, tom 5; a value v comes from (v + 0.5) / 6.
const faces = (...symbols: number[]) => {
  const values = symbols.map((v) => (v + 0.5) / 6);
  return () => values.shift() ?? 0;
};
const game = (ids = ['a', 'b']) => bauCuaGame.setup(ids, options, { now: 0 }, null);
function act(s: BauCuaState, id: string, move: BauCuaMove, random?: () => number, now = 0) {
  const r = bauCuaGame.applyMove(s, id, move, { now, random });
  if (!r.ok) throw new Error(`${id} ${JSON.stringify(move)}: ${r.error}`);
  return r.state;
}

describe('bau cua', () => {
  it('pays a stake back plus once per die showing the animal, and nothing otherwise', () => {
    const dice: Dice = ['cua', 'cua', 'ca'];
    expect(bauCuaPayout(dice, 'cua', 50)).toBe(150);
    expect(bauCuaPayout(dice, 'ca', 50)).toBe(100);
    expect(bauCuaPayout(dice, 'nai', 50)).toBe(0);
  });

  it('starts everyone with chips in round 1 of 10', () => {
    const s = game();
    expect(s.chips).toEqual({ a: BC_START_CHIPS, b: BC_START_CHIPS });
    expect(s).toMatchObject({ round: 1, phase: 'bet', deadline: BC_BET_MS });
    expect(BC_ROUNDS).toBe(10);
  });

  it('takes bets in chip values the player can afford, and lets them be cleared', () => {
    let s = act(game(), 'a', { type: 'bet', symbol: 'cua', amount: 100 });
    s = act(s, 'a', { type: 'bet', symbol: 'cua', amount: 50 });
    expect(s.bets.a).toEqual({ cua: 150 });
    expect(s.chips.a).toBe(BC_START_CHIPS - 150);
    expect(() => act(s, 'a', { type: 'bet', symbol: 'cua', amount: 30 })).toThrow('INVALID_MOVE');
    expect(() => act({ ...s, chips: { ...s.chips, a: 40 } }, 'a', { type: 'bet', symbol: 'ga', amount: 50 })).toThrow('INVALID_MOVE');
    s = act(s, 'a', { type: 'clear' });
    expect(s.chips.a).toBe(BC_START_CHIPS);
  });

  it('rolls once everyone is ready and settles the bets', () => {
    let s = act(game(), 'a', { type: 'bet', symbol: 'cua', amount: 100 });
    s = act(s, 'b', { type: 'bet', symbol: 'nai', amount: 50 });
    s = act(s, 'a', { type: 'ready' });
    expect(s.phase).toBe('bet');
    s = act(s, 'b', { type: 'ready' }, faces(4, 4, 3), 1000);
    expect(s).toMatchObject({ phase: 'reveal', dice: ['cua', 'cua', 'ca'], deadline: 1000 + BC_REVEAL_MS });
    expect(s.chips.a).toBe(BC_START_CHIPS - 100 + 300);
    expect(s.chips.b).toBe(BC_START_CHIPS - 50);
    expect(s.log.filter((e) => e.kind === 'result')).toEqual([
      { kind: 'result', player: 'a', net: 200 },
      { kind: 'result', player: 'b', net: -50 },
    ]);
    // Nothing more until the next round.
    expect(() => act(s, 'a', { type: 'bet', symbol: 'cua', amount: 10 })).toThrow('INVALID_MOVE');
    const next = bauCuaGame.timeout!(s, { now: s.deadline });
    expect(next).toMatchObject({ round: 2, phase: 'bet', bets: {}, ready: [] });
  });

  it('rolls when betting time is up, with whatever is on the table', () => {
    const s = act(game(), 'a', { type: 'bet', symbol: 'tom', amount: 10 });
    expect(bauCuaGame.timeout!(s, { now: BC_BET_MS - 1 })).toBe(s);
    expect(bauCuaGame.timeout!(s, { now: BC_BET_MS, random: faces(5, 5, 5) }).chips.a).toBe(BC_START_CHIPS - 10 + 40);
  });

  it('a player who leaves ranks last; with one player left the game ends', () => {
    const s = bauCuaGame.forfeit(game(['a', 'b', 'c']), 'b', { now: 0 }, 'left');
    expect(s.result).toBeNull();
    const over = bauCuaGame.forfeit(s, 'c', { now: 0 }, 'left');
    expect(over.result?.ranking).toEqual(['a', 'c', 'b']);
  });

  it('bots bet a little and get ready; games of bots run to the end', () => {
    let s = game(['bot:1', 'bot:2', 'bot:3']);
    let now = 0;
    for (let steps = 0; !s.result; steps++) {
      expect(steps).toBeLessThan(2000);
      const mover = s.seats.find((id) => bauCuaGame.botMove!(s, id, { now }));
      if (mover) s = act(s, mover, bauCuaGame.botMove!(s, mover, { now })!, undefined, now);
      else {
        now = s.deadline;
        s = bauCuaGame.timeout!(s, { now });
      }
    }
    expect(s.round).toBe(BC_ROUNDS);
    expect(s.result.ranking).toHaveLength(3);
    expect(bauCuaGame.points!(s)).toMatchObject({ [s.result.ranking[0]]: { place: 1 } });
  });
});
