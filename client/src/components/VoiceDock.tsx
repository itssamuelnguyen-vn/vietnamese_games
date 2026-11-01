import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { RoomView } from "@vg/shared";
import { useI18n } from "../i18n";
import { useVoice, voice } from "../voice";
import { Avatar } from "./Avatar";
import { toast } from "./Toaster";

// The room's voice chat: a small bar pinned to the corner, on every screen of the room.
export function VoiceDock({ room }: { room: RoomView }) {
  const { t } = useI18n();
  const V = t.voice;
  const state = useVoice();
  const [panel, setPanel] = useState<"settings" | string | null>(null);

  useEffect(() => voice.sync(room), [room, state.joined]);
  // Back in the room after a reload: back in its voice too.
  useEffect(() => {
    if (voice.wasIn(room.code)) void voice.join(room.code, { auto: true });
    // Leaving the room leaves its voice.
    return () => voice.leave();
  }, [room.code]);
  useEffect(() => {
    if (state.error) toast(V[state.error]);
  }, [state.error]);

  // Tell people when the game silences them (ma sói at night) and when they can talk again.
  const members = room.voice.members;
  const silenced =
    state.joined && members.length > 1 && room.voice.to.length === 0;
  const wasSilenced = useRef(silenced);
  useEffect(() => {
    if (
      silenced !== wasSilenced.current &&
      room.status === "playing" &&
      state.joined
    )
      toast(silenced ? `🤫 ${V.silenced}` : `🎙️ ${V.unsilenced}`);
    wasSilenced.current = silenced;
  }, [silenced]);

  const people = [...room.players, ...room.spectators];
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "…";
  const toggle = (which: string) =>
    setPanel((p) => (p === which ? null : which));
  useEffect(() => {
    if (panel !== "settings" && panel !== null && !members.includes(panel))
      setPanel(null);
  }, [members.join(), panel]);
  // Closing the settings ends a microphone test.
  useEffect(() => {
    if (panel !== "settings") voice.stopPreview();
  }, [panel]);

  return (
    <>
      {/* Room at the bottom of the page, so the bar never covers the last buttons. */}
      <div className="voice-dock-spacer" aria-hidden="true" />
      <div
        className={`voice-dock ${state.joined ? "joined" : ""}`}
        role="group"
        aria-label={V.inVoice(members.length)}
      >
        {state.joined ? (
          <>
            <button
              className={`btn btn-sm btn-square voice-mic ${state.muted ? "off" : ""}`}
              onClick={() => voice.toggleMute()}
              aria-pressed={state.muted}
              aria-label={state.muted ? V.unmute : V.mute}
              title={state.muted ? V.unmute : V.mute}
            >
              {state.muted ? "🔇" : "🎤"}
            </button>
            <ul className="voice-members">
              {members.map((id) => {
                const peer = id === room.you ? "connected" : state.peers[id];
                const speaking = state.speaking.includes(id);
                const quiet = (state.volumes[id] ?? 1) === 0;
                const status = speaking
                  ? V.speaking
                  : peer === "failed"
                    ? V.failed
                    : peer !== "connected"
                      ? V.connecting
                      : quiet
                        ? V.mutedForYou
                        : "";
                const label = `${nameOf(id)}${status ? ` · ${status}` : ""}`;
                const cls = [
                  speaking ? "speaking" : "",
                  peer === "failed"
                    ? "failed"
                    : peer !== "connected"
                      ? "pending"
                      : "",
                  room.voice.from.includes(id) || id === room.you
                    ? ""
                    : "unheard",
                ];
                return (
                  <li key={id} className={cls.join(" ")}>
                    <button
                      type="button"
                      className="voice-member"
                      title={label}
                      aria-label={label}
                      disabled={id === room.you}
                      onClick={() => toggle(id)}
                    >
                      <Avatar id={id} name={nameOf(id)} size={28} />
                      {peer === "failed" && (
                        <span className="voice-warn">!</span>
                      )}
                      {quiet && <span className="voice-warn quiet">🔇</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            {silenced && (
              <span
                className="voice-silenced"
                title={V.silenced}
                aria-label={V.silenced}
              >
                🤫<span className="voice-note small">{V.silenced}</span>
              </span>
            )}
          </>
        ) : (
          <>
            <button
              className="btn btn-secondary btn-sm"
              disabled={state.joining}
              onClick={() => void voice.join(room.code)}
            >
              🎙️ {state.joining ? V.joining : V.join}
            </button>
            {members.length > 0 && (
              <span className="muted small voice-count">
                {V.inVoice(members.length)}
              </span>
            )}
          </>
        )}
        <button
          className="btn btn-ghost btn-sm btn-square"
          aria-pressed={panel === "settings"}
          onClick={() => toggle("settings")}
          title={V.settings}
          aria-label={V.settings}
        >
          ⚙️
        </button>
        {state.joined && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => voice.leave()}
            title={V.leave}
          >
            📞<span className="voice-leave-text"> {V.leave}</span>
          </button>
        )}
        {panel === "settings" && <MicSettings onClose={() => setPanel(null)} />}
        {panel && panel !== "settings" && (
          <MemberVolume
            id={panel}
            name={nameOf(panel)}
            onClose={() => setPanel(null)}
          />
        )}
      </div>
    </>
  );
}

// Picking a microphone, with a live level meter to check it works (before joining too).
function MicSettings({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const V = t.voice;
  const state = useVoice();
  const live = state.joined || state.previewing;
  return (
    <section className="card voice-panel" aria-label={V.settings}>
      <header className="voice-panel-head">
        <strong>{V.settings}</strong>
        <button
          className="tool-btn"
          onClick={onClose}
          aria-label={t.room.close}
        >
          ×
        </button>
      </header>
      {state.mics.length > 0 && (
        <label className="voice-field">
          <span className="small muted">{V.micLabel}</span>
          <select
            value={state.micId ?? ""}
            onChange={(e) => void voice.setMic(e.target.value)}
          >
            {state.mics.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {live ? (
        <>
          <span className="small muted">{V.micTestHint}</span>
          <LevelMeter />
        </>
      ) : (
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => void voice.startPreview()}
        >
          🎚️ {V.micTest}
        </button>
      )}
      {state.previewing && (
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => voice.stopPreview()}
        >
          {V.micTestStop}
        </button>
      )}
    </section>
  );
}

function LevelMeter() {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setValue(voice.micLevel()), 100);
    return () => clearInterval(id);
  }, []);
  return (
    <div
      className="voice-meter"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={value}
    >
      <span style={{ "--level": value } as CSSProperties} />
    </div>
  );
}

// How loud one person plays for you.
function MemberVolume({
  id,
  name,
  onClose,
}: {
  id: string;
  name: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const V = t.voice;
  const state = useVoice();
  const volume = state.volumes[id] ?? 1;
  return (
    <section className="card voice-panel" aria-label={name}>
      <header className="voice-panel-head">
        <strong>{name}</strong>
        <button
          className="tool-btn"
          onClick={onClose}
          aria-label={t.room.close}
        >
          ×
        </button>
      </header>
      <label className="voice-field">
        <span className="small muted">
          {V.volume} · {Math.round(volume * 100)}%
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(volume * 100)}
          onChange={(e) => voice.setVolume(id, Number(e.target.value) / 100)}
        />
      </label>
      <button
        className="btn btn-secondary btn-sm"
        onClick={() => voice.setVolume(id, volume === 0 ? 1 : 0)}
      >
        {volume === 0 ? `🔊 ${V.unmuteFor}` : `🔇 ${V.muteFor}`}
      </button>
      <span className="small muted">{V.volumeNote}</span>
    </section>
  );
}
