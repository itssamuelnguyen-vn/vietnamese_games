import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
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
// Pointer travel (in board units) before a press counts as a drag rather than a tap.
const DRAG_THRESHOLD = 1.5;
// How long a captured piece lingers while fading out.
const LEAVE_MS = 260;

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
  // Moves as "fromto" strings (e.g. "h2e2") so the memoized board can compare them cheaply.
  lastMove: string | null;
  premove: string | null;
  checkSquare: string | null;
  // Side whose pieces the player may pick up, or null when the board is read-only.
  movable: XSide | null;
  onSquareClick: (square: string) => void;
  onDrop: (from: string, to: string) => void;
}

interface Drag {
  pieceId: string;
  from: string;
  start: { x: number; y: number };
  at: { x: number; y: number };
  moved: boolean;
}

function XiangqiBoardImpl({ pieces, bottom, selected, targets, lastMove, premove, checkSquare, movable, onSquareClick, onDrop }: Props) {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  // Keep captured pieces on screen briefly so they fade out instead of vanishing.
  // The timer lives outside the effect: `pieces` is rebuilt (same content) when the server
  // confirms a move, and that re-run must not cancel a fade that is still in progress.
  const previous = useRef(pieces);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [leaving, setLeaving] = useState<BoardPiece[]>([]);
  useEffect(() => {
    const ids = new Set(pieces.map((p) => p.id));
    const gone = previous.current.filter((p) => !ids.has(p.id));
    previous.current = pieces;
    if (gone.length === 0) return;
    setLeaving(gone);
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => setLeaving([]), LEAVE_MS);
  }, [pieces]);
  useEffect(() => () => clearTimeout(leaveTimer.current), []);

  // Board point for an ICCS square, with red at the bottom unless flipped.
  const point = (square: string) => {
    const [file, rank] = parseSquare(square)!;
    const col = bottom === 'r' ? file : 8 - file;
    const row = bottom === 'r' ? 9 - rank : rank;
    return { x: MARGIN + col * STEP, y: MARGIN + row * STEP };
  };
  const squareAt = (col: number, row: number) => (bottom === 'r' ? squareName(col, 9 - row) : squareName(8 - col, row));

  // Pointer position in board units.
  const toBoard = (e: { clientX: number; clientY: number }) => {
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
    return { x: p.x, y: p.y };
  };
  const nearestSquare = ({ x, y }: { x: number; y: number }) => {
    const col = Math.round((x - MARGIN) / STEP);
    const row = Math.round((y - MARGIN) / STEP);
    return col >= 0 && col <= 8 && row >= 0 && row <= 9 ? squareAt(col, row) : null;
  };

  function onPointerDown(e: ReactPointerEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    const at = toBoard(e);
    const square = nearestSquare(at);
    const piece = square && pieces.find((p) => p.square === square);
    if (piece && piece.side === movable) {
      svgRef.current?.setPointerCapture(e.pointerId);
      setDrag({ pieceId: piece.id, from: square, start: at, at, moved: false });
    }
  }

  function onPointerMove(e: ReactPointerEvent<SVGSVGElement>) {
    if (!drag) return;
    const at = toBoard(e);
    const moved = drag.moved || Math.hypot(at.x - drag.start.x, at.y - drag.start.y) > DRAG_THRESHOLD;
    setDrag({ ...drag, at, moved });
  }

  function onPointerUp(e: ReactPointerEvent<SVGSVGElement>) {
    const current = drag;
    setDrag(null);
    const square = nearestSquare(toBoard(e));
    if (!current) {
      if (square) onSquareClick(square);
      return;
    }
    if (!current.moved) {
      // A tap on a piece: same as clicking its square (select / deselect).
      onSquareClick(current.from);
      return;
    }
    if (square && square !== current.from) onDrop(current.from, square);
  }

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

  const marker = (square: string, className: string) => {
    const { x, y } = point(square);
    return <rect key={`${className}-${square}`} className={className} x={x - 4.6} y={y - 4.6} width={9.2} height={9.2} rx="1.5" />;
  };

  const renderPiece = (p: BoardPiece, extra = '') => {
    const dragging = drag?.moved && drag.pieceId === p.id;
    const { x, y } = dragging ? drag.at : point(p.square);
    const classes = [
      'xq-piece',
      p.side === 'r' ? 'red' : 'black',
      p.side === movable ? 'movable' : '',
      p.square === selected ? 'selected' : '',
      p.square === checkSquare ? 'in-check' : '',
      dragging ? 'dragging' : '',
      extra,
    ];
    return (
      <g key={p.id} className={classes.filter(Boolean).join(' ')} style={{ transform: `translate(${x}px, ${y}px)` }}>
        <g className="xq-face">
          <circle className="xq-disc" r="4.4" />
          <circle className="xq-ring" r="3.7" />
          <text className="xq-glyph" dy="0.35em">
            {GLYPHS[p.side][p.type]}
          </text>
        </g>
      </g>
    );
  };

  const dragged = drag?.moved ? pieces.find((p) => p.id === drag.pieceId) : undefined;
  const movableSquares = new Set(pieces.filter((p) => p.side === movable).map((p) => p.square));
  const targetSquares = new Set(targets.map((m) => m.square));
  const hoverSquare = drag?.moved ? nearestSquare(drag.at) : null;

  return (
    <svg
      ref={svgRef}
      className={`xq-board ${drag?.moved ? 'is-dragging' : ''}`}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
    >
      <rect className="xq-wood" x="0" y="0" width={WIDTH} height={HEIGHT} rx="2" />
      <path className="xq-lines" d={lines.join('')} />
      <rect className="xq-border" x={MARGIN} y={MARGIN} width={8 * STEP} height={9 * STEP} />
      <text className="xq-river" x={MARGIN + 2 * STEP} y={MARGIN + 4.5 * STEP}>
        {t.xiangqi.riverLeft}
      </text>
      <text className="xq-river" x={MARGIN + 6 * STEP} y={MARGIN + 4.5 * STEP}>
        {t.xiangqi.riverRight}
      </text>

      {lastMove && [marker(lastMove.slice(0, 2), 'xq-last'), marker(lastMove.slice(2), 'xq-last')]}
      {premove && [marker(premove.slice(0, 2), 'xq-premove'), marker(premove.slice(2), 'xq-premove')]}
      {hoverSquare && targets.some((m) => m.square === hoverSquare) && marker(hoverSquare, 'xq-hover')}

      {leaving.map((p) => renderPiece(p, 'leaving'))}
      {pieces.filter((p) => p !== dragged).map((p) => renderPiece(p))}

      {targets.map(({ square, capture }) => {
        const { x, y } = point(square);
        return capture ? (
          <circle key={square} className="xq-target capture" cx={x} cy={y} r="4.9" />
        ) : (
          <circle key={square} className="xq-target" cx={x} cy={y} r="1.4" />
        );
      })}

      {/* The dragged piece floats above everything else. */}
      {dragged && renderPiece(dragged)}

      {/* Transparent cells marking each intersection (for assistive tech and tests); input is
          handled by the pointer handlers on the board itself. */}
      {Array.from({ length: 90 }, (_, i) => {
        const col = i % 9;
        const row = Math.floor(i / 9);
        const square = squareAt(col, row);
        const cursor = movableSquares.has(square) ? 'grab' : targetSquares.has(square) ? 'target' : '';
        return (
          <rect
            key={square}
            className={`xq-hit ${cursor}`}
            data-square={square}
            x={MARGIN + col * STEP - STEP / 2}
            y={MARGIN + row * STEP - STEP / 2}
            width={STEP}
            height={STEP}
          />
        );
      })}
    </svg>
  );
}

// Clocks re-render the game screen several times a second; the board only redraws when its inputs change.
export const XiangqiBoard = memo(XiangqiBoardImpl);
