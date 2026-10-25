// Cars A modeling toolkit (compact, sedan, hatch, truck). Bodies are lofted from cross-sections that are functions of x
// (a lower shell: bumpers, fenders, doors, hood, deck; and a greenhouse: glass band, pillars, roof, windshield,
// backlight). Every detail (lights, grilles, shut lines, trim, badges) is laid conformally onto those panels by casting
// rays at the loft grids, so parts hug the real surface instead of floating as boxes. Car faces +X, +Z = the car's RIGHT,
// y up; left-hand drive, so the driver sits on -Z.
import * as THREE from 'three';
import { chrome, glass, interior, lens, lightMaterial, paintMaterial, plastic, blackChrome, rubber, brushedMetal } from '../../materials';
import type { BodyBuild, CarSpec } from '../../types';

export type V2 = [number, number];
export type V3 = [number, number, number];

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** 1 inside [a, b], smooth ramps of width r on both sides. */
export const band = (a: number, b: number, x: number, r = 0.06) => sstep(a - r, a + r, x) * (1 - sstep(b - r, b + r, x));

/** Monotone cubic (PCHIP) through [x, y] keys; flat outside the key range. */
export function curve(keys: V2[]): (x: number) => number {
  const n = keys.length;
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  const h: number[] = [];
  const d: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    h.push(xs[k + 1] - xs[k]);
    d.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]));
  }
  const m = new Array(n).fill(0);
  if (n > 1) {
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for (let k = 1; k < n - 1; k++) {
      if (d[k - 1] * d[k] <= 0) m[k] = 0;
      else {
        const w1 = 2 * h[k] + h[k - 1];
        const w2 = h[k] + 2 * h[k - 1];
        m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k]);
      }
    }
  }
  return (x: number) => {
    if (n === 1 || x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    const hh = h[lo];
    const t = (x - xs[lo]) / hh;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * hh * m[lo] + (-2 * t3 + 3 * t2) * ys[lo + 1] + (t3 - t2) * hh * m[lo + 1];
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Centripetal Catmull-Rom sampling (open paths with per-segment step counts, closed outlines)

function crPoint(p0: number[], p1: number[], p2: number[], p3: number[], t: number, out: number[]) {
  const dim = p1.length;
  const d = (a: number[], b: number[]) => {
    let s = 0;
    for (let k = 0; k < dim; k++) s += (a[k] - b[k]) ** 2;
    return Math.max(Math.sqrt(Math.sqrt(s)), 1e-5);
  };
  const t0 = 0;
  const t1 = t0 + d(p0, p1);
  const t2 = t1 + d(p1, p2);
  const t3 = t2 + d(p2, p3);
  const u = t1 + (t2 - t1) * t;
  for (let k = 0; k < dim; k++) {
    const a1 = ((t1 - u) / (t1 - t0)) * p0[k] + ((u - t0) / (t1 - t0)) * p1[k];
    const a2 = ((t2 - u) / (t2 - t1)) * p1[k] + ((u - t1) / (t2 - t1)) * p2[k];
    const a3 = ((t3 - u) / (t3 - t2)) * p2[k] + ((u - t2) / (t3 - t2)) * p3[k];
    const b1 = ((t2 - u) / (t2 - t0)) * a1 + ((u - t0) / (t2 - t0)) * a2;
    const b2 = ((t3 - u) / (t3 - t1)) * a2 + ((u - t1) / (t3 - t1)) * a3;
    out[k] = ((t2 - u) / (t2 - t1)) * b1 + ((u - t1) / (t2 - t1)) * b2;
  }
}

/** Open CR path through keys; segment k gets counts[k] steps (a number = same for all). Includes both ends. */
export function crPath<T extends number[]>(keys: T[], counts: number[] | number): T[] {
  const out: T[] = [keys[0].slice() as T];
  const n = keys.length;
  const ext = (a: number[], b: number[]) => a.map((v, k) => 2 * v - b[k]);
  for (let s = 0; s < n - 1; s++) {
    const p0 = s > 0 ? keys[s - 1] : ext(keys[0], keys[1]);
    const p3 = s + 2 < n ? keys[s + 2] : ext(keys[n - 1], keys[n - 2]);
    const c = typeof counts === 'number' ? counts : counts[s];
    for (let i = 1; i <= c; i++) {
      const o = new Array(keys[0].length).fill(0);
      crPoint(p0, keys[s], keys[s + 1], p3, i / c, o);
      out.push(o as T);
    }
  }
  return out;
}

/** Closed CR outline through keys, n points total. */
export function crLoop(keys: V2[], n: number): V2[] {
  const out: V2[] = [];
  const m = keys.length;
  for (let i = 0; i < n; i++) {
    const f = (i / n) * m;
    const s = Math.floor(f);
    const o = [0, 0];
    crPoint(keys[(s - 1 + m) % m], keys[s % m], keys[(s + 1) % m], keys[(s + 2) % m], f - s, o);
    out.push([o[0], o[1]]);
  }
  return out;
}

export function ellipse(cx: number, cy: number, rx: number, ry: number, n = 32, rot = 0): V2[] {
  const out: V2[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    out.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  return out;
}

/** Rounded rectangle outline (corner radius r), centred. */
export function rrect(cx: number, cy: number, w: number, h: number, r: number, n = 40): V2[] {
  r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4);
  const dense: V2[] = [];
  const cs: V2[] = [[cx + w / 2 - r, cy + h / 2 - r], [cx - w / 2 + r, cy + h / 2 - r], [cx - w / 2 + r, cy - h / 2 + r], [cx + w / 2 - r, cy - h / 2 + r]];
  for (let c = 0; c < 4; c++)
    for (let i = 0; i <= 8; i++) {
      const a = ((c + i / 8) * Math.PI) / 2;
      dense.push([cs[c][0] + Math.cos(a) * r, cs[c][1] + Math.sin(a) * r]);
    }
  dense.push(dense[0]);
  // even spacing along the perimeter so long straight edges get points too (no sinking chords)
  return resample(dense, n + 1).slice(0, n);
}

// ---------------------------------------------------------------------------------------------------------------
// Loft grid: rows[i][j] (i = station along x, j = along the half cross-section from the bottom to the centreline).
// Normals by central differences so sub-range meshes (glass band, roof, hood) shade continuously with their neighbours.

export interface Hit { p: THREE.Vector3; n: THREE.Vector3 }

export class Grid {
  readonly ni: number;
  readonly nj: number;
  readonly P: Float32Array;
  readonly N: Float32Array;
  private bmin: Float32Array;
  private bmax: Float32Array;
  private bb: Float32Array;
  private cb: Float32Array;
  constructor(rows: V3[][], readonly mirror = true) {
    const ni = (this.ni = rows.length);
    const nj = (this.nj = rows[0].length);
    const P = (this.P = new Float32Array(ni * nj * 3));
    rows.forEach((r, i) => r.forEach((p, j) => P.set(p, (i * nj + j) * 3)));
    const N = (this.N = new Float32Array(ni * nj * 3));
    const g = (i: number, j: number, k: number) => P[(i * nj + j) * 3 + k];
    const bad: number[] = [];
    for (let i = 0; i < ni; i++)
      for (let j = 0; j < nj; j++) {
        const ip = Math.min(i + 1, ni - 1);
        const im = Math.max(i - 1, 0);
        const jp = Math.min(j + 1, nj - 1);
        const jm = Math.max(j - 1, 0);
        const du = [0, 1, 2].map((k) => g(ip, j, k) - g(im, j, k));
        const dv = [0, 1, 2].map((k) => g(i, jp, k) - g(i, jm, k));
        let nx = du[1] * dv[2] - du[2] * dv[1];
        let ny = du[2] * dv[0] - du[0] * dv[2];
        let nz = du[0] * dv[1] - du[1] * dv[0];
        const l = Math.hypot(nx, ny, nz);
        const o = (i * nj + j) * 3;
        if (l < 1e-10) {
          bad.push(i, j);
          continue;
        }
        nx /= l;
        ny /= l;
        nz /= l;
        if (mirror && Math.abs(g(i, j, 2)) < 1e-4) {
          nz = 0;
          const l2 = Math.hypot(nx, ny) || 1;
          nx /= l2;
          ny /= l2;
        }
        N[o] = nx;
        N[o + 1] = ny;
        N[o + 2] = nz;
      }
    // degenerate spots (collapsed sections) borrow the nearest valid normal along the section or the station
    for (let pass = 0; pass < 4 && bad.length; pass++) {
      const still: number[] = [];
      for (let b = 0; b < bad.length; b += 2) {
        const i = bad[b];
        const j = bad[b + 1];
        const o = (i * nj + j) * 3;
        let done = false;
        for (const [di, dj] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= ni || jj >= nj) continue;
          const q = (ii * nj + jj) * 3;
          if (N[q] || N[q + 1] || N[q + 2]) {
            N[o] = N[q];
            N[o + 1] = N[q + 1];
            N[o + 2] = N[q + 2];
            done = true;
            break;
          }
        }
        if (!done) still.push(i, j);
      }
      bad.length = 0;
      bad.push(...still);
    }
    this.bmin = new Float32Array(ni);
    this.bmax = new Float32Array(ni);
    for (let i = 0; i < ni; i++) {
      let a = Infinity;
      let b = -Infinity;
      for (let j = 0; j < nj; j++) {
        a = Math.min(a, g(i, j, 0));
        b = Math.max(b, g(i, j, 0));
      }
      this.bmin[i] = a;
      this.bmax[i] = b;
    }
    // cell and band AABBs for fast ray rejection
    const nc = (ni - 1) * (nj - 1);
    this.cb = new Float32Array(Math.max(nc, 1) * 6);
    this.bb = new Float32Array(Math.max(ni - 1, 1) * 6);
    for (let i = 0; i < ni - 1; i++) {
      const B = i * 6;
      this.bb.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], B);
      for (let j = 0; j < nj - 1; j++) {
        const C = (i * (nj - 1) + j) * 6;
        this.cb.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], C);
        for (const [ii, jj] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) {
          const o = (ii * nj + jj) * 3;
          for (let k = 0; k < 3; k++) {
            const v = P[o + k];
            if (v < this.cb[C + k]) this.cb[C + k] = v;
            if (v > this.cb[C + 3 + k]) this.cb[C + 3 + k] = v;
          }
        }
        for (let k = 0; k < 3; k++) {
          this.bb[B + k] = Math.min(this.bb[B + k], this.cb[C + k]);
          this.bb[B + 3 + k] = Math.max(this.bb[B + 3 + k], this.cb[C + 3 + k]);
        }
      }
    }
  }

  point(i: number, j: number, out = new THREE.Vector3()) {
    const o = (i * this.nj + j) * 3;
    return out.set(this.P[o], this.P[o + 1], this.P[o + 2]);
  }

  normal(i: number, j: number, out = new THREE.Vector3()) {
    const o = (i * this.nj + j) * 3;
    return out.set(this.N[o], this.N[o + 1], this.N[o + 2]);
  }

  /** Row index nearest to x (by the row's mean x). */
  rowAt(x: number): number {
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < this.ni; i++) {
      const d = Math.abs((this.bmin[i] + this.bmax[i]) / 2 - x);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** Geometry for the sub-range [i0..i1] x [j0..j1] (inclusive), mirrored to both sides, optionally offset along the normal. */
  geometry(i0 = 0, i1 = this.ni - 1, j0 = 0, j1 = this.nj - 1, o: { offset?: number; flip?: boolean; mirror?: boolean } = {}): THREE.BufferGeometry {
    const mirror = o.mirror ?? this.mirror;
    const off = o.offset ?? 0;
    const flip = !!o.flip;
    const ci = i1 - i0 + 1;
    const cj = j1 - j0 + 1;
    const nv = ci * cj;
    const sides = mirror ? 2 : 1;
    const pos = new Float32Array(nv * 3 * sides);
    const nor = new Float32Array(nv * 3 * sides);
    for (let s = 0; s < sides; s++)
      for (let a = 0; a < ci; a++)
        for (let b = 0; b < cj; b++) {
          const src = ((i0 + a) * this.nj + (j0 + b)) * 3;
          const dst = (s * nv + a * cj + b) * 3;
          const nx = this.N[src];
          const ny = this.N[src + 1];
          const nz = this.N[src + 2];
          const sz = s ? -1 : 1;
          pos[dst] = this.P[src] + nx * off;
          pos[dst + 1] = this.P[src + 1] + ny * off;
          pos[dst + 2] = (this.P[src + 2] + nz * off) * sz;
          const fl = flip ? -1 : 1;
          nor[dst] = nx * fl;
          nor[dst + 1] = ny * fl;
          nor[dst + 2] = nz * sz * fl;
        }
    const idx: number[] = [];
    for (let s = 0; s < sides; s++) {
      const base = s * nv;
      const rev = (s === 1) !== flip;
      for (let a = 0; a < ci - 1; a++)
        for (let b = 0; b < cj - 1; b++) {
          const p00 = base + a * cj + b;
          const p10 = p00 + cj;
          const p11 = p10 + 1;
          const p01 = p00 + 1;
          if (rev) idx.push(p00, p11, p10, p00, p01, p11);
          else idx.push(p00, p10, p11, p00, p11, p01);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(idx);
    return geo;
  }

  /** Nearest ray hit on the grid (both mirrored halves) within rows overlapping [xa, xb]. */
  raycast(o: THREE.Vector3, d: THREE.Vector3, xa = -Infinity, xb = Infinity): (Hit & { t: number }) | null {
    let best: (Hit & { t: number }) | null = null;
    const first = o.z >= 0 ? 1 : -1;
    const sides = this.mirror ? [first, -first] : [1];
    const eps = 2e-4;
    for (const sz of sides) {
      if (best) break; // the near half answered
      const ox = o.x;
      const oy = o.y;
      const oz = o.z * sz;
      const dx = d.x;
      const dy = d.y;
      const dz = d.z * sz;
      if (this.mirror && Math.abs(dz) < 1e-9 && oz < -eps) continue; // a ray parallel to the plane on the other side
      const ix = 1 / (dx || 1e-12);
      const iy = 1 / (dy || 1e-12);
      const iz = 1 / (dz || 1e-12);
      const hitBox = (A: Float32Array, o6: number) => {
        let t0 = 0;
        let t1 = Infinity;
        const ax = [ox, oy, oz];
        const inv = [ix, iy, iz];
        const dd = [dx, dy, dz];
        for (let k = 0; k < 3; k++) {
          const lo = A[o6 + k] - eps;
          const hi = A[o6 + 3 + k] + eps;
          if (Math.abs(dd[k]) < 1e-12) {
            if (ax[k] < lo || ax[k] > hi) return false;
            continue;
          }
          let ta = (lo - ax[k]) * inv[k];
          let tb = (hi - ax[k]) * inv[k];
          if (ta > tb) [ta, tb] = [tb, ta];
          t0 = Math.max(t0, ta);
          t1 = Math.min(t1, tb);
          if (t0 > t1) return false;
        }
        return true;
      };
      for (let i = 0; i < this.ni - 1; i++) {
        const lo = Math.min(this.bmin[i], this.bmin[i + 1]);
        const hi = Math.max(this.bmax[i], this.bmax[i + 1]);
        if (hi < xa - 1e-4 || lo > xb + 1e-4) continue;
        if (!hitBox(this.bb, i * 6)) continue;
        for (let j = 0; j < this.nj - 1; j++) {
          if (!hitBox(this.cb, (i * (this.nj - 1) + j) * 6)) continue;
          const a = (i * this.nj + j) * 3;
          const b = a + this.nj * 3;
          const c = b + 3;
          const e = a + 3;
          for (const [q0, q1, q2] of [[a, b, c], [a, c, e]]) {
            const r = triHit(this.P, ox, oy, oz, dx, dy, dz, q0, q1, q2);
            if (!r || (best && r[0] >= best.t)) continue;
            const [t, u, v] = r;
            const w = 1 - u - v;
            const N = this.N;
            const n = new THREE.Vector3(
              N[q0] * w + N[q1] * u + N[q2] * v,
              N[q0 + 1] * w + N[q1 + 1] * u + N[q2 + 1] * v,
              (N[q0 + 2] * w + N[q1 + 2] * u + N[q2 + 2] * v) * sz,
            ).normalize();
            best = { t, p: new THREE.Vector3(ox + dx * t, oy + dy * t, (oz + dz * t) * sz), n };
          }
        }
      }
    }
    return best;
  }
}

function triHit(P: Float32Array, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, a: number, b: number, c: number): [number, number, number] | null {
  const e1x = P[b] - P[a];
  const e1y = P[b + 1] - P[a + 1];
  const e1z = P[b + 2] - P[a + 2];
  const e2x = P[c] - P[a];
  const e2y = P[c + 1] - P[a + 1];
  const e2z = P[c + 2] - P[a + 2];
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  const tx = ox - P[a];
  const ty = oy - P[a + 1];
  const tz = oz - P[a + 2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < -1e-6 || u > 1 + 1e-6) return null;
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -1e-6 || u + v > 1 + 1e-6) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 1e-5 ? [t, u, v] : null;
}

/** Several grids cast as one surface. */
export class Surf {
  constructor(public grids: Grid[]) {}
  cast(o: THREE.Vector3, d: THREE.Vector3, xa?: number, xb?: number): Hit | null {
    let best: (Hit & { t: number }) | null = null;
    for (const g of this.grids) {
      const h = g.raycast(o, d, xa, xb);
      if (h && (!best || h.t < best.t)) best = h;
    }
    return best;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Projectors: map 2D layout coords (u, v) to a ray into the body. Layout outlines are drawn in these planes.

export interface Proj {
  ray(u: number, v: number, o: THREE.Vector3, d: THREE.Vector3): void;
  xr?: [number, number];
  /** Optional per-point x-range hint (constant-x rays only need one station band). */
  xrAt?(u: number, v: number): [number, number];
}
/** Side view: (u, v) = (x, y), rays from the left (+z) or the right (side = -1). */
export const sideP = (side = 1): Proj => ({
  ray: (u, v, o, d) => {
    o.set(u, v, 4 * side);
    d.set(0, 0, -side);
  },
  xrAt: (u) => [u - 0.002, u + 0.002],
});
/** Top view: (u, v) = (x, z). */
export const topP = (): Proj => ({
  ray: (u, v, o, d) => {
    o.set(u, 6, v);
    d.set(0, -1, 0);
  },
  xrAt: (u) => [u - 0.002, u + 0.002],
});
/** Front view from +x: (u, v) = (z, y); xr = station range to test. */
export const frontP = (xr: [number, number]): Proj => ({
  ray: (u, v, o, d) => {
    o.set(xr[1] + 2, v, u);
    d.set(-1, 0, 0);
  },
  xr,
});
/** Rear view from -x: (u, v) = (z, y). */
export const rearP = (xr: [number, number]): Proj => ({
  ray: (u, v, o, d) => {
    o.set(xr[0] - 2, v, u);
    d.set(1, 0, 0);
  },
  xr,
});
/** Oblique view: rays travel along dir (unit, horizontal) toward the body; u = horizontal across the view, v = y. */
export function yawP(dir: V3, pivot: V3, xr: [number, number]): Proj {
  const d0 = new THREE.Vector3(...dir).normalize();
  const side = new THREE.Vector3(-d0.z, 0, d0.x);
  return {
    ray: (u, v, o, d) => {
      o.set(pivot[0], v, pivot[2]).addScaledVector(side, u).addScaledVector(d0, -3);
      d.copy(d0);
    },
    xr,
  };
}

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
function castP(s: Surf, P: Proj, u: number, v: number): Hit | null {
  P.ray(u, v, _o, _d);
  const r = P.xrAt?.(u, v) ?? P.xr;
  return s.cast(_o, _d, r?.[0], r?.[1]);
}
export function castAt(s: Surf, P: Proj, u: number, v: number): Hit | null {
  return castP(s, P, u, v);
}

function orient(geo: THREE.BufferGeometry, want: THREE.Vector3) {
  // flip the winding when the first non-degenerate face disagrees with the surface normal
  const idx = geo.index!.array as Uint32Array | Uint16Array | number[];
  const p = geo.attributes.position;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let votes = 0;
  for (let k = 0; k < idx.length; k += 3) {
    a.fromBufferAttribute(p, idx[k]);
    b.fromBufferAttribute(p, idx[k + 1]).sub(a);
    c.fromBufferAttribute(p, idx[k + 2]).sub(a);
    const n = b.cross(c);
    if (n.lengthSq() < 1e-14) continue;
    votes += n.dot(want) > 0 ? 1 : -1;
    if (Math.abs(votes) > 6) break;
  }
  if (votes < 0) {
    const arr = Array.from(idx);
    for (let k = 0; k < arr.length; k += 3) [arr[k + 1], arr[k + 2]] = [arr[k + 2], arr[k + 1]];
    geo.setIndex(arr);
  }
}

export interface PatchOpts {
  rings?: number;
  offset?: number;
  /** Extra outward bulge at the centre (lenses). */
  dome?: number;
  /** Recompute normals from the patch shape (domed lenses) instead of using the panel normals. */
  ownNormals?: boolean;
  /** Mirror to the other side (z -> -z). */
  mirror?: boolean;
  /** Pull the outline in by this fraction toward the centre (insets). */
  scale?: number;
}

/** A conformal patch over a star-shaped outline (rings toward the centroid), with planar 0..1 UVs. */
export function patch(s: Surf, P: Proj, outline: V2[], o: PatchOpts = {}): THREE.BufferGeometry {
  const M = outline.length;
  let cu = 0;
  let cv = 0;
  outline.forEach(([u, v]) => {
    cu += u / M;
    cv += v / M;
  });
  const sc = o.scale ?? 1;
  const ol = outline.map(([u, v]) => [cu + (u - cu) * sc, cv + (v - cv) * sc] as V2);
  let umin = Infinity;
  let umax = -Infinity;
  let vmin = Infinity;
  let vmax = -Infinity;
  ol.forEach(([u, v]) => {
    umin = Math.min(umin, u);
    umax = Math.max(umax, u);
    vmin = Math.min(vmin, v);
    vmax = Math.max(vmax, v);
  });
  // enough rings that radial edges stay short (long chords sink under curved panels)
  let maxR = 0;
  ol.forEach(([u, v]) => (maxR = Math.max(maxR, Math.hypot(u - cu, v - cv))));
  const K = Math.max(o.rings ?? 5, Math.ceil(maxR / 0.05));
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const avgN = new THREE.Vector3();
  let last: Hit | null = null;
  const put = (u: number, v: number, f: number) => {
    const h: Hit | null = castP(s, P, u, v) ?? last;
    if (!h) {
      pos.push(0, 0, 0);
      nor.push(0, 1, 0);
    } else {
      last = h;
      const off = (o.offset ?? 0.002) + (o.dome ?? 0) * (1 - f * f);
      pos.push(h.p.x + h.n.x * off, h.p.y + h.n.y * off, h.p.z + h.n.z * off);
      nor.push(h.n.x, h.n.y, h.n.z);
      avgN.add(h.n);
    }
    uv.push((u - umin) / (umax - umin || 1), (v - vmin) / (vmax - vmin || 1));
  };
  put(cu, cv, 0);
  for (let k = 1; k <= K; k++) {
    const f = 0.5 * (k / K) + 0.5 * Math.sin(((k / K) * Math.PI) / 2);
    for (let m = 0; m < M; m++) put(cu + (ol[m][0] - cu) * f, cv + (ol[m][1] - cv) * f, f);
  }
  const idx: number[] = [];
  for (let m = 0; m < M; m++) idx.push(0, 1 + m, 1 + ((m + 1) % M));
  for (let k = 1; k < K; k++)
    for (let m = 0; m < M; m++) {
      const a = 1 + (k - 1) * M + m;
      const b = 1 + (k - 1) * M + ((m + 1) % M);
      const c = b + M;
      const d = a + M;
      idx.push(a, d, c, a, c, b);
    }
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  orient(geo, avgN.normalize());
  if (o.ownNormals) geo.computeVertexNormals();
  if (o.mirror) geo = mirrorZ(geo);
  return geo;
}

export interface RibbonOpts {
  offset?: number;
  /** Raised centre (rounded trim / pillars). */
  crown?: number;
  rows?: number;
  closed?: boolean;
  mirror?: boolean;
  ownNormals?: boolean;
  /** Resample the path with CR to this many points (0 = use as given). */
  n?: number;
}

/** A strip of the given width laid along a 2D path in projector space (shut lines, trims, pillars, seals). */
export function ribbon(s: Surf, P: Proj, path: V2[], width: number, o: RibbonOpts = {}): THREE.BufferGeometry {
  const pts = o.n ? (o.closed ? crLoop(path, o.n) : crPath(path, Math.max(1, Math.round(o.n / (path.length - 1))))) : path;
  const R = o.rows ?? (o.crown ? 4 : 1);
  const N = pts.length;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const avgN = new THREE.Vector3();
  let last: Hit | null = null;
  let along = 0;
  for (let i = 0; i < N; i++) {
    const a = pts[o.closed ? (i - 1 + N) % N : Math.max(i - 1, 0)];
    const b = pts[o.closed ? (i + 1) % N : Math.min(i + 1, N - 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    if (i > 0) along += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    for (let r = 0; r <= R; r++) {
      const f = r / R;
      const sOff = (f - 0.5) * width;
      const u = pts[i][0] - ty * sOff;
      const v = pts[i][1] + tx * sOff;
      const h: Hit | null = castP(s, P, u, v) ?? last;
      if (!h) {
        pos.push(0, 0, 0);
        nor.push(0, 1, 0);
      } else {
        last = h;
        const off = (o.offset ?? 0.0015) + (o.crown ?? 0) * (1 - (2 * f - 1) ** 2);
        pos.push(h.p.x + h.n.x * off, h.p.y + h.n.y * off, h.p.z + h.n.z * off);
        nor.push(h.n.x, h.n.y, h.n.z);
        avgN.add(h.n);
      }
      uv.push(along, f);
    }
  }
  const idx: number[] = [];
  const segs = o.closed ? N : N - 1;
  for (let i = 0; i < segs; i++)
    for (let r = 0; r < R; r++) {
      const a = i * (R + 1) + r;
      const b = ((i + 1) % N) * (R + 1) + r;
      idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  orient(geo, avgN.normalize());
  if (o.ownNormals || o.crown) geo.computeVertexNormals();
  if (o.mirror) geo = mirrorZ(geo);
  return geo;
}

/** Geometry + its z-mirrored copy (winding reversed) in one buffer. Works for indexed or non-indexed geometry. */
export function mirrorZ(src: THREE.BufferGeometry, keep = true): THREE.BufferGeometry {
  const g = src.index ? src : src.clone();
  if (!g.index) {
    const n = g.attributes.position.count;
    g.setIndex(Array.from({ length: n }, (_, i) => i));
  }
  const n = g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name] as THREE.BufferAttribute;
    const arr = new Float32Array(a.count * a.itemSize * 2);
    arr.set(a.array as Float32Array, 0);
    const m = (a.array as Float32Array).slice();
    if (name === 'position' || name === 'normal') for (let k = 2; k < m.length; k += 3) m[k] = -m[k];
    arr.set(m, a.count * a.itemSize);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  const idx = Array.from(g.index!.array);
  const all = idx.slice();
  for (let k = 0; k < idx.length; k += 3) all.push(idx[k] + n, idx[k + 2] + n, idx[k + 1] + n);
  out.setIndex(all);
  if (g !== src) g.dispose();
  if (!keep) src.dispose();
  return out;
}

/** Bake a transform into a geometry (returns it). */
export function place(geo: THREE.BufferGeometry, pos: V3, rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot, 'YXZ')), new THREE.Vector3(...scale));
  geo.applyMatrix4(m);
  return geo;
}

/** Superellipsoid (rounded box) of full size sx, sy, sz; e < 1 = boxier. Used for seats, mirrors, dash parts. */
export function rbox(sx: number, sy: number, sz: number, e = 0.35, seg = 10): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, seg, Math.max(6, Math.round(seg * 0.7)));
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const f = (v: number) => Math.sign(v) * Math.pow(Math.abs(v), e);
    p.setXYZ(i, (f(p.getX(i)) * sx) / 2, (f(p.getY(i)) * sy) / 2, (f(p.getZ(i)) * sz) / 2);
  }
  g.computeVertexNormals();
  return g;
}

