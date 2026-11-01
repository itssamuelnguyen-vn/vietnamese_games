import type { BotLevel } from '../types';

// The caro bots. Every level scores each free cell near the stones by what a stone there would make
// for the bot (attack) and for the opponent (defence).
// - Easy counts unbroken runs only, adds noise to its scores, and now and then misses a block.
// - Medium reads the real threats along each line, gaps included: fives, fours (one way to finish),
//   open fours (two ways), open threes (one move from an open four, like _XXX_ or _X_XX_), and the
//   double threats they combine into (four-four, four-three, three-three).
// - Hard adds a threat search on top: a win by continuous fours (VCF) when it has one, and before
//   moving, a check over its best candidates that the opponent isn't left with one.

// Board cells: 0 empty, 1 X, 2 O.
type Board = Int8Array;

const DIRECTIONS: [number, number][] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

// A line through a cell: offsets -5..+5, with the cell itself at index 5.
const SPAN = 5;
const LINE = 2 * SPAN + 1;
// Line values, from the point of view of the side being scored.
const EMPTY = 0;
const OWN = 1;
const ENEMY = 2;
const EDGE = 3;

interface Ctx {
  board: Board;
  size: number;
  blockRule: boolean;
  // How many stones lie within two cells of each cell: candidate moves have at least one. And the
  // same counting X's and O's only.
  near: Int16Array;
  nearX: Int16Array;
  nearO: Int16Array;
  line: Int8Array;
}

function makeCtx(moves: number[], size: number, blockRule: boolean): Ctx {
  const cells = size * size;
  const ctx: Ctx = { board: new Int8Array(cells), size, blockRule, near: new Int16Array(cells), nearX: new Int16Array(cells), nearO: new Int16Array(cells), line: new Int8Array(LINE) };
  moves.forEach((cell, i) => place(ctx, cell, i % 2 === 0 ? 1 : 2));
  return ctx;
}

function place(ctx: Ctx, cell: number, stone: number) {
  ctx.board[cell] = stone;
  bumpNear(ctx, cell, stone === 1 ? ctx.nearX : ctx.nearO, 1);
}

function lift(ctx: Ctx, cell: number) {
  bumpNear(ctx, cell, ctx.board[cell] === 1 ? ctx.nearX : ctx.nearO, -1);
  ctx.board[cell] = 0;
}

function bumpNear(ctx: Ctx, cell: number, mine: Int16Array, by: number) {
  const { size } = ctx;
  const r = Math.floor(cell / size);
  const c = cell % size;
  for (let rr = Math.max(0, r - 2); rr <= Math.min(size - 1, r + 2); rr++)
    for (let cc = Math.max(0, c - 2); cc <= Math.min(size - 1, c + 2); cc++) {
      ctx.near[rr * size + cc] += by;
      mine[rr * size + cc] += by;
    }
}

// Fills ctx.line with the line through `cell` in direction `d`, as seen by `side`, with the cell
// itself counted as `side`'s stone. Returns how many of the side's stones lie within four cells.
function readLine(ctx: Ctx, cell: number, d: number, side: number): number {
  const { board, size, line } = ctx;
  const [dr, dc] = DIRECTIONS[d];
  const r0 = Math.floor(cell / size);
  const c0 = cell % size;
  let own = 0;
  for (let k = -SPAN; k <= SPAN; k++) {
    const r = r0 + dr * k;
    const c = c0 + dc * k;
    let v: number;
    if (k === 0) v = OWN;
    else if (r < 0 || r >= size || c < 0 || c >= size) v = EDGE;
    else {
      const s = board[r * size + c];
      v = s === 0 ? EMPTY : s === side ? OWN : ENEMY;
    }
    line[k + SPAN] = v;
    if (v === OWN && k !== 0 && k >= -4 && k <= 4) own++;
  }
  return own;
}

// Whether the run of own stones through the middle, with `extra` (an index, or -1) filled in too,
// is a winning five: five or more, not stopped by the opponent at both ends under the block rule
// (the board's edge doesn't block).
function fiveThrough(line: Int8Array, extra: number, blockRule: boolean): boolean {
  const own = (i: number) => i === extra || line[i] === OWN;
  let lo = SPAN;
  let hi = SPAN;
  while (lo > 0 && own(lo - 1)) lo--;
  while (hi < LINE - 1 && own(hi + 1)) hi++;
  if (hi - lo + 1 < 5) return false;
  if (extra >= 0 && (extra < lo || extra > hi)) return false;
  return !(blockRule && lo > 0 && line[lo - 1] === ENEMY && hi < LINE - 1 && line[hi + 1] === ENEMY);
}

