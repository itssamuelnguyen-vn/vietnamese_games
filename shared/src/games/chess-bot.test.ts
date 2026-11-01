import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { chessGame, type ChessState } from './chess';
import { chessBotMove, hasFastPath } from './chess-bot';
import { BOT_THINK_MS, botThinkMs } from './match';

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
});
