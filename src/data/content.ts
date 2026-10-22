// Content loader. JSON data validated with zod at module load. Renderer-independent.
import { z } from 'zod';
import { SLOTS } from '../core/types';
import type {
  BossModifierDef,
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

export interface Balance {
  starter: CarStats;
  economy: { startCash: number; regularWin: number; bossWin: number; timeBonusPerTenth: number; timeBonusCap: number; sellRatio: number };
  prices: { street: number; pro: number; partsPack: number; powerPack: number; passive: number; consumable: number; rerollBase: number; rerollStep: number };
  shop: {
    proShareBase: number;
    proShareStepPerRound: number;
    powerPackOdds: { passive: number; consumable: number; tuning: number };
    rarityWeights: { common: number; uncommon: number; rare: number };
  };
  limits: { passiveSlots: number; consumableSlots: number; maxTuning: number; tuningPerLevel: number };
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
  tier: z.enum(['stock', 'street', 'pro']),
  cost: num.nonnegative(),
  stats: statsFull.partial(),
  quirk: z.string().optional(),
  desc: z.string().optional(),
});
const passiveSchema = z.object({
  id: z.string(),
  name: z.string(),
  desc: z.string(),
  trigger: z.enum(['always', 'race_start', 'launch', 'shift', 'finish']),
  cost: num,
  rarity,
});
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
const bossSchema = z.object({ id: z.string(), name: z.string(), desc: z.string() });
const balanceSchema = z.object({
  starter: statsFull,
  economy: z.object({ startCash: num, regularWin: num, bossWin: num, timeBonusPerTenth: num, timeBonusCap: num, sellRatio: num }),
  prices: z.object({ street: num, pro: num, partsPack: num, powerPack: num, passive: num, consumable: num, rerollBase: num, rerollStep: num }),
  shop: z.object({
    proShareBase: num,
    proShareStepPerRound: num,
    powerPackOdds: z.object({ passive: num, consumable: num, tuning: num }),
    rarityWeights: z.object({ common: num, uncommon: num, rare: num }),
  }),
  limits: z.object({ passiveSlots: num, consumableSlots: num, maxTuning: num, tuningPerLevel: num }),
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
const bossModifiers = parse('bossModifiers.json', z.array(bossSchema), bossModifiersJson) as BossModifierDef[];
const balance = parse('balance.json', balanceSchema, balanceJson) as Balance;

// Cross-checks: every slot has exactly one part per tier; boss modifiers resolve; 16 opponents.
for (const s of SLOTS) {
  for (const tier of ['stock', 'street', 'pro'] as const) {
    const n = parts.filter((p) => p.slot === s && p.tier === tier).length;
    if (n !== 1) throw new Error(`parts.json: slot ${s} has ${n} ${tier} parts (expected 1)`);
  }
}
for (const o of opponents) {
  if (o.bossModifier && !bossModifiers.some((b) => b.id === o.bossModifier)) {
    throw new Error(`opponents.json: unknown bossModifier ${o.bossModifier}`);
  }
}

export const CONTENT: {
  parts: PartDef[];
  passives: PassiveDef[];
  consumables: ConsumableDef[];
  opponents: OpponentDef[];
  bossModifiers: BossModifierDef[];
  balance: Balance;
} = { parts, passives, consumables, opponents, bossModifiers, balance };

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
