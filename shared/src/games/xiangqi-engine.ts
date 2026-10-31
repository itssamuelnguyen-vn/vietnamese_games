// Xiangqi (Chinese chess) rules engine.
// Coordinates follow ICCS: files a–i from red's left, ranks 0–9 from red's side (red at the bottom).
// Piece letters follow the standard xiangqi FEN: k general, a advisor, b elephant, n horse,
// r chariot, c cannon, p soldier; uppercase is red.

export type XSide = 'r' | 'b';
export type XPieceType = 'k' | 'a' | 'b' | 'n' | 'r' | 'c' | 'p';

export interface XPiece {
  side: XSide;
  type: XPieceType;
}

export interface XMove {
  from: string;
  to: string;
  side: XSide;
  piece: XPieceType;
  captured?: XPieceType;
  // Whether this move gives check.
  check: boolean;
}

export const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';

const FILES = 'abcdefghi';
// Pieces that can ever attack the enemy general; advisors and elephants never leave home.
const ATTACKERS: XPieceType[] = ['r', 'n', 'c', 'p'];

type Grid = (XPiece | null)[][]; // grid[rank][file]

export function squareName(file: number, rank: number): string {
  return `${FILES[file]}${rank}`;
}

export function parseSquare(square: string): [number, number] | null {
  if (typeof square !== 'string' || square.length !== 2) return null;
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  return file >= 0 && Number.isInteger(rank) && rank >= 0 && rank <= 9 ? [file, rank] : null;
}

const other = (side: XSide): XSide => (side === 'r' ? 'b' : 'r');
const onBoard = (f: number, r: number) => f >= 0 && f <= 8 && r >= 0 && r <= 9;
const inPalace = (side: XSide, f: number, r: number) => f >= 3 && f <= 5 && (side === 'r' ? r <= 2 : r >= 7);
const ownHalf = (side: XSide, r: number) => (side === 'r' ? r <= 4 : r >= 5);
const forward = (side: XSide) => (side === 'r' ? 1 : -1);

export class Xiangqi {
  private grid: Grid;
  private side: XSide;
  private log: { move: XMove; captured: XPiece | null }[] = [];

