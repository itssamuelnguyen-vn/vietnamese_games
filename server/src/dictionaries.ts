import { readFileSync } from 'node:fs';
import { buildDictionary, type WordChainDictionary, type WordChainLang } from '@vg/shared';

// Word lists for the word chain games, one word per line; lines starting with # are comments.
function readList(file: string): string[] {
  const text = readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8');
  return text.split('\n').filter((line) => line && !line.startsWith('#'));
}

// `commonFile` optionally lists everyday words for bots and starting words.
export function loadDictionary(lang: WordChainLang, file: string, commonFile?: string): WordChainDictionary {
  return buildDictionary(lang, readList(file), commonFile ? readList(commonFile) : undefined);
}
