// Cutscene sound design on the shared mixer (no audio files). Everything is synthesized here with its own
// small toolkit (Snd below) and plays through audioOut() from audio.ts, so mute and the master limiter apply.
// Each call schedules on the audio clock and returns at once; a silent "reaper" source disconnects the whole
// chain when the sound is over. Levels are set per sound so peaks land around 0.2-0.5 at the master input.
//
//   cutsceneSfx.slowmoIn(); cutsceneSfx.voice('olga', 'laugh'); cutsceneSfx.sting('rosa');
import { audioOut } from '../audio';
import type { CutsceneId } from './types';

/** [seconds after the sound starts, value, 'e' = exponential ramp into this point]. */
type Pt = [number, number] | [number, number, 'e' | 'l'];
type Env = number | Pt[];

interface Out {
  c: BaseAudioContext;
  out: AudioNode;
}

let forced: Out | null = null;
/** Every live cutscene sound goes through one sub-bus per context, so hush() can fade them all at once. */
const buses = new WeakMap<BaseAudioContext, { out: AudioNode; g: GainNode }>();
function target(): Out | null {
  if (forced) return forced;
  try {
    const a = audioOut();
    if (!a) return null;
    let b = buses.get(a.ctx);
    if (!b || b.out !== a.out) {
      const g = a.ctx.createGain();
      g.connect(a.out);
      b = { out: a.out, g };
      buses.set(a.ctx, b);
    }
    return { c: a.ctx, out: b.g };
  } catch {
    return null;
  }
}

const noiseBufs = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuf(c: BaseAudioContext): AudioBuffer {
  let b = noiseBufs.get(c);
  if (!b) {
    b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBufs.set(c, b);
  }
  return b;
}

const curves = new Map<number, Float32Array>();
function driveCurve(k: number): Float32Array {
  let cv = curves.get(k);
  if (!cv) {
    cv = new Float32Array(1024);
    const n = Math.tanh(k);
    for (let i = 0; i < cv.length; i++) cv[i] = Math.tanh(((i / (cv.length - 1)) * 2 - 1) * k) / n;
    curves.set(k, cv);
  }
  return cv;
}

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const lastT = (e: Env) => (typeof e === 'number' ? 0 : e[e.length - 1][0]);
const firstT = (e: Env) => (typeof e === 'number' ? 0 : e[0][0]);

/** One sound: a level-set bus into the mixer plus everything scheduled on it, torn down together. */
class Snd {
  readonly t: number;
  readonly bus: GainNode;
  private nodes: AudioNode[] = [];
  private end = 0;

  constructor(
    readonly c: BaseAudioContext,
    out: AudioNode,
    level: number,
  ) {
    this.t = c.currentTime + 0.02;
    this.bus = c.createGain();
    this.bus.gain.value = level;
    this.bus.connect(out);
    this.nodes.push(this.bus);
  }

  /** Automate a param along an envelope (times relative to the sound). Frequencies ramp exponentially. */
  auto(p: AudioParam, e: Env, exp = false) {
    if (typeof e === 'number') {
      p.setValueAtTime(e, this.t);
      return;
    }
    p.setValueAtTime(e[0][1], this.t + e[0][0]);
    for (const pt of e.slice(1)) {
      const mode = pt[2] ?? (exp ? 'e' : 'l');
      if (mode === 'e') p.exponentialRampToValueAtTime(Math.max(1e-4, pt[1]), this.t + pt[0]);
      else p.linearRampToValueAtTime(pt[1], this.t + pt[0]);
    }
  }

  keep<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  gain(e: Env, dest: AudioNode = this.bus): GainNode {
    const g = this.keep(this.c.createGain());
    this.auto(g.gain, e);
    g.connect(dest);
    return g;
  }

  filter(type: BiquadFilterType, f: Env, q: number, dest: AudioNode = this.bus): BiquadFilterNode {
    const n = this.keep(this.c.createBiquadFilter());
    n.type = type;
    this.auto(n.frequency, f, true);
    n.Q.value = q;
    n.connect(dest);
    return n;
  }

  shaper(k: number, dest: AudioNode = this.bus): WaveShaperNode {
    const w = this.keep(this.c.createWaveShaper());
    w.curve = driveCurve(k);
    w.oversample = '2x';
    w.connect(dest);
    return w;
  }

  /** Start/stop a source (relative times) and drop it from the graph when it ends. */
  run(src: AudioScheduledSourceNode, start: number, stop: number) {
    src.start(this.t + Math.max(0, start));
    src.stop(this.t + stop + 0.03);
    src.onended = () => src.disconnect();
    this.end = Math.max(this.end, stop + 0.05);
  }

  /** Oscillator with a frequency envelope through an amplitude envelope (which sets its lifetime). */
  osc(type: OscillatorType, f: Env, amp: Pt[], dest: AudioNode = this.bus, detune = 0): OscillatorNode {
    const o = this.c.createOscillator();
    o.type = type;
    o.detune.value = detune;
    this.auto(o.frequency, f, true);
    o.connect(this.gain(amp, dest));
    this.run(o, firstT(amp), lastT(amp));
    return o;
  }

  /** Looping white noise, optionally filtered, through an amplitude envelope. */
  noise(amp: Pt[], dest: AudioNode = this.bus, filt?: { type: BiquadFilterType; f: Env; q?: number }): AudioBufferSourceNode {
    const s = this.c.createBufferSource();
    s.buffer = noiseBuf(this.c);
    s.loop = true;
    s.playbackRate.value = rnd(0.9, 1.1);
    const g = this.gain(amp, dest);
    s.connect(filt ? this.filter(filt.type, filt.f, filt.q ?? 1, g) : g);
    const t0 = firstT(amp);
    s.start(this.t + Math.max(0, t0), Math.random() * 1.8);
    s.stop(this.t + lastT(amp) + 0.03);
    s.onended = () => s.disconnect();
    this.end = Math.max(this.end, lastT(amp) + 0.05);
    return s;
  }

  /** Low-frequency oscillator added onto a param, depth enveloped, between start and stop. */
  lfo(p: AudioParam, rate: Env, depth: Env, start: number, stop: number, type: OscillatorType = 'sine') {
    const o = this.c.createOscillator();
    o.type = type;
    this.auto(o.frequency, rate, true);
    const g = this.keep(this.c.createGain());
    this.auto(g.gain, depth);
    o.connect(g).connect(p);
    this.run(o, start, stop);
  }

  /** A gain stage wobbling around 1 (tremolo / chug / limiter chop). */
  am(rate: Env, depth: Env, start: number, stop: number, dest: AudioNode = this.bus, type: OscillatorType = 'sine'): GainNode {
    const g = this.keep(this.c.createGain());
    g.gain.value = 1;
    g.connect(dest);
    this.lfo(g.gain, rate, depth, start, stop, type);
    return g;
  }

  /** Disconnect everything once the last source has finished. */
  finish() {
    const c = this.c;
    const r = typeof c.createConstantSource === 'function' ? c.createConstantSource() : c.createOscillator();
    const z = c.createGain();
    z.gain.value = 0;
    r.connect(z).connect(this.bus);
    r.start(this.t);
    r.stop(this.t + this.end + 0.1);
    const nodes = this.nodes;
    r.onended = () => {
      r.disconnect();
      z.disconnect();
      nodes.forEach((n) => n.disconnect());
    };
  }
}

/** Build one sound on the mixer. Never throws; does nothing if audio is unavailable. */
function play(level: number, fn: (s: Snd) => void): Snd | null {
  const o = target();
  if (!o) return null;
  let s: Snd | null = null;
  try {
    s = new Snd(o.c, o.out, level);
    fn(s);
  } catch {
    /* audio hiccup: keep the cutscene going */
  }
  try {
    s?.finish();
  } catch {
    /* ignore */
  }
  return s;
}

// ---------------------------------------------------------------- building blocks

/** Short noise pop (exhaust crackle). */
function pop(s: Snd, t: number, vol: number, f = rnd(900, 2600)) {
  s.noise([[t, 0], [t + 0.002, vol], [t + rnd(0.02, 0.05), 0.0001, 'e']], s.bus, { type: 'bandpass', f, q: 1.2 });
  s.osc('sine', [[t, rnd(90, 140)], [t + 0.05, 45]], [[t, 0], [t + 0.003, vol * 0.6], [t + 0.06, 0.0001, 'e']]);
}

function crackles(s: Snd, from: number, to: number, n: number, vol: number, f?: [number, number]) {
  for (let i = 0; i < n; i++) pop(s, rnd(from, to), vol * rnd(0.5, 1), f ? rnd(f[0], f[1]) : undefined);
}

/** Heartbeat-ish / kick thump. */
function thump(s: Snd, t: number, vol: number, f0 = 80, f1 = 36, len = 0.2) {
  s.osc('sine', [[t, f0], [t + len * 0.7, f1]], [[t, 0], [t + 0.005, vol], [t + len, 0.0001, 'e']]);
  s.noise([[t, 0], [t + 0.001, vol * 0.35], [t + 0.02, 0.0001, 'e']], s.bus, { type: 'lowpass', f: 1800 });
}

interface EngineSpec {
  /** Firing frequency envelope (Hz). */
  f: Pt[];
  amp: Pt[];
  /** Lowpass cutoff envelope. */
  lp: Pt[];
  q?: number;
  drive: number;
  /** Second sawtooth detune (cents) for a fat, multi-cylinder sound. */
  spread?: number;
  /** Square an octave down, 0..1. */
  sub?: number;
  /** Combustion chug: amplitude wobble rate envelope and depth. */
  chug?: { rate: Env; depth: Env };
}

function engine(s: Snd, e: EngineSpec) {
  const t0 = e.amp[0][0];
  const t1 = lastT(e.amp);
  const out = s.gain(e.amp);
  const ch = e.chug ? s.am(e.chug.rate, e.chug.depth, t0, t1, out, 'triangle') : out;
  const lp = s.filter('lowpass', e.lp, e.q ?? 2, ch);
  const sh = s.shaper(e.drive, lp);
  const flat: Pt[] = [[t0, 0.5], [t1, 0.5]];
  s.osc('sawtooth', e.f, flat, sh);
  if (e.spread) s.osc('sawtooth', e.f, flat, sh, e.spread);
  if (e.sub) s.osc('square', e.f, [[t0, 0.5 * e.sub], [t1, 0.5 * e.sub]], sh, -1200);
}

/** Rising noise + pitch riser with an accelerating snare roll, landing at `dur`. */
function riser(s: Snd, dur: number, vol: number, top = 6000) {
  s.noise([[0, 0.0005], [dur, vol, 'e'], [dur + 0.03, 0]], s.bus, { type: 'highpass', f: [[0, 300], [dur, top]], q: 0.8 });
  const bp = s.filter('bandpass', [[0, 300], [dur, 3000]], 3);
  s.osc('sawtooth', [[0, 110], [dur, 880]], [[0, 0.0005], [dur, vol * 0.9, 'e'], [dur + 0.02, 0]], bp);
  s.osc('sawtooth', [[0, 111], [dur, 1320]], [[0, 0.0005], [dur, vol * 0.6, 'e'], [dur + 0.02, 0]], bp);
  // Snare roll: hits get closer together and louder into the drop.
  let t = 0;
  let gap = dur / 5;
  while (t < dur - 0.03) {
    const v = vol * (0.25 + 0.75 * (t / dur));
    s.noise([[t, 0], [t + 0.002, v], [t + 0.07, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 2200, q: 0.7 });
    t += gap;
    gap = Math.max(0.03, gap * 0.78);
  }
}

/** Brassy chord stab: detuned saws through a plucked lowpass. */
function stab(s: Snd, t: number, notes: number[], len: number, vol: number, bright = 7000) {
  const lp = s.filter('lowpass', [[t, bright], [t + len * 0.7, 700]], 3);
  const env = s.gain([[t, 0], [t + 0.006, vol], [t + 0.18, vol * 0.55], [t + len, 0.0001, 'e']], lp);
  for (const m of notes) {
    for (const d of [-14, 14]) s.osc('sawtooth', mtof(m), [[t, 0.3], [t + len, 0.3]], env, d);
    s.osc('square', mtof(m), [[t, 0.12], [t + len, 0.12]], env);
  }
}

/** Gong / tam-tam: inharmonic beating partials with a long decay. */
function gong(s: Snd, t: number, f0: number, len: number, vol: number) {
  const parts: [number, number, number][] = [
    [1, 1, 1],
    [1.48, 0.7, 0.85],
    [2.09, 0.55, 0.7],
    [2.56, 0.45, 0.55],
    [3.12, 0.35, 0.45],
    [4.2, 0.25, 0.35],
    [5.4, 0.18, 0.25],
  ];
  for (const [r, v, d] of parts) {
    for (const dt of [-1.5, 1.5]) {
      const f = f0 * r + dt;
      s.osc('sine', [[t, f * 0.97], [t + 0.4, f]], [[t, 0], [t + 0.01, vol * v * 0.5], [t + len * d, 0.0001, 'e']]);
    }
  }
  s.noise([[t, 0], [t + 0.003, vol * 0.8], [t + 0.5, 0.0001, 'e']], s.bus, { type: 'bandpass', f: f0 * 6, q: 0.8 });
}

/** Sub bass drop. */
function drop(s: Snd, t: number, f0: number, len: number, vol: number) {
  s.osc('sine', [[t, f0], [t + len * 0.8, f0 / 3.5]], [[t, 0], [t + 0.008, vol], [t + len * 0.4, vol * 0.7], [t + len, 0.0001, 'e']]);
  const sh = s.shaper(3, s.filter('lowpass', [[t, 900], [t + len, 120]], 1));
  s.osc('triangle', [[t, f0], [t + len * 0.8, f0 / 3.5]], [[t, 0], [t + 0.008, vol * 0.4], [t + len * 0.7, 0.0001, 'e']], sh);
}

/** Cymbal-ish crash. */
function crash(s: Snd, t: number, len: number, vol: number) {
  s.noise([[t, 0], [t + 0.003, vol], [t + 0.12, vol * 0.45], [t + len, 0.0001, 'e']], s.bus, {
    type: 'highpass',
    f: [[t, 3000], [t + len, 6000]],
    q: 0.7,
  });
}

// ---------------------------------------------------------------- voices

type Vowel = 'a' | 'e' | 'i' | 'o' | 'u' | 'm' | 'ae';
/** Formant centres (Hz) for an adult voice; each character scales them. */
const FORMANTS: Record<Vowel, [number, number, number]> = {
  a: [760, 1150, 2500],
  ae: [660, 1720, 2410],
  e: [530, 1840, 2480],
  i: [300, 2250, 3000],
  o: [540, 880, 2400],
  u: [330, 800, 2240],
  m: [260, 1000, 2300],
};
const FORMANT_GAIN = [1, 0.55, 0.28];
const FORMANT_Q = [5, 8, 11];

/**
 * consonant, vowel ('' = consonant only), seconds, pitch start, pitch end (x f0), loudness, gap after, and an optional
 * `true` = played BACKWARDS (Vera): the vowel swells in and cuts off dead, the pitch runs end-to-start, the consonant
 * comes after it as a sucked-in burst.
 */
type Syl = [string, Vowel | '', number, number, number, number, number, boolean?];

interface VoiceSpec {
  f0: number;
  /** Formant scale (bigger = smaller head, cartoonier). */
  fs: number;
  breath: number;
  vib: number;
  sub?: number;
  drive?: number;
  /** Seconds per syllable release (Rosa clips hers). */
  rel: number;
  /** Lowpass cutoff (Hz) to round the voice off (the sweet lines). */
  soft?: number;
  /** Nasal honk 0..1: a narrow boost up top and a scooped-out low-mid (Pivot, Rick, Baron). */
  nasal?: number;
  /** Band-limit [highpass, lowpass] Hz: a mic / megaphone (DJ). */
  band?: [number, number];
  /** Voiced (buzz) level x1; below 1 leaves mostly breath, a whisper (Deacon). */
  voiced?: number;
  /** Feedback delays [seconds, feedback, wet] after the voice: a hollow tube or a crypt echo (Deacon). */
  combs?: [number, number, number][];
}

const VOICES: Partial<Record<CutsceneId, VoiceSpec>> = {
  buckshot: { f0: 96, fs: 0.95, breath: 0.12, vib: 14, rel: 0.06 },
  olga: { f0: 290, fs: 1.3, breath: 0.3, vib: 45, rel: 0.03 },
  gus: { f0: 74, fs: 0.82, breath: 0.18, vib: 20, sub: 0.6, drive: 2.5, rel: 0.08 },
  rosa: { f0: 180, fs: 1.1, breath: 0.1, vib: 8, rel: 0.012 },
  // Nasal, pompous professor: honky, precise, a lecturing sing-song.
  pivot: { f0: 128, fs: 1.08, breath: 0.08, vib: 10, rel: 0.05, nasal: 1 },
  // Theatrical showman: big chest voice, wide stage vibrato.
  flashini: { f0: 150, fs: 1.0, breath: 0.14, vib: 42, rel: 0.1 },
  // Squeaky, fast, furious little guy.
  sal: { f0: 330, fs: 1.48, breath: 0.12, vib: 25, rel: 0.02, drive: 1.6 },
  // Breathy diva, airy and soft-edged; some syllables play backwards.
  vera: { f0: 250, fs: 1.18, breath: 0.55, vib: 22, rel: 0.1, soft: 4200 },
  // Hype-man on the mic: shouted, driven, band-limited; lines end in a pitched-down "drop".
  dj: { f0: 138, fs: 1.0, breath: 0.2, vib: 12, rel: 0.04, drive: 3, band: [260, 3600] },
  // Smarmy salesman: smooth, oily glides, a touch of honk.
  rick: { f0: 118, fs: 1.02, breath: 0.15, vib: 16, rel: 0.08, nasal: 0.35 },
  // Deep, slow, hollow whisper: mostly breath, a low buzz under it, a tube resonance and a crypt echo.
  deacon: { f0: 52, fs: 0.8, breath: 0.95, vib: 5, rel: 0.2, voiced: 0.4, sub: 0.6, combs: [[0.0085, 0.55, 0.5], [0.23, 0.3, 0.3]] },
  // Haughty, posh aristocrat: plummy rounded vowels, big disdainful pitch falls.
  baron: { f0: 104, fs: 0.95, breath: 0.1, vib: 24, rel: 0.12, nasal: 0.25, soft: 3800 },
  // Gruff, strong alto: driven, a bit of chest sub, clipped.
  ivy: { f0: 150, fs: 1.04, breath: 0.16, vib: 9, rel: 0.02, drive: 2.2, sub: 0.3 },
};

/** Bus level per line, measured so peaks sit near 0.4 at the master input (yells a touch hotter). */
const VOICE_LEVEL: Partial<Record<CutsceneId, Record<'taunt' | 'laugh' | 'yell', number>>> = {
  buckshot: { taunt: 0.35, laugh: 0.38, yell: 0.3 },
  olga: { taunt: 0.22, laugh: 0.27, yell: 0.25 },
  gus: { taunt: 0.4, laugh: 0.4, yell: 0.45 },
  rosa: { taunt: 0.35, laugh: 0.44, yell: 0.28 },
  pivot: { taunt: 0.397, laugh: 0.446, yell: 0.338 },
  flashini: { taunt: 0.323, laugh: 0.302, yell: 0.332 },
  sal: { taunt: 0.399, laugh: 0.397, yell: 0.447 },
  vera: { taunt: 0.238, laugh: 0.328, yell: 0.238 },
  dj: { taunt: 0.168, laugh: 0.171, yell: 0.2 },
  rick: { taunt: 0.369, laugh: 0.453, yell: 0.391 },
  deacon: { taunt: 0.39, laugh: 0.5, yell: 0.388 },
  baron: { taunt: 0.343, laugh: 0.38, yell: 0.316 },
  ivy: { taunt: 0.4, laugh: 0.4, yell: 0.448 },
};

const GLIDE: Record<string, Vowel> = { y: 'i', w: 'u', l: 'e', r: 'o', b: 'u', m: 'm' };

/** Random babble in a character's style. */
function babble(n: number, o: { d: [number, number]; p: [number, number]; vowels: Vowel[]; cons: string[]; gap: [number, number]; fall?: number }): Syl[] {
  const out: Syl[] = [];
  let p = rnd(o.p[0], o.p[1]);
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    const p1 = last && o.fall ? p * o.fall : rnd(o.p[0], o.p[1]);
    out.push([pick(o.cons), pick(o.vowels), rnd(o.d[0], o.d[1]) * (last ? 1.8 : 1), p, p1, rnd(0.75, 1), rnd(o.gap[0], o.gap[1])]);
    p = p1 * rnd(0.95, 1.1);
  }
  return out;
}

