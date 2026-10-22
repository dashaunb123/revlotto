// Result: time slip, grade chips, Balatro-style cash-out tally (win) or RUN OVER (loss).
import Phaser from 'phaser';
import type { GradeEvent } from '../core/types';
import { game } from '../game/game';
import { sfx, toggleMute, unlockAudio } from '../render/audio';
import { fxText, popup, stamp } from '../render/fx';
import { GAME_H, GAME_W, GRADE_COLOR, PAL, hex } from '../render/palette';
import { hitBox, panel, txt } from '../render/ui';
import { goToPhase } from './nav';

function gradeName(e: GradeEvent): string {
  switch (e.kind) {
    case 'launch':
      return 'LAUNCH';
    case 'shift':
      return `GEAR ${e.gear ?? '?'}>${(e.gear ?? 0) + 1}`;
    case 'nitro':
      return 'NITROUS';
    case 'false_start':
      return 'JUMPED';
  }
}

export class ResultScene extends Phaser.Scene {
  private busy = true;
  private skipAll: (() => void) | null = null;
  private leaving = false;
  private queue: Phaser.Time.TimerEvent[] = [];

  constructor() {
    super('Result');
  }

  create() {
    this.busy = true;
    this.leaving = false;
    this.queue = [];
    const s = game.state;
    const r = s.lastResult;
    this.cameras.main.fadeIn(180, 11, 10, 20);
    this.add.rectangle(0, 0, GAME_W, GAME_H, PAL.bg).setOrigin(0, 0);
    const bgG = this.add.graphics();
    for (let y = 0; y < GAME_H; y += 16)
      for (let x = (y / 16) % 2 ? 16 : 0; x < GAME_W; x += 32) bgG.fillStyle(0x100e1c, 1).fillRect(x, y, 16, 16);

    if (!r) {
      fxText(this, 320, 160, 'NO RESULT', 16, PAL.inkDim);
      this.busy = false;
      this.makeContinue(false);
      return;
    }
    const won = r.won;
    const opName = (s.history[s.history.length - 1]?.opponent ?? game.currentOpponent().name).toUpperCase();

    // ---- banner ----
    const banner = stamp(this, null, 320, 36, won ? 'YOU WIN!' : 'DEFEATED', won ? PAL.green : PAL.red, 32, 100);
    void banner;
    this.at(200, () => sfx.slam());
    txt(this, 320, 68, `VS ${opName.slice(0, 30)}`, 8, PAL.inkDim, [0.5, 0]);

    // ---- time slip ----
    panel(this, 12, 78, 300, 226);
    txt(this, 24, 86, 'TIME SLIP', 8, PAL.inkDim);
    const marginCol = r.margin >= 0 ? PAL.green : PAL.red;
    const rows: [string, string, number, 8 | 16][] = [
      ['YOUR ET', r.et.toFixed(3), won ? PAL.green : PAL.red, 16],
      ['TARGET', r.targetEt.toFixed(3), PAL.yellow, 16],
      [r.margin >= 0 ? 'UNDER BY' : 'OVER BY', Math.abs(r.margin).toFixed(3), marginCol, 16],
      ['REACTION', r.reaction.toFixed(3), r.reaction <= 0.06 ? PAL.green : r.reaction <= 0.15 ? PAL.yellow : PAL.red, 8],
      ['TRAP', `${r.trapSpeedKph.toFixed(1)} KM/H`, PAL.ink, 8],
    ];
    let y = 102;
    rows.forEach(([label, val, col, size], i) => {
      const yy = y;
      this.at(350 + i * 160, () => {
        const l = txt(this, 24, yy + (size === 16 ? 4 : 0), label, 8, PAL.inkDim);
        const v = fxText(this, 300, yy + (size === 16 ? 8 : 4), val, size, col, 3).setOrigin(1, 0.5);
        v.setScale(1.6);
        l.setAlpha(0);
        this.tweens.add({ targets: v, scale: 1, duration: 180, ease: 'Back.easeOut' });
        this.tweens.add({ targets: l, alpha: 1, duration: 120 });
        sfx.tick();
      });
      y += size === 16 ? 22 : 14;
    });

    // grade chips
    const gy = y + 8;
    txt(this, 24, gy, `GRADES  ${r.perfectCount} PERFECT`, 8, PAL.inkDim);
    const base = 350 + rows.length * 160;
    r.grades.forEach((e, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cx = 24 + col * 140;
      const cy = gy + 14 + row * 18;
      if (cy > 290) return;
      this.at(base + i * 110, () => {
        const c = this.add.container(cx, cy);
        const g = this.add.graphics();
        const gc = GRADE_COLOR[e.grade];
        g.fillStyle(PAL.bgDeep, 1).fillRect(1, 1, 136, 14);
        g.fillStyle(PAL.panelLight, 1).fillRect(0, 0, 136, 14);
        g.fillStyle(gc, 1).fillRect(72, 0, 64, 14);
        c.add([g, txt(this, 4, 3, gradeName(e), 8, PAL.ink), txt(this, 104, 3, e.grade.toUpperCase(), 8, PAL.bgDeep, [0.5, 0])]);
        c.setScale(0.3).setAlpha(0);
        this.tweens.add({ targets: c, scale: 1, alpha: 1, duration: 160, ease: 'Back.easeOut' });
        if (e.grade === 'perfect') sfx.perfect();
        else if (e.grade === 'miss') sfx.miss();
        else sfx.tick();
      });
    });
    const afterSlip = base + r.grades.length * 110 + 150;

    // ---- right side ----
    panel(this, 328, 78, 300, 226, PAL.panel, won ? PAL.cash : PAL.red);
    if (won) this.cashOut(afterSlip);
    else this.runOver(afterSlip, opName);

    this.makeContinue(won);

    const kb = this.input.keyboard!;
    kb.addCapture('SPACE');
    kb.on('keydown-SPACE', () => this.next());
    kb.on('keydown-ENTER', () => this.next());
    kb.on('keydown-M', () => toggleMute());
  }

