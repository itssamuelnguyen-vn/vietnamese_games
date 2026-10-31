import { TURN_TIMERS, type GameDefinition, type GameType } from '../types';

// Word chain games. Players take turns adding a word that links to the previous one; whoever
// can't (out of time, or gives up) is out, and the last player standing wins.
// - Vietnamese (noi tu): two-syllable words; each starts with the previous word's last syllable.
// - English: single words of three or more letters; each starts with the previous word's last letter.
// After someone is knocked out, play goes on from a fresh starting word. Playing a word that
// nothing in the dictionary can follow knocks the next player out straight away.
// The dictionary lives on the server; games are built with createWordChainGame.

export type WordChainLang = 'vi' | 'en';

export interface WordChainDictionary {
  lang: WordChainLang;
  // Normalised key → the word as it is displayed.
  words: Map<string, string>;
  // Link (first syllable or letter) → keys of the words that start with it.
  byStart: Map<string, string[]>;
  // Everyday words, if the dictionary is large and full of rare ones: bots and starting words
  // stick to these.
  common: Set<string> | null;
}

const TONES: Record<string, string> = { '\u0300': '2', '\u0301': '1', '\u0303': '4', '\u0309': '3', '\u0323': '5' };

// A Vietnamese syllable with its tone mark moved to the end, so the old and new ways of placing
// a tone mark (on the "a" or the "o" of "hoa", say) compare equal.
function syllableKey(syllable: string): string {
  let tone = '';
  let base = '';
  for (const ch of syllable.normalize('NFD')) {
    if (TONES[ch]) tone = TONES[ch];
    else base += ch;
  }
  return base.normalize('NFC') + tone;
}

// Normalised form of what a player typed, or null if it can't be a word in this language.
export function wordKey(lang: WordChainLang, text: unknown): string | null {
  if (typeof text !== 'string' || text.length > 60) return null;
  const clean = text.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
  if (lang === 'en') return /^[a-z]{3,}$/.test(clean) ? clean : null;
  const parts = clean.split(' ');
  if (parts.length !== 2 || !parts.every((p) => /^\p{L}+$/u.test(p))) return null;
  return parts.map(syllableKey).join(' ');
}

const firstLink = (lang: WordChainLang, key: string) => (lang === 'en' ? key[0] : key.split(' ')[0]);
const lastLink = (lang: WordChainLang, key: string) => (lang === 'en' ? key.at(-1)! : key.split(' ')[1]);

export function buildDictionary(lang: WordChainLang, list: string[], commonList?: string[]): WordChainDictionary {
  const words = new Map<string, string>();
  const byStart = new Map<string, string[]>();
  for (const word of list) {
    const key = wordKey(lang, word);
    if (!key || words.has(key)) continue;
    words.set(key, word.normalize('NFC').trim().toLowerCase());
    const link = firstLink(lang, key);
    const bucket = byStart.get(link);
    if (bucket) bucket.push(key);
    else byStart.set(link, [key]);
  }
  const common = commonList ? new Set(commonList.map((w) => wordKey(lang, w)).filter((k): k is string => k !== null && words.has(k))) : null;
  return { lang, words, byStart, common };
}

export interface ChainLink {
  word: string;
  // null for the starting words the game hands out.
  by: string | null;
}

export type WordChainLogEntry =
  | { kind: 'start'; word: string; player: string }
  | { kind: 'word'; player: string; word: string }
  | { kind: 'out'; player: string; reason: 'timeout' | 'gave-up' | 'dead-end' | 'left' };

export interface WordChainResult {
  // The last player standing first, then everyone else in reverse order of going out.
  ranking: string[];
}

export interface WordChainState {
  lang: WordChainLang;
  seats: string[];
  // Players who are out, in the order they went out.
  out: string[];
  turn: string;
  chain: ChainLink[];
  // Keys of every word played or handed out this game; none can be used twice.
  used: string[];
  log: WordChainLogEntry[];
  result: WordChainResult | null;
  turnLimitMs: number | null;
  turnDeadline: number | null;
}

