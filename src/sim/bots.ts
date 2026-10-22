// Scripted input policies for headless balance runs and the title-screen attract demo.
import { Rng } from '../core/rng';
import type { RaceInput } from '../core/types';
import type { RaceSim } from './RaceSim';

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
}

const PROFILES: Record<BotProfile, ProfileCfg> = {
  perfect: { reaction: [0.02, 0.05], falseStartChance: 0, shiftSigma: 0.15, shiftBias: 0, lateLimiterChance: 0, nitroGear: [2, 2] },
  average: { reaction: [0.07, 0.19], falseStartChance: 0.02, shiftSigma: 1.3, shiftBias: 0.3, lateLimiterChance: 0.05, nitroGear: [2, 3] },
  sloppy: { reaction: [0.16, 0.36], falseStartChance: 0.1, shiftSigma: 2.6, shiftBias: 0.8, lateLimiterChance: 0.2, nitroGear: [1, 4] },
};

function gauss(rng: Rng): number {
  const u = Math.max(1e-9, rng.next());
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Returns a policy called once per sim step (before step()) that returns the input to send, or null.
 */
export function makeBot(profile: BotProfile, seed: number): (sim: RaceSim) => RaceInput | null {
  const cfg = PROFILES[profile];
  const rng = new Rng(seed >>> 0);
  const falseStart = rng.next() < cfg.falseStartChance;
  const falseStartT = -0.05 - rng.next() * 0.15;
  const reaction = cfg.reaction[0] + rng.next() * (cfg.reaction[1] - cfg.reaction[0]);
  const nitroGear = rng.int(cfg.nitroGear[0], cfg.nitroGear[1]);
  let pressedLaunch = false;
  let nitroDone = false;
  let plannedGear = 0;
  let aim = 0.94;
  let dawdle = 0;
  let limiterSince: number | null = null;

  return (sim: RaceSim) => {
    const s = sim.state;
    if (s.phase === 'finished') return null;
    if (!s.launched) {
      if (pressedLaunch) return null;
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

    if (!nitroDone && s.nitroAvailable && s.gear >= nitroGear && !s.wheelspin) {
      nitroDone = true;
      return 'nitro';
    }

    if (s.gear >= 4) return null;
    if (plannedGear !== s.gear) {
      plannedGear = s.gear;
      const w = s.shiftWindow;
      const center = (w.perfectLo + w.perfectHi) / 2;
      const half = (w.perfectHi - w.perfectLo) / 2;
      aim = center + half * (cfg.shiftBias + gauss(rng) * cfg.shiftSigma);
      aim = Math.max(0.6, aim);
      dawdle = rng.next() < cfg.lateLimiterChance ? 0.15 + rng.next() * 0.25 : 0;
      limiterSince = null;
    }
    if (s.limiter) {
      if (limiterSince === null) limiterSince = s.t;
      if (s.t - limiterSince >= dawdle) return 'go';
      return null;
    }
    if (s.rpm >= aim && aim < 0.999) return 'go';
    return null;
  };
}
