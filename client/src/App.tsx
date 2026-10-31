import { useEffect, useState } from 'react';
import type { RoomView } from '@vg/shared';
import { socket } from './socket';
import { t } from './i18n';
import { Lobby } from './components/Lobby';
import { RoomScreen } from './components/RoomScreen';
import { Toaster } from './components/Toaster';
import { LogoMark } from './components/icons';

function roomCodeFromUrl(): string {
  return new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';
}

export function App() {
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
        </div>
        <span className={`conn-pill ${connected ? 'on' : 'off'}`}>
          <span className="conn-dot" />
          {connected ? t.connected : t.connecting}
        </span>
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