export type WordChainMove = { type: 'word'; text: string } | { type: 'give-up' };

export interface WordChainView {
  lang: WordChainLang;
  seats: { id: string; out: boolean; words: number }[];
  turn: string;
  // The most recent words, oldest first.
  chain: ChainLink[];
  // What the next word must start with.
  link: string;
  used: number;
  log: WordChainLogEntry[];
  result: WordChainResult | null;
  turnMs: number | null;
  turnLimitMs: number | null;
}

const CHAIN_SHOWN = 40;
const LOG_LIMIT = 60;
const BOT_VOCABULARY = 0.6;

const withLog = (s: WordChainState, ...entries: WordChainLogEntry[]): WordChainState => ({ ...s, log: [...s.log, ...entries].slice(-LOG_LIMIT) });
const alive = (s: WordChainState) => s.seats.filter((id) => !s.out.includes(id));

function nextAlive(s: WordChainState, from: string): string {
  const i = s.seats.indexOf(from);
  for (let k = 1; k <= s.seats.length; k++) {
    const id = s.seats[(i + k) % s.seats.length];
    if (!s.out.includes(id)) return id;
  }
  return from;
}

// Unused words that could follow `key`.
function followers(dict: WordChainDictionary, s: Pick<WordChainState, 'used'>, key: string): string[] {
  return (dict.byStart.get(lastLink(dict.lang, key)) ?? []).filter((k) => !s.used.includes(k));
}

const startTurn = (s: WordChainState, turn: string, now: number): WordChainState => ({
  ...s,
  turn,
  turnDeadline: s.turnLimitMs ? now + s.turnLimitMs : null,
});

// A fresh starting word for `player` to continue: unused, and with somewhere to go.
function deal(dict: WordChainDictionary, s: WordChainState, player: string, now: number, random: () => number): WordChainState {
  const keys = [...(dict.common ?? dict.words.keys())];
  let key = keys[Math.floor(random() * keys.length)];
  for (let tries = 0; tries < 200 && (s.used.includes(key) || followers(dict, s, key).length < 3); tries++) {
    key = keys[Math.floor(random() * keys.length)];
  }
  const word = dict.words.get(key)!;
  const next = { ...s, chain: [...s.chain, { word, by: null }], used: [...s.used, key] };
  return startTurn(withLog(next, { kind: 'start', word, player }), player, now);
}

function finish(s: WordChainState): WordChainState {
  return { ...s, turnDeadline: null, result: { ranking: [...alive(s), ...[...s.out].reverse()] } };
}

// `player` is out; the next player starts again from a fresh word.
function knockOut(
  dict: WordChainDictionary,
  s: WordChainState,
  player: string,
  reason: 'timeout' | 'gave-up' | 'dead-end' | 'left',
  now: number,
  random: () => number,
): WordChainState {
  const next = withLog({ ...s, out: [...s.out, player] }, { kind: 'out', player, reason });
  if (alive(next).length <= 1) return finish(next);
  return s.turn === player ? deal(dict, next, nextAlive(next, player), now, random) : next;
}

