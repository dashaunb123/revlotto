// Shop and pack generation. Pure functions over RunState + a seeded Rng.

import type { PackCard, PartDef, RunState, ShopItem, ShopState, Tier, Rarity } from '../core/types';
import type { Rng } from '../core/rng';
import { CONTENT } from '../data/content';
import { consumablePrice, partPrice, passivePrice } from './economy';

const TIER_RANK: Record<Tier, number> = { stock: 0, street: 1, pro: 2 };

/** Pro share for the current round, clamped to [0, 0.9]. */
export function proShare(round: number): number {
  const s = CONTENT.balance.shop;
  return Math.max(0, Math.min(0.9, s.proShareBase + s.proShareStepPerRound * (round - 1)));
}

function rarityWeight(r: Rarity): number {
  const w = CONTENT.balance.shop.rarityWeights as Record<string, number>;
  return w[r] ?? 1;
}

/**
 * Roll one part. Never the installed part, never one in `exclude` (part ids) or in `excludeSlots`.
 * Upgrades over the installed tier are strongly preferred; downgrades only appear as a rare fallback.
 */
export function rollPart(
  state: RunState,
  rng: Rng,
  exclude: Set<string>,
  excludeSlots: Set<string> = new Set(),
): PartDef | null {
  const wantPro = rng.next() < proShare(state.round);
  const tierOrder: Tier[] = wantPro ? ['pro', 'street'] : ['street', 'pro'];
  for (const tier of tierOrder) {
    const cands: PartDef[] = [];
    const weights: number[] = [];
    for (const p of CONTENT.parts) {
      if (p.tier !== tier) continue;
      if (exclude.has(p.id) || excludeSlots.has(p.slot)) continue;
      const installed = state.parts[p.slot];
      if (installed && installed.partId === p.id) continue;
      const instTier = installed ? tierOf(installed.partId) : 'stock';
      const w = TIER_RANK[p.tier] > TIER_RANK[instTier] ? 1 : 0.12;
      cands.push(p);
      weights.push(w);
    }
    if (cands.length) {
      // If only downgrades exist for this tier, try the other tier first.
      const hasUpgrade = weights.some((w) => w >= 1);
      if (!hasUpgrade && tier === tierOrder[0]) {
        const other = rollTierOnly(state, rng, tierOrder[1], exclude, excludeSlots, true);
        if (other) return other;
      }
      return rng.weighted(cands, weights);
    }
  }
  return null;
}

function rollTierOnly(
  state: RunState,
  rng: Rng,
  tier: Tier,
  exclude: Set<string>,
  excludeSlots: Set<string>,
  upgradesOnly: boolean,
): PartDef | null {
  const cands = CONTENT.parts.filter((p) => {
    if (p.tier !== tier || exclude.has(p.id) || excludeSlots.has(p.slot)) return false;
    const inst = state.parts[p.slot];
    if (inst && inst.partId === p.id) return false;
    if (upgradesOnly && TIER_RANK[p.tier] <= TIER_RANK[tierOf(inst?.partId)]) return false;
    return true;
  });
  return cands.length ? rng.pick(cands) : null;
}

function tierOf(partId: string | undefined): Tier {
  if (!partId) return 'stock';
  return CONTENT.parts.find((p) => p.id === partId)?.tier ?? 'stock';
}

/** Roll a passive the player doesn't own and that isn't in `exclude`. */
export function rollPassive(state: RunState, rng: Rng, exclude: Set<string>): string | null {
  const cands = CONTENT.passives.filter((p) => !state.passives.includes(p.id) && !exclude.has(p.id));
  if (!cands.length) return null;
  return rng.weighted(cands, cands.map((p) => rarityWeight(p.rarity))).id;
}

export function rollConsumable(rng: Rng, exclude: Set<string>): string | null {
  let cands = CONTENT.consumables.filter((c) => !exclude.has(c.id));
  if (!cands.length) cands = CONTENT.consumables.slice();
  if (!cands.length) return null;
  return rng.weighted(cands, cands.map((c) => rarityWeight(c.rarity))).id;
}

