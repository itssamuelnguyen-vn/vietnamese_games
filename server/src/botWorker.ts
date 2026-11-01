import { randomInt } from 'node:crypto';
import { parentPort } from 'node:worker_threads';
import { chessGame, xiangqiGame, type GameDefinition, type GameType } from '@vg/shared';
import { pickBotMove, type BotRequest, type BotReply } from './botThinker';

// Runs the CPU-heavy bot searches (chess, xiangqi) off the server's main thread, so a thinking
// bot doesn't hold up every other room. Only games flagged `heavyBot` are sent here.
const GAMES: Partial<Record<GameType, GameDefinition<unknown, unknown, unknown>>> = {
  chess: chessGame as GameDefinition<unknown, unknown, unknown>,
  xiangqi: xiangqiGame as GameDefinition<unknown, unknown, unknown>,
};

const random = () => randomInt(2 ** 32) / 2 ** 32;

parentPort!.on('message', ({ id, gameType, state, botIds, now }: BotRequest) => {
  let reply: BotReply;
  try {
    const game = GAMES[gameType];
    if (!game) throw new Error(`no bot worker for ${gameType}`);
    reply = { id, pick: pickBotMove(game, state, botIds, { now, random }) };
  } catch (e) {
    reply = { id, error: String(e) };
  }
  parentPort!.postMessage(reply);
});
