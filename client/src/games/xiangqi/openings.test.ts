import { describe, expect, it } from 'vitest';
import { Xiangqi } from '@vg/shared';
import { XQ_OPENINGS, findXiangqiOpening, type XqOpeningId } from './openings';
import { en } from '../../i18n/en';
import { vi } from '../../i18n/vi';

describe('xiangqi openings', () => {
  it('every line is legal', () => {
    for (const [id, line] of Object.entries(XQ_OPENINGS)) {
      const game = new Xiangqi();
      for (const move of line.split(' ')) expect(() => game.move(move), `${id}: ${move}`).not.toThrow();
    }
  });

  it('every opening has a name in each locale', () => {
    for (const id of Object.keys(XQ_OPENINGS) as XqOpeningId[]) {
      expect(vi.xiangqi.openings[id], `vi ${id}`).toBeTruthy();
      expect(en.xiangqi.openings[id], `en ${id}`).toBeTruthy();
    }
  });

  it('matches the longest line, on either wing', () => {
    expect(findXiangqiOpening([])).toBeNull();
    expect(findXiangqiOpening(['h2e2'])).toBe('central-cannon');
    expect(findXiangqiOpening(['b2e2'])).toBe('central-cannon');
    expect(findXiangqiOpening(['h2e2', 'h7e7', 'h0g2'])).toBe('same-direction-cannons');
    expect(findXiangqiOpening(['b2e2', 'b7e7'])).toBe('same-direction-cannons');
    expect(findXiangqiOpening(['h2e2', 'b7e7'])).toBe('opposite-direction-cannons');
    expect(findXiangqiOpening(['h2e2', 'h9g7', 'h0g2', 'b9c7', 'i0h0'])).toBe('screen-horses');
    expect(findXiangqiOpening(['c3c4', 'c6c5'])).toBe('pawn-vs-pawn');
    expect(findXiangqiOpening(['a3a4'])).toBeNull();
  });
});
