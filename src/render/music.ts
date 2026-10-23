// Endless synth music on the shared mixer (no audio files). One track loops forever; switching tracks
// crossfades. Revs and install sounds call duck() in audio.ts, which muffles and dips the music, then it
// swells back. Tracks are step functions called once per 16th note (see music/menu.ts, music/race.ts).
//
//   playMusic('menu'); playMusic('boss2');
import { audioOut, onDuck } from './audio';
import { MENU_TRACK } from './music/menu';
import { RACE_TRACKS } from './music/race';

export type TrackId = 'menu' | 'race1' | 'race2' | 'race3' | 'race4' | 'boss1' | 'boss2' | 'boss3' | 'boss4';

export interface Track {
  bpm: number;
  /** Delay of odd 16ths as a fraction of a 16th (0 = straight, ~0.3 = lazy swing). */
  swing?: number;
  /** Track level, 1 = default. Race tracks sit lower under the engine. */
  gain?: number;
  /** Schedule everything that starts on 16th `step` (counts up forever from 0) at audio time `t`. */
  step(s: Synth, step: number, t: number): void;
}

export interface Voice {
  type?: OscillatorType;
  vol?: number;
  /** Attack / release seconds. */
  a?: number;
  r?: number;
  /** Lowpass cutoff Hz (and Q). Omit for none. */
  cutoff?: number;
  q?: number;
  /** Filter envelope: cutoff starts this many times higher and falls to `cutoff` over the note. */
  pluck?: number;
  /** Two oscillators spread by this many cents. */
  spread?: number;
  /** Delayed vibrato depth in cents. */
  vib?: number;
  /** Echo send 0..1. */
  echo?: number;
  /** Slide in from this many semitones away. */
  slide?: number;
}

export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/** Instruments for tracks. Everything routes into the current track's output so crossfades are clean. */
export class Synth {
  constructor(
    readonly c: BaseAudioContext,
    readonly out: AudioNode,
    private wow: AudioNode,
    private echoIn: AudioNode,
    private noiseBuf: AudioBuffer,
  ) {}

  /** A pitched note: midi number, start, length in seconds. */
  note(m: number, t: number, dur: number, v: Voice = {}) {
    const c = this.c;
    const vol = v.vol ?? 0.1;
    const a = v.a ?? 0.005;
    const r = v.r ?? 0.08;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.setValueAtTime(vol, t + Math.max(a, dur));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(a, dur) + r);
    const end = t + Math.max(a, dur) + r + 0.02;
    let head: AudioNode = g;
    const nodes: AudioNode[] = [g];
    if (v.cutoff) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.Q.value = v.q ?? 0.7;
      if (v.pluck) {
        f.frequency.setValueAtTime(v.cutoff * v.pluck, t);
        f.frequency.exponentialRampToValueAtTime(v.cutoff, t + Math.max(0.04, dur));
      } else f.frequency.value = v.cutoff;
      f.connect(g);
      head = f;
      nodes.push(f);
    }
    g.connect(this.out);
    if (v.echo) {
      const e = c.createGain();
      e.gain.value = v.echo;
      g.connect(e).connect(this.echoIn);
      nodes.push(e);
    }
    const f0 = mtof(m);
    const oscs: OscillatorNode[] = [];
    const spread = v.spread ? [-v.spread / 2, v.spread / 2] : [0];
    for (const d of spread) {
      const o = c.createOscillator();
      o.type = v.type ?? 'square';
      o.detune.value = d;
      if (v.slide) {
        o.frequency.setValueAtTime(f0 * Math.pow(2, v.slide / 12), t);
        o.frequency.exponentialRampToValueAtTime(f0, t + Math.min(0.08, dur));
      } else o.frequency.value = f0;
      this.wow.connect(o.detune);
      o.connect(head);
      oscs.push(o);
    }
    let vib: OscillatorNode | null = null;
    if (v.vib && dur > 0.18) {
      vib = c.createOscillator();
      vib.frequency.value = 5.5;
      const vg = c.createGain();
      vg.gain.setValueAtTime(0, t);
      vg.gain.linearRampToValueAtTime(v.vib, t + Math.min(0.35, dur));
      vib.connect(vg);
      oscs.forEach((o) => vg.connect(o.detune));
      vib.start(t);
      vib.stop(end);
      nodes.push(vg);
    }
    oscs.forEach((o) => o.start(t));
    oscs.forEach((o) => o.stop(end));
    oscs[0].onended = () => {
      oscs.forEach((o) => {
        try {
          this.wow.disconnect(o.detune);
        } catch {
          /* already gone */
        }
        o.disconnect();
      });
      vib?.disconnect();
      nodes.forEach((n) => n.disconnect());
    };
  }

  /** Several notes at once (a chord). */
  chord(ms: number[], t: number, dur: number, v: Voice = {}) {
    ms.forEach((m) => this.note(m, t, dur, v));
  }

  private noise(t: number, dur: number, vol: number, type: BiquadFilterType, freq: number, q = 0.8, echo = 0) {
    const c = this.c;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.out);
    let e: GainNode | null = null;
    if (echo) {
      e = c.createGain();
      e.gain.value = echo;
      g.connect(e).connect(this.echoIn);
    }
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
    s.onended = () => {
      s.disconnect();
      f.disconnect();
      g.disconnect();
      e?.disconnect();
    };
  }

  kick(t: number, vol = 0.5, punch = 1) {
    const c = this.c;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(140 * punch, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.34);
    o.onended = () => (o.disconnect(), g.disconnect());
    if (punch > 1) this.noise(t, 0.015, vol * 0.4, 'highpass', 3000);
  }

  snare(t: number, vol = 0.25, tone = 190) {
    this.noise(t, 0.16, vol, 'bandpass', 1900, 0.9, 0.15);
    this.note(Math.round(12 * Math.log2(tone / 440) + 69), t, 0.02, { type: 'triangle', vol: vol * 0.6, r: 0.06 });
  }

  clap(t: number, vol = 0.22) {
    for (let i = 0; i < 3; i++) this.noise(t + i * 0.011, i === 2 ? 0.14 : 0.02, vol, 'bandpass', 1300, 1.6, i === 2 ? 0.2 : 0);
  }

  hat(t: number, vol = 0.06, open = false) {
    this.noise(t, open ? 0.2 : 0.035, vol, 'highpass', 7500, 0.7);
  }

  shaker(t: number, vol = 0.04) {
    this.noise(t, 0.05, vol, 'bandpass', 5200, 1.2);
  }
}