/** Merge geometries (position, normal, optional uv) into one. */
export function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let base = 0;
  const hasUv = geos.every((g) => g.attributes.uv);
  for (const g0 of geos) {
    const g = g0.index ? g0 : g0.clone();
    if (!g.index) g.setIndex(Array.from({ length: g.attributes.position.count }, (_, i) => i));
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position;
    const n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      if (hasUv) uv.push(g.attributes.uv.getX(i), g.attributes.uv.getY(i));
    }
    for (const k of Array.from(g.index!.array)) idx.push(k + base);
    base += p.count;
    if (g !== g0) g.dispose();
    g0.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  if (hasUv) out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  return out;
}

/** A tube along 3D points (CR curve). */
export function tube(pts: V3[], r: number, seg = 24, radial = 8, closed = false): THREE.BufferGeometry {
  const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), closed, 'centripetal');
  return new THREE.TubeGeometry(c, seg, r, radial, closed);
}

/** Extrude a 2D outline (x, y) along z by depth with a small bevel; centred on z. */
export function slab(outline: V2[], depth: number, bevel = 0.004, steps = 1): THREE.BufferGeometry {
  const sh = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, steps, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------------------------
// Wheel wells: a dark liner tunnel following the arch plus an inner wall, for one side (mirror for both).

export function wellGeo(cx: number, cy: number, r: number, yCut: number, zOut: number, zIn: number, n = 28): THREE.BufferGeometry {
  const s = clamp((yCut - cy) / r, -0.99, 0.99);
  const a0 = Math.asin(s);
  const a1 = Math.PI - a0;
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= n; k++) {
    const a = lerp(a1, a0, k / n);
    const c = Math.cos(a);
    const sn = Math.sin(a);
    pos.push(cx + c * r, cy + sn * r, zOut, cx + c * r, cy + sn * r, zIn);
    nor.push(-c, -sn, 0, -c, -sn, 0);
  }
  for (let k = 0; k < n; k++) {
    const a = k * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  // inner wall (faces +z, toward the wheel's back face)
  const base = pos.length / 3;
  pos.push(cx, cy, zIn);
  nor.push(0, 0, 1);
  for (let k = 0; k <= n; k++) {
    const a = lerp(a1, a0, k / n);
    pos.push(cx + Math.cos(a) * r, Math.max(yCut, cy + Math.sin(a) * r), zIn);
    nor.push(0, 0, 1);
  }
  pos.push(cx + Math.cos(a0) * r, yCut, zIn, cx + Math.cos(a1) * r, yCut, zIn);
  nor.push(0, 0, 1, 0, 0, 1);
  for (let k = 0; k < n; k++) idx.push(base, base + 1 + k, base + 2 + k);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  orient(g, new THREE.Vector3(0, -1, 0.3));
  return g;
}

// ---------------------------------------------------------------------------------------------------------------
// The shell: lower body + greenhouse lofts, from per-car line functions.

export interface Arch { x: number; y: number; r: number }

export interface LowerDef {
  xR: number;
  xF: number;
  step?: number;
  capF: { len: number; p: number; rake?: (y: number) => number };
  capR: { len: number; p: number; rake?: (y: number) => number };
  /** Bottom edge of the side (rocker / bumper bottom). */
  yBot: (x: number) => number;
  /** Max half-width and the height where it occurs (the shoulder / door bulge). */
  w: (x: number) => number;
  yMax: (x: number) => number;
  /** Rocker tuck-in (m) at the bottom. */
  tuck: (x: number) => number;
  /** Top side edge: fender top / beltline / deck edge, and how far it rolls inward. */
  yBelt: (x: number) => number;
  roll: (x: number) => number;
  /** Hood / deck centre height. */
  yTop: (x: number) => number;
  /** Optional extra crease key just below the belt (shoulder line) [height below belt, inset]. */
  shoulder?: (x: number) => [number, number];
  /** Cabin opening: between these x the top dives to the floor (interior visible through the glass). */
  cabin?: [number, number];
  floorY?: number;
  arches: Arch[];
}

export interface GreenDef {
  xr: number;
  xf: number;
  step?: number;
  /** Glass base along the belt. */
  yBase: (x: number) => number;
  wBase: (x: number) => number;
  /** Pillar / roof-rail line (A pillar in front, drip rail, C pillar behind). */
  yEdge: (x: number) => number;
  wEdge: (x: number) => number;
  /** Centreline top: windshield, roof, backlight. */
  yTop: (x: number) => number;
  /** Plan-view bow of centre points (+ = forward). */
  bulge?: (x: number) => number;
  /** Width of the rail strip either side of the edge line. */
  rail?: number;
  /** How round the roof crown is (0 flat .. 1 round). */
  crown?: number;
}

export const LJ = { under: 0, corner: 1, rocker: 2, max: 3, shoulder: 4, belt: 5, inner: 6, top: 7 };

export function lowerShell(d: LowerDef): { grid: Grid; stations: number[]; keyJ: number[] } {
  const step = d.step ?? 0.03;
  const xs = new Set<number>();
  const x0 = d.xR + d.capR.len;
  const x1 = d.xF - d.capF.len;
  const nMid = Math.max(2, Math.round((x1 - x0) / step));
  for (let i = 0; i <= nMid; i++) xs.add(+lerp(x0, x1, i / nMid).toFixed(5));
  // arch stations: uniform in arch angle so the arch edge is round
  for (const a of d.arches) {
    for (let k = 0; k <= 24; k++) {
      const x = a.x + Math.cos((k / 24) * Math.PI) * a.r * 1.002;
      xs.add(+x.toFixed(5));
    }
    xs.add(+(a.x - a.r - 0.004).toFixed(5));
    xs.add(+(a.x + a.r + 0.004).toFixed(5));
  }
  let list = [...xs].filter((x) => x > x0 - 1e-6 && x < x1 + 1e-6).sort((a, b) => a - b);
  // thin out stations that are too close (keeps arch samples, drops base ones next to them)
  const thin: number[] = [];
  for (const x of list) if (!thin.length || x - thin[thin.length - 1] > 0.004) thin.push(x);
  list = thin;
  // caps: superellipse quadrant (t from the side to the tip)
  const capN = 12;
  const front: { x: number; s: number; w: number }[] = [];
  const rear: { x: number; s: number; w: number }[] = [];
  for (let k = 1; k <= capN; k++) {
    const t = (Math.PI / 2) * (1 - k / capN);
    const cx = Math.pow(Math.cos(t), 2 / d.capF.p);
    const sz = Math.pow(Math.sin(t), 2 / d.capF.p);
    front.push({ x: x1 + d.capF.len * cx, s: k === capN ? 0 : sz, w: cx });
    const cxr = Math.pow(Math.cos(t), 2 / d.capR.p);
    const szr = Math.pow(Math.sin(t), 2 / d.capR.p);
    rear.unshift({ x: x0 - d.capR.len * cxr, s: k === capN ? 0 : szr, w: cxr });
  }
  const stations = [...rear, ...list.map((x) => ({ x, s: 1, w: 0 })), ...front];
  const counts = [2, 2, 5, 5, 2, 3, 6];
  const archLift = (x: number) => {
    let y = -Infinity;
    let k = 0;
    for (const a of d.arches) {
      const dx = x - a.x;
      if (Math.abs(dx) <= a.r) {
        y = Math.max(y, a.y + Math.sqrt(a.r * a.r - dx * dx));
        k = Math.max(k, 1 - Math.abs(dx) / a.r);
      }
    }
    return { y, k };
  };
  const cab = d.cabin;
  const rows: V3[][] = stations.map(({ x, s, w: capW }) => {
    const front = x > 0;
    const xq = clamp(x, x0, x1);
    const W = d.w(xq);
    const ym = d.yMax(xq);
    const yb0 = d.yBot(x);
    const al = archLift(x);
    const yb = Math.max(yb0, al.y);
    const inArch = al.y > yb0;
    const tk = inArch ? d.tuck(xq) * 0.15 : d.tuck(xq);
    const yBelt = d.yBelt(x);
    const roll = d.roll(xq);
    const yTop = d.yTop(x);
    const c = cab ? band(cab[0], cab[1], x, 0.05) : 0;
    const floorY = d.floorY ?? 0.3;
    const wb = W - tk;
    const ymax = clamp(ym, yb + 0.05, yBelt - 0.04);
    const sh = d.shoulder?.(xq) ?? [0.06, roll * 0.35];
    const topIn: V2 = [lerp(lerp(yBelt, yTop, 0.85), yBelt - 0.16, c), lerp((W - roll) * 0.5, W - roll - 0.06, c)];
    const topC: V2 = [lerp(yTop, floorY, c), 0];
    const keys: V2[] = [
      [yb + 0.035, wb - 0.06],
      [yb + 0.004, wb - 0.018],
      [Math.min(yb + 0.05, ymax - 0.01), wb],
      [ymax, W],
      [Math.max(yBelt - sh[0], ymax + 0.01), W - sh[1]],
      [yBelt, W - roll],
      topIn,
      topC,
    ];
    const rake = front ? d.capF.rake : d.capR.rake;
    const pts = crPath(keys, counts);
    return pts.map(([y, z]) => [x + (rake ? rake(y) * capW : 0), y, z * s] as V3);
  });
  const keyJ: number[] = [0];
  counts.forEach((c, k) => keyJ.push(keyJ[k] + c));
  return { grid: new Grid(rows), stations: stations.map((s) => s.x), keyJ };
}

export function greenhouse(d: GreenDef): { grid: Grid; keyJ: number[]; rowX: number[] } {
  const step = d.step ?? 0.03;
  const n = Math.max(4, Math.round((d.xf - d.xr) / step));
  const rail = d.rail ?? 0.035;
  const crown = d.crown ?? 0.5;
  const counts = [4, 2, 2, 3, 4];
  const rowX: number[] = [];
  const rows: V3[][] = [];
  for (let i = 0; i <= n; i++) {
    // denser rows near both ends (windshield base, backlight base)
    const t = i / n;
    const x = lerp(d.xr, d.xf, t);
    rowX.push(x);
    const yb = d.yBase(x);
    const wb = d.wBase(x);
    const ye = Math.max(d.yEdge(x), yb);
    const we = Math.min(d.wEdge(x), wb);
    const yt = Math.max(d.yTop(x), ye);
    const sideH = ye - yb;
    const r1 = Math.min(rail, sideH * 0.45);
    // the glass base follows the cowl / backlight base curve where the side band has closed up
    const wbb = we + (wb - we) * clamp(sideH / 0.03, 0, 1);
    const lean = sideH > 1e-4 ? (wbb - we) / sideH : 0;
    const q = 2 + 2.5 * (1 - crown);
    const fz = (z: number) => 1 - Math.pow(clamp(z / Math.max(we, 1e-4), 0, 1), q);
    const z3 = Math.max(we - rail * 0.9, we * 0.8);
    const z4 = we * 0.45;
    const keys: V2[] = [
      [yb, wbb],
      [ye - r1, we + lean * r1],
      [ye, we],
      [ye + (yt - ye) * fz(z3), z3],
      [ye + (yt - ye) * fz(z4), z4],
      [yt, 0],
    ];
    const pts = crPath(keys, counts);
    const bl = d.bulge?.(x) ?? 0;
    rows.push(pts.map(([y, z]) => [x + bl * (1 - (we > 1e-4 ? (z / we) ** 2 : 0)), y, z] as V3));
  }
  const keyJ: number[] = [0];
  counts.forEach((c, k) => keyJ.push(keyJ[k] + c));
  return { grid: new Grid(rows), keyJ, rowX };
}

// ---------------------------------------------------------------------------------------------------------------
// Assembly helper: materials, mesh bookkeeping, the BodyBuild contract.

export interface Mats {
  paint: THREE.Material;
  glass: THREE.Material;
  glassDark: THREE.Material;
  black: THREE.Material;
  trim: THREE.Material;
  gloss: THREE.Material;
  gap: THREE.Material;
  liner: THREE.Material;
  chrome: THREE.Material;
  blackChrome: THREE.Material;
  rubber: THREE.Material;
  metal: THREE.Material;
  lens: THREE.Material;
  lensRed: THREE.Material;
  lensAmber: THREE.Material;
  housing: THREE.Material;
  head: THREE.MeshStandardMaterial;
  drl: THREE.MeshStandardMaterial;
  tail: THREE.MeshStandardMaterial;
  tailDim: THREE.MeshStandardMaterial;
  amber: THREE.MeshStandardMaterial;
  reverse: THREE.MeshStandardMaterial;
  seat: THREE.Material;
  dash: THREE.Material;
  carpet: THREE.Material;
  wheel: THREE.Material;
  intTrim: THREE.Material;
  headliner: THREE.Material;
  under: THREE.Material;
}

export function mats(spec: CarSpec): Mats {
  return {
    paint: paintMaterial(spec.paint),
    glass: glass(),
    glassDark: glass({ opacity: 0.86, tint: '#06080b' }), // privacy glass (hatch, rear doors)
    black: plastic('#0c0c0e'),
    trim: plastic('#17171a', { gloss: 0.35 }),
    gloss: plastic('#0a0a0c', { gloss: 1 }),
    gap: plastic('#030304'),
    liner: plastic('#0b0b0c'),
    chrome: chrome(),
    blackChrome: blackChrome(),
    rubber: rubber(),
    metal: brushedMetal('#8a8c90'),
    lens: lens(),
    lensRed: lens({ tint: '#ff2a20', opacity: 0.32 }),
    lensAmber: lens({ tint: '#ffa020', opacity: 0.2 }),
    housing: chrome(),
    head: lightMaterial('#fff3dc', 7),
    drl: lightMaterial('#e8f0ff', 5),
    tail: lightMaterial('#ff1608', 6),
    tailDim: lightMaterial('#c80c06', 3),
    amber: lightMaterial('#ff8a10', 3),
    reverse: lightMaterial('#f2f2f2', 1.5),
    seat: interior('seat'),
    dash: interior('dash'),
    carpet: interior('carpet'),
    wheel: interior('wheel'),
    intTrim: interior('trim'),
    headliner: plastic('#3a3a3e'),
    under: plastic('#101012'),
  };
}

export class Body {
  group = new THREE.Group();
  paint: THREE.Mesh[] = [];
  head: THREE.Mesh[] = [];
  tail: THREE.Mesh[] = [];
  constructor(public m: Mats) {}
  add(geo: THREE.BufferGeometry, mat: THREE.Material, name = '', kind?: 'paint' | 'head' | 'tail'): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (mat === this.m.glass || mat === this.m.glassDark || mat === this.m.lens || mat === this.m.lensRed || mat === this.m.lensAmber) mesh.castShadow = false;
    this.group.add(mesh);
    if (kind === 'paint') this.paint.push(mesh);
    if (kind === 'head') this.head.push(mesh);
    if (kind === 'tail') this.tail.push(mesh);
    return mesh;
  }
}

