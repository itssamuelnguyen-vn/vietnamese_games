import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, ErrorCode, GameType, ServerToClientEvents } from '@vg/shared';
import { loadSetting, saveSetting } from './settings';

function randomId(): string {
  // crypto.randomUUID needs HTTPS/localhost; getRandomValues also works when testing over a LAN IP.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// A stable per-browser playerId lets a refresh or dropped connection land back in the same seat.
export const playerId = loadSetting('vg:playerId') ?? randomId();
saveSetting('vg:playerId', playerId);

// autoConnect is off: App calls connect() after attaching listeners so the first room:state isn't missed.
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  auth: { playerId },
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
  join: (code: string, name: string) =>
    call(() => socket.timeout(TIMEOUT_MS).emitWithAck('room:join', { code, name })),
  start: () => call<Ack>(() => socket.timeout(TIMEOUT_MS).emitWithAck('room:start')),
  move: (move: unknown) => call<Ack>(() => socket.timeout(TIMEOUT_MS).emitWithAck('game:move', move)),
  leave: () => socket.emit('room:leave'),
};
