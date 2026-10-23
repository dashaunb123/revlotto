// Per-id behaviors for passives, consumables, boss modifiers and part quirks.
// Pure logic, no Phaser. Used by src/game/stats.ts (pipeline) and the sim (via RaceHooks).
import { SLOTS } from '../core/types';
import type { CarStats, Edition, PassiveInfo, RaceContext, RaceHooks, RaceSetup, RunHooks, RunState, SlotId, StatKey } from '../core/types';
import { CONTENT } from '../data/content';
import { Rng, hashSeed } from '../core/rng';
import { brandCounts } from './brands';

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
  stats?(s: CarStats, build: BuildInfo, p?: PassiveInfo): void;
  /** Changes to race setup knobs (windows etc.). */
  setup?(m: SetupMods, p?: PassiveInfo): void;
  /** Event-triggered behavior inside the sim. Called once per race setup, so closure state is per race. */
  hooks?(p?: PassiveInfo): RaceHooks;
  /** Run-level hooks (between races), called by game.ts. */
  run?: RunHooks;
}

const pct = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;

// ---------- Helpers for the passive table ----------

const EMPTY_RUN = { passives: [], passiveState: {}, race: 0, round: 1, seed: '', cash: 0, heat: 0, garage: [], tags: [] } as unknown as RunState;

/** Fallback PassiveInfo so effects never crash if the pipeline omits the trailing argument. */
function info(p: PassiveInfo | undefined, id = ''): PassiveInfo {
  return p ?? { id, index: 0, edition: null, counter: () => 0, run: EMPTY_RUN };
}

/** Build a PassiveInfo for another slot (used by the copy passives). */
export function passiveInfoAt(run: Readonly<RunState>, index: number): PassiveInfo | null {
  const id = run.passives?.[index];
  if (!id) return null;
  const st = run.passiveState ?? {};
  return {
    id,
    index,
    edition: run.passiveEditions?.[index] ?? null,
    counter: (key?: string) => st[key ? `${id}:${key}` : id] ?? 0,
    run,
  };
}

export const isBossRace = (run: Readonly<RunState>) => (run.race ?? 0) === 3;

function partTier(run: Readonly<RunState>, slot: SlotId): string {
  const ip = run.parts?.[slot];
  if (!ip) return 'stock';
  return CONTENT.parts.find((x) => x.id === ip.partId)?.tier ?? 'stock';
}
const hasPart = (run: Readonly<RunState>, slot: SlotId) => partTier(run, slot) !== 'stock';

/** Deterministic per-race roll in [0,1) for a passive: same value at staging preview and in the race. */
export function raceRoll(run: Readonly<RunState>, id: string, salt = 0): number {
  return new Rng(hashSeed(`${run.seed}|${run.round}|${run.race}|${id}|${salt}`)).next();
}

/** Scaling passive counters (the passive's own key). */
const ownCount = (p: PassiveInfo) => p.counter();

const WILD_CARD = ['POWER x1.15', 'GRIP x1.12', 'WEIGHT x0.92', 'SHIFT WIN x1.30'];
const wildCardPick = (p: PassiveInfo) => Math.floor(raceRoll(p.run, p.id) * WILD_CARD.length);
const coinFlipWins = (p: PassiveInfo) => raceRoll(p.run, p.id) < 0.5;

function forceLoss(ctx: RaceContext, note: string) {
  if ('forceLoss' in ctx) ctx.forceLoss = true;
  else ctx.powerMult *= 0.25; // fallback if the sim doesn't honor forceLoss: the engine is cooked
  ctx.notes.push(note);
}

/** Resolve a copy passive's target: follows copy chains, refuses loops. */
function copyTarget(p: PassiveInfo, depth = 0): { eff: PassiveEffect; info: PassiveInfo } | null {
  if (depth > 6) return null;
  const run = p.run;
  const ti = p.id === 'mirror' ? p.index + 1 : p.id === 'tow_hook' ? 0 : -1;
  if (ti < 0 || ti === p.index) return null;
  const t = passiveInfoAt(run, ti);
  if (!t) return null;
  if (t.id === 'mirror' || t.id === 'tow_hook') return copyTarget(t, depth + 1);
  const eff = PASSIVE_EFFECTS[t.id];
  return eff ? { eff, info: t } : null;
}

