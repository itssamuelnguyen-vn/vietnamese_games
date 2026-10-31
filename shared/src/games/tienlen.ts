import { TURN_TIMERS, type GameDefinition, type HouseRuleId } from '../types';

// Tien len mien Nam, the Southern Vietnamese shedding card game ("go up").
// A card is a number 0–51: rank = card >> 2 (0 = 3, 1 = 4, …, 11 = A, 12 = 2) and
// suit = card & 3 (0 ♠, 1 ♣, 2 ♦, 3 ♥), so comparing cards is comparing numbers.

export type Card = number;
export const rankOf = (card: Card) => card >> 2;
export const suitOf = (card: Card) => card & 3;
const TWO = 12;
const ACE = 11;
const HAND_SIZE = 13;

export type ComboType = 'single' | 'pair' | 'triple' | 'quad' | 'straight' | 'pair-run';

export interface Combo {
  type: ComboType;
  // Number of cards.
  size: number;
  // Highest card; decides between combos of the same type and size.
  top: Card;
}

export type InstantWinKind = 'four-twos' | 'dragon' | 'six-pairs' | 'five-pair-run';

export type TienLenLogEntry =
  | { kind: 'play'; player: string; cards: Card[]; combo: ComboType; chop: boolean; auto: boolean }
  | { kind: 'pass'; player: string; auto: boolean }
  | { kind: 'finish'; player: string; place: number }
  | { kind: 'round'; leader: string }
  | { kind: 'left'; player: string };

export interface TienLenResult {
  // Player ids from first place to last.
  ranking: string[];
  instant: { player: string; kind: InstantWinKind } | null;
}

export interface TienLenState {
  // Turn order.
  seats: string[];
  hands: Record<string, Card[]>;
  // House rules switched on for this game.
  rules: HouseRuleId[];
  turn: string | null;
  // The combination currently on the table, who played it, and whether it was a chop.
  trick: { cards: Card[]; combo: Combo; by: string; chop: boolean } | null;
  // Players who passed this round; they sit out until a new round starts.
  passed: string[];
  // Players who emptied their hand, in finishing order.
  finished: string[];
  // Players who left mid-game; they rank last.
  out: string[];
  // The first play of the first game must include this card (the lowest one dealt).
  mustPlay: Card | null;
  result: TienLenResult | null;
  log: TienLenLogEntry[];
  turnLimitMs: number | null;
  turnDeadline: number | null;
}

export type TienLenMove = { type: 'play'; cards: Card[] } | { type: 'pass' };

export interface TienLenView {
  rules: HouseRuleId[];
  seats: { id: string; cards: number; passed: boolean; place: number | null; out: boolean }[];
  // The viewer's own hand (empty for spectators).
  hand: Card[];
  turn: string | null;
  trick: { cards: Card[]; combo: ComboType; by: string; chop: boolean } | null;
  mustPlay: Card | null;
  log: TienLenLogEntry[];
  result: TienLenResult | null;
  // Everyone's remaining cards, shown once the game is over.
  revealed: Record<string, Card[]> | null;
  turnMs: number | null;
  turnLimitMs: number | null;
}

const LOG_LIMIT = 30;
const sortCards = (cards: Card[]) => [...cards].sort((a, b) => a - b);

// What kind of combination these cards form, or null if they aren't a legal play.
export function classify(input: Card[]): Combo | null {
  const cards = sortCards(input);
  const n = cards.length;
  if (n === 0 || new Set(cards).size !== n) return null;
  const ranks = cards.map(rankOf);
  const top = cards[n - 1];
  const sameRank = ranks.every((r) => r === ranks[0]);
  if (sameRank) {
    const type = (['single', 'pair', 'triple', 'quad'] as const)[n - 1];
    return type ? { type, size: n, top } : null;
  }
  // Straights and pair runs never include a 2.
  if (ranks.includes(TWO)) return null;
  if (n >= 3 && ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1)) return { type: 'straight', size: n, top };
  if (n >= 6 && n % 2 === 0) {
    for (let i = 0; i < n; i += 2) {
      if (ranks[i] !== ranks[i + 1]) return null;
      if (i > 0 && ranks[i] !== ranks[i - 2] + 1) return null;
    }
    return { type: 'pair-run', size: n, top };
  }
  return null;
}

