// DEV ONLY (not imported by the game): headless screenshot harness for the race scenes.
// /src/render/race/dev/preview.html?s=race|staging|result|cars&stop=ms&bot=perfect|average|sloppy&lose=1
// Race extras: rich=1 (pro parts incl. nitrous + turbo), power=N / grip=N (override stats),
// win=1 (target ET you can't miss), pre=s / t=s freeze at a burnout time / sim time
// boss=<modifier id>[&seed=N] races a boss with that modifier (params rolled from seed; boss look from
// bosses.json via &bossid=, else the first boss using the modifier); target=ET overrides the target.
import Phaser from 'phaser';
import '@fontsource/press-start-2p';
import { game } from '../../../game/game';
import { RaceScene } from '../../../scenes/RaceScene';
import { StagingScene } from '../../../scenes/StagingScene';
import { ResultScene } from '../../../scenes/ResultScene';
import { RaceSim } from '../../../sim/RaceSim';
import { makeBot } from '../../../sim/bots';
import { rollBossParams } from '../../../sim/bossMods';
import { Rng } from '../../../core/rng';
import { CONTENT } from '../../../data/content';
import { makeCar } from '../../car';
import type { BodyType, CarVisual } from '../../car';

const q = new URLSearchParams(location.search);
const which = q.get('s') ?? 'race';
const stop = Number(q.get('stop') ?? 0);
const bot = (q.get('bot') ?? 'perfect') as 'perfect' | 'average' | 'sloppy';

class CarsScene extends Phaser.Scene {
  constructor() {
    super('Cars');
  }
  create() {
    this.add.rectangle(0, 0, 640, 360, 0x2a2833).setOrigin(0, 0);
    const bodies: BodyType[] = ['compact', 'muscle', 'wedge', 'truck', 'super'];
    const tiers = ['stock', 'street', 'pro'] as const;
    bodies.forEach((b, i) => {
      tiers.forEach((t, j) => {
        const v: CarVisual = { body: b, color: ['#e8413c', '#3c78e8', '#f7d23e', '#3f7d4e', '#9b4de0'][i], accent: '#f4ecd8', tires: t, aero: t, exhaust: t, intake: t, forcedInduction: j === 2 && i % 2 ? 'pro' : t === 'pro' ? 'street' : t, nitrous: j > 0, carbon: j === 2 };
        const c = makeCar(this, 60 + j * 210, 70 + i * 70, v, 1);
        c.setScale(j === 0 ? 2 : 2);
        c.x = 90 + j * 210;
        c.setWheelSpin(j);
        if (j === 2) c.setNitro(true);
        if (j === 1) c.flameBurst(100000);
      });
    });
  }
}

async function boot() {
  await document.fonts.load('8px "Press Start 2P"');
  game.newRun('PREVIEW');
  if (q.get('rich')) {
    // give the car some parts for visuals
    const s = game.state as any;
    for (const slot of ['tires', 'aero', 'exhaust', 'forced_induction', 'nitrous', 'intake', 'suspension', 'engine']) {
      const id = (await import('../../../data/content')).CONTENT.parts.find((p: any) => p.slot === slot && p.tier === 'pro')?.id;
      if (id) s.parts[slot] = { partId: id, level: 0 };
    }
  }
  game.leaveShop();
  let start = 'Staging';
  let data: object = {};
  if (which === 'race') {
    start = 'Race';
    const setup = game.startRace();
    if (q.get('power')) setup.stats.power = Number(q.get('power'));
    if (q.get('grip')) setup.stats.grip = Number(q.get('grip'));
    if (q.get('win')) setup.targetEt = 30;
    const mod = q.get('boss');
    if (mod) {
      const bid = q.get('bossid') ?? CONTENT.bosses.find((b) => b.modifier === mod)?.id ?? mod;
      setup.boss = { id: bid, modifier: mod, params: rollBossParams(mod, new Rng(Number(q.get('seed') ?? 1))) };
      if (!q.get('win')) setup.targetEt = 13.5;
    }
    if (q.get('target')) setup.targetEt = Number(q.get('target'));
    data = { setup, autopilot: makeBot(bot, Number(q.get('botseed') ?? 7)) };
  } else if (which === 'result') {
    const setup = game.startRace();
    if (q.get('lose')) setup.targetEt = 5;
    const sim = new RaceSim(setup);
    const r = sim.runToEnd(makeBot(bot, 3));
    game.finishRace(r);
    start = 'Result';
  } else if (which === 'cars') start = 'Cars';
  const g = new Phaser.Game({
    type: q.get('canvas') ? Phaser.CANVAS : Phaser.AUTO,
    parent: 'game',
    width: 640,
    height: 360,
    backgroundColor: 0x0b0a14,
    pixelArt: true,
    roundPixels: true,
    zoom: 2,
    fps: { forceSetTimeOut: true, target: 60 },
    scene: [],
  });
  g.scene.add('Staging', StagingScene);
  g.scene.add('Race', RaceScene);
  g.scene.add('Result', ResultScene);
  g.scene.add('Cars', CarsScene);
  g.scene.start(start, data);
  (window as unknown as { __booted: boolean; __PHASER: Phaser.Game }).__booted = true;
  (window as unknown as { __PHASER: Phaser.Game }).__PHASER = g;
  // stop=ms freezes after that much game time (summed frame deltas), so shots land on the same moment
  let played = 0;
  if (stop > 0) g.events.on('poststep', (_t: number, d: number) => (played += Math.min(d, 100)) >= stop && g.loop.sleep());
  // pre=s freezes the race at that preroll (burnout) time, t=s at that sim time (0 = green)
  const pre = q.get('pre'),
    simT = q.get('t');
  if (pre || simT)
    g.events.on('poststep', () => {
      const r = g.scene.getScene('Race') as unknown as { prerollT: number; phase: string; sim?: RaceSim };
      if (!r?.sim) return;
      if (pre && r.prerollT >= Number(pre)) g.loop.sleep();
      if (simT && r.phase !== 'preroll' && r.sim.state.t >= Number(simT)) g.loop.sleep();
    });
  setInterval(() => ((window as unknown as { __fps: number }).__fps = Math.round(g.loop.actualFps)), 250);
}
boot();
