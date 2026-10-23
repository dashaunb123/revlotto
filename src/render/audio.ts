// WebAudio synth: no sound files. Engine drone + one-shot effects. One context and master for the whole game
// (menu blips in ui.ts play through audioOut()). M toggles mute everywhere via initGlobalMuteKey().
import type { InstalledPart, SlotId, Tier } from '../core/types';
import { partById } from '../data/content';
import { activeParagon } from '../game/brands';
const MUTE_KEY = 'revlotto_muted';
const VOL = 0.22;

let ctx: BaseAudioContext | null = null;
let live: AudioContext | null = null; // the real context (ctx is swapped for an offline one by renderOffline)
let master: GainNode | null = null;
let muted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === '1';
} catch {
  /* storage blocked */
}

function ac(): BaseAudioContext | null {
  if (!ctx) {
    try {
      const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const c = new C();
      // Gentle limiter so stacked sounds (shift + crackle + stinger) squash instead of clipping.
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.knee.value = 6;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      master = c.createGain();
      master.gain.value = muted ? 0 : VOL;
      master.connect(comp).connect(c.destination);
      ctx = live = c;
    } catch {
      return null;
    }
  }
  if (ctx === live && live.state === 'suspended') live.resume().catch(() => {});
  return ctx;
}

/** Call from any user input handler so the context can start. */
export function unlockAudio() {
  ac();
}

/** The shared context and master gain, for other modules' sounds (menu blips). Null if audio is unavailable. */
export function audioOut(): { ctx: BaseAudioContext; out: AudioNode } | null {
  const c = ac();
  return c && master ? { ctx: c, out: master } : null;
}

const duckCbs = new Set<(sec: number) => void>();

/** Ask the music to get out of the way for `sec` seconds (muffle + dip, then swell back). */
export function duck(sec: number) {
  duckCbs.forEach((cb) => cb(sec));
}

/** Subscribe to duck requests (music.ts). Returns an unsubscribe function. */
export function onDuck(cb: (sec: number) => void): () => void {
  duckCbs.add(cb);
  return () => duckCbs.delete(cb);
}

export function isMuted() {
  return muted;
}

const muteCbs = new Set<(muted: boolean) => void>();

export function toggleMute(): boolean {
  muted = !muted;
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* ignore */
  }
  const c = ac();
  if (c && master) master.gain.setTargetAtTime(muted ? 0 : VOL, c.currentTime, 0.02);
  muteCbs.forEach((cb) => {
    try {
      cb(muted);
    } catch {
      /* a listener's problem */
    }
  });
  return muted;
}

/** Subscribe to mute toggles (e.g. to show SOUND OFF). Returns an unsubscribe function. */
export function onMuteChange(cb: (muted: boolean) => void): () => void {
  muteCbs.add(cb);
  return () => muteCbs.delete(cb);
}

let muteKeyBound = false;
/** Binds M to toggleMute on window once, for every scene. Called from main.ts. */
export function initGlobalMuteKey() {
  if (muteKeyBound) return;
  muteKeyBound = true;
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'm' && e.key !== 'M')) return;
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    toggleMute();
  });
}

let noiseBuf: AudioBuffer | null = null;
function noise(c: BaseAudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 1, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/** Disconnect a one-shot's chain once it has played. */
function done(src: AudioScheduledSourceNode, ...nodes: AudioNode[]) {
  src.onended = () => {
    src.disconnect();
    nodes.forEach((n) => n.disconnect());
  };
}

function tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.3, when = 0, slideTo?: number) {
  const c = ac();
  if (!c || !master) return;
  const t0 = c.currentTime + when;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
  done(o, g);
}

function noiseHit(
  dur: number,
  freq: number,
  q: number,
  vol: number,
  when = 0,
  sweepTo?: number,
  attack = 0.01,
  type: BiquadFilterType = 'bandpass',
) {
  const c = ac();
  if (!c || !master) return;
  const t0 = c.currentTime + when;
  const s = c.createBufferSource();
  s.buffer = noise(c);
  s.loop = true;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t0);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t0, Math.random() * 0.9);
  s.stop(t0 + dur + 0.05);
  done(s, f, g);
}

/** Oscillator through [time, freq] points; rises over `attack`, fades over the last `release`. Optional lowpass. */
function sweep(type: OscillatorType, pts: [number, number][], vol: number, when = 0, attack = 0.01, release = 0.1, lp?: number) {
  const c = ac();
  if (!c || !master) return;
  const t0 = c.currentTime + when;
  const end = pts[pts.length - 1][0];
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(pts[0][1], t0);
  for (const [t, f] of pts.slice(1)) o.frequency.exponentialRampToValueAtTime(f, t0 + t);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + attack);
  g.gain.setValueAtTime(vol, t0 + Math.max(attack, end - release));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + end);
  let tail: AudioNode = g;
  if (lp) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = lp;
    g.connect(f);
    tail = f;
  }
  o.connect(g);
  tail.connect(master);
  o.start(t0);
  o.stop(t0 + end + 0.02);
  done(o, g, tail);
}

// ---- building blocks for the richer sounds ----

/** One exhaust pop: a tiny noise crack with a low thump under it. */
function pop(vol: number, when = 0) {
  noiseHit(0.025 + Math.random() * 0.035, 450 + Math.random() * 1000, 0.9, vol, when, undefined, 0.002);
  tone(55 + Math.random() * 45, 0.05, 'sine', vol * 0.35, when, 32);
}

function crackle(n: number, span: number, vol: number, when = 0) {
  for (let i = 0; i < n; i++) pop(vol * (0.6 + Math.random() * 0.4), when + Math.random() * span);
}

/** Turbo blow-off valve: a bright pssh falling in pitch. */
function blowOff(vol: number, when = 0) {
  noiseHit(0.34, 3400, 1, vol, when, 900, 0.004);
  noiseHit(0.12, 6500, 0.8, vol * 0.5, when, 4000, 0.003, 'highpass');
}

function ratchet(clicks: number, gap: number, pitch: number, when = 0) {
  for (let i = 0; i < clicks; i++) {
    noiseHit(0.018, pitch * (0.95 + Math.random() * 0.1), 6, 1.2, when + i * gap, undefined, 0.001);
    tone(pitch * 0.5, 0.012, 'square', 0.03, when + i * gap);
  }
}

function clunk(freq: number, vol: number, when = 0) {
  tone(freq, 0.16, 'sine', vol, when, freq * 0.5);
  noiseHit(0.08, freq * 4, 1, vol * 1.4, when, undefined, 0.002);
  tone(freq * 2.1, 0.05, 'square', vol * 0.15, when);
}

function shimmer(when: number, dur: number, vol: number) {
  for (let i = 0; i < 10; i++) tone(2400 + Math.random() * 2600, 0.08, 'triangle', vol, when + (i / 10) * dur);
  noiseHit(dur, 8000, 0.7, vol * 2, when, 11000, 0.05, 'highpass');
}

/** Spring boing: a sine whose pitch wobbles and dies away. */
function boing(when: number) {
  const c = ac();
  if (!c || !master) return;
  const t0 = c.currentTime + when;
  const o = c.createOscillator();
  o.type = 'triangle';
  o.frequency.value = 170;
  const lfo = c.createOscillator();
  lfo.frequency.value = 14;
  const depth = c.createGain();
  depth.gain.setValueAtTime(70, t0);
  depth.gain.exponentialRampToValueAtTime(4, t0 + 0.4);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.18, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
  lfo.connect(depth).connect(o.frequency);
  o.connect(g).connect(master);
  o.start(t0);
  lfo.start(t0);
  o.stop(t0 + 0.42);
  lfo.stop(t0 + 0.42);
  done(o, g);
  done(lfo, depth);
}

