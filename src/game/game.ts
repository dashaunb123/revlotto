// The run: implements GameApi (src/core/api.ts). Scenes read/change the run only through `game`.
import type { ActionResult, FinishOutcome, GameApi } from '../core/api';
import type {
  BossModifierDef,
  Edition,
  OpponentDef,
  Payout,
  RaceRecord,
  RaceResult,
  RaceSetup,
  RunCtx,
  RunHooks,
  RunState,
  SlotId,
  StatBreakdownStep,
} from '../core/types';
import {
  CONTENT,
  bossById,
  brandById,
  consumableById,
  garageById,
  partById,
  passiveById,
  startingCarById,
  stockPart,
  tagById,
} from '../data/content';
import { computeRaceSetup } from './stats';
import { computePayout, owns, partSellValueById, passiveSellValueById, rerollPrice } from './economy';
import { makeShop, repriceShop, rollConsumable, rollDealPart, rollItems, rollPartsPack, rollPowerPack, packPicks, bannedConsumables } from './shop';
import {
  RACES_PER_ROUND,
  ROUNDS,
  createRun,
  ensureBoss,
  refreshSlots,
  runOpponent,
  skipTagFor,
  validateRun,
  withRng,
} from './run';
import { clearSavedRun, readSavedRun, Store } from './store';
import { passiveRunHooks } from './effects';
import { activeParagon, brandCounts } from './brands';
import {
  discoverPassive,
  getMeta,
  heatUnlockedFor,
  isCarUnlocked,
  recordBossBeaten,
  recordEndlessRound,
  recordRunStarted,
  recordRunWon,
} from './meta';

export { ROUNDS, RACES_PER_ROUND } from './run';

const fail = (reason: string): ActionResult => ({ ok: false, reason });
const OK: ActionResult = { ok: true };

export function isMulligan(consumableId: string): boolean {
  if (consumableId === 'mulligan') return true;
  return consumableById(consumableId)?.name.toLowerCase() === 'mulligan';
}

/** Extra helpers beyond the shared contract (optional for scenes to use). */
export interface RevlottoGame extends GameApi {
  /** True if consumables[index] is staged for the next race (handles duplicate ids by occurrence). */
  isConsumableStaged(index: number): boolean;
  canAfford(price: number): boolean;
  /** 1-based race number within the run (1..16, more in endless). */
  raceNumber(): number;
  isBossRace(): boolean;
  /** True on the round-4 boss outside endless (beating it wins the run). */
  isFinalBoss(): boolean;
  /** Drop the saved run (e.g. after game over, or 'New run' from a menu). */
  abandonRun(): void;
  /** Notes pushed by run-level passive hooks since the last call (UI popups); clears them. */
  takeRunNotes(): string[];
}

const store = new Store(createInitialRun());

function createInitialRun(): RunState {
  try {
    return createRun();
  } catch (e) {
    // Keep module import safe even if content failed to load; newRun() will retry.
    console.error('[game] failed to create initial run', e);
    return {
      seed: 'AAAAAA', rng: 1, phase: 'shop', cash: 0, round: 1, race: 0, car: 'daily_driver', heat: 0, endless: false,
      bosses: [], tags: [], garage: [], passiveEditions: [], passiveState: {}, passiveSlots: 5, consumableSlots: 2,
      parts: {} as RunState['parts'], passives: [], consumables: [], tuningCards: 0, shop: null,
      stagedConsumables: [], mulliganArmed: false, lastResult: null, lastPayout: null, history: [],
    };
  }
}

const S = () => store.state;
const commit = () => store.commit();
const limits = () => CONTENT.balance.limits;
let runNotes: string[] = [];

function shopError(): string | null {
  const s = S();
  if (s.phase !== 'shop' || !s.shop) return 'Not in the shop';
  return null;
}

// ---------- Run-level passive hooks ----------

