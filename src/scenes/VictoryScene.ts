// Victory: confetti + fireworks, run stats, the final build, the seed, New Run.
//
// LAYOUT: title 32px y 16 | RUN STATS panel (20,64)-(310,300) | FINAL BUILD panel (330,64)-(620,300)
//         build: 12 tiles 32x32 at x 346+38c, y 84+38r (6x2); passives list y 172+11i; car ground y 294
//         buttons y 314: NEW RUN (184) TITLE (328), 128x24
import Phaser from 'phaser';
import { SLOTS } from '../core/types';
import { game } from '../game/game';
import { goToPhase } from './nav';
import { GAME_W, PAL, RARITY_COLOR, TIER_COLOR } from '../render/palette';
import { burst, button, panel, pop, sfx, shadowTxt, txt } from '../render/ui';
import { ensureTextures, slotIcon } from '../render/icons';
import { carVisualFromParts, makeCar } from '../render/car';

const TITLE = 'STRIP KING!';
const RAINBOW = [PAL.red, PAL.orange, PAL.yellow, PAL.green, PAL.teal, PAL.blue, PAL.purple, PAL.pink];

export class VictoryScene extends Phaser.Scene {
  private letters: Phaser.GameObjects.Text[] = [];
  private going = false;

  constructor() {
    super('Victory');
  }

  create() {
    this.letters = [];
    this.going = false;
    ensureTextures(this);
    this.cameras.main.fadeIn(300, 255, 255, 255);
    const s = game.state;
    const hist = s.history ?? [];

    const bg = this.add.graphics();
    for (let y = 0; y < 360; y += 12) bg.fillStyle(y % 24 ? 0x0f0d1e : 0x141130, 1).fillRect(0, y, GAME_W, 12);

    // title
    const x0 = 320 - (TITLE.length * 32) / 2;
    TITLE.split('').forEach((ch, i) => {
      const t = shadowTxt(this, x0 + i * 32, 16, ch, 32, RAINBOW[i % RAINBOW.length]);
      t.setScale(0);
      this.tweens.add({ targets: t, scale: 1, delay: 200 + i * 60, duration: 300, ease: 'Back.easeOut' });
      this.letters.push(t);
    });

    // stats
    panel(this, 20, 64, 290, 236);
    txt(this, 34, 74, 'RUN STATS', 8, PAL.yellow);
    const wins = hist.filter((r) => r.won).length;
    const best = hist.length ? Math.min(...hist.map((r) => r.et)) : 0;
    const reacts = hist.map((r) => r.reaction).filter((r) => typeof r === 'number' && r > 0);
    const avgReact = reacts.length ? reacts.reduce((a, b) => a + b, 0) / reacts.length : 0;
    const perfects = hist.reduce((n, r) => n + (r.perfectCount ?? 0), 0);
    const cash = hist.reduce((n, r) => n + (r.cashEarned ?? 0), 0);
    const finalRace = hist[hist.length - 1];
    const rows: [string, string, number][] = [
      ['RACES WON', `${wins} / ${hist.length || 16}`, PAL.green],
      ['BEST ET', best ? `${best.toFixed(3)}S` : '-', PAL.yellow],
      ['FINAL BOSS ET', finalRace ? `${finalRace.et.toFixed(3)}S` : '-', PAL.ink],
      ['AVG REACTION', avgReact ? `${Math.round(avgReact * 1000)}MS` : '-', PAL.teal],
      ['PERFECT GRADES', String(perfects), PAL.green],
      ['CASH EARNED', `$${cash}`, PAL.yellow],
      ['CASH LEFT', `$${s.cash}`, PAL.yellow],
      ['SEED', s.seed, PAL.pink],
    ];
    rows.forEach(([k, v, c], i) => {
      const y = 96 + i * 24;
      const kt = txt(this, 34, y, k, 8, PAL.inkDim).setAlpha(0);
      const vt = txt(this, 296, y - 4, v, 16, c, [1, 0]).setAlpha(0);
      this.time.delayedCall(800 + i * 160, () => {
        kt.setAlpha(1);
        vt.setAlpha(1);
        pop(this, vt, 1.4);
        sfx('cash');
      });
    });

    // final build
    panel(this, 330, 64, 290, 236);
    txt(this, 344, 74, 'FINAL BUILD', 8, PAL.yellow);
    SLOTS.forEach((slot, i) => {
      const ip = s.parts?.[slot];
      if (!ip) return;
      let tier: 'stock' | 'street' | 'pro' = 'stock';
      try {
        const d = game.part(ip.partId);
        tier = d.tier;
      } catch {
        /* unknown part id */
      }
      const x = 346 + (i % 6) * 44;
      const y = 88 + Math.floor(i / 6) * 40;
      const g = this.add.graphics();
      g.fillStyle(tier === 'stock' ? PAL.panelEdge : TIER_COLOR[tier], 1).fillRect(x, y, 36, 36);
      g.fillStyle(PAL.bgDeep, 1).fillRect(x + 2, y + 2, 32, 32);
      this.add.image(x + 18, y + 16, slotIcon(slot)).setScale(2).setAlpha(tier === 'stock' ? 0.5 : 1);
      for (let p = 0; p < ip.level; p++) g.fillStyle(PAL.yellow, 1).fillRect(x + 6 + p * 9, y + 30, 6, 2);
    });
    txt(this, 344, 172, 'PASSIVES', 8, PAL.inkDim);
    (s.passives ?? []).forEach((id, i) => {
      let name = id;
      let col: number = PAL.ink;
      try {
        const d = game.passive(id);
        col = RARITY_COLOR[d.rarity];
      } catch {
        /* unknown */
      }
      txt(this, 344, 184 + i * 11, `${i + 1}. ${name.toUpperCase()}`.slice(0, 32), 8, col === PAL.inkDim ? PAL.ink : col);
    });
    if (!s.passives?.length) txt(this, 344, 184, 'NONE. RESPECT.', 8, PAL.ink);
    try {
      const car = makeCar(this, 520, 292, carVisualFromParts(s.parts), 2);
      this.tweens.add({ targets: car, y: 291, yoyo: true, repeat: -1, duration: 80 });
      this.time.addEvent({ delay: 1400, loop: true, callback: () => car.flameBurst(240) });
    } catch {
      /* car renderer unavailable */
    }

    const newRun = () => {
      if (this.going) return;
      this.going = true;
      try {
        game.abandonRun();
      } catch {
        /* optional */
      }
      game.newRun();
      goToPhase(this, 250);
    };
    button(this, 184, 314, 128, 24, 'NEW RUN', newRun, PAL.red);
    button(this, 328, 314, 128, 24, 'TITLE', () => {
      if (this.going) return;
      this.going = true;
      this.cameras.main.fadeOut(200, 11, 10, 20);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Title'));
    }, PAL.panelLight);
    txt(this, 320, 346, 'ENTER: NEW RUN', 8, PAL.inkDim, [0.5, 0]);
    this.input.keyboard?.on('keydown-ENTER', newRun);

    // party
    sfx('fanfare');
    this.time.addEvent({ delay: 45, loop: true, callback: () => this.confetti() });
    this.time.addEvent({ delay: 650, loop: true, callback: () => this.firework() });
    this.firework();
  }

