// Race HUD widgets: Christmas-tree starting lights and the segmented tach.
import Phaser from 'phaser';
import type { ShiftWindow } from '../../core/types';
import { PAL } from '../palette';
import { txt } from '../ui';
import { shade } from './pix';

const TACH_MAX = 1.06; // tach full scale in normalized rpm

export class LightTree {
  private g: Phaser.GameObjects.Graphics;
  private x: number;
  private y: number;
  private scene: Phaser.Scene;
  private layer: Phaser.GameObjects.Layer;
  private last = '';

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, x: number, y: number) {
    this.scene = scene;
    this.layer = layer;
    this.x = x;
    this.y = y;
    const bg = scene.add.graphics();
    // pole + housing
    bg.fillStyle(PAL.bgDeep, 1).fillRect(x + 2, y + 2, 64, 146);
    bg.fillStyle(0x3a3550, 1).fillRect(x, y, 64, 146);
    bg.fillStyle(0x1a1726, 1).fillRect(x + 2, y + 2, 60, 142);
    bg.fillStyle(0x3a3550, 1).fillRect(x + 30, y + 4, 4, 126);
    layer.add(bg);
    this.g = scene.add.graphics();
    layer.add(this.g);
    const t1 = txt(scene, x + 18, y + 134, 'OPP', 8, PAL.inkDim, [0.5, 0]);
    const t2 = txt(scene, x + 46, y + 134, 'YOU', 8, PAL.ink, [0.5, 0]);
    layer.add([t1, t2]);
    this.set(0, 0, false);
  }

  private rows() {
    const y = this.y;
    return { pre: y + 12, stage: y + 22, amber: [y + 40, y + 58, y + 76], green: y + 96, red: y + 116 };
  }

  /** staged: 0 none, 1 pre-stage, 2 staged. lights: 0-3 ambers, 4 green. */
  set(lights: number, staged: number, red: boolean) {
    const key = `${lights}|${staged}|${red}`;
    if (key === this.last) return;
    const prev = this.last;
    this.last = key;
    const g = this.g;
    g.clear();
    const r = this.rows();
    const cols = [this.x + 18, this.x + 46];
    cols.forEach((cx, ci) => {
      const bulb = (cy: number, rad: number, color: number, on: boolean) => {
        if (on) {
          g.fillStyle(color, 0.25).fillCircle(cx, cy, rad + 3);
          g.fillStyle(color, 1).fillCircle(cx, cy, rad);
          g.fillStyle(0xffffff, 0.9).fillRect(cx - Math.ceil(rad / 2), cy - Math.ceil(rad / 2), 2, 2);
        } else {
          g.fillStyle(shade(color, -0.75), 1).fillCircle(cx, cy, rad);
          g.fillStyle(shade(color, -0.6), 1).fillRect(cx - Math.ceil(rad / 2), cy - Math.ceil(rad / 2), 2, 2);
        }
      };
      bulb(r.pre, 3, 0xfff2b0, staged >= 1);
      bulb(r.stage, 3, 0xfff2b0, staged >= 2);
      for (let i = 0; i < 3; i++) bulb(r.amber[i], 7, PAL.orange, lights > i && lights < 4);
      bulb(r.green, 7, PAL.green, lights >= 4 && !(red && ci === 1));
      bulb(r.red, 6, PAL.red, red && ci === 1);
    });
    if (prev) this.pop(lights, red);
  }

  private pop(lights: number, red: boolean) {
    const r = this.rows();
    let cy = -1;
    let color = 0xffffff;
    if (red) {
      cy = r.red;
      color = PAL.red;
    } else if (lights >= 4) {
      cy = r.green;
      color = PAL.green;
    } else if (lights >= 1) {
      cy = r.amber[lights - 1];
      color = PAL.orange;
    }
    if (cy < 0) return;
    for (const cx of [this.x + 18, this.x + 46]) {
      const c = this.scene.add.circle(cx, cy, 8, color, 0.7);
      this.layer.add(c);
      this.scene.tweens.add({ targets: c, scale: 2.4, alpha: 0, duration: 260, ease: 'Quad.easeOut', onComplete: () => c.destroy() });
    }
  }
}

