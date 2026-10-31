import { parseSquare, squareName, type XPieceType, type XSide } from '@vg/shared';
import { useI18n } from '../../i18n';
import './piece-font.css';

// Traditional piece faces (red uses the common 帥仕相馬車炮兵 set).
const GLYPHS: Record<XSide, Record<XPieceType, string>> = {
  r: { k: '帥', a: '仕', b: '相', n: '馬', r: '車', c: '炮', p: '兵' },
  b: { k: '將', a: '士', b: '象', n: '馬', r: '車', c: '砲', p: '卒' },
};

const STEP = 10;
const MARGIN = 6;
const WIDTH = MARGIN * 2 + STEP * 8;
const HEIGHT = MARGIN * 2 + STEP * 9;

export interface BoardPiece {
  // Stable id so a piece slides between squares instead of popping.
  id: string;
  square: string;
  side: XSide;
  type: XPieceType;
}

interface Props {
  pieces: BoardPiece[];
  bottom: XSide;
  selected: string | null;
  targets: { square: string; capture: boolean }[];
  lastMove: { from: string; to: string } | null;
  checkSquare: string | null;
  onSquareClick: (square: string) => void;
}

export function XiangqiBoard({ pieces, bottom, selected, targets, lastMove, checkSquare, onSquareClick }: Props) {
  const { t } = useI18n();

  // Board point for an ICCS square, with red at the bottom unless flipped.
  const point = (square: string) => {
    const [file, rank] = parseSquare(square)!;
    const col = bottom === 'r' ? file : 8 - file;
    const row = bottom === 'r' ? 9 - rank : rank;
    return { x: MARGIN + col * STEP, y: MARGIN + row * STEP };
  };
  const squareAt = (col: number, row: number) =>
    bottom === 'r' ? squareName(col, 9 - row) : squareName(8 - col, row);

  const lines: string[] = [];
  for (let row = 0; row <= 9; row++) lines.push(`M${MARGIN} ${MARGIN + row * STEP}H${MARGIN + 8 * STEP}`);
  for (let col = 0; col <= 8; col++) {
    const x = MARGIN + col * STEP;
    if (col === 0 || col === 8) lines.push(`M${x} ${MARGIN}V${MARGIN + 9 * STEP}`);
    else {
      // Inner files stop at the river.
      lines.push(`M${x} ${MARGIN}V${MARGIN + 4 * STEP}`, `M${x} ${MARGIN + 5 * STEP}V${MARGIN + 9 * STEP}`);
    }
  }
  for (const top of [0, 7]) {
    const [x1, x2, y1, y2] = [MARGIN + 3 * STEP, MARGIN + 5 * STEP, MARGIN + top * STEP, MARGIN + (top + 2) * STEP];
    lines.push(`M${x1} ${y1}L${x2} ${y2}`, `M${x2} ${y1}L${x1} ${y2}`);
  }

  return (
    <svg className="xq-board" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="grid">
      <rect className="xq-wood" x="0" y="0" width={WIDTH} height={HEIGHT} rx="2" />
      <path className="xq-lines" d={lines.join('')} />
      <rect className="xq-border" x={MARGIN} y={MARGIN} width={8 * STEP} height={9 * STEP} />
      <text className="xq-river" x={MARGIN + 2 * STEP} y={MARGIN + 4.5 * STEP}>
        {t.xiangqi.riverLeft}
      </text>
      <text className="xq-river" x={MARGIN + 6 * STEP} y={MARGIN + 4.5 * STEP}>
        {t.xiangqi.riverRight}
      </text>

      {lastMove &&
        [lastMove.from, lastMove.to].map((sq) => {
          const { x, y } = point(sq);
          return <rect key={sq} className="xq-last" x={x - 4.6} y={y - 4.6} width={9.2} height={9.2} rx="1.5" />;
        })}

      {pieces.map((p) => {
        const { x, y } = point(p.square);
        return (
          <g
            key={p.id}
            className={`xq-piece ${p.side === 'r' ? 'red' : 'black'} ${p.square === selected ? 'selected' : ''} ${p.square === checkSquare ? 'in-check' : ''}`}
            style={{ transform: `translate(${x}px, ${y}px)` }}
          >
            <circle className="xq-disc" r="4.4" />
            <circle className="xq-ring" r="3.7" />
            <text className="xq-glyph" dy="0.35em">
              {GLYPHS[p.side][p.type]}
            </text>
          </g>
        );
      })}

      {targets.map(({ square, capture }) => {
        const { x, y } = point(square);
        return capture ? (
          <circle key={square} className="xq-target capture" cx={x} cy={y} r="4.9" />
        ) : (
          <circle key={square} className="xq-target" cx={x} cy={y} r="1.4" />
        );
      })}

      {/* Click targets over every intersection, on top of everything else. */}
      {Array.from({ length: 90 }, (_, i) => {
        const col = i % 9;
        const row = Math.floor(i / 9);
        const square = squareAt(col, row);
        return (
          <rect
            key={square}
            className="xq-hit"
            data-square={square}
            x={MARGIN + col * STEP - STEP / 2}
            y={MARGIN + row * STEP - STEP / 2}
            width={STEP}
            height={STEP}
            onClick={() => onSquareClick(square)}
          />
        );
      })}
    </svg>
  );
}
