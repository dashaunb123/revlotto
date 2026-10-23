// Race music: one track per round (race1..race4) and a boss track per round (boss1..boss4).
//
// Every track is the same song machine fed different data. A song is 8 sections of 4 bars (32 bars, about
// 50-60 s) that loops forever:
//
//   intro → groove → hook → answer → break → build → lift → drive → (again, with a different arp)
//
// Melodies, bass lines and progressions are written in SCALE DEGREES, not notes. A boss track replays its
// round's progression and hook in a darker mode (phrygian, or a flat-2 harmonic minor for the final boss),
// so it keeps the same shape but sounds menacing, with heavier drums and a gritty chugging bass.
import type { Synth, Track, Voice } from '../music';

// Scales as semitone offsets of the 7 degrees.
const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];
const HARMONIC = [0, 2, 3, 5, 7, 8, 11];
const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];
const NEAPOLITAN = [0, 1, 3, 5, 7, 8, 11]; // harmonic minor with a flat 2: the final boss

type Section = 'intro' | 'groove' | 'hook' | 'answer' | 'break' | 'build' | 'lift' | 'drive';
const FORM: Section[] = ['intro', 'groove', 'hook', 'answer', 'break', 'build', 'lift', 'drive'];
const BARS = 4; // bars per section

interface Song {
  bpm: number;
  gain: number;
  scale: number[];
  /** Key root (midi) for the lead; the arp and bass sit an octave or two below. */
  root: number;
  arpRoot: number;
  bassRoot: number;
  /** Chord per bar as a scale degree (0 = i). `prog` for most sections, `prog2` for break and build. */
  prog: number[];
  prog2: number[];
  /** 4-bar melodies as 32 eighth-note tokens: degree, '.' rest, '-' hold. Degree 7 is an octave up. */
  hook: string;
  answer: string;
  /** 16 chars per bar: R root, O octave up, F fifth, '.' rest. */
  bass: string;
  /** 16 indices into the chord's tones [root, 3rd, 5th, oct, oct+3rd, oct+5th]; the alt plays every other loop. */
  arp: number[];
  arpAlt: number[];
  lead: Voice;
  boss?: boolean;
  final?: boolean;
}

interface Hit {
  deg: number;
  len: number; // eighths
}

/** Parse a melody string into a 32-slot array of hits (null where nothing starts). */
function melody(src: string): (Hit | null)[] {
  const tok = src.trim().split(/\s+/);
  if (tok.length !== 32) throw new Error(`melody needs 32 eighths, got ${tok.length}: ${src}`);
  const out: (Hit | null)[] = tok.map(() => null);
  let last: Hit | null = null;
  tok.forEach((k, i) => {
    if (k === '-') {
      if (last) last.len++;
    } else if (k === '.') last = null;
    else out[i] = last = { deg: Number(k), len: 1 };
  });
  return out;
}

/** Midi note of scale degree `deg` above `root` (degrees past 6 climb octaves). */
const deg2midi = (scale: number[], root: number, deg: number) =>
  root + scale[((deg % 7) + 7) % 7] + 12 * Math.floor(deg / 7);

/** Chord tones (as degrees) for a chord built on `d`: root, 3rd, 5th, then the same an octave up. */
const TONES = [0, 2, 4, 7, 9, 11];

