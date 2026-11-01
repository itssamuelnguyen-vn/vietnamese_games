import type { GameDefinition } from '../types';

// Xi dach, the Vietnamese take on twenty-one. Each player stakes play money against the house,
// gets two cards and draws more ("rút") or stands ("dằn"), needing 16 or more to stand. Two aces
// (xì bàn) beat an ace with a ten-card (xì dách), which beats five cards under 22 (ngũ linh), which
// beat plain totals; over 21 is bust (quắc). The automatic house draws to at least 16. The host
// may instead seat one player as the dealer: they don't stake, play the dealer's hand last
// (standing on 16 or more, like everyone), and pay and collect from their own chips. After ten
// rounds the player with the most chips wins.

// A card is 0–51: rank = (card >> 2) + 1 (1 = A, 11 = J, 12 = Q, 13 = K), suit = card & 3 (♠ ♣ ♦ ♥).
export type XdCard = number;
export const xdRank = (card: XdCard) => (card >> 2) + 1;
export const xdSuit = (card: XdCard) => card & 3;

export const XD_START_CHIPS = 1000;
export const XD_ROUNDS = 10;
export const XD_BET_VALUES = [10, 50, 100, 200];
export const XD_MIN_STAND = 16;
export const XD_DEALER_STANDS = 16;
const MAX_CARDS = 5;
export const XD_BET_MS = 20_000;
export const XD_TURN_MS = 20_000;
// The dealer turns over and draws, then everyone is paid; the next round starts after this.
export const XD_REVEAL_MS = 6_000;
const LOG_LIMIT = 50;

export type HandKind = 'xi-ban' | 'xi-dach' | 'ngu-linh' | 'points' | 'bust';

export interface HandValue {
  kind: HandKind;
  // Best total not over 21 (or the lowest total when bust).
  total: number;
}

// Aces count 1, 10 or 11 while a hand has up to three cards, and 1 after that.
export function xdHandValue(cards: XdCard[]): HandValue {
  const ranks = cards.map(xdRank);
  if (cards.length === 2 && ranks.every((r) => r === 1)) return { kind: 'xi-ban', total: 21 };
  if (cards.length === 2 && ranks.includes(1) && ranks.some((r) => r >= 10)) return { kind: 'xi-dach', total: 21 };
  const base = ranks.reduce((sum, r) => sum + Math.min(r, 10), 0);
  let total = base;
  if (cards.length <= 3) {
    const aces = ranks.filter((r) => r === 1).length;
    // Each ace may add 9 (to count 10) or 10 (to count 11); take the best total that fits.
    for (let tens = 0; tens <= aces; tens++) {
      for (let elevens = 0; tens + elevens <= aces; elevens++) {
        const t = base + tens * 9 + elevens * 10;
        if (t <= 21 && t > total) total = t;
      }
    }
  }
  if (total > 21) return { kind: 'bust', total };
  if (cards.length >= MAX_CARDS) return { kind: 'ngu-linh', total };
  return { kind: 'points', total };
}

// Higher is better; bust is lowest.
function strength(v: HandValue): number {
  switch (v.kind) {
    case 'xi-ban':
      return 300;
    case 'xi-dach':
      return 200;
    case 'ngu-linh':
      return 100;
    case 'points':
      return v.total;
    case 'bust':
      return -1;
  }
}

// How many stakes a winning hand takes.
export const XD_MULTIPLIER: Record<HandKind, number> = { 'xi-ban': 3, 'xi-dach': 2, 'ngu-linh': 2, points: 1, bust: 1 };

// A player's hand against the dealer's: stakes won (positive), lost (negative), or 0 for a push.
// Both bust is a push; a player who went bust loses just their stake, whatever the dealer holds.
export function xdSettle(player: HandValue, dealer: HandValue): number {
  if (player.kind === 'bust') return dealer.kind === 'bust' ? 0 : -1;
  const p = strength(player);
  const d = strength(dealer);
  if (p > d) return XD_MULTIPLIER[player.kind];
  if (p < d) return -XD_MULTIPLIER[dealer.kind];
  return 0;
}

export type XiDachPhase = 'bet' | 'play' | 'reveal';

