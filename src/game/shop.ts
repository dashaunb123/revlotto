// Shop and pack generation. Pure functions over RunState + a seeded Rng.

import type { Edition, GarageDef, PackCard, PartDef, RunState, ShopItem, ShopState, Tier, Rarity } from '../core/types';
import type { Rng } from '../core/rng';
import { CONTENT } from '../data/content';
import {
  adjustPrice,
  consumablePrice,
  editionPrice,
  garagePrice,
  owns,
  packPrice,
  partPrice,
  passivePrice,
  rerollPrice,
} from './economy';

/** Heat 7: Mulligan never appears (shop, packs, tags). */
export function bannedConsumables(state: RunState): Set<string> {
  return new Set(state.heat >= 7 ? ['mulligan'] : []);
}

/** Roll an edition for a newly offered passive (low odds). */
export function rollEdition(rng: Rng): Edition | null {
  const e = CONTENT.balance.editions;
  const r = rng.next();
  if (r < e.chrome.odds) return 'chrome';
  if (r < e.chrome.odds + e.holo.odds) return 'holo';
  if (r < e.chrome.odds + e.holo.odds + e.foil.odds) return 'foil';
  return null;
}

/** Current price of a loose shop item for this run (garage discounts, Trust Fund, Back Room deal). */
export function itemPrice(state: RunState, it: ShopItem): number {
  if (it.kind === 'part') {
    const p = adjustPrice(state, partPrice(it.partId));
    return it.deal ? Math.max(1, Math.floor(p / 2)) : p;
  }
  if (it.kind === 'passive') return adjustPrice(state, passivePrice(it.passiveId) + editionPrice(it.edition));
  const def = CONTENT.consumables.find((c) => c.id === it.consumableId);
  return adjustPrice(state, consumablePrice(def?.cost));
}

/** Re-price unsold items/packs and the reroll after a garage purchase changed the rules mid-shop. */
export function repriceShop(state: RunState, shop: ShopState): void {
  for (const it of shop.items) if (!it.sold) it.price = itemPrice(state, it);
  for (const p of shop.packs) if (!p.sold && p.price > 0) p.price = packPrice(state, p.kind);
  shop.rerollCost = rerollPrice(state, shop.paidRerolls);
}

/** Garage offer: a tier-1 upgrade not owned, or a tier-2 whose tier-1 is owned. */
export function rollGarage(state: RunState, rng: Rng): GarageDef | null {
  const owned = new Set(state.garage);
  const cands = CONTENT.garage.filter((g) => !owned.has(g.id) && (g.tier === 1 || (!!g.requires && owned.has(g.requires))));
  return cands.length ? rng.pick(cands) : null;
}

export const TIER_RANK: Record<Tier, number> = { stock: 0, street: 1, sport: 2, pro: 3 };
const SHOP_TIERS = ['street', 'sport', 'pro'] as const;
type ShopTier = (typeof SHOP_TIERS)[number];

/** Tier odds for a round (balance.shop.tierOdds; the last row repeats in later rounds / endless). */
export function tierOdds(round: number): Record<ShopTier, number> {
  const rows = CONTENT.balance.shop.tierOdds;
  return rows[Math.max(0, Math.min(rows.length - 1, round - 1))];
}

/** Brand bias: a brand's weight within the rolled tier is 1 + brandBias(state) x (its parts you have installed). */
export function brandBias(state: Pick<RunState, 'garage'>): number {
  const s = CONTENT.balance.shop;
  if (owns(state, 'brand_fanatic')) return s.brandBias + s.loyaltyBias2;
  if (owns(state, 'brand_loyalty')) return s.brandBias + s.loyaltyBias;
  return s.brandBias;
}

function rarityWeight(r: Rarity): number {
  const w = CONTENT.balance.shop.rarityWeights as Record<string, number>;
  return w[r] ?? 1;
}

function tierOf(partId: string | undefined): Tier {
  if (!partId) return 'stock';
  return CONTENT.parts.find((p) => p.id === partId)?.tier ?? 'stock';
}

/**
 * How welcome a part is over what's installed in its slot: upgrade 1, same-tier swap (another brand) 0.5,
 * downgrade 0.12. A part that advances a set you're building (2+ of its brand installed, slot not yet that brand)
 * counts as at least a swap, so lower-tier sets stay finishable after you've upgraded past them.
 */
