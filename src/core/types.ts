// Shared contracts. Every module codes against these types.
// Changing a type here affects every agent: add fields freely, but do not rename or remove.

export type Grade = 'perfect' | 'good' | 'miss';
export type Tier = 'stock' | 'street' | 'pro';
export type Rarity = 'common' | 'uncommon' | 'rare';

export const SLOTS = [
  'engine',
  'intake',
  'forced_induction',
  'exhaust',
  'ecu',
  'transmission',
  'differential',
  'tires',
  'suspension',
  'chassis',
  'aero',
  'nitrous',
] as const;
export type SlotId = (typeof SLOTS)[number];

/** Car stats. Base values for the starter car live in balance.json. */
export interface CarStats {
  power: number; // hp-ish units, starter 200
  grip: number; // tire μ, starter 1.0
  weight: number; // kg, starter 1400
  gearing: number; // efficiency multiplier, starter 1.0
  drag: number; // multiplier on drag coefficient, starter 1.0 (lower is better)
  shiftWindow: number; // multiplier on shift window width, starter 1.0
  nitroPower: number; // extra power while nitrous fires, 0 = no nitrous
  nitroDuration: number; // seconds nitrous fires
}
export type StatKey = keyof CarStats;

// ---------- Content definitions (loaded from src/data/*.json) ----------

export interface PartDef {
  id: string;
  slot: SlotId;
  name: string;
  tier: Tier;
  cost: number; // purchase price; stock parts cost 0
  stats: Partial<CarStats>; // additive deltas on the base car
  quirk?: string; // named behavior implemented in code (e.g. 'launch_lag')
  desc?: string; // short flavor / trade-off text
}

export type PassiveTrigger = 'always' | 'race_start' | 'launch' | 'shift' | 'finish';

export interface PassiveDef {
  id: string; // behavior implemented in code by id (src/game/effects.ts)
  name: string;
  desc: string;
  trigger: PassiveTrigger;
  cost: number;
  rarity: Rarity;
}

export interface ConsumableDef {
  id: string; // behavior implemented in code by id
  name: string;
  desc: string;
  cost: number;
  rarity: Rarity;
}

export interface OpponentDef {
  round: number; // 1..4
  race: number; // 0..3 (3 = boss)
  name: string;
  targetEt: number;
  car: { body: 'compact' | 'muscle' | 'wedge' | 'truck' | 'super'; color: string; accent: string };
  bossModifier?: string; // id of BossModifierDef
  taunt?: string;
}

export interface BossModifierDef {
  id: string; // 'tight_tree' | 'slick_track' | 'headwind' | 'redline_only'
  name: string;
  desc: string;
}

// ---------- Race sim ----------

export type RaceInput = 'go' | 'nitro'; // 'go' = Space: launch during tree/staged, shift while running

export interface GradeEvent {
  kind: 'launch' | 'shift' | 'nitro' | 'false_start';
  grade: Grade;
  t: number; // sim time (s since green) when it happened
  gear?: number; // gear shifted FROM (shift events)
  offsetMs?: number; // launch: reaction ms; shift: signed distance from ideal in rpm-ms-equivalent
  label?: string; // optional UI text, e.g. 'LATE', 'EARLY', 'LIMITER'
}

export interface ShiftWindow {
  // All in normalized rpm (1.0 = redline) for the current gear.
  perfectLo: number;
  perfectHi: number;
  goodLo: number;
  goodHi: number;
}

export interface SimState {
  t: number; // seconds relative to green (negative during the tree)
  phase: 'tree' | 'running' | 'finished';
  lights: 0 | 1 | 2 | 3 | 4; // ambers lit (0-3), 4 = green
  launched: boolean;
  x: number; // meters travelled
  v: number; // m/s
  a: number; // m/s^2 this step
  gear: number; // 1..4
  rpm: number; // normalized, 1.0 = redline (can sit at ~1.0 on limiter)
  rpmAbs: number; // display rpm, e.g. 900..7500
  limiter: boolean;
  wheelspin: boolean;
  nitroAvailable: boolean;
  nitroActive: boolean;
  shiftWindow: ShiftWindow;
  grades: GradeEvent[];
  reaction: number | null; // seconds, null until launched
  penalty: number; // seconds added (false start)
  et: number | null; // final elapsed time once finished
  trapSpeedKph: number | null;
  /** Live multipliers after event-triggered passives fired, for UI readouts. */
  live: { power: number; grip: number; gearing: number };
}

/** Mutable bag event-triggered passives read and write during a race. */
export interface RaceContext {
  powerMult: number; // rest of race
  gripMult: number;
  gearingMult: number;
  gearPowerMult: number; // reset to 1 at each shift (after onShift hooks run)
  firstGearGripMult: number; // applies only in 1st gear
  perfectCount: number;
  cashEarned: number; // cash awarded by passives during this race
  notes: string[]; // short UI popups, e.g. 'SHIFT SAVANT +3%'
}

