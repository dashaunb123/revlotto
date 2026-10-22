// Race juice: smoke, sparks, speed lines, Balatro-style popups, stamps.
import Phaser from 'phaser';
import { FONT, PAL, hex } from './palette';
import { Pix } from './race/pix';

function puffTex(scene: Phaser.Scene): string {
  const key = 'fx_puff';
  if (scene.textures.exists(key)) return key;
  const p = new Pix(8, 8);
  p.disc(4, 4, 3.6, 0xffffff);
  p.toTexture(scene, key);
  return key;
}

function sqTex(scene: Phaser.Scene): string {
  const key = 'fx_sq';
  if (scene.textures.exists(key)) return key;
  const p = new Pix(2, 2);
  p.rect(0, 0, 2, 2, 0xffffff);
  p.toTexture(scene, key);
  return key;
}

/** Tyre smoke + exhaust smoke + sparks emitters living in the world layer. */
export class RaceFx {
  readonly smoke: Phaser.GameObjects.Particles.ParticleEmitter;
  readonly sparks: Phaser.GameObjects.Particles.ParticleEmitter;
  readonly exhaust: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer) {
    this.smoke = scene.add.particles(0, 0, puffTex(scene), {
      lifespan: { min: 600, max: 1100 },
      speedX: { min: -160, max: -30 },
      speedY: { min: -50, max: -8 },
      scale: { start: 1.2, end: 4.2 },
      alpha: { start: 0.75, end: 0 },
      tint: [0xe8e4f0, 0xc8c4d4, 0xa8a4b8],
      rotate: { min: 0, max: 360 },
      emitting: false,
    });
    this.exhaust = scene.add.particles(0, 0, puffTex(scene), {
      lifespan: { min: 300, max: 600 },
      speedX: { min: -60, max: -10 },
      speedY: { min: -20, max: -4 },
      scale: { start: 0.6, end: 1.8 },
      alpha: { start: 0.45, end: 0 },
      tint: [0x6a6678, 0x4a4658],
      emitting: false,
    });
    this.sparks = scene.add.particles(0, 0, sqTex(scene), {
      lifespan: { min: 200, max: 420 },
      speedX: { min: -260, max: -60 },
      speedY: { min: -120, max: 20 },
      gravityY: 400,
      scale: { start: 1, end: 0.5 },
      tint: [PAL.yellow, PAL.orange, 0xffffff],
      emitting: false,
    });
    layer.add([this.exhaust, this.smoke, this.sparks]);
  }

  tyreSmoke(x: number, y: number, n = 6) {
    this.smoke.explode(n, x, y);
  }
  exhaustPuff(x: number, y: number, n = 2) {
    this.exhaust.explode(n, x, y);
  }
  sparkBurst(x: number, y: number, n = 10) {
    this.sparks.explode(n, x, y);
  }
}

/** Horizontal streaks rushing past (HUD space). */
export class SpeedLines {
  private lines: { r: Phaser.GameObjects.Rectangle; v: number }[] = [];
  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, n = 22) {
    for (let i = 0; i < n; i++) {
      const r = scene.add.rectangle(0, 0, 30, 1, 0xffffff, 0.5).setOrigin(0, 0.5).setVisible(false);
      layer.add(r);
      this.lines.push({ r, v: 0 });
      this.respawn(this.lines[i], true);
    }
  }
  private respawn(l: { r: Phaser.GameObjects.Rectangle; v: number }, anywhere: boolean) {
    l.r.x = anywhere ? Math.random() * 640 : 640 + Math.random() * 80;
    l.r.y = Math.round(60 + Math.random() * 236);
    l.r.width = 20 + Math.round(Math.random() * 60);
    l.r.height = Math.random() > 0.7 ? 2 : 1;
    l.v = 900 + Math.random() * 900;
  }
  /** intensity 0..1, blue tint while nitrous. */
  update(dtMs: number, intensity: number, nitro: boolean) {
    for (const l of this.lines) {
      l.r.setVisible(intensity > 0.02);
      if (intensity <= 0.02) continue;
      l.r.x -= (l.v * (0.5 + intensity) * dtMs) / 1000;
      l.r.setFillStyle(nitro ? 0x9cd8ff : 0xffffff, 0.15 + intensity * 0.45);
      if (l.r.x + l.r.width < 0) this.respawn(l, false);
    }
  }
}