function makeCtx(s: RunState, id: string, index: number, lines: Payout['lines'] | null, sellingSelf = false): RunCtx {
  const key = (k?: string) => (k ? `${id}:${k}` : id);
  const name = (() => {
    try {
      return passiveById(id).name;
    } catch {
      return id;
    }
  })();
  return {
    id,
    index,
    edition: s.passiveEditions[index] ?? null,
    get cash() {
      return s.cash;
    },
    addCash(n: number) {
      n = Math.floor(n);
      if (!n) return;
      if (n < 0) n = Math.max(n, -s.cash); // cash never goes negative
      s.cash += n;
      lines?.push({ label: name, amount: n });
    },
    counter: (k?: string) => s.passiveState[key(k)] ?? 0,
    bump(k: string | undefined, n: number) {
      s.passiveState[key(k)] = (s.passiveState[key(k)] ?? 0) + n;
    },
    setCounter(k: string | undefined, v: number) {
      s.passiveState[key(k)] = v;
    },
    notes: runNotes,
    round: s.round,
    race: s.race,
    isBoss: s.race === RACES_PER_ROUND - 1,
    heat: s.heat,
    sellingSelf,
    run: s,
    state: s,
  };
}

/** Call one run hook on every owned passive, left to right. Returns the cash lines produced. */
function fireRunHook(fire: (h: RunHooks, ctx: RunCtx) => void, lines: Payout['lines'] = []): Payout['lines'] {
  const s = S();
  for (const { id, index, hooks } of passiveRunHooks(s)) {
    try {
      fire(hooks, makeCtx(s, id, index, lines));
    } catch (e) {
      console.error(`[game] run hook of ${id} threw`, e);
    }
  }
  return lines;
}

// ---------- Inventory helpers ----------

/** Install a part, auto-selling whatever was in the slot (50%, Stock = $0). Returns the refund. */
function installPart(partId: string): number {
  const s = S();
  const def = partById(partId);
  const old = s.parts[def.slot];
  const replaced = !!old && partById(old.partId).tier !== 'stock';
  const refund = old ? partSellValueById(old.partId) : 0;
  const paragonBefore = activeParagon(s.parts);
  s.parts[def.slot] = { partId, level: 0 };
  s.cash += refund;
  const paragonAfter = activeParagon(s.parts);
  if (paragonAfter && paragonAfter !== paragonBefore) {
    // Transform moment: the UI reacts to state.paragonJustUnlocked (and the note), then calls ackParagon().
    s.paragonJustUnlocked = paragonAfter;
    runNotes.push(`PARAGON: ${brandById(paragonAfter)?.paragon.name.toUpperCase() ?? paragonAfter}`);
  }
  if (replaced) fireRunHook((h, c) => h.onSell?.('part', c));
  if (s.shop) repriceShop(s, s.shop); // brand loyalty discounts follow what's installed
  return refund;
}

function passiveSlotsError(): string | null {
  const s = S();
  return s.passives.length >= s.passiveSlots ? `Passive slots full (${s.passiveSlots}). Sell one first` : null;
}

function addPassive(id: string, edition: Edition | null | undefined): void {
  const s = S();
  s.passives.push(id);
  s.passiveEditions.push(edition ?? null);
  discoverPassive(id);
}

