import { describe, expect, it } from 'vitest';
import { wordKey, type WordChainLang } from '@vg/shared';
import { loadDictionary, NOITU_FILES, readList, WORDCHAIN_FILES } from './dictionaries';

const keys = (lang: WordChainLang, words: string[]) => words.map((w) => wordKey(lang, w));

describe.each([
  { lang: 'vi' as const, files: NOITU_FILES, common: 'noitu-common.txt', extraMin: 600, samples: ['con mèo', 'đi học', 'uống nước', 'dòng sông', 'trưa nay'] },
  { lang: 'en' as const, files: WORDCHAIN_FILES, common: 'wordchain-common.txt', extraMin: 100, samples: ['internet', 'email', 'website', 'app', 'wifi'] },
])('$lang dictionary', ({ lang, files, common, extraMin, samples }) => {
  const [mainFile, extraFile] = files;
  const main = readList(mainFile);
  const extra = readList(extraFile);
  const dict = loadDictionary(lang, files, common);

  it('loads the supplement: valid, lowercase words, none repeated or already in the main list', () => {
    expect(extra.length).toBeGreaterThanOrEqual(extraMin);
    const extraKeys = keys(lang, extra);
    expect(extraKeys.filter((k) => k === null)).toEqual([]);
    expect(extra.filter((w) => w !== w.normalize('NFC').trim().toLowerCase())).toEqual([]);
    expect(new Set(extraKeys).size).toBe(extra.length);
    const mainKeys = new Set(keys(lang, main));
    expect(extra.filter((_, i) => mainKeys.has(extraKeys[i]))).toEqual([]);
  });

  it('merges the supplement into the dictionary', () => {
    expect(dict.words.size).toBe(new Set(keys(lang, [...main, ...extra]).filter((k) => k !== null)).size);
    for (const word of samples) expect(dict.words.has(wordKey(lang, word)!)).toBe(true);
  });

  it('has every everyday word in the dictionary', () => {
    const list = readList(common);
    const missing = list.filter((w) => !dict.words.has(wordKey(lang, w) ?? ''));
    expect(missing).toEqual([]);
    expect(dict.common?.size).toBe(new Set(keys(lang, list)).size);
  });
});

describe('vi dictionary details', () => {
  const dict = loadDictionary('vi', NOITU_FILES, 'noitu-common.txt');

  it('treats either tone-mark placement as the same word', () => {
    expect(dict.words.get(wordKey('vi', 'hoà bình')!)).toBeDefined();
    expect(wordKey('vi', 'hoà bình')).toBe(wordKey('vi', 'hòa bình'));
  });

  it('can follow every everyday word, so bots and starting words never hit a dead end', () => {
    const deadEnds = [...dict.common!].filter((k) => !dict.byStart.has(k.split(' ')[1]));
    expect(deadEnds).toEqual([]);
  });
});
