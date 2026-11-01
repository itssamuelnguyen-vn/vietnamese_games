import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_OPTIONS, type RoomOptions } from '../types';
import {
  MS_DUSK_MS,
  MS_INTRO_MS,
  MS_NIGHT_MS,
  maSoiGame,
  maSoiLineup,
  type MaSoiMove,
  type MaSoiRole,
  type MaSoiState,
} from './masoi';

const options: RoomOptions = { ...DEFAULT_ROOM_OPTIONS };
const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

// A game with the roles dealt as given, in seat order, sitting at the first night.
function game(roles: MaSoiRole[], opts: Partial<RoomOptions> = {}): MaSoiState {
  const seats = ids.slice(0, roles.length);
  const s = maSoiGame.setup(seats, { ...options, ...opts }, { now: 0, random: () => 0 }, null);
  const dealt = { ...s, roles: Object.fromEntries(seats.map((id, i) => [id, roles[i]])) };
  return maSoiGame.timeout!(dealt, { now: MS_INTRO_MS });
}

function act(s: MaSoiState, id: string, move: MaSoiMove, now = 1000, random = () => 0): MaSoiState {
  const r = maSoiGame.applyMove(s, id, move, { now, random });
  if (!r.ok) throw new Error(`${id} ${JSON.stringify(move)}: ${r.error}`);
  return r.state;
}

const later = (s: MaSoiState) => maSoiGame.timeout!(s, { now: s.deadline, random: () => 0 });
const view = (s: MaSoiState, id: string) => maSoiGame.playerView(s, id, { now: 0 });

// a: wolf, b: seer, c: guard, d: witch, e: hunter, f/g: villagers.
const FULL: MaSoiRole[] = ['wolf', 'seer', 'guard', 'witch', 'hunter', 'villager', 'villager'];

describe('ma soi lineup', () => {
  it('scales wolves with the table and fills the rest with the picked roles and villagers', () => {
    expect(maSoiLineup(5, options)).toEqual(['wolf', 'seer', 'guard', 'witch', 'hunter']);
    expect(maSoiLineup(8, options)).toEqual(['wolf', 'wolf', 'seer', 'guard', 'witch', 'hunter', 'villager', 'villager']);
    expect(maSoiLineup(12, options).filter((r) => r === 'wolf')).toHaveLength(3);
    expect(maSoiLineup(6, { masoiRoles: ['seer'], masoiWolves: 0 })).toEqual(['wolf', 'wolf', 'seer', 'villager', 'villager', 'villager']);
    // Never as many wolves as everyone else.
    expect(maSoiLineup(5, { masoiRoles: [], masoiWolves: 4 }).filter((r) => r === 'wolf')).toHaveLength(2);
  });

  it('deals every seat a role from the lineup', () => {
    const s = maSoiGame.setup(ids, options, { now: 0, random: Math.random }, null);
    expect(Object.values(s.roles).sort()).toEqual(maSoiLineup(7, options).sort());
    expect(s.phase).toBe('intro');
  });
});