/** Interior: two front seats, a rear bench, dash with binnacle, steering wheel, centre console, carpet. */
export function cabinInterior(b: Body, o: {
  xDash: number; yDash: number; wIn: number; floorY: number; xSeat: number; seatZ: number; xRear?: number; xWheel?: number; yWheel?: number;
  dashDepth?: number; seatH?: number; wheelR?: number;
}) {
  const m = b.m;
  const sh = o.seatH ?? 1;
  const seat = (x: number, z: number) => {
    const cushion = place(rbox(0.5, 0.12, 0.5, 0.4), [x, o.floorY + 0.24 * sh, z]);
    const back = place(rbox(0.13, 0.62 * sh, 0.5, 0.42), [x - 0.27, o.floorY + 0.56 * sh, z], [0, 0, 0.22]);
    const bolster = place(rbox(0.1, 0.5 * sh, 0.08, 0.5), [x - 0.24, o.floorY + 0.55 * sh, z + 0.23], [0, 0, 0.22]);
    const bolster2 = place(rbox(0.1, 0.5 * sh, 0.08, 0.5), [x - 0.24, o.floorY + 0.55 * sh, z - 0.23], [0, 0, 0.22]);
    const head = place(rbox(0.1, 0.18, 0.28, 0.5), [x - 0.38, o.floorY + 0.94 * sh, z], [0, 0, 0.18]);
    return merge([cushion, back, bolster, bolster2, head]);
  };
  b.add(merge([seat(o.xSeat, o.seatZ), seat(o.xSeat, -o.seatZ)]), m.seat, 'seats');
  const xRear = o.xRear;
  if (xRear !== undefined) {
    const bench = place(rbox(0.5, 0.14, o.wIn * 1.7, 0.4), [xRear, o.floorY + 0.24, 0]);
    const back = place(rbox(0.14, 0.55, o.wIn * 1.7, 0.42), [xRear - 0.27, o.floorY + 0.52, 0], [0, 0, 0.28]);
    const hr = [-1, 1].map((s) => place(rbox(0.1, 0.15, 0.26, 0.5), [xRear - 0.36, o.floorY + 0.84, s * o.seatZ], [0, 0, 0.25]));
    b.add(merge([bench, back, ...hr]), m.seat, 'rearSeat');
  }
  const dd = o.dashDepth ?? 0.45;
  const dash = place(rbox(dd, 0.24, o.wIn * 2 - 0.04, 0.32), [o.xDash - dd / 2 + 0.05, o.yDash - 0.12, 0]);
  const binn = place(rbox(0.18, 0.08, 0.36, 0.4), [o.xDash - dd + 0.12, o.yDash + 0.0, -o.seatZ]);
  const cons = place(rbox(0.7, 0.2, 0.22, 0.4), [o.xSeat + 0.15, o.floorY + 0.18, 0]);
  b.add(merge([dash, binn, cons]), m.dash, 'dash');
  b.add(place(new THREE.PlaneGeometry(2.4, o.wIn * 2).rotateX(-Math.PI / 2), [o.xSeat, o.floorY + 0.02, 0]), m.carpet, 'carpet');
  // steering wheel on a raked column
  const xw = o.xWheel ?? o.xDash - dd + 0.02;
  const yw = o.yWheel ?? o.yDash - 0.05;
  const wr = o.wheelR ?? 0.185;
  const rim = new THREE.TorusGeometry(wr, 0.018, 6, 28);
  const hub = new THREE.CylinderGeometry(0.06, 0.07, 0.06, 16).rotateX(Math.PI / 2);
  const spk = [0, 2.2, -2.2].map((a) => place(new THREE.BoxGeometry(0.03, wr, 0.02), [Math.sin(a) * wr * 0.5, -Math.cos(a) * wr * 0.5, 0], [0, 0, 0]).rotateZ(a));
  const col = place(new THREE.CylinderGeometry(0.03, 0.04, 0.3, 10), [0, 0, -0.17]).rotateX(Math.PI / 2);
  const wheel = merge([rim, hub, ...spk, col]);
  wheel.rotateY(Math.PI / 2);
  wheel.rotateZ(-0.42);
  wheel.translate(xw, yw, -o.seatZ); // left-hand drive: driver on -Z
  b.add(wheel, m.wheel, 'steering');
}