export type XiDachLogEntry =
  | { kind: 'round'; round: number }
  | { kind: 'hit'; player: string; cards: number }
  | { kind: 'stand'; player: string; auto: boolean }
  | { kind: 'bust'; player: string }
  // `player` is the seated dealer (null for the house), `net` what they won or lost this round.
  | { kind: 'dealer'; hand: XdCard[]; value: HandValue; player: string | null; net: number }
  // A seated dealer couldn't cover every win in full: the winners shared what the bank had.
  | { kind: 'bank-broke'; player: string }
  | { kind: 'result'; player: string; net: number; hand: HandValue }
  | { kind: 'left'; player: string };

export interface XiDachResult {
  ranking: string[];
  chips: Record<string, number>;
}

export interface XiDachState {
  seats: string[];
  // The seated player dealing, or null for the automatic house (also once a dealer leaves).
  dealerId: string | null;
  chips: Record<string, number>;
  bets: Record<string, number>;
  ready: string[];
  out: string[];
  hands: Record<string, XdCard[]>;
  dealer: XdCard[];
  deck: XdCard[];
  // Players who are done drawing this round.
  stood: string[];
  turn: string | null;
  round: number;
  phase: XiDachPhase;
  deadline: number;
  log: XiDachLogEntry[];
  result: XiDachResult | null;
}

export type XiDachMove = { type: 'bet'; amount: number } | { type: 'ready' } | { type: 'hit' } | { type: 'stand' };

export interface XiDachView {
  seats: { id: string; chips: number; bet: number; ready: boolean; out: boolean; cards: number; stood: boolean }[];
  // Hands everyone may see: your own, and everyone's once the round is revealed.
  hands: Record<string, XdCard[]>;
  dealerId: string | null;
  // The dealer's face-up card while the round is in play (the whole hand for the dealer
  // themselves); the whole hand once revealed.
  dealer: XdCard[];
  dealerCards: number;
  turn: string | null;
  round: number;
  rounds: number;
  phase: XiDachPhase;
  msLeft: number;
  log: XiDachLogEntry[];
  result: XiDachResult | null;
}

const active = (s: XiDachState) => s.seats.filter((id) => !s.out.includes(id));
// Everyone still at the table who plays against the dealer.
const punters = (s: XiDachState) => active(s).filter((id) => id !== s.dealerId);
const inRound = (s: XiDachState) => punters(s).filter((id) => (s.bets[id] ?? 0) > 0 && s.hands[id]?.length);
// The cards a seat plays: the dealer's hand for the seated dealer.
const cardsOf = (s: XiDachState, id: string) => (id === s.dealerId ? s.dealer : s.hands[id]);
const withLog = (s: XiDachState, ...entries: XiDachLogEntry[]): XiDachState => ({ ...s, log: [...s.log, ...entries].slice(-LOG_LIMIT) });