function line(id: CutsceneId, mood: 'taunt' | 'laugh' | 'yell'): { syls: Syl[]; growl: number } {
  switch (id) {
    case 'buckshot':
      // Low, slow, smug drawl.
      if (mood === 'taunt')
        return {
          growl: 0,
          syls: [
            ['', 'm', 0.34, 1.0, 0.86, 0.75, 0],
            ['p', '', 0.07, 1, 1, 0.6, 0.18],
            ['w', 'a', 0.3, 1.08, 0.92, 1, 0.04],
            ['l', 'ae', 0.26, 0.95, 0.88, 0.9, 0.06],
            ...babble(2, { d: [0.16, 0.22], p: [0.9, 1.05], vowels: ['a', 'o', 'u'], cons: ['d', 'g', 'n', ''], gap: [0.04, 0.08] }),
            ['', 'o', 0.48, 0.92, 0.7, 1, 0],
          ],
        };
      if (mood === 'laugh')
        return {
          growl: 0.2,
          syls: [
            ['h', 'e', 0.15, 1.08, 0.98, 0.9, 0.1],
            ['h', 'e', 0.15, 1.02, 0.94, 0.85, 0.1],
            ['h', 'a', 0.17, 0.98, 0.88, 0.8, 0.14],
            ['', 'm', 0.42, 0.92, 0.78, 0.7, 0],
            ['p', '', 0.08, 1, 1, 0.5, 0],
          ],
        };
      return {
        growl: 0.35,
        syls: [
          ['y', 'i', 0.36, 1.5, 2.2, 1, 0.04],
          ['h', 'a', 0.62, 2.3, 1.45, 1, 0],
        ],
      };
    case 'olga':
      // High, manic, fast.
      if (mood === 'laugh') {
        const syls: Syl[] = [];
        for (let i = 0; i < 10; i++) {
          const p = 1 + 0.75 * Math.sin((i / 9) * Math.PI * 0.85) + rnd(-0.06, 0.06);
          syls.push(['h', i % 3 === 2 ? 'i' : 'e', 0.075, p, p * 0.94, rnd(0.8, 1), 0.025]);
        }
        syls.push(['h', 'i', 0.36, 1.85, 2.3, 1, 0]);
        return { growl: 0, syls };
      }
      if (mood === 'taunt')
        return {
          growl: 0,
          syls: [
            ...babble(7, { d: [0.07, 0.11], p: [0.9, 1.8], vowels: ['i', 'e', 'a', 'ae', 'o'], cons: ['t', 'k', 'b', 'l', 's', ''], gap: [0.01, 0.04] }),
            ['', 'i', 0.25, 1.4, 2.0, 1, 0],
          ],
        };
      return {
        growl: 0.15,
        syls: [
          ['y', 'a', 0.65, 1.5, 2.0, 1, 0],
          ['h', 'a', 0.13, 1.8, 1.4, 0.9, 0.02],
          ['h', 'a', 0.13, 1.7, 1.3, 0.85, 0],
        ],
      };
    case 'gus':
      // Booming bellow.
      if (mood === 'yell')
        return {
          growl: 0.45,
          syls: [
            ['h', 'u', 0.26, 0.9, 1.25, 1, 0],
            ['', 'o', 0.3, 1.25, 1.55, 1, 0],
            ['', 'a', 0.9, 1.6, 1.25, 1, 0],
          ],
        };
      if (mood === 'laugh')
        return {
          growl: 0.25,
          syls: [
            ['h', 'o', 0.22, 1.18, 1.05, 1, 0.1],
            ['h', 'o', 0.22, 1.12, 1.0, 0.95, 0.1],
            ['h', 'o', 0.22, 1.08, 0.97, 0.95, 0.1],
            ['h', 'o', 0.55, 1.22, 0.85, 1, 0],
          ],
        };
      return {
        growl: 0.2,
        syls: [
          ['b', 'a', 0.34, 1.15, 0.95, 1, 0.08],
          ['h', 'o', 0.26, 0.95, 0.85, 0.9, 0.06],
          ...babble(2, { d: [0.18, 0.24], p: [0.85, 1.1], vowels: ['o', 'u', 'a'], cons: ['g', 'd', 'b', 'h'], gap: [0.04, 0.08] }),
          ['h', 'u', 0.45, 1.05, 0.72, 1, 0],
        ],
      };
    case 'rosa':
      // Cool, clipped, menacing alto.
      if (mood === 'taunt')
        return {
          growl: 0,
          syls: [
            ['t', 'a', 0.11, 1.0, 0.98, 1, 0.035],
            ['k', 'e', 0.1, 1.03, 0.98, 0.9, 0.035],
            ['r', 'i', 0.09, 1.05, 1.0, 0.85, 0.16],
            ['sh', 'a', 0.13, 0.96, 0.88, 1, 0.04],
            ['', 'o', 0.24, 0.86, 0.68, 1, 0],
          ],
        };
      if (mood === 'laugh')
        return {
          growl: 0.1,
          syls: [
            ['h', 'e', 0.12, 0.82, 0.76, 0.85, 0.24],
            ['h', 'e', 0.1, 0.84, 0.79, 0.8, 0.07],
            ['h', 'e', 0.14, 0.8, 0.66, 0.8, 0.1],
            ['', 'm', 0.32, 0.74, 0.66, 0.7, 0],
          ],
        };
      return {
        growl: 0.4,
        syls: [
          ['k', 'a', 0.34, 1.55, 1.2, 1, 0.05],
          ['t', 'a', 0.1, 1.1, 0.9, 0.8, 0],
        ],
      };
    case 'pivot':
      // "A-hem." then a lecture, every phrase ending on a pompous downward flourish.
      if (mood === 'taunt')
        return {
          growl: 0,
          syls: [
            ['h', 'a', 0.07, 1.0, 1.05, 0.6, 0],
            ['', 'm', 0.2, 1.22, 0.95, 0.8, 0.18],
            ['l', 'e', 0.11, 1.1, 1.2, 0.9, 0.02],
            ['k', 'i', 0.09, 1.25, 1.3, 0.85, 0.02],
            ['t', 'a', 0.1, 1.3, 1.15, 0.9, 0.08],
            ['p', 'i', 0.1, 1.4, 1.45, 0.9, 0.02],
            ['', 'o', 0.36, 1.45, 0.85, 1, 0],
          ],
        };
      if (mood === 'laugh')
        return {
          growl: 0,
          syls: [
            ['m', 'e', 0.08, 1.35, 1.3, 0.85, 0.04],
            ['h', 'e', 0.08, 1.3, 1.25, 0.85, 0.04],
            ['h', 'e', 0.08, 1.26, 1.2, 0.8, 0.04],
            ['h', 'e', 0.08, 1.2, 1.12, 0.8, 0.07],
            ['', 'm', 0.32, 1.15, 0.95, 0.7, 0],
          ],
        };
      return {
        growl: 0.2,
        syls: [
          ['w', 'a', 0.22, 1.4, 1.9, 1, 0],
          ['', 'o', 0.45, 1.95, 1.3, 1, 0],
        ],
      };
    case 'flashini':
      // A rolling patter, then the big "ta-DAAAA".
      if (mood === 'taunt')
        return {
          growl: 0,
          syls: [
            ...babble(3, { d: [0.09, 0.12], p: [0.95, 1.25], vowels: ['a', 'e', 'o'], cons: ['l', 'k', 'b', 'm'], gap: [0.02, 0.04] }),
            ['s', 'a', 0.16, 1.2, 1.35, 1, 0.14],
            ['t', 'a', 0.12, 0.95, 0.95, 0.85, 0.07],
            ['d', 'a', 0.72, 1.55, 1.65, 1, 0],
          ],
        };
      if (mood === 'laugh')
        return {
          growl: 0.1,
          syls: [
            ['m', 'u', 0.06, 1.0, 1.05, 0.8, 0],
            ['', 'a', 0.18, 1.1, 1.0, 1, 0.05],
            ['h', 'a', 0.11, 1.18, 1.12, 0.9, 0.04],
            ['h', 'a', 0.11, 1.3, 1.24, 0.9, 0.04],
            ['h', 'a', 0.12, 1.45, 1.38, 0.95, 0.04],
            ['h', 'a', 0.55, 1.7, 1.2, 1, 0],
          ],
        };
      return {
        growl: 0.15,
        syls: [
          ['b', 'o', 0.2, 1.3, 1.6, 1, 0],
          ['l', 'a', 0.7, 1.9, 1.55, 1, 0],
        ],
      };
    case 'sal':
      // Rapid-fire, squeaky and furious.
      if (mood === 'taunt')
        return {
          growl: 0.22,
          syls: [
            ...babble(9, { d: [0.045, 0.07], p: [0.95, 1.55], vowels: ['a', 'e', 'ae', 'i', 'o'], cons: ['t', 'k', 'p', 'b', 'd', 'g', ''], gap: [0.008, 0.025] }),
            ['', 'a', 0.22, 1.65, 1.2, 1, 0],
          ],
        };
      if (mood === 'laugh') {
        const syls: Syl[] = [];
        for (let i = 0; i < 8; i++) syls.push(['h', i % 2 ? 'e' : 'i', 0.045, 1.35 + i * 0.03, 1.3 + i * 0.03, rnd(0.8, 1), 0.02]);
        syls.push(['h', 'i', 0.25, 1.7, 2.3, 1, 0]);
        return { growl: 0.15, syls };
      }
      return {
        growl: 0.5,
        syls: [
          ['y', 'a', 0.4, 1.6, 2.3, 1, 0],
          ['h', 'a', 0.14, 2.0, 1.5, 0.9, 0],
        ],
      };
    case 'vera':
      // Breathy diva: the first half of the taunt runs backwards, then a forward melisma.
      if (mood === 'taunt')
        return {
          growl: 0,
          syls: [
            ['h', 'a', 0.3, 1.25, 0.9, 0.95, 0.04, true],
            ['s', 'i', 0.24, 1.35, 1.05, 0.85, 0.12, true],
            ['m', 'a', 0.16, 1.1, 1.25, 0.9, 0.02],
            ['h', 'i', 0.16, 1.4, 1.5, 0.85, 0.02],
            ['', 'a', 0.5, 1.5, 1.05, 1, 0],
          ],
        };
      if (mood === 'laugh')
        return {
          growl: 0,
          syls: [
            ['h', 'a', 0.17, 1.6, 1.4, 0.85, 0.02, true],
            ['h', 'a', 0.17, 1.52, 1.32, 0.9, 0.02, true],
            ['h', 'a', 0.19, 1.45, 1.22, 0.95, 0.02, true],
            ['h', 'a', 0.34, 1.6, 1.1, 1, 0.08, true],
            ['', 'm', 0.3, 1.2, 1.0, 0.4, 0],
          ],
        };
      return {
        growl: 0.1,
        syls: [
          ['', 'a', 0.25, 1.6, 2.0, 1, 0],
          ['', 'a', 0.55, 2.0, 1.9, 1, 0.03],
          ['h', 'a', 0.3, 1.9, 1.2, 0.85, 0, true],
        ],
      };
    case 'dj':
      // Hype-man shouts, each line pitched down at the end like a turntable winding down (the "drop").
      if (mood === 'taunt')
        return {
          growl: 0.1,
          syls: [
            ['y', 'o', 0.14, 1.3, 1.42, 1, 0.05],
            ['y', 'o', 0.14, 1.36, 1.5, 1, 0.12],
            ['h', 'a', 0.1, 1.2, 1.25, 0.9, 0.03],
            ['b', 'a', 0.1, 1.25, 1.3, 0.9, 0.03],
            ['d', 'a', 0.85, 1.55, 0.28, 1, 0],
          ],
        };
      if (mood === 'laugh')
        return {
          growl: 0.15,
          syls: [
            ['h', 'a', 0.12, 1.3, 1.22, 1, 0.07],
            ['h', 'a', 0.12, 1.34, 1.25, 1, 0.07],
            ['h', 'a', 0.12, 1.38, 1.3, 1, 0.07],
            ['h', 'a', 0.6, 1.45, 0.32, 1, 0],
          ],
        };
      return {
        growl: 0.2,
        syls: [
          ['w', 'u', 0.25, 1.3, 2.0, 1, 0],
          ['', 'o', 0.7, 2.0, 0.35, 1, 0],
        ],
      };
    case 'rick':
      // Oily "heyyy", a fast smooth pitch, a slick sign-off.
      if (mood === 'taunt')
        return {
          growl: 0,
          syls: [
            ['h', 'e', 0.32, 0.95, 1.28, 1, 0],
            ['', 'i', 0.18, 1.28, 1.12, 0.8, 0.12],
            ...babble(3, { d: [0.07, 0.1], p: [1.0, 1.2], vowels: ['a', 'e', 'i'], cons: ['s', 'b', 'l', 'w', 'd'], gap: [0.015, 0.03] }),
            ['sh', 'a', 0.12, 1.15, 1.2, 0.9, 0.02],
            ['', 'o', 0.36, 1.2, 0.82, 1, 0],
          ],
        };
      if (mood === 'laugh')
        return {
          growl: 0,
          syls: [
            ['h', 'e', 0.09, 1.0, 0.95, 0.8, 0.07],
            ['h', 'e', 0.09, 0.98, 0.93, 0.8, 0.07],
            ['h', 'e', 0.09, 0.96, 0.9, 0.8, 0.09],
            ['', 'm', 0.38, 1.0, 1.25, 0.7, 0],
          ],
        };
      return {
        growl: 0.15,
        syls: [
          ['w', 'o', 0.3, 1.2, 1.7, 1, 0.02],
          ['h', 'o', 0.38, 1.65, 1.1, 1, 0],
        ],
      };
    case 'deacon':
      // Slow, deep, hollow whisper; every phrase sinks.
      if (mood === 'taunt')
        return {
          growl: 0,
          syls: [
            ['', 'm', 0.3, 1.0, 0.95, 0.7, 0.08],
            ['h', 'u', 0.4, 1.0, 0.9, 1, 0.12],
            ['sh', 'a', 0.42, 0.96, 0.86, 1, 0.08],
            ['', 'o', 0.6, 0.92, 0.72, 0.95, 0],
          ],
        };
      if (mood === 'laugh')
        return {
          growl: 0.1,
          syls: [
            ['h', 'e', 0.2, 1.05, 0.95, 0.9, 0.22],
            ['h', 'e', 0.2, 1.0, 0.9, 0.85, 0.22],
            ['h', 'e', 0.22, 0.95, 0.82, 0.8, 0.1],
            ['', 'm', 0.45, 0.85, 0.72, 0.6, 0],
          ],
        };
      return {
        growl: 0.3,
        syls: [['h', 'a', 0.95, 1.35, 0.95, 1, 0]],
      };
    case 'baron':
      // Plummy "oh-HO", a sneering phrase, a long disdainful fall.
      if (mood === 'taunt')
        return {
          growl: 0,
          syls: [
            ['', 'o', 0.24, 1.2, 1.4, 0.9, 0],
            ['h', 'o', 0.3, 1.5, 1.0, 1, 0.14],
            ['p', 'e', 0.1, 1.1, 1.1, 0.8, 0.02],
            ['b', 'i', 0.12, 1.15, 1.22, 0.85, 0.02],
            ['', 'a', 0.5, 1.28, 0.78, 1, 0],
          ],
        };
      if (mood === 'laugh')
        return {
          growl: 0,
          syls: [
            ['', 'a', 0.2, 1.5, 1.58, 0.9, 0.03],
            ['h', 'a', 0.09, 1.48, 1.42, 0.9, 0.03],
            ['h', 'a', 0.09, 1.38, 1.32, 0.88, 0.03],
            ['h', 'a', 0.09, 1.28, 1.22, 0.85, 0.03],
            ['h', 'a', 0.11, 1.18, 1.1, 0.85, 0.12],
            ['h', 'm', 0.26, 1.0, 0.84, 0.8, 0],
          ],
        };
      return {
        growl: 0.2,
        syls: [
          ['', 'i', 0.14, 1.4, 1.5, 1, 0.02],
          ['s', 'o', 0.2, 1.6, 1.72, 1, 0.02],
          ['l', 'e', 0.42, 1.9, 1.35, 1, 0],
        ],
      };
    case 'ivy':
      // Gruff, punchy, no wasted breath.
      if (mood === 'taunt')
        return {
          growl: 0.18,
          syls: [
            ['g', 'a', 0.13, 1.0, 0.95, 1, 0.04],
            ['d', 'o', 0.13, 0.98, 0.92, 1, 0.04],
            ['k', 'a', 0.11, 1.0, 0.95, 0.95, 0.14],
            ['b', 'u', 0.1, 0.95, 0.9, 0.85, 0.03],
            ['h', 'a', 0.3, 0.92, 0.7, 1, 0],
          ],
        };
      if (mood === 'laugh')
        return {
          growl: 0.3,
          syls: [
            ['h', 'a', 0.13, 0.95, 0.86, 1, 0.12],
            ['h', 'a', 0.13, 0.97, 0.87, 1, 0.12],
            ['h', 'a', 0.13, 0.99, 0.88, 1, 0.1],
            ['h', 'a', 0.3, 1.02, 0.74, 1, 0],
          ],
        };
      return {
        growl: 0.55,
        syls: [
          ['r', 'a', 0.6, 1.3, 1.6, 1, 0],
          ['g', 'a', 0.25, 1.5, 1.1, 1, 0],
        ],
      };
  }
  return line('buckshot', mood);
}

const CONS_DUR: Record<string, number> = { h: 0.05, t: 0.03, k: 0.035, p: 0.03, d: 0.02, g: 0.025, s: 0.08, sh: 0.09 };
const BURST_F: Record<string, number> = { t: 4200, k: 2300, p: 900, d: 3000, g: 1800, s: 6500, sh: 2800 };

/** Speak a line; returns its length in seconds. */
function speak(s: Snd, v: VoiceSpec, syls: Syl[], growl: number): number {
  const c = s.c;
  let total = 0;
  for (const y of syls) total += (CONS_DUR[y[0]] ?? 0) + y[2] + y[6];
  const end = total + 0.1;
  const vz = v.voiced ?? 1;

  // Character colour after the formants: echoes, nasal honk, mic band, softening.
  let dest: AudioNode = s.bus;
  if (v.combs?.length) {
    const dry = s.gain(1);
    for (const [dt, fb, wet] of v.combs) {
      const dl = s.keep(c.createDelay(1));
      dl.delayTime.value = dt;
      const fg = s.keep(c.createGain());
      fg.gain.value = fb;
      dry.connect(dl);
      dl.connect(fg);
      fg.connect(dl);
      dl.connect(s.gain(wet));
    }
    dest = dry;
  }
  if (v.band) dest = s.filter('highpass', v.band[0], 0.8, s.filter('lowpass', v.band[1], 0.9, dest));
  if (v.nasal) {
    const hi = s.filter('peaking', 1750, 3.5, dest);
    hi.gain.value = 14 * v.nasal;
    const lo = s.filter('peaking', 620, 1.6, hi);
    lo.gain.value = -12 * v.nasal;
    dest = lo;
  }
  const post = v.soft ? s.filter('lowpass', v.soft, 0.6, dest) : dest;
  const mix = v.drive ? s.shaper(v.drive, post) : post;
  const bank = FORMANT_Q.map((q, i) => s.filter('bandpass', FORMANTS.a[i] * v.fs, q, s.gain(FORMANT_GAIN[i] * 3, mix)));
  const into = s.keep(c.createGain());
  bank.forEach((f) => into.connect(f));
  const gr = growl ? s.am(rnd(28, 36), growl, 0, end, into, 'square') : into;

  const srcG = s.gain(0, gr);
  const src = c.createOscillator();
  src.type = 'sawtooth';
  src.frequency.setValueAtTime(v.f0 * syls[0][3], s.t);
  src.connect(srcG);
  s.run(src, 0, end);
  s.lfo(src.detune, 5.5, v.vib, 0, end);
  let sub: OscillatorNode | null = null;
  if (v.sub) {
    sub = c.createOscillator();
    sub.type = 'triangle';
    sub.frequency.setValueAtTime(v.f0 * syls[0][3] * 0.5, s.t);
    sub.connect(s.gain(v.sub, srcG));
    s.run(sub, 0, end);
  }

  const nz = c.createBufferSource();
  nz.buffer = noiseBuf(c);
  nz.loop = true;
  const breathG = s.gain(0, into);
  const sibG = s.gain(0);
  const sibF = s.filter('bandpass', 4000, 1.5, sibG);
  nz.connect(breathG);
  nz.connect(sibF);
  s.run(nz, 0, end);

  const T = (x: number) => s.t + x;
  let t = 0;
  let prevVoiced = false;
  syls.forEach(([cons, vow, d, p0, p1, a, gap, rev], i) => {
    const cd = CONS_DUR[cons] ?? 0;
    if (rev) {
      // Backwards: the vowel swells up out of nothing and stops dead, then the consonant is sucked in after it.
      const vowel: Vowel = vow || 'a';
      const vEnd = t + d;
      bank.forEach((f, k) => f.frequency.setTargetAtTime(FORMANTS[vowel][k] * v.fs, T(t), 0.012));
      const bf = v.breath * a;
      breathG.gain.setValueAtTime(Math.max(0.001, bf * 0.08), T(t));
      breathG.gain.exponentialRampToValueAtTime(Math.max(0.002, bf * 1.6), T(vEnd - 0.01));
      breathG.gain.linearRampToValueAtTime(0, T(vEnd));
      if (vow) {
        src.frequency.setValueAtTime(v.f0 * p1, T(t));
        src.frequency.exponentialRampToValueAtTime(v.f0 * p0, T(vEnd));
        srcG.gain.setValueAtTime(Math.max(0.001, a * vz * 0.06), T(t));
        srcG.gain.exponentialRampToValueAtTime(a * vz, T(vEnd - 0.012));
        srcG.gain.linearRampToValueAtTime(0, T(vEnd));
        if (sub) {
          sub.frequency.setValueAtTime(v.f0 * p1 * 0.5, T(t));
          sub.frequency.exponentialRampToValueAtTime(v.f0 * p0 * 0.5, T(vEnd));
        }
      }
      if (cons === 'h') {
        breathG.gain.setValueAtTime(0.0005, T(vEnd));
        breathG.gain.exponentialRampToValueAtTime(a * 0.9, T(vEnd + cd - 0.004));
        breathG.gain.linearRampToValueAtTime(0, T(vEnd + cd));
      } else if (BURST_F[cons]) {
        sibF.frequency.setValueAtTime(BURST_F[cons] * (v.fs > 1.15 ? 1.2 : 1), T(vEnd));
        sibG.gain.setValueAtTime(0, T(vEnd));
        sibG.gain.linearRampToValueAtTime(a * 0.8, T(vEnd + cd - 0.002));
        sibG.gain.linearRampToValueAtTime(0, T(vEnd + cd));
      }
      prevVoiced = false;
      t = vEnd + cd + gap;
      return;
    }
    const on = t + cd;
    const vEnd = on + d;
    const legato = prevVoiced && cons === '' && syls[i - 1][6] === 0;
    const vowel: Vowel = vow || 'a';
    // Formants: glide consonants start from their own shape, then slide into the vowel.
    const g = GLIDE[cons];
    bank.forEach((f, k) => {
      if (g) f.frequency.setTargetAtTime(FORMANTS[g][k] * v.fs, T(t), 0.008);
      f.frequency.setTargetAtTime(FORMANTS[vowel][k] * v.fs, T(g ? on + 0.04 : t), legato ? 0.06 : 0.012);
    });
    // Bursts and hiss.
    if (BURST_F[cons]) {
      sibF.frequency.setValueAtTime(BURST_F[cons] * (v.fs > 1.15 ? 1.2 : 1), T(t));
      const hiss = cons === 's' || cons === 'sh';
      sibG.gain.setValueAtTime(0, T(t));
      sibG.gain.linearRampToValueAtTime(a * (hiss ? 0.5 : 0.9), T(t + (hiss ? 0.02 : 0.003)));
      sibG.gain.linearRampToValueAtTime(0, T(hiss ? on : t + cd));
    }
    // Breath: a puff for 'h', then a little air under the vowel.
    const bf = v.breath * a;
    if (cons === 'h' || (cons === 'p' && !vow)) {
      breathG.gain.setValueAtTime(0, T(t));
      breathG.gain.linearRampToValueAtTime(a * 0.9, T(t + 0.012));
    } else if (!legato) breathG.gain.setValueAtTime(0, T(t));
    if (vow) {
      breathG.gain.linearRampToValueAtTime(bf, T(on + 0.03));
      breathG.gain.setValueAtTime(bf, T(vEnd - Math.min(v.rel, d * 0.4)));
    }
    breathG.gain.linearRampToValueAtTime(0, T(vow ? vEnd : on + d));
    // Voice.
    if (vow) {
      const att = cons === 'b' ? 0.006 : cons === '' && !legato ? 0.035 : 0.015;
      const f0 = v.f0 * p0 * (cons === 'b' ? 0.85 : 1);
      if (legato) {
        src.frequency.linearRampToValueAtTime(f0, T(on + 0.05));
        srcG.gain.linearRampToValueAtTime(a * vz, T(on + 0.05));
      } else {
        src.frequency.setValueAtTime(f0, T(on));
        srcG.gain.setValueAtTime(0, T(on));
        srcG.gain.linearRampToValueAtTime(a * vz, T(on + att));
      }
      src.frequency.exponentialRampToValueAtTime(v.f0 * p1, T(vEnd));
      if (sub) {
        sub.frequency.setValueAtTime(f0 * 0.5, T(on));
        sub.frequency.exponentialRampToValueAtTime(v.f0 * p1 * 0.5, T(vEnd));
      }
      const nextLegato = i + 1 < syls.length && gap === 0 && syls[i + 1][0] === '' && !!syls[i + 1][1];
      if (!nextLegato) {
        srcG.gain.setValueAtTime(a * vz, T(vEnd - Math.min(v.rel, d * 0.4)));
        srcG.gain.linearRampToValueAtTime(0, T(vEnd));
      }
    }
    prevVoiced = !!vow;
    t = vEnd + gap;
  });
  return end;
}

