// The run: implements GameApi (src/core/api.ts). Scenes read/change the run only through `game`.
import type { ActionResult, FinishOutcome, GameApi } from '../core/api';
import type {
  BossModifierDef,
  OpponentDef,
  RaceRecord,
  RaceResult,
  RaceSetup,
  RunState,
  SlotId,
  StatBreakdownStep,
} from '../core/types';
import { CONTENT, consumableById, opponentFor, partById, passiveById, stockPart } from '../data/content';
import { computeRaceSetup } from './stats';
import { computePayout, partSellValueById, passiveSellValueById } from './economy';
import { makeShop, rollItems, rollPartsPack, rollPowerPack } from './shop';
import { createRun, validateRun, withRng } from './run';
import { clearSavedRun, readSavedRun, Store } from './store';

const fail = (reason: string): ActionResult => ({ ok: false, reason });
const OK: ActionResult = { ok: true };

export const ROUNDS = 4;
export const RACES_PER_ROUND = 4; // race index 3 = boss

export function isMulligan(consumableId: string): boolean {
  if (consumableId === 'mulligan') return true;
  return consumableById(consumableId)?.name.toLowerCase() === 'mulligan';
}

/** Extra helpers beyond the shared contract (optional for scenes to use). */
export interface RevlottoGame extends GameApi {
  /** True if consumables[index] is staged for the next race (handles duplicate ids by occurrence). */
  isConsumableStaged(index: number): boolean;
  canAfford(price: number): boolean;
  /** 1-based race number within the run (1..16). */
  raceNumber(): number;
  isBossRace(): boolean;
  /** Drop the saved run (e.g. after game over, or 'New run' from a menu). */
  abandonRun(): void;
}

const store = new Store(createInitialRun());

function createInitialRun(): RunState {
  try {
    return createRun();
  } catch (e) {
    // Keep module import safe even if content failed to load; newRun() will retry.
    console.error('[game] failed to create initial run', e);
    return {
      seed: 'AAAAAA', rng: 1, phase: 'shop', cash: 0, round: 1, race: 0,
      parts: {} as RunState['parts'], passives: [], consumables: [], tuningCards: 0, shop: null,
      stagedConsumables: [], mulliganArmed: false, lastResult: null, lastPayout: null, history: [],
    };
  }
}

const S = () => store.state;
const commit = () => store.commit();
const limits = () => CONTENT.balance.limits;

function shopError(): string | null {
  const s = S();
  if (s.phase !== 'shop' || !s.shop) return 'Not in the shop';
  return null;
}

/** Install a part, auto-selling whatever was in the slot (50%, Stock = $0). Returns the refund. */
function installPart(partId: string): number {
  const s = S();
  const def = partById(partId);
  const old = s.parts[def.slot];
  const refund = old ? partSellValueById(old.partId) : 0;
  s.parts[def.slot] = { partId, level: 0 };
  s.cash += refund;
  return refund;
}

function count(arr: string[], id: string): number {
  return arr.reduce((n, x) => n + (x === id ? 1 : 0), 0);
}
function countUpTo(arr: string[], id: string, index: number): number {
  let n = 0;
  for (let i = 0; i <= index && i < arr.length; i++) if (arr[i] === id) n++;
  return n;
}
function removeOne(arr: string[], id: string): boolean {
  const i = arr.indexOf(id);
  if (i < 0) return false;
  arr.splice(i, 1);
  return true;
}

/** Staged ids may not exceed what is in inventory (per id). */
function normalizeStaged(): void {
  const s = S();
  const out: string[] = [];
  for (const id of s.stagedConsumables) if (count(out, id) < count(s.consumables, id)) out.push(id);
  s.stagedConsumables = out;
}

function computeSetup(): { setup: RaceSetup; breakdown: StatBreakdownStep[] } {
  return computeRaceSetup(S(), { includeStaged: true });
}

function record(s: RunState, opp: OpponentDef | undefined, r: RaceResult, cashEarned: number): RaceRecord {
  return {
    round: s.round,
    race: s.race,
    opponent: opp?.name ?? '???',
    targetEt: r.targetEt,
    et: r.et,
    won: r.won,
    reaction: r.reaction,
    perfectCount: r.perfectCount,
    cashEarned,
  };
}

