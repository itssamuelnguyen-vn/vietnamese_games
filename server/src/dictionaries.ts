import { readFileSync } from 'node:fs';
import { buildDictionary, type WordChainDictionary, type WordChainLang } from '@vg/shared';

// Word lists for the word chain games, one word per line; lines starting with # are comments.
export function loadDictionary(lang: WordChainLang, file: string): WordChainDictionary {
  const text = readFileSync(new URL(`../data/${file}`, import.meta.url), 'utf8');
  return buildDictionary(
    lang,
    text.split('\n').filter((line) => line && !line.startsWith('#')),
  );
}