/** A door mirror: stalk + aero housing (paint cap) + glass. Returns the housing for the paint list. */
export function doorMirror(b: Body, x: number, y: number, z: number, o: { w?: number; h?: number; paint?: boolean } = {}) {
  const w = o.w ?? 0.2;
  const h = o.h ?? 0.12;
  const shell = place(rbox(0.12, h, w, 0.45, 18), [x - 0.01, y + 0.02, z + w / 2 + 0.03]);
  const stalk = place(rbox(0.12, 0.05, 0.08, 0.5), [x + 0.01, y - 0.025, z + 0.03]);
  const housing = b.add(mirrorZ(shell), o.paint === false ? b.m.gloss : b.m.paint, 'mirrors', o.paint === false ? undefined : 'paint');
  b.add(mirrorZ(stalk), b.m.black, 'mirrorStalks');
  const gl = place(new THREE.PlaneGeometry(w * 0.82, h * 0.72).rotateY(-Math.PI / 2), [x - 0.072, y + 0.02, z + w / 2 + 0.03]);
  b.add(mirrorZ(gl), b.m.chrome, 'mirrorGlass');
  return housing;
}

export function v3(x: number, y: number, z: number) {
  return new THREE.Vector3(x, y, z);
}

export function finish(b: Body, dims: BodyBuild['dims'], anchors: BodyBuild['anchors'], hints: { belt: number; sill: number; door: [number, number]; cowl: number }): BodyBuild {
  Object.assign(b.group.userData, hints);
  b.group.name = 'body';
  return { body: b.group, dims, anchors, paintMeshes: b.paint, headLightMeshes: b.head, tailLightMeshes: b.tail };
}