// Indices along the line where one more stone would make a five through the middle, as a bit mask.
function fiveMask(line: Int8Array, blockRule: boolean): number {
  let mask = 0;
  for (let e = 1; e < LINE - 1; e++) if (line[e] === EMPTY && fiveThrough(line, e, blockRule)) mask |= 1 << e;
  return mask;
}

const bits = (mask: number) => {
  let n = 0;
  for (; mask; mask &= mask - 1) n++;
  return n;
};

// What a stone of `side` at `cell` would make.
interface Shape {
  five: boolean;
  // Lines with two ways to finish (open fours), or one (fours).
  openFours: number;
  fours: number;
  // Lines one move away from an open four, or only from a four.
  openThrees: number;
  threes: number;
  // Free five-cell windows through the cell, weighted by how full they are.
  potential: number;
}

const POTENTIAL = [0, 1, 4, 16, 64, 0];

function shapeAt(ctx: Ctx, cell: number, side: number): Shape {
  const shape: Shape = { five: false, openFours: 0, fours: 0, openThrees: 0, threes: 0, potential: 0 };
  const { line, blockRule } = ctx;
  for (let d = 0; d < 4; d++) {
    const own = readLine(ctx, cell, d, side);
    for (let s = 1; s <= SPAN; s++) {
      let count = 0;
      let blocked = false;
      for (let i = s; i < s + 5; i++) {
        if (line[i] === OWN) count++;
        else if (line[i] !== EMPTY) blocked = true;
      }
      if (!blocked) shape.potential += POTENTIAL[count];
    }
    if (own < 2) continue;
    if (own >= 4 && fiveThrough(line, -1, blockRule)) {
      shape.five = true;
      continue;
    }
    if (own >= 3) {
      const ways = bits(fiveMask(line, blockRule));
      if (ways >= 2) shape.openFours++;
      else if (ways === 1) shape.fours++;
      if (ways > 0) continue;
    }
    // A three: some further stone along the line would make a four, or an open four.
    let best = 0;
    for (let e = 1; e < LINE - 1 && best < 2; e++) {
      if (line[e] !== EMPTY) continue;
      line[e] = OWN;
      best = Math.max(best, bits(fiveMask(line, blockRule)));
      line[e] = EMPTY;
    }
    if (best >= 2) shape.openThrees++;
    else if (best === 1) shape.threes++;
  }
  return shape;
}

// Threat tiers, far apart so that a bigger threat always outweighs any number of smaller ones.
const WIN = 1e9;
const WINNING = 1e7; // open four, four-four, four-three: wins unless the opponent has a four
const DOUBLE_THREE = 1e6;

function shapeValue(s: Shape): number {
  if (s.five) return WIN;
  const base = s.fours * 2000 + s.openThrees * 3000 + s.threes * 300 + s.potential * 4;
  if (s.openFours > 0 || s.fours >= 2 || (s.fours >= 1 && s.openThrees >= 1)) return WINNING + base;
  if (s.openThrees >= 2) return DOUBLE_THREE + base;
  return base;
}

const DEFENCE = 0.85;

function candidates(ctx: Ctx): number[] {
  const out: number[] = [];
  for (let cell = 0; cell < ctx.board.length; cell++) if (ctx.board[cell] === 0 && ctx.near[cell] > 0) out.push(cell);
  return out;
}

interface Scored {
  cell: number;
  score: number;
  mine: number;
  theirs: number;
}

function scoreCells(ctx: Ctx, side: number): Scored[] {
  const enemy = 3 - side;
  const center = Math.floor(ctx.size / 2);
  return candidates(ctx).map((cell) => {
    const mine = shapeValue(shapeAt(ctx, cell, side));
    const theirs = shapeValue(shapeAt(ctx, cell, enemy));
    const dist = Math.abs(Math.floor(cell / ctx.size) - center) + Math.abs((cell % ctx.size) - center);
    return { cell, mine, theirs, score: mine + DEFENCE * theirs - dist * 0.01 };
  });
}

