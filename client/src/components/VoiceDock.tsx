import { useEffect } from 'react';
import type { RoomView } from '@vg/shared';
import { useI18n } from '../i18n';
import { useVoice, voice } from '../voice';
import { Avatar } from './Avatar';
import { toast } from './Toaster';

// The room's voice chat: a small bar pinned to the corner, on every screen of the room.
export function VoiceDock({ room }: { room: RoomView }) {
  const { t } = useI18n();
  const V = t.voice;
  const state = useVoice();

  useEffect(() => voice.sync(room), [room, state.joined]);
  // Leaving the room leaves its voice too.
  useEffect(() => () => voice.leave(), [room.code]);
  useEffect(() => {
    if (state.error) toast(V[state.error]);
  }, [state.error]);

  const people = [...room.players, ...room.spectators];
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? '…';
  const members = room.voice.members;

  if (!state.joined) {
    return (
      <div className="voice-dock">
        <button className="btn btn-secondary btn-sm" disabled={state.joining} onClick={() => void voice.join()}>
          🎙️ {state.joining ? V.joining : V.join}
        </button>
        {members.length > 0 && <span className="muted small">{V.inVoice(members.length)}</span>}
      </div>
    );
  }

  const silenced = members.length > 1 && room.voice.to.length === 0;
  return (
    <div className="voice-dock joined" role="group" aria-label={V.inVoice(members.length)}>
      <button
        className={`btn btn-sm btn-square voice-mic ${state.muted ? 'off' : ''}`}
        onClick={() => voice.toggleMute()}
        aria-pressed={state.muted}
        aria-label={state.muted ? V.unmute : V.mute}
        title={state.muted ? V.unmute : V.mute}
      >
        {state.muted ? '🔇' : '🎤'}
      </button>
      <ul className="voice-members">
        {members.map((id) => {
          const peer = id === room.you ? 'connected' : state.peers[id];
          const speaking = state.speaking.includes(id);
          const label = `${nameOf(id)}${speaking ? ` · ${V.speaking}` : peer === 'failed' ? ` · ${V.failed}` : peer !== 'connected' ? ` · ${V.connecting}` : ''}`;
          return (
            <li key={id} className={`${speaking ? 'speaking' : ''} ${peer === 'failed' ? 'failed' : peer !== 'connected' ? 'pending' : ''} ${room.voice.from.includes(id) || id === room.you ? '' : 'unheard'}`} title={label}>
              <Avatar id={id} name={nameOf(id)} size={28} />
              {peer === 'failed' && <span className="voice-warn">!</span>}
              <span className="sr-only">{label}</span>
            </li>
          );
        })}
      </ul>
      {silenced && <span className="voice-note small">{V.silenced}</span>}
      <button className="btn btn-ghost btn-sm" onClick={() => voice.leave()} title={V.leave}>
        📞 <span className="voice-leave-text">{V.leave}</span>
      </button>
    </div>
  );
}
