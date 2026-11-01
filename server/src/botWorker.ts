import { randomInt } from 'node:crypto';
import { parentPort } from 'node:worker_threads';
import { caroGame, chessGame, xiangqiGame, type GameDefinition, type GameType } from '@vg/shared';
import { answerBotRequest, type BotRequest } from './botThinker';

// Runs the CPU-heavy bot searches (chess, xiangqi, caro) off the server's main thread, so a thinking
// bot doesn't hold up every other room. Only games flagged `heavyBot` are sent here.
const GAMES: Partial<Record<GameType, GameDefinition<unknown, unknown, unknown>>> = {
  chess: chessGame as GameDefinition<unknown, unknown, unknown>,
  xiangqi: xiangqiGame as GameDefinition<unknown, unknown, unknown>,
  caro: caroGame as GameDefinition<unknown, unknown, unknown>,
};

const random = () => randomInt(2 ** 32) / 2 ** 32;

parentPort!.on('message', (request: BotRequest) => parentPort!.postMessage(answerBotRequest(GAMES, request, random)));
