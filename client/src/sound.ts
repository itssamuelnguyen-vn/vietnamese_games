import { loadSetting, saveSetting } from './settings';

export type SoundKind = 'move' | 'capture' | 'check' | 'end' | 'notify' | 'lowtime';

const STORAGE_KEY = 'vg:sound';
let enabled = loadSetting(STORAGE_KEY) !== 'off';
let ctx: AudioContext | null = null;

export function isSoundOn(): boolean {
  return enabled;
}

export function setSoundOn(on: boolean): void {
  enabled = on;
  saveSetting(STORAGE_KEY, on ? 'on' : 'off');
}

// [frequency Hz, start offset s, duration s] per note; synthesized so no audio files are needed.
const NOTES: Record<SoundKind, [number, number, number][]> = {
  move: [[440, 0, 0.07]],
  capture: [[220, 0, 0.12]],
  check: [
    [660, 0, 0.08],
    [880, 0.09, 0.1],
  ],
  end: [
    [523, 0, 0.15],
    [659, 0.15, 0.15],
    [784, 0.3, 0.3],
  ],
  notify: [
    [880, 0, 0.08],
    [660, 0.1, 0.08],
  ],
  lowtime: [[1000, 0, 0.05]],
};

// The app's one audio context, made on first use and woken if the browser suspended it (as phones
// do until the page has been touched). Null where Web Audio isn't available.
export function audioContext(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function playSound(kind: SoundKind): void {
  if (!enabled) return;
  try {
    ctx ??= new AudioContext();
    const start = ctx.currentTime;
    for (const [freq, offset, duration] of NOTES[kind]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind === 'capture' ? 'triangle' : 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, start + offset + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + offset);
      osc.stop(start + offset + duration + 0.02);
    }
  } catch {
    // Audio unavailable (autoplay policy, old browser): stay silent.
  }
}
