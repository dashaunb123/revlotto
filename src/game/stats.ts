// Stat calculation pipeline (DESIGN.md "Calculation order"). Pure logic, no Phaser.
import { SLOTS } from '../core/types';
import type { CarStats, PassiveInfo, RaceHooks, RaceSetup, RunState, SlotId, StatBreakdownStep, StatKey } from '../core/types';
import { CONTENT, brandById, consumableById, partById, passiveById, startingCarById, stockPart } from '../data/content';
import { BOSS_EFFECTS, CONSUMABLE_EFFECTS, applyParagonAbility, applyPassives, isBeneficial, type BuildInfo, type SetupMods } from './effects';
import { activeParagon, brandCounts } from './brands';
import { bossSetup, runOpponent } from './run';

/** Tuning per level: balance (10%), Master Tuner 15%. */
export function tuningPerLevel(run?: Pick<RunState, 'garage'>): number {
  return run?.garage?.includes('master_tuner') ? 0.15 : CONTENT.balance.limits.tuningPerLevel;
}

/** Starting-car changes to the base car (shown as a 'base' breakdown step). */
export function applyCarBase(car: string, s: CarStats): boolean {
  switch (car) {
    case 'big_torque':
      s.power *= 1.25;
      s.grip *= 0.9;
      return true;
    case 'tow_rig':
      s.weight += 150;
      return true;
    case 'paper_plane':
      s.shiftWindow *= 1.25;
      s.weight -= 150;
      s.grip *= 0.92;
      return true;
  }
  return false;
}

export function passiveInfo(run: RunState, index: number): PassiveInfo {
  const id = run.passives[index];
  return {
    id,
    index,
    edition: run.passiveEditions?.[index] ?? null,
    counter: (key?: string) => run.passiveState?.[key ? `${id}:${key}` : id] ?? 0,
    run,
  };
}

const STAT_KEYS: StatKey[] = ['power', 'grip', 'weight', 'gearing', 'drag', 'shiftWindow', 'nitroPower', 'nitroDuration'];

function addStats(s: Partial<CarStats>, d: Partial<CarStats>, scale = 1) {
  for (const k of STAT_KEYS) {
    const v = d[k];
    if (v) s[k] = (s[k] ?? 0) + v * scale;
  }
}

/** The tuning bonus of a part at a level: +tuningPerLevel of its beneficial stats per level. */
export function tuningBonus(partId: string, level: number, per = CONTENT.balance.limits.tuningPerLevel): Partial<CarStats> {
  const p = partById(partId);
  const out: Partial<CarStats> = {};
  if (level <= 0 || p.tier === 'stock') return out;
  for (const k of STAT_KEYS) {
    const v = p.stats[k];
    if (v && isBeneficial(k, v)) out[k] = v * per * level;
  }
  return out;
}

function mulStats(s: CarStats, m: Partial<CarStats>) {
  for (const k of STAT_KEYS) {
    const v = m[k];
    if (v !== undefined && v !== 1) s[k] *= v;
  }
}

/** Active set bonuses, highest count first (ties by brand order in brands.json). */
export function activeSets(parts: RunState['parts']): { brand: string; count: number; level: 4 | 8 | 12 }[] {
  const counts = brandCounts(parts ?? ({} as RunState['parts']));
  return CONTENT.brands
    .map((b) => ({ brand: b.id, count: counts[b.id] ?? 0 }))
    .filter((x) => x.count >= 4)
    .sort((a, b) => b.count - a.count)
    .map((x) => ({ ...x, level: (x.count >= 12 ? 12 : x.count >= 8 ? 8 : 4) as 4 | 8 | 12 }));
}

