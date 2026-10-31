import { useState } from 'react';
import { useI18n } from '../i18n';

export const CODE_LENGTH = 4;

interface Props {
  value: string;
  onChange: (value: string) => void;
}

// One real input (so typing, pasting and mobile keyboards just work) drawn as separate boxes.
export function CodeInput({ value, onChange }: Props) {
  const { t } = useI18n();
  const [focused, setFocused] = useState(false);
  const active = Math.min(value.length, CODE_LENGTH - 1);

  return (
    <div className="code-boxes">
      {Array.from({ length: CODE_LENGTH }, (_, i) => (
        <span key={i} className={`code-box ${value[i] ? 'filled' : ''} ${focused && i === active ? 'active' : ''}`}>
          {value[i] ?? ''}
        </span>
      ))}
      <input
        className="code-input-overlay"
        value={value}
        maxLength={CODE_LENGTH}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        aria-label={t.room.codeLabel}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH))}
      />
    </div>
  );
}
