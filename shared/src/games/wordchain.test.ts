import { describe, expect, it } from 'vitest';
import type { RoomOptions } from '../types';
import { buildDictionary, createWordChainGame, wordKey, type WordChainMove, type WordChainState } from './wordchain';

const options: RoomOptions = { timeControl: 'none', hostColor: 'random', handicap: 'none', turnTimer: '30', houseRules: [], caroSize: '15', caroBlock: true, caNguaRules: [], stakes: 'points', walletStart: 200_000, stakePerPoint: 5_000, dealer: null, callSpeed: 'normal', caroLoserFirst: true, masoiRoles: ['seer', 'guard', 'witch', 'hunter'], masoiWolves: 0, masoiReveal: true, masoiTalk: 'normal' };
const VI = ['hoa hồng', 'hồng hào', 'hào hoa', 'hoa quả', 'quả cam', 'cam đoan', 'đoan trang', 'trang trại', 'trại hè', 'hòa bình', 'bình yên', 'hoa mai'];
const game = createWordChainGame('noitu', buildDictionary('vi', VI));
const ctx = { now: 0 };

// A game whose chain currently ends with `word`, with a to play.
function from(word: string, ids = ['a', 'b']): WordChainState {
  const s = game.setup(ids, options, ctx, null);
  return { ...s, chain: [{ word, by: null }], used: [wordKey('vi', word)!], turn: ids[0] };
}

function act(s: WordChainState, player: string, move: WordChainMove, now = 0) {
  const r = game.applyMove(s, player, move, { now, random: () => 0 });
  if (!r.ok) throw new Error(r.error);
  return r.state;
}

const word = (text: string): WordChainMove => ({ type: 'word', text });

