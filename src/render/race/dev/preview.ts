// DEV ONLY (not imported by the game): headless screenshot harness for the race scenes.
// /src/render/race/dev/preview.html?s=race|staging|result|cars&stop=ms&bot=perfect|average|sloppy&lose=1
import Phaser from 'phaser';
import '@fontsource/press-start-2p';
import { game } from '../../../game/game';
import { RaceScene } from '../../../scenes/RaceScene';
import { StagingScene } from '../../../scenes/StagingScene';
import { ResultScene } from '../../../scenes/ResultScene';
import { RaceSim } from '../../../sim/RaceSim';
import { makeBot } from '../../../sim/bots';
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
    for (const slot of ['tires', 'aero', 'exhaust', 'forced_induction', 'nitrous', 'intake']) {
      const id = (await import('../../../data/content')).CONTENT.parts.find((p: any) => p.slot === slot && p.tier === 'pro')?.id;
      if (id) s.parts[slot] = { partId: id, level: 0 };
    }
  }
  game.leaveShop();
  let start = 'Staging';
  let data: object = {};
  if (which === 'race') {
    start = 'Race';
    data = { setup: game.startRace(), autopilot: makeBot(bot, 7) };
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
  if (stop > 0) setTimeout(() => g.loop.sleep(), stop);
}
boot();
