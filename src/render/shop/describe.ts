// Tooltip text for parts / passives / consumables / tuning cards, shared by Shop, pack overlay and menus.
import type { CarStats, Edition, PackCard, PartDef, ShopItem, SlotId, StatKey, Tier } from '../../core/types';
import { EDITION_TEXT, paragonAbility, passiveStatus } from '../../game/effects';
import { SET_STEPS, brandById, brandCounts } from '../../game/brands';
import { game } from '../../game/game';
import { PAL, RARITY_COLOR, TIER_COLOR, TIER_LABEL } from '../palette';
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

/** Tuning bonus per level (Master Tuner garage upgrade raises it). */
export const tunePerLevel = () => (game.state.garage?.includes('master_tuner') ? 0.15 : 0.1);
const tuneMult = (level: number) => 1 + level * tunePerLevel();

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

// ---------- Brands, sets and paragons ----------

const TIER_FALLBACK: Record<Tier, number> = { stock: PAL.inkDim, street: PAL.teal, sport: PAL.purple, pro: PAL.orange };
/** Tier colour (safe for every tier, including sport). */
export const tierColor = (t: Tier): number => (TIER_COLOR as Partial<Record<Tier, number>>)[t] ?? TIER_FALLBACK[t];
export const tierLabel = (t: Tier): string => (TIER_LABEL as Partial<Record<Tier, string>>)[t] ?? t.toUpperCase();