  update(time: number) {
    const t = time / 1000;
    this.letters.forEach((L, i) => {
      if (L.scale < 0.99) return;
      L.y = 16 + Math.round(Math.sin(t * 4 + i * 0.6) * 3);
      L.setTint(RAINBOW[(i + Math.floor(t * 6)) % RAINBOW.length]);
    });
  }

  private confetti() {
    const p = this.add.image(Phaser.Math.Between(0, GAME_W), -4, 'px').setDepth(60);
    p.setTint(Phaser.Utils.Array.GetRandom(RAINBOW));
    p.setScale(Phaser.Math.Between(1, 2), Phaser.Math.Between(1, 3));
    const dur = Phaser.Math.Between(2600, 4200);
    this.tweens.add({ targets: p, y: 370, duration: dur, onComplete: () => p.destroy() });
    this.tweens.add({ targets: p, x: p.x + Phaser.Math.Between(-24, 24), duration: dur / 3, yoyo: true, repeat: 1, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: p, angle: Phaser.Math.Between(-360, 360), duration: dur });
  }

  private firework() {
    const x = Phaser.Math.Between(60, 580);
    const y = Phaser.Math.Between(30, 140);
    const col = Phaser.Utils.Array.GetRandom(RAINBOW) as number;
    const rocket = this.add.image(x, 360, 'px').setTint(PAL.ink).setDepth(55);
    this.tweens.add({
      targets: rocket,
      y,
      duration: 500,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        rocket.destroy();
        burst(this, x, y, [col, PAL.ink, col], 28, 120, 55);
      },
    });
  }
}
