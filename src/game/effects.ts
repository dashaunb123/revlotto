// Per-id behaviors for passives, consumables, boss modifiers and part quirks.
// Pure logic, no Phaser. Used by src/game/stats.ts (pipeline) and the sim (via RaceHooks).
import type { CarStats, RaceHooks, RaceSetup, SlotId, StatKey } from '../core/types';

/** Mutable race-setup knobs the pipeline steps may change (everything in RaceSetup except stats/hooks/target). */
export type SetupMods = Pick<RaceSetup, 'quirks' | 'launchWindowMult' | 'extraShiftWindowMult' | 'gripEarlyMult' | 'gripEarlySeconds'>;

/** Info about the installed build that some passives read. */
export interface BuildInfo {
  /** Effective stat contribution of each installed part (tuning included). */
  partStats: Record<SlotId, Partial<CarStats>>;
  nonStockCount: number;
}

export interface PassiveEffect {
  /** Static stat change, applied in passive order: flat adds first, then multiplies. */
  stats?(s: CarStats, build: BuildInfo): void;
  /** Changes to race setup knobs (windows etc.). */
  setup?(m: SetupMods): void;
  /** Event-triggered behavior inside the sim. */
  hooks?(): RaceHooks;
}

const pct = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;

export const PASSIVE_EFFECTS: Record<string, PassiveEffect> = {
  clean_launcher: {
    hooks: () => ({
      onLaunch(grade, ctx) {
        if (grade === 'perfect') {
          ctx.powerMult *= 1.1;
          ctx.notes.push('CLEAN LAUNCHER x1.10');
        }
      },
    }),
  },
  shift_savant: {
    hooks: () => ({
      onShift(grade, _from, ctx) {
        if (grade === 'perfect') {
          ctx.powerMult *= 1.03;
          ctx.notes.push('SHIFT SAVANT +3%');
        }
      },
    }),
  },
  double_clutch: {
    hooks: () => ({
      onShift(grade, _from, ctx) {
        if (grade === 'perfect') {
          ctx.gearingMult *= 1.05;
          ctx.notes.push('DOUBLE CLUTCH x1.05');
        }
      },
    }),
  },
  redline_gambler: {
    setup: (m) => {
      m.extraShiftWindowMult *= 0.6;
    },
    hooks: () => ({
      onShift(grade, _from, ctx) {
        if (grade === 'perfect') {
          ctx.gearPowerMult *= 1.25;
          ctx.notes.push('GAMBLER x1.25');
        }
      },
    }),
  },
  sticky_compound: {
    hooks: () => ({
      onStart(ctx) {
        ctx.firstGearGripMult *= 1.15;
      },
    }),
  },
  featherweight: {
    stats: (s) => {
      s.weight *= 0.95;
    },
  },
  boost_brain: {
    stats: (s, b) => {
      // Flat: forced induction + nitrous parts count 50% stronger (their positive contributions).
      for (const slot of ['forced_induction', 'nitrous'] as SlotId[]) {
        const ps = b.partStats[slot] ?? {};
        for (const k of ['power', 'nitroPower', 'nitroDuration'] as StatKey[]) {
          const v = ps[k] ?? 0;
          if (v > 0) s[k] += v * 0.5;
        }
      }
    },
  },
  garage_rat: {
    stats: (s, b) => {
      s.power *= 1 + 0.02 * b.nonStockCount;
    },
  },
  cash_cow: {
    hooks: () => ({
      onFinish(_r, ctx) {
        const cash = 2 * ctx.perfectCount;
        if (cash > 0) {
          ctx.cashEarned += cash;
          ctx.notes.push(`CASH COW +$${cash}`);
        }
      },
    }),
  },
  finish_line_flair: {
    hooks: () => ({
      onFinish(r, ctx) {
        if (r.won && r.targetEt - r.et < 0.1) {
          ctx.cashEarned += 5;
          ctx.notes.push('PHOTO FINISH +$5');
        }
      },
    }),
  },
};

export interface ConsumableEffect {
  stats?(s: CarStats): void;
  setup?(m: SetupMods): void;
}

export const CONSUMABLE_EFFECTS: Record<string, ConsumableEffect> = {
  nitro_bottle: {
    stats: (s) => {
      s.power *= 1.15;
    },
  },
  grip_spray: {
    setup: (m) => {
      m.gripEarlyMult *= 1.2;
      m.gripEarlySeconds = Math.max(m.gripEarlySeconds, 3);
    },
  },
  wide_tach: {
    setup: (m) => {
      m.extraShiftWindowMult *= 1.3;
    },
  },
  mulligan: {}, // handled by the run (rerun on loss)
};

export interface BossEffect {
  stats?(s: CarStats): void;
  setup?(m: SetupMods): void;
  /** Number of rightmost passives disabled. */
  disableRightmostPassives?: number;
}

export const BOSS_EFFECTS: Record<string, BossEffect> = {
  tight_tree: {
    setup: (m) => {
      m.launchWindowMult *= 0.5;
    },
  },
  slick_track: {
    stats: (s) => {
      s.grip *= 0.8;
    },
  },
  headwind: {
    stats: (s) => {
      s.drag *= 1.25;
    },
  },
  redline_only: {
    setup: (m) => {
      m.extraShiftWindowMult *= 0.5;
    },
    disableRightmostPassives: 1,
  },
};

/** Part quirks are read directly by the sim from RaceSetup.quirks. Text for UI tooltips. */
export const QUIRK_TEXT: Record<string, string> = {
  launch_lag: 'Turbo lag: power ramps up over the first 1.2 s after launch.',
  fast_shift: 'Fast shift: gear changes take half the time.',
  two_step: 'Two-step: launch timing windows 50% wider.',
};

/** Which stat deltas count as "beneficial" for tuning (tuning amplifies only the upside of a part). */
export function isBeneficial(k: StatKey, v: number): boolean {
  if (k === 'weight' || k === 'drag') return v < 0;
  return v > 0;
}

/** Short human-readable summary of a stat delta object, e.g. "+70 PWR, +25 KG". */
export function describeStats(d: Partial<CarStats>): string {
  const parts: string[] = [];
  const f: Record<StatKey, (v: number) => string> = {
    power: (v) => `${v > 0 ? '+' : ''}${Math.round(v)} PWR`,
    grip: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} GRIP`,
    weight: (v) => `${v > 0 ? '+' : ''}${Math.round(v)} KG`,
    gearing: (v) => `${pct(v)} GEAR`,
    drag: (v) => `${pct(v)} DRAG`,
    shiftWindow: (v) => `${pct(v)} SHIFT WIN`,
    nitroPower: (v) => `+${Math.round(v)} NOS`,
    nitroDuration: (v) => `${v.toFixed(1)}s NOS`,
  };
  for (const k of Object.keys(f) as StatKey[]) {
    const v = d[k];
    if (v !== undefined && v !== 0) parts.push(f[k](v));
  }
  return parts.join(', ');
}
