import type { GameType, RoomOptions, RoomView } from './types';

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
  | 'RATE_LIMITED'
  | 'SERVER_FULL'
  | 'CLAIM_TOO_EARLY'
  | 'DISCONNECTED';

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: ErrorCode };

export interface ClientToServerEvents {
  'room:create': (p: { gameType: GameType; name: string }, ack: (r: Ack<{ code: string }>) => void) => void;
  'room:join': (p: { code: string; name: string }, ack: (r: Ack<{ code: string }>) => void) => void;
  'room:leave': () => void;
  'room:start': (ack: (r: Ack) => void) => void;
  'room:options': (options: Partial<RoomOptions>, ack: (r: Ack) => void) => void;
  'game:move': (move: unknown, ack: (r: Ack) => void) => void;
  'chat:send': (text: string, ack: (r: Ack) => void) => void;
  'room:rematch': (ack: (r: Ack) => void) => void;
  'game:claim-win': (ack: (r: Ack) => void) => void;
}

export interface ServerToClientEvents {
  'room:state': (room: RoomView) => void;
  'room:closed': () => void;
}

// The token is a per-browser secret; the server derives the public player id from it
// so ids shown to other players can never be used to log in as someone else.
export interface SocketAuth {
  token: string;
}