/** Exact-index ranges helper for greenhouse splits: rows whose x lies in [a, b]. */
export function rowRange(rowX: number[], a: number, b: number): [number, number] {
  let i0 = rowX.findIndex((x) => x >= a);
  if (i0 < 0) i0 = rowX.length - 1;
  let i1 = -1;
  for (let i = rowX.length - 1; i >= 0; i--)
    if (rowX[i] <= b) {
      i1 = i;
      break;
    }
  if (i1 < 0) i1 = 0;
  return [i0, Math.max(0, i1)];
}

/** A strip along grid column j (rows i0..i1), spread across the surface by width, lifted by offset (shut lines, seals). */
export function gridLine(g: Grid, j: number, i0: number, i1: number, width: number, offset = 0.0015, mirror = true): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = i0; i <= i1; i++) {
    g.point(i, j, p);
    g.normal(i, j, n);
    g.point(i, Math.max(j - 1, 0), a);
    g.point(i, Math.min(j + 1, g.nj - 1), b);
    const t = b.sub(a);
    if (t.lengthSq() < 1e-12) t.set(0, 1, 0);
    t.normalize();
    for (const s of [-0.5, 0.5]) {
      pos.push(p.x + t.x * width * s + n.x * offset, p.y + t.y * width * s + n.y * offset, p.z + t.z * width * s + n.z * offset);
      nor.push(n.x, n.y, n.z);
    }
  }
  const idx: number[] = [];
  for (let k = 0; k < i1 - i0; k++) {
    const q = k * 2;
    idx.push(q, q + 2, q + 3, q, q + 3, q + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  const mid = Math.floor((i1 - i0) / 2) + i0;
  orient(geo, g.normal(mid, j, new THREE.Vector3()));
  return mirror ? mirrorZ(geo) : geo;
}

/** The lower shell's plan outline at height y over rows whose x lies in [xa, xb]: [x, z] per row (z >= 0). */
export function planOutline(g: Grid, y: number, xa: number, xb: number, j0 = 1, j1 = 5): V2[] {
  const out: V2[] = [];
  const p = new THREE.Vector3();
  const q = new THREE.Vector3();
  for (let i = 0; i < g.ni; i++) {
    for (let j = j0; j < j1; j++) {
      g.point(i, j, p);
      g.point(i, j + 1, q);
      if ((p.y - y) * (q.y - y) <= 0 && p.y !== q.y) {
        const t = (y - p.y) / (q.y - p.y);
        const x = lerp(p.x, q.x, t);
        if (x >= xa && x <= xb) out.push([x, lerp(p.z, q.z, t)]);
        break;
      }
    }
  }
  return out;
}

/** Sweep a profile [outward offset, y] along a plan path [x, z] (outward = left of travel). Mirrored grid. */
export function sweep(path: V2[], profile: V2[] | ((k: number, n: number) => V2[]), mirror = true): Grid {
  const rows: V3[][] = path.map((pt, k) => {
    const a = path[Math.max(k - 1, 0)];
    const b = path[Math.min(k + 1, path.length - 1)];
    let tx = b[0] - a[0];
    let tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    const nx = -tz;
    const nz = tx;
    const pr = typeof profile === 'function' ? profile(k, path.length) : profile;
    return pr.map(([o, y]) => [pt[0] + nx * o, y, Math.max(0, pt[1] + nz * o)] as V3);
  });
  let g = new Grid(rows, mirror);
  // make sure normals face out (away from the path's inside)
  const mi = Math.floor(rows.length / 2);
  const mj = Math.floor(rows[0].length / 2);
  const n = g.normal(mi, mj);
  const a = path[Math.max(mi - 1, 0)];
  const b = path[Math.min(mi + 1, path.length - 1)];
  const out = new THREE.Vector3(-(b[1] - a[1]), 0, b[0] - a[0]);
  if (n.dot(out) < 0) g = new Grid(rows.map((r) => r.slice().reverse()), mirror);
  return g;
}

/** Offset a plan path outward (left of travel) by d. */
export function offsetPath(path: V2[], d: number): V2[] {
  return path.map((pt, k) => {
    const a = path[Math.max(k - 1, 0)];
    const b = path[Math.min(k + 1, path.length - 1)];
    let tx = b[0] - a[0];
    let tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l;
    tz /= l;
    return [pt[0] - tz * d, Math.max(0, pt[1] + tx * d)] as V2;
  });
}

/** Resample a polyline to n points evenly by length. */
export function resample(path: V2[], n: number): V2[] {
  if (path.length < 2) return path.slice();
  const L: number[] = [0];
  for (let k = 1; k < path.length; k++) L.push(L[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]));
  const tot = L[L.length - 1];
  const out: V2[] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    const want = (tot * i) / (n - 1);
    while (s < L.length - 2 && L[s + 1] < want) s++;
    const t = (want - L[s]) / (L[s + 1] - L[s] || 1);
    out.push([lerp(path[s][0], path[s + 1][0], t), lerp(path[s][1], path[s + 1][1], t)]);
  }
  return out;
}

