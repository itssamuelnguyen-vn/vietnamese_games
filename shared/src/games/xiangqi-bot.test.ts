import { describe, expect, it } from 'vitest';
import { xiangqiGame, type XiangqiState } from './xiangqi';
import { xiangqiBotMove } from './xiangqi-bot';
import { Xiangqi } from './xiangqi-engine';

const R = 'red-player';
const B = 'bot:1';
const fresh = (moves: string[] = [], startFen?: string): XiangqiState => ({
  red: R,
  black: B,
  moves,
  startFen,
  result: null,
  drawOffer: null,
  drawOfferedAt: {},
  takebackRequest: null,
  takebackRequestedAt: {},
  clock: null,
  firstMoveDeadline: null,
});
const fast = { timeMs: 300 };

describe('xiangqi bot', () => {
  it('generates the same moves fast as the full move list', () => {
    const game = new Xiangqi();
    game.move('h2e2');
    game.move('h9g7');
    const key = (ms: { from: string; to: string }[]) => ms.map((m) => m.from + m.to).sort();
    expect(key(game.movesFast())).toEqual(key(game.moves()));
  });

  it('takes a hanging chariot with its cheapest attacker', () => {
    const game = new Xiangqi('rnbakabn1/9/1c5c1/p1p1p1p1p/9/r8/P1P1P1P1P/1C5C1/9/RNBAKABNR w');
    expect(xiangqiBotMove(game, new Map(), fast)).toEqual({ from: 'a3', to: 'a4' });
  });

  it('mates when it can', () => {
    // From a random game: the cannon's move leaves black without a legal reply.
    const game = new Xiangqi('2b6/r3a4/b3ka3/2c1p4/4R1C2/4P4/1pP5R/5A3/3N5/2B1KnB2 w');
    expect(xiangqiBotMove(game, new Map(), fast)).toEqual({ from: 'g5', to: 'g7' });
  });

  it('steers clear of a position already seen twice', () => {
    const game = new Xiangqi();
    const best = xiangqiBotMove(game, new Map(), { ...fast, random: () => 0 })!;
    // Mark the position after the bot's favourite move as seen twice.
    game.move(best);
    const seen = new Map([[game.positionKey(), 2]]);
    game.undo();
    const next = xiangqiBotMove(game, seen, { ...fast, random: () => 0 })!;
    expect(next).not.toEqual(best);
  });

  it('plays on its turn and waits otherwise; grants takebacks; declines an even draw', () => {
    const now = { now: 0, random: () => 0 };
    expect(xiangqiGame.botMove!(fresh(), B, now)).toBeNull();
    const move = xiangqiGame.botMove!(fresh(['h2e2']), B, now);
    expect(move).toMatchObject({ type: 'move' });
    expect(xiangqiGame.applyMove(fresh(['h2e2']), B, move!, now).ok).toBe(true);
    expect(xiangqiGame.botMove!({ ...fresh(['h2e2', 'h9g7']), takebackRequest: R }, B, now)).toEqual({ type: 'accept-takeback' });
    expect(xiangqiGame.botMove!({ ...fresh(['h2e2', 'h9g7']), drawOffer: R }, B, now)).toEqual({ type: 'decline-draw' });
  });
});
