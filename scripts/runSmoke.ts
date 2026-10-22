// Headless full-run smoke test: plays seeded runs through the real GameApi with a simple buying AI
// and the sim bots. Usage: npx tsx scripts/runSmoke.ts [runsPerProfile] [--quiet]
import { SLOTS } from '../src/core/types';
import type { PackCard, RaceResult, ShopState, Tier } from '../src/core/types';
import { hashSeed } from '../src/core/rng';
import { game } from '../src/game/game';
import { CONTENT } from '../src/data/content';
import { RaceSim } from '../src/sim/RaceSim';
import { makeBot } from '../src/sim/bots';

type Profile = 'perfect' | 'average' | 'sloppy';

const args = process.argv.slice(2);
const RUNS = Number(args.find((a) => /^\d+$/.test(a)) ?? 6);
const QUIET = args.includes('--quiet');
const log = (...a: unknown[]) => {
  if (!QUIET) console.log(...a);
};

const TIER_RANK: Record<Tier, number> = { stock: 0, street: 1, pro: 2 };
const installedRank = (slot: string) => TIER_RANK[game.part(game.state.parts[slot as keyof typeof game.state.parts].partId).tier];
const isUpgrade = (partId: string) => {
  const p = game.part(partId);
  return TIER_RANK[p.tier] > installedRank(p.slot);
};

function cardScore(c: PackCard): number {
  switch (c.kind) {
    case 'part': {
      const p = game.part(c.partId);
      return isUpgrade(c.partId) ? 100 + p.cost : -1;
    }
    case 'passive':
      return game.state.passives.length < CONTENT.balance.limits.passiveSlots ? 80 : -1;
    case 'tuning':
      return 60;
    case 'consumable':
      return game.state.consumables.length < CONTENT.balance.limits.consumableSlots ? 20 : -1;
  }
}

function resolvePack(): void {
  const open = game.state.shop?.openPack;
  if (!open) return;
  const order = open.cards.map((c, i) => ({ i, s: cardScore(c) })).sort((a, b) => b.s - a.s);
  for (const { i, s } of order) {
    if (s < 0) continue;
    if (game.pickPackCard(i).ok) return;
  }
  game.skipPack();
}

function spendTuning(): void {
  while (game.state.tuningCards > 0) {
    const slots = SLOTS.filter((s) => {
      const ip = game.state.parts[s];
      return game.part(ip.partId).tier !== 'stock' && ip.level < CONTENT.balance.limits.maxTuning;
    }).sort((a, b) => game.part(game.state.parts[b].partId).cost - game.part(game.state.parts[a].partId).cost);
    if (!slots.length || !game.applyTuning(slots[0]).ok) return;
  }
}

function shopAI(): void {
  const shop = () => game.state.shop as ShopState;
  // Free pack first.
  shop().packs.forEach((p, i) => {
    if (!p.sold && p.price === 0 && game.buyPack(i).ok) resolvePack();
  });
  for (let pass = 0; pass < 4; pass++) {
    // Parts: best upgrades first.
    const parts = shop()
      .items.map((it, i) => ({ it, i }))
      .filter(({ it }) => it.kind === 'part' && !it.sold && isUpgrade(it.partId))
      .sort((a, b) => b.it.price - a.it.price);
    for (const { i } of parts) game.buyItem(i);
    // Passives.
    shop().items.forEach((it, i) => {
      if (it.kind === 'passive' && !it.sold && game.state.cash >= it.price + 4) game.buyItem(i);
    });
    // Parts pack, then power pack.
    shop().packs.forEach((p, i) => {
      if (!p.sold && game.state.cash >= p.price + 2 && game.buyPack(i).ok) resolvePack();
    });
    // Cheap consumables when there's slack.
    shop().items.forEach((it, i) => {
      if (it.kind === 'consumable' && !it.sold && game.state.cash >= it.price + 6) game.buyItem(i);
    });
    // Reroll only when rich.
    if (game.state.cash >= shop().rerollCost + 14) game.reroll();
    else break;
  }
  spendTuning();
}

