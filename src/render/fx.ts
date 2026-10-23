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

/** Big chunky smoke ball: lit top-left, shaded underside so tinted clouds read as volume. */
function cloudTex(scene: Phaser.Scene): string {
  const key = 'fx_cloud';
  if (scene.textures.exists(key)) return key;
  const p = new Pix(16, 16);
  p.disc(8, 8, 7.4, 0xb8b4c4);
  p.disc(7, 7, 6.2, 0xdcd8e4);
  p.disc(6, 5.5, 3.6, 0xffffff);
  // ragged rim
  for (const [x, y] of [[1, 6], [14, 9], [6, 14], [10, 1], [2, 11]]) p.clear(x, y);
  p.toTexture(scene, key);
  return key;
}

/** Soft dithered glow (tyre heat, nitrous underglow). */
function glowTex(scene: Phaser.Scene): string {
  const key = 'fx_glow';
  if (scene.textures.exists(key)) return key;
  const p = new Pix(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8) / 8;
      if (d < 0.55) p.set(x, y, 0xffffff);
      else if (d < 0.8) p.set(x, y, 0xffffff, (x + y) % 2 ? 150 : 90);
      else if (d < 1 && (x + y) % 2 === 0) p.set(x, y, 0xffffff, 60);
    }
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

type Emitter = Phaser.GameObjects.Particles.ParticleEmitter;

/**
 * World-space race particles. `back` goes behind the player car (above the ghost), `front` in
 * front of it, so clouds wrap around the car. `strength` (~0.7..2.2) scales tyre smoke to the build.
 */
