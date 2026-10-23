// Content loader. JSON data validated with zod at module load. Renderer-independent.
import { z } from 'zod';
import { SLOTS } from '../core/types';
import type {
  BossDef,
  BrandDef,
  BossModifierDef,
  GarageDef,
  HeatDef,
  StartingCarDef,
  TagDef,
  CarStats,
  ConsumableDef,
  OpponentDef,
  PartDef,
  PassiveDef,
  SlotId,
} from '../core/types';
import partsJson from './parts.json';
import passivesJson from './passives.json';
import consumablesJson from './consumables.json';
import opponentsJson from './opponents.json';
import bossModifiersJson from './bossModifiers.json';
import balanceJson from './balance.json';
import bossesJson from './bosses.json';
import heatJson from './heat.json';
import startingCarsJson from './startingCars.json';
import tagsJson from './tags.json';
import garageJson from './garage.json';
import brandsJson from './brands.json';

export interface Balance {
  starter: CarStats;
  economy: { startCash: number; regularWin: number; bossWin: number; timeBonusPerTenth: number; timeBonusCap: number; sellRatio: number };
  prices: { street: number; sport: number; pro: number; partsPack: number; powerPack: number; passive: number; consumable: number; rerollBase: number; rerollStep: number };
  shop: {
    /** Tier odds per round (index = round - 1; the last row repeats for later rounds). */
    tierOdds: { street: number; sport: number; pro: number }[];
    /** Brand bias: weight of a brand within the rolled tier = 1 + brandBias x (parts of that brand installed). */
    brandBias: number;
    /** Brand Loyalty garage upgrades: brandBias added. */
    loyaltyBias: number;
    loyaltyBias2: number;
    powerPackOdds: { passive: number; consumable: number; tuning: number };
    rarityWeights: { common: number; uncommon: number; rare: number };
  };
  limits: { passiveSlots: number; consumableSlots: number; maxTuning: number; tuningPerLevel: number };
  /** Passive editions: chance per rolled passive (shop item / pack card) and price add-on. */
  editions: { foil: { odds: number; price: number }; holo: { odds: number; price: number }; chrome: { odds: number; price: number } };
  /** Endless: target ET x targetMultPerRound^(round - 4), times an extra squeeze that grows quadratically. */
  endless: { targetMultPerRound: number; squeezePerRound2: number };
}

const num = z.number().finite();
const statsFull = z.object({
  power: num,
  grip: num,
  weight: num,
  gearing: num,
  drag: num,
  shiftWindow: num,
  nitroPower: num,
  nitroDuration: num,
});
const slot = z.enum(SLOTS);
const rarity = z.enum(['common', 'uncommon', 'rare']);

const partSchema = z.object({
  id: z.string(),
  slot,
  name: z.string(),
  tier: z.enum(['stock', 'street', 'sport', 'pro']),
  cost: num.nonnegative(),
  stats: statsFull.partial(),
  quirk: z.string().optional(),
  desc: z.string().optional(),
  brand: z.string().optional(),
});
const setBonus = z.object({ desc: z.string(), mult: statsFull.partial() });
const brandSchema = z.object({
  id: z.string(),
  name: z.string(),
  tier: z.enum(['street', 'sport', 'pro']),
  parody: z.string(),
  color: z.string(),
  accent: z.string(),
  set4: setBonus,
  set8: setBonus,
  paragon: z.object({
    name: z.string(),
    desc: z.string(),
    look: z.object({ body: z.string(), color: z.string(), accent: z.string(), livery: z.string().optional() }),
    mult: statsFull.partial(),
    ability: z.string(),
    abilityDesc: z.string(),
  }),
});
const passiveSchema = z.object({
  id: z.string(),
  name: z.string(),
  desc: z.string(),
  trigger: z.enum(['always', 'race_start', 'launch', 'shift', 'finish', 'shop', 'win', 'skip', 'sell']),
  cost: num,
  rarity,
}).passthrough();
const consumableSchema = z.object({ id: z.string(), name: z.string(), desc: z.string(), cost: num, rarity });
const opponentSchema = z.object({
  round: z.number().int().min(1).max(4),
  race: z.number().int().min(0).max(3),
  name: z.string(),
  targetEt: num.positive(),
  car: z.object({
    body: z.enum(['compact', 'muscle', 'wedge', 'truck', 'super']),
    color: z.string(),
    accent: z.string(),
  }),
  bossModifier: z.string().optional(),
  taunt: z.string().optional(),
});
const bossModSchema = z
  .object({ id: z.string(), name: z.string(), desc: z.string(), hint: z.string().optional(), params: z.record(z.any()).optional() })
  .passthrough();
