import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Chess, type Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import type { ChessMove, ChessView, ErrorCode } from '@vg/shared';
import { api, playerId } from '../socket';
import { errorText, t } from '../i18n';

interface Props {
  view: ChessView;
  names: Record<string, string>;
}

export function ChessGame({ view, names }: Props) {
  const myColor = view.white === playerId ? 'w' : view.black === playerId ? 'b' : null;
  const opponentId = myColor === 'w' ? view.black : view.white;
  const myTurn = myColor === view.turn && !view.result;

  // Show our move immediately; the server confirms it. If rejected, snap back.
  const [optimisticFen, setOptimisticFen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Square | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);

  useEffect(() => {
    setOptimisticFen(null);
    setSelected(null);
  }, [view.fen]);

  const chess = useMemo(() => new Chess(view.fen), [view.fen]);

  async function tryMove(from: Square, to: Square): Promise<boolean> {
    if (!myTurn) return false;
    const local = new Chess(view.fen);
    try {
      // Always promote to a queen to keep things simple.
      local.move({ from, to, promotion: 'q' });
    } catch {
      return false;
    }
    setOptimisticFen(local.fen());
    setSelected(null);
    setError(null);
    const move: ChessMove = { type: 'move', from, to, promotion: 'q' };
    const r = await api.move(move);
    if (!r.ok) {
      setOptimisticFen(null);
      setError(r.error);
    }
    return true;
  }

  function onSquareClick(square: Square) {
    if (!myTurn) return;
    const piece = chess.get(square);
    if (piece && piece.color === myColor) {
      setSelected(square === selected ? null : square);
      return;
    }
    if (selected) void tryMove(selected, square);
  }

  async function resign() {
    if (!confirm(t.chess.confirmResign)) return;
    const r = await api.move({ type: 'resign' } satisfies ChessMove);
    if (!r.ok) setError(r.error);
  }

  const squareStyles: Record<string, CSSProperties> = {};
  if (view.lastMove) {
    squareStyles[view.lastMove.from] = { background: 'var(--board-last)' };
    squareStyles[view.lastMove.to] = { background: 'var(--board-last)' };
  }
  if (view.inCheck && !optimisticFen) {
    const king = chess.findPiece({ type: 'k', color: view.turn })[0];
    if (king) squareStyles[king] = { background: 'var(--board-check)' };
  }
  if (selected) {
    squareStyles[selected] = { background: 'var(--board-selected)' };
    for (const m of chess.moves({ square: selected, verbose: true })) {
      squareStyles[m.to] = {
        background: m.captured
          ? 'radial-gradient(circle, transparent 58%, var(--board-hint) 60%)'
          : 'radial-gradient(circle, var(--board-hint) 22%, transparent 24%)',
      };
    }
  }

  let status: string;
  if (view.result) {
    const { winner, reason } = view.result;
    const reasonText = t.chess.endReasons[reason];
    if (!winner) status = t.chess.draw(reasonText);
    else if (winner === playerId) status = t.chess.youWin(reasonText);
    else status = t.chess.playerWins(names[winner] ?? t.chess.opponent, reason === 'resign' ? t.chess.youResigned : reasonText);
  } else if (!myColor) {
    status = view.turn === 'w' ? t.chess.whiteToMove : t.chess.blackToMove;
  } else {
    status = myTurn ? t.chess.yourTurn : t.chess.turnOf(names[opponentId] ?? t.chess.opponent);
    if (view.inCheck) status += t.chess.check;
  }

  const movePairs: [string, string | undefined][] = [];
  for (let i = 0; i < view.history.length; i += 2) {
    movePairs.push([view.history[i], view.history[i + 1]]);
  }

  return (
    <div className="chess">
      <div className="chess-board">
        <PlayerTag name={names[opponentId] ?? '…'} color={myColor === 'w' ? 'b' : 'w'} />
        <Chessboard
          options={{
            id: 'chess',
            position: optimisticFen ?? view.fen,
            boardOrientation: myColor === 'b' ? 'black' : 'white',
            squareStyles,
            allowDrawingArrows: false,
            darkSquareStyle: { backgroundColor: 'var(--board-dark)' },
            lightSquareStyle: { backgroundColor: 'var(--board-light)' },
            canDragPiece: ({ piece }) => myTurn && piece.pieceType[0] === myColor,
            onPieceDrop: ({ sourceSquare, targetSquare }) => {
              if (!targetSquare || !myTurn) return false;
              const legal = chess
                .moves({ square: sourceSquare as Square, verbose: true })
                .some((m) => m.to === targetSquare);
              if (legal) void tryMove(sourceSquare as Square, targetSquare as Square);
              return legal;
            },
            onSquareClick: ({ square }) => onSquareClick(square as Square),
          }}
        />
        <PlayerTag name={myColor ? t.chess.youLabel(names[playerId]) : names[view.white]} color={myColor ?? 'w'} />
      </div>

      <div className="chess-info card">
        <p className={`status ${myTurn ? 'my-turn' : ''}`}>{status}</p>
        {error && <p className="error">{errorText(error)}</p>}
        <ol className="moves">
          {movePairs.map(([w, b], i) => (
            <li key={i}>
              <span>{w}</span>
              <span>{b ?? ''}</span>
            </li>
          ))}
        </ol>
        {myColor && !view.result && (
          <button className="secondary danger" onClick={resign}>
            {t.chess.resign}
          </button>
        )}
      </div>
    </div>
  );
}

function PlayerTag({ name, color }: { name: string; color: 'w' | 'b' }) {
  return (
    <div className="player-tag">
      <span className={`piece-dot ${color}`} />
      {name}
    </div>
  );
}
