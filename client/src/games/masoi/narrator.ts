import { audioContext, isSoundOn } from '../../sound';
import { loadSetting, saveSetting } from '../../settings';
import type { Locale } from '../../i18n';

// The ma sói narrator: one MP3 per language holding every line back to back, and where each starts
// and how long it lasts. Synthesized once with Piper (vi_VN-vais1000 and en_US-ljspeech voices),
// so every device hears the same voice.
export type NarratorLine =
  | 'intro'
  | 'night'
  | 'witch'
  | 'dawnDead'
  | 'dawnPeace'
  | 'hunter'
  | 'discuss'
  | 'vote'
  | 'defense'
  | 'verdict'
  | 'hanged'
  | 'spared'
  | 'noLynch'
  | 'village'
  | 'wolves';

interface Lines {
  buffer: AudioBuffer;
  clips: Record<NarratorLine, [number, number]>;
}

const KEY = 'vg:masoiNarrator';
const loading = new Map<Locale, Promise<Lines | null>>();
let current: AudioBufferSourceNode | null = null;

export const isNarratorOn = () => loadSetting(KEY) !== 'off';
export const setNarratorOn = (on: boolean) => saveSetting(KEY, on ? 'on' : 'off');

export function loadNarrator(locale: Locale): Promise<Lines | null> {
  let p = loading.get(locale);
  if (!p) {
    p = (async () => {
      const ctx = audioContext();
      if (!ctx) return null;
      const [meta, audio] = await Promise.all([fetch(`/audio/masoi-${locale}.json`).then((r) => r.json()), fetch(`/audio/masoi-${locale}.mp3`).then((r) => r.arrayBuffer())]);
      return { buffer: await ctx.decodeAudioData(audio), clips: meta.clips } as Lines;
    })().catch(() => {
      loading.delete(locale);
      return null;
    });
    loading.set(locale, p);
  }
  return p;
}

// Says a line (cutting off the one before) if sound and the narrator are on.
export async function narrate(locale: Locale, line: NarratorLine) {
  if (!isSoundOn() || !isNarratorOn()) return;
  const lines = await loadNarrator(locale);
  const ctx = audioContext();
  const clip = lines?.clips[line];
  if (!ctx || !lines || !clip) return;
  current?.stop();
  const source = ctx.createBufferSource();
  source.buffer = lines.buffer;
  source.connect(ctx.destination);
  source.start(0, Math.max(0, clip[0] - 0.02), clip[1] + 0.15);
  current = source;
}
