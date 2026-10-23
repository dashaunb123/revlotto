// The only way scenes read or change the run. Implemented in src/game/game.ts (exported as `game`).
import type {
  BossDef,
  BrandDef,
  BossModifierDef,
  GarageDef,
  HeatDef,
  MetaState,
  StartingCarDef,
  TagDef,
  ConsumableDef,
  OpponentDef,
  PartDef,
  PassiveDef,
  Payout,
  RaceResult,
  RaceSetup,
  RunPhase,
  RunState,
  SlotId,
  StatBreakdownStep,
} from './types';

export type ActionResult = { ok: true } | { ok: false; reason: string };

export interface FinishOutcome {
  payout: Payout | null; // null on a loss
  next: RunPhase; // 'result' normally; 'race' when a Mulligan triggers a rerun
  mulliganUsed: boolean;
}

export interface GameApi {
  readonly state: RunState;
  /** Called after every state change. Returns an unsubscribe function. */
  subscribe(cb: (s: RunState) => void): () => void;

  /** Car must be a StartingCarDef id (default 'daily_driver'); heat is clamped to 0..8. Unlock checks are the UI's job. */
  newRun(seed?: string, opts?: { car?: string; heat?: number }): void;

  // Meta + run-setup content
  meta(): MetaState; // read-only meta progression
  startingCars(): StartingCarDef[]; // with unlocked / bestHeat filled
  heatLevels(): HeatDef[]; // with unlocked filled
  tag(id: string): TagDef;
  garageUpgrade(id: string): GarageDef;
  boss(id: string): BossDef;

  // Content lookups
  part(id: string): PartDef;
  /** Brand lookup; undefined for stock parts (part.brand unset) or unknown ids. */
  brand(id: string | undefined): BrandDef | undefined;
  /** All 8 brands, street → sport → pro. */
  brands(): BrandDef[];
  /** Installed part count per brand id (only brands with >= 1 part). */
  brandCounts(): Record<string, number>;
  /**
   * Brand id whose paragon is active (all 12 slots), else null. A pure function of the installed parts: selling or
   * replacing any of its parts turns it off. To detect a LOSS, compare activeParagon() (or setLevel) before/after a
   * sellPart / buy / pack pick. A GAIN sets state.paragonJustUnlocked = brandId (+ a 'PARAGON: ...' run note).
   */
  activeParagon(): string | null;
  /** Clear state.paragonJustUnlocked once the transform moment has played. */
  ackParagon(): void;
  passive(id: string): PassiveDef;
  consumable(id: string): ConsumableDef;
  currentOpponent(): OpponentDef;
  bossModifier(id: string | undefined): BossModifierDef | undefined;

  // Shop (phase 'shop')
  buyItem(index: number): ActionResult; // loose items in state.shop.items
  buyPack(index: number): ActionResult; // opens it into state.shop.openPack
  pickPackCard(index: number): ActionResult; // parts install immediately, others go to inventory
  skipPack(): void;
  reroll(): ActionResult;
  sellPart(slot: SlotId): ActionResult; // reverts slot to its Stock part, refunds 50%
  sellPassive(index: number): ActionResult;
  discardConsumable(index: number): void;
  movePassive(from: number, to: number): void;
  applyTuning(slot: SlotId): ActionResult; // spends one tuning card
  partSellValue(slot: SlotId): number;
  passiveSellValue(index: number): number;
  buyGarage(): ActionResult; // buys state.shop.garageOffer
  leaveShop(): void; // -> 'staging'

  // Staging (phase 'staging')
  toggleStagedConsumable(index: number): void; // index into state.consumables
  previewStats(): { breakdown: StatBreakdownStep[]; setup: RaceSetup };
  startRace(): RaceSetup; // consumes staged consumables, -> 'race'
  skipRace(): ActionResult; // staging, regular races only: no race, no payout, no shop; gain skipTagPreview()
  skipTagPreview(): TagDef | null; // tag you'd get for skipping the current race (null on boss races)

  // Race end
  finishRace(result: RaceResult): FinishOutcome;
  continueFromResult(): void; // -> 'shop' (fresh shop) | 'gameover' | 'victory'
  continueEndless(): void; // phase 'victory' -> round 5+ shop (endless). Pays the final boss's boss-win cash.
}