/** Missed shift: gears grinding (noise chopped at ~38 Hz over a sagging buzz). */
function grind(when = 0) {
  const c = ac();
  if (!c || !master) return;
  const t0 = c.currentTime + when;
  const dur = 0.32;
  const s = c.createBufferSource();
  s.buffer = noise(c);
  s.loop = true;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 1300;
  f.Q.value = 2;
  const am = c.createGain();
  am.gain.value = 0.5;
  const lfo = c.createOscillator();
  lfo.type = 'square';
  lfo.frequency.value = 38;
  const lfoG = c.createGain();
  lfoG.gain.value = 0.5;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(1.1, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  lfo.connect(lfoG).connect(am.gain);
  s.connect(f).connect(am).connect(g).connect(master);
  s.start(t0, Math.random() * 0.9);
  lfo.start(t0);
  s.stop(t0 + dur + 0.03);
  lfo.stop(t0 + dur + 0.03);
  done(s, f, am, g);
  done(lfo, lfoG);
  tone(78, dur, 'sawtooth', 0.09, when, 45);
}

/** Per-slot install sound. Returns when (s) the tier stinger should come in. */
const INSTALL: Record<SlotId, () => number> = {
  forced_induction() {
    sweep('sine', [[0, 1600], [0.42, 5200]], 0.06, 0, 0.38, 0.03);
    noiseHit(0.42, 1500, 2, 0.5, 0, 4500, 0.35);
    blowOff(1, 0.42);
    return 0.55;
  },
  exhaust() {
    sweep('sawtooth', [[0, 58], [0.5, 42]], 0.14, 0, 0.02, 0.2, 320);
    [0, 0.08, 0.13, 0.24, 0.29, 0.4].forEach((t, i) => pop(i % 2 ? 0.8 : 1.1, t));
    return 0.45;
  },
  nitrous() {
    tone(2000, 0.015, 'square', 0.08);
    noiseHit(0.7, 3200, 0.7, 0.35, 0.02, 2200, 0.015, 'highpass');
    return 0.5;
  },
  tires() {
    sweep('triangle', [[0, 1300], [0.06, 1900], [0.14, 1400]], 0.12, 0, 0.01, 0.05);
    sweep('triangle', [[0, 1400], [0.05, 2000], [0.12, 1500]], 0.1, 0.16, 0.01, 0.05);
    tone(85, 0.22, 'sine', 0.5, 0.32, 45);
    noiseHit(0.09, 180, 0.8, 0.9, 0.32, undefined, 0.002);
    return 0.5;
  },
  engine() {
    sweep('sawtooth', [[0, 45], [0.22, 150], [0.6, 55]], 0.16, 0, 0.02, 0.2, 900);
    sweep('square', [[0, 22.5], [0.22, 75], [0.6, 27]], 0.12, 0, 0.02, 0.2, 500);
    return 0.5;
  },
  intake() {
    noiseHit(0.45, 300, 2.5, 1.2, 0, 2600, 0.3);
    tone(90, 0.1, 'sine', 0.35, 0.42, 50);
    return 0.5;
  },
  aero() {
    noiseHit(0.35, 500, 0.8, 0.8, 0, 1600, 0.25);
    noiseHit(0.35, 1600, 0.8, 0.8, 0.25, 400, 0.04);
    return 0.45;
  },
  ecu() {
    [1200, 1800, 2400].forEach((f, i) => tone(f, 0.035, 'square', 0.1, i * 0.05));
    for (let i = 0; i < 10; i++) tone(800 + Math.random() * 1800, 0.025, 'square', 0.06, 0.18 + i * 0.028);
    tone(2400, 0.08, 'sine', 0.1, 0.47);
    return 0.5;
  },
  transmission() {
    ratchet(6, 0.035, 3200);
    clunk(110, 0.5, 0.24);
    clunk(80, 0.45, 0.38);
    return 0.5;
  },
  differential() {
    ratchet(4, 0.05, 2600);
    clunk(95, 0.45, 0.22);
    tone(2200, 0.35, 'triangle', 0.05, 0.22);
    tone(3150, 0.3, 'triangle', 0.035, 0.22);
    return 0.5;
  },
  suspension() {
    ratchet(5, 0.03, 3600);
    clunk(120, 0.35, 0.18);
    boing(0.2);
    return 0.55;
  },
  chassis() {
    ratchet(8, 0.025, 2900);
    clunk(60, 0.6, 0.24);
    noiseHit(0.25, 250, 0.6, 0.9, 0.24, undefined, 0.003);
    return 0.5;
  },
};

function stinger(tier: Tier, at: number) {
  if (tier === 'street') {
    [784, 988, 1319].forEach((f, i) => {
      tone(f, i === 2 ? 0.18 : 0.07, 'square', 0.1, at + i * 0.07);
      tone(f / 2, 0.07, 'triangle', 0.08, at + i * 0.07);
    });
  } else if (tier === 'sport') {
    const notes = [659, 784, 988, 1319, 1568];
    notes.forEach((f, i) => {
      const last = i === notes.length - 1;
      tone(f, last ? 0.24 : 0.06, 'square', 0.095, at + i * 0.05);
      tone(f / 2, last ? 0.24 : 0.06, 'triangle', 0.08, at + i * 0.05);
    });
  } else if (tier === 'pro') {
    const notes = [523, 659, 784, 1047, 1319, 1568, 2093];
    notes.forEach((f, i) => {
      const last = i === notes.length - 1;
      tone(f, last ? 0.32 : 0.06, 'square', 0.09, at + i * 0.04);
      tone(f / 2, last ? 0.32 : 0.06, 'triangle', 0.08, at + i * 0.04);
    });
    shimmer(at + 0.2, 0.3, 0.035);
  }
}

/** Per-brand flavour of the paragon transform: key, rev peak, riser level and a signature extra at the hit. */
const PARAGON_SFX: Record<string, { tier: Tier; root: number; chord: number[]; peak: number; riser: number; extra?: (at: number) => void }> = {
  // Sleeper: a polite little riser, then it is unreasonably loud.
  malibru: {
    tier: 'street', root: 196, chord: [1, 1.26, 1.5], peak: 0.95, riser: 0.55,
    extra: (at) => {
      tone(392, 0.12, 'square', 0.08, at - 1.45);
      tone(494, 0.18, 'square', 0.08, at - 1.3); // a meek "beep beep" before it goes off
      tone(45, 0.7, 'sine', 0.35, at, 30);
    },
  },
  // VTEC: rev past the crossover, then a screaming cam-switch yelp.
  civique: {
    tier: 'street', root: 233, chord: [1, 1.26, 1.5, 1.89], peak: 1.0, riser: 0.9,
    extra: (at) => sweep('square', [[0, 900], [0.12, 1800], [0.35, 1400]], 0.05, at - 0.12, 0.02, 0.12, 3000),
  },
  // Pony: V8 burble, a whinny on the hit.
  stallion: {
    tier: 'street', root: 174, chord: [1, 1.26, 1.5], peak: 0.92, riser: 1,
    extra: (at) => {
      sweep('triangle', [[0, 1100], [0.1, 1700], [0.2, 1250], [0.3, 1600], [0.42, 1000], [0.6, 700]], 0.06, at + 0.08, 0.02, 0.15);
      crackle(6, 0.5, 0.9, at + 0.3);
    },
  },
  // Hemi: everything an octave lower, a sub boom.
  avenger: {
    tier: 'sport', root: 146, chord: [1, 1.19, 1.5], peak: 0.9, riser: 1,
    extra: (at) => {
      tone(40, 0.9, 'sine', 0.4, at, 26);
      sweep('sawtooth', [[0, 70], [0.5, 50]], 0.08, at, 0.01, 0.3, 300);
    },
  },
  // Turbo kaiju: monster blow-off and a low roar.
  kaiju: {
    tier: 'sport', root: 165, chord: [1, 1.19, 1.5, 1.78], peak: 0.97, riser: 1,
    extra: (at) => {
      blowOff(0.8, at + 0.02);
      sweep('sawtooth', [[0, 110], [0.15, 140], [0.7, 55]], 0.09, at + 0.05, 0.03, 0.3, 700);
    },
  },
  // Side pipes: a machine-gun of pops.
  viperion: {
    tier: 'sport', root: 185, chord: [1, 1.26, 1.5, 2], peak: 0.97, riser: 1,
    extra: (at) => crackle(12, 0.7, 0.9, at + 0.08),
  },
  // Demon: blower whine climbing through the riser, a diabolus-in-musica stab.
  hellkat: {
    tier: 'pro', root: 155, chord: [1, 1.41, 2], peak: 0.97, riser: 1,
    extra: (at) => {
      sweep('triangle', [[0, 600], [1.4, 2600]], 0.035, at - 1.45, 1.2, 0.05);
      sweep('sawtooth', [[0, 78], [0.6, 55]], 0.09, at, 0.01, 0.3, 500);
      tone(38, 0.9, 'sine', 0.35, at, 25);
    },
  },
  // V12 shriek: a bright scream on top and a major-seventh shimmer.
  lamberghoul: {
    tier: 'pro', root: 220, chord: [1, 1.26, 1.5, 1.89], peak: 1.0, riser: 1,
    extra: (at) => {
      sweep('square', [[0, 1800], [0.25, 3100], [0.5, 2400]], 0.035, at - 0.2, 0.15, 0.2, 5000);
      shimmer(at + 0.2, 0.5, 0.035);
    },
  },
};

export const sfx = {
  amber() {
    tone(620, 0.09, 'square', 0.18);
  },
  green() {
    tone(1240, 0.22, 'square', 0.2);
    tone(1860, 0.22, 'triangle', 0.1);
  },
  redLight() {
    tone(180, 0.35, 'sawtooth', 0.2, 0, 90);
  },
  shift() {
    noiseHit(0.07, 900, 1.5, 0.5);
    tone(110, 0.09, 'sine', 0.5, 0, 50);
  },
  backfire() {
    noiseHit(0.09, 300, 0.8, 0.6);
    noiseHit(0.06, 300, 0.8, 0.4, 0.08);
  },
  nitro() {
    noiseHit(0.9, 400, 1.2, 0.5, 0, 3200);
    tone(80, 0.6, 'sawtooth', 0.12, 0, 160);
  },
  perfect() {
    tone(880, 0.08, 'square', 0.12);
    tone(1320, 0.12, 'square', 0.12, 0.06);
  },
  miss() {
    tone(200, 0.15, 'square', 0.12, 0, 120);
  },
  coin() {
    tone(988, 0.06, 'square', 0.14);
    tone(1319, 0.18, 'square', 0.14, 0.06);
  },
  tick() {
    tone(1400, 0.03, 'square', 0.06);
  },
  click() {
    tone(700, 0.04, 'square', 0.1);
  },
  win() {
    const notes = [523, 659, 784, 1047, 784, 1047];
    notes.forEach((n, i) => tone(n, i === notes.length - 1 ? 0.5 : 0.12, 'square', 0.16, i * 0.1));
    notes.forEach((n, i) => tone(n / 2, 0.12, 'triangle', 0.12, i * 0.1));
  },
  lose() {
    tone(140, 0.7, 'sine', 0.5, 0, 35);
    noiseHit(0.4, 160, 0.7, 0.5);
    tone(311, 0.25, 'square', 0.1, 0.15);
    tone(277, 0.25, 'square', 0.1, 0.4);
    tone(233, 0.6, 'square', 0.1, 0.65);
  },
  slam() {
    tone(90, 0.3, 'sine', 0.5, 0, 40);
    noiseHit(0.15, 400, 0.8, 0.4);
  },
  /** A part was installed: slot-flavoured sound + tier stinger (pro = jackpot). */
  install(slot: SlotId, tier: Tier) {
    try {
      duck(1.1);
      stinger(tier, (INSTALL[slot] ?? INSTALL.engine)());
    } catch {
      /* audio is optional */
    }
  },
  /**
   * PARAGON TRANSFORM (~2.5 s): a riser in the brand's key, the starter catching and that paragon's engine firing up and
   * revving to the peak, then a huge hit with a brand-flavoured extra. Call it the moment the 12th part installs.
   */
  paragon(brandId: string) {
    const c = ac();
    if (!c || !master) return;
    const keep = master;
    try {
      duck(3);
      const F = PARAGON_SFX[brandId] ?? PARAGON_SFX.stallion;
      // Everything below goes through one bus so the whole moment has a single level knob.
      const bus = c.createGain();
      bus.gain.value = 0.82;
      bus.connect(keep);
      master = bus;
      const t0 = c.currentTime + 0.01;
      const HIT = 1.5;
      const rv = F.riser;
      // ---- riser: two saws climbing two octaves under an accelerating arpeggio ----
      sweep('sawtooth', [[0, F.root / 2], [HIT - 0.05, F.root * 2]], 0.09 * rv, 0.01, 1.2, 0.05, 1800);
      sweep('square', [[0, F.root / 4], [HIT - 0.05, F.root]], 0.06 * rv, 0.01, 1.2, 0.05, 700);
      const arp = [0, 0.3, 0.55, 0.75, 0.9, 1.02, 1.12, 1.2, 1.27, 1.33, 1.38, 1.42];
      arp.forEach((at, i) => {
        const f = F.root * 2 * F.chord[i % F.chord.length] * 2 ** Math.floor(i / F.chord.length);
        tone(f, 0.07, 'square', (0.03 + 0.04 * (i / arp.length)) * rv, at);
      });
      // ---- starter: three cranks, then it catches ----
      for (let i = 0; i < 3; i++) clunk(70 + i * 6, 0.25, 0.62 + i * 0.1);
      // ---- the paragon's own engine: fire, settle, rev to the peak, lift through the hit ----
      const e = new EngineSound({ ...DEFAULT_ENGINE_PROFILE, engine: F.tier, exhaust: F.tier, intake: F.tier, transmission: F.tier, paragon: brandId });
      const T = (x: number) => t0 + x;
      e.gateAt([[T(0), 0], [T(0.9), 0], [T(0.95), 1], [T(2.15), 1], [T(2.55), 0]]);
      const ease = (x: number) => 1 - (1 - Math.max(0, Math.min(1, x))) ** 2;
      for (let x = 0.9; x < 2.55; x += 0.02) {
        let rpm: number;
        let thr: number;
        if (x < 1.0) ((rpm = 0.12 + 0.4 * ease((x - 0.9) / 0.1)), (thr = 1));
        else if (x < 1.12) ((rpm = 0.52 - 0.2 * ease((x - 1.0) / 0.12)), (thr = 0.2));
        else if (x < HIT) ((rpm = 0.32 + (F.peak - 0.32) * ((x - 1.12) / (HIT - 1.12)) ** 1.3), (thr = 1));
        else ((rpm = F.peak - (F.peak - 0.2) * ease((x - HIT) / 0.9)), (thr = 0));
        e.set(rpm, thr, false, false, T(x));
      }
      e.blowOff(T(HIT + 0.02));
      e.stopAt(T(2.7));
      // ---- the hit ----
      tone(120, 0.8, 'sine', 0.55, HIT, 30);
      tone(60, 0.5, 'sine', 0.35, HIT, 28);
      noiseHit(0.12, 300, 0.8, 0.6, HIT, undefined, 0.002);
      F.chord.forEach((m, i) => {
        tone(F.root * 2 * m, 0.55, 'square', 0.07, HIT + i * 0.012);
        tone(F.root * m, 0.6, 'triangle', 0.08, HIT + i * 0.012);
      });
      crackle(6, 0.45, 0.8, HIT + 0.05);
      F.extra?.(HIT);
      shimmer(HIT + 0.05, 0.5, 0.03);
    } catch {
      /* audio is optional */
    } finally {
      master = keep;
    }
  },
  /** A cosmetic was unlocked: sparkly rising jingle. */
  unlock() {
    try {
      [784, 1047, 1319, 1568, 2093].forEach((f, i) => {
        tone(f, 0.1, 'triangle', 0.14, i * 0.06);
        tone(f, 0.06, 'square', 0.05, i * 0.06);
      });
      tone(2093, 0.5, 'sine', 0.12, 0.3);
      tone(3136, 0.4, 'sine', 0.05, 0.3);
      shimmer(0.1, 0.6, 0.035);
    } catch {
      /* audio is optional */
    }
  },
  /** Crowd roar swelling and fading over ms, with a whistle or two. */
  crowd(ms = 2500) {
    const c = ac();
    if (!c || !master) return;
    try {
      const t0 = c.currentTime;
      const dur = Math.max(0.5, ms / 1000);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.9, t0 + dur * 0.3);
      g.gain.setValueAtTime(0.9, t0 + dur * 0.6);
      g.gain.linearRampToValueAtTime(0, t0 + dur);
      // "Voices": a slow wobble on the level so it isn't flat static.
      const am = c.createGain();
      am.gain.value = 0.75;
      const lfo = c.createOscillator();
      lfo.frequency.value = 4.3;
      const lfoG = c.createGain();
      lfoG.gain.value = 0.25;
      lfo.connect(lfoG).connect(am.gain);
      const nodes: AudioNode[] = [g, am, lfoG];
      const srcs: AudioScheduledSourceNode[] = [lfo];
      for (const [f, q, rate] of [[900, 0.7, 1], [420, 0.9, 0.7]] as const) {
        const s = c.createBufferSource();
        s.buffer = noise(c);
        s.loop = true;
        s.playbackRate.value = rate;
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f;
        bp.Q.value = q;
        s.connect(bp).connect(am);
        s.start(t0, Math.random() * 0.9);
        srcs.push(s);
        nodes.push(bp);
      }
      am.connect(g).connect(master);
      lfo.start(t0);
      srcs.forEach((s) => s.stop(t0 + dur + 0.05));
      srcs[0].onended = () => {
        srcs.forEach((s) => s.disconnect());
        nodes.forEach((n) => n.disconnect());
      };
      const whistles = dur > 1.5 ? 2 : 1;
      for (let i = 0; i < whistles; i++) {
        sweep('sine', [[0, 1500], [0.18, 2600], [0.45, 1700]], 0.05, dur * (0.2 + Math.random() * 0.4), 0.03, 0.12);
      }
    } catch {
      /* audio is optional */
    }
  },
};

