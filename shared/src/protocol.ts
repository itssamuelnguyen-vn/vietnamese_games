import type { BotLevel, GameType, RoomOptions, RoomView } from './types';

// Errors travel as codes; each client locale turns them into readable text.
export type ErrorCode =
  | 'GAME_UNAVAILABLE'
  | 'NAME_REQUIRED'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  | 'GAME_IN_PROGRESS'
  | 'NOT_ENOUGH_PLAYERS'
  | 'GAME_NOT_STARTED'
  | 'GAME_OVER'
  | 'NOT_A_PLAYER'
  | 'NOT_YOUR_TURN'
  | 'INVALID_MOVE'
  | 'INVALID_OPTIONS'
  | 'MESSAGE_INVALID'
  | 'MESSAGE_TOO_FAST'
  // A game with private channels has the chat closed for this person right now (ma sói at night).
  | 'CHAT_LOCKED'
  | 'RATE_LIMITED'
  | 'SERVER_FULL'
  | 'CLAIM_TOO_EARLY'
  | 'DISCONNECTED'
  // Word chain games: why a word was refused.
  | 'WORD_INVALID'
  | 'WORD_LINK'
  | 'WORD_UNKNOWN'
  | 'WORD_USED'
  | 'WORD_DEAD_END'
  // Co ti phu: a trade offer that isn't fair enough (see tradeProblem).
  | 'TRADE_UNFAIR';

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: ErrorCode };

export interface ClientToServerEvents {
  'room:create': (p: { gameType: GameType; name: string }, ack: (r: Ack<{ code: string }>) => void) => void;
  // `watch`: join as a spectator even when a seat is free.
  'room:join': (p: { code: string; name: string; watch?: boolean }, ack: (r: Ack<{ code: string }>) => void) => void;
  // Between games: a spectator takes a free seat, or a player gets up to watch.
  'room:sit': (ack: (r: Ack) => void) => void;
  'room:stand': (ack: (r: Ack) => void) => void;
  'room:leave': () => void;
  'room:start': (ack: (r: Ack) => void) => void;
  'room:options': (options: Partial<RoomOptions>, ack: (r: Ack) => void) => void;
  'game:move': (move: unknown, ack: (r: Ack) => void) => void;
  'chat:send': (text: string, ack: (r: Ack) => void) => void;
  'room:rematch': (ack: (r: Ack) => void) => void;
  'game:claim-win': (ack: (r: Ack) => void) => void;
  // `level`: how strong the bot plays, in games whose bots have levels (medium when left out).
  'room:add-bot': (level: BotLevel | undefined, ack: (r: Ack) => void) => void;
  'room:remove-bot': (botId: string, ack: (r: Ack) => void) => void;
  // Voice chat: join or leave the room's voice, and pass WebRTC offers/answers to another member.
  'voice:join': (ack: (r: Ack) => void) => void;
  'voice:leave': () => void;
  'voice:signal': (p: { to: string; data: VoiceSignal }) => void;
}

// A WebRTC session description, sent once ICE gathering is done (no trickled candidates).
export interface VoiceSignal {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface ServerToClientEvents {
  'room:state': (room: RoomView) => void;
  // `gone`: the room no longer exists (the server restarted, or it sat idle), rather than the
  // player having left it.
  'room:closed': (reason?: 'gone') => void;
  'voice:signal': (p: { from: string; data: VoiceSignal }) => void;
}

// The token is a per-browser secret; the server derives the public player id from it
// so ids shown to other players can never be used to log in as someone else.
export interface SocketAuth {
  token: string;
}
