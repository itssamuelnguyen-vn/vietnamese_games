import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_OPTIONS, type RoomOptions } from '../types';
import { LOTO_BUY_MS, LOTO_CALL_MS, LOTO_COLS, LOTO_KINH_MS, LOTO_PER_ROW, LOTO_ROWS, fullRow, lotoGame, lotoTicket, rowNumbers, type LotoMove, type LotoState } from './loto';

const options: RoomOptions = { ...DEFAULT_ROOM_OPTIONS };
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const game = (ids = ['a', 'b'], wallets?: Record<string, number>) => lotoGame.setup(ids, options, { now: 0 }, null, wallets);
function act(s: LotoState, id: string, move: LotoMove, now = 0) {
  const r = lotoGame.applyMove(s, id, move, { now, random: seeded(7) });
  if (!r.ok) throw new Error(`${id} ${JSON.stringify(move)}: ${r.error}`);
  return r.state;
}
// Both buy and get ready: tickets are dealt and calling starts.
const started = (ids = ['a', 'b'], counts = [1, 1]) => ids.reduce((s, id, i) => act(act(s, id, { type: 'buy', count: counts[i] }), id, { type: 'ready' }), game(ids));
// Calls exactly these numbers next.
const calling = (s: LotoState, numbers: number[]): LotoState => ({ ...s, called: [...s.called, ...numbers], deck: s.deck.filter((n) => !numbers.includes(n)) });

describe('lô tô', () => {
  it('deals tickets of nine rows of five, each column from its own tens, smallest at the top', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const t = lotoTicket(seeded(seed));
      expect(t).toHaveLength(LOTO_ROWS);
      for (const row of t) {
        expect(row).toHaveLength(LOTO_COLS);
        expect(row.filter((n) => n !== null)).toHaveLength(LOTO_PER_ROW);
      }
      const all = t.flat().filter((n): n is number => n !== null);
      expect(new Set(all).size).toBe(all.length);
      for (let c = 0; c < LOTO_COLS; c++) {
        const col = t.map((row) => row[c]).filter((n): n is number => n !== null);
        expect(col).toEqual([...col].sort((x, y) => x - y));
        for (const n of col) expect(c === 0 ? n >= 1 && n <= 9 : c === 8 ? n >= 80 && n <= 90 : Math.floor(n / 10) === c).toBe(true);
      }
    }
  });

  it('buys one to three tickets, deals once everyone is ready, then calls a number at a time', () => {
    let s = game();
    expect(() => act(s, 'a', { type: 'buy', count: 4 })).toThrow('INVALID_MOVE');
    expect(() => act(s, 'a', { type: 'ready' })).toThrow('INVALID_MOVE');
    s = act(act(s, 'a', { type: 'buy', count: 2 }), 'a', { type: 'ready' });
    expect(s.phase).toBe('buy');
    s = act(act(s, 'b', { type: 'buy', count: 1 }), 'b', { type: 'ready' }, 500);
    expect(s).toMatchObject({ phase: 'call', deadline: 500 + LOTO_CALL_MS.normal });
    expect(s.tickets.a).toHaveLength(2);
    expect(s.deck).toHaveLength(90);
    s = lotoGame.timeout!(s, { now: s.deadline });
    expect(s.called).toHaveLength(1);
    expect(s.log.at(-1)).toEqual({ kind: 'call', number: s.called[0], count: 1 });
    // Others' tickets stay private.
    const view = lotoGame.playerView(s, 'b', { now: s.deadline });
    expect(view.tickets).toHaveLength(1);
    expect(view.seats.find((p) => p.id === 'a')!.tickets).toBe(2);
  });

  it('buying time up: those who bought play; nobody buying ends the game', () => {
    const s = act(game(), 'a', { type: 'buy', count: 1 });
    const dealt = lotoGame.timeout!(s, { now: LOTO_BUY_MS });
    expect(Object.keys(dealt.tickets)).toEqual(['a']);
    expect(lotoGame.timeout!(game(), { now: LOTO_BUY_MS }).result).toMatchObject({ winners: [] });
  });

  it('a full row wins the pot; a wrong kinh puts the player out', () => {
    let s = started();
    s = act(s, 'b', { type: 'kinh' });
    expect(s.busted).toEqual(['b']);
    expect(() => act(s, 'b', { type: 'kinh' })).toThrow('INVALID_MOVE');
    s = calling(s, rowNumbers(s.tickets.a[0], 3));
    expect(fullRow(s.tickets.a, s.called)).toEqual({ ticket: 0, row: 3 });
    s = act(s, 'a', { type: 'kinh' }, 1000);
    expect(s).toMatchObject({ phase: 'kinh', deadline: 1000 + LOTO_KINH_MS });
    s = lotoGame.timeout!(s, { now: s.deadline });
    expect(s.result).toMatchObject({ nets: { a: 1, b: -1 }, ranking: ['a', 'b'] });
    expect(lotoGame.points!(s)).toEqual({ a: { place: 1, points: 1 }, b: { place: 2, points: -1 } });
  });

  it('several kinh on the same number share the pot', () => {
    let s = started(['a', 'b', 'c'], [1, 1, 2]);
    s = calling(s, [...rowNumbers(s.tickets.a[0], 0), ...rowNumbers(s.tickets.b[0], 0)]);
    s = act(act(s, 'a', { type: 'kinh' }), 'b', { type: 'kinh' });
    s = lotoGame.timeout!(s, { now: s.deadline });
    // Pot of 4 tickets: 2 each.
    expect(s.result!.nets).toEqual({ a: 1, b: 1, c: -2 });
  });

  it('plays for the room wallets at the stake per ticket', () => {
    const wallets = { a: 20_000, b: 5_000 };
    let s = game(['a', 'b'], wallets);
    expect(s.price).toBe(DEFAULT_ROOM_OPTIONS.stakePerPoint);
    // b can only afford one ticket.
    expect(() => act(s, 'b', { type: 'buy', count: 2 })).toThrow('INVALID_MOVE');
    s = act(act(s, 'a', { type: 'buy', count: 2 }), 'a', { type: 'ready' });
    s = act(act(s, 'b', { type: 'buy', count: 1 }), 'b', { type: 'ready' });
    s = calling(s, rowNumbers(s.tickets.b[0], 0));
    s = lotoGame.timeout!(act(s, 'b', { type: 'kinh' }), { now: Infinity });
    expect(lotoGame.walletsAfter!(s)).toEqual({ a: 10_000, b: 15_000 });
  });

  it('someone leaving keeps their tickets in the pot; the last one standing ends it', () => {
    let s = started();
    s = lotoGame.forfeit(s, 'b', { now: 0 }, 'left');
    expect(s.result).toBeNull();
    s = calling(s, rowNumbers(s.tickets.a[0], 0));
    s = lotoGame.timeout!(act(s, 'a', { type: 'kinh' }), { now: Infinity });
    expect(s.result!.nets).toEqual({ a: 1, b: -1 });
  });

  it('bots buy, shout when they have a row, and games of bots run to the end', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const random = seeded(seed);
      let s = lotoGame.setup(['bot:1', 'bot:2', 'bot:3'], options, { now: 0, random }, null);
      let now = 0;
      for (let steps = 0; !s.result; steps++) {
        expect(steps).toBeLessThan(500);
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
      expect(s.result.winners.length).toBeGreaterThan(0);
      // Bots never shout wrong, and the pot adds up.
      expect(s.busted).toEqual([]);
      expect(Object.values(s.result.nets).reduce((a, b) => a + b, 0)).toBe(0);
    }
  });
});