/** What the engine is built from: drives EngineSound timbre and revBlip. */
export interface EngineProfile {
  engine: Tier;
  intake: Tier;
  exhaust: Tier;
  forcedInduction: Tier;
  transmission: Tier;
  nitrous: boolean;
  /** Brand id of the active paragon (all 12 parts of one brand): swaps in that car's own engine voice. */
  paragon?: string;
}

export const DEFAULT_ENGINE_PROFILE: EngineProfile = {
  engine: 'stock',
  intake: 'stock',
  exhaust: 'stock',
  forcedInduction: 'stock',
  transmission: 'stock',
  nitrous: false,
};

export function engineProfileFromParts(parts: Record<SlotId, InstalledPart> | undefined): EngineProfile {
  const tier = (slot: SlotId): Tier => {
    const ip = parts?.[slot];
    if (!ip) return 'stock';
    try {
      return partById(ip.partId)?.tier ?? 'stock';
    } catch {
      return 'stock';
    }
  };
  return {
    engine: tier('engine'),
    intake: tier('intake'),
    exhaust: tier('exhaust'),
    forcedInduction: tier('forced_induction'),
    transmission: tier('transmission'),
    nitrous: tier('nitrous') !== 'stock',
    paragon: (parts && safeParagon(parts)) || undefined,
  };
}