const isTwos = (c: Combo, size: number) => c.size === size && (c.type === 'single' || c.type === 'pair') && rankOf(c.top) === TWO;
const pairRunOf = (c: Combo) => (c.type === 'pair-run' ? c.size / 2 : 0);

// Whether `next` is a "chop": a bomb played on a 2 or on another bomb.
export function isChop(next: Combo, prev: Combo): boolean {
  return (next.type === 'quad' || pairRunOf(next) >= 3) && (isTwos(prev, 1) || isTwos(prev, 2) || prev.type === 'quad' || pairRunOf(prev) >= 3);
}

// Whether `next` may be played on top of `prev` (null = leading a new round).
export function beats(next: Combo, prev: Combo | null): boolean {
  if (!prev) return true;
  if (next.type === prev.type && next.size === prev.size) return next.top > prev.top;
  const runs = pairRunOf(next);
  // 3 pairs in a row chop a single 2.
  if (runs === 3) return isTwos(prev, 1);
  // Four of a kind chops a 2, a pair of 2s, or 3 pairs in a row.
  if (next.type === 'quad') return isTwos(prev, 1) || isTwos(prev, 2) || pairRunOf(prev) === 3;
  // 4+ pairs in a row chop all of those, four of a kind, and shorter runs of 4+ pairs.
  if (runs >= 4) {
    const prevRuns = pairRunOf(prev);
    return isTwos(prev, 1) || isTwos(prev, 2) || prev.type === 'quad' || prevRuns === 3 || (prevRuns >= 4 && prevRuns < runs);
  }
  return false;
}

// Instant wins: hands that win on the deal.
export function instantWin(hand: Card[]): InstantWinKind | null {
  const counts = Array<number>(13).fill(0);
  for (const c of hand) counts[rankOf(c)]++;
  if (counts[TWO] === 4) return 'four-twos';
  if (counts.slice(0, ACE + 1).every((n) => n > 0)) return 'dragon';
  // Four of a kind counts as two pairs.
  if (counts.reduce((sum, n) => sum + Math.floor(n / 2), 0) >= 6) return 'six-pairs';
  let run = 0;
  for (let r = 0; r <= ACE; r++) {
    run = counts[r] >= 2 ? run + 1 : 0;
    if (run >= 5) return 'five-pair-run';
  }
  return null;
}

// Every combination that can be made from a hand. For straights and pair runs, lower ranks use
// their lowest cards and only the top card varies, since only the top decides what they beat.
export function combosIn(hand: Card[]): Card[][] {
  const byRank = new Map<number, Card[]>();
  for (const c of sortCards(hand)) byRank.set(rankOf(c), [...(byRank.get(rankOf(c)) ?? []), c]);
  const out: Card[][] = [];

  // Singles, pairs, triples, four of a kind: every subset of one rank.
  for (const cards of byRank.values()) {
    for (let mask = 1; mask < 1 << cards.length; mask++) out.push(cards.filter((_, i) => mask & (1 << i)));
  }

  const ranks = [...byRank.keys()].filter((r) => r !== TWO).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    for (let j = i + 2; j < ranks.length && ranks[j] === ranks[i] + (j - i); j++) {
      const span = ranks.slice(i, j + 1);
      const low = span.slice(0, -1).map((r) => byRank.get(r)![0]);
      for (const top of byRank.get(span.at(-1)!)!) out.push([...low, top]);
    }
  }

  const pairRanks = ranks.filter((r) => byRank.get(r)!.length >= 2);
  for (let i = 0; i < pairRanks.length; i++) {
    for (let j = i + 2; j < pairRanks.length && pairRanks[j] === pairRanks[i] + (j - i); j++) {
      const span = pairRanks.slice(i, j + 1);
      const low = span.slice(0, -1).flatMap((r) => byRank.get(r)!.slice(0, 2));
      const [first, ...rest] = byRank.get(span.at(-1)!)!;
      for (const top of rest) out.push([...low, first, top]);
    }
  }
  return out;
}