const copyEffect: PassiveEffect = {
  stats: (s, b, p) => {
    const t = p && copyTarget(p);
    t?.eff.stats?.(s, b, t.info);
  },
  setup: (m, p) => {
    const t = p && copyTarget(p);
    t?.eff.setup?.(m, t.info);
  },
  hooks: (p) => {
    const t = p && copyTarget(p);
    return t?.eff.hooks?.(t.info) ?? {};
  },
};

export const PASSIVE_EFFECTS: Record<string, PassiveEffect> = {
  // ---------- Originals ----------
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

  // ---------- Perfect-shift streak ----------
  hot_streak: {
    hooks: () => {
      let streak = 0;
      return {
        onStart() {
          streak = 0;
        },
        onShift(grade, _from, ctx) {
          if (grade !== 'perfect') {
            if (streak > 0) ctx.notes.push('STREAK BROKEN');
            streak = 0;
            return;
          }
          streak++;
          ctx.powerMult *= 1 + 0.04 * streak;
          ctx.notes.push(`HOT STREAK +${4 * streak}%`);
        },
      };
    },
  },
  perfectionist: {
    hooks: () => {
      let broken = false;
      return {
        onStart(ctx) {
          broken = false;
          ctx.powerMult *= 1.3;
        },
        onShift(grade, _from, ctx) {
          if (broken || grade === 'perfect') return;
          broken = true;
          ctx.powerMult *= 0.9 / 1.3;
          ctx.notes.push('PERFECTIONIST CRACKED x0.90');
        },
      };
    },
  },
  rev_matcher: {
    hooks: () => ({
      onShift(grade, _from, ctx) {
        if (grade === 'perfect') {
          ctx.gearPowerMult *= 1.12;
          ctx.notes.push('REV MATCH x1.12');
        }
      },
    }),
  },
  tightrope: {
    setup: (m) => {
      m.extraShiftWindowMult *= 0.75;
    },
    hooks: () => ({
      onShift(grade, _from, ctx) {
        if (grade === 'perfect') {
          ctx.powerMult *= 1.07;
          ctx.notes.push('TIGHTROPE +7%');
        }
      },
    }),
  },
  second_wind: {
    hooks: () => ({
      onShift(grade, _from, ctx) {
        if (grade === 'miss') {
          ctx.gearPowerMult *= 1.3;
          ctx.notes.push('SECOND WIND x1.30');
        }
      },
    }),
  },
  shift_light: {
    stats: (s) => {
      s.shiftWindow *= 1.15;
    },
  },
  perfect_record: {
    stats: (s, _b, p) => {
      s.power *= 1 + 0.01 * ownCount(info(p));
    },
    run: {
      onRaceWon(r, run) {
        if (r.perfectCount > 0) run.bump(undefined, r.perfectCount);
      },
    },
  },
  all_or_nothing: {
    stats: (s) => {
      s.power *= 1.4;
    },
    hooks: () => ({
      onShift(grade, _from, ctx) {
        if (grade === 'miss') forceLoss(ctx, 'ALL OR NOTHING: BUSTED');
      },
    }),
  },

  // ---------- Launch ----------
  quick_draw: {
    setup: (m) => {
      m.launchWindowMult *= 1.3;
    },
    hooks: () => ({
      onStart(ctx) {
        ctx.firstGearGripMult *= 1.08;
      },
    }),
  },
  holeshot: {
    hooks: () => ({
      onLaunch(grade, ctx) {
        if (grade !== 'perfect') return;
        ctx.firstGearGripMult *= 1.2;
        ctx.cashEarned += 2;
        ctx.notes.push('HOLESHOT +$2');
      },
    }),
  },
  burnout_box: {
    setup: (m) => {
      m.gripEarlyMult *= 1.12;
      m.gripEarlySeconds = Math.max(m.gripEarlySeconds, 2);
    },
  },
  torque_monster: {
    hooks: () => ({
      onStart(ctx) {
        ctx.gearPowerMult *= 1.1; // gearPowerMult resets each shift: reapplied for 2nd gear below
        ctx.gripMult *= 1.1;
      },
      onShift(_grade, from, ctx) {
        if (from === 1) ctx.gearPowerMult *= 1.1;
        if (from === 2) ctx.gripMult /= 1.1;
      },
    }),
  },
  slingshot: {
    hooks: () => {
      let armed = false;
      return {
        onStart() {
          armed = false;
        },
        onLaunch(grade, ctx) {
          if (grade !== 'perfect') return;
          armed = true;
          ctx.gearPowerMult *= 1.15;
          ctx.gripMult *= 1.15;
          ctx.notes.push('SLINGSHOT x1.15');
        },
        onShift(_grade, from, ctx) {
          if (!armed) return;
          if (from === 1) ctx.gearPowerMult *= 1.15;
          if (from === 2) {
            ctx.gripMult /= 1.15;
            armed = false;
          }
        },
      };
    },
  },

  // ---------- Nitro ----------
  hot_mix: {
    stats: (s) => {
      if (s.nitroPower <= 0) return;
      s.nitroPower *= 1.5;
      s.nitroDuration += 0.5;
    },
  },
  wet_shot: {
    stats: (s) => {
      s.nitroPower *= 2;
      s.nitroDuration *= 0.75;
    },
  },
  spooled_up: {
    stats: (s, _b, p) => {
      const run = info(p).run;
      if (hasPart(run, 'forced_induction') && hasPart(run, 'nitrous')) s.power += 40;
    },
  },
  natural_aspiration: {
    stats: (s, _b, p) => {
      const run = info(p).run;
      if (!hasPart(run, 'forced_induction') && !hasPart(run, 'nitrous')) s.power *= 1.2;
    },
  },
  late_spray: {
    hooks: () => ({
      onNitro(_grade, gear, ctx) {
        if (gear >= 3) {
          ctx.powerMult *= 1.1;
          ctx.notes.push('LATE SPRAY +10%');
        }
      },
    }),
  },
  blow_off_valve: {
    hooks: (p) => {
      const on = hasPart(info(p).run, 'forced_induction');
      return {
        onShift(grade, _from, ctx) {
          if (on && grade === 'perfect') {
            ctx.powerMult *= 1.04;
            ctx.notes.push('PSSHH +4%');
          }
        },
      };
    },
  },

  // ---------- Economy ----------
  nest_egg: {
    run: {
      onShopEnter(run) {
        const n = Math.min(3, Math.floor(run.cash / 10));
        if (n > 0) {
          run.addCash(n);
          run.notes.push(`NEST EGG +$${n}`);
        }
      },
    },
  },
  piggy_bank: {
    run: {
      onShopEnter(run) {
        run.bump('sell', 2);
        run.notes.push('PIGGY BANK +$2 VALUE');
      },
    },
  },
  sponsor_decal: {
    hooks: () => ({
      onFinish(r, ctx) {
        if (r.won) {
          ctx.cashEarned += 2;
          ctx.notes.push('SPONSOR +$2');
        }
      },
    }),
  },
  bargain_hunter: {}, // rerollDiscount()
  day_off: {
    run: {
      onRaceSkipped(run) {
        run.addCash(4);
        run.notes.push('DAY OFF +$4');
      },
    },
  },
  scrap_dealer: {
    run: {
      onSell(_kind, run) {
        if (run.sellingSelf) return;
        run.addCash(2);
        run.notes.push('SCRAP DEALER +$2');
      },
    },
  },
  prize_fighter: {
    hooks: (p) => {
      const boss = isBossRace(info(p).run);
      return {
        onFinish(r, ctx) {
          if (r.won && boss) {
            ctx.cashEarned += 6;
            ctx.notes.push('PRIZE FIGHTER +$6');
          }
        },
      };
    },
  },
  golden_wrench: {
    hooks: (p) => {
      const run = info(p).run;
      const n = Math.floor(SLOTS.filter((slot) => hasPart(run, slot)).length / 2);
      return {
        onFinish(r, ctx) {
          if (r.won && n > 0) {
            ctx.cashEarned += n;
            ctx.notes.push(`GOLDEN WRENCH +$${n}`);
          }
        },
      };
    },
  },

  // ---------- Scaling over the run ----------
  momentum: {
    stats: (s, _b, p) => {
      s.power *= 1 + 0.02 * ownCount(info(p));
    },
    run: {
      onRaceWon(_r, run) {
        run.bump(undefined, 1);
      },
    },
  },
  trophy_case: {
    stats: (s, _b, p) => {
      s.power *= Math.pow(1.1, ownCount(info(p)));
    },
    run: {
      onRaceWon(_r, run) {
        if (run.isBoss) {
          run.bump(undefined, 1);
          run.notes.push('TROPHY CASE x1.10');
        }
      },
    },
  },
  patience: {
    stats: (s, _b, p) => {
      s.power += 12 * ownCount(info(p));
    },
    run: {
      onRaceSkipped(run) {
        run.bump(undefined, 1);
        run.notes.push('PATIENCE +12');
      },
    },
  },
  recycler: {
    stats: (s, _b, p) => {
      s.power += 6 * ownCount(info(p));
    },
    run: {
      onSell(kind, run) {
        if (kind === 'part') run.bump(undefined, 1);
      },
    },
  },
  old_money: {
    stats: (s, _b, p) => {
      s.power += Math.max(0, Math.min(40, Math.floor(info(p).run.cash ?? 0)));
    },
  },
  broken_in: {
    stats: (s, _b, p) => {
      s.shiftWindow *= 1 + 0.03 * Math.min(10, ownCount(info(p)));
    },
    run: {
      onRaceWon(_r, run) {
        run.bump(undefined, 1);
      },
      onRaceLost(_r, run) {
        run.bump(undefined, 1);
      },
    },
  },

  // ---------- Position ----------
  mirror: copyEffect,
  tow_hook: copyEffect,
  pole_position: {
    stats: (s, _b, p) => {
      if (info(p).index === 0) s.power *= 1.12;
    },
  },
  convoy: {
    stats: (s, _b, p) => {
      s.power *= 1 + 0.03 * info(p).index;
    },
  },

  // ---------- Weird / risky ----------
  coin_flip: {
    stats: (s, _b, p) => {
      s.power *= p && coinFlipWins(p) ? 1.35 : 0.85;
    },
  },
  wild_card: {
    stats: (s, _b, p) => {
      if (!p) return;
      const k = wildCardPick(p);
      if (k === 0) s.power *= 1.15;
      else if (k === 1) s.grip *= 1.12;
      else if (k === 2) s.weight *= 0.92;
      else s.shiftWindow *= 1.3;
    },
  },
  overclock: {
    stats: (s) => {
      s.power *= 1.25;
      s.grip *= 0.85;
    },
  },
  sandbagger: {
    stats: (s, _b, p) => {
      s.power *= isBossRace(info(p).run) ? 1.35 : 0.9;
    },
  },

  // ---------- New systems ----------
  boss_hunter: {
    stats: (s, _b, p) => {
      if (isBossRace(info(p).run)) s.power *= 1.15;
    },
  },
  home_garage: {
    stats: (s, _b, p) => {
      s.power *= 1 + 0.05 * (info(p).run.garage?.length ?? 0);
    },
  },
  heat_seeker: {
    stats: (s, _b, p) => {
      s.power *= 1.05 + 0.05 * (info(p).run.heat ?? 0);
    },
  },
  ballast: {
    stats: (s) => {
      s.grip += 0.04 * Math.max(0, (s.weight - 1400) / 100);
    },
  },
  tag_along: {
    stats: (s, _b, p) => {
      s.power *= 1 + 0.05 * (info(p).run.tags?.length ?? 0);
    },
  },

  // ---------- Brands ----------
  brand_loyalist: {
    stats: (s, _b, p) => {
      s.power *= 1 + 0.03 * Math.min(6, brandMix(info(p).run).top); // capped: uncapped it stacked to +36% on a paragon
    },
  },
  mixed_bag: {
    stats: (s, _b, p) => {
      const m = brandMix(info(p).run);
      if (m.top <= 2) s.power *= 1 + 0.04 * m.distinct;
    },
  },
};

