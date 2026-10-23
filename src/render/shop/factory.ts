// Builds Cards for shop items, pack cards and inventory.
import Phaser from 'phaser';
import type { BrandDef, Edition, InstalledPart, PackCard, ShopItem, SlotId, Tier } from '../../core/types';
import { game } from '../../game/game';
import { brandById, brandCounts } from '../../game/brands';
import { PAL, RARITY_COLOR, TIER_COLOR, TIER_LABEL } from '../palette';
import * as icons from '../icons';
import { SLOT_SHORT, consumableIcon, passiveIcon, slotIcon } from '../icons';
import { Card, type CardBrand } from './card';
import { garageIconKey, txt } from '../ui';

const PASSIVE_ACCENT = { common: PAL.blue, uncommon: PAL.teal, rare: PAL.pink } as const;
const CONS_ACCENT = { common: PAL.green, uncommon: PAL.teal, rare: PAL.pink } as const;
const PART_ACCENT: Record<Tier, number> = { stock: 0x6b6680, street: TIER_COLOR.street, sport: TIER_COLOR.sport, pro: TIER_COLOR.pro };

type Kindish = { kind: 'part'; partId: string } | { kind: 'passive'; passiveId: string; edition?: Edition | null } | { kind: 'consumable'; consumableId: string } | { kind: 'tuning' };

export function cardFor(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  what: Kindish,
  price?: number | null,
  iconScale = 2,
): Card {
  switch (what.kind) {
    case 'part': {
      const d = game.part(what.partId);
      const b = d.brand ? brandInfo(d.brand) : null;
      const accent = PART_ACCENT[d.tier] ?? PAL.panelEdge;
      if (!b) return new Card(scene, x, y, { w, h, accent, band: SLOT_SHORT[d.slot], icon: slotIcon(d.slot), iconScale, name: d.name, price });
      // the band already says the brand: drop it from the name so the part's own name fits
      const short = d.name.toLowerCase().startsWith(b.name.toLowerCase() + ' ') ? d.name.slice(b.name.length + 1) : d.name;
      return new Card(scene, x, y, { w, h, accent, icon: slotIcon(d.slot), iconScale, name: short, price, brand: cardBrand(scene, b, d.tier, what.partId, w) });
    }
    case 'passive': {
      const d = game.passive(what.passiveId);
      return new Card(scene, x, y, {
        w, h, accent: PASSIVE_ACCENT[d.rarity] ?? RARITY_COLOR[d.rarity], band: 'PASSIVE',
        icon: passiveIcon(scene, d.id, d.name), iconScale, name: d.name, price, edition: what.edition ?? null,
      });
    }
    case 'consumable': {
      const d = game.consumable(what.consumableId);
      return new Card(scene, x, y, {
        w, h, accent: CONS_ACCENT[d.rarity] ?? RARITY_COLOR[d.rarity], band: '1 RACE',
        icon: consumableIcon(scene, d.id, d.name), iconScale, name: d.name, price,
      });
    }
    default:
      return new Card(scene, x, y, { w, h, accent: PAL.yellow, band: 'TUNING', icon: 'tuning', iconScale, name: 'Tuning Card', price });
  }
}

export const shopItemCard = (scene: Phaser.Scene, x: number, y: number, it: ShopItem) =>
  cardFor(scene, x, y, 64, 92, it as Kindish, it.price);

export const packCardCard = (scene: Phaser.Scene, x: number, y: number, c: PackCard) => cardFor(scene, x, y, 84, 112, c, null, 3);

/** Small inventory card: big icon, no name (tooltip has it). */
export function passiveSlotCard(scene: Phaser.Scene, x: number, y: number, id: string, order: number, edition: Edition | null = null): Card {
  const d = game.passive(id);
  return new Card(scene, x, y, {
    w: 44, h: 60, accent: PASSIVE_ACCENT[d.rarity] ?? PAL.blue, icon: passiveIcon(scene, d.id, d.name), iconScale: 2,
    corner: String(order), edition,
  });
}

