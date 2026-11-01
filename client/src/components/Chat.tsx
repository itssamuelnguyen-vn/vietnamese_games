import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ChatMessage, RoomView } from '@vg/shared';
import { api } from '../socket';
import { useI18n } from '../i18n';
import { toast } from './Toaster';
import { ChatIcon, CloseIcon, SendIcon } from './icons';
import { loadSetting, saveSetting } from '../settings';

// Below this width the game screens stack into one column, so the chat becomes a floating button.
const NARROW = '(max-width: 860px)';

interface ChatProps {
  room: RoomView;
  // In two-player games, the opponent's name for the input placeholder.
  recipient?: string;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

// The room chat: a card in the side column on wide screens, a draggable floating button on phones.
export function ChatCard({ room, recipient }: ChatProps) {
  const { t } = useI18n();
  const narrow = useMediaQuery(NARROW);
  // Kept here so a draft survives switching between the card and the floating chat.
  const [text, setText] = useState('');
  const body = <ChatBody room={room} recipient={recipient} text={text} setText={setText} />;
  if (narrow) return <FloatingChat room={room}>{body}</FloatingChat>;
  return (
    <section className="card panel chat-card">
      <h2>{t.chat.title}</h2>
      {body}
    </section>
  );
}

function ChatBody({ room, recipient, text, setText }: ChatProps & { text: string; setText: (text: string) => void }) {
  const { t } = useI18n();
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const firstScroll = useRef(true);

  useEffect(() => {
    // Jump to the latest message when the list first appears, then glide to new ones.
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: firstScroll.current ? 'auto' : 'smooth' });
    firstScroll.current = false;
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
    <>
      {room.chat.length === 0 ? (
        <p className="muted small chat-empty">{t.chat.empty}</p>
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
    </>
  );
}


// ---- Floating chat ----

const FAB = 56;
const MARGIN = 12;
// Pointer travel below this counts as a tap, not a drag.
const DRAG_SLOP = 6;
const SPOT_KEY = 'vg:chatFab';
const PREVIEW_MS = 4000;

// Where the button rests: against the left or right edge, at a fraction of the screen height.
interface Spot {
  side: 'left' | 'right';
  y: number;
}

function loadSpot(): Spot {
  try {
    const spot = JSON.parse(loadSetting(SPOT_KEY) ?? '');
    if ((spot.side === 'left' || spot.side === 'right') && typeof spot.y === 'number' && spot.y >= 0 && spot.y <= 1) return spot;
  } catch {
    // Missing or malformed: use the default.
  }
  return { side: 'right', y: 0.72 };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi));

// The visible viewport, which shrinks when a phone's on-screen keyboard opens.
function useViewport() {
  const read = () => {
    const vv = window.visualViewport;
    // The layout viewport, which fixed elements are placed in. window.innerHeight is no good here:
    // mobile browsers shrink it along with the visual viewport when the keyboard opens.
    const { clientWidth: width, clientHeight: height } = document.documentElement;
    const visible = vv ? vv.height : height;
    // How much of the layout viewport the keyboard covers at the bottom. Zero where the browser
    // shrinks the page for the keyboard instead (interactive-widget=resizes-content in index.html).
    const keyboard = vv ? Math.max(0, height - vv.height - vv.offsetTop) : 0;
    return { width, height, visible, keyboard };
  };
  const [viewport, setViewport] = useState(read);
  useEffect(() => {
    const update = () => setViewport(read());
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, []);
  return viewport;
}

// Click handlers that only act on a press that started on the element itself, or on the keyboard
// (a keyboard click has detail 0). The tap that opens the sheet still delivers its click to whatever
// now sits under the finger, such as the close button, and that echo must not close it again.
function useOwnClick(action: () => void) {
  const pressed = useRef(false);
  return {
    onPointerDown: () => {
      pressed.current = true;
    },
    onClick: (e: MouseEvent) => {
      if (pressed.current || e.detail === 0) action();
      pressed.current = false;
    },
  };
}

function FloatingChat({ room, children }: { room: RoomView; children: ReactNode }) {
  const { t } = useI18n();
  const viewport = useViewport();
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState(loadSpot);
  const [dragAt, setDragAt] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number; startX: number; startY: number; moved: boolean } | null>(null);
  // A tap opens the chat on pointerup (a click doesn't always follow a touch, e.g. right after a
  // drag), so a click arriving just after is ignored; keyboard Enter/Space still opens via click.
  const ignoreClickUntil = useRef(0);
  const fabRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Unread: messages from others newer than the last one seen with the chat open.
  const lastId = room.chat.at(-1)?.id ?? 0;
  const [seenId, setSeenId] = useState(lastId);
  useEffect(() => {
    if (open) setSeenId(lastId);
  }, [open, lastId]);
  const unread = room.chat.filter((m) => m.id > seenId && m.playerId !== room.you).length;

  // A new message from someone else pops up next to the button for a few seconds.
  const [preview, setPreview] = useState<ChatMessage | null>(null);
  const lastSeenByPreview = useRef(lastId);
  useEffect(() => {
    if (lastId === lastSeenByPreview.current) return;
    lastSeenByPreview.current = lastId;
    const latest = room.chat.at(-1);
    if (latest && latest.playerId !== room.you && !open) setPreview(latest);
  }, [lastId, room.chat, room.you, open]);
  useEffect(() => {
    if (!preview) return;
    const id = setTimeout(() => setPreview(null), PREVIEW_MS);
    return () => clearTimeout(id);
  }, [preview]);

  function openChat() {
    setPreview(null);
    setOpen(true);
  }

  function closeChat() {
    setOpen(false);
    fabRef.current?.focus();
  }

  const closeButton = useOwnClick(closeChat);
  const backdrop = useOwnClick(closeChat);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeChat();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const top = (y: number) => clamp(y, MARGIN, viewport.height - FAB - MARGIN);
  const rest = { x: spot.side === 'left' ? MARGIN : viewport.width - FAB - MARGIN, y: top(spot.y * viewport.height) };
  const at = dragAt ?? rest;

  function onPointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    drag.current = { dx: e.clientX - box.left, dy: e.clientY - box.top, startX: e.clientX, startY: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_SLOP) return;
    d.moved = true;
    setPreview(null);
    setDragAt({ x: clamp(e.clientX - d.dx, 0, viewport.width - FAB), y: clamp(e.clientY - d.dy, 0, viewport.height - FAB) });
  }

