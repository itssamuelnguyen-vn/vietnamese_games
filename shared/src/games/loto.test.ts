import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_OPTIONS, type RoomOptions } from '../types';
import { LOTO_BUY_MS, LOTO_CALL_MS, LOTO_COLS, LOTO_KINH_MS, LOTO_PER_ROW, LOTO_ROWS, LOTO_SET, fullRow, lotoGame, rowNumbers, type LotoMove, type LotoState, type LotoTicket } from './loto';
import { LOTO_TICKETS } from './loto-tickets';

const options: RoomOptions = { ...DEFAULT_ROOM_OPTIONS };
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const numbersOf = (t: LotoTicket) => t.flat().filter((n): n is number => n !== null);
const game = (ids = ['a', 'b'], wallets?: Record<string, number>) => lotoGame.setup(ids, options, { now: 0, random: seeded(3) }, null, wallets);
function act(s: LotoState, id: string, move: LotoMove, now = 0) {
  const r = lotoGame.applyMove(s, id, move, { now, random: seeded(7) });
  if (!r.ok) throw new Error(`${id} ${JSON.stringify(move)}: ${r.error}`);
  return r.state;
}
// Each player picks their tickets and gets ready: calling starts.
const started = (picks: Record<string, number[]>) => Object.entries(picks).reduce((s, [id, tickets]) => act(act(s, id, { type: 'pick', tickets }), id, { type: 'ready' }), game(Object.keys(picks)));
// Calls exactly these numbers next.
const calling = (s: LotoState, numbers: number[]): LotoState => ({ ...s, called: [...s.called, ...numbers], deck: s.deck.filter((n) => !numbers.includes(n)) });

