// Balance harness: runs RaceSim headless with bots across simulated builds and prints ET distributions.
// Usage: npm run balance   (optional: npm run balance -- 200   for samples per row)
import { RaceSim } from '../src/sim/RaceSim';
import { makeBot, type BotProfile } from '../src/sim/bots';
import { CONTENT, opponentFor } from '../src/data/content';
import { computeRaceSetup } from '../src/game/stats';
import { runDefaults } from '../src/game/run';
import { Rng } from '../src/core/rng';
import { BOSS_MODIFIERS, rollBossParams } from '../src/sim/bossMods';
import { BOSS_EFFECTS } from '../src/game/effects';
import { SLOTS } from '../src/core/types';
import type { InstalledPart, RaceSetup, RunState, SlotId } from '../src/core/types';

const ARGS = process.argv.slice(2);
const BOSSES_ONLY = ARGS.includes('--bosses');
const SAMPLES = Number(ARGS.find((a) => /^\d+$/.test(a)) ?? 150);
const B = CONTENT.balance;

function stockParts(): Record<SlotId, InstalledPart> {
  const o = {} as Record<SlotId, InstalledPart>;
  for (const s of SLOTS) o[s] = { partId: `${s}_stock`, level: 0 };
  return o;
}

function fakeRun(round: number, race: number, parts = stockParts(), passives: string[] = [], staged: string[] = []): RunState {
  return {
    ...runDefaults(),
    passiveEditions: passives.map(() => null),
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
const slotOf = (id: string) => CONTENT.parts.find((p) => p.id === id)!.slot;
const tierOfId = (id: string) => CONTENT.parts.find((p) => p.id === id)!.tier;
const brandPart = (brand: string, slot: SlotId) => CONTENT.parts.find((p) => p.brand === brand && p.slot === slot)!.id;
/** A random shop part with the real tier odds of the round (uniform brand, uniform slot). */
function randShopPart(rng: Rng, round: number): string {
  const odds = B.shop.tierOdds[Math.min(B.shop.tierOdds.length - 1, round - 1)];
  const tiers = ['street', 'sport', 'pro'] as const;
  const tier = rng.weighted(tiers, tiers.map((t) => odds[t]));
  const brand = rng.pick(CONTENT.brands.filter((b) => b.tier === tier)).id;
  return brandPart(brand, rng.pick(SLOTS));
}

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
    const randPart = () => randShopPart(rng, round);
    const gainOf = (id: string) => partScore(id) - partScore(parts[slotOf(id)].partId);
    for (let pass = 0; pass < 3; pass++) {
      const offers: { kind: 'part' | 'passive' | 'pack' | 'power'; id: string; price: number; value: number }[] = [];
      for (let k = 0; k < 2; k++) {
        const id = randPart();
        offers.push({ kind: 'part', id, price: B.prices[tierOfId(id) as 'street' | 'sport' | 'pro'], value: gainOf(id) });
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
  const rank = { stock: 0, street: 1, sport: 2, pro: 3 } as const;
  const tunable = SLOTS.filter((s) => tierOfId(parts[s].partId) !== 'stock').sort((a, b) => rank[tierOfId(parts[b].partId)] - rank[tierOfId(parts[a].partId)]);
  for (let i = 0; i < tuning && tunable.length; i++) {
    const s = tunable[0];
    parts[s].level = Math.min(B.limits.maxTuning, parts[s].level + 1);
    if (parts[s].level >= B.limits.maxTuning) tunable.shift();
  }
  return { parts, passives };
}

function describeBuild(b: { parts: Record<SlotId, InstalledPart>; passives: string[] }) {
  const street = SLOTS.filter((s) => tierOfId(b.parts[s].partId) === 'street').length;
  const pro = SLOTS.filter((s) => tierOfId(b.parts[s].partId) !== 'street' && tierOfId(b.parts[s].partId) !== 'stock').length;
  return { street, pro, passives: b.passives.length };
}

// ---------- Report ----------
console.log(`Revlotto balance harness (${SAMPLES} samples per row)\n`);
if (!BOSSES_ONLY) {

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
  for (const s of SLOTS) parts[s] = { partId: brandPart('hellkat', s), level: 3 };
  const passives = ['garage_rat', 'clean_launcher', 'shift_savant', 'double_clutch', 'featherweight'];
  const { setup } = computeRaceSetup(fakeRun(4, 2, parts, passives, ['nitro_bottle', 'grip_spray']));
  const st = stats(Array.from({ length: SAMPLES }, (_, i) => race(setup, 'perfect', i + 1).et));
  const sa = stats(Array.from({ length: SAMPLES }, (_, i) => race(setup, 'average', i + 1).et));
  console.log(`\nMAX BUILD (Hellkat Demon paragon L3, 5 passives, Nitro Bottle + Grip Spray): power ${setup.stats.power.toFixed(0)} weight ${setup.stats.weight.toFixed(0)} grip ${setup.stats.grip.toFixed(2)}`);
  console.log(`  perfect avg ${f(st.avg)}  average avg ${f(sa.avg)}`);
  const all = stockParts();
  // Mixed pro, no paragon: alternate the two pro brands (6 + 6 = two set-4s, no set-8).
  SLOTS.forEach((s, i) => (all[s] = { partId: brandPart(i % 2 ? 'hellkat' : 'lamberghoul', s), level: 0 }));
  const plain = computeRaceSetup(fakeRun(4, 2, all, ['garage_rat', 'clean_launcher', 'shift_savant'])).setup;
  const sp = stats(Array.from({ length: SAMPLES }, (_, i) => race(plain, 'perfect', i + 1).et));
  const sp2 = stats(Array.from({ length: SAMPLES }, (_, i) => race(plain, 'average', i + 1).et));
  console.log(`  mixed Pro 6+6 L0 + 3 good passives: perfect avg ${f(sp.avg)}  average avg ${f(sp2.avg)}`);
}

// ---------- Brand sets and paragons ----------
{
  console.log('\nBRANDS: full builds, L0, passives garage_rat + clean_launcher + shift_savant. avg-bot ET (perfect-bot ET) / win% avg bot');
  console.log('  build                       power  weight  grip  |  vs R1-4 (14.30)  R2-4 (11.10)  R3-1 (10.20)  R3-4 (9.30)  R4-4 (8.10)');
  const passives = ['garage_rat', 'clean_launcher', 'shift_savant'];
  const targets: [number, number][] = [[1, 3], [2, 2], [3, 0], [3, 3], [4, 3]];
  const n = Math.max(30, Math.floor(SAMPLES / 3));
  const row = (label: string, parts: Record<SlotId, InstalledPart>) => {
    const cells: string[] = [];
    let st0: RaceSetup | null = null;
    for (const [round, rc] of targets) {
      const { setup } = computeRaceSetup(fakeRun(round, Math.min(rc, 2), parts, passives));
      setup.targetEt = opponentFor(round, rc).targetEt;
      delete setup.boss;
      st0 ??= setup;
      const ra = Array.from({ length: n }, (_, i) => race(setup, 'average', i * 97 + round));
      const rp = Array.from({ length: n }, (_, i) => race(setup, 'perfect', i * 97 + round));
      const avg = ra.reduce((a, r) => a + r.et, 0) / n;
      const perf = rp.reduce((a, r) => a + r.et, 0) / n;
      cells.push(`${avg.toFixed(2)}(${perf.toFixed(2)}) ${String(Math.round((100 * ra.filter((r) => r.won).length) / n)).padStart(3)}%`);
    }
    const st = st0!.stats;
    console.log(`  ${label.padEnd(27)} ${st.power.toFixed(0).padStart(5)}  ${st.weight.toFixed(0).padStart(6)}  ${st.grip.toFixed(2)}  | ${cells.join('  ')}`);
  };
  for (const b of CONTENT.brands) {
    const full = stockParts();
    for (const s of SLOTS) full[s] = { partId: brandPart(b.id, s), level: 0 };
    const eight = stockParts();
    for (const s of SLOTS.slice(0, 8)) eight[s] = { partId: brandPart(b.id, s), level: 0 };
    // 11 of the brand + one part of the same tier's other brand (all the parts, no paragon)
    const other = CONTENT.brands.find((x) => x.tier === b.tier && x.id !== b.id)!;
    const eleven = { ...full, nitrous: { partId: brandPart(other.id, 'nitrous'), level: 0 } };
    row(`${b.name} 8/12`, eight);
    row(`${b.name} 11+1 (no paragon)`, eleven);
    row(`${b.paragon.name}`, full);
  }
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
}

// ---------- Bosses ----------
/** A boss race setup for the modifier: the build's regular-race setup + the boss block, stats and disabled passives. */
function bossSetup(round: number, b: { parts: Record<SlotId, InstalledPart>; passives: string[] }, mod: string | null, seed: number): RaceSetup {
  const def = mod ? BOSS_MODIFIERS.find((m) => m.id === mod) : undefined;
  const off = (mod && BOSS_EFFECTS[mod]?.disableRightmostPassives) || def?.disablePassives || 0;
  const passives = off ? b.passives.slice(0, Math.max(0, b.passives.length - off)) : b.passives;
  const { setup } = computeRaceSetup(fakeRun(round, 2, b.parts, passives));
  setup.targetEt = opponentFor(round, 3).targetEt;
  if (mod) {
    // static effects come from BOSS_EFFECTS, exactly as computeRaceSetup applies them
    const eff = BOSS_EFFECTS[mod];
    eff?.stats?.(setup.stats);
    eff?.setup?.(setup as unknown as Parameters<NonNullable<typeof eff.setup>>[0]);
    setup.boss = { id: mod, modifier: mod, params: rollBossParams(mod, new Rng(seed * 2654435761 >>> 0)) };
  }
  return setup;
}

console.log('\nBOSSES: pass rate per modifier at each round\'s boss target, GOOD-skill build bought up to that boss.');
console.log('  (baseline = same build/target with no modifier). Regular bosses use rounds 1-3, finals round 4.');
console.log('  modifier          tier     rnd target | perfect  average  sloppy | baseline perf/avg | avg ET (avg bot)');
const brng = new Rng(777);
const mods = BOSS_MODIFIERS.filter((m) => !m.legacy);
const builds: Record<number, { parts: Record<SlotId, InstalledPart>; passives: string[] }[]> = {};
for (const round of [1, 2, 3, 4]) builds[round] = Array.from({ length: SAMPLES }, () => simBuild(round * 4 - 1, brng, 0.9));
for (const m of mods) {
  const rounds = m.tier === 'final' ? [4] : [1, 2, 3];
  for (const round of rounds) {
    const win = { perfect: 0, average: 0, sloppy: 0 };
    let basePerf = 0,
      baseAvg = 0,
      etSum = 0,
      etN = 0;
    for (let i = 0; i < SAMPLES; i++) {
      const b = builds[round][i];
      const setup = bossSetup(round, b, m.id, i + 1);
      for (const p of ['perfect', 'average', 'sloppy'] as BotProfile[]) {
        const r = race(setup, p, i * 131 + round);
        if (r.won) win[p]++;
        if (p === 'average' && r.et < 90) {
          etSum += r.et;
          etN++;
        }
      }
      const base = bossSetup(round, b, null, i + 1);
      if (race(base, 'perfect', i * 131 + round).won) basePerf++;
      if (race(base, 'average', i * 131 + round).won) baseAvg++;
    }
    const pc = (k: number) => `${Math.round((100 * k) / SAMPLES)}%`.padStart(5);
    console.log(
      `  ${m.id.padEnd(17)} ${m.tier.padEnd(8)} ${round}  ${opponentFor(round, 3).targetEt.toFixed(2)}  |  ${pc(win.perfect)}   ${pc(win.average)}   ${pc(win.sloppy)}  |   ${pc(basePerf)} /${pc(baseAvg)}    | ${etN ? (etSum / etN).toFixed(2) : '-'}`,
    );
  }
}
