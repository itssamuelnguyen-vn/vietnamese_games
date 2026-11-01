import type { ErrorCode } from './protocol';

export type GameType =
  | 'chess'
  | 'xiangqi'
  | 'tienlen'
  | 'typhu'
  | 'caro'
  | 'cangua'
  | 'noitu'
  | 'wordchain'
  | 'masoi'
  | 'baucua'
  | 'xidach'
  | 'loto';

export interface GameInfo {
  type: GameType;
  minPlayers: number;
  maxPlayers: number;
  available: boolean;
  // Whether the host can fill seats with computer players.
  bots?: boolean;
  // Whether those bots come in levels of strength (BOT_LEVELS) for the host to pick from.
  botLevels?: boolean;
}

// How strong a bot plays, in games whose bots have levels.
export type BotLevel = 'easy' | 'medium' | 'hard';
export const BOT_LEVELS: BotLevel[] = ['easy', 'medium', 'hard'];
export const DEFAULT_BOT_LEVEL: BotLevel = 'medium';

// Games shown in the lobby. Flip `available` once a game has both rules and a UI.
// Display names live in the client locale files.
export const GAME_CATALOG: Record<GameType, GameInfo> = {
  chess: { type: 'chess', minPlayers: 2, maxPlayers: 2, available: true, bots: true, botLevels: true },
  xiangqi: { type: 'xiangqi', minPlayers: 2, maxPlayers: 2, available: true, bots: true, botLevels: true },
  tienlen: { type: 'tienlen', minPlayers: 2, maxPlayers: 4, available: true, bots: true },
  typhu: { type: 'typhu', minPlayers: 2, maxPlayers: 6, available: true, bots: true },
  caro: { type: 'caro', minPlayers: 2, maxPlayers: 2, available: true, bots: true, botLevels: true },
  cangua: { type: 'cangua', minPlayers: 2, maxPlayers: 4, available: true, bots: true },
  noitu: { type: 'noitu', minPlayers: 2, maxPlayers: 8, available: true, bots: true },
  wordchain: { type: 'wordchain', minPlayers: 2, maxPlayers: 8, available: true, bots: true },
  masoi: { type: 'masoi', minPlayers: 5, maxPlayers: 12, available: true, bots: true },
  baucua: { type: 'baucua', minPlayers: 2, maxPlayers: 10, available: true, bots: true },
  xidach: { type: 'xidach', minPlayers: 2, maxPlayers: 8, available: true, bots: true },
  loto: { type: 'loto', minPlayers: 2, maxPlayers: 16, available: true, bots: true },
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

// Optional cờ cá ngựa rules: jumping over other horses, climbing home by the full roll, and
// bringing a horse out on a 1 as well as a 6.
export type CaNguaRuleId = 'jump' | 'fast-home' | 'one-out';
export const CANGUA_RULES: CaNguaRuleId[] = ['jump', 'fast-home', 'one-out'];

// How fast the lô tô caller calls the numbers.
export type LotoSpeed = 'slow' | 'normal' | 'fast';
export const LOTO_SPEEDS: LotoSpeed[] = ['slow', 'normal', 'fast'];

// Ma sói: the special roles the host can put in the game (wolves and villagers are always in),
// how many wolves (0: chosen by the number of players), and how long the village talks each day.
export type MaSoiSpecialRole = 'seer' | 'guard' | 'witch' | 'hunter';
export const MASOI_SPECIAL_ROLES: MaSoiSpecialRole[] = ['seer', 'guard', 'witch', 'hunter'];
export const MASOI_WOLF_COUNTS = [0, 1, 2, 3, 4];
export type MaSoiTalk = 'short' | 'normal' | 'long';
export const MASOI_TALKS: MaSoiTalk[] = ['short', 'normal', 'long'];

// Settings the host picks before starting a game.
// How a room keeps score from game to game: points, or a play-money wallet per player (made-up
// numbers with no real-world value) that wins and losses move by points × the stake per point.
export type Stakes = 'points' | 'money';
export const STAKES: Stakes[] = ['points', 'money'];
export const WALLET_STARTS = [50_000, 100_000, 200_000, 500_000, 1_000_000];
export const STAKES_PER_POINT = [1_000, 2_000, 5_000, 10_000, 20_000];
// Games that can be played for play money. Tien len moves wallets by its points; xi dach and bau
// cua play with the wallets themselves as chips.
export const MONEY_GAMES: GameType[] = ['tienlen', 'xidach', 'baucua', 'loto'];

// In a room for money, chip games bet in multiples of this: a tenth of the room's stake.
export const chipUnit = (options: Pick<RoomOptions, 'stakePerPoint'>) => Math.max(1, Math.round(options.stakePerPoint / 10));

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
  // Caro: in the next game the loser moves first (X); otherwise, and after a draw, sides swap.
  caroLoserFirst: boolean;
  caNguaRules: CaNguaRuleId[];
  stakes: Stakes;
  // Play money each player's wallet starts with, and how much a point of a game's result is worth.
  walletStart: number;
  stakePerPoint: number;
  // Xi dach and bau cua: the seated player who deals and keeps the bank, or null for the house.
  dealer: string | null;
  // Lô tô: how fast numbers are called.
  callSpeed: LotoSpeed;
  // Ma sói: special roles in play, the number of wolves (0: automatic), whether a player's role is
  // shown when they die, and the length of the day's discussion.
  masoiRoles: MaSoiSpecialRole[];
  masoiWolves: number;
  masoiReveal: boolean;
  masoiTalk: MaSoiTalk;
}