function safeParagon(parts: Record<SlotId, InstalledPart>): string | null {
  try {
    return activeParagon(parts);
  } catch {
    return null;
  }
}

let blip: { e: EngineSound; timer: number } | null = null;
/** One-shot ~1 s garage rev of an engine with this profile (played after an install). Cleans up after itself. */
export function revBlip(profile: EngineProfile) {
  try {
    if (blip) {
      clearInterval(blip.timer);
      blip.e.stop();
      blip = null;
    }
    if (!ac()) return;
    duck(1.3);
    const e = new EngineSound(profile);
    const t0 = performance.now();
    let lifted = false;
    const timer = window.setInterval(() => {
      const s = (performance.now() - t0) / 1000;
      if (s >= 1.15) {
        clearInterval(timer);
        e.stop();
        if (blip?.e === e) blip = null;
        return;
      }
      if (s < 0.08) e.set(0.15, 0.2, false);
      else if (s < 0.45) e.set(0.15 + 0.75 * (1 - (1 - (s - 0.08) / 0.37) ** 2), 1, false);
      else {
        if (!lifted) e.blowOff();
        lifted = true;
        e.set(0.9 - 0.75 * (1 - (1 - Math.min(1, (s - 0.45) / 0.5)) ** 2.5), 0, false);
      }
    }, 16);
    blip = { e, timer };
  } catch {
    /* audio is optional */
  }
}

/** Tier as a level for the [stock, street, pro] tables below: sport sits between street and pro. */
const TIER_N: Record<Tier, number> = { stock: 0, street: 1, sport: 1.5, pro: 2 };
/** Read a [stock, street, pro] table at a (fractional) tier level; past 2 it extrapolates. */
function lv(a: readonly number[], n: number): number {
  const i = Math.max(0, Math.min(a.length - 2, Math.floor(n)));
  return a[i] + (a[i + 1] - a[i]) * (n - i);
}
/** Overall engine level (the tone itself, not the noise layers). */
const ENGINE_GAIN = 1.4;

/** tanh saturation curve: thickens the low end, normalized to +-1. */
function gritCurve(k: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const a = new Float32Array(n);
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) a[i] = Math.tanh(k * ((i / (n - 1)) * 2 - 1)) / norm;
  return a;
}

// ---- engine voice: a looped train of exhaust pulses, pre-rendered per engine ----
//
// One loop = 4 engine cycles (two crank turns each): a pulse per cylinder firing, each a short
// pressure bump rung through a few pipe resonances. A cross-plane V8 alternates banks unevenly
// (L R R L R L L R), so one bank's pulses come a touch late and weaker: that is the burble, energy at
// half and a quarter of the firing rate. Three loops rendered at low/mid/high rpm play phase-locked
// (same number of cycles, playbackRate = rpm / their rpm) and crossfade, so the pipe tone doesn't
// chipmunk across the rev range.

interface EngineSpec {
  cyl: number;
  rpm0: number; // real rpm at normalized 0; redline = rpm0 + span
  span: number;
  bankAsym: number; // second bank's pulses this much weaker
  bankLag: number; // ...and this late (fraction of a firing interval)
  cylVar: number; // fixed per-cylinder spread (amplitude and timing)
  cycVar: number; // per-cycle combustion spread (idle chop)
  widthMs: number; // longest pulse
  grit: number; // noise in each pulse
  modes: [number, number, number][]; // pipe resonances: [Hz, Q, gain]
  direct: number; // raw pulse let through
  sub: number; // sine an octave below firing
  shelf: number; // low-shelf dB
  body: [number, number]; // fixed exhaust body resonance [Hz, dB]
  lope: number; // cam chop depth at idle
  drive: number; // into the saturator
  lp: number; // lowpass floor (Hz)
  level: number;
  /** Extra level under load (scaled by throttle): bigger engines get louder when you're on it, not at idle. */
  load: number;
  midDip: number; // level trim where the burble meets the body resonance
  // ---- paragon extras ----
  /** VTEC: above this normalized rpm the cam switches: the tone opens up, gets louder and grows an intake howl. */
  vtec?: number;
  /** Supercharger whine level (a tonal gear whine riding on rpm). */
  whine?: number;
  /** Forced-induction level override (0..2.5) for the turbo whistle: paragons pick their own. */
  turbo?: number;
  /** Blow-off size multiplier. */
  bov?: number;
  /** Lowpass multiplier: brighter, screamier exotics. */
  bright?: number;
}