export function fxText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  s: string,
  size: 8 | 16 | 24 | 32,
  color: number,
  stroke = 4,
): Phaser.GameObjects.Text {
  return scene.add
    .text(Math.round(x), Math.round(y), s, {
      fontFamily: FONT,
      fontSize: `${size}px`,
      color: hex(color),
      stroke: hex(PAL.bgDeep),
      strokeThickness: stroke,
      align: 'center',
      resolution: 1,
    })
    .setOrigin(0.5, 0.5);
}

/** Pop in with overshoot, wobble, float up and fade. Balatro-style. */
export function popup(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Layer | null,
  x: number,
  y: number,
  s: string,
  color: number,
  size: 8 | 16 | 24 | 32 = 16,
  opts: { rise?: number; hold?: number; sub?: string } = {},
): Phaser.GameObjects.Container {
  const c = scene.add.container(Math.round(x), Math.round(y));
  const t = fxText(scene, 0, 0, s, size, color);
  c.add(t);
  if (opts.sub) c.add(fxText(scene, 0, size / 2 + 8, opts.sub, 8, PAL.ink, 3));
  layer?.add(c);
  c.setScale(0.2);
  c.setRotation((Math.random() - 0.5) * 0.4);
  const rise = opts.rise ?? 26;
  const hold = opts.hold ?? 520;
  scene.tweens.add({ targets: c, scale: 1.25, rotation: (Math.random() - 0.5) * 0.12, duration: 130, ease: 'Back.easeOut' });
  scene.tweens.add({ targets: c, scale: 1, duration: 120, delay: 130, ease: 'Quad.easeOut' });
  scene.tweens.add({ targets: c, y: c.y - rise, duration: hold + 380, ease: 'Sine.easeOut' });
  scene.tweens.add({
    targets: c,
    rotation: { from: -0.06, to: 0.06 },
    duration: 180,
    yoyo: true,
    repeat: 2,
    delay: 250,
    ease: 'Sine.easeInOut',
  });
  scene.tweens.add({ targets: c, alpha: 0, duration: 260, delay: hold + 120, onComplete: () => c.destroy() });
  return c;
}

/** Big rubber-stamp slam (WIN / LOSE etc). Stays until destroyed. */
export function stamp(
  scene: Phaser.Scene,
  layer: Phaser.GameObjects.Layer | null,
  x: number,
  y: number,
  s: string,
  color: number,
  size: 24 | 32 = 32,
  delay = 0,
): Phaser.GameObjects.Container {
  const c = scene.add.container(Math.round(x), Math.round(y));
  const t = fxText(scene, 0, 0, s, size, color, 6);
  const pad = 10;
  const bg = scene.add.rectangle(0, 0, Math.ceil(t.width) + pad * 2, Math.ceil(t.height) + pad, PAL.bgDeep, 0.85);
  bg.setStrokeStyle(4, color, 1);
  c.add([bg, t]);
  layer?.add(c);
  c.setScale(3).setAlpha(0).setRotation(-0.25);
  scene.tweens.add({
    targets: c,
    scale: 1,
    alpha: 1,
    rotation: -0.06,
    duration: 220,
    delay,
    ease: 'Back.easeOut',
  });
  return c;
}

export function flash(cam: Phaser.Cameras.Scene2D.Camera, color: number, ms = 120) {
  cam.flash(ms, (color >> 16) & 255, (color >> 8) & 255, color & 255, false);
}