describe('ma soi nights', () => {
  it('kills the wolves’ pick at dawn unless the guard watched them', () => {
    let s = game(FULL);
    expect(s).toMatchObject({ phase: 'night', day: 1, deadline: MS_INTRO_MS + MS_NIGHT_MS });
    s = act(s, 'a', { type: 'kill', target: 'f' });
    s = act(s, 'b', { type: 'check', target: 'a' });
    s = act(s, 'c', { type: 'protect', target: 'g' });
    // Everyone has acted: the witch wakes and is told who the wolves chose.
    expect(s.phase).toBe('witch');
    expect(view(s, 'd').witch).toMatchObject({ victim: 'f', heal: true, poison: true });
    expect(view(s, 'b').witch).toBeNull();
    s = act(s, 'd', { type: 'pass' });
    expect(s.phase).toBe('dawn');
    expect(s.dead.f).toEqual({ day: 1, cause: 'wolves' });
    expect(s.log.at(-1)).toEqual({ kind: 'dawn', day: 1, dead: ['f'] });

    let t = game(FULL);
    t = act(t, 'a', { type: 'kill', target: 'f' });
    t = act(t, 'b', { type: 'check', target: 'g' });
    t = act(t, 'c', { type: 'protect', target: 'f' });
    t = act(t, 'd', { type: 'pass' });
    expect(t.dead).toEqual({});
    expect(t.log.at(-1)).toEqual({ kind: 'dawn', day: 1, dead: [] });
  });

  it('shows the seer what they found, and only the seer', () => {
    let s = act(game(FULL), 'b', { type: 'check', target: 'a' });
    expect(view(s, 'b').seerChecks).toEqual([{ day: 1, target: 'a', wolf: true }]);
    expect(view(s, 'a').seerChecks).toBeNull();
    expect(() => act(s, 'b', { type: 'check', target: 'c' })).toThrow('INVALID_MOVE');
  });

  it('lets the witch save the victim or poison someone, once each per game and one a night', () => {
    let s = game(FULL);
    s = act(s, 'a', { type: 'kill', target: 'f' });
    s = act(s, 'b', { type: 'check', target: 'g' });
    s = act(s, 'c', { type: 'protect', target: 'c' });
    s = act(s, 'd', { type: 'heal' });
    expect(s.dead).toEqual({});
    expect(s.potions).toEqual({ heal: false, poison: true });
    // Next night: no saving any more, but the poison kills (the guard can't stop it).
    // Dawn, a day's talk and an empty vote, dusk, and night falls again.
    s = later(later(later(later(s))));
    expect(s).toMatchObject({ phase: 'night', day: 2 });
    s = act(s, 'a', { type: 'kill', target: 'g' });
    s = act(s, 'b', { type: 'check', target: 'f' });
    s = act(s, 'c', { type: 'protect', target: 'f' });
    expect(() => act(s, 'd', { type: 'heal' })).toThrow('INVALID_MOVE');
    s = act(s, 'd', { type: 'poison', target: 'f' });
    expect(s.dead).toMatchObject({ g: { cause: 'wolves' }, f: { cause: 'poison' } });
    // To the living a body is just a body; the cause shows once the game is over.
    expect(view(s, 'b').seats.find((x) => x.id === 'f')?.death).toEqual({ day: 2, cause: 'night' });
  });

  it('won’t let the guard watch the same player two nights running', () => {
    let s = game(FULL);
    s = act(s, 'a', { type: 'kill', target: 'f' });
    s = act(s, 'b', { type: 'check', target: 'g' });
    s = act(s, 'c', { type: 'protect', target: 'f' });
    s = act(s, 'd', { type: 'pass' });
    s = later(later(later(later(s))));
    expect(s).toMatchObject({ phase: 'night', day: 2, guardLast: 'f' });
    expect(() => act(s, 'c', { type: 'protect', target: 'f' })).toThrow('INVALID_MOVE');
  });

  it('settles disagreeing wolves at the deadline, a tie by chance', () => {
    let s = game(['wolf', 'wolf', 'villager', 'villager', 'villager', 'villager', 'villager']);
    s = act(s, 'a', { type: 'kill', target: 'c' });
    s = act(s, 'b', { type: 'kill', target: 'd' });
    expect(s.phase).toBe('night');
    s = later(s);
    expect(s.phase).toBe('dawn');
    expect(Object.keys(s.dead)).toHaveLength(1);
    expect(['c', 'd']).toContain(Object.keys(s.dead)[0]);
  });

  it('lets wolves see each other and their picks, and talk only among themselves at night', () => {
    let s = game(['wolf', 'wolf', 'seer', 'villager', 'villager', 'villager', 'villager']);
    s = act(s, 'a', { type: 'kill', target: 'c' });
    expect(view(s, 'b').seats.find((x) => x.id === 'a')?.role).toBe('wolf');
    expect(view(s, 'b').wolfVotes).toEqual({ a: 'c' });
    expect(view(s, 'c').seats.find((x) => x.id === 'a')?.role).toBeNull();
    expect(view(s, 'c').wolfVotes).toBeNull();
    expect(maSoiGame.chatRoute!(s, 'a')).toEqual({ send: 'wolves', read: ['public', 'wolves'] });
    expect(maSoiGame.chatRoute!(s, 'c')).toEqual({ send: null, read: ['public'] });
    expect(maSoiGame.chatRoute!(s, 'spectator')).toEqual({ send: 'watch', read: ['public', 'watch'] });
  });
});