// A bot knows a fixed part of the dictionary, so people can sometimes outlast it.
function botKnows(bot: string, key: string): boolean {
  let h = 2166136261;
  for (const ch of bot + key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 2 ** 32 < BOT_VOCABULARY;
}

export function createWordChainGame(type: GameType, dict: WordChainDictionary): GameDefinition<WordChainState, WordChainMove, WordChainView> {
  const game: GameDefinition<WordChainState, WordChainMove, WordChainView> = {
    type,

    setup(playerIds, options, { now, random = Math.random }) {
      const base: WordChainState = {
        lang: dict.lang,
        seats: [...playerIds],
        out: [],
        turn: playerIds[0],
        chain: [],
        used: [],
        log: [],
        result: null,
        turnLimitMs: TURN_TIMERS[options.turnTimer] ?? null,
        turnDeadline: null,
      };
      return deal(dict, base, playerIds[0], now, random);
    },

    applyMove(state, playerId, move, { now, random = Math.random }) {
      if (state.result) return { ok: false, error: 'GAME_OVER' };
      if (!state.seats.includes(playerId) || state.out.includes(playerId)) return { ok: false, error: 'NOT_A_PLAYER' };
      if (state.turn !== playerId) return { ok: false, error: 'NOT_YOUR_TURN' };
      if (move?.type === 'give-up') return { ok: true, state: knockOut(dict, state, playerId, 'gave-up', now, random) };
      if (move?.type !== 'word') return { ok: false, error: 'INVALID_MOVE' };

      const key = wordKey(dict.lang, move.text);
      const previous = wordKey(dict.lang, state.chain.at(-1)!.word)!;
      if (!key) return { ok: false, error: 'WORD_INVALID' };
      if (firstLink(dict.lang, key) !== lastLink(dict.lang, previous)) return { ok: false, error: 'WORD_LINK' };
      if (!dict.words.has(key)) return { ok: false, error: 'WORD_UNKNOWN' };
      if (state.used.includes(key)) return { ok: false, error: 'WORD_USED' };

      const word = dict.words.get(key)!;
      let next: WordChainState = withLog({ ...state, chain: [...state.chain, { word, by: playerId }], used: [...state.used, key] }, { kind: 'word', player: playerId, word });
      const following = nextAlive(next, playerId);
      next = startTurn(next, following, now);
      // Nothing can follow this word: the next player can't answer.
      if (followers(dict, next, key).length === 0) next = knockOut(dict, next, following, 'dead-end', now, random);
      return { ok: true, state: next };
    },

    forfeit(state, playerId, { now }) {
      if (state.result || !state.seats.includes(playerId) || state.out.includes(playerId)) return state;
      return knockOut(dict, state, playerId, 'left', now, Math.random);
    },

    isOver(state) {
      return state.result !== null;
    },

    playerView(state, playerId, { now }) {
      const last = wordKey(dict.lang, state.chain.at(-1)!.word)!;
      return {
        lang: state.lang,
        seats: state.seats.map((id) => ({ id, out: state.out.includes(id), words: state.chain.filter((c) => c.by === id).length })),
        turn: state.turn,
        chain: state.chain.slice(-CHAIN_SHOWN),
        link: dict.lang === 'en' ? lastLink(dict.lang, last) : state.chain.at(-1)!.word.split(' ')[1],
        used: state.used.length,
        log: state.log,
        result: state.result,
        turnMs: state.turnDeadline === null ? null : Math.max(0, state.turnDeadline - now),
        turnLimitMs: state.turnLimitMs,
      };
    },

    deadline(state) {
      return state.result ? null : state.turnDeadline;
    },

    timeout(state, { now, random = Math.random }) {
      if (state.result || state.turnDeadline === null || now < state.turnDeadline) return state;
      return knockOut(dict, state, state.turn, 'timeout', now, random);
    },

    points(state) {
      if (!state.result) return null;
      const n = state.result.ranking.length;
      return Object.fromEntries(state.result.ranking.map((id, i) => [id, { place: i + 1, points: n - 1 - 2 * i }]));
    },

    // Bots answer with a word they know, or give up.
    botMove(state, playerId, { random = Math.random }) {
      if (state.result || state.turn !== playerId) return null;
      const last = wordKey(dict.lang, state.chain.at(-1)!.word)!;
      const known = followers(dict, state, last).filter((k) => botKnows(playerId, k));
      // Prefer everyday words, so bots don't play obscure ones.
      const everyday = dict.common ? known.filter((k) => dict.common!.has(k)) : [];
      const options = everyday.length ? everyday : known;
      if (options.length === 0) return { type: 'give-up' };
      return { type: 'word', text: dict.words.get(options[Math.floor(random() * options.length)])! };
    },
  };
  return game;
}
