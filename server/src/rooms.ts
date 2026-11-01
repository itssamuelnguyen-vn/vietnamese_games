import { randomInt } from 'node:crypto';
import {
  DEFAULT_ROOM_OPTIONS,
  GAME_CATALOG,
  HANDICAPS,
  HOUSE_RULES,
  MAX_CHAT_LENGTH,
  TIME_CONTROLS,
  TURN_TIMERS,
  chessGame,
  tienlenGame,
  typhuGame,
  caroGame,
  caNguaGame,
  createWordChainGame,
  CARO_SIZE_IDS,
  CANGUA_RULES,
  xiangqiGame,
  type ChatMessage,
  type TallyEntry,
  ABANDON_CLAIM_MS,
  type ErrorCode,
  type HostColor,
  type GameDefinition,
  type GameType,
  type MoveResult,
  type RoomOptions,
  type RoomStatus,
  type RoomView,
} from '@vg/shared';
import { loadDictionary } from './dictionaries';

// To add a game: write its GameDefinition in shared/src/games and register it here.
const GAMES: Partial<Record<GameType, GameDefinition<any, any, any>>> = {
  chess: chessGame,
  xiangqi: xiangqiGame,
  tienlen: tienlenGame,
  typhu: typhuGame,
  caro: caroGame,
  cangua: caNguaGame,
  noitu: createWordChainGame('noitu', loadDictionary('vi', 'noitu-words.txt')),
  wordchain: createWordChainGame('wordchain', loadDictionary('en', 'wordchain-words.txt', 'wordchain-common.txt')),
};

// Uniform in [0, 1) from the OS CSPRNG, so card deals can't be predicted.
const secureRandom = () => randomInt(2 ** 32) / 2 ** 32;

interface Player {
  id: string;
  name: string;
  bot?: boolean;
}

// Bot ids contain a colon, which real (base64url) player ids never do.
const BOT_PREFIX = 'bot:';
const isBot = (id: string) => id.startsWith(BOT_PREFIX);

export interface Room {
  code: string;
  gameType: GameType;
  hostId: string;
  players: Player[];
  spectators: Player[];
  // Players who left mid-game; cleared when the next game starts.
  departed: Player[];
  // Running scoreboard, and whether the current game has been added to it.
  tally: Record<string, TallyEntry>;
  tallied: boolean;
  status: RoomStatus;
  options: RoomOptions;
  state: unknown;
  rematchVotes: string[];
  chat: ChatMessage[];
  lastActivity: number;
}

export interface RoomManagerOptions {
  // Injectable so tests can control time.
  clock?: () => number;
  // Called when the server changes a room on its own (e.g. a clock runs out).
  onAutoUpdate?: (room: Room) => void;
  // Upper bound on open rooms, so room spam can't exhaust memory.
  maxRooms?: number;
  // Injectable for deterministic tests; defaults to a cryptographic source.
  random?: () => number;
  // Pause before each bot move, so people can follow what bots do.
  botDelayMs?: number;
  // Called with the people still in a room that just closed, so they can be told.
  onClosed?: (memberIds: string[]) => void;
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: ErrorCode };

// Leaves out look-alike characters (0/O, 1/I/L) so codes are easy to read aloud.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const MAX_NAME_LENGTH = 20;
const MAX_SPECTATORS = 20;
const HOST_COLORS: HostColor[] = ['random', 'white', 'black'];
const CHAT_HISTORY = 50;
// Chat flood control: at most CHAT_BURST messages per CHAT_WINDOW_MS per person.
const CHAT_BURST = 5;
const CHAT_WINDOW_MS = 10_000;
const DEFAULT_BOT_DELAY_MS = 900;

