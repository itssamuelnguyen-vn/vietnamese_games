import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { ChessView, ClientToServerEvents, RoomView, ServerToClientEvents, TienLenView } from '@vg/shared';
import { createGameServer, publicId, voiceIceServers, type GameServer } from './app';

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

function client(token: string): Promise<Client> {
  const socket: ClientSocket = connect(url, { auth: { token }, transports: ['websocket'], forceNew: true });
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

  it('rejects connections without a valid token', async () => {
    await expect(client('short')).rejects.toThrow('invalid token');
  });

  it('never exposes tokens, and a public id cannot be used to impersonate', async () => {
    const victim = await client('victim-secret-token');
    const attacker = await client('attacker-secret-token');
    const { code } = await call(victim, 'room:create', { gameType: 'chess', name: 'Victim' });
    await call(attacker, 'room:join', { code: code!, name: 'Attacker' });
    await call(victim, 'room:start');

    const seen = await attacker.waitFor((r) => r.status === 'playing');
    expect(JSON.stringify(seen)).not.toContain('victim-secret-token');
    const victimId = seen.players.find((p) => p.name === 'Victim')!.id;
    expect(victimId).toBe(publicId('victim-secret-token'));

    // Logging in with the public id yields a different identity that is not in the room.
    const impostor = await client(victimId);
    expect(await call(impostor, 'game:move', { type: 'resign' })).toEqual({ ok: false, error: 'NOT_IN_ROOM' });
    expect((await victim.waitFor((r) => r.status === 'playing')).status).toBe('playing');
  });

  it('plays a full chess game between two players', async () => {
    const a = await client('aaaaaaaaaaaa');
    const b = await client('bbbbbbbbbbbb');

    const created = await call(a, 'room:create', { gameType: 'chess', name: 'An' });
    expect(created.ok).toBe(true);
    expect((await call(b, 'room:join', { code: created.code!.toLowerCase(), name: 'Bob' })).ok).toBe(true);
    expect(await call(b, 'room:start')).toEqual({ ok: false, error: 'NOT_HOST' });
    expect((await call(a, 'room:start')).ok).toBe(true);

    const room = await a.waitFor((r) => r.status === 'playing');
    const game = room.game as ChessView;
    const [white, black] = game.white === room.you ? [a, b] : [b, a];

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
    await call(b, 'room:join', { code: code!, name: 'Bob' });
    await call(a, 'room:start');

    b.socket.close();
    await a.waitFor((r) => r.players.some((p) => p.id === publicId('dddddddddddd') && !p.connected));

    const b2 = await client('dddddddddddd');
    const back = await b2.waitFor((r) => r.code === code);
    expect(back.status).toBe('playing');
    await a.waitFor((r) => r.players.every((p) => p.connected));
  });

  it('sends each tien len player only their own cards', async () => {
    const players = await Promise.all(['tl-an-secret', 'tl-bob-secret', 'tl-chi-secret'].map(client));
    const watcher = await client('tl-dan-secret');
    const [host, ...guests] = players;
    const { code } = await call(host, 'room:create', { gameType: 'tienlen', name: 'An' });
    for (const [i, g] of guests.entries()) await call(g, 'room:join', { code: code!, name: `P${i}` });
    await call(host, 'room:start');
    await call(watcher, 'room:join', { code: code!, name: 'Dan' });

    const views = await Promise.all(players.map((c) => c.waitFor((r) => r.status !== 'waiting')));
    // A deal that wins on the spot ends the game, and then every hand is shown on purpose.
    if (views[0].status !== 'playing') return;
    const hands = views.map((v) => (v.game as TienLenView).hand);
    expect(hands.map((h) => h.length)).toEqual([13, 13, 13]);
    for (const [i, view] of views.entries()) {
      const game = view.game as TienLenView;
      expect(game.revealed).toBeNull();
      expect(game.seats.every((s) => s.cards === 13)).toBe(true);
      expect(JSON.stringify(view)).not.toContain('"hands"');
      // Nothing in this player's own hand belongs to anyone else.
      const others = hands.filter((_, j) => j !== i).flat();
      expect(game.hand.filter((c) => others.includes(c))).toEqual([]);
    }
    const watching = await watcher.waitFor((r) => r.spectators.length > 0);
    expect((watching.game as TienLenView).hand).toEqual([]);
    expect((watching.game as TienLenView).revealed).toBeNull();
  });

  it('lets a spectator watch and chat with the players', async () => {
    const a = await client('ffffffffffff');
    const b = await client('gggggggggggg');
    const watcher = await client('hhhhhhhhhhhh');
    const { code } = await call(a, 'room:create', { gameType: 'chess', name: 'An' });
    await call(b, 'room:join', { code: code!, name: 'Bob' });
    await call(a, 'room:start');
    expect((await call(watcher, 'room:join', { code: code!, name: 'Chi' })).ok).toBe(true);

    const watching = await watcher.waitFor((r) => r.status === 'playing');
    expect(watching.spectators.map((p) => p.name)).toEqual(['Chi']);
    expect((watching.game as ChessView).fen).toBeTruthy();

    expect((await call(watcher, 'chat:send', 'nice move')).ok).toBe(true);
    for (const c of [a, b]) {
      const room = await c.waitFor((r) => r.chat.length > 0);
      expect(room.chat.at(-1)).toMatchObject({ name: 'Chi', text: 'nice move' });
    }
  });

  it('passes voice signals only between members of the same room’s voice', async () => {
    const a = await client('voice-token-aaaa');
    const b = await client('voice-token-bbbb');
    const c = await client('voice-token-cccc');
    const { code } = await call(a, 'room:create', { gameType: 'chess', name: 'An' });
    await call(b, 'room:join', { code: code!, name: 'Bob' });
    await call(c, 'room:join', { code: code!, name: 'Chi' });
    const idOf = (token: string) => publicId(token);
    const got: { to: string; from: string; sdp: string }[] = [];
    for (const [who, token] of [[b, 'voice-token-bbbb'], [c, 'voice-token-cccc']] as const) {
      who.socket.on('voice:signal', (p) => got.push({ to: token, from: p.from, sdp: p.data.sdp }));
    }
    expect(await (a.socket.timeout(2000).emitWithAck('voice:join') as Promise<unknown>)).toMatchObject({ ok: true, session: 1 });
    expect(await (b.socket.timeout(2000).emitWithAck('voice:join') as Promise<unknown>)).toMatchObject({ ok: true, session: 1 });
    const room = await a.waitFor((r) => r.voice.members.length === 2);
    // Outside a game everyone hears everyone in voice.
    expect(room.voice.to).toEqual([idOf('voice-token-bbbb')]);
    a.socket.emit('voice:signal', { to: idOf('voice-token-bbbb'), data: { type: 'offer', sdp: 'v=0 hello', session: 1 } });
    // C isn't in voice, so nothing reaches them.
    a.socket.emit('voice:signal', { to: idOf('voice-token-cccc'), data: { type: 'offer', sdp: 'v=0 nope', session: 1 } });
    await new Promise((r) => setTimeout(r, 200));
    expect(got).toEqual([{ to: 'voice-token-bbbb', from: idOf('voice-token-aaaa'), sdp: 'v=0 hello' }]);
    // Joining again starts a new session, which tells the others to reconnect.
    await b.socket.timeout(2000).emitWithAck('voice:join');
    expect((await a.waitFor((r) => r.voice.sessions[idOf('voice-token-bbbb')] === 2)).voice.members).toHaveLength(2);
    b.socket.emit('voice:leave');
    await a.waitFor((r) => r.voice.members.length === 1);
  });

  it('adds a TURN relay to the ICE servers only when it is fully set up', () => {
    expect(voiceIceServers({})).toHaveLength(1);
    expect(voiceIceServers({ TURN_URLS: 'turn:relay.example.com:3478', TURN_USERNAME: 'u' })).toHaveLength(1);
    expect(voiceIceServers({ TURN_URLS: 'turn:a:3478, junk, turns:a:443?transport=tcp', TURN_USERNAME: 'u', TURN_CREDENTIAL: 'p' })[1]).toEqual({
      urls: ['turn:a:3478', 'turns:a:443?transport=tcp'],
      username: 'u',
      credential: 'p',
    });
  });

  it('rate-limits a flooding connection', async () => {
    const spammer = await client('spammer-token-1');
    const replies = await Promise.all(
      Array.from({ length: 70 }, () => call(spammer, 'room:join', { code: 'ZZZZ', name: 'x' })),
    );
    expect(replies.filter((r) => r.error === 'RATE_LIMITED').length).toBe(10);
    expect(replies.filter((r) => r.error === 'ROOM_NOT_FOUND').length).toBe(60);
  });

  it('survives events sent without an ack callback or with junk payloads', async () => {
    const a = await client('eeeeeeeeeeee');
    a.socket.emit('room:create', null as never, undefined as never);
    a.socket.emit('room:start', undefined as never);
    a.socket.emit('game:move', { type: 'move' }, undefined as never);
    expect(await call(a, 'room:join', { code: 'ZZZZ', name: 'An' })).toEqual({ ok: false, error: 'ROOM_NOT_FOUND' });
  });
});
