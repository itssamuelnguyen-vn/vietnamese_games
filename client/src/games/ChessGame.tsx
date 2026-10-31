import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Chess, type Move, type PieceSymbol, type Square } from 'chess.js';
import { Chessboard, defaultPieces } from 'react-chessboard';
import { ABANDON_CLAIM_MS, type ChessColor, type ChessMove, type ChessView, type RoomView } from '@vg/shared';
import { api } from '../socket';
import { useI18n, type Strings } from '../i18n';
import { Avatar } from '../components/Avatar';
import { toast } from '../components/Toaster';
import { ChatCard, PlayersCard, RoomCodeCard } from '../components/RoomPanels';
import { findOpening } from './chessOpenings';
import { playSound } from '../sound';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  CopyIcon,
  DownloadIcon,
  EqualIcon,
  ExitIcon,
  FlagIcon,
  FlipIcon,
  FrownIcon,
  HandshakeIcon,
  PlayIcon,
  TrophyIcon,
  UndoIcon,
} from '../components/icons';

interface Props {
  room: RoomView;
  view: ChessView;
  onLeave: () => void;
}

const START_COUNT: Record<Exclude<PieceSymbol, 'k'>, number> = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const PIECE_VALUE: Record<Exclude<PieceSymbol, 'k'>, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const CAPTURE_ORDER = ['q', 'r', 'b', 'n', 'p'] as const;
const LOW_TIME_MS = 30_000;
const LOW_TIME_BEEP_MS = 10_000;

type Promotion = 'q' | 'r' | 'b' | 'n';
type SquarePair = { from: Square; to: Square };

// Re-renders every `ms` while `active`, so countdowns stay current between server updates.
function useTicker(active: boolean, ms = 250) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

const pad = (n: number) => String(n).padStart(2, '0');

const other = (c: ChessColor): ChessColor => (c === 'w' ? 'b' : 'w');

// Pieces each side has taken, derived from what is missing on the board.
function capturedPieces(chess: Chess) {
  const onBoard = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const row of chess.board()) {
    for (const sq of row) if (sq && sq.type !== 'k') onBoard[sq.color][sq.type]++;
  }
  const takenFrom = (color: ChessColor) =>
    CAPTURE_ORDER.flatMap((type) => Array(Math.max(0, START_COUNT[type] - onBoard[color][type])).fill(type) as PieceSymbol[]);
  const material = (color: ChessColor) =>
    CAPTURE_ORDER.reduce((sum, type) => sum + onBoard[color][type] * PIECE_VALUE[type], 0);
  const diff = material('w') - material('b');
  return {
    // White's trophies are black pieces and vice versa.
    w: { pieces: takenFrom('b'), advantage: Math.max(0, diff) },
    b: { pieces: takenFrom('w'), advantage: Math.max(0, -diff) },
  };
}

// Every position of the game so far, so any earlier move can be reviewed.
function replay(history: string[]) {
  const chess = new Chess();
  const fens = [chess.fen()];
  const moves: Move[] = [];
  for (const san of history) {
    moves.push(chess.move(san));
    fens.push(chess.fen());
  }
  return { fens, moves };
}

function describeMove(t: Strings, who: string, move: Move, prevWasCheck: boolean): string {
  const P = t.chess.pieces;
  const d = t.chess.describe;
  let text: string;
  if (move.isKingsideCastle()) text = d.castleKing(who);
  else if (move.isQueensideCastle()) text = d.castleQueen(who);
  else if (move.promotion) text = d.promote(who, P[move.promotion]);
  else if (prevWasCheck && move.piece === 'k') text = d.escape(who, move.to);
  else if (move.captured) text = d.capture(who, P[move.piece], P[move.captured], move.to);
  else if (prevWasCheck) text = d.block(who, P[move.piece], move.to);
  else text = d.move(who, P[move.piece], move.to);
  return move.san.endsWith('+') ? text + d.check : text;
}