const SPECS: Record<string, EngineSpec> = {
  // Stock V6: even fire, small and smooth.
  stock: {
    cyl: 6, rpm0: 300, span: 6700, bankAsym: 0.04, bankLag: 0.01, cylVar: 0.03, cycVar: 0.03, widthMs: 0.9, grit: 0.15,
    modes: [[115, 2.5, 0.8], [260, 3.5, 0.7], [620, 5, 0.3]], direct: 0.35, sub: 0.06, shelf: 2, body: [180, 1.5], lope: 0,
    drive: 0.9, lp: 520, level: 1.45, load: 0, midDip: 0,
  },
  // Street V8: cross-plane burble.
  street: {
    cyl: 8, rpm0: 250, span: 5800, bankAsym: 0.24, bankLag: 0.06, cylVar: 0.07, cycVar: 0.09, widthMs: 1.2, grit: 0.2,
    modes: [[110, 2.6, 1], [250, 3.5, 0.6], [540, 5, 0.3]], direct: 0.25, sub: 0.12, shelf: 2.5, body: [130, 3], lope: 0.24,
    drive: 1.15, lp: 400, level: 1.01, load: 0.48, midDip: 0.08,
  },
  // Sport V8: hotter cam than the street V8, not yet the big-block's lump.
  sport: {
    cyl: 8, rpm0: 225, span: 5500, bankAsym: 0.3, bankLag: 0.075, cylVar: 0.09, cycVar: 0.14, widthMs: 1.4, grit: 0.22,
    modes: [[96, 2.4, 0.9], [220, 3.2, 0.68], [485, 4.8, 0.31]], direct: 0.22, sub: 0.16, shelf: 3.2, body: [115, 3], lope: 0.4,
    drive: 1.28, lp: 365, level: 0.91, load: 0.62, midDip: 0.2,
  },
  // Pro big-block: lumpy cam, deepest pipes, most sub.
  pro: {
    cyl: 8, rpm0: 200, span: 5200, bankAsym: 0.36, bankLag: 0.09, cylVar: 0.11, cycVar: 0.2, widthMs: 1.6, grit: 0.24,
    modes: [[84, 2.2, 0.8], [190, 3, 0.75], [430, 4.5, 0.32]], direct: 0.2, sub: 0.2, shelf: 4, body: [100, 3], lope: 0.6,
    drive: 1.4, lp: 330, level: 0.825, load: 0.76, midDip: 0.35,
  },

  // ---- PARAGON voices (EngineProfile.paragon = brand id) ----
  // Malibru SS: smooth little inline-4 that idles politely and turns out to be LOUD on throttle.
  malibru: {
    cyl: 4, rpm0: 600, span: 6400, bankAsym: 0, bankLag: 0, cylVar: 0.02, cycVar: 0.02, widthMs: 0.8, grit: 0.12,
    modes: [[150, 2.5, 0.9], [340, 3.5, 0.7], [760, 5, 0.35]], direct: 0.35, sub: 0.05, shelf: 2, body: [200, 2], lope: 0,
    drive: 1.0, lp: 470, level: 1.2, load: 1.0, midDip: 0, turbo: 1,
  },
  // Civique Type-Arr: rev-happy four that changes character at the VTEC crossover.
  civique: {
    cyl: 4, rpm0: 800, span: 8400, bankAsym: 0, bankLag: 0, cylVar: 0.02, cycVar: 0.02, widthMs: 0.7, grit: 0.12,
    modes: [[170, 2.6, 0.8], [400, 3.8, 0.7], [900, 5, 0.4]], direct: 0.38, sub: 0.04, shelf: 1.5, body: [220, 2], lope: 0,
    drive: 1.0, lp: 480, level: 1.3, load: 0.45, midDip: 0, vtec: 0.62, turbo: 0,
  },
  // Stallion Shelbee: the classic cross-plane V8 burble, lumpier than the street V8.
  stallion: {
    cyl: 8, rpm0: 250, span: 6200, bankAsym: 0.32, bankLag: 0.075, cylVar: 0.08, cycVar: 0.12, widthMs: 1.3, grit: 0.2,
    modes: [[100, 2.5, 1], [235, 3.4, 0.65], [520, 5, 0.3]], direct: 0.24, sub: 0.14, shelf: 3, body: [125, 3], lope: 0.42,
    drive: 1.25, lp: 400, level: 1.0, load: 0.6, midDip: 0.12, turbo: 0,
  },
  // Avenger Scatpak: deep Hemi: low pipes, heavy sub, slow lope.
  avenger: {
    cyl: 8, rpm0: 200, span: 5300, bankAsym: 0.34, bankLag: 0.085, cylVar: 0.1, cycVar: 0.16, widthMs: 1.7, grit: 0.22,
    modes: [[72, 2.1, 0.9], [165, 2.9, 0.8], [380, 4.4, 0.32]], direct: 0.2, sub: 0.24, shelf: 4.5, body: [90, 3.5], lope: 0.5,
    drive: 1.45, lp: 310, level: 0.78, load: 0.8, midDip: 0.3, turbo: 0,
  },
  // Kaiju 2JZ: silky inline-6, a big turbo whistle and a huge blow-off.
  kaiju: {
    cyl: 6, rpm0: 500, span: 6800, bankAsym: 0, bankLag: 0, cylVar: 0.02, cycVar: 0.03, widthMs: 0.8, grit: 0.14,
    modes: [[130, 2.6, 0.8], [300, 3.8, 0.75], [690, 5, 0.4]], direct: 0.32, sub: 0.07, shelf: 2, body: [170, 2], lope: 0.05,
    drive: 1.1, lp: 470, level: 1.25, load: 0.6, midDip: 0, turbo: 2.5, bov: 1.8,
  },
  // Viperion ACR: V10 howl: ten uneven-ish pulses, side pipes.
  viperion: {
    cyl: 10, rpm0: 350, span: 6200, bankAsym: 0.12, bankLag: 0.05, cylVar: 0.05, cycVar: 0.06, widthMs: 1.0, grit: 0.18,
    modes: [[120, 2.6, 0.9], [290, 3.6, 0.7], [640, 5, 0.35]], direct: 0.3, sub: 0.1, shelf: 2.5, body: [150, 2.5], lope: 0.1,
    drive: 1.3, lp: 450, level: 1.0, load: 0.6, midDip: 0.05, bright: 1.15, turbo: 0,
  },
  // Hellkat Demon: supercharged big V8: the blower whine rides over the rumble.
  hellkat: {
    cyl: 8, rpm0: 220, span: 5600, bankAsym: 0.34, bankLag: 0.085, cylVar: 0.1, cycVar: 0.16, widthMs: 1.5, grit: 0.24,
    modes: [[80, 2.2, 0.85], [185, 3, 0.75], [420, 4.5, 0.32]], direct: 0.2, sub: 0.2, shelf: 4, body: [100, 3], lope: 0.45,
    drive: 1.45, lp: 340, level: 0.84, load: 0.8, midDip: 0.3, whine: 1, turbo: 0,
  },
  // Lamberghoul Aventadoom: V12 shriek: twelve tight pulses, bright pipes, 9000 rpm.
  lamberghoul: {
    cyl: 12, rpm0: 600, span: 8400, bankAsym: 0.03, bankLag: 0.01, cylVar: 0.03, cycVar: 0.03, widthMs: 0.65, grit: 0.14,
    modes: [[160, 2.8, 0.7], [380, 4, 0.8], [880, 5, 0.5]], direct: 0.4, sub: 0.05, shelf: 1.5, body: [240, 2], lope: 0,
    drive: 1.4, lp: 620, level: 1.2, load: 0.6, midDip: 0, bright: 1.35, turbo: 0,
  },
};
/** The paragon voices, by brand id. */
export const PARAGON_ENGINES = ['malibru', 'civique', 'stallion', 'avenger', 'kaiju', 'viperion', 'hellkat', 'lamberghoul'] as const;
const SPEC_IDS = Object.keys(SPECS);

