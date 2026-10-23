// Meta progression across runs (heat unlocks, cars, records). localStorage 'revlotto_meta', in-memory fallback.
import type { MetaState, RunState, StartingCarDef } from '../core/types';
import { CONTENT } from '../data/content';

const KEY = 'revlotto_meta';
const MAX_HEAT = 8;

function blank(): MetaState {
  return {
    version: 1, heatUnlocked: 0, bestHeatByCar: {}, carsUnlocked: [], runsPlayed: 0, runsWon: 0,
    bestRoundBeaten: 0, bestEndlessRound: 0, bestEndlessRoundByCar: {}, discoveredPassives: [],
  };
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);
const numMap = (v: unknown): Record<string, number> => {
  const o: Record<string, number> = {};
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (typeof x === 'number') o[k] = x;
  return o;
};
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function load(): MetaState {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return blank();
    const m = JSON.parse(raw) as Partial<MetaState>;
    return {
      version: 1,
      heatUnlocked: Math.max(0, Math.min(MAX_HEAT, num(m.heatUnlocked))),
      bestHeatByCar: numMap(m.bestHeatByCar),
      carsUnlocked: strs(m.carsUnlocked),
      runsPlayed: num(m.runsPlayed),
      runsWon: num(m.runsWon),
      bestRoundBeaten: num(m.bestRoundBeaten),
      bestEndlessRound: num(m.bestEndlessRound),
      bestEndlessRoundByCar: numMap(m.bestEndlessRoundByCar),
      discoveredPassives: strs(m.discoveredPassives),
    };
  } catch {
    return blank();
  }
}

let meta: MetaState = load();

function save(): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(meta));
  } catch {
    /* ignore */
  }
}

export function getMeta(): MetaState {
  return meta;
}

/** Tests / dev: replace the meta state (not persisted unless persist). */
export function setMeta(m: MetaState, persist = false): void {
  meta = m;
  if (persist) save();
}

export function isCarUnlocked(c: StartingCarDef, m: MetaState = meta): boolean {
  if (m.carsUnlocked.includes(c.id)) return true;
  const v = c.unlock.value ?? 0;
  switch (c.unlock.kind) {
    case 'free':
      return true;
    case 'beat_round':
      return m.bestRoundBeaten >= v;
    case 'win_run':
      return m.runsWon > 0;
    case 'win_heat':
      return Object.values(m.bestHeatByCar).some((h) => h >= v);
  }
}

function syncCars(): void {
  for (const c of CONTENT.startingCars) if (!meta.carsUnlocked.includes(c.id) && isCarUnlocked(c)) meta.carsUnlocked.push(c.id);
}

export function recordRunStarted(): void {
  meta.runsPlayed += 1;
  save();
}

export function recordBossBeaten(round: number): void {
  if (round > meta.bestRoundBeaten) {
    meta.bestRoundBeaten = round;
    syncCars();
    save();
  }
}

/** Final (round 4) boss beaten. Unlocks heat+1 and records the car's best heat. */
export function recordRunWon(run: RunState): void {
  meta.runsWon += 1;
  meta.heatUnlocked = Math.max(meta.heatUnlocked, Math.min(MAX_HEAT, run.heat + 1));
  meta.bestHeatByCar[run.car] = Math.max(meta.bestHeatByCar[run.car] ?? -1, run.heat);
  syncCars();
  save();
}

/** Endless: called whenever a new endless round starts and when the run ends. */
export function recordEndlessRound(run: RunState): void {
  if (!run.endless) return;
  let dirty = false;
  if (run.round > meta.bestEndlessRound) {
    meta.bestEndlessRound = run.round;
    run.newEndlessRecord = true;
    dirty = true;
  }
  if (run.round > (meta.bestEndlessRoundByCar[run.car] ?? 0)) {
    meta.bestEndlessRoundByCar[run.car] = run.round;
    dirty = true;
  }
  if (dirty) save();
}

export function discoverPassive(id: string): void {
  if (meta.discoveredPassives.includes(id)) return;
  meta.discoveredPassives.push(id);
  save();
}