/** Rounded-rect profile for sweeps: [offset, y] from the inner bottom, round the outside, to the inner top. */
export function bumperProfile(depth: number, y0: number, y1: number, r: number, n = 4, bulge = 0): V2[] {
  const out: V2[] = [[-0.01, y0 + r * 0.3]];
  const arc = (cx: number, cy: number, a0: number, a1: number) => {
    for (let k = 0; k <= n; k++) {
      const a = lerp(a0, a1, k / n);
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  arc(depth - r, y0 + r, -Math.PI / 2, 0);
  if (bulge) out.push([depth + bulge, (y0 + y1) / 2]);
  arc(depth - r, y1 - r, 0, Math.PI / 2);
  out.push([-0.01, y1 - r * 0.3]);
  return out;
}

/**
 * Wrap projector: u = arc length around the body's plan outline at height y (0 on the centreline, growing around
 * the corner and back along the side), v = y; rays point inward along the outline normal. For wrap-round lamps.
 */
export function wrapP(g: Grid, y: number, end: 'front' | 'rear', reach: number, j0: number, j1: number): Proj {
  const L = g.ni;
  let pts = planOutline(g, y, -99, 99, j0, j1);
  pts = end === 'front' ? pts.filter((p) => p[0] > 0).reverse() : pts.filter((p) => p[0] < 0);
  if (pts.length < 2) pts = end === 'front' ? [[3, 0], [2, 1]] : [[-3, 0], [-2, 1]];
  if (pts[0][1] > 1e-3) pts.unshift([pts[0][0], 0]);
  const s: number[] = [0];
  for (let k = 1; k < pts.length; k++) s.push(s[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  void L;
  const at = (u: number) => {
    u = clamp(u, 0, Math.min(reach, s[s.length - 1]));
    let k = 0;
    while (k < s.length - 2 && s[k + 1] < u) k++;
    const t = (u - s[k]) / (s[k + 1] - s[k] || 1);
    const px = lerp(pts[k][0], pts[k + 1][0], t);
    const pz = lerp(pts[k][1], pts[k + 1][1], t);
    let nx = pts[k + 1][1] - pts[k][1];
    let nz = -(pts[k + 1][0] - pts[k][0]);
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    if (nx * px + nz * pz * 3 < 0) {
      nx = -nx;
      nz = -nz;
    }
    return [px, pz, nx, nz];
  };
  return {
    ray: (u, v, o, d) => {
      const [px, pz, nx, nz] = at(u);
      o.set(px + nx * 0.6, v, pz + nz * 0.6);
      d.set(-nx, 0, -nz);
    },
    xrAt: (u) => {
      const [px, , nx] = at(u);
      return nx > 0.3 ? [px - 0.9, px + 0.8] : nx < -0.3 ? [px - 0.8, px + 0.9] : [px - 0.25, px + 0.25];
    },
  };
}

export interface ShellSplit {
  cabin: [number, number];
  hood: [number, number];
  /** Greenhouse rows with x >= ws are windshield, x <= back are backlight, side band rows x <= quarter are painted C-pillar. */
  ws: number;
  back: number;
  quarter?: number;
  /** Privacy glass: side glass rows with x <= darkFrom and the backlight use the dark tinted glass. */
  darkFrom?: number;
  pillarMat?: THREE.Material;
  roofMat?: THREE.Material;
}

/** Standard split of the lower shell and greenhouse into named meshes. Returns greenhouse row indices. */
export function shellMeshes(b: Body, lower: { grid: Grid; stations: number[]; keyJ: number[] }, gh: { grid: Grid; keyJ: number[]; rowX: number[] }, o: ShellSplit) {
  const m = b.m;
  const L = lower.grid;
  const LJ = lower.keyJ;
  const st = lower.stations;
  const rowOf = (x: number) => {
    const i = st.findIndex((s) => s >= x);
    return i < 0 ? st.length - 1 : i;
  };
  const nL = L.ni - 1;
  b.add(L.geometry(0, nL, 0, LJ[5]), m.paint, 'sides', 'paint');
  const iC0 = rowOf(o.cabin[0]);
  const iC1 = rowOf(o.cabin[1]);
  const iH0 = rowOf(o.hood[0]);
  const iH1 = rowOf(o.hood[1]);
  b.add(L.geometry(0, iC0, LJ[5], LJ[7]), m.paint, 'deck', 'paint');
  b.add(L.geometry(iC0, iC1, LJ[5], LJ[7]), m.dash, 'doorCards');
  b.add(L.geometry(iC1, iH0, LJ[5], LJ[7]), m.paint, 'cowl', 'paint');
  b.add(L.geometry(iH0, iH1, LJ[5], LJ[7]), m.paint, 'hood', 'paint');
  b.add(L.geometry(iH1, nL, LJ[5], LJ[7]), m.paint, 'nose', 'paint');
  const G = gh.grid;
  const GJ = gh.keyJ;
  const nG = G.ni - 1;
  const [iWs] = rowRange(gh.rowX, o.ws, 99);
  const [, iBk] = rowRange(gh.rowX, -99, o.back);
  const iQ = o.quarter !== undefined ? rowRange(gh.rowX, -99, o.quarter)[1] : 0;
  const iD = o.darkFrom !== undefined ? rowRange(gh.rowX, -99, o.darkFrom)[1] : iQ;
  if (iD > iQ) b.add(G.geometry(iQ, iD, 0, GJ[1]), m.glassDark, 'sideGlassRear');
  b.add(G.geometry(Math.max(iQ, iD), nG, 0, GJ[1]), m.glass, 'sideGlass');
  if (iQ > 0) b.add(G.geometry(0, iQ, 0, GJ[1]), o.pillarMat ?? m.paint, 'cPillar', o.pillarMat ? undefined : 'paint');
  b.add(G.geometry(0, nG, GJ[1], GJ[3]), o.pillarMat ?? m.paint, 'pillars', o.pillarMat ? undefined : 'paint');
  b.add(G.geometry(iWs, nG, GJ[3], GJ[5]), m.glass, 'windshield');
  b.add(G.geometry(iBk, iWs, GJ[3], GJ[5]), o.roofMat ?? m.paint, 'roof', o.roofMat ? undefined : 'paint');
  if (iBk > 0) b.add(G.geometry(0, iBk, GJ[3], GJ[5]), o.darkFrom !== undefined ? m.glassDark : m.glass, 'backlight');
  b.add(G.geometry(iBk, iWs, GJ[1], GJ[5], { offset: -0.012, flip: true }), m.headliner, 'headliner');
  b.add(gridLine(G, GJ[3], iWs, nG, 0.05, 0.0008), m.black, 'wsFrit');
  return { iWs, iBk, iQ, nG, iH0, iH1, rowOf };
}

/** Underbody: floor pan, tunnel, tank, front subframe; plus exhaust pipe runs to the given tips. */
export function underbody(b: Body, o: { x0: number; x1: number; w: number; y: number; tips: V3[] }) {
  const m = b.m;
  const len = o.x1 - o.x0;
  const cx = (o.x0 + o.x1) / 2;
  b.add(
    merge([
      place(new THREE.PlaneGeometry(len, o.w * 2).rotateX(Math.PI / 2), [cx, o.y, 0]),
      place(rbox(len * 0.5, 0.12, 0.26, 0.5), [cx + len * 0.05, o.y + 0.05, 0]),
      place(rbox(0.6, 0.18, o.w * 1.3, 0.4), [o.x0 + len * 0.25, o.y + 0.07, 0]),
      place(rbox(0.5, 0.25, o.w * 1.9, 0.5), [o.x1 - 0.35, o.y + 0.2, 0]),
    ]),
    m.under,
    'underbody',
  );
  for (const t of o.tips) {
    const z = t[2];
    b.add(tube([[o.x1 - 0.5, o.y + 0.02, -0.08 * Math.sign(z || 1)], [cx, o.y, z * 0.2], [o.x0 + 0.6, o.y + 0.01, z * 0.8], [t[0] + 0.12, t[1], z]], 0.028, 30, 8), m.metal, 'exhaustPipe');
    b.add(place(rbox(0.38, 0.14, 0.24, 0.5), [o.x0 + 0.45, o.y + 0.04, z * 0.9]), m.metal, 'muffler');
  }
}
