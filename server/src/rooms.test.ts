import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChessView } from '@vg/shared';
import { RoomManager } from './rooms';

const A = 'player-a';
const B = 'player-b';
const C = 'player-c';
const allOnline = () => true;

function roomWithTwo() {
  const rooms = new RoomManager();
  const created = rooms.create(A, 'An', 'chess');
  if (!created.ok) throw new Error(created.error);
  rooms.join(B, 'Bình', created.room.code);
  return { rooms, code: created.room.code };
}

describe('RoomManager', () => {
  it('creates a room with a readable 4-character code', () => {
    const rooms = new RoomManager();
    const r = rooms.create(A, '  An  ', 'chess');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.room.code).toMatch(/^[A-HJ-KM-NP-Z2-9]{4}$/);
    expect(r.room.players).toEqual([{ id: A, name: 'An' }]);
    expect(r.room.hostId).toBe(A);
  });

  it('refuses unavailable games and blank names', () => {
    const rooms = new RoomManager();
    expect(rooms.create(A, 'An', 'xiangqi')).toEqual({ ok: false, error: 'GAME_UNAVAILABLE' });
    expect(rooms.create(A, '   ', 'chess')).toEqual({ ok: false, error: 'NAME_REQUIRED' });
    expect(rooms.create(A, 42 as unknown as string, 'chess')).toEqual({ ok: false, error: 'NAME_REQUIRED' });
  });

  it('truncates long names', () => {
    const r = new RoomManager().create(A, 'x'.repeat(50), 'chess');
    expect(r.ok && r.room.players[0].name).toHaveLength(20);
  });

  it('joins by code case-insensitively and rejects unknown codes', () => {
    const rooms = new RoomManager();
    const created = rooms.create(A, 'An', 'chess');
    if (!created.ok) throw new Error();
    expect(rooms.join(B, 'Bình', 'ZZZZ')).toEqual({ ok: false, error: 'ROOM_NOT_FOUND' });
    expect(rooms.join(B, 'Bình', ` ${created.room.code.toLowerCase()} `).ok).toBe(true);
  });

  it('rejects joining a full room', () => {
    const { rooms, code } = roomWithTwo();
    expect(rooms.join(C, 'Chi', code)).toEqual({ ok: false, error: 'ROOM_FULL' });
  });

  it('lets an existing member rejoin even while playing', () => {
    const { rooms, code } = roomWithTwo();
    rooms.start(A);
    expect(rooms.join(B, 'Bình', code).ok).toBe(true);
    expect(rooms.join(C, 'Chi', code)).toEqual({ ok: false, error: 'ROOM_IN_GAME' });
  });

  it('only lets the host start, and only with enough players', () => {
    const rooms = new RoomManager();
    const created = rooms.create(A, 'An', 'chess');
    if (!created.ok) throw new Error();
    expect(rooms.start(A)).toEqual({ ok: false, error: 'NOT_ENOUGH_PLAYERS' });
    rooms.join(B, 'Bình', created.room.code);
    expect(rooms.start(B)).toEqual({ ok: false, error: 'NOT_HOST' });
    expect(rooms.start(A).ok).toBe(true);
    expect(rooms.start(A)).toEqual({ ok: false, error: 'GAME_IN_PROGRESS' });
  });

  it('applies moves and finishes the room when the game ends', () => {
    const { rooms } = roomWithTwo();
    const started = rooms.start(A);
    if (!started.ok) throw new Error();
    const view = rooms.view(started.room, A, allOnline).game as ChessView;
    const [white, black] = view.white === A ? [A, B] : [B, A];

    for (const [p, from, to] of [
      [white, 'f2', 'f3'],
      [black, 'e7', 'e5'],
      [white, 'g2', 'g4'],
      [black, 'd8', 'h4'],
    ]) {
      expect(rooms.move(p, { type: 'move', from, to }).ok).toBe(true);
    }
    expect(rooms.roomOf(A)?.status).toBe('finished');
    expect(rooms.move(white, { type: 'move', from: 'e2', to: 'e4' })).toEqual({ ok: false, error: 'GAME_NOT_STARTED' });
  });

  it('rejects malformed moves without throwing', () => {
    const { rooms } = roomWithTwo();
    rooms.start(A);
    for (const move of [null, undefined, {}, 'e2e4', { type: 'move', from: 123, to: [] }]) {
      expect(rooms.move(A, move).ok).toBe(false);
      expect(rooms.move(B, move).ok).toBe(false);
    }
  });

  it('leaving mid-game forfeits and passes host to the next player', () => {
    const { rooms } = roomWithTwo();
    rooms.start(A);
    const remaining = rooms.leave(A);
    expect(remaining?.status).toBe('finished');
    expect(remaining?.hostId).toBe(B);
    expect((rooms.view(remaining!, B, allOnline).game as ChessView).result).toEqual({ winner: B, reason: 'resign' });
    expect(rooms.roomOf(A)).toBeUndefined();
  });

  it('deletes a room when the last player leaves', () => {
    const rooms = new RoomManager();
    const created = rooms.create(A, 'An', 'chess');
    if (!created.ok) throw new Error();
    expect(rooms.leave(A)).toBeUndefined();
    expect(rooms.join(B, 'Bình', created.room.code)).toEqual({ ok: false, error: 'ROOM_NOT_FOUND' });
  });

  it('creating a new room leaves the previous one', () => {
    const { rooms, code } = roomWithTwo();
    const r = rooms.create(B, 'Bình', 'chess');
    expect(r.ok && r.left?.code).toBe(code);
    expect(rooms.roomOf(A)?.players.map((p) => p.id)).toEqual([A]);
  });

  it('sweeps rooms only once everyone has been gone long enough', () => {
    const { rooms } = roomWithTwo();
    rooms.sweep(() => false, 60_000);
    expect(rooms.roomOf(A)).toBeDefined();
    rooms.sweep((id) => id === A, 0);
    expect(rooms.roomOf(A)).toBeDefined();
    rooms.sweep(() => false, 0);
    expect(rooms.roomOf(A)).toBeUndefined();
    expect(rooms.roomOf(B)).toBeUndefined();
  });

  describe('options and clocks', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('lets only the host change options, and only between games', () => {
      const { rooms } = roomWithTwo();
      expect(rooms.roomOf(A)?.options).toEqual({ timeControl: '10+0' });
      expect(rooms.setOptions(B, { timeControl: '3+2' })).toEqual({ ok: false, error: 'NOT_HOST' });
      expect(rooms.setOptions(A, { timeControl: '1+0' })).toEqual({ ok: false, error: 'INVALID_OPTIONS' });
      expect(rooms.setOptions(A, { timeControl: 'toString' })).toEqual({ ok: false, error: 'INVALID_OPTIONS' });
      expect(rooms.setOptions(A, null)).toEqual({ ok: false, error: 'INVALID_OPTIONS' });
      expect(rooms.setOptions(A, { timeControl: '3+2' }).ok).toBe(true);
      rooms.start(A);
      expect(rooms.setOptions(A, { timeControl: 'none' })).toEqual({ ok: false, error: 'GAME_IN_PROGRESS' });
    });

    it('ends the game on time even if nobody moves', () => {
      vi.useFakeTimers();
      const updates: string[] = [];
      const rooms = new RoomManager({ onAutoUpdate: (room) => updates.push(room.status) });
      const created = rooms.create(A, 'An', 'chess');
      if (!created.ok) throw new Error();
      rooms.join(B, 'Bình', created.room.code);
      rooms.setOptions(A, { timeControl: '3+2' });
      const started = rooms.start(A);
      if (!started.ok) throw new Error();
      const view = () => rooms.view(started.room, A, allOnline).game as ChessView;
      const [white, black] = view().white === A ? [A, B] : [B, A];

      rooms.move(white, { type: 'move', from: 'e2', to: 'e4' });
      rooms.move(black, { type: 'move', from: 'e7', to: 'e5' });
      vi.advanceTimersByTime(3 * 60_000 - 1);
      expect(updates).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(updates).toEqual(['finished']);
      expect(view().result).toEqual({ winner: black, reason: 'timeout' });
    });

    it('does not fire after the room is gone', () => {
      vi.useFakeTimers();
      const updates: string[] = [];
      const rooms = new RoomManager({ onAutoUpdate: (room) => updates.push(room.code) });
      const created = rooms.create(A, 'An', 'chess');
      if (!created.ok) throw new Error();
      rooms.join(B, 'Bình', created.room.code);
      rooms.setOptions(A, { timeControl: '3+2' });
      rooms.start(A);
      const view = rooms.view(created.room, A, allOnline).game as ChessView;
      const [white, black] = view.white === A ? [A, B] : [B, A];
      rooms.move(white, { type: 'move', from: 'e2', to: 'e4' });
      rooms.move(black, { type: 'move', from: 'e7', to: 'e5' });
      rooms.leave(A);
      rooms.leave(B);
      vi.advanceTimersByTime(10 * 60_000);
      expect(updates).toEqual([]);
    });
  });
});
