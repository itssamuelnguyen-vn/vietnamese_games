import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { ChessView, ClientToServerEvents, RoomView, ServerToClientEvents } from '@vg/shared';
import { createGameServer, type GameServer } from './app';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface Client {
  socket: ClientSocket;
  last: () => RoomView | null;
  // Resolves with the first room:state (including the latest one) that satisfies `match`.
  waitFor: (match: (room: RoomView) => boolean) => Promise<RoomView>;
}

let server: GameServer;
let url: string;
const sockets: ClientSocket[] = [];

beforeAll(async () => {
  server = createGameServer();
  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  url = `http://localhost:${(server.httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const s of sockets) s.close();
  await server.close();
});

function client(playerId: string): Promise<Client> {
  const socket: ClientSocket = connect(url, { auth: { playerId }, transports: ['websocket'], forceNew: true });
  sockets.push(socket);
  let latest: RoomView | null = null;
  const waiters = new Set<() => void>();
  socket.on('room:state', (room) => {
    latest = room;
    for (const w of waiters) w();
  });
  const waitFor = (match: (room: RoomView) => boolean) =>
    new Promise<RoomView>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for room:state')), 2000);
      const check = () => {
        if (latest && match(latest)) {
          clearTimeout(timer);
          waiters.delete(check);
          resolve(latest);
        }
      };
      waiters.add(check);
      check();
    });
  return new Promise((resolve, reject) => {
    socket.on('connect', () => resolve({ socket, last: () => latest, waitFor }));
    socket.on('connect_error', reject);
  });
}

const call = <E extends 'room:create' | 'room:join' | 'room:start' | 'game:move' | 'chat:send'>(
  c: Client,
  event: E,
  ...args: Parameters<ClientToServerEvents[E]> extends [...infer P, unknown] ? P : never
) => (c.socket.timeout(2000).emitWithAck as (...a: unknown[]) => Promise<{ ok: boolean; error?: string; code?: string }>)(event, ...args);

describe('game server', () => {
  it('serves a health check', async () => {
    const res = await fetch(`${url}/healthz`);
    expect(await res.text()).toBe('ok');
  });

  it('rejects connections without a valid playerId', async () => {
    await expect(client('short')).rejects.toThrow('invalid playerId');
  });

  it('plays a full chess game between two players', async () => {
    const a = await client('aaaaaaaaaaaa');
    const b = await client('bbbbbbbbbbbb');

    const created = await call(a, 'room:create', { gameType: 'chess', name: 'An' });
    expect(created.ok).toBe(true);
    expect((await call(b, 'room:join', { code: created.code!.toLowerCase(), name: 'Bình' })).ok).toBe(true);
    expect(await call(b, 'room:start')).toEqual({ ok: false, error: 'NOT_HOST' });
    expect((await call(a, 'room:start')).ok).toBe(true);

    const room = await a.waitFor((r) => r.status === 'playing');
    const game = room.game as ChessView;
    const [white, black] = game.white === 'aaaaaaaaaaaa' ? [a, b] : [b, a];

    expect(await call(black, 'game:move', { type: 'move', from: 'e7', to: 'e5' })).toEqual({
      ok: false,
      error: 'NOT_YOUR_TURN',
    });
    for (const [p, from, to] of [
      [white, 'f2', 'f3'],
      [black, 'e7', 'e5'],
      [white, 'g2', 'g4'],
      [black, 'd8', 'h4'],
    ] as const) {
      expect((await call(p, 'game:move', { type: 'move', from, to })).ok).toBe(true);
    }

    for (const c of [a, b]) {
      const done = await c.waitFor((r) => r.status === 'finished');
      expect((done.game as ChessView).result?.reason).toBe('checkmate');
      expect((done.game as ChessView).history).toEqual(['f3', 'e5', 'g4', 'Qh4#']);
    }
  });

  it('marks players offline on disconnect and restores them on reconnect', async () => {
    const a = await client('cccccccccccc');
    const b = await client('dddddddddddd');
    const { code } = await call(a, 'room:create', { gameType: 'chess', name: 'An' });
    await call(b, 'room:join', { code: code!, name: 'Bình' });
    await call(a, 'room:start');

    b.socket.close();
    await a.waitFor((r) => r.players.some((p) => p.id === 'dddddddddddd' && !p.connected));

    const b2 = await client('dddddddddddd');
    const back = await b2.waitFor((r) => r.code === code);
    expect(back.status).toBe('playing');
    await a.waitFor((r) => r.players.every((p) => p.connected));
  });

  it('lets a spectator watch and chat with the players', async () => {
    const a = await client('ffffffffffff');
    const b = await client('gggggggggggg');
    const watcher = await client('hhhhhhhhhhhh');
    const { code } = await call(a, 'room:create', { gameType: 'chess', name: 'An' });
    await call(b, 'room:join', { code: code!, name: 'Bình' });
    await call(a, 'room:start');
    expect((await call(watcher, 'room:join', { code: code!, name: 'Chi' })).ok).toBe(true);

    const watching = await watcher.waitFor((r) => r.status === 'playing');
    expect(watching.spectators.map((p) => p.name)).toEqual(['Chi']);
    expect((watching.game as ChessView).fen).toBeTruthy();

    expect((await call(watcher, 'chat:send', 'hay quá')).ok).toBe(true);
    for (const c of [a, b]) {
      const room = await c.waitFor((r) => r.chat.length > 0);
      expect(room.chat.at(-1)).toMatchObject({ name: 'Chi', text: 'hay quá' });
    }
  });

  it('survives events sent without an ack callback or with junk payloads', async () => {
    const a = await client('eeeeeeeeeeee');
    a.socket.emit('room:create', null as never, undefined as never);
    a.socket.emit('room:start', undefined as never);
    a.socket.emit('game:move', { type: 'move' }, undefined as never);
    expect(await call(a, 'room:join', { code: 'ZZZZ', name: 'An' })).toEqual({ ok: false, error: 'ROOM_NOT_FOUND' });
  });
});