export const DEFAULT_ROOM_OPTIONS: RoomOptions = {
  timeControl: '10+0',
  hostColor: 'random',
  handicap: 'none',
  turnTimer: '30',
  houseRules: [],
  caroSize: '15',
  caroBlock: true,
  caroLoserFirst: true,
  caNguaRules: [],
  stakes: 'points',
  walletStart: 200_000,
  stakePerPoint: 5_000,
  dealer: null,
  callSpeed: 'normal',
  masoiRoles: [...MASOI_SPECIAL_ROLES],
  masoiWolves: 0,
  masoiReveal: true,
  masoiTalk: 'normal',
};

export interface PlayerInfo {
  id: string;
  name: string;
  connected: boolean;
  // How long this player has been disconnected, as of when the view was built.
  offlineMs: number | null;
  // A computer player added by the host.
  bot: boolean;
  // How strong that bot plays, in games whose bots have levels.
  botLevel?: BotLevel;
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
  // A private channel within a game (ma sói: the wolves' night talk, the dead), or absent for
  // a message to the whole room.
  channel?: string;
}

// Where a person's chat goes during a game with private channels, and what they may read.
// 'public' is the whole room; null `send` means they can't talk right now (the village sleeps).
export interface ChatRoute {
  send: string | null;
  read: string[] | 'all';
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
  // Play-money balances, by player, when the room plays for money; null when it keeps points.
  // A player at 0 is broke and can only watch.
  wallets: Record<string, number> | null;
  chat: ChatMessage[];
  // The channel your next chat message goes to ('public' for the whole room), or null while you
  // can't talk (games with private channels, see GameDefinition.chatRoute).
  chatTo: string | null;
  // Voice chat: who is in it, and of those, who can hear you and who you can hear right now
  // (games with private channels route voice like chat).
  // `sessions`: each member's current voice session, which changes when they join again.
  voice: { members: string[]; to: string[]; from: string[]; sessions: Record<string, number> };
  game: unknown;
}

export type MoveResult<S> = { ok: true; state: S } | { ok: false; error: ErrorCode };

// Server-supplied context, so game logic stays pure and testable with a fake clock.
export interface GameContext {
  now: number;
  // Source of randomness for shuffling; the server passes a cryptographic one.
  random?: () => number;
  // For botMove in games whose bots have levels: how strong the bot asked to move plays
  // (DEFAULT_BOT_LEVEL when absent).
  botLevel?: BotLevel;
}

// Each game is a set of pure functions: the server owns the real state,
// clients only ever receive playerView.
export interface GameDefinition<S, M, V> {
  type: GameType;
  // playerIds[0] is the host; `previous` is the room's last game, if any (for rematches).
  // `wallets`: each player's play-money balance, when the room plays for money.
  setup(playerIds: string[], options: RoomOptions, ctx: GameContext, previous: S | null, wallets?: Record<string, number>): S;
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
  // Games played with the wallets as chips: what each player's wallet is once the game is over.
  // Other games move wallets by their points instead.
  walletsAfter?(state: S): Record<string, number> | null;
  // Games that support computer players: the bot's next move, or null while it has nothing to do.
  botMove?(state: S, playerId: string, ctx: GameContext): M | null;
  // How much longer than the room's usual pause bots wait before acting, for strictly turn-based
  // games whose client animates each move (a rolling die, a walking piece). The pause restarts on
  // every change, so it always counts from the latest move.
  botPace?: number;
  // The bot's move takes a CPU-heavy search (chess, xiangqi): the server works it out off its
  // main thread, so other rooms aren't held up meanwhile.
  heavyBot?: boolean;
  // Until when (absolute ms) clients are still animating the latest change, or null. Bots wait for
  // it before acting, so they don't move while people are still watching the last turn play out.
  busyUntil?(state: S): number | null;
  // Games with private chat channels (ma sói): where a player's or spectator's message goes while
  // the game is on, and which channels they may read. Without it everyone talks to the whole room.
  chatRoute?(state: S, playerId: string): ChatRoute;
}

export interface TallyEntry {
  id: string;
  name: string;
  games: number;
  wins: number;
  points: number;
}
