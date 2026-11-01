import { describe, expect, it } from 'vitest';
import type { RoomOptions } from '../types';
import { buildDictionary, createWordChainGame, wordKey, type WordChainMove, type WordChainState } from './wordchain';

const options: RoomOptions = { timeControl: 'none', hostColor: 'random', handicap: 'none', turnTimer: '30', houseRules: [], caroSize: '15', caroBlock: true, caNguaRules: [], stakes: 'points', walletStart: 200_000, stakePerPoint: 5_000 };
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

  it('a word nothing can follow knocks the next player out at once', () => {
    // Nothing starts with "hè".
    const s = act(from('trang trại', ['a', 'b', 'c']), 'a', word('trại hè'));
    expect(s.out).toEqual(['b']);
    expect(s.log.at(-2)).toEqual({ kind: 'out', player: 'b', reason: 'dead-end' });
    expect(s.turn).toBe('c');
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
