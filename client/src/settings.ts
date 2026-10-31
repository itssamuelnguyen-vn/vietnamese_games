// localStorage can be blocked (private mode, locked-down browsers), so always guard it.
export function loadSetting(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function saveSetting(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not persisting is fine; it only loses a convenience.
  }
}
