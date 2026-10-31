import {
  DEFAULT_ROOM_OPTIONS,
  GAME_CATALOG,
  TIME_CONTROLS,
  chessGame,
  type ErrorCode,
  type GameDefinition,
  type GameType,
  type MoveResult,
  type RoomOptions,
  type RoomStatus,
  type RoomView,
} from '@vg/shared';

// To add a game: write its GameDefinition in shared/src/games and register it here.
const GAMES: Partial<Record<GameType, GameDefinition<any, any, any>>> = {
  chess: chessGame,
};

interface Player {
  id: string;
  name: string;
}

export interface Room {
  code: string;
  gameType: GameType;
  hostId: string;
  players: Player[];
  status: RoomStatus;
  options: RoomOptions;
  state: unknown;
  lastActivity: number;
}

export interface RoomManagerOptions {
  // Injectable so tests can control time.
  clock?: () => number;
  // Called when the server changes a room on its own (e.g. a clock runs out).
  onAutoUpdate?: (room: Room) => void;
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: ErrorCode };

// Leaves out look-alike characters (0/O, 1/I/L) so codes are easy to read aloud.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_NAME_LENGTH = 20;

export class RoomManager {
  private rooms = new Map<string, Room>();
  private playerRoom = new Map<string, string>();

  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly clock: () => number;
  private readonly onAutoUpdate: (room: Room) => void;

  constructor({ clock = Date.now, onAutoUpdate = () => {} }: RoomManagerOptions = {}) {
    this.clock = clock;
    this.onAutoUpdate = onAutoUpdate;
  }

  private ctx() {
    return { now: this.clock() };
  }

  roomOf(playerId: string): Room | undefined {
    const code = this.playerRoom.get(playerId);
    return code ? this.rooms.get(code) : undefined;
  }

  create(playerId: string, name: string, gameType: GameType): Result<{ room: Room; left?: Room }> {
    const info = GAME_CATALOG[gameType];
    if (!info || !info.available || !GAMES[gameType]) {
      return { ok: false, error: 'GAME_UNAVAILABLE' };
    }
    const cleanName = sanitizeName(name);
    if (!cleanName) return { ok: false, error: 'NAME_REQUIRED' };

    const left = this.leave(playerId);
    const room: Room = {
      code: this.newCode(),
      gameType,
      hostId: playerId,
      players: [{ id: playerId, name: cleanName }],
      status: 'waiting',
      options: { ...DEFAULT_ROOM_OPTIONS },
      state: null,
      lastActivity: Date.now(),
    };
    this.rooms.set(room.code, room);
    this.playerRoom.set(playerId, room.code);
    return { ok: true, room, left };
  }

  join(playerId: string, name: string, code: string): Result<{ room: Room; left?: Room }> {
    const room = this.rooms.get(code.trim().toUpperCase());
    if (!room) return { ok: false, error: 'ROOM_NOT_FOUND' };

    // Already a member (e.g. reopened the tab): let them straight back in.
    if (room.players.some((p) => p.id === playerId)) return { ok: true, room };

    const cleanName = sanitizeName(name);
    if (!cleanName) return { ok: false, error: 'NAME_REQUIRED' };
    if (room.status === 'playing') return { ok: false, error: 'ROOM_IN_GAME' };
    if (room.players.length >= GAME_CATALOG[room.gameType].maxPlayers) {
      return { ok: false, error: 'ROOM_FULL' };
    }

    const left = this.leave(playerId);
    room.players.push({ id: playerId, name: cleanName });
    room.lastActivity = Date.now();
    this.playerRoom.set(playerId, room.code);
    return { ok: true, room, left };
  }

  // Returns the room that was left (if anyone remains) so the others can be notified.
  leave(playerId: string): Room | undefined {
    const room = this.roomOf(playerId);
    if (!room) return undefined;
    this.playerRoom.delete(playerId);

    if (room.status === 'playing') {
      room.state = GAMES[room.gameType]!.forfeit(room.state, playerId, this.ctx());
      room.status = 'finished';
      this.armTimer(room);
    }
    room.players = room.players.filter((p) => p.id !== playerId);
    room.lastActivity = Date.now();

    if (room.players.length === 0) {
      this.deleteRoom(room);
      return undefined;
    }
    if (room.hostId === playerId) room.hostId = room.players[0].id;
    return room;
  }

