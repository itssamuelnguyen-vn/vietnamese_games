import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { maSoiTeam, type MaSoiLogEntry, type MaSoiMove, type MaSoiRole, type MaSoiSeatView, type MaSoiView, type RoomView } from '@vg/shared';
import { api } from '../../socket';
import { useI18n, type Strings } from '../../i18n';
import { Avatar } from '../../components/Avatar';
import { Ellipsis } from '../../components/Ellipsis';
import { toast } from '../../components/Toaster';
import { AbsentPlayersNote, ChatCard, MASOI_ICONS, RoomCodeCard, ScoreboardPanel } from '../../components/RoomPanels';
import { RulesButton } from '../../components/RulesDialog';
import { ExitIcon, PlayIcon, TrophyIcon } from '../../components/icons';
import { playSound } from '../../sound';
import { freshEntries } from '../freshLog';

interface Props {
  room: RoomView;
  view: MaSoiView;
  onLeave: () => void;
}

// What tapping a player does right now, for this viewer.
type Mode = 'kill' | 'check' | 'protect' | 'poison' | 'vote' | 'shoot' | null;

const NIGHT_PHASES = new Set(['intro', 'night', 'witch']);
const URGENT_MS = 5000;

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
    <div className="ms-clock">
      <span className={`tl-seconds ${left < URGENT_MS ? 'wc-urgent' : ''}`}>{Math.ceil(left / 1000)}s</span>
      <div className="tl-bar ms-bar" style={{ '--left': total ? Math.min(1, left / total) : 0 } as CSSProperties} />
    </div>
  );
}

function modeOf(view: MaSoiView, you: string): Mode {
  const me = view.me;
  if (view.phase === 'hunter' && view.hunter === you) return 'shoot';
  if (!me?.alive || view.result) return null;
  if (view.phase === 'night') {
    if (me.role === 'wolf') return 'kill';
    if (me.role === 'seer' && view.seerPick === null) return 'check';
    if (me.role === 'guard' && view.guardPick === null) return 'protect';
  }
  if (view.phase === 'witch' && view.witch && !view.witch.done && view.witch.poison) return 'poison';
  if (view.phase === 'vote') return 'vote';
  return null;
}

function eligible(mode: Mode, seat: MaSoiSeatView, view: MaSoiView, you: string): boolean {
  if (!mode || !seat.alive) return false;
  switch (mode) {
    case 'kill':
      return seat.role !== 'wolf';
    case 'protect':
      return seat.id !== view.guardLast;
    case 'shoot':
      return true;
    default:
      return seat.id !== you;
  }
}

function describe(t: Strings, e: MaSoiLogEntry, name: (id: string) => string, roleOf: (id: string) => MaSoiRole | null): string {
  const L = t.masoi.log;
  const M = t.masoi;
  const named = (id: string) => {
    const role = roleOf(id);
    return role ? L.withRole(name(id), M.roles[role]) : name(id);
  };
  switch (e.kind) {
    case 'night':
      return L.night(e.day);
    case 'dawn':
      return e.dead.length ? L.dawnDead(e.dead.map(named).join(', ')) : L.dawnPeace;
    case 'say':
      return lineText(t, e, name);
    case 'votes': {
      const groups = new Map<string | null, string[]>();
      for (const [voter, target] of Object.entries(e.votes)) groups.set(target, [...(groups.get(target) ?? []), name(voter)]);
      if (groups.size === 0) return L.votesNone;
      const parts = [...groups]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([target, voters]) => (target === null ? L.nobodyGroup(voters.length, voters.join(', ')) : L.voteGroup(name(target), voters.length, voters.join(', '))));
      return L.votes(parts.join('; '));
    }
    case 'accused':
      return L.accused(name(e.player), e.votes);
    case 'no-lynch':
      return e.reason === 'tie' ? L.noLynchTie : L.noLynchSkip;
    case 'verdict':
      return e.hanged ? L.hanged(named(e.player), e.hang.length, e.spare.length) : L.spared(name(e.player), e.hang.length, e.spare.length);
    case 'shot':
      return e.target ? L.shot(name(e.hunter), named(e.target)) : L.noShot(name(e.hunter));
    case 'left':
      return L.left(named(e.player));
    case 'end':
      return L.end(e.winner === 'village' ? M.teams.village : M.teams.wolves);
  }
}