/** Brand spread of the installed parts: biggest single-brand count and how many brands are present. */
export function brandMix(run: Readonly<RunState>): { top: number; topBrand: string | null; distinct: number } {
  const counts = brandCounts(run.parts ?? ({} as RunState['parts']));
  let top = 0;
  let topBrand: string | null = null;
  for (const [b, n] of Object.entries(counts)) {
    if (n > top || (n === top && topBrand !== null && b < topBrand)) {
      top = n;
      topBrand = b;
    }
  }
  return { top, topBrand, distinct: Object.keys(counts).length };
}

// ---------- Paragon signature abilities ----------

/** RaceContext fields the sim may or may not honour yet (see REQUESTs in devlog p_abilities). */
type ParagonCtx = RaceContext & {
  /** Multiplier on the shift time of the shift that just happened (0 = instant). Read right after onShift hooks. */
  shiftTimeMult?: number;
};

export interface ParagonAbility {
  id: string;
  name: string; // shown in popups / tooltips
  desc: string; // one punchy sentence
  /** Small stat tweaks on top of the paragon multipliers (applied once at setup). */
  stats?(s: CarStats): void;
  setup?(m: SetupMods): void;
  /** Fresh hooks per race (closure state is per race). */
  hooks(): RaceHooks;
}

export const PARAGON_ABILITIES: Record<string, ParagonAbility> = {
  // Malibru SS (street): nobody sees it coming.
  sleeper: {
    id: 'sleeper',
    name: 'Sleeper',
    desc: 'Every Perfect shift wakes the sleeper: +8% Power (stacking) and +$1; three in a row adds a +$4 wake-up call.',
    hooks: () => {
      let perfects = 0;
      return {
        onStart() {
          perfects = 0;
        },
        onShift(grade, _from, ctx) {
          if (grade !== 'perfect') return;
          perfects++;
          ctx.powerMult *= 1.08;
          ctx.cashEarned += 1;
          ctx.notes.push(perfects >= 3 ? 'SLEEPER: WIDE AWAKE! +8% +$1' : `SLEEPER STIRS +8% +$1`);
        },
        onFinish(r, ctx) {
          if (r.won && perfects >= 3) {
            ctx.cashEarned += 4;
            ctx.notes.push('WAKE-UP CALL +$4');
          }
        },
      };
    },
  },
  // Civique Type-Arr (street): rev-happy, forgiving, screams at the top.
  vtec: {
    id: 'vtec',
    name: 'VTEC',
    desc: 'Shift windows 25% wider, and every Perfect shift kicks in VTEC for +18% Power through the next gear (Good: +8%).',
    setup: (m) => {
      m.extraShiftWindowMult *= 1.25;
    },
    hooks: () => ({
      onShift(grade, _from, ctx) {
        if (grade === 'perfect') {
          ctx.gearPowerMult *= 1.18;
          ctx.notes.push('VTEC KICKED IN YO! x1.18');
        } else if (grade === 'good') {
          ctx.gearPowerMult *= 1.08;
          ctx.notes.push('VTEC x1.08');
        }
      },
    }),
  },
  // Stallion Shelbee (street): cheap V8 grunt off the line.
  pony_launch: {
    id: 'pony_launch',
    name: 'Pony Launch',
    desc: 'A Perfect launch shoves +30% Power and +25% Grip through 1st AND 2nd gear (Good launch: +12%).',
    hooks: () => {
      let shove = 1;
      return {
        onStart() {
          shove = 1;
        },
        onLaunch(grade, ctx) {
          shove = grade === 'perfect' ? 1.3 : grade === 'good' ? 1.12 : 1;
          if (shove === 1) return;
          ctx.gearPowerMult *= shove;
          if (grade === 'perfect') ctx.firstGearGripMult *= 1.25;
          ctx.notes.push(grade === 'perfect' ? 'PONY LAUNCH! x1.30' : 'PONY LAUNCH x1.12');
        },
        onShift(_grade, from, ctx) {
          if (from !== 1 || shove === 1) return;
          ctx.gearPowerMult *= shove;
          ctx.notes.push('GIDDY-UP! 2ND GEAR SHOVE');
        },
      };
    },
  },
  // Avenger Scatpak (sport): torque that keeps piling on.
  scat: {
    id: 'scat',
    name: 'Scat Pack',
    desc: 'Every Perfect launch and Perfect shift stacks +7% Power for the rest of the race.',
    hooks: () => {
      let stacks = 0;
      const scat = (ctx: RaceContext) => {
        stacks++;
        ctx.powerMult *= 1.07;
        ctx.notes.push(stacks >= 4 ? 'SCAT PACK MAXED! x4' : `SCAT PACK x${stacks} +7%`);
      };
      return {
        onStart() {
          stacks = 0;
        },
        onLaunch(grade, ctx) {
          if (grade === 'perfect') scat(ctx);
        },
        onShift(grade, _from, ctx) {
          if (grade === 'perfect') scat(ctx);
        },
      };
    },
  },
  // Kaiju 2JZ (sport): the turbo wakes up late and never stops building.
  boost_spike: {
    id: 'boost_spike',
    name: 'Boost Spike',
    desc: 'The turbo spools harder every gear: +6% Power per clean upshift, +13% on a Perfect one, for the rest of the race.',
    hooks: () => {
      let psi = 8;
      return {
        onStart() {
          psi = 8;
        },
        onShift(grade, _from, ctx) {
          if (grade === 'miss') {
            ctx.notes.push('BOOST LEAK!');
            return;
          }
          const perfect = grade === 'perfect';
          ctx.powerMult *= perfect ? 1.13 : 1.06;
          psi += perfect ? 9 : 4;
          ctx.notes.push(perfect ? `BOOST SPIKE ${psi} PSI! +13%` : `SPOOLING ${psi} PSI +6%`);
        },
      };
    },
  },
  // Viperion ACR (sport): a wing the size of a door.
  acr: {
    id: 'acr',
    name: 'ACR Aero',
    desc: 'Massive downforce: +35% launch Grip (no wheelspin), Drag x0.92, and every Perfect shift adds +4% Grip and +5% Power.',
    stats: (s) => {
      s.drag *= 0.92;
    },
    setup: (m) => {
      m.gripEarlyMult *= 1.15;
      m.gripEarlySeconds = Math.max(m.gripEarlySeconds, 2);
    },
    hooks: () => ({
      onStart(ctx) {
        ctx.firstGearGripMult *= 1.35;
        ctx.notes.push('ACR DOWNFORCE: GLUED');
      },
      onShift(grade, _from, ctx) {
        if (grade !== 'perfect') return;
        ctx.gripMult *= 1.04;
        ctx.powerMult *= 1.05;
        ctx.notes.push('ACR CLAMP +5%');
      },
    }),
  },
  // Hellkat Demon (pro): wheels up, then all hell breaks loose.
  demon: {
    id: 'demon',
    name: 'Demon',
    desc: 'A Perfect launch pops a wheelie (+40% Grip, +20% Power in 1st), then your next Perfect shift fires a free +40% DEMON BURST gear.',
    hooks: () => {
      let burst = 1.2; // armed by default at x1.2; a Perfect launch raises it to x1.4
      let fired = false;
      return {
        onStart() {
          burst = 1.2;
          fired = false;
        },
        onLaunch(grade, ctx) {
          if (grade !== 'perfect') return;
          burst = 1.4;
          ctx.firstGearGripMult *= 1.4;
          ctx.gearPowerMult *= 1.2;
          ctx.notes.push('DEMON WHEELIE!!');
        },
        onShift(grade, _from, ctx) {
          if (fired || grade !== 'perfect') return;
          fired = true;
          ctx.gearPowerMult *= burst;
          ctx.notes.push(burst >= 1.4 ? 'DEMON BURST x1.40!!' : 'DEMON BURST x1.20');
        },
      };
    },
  },
  // Lamberghoul Aventadoom (pro): shifts so fast they don't exist.
  doom_shift: {
    id: 'doom_shift',
    name: 'Doom Shift',
    desc: 'Shifts take half the time, Perfect shifts take NONE, and each one stacks +6% Grip and +6% Gearing.',
    setup: (m) => {
      if (!m.quirks.includes('fast_shift')) m.quirks.push('fast_shift');
    },
    hooks: () => {
      let stacks = 0;
      return {
        onStart() {
          stacks = 0;
        },
        onShift(grade, _from, ctx) {
          if (grade !== 'perfect') return;
          stacks++;
          (ctx as ParagonCtx).shiftTimeMult = 0;
          ctx.gripMult *= 1.06;
          ctx.gearingMult *= 1.06;
          ctx.notes.push(stacks >= 3 ? 'DOOM SHIFT x3: ZERO TIME!' : `DOOM SHIFT x${stacks}`);
        },
      };
    },
  },
};