export class RoomManager {
  private rooms = new Map<string, Room>();
  private playerRoom = new Map<string, string>();

  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private botTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Per room, the latest busyUntil that bots have already waited for.
  private botWaitedFor = new Map<string, number>();
  private chatTimes = new Map<string, number[]>();
  private nextMessageId = 1;
  private readonly clock: () => number;
  private readonly onAutoUpdate: (room: Room) => void;
  private readonly maxRooms: number;
  private readonly random: () => number;
  private readonly botDelayMs: number;
  private readonly onClosed: (memberIds: string[]) => void;

  constructor({
    clock = Date.now,
    onAutoUpdate = () => {},
    maxRooms = 1000,
    random = secureRandom,
    botDelayMs = DEFAULT_BOT_DELAY_MS,
    onClosed = () => {},
  }: RoomManagerOptions = {}) {
    this.clock = clock;
    this.onAutoUpdate = onAutoUpdate;
    this.maxRooms = maxRooms;
    this.random = random;
    this.botDelayMs = botDelayMs;
    this.onClosed = onClosed;
  }

  private ctx() {
    return { now: this.clock(), random: this.random };
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
    if (this.rooms.size >= this.maxRooms) return { ok: false, error: 'SERVER_FULL' };

    const left = this.leave(playerId);
    const room: Room = {
      code: this.newCode(),
      gameType,
      hostId: playerId,
      players: [{ id: playerId, name: cleanName }],
      spectators: [],
      departed: [],
      tally: {},
      tallied: false,
      status: 'waiting',
      options: { ...DEFAULT_ROOM_OPTIONS },
      state: null,
      rematchVotes: [],
      chat: [],
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
    if (isMember(room, playerId)) return { ok: true, room };

    const cleanName = sanitizeName(name);
    if (!cleanName) return { ok: false, error: 'NAME_REQUIRED' };
    // Free seat between games: sit down. Otherwise watch.
    const seatFree = room.status !== 'playing' && room.players.length < GAME_CATALOG[room.gameType].maxPlayers;
    if (!seatFree && room.spectators.length >= MAX_SPECTATORS) return { ok: false, error: 'ROOM_FULL' };

    const left = this.leave(playerId);
    (seatFree ? room.players : room.spectators).push({ id: playerId, name: cleanName });
    room.lastActivity = Date.now();
    this.playerRoom.set(playerId, room.code);
    return { ok: true, room, left };
  }

  // Returns the room that was left (if anyone remains) so the others can be notified.
  leave(playerId: string): Room | undefined {
    const room = this.roomOf(playerId);
    if (!room) return undefined;
    this.playerRoom.delete(playerId);
    this.chatTimes.delete(playerId);

    if (room.spectators.some((p) => p.id === playerId)) {
      room.spectators = room.spectators.filter((p) => p.id !== playerId);
      return room;
    }

    if (room.status === 'playing') {
      const leaving = room.players.find((p) => p.id === playerId);
      if (leaving) room.departed = [...room.departed, leaving];
      const game = GAMES[room.gameType]!;
      room.state = game.forfeit(room.state, playerId, this.ctx(), 'left');
      // Two-player games end; in bigger games the others play on.
      if (game.isOver(room.state)) room.status = 'finished';
      this.settle(room);
      this.armTimer(room);
    }
    room.players = room.players.filter((p) => p.id !== playerId);
    room.rematchVotes = [];
    room.lastActivity = Date.now();
    this.fillSeats(room);

    // Bots don't keep a room alive.
    const people = room.players.filter((p) => !p.bot);
    if (people.length === 0) {
      const watchers = room.spectators.map((p) => p.id);
      for (const id of watchers) this.playerRoom.delete(id);
      this.deleteRoom(room);
      if (watchers.length) this.onClosed(watchers);
      return undefined;
    }
    if (room.hostId === playerId) room.hostId = people[0].id;
    this.scheduleBots(room);
    return room;
  }

  // The host can fill empty seats with computer players between games.
  addBot(playerId: string): Result<{ room: Room }> {
    const room = this.roomOf(playerId);
    if (!room) return { ok: false, error: 'NOT_IN_ROOM' };
    if (room.hostId !== playerId) return { ok: false, error: 'NOT_HOST' };
    if (room.status === 'playing') return { ok: false, error: 'GAME_IN_PROGRESS' };
    if (!GAMES[room.gameType]?.botMove) return { ok: false, error: 'GAME_UNAVAILABLE' };
    if (room.players.length >= GAME_CATALOG[room.gameType].maxPlayers) return { ok: false, error: 'ROOM_FULL' };
    let n = 1;
    while (room.players.some((p) => p.id === `${BOT_PREFIX}${n}`)) n++;
    room.players.push({ id: `${BOT_PREFIX}${n}`, name: `Bot ${n}`, bot: true });
    room.rematchVotes = [];
    room.lastActivity = Date.now();
    return { ok: true, room };
  }

  removeBot(playerId: string, botId: unknown): Result<{ room: Room }> {
    const room = this.roomOf(playerId);
    if (!room) return { ok: false, error: 'NOT_IN_ROOM' };
    if (room.hostId !== playerId) return { ok: false, error: 'NOT_HOST' };
    if (room.status === 'playing') return { ok: false, error: 'GAME_IN_PROGRESS' };
    if (typeof botId !== 'string' || !isBot(botId) || !room.players.some((p) => p.id === botId)) return { ok: false, error: 'INVALID_MOVE' };
    room.players = room.players.filter((p) => p.id !== botId);
    room.rematchVotes = [];
    this.fillSeats(room);
    room.lastActivity = Date.now();
    return { ok: true, room };
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

    // Host first, so games can honour the host's chosen side.
    const ids = [room.hostId, ...room.players.map((p) => p.id).filter((id) => id !== room.hostId)];
    const game = GAMES[room.gameType]!;
    room.state = game.setup(ids, room.options, this.ctx(), room.state);
    room.rematchVotes = [];
    room.departed = [];
    room.tallied = false;
    // A game can be decided on the deal (tien len instant wins).
    room.status = game.isOver(room.state) ? 'finished' : 'playing';
    this.settle(room);
    room.lastActivity = Date.now();
    this.armTimer(room);
    this.scheduleBots(room);
    return { ok: true, room };
  }

  setOptions(playerId: string, options: unknown): Result<{ room: Room }> {
    const room = this.roomOf(playerId);
    if (!room) return { ok: false, error: 'NOT_IN_ROOM' };
    if (room.hostId !== playerId) return { ok: false, error: 'NOT_HOST' };
    if (room.status === 'playing') return { ok: false, error: 'GAME_IN_PROGRESS' };
    if (typeof options !== 'object' || options === null) return { ok: false, error: 'INVALID_OPTIONS' };
    const {
      timeControl = room.options.timeControl,
      hostColor = room.options.hostColor,
      handicap = room.options.handicap,
      turnTimer = room.options.turnTimer,
      houseRules = room.options.houseRules,
      caroSize = room.options.caroSize,
      caroBlock = room.options.caroBlock,
      caNguaRules = room.options.caNguaRules,
    } = options as Partial<RoomOptions>;
    if (typeof timeControl !== 'string' || !Object.hasOwn(TIME_CONTROLS, timeControl)) {
      return { ok: false, error: 'INVALID_OPTIONS' };
    }
    if (!HOST_COLORS.includes(hostColor) || !HANDICAPS.includes(handicap)) return { ok: false, error: 'INVALID_OPTIONS' };
    if (typeof turnTimer !== 'string' || !Object.hasOwn(TURN_TIMERS, turnTimer)) return { ok: false, error: 'INVALID_OPTIONS' };
    if (!Array.isArray(houseRules) || !houseRules.every((r) => HOUSE_RULES.includes(r))) return { ok: false, error: 'INVALID_OPTIONS' };
    if (!CARO_SIZE_IDS.includes(caroSize) || typeof caroBlock !== 'boolean') return { ok: false, error: 'INVALID_OPTIONS' };
    if (!Array.isArray(caNguaRules) || !caNguaRules.every((r) => CANGUA_RULES.includes(r))) return { ok: false, error: 'INVALID_OPTIONS' };
    room.options = {
      ...room.options,
      timeControl,
      hostColor,
      handicap,
      turnTimer,
      houseRules: [...new Set(houseRules)],
      caroSize,
      caroBlock,
      caNguaRules: [...new Set(caNguaRules)],
    };
    room.lastActivity = Date.now();
    return { ok: true, room };
  }

  move(playerId: string, move: unknown): Result<{ room: Room }> {
    const room = this.roomOf(playerId);
    if (!room) return { ok: false, error: 'NOT_IN_ROOM' };
    return this.play(room, playerId, move);
  }

  private play(room: Room, playerId: string, move: unknown): Result<{ room: Room }> {
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
    this.settle(room);
    room.lastActivity = Date.now();
    this.armTimer(room);
    this.scheduleBots(room);
    return { ok: true, room };
  }

  // Any seated player can ask for another game; it starts once every seat has asked.
  requestRematch(playerId: string): Result<{ room: Room }> {
    const room = this.roomOf(playerId);
    if (!room) return { ok: false, error: 'NOT_IN_ROOM' };
    if (!room.players.some((p) => p.id === playerId)) return { ok: false, error: 'NOT_A_PLAYER' };
    if (room.status !== 'finished') return { ok: false, error: 'GAME_IN_PROGRESS' };
    if (!room.rematchVotes.includes(playerId)) room.rematchVotes = [...room.rematchVotes, playerId];
    // Bots are always up for another game.
    if (room.players.every((p) => p.bot || room.rematchVotes.includes(p.id))) return this.start(room.hostId);
    return { ok: true, room };
  }

  // A seated player may remove opponents who have been offline long enough: in a two-player game
  // that is claiming the win; in bigger games the absent players rank last and the rest play on.
  claimWin(playerId: string, offlineSince: (id: string) => number | null): Result<{ room: Room }> {
    const room = this.roomOf(playerId);
    if (!room) return { ok: false, error: 'NOT_IN_ROOM' };
    if (!room.players.some((p) => p.id === playerId)) return { ok: false, error: 'NOT_A_PLAYER' };
    if (room.status !== 'playing') return { ok: false, error: 'GAME_NOT_STARTED' };
    const now = this.clock();
    const absent = room.players.filter((p) => {
      const since = p.id === playerId ? null : offlineSince(p.id);
      return since !== null && now - since >= ABANDON_CLAIM_MS;
    });
    if (absent.length === 0) return { ok: false, error: 'CLAIM_TOO_EARLY' };
    const game = GAMES[room.gameType]!;
    for (const p of absent) room.state = game.forfeit(room.state, p.id, this.ctx(), 'abandoned');
    // The absent players lose their seats, so they can't hold up rematches or keep others waiting.
    room.players = room.players.filter((p) => !absent.includes(p));
    room.departed = [...room.departed, ...absent];
    room.rematchVotes = [];
    for (const p of absent) {
      this.playerRoom.delete(p.id);
      this.chatTimes.delete(p.id);
    }
    if (absent.some((p) => p.id === room.hostId)) room.hostId = playerId;
    if (game.isOver(room.state)) room.status = 'finished';
    this.settle(room);
    room.lastActivity = Date.now();
    this.armTimer(room);
    this.scheduleBots(room);
    return { ok: true, room };
  }

  chat(playerId: string, text: unknown): Result<{ room: Room }> {
    const room = this.roomOf(playerId);
    if (!room) return { ok: false, error: 'NOT_IN_ROOM' };
    const clean = typeof text === 'string' ? text.trim().slice(0, MAX_CHAT_LENGTH) : '';
    if (!clean) return { ok: false, error: 'MESSAGE_INVALID' };

    const now = this.clock();
    const recent = (this.chatTimes.get(playerId) ?? []).filter((t) => now - t < CHAT_WINDOW_MS);
    if (recent.length >= CHAT_BURST) return { ok: false, error: 'MESSAGE_TOO_FAST' };
    this.chatTimes.set(playerId, [...recent, now]);

    const author = [...room.players, ...room.spectators].find((p) => p.id === playerId)!;
    room.chat = [...room.chat, { id: this.nextMessageId++, playerId, name: author.name, text: clean, at: now }].slice(
      -CHAT_HISTORY,
    );
    room.lastActivity = Date.now();
    return { ok: true, room };
  }

  view(
    room: Room,
    playerId: string,
    isConnected: (id: string) => boolean,
    offlineSince: (id: string) => number | null = () => null,
  ): RoomView {
    const now = this.clock();
    const info = ({ id, name, bot = false }: Player) => {
      const connected = bot || isConnected(id);
      const since = connected ? null : offlineSince(id);
      return { id, name, bot, connected, offlineMs: since === null ? null : Math.max(0, now - since) };
    };
    return {
      you: playerId,
      code: room.code,
      gameType: room.gameType,
      hostId: room.hostId,
      status: room.status,
      options: room.options,
      players: room.players.map(info),
      spectators: room.spectators.map(info),
      departed: room.departed.map(({ id, name }) => ({ id, name })),
      tally: Object.values(room.tally).sort((a, b) => b.points - a.points || b.wins - a.wins),
      rematchVotes: room.rematchVotes,
      chat: room.chat,
      game: room.state === null ? null : GAMES[room.gameType]!.playerView(room.state, playerId, this.ctx()),
    };
  }

  // Drops rooms whose players have all been gone for a while.
  sweep(isConnected: (id: string) => boolean, idleMs: number): void {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      if (now - room.lastActivity < idleMs) continue;
      const members = [...room.players, ...room.spectators].filter((p) => !p.bot);
      if (members.some((p) => isConnected(p.id))) continue;
      for (const p of members) {
        this.playerRoom.delete(p.id);
        this.chatTimes.delete(p.id);
      }
      this.deleteRoom(room);
    }
  }

