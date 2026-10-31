import { useEffect, useState } from 'react';
import type { RoomView } from '@vg/shared';
import { socket } from './socket';
import { t } from './i18n';
import { Lobby } from './components/Lobby';
import { RoomScreen } from './components/RoomScreen';

function roomCodeFromUrl(): string {
  return new URLSearchParams(location.search).get('room')?.toUpperCase() ?? '';
}

export function App() {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [connected, setConnected] = useState(socket.connected);

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
    const url = new URL(location.href);
    if (code) url.searchParams.set('room', code);
    else url.searchParams.delete('room');
    history.replaceState(null, '', url);
  }, [code]);

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="logo">{t.appName}</h1>
        <span className={`conn ${connected ? 'on' : 'off'}`}>{connected ? t.connected : t.connecting}</span>
      </header>
      <main>
        {room ? <RoomScreen room={room} /> : <Lobby initialCode={roomCodeFromUrl()} connected={connected} />}
      </main>
    </div>
  );
}
