// Pieces shared by two-player board games (chess, xiangqi): clocks, side choice,
// first-move deadlines. `S` is the game's side key, e.g. 'w' | 'b' or 'r' | 'b'.

export interface MatchClock<S extends string> {
  incrementMs: number;
  remaining: Record<S, number>;
  // When the side to move started thinking; null while the clock is stopped.
  turnStartedAt: number | null;
}

export interface ClockView<S extends string> {
  remaining: Record<S, number>;
  running: S | null;
  incrementMs: number;
}

// Clocks only start once both sides have made their first move.
export const CLOCK_START_PLY = 2;
const FIRST_MOVE_MS = 30_000;

// Time left for each side at `now`, charging the side to move for its current think.
export function remainingAt<S extends string>(clock: MatchClock<S>, turn: S, now: number): Record<S, number> {
  if (clock.turnStartedAt === null) return clock.remaining;
  const left = Math.max(0, clock.remaining[turn] - (now - clock.turnStartedAt));
  return { ...clock.remaining, [turn]: left };
}

export function stopClock<S extends string>(clock: MatchClock<S> | null, turn: S, now: number): MatchClock<S> | null {
  return clock && { ...clock, remaining: remainingAt(clock, turn, now), turnStartedAt: null };
}

export function clockView<S extends string>(clock: MatchClock<S> | null, turn: S, now: number): ClockView<S> | null {
  return (
    clock && {
      remaining: remainingAt(clock, turn, now),
      running: clock.turnStartedAt === null ? null : turn,
      incrementMs: clock.incrementMs,
    }
  );
}

// Timed games are aborted if the side to move hasn't made its first move in time.
export function firstMoveDeadline(clock: unknown, ply: number, now: number): number | null {
  return clock && ply < CLOCK_START_PLY ? now + FIRST_MOVE_MS : null;
}

// Returns [first mover, second mover]. A rematch between the same two players swaps sides;
// otherwise the host's choice applies ('white' = moves first).
export function chooseSides(
  [host, guest]: string[],
  hostColor: string,
  previous: readonly [string, string] | null,
): [string, string] {
  if (previous && previous.every((id) => id === host || id === guest)) return [previous[1], previous[0]];
  if (hostColor === 'white') return [host, guest];
  if (hostColor === 'black') return [guest, host];
  return Math.random() < 0.5 ? [host, guest] : [guest, host];
}

// A takeback also takes back the increments earned by the undone moves. `undone` lists the side
// that made each undone move, by ply; moves before the clock started earned nothing.
export function refundIncrements<S extends string>(clock: MatchClock<S> | null, firstPly: number, undone: S[]): MatchClock<S> | null {
  if (!clock || clock.incrementMs === 0) return clock;
  const remaining = { ...clock.remaining };
  undone.forEach((side, i) => {
    if (firstPly + i >= CLOCK_START_PLY) remaining[side] = Math.max(0, remaining[side] - clock.incrementMs);
  });
  return { ...clock, remaining };
}

// Points for the room scoreboard in a two-player game: +1 for a win, -1 for a loss, 0 for a draw
// (where nobody places first, so it doesn't count as a win for either). An aborted game, never
// really played, doesn't count at all.
export function duelPoints(players: [string, string], result: { winner: string | null; reason: string } | null): Record<string, { points: number; place: number }> | null {
  if (!result || result.reason === 'aborted') return null;
  const { winner } = result;
  return Object.fromEntries(players.map((id) => [id, { points: winner === null ? 0 : winner === id ? 1 : -1, place: winner === id ? 1 : 2 }]));
}

// How long a bot thinks over a move: about this long, less when its clock is running low.
export const BOT_THINK_MS = 700;
// A bot accepts a draw offer once it's behind by about this much (two pawns, or a xiangqi horse).
export const BOT_DRAW_BELOW = -200;

export function botThinkMs<S extends string>(clock: MatchClock<S> | null, side: S, now: number): number {
  if (!clock) return BOT_THINK_MS;
  return Math.max(50, Math.min(BOT_THINK_MS, remainingAt(clock, side, now)[side] / 30));
}