function clearPassiveState(s: RunState, id: string): void {
  for (const k of Object.keys(s.passiveState)) if (k === id || k.startsWith(id + ':')) delete s.passiveState[k];
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
function takeTag(s: RunState, id: string): boolean {
  return removeOne(s.tags, id);
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

const isBoss = (s: RunState) => s.race === RACES_PER_ROUND - 1;
const isFinal = (s: RunState) => isBoss(s) && s.round === ROUNDS && !s.endless;

// ---------- Shop entry ----------

/** Open a fresh shop: interest, Tune-Up, tags, then passive onShopEnter hooks. */
function openShop(s: RunState, firstOfRound: boolean): void {
  const lines: Payout['lines'] = [];
  if (owns(s, 'savings')) {
    const cap = owns(s, 'high_yield') ? 10 : 5;
    const interest = Math.min(cap, Math.floor(s.cash / 5));
    if (interest > 0) {
      s.cash += interest;
      lines.push({ label: 'Savings interest', amount: interest });
    }
  }
  if (firstOfRound && owns(s, 'tune_up')) {
    s.tuningCards += 1;
    lines.push({ label: 'Tune-Up: +1 tuning card', amount: 0 });
  }
  withRng(s, (rng) => {
    const shop = makeShop(s, rng, false, firstOfRound);
    if (takeTag(s, 'free_parts_pack')) shop.packs[0].price = 0;
    if (takeTag(s, 'free_power_pack')) shop.packs[1].price = 0;
    if (takeTag(s, 'reroll_party')) shop.freeRerolls += 2;
    if (s.tags.includes('rare_part')) {
      const taken = new Set(shop.items.flatMap((it) => (it.kind === 'part' ? [it.partId] : [])));
      const deal = rollDealPart(s, rng, taken);
      if (deal) {
        shop.items.unshift(deal);
        takeTag(s, 'rare_part');
      }
    }
    s.shop = shop;
  });
  s.phase = 'shop';
  fireRunHook((h, c) => h.onShopEnter?.(c), lines);
  s.shop!.entryLines = lines;
}

/** Advance after a won race (or a skip, which never reaches a boss): next race or next round. */
function startNextRound(s: RunState): void {
  s.round += 1;
  s.race = 0;
  ensureBoss(s, s.round);
  recordEndlessRound(s);
}

/** Garage upgrade effects that kick in the moment it's bought. */
function applyGarageNow(s: RunState, id: string): void {
  refreshSlots(s);
  const shop = s.shop;
  if (id === 'tune_up') s.tuningCards += 1;
  if (!shop) return;
  if (id === 'reroll_glut') shop.freeRerolls += 1;
  if (id === 'extra_shelf' || id === 'showroom') {
    // Add the new slot's item right away (extra_shelf: powerup, showroom: part).
    withRng(s, (rng) => {
      const before = shop.items.length;
      const fresh = rollItems(s, rng);
      const want = id === 'extra_shelf' ? 'powerup' : 'part';
      const have = new Set(shop.items.map((it) => (it.kind === 'part' ? it.partId : it.kind === 'passive' ? it.passiveId : it.consumableId)));
      const pick = fresh.find((it) => (want === 'part' ? it.kind === 'part' : it.kind !== 'part') && !have.has(it.kind === 'part' ? it.partId : it.kind === 'passive' ? it.passiveId : it.consumableId));
      if (pick && shop.items.length === before) shop.items.push(pick);
    });
  }
  repriceShop(s, shop);
}

export const game: RevlottoGame = {
  get state() {
    return store.state;
  },

  subscribe(cb) {
    return store.subscribe(cb);
  },

  newRun(seed?: string, opts?: { car?: string; heat?: number }) {
    runNotes = [];
    store.replace(createRun(seed, opts));
    recordRunStarted();
  },

  // ---------- Content lookups ----------
  part: (id) => partById(id),
  brand: (id) => brandById(id),
  brands: () => CONTENT.brands,
  brandCounts: () => brandCounts(S().parts),
  activeParagon: () => activeParagon(S().parts),
  ackParagon() {
    if (!S().paragonJustUnlocked) return;
    S().paragonJustUnlocked = null;
    commit();
  },
  passive: (id) => passiveById(id),
  consumable: (id) => consumableById(id),
  currentOpponent: () => runOpponent(S()),
  bossModifier(id): BossModifierDef | undefined {
    if (!id) return undefined;
    return CONTENT.bossModifiers.find((b) => b.id === id);
  },
  tag: (id) => tagById(id),
  garageUpgrade: (id) => garageById(id),
  boss: (id) => bossById(id),

  // ---------- Meta ----------
  meta: () => getMeta(),
  startingCars() {
    const m = getMeta();
    return CONTENT.startingCars.map((c) => ({
      ...c,
      unlocked: isCarUnlocked(c, m),
      bestHeat: m.bestHeatByCar[c.id] ?? null,
      maxHeat: heatUnlockedFor(c.id, m),
      bestEndlessRound: m.bestEndlessRoundByCar[c.id] ?? 0,
    }));
  },
  heatLevels(car) {
    const m = getMeta();
    const max = car ? heatUnlockedFor(car, m) : m.heatUnlocked;
    return CONTENT.heat.map((h) => ({ ...h, unlocked: h.level <= max }));
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
      const full = passiveSlotsError();
      if (full) return fail(full);
      s.cash -= item.price;
      item.sold = true;
      addPassive(item.passiveId, item.edition);
    } else {
      if (s.consumables.length >= s.consumableSlots)
        return fail(`Consumable slots full (${s.consumableSlots}). Discard one first`);
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
    shop.openPack = { kind: pack.kind, cards, picksLeft: Math.min(packPicks(s), cards.length) };
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
      case 'passive': {
        if (s.passives.includes(card.passiveId)) return fail('Already owned');
        const full = passiveSlotsError();
        if (full) return fail(full);
        addPassive(card.passiveId, card.edition);
        break;
      }
      case 'consumable':
        if (s.consumables.length >= s.consumableSlots)
          return fail(`Consumable slots full (${s.consumableSlots}). Discard one first`);
        s.consumables.push(card.consumableId);
        break;
      case 'tuning':
        s.tuningCards += 1;
        break;
    }
    open.cards.splice(index, 1);
    open.picksLeft = (open.picksLeft ?? 1) - 1;
    if (open.picksLeft <= 0 || !open.cards.length) shop.openPack = null;
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
    if (shop.freeRerolls > 0) {
      shop.freeRerolls -= 1;
    } else {
      if (s.cash < shop.rerollCost) return fail(`Need $${shop.rerollCost}`);
      s.cash -= shop.rerollCost;
      shop.paidRerolls += 1;
      shop.rerollCost = rerollPrice(s, shop.paidRerolls);
    }
    shop.items = withRng(s, (rng) => rollItems(s, rng));
    commit();
    return OK;
  },

  buyGarage() {
    const err = shopError();
    if (err) return fail(err);
    const s = S();
    const shop = s.shop!;
    if (shop.openPack) return fail('Finish the open pack first');
    const offer = shop.garageOffer;
    if (!offer) return fail('No garage upgrade on offer');
    if (offer.sold) return fail('Already bought');
    if (s.garage.includes(offer.id)) return fail('Already owned');
    if (s.cash < offer.price) return fail(`Need $${offer.price}`);
    s.cash -= offer.price;
    offer.sold = true;
    takeTag(s, 'garage_coupon');
    s.garage.push(offer.id);
    applyGarageNow(s, offer.id);
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
    fireRunHook((h, c) => h.onSell?.('part', c));
    if (s.shop) repriceShop(s, s.shop);
    commit();
    return OK;
  },

  sellPassive(index) {
    const s = S();
    if (s.phase !== 'shop') return fail('Can only sell in the shop');
    const id = s.passives[index];
    if (!id) return fail('No passive there');
    s.cash += game.passiveSellValue(index);
    // The sold passive hears its own sale first, then the rest hear it after it's gone.
    const own = passiveRunHooks(s).find((h) => h.index === index);
    if (own) {
      try {
        own.hooks.onSell?.('passive', makeCtx(s, id, index, null, true));
      } catch (e) {
        console.error(`[game] onSell of ${id} threw`, e);
      }
    }
    s.passives.splice(index, 1);
    s.passiveEditions.splice(index, 1);
    clearPassiveState(s, id);
    fireRunHook((h, c) => h.onSell?.('passive', c));
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
    const [ed] = s.passiveEditions.splice(from, 1);
    s.passiveEditions.splice(dest, 0, ed ?? null);
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
    const s = S();
    const id = s.passives[index];
    return id ? passiveSellValueById(id, s.passiveEditions[index] ?? null, s) : 0;
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
    if (takeTag(s, 'mulligan')) s.mulliganArmed = true; // Safety Net tag
    s.phase = 'race';
    commit();
    return setup;
  },

  skipTagPreview() {
    const s = S();
    if (s.phase !== 'staging') return null;
    return skipTagFor(s);
  },

  skipRace() {
    const s = S();
    if (s.phase !== 'staging') return fail('Can only skip from staging');
    if (isBoss(s)) return fail("Bosses can't be skipped");
    const tag = skipTagFor(s);
    if (!tag) return fail('Nothing to skip');
    let opp: OpponentDef | undefined;
    try {
      opp = runOpponent(s);
    } catch {
      opp = undefined;
    }
    s.history.push({
      round: s.round, race: s.race, opponent: opp?.name ?? '???', targetEt: opp?.targetEt ?? 0, et: 0, won: true,
      reaction: 0, perfectCount: 0, cashEarned: 0, skipped: true, tag: tag.id,
    });
    // Immediate tags; the rest are held until they trigger.
    if (tag.id === 'tuning_card') s.tuningCards += 1;
    else if (tag.id === 'extra_consumable') {
      withRng(s, (rng) => {
        const banned = bannedConsumables(s);
        for (let i = 0; i < 2 && s.consumables.length < s.consumableSlots; i++) {
          const id = rollConsumable(rng, new Set(), banned);
          if (id) s.consumables.push(id);
        }
      });
    } else s.tags.push(tag.id);
    fireRunHook((h, c) => h.onRaceSkipped?.(c));
    s.stagedConsumables = [];
    s.mulliganArmed = false;
    s.race += 1; // never past the boss: bosses can't be skipped
    commit();
    return OK;
  },

  // ---------- Race end ----------
  finishRace(result: RaceResult): FinishOutcome {
    const s = S();
    let opp: OpponentDef | undefined;
    try {
      opp = runOpponent(s);
    } catch {
      opp = undefined;
    }
    const boss = isBoss(s);
    const final = isFinal(s);
    s.lastResult = result;

    if (result.won) {
      const payout = computePayout(result, boss, final, s.heat);
      s.cash += payout.total;
      const extra = (label: string, amount: number) => {
        if (amount <= 0) return;
        s.cash += amount;
        payout.lines.push({ label, amount });
        payout.total += amount;
      };
      if (takeTag(s, 'double_cash')) extra('Double Down', payout.total);
      if (boss && takeTag(s, 'investment')) extra('Investment', 15);
      // Run hooks see the race before the counters advance (isBoss correct). Their cash joins the tally.
      const lines = fireRunHook((h, c) => h.onRaceWon?.(result, c));
      for (const l of lines) {
        payout.lines.push(l);
        payout.total += l.amount;
      }
      s.lastPayout = payout;
      s.history.push(record(s, opp, result, payout.total));
      s.mulliganArmed = false;
      if (boss) recordBossBeaten(s.round);
      if (final) recordRunWon(s);
      s.phase = 'result';
      commit();
      return { payout, next: 'result', mulliganUsed: false };
    }

    fireRunHook((h, c) => h.onRaceLost?.(result, c));
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
      recordEndlessRound(s);
      s.phase = 'gameover';
      commit();
      return;
    }
    let firstOfRound = false;
    if (isBoss(s)) {
      if (isFinal(s)) {
        s.phase = 'victory';
        commit();
        return;
      }
      startNextRound(s);
      firstOfRound = true;
    } else {
      s.race += 1;
    }
    openShop(s, firstOfRound);
    commit();
  },

  continueEndless() {
    const s = S();
    if (s.phase !== 'victory' || s.endless) return;
    s.endless = true;
    // The final boss paid $0 because it "ended the run"; keep racing and it pays like a boss.
    const pay = CONTENT.balance.economy.bossWin;
    s.cash += pay;
    s.stagedConsumables = [];
    s.mulliganArmed = false;
    startNextRound(s);
    openShop(s, true);
    s.shop!.entryLines.unshift({ label: 'Final boss bounty', amount: pay });
    commit();
  },

  // ---------- Extras ----------
  canAfford: (price) => S().cash >= price,
  raceNumber: () => (S().round - 1) * RACES_PER_ROUND + S().race + 1,
  isBossRace: () => isBoss(S()),
  isFinalBoss: () => isFinal(S()),
  abandonRun() {
    clearSavedRun();
  },
  takeRunNotes() {
    const out = runNotes.splice(0);
    return out;
  },
};

/** For tests/tools: is this car usable right now (meta unlock)? */
export function carUnlocked(id: string): boolean {
  return isCarUnlocked(startingCarById(id), getMeta());
}

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
 * startRace() re-derives the setup in that phase. A run saved on the Victory screen can still go endless.
 */
export function loadSavedRun(): boolean {
  const s = validateRun(readSavedRun());
  if (!s || s.phase === 'gameover' || s.phase === 'victory') return false;
  store.replace(s);
  return true;
}