describe('word chain', () => {
  it('normalises words: case, spacing and either tone-mark placement', () => {
    expect(wordKey('vi', '  Hoà   Bình ')).toBe(wordKey('vi', 'hòa bình'));
    expect(wordKey('vi', 'hoa')).toBeNull();
    expect(wordKey('vi', 'hoa hồng đỏ')).toBeNull();
    expect(wordKey('en', 'Apple')).toBe('apple');
    expect(wordKey('en', 'ox')).toBeNull();
    expect(wordKey('en', 'ice-cream')).toBeNull();
  });

  it('starts from a dealt word for the first player', () => {
    const s = game.setup(['a', 'b'], options, ctx, null);
    expect(s.chain).toHaveLength(1);
    expect(s.chain[0].by).toBeNull();
    expect(s.turn).toBe('a');
    expect(s.turnDeadline).toBe(30_000);
  });

  it('accepts a word that starts with the last syllable, then passes the turn', () => {
    const s = act(from('hoa hồng'), 'a', word('Hồng Hào'));
    expect(s.chain.at(-1)).toEqual({ word: 'hồng hào', by: 'a' });
    expect(s.turn).toBe('b');
    expect(game.playerView(s, 'b', ctx).link).toBe('hào');
  });

  it('refuses words that do not link, are unknown, used, or malformed', () => {
    const s = from('hoa hồng');
    const error = (text: string, player = 'a') => {
      const r = game.applyMove(s, player, word(text), ctx);
      return r.ok ? null : r.error;
    };
    expect(error('quả cam')).toBe('WORD_LINK');
    expect(error('hồng ngọc')).toBe('WORD_UNKNOWN');
    expect(error('hồng')).toBe('WORD_INVALID');
    expect(error('hồng hào', 'b')).toBe('NOT_YOUR_TURN');
    const later = act(act(act(s, 'a', word('hồng hào')), 'b', word('hào hoa')), 'a', word('hoa quả'));
    const looped = { ...later, chain: [...later.chain, { word: 'trang hoa', by: null }] };
    expect(game.applyMove({ ...looped, turn: 'b' }, 'b', word('hoa quả'), ctx)).toEqual({ ok: false, error: 'WORD_USED' });
  });

  it('a player who gives up or runs out of time is out; the last one standing wins', () => {
    const three = from('hoa hồng', ['a', 'b', 'c']);
    const gaveUp = act(three, 'a', { type: 'give-up' });
    expect(gaveUp.out).toEqual(['a']);
    // The next player starts again from a fresh word.
    expect(gaveUp.turn).toBe('b');
    expect(gaveUp.chain.at(-1)!.by).toBeNull();
    const timedOut = game.timeout!({ ...gaveUp, turnDeadline: 5 }, { now: 5, random: () => 0 });
    expect(timedOut.result).toEqual({ ranking: ['c', 'b', 'a'] });
    expect(game.points!(timedOut)).toEqual({ c: { place: 1, points: 2 }, b: { place: 2, points: 0 }, a: { place: 3, points: -2 } });
  });

  it('refuses a word that nothing unused can follow, and nobody is knocked out', () => {
    // Nothing starts with "hè".
    const s = from('trang trại', ['a', 'b', 'c']);
    expect(game.applyMove(s, 'a', word('trại hè'), ctx)).toEqual({ ok: false, error: 'WORD_DEAD_END' });
    // Only "hào hoa" follows "hồng hào"; once it has been used, "hồng hào" is a dead end too.
    const rose = from('hoa hồng');
    expect(game.applyMove(rose, 'a', word('hồng hào'), ctx).ok).toBe(true);
    const hoaUsed = { ...rose, used: [...rose.used, wordKey('vi', 'hào hoa')!] };
    expect(game.applyMove(hoaUsed, 'a', word('hồng hào'), ctx)).toEqual({ ok: false, error: 'WORD_DEAD_END' });
    // A word can't follow itself: "ba ba" is a dead end when it is the only word starting with "ba".
    const turtle = createWordChainGame('noitu', buildDictionary('vi', ['ngã ba', 'ba ba', 'trang trại']));
    const fork = { ...from('trang trại'), chain: [{ word: 'ngã ba', by: null }], used: [wordKey('vi', 'ngã ba')!] };
    expect(turtle.applyMove(fork, 'a', word('ba ba'), ctx)).toEqual({ ok: false, error: 'WORD_DEAD_END' });
    // English dead ends count used words the same way.
    const en = createWordChainGame('wordchain', buildDictionary('en', ['apple', 'eagle', 'egg', 'goat', 'east']));
    const s0 = en.setup(['a', 'b'], options, ctx, null);
    const apple = { ...s0, chain: [{ word: 'apple', by: null }], used: ['apple'], turn: 'a' };
    expect(en.applyMove(apple, 'a', word('egg'), ctx).ok).toBe(true);
    expect(en.applyMove({ ...apple, used: ['apple', 'goat'] }, 'a', word('egg'), ctx)).toEqual({ ok: false, error: 'WORD_DEAD_END' });
    // Nothing starts with "t".
    expect(en.applyMove(apple, 'a', word('east'), ctx)).toEqual({ ok: false, error: 'WORD_DEAD_END' });
  });

  it('bots never play a word nothing can follow', () => {
    // From "trang trại" the only answer, "trại hè", is a dead end: bots give up.
    for (const bot of ['bot:1', 'bot:2', 'bot:3', 'bot:4']) {
      expect(game.botMove!({ ...from('trang trại', [bot, 'b']) }, bot, ctx)).toEqual({ type: 'give-up' });
    }
    const list = ['trang trại', 'trại hè', 'trại lính', 'lính gác', 'trại giam', 'giam giữ', 'trại hồ', 'trại cá'];
    const camp = createWordChainGame('noitu', buildDictionary('vi', list));
    const played = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const bot = `bot:${i}`;
      const s0 = camp.setup([bot, 'b'], options, ctx, null);
      const s = { ...s0, chain: [{ word: 'trang trại', by: null }], used: [wordKey('vi', 'trang trại')!], turn: bot };
      const move = camp.botMove!(s, bot, { now: 0, random: () => (i % 10) / 10 });
      if (move?.type === 'word') played.add(move.text);
    }
    expect([...played].sort()).toEqual(['trại giam', 'trại lính']);
  });

  it('players who leave are out', () => {
    const s = game.forfeit(from('hoa hồng'), 'b', ctx, 'left');
    expect(s.result).toEqual({ ranking: ['a', 'b'] });
  });

  it('bots answer with a word that links, or give up', () => {
    const s = from('hoa hồng');
    const move = game.botMove!(s, 'a', ctx);
    expect(move === null || move.type === 'give-up' || (move.type === 'word' && move.text === 'hồng hào')).toBe(true);
    expect(game.botMove!(s, 'b', ctx)).toBeNull();
  });

  it('English links by the last letter', () => {
    const en = createWordChainGame('wordchain', buildDictionary('en', ['apple', 'eagle', 'egg', 'goat', 'tiger', 'rabbit']));
    const s0 = en.setup(['a', 'b'], options, ctx, null);
    const s = { ...s0, chain: [{ word: 'apple', by: null }], used: ['apple'] };
    const r = en.applyMove(s, 'a', word('Eagle'), ctx);
    expect(r.ok && r.state.chain.at(-1)!.word).toBe('eagle');
    expect(en.applyMove(s, 'a', word('goat'), ctx)).toEqual({ ok: false, error: 'WORD_LINK' });
  });

  it('bots prefer everyday words when the dictionary marks them', () => {
    const list = ['apple', 'eagle', 'eel', 'egg', 'ear', 'eye', 'eon', 'emu', 'elk', 'ebb', 'edge', 'east', 'easy', 'echo'];
    const en = createWordChainGame('wordchain', buildDictionary('en', list, ['easy', 'east', 'echo', 'edge', 'egg', 'eye']));
    const s0 = en.setup(['bot:1', 'b'], options, ctx, null);
    const s = { ...s0, chain: [{ word: 'apple', by: null }], used: ['apple'], turn: 'bot:1' };
    for (let i = 0; i < 20; i++) {
      const move = en.botMove!(s, 'bot:1', { now: 0, random: () => i / 20 });
      if (move?.type === 'word') expect(['easy', 'east', 'echo', 'edge', 'egg', 'eye']).toContain(move.text);
    }
  });
});
