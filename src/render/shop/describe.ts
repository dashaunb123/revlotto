// Tooltip text for parts / passives / consumables / tuning cards, shared by Shop, pack overlay and menus.
import type { CarStats, PackCard, PartDef, ShopItem, SlotId, StatKey } from '../../core/types';
import { game } from '../../game/game';
import { PAL, RARITY_COLOR, TIER_COLOR } from '../palette';
import { SLOT_NAME } from '../icons';
import type { TipLine } from '../ui';

export const STAT_LABEL: Record<StatKey, string> = {
  power: 'POWER',
  grip: 'GRIP',
  weight: 'WEIGHT',
  gearing: 'GEARING',
  drag: 'DRAG',
  shiftWindow: 'SHIFT WIN',
  nitroPower: 'NOS POWER',
  nitroDuration: 'NOS TIME',
};

const STAT_ORDER: StatKey[] = ['power', 'grip', 'weight', 'gearing', 'drag', 'shiftWindow', 'nitroPower', 'nitroDuration'];

/** Lower is better for these. */
export const LOWER_BETTER: Partial<Record<StatKey, true>> = { weight: true, drag: true };

export function fmtStat(k: StatKey, v: number): string {
  switch (k) {
    case 'power':
    case 'nitroPower':
      return `${Math.round(v)}`;
    case 'weight':
      return `${Math.round(v)}KG`;
    case 'nitroDuration':
      return `${v.toFixed(1)}S`;
    default:
      return v.toFixed(2);
  }
}

function fmtDelta(k: StatKey, d: number): string {
  const sign = d > 0 ? '+' : '-';
  const a = Math.abs(d);
  switch (k) {
    case 'power':
    case 'nitroPower':
      return `${sign}${Math.round(a)}`;
    case 'weight':
      return `${sign}${Math.round(a)}KG`;
    case 'nitroDuration':
      return `${sign}${a.toFixed(1)}S`;
    default:
      return `${sign}${a.toFixed(2)}`;
  }
}

export const isGood = (k: StatKey, d: number) => (LOWER_BETTER[k] ? d < 0 : d > 0);

const tuneMult = (level: number) => 1 + level * 0.1;

/** Effective stat contribution of a part at a tuning level. */
export function partStats(def: PartDef, level = 0): Partial<CarStats> {
  const out: Partial<CarStats> = {};
  for (const k of STAT_ORDER) {
    const v = def.stats[k];
    if (v) out[k] = v * tuneMult(level);
  }
  return out;
}

/** Lines like "+70 POWER" for a stat bag. */
export function statLines(stats: Partial<CarStats>): TipLine[] {
  const out: TipLine[] = [];
  for (const k of STAT_ORDER) {
    const v = stats[k];
    if (!v || Math.abs(v) < 1e-6) continue;
    out.push({ t: `${fmtDelta(k, v)} ${STAT_LABEL[k]}`, c: isGood(k, v) ? PAL.green : PAL.red });
  }
  return out;
}

/** Diff of two stat bags (new - old). */
export function diffLines(next: Partial<CarStats>, prev: Partial<CarStats>): TipLine[] {
  const d: Partial<CarStats> = {};
  for (const k of STAT_ORDER) {
    const v = (next[k] ?? 0) - (prev[k] ?? 0);
    if (Math.abs(v) > 1e-6) d[k] = v;
  }
  const lines = statLines(d);
  return lines.length ? lines : [{ t: 'NO STAT CHANGE', c: PAL.inkDim }];
}

const quirkName = (q: string) => q.replace(/_/g, ' ').toUpperCase();

export interface Tip {
  title: string;
  color: number;
  lines: TipLine[];
}

/** Tooltip for an installed part tile. */
export function installedPartTip(slot: SlotId): Tip {
  const ip = game.state.parts[slot];
  const def = game.part(ip.partId);
  const lines: TipLine[] = [{ t: `${def.tier.toUpperCase()} ${SLOT_NAME[slot]}`, c: TIER_COLOR[def.tier] }];
  if (def.tier !== 'stock') lines.push({ t: `TUNE LV ${ip.level}/3`, c: PAL.yellow });
  const sl = statLines(partStats(def, ip.level));
  lines.push(...(sl.length ? sl : [{ t: 'NO BONUS', c: PAL.inkDim }]));
  if (def.quirk) lines.push({ t: `QUIRK: ${quirkName(def.quirk)}`, c: PAL.orange });
  if (def.desc) lines.push('', { t: def.desc, c: PAL.inkDim });
  lines.push('');
  if (def.tier === 'stock') lines.push({ t: 'STOCK: NOTHING TO SELL', c: PAL.inkDim });
  else {
    lines.push({ t: `SELL VALUE $${game.partSellValue(slot)}`, c: PAL.yellow });
    lines.push({ t: 'CLICK: SELL / TUNE', c: PAL.inkDim });
  }
  return { title: def.name, color: TIER_COLOR[def.tier], lines };
}

