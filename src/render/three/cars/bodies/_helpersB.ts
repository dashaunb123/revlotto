// Cars B modeling toolkit (muscle / brick / widebody / super). Everything is authored in code:
//  - loftBody: keyframed cross-sections along X (wheel arches cut in, rounded + capped ends, region split into panels)
//  - greenhouse: the glass house as one smooth loft split into glass / pillar / roof regions
//  - Projector + patch/line: conformal patches (lamps, grilles, vents) and shut lines projected onto any surface
//  - sweep/tube, wheel-well liners, mirrors, handles, interior
// Car faces +X, +Y up, +Z = car's left. Units: metres.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CarSpec } from '../../types';

export type P2 = [number, number];
export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const lerp = THREE.MathUtils.lerp;
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** 1 inside [a,b] with smooth shoulders of width e. */
export const band = (a: number, b: number, e: number, x: number) => sstep(a - e, a + e, x) * (1 - sstep(b - e, b + e, x));

// ---------------------------------------------------------------- materials (look's materials.ts, local fallbacks)
type Mod = Record<string, unknown>;
const LOOK = Object.values(import.meta.glob('../../materials.ts', { eager: true }))[0] as Mod | undefined;
type AnyFn = (...a: unknown[]) => THREE.Material;
const lk = (name: string): AnyFn | undefined => (LOOK?.[name] as AnyFn | undefined) ?? undefined;
function tryLook(name: string, ...args: unknown[]): THREE.Material | undefined {
  const f = lk(name);
  if (!f) return undefined;
  try {
    return f(...args);
  } catch {
    return undefined;
  }
}
const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(o);
const phys = (o: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(o);

export interface Mats {
  paint: THREE.Material;
  glass: THREE.Material;
  chrome: THREE.Material;
  trim: THREE.Material; // matte black plastic
  gloss: THREE.Material; // gloss black (piano) trim
  liner: THREE.Material;
  shut: THREE.Material;
  rubber: THREE.Material;
  carbon: THREE.Material;
  metal: THREE.Material;
  lensClear: THREE.Material;
  lensRed: THREE.Material;
  housing: THREE.Material; // dark lamp housing
  reflector: THREE.Material; // chrome-ish lamp reflector
  head: THREE.Material; // emissive headlight (switchable)
  drl: THREE.Material; // emissive DRL (always on)
  tail: THREE.Material; // emissive tail (switchable)
  amber: THREE.Material;
  seat: THREE.Material;
  dash: THREE.Material;
  carpet: THREE.Material;
  wheel: THREE.Material;
  accent: THREE.Material;
  grille: (repeat: P2, pattern?: string) => THREE.Material;
  plate: (text: string) => THREE.Material;
  badge: (text: string, color: string) => THREE.Material;
}

/** A per-car instance of a possibly shared material (switchable lights must not be shared between cars). */
function own(m: THREE.Material): THREE.Material {
  if (!m.userData?.shared) return m;
  const c = m.clone();
  c.userData = { ...m.userData, shared: false };
  return c;
}

export function makeMats(spec: CarSpec): Mats {
  const m = (name: string, args: unknown[], fb: () => THREE.Material) => tryLook(name, ...args) ?? fb();
  const light = (c: string, i: number) =>
    m('lightMaterial', [c, i], () => std({ color: 0x111111, emissive: c, emissiveIntensity: i * 0.4, roughness: 0.4 }));
  return {
    paint: m('paintMaterial', [spec.paint, { finish: 'metallic' }], () =>
      phys({ color: spec.paint, metalness: 0.5, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05 })),
    glass: m('glass', [{}], () =>
      phys({ color: 0x0a0e14, metalness: 0.2, roughness: 0.04, transparent: true, opacity: 0.62, clearcoat: 1, side: THREE.DoubleSide })),
    chrome: m('chrome', [], () => std({ color: 0xffffff, metalness: 1, roughness: 0.08 })),
    trim: m('plastic', ['#141416'], () => std({ color: 0x141416, roughness: 0.7 })),
    gloss: m('plastic', ['#0b0b0d', { gloss: 0.95 }], () => phys({ color: 0x0b0b0d, roughness: 0.15, clearcoat: 1 })),
    liner: m('plastic', ['#070708', { texture: true }], () => std({ color: 0x070708, roughness: 0.95, side: THREE.DoubleSide })),
    shut: std({ color: 0x030303, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    rubber: m('rubber', [{}], () => std({ color: 0x111111, roughness: 0.92 })),
    carbon: m('carbon', [{}], () => phys({ color: 0x1a1a1c, roughness: 0.3, clearcoat: 1 })),
    metal: m('brushedMetal', ['#9a9aa2'], () => std({ color: 0x9a9aa2, metalness: 1, roughness: 0.35 })),
    lensClear: m('lens', [{ tint: '#ffffff', opacity: 0.12 }], () =>
      phys({ color: 0xffffff, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.25, clearcoat: 1 })),
    lensRed: m('lens', [{ tint: '#ff1c1c' }], () =>
      phys({ color: 0xc8101a, roughness: 0.05, transparent: true, opacity: 0.55, clearcoat: 1 })),
    housing: std({ color: 0x0c0c10, roughness: 0.35, metalness: 0.4 }),
    reflector: std({ color: 0xd8dce4, metalness: 1, roughness: 0.18 }),
    head: own(light('#eef3ff', 6)),
    drl: light('#f2f6ff', 4),
    tail: own(light('#ff1414', 5)),
    amber: light('#ff9a1a', 1.5),
    seat: m('interior', ['seat'], () => std({ color: 0x1b1b1f, roughness: 0.85 })),
    dash: m('interior', ['dash'], () => std({ color: 0x121215, roughness: 0.7 })),
    carpet: m('interior', ['carpet'], () => std({ color: 0x0d0d0f, roughness: 1 })),
    wheel: m('interior', ['wheel'], () => std({ color: 0x141416, roughness: 0.6 })),
    accent: m('paintMaterial', [spec.accent, { finish: 'solid' }], () => phys({ color: spec.accent, roughness: 0.35, clearcoat: 1 })),
    grille: (repeat, pattern = 'honeycomb') =>
      m('grille', [{ pattern, repeat }], () => std({ color: 0x0a0a0c, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide })),
    plate: (text) => m('plateMaterial', [text], () => std({ color: 0xe8e8ee, roughness: 0.5 })),
    badge: (text, color) => m('badgeMaterial', [text, color], () => std({ color, metalness: 0.9, roughness: 0.2 })),
  };
}

// ---------------------------------------------------------------- interpolation
/** Monotone cubic (PCHIP) through (xs, ys); xs ascending. Clamped outside. */
export function pchip(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const h: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h[i] = xs[i + 1] - xs[i];
    d[i] = (ys[i + 1] - ys[i]) / h[i];
  }
  const m: number[] = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i];
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

/** Keyframe table [x, a, b, c...] → (x) => [a, b, c...] with PCHIP per column. Rows sorted by x. */
export function table(rows: number[][]): (x: number) => number[] {
  const xs = rows.map((r) => r[0]);
  const fns = rows[0].slice(1).map((_, c) => pchip(xs, rows.map((r) => r[c + 1])));
  return (x) => fns.map((f) => f(x));
}
/** 1D curve through points [x, y][] (PCHIP). */
export const curve = (pts: P2[]) => pchip(pts.map((p) => p[0]), pts.map((p) => p[1]));

function crPoint(p0: P2, p1: P2, p2: P2, p3: P2, t: number): P2 {
  const d = (p: P2, q: P2) => Math.max(1e-5, Math.sqrt(Math.hypot(q[0] - p[0], q[1] - p[1])));
  const t1 = d(p0, p1);
  const t2 = t1 + d(p1, p2);
  const t3 = t2 + d(p2, p3);
  const tt = t1 + (t2 - t1) * t;
  const L = (A: P2, B: P2, ta: number, tb: number): P2 => {
    const u = (tt - ta) / (tb - ta);
    return [A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u];
  };
  const A1 = L(p0, p1, 0, t1);
  const A2 = L(p1, p2, t1, t2);
  const A3 = L(p2, p3, t2, t3);
  const B1 = L(A1, A2, 0, t2);
  const B2 = L(A2, A3, t1, t3);
  return L(B1, B2, t1, t2);
}
/** Centripetal Catmull-Rom through pts; per[i] samples on span i (end inclusive). Returns 1 + sum(per) points. */
export function crSample(pts: P2[], per: number[] | number, closed = false): P2[] {
  const n = pts.length;
  const out: P2[] = [[pts[0][0], pts[0][1]]];
  const spans = closed ? n : n - 1;
  const at = (i: number): P2 => {
    if (closed) return pts[((i % n) + n) % n];
    if (i < 0) return [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]];
    if (i > n - 1) return [2 * pts[n - 1][0] - pts[n - 2][0], 2 * pts[n - 1][1] - pts[n - 2][1]];
    return pts[i];
  };
  for (let i = 0; i < spans; i++) {
    const k = typeof per === 'number' ? per : per[i];
    const p1 = at(i);
    const p2 = at(i + 1);
    for (let s = 1; s <= k; s++) out.push(s === k ? [p2[0], p2[1]] : crPoint(at(i - 1), p1, p2, at(i + 2), s / k));
  }
  if (closed) out.pop();
  return out;
}
/** Resample a polyline to roughly uniform spacing. */
export function resample(pts: P2[], step: number): P2[] {
  const out: P2[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let s = 1; s <= n; s++) out.push([lerp(a[0], b[0], s / n), lerp(a[1], b[1], s / n)]);
  }
  return out;
}
/** Rounded-rectangle / superellipse outline centred at (cx, cy). */
export function superEllipse(cx: number, cy: number, rx: number, ry: number, e = 4, n = 48, rot = 0): P2[] {
  const out: P2[] = [];
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const ct = Math.cos(t);
    const st = Math.sin(t);
    const x = rx * Math.sign(ct) * Math.abs(ct) ** (2 / e);
    const y = ry * Math.sign(st) * Math.abs(st) ** (2 / e);
    out.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return out;
}
/** Polygon with filleted corners (quadratic corner curves); r per corner or global. */
export function roundPoly(pts: P2[], r: number | number[], n = 4): P2[] {
  const out: P2[] = [];
  const N = pts.length;
  for (let i = 0; i < N; i++) {
    const p = pts[i];
    const a = pts[(i + N - 1) % N];
    const b = pts[(i + 1) % N];
    const rr = typeof r === 'number' ? r : r[i];
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const t = Math.min(rr, da * 0.48, db * 0.48);
    if (t < 1e-4) {
      out.push([p[0], p[1]]);
      continue;
    }
    const pa: P2 = [p[0] + ((a[0] - p[0]) * t) / da, p[1] + ((a[1] - p[1]) * t) / da];
    const pb: P2 = [p[0] + ((b[0] - p[0]) * t) / db, p[1] + ((b[1] - p[1]) * t) / db];
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      out.push([(1 - u) * (1 - u) * pa[0] + 2 * (1 - u) * u * p[0] + u * u * pb[0], (1 - u) * (1 - u) * pa[1] + 2 * (1 - u) * u * p[1] + u * u * pb[1]]);
    }
  }
  return out;
}
export const rect = (a0: number, b0: number, a1: number, b1: number, r: number, n = 4) => roundPoly([[a0, b0], [a1, b0], [a1, b1], [a0, b1]], r, n);
/** Mirror an outline in a (z for front/rear projectors). */
export const flipA = (pts: P2[]): P2[] => pts.map(([a, b]) => [-a, b] as P2).reverse();
/** Grille with a dark backing (grille textures are alpha-tested). cell = honeycomb cell size (m). */
export function grillePatch(pr: Projector, M: Mats, outline: P2[], o: { cell?: number; pattern?: string; off?: number; res?: number } = {}): THREE.Mesh[] {
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const [a, b] of outline) {
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
  }
  const cell = o.cell ?? 0.028;
  const off = o.off ?? 0.003;
  const res = o.res ?? 0.03;
  return [
    mesh(patch(pr, outline, { off: off * 0.4, res }), M.liner, 'grilleBack'),
    mesh(patch(pr, outline, { off, res }), M.grille([Math.max(1, Math.round((a1 - a0) / cell)), Math.max(1, Math.round((b1 - b0) / cell))], o.pattern), 'grille'),
  ];
}
/** Smooth closed outline through corner points (Catmull-Rom). */
export const smoothLoop = (pts: P2[], per = 6) => crSample(pts, per, true);

