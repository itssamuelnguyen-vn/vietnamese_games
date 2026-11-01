import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import type { RoomView, WordChainLogEntry, WordChainMove, WordChainView } from '@vg/shared';
import { api } from '../../socket';
import { useI18n, type Strings } from '../../i18n';
import { Avatar } from '../../components/Avatar';
import { Ellipsis } from '../../components/Ellipsis';
import { toast } from '../../components/Toaster';
import { AbsentPlayersNote, ChatCard, PlayersCard, RoomCodeCard, ScoreboardPanel } from '../../components/RoomPanels';
import { RulesButton } from '../../components/RulesDialog';
import { ExitIcon, PlayIcon, SendIcon, TrophyIcon } from '../../components/icons';
import { playSound } from '../../sound';
import { freshEntries } from '../freshLog';

interface Props {
  room: RoomView;
  view: WordChainView;
  onLeave: () => void;
}

// Re-renders periodically while `active`, for the turn countdown.
function useTicker(active: boolean, ms = 250) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [active, ms]);
}

// The last seconds of a turn, when the clock turns red and starts to pulse.
const URGENT_MS = 5000;

// Counts down from `ms` (as of `since`); only this small piece re-renders as time passes.
function Countdown({ ms, since, limit, onUrgent }: { ms: number; since: number; limit: number | null; onUrgent?: () => void }) {
  useTicker(true);
  const left = Math.max(0, ms - (performance.now() - since));
  const urgent = left <= URGENT_MS;
  const warned = useRef(false);
  useEffect(() => {
    if (urgent && !warned.current && left > 0) {
      warned.current = true;
      onUrgent?.();
    }
  });
  return (
    <>
      <span className={`tl-seconds ${urgent ? 'wc-urgent' : ''}`}>{Math.ceil(left / 1000)}s</span>
      {limit && <div className={`tl-bar wc-bar ${urgent ? 'urgent' : ''}`} style={{ '--left': left / limit } as CSSProperties} />}
    </>
  );
}

// A player in the row at the top: whoever is up has their time running out round their avatar.
function Seat({ id, name, out, words, turn, ms, since, limit }: { id: string; name: string; out: boolean; words: number; turn: boolean; ms: number | null; since: number; limit: number | null }) {
  useTicker(turn && ms !== null);
  const left = turn && ms !== null ? Math.max(0, ms - (performance.now() - since)) : null;
  const fraction = left !== null && limit ? left / limit : 1;
  const r = 25;
  const length = 2 * Math.PI * r;
  return (
    <li className={`wc-seat ${out ? 'out' : ''} ${turn ? 'turn' : ''} ${left !== null && left <= URGENT_MS ? 'urgent' : ''}`}>
      <span className="wc-seat-avatar">
        <Avatar id={id} name={name} size={44} />
        {turn && (
          <svg className="wc-ring" viewBox="0 0 56 56" aria-hidden="true">
            <circle cx="28" cy="28" r={r} strokeDasharray={length} strokeDashoffset={length * (1 - fraction)} />
          </svg>
        )}
        {out && <span className="wc-seat-x">✕</span>}
      </span>
      <span className="wc-seat-name">{name}</span>
      <span className="wc-seat-words">{words}</span>
    </li>
  );
}

// The word with its linking part (the next word's start) highlighted.
function LinkedWord({ word, lang, last }: { word: string; lang: 'vi' | 'en'; last: boolean }) {
  if (!last) return <>{word}</>;
  if (lang === 'en') {
    return (
      <>
        {word.slice(0, -1)}
        <mark>{word.slice(-1)}</mark>
      </>
    );
  }
  const [first, second] = word.split(' ');
  return (
    <>
      {first} <mark>{second}</mark>
    </>
  );
}

function outText(t: Strings, e: Extract<WordChainLogEntry, { kind: 'out' }>, name: (id: string) => string) {
  return t.wordchain.log.out[e.reason](name(e.player));
}