function song(g: Song): Track {
  const hook = melody(g.hook);
  const answer = melody(g.answer);
  const sixteenth = 60 / g.bpm / 4;
  const eighth = sixteenth * 2;
  const at = (deg: number, root: number) => deg2midi(g.scale, root, deg);
  // Bass folds high roots down an octave so it stays in the punchy 40-95 Hz band, under the kick's knock.
  const bassNote = (d: number) => {
    const m = at(d, g.bassRoot);
    return m - g.bassRoot >= 7 ? m - 12 : m;
  };

  const bassV: Voice = g.boss
    ? { type: 'sawtooth', vol: 0.085, cutoff: 260, pluck: 7, q: 6, spread: 22, r: 0.04 }
    : { type: 'sawtooth', vol: 0.085, cutoff: 520, pluck: 4, q: 3, r: 0.05 };
  const arpV = (bright: number): Voice => ({
    type: g.boss ? 'sawtooth' : 'square',
    vol: g.boss ? 0.026 : 0.03,
    cutoff: 700 + bright * 2600,
    pluck: 2,
    r: 0.05,
    echo: 0.12,
  });

  function drums(s: Synth, sec: Section, bar: number, x: number, t: number) {
    const last = bar === BARS - 1;
    const kv = g.boss ? 0.46 : 0.4;
    const punch = g.boss ? (g.final ? 1.7 : 1.5) : 1;
    const full = sec !== 'intro' && sec !== 'break' && sec !== 'build';
    // Crash on every section start except into the breakdown.
    if (x === 0 && bar === 0 && sec !== 'break') s.hat(t, 0.09, true);

    // Kick.
    if (sec === 'break') {
      if (last && x >= 8 && x % 4 === 0) s.kick(t, kv * 0.7, punch);
    } else if (g.boss && full) {
      // Stomping boss pattern; the final boss doubles up into a blast on the last bar of the lift.
      if (g.final && sec === 'lift' && last && x >= 8) s.kick(t, kv * 0.75, punch);
      else if ([0, 3, 4, 8, 10, 12].includes(x) || (g.final && x === 14)) s.kick(t, x % 4 ? kv * 0.75 : kv, punch);
    } else if (x % 4 === 0) s.kick(t, kv, punch);

    // Snare / clap backbeat, with builds and fills.
    if (sec === 'build') {
      const every = [8, 4, 2, 1][bar];
      if (x % every === 0) s.snare(t, 0.07 + 0.13 * ((bar * 16 + x) / 64), 180 + bar * 30 + x * 4);
    } else if (sec !== 'intro' && sec !== 'break' && last && x >= (sec === 'drive' ? 8 : 12)) {
      s.snare(t, 0.1 + (x - 8) * 0.012, 200 + x * 6); // end-of-phrase roll
    } else if (sec !== 'break' && (sec !== 'intro' || bar >= 2) && (x === 4 || x === 12)) {
      s.snare(t, g.boss ? 0.24 : 0.2);
      if (g.boss || sec === 'lift' || sec === 'drive') s.clap(t, 0.13);
    } else if (sec === 'break' && last && x >= 14) s.snare(t, 0.12);

    // Hats: offbeat open-ish 8ths, quiet 16ths when it's driving.
    if (sec === 'break') {
      if (x % 4 === 2) s.shaker(t, 0.03);
    } else {
      if (x % 4 === 2) s.hat(t, 0.045, full && (sec === 'lift' || sec === 'drive' || !!g.boss));
      else if (full || sec === 'build' || g.final) s.hat(t, x % 2 ? 0.022 : 0.03);
      if (sec === 'groove' && x % 2 === 1) s.shaker(t, 0.02);
    }
  }

  function bass(s: Synth, sec: Section, d: number, bar: number, x: number, t: number) {
    const root = bassNote(d);
    if (sec === 'break') {
      // Long held root, then pump into the build.
      if (x === 0) s.note(root, t, sixteenth * 14, { ...bassV, vol: 0.075, cutoff: g.boss ? 200 : 380, pluck: 2 });
      return;
    }
    let pat = g.bass;
    if (sec === 'intro' && bar < 2) pat = 'R...R...R...R...';
    if (sec === 'build') pat = bar < 3 ? 'R.R.R.R.R.R.R.R.' : 'RRRRRRRROOOOOOOO';
    const c = pat[x];
    if (c === '.') return;
    const fifth = at(d + 4, 0) - at(d, 0);
    const m = c === 'O' ? root + 12 : c === 'F' ? root + fifth : root;
    // Accent the downbeats a little.
    s.note(m, t, sixteenth * 0.8, x % 4 === 0 ? bassV : { ...bassV, vol: (bassV.vol ?? 0.08) * 0.8 });
  }

  function arp(s: Synth, sec: Section, d: number, bar: number, x: number, cyc: number, t: number) {
    const base = (cyc % 2 ? g.arpAlt : g.arp)[x];
    let deg = d + TONES[base];
    let bright = 0.5;
    if (sec === 'intro') bright = 0.1 + bar * 0.08; // filter opens through the intro
    else if (sec === 'groove') bright = 0.45;
    else if (sec === 'hook' || sec === 'answer') bright = 0.35; // make room for the lead
    else if (sec === 'break') bright = 0.25;
    else if (sec === 'build') {
      bright = 0.2 + (bar * 16 + x) / 80;
      if (bar === 3) deg = d + x; // the climbing scale run into the lift
    } else bright = 0.6;
    if (sec === 'break' && x % 2) return; // half-speed in the breakdown
    s.note(at(deg, g.arpRoot), t, sixteenth * 0.6, arpV(bright));
  }

  function lead(s: Synth, sec: Section, d: number, bar: number, x: number, t: number) {
    const lv = g.lead;
    if (sec === 'break') {
      if (g.boss) {
        // Low, slow semitone threat: i, bII, i, bII...
        if (x % 8 === 0) s.note(at(x === 0 ? 0 : 1, g.root - 12), t, sixteenth * 7, { ...lv, vol: 0.05, echo: 0.35 });
      } else if (x === 0 || x === 8) {
        // Long chord-tone calls (the 3rd, then the 5th) floating over the breakdown.
        s.note(at(d + (x === 0 ? 2 : 4), g.root), t, sixteenth * 7, { type: 'triangle', vol: 0.06, vib: 18, echo: 0.4, a: 0.03, r: 0.3 });
      }
      return;
    }
    const mel = sec === 'hook' || sec === 'lift' ? hook : sec === 'answer' || sec === 'drive' ? answer : null;
    if (!mel || x % 2) return;
    const h = mel[bar * 8 + x / 2];
    if (!h) return;
    const dur = h.len * eighth * 0.9;
    const oct = g.boss ? g.root - 12 : g.root;
    s.note(at(h.deg, oct), t, dur, lv);
    if (g.boss) {
      // Thin square an octave up for bite.
      s.note(at(h.deg, oct + 12), t, dur, { type: 'square', vol: 0.02, cutoff: 3000, r: 0.08 });
      // Final boss: a diatonic third below on the second half of the loop.
      if (g.final && (sec === 'lift' || sec === 'drive'))
        s.note(at(h.deg - 2, oct), t, dur, { ...lv, vol: (lv.vol ?? 0.06) * 0.6, echo: 0 });
    } else if (sec === 'lift' || sec === 'drive') {
      // Soft octave-down double to make the second half bigger.
      s.note(at(h.deg, oct - 12), t, dur, { type: 'triangle', vol: 0.045, r: 0.1 });
    }
  }

  return {
    bpm: g.bpm,
    gain: g.gain,
    step(s, step, t) {
      const barN = Math.floor(step / 16);
      const x = step % 16;
      const sec = FORM[Math.floor(barN / BARS) % FORM.length];
      const bar = barN % BARS;
      const cyc = Math.floor(barN / (BARS * FORM.length));
      const d = (sec === 'break' || sec === 'build' ? g.prog2 : g.prog)[bar];
      drums(s, sec, bar, x, t);
      bass(s, sec, d, bar, x, t);
      arp(s, sec, d, bar, x, cyc, t);
      lead(s, sec, d, bar, x, t);
    },
  };
}