// Legal plays in the order a hint should offer them. Beating: the smallest combination of the
// same kind, bombs last. Leading: get rid of the lowest cards, in the longest combination.
export function hintPlays(hand: Card[], trick: Combo | null, mustPlay: Card | null): Card[][] {
  const legal = combosIn(hand)
    .map((cards) => ({ cards, combo: classify(cards)! }))
    .filter(({ cards, combo }) => combo && beats(combo, trick) && (mustPlay === null || cards.includes(mustPlay)));
  const bomb = (c: Combo) => c.type === 'quad' || pairRunOf(c) >= 3;
  if (trick) {
    return legal
      .sort((a, b) => Number(bomb(a.combo) && !bomb(trick)) - Number(bomb(b.combo) && !bomb(trick)) || a.combo.top - b.combo.top)
      .map((p) => p.cards);
  }
  return legal
    .filter(({ combo }) => !bomb(combo) || mustPlay !== null)
    .sort((a, b) => Math.min(...a.cards) - Math.min(...b.cards) || b.cards.length - a.cards.length || a.combo.top - b.combo.top)
    .map((p) => p.cards);
}

// Double-tap selection: the most natural legal combination containing `card`.
export function quickPick(hand: Card[], card: Card, trick: Combo | null, mustPlay: Card | null): Card[] | null {
  const options = hintPlays(hand, trick, mustPlay).filter((cards) => cards.includes(card));
  if (options.length === 0) return null;
  if (trick) return options[0];
  // Leading: all cards of that rank if it has a set, otherwise the longest run through it.
  const sameRank = options.filter((cards) => cards.every((c) => rankOf(c) === rankOf(card)));
  const pool = sameRank.some((cards) => cards.length > 1) ? sameRank : options;
  return pool.reduce((best, cards) => (cards.length > best.length ? cards : best));
}

