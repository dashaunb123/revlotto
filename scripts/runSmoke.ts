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
const CHASE_ONLY = args.includes('--chase'); // only the API checks + the brand/set-chasing report
const log = (...a: unknown[]) => {
  if (!QUIET) console.log(...a);
};

const TIER_RANK: Record<Tier, number> = { stock: 0, street: 1, sport: 2, pro: 3 };
const installedRank = (slot: string) => TIER_RANK[game.part(game.state.parts[slot as keyof typeof game.state.parts].partId).tier];
const plainUpgrade = (partId: string) => {
  const p = game.part(partId);
  return TIER_RANK[p.tier] > installedRank(p.slot);
};

/** Set chaser: the brand it is collecting (most installed parts; ties -> higher tier). */
function chaseBrand(): string | null {
  if (OPTS.prefer) return OPTS.prefer;
  const counts = game.brandCounts();
  let best: string | null = null;
  let bestScore = 0;
  for (const b of game.brands()) {
    const n = counts[b.id] ?? 0;
    const sc = n * 10 + TIER_RANK[b.tier];
    if (n > 0 && sc > bestScore) {
      best = b.id;
      bestScore = sc;
    }
  }
  return best;
}
/** Chaser wants a part when it is the chased brand in a slot not yet of that brand (always, even a same-tier swap). */
const chaseWants = (partId: string) => {
  const b = chaseBrand();
  const p = game.part(partId);
  return !!b && p.brand === b && game.part(game.state.parts[p.slot].partId).brand !== b;
};
/** Would this part break the chased set (replace one of its parts)? */
const breaksChase = (partId: string) => {
  const b = chaseBrand();
  const p = game.part(partId);
  return !!b && p.brand !== b && game.part(game.state.parts[p.slot].partId).brand === b && (game.brandCounts()[b] ?? 0) >= 3;
};
const isUpgrade = (partId: string) => {
  if (!OPTS.chase) return plainUpgrade(partId);
  if (chaseWants(partId)) return true;
  // Chaser saves its cash for the set: other upgrades only into Stock slots, and only with cash to spare.
  const p = game.part(partId);
  const instTier = game.part(game.state.parts[p.slot].partId).tier;
  return plainUpgrade(partId) && !breaksChase(partId) && (instTier === 'stock' || !chaseBrand()) && game.state.cash >= p.cost + 6;
};

