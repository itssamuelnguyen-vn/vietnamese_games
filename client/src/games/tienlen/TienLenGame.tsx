import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { beats, classify, rankOf, suitOf, type Card, type RoomView, type TienLenLogEntry, type TienLenMove, type TienLenView } from '@vg/shared';
import { api } from '../../socket';
import { useI18n, type Strings } from '../../i18n';
import { Avatar } from '../../components/Avatar';
import { Ellipsis } from '../../components/Ellipsis';
import { toast } from '../../components/Toaster';
import { ChatCard, PlayersCard, RoomCodeCard } from '../../components/RoomPanels';
import { RulesButton } from '../../components/RulesDialog';
import { ExitIcon, PlayIcon, TrophyIcon } from '../../components/icons';
import { playSound } from '../../sound';

interface Props {
  room: RoomView;
  view: TienLenView;
  onLeave: () => void;
}

const RANK_LABELS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const SUIT_SYMBOLS = ['♠', '♣', '♦', '♥'];
export const cardLabel = (card: Card) => `${RANK_LABELS[rankOf(card)]}${SUIT_SYMBOLS[suitOf(card)]}`;
const cardsLabel = (cards: Card[]) => cards.map(cardLabel).join(' ');
const isRed = (card: Card) => suitOf(card) >= 2;
const bySuit = (a: Card, b: Card) => suitOf(a) - suitOf(b) || a - b;

// Where opponents sit around the table, relative to the viewer at the bottom.
const POSITIONS: Record<number, string[]> = { 1: ['top'], 2: ['right', 'left'], 3: ['right', 'top', 'left'] };

function PlayingCard({ card, selected, onClick, small }: { card: Card; selected?: boolean; onClick?: () => void; small?: boolean }) {
  const classes = ['pcard', isRed(card) ? 'red' : 'black', selected ? 'selected' : '', small ? 'small' : '', onClick ? 'clickable' : ''];
  return (
    <button type="button" className={classes.filter(Boolean).join(' ')} onClick={onClick} disabled={!onClick} aria-pressed={selected} aria-label={cardLabel(card)}>
      <span className="pcard-corner">
        {RANK_LABELS[rankOf(card)]}
        <br />
        {SUIT_SYMBOLS[suitOf(card)]}
      </span>
      <span className="pcard-pip">{SUIT_SYMBOLS[suitOf(card)]}</span>
    </button>
  );
}

// Re-renders periodically while `active`, for the turn countdown.
function useTicker(active: boolean, ms = 200) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

function describe(t: Strings, entry: TienLenLogEntry, name: (id: string) => string, players: number): string {
  const L = t.tienlen.log;
  switch (entry.kind) {
    case 'play':
      if (entry.auto) return L.autoPlay(name(entry.player), cardsLabel(entry.cards));
      return (entry.chop ? L.chop : L.play)(name(entry.player), t.tienlen.combos[entry.combo], cardsLabel(entry.cards));
    case 'pass':
      return (entry.auto ? L.autoPass : L.pass)(name(entry.player));
    case 'finish':
      return L.finish(name(entry.player), t.tienlen.place(entry.place, players));
    case 'round':
      return L.round(name(entry.leader));
    case 'left':
      return L.left(name(entry.player));
  }
}