// ---------------------------------------------------------------- roars

function roarBuckshot(s: Snd) {
  // Muscle V8: lumpy idle, two big blips, crackling overrun, with a police yelp riding on top.
  engine(s, {
    f: [[0, 38], [0.3, 40], [0.55, 150], [0.75, 115], [1.15, 200], [1.6, 60], [2.4, 38]],
    amp: [[0, 0], [0.06, 0.7], [0.55, 1], [1.15, 1], [1.6, 0.6], [2.2, 0.5], [2.5, 0.0001, 'e']],
    lp: [[0, 500], [0.55, 2600], [1.15, 3800], [1.6, 700], [2.5, 400]],
    drive: 3,
    spread: 18,
    sub: 0.8,
    chug: { rate: [[0, 9], [0.55, 30], [1.15, 45], [1.6, 12], [2.5, 8]], depth: [[0, 0.6], [0.5, 0.25], [1.5, 0.3], [1.7, 0.6]] },
  });
  crackles(s, 1.5, 2.35, 10, 0.7);
  // Siren yelp: wailing up and down fast, then one last "whoop".
  const yelp = s.osc('triangle', 1050, [[0.5, 0], [0.6, 0.22], [1.45, 0.22], [1.55, 0]]);
  s.lfo(yelp.frequency, 6, 420, 0.5, 1.55, 'sawtooth');
  s.osc('square', [[1.6, 600], [1.85, 1500], [2.1, 700]], [[1.6, 0], [1.65, 0.07], [2.0, 0.07], [2.1, 0]], s.filter('lowpass', 2500, 1));
}

function roarOlga(s: Snd) {
  // Diesel truck: slow heavy chug, turbo spool whistle, a big blow-off "PSSSH", sooty rattle.
  engine(s, {
    f: [[0, 22], [0.4, 26], [1.0, 52], [1.8, 68], [2.1, 30], [2.7, 24]],
    amp: [[0, 0], [0.08, 0.8], [1.0, 1], [1.8, 1], [2.1, 0.7], [2.7, 0.0001, 'e']],
    lp: [[0, 380], [1.0, 900], [1.8, 1300], [2.2, 400], [2.7, 300]],
    q: 3,
    drive: 4,
    spread: 30,
    sub: 1,
    chug: { rate: [[0, 11], [1.0, 24], [1.8, 32], [2.2, 13], [2.7, 11]], depth: 0.85 },
  });
  s.osc('sine', [[0.6, 1400], [1.85, 5600], [2.3, 2600]], [[0.6, 0], [1.2, 0.05], [1.85, 0.09], [2.3, 0]]);
  s.noise([[1.85, 0], [1.87, 0.55], [2.0, 0.35], [2.4, 0.0001, 'e']], s.bus, { type: 'bandpass', f: [[1.85, 3200], [2.4, 1300]], q: 1.2 });
  s.noise([[0, 0], [0.2, 0.3], [2.4, 0.3], [2.7, 0]], s.am(19, 0.9, 0, 2.7, s.bus, 'square'), { type: 'lowpass', f: 220 });
  crackles(s, 2.1, 2.6, 4, 0.5, [400, 900]);
}

function roarGus(s: Snd) {
  // Monster truck: enormous low bellow with a wind gust tearing past.
  engine(s, {
    f: [[0, 26], [0.5, 42], [1.4, 92], [2.2, 84], [3.0, 32]],
    amp: [[0, 0], [0.15, 0.8], [1.4, 1], [2.2, 1], [3.1, 0.0001, 'e']],
    lp: [[0, 400], [1.4, 1900], [2.2, 1500], [3.1, 350]],
    q: 2.5,
    drive: 5,
    spread: 25,
    sub: 1,
    chug: { rate: [[0, 13], [1.4, 42], [2.2, 38], [3.0, 12]], depth: [[0, 0.6], [1.4, 0.3], [3.0, 0.6]] },
  });
  engine(s, {
    f: [[0, 26.4], [0.5, 42.5], [1.4, 93], [2.2, 85], [3.0, 32.5]],
    amp: [[0, 0], [0.2, 0.5], [1.4, 0.7], [2.2, 0.7], [3.1, 0.0001, 'e']],
    lp: [[0, 300], [1.4, 1200], [3.1, 300]],
    drive: 5,
  });
  windGust(s, 0.3, 2.6, 0.55);
  crackles(s, 2.3, 3.0, 5, 0.6, [500, 1200]);
}

function roarRosa(s: Snd) {
  // Screaming race engine: big rev, rev-limiter bounce at the top, two snappy downshift blips, pops.
  engine(s, {
    f: [[0, 110], [0.15, 115], [0.55, 640], [0.7, 500], [1.15, 900], [1.7, 900], [1.85, 520], [2.0, 780], [2.15, 560], [2.6, 160]],
    amp: [[0, 0], [0.05, 0.6], [0.55, 1], [1.7, 1], [2.3, 0.7], [2.7, 0.0001, 'e']],
    lp: [[0, 1500], [0.55, 6000], [1.15, 9000], [1.8, 6000], [2.7, 1200]],
    q: 1.2,
    drive: 2,
    spread: 9,
    chug: { rate: 15, depth: [[0, 0], [1.15, 0], [1.2, 0.95], [1.7, 0.95], [1.75, 0]] },
  });
  s.osc('square', [[0.15, 230], [0.55, 1280], [0.7, 1000], [1.15, 1800], [1.7, 1800], [2.15, 1100], [2.6, 320]], [[0, 0], [0.5, 0.06], [1.7, 0.07], [2.6, 0]], s.filter('lowpass', 5000, 1));
  crackles(s, 2.15, 2.65, 8, 0.6, [1500, 4000]);
}

function windGust(s: Snd, t: number, len: number, vol: number) {
  const pk = t + len * 0.45;
  s.noise([[t, 0], [pk, vol], [t + len, 0.0001, 'e']], s.bus, { type: 'bandpass', f: [[t, 280], [pk, 950], [t + len, 420]], q: 4 });
  const howl = s.filter('bandpass', [[t, 420], [pk, 1150], [t + len, 520]], 18, s.gain(4));
  s.noise([[t, 0], [pk, vol], [t + len, 0.0001, 'e']], howl);
  s.noise([[t, 0], [pk, vol * 0.5], [t + len, 0.0001, 'e']], s.bus, { type: 'lowpass', f: 500 });
}

// ---------------------------------------------------------------- the 9 new bosses: roars

function roarPivot(s: Snd) {
  // Fussy, precise wedge: three crisp upshifts where the revs never land in the same place twice (the drifting window).
  engine(s, {
    f: [[0, 80], [0.1, 86], [0.42, 470], [0.47, 300], [0.8, 610], [0.85, 380], [1.25, 760], [1.65, 740], [2.25, 130]],
    amp: [[0, 0], [0.05, 0.6], [0.42, 1], [0.47, 0.75], [0.8, 1], [0.85, 0.75], [1.25, 1], [1.65, 0.9], [2.3, 0.0001, 'e']],
    lp: [[0, 1200], [0.42, 5000], [0.47, 2600], [0.8, 6000], [0.85, 3000], [1.25, 7500], [2.3, 1000]],
    q: 1.4,
    drive: 2.2,
    spread: 10,
    chug: { rate: 20, depth: [[0, 0.3], [0.4, 0.1], [2.3, 0.2]] },
  });
  // A tidy little "pip" on every shift, like a pointer on a desk.
  for (const t of [0.43, 0.81]) pop(s, t, 0.8, 2200);
  crackles(s, 1.7, 2.2, 6, 0.55, [1200, 3000]);
}

function roarFlashini(s: Snd) {
  // The fake-out: a rev that vanishes mid-scream ("not THAT light"), a harp shimmer, then the real launch.
  engine(s, {
    f: [[0, 95], [0.1, 100], [0.55, 520], [0.62, 540]],
    amp: [[0, 0], [0.05, 0.6], [0.55, 1], [0.6, 1], [0.62, 0.0001, 'e']],
    lp: [[0, 1300], [0.55, 5500], [0.62, 6000]],
    q: 1.5,
    drive: 2.5,
    spread: 12,
  });
  // Harp glissando up (the magic) in the gap.
  for (let i = 0; i < 12; i++) {
    const t = 0.64 + i * 0.022;
    const f = mtof(76 + [0, 2, 4, 7, 9][i % 5] + 12 * Math.floor(i / 5));
    s.osc('triangle', f, [[t, 0], [t + 0.002, 0.18], [t + 0.5, 0.0001, 'e']]);
  }
  engine(s, {
    f: [[0.95, 140], [1.35, 760], [1.5, 600], [1.85, 820], [2.5, 150]],
    amp: [[0.95, 0], [1.0, 1], [1.85, 1], [2.55, 0.0001, 'e']],
    lp: [[0.95, 3000], [1.35, 7000], [2.55, 1100]],
    q: 1.3,
    drive: 2.5,
    spread: 12,
  });
  crackles(s, 1.95, 2.5, 8, 0.6, [1500, 3500]);
}

function roarSal(s: Snd) {
  // A tiny furious engine: buzzy, high, revved in angry "brap-brap-brap" stabs, then two indignant little honks.
  engine(s, {
    f: [[0, 150], [0.12, 430], [0.22, 210], [0.36, 480], [0.46, 220], [0.6, 560], [0.7, 240], [0.86, 720], [1.35, 740], [1.6, 200]],
    amp: [[0, 0], [0.04, 0.8], [0.12, 1], [0.22, 0.6], [0.36, 1], [0.46, 0.6], [0.6, 1], [0.7, 0.6], [0.86, 1], [1.35, 1], [1.65, 0.0001, 'e']],
    lp: [[0, 3000], [0.86, 7000], [1.35, 7500], [1.65, 2000]],
    q: 1.8,
    drive: 5,
    spread: 28,
    chug: { rate: [[0, 40], [0.86, 70], [1.6, 30]], depth: 0.35 },
  });
  crackles(s, 1.3, 1.6, 5, 0.5, [2000, 4500]);
  for (const [t, f] of [[1.72, 880], [1.9, 740]] as const) {
    const hn = s.filter('lowpass', 3000, 1, s.shaper(2));
    s.osc('square', [[t, f * 0.9], [t + 0.02, f]], [[t, 0], [t + 0.01, 0.35], [t + 0.12, 0.3], [t + 0.15, 0.0001, 'e']], hn);
    s.osc('square', f * 1.26, [[t, 0], [t + 0.01, 0.2], [t + 0.12, 0.18], [t + 0.15, 0.0001, 'e']], hn);
  }
}

function roarVera(s: Snd) {
  // A rev played BACKWARDS (it swells out of nothing as the pitch falls, then stops dead), then the same rev forwards.
  engine(s, {
    f: [[0, 760], [0.5, 620], [1.0, 170]],
    amp: [[0, 0.0005], [1.0, 1, 'e'], [1.02, 0.0001, 'e']],
    lp: [[0, 6500], [1.0, 1800]],
    q: 1.3,
    drive: 2.4,
    spread: 11,
  });
  // Reversed crackles: each pop swells in and snaps off.
  for (let i = 0; i < 6; i++) {
    const t = rnd(0.1, 0.55);
    s.noise([[t, 0.0005], [t + 0.04, rnd(0.3, 0.6), 'e'], [t + 0.042, 0]], s.bus, { type: 'bandpass', f: rnd(1500, 3500), q: 1.2 });
  }
  // Mirror shimmer at the turnaround.
  for (const [f, v] of [[2637, 0.25], [3520, 0.18], [4699, 0.12]] as const) s.osc('sine', f, [[1.0, 0], [1.005, v], [1.6, 0.0001, 'e']]);
  engine(s, {
    f: [[1.12, 170], [1.6, 800], [1.95, 760], [2.55, 160]],
    amp: [[1.12, 0], [1.16, 0.9], [1.6, 1], [1.95, 0.9], [2.6, 0.0001, 'e']],
    lp: [[1.12, 1800], [1.6, 6500], [2.6, 1000]],
    q: 1.3,
    drive: 2.4,
    spread: 11,
  });
  crackles(s, 2.0, 2.5, 6, 0.55, [1500, 3500]);
}

function roarDj(s: Snd) {
  // Supercar with a subwoofer for a heart: a big low rev riding a "wub-wub" bass that slows into a drop.
  engine(s, {
    f: [[0, 60], [0.4, 70], [1.0, 260], [1.5, 300], [2.1, 70], [2.6, 55]],
    amp: [[0, 0], [0.08, 0.7], [1.0, 1], [1.6, 1], [2.2, 0.6], [2.7, 0.0001, 'e']],
    lp: [[0, 600], [1.0, 3000], [1.6, 3200], [2.2, 600], [2.7, 300]],
    q: 2,
    drive: 3.5,
    spread: 20,
    sub: 1,
    chug: { rate: [[0, 12], [1.0, 34], [1.6, 36], [2.2, 14]], depth: [[0, 0.5], [1.0, 0.25], [2.2, 0.5]] },
  });
  const wub = s.filter('lowpass', 500, 7, s.shaper(2.5, s.gain([[0, 0], [0.2, 0.7], [2.2, 0.7], [2.9, 0.0001, 'e']])));
  s.lfo(wub.frequency, [[0, 4], [1.4, 8], [2.2, 2]], 420, 0, 2.9, 'triangle');
  for (const dt of [-10, 10]) s.osc('sawtooth', [[0, 55], [2.0, 55], [2.9, 22]], [[0, 0.4], [2.9, 0.4]], wub, dt);
  drop(s, 2.05, 70, 0.9, 0.7);
}

function roarRick(s: Snd) {
  // Muscle V8 burble, then a long greasy wheelspin squeal (the slick tyre shine) and a smug little blip.
  engine(s, {
    f: [[0, 42], [0.35, 44], [0.6, 140], [0.8, 110], [1.1, 170], [2.0, 175], [2.4, 50], [2.8, 42]],
    amp: [[0, 0], [0.06, 0.7], [0.6, 1], [2.0, 1], [2.5, 0.5], [2.9, 0.0001, 'e']],
    lp: [[0, 500], [0.6, 2400], [1.1, 3200], [2.0, 3000], [2.5, 600]],
    drive: 3,
    spread: 16,
    sub: 0.8,
    chug: { rate: [[0, 9], [0.6, 28], [1.1, 40], [2.0, 40], [2.5, 10]], depth: [[0, 0.6], [0.5, 0.25], [2.1, 0.3], [2.5, 0.6]] },
  });
  const hp = s.filter('highpass', 700, 0.7, s.am(21, 0.3, 1.0, 2.2));
  const sq = s.osc('triangle', [[1.0, 1450], [1.3, 1300], [2.1, 1180]], [[1.0, 0], [1.1, 0.3], [1.9, 0.28], [2.2, 0.0001, 'e']], hp);
  s.lfo(sq.frequency, 7.5, 70, 1.0, 2.2);
  s.noise([[1.0, 0], [1.1, 0.25], [2.0, 0.2], [2.25, 0.0001, 'e']], hp, { type: 'bandpass', f: 2400, q: 8 });
  crackles(s, 2.3, 2.8, 6, 0.6);
}

function roarDeacon(s: Snd) {
  // Hearse: a slow, deep, heavy rumble that never hurries, under a minor organ drone.
  engine(s, {
    f: [[0, 20], [0.6, 24], [1.5, 46], [2.3, 50], [3.0, 22], [3.4, 20]],
    amp: [[0, 0], [0.25, 0.8], [1.5, 1], [2.3, 1], [3.5, 0.0001, 'e']],
    lp: [[0, 300], [1.5, 900], [2.3, 1000], [3.5, 250]],
    q: 3,
    drive: 4,
    spread: 22,
    sub: 1,
    chug: { rate: [[0, 7], [1.5, 16], [2.3, 17], [3.4, 7]], depth: 0.75 },
  });
  const org = s.filter('lowpass', 1400, 0.7, s.am(5.5, 0.25, 0, 3.6));
  for (const m of [38, 41, 45, 50])
    for (const dt of [-6, 6]) s.osc('sawtooth', mtof(m), [[0.2, 0], [1.4, 0.12], [2.6, 0.12], [3.6, 0.0001, 'e']], org, dt);
  crackles(s, 2.9, 3.4, 4, 0.45, [300, 800]);
}

function roarBaron(s: Snd) {
  // A refined V12: silky, many-voiced, climbing to a held scream right under the redline, one limiter tick, then pops.
  engine(s, {
    f: [[0, 120], [0.15, 125], [0.9, 980], [1.75, 1010], [1.8, 900], [1.85, 1000], [2.45, 200]],
    amp: [[0, 0], [0.05, 0.5], [0.9, 1], [1.75, 1], [2.5, 0.0001, 'e']],
    lp: [[0, 2000], [0.9, 9000], [1.8, 9000], [2.5, 1500]],
    q: 0.9,
    drive: 1.6,
    spread: 6,
  });
  engine(s, {
    f: [[0, 180], [0.15, 187], [0.9, 1470], [1.75, 1515], [1.8, 1350], [1.85, 1500], [2.45, 300]],
    amp: [[0, 0], [0.05, 0.3], [0.9, 0.6], [1.75, 0.6], [2.5, 0.0001, 'e']],
    lp: [[0, 3000], [0.9, 10000], [2.5, 2000]],
    q: 0.8,
    drive: 1.4,
    spread: -7,
  });
  crackles(s, 1.95, 2.45, 8, 0.6, [2000, 5000]);
}

