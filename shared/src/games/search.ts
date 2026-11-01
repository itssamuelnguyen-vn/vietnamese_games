// A small game-tree search shared by the chess and xiangqi bots: negamax with alpha-beta pruning,
// iterative deepening within a time budget, captures tried first, and at the horizon a search of
// captures only, so a bot doesn't stop counting halfway through an exchange.
//
// The `enhanced` search (the hard bots) adds the usual engine tricks on top: a transposition table,
// killer and history move ordering, principal-variation search with late-move reductions, null-move
// pruning, and one more ply for positions in check.

export interface SearchAdapter<M> {
  // Legal moves for the side to move.
  moves(): M[];
  // Just the captures, if the game can list them faster than all moves.
  captures?(): M[];
  play(move: M): void;
  undo(): void;
  // How good the position is for the side to move (positive is good for them).
  evaluate(): number;
  // Score for the side to move when it has no legal move: a loss (-MATE), or 0 for a stalemate draw.
  noMoves(): number;
  // Value of what the move captures, 0 if nothing; and of the piece making it (cheaper attackers first).
  captured(move: M): number;
  mover(move: M): number;
  // For the enhanced search. A key for the position (side to move included), for the
  // transposition table.
  key?(): unknown;
  // A number in [0, 65536) naming the move by its squares, for the move-ordering tables.
  moveId?(move: M): number;
  // Whether the side to move is in check: such positions are searched a ply deeper.
  inCheck?(): boolean;
  // A null move (the side to move passes), for null-move pruning; canPass says when that's safe to
  // assume no worse than a real move (not in zugzwang-prone endings).
  pass?(): void;
  unpass?(): void;
  canPass?(): boolean;
}

export const MATE = 100_000;
const MATE_BOUND = MATE - 1000;

export interface SearchOptions<M = unknown> {
  maxDepth: number;
  timeMs: number;
  // How deep the capture-only search may go past the horizon.
  captureDepth?: number;
  // Root moves within this many points of the best are all fair picks, for some variety.
  margin?: number;
  random?: () => number;
  now?: () => number;
  // Root moves to avoid when there's any other choice (e.g. ones that repeat a position).
  avoid?: (move: M) => boolean;
  // Root moves that end the game in a draw on the spot (a threefold repetition): scored as a draw
  // instead of searched, and only picked when every other move is clearly worse.
  draws?: (move: M) => boolean;
  // A weaker player's slips: with probability `chance`, any root move within `margin` of the best
  // will do. Never a move into a mate the search saw, nor instead of a mate it found.
  slips?: { chance: number; margin: number }[];
  // Transposition table, killer/history ordering, PVS with late-move reductions, null-move pruning
  // and check extensions, where the adapter supports them.
  enhanced?: boolean;
  // A hard stop on positions visited, in case the clock can't be trusted to move on.
  maxNodes?: number;
}

export interface SearchResult<M> {
  move: M | null;
  score: number;
  // The deepest search that finished in time.
  depth: number;
  nodes: number;
}

// Transposition table entry: how deep the position was searched, its score (a bound unless exact),
// and the best move found there.
const EXACT = 0;
const LOWER = 1;
const UPPER = 2;
interface TTEntry {
  depth: number;
  score: number;
  flag: number;
  move: number;
}
const TT_LIMIT = 200_000;
const MAX_PLY = 64;

// Mate scores count plies from the root; the table stores them counted from the position instead.
const toTT = (score: number, ply: number) => (score > MATE_BOUND ? score + ply : score < -MATE_BOUND ? score - ply : score);
const fromTT = (score: number, ply: number) => (score > MATE_BOUND ? score - ply : score < -MATE_BOUND ? score + ply : score);

