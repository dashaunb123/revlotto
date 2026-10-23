// RunState construction, per-run seeded draws (bosses, boss params, skip tags), opponents, and save validation.
import { SLOTS } from '../core/types';
import type {
  BossModifierDef,
  BossParamRange,
  Edition,
  InstalledPart,
  OpponentDef,
  RaceSetup,
  RunState,
  SlotId,
  TagDef,
} from '../core/types';
import { hashSeed, randomSeedString, Rng } from '../core/rng';
import { CONTENT, bossById, opponentFor, stockPart } from '../data/content';
import { makeShop } from './shop';

export const ROUNDS = 4;
export const RACES_PER_ROUND = 4; // race index 3 = boss
export const DEFAULT_CAR = 'daily_driver';
export const MAX_HEAT = 8;

export function normalizeSeed(seed: string | undefined): string {
  const s = (seed ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length ? s.slice(0, 12) : randomSeedString(6);
}

export function stockParts(): Record<SlotId, InstalledPart> {
  const parts = {} as Record<SlotId, InstalledPart>;
  for (const slot of SLOTS) parts[slot] = { partId: stockPart(slot).id, level: 0 };
  return parts;
}

/** Defaults for the run fields added by the content expansion (for scripts that build a RunState by hand). */
export function runDefaults(): Pick<
  RunState,
  'car' | 'heat' | 'endless' | 'bosses' | 'tags' | 'garage' | 'passiveEditions' | 'passiveState' | 'passiveSlots' | 'consumableSlots'
> {
  return {
    car: DEFAULT_CAR, heat: 0, endless: false, bosses: [], tags: [], garage: [], passiveEditions: [], passiveState: {},
    passiveSlots: CONTENT.balance.limits.passiveSlots, consumableSlots: CONTENT.balance.limits.consumableSlots,
  };
}

/**
 * An Rng derived from the seed and a label, independent of the run's main RNG stream. Used for draws that
 * must not depend on shop decisions (bosses, boss params, skip tags), so every player on a seed sees the same.
 */
export function seedRng(seed: string, ...label: (string | number)[]): Rng {
  return new Rng(hashSeed(`${seed}#${label.join(':')}`));
}

/** Effective slot counts from the starting car and garage upgrades. */
export function refreshSlots(s: RunState): void {
  const L = CONTENT.balance.limits;
  const g = (id: string) => (s.garage.includes(id) ? 1 : 0);
  s.passiveSlots = L.passiveSlots + (s.car === 'tow_rig' ? 1 : 0) + g('toolbox') + g('mega_toolbox');
  s.consumableSlots = L.consumableSlots + g('pit_crew') + g('pit_crew_pro');
}

// ---------- Bosses ----------

/** 3 distinct regular bosses (rounds 1-3) + 1 final (round 4), seeded. */
export function drawBosses(seed: string): string[] {
  const rng = seedRng(seed, 'bosses');
  const regular = rng.shuffle(CONTENT.bosses.filter((b) => b.tier === 'regular').map((b) => b.id));
  const final = CONTENT.bosses.filter((b) => b.tier === 'final').map((b) => b.id);
  return [...regular.slice(0, ROUNDS - 1), rng.pick(final)];
}

/** Endless: make sure bosses[round-1] exists, drawing from the whole pool (no repeats until it runs out). */
export function ensureBoss(s: RunState, round: number): void {
  while (s.bosses.length < round) {
    const r = s.bosses.length + 1;
    const rng = seedRng(s.seed, 'endless_boss', r);
    const all = CONTENT.bosses.map((b) => b.id);
    const used = new Set(s.bosses);
    let pool = all.filter((id) => !used.has(id));
    if (!pool.length) {
      // Pool exhausted: anything but the last few.
      const recent = new Set(s.bosses.slice(-Math.min(3, all.length - 1)));
      pool = all.filter((id) => !recent.has(id));
    }
    s.bosses.push(rng.pick(pool));
  }
}

function rollRange(name: string, r: BossParamRange | number, rng: Rng, out: Record<string, number>): void {
  if (typeof r === 'number') {
    out[name] = r;
    return;
  }
  const one = () => {
    const v = r.min + rng.next() * (r.max - r.min);
    return r.int ? Math.round(v) : Math.round(v * 1000) / 1000;
  };
  if (r.count && r.count > 0) {
    const vs = Array.from({ length: r.count }, one);
    if (r.sorted || r.minGap) vs.sort((a, b) => a - b);
    if (r.minGap) for (let i = 1; i < vs.length; i++) vs[i] = Math.max(vs[i], vs[i - 1] + r.minGap);
    vs.forEach((v, i) => (out[`${name}${i}`] = v));
    out[`${name}N`] = r.count;
  } else out[name] = one();
}

/** Roll a modifier's params from bossModifiers.json `params` ranges. */
export function rollBossParams(mod: BossModifierDef | undefined, rng: Rng): Record<string, number> {
  const out: Record<string, number> = {};
  if (!mod?.params) return out;
  for (const [name, r] of Object.entries(mod.params)) rollRange(name, r as BossParamRange | number, rng, out);
  return out;
}

const modById = (id: string) => CONTENT.bossModifiers.find((m) => m.id === id);

/** RaceSetup.boss for round `round` (seeded; identical for previews, the race, Mulligan reruns and replays). */
export function bossSetup(s: RunState, round = s.round): RaceSetup['boss'] {
  const id = s.bosses[round - 1];
  if (!id) return undefined;
  const def = bossById(id);
  const boss: NonNullable<RaceSetup['boss']> = {
    id,
    modifier: def.modifier,
    params: rollBossParams(modById(def.modifier), seedRng(s.seed, 'boss_params', round, def.modifier)),
  };
  if (s.heat >= 8) {
    // Heat 8: a second modifier, taken from the regular bosses' modifiers (stackable !== false).
    const rng = seedRng(s.seed, 'boss_extra', round);
    const cands = [...new Set(CONTENT.bosses.filter((b) => b.tier === 'regular').map((b) => b.modifier))].filter((m) => {
      const md = modById(m) as (BossModifierDef & { stackable?: boolean }) | undefined;
      return m !== def.modifier && !!md && md.stackable !== false;
    });
    if (cands.length) {
      const m = rng.pick(cands);
      boss.extra = [{ modifier: m, params: rollBossParams(modById(m), seedRng(s.seed, 'boss_params', round, m)) }];
    }
  }
  return boss;
}

// ---------- Opponents and targets ----------

/** Heat 2 and Heat 6: targets 2% faster each. */
export function heatTargetMult(heat: number): number {
  return (heat >= 2 ? 0.98 : 1) * (heat >= 6 ? 0.98 : 1);
}

/** Endless rounds (5+): round-4 targets x m^k x (1 - q k^2), k = round - 4. Becomes impossible eventually. */
export function endlessTargetMult(round: number): number {
  const k = Math.max(0, round - ROUNDS);
  if (!k) return 1;
  const e = CONTENT.balance.endless;
  return Math.pow(e.targetMultPerRound, k) * Math.max(0.2, 1 - e.squeezePerRound2 * k * k);
}

const ROMAN = ['', '', ' II', ' III', ' IV', ' V', ' VI', ' VII', ' VIII', ' IX', ' X'];

/** The opponent for (round, race) in this run: the drawn boss on race 3; heat and endless scaling applied. */
export function runOpponent(s: RunState, round = s.round, race = s.race): OpponentDef {
  const baseRound = Math.min(round, ROUNDS);
  const base = opponentFor(baseRound, race);
  // Endless regular races cycle the round 1-4 roster.
  const cycle = round > ROUNDS ? opponentFor(((round - ROUNDS - 1) % ROUNDS) + 1, race) : base;
  const lap = round > ROUNDS ? Math.floor((round - 1) / ROUNDS) + 1 : 1;
  const targetEt = Math.round(base.targetEt * heatTargetMult(s.heat) * endlessTargetMult(round) * 1000) / 1000;
  const opp: OpponentDef = { ...cycle, round, race, targetEt, name: cycle.name + (ROMAN[lap] ?? ` ${lap}`) };
  if (race === RACES_PER_ROUND - 1) {
    const id = s.bosses[round - 1];
    if (id) {
      const b = bossById(id);
      opp.name = b.name;
      opp.car = b.car;
      opp.taunt = b.taunt;
      opp.bossModifier = b.modifier;
      opp.bossId = b.id;
      if (b.cutscene) opp.cutscene = b.cutscene;
      else delete opp.cutscene;
    }
  }
  return opp;
}

// ---------- Skip tags ----------

/** The tag for skipping (round, race), seeded; null on boss races. */
export function skipTagFor(s: RunState, round = s.round, race = s.race): TagDef | null {
  if (race >= RACES_PER_ROUND - 1) return null;
  const w = CONTENT.balance.shop.rarityWeights as Record<string, number>;
  const cands = CONTENT.tags.filter((t) => !(t.id === 'mulligan' && s.heat >= 7));
  if (!cands.length) return null;
  return seedRng(s.seed, 'tag', round, race).weighted(cands, cands.map((t) => w[t.rarity] ?? 1));
}

// ---------- Construction ----------

export interface NewRunOpts {
  car?: string;
  heat?: number;
}

export function createRun(seedIn?: string, opts: NewRunOpts = {}): RunState {
  const seed = normalizeSeed(seedIn);
  const car = CONTENT.startingCars.some((c) => c.id === opts.car) ? opts.car! : DEFAULT_CAR;
  const heat = Math.max(0, Math.min(MAX_HEAT, Math.floor(opts.heat ?? 0)));
  let cash = CONTENT.balance.economy.startCash;
  if (car === 'daily_driver') cash += 4;
  if (heat >= 5) cash -= 5;
  const state: RunState = {
    seed,
    rng: hashSeed(seed),
    phase: 'shop',
    cash: Math.max(0, cash),
    round: 1,
    race: 0,
    ...runDefaults(),
    car,
    heat,
    bosses: drawBosses(seed),
    parts: stockParts(),
    passives: [],
    consumables: [],
    tuningCards: 0,
    shop: null,
    stagedConsumables: [],
    mulliganArmed: false,
    lastResult: null,
    lastPayout: null,
    history: [],
  };
  if (car === 'trust_fund') {
    // 2 random Street parts of one random Street brand, different slots (seeded): a head start on a set.
    const rng = seedRng(seed, 'car');
    const brand = rng.pick(CONTENT.brands.filter((b) => b.tier === 'street'));
    const street = rng.shuffle(CONTENT.parts.filter((p) => p.brand === brand.id));
    for (const p of street.slice(0, 2)) state.parts[p.slot] = { partId: p.id, level: 0 };
  }
  refreshSlots(state);
  withRng(state, (rng) => {
    state.shop = makeShop(state, rng, true, true);
  });
  return state;
}

/** Run `fn` with an Rng seeded from state.rng, then write the advanced state back. */
export function withRng<T>(state: RunState, fn: (rng: Rng) => T): T {
  const rng = new Rng(state.rng >>> 0);
  const out = fn(rng);
  state.rng = rng.state >>> 0;
  return out;
}

const PHASES = ['shop', 'staging', 'race', 'result', 'gameover', 'victory'];
const EDITIONS: (Edition | null)[] = ['foil', 'holo', 'chrome', null];

/** Structural check of a saved run; repairs what it safely can. Returns null if unusable (incl. pre-v2 saves). */
export function validateRun(raw: unknown): RunState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as RunState;
  try {
    if (typeof s.seed !== 'string' || typeof s.rng !== 'number' || !PHASES.includes(s.phase)) return null;
    if (typeof s.cash !== 'number' || typeof s.round !== 'number' || typeof s.race !== 'number') return null;
    // v2 fields: a save without them is from an older version.
    if (typeof s.car !== 'string' || typeof s.heat !== 'number' || !Array.isArray(s.bosses)) return null;
    if (!s.parts || typeof s.parts !== 'object') return null;
    for (const slot of SLOTS) {
      const ip = s.parts[slot];
      if (!ip || !CONTENT.parts.some((p) => p.id === ip.partId)) s.parts[slot] = { partId: stockPart(slot).id, level: 0 };
    }
    if (!CONTENT.startingCars.some((c) => c.id === s.car)) s.car = DEFAULT_CAR;
    s.heat = Math.max(0, Math.min(MAX_HEAT, Math.floor(s.heat)));
    s.endless = !!s.endless;
    s.bosses = s.bosses.filter((id) => CONTENT.bosses.some((b) => b.id === id));
    if (s.bosses.length < ROUNDS) s.bosses = drawBosses(s.seed);
    ensureBoss(s, s.round);
    s.tags = Array.isArray(s.tags) ? s.tags.filter((id) => CONTENT.tags.some((t) => t.id === id)) : [];
    s.garage = Array.isArray(s.garage) ? s.garage.filter((id) => CONTENT.garage.some((g) => g.id === id)) : [];
    const eds = Array.isArray(s.passiveEditions) ? s.passiveEditions : [];
    const ps: string[] = [];
    const pe: (Edition | null)[] = [];
    (Array.isArray(s.passives) ? s.passives : []).forEach((id, i) => {
      if (!CONTENT.passives.some((p) => p.id === id)) return;
      ps.push(id);
      pe.push(EDITIONS.includes(eds[i]) ? eds[i] : null);
    });
    s.passives = ps;
    s.passiveEditions = pe;
    s.passiveState = s.passiveState && typeof s.passiveState === 'object' ? s.passiveState : {};
    refreshSlots(s);
    s.consumables = Array.isArray(s.consumables)
      ? s.consumables.filter((id) => CONTENT.consumables.some((c) => c.id === id))
      : [];
    s.stagedConsumables = Array.isArray(s.stagedConsumables) ? s.stagedConsumables : [];
    s.history = Array.isArray(s.history) ? s.history : [];
    s.tuningCards = typeof s.tuningCards === 'number' ? s.tuningCards : 0;
    s.mulliganArmed = !!s.mulliganArmed;
    s.lastResult = s.lastResult ?? null;
    s.lastPayout = s.lastPayout ?? null;
    if (s.shop && (!Array.isArray(s.shop.entryLines) || typeof s.shop.paidRerolls !== 'number')) s.shop = null;
    if (s.phase === 'shop' && !s.shop) {
      withRng(s, (rng) => {
        s.shop = makeShop(s, rng, false);
      });
    }
    s.paragonJustUnlocked = null; // the transform moment never replays on load
    if (s.phase === 'result' && !s.lastResult) return null;
    return s;
  } catch {
    return null;
  }
}
