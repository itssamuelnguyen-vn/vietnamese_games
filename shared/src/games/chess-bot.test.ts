import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { chessGame, type ChessState } from './chess';
import { BOT_LEVELS } from '../types';
import { chessBotMove, chessBotSearch, hasFastPath, seenPositions } from './chess-bot';
import { BOT_THINK_MS, BOT_THINK_MS_BY_LEVEL, botThinkMs } from './match';

const A = 'player-a';
const B = 'bot:1';
const fresh = (pgn = ''): ChessState => ({ white: A, black: B, pgn, result: null, drawOffer: null, drawOfferedAt: {}, takebackRequest: null, takebackRequestedAt: {}, clock: null, firstMoveDeadline: null });
const fast = { timeMs: 300 };

describe('chess bot', () => {
  it('uses chess.js’s fast move generator (a chess.js upgrade that drops it would make the bot slow)', () => {
    expect(hasFastPath(new Chess())).toBe(true);
  });

  it('finds a mate in one', () => {
    expect(chessBotMove('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', fast)).toEqual({ from: 'd1', to: 'd8' });
  });

  it('takes a hanging queen, and promotes', () => {
    expect(chessBotMove('rnb1kbnr/pppp1ppp/8/3q4/8/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 1', fast)).toEqual({ from: 'c3', to: 'd5' });
    expect(chessBotMove('8/4P1k1/8/8/8/8/8/4K3 w - - 0 1', fast)).toEqual({ from: 'e7', to: 'e8', promotion: 'q' });
  });

  it('avoids walking into a mate in one', () => {
    // Black threatens Qxf2#... white must not ignore it: any move that allows mate is out.
    const fen = 'r1b1k1nr/pppp1ppp/2n5/2b1p3/2B1P2q/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1';
    const move = chessBotMove(fen, fast)!;
    const chess = new Chess(fen);
    chess.move(move);
    expect(chess.moves({ verbose: true }).some((m) => (chess.move(m), chess.isCheckmate() ? (chess.undo(), true) : (chess.undo(), false)))).toBe(false);
  });

  it('plays its colour on its turn and waits otherwise; grants takebacks; takes draws only when behind', () => {
    const now = { now: 0, random: () => 0 };
    expect(chessGame.botMove!(fresh(), B, now)).toBeNull();
    const move = chessGame.botMove!(fresh('1. e4'), B, now);
    expect(move).toMatchObject({ type: 'move' });
    expect(chessGame.applyMove(fresh('1. e4'), B, move!, now).ok).toBe(true);
    expect(chessGame.botMove!({ ...fresh('1. e4 e5'), takebackRequest: A }, B, now)).toEqual({ type: 'accept-takeback' });
    expect(chessGame.botMove!({ ...fresh('1. e4 e5'), drawOffer: A }, B, now)).toEqual({ type: 'decline-draw' });
    // Black (the bot) has given away its queen.
    const losing = { ...fresh('1. e4 e5 2. Qh5 Qg5 3. Qxg5'), drawOffer: A };
    expect(chessGame.botMove!(losing, B, now)).toEqual({ type: 'accept-draw' });
  });

  it('thinks for less when its clock runs low', () => {
    expect(botThinkMs(null, 'w', 0)).toBe(BOT_THINK_MS);
    expect(botThinkMs<'w' | 'b'>({ incrementMs: 0, remaining: { w: 3000, b: 60_000 }, turnStartedAt: 0 }, 'w', 0)).toBe(100);
  });

  it('thinks longer the harder its level, always within the clock', () => {
    expect(botThinkMs(null, 'w', 0, 'easy')).toBe(BOT_THINK_MS_BY_LEVEL.easy);
    expect(botThinkMs(null, 'w', 0, 'hard')).toBe(BOT_THINK_MS_BY_LEVEL.hard);
    expect(BOT_THINK_MS_BY_LEVEL.easy).toBeLessThan(BOT_THINK_MS_BY_LEVEL.medium);
    expect(BOT_THINK_MS_BY_LEVEL.medium).toBeLessThan(BOT_THINK_MS_BY_LEVEL.hard);
    // A minute left: 2 s at most, whatever the level.
    expect(botThinkMs<'w' | 'b'>({ incrementMs: 0, remaining: { w: 60_000, b: 60_000 }, turnStartedAt: 0 }, 'w', 0, 'hard')).toBe(2000);
  });
});

