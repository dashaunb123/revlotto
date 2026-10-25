// Shared contracts. Every module codes against these types.
// Changing a type here affects every agent: add fields freely, but do not rename or remove.

export type Grade = 'perfect' | 'good' | 'miss';
/** Part tiers, worst to best. Every street/sport/pro part belongs to a brand (see BrandDef). */
export type Tier = 'stock' | 'street' | 'sport' | 'pro';
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
  /** Brand id (BrandDef.id) for street/sport/pro parts; stock parts have none. */
  brand?: string;
}

/**
 * A car brand (parody of a real car). All its parts are one tier, one per slot (12). Owning 4 / 8 of them
 * gives set bonuses; all 12 transforms the player's car into the brand's PARAGON.
 */
export interface BrandDef {
  id: string; // 'malibru'
  name: string; // 'Malibru'
  tier: Exclude<Tier, 'stock'>;
  parody: string; // 'Chevy Malibu' (dev note, not shown in game)
  color: string; // brand colour for UI chips / logos
  accent: string;
  /** Set bonuses: stat multipliers applied when owning >= 4 / >= 8 parts of this brand. */
  set4: { desc: string; mult: Partial<CarStats> };
  set8: { desc: string; mult: Partial<CarStats> };
  paragon: ParagonDef;
}

export interface ParagonDef {
  name: string; // 'Malibru SS'
  desc: string; // one punchy line
  /** Car look while transformed (body type id in src/render/car.ts, plus paint). */
  look: { body: string; color: string; accent: string; livery?: string };
  /** Stat multipliers on top of everything else while transformed. */
  mult: Partial<CarStats>;
  /** Signature ability id, implemented in code (src/game/effects.ts PARAGON_ABILITIES). */
  ability: string;
  abilityDesc: string;
}

export type PassiveTrigger = 'always' | 'race_start' | 'launch' | 'shift' | 'finish' | 'shop' | 'win' | 'skip' | 'sell';

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
  bossId?: string; // set on boss races: the BossDef drawn for this round
  cutscene?: string; // boss races: CutsceneId from BossDef.cutscene (render/cutscene), if any
}

/** A seeded boss param: rolled uniformly in [min, max] with the run's seed. `count` > 1 rolls name0..name{count-1}. */
export interface BossParamRange {
  min: number;
  max: number;
  int?: boolean; // round to an integer
  count?: number; // roll several values: keys `${name}0`, `${name}1`, ... (plus `${name}N` = count)
  sorted?: boolean; // with count: sort ascending (e.g. oil patch distances)
  minGap?: number; // with count + sorted: re-space so neighbours are at least this far apart
}

export interface BossModifierDef {
  id: string; // 'tight_tree' | 'slick_track' | 'headwind' | 'redline_only' | ...
  name: string;
  desc: string;
  hint?: string; // one-line "how to beat it", shown on Staging
  params?: Record<string, BossParamRange>; // rolled per run into RaceSetup.boss.params
}

/** Boss pool entry (src/data/bosses.json, owned by the Bosses agent). */
export interface BossDef {
  id: string;
  name: string;
  taunt: string;
  car: { body: CarBody; color: string; accent: string };
  modifier: string; // BossModifierDef id
  tier: 'regular' | 'final';
  cutscene?: string; // CutsceneId (src/render/cutscene)
}

export type CarBody = 'compact' | 'muscle' | 'wedge' | 'truck' | 'super';

export type Edition = 'foil' | 'holo' | 'chrome';

export interface TagDef {
  id: string;
  name: string;
  desc: string;
  rarity: Rarity;
}

export interface GarageDef {
  id: string;
  name: string;
  desc: string;
  cost: number;
  tier: 1 | 2;
  requires?: string; // tier 2: the tier-1 id that must be owned
}

export interface HeatDef {
  level: number; // 0..8
  name: string;
  desc: string;
  unlocked?: boolean; // filled by game.heatLevels()
}

