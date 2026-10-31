import type { GameType, RoomOptions, RoomView } from './types';

// Errors travel as codes; each client locale turns them into readable text.
export type ErrorCode =
  | 'GAME_UNAVAILABLE'
  | 'NAME_REQUIRED'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_IN_GAME'
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
  | 'DISCONNECTED';

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: ErrorCode };

export interface ClientToServerEvents {
  'room:create': (p: { gameType: GameType; name: string }, ack: (r: Ack<{ code: string }>) => void) => void;
  'room:join': (p: { code: string; name: string }, ack: (r: Ack<{ code: string }>) => void) => void;
  'room:leave': () => void;
  'room:start': (ack: (r: Ack) => void) => void;
  'room:options': (options: Partial<RoomOptions>, ack: (r: Ack) => void) => void;
  'game:move': (move: unknown, ack: (r: Ack) => void) => void;
}

export interface ServerToClientEvents {
  'room:state': (room: RoomView) => void;
  'room:closed': () => void;
}

export interface SocketAuth {
  playerId: string;
}
