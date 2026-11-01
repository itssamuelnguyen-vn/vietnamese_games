import { MASOI_SPECIAL_ROLES, type ChatRoute, type GameDefinition, type MaSoiSpecialRole, type MaSoiTalk, type RoomOptions } from '../types';

// Ma sói (werewolf), the party game of hidden roles. Each night the wolves pick a villager to eat
// while the seer looks into one player's heart, the guard watches over one, and the witch may save
// the wolves' victim or poison someone. Each day the village talks, puts the most suspected player
// up to defend themselves, then votes to hang or spare them. A hunter who dies takes someone with
// them. The village wins once every wolf is dead; the wolves win once they are as many as the rest.
//
// The game runs itself (there is no human moderator): phases follow each other on timers and end
// early once everyone who has something to do has done it.

export type MaSoiRole = 'wolf' | 'villager' | MaSoiSpecialRole;
export type MaSoiTeam = 'wolves' | 'village';
export type MaSoiPhase =
  // Everyone looks at their role card.
  | 'intro'
  // The wolves, seer and guard act; then the witch, if the game has one.
  | 'night'
  | 'witch'
  // Who died in the night is announced.
  | 'dawn'
  // A dead hunter takes their shot.
  | 'hunter'
  // The village talks, votes on who to accuse, the accused defends themselves, then the vote to hang.
  | 'discuss'
  | 'vote'
  | 'defense'
  | 'verdict'
  // What the day's vote came to is announced.
  | 'dusk'
  | 'over';
export type MaSoiCause = 'wolves' | 'poison' | 'lynch' | 'shot' | 'left';
// What a death looks like to the living: a body found in the morning doesn't say who did it.
export type MaSoiPublicCause = 'night' | 'lynch' | 'shot' | 'left';
// Set things a player can say in the open (bots speak only these; they show in each player's language).
// seer-wolf / seer-clean: "I'm the seer, `target` is a wolf / is clean"; accuse: "I suspect `target`";
// claim: "I'm the `role`"; defend: "I'm innocent".
export type MaSoiLine = 'seer-wolf' | 'seer-clean' | 'accuse' | 'claim' | 'defend';
export const MASOI_LINES: MaSoiLine[] = ['seer-wolf', 'seer-clean', 'accuse', 'claim', 'defend'];
export const MASOI_ROLES: MaSoiRole[] = ['wolf', 'villager', ...MASOI_SPECIAL_ROLES];

export const MS_INTRO_MS = 10_000;
export const MS_NIGHT_MS = 30_000;
export const MS_WITCH_MS = 15_000;
export const MS_DAWN_MS = 6_000;
export const MS_HUNTER_MS = 20_000;
export const MS_VOTE_MS = 30_000;
export const MS_DEFENSE_MS = 30_000;
export const MS_VERDICT_MS = 15_000;
export const MS_DUSK_MS = 6_000;
export const MS_TALK_MS: Record<MaSoiTalk, number> = { short: 60_000, normal: 120_000, long: 180_000 };
const LOG_LIMIT = 300;

export type MaSoiLogEntry =
  | { kind: 'night'; day: number }
  // Who was found dead in the morning (in seat order, so the order gives nothing away).
  | { kind: 'dawn'; day: number; dead: string[] }
  | { kind: 'say'; player: string; line: MaSoiLine; target?: string; role?: MaSoiRole; v: number }
  // How everyone voted on who to accuse (null: no one).
  | { kind: 'votes'; day: number; votes: Record<string, string | null> }
  | { kind: 'accused'; player: string; votes: number }
  | { kind: 'no-lynch'; reason: 'tie' | 'skip' }
  | { kind: 'verdict'; player: string; hang: string[]; spare: string[]; hanged: boolean }
  | { kind: 'shot'; hunter: string; target: string | null }
  | { kind: 'left'; player: string }
  | { kind: 'end'; winner: MaSoiTeam };

export interface MaSoiState {
  seats: string[];
  roles: Record<string, MaSoiRole>;
  dead: Record<string, { day: number; cause: MaSoiCause }>;
  reveal: boolean;
  talkMs: number;
  phase: MaSoiPhase;
  // Night N comes before day N.
  day: number;
  deadline: number;
  phaseMs: number;
  // Who has said they're done with this phase (intro, discussion, the accused's defence).
  ready: string[];
  // Who has used their set line this phase.
  said: string[];
  // Tonight: each wolf's pick, and the wolf who last changed theirs (bots go along with it).
  wolfVotes: Record<string, string>;
  wolfLast: string | null;
  seerPick: string | null;
  seerChecks: { day: number; target: string; wolf: boolean }[];
  guardPick: string | null;
  // Who the guard watched last night, who can't be watched two nights running.
  guardLast: string | null;
  // The wolves' victim tonight, once they've chosen.
  victim: string | null;
  potions: { heal: boolean; poison: boolean };
  healed: boolean;
  poisoned: string | null;
  witchDone: boolean;
  // Today: who each player voted to accuse (null: nobody), the accused, and the vote to hang (true).
  votes: Record<string, string | null>;
  accused: string | null;
  verdict: Record<string, boolean>;
  // A dead hunter who still has their shot, and where the game goes after it.
  hunter: string | null;
  after: 'discuss' | 'night';
  log: MaSoiLogEntry[];
  result: { winner: MaSoiTeam } | null;
}

