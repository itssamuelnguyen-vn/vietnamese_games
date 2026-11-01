import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  XD_BET_VALUES,
  XD_MIN_STAND,
  xdHandValue,
  xdRank,
  xdSuit,
  type HandValue,
  type RoomView,
  type XdCard,
  type XiDachLogEntry,
  type XiDachMove,
  type XiDachView,
} from '@vg/shared';
import { api } from '../../socket';
import { useI18n, type Strings } from '../../i18n';
import { Avatar } from '../../components/Avatar';
import { Ellipsis } from '../../components/Ellipsis';
import { toast } from '../../components/Toaster';
import { ChatCard, PlayersCard, RoomCodeCard, ScoreboardPanel } from '../../components/RoomPanels';
import { RulesButton } from '../../components/RulesDialog';
import { ExitIcon, PlayIcon, TrophyIcon } from '../../components/icons';
import { playSound } from '../../sound';
import { freshEntries } from '../freshLog';

interface Props {
  room: RoomView;
  view: XiDachView;
  onLeave: () => void;
}

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♣', '♦', '♥'];
const SEAT_COLORS = ['#d64541', '#2e86de', '#27ae60', '#e67e22', '#8e44ad', '#16a085', '#c0392b', '#2c3e50'];
// How long each of the dealer's cards takes to turn over at the reveal.
const DEALER_CARD_MS = 450;

function Card({ card, index = 0 }: { card: XdCard; index?: number }) {
  const red = xdSuit(card) >= 2;
  return (
    <span className={`pcard xd-card ${red ? 'red' : 'black'}`} style={{ '--i': index } as CSSProperties} aria-label={`${RANKS[xdRank(card) - 1]}${SUITS[xdSuit(card)]}`}>
      <span className="pcard-corner">
        {RANKS[xdRank(card) - 1]}
        <br />
        {SUITS[xdSuit(card)]}
      </span>
      <span className="pcard-pip">{SUITS[xdSuit(card)]}</span>
    </span>
  );
}

const Back = ({ index = 0 }: { index?: number }) => <span className="xd-back" style={{ '--i': index } as CSSProperties} aria-hidden="true" />;

function useTicker(active: boolean, ms = 250) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

function Countdown({ ms, since, total }: { ms: number; since: number; total: number }) {
  useTicker(true);
  const left = Math.max(0, ms - (performance.now() - since));
  return (
    <>
      <span className={`tl-seconds ${left < 5000 ? 'wc-urgent' : ''}`}>{Math.ceil(left / 1000)}s</span>
      <div className="tl-bar bc-bar" style={{ '--left': Math.min(1, left / total) } as CSSProperties} />
    </>
  );
}

function valueLabel(t: Strings, v: HandValue): string {
  return v.kind === 'points' ? t.xidach.points(v.total) : v.kind === 'bust' ? `${t.xidach.hands.bust} (${v.total})` : t.xidach.hands[v.kind];
}

function describe(t: Strings, e: XiDachLogEntry, name: (id: string) => string): string {
  const L = t.xidach.log;
  const X = t.xidach;
  switch (e.kind) {
    case 'round':
      return L.round(e.round);
    case 'hit':
      return L.hit(name(e.player));
    case 'stand':
      return L.stand(name(e.player), e.auto);
    case 'bust':
      return L.bust(name(e.player));
    case 'dealer':
      return L.dealer(valueLabel(t, e.value));
    case 'result':
      return L.result(name(e.player), valueLabel(t, e.hand), e.net > 0 ? X.win(t.typhu.money(e.net)) : e.net < 0 ? X.lose(t.typhu.money(-e.net)) : X.push);
    case 'left':
      return L.left(name(e.player));
  }
}