// A random pick among the cells that score within 2% of the best.
function pickTop(scored: Scored[], random: () => number): number {
  const best = Math.max(...scored.map((s) => s.score));
  const pool = scored.filter((s) => s.score >= best - Math.max(0.05, Math.abs(best) * 0.02));
  return pool[Math.floor(random() * pool.length)].cell;
}

// ---- Threat search ----

// Cells where `side` would finish a five right now.
function fivesFor(ctx: Ctx, side: number, cells: number[]): number[] {
  const out: number[] = [];
  for (const cell of cells) {
    if (ctx.board[cell] !== 0) continue;
    for (let d = 0; d < 4; d++) {
      if (readLine(ctx, cell, d, side) >= 4 && fiveThrough(ctx.line, -1, ctx.blockRule)) {
        out.push(cell);
        break;
      }
    }
  }
  return out;
}

// For a stone of `side` at `cell`: the board cells where the next stone would then finish a five.
function finishingCells(ctx: Ctx, cell: number, side: number): number[] {
  const out: number[] = [];
  const { size } = ctx;
  for (let d = 0; d < 4; d++) {
    if (readLine(ctx, cell, d, side) < 3) continue;
    const mask = fiveMask(ctx.line, ctx.blockRule);
    if (!mask) continue;
    const [dr, dc] = DIRECTIONS[d];
    for (let e = 1; e < LINE - 1; e++) {
      if (!(mask & (1 << e))) continue;
      const target = cell + (dr * size + dc) * (e - SPAN);
      if (!out.includes(target)) out.push(target);
    }
  }
  return out;
}

interface Budget {
  nodes: number;
  deadline: number;
}

// The free cells on the four lines through `cell`, up to four cells away.
function lineCells(ctx: Ctx, cell: number): number[] {
  const { size, board } = ctx;
  const r0 = Math.floor(cell / size);
  const c0 = cell % size;
  const out: number[] = [];
  for (const [dr, dc] of DIRECTIONS) {
    for (let k = -4; k <= 4; k++) {
      const r = r0 + dr * k;
      const c = c0 + dc * k;
      if (k !== 0 && r >= 0 && r < size && c >= 0 && c < size && board[r * size + c] === 0) out.push(r * size + c);
    }
  }
  return out;
}

function outOfBudget(budget: Budget): boolean {
  if (budget.nodes > 0 && (--budget.nodes & 31) !== 0) return false;
  if (budget.nodes > 0 && Date.now() <= budget.deadline) return false;
  budget.nodes = 0;
  return true;
}

// A win by continuous fours for `side`, to move: each move makes a four the opponent must block,
// until one makes two ways to finish at once. Returns the first move, or -1. `lastBlock` is the
// opponent's last (forced) stone within the search: only it can have given them a four.
function vcf(ctx: Ctx, side: number, depth: number, budget: Budget, lastBlock = -1): number {
  if (outOfBudget(budget)) return -1;
  const enemy = 3 - side;
  if (lastBlock < 0) {
    const cells = candidates(ctx);
    const win = fivesFor(ctx, side, cells);
    if (win.length > 0) return win[0];
    // The opponent has a four of their own: blocking it gives up the initiative.
    if (fivesFor(ctx, enemy, cells).length > 0) return -1;
  } else if (fivesFor(ctx, enemy, lineCells(ctx, lastBlock)).length > 0) return -1;
  if (depth === 0) return -1;
  // A four needs three of the side's stones within reach, so one of them within two cells.
  const near = side === 1 ? ctx.nearX : ctx.nearO;
  for (let cell = 0; cell < ctx.board.length; cell++) {
    if (ctx.board[cell] !== 0 || near[cell] === 0) continue;
    const finish = finishingCells(ctx, cell, side);
    if (finish.length === 0) continue;
    place(ctx, cell, side);
    const defences = finish.length === 1 ? finish : blocks(ctx, side, finish);
    if (defences.length === 0) {
      lift(ctx, cell);
      return cell;
    }
    place(ctx, defences[0], enemy);
    const next = vcf(ctx, side, depth - 1, budget, defences[0]);
    lift(ctx, defences[0]);
    lift(ctx, cell);
    if (next >= 0) return cell;
    if (budget.nodes <= 0) return -1;
  }
  return -1;
}

const VCF_DEPTH = 8;