export class Tach {
  private g: Phaser.GameObjects.Graphics;
  private x: number;
  private y: number;
  private w: number;
  private h: number;
  private n: number;
  private blink = 0;

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, x: number, y: number, w: number, h: number) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.n = Math.floor(w / 6);
    this.g = scene.add.graphics();
    layer.add(this.g);
    // rpm labels x1000
    for (let k = 1; k <= 7; k++) {
      const r = (k * 1000 - 900) / 6600;
      const lx = Math.round(x + (r / TACH_MAX) * w);
      layer.add(txt(scene, lx, y + h + 4, String(k), 8, k === 7 ? PAL.red : PAL.inkDim, [0.5, 0]));
    }
    layer.add(txt(scene, x + w, y + h + 4, 'x1000', 8, PAL.inkDim, [1, 0]));
  }

  xOf(r: number) {
    return Math.round(this.x + (Math.min(TACH_MAX, Math.max(0, r)) / TACH_MAX) * this.w);
  }

  update(rpm: number, win: ShiftWindow, limiter: boolean, showWindow: boolean, dtMs: number) {
    const g = this.g;
    const { x, y, w, h, n } = this;
    this.blink += dtMs;
    g.clear();
    g.fillStyle(PAL.bgDeep, 1).fillRect(x - 3, y - 3, w + 6, h + 6);
    g.fillStyle(0x15121f, 1).fillRect(x - 1, y - 1, w + 2, h + 2);
    const segW = w / n;
    for (let i = 0; i < n; i++) {
      const v = ((i + 0.5) / n) * TACH_MAX;
      let c: number = PAL.teal;
      const inPerfect = showWindow && v >= win.perfectLo && v <= win.perfectHi;
      const inGood = showWindow && v >= win.goodLo && v <= win.goodHi;
      if (v > 1.0) c = PAL.red;
      else if (inPerfect) c = PAL.green;
      else if (inGood) c = PAL.yellow;
      else c = v < 0.5 ? PAL.teal : v < 0.75 ? 0x58b8e0 : 0x9a8fe0;
      const lit = v <= rpm;
      const sx = Math.round(x + i * segW);
      const sw = Math.max(2, Math.round(segW) - 2);
      const segH = h - Math.round((1 - i / n) * 6); // segments grow taller toward redline
      g.fillStyle(lit ? c : shade(c, -0.72), 1).fillRect(sx, y + (h - segH), sw, segH);
      if (lit) g.fillStyle(0xffffff, 0.35).fillRect(sx, y + (h - segH), sw, 2);
    }
    // window band strip above
    if (showWindow) {
      g.fillStyle(PAL.yellow, 1).fillRect(this.xOf(win.goodLo), y - 8, this.xOf(Math.min(win.goodHi, 1.0)) - this.xOf(win.goodLo), 3);
      g.fillStyle(PAL.green, 1).fillRect(this.xOf(win.perfectLo), y - 9, Math.max(2, this.xOf(win.perfectHi) - this.xOf(win.perfectLo)), 5);
    }
    // needle
    const nx = this.xOf(rpm);
    g.fillStyle(PAL.bgDeep, 1).fillRect(nx - 2, y - 6, 5, h + 10);
    g.fillStyle(0xffffff, 1).fillRect(nx - 1, y - 5, 3, h + 8);
    g.fillStyle(0xffffff, 1).fillTriangle(nx - 4, y - 10, nx + 4, y - 10, nx, y - 5);
    // shift light
    const lx = x + w + 18;
    const ly = y + Math.round(h / 2);
    let lc: number = 0x2a2838;
    if (limiter) lc = Math.floor(this.blink / 60) % 2 ? PAL.red : 0x3a1010;
    else if (showWindow && rpm >= win.perfectLo && rpm <= win.perfectHi + 0.005) lc = PAL.green;
    else if (showWindow && rpm >= win.goodLo) lc = PAL.yellow;
    g.fillStyle(PAL.bgDeep, 1).fillCircle(lx, ly, 11);
    if (lc !== 0x2a2838) g.fillStyle(lc, 0.3).fillCircle(lx, ly, 14);
    g.fillStyle(lc, 1).fillCircle(lx, ly, 9);
    g.fillStyle(0xffffff, 0.5).fillRect(lx - 4, ly - 5, 3, 2);
  }
}
