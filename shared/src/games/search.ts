// A small game-tree search shared by the chess and xiangqi bots: negamax with alpha-beta pruning,
// iterative deepening within a time budget, captures tried first, and at the horizon a search of
// captures only, so a bot doesn't stop counting halfway through an exchange.

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
}

export const MATE = 100_000;

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

export function searchBestMove<M>(g: SearchAdapter<M>, opts: SearchOptions<M>): SearchResult<M> {
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const margin = opts.margin ?? 0;
  const captureDepth = opts.captureDepth ?? 6;
  const deadline = now() + opts.timeMs;
  const maxNodes = opts.maxNodes ?? Infinity;
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

  let rootMoves = order(g.moves());
  const allowed = opts.avoid ? rootMoves.filter((m) => !opts.avoid!(m)) : rootMoves;
  if (allowed.length > 0) rootMoves = allowed;
  if (rootMoves.length === 0) return { move: null, score: g.noMoves(), depth: 0, nodes };
  let scored: { m: M; score: number }[] = rootMoves.map((m) => ({ m, score: 0 }));
  let depthDone = 0;
  for (let depth = 1; depth <= opts.maxDepth; depth++) {
    const results: { m: M; score: number }[] = [];
    let best = -Infinity;
    for (const m of rootMoves) {
      g.play(m);
      // Search each root move with a window just below the best so far, so moves within the
      // margin get exact scores while worse ones are cut off quickly.
      const score = -negamax(depth - 1, -Infinity, -(best - margin - 1), 1);
      g.undo();
      if (stopped) break;
      results.push({ m, score });
      if (score > best) best = score;
    }
    if (stopped && results.length < rootMoves.length) {
      // An unfinished depth still counts if its first (previously best) move was searched.
      if (results.length > 0 && depth > 1) {
        const seen = new Set(results.map((r) => r.m));
        scored = [...results, ...scored.filter((s) => !seen.has(s.m))];
      }
      break;
    }
    scored = results;
    depthDone = depth;
    // The next depth tries the best moves first.
    rootMoves = [...results].sort((a, b) => b.score - a.score).map((r) => r.m);
    // A forced mate found: no need to look deeper.
    if (best >= MATE - 1000) break;
  }
  const top = Math.max(...scored.map((s) => s.score));
  // Mates aren't up for variety.
  const pool = scored.filter((s) => s.score >= top - (top >= MATE - 1000 ? 0 : margin));
  const pick = pool[Math.floor(random() * pool.length)];
  return { move: pick.m, score: pick.score, depth: depthDone, nodes };
}
