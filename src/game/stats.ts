// Stat calculation pipeline (DESIGN.md "Calculation order"). Pure logic, no Phaser.
import { SLOTS } from '../core/types';
import type { CarStats, RaceHooks, RaceSetup, RunState, SlotId, StatBreakdownStep, StatKey } from '../core/types';
import { CONTENT, consumableById, opponentFor, partById, passiveById, stockPart } from '../data/content';
import { BOSS_EFFECTS, CONSUMABLE_EFFECTS, PASSIVE_EFFECTS, isBeneficial, type BuildInfo, type SetupMods } from './effects';

const STAT_KEYS: StatKey[] = ['power', 'grip', 'weight', 'gearing', 'drag', 'shiftWindow', 'nitroPower', 'nitroDuration'];

function addStats(s: Partial<CarStats>, d: Partial<CarStats>, scale = 1) {
  for (const k of STAT_KEYS) {
    const v = d[k];
    if (v) s[k] = (s[k] ?? 0) + v * scale;
  }
}

/** The tuning bonus of a part at a level: +tuningPerLevel of its beneficial stats per level. */
export function tuningBonus(partId: string, level: number): Partial<CarStats> {
  const p = partById(partId);
  const per = CONTENT.balance.limits.tuningPerLevel;
  const out: Partial<CarStats> = {};
  if (level <= 0 || p.tier === 'stock') return out;
  for (const k of STAT_KEYS) {
    const v = p.stats[k];
    if (v && isBeneficial(k, v)) out[k] = v * per * level;
  }
  return out;
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

  const opp = opponentFor(run.round, run.race);
  const boss = opp.bossModifier ? BOSS_EFFECTS[opp.bossModifier] : undefined;
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
    const bonus = tuningBonus(def.id, level);
    addStats(s, bonus);
    addStats(partStats[slot], bonus);
    breakdown.push({ source: `${def.name} (L${level})`, kind: 'tuning', stats: snapshot(s) });
  }

  const build: BuildInfo = { partStats, nonStockCount: installed.filter((i) => i.def.tier !== 'stock').length };

  // 3. Passives, left → right. Redline Only disables the rightmost.
  const disabledCount = boss?.disableRightmostPassives ?? 0;
  const hooks: RaceHooks[] = [];
  run.passives.forEach((id, i) => {
    const def = passiveById(id);
    const disabled = i >= run.passives.length - disabledCount;
    if (!disabled) {
      const eff = PASSIVE_EFFECTS[id];
      eff?.stats?.(s, build);
      eff?.setup?.(mods);
      const h = eff?.hooks?.();
      if (h) hooks.push(h);
    }
    breakdown.push({ source: def.name, kind: 'passive', stats: snapshot(s), ...(disabled ? { disabled: true } : {}) });
  });

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

  // 5. Boss modifier
  if (opp.bossModifier && boss) {
    boss.stats?.(s);
    boss.setup?.(mods);
    const bdef = CONTENT.bossModifiers.find((b) => b.id === opp.bossModifier);
    breakdown.push({ source: `Boss: ${bdef?.name ?? opp.bossModifier}`, kind: 'boss', stats: snapshot(s) });
  }

  const finalStats = clampFinal(s);
  const setup: RaceSetup = {
    stats: finalStats,
    hooks,
    quirks: mods.quirks,
    launchWindowMult: mods.launchWindowMult,
    extraShiftWindowMult: mods.extraShiftWindowMult,
    gripEarlyMult: mods.gripEarlyMult,
    gripEarlySeconds: mods.gripEarlySeconds,
    targetEt: opp.targetEt,
  };
  return { setup, breakdown };
}