describe('ma soi days', () => {
  // Day 1 with nobody dead: night passes with the guard watching the wolves' pick.
  function morning(roles = FULL) {
    let s = game(roles);
    s = act(s, 'a', { type: 'kill', target: 'f' });
    if (roles.includes('seer')) s = act(s, 'b', { type: 'check', target: 'g' });
    if (roles.includes('guard')) s = act(s, 'c', { type: 'protect', target: 'f' });
    if (s.phase === 'witch') s = act(s, 'd', { type: 'pass' });
    return later(s);
  }

  it('puts the most voted player up to defend themselves, then hangs them on a majority', () => {
    let s = morning();
    expect(s.phase).toBe('discuss');
    for (const id of ids) s = act(s, id, { type: 'ready' });
    expect(s.phase).toBe('vote');
    s = act(s, 'a', { type: 'vote', target: 'g' });
    s = act(s, 'b', { type: 'vote', target: 'a' });
    s = act(s, 'c', { type: 'vote', target: 'a' });
    s = act(s, 'd', { type: 'vote', target: 'a' });
    s = act(s, 'e', { type: 'vote', target: null });
    s = act(s, 'f', { type: 'vote', target: 'g' });
    s = act(s, 'g', { type: 'vote', target: 'f' });
    expect(s).toMatchObject({ phase: 'defense', accused: 'a' });
    // Only the accused talks while defending.
    expect(maSoiGame.chatRoute!(s, 'a').send).toBe('public');
    expect(maSoiGame.chatRoute!(s, 'b').send).toBeNull();
    s = act(s, 'a', { type: 'say', line: 'claim', role: 'seer' });
    s = act(s, 'a', { type: 'ready' });
    expect(s.phase).toBe('verdict');
    expect(() => act(s, 'a', { type: 'verdict', hang: false })).toThrow('INVALID_MOVE');
    for (const id of ['b', 'c', 'd', 'e']) s = act(s, id, { type: 'verdict', hang: true });
    s = act(s, 'f', { type: 'verdict', hang: false });
    s = act(s, 'g', { type: 'verdict', hang: false });
    // The last wolf hangs: the village wins.
    expect(s.dead.a).toMatchObject({ cause: 'lynch' });
    expect(s.result).toEqual({ winner: 'village' });
    expect(maSoiGame.points!(s)).toMatchObject({ a: { place: 2, points: 0 }, b: { place: 1, points: 1 } });
  });

  it('hangs nobody on a tied vote or when as many chose nobody', () => {
    let s = later(morning());
    s = act(s, 'a', { type: 'vote', target: 'g' });
    s = act(s, 'b', { type: 'vote', target: 'a' });
    s = later(s);
    expect(s.log.at(-1)).toEqual({ kind: 'no-lynch', reason: 'tie' });
    expect(s.phase).toBe('dusk');
    expect(later(s)).toMatchObject({ phase: 'night', day: 2 });

    let t = later(morning());
    t = act(t, 'a', { type: 'vote', target: 'g' });
    t = act(t, 'b', { type: 'vote', target: null });
    t = later(t);
    expect(t.log.at(-1)).toEqual({ kind: 'no-lynch', reason: 'skip' });
  });

  it('spares the accused unless more vote to hang', () => {
    let s = later(morning());
    s = act(s, 'b', { type: 'vote', target: 'g' });
    s = later(later(s));
    expect(s).toMatchObject({ phase: 'verdict', accused: 'g' });
    s = act(s, 'b', { type: 'verdict', hang: true });
    s = act(s, 'c', { type: 'verdict', hang: false });
    s = later(s);
    expect(s.log.at(-1)).toMatchObject({ kind: 'verdict', player: 'g', hanged: false });
    expect(s.dead).toEqual({});
  });

  it('gives a hanged hunter a last shot', () => {
    let s = later(morning());
    s = act(s, 'b', { type: 'vote', target: 'e' });
    s = later(later(s));
    s = act(s, 'b', { type: 'verdict', hang: true });
    s = later(s);
    expect(s).toMatchObject({ phase: 'dusk', hunter: 'e' });
    s = later(s);
    expect(s).toMatchObject({ phase: 'hunter', hunter: 'e' });
    expect(view(s, 'b').hunter).toBe('e');
    expect(() => act(s, 'b', { type: 'shoot', target: 'a' })).toThrow('INVALID_MOVE');
    s = act(s, 'e', { type: 'shoot', target: 'a' });
    expect(s.dead.a).toMatchObject({ cause: 'shot' });
    expect(s.result).toEqual({ winner: 'village' });
  });

  it('gives the wolves the win once they are as many as the rest, but lets a hunter shoot first', () => {
    // a: wolf, b: wolf, c: hunter, d, e: villagers. Night 1 the wolves eat the hunter.
    let s = game(['wolf', 'wolf', 'hunter', 'villager', 'villager']);
    s = act(s, 'a', { type: 'kill', target: 'c' });
    s = act(s, 'b', { type: 'kill', target: 'c' });
    expect(s).toMatchObject({ phase: 'dawn', hunter: 'c', result: null });
    s = later(s);
    s = act(s, 'c', { type: 'shoot', target: 'd' });
    expect(s.result).toEqual({ winner: 'wolves' });
  });

  it('reveals the roles of the dead only when the room says so, and everything to the dead', () => {
    let s = game(['wolf', 'seer', 'villager', 'villager', 'villager']);
    s = act(s, 'a', { type: 'kill', target: 'e' });
    s = act(s, 'b', { type: 'check', target: 'd' });
    s = later(later(s));
    s = act(s, 'b', { type: 'vote', target: 'c' });
    s = later(later(s));
    s = act(s, 'b', { type: 'verdict', hang: true });
    s = later(s);
    expect(view(s, 'd').seats.find((x) => x.id === 'c')?.role).toBe('villager');
    expect(view(s, 'c').seats.find((x) => x.id === 'a')?.role).toBe('wolf');
    expect(maSoiGame.chatRoute!(s, 'c')).toEqual({ send: 'dead', read: 'all' });
    const hidden = { ...s, reveal: false };
    expect(view(hidden, 'd').seats.find((x) => x.id === 'c')?.role).toBeNull();
  });

  it('kills a player who leaves and moves on without them', () => {
    let s = later(morning());
    s = act(s, 'b', { type: 'vote', target: 'g' });
    s = later(s);
    expect(s.accused).toBe('g');
    s = maSoiGame.forfeit(s, 'g', { now: 2000 }, 'left');
    expect(s).toMatchObject({ phase: 'dusk', deadline: 2000 + MS_DUSK_MS });
    expect(s.dead.g).toMatchObject({ cause: 'left' });
    s = maSoiGame.forfeit(s, 'a', { now: 3000 }, 'left');
    expect(s.result).toEqual({ winner: 'village' });
  });
});