// ---------------------------------------------------------------- grid surfaces
export interface Grid {
  ni: number;
  nj: number;
  pos: Float32Array; // ni*nj*3
  nrm: Float32Array;
}
const gi = (g: Grid, i: number, j: number) => (i * g.nj + j) * 3;

/** Bilinear evaluation of a grid at fractional (u = row, v = column): position + normal. */
export function gridAt(g: Grid, u: number, v: number, p = V3(), n = V3()): { p: THREE.Vector3; n: THREE.Vector3 } {
  const i0 = Math.max(0, Math.min(g.ni - 2, Math.floor(u)));
  const j0 = Math.max(0, Math.min(g.nj - 2, Math.floor(v)));
  const fu = clamp01(u - i0);
  const fv = clamp01(v - j0);
  const w = [(1 - fu) * (1 - fv), fu * (1 - fv), (1 - fu) * fv, fu * fv];
  const ids = [gi(g, i0, j0), gi(g, i0 + 1, j0), gi(g, i0, j0 + 1), gi(g, i0 + 1, j0 + 1)];
  p.set(0, 0, 0);
  n.set(0, 0, 0);
  for (let k = 0; k < 4; k++) {
    const o = ids[k];
    p.x += g.pos[o] * w[k];
    p.y += g.pos[o + 1] * w[k];
    p.z += g.pos[o + 2] * w[k];
    n.x += g.nrm[o] * w[k];
    n.y += g.nrm[o + 1] * w[k];
    n.z += g.nrm[o + 2] * w[k];
  }
  n.normalize();
  return { p, n };
}

/**
 * Indexed triangles over a ni x nj grid (+ optional extra fan triangles) → smooth normals → split into parts.
 * classify(i, j, centre) names each quad's part (null = drop). wantOut(centre, normal) says which way is outward for one probe quad.
 */