function shuffledDeck(random: () => number): XdCard[] {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Whether a hand is finished on its own: a special hand, five cards, or bust.
const settled = (cards: XdCard[]) => {
  const v = xdHandValue(cards);
  return v.kind !== 'points' || cards.length >= MAX_CARDS;
};

function finish(s: XiDachState): XiDachState {
  const chips = Object.fromEntries(s.seats.map((id) => [id, s.chips[id]]));
  const ranking = [...active(s).sort((a, b) => chips[b] - chips[a] || s.seats.indexOf(a) - s.seats.indexOf(b)), ...[...s.out].reverse()];
  return { ...s, turn: null, result: { ranking, chips } };
}

// The dealer turns over (the house draws to at least 16 first), then everyone in the round is paid.
function reveal(s: XiDachState, now: number): XiDachState {
  let deck = s.deck;
  const dealer = [...s.dealer];
  // The house doesn't draw when every player has already gone bust; a seated dealer has drawn already.
  const contest = inRound(s).some((id) => xdHandValue(s.hands[id]).kind !== 'bust');
  while (s.dealerId === null && contest && dealer.length < MAX_CARDS && xdHandValue(dealer).kind === 'points' && xdHandValue(dealer).total < XD_DEALER_STANDS) {
    dealer.push(deck[0]);
    deck = deck.slice(1);
  }
  const dv = xdHandValue(dealer);
  const next: XiDachState = { ...s, dealer, deck, phase: 'reveal', turn: null, deadline: now + XD_REVEAL_MS };
  const chips = { ...next.chips };
  // What each player's hand wins (positive) or loses against the dealer's.
  const owed = new Map(inRound(next).map((id) => [id, xdSettle(xdHandValue(next.hands[id]), dv) * next.bets[id]]));
  // The stake was set aside when the round was dealt: it comes back, plus or minus the winnings.
  // Nobody loses more than they have.
  const net = new Map<string, number>();
  for (const [id, amount] of owed) if (amount <= 0) net.set(id, Math.max(amount, -(chips[id] + next.bets[id])));
  const extra: XiDachLogEntry[] = [];
  if (next.dealerId !== null) {
    // A seated dealer collects from the losers first, then pays the winners from their own chips;
    // if that isn't enough, the winners share what there is.
    const bank = chips[next.dealerId] - [...net.values()].reduce((sum, n) => sum + n, 0);
    const wins = [...owed].filter(([, amount]) => amount > 0);
    const due = wins.reduce((sum, [, amount]) => sum + amount, 0);
    if (due <= bank) for (const [id, amount] of wins) net.set(id, amount);
    else {
      // Shares in proportion to what each was owed; the odd chips left by rounding go in seat
      // order, so the bank ends empty.
      const shares = wins.map(([id, amount]) => [id, Math.floor((amount * bank) / due)] as const);
      let left = bank - shares.reduce((sum, [, n]) => sum + n, 0);
      for (const [id, n] of shares) net.set(id, n + (left-- > 0 ? 1 : 0));
      extra.push({ kind: 'bank-broke', player: next.dealerId });
    }
  } else for (const [id, amount] of owed) if (amount > 0) net.set(id, amount);
  let dealerNet = 0;
  const results: XiDachLogEntry[] = [];
  for (const id of owed.keys()) {
    chips[id] += next.bets[id] + net.get(id)!;
    dealerNet -= net.get(id)!;
    results.push({ kind: 'result', player: id, net: net.get(id)!, hand: xdHandValue(next.hands[id]) });
  }
  if (next.dealerId !== null) chips[next.dealerId] += dealerNet;
  return withLog({ ...next, chips }, { kind: 'dealer', hand: dealer, value: dv, player: next.dealerId, net: dealerNet }, ...results, ...extra);
}

// The next player who still has to play this round, after `from` in seat order.
// A seated dealer plays last, unless every player has gone bust already.
function nextTurn(s: XiDachState, from: string | null, now: number): XiDachState {
  const order = inRound(s);
  const start = from ? order.indexOf(from) + 1 : 0;
  const up = order.slice(start).find((id) => !s.stood.includes(id));
  if (up) return { ...s, turn: up, deadline: now + XD_TURN_MS };
  const dealerPlays = s.dealerId !== null && !settled(s.dealer) && order.some((id) => xdHandValue(s.hands[id]).kind !== 'bust');
  return dealerPlays ? { ...s, turn: s.dealerId, deadline: now + XD_TURN_MS } : reveal(s, now);
}

function deal(s: XiDachState, now: number, random: () => number): XiDachState {
  const players = punters(s).filter((id) => (s.bets[id] ?? 0) > 0);
  if (players.length === 0) return nextRound({ ...s, phase: 'reveal' }, now);
  let deck = shuffledDeck(random);
  const hands: Record<string, XdCard[]> = {};
  for (const id of players) {
    hands[id] = deck.slice(0, 2);
    deck = deck.slice(2);
  }
  const dealer = deck.slice(0, 2);
  deck = deck.slice(2);
  // Stakes are set aside for the round.
  const chips = { ...s.chips };
  for (const id of players) chips[id] -= s.bets[id];
  let next: XiDachState = { ...s, chips, hands, dealer, deck, phase: 'play', stood: players.filter((id) => settled(hands[id])) };
  // A dealer holding xì bàn or xì dách shows it at once and the round is over.
  if (xdHandValue(dealer).kind !== 'points') return reveal(next, now);
  next = nextTurn(next, null, now);
  return next;
}

function nextRound(s: XiDachState, now: number): XiDachState {
  // Also over once no player has chips left, or a seated dealer's bank is empty.
  if (s.round >= XD_ROUNDS || punters(s).every((id) => s.chips[id] === 0) || (s.dealerId !== null && s.chips[s.dealerId] === 0)) return finish(s);
  const round = s.round + 1;
  return withLog(
    { ...s, round, phase: 'bet', bets: {}, ready: [], hands: {}, dealer: [], deck: [], stood: [], turn: null, deadline: now + XD_BET_MS },
    { kind: 'round', round },
  );
}

const waitingOn = (s: XiDachState) => punters(s).filter((id) => !s.ready.includes(id) && s.chips[id] > 0);

// Done drawing: the next player's turn, or the reveal once the seated dealer is done.
const done = (s: XiDachState, id: string, now: number) => (id === s.dealerId ? reveal(s, now) : nextTurn({ ...s, stood: [...s.stood, id] }, id, now));

function stand(s: XiDachState, id: string, now: number, auto: boolean): XiDachState {
  return done(withLog(s, { kind: 'stand', player: id, auto }), id, now);
}

function hit(s: XiDachState, id: string, now: number): XiDachState {
  const cards = [...cardsOf(s, id), s.deck[0]];
  const dealt = id === s.dealerId ? { dealer: cards } : { hands: { ...s.hands, [id]: cards } };
  let next = withLog({ ...s, ...dealt, deck: s.deck.slice(1) }, { kind: 'hit', player: id, cards: cards.length });
  if (xdHandValue(cards).kind === 'bust') next = withLog(next, { kind: 'bust', player: id });
  // Bust, five cards or a special hand: nothing more to decide.
  return settled(cards) ? done(next, id, now) : { ...next, deadline: now + XD_TURN_MS };
}

const fail = { ok: false as const, error: 'INVALID_MOVE' as const };

export const xiDachGame: GameDefinition<XiDachState, XiDachMove, XiDachView> = {
  type: 'xidach',

  setup(playerIds, options, { now }) {
    return {
      seats: [...playerIds],
      dealerId: playerIds.includes(options.xiDachDealer ?? '') ? options.xiDachDealer : null,
      chips: Object.fromEntries(playerIds.map((id) => [id, XD_START_CHIPS])),
      bets: {},
      ready: [],
      out: [],
      hands: {},
      dealer: [],
      deck: [],
      stood: [],
      turn: null,
      round: 1,
      phase: 'bet',
      deadline: now + XD_BET_MS,
      log: [{ kind: 'round', round: 1 }],
      result: null,
    };
  },

  applyMove(state, playerId, move, { now, random = Math.random }) {
    if (state.result) return { ok: false, error: 'GAME_OVER' };
    if (!state.seats.includes(playerId) || state.out.includes(playerId)) return { ok: false, error: 'NOT_A_PLAYER' };
    if (typeof move !== 'object' || move === null) return fail;
    switch (move.type) {
      case 'bet': {
        // Picks (or changes) the stake for this round.
        if (state.phase !== 'bet' || playerId === state.dealerId || state.ready.includes(playerId) || !XD_BET_VALUES.includes(move.amount) || move.amount > state.chips[playerId]) return fail;
        return { ok: true, state: { ...state, bets: { ...state.bets, [playerId]: move.amount } } };
      }
      case 'ready': {
        if (state.phase !== 'bet' || playerId === state.dealerId || state.ready.includes(playerId) || !(state.bets[playerId] > 0)) return fail;
        const next = { ...state, ready: [...state.ready, playerId] };
        return { ok: true, state: waitingOn(next).length === 0 ? deal(next, now, random) : next };
      }
      case 'hit':
      case 'stand': {
        if (state.phase !== 'play') return fail;
        if (state.turn !== playerId) return { ok: false, error: 'NOT_YOUR_TURN' };
        const cards = cardsOf(state, playerId);
        const v = xdHandValue(cards);
        if (move.type === 'stand') return v.total >= XD_MIN_STAND || v.kind !== 'points' ? { ok: true, state: stand(state, playerId, now, false) } : fail;
        return settled(cards) ? fail : { ok: true, state: hit(state, playerId, now) };
      }
    }
    return fail;
  },

  forfeit(state, playerId, { now, random = Math.random }) {
    if (state.result || !state.seats.includes(playerId) || state.out.includes(playerId)) return state;
    // A stake already on the table stays with the dealer. A seated dealer who leaves hands the
    // dealing to the house, which finishes their hand.
    const chips = { ...state.chips };
    if (state.phase === 'play' && state.dealerId !== null && state.dealerId !== playerId && state.hands[playerId]) chips[state.dealerId] += state.bets[playerId];
    let next: XiDachState = withLog(
      {
        ...state,
        chips,
        dealerId: state.dealerId === playerId ? null : state.dealerId,
        out: [...state.out, playerId],
        hands: Object.fromEntries(Object.entries(state.hands).filter(([id]) => id !== playerId)),
      },
      { kind: 'left', player: playerId },
    );
    if (active(next).length < 2) return finish(next);
    if (next.phase === 'bet') return waitingOn(next).length === 0 && active(next).some((id) => next.bets[id] > 0) ? deal(next, now, random) : next;
    if (next.phase === 'play' && state.turn === playerId) next = nextTurn(next, null, now);
    return next;
  },

  isOver(state) {
    return state.result !== null;
  },

  playerView(state, playerId, { now }) {
    const shown = state.phase === 'reveal' || state.result !== null;
    return {
      dealerId: state.dealerId,
      seats: state.seats.map((id) => ({
        id,
        chips: state.chips[id],
        bet: state.bets[id] ?? 0,
        ready: state.ready.includes(id),
        out: state.out.includes(id),
        cards: state.hands[id]?.length ?? 0,
        stood: state.stood.includes(id),
      })),
      hands: shown ? state.hands : state.hands[playerId] ? { [playerId]: state.hands[playerId] } : {},
      dealer: shown || playerId === state.dealerId ? state.dealer : state.dealer.slice(0, 1),
      dealerCards: state.dealer.length,
      turn: state.turn,
      round: state.round,
      rounds: XD_ROUNDS,
      phase: state.phase,
      msLeft: Math.max(0, state.deadline - now),
      log: state.log,
      result: state.result,
    };
  },

  deadline(state) {
    return state.result ? null : state.deadline;
  },

  // Betting time up: deal to whoever staked something. A player out of time stands if they may,
  // otherwise draws. The result has been shown: next round.
  timeout(state, { now, random = Math.random }) {
    if (state.result || now < state.deadline) return state;
    if (state.phase === 'bet') return deal(state, now, random);
    if (state.phase === 'reveal') return nextRound(state, now);
    const id = state.turn!;
    const v = xdHandValue(cardsOf(state, id));
    return v.total >= XD_MIN_STAND ? stand(state, id, now, true) : hit(state, id, now);
  },

  points(state) {
    if (!state.result) return null;
    const n = state.result.ranking.length;
    return Object.fromEntries(state.result.ranking.map((id, i) => [id, { place: i + 1, points: n - 1 - 2 * i }]));
  },

  // Bots stake a tenth or so of their chips, draw below 17 (and try for five cards on a low
  // four-card hand), and stand otherwise. A dealing bot plays its hand the same way.
  botMove(state, playerId) {
    if (state.result || state.out.includes(playerId)) return null;
    if (state.phase === 'bet') {
      if (playerId === state.dealerId) return null;
      if (state.ready.includes(playerId) || state.chips[playerId] === 0) return null;
      if (!(state.bets[playerId] > 0)) {
        const amount = [...XD_BET_VALUES].reverse().find((v) => v <= state.chips[playerId] && v <= Math.max(10, state.chips[playerId] / 10)) ?? XD_BET_VALUES[0];
        return { type: 'bet', amount: Math.min(amount, state.chips[playerId]) };
      }
      return { type: 'ready' };
    }
    if (state.phase !== 'play' || state.turn !== playerId) return null;
    const cards = cardsOf(state, playerId);
    const v = xdHandValue(cards);
    if (v.kind !== 'points') return { type: 'stand' };
    const draw = v.total < 17 || (cards.length === 4 && v.total <= 16);
    return { type: draw ? 'hit' : 'stand' };
  },
};
