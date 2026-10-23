// Menu / shop music: a lazy, swung, woozy groove in D minor that loops forever.
// Long form, 8-bar phrases: intro groove (first time only), then A, B, breakdown, A with doubled lead, repeat.
import type { Synth, Track } from '../music';

const BPM = 100;
const S16 = 60 / BPM / 4; // seconds per 16th
const BAR = 16;
const PHRASE = BAR * 8;

// Dm9 | Gm7 | C7 | Fmaj7 | Bbmaj7 | Gm7 | A7sus4 | A7
const CHORDS: { root: number; pad: number[] }[] = [
  { root: 38, pad: [50, 57, 60, 64] },
  { root: 43, pad: [53, 55, 58, 62] },
  { root: 36, pad: [52, 55, 58, 60] },
  { root: 41, pad: [53, 57, 60, 64] },
  { root: 46, pad: [50, 53, 57, 58] },
  { root: 43, pad: [53, 55, 58, 62] },
  { root: 45, pad: [52, 55, 57, 62] },
  { root: 45, pad: [52, 55, 57, 61] },
];

type Phrase = [step: number, midi: number, len: number][][];

const LEAD_A: Phrase = [
  [[0, 69, 3], [3, 72, 3], [6, 74, 2], [8, 72, 4], [14, 69, 2]],
  [[0, 70, 6], [6, 69, 2], [8, 67, 6], [14, 65, 2]],
  [[0, 64, 3], [3, 67, 3], [6, 70, 2], [8, 72, 6], [14, 70, 2]],
  [[0, 69, 10], [12, 67, 2], [14, 65, 2]],
  [[0, 62, 3], [3, 65, 3], [6, 69, 2], [8, 74, 4], [12, 72, 4]],
  [[0, 70, 4], [4, 72, 2], [6, 70, 2], [8, 67, 8]],
  [[0, 69, 3], [3, 74, 3], [6, 72, 2], [8, 69, 4], [12, 67, 4]],
  [[0, 73, 6], [6, 76, 2], [8, 73, 4], [12, 69, 4]],
];

const LEAD_B: Phrase = [
  [[2, 74, 2], [4, 77, 4], [10, 76, 2], [12, 74, 4]],
  [[0, 74, 3], [3, 70, 5], [10, 67, 2], [12, 70, 4]],
  [[2, 72, 2], [4, 76, 4], [10, 74, 2], [12, 72, 4]],
  [[0, 72, 3], [3, 69, 9], [14, 72, 2]],
  [[0, 74, 6], [6, 77, 2], [8, 81, 6], [14, 79, 2]],
  [[0, 77, 4], [4, 74, 4], [8, 70, 8]],
  [[0, 76, 3], [3, 74, 3], [6, 72, 2], [8, 69, 8]],
  [[0, 73, 2], [2, 76, 2], [4, 79, 4], [8, 81, 4], [12, 79, 2], [14, 76, 2]],
];

type Section = 'intro' | 'a' | 'b' | 'break' | 'a2';
const CYCLE: Section[] = ['a', 'b', 'break', 'a2'];

function sectionOf(step: number): Section {
  const p = Math.floor(step / PHRASE);
  return p === 0 ? 'intro' : CYCLE[(p - 1) % CYCLE.length];
}

function lead(s: Synth, phrase: Phrase, bar: number, i: number, t: number, double: boolean) {
  for (const [at, m, len] of phrase[bar]) {
    if (at !== i) continue;
    const dur = len * S16 * 0.92;
    s.note(m, t, dur, { type: 'square', vol: 0.055, spread: 10, cutoff: 1900, pluck: 1.8, vib: 16, echo: 0.28, a: 0.01, r: 0.14, slide: at === 0 && len >= 6 ? -1 : 0 });
    if (double) s.note(m - 12, t, dur, { type: 'triangle', vol: 0.06, a: 0.01, r: 0.12 });
  }
}

function bass(s: Synth, bar: number, i: number, t: number) {
  const root = CHORDS[bar].root;
  const next = CHORDS[(bar + 1) % CHORDS.length].root;
  // Walking: root, fifth, octave, root, flat seven, chromatic approach into the next bar.
  const walk: Record<number, [number, number]> = {
    0: [root, 3],
    6: [root + 7, 2],
    8: [root + 12, 1],
    10: [root, 2],
    12: [root + 10, 2],
    14: [next + (next > root ? -1 : 1), 2],
  };
  const w = walk[i];
  if (!w) return;
  const dur = w[1] * S16 * 0.85;
  s.note(w[0], t, dur, { type: 'triangle', vol: 0.2, r: 0.06 });
  s.note(w[0], t, dur, { type: 'square', vol: 0.03, cutoff: 520, r: 0.05 });
}

export const MENU_TRACK: Track = {
  bpm: BPM,
  swing: 0.3,
  step(s, step, t) {
    const sec = sectionOf(step);
    const inPhrase = step % PHRASE;
    const bar = Math.floor(inPhrase / BAR);
    const i = step % BAR;
    const chord = CHORDS[bar];
    const brk = sec === 'break';

    // Pad swell on each bar, warmer and louder in the breakdown.
    if (i === 0) s.chord(chord.pad, t, BAR * S16 * 0.95, { type: 'sawtooth', vol: brk ? 0.03 : 0.02, spread: 14, cutoff: brk ? 1300 : 850, a: 0.25, r: 0.5 });
    // Offbeat organ skank.
    if (!brk && (i === 6 || i === 14)) s.chord(chord.pad.map((m) => m + 12), t, S16 * 0.6, { type: 'square', vol: 0.016, cutoff: 1500, pluck: 2.5, r: 0.05 });

    bass(s, bar, i, t);

    // Drums: laid-back kick, clap on 2 and 4, soft hats and shaker in between.
    if (!brk) {
      if (i === 0 || i === 10 || (bar % 2 === 1 && i === 7)) s.kick(t, 0.42);
      if (i === 4 || i === 12) s.clap(t, 0.13);
      if (i === 12 && bar === 7 && sec !== 'b') s.snare(t + S16, 0.08);
    }
    if (i % 2 === 0) s.hat(t, brk ? 0.02 : 0.032, i === 14 && !brk);
    else if (!brk) s.shaker(t, 0.018);
    // Turnaround fill into the next phrase.
    if (!brk && bar === 7 && i >= 12) s.snare(t, 0.05 + (i - 12) * 0.02);

    // Breakdown: echoing arpeggio of the chord instead of the lead.
    if (brk && i % 2 === 0) {
      const notes = [...chord.pad, chord.pad[1] + 12];
      s.note(notes[(i / 2) % notes.length] + 12, t, S16 * 1.6, { type: 'triangle', vol: 0.05, echo: 0.4, r: 0.2 });
    }

    if (sec === 'a') lead(s, LEAD_A, bar, i, t, false);
    else if (sec === 'b') lead(s, LEAD_B, bar, i, t, false);
    else if (sec === 'a2') lead(s, LEAD_A, bar, i, t, true);
  },
};
