// WebAudio synth: no sound files. Engine drone + one-shot effects. M toggles mute.
const MUTE_KEY = 'revlotto_muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
try {
  muted = localStorage.getItem(MUTE_KEY) === '1';
} catch {
  /* storage blocked */
}

function ac(): AudioContext | null {
  if (!ctx) {
    try {
      const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new C();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.22;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** Call from any user input handler so the context can start. */
export function unlockAudio() {
  ac();
}

export function isMuted() {
  return muted;
}

export function toggleMute(): boolean {
  muted = !muted;
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* ignore */
  }
  const c = ac();
  if (c && master) master.gain.setTargetAtTime(muted ? 0 : 0.22, c.currentTime, 0.02);
  return muted;
}

let noiseBuf: AudioBuffer | null = null;
function noise(c: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 1, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
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
}

function noiseHit(dur: number, freq: number, q: number, vol: number, when = 0, sweepTo?: number) {
  const c = ac();
  if (!c || !master) return;
  const t0 = c.currentTime + when;
  const s = c.createBufferSource();
  s.buffer = noise(c);
  s.loop = true;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(freq, t0);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t0);
  s.stop(t0 + dur + 0.05);
}

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
};

/** Continuous engine drone whose pitch and timbre follow rpm. */
export class EngineSound {
  private c: AudioContext | null;
  private saw?: OscillatorNode;
  private sq?: OscillatorNode;
  private sub?: OscillatorNode;
  private lp?: BiquadFilterNode;
  private g?: GainNode;
  private stutter = 0;

  constructor() {
    this.c = ac();
    const c = this.c;
    if (!c || !master) return;
    this.saw = c.createOscillator();
    this.saw.type = 'sawtooth';
    this.sq = c.createOscillator();
    this.sq.type = 'square';
    this.sub = c.createOscillator();
    this.sub.type = 'sawtooth';
    this.lp = c.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.Q.value = 4;
    this.g = c.createGain();
    this.g.gain.value = 0;
    const sqG = c.createGain();
    sqG.gain.value = 0.5;
    const subG = c.createGain();
    subG.gain.value = 0.6;
    this.saw.connect(this.lp);
    this.sq.connect(sqG).connect(this.lp);
    this.sub.connect(subG).connect(this.lp);
    this.lp.connect(this.g).connect(master);
    this.saw.start();
    this.sq.start();
    this.sub.start();
    this.set(0.12, 0, false);
  }

  /** rpm normalized (1 = redline), throttle 0..1. */
  set(rpm: number, throttle: number, limiter: boolean, nitro = false) {
    const c = this.c;
    if (!c || !this.saw || !this.sq || !this.sub || !this.lp || !this.g) return;
    const t = c.currentTime;
    const r = Math.max(0.08, Math.min(1.08, rpm));
    const f = 34 + r * 190;
    this.saw.frequency.setTargetAtTime(f, t, 0.02);
    this.sq.frequency.setTargetAtTime(f * 0.5 * 1.004, t, 0.02);
    this.sub.frequency.setTargetAtTime(f * 0.25, t, 0.02);
    this.lp.frequency.setTargetAtTime(220 + r * 1500 + throttle * 900 + (nitro ? 900 : 0), t, 0.03);
    let vol = 0.13 + throttle * 0.1;
    if (limiter) {
      this.stutter++;
      if (this.stutter % 6 < 3) vol *= 0.25;
    }
    this.g.gain.setTargetAtTime(vol, t, 0.012);
  }

  stop() {
    const c = this.c;
    if (!c || !this.g) return;
    this.g.gain.setTargetAtTime(0, c.currentTime, 0.08);
    const nodes = [this.saw, this.sq, this.sub];
    setTimeout(() => nodes.forEach((n) => n?.stop()), 400);
    this.saw = this.sq = this.sub = undefined;
  }
}