export interface StartingCarDef {
  id: string;
  name: string;
  body: CarBody;
  desc: string;
  unlock: { kind: 'free' | 'beat_round' | 'win_run' | 'win_heat'; value?: number };
  unlocked?: boolean; // filled by game.startingCars()
  bestHeat?: number | null; // filled by game.startingCars(): highest heat won with this car (sticker)
  maxHeat?: number; // filled by game.startingCars(): highest heat selectable with this car (heat is earned per car)
  bestEndlessRound?: number; // filled by game.startingCars()
}

/** Meta progression across runs (src/game/meta.ts, localStorage 'revlotto_meta'). */
export interface MetaState {
  version: 1;
  heatUnlocked: number; // highest heat unlocked on ANY car (summary only; selection is per car, see heatUnlockedFor)
  bestHeatByCar: Record<string, number>; // highest heat WON per starting car
  carsUnlocked: string[];
  runsPlayed: number;
  runsWon: number;
  bestRoundBeaten: number; // highest round whose boss was beaten (any run, any car)
  bestEndlessRound: number; // furthest round reached in endless (0 = never)
  bestEndlessRoundByCar: Record<string, number>;
  discoveredPassives: string[];
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
  forceLoss?: boolean; // set by a passive/boss: the race counts as lost even if under target (RaceSim)
}

export interface RaceHooks {
  onStart?(ctx: RaceContext): void;
  onLaunch?(grade: Grade, ctx: RaceContext): void;
  onShift?(grade: Grade, fromGear: number, ctx: RaceContext): void;
  onFinish?(result: { et: number; targetEt: number; won: boolean }, ctx: RaceContext): void;
  onNitro?(grade: Grade, gear: number, ctx: RaceContext): void;
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
  /** Boss races only. Params are seeded per run (oil distances, gust times...) so sim, scene and replays agree. */
  boss?: {
    id: string; // BossDef id
    modifier: string; // primary BossModifierDef id
    params: Record<string, number>;
    /** Heat 8: extra modifiers stacked on the boss, each with its own params. */
    extra?: { modifier: string; params: Record<string, number> }[];
  };
  /** Active brand set bonuses (4+ parts of a brand), highest count first. Pure function of the installed parts. */
  sets?: { brand: string; count: number; level: 4 | 8 | 12 }[];
  /** Set while the car is transformed (all 12 parts of one brand): the brand and its ParagonDef.ability id. */
  paragon?: { brand: string; ability: string };
}

/** Passed to passive effect fns (stats/setup/hooks) by src/game/stats.ts as an extra trailing argument. */
export interface PassiveInfo {
  id: string;
  index: number; // position in the passive row
  edition: Edition | null;
  /** Per-run counter for this passive instance (RunState.passiveState[`${id}` or `${id}:${key}`]). */
  counter(key?: string): number;
  run: Readonly<RunState>;
}

/** Context for run-level passive hooks (RunHooks). Counters are namespaced to the passive automatically. */
export interface RunCtx {
  readonly id: string; // the passive this ctx belongs to
  readonly index: number;
  readonly edition: Edition | null;
  readonly cash: number; // current cash (after any addCash calls)
  addCash(n: number): void; // shows up as a payout line on wins
  counter(key?: string): number;
  bump(key: string | undefined, n: number): void; // passiveState += n
  setCounter(key: string | undefined, v: number): void;
  notes: string[]; // short UI popups
  readonly round: number;
  readonly race: number; // 0..3, 3 = boss
  readonly isBoss: boolean;
  readonly heat: number;
  readonly sellingSelf: boolean; // onSell: true when THIS passive is the one being sold
  readonly run: Readonly<RunState>;
  readonly state: Readonly<RunState>; // alias of run
}