function shuffled(random: () => number): Card[] {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const active = (s: TienLenState, id: string) => (s.hands[id]?.length ?? 0) > 0 && !s.out.includes(id);
const withLog = (s: TienLenState, entry: TienLenLogEntry) => [...s.log, entry].slice(-LOG_LIMIT);

function nextActiveAfter(s: TienLenState, from: string): string | null {
  const i = s.seats.indexOf(from);
  for (let step = 1; step <= s.seats.length; step++) {
    const id = s.seats[(i + step) % s.seats.length];
    if (active(s, id)) return id;
  }
  return null;
}

function startTurn(s: TienLenState, turn: string | null, now: number): TienLenState {
  return { ...s, turn, turnDeadline: turn && s.turnLimitMs ? now + s.turnLimitMs : null };
}

// Ends the game once at most one player still holds cards.
function maybeFinish(s: TienLenState): TienLenState {
  const remaining = s.seats.filter((id) => active(s, id));
  if (remaining.length > 1) return s;
  const ranking = [...s.finished, ...remaining, ...[...s.out].reverse()];
  return { ...s, turn: null, turnDeadline: null, result: { ranking, instant: null } };
}

// Hands the turn to the next player who can still respond, or starts a new round when
// everyone else has passed.
function advance(s: TienLenState, from: string, now: number): TienLenState {
  const i = s.seats.indexOf(from);
  for (let step = 1; step <= s.seats.length; step++) {
    const id = s.seats[(i + step) % s.seats.length];
    if (s.trick && id === s.trick.by) break;
    if (active(s, id) && !s.passed.includes(id)) return startTurn(s, id, now);
  }
  // New round: the last player to play leads, or the next one if they've gone out.
  const owner = s.trick?.by ?? from;
  const leader = active(s, owner) ? owner : nextActiveAfter(s, owner);
  const next = { ...s, trick: null, passed: [], log: leader ? withLog(s, { kind: 'round', leader }) : s.log };
  return startTurn(next, leader, now);
}

// Why a play isn't allowed under the table's rules, or null if it is.
export function playProblem(
  s: Pick<TienLenState, 'rules' | 'trick' | 'mustPlay'>,
  hand: Card[],
  cards: Card[],
): 'invalid' | 'must-play' | 'cannot-beat' | 'stacked-chop' | 'two-finish' | null {
  const combo = classify(cards);
  if (!combo) return 'invalid';
  if (s.mustPlay !== null && !cards.includes(s.mustPlay)) return 'must-play';
  if (s.trick && s.trick.chop && s.rules.includes('no-stack-chop')) return 'stacked-chop';
  if (s.trick && !beats(combo, s.trick.combo)) return 'cannot-beat';
  if (s.rules.includes('no-two-finish') && cards.length === hand.length && cards.some((c) => rankOf(c) === TWO)) return 'two-finish';
  return null;
}

// "4 pairs in a row chop anytime": such a run may chop out of turn, even after passing.
export function canChopOutOfTurn(s: Pick<TienLenState, 'rules' | 'trick'>, cards: Card[]): boolean {
  const combo = classify(cards);
  return !!combo && !!s.trick && s.rules.includes('four-pairs-anytime') && pairRunOf(combo) >= 4 && isChop(combo, s.trick.combo);
}

function play(s: TienLenState, player: string, cards: Card[], now: number, auto: boolean): TienLenState | null {
  const hand = s.hands[player];
  if (!Array.isArray(cards) || !cards.every((c) => Number.isInteger(c) && hand.includes(c))) return null;
  if (playProblem(s, hand, cards)) return null;
  const combo = classify(cards)!;

  const chop = !!s.trick && isChop(combo, s.trick.combo);
  const rest = hand.filter((c) => !cards.includes(c));
  let next: TienLenState = {
    ...s,
    hands: { ...s.hands, [player]: rest },
    // An out-of-turn chop brings a player who had passed back into the round.
    passed: s.passed.filter((id) => id !== player),
    trick: { cards: sortCards(cards), combo, by: player, chop },
    mustPlay: null,
    log: withLog(s, { kind: 'play', player, cards: sortCards(cards), combo: combo.type, chop, auto }),
  };
  if (rest.length === 0) {
    const finished = [...next.finished, player];
    next = { ...next, finished, log: withLog(next, { kind: 'finish', player, place: finished.length }) };
  }
  next = maybeFinish(next);
  return next.result ? next : advance(next, player, now);
}

export const tienlenGame: GameDefinition<TienLenState, TienLenMove, TienLenView> = {
  type: 'tienlen',

  setup(playerIds, options, { now, random = Math.random }, previous) {
    const deck = shuffled(random);
    const hands = Object.fromEntries(playerIds.map((id, i) => [id, sortCards(deck.slice(i * HAND_SIZE, (i + 1) * HAND_SIZE))]));
    const base: TienLenState = {
      seats: playerIds,
      hands,
      rules: [...(options.houseRules ?? [])],
      turn: null,
      trick: null,
      passed: [],
      finished: [],
      out: [],
      mustPlay: null,
      result: null,
      log: [],
      turnLimitMs: TURN_TIMERS[options.turnTimer] ?? null,
      turnDeadline: null,
    };

    // The previous winner leads; otherwise whoever holds the lowest card dealt, which they must play.
    const lastWinner = previous?.result?.ranking[0];
    let leader: string;
    if (lastWinner && playerIds.includes(lastWinner)) leader = lastWinner;
    else {
      const lowest = Math.min(...playerIds.flatMap((id) => hands[id]));
      leader = playerIds.find((id) => hands[id].includes(lowest))!;
      base.mustPlay = lowest;
    }

    // A winning deal ends the game immediately, checked from the leader around the table.
    const order = [...playerIds.slice(playerIds.indexOf(leader)), ...playerIds.slice(0, playerIds.indexOf(leader))];
    for (const id of order) {
      const kind = instantWin(hands[id]);
      if (kind) return { ...base, mustPlay: null, result: { ranking: [id, ...order.filter((p) => p !== id)], instant: { player: id, kind } } };
    }
    return startTurn(base, leader, now);
  },

  applyMove(state, playerId, move, { now }) {
    if (state.result) return { ok: false, error: 'GAME_OVER' };
    if (!state.seats.includes(playerId) || !active(state, playerId)) return { ok: false, error: 'NOT_A_PLAYER' };
    if (state.turn !== playerId) {
      if (move.type === 'play' && Array.isArray(move.cards) && canChopOutOfTurn(state, move.cards)) {
        const next = play(state, playerId, move.cards, now, false);
        return next ? { ok: true, state: next } : { ok: false, error: 'INVALID_MOVE' };
      }
      return { ok: false, error: 'NOT_YOUR_TURN' };
    }

    if (move.type === 'pass') {
      // Whoever leads a round has to play something.
      if (!state.trick) return { ok: false, error: 'INVALID_MOVE' };
      const passed = { ...state, passed: [...state.passed, playerId], log: withLog(state, { kind: 'pass', player: playerId, auto: false }) };
      return { ok: true, state: advance(passed, playerId, now) };
    }
    if (move.type === 'play') {
      const next = play(state, playerId, move.cards, now, false);
      return next ? { ok: true, state: next } : { ok: false, error: 'INVALID_MOVE' };
    }
    return { ok: false, error: 'INVALID_MOVE' };
  },

  forfeit(state, playerId, { now }) {
    if (state.result || !state.seats.includes(playerId) || state.out.includes(playerId)) return state;
    let next: TienLenState = {
      ...state,
      out: [...state.out, playerId],
      hands: { ...state.hands, [playerId]: [] },
      passed: state.passed.filter((id) => id !== playerId),
      log: withLog(state, { kind: 'left', player: playerId }),
    };
    next = maybeFinish(next);
    if (next.result) return next;
    return state.turn === playerId ? advance(next, playerId, now) : next;
  },

  deadline(state) {
    return state.result ? null : state.turnDeadline;
  },

  // Out of time: pass, or lead the lowest card (the required one in the first play).
  timeout(state, { now }) {
    if (state.result || state.turnDeadline === null || now < state.turnDeadline || !state.turn) return state;
    const player = state.turn;
    if (state.trick) {
      const passed = { ...state, passed: [...state.passed, player], log: withLog(state, { kind: 'pass', player, auto: true }) };
      return advance(passed, player, now);
    }
    const card = state.mustPlay ?? Math.min(...state.hands[player]);
    return play(state, player, [card], now, true) ?? state;
  },

  isOver(state) {
    return state.result !== null;
  },

  playerView(state, playerId, { now }) {
    return {
      rules: state.rules,
      seats: state.seats.map((id) => ({
        id,
        cards: state.hands[id]?.length ?? 0,
        passed: state.passed.includes(id),
        place: state.result ? state.result.ranking.indexOf(id) + 1 : state.finished.includes(id) ? state.finished.indexOf(id) + 1 : null,
        out: state.out.includes(id),
      })),
      hand: state.hands[playerId] ?? [],
      turn: state.turn,
      trick: state.trick && { cards: state.trick.cards, combo: state.trick.combo.type, by: state.trick.by, chop: state.trick.chop },
      mustPlay: state.mustPlay,
      log: state.log,
      result: state.result,
      revealed: state.result ? state.hands : null,
      turnMs: state.turnDeadline === null ? null : Math.max(0, state.turnDeadline - now),
      turnLimitMs: state.turnLimitMs,
    };
  },
};