  constructor(fen = START_FEN) {
    const [board, turn] = fen.trim().split(/\s+/);
    const rows = board.split('/');
    if (rows.length !== 10) throw new Error('Invalid FEN');
    this.grid = Array.from({ length: 10 }, () => Array<XPiece | null>(9).fill(null));
    rows.forEach((row, i) => {
      const rank = 9 - i;
      let file = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) file += Number(ch);
        else {
          const type = ch.toLowerCase() as XPieceType;
          if (!'kabnrcp'.includes(type) || file > 8) throw new Error('Invalid FEN');
          this.grid[rank][file++] = { side: ch === ch.toUpperCase() ? 'r' : 'b', type };
        }
      }
      if (file !== 9) throw new Error('Invalid FEN');
    });
    // FEN uses 'w' for red, the side that moves first.
    this.side = turn === 'b' ? 'b' : 'r';
  }

  // Takes a piece off the board (used to set up handicap games).
  remove(square: string): void {
    const p = parseSquare(square);
    if (p) this.grid[p[1]][p[0]] = null;
  }

  turn(): XSide {
    return this.side;
  }

  get(square: string): XPiece | null {
    const p = parseSquare(square);
    return p ? this.grid[p[1]][p[0]] : null;
  }

  // Rows from black's back rank (rank 9) down to red's (rank 0), files a–i.
  board(): (XPiece | null)[][] {
    return [...this.grid].reverse().map((row) => [...row]);
  }

  fen(): string {
    const rows = this.board().map((row) => {
      let out = '';
      let empty = 0;
      for (const p of row) {
        if (!p) {
          empty++;
          continue;
        }
        if (empty) out += empty;
        empty = 0;
        out += p.side === 'r' ? p.type.toUpperCase() : p.type;
      }
      return out + (empty || '');
    });
    return `${rows.join('/')} ${this.side === 'r' ? 'w' : 'b'}`;
  }

  history(): XMove[] {
    return this.log.map((l) => l.move);
  }

  // Legal moves for the side to move, optionally from one square.
  moves(from?: string): XMove[] {
    const result: XMove[] = [];
    for (let r = 0; r <= 9; r++) {
      for (let f = 0; f <= 8; f++) {
        const piece = this.grid[r][f];
        if (!piece || piece.side !== this.side) continue;
        if (from && squareName(f, r) !== from) continue;
        for (const [tf, tr] of this.pseudoMoves(f, r)) {
          const move = this.tryMove(f, r, tf, tr);
          if (move) result.push(move);
        }
      }
    }
    return result;
  }

  move(input: { from: string; to: string } | string): XMove {
    const { from, to } = typeof input === 'string' ? { from: input.slice(0, 2), to: input.slice(2, 4) } : input;
    const a = parseSquare(from);
    const b = parseSquare(to);
    const piece = a && this.grid[a[1]][a[0]];
    if (!a || !b || !piece || piece.side !== this.side) throw new Error(`Illegal move ${from}${to}`);
    if (!this.pseudoMoves(a[0], a[1]).some(([f, r]) => f === b[0] && r === b[1])) throw new Error(`Illegal move ${from}${to}`);
    const move = this.tryMove(a[0], a[1], b[0], b[1]);
    if (!move) throw new Error(`Illegal move ${from}${to}`);
    const captured = this.grid[b[1]][b[0]];
    this.grid[b[1]][b[0]] = piece;
    this.grid[a[1]][a[0]] = null;
    this.side = other(this.side);
    this.log.push({ move, captured });
    return move;
  }

  undo(): XMove | null {
    const last = this.log.pop();
    if (!last) return null;
    const a = parseSquare(last.move.from)!;
    const b = parseSquare(last.move.to)!;
    this.grid[a[1]][a[0]] = this.grid[b[1]][b[0]];
    this.grid[b[1]][b[0]] = last.captured;
    this.side = last.move.side;
    return last.move;
  }

  inCheck(side: XSide = this.side): boolean {
    return this.generalInDanger(side);
  }

  // In xiangqi a side with no legal moves loses, whether or not it is in check.
  hasLegalMoves(): boolean {
    return this.moves().length > 0;
  }

  // Whether `side` still has any piece able to attack (chariot, horse, cannon or soldier).
  hasAttackers(side: XSide): boolean {
    return this.grid.some((row) => row.some((p) => p?.side === side && ATTACKERS.includes(p.type)));
  }

  // Board + side to move, for repetition detection.
  positionKey(): string {
    return this.fen();
  }

  // Plays a move and checks the mover's general is safe; returns the move or null, leaving the board unchanged.
  private tryMove(f: number, r: number, tf: number, tr: number): XMove | null {
    const piece = this.grid[r][f]!;
    const captured = this.grid[tr][tf];
    this.grid[tr][tf] = piece;
    this.grid[r][f] = null;
    const legal = !this.generalInDanger(piece.side);
    const check = legal && this.generalInDanger(other(piece.side));
    this.grid[r][f] = piece;
    this.grid[tr][tf] = captured;
    if (!legal) return null;
    const move: XMove = { from: squareName(f, r), to: squareName(tf, tr), side: piece.side, piece: piece.type, check };
    if (captured) move.captured = captured.type;
    return move;
  }

  private findGeneral(side: XSide): [number, number] | null {
    for (let r = 0; r <= 9; r++) {
      for (let f = 3; f <= 5; f++) {
        const p = this.grid[r][f];
        if (p?.type === 'k' && p.side === side) return [f, r];
      }
    }
    return null;
  }

  // Attacked by any enemy piece, or facing the enemy general on an open file ("flying general").
  private generalInDanger(side: XSide): boolean {
    const own = this.findGeneral(side);
    const enemy = this.findGeneral(other(side));
    if (!own) return true;
    if (enemy && enemy[0] === own[0]) {
      const [lo, hi] = own[1] < enemy[1] ? [own[1], enemy[1]] : [enemy[1], own[1]];
      let blocked = false;
      for (let r = lo + 1; r < hi; r++) if (this.grid[r][own[0]]) blocked = true;
      if (!blocked) return true;
    }
    for (let r = 0; r <= 9; r++) {
      for (let f = 0; f <= 8; f++) {
        const p = this.grid[r][f];
        if (!p || p.side === side || p.type === 'k') continue;
        if (this.pseudoMoves(f, r).some(([tf, tr]) => tf === own[0] && tr === own[1])) return true;
      }
    }
    return false;
  }

  // Moves allowed by how the piece moves, ignoring whether they expose the own general.
  private pseudoMoves(f: number, r: number): [number, number][] {
    const piece = this.grid[r][f]!;
    const { side } = piece;
    const out: [number, number][] = [];
    const add = (tf: number, tr: number) => {
      if (!onBoard(tf, tr)) return;
      const target = this.grid[tr][tf];
      if (!target || target.side !== side) out.push([tf, tr]);
    };
    const ortho: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    const diag: [number, number][] = [
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ];

    switch (piece.type) {
      case 'k':
        for (const [df, dr] of ortho) if (inPalace(side, f + df, r + dr)) add(f + df, r + dr);
        break;
      case 'a':
        for (const [df, dr] of diag) if (inPalace(side, f + df, r + dr)) add(f + df, r + dr);
        break;
      case 'b':
        for (const [df, dr] of diag) {
          const [tf, tr] = [f + 2 * df, r + 2 * dr];
          // Blocked if the "elephant eye" is occupied; never crosses the river.
          if (onBoard(tf, tr) && ownHalf(side, tr) && !this.grid[r + dr][f + df]) add(tf, tr);
        }
        break;
      case 'n':
        for (const [df, dr] of ortho) {
          // The horse is hobbled by a piece on the first, orthogonal step.
          if (!onBoard(f + df, r + dr) || this.grid[r + dr][f + df]) continue;
          if (df === 0) {
            add(f + 1, r + 2 * dr);
            add(f - 1, r + 2 * dr);
          } else {
            add(f + 2 * df, r + 1);
            add(f + 2 * df, r - 1);
          }
        }
        break;
      case 'r':
        for (const [df, dr] of ortho) {
          for (let tf = f + df, tr = r + dr; onBoard(tf, tr); tf += df, tr += dr) {
            add(tf, tr);
            if (this.grid[tr][tf]) break;
          }
        }
        break;
      case 'c':
        for (const [df, dr] of ortho) {
          let screened = false;
          for (let tf = f + df, tr = r + dr; onBoard(tf, tr); tf += df, tr += dr) {
            const target = this.grid[tr][tf];
            if (!screened) {
              if (target) screened = true;
              else out.push([tf, tr]);
            } else if (target) {
              // Captures only by jumping exactly one piece (the "screen").
              if (target.side !== side) out.push([tf, tr]);
              break;
            }
          }
        }
        break;
      case 'p': {
        add(f, r + forward(side));
        if (!ownHalf(side, r)) {
          add(f + 1, r);
          add(f - 1, r);
        }
        break;
      }
    }
    return out;
  }
}
