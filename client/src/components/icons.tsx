import type { ReactElement, SVGProps } from 'react';
import type { GameType } from '@vg/shared';

type IconProps = SVGProps<SVGSVGElement>;

function Svg({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export const CopyIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </Svg>
);

export const CheckIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </Svg>
);

export const ShareIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3v12M7 8l5-5 5 5" />
    <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
  </Svg>
);

export const ExitIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
    <path d="M10 17l-5-5 5-5M5 12h11" />
  </Svg>
);

export const CrownIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z" fill="currentColor" stroke="none" />
  </Svg>
);

export const FlagIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
  </Svg>
);

export const PlayIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 4.5v15l12-7.5-12-7.5z" fill="currentColor" stroke="none" />
  </Svg>
);

export const TrophyIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 4h8v5a4 4 0 0 1-8 0V4z" />
    <path d="M16 6h3v1a3 3 0 0 1-3 3M8 6H5v1a3 3 0 0 0 3 3M12 13v4M8 21h8M9 17h6v4H9z" />
  </Svg>
);

export const HandshakeIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 11l4-4 4 2 3-2 7 6-3 3" />
    <path d="M7 13l3 3a1.5 1.5 0 0 0 2-2M11 12l3.5 3.5a1.5 1.5 0 0 1-2 2L12 17" />
  </Svg>
);

export const FrownIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 16.5c2-2 5-2 7 0M9 9.5h.01M15 9.5h.01" />
  </Svg>
);

export const LinkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </Svg>
);

export const UsersIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" />
  </Svg>
);

export const SparkIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3z" fill="currentColor" stroke="none" />
  </Svg>
);

export const SunIcon = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);

export const MoonIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </Svg>
);

export const QrIcon = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3M21 14v.01M14 21h3M21 17v4h-1" />
  </Svg>
);

export const ChatIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3 20.5l1.4-5.1A8.5 8.5 0 1 1 21 11.5z" />
    <path d="M8.5 11.5h.01M12.5 11.5h.01M16.5 11.5h.01" strokeWidth={3} />
  </Svg>
);

export const SendIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 3L10 14M21 3l-7 18-4-7-7-4 18-7z" />
  </Svg>
);

export const FlipIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 20V4M3 8l4-4 4 4M17 4v16M13 16l4 4 4-4" />
  </Svg>
);

export const EqualIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 9h14M5 15h14" />
  </Svg>
);

export const ChevronLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M15 6l-6 6 6 6" />
  </Svg>
);

export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);

export const ChevronsLeftIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 6l-6 6 6 6M12 6l-6 6 6 6" />
  </Svg>
);

export const ChevronsRightIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l6 6-6 6M12 6l6 6-6 6" />
  </Svg>
);

export const SoundIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9h4l5-4v14l-5-4H4z" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
  </Svg>
);

export const MuteIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9h4l5-4v14l-5-4H4z" />
    <path d="M17 9l5 5M22 9l-5 5" />
  </Svg>
);

export const UndoIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Svg>
);

export const DownloadIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v12M7 11l5 5 5-5M5 20h14" />
  </Svg>
);

export const BookIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z" />
    <path d="M4 19a2 2 0 0 1 2-2h13M9 7h6M9 11h4" />
  </Svg>
);

export const CloseIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);

// Game illustrations: drawn on a 64x64 grid, used large on lobby cards and small in headers.

function ChessArt() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path
        d="M20 54h26v-5H20zM23 49l2-10c-4-2-6-6-5-11 1-6 6-11 12-12l2-5 3 5c6 2 10 8 9 16l-1 17z"
        fill="currentColor"
        opacity="0.95"
      />
      <path d="M31 25c-3 1-5 3-6 6" stroke="var(--art-ink)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <circle cx="35" cy="23" r="2" fill="var(--art-ink)" />
    </svg>
  );
}

function XiangqiArt() {
  // A piece disc carrying the palace diagonals, so it renders without CJK fonts.
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="33" r="23" fill="currentColor" />
      <circle cx="32" cy="33" r="18" fill="none" stroke="var(--art-ink)" strokeWidth="2" />
      <g stroke="var(--art-ink)" strokeWidth="2.5" strokeLinecap="round">
        <path d="M23 24h18v18H23z" fill="none" />
        <path d="M23 24l18 18M41 24L23 42" />
      </g>
      <circle cx="32" cy="33" r="3.5" fill="var(--art-ink)" />
    </svg>
  );
}

function CardsArt() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <g fill="currentColor" stroke="var(--art-ink)" strokeWidth="1.5">
        <rect x="10" y="16" width="24" height="34" rx="3" transform="rotate(-16 22 33)" />
        <rect x="20" y="12" width="24" height="34" rx="3" />
        <rect x="30" y="16" width="24" height="34" rx="3" transform="rotate(16 42 33)" />
      </g>
      <path
        d="M41.5 27c-2-3.5-7-2-6 2 .6 2.4 6 6.5 6 6.5s5.4-4.1 6-6.5c1-4-4-5.5-6-2z"
        fill="var(--art-ink)"
        transform="rotate(16 42 33)"
      />
    </svg>
  );
}

function PropertyArt() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M8 30L26 15l18 15v22H8z" fill="currentColor" />
      <rect x="21" y="38" width="10" height="14" fill="var(--art-ink)" opacity="0.8" />
      <g transform="rotate(12 46 42)">
        <rect x="35" y="31" width="22" height="22" rx="5" fill="currentColor" stroke="var(--art-ink)" strokeWidth="2" />
        <g fill="var(--art-ink)">
          <circle cx="41" cy="37" r="2" />
          <circle cx="46" cy="42" r="2" />
          <circle cx="51" cy="47" r="2" />
        </g>
      </g>
    </svg>
  );
}

