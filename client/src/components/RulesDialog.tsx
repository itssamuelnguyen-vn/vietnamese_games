import { useEffect, useState } from 'react';
import type { GameType, HouseRuleId } from '@vg/shared';
import { useI18n, type Strings } from '../i18n';
import { BookIcon, CloseIcon } from './icons';

interface RulesText {
  title: string;
  intro: string;
  sections: { title: string; items: string[] }[];
}

// Games that publish their house rules; others don't show the button.
function rulesFor(t: Strings, gameType: GameType, houseRules: HouseRuleId[]): RulesText | null {
  if (gameType === 'typhu') return { title: t.typhu.rulesTitle, intro: t.typhu.rulesIntro, sections: t.typhu.rules };
  if (gameType !== 'tienlen') return null;
  // The table's switched-on house rules are listed after the standard ones.
  const extra = {
    title: t.tienlen.extraRulesTitle,
    items: houseRules.length ? houseRules.map((r) => t.tienlen.houseRuleDetails[r]) : [t.tienlen.noExtraRules],
  };
  return { title: t.tienlen.rulesTitle, intro: t.tienlen.rulesIntro, sections: [...t.tienlen.rules, extra] };
}

export function RulesButton({ gameType, houseRules = [], wide = false }: { gameType: GameType; houseRules?: HouseRuleId[]; wide?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rules = rulesFor(t, gameType, houseRules);
  if (!rules) return null;
  return (
    <>
      <button className={`btn btn-secondary ${wide ? '' : 'btn-sm'}`} onClick={() => setOpen(true)}>
        <BookIcon /> {t.tienlen.rulesButton}
      </button>
      {open && <RulesDialog rules={rules} onClose={() => setOpen(false)} />}
    </>
  );
}

function RulesDialog({ rules, onClose }: { rules: RulesText; onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="rules-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2 id="rules-title">{rules.title}</h2>
          <button className="tool-btn" onClick={onClose} aria-label={t.room.close} title={t.room.close} autoFocus>
            <CloseIcon />
          </button>
        </header>
        <p className="muted">{rules.intro}</p>
        {rules.sections.map((section) => (
          <section key={section.title} className="rules-section">
            <h3>{section.title}</h3>
            <ul>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