function lineText(t: Strings, e: Extract<MaSoiLogEntry, { kind: 'say' }>, name: (id: string) => string): string {
  const lines = t.masoi.lines;
  const pick = <T,>(list: T[]) => list[e.v % list.length];
  switch (e.line) {
    case 'seer-wolf':
    case 'seer-clean':
    case 'accuse':
      return pick(lines[e.line])(name(e.target ?? ''));
    case 'claim':
      return pick(lines.claim)(e.role ? t.masoi.roles[e.role] : '?');
    case 'defend':
      return pick(lines.defend);
  }
}

export function MaSoiGame({ room, view, onLeave }: Props) {
  const { t } = useI18n();
  const M = t.masoi;
  const P = M.prompt;
  const A = M.actions;
  const you = room.you;
  const isHost = room.hostId === you;
  const seated = room.players.some((p) => p.id === you);
  const name = (id: string) => (id === you ? t.room.you : ([...room.players, ...room.departed].find((p) => p.id === id)?.name ?? '…'));
  const plainName = (id: string) => [...room.players, ...room.departed].find((p) => p.id === id)?.name ?? '…';
  const seatOf = (id: string) => view.seats.find((s) => s.id === id);
  const roleOf = (id: string) => seatOf(id)?.role ?? null;
  const receivedAt = useMemo(() => performance.now(), [room]);
  const me = view.me;
  const ghost = !!me && !me.alive;
  const night = NIGHT_PHASES.has(view.phase);
  const mode = modeOf(view, you);

  // A pick that still needs confirming (seer, guard, witch's poison, hunter's shot), per phase.
  const phaseKey = `${view.phase}-${view.day}`;
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => setPick(null), [phaseKey]);

  async function send(move: MaSoiMove) {
    const r = await api.move(move);
    if (!r.ok) toast(t.errors[r.error]);
    return r.ok;
  }

  async function rematch() {
    const r = isHost ? await api.start() : await api.rematch();
    if (!r.ok) toast(t.errors[r.error]);
  }

  function tap(seat: MaSoiSeatView) {
    if (!eligible(mode, seat, view, you)) return;
    if (mode === 'kill') {
      if (view.wolfVotes?.[you] !== seat.id) void send({ type: 'kill', target: seat.id });
    } else if (mode === 'vote') {
      if (view.votes[you] !== seat.id) void send({ type: 'vote', target: seat.id });
    } else setPick(pick === seat.id ? null : seat.id);
  }

  // Sounds: a chime when it's your move, a thud for each death, a fanfare at the end.
  const seenLog = useRef(view.log);
  useEffect(() => {
    const fresh = freshEntries(seenLog.current, view.log);
    seenLog.current = view.log;
    if (fresh.some((e) => e.kind === 'end')) playSound('end');
    else if (fresh.some((e) => (e.kind === 'dawn' && e.dead.length > 0) || (e.kind === 'verdict' && e.hanged) || (e.kind === 'shot' && e.target))) playSound('capture');
  }, [view.log]);
  const myTurn = mode !== null || (view.phase === 'intro' && !!me && !view.ready.includes(you)) || (view.phase === 'verdict' && !!me?.alive && view.accused !== you);
  useEffect(() => {
    if (myTurn) playSound('notify');
  }, [myTurn, phaseKey]);
  useEffect(() => {
    if (!myTurn) return;
    document.title = `● ${M.phases[view.phase]} · ${t.appName}`;
    return () => {
      document.title = t.appName;
    };
  }, [myTurn, view.phase, t]);

  const feedRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' });
  }, [view.log.length]);

  const alive = view.seats.filter((s) => s.alive);
  const voteCount = (id: string) => Object.values(view.votes).filter((v) => v === id).length;
  const wolfPicks = (id: string) => (view.wolfVotes ? Object.values(view.wolfVotes).filter((v) => v === id).length : 0);
  const check = (id: string) => view.seerChecks?.findLast((c) => c.target === id);
  const fellowWolves = me?.role === 'wolf' ? view.seats.filter((s) => s.role === 'wolf' && s.id !== you) : [];
  const showVotes = view.phase === 'vote' || ((view.phase === 'defense' || view.phase === 'verdict') && Object.keys(view.votes).length > 0);
  const showVerdict = view.phase === 'verdict' || (view.phase === 'dusk' && Object.keys(view.verdict).length > 0);

  const title = view.phase === 'intro' ? M.phases.intro : night ? M.nightTitle(view.day) : view.phase === 'over' ? M.phases.over : M.dayTitle(view.day);

  // ---- The action panel: what to do now ----
  let prompt: string;
  let actions: ReactNode = null;
  const wolfMine = view.wolfVotes?.[you];
  switch (view.phase) {
    case 'intro':
      prompt = P.intro;
      if (me)
        actions = (
          <button className="btn btn-primary" disabled={view.ready.includes(you)} onClick={() => send({ type: 'ready' })}>
            {M.gotIt}
          </button>
        );
      break;
    case 'night':
      if (me?.alive && me.role === 'wolf') {
        const picks = alive.filter((s) => s.role === 'wolf').map((s) => view.wolfVotes?.[s.id]);
        const agreed = picks.every((p) => p && p === picks[0]);
        prompt = !wolfMine ? P.wolfPick : agreed ? P.wolfAgreed(name(wolfMine)) : P.wolfWaiting(name(wolfMine));
      } else if (me?.alive && me.role === 'seer') {
        const result = view.seerPick ? check(view.seerPick) : null;
        prompt = result ? P.seerResult(name(result.target), result.wolf) : P.seerPick;
        if (!view.seerPick)
          actions = (
            <button className="btn btn-primary" disabled={!pick} onClick={() => pick && send({ type: 'check', target: pick })}>
              {pick ? A.check(name(pick)) : A.pickFirst}
            </button>
          );
      } else if (me?.alive && me.role === 'guard') {
        prompt = view.guardPick ? P.guardDone(name(view.guardPick)) : P.guardPick;
        if (!view.guardPick)
          actions = (
            <button className="btn btn-primary" disabled={!pick} onClick={() => pick && send({ type: 'protect', target: pick })}>
              {pick ? A.protect(name(pick)) : A.pickFirst}
            </button>
          );
      } else prompt = ghost ? P.dead : me ? P.sleep : `${M.phases.night}…`;
      break;
    case 'witch': {
      const w = view.witch;
      if (w && me?.alive) {
        if (w.done) prompt = P.witchDone;
        else if (!w.heal && !w.poison) prompt = P.witchEmpty;
        else {
          prompt = w.victim ? P.witchVictim(name(w.victim)) : P.witchNoVictim;
          actions = (
            <>
              {w.heal && w.victim && (
                <button className="btn btn-primary" onClick={() => send({ type: 'heal' })}>
                  {A.heal(name(w.victim))}
                </button>
              )}
              {w.poison &&
                (pick ? (
                  <button className="btn btn-danger" onClick={() => send({ type: 'poison', target: pick })}>
                    {A.poison(name(pick))}
                  </button>
                ) : (
                  <span className="muted small">{A.poisonHint}</span>
                ))}
              <button className="btn btn-ghost" onClick={() => send({ type: 'pass' })}>
                {A.pass}
              </button>
            </>
          );
        }
      } else prompt = ghost ? P.dead : P.witchAwake;
      break;
    }
    case 'dawn':
      prompt = P.dawn;
      break;
    case 'hunter':
      if (view.hunter === you) {
        prompt = P.hunterMe;
        actions = (
          <>
            <button className="btn btn-danger" disabled={!pick} onClick={() => pick && send({ type: 'shoot', target: pick })}>
              {pick ? A.shoot(name(pick)) : A.pickFirst}
            </button>
            <button className="btn btn-ghost" onClick={() => send({ type: 'shoot', target: null })}>
              {A.noShoot}
            </button>
          </>
        );
      } else prompt = P.hunterOther(view.hunter ? name(view.hunter) : '…');
      break;
    case 'discuss':
      prompt = ghost ? P.dead : P.discuss;
      if (me?.alive)
        actions = (
          <>
            <button className="btn btn-primary" disabled={view.ready.includes(you)} onClick={() => send({ type: 'ready' })}>
              {view.ready.includes(you) ? A.readyDone : A.ready}
            </button>
            <span className="muted small">{P.readyCount(view.ready.length, alive.length)}</span>
          </>
        );
      break;
    case 'vote': {
      const mine = view.votes[you];
      prompt = ghost ? P.dead : mine === undefined ? P.vote : mine === null ? P.votedNobody : P.votedFor(name(mine));
      if (me?.alive)
        actions = (
          <button className="btn btn-secondary" aria-pressed={mine === null} disabled={mine === null} onClick={() => send({ type: 'vote', target: null })}>
            {A.nobody}
          </button>
        );
      break;
    }
    case 'defense':
      if (view.accused === you) {
        prompt = P.defenseMe;
        actions = (
          <button className="btn btn-primary" disabled={view.ready.includes(you)} onClick={() => send({ type: 'ready' })}>
            {A.defenseDone}
          </button>
        );
      } else prompt = P.defenseOther(view.accused ? name(view.accused) : '…');
      break;
    case 'verdict': {
      const accused = view.accused;
      if (accused === you) prompt = P.verdictMe;
      else {
        const cast = view.verdict[you];
        prompt = cast === undefined || !me?.alive ? P.verdict(accused ? name(accused) : '…') : P.verdictCast(cast);
        if (me?.alive)
          actions = (
            <>
              <button className="btn btn-danger" aria-pressed={cast === true} disabled={cast === true} onClick={() => send({ type: 'verdict', hang: true })}>
                {A.hang}
              </button>
              <button className="btn btn-secondary" aria-pressed={cast === false} disabled={cast === false} onClick={() => send({ type: 'verdict', hang: false })}>
                {A.spare}
              </button>
            </>
          );
      }
      break;
    }
    case 'dusk':
      prompt = P.dusk;
      break;
    default:
      prompt = view.result ? (view.result.winner === 'village' ? M.resultVillage : M.resultWolves) : '';
  }

  const myTeamWon = view.result && me ? maSoiTeam(me.role) === view.result.winner : null;

  return (
    <div className={`tl-layout ms-layout ${night ? 'is-night' : 'is-day'}`}>
      <aside className="game-left">
        <RoomCodeCard code={room.code} />
        {me ? (
          <section className={`card panel ms-my-role team-${maSoiTeam(me.role)} ${ghost ? 'ghost' : ''}`}>
            <p className="eyebrow">{M.yourRole}</p>
            <div className="ms-my-role-head">
              <span className="ms-role-icon big" aria-hidden="true">
                {MASOI_ICONS[me.role]}
              </span>
              <div>
                <h2>{M.roles[me.role]}</h2>
                <span className="muted small">{M.yourTeam(M.teams[maSoiTeam(me.role)])}</span>
              </div>
            </div>
            <p className="small">{M.roleBlurbs[me.role]}</p>
            {me.role === 'wolf' && <p className="small ms-pack">{fellowWolves.length ? M.fellowWolves(fellowWolves.map((s) => plainName(s.id)).join(', ')) : M.loneWolf}</p>}
            {view.witch && (
              <p className="small">
                {view.witch.heal ? '💚' : '▫️'} {view.witch.poison ? '☠️' : '▫️'}
              </p>
            )}
            {ghost && <span className="tag tag-muted">👻 {M.seat.dead}</span>}
          </section>
        ) : (
          <section className="card panel">
            <p className="muted small">{M.spectating}</p>
          </section>
        )}
        <section className="card panel ms-lineup">
          <h2>{M.lineupTitle}</h2>
          <ul>
            {(Object.entries(view.lineup) as [MaSoiRole, number][]).map(([role, n]) => (
              <li key={role} title={M.roleBlurbs[role]}>
                <span aria-hidden="true">{MASOI_ICONS[role]}</span> {M.roles[role]}
                {n > 1 && <span className="muted"> ×{n}</span>}
              </li>
            ))}
          </ul>
        </section>
        <RulesButton gameType="masoi" wide />
        <button className="btn btn-ghost" onClick={onLeave}>
          <ExitIcon /> {t.room.leave}
        </button>
      </aside>

      <section className="tl-main">
        <div className={`card ms-board ${night ? 'night' : 'day'} phase-${view.phase}`}>
          <header className="ms-sky">
            <span className="ms-sky-orb" aria-hidden="true" />
            <div className="ms-sky-text">
              <h2>{title}</h2>
              <p>{M.phases[view.phase]}</p>
            </div>
            {!view.result && view.msLeft > 0 && <Countdown key={phaseKey} ms={view.msLeft} since={receivedAt} total={view.phaseMs} />}
          </header>

          <ul className="ms-seats">
            {view.seats.map((seat) => {
              const p = room.players.find((x) => x.id === seat.id);
              const can = eligible(mode, seat, view, you);
              const chosen = pick === seat.id || (mode === 'kill' && wolfMine === seat.id) || (mode === 'vote' && view.votes[you] === seat.id);
              const c = check(seat.id);
              const votes = showVotes ? voteCount(seat.id) : 0;
              const picks = wolfPicks(seat.id);
              const cast = showVerdict ? view.verdict[seat.id] : undefined;
              const cause = seat.death ? M.causes[seat.death.cause] : null;
              return (
                <li key={seat.id}>
                  <button
                    type="button"
                    className={[
                      'ms-seat',
                      seat.alive ? '' : 'dead',
                      seat.id === you ? 'me' : '',
                      can ? 'can' : '',
                      chosen ? 'chosen' : '',
                      seat.id === view.accused && (view.phase === 'defense' || view.phase === 'verdict') ? 'accused' : '',
                      seat.role === 'wolf' && me?.role === 'wolf' ? 'packmate' : '',
                    ].join(' ')}
                    disabled={!can}
                    onClick={() => tap(seat)}
                    aria-pressed={can ? chosen : undefined}
                  >
                    <span className="ms-seat-avatar">
                      <Avatar id={seat.id} name={p?.name ?? plainName(seat.id)} size={46} online={p?.connected ?? false} />
                      {seat.role && (
                        <span className="ms-seat-role" title={M.roles[seat.role]}>
                          {MASOI_ICONS[seat.role]}
                        </span>
                      )}
                      {!seat.alive && <span className="ms-seat-x">✕</span>}
                    </span>
                    <span className="ms-seat-name">{seat.id === you ? `${plainName(seat.id)} (${M.seat.you})` : plainName(seat.id)}</span>
                    <span className="ms-seat-tags">
                      {seat.role && seat.id !== you && <span className="tag">{M.roles[seat.role]}</span>}
                      {cause && <span className="tag tag-muted">{cause}</span>}
                      {p?.bot && <span className="tag">🤖</span>}
                      {c && <span className={`tag ${c.wolf ? 'tag-danger' : 'tag-ok'}`}>🔮 {M.seat.checked(c.wolf)}</span>}
                      {view.guardPick === seat.id && <span className="tag tag-gold">🛡️ {M.seat.guarded}</span>}
                      {view.guardLast === seat.id && view.phase === 'night' && <span className="tag tag-muted">🛡️ {M.seat.lastGuarded}</span>}
                      {picks > 0 && <span className="tag tag-danger">{M.seat.wolfPicks(picks)}</span>}
                      {votes > 0 && <span className="tag tag-danger">{M.seat.votes(votes)}</span>}
                      {view.phase === 'discuss' && view.ready.includes(seat.id) && <span className="tag tag-gold">{M.seat.ready}</span>}
                      {cast !== undefined && <span className={`tag ${cast ? 'tag-danger' : 'tag-ok'}`}>{cast ? M.seat.hang : M.seat.spare}</span>}
                      {showVotes && view.votes[seat.id] !== undefined && (
                        <span className="tag tag-muted">→ {view.votes[seat.id] === null ? '∅' : plainName(view.votes[seat.id]!)}</span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {view.phase === 'intro' && me && !view.ready.includes(you) && (
            <div className="ms-reveal" role="dialog" aria-label={M.yourRole}>
              <div className={`ms-reveal-card team-${maSoiTeam(me.role)}`}>
                <span className="ms-role-icon huge" aria-hidden="true">
                  {MASOI_ICONS[me.role]}
                </span>
                <h2>{M.roleIntro(M.roles[me.role])}</h2>
                <p className="muted">{M.yourTeam(M.teams[maSoiTeam(me.role)])}</p>
                <p>{M.roleBlurbs[me.role]}</p>
                {me.role === 'wolf' && <p className="ms-pack">{fellowWolves.length ? M.fellowWolves(fellowWolves.map((s) => plainName(s.id)).join(', ')) : M.loneWolf}</p>}
                <button className="btn btn-primary btn-lg" onClick={() => send({ type: 'ready' })}>
                  {M.gotIt}
                </button>
              </div>
            </div>
          )}

          {view.result && (
            <div className="tl-result">
              <div className={`tl-result-card ${myTeamWon ? 'won' : ''}`}>
                {myTeamWon && (
                  <div className="confetti" aria-hidden="true">
                    {Array.from({ length: 18 }, (_, i) => (
                      <span key={i} style={{ '--i': i } as CSSProperties} />
                    ))}
                  </div>
                )}
                <header className="tl-result-head">
                  <span className="result-icon">{view.result.winner === 'wolves' ? '🐺' : <TrophyIcon />}</span>
                  <h2>{view.result.winner === 'village' ? M.resultVillage : M.resultWolves}</h2>
                  {myTeamWon !== null && <p className="muted">{myTeamWon ? M.youWon : M.youLost}</p>}
                </header>
                <div className="ms-result-roles">
                  <h3 className="small muted">{M.rolesRevealed}</h3>
                  <ul>
                    {view.seats.map((seat) => (
                      <li key={seat.id} className={`team-${seat.role ? maSoiTeam(seat.role) : 'village'} ${seat.id === you ? 'me' : ''} ${seat.alive ? '' : 'dead'}`}>
                        <span aria-hidden="true">{seat.role ? MASOI_ICONS[seat.role] : '?'}</span>
                        <strong>{plainName(seat.id)}</strong>
                        <span className="muted small">
                          {seat.role ? M.roles[seat.role] : ''}
                          {seat.death && ` · ${M.causes[seat.death.cause]}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="tl-result-actions">
                  {seated ? (
                    <button className="btn btn-primary" disabled={!isHost && room.rematchVotes.includes(you)} onClick={rematch}>
                      <PlayIcon /> {isHost ? t.room.playAgain : room.rematchVotes.includes(you) ? t.room.rematchRequested : t.room.requestRematch}
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

        <div className={`tl-me card ms-me ${myTurn ? 'turn' : ''}`}>
          <p className="tl-status ms-prompt">{prompt}</p>
          {actions && <div className="ms-actions">{actions}</div>}
          <AbsentPlayersNote room={room} />
        </div>

        <section className="card ms-feed-card">
          <h2>{M.feed}</h2>
          <ol className="ms-feed" ref={feedRef}>
            {view.log.map((e, i) =>
              e.kind === 'say' ? (
                <li key={i} className={`ms-say ${e.player === you ? 'mine' : ''}`}>
                  <Avatar id={e.player} name={plainName(e.player)} size={26} />
                  <span className="ms-bubble">
                    <strong>{plainName(e.player)}</strong> {lineText(t, e, name)}
                  </span>
                </li>
              ) : (
                <li key={i} className={`ms-event ms-${e.kind}`}>
                  {describe(t, e, name, roleOf)}
                </li>
              ),
            )}
          </ol>
        </section>
      </section>

      <aside className="game-right">
        <ScoreboardPanel room={room} />
        <ChatCard room={room} />
      </aside>
    </div>
  );
}