  private at(ms: number, fn: () => void) {
    this.queue.push(this.time.delayedCall(ms, fn));
  }

  private cashOut(start: number) {
    const p = game.state.lastPayout;
    txt(this, 340, 86, 'CASH OUT', 8, PAL.cash);
    const lines = p?.lines ?? [];
    let total = 0;
    const totalText = fxText(this, 616, 266, '$0', 24, PAL.cash, 4).setOrigin(1, 0.5).setAlpha(0);
    const totalLabel = txt(this, 340, 260, 'TOTAL', 8, PAL.inkDim).setAlpha(0);
    lines.forEach((ln, i) => {
      const y = 104 + i * 34;
      this.at(start + i * 420, () => {
        // 'Time bonus (0.838s under, capped)' -> main label + dim detail line
        const full = ln.label.toUpperCase();
        const paren = full.indexOf('(');
        const main = (paren > 0 ? full.slice(0, paren) : full).trim().slice(0, 24);
        const detail = paren > 0 ? full.slice(paren + 1).replace(/\)\s*$/, '').slice(0, 26) : '';
        const l = txt(this, 340, y, main, 8, PAL.ink);
        if (detail) txt(this, 340, y + 11, detail, 8, PAL.inkDim);
        const g = this.add.graphics();
        for (let x = 340; x < 560; x += 6) g.fillStyle(PAL.panelEdge, 1).fillRect(x, y + 23, 2, 2);
        const a = fxText(this, 616, y + 10, `$${ln.amount}`, 16, PAL.cash, 3).setOrigin(1, 0.5);
        a.setScale(2).setAlpha(0);
        l.setAlpha(0);
        this.tweens.add({ targets: l, alpha: 1, duration: 120 });
        this.tweens.add({ targets: a, scale: 1, alpha: 1, duration: 200, ease: 'Back.easeOut' });
        sfx.coin();
        const from = total;
        total += ln.amount;
        totalText.setAlpha(1);
        totalLabel.setAlpha(1);
        this.tweens.addCounter({
          from,
          to: total,
          duration: 260,
          onUpdate: (tw) => totalText.setText(`$${Math.round(tw.getValue() ?? total)}`),
        });
        totalText.setScale(1.4);
        this.tweens.add({ targets: totalText, scale: 1, duration: 220, ease: 'Back.easeOut' });
        popup(this, null, 560, y + 6, `+$${ln.amount}`, PAL.cash, 8, { rise: 16, hold: 300 });
      });
    });
    const end = start + lines.length * 420 + 200;
    this.at(end, () => {
      totalText.setText(`$${p?.total ?? total}`);
      txt(this, 340, 284, `BANK  $${game.state.cash}`, 8, PAL.inkDim);
      this.cameras.main.shake(120, 0.004);
      sfx.win();
      this.busy = false;
    });
    this.skipAll = () => {
      this.queue.forEach((t) => {
        if (t.getProgress() < 1) {
          t.remove(false);
          (t.callback as () => void)?.call(t.callbackScope);
        }
      });
      this.queue = [];
      this.busy = false;
    };
  }

  private runOver(start: number, opName: string) {
    const s = game.state;
    const r = s.lastResult!;
    txt(this, 340, 86, 'NO CASH', 8, PAL.red);
    this.at(start, () => {
      sfx.lose();
      this.cameras.main.shake(400, 0.012);
      this.cameras.main.flash(250, 232, 65, 60);
      const st = stamp(this, null, 478, 150, 'RUN OVER', PAL.red, 24);
      void st;
      const wins = s.history.filter((h) => h.won).length;
      txt(this, 478, 186, `LOST BY ${Math.abs(r.margin).toFixed(3)} S`, 8, PAL.ink, [0.5, 0]);
      txt(this, 478, 202, `TO ${opName.slice(0, 28)}`, 8, PAL.inkDim, [0.5, 0]);
      txt(this, 478, 230, `RACES WON  ${wins}`, 8, PAL.ink, [0.5, 0]);
      txt(this, 478, 246, `ROUND ${s.round}  RACE ${s.race + 1}/4`, 8, PAL.inkDim, [0.5, 0]);
      // red vignette pulse
      const v = this.add.rectangle(0, 0, GAME_W, GAME_H, PAL.red, 0).setOrigin(0, 0);
      this.tweens.add({ targets: v, fillAlpha: 0.12, duration: 700, yoyo: true, repeat: -1 });
      this.busy = false;
    });
    this.skipAll = () => {
      this.queue.forEach((t) => {
        if (t.getProgress() < 1) {
          t.remove(false);
          (t.callback as () => void)?.call(t.callbackScope);
        }
      });
      this.queue = [];
      this.busy = false;
    };
  }

  private makeContinue(won: boolean) {
    const x = 488,
      y = 314,
      w = 140,
      h = 36;
    const c = this.add.container(x, y);
    const g = this.add.graphics();
    const col = won ? PAL.green : PAL.red;
    g.fillStyle(PAL.bgDeep, 1).fillRect(0, 3, w, h);
    g.fillStyle(col, 1).fillRect(0, 0, w, h);
    g.fillStyle(0xffffff, 0.22).fillRect(0, 0, w, 3);
    const t = fxText(this, w / 2, h / 2, won ? 'CONTINUE' : 'GAME OVER', 8, PAL.ink, 3);
    c.add([g, t]);
    c.setSize(w, h);
    hitBox(c, 0, 0, w, h);
    c.on('pointerup', () => this.next(true));
    this.tweens.add({ targets: t, scale: 1.15, duration: 450, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    txt(this, 16, 328, 'SPACE / ENTER TO CONTINUE', 8, PAL.inkDim);
  }

  private next(force = false) {
    unlockAudio();
    if (this.leaving) return;
    if (this.busy && !force) {
      this.skipAll?.();
      return;
    }
    this.skipAll?.();
    this.leaving = true;
    sfx.click();
    game.continueFromResult();
    goToPhase(this);
  }
}