function CaroArt() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <rect x="8" y="8" width="48" height="48" rx="6" fill="currentColor" />
      <path d="M24 8v48M40 8v48M8 24h48M8 40h48" stroke="var(--art-ink)" strokeWidth="1.5" opacity="0.35" />
      <g stroke="var(--art-ink)" strokeWidth="3.5" strokeLinecap="round" fill="none">
        <path d="M11 11l10 10M21 11L11 21M27 27l10 10M37 27L27 37M43 43l10 10M53 43L43 53" />
        <circle cx="48" cy="16" r="5" />
        <circle cx="16" cy="48" r="5" />
      </g>
    </svg>
  );
}

function HorseRaceArt() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path
        d="M14 54h24l-3-6c4-3 6-8 5-13l-6-13-6-6-2 6c-5 1-9 5-10 10l3 3 6-3 3 3-11 13z"
        fill="currentColor"
      />
      <circle cx="28" cy="24" r="1.8" fill="var(--art-ink)" />
      <g transform="rotate(-12 48 44)">
        <rect x="38" y="34" width="20" height="20" rx="4.5" fill="currentColor" stroke="var(--art-ink)" strokeWidth="2" />
        <g fill="var(--art-ink)">
          <circle cx="43" cy="39" r="1.8" />
          <circle cx="53" cy="39" r="1.8" />
          <circle cx="48" cy="44" r="1.8" />
          <circle cx="43" cy="49" r="1.8" />
          <circle cx="53" cy="49" r="1.8" />
        </g>
      </g>
    </svg>
  );
}

function WordChainArt({ first, second }: { first: string; second: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M6 14a6 6 0 0 1 6-6h22a6 6 0 0 1 6 6v12a6 6 0 0 1-6 6H18l-7 6v-6a6 6 0 0 1-5-6z" fill="currentColor" />
      <path d="M58 38a6 6 0 0 0-6-6H30a6 6 0 0 0-6 6v12a6 6 0 0 0 6 6h16l7 6v-6a6 6 0 0 0 5-6z" fill="currentColor" opacity="0.85" />
      <g fill="var(--art-ink)" fontFamily="inherit" fontWeight="800" fontSize="13" textAnchor="middle">
        <text x="23" y="25">{first}</text>
        <text x="41" y="49">{second}</text>
      </g>
    </svg>
  );
}

function WolfArt() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M44 6a20 20 0 1 0 14 30A16 16 0 1 1 44 6z" fill="currentColor" opacity="0.6" />
      <path
        d="M12 56l4-20-6-14 10 6 6-8 4 10 8 2 6 6-6 2-4 4 2 12z"
        fill="currentColor"
      />
      <circle cx="27" cy="31" r="1.8" fill="var(--art-ink)" />
    </svg>
  );
}

function CrabArt() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="3" strokeLinecap="round" fill="none">
        <path d="M18 34l-8 4M18 40l-7 6M46 34l8 4M46 40l7 6" />
        <path d="M20 28c-4-4-6-9-4-14M44 28c4-4 6-9 4-14" />
      </g>
      <g fill="currentColor">
        <path d="M11 12c2-5 9-5 9 0l-4 1 4 3c-3 3-9 2-9-4z" />
        <path d="M53 12c-2-5-9-5-9 0l4 1-4 3c3 3 9 2 9-4z" />
        <ellipse cx="32" cy="36" rx="15" ry="11" />
      </g>
      <g fill="var(--art-ink)">
        <circle cx="27" cy="31" r="2" />
        <circle cx="37" cy="31" r="2" />
      </g>
    </svg>
  );
}

function BlackjackArt() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <g fill="currentColor" stroke="var(--art-ink)" strokeWidth="1.5">
        <rect x="8" y="14" width="26" height="38" rx="3" transform="rotate(-10 21 33)" />
        <rect x="28" y="12" width="26" height="38" rx="3" transform="rotate(8 41 31)" />
      </g>
      <g fill="var(--art-ink)" fontFamily="inherit" fontWeight="800" textAnchor="middle">
        <text x="16" y="30" fontSize="13" transform="rotate(-10 21 33)">A</text>
        <text x="41" y="37" fontSize="18" transform="rotate(8 41 31)">K</text>
      </g>
    </svg>
  );
}

const ART: Record<GameType, () => ReactElement> = {
  chess: ChessArt,
  xiangqi: XiangqiArt,
  tienlen: CardsArt,
  typhu: PropertyArt,
  caro: CaroArt,
  cangua: HorseRaceArt,
  noitu: () => <WordChainArt first="Ăn" second="Ơi" />,
  wordchain: () => <WordChainArt first="Ab" second="Bc" />,
  masoi: WolfArt,
  baucua: CrabArt,
  xidach: BlackjackArt,
};

export function GameArt({ type }: { type: GameType }) {
  const Art = ART[type];
  return <Art />;
}

export function LogoMark() {
  return (
    <svg viewBox="0 0 40 40" width="36" height="36" aria-hidden="true">
      <rect width="40" height="40" rx="11" fill="var(--brand)" />
      <circle cx="20" cy="20" r="12" fill="none" stroke="var(--gold)" strokeWidth="2.5" />
      <circle cx="20" cy="20" r="7.5" fill="none" stroke="var(--gold)" strokeWidth="1.2" strokeDasharray="2 2.4" />
      <path d="M20 13.5l1.9 4.6 4.6 1.9-4.6 1.9-1.9 4.6-1.9-4.6-4.6-1.9 4.6-1.9z" fill="var(--gold)" />
    </svg>
  );
}
