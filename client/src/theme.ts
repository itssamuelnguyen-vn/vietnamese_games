import { useEffect, useState } from 'react';
import { loadSetting, saveSetting } from './settings';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'vg:theme';
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

function savedTheme(): Theme | null {
  const saved = loadSetting(STORAGE_KEY);
  return saved === 'light' || saved === 'dark' ? saved : null;
}

// index.html applies the same logic before first paint to avoid a flash of the wrong theme.
export function useTheme() {
  const [explicit, setExplicit] = useState<Theme | null>(savedTheme);
  const [systemDark, setSystemDark] = useState(() => darkQuery().matches);
  const theme: Theme = explicit ?? (systemDark ? 'dark' : 'light');

  // Follow the OS setting until the player picks a theme themselves.
  useEffect(() => {
    const query = darkQuery();
    const onChange = () => setSystemDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    saveSetting(STORAGE_KEY, next);
    setExplicit(next);
  }

  return { theme, toggle };
}