function race(profile: Profile, botSeed: number): RaceResult {
  const setup = game.startRace();
  const sim = new RaceSim(setup);
  const bot = makeBot(profile, botSeed);
  let guard = 0;
  while (sim.state.phase !== 'finished' && guard++ < 120 * 90) {
    const a = bot(sim);
    if (a) sim.input(a);
    sim.step();
  }
  if (sim.state.phase !== 'finished') throw new Error('sim did not finish');
  return sim.result();
}

interface RunSummary {
  seed: string;
  profile: Profile;
  won: boolean;
  racesWon: number;
  reached: string;
  shops: string[];
  cash: number;
}

function snapshotShop(): string {
  const s = game.state.shop!;
  return JSON.stringify({ items: s.items.map((i) => ('partId' in i ? i.partId : 'passiveId' in i ? i.passiveId : i.consumableId)), packs: s.packs.map((p) => p.price) });
}

function playRun(seed: string, profile: Profile): RunSummary {
  game.newRun(seed);
  const shops: string[] = [];
  let racesWon = 0;
  let guard = 0;
  log(`\n=== ${profile.toUpperCase()} seed ${game.state.seed} ===`);
  while (game.state.phase !== 'gameover' && game.state.phase !== 'victory' && guard++ < 200) {
    const s = game.state;
    switch (s.phase) {
      case 'shop': {
        shops.push(snapshotShop());
        const before = s.cash;
        shopAI();
        const installed = SLOTS.filter((sl) => game.part(s.parts[sl].partId).tier !== 'stock').length;
        log(
          `  [R${s.round}.${s.race + 1}] shop $${before} -> $${s.cash} | ${installed}/12 upgraded | passives ${s.passives.join(',') || '-'} | cons ${s.consumables.join(',') || '-'} | tuning ${s.tuningCards}`,
        );
        game.leaveShop();
        break;
      }
      case 'staging': {
        s.consumables.forEach((_, i) => game.toggleStagedConsumable(i));
        const r = race(profile, hashSeed(seed) ^ (s.round * 16 + s.race));
        const out = game.finishRace(r);
        const opp = game.currentOpponent();
        log(
          `    race ${game.raceNumber()} vs ${opp.name}: ET ${r.et.toFixed(3)} vs ${r.targetEt.toFixed(3)} ${r.won ? 'WIN' : 'LOSS'} (${r.margin >= 0 ? '+' : ''}${r.margin.toFixed(3)}) perfects ${r.perfectCount}` +
            (out.payout ? ` +$${out.payout.total}` : '') +
            (out.mulliganUsed ? ' MULLIGAN!' : ''),
        );
        break;
      }
      case 'race': {
        // Mulligan rerun.
        const r = race(profile, hashSeed(seed) ^ 0xabc ^ (s.round * 16 + s.race));
        const out = game.finishRace(r);
        log(`    rerun: ET ${r.et.toFixed(3)} vs ${r.targetEt.toFixed(3)} ${r.won ? 'WIN' : 'LOSS'}` + (out.payout ? ` +$${out.payout.total}` : ''));
        break;
      }
      case 'result':
        if (game.state.lastResult?.won) racesWon++;
        game.continueFromResult();
        break;
    }
  }
  const st = game.state;
  const reached = st.phase === 'victory' ? 'VICTORY' : `died at R${st.round} race ${st.race + 1}${st.race === 3 ? ' (boss)' : ''}`;
  log(`  => ${reached}, races won ${racesWon}/16, cash $${st.cash}`);
  return { seed: st.seed, profile, won: st.phase === 'victory', racesWon, reached, shops, cash: st.cash };
}

