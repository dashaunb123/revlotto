// Run over: the losing race, a tally of the run, the seed (to replay), New Run / Retry Seed / Title.
//
// LAYOUT: "RUN OVER" 32px y 28 | losing race panel (120,76)-(520,136) | stats panel (120,144)-(520,288)
//         buttons y 302: NEW RUN (120, -> RunSetup) RETRY SEED (256, same car + heat) TITLE (392), each 128x24
import Phaser from 'phaser';
import { game } from '../game/game';
import { goToPhase } from './nav';
import { GAME_W, PAL } from '../render/palette';
import { burst, button, panel, pop, sfx, shadowTxt, txt } from '../render/ui';
import { ensureTextures } from '../render/icons';

export class GameOverScene extends Phaser.Scene {
  private going = false;

  constructor() {
    super('GameOver');
  }

  create() {
    this.going = false;
    ensureTextures(this);
    this.cameras.main.fadeIn(300, 40, 6, 10);
    const s = game.state;
    const hist = s.history ?? [];
    const lost = [...hist].reverse().find((r) => !r.won) ?? null;
    const last = s.lastResult;

    // background: dark red stripes
    const bg = this.add.graphics();
    for (let y = 0; y < 360; y += 8) bg.fillStyle(y % 16 ? 0x140810 : 0x1c0a14, 1).fillRect(0, y, GAME_W, 8);

    const title = shadowTxt(this, 320, 28, 'RUN OVER', 32, PAL.red, [0.5, 0]);
    title.setY(-40);
    this.tweens.add({ targets: title, y: 28, duration: 450, ease: 'Bounce.easeOut', onComplete: () => this.cameras.main.shake(150, 0.006) });

    // losing race
    panel(this, 120, 76, 400, 60, 0x2a1020, PAL.red);
    const et = lost?.et ?? last?.et ?? 0;
    const target = lost?.targetEt ?? last?.targetEt ?? 0;
    const opp = lost?.opponent ?? '???';
    txt(this, 132, 84, `LOST TO ${opp.toUpperCase()}`.slice(0, 46), 8, PAL.ink);
    txt(this, 132, 100, `YOUR ET ${et.toFixed(3)}`, 16, PAL.red);
    txt(this, 508, 100, `TARGET ${target.toFixed(3)}`, 8, PAL.yellow, [1, 0]);
    txt(this, 508, 114, `+${Math.max(0, et - target).toFixed(3)}S SHORT`, 8, PAL.inkDim, [1, 0]);

    // run tally
    panel(this, 120, 144, 400, 148);
    const wins = hist.filter((r) => r.won).length;
    const ran = hist.filter((r) => !r.skipped && r.et > 0);
    const best = ran.length ? Math.min(...ran.map((r) => r.et)) : 0;
    const skipped = hist.filter((r) => r.skipped).length;
    const meta = safe(() => game.meta(), null);
    const endless = s.round > 4;
    const record = meta?.bestEndlessRound ?? 0;
    const perfects = hist.reduce((n, r) => n + (r.perfectCount ?? 0), 0);
    const cash = hist.reduce((n, r) => n + (r.cashEarned ?? 0), 0);
    const raceNo = (s.round - 1) * 4 + s.race + 1;
    const rows: [string, string, number][] = [
      ['ROUND REACHED', endless ? `${s.round} (ENDLESS)` : `${s.round} / 4`, endless ? PAL.teal : PAL.ink],
      ['RACE', `${raceNo}${endless ? '' : ' / 16'}${s.race === 3 ? ' (BOSS)' : ''}`, PAL.ink],
      ['RACES WON', `${wins}${skipped ? `  (+${skipped} SKIPPED)` : ''}`, PAL.green],
      ['FURTHEST ENDLESS', record > 4 ? `ROUND ${record}${endless && s.newEndlessRecord ? '  NEW!' : ''}` : '-', PAL.teal],
      ['BEST ET', best ? best.toFixed(3) : '-', PAL.yellow],
      ['PERFECT GRADES', String(perfects), PAL.green],
      ['CASH EARNED', `$${cash}`, PAL.yellow],
      ['SEED', s.seed, PAL.teal],
    ];
    rows.forEach(([k, v, c], i) => {
      const y = 152 + i * 17;
      const kt = txt(this, 136, y, k, 8, PAL.inkDim).setAlpha(0);
      const vt = txt(this, 504, y, v, 8, c, [1, 0]).setAlpha(0);
      this.time.delayedCall(500 + i * 140, () => {
        kt.setAlpha(1);
        vt.setAlpha(1);
        pop(this, vt, 1.4);
        sfx('hover');
      });
    });

    const newRun = () => {
      if (this.going) return;
      this.going = true;
      try {
        game.abandonRun();
      } catch {
        /* optional */
      }
      this.cameras.main.fadeOut(200, 11, 10, 20);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('RunSetup'));
    };
    button(this, 120, 304, 128, 24, 'NEW RUN', newRun, PAL.red);
    const car = s.car;
    const heat = s.heat;
    button(this, 256, 304, 128, 24, 'RETRY SEED', () => this.go(() => game.newRun(s.seed, { car, heat })), PAL.blue);
    button(this, 392, 304, 128, 24, 'TITLE', () => {
      if (this.going) return;
      this.going = true;
      this.cameras.main.fadeOut(200, 11, 10, 20);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Title'));
    }, PAL.panelLight);
    txt(this, 320, 340, 'ENTER: NEW RUN', 8, PAL.inkDim, [0.5, 0]);
    this.input.keyboard?.on('keydown-ENTER', newRun);
    this.time.delayedCall(450, () => burst(this, 320, 44, [PAL.red, PAL.orange, PAL.inkDim], 30, 160));
    sfx('error');
  }

  private go(start: () => void) {
    if (this.going) return;
    this.going = true;
    try {
      game.abandonRun();
    } catch {
      /* optional */
    }
    start();
    goToPhase(this, 250);
  }
}

function safe<T>(fn: () => T, dflt: T): T {
  try {
    return fn();
  } catch {
    return dflt;
  }
}
