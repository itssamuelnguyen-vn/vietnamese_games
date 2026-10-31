import type { ErrorCode } from './protocol';

export type GameType =
  | 'chess'
  | 'xiangqi'
  | 'tienlen'
  | 'typhu'
  | 'caro'
  | 'cangua'
  | 'maubinh'
  | 'samloc'
  | 'colors'
  | 'noitu'
  | 'wordchain'
  | 'masoi'
  | 'baucua'
  | 'xidach';

export interface GameInfo {
  type: GameType;
  minPlayers: number;
  maxPlayers: number;
  available: boolean;
  // Whether the host can fill seats with computer players.
  bots?: boolean;
}

// Games shown in the lobby. Flip `available` once a game has both rules and a UI.
// Display names live in the client locale files.
export const GAME_CATALOG: Record<GameType, GameInfo> = {
  chess: { type: 'chess', minPlayers: 2, maxPlayers: 2, available: true },
  xiangqi: { type: 'xiangqi', minPlayers: 2, maxPlayers: 2, available: true },
  tienlen: { type: 'tienlen', minPlayers: 2, maxPlayers: 4, available: true },
  typhu: { type: 'typhu', minPlayers: 2, maxPlayers: 6, available: true, bots: true },
  caro: { type: 'caro', minPlayers: 2, maxPlayers: 2, available: true, bots: true },
  cangua: { type: 'cangua', minPlayers: 2, maxPlayers: 4, available: false },
  maubinh: { type: 'maubinh', minPlayers: 2, maxPlayers: 4, available: false },
  samloc: { type: 'samloc', minPlayers: 2, maxPlayers: 5, available: false },
  colors: { type: 'colors', minPlayers: 2, maxPlayers: 8, available: false },
  noitu: { type: 'noitu', minPlayers: 2, maxPlayers: 8, available: false },
  wordchain: { type: 'wordchain', minPlayers: 2, maxPlayers: 8, available: false },
  masoi: { type: 'masoi', minPlayers: 5, maxPlayers: 12, available: false },
  baucua: { type: 'baucua', minPlayers: 2, maxPlayers: 10, available: false },
  xidach: { type: 'xidach', minPlayers: 2, maxPlayers: 8, available: false },
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

export type HostColor = 'random' | 'white' | 'black';

// Pieces the host gives up at the start (xiangqi odds games); 'none' for an even game.
export type HandicapId = 'none' | 'chariot' | 'horse' | 'cannon' | 'two-horses';
export const HANDICAPS: HandicapId[] = ['none', 'chariot', 'horse', 'cannon', 'two-horses'];

// Per-turn time limit for card games; on expiry the player passes (or leads their lowest card).
export type TurnTimerId = 'none' | '15' | '30' | '60';
export const TURN_TIMERS: Record<TurnTimerId, number | null> = { none: null, '15': 15_000, '30': 30_000, '60': 60_000 };

// Optional tien len house rules the host can switch on.
export type HouseRuleId = 'no-two-finish' | 'no-stack-chop' | 'four-pairs-anytime' | 'penalties';
export const HOUSE_RULES: HouseRuleId[] = ['no-two-finish', 'no-stack-chop', 'four-pairs-anytime', 'penalties'];

// Caro board sizes (cells per side).
export type CaroSizeId = '15' | '19';
export const CARO_SIZE_IDS: CaroSizeId[] = ['15', '19'];

// Settings the host picks before starting a game.
export interface RoomOptions {
  timeControl: TimeControlId;
  // The host's side in the first game; rematches swap sides.
  hostColor: HostColor;
  handicap: HandicapId;
  turnTimer: TurnTimerId;
  houseRules: HouseRuleId[];
  caroSize: CaroSizeId;
  // Caro's "blocked at both ends" rule: a five stopped by the opponent at both ends doesn't win.
  caroBlock: boolean;
}

export const DEFAULT_ROOM_OPTIONS: RoomOptions = { timeControl: '10+0', hostColor: 'random', handicap: 'none', turnTimer: '30', houseRules: [], caroSize: '15', caroBlock: true };

export interface PlayerInfo {
  id: string;
  name: string;
  connected: boolean;
  // How long this player has been disconnected, as of when the view was built.
  offlineMs: number | null;
  // A computer player added by the host.
  bot: boolean;
}

// An opponent offline this long can be beaten by claiming the win.
export const ABANDON_CLAIM_MS = 60_000;

export type ForfeitReason = 'left' | 'abandoned';

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
  // Players who left during the current game, so logs and results can still name them.
  departed: { id: string; name: string }[];
  status: RoomStatus;
  options: RoomOptions;
  // Seated players who asked for another game.
  rematchVotes: string[];
  // Running scores across the games played in this room, best first.
  tally: TallyEntry[];
  chat: ChatMessage[];
  game: unknown;
}

export type MoveResult<S> = { ok: true; state: S } | { ok: false; error: ErrorCode };

// Server-supplied context, so game logic stays pure and testable with a fake clock.
export interface GameContext {
  now: number;
  // Source of randomness for shuffling; the server passes a cryptographic one.
  random?: () => number;
}

// Each game is a set of pure functions: the server owns the real state,
// clients only ever receive playerView.
export interface GameDefinition<S, M, V> {
  type: GameType;
  // playerIds[0] is the host; `previous` is the room's last game, if any (for rematches).
  setup(playerIds: string[], options: RoomOptions, ctx: GameContext, previous: S | null): S;
  applyMove(state: S, playerId: string, move: M, ctx: GameContext): MoveResult<S>;
  // A player left mid-game, or was offline long enough for the others to claim the win.
  forfeit(state: S, playerId: string, ctx: GameContext, reason: ForfeitReason): S;
  isOver(state: S): boolean;
  // Spectators get a view too; their playerId is simply not one of the players.
  playerView(state: S, playerId: string, ctx: GameContext): V;
  // Absolute time (ms) at which the side to move runs out of time; null when no clock is running.
  deadline?(state: S): number | null;
  // Settles a flag fall once the deadline has passed; returns the state unchanged otherwise.
  timeout?(state: S, ctx: GameContext): S;
  // Points each player earned in a finished game, for the room's running scoreboard.
  points?(state: S): Record<string, { points: number; place: number }> | null;
  // Games that support computer players: the bot's next move, or null while it has nothing to do.
  botMove?(state: S, playerId: string, ctx: GameContext): M | null;
}

export interface TallyEntry {
  id: string;
  name: string;
  games: number;
  wins: number;
  points: number;
}