function clampFinal(s: CarStats): CarStats {
  return {
    power: Math.max(20, s.power),
    grip: Math.max(0.3, s.grip),
    weight: Math.max(400, s.weight),
    gearing: Math.max(0.3, s.gearing),
    drag: Math.max(0.25, s.drag),
    shiftWindow: Math.max(0.3, s.shiftWindow),
    nitroPower: Math.max(0, s.nitroPower),
    nitroDuration: Math.max(0, s.nitroDuration),
  };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
function snapshot(s: CarStats): CarStats {
  const o = {} as CarStats;
  for (const k of STAT_KEYS) o[k] = r3(s[k]);
  return o;
}

export interface ComputeOpts {
  includeStaged?: boolean;
}

/**
 * Builds the RaceSetup for the run's current race plus a left-to-right breakdown for the staging UI.
 * Order: base car → parts → tuning → passives (left→right) → staged consumables → boss modifier.
 */
export function computeRaceSetup(run: RunState, opts: ComputeOpts = {}): { setup: RaceSetup; breakdown: StatBreakdownStep[] } {
  const includeStaged = opts.includeStaged ?? true;
  const breakdown: StatBreakdownStep[] = [];
  const s: CarStats = { ...CONTENT.balance.starter };
  breakdown.push({ source: 'Base car', kind: 'base', stats: snapshot(s) });
  if (applyCarBase(run.car, s)) breakdown.push({ source: startingCarById(run.car).name, kind: 'base', stats: snapshot(s) });

  const opp = runOpponent(run);
  const bossInfo = opp.bossModifier ? bossSetup(run) : undefined;
  const bossMods = bossInfo ? [bossInfo.modifier, ...(bossInfo.extra ?? []).map((e) => e.modifier)] : [];
  const mods: SetupMods = { quirks: [], launchWindowMult: 1, extraShiftWindowMult: 1, gripEarlyMult: 1, gripEarlySeconds: 0 };

  // 1. Parts
  const installed = SLOTS.map((slot) => {
    const ip = run.parts?.[slot];
    const def = ip ? partById(ip.partId) : stockPart(slot);
    return { slot, def, level: ip && def.tier !== 'stock' ? Math.max(0, Math.min(CONTENT.balance.limits.maxTuning, ip.level)) : 0 };
  });
  const partStats = {} as Record<SlotId, Partial<CarStats>>;
  for (const { slot, def } of installed) {
    partStats[slot] = { ...def.stats };
    if (def.quirk) mods.quirks.push(def.quirk);
    if (def.tier === 'stock') continue;
    addStats(s, def.stats);
    breakdown.push({ source: def.name, kind: 'part', stats: snapshot(s) });
  }

  // 2. Tuning
  for (const { slot, def, level } of installed) {
    if (level <= 0) continue;
    const bonus = tuningBonus(def.id, level, tuningPerLevel(run));
    addStats(s, bonus);
    addStats(partStats[slot], bonus);
    breakdown.push({ source: `${def.name} (L${level})`, kind: 'tuning', stats: snapshot(s) });
  }

  // 2b. Brand sets (4 / 8 parts), then the paragon (all 12). Pure function of the installed parts.
  const sets = activeSets(run.parts);
  for (const set of sets) {
    const b = brandById(set.brand);
    if (!b) continue;
    mulStats(s, b.set4.mult);
    breakdown.push({ source: `${b.name.toUpperCase()} SET (4)`, kind: 'set', stats: snapshot(s) });
    if (set.count >= 8) {
      mulStats(s, b.set8.mult);
      breakdown.push({ source: `${b.name.toUpperCase()} SET (8)`, kind: 'set', stats: snapshot(s) });
    }
  }
  const paragonBrand = activeParagon(run.parts ?? ({} as RunState['parts']));
  const paragonDef = brandById(paragonBrand ?? undefined);
  const paragonHooks: RaceHooks[] = [];
  if (paragonDef) {
    mulStats(s, paragonDef.paragon.mult);
    const h = applyParagonAbility(paragonDef.paragon.ability, s, mods);
    if (h) paragonHooks.push(h);
    breakdown.push({ source: `PARAGON: ${paragonDef.paragon.name.toUpperCase()}`, kind: 'paragon', stats: snapshot(s) });
  }

  const build: BuildInfo = { partStats, nonStockCount: installed.filter((i) => i.def.tier !== 'stock').length };

  // 3. Passives, left → right. Redline Only disables the rightmost.
  const disabledCount = bossMods.reduce((n, m) => n + (BOSS_EFFECTS[m]?.disableRightmostPassives ?? 0), 0);
  // Editions, copies, position effects and counters are handled inside applyPassives (effects.ts).
  const hooks: RaceHooks[] = applyPassives(run, s, mods, build, { disabledCount }, (id, _i, disabled) =>
    breakdown.push({ source: passiveById(id).name, kind: 'passive', stats: snapshot(s), ...(disabled ? { disabled: true } : {}) }),
  );

  // 4. Consumables staged for this race
  if (includeStaged) {
    for (const id of run.stagedConsumables ?? []) {
      const def = consumableById(id);
      const eff = CONSUMABLE_EFFECTS[id];
      eff?.stats?.(s);
      eff?.setup?.(mods);
      breakdown.push({ source: def.name, kind: 'consumable', stats: snapshot(s) });
    }
  }

  // 5. Boss modifier(s): the drawn boss's, plus Heat 8's extra
  for (const m of bossMods) {
    const eff = BOSS_EFFECTS[m];
    eff?.stats?.(s);
    eff?.setup?.(mods);
    const bdef = CONTENT.bossModifiers.find((b) => b.id === m);
    breakdown.push({ source: `Boss: ${bdef?.name ?? m}`, kind: 'boss', stats: snapshot(s) });
  }

  const finalStats = clampFinal(s);
  const setup: RaceSetup = {
    stats: finalStats,
    hooks: [...paragonHooks, ...hooks],
    quirks: mods.quirks,
    launchWindowMult: mods.launchWindowMult,
    extraShiftWindowMult: mods.extraShiftWindowMult,
    gripEarlyMult: mods.gripEarlyMult,
    gripEarlySeconds: mods.gripEarlySeconds,
    targetEt: opp.targetEt,
    ...(bossInfo ? { boss: bossInfo } : {}),
    ...(sets.length ? { sets } : {}),
    ...(paragonDef ? { paragon: { brand: paragonDef.id, ability: paragonDef.paragon.ability } } : {}),
  };
  return { setup, breakdown };
}
