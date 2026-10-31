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

export interface PlayerInfo {
  id: string;
  name: string;
  connected: boolean;
}

export type RoomStatus = 'waiting' | 'playing' | 'finished';

// What a single player sees of a room. `game` is the game's playerView() output:
// the server only sends what this player is allowed to know (e.g. their own hand).
export interface RoomView {
  code: string;
  gameType: GameType;
  hostId: string;
  players: PlayerInfo[];
  status: RoomStatus;
  game: unknown;
}

export type MoveResult<S> = { ok: true; state: S } | { ok: false; error: ErrorCode };

// Each game is a set of pure functions: the server owns the real state,
// clients only ever receive playerView.
export interface GameDefinition<S, M, V> {
  type: GameType;
  setup(playerIds: string[]): S;
  applyMove(state: S, playerId: string, move: M): MoveResult<S>;
  // Called when a player deliberately leaves mid-game.
  forfeit(state: S, playerId: string): S;
  isOver(state: S): boolean;
  playerView(state: S, playerId: string): V;
}