export type MaSoiMove =
  | { type: 'kill'; target: string }
  | { type: 'check'; target: string }
  | { type: 'protect'; target: string }
  | { type: 'heal' }
  | { type: 'poison'; target: string }
  | { type: 'pass' }
  | { type: 'ready' }
  | { type: 'vote'; target: string | null }
  | { type: 'verdict'; hang: boolean }
  | { type: 'shoot'; target: string | null }
  | { type: 'say'; line: MaSoiLine; target?: string; role?: MaSoiRole };

export interface MaSoiSeatView {
  id: string;
  alive: boolean;
  // Known to this viewer: their own, fellow wolves to a wolf, everyone to the dead, the dead when
  // roles are revealed on death, and everyone once the game is over.
  role: MaSoiRole | null;
  death: { day: number; cause: MaSoiPublicCause | MaSoiCause } | null;
}

export interface MaSoiView {
  phase: MaSoiPhase;
  day: number;
  msLeft: number;
  phaseMs: number;
  // The roles in the game, which everyone knows (not who has them).
  lineup: Partial<Record<MaSoiRole, number>>;
  reveal: boolean;
  seats: MaSoiSeatView[];
  // Your seat's role and whether you're alive; null for spectators.
  me: { role: MaSoiRole; alive: boolean } | null;
  ready: string[];
  said: string[];
  // Wolves only: tonight's picks.
  wolfVotes: Record<string, string> | null;
  // The seer only: what they've learned, and who they're looking at tonight.
  seerChecks: { day: number; target: string; wolf: boolean }[] | null;
  seerPick: string | null;
  // The guard only.
  guardPick: string | null;
  guardLast: string | null;
  // The witch only: the potions left, tonight's victim (during the witch's turn) and her choice.
  witch: { heal: boolean; poison: boolean; victim: string | null; done: boolean; healed: boolean; poisoned: string | null } | null;
  votes: Record<string, string | null>;
  accused: string | null;
  verdict: Record<string, boolean>;
  hunter: string | null;
  log: MaSoiLogEntry[];
  result: { winner: MaSoiTeam } | null;
}

// Wolves for a table of n when the host leaves it automatic: 1 for 5, 2 for 6-9, 3 for 10-12.
const autoWolves = (n: number) => (n <= 5 ? 1 : n <= 9 ? 2 : 3);

// The roles dealt to n players: the wolves, the special roles the host picked (as many as there
// are seats for), and villagers in the rest. Wolves are always fewer than everyone else.
export function maSoiLineup(n: number, options: Pick<RoomOptions, 'masoiRoles' | 'masoiWolves'>): MaSoiRole[] {
  const maxWolves = Math.max(1, Math.floor((n - 1) / 2));
  const wolves = Math.min(maxWolves, options.masoiWolves || autoWolves(n));
  const specials = MASOI_SPECIAL_ROLES.filter((r) => options.masoiRoles.includes(r)).slice(0, Math.max(0, n - wolves));
  return [...Array<MaSoiRole>(wolves).fill('wolf'), ...specials, ...Array<MaSoiRole>(Math.max(0, n - wolves - specials.length)).fill('villager')];
}

export const maSoiTeam = (role: MaSoiRole): MaSoiTeam => (role === 'wolf' ? 'wolves' : 'village');

const isAlive = (s: MaSoiState, id: string) => s.seats.includes(id) && !(id in s.dead);
const living = (s: MaSoiState) => s.seats.filter((id) => !(id in s.dead));
const livingWith = (s: MaSoiState, role: MaSoiRole) => living(s).filter((id) => s.roles[id] === role);
const hasRole = (s: MaSoiState, role: MaSoiRole) => s.seats.some((id) => s.roles[id] === role);
const withLog = (s: MaSoiState, ...entries: MaSoiLogEntry[]): MaSoiState => ({ ...s, log: [...s.log, ...entries].slice(-LOG_LIMIT) });
const bySeat = (s: MaSoiState, ids: string[]) => s.seats.filter((id) => ids.includes(id));

function enter(s: MaSoiState, phase: MaSoiPhase, now: number, ms: number): MaSoiState {
  return { ...s, phase, deadline: now + ms, phaseMs: ms, ready: [], said: [] };
}

function finish(s: MaSoiState, winner: MaSoiTeam): MaSoiState {
  return withLog({ ...s, phase: 'over', deadline: 0, phaseMs: 0, hunter: null, result: { winner } }, { kind: 'end', winner });
}