/** Which voice a profile gets: its paragon's, else the engine tier's. */
function specIdOf(p: EngineProfile): string {
  return p.paragon && SPECS[p.paragon] ? p.paragon : SPECS[p.engine] ? p.engine : 'stock';
}

const V8_BANKS = [0, 1, 1, 0, 1, 0, 0, 1]; // firing order 1-8-4-3-6-5-7-2 by bank
const BAND_RPM = [1000, 2500, 5200];
const LOOP_CYCLES = 4;

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One band's loop: LOOP_CYCLES cycles of `cycLen` samples. Same seed per engine, so all bands share the same cylinders. */
function renderPulses(sr: number, s: EngineSpec, ex: number, cycLen: number, seed: number): Float32Array<ArrayBuffer> {
  const len = cycLen * LOOP_CYCLES;
  const x = new Float32Array(len);
  const rnd = mulberry(seed);
  const hiss = mulberry(seed * 7 + 3);
  const sp = (v: number) => (rnd() * 2 - 1) * v;
  const cylAmp = Array.from({ length: s.cyl }, () => 1 + sp(s.cylVar));
  const cylOff = Array.from({ length: s.cyl }, () => sp(s.cylVar * 0.4));
  const interval = cycLen / s.cyl;
  const w = Math.max(3, Math.min(interval * 0.24, (s.widthMs * sr) / 1000));
  const grit = s.grit * (1 + ex * 0.35);
  for (let cyc = 0; cyc < LOOP_CYCLES; cyc++) {
    const cycAmp = 1 + sp(s.cycVar);
    for (let k = 0; k < s.cyl; k++) {
      const bank = s.cyl === 8 ? V8_BANKS[k] : k % 2;
      const at = Math.round(cyc * cycLen + (k + cylOff[k] + bank * s.bankLag) * interval);
      const amp = cycAmp * cylAmp[k] * (bank ? 1 - s.bankAsym : 1) * (1 + sp(s.cycVar * 0.5));
      // Pressure bump, then a longer, shallower suck-back (roughly DC-free), plus a burst of combustion noise.
      const n = Math.ceil(w * 3.5);
      for (let i = 0; i < n; i++) {
        let v = 0;
        if (i < w) v = Math.sin((Math.PI * i) / w) ** 2;
        else v = -0.4 * Math.sin((Math.PI * (i - w)) / (2.5 * w)) ** 2;
        v += grit * (hiss() * 2 - 1) * Math.exp(-i / (1.3 * w));
        x[(at + i + len) % len] += amp * v;
      }
    }
  }
  // Pipe resonances (RBJ band-pass, 0 dB peak). Run the loop twice so the ringing wraps seamlessly.
  const y = new Float32Array(len);
  for (let i = 0; i < len; i++) y[i] = x[i] * s.direct * (1 + ex * 0.25);
  for (const [f, q, g] of s.modes) {
    const fr = (2 * Math.PI * f) / sr;
    const al = Math.sin(fr) / (2 * q);
    const a0 = 1 + al;
    const b0 = al / a0;
    const a1 = (-2 * Math.cos(fr)) / a0;
    const a2 = (1 - al) / a0;
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < len; i++) {
        const xi = x[i];
        const yi = b0 * xi - b0 * x2 - a1 * y1 - a2 * y2;
        x2 = x1;
        x1 = xi;
        y2 = y1;
        y1 = yi;
        if (pass) y[i] += g * yi;
      }
    }
  }
  let e = 0;
  for (let i = 0; i < len; i++) e += y[i] * y[i];
  const k = 0.25 / Math.max(1e-6, Math.sqrt(e / len));
  for (let i = 0; i < len; i++) y[i] *= k;
  return y;
}

const loopCache = new Map<string, { bufs: AudioBuffer[]; base: number[] }>();

/** The three phase-locked band loops for an engine + exhaust, cached per sample rate. */
function engineLoops(c: BaseAudioContext, id: string, ex: number) {
  const sr = c.sampleRate;
  const key = `${sr}:${id}:${ex}`;
  let hit = loopCache.get(key);
  if (!hit) {
    const s = SPECS[id];
    const e = Math.max(0, SPEC_IDS.indexOf(id));
    const bufs: AudioBuffer[] = [];
    const base: number[] = [];
    for (const rpm of BAND_RPM) {
      const cycLen = Math.round((120 / rpm) * sr);
      const data = renderPulses(sr, s, ex, cycLen, 1009 + e * 31 + Math.round(ex * 14));
      const b = c.createBuffer(1, data.length, sr);
      b.copyToChannel(data, 0);
      bufs.push(b);
      base.push((120 * sr) / cycLen); // exact rpm of this loop, so all bands stay phase-locked
    }
    hit = { bufs, base };
    loopCache.set(key, hit);
  }
  return hit;
}

interface Voice {
  srcs: AudioScheduledSourceNode[];
  nodes: AudioNode[];
  loops: AudioBufferSourceNode[];
  base: number[];
  xg: GainNode[];
  sub: OscillatorNode;
  subG: GainNode;
  lope: OscillatorNode;
  lopeAm: GainNode;
  lopeAmG: GainNode;
  lopeDet: GainNode;
  burbleG: GainNode;
  drive: GainNode;
  shelf: BiquadFilterNode;
  lp: BiquadFilterNode;
  g: GainNode;
  hissG: GainNode;
  sqF: BiquadFilterNode;
  sqG: GainNode;
  whistle?: OscillatorNode;
  whistleG?: GainNode;
  spoolF?: BiquadFilterNode;
  spoolG?: GainNode;
  /** Output gate (everything goes through it): lets one-shots like sfx.paragon schedule the engine in and out. */
  gate: GainNode;
  /** Tonal extra: supercharger gear whine or the VTEC intake howl. */
  whineO?: OscillatorNode;
  whineF?: BiquadFilterNode;
  whineG?: GainNode;
}

/** Continuous engine whose pulses, pitch and timbre follow rpm and the installed parts. */
export class EngineSound {
  private c: BaseAudioContext | null;
  private v?: Voice;
  private stutter = 0;
  private readonly s: EngineSpec;
  private readonly fi: number;
  private readonly ex: number;
  private readonly tr: number;
  private readonly ik: number;
  private lastThr = 0;
  private lastRpm = 0;
  private crackleAt = 0;
  private dumpUntil = 0;

