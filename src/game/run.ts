// RunState construction and validation of saved runs.
import { SLOTS } from '../core/types';
import type { InstalledPart, RunState, SlotId } from '../core/types';
import { hashSeed, randomSeedString, Rng } from '../core/rng';
import { CONTENT, stockPart } from '../data/content';
import { makeShop } from './shop';

export function normalizeSeed(seed: string | undefined): string {
  const s = (seed ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length ? s.slice(0, 12) : randomSeedString(6);
}

export function stockParts(): Record<SlotId, InstalledPart> {
  const parts = {} as Record<SlotId, InstalledPart>;
  for (const slot of SLOTS) parts[slot] = { partId: stockPart(slot).id, level: 0 };
  return parts;
}

export function createRun(seedIn?: string): RunState {
  const seed = normalizeSeed(seedIn);
  const state: RunState = {
    seed,
    rng: hashSeed(seed),
    phase: 'shop',
    cash: CONTENT.balance.economy.startCash,
    round: 1,
    race: 0,
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
  withRng(state, (rng) => {
    state.shop = makeShop(state, rng, true);
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

/** Loose structural check of a saved run; repairs what it safely can. Returns null if unusable. */
export function validateRun(raw: unknown): RunState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as RunState;
  try {
    if (typeof s.seed !== 'string' || typeof s.rng !== 'number' || !PHASES.includes(s.phase)) return null;
    if (typeof s.cash !== 'number' || typeof s.round !== 'number' || typeof s.race !== 'number') return null;
    if (!s.parts || typeof s.parts !== 'object') return null;
    for (const slot of SLOTS) {
      const ip = s.parts[slot];
      if (!ip || !CONTENT.parts.some((p) => p.id === ip.partId)) s.parts[slot] = { partId: stockPart(slot).id, level: 0 };
    }
    s.passives = Array.isArray(s.passives) ? s.passives.filter((id) => CONTENT.passives.some((p) => p.id === id)) : [];
    s.consumables = Array.isArray(s.consumables)
      ? s.consumables.filter((id) => CONTENT.consumables.some((c) => c.id === id))
      : [];
    s.stagedConsumables = Array.isArray(s.stagedConsumables) ? s.stagedConsumables : [];
    s.history = Array.isArray(s.history) ? s.history : [];
    s.tuningCards = typeof s.tuningCards === 'number' ? s.tuningCards : 0;
    s.mulliganArmed = !!s.mulliganArmed;
    s.lastResult = s.lastResult ?? null;
    s.lastPayout = s.lastPayout ?? null;
    if (s.phase === 'shop' && !s.shop) {
      withRng(s, (rng) => {
        s.shop = makeShop(s, rng, false);
      });
    }
    if (s.phase === 'result' && !s.lastResult) return null;
    return s;
  } catch {
    return null;
  }
}