  // Adds a finished game to the room's scoreboard, once.
  private settle(room: Room): void {
    if (room.status !== 'finished' || room.tallied) return;
    room.tallied = true;
    // Spectators who arrived mid-game take the free seats, oldest first.
    this.fillSeats(room);
    const scores = GAMES[room.gameType]!.points?.(room.state);
    if (!scores) return;
    for (const [id, { points, place }] of Object.entries(scores)) {
      const name = [...room.players, ...room.departed].find((p) => p.id === id)?.name ?? room.tally[id]?.name ?? '?';
      const prev = room.tally[id] ?? { id, name, games: 0, wins: 0, points: 0 };
      room.tally[id] = { ...prev, name, games: prev.games + 1, wins: prev.wins + (place === 1 ? 1 : 0), points: prev.points + points };
    }
  }

  // Spectators take free seats between games, oldest first.
  private fillSeats(room: Room): void {
    const max = GAME_CATALOG[room.gameType].maxPlayers;
    while (room.status !== 'playing' && room.players.length < max && room.spectators.length > 0) {
      room.players.push(room.spectators.shift()!);
    }
  }

  // Schedules the next clock check for a room, replacing any earlier one.
  // `minDelay` keeps a deadline that didn't move the game on from being re-checked in a tight loop.
  private armTimer(room: Room, minDelay = 0): void {
    clearTimeout(this.timers.get(room.code));
    this.timers.delete(room.code);
    const game = GAMES[room.gameType]!;
    if (room.status !== 'playing' || !game.deadline) return;
    const deadline = game.deadline(room.state);
    if (deadline === null) return;
    const timer = setTimeout(() => this.checkClock(room), Math.max(minDelay, deadline - this.clock()));
    timer.unref?.();
    this.timers.set(room.code, timer);
  }

