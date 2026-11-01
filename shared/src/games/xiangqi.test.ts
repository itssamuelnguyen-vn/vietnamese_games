import { describe, expect, it } from 'vitest';
import { NO_CAPTURE_PLIES, detectResult, handicapFen, xiangqiGame, type XiangqiMove, type XiangqiState } from './xiangqi';
import { Xiangqi } from './xiangqi-engine';

const R = 'red-player';
const B = 'black-player';
const ctx = { now: 0 };

const fresh = (startFen?: string): XiangqiState => ({
  red: R,
  black: B,
  moves: [],
  startFen,
  result: null,
  drawOffer: null,
  drawOfferedAt: {},
  takebackRequest: null,
  takebackRequestedAt: {},
  clock: null,
  firstMoveDeadline: null,
});

function play(state: XiangqiState, moves: string[]): XiangqiState {
  for (const m of moves) {
    const player = state.moves.length % 2 === 0 ? R : B;
    const r = xiangqiGame.applyMove(state, player, { type: 'move', from: m.slice(0, 2), to: m.slice(2) }, ctx);
    if (!r.ok) throw new Error(`${m} rejected: ${r.error}`);
    state = r.state;
  }
  return state;
}

describe('xiangqiGame', () => {
  it('starts with red to move and validates moves', () => {
    const s = fresh();
    expect(xiangqiGame.playerView(s, R, ctx).turn).toBe('r');
    expect(xiangqiGame.applyMove(s, B, { type: 'move', from: 'h9g7', to: '' } as XiangqiMove, ctx)).toEqual({
      ok: false,
      error: 'NOT_YOUR_TURN',
    });
    // The a0 chariot is blocked by its own soldier on a3.
    expect(xiangqiGame.applyMove(s, R, { type: 'move', from: 'a0', to: 'a5' }, ctx)).toEqual({ ok: false, error: 'INVALID_MOVE' });
    const next = play(s, ['h2e2', 'h9g7']);
    const view = xiangqiGame.playerView(next, R, ctx);
    expect(view.moves).toEqual(['h2e2', 'h9g7']);
    expect(view.lastMove).toEqual({ from: 'h9', to: 'g7' });
  });

  it('a side left without legal moves loses (checkmate)', () => {
    // Red chariot to b9 mates: rank 9 and rank 8 are both covered.
    const s = play(fresh('4k4/R8/9/9/9/9/9/9/9/1R3K3 w'), ['b0b9']);
    expect(s.result).toEqual({ winner: R, reason: 'checkmate' });
  });

  it('perpetual check loses for the checking side', () => {
    const s = play(fresh('4k4/9/9/9/R8/9/9/9/9/5K3 w'), [
      'a5e5', 'e9d9', 'e5d5', 'd9e9', 'd5e5', 'e9d9', 'e5d5', 'd9e9', 'd5e5',
    ]);
    expect(s.result).toEqual({ winner: B, reason: 'perpetual-check' });
  });

  it('plain repetition without perpetual check is a draw', () => {
    const s = play(fresh('4k4/9/9/9/R8/9/9/9/9/5K3 w'), ['a5a6', 'e9d9', 'a6a5', 'd9e9', 'a5a6', 'e9d9', 'a6a5', 'd9e9']);
    expect(s.result).toEqual({ winner: null, reason: 'repetition' });
  });

  describe('perpetual chase', () => {
    // Plays a four-move cycle three times round, ending on the third occurrence of the start position.
    const cycle = (fen: string, moves: string[]) => play(fresh(fen), [...moves, ...moves]);

    it('loses for a chariot that keeps chasing an undefended horse', () => {
      // The red chariot follows the black horse between g7 and h9; nothing defends the horse.
      const s = cycle('4k2n1/9/9/9/9/9/9/6R2/9/3K5 w', ['g2h2', 'h9g7', 'h2g2', 'g7h9']);
      expect(s.result).toEqual({ winner: B, reason: 'perpetual-chase' });
    });

    it('is a draw when the chased piece is defended and worth as much as the attacker', () => {
      // A red horse chases a black cannon up and down the i-file, where the black chariot guards it.
      const defended = '4k3r/9/9/6N1c/9/9/9/9/9/3K5 w';
      const s = cycle(defended, ['g6h4', 'i6i7', 'h4g6', 'i7i6']);
      expect(s.result).toEqual({ winner: null, reason: 'repetition' });
      // Without the chariot the same chase loses.
      const lone = cycle(defended.replace('4k3r', '4k4'), ['g6h4', 'i6i7', 'h4g6', 'i7i6']);
      expect(lone.result).toEqual({ winner: B, reason: 'perpetual-chase' });
    });

    it('is a draw when both sides chase', () => {
      // Each chariot swings between two files, attacking a fresh undefended horse every move.
      const s = cycle('4k4/6nn1/2r6/9/9/9/9/6R2/1NN6/3K5 w', ['g2h2', 'c7b7', 'h2g2', 'b7c7']);
      expect(s.result).toEqual({ winner: null, reason: 'repetition' });
    });

    it('does not count a piece that stays attacked without being chased', () => {
      // The red chariot pins down an undefended horse but only shuffles its general: no new threat.
      const s = cycle('4k4/9/6n2/9/9/9/9/6R2/9/3K5 w', ['d0d1', 'e9f9', 'd1d0', 'f9e9']);
      expect(s.result).toEqual({ winner: null, reason: 'repetition' });
    });
  });

  it('is a draw after 60 moves each without a capture', () => {
    // Build a quiet game: every move avoids captures, checks and earlier positions,
    // so neither repetition nor any other rule can end it first.
    const game = new Xiangqi();
    const seen = new Set([game.positionKey()]);
    const moves: string[] = [];
    while (moves.length < NO_CAPTURE_PLIES) {
      const next = game.moves().find((m) => {
        if (m.captured || m.check) return false;
        game.move(m);
        const fresh = !seen.has(game.positionKey());
        game.undo();
        return fresh;
      });
      if (!next) throw new Error(`stuck after ${moves.length} plies`);
      game.move(next);
      seen.add(game.positionKey());
      moves.push(next.from + next.to);
    }
    expect(detectResult({ ...fresh(), moves: moves.slice(0, -1) })).toBeNull();
    expect(detectResult({ ...fresh(), moves })).toEqual({ winner: null, reason: 'no-capture' });
  });

  it('is a draw when neither side can attack any more', () => {
    const s = play(fresh('3k5/9/9/9/9/9/9/9/9/4KA3 w'), ['f0e1']);
    expect(s.result).toEqual({ winner: null, reason: 'insufficient' });
  });

  it('draws, takebacks and resigning work like chess', () => {
    const s = play(fresh(), ['h2e2']);
    const offered = xiangqiGame.applyMove(s, R, { type: 'offer-draw' }, ctx);
    if (!offered.ok) throw new Error();
    const drawn = xiangqiGame.applyMove(offered.state, B, { type: 'accept-draw' }, ctx);
    expect(drawn.ok && drawn.state.result).toEqual({ winner: null, reason: 'agreement' });

    const asked = xiangqiGame.applyMove(play(fresh(), ['h2e2', 'h9g7']), R, { type: 'request-takeback' }, ctx);
    if (!asked.ok) throw new Error();
    const back = xiangqiGame.applyMove(asked.state, B, { type: 'accept-takeback' }, ctx);
    expect(back.ok && back.state.moves).toEqual([]);

    const resigned = xiangqiGame.applyMove(fresh(), B, { type: 'resign' }, ctx);
    expect(resigned.ok && resigned.state.result).toEqual({ winner: R, reason: 'resign' });
  });

  it('honours the host side and swaps on rematch', () => {
    const first = xiangqiGame.setup([R, B], { timeControl: 'none', hostColor: 'white', handicap: 'none', turnTimer: 'none', houseRules: [], caroSize: '15', caroBlock: true, caNguaRules: [], stakes: 'points', walletStart: 200_000, stakePerPoint: 5_000, dealer: null }, ctx, null);
    expect([first.red, first.black]).toEqual([R, B]);
    const rematch = xiangqiGame.setup([R, B], { timeControl: 'none', hostColor: 'white', handicap: 'none', turnTimer: 'none', houseRules: [], caroSize: '15', caroBlock: true, caNguaRules: [], stakes: 'points', walletStart: 200_000, stakePerPoint: 5_000, dealer: null }, ctx, first);
    expect([rematch.red, rematch.black]).toEqual([B, R]);
  });

  it('runs clocks and flags like chess, drawing if the opponent cannot attack', () => {
    const timed = xiangqiGame.setup([R, B], { timeControl: '5+0', hostColor: 'white', handicap: 'none', turnTimer: 'none', houseRules: [], caroSize: '15', caroBlock: true, caNguaRules: [], stakes: 'points', walletStart: 200_000, stakePerPoint: 5_000, dealer: null }, { now: 0 }, null);
    expect(xiangqiGame.deadline!(timed)).toBe(30_000);
    expect(xiangqiGame.timeout!(timed, { now: 30_000 }).result).toEqual({ winner: null, reason: 'aborted' });

    const opened = [
      { from: 'h2', to: 'e2', player: R, now: 1_000 },
      { from: 'h9', to: 'g7', player: B, now: 2_000 },
    ].reduce((st, m) => {
      const r = xiangqiGame.applyMove(st, m.player, { type: 'move', from: m.from, to: m.to }, { now: m.now });
      if (!r.ok) throw new Error(r.error);
      return r.state;
    }, timed);
    expect(xiangqiGame.deadline!(opened)).toBe(2_000 + 5 * 60_000);
    expect(xiangqiGame.timeout!(opened, { now: 2_000 + 5 * 60_000 }).result).toEqual({ winner: B, reason: 'timeout' });

    // Black has only its general left: red flagging is a draw.
    const lone = { ...fresh('3k5/9/9/9/9/9/9/9/9/R3K4 w'), clock: { incrementMs: 0, remaining: { r: 1_000, b: 1_000 }, turnStartedAt: 0 } };
    expect(xiangqiGame.timeout!(lone, { now: 1_000 }).result).toEqual({ winner: null, reason: 'timeout' });
  });

  describe('handicap games', () => {
    it('removes pieces from the giving side’s left wing', () => {
      expect(new Xiangqi(handicapFen('r', 'chariot')).get('a0')).toBeNull();
      expect(new Xiangqi(handicapFen('r', 'chariot')).get('i0')?.type).toBe('r');
      expect(new Xiangqi(handicapFen('b', 'horse')).get('h9')).toBeNull();
      expect(new Xiangqi(handicapFen('r', 'cannon')).get('b2')).toBeNull();
      const twoHorses = new Xiangqi(handicapFen('b', 'two-horses'));
      expect([twoHorses.get('b9'), twoHorses.get('h9')]).toEqual([null, null]);
      expect(handicapFen('r', 'none')).toBe(new Xiangqi().fen());
    });

    it('the host gives the odds on whichever side they play', () => {
      const asRed = xiangqiGame.setup([R, B], { timeControl: 'none', hostColor: 'white', handicap: 'chariot', turnTimer: 'none', houseRules: [], caroSize: '15', caroBlock: true, caNguaRules: [], stakes: 'points', walletStart: 200_000, stakePerPoint: 5_000, dealer: null }, ctx, null);
      expect(xiangqiGame.playerView(asRed, R, ctx).startFen).toBe(handicapFen('r', 'chariot'));
      const asBlack = xiangqiGame.setup([R, B], { timeControl: 'none', hostColor: 'black', handicap: 'chariot', turnTimer: 'none', houseRules: [], caroSize: '15', caroBlock: true, caNguaRules: [], stakes: 'points', walletStart: 200_000, stakePerPoint: 5_000, dealer: null }, ctx, null);
      expect(asBlack.black).toBe(R);
      expect(new Xiangqi(xiangqiGame.playerView(asBlack, R, ctx).fen).get('i9')).toBeNull();
      // Play continues from the handicap position.
      const r = xiangqiGame.applyMove(asRed, R, { type: 'move', from: 'i0', to: 'i1' }, ctx);
      expect(r.ok).toBe(true);
    });
  });
});
