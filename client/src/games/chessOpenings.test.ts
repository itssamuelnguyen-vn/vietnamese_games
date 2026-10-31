import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { OPENINGS, findOpening, type OpeningId } from './chessOpenings';
import { en } from '../i18n/en';
import { vi } from '../i18n/vi';

describe('findOpening', () => {
  it('every opening line is legal chess', () => {
    for (const [id, line] of Object.entries(OPENINGS)) {
      const chess = new Chess();
      for (const san of line.split(' ')) {
        expect(() => chess.move(san), `${id}: ${san}`).not.toThrow();
      }
    }
  });

  it('every opening has a name in each locale', () => {
    for (const id of Object.keys(OPENINGS) as OpeningId[]) {
      expect(vi.chess.openings[id], `vi ${id}`).toBeTruthy();
      expect(en.chess.openings[id], `en ${id}`).toBeTruthy();
    }
  });

  it('picks the longest matching line', () => {
    expect(findOpening([])).toBeNull();
    expect(findOpening(['e4'])).toBe('kings-pawn');
    expect(findOpening(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'])).toBe('italian');
    expect(findOpening('e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4'.split(' '))).toBe('giuoco-piano');
    expect(findOpening('d4 Nf6 c4 g6 Nc3 d5 cxd5'.split(' '))).toBe('grunfeld');
    expect(findOpening(['a3'])).toBeNull();
  });
});