/** Run-level passive hooks. Implemented per passive id as PASSIVE_EFFECTS[id].run in src/game/effects.ts. */
export interface RunHooks {
  onRaceWon?(r: RaceResult, run: RunCtx): void;
  onRaceLost?(r: RaceResult, run: RunCtx): void;
  onRaceSkipped?(run: RunCtx): void;
  onShopEnter?(run: RunCtx): void;
  onSell?(kind: 'part' | 'passive', run: RunCtx): void;
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
  /** Set when a boss ended the race early (e.g. 'SUDDEN DEATH'); et is then a placeholder. */
  dnf?: string;
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
  | { kind: 'part'; partId: string; price: number; sold: boolean; deal?: boolean /* Back Room tag: 50% off */ }
  | { kind: 'passive'; passiveId: string; price: number; sold: boolean; edition?: Edition | null }
  | { kind: 'consumable'; consumableId: string; price: number; sold: boolean };

export type PackKind = 'parts' | 'power';
export interface ShopPack {
  kind: PackKind;
  price: number;
  sold: boolean;
}

export type PackCard =
  | { kind: 'part'; partId: string; dealer?: boolean } // dealer: the guaranteed card of your brand
  | { kind: 'passive'; passiveId: string; edition?: Edition | null }
  | { kind: 'consumable'; consumableId: string }
  | { kind: 'tuning' };

export interface ShopState {
  items: ShopItem[]; // 2 parts then 2 powerups
  packs: ShopPack[]; // [parts, power]
  rerollCost: number;
  openPack: { kind: PackKind; cards: PackCard[]; picksLeft?: number } | null; // pack being viewed; picked cards are removed
  freePack: boolean; // run start: the first Power Pack costs $0
  garageOffer: { id: string; price: number; sold: boolean } | null; // first shop of each round only
  freeRerolls: number; // rerolls left at $0 (Reroll Party tag, Reroll Glut); rerollCost still shows the paid price
  paidRerolls: number; // paid rerolls so far this shop (drives rerollCost)
  /** Cash/tuning gained on entering this shop (Savings interest, Tune-Up, passive onShopEnter), for the UI. */
  entryLines: { label: string; amount: number }[];
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
  skipped?: boolean; // skipped for a tag (no race run)
  tag?: string;
}

export type RunPhase = 'shop' | 'staging' | 'race' | 'result' | 'gameover' | 'victory';

export interface RunState {
  seed: string; // human-readable seed shown to the player, e.g. 'K7QX2M'
  rng: number; // current PRNG state (serializable)
  phase: RunPhase;
  cash: number;
  round: number; // 1..4, 5+ in endless
  race: number; // 0..3 within round, 3 = boss
  car: string; // StartingCarDef id
  heat: number; // 0..8
  endless: boolean; // true after continueEndless()
  /** Set once this run has pushed meta's best endless round higher (a tie doesn't count). */
  newEndlessRecord?: boolean;
  /** Set when winning this run unlocked a new heat for its car (the heat number now selectable). */
  newHeatUnlock?: number;
  bosses: string[]; // BossDef ids drawn per round: bosses[round - 1]
  tags: string[]; // held tags (TagDef ids) waiting to trigger
  garage: string[]; // owned GarageDef ids
  parts: Record<SlotId, InstalledPart>;
  passives: string[]; // ordered, max passiveSlots
  passiveEditions: (Edition | null)[]; // parallel to passives
  passiveState: Record<string, number>; // per-run passive counters, keys `${passiveId}` or `${passiveId}:${key}`
  passiveSlots: number; // effective (car + garage)
  consumableSlots: number; // effective (garage)
  consumables: string[]; // max consumableSlots
  tuningCards: number; // unspent tuning cards held
  shop: ShopState | null;
  stagedConsumables: string[]; // consumables chosen at staging for the upcoming race
  mulliganArmed: boolean; // a Mulligan was used at staging and is available for this race
  lastResult: RaceResult | null;
  lastPayout: Payout | null;
  history: RaceRecord[];
  /**
   * Transform moment: set to the brand id when an install (buy / pack pick) completes a 12-part set, i.e. the
   * paragon turns on. The UI plays the transformation and clears it with game.ackParagon(). Not set on load.
   */
  paragonJustUnlocked?: string | null;
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
  kind: 'base' | 'part' | 'tuning' | 'set' | 'paragon' | 'passive' | 'consumable' | 'boss';
  stats: CarStats; // running totals AFTER this step
  disabled?: boolean; // e.g. rightmost passive under Redline Only
}