export function WordChainGame({ room, view, onLeave }: Props) {
  const { t } = useI18n();
  const W = t.wordchain;
  const me = room.you;
  const mySeat = view.seats.find((s) => s.id === me);
  const alive = !!mySeat && !mySeat.out;
  const myTurn = view.turn === me && alive && !view.result;
  const isHost = room.hostId === me;
  const name = (id: string) => (id === me ? t.room.you : ([...room.players, ...room.departed].find((p) => p.id === id)?.name ?? '…'));
  const player = (id: string) => room.players.find((p) => p.id === id);

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // Why the last word was refused, shown under the input (with a shake) until the next try.
  const [refusal, setRefusal] = useState<{ text: string; key: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const receivedAt = useMemo(() => performance.now(), [room]);

  // Start the input with the required link, ready to finish the word.
  useEffect(() => {
    if (!myTurn) return;
    setText(view.lang === 'vi' ? `${view.link} ` : view.link);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [myTurn, view.chain.length, view.link]);

  async function send(move: WordChainMove) {
    setBusy(true);
    const r = await api.move(move);
    setBusy(false);
    if (!r.ok) {
      setRefusal({ text: t.errors[r.error], key: Date.now() });
      playSound('lowtime');
    } else setRefusal(null);
    return r.ok;
  }

  // Each refusal shakes the input again and keeps it focused. (Remounting it with a new key would
  // replay the shake too, but then the first keystroke after a refusal, clearing it, remounted the
  // input once more and lost focus mid-word.)
  useEffect(() => {
    const el = inputRef.current;
    if (!el || !refusal) return;
    el.classList.remove('refused');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add('refused');
    el.focus();
  }, [refusal?.key]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    if (await send({ type: 'word', text })) setText('');
  }

  async function rematch() {
    const r = isHost ? await api.start() : await api.rematch();
    if (!r.ok) toast(t.errors[r.error]);
  }

  // Sounds for each new word and anyone going out; a banner for the latter.
  const [knockout, setKnockout] = useState<{ text: string; key: number } | null>(null);
  const seenLog = useRef(view.log);
  useEffect(() => {
    const fresh = freshEntries(seenLog.current, view.log);
    seenLog.current = view.log;
    const out = fresh.findLast((e) => e.kind === 'out');
    if (out && out.kind === 'out') {
      playSound('capture');
      setKnockout({ text: outText(t, out, name), key: Date.now() });
    } else if (fresh.some((e) => e.kind === 'word')) playSound('move');
  }, [view.log]);
  useEffect(() => {
    if (!knockout) return;
    const id = setTimeout(() => setKnockout(null), 2200);
    return () => clearTimeout(id);
  }, [knockout]);
  useEffect(() => {
    if (myTurn) playSound('notify');
  }, [myTurn]);
  const seenResult = useRef(view.result);
  useEffect(() => {
    if (view.result && !seenResult.current) playSound('end');
    seenResult.current = view.result;
  }, [view.result]);
  useEffect(() => {
    if (!myTurn) return;
    document.title = `● ${W.yourTurn} · ${t.appName}`;
    return () => {
      document.title = t.appName;
    };
  }, [myTurn, t]);

  // The train of words scrolls along to its newest end.
  const feedRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    feedRef.current?.scrollTo({ left: feedRef.current.scrollWidth, top: feedRef.current.scrollHeight, behavior: 'smooth' });
  }, [view.log.length, view.log.at(-1)]);

  const lastWordIndex = view.log.map((e) => e.kind).lastIndexOf('word');
  const lastStartIndex = view.log.map((e) => e.kind).lastIndexOf('start');
  const lastIndex = Math.max(lastWordIndex, lastStartIndex);
  const chainWord = (i: number) => {
    // Log entries for words carry the word; starting words are matched from the chain.
    const e = view.log[i];
    if (e.kind === 'word') return e.word;
    if (e.kind === 'start') return e.word;
    return '';
  };

  let status: string;
  if (view.result) status = W.resultTitle;
  else if (mySeat?.out) status = W.youOut;
  else if (!mySeat) status = W.turnOf(name(view.turn));
  else if (!myTurn) status = W.turnOf(name(view.turn)) + '…';
  else status = view.lang === 'vi' ? W.mustStart(view.link) : W.mustStartLetter(view.link);

  const myPlace = view.result ? view.result.ranking.indexOf(me) + 1 : 0;

  return (
    <div className="tl-layout wc-layout">
      <aside className="game-left">
        <RoomCodeCard code={room.code} />
        <PlayersCard
          room={room}
          subtitle={(id) => {
            const seat = view.seats.find((s) => s.id === id);
            if (!seat) return null;
            return seat.out ? <span className="tag tag-muted">{W.outTag}</span> : W.wordCount(seat.words);
          }}
        />
        <RulesButton gameType={room.gameType} wide />
        <button className="btn btn-ghost" onClick={onLeave}>
          <ExitIcon /> {t.room.leave}
        </button>
      </aside>

      <section className="tl-main">
        <div className={`card wc-board ${view.turnMs !== null && view.turnMs <= URGENT_MS && !view.result ? 'urgent' : ''}`}>
          <ol className="wc-seats" aria-label={W.players}>
            {view.seats.map((s) => (
              <Seat
                key={s.id}
                id={s.id}
                name={name(s.id)}
                out={s.out}
                words={s.words}
                turn={s.id === view.turn && !view.result}
                ms={s.id === view.turn ? view.turnMs : null}
                since={receivedAt}
                limit={view.turnLimitMs}
              />
            ))}
          </ol>

          {/* The word to follow, and what the next one has to start with. */}
          {lastIndex >= 0 && !view.result && (
            <div className="wc-now" key={chainWord(lastIndex)}>
              <span className="wc-current">
                <LinkedWord word={chainWord(lastIndex)} lang={view.lang} last />
              </span>
              <span className="wc-arrow" aria-hidden="true">
                →
              </span>
              <span className="wc-next">
                <mark>{view.lang === 'en' ? view.link.toUpperCase() : view.link}</mark>
                <span className="wc-blank">{view.lang === 'en' ? '…' : ' …'}</span>
              </span>
            </div>
          )}

          <header className="wc-board-head">
            <h2>{W.feed}</h2>
            <span className="muted small">{W.usedCount(view.used)}</span>
          </header>
          {/* The chain as a train of words, each coupled to the next by the part they share. */}
          <ol className="wc-feed" ref={feedRef}>
            {view.log.map((e, i) => {
              if (e.kind === 'out') {
                return (
                  <li key={i} className="wc-out">
                    💥 {outText(t, e, name)}
                  </li>
                );
              }
              const by = e.kind === 'word' ? e.player : null;
              return (
                <li key={i} className={`wc-word ${by === me ? 'mine' : ''} ${by ? '' : 'dealt'} ${i === lastIndex ? 'last' : ''}`}>
                  {by ? <Avatar id={by} name={player(by)?.name ?? '?'} size={22} /> : <span className="wc-dealt-tag">{W.startWord}</span>}
                  <span className="wc-bubble">
                    <LinkedWord word={chainWord(i)} lang={view.lang} last={i === lastIndex} />
                  </span>
                </li>
              );
            })}
          </ol>

          {knockout && (
            <div className="wc-knockout" key={knockout.key} role="status">
              {knockout.text}
            </div>
          )}

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
                  <h2>{myPlace === 1 ? W.youWon : myPlace ? W.youPlaced(myPlace) : W.resultTitle}</h2>
                  <p className="muted">{W.winnerIs(name(view.result.ranking[0]))}</p>
                </header>
                <ol className="tl-podium">
                  {view.result.ranking.map((id, i) => (
                    <li key={id} className={`medal-${i === view.result!.ranking.length - 1 ? 'last' : i + 1} ${id === me ? 'me' : ''}`}>
                      <span className="tl-medal">{i + 1}</span>
                      <Avatar id={id} name={player(id)?.name ?? name(id)} size={38} />
                      <span className="tl-podium-text">
                        <strong>{name(id)}</strong>
                        <span className="muted small">{W.wordCount(view.seats.find((s) => s.id === id)?.words ?? 0)}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="tl-result-actions">
                  {mySeat ? (
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

        <div className={`tl-me card wc-me ${myTurn ? 'turn' : ''}`}>
          <div className="tl-me-head">
            <Avatar id={view.turn} name={player(view.turn)?.name ?? '?'} size={36} />
            <p className="tl-status">
              <Ellipsis text={status} />
            </p>
            {!view.result && view.turnMs !== null && (
              <Countdown
                key={`${view.turn}-${view.chain.length}`}
                ms={view.turnMs}
                since={receivedAt}
                limit={view.turnLimitMs}
                onUrgent={() => myTurn && playSound('lowtime')}
              />
            )}
          </div>
          <AbsentPlayersNote room={room} />
          {myTurn && (
            <form className="wc-form" onSubmit={submit}>
              <input
                ref={inputRef}
                className={`wc-input ${refusal ? 'refused' : ''}`}
                aria-invalid={!!refusal}
                aria-describedby={refusal ? 'wc-refusal' : undefined}
                value={text}
                maxLength={40}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={W.placeholder(view.link)}
                onChange={(e) => {
                  setText(e.target.value);
                  setRefusal(null);
                }}
              />
              <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}>
                <SendIcon /> {W.send}
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => send({ type: 'give-up' })}>
                {W.giveUp}
              </button>
              {refusal && (
                <p className="wc-refusal" id="wc-refusal" role="alert">
                  {refusal.text}
                </p>
              )}
            </form>
          )}
        </div>
      </section>

      <aside className="game-right">
        <ScoreboardPanel room={room} />
        <ChatCard room={room} />
      </aside>
    </div>
  );
}
