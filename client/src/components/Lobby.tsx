import { useEffect, useRef, useState } from 'react';
import { GAME_CATALOG, type ErrorCode, type GameType } from '@vg/shared';
import { api, loadSetting, saveSetting } from '../socket';
import { errorText, t } from '../i18n';

interface Props {
  initialCode: string;
  connected: boolean;
}

export function Lobby({ initialCode, connected }: Props) {
  const [name, setName] = useState(() => loadSetting('vg:name') ?? '');
  const [code, setCode] = useState(initialCode);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [busy, setBusy] = useState(false);

  const trimmedName = name.trim();

  async function run(action: () => Promise<{ ok: true } | { ok: false; error: ErrorCode }>) {
    if (!trimmedName) {
      setError('NAME_REQUIRED');
      return;
    }
    saveSetting('vg:name', trimmedName);
    setBusy(true);
    setError(null);
    const r = await action();
    setBusy(false);
    if (!r.ok) setError(r.error);
  }

  const create = (type: GameType) => run(() => api.create(type, trimmedName));
  const join = () => run(() => api.join(code, trimmedName));

  // Opening an invite link with a remembered name joins straight away.
  const autoJoined = useRef(false);
  useEffect(() => {
    if (!connected || autoJoined.current || !initialCode || !trimmedName) return;
    autoJoined.current = true;
    join();
  }, [connected]);

  return (
    <div className="lobby">
      <section className="card">
        <label className="field">
          <span>{t.lobby.yourName}</span>
          <input
            value={name}
            maxLength={20}
            placeholder={t.lobby.namePlaceholder}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
      </section>

      <section className="card">
        <h2>{t.lobby.joinExisting}</h2>
        <form
          className="join-row"
          onSubmit={(e) => {
            e.preventDefault();
            join();
          }}
        >
          <input
            className="code-input"
            value={code}
            maxLength={4}
            placeholder={t.lobby.codePlaceholder}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
          />
          <button type="submit" disabled={busy || !connected || code.length !== 4}>
            {t.lobby.join}
          </button>
        </form>
      </section>

      <section>
        <h2>{t.lobby.createNew}</h2>
        <div className="game-grid">
          {Object.values(GAME_CATALOG).map((g) => (
            <div key={g.type} className={`game-card ${g.available ? '' : 'soon'}`}>
              <div>
                <h3>{t.games[g.type]}</h3>
                <p>{t.playerCount(g.minPlayers, g.maxPlayers)}</p>
              </div>
              {g.available ? (
                <button disabled={busy || !connected} onClick={() => create(g.type)}>
                  {t.lobby.create}
                </button>
              ) : (
                <span className="badge">{t.lobby.comingSoon}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {error && <p className="error">{errorText(error)}</p>}
    </div>
  );
}