export class RaceFx {
  readonly back: Phaser.GameObjects.GameObject[];
  readonly front: Phaser.GameObjects.GameObject[];
  private smoke: Emitter;
  private smokeFront: Emitter;
  private exhaust: Emitter;
  private sparks: Emitter;
  private vapour: Emitter;
  private shimmer: Emitter;
  private dust: Emitter;
  private oil: Emitter;
  readonly glow: Phaser.GameObjects.Image;
  readonly underglow: Phaser.GameObjects.Image;
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene, strength = 1) {
    this.scene = scene;
    const k = strength;
    const cloud = cloudTex(scene);
    this.smoke = scene.add.particles(0, 0, cloud, {
      lifespan: { min: 1100 * k, max: 2000 * k },
      speedX: { min: -80, max: 20 },
      speedY: { min: -30, max: -4 },
      gravityY: -4,
      scale: { start: 0.5 * k, end: 2.3 * k, ease: 'Quad.easeOut' },
      alpha: { start: 0.5, end: 0, ease: 'Sine.easeIn' },
      tint: [0xf0ecf6, 0xd8d4e2, 0xbcb8cc],
      rotate: { min: 0, max: 360 },
      emitting: false,
      maxAliveParticles: 110,
    });
    this.smokeFront = scene.add.particles(0, 0, cloud, {
      lifespan: { min: 900 * k, max: 1700 * k },
      speedX: { min: -60, max: 40 },
      speedY: { min: -14, max: -2 },
      scale: { start: 0.5 * k, end: 2.0 * k, ease: 'Quad.easeOut' },
      alpha: { start: 0.32, end: 0, ease: 'Sine.easeIn' },
      tint: [0xf0ecf6, 0xd0ccdc],
      rotate: { min: 0, max: 360 },
      emitting: false,
      maxAliveParticles: 40,
    });
    this.exhaust = scene.add.particles(0, 0, puffTex(scene), {
      lifespan: { min: 300, max: 600 },
      speedX: { min: -60, max: -10 },
      speedY: { min: -20, max: -4 },
      scale: { start: 0.6, end: 1.8 },
      alpha: { start: 0.45, end: 0 },
      tint: [0x6a6678, 0x4a4658],
      emitting: false,
      maxAliveParticles: 40,
    });
    this.sparks = scene.add.particles(0, 0, sqTex(scene), {
      lifespan: { min: 200, max: 420 },
      speedX: { min: -260, max: -60 },
      speedY: { min: -120, max: 20 },
      gravityY: 400,
      scale: { start: 1, end: 0.5 },
      tint: [PAL.yellow, PAL.orange, 0xffffff],
      emitting: false,
      maxAliveParticles: 80,
    });
    // Nitrous purge jets + turbo flutter: fast white vapour that dies quickly.
    this.vapour = scene.add.particles(0, 0, cloud, {
      lifespan: { min: 380, max: 700 },
      speed: { min: 90, max: 230 },
      angle: { min: -100, max: -70 },
      scale: { start: 0.25, end: 1.5, ease: 'Quad.easeOut' },
      alpha: { start: 0.95, end: 0, ease: 'Quad.easeIn' },
      tint: [0xffffff, 0xe8f4ff],
      rotate: { min: 0, max: 360 },
      emitting: false,
      maxAliveParticles: 70,
    });
    // Heat haze: faint warm blobs that waver as they rise.
    this.shimmer = scene.add.particles(0, 0, puffTex(scene), {
      lifespan: { min: 280, max: 460 },
      speedX: { min: -50, max: -20 },
      speedY: { min: -18, max: -6 },
      scale: { start: 0.6, end: 1.6 },
      alpha: { start: 0.14, end: 0 },
      x: { onUpdate: (_p: unknown, _k: string, t: number, v: number) => v + Math.sin(t * 40) * 0.35 },
      tint: 0xffe8c8,
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
      maxAliveParticles: 24,
    });
    this.dust = scene.add.particles(0, 0, puffTex(scene), {
      lifespan: { min: 500, max: 900 },
      speedX: { min: -30, max: 40 },
      speedY: { min: -22, max: -4 },
      scale: { start: 0.5, end: 2.2 },
      alpha: { start: 0.32, end: 0 },
      tint: [0x8a7a68, 0x6a5e52, 0xa89880],
      emitting: false,
      maxAliveParticles: 40,
    });
    // Oil Slick: black droplets flung back off a spinning tyre, with a few sheen flecks
    this.oil = scene.add.particles(0, 0, sqTex(scene), {
      lifespan: { min: 300, max: 600 },
      speedX: { min: -220, max: -40 },
      speedY: { min: -150, max: -40 },
      gravityY: 520,
      scale: { start: 1.5, end: 0.8 },
      tint: [0x050409, 0x050409, 0x16141f, 0x5cf2ff, 0xb46cff],
      emitting: false,
      maxAliveParticles: 90,
    });
    this.underglow = scene.add.image(0, 0, glowTex(scene)).setTint(0x4fa8ff).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.glow = scene.add.image(0, 0, glowTex(scene)).setTint(PAL.orange).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0);
    this.back = [this.underglow, this.dust, this.exhaust, this.shimmer, this.smoke, this.oil];
    this.front = [this.glow, this.smokeFront, this.vapour, this.sparks];
  }

  /** Tyre smoke at a contact patch; ~1 in 3 puffs also drifts in front of the car. */
  tyreSmoke(x: number, y: number, n = 6) {
    this.smoke.explode(n, x, y);
    const f = Math.floor(n / 3) + (Math.random() < (n % 3) / 3 ? 1 : 0);
    if (f > 0) this.smokeFront.explode(f, x + 10, y + 3);
  }
  exhaustPuff(x: number, y: number, n = 2) {
    this.exhaust.explode(n, x, y);
  }
  sparkBurst(x: number, y: number, n = 10) {
    this.sparks.explode(n, x, y);
  }
  /** Heat haze riding with the car: (carX, carY) moves the emitter, (lx, ly) is the local exhaust tip. */
  heat(carX: number, carY: number, lx: number, ly: number) {
    this.shimmer.setPosition(carX, carY);
    this.shimmer.explode(1, lx, ly);
  }
  /** Keep the haze attached between puffs. */
  heatFollow(carX: number, carY: number) {
    this.shimmer.setPosition(carX, carY);
  }
  /** Oil flung off the rear tyre. */
  oilSplash(x: number, y: number, n = 3) {
    this.oil.explode(n, x, y);
  }
  dustKick(x: number, y: number, n = 1) {
    this.dust.explode(n, x, y);
  }
  /** Turbo flutter / blow-off: a few small quick puffs. */
  flutter(x: number, y: number) {
    this.vapour.explode(4, x, y);
  }
  /** Nitrous purge: a white vapour column jetting up for ~0.35 s. Follows getPos while it fires. */
  purge(getPos: () => { x: number; y: number }) {
    let n = 0;
    this.scene.time.addEvent({
      delay: 30,
      repeat: 11,
      callback: () => {
        const p = getPos();
        this.vapour.explode(n++ < 4 ? 3 : 2, p.x, p.y);
      },
    });
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

/**
 * Gale Force (HUD space): a gust front rolls in from the right; behind it, wind streaks and grit
 * stream right-to-left across the strip. front = screen x of the incoming front (null = none coming),
 * strength 0..1 = gust on the car now (streaks everywhere).
 */
export class GustFx {
  private lines: { r: Phaser.GameObjects.Rectangle; v: number }[] = [];
  private wall: Phaser.GameObjects.Graphics;
  private t = 0;
  constructor(scene: Phaser.Scene, layer: Phaser.GameObjects.Layer, n = 70) {
    this.wall = scene.add.graphics();
    layer.add(this.wall);
    for (let i = 0; i < n; i++) {
      const grit = i % 5 === 0;
      const r = scene.add.rectangle(0, 0, grit ? 2 : 30, grit ? 2 : i % 3 ? 1 : 2, grit ? 0xc8b89a : 0xe4f2ff, 0.8).setOrigin(0, 0.5).setVisible(false);
      layer.add(r);
      const l = { r, v: 0 };
      this.lines.push(l);
      this.respawn(l, Math.random() * 700);
    }
  }
  private respawn(l: { r: Phaser.GameObjects.Rectangle; v: number }, x: number) {
    l.r.x = x;
    l.r.y = Math.round(150 + Math.random() * 145);
    if (l.r.width > 2) l.r.setSize(24 + Math.round(Math.random() * 60), l.r.height);
    l.v = 520 + Math.random() * 520;
  }
  update(dtMs: number, front: number | null, strength: number) {
    this.t += dtMs;
    const edge = strength > 0.05 ? -100 : front ?? 99999;
    const amt = strength > 0.05 ? strength : front !== null ? 0.8 : 0;
    for (const l of this.lines) {
      l.r.x -= (l.v * dtMs) / 1000;
      if (l.r.x + l.r.width < 0) this.respawn(l, 640 + Math.random() * 120);
      const vis = amt > 0 && l.r.x > edge;
      l.r.setVisible(vis);
      if (vis) l.r.setAlpha(0.3 + 0.6 * amt);
    }
    // the front itself: a ragged wall of haze
    const g = this.wall;
    g.clear();
    if (strength > 0.05) g.fillStyle(0x9cd8ff, 0.08 * strength).fillRect(0, 150, 640, 146);
    if (front !== null && strength <= 0.05 && front < 660) {
      for (let y = 150; y < 296; y += 4) {
        const jx = Math.round(front + Math.sin(y * 0.3 + this.t / 60) * 6);
        g.fillStyle(0xd8ecff, 0.22).fillRect(jx, y, 10 + ((y * 7) % 13), 3);
        g.fillStyle(0xffffff, 0.35).fillRect(jx, y, 2, 3);
      }
    }
  }
}
