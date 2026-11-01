import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ABANDON_CLAIM_MS, type ClockView, type RoomView } from '@vg/shared';
import { api } from '../../socket';
import { useI18n } from '../../i18n';
import { Avatar } from '../../components/Avatar';
import { Ellipsis } from '../../components/Ellipsis';
import { toast } from '../../components/Toaster';
import { ChatCard, PlayersCard, RoomCodeCard } from '../../components/RoomPanels';
import { playSound, type SoundKind } from '../../sound';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  EqualIcon,
  ExitIcon,
  FlagIcon,
  FlipIcon,
  FrownIcon,
  HandshakeIcon,
  PlayIcon,
  TrophyIcon,
  UndoIcon,
} from '../../components/icons';

// Shared screen for two-player board games (chess, xiangqi). Each game supplies its board,
// move notation and wording; this component owns clocks, the status card, move review,
// draw/takeback/resign/rematch actions, chat, sounds and the result overlay.

const LOW_TIME_MS = 30_000;
const LOW_TIME_BEEP_MS = 10_000;

// Fields every two-player game view has (ChessView and XiangqiView both fit).
export interface DuelView {
  turn: string;
  inCheck: boolean;
  result: { winner: string | null; reason: string } | null;
  drawOffer: string | null;
  canOfferDraw: boolean;
  takebackRequest: string | null;
  canRequestTakeback: boolean;
  clock: ClockView<string> | null;
  firstMoveMs: number | null;
}

export type DuelAction =
  | { type: 'resign' }
  | { type: 'offer-draw' }
  | { type: 'accept-draw' }
  | { type: 'decline-draw' }
  | { type: 'request-takeback' }
  | { type: 'accept-takeback' }
  | { type: 'decline-takeback' };

export interface BoardRenderProps {
  // Side shown at the bottom of the board.
  bottom: string;
  // Plies to show (less than the game length while reviewing).
  ply: number;
  reviewing: boolean;
  // The player may move now.
  canMove: boolean;
  // The player may pick up pieces (their turn, or queuing a premove).
  canTouch: boolean;
}

export interface DuelScreenProps {
  room: RoomView;
  view: DuelView;
  // [first mover, second mover] side keys and their player ids.
  sides: [string, string];
  playerIds: Record<string, string>;
  // Notation of each move so far.
  moveLabels: string[];
  sideName: (side: string) => string;
  // Status title for spectators, e.g. "White to move".
  sideToMove: (side: string) => string;
  endReason: (reason: string) => string;
  gameStarted: string;
  noMoves: string;
  // Description of the latest move (who did what), if any.
  lastMoveText: string | null;
  // Extra status lines (e.g. a queued premove).
  extraStatus?: string[];
  soundForPly: (ply: number) => SoundKind;
  renderBoard: (props: BoardRenderProps) => ReactNode;
  // Small extras under each player's name (captured pieces, material).
  playerExtra?: (side: string, ply: number) => ReactNode;
  // Next to the "Moves" heading (opening name, export buttons).
  movesTools?: ReactNode;
  onLeave: () => void;
  send: (action: DuelAction) => Promise<boolean>;
}

