import { useState } from 'react';
import { GAME_CATALOG, type ChessView, type ErrorCode, type RoomView } from '@vg/shared';
import { api, playerId } from '../socket';
import { errorText, t } from '../i18n';
import { ChessGame } from '../games/ChessGame';

interface Props {
  room: RoomView;
}

export function RoomScreen({ room }: Props) {
  const [error, setError] = useState<ErrorCode | null>(null);
  const [copied, setCopied] = useState(false);
  const info = GAME_CATALOG[room.gameType];
  const isHost = room.hostId === playerId;
  const inviteLink = `${location.origin}/?room=${room.code}`;
  const names = Object.fromEntries(room.players.map((p) => [p.id, p.name]));

  async function start() {
    setError(null);
    const r = await api.start();
    if (!r.ok) setError(r.error);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The Clipboard API needs HTTPS; without it the user can copy from the link field.
    }
  }

  function leave() {
    if (room.status === 'playing' && !confirm(t.room.confirmLeaveMidGame)) return;
    api.leave();
  }

  return (
    <div className={`room ${room.game !== null ? 'has-game' : ''}`}>
      <aside className="room-side">
        <section className="card">
          <p className="muted">{t.games[room.gameType]}</p>
          <p className="room-code">{room.code}</p>
          <div className="invite">
            <input readOnly value={inviteLink} onFocus={(e) => e.target.select()} />
            <button className="secondary" onClick={copyLink}>
              {copied ? t.room.copied : t.room.copyLink}
            </button>
          </div>
        </section>

        <section className="card">
          <h2>{t.room.players(room.players.length, info.maxPlayers)}</h2>
          <ul className="players">
            {room.players.map((p) => (
              <li key={p.id}>
                <span className={`dot ${p.connected ? 'on' : 'off'}`} title={p.connected ? t.room.online : t.room.offline} />
                <span>{p.name}</span>
                {p.id === playerId && <span className="muted">{t.room.you}</span>}
                {p.id === room.hostId && <span className="badge">{t.room.host}</span>}
              </li>
            ))}
          </ul>

          {room.status !== 'playing' &&
            (isHost ? (
              <button disabled={room.players.length < info.minPlayers} onClick={start}>
                {room.status === 'finished' ? t.room.playAgain : t.room.start}
              </button>
            ) : (
              <p className="muted">{t.room.waitingForHost}</p>
            ))}
          {room.status === 'waiting' && room.players.length < info.minPlayers && (
            <p className="muted">{t.room.inviteHint}</p>
          )}
          {error && <p className="error">{errorText(error)}</p>}
        </section>

        <button className="secondary" onClick={leave}>
          {t.room.leave}
        </button>
      </aside>

      <section className="room-game">
        {room.game !== null && room.gameType === 'chess' && (
          <ChessGame view={room.game as ChessView} names={names} />
        )}
        {room.game === null && <div className="placeholder">{t.room.boardPlaceholder}</div>}
      </section>
    </div>
  );
}
