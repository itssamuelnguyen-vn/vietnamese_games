// Common openings, matched by the longest prefix of the game's SAN moves.
// Display names live in the locale files under chess.openings.
export const OPENINGS = {
  'kings-pawn': 'e4',
  'open-game': 'e4 e5',
  italian: 'e4 e5 Nf3 Nc6 Bc4',
  'giuoco-piano': 'e4 e5 Nf3 Nc6 Bc4 Bc5',
  'two-knights': 'e4 e5 Nf3 Nc6 Bc4 Nf6',
  'ruy-lopez': 'e4 e5 Nf3 Nc6 Bb5',
  scotch: 'e4 e5 Nf3 Nc6 d4',
  petrov: 'e4 e5 Nf3 Nf6',
  philidor: 'e4 e5 Nf3 d6',
  'kings-gambit': 'e4 e5 f4',
  vienna: 'e4 e5 Nc3',
  sicilian: 'e4 c5',
  'sicilian-najdorf': 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6',
  'sicilian-dragon': 'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 g6',
  french: 'e4 e6',
  'caro-kann': 'e4 c6',
  scandinavian: 'e4 d5',
  alekhine: 'e4 Nf6',
  pirc: 'e4 d6 d4 Nf6 Nc3 g6',
  modern: 'e4 g6',
  'queens-pawn': 'd4',
  'queens-gambit': 'd4 d5 c4',
  'queens-gambit-declined': 'd4 d5 c4 e6',
  'queens-gambit-accepted': 'd4 d5 c4 dxc4',
  slav: 'd4 d5 c4 c6',
  london: 'd4 d5 Bf4',
  'london-indian': 'd4 Nf6 Bf4',
  'kings-indian': 'd4 Nf6 c4 g6',
  grunfeld: 'd4 Nf6 c4 g6 Nc3 d5',
  'nimzo-indian': 'd4 Nf6 c4 e6 Nc3 Bb4',
  'queens-indian': 'd4 Nf6 c4 e6 Nf3 b6',
  benoni: 'd4 Nf6 c4 c5',
  dutch: 'd4 f5',
  english: 'c4',
  reti: 'Nf3 d5 c4',
  bird: 'f4',
} as const;

export type OpeningId = keyof typeof OPENINGS;

const BY_LENGTH = (Object.entries(OPENINGS) as [OpeningId, string][])
  .map(([id, line]) => ({ id, moves: line.split(' ') }))
  .sort((a, b) => b.moves.length - a.moves.length);

export function findOpening(history: string[]): OpeningId | null {
  const match = BY_LENGTH.find(({ moves }) => moves.length <= history.length && moves.every((m, i) => history[i] === m));
  return match?.id ?? null;
}
