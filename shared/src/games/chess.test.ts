import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { canMate, chessGame, type ChessMove, type ChessState } from './chess';

const A = 'player-a';
const B = 'player-b';

// Fixed colours keep tests deterministic: A is white, B is black.
const fresh = (): ChessState => ({ white: A, black: B, pgn: '', result: null, drawOffer: null, drawOfferedAt: {}, takebackRequest: null, takebackRequestedAt: {}, clock: null, firstMoveDeadline: null });
const ctx = { now: 0 };

function play(state: ChessState, moves: [string, string, string][]): ChessState {
  for (const [player, from, to] of moves) {
    const r = chessGame.applyMove(state, player, { type: 'move', from, to }, ctx);
    if (!r.ok) throw new Error(`${from}-${to} rejected: ${r.error}`);
    state = r.state;
  }
  return state;
}

describe('chessGame', () => {
  it('assigns both players a colour', () => {
    for (let i = 0; i < 20; i++) {
      const s = chessGame.setup([A, B], { timeControl: 'none', hostColor: 'random', handicap: 'none', turnTimer: 'none', houseRules: [], caroSize: '15', caroBlock: true, caNguaRules: [], stakes: 'points', walletStart: 200_000, stakePerPoint: 5_000, dealer: null, callSpeed: 'normal', caroLoserFirst: true }, ctx, null);
      expect([s.white, s.black].sort()).toEqual([A, B]);
    }
  });

  it('starts with white to move and an empty history', () => {
    const view = chessGame.playerView(fresh(), A, ctx);
    expect(view.turn).toBe('w');
    expect(view.history).toEqual([]);
    expect(view.lastMove).toBeNull();
  });

  it('rejects moving out of turn', () => {
    const r = chessGame.applyMove(fresh(), B, { type: 'move', from: 'e7', to: 'e5' }, ctx);
    expect(r).toEqual({ ok: false, error: 'NOT_YOUR_TURN' });
  });

  it('rejects illegal moves', () => {
    const r = chessGame.applyMove(fresh(), A, { type: 'move', from: 'e2', to: 'e5' }, ctx);
    expect(r).toEqual({ ok: false, error: 'INVALID_MOVE' });
  });

  it('rejects players who are not in the game', () => {
    const r = chessGame.applyMove(fresh(), 'stranger', { type: 'move', from: 'e2', to: 'e4' }, ctx);
    expect(r).toEqual({ ok: false, error: 'NOT_A_PLAYER' });
  });

  it('records moves in the player view', () => {
    const s = play(fresh(), [
      [A, 'e2', 'e4'],
      [B, 'e7', 'e5'],
    ]);
    const view = chessGame.playerView(s, A, ctx);
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
    expect(chessGame.applyMove(s, A, { type: 'move', from: 'e2', to: 'e4' }, ctx)).toEqual({
      ok: false,
      error: 'GAME_OVER',
    });
  });

  it('detects stalemate as a draw', () => {
    // Sam Loyd's 10-move stalemate; the final 10. Qe6 goes through applyMove.
    const pgn = '1. e3 a5 2. Qh5 Ra6 3. Qxa5 h5 4. h4 Rah6 5. Qxc7 f6 6. Qxd7+ Kf7 7. Qxb7 Qd3 8. Qxb8 Qh7 9. Qxc8 Kg6';
    const r = chessGame.applyMove({ ...fresh(), pgn }, A, { type: 'move', from: 'c8', to: 'e6' }, ctx);
    expect(r.ok && r.state.result).toEqual({ winner: null, reason: 'stalemate' });
  });

  it('resigning hands the win to the opponent', () => {
    const r = chessGame.applyMove(fresh(), A, { type: 'resign' } satisfies ChessMove, ctx);
    expect(r.ok && r.state.result).toEqual({ winner: B, reason: 'resign' });
  });

  it('forfeit ends the game for the leaving player only once', () => {
    const s = chessGame.forfeit(fresh(), B, ctx, 'left');
    expect(s.result).toEqual({ winner: A, reason: 'resign' });
    expect(chessGame.forfeit(s, A, ctx, 'left')).toBe(s);
    expect(chessGame.forfeit(fresh(), B, ctx, 'abandoned').result).toEqual({ winner: A, reason: 'abandoned' });
  });

  describe('draw offers', () => {
    const act = (state: ChessState, player: string, type: 'offer-draw' | 'accept-draw' | 'decline-draw') =>
      chessGame.applyMove(state, player, { type }, ctx);
    const ok = (r: ReturnType<typeof act>) => {
      if (!r.ok) throw new Error(r.error);
      return r.state;
    };

    it('ends in a draw when the opponent accepts', () => {
      const offered = ok(act(fresh(), A, 'offer-draw'));
      expect(offered.drawOffer).toBe(A);
      expect(chessGame.playerView(offered, B, ctx).drawOffer).toBe(A);
      expect(ok(act(offered, B, 'accept-draw')).result).toEqual({ winner: null, reason: 'agreement' });
    });

    it('treats a counter-offer as acceptance', () => {
      const offered = ok(act(fresh(), A, 'offer-draw'));
      expect(ok(act(offered, B, 'offer-draw')).result).toEqual({ winner: null, reason: 'agreement' });
    });

    it('cannot accept or decline your own offer, or a missing one', () => {
      const offered = ok(act(fresh(), A, 'offer-draw'));
      expect(act(offered, A, 'accept-draw').ok).toBe(false);
      expect(act(offered, A, 'decline-draw').ok).toBe(false);
      expect(act(fresh(), B, 'accept-draw').ok).toBe(false);
    });

    it('allows one offer per ply and clears offers on decline or a move', () => {
      const offered = ok(act(fresh(), A, 'offer-draw'));
      const declined = ok(act(offered, B, 'decline-draw'));
      expect(declined.drawOffer).toBeNull();
      expect(act(declined, A, 'offer-draw').ok).toBe(false);
      expect(chessGame.playerView(declined, A, ctx).canOfferDraw).toBe(false);
      expect(chessGame.playerView(declined, B, ctx).canOfferDraw).toBe(true);

      const moved = play(ok(act(declined, B, 'offer-draw')), [[A, 'e2', 'e4']]);
      expect(moved.drawOffer).toBeNull();
      expect(act(moved, A, 'offer-draw').ok).toBe(true);
    });
  });

  describe('fixes from review', () => {
    const act = (state: ChessState, player: string, move: Parameters<typeof chessGame.applyMove>[2]) => {
      const r = chessGame.applyMove(state, player, move, ctx);
      if (!r.ok) throw new Error(r.error);
      return r.state;
    };

    it('a draw offer stands when the player who made it moves', () => {
      let s = act(fresh(), A, { type: 'offer-draw' });
      s = act(s, A, { type: 'move', from: 'e2', to: 'e4' });
      expect(s.drawOffer).toBe(A);
      // The opponent moving on declines it.
      expect(act(s, B, { type: 'move', from: 'e7', to: 'e5' }).drawOffer).toBeNull();
    });

    it('a first move that arrives after the deadline aborts the game', () => {
      const s = chessGame.setup([A, B], { timeControl: '3+2', hostColor: 'white', handicap: 'none', turnTimer: 'none', houseRules: [], caroSize: '15', caroBlock: true, caNguaRules: [], stakes: 'points', walletStart: 200_000, stakePerPoint: 5_000, dealer: null, callSpeed: 'normal', caroLoserFirst: true }, { now: 0 }, null);
      const r = chessGame.applyMove(s, A, { type: 'move', from: 'e2', to: 'e4' }, { now: 30_000 });
      expect(r.ok && r.state.result).toEqual({ winner: null, reason: 'aborted' });
    });

    it('a takeback also takes back the increment earned by the undone move', () => {
      const go = (s: ChessState, p: string, from: string, to: string, now: number) => {
        const r = chessGame.applyMove(s, p, { type: 'move', from, to }, { now });
        if (!r.ok) throw new Error(r.error);
        return r.state;
      };
      let s: ChessState = { ...fresh(), clock: { incrementMs: 2_000, remaining: { w: 60_000, b: 60_000 }, turnStartedAt: null } };
      s = go(go(s, A, 'e2', 'e4', 0), B, 'e7', 'e5', 0);
      s = go(s, A, 'g1', 'f3', 0);
      expect(s.clock?.remaining.w).toBe(62_000);
      s = act(s, A, { type: 'request-takeback' });
      s = act(s, B, { type: 'accept-takeback' });
      expect(s.clock?.remaining.w).toBe(60_000);
    });

    it('wins and losses count on the room scoreboard', () => {
      expect(chessGame.points!(act(fresh(), A, { type: 'resign' }))).toEqual({ [A]: { points: -1, place: 2 }, [B]: { points: 1, place: 1 } });
    });

    it("a draw is nobody's win, and an aborted game does not count", () => {
      const drawn = act(act(fresh(), A, { type: 'offer-draw' }), B, { type: 'accept-draw' });
      expect(chessGame.points!(drawn)).toEqual({ [A]: { points: 0, place: 2 }, [B]: { points: 0, place: 2 } });
      expect(chessGame.points!({ ...drawn, result: { winner: null, reason: 'aborted' } })).toBeNull();
    });
  });

  describe('clocks', () => {
    const timed = (): ChessState => ({
      ...fresh(),
      clock: { incrementMs: 2_000, remaining: { w: 60_000, b: 60_000 }, turnStartedAt: null },
    });
    const mv = (state: ChessState, player: string, from: string, to: string, now: number) => {
      const r = chessGame.applyMove(state, player, { type: 'move', from, to }, { now });
      if (!r.ok) throw new Error(r.error);
      return r.state;
    };
    // After 1. e4 (t=21s) e5 (t=50s, inside black's 30s first-move window): both clocks full, white's running.
    const opened = () => mv(mv(timed(), A, 'e2', 'e4', 21_000), B, 'e7', 'e5', 50_000);

    it('sets up clocks from the chosen time control', () => {
      const s = chessGame.setup([A, B], { timeControl: '3+2', hostColor: 'random', handicap: 'none', turnTimer: 'none', houseRules: [], caroSize: '15', caroBlock: true, caNguaRules: [], stakes: 'points', walletStart: 200_000, stakePerPoint: 5_000, dealer: null, callSpeed: 'normal', caroLoserFirst: true }, ctx, null);
      expect(s.clock).toEqual({ incrementMs: 2_000, remaining: { w: 180_000, b: 180_000 }, turnStartedAt: null });
      expect(chessGame.setup([A, B], { timeControl: 'none', hostColor: 'random', handicap: 'none', turnTimer: 'none', houseRules: [], caroSize: '15', caroBlock: true, caNguaRules: [], stakes: 'points', walletStart: 200_000, stakePerPoint: 5_000, dealer: null, callSpeed: 'normal', caroLoserFirst: true }, ctx, null).clock).toBeNull();
    });

    it('only starts once both sides have moved', () => {
      const first = mv(timed(), A, 'e2', 'e4', 1_000);
      expect(first.clock?.turnStartedAt).toBeNull();
      // Only the first-move deadline applies until black has replied.
      expect(chessGame.deadline!(first)).toBe(31_000);
      const s = opened();
      expect(s.clock).toMatchObject({ remaining: { w: 60_000, b: 60_000 }, turnStartedAt: 50_000 });
      expect(chessGame.deadline!(s)).toBe(110_000);
    });

    it('charges thinking time, adds the increment and reports live time in the view', () => {
      const s = mv(opened(), A, 'g1', 'f3', 60_000);
      expect(s.clock?.remaining.w).toBe(52_000);
      expect(chessGame.playerView(s, B, { now: 65_000 }).clock).toEqual({
        remaining: { w: 52_000, b: 55_000 },
        running: 'b',
        incrementMs: 2_000,
      });
    });

    it('flags the side to move once the deadline passes', () => {
      const s = opened();
      expect(chessGame.timeout!(s, { now: 109_999 })).toBe(s);
      const flagged = chessGame.timeout!(s, { now: 110_000 });
      expect(flagged.result).toEqual({ winner: B, reason: 'timeout' });
      expect(flagged.clock).toMatchObject({ remaining: { w: 0 }, turnStartedAt: null });
    });

    it('a move sent after the flag fell loses on time', () => {
      const r = chessGame.applyMove(opened(), A, { type: 'move', from: 'g1', to: 'f3' }, { now: 200_000 });
      expect(r.ok && r.state.result).toEqual({ winner: B, reason: 'timeout' });
    });

    it('is a draw on time when the opponent cannot mate', () => {
      const lone: ChessState = {
        ...fresh(),
        pgn: '[SetUp "1"]\n[FEN "4k3/8/8/8/8/8/8/r3K3 w - - 0 1"]\n\n*',
        clock: { incrementMs: 0, remaining: { w: 1_000, b: 1_000 }, turnStartedAt: 0 },
      };
      // White (to move) flags, but black has a rook: black wins.
      expect(chessGame.timeout!(lone, { now: 1_000 }).result).toEqual({ winner: B, reason: 'timeout' });
      // Same position with black to move: white has a bare king, so it's a draw.
      const blackToMove = { ...lone, pgn: lone.pgn.replace(' w - -', ' b - -') };
      expect(chessGame.timeout!(blackToMove, { now: 1_000 }).result).toEqual({ winner: null, reason: 'timeout' });
    });

    it('freezes the clock when the game ends another way', () => {
      const r = chessGame.applyMove(opened(), A, { type: 'resign' }, { now: 70_000 });
      expect(r.ok && r.state.clock).toMatchObject({ remaining: { w: 40_000, b: 60_000 }, turnStartedAt: null });
      expect(r.ok && chessGame.deadline!(r.state)).toBeNull();
    });
  });

  describe('first-move abort', () => {
    const timedSetup = () => chessGame.setup([A, B], { timeControl: '5+0', hostColor: 'white', handicap: 'none', turnTimer: 'none', houseRules: [], caroSize: '15', caroBlock: true, caNguaRules: [], stakes: 'points', walletStart: 200_000, stakePerPoint: 5_000, dealer: null, callSpeed: 'normal', caroLoserFirst: true }, { now: 0 }, null);

    it('aborts a timed game when white never moves', () => {
      const s = timedSetup();
      expect(chessGame.deadline!(s)).toBe(30_000);
      expect(chessGame.playerView(s, A, { now: 10_000 }).firstMoveMs).toBe(20_000);
      expect(chessGame.timeout!(s, { now: 30_000 }).result).toEqual({ winner: null, reason: 'aborted' });
    });

    it('gives black its own 30 seconds, then hands over to the clock', () => {
      const r = chessGame.applyMove(timedSetup(), A, { type: 'move', from: 'e2', to: 'e4' }, { now: 20_000 });
      if (!r.ok) throw new Error();
      expect(chessGame.deadline!(r.state)).toBe(50_000);
      const r2 = chessGame.applyMove(r.state, B, { type: 'move', from: 'e7', to: 'e5' }, { now: 40_000 });
      if (!r2.ok) throw new Error();
      expect(r2.state.firstMoveDeadline).toBeNull();
      expect(chessGame.deadline!(r2.state)).toBe(40_000 + 5 * 60_000);
    });

    it('never aborts untimed games', () => {
      const s = chessGame.setup([A, B], { timeControl: 'none', hostColor: 'white', handicap: 'none', turnTimer: 'none', houseRules: [], caroSize: '15', caroBlock: true, caNguaRules: [], stakes: 'points', walletStart: 200_000, stakePerPoint: 5_000, dealer: null, callSpeed: 'normal', caroLoserFirst: true }, { now: 0 }, null);
      expect(chessGame.deadline!(s)).toBeNull();
    });
  });

  describe('takebacks', () => {
    const act = (state: ChessState, player: string, type: 'request-takeback' | 'accept-takeback' | 'decline-takeback') =>
      chessGame.applyMove(state, player, { type }, ctx);
    const ok = (r: ReturnType<typeof act>) => {
      if (!r.ok) throw new Error(r.error);
      return r.state;
    };

    it('undoes just the requester’s move when the opponent has not replied', () => {
      const s = play(fresh(), [[A, 'e2', 'e4']]);
      expect(act(s, B, 'request-takeback').ok).toBe(false);
      const asked = ok(act(s, A, 'request-takeback'));
      expect(chessGame.playerView(asked, B, ctx).takebackRequest).toBe(A);
      expect(chessGame.playerView(ok(act(asked, B, 'accept-takeback')), A, ctx).history).toEqual([]);
    });

    it('undoes the reply too when the opponent already moved', () => {
      const s = play(fresh(), [
        [A, 'e2', 'e4'],
        [B, 'e7', 'e5'],
      ]);
      const back = ok(act(ok(act(s, A, 'request-takeback')), B, 'accept-takeback'));
      expect(chessGame.playerView(back, A, ctx).history).toEqual([]);
      expect(chessGame.playerView(back, A, ctx).turn).toBe('w');
    });

    it('allows one request per ply; declines and moves clear it', () => {
      const s = play(fresh(), [[A, 'e2', 'e4']]);
      const declined = ok(act(ok(act(s, A, 'request-takeback')), B, 'decline-takeback'));
      expect(declined.takebackRequest).toBeNull();
      expect(act(declined, A, 'request-takeback').ok).toBe(false);
      const moved = play(ok(act(play(s, [[B, 'e7', 'e5']]), A, 'request-takeback')), [[A, 'g1', 'f3']]);
      expect(moved.takebackRequest).toBeNull();
    });

    it('cannot accept your own request', () => {
      const asked = ok(act(play(fresh(), [[A, 'e2', 'e4']]), A, 'request-takeback'));
      expect(act(asked, A, 'accept-takeback').ok).toBe(false);
    });
  });

  describe('colours', () => {
    it('honours the host’s chosen side', () => {
      const white = chessGame.setup([A, B], { timeControl: 'none', hostColor: 'white', handicap: 'none', turnTimer: 'none', houseRules: [], caroSize: '15', caroBlock: true, caNguaRules: [], stakes: 'points', walletStart: 200_000, stakePerPoint: 5_000, dealer: null, callSpeed: 'normal', caroLoserFirst: true }, ctx, null);
      expect([white.white, white.black]).toEqual([A, B]);
      const black = chessGame.setup([A, B], { timeControl: 'none', hostColor: 'black', handicap: 'none', turnTimer: 'none', houseRules: [], caroSize: '15', caroBlock: true, caNguaRules: [], stakes: 'points', walletStart: 200_000, stakePerPoint: 5_000, dealer: null, callSpeed: 'normal', caroLoserFirst: true }, ctx, null);
      expect([black.white, black.black]).toEqual([B, A]);
    });

    it('swaps sides for a rematch between the same players', () => {
      const first = chessGame.setup([A, B], { timeControl: 'none', hostColor: 'white', handicap: 'none', turnTimer: 'none', houseRules: [], caroSize: '15', caroBlock: true, caNguaRules: [], stakes: 'points', walletStart: 200_000, stakePerPoint: 5_000, dealer: null, callSpeed: 'normal', caroLoserFirst: true }, ctx, null);
      const rematch = chessGame.setup([A, B], { timeControl: 'none', hostColor: 'white', handicap: 'none', turnTimer: 'none', houseRules: [], caroSize: '15', caroBlock: true, caNguaRules: [], stakes: 'points', walletStart: 200_000, stakePerPoint: 5_000, dealer: null, callSpeed: 'normal', caroLoserFirst: true }, ctx, first);
      expect([rematch.white, rematch.black]).toEqual([B, A]);
      const newOpponent = chessGame.setup([A, 'player-c'], { timeControl: 'none', hostColor: 'white', handicap: 'none', turnTimer: 'none', houseRules: [], caroSize: '15', caroBlock: true, caNguaRules: [], stakes: 'points', walletStart: 200_000, stakePerPoint: 5_000, dealer: null, callSpeed: 'normal', caroLoserFirst: true }, ctx, first);
      expect(newOpponent.white).toBe(A);
    });
  });

  describe('canMate (flag rule)', () => {
    const at = (fen: string) => new Chess(fen);
    it.each([
      ['bare king', '4k3/8/8/8/8/8/8/4K3 w - - 0 1', 'w', false],
      ['pawn', '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1', 'w', true],
      ['lone knight vs bare king', '4k3/8/8/8/8/8/8/4KN2 w - - 0 1', 'w', false],
      ['lone knight vs king and pawn', '4k3/4p3/8/8/8/8/8/4KN2 w - - 0 1', 'w', true],
      ['lone knight vs king and queen', '4k3/4q3/8/8/8/8/8/4KN2 w - - 0 1', 'w', false],
      ['lone bishop vs bare king', '4k3/8/8/8/8/8/8/4KB2 w - - 0 1', 'w', false],
      ['lone bishop vs king and pawn', '4k3/4p3/8/8/8/8/8/4KB2 w - - 0 1', 'w', true],
      ['bishop pair', '4k3/8/8/8/8/8/8/2B1KB2 w - - 0 1', 'w', true],
      ['knight and bishop', '4k3/8/8/8/8/8/8/3NKB2 w - - 0 1', 'w', true],
    ] as const)('%s', (_name, fen, color, expected) => {
      expect(canMate(at(fen), color)).toBe(expected);
    });
  });
});
