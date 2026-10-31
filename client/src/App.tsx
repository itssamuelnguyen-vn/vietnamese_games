import { useEffect, useState } from 'react';
import type { RoomView } from '@vg/shared';
import { socket } from './socket';
import { LOCALES, useI18n, type Locale } from './i18n';
import { useTheme } from './theme';
import { Lobby } from './components/Lobby';
import { RoomScreen } from './components/RoomScreen';
import { Toaster } from './components/Toaster';
import { LogoMark, MoonIcon, SunIcon } from './components/icons';

function roomCodeFromUrl(): string {
  return new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';
}

export function App() {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggle: toggleTheme } = useTheme();
  const [room, setRoom] = useState<RoomView | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  // Read once at page load: only an invite link should prefill the join box, not a room we just left.
  const [inviteCode, setInviteCode] = useState(roomCodeFromUrl);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onClosed = () => setRoom(null);
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
              {room.gameType === 'chess' && <span className="chip static">{t.timeControls[room.options.timeControl]}</span>}
            </span>
          )}
        </div>
        <div className="topbar-actions">
          <div className="lang-switch" role="group" aria-label={t.settings.language}>
            {(Object.keys(LOCALES) as Locale[]).map((l) => (
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
          <span className={`conn-pill ${connected ? 'on' : 'off'}`} title={connected ? t.connected : t.connecting}>
            <span className="conn-dot" />
            <span className="conn-label">{connected ? t.connected : t.connecting}</span>
          </span>
        </div>
      </header>
      <main>
        {room ? <RoomScreen room={room} /> : <Lobby initialCode={inviteCode} connected={connected} />}
      </main>
      <footer className="footer">
        {t.appName} · {t.footer}
      </footer>
      <Toaster />
    </div>
  );
}
