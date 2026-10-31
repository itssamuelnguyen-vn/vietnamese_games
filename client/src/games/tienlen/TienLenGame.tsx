import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ABANDON_CLAIM_MS, canChopOutOfTurn, classify, hintPlays, playProblem, quickPick, rankOf, suitOf, type Card, type RoomView, type TienLenLogEntry, type TienLenMove, type TienLenView } from '@vg/shared';
import { api } from '../../socket';
import { useI18n, type Strings } from '../../i18n';
import { Avatar } from '../../components/Avatar';
import { Ellipsis } from '../../components/Ellipsis';
import { toast } from '../../components/Toaster';
import { ChatCard, PlayersCard, RoomCodeCard } from '../../components/RoomPanels';
import { RulesButton } from '../../components/RulesDialog';
import { ChevronRightIcon, ExitIcon, PlayIcon, TrophyIcon } from '../../components/icons';
import { loadSetting, saveSetting } from '../../settings';
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

// One row of the game log: who, what they did, and the cards as small chips.
function LogRow({ entry, me, name, players }: { entry: TienLenLogEntry; me: string; name: (id: string) => string; players: number }) {
  const { t } = useI18n();
  const P = t.tienlen.logParts;
  if (entry.kind === 'round') {
    return (
      <li className="tl-log-round">
        <span>{P.newRound(name(entry.leader))}</span>
      </li>
    );
  }
  let verb: string;
  let cards: Card[] = [];
  let tone = '';
  switch (entry.kind) {
    case 'play':
      cards = entry.cards;
      verb = entry.auto ? P.autoPlayed : entry.chop ? P.chopped(t.tienlen.combos[entry.combo]) : P.played(t.tienlen.combos[entry.combo]);
      tone = entry.chop ? 'chop' : '';
      break;
    case 'pass':
      verb = entry.auto ? P.autoPassed : P.passed;
      tone = 'pass';
      break;
    case 'finish':
      verb = P.finished(t.tienlen.place(entry.place, players));
      tone = 'finish';
      break;
    case 'left':
      verb = P.left;
      tone = 'pass';
      break;
  }
  return (
    <li className={`tl-log-row ${tone} ${entry.player === me ? 'mine' : ''}`}>
      <Avatar id={entry.player} name={name(entry.player)} size={22} />
      <span className="tl-log-text">
        <strong>{name(entry.player)}</strong> {verb}
        {cards.length > 0 && (
          <span className="tl-log-cards">
            {cards.map((c) => (
              <span key={c} className={`chip-card ${isRed(c) ? 'red' : 'black'}`}>
                {cardLabel(c)}
              </span>
            ))}
          </span>
        )}
      </span>
    </li>
  );
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
  // Players who left mid-game keep their name in the log and results.
  const name = (id: string) =>
    id === me ? t.room.you : ([...room.players, ...room.departed].find((p) => p.id === id)?.name ?? '…');
  const player = (id: string) => room.players.find((p) => p.id === id);

  const [selected, setSelected] = useState<Card[]>([]);
  const [sortBySuit, setSortBySuit] = useState(false);
  // Drop selected cards that have left the hand (played, or a new deal).
  const handKey = view.hand.join(',');
  useEffect(() => setSelected((sel) => sel.filter((c) => view.hand.includes(c))), [handKey]);
  const hand = useMemo(() => (sortBySuit ? [...view.hand].sort(bySuit) : view.hand), [handKey, sortBySuit]);

  // Live turn countdown between server updates.
  const receivedAt = useMemo(() => performance.now(), [room]);
  // Seated opponents who dropped off; after a minute anyone can remove them from the table.
  const offline = view.result
    ? []
    : view.seats
        .filter((s) => s.id !== me && !s.out && (s.cards > 0 || s.place === null))
        .map((s) => player(s.id))
        .filter((p) => p && !p.connected && p.offlineMs !== null)
        .map((p) => ({ name: p!.name, ms: p!.offlineMs! + (performance.now() - receivedAt) }));
  const removable = offline.some((o) => o.ms >= ABANDON_CLAIM_MS);
  useTicker((view.turnMs !== null || offline.length > 0) && !view.result);
  const turnLeft = view.turnMs === null ? null : Math.max(0, view.turnMs - (performance.now() - receivedAt));
  const turnFraction = turnLeft !== null && view.turnLimitMs ? turnLeft / view.turnLimitMs : null;

  // What's wrong with the current selection under this table's rules, if anything.
  const trickCombo = view.trick ? classify(view.trick.cards) : null;
  const ruleState = { rules: view.rules, mustPlay: view.mustPlay, trick: view.trick && trickCombo && { ...view.trick, combo: trickCombo } };
  // A 4-pair run may chop out of turn when the table allows it.
  const outOfTurnChop = !myTurn && seated && !view.result && selected.length > 0 && canChopOutOfTurn(ruleState, selected);
  let problem: string | null = null;
  if ((myTurn || outOfTurnChop) && selected.length) {
    const reason = playProblem(ruleState, view.hand, selected);
    problem =
      reason === 'invalid'
        ? t.tienlen.invalidCombo
        : reason === 'must-play'
          ? t.tienlen.mustPlay(cardLabel(view.mustPlay!))
          : reason === 'cannot-beat'
            ? t.tienlen.cannotBeat
            : reason === 'stacked-chop'
              ? t.tienlen.stackedChop
              : reason === 'two-finish'
                ? t.tienlen.twoFinish
                : null;
  }
  const canPlay = (myTurn || outOfTurnChop) && selected.length > 0 && !problem;

  // "Hint" cycles through legal plays, cheapest first; it restarts when the table changes.
  const hintIndex = useRef(0);
  const trickKey = view.trick?.cards.join(',') ?? '';
  useEffect(() => {
    hintIndex.current = 0;
  }, [trickKey, handKey]);
  function hint() {
    const plays = hintPlays(view.hand, trickCombo, view.mustPlay);
    if (plays.length === 0) {
      toast(t.tienlen.noHint);
      return;
    }
    setSelected(plays[hintIndex.current % plays.length]);
    hintIndex.current++;
  }

  // Double-tap a card to select the whole combination around it (tracked by hand, since
  // mobile browsers don't reliably fire dblclick).
  const lastTap = useRef<{ card: Card; at: number } | null>(null);
  function tapCard(card: Card) {
    const now = performance.now();
    const double = lastTap.current?.card === card && now - lastTap.current.at < 350;
    lastTap.current = { card, at: now };
    if (double) {
      // Prefer a group that's playable right now; otherwise still grab the natural group and let
      // the hint line explain why it can't be played yet.
      const pick =
        (myTurn && quickPick(view.hand, card, trickCombo, view.mustPlay)) || quickPick(view.hand, card, null, null);
      if (pick) {
        setSelected(pick);
        lastTap.current = null;
        return;
      }
    }
    setSelected((sel) => (sel.includes(card) ? sel.filter((x) => x !== card) : [...sel, card]));
  }

  async function send(move: TienLenMove) {
    const r = await api.move(move);
    if (!r.ok) toast(t.errors[r.error]);
    return r.ok;
  }

  async function play() {
    if (await send({ type: 'play', cards: selected })) setSelected([]);
  }

  async function removeOffline() {
    const r = await api.claimWin();
    if (!r.ok) toast(t.errors[r.error]);
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

  // The game log can be collapsed; the choice is remembered per browser.
  const [logOpen, setLogOpen] = useState(() => loadSetting('vg:tlLog') !== 'closed');
  function toggleLog() {
    saveSetting('vg:tlLog', logOpen ? 'closed' : 'open');
    setLogOpen(!logOpen);
  }
  const logRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [view.log.length, logOpen]);

  const myPlace = view.result ? view.result.ranking.indexOf(me) + 1 : 0;
  const headline = !view.result || !myPlace
    ? t.tienlen.resultTitle
    : myPlace === view.result.ranking.length
      ? t.tienlen.youLast
      : t.tienlen.youPlaced(t.tienlen.place(myPlace, view.result.ranking.length));

  // Opponents in turn order starting after the viewer (or after seat 0 for spectators).
  const myIndex = Math.max(0, view.seats.findIndex((s) => s.id === me));
  const others = [...view.seats.slice(myIndex + 1), ...view.seats.slice(0, myIndex)].filter((s) => s.id !== me);
  const positions = POSITIONS[others.length] ?? [];
  const mySeat = view.seats.find((s) => s.id === me);

  let status: string;
  if (view.result) status = headline;
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
        <RulesButton gameType="tienlen" houseRules={view.rules} wide />
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
                <Avatar id={seat.id} name={p?.name ?? name(seat.id)} size={44} online={p?.connected} />
                <span className="tl-seat-name">{p?.name ?? name(seat.id)}</span>
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
              <div className={`tl-result-card ${myPlace === 1 ? 'won' : ''}`}>
                {myPlace === 1 && (
                  <div className="confetti" aria-hidden="true">
                    {Array.from({ length: 18 }, (_, i) => (
                      <span key={i} style={{ '--i': i } as CSSProperties} />
                    ))}
                  </div>
                )}
                <header className="tl-result-head">
                  <span className="result-icon">
                    <TrophyIcon />
                  </span>
                  <h2>{headline}</h2>
                  {view.result.instant && (
                    <p className="tl-instant">
                      {t.tienlen.instant(name(view.result.instant.player), t.tienlen.instantWins[view.result.instant.kind])}
                    </p>
                  )}
                </header>
                <ol className="tl-podium">
                  {view.result.ranking.map((id, i) => {
                    const left = view.revealed?.[id] ?? [];
                    const place = i + 1;
                    const last = place === view.result!.ranking.length;
                    return (
                      <li key={id} className={`medal-${last ? 'last' : place} ${id === me ? 'me' : ''}`}>
                        <span className="tl-medal">{place}</span>
                        <Avatar id={id} name={player(id)?.name ?? name(id)} size={38} />
                        <span className="tl-podium-text">
                          <strong>{name(id)}</strong>
                          <span className="muted small">
                            {t.tienlen.place(place, view.result!.ranking.length)} ·{' '}
                            {left.length > 0 ? t.tienlen.cardsLeft(left.length) : t.tienlen.cleared}
                          </span>
                        </span>
                        {left.length > 0 && (
                          <span className="tl-revealed" title={t.tienlen.remaining}>
                            {left.map((c) => (
                              <PlayingCard key={c} card={c} small />
                            ))}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ol>
                <div className="tl-result-actions">
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
          {seated && offline.length > 0 && (
            <div className="offline-note">
              <strong>{t.tienlen.offline(offline.map((o) => o.name).join(', '))}</strong>
              <span className="muted small">
                {removable ? t.tienlen.removeNow : t.tienlen.removeIn(Math.ceil((ABANDON_CLAIM_MS - Math.max(...offline.map((o) => o.ms))) / 1000))}
              </span>
              {removable && (
                <button className="btn btn-primary btn-sm" onClick={removeOffline}>
                  {t.tienlen.remove}
                </button>
              )}
            </div>
          )}

          {/* Once the game is over the results (with everyone's leftover cards) take over. */}
          {seated && hand.length > 0 && !view.result && (
            <>
              <div className="tl-hand">
                {hand.map((c) => (
                  <PlayingCard
                    key={c}
                    card={c}
                    selected={selected.includes(c)}
                    onClick={() => tapCard(c)}
                  />
                ))}
              </div>
              <p className={`tl-hint ${problem ? 'error' : outOfTurnChop ? 'chop-ready' : 'muted'}`}>
                {problem ?? (outOfTurnChop ? t.tienlen.chopNow : myTurn ? t.tienlen.pickCards : ' ')}
              </p>
              <div className="tl-actions">
                <button className="btn btn-secondary" onClick={() => setSortBySuit((v) => !v)}>
                  {sortBySuit ? t.tienlen.sortByRank : t.tienlen.sortBySuit}
                </button>
                <button className="btn btn-ghost" disabled={selected.length === 0} onClick={() => setSelected([])}>
                  {t.tienlen.clear}
                </button>
                <button className="btn btn-secondary" disabled={!myTurn} onClick={hint}>
                  {t.tienlen.hint}
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
        <section className={`card panel tl-log-panel ${logOpen ? 'open' : 'closed'}`}>
          <button className="panel-toggle" aria-expanded={logOpen} aria-controls="tl-log" onClick={toggleLog} title={logOpen ? t.tienlen.hideLog : t.tienlen.showLog}>
            <h2>{t.tienlen.history}</h2>
            <ChevronRightIcon className="panel-chevron" />
          </button>
          {view.log.length === 0 ? (
            <p className="muted small">{t.tienlen.noHistory}</p>
          ) : logOpen ? (
            <ol className="tl-log" id="tl-log" ref={logRef}>
              {view.log.map((entry, i) => (
                <LogRow key={i} entry={entry} me={me} name={name} players={view.seats.length} />
              ))}
            </ol>
          ) : (
            <p className="tl-log-latest muted small">{describe(t, view.log.at(-1)!, name, view.seats.length)}</p>
          )}
        </section>
        <ChatCard room={room} />
      </aside>
    </div>
  );
}