function roarIvy(s: Snd) {
  // Heavy industrial muscle car whose chug tightens and tightens (the squeeze), hydraulic hisses and a groaning creak.
  engine(s, {
    f: [[0, 34], [0.5, 40], [1.2, 120], [2.0, 150], [2.5, 50], [2.9, 36]],
    amp: [[0, 0], [0.1, 0.8], [1.2, 1], [2.1, 1], [3.0, 0.0001, 'e']],
    lp: [[0, 450], [1.2, 2200], [2.1, 2600], [3.0, 400]],
    q: 2.4,
    drive: 4.5,
    spread: 20,
    sub: 1,
    chug: { rate: [[0, 8], [0.8, 14], [1.6, 26], [2.1, 44], [2.5, 12]], depth: [[0, 0.7], [2.1, 0.8], [2.5, 0.5]] },
  });
  const creak = s.filter('bandpass', [[0.3, 700], [1.0, 1100], [1.6, 850]], 16, s.gain(3));
  const cr = s.osc('sawtooth', [[0.3, 55], [1.6, 70]], [[0.3, 0], [0.5, 0.3], [1.4, 0.3], [1.6, 0.0001, 'e']], creak);
  s.lfo(cr.frequency, 9, 20, 0.3, 1.6, 'square');
  for (const t of [0.9, 1.7, 2.4]) s.noise([[t, 0], [t + 0.01, 0.5], [t + 0.25, 0.0001, 'e']], s.bus, { type: 'highpass', f: 4000, q: 0.7 });
  crackles(s, 2.4, 2.9, 5, 0.6, [500, 1400]);
}

// ---------------------------------------------------------------- the 9 new bosses: building blocks

/** Church / funeral bell: hum, prime, minor-third tierce, quint, nominal and up, long beating decay. */
function bell(s: Snd, t: number, f0: number, len: number, vol: number) {
  const parts: [number, number, number][] = [
    [0.5, 0.55, 1],
    [1, 0.8, 0.75],
    [1.19, 0.55, 0.6],
    [1.5, 0.3, 0.5],
    [2, 0.5, 0.45],
    [2.52, 0.22, 0.3],
    [3, 0.18, 0.22],
    [4.18, 0.1, 0.14],
  ];
  for (const [r, v, d] of parts) for (const dt of [-0.8, 0.8]) s.osc('sine', f0 * r + dt, [[t, 0], [t + 0.004, vol * v * 0.5], [t + len * d, 0.0001, 'e']]);
  s.noise([[t, 0], [t + 0.002, vol * 0.5], [t + 0.06, 0.0001, 'e']], s.bus, { type: 'bandpass', f: f0 * 5, q: 1 });
  thump(s, t, vol * 0.4, f0, f0 * 0.5, 0.15);
}

/** Glassy ring (wine glass, mirror shard): a beating fundamental with faint upper partials. */
function glass(s: Snd, t: number, f: number, len: number, vol: number) {
  for (const [r, v, d] of [[1, 1, 1], [2.71, 0.25, 0.4], [5.1, 0.1, 0.18]] as const) {
    if (f * r > s.c.sampleRate * 0.45) continue;
    for (const dt of [-1.2, 1.2]) s.osc('sine', f * r + dt * r, [[t, 0], [t + 0.0015, vol * v * 0.5], [t + len * d, 0.0001, 'e']]);
  }
  s.noise([[t, 0], [t + 0.0005, vol * 0.6], [t + 0.006, 0.0001, 'e']], s.bus, { type: 'highpass', f: 5000 });
}

/** Short sharp leather / wood smack. */
function smack(s: Snd, t: number, vol: number, f = 1300) {
  s.noise([[t, 0], [t + 0.0008, vol], [t + 0.015, vol * 0.4], [t + 0.09, 0.0001, 'e']], s.bus, { type: 'bandpass', f, q: 0.8 });
  s.noise([[t, 0], [t + 0.0005, vol * 0.6], [t + 0.02, 0.0001, 'e']], s.bus, { type: 'highpass', f: 3500 });
  thump(s, t, vol * 0.7, 180, 70, 0.1);
}

/** Hydraulic hiss (pressure release). */
function hiss(s: Snd, t: number, len: number, vol: number) {
  s.noise([[t, 0], [t + 0.015, vol], [t + len * 0.4, vol * 0.6], [t + len, 0.0001, 'e']], s.bus, { type: 'bandpass', f: [[t, 5000], [t + len, 2800]], q: 0.8 });
}

/** Turntable scratch: the record dragged back and forth under the needle ("wikka-wikka"). */
function scratch(s: Snd, t: number, vol: number) {
  // Platter motion: [time, speed]; the pitch of everything follows it.
  const moves: Pt[] = [[t, 300], [t + 0.07, 2400], [t + 0.12, 500], [t + 0.17, 2000], [t + 0.21, 350], [t + 0.3, 2600], [t + 0.42, 250]];
  const bp = s.filter('bandpass', moves, 2.5, s.gain(2));
  s.noise([[t, 0], [t + 0.01, vol], [t + 0.4, vol * 0.8], [t + 0.44, 0.0001, 'e']], bp);
  const sh = s.shaper(2, s.filter('lowpass', 3500, 1));
  s.osc('sawtooth', moves.map(([x, y]) => [x, y / 4] as Pt), [[t, 0], [t + 0.01, vol * 0.5], [t + 0.4, vol * 0.4], [t + 0.44, 0.0001, 'e']], sh);
}

// ---------------------------------------------------------------- the 9 new bosses: stings (hit lands at h = STING_LEAD)

const STING_NEW: Partial<Record<CutsceneId, (s: Snd, h: number) => void>> = {
  // Minor stab with a smug school-bell "ding" on top.
  pivot: (s, h) => {
    riser(s, h, 0.5, 6500);
    stab(s, h, [43, 55, 58, 62, 64, 67], 1.3, 0.5, 7000);
    drop(s, h, 78, 1.3, 0.85);
    crash(s, h, 1.3, 0.35);
    for (const [r, v, d] of [[1, 0.5, 1.4], [2.76, 0.2, 0.5], [5.4, 0.1, 0.25]] as const) s.osc('sine', 1568 * r, [[h, 0], [h + 0.002, v], [h + d, 0.0001, 'e']]);
  },
  // Showbiz "ta-DAAA": a little pickup stab, then a sinister augmented hit with a sparkle.
  flashini: (s, h) => {
    riser(s, h, 0.45, 7000);
    stab(s, h - 0.2, [55, 62, 67], 0.15, 0.35, 8000);
    stab(s, h, [48, 56, 60, 64, 68, 72], 1.5, 0.5, 9000);
    drop(s, h, 80, 1.3, 0.8);
    crash(s, h, 1.6, 0.4);
    twinkle(s, h + 0.05, 0.12);
  },
  // Short fuse: a quick riser and a tight, punchy, high stab.
  sal: (s, h) => {
    riser(s, h, 0.5, 8000);
    stab(s, h, [52, 59, 64, 67, 70], 0.75, 0.5, 9000);
    drop(s, h, 95, 0.7, 0.85);
    crash(s, h, 0.9, 0.4);
  },
  // A reversed-cymbal swell into a glassy stab, its mirror image ringing an octave up.
  vera: (s, h) => {
    s.noise([[0, 0.0005], [h, 0.6, 'e'], [h + 0.01, 0]], s.bus, { type: 'highpass', f: [[0, 2500], [h, 7000]], q: 0.7 });
    riser(s, h, 0.35, 7000);
    stab(s, h, [44, 56, 59, 63, 66], 1.4, 0.5, 8000);
    stab(s, h, [78, 75, 71, 68].map((m) => m), 1.4, 0.15, 10000);
    drop(s, h, 76, 1.2, 0.8);
    for (const f of [2794, 3729, 4978]) glass(s, h + rnd(0, 0.08), f, 1.2, 0.18);
  },
  // Build-up and DROP: a riser, a heartbeat of silence, then a huge sub drop under a wobbling minor stab.
  dj: (s, h) => {
    riser(s, h - 0.06, 0.55, 8000);
    const w = s.am([[h, 7], [h + 1.5, 3]], [[h, 0.6], [h + 1.6, 0.3]], h, h + 1.6);
    stab(s, h, [41, 53, 56, 60, 63], 1.5, 0.5, 6000);
    s.osc('sawtooth', [[h, 87], [h + 1.4, 30]], [[h, 0], [h + 0.01, 0.4], [h + 1.4, 0.0001, 'e']], s.filter('lowpass', 600, 4, s.shaper(3, w)));
    drop(s, h, 90, 1.6, 1);
    crash(s, h, 1.4, 0.4);
  },
  // Cheesy, brassy dominant stab and a cash-register "cha-ching".
  rick: (s, h) => {
    riser(s, h, 0.5, 6500);
    stab(s, h, [41, 53, 57, 60, 63, 68], 1.3, 0.5, 7500);
    drop(s, h, 80, 1.3, 0.85);
    crash(s, h, 1.4, 0.35);
    for (const [t, m] of [[h + 0.12, 96], [h + 0.2, 100]] as const) tine(s, t, m, 0.3, 0.9);
  },
  // FINAL: long dread riser, a huge minor organ chord and two funeral-bell tolls, a sub drop that keeps falling.
  deacon: (s, h) => {
    riser(s, h, 0.6, 7000);
    const c = [26, 38, 45, 50, 53, 57, 62];
    stab(s, h, c, 0.5, 0.5, 7000);
    stab(s, h + 0.42, c.map((m) => m - 1), 2.2, 0.55, 5000);
    bell(s, h, 98, 3.5, 0.6);
    bell(s, h + 0.42, 92.5, 4, 0.7);
    drop(s, h, 62, 0.5, 0.9);
    drop(s, h + 0.42, 58, 2.2, 1);
    crash(s, h, 0.45, 0.4);
    crash(s, h + 0.42, 2.2, 0.45);
  },
  // FINAL: a royal fanfare: two pickup stabs, then BWAAM-BWAAM (major, then a sneering step up), gong and drop.
  baron: (s, h) => {
    riser(s, h, 0.55, 9000);
    stab(s, h - 0.3, [55, 62, 67], 0.12, 0.3, 8000);
    stab(s, h - 0.15, [55, 62, 67], 0.12, 0.3, 8000);
    stab(s, h, [43, 55, 59, 62, 67, 71], 0.45, 0.5, 9000);
    stab(s, h + 0.32, [44, 56, 60, 63, 68, 72], 2, 0.55, 9000);
    gong(s, h + 0.32, 62, 4.5, 0.7);
    drop(s, h, 66, 0.5, 0.9);
    drop(s, h + 0.32, 62, 2, 1);
    crash(s, h, 0.4, 0.4);
    crash(s, h + 0.32, 2.2, 0.5);
  },
  // FINAL: an industrial slam, then a second stab squeezed into a tighter cluster with a hydraulic hiss and clang.
  ivy: (s, h) => {
    riser(s, h, 0.6, 8000);
    stab(s, h, [28, 40, 47, 52, 55, 59], 0.45, 0.5, 8000);
    stab(s, h + 0.32, [28, 40, 46, 47, 52, 53], 2, 0.55, 7000);
    for (const [f, v, len] of [[220, 0.3, 2.2], [611, 0.26, 1.6], [1233, 0.2, 1.1], [2051, 0.14, 0.7]] as const)
      for (const dt of [-2, 2]) s.osc('sine', f + dt, [[h + 0.32, 0], [h + 0.325, v], [h + 0.32 + len, 0.0001, 'e']]);
    drop(s, h, 64, 0.5, 0.9);
    drop(s, h + 0.32, 60, 2, 1);
    crash(s, h, 0.4, 0.4);
    crash(s, h + 0.32, 2, 0.45);
    hiss(s, h + 0.4, 1.1, 0.45);
  },
};
const STING_LEVEL: Partial<Record<CutsceneId, number>> = {
  pivot: 0.181,
  flashini: 0.194,
  sal: 0.239,
  vera: 0.203,
  dj: 0.195,
  rick: 0.193,
  deacon: 0.162,
  baron: 0.152,
  ivy: 0.145,
};

// ---------------------------------------------------------------- the 9 new bosses: signature moves

