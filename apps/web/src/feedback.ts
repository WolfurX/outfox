/**
 * Input feedback — the §9 dispatcher (DESIGN-SYSTEM-WEB §9.1).
 *
 * Components emit semantic events; this module is the only place that touches
 * WebAudio or navigator.vibrate. Rules carried from the spec:
 *  - Audio cues on by default at low gain (cue bus −18 dB FS), every cue ≤ 150 ms,
 *    synthesized (no assets). The AudioContext is created on the first user gesture;
 *    until then every cue is a silent no-op.
 *  - Vibration is feature-detected (Android Chrome in practice), fires only after a
 *    user gesture, ≤ 3 pulses / 120 ms total, debounced 80 ms.
 *  - Both channels are suppressed under prefers-reduced-motion and each has its own
 *    persisted per-device toggle. Feedback is an enhancement layer: every event here
 *    has a visual twin in the UI, none is the sole signal.
 *  - RewardReveal weight scales amplitude, never length (§8.2 anti-anticipation).
 */

export type FxEvent =
  | 'press'      // primary button press
  | 'clean'      // successful Call / Gig
  | 'nicked'     // failed Call, Margin Called, error
  | 'warn'       // low Focus / Risk Appetite
  | 'select'     // tab switch — haptic only, silent by spec
  | 'fill'       // Market fill in the foreground
  | 'destroy';   // destructive confirm

type Prefs = { sound: boolean; haptics: boolean };

const KEY_SOUND = 'outfox.fx.sound';
const KEY_HAPTICS = 'outfox.fx.haptics';
const BUS_GAIN = 0.126; // −18 dB FS
const MAX_CUE_MS = 150;

function readPref(key: string): boolean {
  try { return localStorage.getItem(key) !== 'off'; } catch { return true; }
}
function writePref(key: string, on: boolean) {
  try { localStorage.setItem(key, on ? 'on' : 'off'); } catch { /* private mode */ }
}

const prefs: Prefs = { sound: readPref(KEY_SOUND), haptics: readPref(KEY_HAPTICS) };

let ctx: AudioContext | null = null;
let bus: GainNode | null = null;
let activated = false;      // sticky user activation
let lastBuzz = 0;
let lastBuzzEv: FxEvent | 'reveal' | null = null;

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Called on the first pointer/key gesture: unlock audio, mark activation. */
function activate() {
  activated = true;
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
  const AC = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  bus = ctx.createGain();
  bus.gain.value = BUS_GAIN;
  bus.connect(ctx.destination);
}
if (typeof window !== 'undefined') {
  const once = () => { activate(); window.removeEventListener('pointerdown', once); window.removeEventListener('keydown', once); };
  window.addEventListener('pointerdown', once, { passive: true });
  window.addEventListener('keydown', once);
}

/** One enveloped oscillator note. `gain` is relative to the bus (1 = −18 dB FS). */
function note(freq: number, ms: number, type: OscillatorType = 'sine', gain = 1, at = 0) {
  if (!ctx || !bus) return;
  const dur = Math.min(ms, MAX_CUE_MS) / 1000;
  const t0 = ctx.currentTime + at / 1000;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(bus);
  o.start(t0);
  o.stop(t0 + dur + 0.01);
}

// §9.1 audio column, all ≤ 150 ms
const CUES: Record<FxEvent, () => void> = {
  press: () => note(1200, 30),
  clean: () => { note(660, 45); note(990, 45, 'sine', 1, 45); },
  nicked: () => note(110, 120, 'sawtooth', 0.7),
  warn: () => { note(700, 30, 'triangle', 0.6); note(700, 30, 'triangle', 0.6, 50); },
  select: () => {},
  fill: () => note(1800, 60, 'square', 0.35),
  destroy: () => note(90, 100, 'triangle', 0.8),
};

// §9.1 vibration column (ms), ≤ 3 pulses / 120 ms total
const BUZZ: Record<FxEvent, number | number[]> = {
  press: 10, clean: 20, nicked: [30, 40, 30], warn: [20, 30], select: 5, fill: 15, destroy: 35,
};

function buzz(ev: FxEvent | 'reveal', pattern: number | number[]) {
  if (!activated || typeof navigator.vibrate !== 'function') return;
  const now = performance.now();
  // debounce repeats of the same event (double taps); a different event may follow
  // inside the window, e.g. the result landing right after the press on a fast link
  if (ev === lastBuzzEv && now - lastBuzz < 80) return;
  lastBuzz = now; lastBuzzEv = ev;
  navigator.vibrate(pattern);
}

export const fx = {
  /** Fire one semantic feedback event on both channels (each independently gated). */
  emit(ev: FxEvent) {
    if (reducedMotion()) return;
    if (prefs.sound) CUES[ev]();
    if (prefs.haptics) buzz(ev, BUZZ[ev]);
  },
  /** Reward weight by tier (§8.2): scales pulse length 15/25/40 ms and cue amplitude, never duration. */
  reveal(tier: 1 | 2 | 3) {
    if (reducedMotion()) return;
    if (prefs.sound) { const g = [0.6, 0.8, 1][tier - 1]; note(660, 45, 'sine', g); note(990, 45, 'sine', g, 45); }
    if (prefs.haptics) buzz('reveal', [15, 25, 40][tier - 1]);
  },
  prefs(): Prefs { return { ...prefs }; },
  set(patch: Partial<Prefs>) {
    if (patch.sound !== undefined) { prefs.sound = patch.sound; writePref(KEY_SOUND, patch.sound); }
    if (patch.haptics !== undefined) { prefs.haptics = patch.haptics; writePref(KEY_HAPTICS, patch.haptics); }
  },
};
