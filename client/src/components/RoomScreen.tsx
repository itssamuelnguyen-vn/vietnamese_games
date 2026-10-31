import { GAME_CATALOG, type ChessView, type RoomView, type XiangqiView } from '@vg/shared';
import { api } from '../socket';
import { useI18n } from '../i18n';
import { ChessGame } from '../games/ChessGame';
import { XiangqiGame } from '../games/xiangqi/XiangqiGame';
import { Avatar } from './Avatar';
import { Ellipsis } from './Ellipsis';
import { ChatCard, ChessOptionsPicker, copyInvite, inviteLink } from './RoomPanels';
import { startGame } from './roomActions';
import { CopyIcon, CrownIcon, ExitIcon, GameArt, PlayIcon, ShareIcon } from './icons';

interface Props {
  room: RoomView;
}

export function RoomScreen({ room }: Props) {
  const { t } = useI18n();
  function leave() {
    // Only players forfeit by leaving; spectators can just go.
    const seated = room.players.some((p) => p.id === room.you);
    if (room.status === 'playing' && seated && !confirm(t.room.confirmLeaveMidGame)) return;
    api.leave();
  }

  if (room.game === null) return <WaitingRoom room={room} onLeave={leave} />;

  if (room.gameType === 'chess') return <ChessGame room={room} view={room.game as ChessView} onLeave={leave} />;
  if (room.gameType === 'xiangqi') return <XiangqiGame room={room} view={room.game as XiangqiView} onLeave={leave} />;
  return null;
}

function WaitingRoom({ room, onLeave }: { room: RoomView; onLeave: () => void }) {
  const { t } = useI18n();
  const info = GAME_CATALOG[room.gameType];
  const isHost = room.hostId === room.you;
  const missing = Math.max(0, info.minPlayers - room.players.length);
  const gameName = t.games[room.gameType];
  const canShare = typeof navigator.share === 'function';

  async function share() {
    try {
      await navigator.share({ title: t.appName, text: t.room.shareText(gameName), url: inviteLink(room.code) });
    } catch {
      // User cancelled the share sheet.
    }
  }

  return (
    <div className="waiting">
      <header className={`waiting-head art-${room.gameType}`}>
        <span className="waiting-art">
          <GameArt type={room.gameType} />
        </span>
        <div>
          <p className="eyebrow">{t.room.waitingTitle}</p>
          <h1>{gameName}</h1>
        </div>
        <button className="btn btn-ghost" onClick={onLeave}>
          <ExitIcon /> {t.room.leave}
        </button>
      </header>

      <div className="waiting-grid">
        <section className="card invite-card">
          <p className="eyebrow">{t.room.codeLabel}</p>
          <div className="code-tiles" aria-label={room.code}>
            {room.code.split('').map((c, i) => (
              <span key={i} className="code-tile">
                {c}
              </span>
            ))}
          </div>
          <div className="invite-actions">
            <button className="btn btn-secondary" onClick={() => copyInvite(t, room.code)}>
              <CopyIcon /> {t.room.copyLink}
            </button>
            {canShare && (
              <button className="btn btn-secondary" onClick={share}>
                <ShareIcon /> {t.room.share}
              </button>
            )}
          </div>
        </section>

        <section className="card seats-card">
          <div className="seats-head">
            <h2>{t.room.players(room.players.length, info.maxPlayers)}</h2>
          </div>
          <ul className="seats">
            {Array.from({ length: info.maxPlayers }, (_, i) => {
              const p = room.players[i];
              if (!p) {
                return (
                  <li key={`empty-${i}`} className="seat empty">
                    <span className="seat-placeholder" />
                    <span className="seat-name">
                      <Ellipsis text={t.room.emptySeat} />
                    </span>
                  </li>
                );
              }
              return (
                <li key={p.id} className={`seat ${p.id === room.you ? 'me' : ''}`}>
                  <Avatar id={p.id} name={p.name} size={52} online={p.connected} />
                  <span className="seat-name">{p.name}</span>
                  <span className="seat-tags">
                    {p.id === room.hostId && (
                      <span className="tag tag-gold">
                        <CrownIcon /> {t.room.host}
                      </span>
                    )}
                    {p.id === room.you && <span className="tag">{t.room.you}</span>}
                    {!p.connected && <span className="tag tag-muted">{t.room.offline}</span>}
                  </span>
                </li>
              );
            })}
          </ul>

          <p className="spectator-line muted small">
            {t.room.spectators} · {room.spectators.length ? room.spectators.map((p) => p.name).join(', ') : t.room.noSpectators}
          </p>

          {(room.gameType === 'chess' || room.gameType === 'xiangqi') && <ChessOptionsPicker room={room} />}

          <div className="seats-foot">
            <p className={`seats-status ${missing === 0 ? 'ready' : ''}`}>
              <Ellipsis text={missing > 0 ? t.room.needMore(missing) : isHost ? t.room.ready : t.room.waitingForHost} />
            </p>
            {isHost && (
              <button className="btn btn-primary btn-lg" disabled={missing > 0} onClick={() => startGame(t)}>
                <PlayIcon /> {t.room.start}
              </button>
            )}
          </div>
        </section>

        <ChatCard room={room} />
      </div>
    </div>
  );
}
