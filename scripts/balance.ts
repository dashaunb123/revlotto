// Balance harness: runs RaceSim headless with bots across simulated builds and prints ET distributions.
// Usage: npm run balance   (optional: npm run balance -- 200   for samples per row)
import { RaceSim } from '../src/sim/RaceSim';
import { makeBot, type BotProfile } from '../src/sim/bots';
import { CONTENT, opponentFor } from '../src/data/content';
import { computeRaceSetup } from '../src/game/stats';
import { Rng } from '../src/core/rng';
import { SLOTS } from '../src/core/types';
import type { InstalledPart, RaceSetup, RunState, SlotId } from '../src/core/types';

const SAMPLES = Number(process.argv[2] ?? 150);
const B = CONTENT.balance;

function stockParts(): Record<SlotId, InstalledPart> {
  const o = {} as Record<SlotId, InstalledPart>;
  for (const s of SLOTS) o[s] = { partId: `${s}_stock`, level: 0 };
  return o;
}

function fakeRun(round: number, race: number, parts = stockParts(), passives: string[] = [], staged: string[] = []): RunState {
  return {
    seed: 'BAL',
    rng: 1,
    phase: 'staging',
    cash: 0,
    round,
    race,
    parts,
    passives,
    consumables: staged,
    tuningCards: 0,
    shop: null,
    stagedConsumables: staged,
    mulliganArmed: false,
    lastResult: null,
    lastPayout: null,
    history: [],
  };
}

function race(setup: RaceSetup, profile: BotProfile, seed: number) {
  return new RaceSim(setup).runToEnd(makeBot(profile, seed));
}

function stats(xs: number[]) {
  const s = xs.slice().sort((a, b) => a - b);
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { avg, p10: q(0.1), p50: q(0.5), p90: q(0.9) };
}
const f = (x: number) => x.toFixed(2);

// ---------- Simulated shopper ----------
const PASSIVE_PREF = ['garage_rat', 'clean_launcher', 'shift_savant', 'featherweight', 'double_clutch', 'boost_brain', 'sticky_compound', 'redline_gambler', 'cash_cow', 'finish_line_flair'];

function partScore(id: string): number {
  const st = CONTENT.parts.find((p) => p.id === id)!.stats;
  return (
    (st.power ?? 0) * 1.0 -
    (st.weight ?? 0) * 0.45 +
    (st.grip ?? 0) * 140 +
    (st.gearing ?? 0) * 350 -
    (st.drag ?? 0) * 160 +
    (st.shiftWindow ?? 0) * 20 +
    (st.nitroPower ?? 0) * 0.25 * (st.nitroDuration ?? 0)
  );
}
const slotOf = (id: string) => id.replace(/_(stock|street|pro)$/, '') as SlotId;

/**
 * Simulates shop visits up to race index n (0..15), winning every race. Each visit offers 2 parts +
 * 2 passives + a parts pack; the shopper buys by value/price. skill 0..1 = pick quality / follow-through.
 */
function simBuild(n: number, rng: Rng, skill: number) {
  let cash = B.economy.startCash;
  const parts = stockParts();
  const passives: string[] = [rng.pick(PASSIVE_PREF.slice(0, 6))]; // free power pack
  let tuning = 0;
  for (let visit = 0; visit <= n; visit++) {
    const round = Math.floor(visit / 4) + 1;
    if (visit > 0) {
      const boss = (visit - 1) % 4 === 3;
      cash += (boss ? B.economy.bossWin : B.economy.regularWin) + rng.int(0, 3);
    }
    const proShare = Math.min(0.9, B.shop.proShareBase + B.shop.proShareStepPerRound * (round - 1));
    const randPart = () => `${rng.pick(SLOTS)}_${rng.next() < proShare ? 'pro' : 'street'}`;
    const gainOf = (id: string) => partScore(id) - partScore(parts[slotOf(id)].partId);
    for (let pass = 0; pass < 3; pass++) {
      const offers: { kind: 'part' | 'passive' | 'pack' | 'power'; id: string; price: number; value: number }[] = [];
      for (let k = 0; k < 2; k++) {
        const id = randPart();
        offers.push({ kind: 'part', id, price: id.endsWith('pro') ? B.prices.pro : B.prices.street, value: gainOf(id) });
      }
      const opts = PASSIVE_PREF.filter((p) => !passives.includes(p));
      const pid = rng.next() < skill ? opts[0] : rng.pick(opts);
      offers.push({ kind: 'passive', id: pid, price: B.prices.passive, value: passives.length < B.limits.passiveSlots ? 40 + 6 * visit : -1 });
      if (pass === 0) {
        offers.push({ kind: 'pack', id: 'parts', price: B.prices.partsPack, value: 35 });
        offers.push({ kind: 'power', id: 'power', price: B.prices.powerPack, value: 30 });
      }
      offers.sort((a, b) => b.value / b.price - a.value / a.price);
      for (const o of offers) {
        if (o.value <= 0 || o.price > cash) continue;
        if (rng.next() > skill) continue; // indecision / misplays
        cash -= o.price;
        if (o.kind === 'part') parts[slotOf(o.id)] = { partId: o.id, level: 0 };
        else if (o.kind === 'passive') passives.push(o.id);
        else if (o.kind === 'pack') {
          const cands = [randPart(), randPart(), randPart()].sort((a, b) => gainOf(b) - gainOf(a));
          if (gainOf(cands[0]) > 0) parts[slotOf(cands[0])] = { partId: cands[0], level: 0 };
        } else {
          const roll = rng.next();
          if (roll < 0.1) tuning++;
          else if (roll < 0.6 && passives.length < B.limits.passiveSlots) {
            const o2 = PASSIVE_PREF.filter((p) => !passives.includes(p));
            passives.push(rng.next() < skill ? o2[0] : rng.pick(o2));
          }
        }
      }
      const reroll = B.prices.rerollBase + pass * B.prices.rerollStep;
      if (cash >= reroll + 6 && rng.next() < 0.6) cash -= reroll;
      else break;
    }
  }
  const tunable = SLOTS.filter((s) => parts[s].partId.endsWith('_pro')).concat(SLOTS.filter((s) => parts[s].partId.endsWith('_street')));
  for (let i = 0; i < tuning && tunable.length; i++) {
    const s = tunable[0];
    parts[s].level = Math.min(B.limits.maxTuning, parts[s].level + 1);
    if (parts[s].level >= B.limits.maxTuning) tunable.shift();
  }
  return { parts, passives };
}