  function onPointerUp(e: PointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    ignoreClickUntil.current = performance.now() + 500;
    if (!d.moved) {
      openChat();
      return;
    }
    // A drag is not a tap: settle against the nearer edge.
    const x = e.clientX - d.dx;
    const next: Spot = { side: x + FAB / 2 < viewport.width / 2 ? 'left' : 'right', y: top(e.clientY - d.dy) / viewport.height };
    setSpot(next);
    saveSetting(SPOT_KEY, JSON.stringify(next));
    setDragAt(null);
  }

  function onPointerCancel() {
    drag.current = null;
    setDragAt(null);
  }

  function onClick() {
    if (performance.now() < ignoreClickUntil.current) return;
    openChat();
  }

  const label = unread ? `${t.chat.open} (${t.chat.unread(unread)})` : t.chat.open;

  return createPortal(
    <>
      {!open && (
        <button
          ref={fabRef}
          type="button"
          // With nothing new to read it tucks into the edge, out of the way of the game.
          className={`chat-fab ${dragAt ? 'dragging' : ''} ${spot.side} ${!unread && !preview && !dragAt ? 'tucked' : ''}`}
          style={{ left: at.x, top: at.y } as CSSProperties}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onClick={onClick}
          aria-label={label}
          aria-haspopup="dialog"
          title={label}
        >
          <ChatIcon />
          {unread > 0 && (
            <span key={unread} className="chat-fab-badge" aria-hidden="true">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      )}
      {!open && preview && !dragAt && (
        <button
          type="button"
          className={`chat-preview ${spot.side}`}
          style={{ top: at.y + FAB / 2, [spot.side]: MARGIN + FAB + 8 } as CSSProperties}
          onClick={openChat}
        >
          <strong>{preview.name}</strong> {preview.text}
        </button>
      )}
      {open && (
        <>
          <div className="chat-sheet-backdrop" {...backdrop} />
          <section
            className="card chat-sheet"
            role="dialog"
            aria-label={t.chat.title}
            style={{ bottom: viewport.keyboard + 8, maxHeight: `min(60vh, ${viewport.visible - 16}px)` }}
          >
            <header className="chat-sheet-head">
              <h2>{t.chat.title}</h2>
              <button ref={closeRef} type="button" className="btn btn-ghost btn-square" {...closeButton} aria-label={t.chat.close}>
                <CloseIcon />
              </button>
            </header>
            {children}
          </section>
        </>
      )}
    </>,
    document.body,
  );
}