function cardScore(c: PackCard): number {
  switch (c.kind) {
    case 'part': {
      const p = game.part(c.partId);
      if (OPTS.chase && chaseWants(c.partId)) return 200 + p.cost;
      return isUpgrade(c.partId) ? 100 + p.cost : -1;
    }
    case 'passive':
      return game.state.passives.length < game.state.passiveSlots ? 80 : -1;
    case 'tuning':
      return 60;
    case 'consumable':
      return game.state.consumables.length < game.state.consumableSlots ? 20 : -1;
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
  if (OPTS.garage) {
    const g = shop().garageOffer;
    if (g && !g.sold && game.state.cash >= g.price + 2) {
      const r = game.buyGarage();
      if (!r.ok) throw new Error('buyGarage failed: ' + r.reason);
    }
  }
  // Free pack first.
  shop().packs.forEach((p, i) => {
    if (!p.sold && p.price === 0 && game.buyPack(i).ok) resolvePack();
  });
  for (let pass = 0; pass < 4; pass++) {
    // Parts: best upgrades first.
    const parts = shop()
      .items.map((it, i) => ({ it, i }))
      .filter(({ it }) => it.kind === 'part' && !it.sold && isUpgrade(it.partId))
      .sort((a, b) => (OPTS.chase ? +chaseWants(b.it.kind === 'part' ? b.it.partId : '') - +chaseWants(a.it.kind === 'part' ? a.it.partId : '') : 0) || b.it.price - a.it.price);
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
    // Reroll only when rich (or free).
    if (shop().freeRerolls > 0 || game.state.cash >= shop().rerollCost + 14) game.reroll();
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

interface PlayOpts {
  car?: string;
  heat?: number;
  skip?: boolean; // skip race index 1 of each round for its tag
  garage?: boolean; // buy garage upgrades when affordable
  endlessRounds?: number; // keep racing this many rounds past the victory
  chase?: boolean; // set-chasing shopper: collects one brand toward its paragon
  prefer?: string; // with chase: always this brand (else the brand it already has most of)
}

/** Per-race log for the brand report: was a paragon active, which tier, did it win. */
interface RaceLog {
  round: number;
  won: boolean;
  paragon: string | null;
}
const RACE_LOG: RaceLog[] = [];
/** Paragon completions: brand + race number (1..16) when it first turned on in a run. */
const COMPLETIONS: { brand: string; race: number; profile: string }[] = [];
let OPTS: PlayOpts = {};

/** State invariants checked after every action of the extended runs. */
function checkInvariants(where: string): void {
  const s = game.state;
  const bad = (m: string) => {
    throw new Error(`invariant failed (${where}, seed ${s.seed} R${s.round}.${s.race + 1} ${s.phase}): ${m}`);
  };
  if (s.passives.length !== s.passiveEditions.length) bad('passiveEditions out of sync');
  if (new Set(s.passives).size !== s.passives.length) bad('duplicate passive');
  if (s.passives.length > s.passiveSlots) bad(`passives ${s.passives.length} > slots ${s.passiveSlots}`);
  if (s.consumables.length > s.consumableSlots) bad(`consumables ${s.consumables.length} > slots ${s.consumableSlots}`);
  if (!(s.cash >= 0) || !Number.isInteger(s.cash)) bad(`cash ${s.cash}`);
  if (s.bosses.length < Math.max(4, s.round)) bad('bosses not drawn');
  if (new Set(s.bosses.slice(0, 4)).size !== 4) bad('boss repeat in rounds 1-4');
  if (game.boss(s.bosses[3]).tier !== 'final') bad('round 4 boss not final');
  for (const t of s.tags) game.tag(t);
  for (const g of s.garage) game.garageUpgrade(g);
  if (new Set(s.garage).size !== s.garage.length) bad('duplicate garage upgrade');
  if (s.heat >= 7 && (s.consumables.includes('mulligan') || s.tags.includes('mulligan'))) bad('mulligan at heat 7+');
  if (s.shop) {
    const sh = s.shop;
    if (sh.rerollCost < 0) bad('negative reroll');
    for (const it of sh.items) if (it.price < 0) bad('negative price');
    if (s.heat >= 7 && sh.items.some((it) => it.kind === 'consumable' && it.consumableId === 'mulligan')) bad('mulligan in shop at heat 7+');
  }
  structuredClone(s);
}

function playRun(seed: string, profile: Profile, opts: PlayOpts = {}): RunSummary {
  OPTS = opts;
  game.newRun(seed, { car: opts.car, heat: opts.heat });
  let victories = 0;
  let skips = 0;
  const shops: string[] = [];
  let racesWon = 0;
  let guard = 0;
  log(`\n=== ${profile.toUpperCase()} seed ${game.state.seed} ===`);
  while (game.state.phase !== 'gameover' && guard++ < 400) {
    const s = game.state;
    checkInvariants('loop');
    if (s.phase === 'victory') {
      victories++;
      if (!opts.endlessRounds || s.endless) break;
      game.continueEndless();
      if (game.state.round !== 5 || game.state.phase !== 'shop' || !game.state.endless) throw new Error('continueEndless failed');
      continue;
    }
    if (s.endless && s.round > 4 + (opts.endlessRounds ?? 0)) break;
    switch (s.phase) {
      case 'shop': {
        shops.push(snapshotShop());
        const before = s.cash;
        shopAI();
        if (game.state.paragonJustUnlocked) {
          const pb = game.state.paragonJustUnlocked;
          if (pb !== game.activeParagon()) throw new Error('paragonJustUnlocked without active paragon');
          COMPLETIONS.push({ brand: pb, race: game.raceNumber(), profile });
          log(`    *** PARAGON: ${game.brand(pb)!.paragon.name} ***`);
          game.ackParagon();
        }
        const installed = SLOTS.filter((sl) => game.part(s.parts[sl].partId).tier !== 'stock').length;
        log(
          `  [R${s.round}.${s.race + 1}] shop $${before} -> $${s.cash} | ${installed}/12 upgraded | brands ${JSON.stringify(game.brandCounts())} | passives ${s.passives.join(',') || '-'} | cons ${s.consumables.join(',') || '-'} | tuning ${s.tuningCards}`,
        );
        game.leaveShop();
        break;
      }
      case 'staging': {
        if (opts.skip && s.race === 1) {
          const tag = game.skipTagPreview();
          const before = s.race;
          const r = game.skipRace();
          if (!r.ok || !tag || game.state.race !== before + 1 || game.state.phase !== 'staging') throw new Error('skip failed');
          skips++;
          log(`    skipped race ${game.raceNumber() - 1} for tag ${tag.name}`);
          break;
        }
        if (game.isBossRace() && game.skipRace().ok) throw new Error('boss skip allowed');
        const pre = game.previewStats().setup;
        if (game.isBossRace() && !pre.boss) throw new Error('boss setup missing');
        if (opts.heat && opts.heat >= 8 && game.isBossRace() && !pre.boss?.extra?.length) throw new Error('heat 8 extra modifier missing');
        s.consumables.forEach((_, i) => game.toggleStagedConsumable(i));
        const r = race(profile, hashSeed(seed) ^ (s.round * 16 + s.race));
        const out = game.finishRace(r);
        if (!s.endless) RACE_LOG.push({ round: s.round, won: r.won, paragon: pre.paragon?.brand ?? null });
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
  const reached =
    (victories ? 'VICTORY' : '') +
    (st.phase === 'gameover' || !victories ? `${victories ? ', then ' : ''}died at R${st.round} race ${st.race + 1}${st.race === 3 ? ' (boss)' : ''}` : '') +
    (st.endless ? ` [endless R${st.round}]` : '');
  log(`  => ${reached}, races won ${racesWon}, skips ${skips}, garage ${st.garage.join(',') || '-'}, cash $${st.cash}`);
  return { seed: st.seed, profile, won: victories > 0, racesWon, reached, shops, cash: st.cash };
}

// ---------- Sanity checks on the API ----------
function apiChecks(): void {
  game.newRun('CHECKS');
  const s = game.state;
  const assert = (c: boolean, m: string) => {
    if (!c) throw new Error('API check failed: ' + m);
  };
  assert(s.cash === CONTENT.balance.economy.startCash + 4, 'start cash (Daily Driver +$4)');
  assert(s.phase === 'shop' && !!s.shop && s.shop.freePack, 'starts in shop with free pack');
  assert(s.shop!.packs[1].price === 0, 'power pack free');
  assert(s.shop!.items.length === 4, '4 loose items');
  assert(!game.sellPart('engine').ok, 'cannot sell stock');
  const rc = s.shop!.rerollCost;
  game.reroll();
  assert(s.cash === CONTENT.balance.economy.startCash + 4 - rc, 'reroll charged');
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

  // Heat + cars.
  game.newRun('HEATS', { car: 'big_torque', heat: 8 });
  const h = game.state;
  assert(h.heat === 8 && h.car === 'big_torque' && h.cash === CONTENT.balance.economy.startCash - 5, 'heat 8 start cash');
  assert(h.shop!.rerollCost === CONTENT.balance.prices.rerollBase + 1, 'heat 3 reroll +1');
  assert(h.shop!.packs[0].price === CONTENT.balance.prices.partsPack + 1, 'heat 3 pack +1');
  assert(!!h.shop!.garageOffer, 'garage offer in run-start shop');
  const base0 = game.previewStats().breakdown;
  assert(base0[1]?.kind === 'base' && base0[1].stats.power === 250, 'big torque power x1.25');
  const opp0 = game.currentOpponent();
  assert(Math.abs(opp0.targetEt - 14.3 * 0.98 * 0.98) < 0.002, 'heat 2+6 targets');
  game.newRun('TOW', { car: 'tow_rig' });
  assert(game.state.passiveSlots === 6, 'tow rig 6 slots');
  game.newRun('TRUST', { car: 'trust_fund' });
  assert(SLOTS.filter((sl) => game.part(game.state.parts[sl].partId).tier === 'street').length === 2, 'trust fund 2 street parts');
  game.newRun('ENDLESS');
  const bossesA = [...game.state.bosses];
  game.newRun('ENDLESS');
  assert(JSON.stringify(bossesA) === JSON.stringify(game.state.bosses), 'boss draw deterministic');
  // Garage: force-buy and check effects.
  const g = game.state;
  g.cash = 200;
  g.shop!.garageOffer = { id: 'toolbox', price: 10, sold: false };
  assert(game.buyGarage().ok && g.passiveSlots === 6 && g.cash === 190, 'toolbox');
  assert(!game.buyGarage().ok, 'garage once');
  g.shop!.garageOffer = { id: 'extra_shelf', price: 10, sold: false };
  const n0 = g.shop!.items.length;
  assert(game.buyGarage().ok && g.shop!.items.length === n0 + 1, 'extra shelf adds an item now');
  g.shop!.garageOffer = { id: 'pack_rat', price: 10, sold: false };
  game.buyGarage();
  assert(game.buyPack(0).ok && g.shop!.openPack!.picksLeft === 2, 'pack rat 2 picks');
  game.pickPackCard(0);
  assert(!!g.shop!.openPack && g.shop!.openPack.cards.length === 2, 'pack stays open for pick 2');
  game.pickPackCard(0);
  assert(!g.shop!.openPack, 'pack closes after 2');
  // Skip: tag preview stable and matches what you get.
  game.leaveShop();
  const t1 = game.skipTagPreview();
  assert(!!t1 && t1.id === game.skipTagPreview()!.id, 'tag preview stable');
  const held = g.tags.length;
  assert(game.skipRace().ok && g.race === 1 && g.phase === 'staging', 'skip -> next staging');
  assert(g.tags.length === held + 1 || ['tuning_card', 'extra_consumable'].includes(t1!.id), 'tag gained');
  assert(g.history[g.history.length - 1].skipped === true, 'skip recorded');
  // Brands, sets and the paragon transform.
  game.newRun('PARAGON');
  const p = game.state;
  const mal = CONTENT.parts.filter((x) => x.brand === 'malibru');
  assert(mal.length === 12 && game.brand('malibru')!.tier === 'street', 'malibru has 12 street parts');
  for (const x of mal.slice(0, 11)) p.parts[x.slot] = { partId: x.id, level: 0 };
  assert(game.brandCounts().malibru === 11 && game.activeParagon() === null, '11/12: no paragon');
  const pre11 = game.previewStats();
  assert(pre11.breakdown.some((b) => b.source === 'MALIBRU SET (8)') && !pre11.setup.paragon, 'set 8 step, no paragon');
  p.cash = 100;
  p.shop!.items[0] = { kind: 'part', partId: mal[11].id, price: 6, sold: false };
  assert(game.buyItem(0).ok, 'buy 12th part');
  assert(p.paragonJustUnlocked === 'malibru' && game.activeParagon() === 'malibru', 'transform flag');
  assert(game.takeRunNotes().some((n) => n.startsWith('PARAGON')), 'paragon run note');
  game.ackParagon();
  assert(!p.paragonJustUnlocked, 'ack clears');
  const pre12 = game.previewStats();
  assert(pre12.setup.paragon?.ability === game.brand('malibru')!.paragon.ability, 'setup.paragon ability');
  assert(pre12.breakdown.some((b) => b.kind === 'paragon' && b.source === 'PARAGON: MALIBRU SS'), 'paragon breakdown step');
  assert(pre12.setup.stats.power > pre11.setup.stats.power * 1.15, 'paragon mult');
  assert(game.sellPart('engine').ok && game.activeParagon() === null && !p.paragonJustUnlocked, 'sell breaks the paragon');
  console.log('API checks: OK');
}

// ---------- Main ----------
apiChecks();

if (!CHASE_ONLY) {
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

// ---------- Extended: heat 0/8 x every starting car, with skips, garage buys and endless ----------
const ext: string[] = [];
let extVictories = 0;
let extEndless = 0;
for (const heat of [0, 8]) {
  for (const car of CONTENT.startingCars.map((c) => c.id)) {
    for (const [k, profile] of (['perfect', 'average'] as Profile[]).entries()) {
      const seed = `X${heat}${car.slice(0, 3).toUpperCase()}${k}`;
      const r = playRun(seed, profile, { car, heat, skip: true, garage: true, endlessRounds: 3 });
      if (r.won) extVictories++;
      if (game.state.endless) extEndless = Math.max(extEndless, game.state.round);
      ext.push(`H${heat} ${car.padEnd(12)} ${profile.padEnd(7)} ${r.seed}: ${r.reached} (won ${r.racesWon}, $${r.cash})`);
    }
  }
}
// Determinism with car + heat + skips + garage.
const d1 = playRun('DETX', 'perfect', { car: 'trust_fund', heat: 8, skip: true, garage: true, endlessRounds: 2 });
const d2 = playRun('DETX', 'perfect', { car: 'trust_fund', heat: 8, skip: true, garage: true, endlessRounds: 2 });
const same2 = JSON.stringify(d1) === JSON.stringify(d2);
console.log(`Determinism (DETX, trust_fund heat 8, ${d1.shops.length} shops): ${same2 ? 'IDENTICAL' : 'MISMATCH'}`);
if (!same2) process.exitCode = 1;
console.log(`\n=== EXTENDED (${ext.length} runs, invariants OK, ${extVictories} victories, furthest endless round ${extEndless || '-'}) ===`);
for (const l of ext) console.log('  ' + l);

console.log('\n=== SUMMARY ===');
for (const [profile, runs] of Object.entries(summary)) {
  const wins = runs.filter((r) => r.won).length;
  const avgRaces = runs.reduce((n, r) => n + r.racesWon, 0) / runs.length;
  console.log(`${profile.padEnd(8)} victories ${wins}/${runs.length}, avg races won ${avgRaces.toFixed(1)}/16`);
  for (const r of runs) console.log(`   ${r.seed}: ${r.reached} (won ${r.racesWon}, $${r.cash})`);
}
}

// ---------- Brands: set-chasing shopper ----------
RACE_LOG.length = 0;
COMPLETIONS.length = 0;
const CHASE_RUNS = Math.max(4, RUNS * 2);
const chaseRuns: { brand: string; profile: Profile; r: RunSummary; paragonAt: number | null }[] = [];
for (const brand of [undefined, ...CONTENT.brands.map((b) => b.id)]) {
  for (const profile of ['perfect', 'average'] as Profile[]) {
    for (let i = 0; i < CHASE_RUNS; i++) {
      const before = COMPLETIONS.length;
      const r = playRun(`CH${(brand ?? 'any').slice(0, 4).toUpperCase()}${i}`, profile, { chase: true, prefer: brand });
      const c = COMPLETIONS.slice(before)[0];
      chaseRuns.push({ brand: brand ?? 'any', profile, r, paragonAt: c ? c.race : null });
    }
  }
}
console.log(`\n=== BRANDS: set-chasing shopper (${CHASE_RUNS} runs per brand x profile) ===`);
console.log('  prefer        profile  paragon%  avg race done (earliest)  victories  avg races won');
for (const brand of ['any', ...CONTENT.brands.map((b) => b.id)]) {
  for (const profile of ['perfect', 'average'] as Profile[]) {
    const rs = chaseRuns.filter((x) => x.brand === brand && x.profile === profile);
    const done = rs.filter((x) => x.paragonAt !== null);
    const avgAt = done.length ? `${(done.reduce((n, x) => n + x.paragonAt!, 0) / done.length).toFixed(1)} (${Math.min(...done.map((x) => x.paragonAt!))})` : '-';
    const vic = rs.filter((x) => x.r.won).length;
    const avgWon = (rs.reduce((n, x) => n + x.r.racesWon, 0) / rs.length).toFixed(1);
    console.log(`  ${brand.padEnd(13)} ${profile.padEnd(8)} ${String(Math.round((100 * done.length) / rs.length)).padStart(5)}%    ${avgAt.padStart(11)}           ${vic}/${rs.length}       ${avgWon}`);
  }
}
const byBrand: Record<string, number> = {};
for (const c of COMPLETIONS) byBrand[c.brand] = (byBrand[c.brand] ?? 0) + 1;
console.log('  completions by brand (all chase runs):', JSON.stringify(byBrand));
console.log('\n  race win% with / without an active paragon, by round and paragon tier:');
for (const round of [1, 2, 3, 4]) {
  const rl = RACE_LOG.filter((x) => x.round === round);
  const pc = (xs: RaceLog[]) => (xs.length ? `${Math.round((100 * xs.filter((x) => x.won).length) / xs.length)}% (${xs.length})` : '-');
  const tierOf = (b: string | null) => (b ? game.brand(b)!.tier : 'none');
  const cols = ['none', 'street', 'sport', 'pro'].map((t) => `${t} ${pc(rl.filter((x) => tierOf(x.paragon) === t))}`);
  console.log(`   R${round}: ${cols.join('  |  ')}`);
}