export interface RaceHooks {
  onStart?(ctx: RaceContext): void;
  onLaunch?(grade: Grade, ctx: RaceContext): void;
  onShift?(grade: Grade, fromGear: number, ctx: RaceContext): void;
  onFinish?(result: { et: number; targetEt: number; won: boolean }, ctx: RaceContext): void;
}

export interface RaceSetup {
  stats: CarStats; // final effective stats after pipeline steps 1-5
  hooks: RaceHooks[]; // one per active event-triggered passive, in passive order
  quirks: string[]; // e.g. ['launch_lag']
  launchWindowMult: number; // 1 normally, 0.5 for Tight Tree
  extraShiftWindowMult: number; // 1 normally; Redline Only = 0.5, Wide Tach = 1.3, Redline Gambler = 0.6
  gripEarlyMult: number; // Grip Spray: grip × this for the first gripEarlySeconds
  gripEarlySeconds: number;
  targetEt: number;
}

export interface RaceResult {
  et: number;
  targetEt: number;
  won: boolean;
  margin: number; // targetEt - et (positive = won by)
  reaction: number;
  trapSpeedKph: number;
  grades: GradeEvent[];
  perfectCount: number;
  passiveCash: number; // ctx.cashEarned
}

/** The sim. Implemented in src/sim/RaceSim.ts. No Phaser imports allowed in src/sim. */
export interface IRaceSim {
  readonly state: SimState;
  readonly setup: RaceSetup;
  /** Advance exactly one fixed step (1/120 s). */
  step(): void;
  /** Player input at the current sim time. Returns the grade event it produced, if any. */
  input(action: RaceInput): GradeEvent | null;
  /** Valid once state.phase === 'finished'. */
  result(): RaceResult;
}

// ---------- Run state ----------

export interface InstalledPart {
  partId: string;
  level: number; // 0..3 tuning level
}

export type ShopItem =
  | { kind: 'part'; partId: string; price: number; sold: boolean }
  | { kind: 'passive'; passiveId: string; price: number; sold: boolean }
  | { kind: 'consumable'; consumableId: string; price: number; sold: boolean };

export type PackKind = 'parts' | 'power';
export interface ShopPack {
  kind: PackKind;
  price: number;
  sold: boolean;
}

export type PackCard =
  | { kind: 'part'; partId: string }
  | { kind: 'passive'; passiveId: string }
  | { kind: 'consumable'; consumableId: string }
  | { kind: 'tuning' };

export interface ShopState {
  items: ShopItem[]; // 2 parts then 2 powerups
  packs: ShopPack[]; // [parts, power]
  rerollCost: number;
  openPack: { kind: PackKind; cards: PackCard[] } | null; // pack being viewed
  freePack: boolean; // run start: the first Power Pack costs $0
}

export interface RaceRecord {
  round: number;
  race: number;
  opponent: string;
  targetEt: number;
  et: number;
  won: boolean;
  reaction: number;
  perfectCount: number;
  cashEarned: number;
}

export type RunPhase = 'shop' | 'staging' | 'race' | 'result' | 'gameover' | 'victory';

export interface RunState {
  seed: string; // human-readable seed shown to the player, e.g. 'K7QX2M'
  rng: number; // current PRNG state (serializable)
  phase: RunPhase;
  cash: number;
  round: number; // 1..4
  race: number; // 0..3 within round, 3 = boss
  parts: Record<SlotId, InstalledPart>;
  passives: string[]; // ordered, max 5
  consumables: string[]; // max 2
  tuningCards: number; // unspent tuning cards held
  shop: ShopState | null;
  stagedConsumables: string[]; // consumables chosen at staging for the upcoming race
  mulliganArmed: boolean; // a Mulligan was used at staging and is available for this race
  lastResult: RaceResult | null;
  lastPayout: Payout | null;
  history: RaceRecord[];
}

export interface Payout {
  base: number;
  timeBonus: number;
  passiveCash: number;
  total: number;
  lines: { label: string; amount: number }[]; // for the Balatro-style cash-out tally
}

/** One step of the stat calculation, for the staging screen's left-to-right "scoring" animation. */
export interface StatBreakdownStep {
  source: string; // 'Base car', 'Twin Turbo (L2)', 'Featherweight', 'Nitro Bottle', 'Boss: Slick Track'
  kind: 'base' | 'part' | 'tuning' | 'passive' | 'consumable' | 'boss';
  stats: CarStats; // running totals AFTER this step
  disabled?: boolean; // e.g. rightmost passive under Redline Only
}
