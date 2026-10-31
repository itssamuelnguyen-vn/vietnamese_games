import { describe, expect, it } from 'vitest';
import { Xiangqi } from '@vg/shared';
import { notate, replayXiangqi, type NotationStyle } from './notation';

const WXF: NotationStyle = {
  pieces: { k: 'K', a: 'A', b: 'E', n: 'H', r: 'R', c: 'C', p: 'P' },
  advance: '+',
  retreat: '-',
  traverse: '=',
  front: '+',
  rear: '-',
  markFirst: true,
};

describe('xiangqi notation', () => {
  it('writes the classic openings in WXF form', () => {
    // Central cannon, screen horse, and black's replies.
    const { labels } = replayXiangqi(['h2e2', 'h9g7', 'h0g2', 'i9h9', 'i0h0', 'b9c7'], WXF);
    expect(labels).toEqual(['C2=5', 'H8+7', 'H2+3', 'R9=8', 'R1=2', 'H2+3']);
  });

  it('uses distance for straight movers and destination file for diagonal ones', () => {
    const { labels } = replayXiangqi(['g3g4', 'c6c5', 'c0e2', 'g9e7', 'f0e1', 'd9e8'], WXF);
    expect(labels).toEqual(['P3+1', 'P3+1', 'E7+5', 'E7+5', 'A4+5', 'A4+5']);
  });

  it('marks front and rear when two identical pieces share a file', () => {
    const before = new Xiangqi('3k5/9/9/9/9/9/9/R8/R8/4K4 w');
    expect(notate(before, before.moves('a2').find((m) => m.to === 'a5')!, WXF)).toBe('+R+3');
    expect(notate(before, before.moves('a1').find((m) => m.to === 'b1')!, WXF)).toBe('-R=8');
  });

  it('numbers three or more soldiers on one file from the front', () => {
    const before = new Xiangqi('3k5/9/2P6/2P6/2P6/9/9/9/9/4K4 w');
    expect(notate(before, before.moves('c6').find((m) => m.to === 'd6')!, WXF)).toBe('2P=6');
    expect(notate(before, before.moves('c7').find((m) => m.to === 'c8')!, WXF)).toBe('1P+1');
  });

  it('keeps the file number when soldiers are stacked on more than one file', () => {
    const before = new Xiangqi('3k5/9/2P1P4/2P1P4/9/9/9/9/9/4K4 w');
    expect(notate(before, before.moves('c6').find((m) => m.to === 'd6')!, WXF)).toBe('-P7=6');
    expect(notate(before, before.moves('e6').find((m) => m.to === 'd6')!, WXF)).toBe('-P5=6');
  });
});