export function formatClock(ms: number): string {
  if (ms < 10_000) return `0:${(ms / 1000).toFixed(1).padStart(4, '0')}`;
  const total = Math.ceil(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Re-renders every `ms` while `active`, so countdowns stay current between server updates.
function useTicker(active: boolean, ms = 250) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

// Counts the running clock down locally between server updates.
function useLiveClock(clock: ClockView<string> | null) {
  const receivedAt = useMemo(() => performance.now(), [clock]);
  useTicker(!!clock?.running, 100);
  if (!clock) return null;
  const elapsed = clock.running ? Math.max(0, performance.now() - receivedAt) : 0;
  return (side: string) => (clock.running === side ? Math.max(0, clock.remaining[side] - elapsed) : clock.remaining[side]);
}

export function DuelScreen(props: DuelScreenProps) {
  const { room, view, sides, playerIds, moveLabels, send } = props;
  const { t } = useI18n();
  const playerId = room.you;
  const sideOf = (id: string) => sides.find((s) => playerIds[s] === id) ?? null;
  const mySide = sideOf(playerId);
  const otherSide = (s: string) => (s === sides[0] ? sides[1] : sides[0]);
  const playerOn = (side: string) => room.players.find((p) => p.id === playerIds[side]);
  const nameOf = (side: string) => playerOn(side)?.name ?? t.chess.opponent;
  const opponent = mySide ? playerOn(otherSide(mySide)) : undefined;
  const myTurn = mySide === view.turn && !view.result;

  const [flipped, setFlipped] = useState(false);
  const bottom = flipped ? otherSide(mySide ?? sides[0]) : (mySide ?? sides[0]);
  const top = otherSide(bottom);

  // null = following the live game; a number = reviewing the position after that many plies.
  const [reviewPly, setReviewPly] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(true);
  // Every server update is a fresh object, so react to the result's content, not its identity.
  const resultKey = view.result ? JSON.stringify(view.result) : '';
  useEffect(() => setShowResult(true), [resultKey]);

  const plies = moveLabels.length;
  // A takeback or a new game can leave the reviewed move behind; go back to the live position.
  useEffect(() => {
    if (reviewPly !== null && (reviewPly >= plies || plies === 0)) setReviewPly(null);
  }, [plies, reviewPly]);
  const ply = reviewPly ?? plies;
  const reviewing = reviewPly !== null && reviewPly < plies;
  const goTo = (target: number) => setReviewPly(target >= plies ? null : Math.max(0, target));
  const canMove = myTurn && !reviewing;
  const canTouch = !!mySide && !view.result && !reviewing;

  const receivedAt = useMemo(() => performance.now(), [room]);
  const sinceUpdate = () => performance.now() - receivedAt;
  const clockOf = useLiveClock(view.clock);
  const offlineMs = opponent && !opponent.connected && opponent.offlineMs !== null ? opponent.offlineMs + sinceUpdate() : null;
  const firstMoveMs = myTurn && view.firstMoveMs !== null ? Math.max(0, view.firstMoveMs - sinceUpdate()) : null;
  useTicker((offlineMs !== null && !view.result) || firstMoveMs !== null);

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

  // Sounds for moves, the end of the game, incoming requests and low time.
  const seenPlies = useRef(plies);
  useEffect(() => {
    if (plies > seenPlies.current) playSound(props.soundForPly(plies - 1));
    seenPlies.current = plies;
  }, [plies]);
  const seenResult = useRef(view.result);
  useEffect(() => {
    if (view.result && !seenResult.current) playSound('end');
    seenResult.current = view.result;
  }, [view.result]);
  const incomingTakeback = !!mySide && !!view.takebackRequest && view.takebackRequest !== playerId && !view.result;
  const incomingDraw = !!mySide && !!view.drawOffer && view.drawOffer !== playerId && !view.result;
  useEffect(() => {
    if (incomingDraw || incomingTakeback) playSound('notify');
  }, [incomingDraw, incomingTakeback]);
  const myClock = mySide && clockOf ? clockOf(mySide) : undefined;
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

  async function act(action: DuelAction) {
    await send(action);
  }

  function resign() {
    if (confirm(t.chess.confirmResign)) void act({ type: 'resign' });
  }

  // Both players agree to the next game (a bot always does), so nobody is pulled out of looking
  // over the last one.
  async function rematch() {
    const r = await api.rematch();
    if (!r.ok) toast(t.errors[r.error]);
  }

  async function claimWin() {
    const r = await api.claimWin();
    if (!r.ok) toast(t.errors[r.error]);
  }

  // Result wording from this viewer's point of view.
  const result = view.result;
  const isPlayer = mySide !== null;
  const headline = !result
    ? ''
    : result.reason === 'aborted'
      ? t.chess.resultAborted
      : !result.winner
        ? t.chess.resultDraw
        : result.winner === playerId
          ? t.chess.resultWin
          : isPlayer
            ? t.chess.resultLose
            : t.chess.playerWins(props.sideName(sideOf(result.winner) ?? sides[0]));
  const reasonText = !result
    ? ''
    : result.winner && result.winner !== playerId && isPlayer && result.reason === 'resign'
      ? t.chess.youResigned
      : props.endReason(result.reason);

  const iAskedRematch = room.rematchVotes.includes(playerId);
  const otherRematch = room.players.find((p) => p.id !== playerId && room.rematchVotes.includes(p.id));
  const againstBot = room.players.some((p) => p.id !== playerId && p.bot);
  const rematchLabel = iAskedRematch ? t.room.rematchRequested : againstBot ? t.room.playAgain : otherRematch ? t.room.acceptRematch : t.room.requestRematch;

  let statusTitle: string;
  let statusLines: string[] = [];
  if (result) {
    statusTitle = headline;
    statusLines = [reasonText];
    if (otherRematch) statusLines.push(t.room.rematchFrom(otherRematch.name));
  } else if (incomingTakeback) {
    statusTitle = t.chess.takebackFrom(opponent?.name ?? t.chess.opponent);
    statusLines = [t.chess.takebackHint];
  } else if (incomingDraw) {
    statusTitle = t.chess.drawOfferFrom(opponent?.name ?? t.chess.opponent);
    statusLines = [t.chess.drawOfferHint];
  } else {
    statusTitle = !mySide ? props.sideToMove(view.turn) : myTurn ? t.chess.yourTurnTitle : t.chess.turnOfTitle(nameOf(view.turn));
    statusLines.push(props.lastMoveText ?? props.gameStarted);
    statusLines.push(!mySide ? t.chess.hintSpectating : myTurn ? t.chess.hintYourTurn : t.chess.hintWaiting);
    if (firstMoveMs !== null) statusLines.push(t.chess.firstMoveHint(Math.ceil(firstMoveMs / 1000)));
    statusLines.push(...(props.extraStatus ?? []));
    if (view.drawOffer === playerId) statusLines.push(t.chess.drawOfferSent);
    if (view.takebackRequest === playerId) statusLines.push(t.chess.takebackSent);
  }
  const claimable = offlineMs !== null && offlineMs >= ABANDON_CLAIM_MS;

  const playerBar = (side: string) => {
    const p = playerOn(side);
    const running = view.clock?.running === side && !view.result;
    const ms = clockOf?.(side);
    return (
      <div className={`player-bar ${running || (!view.clock && view.turn === side && !view.result) ? 'active' : ''}`}>
        <Avatar id={p?.id ?? side} name={p?.name ?? '?'} size={44} online={p?.connected} />
        <div className="player-bar-info">
          <span className="player-bar-name">
            {p?.name ?? '…'} {p?.id === playerId && <span className="muted">{t.room.youSuffix}</span>}
          </span>
          <span className="player-bar-sub">{props.playerExtra?.(side, ply)}</span>
        </div>
        {ms !== undefined && (
          <span className={`clock ${running ? 'running' : ''} ${ms < LOW_TIME_MS ? 'low' : ''}`}>{formatClock(ms)}</span>
        )}
      </div>
    );
  };

  const movePairs: [string, string | undefined][] = [];
  for (let i = 0; i < plies; i += 2) movePairs.push([moveLabels[i], moveLabels[i + 1]]);
  const moveButton = (label: string | undefined, index: number) =>
    label === undefined ? (
      <span />
    ) : (
      <button className={`move ${index + 1 === ply ? 'current' : ''}`} onClick={() => goTo(index + 1)}>
        {label}
      </button>
    );

  return (
    <div className="game-layout">
      <aside className="game-left">
        <RoomCodeCard code={room.code} />
        <PlayersCard room={room} subtitle={(id) => (sideOf(id) ? props.sideName(sideOf(id)!) : null)} />
        <button className="btn btn-ghost" onClick={props.onLeave}>
          <ExitIcon /> {t.room.leave}
        </button>
      </aside>

      <section className="game-center">
        {playerBar(top)}
        <div className="board-frame">
          {props.renderBoard({ bottom, ply, reviewing, canMove, canTouch })}
          {result && showResult && !reviewing && (
            <ResultOverlay
              kind={!result.winner || result.reason === 'aborted' ? 'draw' : result.winner === playerId ? 'win' : isPlayer ? 'lose' : 'draw'}
              headline={headline}
              detail={`${reasonText}${result.winner && result.winner !== playerId && playerOn(sideOf(result.winner) ?? '') ? ` · ${t.chess.playerWins(playerOn(sideOf(result.winner)!)!.name)}` : ''}`}
              rematch={
                isPlayer
                  ? { label: rematchLabel, disabled: iAskedRematch, onClick: rematch }
                  : null
              }
              onClose={() => setShowResult(false)}
            />
          )}
        </div>
        {playerBar(bottom)}
      </section>

      <aside className="game-right">
        <section className={`card panel status-card ${myTurn && !incomingDraw && !incomingTakeback ? 'mine' : ''} ${result ? 'over' : ''}`}>
          <h2>
            <span className="status-dot" /> {statusTitle}
          </h2>
          {statusLines.map((line, i) => (
            <p key={i} className="muted">
              <Ellipsis text={line} />
            </p>
          ))}
          {incomingTakeback && (
            <div className="status-actions">
              <button className="btn btn-primary btn-sm" onClick={() => act({ type: 'accept-takeback' })}>
                {t.chess.acceptDraw}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => act({ type: 'decline-takeback' })}>
                {t.chess.declineDraw}
              </button>
            </div>
          )}
          {offlineMs !== null && !result && (
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
              <button className="btn btn-primary btn-sm" onClick={() => act({ type: 'accept-draw' })}>
                {t.chess.acceptDraw}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => act({ type: 'decline-draw' })}>
                {t.chess.declineDraw}
              </button>
            </div>
          )}
        </section>

        <section className="card panel moves-panel">
          <header className="panel-head">
            <h2>{t.chess.moves}</h2>
            <span className="panel-tools">
              {reviewing && <span className="tag tag-gold">{t.chess.reviewing}</span>}
              {props.movesTools}
            </span>
          </header>
          {plies === 0 ? (
            <p className="muted small">{props.noMoves}</p>
          ) : (
            <ol className="move-list">
              {movePairs.map(([a, b], i) => (
                <li key={i}>
                  <span className="move-no">{i + 1}.</span>
                  {moveButton(a, i * 2)}
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
          {mySide && !result && (
            <>
              <button
                className="btn btn-secondary"
                disabled={!view.canOfferDraw && view.drawOffer !== opponent?.id}
                onClick={() => act({ type: 'offer-draw' })}
              >
                <EqualIcon /> {view.drawOffer === playerId ? t.chess.drawOffered : t.chess.offerDraw}
              </button>
              <button className="btn btn-secondary" disabled={!view.canRequestTakeback} onClick={() => act({ type: 'request-takeback' })}>
                <UndoIcon /> {view.takebackRequest === playerId ? t.chess.takebackRequested : t.chess.takeback}
              </button>
              <button className="btn btn-secondary danger" onClick={resign}>
                <FlagIcon /> {t.chess.resign}
              </button>
            </>
          )}
          {result && mySide && (
            <button className="btn btn-primary" disabled={iAskedRematch} onClick={rematch}>
              <PlayIcon /> {rematchLabel}
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

interface ResultOverlayProps {
  kind: 'win' | 'lose' | 'draw';
  headline: string;
  detail: string;
  rematch: { label: string; disabled: boolean; onClick: () => void } | null;
  onClose: () => void;
}

function ResultOverlay({ kind, headline, detail, rematch, onClose }: ResultOverlayProps) {
  const { t } = useI18n();
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
        <h2>{headline}</h2>
        <p>{detail}</p>
        <div className="result-actions">
          {rematch ? (
            <button className="btn btn-primary" disabled={rematch.disabled} onClick={rematch.onClick}>
              <PlayIcon /> {rematch.label}
            </button>
          ) : (
            <span className="muted">
              <Ellipsis text={t.room.waitingForHost} />
            </span>
          )}
          <button className="btn btn-ghost" onClick={onClose}>
            {t.chess.reviewBoard}
          </button>
        </div>
      </div>
    </div>
  );
}
