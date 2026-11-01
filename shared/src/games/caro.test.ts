import { describe, expect, it } from 'vitest';
import type { RoomOptions } from '../types';
import { caroBoard, caroBotCell, caroGame, cellName, winningLine, type CaroMove, type CaroState } from './caro';

const options: RoomOptions = { timeControl: 'none', hostColor: 'white', handicap: 'none', turnTimer: 'none', houseRules: [], caroSize: '15', caroBlock: true, caNguaRules: [], stakes: 'points', walletStart: 200_000, stakePerPoint: 5_000, dealer: null, callSpeed: 'normal' };
const ctx = { now: 0 };
const S = 15;
const at = (r: number, c: number) => r * S + c;

function fresh(extra: Partial<RoomOptions> = {}): CaroState {
  return caroGame.setup(['x', 'o'], { ...options, ...extra }, ctx, null);
}

function act(state: CaroState, player: string, move: CaroMove) {
  const r = caroGame.applyMove(state, player, move, ctx);
  if (!r.ok) throw new Error(`${player} ${JSON.stringify(move)}: ${r.error}`);
  return r.state;
}

// Plays alternate cells for X and O from the given lists.
function play(state: CaroState, xs: number[], os: number[]) {
  let s = state;
  for (let i = 0; i < xs.length; i++) {
    s = act(s, 'x', { type: 'place', cell: xs[i] });
    if (s.result || i >= os.length) break;
    s = act(s, 'o', { type: 'place', cell: os[i] });
  }
  return s;
}