const SIG_NEW: Partial<Record<CutsceneId, [number, (s: Snd) => void]>> = {
  // Chalk screeching across the board, then the pointer SLAPPED on the desk.
  pivot: [
    0.317,
    (s) => {
      const len = 0.6;
      const slip = s.am([[0, 28], [len, 40]], 0.85, 0, len, s.bus, 'square');
      s.noise([[0, 0], [0.03, 0.5], [len - 0.05, 0.55], [len, 0.0001, 'e']], slip, { type: 'bandpass', f: [[0, 2600], [len, 3400]], q: 9 });
      const sq = s.osc('sine', [[0, 2900], [len, 3600]], [[0, 0], [0.05, 0.25], [len - 0.05, 0.3], [len, 0.0001, 'e']], slip);
      s.lfo(sq.frequency, 13, 180, 0, len, 'triangle');
      s.noise([[0, 0], [0.02, 0.2], [len, 0.15], [len + 0.02, 0.0001, 'e']], s.bus, { type: 'highpass', f: 6000 });
      const t = 0.78;
      s.noise([[t - 0.1, 0], [t, 0.4, 'e'], [t + 0.005, 0]], s.bus, { type: 'bandpass', f: [[t - 0.1, 800], [t, 3000]], q: 1 });
      smack(s, t, 1, 1700);
      s.osc('triangle', [[t, 750], [t + 0.05, 420]], [[t, 0], [t + 0.001, 0.5], [t + 0.08, 0.0001, 'e']]);
    },
  ],
  // A card-riffle shuffle and bridge, then a magic POOF with sparkles.
  flashini: [
    0.261,
    (s) => {
      for (let i = 0; i < 46; i++) {
        const t = 0.5 * Math.pow(i / 46, 0.85);
        s.noise([[t, 0], [t + 0.0006, rnd(0.4, 0.8)], [t + 0.008, 0.0001, 'e']], s.bus, { type: 'bandpass', f: rnd(2500, 4500), q: 1.5 });
      }
      s.noise([[0.5, 0], [0.52, 0.4], [0.62, 0.0001, 'e']], s.am(60, 0.9, 0.5, 0.62, s.bus, 'square'), { type: 'bandpass', f: 2200, q: 1 });
      const t = 0.75;
      s.noise([[t, 0], [t + 0.004, 1], [t + 0.08, 0.5], [t + 0.5, 0.0001, 'e']], s.bus, { type: 'lowpass', f: [[t, 6000], [t + 0.45, 300]], q: 1.2 });
      thump(s, t, 0.8, 120, 45, 0.3);
      twinkle(s, t + 0.08, 0.35);
    },
  ],
  // Stomping onto his phone books: a shoe whoosh, a fat papery FWUMP, pages fluttering.
  sal: [
    0.277,
    (s) => {
      windGust(s, 0, 0.2, 0.5);
      const t = 0.18;
      thump(s, t, 1, 120, 34, 0.45);
      s.noise([[t, 0], [t + 0.001, 1], [t + 0.03, 0.5], [t + 0.2, 0.0001, 'e']], s.bus, { type: 'bandpass', f: [[t, 1600], [t + 0.2, 500]], q: 0.8 });
      for (let i = 0; i < 30; i++) {
        const tt = t + Math.abs(rnd(-1, 1)) * rnd(0, 0.12);
        s.noise([[tt, 0], [tt + 0.0008, rnd(0.2, 0.6)], [tt + rnd(0.004, 0.012), 0.0001, 'e']], s.bus, { type: 'bandpass', f: rnd(1500, 5000), q: 1.4 });
      }
      s.noise([[t + 0.1, 0], [t + 0.15, 0.3], [t + 0.55, 0.0001, 'e']], s.am(30, 0.9, t + 0.1, t + 0.55, s.bus, 'square'), { type: 'bandpass', f: 3000, q: 1 });
    },
  ],
  // A mirror cracking, then shattering into a long glassy rain of shards.
  vera: [
    0.184,
    (s) => {
      s.noise([[0, 0], [0.0008, 1], [0.03, 0.3], [0.15, 0.0001, 'e']], s.bus, { type: 'highpass', f: 2500, q: 0.7 });
      thump(s, 0, 0.6, 200, 80, 0.12);
      for (const f of [2100, 3300, 4400, 5900]) glass(s, rnd(0, 0.01), f * rnd(0.97, 1.03), 0.7, 0.35);
      for (let i = 0; i < 45; i++) {
        const t = 0.02 + Math.pow(Math.random(), 1.8) * 1.3;
        glass(s, t, rnd(2500, 8500), rnd(0.06, 0.25), rnd(0.1, 0.35) * (1 - t / 1.6));
      }
    },
  ],
  // Record scratch (wikka-wikka), a beat of silence, then the BASS DROP.
  dj: [
    0.23,
    (s) => {
      scratch(s, 0, 0.8);
      const t = 0.55;
      drop(s, t, 110, 1.6, 1);
      thump(s, t, 0.8, 160, 40, 0.4);
      s.noise([[t, 0], [t + 0.003, 0.4], [t + 0.8, 0.0001, 'e']], s.bus, { type: 'highpass', f: [[t, 4000], [t + 0.8, 8000]] });
    },
  ],
  // Spray-can rattle and hiss (tyre shine), then the gleaming tooth "DING".
  rick: [
    0.321,
    (s) => {
      for (const t of [0, 0.11, 0.22, 0.33]) {
        s.noise([[t, 0], [t + 0.001, 0.7], [t + 0.03, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 2600, q: 5 });
        s.osc('sine', [[t, 1900], [t + 0.02, 1500]], [[t, 0], [t + 0.001, 0.3], [t + 0.04, 0.0001, 'e']]);
      }
      const h0 = 0.5;
      const len = 0.85;
      const turb = s.am(rnd(13, 17), 0.2, h0, h0 + len);
      s.noise([[h0, 0], [h0 + 0.03, 0.7], [h0 + len - 0.1, 0.6], [h0 + len, 0.0001, 'e']], turb, { type: 'highpass', f: 4500, q: 0.7 });
      s.noise([[h0, 0], [h0 + 0.03, 0.25], [h0 + len, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 2500, q: 1 });
      const t = 1.5;
      for (const [r, v, d] of [[1, 0.6, 1.2], [2.76, 0.25, 0.5], [5.4, 0.12, 0.25]] as const) {
        const o = s.osc('sine', 3520 * r, [[t, 0], [t + 0.002, v], [t + d, 0.0001, 'e']]);
        s.lfo(o.frequency, 6, [[t, 0], [t + d, 18 * r]], t, t + d);
      }
      twinkle(s, t + 0.05, 0.15);
    },
  ],
  // A single funeral bell, tolling twice, the second further away.
  deacon: [
    0.183,
    (s) => {
      bell(s, 0, 110, 4, 1);
      bell(s, 1.6, 110, 3, 0.45);
    },
  ],
  // A glove slapped across your face, then a smug wine-glass clink.
  baron: [
    0.308,
    (s) => {
      s.noise([[0, 0], [0.12, 0.35, 'e'], [0.13, 0]], s.bus, { type: 'bandpass', f: [[0, 500], [0.12, 2000]], q: 1 });
      smack(s, 0.13, 1, 1100);
      const t = 0.6;
      glass(s, t, 2650, 1.5, 0.7);
      glass(s, t + 0.004, 2930, 1.3, 0.5);
    },
  ],
  // The hydraulic vise: a pump whine winding up, a creaking squeeze, a metal CRUNCH and the pressure released.
  ivy: [
    0.265,
    (s) => {
      const pump = s.filter('lowpass', [[0, 600], [0.9, 2200]], 3, s.am(28, 0.6, 0, 0.95, s.bus, 'square'));
      s.osc('sawtooth', [[0, 90], [0.9, 190]], [[0, 0], [0.1, 0.4], [0.9, 0.5], [0.95, 0.0001, 'e']], pump);
      s.osc('sine', [[0, 600], [0.9, 1300]], [[0, 0], [0.2, 0.1], [0.9, 0.14], [0.95, 0.0001, 'e']]);
      const creak = s.filter('bandpass', [[0.3, 900], [0.9, 1400]], 18, s.gain(3));
      const cr = s.osc('sawtooth', [[0.3, 50], [0.9, 75]], [[0.3, 0], [0.4, 0.35], [0.9, 0.35], [0.95, 0.0001, 'e']], creak);
      s.lfo(cr.frequency, 11, 18, 0.3, 0.95, 'square');
      const t = 0.95;
      thump(s, t, 1, 110, 34, 0.4);
      for (let i = 0; i < 40; i++) {
        const tt = t + Math.abs(rnd(-1, 1)) * rnd(0, 0.18);
        s.noise([[tt, 0], [tt + 0.001, rnd(0.3, 0.8)], [tt + rnd(0.006, 0.02), 0.0001, 'e']], s.bus, { type: 'bandpass', f: rnd(600, 3500), q: 2 });
      }
      for (const [f, v, len] of [[340, 0.3, 0.7], [890, 0.22, 0.5], [1730, 0.15, 0.3]] as const) s.osc('sine', f, [[t, 0], [t + 0.002, v], [t + len, 0.0001, 'e']]);
      hiss(s, t + 0.25, 0.7, 0.6);
    },
  ],
};

// ---------------------------------------------------------------- v3 heel turn: glitch, oil, sweet half

/** Play raw samples (built in JS) at relative time t. */
function pcm(s: Snd, t: number, data: Float32Array, dest: AudioNode = s.bus) {
  const b = s.c.createBuffer(1, data.length, s.c.sampleRate);
  b.getChannelData(0).set(data);
  const src = s.c.createBufferSource();
  src.buffer = b;
  src.connect(dest);
  s.run(src, t, t + data.length / s.c.sampleRate);
}

const saw = (ph: number) => 2 * (ph - Math.floor(ph)) - 1;
const crushQ = (x: number, bits: number) => {
  const q = Math.pow(2, bits - 1);
  return Math.round(x * q) / q;
};

/**
 * Turbo-style digital corruption, rendered sample by sample: a sweet chime morphing into a harsh buzz, chopped into
 * bit-crushed stutters, buffer repeats, warbling zaps and dropouts, then a power-down bend into a distorted bass hit
 * landing at `len` (the reveal), with ~0.75 s of tail after it.
 */
function glitchPcm(sr: number, len: number): Float32Array {
  const tail = 0.75;
  const n = Math.ceil((len + tail) * sr);
  const N = Math.ceil(len * sr);
  const out = new Float32Array(n);
  // Source material: a sweet A-major chime (with tremolo) crossfading into detuned low saws and grit.
  const m = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / sr;
    const k = Math.min(1, (t / len) * 1.4);
    const sweet =
      (Math.sin(2 * Math.PI * 880 * t) + 0.7 * Math.sin(2 * Math.PI * 1108.7 * t) + 0.5 * Math.sin(2 * Math.PI * 1318.5 * t)) *
      (0.75 + 0.25 * Math.sin(2 * Math.PI * 9 * t)) *
      0.4;
    const harsh = (saw(110 * t) + saw(111.7 * t) + 0.7 * saw(164.8 * t + 0.3)) * 0.33 + (Math.random() * 2 - 1) * 0.18;
    m[i] = sweet * (1 - k) + harsh * k;
  }
  const bend0 = Math.floor(N * 0.66);
  let i = 0;
  let last = '';
  while (i < bend0) {
    const seg = Math.floor(sr * rnd(0.022, 0.085));
    let kind: string = pick(['stutter', 'stutter', 'crush', 'crush', 'zap', 'zap', 'gap', 'noise'] as const);
    if (kind === 'gap' && (last === 'gap' || i === 0)) kind = 'zap';
    last = kind;
    const end = Math.min(bend0, i + seg);
    if (kind === 'stutter') {
      // Buffer repeat: a tiny slice looped, each repeat a touch quieter (and sometimes shorter: the "machine gun" roll).
      let sl = Math.floor(sr * rnd(0.01, 0.04));
      const st = Math.max(0, i - Math.floor(sr * rnd(0, 0.05)));
      const shrink = Math.random() < 0.4;
      let j = i;
      let rep = 0;
      while (j < end) {
        for (let q = 0; q < sl && j < end; q++, j++) out[j] = m[Math.min(N - 1, st + q)] * Math.pow(0.88, rep) * 1.4;
        rep++;
        if (shrink) sl = Math.max(Math.floor(sr * 0.004), Math.floor(sl * 0.75));
      }
    } else if (kind === 'crush') {
      // Sample-rate and bit-depth reduction.
      const hold = Math.floor(rnd(5, 26));
      const bits = Math.floor(rnd(2, 5));
      for (let j = i; j < end; j++) out[j] = crushQ(m[j - ((j - i) % hold)] * 1.3, bits);
    } else if (kind === 'zap') {
      // Pitch-warble zap: a square sweeping down (or up) with fast vibrato, crushed.
      const f0 = rnd(1400, 4200);
      const f1 = Math.random() < 0.75 ? rnd(90, 320) : rnd(4500, 6500);
      const wr = rnd(25, 60);
      let ph = 0;
      for (let j = i; j < end; j++) {
        const u = (j - i) / (end - i);
        const f = f0 * Math.pow(f1 / f0, u) * (1 + 0.25 * Math.sin(2 * Math.PI * wr * ((j - i) / sr)));
        ph += f / sr;
        out[j] = crushQ(Math.sin(2 * Math.PI * ph) > 0 ? 0.55 : -0.55, 3) * (1 - u * 0.4);
      }
    } else if (kind === 'noise') {
      const hold = Math.floor(rnd(3, 12));
      let v = 0;
      for (let j = i; j < end; j++) {
        if ((j - i) % hold === 0) v = Math.random() * 2 - 1;
        out[j] = crushQ(v * 0.5, 3);
      }
    } // 'gap': a dropout, left silent
    i = end;
  }
  // Power-down: the material read slower and slower (tape stop), more and more crushed, over a falling buzz.
  {
    let p = bend0;
    let ph = 0;
    const span = N - bend0;
    for (let j = bend0; j < N; j++) {
      const u = (j - bend0) / span;
      p += Math.max(0.04, Math.pow(1 - u, 1.6));
      const a = m[Math.min(N - 1, Math.floor(p))];
      const hold = 1 + Math.floor(u * 14);
      const src = (j - bend0) % hold === 0 ? a : out[j - 1];
      ph += (700 * Math.pow(38 / 700, u)) / sr;
      const gate = u > 0.94 ? 0 : 1; // a hair of silence right before the hit
      out[j] = crushQ(src * 0.9 + saw(ph) * 0.55, 6 - Math.floor(u * 3)) * gate * (1 - u * 0.25);
    }
  }
  // Level the glitch body so the hit always lands on top.
  let pk = 0;
  for (let j = 0; j < N; j++) pk = Math.max(pk, Math.abs(out[j]));
  const norm = pk > 0 ? 0.75 / pk : 1;
  for (let j = 0; j < N; j++) out[j] *= norm;
  // Heavy distorted bass hit: a sine kick sweeping 170 > 36 Hz plus a fat saw, driven hard, a crushed crack on top.
  {
    let ph = 0;
    let ph2 = 0;
    let lp = 0;
    let hold = 0;
    for (let j = N; j < n; j++) {
      const t = (j - N) / sr;
      const f = 36 + 134 * Math.exp(-t * 14);
      ph += f / sr;
      ph2 += (f * 0.5 + 0.4) / sr;
      lp += 0.08 * (saw(ph2) - lp);
      const env = t < 0.003 ? t / 0.003 : Math.exp(-(t - 0.003) * 4.2);
      if ((j - N) % 9 === 0) hold = Math.random() * 2 - 1;
      const x = (Math.sin(2 * Math.PI * ph) * 1.1 + lp * 0.7 + hold * Math.exp(-t * 45) * 0.9) * 3.2;
      out[j] = (Math.tanh(x) / Math.tanh(3.2)) * env * (t > tail - 0.05 ? (tail - t) / 0.05 : 1);
    }
  }
  return out;
}

/** A music-box tine: bright partials with a tiny mechanical click, the upper ones dying fast. */
function tine(s: Snd, t: number, m: number, vol: number, len = 1.3) {
  const f = mtof(m);
  for (const [r, v, d] of [[1, 1, 1], [2, 0.22, 0.45], [4.07, 0.1, 0.2], [6.3, 0.05, 0.1]] as const) {
    for (const dt of [-0.6, 0.6]) s.osc('sine', f * r + dt, [[t, 0], [t + 0.002, vol * v * 0.5], [t + len * d, 0.0001, 'e']]);
  }
  s.noise([[t, 0], [t + 0.001, vol * 0.25], [t + 0.012, 0.0001, 'e']], s.bus, { type: 'highpass', f: 6000 });
}

/** Brahms' lullaby (public domain): [midi, beats]. */
const LULLABY: [number, number][] = [
  [76, 0.5], [76, 0.5], [79, 2], [76, 0.5], [76, 0.5], [79, 2], [76, 0.5], [79, 0.5], [84, 1], [83, 1.5], [81, 0.5], [81, 1], [79, 1],
  [74, 0.5], [76, 0.5], [77, 1], [74, 1], [74, 0.5], [76, 0.5], [77, 2], [74, 0.5], [77, 0.5], [83, 0.5], [81, 0.5], [79, 1], [83, 1], [84, 2],
];
/** One bass tine per 3/4 bar. */
const LULLABY_BASS = [60, 60, 55, 60, 55, 55, 55, 60];

const SWEET: Partial<Record<CutsceneId, { spec: VoiceSpec; level: number; syls: () => Syl[] }>> = {
  // Warm, friendly "howdy!": a bright "how" sliding up into a sing-song "dee".
  buckshot: {
    spec: { f0: 132, fs: 1.04, breath: 0.22, vib: 18, rel: 0.09, soft: 2600 },
    level: 0.26,
    syls: () => [
      ['h', 'a', 0.17, 1.0, 1.12, 1, 0],
      ['', 'u', 0.08, 1.12, 1.1, 0.85, 0.02],
      ['d', 'i', 0.34, 1.32, 1.08, 1, 0],
    ],
  },
  // A cute little hummed tune (mm-mm-mm-mmm), then a giggly "hehe".
  olga: {
    spec: { f0: 340, fs: 1.34, breath: 0.32, vib: 30, rel: 0.06, soft: 2400 },
    level: 0.28,
    syls: () => [
      ['', 'm', 0.16, 1.0, 1.0, 0.75, 0.03],
      ['', 'm', 0.16, 1.26, 1.26, 0.8, 0.03],
      ['', 'm', 0.16, 1.5, 1.5, 0.85, 0.03],
      ['', 'm', 0.13, 1.26, 1.26, 0.75, 0.03],
      ['', 'm', 0.32, 1.68, 1.5, 0.9, 0.16],
      ['h', 'e', 0.07, 1.75, 1.7, 0.85, 0.05],
      ['h', 'i', 0.12, 1.95, 2.15, 0.9, 0],
    ],
  },
  // Jolly grandpa chuckle "ho ho ho-hmm".
  gus: {
    spec: { f0: 98, fs: 0.9, breath: 0.26, vib: 22, sub: 0.3, rel: 0.1, soft: 2000 },
    level: 0.28,
    syls: () => [
      ['h', 'o', 0.2, 1.22, 1.12, 1, 0.08],
      ['h', 'o', 0.2, 1.18, 1.08, 0.95, 0.08],
      ['h', 'o', 0.32, 1.14, 0.98, 0.95, 0.1],
      ['', 'm', 0.34, 1.0, 0.86, 0.6, 0],
    ],
  },
  // Polite, sparkly "thank you!": a crisp "thaenk", then a rising "kyuu" (plus a twinkle).
  rosa: {
    spec: { f0: 230, fs: 1.16, breath: 0.16, vib: 12, rel: 0.05, soft: 3200 },
    level: 0.26,
    syls: () => [
      ['t', 'ae', 0.15, 1.05, 1.14, 1, 0],
      ['', 'm', 0.05, 1.14, 1.12, 0.6, 0.02],
      ['k', 'i', 0.05, 1.3, 1.35, 0.8, 0],
      ['', 'u', 0.3, 1.38, 1.08, 1, 0],
    ],
  },
};

/** Little rising twinkle (sparkles, a heart pop). */
function twinkle(s: Snd, t: number, vol: number) {
  [88, 91, 95, 100, 103].forEach((m, i) => {
    const tt = t + i * 0.055;
    const f = mtof(m);
    s.osc('sine', f, [[tt, 0], [tt + 0.003, vol], [tt + 0.45, 0.0001, 'e']]);
    s.osc('sine', f * 2.76, [[tt, 0], [tt + 0.002, vol * 0.25], [tt + 0.15, 0.0001, 'e']]);
  });
  s.noise([[t, 0], [t + 0.15, vol * 0.18], [t + 0.7, 0.0001, 'e']], s.bus, { type: 'highpass', f: 8000, q: 0.7 });
}

/** One gloopy liquid bubble: a sine chirping up fast. */
function blip(s: Snd, t: number, vol: number, f0 = rnd(250, 700), up = rnd(2, 3.4)) {
  const len = rnd(0.025, 0.05);
  s.osc('sine', [[t, f0], [t + len, f0 * up]], [[t, 0], [t + 0.004, vol], [t + len, 0.0001, 'e']]);
}

/** Wet splatter burst. */
function splatter(s: Snd, t: number, vol: number) {
  s.noise([[t, 0], [t + 0.002, vol], [t + rnd(0.04, 0.09), 0.0001, 'e']], s.bus, { type: 'lowpass', f: [[t, rnd(1800, 3200)], [t + 0.08, 400]], q: 2 });
  s.osc('sine', [[t, rnd(160, 240)], [t + 0.06, 60]], [[t, 0], [t + 0.003, vol * 0.6], [t + 0.08, 0.0001, 'e']]);
}

/** Every music box still playing, so stopMusicBox() can cut them. */
const boxes = new Set<() => void>();

// ---------------------------------------------------------------- the public API

const ROAR: Partial<Record<CutsceneId, (s: Snd) => void>> = {
  buckshot: roarBuckshot,
  olga: roarOlga,
  gus: roarGus,
  rosa: roarRosa,
  pivot: roarPivot,
  flashini: roarFlashini,
  sal: roarSal,
  vera: roarVera,
  dj: roarDj,
  rick: roarRick,
  deacon: roarDeacon,
  baron: roarBaron,
  ivy: roarIvy,
};
const ROAR_LEVEL: Partial<Record<CutsceneId, number>> = {
  buckshot: 0.2,
  olga: 0.146,
  gus: 0.148,
  rosa: 0.155,
  pivot: 0.278,
  flashini: 0.279,
  sal: 0.201,
  vera: 0.286,
  dj: 0.161,
  rick: 0.204,
  deacon: 0.16,
  baron: 0.219,
  ivy: 0.148,
};

/** Bus levels for the polish one-shots, measured so peaks land ~0.3-0.45 at the master input (flashPop ~0.2). */
const CRUNCH_LEVEL = 0.3;
const SCRIBBLE_LEVEL = 0.48;
const RIP_LEVEL = 0.26;
const TINK_LEVEL = 0.4;
const PUMP_LEVEL = 0.56;
const FLASH_LEVEL = 0.5;
const PAPER_TIK_LEVEL = 0.47;
const HEHE_LEVEL: Partial<Record<CutsceneId, number>> = {
  buckshot: 0.39,
  olga: 0.36,
  gus: 0.38,
  rosa: 0.22,
  pivot: 0.349,
  flashini: 0.2,
  sal: 0.371,
  vera: 0.285,
  dj: 0.149,
  rick: 0.368,
  deacon: 0.365,
  baron: 0.419,
  ivy: 0.3,
};

/** Seconds from sting() to the chord hit, so the Director can line the stab up with the card slam. */
export const STING_LEAD: Partial<Record<CutsceneId, number>> = {
  buckshot: 0.7,
  olga: 0.7,
  gus: 0.8,
  rosa: 1.1,
  pivot: 0.7,
  flashini: 0.8,
  sal: 0.55,
  vera: 0.8,
  dj: 0.8,
  rick: 0.7,
  deacon: 1.2,
  baron: 1.1,
  ivy: 1.1,
};

/** Bosses without their own voice/roar/sting yet borrow Buckshot's, so a new cutscene never goes silent or throws. */
const known = (id: CutsceneId): CutsceneId => (VOICES[id] ? id : 'buckshot');

export const cutsceneSfx = {
  /** Long tyre screech for a drift of `sec` seconds. */
  drift(sec: number) {
    const d = Math.min(8, Math.max(0.3, sec || 1));
    play(0.26, (s) => {
      const end = d + 0.4;
      const amp: Pt[] = [[0, 0], [0.07, 0.5], [d * 0.5, 0.4], [d, 0.45], [end, 0.0001, 'e']];
      // Squeal: two inharmonic tones with fast wobble and a slow wander, plus a resonant noise whine.
      const hp = s.filter('highpass', 600, 0.7, s.am(23, 0.25, 0, end));
      for (const [f, v] of [[1180, 1], [1730, 0.55]] as const) {
        const o = s.osc('triangle', [[0, f * 1.15], [0.15, f], [d, f * 0.92], [end, f * 0.7]], amp.map(([x, y, m]) => [x, y * v, m ?? 'l'] as Pt), hp);
        s.lfo(o.frequency, rnd(6.5, 8), f * 0.05, 0, end);
        s.lfo(o.frequency, rnd(1.1, 1.6), f * 0.07, 0, end);
      }
      s.noise(amp, hp, { type: 'bandpass', f: [[0, 2300], [d, 2100], [end, 1500]], q: 9 });
      // Gravel / rumble bed.
      s.noise([[0, 0], [0.05, 0.6], [d, 0.5], [end + 0.2, 0.0001, 'e']], s.bus, { type: 'lowpass', f: 380, q: 1 });
      s.noise([[0, 0], [0.05, 0.3], [d, 0.25], [end, 0.0001, 'e']], s.am(17, 0.8, 0, end, s.bus, 'square'), { type: 'bandpass', f: 900, q: 1.2 });
      const rum = s.osc('sine', 46, [[0, 0], [0.1, 0.5], [d, 0.45], [end + 0.2, 0.0001, 'e']]);
      s.lfo(rum.frequency, 3, 8, 0, end + 0.2);
    });
  },

  /** Time slows: pitch-down whoosh + low drone swell ("bwoooom") and a slowing heartbeat. */
  slowmoIn() {
    play(0.22, (s) => {
      s.noise([[0, 0], [0.25, 0.8], [0.7, 0.55], [1.7, 0.0001, 'e']], s.bus, { type: 'bandpass', f: [[0, 4500], [1.5, 180]], q: 1.4 });
      const lp = s.filter('lowpass', [[0, 2600], [2.2, 170]], 4);
      for (const dt of [0, 16, -12]) {
        const o = s.osc('sawtooth', [[0, 165], [0.2, 112], [2.3, 36]], [[0, 0], [0.3, 0.32], [1.2, 0.3], [2.6, 0.0001, 'e']], lp, dt);
        s.lfo(o.detune, [[0, 6], [2, 1.5]], 18, 0, 2.6);
      }
      s.osc('sine', [[0, 72], [2.3, 29]], [[0, 0], [0.45, 0.85], [1.4, 0.8], [2.6, 0.0001, 'e']]);
      // Lub-dub, slowing down as time drags.
      for (const [t, v] of [[0.5, 0.9], [0.72, 0.65], [1.45, 0.85], [1.7, 0.6], [2.55, 0.75], [2.85, 0.5]] as const) thump(s, t, v, 78, 36, 0.22);
    });
  },

  /** Time snaps back: reverse-swell whoosh into a whip crack. */
  slowmoOut() {
    play(0.19, (s) => {
      const h = 0.62;
      s.noise([[0, 0.002], [h, 0.9, 'e'], [h + 0.02, 0]], s.bus, { type: 'bandpass', f: [[0, 240], [h, 5200]], q: 1.2 });
      const lp = s.filter('lowpass', [[0, 220], [h, 4500]], 3);
      s.osc('sawtooth', [[0, 40], [h, 270]], [[0, 0.002], [h, 0.5, 'e'], [h + 0.02, 0]], lp);
      s.osc('sawtooth', [[0, 40.5], [h, 405]], [[0, 0.002], [h, 0.3, 'e'], [h + 0.02, 0]], lp);
      // Crack.
      s.noise([[h, 0], [h + 0.001, 1], [h + 0.1, 0.0001, 'e']], s.bus, { type: 'highpass', f: 1800, q: 0.7 });
      s.osc('square', [[h, 2600], [h + 0.07, 280]], [[h, 0], [h + 0.002, 0.35], [h + 0.09, 0.0001, 'e']]);
      s.noise([[h + 0.02, 0], [h + 0.03, 0.3], [h + 0.45, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 3200, q: 0.8 });
      thump(s, h, 0.9, 110, 42, 0.25);
    });
  },

  /** Big hit for the title card slam: sub boom, noise crash, metal clang tail. */
  impact() {
    play(0.16, (s) => {
      s.noise([[0, 0], [0.001, 1], [0.05, 0.0001, 'e']], s.bus, { type: 'highpass', f: 2000, q: 0.7 });
      s.osc('sine', [[0, 150], [0.08, 62], [0.9, 28]], [[0, 0], [0.004, 1], [0.25, 0.8], [1.6, 0.0001, 'e']]);
      const body = s.shaper(4, s.filter('lowpass', [[0, 1800], [0.4, 250]], 2));
      s.osc('sawtooth', [[0, 120], [0.3, 42]], [[0, 0], [0.003, 0.6], [0.45, 0.0001, 'e']], body);
      s.osc('square', [[0, 240], [0.2, 55]], [[0, 0], [0.003, 0.3], [0.22, 0.0001, 'e']], s.filter('lowpass', 1400, 1));
      s.noise([[0, 0], [0.003, 0.8], [0.1, 0.45], [1.8, 0.0001, 'e']], s.bus, { type: 'lowpass', f: [[0, 9000], [1.6, 900]], q: 0.7 });
      // Clang: struck-plate partials, paired for shimmer.
      const parts: [number, number, number][] = [[310, 0.3, 1.9], [857, 0.26, 1.4], [1675, 0.2, 1.0], [2768, 0.14, 0.7], [3640, 0.09, 0.5]];
      for (const [f, v, len] of parts)
        for (const dt of [-2.5, 2.5]) s.osc('sine', f + dt, [[0.005, 0], [0.008, v], [0.008 + len, 0.0001, 'e']]);
    });
  },

  /** The boss's signature-move sound (toothpick flick, oil splash, wind howl, redline scream). */
  signature(id: CutsceneId) {
    id = known(id);
    const sig = SIG_NEW[id];
    if (sig) play(sig[0], sig[1]);
    else if (id === 'buckshot')
      play(0.36, (s) => {
        // Toothpick flick "tink", then a ricochet whistle "pyeeoww".
        for (const [f, v, len] of [[3200, 0.6, 0.16], [4870, 0.4, 0.12], [7100, 0.25, 0.08]] as const) s.osc('sine', f, [[0, 0], [0.002, v], [len, 0.0001, 'e']]);
        s.noise([[0, 0], [0.001, 0.4], [0.015, 0.0001, 'e']], s.bus, { type: 'highpass', f: 5000 });
        const r = s.osc('sine', [[0.12, 3400], [0.25, 2900], [0.75, 900]], [[0.12, 0], [0.14, 0.55], [0.5, 0.4], [0.8, 0.0001, 'e']]);
        s.lfo(r.frequency, [[0.12, 30], [0.8, 12]], [[0.12, 60], [0.8, 140]], 0.12, 0.8);
        s.osc('sine', [[0.6, 2600], [1.05, 1100]], [[0.6, 0], [0.62, 0.22], [1.1, 0.0001, 'e']]);
      });
    else if (id === 'olga')
      play(0.49, (s) => {
        // Glug glug glug, then a fat splat and droplets.
        [0, 0.12, 0.23, 0.33].forEach((t, i) => {
          const f = 180 + i * 40;
          s.osc('sine', [[t, f], [t + 0.07, f * 2.8]], [[t, 0], [t + 0.01, 0.8], [t + 0.09, 0.0001, 'e']]);
        });
        s.noise([[0.42, 0], [0.43, 1], [0.6, 0.5], [0.95, 0.0001, 'e']], s.bus, { type: 'bandpass', f: [[0.42, 1500], [0.9, 280]], q: 1.5 });
        thump(s, 0.42, 0.7, 120, 50, 0.18);
        for (let i = 0; i < 9; i++) {
          const t = rnd(0.5, 1.1);
          s.osc('sine', [[t, rnd(500, 900)], [t + 0.04, rnd(1400, 2400)]], [[t, 0], [t + 0.004, rnd(0.15, 0.35)], [t + 0.05, 0.0001, 'e']]);
        }
      });
    else if (id === 'gus') play(0.55, (s) => windGust(s, 0, 2.2, 1));
    else
      play(0.15, (s) => {
        // Redline scream bouncing off the limiter, then an electric zap.
        const lp = s.filter('lowpass', 7000, 1, s.am(16, [[0, 0], [0.35, 0], [0.4, 0.95], [1.0, 0.95], [1.05, 0]], 0, 1.1, s.bus, 'square'));
        const sh = s.shaper(2, lp);
        for (const dt of [0, 9]) s.osc('sawtooth', [[0, 520], [0.38, 900], [1.05, 905]], [[0, 0], [0.04, 0.5], [1.0, 0.5], [1.1, 0.0001, 'e']], sh, dt);
        s.osc('square', [[0, 1040], [0.38, 1800]], [[0, 0], [0.05, 0.1], [1.0, 0.1], [1.1, 0.0001, 'e']], sh);
        const z = s.osc('square', [[1.05, 1800], [1.45, 120]], [[1.05, 0], [1.06, 0.45], [1.5, 0.0001, 'e']], s.filter('bandpass', 2400, 0.8));
        s.lfo(z.frequency, 63, 900, 1.05, 1.5, 'sawtooth');
        s.noise([[1.05, 0], [1.06, 0.6], [1.12, 0.2], [1.4, 0.0001, 'e']], s.am(41, 1, 1.05, 1.4, s.bus, 'square'), { type: 'highpass', f: 3500 });
      });
  },

  /** Engine roar / burnout for this boss's car. */
  roar(id: CutsceneId) {
    id = ROAR[id] ? id : 'buckshot';
    const fn = ROAR[id];
    if (fn) play(ROAR_LEVEL[id] ?? 0.15, fn);
  },

  /** Character gibberish voice line, cartoon style (no real words), ~1-2 s. */
  voice(id: CutsceneId, mood: 'taunt' | 'laugh' | 'yell') {
    id = known(id);
    const spec = VOICES[id];
    if (!spec) return;
    const { syls, growl } = line(id, mood);
    play(VOICE_LEVEL[id]?.[mood] ?? 0.4, (s) => {
      const end = speak(s, spec, syls, growl);
      // DJ's lines all end pitched down like a record winding to a stop: put a sub drop under that last syllable.
      if (id === 'dj' && syls.length) {
        const last = syls[syls.length - 1];
        drop(s, Math.max(0, end - 0.1 - last[2] * 0.7), 85, last[2] + 0.4, 0.55);
      }
    });
  },

  /** Boss intro stinger chord: riser, then a chord stab with a gong / bass drop. Hits STING_LEAD[id] s after the call. */
  sting(id: CutsceneId) {
    id = STING_LEAD[id] !== undefined ? id : 'buckshot';
    const h = STING_LEAD[id] ?? 0.7;
    const fn = STING_NEW[id];
    if (fn) play(STING_LEVEL[id] ?? 0.15, (s) => fn(s, h));
    else if (id === 'buckshot')
      play(0.2, (s) => {
        // Spaghetti-western half-diminished stab and a bass drop.
        riser(s, h, 0.5);
        stab(s, h, [40, 52, 55, 58, 62, 64], 1.4, 0.5);
        drop(s, h, 82, 1.4, 0.9);
        crash(s, h, 1.6, 0.4);
      });
    else if (id === 'olga')
      play(0.19, (s) => {
        // Diminished, wobbly and unhinged.
        riser(s, h, 0.5, 8000);
        stab(s, h, [49, 61, 64, 67, 70, 73], 1.4, 0.5, 9000);
        stab(s, h, [85, 88, 91], 0.6, 0.15, 10000);
        drop(s, h, 69, 1.2, 0.8);
        crash(s, h, 1.4, 0.45);
      });
    else if (id === 'gus')
      play(0.14, (s) => {
        // Low power chord and a huge gong.
        riser(s, h, 0.45, 4500);
        stab(s, h, [26, 38, 45, 50, 57], 1.8, 0.55, 4000);
        gong(s, h, 72, 4, 0.8);
        drop(s, h, 73, 1.6, 0.9);
      });
    else
      play(0.125, (s) => {
        // Final boss: long riser, double stab (BWAAM-BWAAM), gong, bass drop and crash. The biggest one.
        riser(s, h, 0.6, 9000);
        const c = [36, 48, 55, 63, 67, 74, 79];
        stab(s, h, c, 0.45, 0.5, 9000);
        stab(s, h + 0.32, c.map((m) => m - 1), 1.9, 0.55, 9000);
        gong(s, h + 0.32, 58, 4.5, 0.75);
        drop(s, h, 65, 0.5, 0.9);
        drop(s, h + 0.32, 62, 2, 1);
        crash(s, h, 0.4, 0.4);
        crash(s, h + 0.32, 2.2, 0.5);
      });
  },
  /** Lightning crack + rolling boom (Rosa's bolts). */
  thunder() {
    play(0.21, (s) => {
      // Crack: a bright noise snap with a sizzle, then a ripping tear.
      s.noise([[0, 0], [0.001, 1], [0.04, 0.35], [0.12, 0.0001, 'e']], s.bus, { type: 'highpass', f: 2500, q: 0.7 });
      s.noise([[0, 0], [0.003, 0.7], [0.3, 0.0001, 'e']], s.am(55, 0.9, 0, 0.3, s.bus, 'square'), { type: 'bandpass', f: [[0, 5000], [0.3, 1800]], q: 1 });
      thump(s, 0, 0.9, 140, 40, 0.35);
      // Rolling boom: lowpassed noise rumbling in waves over ~2.5 s.
      const rum = s.am(rnd(4, 6), [[0, 0.3], [2.6, 0.6]], 0, 2.7, s.bus, 'triangle');
      s.noise([[0.02, 0], [0.12, 1], [0.6, 0.7], [1.3, 0.55], [2.7, 0.0001, 'e']], rum, { type: 'lowpass', f: [[0, 900], [2.6, 160]], q: 0.9 });
      s.osc('sine', [[0.02, 62], [2.4, 30]], [[0.02, 0], [0.08, 0.7], [1.0, 0.45], [2.6, 0.0001, 'e']]);
    });
  },

  /** Double air-horn blast BWAAAMP-BWAAAMP (Gus): detuned saw/square chord, driven, lowpassed. */
  airHorn() {
    play(0.26, (s) => {
      const lp = s.filter('lowpass', 2500, 1.2);
      const sh = s.shaper(3, lp);
      for (const t of [0, 0.72]) {
        const len = 0.6;
        // "BW" pitch scoop up into the note, slight sag at the end
        const amp: Pt[] = [[t, 0], [t + 0.03, 0.9], [t + 0.12, 0.75], [t + len - 0.08, 0.7], [t + len, 0.0001, 'e']];
        for (const [f, type] of [[220, 'sawtooth'], [277, 'square'], [330, 'sawtooth']] as const) {
          for (const dt of [-12, 12]) s.osc(type, [[t, f * 0.84], [t + 0.06, f], [t + len - 0.1, f], [t + len, f * 0.95]], amp, sh, dt);
        }
        s.noise([[t, 0], [t + 0.01, 0.25], [t + 0.08, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 1200, q: 1 });
      }
    });
  },

  /** Cartoon cow moo (Gus's flying cow). */
  moo() {
    play(0.62, (s) => {
      // "mmm-OOOO": a low glottal saw through a formant pair that opens from m to o, pitch rising then sagging.
      const len = 1.1;
      const f: Pt[] = [[0, 110], [0.25, 150], [0.7, 140], [len, 95]];
      const amp: Pt[] = [[0, 0], [0.08, 0.6], [0.3, 0.9], [0.8, 0.8], [len, 0.0001, 'e']];
      const f1 = s.filter('bandpass', [[0, 280], [0.3, 520], [len, 420]], 6);
      const f2 = s.filter('bandpass', [[0, 600], [0.3, 900], [len, 780]], 8, s.gain(0.5));
      for (const dst of [f1, f2]) {
        const o = s.osc('sawtooth', f, amp, dst);
        s.lfo(o.frequency, 5.5, [[0, 0], [0.4, 4], [len, 7]], 0, len);
      }
      s.osc('sine', f, amp.map(([x, y, m]) => [x, y * 0.4, m ?? 'l'] as Pt));
    });
  },

  /** Innocent little whistle (Olga's "oops"): two sweet notes, a rising slide, a falling one. */
  whistle() {
    play(0.42, (s) => {
      const notes: [number, number, number, number][] = [
        [0, 0.22, 2100, 2350],
        [0.28, 0.4, 2600, 1750],
      ];
      for (const [t, len, a, b] of notes) {
        const o = s.osc('sine', [[t, a], [t + len * 0.7, b], [t + len, b * 0.97]], [[t, 0], [t + 0.03, 0.7], [t + len - 0.05, 0.6], [t + len, 0.0001, 'e']]);
        s.lfo(o.frequency, 7, [[t, 0], [t + len, 40]], t, t + len);
        // breath
        s.noise([[t, 0], [t + 0.03, 0.06], [t + len, 0.0001, 'e']], s.bus, { type: 'bandpass', f: a, q: 6 });
      }
    });
  },

  /** Siren yelp only, no engine (Buckshot's opener): wail up, then fast yelps. */
  siren() {
    play(0.27, (s) => {
      const lp = s.filter('lowpass', 3200, 1);
      const sh = s.shaper(2, lp);
      const f: Pt[] = [[0, 650], [0.45, 1450]];
      // fast yelps after the wail
      for (let i = 0; i < 6; i++) {
        const t = 0.5 + i * 0.16;
        f.push([t, 1450], [t + 0.08, 700], [t + 0.16, 1450]);
      }
      f.push([1.6, 1400], [1.9, 800]);
      const amp: Pt[] = [[0, 0], [0.05, 0.8], [1.6, 0.8], [1.95, 0.0001, 'e']];
      s.osc('square', f, amp, sh);
      s.osc('sawtooth', f, amp.map(([x, y, m]) => [x, y * 0.5, m ?? 'l'] as Pt), sh, 7);
    });
  },

  // ---- v3 heel turn ----
  /**
   * Turbo-style digital corruption for the heel turn: bit-crushed stutters, buffer repeats, warbling zaps and a
   * power-down bend over `sec` seconds, then a distorted bass hit exactly `sec` after the call (the jerk reveal).
   */
  glitch(sec = 0.6) {
    const d = Math.min(3, Math.max(0.2, sec || 0.6));
    play(0.45, (s) => pcm(s, 0, glitchPcm(s.c.sampleRate, d)));
  },

  /** Pressurised oil blast from Olga's super-soaker for `sec` seconds (0.15-4): hiss, gloopy stream, splatter, drips. */
  squirt(sec = 1) {
    const d = Math.min(4, Math.max(0.15, sec || 1));
    play(0.3, (s) => {
      // Pump "chk" and the pressure burst.
      s.noise([[0, 0], [0.001, 0.8], [0.012, 0.0001, 'e']], s.bus, { type: 'highpass', f: 3000 });
      s.osc('square', [[0, 900], [0.02, 300]], [[0, 0], [0.002, 0.25], [0.025, 0.0001, 'e']], s.filter('lowpass', 2500, 1));
      s.noise([[0.02, 0], [0.03, 0.9], [0.16, 0.55], [d, 0.45], [d + 0.12, 0.0001, 'e']], s.bus, { type: 'bandpass', f: [[0.02, 4200], [0.2, 2400], [d, 2000]], q: 0.7 });
      // High-pressure hiss with turbulence.
      const turb = s.am(rnd(11, 15), 0.25, 0, d + 0.15, s.am(rnd(27, 33), 0.15, 0, d + 0.15));
      s.noise([[0.02, 0], [0.05, 0.45], [d, 0.4], [d + 0.15, 0.0001, 'e']], turb, { type: 'highpass', f: 5500, q: 0.7 });
      // The wet, slurpy stream: resonant noise with a wandering centre.
      const wet = s.filter('bandpass', 750, 6, s.gain(2.2));
      s.lfo(wet.frequency, rnd(5, 8), 280, 0, d + 0.15, 'triangle');
      s.lfo(wet.frequency, rnd(1.5, 2.5), 160, 0, d + 0.15);
      s.noise([[0.03, 0], [0.08, 0.6], [d, 0.55], [d + 0.15, 0.0001, 'e']], wet);
      s.noise([[0.03, 0], [0.08, 0.35], [d, 0.3], [d + 0.2, 0.0001, 'e']], s.bus, { type: 'lowpass', f: 320, q: 1 });
      // Gloop bubbles and splatter on whatever it hits.
      for (let i = 0, nb = Math.ceil(d * 34); i < nb; i++) blip(s, rnd(0.04, d), rnd(0.15, 0.4));
      for (let i = 0, ns = Math.max(1, Math.round(d * 7)); i < ns; i++) splatter(s, rnd(0.1, d), rnd(0.3, 0.6));
      // Running dry: a sputter, then drips.
      s.noise([[d, 0], [d + 0.01, 0.4], [d + 0.16, 0.0001, 'e']], s.am(24, 1, d, d + 0.17, s.bus, 'square'), { type: 'bandpass', f: 1400, q: 1 });
      for (const t of [0.22, 0.4, 0.65]) blip(s, d + t + rnd(-0.03, 0.03), rnd(0.25, 0.4), rnd(600, 900), rnd(1.8, 2.4));
    });
  },

  /** Sweet, harmless voice line for the "nice" half: Buckshot "howdy!", Olga hums + "hehe", Gus "ho ho", Rosa "thank you!". */
  sweet(id: CutsceneId) {
    const v = SWEET[id];
    if (!v) return;
    play(v.level, (s) => {
      speak(s, v.spec, v.syls(), 0);
      if (id === 'rosa') twinkle(s, 0.5, 0.12);
    });
  },

  /** Cute rising twinkle for the sweet half (sparkles, hearts). */
  sparkle() {
    play(0.45, (s) => twinkle(s, 0, 0.5));
  },

  /** Oil splattering onto the camera lens: a wet slap, a squelch, then drips sliding down. */
  splat() {
    play(0.27, (s) => {
      s.noise([[0, 0], [0.002, 1], [0.05, 0.5], [0.3, 0.0001, 'e']], s.bus, { type: 'lowpass', f: [[0, 4500], [0.25, 350]], q: 2.5 });
      thump(s, 0, 0.8, 150, 45, 0.22);
      s.osc('sine', [[0.01, 420], [0.12, 95]], [[0.01, 0], [0.015, 0.5], [0.14, 0.0001, 'e']]);
      for (let i = 0; i < 6; i++) blip(s, rnd(0.05, 0.3), rnd(0.2, 0.4));
      const ooze = s.filter('bandpass', [[0.25, 500], [1.1, 260]], 8, s.gain(2));
      s.noise([[0.2, 0], [0.35, 0.25], [1.1, 0.0001, 'e']], ooze);
      for (const t of [0.5, 0.8, 1.05]) blip(s, t, 0.3, rnd(500, 800), 2.2);
    });
  },

  /** A ticket slapped onto the lens: sharp paper-and-palm smack with a little flutter. */
  slap() {
    play(0.36, (s) => {
      s.noise([[0, 0], [0.001, 1], [0.012, 0.6], [0.09, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 1700, q: 0.7 });
      s.noise([[0, 0], [0.001, 0.6], [0.03, 0.0001, 'e']], s.bus, { type: 'highpass', f: 4000 });
      thump(s, 0, 0.7, 190, 70, 0.12);
      s.noise([[0.05, 0], [0.07, 0.2], [0.3, 0.0001, 'e']], s.am(38, 0.9, 0.05, 0.3, s.bus, 'square'), { type: 'bandpass', f: 3500, q: 1 });
    });
  },

  /** Paper crumpling in a fist (Rosa's autograph): a dense cluster of crisp crackles over a rustle. */
  crumple() {
    play(0.54, (s) => {
      const len = 0.75;
      s.noise([[0, 0], [0.05, 0.25], [0.5, 0.2], [len, 0.0001, 'e']], s.am(17, 0.7, 0, len, s.bus, 'square'), { type: 'bandpass', f: 3200, q: 0.9 });
      for (let i = 0; i < 70; i++) {
        // Crackles bunch up in three squeezes.
        const t = Math.min(len, pick([0.05, 0.28, 0.5]) + Math.abs(rnd(-1, 1) * rnd(0, 0.18)));
        const f = rnd(2500, 8000);
        s.noise([[t, 0], [t + 0.0008, rnd(0.3, 1)], [t + rnd(0.004, 0.015), 0.0001, 'e']], s.bus, { type: 'bandpass', f, q: 1.5 });
      }
    });
  },

  /** Gus's huge comedic inhale (~1.4 s): a rising, whistling suck of air that ends in a held-breath "hup". */
  inhale() {
    play(0.54, (s) => {
      const len = 1.35;
      s.noise([[0, 0], [len * 0.8, 0.8], [len, 0.9], [len + 0.02, 0]], s.bus, { type: 'bandpass', f: [[0, 400], [len, 2400]], q: 1.2 });
      s.noise([[0, 0], [len, 0.45], [len + 0.02, 0]], s.filter('bandpass', [[0, 700], [len, 3200]], 14, s.gain(3)));
      const w = s.osc('sine', [[0.2, 600], [len, 1600]], [[0.2, 0], [len, 0.12], [len + 0.02, 0]]);
      s.lfo(w.frequency, 6, 25, 0.2, len);
      // "hup": a little glottal stop.
      s.osc('sine', [[len + 0.03, 260], [len + 0.09, 180]], [[len + 0.03, 0], [len + 0.035, 0.5], [len + 0.1, 0.0001, 'e']], s.filter('lowpass', 1200, 1));
    });
  },

  /** The crowd panicking: a wave of overlapping screams and yelps over a frantic murmur (~1.8 s). */
  crowdScream() {
    play(0.25, (s) => {
      const len = 1.8;
      s.noise([[0, 0], [0.15, 0.4], [1.2, 0.35], [len, 0.0001, 'e']], s.am(9, 0.4, 0, len, s.bus, 'triangle'), { type: 'bandpass', f: 900, q: 0.8 });
      for (let i = 0; i < 14; i++) {
        const t = rnd(0, 0.45);
        const d = rnd(0.5, 1.3);
        const f0 = rnd(240, 560);
        const vow = pick(['a', 'ae', 'i', 'e'] as const);
        const amp: Pt[] = [[t, 0], [t + 0.05, rnd(0.15, 0.3)], [t + d * 0.7, rnd(0.12, 0.25)], [t + d, 0.0001, 'e']];
        const fm = FORMANTS[vow];
        const bank = [0, 1].map((k) => s.filter('bandpass', fm[k] * rnd(1.05, 1.3), FORMANT_Q[k], s.gain(FORMANT_GAIN[k] * 3)));
        const into = s.keep(s.c.createGain());
        bank.forEach((b) => into.connect(b));
        const o = s.osc('sawtooth', [[t, f0], [t + 0.12, f0 * rnd(1.5, 2)], [t + d, f0 * rnd(1.1, 1.5)]], amp, into);
        s.lfo(o.frequency, rnd(6, 11), f0 * 0.06, t, t + d);
      }
    });
  },

  /**
   * Twinkly music-box lullaby bed for the sweet half, up to `sec` seconds (default 8). Returns a stop() that cuts it
   * off hard (call it on the glitch); stopMusicBox() does the same for every box playing.
   */
  musicBox(sec = 8): () => void {
    const d = Math.min(30, Math.max(0.5, sec || 8));
    const beat = 0.34;
    const snd = play(0.42, (s) => {
      // The tune is 24 beats (8 bars of 3/4); it loops for as long as asked.
      for (let k = 0, t = 0; t < d; k++) {
        const [m, b] = LULLABY[k % LULLABY.length];
        tine(s, t, m, 0.5);
        t += b * beat;
      }
      for (let b = 0; b * 3 * beat < d; b++) tine(s, b * 3 * beat, LULLABY_BASS[b % LULLABY_BASS.length] - 12, 0.4, 1.8);
      // Fade out if it runs its course.
      s.bus.gain.setValueAtTime(s.bus.gain.value, s.t + Math.max(0, d - 0.4));
      s.bus.gain.linearRampToValueAtTime(0, s.t + d);
    });
    let done = false;
    const stop = () => {
      if (done || !snd) return;
      done = true;
      boxes.delete(stop);
      try {
        const now = snd.c.currentTime;
        snd.bus.gain.cancelScheduledValues(now);
        snd.bus.gain.setValueAtTime(snd.bus.gain.value, now);
        snd.bus.gain.linearRampToValueAtTime(0, now + 0.008);
      } catch {
        /* ignore */
      }
    };
    if (snd) {
      boxes.add(stop);
      setTimeout(() => boxes.delete(stop), (d + 0.5) * 1000);
    }
    return stop;
  },

  /** Hard-stop every music box that is playing. */
  stopMusicBox() {
    [...boxes].forEach((f) => f());
  },

  /** Hard candy crunch (Buckshot chomping his lollipop): a cracking snap, then a gritty shatter of shards and a molar grind. */
  crunch() {
    play(CRUNCH_LEVEL, (s) => {
      // The crack: a sharp broadband snap with a woody knock under it.
      s.noise([[0, 0], [0.0006, 1], [0.006, 0.35], [0.03, 0.0001, 'e']], s.bus, { type: 'highpass', f: 1800, q: 0.7 });
      s.osc('triangle', [[0, 1300], [0.025, 420]], [[0, 0], [0.001, 0.45], [0.03, 0.0001, 'e']]);
      thump(s, 0, 0.45, 160, 70, 0.07);
      // Shards: dense brittle ticks bunched just after the bite.
      for (let i = 0; i < 26; i++) {
        const t = 0.004 + Math.abs(rnd(-1, 1)) * rnd(0, 0.11);
        s.noise([[t, 0], [t + 0.0005, rnd(0.25, 0.8)], [t + rnd(0.003, 0.009), 0.0001, 'e']], s.bus, { type: 'bandpass', f: rnd(2500, 7500), q: 2 });
      }
      // The grind: chopped, gritty mid noise as the teeth work through the rest.
      s.noise([[0.03, 0], [0.05, 0.35], [0.16, 0.22], [0.26, 0.0001, 'e']], s.am(rnd(38, 48), 0.9, 0.03, 0.26, s.bus, 'square'), { type: 'bandpass', f: 1600, q: 1.1 });
    });
  },

  /** A pen scribbling fast on a pad for `sec` seconds (0.15-3): scratchy strokes rising and falling, a final flick. */
  scribble(sec = 0.7) {
    const d = Math.min(3, Math.max(0.15, sec || 0.7));
    play(SCRIBBLE_LEVEL, (s) => {
      // Strokes: each one a short burst of scratchy noise whose pitch rides the pen speed.
      let t = 0;
      while (t < d - 0.03) {
        const len = Math.min(d - t, rnd(0.05, 0.11));
        const f0 = rnd(2600, 4200);
        const amp: Pt[] = [[t, 0], [t + len * 0.25, rnd(0.6, 1)], [t + len * 0.8, rnd(0.4, 0.7)], [t + len, 0.0001, 'e']];
        s.noise(amp, s.am(rnd(55, 90), 0.5, t, t + len, s.bus, 'triangle'), { type: 'bandpass', f: [[t, f0 * 0.75], [t + len * 0.5, f0 * 1.2], [t + len, f0 * 0.8]], q: 2.2 });
        t += len + rnd(0.005, 0.025);
      }
      // Paper/desk body under the strokes.
      s.noise([[0, 0], [0.03, 0.18], [d, 0.15], [d + 0.03, 0.0001, 'e']], s.bus, { type: 'lowpass', f: 900, q: 0.7 });
      // The flourish flick at the end.
      s.noise([[d, 0], [d + 0.01, 0.9], [d + 0.06, 0.0001, 'e']], s.bus, { type: 'bandpass', f: [[d, 2500], [d + 0.06, 6500]], q: 2 });
    });
  },

  /** A ticket torn off a pad: a fast zipper of paper fibres snapping along the perforation, then a crisp release. */
  rip() {
    play(RIP_LEVEL, (s) => {
      const len = 0.24;
      // The tear: noise chopped by an accelerating rate, brightening as it goes.
      const zip = s.am([[0, 70], [len, 190]], 1, 0, len, s.bus, 'square');
      s.noise([[0, 0], [0.015, 0.7], [len * 0.8, 1], [len, 0.0001, 'e']], zip, { type: 'bandpass', f: [[0, 1600], [len, 4200]], q: 0.9 });
      s.noise([[0, 0], [0.02, 0.3], [len, 0.25], [len + 0.02, 0.0001, 'e']], s.bus, { type: 'highpass', f: 5000 });
      for (let i = 0; i < 14; i++) {
        const t = rnd(0, len);
        s.noise([[t, 0], [t + 0.0006, rnd(0.3, 0.7)], [t + rnd(0.003, 0.008), 0.0001, 'e']], s.bus, { type: 'bandpass', f: rnd(2000, 6000), q: 1.5 });
      }
      // Release: the last fibre lets go, and the slip flaps.
      s.noise([[len, 0], [len + 0.001, 1], [len + 0.03, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 3000, q: 0.8 });
      s.noise([[len + 0.03, 0], [len + 0.05, 0.25], [len + 0.18, 0.0001, 'e']], s.am(32, 0.9, len + 0.03, len + 0.18, s.bus, 'square'), { type: 'bandpass', f: 1800, q: 1 });
    });
  },

  /** A small hard thing (a lollipop stick) pinging off glass: a bright glassy tink with a short ring. */
  tink() {
    play(TINK_LEVEL, (s) => {
      const f = rnd(3000, 3500);
      for (const [r, v, d] of [[1, 1, 0.45], [2.32, 0.5, 0.25], [4.1, 0.3, 0.12], [5.9, 0.15, 0.07]] as const) {
        s.osc('sine', f * r, [[0, 0], [0.001, v * 0.5], [d, 0.0001, 'e']]);
      }
      s.noise([[0, 0], [0.0005, 0.6], [0.006, 0.0001, 'e']], s.bus, { type: 'highpass', f: 5000 });
      // Tiny second bounce.
      const t = rnd(0.07, 0.1);
      s.osc('sine', f * 1.04, [[t, 0], [t + 0.001, 0.18], [t + 0.12, 0.0001, 'e']]);
    });
  },

  /** Super-soaker pump rack: "chk-chk", a plastic slide back and forward with a hollow air gasp. */
  pumpRack() {
    play(PUMP_LEVEL, (s) => {
      for (const [t, f, v] of [[0, 1500, 1], [0.17, 2100, 0.9]] as const) {
        // The slide: a short plastic scrape into a latch click.
        s.noise([[t, 0], [t + 0.03, 0.25], [t + 0.06, 0.0001, 'e']], s.bus, { type: 'bandpass', f: [[t, f * 0.6], [t + 0.06, f]], q: 2 });
        const k = t + 0.06;
        s.noise([[k, 0], [k + 0.0008, v], [k + 0.012, 0.25], [k + 0.04, 0.0001, 'e']], s.bus, { type: 'bandpass', f, q: 1.4 });
        s.osc('square', [[k, 700], [k + 0.02, 260]], [[k, 0], [k + 0.001, v * 0.3], [k + 0.03, 0.0001, 'e']], s.filter('lowpass', 2200, 1));
        thump(s, k, v * 0.35, 220, 110, 0.06);
        // Hollow tube "hup" of air.
        s.noise([[t, 0], [t + 0.04, 0.2], [t + 0.1, 0.0001, 'e']], s.filter('bandpass', 520, 9, s.gain(2.5)));
      }
    });
  },

  /** A tiny mischievous gremlin giggle (~0.4 s) in the boss's gibberish voice: "hi-hi-hee". */
  hehe(id: CutsceneId = 'olga') {
    id = known(id);
    const spec = VOICES[id];
    if (!spec) return;
    const syls: Syl[] = [
      ['h', 'i', 0.05, 1.6, 1.52, 0.8, 0.012],
      ['h', 'e', 0.05, 1.74, 1.64, 0.85, 0.012],
      ['h', 'i', 0.1, 1.85, 2.2, 1, 0],
    ];
    play(HEHE_LEVEL[id] ?? 0.36, (s) => speak(s, { ...spec, vib: spec.vib * 1.4, rel: 0.02 }, syls, 0));
  },

  /** Camera flashbulb pop with a shutter click; quiet enough to fire ~9 times in 1.5 s (the paparazzi barrage). */
  flashPop() {
    play(FLASH_LEVEL, (s) => {
      const f = rnd(0.9, 1.15);
      // Shutter: two tight mechanical clicks.
      s.noise([[0, 0], [0.0005, 1], [0.008, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 3800 * f, q: 1.6 });
      s.noise([[0.022, 0], [0.0225, 0.6], [0.03, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 2600 * f, q: 1.6 });
      // Flash: a soft pop and the capacitor's whine charging back up.
      s.noise([[0.002, 0], [0.003, 0.5], [0.05, 0.0001, 'e']], s.bus, { type: 'lowpass', f: 2000, q: 0.7 });
      s.osc('sine', [[0.03, 3000 * f], [0.16, 7000 * f]], [[0.03, 0], [0.05, 0.04], [0.16, 0.0001, 'e']]);
    });
  },

  /** A crumpled paper ball bonking the camera lens: a hollow glassy knock with a crinkly bounce-off. */
  paperTik() {
    play(PAPER_TIK_LEVEL, (s) => {
      thump(s, 0, 0.6, 340, 160, 0.06);
      s.osc('sine', rnd(1900, 2200), [[0, 0], [0.001, 0.22], [0.09, 0.0001, 'e']]);
      s.noise([[0, 0], [0.0008, 0.8], [0.015, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 2400, q: 1 });
      for (let i = 0; i < 12; i++) {
        const t = 0.004 + Math.abs(rnd(-1, 1)) * rnd(0, 0.09);
        s.noise([[t, 0], [t + 0.0008, rnd(0.2, 0.55)], [t + rnd(0.004, 0.012), 0.0001, 'e']], s.bus, { type: 'bandpass', f: rnd(2500, 7000), q: 1.5 });
      }
    });
  },

  /** Short pass-by whoosh (debris skimming the lens, fast camera moves). */
  whoosh() {
    play(0.3, (s) => windGust(s, 0, rnd(0.28, 0.4), 0.9));
  },

  // ---- extras requested by the new boss scenes (called by duck-typing, names must match) ----

  /**
   * Deacon: one deep funeral bell toll, long bronze decay (~2.5 s at big = 1). Bigger `big` = a deeper, longer, louder
   * bell (1.3 heavier, 2.2 the climactic blackout toll); from 2 up it also gets a sub boom under the strike.
   */
  bellToll(big = 1) {
    const b = Math.min(3, Math.max(0.5, big || 1));
    play(0.2 * (1 + 0.12 * (b - 1)), (s) => {
      bell(s, 0, 98 / Math.pow(b, 0.4), 3 * Math.pow(b, 0.6), 1);
      if (b >= 2) {
        drop(s, 0, 60, 2.5, 0.32);
        s.noise([[0, 0], [0.01, 0.3], [2.5, 0.0001, 'e']], s.bus, { type: 'lowpass', f: [[0, 400], [2.5, 80]] });
      }
    });
  },

  /** Deacon: a candle pinched out: a tiny wet tsss. */
  snuff() {
    play(0.58, (s) => {
      s.noise([[0, 0], [0.005, 0.5], [0.05, 0.25], [0.22, 0.0001, 'e']], s.bus, { type: 'bandpass', f: [[0, 6000], [0.22, 3500]], q: 1.2 });
      s.osc('sine', [[0, 900], [0.03, 500]], [[0, 0], [0.002, 0.2], [0.04, 0.0001, 'e']]);
    });
  },

  /** Deacon: a tape measure zipping out (ratcheting blade). */
  tapeZip() {
    play(0.41, (s) => {
      const len = 0.45;
      s.noise([[0, 0], [0.02, 0.6], [len, 0.5], [len + 0.03, 0.0001, 'e']], s.am([[0, 50], [len, 30]], 0.9, 0, len + 0.03, s.bus, 'square'), { type: 'bandpass', f: [[0, 3500], [len, 2500]], q: 1.5 });
      s.osc('triangle', [[0, 1800], [len, 1500]], [[0, 0], [0.02, 0.12], [len, 0.1], [len + 0.03, 0.0001, 'e']], s.am(45, 0.8, 0, len + 0.03));
    });
  },

  /** Deacon: the tape measure whipping back in and snapping shut. */
  tapeSnap() {
    play(0.31, (s) => {
      const len = 0.18;
      s.noise([[0, 0], [0.01, 0.4], [len, 0.7], [len + 0.01, 0]], s.am([[0, 60], [len, 160]], 0.9, 0, len, s.bus, 'square'), { type: 'bandpass', f: [[0, 2500], [len, 5000]], q: 1.5 });
      smack(s, len, 0.9, 2600);
      for (const [f, v] of [[2300, 0.3], [5100, 0.15]] as const) s.osc('sine', f, [[len, 0], [len + 0.001, v], [len + 0.15, 0.0001, 'e']]);
    });
  },

  /** Deacon: a stone chisel strike: a hard metallic tink with grit. */
  chisel() {
    play(0.33, (s) => {
      for (const [f, v, d] of [[2900, 0.5, 0.25], [4700, 0.3, 0.15], [7300, 0.15, 0.08]] as const) s.osc('sine', f * rnd(0.97, 1.03), [[0, 0], [0.001, v], [d, 0.0001, 'e']]);
      thump(s, 0, 0.5, 300, 140, 0.05);
      for (let i = 0; i < 18; i++) {
        const t = Math.abs(rnd(-1, 1)) * rnd(0, 0.12);
        s.noise([[t, 0], [t + 0.0005, rnd(0.2, 0.6)], [t + rnd(0.003, 0.008), 0.0001, 'e']], s.bus, { type: 'bandpass', f: rnd(2000, 6000), q: 1.5 });
      }
    });
  },

  /** Deacon: a single sand grain landing: tiny and crisp. */
  grainTick() {
    play(0.39, (s) => {
      s.noise([[0, 0], [0.0004, 1], [0.004, 0.0001, 'e']], s.bus, { type: 'bandpass', f: rnd(5000, 7500), q: 2 });
      s.osc('sine', rnd(5500, 7000), [[0, 0], [0.0005, 0.25], [0.03, 0.0001, 'e']]);
    });
  },

  /** Flashini: a smoke-bomb pop and hiss. */
  poof() {
    play(0.26, (s) => {
      s.noise([[0, 0], [0.003, 1], [0.06, 0.5], [0.5, 0.0001, 'e']], s.bus, { type: 'lowpass', f: [[0, 6000], [0.45, 300]], q: 1.2 });
      thump(s, 0, 0.8, 130, 45, 0.3);
      s.noise([[0.04, 0], [0.1, 0.35], [0.9, 0.0001, 'e']], s.bus, { type: 'highpass', f: 4000, q: 0.7 });
    });
  },

  /** Flashini: a spring bouquet popping out: BOI-OI-OING. */
  boing() {
    play(0.54, (s) => {
      const len = 0.8;
      const o = s.osc('triangle', [[0, 180], [0.05, 420], [len, 330]], [[0, 0], [0.005, 0.7], [len, 0.0001, 'e']], s.filter('lowpass', 3000, 2));
      s.lfo(o.frequency, [[0, 14], [len, 9]], [[0, 150], [len, 20]], 0, len);
      s.noise([[0, 0], [0.001, 0.5], [0.02, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 2500, q: 1 });
    });
  },

  /** Flashini: a deck riffled and fanned. */
  cardRiffle() {
    play(0.9, (s) => {
      for (let i = 0; i < 40; i++) {
        const t = 0.45 * Math.pow(i / 40, 0.85);
        s.noise([[t, 0], [t + 0.0006, rnd(0.4, 0.8)], [t + 0.008, 0.0001, 'e']], s.bus, { type: 'bandpass', f: rnd(2500, 4500), q: 1.5 });
      }
      s.noise([[0.45, 0], [0.47, 0.4], [0.58, 0.0001, 'e']], s.am(60, 0.9, 0.45, 0.58, s.bus, 'square'), { type: 'bandpass', f: 2200, q: 1 });
    });
  },

  /** Flashini: one saw stroke (rasping teeth through wood, ~0.2 s). */
  saw() {
    play(0.57, (s) => {
      const len = rnd(0.16, 0.22);
      const teeth = s.am(rnd(90, 120), 0.9, 0, len, s.bus, 'sawtooth');
      s.noise([[0, 0], [len * 0.3, 0.8], [len, 0.0001, 'e']], teeth, { type: 'bandpass', f: [[0, 1800], [len * 0.5, 2600], [len, 2000]], q: 2 });
      s.noise([[0, 0], [len * 0.3, 0.25], [len, 0.0001, 'e']], s.bus, { type: 'lowpass', f: 600 });
    });
  },

  /** Flashini: a dove coo and a wing flutter. */
  coo() {
    play(0.33, (s) => {
      const lp = s.filter('lowpass', 900, 1);
      for (const [t, len, f0, f1] of [[0, 0.25, 420, 520], [0.3, 0.45, 520, 380]] as const) {
        const o = s.osc('sine', [[t, f0], [t + len * 0.4, f1 * 1.05], [t + len, f1]], [[t, 0], [t + 0.05, 0.7], [t + len - 0.05, 0.5], [t + len, 0.0001, 'e']], lp);
        s.lfo(o.frequency, 7, 20, t, t + len);
      }
      s.noise([[0.8, 0], [0.82, 0.5], [1.3, 0.0001, 'e']], s.am(22, 1, 0.8, 1.3, s.bus, 'square'), { type: 'bandpass', f: 1500, q: 0.8 });
    });
  },

  /** Flashini: the magician's fanfare hit "ta-DA!" (pickup at 0, hit at 0.15 s). */
  taDa() {
    play(0.3, (s) => {
      stab(s, 0, [60, 67, 72], 0.12, 0.35, 8000);
      stab(s, 0.15, [48, 60, 64, 67, 72, 76], 1.2, 0.5, 9000);
      crash(s, 0.15, 1.2, 0.35);
      twinkle(s, 0.2, 0.12);
    });
  },

  /** Vera: a truck reversing alarm, beep-beep-beep (~1.8 s). */
  reverseBeep() {
    play(0.41, (s) => {
      const lp = s.filter('lowpass', 3000, 1);
      for (let i = 0; i < 4; i++) {
        const t = i * 0.5;
        s.osc('square', 1030, [[t, 0], [t + 0.01, 0.5], [t + 0.25, 0.5], [t + 0.27, 0.0001, 'e']], lp);
      }
    });
  },

  /** Vera: a smoochy "mwah". */
  kiss() {
    play(0.71, (s) => {
      s.osc('sine', [[0, 300], [0.06, 900]], [[0, 0], [0.04, 0.3], [0.06, 0.0001, 'e']], s.filter('lowpass', 1500, 1));
      s.noise([[0.06, 0], [0.062, 0.9], [0.03 + 0.06, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 1800, q: 2 });
      blip(s, 0.07, 0.5, 900, 1.8);
      s.noise([[0.1, 0], [0.14, 0.15], [0.35, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 1200, q: 3 });
    });
  },

  /** Vera: a long, wet raspberry PFFFBT (~0.9 s). */
  raspberry() {
    play(0.26, (s) => {
      const len = 0.85;
      const flap = s.am([[0, 38], [len, 26]], 1, 0, len, s.bus, 'square');
      const lp = s.filter('lowpass', [[0, 2200], [len, 900]], 2, flap);
      s.osc('sawtooth', [[0, 90], [len, 70]], [[0, 0], [0.03, 0.6], [len - 0.1, 0.5], [len, 0.0001, 'e']], lp);
      s.noise([[0, 0], [0.03, 0.5], [len, 0.0001, 'e']], flap, { type: 'bandpass', f: 1400, q: 1 });
      s.noise([[len, 0], [len + 0.002, 0.8], [len + 0.04, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 1200, q: 1 });
    });
  },

  /** Vera / Baron: a big glass mirror smash with tinkling shards (~1.5 s). */
  glassShatter() {
    play(SIG_NEW.vera?.[0] ?? 0.18, (s) => SIG_NEW.vera?.[1](s));
  },

  /** Baron: a short regal brass fanfare (~1 s): da-da-da-DAAA. */
  fanfare() {
    play(0.36, (s) => {
      for (const [t, len, c] of [[0, 0.12, [55, 62, 67]], [0.15, 0.12, [55, 62, 67]], [0.3, 0.12, [57, 64, 69]], [0.45, 0.75, [43, 55, 59, 62, 67, 71]]] as const)
        stab(s, t, [...c], len, 0.45, 7000);
      crash(s, 0.45, 0.9, 0.25);
    });
  },

  /** Baron: a swarm of leathery bat wings flapping past (~0.8 s). */
  batFlutter() {
    play(1.07, (s) => {
      windGust(s, 0, 0.8, 0.4);
      for (let i = 0; i < 26; i++) {
        const t = rnd(0, 0.72);
        s.noise([[t, 0], [t + 0.006, rnd(0.3, 0.7)], [t + rnd(0.03, 0.06), 0.0001, 'e']], s.bus, { type: 'bandpass', f: rnd(700, 1600), q: 1.2 });
      }
      for (let i = 0; i < 4; i++) {
        const t = rnd(0.05, 0.6);
        s.osc('sine', [[t, rnd(6000, 8000)], [t + 0.05, rnd(4500, 5500)]], [[t, 0], [t + 0.005, 0.05], [t + 0.06, 0.0001, 'e']]);
      }
    });
  },

  /** Baron: a dainty little slurp. */
  sip() {
    play(0.92, (s) => {
      const len = 0.3;
      s.noise([[0, 0], [0.05, 0.4], [len, 0.3], [len + 0.02, 0.0001, 'e']], s.filter('bandpass', [[0, 900], [len, 2200]], 8, s.gain(2.5)));
      for (const t of [0.06, 0.15, 0.24]) blip(s, t, 0.25, rnd(600, 900), 2);
      s.osc('sine', [[len + 0.05, 260], [len + 0.1, 180]], [[len + 0.05, 0], [len + 0.055, 0.3], [len + 0.12, 0.0001, 'e']]);
    });
  },

  /** Baron: a leather glove tugged tight: short squeak-tug. */
  glovePull() {
    play(1.5, (s) => {
      const len = rnd(0.12, 0.16);
      const o = s.osc('sawtooth', [[0, rnd(520, 640)], [len, rnd(800, 950)]], [[0, 0], [0.02, 0.35], [len, 0.0001, 'e']], s.filter('bandpass', 1400, 4, s.am(rnd(60, 80), 0.7, 0, len)));
      s.lfo(o.frequency, 30, 40, 0, len);
      s.noise([[len, 0], [len + 0.002, 0.5], [len + 0.04, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 1200, q: 1 });
    });
  },

  /** Baron: a candelabra igniting: a soft fwump of flame. */
  candleFwump() {
    play(0.56, (s) => {
      s.noise([[0, 0], [0.03, 0.8], [0.12, 0.4], [0.45, 0.0001, 'e']], s.bus, { type: 'lowpass', f: [[0, 400], [0.05, 1600], [0.45, 500]], q: 1 });
      thump(s, 0.01, 0.5, 90, 45, 0.25);
      s.noise([[0.05, 0], [0.1, 0.12], [0.6, 0.0001, 'e']], s.am(17, 0.6, 0.05, 0.6, s.bus, 'triangle'), { type: 'bandpass', f: 2500, q: 0.8 });
    });
  },

  /** Sal: kicking a tyre: a rubbery BOINK thump. */
  tireKick() {
    play(0.4, (s) => {
      thump(s, 0, 0.9, 140, 60, 0.18);
      const o = s.osc('triangle', [[0, 220], [0.04, 160], [0.25, 120]], [[0, 0], [0.004, 0.5], [0.25, 0.0001, 'e']], s.filter('lowpass', 900, 3));
      s.lfo(o.frequency, 18, [[0, 30], [0.25, 5]], 0, 0.25);
    });
  },

  /** Sal: a heavy phone-book slab landing: THUD. */
  bookThud() {
    play(0.4, (s) => {
      // Each slam a little different (it's called six times in a row).
      const k = rnd(0.88, 1.12);
      thump(s, 0, rnd(0.85, 1), 110 * k, 38 * k, rnd(0.3, 0.4));
      s.noise([[0, 0], [0.001, rnd(0.6, 0.85)], [0.03, 0.3], [0.15, 0.0001, 'e']], s.bus, { type: 'bandpass', f: [[0, 1400 * k], [0.15, 500 * k]], q: 0.8 });
      for (let i = 0; i < 8; i++) {
        const t = rnd(0.002, 0.06);
        s.noise([[t, 0], [t + 0.0006, rnd(0.15, 0.4)], [t + rnd(0.004, 0.01), 0.0001, 'e']], s.bus, { type: 'bandpass', f: rnd(1500, 4500), q: 1.4 });
      }
    });
  },

  /** Sal: a finger poking the camera lens: a hollow thock on glass. */
  lensPoke() {
    play(0.51, (s) => {
      thump(s, 0, 0.6, 420, 200, 0.05);
      s.osc('sine', rnd(1500, 1800), [[0, 0], [0.001, 0.25], [0.08, 0.0001, 'e']]);
      s.noise([[0, 0], [0.0008, 0.5], [0.01, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 2200, q: 1.2 });
    });
  },

  /** Sal: a teeny plasticky gear-shift click. */
  tinyShift() {
    play(0.58, (s) => {
      for (const [t, f, v] of [[0, 3200, 1], [0.035, 2400, 0.7]] as const) {
        s.noise([[t, 0], [t + 0.0005, v], [t + 0.008, 0.0001, 'e']], s.bus, { type: 'bandpass', f, q: 2 });
        s.osc('square', [[t, f * 0.4], [t + 0.01, f * 0.25]], [[t, 0], [t + 0.0008, v * 0.15], [t + 0.012, 0.0001, 'e']]);
      }
    });
  },

  /** Sal: the phone-book tower toppling: a papery avalanche whoosh into a pile of thuds (~1.2 s). */
  bookTopple() {
    play(0.38, (s) => {
      windGust(s, 0, 0.7, 0.5);
      s.noise([[0, 0], [0.3, 0.3], [0.7, 0.2], [1.0, 0.0001, 'e']], s.am(26, 0.8, 0, 1.0, s.bus, 'square'), { type: 'bandpass', f: 3000, q: 1 });
      for (let i = 0; i < 6; i++) {
        const t = 0.5 + i * rnd(0.07, 0.11);
        thump(s, t, rnd(0.5, 0.9), rnd(100, 140), 40, 0.25);
        s.noise([[t, 0], [t + 0.001, 0.5], [t + 0.08, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 1200, q: 0.8 });
      }
    });
  },

  /** Sal: a faceplant: a fleshy splat and a squeaky "oof" grunt. */
  faceplant() {
    play(0.26, (s) => {
      thump(s, 0, 0.9, 160, 50, 0.2);
      s.noise([[0, 0], [0.002, 0.9], [0.05, 0.3], [0.2, 0.0001, 'e']], s.bus, { type: 'lowpass', f: [[0, 3500], [0.2, 400]], q: 2 });
      const v = VOICES.sal;
      if (v) {
        const g = s.gain(0.7);
        const sub = new Snd(s.c, g, 1);
        try {
          speak(sub, { ...v, rel: 0.05 }, [['', 'u', 0.05, 1.3, 1.25, 0.8, 0.0], ['h', 'u', 0.2, 1.25, 0.9, 1, 0]], 0.3);
        } finally {
          sub.finish();
        }
      }
    });
  },

  /** Rick: a bright tooth-glint bell "DING" with a shimmer. */
  ding() {
    play(0.44, (s) => {
      const f = 3520 * rnd(0.98, 1.02);
      for (const [r, v, d] of [[1, 0.6, 1.1], [2.76, 0.25, 0.45], [5.4, 0.12, 0.22]] as const) {
        const o = s.osc('sine', f * r, [[0, 0], [0.002, v], [d, 0.0001, 'e']]);
        s.lfo(o.frequency, 6, [[0, 0], [d, 18 * r]], 0, d);
      }
      twinkle(s, 0.04, 0.1);
    });
  },

  /** Rick: an aerosol spray hiss lasting `sec` seconds (0.15-4). */
  spray(sec = 1) {
    const d = Math.min(4, Math.max(0.15, sec || 1));
    play(0.27, (s) => {
      const turb = s.am(rnd(13, 17), 0.2, 0, d + 0.1);
      s.noise([[0, 0], [0.03, 0.7], [d - 0.05, 0.6], [d + 0.08, 0.0001, 'e']], turb, { type: 'highpass', f: 4500, q: 0.7 });
      s.noise([[0, 0], [0.03, 0.25], [d, 0.2], [d + 0.08, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 2500, q: 1 });
      s.noise([[0, 0], [0.002, 0.5], [0.02, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 3000, q: 1.5 });
    });
  },

  /** Rick: the spray can shaken: the bead rattling "k-tak k-tak k-tak k-tak". */
  canRattle() {
    play(0.77, (s) => {
      for (const t of [0, 0.07, 0.2, 0.27, 0.4, 0.47]) {
        const v = rnd(0.6, 0.9);
        s.noise([[t, 0], [t + 0.001, v], [t + 0.025, 0.0001, 'e']], s.bus, { type: 'bandpass', f: rnd(2400, 2900), q: 5 });
        s.osc('sine', [[t, 1900], [t + 0.02, 1500]], [[t, 0], [t + 0.001, v * 0.35], [t + 0.04, 0.0001, 'e']]);
      }
    });
  },

  /** Rick: a tyre going flat: a long sagging "pfffft" (~1.1 s). */
  deflate() {
    play(0.48, (s) => {
      const len = 1.1;
      s.noise([[0, 0], [0.02, 0.8], [0.3, 0.6], [len, 0.0001, 'e']], s.am([[0, 30], [len, 12]], 0.35, 0, len), { type: 'bandpass', f: [[0, 3800], [len, 900]], q: 1.4 });
      s.noise([[0, 0], [0.05, 0.3], [len, 0.0001, 'e']], s.bus, { type: 'lowpass', f: [[0, 800], [len, 200]] });
      s.osc('sine', [[0, 700], [len, 160]], [[0, 0], [0.05, 0.06], [len, 0.0001, 'e']]);
    });
  },

  /** Rick: a cash register "ka-CHING!" for SOLD. */
  kaching() {
    play(0.34, (s) => {
      // "ka": the drawer mechanism clunk.
      s.noise([[0, 0], [0.001, 0.7], [0.03, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 1600, q: 1.2 });
      thump(s, 0, 0.5, 260, 120, 0.06);
      s.noise([[0.06, 0], [0.061, 0.5], [0.08, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 2600, q: 1.5 });
      // "CHING": a bright bell pair.
      for (const [f, v] of [[2093, 0.5], [2637, 0.4], [4186, 0.18]] as const)
        for (const dt of [-2, 2]) s.osc('sine', f + dt, [[0.12, 0], [0.122, v * 0.5], [0.12 + 1.0, 0.0001, 'e']]);
      s.noise([[0.12, 0], [0.121, 0.4], [0.16, 0.0001, 'e']], s.bus, { type: 'highpass', f: 5000 });
    });
  },

  /** Ivy: an arc welder for `sec` seconds (0.15-4): a 100 Hz electric buzz with spitting crackles. */
  weldArc(sec = 1) {
    const d = Math.min(4, Math.max(0.15, sec || 1));
    play(0.3, (s) => {
      const amp: Pt[] = [[0, 0], [0.02, 0.5], [d - 0.03, 0.5], [d, 0.0001, 'e']];
      const buzz = s.filter('bandpass', 1800, 0.7, s.am(rnd(7, 11), 0.5, 0, d, s.bus, 'square'));
      s.osc('sawtooth', 100, amp, buzz);
      s.osc('square', 200, amp.map(([x, y, m]) => [x, y * 0.4, m ?? 'l'] as Pt), buzz);
      s.noise(amp.map(([x, y, m]) => [x, y * 0.8, m ?? 'l'] as Pt), s.am(100, 0.9, 0, d, s.bus, 'square'), { type: 'highpass', f: 3000 });
      crackles(s, 0.02, d, Math.ceil(d * 30), 0.6, [2500, 6000]);
    });
  },

  /** Ivy: a heavy steel vise ratchet: a clank, a ratchet tick and a ring. */
  viseClank() {
    play(0.34, (s) => {
      const k = rnd(0.92, 1.08);
      thump(s, 0, 0.8, 200 * k, 70, 0.12);
      s.noise([[0, 0], [0.0008, 0.9], [0.03, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 2200 * k, q: 1.2 });
      for (const [f, v, len] of [[420, 0.3, 0.5], [1130, 0.22, 0.35], [2210, 0.15, 0.2], [3400, 0.08, 0.12]] as const)
        s.osc('sine', f * k, [[0, 0], [0.002, v], [len, 0.0001, 'e']]);
      for (const t of [0.07, 0.11]) s.noise([[t, 0], [t + 0.0006, 0.5], [t + 0.01, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 3200, q: 2 });
    });
  },

  /** Ivy: a meaty knuckle pop (a quick run of cracks). */
  knuckleCrack() {
    play(0.85, (s) => {
      for (const t of [0, 0.045, 0.08, 0.13]) {
        s.noise([[t, 0], [t + 0.0005, rnd(0.6, 1)], [t + 0.012, 0.0001, 'e']], s.bus, { type: 'bandpass', f: rnd(1200, 2000), q: 2.5 });
        s.osc('sine', [[t, rnd(500, 700)], [t + 0.02, 250]], [[t, 0], [t + 0.001, 0.3], [t + 0.03, 0.0001, 'e']]);
      }
    });
  },

  /** Ivy: a hydraulic ram: a pressurised hiss with a rising seal squeal (~0.9 s). */
  hydraulicHiss() {
    play(0.5, (s) => {
      hiss(s, 0, 0.9, 0.7);
      const o = s.osc('sine', [[0, 1100], [0.6, 1700], [0.85, 1500]], [[0, 0], [0.1, 0.12], [0.7, 0.12], [0.85, 0.0001, 'e']]);
      s.lfo(o.frequency, 9, 40, 0, 0.85);
      thump(s, 0, 0.4, 90, 45, 0.2);
    });
  },

  /** DJ: a record scratch "wikka-wikka". */
  scratch() {
    play(0.32, (s) => scratch(s, 0, 0.8));
  },

  /** DJ: an electronic dashboard dying: a falling tone, a fizz and a last blip. */
  powerDown() {
    play(0.3, (s) => {
      const len = 0.9;
      s.osc('square', [[0, 1400], [len, 60]], [[0, 0], [0.01, 0.35], [len * 0.7, 0.25], [len, 0.0001, 'e']], s.filter('lowpass', [[0, 4000], [len, 400]], 2));
      s.osc('sine', [[0, 700], [len, 30]], [[0, 0], [0.01, 0.4], [len, 0.0001, 'e']]);
      s.noise([[0, 0], [0.02, 0.3], [len * 0.6, 0.15], [len, 0.0001, 'e']], s.am(37, 0.9, 0, len, s.bus, 'square'), { type: 'highpass', f: 3000 });
      s.osc('sine', 2400, [[len + 0.05, 0], [len + 0.051, 0.15], [len + 0.09, 0.0001, 'e']]);
    });
  },

  /** DJ: a heavy stadium breaker clunk (each light tower; varies per call). */
  clunk() {
    play(0.4, (s) => {
      const k = rnd(0.88, 1.12);
      thump(s, 0, 1, 120 * k, 40 * k, 0.3);
      s.noise([[0, 0], [0.0008, 0.8], [0.04, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 900 * k, q: 1 });
      for (const [f, v, len] of [[180, 0.25, 0.5], [470, 0.15, 0.3]] as const) s.osc('sine', f * k, [[0, 0], [0.002, v], [len, 0.0001, 'e']]);
      s.osc('sawtooth', 50, [[0.03, 0], [0.06, 0.08], [0.5, 0.0001, 'e']], s.filter('lowpass', 400, 1));
    });
  },

  /** DJ: a small LED switch-on click with a tiny electric tick. */
  click() {
    play(0.6, (s) => {
      s.noise([[0, 0], [0.0004, 1], [0.006, 0.0001, 'e']], s.bus, { type: 'bandpass', f: rnd(3500, 4500), q: 2 });
      s.osc('sine', rnd(5500, 6500), [[0.004, 0], [0.005, 0.12], [0.05, 0.0001, 'e']]);
    });
  },

  /** DJ: club laser zaps: a burst of falling square "pew"s. */
  laserZap() {
    play(0.67, (s) => {
      for (let i = 0; i < 4; i++) {
        const t = i * rnd(0.08, 0.12);
        const f = rnd(2500, 4000);
        s.osc('square', [[t, f], [t + 0.12, f * 0.15]], [[t, 0], [t + 0.003, 0.4], [t + 0.13, 0.0001, 'e']], s.filter('lowpass', 6000, 1));
      }
    });
  },

  /** DJ: a build-up riser for `sec` seconds (0.3-6): rising noise and saws with an accelerating snare roll. */
  riser(sec = 2) {
    const d = Math.min(6, Math.max(0.3, sec || 2));
    play(0.45, (s) => riser(s, d, 0.6, 9000));
  },

  /** DJ: a huge sub bass drop. */
  bassDrop() {
    play(0.26, (s) => {
      drop(s, 0, 110, 1.8, 1);
      thump(s, 0, 0.9, 150, 35, 0.5);
      crash(s, 0, 1.2, 0.25);
    });
  },

  /** DJ: the player's small, ordinary engine idling for `sec` seconds (0.3-8). */
  engineIdle(sec = 1) {
    const d = Math.min(8, Math.max(0.3, sec || 1));
    play(0.2, (s) =>
      engine(s, {
        f: [[0, 30], [d, 30]],
        amp: [[0, 0], [0.08, 0.8], [d - 0.08, 0.8], [d, 0.0001, 'e']],
        lp: [[0, 900], [d, 900]],
        drive: 2,
        spread: 8,
        chug: { rate: 15, depth: 0.5 },
      }),
    );
  },

  /** DJ: a weak little engine sputtering and dying out (~1.2 s). */
  engineSputter() {
    play(0.2, (s) => {
      engine(s, {
        f: [[0, 32], [0.3, 40], [0.5, 26], [0.8, 34], [1.2, 18]],
        amp: [[0, 0], [0.04, 0.8], [0.6, 0.6], [1.2, 0.0001, 'e']],
        lp: [[0, 1100], [1.2, 400]],
        drive: 2,
        spread: 8,
        chug: { rate: [[0, 14], [1.2, 6]], depth: [[0, 0.5], [0.5, 0.9]] },
      });
      crackles(s, 0.2, 1.1, 6, 0.6, [400, 1200]);
    });
  },

  /** DJ: microphone feedback whine swelling up (~1.6 s). */
  feedback() {
    play(0.32, (s) => {
      const len = 1.6;
      const f = rnd(2600, 3200);
      const o = s.osc('sine', [[0, f], [len, f * 1.03]], [[0, 0.002], [len * 0.8, 0.8, 'e'], [len, 0.0001, 'e']]);
      s.lfo(o.frequency, 5, 12, 0, len);
      s.osc('sine', f * 1.5, [[0.4, 0.001], [len * 0.8, 0.25, 'e'], [len, 0.0001, 'e']]);
    });
  },

  /** DJ: a mic hitting the lens: a hard thud and a boomy PA thump. */
  micThud() {
    play(0.4, (s) => {
      s.noise([[0, 0], [0.0008, 1], [0.03, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 1500, q: 1 });
      thump(s, 0, 1, 180, 60, 0.12);
      thump(s, 0.02, 0.9, 70, 32, 0.6);
      s.osc('square', [[0.02, 60], [0.5, 40]], [[0.02, 0], [0.03, 0.2], [0.6, 0.0001, 'e']], s.filter('lowpass', 300, 1));
    });
  },

  /** Pivot: a classic electric school bell ringing (~1 s): a hammer drumming a bell at ~25 Hz. */
  schoolBell() {
    play(0.25, (s) => {
      const len = 1.0;
      const hammer = s.am(rnd(24, 27), 0.85, 0, len + 0.05, s.bus, 'square');
      const amp: Pt[] = [[0, 0], [0.01, 0.5], [len, 0.45], [len + 0.4, 0.0001, 'e']];
      for (const [r, v] of [[1, 1], [2.76, 0.5], [5.4, 0.25], [8.9, 0.1]] as const)
        for (const dt of [-3, 3]) s.osc('sine', 1250 * r + dt, amp.map(([x, y, m]) => [x, y * v * 0.5, m ?? 'l'] as Pt), hammer);
      s.noise([[0, 0], [0.01, 0.15], [len, 0.12], [len + 0.02, 0.0001, 'e']], hammer, { type: 'bandpass', f: 4000, q: 1 });
    });
  },

  /** Pivot: a wooden pointer cracking against the chalkboard; varies per call, with a chalk-dust puff. */
  chalkWhack() {
    play(0.25, (s) => {
      const k = rnd(0.9, 1.1);
      s.noise([[0, 0.0005], [0.06, 0.3, 'e'], [0.062, 0]], s.bus, { type: 'bandpass', f: [[0, 700], [0.06, 2500]], q: 1 });
      const t = 0.06;
      smack(s, t, 1, 1500 * k);
      s.osc('triangle', [[t, 800 * k], [t + 0.05, 380 * k]], [[t, 0], [t + 0.001, 0.5], [t + 0.09, 0.0001, 'e']]);
      // Board slate rattle and a puff of chalk dust.
      for (const [f, v, len] of [[260, 0.25, 0.25], [610, 0.15, 0.15]] as const) s.osc('sine', f * k, [[t, 0], [t + 0.002, v], [t + len, 0.0001, 'e']]);
      s.noise([[t + 0.01, 0], [t + 0.04, 0.15], [t + 0.35, 0.0001, 'e']], s.bus, { type: 'highpass', f: 5000 });
    });
  },

  /** Pivot: a rubber stamp THUNK onto paper (with the inked lift-off). */
  rubberStamp() {
    play(0.4, (s) => {
      thump(s, 0, 1, 160, 60, 0.15);
      s.noise([[0, 0], [0.001, 0.7], [0.05, 0.0001, 'e']], s.bus, { type: 'lowpass', f: 1500, q: 1 });
      s.noise([[0.12, 0], [0.13, 0.2], [0.18, 0.0001, 'e']], s.bus, { type: 'bandpass', f: 900, q: 3 });
    });
  },

  /** Fade out every cutscene sound that's playing (the skip). New sounds start on a fresh bus. */
  hush(fade = 0.12) {
    try {
      const a = audioOut();
      const b = a && buses.get(a.ctx);
      if (!a || !b) return;
      const now = a.ctx.currentTime;
      b.g.gain.cancelScheduledValues(now);
      b.g.gain.setValueAtTime(b.g.gain.value, now);
      b.g.gain.linearRampToValueAtTime(0, now + fade);
      buses.delete(a.ctx);
      setTimeout(() => b.g.disconnect(), (fade + 0.1) * 1000);
    } catch {
      /* ignore */
    }
  },
};

/** Dev check: render `fn`'s cutscene sounds into an offline context, measured at the master input (pre-0.22). */
export async function renderCutsceneSfx(fn: () => void, secs: number, rate = 44100): Promise<AudioBuffer | null> {
  try {
    const off = new OfflineAudioContext(1, Math.ceil(rate * secs), rate);
    forced = { c: off, out: off.destination };
    fn();
    forced = null;
    return await off.startRendering();
  } catch {
    forced = null;
    return null;
  }
}
