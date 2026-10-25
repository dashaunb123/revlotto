// Procedural canvas textures for the drag strip: tileable concrete / asphalt PBR sets, noise, sponsor boards,
// signs, glow sprites. Everything is generated once per strip and disposed with it.
import * as THREE from 'three';
import { rng } from './layout';

type R = () => number;

/** Tileable value noise lattice with period p (in cells) over a unit square. */
function lattice(p: number, r: R): (u: number, v: number) => number {
  const g = new Float32Array(p * p);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (u: number, v: number) => {
    const x = u * p, y = v * p;
    const xi = Math.floor(x), yi = Math.floor(y);
    let fx = x - xi, fy = y - yi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p, x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
    const a = g[y0 * p + x0], b = g[y0 * p + x1], c = g[y1 * p + x0], d = g[y1 * p + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/** Tileable fbm (0..1) with `oct` octaves starting at period p0. */
export function fbm(p0: number, oct: number, seed: number, gain = 0.5) {
  const r = rng(seed);
  const ls = Array.from({ length: oct }, (_, i) => lattice(p0 << i, r));
  let norm = 0;
  for (let i = 0, a = 1; i < oct; i++, a *= gain) norm += a;
  return (u: number, v: number) => {
    let s = 0;
    for (let i = 0, a = 1; i < oct; i++, a *= gain) s += ls[i](u, v) * a;
    return s / norm;
  };
}

// Canvases are generated once per session and reused by every later strip build (new textures, same pixels).
const CACHE = new Map<string, HTMLCanvasElement[]>();
export function memo(key: string, make: () => HTMLCanvasElement[]): HTMLCanvasElement[] {
  let c = CACHE.get(key);
  if (!c) CACHE.set(key, (c = make()));
  return c;
}

export function canvas(w: number, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function tex(c: HTMLCanvasElement, srgb: boolean, repeat = true, aniso = 4): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Tangent-space normal map from a tileable height field. */
function normalFromHeight(h: Float32Array, n: number, strength: number): HTMLCanvasElement {
  const c = canvas(n);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const l = h[y * n + ((x - 1 + n) % n)], r = h[y * n + ((x + 1) % n)];
      const u = h[((y - 1 + n) % n) * n + x], d = h[((y + 1) % n) * n + x];
      let nx = (l - r) * strength, ny = (d - u) * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * n + x) * 4;
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export interface PbrSet {
  map: THREE.CanvasTexture;
  roughnessMap: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
  dispose(): void;
}

type PixFn = (u: number, v: number, o: number[]) => void;
function set5(o: number[], a: number, b: number, c: number, d: number, e: number) { o[0] = a; o[1] = b; o[2] = c; o[3] = d; o[4] = e; }

function pbrSet(key: string, n: number, aniso: number, make: () => PixFn): PbrSet {
  // fn writes [r, g, b (0..1 sRGB), roughness, height]
  const [ca, cr, cn] = memo(`${key}:${n}`, () => {
    const fn = make();
    const ca = canvas(n), cr = canvas(n);
    const ia = ca.getContext('2d')!.createImageData(n, n), ir = cr.getContext('2d')!.createImageData(n, n);
    const h = new Float32Array(n * n);
    const o = [0, 0, 0, 0, 0];
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        fn(x / n, y / n, o);
        const i = (y * n + x) * 4;
        ia.data[i] = o[0] * 255; ia.data[i + 1] = o[1] * 255; ia.data[i + 2] = o[2] * 255; ia.data[i + 3] = 255;
        const rv = Math.max(0, Math.min(1, o[3])) * 255;
        ir.data[i] = rv; ir.data[i + 1] = rv; ir.data[i + 2] = rv; ir.data[i + 3] = 255;
        h[y * n + x] = o[4];
      }
    }
    ca.getContext('2d')!.putImageData(ia, 0, 0);
    cr.getContext('2d')!.putImageData(ir, 0, 0);
    return [ca, cr, normalFromHeight(h, n, n / 64)];
  });
  const s: PbrSet = {
    map: tex(ca, true, true, aniso),
    roughnessMap: tex(cr, false, true, aniso),
    normalMap: tex(cn, false, true, aniso),
    dispose() { s.map.dispose(); s.roughnessMap.dispose(); s.normalMap.dispose(); },
  };
  return s;
}

/** Launch-pad concrete. One tile = 5 m along × 2.75 m across (half a lane), sawcut joints on the tile edges. */
export function concreteSet(n: number, aniso: number): PbrSet {
  return pbrSet('concrete', n, aniso, () => {
    const big = fbm(3, 5, 11), mid = fbm(16, 3, 12), r = rng(13);
    const ju = 2.2 / n, jv = 2.2 / n;
    return (u, v, o) => {
      const s = big(u, v), m = mid(u, v), sp = r();
      const pit = sp > 0.985 ? -0.6 : 0;
      const agg = (sp - 0.5) * 0.06;
      const du = Math.min(u, 1 - u), dv = Math.min(v, 1 - v);
      const joint = du < ju || dv < jv * 0.6 ? 1 : 0;
      let g = 0.4 + (s - 0.5) * 0.16 + (m - 0.5) * 0.05 + agg;
      g *= joint ? 0.42 : 1;
      g += pit * 0.08;
      const ro = 0.74 + (m - 0.5) * 0.18 - (s - 0.5) * 0.12 + (joint ? 0.15 : 0);
      const he = s * 0.6 + m * 0.25 + sp * 0.08 + pit * 0.1 - joint * 0.9;
      set5(o, g * 1.02, g * 1.0, g * 0.96, ro, he);
    };
  });
}

/** Dense-graded asphalt. One tile = 3.5 m. */
export function asphaltSet(n: number, aniso: number): PbrSet {
  return pbrSet('asphalt2', n, aniso, () => {
    const big = fbm(2, 5, 21), stones = fbm(64, 2, 22, 0.35), fine = fbm(128, 2, 24, 0.5), r = rng(23);
    return (u, v, o) => {
      const s = big(u, v), st = stones(u, v), fi = fine(u, v), sp = r();
      const stone = Math.max(0, (st - 0.56) * 4);
      const glint = sp > 0.985 ? 0.04 : 0;
      // finer aggregate octave breaks up the larger stone blotches close to the camera
      const g = 0.085 + (s - 0.5) * 0.05 + stone * 0.05 + (fi - 0.5) * 0.045 + glint + (sp - 0.5) * 0.02;
      const ro = Math.max(0.7, 0.88 - stone * 0.1 - glint + (s - 0.5) * 0.08 + (fi - 0.5) * 0.04);
      const he = st * 0.45 + fi * 0.35 + s * 0.2 + sp * 0.04;
      set5(o, g, g * 1.0, g * 1.04, ro, he);
    };
  });
}

/** Grass / dirt infield. One tile = 8 m. */
export function groundSet(n: number, aniso: number): PbrSet {
  return pbrSet('ground', n, aniso, () => {
    const big = fbm(2, 5, 31), fine = fbm(48, 2, 32), r = rng(33);
    return (u, v, o) => {
      const s = big(u, v), f = fine(u, v), sp = r();
      const dirt = Math.max(0, Math.min(1, (s - 0.52) * 5));
      const k = 0.7 + f * 0.5 + (sp - 0.5) * 0.25;
      set5(o, (0.06 + 0.05 * dirt) * k, (0.085 + 0.01 * dirt) * k, (0.045 + 0.03 * dirt) * k, 0.95, f * 0.6 + sp * 0.2);
    };
  });
}


/** RGB tileable noise for shaders: R low, G mid, B high frequency. */
export function noiseTexture(n: number): THREE.CanvasTexture {
  return tex(memo('noise:' + n, () => [noiseCanvas(n)])[0], false);
}
function noiseCanvas(n: number): HTMLCanvasElement {
  const a = fbm(4, 4, 41), b = fbm(16, 3, 42), c = fbm(64, 2, 43);
  const cv = canvas(n);
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / n, v = y / n, i = (y * n + x) * 4;
      img.data[i] = a(u, v) * 255; img.data[i + 1] = b(u, v) * 255; img.data[i + 2] = c(u, v) * 255; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** Plain concrete for walls (tile 3 m): stained, with form-tie dots. */
export function wallConcreteSet(n: number, aniso: number): PbrSet {
  return pbrSet('wall', n, aniso, () => {
    const big = fbm(3, 5, 51), mid = fbm(24, 2, 52), r = rng(53);
    return (u, v, o) => {
      const s = big(u, v), m = mid(u, v), sp = r();
      const streak = Math.max(0, fbm1(u * 13.0) - 0.55) * (0.4 + v * 0.6);
      const seam = Math.min(u, 1 - u) < 1.5 / n ? 0.55 : 1;
      let g = (0.58 + (s - 0.5) * 0.12 + (m - 0.5) * 0.05 + (sp - 0.5) * 0.04 - streak * 0.25) * seam;
      set5(o, g * 1.0, g * 0.99, g * 0.95, 0.8 + (m - 0.5) * 0.1, s * 0.5 + m * 0.3 + sp * 0.06 - (1 - seam) * 0.6);
    };
  });
}

const fbm1 = (x: number) => 0.5 + 0.5 * Math.sin(x * 2.1 + Math.sin(x * 5.3) * 1.7) * Math.cos(x * 0.7);

/** Chain-link fence alpha (white diamonds on transparent), tile = 0.6 m. */
export function chainLink(n = 128): THREE.CanvasTexture {
  const [c] = memo(`chain:${n}`, () => [chainLinkCanvas(n)]);
  return tex(c, true);
}
function chainLinkCanvas(n: number): HTMLCanvasElement {
  const c = canvas(n);
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = n / 34;
  const k = n / 4;
  for (let i = -4; i <= 8; i++) {
    ctx.beginPath(); ctx.moveTo(i * k, 0); ctx.lineTo(i * k + n, n); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i * k + n, 0); ctx.lineTo(i * k, n); ctx.stroke();
  }
  return c;
}

/** Radial glow sprite (white, premultiplied falloff). */
export function glowTexture(n = 128, core = 0.12): THREE.CanvasTexture {
  const [c] = memo(`glow:${n}:${core}`, () => [glowTextureCanvas(n,core)]);
  return tex(c, true, false);
}
function glowTextureCanvas(n: number,core: number): HTMLCanvasElement {
  const c = canvas(n);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(core, 'rgba(255,255,255,0.85)');
  g.addColorStop(core * 2.2, 'rgba(255,255,255,0.32)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.08)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, n, n);
  return c;
}

/** Anamorphic lens streak + star spikes for bright fixtures. */
export function flareTexture(n = 256): THREE.CanvasTexture {
  const [c] = memo(`flare:${n}`, () => [flareTextureCanvas(n)]);
  return tex(c, true, false);
}
function flareTextureCanvas(n: number): HTMLCanvasElement {
  const c = canvas(n);
  const ctx = c.getContext('2d')!;
  ctx.globalCompositeOperation = 'lighter';
  const h = n / 2;
  const line = (ang: number, len: number, w: number, a: number) => {
    ctx.save();
    ctx.translate(h, h);
    ctx.rotate(ang);
    const g = ctx.createLinearGradient(-len, 0, len, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, `rgba(255,255,255,${a})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(0, 0, len, w, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
  line(0, h, n / 90, 0.9);
  line(0, h * 0.7, n / 30, 0.25);
  line(Math.PI / 2, h * 0.35, n / 140, 0.5);
  line(Math.PI / 4, h * 0.22, n / 160, 0.35);
  line(-Math.PI / 4, h * 0.22, n / 160, 0.35);
  const g = ctx.createRadialGradient(h, h, 0, h, h, h * 0.18);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, n, n);
  return c;
}

/** Soft cloudy puff for ground mist billboards. */
export function puffTexture(n = 128): THREE.CanvasTexture {
  const [c] = memo(`puff:${n}`, () => [puffTextureCanvas(n)]);
  return tex(c, true, false);
}
function puffTextureCanvas(n: number): HTMLCanvasElement {
  const f = fbm(4, 4, 61);
  const c = canvas(n);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dx = x / n - 0.5, dy = y / n - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;
      const fall = Math.max(0, 1 - r);
      const a = fall * fall * (0.45 + f(x / n, y / n) * 0.9);
      const i = (y * n + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ---------------- Signage ----------------

const FONT = '"Arial Black", "Helvetica Neue", Impact, Arial, sans-serif';
const COND = 'Impact, "Arial Narrow", "Arial Black", sans-serif';

interface Brand { name: string; sub?: string; bg: string; fg: string; accent: string; font?: string; style: number }
// Parody sponsors only.
export const BRANDS: Brand[] = [
  { name: 'REVLOTTO', sub: 'RACEWAY', bg: '#0c0c14', fg: '#ffd23f', accent: '#ff3b30', style: 0 },
  { name: 'NITROUZ', sub: 'GO BLUE OR GO HOME', bg: '#0a2a8c', fg: '#ffffff', accent: '#45c8ff', style: 1, font: COND },
  { name: 'GRIPZILLA', sub: 'DRAG RADIALS', bg: '#f4c400', fg: '#111111', accent: '#d01818', style: 2 },
  { name: 'TORQUE BROS', sub: 'PERFORMANCE', bg: '#b01212', fg: '#ffffff', accent: '#ffcc00', style: 3, font: COND },
  { name: 'OCTANE OIL', sub: 'SYNTHETIC RACING', bg: '#101010', fg: '#ff7a00', accent: '#ffffff', style: 1 },
  { name: 'BURNOUT BREW', sub: 'ICE COLD', bg: '#e8e2d0', fg: '#4a1a08', accent: '#c8102e', style: 4, font: COND },
  { name: "PISTON PETE'S", sub: 'SPEED SHOP', bg: '#1b5e20', fg: '#ffffff', accent: '#ffd600', style: 2, font: COND },
  { name: 'LAUNCHPAD', sub: 'ENERGY DRINK', bg: '#111111', fg: '#7cff00', accent: '#7cff00', style: 5 },
  { name: "SHIFTY'S", sub: 'AUTO PARTS', bg: '#ffffff', fg: '#0d47a1', accent: '#e53935', style: 3 },
  { name: 'HOLESHOT', sub: 'INSURANCE', bg: '#263238', fg: '#ffffff', accent: '#00e5ff', style: 0, font: COND },
  { name: 'REDLINE 101.3', sub: 'ROCK RADIO', bg: '#d32f2f', fg: '#ffffff', accent: '#111111', style: 4 },
  { name: 'VROOM COLA', sub: 'TASTE THE TORQUE', bg: '#c4001d', fg: '#ffffff', accent: '#ffffff', style: 1, font: COND },
  { name: 'DRAGSTAR', sub: 'SPARK PLUGS', bg: '#ffd400', fg: '#1a1a1a', accent: '#1a1a1a', style: 5 },
  { name: 'TURBOTRON', sub: 'BOOST SYSTEMS', bg: '#2a0a4a', fg: '#e0b0ff', accent: '#ff40c0', style: 2 },
  { name: 'QUARTER MILE', sub: 'MOTEL  -  EXIT 14', bg: '#f06292', fg: '#ffffff', accent: '#2a0030', style: 3, font: COND },
  { name: 'BLOWN AWAY', sub: 'BBQ & WINGS', bg: '#3e2723', fg: '#ffab40', accent: '#ff5722', style: 4 },
  { name: 'WHEELIE WEAR', sub: 'TRACK APPAREL', bg: '#000000', fg: '#ffffff', accent: '#ff1744', style: 0 },
  { name: 'CAMSHAFT', sub: 'CAFE  &  DINER', bg: '#00695c', fg: '#ffeb3b', accent: '#ffffff', style: 5, font: COND },
];

function fitText(ctx: CanvasRenderingContext2D, text: string, font: string, maxW: number, size: number) {
  let s = size;
  ctx.font = `900 ${s}px ${font}`;
  while (ctx.measureText(text).width > maxW && s > 8) {
    s -= 2;
    ctx.font = `900 ${s}px ${font}`;
  }
  return s;
}

function drawBrand(ctx: CanvasRenderingContext2D, b: Brand, x: number, y: number, w: number, h: number) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = b.bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = b.accent;
  switch (b.style) {
    case 1: // speed stripes
      for (let i = 0; i < 4; i++) ctx.fillRect(x, y + h * (0.78 + i * 0.05), w, h * 0.022);
      break;
    case 2: // chevrons on the left
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        const cx = x + h * 0.25 + i * h * 0.22;
        ctx.moveTo(cx, y + h * 0.15); ctx.lineTo(cx + h * 0.2, y + h * 0.5); ctx.lineTo(cx, y + h * 0.85);
        ctx.lineTo(cx + h * 0.1, y + h * 0.85); ctx.lineTo(cx + h * 0.3, y + h * 0.5); ctx.lineTo(cx + h * 0.1, y + h * 0.15);
        ctx.fill();
      }
      break;
    case 3: // slanted end blocks
      ctx.beginPath(); ctx.moveTo(x + w - h * 0.9, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - h * 0.5, y + h); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + h * 0.35, y); ctx.lineTo(x + h * 0.05, y + h); ctx.lineTo(x, y + h); ctx.fill();
      break;
    case 4: // border + stars
      ctx.lineWidth = h * 0.06;
      ctx.strokeStyle = b.accent;
      ctx.strokeRect(x + h * 0.08, y + h * 0.08, w - h * 0.16, h - h * 0.16);
      break;
    case 5: // bolt swoosh
      ctx.beginPath();
      ctx.moveTo(x + w * 0.04, y + h * 0.8); ctx.quadraticCurveTo(x + w * 0.5, y + h * 0.55, x + w * 0.96, y + h * 0.75);
      ctx.lineTo(x + w * 0.96, y + h * 0.8); ctx.quadraticCurveTo(x + w * 0.5, y + h * 0.68, x + w * 0.04, y + h * 0.86); ctx.fill();
      break;
    default: // checker band
      for (let i = 0; i < w / (h * 0.1); i++) {
        ctx.fillRect(x + i * h * 0.1, y + h * (i % 2 ? 0.86 : 0.91), h * 0.1, h * 0.05);
      }
  }
  const font = b.font ?? FONT;
  const left = b.style === 2 ? h * 0.95 : h * 0.3;
  const right = b.style === 3 ? h * 0.9 : h * 0.3;
  ctx.fillStyle = b.fg;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const cx = x + (left + (w - right)) / 2;
  fitText(ctx, b.name, font, w - left - right, h * 0.5);
  ctx.fillText(b.name, cx, y + h * (b.sub ? 0.4 : 0.5));
  if (b.sub) {
    fitText(ctx, b.sub, FONT, (w - left - right) * 0.8, h * 0.15);
    ctx.globalAlpha = 0.9;
    ctx.fillText(b.sub, cx, y + h * 0.71);
  }
  ctx.restore();
}

export const ATLAS_COLS = 2, ATLAS_ROWS = 9;
/** Sponsor board atlas: 18 boards, 512×112 each. Returns the texture and a UV rect per brand index. */
export function sponsorAtlas(aniso: number) {
  const W = 1024, H = 1024, bw = W / ATLAS_COLS, bh = H / ATLAS_ROWS;
  const [c] = memo('sponsors', () => {
    const c = canvas(W, H);
    const ctx = c.getContext('2d')!;
    BRANDS.forEach((b, i) => drawBrand(ctx, b, (i % ATLAS_COLS) * bw, Math.floor(i / ATLAS_COLS) * bh, bw, bh));
    return [c];
  });
  const t = tex(c, true, false, aniso);
  const rect = (i: number) => {
    const cx = i % ATLAS_COLS, cy = Math.floor(i / ATLAS_COLS);
    return { u0: cx / ATLAS_COLS, u1: (cx + 1) / ATLAS_COLS, v0: 1 - (cy + 1) / ATLAS_ROWS, v1: 1 - cy / ATLAS_ROWS };
  };
  return { texture: t, rect, count: BRANDS.length, aspect: bw / bh };
}

/** A sign texture with centred text lines. */
export function signTexture(lines: { text: string; size: number; color: string; font?: string }[], w: number, h: number, bg: string, opts: { border?: string; aniso?: number } = {}) {
  const [c] = memo('sign:' + JSON.stringify([lines, w, h, bg, opts.border]), () => [drawSign(lines, w, h, bg, opts)]);
  return tex(c, true, false, opts.aniso ?? 4);
}
function drawSign(lines: { text: string; size: number; color: string; font?: string }[], w: number, h: number, bg: string, opts: { border?: string }) {
  const c = canvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  if (opts.border) {
    ctx.strokeStyle = opts.border;
    ctx.lineWidth = h * 0.05;
    ctx.strokeRect(h * 0.04, h * 0.04, w - h * 0.08, h - h * 0.08);
  }
  const total = lines.reduce((a, l) => a + l.size * h * 1.1, 0);
  let y = (h - total) / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of lines) {
    const sz = l.size * h;
    ctx.fillStyle = l.color;
    fitText(ctx, l.text, l.font ?? FONT, w * 0.92, sz);
    ctx.fillText(l.text, w / 2, y + sz * 0.55);
    y += sz * 1.1;
  }
  return c;
}

/** Building facade with lit windows (tile = one building face). Emissive-ready (black walls). */
export function windowsTexture(n: number, seed: number, warm = true): THREE.CanvasTexture {
  const r = rng(seed);
  const c = canvas(n, n);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, n, n);
  const cols = 16, rows = 32, cw = n / cols, rh = n / rows;
  for (let y = 0; y < rows; y++) {
    const floorOn = r() > 0.15;
    for (let x = 0; x < cols; x++) {
      if (!floorOn || r() > 0.42) continue;
      const k = 0.35 + r() * 0.65;
      const hue = warm ? (r() > 0.25 ? [255, 200, 130] : [190, 220, 255]) : [170, 210, 255];
      ctx.fillStyle = `rgb(${hue[0] * k | 0},${hue[1] * k | 0},${hue[2] * k | 0})`;
      ctx.fillRect(x * cw + cw * 0.18, y * rh + rh * 0.2, cw * 0.64, rh * 0.55);
    }
  }
  return tex(c, true);
}

/** City skyline silhouette strip (RGBA): dark buildings with sparse lit windows, a glow fringe at the top. */
export function skylineTexture(w: number, h: number, seed: number, density: number): THREE.CanvasTexture {
  const r = rng(seed);
  const c = canvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  let x = 0;
  const towers: [number, number, number][] = [];
  while (x < w) {
    const bw = (0.012 + r() * 0.035) * w;
    const tall = r() < 0.12 ? 0.55 + r() * 0.4 : 0.12 + r() * 0.38 * density;
    const bh = tall * h;
    towers.push([x, bw, bh]);
    x += bw * (0.75 + r() * 0.35);
  }
  for (const [bx, bw, bh] of towers) {
    const shade = 8 + r() * 10;
    ctx.fillStyle = `rgb(${shade | 0},${(shade + 2) | 0},${(shade + 8) | 0})`;
    ctx.fillRect(bx, h - bh, bw, bh);
    if (r() < 0.25) ctx.fillRect(bx + bw * 0.42, h - bh - h * 0.04, bw * 0.08, h * 0.04); // antenna
    const ww = Math.max(1, bw / 10), wh = Math.max(1, h / 90);
    for (let yy = h - bh + wh * 2; yy < h - wh; yy += wh * 2.2) {
      for (let xx = bx + ww; xx < bx + bw - ww; xx += ww * 2) {
        if (r() > 0.28) continue;
        const k = 0.4 + r() * 0.6;
        ctx.fillStyle = r() > 0.3 ? `rgba(255,${(190 * k) | 0},${(110 * k) | 0},${k})` : `rgba(170,200,255,${k * 0.8})`;
        ctx.fillRect(xx, yy, ww, wh);
      }
    }
  }
  const t = tex(c, true, false);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}
