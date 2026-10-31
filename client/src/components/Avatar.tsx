const AVATAR_COLORS = ['#c2410c', '#b91c1c', '#7c3aed', '#0f766e', '#1d4ed8', '#be185d', '#4d7c0f', '#a16207'];

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  // Vietnamese names put the given name last, so prefer the last word's initial.
  const first = words.at(-1)![0];
  return first.toLocaleUpperCase('vi');
}

interface Props {
  id: string;
  name: string;
  size?: number;
  online?: boolean;
  // Overrides the colour picked from the id, e.g. to match a player's tokens on a board.
  color?: string;
}

export function Avatar({ id, name, size = 40, online, color }: Props) {
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.42, background: color ?? AVATAR_COLORS[hash(id) % AVATAR_COLORS.length] }}
    >
      {initials(name)}
      {online !== undefined && <span className={`avatar-status ${online ? 'on' : 'off'}`} />}
    </span>
  );
}