// The cells among `finish` where the opponent can stop every five at once. Two ways to finish
// usually leave none, but with the block rule, blocking one end of an open four can leave the five at
// the other end stopped at both ends.
function blocks(ctx: Ctx, side: number, finish: number[]): number[] {
  return finish.filter((f) => {
    place(ctx, f, 3 - side);
    const still = finish.some((g) => g !== f && fivesFor(ctx, side, [g]).length > 0);
    lift(ctx, f);
    return !still;
  });
}

// ---- Easy: the original one-ply scorer of unbroken runs ----

// Value of a run of `count` stones with `open` free ends, for attacking or defending. `stopped` counts
// ends blocked by the opponent: only a five stopped at both ends fails under the blocked-ends rule.
function runScore(count: number, open: number, stopped: number, blockRule: boolean): number {
  if (count >= 5) return blockRule && stopped === 2 ? 0 : 1_000_000;
  if (open === 0) return 0;
  const table: Record<number, [number, number]> = { 4: [10_000, 100_000], 3: [500, 5_000], 2: [50, 200], 1: [5, 10] };
  return table[count][open - 1];
}

function runsValue(ctx: Ctx, cell: number, side: number): number {
  const { board, size } = ctx;
  const r0 = Math.floor(cell / size);
  const c0 = cell % size;
  const at = (r: number, c: number) => (r >= 0 && r < size && c >= 0 && c < size ? board[r * size + c] : -1);
  let total = 0;
  for (const [dr, dc] of DIRECTIONS) {
    let count = 1;
    let open = 0;
    let stopped = 0;
    for (const sign of [1, -1]) {
      let r = r0 + dr * sign;
      let c = c0 + dc * sign;
      while (at(r, c) === side) {
        count++;
        r += dr * sign;
        c += dc * sign;
      }
      const end = at(r, c);
      if (end === 0) open++;
      else if (end !== -1) stopped++;
    }
    total += runScore(count, open, stopped, ctx.blockRule);
  }
  return total;
}

function easyCell(ctx: Ctx, side: number, random: () => number): number {
  let cells = candidates(ctx);
  // It never misses its own five, and sees the opponent's coming nine times out of ten.
  const win = fivesFor(ctx, side, cells);
  if (win.length > 0) return win[0];
  const block = fivesFor(ctx, 3 - side, cells);
  if (block.length > 0) {
    if (random() < 0.9) return block[0];
    if (cells.length > block.length) cells = cells.filter((c) => !block.includes(c));
  }
  const scored = cells.map((cell) => ({ cell, score: (runsValue(ctx, cell, side) + 0.8 * runsValue(ctx, cell, 3 - side)) * (0.4 + 1.2 * random()) }));
  scored.sort((a, b) => b.score - a.score);
  // Sometimes just one of the better-looking cells.
  const pool = random() < 0.2 ? scored.slice(0, 4) : scored.slice(0, 1);
  return pool[Math.floor(random() * pool.length)].cell;
}

// ---- Hard ----

// A win by continuous threats (VCT) for `side`, to move, `depth` threats deep: fours, and threes
// that leave a win by fours unless answered. Each three is tried against the answers that matter
// (the free cells on its lines and on the line of the win it threatens); a counter-four from the
// opponent counts as an answer. Returns the first move, or -1.
function vct(ctx: Ctx, side: number, depth: number, budget: Budget): number {
  const forced = vcf(ctx, side, VCF_DEPTH, budget);
  if (forced >= 0 || depth === 0 || budget.nodes <= 0) return forced;
  const enemy = 3 - side;
  if (fivesFor(ctx, enemy, candidates(ctx)).length > 0) return -1;
  const threats = candidates(ctx)
    .map((cell) => ({ cell, shape: shapeAt(ctx, cell, side) }))
    .filter(({ shape }) => shape.openThrees > 0 || shape.fours > 0)
    .sort((a, b) => shapeValue(b.shape) - shapeValue(a.shape))
    .slice(0, VCT_WIDTH);
  for (const { cell } of threats) {
    if (outOfBudget(budget)) return -1;
    place(ctx, cell, side);
    const won = threatWins(ctx, side, cell, depth, budget);
    lift(ctx, cell);
    if (won) return cell;
  }
  return -1;
}