describe('chess bot levels', () => {
  // A slip on every move, picking the worst move it allows.
  const slipping = () => {
    let calls = 0;
    return () => (calls++ % 2 === 0 ? 0 : 0.999);
  };

  it('every level mates in one, takes a hanging queen, and avoids walking into a mate', () => {
    for (const level of BOT_LEVELS) {
      for (const random of [() => 0, slipping()]) {
        expect(chessBotMove('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', { ...fast, level, random })).toEqual({ from: 'd1', to: 'd8' });
        const fen = 'r1b1k1nr/pppp1ppp/2n5/2b1p3/2B1P2q/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1';
        const chess = new Chess(fen);
        chess.move(chessBotMove(fen, { ...fast, level, random })!);
        expect(chess.moves().some((m) => (chess.move(m), chess.isCheckmate() ? (chess.undo(), true) : (chess.undo(), false)))).toBe(false);
      }
      expect(chessBotMove('rnb1kbnr/pppp1ppp/8/3q4/8/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 1', { ...fast, level, random: () => 0 })).toEqual({ from: 'c3', to: 'd5' });
    }
  });

  it('easy slips now and then, for a worse move', () => {
    // An even opening position: a slip gives up something real, so the moves picked differ.
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const pick = (level: 'easy', random: () => number) => chessBotSearch(fen, { timeMs: 300, level, random });
    const steady = pick('easy', () => 0.999);
    const slipped = pick('easy', slipping());
    expect(slipped.score).toBeLessThan(steady.score);
  });

  it('hard searches deeper than medium in the same time', () => {
    const fen = 'r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N2N2/PP2BPPP/R2QKB1R w KQ - 0 8';
    const medium = chessBotSearch(fen, { timeMs: 500, level: 'medium' });
    const hard = chessBotSearch(fen, { timeMs: 500, level: 'hard' });
    expect(hard.depth).toBeGreaterThan(medium.depth);
  });

  it('steers clear of a threefold repetition when ahead', () => {
    // White is a queen up; its favourite move would repeat a position for the third time.
    const fen = '4k3/8/8/8/8/8/3QK3/8 w - - 0 1';
    const best = chessBotMove(fen, { ...fast, random: () => 0 })!;
    const chess = new Chess(fen);
    chess.move(best);
    const seen = new Map([[chess.hash(), 2]]);
    for (const level of BOT_LEVELS) expect(chessBotMove(fen, { ...fast, level, random: () => 0, seen })).not.toEqual(best);
  });

  it('takes a threefold repetition when clearly behind', () => {
    // Black has only its king left: a draw by repetition is the best it can hope for.
    const fen = '4k3/8/8/8/8/8/3QK3/8 b - - 0 1';
    const chess = new Chess(fen);
    chess.move('Kf7');
    const seen = new Map([[chess.hash(), 2]]);
    for (const level of ['medium', 'hard'] as const) expect(chessBotMove(fen, { ...fast, level, random: () => 0, seen })).toEqual({ from: 'e8', to: 'f7' });
  });

  it('counts the positions a game went through, for repetitions', () => {
    const chess = new Chess();
    chess.loadPgn('1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1');
    const seen = seenPositions(chess);
    expect(seen.get(new Chess().hash())).toBe(2);
    // The bot, as black to move here, would rather not go back to the start a third time.
    const state = fresh(chess.pgn());
    for (const level of BOT_LEVELS) {
      const move = chessGame.botMove!(state, B, { now: 0, random: () => 0, botLevel: level });
      expect(move).toMatchObject({ type: 'move' });
      expect(move).not.toEqual({ type: 'move', from: 'f6', to: 'g8' });
    }
  });
});
