import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { GameContext, GameDefinition } from '@vg/shared';

// Stand-in worker threads that record what they're sent.
const workers = vi.hoisted(() => [] as { posted: unknown[]; emit(event: string, ...args: unknown[]): boolean }[]);
vi.mock('node:worker_threads', async () => {
  const { EventEmitter: Emitter } = await import('node:events');
  class FakeWorker extends Emitter {
    posted: unknown[] = [];
    constructor() {
      super();
      workers.push(this);
    }
    postMessage(message: unknown) {
      this.posted.push(message);
    }
    unref() {}
    terminate() {
      return Promise.resolve(0);
    }
  }
  return { Worker: FakeWorker };
});

const { answerBotRequest, createWorkerThinker, pickBotMove } = await import('./botThinker');

// A game whose bots report the level they were asked to play at.
const levelGame = {
  botMove: (_state: unknown, playerId: string, ctx: GameContext) => (playerId === 'bot:2' ? { level: ctx.botLevel ?? null } : null),
} as unknown as GameDefinition<unknown, unknown, unknown>;

describe('bot thinker', () => {
  it('asks each bot at its own level', () => {
    const bots = [{ id: 'bot:1', level: 'easy' as const }, { id: 'bot:2', level: 'hard' as const }];
    expect(pickBotMove(levelGame, {}, bots, { now: 0 })).toEqual({ botId: 'bot:2', move: { level: 'hard' } });
    expect(pickBotMove(levelGame, {}, [{ id: 'bot:2' }], { now: 0 })).toEqual({ botId: 'bot:2', move: { level: null } });
  });

  it('a worker answers a request with the bots and levels it names', () => {
    const request = { id: 7, gameType: 'chess' as const, state: {}, bots: [{ id: 'bot:2', level: 'easy' as const }], now: 5 };
    expect(answerBotRequest({ chess: levelGame }, request, Math.random)).toEqual({ id: 7, pick: { botId: 'bot:2', move: { level: 'easy' } } });
    expect(answerBotRequest({}, request, Math.random)).toMatchObject({ id: 7, error: expect.stringContaining('chess') });
  });

  it('posts the game, state, bots with their levels, and time to a worker, and resolves with its reply', async () => {
    const think = createWorkerThinker(1);
    const state = { pgn: '1. e4' };
    const pending = think('chess', state, [{ id: 'bot:1', level: 'hard' }], 1234);
    expect(workers).toHaveLength(1);
    const worker = workers[0] as unknown as EventEmitter & { posted: unknown[] };
    expect(worker.posted).toEqual([{ id: 1, gameType: 'chess', state, bots: [{ id: 'bot:1', level: 'hard' }], now: 1234 }]);
    worker.emit('message', { id: 1, pick: { botId: 'bot:1', move: { type: 'move', from: 'e7', to: 'e5' } } });
    await expect(pending).resolves.toEqual({ botId: 'bot:1', move: { type: 'move', from: 'e7', to: 'e5' } });
    await think.close();
  });
});