describe('ma soi bots', () => {
  // Plays a whole game with bots in every seat, as the server would: bots act whenever they have
  // something to do, and the clock moves on when nobody does.
  function playOut(seed: number, n: number, opts: Partial<RoomOptions> = {}) {
    let x = seed;
    const random = () => {
      x = (x * 1103515245 + 12345) % 2 ** 31;
      return x / 2 ** 31;
    };
    const seats = Array.from({ length: n }, (_, i) => `bot:${i + 1}`);
    let s = maSoiGame.setup(seats, { ...options, ...opts }, { now: 0, random }, null);
    let now = 0;
    for (let step = 0; step < 5000 && !s.result; step++) {
      let moved = false;
      for (const id of seats) {
        const move = maSoiGame.botMove!(s, id, { now, random });
        if (!move) continue;
        const r = maSoiGame.applyMove(s, id, move, { now, random });
        if (!r.ok) throw new Error(`bot ${id} in ${s.phase}: ${JSON.stringify(move)} → ${r.error}`);
        s = r.state;
        moved = true;
        break;
      }
      if (!moved) {
        now = s.deadline;
        s = maSoiGame.timeout!(s, { now, random });
      }
    }
    return s;
  }

  it('play whole games to an end with legal moves', () => {
    const winners = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const s = playOut(seed, 5 + (seed % 8), seed % 3 === 0 ? { masoiReveal: false } : {});
      expect(s.result).not.toBeNull();
      winners.add(s.result!.winner);
    }
    // Neither side wins every game.
    expect(winners).toEqual(new Set(['village', 'wolves']));
  });

  it('have the seer speak up about a wolf it found', () => {
    let s = game(FULL);
    s = act(s, 'b', { type: 'check', target: 'a' });
    s = act(s, 'a', { type: 'kill', target: 'f' });
    s = act(s, 'c', { type: 'protect', target: 'f' });
    s = act(s, 'd', { type: 'pass' });
    s = later(s);
    expect(maSoiGame.botMove!(s, 'b', { now: 0, random: () => 0.9 })).toEqual({ type: 'say', line: 'seer-wolf', target: 'a' });
  });
});