export function searchBestMove<M>(g: SearchAdapter<M>, opts: SearchOptions<M>): SearchResult<M> {
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const margin = opts.margin ?? 0;
  const slips = opts.slips ?? [];
  // Moves within any slip's margin need exact scores too.
  const window = Math.max(margin, ...slips.map((s) => s.margin));
  const captureDepth = opts.captureDepth ?? 6;
  const deadline = now() + opts.timeMs;
  const maxNodes = opts.maxNodes ?? Infinity;
  const enhanced = !!opts.enhanced && !!g.moveId;
  const tt = enhanced && g.key ? new Map<unknown, TTEntry>() : null;
  const killers: number[][] = Array.from({ length: MAX_PLY + 1 }, () => [-1, -1]);
  const history = enhanced ? new Int32Array(65536) : null;
  let nodes = 0;
  let stopped = false;
  const timeUp = () => {
    if (!stopped && (++nodes & 63) === 0 && (now() > deadline || nodes >= maxNodes)) stopped = true;
    return stopped;
  };

  // Captures first, biggest prize and cheapest attacker first; then the rest.
  const order = (moves: M[]) =>
    moves
      .map((m) => {
        const prize = g.captured(m);
        return { m, key: prize ? prize * 16 - g.mover(m) : -Infinity };
      })
      .sort((a, b) => b.key - a.key)
      .map((x) => x.m);

  // Every node counts towards the time check, leaves included: they are where most time goes.
  function quiesce(alpha: number, beta: number, depth: number): number {
    const stand = g.evaluate();
    if (timeUp() || stand >= beta || depth === 0) return stand;
    if (stand > alpha) alpha = stand;
    for (const m of order(g.captures ? g.captures() : g.moves().filter((x) => g.captured(x) > 0))) {
      if (stopped) break;
      g.play(m);
      const score = -quiesce(-beta, -alpha, depth - 1);
      g.undo();
      if (score >= beta) return score;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  function negamax(depth: number, alpha: number, beta: number, ply: number): number {
    // Out of time: the caller throws away whatever this returns.
    if (timeUp()) return 0;
    const moves = g.moves();
    // Sooner mates score higher, so a bot goes for the quickest one.
    if (moves.length === 0) {
      const score = g.noMoves();
      return score < 0 ? score + ply : score;
    }
    if (depth === 0) return quiesce(alpha, beta, captureDepth);
    let best = -Infinity;
    for (const m of order(moves)) {
      g.play(m);
      const score = -negamax(depth - 1, -beta, -alpha, ply + 1);
      g.undo();
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta || stopped) break;
    }
    return best;
  }

  // The enhanced search's move order: the table's move, captures, this ply's killers, then the
  // quiet moves that caused the most cutoffs elsewhere.
  function orderEnhanced(moves: M[], ttMove: number, ply: number): M[] {
    const [k1, k2] = killers[Math.min(ply, MAX_PLY)];
    return moves
      .map((m) => {
        const id = g.moveId!(m);
        const prize = g.captured(m);
        const key =
          id === ttMove ? 4e9 : prize ? 3e9 + prize * 16 - g.mover(m) : id === k1 ? 2e9 + 1 : id === k2 ? 2e9 : history![id];
        return { m, key };
      })
      .sort((a, b) => b.key - a.key)
      .map((x) => x.m);
  }

  function negamaxEnhanced(depth: number, alpha: number, beta: number, ply: number, nullOk = true): number {
    if (timeUp()) return 0;
    const inCheck = g.inCheck?.() ?? false;
    // A check is answered a ply deeper, so the search doesn't stop just before a mate or a fork.
    if (inCheck && ply < MAX_PLY) depth++;
    if (depth <= 0) return quiesce(alpha, beta, captureDepth);
    const key = tt ? g.key!() : null;
    let ttMove = -1;
    if (tt) {
      const entry = tt.get(key);
      if (entry) {
        ttMove = entry.move;
        if (entry.depth >= depth) {
          const s = fromTT(entry.score, ply);
          if (entry.flag === EXACT || (entry.flag === LOWER && s >= beta) || (entry.flag === UPPER && s <= alpha)) return s;
        }
      }
    }
    // Null move: if even passing keeps the score above beta (searched less deep), a real move will
    // too, so there's no need to look further here.
    if (nullOk && g.pass && depth >= 3 && !inCheck && beta < MATE_BOUND && g.canPass!() && g.evaluate() >= beta) {
      g.pass();
      const score = -negamaxEnhanced(depth - 1 - (depth > 6 ? 3 : 2), -beta, -beta + 1, ply + 1, false);
      g.unpass!();
      if (stopped) return 0;
      if (score >= beta) return score >= MATE_BOUND ? beta : score;
    }
    const moves = g.moves();
    if (moves.length === 0) {
      const score = g.noMoves();
      return score < 0 ? score + ply : score;
    }
    const alpha0 = alpha;
    const [k1, k2] = killers[Math.min(ply, MAX_PLY)];
    let best = -Infinity;
    let bestId = -1;
    const ordered = orderEnhanced(moves, ttMove, ply);
    for (let i = 0; i < ordered.length; i++) {
      const m = ordered[i];
      const id = g.moveId!(m);
      const quiet = g.captured(m) === 0;
      g.play(m);
      let score: number;
      if (i === 0) score = -negamaxEnhanced(depth - 1, -beta, -alpha, ply + 1);
      else {
        // Later moves first get a null-window look, quiet ones at reduced depth; only the ones that
        // turn out better than the best so far are searched in full.
        const reduce = depth >= 3 && i >= 3 && quiet && !inCheck && id !== k1 && id !== k2 ? (i >= 10 ? 2 : 1) : 0;
        score = -negamaxEnhanced(depth - 1 - reduce, -alpha - 1, -alpha, ply + 1);
        if (reduce > 0 && score > alpha && !stopped) score = -negamaxEnhanced(depth - 1, -alpha - 1, -alpha, ply + 1);
        if (score > alpha && score < beta && !stopped) score = -negamaxEnhanced(depth - 1, -beta, -alpha, ply + 1);
      }
      g.undo();
      if (stopped) return 0;
      if (score > best) {
        best = score;
        bestId = id;
      }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        if (quiet) {
          const k = killers[Math.min(ply, MAX_PLY)];
          if (k[0] !== id) [k[0], k[1]] = [id, k[0]];
          history![id] = Math.min(1e9, history![id] + depth * depth);
        }
        break;
      }
    }
    if (tt) {
      if (tt.size >= TT_LIMIT) tt.clear();
      tt.set(key, { depth, score: toTT(best, ply), flag: best <= alpha0 ? UPPER : best >= beta ? LOWER : EXACT, move: bestId });
    }
    return best;
  }

  const search = enhanced ? negamaxEnhanced : negamax;
  let rootMoves = order(g.moves());
  const allowed = opts.avoid ? rootMoves.filter((m) => !opts.avoid!(m)) : rootMoves;
  if (allowed.length > 0) rootMoves = allowed;
  if (rootMoves.length === 0) return { move: null, score: g.noMoves(), depth: 0, nodes };
  const drawn = new Set(opts.draws ? rootMoves.filter((m) => opts.draws!(m)) : []);
  let scored: { m: M; score: number }[] = rootMoves.map((m) => ({ m, score: 0 }));
  let depthDone = 0;
  for (let depth = 1; depth <= opts.maxDepth; depth++) {
    const results: { m: M; score: number }[] = [];
    let best = -Infinity;
    for (const m of rootMoves) {
      let score = 0;
      if (!drawn.has(m)) {
        g.play(m);
        // Search each root move with a window just below the best so far, so moves within the
        // margin get exact scores while worse ones are cut off quickly.
        score = -search(depth - 1, -Infinity, -(best - window - 1), 1);
        g.undo();
        if (stopped) break;
      }
      results.push({ m, score });
      if (score > best) best = score;
    }
    if (stopped && results.length < rootMoves.length) {
      // An unfinished depth still counts if its first (previously best) move was searched: the pick
      // is then made among the moves it searched. (The others' scores from the depth before are
      // mostly bounds from a narrower window, not to be compared with the new ones.)
      if (results.length > 0) scored = results;
      break;
    }
    scored = results;
    depthDone = depth;
    // The next depth tries the best moves first.
    rootMoves = [...results].sort((a, b) => b.score - a.score).map((r) => r.m);
    // A forced mate found: no need to look deeper.
    if (best >= MATE_BOUND) break;
  }
  const top = Math.max(...scored.map((s) => s.score));
  // Mates aren't up for variety; a slip, when one happens, widens the choice.
  let spread = top >= MATE_BOUND ? 0 : margin;
  if (slips.length > 0 && top < MATE_BOUND) {
    const roll = random();
    let acc = 0;
    for (const s of slips) {
      acc += s.chance;
      if (roll < acc) {
        spread = s.margin;
        break;
      }
    }
  }
  let pool = scored.filter((s) => s.score >= top - spread && (s.score > -MATE_BOUND || s.score === top));
  // A draw is only taken when nothing else comes close.
  const undrawn = pool.filter((s) => !drawn.has(s.m));
  if (undrawn.length > 0) pool = undrawn;
  const pick = pool[Math.floor(random() * pool.length)];
  return { move: pick.m, score: pick.score, depth: depthDone, nodes };
}
