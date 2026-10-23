// Race HUD widgets: Christmas-tree starting lights and the segmented tach.
import Phaser from 'phaser';
import type { ShiftWindow } from '../../core/types';
import { PAL } from '../palette';
import { txt } from '../ui';
import { shade } from './pix';

const TACH_MAX = 1.06; // tach full scale in normalized rpm
/** Decoy Tree's fake green: close enough to fool a twitchy thumb, wrong enough to learn. */
export const DECOY_COLOR = 0xc8ff3a;

/** Boss overlays for the tach. */
export interface TachOpts {
  hidden?: boolean; // Blind Tach: no window bands, no shift light
  off?: boolean; // Blackout: the whole tach is dark
  /** Bands in normalized rpm to mark on the strip (e.g. where the rear hits oil this gear). */
  bands?: { lo: number; hi: number; color: number; label: string }[];
}

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

  /** staged: 0 none, 1 pre-stage, 2 staged. lights: 0-3 ambers, 4 green. decoy: Decoy Tree's fake flash. */
  set(lights: number, staged: number, red: boolean, decoy = false) {
    const key = `${lights}|${staged}|${red}|${decoy}`;
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
      if (decoy && lights < 4) bulb(r.green, 7, DECOY_COLOR, true);
      else bulb(r.green, 7, PAL.green, lights >= 4 && !(red && ci === 1));
      bulb(r.red, 6, PAL.red, red && ci === 1);
    });
    if (decoy && lights < 4) this.decoyPop();
    else if (prev && !prev.endsWith('true')) this.pop(lights, red);
  }

  /** The fake flash: a sickly lime pop and a "?" so a replay shows what you jumped at. */
  private decoyPop() {
    const r = this.rows();
    for (const cx of [this.x + 18, this.x + 46]) {
      const c = this.scene.add.circle(cx, r.green, 8, DECOY_COLOR, 0.6);
      this.layer.add(c);
      this.scene.tweens.add({ targets: c, scale: 1.8, alpha: 0, duration: 200, onComplete: () => c.destroy() });
    }
    const q = txt(this.scene, this.x + 76, r.green, '?', 16, DECOY_COLOR, [0, 0.5]);
    this.layer.add(q);
    this.scene.tweens.add({ targets: q, alpha: 0, x: q.x + 6, delay: 250, duration: 350, onComplete: () => q.destroy() });
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
  private mirror = false;
  private labels: { t: Phaser.GameObjects.Text; r: number }[] = [];
  private offText: Phaser.GameObjects.Text;
  private bandTexts: Phaser.GameObjects.Text[] = [];
  private scene: Phaser.Scene;
  private layer: Phaser.GameObjects.Layer;

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, x: number, y: number, w: number, h: number) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.n = Math.floor(w / 6);
    this.scene = scene;
    this.layer = layer;
    this.g = scene.add.graphics();
    layer.add(this.g);
    // rpm labels x1000
    for (let k = 1; k <= 7; k++) {
      const r = (k * 1000 - 900) / 6600;
      const t = txt(scene, this.xOf(r), y + h + 4, String(k), 8, k === 7 ? PAL.red : PAL.inkDim, [0.5, 0]);
      layer.add(t);
      this.labels.push({ t, r });
    }
    const unit = txt(scene, x + w, y + h + 4, 'x1000', 8, PAL.inkDim, [1, 0]);
    layer.add(unit);
    this.labels.push({ t: unit, r: -1 });
    this.offText = txt(scene, x + w / 2, y + h / 2, 'NO SIGNAL', 8, PAL.red, [0.5, 0.5]).setVisible(false);
    layer.add(this.offText);
  }

  /** Mirror Tach: draw the scale right-to-left (redline on the left). */
  setMirror(m: boolean) {
    this.mirror = m;
    for (const l of this.labels) {
      if (l.r < 0) l.t.setX(m ? this.x : this.x + this.w).setOrigin(m ? 0 : 1, 0);
      else l.t.setX(this.xOf(l.r));
    }
  }

  xOf(r: number) {
    const u = Math.min(TACH_MAX, Math.max(0, r)) / TACH_MAX;
    return Math.round(this.x + (this.mirror ? 1 - u : u) * this.w);
  }

  /** Left edge + width in px of the rpm span [lo, hi] (mirror-safe). */
  private span(lo: number, hi: number): [number, number] {
    const a = this.xOf(lo),
      b = this.xOf(hi);
    return [Math.min(a, b), Math.abs(b - a)];
  }

  update(rpm: number, win: ShiftWindow, limiter: boolean, showWindow: boolean, dtMs: number, opts: TachOpts = {}) {
    const g = this.g;
    const { x, y, w, h, n } = this;
    this.blink += dtMs;
    g.clear();
    g.fillStyle(PAL.bgDeep, 1).fillRect(x - 3, y - 3, w + 6, h + 6);
    g.fillStyle(0x15121f, 1).fillRect(x - 1, y - 1, w + 2, h + 2);
    this.offText.setVisible(!!opts.off);
    for (const l of this.labels) l.t.setAlpha(opts.off ? 0.25 : 1);
    if (opts.off) {
      // dead screen: static scanlines, no needle, no light
      for (let yy = y; yy < y + h; yy += 2) {
        const a = 0.05 + Math.random() * 0.12;
        g.fillStyle(0xffffff, a).fillRect(x + Math.floor(Math.random() * 30), yy, w - 30, 1);
      }
      this.offText.setAlpha(Math.floor(this.blink / 250) % 2 ? 1 : 0.5);
      for (const t of this.bandTexts) t.setVisible(false);
      const lx = x + w + 18;
      const ly = y + Math.round(h / 2);
      g.fillStyle(PAL.bgDeep, 1).fillCircle(lx, ly, 11);
      g.fillStyle(0x2a2838, 1).fillCircle(lx, ly, 9);
      return;
    }
    if (opts.hidden) showWindow = false;
    const segW = w / n;
    for (let i = 0; i < n; i++) {
      const v = (((this.mirror ? n - 1 - i : i) + 0.5) / n) * TACH_MAX;
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
      const segH = h - Math.round((1 - v / TACH_MAX) * 6); // segments grow taller toward redline
      g.fillStyle(lit ? c : shade(c, -0.72), 1).fillRect(sx, y + (h - segH), sw, segH);
      if (lit) g.fillStyle(0xffffff, 0.35).fillRect(sx, y + (h - segH), sw, 2);
    }
    // hazard bands (oil this gear): hatched over the segments, labelled above
    const bands = opts.bands ?? [];
    bands.forEach((b, k) => {
      const [bx, bw] = this.span(b.lo, b.hi);
      if (bw < 1) return;
      g.fillStyle(0x000000, 0.55).fillRect(bx, y, bw, h);
      for (let hx = bx; hx < bx + bw; hx += 4) g.fillStyle(b.color, 0.8).fillRect(hx, y + h - 3, 2, 3);
      g.lineStyle(1, b.color, 1).strokeRect(bx, y - 1, bw, h + 2);
      let t = this.bandTexts[k];
      if (!t) {
        t = txt(this.scene, 0, 0, '', 8, b.color, [0.5, 1]);
        this.layer.add(t);
        this.bandTexts[k] = t;
      }
      // one label is enough: neighbouring bands would print on top of each other
      t.setText(b.label).setColor(Phaser.Display.Color.IntegerToColor(b.color).rgba).setPosition(bx + bw / 2, y - 11).setVisible(k === 0);
    });
    for (let k = bands.length; k < this.bandTexts.length; k++) this.bandTexts[k].setVisible(false);
    // window band strip above
    if (showWindow) {
      const [gx, gw] = this.span(win.goodLo, Math.min(win.goodHi, 1.0));
      g.fillStyle(PAL.yellow, 1).fillRect(gx, y - 8, gw, 3);
      const [px, pw] = this.span(win.perfectLo, win.perfectHi);
      g.fillStyle(PAL.green, 1).fillRect(px, y - 9, Math.max(2, pw), 5);
    } else if (opts.hidden) {
      // Blind Tach: a row of question marks where the bands would be
      for (let qx = x + 8; qx < x + w; qx += 24) g.fillStyle(0x3a3550, 1).fillRect(qx, y - 8, 10, 3);
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
    else if (showWindow && rpm >= win.goodLo && rpm <= win.goodHi + 0.01) lc = PAL.yellow;
    g.fillStyle(PAL.bgDeep, 1).fillCircle(lx, ly, 11);
    if (lc !== 0x2a2838) g.fillStyle(lc, 0.3).fillCircle(lx, ly, 14);
    g.fillStyle(lc, 1).fillCircle(lx, ly, 9);
    g.fillStyle(0xffffff, 0.5).fillRect(lx - 4, ly - 5, 3, 2);
  }
}