const body = z.enum(['compact', 'muscle', 'wedge', 'truck', 'super']);
const bossDefSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    taunt: z.string(),
    car: z.object({ body, color: z.string(), accent: z.string() }),
    modifier: z.string(),
    tier: z.enum(['regular', 'final']),
    cutscene: z.string().optional(),
  })
  .passthrough();
const heatSchema = z.object({ level: z.number().int().min(0).max(8), name: z.string(), desc: z.string() });
const startingCarSchema = z.object({
  id: z.string(),
  name: z.string(),
  body,
  desc: z.string(),
  unlock: z.object({ kind: z.enum(['free', 'beat_round', 'win_run', 'win_heat']), value: num.optional() }),
});
const tagSchema = z.object({ id: z.string(), name: z.string(), desc: z.string(), rarity });
const garageSchema = z.object({
  id: z.string(),
  name: z.string(),
  desc: z.string(),
  cost: num.nonnegative(),
  tier: z.union([z.literal(1), z.literal(2)]),
  requires: z.string().optional(),
});
const edition = z.object({ odds: num, price: num });
const balanceSchema = z.object({
  starter: statsFull,
  economy: z.object({ startCash: num, regularWin: num, bossWin: num, timeBonusPerTenth: num, timeBonusCap: num, sellRatio: num }),
  prices: z.object({ street: num, sport: num, pro: num, partsPack: num, powerPack: num, passive: num, consumable: num, rerollBase: num, rerollStep: num }),
  shop: z.object({
    tierOdds: z.array(z.object({ street: num, sport: num, pro: num })).min(1),
    brandBias: num,
    loyaltyBias: num,
    loyaltyBias2: num,
    powerPackOdds: z.object({ passive: num, consumable: num, tuning: num }),
    rarityWeights: z.object({ common: num, uncommon: num, rare: num }),
  }),
  limits: z.object({ passiveSlots: num, consumableSlots: num, maxTuning: num, tuningPerLevel: num }),
  editions: z
    .object({ foil: edition, holo: edition, chrome: edition })
    .default({ foil: { odds: 0.04, price: 3 }, holo: { odds: 0.03, price: 3 }, chrome: { odds: 0.015, price: 5 } }),
  endless: z.object({ targetMultPerRound: num, squeezePerRound2: num }).default({ targetMultPerRound: 0.95, squeezePerRound2: 0.004 }),
});

function parse<T>(name: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new Error(`Invalid content in ${name}: ${r.error.message}`);
  return r.data;
}

const parts = parse('parts.json', z.array(partSchema), partsJson) as PartDef[];
const passives = parse('passives.json', z.array(passiveSchema), passivesJson) as PassiveDef[];
const consumables = parse('consumables.json', z.array(consumableSchema), consumablesJson) as ConsumableDef[];
const opponents = parse('opponents.json', z.array(opponentSchema), opponentsJson) as OpponentDef[];
const bossModifiers = parse('bossModifiers.json', z.array(bossModSchema), bossModifiersJson) as BossModifierDef[];
const balance = parse('balance.json', balanceSchema, balanceJson) as Balance;
const bosses = parse('bosses.json', z.array(bossDefSchema), bossesJson) as BossDef[];
const heat = (parse('heat.json', z.array(heatSchema), heatJson) as HeatDef[]).sort((a, b) => a.level - b.level);
const startingCars = parse('startingCars.json', z.array(startingCarSchema), startingCarsJson) as StartingCarDef[];
const tags = parse('tags.json', z.array(tagSchema), tagsJson) as TagDef[];
const garage = parse('garage.json', z.array(garageSchema), garageJson) as GarageDef[];
const brands = parse('brands.json', z.array(brandSchema), brandsJson) as BrandDef[];