  private checkClock(room: Room): void {
    this.timers.delete(room.code);
    const game = GAMES[room.gameType]!;
    if (this.rooms.get(room.code) !== room || room.status !== 'playing' || !game.timeout) return;
    const before = room.state;
    room.state = game.timeout(room.state, this.ctx());
    // A timeout can end the game (chess flag) or just move it on (an automatic pass).
    if (room.state !== before) {
      if (game.isOver(room.state)) room.status = 'finished';
      this.settle(room);
      room.lastActivity = Date.now();
      this.onAutoUpdate(room);
      this.scheduleBots(room);
    }
    // Timers can fire a little early; this re-checks at the real deadline, or arms the next turn's.
    // If the deadline has passed and nothing changed, back off rather than spin.
    const stalled = room.state === before && (game.deadline?.(room.state) ?? Infinity) <= this.clock();
    this.armTimer(room, stalled ? 1000 : 0);
  }

  // A host who has been offline for a while hands the room to someone who is here, so games
  // can still be started.
  handOffHost(playerId: string, isConnected: (id: string) => boolean): Room | undefined {
    const room = this.roomOf(playerId);
    if (!room || room.hostId !== playerId || isConnected(playerId)) return undefined;
    const next = room.players.find((p) => !p.bot && isConnected(p.id));
    if (!next) return undefined;
    room.hostId = next.id;
    return room;
  }