/** Win confetti: a shower from the top plus two cannon bursts. Bounded, HUD space. */
export class Confetti {
  private rain: Phaser.GameObjects.Particles.ParticleEmitter;
  private cannon: Phaser.GameObjects.Particles.ParticleEmitter;
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer) {
    this.scene = scene;
    const key = 'hud_confetti';
    if (!scene.textures.exists(key)) {
      const g = scene.make.graphics({}, false);
      g.fillStyle(0xffffff, 1).fillRect(0, 0, 4, 2);
      g.generateTexture(key, 4, 2);
      g.destroy();
    }
    const common = {
      rotate: { min: 0, max: 360 },
      // flutter: flip edge-on and back as it tumbles
      scaleY: { onEmit: () => 1, onUpdate: (_p: unknown, _k: string, t: number) => 0.3 + Math.abs(Math.cos(t * 26)) * 0.9 },
      tint: [PAL.red, PAL.yellow, PAL.teal, PAL.pink, PAL.green, PAL.blue, 0xffffff],
      emitting: false,
    };
    this.rain = scene.add.particles(0, 0, key, {
      ...common,
      x: { min: 0, max: 640 },
      y: -6,
      lifespan: { min: 2400, max: 3400 },
      speedX: { min: -30, max: 30 },
      speedY: { min: 30, max: 80 },
      gravityY: 30,
      maxAliveParticles: 160,
    });
    this.cannon = scene.add.particles(0, 0, key, {
      ...common,
      lifespan: { min: 1100, max: 1600 },
      speed: { min: 200, max: 340 },
      gravityY: 380,
      alpha: { start: 1, end: 0.4 },
      maxAliveParticles: 90,
    });
    layer.add([this.rain, this.cannon]);
  }

  burst(ms = 1600) {
    // cannons from the lower corners, angled in
    this.cannon.setEmitterAngle({ min: -80, max: -45 } as never);
    this.cannon.explode(40, 16, 296);
    this.cannon.setEmitterAngle({ min: -135, max: -100 } as never);
    this.cannon.explode(40, 624, 296);
    this.rain.setFrequency(30, 3);
    this.rain.start();
    this.scene.time.delayedCall(ms, () => this.rain.stop());
  }
}