// Records deaths; a hunter killed by anything but poison (or walking out) gets a last shot.
function kill(s: MaSoiState, deaths: [string, MaSoiCause][]): MaSoiState {
  const dead = { ...s.dead };
  let hunter = s.hunter;
  for (const [id, cause] of deaths) {
    if (id in dead || !s.seats.includes(id)) continue;
    dead[id] = { day: s.day, cause };
    if (s.roles[id] === 'hunter' && cause !== 'poison' && cause !== 'left') hunter = id;
  }
  return { ...s, dead, hunter };
}

// The village wins with no wolves left. Otherwise, unless a hunter is about to shoot, the wolves
// win once they are as many as everyone else.
function checkWin(s: MaSoiState): MaSoiState {
  const alive = living(s);
  const wolves = alive.filter((id) => s.roles[id] === 'wolf').length;
  if (wolves === 0) return finish(s, 'village');
  if (s.hunter !== null && s.hunter in s.dead) return s;
  if (wolves >= alive.length - wolves) return finish(s, 'wolves');
  return s;
}

function startNight(s: MaSoiState, now: number): MaSoiState {
  const day = s.phase === 'intro' ? 1 : s.day + 1;
  const fresh: MaSoiState = { ...s, day, wolfVotes: {}, wolfLast: null, seerPick: null, guardPick: null, victim: null, healed: false, poisoned: null, witchDone: false, votes: {}, accused: null, verdict: {} };
  return withLog(enter(fresh, 'night', now, MS_NIGHT_MS), { kind: 'night', day });
}

const startDay = (s: MaSoiState, now: number) => enter(s, 'discuss', now, s.talkMs);

// Every living wolf has picked, and they agree.
function wolvesAgree(s: MaSoiState): boolean {
  const picks = livingWith(s, 'wolf').map((id) => s.wolfVotes[id]);
  return picks.every((p) => p !== undefined) && new Set(picks).size === 1;
}

const nightDone = (s: MaSoiState) =>
  wolvesAgree(s) && (livingWith(s, 'seer').length === 0 || s.seerPick !== null) && (livingWith(s, 'guard').length === 0 || s.guardPick !== null);

