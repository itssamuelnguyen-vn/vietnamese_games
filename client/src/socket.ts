import { io, type Socket } from 'socket.io-client';
import type { Ack, BotLevel, ClientToServerEvents, ErrorCode, GameType, RoomOptions, ServerToClientEvents } from '@vg/shared';
import { loadSetting, saveSetting } from './settings';

function randomId(): string {
  // crypto.randomUUID needs HTTPS/localhost; getRandomValues also works when testing over a LAN IP.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// A stable per-browser secret lets a refresh or dropped connection land back in the same seat.
// It never leaves this browser except in the handshake; rooms identify us by `room.you`.
const token = loadSetting('vg:playerId') ?? randomId();
saveSetting('vg:playerId', token);

// Only used to colour the avatar preview before joining a room.
export const localAvatarSeed = token.slice(0, 8);

// autoConnect is off: App calls connect() after attaching listeners so the first room:state isn't missed.
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  auth: { token },
  autoConnect: false,
});

const TIMEOUT_MS = 5000;

async function call<T>(send: () => Promise<T>): Promise<T | { ok: false; error: ErrorCode }> {
  try {
    return await send();
  } catch {
    return { ok: false, error: 'DISCONNECTED' };
  }
}

export const api = {
  create: (gameType: GameType, name: string) =>
    call(() => socket.timeout(TIMEOUT_MS).emitWithAck('room:create', { gameType, name })),
  join: (code: string, name: string, watch = false) =>
    call(() => socket.timeout(TIMEOUT_MS).emitWithAck('room:join', { code, name, watch })),
  sit: () => call<Ack>(() => socket.timeout(TIMEOUT_MS).emitWithAck('room:sit')),
  stand: () => call<Ack>(() => socket.timeout(TIMEOUT_MS).emitWithAck('room:stand')),
  start: () => call<Ack>(() => socket.timeout(TIMEOUT_MS).emitWithAck('room:start')),
  move: (move: unknown) => call<Ack>(() => socket.timeout(TIMEOUT_MS).emitWithAck('game:move', move)),
  options: (options: Partial<RoomOptions>) => call<Ack>(() => socket.timeout(TIMEOUT_MS).emitWithAck('room:options', options)),
  rematch: () => call<Ack>(() => socket.timeout(TIMEOUT_MS).emitWithAck('room:rematch')),
  claimWin: () => call<Ack>(() => socket.timeout(TIMEOUT_MS).emitWithAck('game:claim-win')),
  addBot: (level?: BotLevel) => call<Ack>(() => socket.timeout(TIMEOUT_MS).emitWithAck('room:add-bot', level)),
  removeBot: (botId: string) => call<Ack>(() => socket.timeout(TIMEOUT_MS).emitWithAck('room:remove-bot', botId)),
  chat: (text: string) => call<Ack>(() => socket.timeout(TIMEOUT_MS).emitWithAck('chat:send', text)),
  leave: () => socket.emit('room:leave'),
};
