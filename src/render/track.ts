// Side-view drag strip with parallax. World x is in pixels: meters * PPM, start line at x = 0.
// Everything lives in `track.layer` so the race scene can keep a separate HUD camera.
import Phaser from 'phaser';
import { FONT, PAL, hex } from './palette';
import { Pix, mix, shade, texRng } from './race/pix';

export const PPM = 16; // pixels per meter
export const HORIZON_Y = 160;
export const WALL_Y = 192;
export const FAR_TOP = 208;
export const DIVIDER_Y = 244;
export const NEAR_BOTTOM = 290;
export const LANE_FAR_Y = 238; // ghost ground line
export const LANE_NEAR_Y = 283; // player ground line
export const GROUND_BOTTOM = 300; // HUD starts below this

const FT = 0.3048;

interface Parallax {
  sprite: Phaser.GameObjects.TileSprite;
  factor: number;
}

export class Track {
  readonly layer: Phaser.GameObjects.Layer;
  readonly lengthM: number;
  private scene: Phaser.Scene;
  private par: Parallax[] = [];
  private crowd!: Phaser.GameObjects.TileSprite;
  private cheerT = 0;
  private propLights!: Phaser.GameObjects.Graphics;
  private bob = 0;
  private flashG!: Phaser.GameObjects.Graphics;
  private flashT = 0;
  private bulbs: { x: number; y: number; life: number }[] = [];
  private rubberG!: Phaser.GameObjects.Graphics;
  private rubberN = 0;
  private oilG?: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, lengthM: number) {
    this.scene = scene;
    this.lengthM = lengthM;
    this.layer = scene.add.layer();
    this.buildSky();
    this.addPar(this.cityTex(), 0, HORIZON_Y - 64, 640, 64, 0.04);
    this.crowd = this.addPar(this.standsTex(), 0, 112, 640, 82, 0.35);
    this.flashG = this.add(scene.add.graphics().setScrollFactor(0));
    this.addPar(this.polesTex(), 0, 40, 640, 152, 0.7);
    this.addPar(this.wallTex(), 0, WALL_Y, 640, 16, 1);
    this.addPar(this.asphaltTex(), 0, FAR_TOP, 640, NEAR_BOTTOM - FAR_TOP, 1);
    this.addPar(this.foreTex(), 0, NEAR_BOTTOM, 640, GROUND_BOTTOM - NEAR_BOTTOM, 1.25);
    this.buildWorldProps();
    // Skid marks: world-space, drawn over the strip and under the cars (world layer comes later).
    this.rubberG = this.add(scene.add.graphics());
  }

  private add<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.layer.add(o);
    return o;
  }

  private addPar(key: string, x: number, y: number, w: number, h: number, factor: number) {
    const s = this.scene.add.tileSprite(x, y, w, h, key).setOrigin(0, 0).setScrollFactor(0);
    this.add(s);
    this.par.push({ sprite: s, factor });
    return s;
  }

  /** Call every frame with the main camera's scrollX. */
  update(camX: number, dtMs: number) {
    for (const p of this.par) p.sprite.tilePositionX = Math.round(camX * p.factor);
    this.bob += dtMs;
    if (this.cheerT > 0) {
      this.cheerT -= dtMs;
      this.crowd.tilePositionY = Math.floor(this.bob / 90) % 2 ? 1 : 0;
    } else {
      this.crowd.tilePositionY = Math.floor(this.bob / 600) % 2 && Math.floor(this.bob / 300) % 3 === 0 ? 1 : 0;
    }
    this.updateBulbs(dtMs);
  }

  private updateBulbs(dtMs: number) {
    if (this.flashT <= 0 && !this.bulbs.length) return;
    this.flashT -= dtMs;
    const tile = this.crowd.tilePositionX;
    // a few pops per frame, only where the stands are (texture u 0..208 of 256), on the fan rows
    for (let n = 0; this.flashT > 0 && n < 2 && this.bulbs.length < 14; n++) {
      if (Math.random() > 0.35) continue;
      const x = Math.floor(Math.random() * 640);
      if (((((x + tile) % 256) + 256) % 256) > 204) continue;
      this.bulbs.push({ x, y: 128 + Math.floor(Math.random() * 56), life: 60 + Math.random() * 70 });
    }
    const g = this.flashG;
    g.clear();
    this.bulbs = this.bulbs.filter((b) => (b.life -= dtMs) > 0);
    for (const b of this.bulbs) {
      const big = b.life > 50;
      g.fillStyle(0xffffff, 0.22).fillRect(b.x - 3, b.y - 3, 7, 7);
      g.fillStyle(0xffffff, 1).fillRect(b.x, b.y, 2, 2);
      if (big) {
        g.fillStyle(0xfff6c8, 0.8).fillRect(b.x - 3, b.y, 2, 2).fillRect(b.x + 3, b.y, 2, 2);
        g.fillStyle(0xfff6c8, 0.8).fillRect(b.x, b.y - 3, 2, 2).fillRect(b.x, b.y + 3, 2, 2);
      }
    }
  }

  /** Camera flashbulbs popping in the stands for a while (with cheer() on a win). */
  flashbulbs(ms = 2500) {
    this.flashT = ms;
  }

  /**
   * Lay rubber on the strip from world x0 to x1 at ground line y. a = darkness 0..1.
   * Bounded: Graphics keeps every command, so we stop adding after a few hundred strokes.
   */
  rubber(x0: number, x1: number, y: number, a: number) {
    if (this.rubberN > 900 || a <= 0.02) return;
    this.rubberN++;
    const l = Math.round(Math.min(x0, x1));
    const w = Math.max(2, Math.round(Math.abs(x1 - x0)) + 1);
    const g = this.rubberG;
    g.fillStyle(0x0c0a10, Math.min(0.85, a)).fillRect(l, y - 3, w, 2);
    g.fillStyle(0x0c0a10, Math.min(0.85, a) * 0.5).fillRect(l, y - 1, w, 1);
  }

  /**
   * Boss Oil Slick: a glossy black puddle on the player's lane from world px x0 to x1, with a rainbow
   * sheen and a hazard plate on the kerb below it. Drawn once; lives under the cars.
   */
  oilPatch(x0: number, x1: number, seed = 1) {
    const sc = this.scene;
    if (!this.oilG) this.oilG = this.add(sc.add.graphics());
    const g = this.oilG;
    const rnd = texRng(seed * 7919 + 17);
    const top = LANE_NEAR_Y - 14;
    const bot = LANE_NEAR_Y + 5;
    const cx = (x0 + x1) / 2;
    const half = (x1 - x0) / 2;
    for (let y = top; y <= bot; y++) {
      const u = (y - (top + bot) / 2) / ((bot - top) / 2); // -1..1
      const w = half * Math.sqrt(Math.max(0, 1 - u * u * 0.85)) + (rnd() - 0.5) * 10;
      const l = Math.round(cx - w + (rnd() - 0.5) * 6);
      const r = Math.round(cx + w + (rnd() - 0.5) * 6);
      g.fillStyle(0x16141f, 0.95).fillRect(l - 2, y, r - l + 4, 1);
      g.fillStyle(0x050409, 0.97).fillRect(l, y, r - l, 1);
    }
    // sheen: thin rainbow streaks + a white glint
    const sheen = [0x5cf2ff, 0xb46cff, 0xf25c9a, 0xf7d23e];
    for (let i = 0; i < 6; i++) {
      const y = Math.round(top + 3 + rnd() * (bot - top - 6));
      const l = Math.round(cx - half * 0.6 + rnd() * half * 0.8);
      const w = Math.round(8 + rnd() * half * 0.5);
      g.fillStyle(sheen[i % sheen.length], 0.55).fillRect(l, y, w, 1);
    }
    g.fillStyle(0xffffff, 0.8).fillRect(Math.round(cx - half * 0.3), top + 4, 6, 1);
    // hazard plate on the kerb under the patch
    const pw = 36;
    const px = Math.round(cx - pw / 2);
    g.fillStyle(PAL.bgDeep, 1).fillRect(px - 1, NEAR_BOTTOM, pw + 2, 10);
    for (let k = 0; k < pw; k += 6) g.fillStyle(k % 12 ? 0x111111 : PAL.yellow, 1).fillRect(px + k, NEAR_BOTTOM + 1, 6, 8);
    const t = sc.add
      .text(Math.round(cx), NEAR_BOTTOM + 5, 'OIL', { fontFamily: FONT, fontSize: '8px', color: hex(PAL.yellow), stroke: hex(PAL.bgDeep), strokeThickness: 3, resolution: 1 })
      .setOrigin(0.5, 0.5);
    this.add(t);
  }

  /** Crowd bounces for a while. */
  cheer(ms = 2500) {
    this.cheerT = ms;
  }

  /** Mirror the light tree on the little prop at the start line. lights: 0-3 ambers, 4 green. */
  setTreeLights(lights: number, red: boolean) {
    const g = this.propLights;
    g.clear();
    const x = 30;
    for (let i = 0; i < 3; i++) {
      const on = lights > i && lights < 4;
      g.fillStyle(on ? PAL.orange : 0x3a2a1a, 1).fillRect(x - 3, 206 + i * 7, 6, 5);
    }
    g.fillStyle(lights >= 4 && !red ? PAL.green : 0x1a3a1a, 1).fillRect(x - 3, 227, 6, 5);
    if (red) g.fillStyle(PAL.red, 1).fillRect(x - 3, 234, 6, 5);
  }

  // ------------------------------------------------------------------ textures

  private buildSky() {
    const key = 'trk_sky';
    if (!this.scene.textures.exists(key)) {
      const p = new Pix(640, HORIZON_Y + 4);
      const bands = [0x120d2a, 0x1a1238, 0x231646, 0x2f1a52, 0x41205c, 0x592664, 0x772d69, 0x98366b, 0xbc456a, 0xdc5f60, 0xf08452];
      const hs = [26, 22, 18, 16, 14, 12, 11, 10, 10, 10, 15];
      let y = 0;
      bands.forEach((c, i) => {
        p.rect(0, y, 640, hs[i], c);
        // dithered seam into the next band
        if (i < bands.length - 1) for (let x = 0; x < 640; x += 2) p.set(x + ((y + hs[i]) % 2), y + hs[i] - 1, bands[i + 1]);
        y += hs[i];
      });
      p.rect(0, y, 640, HORIZON_Y + 4 - y, bands[bands.length - 1]);
      const r = texRng(5);
      for (let i = 0; i < 70; i++) {
        const sx = Math.floor(r() * 640),
          sy = Math.floor(r() * 70);
        p.set(sx, sy, r() > 0.8 ? 0xffffff : 0x9a8fb8);
      }
      // Big retro sun with slats.
      const cx = 470,
        cy = 132,
        R = 36;
      for (let yy = cy - R; yy <= cy + R; yy++) {
        const t = (yy - (cy - R)) / (2 * R);
        if (t > 0.45 && (yy - cy) % 6 < (t > 0.7 ? 3 : 2)) continue; // slats
        for (let xx = cx - R; xx <= cx + R; xx++) {
          const dx = xx + 0.5 - cx,
            dy = yy + 0.5 - cy;
          if (dx * dx + dy * dy <= R * R) p.set(xx, yy, mix(0xfff0a0, 0xf25c9a, t));
        }
      }
      p.toTexture(this.scene, key);
    }
    this.add(this.scene.add.image(0, 0, key).setOrigin(0, 0).setScrollFactor(0));
  }

  private cityTex(): string {
    const key = 'trk_city';
    if (this.scene.textures.exists(key)) return key;
    const W = 512,
      H = 64;
    const p = new Pix(W, H);
    const r = texRng(11);
    const back = 0x3a1f55,
      front = 0x24143a;
    for (const [col, minH, maxH, seed] of [
      [back, 20, 48, 0],
      [front, 10, 36, 1],
    ] as const) {
      let x = seed ? 5 : 0;
      while (x < W) {
        const bw = 10 + Math.floor(r() * 22);
        const bh = minH + Math.floor(r() * (maxH - minH));
        const bwc = Math.min(bw, W - x);
        p.rect(x, H - bh, bwc, bh, col);
        if (r() > 0.6) p.rect(x + Math.floor(bwc / 2), H - bh - 6, 1, 6, col); // antenna
        if (seed) {
          for (let wy = H - bh + 3; wy < H - 3; wy += 4)
            for (let wx = x + 2; wx < x + bwc - 2; wx += 3) if (r() > 0.78) p.set(wx, wy, r() > 0.5 ? 0xf7d23e : 0xf28c28);
        }
        x += bw + (seed ? Math.floor(r() * 6) : 0);
      }
    }
    p.toTexture(this.scene, key);
    return key;
  }

  private standsTex(): string {
    const key = 'trk_stands';
    if (this.scene.textures.exists(key)) return key;
    const W = 256,
      H = 82;
    const p = new Pix(W, H);
    const r = texRng(23);
    const shirt = [PAL.red, PAL.yellow, PAL.teal, PAL.pink, PAL.ink, PAL.blue, PAL.orange, PAL.green, 0x6a5aa0];
    const skin = [0xf0c8a0, 0xc8905a, 0x8a5a3a, 0xe8b088];
    // Stands occupy x 0..200; a gap with a floodlit banner after.
    const SW = 208;
    p.rect(0, 10, SW, H - 10, 0x1e1a30);
    // roof
    p.rect(0, 4, SW, 5, 0x4a3f78);
    p.hline(0, SW - 1, 4, 0x6a5fa0);
    for (let x = 6; x < SW; x += 40) p.rect(x, 9, 2, H - 9, 0x2b2547);
    // rows of fans
    for (let row = 0; row < 8; row++) {
      const y = 14 + row * 8;
      p.hline(0, SW - 1, y + 6, 0x2b2547);
      p.hline(0, SW - 1, y + 7, 0x15121f);
      for (let x = 1; x < SW - 2; x += 3) {
        if (r() < 0.12) continue;
        const sx = x + (r() > 0.5 ? 1 : 0);
        p.rect(sx, y + 3, 2, 3, shirt[Math.floor(r() * shirt.length)]);
        p.rect(sx, y + 1, 2, 2, skin[Math.floor(r() * skin.length)]);
        if (r() > 0.93) p.rect(sx - 1, y - 1, 1, 2, PAL.yellow); // waving arm
      }
    }
    // Banner on the gap
    p.rect(SW + 6, 30, 40, 14, PAL.red);
    p.rect(SW + 6, 30, 40, 2, shade(PAL.red, 0.4));
    for (let i = 0; i < 40; i += 4) p.rect(SW + 6 + i, 40, 2, 2, PAL.yellow);
    p.vline(SW + 8, 44, H - 1, 0x4a3f78);
    p.vline(SW + 43, 44, H - 1, 0x4a3f78);
    p.toTexture(this.scene, key);
    return key;
  }

  private polesTex(): string {
    const key = 'trk_poles';
    if (this.scene.textures.exists(key)) return key;
    const W = 320,
      H = 152;
    const p = new Pix(W, H);
    const x = 150;
    p.rect(x, 10, 3, H - 10, 0x3a3550);
    p.vline(x, 10, H - 1, 0x5a5478);
    p.rect(x - 10, 6, 23, 3, 0x3a3550);
    for (let i = 0; i < 4; i++) {
      p.rect(x - 9 + i * 6, 2, 4, 4, 0xfff6c8);
      p.rect(x - 9 + i * 6, 6, 4, 1, 0xf7d23e);
    }
    // glow
    for (let yy = 0; yy < 14; yy++)
      for (let xx = -16; xx < 20; xx++) if (!p.filled(x + xx, yy) && (xx + yy) % 2 === 0 && Math.abs(xx - 2) + yy < 18) p.set(x + xx, yy, 0xfff6c8, 60);
    p.toTexture(this.scene, key);
    return key;
  }

  private wallTex(): string {
    const key = 'trk_wall';
    if (this.scene.textures.exists(key)) return key;
    const W = 192,
      H = 16;
    const p = new Pix(W, H);
    p.rect(0, 0, W, H, 0x8a8698);
    p.hline(0, W - 1, 0, 0xc8c4d4);
    p.hline(0, W - 1, H - 1, 0x4a4658);
    p.hline(0, W - 1, H - 2, 0x6a6678);
    // ad panels
    const ads = [PAL.red, PAL.teal, PAL.yellow];
    ads.forEach((c, i) => {
      const ax = 8 + i * 64;
      p.rect(ax, 3, 44, 9, c);
      p.hline(ax, ax + 43, 3, shade(c, 0.4));
      for (let k = 0; k < 5; k++) p.rect(ax + 4 + k * 8, 6, 5, 3, shade(c, -0.55));
    });
    for (let x = 0; x < W; x += 32) p.vline(x, 1, H - 2, 0x6a6678);
    p.toTexture(this.scene, key);
    return key;
  }

  private asphaltTex(): string {
    const key = 'trk_asphalt';
    if (this.scene.textures.exists(key)) return key;
    const W = 128,
      H = NEAR_BOTTOM - FAR_TOP;
    const p = new Pix(W, H);
    const r = texRng(41);
    p.rect(0, 0, W, H, PAL.asphalt);
    for (let i = 0; i < 260; i++) p.set(Math.floor(r() * W), Math.floor(r() * H), r() > 0.5 ? PAL.asphaltLight : 0x221f2a);
    // lane edges
    p.hline(0, W - 1, 1, PAL.stripe);
    p.hline(0, W - 1, 2, 0xb8b0a0);
    const dv = DIVIDER_Y - FAR_TOP;
    p.rect(0, dv, 64, 2, PAL.yellow);
    p.rect(0, dv + 2, 64, 1, shade(PAL.yellow, -0.4));
    p.hline(0, W - 1, H - 3, 0xb8b0a0);
    p.hline(0, W - 1, H - 2, PAL.stripe);
    // rubber groove in each lane (where tyres run)
    for (const ly of [LANE_FAR_Y - FAR_TOP - 3, LANE_NEAR_Y - FAR_TOP - 4]) {
      for (let x = 0; x < W; x++) {
        if (r() > 0.25) p.set(x, ly, 0x24222c);
        if (r() > 0.5) p.set(x, ly + 1, 0x24222c);
      }
    }
    p.toTexture(this.scene, key);
    return key;
  }

  private foreTex(): string {
    const key = 'trk_fore';
    if (this.scene.textures.exists(key)) return key;
    const W = 64,
      H = GROUND_BOTTOM - NEAR_BOTTOM;
    const p = new Pix(W, H);
    const r = texRng(9);
    p.rect(0, 0, W, H, 0x2d4a2a);
    for (let i = 0; i < 60; i++) p.set(Math.floor(r() * W), Math.floor(r() * H), r() > 0.5 ? 0x3f6a38 : 0x1f331d);
    p.rect(0, 3, W, 3, 0xb8b4c8); // guardrail
    p.hline(0, W - 1, 3, 0xffffff);
    p.rect(4, 6, 2, H - 6, 0x6a6678);
    p.rect(36, 6, 2, H - 6, 0x6a6678);
    p.toTexture(this.scene, key);
    return key;
  }

  // ------------------------------------------------------------------ world props

  private buildWorldProps() {
    const s = this.scene;
    const g = this.add(s.add.graphics());
    const finishX = Math.round(this.lengthM * PPM);

    // Burnout box rubber before the line and launch rubber after it.
    for (const ly of [LANE_FAR_Y, LANE_NEAR_Y]) {
      for (let i = 0; i < 18; i++) {
        const a = 0.5 - i * 0.025;
        g.fillStyle(0x15131b, a).fillRect(-40 + i * 24, ly - 6, 26, 5);
      }
    }
    // Start line
    g.fillStyle(PAL.stripe, 1).fillRect(0, FAR_TOP + 3, 3, NEAR_BOTTOM - FAR_TOP - 6);
    // Finish line: checkered strip across both lanes
    for (let y = FAR_TOP + 3, k = 0; y < NEAR_BOTTOM - 3; y += 4, k++) {
      g.fillStyle(k % 2 ? 0x101010 : 0xffffff, 1).fillRect(finishX, y, 4, 4);
      g.fillStyle(k % 2 ? 0xffffff : 0x101010, 1).fillRect(finishX + 4, y, 4, 4);
    }
    // Finish gantry: two towers + checkered banner.
    g.fillStyle(0x3a3550, 1).fillRect(finishX - 2, 118, 4, FAR_TOP - 118 + 4);
    g.fillStyle(0x3a3550, 1).fillRect(finishX + 10, 118, 4, FAR_TOP - 118 + 4);
    g.fillStyle(PAL.bgDeep, 1).fillRect(finishX - 34, 112, 80, 22);
    for (let x = 0; x < 76; x += 4)
      for (let y = 0; y < 18; y += 4) {
        g.fillStyle(((x + y) / 4) % 2 ? 0x101010 : 0xffffff, 1).fillRect(finishX - 32 + x, 114 + y, 4, 4);
      }
    const ft = this.add(this.txt(finishX + 6, 100, 'FINISH', 8, PAL.yellow));
    ft.setOrigin(0.5, 0);

    // Distance boards
    const boards: [number, string][] = [
      [60 * FT, '60FT'],
      [330 * FT, '330FT'],
      [660 * FT, '1/8 MI'],
      [1000 * FT, '1000FT'],
    ];
    for (const [m, label] of boards) {
      const bx = Math.round(m * PPM);
      g.fillStyle(0x3a3550, 1).fillRect(bx - 1, 168, 2, WALL_Y - 168);
      g.fillStyle(PAL.bgDeep, 1).fillRect(bx - 26, 150, 52, 18);
      g.fillStyle(PAL.yellow, 1).fillRect(bx - 25, 151, 50, 16);
      g.fillStyle(0x101010, 1).fillRect(bx - 24, 152, 48, 14);
      this.add(this.txt(bx, 155, label, 8, PAL.yellow)).setOrigin(0.5, 0);
      // ground mark across lanes
      g.fillStyle(PAL.stripe, 0.35).fillRect(bx, FAR_TOP + 3, 2, NEAR_BOTTOM - FAR_TOP - 6);
    }

    // Starting tree prop on the divider.
    g.fillStyle(0x3a3550, 1).fillRect(28, 196, 4, DIVIDER_Y - 196);
    g.fillStyle(0x1a1726, 1).fillRect(25, 202, 10, 40);
    this.propLights = this.add(s.add.graphics());
    this.setTreeLights(0, false);

    // Pit-side scenery behind the line: a tow truck shape and cones
    for (let i = 0; i < 6; i++) {
      const cx = -220 + i * 30;
      g.fillStyle(PAL.orange, 1).fillRect(cx, LANE_NEAR_Y + 8, 4, 4);
      g.fillStyle(PAL.ink, 1).fillRect(cx, LANE_NEAR_Y + 10, 4, 1);
    }
  }

  private txt(x: number, y: number, s: string, size: number, color: number) {
    return this.scene.add.text(x, y, s, { fontFamily: FONT, fontSize: `${size}px`, color: hex(color), resolution: 1 });
  }
}