// The wolves' victim: the most picked, a tie settled by chance. Then the witch's turn, which takes
// a while even when she's dead or out of potions, so nobody can tell (unless roles are revealed).
function endWolves(s: MaSoiState, now: number, random: () => number): MaSoiState {
  const counts = new Map<string, number>();
  for (const wolf of livingWith(s, 'wolf')) {
    const target = s.wolfVotes[wolf];
    if (target && isAlive(s, target)) counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  const top = Math.max(0, ...counts.values());
  const tied = [...counts].filter(([, n]) => n === top && top > 0).map(([id]) => id);
  const victim = tied.length ? bySeat(s, tied)[Math.floor(random() * tied.length)] : null;
  const next: MaSoiState = { ...s, victim, guardLast: s.guardPick };
  if (!hasRole(s, 'witch')) return dawn(next, now);
  const witch = s.seats.find((id) => s.roles[id] === 'witch')!;
  const canAct = isAlive(s, witch) && (s.potions.heal || s.potions.poison);
  if (!canAct && s.reveal && !isAlive(s, witch)) return dawn(next, now);
  return enter(next, 'witch', now, canAct ? MS_WITCH_MS : 4000 + Math.floor(random() * 4000));
}

function dawn(s: MaSoiState, now: number): MaSoiState {
  const deaths: [string, MaSoiCause][] = [];
  if (s.victim && s.victim !== s.guardPick && !s.healed) deaths.push([s.victim, 'wolves']);
  if (s.poisoned && !deaths.some(([id]) => id === s.poisoned)) deaths.push([s.poisoned, 'poison']);
  const before = new Set(Object.keys(s.dead));
  let next = kill(s, deaths);
  const dead = bySeat(next, Object.keys(next.dead).filter((id) => !before.has(id)));
  next = withLog({ ...enter(next, 'dawn', now, MS_DAWN_MS), after: 'discuss' }, { kind: 'dawn', day: s.day, dead });
  return checkWin(next);
}

// After the morning's or evening's news: the hunter's shot if there is one, then on with the day.
function afterNews(s: MaSoiState, now: number): MaSoiState {
  if (s.hunter !== null) return enter(s, 'hunter', now, MS_HUNTER_MS);
  return s.after === 'discuss' ? startDay(s, now) : startNight(s, now);
}

function shoot(s: MaSoiState, target: string | null, now: number): MaSoiState {
  const hunter = s.hunter!;
  let next = withLog({ ...s, hunter: null }, { kind: 'shot', hunter, target });
  if (target) next = kill(next, [[target, 'shot']]);
  next = checkWin(next);
  if (next.result) return next;
  return next.after === 'discuss' ? startDay(next, now) : startNight(next, now);
}

// Who goes up: the most votes, unless it's a tie or at least as many chose nobody.
function tallyVotes(s: MaSoiState, now: number): MaSoiState {
  const counts = new Map<string, number>();
  let skips = 0;
  for (const voter of living(s)) {
    const v = s.votes[voter];
    if (v === null) skips++;
    else if (v !== undefined && isAlive(s, v)) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const top = Math.max(0, ...counts.values());
  const tied = [...counts].filter(([, n]) => n === top && top > 0).map(([id]) => id);
  const next = withLog(s, { kind: 'votes', day: s.day, votes: { ...s.votes } });
  if (tied.length !== 1 || top <= skips) {
    return withLog({ ...enter(next, 'dusk', now, MS_DUSK_MS), after: 'night' }, { kind: 'no-lynch', reason: tied.length > 1 && top > skips ? 'tie' : 'skip' });
  }
  return withLog({ ...enter(next, 'defense', now, MS_DEFENSE_MS), accused: tied[0] }, { kind: 'accused', player: tied[0], votes: top });
}

// The accused hangs if more vote to hang than to spare.
function tallyVerdict(s: MaSoiState, now: number): MaSoiState {
  const accused = s.accused!;
  const voters = living(s).filter((id) => id !== accused);
  const hang = voters.filter((id) => s.verdict[id] === true);
  const spare = voters.filter((id) => s.verdict[id] === false);
  const hanged = hang.length > spare.length && isAlive(s, accused);
  let next = withLog({ ...enter(s, 'dusk', now, MS_DUSK_MS), after: 'night' }, { kind: 'verdict', player: accused, hang, spare, hanged });
  if (hanged) next = checkWin(kill(next, [[accused, 'lynch']]));
  return next;
}

// Moves the game on once nobody is left to wait for in this phase.
function advance(s: MaSoiState, now: number, random: () => number): MaSoiState {
  if (s.result) return s;
  const alive = living(s);
  switch (s.phase) {
    case 'intro':
      return alive.every((id) => s.ready.includes(id)) ? startNight(s, now) : s;
    case 'night':
      return nightDone(s) ? endWolves(s, now, random) : s;
    case 'witch':
      return s.witchDone && livingWith(s, 'witch').length > 0 ? dawn(s, now) : s;
    case 'discuss':
      return alive.every((id) => s.ready.includes(id)) ? enter(s, 'vote', now, MS_VOTE_MS) : s;
    case 'vote':
      return alive.every((id) => id in s.votes) ? tallyVotes(s, now) : s;
    case 'defense':
      return s.accused !== null && s.ready.includes(s.accused) ? enter(s, 'verdict', now, MS_VERDICT_MS) : s;
    case 'verdict':
      return alive.filter((id) => id !== s.accused).every((id) => id in s.verdict) ? tallyVerdict(s, now) : s;
    default:
      return s;
  }
}

const fail = { ok: false as const, error: 'INVALID_MOVE' as const };
const ok = (state: MaSoiState) => ({ ok: true as const, state });

// Whether a player may speak to the whole village right now.
const mayTalk = (s: MaSoiState, id: string) => isAlive(s, id) && (s.phase === 'discuss' || s.phase === 'vote' || (s.phase === 'defense' && s.accused === id) || s.phase === 'intro');

function roleVisible(s: MaSoiState, viewer: string, id: string): boolean {
  if (s.result || viewer === id) return true;
  const seated = s.seats.includes(viewer);
  if (seated && viewer in s.dead) return true;
  if (seated && s.roles[viewer] === 'wolf' && s.roles[id] === 'wolf') return true;
  return s.reveal && id in s.dead;
}

function publicCause(cause: MaSoiCause): MaSoiPublicCause {
  return cause === 'wolves' || cause === 'poison' ? 'night' : cause;
}

export const maSoiGame: GameDefinition<MaSoiState, MaSoiMove, MaSoiView> = {
  type: 'masoi',

  setup(playerIds, options, { now, random = Math.random }) {
    const lineup = maSoiLineup(playerIds.length, options);
    // Shuffle the cards, then deal them round the table.
    for (let i = lineup.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [lineup[i], lineup[j]] = [lineup[j], lineup[i]];
    }
    return {
      seats: [...playerIds],
      roles: Object.fromEntries(playerIds.map((id, i) => [id, lineup[i]])),
      dead: {},
      reveal: options.masoiReveal ?? true,
      talkMs: MS_TALK_MS[options.masoiTalk] ?? MS_TALK_MS.normal,
      phase: 'intro',
      day: 0,
      deadline: now + MS_INTRO_MS,
      phaseMs: MS_INTRO_MS,
      ready: [],
      said: [],
      wolfVotes: {},
      wolfLast: null,
      seerPick: null,
      seerChecks: [],
      guardPick: null,
      guardLast: null,
      victim: null,
      potions: { heal: true, poison: true },
      healed: false,
      poisoned: null,
      witchDone: false,
      votes: {},
      accused: null,
      verdict: {},
      hunter: null,
      after: 'discuss',
      log: [],
      result: null,
    };
  },

  applyMove(s, playerId, move, { now, random = Math.random }) {
    if (s.result) return { ok: false, error: 'GAME_OVER' };
    if (!s.seats.includes(playerId)) return { ok: false, error: 'NOT_A_PLAYER' };
    if (typeof move !== 'object' || move === null) return fail;
    const role = s.roles[playerId];
    const alive = isAlive(s, playerId);
    const target = 'target' in move ? move.target : undefined;
    const done = (next: MaSoiState) => ok(advance(next, now, random));

    if (move.type === 'shoot') {
      if (s.phase !== 'hunter' || s.hunter !== playerId) return fail;
      if (target !== null && (typeof target !== 'string' || !isAlive(s, target))) return fail;
      return ok(shoot(s, target ?? null, now));
    }
    if (!alive) return fail;

    switch (move.type) {
      case 'kill':
        if (s.phase !== 'night' || role !== 'wolf' || typeof target !== 'string' || !isAlive(s, target) || s.roles[target] === 'wolf') return fail;
        if (s.wolfVotes[playerId] === target) return fail;
        return done({ ...s, wolfVotes: { ...s.wolfVotes, [playerId]: target }, wolfLast: playerId });
      case 'check': {
        if (s.phase !== 'night' || role !== 'seer' || s.seerPick !== null || typeof target !== 'string' || target === playerId || !isAlive(s, target)) return fail;
        const check = { day: s.day, target, wolf: s.roles[target] === 'wolf' };
        return done({ ...s, seerPick: target, seerChecks: [...s.seerChecks, check] });
      }
      case 'protect':
        if (s.phase !== 'night' || role !== 'guard' || s.guardPick !== null || typeof target !== 'string' || !isAlive(s, target) || target === s.guardLast) return fail;
        return done({ ...s, guardPick: target });
      case 'heal':
        if (s.phase !== 'witch' || role !== 'witch' || s.witchDone || !s.potions.heal || s.victim === null) return fail;
        return done({ ...s, healed: true, witchDone: true, potions: { ...s.potions, heal: false } });
      case 'poison':
        if (s.phase !== 'witch' || role !== 'witch' || s.witchDone || !s.potions.poison || typeof target !== 'string' || target === playerId || !isAlive(s, target)) return fail;
        return done({ ...s, poisoned: target, witchDone: true, potions: { ...s.potions, poison: false } });
      case 'pass':
        if (s.phase !== 'witch' || role !== 'witch' || s.witchDone) return fail;
        return done({ ...s, witchDone: true });
      case 'ready': {
        const allowed = s.phase === 'intro' || s.phase === 'discuss' || (s.phase === 'defense' && s.accused === playerId);
        if (!allowed || s.ready.includes(playerId)) return fail;
        return done({ ...s, ready: [...s.ready, playerId] });
      }
      case 'vote':
        if (s.phase !== 'vote' || (target !== null && (typeof target !== 'string' || target === playerId || !isAlive(s, target)))) return fail;
        if (s.votes[playerId] === target) return fail;
        return done({ ...s, votes: { ...s.votes, [playerId]: target ?? null } });
      case 'verdict':
        if (s.phase !== 'verdict' || playerId === s.accused || typeof move.hang !== 'boolean' || s.verdict[playerId] === move.hang) return fail;
        return done({ ...s, verdict: { ...s.verdict, [playerId]: move.hang } });
      case 'say': {
        if (!MASOI_LINES.includes(move.line) || !mayTalk(s, playerId) || s.said.includes(playerId)) return fail;
        const needsTarget = move.line === 'seer-wolf' || move.line === 'seer-clean' || move.line === 'accuse';
        if (needsTarget && (typeof target !== 'string' || target === playerId || !s.seats.includes(target))) return fail;
        if (move.line === 'claim' && !MASOI_ROLES.includes(move.role as MaSoiRole)) return fail;
        const entry: MaSoiLogEntry = {
          kind: 'say',
          player: playerId,
          line: move.line,
          ...(needsTarget ? { target: target as string } : {}),
          ...(move.line === 'claim' ? { role: move.role } : {}),
          v: Math.floor(random() * 6),
        };
        return ok(withLog({ ...s, said: [...s.said, playerId] }, entry));
      }
    }
    return fail;
  },

  // A player who walks out dies on the spot; the game goes on without them.
  forfeit(s, playerId, { now, random = Math.random }) {
    if (s.result || !s.seats.includes(playerId)) return s;
    if (s.hunter === playerId) {
      const next = withLog({ ...s, hunter: null }, { kind: 'left', player: playerId });
      if (s.phase !== 'hunter') return checkWin(next);
      const after = checkWin(next);
      if (after.result) return after;
      return next.after === 'discuss' ? startDay(next, now) : startNight(next, now);
    }
    if (!isAlive(s, playerId)) return s;
    const drop = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([k, v]) => k !== playerId && v !== playerId)) as Record<string, T>;
    let next = withLog(kill(s, [[playerId, 'left']]), { kind: 'left', player: playerId });
    next = { ...next, wolfVotes: drop(next.wolfVotes), votes: drop(next.votes), verdict: drop(next.verdict) };
    if (next.wolfLast === playerId) next.wolfLast = null;
    if ((s.phase === 'defense' || s.phase === 'verdict') && s.accused === playerId) next = { ...enter(next, 'dusk', now, MS_DUSK_MS), after: 'night' };
    next = checkWin(next);
    return advance(next, now, random);
  },

  isOver(s) {
    return s.result !== null;
  },

  playerView(s, viewer, { now }) {
    const seated = s.seats.includes(viewer);
    const role = seated ? s.roles[viewer] : null;
    const ghost = seated && viewer in s.dead;
    const lineup: Partial<Record<MaSoiRole, number>> = {};
    for (const id of s.seats) lineup[s.roles[id]] = (lineup[s.roles[id]] ?? 0) + 1;
    const mine = (r: MaSoiRole) => role === r && !ghost;
    return {
      phase: s.phase,
      day: s.day,
      msLeft: s.result ? 0 : Math.max(0, s.deadline - now),
      phaseMs: s.phaseMs,
      lineup,
      reveal: s.reveal,
      seats: s.seats.map((id) => {
        const death = s.dead[id];
        return {
          id,
          alive: !death,
          role: roleVisible(s, viewer, id) ? s.roles[id] : null,
          death: death ? { day: death.day, cause: s.result || ghost ? death.cause : publicCause(death.cause) } : null,
        };
      }),
      me: role ? { role, alive: !ghost } : null,
      ready: s.ready,
      said: s.said,
      wolfVotes: role === 'wolf' || ghost || s.result ? s.wolfVotes : null,
      seerChecks: role === 'seer' || s.result ? s.seerChecks : null,
      seerPick: mine('seer') ? s.seerPick : null,
      guardPick: mine('guard') ? s.guardPick : null,
      guardLast: mine('guard') ? s.guardLast : null,
      witch: mine('witch')
        ? { heal: s.potions.heal, poison: s.potions.poison, victim: s.phase === 'witch' ? s.victim : null, done: s.witchDone, healed: s.healed, poisoned: s.poisoned }
        : null,
      votes: s.votes,
      accused: s.accused,
      verdict: s.verdict,
      hunter: s.phase === 'hunter' ? s.hunter : null,
      log: s.log,
      result: s.result,
    };
  },

  deadline(s) {
    return s.result ? null : s.deadline;
  },

  timeout(s, { now, random = Math.random }) {
    if (s.result || now < s.deadline) return s;
    switch (s.phase) {
      case 'intro':
        return startNight(s, now);
      case 'night':
        return endWolves(s, now, random);
      case 'witch':
        return dawn(s, now);
      case 'dawn':
      case 'dusk':
        return afterNews(s, now);
      case 'hunter':
        return shoot(s, null, now);
      case 'discuss':
        return enter(s, 'vote', now, MS_VOTE_MS);
      case 'vote':
        return tallyVotes(s, now);
      case 'defense':
        return enter(s, 'verdict', now, MS_VERDICT_MS);
      case 'verdict':
        return s.accused === null ? afterNews({ ...s, after: 'night' }, now) : tallyVerdict(s, now);
      default:
        return s;
    }
  },

  // The winning side all share first place.
  points(s) {
    if (!s.result) return null;
    const winner = s.result.winner;
    return Object.fromEntries(s.seats.map((id) => [id, maSoiTeam(s.roles[id]) === winner ? { place: 1, points: 1 } : { place: 2, points: 0 }]));
  },

  // Living players talk to the village by day; at night only the wolves talk, among themselves.
  // The dead talk among themselves and hear everything; spectators have a channel of their own.
  chatRoute(s, playerId): ChatRoute {
    if (s.result) return { send: 'public', read: 'all' };
    if (!s.seats.includes(playerId)) return { send: 'watch', read: ['public', 'watch'] };
    if (playerId in s.dead) return { send: 'dead', read: 'all' };
    const wolf = s.roles[playerId] === 'wolf';
    const read = wolf ? ['public', 'wolves'] : ['public'];
    if (s.phase === 'night' || s.phase === 'witch') return { send: wolf ? 'wolves' : null, read };
    if (s.phase === 'defense') return { send: s.accused === playerId ? 'public' : null, read };
    return { send: 'public', read };
  },

  botMove(s, id, { random = Math.random }) {
    if (s.result) return null;
    if (s.phase === 'hunter') return s.hunter === id ? { type: 'shoot', target: topSuspect(s, id, random, living(s).filter((x) => x !== id)) } : null;
    if (!isAlive(s, id)) return null;
    const role = s.roles[id];
    const others = living(s).filter((x) => x !== id);
    switch (s.phase) {
      case 'intro':
        return s.ready.includes(id) ? null : { type: 'ready' };
      case 'night':
        if (role === 'wolf') return wolfBotPick(s, id, random);
        if (role === 'seer' && s.seerPick === null) {
          const checked = new Set(s.seerChecks.map((c) => c.target));
          const fresh = others.filter((x) => !checked.has(x));
          return { type: 'check', target: topSuspect(s, id, random, fresh.length ? fresh : others)! };
        }
        if (role === 'guard' && s.guardPick === null) {
          const choices = living(s).filter((x) => x !== s.guardLast);
          // Watch over whoever the village trusts as its seer; otherwise anyone, themselves included.
          const seer = trustedSeer(s, id);
          const target = seer && choices.includes(seer) ? seer : choices[Math.floor(random() * choices.length)];
          return target ? { type: 'protect', target } : null;
        }
        return null;
      case 'witch': {
        // Out of potions, a bot sits the turn out rather than ending it early and giving that away.
        if (role !== 'witch' || s.witchDone || (!s.potions.heal && !s.potions.poison)) return null;
        if (s.victim && s.potions.heal) return { type: 'heal' };
        if (s.potions.poison) {
          const scores = suspicion(s, id, random);
          const sure = others.filter((x) => (scores.get(x) ?? 0) >= 60).sort((a, b) => scores.get(b)! - scores.get(a)!);
          if (sure.length) return { type: 'poison', target: sure[0] };
        }
        return { type: 'pass' };
      }
      case 'discuss': {
        if (!s.said.includes(id)) {
          const line = botLine(s, id, random);
          if (line) return line;
        }
        return s.ready.includes(id) ? null : { type: 'ready' };
      }
      case 'vote': {
        if (id in s.votes) return null;
        const pool = role === 'wolf' ? others.filter((x) => s.roles[x] !== 'wolf') : others;
        // Go along with where the votes are heading, unless there's a reason not to. Wolves back a
        // fellow wolf who claimed to be the seer by voting against the real one.
        const tally = new Map<string, number>();
        for (const v of Object.values(s.votes)) if (v) tally.set(v, (tally.get(v) ?? 0) + 1);
        const seer = role === 'wolf' && sayings(s).some((e) => e.line === 'seer-wolf' && s.roles[e.player] === 'wolf') ? trustedSeer(s, id) : null;
        return { type: 'vote', target: topSuspect(s, id, random, pool, (x) => 3 * (tally.get(x) ?? 0) + (x === seer ? 50 : 0)) };
      }
      case 'defense': {
        if (s.accused !== id) return null;
        if (!s.said.includes(id)) return defenseLine(s, id, random);
        return s.ready.includes(id) ? null : { type: 'ready' };
      }
      case 'verdict': {
        if (s.accused === null || s.accused === id || id in s.verdict) return null;
        if (role === 'wolf') return { type: 'verdict', hang: s.roles[s.accused] !== 'wolf' };
        return { type: 'verdict', hang: (suspicion(s, id, random).get(s.accused) ?? 0) > -5 };
      }
    }
    return null;
  },
};