function upgradeFactor(state: RunState, p: PartDef, owned?: Record<string, number>): number {
  const instId = state.parts[p.slot]?.partId;
  const inst = TIER_RANK[tierOf(instId)];
  const r = TIER_RANK[p.tier];
  const f = r > inst ? 1 : r === inst ? 0.5 : 0.12;
  if (f < 0.5 && p.brand && (owned ?? ownedByBrand(state))[p.brand] >= 2) {
    const instBrand = CONTENT.parts.find((x) => x.id === instId)?.brand;
    if (instBrand !== p.brand) return 0.5;
  }
  return f;
}

/** Installed part count per brand (local, avoids a cycle with brands.ts). */
function ownedByBrand(state: RunState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const ip of Object.values(state.parts ?? {})) {
    const b = CONTENT.parts.find((p) => p.id === ip.partId)?.brand;
    if (b) out[b] = (out[b] ?? 0) + 1;
  }
  return out;
}

/**
 * Brand-biased pick inside one tier: roll the brand (weight 1 + bias x owned, only brands with a candidate),
 * then a part of that brand weighted by upgradeFactor. Null if the tier has no candidate.
 */
function rollInTier(state: RunState, rng: Rng, cands: PartDef[]): PartDef | null {
  if (!cands.length) return null;
  const owned = ownedByBrand(state);
  const bias = brandBias(state);
  const brands = [...new Set(cands.map((p) => p.brand ?? ''))];
  const brand = rng.weighted(brands, brands.map((b) => 1 + bias * (owned[b] ?? 0)));
  const inBrand = cands.filter((p) => (p.brand ?? '') === brand);
  return rng.weighted(inBrand, inBrand.map((p) => upgradeFactor(state, p, owned)));
}

/**
 * Roll one part. Never the installed part, never one in `exclude` (part ids) or in `excludeSlots`.
 * Tier from tierOdds(round); brand within the tier biased toward brands you run (brandBias).
 * If the rolled tier only has downgrades for you, the other tiers are tried (most likely first) before falling back.
 */
export function rollPart(
  state: RunState,
  rng: Rng,
  exclude: Set<string>,
  excludeSlots: Set<string> = new Set(),
): PartDef | null {
  const odds = tierOdds(state.round);
  const rolled = rng.weighted([...SHOP_TIERS], SHOP_TIERS.map((t) => odds[t]));
  const order: ShopTier[] = [rolled, ...SHOP_TIERS.filter((t) => t !== rolled).sort((a, b) => odds[b] - odds[a] || TIER_RANK[b] - TIER_RANK[a])];
  const candsOf = (tier: ShopTier) =>
    CONTENT.parts.filter((p) => {
      if (p.tier !== tier || exclude.has(p.id) || excludeSlots.has(p.slot)) return false;
      return state.parts[p.slot]?.partId !== p.id;
    });
  const owned = ownedByBrand(state);
  for (const tier of order) {
    const good = candsOf(tier).filter((p) => upgradeFactor(state, p, owned) >= 0.5);
    if (good.length) return rollInTier(state, rng, good);
  }
  for (const tier of order) {
    const p = rollInTier(state, rng, candsOf(tier));
    if (p) return p;
  }
  return null;
}

/** Roll a passive the player doesn't own and that isn't in `exclude`. */
export function rollPassive(state: RunState, rng: Rng, exclude: Set<string>): string | null {
  const cands = CONTENT.passives.filter((p) => !state.passives.includes(p.id) && !exclude.has(p.id));
  if (!cands.length) return null;
  return rng.weighted(cands, cands.map((p) => rarityWeight(p.rarity))).id;
}

export function rollConsumable(rng: Rng, exclude: Set<string>, banned: Set<string> = new Set()): string | null {
  const allowed = CONTENT.consumables.filter((c) => !banned.has(c.id));
  let cands = allowed.filter((c) => !exclude.has(c.id));
  if (!cands.length) cands = allowed.slice();
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
  const banned = bannedConsumables(state);
  for (const c of CONTENT.consumables) {
    if (taken.has(c.id) || banned.has(c.id)) continue;
    pool.push({ kind: 'consumable', id: c.id, w: rarityWeight(c.rarity) });
  }
  if (!pool.length) return null;
  const pick = rng.weighted(pool, pool.map((c) => c.w));
  taken.add(pick.id);
  let it: ShopItem;
  if (pick.kind === 'passive') it = { kind: 'passive', passiveId: pick.id, price: 0, sold: false, edition: rollEdition(rng) };
  else it = { kind: 'consumable', consumableId: pick.id, price: 0, sold: false };
  it.price = itemPrice(state, it);
  return it;
}

