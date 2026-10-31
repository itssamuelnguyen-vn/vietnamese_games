import { useEffect, useRef, useState } from 'react';
import { GAME_CATALOG, type ErrorCode, type GameType } from '@vg/shared';
import { api, playerId } from '../socket';
import { loadSetting, saveSetting } from '../settings';
import { useI18n } from '../i18n';
import { Avatar } from './Avatar';
import { CODE_LENGTH, CodeInput } from './CodeInput';
import { toast } from './Toaster';
import { GameArt, PlayIcon, SparkIcon, UsersIcon } from './icons';

interface Props {
  initialCode: string;
  connected: boolean;
}

export function Lobby({ initialCode, connected }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(() => loadSetting('vg:name') ?? '');
  const [code, setCode] = useState(initialCode.slice(0, CODE_LENGTH));
  const [busy, setBusy] = useState(false);
  const [nudgeName, setNudgeName] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const trimmedName = name.trim();

  async function run(action: () => Promise<{ ok: true } | { ok: false; error: ErrorCode }>): Promise<boolean> {
    if (!trimmedName) {
      toast(t.errors.NAME_REQUIRED);
      nameRef.current?.focus();
      setNudgeName(true);
      setTimeout(() => setNudgeName(false), 600);
      return false;
    }
    saveSetting('vg:name', trimmedName);
    setBusy(true);
    const r = await action();
    setBusy(false);
    if (!r.ok) toast(t.errors[r.error]);
    return r.ok;
  }

  const create = (type: GameType) => run(() => api.create(type, trimmedName));
  const join = () => run(() => api.join(code, trimmedName));

  // Opening an invite link with a remembered name joins straight away.
  const autoJoined = useRef(false);
  useEffect(() => {
    if (!connected || autoJoined.current || !initialCode || !trimmedName) return;
    autoJoined.current = true;
    // A stale invite (room closed or full) shouldn't leave its code sitting in the join box.
    join().then((ok) => {
      if (!ok) setCode('');
    });
  }, [connected]);

  return (
    <div className="lobby">
      <section className="hero">
        <div className="hero-text">
          <span className="kicker">
            <SparkIcon /> {t.hero.kicker}
          </span>
          <h1 className="hero-title">
            {t.hero.title} <span className="accent">{t.hero.titleAccent}</span>
          </h1>
          <p className="hero-subtitle">{t.hero.subtitle}</p>
          <div className="hero-pieces" aria-hidden="true">
            {Object.values(GAME_CATALOG).map((g) => (
              <span key={g.type} className={`hero-piece art-${g.type}`}>
                <GameArt type={g.type} />
              </span>
            ))}
          </div>
        </div>

        <div className="hero-panel card">
          <label className={`name-field ${nudgeName ? 'nudge' : ''}`}>
            <span className="field-label">{t.lobby.yourName}</span>
            <span className="name-row">
              <Avatar id={playerId} name={trimmedName || '?'} size={44} />
              <input
                ref={nameRef}
                value={name}
                maxLength={20}
                placeholder={t.lobby.namePlaceholder}
                onChange={(e) => setName(e.target.value)}
              />
            </span>
            <span className="field-hint">{t.lobby.nameHint}</span>
          </label>

          <div className="divider" />

          <form
            className="join-form"
            onSubmit={(e) => {
              e.preventDefault();
              join();
            }}
          >
            <span className="field-label">{t.lobby.joinTitle}</span>
            <span className="field-hint">{t.lobby.joinSubtitle}</span>
            <div className="join-row">
              <CodeInput value={code} onChange={setCode} />
              <button type="submit" className="btn btn-primary" disabled={busy || !connected || code.length !== CODE_LENGTH}>
                {t.lobby.join}
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="games">
        <header className="section-head">
          <h2>{t.lobby.chooseGame}</h2>
          <p>{t.lobby.chooseGameSubtitle}</p>
        </header>
        <div className="game-grid">
          {Object.values(GAME_CATALOG).map((g) => (
            <article key={g.type} className={`game-card art-${g.type} ${g.available ? '' : 'soon'}`}>
              <div className="game-art">
                <GameArt type={g.type} />
                {!g.available && <span className="ribbon">{t.lobby.comingSoon}</span>}
              </div>
              <div className="game-body">
                <h3>{t.games[g.type]}</h3>
                <p>{t.gameBlurbs[g.type]}</p>
                <div className="game-foot">
                  <span className="meta">
                    <UsersIcon /> {t.playerCount(g.minPlayers, g.maxPlayers)}
                  </span>
                  {g.available && (
                    <button className="btn btn-primary btn-sm" disabled={busy || !connected} onClick={() => create(g.type)}>
                      <PlayIcon /> {t.lobby.create}
                    </button>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="steps">
        <h2>{t.lobby.stepsTitle}</h2>
        <ol className="step-list">
          {t.lobby.steps.map((s, i) => (
            <li key={i} className="step">
              <span className="step-num">{i + 1}</span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