function formatClock(ms: number): string {
  if (ms < 10_000) return `0:${(ms / 1000).toFixed(1).padStart(4, '0')}`;
  const total = Math.ceil(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Counts the running clock down locally between server updates.
function useLiveClock(clock: ChessView['clock']) {
  const receivedAt = useMemo(() => performance.now(), [clock]);
  const [now, setNow] = useState(receivedAt);
  useEffect(() => {
    if (!clock?.running) return;
    const id = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(id);
  }, [clock]);
  if (!clock) return null;
  const elapsed = clock.running ? Math.max(0, now - receivedAt) : 0;
  const live = (c: ChessColor) => (clock.running === c ? Math.max(0, clock.remaining[c] - elapsed) : clock.remaining[c]);
  return { w: live('w'), b: live('b') };
}

export function ChessGame({ room, view, onLeave }: Props) {
  const { t } = useI18n();
  const playerId = room.you;
  const myColor: ChessColor | null = view.white === playerId ? 'w' : view.black === playerId ? 'b' : null;
  const [flipped, setFlipped] = useState(false);
  const bottomColor: ChessColor = flipped ? other(myColor ?? 'w') : (myColor ?? 'w');
  const topColor = other(bottomColor);
  const isHost = room.hostId === playerId;
  const playerOf = (color: ChessColor) => room.players.find((p) => p.id === (color === 'w' ? view.white : view.black));
  const nameOf = (color: ChessColor) => playerOf(color)?.name ?? t.chess.opponent;
  const opponent = myColor ? playerOf(other(myColor)) : undefined;
  const myTurn = myColor === view.turn && !view.result;

  // Show our move immediately; the server confirms it. If rejected, snap back.
  const [optimisticFen, setOptimisticFen] = useState<string | null>(null);
  const [selected, setSelected] = useState<Square | null>(null);
  // null = following the live game; a number = reviewing the position after that many plies.
  const [reviewPly, setReviewPly] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(true);
  // A move queued while it's the opponent's turn; played as soon as it becomes legal.
  const [premove, setPremove] = useState<SquarePair | null>(null);
  // A pawn move waiting for the player to pick the promotion piece.
  const [promotion, setPromotion] = useState<SquarePair | null>(null);
  const receivedAt = useMemo(() => performance.now(), [room]);
  const sinceUpdate = () => performance.now() - receivedAt;

  useEffect(() => {
    setOptimisticFen(null);
    setSelected(null);
  }, [view.fen]);

  useEffect(() => {
    setShowResult(true);
  }, [view.result]);

  const plies = view.history.length;
  const opening = useMemo(() => findOpening(view.history), [view.fen]);
  const { fens, moves } = useMemo(() => replay(view.history), [view.fen]);
  const ply = reviewPly ?? plies;
  const reviewing = reviewPly !== null && reviewPly < plies;
  const goTo = (target: number) => setReviewPly(target >= plies ? null : Math.max(0, target));

  const shownFen = reviewing ? fens[ply] : (optimisticFen ?? view.fen);
  const shown = useMemo(() => new Chess(shownFen), [shownFen]);
  const live = useMemo(() => new Chess(view.fen), [view.fen]);
  const captured = useMemo(() => capturedPieces(shown), [shown]);
  const shownLastMove = ply > 0 ? moves[ply - 1] : null;
  const canMove = myTurn && !reviewing;
  // Players can pick up pieces on the opponent's turn too, to queue a premove.
  const canTouch = !!myColor && !view.result && !reviewing;
  const clocks = useLiveClock(view.clock);
  const offlineMs = opponent && !opponent.connected && opponent.offlineMs !== null ? opponent.offlineMs + sinceUpdate() : null;
  const firstMoveMs = myTurn && view.firstMoveMs !== null ? Math.max(0, view.firstMoveMs - sinceUpdate()) : null;
  useTicker((offlineMs !== null && !view.result) || firstMoveMs !== null);

  // Fire a queued premove once it's our turn, if it's legal in the new position.
  useEffect(() => {
    if (!premove) return;
    if (view.result) return setPremove(null);
    if (!myTurn) return;
    const queued = premove;
    setPremove(null);
    if (live.moves({ square: queued.from, verbose: true }).some((m) => m.to === queued.to)) {
      void tryMove(queued.from, queued.to, 'q');
    }
  }, [view.fen]);

  // Sounds for moves, the end of the game, incoming requests and low time.
  const seenPlies = useRef(plies);
  useEffect(() => {
    if (plies > seenPlies.current) {
      const last = moves.at(-1)!;
      playSound(/[+#]/.test(last.san) ? 'check' : last.captured ? 'capture' : 'move');
    }
    seenPlies.current = plies;
  }, [plies]);
  const seenResult = useRef(view.result);
  useEffect(() => {
    if (view.result && !seenResult.current) playSound('end');
    seenResult.current = view.result;
  }, [view.result]);
  const incomingTakeback = !!myColor && !!view.takebackRequest && view.takebackRequest !== playerId && !view.result;
  const incomingDraw = !!myColor && !!view.drawOffer && view.drawOffer !== playerId && !view.result;
  useEffect(() => {
    if (incomingDraw || incomingTakeback) playSound('notify');
  }, [incomingDraw, incomingTakeback]);
  const myClock = myColor ? clocks?.[myColor] : undefined;
  const lowTimeBeeped = useRef(false);
  if (plies === 0) lowTimeBeeped.current = false;
  if (myTurn && myClock !== undefined && myClock < LOW_TIME_BEEP_MS && !lowTimeBeeped.current) {
    lowTimeBeeped.current = true;
    playSound('lowtime');
  }

  // Flag the tab while it's this player's move.
  useEffect(() => {
    if (!myTurn) return;
    document.title = `● ${t.chess.yourTurnTitle} · ${t.appName}`;
    return () => {
      document.title = t.appName;
    };
  }, [myTurn, t]);

  // Arrow keys step through the move list, unless the player is typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft') goTo(ply - 1);
      else if (e.key === 'ArrowRight') goTo(ply + 1);
      else return;
      e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function send(move: ChessMove) {
    const r = await api.move(move);
    if (!r.ok) toast(t.errors[r.error]);
    return r.ok;
  }

  async function tryMove(from: Square, to: Square, promote?: Promotion) {
    const candidates = live.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (candidates.length === 0) return;
    if (!promote && candidates.some((m) => m.promotion)) {
      setSelected(null);
      setPromotion({ from, to });
      return;
    }
    const local = new Chess(view.fen);
    local.move({ from, to, promotion: promote ?? 'q' });
    setOptimisticFen(local.fen());
    setSelected(null);
    setPromotion(null);
    if (!(await send({ type: 'move', from, to, promotion: promote ?? 'q' }))) setOptimisticFen(null);
  }

  function onSquareClick(square: Square) {
    if (!canTouch) return;
    if (premove) {
      setPremove(null);
      setSelected(null);
      return;
    }
    const piece = live.get(square);
    if (piece && piece.color === myColor) {
      setSelected(square === selected ? null : square);
      return;
    }
    if (!selected) return;
    if (canMove) void tryMove(selected, square);
    else {
      setPremove({ from: selected, to: square });
      setSelected(null);
    }
  }

  function downloadPgn() {
    const chess = new Chess();
    for (const san of view.history) chess.move(san);
    const result = !view.result ? '*' : !view.result.winner ? '1/2-1/2' : view.result.winner === view.white ? '1-0' : '0-1';
    const d = new Date();
    chess.setHeader('Event', t.appName);
    chess.setHeader('Site', location.origin);
    chess.setHeader('Date', `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`);
    chess.setHeader('White', nameOf('w'));
    chess.setHeader('Black', nameOf('b'));
    chess.setHeader('Result', result);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([`${chess.pgn()}\n`], { type: 'application/x-chess-pgn' }));
    link.download = `chess-${room.code}.pgn`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function copyFen() {
    try {
      await navigator.clipboard.writeText(shownFen);
      toast(t.chess.fenCopied);
    } catch {
      prompt(t.chess.copyFen, shownFen);
    }
  }

  async function rematch() {
    const r = isHost ? await api.start() : await api.rematch();
    if (!r.ok) toast(t.errors[r.error]);
  }

  async function claimWin() {
    const r = await api.claimWin();
    if (!r.ok) toast(t.errors[r.error]);
  }

  function resign() {
    if (confirm(t.chess.confirmResign)) void send({ type: 'resign' });
  }

  const squareStyles: Record<string, CSSProperties> = {};
  if (shownLastMove) {
    squareStyles[shownLastMove.from] = { background: 'var(--board-last)' };
    squareStyles[shownLastMove.to] = { background: 'var(--board-last)' };
  }
  if (shown.inCheck() && !optimisticFen) {
    const king = shown.findPiece({ type: 'k', color: shown.turn() })[0];
    if (king) squareStyles[king] = { background: 'var(--board-check)' };
  }
  if (premove) {
    squareStyles[premove.from] = { background: 'var(--board-premove)' };
    squareStyles[premove.to] = { background: 'var(--board-premove)' };
  }
  if (selected) squareStyles[selected] = { background: canMove ? 'var(--board-selected)' : 'var(--board-premove)' };
  if (selected && canMove) {
    for (const m of live.moves({ square: selected, verbose: true })) {
      squareStyles[m.to] = {
        background: m.captured
          ? 'radial-gradient(circle, transparent 56%, var(--board-hint) 58%)'
          : 'radial-gradient(circle, var(--board-hint) 20%, transparent 24%)',
        cursor: 'pointer',
      };
    }
  }

  const playerBar = (color: ChessColor) => {
    const p = playerOf(color);
    const cap = captured[color];
    const running = view.clock?.running === color && !view.result;
    const ms = clocks?.[color];
    return (
      <div className={`player-bar ${running || (!view.clock && view.turn === color && !view.result) ? 'active' : ''}`}>
        <Avatar id={p?.id ?? color} name={p?.name ?? '?'} size={44} online={p?.connected} />
        <div className="player-bar-info">
          <span className="player-bar-name">
            {p?.name ?? '…'} {p?.id === playerId && <span className="muted">{t.room.youSuffix}</span>}
          </span>
          <span className="player-bar-sub">
            <span className="color-piece">{defaultPieces[`${color}P`]?.({ svgStyle: { width: 16, height: 16 } })}</span>
            <span className="muted small">{cap.advantage > 0 ? `+${cap.advantage}` : t.chess.balanced}</span>
            <span className="captured">
              {cap.pieces.map((type, i) => (
                <span key={i} className="captured-piece">
                  {defaultPieces[`${other(color)}${type.toUpperCase()}`]?.({ svgStyle: { width: 16, height: 16 } })}
                </span>
              ))}
            </span>
          </span>
        </div>
        {ms !== undefined && (
          <span className={`clock ${running ? 'running' : ''} ${ms < LOW_TIME_MS ? 'low' : ''}`}>{formatClock(ms)}</span>
        )}
      </div>
    );
  };

  // Status card: whose turn, what just happened, or the result.
  let statusTitle: string;
  let statusLines: string[] = [];
  const iAskedRematch = room.rematchVotes.includes(playerId);
  const otherRematch = room.players.find((p) => p.id !== playerId && room.rematchVotes.includes(p.id));
  if (view.result) {
    statusTitle = resultHeadline(t, view, playerId);
    statusLines = [resultReason(t, view, playerId)];
    if (otherRematch) statusLines.push(t.room.rematchFrom(otherRematch.name));
  } else if (incomingTakeback) {
    statusTitle = t.chess.takebackFrom(opponent?.name ?? t.chess.opponent);
    statusLines = [t.chess.takebackHint];
  } else if (incomingDraw) {
    statusTitle = t.chess.drawOfferFrom(opponent?.name ?? t.chess.opponent);
    statusLines = [t.chess.drawOfferHint];
  } else {
    statusTitle = !myColor
      ? view.turn === 'w'
        ? t.chess.whiteToMove
        : t.chess.blackToMove
      : myTurn
        ? t.chess.yourTurnTitle
        : t.chess.turnOfTitle(nameOf(view.turn));
    const last = moves.at(-1);
    if (last) {
      const who = playerOf(last.color)?.id === playerId ? t.room.you : nameOf(last.color);
      statusLines.push(describeMove(t, who, last, moves.at(-2)?.san.endsWith('+') ?? false));
    } else {
      statusLines.push(t.chess.gameStarted);
    }
    statusLines.push(!myColor ? t.chess.hintSpectating : myTurn ? t.chess.hintYourTurn : t.chess.hintWaiting);
    if (firstMoveMs !== null) statusLines.push(t.chess.firstMoveHint(Math.ceil(firstMoveMs / 1000)));
    if (premove) statusLines.push(t.chess.premove(premove.from, premove.to));
    if (view.drawOffer === playerId) statusLines.push(t.chess.drawOfferSent);
    if (view.takebackRequest === playerId) statusLines.push(t.chess.takebackSent);
  }
  const claimable = offlineMs !== null && offlineMs >= ABANDON_CLAIM_MS;

  const movePairs: [string, string | undefined][] = [];
  for (let i = 0; i < plies; i += 2) movePairs.push([view.history[i], view.history[i + 1]]);

  const moveButton = (san: string | undefined, index: number) =>
    san === undefined ? (
      <span />
    ) : (
      <button className={`move ${index + 1 === ply ? 'current' : ''}`} onClick={() => goTo(index + 1)}>
        {san}
      </button>
    );

  return (
    <div className="game-layout">
      <aside className="game-left">
        <RoomCodeCard code={room.code} />
        <PlayersCard
          room={room}
          subtitle={(id) => (id === view.white ? t.chess.white : id === view.black ? t.chess.black : null)}
        />
        <button className="btn btn-ghost" onClick={onLeave}>
          <ExitIcon /> {t.room.leave}
        </button>
      </aside>

      <section className="game-center">
        {playerBar(topColor)}
        <div className="board-frame">
          <Chessboard
            options={{
              id: 'chess',
              position: shownFen,
              boardOrientation: bottomColor === 'b' ? 'black' : 'white',
              squareStyles,
              allowDrawingArrows: false,
              allowDragging: canTouch,
              animationDurationInMs: 220,
              darkSquareStyle: { backgroundColor: 'var(--board-dark)' },
              lightSquareStyle: { backgroundColor: 'var(--board-light)' },
              darkSquareNotationStyle: { color: 'var(--board-light)', fontWeight: 600 },
              lightSquareNotationStyle: { color: 'var(--board-dark)', fontWeight: 600 },
              canDragPiece: ({ piece }) => canTouch && piece.pieceType[0] === myColor,
              onPieceDrop: ({ sourceSquare, targetSquare }) => {
                if (!targetSquare || !canTouch || sourceSquare === targetSquare) return false;
                if (!canMove) {
                  setPremove({ from: sourceSquare as Square, to: targetSquare as Square });
                  return false;
                }
                const legal = live
                  .moves({ square: sourceSquare as Square, verbose: true })
                  .some((m) => m.to === targetSquare);
                if (legal) void tryMove(sourceSquare as Square, targetSquare as Square);
                return legal;
              },
              onSquareClick: ({ square }) => onSquareClick(square as Square),
            }}
          />
          {promotion && myColor && (
            <div className="promo-overlay" onClick={() => setPromotion(null)}>
              <div className="promo-card" onClick={(e) => e.stopPropagation()}>
                <p className="field-label">{t.chess.promoteTo}</p>
                <div className="promo-options">
                  {(['q', 'r', 'b', 'n'] as const).map((p) => (
                    <button key={p} onClick={() => tryMove(promotion.from, promotion.to, p)} aria-label={t.chess.pieces[p]} title={t.chess.pieces[p]}>
                      {defaultPieces[`${myColor}${p.toUpperCase()}`]?.({ svgStyle: { width: 52, height: 52 } })}
                    </button>
                  ))}
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setPromotion(null)}>
                  {t.chess.cancel}
                </button>
              </div>
            </div>
          )}
          {view.result && showResult && !reviewing && (
            <ResultOverlay
              view={view}
              room={room}
              isHost={isHost}
              askedRematch={iAskedRematch}
              onRematch={rematch}
              onClose={() => setShowResult(false)}
            />
          )}
        </div>
        {playerBar(bottomColor)}
      </section>

      <aside className="game-right">
        <section className={`card panel status-card ${myTurn && !incomingDraw && !incomingTakeback ? 'mine' : ''} ${view.result ? 'over' : ''}`}>
          <h2>
            <span className="status-dot" /> {statusTitle}
          </h2>
          {statusLines.map((line, i) => (
            <p key={i} className="muted">
              {line}
            </p>
          ))}
          {incomingTakeback && (
            <div className="status-actions">
              <button className="btn btn-primary btn-sm" onClick={() => send({ type: 'accept-takeback' })}>
                {t.chess.acceptDraw}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => send({ type: 'decline-takeback' })}>
                {t.chess.declineDraw}
              </button>
            </div>
          )}
          {offlineMs !== null && !view.result && (
            <div className="offline-note">
              <strong>{t.chess.opponentOffline(opponent!.name)}</strong>
              <span className="muted small">
                {claimable ? t.chess.claimNow : t.chess.claimIn(Math.ceil((ABANDON_CLAIM_MS - offlineMs) / 1000))}
              </span>
              {claimable && (
                <button className="btn btn-primary btn-sm" onClick={claimWin}>
                  <TrophyIcon /> {t.chess.claimWin}
                </button>
              )}
            </div>
          )}
          {incomingDraw && !incomingTakeback && (
            <div className="status-actions">
              <button className="btn btn-primary btn-sm" onClick={() => send({ type: 'accept-draw' })}>
                {t.chess.acceptDraw}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => send({ type: 'decline-draw' })}>
                {t.chess.declineDraw}
              </button>
            </div>
          )}
        </section>

        <section className="card panel moves-panel">
          <header className="panel-head">
            <h2>{t.chess.moves}</h2>
            <span className="panel-tools">
              {reviewing ? (
                <span className="tag tag-gold">{t.chess.reviewing}</span>
              ) : (
                opening && <span className="muted small opening">{t.chess.openings[opening]}</span>
              )}
              {plies > 0 && (
                <>
                  <button className="tool-btn" onClick={copyFen} aria-label={t.chess.copyFen} title={t.chess.copyFen}>
                    <CopyIcon />
                  </button>
                  <button className="tool-btn" onClick={downloadPgn} aria-label={t.chess.downloadPgn} title={t.chess.downloadPgn}>
                    <DownloadIcon />
                  </button>
                </>
              )}
            </span>
          </header>
          {plies === 0 ? (
            <p className="muted small">{t.chess.noMoves}</p>
          ) : (
            <ol className="move-list">
              {movePairs.map(([w, b], i) => (
                <li key={i}>
                  <span className="move-no">{i + 1}.</span>
                  {moveButton(w, i * 2)}
                  {moveButton(b, i * 2 + 1)}
                </li>
              ))}
            </ol>
          )}
          <nav className="move-nav">
            <button onClick={() => goTo(0)} disabled={ply === 0} aria-label={t.chess.firstMove} title={t.chess.firstMove}>
              <ChevronsLeftIcon />
            </button>
            <button onClick={() => goTo(ply - 1)} disabled={ply === 0} aria-label={t.chess.prevMove} title={t.chess.prevMove}>
              <ChevronLeftIcon />
            </button>
            <button onClick={() => goTo(ply + 1)} disabled={!reviewing} aria-label={t.chess.nextMove} title={t.chess.nextMove}>
              <ChevronRightIcon />
            </button>
            <button onClick={() => goTo(plies)} disabled={!reviewing} aria-label={t.chess.lastMove} title={t.chess.lastMove}>
              <ChevronsRightIcon />
            </button>
          </nav>
        </section>

        <div className="action-row">
          {myColor && !view.result && (
            <>
              <button
                className="btn btn-secondary"
                disabled={!view.canOfferDraw && view.drawOffer !== opponent?.id}
                onClick={() => send({ type: 'offer-draw' })}
              >
                <EqualIcon /> {view.drawOffer === playerId ? t.chess.drawOffered : t.chess.offerDraw}
              </button>
              <button
                className="btn btn-secondary"
                disabled={!view.canRequestTakeback}
                onClick={() => send({ type: 'request-takeback' })}
              >
                <UndoIcon /> {view.takebackRequest === playerId ? t.chess.takebackRequested : t.chess.takeback}
              </button>
              <button className="btn btn-secondary danger" onClick={resign}>
                <FlagIcon /> {t.chess.resign}
              </button>
            </>
          )}
          {view.result && myColor && (
            <button className="btn btn-primary" disabled={!isHost && iAskedRematch} onClick={rematch}>
              <PlayIcon /> {isHost ? t.room.playAgain : iAskedRematch ? t.room.rematchRequested : t.room.requestRematch}
            </button>
          )}
          <button
            className="btn btn-secondary btn-square"
            onClick={() => setFlipped((f) => !f)}
            aria-label={t.chess.flipBoard}
            title={t.chess.flipBoard}
          >
            <FlipIcon />
          </button>
        </div>

        <ChatCard room={room} recipient={opponent?.name} />
      </aside>
    </div>
  );
}

function resultHeadline(t: Strings, view: ChessView, playerId: string): string {
  if (view.result?.reason === 'aborted') return t.chess.resultAborted;
  const winner = view.result?.winner;
  if (!winner) return t.chess.resultDraw;
  if (winner === playerId) return t.chess.resultWin;
  if (view.white === playerId || view.black === playerId) return t.chess.resultLose;
  return t.chess.playerWins(winner === view.white ? t.chess.white : t.chess.black);
}

function resultReason(t: Strings, view: ChessView, playerId: string): string {
  const result = view.result!;
  const lost = result.winner && result.winner !== playerId && (view.white === playerId || view.black === playerId);
  return lost && result.reason === 'resign' ? t.chess.youResigned : t.chess.endReasons[result.reason];
}

interface OverlayProps {
  view: ChessView;
  room: RoomView;
  isHost: boolean;
  askedRematch: boolean;
  onRematch: () => void;
  onClose: () => void;
}

function ResultOverlay({ view, room, isHost, askedRematch, onRematch, onClose }: OverlayProps) {
  const { t } = useI18n();
  const playerId = room.you;
  const winner = view.result?.winner;
  const isPlayer = view.white === playerId || view.black === playerId;
  const kind = !winner ? 'draw' : winner === playerId ? 'win' : isPlayer ? 'lose' : 'draw';
  const winnerName = room.players.find((p) => p.id === winner)?.name;
  const Icon = kind === 'win' ? TrophyIcon : kind === 'lose' ? FrownIcon : HandshakeIcon;

  return (
    <div className="result-overlay">
      <div className={`result-card ${kind}`}>
        {kind === 'win' && (
          <div className="confetti" aria-hidden="true">
            {Array.from({ length: 18 }, (_, i) => (
              <span key={i} style={{ '--i': i } as CSSProperties} />
            ))}
          </div>
        )}
        <span className="result-icon">
          <Icon />
        </span>
        <h2>{resultHeadline(t, view, playerId)}</h2>
        <p>
          {resultReason(t, view, playerId)}
          {winner && winner !== playerId && winnerName ? ` · ${t.chess.playerWins(winnerName)}` : ''}
        </p>
        <div className="result-actions">
          {isPlayer ? (
            <button className="btn btn-primary" disabled={!isHost && askedRematch} onClick={onRematch}>
              <PlayIcon /> {isHost ? t.room.playAgain : askedRematch ? t.room.rematchRequested : t.room.requestRematch}
            </button>
          ) : (
            <span className="muted">{t.room.waitingForHost}</span>
          )}
          <button className="btn btn-ghost" onClick={onClose}>
            {t.chess.reviewBoard}
          </button>
        </div>
      </div>
    </div>
  );
}