  constructor(profile: EngineProfile = DEFAULT_ENGINE_PROFILE) {
    const id = specIdOf(profile);
    this.s = SPECS[id];
    this.fi = this.s.turbo ?? TIER_N[profile.forcedInduction] ?? 0;
    this.ex = TIER_N[profile.exhaust] ?? 0;
    this.tr = TIER_N[profile.transmission] ?? 0;
    this.ik = TIER_N[profile.intake] ?? 0;
    this.c = ac();
    const c = this.c;
    if (!c || !master) return;
    try {
      const s = this.s;
      const srcs: AudioScheduledSourceNode[] = [];
      const nodes: AudioNode[] = [];
      const osc = (type: OscillatorType, f = 100) => {
        const o = c.createOscillator();
        o.type = type;
        o.frequency.value = f;
        srcs.push(o);
        return o;
      };
      const gain = (v: number) => {
        const g = c.createGain();
        g.gain.value = v;
        nodes.push(g);
        return g;
      };
      const filt = (type: BiquadFilterType, f: number, q: number, db = 0) => {
        const b = c.createBiquadFilter();
        b.type = type;
        b.frequency.value = f;
        b.Q.value = q;
        b.gain.value = db;
        nodes.push(b);
        return b;
      };
      // One shared looping noise source feeds every noise layer through its own filter.
      const nz = c.createBufferSource();
      nz.buffer = noise(c);
      nz.loop = true;

      // Pulse loops -> crossfade -> saturator -> cam chop -> low shelf -> exhaust body -> lowpass -> out.
      const { bufs, base } = engineLoops(c, id, this.ex);
      const out = gain(1);
      out.connect(master);
      const mix = gain(1);
      const lopeAm = gain(1);
      const xg = bufs.map(() => gain(0));
      const loops = bufs.map((b, i) => {
        const src = c.createBufferSource();
        src.buffer = b;
        src.loop = true;
        src.connect(xg[i]).connect(mix);
        return src;
      });
      const sub = osc('sine', 30);
      const subG = gain(0);
      sub.connect(subG).connect(mix);
      const drive = gain(1);
      const sh = c.createWaveShaper();
      sh.curve = gritCurve(2.2);
      sh.oversample = '2x';
      nodes.push(sh);
      const shelf = filt('lowshelf', 160, 0.7, s.shelf);
      const bodyF = filt('peaking', s.body[0], 1.2, s.body[1] + this.ex * 0.5);
      const lp = filt('lowpass', 600, 0.8);
      const hp = filt('highpass', 30, 0.7);
      const g = gain(0);
      mix.connect(drive).connect(sh).connect(lopeAm).connect(shelf).connect(bodyF).connect(lp).connect(hp).connect(g).connect(out);

      // Cam chop: a lumpy low-rate wobble on level and pitch, strongest at idle.
      const lope = osc('sine', 2);
      lope.setPeriodicWave(c.createPeriodicWave(new Float32Array([0, 0, 0, 0]), new Float32Array([0, 1, 0.45, 0.2])));
      const lopeDet = gain(0);
      const lopeAmG = gain(0);
      lope.connect(lopeAmG).connect(lopeAm.gain);
      lope.connect(lopeDet);
      // Slow drift so the loop never sounds like a loop.
      const jit = osc('sine', 0.43);
      const jit2 = osc('sine', 1.7);
      const jitG = gain(7);
      jit.connect(jitG);
      jit2.connect(gain(3)).connect(jitG);
      for (const src of loops) {
        lopeDet.connect(src.detune);
        jitG.connect(src.detune);
      }
      lopeDet.connect(sub.detune);
      // Irregular burble (overrun, rough idle): very slow noise into the level.
      const bn = c.createBufferSource();
      bn.buffer = noise(c);
      bn.loop = true;
      bn.playbackRate.value = 0.05;
      const burbleG = gain(0);
      bn.connect(filt('lowpass', 16, 0.7)).connect(burbleG).connect(lopeAm.gain);

      const hissG = gain(0);
      nz.connect(filt('highpass', 4500, 0.7)).connect(hissG).connect(out);

      // Tyre screech: narrow noise band with a wobble on its centre.
      const sqF = filt('bandpass', 2200, 10);
      const sqG = gain(0);
      const wob = osc('sine', 6.5);
      wob.connect(gain(180)).connect(sqF.frequency);
      nz.connect(sqF).connect(sqG).connect(out);

      const v: Voice = {
        srcs, nodes, loops, base, xg, sub, subG, lope, lopeAm, lopeAmG, lopeDet, burbleG, drive, shelf, lp, g, hissG, sqF, sqG, gate: out,
      };
      if (this.fi) {
        v.whistle = osc('sine', 1800);
        v.whistleG = gain(0);
        v.whistle.connect(v.whistleG).connect(out);
        v.spoolF = filt('bandpass', 2000, 4);
        v.spoolG = gain(0);
        nz.connect(v.spoolF).connect(v.spoolG).connect(out);
      }
      if (s.whine || s.vtec) {
        // Supercharger: a bright gear whine (triangle through a resonant band) that climbs with rpm.
        // VTEC: a square howl at twice the firing rate, only above the crossover.
        v.whineO = osc(s.whine ? 'triangle' : 'square', 800);
        v.whineF = filt('bandpass', 1500, s.whine ? 3 : 1.6);
        v.whineG = gain(0);
        v.whineO.connect(v.whineF).connect(v.whineG).connect(out);
      }
      // No noise layer for the intake: filtered white noise read as static. A better intake opens up the
      // engine tone itself instead (see the lowpass and level in set()).
      srcs.forEach((o) => o.start());
      // All loops start on the same sample so their pulses line up through the crossfade.
      const t0 = c.currentTime + 0.005;
      loops.forEach((src) => src.start(t0));
      nz.start(0, Math.random() * 0.9);
      bn.start(0, Math.random() * 0.9);
      srcs.push(...loops, nz, bn);
      this.v = v;
      this.set(0.12, 0, false);
    } catch {
      this.v = undefined;
    }
  }