/** Ability lookup by ParagonDef.ability id. */
export const paragonAbility = (id: string | null | undefined): ParagonAbility | undefined => (id ? PARAGON_ABILITIES[id] : undefined);

/**
 * Pipeline entry (stats.ts): apply a paragon ability's stat/setup tweaks and return its race hooks.
 * Call once per race setup while a paragon is active, after the paragon stat multipliers; push the result into RaceSetup.hooks.
 */
export function applyParagonAbility(abilityId: string | null | undefined, s: CarStats, mods: SetupMods): RaceHooks | null {
  const a = paragonAbility(abilityId);
  if (!a) return null;
  a.stats?.(s);
  a.setup?.(mods);
  return a.hooks();
}

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
      // 0.8 was the one boss skill couldn't beat (perfect bot 38% at round 3).
      s.grip *= 0.87;
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

// ---------- Editions ----------

export const EDITION_TEXT: Record<Edition, string> = {
  foil: 'FOIL: +15 Power',
  holo: 'HOLO: +0.05 Grip',
  chrome: 'CHROME: Power x1.10',
};

/** Apply an owned passive's edition. stats.ts calls this right after that passive's own stats() (not for disabled ones). */
export function applyEdition(s: CarStats, edition: Edition | null | undefined): void {
  if (edition === 'foil') s.power += 15;
  else if (edition === 'holo') s.grip += 0.05;
  else if (edition === 'chrome') s.power *= 1.1;
}

