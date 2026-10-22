// Cash rules: payouts, sell values. All numbers come from CONTENT.balance.
import type { Payout, RaceResult } from '../core/types';
import { CONTENT, partById, passiveById } from '../data/content';

const EPS = 1e-6;

/** Full 0.1 s steps under the target, capped. */
export function timeBonus(margin: number): number {
  const eco = CONTENT.balance.economy;
  if (!(margin > 0)) return 0;
  const tenths = Math.floor(margin * 10 + EPS);
  return Math.max(0, Math.min(eco.timeBonusCap, tenths * eco.timeBonusPerTenth));
}

/** Payout for a won race. `isBoss` = race 3; `isFinal` = round 4 boss. */
export function computePayout(result: RaceResult, isBoss: boolean, isFinal: boolean): Payout {
  const eco = CONTENT.balance.economy;
  // Design: boss win pays only in rounds 1-3; the final boss ends the run (line still shown, $0).
  const base = isFinal ? 0 : isBoss ? eco.bossWin : eco.regularWin;
  const bonus = timeBonus(result.margin);
  const passiveCash = Math.max(0, Math.floor(result.passiveCash || 0));
  const lines: Payout['lines'] = [];
  lines.push({ label: isFinal ? 'Final boss win' : isBoss ? 'Boss win' : 'Win', amount: base });
  const tenths = Math.floor(Math.max(0, result.margin) * 10 + EPS);
  lines.push({ label: `Time bonus (${(Math.max(0, result.margin)).toFixed(3)}s under${tenths * eco.timeBonusPerTenth > eco.timeBonusCap ? ', capped' : ''})`, amount: bonus });
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

export function passiveSellValueById(passiveId: string): number {
  const p = passiveById(passiveId);
  if (!p) return 0;
  return sellValueOfCost(passivePrice(passiveId));
}

// ---------- Prices (def.cost when set, otherwise the balance default) ----------

export function partPrice(partId: string): number {
  const p = partById(partId);
  if (!p) return 0;
  if (p.tier === 'stock') return 0;
  if (p.cost > 0) return p.cost;
  return p.tier === 'pro' ? CONTENT.balance.prices.pro : CONTENT.balance.prices.street;
}

export function passivePrice(passiveId: string): number {
  const p = passiveById(passiveId);
  return p && p.cost > 0 ? p.cost : CONTENT.balance.prices.passive;
}

export function consumablePrice(cost: number | undefined): number {
  return cost && cost > 0 ? cost : CONTENT.balance.prices.consumable;
}