// ---- Bots ----
// Bots reason only from what they could know: their own role and checks, what's been said and how
// people voted, and (when roles are revealed on death) the roles of the dead. They can't read chat.

const sayings = (s: MaSoiState) => s.log.filter((e): e is Extract<MaSoiLogEntry, { kind: 'say' }> => e.kind === 'say');

// Who this bot takes for the real seer among those who claimed it: one revealed as the seer on
// death, or else the first to claim who hasn't been shown up as lying.
function trustedSeer(s: MaSoiState, bot: string): string | null {
  if (s.roles[bot] === 'seer') return bot;
  const claimers = [...new Set(sayings(s).filter((e) => e.line === 'seer-wolf' || e.line === 'seer-clean' || (e.line === 'claim' && e.role === 'seer')).map((e) => e.player))];
  const known = (id: string) => (id in s.dead && s.reveal) || (s.roles[bot] === 'wolf' && s.roles[id] === 'wolf');
  const proven = claimers.find((id) => known(id) && s.roles[id] === 'seer');
  if (proven) return proven;
  return claimers.find((id) => !known(id)) ?? null;
}

// How much this bot suspects each other living player of being a wolf (higher is more).
function suspicion(s: MaSoiState, bot: string, random: () => number): Map<string, number> {
  const scores = new Map<string, number>(living(s).filter((id) => id !== bot).map((id) => [id, random() * 3]));
  const add = (id: string | undefined, n: number) => {
    if (id && scores.has(id)) scores.set(id, scores.get(id)! + n);
  };
  const revealed = (id: string) => s.reveal && id in s.dead;
  const seer = trustedSeer(s, bot);
  for (const e of sayings(s)) {
    if (e.line === 'seer-wolf' || e.line === 'seer-clean') {
      if (e.player === seer) add(e.target, e.line === 'seer-wolf' ? 80 : -40);
      else if (seer !== null) add(e.player, 40);
    }
    if (e.line === 'claim' && e.role === 'seer' && seer !== null && e.player !== seer) add(e.player, 40);
    if (e.line === 'accuse' && e.player !== bot) add(e.target, 4);
    if (e.line === 'claim' && e.role !== 'seer') {
      // Two people claiming the same role can't both be telling the truth.
      const rivals = sayings(s).filter((o) => o.line === 'claim' && o.role === e.role && o.player !== e.player);
      add(e.player, rivals.length ? 20 : -10);
    }
  }
  // People who voted to accuse someone later shown to be a villager look worse, and better when
  // they went after a wolf.
  for (const e of s.log) {
    if (e.kind !== 'votes') continue;
    for (const [voter, target] of Object.entries(e.votes)) {
      if (target && revealed(target)) add(voter, s.roles[target] === 'wolf' ? -10 : 6);
    }
  }
  for (const c of s.roles[bot] === 'seer' ? s.seerChecks : []) add(c.target, c.wolf ? 1000 : -1000);
  return scores;
}

