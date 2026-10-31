import { describe, expect, it } from 'vitest';
import { chessGame, type ChessMove, type ChessState } from './chess';

const A = 'player-a';
const B = 'player-b';

// Fixed colours keep tests deterministic: A is white, B is black.
const fresh = (): ChessState => ({ white: A, black: B, pgn: '', result: null });

function play(state: ChessState, moves: [string, string, string][]): ChessState {
  for (const [player, from, to] of moves) {
    const r = chessGame.applyMove(state, player, { type: 'move', from, to });
    if (!r.ok) throw new Error(`${from}-${to} rejected: ${r.error}`);
    state = r.state;
  }
  return state;
}

describe('chessGame', () => {
  it('assigns both players a colour', () => {
    for (let i = 0; i < 20; i++) {
      const s = chessGame.setup([A, B]);
      expect([s.white, s.black].sort()).toEqual([A, B]);
    }
  });

  it('starts with white to move and an empty history', () => {
    const view = chessGame.playerView(fresh(), A);
    expect(view.turn).toBe('w');
    expect(view.history).toEqual([]);
    expect(view.lastMove).toBeNull();
  });

  it('rejects moving out of turn', () => {
    const r = chessGame.applyMove(fresh(), B, { type: 'move', from: 'e7', to: 'e5' });
    expect(r).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
  });

  it('rejects illegal moves', () => {
    const r = chessGame.applyMove(fresh(), A, { type: 'move', from: 'e2', to: 'e5' });
    expect(r).toEqual({ ok: false, error: 'INVALID_MOVE' });
  });

  it('rejects players who are not in the game', () => {
    const r = chessGame.applyMove(fresh(), 'stranger', { type: 'move', from: 'e2', to: 'e4' });
    expect(r).toEqual({ ok: false, error: 'NOT_A_PLAYER' });
  });

  it('records moves in the player view', () => {
    const s = play(fresh(), [
      [A, 'e2', 'e4'],
      [B, 'e7', 'e5'],
    ]);
    const view = chessGame.playerView(s, A);
    expect(view.history).toEqual(['e4', 'e5']);
    expect(view.lastMove).toEqual({ from: 'e7', to: 'e5' });
    expect(view.turn).toBe('w');
  });

  it('detects checkmate and the winner', () => {
    // Fool's mate: 1. f3 e5 2. g4 Qh4#
    const s = play(fresh(), [
      [A, 'f2', 'f3'],
      [B, 'e7', 'e5'],
      [A, 'g2', 'g4'],
      [B, 'd8', 'h4'],
    ]);
    expect(s.result).toEqual({ winner: B, reason: 'checkmate' });
    expect(chessGame.isOver(s)).toBe(true);
    expect(chessGame.applyMove(s, A, { type: 'move', from: 'e2', to: 'e4' })).toEqual({
      ok: false,
      error: 'GAME_OVER',
    });
  });

  it('detects stalemate as a draw', () => {
    // Sam Loyd's 10-move stalemate; the final 10. Qe6 goes through applyMove.
    const pgn = '1. e3 a5 2. Qh5 Ra6 3. Qxa5 h5 4. h4 Rah6 5. Qxc7 f6 6. Qxd7+ Kf7 7. Qxb7 Qd3 8. Qxb8 Qh7 9. Qxc8 Kg6';
    const r = chessGame.applyMove({ ...fresh(), pgn }, A, { type: 'move', from: 'c8', to: 'e6' });
    expect(r.ok && r.state.result).toEqual({ winner: null, reason: 'stalemate' });
  });

  it('resigning hands the win to the opponent', () => {
    const r = chessGame.applyMove(fresh(), A, { type: 'resign' } satisfies ChessMove);
    expect(r.ok && r.state.result).toEqual({ winner: B, reason: 'resign' });
  });

  it('forfeit ends the game for the leaving player only once', () => {
    const s = chessGame.forfeit(fresh(), B);
    expect(s.result).toEqual({ winner: A, reason: 'resign' });
    expect(chessGame.forfeit(s, A)).toBe(s);
  });
});