/** '#ff8800' / '0xff8800' / 'ff8800' -> 0xff8800 (null if unparsable). */
function parseColor(c: string | undefined): number | null {
  if (!c) return null;
  const n = parseInt(c.replace(/^#|^0x/i, ''), 16);
  return Number.isFinite(n) ? n : null;
}

/** Brand colour as a Phaser number (falls back to the brand's tier colour, then ink). */
export function brandColor(id: string): number {
  const b = brandById(id);
  return parseColor(b?.color) ?? (b ? tierColor(b.tier) : PAL.ink);
}
export function brandAccent(id: string): number {
  const b = brandById(id);
  return parseColor(b?.accent) ?? brandColor(id);
}
export const brandName = (id: string) => (brandById(id)?.name ?? id).toUpperCase();

const multGood = (k: StatKey, m: number) => (LOWER_BETTER[k] ? m < 1 : m > 1);

/** Lines like "POWER x1.35" for a stat-multiplier bag. */
export function multLines(mult: Partial<CarStats>, dim = false): TipLine[] {
  const out: TipLine[] = [];
  for (const k of STAT_ORDER) {
    const m = mult[k];
    if (m === undefined || Math.abs(m - 1) < 1e-6) continue;
    out.push({ t: `${STAT_LABEL[k]} x${m.toFixed(2)}`, c: dim ? PAL.inkDim : multGood(k, m) ? PAL.green : PAL.red });
  }
  return out;
}
const STAT_SHORT: Record<StatKey, string> = {
  power: 'PWR',
  grip: 'GRIP',
  weight: 'KG',
  gearing: 'GEAR',
  drag: 'DRAG',
  shiftWindow: 'SHIFT',
  nitroPower: 'NOS',
  nitroDuration: 'NOS T',
};
/** "PWR x1.06 GRIP x1.10" */
export const multText = (mult: Partial<CarStats>) =>
  STAT_ORDER.filter((k) => mult[k] !== undefined && Math.abs((mult[k] as number) - 1) > 1e-6)
    .map((k) => `${STAT_SHORT[k]} x${(mult[k] as number).toFixed(2)}`)
    .join(' ');

/** "MALIBRU STREET ENGINE" in the brand colour (or "STOCK ENGINE"). */
function partHeadLine(def: PartDef): TipLine {
  if (!def.brand) return { t: `${tierLabel(def.tier)} ${SLOT_NAME[def.slot]}`, c: tierColor(def.tier) };
  return { t: `${brandName(def.brand)} ${tierLabel(def.tier)} ${SLOT_NAME[def.slot]}`, c: brandColor(def.brand) };
}
const partTitleColor = (def: PartDef) => (def.brand ? brandColor(def.brand) : tierColor(def.tier));

/** Next set step above n (4, 8, 12) or null when complete. */
export const nextSetStep = (n: number): number | null => SET_STEPS.find((x) => x > n) ?? null;

/** Short progress line: "MALIBRU 5/12, NEXT BONUS AT 8" / "... PARAGON AT 12" / "MALIBRU SS ACTIVE". */
export function setProgressText(brandId: string, n: number): string {
  const b = brandById(brandId);
  const next = nextSetStep(n);
  const head = `${brandName(brandId)} ${n}/12`;
  if (next === null) return `${head}, ${(b?.paragon.name ?? 'PARAGON').toUpperCase()} ACTIVE`;
  return next === 12 ? `${head}, PARAGON AT 12` : `${head}, NEXT BONUS AT ${next}`;
}

/**
 * Set block for tooltips: progress line, then the 4 / 8 / paragon bonuses (active ones bright).
 * `before`: count before this offer, to show "5/12 > 6/12".
 */
export function brandSetLines(brandId: string, n: number, before?: number, full = false): TipLine[] {
  const b = brandById(brandId);
  const col = brandColor(brandId);
  const prog = setProgressText(brandId, n);
  const lines: TipLine[] = [{ t: before !== undefined ? `${brandName(brandId)} ${before}/12 > ${prog.slice(brandName(brandId).length + 1)}` : prog, c: col }];
  if (!b) return lines;
  const on = (step: number) => n >= step;
  const set = (st: { desc: string; mult: Partial<CarStats> }) => (full && st.desc ? st.desc : multText(st.mult) || st.desc);
  lines.push({ t: `4: ${set(b.set4)}`, c: on(4) ? PAL.green : PAL.inkDim });
  lines.push({ t: `8: ${set(b.set8)}`, c: on(8) ? PAL.green : PAL.inkDim });
  const ab = paragonAbility(b.paragon.ability);
  const abName = (ab?.name ?? b.paragon.ability).toUpperCase();
  lines.push({ t: `12: ${b.paragon.name.toUpperCase()} + ${abName}`, c: on(12) ? PAL.yellow : PAL.inkDim });
  if (full) lines.push({ t: ab?.desc || b.paragon.abilityDesc || '', c: on(12) ? PAL.yellow : PAL.inkDim });
  return lines;
}

/** Warnings / fanfare for installing `next` over `cur`: completing or breaking a set step. */
function setChangeLines(next: PartDef, cur: PartDef): TipLine[] {
  const counts = brandCounts(game.state.parts);
  const out: TipLine[] = [];
  if (cur.brand && cur.brand !== next.brand) {
    const n = counts[cur.brand] ?? 0;
    const lost = [...SET_STEPS].reverse().find((st) => n >= st && n - 1 < st);
    if (lost === 12) out.push({ t: `BREAKS ${(brandById(cur.brand)?.paragon.name ?? 'PARAGON').toUpperCase()}!`, c: PAL.red });
    else if (lost) out.push({ t: `BREAKS ${brandName(cur.brand)} ${lost}-SET`, c: PAL.red });
  }
  if (next.brand && next.brand !== cur.brand) {
    const n = (counts[next.brand] ?? 0) + 1;
    if (n === 12) out.push({ t: `TRANSFORMS INTO ${(brandById(next.brand)?.paragon.name ?? 'PARAGON').toUpperCase()}!`, c: PAL.yellow });
    else if (n === 4 || n === 8) out.push({ t: `COMPLETES ${brandName(next.brand)} ${n}-SET!`, c: PAL.green });
  }
  return out;
}

/** Tooltip for a brand's paragon (set panel, transform screen, staging). */
export function paragonTip(brandId: string, extra: TipLine[] = []): Tip {
  const b = brandById(brandId);
  const col = brandColor(brandId);
  const n = brandCounts(game.state.parts)[brandId] ?? 0;
  if (!b) return { title: `${brandName(brandId)} PARAGON`, color: col, lines: [{ t: `${n}/12 PARTS`, c: PAL.inkDim }, ...extra] };
  const ab = paragonAbility(b.paragon.ability);
  const lines: TipLine[] = [
    { t: `${brandName(brandId)} ${tierLabel(b.tier)} PARAGON`, c: col },
    { t: b.paragon.desc },
    '',
    { t: `ABILITY: ${(ab?.name ?? b.paragon.ability).toUpperCase()}`, c: PAL.yellow },
    { t: ab?.desc || b.paragon.abilityDesc || '' },
    '',
    ...multLines(b.paragon.mult),
    '',
    n >= 12 ? { t: 'TRANSFORMED: ACTIVE', c: PAL.yellow } : { t: `${n}/12 ${brandName(brandId)} PARTS INSTALLED`, c: PAL.inkDim },
    { t: 'SELL OR REPLACE ONE AND IT TURNS OFF', c: PAL.inkDim },
    ...extra,
  ];
  return { title: b.paragon.name, color: col, lines };
}

/** Tooltip for a brand chip / set panel row: progress plus every bonus. */
export function brandTip(brandId: string, extra: TipLine[] = []): Tip {
  const b = brandById(brandId);
  const n = brandCounts(game.state.parts)[brandId] ?? 0;
  const lines: TipLine[] = [];
  if (b) lines.push({ t: `${tierLabel(b.tier)} BRAND`, c: tierColor(b.tier) });
  lines.push(...brandSetLines(brandId, n, undefined, true), ...extra);
  return { title: b?.name ?? brandName(brandId), color: brandColor(brandId), lines };
}

export interface Tip {
  title: string;
  color: number;
  lines: TipLine[];
}

/** Tooltip for an installed part tile. */
export function installedPartTip(slot: SlotId): Tip {
  const ip = game.state.parts[slot];
  const def = game.part(ip.partId);
  const lines: TipLine[] = [partHeadLine(def)];
  if (def.tier !== 'stock') lines.push({ t: `TUNE LV ${ip.level}/3`, c: PAL.yellow });
  const sl = statLines(partStats(def, ip.level));
  lines.push(...(sl.length ? sl : [{ t: 'NO BONUS', c: PAL.inkDim }]));
  if (def.quirk) lines.push({ t: `QUIRK: ${quirkName(def.quirk)}`, c: PAL.orange });
  if (def.desc) lines.push('', { t: def.desc, c: PAL.inkDim });
  if (def.brand) lines.push('', ...brandSetLines(def.brand, brandCounts(game.state.parts)[def.brand] ?? 0));
  lines.push('');
  if (def.tier === 'stock') lines.push({ t: 'STOCK: NOTHING TO SELL', c: PAL.inkDim });
  else {
    lines.push({ t: `SELL VALUE $${game.partSellValue(slot)}`, c: PAL.yellow });
    lines.push({ t: 'CLICK: SELL / TUNE', c: PAL.inkDim });
  }
  return { title: def.name, color: partTitleColor(def), lines };
}

/** Tooltip for a part being offered (shop card or pack card): shows what it replaces and the diff. */
export function offerPartTip(partId: string, price?: number): Tip {
  const def = game.part(partId);
  const cur = game.state.parts[def.slot];
  const curDef = game.part(cur.partId);
  const lines: TipLine[] = [partHeadLine(def)];
  lines.push(...statLines(partStats(def)));
  if (def.quirk) lines.push({ t: `QUIRK: ${quirkName(def.quirk)}`, c: PAL.orange });
  if (def.desc) lines.push({ t: def.desc, c: PAL.inkDim });
  lines.push('', { t: `REPLACES ${curDef.name.toUpperCase()}${cur.level ? ` LV${cur.level}` : ''}`, c: PAL.ink });
  if (cur.partId === partId) lines.push({ t: 'ALREADY INSTALLED', c: PAL.red });
  else {
    lines.push(...diffLines(partStats(def), partStats(curDef, cur.level)));
    const refund = game.partSellValue(def.slot);
    if (refund > 0) lines.push({ t: `OLD PART SELLS +$${refund}`, c: PAL.yellow });
    lines.push(...setChangeLines(def, curDef));
  }
  if (def.brand) {
    const owned = brandCounts(game.state.parts)[def.brand] ?? 0;
    const after = cur.partId === partId || curDef.brand === def.brand ? owned : owned + 1;
    lines.push('', ...brandSetLines(def.brand, after, after !== owned ? owned : undefined));
  }
  if (price !== undefined) lines.push('', { t: price === 0 ? 'FREE' : `PRICE $${price}`, c: PAL.yellow });
  return { title: def.name, color: partTitleColor(def), lines };
}

const TRIGGER_TEXT: Record<string, string> = {
  always: 'ALWAYS ON',
  race_start: 'AT RACE START',
  launch: 'ON LAUNCH',
  shift: 'ON EACH SHIFT',
  finish: 'AT THE FINISH',
  shop: 'ENTERING A SHOP',
  win: 'AFTER EACH WIN',
  skip: 'WHEN YOU SKIP A RACE',
  sell: 'WHEN YOU SELL',
};

/** Per-passive trigger text where the data trigger is too coarse. */
const TRIGGER_OVERRIDE: Record<string, string> = {
  late_spray: 'WHEN NITROUS FIRES',
  mirror: 'COPIES THE PASSIVE TO ITS RIGHT',
  tow_hook: 'COPIES YOUR LEFTMOST PASSIVE',
  pole_position: 'POSITION: LEFTMOST',
  convoy: 'POSITION: FURTHER RIGHT = STRONGER',
  coin_flip: 'REROLLED EVERY RACE',
  wild_card: 'REROLLED EVERY RACE',
  bargain_hunter: 'IN THE SHOP',
  broken_in: 'AFTER EACH RACE',
  recycler: 'WHEN YOU SELL A PART',
  all_or_nothing: 'ALWAYS ON / ON EACH SHIFT',
};

/** Extra warning lines (risky passives). */
const PASSIVE_WARN: Record<string, string> = {
  all_or_nothing: 'RISKY: A MISS SHIFT LOSES THE RACE',
  perfectionist: 'RISKY: ONE SLIP AND IT TURNS ON YOU',
  sandbagger: 'WEAKER IN REGULAR RACES',
  overclock: 'COSTS GRIP',
  tightrope: 'NARROWER SHIFT WINDOW',
  redline_gambler: 'NARROWER SHIFT WINDOW',
  wet_shot: 'NEEDS A NITROUS PART',
  hot_mix: 'NEEDS A NITROUS PART',
  late_spray: 'NEEDS A NITROUS PART',
  mixed_bag: 'OFF IF ANY BRAND HAS 3+ PARTS',
};

export const EDITION_COLOR: Record<Edition, number> = { foil: PAL.teal, holo: PAL.pink, chrome: 0xb8b2c8 };

export interface PassiveTipOpts {
  /** Owned row index: adds live counters (scaling / position passives). Auto-detected when owned. */
  index?: number;
  edition?: Edition | null;
}

export function passiveTip(id: string, extra: TipLine[] = [], opts: PassiveTipOpts = {}): Tip {
  const def = game.passive(id);
  const st = game.state;
  const owned = st.passives?.indexOf(id) ?? -1;
  const index = opts.index ?? (owned >= 0 ? owned : undefined);
  const edition = opts.edition !== undefined ? opts.edition : index !== undefined ? st.passiveEditions?.[index] ?? null : null;
  const lines: TipLine[] = [
    { t: `PASSIVE  ${def.rarity.toUpperCase()}`, c: RARITY_COLOR[def.rarity] },
    { t: def.desc },
    { t: TRIGGER_OVERRIDE[id] ?? TRIGGER_TEXT[def.trigger] ?? def.trigger.toUpperCase(), c: PAL.teal },
  ];
  if (PASSIVE_WARN[id]) lines.push({ t: PASSIVE_WARN[id], c: PAL.orange });
  if (edition) lines.push({ t: EDITION_TEXT[edition], c: EDITION_COLOR[edition] });
  if (index !== undefined) {
    const live = passiveStatus(st, index);
    if (live) lines.push({ t: live, c: PAL.yellow });
  }
  lines.push(...extra);
  return { title: def.name, color: RARITY_COLOR[def.rarity], lines };
}

/** Tooltip for a held or offered tag. */
export function tagTip(id: string, extra: TipLine[] = []): Tip {
  const def = game.tag(id);
  return {
    title: def.name,
    color: RARITY_COLOR[def.rarity],
    lines: [{ t: `TAG  ${def.rarity.toUpperCase()}`, c: RARITY_COLOR[def.rarity] }, { t: def.desc }, { t: 'SKIP A RACE TO EARN IT', c: PAL.teal }, ...extra],
  };
}

/** Tooltip for a garage upgrade (owned or offered). */
export function garageTip(id: string, extra: TipLine[] = []): Tip {
  const def = game.garageUpgrade(id);
  const lines: TipLine[] = [{ t: `GARAGE UPGRADE  TIER ${def.tier}`, c: def.tier === 2 ? PAL.purple : PAL.blue }, { t: def.desc }];
  if (def.requires) lines.push({ t: `UPGRADES ${game.garageUpgrade(def.requires).name.toUpperCase()}`, c: PAL.inkDim });
  lines.push({ t: 'PERMANENT FOR THIS RUN', c: PAL.teal }, ...extra);
  return { title: def.name, color: def.tier === 2 ? PAL.purple : PAL.blue, lines };
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
      { t: `Each level: +${Math.round(tunePerLevel() * 100)}% of that part's stats.`, c: PAL.green },
      ...extra,
    ],
  };
}

export function shopItemTip(item: ShopItem): Tip {
  const price: TipLine[] = ['', { t: `PRICE $${item.price}`, c: PAL.yellow }];
  if (item.kind === 'part') return offerPartTip(item.partId, item.price);
  if (item.kind === 'passive') return passiveTip(item.passiveId, price, { edition: item.edition ?? null });
  return consumableTip(item.consumableId, price);
}

export function packCardTip(card: PackCard): Tip {
  if (card.kind === 'part') return offerPartTip(card.partId);
  if (card.kind === 'passive') return passiveTip(card.passiveId, [], { edition: card.edition ?? null });
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
  return `Apply to a part: +1 tune level (+${Math.round(tunePerLevel() * 100)}% stats).`;
}
