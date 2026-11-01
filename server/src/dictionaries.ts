import { readFileSync } from 'node:fs';
import { buildDictionary, type WordChainDictionary, type WordChainLang } from '@vg/shared';

// Word lists for the word chain games, one word per line; lines starting with # are comments.
export function readList(file: string): string[] {
  const text = readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8');
  return text.split('\n').filter((line) => line && !line.startsWith('#'));
}

// `files` are merged in order: a main list, then supplements. buildDictionary normalises every
// word (tone-mark placement included, so hoà and hòa are one word) and keeps the first spelling
// it sees, so a supplement never changes how a word in the main list is shown.
// `commonFile` optionally lists everyday words for bots and starting words.
export function loadDictionary(lang: WordChainLang, files: string[], commonFile?: string): WordChainDictionary {
  return buildDictionary(lang, files.flatMap(readList), commonFile ? readList(commonFile) : undefined);
}

export const NOITU_FILES = ['noitu-words.txt', 'noitu-extra.txt'];
export const WORDCHAIN_FILES = ['wordchain-words.txt', 'wordchain-extra.txt'];
