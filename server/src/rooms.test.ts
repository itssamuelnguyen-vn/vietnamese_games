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

  it('refuses new rooms once the server is full', () => {
    const rooms = new RoomManager({ maxRooms: 2 });
    expect(rooms.create(A, 'An', 'chess').ok).toBe(true);
    expect(rooms.create(B, 'Bình', 'chess').ok).toBe(true);
    expect(rooms.create(C, 'Chi', 'chess')).toEqual({ ok: false, error: 'SERVER_FULL' });
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

  it('seats newcomers as spectators once the seats are taken', () => {
    const { rooms, code } = roomWithTwo();
    const r = rooms.join(C, 'Chi', code);
    expect(r.ok && r.room.spectators).toEqual([{ id: C, name: 'Chi' }]);
    expect(rooms.view(rooms.roomOf(C)!, C, allOnline).spectators.map((p) => p.id)).toEqual([C]);
    expect(rooms.start(C)).toEqual({ ok: false, error: 'NOT_HOST' });
  });

  it('lets an existing member rejoin and newcomers watch while playing', () => {
    const { rooms, code } = roomWithTwo();
    rooms.start(A);
    expect(rooms.join(B, 'Bình', code).ok).toBe(true);
    const r = rooms.join(C, 'Chi', code);
    expect(r.ok && r.room.spectators.map((p) => p.id)).toEqual([C]);
    expect(rooms.move(C, { type: 'move', from: 'e2', to: 'e4' })).toEqual({ ok: false, error: 'NOT_A_PLAYER' });
  });

  it('caps the number of spectators', () => {
    const { rooms, code } = roomWithTwo();
    for (let i = 0; i < 20; i++) expect(rooms.join(`spectator-${i}`, `S${i}`, code).ok).toBe(true);
    expect(rooms.join(C, 'Chi', code)).toEqual({ ok: false, error: 'ROOM_FULL' });
  });

  it('a spectator leaving does not affect the game', () => {
    const { rooms, code } = roomWithTwo();
    rooms.join(C, 'Chi', code);
    rooms.start(A);
    const room = rooms.leave(C);
    expect(room?.status).toBe('playing');
    expect(room?.spectators).toEqual([]);
  });

  it('promotes spectators into free seats between games', () => {
    const { rooms, code } = roomWithTwo();
    rooms.join(C, 'Chi', code);
    rooms.start(A);
    const room = rooms.leave(B);
    expect(room?.status).toBe('finished');
    expect(room?.players.map((p) => p.id)).toEqual([A, C]);
    expect(room?.spectators).toEqual([]);
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

  it('gives the host their chosen side and swaps on rematch', () => {
    const { rooms } = roomWithTwo();
    rooms.setOptions(A, { hostColor: 'black' });
    const first = rooms.start(A);
    if (!first.ok) throw new Error();
    expect((rooms.view(first.room, A, allOnline).game as ChessView).black).toBe(A);
    rooms.move(A, { type: 'resign' });
    rooms.start(A);
    expect((rooms.view(first.room, A, allOnline).game as ChessView).white).toBe(A);
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

  describe('chat', () => {
    it('stores trimmed messages from players and spectators', () => {
      const { rooms, code } = roomWithTwo();
      rooms.join(C, 'Chi', code);
      expect(rooms.chat(A, '  xin chào  ').ok).toBe(true);
      expect(rooms.chat(C, 'hi from the stands').ok).toBe(true);
      const chat = rooms.view(rooms.roomOf(A)!, B, allOnline).chat;
      expect(chat.map((m) => [m.name, m.text])).toEqual([
        ['An', 'xin chào'],
        ['Chi', 'hi from the stands'],
      ]);
      expect(chat[0].id).not.toBe(chat[1].id);
    });

    it('rejects empty or non-text messages and truncates long ones', () => {
      const { rooms } = roomWithTwo();
      for (const bad of ['', '   ', null, 42, { text: 'x' }]) {
        expect(rooms.chat(A, bad)).toEqual({ ok: false, error: 'MESSAGE_INVALID' });
      }
      rooms.chat(A, 'x'.repeat(500));
      expect(rooms.roomOf(A)!.chat[0].text).toHaveLength(200);
      expect(rooms.chat('stranger', 'hi')).toEqual({ ok: false, error: 'NOT_IN_ROOM' });
    });

    it('rate-limits each person and keeps only recent history', () => {
      let now = 0;
      const rooms = new RoomManager({ clock: () => now });
      const created = rooms.create(A, 'An', 'chess');
      if (!created.ok) throw new Error();
      for (let i = 0; i < 5; i++) expect(rooms.chat(A, `m${i}`).ok).toBe(true);
      expect(rooms.chat(A, 'one too many')).toEqual({ ok: false, error: 'MESSAGE_TOO_FAST' });
      now += 10_000;
      for (let round = 0; round < 12; round++, now += 10_000) {
        for (let i = 0; i < 5; i++) rooms.chat(A, `r${round}-${i}`);
      }
      const chat = rooms.roomOf(A)!.chat;
      expect(chat).toHaveLength(50);
      expect(chat.at(-1)?.text).toBe('r11-4');
    });
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
      expect(rooms.roomOf(A)?.options).toEqual({ timeControl: '10+0', hostColor: 'random' });
      expect(rooms.setOptions(B, { timeControl: '3+2' })).toEqual({ ok: false, error: 'NOT_HOST' });
      expect(rooms.setOptions(A, { timeControl: '1+0' })).toEqual({ ok: false, error: 'INVALID_OPTIONS' });
      expect(rooms.setOptions(A, { timeControl: 'toString' })).toEqual({ ok: false, error: 'INVALID_OPTIONS' });
      expect(rooms.setOptions(A, null)).toEqual({ ok: false, error: 'INVALID_OPTIONS' });
      expect(rooms.setOptions(A, { hostColor: 'purple' })).toEqual({ ok: false, error: 'INVALID_OPTIONS' });
      expect(rooms.setOptions(A, { hostColor: 'black' }).ok).toBe(true);
      expect(rooms.roomOf(A)?.options).toEqual({ timeControl: '10+0', hostColor: 'black' });
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
