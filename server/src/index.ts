import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, SocketAuth } from '@vg/shared';
import { RoomManager, type Room } from './rooms';

const PORT = Number(process.env.PORT ?? 3000);
const ROOM_IDLE_MS = 10 * 60 * 1000;
const CLIENT_DIST = fileURLToPath(new URL('../../client/dist', import.meta.url));

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
const rooms = new RoomManager();

app.get('/healthz', (_req, res) => {
  res.send('ok');
});

// In production the server also serves the built frontend; in dev, Vite does.
if (existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.use((_req, res) => res.sendFile(`${CLIENT_DIST}/index.html`));
}

// A player may have several tabs open, so count connections per playerId.
const connections = new Map<string, number>();
const isConnected = (id: string) => (connections.get(id) ?? 0) > 0;
const channel = (playerId: string) => `player:${playerId}`;

function broadcast(room: Room | undefined) {
  if (!room) return;
  for (const p of room.players) {
    io.to(channel(p.id)).emit('room:state', rooms.view(room, p.id, isConnected));
  }
}

io.use((socket, next) => {
  const { playerId } = (socket.handshake.auth ?? {}) as Partial<SocketAuth>;
  if (typeof playerId !== 'string' || playerId.length < 8 || playerId.length > 64) {
    return next(new Error('invalid playerId'));
  }
  socket.data.playerId = playerId;
  next();
});

io.on('connection', (socket) => {
  const playerId: string = socket.data.playerId;
  socket.join(channel(playerId));
  connections.set(playerId, (connections.get(playerId) ?? 0) + 1);
  broadcast(rooms.roomOf(playerId));

  socket.on('room:create', (p, ack) => {
    const r = rooms.create(playerId, p?.name, p?.gameType);
    if (!r.ok) return ack(r);
    broadcast(r.left);
    ack({ ok: true, code: r.room.code });
    broadcast(r.room);
  });

  socket.on('room:join', (p, ack) => {
    const r = rooms.join(playerId, p?.name, String(p?.code ?? ''));
    if (!r.ok) return ack(r);
    broadcast(r.left);
    ack({ ok: true, code: r.room.code });
    broadcast(r.room);
  });

  socket.on('room:leave', () => {
    const room = rooms.leave(playerId);
    io.to(channel(playerId)).emit('room:closed');
    broadcast(room);
  });

  socket.on('room:start', (ack) => {
    const r = rooms.start(playerId);
    if (!r.ok) return ack(r);
    ack({ ok: true });
    broadcast(r.room);
  });

  socket.on('game:move', (move, ack) => {
    const r = rooms.move(playerId, move);
    if (!r.ok) return ack(r);
    ack({ ok: true });
    broadcast(r.room);
  });

  socket.on('disconnect', () => {
    connections.set(playerId, (connections.get(playerId) ?? 1) - 1);
    if (!isConnected(playerId)) connections.delete(playerId);
    broadcast(rooms.roomOf(playerId));
  });
});

setInterval(() => rooms.sweep(isConnected, ROOM_IDLE_MS), 60 * 1000).unref();

httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