function gridBuild(
  pts: THREE.Vector3[][],
  classify: (i: number, j: number, c: THREE.Vector3) => string | null,
  fans: { c: THREE.Vector3; ring: [number, number][]; part: string; out: THREE.Vector3 }[],
  probe: { i: number; j: number; out: THREE.Vector3 },
): { grid: Grid; parts: Map<string, THREE.BufferGeometry> } {
  const ni = pts.length;
  const nj = pts[0].length;
  const nv = ni * nj + fans.length;
  const pos = new Float32Array(nv * 3);
  for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) pts[i][j].toArray(pos, (i * nj + j) * 3);
  fans.forEach((f, k) => f.c.toArray(pos, (ni * nj + k) * 3));
  const id = (i: number, j: number) => i * nj + j;
  // winding from the probe quad
  const a = pts[probe.i][probe.j];
  const b = pts[probe.i + 1][probe.j];
  const c = pts[probe.i][probe.j + 1];
  const fn = V3().subVectors(b, a).cross(V3().subVectors(c, a));
  const flip = fn.dot(probe.out) < 0;
  const tri = (arr: number[], x: number, y: number, z: number) => (flip ? arr.push(x, z, y) : arr.push(x, y, z));
  const all: number[] = [];
  const byPart = new Map<string, number[]>();
  const cen = V3();
  for (let i = 0; i < ni - 1; i++)
    for (let j = 0; j < nj - 1; j++) {
      cen.copy(pts[i][j]).add(pts[i + 1][j]).add(pts[i][j + 1]).add(pts[i + 1][j + 1]).multiplyScalar(0.25);
      const part = classify(i, j, cen);
      const q = [id(i, j), id(i + 1, j), id(i, j + 1), id(i + 1, j + 1)];
      tri(all, q[0], q[1], q[2]);
      tri(all, q[2], q[1], q[3]);
      if (part === null) continue;
      let arr = byPart.get(part);
      if (!arr) byPart.set(part, (arr = []));
      tri(arr, q[0], q[1], q[2]);
      tri(arr, q[2], q[1], q[3]);
    }
  const tmpA = V3();
  const tmpB = V3();
  fans.forEach((f, k) => {
    const ci = ni * nj + k;
    let arr = byPart.get(f.part);
    if (!arr) byPart.set(f.part, (arr = []));
    for (let r = 0; r < f.ring.length; r++) {
      const [i1, j1] = f.ring[r];
      const [i2, j2] = f.ring[(r + 1) % f.ring.length];
      const p1 = pts[i1][j1];
      const p2 = pts[i2][j2];
      tmpA.subVectors(p1, f.c).cross(tmpB.subVectors(p2, f.c));
      const ok = tmpA.dot(f.out) >= 0;
      const t = ok ? [ci, id(i1, j1), id(i2, j2)] : [ci, id(i2, j2), id(i1, j1)];
      all.push(...t);
      arr.push(...t);
    }
  });
  // smooth normals over everything (so split panels shade continuously)
  const full = new THREE.BufferGeometry();
  full.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  full.setIndex(all);
  full.computeVertexNormals();
  const nrm = (full.getAttribute('normal') as THREE.BufferAttribute).array as Float32Array;
  full.dispose();
  const parts = new Map<string, THREE.BufferGeometry>();
  byPart.forEach((idx, name) => parts.set(name, compact(pos, nrm, idx)));
  return { grid: { ni, nj, pos, nrm }, parts };
}