  /** rpm normalized (1 = redline), throttle 0..1. `at` (context time) schedules the change ahead (one-shots). */
  set(rpm: number, throttle: number, limiter: boolean, nitro = false, at?: number) {
    const c = this.c;
    const v = this.v;
    if (!c || !v) return;
    const s = this.s;
    const t = Math.max(c.currentTime, at ?? 0);
    const rel = t - c.currentTime;
    const r = Math.max(0.08, Math.min(1.08, rpm));
    const thr = Math.max(0, Math.min(1, throttle));
    const real = s.rpm0 + r * s.span;
    for (let i = 0; i < v.loops.length; i++) v.loops[i].playbackRate.setTargetAtTime(real / v.base[i], t, 0.02);
    // Equal-power crossfade between the band loops.
    const b = BAND_RPM;
    const w = [0, 0, 0];
    if (real <= b[0]) w[0] = 1;
    else if (real >= b[2]) w[2] = 1;
    else {
      const i = real < b[1] ? 0 : 1;
      const x = Math.log(real / b[i]) / Math.log(b[i + 1] / b[i]);
      w[i] = Math.cos((x * Math.PI) / 2);
      w[i + 1] = Math.sin((x * Math.PI) / 2);
    }
    for (let i = 0; i < v.xg.length; i++) v.xg[i].gain.setTargetAtTime(w[i], t, 0.03);
    const firing = (real / 60) * (s.cyl / 2);
    v.sub.frequency.setTargetAtTime(firing / 2, t, 0.02);
    // Below ~45 Hz the sub is only felt, so keep it back at idle.
    v.subG.gain.setTargetAtTime(s.sub * (0.5 + 0.5 * thr) * (1 + this.ex * 0.2) * Math.min(1, firing / 90), t, 0.05);

    // Cam lope fades out as revs come up.
    const idle = s.rpm0 + 0.13 * s.span;
    const fade = Math.max(0, Math.min(1, 1 - (real - idle) / 1600));
    const lope = s.lope * fade * (1 - thr * 0.4);
    v.lope.frequency.setTargetAtTime(Math.max(1.5, Math.min(6, real / 470)), t, 0.1);
    v.lopeAmG.gain.setTargetAtTime(lope * 0.55, t, 0.05);
    v.lopeDet.gain.setTargetAtTime(lope * 110, t, 0.05);
    // Overrun burble: off throttle with revs up, louder with a more open exhaust.
    const over = (1 - thr) * Math.min(1, Math.max(0, (r - 0.2) * 2.5));
    v.burbleG.gain.setTargetAtTime((over * (0.6 + this.ex * 0.6) + fade * s.lope * 0.5) * (s.cyl === 8 ? 3 : 1.5), t, 0.08);

    v.drive.gain.setTargetAtTime(s.drive * (0.55 + 0.85 * thr + (nitro ? 0.3 : 0)) * (1 + this.ex * 0.15), t, 0.03);
    v.shelf.gain.setTargetAtTime(s.shelf + this.ex + (1 - thr) * 1.5, t, 0.05);
    // VTEC crossover: 0 below the cam switch, 1 a little above it.
    const kick = s.vtec ? Math.max(0, Math.min(1, (r - s.vtec) / 0.05)) * (0.4 + 0.6 * thr) : 0;
    const muffle = lv([0.8, 1, 1.15], this.ex) * (s.bright ?? 1) * (1 + kick * 1.1);
    v.lp.frequency.setTargetAtTime((s.lp + r * 1500 + thr * (1000 + this.ex * 400 + this.ik * 450) + (nitro ? 900 : 0)) * muffle, t, kick ? 0.015 : 0.03);
    // Every upgrade must read as louder: engine tier mostly under load, exhaust always, intake on throttle.
    let vol = ENGINE_GAIN * (0.19 + thr * 0.05) * s.level * (1 + thr * s.load) * lv([0.85, 1.1, 1.1], this.ex) * (1 + thr * lv([0, 0.12, 0.25], this.ik));
    vol *= 1 - s.midDip * Math.exp(-(((r - 0.5) / 0.25) ** 2));
    vol *= 1 + kick * 0.3;
    if (v.whineO && v.whineF && v.whineG) {
      if (s.whine) {
        // Blower drive ~2.6x crank, 4 lobes x 3 = the whine climbs from ~400 Hz at idle to ~3 kHz at redline.
        const wf = 300 + real * 0.45;
        v.whineO.frequency.setTargetAtTime(wf, t, 0.03);
        v.whineF.frequency.setTargetAtTime(wf, t, 0.03);
        v.whineG.gain.setTargetAtTime(s.whine * (0.012 + 0.07 * thr * Math.min(1, r * 1.4)), t, 0.06);
      } else {
        v.whineO.frequency.setTargetAtTime(firing * 2, t, 0.02);
        v.whineF.frequency.setTargetAtTime(firing * 2.2, t, 0.02);
        v.whineG.gain.setTargetAtTime(kick * 0.05, t, 0.02);
      }
    }
    if (limiter) {
      this.stutter++;
      if (this.stutter % 6 < 3) vol *= 0.25;
    }
    v.g.gain.setTargetAtTime(vol, t, 0.012);
    v.hissG.gain.setTargetAtTime(nitro ? 0.16 : 0, t, 0.05);

    if (v.whistle && v.whistleG && v.spoolF && v.spoolG) {
      // Boost lags throttle (tau 0.25 s) so you hear it spool.
      const boost = t < this.dumpUntil ? 0 : thr * Math.min(1, r) ** 1.6;
      v.whistle.frequency.setTargetAtTime(1800 + boost * (4200 + this.fi * 600), t, 0.25);
      v.whistleG.gain.setTargetAtTime(boost * boost * lv([0, 0.035, 0.05], this.fi), t, 0.25);
      v.spoolF.frequency.setTargetAtTime(2000 + boost * 3000, t, 0.25);
      // hiss under the whistle; more reads as static, so it stops growing past pro
      v.spoolG.gain.setTargetAtTime(boost * lv([0, 0.06, 0.1], Math.min(2, this.fi)), t, 0.25);
    }
    if (this.ex) {
      // Crackle on lift-off or a sudden rpm drop; the odd pop while coasting high.
      const lift = this.lastThr > 0.5 && thr < 0.25;
      const drop = this.lastRpm - r > 0.06;
      if ((lift || drop) && t > this.crackleAt) {
        this.crackleAt = t + 0.35;
        crackle(Math.round(this.ex * 3), 0.3, 0.6 + 0.2 * this.ex, rel);
      } else if (thr < 0.25 && r > 0.35 && Math.random() < 0.012 * this.ex) pop(0.5, rel);
    }
    this.lastThr = thr;
    this.lastRpm = r;
  }

  /** Tyre squeal amount 0..1 (wheelspin / burnout). */
  setSqueal(amount: number) {
    const c = this.c;
    const v = this.v;
    if (!c || !v) return;
    const a = Math.max(0, Math.min(1, amount || 0));
    const t = c.currentTime;
    v.sqF.frequency.setTargetAtTime(1900 + a * 700, t, 0.05);
    v.sqG.gain.setTargetAtTime(a * 1.1, t, 0.04);
  }

  /** Turbo dump: whistle cut + blow-off pssh. No-op without a turbo. */
  blowOff(at?: number) {
    const c = this.c;
    const v = this.v;
    if (!c || !v || !this.fi || !v.whistleG || !v.spoolG) return;
    const t = Math.max(c.currentTime, at ?? 0);
    this.dumpUntil = t + 0.25;
    v.whistleG.gain.setTargetAtTime(0, t, 0.02);
    v.spoolG.gain.setTargetAtTime(0, t, 0.02);
    blowOff((0.5 + 0.25 * Math.min(2, this.fi)) * (this.s.bov ?? 1), t - c.currentTime);
  }

  /** Schedule the output level: [context time, gain] points, linear between them (one-shots fade the engine in/out). */
  gateAt(pts: [number, number][]) {
    const v = this.v;
    if (!v) return;
    v.gate.gain.cancelScheduledValues(0);
    v.gate.gain.setValueAtTime(pts[0][1], pts[0][0]);
    for (const [t, g] of pts.slice(1)) v.gate.gain.linearRampToValueAtTime(g, t);
  }

  /** Stop at a context time (scheduled, so it also works in an offline render). */
  stopAt(when: number) {
    const c = this.c;
    const v = this.v;
    if (!c || !v) return;
    this.v = undefined;
    v.srcs.forEach((s) => {
      try {
        s.stop(when);
      } catch {
        /* already stopped */
      }
    });
    v.srcs[v.srcs.length - 1].onended = () => {
      v.srcs.forEach((s) => s.disconnect());
      v.nodes.forEach((n) => n.disconnect());
    };
  }

  /** Shift event: blow-off valve if turbo, sequential clack, exhaust crackle by tier. Layered on sfx.shift(). */
  shift(grade: 'perfect' | 'good' | 'miss') {
    const c = this.c;
    if (!c || !this.v) return;
    try {
      this.blowOff();
      if (this.tr >= 1.5) {
        noiseHit(0.03, 2800, 2.5, this.tr >= 2 ? 1.3 : 1, 0, undefined, 0.001);
        tone(170, 0.05, 'square', this.tr >= 2 ? 0.12 : 0.09);
      } else if (this.tr >= 1) noiseHit(0.03, 1800, 2, 0.7, 0, undefined, 0.002);
      if (this.ex) {
        crackle(Math.round(this.ex * 2), 0.18, 0.6 + 0.2 * this.ex, 0.03);
        this.crackleAt = c.currentTime + 0.35;
      }
      if (grade === 'miss') grind();
    } catch {
      /* audio is optional */
    }
  }

  stop() {
    const c = this.c;
    const v = this.v;
    if (!c || !v) return;
    this.v = undefined;
    const t = c.currentTime;
    for (const g of [v.g, v.hissG, v.sqG, v.whistleG, v.spoolG, v.whineG]) g?.gain.setTargetAtTime(0, t, 0.08);
    setTimeout(() => {
      v.srcs.forEach((s) => {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
        s.disconnect();
      });
      v.nodes.forEach((n) => n.disconnect());
    }, 400);
  }
}

/** Dev check: plays fn's sounds into an offline context and returns the rendered mono buffer (null if unsupported). */
export async function renderOffline(fn: () => void, secs: number): Promise<AudioBuffer | null> {
  const prev = [ctx, master] as const;
  try {
    const off = new OfflineAudioContext(1, Math.ceil(44100 * secs), 44100);
    ctx = off;
    master = off.createGain();
    master.gain.value = VOL;
    master.connect(off.destination);
    fn();
    [ctx, master] = prev;
    return await off.startRendering();
  } catch {
    [ctx, master] = prev;
    return null;
  }
}
