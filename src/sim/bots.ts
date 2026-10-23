// Scripted input policies for headless balance runs and the title-screen attract demo.
// Bots see what a player sees: oil on the strip, the gust meter, the tree (decoys included). Skill sets
// how often they notice a hazard and how much a hidden / moved / mirrored tach throws their aim off.
import { Rng } from '../core/rng';
import type { Grade, RaceInput, ShiftWindow } from '../core/types';
import { gustAt, inSpan } from './bossMods';
import { REAR_M, SIM_DT, type RaceSim } from './RaceSim';

export type BotProfile = 'perfect' | 'average' | 'sloppy';

interface ProfileCfg {
  reaction: [number, number]; // uniform range, seconds after green
  falseStartChance: number;
  /** Shift aim: offset from the perfect-band center, as a fraction of the perfect half-width (gaussian sigma). */
  shiftSigma: number;
  /** Systematic bias in half-widths (positive = late). */
  shiftBias: number;
  lateLimiterChance: number; // chance per shift of dawdling on the limiter
  nitroGear: [number, number];
  // ---- boss skills ----
  /** Chance to notice and play around a hazard (oil patch, gust) at each shift. */
  aware: number;
  /** Chance to jump on a Decoy Tree flash. */
  decoyBite: number;
  /** Hair Trigger: extra reaction (uniform range) and extra false-start chance from the broken rhythm. */
  hairReaction: [number, number];
  hairFalseStart: number;
  /** Aim sigma multipliers: window moved each gear, mirrored tach, hidden windows, tach blacked out. */
  sigDrift: number;
  sigMirror: number;
  sigBlind: number;
  sigBlackout: number;
}

const PROFILES: Record<BotProfile, ProfileCfg> = {
  perfect: {
    reaction: [0.02, 0.05], falseStartChance: 0, shiftSigma: 0.15, shiftBias: 0, lateLimiterChance: 0, nitroGear: [2, 2],
    aware: 0.97, decoyBite: 0.03, hairReaction: [0, 0.03], hairFalseStart: 0.02,
    sigDrift: 1.5, sigMirror: 1.6, sigBlind: 3.2, sigBlackout: 3,
  },
  average: {
    reaction: [0.09, 0.3], falseStartChance: 0.02, shiftSigma: 1.3, shiftBias: 0.3, lateLimiterChance: 0.05, nitroGear: [2, 3],
    aware: 0.7, decoyBite: 0.25, hairReaction: [0.02, 0.1], hairFalseStart: 0.06,
    sigDrift: 1.4, sigMirror: 2.0, sigBlind: 1.8, sigBlackout: 2.4,
  },
  sloppy: {
    reaction: [0.2, 0.45], falseStartChance: 0.1, shiftSigma: 2.6, shiftBias: 0.8, lateLimiterChance: 0.2, nitroGear: [1, 4],
    aware: 0.4, decoyBite: 0.5, hairReaction: [0.05, 0.15], hairFalseStart: 0.12,
    sigDrift: 1.3, sigMirror: 1.5, sigBlind: 1.5, sigBlackout: 1.5,
  },
};

function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng.next());
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const GRADE_SCORE: Record<Grade, number> = { perfect: 2, good: 1, miss: 0 };
function gradeAt(r: number, w: ShiftWindow): Grade {
  if (r >= w.perfectLo && r <= w.perfectHi + 0.005) return 'perfect';
  if (r >= w.goodLo && r <= w.goodHi + 0.01) return 'good';
  return 'miss';
}
/** w scaled around its centre by k (a gust squeezing the window). */
function squeeze(w: ShiftWindow, k: number): ShiftWindow {
  const c = (w.perfectLo + w.perfectHi) / 2;
  const goodHalf = c - w.goodLo;
  return {
    perfectLo: c - (c - w.perfectLo) * k,
    perfectHi: c + (w.perfectHi - c) * k,
    goodLo: c - goodHalf * Math.sqrt(k),
    goodHi: w.goodHi >= 1 ? 1 : c + (w.goodHi - c) * Math.sqrt(k),
  };
}

/**
 * Returns a policy called once per sim step (before step()) that returns the input to send, or null.
 */
