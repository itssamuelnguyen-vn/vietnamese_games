import { createHash } from 'node:crypto';
import { createServer, type Server as HttpServer } from 'node:http';
import { existsSync } from 'node:fs';
import express from 'express';
import { Server } from 'socket.io';
import { ABANDON_CLAIM_MS, type ClientToServerEvents, type ServerToClientEvents, type SocketAuth } from '@vg/shared';
import { RoomManager, type Room } from './rooms';
import { createWorkerThinker } from './botThinker';

const ROOM_IDLE_MS = 10 * 60 * 1000;
// Flood control per connection: at most RATE_MAX events in any RATE_WINDOW_MS.
const RATE_MAX = 60;
const RATE_WINDOW_MS = 10_000;
const SWEEP_INTERVAL_MS = 60 * 1000;

export interface GameServerOptions {
  // Directory of the built frontend to serve; skipped when missing (dev and tests).
  clientDist?: string;
}

export interface GameServer {
  httpServer: HttpServer;
  close(): Promise<void>;
}

export function createGameServer({ clientDist }: GameServerOptions = {}): GameServer {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
  const thinker = createWorkerThinker();
  const rooms = new RoomManager({
    onAutoUpdate: (room) => broadcast(room),
    isConnected: (id) => isConnected(id),
    thinker,
  });

  app.get('/healthz', (_req, res) => {
    res.send('ok');
  });

  // In production the server also serves the built frontend; in dev, Vite does.
  if (clientDist && existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.use((_req, res) => res.sendFile(`${clientDist}/index.html`));
  }

  // A player may have several tabs open, so count connections per playerId.
  const connections = new Map<string, number>();
  const isConnected = (id: string) => (connections.get(id) ?? 0) > 0;
  // When each player's last connection dropped, for abandonment claims.
  const offlineAt = new Map<string, number>();
  const offlineSince = (id: string) => (isConnected(id) ? null : (offlineAt.get(id) ?? null));
  const channel = (playerId: string) => `player:${playerId}`;

  function broadcast(room: Room | undefined) {
    if (!room) return;
    for (const p of [...room.players, ...room.spectators].filter((p) => !p.bot)) {
      io.to(channel(p.id)).emit('room:state', rooms.view(room, p.id, isConnected, offlineSince));
    }
  }

  // Clients may emit without a callback; calling a missing ack must not crash the server.
  function safe<A>(ack: unknown): (r: A) => void {
    return typeof ack === 'function' ? (ack as (r: A) => void) : () => {};
  }

  io.use((socket, next) => {
    const { token } = (socket.handshake.auth ?? {}) as Partial<SocketAuth>;
    if (typeof token !== 'string' || token.length < 8 || token.length > 64) {
      return next(new Error('invalid token'));
    }
    socket.data.playerId = publicId(token);
    next();
  });

  io.on('connection', (socket) => {
    const playerId: string = socket.data.playerId;
    let recent: number[] = [];
    socket.use((packet, next) => {
      const now = Date.now();
      recent = recent.filter((t) => now - t < RATE_WINDOW_MS);
      if (recent.length >= RATE_MAX) {
        const ack = packet.at(-1);
        if (typeof ack === 'function') ack({ ok: false, error: 'RATE_LIMITED' });
        return;
      }
      recent.push(now);
      next();
    });
    socket.join(channel(playerId));
    connections.set(playerId, (connections.get(playerId) ?? 0) + 1);
    offlineAt.delete(playerId);
    const room = rooms.roomOf(playerId);
    // A host who has been gone a while hands the room to whoever turns up, if nobody took it yet.
    const hostAway = room && room.hostId !== playerId ? offlineSince(room.hostId) : null;
    if (hostAway !== null && Date.now() - hostAway >= ABANDON_CLAIM_MS) rooms.handOffHost(room!.hostId);
    // After a restart or a sweep the room may be gone; tell the client so it doesn't stay on it.
    if (room) broadcast(room);
    else socket.emit('room:closed', 'gone');

    socket.on('room:create', (p, ack) => {
      const reply = safe<Parameters<typeof ack>[0]>(ack);
      const r = rooms.create(playerId, p?.name, p?.gameType);
      if (!r.ok) return reply(r);
      broadcast(r.left);
      reply({ ok: true, code: r.room.code });
      broadcast(r.room);
    });

    socket.on('room:join', (p, ack) => {
      const reply = safe<Parameters<typeof ack>[0]>(ack);
      const r = rooms.join(playerId, p?.name, String(p?.code ?? ''), p?.watch === true);
      if (!r.ok) return reply(r);
      broadcast(r.left);
      reply({ ok: true, code: r.room.code });
      broadcast(r.room);
    });

    socket.on('room:leave', () => {
      const room = rooms.leave(playerId);
      io.to(channel(playerId)).emit('room:closed');
      broadcast(room);
    });

    socket.on('room:start', (ack) => {
      const reply = safe<Parameters<typeof ack>[0]>(ack);
      const r = rooms.start(playerId);
      if (!r.ok) return reply(r);
      reply({ ok: true });
      broadcast(r.room);
    });

    socket.on('room:options', (options, ack) => {
      const reply = safe<Parameters<typeof ack>[0]>(ack);
      const r = rooms.setOptions(playerId, options);
      if (!r.ok) return reply(r);
      reply({ ok: true });
      broadcast(r.room);
    });

    socket.on('game:move', (move, ack) => {
      const reply = safe<Parameters<typeof ack>[0]>(ack);
      const r = rooms.move(playerId, move);
      if (!r.ok) return reply(r);
      reply({ ok: true });
      broadcast(r.room);
    });

    socket.on('room:rematch', (ack) => {
      const reply = safe<Parameters<typeof ack>[0]>(ack);
      const r = rooms.requestRematch(playerId);
      if (!r.ok) return reply(r);
      reply({ ok: true });
      broadcast(r.room);
    });

    socket.on('game:claim-win', (ack) => {
      const reply = safe<Parameters<typeof ack>[0]>(ack);
      const r = rooms.claimWin(playerId, offlineSince);
      if (!r.ok) return reply(r);
      reply({ ok: true });
      broadcast(r.room);
    });

    for (const event of ['room:sit', 'room:stand'] as const) {
      socket.on(event, (ack) => {
        const reply = safe<Parameters<typeof ack>[0]>(ack);
        const r = event === 'room:sit' ? rooms.sit(playerId) : rooms.stand(playerId);
        if (!r.ok) return reply(r);
        reply({ ok: true });
        broadcast(r.room);
      });
    }

    socket.on('room:add-bot', (level, ack) => {
      // Older clients send no level, just the callback.
      if (typeof level === 'function') [level, ack] = [undefined, level];
      const reply = safe<Parameters<typeof ack>[0]>(ack);
      const r = rooms.addBot(playerId, level);
      if (!r.ok) return reply(r);
      reply({ ok: true });
      broadcast(r.room);
    });

    socket.on('room:remove-bot', (botId, ack) => {
      const reply = safe<Parameters<typeof ack>[0]>(ack);
      const r = rooms.removeBot(playerId, botId);
      if (!r.ok) return reply(r);
      reply({ ok: true });
      broadcast(r.room);
    });

    socket.on('chat:send', (text, ack) => {
      const reply = safe<Parameters<typeof ack>[0]>(ack);
      const r = rooms.chat(playerId, text);
      if (!r.ok) return reply(r);
      reply({ ok: true });
      broadcast(r.room);
    });

    socket.on('disconnect', () => {
      connections.set(playerId, (connections.get(playerId) ?? 1) - 1);
      if (!isConnected(playerId)) {
        connections.delete(playerId);
        offlineAt.set(playerId, Date.now());
        // If they don't come back, someone else becomes host.
        setTimeout(() => broadcast(rooms.handOffHost(playerId)), ABANDON_CLAIM_MS).unref();
      }
      broadcast(rooms.roomOf(playerId));
    });
  });

  const sweeper = setInterval(() => {
    rooms.sweep(isConnected, ROOM_IDLE_MS);
    const cutoff = Date.now() - ROOM_IDLE_MS;
    // Players still seated in a room keep their offline time, so others can claim the win later.
    for (const [id, at] of offlineAt) if (at < cutoff && !rooms.roomOf(id)) offlineAt.delete(id);
  }, SWEEP_INTERVAL_MS);
  sweeper.unref();

  return {
    httpServer,
    close: () =>
      new Promise((resolve) => {
        clearInterval(sweeper);
        void thinker.close();
        io.close(() => resolve());
      }),
  };
}

// One-way: other players see this id, but cannot turn it back into the token.
export function publicId(token: string): string {
  return createHash('sha256').update(token).digest('base64url').slice(0, 16);
}