describe('caro', () => {
  it('names cells by column letter and row from the bottom', () => {
    expect(cellName(0, 15)).toBe('a15');
    expect(cellName(at(14, 7), 15)).toBe('h1');
    expect(cellName(at(7, 7), 15)).toBe('h8');
  });

  it('sets up the board size and rule the host chose', () => {
    expect(fresh()).toMatchObject({ x: 'x', o: 'o', size: 15, blockRule: true, moves: [] });
    expect(fresh({ caroSize: '19', caroBlock: false })).toMatchObject({ size: 19, blockRule: false });
  });

  it('X starts, players alternate, and taken cells are refused', () => {
    const s = act(fresh(), 'x', { type: 'place', cell: at(7, 7) });
    expect(() => act(s, 'x', { type: 'place', cell: at(7, 8) })).toThrow('NOT_YOUR_TURN');
    expect(() => act(s, 'o', { type: 'place', cell: at(7, 7) })).toThrow('INVALID_MOVE');
    expect(() => act(s, 'o', { type: 'place', cell: S * S })).toThrow('INVALID_MOVE');
    expect(caroGame.playerView(act(s, 'o', { type: 'place', cell: at(8, 8) }), 'x', ctx).turn).toBe('x');
  });

  it('five in a row wins: across, down and diagonally', () => {
    const across = play(fresh(), [at(7, 3), at(7, 4), at(7, 5), at(7, 6), at(7, 7)], [at(0, 0), at(0, 2), at(0, 4), at(0, 6)]);
    expect(across.result).toEqual({ winner: 'x', reason: 'five', line: [at(7, 3), at(7, 4), at(7, 5), at(7, 6), at(7, 7)] });

    const down = play(fresh(), [at(0, 0), at(14, 14), at(0, 2), at(0, 4), at(14, 12)], [at(3, 9), at(4, 9), at(5, 9), at(6, 9), at(7, 9)]);
    expect(down.result).toMatchObject({ winner: 'o', reason: 'five' });

    const diagonal = play(fresh(), [at(2, 2), at(3, 3), at(4, 4), at(5, 5), at(6, 6)], [at(0, 9), at(0, 11), at(0, 13), at(14, 0)]);
    expect(diagonal.result).toMatchObject({ winner: 'x', line: [at(2, 2), at(3, 3), at(4, 4), at(5, 5), at(6, 6)] });
  });

  it('six or more in a row also wins', () => {
    const board = caroBoard([at(7, 1), 0, at(7, 2), 2, at(7, 3), 4, at(7, 5), 6, at(7, 6), 8, at(7, 4)], S);
    expect(winningLine(board, S, at(7, 4), true)).toHaveLength(6);
  });

  it('with the blocked-ends rule, a five stopped by O at both ends does not win', () => {
    const xs = [at(7, 3), at(7, 4), at(7, 5), at(7, 6), at(7, 7)];
    const blocked = play(fresh(), xs, [at(7, 2), at(7, 8), at(0, 0), at(0, 2)]);
    expect(blocked.result).toBeNull();
    // One open end is enough, and without the rule the blocked five wins too.
    expect(play(fresh(), xs, [at(7, 2), at(0, 14), at(0, 0), at(0, 2)]).result?.reason).toBe('five');
    expect(play(fresh({ caroBlock: false }), xs, [at(7, 2), at(7, 8), at(0, 0), at(0, 2)]).result?.reason).toBe('five');
  });

  it('the edge of the board does not count as a block', () => {
    const edge = play(fresh(), [at(7, 0), at(7, 1), at(7, 2), at(7, 3), at(7, 4)], [at(7, 5), at(0, 9), at(0, 11), at(0, 13)]);
    expect(edge.result?.winner).toBe('x');
  });

  it('a full board with no five is a draw', () => {
    // A tiny 3x3 board can't hold five in a row.
    let s: CaroState = { ...fresh(), size: 3 };
    for (let cell = 0; cell < 9; cell++) s = act(s, cell % 2 === 0 ? 'x' : 'o', { type: 'place', cell });
    expect(s.result).toEqual({ winner: null, reason: 'full', line: null });
  });

  it('supports takebacks, draws and resigning', () => {
    let s = play(fresh(), [at(7, 7), at(7, 8)], [at(8, 8)]);
    s = act(s, 'x', { type: 'request-takeback' });
    s = act(s, 'o', { type: 'accept-takeback' });
    expect(s.moves).toEqual([at(7, 7), at(8, 8)]);

    s = act(s, 'o', { type: 'offer-draw' });
    expect(act(s, 'x', { type: 'accept-draw' }).result).toMatchObject({ winner: null, reason: 'agreement' });
    expect(act(s, 'x', { type: 'resign' }).result).toMatchObject({ winner: 'o', reason: 'resign' });
  });

  it('the clock flags a player who runs out of time', () => {
    let s = caroGame.setup(['x', 'o'], { ...options, timeControl: '3+2' }, ctx, null);
    s = act(s, 'x', { type: 'place', cell: at(7, 7) });
    s = act(s, 'o', { type: 'place', cell: at(8, 8) });
    expect(caroGame.timeout!(s, { now: 3 * 60_000 }).result).toMatchObject({ winner: 'o', reason: 'timeout' });
  });

  it('rematches swap who plays X', () => {
    const first = fresh();
    const second = caroGame.setup(['x', 'o'], options, ctx, first);
    expect([second.x, second.o]).toEqual(['o', 'x']);
  });

  describe('bot', () => {
    it('sees fives that run into the board edge (the edge does not block)', () => {
      // X has four along row 5 ending at the edge column 13, stopped by O at column 9.
      const xs = [at(5, 10), at(5, 11), at(5, 12), at(5, 13)];
      const os = [at(5, 9), at(0, 0), at(0, 2), at(0, 4)];
      const moves = xs.flatMap((x, i) => [x, os[i]]);
      expect(caroBotCell(moves, S, true)).toBe(at(5, 14));
      // And as O it blocks there.
      expect(caroBotCell(moves.slice(0, -1), S, true)).toBe(at(5, 14));
    });

    it('opens in the centre', () => {
      expect(caroBotCell([], S, true)).toBe(at(7, 7));
    });

    it('takes a win when it has one', () => {
      // X (to move) has four in a row with an open end; O threatens too.
      const moves = [at(7, 3), at(9, 3), at(7, 4), at(9, 4), at(7, 5), at(9, 5), at(7, 6), at(9, 6)];
      expect([at(7, 2), at(7, 7)]).toContain(caroBotCell(moves, S, true));
    });

    it('blocks the opponent’s four', () => {
      const moves = [at(7, 3), at(0, 0), at(7, 4), at(0, 14), at(7, 5), at(14, 0), at(7, 6)];
      expect([at(7, 2), at(7, 7)]).toContain(caroBotCell(moves, S, true));
    });

    it('two bots play a game to the end, answering draws and takebacks', () => {
      let s = fresh();
      s = act(s, 'x', { type: 'place', cell: at(7, 7) });
      s = act(s, 'x', { type: 'offer-draw' });
      expect(caroGame.botMove!(s, 'o', ctx)).toEqual({ type: 'decline-draw' });
      for (let i = 0; i < 2 * S * S && !s.result; i++) {
        const [id, move] = (['x', 'o'] as const).map((p) => [p, caroGame.botMove!(s, p, ctx)] as const).find(([, m]) => m)!;
        s = act(s, id, move!);
      }
      expect(s.result).not.toBeNull();
    });
  });
});
