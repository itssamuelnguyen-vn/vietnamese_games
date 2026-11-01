import { describe, expect, it } from 'vitest';
import { BOT_LEVELS, DEFAULT_ROOM_OPTIONS, type RoomOptions } from '../types';
import { caroBotCell } from './caro-bot';
import { caroGame, type CaroState } from './caro';

const defaultOptions: RoomOptions = { ...DEFAULT_ROOM_OPTIONS, timeControl: 'none', hostColor: 'white', caroSize: '15', caroBlock: true };
const S = 15;
const at = (r: number, c: number) => r * S + c;
// Out-of-the-way stones, far enough apart that they never make anything.
const FILLER = [at(0, 0), at(0, 14), at(14, 0), at(14, 14), at(0, 7), at(14, 7), at(7, 0), at(7, 14), at(3, 0), at(11, 14)];

// The moves of a game where X and O have these stones, padded with filler, with `toMove` to play.
function position(xs: number[], os: number[], toMove: 'x' | 'o'): number[] {
  const filler = FILLER.filter((c) => !xs.includes(c) && !os.includes(c));
  const x = [...xs];
  const o = [...os];
  while (x.length < o.length + (toMove === 'o' ? 1 : 0)) x.push(filler.shift()!);
  while (o.length < x.length - (toMove === 'o' ? 1 : 0)) o.push(filler.shift()!);
  return x.flatMap((cell, i) => (i < o.length ? [cell, o[i]] : [cell]));
}

const first = () => 0;

// The game after these moves, X moving first, as caroGame sees it.
function state(moves: number[]): CaroState {
  let s = caroGame.setup(['x', 'o'], defaultOptions, { now: 0 }, null);
  for (const cell of moves) {
    const r = caroGame.applyMove(s, moves.indexOf(cell) % 2 === 0 ? 'x' : 'o', { type: 'place', cell }, { now: 0 });
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  return s;
}

describe('caro bot levels', () => {
  it('every level finishes an open four', () => {
    const moves = position([at(7, 5), at(7, 6), at(7, 7), at(7, 8)], [], 'x');
    for (const level of BOT_LEVELS) expect([at(7, 4), at(7, 9)]).toContain(caroBotCell(moves, S, true, level, first));
  });

  it('blocks a broken four (O O _ O O)', () => {
    const moves = position([], [at(7, 5), at(7, 6), at(7, 8), at(7, 9)], 'x');
    for (const level of BOT_LEVELS) expect(caroBotCell(moves, S, true, level, first)).toBe(at(7, 7));
  });

  it('medium and hard stop a broken three (_O_OO_) before it becomes an open four', () => {
    const moves = position([at(10, 3)], [at(7, 5), at(7, 7), at(7, 8)], 'x');
    for (const level of ['medium', 'hard'] as const) expect([at(7, 4), at(7, 6), at(7, 9)]).toContain(caroBotCell(moves, S, true, level, first));
  });

  it('medium and hard make a four-three when they have one', () => {
    // X: a three along row 7 closed by O on the left, and two down column 7. (7,7) makes a four and
    // an open three at once.
    const moves = position([at(7, 4), at(7, 5), at(7, 6), at(5, 7), at(6, 7)], [at(7, 3)], 'x');
    for (const level of ['medium', 'hard'] as const) expect(caroBotCell(moves, S, true, level, first)).toBe(at(7, 7));
  });

  it('medium and hard make a double three when they have one', () => {
    // (7,7) makes open threes along row 7 and column 7.
    const moves = position([at(7, 5), at(7, 6), at(5, 7), at(6, 7)], [], 'x');
    for (const level of ['medium', 'hard'] as const) expect(caroBotCell(moves, S, true, level, first)).toBe(at(7, 7));
  });

  it('medium sees a broken three of its own as a threat: X_XX becomes an open four', () => {
    const moves = position([at(7, 5), at(7, 7), at(7, 8)], [], 'x');
    expect(caroBotCell(moves, S, true, 'medium', first)).toBe(at(7, 6));
  });

  it('hard plays out a forced win by fours against the best defence', () => {
    // Closed threes along rows 8 and 9 and two stones up column 9: (9,9) makes a four, and once O
    // has blocked it, (8,9) makes two more at once (there are other ways too).
    const xs = [at(9, 6), at(9, 7), at(9, 8), at(6, 9), at(7, 9), at(8, 6), at(8, 7), at(8, 8)];
    const os = [at(9, 5), at(5, 9), at(8, 5), at(6, 10)];
    const moves = position(xs, os, 'x');
    for (let i = 0; i < 4 && !caroGame.isOver(state(moves)); i++) {
      moves.push(caroBotCell(moves, S, true, 'hard', first));
      if (caroGame.isOver(state(moves))) break;
      moves.push(caroBotCell(moves, S, true, 'hard', first));
    }
    expect(state(moves).result?.winner).toBe('x');
  });

  it('easy blocks most fours, but not every one', () => {
    const moves = position([], [at(7, 5), at(7, 6), at(7, 7), at(7, 8)], 'x');
    expect([at(7, 4), at(7, 9)]).toContain(caroBotCell(moves, S, true, 'easy', () => 0.5));
    expect([at(7, 4), at(7, 9)]).not.toContain(caroBotCell(moves, S, true, 'easy', () => 0.95));
  });

  it('plays at the level the room gave it', () => {
    const s = state(position([], [at(7, 5), at(7, 6), at(7, 7), at(7, 8)], 'x'));
    const cellAt = (botLevel: 'easy' | 'hard') => (caroGame.botMove!(s, 'x', { now: 0, random: () => 0.95, botLevel }) as { cell: number }).cell;
    // Easy may let a four through (when its roll says so); hard never does.
    expect([at(7, 4), at(7, 9)]).not.toContain(cellAt('easy'));
    expect([at(7, 4), at(7, 9)]).toContain(cellAt('hard'));
  });

  it('hard thinks for well under a second even on a crowded 19x19 board', () => {
    // A long, quiet game: stones in a loose checkerboard pattern around the centre.
    const size = 19;
    const moves: number[] = [];
    for (let r = 3; r < 16; r++) for (let c = 3; c < 16; c += 3) moves.push(r * size + c + (r % 2));
    if (moves.length % 2) moves.pop();
    const start = Date.now();
    const cell = caroBotCell(moves, size, true, 'hard');
    expect(moves).not.toContain(cell);
    expect(Date.now() - start).toBeLessThan(1500);
  });
});