/** Garage upgrade (voucher) card: blue for tier 1, purple for tier 2. */
export function garageCard(scene: Phaser.Scene, x: number, y: number, id: string, price: number | null): Card {
  const d = game.garageUpgrade(id);
  return new Card(scene, x, y, {
    w: 64, h: 84, accent: d.tier === 2 ? PAL.purple : PAL.blue, band: d.tier === 2 ? 'TIER2' : 'GARAGE', fill: 0x1a2040,
    icon: garageIconKey(scene, id), iconScale: 2, name: d.name, price,
  });
}

export function consumableSlotCard(scene: Phaser.Scene, x: number, y: number, id: string): Card {
  const d = game.consumable(id);
  return new Card(scene, x, y, {
    w: 44, h: 60, accent: CONS_ACCENT[d.rarity] ?? PAL.green, icon: consumableIcon(scene, d.id, d.name), iconScale: 2,
  });
}

/** Where a picked/bought thing lands, for fly-to animations. */
export function iconKeyFor(scene: Phaser.Scene, what: Kindish): string {
  if (what.kind === 'part') return slotIcon(game.part(what.partId).slot);
  if (what.kind === 'passive') return passiveIcon(scene, what.passiveId, game.passive(what.passiveId).name);
  if (what.kind === 'consumable') return consumableIcon(scene, what.consumableId, game.consumable(what.consumableId).name);
  return 'tuning';
}

// ---------------------------------------------------------------------------------------------
// Brands: lookups + logos + chips shared by the shop, pack overlay, staging, result and victory.

export interface BrandInfo {
  id: string;
  name: string;
  tier: Exclude<Tier, 'stock'>;
  color: number;
  accent: number;
  /** Readable text colour on a `color` fill. */
  ink: number;
  def: BrandDef | null;
}

export const colNum = (c: string | number | undefined, dflt: number): number => {
  if (typeof c === 'number') return c;
  if (!c) return dflt;
  const n = parseInt(c.replace('#', '').replace(/^0x/i, ''), 16);
  return Number.isFinite(n) ? n : dflt;
};
const luma = (c: number) => ((c >> 16) & 255) * 0.299 + ((c >> 8) & 255) * 0.587 + (c & 255) * 0.114;
export const inkOn = (c: number) => (luma(c) > 150 ? PAL.bgDeep : PAL.ink);

const brandCache = new Map<string, BrandInfo>();
/** Brand by id with its colours as numbers. Falls back to a name from the id + tier colour until brands.json loads. */
export function brandInfo(id: string | null | undefined): BrandInfo | null {
  if (!id) return null;
  const hit = brandCache.get(id);
  if (hit) return hit;
  const def = safeGet(() => brandById(id)) ?? undefined;
  const tier = def?.tier ?? partTierOfBrand(id);
  const color = colNum(def?.color, TIER_COLOR[tier]);
  const info: BrandInfo = {
    id,
    name: def?.name ?? id.charAt(0).toUpperCase() + id.slice(1),
    tier,
    color,
    accent: colNum(def?.accent, PAL.ink),
    ink: inkOn(color),
    def: def ?? null,
  };
  if (def) brandCache.set(id, info); // only cache real data so the stub period never sticks
  return info;
}

function partTierOfBrand(id: string): Exclude<Tier, 'stock'> {
  for (const ip of Object.values(game.state?.parts ?? {})) {
    const d = safeGet(() => game.part(ip.partId));
    if (d?.brand === id && d.tier !== 'stock') return d.tier;
  }
  return 'street';
}

/** The paragon of a brand (null until brands.json is in). */
export const paragonOf = (id: string | null | undefined) => brandInfo(id)?.def?.paragon ?? null;

export function ownedCounts(parts: Record<SlotId, InstalledPart> = game.state.parts): Record<string, number> {
  return safeGet(() => brandCounts(parts)) ?? {};
}

/** Owned brands, most parts first. */
export function ownedBrands(parts: Record<SlotId, InstalledPart> = game.state.parts): { id: string; n: number }[] {
  return Object.entries(ownedCounts(parts))
    .map(([id, n]) => ({ id, n }))
    .sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));
}