/** Sub-geometry with only the referenced vertices. */
export function compact(pos: Float32Array, nrm: Float32Array, idx: number[]): THREE.BufferGeometry {
  const map = new Map<number, number>();
  const p: number[] = [];
  const n: number[] = [];
  const out = idx.map((v) => {
    let k = map.get(v);
    if (k === undefined) {
      k = map.size;
      map.set(v, k);
      p.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      n.push(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
    }
    return k;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  g.setIndex(out);
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------- lower body loft
/** One cross-section of the lower body (half, z >= 0). */
export interface Sec {
  yB: number; // bottom edge of the side skin (rocker / bumper lower edge)
  tuck: number; // inward tuck at that edge
  yW: number; // height of max width
  w: number; // max half width
  yS: number; // shoulder (fender top / belt) corner height
  wS: number; // half width at the shoulder corner
  r: number; // shoulder fillet radius
  yT: number; // top centreline height (hood / deck)
}
export const secFrom = (a: number[]): Sec => ({ yB: a[0], tuck: a[1], yW: a[2], w: a[3], yS: a[4], wS: a[5], r: a[6], yT: a[7] });

/** Half-section sample indices (0 = inner flange ... HALF_N-1 = top centre). */
export const SEC = { flange: 0, bottom: 1, waist: 8, shoulderLo: 16, shoulder: 19, topEdge: 22, topMid: 27, centre: 32 };
const SEC_PER = [1, 3, 4, 4, 4, 3, 3, 5, 5];
export const HALF_N = 1 + SEC_PER.reduce((a, b) => a + b, 0); // 33

function halfSection(s: Sec, flange: number): P2[] {
  const { yB, tuck, yW, w, yS, wS, r, yT } = s;
  const zA = wS + (w - wS) * 0.1;
  const ctrl: P2[] = [
    [w - tuck - flange, yB + 0.004],
    [w - tuck, yB],
    [w - tuck * 0.22, lerp(yB, yW, 0.55)],
    [w, yW],
    [lerp(w, zA, 0.55), lerp(yW, yS - r, 0.55)],
    [zA, yS - r],
    [wS - r * 0.293, yS - r * 0.293],
    [wS - r, yS + (yT - yS) * 0.1],
    [wS * 0.45, lerp(yS, yT, 0.86)],
    [0, yT],
  ];
  return crSample(ctrl, SEC_PER);
}

export interface Wheel {
  x: number;
  y: number; // arch centre height
  r: number; // arch radius
}
export interface EndRound {
  rx: number; // length of the rounding zone
  rz: number; // plan-view inset at the cap
  ryT: number; // top drop at the cap
  ryB: number; // bottom rise at the cap
  yc: number; // centre height of the cap
  rake?: number; // dx/dy of the cap face (+ = top leans forward on the nose)
  K?: number;
}
export interface LoftOpts {
  x0: number; // rear-most x
  x1: number; // front-most x
  sec: (x: number) => Sec;
  wheels: Wheel[];
  front: EndRound;
  rear: EndRound;
  dx?: number;
  flange?: number;
  /** Feature shaping after the section: p is mutable; k = half index, side = ±1 (z sign), x0 = station x. */
  deform?: (p: THREE.Vector3, k: number, side: number, x: number) => void;
  /** Panel name per quad (null culls it): kk = half index of the quad's lower column, side, centre. */
  part?: (c: THREE.Vector3, kk: number, side: number) => string | null;
  capPart?: { front: string; rear: string };
}
export interface Loft {
  grid: Grid;
  parts: Map<string, THREE.BufferGeometry>;
  xs: number[];
  /** Fractional row for a given station x (monotone). */
  u: (x: number) => number;
  /** Column for half index k on a side (+1 left / -1 right). */
  col: (k: number, side: number) => number;
  at: (x: number, k: number, side: number) => { p: THREE.Vector3; n: THREE.Vector3 };
}

/** Arch top height at x for a wheel (or -Infinity). */
export function archY(ws: Wheel[], x: number): number {
  let y = -Infinity;
  for (const w of ws) {
    const d = x - w.x;
    if (Math.abs(d) < w.r) y = Math.max(y, w.y + Math.sqrt(w.r * w.r - d * d));
  }
  return y;
}

export function loftBody(o: LoftOpts): Loft {
  const dx = o.dx ?? 0.06;
  const fl = o.flange ?? 0.04;
  const Kf = o.front.K ?? 9;
  const Kr = o.rear.K ?? 8;
  const xa = o.x0 + o.rear.rx;
  const xb = o.x1 - o.front.rx;
  // station list: uniform + dense around arches + exact arch ends
  const xsSet: number[] = [];
  for (let x = xa; x < xb; x += dx) xsSet.push(x);
  xsSet.push(xb);
  for (const w of o.wheels) {
    for (let x = w.x - w.r - 0.06; x <= w.x + w.r + 0.06; x += dx * 0.5) xsSet.push(x);
    xsSet.push(w.x - w.r - 0.003, w.x - w.r + 0.003, w.x + w.r - 0.003, w.x + w.r + 0.003);
  }
  const main = [...new Set(xsSet.map((x) => Math.round(x * 1e4) / 1e4))].filter((x) => x >= xa && x <= xb).sort((a, b) => a - b);
  type St = { x: number; th: number; end: 0 | 1 | -1 };
  const st: St[] = [];
  // rear rounding stations run from the cap (k = Kr) toward xa
  for (let k = Kr; k >= 1; k--) {
    const th = ((k / Kr) * Math.PI) / 2;
    st.push({ x: xa - o.rear.rx * Math.sin(th), th, end: -1 });
  }
  for (const x of main) st.push({ x, th: 0, end: 0 });
  for (let k = 1; k <= Kf; k++) {
    const th = ((k / Kf) * Math.PI) / 2;
    st.push({ x: xb + o.front.rx * Math.sin(th), th, end: 1 });
  }
  const pts: THREE.Vector3[][] = [];
  const xsNom: number[] = [];
  for (const s of st) {
    const S = o.sec(s.x);
    const half = halfSection(S, fl);
    // wheel arch: slide side samples up to the arch line
    const ay = archY(o.wheels, s.x);
    if (ay > S.yB) {
      const side = half.slice(SEC.bottom, SEC.shoulderLo + 1);
      let zAt = side[side.length - 1][0];
      for (let k = 0; k < side.length - 1; k++) {
        if (side[k][1] <= ay && side[k + 1][1] >= ay) {
          const t = (ay - side[k][1]) / Math.max(1e-6, side[k + 1][1] - side[k][1]);
          zAt = lerp(side[k][0], side[k + 1][0], t);
          break;
        }
      }
      for (let k = SEC.bottom; k <= SEC.shoulderLo; k++) if (half[k][1] < ay) half[k] = [zAt, ay];
      if (half[SEC.flange][1] < ay) half[SEC.flange] = [zAt - fl, ay + 0.004];
    }
    // end rounding (plan + elevation) and rake
    let fz = 1;
    let fT = 1;
    let fB = 1;
    let rake = 0;
    let yc = 0;
    if (s.end !== 0) {
      const E = s.end > 0 ? o.front : o.rear;
      const c = 1 - Math.cos(s.th);
      yc = E.yc;
      fz = 1 - (c * E.rz) / S.w;
      fT = 1 - (c * E.ryT) / Math.max(0.05, S.yT - E.yc);
      fB = 1 - (c * E.ryB) / Math.max(0.05, E.yc - S.yB);
      rake = (E.rake ?? 0) * Math.sin(s.th) * s.end;
    }
    const row: THREE.Vector3[] = [];
    const mk = (zh: number, yh: number, side: number, k: number) => {
      let y = yh;
      if (s.end !== 0) y = y > yc ? yc + (y - yc) * fT : yc - (yc - y) * fB;
      const p = V3(s.x + rake * (y - yc), y, zh * fz * side);
      o.deform?.(p, k, side, s.x);
      return p;
    };
    for (let k = 0; k < HALF_N; k++) row.push(mk(half[k][0], half[k][1], -1, k));
    for (let k = HALF_N - 2; k >= 0; k--) row.push(mk(half[k][0], half[k][1], 1, k));
    pts.push(row);
    xsNom.push(s.x);
  }
  const nj = 2 * HALF_N - 1;
  const halfIdx = (j: number) => (j < HALF_N ? j : nj - 1 - j);
  const sideOf = (j: number) => (j < HALF_N - 1 ? -1 : 1);
  const ring: [number, number][] = [];
  const ringOf = (i: number): [number, number][] => Array.from({ length: nj }, (_, j) => [i, j] as [number, number]);
  ring.push(...ringOf(pts.length - 1));
  const capC = (i: number, E: EndRound) => {
    const r = pts[i];
    const c = V3();
    r.forEach((p) => c.add(p));
    c.multiplyScalar(1 / r.length);
    c.z = 0;
    void E;
    return c;
  };
  const fans = [
    { c: capC(pts.length - 1, o.front), ring: ringOf(pts.length - 1), part: o.capPart?.front ?? 'body', out: V3(1, 0, 0) },
    { c: capC(0, o.rear), ring: ringOf(0), part: o.capPart?.rear ?? 'body', out: V3(-1, 0, 0) },
  ];
  const mid = Math.floor(pts.length / 2);
  const { grid, parts } = gridBuild(
    pts,
    (i, j, c) => (o.part ? o.part(c, halfIdx(j < HALF_N - 1 ? j : j + 1), sideOf(j)) : 'body'),
    fans,
    { i: mid, j: HALF_N - 1, out: V3(0, 1, 0) },
  );
  const u = (x: number) => {
    if (x <= xsNom[0]) return 0;
    for (let i = 0; i < xsNom.length - 1; i++) if (x <= xsNom[i + 1]) return i + (x - xsNom[i]) / Math.max(1e-6, xsNom[i + 1] - xsNom[i]);
    return xsNom.length - 1;
  };
  const col = (k: number, side: number) => (side < 0 ? k : nj - 1 - k);
  return { grid, parts, xs: xsNom, u, col, at: (x, k, side) => gridAt(grid, u(x), col(k, side)) };
}

// ---------------------------------------------------------------- greenhouse
export interface GhOpts {
  x0: number;
  x1: number;
  dx?: number;
  belt: (x: number) => P2; // [y, halfWidth] at the glass base
  rail: (x: number) => P2; // [y, halfWidth] of the roof rail / A / C pillar line
  crown: (x: number) => number; // centreline height
  bulge?: number; // side-glass outward curvature
  rr?: number; // roof-edge radius
  deform?: (p: THREE.Vector3, kind: 'side' | 'top', f: number, side: number) => void;
  part: (c: THREE.Vector3, kind: 'side' | 'top', f: number, side: number) => string | null;
}
const GH_PER = [4, 4, 2, 2, 5, 5];
const GH_HALF = 1 + GH_PER.reduce((a, b) => a + b, 0); // 23
const GH_RAIL = 8; // half index of the rail corner
export interface Greenhouse {
  grid: Grid;
  parts: Map<string, THREE.BufferGeometry>;
  /** f in [0,1]: side = belt→rail, top = rail→centre. */
  at: (x: number, kind: 'side' | 'top', f: number, side: number) => { p: THREE.Vector3; n: THREE.Vector3 };
}
export function greenhouse(o: GhOpts): Greenhouse {
  const dx = o.dx ?? 0.04;
  const xs: number[] = [];
  for (let x = o.x0; x < o.x1; x += dx) xs.push(x);
  xs.push(o.x1);
  const rr = o.rr ?? 0.05;
  const bul = o.bulge ?? 0.02;
  const pts: THREE.Vector3[][] = [];
  const kindOf = (k: number): ['side' | 'top', number] => (k <= GH_RAIL ? ['side', k / GH_RAIL] : ['top', (k - GH_RAIL) / (GH_HALF - 1 - GH_RAIL)]);
  for (const x of xs) {
    const [yB, wB] = o.belt(x);
    const [yE0, wE] = o.rail(x);
    const yE = Math.max(yE0, yB);
    const yC = Math.max(o.crown(x), yE);
    const hS = yE - yB;
    const r = Math.min(rr, hS * 0.5 + 0.002, Math.max(0.004, (yC - yE) * 2 + 0.01));
    const ctrl: P2[] = [
      [wB, yB],
      [lerp(wB, wE, 0.5) + bul * Math.min(1, hS / 0.3), lerp(yB, yE, 0.5)],
      [wE + (wB - wE) * 0.05 * 0, yE - r],
      [wE - r * 0.3, yE - r * 0.3 + (yC - yE) * 0.05],
      [wE - r, yE + (yC - yE) * 0.14],
      [wE * 0.5, lerp(yE, yC, 0.82)],
      [0, yC],
    ];
    const half = crSample(ctrl, GH_PER);
    const row: THREE.Vector3[] = [];
    const mk = (pp: P2, k: number, side: number) => {
      const p = V3(x, pp[1], pp[0] * side);
      const [kind, f] = kindOf(k);
      o.deform?.(p, kind, f, side);
      return p;
    };
    for (let k = 0; k < GH_HALF; k++) row.push(mk(half[k], k, -1));
    for (let k = GH_HALF - 2; k >= 0; k--) row.push(mk(half[k], k, 1));
    pts.push(row);
  }
  const nj = 2 * GH_HALF - 1;
  const mid = Math.floor(pts.length / 2);
  const { grid, parts } = gridBuild(
    pts,
    (i, j, c) => {
      const side = j < GH_HALF - 1 ? -1 : 1;
      const k = j < GH_HALF - 1 ? j + 0.5 : nj - 1 - (j + 0.5);
      const [kind, f] = kindOf(k);
      return o.part(c, kind, f, side);
    },
    [],
    { i: mid, j: GH_HALF - 1, out: V3(0, 1, 0) },
  );
  const u = (x: number) => clamp01((x - o.x0) / (o.x1 - o.x0)) * (xs.length - 1);
  const at = (x: number, kind: 'side' | 'top', f: number, side: number) => {
    const k = kind === 'side' ? f * GH_RAIL : GH_RAIL + f * (GH_HALF - 1 - GH_RAIL);
    return gridAt(grid, u(x), side < 0 ? k : nj - 1 - k);
  };
  return { grid, parts, at };
}

// ---------------------------------------------------------------- projection onto surfaces
export type Axis = 'x' | '-x' | 'y' | '-y' | 'z' | '-z';
/** Rays along an axis against a set of geometries (body-local). hit(a, b) returns the outermost surface point. */
export class Projector {
  private tri: number[][] = []; // [a0,b0,d0, a1,b1,d1, a2,b2,d2, n0x..n2z]
  private cells = new Map<number, number[]>();
  constructor(geos: THREE.BufferGeometry[], public axis: Axis, private cell = 0.05) {
    const map = this.map;
    for (const g of geos) {
      const P = g.getAttribute('position');
      const N = g.getAttribute('normal');
      const I = g.getIndex();
      const n = I ? I.count : P.count;
      for (let t = 0; t < n; t += 3) {
        const rec: number[] = [];
        const nr: number[] = [];
        for (let v = 0; v < 3; v++) {
          const vi = I ? I.getX(t + v) : t + v;
          const [a, b, d] = map(P.getX(vi), P.getY(vi), P.getZ(vi));
          rec.push(a, b, d);
          nr.push(N ? N.getX(vi) : 0, N ? N.getY(vi) : 1, N ? N.getZ(vi) : 0);
        }
        const id = this.tri.length;
        this.tri.push([...rec, ...nr]);
        const a0 = Math.floor(Math.min(rec[0], rec[3], rec[6]) / cell);
        const a1 = Math.floor(Math.max(rec[0], rec[3], rec[6]) / cell);
        const b0 = Math.floor(Math.min(rec[1], rec[4], rec[7]) / cell);
        const b1 = Math.floor(Math.max(rec[1], rec[4], rec[7]) / cell);
        for (let a = a0; a <= a1; a++)
          for (let b = b0; b <= b1; b++) {
            const key = a * 100003 + b;
            let arr = this.cells.get(key);
            if (!arr) this.cells.set(key, (arr = []));
            arr.push(id);
          }
      }
    }
  }
  private map = (x: number, y: number, z: number): [number, number, number] => {
    switch (this.axis) {
      case 'x': return [z, y, x];
      case '-x': return [z, y, -x];
      case 'y': return [x, z, y];
      case '-y': return [x, z, -y];
      case 'z': return [x, y, z];
      default: return [x, y, -z];
    }
  };
  private unmap(a: number, b: number, d: number, out: THREE.Vector3) {
    switch (this.axis) {
      case 'x': return out.set(d, b, a);
      case '-x': return out.set(-d, b, a);
      case 'y': return out.set(a, d, b);
      case '-y': return out.set(a, -d, b);
      case 'z': return out.set(a, b, d);
      default: return out.set(a, b, -d);
    }
  }
  hit(a: number, b: number): { p: THREE.Vector3; n: THREE.Vector3 } | null {
    const arr = this.cells.get(Math.floor(a / this.cell) * 100003 + Math.floor(b / this.cell));
    if (!arr) return null;
    let best = -Infinity;
    let bt: number[] | null = null;
    let bw: number[] = [];
    for (const id of arr) {
      const t = this.tri[id];
      const det = (t[4] - t[7]) * (t[0] - t[6]) + (t[6] - t[3]) * (t[1] - t[7]);
      if (Math.abs(det) < 1e-12) continue;
      const w0 = ((t[4] - t[7]) * (a - t[6]) + (t[6] - t[3]) * (b - t[7])) / det;
      const w1 = ((t[7] - t[1]) * (a - t[6]) + (t[0] - t[6]) * (b - t[7])) / det;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const d = w0 * t[2] + w1 * t[5] + w2 * t[8];
      if (d > best) {
        best = d;
        bt = t;
        bw = [w0, w1, w2];
      }
    }
    if (!bt) return null;
    const p = this.unmap(a, b, best, V3());
    const n = V3(
      bw[0] * bt[9] + bw[1] * bt[12] + bw[2] * bt[15],
      bw[0] * bt[10] + bw[1] * bt[13] + bw[2] * bt[16],
      bw[0] * bt[11] + bw[1] * bt[14] + bw[2] * bt[17],
    ).normalize();
    return { p, n };
  }
}

function clipRect(poly: P2[], a0: number, a1: number, b0: number, b1: number): P2[] {
  let out = poly;
  const edges: [(p: P2) => boolean, (p: P2, q: P2) => P2][] = [
    [(p) => p[0] >= a0, (p, q) => { const t = (a0 - p[0]) / (q[0] - p[0]); return [a0, lerp(p[1], q[1], t)]; }],
    [(p) => p[0] <= a1, (p, q) => { const t = (a1 - p[0]) / (q[0] - p[0]); return [a1, lerp(p[1], q[1], t)]; }],
    [(p) => p[1] >= b0, (p, q) => { const t = (b0 - p[1]) / (q[1] - p[1]); return [lerp(p[0], q[0], t), b0]; }],
    [(p) => p[1] <= b1, (p, q) => { const t = (b1 - p[1]) / (q[1] - p[1]); return [lerp(p[0], q[0], t), b1]; }],
  ];
  for (const [inside, cut] of edges) {
    const inp = out;
    out = [];
    for (let i = 0; i < inp.length; i++) {
      const cur = inp[i];
      const prev = inp[(i + inp.length - 1) % inp.length];
      const ci = inside(cur);
      const pi = inside(prev);
      if (ci) {
        if (!pi) out.push(cut(prev, cur));
        out.push(cur);
      } else if (pi) out.push(cut(prev, cur));
    }
    if (!out.length) break;
  }
  return out;
}

export interface PatchOpts {
  off?: number; // offset along the surface normal
  res?: number; // grid cell size of the triangulation
  /** Extra displacement (along normal) as a function of the 2D coords: domes, recesses. */
  bump?: (a: number, b: number) => number;
  /** UV: 'box' = 0..1 over the outline bbox (default). */
  uvScale?: number;
}
/** A conformal patch: 2D outline (in the projector's a/b plane) triangulated on a grid and projected onto the surface. */
export function patch(pr: Projector, outline: P2[], o: PatchOpts = {}): THREE.BufferGeometry {
  const res = o.res ?? 0.025;
  const off = o.off ?? 0.002;
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const [a, b] of outline) {
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
  }
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const cache = new Map<string, { p: THREE.Vector3; n: THREE.Vector3 } | null>();
  const proj = (a: number, b: number) => {
    const key = `${a.toFixed(5)},${b.toFixed(5)}`;
    if (cache.has(key)) return cache.get(key)!;
    const h = pr.hit(a, b);
    if (h) h.p.addScaledVector(h.n, off + (o.bump ? o.bump(a, b) : 0));
    cache.set(key, h);
    return h;
  };
  const fn = V3();
  const e1 = V3();
  const e2 = V3();
  for (let a = a0; a < a1; a += res)
    for (let b = b0; b < b1; b += res) {
      const poly = clipRect(outline, a, Math.min(a + res, a1), b, Math.min(b + res, b1));
      if (poly.length < 3) continue;
      const hs = poly.map(([x, y]) => proj(x, y));
      for (let k = 1; k < poly.length - 1; k++) {
        const tri = [0, k, k + 1];
        if (tri.some((t) => !hs[t])) continue;
        const [A, B, C] = tri.map((t) => hs[t]!);
        fn.crossVectors(e1.subVectors(B.p, A.p), e2.subVectors(C.p, A.p));
        if (fn.lengthSq() < 1e-14) continue;
        const order = fn.dot(V3().add(A.n).add(B.n).add(C.n)) < 0 ? [0, 2, 1] : [0, 1, 2];
        for (const oi of order) {
          const t = tri[oi];
          const h = hs[t]!;
          pos.push(h.p.x, h.p.y, h.p.z);
          nrm.push(h.n.x, h.n.y, h.n.z);
          const [pa, pb] = poly[t];
          if (o.uvScale) uv.push(pa / o.uvScale, pb / o.uvScale);
          else uv.push((pa - a0) / Math.max(1e-6, a1 - a0), (pb - b0) / Math.max(1e-6, b1 - b0));
        }
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (o.bump) g.computeVertexNormals();
  return g;
}

/** A wall strip along a closed outline, from offset o0 to o1 along the surface normal (lamp gaskets, recess walls). */
export function patchWall(pr: Projector, outline: P2[], o0: number, o1: number, step = 0.01): THREE.BufferGeometry {
  const pts = resample([...outline, outline[0]], step);
  const pos: number[] = [];
  for (const [a, b] of pts) {
    const h = pr.hit(a, b);
    if (!h) continue;
    const p0 = h.p.clone().addScaledVector(h.n, o0);
    const p1 = h.p.clone().addScaledVector(h.n, o1);
    pos.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
  }
  const n = pos.length / 6;
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) idx.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Ribbon through surface points (shut lines, pinstripes). pts carry their surface normals. */
export function ribbon(pts: { p: THREE.Vector3; n: THREE.Vector3 }[], width: number, off = 0.0015): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const t = V3();
  const s = V3();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)].p;
    const b = pts[Math.min(pts.length - 1, i + 1)].p;
    t.subVectors(b, a).normalize();
    const { p, n } = pts[i];
    s.crossVectors(n, t).normalize().multiplyScalar(width / 2);
    const c = p.clone().addScaledVector(n, off);
    pos.push(c.x + s.x, c.y + s.y, c.z + s.z, c.x - s.x, c.y - s.y, c.z - s.z);
    nrm.push(n.x, n.y, n.z, n.x, n.y, n.z);
  }
  const idx: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}
/** Shut line projected along an axis through a 2D polyline. */
export function projLine(pr: Projector, line: P2[], width = 0.0045, off = 0.0015, step = 0.01): THREE.BufferGeometry {
  const hs = resample(line, step).map(([a, b]) => pr.hit(a, b)).filter((h): h is { p: THREE.Vector3; n: THREE.Vector3 } => !!h);
  return ribbon(hs, width, off);
}

// ---------------------------------------------------------------- sweeps
export interface SweepOpts {
  up?: THREE.Vector3;
  closed?: boolean; // profile is a closed loop
  caps?: boolean;
  scale?: (t: number) => number;
}
/** Sweep a 2D profile (px = side, py = up in the path frame) along a 3D path. */
export function sweep(path: THREE.Vector3[], prof: P2[], o: SweepOpts = {}): THREE.BufferGeometry {
  const up0 = o.up ?? V3(0, 1, 0);
  const closed = o.closed ?? true;
  const np = prof.length;
  const pos: number[] = [];
  const T = V3();
  const S = V3();
  const U = V3();
  for (let i = 0; i < path.length; i++) {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    T.subVectors(b, a).normalize();
    let up = up0;
    if (Math.abs(T.dot(up)) > 0.95) up = Math.abs(T.y) > 0.9 ? V3(1, 0, 0) : V3(0, 1, 0);
    S.crossVectors(T, up).normalize();
    U.crossVectors(S, T).normalize();
    const sc = o.scale ? o.scale(i / (path.length - 1)) : 1;
    for (const [px, py] of prof) {
      const p = path[i];
      pos.push(p.x + (S.x * px + U.x * py) * sc, p.y + (S.y * px + U.y * py) * sc, p.z + (S.z * px + U.z * py) * sc);
    }
  }
  const idx: number[] = [];
  const nc = closed ? np : np - 1;
  for (let i = 0; i < path.length - 1; i++)
    for (let j = 0; j < nc; j++) {
      const a = i * np + j;
      const b = i * np + ((j + 1) % np);
      const c = (i + 1) * np + j;
      const d = (i + 1) * np + ((j + 1) % np);
      idx.push(a, c, b, b, c, d);
    }
  if (o.caps) {
    for (const [i, flip] of [[0, true], [path.length - 1, false]] as [number, boolean][]) {
      const ci = pos.length / 3;
      const p = path[i];
      pos.push(p.x, p.y, p.z);
      for (let j = 0; j < np; j++) {
        const a = i * np + j;
        const b = i * np + ((j + 1) % np);
        if (flip) idx.push(ci, b, a);
        else idx.push(ci, a, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // outward check on the first quad: flip if the normal points at the path
  const nA = g.getAttribute('normal');
  const pA = g.getAttribute('position');
  const probe = np > 2 ? Math.floor(np / 4) : 0;
  const pv = V3(pA.getX(probe), pA.getY(probe), pA.getZ(probe));
  const nv = V3(nA.getX(probe), nA.getY(probe), nA.getZ(probe));
  if (closed && nv.dot(pv.sub(path[0])) < 0) {
    const ix = g.getIndex()!.array as Uint16Array | Uint32Array;
    for (let k = 0; k < ix.length; k += 3) {
      const t = ix[k + 1];
      ix[k + 1] = ix[k + 2];
      ix[k + 2] = t;
    }
    g.computeVertexNormals();
  }
  return g;
}
export const circle = (r: number, n = 10): P2[] => Array.from({ length: n }, (_, i) => [Math.cos((i / n) * Math.PI * 2) * r, Math.sin((i / n) * Math.PI * 2) * r] as P2);
/** Rounded rectangle profile (w x h) for sweeps. */
export const rrect = (w: number, h: number, r: number, n = 3): P2[] => superEllipse(0, 0, w / 2, h / 2, Math.max(2.2, 2 + (Math.min(w, h) / Math.max(1e-3, r)) * 0.8), 8 + n * 4);
export const tube = (path: THREE.Vector3[], r: number, n = 8) => sweep(path, circle(r, n), { caps: true });
/** Smooth 3D path through control points (Catmull-Rom). */
export function path3(pts: THREE.Vector3[], n = 40): THREE.Vector3[] {
  return new THREE.CatmullRomCurve3(pts, false, 'centripetal').getPoints(n);
}

// ---------------------------------------------------------------- parts
export function mesh(g: THREE.BufferGeometry, m: THREE.Material, name = ''): THREE.Mesh {
  const me = new THREE.Mesh(g, m);
  me.name = name;
  me.castShadow = true;
  me.receiveShadow = true;
  return me;
}
/** Add a mesh and its z-mirror (scale.z = -1). */
export function addPair(parent: THREE.Object3D, me: THREE.Mesh): [THREE.Mesh, THREE.Mesh] {
  const mi = me.clone();
  mi.scale.z *= -1;
  mi.position.z *= -1;
  mi.rotation.x *= -1;
  mi.rotation.y *= -1;
  parent.add(me, mi);
  return [me, mi];
}
export const rbox = (w: number, h: number, d: number, r: number, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) * 0.999);

/** Wheel-well liner: an arch tube (inner side visible) plus an inner wall, for a wheel at (x, y), z from zi (inner) to zo (outer). */
export function wellLiner(x: number, y: number, r: number, zi: number, zo: number, m: THREE.Material): THREE.Mesh[] {
  const a0 = -0.32;
  const a1 = Math.PI + 0.32;
  const n = 28;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = lerp(a0, a1, i / n);
    const c = Math.cos(t) * r;
    const s = Math.sin(t) * r;
    pos.push(x + c, y + s, zi, x + c, y + s, zo);
  }
  for (let i = 0; i < n; i++) idx.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // inner wall: a disc segment at zi
  const w = new THREE.CircleGeometry(r, 28, a0, a1 - a0);
  w.translate(x, y, zi);
  return [mesh(g, m, 'well'), mesh(w, m, 'wellWall')];
}

/** Door mirror: stalk + aero pod (paint) + glass, at base point (z>0 side), pod reaching outward. */
export function doorMirror(M: Mats, base: THREE.Vector3, o: { len?: number; h?: number; reach?: number; tilt?: number } = {}): THREE.Group {
  const g = new THREE.Group();
  const len = o.len ?? 0.21;
  const h = o.h ?? 0.12;
  const reach = o.reach ?? 0.17;
  const pod = rbox(0.1, h, len, 0.04, 4);
  // taper the pod toward the car (inner end narrower) and sweep its trailing face
  const P = pod.getAttribute('position');
  for (let i = 0; i < P.count; i++) {
    const z = P.getZ(i);
    const k = 0.75 + 0.25 * (z / len + 0.5);
    P.setXYZ(i, P.getX(i) * k + (P.getX(i) > 0 ? 0.03 * (z / len + 0.5) : 0), P.getY(i) * k, z);
  }
  pod.computeVertexNormals();
  const podM = mesh(pod, M.paint, 'mirror');
  podM.position.set(base.x - 0.03, base.y + 0.06, base.z + reach - len * 0.15);
  podM.rotation.y = o.tilt ?? 0.08;
  const glass = mesh(new THREE.PlaneGeometry(len * 0.85, h * 0.78), M.chrome, 'mirrorGlass');
  glass.rotation.y = -Math.PI / 2;
  glass.position.set(-0.052, 0, 0);
  podM.add(glass);
  const stalk = mesh(rbox(0.07, 0.035, reach + 0.02, 0.012), M.trim, 'mirrorStalk');
  stalk.position.set(base.x, base.y + 0.02, base.z + reach * 0.45);
  stalk.rotation.x = -0.15;
  g.add(podM, stalk);
  return g;
}

/** Interior: tub (floor + inner door panels), dash, seats, steering wheel, console. LHD: driver on -z (+z is the car's right). */
export function interior(M: Mats, o: {
  xDash: number; // dash front edge (under the windshield)
  xSeat: number; // seat H-point x
  floorY: number;
  beltY: number;
  halfW: number; // inner half width at the belt
  xRearWall: number;
  rearSeats?: boolean;
}): THREE.Group {
  const g = new THREE.Group();
  const { xDash, xSeat, floorY, beltY, halfW, xRearWall } = o;
  const len = xDash - xRearWall + 0.2;
  const floor = mesh(new THREE.BoxGeometry(len, 0.02, halfW * 2), M.carpet, 'floor');
  floor.position.set((xDash + xRearWall) / 2, floorY, 0);
  g.add(floor);
  for (const s of [1, -1]) {
    const door = mesh(new THREE.BoxGeometry(len, beltY - floorY, 0.03), M.dash, 'doorCard');
    door.position.set((xDash + xRearWall) / 2, (beltY + floorY) / 2, s * (halfW - 0.015));
    g.add(door);
  }
  const back = mesh(new THREE.BoxGeometry(0.03, beltY - floorY + 0.05, halfW * 2), M.carpet, 'rearWall');
  back.position.set(xRearWall, (beltY + floorY) / 2, 0);
  g.add(back);
  // dash: a rounded slab under the windshield with a binnacle
  const dash = mesh(rbox(0.5, 0.2, halfW * 2 - 0.04, 0.06), M.dash, 'dash');
  dash.position.set(xDash - 0.2, beltY - 0.06, 0);
  g.add(dash);
  const binn = mesh(rbox(0.16, 0.08, 0.38, 0.035), M.dash, 'binnacle');
  binn.position.set(xDash - 0.4, beltY + 0.04, -0.37);
  g.add(binn);
  const cluster = mesh(new THREE.PlaneGeometry(0.3, 0.07), M.drl, 'cluster');
  cluster.rotation.y = -Math.PI / 2;
  cluster.position.set(xDash - 0.485, beltY + 0.02, -0.37);
  cluster.scale.set(1, 0.6, 1);
  g.add(cluster);
  const console_ = mesh(rbox(0.9, 0.22, 0.2, 0.05), M.dash, 'console');
  console_.position.set(xSeat + 0.15, floorY + 0.14, 0);
  g.add(console_);
  // seats (buckets)
  const seat = (x: number, z: number, scale = 1) => {
    const sg = new THREE.Group();
    const cushion = mesh(rbox(0.5, 0.12, 0.5, 0.05), M.seat, 'seat');
    cushion.position.set(0, 0.06, 0);
    const back = mesh(rbox(0.12, 0.62, 0.5, 0.05), M.seat, 'seatBack');
    back.position.set(-0.27, 0.36, 0);
    back.rotation.z = 0.22;
    const bol = mesh(rbox(0.14, 0.5, 0.08, 0.035), M.seat, 'bolster');
    bol.position.set(-0.23, 0.33, 0.23);
    bol.rotation.z = 0.22;
    const bol2 = bol.clone();
    bol2.position.z = -0.23;
    const head = mesh(rbox(0.1, 0.16, 0.26, 0.04), M.seat, 'headrest');
    head.position.set(-0.4, 0.74, 0);
    head.rotation.z = 0.22;
    sg.add(cushion, back, bol, bol2, head);
    sg.position.set(x, floorY + 0.08, z);
    sg.scale.setScalar(scale);
    return sg;
  };
  g.add(seat(xSeat, 0.37), seat(xSeat, -0.37));
  if (o.rearSeats) {
    const bench = mesh(rbox(0.45, 0.14, halfW * 1.6, 0.06), M.seat, 'rearSeat');
    bench.position.set(xRearWall + 0.35, floorY + 0.15, 0);
    const bb = mesh(rbox(0.12, 0.5, halfW * 1.6, 0.05), M.seat, 'rearBack');
    bb.position.set(xRearWall + 0.12, floorY + 0.42, 0);
    bb.rotation.z = 0.35;
    g.add(bench, bb);
  }
  // steering wheel
  const sw = new THREE.Group();
  const rim = mesh(new THREE.TorusGeometry(0.18, 0.018, 10, 32), M.wheel, 'steering');
  const hub = mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.05, 16), M.wheel, 'hub');
  hub.rotation.z = Math.PI / 2;
  for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
    const sp = mesh(new THREE.BoxGeometry(0.02, 0.16, 0.03), M.wheel, 'spoke');
    sp.position.set(0, -Math.cos(a) * 0.09, Math.sin(a) * 0.09);
    sp.rotation.x = a;
    sw.add(sp);
  }
  rim.rotation.y = Math.PI / 2;
  sw.add(rim, hub);
  sw.position.set(xDash - 0.55, beltY - 0.02, -0.37);
  sw.rotation.z = -0.42;
  const col = mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.3, 10), M.dash, 'column');
  col.rotation.z = Math.PI / 2 - 0.42;
  col.position.set(xDash - 0.42, beltY - 0.08, -0.37);
  g.add(sw, col);
  return g;
}