function topSuspect(s: MaSoiState, bot: string, random: () => number, pool: string[], bonus: (id: string) => number = () => 0): string | null {
  if (pool.length === 0) return null;
  const scores = suspicion(s, bot, random);
  return pool.reduce((best, id) => ((scores.get(id) ?? 0) + bonus(id) > (scores.get(best) ?? 0) + bonus(best) ? id : best));
}

// A wolf bot goes along with the wolf who last changed their pick (people come first that way);
// with no picks yet it goes for the village's seer, or whoever has been after the wolves.
function wolfBotPick(s: MaSoiState, id: string, random: () => number): MaSoiMove | null {
  const mine = s.wolfVotes[id];
  const lead = s.wolfLast && s.wolfLast !== id && isAlive(s, s.wolfLast) ? s.wolfVotes[s.wolfLast] : undefined;
  if (lead && isAlive(s, lead)) return mine === lead ? null : { type: 'kill', target: lead };
  if (mine) return null;
  const prey = living(s).filter((x) => s.roles[x] !== 'wolf');
  if (prey.length === 0) return null;
  const threat = new Map(prey.map((x) => [x, random() * 3]));
  const seer = trustedSeer(s, id);
  if (seer && threat.has(seer)) threat.set(seer, threat.get(seer)! + 100);
  for (const e of sayings(s)) {
    if (!threat.has(e.player)) continue;
    if (e.target && s.roles[e.target] === 'wolf') threat.set(e.player, threat.get(e.player)! + 10);
    if (e.line === 'claim' && (e.role === 'witch' || e.role === 'guard')) threat.set(e.player, threat.get(e.player)! + 30);
    // A hunter takes someone with them, so leave them be.
    if (e.line === 'claim' && e.role === 'hunter') threat.set(e.player, threat.get(e.player)! - 20);
  }
  const target = prey.reduce((best, x) => (threat.get(x)! > threat.get(best)! ? x : best));
  return { type: 'kill', target };
}