// Cross-checks: one stock part per slot; every brand has exactly one part per slot, all in the brand's tier;
// every non-stock part belongs to a known brand. Boss modifiers resolve.
for (const s of SLOTS) {
  const n = parts.filter((p) => p.slot === s && p.tier === 'stock').length;
  if (n !== 1) throw new Error(`parts.json: slot ${s} has ${n} stock parts (expected 1)`);
  for (const b of brands) {
    const bp = parts.filter((p) => p.slot === s && p.brand === b.id);
    if (bp.length !== 1) throw new Error(`parts.json: brand ${b.id} has ${bp.length} ${s} parts (expected 1)`);
    if (bp[0].tier !== b.tier) throw new Error(`parts.json: ${bp[0].id} is ${bp[0].tier}, brand ${b.id} is ${b.tier}`);
  }
}
for (const p of parts) {
  if (p.tier !== 'stock' && !brands.some((b) => b.id === p.brand)) throw new Error(`parts.json: ${p.id} has no known brand`);
}
for (const o of opponents) {
  if (o.bossModifier && !bossModifiers.some((b) => b.id === o.bossModifier)) {
    throw new Error(`opponents.json: unknown bossModifier ${o.bossModifier}`);
  }
}

// Soft checks (other agents edit these files in parallel: warn, don't crash).
for (const b of bosses) {
  if (!bossModifiers.some((m) => m.id === b.modifier)) console.warn(`bosses.json: ${b.id} has unknown modifier ${b.modifier}`);
}
if (!bosses.some((b) => b.tier === 'final')) throw new Error('bosses.json: need at least one final boss');
if (bosses.filter((b) => b.tier === 'regular').length < 3) throw new Error('bosses.json: need at least 3 regular bosses');
for (const g of garage) {
  if (g.requires && !garage.some((x) => x.id === g.requires)) throw new Error(`garage.json: ${g.id} requires unknown ${g.requires}`);
}
if (!startingCars.length) throw new Error('startingCars.json: empty');

export const CONTENT: {
  parts: PartDef[];
  passives: PassiveDef[];
  consumables: ConsumableDef[];
  opponents: OpponentDef[];
  bossModifiers: BossModifierDef[];
  balance: Balance;
  bosses: BossDef[];
  heat: HeatDef[];
  startingCars: StartingCarDef[];
  tags: TagDef[];
  garage: GarageDef[];
  /** The 8 brands, worst tier first (street, sport, pro). */
  brands: BrandDef[];
} = { parts, passives, consumables, opponents, bossModifiers, balance, bosses, heat, startingCars, tags, garage, brands };

const partMap = new Map(parts.map((p) => [p.id, p]));
const passiveMap = new Map(passives.map((p) => [p.id, p]));
const consumableMap = new Map(consumables.map((c) => [c.id, c]));

export function partById(id: string): PartDef {
  const p = partMap.get(id);
  if (!p) throw new Error(`Unknown part: ${id}`);
  return p;
}
export function passiveById(id: string): PassiveDef {
  const p = passiveMap.get(id);
  if (!p) throw new Error(`Unknown passive: ${id}`);
  return p;
}
export function consumableById(id: string): ConsumableDef {
  const c = consumableMap.get(id);
  if (!c) throw new Error(`Unknown consumable: ${id}`);
  return c;
}
export function stockPart(slot: SlotId): PartDef {
  const p = parts.find((x) => x.slot === slot && x.tier === 'stock');
  if (!p) throw new Error(`No stock part for slot ${slot}`);
  return p;
}
export function opponentFor(round: number, race: number): OpponentDef {
  const o = opponents.find((x) => x.round === round && x.race === race);
  if (!o) throw new Error(`No opponent for round ${round} race ${race}`);
  return o;
}
/** Convenience: boss modifier lookup (undefined for unknown/none). */
export function bossModifierById(id: string | undefined): BossModifierDef | undefined {
  return id ? bossModifiers.find((b) => b.id === id) : undefined;
}

const find = <T extends { id: string }>(arr: T[], id: string, what: string): T => {
  const x = arr.find((a) => a.id === id);
  if (!x) throw new Error(`Unknown ${what}: ${id}`);
  return x;
};
export const bossById = (id: string): BossDef => find(bosses, id, 'boss');
export const tagById = (id: string): TagDef => find(tags, id, 'tag');
export const garageById = (id: string): GarageDef => find(garage, id, 'garage upgrade');
export const startingCarById = (id: string): StartingCarDef => find(startingCars, id, 'starting car');

const brandMap = new Map(brands.map((b) => [b.id, b]));
/** Brand lookup (undefined for unknown ids / stock parts). */
export const brandById = (id: string | undefined): BrandDef | undefined => (id ? brandMap.get(id) : undefined);
/** The brand's 12 parts, in SLOTS order. */
export const brandParts = (id: string): PartDef[] =>
  SLOTS.map((s) => parts.find((p) => p.brand === id && p.slot === s)).filter((p): p is PartDef => !!p);