describe('lô tô', () => {
  it("the real set: 16 tickets of nine rows of five, each column its own tens, a colour's pair sharing out the 90", () => {
    expect(LOTO_TICKETS).toHaveLength(LOTO_SET);
    for (const t of LOTO_TICKETS) {
      expect(t).toHaveLength(LOTO_ROWS);
      for (const row of t) {
        expect(row).toHaveLength(LOTO_COLS);
        expect(row.filter((n) => n !== null)).toHaveLength(LOTO_PER_ROW);
        row.forEach((n, c) => n !== null && expect(c === 0 ? n >= 1 && n <= 9 : c === 8 ? n >= 80 && n <= 90 : Math.floor(n / 10) === c).toBe(true));
      }
    }
    for (let k = 0; k < 8; k++) {
      const all = [...numbersOf(LOTO_TICKETS[2 * k]), ...numbersOf(LOTO_TICKETS[2 * k + 1])].sort((x, y) => x - y);
      expect(all).toEqual(Array.from({ length: 90 }, (_, i) => i + 1));
    }
    // Spot checks against the printed tickets: pink 1's first row, purple 2's last.
    expect(LOTO_TICKETS[0][0]).toEqual([null, 19, 28, null, 46, null, 68, 75, null]);
    expect(LOTO_TICKETS[15][8]).toEqual([null, 10, 27, null, 48, 59, null, null, 86]);
  });

  it('the table set has 16 tickets in 8 colours', () => {
    const s = game();
    expect(s.set).toHaveLength(LOTO_SET);
    for (let k = 0; k < 8; k++) expect(new Set([...numbersOf(s.set[2 * k]), ...numbersOf(s.set[2 * k + 1])]).size).toBe(90);
  });

  it('picks one free ticket or both of a colour, never two of different colours or one taken', () => {
    let s = game(['a', 'b']);
    expect(() => act(s, 'a', { type: 'pick', tickets: [0, 2] })).toThrow('INVALID_MOVE');
    expect(() => act(s, 'a', { type: 'pick', tickets: [4, 5, 6] })).toThrow('INVALID_MOVE');
    s = act(s, 'a', { type: 'pick', tickets: [5, 4] });
    expect(s.picks.a).toEqual([4, 5]);
    expect(() => act(s, 'b', { type: 'pick', tickets: [5] })).toThrow('INVALID_MOVE');
    // Changing your mind frees the tickets.
    s = act(s, 'a', { type: 'pick', tickets: [7] });
    s = act(s, 'b', { type: 'pick', tickets: [4, 5] });
    expect(lotoGame.playerView(s, 'a', { now: 0 }).holders).toEqual({ 4: 'b', 5: 'b', 7: 'a' });
  });

  it('deals once everyone is ready, then calls a number at a time', () => {
    let s = act(act(game(), 'a', { type: 'pick', tickets: [0, 1] }), 'a', { type: 'ready' });
    expect(s.phase).toBe('buy');
    expect(() => act(s, 'b', { type: 'ready' })).toThrow('INVALID_MOVE');
    s = act(act(s, 'b', { type: 'pick', tickets: [6] }), 'b', { type: 'ready' }, 500);
    expect(s).toMatchObject({ phase: 'call', deadline: 500 + LOTO_CALL_MS.normal });
    s = lotoGame.timeout!(s, { now: s.deadline });
    expect(s.called).toHaveLength(1);
    expect(s.log.at(-1)).toEqual({ kind: 'call', number: s.called[0], count: 1 });
  });

  it('picking time up: those with tickets play; nobody picking ends the game', () => {
    const s = act(game(), 'a', { type: 'pick', tickets: [3] });
    expect(lotoGame.timeout!(s, { now: LOTO_BUY_MS }).picks).toEqual({ a: [3] });
    expect(lotoGame.timeout!(game(), { now: LOTO_BUY_MS }).result).toMatchObject({ winners: [] });
  });

  it("once all 16 are taken, nobody waits for those who couldn't get one", () => {
    const ids = Array.from({ length: 9 }, (_, i) => `p${i}`);
    let s = game(ids);
    for (let k = 0; k < 8; k++) s = act(act(s, ids[k], { type: 'pick', tickets: [2 * k, 2 * k + 1] }), ids[k], { type: 'ready' });
    expect(s.phase).toBe('call');
    expect(s.picks.p8).toBeUndefined();
  });

  it('a full row wins the pot; a wrong kinh puts the player out', () => {
    let s = started({ a: [0], b: [9] });
    s = act(s, 'b', { type: 'kinh' });
    expect(s.busted).toEqual(['b']);
    expect(() => act(s, 'b', { type: 'kinh' })).toThrow('INVALID_MOVE');
    s = calling(s, rowNumbers(s.set[0], 3));
    expect(fullRow([s.set[0]], s.called)).toEqual({ index: 0, row: 3 });
    s = act(s, 'a', { type: 'kinh' }, 1000);
    expect(s).toMatchObject({ phase: 'kinh', deadline: 1000 + LOTO_KINH_MS, winners: [{ player: 'a', ticket: 0, row: 3 }] });
    s = lotoGame.timeout!(s, { now: s.deadline });
    expect(s.result).toMatchObject({ nets: { a: 1, b: -1 }, ranking: ['a', 'b'] });
    expect(lotoGame.points!(s)).toEqual({ a: { place: 1, points: 1 }, b: { place: 2, points: -1 } });
  });

  it('several kinh on the same number share the pot', () => {
    let s = started({ a: [0], b: [2], c: [4, 5] });
    s = calling(s, [...rowNumbers(s.set[0], 0), ...rowNumbers(s.set[2], 0)]);
    s = act(act(s, 'a', { type: 'kinh' }), 'b', { type: 'kinh' });
    s = lotoGame.timeout!(s, { now: s.deadline });
    // Pot of 4 tickets: 2 each.
    expect(s.result!.nets).toEqual({ a: 1, b: 1, c: -2 });
  });

  it('plays for the room wallets at the stake per ticket', () => {
    let s = game(['a', 'b'], { a: 20_000, b: 5_000 });
    expect(s.price).toBe(DEFAULT_ROOM_OPTIONS.stakePerPoint);
    // b can only afford one ticket.
    expect(() => act(s, 'b', { type: 'pick', tickets: [2, 3] })).toThrow('INVALID_MOVE');
    s = act(act(s, 'a', { type: 'pick', tickets: [0, 1] }), 'a', { type: 'ready' });
    s = act(act(s, 'b', { type: 'pick', tickets: [2] }), 'b', { type: 'ready' });
    s = calling(s, rowNumbers(s.set[2], 0));
    s = lotoGame.timeout!(act(s, 'b', { type: 'kinh' }), { now: Infinity });
    expect(lotoGame.walletsAfter!(s)).toEqual({ a: 10_000, b: 15_000 });
  });

  it('leaving while picking frees the tickets; once dealt they stay in the pot', () => {
    let s = act(game(), 'b', { type: 'pick', tickets: [6, 7] });
    s = lotoGame.forfeit({ ...s, seats: ['a', 'b', 'c'] }, 'b', { now: 0 }, 'left');
    expect(s.picks.b).toBeUndefined();
    let t = started({ a: [0], b: [1] });
    t = lotoGame.forfeit(t, 'b', { now: 0 }, 'left');
    t = calling(t, rowNumbers(t.set[0], 0));
    t = lotoGame.timeout!(act(t, 'a', { type: 'kinh' }), { now: Infinity });
    expect(t.result!.nets).toEqual({ a: 1, b: -1 });
  });

  it('bots pick free tickets, shout when they have a row, and games of bots run to the end', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const random = seeded(seed);
      const ids = Array.from({ length: 10 }, (_, i) => `bot:${i}`);
      let s = lotoGame.setup(ids, options, { now: 0, random }, null);
      let now = 0;
      for (let steps = 0; !s.result; steps++) {
        expect(steps).toBeLessThan(600);
        const mover = s.seats.find((id) => lotoGame.botMove!(s, id, { now, random }));
        const move = mover && lotoGame.botMove!(s, mover, { now, random });
        if (mover && move) {
          const r = lotoGame.applyMove(s, mover, move, { now, random });
          if (!r.ok) throw new Error(`${mover} ${JSON.stringify(move)} ${r.error}`);
          s = r.state;
        } else {
          now = s.deadline;
          s = lotoGame.timeout!(s, { now, random });
        }
      }
      // No ticket held twice, nobody holds two tickets of different colours.
      const all = Object.values(s.picks).flat();
      expect(new Set(all).size).toBe(all.length);
      for (const ts of Object.values(s.picks)) if (ts.length === 2) expect(ts[1]).toBe(ts[0] + 1);
      expect(s.result.winners.length).toBeGreaterThan(0);
      expect(s.busted).toEqual([]);
      expect(Object.values(s.result.nets).reduce((a, b) => a + b, 0)).toBe(0);
    }
  });
});
