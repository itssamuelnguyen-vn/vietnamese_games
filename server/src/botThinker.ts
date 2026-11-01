import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { BotLevel, GameContext, GameDefinition, GameType } from '@vg/shared';

export interface BotPick {
  botId: string;
  move: unknown;
}

// A room's bot, with its level in games whose bots have levels.
export interface BotSeat {
  id: string;
  level?: BotLevel;
}

// Works out the next bot move for a room somewhere other than the main thread.
export type BotThinker = (gameType: GameType, state: unknown, bots: BotSeat[], now: number) => Promise<BotPick | null>;

export interface BotRequest {
  id: number;
  gameType: GameType;
  state: unknown;
  bots: BotSeat[];
  now: number;
}

export type BotReply = { id: number; pick: BotPick | null } | { id: number; error: string };

// The first bot that has something to do, and its move. Each bot thinks at its own level.
export function pickBotMove(game: GameDefinition<unknown, unknown, unknown>, state: unknown, bots: BotSeat[], ctx: GameContext): BotPick | null {
  for (const { id, level } of bots) {
    const move = game.botMove?.(state, id, level ? { ...ctx, botLevel: level } : ctx);
    if (move) return { botId: id, move };
  }
  return null;
}

// What a bot worker does with a request: the reply to post back.
export function answerBotRequest(
  games: Partial<Record<GameType, GameDefinition<unknown, unknown, unknown>>>,
  { id, gameType, state, bots, now }: BotRequest,
  random: () => number,
): BotReply {
  try {
    const game = games[gameType];
    if (!game) throw new Error(`no bot worker for ${gameType}`);
    return { id, pick: pickBotMove(game, state, bots, { now, random }) };
  } catch (e) {
    return { id, error: String(e) };
  }
}

// A small pool of worker threads, started on first use. A worker that crashes fails its pending
// requests (the caller then thinks on the main thread) and is replaced on the next request.
export function createWorkerThinker(size = Math.max(1, Math.min(2, availableParallelism() - 1))): BotThinker & { close(): Promise<void> } {
  const workers: (Worker | null)[] = Array.from({ length: size }, () => null);
  const load = new Array<number>(size).fill(0);
  const pending = new Map<number, { slot: number; resolve: (pick: BotPick | null) => void; reject: (e: Error) => void }>();
  let nextId = 1;

  function fail(slot: number, error: Error) {
    workers[slot] = null;
    load[slot] = 0;
    for (const [id, p] of pending) {
      if (p.slot !== slot) continue;
      pending.delete(id);
      p.reject(error);
    }
  }

  function workerAt(slot: number): Worker {
    const existing = workers[slot];
    if (existing) return existing;
    const worker = new Worker(new URL('./botWorker.ts', import.meta.url));
    worker.unref();
    worker.on('message', (reply: BotReply) => {
      const p = pending.get(reply.id);
      if (!p) return;
      pending.delete(reply.id);
      load[slot]--;
      if ('error' in reply) p.reject(new Error(reply.error));
      else p.resolve(reply.pick);
    });
    worker.on('error', (e) => fail(slot, e as Error));
    worker.on('exit', () => workers[slot] === worker && fail(slot, new Error('bot worker exited')));
    workers[slot] = worker;
    return worker;
  }

  const think: BotThinker = (gameType, state, bots, now) =>
    new Promise((resolve, reject) => {
      // The least busy worker takes it; each one works through its requests in order.
      const slot = load.indexOf(Math.min(...load));
      const id = nextId++;
      pending.set(id, { slot, resolve, reject });
      load[slot]++;
      try {
        workerAt(slot).postMessage({ id, gameType, state, bots, now } satisfies BotRequest);
      } catch (e) {
        pending.delete(id);
        load[slot]--;
        reject(e as Error);
      }
    });

  return Object.assign(think, {
    async close() {
      const running = workers.filter((w): w is Worker => w !== null);
      workers.fill(null);
      await Promise.all(running.map((w) => w.terminate()));
    },
  });
}