/** Tooltip for a part being offered (shop card or pack card): shows what it replaces and the diff. */
export function offerPartTip(partId: string, price?: number): Tip {
  const def = game.part(partId);
  const cur = game.state.parts[def.slot];
  const curDef = game.part(cur.partId);
  const lines: TipLine[] = [{ t: `${def.tier.toUpperCase()} ${SLOT_NAME[def.slot]}`, c: TIER_COLOR[def.tier] }];
  lines.push(...statLines(partStats(def)));
  if (def.quirk) lines.push({ t: `QUIRK: ${quirkName(def.quirk)}`, c: PAL.orange });
  if (def.desc) lines.push({ t: def.desc, c: PAL.inkDim });
  lines.push('', { t: `REPLACES ${curDef.name.toUpperCase()}${cur.level ? ` LV${cur.level}` : ''}`, c: PAL.ink });
  if (cur.partId === partId) lines.push({ t: 'ALREADY INSTALLED', c: PAL.red });
  else {
    lines.push(...diffLines(partStats(def), partStats(curDef, cur.level)));
    const refund = game.partSellValue(def.slot);
    if (refund > 0) lines.push({ t: `OLD PART SELLS +$${refund}`, c: PAL.yellow });
  }
  if (price !== undefined) lines.push('', { t: price === 0 ? 'FREE' : `PRICE $${price}`, c: PAL.yellow });
  return { title: def.name, color: TIER_COLOR[def.tier], lines };
}

const TRIGGER_TEXT: Record<string, string> = {
  always: 'ALWAYS ON',
  race_start: 'AT RACE START',
  launch: 'ON LAUNCH',
  shift: 'ON EACH SHIFT',
  finish: 'AT THE FINISH',
};

export function passiveTip(id: string, extra: TipLine[] = []): Tip {
  const def = game.passive(id);
  return {
    title: def.name,
    color: RARITY_COLOR[def.rarity],
    lines: [
      { t: `PASSIVE  ${def.rarity.toUpperCase()}`, c: RARITY_COLOR[def.rarity] },
      { t: def.desc },
      { t: TRIGGER_TEXT[def.trigger] ?? def.trigger.toUpperCase(), c: PAL.teal },
      ...extra,
    ],
  };
}

export function consumableTip(id: string, extra: TipLine[] = []): Tip {
  const def = game.consumable(id);
  return {
    title: def.name,
    color: RARITY_COLOR[def.rarity],
    lines: [
      { t: `CONSUMABLE  ${def.rarity.toUpperCase()}`, c: RARITY_COLOR[def.rarity] },
      { t: def.desc },
      { t: 'USE AT STAGING, ONE RACE', c: PAL.teal },
      ...extra,
    ],
  };
}

export function tuningTip(extra: TipLine[] = []): Tip {
  return {
    title: 'Tuning Card',
    color: PAL.yellow,
    lines: [
      { t: 'Apply to an installed non-Stock part: +1 level (max 3).' },
      { t: 'Each level: +10% of that part\'s stats.', c: PAL.green },
      ...extra,
    ],
  };
}

export function shopItemTip(item: ShopItem): Tip {
  const price: TipLine[] = ['', { t: `PRICE $${item.price}`, c: PAL.yellow }];
  if (item.kind === 'part') return offerPartTip(item.partId, item.price);
  if (item.kind === 'passive') return passiveTip(item.passiveId, price);
  return consumableTip(item.consumableId, price);
}

export function packCardTip(card: PackCard): Tip {
  if (card.kind === 'part') return offerPartTip(card.partId);
  if (card.kind === 'passive') return passiveTip(card.passiveId);
  if (card.kind === 'consumable') return consumableTip(card.consumableId);
  return tuningTip();
}

/** One-line short description used under pack cards. */
export function shortDesc(card: PackCard): string {
  if (card.kind === 'part') {
    const def = game.part(card.partId);
    const cur = game.state.parts[def.slot];
    const parts = Object.entries(partStats(def))
      .map(([k, v]) => `${fmtDelta(k as StatKey, v as number)} ${STAT_LABEL[k as StatKey]}`)
      .join(' ');
    return `${parts}${def.quirk ? ' ' + quirkName(def.quirk) : ''}. REPLACES ${game.part(cur.partId).name}`;
  }
  if (card.kind === 'passive') return game.passive(card.passiveId).desc;
  if (card.kind === 'consumable') return game.consumable(card.consumableId).desc;
  return 'Apply to a part: +1 tune level (+10% stats).';
}