// What a bot says in the morning's discussion, if anything.
function botLine(s: MaSoiState, id: string, random: () => number): MaSoiMove | null {
  const role = s.roles[id];
  const said = sayings(s).filter((e) => e.player === id);
  if (role === 'seer') {
    // Out with any wolf found who is still alive; now and then vouch for someone found clean.
    const told = new Set(said.map((e) => e.target));
    const wolf = s.seerChecks.find((c) => c.wolf && isAlive(s, c.target) && !told.has(c.target));
    if (wolf) return { type: 'say', line: 'seer-wolf', target: wolf.target };
    const clean = s.seerChecks.find((c) => !c.wolf && isAlive(s, c.target) && !told.has(c.target));
    if (clean && s.day >= 2 && random() < 0.4) return { type: 'say', line: 'seer-clean', target: clean.target };
  }
  if (role === 'wolf') {
    // Called out by a seer: claim to be the real seer and turn it round on them, once a game.
    const outed = sayings(s).find((e) => e.line === 'seer-wolf' && e.target && s.roles[e.target] === 'wolf' && isAlive(s, e.player) && s.roles[e.player] !== 'wolf');
    const answered = sayings(s).some((e) => e.line === 'seer-wolf' && s.roles[e.player] === 'wolf');
    if (outed && !answered && (outed.target === id || random() < 0.5)) return { type: 'say', line: 'seer-wolf', target: outed.player };
  }
  const pool = living(s).filter((x) => x !== id && (role !== 'wolf' || s.roles[x] !== 'wolf'));
  const target = topSuspect(s, id, random, pool);
  if (!target) return null;
  const score = suspicion(s, id, random).get(target) ?? 0;
  if (score >= 10 || random() < 0.35) return { type: 'say', line: 'accuse', target };
  return null;
}

// What an accused bot says for itself: the truth about its role, or for a wolf, a lie now and then.
function defenseLine(s: MaSoiState, id: string, random: () => number): MaSoiMove {
  const role = s.roles[id];
  if (role === 'seer') {
    const wolf = s.seerChecks.find((c) => c.wolf && isAlive(s, c.target));
    return wolf ? { type: 'say', line: 'seer-wolf', target: wolf.target } : { type: 'say', line: 'claim', role: 'seer' };
  }
  if (role === 'guard' || role === 'witch' || role === 'hunter') return { type: 'say', line: 'claim', role };
  if (role === 'wolf' && random() < 0.3) {
    const fake = (['guard', 'hunter'] as const).find((r) => hasRole(s, r) && !(s.reveal && s.seats.some((x) => x in s.dead && s.roles[x] === r)));
    if (fake) return { type: 'say', line: 'claim', role: fake };
  }
  return { type: 'say', line: 'defend' };
}
