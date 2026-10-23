// Cash rules: payouts, prices, sell values. All numbers come from CONTENT.balance (+ heat, car, garage).
import type { Edition, Payout, RaceResult, RunState } from '../core/types';
import { CONTENT, partById, passiveById } from '../data/content';
import { passiveSellBonus, rerollDiscount } from './effects';

const EPS = 1e-6;

export const owns = (run: Pick<RunState, 'garage'>, id: string) => !!run.garage?.includes(id);

/** Full 0.1 s steps under the target, capped. */
export function timeBonus(margin: number): number {
  const eco = CONTENT.balance.economy;
  if (!(margin > 0)) return 0;
  const tenths = Math.floor(margin * 10 + EPS);
  return Math.max(0, Math.min(eco.timeBonusCap, tenths * eco.timeBonusPerTenth));
}

/**
 * Payout for a won race. `isBoss` = race 3; `isFinal` = round 4 boss outside endless.
 * `heat`: H1 regular wins pay $1 less, H4 no time bonus on boss races.
 */
export function computePayout(result: RaceResult, isBoss: boolean, isFinal: boolean, heat = 0): Payout {
  const eco = CONTENT.balance.economy;
  // Design: boss win pays only in rounds 1-3; the final boss ends the run (line still shown, $0).
  let base = isFinal ? 0 : isBoss ? eco.bossWin : eco.regularWin;
  if (!isBoss && heat >= 1) base = Math.max(0, base - 1);
  const noBonus = isBoss && heat >= 4;
  const bonus = noBonus ? 0 : timeBonus(result.margin);
  const passiveCash = Math.max(0, Math.floor(result.passiveCash || 0));
  const lines: Payout['lines'] = [];
  lines.push({ label: isFinal ? 'Final boss win' : isBoss ? 'Boss win' : 'Win', amount: base });
  const tenths = Math.floor(Math.max(0, result.margin) * 10 + EPS);
  if (noBonus) lines.push({ label: 'Time bonus (Heat 4: none on bosses)', amount: 0 });
  else
    lines.push({
      label: `Time bonus (${Math.max(0, result.margin).toFixed(3)}s under${tenths * eco.timeBonusPerTenth > eco.timeBonusCap ? ', capped' : ''})`,
      amount: bonus,
    });
  if (passiveCash > 0) lines.push({ label: 'Passive cash', amount: passiveCash });
  return { base, timeBonus: bonus, passiveCash, total: base + bonus + passiveCash, lines };
}

export function sellValueOfCost(cost: number): number {
  return Math.max(0, Math.floor(cost * CONTENT.balance.economy.sellRatio));
}

export function partSellValueById(partId: string): number {
  const p = partById(partId);
  if (!p || p.tier === 'stock') return 0;
  return sellValueOfCost(p.cost);
}

export function passiveSellValueById(passiveId: string, edition: Edition | null = null, run?: RunState): number {
  const p = passiveById(passiveId);
  if (!p) return 0;
  const bonus = run ? Math.floor(passiveSellBonus(run, passiveId) || 0) : 0;
  return Math.max(0, sellValueOfCost(passivePrice(passiveId) + editionPrice(edition)) + bonus);
}

// ---------- Base prices (def.cost when set, otherwise the balance default) ----------

export function partPrice(partId: string): number {
  const p = partById(partId);
  if (!p) return 0;
  if (p.tier === 'stock') return 0;
  if (p.cost > 0) return p.cost;
  return CONTENT.balance.prices[p.tier];
}

export function passivePrice(passiveId: string): number {
  const p = passiveById(passiveId);
  return p && p.cost > 0 ? p.cost : CONTENT.balance.prices.passive;
}

export function consumablePrice(cost: number | undefined): number {
  return cost && cost > 0 ? cost : CONTENT.balance.prices.consumable;
}

export function editionPrice(e: Edition | null | undefined): number {
  return e ? CONTENT.balance.editions[e].price : 0;
}

// ---------- Run-adjusted shop prices ----------

/** Trust Fund +25%; Discount -25% / Wholesale -40%. Applies to loose items and packs. */
export function shopPriceMult(run: RunState): number {
  const car = run.car === 'trust_fund' ? 1.25 : 1;
  const disc = owns(run, 'wholesale') ? 0.6 : owns(run, 'discount') ? 0.75 : 1;
  return car * disc;
}

export function adjustPrice(run: RunState, base: number): number {
  if (base <= 0) return 0;
  return Math.max(1, Math.round(base * shopPriceMult(run)));
}

/** Heat 3: packs +$1. */
export function packPrice(run: RunState, kind: 'parts' | 'power'): number {
  const p = CONTENT.balance.prices;
  return adjustPrice(run, kind === 'parts' ? p.partsPack : p.powerPack) + (run.heat >= 3 ? 1 : 0);
}

/** Garage upgrades: Trust Fund +25% only (not discounted); Garage Coupon halves. */
export function garagePrice(run: RunState, cost: number): number {
  let price = Math.round(cost * (run.car === 'trust_fund' ? 1.25 : 1));
  if (run.tags?.includes('garage_coupon')) price = Math.floor(price / 2);
  return price;
}

/** Reroll cost for the n-th paid reroll of a shop (0-based). Heat 3 +$1, Reroll Surplus -$2, passives' discount. */
export function rerollPrice(run: RunState, paidRerolls: number): number {
  const p = CONTENT.balance.prices;
  let c = p.rerollBase + p.rerollStep * paidRerolls;
  if (run.heat >= 3) c += 1;
  if (owns(run, 'reroll_surplus')) c -= 2;
  c -= Math.floor(rerollDiscount(run) || 0);
  return Math.max(0, c);
}
