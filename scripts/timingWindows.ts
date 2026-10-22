// Prints how long (ms) the Perfect and Good shift bands last in each gear, versus the launch window.
import { game } from '../src/game/game';
import { RaceSim } from '../src/sim/RaceSim';
import { makeBot } from '../src/sim/bots';

game.newRun('TIMING');
game.leaveShop();
const { setup } = game.previewStats();
const sim = new RaceSim(setup);
const bot = makeBot('perfect', 1);
const bands: Record<number, { perfect: number; good: number }> = {};
while (sim.state.phase !== 'finished') {
  const s = sim.state;
  if (s.phase === 'running' && s.gear < 4) {
    const w = s.shiftWindow;
    const b = (bands[s.gear] ??= { perfect: 0, good: 0 });
    if (s.rpm >= w.perfectLo && s.rpm <= w.perfectHi) b.perfect += 1000 / 120;
    if (s.rpm >= w.goodLo && s.rpm <= w.goodHi) b.good += 1000 / 120;
  }
  // Shift only when the needle reaches the top of the perfect band, so the full band is measured.
  const act = s.phase === 'running' && s.gear < 4 && s.rpm < s.shiftWindow.perfectHi ? null : bot(sim);
  if (act) sim.input(act);
  sim.step();
}
console.log('Launch: Perfect = 0-60 ms after green, Good = 61-150 ms');
for (const [g, b] of Object.entries(bands)) console.log(`Shift ${g}->${+g + 1}: Perfect band lasts ~${Math.round(b.perfect)} ms, Good band (incl. perfect) ~${Math.round(b.good)} ms`);
