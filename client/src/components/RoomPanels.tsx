import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { GAME_CATALOG, TIME_CONTROLS, type HostColor, type RoomOptions, type RoomView, type TimeControlId } from '@vg/shared';
import { api } from '../socket';
import { useI18n, type Strings } from '../i18n';
import { Avatar } from './Avatar';
import { toast } from './Toaster';
import { CopyIcon, CrownIcon, QrIcon, SendIcon } from './icons';

export function inviteLink(code: string) {
  return `${location.origin}/?room=${code}`;
}

export async function copyInvite(t: Strings, code: string) {
  try {
    await navigator.clipboard.writeText(inviteLink(code));
    toast(t.room.linkCopied);
  } catch {
    // The Clipboard API needs HTTPS; fall back to letting the user copy from a prompt.
    prompt(t.room.copyLink, inviteLink(code));
  }
}

export function RoomCodeCard({ code }: { code: string }) {
  const { t } = useI18n();
  const [qr, setQr] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    if (!showQr || qr) return;
    QRCode.toDataURL(inviteLink(code), { margin: 1, width: 240 }).then(setQr, () => setShowQr(false));
  }, [showQr, qr, code]);

  return (
    <section className="card panel code-card">
      <p className="eyebrow">{t.room.codeLabel}</p>
      <div className="code-tiles sm">
        {code.split('').map((c, i) => (
          <span key={i} className="code-tile">
            {c}
          </span>
        ))}
      </div>
      <div className="code-card-actions">
        <button className="btn btn-primary" onClick={() => copyInvite(t, code)}>
          <CopyIcon /> {t.room.copyLink}
        </button>
        <button
          className="btn btn-secondary btn-square"
          aria-pressed={showQr}
          aria-label={t.room.showQr}
          title={t.room.showQr}
          onClick={() => setShowQr((v) => !v)}
        >
          <QrIcon />
        </button>
      </div>
      {showQr && qr && <img className="qr" src={qr} alt={t.room.qrAlt} width={160} height={160} />}
    </section>
  );
}

interface PlayersCardProps {
  room: RoomView;
  // Extra line under each player's name, e.g. their colour in chess.
  subtitle?: (playerId: string) => ReactNode;
}

export function PlayersCard({ room, subtitle }: PlayersCardProps) {
  const { t } = useI18n();
  const info = GAME_CATALOG[room.gameType];
  return (
    <section className="card panel">
      <header className="panel-head">
        <h2>{t.room.playersTitle}</h2>
        <span className="muted">
          {room.players.length}/{info.maxPlayers}
        </span>
      </header>
      <ul className="player-list">
        {room.players.map((p) => (
          <li key={p.id} className={p.id === room.you ? 'me' : ''}>
            <Avatar id={p.id} name={p.name} size={40} online={p.connected} />
            <div className="player-list-text">
              <span className="player-list-name">
                {p.name} {p.id === room.you && <span className="muted">{t.room.youSuffix}</span>}
              </span>
              <span className="player-list-sub">
                {subtitle && <span className="muted small">{subtitle(p.id)}</span>}
                {p.id === room.hostId && (
                  <span className="tag tag-gold">
                    <CrownIcon /> {t.room.host}
                  </span>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <p className="spectator-line muted small">
        {t.room.spectators} · {room.spectators.length ? room.spectators.map((s) => s.name).join(', ') : t.room.noSpectators}
      </p>
    </section>
  );
}

export function ChessOptionsPicker({ room }: { room: RoomView }) {
  const { t } = useI18n();
  const locked = room.hostId !== room.you || room.status === 'playing';

  async function set(options: Partial<RoomOptions>) {
    const r = await api.options(options);
    if (!r.ok) toast(t.errors[r.error]);
  }

  return (
    <>
      <ChipGroup
        label={t.room.timeControl}
        options={Object.keys(TIME_CONTROLS) as TimeControlId[]}
        value={room.options.timeControl}
        labelOf={(id) => t.timeControls[id]}
        disabled={locked}
        onPick={(timeControl) => set({ timeControl })}
      />
      <ChipGroup
        label={t.room.hostColor}
        options={['random', 'white', 'black'] as HostColor[]}
        value={room.options.hostColor}
        labelOf={(c) => (room.gameType === 'xiangqi' ? t.xiangqi.hostColors[c] : t.room.hostColors[c])}
        disabled={locked}
        onPick={(hostColor) => set({ hostColor })}
      />
    </>
  );
}

interface ChipGroupProps<T extends string> {
  label: string;
  options: T[];
  value: T;
  labelOf: (option: T) => string;
  disabled: boolean;
  onPick: (option: T) => void;
}

function ChipGroup<T extends string>({ label, options, value, labelOf, disabled, onPick }: ChipGroupProps<T>) {
  return (
    <div className="time-picker">
      <span className="field-label">{label}</span>
      <div className="chip-group" role="group" aria-label={label}>
        {options.map((option) => (
          <button key={option} className="chip" aria-pressed={value === option} disabled={disabled} onClick={() => onPick(option)}>
            {labelOf(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ChatCard({ room, recipient }: { room: RoomView; recipient?: string }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [room.chat.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const message = text.trim();
    if (!message || sending) return;
    setSending(true);
    const r = await api.chat(message);
    setSending(false);
    if (r.ok) setText('');
    else toast(t.errors[r.error]);
  }

  return (
    <section className="card panel chat-card">
      <h2>{t.chat.title}</h2>
      {room.chat.length === 0 ? (
        <p className="muted small">{t.chat.empty}</p>
      ) : (
        <ol className="chat-list" ref={listRef}>
          {room.chat.map((m) => (
            <li key={m.id} className={m.playerId === room.you ? 'mine' : ''}>
              {m.playerId !== room.you && <strong>{m.name}</strong>}
              {m.playerId !== room.you && ' · '}
              {m.text}
            </li>
          ))}
        </ol>
      )}
      <form className="chat-form" onSubmit={send}>
        <input
          value={text}
          maxLength={200}
          placeholder={recipient ? t.chat.placeholderTo(recipient) : t.chat.placeholder}
          aria-label={t.chat.title}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn btn-dark btn-square" disabled={!text.trim() || sending} aria-label={t.chat.send}>
          <SendIcon />
        </button>
      </form>
    </section>
  );
}