export const game: RevlottoGame = {
  get state() {
    return store.state;
  },

  subscribe(cb) {
    return store.subscribe(cb);
  },

  newRun(seed?: string) {
    store.replace(createRun(seed));
  },

  // ---------- Content lookups ----------
  part: (id) => partById(id),
  passive: (id) => passiveById(id),
  consumable: (id) => consumableById(id),
  currentOpponent: () => opponentFor(S().round, S().race),
  bossModifier(id): BossModifierDef | undefined {
    if (!id) return undefined;
    return CONTENT.bossModifiers.find((b) => b.id === id);
  },

  // ---------- Shop ----------
  buyItem(index) {
    const err = shopError();
    if (err) return fail(err);
    const s = S();
    const shop = s.shop!;
    if (shop.openPack) return fail('Finish the open pack first');
    const item = shop.items[index];
    if (!item) return fail('No such item');
    if (item.sold) return fail('Already bought');
    if (s.cash < item.price) return fail(`Need $${item.price}`);
    if (item.kind === 'part') {
      if (s.parts[partById(item.partId).slot]?.partId === item.partId) return fail('Already installed');
      s.cash -= item.price;
      item.sold = true;
      installPart(item.partId);
    } else if (item.kind === 'passive') {
      if (s.passives.includes(item.passiveId)) return fail('Already owned');
      if (s.passives.length >= limits().passiveSlots)
        return fail(`Passive slots full (${limits().passiveSlots}). Sell one first`);
      s.cash -= item.price;
      item.sold = true;
      s.passives.push(item.passiveId);
    } else {
      if (s.consumables.length >= limits().consumableSlots)
        return fail(`Consumable slots full (${limits().consumableSlots}). Discard one first`);
      s.cash -= item.price;
      item.sold = true;
      s.consumables.push(item.consumableId);
    }
    commit();
    return OK;
  },

  buyPack(index) {
    const err = shopError();
    if (err) return fail(err);
    const s = S();
    const shop = s.shop!;
    if (shop.openPack) return fail('A pack is already open');
    const pack = shop.packs[index];
    if (!pack) return fail('No such pack');
    if (pack.sold) return fail('Already bought');
    if (s.cash < pack.price) return fail(`Need $${pack.price}`);
    const cards = withRng(s, (rng) => (pack.kind === 'parts' ? rollPartsPack(s, rng) : rollPowerPack(s, rng)));
    if (!cards.length) return fail('Nothing left to offer');
    s.cash -= pack.price;
    pack.sold = true;
    if (pack.kind === 'power') shop.freePack = false;
    shop.openPack = { kind: pack.kind, cards };
    commit();
    return OK;
  },

  pickPackCard(index) {
    const err = shopError();
    if (err) return fail(err);
    const s = S();
    const shop = s.shop!;
    const open = shop.openPack;
    if (!open) return fail('No pack open');
    const card = open.cards[index];
    if (!card) return fail('No such card');
    switch (card.kind) {
      case 'part':
        if (s.parts[partById(card.partId).slot]?.partId === card.partId) return fail('Already installed');
        installPart(card.partId);
        break;
      case 'passive':
        if (s.passives.includes(card.passiveId)) return fail('Already owned');
        if (s.passives.length >= limits().passiveSlots)
          return fail(`Passive slots full (${limits().passiveSlots}). Sell one first`);
        s.passives.push(card.passiveId);
        break;
      case 'consumable':
        if (s.consumables.length >= limits().consumableSlots)
          return fail(`Consumable slots full (${limits().consumableSlots}). Discard one first`);
        s.consumables.push(card.consumableId);
        break;
      case 'tuning':
        s.tuningCards += 1;
        break;
    }
    shop.openPack = null;
    commit();
    return OK;
  },

  skipPack() {
    const shop = S().shop;
    if (!shop || !shop.openPack) return;
    shop.openPack = null;
    commit();
  },

  reroll() {
    const err = shopError();
    if (err) return fail(err);
    const s = S();
    const shop = s.shop!;
    if (shop.openPack) return fail('Finish the open pack first');
    if (s.cash < shop.rerollCost) return fail(`Need $${shop.rerollCost}`);
    s.cash -= shop.rerollCost;
    shop.rerollCost += CONTENT.balance.prices.rerollStep;
    shop.items = withRng(s, (rng) => rollItems(s, rng));
    commit();
    return OK;
  },

  sellPart(slot: SlotId) {
    const s = S();
    if (s.phase !== 'shop') return fail('Can only sell in the shop');
    const ip = s.parts[slot];
    if (!ip) return fail('Empty slot');
    if (partById(ip.partId).tier === 'stock') return fail('Stock parts cannot be sold');
    s.cash += partSellValueById(ip.partId);
    s.parts[slot] = { partId: stockPart(slot).id, level: 0 };
    commit();
    return OK;
  },

  sellPassive(index) {
    const s = S();
    if (s.phase !== 'shop') return fail('Can only sell in the shop');
    const id = s.passives[index];
    if (!id) return fail('No passive there');
    s.cash += passiveSellValueById(id);
    s.passives.splice(index, 1);
    commit();
    return OK;
  },

  discardConsumable(index) {
    const s = S();
    if (s.phase === 'race') return;
    if (index < 0 || index >= s.consumables.length) return;
    s.consumables.splice(index, 1);
    normalizeStaged();
    commit();
  },

  movePassive(from, to) {
    const s = S();
    if (s.phase === 'race') return;
    const n = s.passives.length;
    if (from < 0 || from >= n) return;
    const dest = Math.max(0, Math.min(n - 1, to));
    if (dest === from) return;
    const [id] = s.passives.splice(from, 1);
    s.passives.splice(dest, 0, id);
    commit();
  },

  applyTuning(slot: SlotId) {
    const s = S();
    if (s.phase !== 'shop' && s.phase !== 'staging') return fail('Can only tune in the shop');
    if (s.tuningCards <= 0) return fail('No tuning cards');
    const ip = s.parts[slot];
    if (!ip || partById(ip.partId).tier === 'stock') return fail('Tune an upgraded (non-Stock) part');
    if (ip.level >= limits().maxTuning) return fail(`Already max level (${limits().maxTuning})`);
    ip.level += 1;
    s.tuningCards -= 1;
    commit();
    return OK;
  },

  partSellValue(slot: SlotId) {
    const ip = S().parts[slot];
    return ip ? partSellValueById(ip.partId) : 0;
  },

  passiveSellValue(index) {
    const id = S().passives[index];
    return id ? passiveSellValueById(id) : 0;
  },

  leaveShop() {
    const s = S();
    if (s.phase !== 'shop') return;
    if (s.shop) s.shop.openPack = null;
    s.stagedConsumables = [];
    s.mulliganArmed = false;
    s.phase = 'staging';
    commit();
  },

  // ---------- Staging ----------
  toggleStagedConsumable(index) {
    const s = S();
    if (s.phase !== 'staging') return;
    const id = s.consumables[index];
    if (!id) return;
    if (game.isConsumableStaged(index)) removeOne(s.stagedConsumables, id);
    else s.stagedConsumables.push(id);
    normalizeStaged();
    commit();
  },

  isConsumableStaged(index) {
    const s = S();
    const id = s.consumables[index];
    if (!id) return false;
    return count(s.stagedConsumables, id) >= countUpTo(s.consumables, id, index);
  },

  previewStats() {
    return computeSetup();
  },

  /**
   * Phase 'staging': computes the setup (staged consumables included) and THEN consumes them -> 'race'.
   * Phase 'race' (Mulligan rerun, or a reloaded save): returns the same race's setup again without
   * consuming anything (stagedConsumables are kept until the race is resolved).
   */
  startRace(): RaceSetup {
    const s = S();
    if (s.phase === 'race') return computeSetup().setup;
    normalizeStaged();
    const { setup } = computeSetup();
    for (const id of s.stagedConsumables) removeOne(s.consumables, id);
    s.mulliganArmed = s.stagedConsumables.some(isMulligan);
    s.phase = 'race';
    commit();
    return setup;
  },

  // ---------- Race end ----------
  finishRace(result: RaceResult): FinishOutcome {
    const s = S();
    let opp: OpponentDef | undefined;
    try {
      opp = opponentFor(s.round, s.race);
    } catch {
      opp = undefined;
    }
    const isBoss = s.race === RACES_PER_ROUND - 1;
    const isFinal = isBoss && s.round === ROUNDS;
    s.lastResult = result;

    if (result.won) {
      const payout = computePayout(result, isBoss, isFinal);
      s.cash += payout.total;
      s.lastPayout = payout;
      s.history.push(record(s, opp, result, payout.total));
      s.mulliganArmed = false;
      s.phase = 'result';
      commit();
      return { payout, next: 'result', mulliganUsed: false };
    }

    s.history.push(record(s, opp, result, 0));
    s.lastPayout = null;
    if (s.mulliganArmed) {
      s.mulliganArmed = false;
      s.phase = 'race'; // rerun: call game.startRace() again for a fresh setup
      commit();
      return { payout: null, next: 'race', mulliganUsed: true };
    }
    s.phase = 'result';
    commit();
    return { payout: null, next: 'result', mulliganUsed: false };
  },

  continueFromResult() {
    const s = S();
    if (s.phase !== 'result') return;
    const won = !!s.lastResult?.won;
    s.stagedConsumables = [];
    s.mulliganArmed = false;
    if (!won) {
      s.phase = 'gameover';
      commit();
      return;
    }
    if (s.race >= RACES_PER_ROUND - 1) {
      if (s.round >= ROUNDS) {
        s.phase = 'victory';
        commit();
        return;
      }
      s.round += 1;
      s.race = 0;
    } else {
      s.race += 1;
    }
    s.phase = 'shop';
    withRng(s, (rng) => {
      s.shop = makeShop(s, rng, false);
    });
    commit();
  },

  // ---------- Extras ----------
  canAfford: (price) => S().cash >= price,
  raceNumber: () => (S().round - 1) * RACES_PER_ROUND + S().race + 1,
  isBossRace: () => S().race === RACES_PER_ROUND - 1,
  abandonRun() {
    clearSavedRun();
  },
};

/** True if localStorage holds a run that can be continued (not finished). */
export function hasSavedRun(): boolean {
  const raw = readSavedRun();
  if (!raw || typeof raw !== 'object') return false;
  const s = validateRun(structuredClone(raw));
  return !!s && s.phase !== 'gameover' && s.phase !== 'victory';
}

/**
 * Load the saved run into `game` (title-screen "Continue"). Returns false and leaves the current run
 * alone if there is nothing valid to continue. Then route with goToPhase(); phase 'race' works because
 * startRace() re-derives the setup in that phase.
 */
export function loadSavedRun(): boolean {
  const s = validateRun(readSavedRun());
  if (!s || s.phase === 'gameover' || s.phase === 'victory') return false;
  store.replace(s);
  return true;
}