// ---------- Run-level economy knobs (read by economy.ts / shop) ----------

/** Extra sell value a passive has built up (Piggy Bank). */
export function passiveSellBonus(run: Readonly<RunState>, id: string): number {
  return Math.max(0, Math.floor(run.passiveState?.[`${id}:sell`] ?? 0));
}

/** $ off every reroll from owned passives. */
export function rerollDiscount(run: Readonly<RunState>): number {
  return (run.passives ?? []).filter((id) => id === 'bargain_hunter').length;
}

/** Short live readout for scaling / conditional passives, for tooltips. Null if nothing to show. */
export function passiveStatus(run: Readonly<RunState>, index: number): string | null {
  const p = passiveInfoAt(run, index);
  if (!p) return null;
  const n = ownCount(p);
  switch (p.id) {
    case 'perfect_record':
      return `NOW +${n}% POWER`;
    case 'momentum':
      return `NOW +${2 * n}% POWER`;
    case 'trophy_case':
      return `NOW x${Math.pow(1.1, n).toFixed(2)} POWER`;
    case 'patience':
      return `NOW +${12 * n} POWER`;
    case 'recycler':
      return `NOW +${6 * n} POWER`;
    case 'broken_in':
      return `NOW +${3 * Math.min(10, n)}% SHIFT WIN`;
    case 'old_money':
      return `NOW +${Math.max(0, Math.min(40, Math.floor(run.cash ?? 0)))} POWER`;
    case 'piggy_bank':
      return `STORED +$${passiveSellBonus(run, p.id)}`;
    case 'convoy':
      return `NOW +${3 * index}% POWER`;
    case 'pole_position':
      return index === 0 ? 'ACTIVE' : 'INACTIVE: MOVE IT LEFTMOST';
    case 'home_garage':
      return `NOW +${5 * (run.garage?.length ?? 0)}% POWER`;
    case 'heat_seeker':
      return `NOW +${5 + 5 * (run.heat ?? 0)}% POWER`;
    case 'tag_along':
      return `NOW +${5 * (run.tags?.length ?? 0)}% POWER`;
    case 'coin_flip':
      return coinFlipWins(p) ? 'THIS RACE: HEADS x1.35' : 'THIS RACE: TAILS x0.85';
    case 'wild_card':
      return `THIS RACE: ${WILD_CARD[wildCardPick(p)]}`;
    case 'spooled_up':
      return hasPart(run, 'forced_induction') && hasPart(run, 'nitrous') ? 'ACTIVE' : 'NEEDS TURBO + NOS PARTS';
    case 'natural_aspiration':
      return !hasPart(run, 'forced_induction') && !hasPart(run, 'nitrous') ? 'ACTIVE' : 'INACTIVE: REMOVE TURBO/NOS';
    case 'blow_off_valve':
      return hasPart(run, 'forced_induction') ? 'ACTIVE' : 'NEEDS A TURBO PART';
    case 'brand_loyalist': {
      const m = brandMix(run);
      return m.top ? `NOW +${3 * Math.min(6, m.top)}% POWER (${m.top} ${m.topBrand?.toUpperCase()}${m.top >= 6 ? ', MAXED' : ''})` : 'NO BRAND PARTS YET';
    }
    case 'mixed_bag': {
      const m = brandMix(run);
      return m.top <= 2 ? `NOW +${4 * m.distinct}% POWER (${m.distinct} BRANDS)` : `INACTIVE: ${m.top} ${m.topBrand?.toUpperCase()} PARTS (MAX 2)`;
    }
    case 'golden_wrench':
      return `NOW +$${Math.floor(SLOTS.filter((s) => hasPart(run, s)).length / 2)} PER WIN`;
    case 'mirror':
    case 'tow_hook': {
      const t = copyTarget(p);
      if (!t) return 'COPYING NOTHING';
      const def = CONTENT.passives.find((d) => d.id === t.info.id);
      return `COPYING ${(def?.name ?? t.info.id).toUpperCase()}`;
    }
    default:
      return null;
  }
}