  start(playerId: string): Result<{ room: Room }> {
    const room = this.roomOf(playerId);
    if (!room) return { ok: false, error: 'NOT_IN_ROOM' };
    if (room.hostId !== playerId) return { ok: false, error: 'NOT_HOST' };
    if (room.status === 'playing') return { ok: false, error: 'GAME_IN_PROGRESS' };
    const info = GAME_CATALOG[room.gameType];
    if (room.players.length < info.minPlayers) {
      return { ok: false, error: 'NOT_ENOUGH_PLAYERS' };
    }

    room.state = GAMES[room.gameType]!.setup(room.players.map((p) => p.id), room.options, this.ctx());
    room.status = 'playing';
    room.lastActivity = Date.now();
    this.armTimer(room);
    return { ok: true, room };
  }

  setOptions(playerId: string, options: unknown): Result<{ room: Room }> {
    const room = this.roomOf(playerId);
    if (!room) return { ok: false, error: 'NOT_IN_ROOM' };
    if (room.hostId !== playerId) return { ok: false, error: 'NOT_HOST' };
    if (room.status === 'playing') return { ok: false, error: 'GAME_IN_PROGRESS' };
    const timeControl = (options as Partial<RoomOptions> | null)?.timeControl;
    if (typeof timeControl !== 'string' || !Object.hasOwn(TIME_CONTROLS, timeControl)) {
      return { ok: false, error: 'INVALID_OPTIONS' };
    }
    room.options = { ...room.options, timeControl };
    room.lastActivity = Date.now();
    return { ok: true, room };
  }

  move(playerId: string, move: unknown): Result<{ room: Room }> {
    const room = this.roomOf(playerId);
    if (!room) return { ok: false, error: 'NOT_IN_ROOM' };
    if (room.status !== 'playing') return { ok: false, error: 'GAME_NOT_STARTED' };

    const game = GAMES[room.gameType]!;
    let result: MoveResult<unknown>;
    try {
      result = game.applyMove(room.state, playerId, move, this.ctx());
    } catch {
      // Client input is untrusted: a malformed move must not crash the server.
      return { ok: false, error: 'INVALID_MOVE' };
    }
    if (!result.ok) return result;

    room.state = result.state;
    if (game.isOver(room.state)) room.status = 'finished';
    room.lastActivity = Date.now();
    this.armTimer(room);
    return { ok: true, room };
  }

  view(room: Room, playerId: string, isConnected: (id: string) => boolean): RoomView {
    return {
      code: room.code,
      gameType: room.gameType,
      hostId: room.hostId,
      status: room.status,
      options: room.options,
      players: room.players.map((p) => ({ ...p, connected: isConnected(p.id) })),
      game: room.state === null ? null : GAMES[room.gameType]!.playerView(room.state, playerId, this.ctx()),
    };
  }

  // Drops rooms whose players have all been gone for a while.
  sweep(isConnected: (id: string) => boolean, idleMs: number): void {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (now - room.lastActivity < idleMs) continue;
      if (room.players.some((p) => isConnected(p.id))) continue;
      for (const p of room.players) this.playerRoom.delete(p.id);
      this.deleteRoom(room);
    }
  }

  // Schedules the next clock check for a room, replacing any earlier one.
  private armTimer(room: Room): void {
    clearTimeout(this.timers.get(room.code));
    this.timers.delete(room.code);
    const game = GAMES[room.gameType]!;
    if (room.status !== 'playing' || !game.deadline) return;
    const deadline = game.deadline(room.state);
    if (deadline === null) return;
    const timer = setTimeout(() => this.checkClock(room), Math.max(0, deadline - this.clock()));
    timer.unref?.();
    this.timers.set(room.code, timer);
  }

  private checkClock(room: Room): void {
    this.timers.delete(room.code);
    const game = GAMES[room.gameType]!;
    if (this.rooms.get(room.code) !== room || room.status !== 'playing' || !game.timeout) return;
    room.state = game.timeout(room.state, this.ctx());
    if (game.isOver(room.state)) {
      room.status = 'finished';
      room.lastActivity = Date.now();
      this.onAutoUpdate(room);
    } else {
      // Timers can fire a little early; check again at the real deadline.
      this.armTimer(room);
    }
  }

  private deleteRoom(room: Room): void {
    clearTimeout(this.timers.get(room.code));
    this.timers.delete(room.code);
    this.rooms.delete(room.code);
  }

  private newCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < 4; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
  }
}

function sanitizeName(name: unknown): string {
  return typeof name === 'string' ? name.trim().slice(0, MAX_NAME_LENGTH) : '';
}