export function makeBot(profile: BotProfile, seed: number): (sim: RaceSim) => RaceInput | null {
  const cfg = PROFILES[profile];
  const rng = new Rng(seed >>> 0);
  let falseStart = rng.next() < cfg.falseStartChance;
  const falseStartT = -0.05 - rng.next() * 0.15;
  let reaction = cfg.reaction[0] + rng.next() * (cfg.reaction[1] - cfg.reaction[0]);
  const nitroGear = rng.int(cfg.nitroGear[0], cfg.nitroGear[1]);
  const hairRoll = rng.next();
  const hairExtra = cfg.hairReaction[0] + rng.next() * (cfg.hairReaction[1] - cfg.hairReaction[0]);
  const decoyRoll = rng.next();
  const decoyReact = 0.12 + rng.next() * 0.08;
  let init = false;
  let biteT: number | null = null;
  let pressedLaunch = false;
  let nitroDone = false;
  let plannedGear = 0;
  let aim = 0.94;
  let aware = false;
  let dawdle = 0;
  let limiterSince: number | null = null;
  let blackoutHit = false;
  let lastRpm = 0;
  let rate = 0;

  return (sim: RaceSim) => {
    const s = sim.state;
    const hz = sim.hz;
    if (s.phase === 'finished') return null;
    if (!init) {
      init = true;
      if (hz.mods.has('hair_trigger')) {
        reaction += hairExtra;
        if (hairRoll < cfg.hairFalseStart) falseStart = true;
      }
      if (hz.decoyT !== null && decoyRoll < cfg.decoyBite) biteT = hz.decoyT + decoyReact;
    }
    if (!s.launched) {
      if (pressedLaunch) return null;
      if (biteT !== null && s.t >= biteT && s.t < 0) {
        pressedLaunch = true;
        return 'go';
      }
      if (falseStart && s.t >= falseStartT && s.t < 0) {
        pressedLaunch = true;
        return 'go';
      }
      if (!falseStart && s.t >= reaction) {
        pressedLaunch = true;
        return 'go';
      }
      return null;
    }

    // rpm climb rate (per second), smoothed
    const r = s.rpm;
    const inst = (r - lastRpm) / SIM_DT;
    lastRpm = r;
    if (inst > 0 && inst < 3) rate = rate ? rate * 0.8 + inst * 0.2 : inst;

    if (!nitroDone && s.nitroAvailable && s.gear >= nitroGear && !s.wheelspin && !sim.rearOnOil()) {
      nitroDone = true;
      return 'nitro';
    }

    if (s.gear >= 4) return null;
    const w = s.shiftWindow;
    if (plannedGear !== s.gear) {
      plannedGear = s.gear;
      // Gust-squeezed windows: aim from the calm window (what the player learned).
      const calm = sim.windowFor(s.gear);
      const center = (calm.perfectLo + calm.perfectHi) / 2;
      const half = (calm.perfectHi - calm.perfectLo) / 2;
      let sig = cfg.shiftSigma;
      if (hz.centers[s.gear - 1] !== null) sig *= cfg.sigDrift;
      if (hz.mirror) sig *= cfg.sigMirror;
      if (hz.hideWindow) sig *= cfg.sigBlind;
      const bias = hz.suddenDeath ? 0 : cfg.shiftBias;
      aim = center + half * (bias + gauss(rng) * sig);
      aim = Math.max(0.6, aim);
      dawdle = rng.next() < cfg.lateLimiterChance * (hz.suddenDeath ? 0.4 : 1) ? 0.15 + rng.next() * 0.25 : 0;
      limiterSince = null;
      aware = rng.next() < cfg.aware;
      blackoutHit = false;
    }
    // Tach blacks out: the bot loses the needle and re-guesses once.
    if (!blackoutHit && hz.blackouts.length && inSpan(hz.blackouts, s.t)) {
      blackoutHit = true;
      const half = (w.perfectHi - w.perfectLo) / 2;
      aim += half * gauss(rng) * cfg.shiftSigma * (cfg.sigBlackout - 1);
      aim = Math.max(0.6, aim);
    }
    if (s.limiter) {
      if (limiterSince === null) limiterSince = s.t;
      if (s.t - limiterSince >= dawdle && !(aware && sim.rearOnOil())) return 'go';
      return null;
    }

    // ---- hazard play: shift early (or hold) so the shift lands off the oil / outside a gust ----
    if (aware && (hz.oil.length || hz.gusts.length) && rate > 0 && s.v > 1) {
      const rear = s.x - REAR_M;
      const tAim = Math.max(0, (aim - r) / rate);
      const xAt = (dt: number) => rear + s.v * dt;
      const hazardAt = (dt: number) =>
        inSpan(hz.oil, xAt(dt)) || (hz.gusts.length > 0 && gustAt(hz, s.t + dt) > 0.3);
      const calm = sim.windowFor(s.gear);
      const winAt = (dt: number) => {
        if (inSpan(hz.oil, xAt(dt))) return null; // a shift on oil is a Miss
        const g = hz.gusts.length ? gustAt(hz, s.t + dt) : 0;
        return g > 0 ? squeeze(calm, 1 - (1 - hz.gustWin) * g) : calm;
      };
      if (sim.rearOnOil()) {
        // on oil now: hold until off, unless the patch outlasts the window
        return null;
      }
      if (hazardAt(tAim) && r < aim) {
        // first clear moment after the hazard
        let laterAim = 0.999;
        let laterScore = 0;
        for (let dt = tAim; dt < tAim + 1; dt += 0.02) {
          const wl = winAt(dt);
          if (!wl || hazardAt(dt)) continue;
          laterAim = Math.min(0.999, r + rate * dt);
          laterScore = laterAim >= 0.999 ? 0 : GRADE_SCORE[gradeAt(laterAim, wl)];
          break;
        }
        if (laterScore === 2) aim = laterAim;
        else if (hazardAt(0.04)) {
          // last moment before it hits: take the early shift if it's at least as good
          const nowW = winAt(0);
          const nowScore = nowW ? GRADE_SCORE[gradeAt(r, nowW)] : -1;
          if (nowScore >= 1 && nowScore >= laterScore) return 'go';
          aim = laterAim;
        }
      }
    }
    if (r >= aim && aim < 0.999) {
      if (aware && sim.rearOnOil()) return null;
      return 'go';
    }
    return null;
  };
}