// After `side`'s threat at `cell`, with the opponent to move: does every answer still lose?
function threatWins(ctx: Ctx, side: number, cell: number, depth: number, budget: Budget): boolean {
  const enemy = 3 - side;
  const finish = fivesFor(ctx, side, lineCells(ctx, cell));
  if (finish.length > 0) {
    // A four: the one block is forced (two ways to finish were a win by fours, found already).
    if (finish.length > 1) return false;
    place(ctx, finish[0], enemy);
    const won = fivesFor(ctx, enemy, lineCells(ctx, finish[0])).length === 0 && vct(ctx, side, depth - 1, budget) >= 0;
    lift(ctx, finish[0]);
    return won;
  }
  // A three is only a threat if it leaves a win by fours.
  const follow = vcf(ctx, side, VCF_DEPTH, budget);
  if (follow < 0) return false;
  const answers = new Set([...lineCells(ctx, cell), ...lineCells(ctx, follow), follow]);
  // A counter-four anywhere takes the initiative back.
  const theirs = enemy === 1 ? ctx.nearX : ctx.nearO;
  for (let c = 0; c < ctx.board.length; c++) {
    if (ctx.board[c] === 0 && theirs[c] > 0 && finishingCells(ctx, c, enemy).length > 0) return false;
  }
  for (const answer of answers) {
    if (ctx.board[answer] !== 0) continue;
    place(ctx, answer, enemy);
    const won = vct(ctx, side, depth - 1, budget) >= 0;
    lift(ctx, answer);
    if (!won || budget.nodes <= 0) return false;
  }
  return true;
}

const VCT_WIDTH = 8;
const HARD_CANDIDATES = 10;
// Caro bots think on a worker thread (heavyBot), so hard can take its time.
const HARD_MS = 500;

function hardCell(ctx: Ctx, side: number, random: () => number): number {
  const enemy = 3 - side;
  const scored = scoreCells(ctx, side).sort((a, b) => b.score - a.score);
  const cells = scored.map((s) => s.cell);
  // Win now; else stop the opponent's five.
  const win = fivesFor(ctx, side, cells);
  if (win.length > 0) return win[0];
  const block = fivesFor(ctx, enemy, cells);
  if (block.length > 0) return block[0];
  const deadline = Date.now() + HARD_MS;
  // A forced win: by fours (the shortest one), else by threes and fours.
  const budget = { nodes: 2000, deadline };
  for (let depth = 1; depth <= VCF_DEPTH && budget.nodes > 0; depth++) {
    const forced = vcf(ctx, side, depth, budget);
    if (forced >= 0) return forced;
  }
  const threat = vct(ctx, side, 2, { nodes: 3000, deadline: Date.now() + HARD_MS / 3 });
  if (threat >= 0) return threat;
  // Over the best candidates: does the opponent then have a forced win? Does the bot get one?
  const top = scored.slice(0, HARD_CANDIDATES);
  const judged = top.map((s) => {
    place(ctx, s.cell, side);
    let score = s.score;
    if (Date.now() < deadline) {
      if (vcf(ctx, enemy, VCF_DEPTH, { nodes: 300, deadline }) >= 0) score -= 1e8;
      else if (vct(ctx, enemy, 1, { nodes: 300, deadline }) >= 0) score -= 3e7;
      else {
        // A move that leaves the bot a forced win makes the opponent defend.
        if (vct(ctx, side, 1, { nodes: 200, deadline }) >= 0) score += s.mine >= DOUBLE_THREE / 2 ? 5e6 : 3e3;
        // Leaving the opponent a double three is a loss unless it can be answered with fours.
        const theirBest = Math.max(...candidates(ctx).map((c) => shapeValue(shapeAt(ctx, c, enemy))));
        if (theirBest >= DOUBLE_THREE) score -= 5e5;
      }
    }
    lift(ctx, s.cell);
    return { ...s, score };
  });
  return pickTop(judged, random);
}

// The bot's cell for the side to move after `moves`.
export function caroBotCell(moves: number[], size: number, blockRule: boolean, level: BotLevel = 'medium', random: () => number = Math.random): number {
  const center = Math.floor(size / 2) * size + Math.floor(size / 2);
  if (moves.length === 0) return center;
  const ctx = makeCtx(moves, size, blockRule);
  const side = moves.length % 2 === 0 ? 1 : 2;
  if (candidates(ctx).length === 0) return ctx.board.indexOf(0);
  if (level === 'easy') return easyCell(ctx, side, random);
  if (level === 'hard') return hardCell(ctx, side, random);
  return pickTop(scoreCells(ctx, side), random);
}