// ------------------------------------------------------------------------------------------------
// The rounds. Melodies were written against `prog` so strong beats land on chord tones.

/** Round 1, E minor, Em C G D: bright square hook that jumps up to the octave. */
const R1 = {
  root: 64, // E4
  arpRoot: 52,
  bassRoot: 40,
  prog: [0, 5, 2, 6],
  prog2: [5, 6, 0, 0],
  hook: '4 . 4 7 - 6 4 2   2 . 2 7 - 9 - 7   6 . 6 9 - 11 - 9   8 - 6 - 10 - 8 6',
  answer: '11 - 9 7 - 4 7 9   7 - 4 2 - 0 2 4   6 - 4 2 - 4 6 9   8 - - - 6 - 8 10',
  arp: [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 2, 1, 0, 1],
  arpAlt: [0, 2, 3, 2, 0, 2, 3, 4, 0, 2, 3, 2, 3, 4, 5, 4],
};

/** Round 2, G dorian, Gm F C Gm: bouncier, the dorian E natural gives it lift. */
const R2 = {
  root: 67, // G4
  arpRoot: 55,
  bassRoot: 43,
  prog: [0, 6, 3, 0],
  prog2: [2, 6, 3, 3],
  hook: '7 . 4 . 7 9 . 7   6 . 3 . 6 8 . 10   7 . 5 . 3 5 . 7   4 - 2 - 0 - 2 4',
  answer: '9 - 7 - 4 - 7 -   8 - 6 - 3 - 6 8   10 - 7 - 5 - 3 -   4 - - - 7 . 6 4',
  arp: [0, 3, 1, 3, 2, 3, 1, 3, 0, 3, 1, 3, 2, 4, 3, 1],
  arpAlt: [3, 2, 1, 0, 3, 2, 1, 0, 4, 3, 2, 1, 5, 4, 3, 2],
};