/** Simple underbody tray. */
export function underbody(M: Mats, x0: number, x1: number, halfW: number, y: number): THREE.Mesh {
  const u = mesh(new THREE.BoxGeometry(x1 - x0, 0.04, halfW * 2), M.liner, 'underbody');
  u.position.set((x0 + x1) / 2, y, 0);
  return u;
}

/** Lamp: housing patch + inner emissive/reflector shapes + lens shell with gasket wall. Returns the meshes. */
export function lamp(
  pr: Projector,
  M: Mats,
  outline: P2[],
  o: { lens?: THREE.Material; housing?: THREE.Material; depth?: number; inner?: { outline: P2[]; mat: THREE.Material; off?: number }[] },
): THREE.Mesh[] {
  const depth = o.depth ?? 0.008;
  const out: THREE.Mesh[] = [];
  out.push(mesh(patch(pr, outline, { off: 0.0015, res: 0.022 }), o.housing ?? M.housing, 'lampHousing'));
  for (const it of o.inner ?? []) out.push(mesh(patch(pr, it.outline, { off: it.off ?? 0.004, res: 0.014 }), it.mat, 'lampInner'));
  out.push(mesh(patch(pr, outline, { off: depth, res: 0.022 }), o.lens ?? M.lensClear, 'lampLens'));
  out.push(mesh(patchWall(pr, outline, 0.0005, depth), M.trim, 'lampGasket'));
  return out;
}