/** What installing `partId` does to the sets: its brand's count now / after, and the brand it would knock a part off. */
export function offerSetDelta(partId: string): { brand: string; now: number; after: number; breaks: { brand: string; now: number } | null } | null {
  const d = safeGet(() => game.part(partId));
  if (!d?.brand) return null;
  const counts = ownedCounts();
  const cur = safeGet(() => game.part(game.state.parts[d.slot].partId));
  const now = counts[d.brand] ?? 0;
  const same = cur?.brand === d.brand;
  const after = same ? now : now + 1;
  const breaks = cur?.brand && !same ? { brand: cur.brand, now: counts[cur.brand] ?? 0 } : null;
  return { brand: d.brand, now, after, breaks };
}

function safeGet<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

/** Texture key of a brand logo from icons.ts (Abilities agent), or null when there is none yet. */
export function brandLogoKey(scene: Phaser.Scene, id: string): string | null {
  const mod = icons as unknown as Record<string, unknown>;
  const fn = mod.brandIcon ?? mod.brandLogo ?? mod.brandLogoKey;
  if (typeof fn === 'function') {
    const k = safeGet(() => (fn as (s: Phaser.Scene, id: string) => string)(scene, id));
    if (k && scene.textures.exists(k)) return k;
  }
  for (const k of [`brand_${id}`, `logo_${id}`]) if (scene.textures.exists(k)) return k;
  return null;
}

/** Brand logo centred at (x, y), about `size` px: the real logo when icons.ts has one, else a coloured initial badge. */
export function brandLogo(scene: Phaser.Scene, x: number, y: number, id: string, size = 10): Phaser.GameObjects.GameObject[] {
  const b = brandInfo(id);
  const key = brandLogoKey(scene, id);
  x = Math.round(x);
  y = Math.round(y);
  if (key) {
    const img = scene.add.image(x, y, key);
    const m = Math.max(img.width, img.height) || size;
    img.setScale(m >= size ? size / m : Math.max(1, Math.floor(size / m)));
    return [img];
  }
  const g = scene.add.graphics();
  const h = Math.floor(size / 2);
  g.fillStyle(PAL.bgDeep, 1).fillRect(x - h + 1, y - h + 1, size, size);
  g.fillStyle(b?.color ?? PAL.panelEdge, 1).fillRect(x - h, y - h, size, size);
  g.fillStyle(b?.accent ?? PAL.ink, 1).fillRect(x - h, y + size - h - 2, size, 2);
  if (size < 10) return [g];
  return [g, txt(scene, x + 1, y, (b?.name ?? id).charAt(0).toUpperCase(), 8, b?.ink ?? PAL.ink, [0.5, 0.5])];
}

/** Card spec bits for a brand part: brand band + logo, tier line, set progress (glowing "+1 BRAND" when it advances a set you own). */
function cardBrand(scene: Phaser.Scene, b: BrandInfo, tier: Tier, partId: string, w: number): CardBrand {
  const delta = offerSetDelta(partId);
  const now = delta?.now ?? 0;
  const after = delta?.after ?? now;
  const advances = !!delta && after > now && now > 0;
  const brk = delta?.breaks && delta.breaks.now >= 2 ? brandInfo(delta.breaks.brand) : null;
  return {
    name: b.name.toUpperCase(),
    color: b.color,
    ink: b.ink,
    logo: brandLogoKey(scene, b.id),
    tier: TIER_LABEL[tier],
    tierColor: TIER_COLOR[tier],
    progress: `${advances ? after : now}/12`,
    advance: advances ? (after >= 12 ? 'PARAGON!' : plusLabel(b.name.toUpperCase(), after, Math.floor((w + 4) / 8))) : null,
    breaks: brk ? `-1 ${brk.name.toUpperCase()}` : null,
  };
}

/** '+1 MALIBRU' when it fits the chip, else '+1 5/12'. */
const plusLabel = (name: string, after: number, maxC: number) => (`+1 ${name}`.length <= maxC ? `+1 ${name}` : `+1 ${after}/12`);
