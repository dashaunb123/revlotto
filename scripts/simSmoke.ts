// Quick sanity run: starter car vs round 1 race 1 with each bot profile.
import { RaceSim, ghostX, TRACK_LENGTH } from '../src/sim/RaceSim';
import { makeBot, type BotProfile } from '../src/sim/bots';
import { CONTENT, opponentFor } from '../src/data/content';
import type { RaceSetup } from '../src/core/types';

const opp = opponentFor(1, 0);
const setup: RaceSetup = {
  stats: { ...CONTENT.balance.starter },
  hooks: [],
  quirks: [],
  launchWindowMult: 1,
  extraShiftWindowMult: 1,
  gripEarlyMult: 1,
  gripEarlySeconds: 0,
  targetEt: opp.targetEt,
};

console.log(`Content: ${CONTENT.parts.length} parts, ${CONTENT.passives.length} passives, ${CONTENT.consumables.length} consumables, ${CONTENT.opponents.length} opponents`);
console.log(`Opponent: ${opp.name} target ${opp.targetEt.toFixed(3)} (ghost x at target = ${ghostX(opp.targetEt, opp.targetEt).toFixed(2)} / ${TRACK_LENGTH})`);

for (const profile of ['perfect', 'average', 'sloppy'] as BotProfile[]) {
  const sim = new RaceSim(setup);
  const bot = makeBot(profile, 12345);
  let lastGear = 1;
  const gearLog: string[] = [];
  while (sim.state.phase !== 'finished' && sim.state.t < 60) {
    const a = bot(sim);
    if (a) sim.input(a);
    sim.step();
    if (sim.state.gear !== lastGear) {
      gearLog.push(`${lastGear}->${sim.state.gear}@${sim.state.t.toFixed(2)}s ${(sim.state.v * 3.6).toFixed(0)}kph`);
      lastGear = sim.state.gear;
    }
  }
  const r = sim.result();
  const grades = r.grades.map((g) => `${g.kind}:${g.grade}${g.label ? '(' + g.label + ')' : ''}`).join(' ');
  console.log(`\n[${profile}] ET ${r.et.toFixed(3)}  RT ${r.reaction.toFixed(3)}  trap ${r.trapSpeedKph} kph  ${r.won ? 'WIN' : 'LOSS'} by ${r.margin.toFixed(3)}`);
  console.log(`  shifts: ${gearLog.join(', ')}`);
  console.log(`  grades: ${grades}`);
}
