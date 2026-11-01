import { useEffect, useState, type ReactNode } from 'react';
import QRCode from 'qrcode';
import { CANGUA_RULES, CARO_SIZE_IDS, GAME_CATALOG, STAKES, STAKES_PER_POINT, WALLET_STARTS, type CaNguaRuleId, HANDICAPS, HOUSE_RULES, TIME_CONTROLS, TURN_TIMERS, type HostColor, type HouseRuleId, type RoomOptions, type RoomView, type TimeControlId, type TurnTimerId } from '@vg/shared';
import { api } from '../socket';
import { useI18n, type Strings } from '../i18n';
import { Avatar } from './Avatar';
import { toast } from './Toaster';
import { ChevronRightIcon, CopyIcon, CrownIcon, QrIcon } from './icons';
import { loadSetting, saveSetting } from '../settings';

// The host fills or frees seats with bots between games.
export async function addBot(t: Strings) {
  const r = await api.addBot();
  if (!r.ok) toast(t.errors[r.error]);
}

export async function removeBot(t: Strings, id: string) {
  const r = await api.removeBot(id);
  if (!r.ok) toast(t.errors[r.error]);
}

export function inviteLink(code: string) {
  return `${location.origin}/?room=${code}`;
}

export async function copyInvite(t: Strings, code: string) {
  try {
    await navigator.clipboard.writeText(inviteLink(code));
    toast(t.room.linkCopied);
  } catch {
    // The Clipboard API needs HTTPS; fall back to letting the user copy from a prompt.
    prompt(t.room.copyLink, inviteLink(code));
  }
}

export function RoomCodeCard({ code }: { code: string }) {
  const { t } = useI18n();
  const [qr, setQr] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    if (!showQr || qr) return;
    QRCode.toDataURL(inviteLink(code), { margin: 1, width: 240 }).then(setQr, () => setShowQr(false));
  }, [showQr, qr, code]);

  return (
    <section className="card panel code-card">
      <p className="eyebrow">{t.room.codeLabel}</p>
      <div className="code-tiles sm">
        {code.split('').map((c, i) => (
          <span key={i} className="code-tile">
            {c}
          </span>
        ))}
      </div>
      <div className="code-card-actions">
        <button className="btn btn-primary" onClick={() => copyInvite(t, code)}>
          <CopyIcon /> {t.room.copyLink}
        </button>
        <button
          className="btn btn-secondary btn-square"
          aria-pressed={showQr}
          aria-label={t.room.showQr}
          title={t.room.showQr}
          onClick={() => setShowQr((v) => !v)}
        >
          <QrIcon />
        </button>
      </div>
      {showQr && qr && <img className="qr" src={qr} alt={t.room.qrAlt} width={160} height={160} />}
    </section>
  );
}

interface PlayersCardProps {
  room: RoomView;
  // Extra line under each player's name, e.g. their colour in chess.
  subtitle?: (playerId: string) => ReactNode;
  // Per-player colours when a game draws players in fixed colours.
  colorOf?: (playerId: string) => string | undefined;
}