  // After every change, the first bot with something to do acts after a short pause. A pending
  // pause is kept rather than restarted, so a stream of moves from people can't hold bots back;
  // the bot decides on the state as it is when the pause ends. Paced games (strictly turn-based, with
  // animated moves) restart the pause instead, so a bot never acts while the last move still plays out.
  // Games that report when clients finish animating (busyUntil) also hold bots until then.
  private scheduleBots(room: Room, delay?: number): void {
    const game = GAMES[room.gameType]!;
    if (game.botPace && this.botTimers.has(room.code)) {
      clearTimeout(this.botTimers.get(room.code));
      this.botTimers.delete(room.code);
    }
    if (this.botTimers.has(room.code) || room.status !== 'playing' || !game.botMove || !room.players.some((p) => p.bot)) return;
    const timer = setTimeout(() => {
      this.botTimers.delete(room.code);
      if (this.rooms.get(room.code) !== room || room.status !== 'playing') return;
      // A change during the pause may have started a new animation (a roll, a new month): wait for it too.
      const busy = this.busyWait(room);
      if (busy > 0) return this.scheduleBots(room, busy);
      for (const bot of room.players.filter((p) => p.bot)) {
        let move: unknown;
        try {
          move = game.botMove!(room.state, bot.id, this.ctx());
        } catch {
          continue;
        }
        if (move && this.play(room, bot.id, move).ok) {
          this.onAutoUpdate(room);
          return;
        }
      }
    }, Math.max(delay ?? this.botDelayMs * (game.botPace ?? 1), this.busyWait(room)));
    timer.unref?.();
    this.botTimers.set(room.code, timer);
  }

  // How much longer bots should wait for clients to finish animating, if they haven't waited for
  // this animation yet. Scaled like the bot pause, so tests that shorten the pause aren't held up.
  private busyWait(room: Room): number {
    const until = GAMES[room.gameType]!.busyUntil?.(room.state) ?? null;
    if (until === null || until <= (this.botWaitedFor.get(room.code) ?? -Infinity)) return 0;
    this.botWaitedFor.set(room.code, until);
    return Math.max(0, until - this.clock()) * (this.botDelayMs / DEFAULT_BOT_DELAY_MS);
  }

  private deleteRoom(room: Room): void {
    clearTimeout(this.timers.get(room.code));
    this.timers.delete(room.code);
    clearTimeout(this.botTimers.get(room.code));
    this.botTimers.delete(room.code);
    this.botWaitedFor.delete(room.code);
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

function isMember(room: Room, playerId: string): boolean {
  return room.players.some((p) => p.id === playerId) || room.spectators.some((p) => p.id === playerId);
}