export function XiDachGame({ room, view, onLeave }: Props) {
  const { t } = useI18n();
  const X = t.xidach;
  const money = t.typhu.money;
  const me = room.you;
  const mySeat = view.seats.find((s) => s.id === me);
  const isHost = room.hostId === me;
  const name = (id: string) => (id === me ? t.room.you : ([...room.players, ...room.departed].find((p) => p.id === id)?.name ?? '…'));
  const player = (id: string) => room.players.find((p) => p.id === id);
  const color = (id: string) => SEAT_COLORS[Math.max(0, view.seats.findIndex((s) => s.id === id)) % SEAT_COLORS.length];
  const receivedAt = useMemo(() => performance.now(), [room]);

  // At the reveal the dealer's cards turn over one by one, then everyone's result shows.
  const [dealerShown, setDealerShown] = useState(view.phase === 'reveal' ? view.dealer.length : 1);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const seenLog = useRef(view.log);
  useEffect(() => {
    const fresh = freshEntries(seenLog.current, view.log);
    seenLog.current = view.log;
    if (fresh.some((e) => e.kind === 'round')) setDealerShown(1);
    if (fresh.some((e) => e.kind === 'hit')) playSound('move');
    if (fresh.some((e) => e.kind === 'bust')) playSound('capture');
    const dealer = fresh.find((e) => e.kind === 'dealer');
    if (dealer && dealer.kind === 'dealer') {
      setDealerShown(1);
      for (let k = 2; k <= dealer.hand.length; k++) timers.current.push(setTimeout(() => (setDealerShown(k), playSound('move')), (k - 1) * DEALER_CARD_MS));
      const mine = fresh.find((e) => e.kind === 'result' && e.player === me);
      timers.current.push(setTimeout(() => playSound(mine && mine.kind === 'result' && mine.net > 0 ? 'end' : 'notify'), dealer.hand.length * DEALER_CARD_MS));
    }
  }, [view.log]);
  const myTurn = view.phase === 'play' && view.turn === me && !view.result;
  useEffect(() => {
    if (myTurn) playSound('notify');
  }, [myTurn]);

  async function send(move: XiDachMove) {
    const r = await api.move(move);
    if (!r.ok) toast(t.errors[r.error]);
  }

  async function rematch() {
    const r = isHost ? await api.start() : await api.rematch();
    if (!r.ok) toast(t.errors[r.error]);
  }

  const revealing = view.phase === 'reveal';
  const dealerDone = revealing && dealerShown >= view.dealer.length;
  const results = new Map(
    view.log
      .slice(view.log.map((e) => e.kind).lastIndexOf('dealer'))
      .flatMap((e) => (e.kind === 'result' ? [[e.player, e] as const] : [])),
  );
  const myHand = view.hands[me] ?? [];
  const myValue = myHand.length ? xdHandValue(myHand) : null;
  const betting = view.phase === 'bet' && !view.result && !!mySeat && !mySeat.out && !mySeat.ready && mySeat.chips > 0;
  const myPlace = view.result ? view.result.ranking.indexOf(me) + 1 : 0;
  const dealerValue = revealing ? xdHandValue(view.dealer.slice(0, dealerShown)) : null;

  let status: string;
  if (view.result) status = X.resultTitle;
  else if (view.phase === 'bet') status = !mySeat || mySeat.out ? X.round(view.round, view.rounds) : mySeat.chips === 0 ? X.noChips : mySeat.ready ? X.waitingOthers : X.betPrompt;
  else if (view.phase === 'reveal') status = dealerDone && mySeat && results.get(me) ? describe(t, results.get(me)!, name) : X.dealerTurn;
  else if (myTurn) status = X.yourTurn;
  else if (mySeat && !mySeat.cards) status = X.sitOut;
  else status = view.turn ? X.turnOf(name(view.turn)) : '';

  const inRound = view.seats.filter((s) => s.cards > 0 || s.bet > 0);

  return (
    <div className="tl-layout xd-layout">
      <aside className="game-left">
        <RoomCodeCard code={room.code} />
        <PlayersCard
          room={room}
          colorOf={color}
          subtitle={(id) => {
            const seat = view.seats.find((s) => s.id === id);
            return seat ? (
              <>
                🪙 {money(seat.chips)}
                {seat.ready && view.phase === 'bet' && <span className="tag tag-gold bc-ready">{t.baucua.readyTag}</span>}
              </>
            ) : null;
          }}
        />
        <RulesButton gameType="xidach" wide />
        <button className="btn btn-ghost" onClick={onLeave}>
          <ExitIcon /> {t.room.leave}
        </button>
      </aside>

      <section className="tl-main">
        <div className="xd-table">
          <header className="xd-round">{X.round(view.round, view.rounds)}</header>
          <div className="xd-dealer">
            <span className="xd-label">🎩 {X.dealer}</span>
            <div className="xd-cards">
              {view.dealerCards > 0 &&
                Array.from({ length: revealing ? view.dealer.length : view.dealerCards }, (_, i) =>
                  (revealing ? i < dealerShown : i === 0) && view.dealer[i] !== undefined ? <Card key={`c${i}`} card={view.dealer[i]} index={i} /> : <Back key={`b${i}`} index={i} />,
                )}
            </div>
            {dealerValue && <span className={`xd-value ${dealerValue.kind}`}>{valueLabel(t, dealerValue)}</span>}
          </div>

          <ol className="xd-seats">
            {(inRound.length ? inRound : view.seats).map((seat) => {
              const cards = view.hands[seat.id];
              const result = dealerDone ? results.get(seat.id) : undefined;
              const value = cards ? xdHandValue(cards) : null;
              return (
                <li
                  key={seat.id}
                  className={`xd-seat ${view.turn === seat.id && view.phase === 'play' ? 'turn' : ''} ${seat.id === me ? 'me' : ''} ${seat.out ? 'out' : ''}`}
                  style={{ '--owner': color(seat.id) } as CSSProperties}
                >
                  <span className="xd-who">
                    <Avatar id={seat.id} name={player(seat.id)?.name ?? name(seat.id)} size={28} color={color(seat.id)} />
                    <span className="xd-name">{name(seat.id)}</span>
                    {seat.bet > 0 && <span className="xd-bet">🪙 {money(seat.bet)}</span>}
                  </span>
                  <span className="xd-cards">
                    {cards ? cards.map((c, i) => <Card key={c} card={c} index={i} />) : Array.from({ length: seat.cards }, (_, i) => <Back key={i} index={i} />)}
                  </span>
                  {value && (seat.id === me || revealing) && <span className={`xd-value ${value.kind}`}>{valueLabel(t, value)}</span>}
                  {seat.stood && !revealing && seat.cards > 0 && <span className="xd-tag">{X.stood}</span>}
                  {result && (
                    <span className={`xd-result ${result.net > 0 ? 'win' : result.net < 0 ? 'lose' : 'push'}`}>
                      {result.net > 0 ? X.win(money(result.net)) : result.net < 0 ? X.lose(money(-result.net)) : X.push}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

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
                  <h2>{myPlace === 1 ? X.youWon : myPlace ? X.youPlaced(myPlace) : X.resultTitle}</h2>
                  <p className="muted">{X.winnerIs(name(view.result.ranking[0]), money(view.result.chips[view.result.ranking[0]]))}</p>
                </header>
                <ol className="tl-podium">
                  {view.result.ranking.map((id, i) => (
                    <li key={id} className={`medal-${i === view.result!.ranking.length - 1 ? 'last' : i + 1} ${id === me ? 'me' : ''}`}>
                      <span className="tl-medal">{i + 1}</span>
                      <Avatar id={id} name={player(id)?.name ?? name(id)} size={38} color={color(id)} />
                      <span className="tl-podium-text">
                        <strong>{name(id)}</strong>
                      </span>
                      <span className="tl-points up">🪙 {money(view.result!.chips[id])}</span>
                    </li>
                  ))}
                </ol>
                <div className="tl-result-actions">
                  {mySeat ? (
                    <button className="btn btn-primary" disabled={!isHost && room.rematchVotes.includes(me)} onClick={rematch}>
                      <PlayIcon /> {isHost ? t.room.playAgain : room.rematchVotes.includes(me) ? t.room.rematchRequested : t.room.requestRematch}
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

        <div className={`tl-me card xd-me ${betting || myTurn ? 'turn' : ''}`}>
          <div className="tl-me-head">
            {mySeat && <Avatar id={me} name={player(me)?.name ?? '?'} size={36} color={color(me)} />}
            <p className="tl-status">
              <Ellipsis text={status} />
            </p>
            {(view.phase === 'bet' || myTurn) && !view.result && <Countdown key={`${view.round}-${view.phase}-${view.turn}-${myHand.length}`} ms={view.msLeft} since={receivedAt} total={20_000} />}
          </div>
          {betting && (
            <div className="bc-controls">
              <div className="chip-group" role="group" aria-label={X.bet}>
                {XD_BET_VALUES.map((v) => (
                  <button key={v} className={`bc-chip v${v}`} aria-pressed={mySeat!.bet === v} disabled={mySeat!.chips < v} onClick={() => send({ type: 'bet', amount: v })}>
                    {v}
                  </button>
                ))}
              </div>
              <span className="bc-wallet">🪙 {money(mySeat!.chips)}</span>
              <button className="btn btn-primary" disabled={!mySeat!.bet} onClick={() => send({ type: 'ready' })}>
                🃏 {X.ready}
              </button>
            </div>
          )}
          {myTurn && myValue && (
            <div className="bc-controls">
              <span className={`xd-value big ${myValue.kind}`}>{valueLabel(t, myValue)}</span>
              <button className="btn btn-primary" disabled={myValue.kind !== 'points' || myHand.length >= 5} onClick={() => send({ type: 'hit' })}>
                🃏 {X.hit}
              </button>
              <button
                className="btn btn-secondary"
                disabled={myValue.kind === 'points' && myValue.total < XD_MIN_STAND}
                title={myValue.kind === 'points' && myValue.total < XD_MIN_STAND ? X.needSixteen : undefined}
                onClick={() => send({ type: 'stand' })}
              >
                ✋ {X.stand}
              </button>
              {myValue.kind === 'points' && myValue.total < XD_MIN_STAND && <span className="muted small">{X.needSixteen}</span>}
            </div>
          )}
        </div>
      </section>

      <aside className="game-right">
        <section className="card panel tl-log-panel open">
          <h2>{X.logTitle}</h2>
          <ol className="tl-log">
            {view.log.slice(-16).map((e, i) =>
              e.kind === 'round' ? (
                <li key={i} className="tl-log-round">
                  {describe(t, e, name)}
                </li>
              ) : (
                <li key={i} className={`tl-log-row ${'player' in e && e.player === me ? 'mine' : ''} ${e.kind === 'result' ? (e.net > 0 ? 'finish' : e.net < 0 ? 'pass' : '') : e.kind === 'bust' ? 'chop' : ''}`}>
                  <span className="tl-log-text">{describe(t, e, name)}</span>
                </li>
              ),
            )}
          </ol>
        </section>
        <ScoreboardPanel room={room} />
        <ChatCard room={room} />
      </aside>
    </div>
  );
}