/**
 * Merge static meshes by material (fewer draw calls). keep: meshes that must stay separate (hood, switchable lights).
 * Paint panels merge into one 'body' mesh; returns the new paintMeshes list.
 */
export function mergeByMaterial(body: THREE.Group, paint: THREE.Mesh[], keep: THREE.Mesh[]): THREE.Mesh[] {
  body.updateMatrixWorld(true);
  const inv = body.matrixWorld.clone().invert();
  const keepSet = new Set(keep);
  const paintSet = new Set(paint);
  const groups = new Map<THREE.Material, THREE.Mesh[]>();
  body.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || keepSet.has(m) || Array.isArray(m.material)) return;
    let arr = groups.get(m.material);
    if (!arr) groups.set(m.material, (arr = []));
    arr.push(m);
  });
  const newPaint = paint.filter((m) => keepSet.has(m));
  const mtx = new THREE.Matrix4();
  for (const [mat, list] of groups) {
    const isPaint = list.some((m) => paintSet.has(m));
    if (list.length < 2) {
      if (isPaint) newPaint.push(list[0]);
      continue;
    }
    const wantUv = list.some((m) => !!m.geometry.getAttribute('uv'));
    const geos = list.map((m) => {
      mtx.multiplyMatrices(inv, m.matrixWorld);
      const g = new THREE.BufferGeometry();
      const src = m.geometry;
      g.setAttribute('position', src.getAttribute('position').clone());
      if (!src.getAttribute('normal')) src.computeVertexNormals();
      g.setAttribute('normal', src.getAttribute('normal').clone());
      const n = src.getAttribute('position').count;
      if (wantUv) g.setAttribute('uv', src.getAttribute('uv')?.clone() ?? new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
      const idx = src.index ? Array.from(src.index.array as ArrayLike<number>) : Array.from({ length: n }, (_, i) => i);
      if (mtx.determinant() < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
      g.setIndex(idx);
      g.applyMatrix4(mtx);
      return g;
    });
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    merged.computeBoundingSphere();
    const out = mesh(merged, mat, isPaint ? 'body' : list[0].name);
    body.add(out);
    for (const m of list) {
      m.removeFromParent();
      m.geometry.dispose();
    }
    if (isPaint) newPaint.push(out);
  }
  return newPaint;
}

export function countTris(o: THREE.Object3D): number {
  let n = 0;
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    n += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return n;
}
