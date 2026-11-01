import { audioContext, isSoundOn } from '../../sound';

// The lô tô caller's voice: one MP3 holding "Số một" … "Số chín mươi" back to back, and where each
// call starts and how long it lasts. Recorded once (synthesized with Piper, voice vi_VN-vais1000),
// so every device hears the same Vietnamese, whatever voices its browser has.
const SPRITE_URL = '/audio/loto-vi.mp3';
const CLIPS_URL = '/audio/loto-vi.json';

interface Calls {
  buffer: AudioBuffer;
  // [start, length] in seconds, for numbers 1 to 90.
  clips: [number, number][];
}

let loading: Promise<Calls | null> | null = null;
let current: AudioBufferSourceNode | null = null;

// Fetched and decoded once, on first need; a failed load is retried next time.
export function loadCalls(): Promise<Calls | null> {
  loading ??= (async () => {
    const ctx = audioContext();
    if (!ctx) return null;
    const [meta, audio] = await Promise.all([fetch(CLIPS_URL).then((r) => r.json()), fetch(SPRITE_URL).then((r) => r.arrayBuffer())]);
    return { buffer: await ctx.decodeAudioData(audio), clips: meta.clips } as Calls;
  })().catch(() => {
    loading = null;
    return null;
  });
  return loading;
}

// Says a number if the voice has loaded and sound is on; false if it couldn't (play a tick then).
// MP3 encoding shifts audio by a few hundredths of a second, which some browsers undo and some
// don't: each call starts a little early and runs a little long, into the silence between calls.
export function sayNumber(calls: Calls | null, n: number): boolean {
  const ctx = audioContext();
  const clip = calls?.clips[n - 1];
  if (!isSoundOn() || !ctx || !calls || !clip) return false;
  current?.stop();
  const source = ctx.createBufferSource();
  source.buffer = calls.buffer;
  source.connect(ctx.destination);
  source.start(0, Math.max(0, clip[0] - 0.02), clip[1] + 0.12);
  current = source;
  return true;
}