// ---------- Sanity checks on the API ----------
function apiChecks(): void {
  game.newRun('CHECKS');
  const s = game.state;
  const assert = (c: boolean, m: string) => {
    if (!c) throw new Error('API check failed: ' + m);
  };
  assert(s.cash === CONTENT.balance.economy.startCash, 'start cash');
  assert(s.phase === 'shop' && !!s.shop && s.shop.freePack, 'starts in shop with free pack');
  assert(s.shop!.packs[1].price === 0, 'power pack free');
  assert(s.shop!.items.length === 4, '4 loose items');
  assert(!game.sellPart('engine').ok, 'cannot sell stock');
  const rc = s.shop!.rerollCost;
  game.reroll();
  assert(s.cash === CONTENT.balance.economy.startCash - rc, 'reroll charged');
  assert(s.shop!.rerollCost === rc + CONTENT.balance.prices.rerollStep, 'reroll step');
  assert(game.buyPack(1).ok && !!s.shop!.openPack && s.shop!.openPack.cards.length === 3, 'free pack opens 3');
  game.skipPack();
  assert(!s.shop!.openPack, 'skip closes');
  let notified = 0;
  const un = game.subscribe(() => notified++);
  game.leaveShop();
  un();
  assert(notified === 1 && s.phase === 'staging', 'leaveShop notifies + staging');
  assert(structuredClone(game.state).seed === 'CHECKS', 'state is structuredClone-safe');
  // Mulligan flow: force a mulligan into inventory and lose on purpose.
  s.consumables = ['mulligan'];
  game.toggleStagedConsumable(0);
  assert(game.isConsumableStaged(0), 'staged');
  game.startRace();
  assert(s.consumables.length === 0 && s.mulliganArmed, 'mulligan consumed + armed');
  const fake: RaceResult = { et: 20, targetEt: 13.8, won: false, margin: -6.2, reaction: 0.2, trapSpeedKph: 100, grades: [], perfectCount: 0, passiveCash: 0 };
  const o1 = game.finishRace(fake);
  assert(o1.next === 'race' && o1.mulliganUsed && s.phase === 'race', 'mulligan reruns');
  game.startRace(); // re-derives setup, consumes nothing
  const o2 = game.finishRace(fake);
  assert(o2.next === 'result' && !o2.mulliganUsed && o2.payout === null, 'second loss ends');
  game.continueFromResult();
  assert(s.phase === 'gameover', 'gameover');
  // Payout math.
  game.newRun('PAYOUT');
  game.leaveShop();
  game.startRace();
  const win = game.finishRace({ ...fake, et: 13.25, won: true, margin: 0.55, passiveCash: 2 });
  assert(!!win.payout && win.payout.base === 6 && win.payout.timeBonus === 4 && win.payout.total === 12, 'payout 6+4cap+2');
  game.continueFromResult();
  const s2 = game.state;
  assert(s2.phase === 'shop' && s2.race === 1 && !s2.shop!.freePack, 'advance to next shop');
  console.log('API checks: OK');
}

// ---------- Main ----------
apiChecks();

// Determinism: same seed + same decisions -> identical shops.
const a = playRun('DETERM', 'perfect');
const b = playRun('DETERM', 'perfect');
const same = JSON.stringify(a.shops) === JSON.stringify(b.shops);
console.log(`\nDeterminism (seed DETERM, ${a.shops.length} shops): ${same ? 'IDENTICAL' : 'MISMATCH'}`);
if (!same) process.exitCode = 1;

const seeds = Array.from({ length: RUNS }, (_, i) => `SMOKE${i + 1}`);
const summary: Record<string, RunSummary[]> = {};
for (const profile of ['perfect', 'average', 'sloppy'] as Profile[]) {
  summary[profile] = seeds.map((sd) => playRun(sd, profile));
}

console.log('\n=== SUMMARY ===');
for (const [profile, runs] of Object.entries(summary)) {
  const wins = runs.filter((r) => r.won).length;
  const avgRaces = runs.reduce((n, r) => n + r.racesWon, 0) / runs.length;
  console.log(`${profile.padEnd(8)} victories ${wins}/${runs.length}, avg races won ${avgRaces.toFixed(1)}/16`);
  for (const r of runs) console.log(`   ${r.seed}: ${r.reached} (won ${r.racesWon}, $${r.cash})`);
}