// ------------------------------------------------------------------------------------------------
// Player: lookahead scheduler, crossfades, ducking.

const TRACKS: Record<TrackId, Track> = { menu: MENU_TRACK, ...RACE_TRACKS };
const LOOKAHEAD = 0.15;
const BUS = 0.55;
const OPEN = 16000;

interface Bus {
  c: BaseAudioContext;
  lp: BiquadFilterNode;
  vol: GainNode;
  wow: GainNode;
  echoIn: GainNode;
  noise: AudioBuffer;
}

interface Playing {
  id: TrackId;
  track: Track;
  out: GainNode;
  synth: Synth;
  step: number;
  next: number;
}

let bus: Bus | null = null;
let cur: Playing | null = null;
let want: TrackId | null = null;
let timer = 0;
let duckUntil = 0;
let duckTimer = 0;

function getBus(): Bus | null {
  const o = audioOut();
  if (!o) return null;
  if (bus && bus.c === o.ctx) return bus;
  if (bus) return null; // context swapped for an offline render; skip this tick
  const c = o.ctx;
  const vol = c.createGain();
  vol.gain.value = BUS;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = OPEN;
  lp.Q.value = 0.9;
  lp.connect(vol).connect(o.out);
  // Tape wow: one slow LFO in cents shared by every oscillator, for that woozy, warm wobble.
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.42;
  const wow = c.createGain();
  wow.gain.value = 9;
  lfo.connect(wow);
  lfo.start();
  // Dark feedback echo.
  const echoIn = c.createGain();
  const dl = c.createDelay(1);
  dl.delayTime.value = 0.33;
  const fb = c.createGain();
  fb.gain.value = 0.38;
  const dlp = c.createBiquadFilter();
  dlp.type = 'lowpass';
  dlp.frequency.value = 2200;
  echoIn.connect(dl).connect(dlp).connect(fb).connect(dl);
  dlp.connect(lp);
  const noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  bus = { c, lp, vol, wow, echoIn, noise };
  onDuck(duckFor);
  return bus;
}

function start(b: Bus, id: TrackId) {
  const c = b.c;
  const track = TRACKS[id];
  const out = c.createGain();
  out.gain.setValueAtTime(0, c.currentTime);
  out.gain.linearRampToValueAtTime(track.gain ?? 1, c.currentTime + 0.8);
  out.connect(b.lp);
  if (cur) {
    const old = cur.out;
    old.gain.cancelScheduledValues(c.currentTime);
    old.gain.setValueAtTime(old.gain.value, c.currentTime);
    old.gain.linearRampToValueAtTime(0, c.currentTime + 1);
    setTimeout(() => old.disconnect(), 2500);
  }
  cur = { id, track, out, synth: new Synth(c, out, b.wow, b.echoIn, b.noise), step: 0, next: c.currentTime + 0.1 };
}

function tick() {
  if (!want) return;
  const b = getBus();
  if (!b || (b.c as AudioContext).state !== 'running') return;
  if (!cur || cur.id !== want) start(b, want);
  const p = cur!;
  const now = b.c.currentTime;
  if (p.next < now) p.next = now + 0.05; // timers were throttled (background tab): skip ahead, don't burst
  const sixteenth = 60 / p.track.bpm / 4;
  while (p.next < now + LOOKAHEAD) {
    const sw = p.step % 2 ? (p.track.swing ?? 0) * sixteenth : 0;
    try {
      p.track.step(p.synth, p.step, p.next + sw);
    } catch {
      /* a bad step must not kill the loop */
    }
    p.step++;
    p.next += sixteenth;
  }
}

/** Play a track (no-op if it's already playing). Loops forever until another track is asked for. */
export function playMusic(id: TrackId) {
  want = id;
  if (!timer) timer = window.setInterval(tick, 25);
  tick();
}

export function currentMusic(): TrackId | null {
  return want;
}

function duckFor(sec: number) {
  const b = bus;
  if (!b) return;
  const t = b.c.currentTime;
  duckUntil = Math.max(duckUntil, t + sec);
  b.lp.frequency.cancelScheduledValues(t);
  b.lp.frequency.setTargetAtTime(380, t, 0.06);
  b.vol.gain.cancelScheduledValues(t);
  b.vol.gain.setTargetAtTime(BUS * 0.3, t, 0.08);
  clearTimeout(duckTimer);
  duckTimer = window.setTimeout(
    () => {
      const now = b.c.currentTime;
      b.lp.frequency.setTargetAtTime(OPEN, now, 0.35);
      b.vol.gain.setTargetAtTime(BUS, now, 0.3);
    },
    (duckUntil - t) * 1000,
  );
}