export function TienLenGame({ room, view, onLeave }: Props) {
  const { t } = useI18n();
  const me = room.you;
  const seated = view.seats.some((s) => s.id === me);
  const myTurn = view.turn === me && !view.result;
  const isHost = room.hostId === me;
  const name = (id: string) => (id === me ? t.room.you : (room.players.find((p) => p.id === id)?.name ?? '…'));
  const player = (id: string) => room.players.find((p) => p.id === id);

  const [selected, setSelected] = useState<Card[]>([]);
  const [sortBySuit, setSortBySuit] = useState(false);
  // Drop selected cards that have left the hand (played, or a new deal).
  const handKey = view.hand.join(',');
  useEffect(() => setSelected((sel) => sel.filter((c) => view.hand.includes(c))), [handKey]);
  const hand = useMemo(() => (sortBySuit ? [...view.hand].sort(bySuit) : view.hand), [handKey, sortBySuit]);

  // Live turn countdown between server updates.
  const receivedAt = useMemo(() => performance.now(), [room]);
  useTicker(view.turnMs !== null && !view.result);
  const turnLeft = view.turnMs === null ? null : Math.max(0, view.turnMs - (performance.now() - receivedAt));
  const turnFraction = turnLeft !== null && view.turnLimitMs ? turnLeft / view.turnLimitMs : null;

  // What's wrong with the current selection, if anything.
  const combo = selected.length ? classify(selected) : null;
  const trickCombo = view.trick ? classify(view.trick.cards) : null;
  let problem: string | null = null;
  if (myTurn && selected.length) {
    if (!combo) problem = t.tienlen.invalidCombo;
    else if (view.mustPlay !== null && !selected.includes(view.mustPlay)) problem = t.tienlen.mustPlay(cardLabel(view.mustPlay));
    else if (!beats(combo, trickCombo)) problem = t.tienlen.cannotBeat;
  }
  const canPlay = myTurn && selected.length > 0 && !problem;

  async function send(move: TienLenMove) {
    const r = await api.move(move);
    if (!r.ok) toast(t.errors[r.error]);
    return r.ok;
  }

  async function play() {
    if (await send({ type: 'play', cards: selected })) setSelected([]);
  }

  async function rematch() {
    const r = isHost ? await api.start() : await api.rematch();
    if (!r.ok) toast(t.errors[r.error]);
  }

  // Sounds: plays and chops, the start of our turn, and the end of the game.
  const seenLog = useRef(view.log.length);
  useEffect(() => {
    const fresh = view.log.slice(seenLog.current);
    seenLog.current = view.log.length;
    const lastPlay = fresh.filter((e) => e.kind === 'play').at(-1);
    if (lastPlay && lastPlay.kind === 'play') playSound(lastPlay.chop ? 'check' : 'move');
  }, [view.log]);
  useEffect(() => {
    if (myTurn) playSound('notify');
  }, [myTurn]);
  const seenResult = useRef(view.result);
  useEffect(() => {
    if (view.result && !seenResult.current) playSound('end');
    seenResult.current = view.result;
  }, [view.result]);

  // Flag the tab while it's this player's turn.
  useEffect(() => {
    if (!myTurn) return;
    document.title = `● ${t.tienlen.yourTurn} · ${t.appName}`;
    return () => {
      document.title = t.appName;
    };
  }, [myTurn, t]);

  const logRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [view.log.length]);

  // Opponents in turn order starting after the viewer (or after seat 0 for spectators).
  const myIndex = Math.max(0, view.seats.findIndex((s) => s.id === me));
  const others = [...view.seats.slice(myIndex + 1), ...view.seats.slice(0, myIndex)].filter((s) => s.id !== me);
  const positions = POSITIONS[others.length] ?? [];
  const mySeat = view.seats.find((s) => s.id === me);

  let status: string;
  if (view.result) status = t.tienlen.resultTitle;
  else if (!seated) status = view.turn ? t.tienlen.turnOf(name(view.turn)) : t.tienlen.spectating;
  else if (!myTurn) status = view.turn ? t.tienlen.turnOf(name(view.turn)) + '…' : '';
  else if (view.mustPlay !== null) status = t.tienlen.mustPlay(cardLabel(view.mustPlay));
  else if (view.trick) status = t.tienlen.beatThis(name(view.trick.by));
  else status = t.tienlen.yourLead;

  return (
    <div className="tl-layout">
      <aside className="game-left">
        <RoomCodeCard code={room.code} />
        <PlayersCard room={room} />
        <RulesButton gameType="tienlen" wide />
        <button className="btn btn-ghost" onClick={onLeave}>
          <ExitIcon /> {t.room.leave}
        </button>
      </aside>

      <section className="tl-main">
        <div className={`tl-table seats-${others.length}`}>
          {others.map((seat, i) => {
            const p = player(seat.id);
            const turn = view.turn === seat.id && !view.result;
            return (
              <div key={seat.id} className={`tl-seat pos-${positions[i]} ${turn ? 'turn' : ''}`}>
                <Avatar id={seat.id} name={p?.name ?? '?'} size={44} online={p?.connected} />
                <span className="tl-seat-name">{p?.name ?? '…'}</span>
                <span className="tl-backs" aria-label={t.tienlen.cardsLeft(seat.cards)}>
                  {seat.cards > 0 && <span className="tl-back" />}
                  <span className="tl-count">{seat.cards}</span>
                </span>
                <span className="tl-seat-tags">
                  {seat.out && <span className="tag tag-muted">{t.tienlen.left}</span>}
                  {seat.place && !seat.out && <span className="tag tag-gold">{t.tienlen.place(seat.place, view.seats.length)}</span>}
                  {seat.passed && <span className="tag">{t.tienlen.passed}</span>}
                </span>
                {turn && turnFraction !== null && (
                  <span className="tl-timer" style={{ '--left': turnFraction } as CSSProperties} />
                )}
              </div>
            );
          })}

          <div className="tl-center">
            {view.trick ? (
              <>
                <div className="tl-trick" key={view.trick.cards.join(',')}>
                  {view.trick.cards.map((c) => (
                    <PlayingCard key={c} card={c} />
                  ))}
                </div>
                <span className="tl-trick-by">{t.tienlen.played(name(view.trick.by))}</span>
              </>
            ) : (
              <span className="tl-empty">{t.tienlen.tableEmpty}</span>
            )}
          </div>

          {view.result && (
            <div className="tl-result">
              <div className="result-card win">
                <span className="result-icon">
                  <TrophyIcon />
                </span>
                <h2>{t.tienlen.resultTitle}</h2>
                {view.result.instant && (
                  <p>{t.tienlen.instant(name(view.result.instant.player), t.tienlen.instantWins[view.result.instant.kind])}</p>
                )}
                <ol className="tl-ranking">
                  {view.result.ranking.map((id, i) => (
                    <li key={id}>
                      <span className="tag tag-gold">{t.tienlen.place(i + 1, view.result!.ranking.length)}</span>
                      <strong>{name(id)}</strong>
                      {(view.revealed?.[id]?.length ?? 0) > 0 && (
                        <span className="tl-revealed" title={t.tienlen.remaining}>
                          {view.revealed![id].map((c) => (
                            <PlayingCard key={c} card={c} small />
                          ))}
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
                {seated ? (
                  <button className="btn btn-primary" disabled={!isHost && room.rematchVotes.includes(me)} onClick={rematch}>
                    <PlayIcon />{' '}
                    {isHost ? t.room.playAgain : room.rematchVotes.includes(me) ? t.room.rematchRequested : t.room.requestRematch}
                  </button>
                ) : (
                  <span className="muted">
                    <Ellipsis text={t.room.waitingForHost} />
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className={`tl-me card ${myTurn ? 'turn' : ''}`}>
          <div className="tl-me-head">
            {seated && <Avatar id={me} name={player(me)?.name ?? '?'} size={36} online />}
            <p className="tl-status">
              <Ellipsis text={status} />
            </p>
            {mySeat?.place && <span className="tag tag-gold">{t.tienlen.place(mySeat.place, view.seats.length)}</span>}
            {myTurn && turnLeft !== null && <span className="tl-seconds">{Math.ceil(turnLeft / 1000)}s</span>}
          </div>
          {myTurn && turnFraction !== null && <div className="tl-bar" style={{ '--left': turnFraction } as CSSProperties} />}

          {/* Once the game is over the results (with everyone's leftover cards) take over. */}
          {seated && hand.length > 0 && !view.result && (
            <>
              <div className="tl-hand">
                {hand.map((c) => (
                  <PlayingCard
                    key={c}
                    card={c}
                    selected={selected.includes(c)}
                    onClick={() => setSelected((sel) => (sel.includes(c) ? sel.filter((x) => x !== c) : [...sel, c]))}
                  />
                ))}
              </div>
              <p className={`tl-hint ${problem ? 'error' : 'muted'}`}>{problem ?? (myTurn ? t.tienlen.pickCards : ' ')}</p>
              <div className="tl-actions">
                <button className="btn btn-secondary" onClick={() => setSortBySuit((v) => !v)}>
                  {sortBySuit ? t.tienlen.sortByRank : t.tienlen.sortBySuit}
                </button>
                <button className="btn btn-ghost" disabled={selected.length === 0} onClick={() => setSelected([])}>
                  {t.tienlen.clear}
                </button>
                <button className="btn btn-secondary" disabled={!myTurn || !view.trick} onClick={() => send({ type: 'pass' })}>
                  {t.tienlen.pass}
                </button>
                <button className="btn btn-primary" disabled={!canPlay} onClick={play}>
                  <PlayIcon /> {t.tienlen.play}
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      <aside className="game-right">
        <section className="card panel">
          <h2>{t.tienlen.history}</h2>
          {view.log.length === 0 ? (
            <p className="muted small">{t.tienlen.noHistory}</p>
          ) : (
            <ol className="tl-log" ref={logRef}>
              {view.log.map((entry, i) => (
                <li key={i} className={entry.kind === 'play' && entry.chop ? 'chop' : entry.kind === 'finish' ? 'finish' : ''}>
                  {describe(t, entry, name, view.seats.length)}
                </li>
              ))}
            </ol>
          )}
        </section>
        <ChatCard room={room} />
      </aside>
    </div>
  );
}
