import { useEffect, useRef, useState } from 'react';
import type { RoomView } from '@vg/shared';
import { socket } from './socket';
import { LOCALES, useI18n } from './i18n';
import { useTheme } from './theme';
import { Lobby } from './components/Lobby';
import { RoomScreen } from './components/RoomScreen';
import { Toaster, toast } from './components/Toaster';
import { Ellipsis } from './components/Ellipsis';
import { LogoMark, MoonIcon, MuteIcon, SoundIcon, SunIcon } from './components/icons';
import { isSoundOn, setSoundOn } from './sound';

function roomCodeFromUrl(): string {
  return new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';
}

export function App() {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggle: toggleTheme } = useTheme();
  const [sound, setSound] = useState(isSoundOn);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  // Read once at page load: only an invite link should prefill the join box, not a room we just left.
  const [inviteCode, setInviteCode] = useState(roomCodeFromUrl);
  const inRoom = useRef(false);
  inRoom.current = room !== null;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    // Say why the room vanished when it wasn't the player leaving it.
    const onClosed = (reason?: 'gone') => {
      if (reason === 'gone' && inRoom.current) toast(tRef.current.room.roomGone);
      setRoom(null);
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', setRoom);
    socket.on('room:closed', onClosed);
    socket.connect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', setRoom);
      socket.off('room:closed', onClosed);
    };
  }, []);

  // Keep the room code in the URL so a refresh or a shared link lands in the same room.
  const code = room?.code;
  useEffect(() => {
    if (code) setInviteCode('');
    const url = new URL(location.href);
    if (code) url.searchParams.set('room', code);
    else url.searchParams.delete('room');
    history.replaceState(null, '', url);
  }, [code]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <LogoMark />
          <span className="brand-name">{t.appName}</span>
          {room && (
            <span className="topbar-game">
              <span className="topbar-divider" />
              {t.games[room.gameType]}
              {(room.gameType === 'chess' || room.gameType === 'xiangqi') && (
                <span className="chip static">
                  {t.timeControls[room.options.timeControl]}
                  {room.gameType === 'xiangqi' && room.options.handicap !== 'none' && ` · ${t.xiangqi.handicaps[room.options.handicap]}`}
                </span>
              )}
              {room.gameType === 'tienlen' && <span className="chip static">{t.tienlen.turnTimers[room.options.turnTimer]}</span>}
            </span>
          )}
        </div>
        <div className="topbar-actions">
          <div className="lang-switch" role="group" aria-label={t.settings.language}>
            {LOCALES.map((l) => (
              <button key={l} aria-pressed={l === locale} onClick={() => setLocale(l)}>
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            className="icon-btn"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? t.settings.toLight : t.settings.toDark}
            title={theme === 'dark' ? t.settings.toLight : t.settings.toDark}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>
          <button
            className="icon-btn"
            onClick={() => {
              setSoundOn(!sound);
              setSound(!sound);
            }}
            aria-label={sound ? t.settings.soundOn : t.settings.soundOff}
            title={sound ? t.settings.soundOn : t.settings.soundOff}
          >
            {sound ? <SoundIcon /> : <MuteIcon />}
          </button>
          <span className={`conn-pill ${connected ? 'on' : 'off'}`} title={connected ? t.connected : t.connecting}>
            <span className="conn-dot" />
            <span className="conn-label">
              <Ellipsis text={connected ? t.connected : t.connecting} />
            </span>
          </span>
        </div>
      </header>
      <main>
        {room && !connected && (
          <div className="reconnect-banner" role="status">
            <Ellipsis text={t.room.reconnecting} />
          </div>
        )}
        {room ? <RoomScreen room={room} /> : <Lobby initialCode={inviteCode} connected={connected} />}
      </main>
      <footer className="footer">
        {t.appName} · {t.footer}
      </footer>
      <Toaster />
    </div>
  );
}