export function PlayersCard({ room, subtitle, colorOf }: PlayersCardProps) {
  const { t } = useI18n();
  const info = GAME_CATALOG[room.gameType];
  return (
    <section className="card panel">
      <header className="panel-head">
        <h2>{t.room.playersTitle}</h2>
        <span className="muted">
          {room.players.length}/{info.maxPlayers}
        </span>
      </header>
      <ul className="player-list">
        {room.players.map((p) => (
          <li key={p.id} className={p.id === room.you ? 'me' : ''}>
            <Avatar id={p.id} name={p.name} size={40} online={p.connected} color={colorOf?.(p.id)} />
            <div className="player-list-text">
              <span className="player-list-name">
                {p.name} {p.id === room.you && <span className="muted">{t.room.youSuffix}</span>}
              </span>
              <span className="player-list-sub">
                {subtitle && <span className="muted small">{subtitle(p.id)}</span>}
                {p.id === room.hostId && (
                  <span className="tag tag-gold">
                    <CrownIcon /> {t.room.host}
                  </span>
                )}
                {p.bot && <span className="tag">🤖 {t.room.botTag}</span>}
              </span>
            </div>
            {p.bot && room.hostId === room.you && room.status !== 'playing' && (
              <button className="seat-remove" onClick={() => removeBot(t, p.id)} aria-label={t.room.removeBot} title={t.room.removeBot}>
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {info.bots && room.hostId === room.you && room.status !== 'playing' && room.players.length < info.maxPlayers && (
        <button className="btn btn-secondary btn-sm" onClick={() => addBot(t)}>
          🤖 {t.room.addBot}
        </button>
      )}
      <p className="spectator-line muted small">
        {t.room.spectators} · {room.spectators.length ? room.spectators.map((s) => s.name).join(', ') : t.room.noSpectators}
      </p>
    </section>
  );
}

export function ChessOptionsPicker({ room }: { room: RoomView }) {
  const { t } = useI18n();
  const locked = room.hostId !== room.you || room.status === 'playing';

  async function set(options: Partial<RoomOptions>) {
    const r = await api.options(options);
    if (!r.ok) toast(t.errors[r.error]);
  }

  return (
    <>
      <ChipGroup
        label={t.room.timeControl}
        options={Object.keys(TIME_CONTROLS) as TimeControlId[]}
        value={room.options.timeControl}
        labelOf={(id) => t.timeControls[id]}
        disabled={locked}
        onPick={(timeControl) => set({ timeControl })}
      />
      <ChipGroup
        label={t.room.hostColor}
        options={['random', 'white', 'black'] as HostColor[]}
        value={room.options.hostColor}
        labelOf={(c) => (room.gameType === 'xiangqi' ? t.xiangqi.hostColors[c] : room.gameType === 'caro' ? t.caro.hostColors[c] : t.room.hostColors[c])}
        disabled={locked}
        onPick={(hostColor) => set({ hostColor })}
      />
      {room.gameType === 'caro' && (
        <>
          <ChipGroup
            label={t.caro.sizeLabel}
            options={CARO_SIZE_IDS}
            value={room.options.caroSize}
            labelOf={(id) => t.caro.sizes[id]}
            disabled={locked}
            onPick={(caroSize) => set({ caroSize })}
          />
          <ChipGroup
            label={t.caro.blockLabel}
            options={['on', 'off'] as ('on' | 'off')[]}
            value={room.options.caroBlock ? 'on' : 'off'}
            labelOf={(v) => (v === 'on' ? t.caro.blockOn : t.caro.blockOff)}
            disabled={locked}
            onPick={(v) => set({ caroBlock: v === 'on' })}
          />
        </>
      )}
      {room.gameType === 'xiangqi' && (
        <ChipGroup
          label={t.xiangqi.handicapLabel}
          options={HANDICAPS}
          value={room.options.handicap}
          labelOf={(h) => t.xiangqi.handicaps[h]}
          disabled={locked}
          onPick={(handicap) => set({ handicap })}
        />
      )}
    </>
  );
}

export function TienLenOptionsPicker({ room }: { room: RoomView }) {
  const { t } = useI18n();
  const locked = room.hostId !== room.you || room.status === 'playing';

  async function set(options: Partial<RoomOptions>) {
    const r = await api.options(options);
    if (!r.ok) toast(t.errors[r.error]);
  }

  const rules = room.options.houseRules;
  const toggle = (rule: HouseRuleId) => set({ houseRules: rules.includes(rule) ? rules.filter((r) => r !== rule) : [...rules, rule] });

  return (
    <>
      <TurnTimerPicker room={room} locked={locked} />
      <StakesPicker room={room} locked={locked} onSet={set} />
      <div className="time-picker">
        <span className="field-label">{t.tienlen.houseRulesLabel}</span>
        <div className="chip-group" role="group" aria-label={t.tienlen.houseRulesLabel}>
          {HOUSE_RULES.map((rule) => (
            <button key={rule} className="chip toggle" aria-pressed={rules.includes(rule)} disabled={locked} onClick={() => toggle(rule)}>
              {t.tienlen.houseRules[rule]}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// Points or play money, and for play money the starting wallet and the stake per point.
function StakesPicker({ room, locked, onSet }: { room: RoomView; locked: boolean; onSet: (options: Partial<RoomOptions>) => void }) {
  const { t } = useI18n();
  const o = room.options;
  const amounts = (label: string, values: number[], value: number, key: 'walletStart' | 'stakePerPoint') => (
    <div className="time-picker">
      <span className="field-label">{label}</span>
      <div className="chip-group" role="group" aria-label={label}>
        {values.map((v) => (
          <button key={v} className="chip" aria-pressed={value === v} disabled={locked} onClick={() => onSet({ [key]: v })}>
            {t.typhu.money(v)}
          </button>
        ))}
      </div>
    </div>
  );
  return (
    <>
      <ChipGroup label={t.room.stakesLabel} options={STAKES} value={o.stakes} labelOf={(s) => t.room.stakes[s]} disabled={locked} onPick={(stakes) => onSet({ stakes })} />
      {o.stakes === 'money' && (
        <>
          {amounts(t.room.walletStartLabel, WALLET_STARTS, o.walletStart, 'walletStart')}
          {amounts(t.room.stakePerPointLabel, STAKES_PER_POINT, o.stakePerPoint, 'stakePerPoint')}
          <p className="muted small stakes-note">{t.room.moneyNote}</p>
        </>
      )}
    </>
  );
}

interface ChipGroupProps<T extends string> {
  label: string;
  options: T[];
  value: T;
  labelOf: (option: T) => string;
  disabled: boolean;
  onPick: (option: T) => void;
}

function ChipGroup<T extends string>({ label, options, value, labelOf, disabled, onPick }: ChipGroupProps<T>) {
  return (
    <div className="time-picker">
      <span className="field-label">{label}</span>
      <div className="chip-group" role="group" aria-label={label}>
        {options.map((option) => (
          <button key={option} className="chip" aria-pressed={value === option} disabled={disabled} onClick={() => onPick(option)}>
            {labelOf(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

// The chat lives in its own module; re-exported so game screens keep importing it from here.
export { ChatCard } from './Chat';

// Running scores across the games played in this room; collapsible, remembered per browser.
export function ScoreboardPanel({ room }: { room: RoomView }) {
  const { t } = useI18n();
  const me = room.you;
  const [open, setOpen] = useState(() => loadSetting('vg:scores') !== 'closed');
  function toggle() {
    saveSetting('vg:scores', open ? 'closed' : 'open');
    setOpen(!open);
  }
  // Playing for money, the wallets are the score: everyone at the table, richest first.
  const wallets = room.wallets;
  const rows = wallets
    ? Object.entries(wallets)
        .map(([id, wallet]) => {
          const entry = room.tally.find((e) => e.id === id);
          const name = [...room.players, ...room.spectators].find((p) => p.id === id)?.name ?? entry?.name ?? '?';
          return { id, name, games: entry?.games ?? 0, wins: entry?.wins ?? 0, points: wallet };
        })
        .sort((a, b) => b.points - a.points)
    : room.tally;
  if (rows.length === 0 || (!wallets && room.tally.length === 0)) return null;
  return (
    <section className={`card panel tl-score-panel ${open ? 'open' : 'closed'}`}>
      <button className="panel-toggle" aria-expanded={open} onClick={toggle} title={open ? t.room.hideScoreboard : t.room.showScoreboard}>
        <h2>{t.room.scoreboard}</h2>
        <ChevronRightIcon className="panel-chevron" />
      </button>
      {open && (
        <table className="tl-scores">
          <thead>
            <tr>
              <th />
              <th />
              <th>{t.room.scoreGames}</th>
              <th>{t.room.scoreWins}</th>
              <th>{wallets ? t.room.wallet : t.room.scorePoints}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((entry, i) => (
              <tr key={entry.id} className={entry.id === me ? 'mine' : ''}>
                <td className="muted">{i + 1}</td>
                <td className="tl-scores-name">{entry.id === me ? t.room.you : entry.name}</td>
                <td>{entry.games}</td>
                <td>{entry.wins}</td>
                {wallets ? (
                  <td className={entry.points === 0 ? 'down' : ''}>{entry.points === 0 ? t.room.broke : t.typhu.money(entry.points)}</td>
                ) : (
                  <td className={entry.points > 0 ? 'up' : entry.points < 0 ? 'down' : ''}>
                    {entry.points > 0 ? '+' : ''}
                    {entry.points}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// Per-turn time limit for turn-based games without a chess clock.
function TurnTimerPicker({ room, locked }: { room: RoomView; locked: boolean }) {
  const { t } = useI18n();
  async function set(options: Partial<RoomOptions>) {
    const r = await api.options(options);
    if (!r.ok) toast(t.errors[r.error]);
  }
  return (
    <ChipGroup
      label={t.tienlen.turnTimer}
      options={Object.keys(TURN_TIMERS) as TurnTimerId[]}
      value={room.options.turnTimer}
      labelOf={(id) => t.tienlen.turnTimers[id]}
      disabled={locked}
      onPick={(turnTimer) => set({ turnTimer })}
    />
  );
}

// Co ti phu and the word chain games only have a turn timer to choose.
export function TyPhuOptionsPicker({ room }: { room: RoomView }) {
  return <TurnTimerPicker room={room} locked={room.hostId !== room.you || room.status === 'playing'} />;
}

// Co ca ngua: a turn timer and optional house rules.
export function CaNguaOptionsPicker({ room }: { room: RoomView }) {
  const { t } = useI18n();
  const locked = room.hostId !== room.you || room.status === 'playing';
  const rules = room.options.caNguaRules;
  async function toggle(rule: CaNguaRuleId) {
    const r = await api.options({ caNguaRules: rules.includes(rule) ? rules.filter((x) => x !== rule) : [...rules, rule] });
    if (!r.ok) toast(t.errors[r.error]);
  }
  return (
    <>
      <TurnTimerPicker room={room} locked={locked} />
      <div className="time-picker">
        <span className="field-label">{t.cangua.rulesLabel}</span>
        <div className="chip-group" role="group" aria-label={t.cangua.rulesLabel}>
          {CANGUA_RULES.map((rule) => (
            <button key={rule} className="chip toggle" aria-pressed={rules.includes(rule)} disabled={locked} onClick={() => toggle(rule)}>
              {t.cangua.rules[rule]}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
