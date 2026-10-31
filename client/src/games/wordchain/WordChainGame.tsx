import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import type { RoomView, WordChainLogEntry, WordChainMove, WordChainView } from '@vg/shared';
import { api } from '../../socket';
import { useI18n, type Strings } from '../../i18n';
import { Avatar } from '../../components/Avatar';
import { Ellipsis } from '../../components/Ellipsis';
import { toast } from '../../components/Toaster';
import { ChatCard, PlayersCard, RoomCodeCard, ScoreboardPanel } from '../../components/RoomPanels';
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

// Counts down from `ms` (as of `since`); only this small piece re-renders as time passes.
function Countdown({ ms, since, limit }: { ms: number; since: number; limit: number | null }) {
  useTicker(true);
  const left = Math.max(0, ms - (performance.now() - since));
  return (
    <>
      <span className="tl-seconds">{Math.ceil(left / 1000)}s</span>
      {limit && <div className="tl-bar wc-bar" style={{ '--left': left / limit } as CSSProperties} />}
    </>
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
      toast(t.errors[r.error]);
      playSound('lowtime');
    }
    return r.ok;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    if (await send({ type: 'word', text })) setText('');
  }

  async function rematch() {
    const r = isHost ? await api.start() : await api.rematch();
    if (!r.ok) toast(t.errors[r.error]);
  }

  // Sounds: each new word, someone going out, our turn, the end.
  const seenLog = useRef(view.log);
  useEffect(() => {
    const fresh = freshEntries(seenLog.current, view.log);
    seenLog.current = view.log;
    if (fresh.some((e) => e.kind === 'out')) playSound('capture');
    else if (fresh.some((e) => e.kind === 'word')) playSound('move');
  }, [view.log]);
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

  const feedRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
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
        <div className="card wc-board">
          <header className="wc-board-head">
            <h2>{W.feed}</h2>
            <span className="muted small">{W.usedCount(view.used)}</span>
          </header>
          <ol className="wc-feed" ref={feedRef}>
            {view.log.map((e, i) => {
              if (e.kind === 'out') {
                return (
                  <li key={i} className="wc-out">
                    {outText(t, e, name)}
                  </li>
                );
              }
              const by = e.kind === 'word' ? e.player : null;
              return (
                <li key={i} className={`wc-word ${by === me ? 'mine' : ''} ${by ? '' : 'dealt'} ${i === lastIndex ? 'last' : ''}`}>
                  {by ? (
                    <Avatar id={by} name={player(by)?.name ?? '?'} size={28} />
                  ) : (
                    <span className="wc-dealt-tag">{W.startWord}</span>
                  )}
                  <span className="wc-bubble">
                    <LinkedWord word={chainWord(i)} lang={view.lang} last={i === lastIndex} />
                  </span>
                  {e.kind === 'start' && <span className="muted small">{W.log.start(name(e.player))}</span>}
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
            {!view.result && view.turnMs !== null && <Countdown key={`${view.turn}-${view.chain.length}`} ms={view.turnMs} since={receivedAt} limit={view.turnLimitMs} />}
          </div>
          {myTurn && (
            <form className="wc-form" onSubmit={submit}>
              <input
                ref={inputRef}
                className="wc-input"
                value={text}
                maxLength={40}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={W.placeholder(view.link)}
                onChange={(e) => setText(e.target.value)}
              />
              <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}>
                <SendIcon /> {W.send}
              </button>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => send({ type: 'give-up' })}>
                {W.giveUp}
              </button>
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