/** Extra Shelf +1 / Showroom +2 loose items: the first extra is a powerup, the second a part. */
export function shopSize(state: RunState): { parts: number; powerups: number } {
  const extra = owns(state, 'showroom') ? 2 : owns(state, 'extra_shelf') ? 1 : 0;
  return { parts: 2 + (extra >= 2 ? 1 : 0), powerups: 2 + (extra >= 1 ? 1 : 0) };
}

/** The loose items: parts then powerups (2 + 2 normally; garage adds more). */
export function rollItems(state: RunState, rng: Rng): ShopItem[] {
  const size = shopSize(state);
  const items: ShopItem[] = [];
  const takenParts = new Set<string>();
  const takenSlots = new Set<string>();
  for (let i = 0; i < size.parts; i++) {
    const p = rollPart(state, rng, takenParts, takenSlots);
    if (!p) continue;
    takenParts.add(p.id);
    takenSlots.add(p.slot);
    const it: ShopItem = { kind: 'part', partId: p.id, price: 0, sold: false };
    it.price = itemPrice(state, it);
    items.push(it);
  }
  const taken = new Set<string>();
  for (let i = 0; i < size.powerups; i++) {
    const it = rollPowerup(state, rng, taken);
    if (it) items.push(it);
  }
  return items;
}

/** A fresh shop. `firstOfRound` adds the garage offer. Tags are applied by the caller (game.ts). */
export function makeShop(state: RunState, rng: Rng, freePack: boolean, firstOfRound = false): ShopState {
  const items = rollItems(state, rng);
  let garageOffer: ShopState['garageOffer'] = null;
  if (firstOfRound) {
    const g = rollGarage(state, rng);
    if (g) garageOffer = { id: g.id, price: garagePrice(state, g.cost), sold: false };
  }
  return {
    items,
    packs: [
      { kind: 'parts', price: packPrice(state, 'parts'), sold: false },
      { kind: 'power', price: freePack ? 0 : packPrice(state, 'power'), sold: false },
    ],
    rerollCost: rerollPrice(state, 0),
    openPack: null,
    freePack,
    garageOffer,
    freeRerolls: owns(state, 'reroll_glut') ? 1 : 0,
    paidRerolls: 0,
    entryLines: [],
  };
}

/** Back Room tag: a Pro part at 50% off, brand-biased (null if none left). */
export function rollDealPart(state: RunState, rng: Rng, exclude: Set<string>): ShopItem | null {
  const cands = CONTENT.parts.filter((p) => p.tier === 'pro' && !exclude.has(p.id) && state.parts[p.slot]?.partId !== p.id);
  const p = rollInTier(state, rng, cands);
  if (!p) return null;
  const it: ShopItem = { kind: 'part', partId: p.id, price: 0, sold: false, deal: true };
  it.price = itemPrice(state, it);
  return it;
}

/** Pack Hoarder: packs show 4 cards. */
export const packSize = (state: RunState) => (owns(state, 'pack_hoarder') ? 4 : 3);
/** Pack Rat: pick 2. */
export const packPicks = (state: RunState) => (owns(state, 'pack_rat') ? 2 : 1);

export function rollPartsPack(state: RunState, rng: Rng): PackCard[] {
  const cards: PackCard[] = [];
  const taken = new Set<string>();
  const slots = new Set<string>();
  for (let i = 0; i < packSize(state); i++) {
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
  const banned = bannedConsumables(state);
  for (let i = 0; i < packSize(state); i++) {
    const r = rng.next() * total;
    let card: PackCard | null = null;
    if (r < odds.passive) {
      const id = rollPassive(state, rng, takenPassives);
      if (id) {
        takenPassives.add(id);
        card = { kind: 'passive', passiveId: id, edition: rollEdition(rng) };
      }
    } else if (r >= odds.passive + odds.consumable) {
      card = { kind: 'tuning' };
    }
    if (!card) {
      const id = rollConsumable(rng, takenConsumables, banned);
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

