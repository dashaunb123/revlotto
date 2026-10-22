// Tiny software pixel buffer for crisp, hard-edged pixel art (no canvas antialiasing).
// Draw into a Pix, then upload it as a Phaser texture with toTexture().
import Phaser from 'phaser';

const EMPTY = -1;

export function parseColor(c: string | number): number {
  if (typeof c === 'number') return c & 0xffffff;
  const s = c.replace('#', '');
  const full = s.length === 3 ? s.split('').map((ch) => ch + ch).join('') : s;
  const n = parseInt(full, 16);
  return Number.isFinite(n) ? n & 0xffffff : 0xff00ff;
}

/** Mix a color toward white (amt > 0) or black (amt < 0). amt in -1..1. */
export function shade(c: number, amt: number): number {
  let r = (c >> 16) & 255;
  let g = (c >> 8) & 255;
  let b = c & 255;
  if (amt >= 0) {
    r += (255 - r) * amt;
    g += (255 - g) * amt;
    b += (255 - b) * amt;
  } else {
    r *= 1 + amt;
    g *= 1 + amt;
    b *= 1 + amt;
  }
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255,
    ag = (a >> 8) & 255,
    ab = a & 255;
  const br = (b >> 16) & 255,
    bg = (b >> 8) & 255,
    bb = b & 255;
  return (
    (Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t)
  );
}

/** Deterministic tiny PRNG for texture generation (so textures look the same every run). */
export function texRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

export class Pix {
  readonly w: number;
  readonly h: number;
  readonly px: Int32Array;
  readonly alpha: Uint8Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.px = new Int32Array(w * h).fill(EMPTY);
    this.alpha = new Uint8Array(w * h).fill(255);
  }

  inb(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  get(x: number, y: number): number {
    x |= 0;
    y |= 0;
    return this.inb(x, y) ? this.px[y * this.w + x] : EMPTY;
  }
  filled(x: number, y: number) {
    return this.get(x, y) !== EMPTY;
  }
  set(x: number, y: number, c: number, a = 255) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (!this.inb(x, y)) return;
    this.px[y * this.w + x] = c;
    this.alpha[y * this.w + x] = a;
  }
  clear(x: number, y: number) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (this.inb(x, y)) this.px[y * this.w + x] = EMPTY;
  }
  rect(x: number, y: number, w: number, h: number, c: number, a = 255) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c, a);
  }
  hline(x0: number, x1: number, y: number, c: number) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, c);
  }
  vline(x: number, y0: number, y1: number, c: number) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) this.set(x, y, c);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: number) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0),
      dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1,
      sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }
  /** Fill a polygon by testing pixel centers (crisp, no AA). */
  poly(pts: number[][], c: number | ((x: number, y: number) => number)) {
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const [x, y] of pts) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
        if (pointInPoly(x + 0.5, y + 0.5, pts)) this.set(x, y, typeof c === 'number' ? c : c(x, y));
      }
    }
  }
  disc(cx: number, cy: number, r: number, c: number) {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++)
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const dx = x + 0.5 - cx,
          dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) this.set(x, y, c);
      }
  }
  ring(cx: number, cy: number, r0: number, r1: number, c: number) {
    for (let y = Math.floor(cy - r1 - 1); y <= Math.ceil(cy + r1 + 1); y++)
      for (let x = Math.floor(cx - r1 - 1); x <= Math.ceil(cx + r1 + 1); x++) {
        const dx = x + 0.5 - cx,
          dy = y + 0.5 - cy;
        const d = dx * dx + dy * dy;
        if (d <= r1 * r1 && d > r0 * r0) this.set(x, y, c);
      }
  }
  eraseDisc(cx: number, cy: number, r: number) {
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++)
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const dx = x + 0.5 - cx,
          dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) this.clear(x, y);
      }
  }
  /** Add a 1px outline around every filled region (4-neighbour). */
  outline(c: number) {
    const add: number[] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.filled(x, y)) continue;
        if (this.filled(x - 1, y) || this.filled(x + 1, y) || this.filled(x, y - 1) || this.filled(x, y + 1))
          add.push(x, y);
      }
    for (let i = 0; i < add.length; i += 2) this.set(add[i], add[i + 1], c);
  }

  toCanvas(): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    cv.width = this.w;
    cv.height = this.h;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(this.w, this.h);
    for (let i = 0; i < this.px.length; i++) {
      const c = this.px[i];
      if (c === EMPTY) continue;
      img.data[i * 4] = (c >> 16) & 255;
      img.data[i * 4 + 1] = (c >> 8) & 255;
      img.data[i * 4 + 2] = c & 255;
      img.data[i * 4 + 3] = this.alpha[i];
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  /** Upload as a texture (replacing nothing: returns early if the key exists). */
  toTexture(scene: Phaser.Scene, key: string): string {
    if (scene.textures.exists(key)) return key;
    scene.textures.addCanvas(key, this.toCanvas());
    return key;
  }
}

/** Build a spritesheet-like texture from several equally sized frames laid out horizontally. */
export function framesToTexture(scene: Phaser.Scene, key: string, frames: Pix[]): string {
  if (scene.textures.exists(key)) return key;
  const fw = frames[0].w,
    fh = frames[0].h;
  const cv = document.createElement('canvas');
  cv.width = fw * frames.length;
  cv.height = fh;
  const ctx = cv.getContext('2d')!;
  frames.forEach((f, i) => ctx.drawImage(f.toCanvas(), i * fw, 0));
  const tex = scene.textures.addCanvas(key, cv)!;
  frames.forEach((_, i) => tex.add(i, 0, i * fw, 0, fw, fh));
  return key;
}

export function pointInPoly(x: number, y: number, pts: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
