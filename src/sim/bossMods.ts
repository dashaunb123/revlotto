// Boss modifiers: param rolling (Core calls rollBossParams with the run RNG) and the hazard layout
// both the sim and the race scene read. No Phaser imports here.
import bossModifiersJson from '../data/bossModifiers.json';

/** A param spec in bossModifiers.json (same shape as core BossParamRange; min === max for a fixed value). */
export interface BossParamSpec {
  min: number;
  max: number;
  int?: boolean;
}

export interface BossModifierData {
  id: string;
  name: string;
  desc: string;
  hint: string;
  tier: 'regular' | 'final';
  legacy?: boolean;
  params?: Record<string, BossParamSpec>;
  /** Stat multipliers Core applies at build time (they show on the staging breakdown). */
  stats?: Partial<Record<'power' | 'grip' | 'weight' | 'drag' | 'gearing', number>>;
  /** Rightmost passives disabled (Core applies). */
  disablePassives?: number;
}

export const BOSS_MODIFIERS = bossModifiersJson as unknown as BossModifierData[];

export function bossModifierData(id: string): BossModifierData | undefined {
  return BOSS_MODIFIERS.find((m) => m.id === id);
}

/**
 * Rolls a modifier's params with the given RNG, in the JSON's key order (deterministic per seed).
 * Keys are unique across modifiers, so params for a 2nd modifier (heat 8) can simply be merged.
 */
export function rollBossParams(modId: string, rng: { next(): number }): Record<string, number> {
  const out: Record<string, number> = {};
  const specs = bossModifierData(modId)?.params ?? {};
  for (const k of Object.keys(specs)) {
    const s = specs[k];
    const v = s.min === s.max ? s.min : s.min + rng.next() * (s.max - s.min);
    out[k] = s.int ? Math.round(v) : Math.round(v * 1000) / 1000;
  }
  return out;
}

/** Midpoint params (no RNG): for dev previews and fallbacks. */
export function defaultBossParams(modId: string): Record<string, number> {
  return rollBossParams(modId, { next: () => 0.5 });
}

export interface Span {
  a: number;
  b: number;
}

/** Everything a boss puts on the strip, resolved from the params. Times are sim t (s since green), distances meters. */
export interface Hazards {
  mods: Set<string>;
  /** Amber on-times (3 values, negative), green at 0. */
  ambers: [number, number, number];
  decoyT: number | null;
  oil: Span[];
  gusts: Span[];
  blackouts: Span[];
  /** Per-gear (1..3) window centre override, or null = standard. */
  centers: (number | null)[];
  /** Per-gear (1..3) window width multiplier. */
  widths: number[];
  launchMult: number;
  windowMult: number;
  gustDrag: number;
  gustWin: number;
  /** UI only. */
  hideWindow: boolean;
  mirror: boolean;
  suddenDeath: boolean;
}

export const GUST_RAMP = 0.15;
export const GUST_WARN = 1.0;
export const BLACKOUT_WARN = 0.35;
export const DECOY_LEN = 0.09;

export function buildHazards(mods: string[], p: Record<string, number>): Hazards {
  const has = (id: string) => mods.includes(id);
  const n = (k: string, d: number) => (typeof p[k] === 'number' && isFinite(p[k]) ? p[k] : d);
  const h: Hazards = {
    mods: new Set(mods),
    ambers: [-1.5, -1.0, -0.5],
    decoyT: null,
    oil: [],
    gusts: [],
    blackouts: [],
    centers: [null, null, null],
    widths: [1, 1, 1],
    launchMult: 1,
    windowMult: 1,
    gustDrag: 0,
    gustWin: 1,
    hideWindow: false,
    mirror: false,
    suddenDeath: false,
  };
  if ('hair_launch' in p) h.launchMult *= n('hair_launch', 0.5);
  if (has('hair_trigger')) {
    const a3 = -0.5;
    const a2 = a3 - n('amb_gap2', 0.5);
    h.ambers = [a2 - n('amb_gap1', 0.5), a2, a3];
  }
  if (has('decoy_tree')) h.decoyT = Math.min(-0.12, n('decoy_t', -0.3));
  if (has('oil_slick')) {
    const len = n('oil_len', 8);
    // the first patch sits in 1st gear where the car is slow: shorter, or it would swallow the whole window
    for (const k of ['oil_a', 'oil_b', 'oil_c']) if (k in p) h.oil.push({ a: p[k], b: p[k] + len * (k === 'oil_a' ? 0.45 : 1) });
    h.oil.sort((x, y) => x.a - y.a);
  }
  if (has('gale_force')) {
    const len = n('gust_len', 1);
    for (const k of ['gust_a', 'gust_b', 'gust_c']) if (k in p) h.gusts.push({ a: p[k], b: p[k] + len });
    h.gustDrag = n('gust_drag', 2);
    h.gustWin = n('gust_win', 0.5);
  }
  if (has('blackout')) {
    const len = n('bo_len', 1.2);
    for (const k of ['bo_a', 'bo_b', 'bo_c']) if (k in p) h.blackouts.push({ a: p[k], b: p[k] + len });
  }
  if (has('drifting_window')) h.centers = [n('drift_c1', 0.8), n('drift_c2', 0.8), n('drift_c3', 0.8)];
  if (has('short_shift')) h.centers = [0, 1, 2].map(() => n('short_c', 0.73));
  if (has('squeeze')) h.widths = [1, n('squeeze_w2', 0.7), n('squeeze_w3', 0.45)];
  if ('redline_w' in p) h.windowMult *= n('redline_w', 0.5);
  if ('blind_w' in p) h.windowMult *= n('blind_w', 0.85);
  h.hideWindow = n('blind', 0) > 0;
  h.mirror = n('mirror', 0) > 0;
  h.suddenDeath = n('sudden', 0) > 0;
  return h;
}

/** Gust strength 0..1 at sim time t (ramps in/out over GUST_RAMP). */
export function gustAt(h: Hazards, t: number): number {
  let g = 0;
  for (const s of h.gusts) {
    if (t < s.a - GUST_RAMP || t > s.b + GUST_RAMP) continue;
    const up = (t - (s.a - GUST_RAMP)) / GUST_RAMP;
    const down = (s.b + GUST_RAMP - t) / GUST_RAMP;
    g = Math.max(g, Math.min(1, up, down));
  }
  return g;
}

export function inSpan(spans: Span[], v: number): boolean {
  return spans.some((s) => v >= s.a && v <= s.b);
}

/** Seconds until the next span starts after t (Infinity if none); 0 while inside one. */
export function untilSpan(spans: Span[], t: number): number {
  let best = Infinity;
  for (const s of spans) {
    if (t >= s.a && t <= s.b) return 0;
    if (s.a > t) best = Math.min(best, s.a - t);
  }
  return best;
}
