import { describe, expect, it } from 'vitest';
import { Xiangqi, parseSquare } from './xiangqi-engine';

function perft(game: Xiangqi, depth: number): number {
  if (depth === 0) return 1;
  let nodes = 0;
  for (const m of game.moves()) {
    game.move(m);
    nodes += perft(game, depth - 1);
    game.undo();
  }
  return nodes;
}

const targets = (game: Xiangqi, from: string) =>
  game
    .moves(from)
    .map((m) => m.to)
    .sort();

describe('Xiangqi engine', () => {
  it('matches the published perft counts from the start position', () => {
    const game = new Xiangqi();
    expect(perft(game, 1)).toBe(44);
    expect(perft(game, 2)).toBe(1920);
    expect(perft(game, 3)).toBe(79666);
    // Depth 3 visits ~80k positions; give it room on slow CI machines.
  }, 60_000);

  it('round-trips FEN and undoes moves exactly', () => {
    const game = new Xiangqi();
    const start = game.fen();
    game.move('h2e2');
    game.move('h9g7');
    expect(game.fen()).toBe('rnbakab1r/9/1c4nc1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR w');
    game.undo();
    game.undo();
    expect(game.fen()).toBe(start);
  });

  it('hobbles a horse whose first step is blocked', () => {
    // Red horse on b0 with a red piece on b1 blocking the forward leg.
    // (Test positions keep the generals on different files so they don't face each other.)
    const game = new Xiangqi('3k5/9/9/9/9/9/9/9/1R7/1N2K4 w');
    expect(targets(game, 'b0')).toEqual(['d1']);
  });

  it('keeps elephants on their own side and blocks them at the eye', () => {
    const free = new Xiangqi('3k5/9/9/9/9/2B6/9/9/9/4K4 w');
    // From c4 the elephant may go back to a2/e2 but not across the river to a6/e6.
    expect(targets(free, 'c4')).toEqual(['a2', 'e2']);
    const blocked = new Xiangqi('3k5/9/9/9/9/2B6/3P5/9/9/4K4 w');
    expect(targets(blocked, 'c4')).toEqual(['a2']);
  });

  it('cannons move like chariots but capture only over a screen', () => {
    const game = new Xiangqi('3k5/9/9/9/1r7/9/1P7/9/1C7/4K4 w');
    const moves = game.moves('b1');
    // b2 is empty, b3 is the red screen, b5 holds a black chariot to capture.
    expect(moves.some((m) => m.to === 'b5' && m.captured === 'r')).toBe(true);
    expect(moves.some((m) => m.to === 'b3')).toBe(false);
    expect(moves.some((m) => m.to === 'b4')).toBe(false);
  });

  it('forbids the two generals from facing each other', () => {
    // The red advisor on e1 is the only thing between the generals.
    const game = new Xiangqi('4k4/9/9/9/9/9/9/9/4A4/4K4 w');
    expect(game.moves('e1')).toEqual([]);
  });

  it('soldiers only move sideways after crossing the river and never retreat', () => {
    const home = new Xiangqi('4k4/9/9/9/9/9/4P4/9/9/3K5 w');
    expect(targets(home, 'e3')).toEqual(['e4']);
    const crossed = new Xiangqi('4k4/9/9/4P4/9/9/9/9/9/3K5 w');
    expect(targets(crossed, 'e6')).toEqual(['d6', 'e7', 'f6']);
  });

  it('keeps generals and advisors inside the palace', () => {
    const game = new Xiangqi('3k5/9/9/9/9/9/9/9/9/3AK4 w');
    expect(targets(game, 'd0')).toEqual(['e1']);
    expect(targets(game, 'e0')).toEqual(['e1', 'f0']);
  });

  it('flags check and spots a side with no legal moves', () => {
    // A lone red chariot checking on e8 can simply be captured.
    const game = new Xiangqi('3aka3/4R4/9/9/9/9/9/9/9/3K5 b');
    expect(game.inCheck()).toBe(true);
    expect(game.moves().map((m) => m.from + m.to).sort()).toEqual(['d9e8', 'e9e8', 'f9e8']);
    // Two chariots on ranks 9 and 8 leave the black general nowhere to go.
    const mate = new Xiangqi('R3k4/R8/9/9/9/9/9/9/9/3K5 b');
    expect(mate.inCheck()).toBe(true);
    expect(mate.hasLegalMoves()).toBe(false);
  });

  it('knows which sides still have attacking pieces', () => {
    const game = new Xiangqi('3aka3/9/9/9/9/9/9/9/9/3AKAB2 w');
    expect(game.hasAttackers('r')).toBe(false);
    expect(game.hasAttackers('b')).toBe(false);
  });

  it('only accepts real squares', () => {
    expect(parseSquare('a0')).toEqual([0, 0]);
    expect(parseSquare('a ')).toBeNull();
    expect(parseSquare('j1')).toBeNull();
  });
});