// ---------- Pipeline entry points (called by stats.ts / game.ts) ----------

/**
 * Step 3 of the stat pipeline: owned passives left to right (each followed by its edition).
 * The rightmost `disabledCount` are skipped (Redline Only). onStep fires after each passive for the breakdown.
 */
export function applyPassives(
  run: Readonly<RunState>,
  s: CarStats,
  mods: SetupMods,
  build: BuildInfo,
  opts: { disabledCount?: number } = {},
  onStep?: (id: string, index: number, disabled: boolean) => void,
): RaceHooks[] {
  const hooks: RaceHooks[] = [];
  const n = run.passives?.length ?? 0;
  const disabledCount = opts.disabledCount ?? 0;
  for (let i = 0; i < n; i++) {
    const p = passiveInfoAt(run, i)!;
    const disabled = i >= n - disabledCount;
    if (!disabled) {
      const eff = PASSIVE_EFFECTS[p.id];
      eff?.stats?.(s, build, p);
      applyEdition(s, p.edition);
      eff?.setup?.(mods, p);
      const h = eff?.hooks?.(p);
      if (h) hooks.push(h);
    }
    onStep?.(p.id, i, disabled);
  }
  return hooks;
}

/** Run-level hooks of owned passives in order. game.ts builds one RunCtx per entry (namespaced counters). */
export function passiveRunHooks(run: Readonly<RunState>): { id: string; index: number; hooks: RunHooks }[] {
  const out: { id: string; index: number; hooks: RunHooks }[] = [];
  (run.passives ?? []).forEach((id, index) => {
    const h = PASSIVE_EFFECTS[id]?.run;
    if (h) out.push({ id, index, hooks: h });
  });
  return out;
}
