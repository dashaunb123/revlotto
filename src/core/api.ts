// The only way scenes read or change the run. Implemented in src/game/game.ts (exported as `game`).
import type {
  BossModifierDef,
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

  newRun(seed?: string): void;

  // Content lookups
  part(id: string): PartDef;
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
  leaveShop(): void; // -> 'staging'

  // Staging (phase 'staging')
  toggleStagedConsumable(index: number): void; // index into state.consumables
  previewStats(): { breakdown: StatBreakdownStep[]; setup: RaceSetup };
  startRace(): RaceSetup; // consumes staged consumables, -> 'race'

  // Race end
  finishRace(result: RaceResult): FinishOutcome;
  continueFromResult(): void; // -> 'shop' (fresh shop) | 'gameover' | 'victory'
}
