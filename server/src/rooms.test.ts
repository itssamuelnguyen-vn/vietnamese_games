import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CaNguaView, CaroView, ChessView, WordChainView, TienLenView, TyPhuView } from '@vg/shared';
import { caNguaGame, tienlenGame, xdHandValue, type BauCuaView, type TienLenState, type XiDachView } from '@vg/shared';
import { RoomManager } from './rooms';

const A = 'player-a';
const B = 'player-b';
const C = 'player-c';
const D = 'player-d';
const allOnline = () => true;

function roomWithTwo() {
  const rooms = new RoomManager();
  const created = rooms.create(A, 'An', 'chess');
  if (!created.ok) throw new Error(created.error);
  rooms.join(B, 'Bob', created.room.code);
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
    expect(rooms.create(A, 'An', 'maubinh')).toEqual({ ok: false, error: 'GAME_UNAVAILABLE' });
    expect(rooms.create(A, '   ', 'chess')).toEqual({ ok: false, error: 'NAME_REQUIRED' });
    expect(rooms.create(A, 42 as unknown as string, 'chess')).toEqual({ ok: false, error: 'NAME_REQUIRED' });
  });

  it('refuses new rooms once the server is full', () => {
    const rooms = new RoomManager({ maxRooms: 2 });
    expect(rooms.create(A, 'An', 'chess').ok).toBe(true);
    expect(rooms.create(B, 'Bob', 'chess').ok).toBe(true);
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
    expect(rooms.join(B, 'Bob', 'ZZZZ')).toEqual({ ok: false, error: 'ROOM_NOT_FOUND' });
    expect(rooms.join(B, 'Bob', ` ${created.room.code.toLowerCase()} `).ok).toBe(true);
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
    expect(rooms.join(B, 'Bob', code).ok).toBe(true);
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
    rooms.join(B, 'Bob', created.room.code);
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
    expect(rooms.join(B, 'Bob', created.room.code)).toEqual({ ok: false, error: 'ROOM_NOT_FOUND' });
  });

  it('creating a new room leaves the previous one', () => {
    const { rooms, code } = roomWithTwo();
    const r = rooms.create(B, 'Bob', 'chess');
    expect(r.ok && r.left?.code).toBe(code);
    expect(rooms.roomOf(A)?.players.map((p) => p.id)).toEqual([A]);
  });

  describe('abandonment and rematches', () => {
    it('lets a player claim the win once the opponent has been offline for a minute', () => {
      let now = 0;
      const rooms = new RoomManager({ clock: () => now });
      const created = rooms.create(A, 'An', 'chess');
      if (!created.ok) throw new Error();
      rooms.join(B, 'Bob', created.room.code);
      rooms.start(A);
      const offline = (since: number | null) => (id: string) => (id === B ? since : null);

      expect(rooms.claimWin(A, offline(null))).toEqual({ ok: false, error: 'CLAIM_TOO_EARLY' });
      now = 59_999;
      expect(rooms.claimWin(A, offline(0))).toEqual({ ok: false, error: 'CLAIM_TOO_EARLY' });
      expect(rooms.view(created.room, A, (id) => id !== B, offline(0)).players.find((p) => p.id === B)?.offlineMs).toBe(59_999);
      now = 60_000;
      const r = rooms.claimWin(A, offline(0));
      expect(r.ok && r.room.status).toBe('finished');
      expect((rooms.view(created.room, A, allOnline).game as ChessView).result).toEqual({ winner: A, reason: 'abandoned' });
      // The absent player loses their seat, so a newcomer can sit down for the next game.
      expect(created.room.players.map((p) => p.id)).toEqual([A]);
      expect(created.room.departed.map((p) => p.id)).toContain(B);
      rooms.join(C, 'Chi', created.room.code);
      expect(created.room.players.map((p) => p.id)).toEqual([A, C]);
    });

    it('spectators who arrived mid-game take free seats when it ends', () => {
      // A fixed deal, so the game can't end at once on an instant win (about 2% of random deals).
      let seed = 1;
      const rooms = new RoomManager({ random: () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646 });
      const created = rooms.create(A, 'An', 'tienlen');
      if (!created.ok) throw new Error();
      rooms.join(B, 'Bob', created.room.code);
      rooms.start(A);
      expect(created.room.status).toBe('playing');
      rooms.join(C, 'Chi', created.room.code);
      expect(created.room.spectators.map((p) => p.id)).toEqual([C]);
      rooms.move(A, { type: 'pass' });
      // Ending the game any way (here B leaves) seats the waiting spectator.
      rooms.leave(B);
      expect(created.room.status).toBe('finished');
      expect(created.room.players.map((p) => p.id)).toEqual([A, C]);
    });

    it('spectators cannot claim, and nobody can claim outside a game', () => {
      const { rooms, code } = roomWithTwo();
      rooms.join(C, 'Chi', code);
      expect(rooms.claimWin(A, () => 0)).toEqual({ ok: false, error: 'GAME_NOT_STARTED' });
      rooms.start(A);
      expect(rooms.claimWin(C, () => 0)).toEqual({ ok: false, error: 'NOT_A_PLAYER' });
    });

    it('starts a rematch once every seated player asks for one', () => {
      const { rooms } = roomWithTwo();
      expect(rooms.requestRematch(B)).toEqual({ ok: false, error: 'GAME_IN_PROGRESS' });
      rooms.start(A);
      rooms.move(A, { type: 'resign' });
      const first = rooms.requestRematch(B);
      expect(first.ok && first.room.rematchVotes).toEqual([B]);
      expect(first.ok && first.room.status).toBe('finished');
      const second = rooms.requestRematch(A);
      expect(second.ok && second.room.status).toBe('playing');
      expect(second.ok && second.room.rematchVotes).toEqual([]);
    });
  });

  describe('watching', () => {
    it('joining to watch takes no seat, even a free one', () => {
      const rooms = new RoomManager();
      const created = rooms.create(A, 'An', 'tienlen');
      if (!created.ok) throw new Error(created.error);
      expect(rooms.join(B, 'Bob', created.room.code, true).ok).toBe(true);
      expect(created.room.players.map((p) => p.id)).toEqual([A]);
      expect(created.room.spectators.map((p) => p.id)).toEqual([B]);
    });

    it('spectators sit and players stand only between games, and only with a seat free', () => {
      const rooms = new RoomManager();
      const created = rooms.create(A, 'An', 'chess');
      if (!created.ok) throw new Error(created.error);
      const room = created.room;
      rooms.join(B, 'Bob', room.code, true);
      rooms.join(C, 'Chi', room.code, true);
      expect(rooms.sit(B).ok).toBe(true);
      // Chess has two seats.
      expect(rooms.sit(C)).toEqual({ ok: false, error: 'ROOM_FULL' });
      expect(rooms.sit(A)).toEqual({ ok: false, error: 'INVALID_MOVE' });
      rooms.start(A);
      expect(rooms.stand(B)).toEqual({ ok: false, error: 'GAME_IN_PROGRESS' });
      rooms.move(A, { type: 'resign' });
      expect(rooms.stand(B).ok).toBe(true);
      expect(room.players.map((p) => p.id)).toEqual([A]);
      expect(rooms.stand(C)).toEqual({ ok: false, error: 'NOT_A_PLAYER' });
    });

    it('a host who gets up to watch can still start a game for the others', () => {
      const rooms = new RoomManager();
      const created = rooms.create(A, 'An', 'tienlen');
      if (!created.ok) throw new Error(created.error);
      rooms.addBot(A);
      rooms.addBot(A);
      expect(rooms.stand(A).ok).toBe(true);
      expect(rooms.start(A).ok).toBe(true);
      expect((created.room.state as TienLenState).seats.toSorted()).toEqual(['bot:1', 'bot:2']);
    });

    it('a free seat after a game goes to those waiting to play, not to those who chose to watch', () => {
      let seed = 1;
      const rooms = new RoomManager({ random: () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646 });
      const created = rooms.create(A, 'An', 'tienlen');
      if (!created.ok) throw new Error(created.error);
      const room = created.room;
      rooms.join(B, 'Bob', room.code);
      rooms.join(C, 'Chi', room.code, true);
      rooms.start(A);
      expect(room.status).toBe('playing');
      // D arrives mid-game, so watches for now; then B leaves and the game ends.
      rooms.join(D, 'Dan', room.code);
      rooms.leave(B);
      expect(room.status).toBe('finished');
      expect(room.players.map((p) => p.id)).toEqual([A, D]);
      expect(room.spectators.map((p) => p.id)).toEqual([C]);
    });
  });

  describe('play money', () => {
    it('only tien len can be played for money, on the listed terms', () => {
      const rooms = new RoomManager();
      rooms.create(A, 'An', 'tienlen');
      expect(rooms.setOptions(A, { stakes: 'money', walletStart: 500_000, stakePerPoint: 10_000 }).ok).toBe(true);
      expect(rooms.setOptions(A, { walletStart: 123 })).toEqual({ ok: false, error: 'INVALID_OPTIONS' });
      expect(rooms.setOptions(A, { stakePerPoint: 7 })).toEqual({ ok: false, error: 'INVALID_OPTIONS' });
      rooms.create(B, 'Bob', 'chess');
      expect(rooms.setOptions(B, { stakes: 'money' })).toEqual({ ok: false, error: 'INVALID_OPTIONS' });
    });

    it('moves wallets by points times the stake, and sends broke players to watch', () => {
      let seed = 1;
      const rooms = new RoomManager({ random: () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646 });
      const created = rooms.create(A, 'An', 'tienlen');
      if (!created.ok) throw new Error(created.error);
      const room = created.room;
      rooms.join(B, 'Bob', room.code);
      rooms.join(C, 'Chi', room.code);
      rooms.setOptions(A, { stakes: 'money', walletStart: 100_000, stakePerPoint: 10_000 });
      expect(rooms.view(room, A, allOnline).wallets).toEqual({ [A]: 100_000, [B]: 100_000, [C]: 100_000 });
      expect(rooms.start(A).ok).toBe(true);
      expect(room.status).toBe('playing');
      // C and B leave: A wins.
      rooms.leave(C);
      rooms.leave(B);
      expect(room.status).toBe('finished');
      const scores = tienlenGame.points!(room.state as TienLenState)!;
      expect(room.wallets[A]).toBe(100_000 + scores[A].points * 10_000);
      expect(room.wallets[B]).toBe(Math.max(0, 100_000 + scores[B].points * 10_000));

      // B comes back broke: they watch instead of playing.
      rooms.join(B, 'Bob', room.code);
      rooms.join(C, 'Chi', room.code);
      room.wallets[B] = 0;
      expect(room.players.map((p) => p.id)).toContain(B);
      expect(rooms.start(A).ok).toBe(true);
      expect(room.players.map((p) => p.id)).toEqual([A, C]);
      expect(room.spectators.map((p) => p.id)).toEqual([B]);
    });

    it('new terms start everyone afresh', () => {
      const rooms = new RoomManager();
      const created = rooms.create(A, 'An', 'tienlen');
      if (!created.ok) throw new Error(created.error);
      rooms.setOptions(A, { stakes: 'money' });
      created.room.wallets[A] = 5_000;
      rooms.setOptions(A, { walletStart: 1_000_000 });
      expect(rooms.view(created.room, A, allOnline).wallets).toEqual({ [A]: 1_000_000 });
      rooms.setOptions(A, { stakes: 'points' });
      expect(rooms.view(created.room, A, allOnline).wallets).toBeNull();
    });
  });

  describe('tien len', () => {
    const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

    // A deterministic three-player table; skips seeds whose deal is an instant win (~3% of deals).
    function tableOfThree(options: object = {}) {
      vi.useFakeTimers();
      for (let seed = 1; ; seed++) {
        const updates: string[] = [];
        const rooms = new RoomManager({ random: seeded(seed), onAutoUpdate: (room) => updates.push(room.status) });
        const created = rooms.create(A, 'An', 'tienlen');
        if (!created.ok) throw new Error(created.error);
        rooms.join(B, 'Bob', created.room.code);
        rooms.join(C, 'Chi', created.room.code);
        rooms.setOptions(A, options);
        const started = rooms.start(A);
        if (!started.ok) throw new Error(started.error);
        const view = (id: string) => rooms.view(started.room, id, allOnline).game as TienLenView;
        if (!view(A).result) return { rooms, room: started.room, view, updates };
      }
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('seats up to four players and deals to all of them', () => {
      const { view } = tableOfThree();
      expect(view(A).seats.map((s) => s.cards)).toEqual([13, 13, 13]);
      expect(view(A).result).toBeNull();
    });

    it('keeps playing when one of three players leaves, and still knows their name', () => {
      const { rooms, room, view } = tableOfThree();
      rooms.leave(C);
      expect(room.status).toBe('playing');
      expect(view(A).seats.find((s) => s.id === C)?.out).toBe(true);
      expect(rooms.view(room, A, allOnline).departed).toEqual([{ id: C, name: 'Chi' }]);
      rooms.move(view(A).turn!, { type: 'pass' });
      // A new game forgets who left the previous one.
      rooms.leave(B);
      expect(room.status).toBe('finished');
      rooms.join(C, 'Chi', room.code);
      rooms.start(A);
      expect(rooms.view(room, A, allOnline).departed).toEqual([]);
    });

    it('adds each finished game to the room scoreboard once', () => {
      const { rooms, room } = tableOfThree();
      rooms.leave(B);
      rooms.leave(C);
      const tally = rooms.view(room, A, allOnline).tally;
      expect(tally.map((e) => [e.name, e.games, e.wins, e.points])).toEqual([
        ['An', 1, 1, 2],
        ['Chi', 1, 0, 0],
        ['Bob', 1, 0, -2],
      ]);
      // Viewing again doesn't count the game twice.
      expect(rooms.view(room, A, allOnline).tally[0].games).toBe(1);
    });

    it('a game decided on the deal finishes at once so a rematch can start', () => {
      // Find a seed whose deal is an instant win.
      for (let seed = 1; seed < 500; seed++) {
        const rooms = new RoomManager({ random: seeded(seed) });
        const created = rooms.create(A, 'An', 'tienlen');
        if (!created.ok) throw new Error();
        rooms.join(B, 'Bob', created.room.code);
        rooms.start(A);
        if ((rooms.view(created.room, A, allOnline).game as TienLenView).result) {
          expect(created.room.status).toBe('finished');
          expect(rooms.view(created.room, A, allOnline).tally).toHaveLength(2);
          expect(rooms.start(A).ok).toBe(true);
          return;
        }
      }
      throw new Error('no instant-win seed found');
    });

    it('removes a player who has been offline for a minute while the others play on', () => {
      const { rooms, room, view } = tableOfThree();
      const offline = (id: string) => (id === C ? Date.now() - 60_000 : null);
      expect(rooms.claimWin(A, (id) => (id === C ? Date.now() - 59_000 : null))).toEqual({ ok: false, error: 'CLAIM_TOO_EARLY' });
      expect(rooms.claimWin(A, offline).ok).toBe(true);
      expect(room.status).toBe('playing');
      expect(view(A).seats.find((s) => s.id === C)?.out).toBe(true);
      expect(view(A).turn).not.toBe(C);
    });

    it('moves the game on by itself when a turn runs out', () => {
      const { view, updates } = tableOfThree({ turnTimer: '15' });
      const first = view(A).turn;
      vi.advanceTimersByTime(15_000);
      expect(updates).toEqual(['playing']);
      expect(view(A).turn).not.toBe(first);
      expect(view(A).log.at(-1)).toMatchObject({ kind: 'play', auto: true });
    });
  });

  describe('chat', () => {
    it('stores trimmed messages from players and spectators', () => {
      const { rooms, code } = roomWithTwo();
      rooms.join(C, 'Chi', code);
      expect(rooms.chat(A, '  hello there  ').ok).toBe(true);
      expect(rooms.chat(C, 'hi from the stands').ok).toBe(true);
      const chat = rooms.view(rooms.roomOf(A)!, B, allOnline).chat;
      expect(chat.map((m) => [m.name, m.text])).toEqual([
        ['An', 'hello there'],
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
      expect(rooms.roomOf(A)?.options).toEqual({ timeControl: '10+0', hostColor: 'random', handicap: 'none', turnTimer: '30', houseRules: [], caroSize: '15', caroBlock: true, caNguaRules: [], stakes: 'points', walletStart: 200_000, stakePerPoint: 5_000 });
      expect(rooms.setOptions(B, { timeControl: '3+2' })).toEqual({ ok: false, error: 'NOT_HOST' });
      expect(rooms.setOptions(A, { timeControl: '1+0' })).toEqual({ ok: false, error: 'INVALID_OPTIONS' });
      expect(rooms.setOptions(A, { timeControl: 'toString' })).toEqual({ ok: false, error: 'INVALID_OPTIONS' });
      expect(rooms.setOptions(A, null)).toEqual({ ok: false, error: 'INVALID_OPTIONS' });
      expect(rooms.setOptions(A, { hostColor: 'purple' })).toEqual({ ok: false, error: 'INVALID_OPTIONS' });
      expect(rooms.setOptions(A, { hostColor: 'black' }).ok).toBe(true);
      expect(rooms.roomOf(A)?.options).toEqual({ timeControl: '10+0', hostColor: 'black', handicap: 'none', turnTimer: '30', houseRules: [], caroSize: '15', caroBlock: true, caNguaRules: [], stakes: 'points', walletStart: 200_000, stakePerPoint: 5_000 });
      expect(rooms.setOptions(A, { handicap: 'queen' })).toEqual({ ok: false, error: 'INVALID_OPTIONS' });
      expect(rooms.setOptions(A, { houseRules: ['no-two-finish', 'bogus'] })).toEqual({ ok: false, error: 'INVALID_OPTIONS' });
      expect(rooms.setOptions(A, { houseRules: 'no-two-finish' })).toEqual({ ok: false, error: 'INVALID_OPTIONS' });
      expect(rooms.setOptions(A, { handicap: 'horse' }).ok).toBe(true);
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
      rooms.join(B, 'Bob', created.room.code);
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
      rooms.join(B, 'Bob', created.room.code);
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

  describe('bots', () => {
    afterEach(() => vi.useRealTimers());

    function typhuRoom(options = {}) {
      const rooms = new RoomManager({ botDelayMs: 10, ...options });
      const created = rooms.create(A, 'An', 'typhu');
      if (!created.ok) throw new Error(created.error);
      return { rooms, room: created.room };
    }

    it('only the host adds or removes bots, between games, in games that have them', () => {
      const { rooms, room } = typhuRoom();
      rooms.join(B, 'Bob', room.code);
      expect(rooms.addBot(B)).toEqual({ ok: false, error: 'NOT_HOST' });
      expect(rooms.addBot(A).ok).toBe(true);
      expect(rooms.addBot(A).ok).toBe(true);
      expect(room.players.map((p) => p.name)).toEqual(['An', 'Bob', 'Bot 1', 'Bot 2']);
      const view = rooms.view(room, A, () => false);
      expect(view.players.filter((p) => p.bot).every((p) => p.connected)).toBe(true);
      expect(rooms.removeBot(A, 'bot:1').ok).toBe(true);
      expect(rooms.removeBot(A, B)).toEqual({ ok: false, error: 'INVALID_MOVE' });
      expect(rooms.addBot(A).ok).toBe(true);
      expect(room.players.map((p) => p.id)).toContain('bot:1');

      const chess = rooms.create(C, 'Chi', 'chess');
      // Every playable game now has bots, two-player games included.
      expect(chess.ok && rooms.addBot(C).ok).toBe(true);
    });

    it('fills the table up to the maximum and not past it', () => {
      const { rooms } = typhuRoom();
      for (let i = 0; i < 5; i++) expect(rooms.addBot(A).ok).toBe(true);
      expect(rooms.addBot(A)).toEqual({ ok: false, error: 'ROOM_FULL' });
    });

    it('bots play on their own, and a game with one person and bots runs to the end', async () => {
      vi.useFakeTimers();
      const updates: string[] = [];
      const { rooms, room } = typhuRoom({ onAutoUpdate: (r: { status: string }) => updates.push(r.status) });
      rooms.addBot(A);
      rooms.addBot(A);
      expect(rooms.start(A).ok).toBe(true);
      // Whenever it's the person's turn, they roll and skip buying; they stay out of auctions (once
      // bankrupt they have no say). Bots also wait for each turn's animation, scaled down with the pause.
      for (let i = 0; i < 10_000 && room.status === 'playing'; i++) {
        const view = rooms.view(room, A, allOnline).game as TyPhuView;
        const a = view.auction;
        const playing = !view.seats.find((s) => s.id === A)!.out;
        if (playing && a && a.from !== A && !a.passed.includes(A)) rooms.move(A, { type: 'pass' });
        else if (playing && view.turn === A && view.phase !== 'auction') rooms.move(A, view.phase === 'move' ? { type: 'roll' } : view.phase === 'fly' ? { type: 'stay' } : { type: 'end' });
        else vi.advanceTimersByTime(20);
      }
      expect(room.status).toBe('finished');
      expect(updates.length).toBeGreaterThan(10);
      const result = (rooms.view(room, A, allOnline).game as TyPhuView).result!;
      expect(result.ranking.toSorted()).toEqual([A, 'bot:1', 'bot:2'].toSorted());
      expect(Object.keys(room.tally)).toHaveLength(3);

      // Bots always agree to a rematch.
      expect(rooms.requestRematch(A).ok).toBe(true);
      expect(room.status).toBe('playing');
    });

    it('tien len: bots play a game with a person to the end', () => {
      vi.useFakeTimers();
      const rooms = new RoomManager({ botDelayMs: 10 });
      const created = rooms.create(A, 'An', 'tienlen');
      if (!created.ok) throw new Error(created.error);
      const room = created.room;
      expect(rooms.addBot(A).ok).toBe(true);
      expect(rooms.addBot(A).ok).toBe(true);
      expect(rooms.start(A).ok).toBe(true);
      // The person plays what a bot would in their seat; the bots answer on their own.
      for (let i = 0; i < 5000 && room.status === 'playing'; i++) {
        const state = room.state as TienLenState;
        if (state.turn === A) rooms.move(A, tienlenGame.botMove!(state, A, { now: 0 })!);
        else vi.advanceTimersByTime(10);
      }
      expect(room.status).toBe('finished');
      const result = (rooms.view(room, A, allOnline).game as TienLenView).result!;
      expect(result.ranking.toSorted()).toEqual([A, 'bot:1', 'bot:2'].toSorted());
    });

    // Each bot move searches until its node cap (about 1.5 s) here, as fake timers freeze the clock.
    it('chess and xiangqi: a bot answers each move, even with the clock frozen by fake timers', { timeout: 30_000 }, () => {
      vi.useFakeTimers();
      for (const [type, moves] of [
        ['chess', [{ from: 'e2', to: 'e4' }, { from: 'g1', to: 'f3' }]],
        ['xiangqi', [{ from: 'h2', to: 'e2' }, { from: 'h0', to: 'g2' }]],
      ] as const) {
        const rooms = new RoomManager({ botDelayMs: 10 });
        const created = rooms.create(A, 'An', type);
        if (!created.ok) throw new Error(created.error);
        const room = created.room;
        rooms.setOptions(A, { hostColor: 'white', timeControl: 'none' });
        rooms.addBot(A);
        expect(rooms.start(A).ok).toBe(true);
        for (const move of moves) {
          const before = JSON.stringify(room.state);
          expect(rooms.move(A, { type: 'move', ...move }).ok).toBe(true);
          vi.advanceTimersByTime(20);
          // The bot has replied: it's the person's turn again.
          expect(JSON.stringify(room.state)).not.toBe(before);
        }
        const view = rooms.view(room, A, allOnline).game as { history?: string[]; moves?: string[] };
        expect((view.history ?? view.moves)!.length).toBe(4);
      }
    });

    it('bau cua and xi dach: a person and two bots play every round to the end', () => {
      vi.useFakeTimers();
      for (const type of ['baucua', 'xidach'] as const) {
        const rooms = new RoomManager({ botDelayMs: 10 });
        const created = rooms.create(A, 'An', type);
        if (!created.ok) throw new Error(created.error);
        const room = created.room;
        rooms.addBot(A);
        rooms.addBot(A);
        expect(rooms.start(A).ok).toBe(true);
        // The person stakes the smallest amount and gets ready; in xi dach they draw to 16 and stand.
        for (let i = 0; i < 20_000 && room.status === 'playing'; i++) {
          // The parts of both games' views this loop needs.
          const v = rooms.view(room, A, allOnline).game as {
            phase: string;
            turn?: string | null;
            hands?: XiDachView['hands'];
            seats: { id: string; chips: number; ready: boolean; out: boolean; staked?: number; bet?: number }[];
          };
          const me = v.seats.find((p) => p.id === A)!;
          if (v.phase === 'bet' && !me.ready && me.chips > 0 && !me.out) {
            if (type === 'baucua' && me.staked === 0) rooms.move(A, { type: 'bet', symbol: 'cua', amount: 10 });
            else if (type === 'xidach' && me.bet === 0) rooms.move(A, { type: 'bet', amount: 10 });
            else rooms.move(A, { type: 'ready' });
          } else if (type === 'xidach' && v.phase === 'play' && v.turn === A) {
            const total = xdHandValue(v.hands![A]);
            rooms.move(A, total.kind === 'points' && total.total < 16 ? { type: 'hit' } : { type: 'stand' });
          } else vi.advanceTimersByTime(250);
        }
        expect(room.status).toBe('finished');
        const result = (rooms.view(room, A, allOnline).game as BauCuaView).result!;
        expect(result.ranking.toSorted()).toEqual([A, 'bot:1', 'bot:2'].toSorted());
      }
    });

    it('people keep sending moves, yet bots still get to act', () => {
      vi.useFakeTimers();
      const { rooms, room } = typhuRoom({ botDelayMs: 900 });
      rooms.join(B, 'Bob', room.code);
      rooms.addBot(A);
      rooms.start(A);
      const turnOf = () => (rooms.view(room, A, allOnline).game as TyPhuView).turn;
      // Play the people's turns until it's the bot's. In auctions the people pass, and the bot
      // gets time to answer.
      for (let i = 0; i < 40 && turnOf() !== 'bot:1'; i++) {
        const view = rooms.view(room, A, allOnline).game as TyPhuView;
        const a = view.auction;
        const bidder = a && [A, B].find((id) => id !== a.from && !a.passed.includes(id));
        if (a) {
          if (bidder) rooms.move(bidder, { type: 'pass' });
          else vi.advanceTimersByTime(1000);
        } else rooms.move(view.turn!, view.phase === 'move' ? { type: 'roll' } : view.phase === 'fly' ? { type: 'stay' } : { type: 'end' });
      }
      expect(turnOf()).toBe('bot:1');
      // Borrowing and repaying every half second must not keep postponing the bot (which first waits
      // for the last move's animation to finish).
      for (let i = 0; i < 10 && turnOf() === 'bot:1'; i++) {
        rooms.move(B, { type: 'borrow', amount: 50 });
        vi.advanceTimersByTime(500);
        rooms.move(B, { type: 'repay', amount: 50 });
        vi.advanceTimersByTime(500);
      }
      expect((rooms.view(room, A, allOnline).game as TyPhuView).log.some((e) => 'player' in e && e.player === 'bot:1')).toBe(true);
    });

    it('tells spectators when the last person leaves a room of bots', () => {
      vi.useFakeTimers();
      const closed: string[][] = [];
      const { rooms, room } = typhuRoom({ onClosed: (ids: string[]) => closed.push(ids) });
      // Two bots, so the game goes on without the host and the spectator doesn't take a seat.
      rooms.addBot(A);
      rooms.addBot(A);
      rooms.start(A);
      rooms.join(C, 'Chi', room.code);
      rooms.leave(A);
      expect(closed).toEqual([[C]]);
      expect(rooms.roomOf(C)).toBeUndefined();
    });

    it('caro: a bot answers every move until the game ends', () => {
      vi.useFakeTimers();
      const rooms = new RoomManager({ botDelayMs: 10 });
      const created = rooms.create(A, 'An', 'caro');
      if (!created.ok) throw new Error(created.error);
      const room = created.room;
      rooms.setOptions(A, { timeControl: 'none', hostColor: 'white' });
      rooms.addBot(A);
      expect(rooms.start(A).ok).toBe(true);
      for (let i = 0; i < 300 && room.status === 'playing'; i++) {
        const view = rooms.view(room, A, allOnline).game as CaroView;
        if (view.turn === 'x') {
          const free = Array.from({ length: view.size * view.size }, (_, c) => c).filter((c) => !view.moves.includes(c));
          rooms.move(A, { type: 'place', cell: free[0] });
        } else vi.advanceTimersByTime(10);
      }
      expect(room.status).toBe('finished');
      // Playing the first free cell every time, the person loses to the bot.
      expect((rooms.view(room, A, allOnline).game as CaroView).result?.winner).toBe('bot:1');
    });

    it('co ca ngua: bots race a person to the end', () => {
      vi.useFakeTimers();
      const rooms = new RoomManager({ botDelayMs: 10 });
      const created = rooms.create(A, 'An', 'cangua');
      if (!created.ok) throw new Error(created.error);
      const room = created.room;
      rooms.setOptions(A, { turnTimer: 'none', caNguaRules: ['jump', 'fast-home'] });
      expect(rooms.setOptions(A, { caNguaRules: ['bogus'] as never })).toEqual({ ok: false, error: 'INVALID_OPTIONS' });
      rooms.addBot(A);
      rooms.addBot(A);
      expect(rooms.start(A).ok).toBe(true);
      // Cá ngựa bots wait botPace times the room's pause, so step the clock by a whole pause.
      const pause = 10 * (caNguaGame.botPace ?? 1);
      for (let i = 0; i < 20_000 && room.status === 'playing'; i++) {
        const view = rooms.view(room, A, allOnline).game as CaNguaView;
        if (view.turn !== A) vi.advanceTimersByTime(pause);
        else if (view.phase === 'roll') rooms.move(A, { type: 'roll' });
        else rooms.move(A, { type: 'move', horse: view.choices[0].horse });
      }
      expect(room.status).toBe('finished');
      expect((rooms.view(room, A, allOnline).game as CaNguaView).result?.ranking).toHaveLength(3);
    });

    it('noi tu: the real dictionary loads and bots play a game to the end', () => {
      vi.useFakeTimers();
      // A fixed random source: with a random one, a bot sometimes had no word for the very first
      // link and the game ended after two words.
      let seed = 3;
      const rooms = new RoomManager({ botDelayMs: 10, random: () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646 });
      const created = rooms.create(A, 'An', 'noitu');
      if (!created.ok) throw new Error(created.error);
      const room = created.room;
      rooms.addBot(A);
      rooms.addBot(A);
      expect(rooms.start(A).ok).toBe(true);
      // The person gives up straight away; the two bots play it out.
      expect(rooms.move(A, { type: 'give-up' }).ok).toBe(true);
      for (let i = 0; i < 5000 && room.status === 'playing'; i++) vi.advanceTimersByTime(10);
      expect(room.status).toBe('finished');
      const view = rooms.view(room, A, allOnline).game as WordChainView;
      expect(view.result?.ranking.at(-1)).toBe(A);
      expect(view.used).toBeGreaterThan(2);
    });

    it('English word chain: the dictionary loads and refuses unknown words', () => {
      vi.useFakeTimers();
      const rooms = new RoomManager({ botDelayMs: 10 });
      const created = rooms.create(A, 'An', 'wordchain');
      if (!created.ok) throw new Error(created.error);
      const room = created.room;
      rooms.addBot(A);
      expect(rooms.start(A).ok).toBe(true);
      const view = rooms.view(room, A, allOnline).game as WordChainView;
      expect(view.turn).toBe(A);
      expect(rooms.move(A, { type: 'word', text: `${view.link}qqqzz` })).toEqual({ ok: false, error: 'WORD_UNKNOWN' });
      expect(rooms.move(A, { type: 'give-up' }).ok).toBe(true);
      expect(room.status).toBe('finished');
    });

    it('a room left with only bots closes', () => {
      vi.useFakeTimers();
      const { rooms, room } = typhuRoom();
      rooms.addBot(A);
      rooms.start(A);
      expect(rooms.leave(A)).toBeUndefined();
      expect(rooms.roomOf(A)).toBeUndefined();
      // Leaving ends the two-seat game, and nothing is left running for the closed room.
      expect(room.status).toBe('finished');
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