function describeBuild(b: { parts: Record<SlotId, InstalledPart>; passives: string[] }) {
  const street = SLOTS.filter((s) => b.parts[s].partId.endsWith('_street')).length;
  const pro = SLOTS.filter((s) => b.parts[s].partId.endsWith('_pro')).length;
  return { street, pro, passives: b.passives.length };
}

// ---------- Report ----------
console.log(`Revlotto balance harness (${SAMPLES} samples per row)\n`);

{
  const setup = computeRaceSetup(fakeRun(1, 0)).setup;
  console.log('STARTER CAR:');
  for (const p of ['perfect', 'average', 'sloppy'] as BotProfile[]) {
    const st = stats(Array.from({ length: SAMPLES }, (_, i) => race(setup, p, i * 7919 + 13).et));
    console.log(`  ${p.padEnd(8)} avg ${f(st.avg)}  p10 ${f(st.p10)}  p50 ${f(st.p50)}  p90 ${f(st.p90)}`);
  }
}

{
  const parts = stockParts();
  for (const s of SLOTS) parts[s] = { partId: `${s}_pro`, level: 3 };
  const passives = ['garage_rat', 'clean_launcher', 'shift_savant', 'double_clutch', 'featherweight'];
  const { setup } = computeRaceSetup(fakeRun(4, 2, parts, passives, ['nitro_bottle', 'grip_spray']));
  const st = stats(Array.from({ length: SAMPLES }, (_, i) => race(setup, 'perfect', i + 1).et));
  const sa = stats(Array.from({ length: SAMPLES }, (_, i) => race(setup, 'average', i + 1).et));
  console.log(`\nMAX BUILD (all Pro L3, 5 passives, Nitro Bottle + Grip Spray): power ${setup.stats.power.toFixed(0)} weight ${setup.stats.weight.toFixed(0)} grip ${setup.stats.grip.toFixed(2)}`);
  console.log(`  perfect avg ${f(st.avg)}  average avg ${f(sa.avg)}`);
  const all = stockParts();
  for (const s of SLOTS) all[s] = { partId: `${s}_pro`, level: 0 };
  const plain = computeRaceSetup(fakeRun(4, 2, all, ['garage_rat', 'clean_launcher', 'shift_savant'])).setup;
  const sp = stats(Array.from({ length: SAMPLES }, (_, i) => race(plain, 'perfect', i + 1).et));
  const sp2 = stats(Array.from({ length: SAMPLES }, (_, i) => race(plain, 'average', i + 1).et));
  console.log(`  all Pro L0 + 3 good passives: perfect avg ${f(sp.avg)}  average avg ${f(sp2.avg)}`);
}

console.log('\nPER RACE (simulated shopper having won every prior race). Builds: GOOD skill 0.9, WEAK skill 0.6');
console.log('  race  opponent               target | GOOD build: parts st/pro, pass | ET avg-bot p10/p50/p90 | win% avg | win% perf | WEAK win% avg');
const rng = new Rng(424242);
for (let n = 0; n < 16; n++) {
  const round = Math.floor(n / 4) + 1;
  const rc = n % 4;
  const opp = opponentFor(round, rc);
  const ets: number[] = [];
  let winAvg = 0,
    winPerf = 0,
    winWeak = 0,
    st = 0,
    pr = 0,
    pa = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const b = simBuild(n, rng, 0.9);
    const d = describeBuild(b);
    st += d.street;
    pr += d.pro;
    pa += d.passives;
    const { setup } = computeRaceSetup(fakeRun(round, rc, b.parts, b.passives));
    const ra = race(setup, 'average', i * 31 + n);
    ets.push(ra.et);
    if (ra.won) winAvg++;
    if (race(setup, 'perfect', i * 31 + n).won) winPerf++;
    const w = simBuild(n, rng, 0.6);
    if (race(computeRaceSetup(fakeRun(round, rc, w.parts, w.passives)).setup, 'average', i * 17 + n).won) winWeak++;
  }
  const s = stats(ets);
  const pc = (k: number) => `${Math.round((100 * k) / SAMPLES)}%`.padStart(4);
  const avgN = (k: number) => (k / SAMPLES).toFixed(1);
  console.log(
    `  ${round}-${rc + 1}${rc === 3 ? 'B' : ' '}  ${opp.name.padEnd(22)} ${opp.targetEt.toFixed(2).padStart(5)} |   ${avgN(st)}/${avgN(pr)}, ${avgN(pa)}                    | ${f(s.p10)} / ${f(s.p50)} / ${f(s.p90)}  |   ${pc(winAvg)}   |   ${pc(winPerf)}    |   ${pc(winWeak)}`,
  );
}