/** Roll one loose powerup (passive or consumable) weighted by rarity across both pools. */
function rollPowerup(state: RunState, rng: Rng, taken: Set<string>): ShopItem | null {
  type C = { kind: 'passive' | 'consumable'; id: string; w: number };
  const pool: C[] = [];
  for (const p of CONTENT.passives) {
    if (state.passives.includes(p.id) || taken.has(p.id)) continue;
    pool.push({ kind: 'passive', id: p.id, w: rarityWeight(p.rarity) });
  }
  for (const c of CONTENT.consumables) {
    if (taken.has(c.id)) continue;
    pool.push({ kind: 'consumable', id: c.id, w: rarityWeight(c.rarity) });
  }
  if (!pool.length) return null;
  const pick = rng.weighted(pool, pool.map((c) => c.w));
  taken.add(pick.id);
  if (pick.kind === 'passive') return { kind: 'passive', passiveId: pick.id, price: passivePrice(pick.id), sold: false };
  const def = CONTENT.consumables.find((c) => c.id === pick.id);
  return { kind: 'consumable', consumableId: pick.id, price: consumablePrice(def?.cost), sold: false };
}

/** The 4 loose items: 2 parts then 2 powerups. */
export function rollItems(state: RunState, rng: Rng): ShopItem[] {
  const items: ShopItem[] = [];
  const takenParts = new Set<string>();
  const takenSlots = new Set<string>();
  for (let i = 0; i < 2; i++) {
    const p = rollPart(state, rng, takenParts, takenSlots);
    if (!p) continue;
    takenParts.add(p.id);
    takenSlots.add(p.slot);
    items.push({ kind: 'part', partId: p.id, price: partPrice(p.id), sold: false });
  }
  const taken = new Set<string>();
  for (let i = 0; i < 2; i++) {
    const it = rollPowerup(state, rng, taken);
    if (it) items.push(it);
  }
  return items;
}

export function makeShop(state: RunState, rng: Rng, freePack: boolean): ShopState {
  const prices = CONTENT.balance.prices;
  return {
    items: rollItems(state, rng),
    packs: [
      { kind: 'parts', price: prices.partsPack, sold: false },
      { kind: 'power', price: freePack ? 0 : prices.powerPack, sold: false },
    ],
    rerollCost: prices.rerollBase,
    openPack: null,
    freePack,
  };
}

export function rollPartsPack(state: RunState, rng: Rng): PackCard[] {
  const cards: PackCard[] = [];
  const taken = new Set<string>();
  const slots = new Set<string>();
  for (let i = 0; i < 3; i++) {
    const p = rollPart(state, rng, taken, slots);
    if (!p) break;
    taken.add(p.id);
    slots.add(p.slot);
    cards.push({ kind: 'part', partId: p.id });
  }
  return cards;
}

export function rollPowerPack(state: RunState, rng: Rng): PackCard[] {
  const odds = CONTENT.balance.shop.powerPackOdds;
  const total = odds.passive + odds.consumable + odds.tuning;
  const cards: PackCard[] = [];
  const takenPassives = new Set<string>();
  const takenConsumables = new Set<string>();
  for (let i = 0; i < 3; i++) {
    const r = rng.next() * total;
    let card: PackCard | null = null;
    if (r < odds.passive) {
      const id = rollPassive(state, rng, takenPassives);
      if (id) {
        takenPassives.add(id);
        card = { kind: 'passive', passiveId: id };
      }
    } else if (r >= odds.passive + odds.consumable) {
      card = { kind: 'tuning' };
    }
    if (!card) {
      const id = rollConsumable(rng, takenConsumables);
      if (id) {
        takenConsumables.add(id);
        card = { kind: 'consumable', consumableId: id };
      } else {
        card = { kind: 'tuning' };
      }
    }
    cards.push(card);
  }
  return cards;
}

