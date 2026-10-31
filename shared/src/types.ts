import type { ErrorCode } from './protocol';

export type GameType = 'chess' | 'xiangqi' | 'tienlen' | 'typhu';

export interface GameInfo {
  type: GameType;
  minPlayers: number;
  maxPlayers: number;
  available: boolean;
}

// Games shown in the lobby. Flip `available` once a game has both rules and a UI.
// Display names live in the client locale files.
export const GAME_CATALOG: Record<GameType, GameInfo> = {
  chess: { type: 'chess', minPlayers: 2, maxPlayers: 2, available: true },
  xiangqi: { type: 'xiangqi', minPlayers: 2, maxPlayers: 2, available: false },
  tienlen: { type: 'tienlen', minPlayers: 2, maxPlayers: 4, available: false },
  typhu: { type: 'typhu', minPlayers: 2, maxPlayers: 6, available: false },
};

export type TimeControlId = 'none' | '3+2' | '5+0' | '10+0' | '15+10';

export interface TimeControl {
  initialMs: number;
  incrementMs: number;
}

// Presets offered in the waiting room; `none` means untimed.
export const TIME_CONTROLS: Record<TimeControlId, TimeControl | null> = {
  none: null,
  '3+2': { initialMs: 3 * 60_000, incrementMs: 2_000 },
  '5+0': { initialMs: 5 * 60_000, incrementMs: 0 },
  '10+0': { initialMs: 10 * 60_000, incrementMs: 0 },
  '15+10': { initialMs: 15 * 60_000, incrementMs: 10_000 },
};

// Settings the host picks before starting a game.
export interface RoomOptions {
  timeControl: TimeControlId;
}

export const DEFAULT_ROOM_OPTIONS: RoomOptions = { timeControl: '10+0' };

export interface PlayerInfo {
  id: string;
  name: string;
  connected: boolean;
}

export type RoomStatus = 'waiting' | 'playing' | 'finished';

export interface ChatMessage {
  id: number;
  playerId: string;
  name: string;
  text: string;
  at: number;
}

export const MAX_CHAT_LENGTH = 200;

// What a single player sees of a room. `game` is the game's playerView() output:
// the server only sends what this player is allowed to know (e.g. their own hand).
export interface RoomView {
  // Public id of the player this view was built for.
  you: string;
  code: string;
  gameType: GameType;
  hostId: string;
  players: PlayerInfo[];
  spectators: PlayerInfo[];
  status: RoomStatus;
  options: RoomOptions;
  chat: ChatMessage[];
  game: unknown;
}

export type MoveResult<S> = { ok: true; state: S } | { ok: false; error: ErrorCode };

// Server-supplied context, so game logic stays pure and testable with a fake clock.
export interface GameContext {
  now: number;
}

// Each game is a set of pure functions: the server owns the real state,
// clients only ever receive playerView.
export interface GameDefinition<S, M, V> {
  type: GameType;
  setup(playerIds: string[], options: RoomOptions, ctx: GameContext): S;
  applyMove(state: S, playerId: string, move: M, ctx: GameContext): MoveResult<S>;
  // Called when a player deliberately leaves mid-game.
  forfeit(state: S, playerId: string, ctx: GameContext): S;
  isOver(state: S): boolean;
  // Spectators get a view too; their playerId is simply not one of the players.
  playerView(state: S, playerId: string, ctx: GameContext): V;
  // Absolute time (ms) at which the side to move runs out of time; null when no clock is running.
  deadline?(state: S): number | null;
  // Settles a flag fall once the deadline has passed; returns the state unchanged otherwise.
  timeout?(state: S, ctx: GameContext): S;
}