/** Round 3, B minor, G A Bm Bm: soaring synthwave saw lead over a 16th arp. */
const R3 = {
  root: 59, // B3; the melody lives an octave up (degrees 7-14)
  arpRoot: 59,
  bassRoot: 47,
  prog: [5, 6, 0, 0],
  prog2: [3, 4, 5, 6],
  hook: '9 - - 7 - - 9 -   10 - - 8 - - 10 12   11 - - - - - 9 11   14 - - 13 - 11 - 9',
  answer: '12 - 11 - 9 - 7 -   13 - 12 - 10 - 8 -   9 - 11 - 14 - - -   14 - 13 - 11 - 10 11',
  arp: [0, 1, 2, 1, 3, 2, 1, 2, 0, 1, 2, 1, 3, 4, 3, 2],
  arpAlt: [0, 2, 1, 3, 2, 4, 3, 5, 0, 2, 1, 3, 2, 4, 3, 5],
};

/** Round 4, A harmonic minor, Am F Dm E: fast and epic, the E major turnaround pulls it round. */
const R4 = {
  root: 69, // A4
  arpRoot: 57,
  bassRoot: 45,
  prog: [0, 5, 3, 4],
  prog2: [5, 3, 0, 4],
  hook: '4 . 7 . 4 7 9 7   5 . 9 . 5 9 7 5   3 . 7 . 5 7 10 7   6 - 4 - 8 - 6 -',
  answer: '9 - 7 - 4 - 2 -   0 - 2 - 5 - 7 -   10 - 7 - 5 - 3 -   1 - 4 - 6 - 8 6',
  arp: [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 4, 3],
  arpAlt: [3, 0, 1, 2, 3, 0, 1, 2, 4, 1, 2, 3, 5, 2, 3, 4],
};

const raceLead: Voice = { type: 'square', vol: 0.06, cutoff: 3400, r: 0.12, vib: 14, echo: 0.22 };
const bossLead: Voice = { type: 'sawtooth', vol: 0.06, cutoff: 1500, pluck: 2.5, q: 3, spread: 16, r: 0.1, vib: 10, echo: 0.2 };

export const RACE_TRACKS = {
  race1: song({ ...R1, bpm: 128, gain: 0.7, scale: AEOLIAN, bass: 'R.RRO.RRR.RRO.OF', lead: raceLead }),
  race2: song({ ...R2, bpm: 134, gain: 0.7, scale: DORIAN, bass: 'R.ORR.ORR.ORR.OF', lead: { ...raceLead, type: 'square', cutoff: 2800, vib: 10 } }),
  race3: song({
    ...R3,
    bpm: 142,
    gain: 0.68,
    scale: AEOLIAN,
    bass: 'RRORRRORRRORRROF',
    lead: { type: 'sawtooth', vol: 0.055, cutoff: 2600, spread: 12, r: 0.15, vib: 16, echo: 0.3 },
  }),
  race4: song({ ...R4, bpm: 150, gain: 0.68, scale: HARMONIC, bass: 'RRORRORORRORROFO', lead: { ...raceLead, vol: 0.062, echo: 0.25 } }),

  boss1: song({ ...R1, bpm: 138, gain: 0.72, scale: PHRYGIAN, bass: 'RR.RRR.RRR.RR.RF', lead: bossLead, boss: true }),
  boss2: song({ ...R2, bpm: 144, gain: 0.72, scale: PHRYGIAN, bass: 'RR.RRR.RRR.RR.RF', lead: bossLead, boss: true }),
  boss3: song({ ...R3, root: 71, bpm: 152, gain: 0.72, scale: PHRYGIAN, bass: 'RRRR.RRR.RRRR.RF', lead: bossLead, boss: true }),
  boss4: song({
    ...R4,
    bpm: 160,
    gain: 0.74,
    scale: NEAPOLITAN,
    bass: 'RRRRRR.RRRRRR.OF',
    lead: { ...bossLead, vol: 0.062, cutoff: 1800 },
    boss: true,
    final: true,
  }),
} satisfies Record<string, Track>;
