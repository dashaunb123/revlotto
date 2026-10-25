// Modelling toolkit for Cars C (tuner "Kaiju", 80s wedge, "Lamberghoul").
//
// A body is ONE smooth master surface S(u, v): planar rings along the car (u = x in metres), each ring a spline through K
// knots running from the sill (v = 0) up the side and over the top to the centreline (v = 1, z = 0). Every car drives its
// knots with 1D "character curves" of x (side profile, plan view, sections), so the shell is continuous across panels.
// Panels, glass, lamps and intakes are REGIONS of a surface cut by (u, v) polygons: a grid is tessellated, triangles outside
// the region are dropped and the straddling vertices snapped onto the cut (trims/seals laid on top hide the cut). Shut lines,
// seals and trims are ribbons laid on the surface along (u, v) paths; pockets (lamp housings, intakes, ducts) are walls + a
// back sunk along the normal. Everything is built for the left half (z >= 0) and mirrored.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import * as look from '../../materials';
import type { BodyBuild, CarSpec } from '../../types';

export type V2 = [number, number];
const V = () => new THREE.Vector3();

// ---------------------------------------------------------------------------------------------------------------
// 1D character curves

/** [x, y] keys; a third element 'c' makes a corner (one-sided tangents), a number forces the slope there. */
export type Key = [number, number] | [number, number, number | 'c'];

/** Monotone (no-overshoot) cubic through the keys, clamped outside. */
export function crv(keys: Key[]): (x: number) => number {
  const n = keys.length;
  const xs = keys.map((k) => k[0]);
  const ys = keys.map((k) => k[1]);
  const sec: number[] = [];
  for (let i = 0; i < n - 1; i++) sec.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const mL: number[] = [];
  const mR: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = keys[i][2];
    if (typeof f === 'number') {
      mL[i] = mR[i] = f;
      continue;
    }
    if (f === 'c' || i === 0 || i === n - 1) {
      mL[i] = i > 0 ? sec[i - 1] : sec[0];
      mR[i] = i < n - 1 ? sec[i] : sec[n - 2];
      continue;
    }
    const a = sec[i - 1];
    const b = sec[i];
    const h0 = xs[i] - xs[i - 1];
    const h1 = xs[i + 1] - xs[i];
    const w1 = 2 * h1 + h0;
    const w2 = h1 + 2 * h0;
    mL[i] = mR[i] = a * b <= 0 ? 0 : (w1 + w2) / (w1 / a + w2 / b);
  }
  if (n === 1) return () => ys[0];
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (xs[m] <= x) lo = m;
      else hi = m;
    }
    const h = xs[hi] - xs[lo];
    const t = (x - xs[lo]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h * mR[lo] + (-2 * t3 + 3 * t2) * ys[hi] + (t3 - t2) * h * mL[hi];
  };
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
export const sstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Rounded end factor: 1 well inside, falling to 0 at `end` along a superellipse of exponent n over length r. */
export function endRound(x: number, end: number, r: number, n = 2.4): number {
  const d = Math.abs(end - x);
  if (d >= r) return 1;
  const t = 1 - d / r;
  return Math.pow(Math.max(0, 1 - Math.pow(t, n)), 1 / n);
}

// ---------------------------------------------------------------------------------------------------------------
// Surfaces

export interface Surf {
  at(a: number, b: number, out: THREE.Vector3): THREE.Vector3;
  /** Parameter domain. */
  a0: number;
  a1: number;
  b0: number;
  b1: number;
  /** Approximate metres per unit of a / b (metric snapping and ribbon spacing). */
  sa: number;
  sb: number;
  /** Flip the derivative normal so it points outward. */
  flip?: boolean;
}

interface Ring {
  p: Float64Array; // y, z per knot
  mL: Float64Array; // tangent arriving at the knot (dy/dv, dz/dv)
  mR: Float64Array; // tangent leaving the knot
}

/** Rings along x: ring(x) returns knots [y0, z0, y1, z1, ...] from the sill (v = 0) to the top centreline (v = 1, z = 0). */
export class Loft implements Surf {
  a0: number;
  a1: number;
  b0 = 0;
  b1 = 1;
  sa = 1;
  sb: number;
  private cache = new Map<number, Ring>();
  constructor(
    private ring: (x: number) => number[],
    readonly vk: number[],
    x0: number,
    x1: number,
    private crease: boolean[] = [],
    sb = 1.8,
  ) {
    this.a0 = x0;
    this.a1 = x1;
    this.sb = sb;
  }
  knots(x: number): number[] {
    return this.ring(x);
  }
  private get(x: number): Ring {
    let r = this.cache.get(x);
    if (r) return r;
    if (this.cache.size > 6000) this.cache.clear();
    const p = Float64Array.from(this.ring(x));
    const K = p.length / 2;
    const vk = this.vk;
    const mL = new Float64Array(K * 2);
    const mR = new Float64Array(K * 2);
    const sy = (i: number) => (p[2 * i + 2] - p[2 * i]) / (vk[i + 1] - vk[i]);
    const sz = (i: number) => (p[2 * i + 3] - p[2 * i + 1]) / (vk[i + 1] - vk[i]);
    for (let k = 0; k < K; k++) {
      const cr = !!this.crease[k];
      if (k === 0) {
        mR[0] = sy(0);
        mR[1] = sz(0);
        mL[0] = mR[0];
        mL[1] = mR[1];
        continue;
      }
      if (k === K - 1) {
        // mirror-symmetric across the centreline (unless the centre is a ridge)
        const h = vk[k] - vk[k - 1];
        if (cr) {
          mL[2 * k] = sy(k - 1);
          mL[2 * k + 1] = sz(k - 1);
        } else {
          mL[2 * k] = 0;
          mL[2 * k + 1] = -p[2 * k - 1] / h;
        }
        mR[2 * k] = mL[2 * k];
        mR[2 * k + 1] = mL[2 * k + 1];
        continue;
      }
      const h0 = vk[k] - vk[k - 1];
      const h1 = vk[k + 1] - vk[k];
      const ay = sy(k - 1);
      const az = sz(k - 1);
      const by = sy(k);
      const bz = sz(k);
      if (cr) {
        mL[2 * k] = ay;
        mL[2 * k + 1] = az;
        mR[2 * k] = by;
        mR[2 * k + 1] = bz;
      } else {
        const my = (ay * h1 + by * h0) / (h0 + h1);
        const mz = (az * h1 + bz * h0) / (h0 + h1);
        mL[2 * k] = mR[2 * k] = my;
        mL[2 * k + 1] = mR[2 * k + 1] = mz;
      }
    }
    // limit tangents so short segments never loop (keeps the direction: G1)
    for (let k = 0; k < K - 1; k++) {
      const h = vk[k + 1] - vk[k];
      const c = Math.hypot(p[2 * k + 2] - p[2 * k], p[2 * k + 3] - p[2 * k + 1]);
      const lim = (m: Float64Array, i: number) => {
        const l = Math.hypot(m[2 * i], m[2 * i + 1]) * h;
        if (l > 1.6 * c && l > 0) {
          m[2 * i] *= (1.6 * c) / l;
          m[2 * i + 1] *= (1.6 * c) / l;
        }
      };
      lim(mR, k);
      lim(mL, k + 1);
    }
    r = { p, mL, mR };
    this.cache.set(x, r);
    return r;
  }
  at(u: number, v: number, out: THREE.Vector3): THREE.Vector3 {
    u = Math.min(this.a1, Math.max(this.a0, u));
    const r = this.get(u);
    const vk = this.vk;
    const K = vk.length;
    v = Math.min(1, Math.max(0, v));
    let k = 0;
    while (k < K - 2 && v > vk[k + 1]) k++;
    const h = vk[k + 1] - vk[k];
    const t = (v - vk[k]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const a = 2 * t3 - 3 * t2 + 1;
    const b = (t3 - 2 * t2 + t) * h;
    const c = -2 * t3 + 3 * t2;
    const d = (t3 - t2) * h;
    const p = r.p;
    const y = a * p[2 * k] + b * r.mR[2 * k] + c * p[2 * k + 2] + d * r.mL[2 * k + 2];
    const z = a * p[2 * k + 1] + b * r.mR[2 * k + 1] + c * p[2 * k + 3] + d * r.mL[2 * k + 3];
    return out.set(u, y, z);
  }
  /** v in [v0, v1] where the ring at x reaches height y (side features drawn in side view). */
  vAtY(x: number, y: number, v0: number, v1: number): number {
    return solve1(v0, v1, y, (v) => this.at(x, v, tmpA).y);
  }
  /** v in [v0, v1] where the ring at x reaches half-width z (top features drawn in plan view). */
  vAtZ(x: number, z: number, v0: number, v1: number): number {
    return solve1(v0, v1, z, (v) => this.at(x, v, tmpA).z);
  }
  /** Front/rear-view point (z, y) -> (u, v): the forward-most (front) or rear-most ring through it (nose/tail features). */
  endUV(z: number, y: number, front: boolean, depth = 0.9): V2 {
    const tip = front ? this.a1 : this.a0;
    const inner = front ? tip - depth : tip + depth;
    const ringPoly = (u: number): V2[] => {
      const r: V2[] = [];
      for (let i = 0; i <= 48; i++) {
        this.at(u, i / 48, tmpA);
        r.push([tmpA.z, tmpA.y]);
      }
      const b = r[0];
      r.push([0, r[48][1]], [0, b[1]]);
      return r;
    };
    const zz = Math.max(1e-4, z);
    let out = tip;
    let inn = NaN;
    const steps = 90;
    for (let i = 1; i <= steps; i++) {
      const u = lerp(tip, inner, i / steps);
      if (inPoly(ringPoly(u), zz, y)) {
        inn = u;
        break;
      }
      out = u;
    }
    let u = out;
    if (!isNaN(inn)) {
      let a = out;
      let b = inn;
      for (let j = 0; j < 30; j++) {
        const m = (a + b) / 2;
        if (inPoly(ringPoly(m), zz, y)) b = m;
        else a = m;
      }
      u = (a + b) / 2;
    }
    // closest v on that ring
    let bv = 0;
    let bd = Infinity;
    for (let i = 0; i <= 400; i++) {
      this.at(u, i / 400, tmpA);
      const d = (tmpA.z - zz) ** 2 + (tmpA.y - y) ** 2;
      if (d < bd) {
        bd = d;
        bv = i / 400;
      }
    }
    // centreline points of an end face map to the domain's mirror edge: the tip ring itself (all z = 0) when it spans y,
    // else the top centreline (v = 1) where it passes y. Pushed past the edge so mirrored halves join.
    if (z <= 1e-3) {
      const yLo = this.at(tip, 0, tmpA).y;
      const yHi = this.at(tip, 1, tmpA).y;
      // below the tip ring (chin lips etc.): its bottom end, never a jump up to the top centreline
      if (y < Math.min(yLo, yHi)) return [front ? tip + 0.02 : tip - 0.02, yLo <= yHi ? 0 : 1];
      if (y <= Math.max(yLo, yHi) + 1e-4) {
        let tv = 0;
        let td = Infinity;
        for (let i = 0; i <= 400; i++) {
          const d = Math.abs(this.at(tip, i / 400, tmpA).y - y);
          if (d < td) {
            td = d;
            tv = i / 400;
          }
        }
        return [front ? tip + 0.02 : tip - 0.02, tv];
      }
      const uc = solve1(tip, inner, y, (uu) => this.at(uu, 1, tmpA).y);
      return [uc, this.b1 + 0.03];
    }
    if (isNaN(inn)) {
      // outside the silhouette: nearest surface point in the scanned range
      let best: V2 = [u, bv];
      let bd2 = Infinity;
      for (let i = 0; i <= 60; i++)
        for (let j = 0; j <= 60; j++) {
          const uu = lerp(tip, inner, i / 60);
          this.at(uu, j / 60, tmpA);
          const d = (tmpA.z - zz) ** 2 + (tmpA.y - y) ** 2 - (front ? uu : -uu) * 1e-6;
          if (d < bd2) {
            bd2 = d;
            best = [uu, j / 60];
          }
        }
      return best;
    }
    return [u, bv];
  }
  /** Front (or rear) view outline [z, y][] -> (u, v). */
  face(pts: V2[], front = true, depth = 0.9): V2[] {
    return pts.map(([z, y]) => this.endUV(z, y, front, depth));
  }
  /** Side-view outline [x, y][] -> (u, v) on the side band [v0, v1]. */
  side(pts: V2[], v0: number, v1: number): V2[] {
    return pts.map(([x, y]) => [x, this.vAtY(x, y, v0, v1)] as V2);
  }
  /** Plan-view outline [x, z][] -> (u, v) on the top band [v0, v1]. */
  top(pts: V2[], v0: number, v1: number): V2[] {
    return pts.map(([x, z]) => [x, this.vAtZ(x, z, v0, v1)] as V2);
  }
}
const tmpA = V();

function solve1(lo: number, hi: number, target: number, f: (t: number) => number): number {
  const N = 40;
  let pa = lo;
  let fa = f(lo) - target;
  let best = lo;
  let bestE = Math.abs(fa);
  for (let i = 1; i <= N; i++) {
    const pb = lo + ((hi - lo) * i) / N;
    const fb = f(pb) - target;
    if (Math.abs(fb) < bestE) {
      bestE = Math.abs(fb);
      best = pb;
    }
    if (fa * fb <= 0) {
      let a = pa;
      let b = pb;
      let fA = fa;
      for (let j = 0; j < 40; j++) {
        const m = (a + b) / 2;
        const fm = f(m) - target;
        if (fA * fm <= 0) b = m;
        else {
          a = m;
          fA = fm;
        }
      }
      return (a + b) / 2;
    }
    pa = pb;
    fa = fb;
  }
  return best;
}

/** Bilinearly blended Coons patch from four boundary curves (+ an optional bulge), s,t in [0,1]. */
export class Coons implements Surf {
  a0 = 0;
  a1 = 1;
  b0 = 0;
  b1 = 1;
  sa: number;
  sb: number;
  flip?: boolean;
  private c00 = V();
  private c10 = V();
  private c01 = V();
  private c11 = V();
  private t1 = V();
  private t2 = V();
  constructor(
    /** t = 0 edge, s from 0 to 1 */ private bot: (s: number, o: THREE.Vector3) => THREE.Vector3,
    /** t = 1 edge */ private topE: (s: number, o: THREE.Vector3) => THREE.Vector3,
    /** s = 0 edge, t from 0 to 1 */ private left: (t: number, o: THREE.Vector3) => THREE.Vector3,
    /** s = 1 edge */ private right: (t: number, o: THREE.Vector3) => THREE.Vector3,
    private bulge?: (s: number, t: number, o: THREE.Vector3) => void,
    outward?: THREE.Vector3,
  ) {
    bot(0, this.c00);
    bot(1, this.c10);
    topE(0, this.c01);
    topE(1, this.c11);
    this.sa = this.c00.distanceTo(this.c10) * 0.5 + this.c01.distanceTo(this.c11) * 0.5 || 1;
    this.sb = this.c00.distanceTo(this.c01) * 0.5 + this.c10.distanceTo(this.c11) * 0.5 || 1;
    if (outward) {
      const n = surfNormal(this, 0.5, 0.5, 0, 1, 0, 1, V());
      this.flip = n.dot(outward) < 0;
    }
  }
  at(s: number, t: number, out: THREE.Vector3): THREE.Vector3 {
    const { t1, t2 } = this;
    out.set(0, 0, 0);
    out.addScaledVector(this.bot(s, t1), 1 - t).addScaledVector(this.topE(s, t1), t);
    out.addScaledVector(this.left(t, t2), 1 - s).addScaledVector(this.right(t, t2), s);
    out.addScaledVector(this.c00, -(1 - s) * (1 - t)).addScaledVector(this.c10, -s * (1 - t));
    out.addScaledVector(this.c01, -(1 - s) * t).addScaledVector(this.c11, -s * t);
    if (this.bulge) {
      this.bulge(s, t, t1.set(0, 0, 0));
      out.add(t1);
    }
    return out;
  }
}

/** A surface's iso-curve as a curve function (for Coons boundaries). */
export function isoA(s: Surf, a: number, b0: number, b1: number) {
  return (t: number, o: THREE.Vector3) => s.at(a, lerp(b0, b1, t), o);
}
export function isoB(s: Surf, b: number, a0: number, a1: number) {
  return (t: number, o: THREE.Vector3) => s.at(lerp(a0, a1, t), b, o);
}
export function line3(p: THREE.Vector3, q: THREE.Vector3) {
  return (t: number, o: THREE.Vector3) => o.copy(p).lerp(q, t);
}
/** Catmull-Rom 3D curve through points (centripetal) as a curve function. */
export function curve3(pts: THREE.Vector3[]) {
  const c = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  return (t: number, o: THREE.Vector3) => c.getPoint(Math.min(1, Math.max(0, t)), o);
}

const nA = V();
const nB = V();
const nC = V();
const nD = V();
/** Outward unit normal from the parametric derivatives, differences kept inside [A0,A1]x[B0,B1] (crisp creases). */
export function surfNormal(s: Surf, a: number, b: number, A0: number, A1: number, B0: number, B1: number, out: THREE.Vector3): THREE.Vector3 {
  for (let tries = 0; tries < 4; tries++) {
    const ha = (A1 - A0) * 2e-4 + 1e-7;
    const hb = (B1 - B0) * 2e-4 + 1e-7;
    const a1 = Math.min(A1, a + ha);
    const a0 = Math.max(A0, a - ha);
    const b1 = Math.min(B1, b + hb);
    const b0 = Math.max(B0, b - hb);
    s.at(a1, b, nA).sub(s.at(a0, b, nB)).multiplyScalar(1 / (a1 - a0));
    s.at(a, b1, nC).sub(s.at(a, b0, nD)).multiplyScalar(1 / (b1 - b0));
    out.crossVectors(nA, nC);
    const l = out.length();
    if (l > 1e-9 * (nA.length() * nC.length() + 1e-12) && l > 1e-12) {
      out.multiplyScalar((s.flip ? -1 : 1) / l);
      return out;
    }
    // degenerate (collapsed edge): step toward the block centre and retry
    a = lerp(a, (A0 + A1) / 2, 0.02 * (tries + 1));
    b = lerp(b, (B0 + B1) / 2, 0.02 * (tries + 1));
  }
  return out.set(0, 1, 0);
}

// ---------------------------------------------------------------------------------------------------------------
// 2D polygon utilities (parameter space)

export function inPoly(poly: V2[], a: number, b: number): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > b !== yj > b && a < ((xj - xi) * (b - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function nearestOn(polys: V2[][], a: number, b: number, sa: number, sb: number): V2 {
  let best: V2 = [a, b];
  let bd = Infinity;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const ax = poly[j][0] * sa;
      const ay = poly[j][1] * sb;
      const bx = poly[i][0] * sa;
      const by = poly[i][1] * sb;
      const px = a * sa;
      const py = b * sb;
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy || 1e-18;
      const t = clamp01(((px - ax) * dx + (py - ay) * dy) / l2);
      const qx = ax + dx * t;
      const qy = ay + dy * t;
      const d = (qx - px) ** 2 + (qy - py) ** 2;
      if (d < bd) {
        bd = d;
        best = [qx / sa, qy / sb];
      }
    }
  }
  return best;
}

/** Catmull-Rom smoothing of a 2D polyline (n points per segment). */
export function smooth2(pts: V2[], closed = true, n = 6): V2[] {
  const out: V2[] = [];
  const m = pts.length;
  const P = (i: number) => (closed ? pts[(i + m) % m] : pts[Math.min(m - 1, Math.max(0, i))]);
  const segs = closed ? m : m - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (j: 0 | 1) =>
        0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
      out.push([f(0), f(1)]);
    }
  }
  if (!closed) out.push(pts[m - 1]);
  return out;
}

export function ellipse2(cx: number, cy: number, rx: number, ry: number, n = 32, rot = 0): V2[] {
  const out: V2[] = [];
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = Math.cos(t) * rx;
    const y = Math.sin(t) * ry;
    out.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return out;
}

/** Rounded polygon: corners filleted with radius r (same units as the points), n arc steps. */
export function roundPoly(pts: V2[], r: number | number[], n = 5): V2[] {
  const out: V2[] = [];
  const m = pts.length;
  for (let i = 0; i < m; i++) {
    const p = pts[i];
    const a = pts[(i - 1 + m) % m];
    const b = pts[(i + 1) % m];
    const rr = Array.isArray(r) ? r[i] : r;
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const k = Math.min(rr, da * 0.45, db * 0.45);
    if (k <= 1e-6) {
      out.push(p);
      continue;
    }
    const pa: V2 = [p[0] + ((a[0] - p[0]) / da) * k, p[1] + ((a[1] - p[1]) / da) * k];
    const pb: V2 = [p[0] + ((b[0] - p[0]) / db) * k, p[1] + ((b[1] - p[1]) / db) * k];
    for (let j = 0; j <= n; j++) {
      const t = j / n;
      // quadratic Bezier pa -> p -> pb
      out.push([(1 - t) ** 2 * pa[0] + 2 * (1 - t) * t * p[0] + t * t * pb[0], (1 - t) ** 2 * pa[1] + 2 * (1 - t) * t * p[1] + t * t * pb[1]]);
    }
  }
  return out;
}

/** Outside the surface domain (a feature's mirror edge: past the top centreline or past a tip). */
function outsideDom(p: V2, s?: { a0: number; a1: number; b1: number }): boolean {
  return p[1] > (s?.b1 ?? 1) + 1e-9 || (!!s && (p[0] > s.a1 + 1e-9 || p[0] < s.a0 - 1e-9));
}

/** A closed outline as an open path that skips its mirror edge (points outside the domain), for seals/trims on mirrored features. */
export function openPath(poly: V2[], s?: { a0: number; a1: number; b1: number }): V2[] {
  const n = poly.length;
  const out = (p: V2) => outsideDom(p, s);
  let start = -1;
  for (let i = 0; i < n; i++) if (out(poly[i]) && !out(poly[(i + 1) % n])) start = (i + 1) % n;
  if (start < 0) return [...poly, poly[0]];
  const res: V2[] = [poly[(start - 1 + n) % n]];
  for (let k = 0; k < n; k++) {
    const p = poly[(start + k) % n];
    res.push(p);
    if (out(p)) break;
  }
  return res;
}

/** Densify a polyline in metric parameter space to ~step metres. */
function densify(path: V2[], closed: boolean, sa: number, sb: number, step: number): V2[] {
  const out: V2[] = [];
  const m = path.length;
  const segs = closed ? m : m - 1;
  for (let i = 0; i < segs; i++) {
    const p = path[i];
    const q = path[(i + 1) % m];
    const d = Math.hypot((q[0] - p[0]) * sa, (q[1] - p[1]) * sb);
    const n = Math.max(1, Math.ceil(d / step));
    for (let k = 0; k < n; k++) out.push([lerp(p[0], q[0], k / n), lerp(p[1], q[1], k / n)]);
  }
  if (!closed) out.push(path[m - 1]);
  return out;
}

/** Evenly spaced samples in [a, b] with roughly `step` spacing (always includes both ends). */
export function span(a: number, b: number, step: number): number[] {
  const n = Math.max(1, Math.ceil(Math.abs(b - a) / step));
  return Array.from({ length: n + 1 }, (_, i) => lerp(a, b, i / n));
}
/** Concatenate sample runs (dedupes joins) and sort. */
export function runs(...rs: number[][]): number[] {
  const all = rs.flat().sort((p, q) => p - q);
  return all.filter((x, i) => i === 0 || x - all[i - 1] > 1e-9);
}
/** Samples along a surface's a-axis (b fixed at each of `bs`) spaced by the LARGEST arc length among those iso-curves, so
 *  regions where the shape moves fast (rounded or chopped ends) get dense samples. */
export function arcSamplesMulti(s: Surf, bs: number[], a0: number, a1: number, step: number, fine = 600, axis: 'a' | 'b' = 'a'): number[] {
  const p = V();
  const q = V();
  const acc: number[] = [0];
  const xs: number[] = [a0];
  const prev = bs.map((b) => (axis === 'a' ? s.at(a0, b, V()) : s.at(b, a0, V())));
  // fine steps cluster toward both ends (chopped / rounded ends change fastest there)
  const w = (t: number) => t - (0.92 * Math.sin(2 * Math.PI * t)) / (2 * Math.PI);
  for (let i = 1; i <= fine; i++) {
    const a = lerp(a0, a1, w(i / fine));
    let d = 0;
    bs.forEach((b, k) => {
      if (axis === 'a') s.at(a, b, q);
      else s.at(b, a, q);
      d = Math.max(d, q.distanceTo(prev[k]));
      prev[k].copy(q);
    });
    acc.push(acc[i - 1] + d);
    xs.push(a);
  }
  void p;
  const L = acc[fine];
  const n = Math.max(1, Math.ceil(L / step));
  const out: number[] = [];
  let j = 0;
  for (let i = 0; i <= n; i++) {
    const d = (L * i) / n;
    while (j < fine - 1 && acc[j + 1] < d) j++;
    const t = (d - acc[j]) / (acc[j + 1] - acc[j] || 1);
    out.push(lerp(xs[j], xs[j + 1], clamp01(t)));
  }
  return out;
}
export function arcSamples(s: Surf, b: number, a0: number, a1: number, step: number, fine = 600): number[] {
  return arcSamplesMulti(s, [b], a0, a1, step, fine);
}

// ---------------------------------------------------------------------------------------------------------------
// Tessellation

export interface GridOpts {
  as: number[];
  bs: number[];
  /** Hard edges: normals are split at these a / b values (inserted into the samples). */
  creaseA?: number[];
  creaseB?: number[];
  /** Keep inside any `inc` polygon (if given) and outside every `exc` polygon, in (a, b) space. */
  inc?: V2[][];
  exc?: V2[][];
  /** Offset along the normal (m). */
  offset?: number;
  /** Mirror to the right half (default true). */
  mirror?: boolean;
  /** Turn faces inside-out (interior skins). */
  inside?: boolean;
  /** Displace along the normal by f(a, b) (m), e.g. louvre ribs or a domed lens. */
  disp?: (a: number, b: number) => number;
}

interface Geo {
  pos: number[];
  nor: number[];
  uv: number[];
  idx: number[];
}
const newGeo = (): Geo => ({ pos: [], nor: [], uv: [], idx: [] });

function toBuffer(g: Geo): THREE.BufferGeometry {
  const b = new THREE.BufferGeometry();
  b.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
  b.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
  b.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
  b.setIndex(g.idx);
  return b;
}

/** Append the z-mirrored copy (reversed winding). */
function mirrorGeo(g: Geo) {
  const n = g.pos.length / 3;
  for (let i = 0; i < n; i++) {
    g.pos.push(g.pos[3 * i], g.pos[3 * i + 1], -g.pos[3 * i + 2]);
    g.nor.push(g.nor[3 * i], g.nor[3 * i + 1], -g.nor[3 * i + 2]);
    g.uv.push(g.uv[2 * i], g.uv[2 * i + 1]);
  }
  const m = g.idx.length;
  for (let i = 0; i < m; i += 3) g.idx.push(g.idx[i] + n, g.idx[i + 2] + n, g.idx[i + 1] + n);
}

function splitAt(xs: number[], cr: number[] | undefined): number[][] {
  let all = runs(xs, cr ?? []);
  const lo = xs[0];
  const hi = xs[xs.length - 1];
  all = all.filter((x) => x >= lo - 1e-12 && x <= hi + 1e-12);
  const cuts = (cr ?? []).filter((c) => c > lo + 1e-9 && c < hi - 1e-9).sort((p, q) => p - q);
  const blocks: number[][] = [];
  let cur: number[] = [];
  let ci = 0;
  for (const x of all) {
    cur.push(x);
    if (ci < cuts.length && Math.abs(x - cuts[ci]) < 1e-9) {
      blocks.push(cur);
      cur = [x];
      ci++;
    }
  }
  if (cur.length > 1) blocks.push(cur);
  return blocks;
}

const gP = V();
const gN = V();
/** Tessellate a (masked) region of a surface. */
export function gridGeo(s: Surf, o: GridOpts): THREE.BufferGeometry {
  const g = newGeo();
  const off = o.offset ?? 0;
  const keep = (a: number, b: number) => (!o.inc || o.inc.some((p) => inPoly(p, a, b))) && !(o.exc ?? []).some((p) => inPoly(p, a, b));
  const aMin = o.as[0];
  const aMax = o.as[o.as.length - 1];
  const bMin = o.bs[0];
  const bMax = o.bs[o.bs.length - 1];
  for (const A of splitAt(o.as, o.creaseA)) {
    for (const B of splitAt(o.bs, o.creaseB)) {
      const na = A.length;
      const nb = B.length;
      const A0 = A[0];
      const A1 = A[na - 1];
      const B0 = B[0];
      const B1 = B[nb - 1];
      const pa = new Float64Array(na * nb);
      const pb = new Float64Array(na * nb);
      const ok = new Uint8Array(na * nb);
      for (let i = 0; i < na; i++)
        for (let j = 0; j < nb; j++) {
          const k = i * nb + j;
          pa[k] = A[i];
          pb[k] = B[j];
          ok[k] = keep(A[i], B[j]) ? 1 : 0;
        }
      const tris: number[] = [];
      const snap = new Uint8Array(na * nb);
      const tri = (x: number, y: number, z: number) => {
        const c = ok[x] + ok[y] + ok[z];
        if (c === 0) return;
        if (c < 3) for (const v of [x, y, z]) if (!ok[v]) snap[v] = 1;
        tris.push(x, y, z);
      };
      for (let i = 0; i < na - 1; i++)
        for (let j = 0; j < nb - 1; j++) {
          const k00 = i * nb + j;
          const k10 = k00 + nb;
          const k11 = k10 + 1;
          const k01 = k00 + 1;
          // alternate the diagonal for a less directional mesh
          if ((i + j) & 1) {
            tri(k00, k10, k11);
            tri(k00, k11, k01);
          } else {
            tri(k00, k10, k01);
            tri(k10, k11, k01);
          }
        }
      // snap failing vertices of straddling triangles onto the cut
      const area0 = (t: number) => {
        const [x, y, z] = [tris[t], tris[t + 1], tris[t + 2]];
        return (pa[y] - pa[x]) * s.sa * ((pb[z] - pb[x]) * s.sb) - (pb[y] - pb[x]) * s.sb * ((pa[z] - pa[x]) * s.sa);
      };
      const before = tris.map((_, i) => (i % 3 === 0 ? area0(i) : 0));
      for (let k = 0; k < na * nb; k++) {
        if (!snap[k]) continue;
        const a = pa[k];
        const b = pb[k];
        const ex = (o.exc ?? []).filter((p) => inPoly(p, a, b));
        const target = ex.length ? ex : o.inc ?? [];
        const q = nearestOn(target, a, b, s.sa, s.sb);
        pa[k] = Math.min(A1, Math.max(A0, q[0]));
        pb[k] = Math.min(B1, Math.max(B0, q[1]));
      }
      const base = g.pos.length / 3;
      const used = new Int32Array(na * nb).fill(-1);
      const emit = (k: number) => {
        if (used[k] >= 0) return used[k];
        const a = pa[k];
        const b = pb[k];
        s.at(a, b, gP);
        surfNormal(s, a, b, A0, A1, B0, B1, gN);
        const d = off + (o.disp ? o.disp(a, b) : 0);
        if (d) gP.addScaledVector(gN, d);
        if (o.inside) gN.negate();
        const id = g.pos.length / 3;
        g.pos.push(gP.x, gP.y, gP.z);
        g.nor.push(gN.x, gN.y, gN.z);
        g.uv.push((a - aMin) / (aMax - aMin || 1), (b - bMin) / (bMax - bMin || 1));
        used[k] = id;
        return id;
      };
      for (let t = 0; t < tris.length; t += 3) {
        const ar = area0(t);
        if (Math.abs(ar) < 1e-10 || ar * before[t] < 0) continue;
        const x = emit(tris[t]);
        const y = emit(tris[t + 1]);
        const z = emit(tris[t + 2]);
        // winding follows the outward normal (flip surfaces wind the other way)
        const fl = !!s.flip !== !!o.inside;
        if (fl) g.idx.push(x, z, y);
        else g.idx.push(x, y, z);
      }
      void base;
    }
  }
  if (o.mirror !== false) mirrorGeo(g);
  return toBuffer(g);
}

export interface RibbonOpts {
  width: number;
  lift?: number;
  closed?: boolean;
  /** 'flat' strip, 'round' raised bead (seals, trims), 'groove' dark gap line (sits flat). */
  prof?: 'flat' | 'round' | 'groove';
  /** Bead height for 'round'. */
  bump?: number;
  step?: number;
  mirror?: boolean;
  /** Shift the strip sideways (m, + = left of the path direction when seen from outside). */
  shift?: number;
}

/** A strip laid on the surface along a (a, b) path: shut lines, window seals, trims, flares. */
export function ribbon(s: Surf, path: V2[], o: RibbonOpts): THREE.BufferGeometry {
  const g = newGeo();
  const pts = densify(path, !!o.closed, s.sa, s.sb, o.step ?? 0.02);
  const n = pts.length;
  const P: THREE.Vector3[] = [];
  const N: THREE.Vector3[] = [];
  for (const [a, b] of pts) {
    P.push(s.at(a, b, V()));
    N.push(surfNormal(s, a, b, s.a0, s.a1, s.b0, s.b1, V()));
  }
  const prof = o.prof ?? 'flat';
  const cs = prof === 'round' ? [-1, 0, 1] : [-1, 1];
  const lift = o.lift ?? 0.0006;
  const bump = o.bump ?? o.width * 0.35;
  const T = V();
  const side = V();
  const q = V();
  const nn = V();
  const cols = cs.length;
  const total = o.closed ? n + 1 : n;
  for (let ii = 0; ii < total; ii++) {
    const i = ii % n;
    const ip = o.closed ? (i + 1) % n : Math.min(n - 1, i + 1);
    const im = o.closed ? (i - 1 + n) % n : Math.max(0, i - 1);
    T.subVectors(P[ip], P[im]);
    side.crossVectors(N[i], T).normalize();
    for (const c of cs) {
      const h = prof === 'round' ? bump * (1 - c * c) : 0;
      q.copy(P[i])
        .addScaledVector(N[i], lift + h)
        .addScaledVector(side, (c * o.width) / 2 + (o.shift ?? 0));
      nn.copy(N[i]);
      if (prof === 'round') nn.addScaledVector(side, c * 1.2).normalize();
      g.pos.push(q.x, q.y, q.z);
      g.nor.push(nn.x, nn.y, nn.z);
      g.uv.push(ii / (total - 1), (c + 1) / 2);
    }
  }
  for (let i = 0; i < total - 1; i++)
    for (let c = 0; c < cols - 1; c++) {
      const a = i * cols + c;
      const b = (i + 1) * cols + c;
      g.idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  if (o.mirror !== false) mirrorGeo(g);
  return toBuffer(g);
}

export interface PocketOpts {
  depth: number;
  /** Rim height above the surface. */
  lift?: number;
  /** Shrink the bottom toward the outline centre (0..1) for sloped walls. */
  taper?: number;
  mirror?: boolean;
  /** Back-face grid step (m). */
  step?: number;
  /** Back-face grid step (m). */
  backStep?: number;
  /** Displace the back by f(a, b) (m, along the normal). */
  backDisp?: (a: number, b: number) => number;
}

/** A recess cut into a surface: side walls + a back following the surface `depth` below it. */
export function pocketGeo(s: Surf, outline: V2[], o: PocketOpts): { wall: THREE.BufferGeometry; back: THREE.BufferGeometry } {
  const g = newGeo();
  const pts = densify(outline, true, s.sa, s.sb, o.step ?? 0.016);
  const n = pts.length;
  let ca = 0;
  let cb = 0;
  for (const [a, b] of pts) {
    ca += a / n;
    cb += b / n;
  }
  const taper = o.taper ?? 0;
  const lift = o.lift ?? 0.001;
  const top: THREE.Vector3[] = [];
  const bot: THREE.Vector3[] = [];
  const nrm: THREE.Vector3[] = [];
  for (const [a, b] of pts) {
    const p = s.at(a, b, V());
    const nn = surfNormal(s, a, b, s.a0, s.a1, s.b0, s.b1, V());
    top.push(p.clone().addScaledVector(nn, lift));
    const a2 = lerp(a, ca, taper);
    const b2 = lerp(b, cb, taper);
    const p2 = s.at(a2, b2, V());
    const n2 = surfNormal(s, a2, b2, s.a0, s.a1, s.b0, s.b1, V());
    bot.push(p2.addScaledVector(n2, -o.depth + (o.backDisp ? o.backDisp(a2, b2) : 0)));
    nrm.push(nn);
  }
  // orientation: wall normals face the pocket interior
  const cen = s.at(ca, cb, V());
  const T = V();
  const sd = V();
  let sign = 0;
  for (let i = 0; i < n; i++) {
    T.subVectors(top[(i + 1) % n], top[(i - 1 + n) % n]);
    sd.crossVectors(nrm[i], T);
    sign += sd.dot(V().subVectors(cen, top[i])) > 0 ? 1 : -1;
  }
  const sg = sign >= 0 ? 1 : -1;
  for (let ii = 0; ii <= n; ii++) {
    const i = ii % n;
    T.subVectors(top[(i + 1) % n], top[(i - 1 + n) % n]);
    sd.crossVectors(nrm[i], T).normalize().multiplyScalar(sg);
    for (const p of [top[i], bot[i]]) {
      g.pos.push(p.x, p.y, p.z);
      g.nor.push(sd.x, sd.y, sd.z);
      g.uv.push(ii / n, p === top[i] ? 1 : 0);
    }
  }
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    const b = a + 2;
    // no wall along the centreline (features that cross it are drawn as a half and mirrored)
    if (outsideDom(pts[i], s) && outsideDom(pts[(i + 1) % n], s)) continue;
    if (sg > 0) g.idx.push(a, b, a + 1, b, b + 1, a + 1);
    else g.idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  if (o.mirror !== false) mirrorGeo(g);
  const wall = toBuffer(g);
  // back: the outline region (shrunk by taper) sunk along the normal
  const inner: V2[] = outline.map(([a, b]) => [lerp(a, ca, taper), lerp(b, cb, taper)]);
  const back = gridGeo(s, {
    ...bboxGrid(s, inner, o.backStep ?? 0.028),
    inc: [inner],
    offset: -o.depth,
    disp: o.backDisp,
    mirror: o.mirror,
  });
  return { wall, back };
}

/** Grid samples covering a polygon's bounding box (clamped to the surface domain). */
export function bboxGrid(s: Surf, poly: V2[], step: number): { as: number[]; bs: number[] } {
  let a0 = Infinity;
  let a1 = -Infinity;
  let b0 = Infinity;
  let b1 = -Infinity;
  for (const [a, b] of poly) {
    a0 = Math.min(a0, a);
    a1 = Math.max(a1, a);
    b0 = Math.min(b0, b);
    b1 = Math.max(b1, b);
  }
  const ma = (a1 - a0) * 0.02 + 1e-5;
  const mb = (b1 - b0) * 0.02 + 1e-5;
  a0 = Math.max(s.a0, a0 - ma);
  a1 = Math.min(s.a1, a1 + ma);
  b0 = Math.max(s.b0, b0 - mb);
  b1 = Math.min(s.b1, b1 + mb);
  const am = (a0 + a1) / 2;
  const bm = (b0 + b1) / 2;
  return { as: arcSamplesMulti(s, [b0, bm, b1], a0, a1, step, 200), bs: arcSamplesMulti(s, [a0, am, a1], b0, b1, step, 200, 'b') };
}

/** A region of a surface (lens, glass, insert): the polygon tessellated on its own fine grid. */
export function patchGeo(s: Surf, poly: V2[], o: { offset?: number; step?: number; mirror?: boolean; disp?: (a: number, b: number) => number; exc?: V2[][] } = {}): THREE.BufferGeometry {
  return gridGeo(s, { ...bboxGrid(s, poly, o.step ?? 0.015), inc: [poly], exc: o.exc, offset: o.offset, mirror: o.mirror, disp: o.disp });
}

/** Numeric inverse: find (a, b) whose projection proj(S(a, b)) hits target (front-view features etc.). */
export function invert(s: Surf, proj: (p: THREE.Vector3) => V2, target: V2, aR: V2 = [s.a0, s.a1], bR: V2 = [s.b0, s.b1], prefer?: (p: THREE.Vector3) => number): V2 {
  const p = V();
  let best: V2 = [(aR[0] + aR[1]) / 2, (bR[0] + bR[1]) / 2];
  let bd = Infinity;
  const N = 36;
  for (let i = 0; i <= N; i++)
    for (let j = 0; j <= N; j++) {
      const a = lerp(aR[0], aR[1], i / N);
      const b = lerp(bR[0], bR[1], j / N);
      const q = proj(s.at(a, b, p));
      let d = (q[0] - target[0]) ** 2 + (q[1] - target[1]) ** 2;
      if (prefer) d -= prefer(p) * 1e-6;
      if (d < bd) {
        bd = d;
        best = [a, b];
      }
    }
  let [a, b] = best;
  for (let it = 0; it < 30; it++) {
    const f = proj(s.at(a, b, p));
    const ex = f[0] - target[0];
    const ey = f[1] - target[1];
    if (ex * ex + ey * ey < 1e-14) break;
    const ha = (aR[1] - aR[0]) * 1e-4;
    const hb = (bR[1] - bR[0]) * 1e-4;
    const fa = proj(s.at(a + ha, b, p));
    const fb = proj(s.at(a, b + hb, p));
    const j00 = (fa[0] - f[0]) / ha;
    const j10 = (fa[1] - f[1]) / ha;
    const j01 = (fb[0] - f[0]) / hb;
    const j11 = (fb[1] - f[1]) / hb;
    const det = j00 * j11 - j01 * j10;
    if (Math.abs(det) < 1e-14) break;
    let da = (j11 * ex - j01 * ey) / det;
    let db = (-j10 * ex + j00 * ey) / det;
    const lim = 0.25;
    const sc = Math.max(1, Math.abs(da) / ((aR[1] - aR[0]) * lim), Math.abs(db) / ((bR[1] - bR[0]) * lim));
    da /= sc;
    db /= sc;
    a = Math.min(aR[1], Math.max(aR[0], a - da));
    b = Math.min(bR[1], Math.max(bR[0], b - db));
  }
  return [a, b];
}

/** Map a front-view outline [z, y][] onto a surface (prefers the forward-most hit). */
export function frontUV(s: Surf, pts: V2[], aR?: V2, bR?: V2, dir = 1): V2[] {
  return pts.map((t) => {
    const r = invert(s, (p) => [p.z, p.y], t, aR, bR, (p) => p.x * dir);
    // points on the centreline: push past the domain edge so the mirrored halves join (see pocketGeo / openPath)
    if (t[0] <= 1e-3) r[1] = s.b1 + 0.03;
    return r;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Primitive parts

export function rbox(w: number, h: number, d: number, r: number, seg = 2): THREE.BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
}

/** Transform a geometry in place and return it. */
export function place(g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
  g.applyMatrix4(m);
  return g;
}

/** Mirror copy across z (positions + normals + winding), merged with the original. */
export function withMirror(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const m = g.clone().applyMatrix4(new THREE.Matrix4().makeScale(1, 1, -1));
  // applyMatrix4 with a negative determinant leaves the winding flipped: fix it
  const idx = m.getIndex();
  if (idx) {
    const a = idx.array as ArrayLike<number> & { [i: number]: number };
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = t;
    }
    idx.needsUpdate = true;
  } else {
    const pos = m.getAttribute('position');
    const nor = m.getAttribute('normal');
    const uv = m.getAttribute('uv');
    for (let i = 0; i < pos.count; i += 3) {
      for (const at of [pos, nor, uv]) {
        if (!at) continue;
        for (let c = 0; c < at.itemSize; c++) {
          const t = at.getComponent(i + 1, c);
          at.setComponent(i + 1, c, at.getComponent(i + 2, c));
          at.setComponent(i + 2, c, t);
        }
      }
    }
  }
  return merge([g, m]);
}

/** Merge geometries (normalises to indexed position/normal/uv). */
export function merge(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const norm = gs.map((g) => {
    let h = g.index ? g : g;
    if (!h.getAttribute('normal')) h.computeVertexNormals();
    if (!h.getAttribute('uv')) h.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(h.getAttribute('position').count * 2), 2));
    if (!h.index) {
      const n = h.getAttribute('position').count;
      h.setIndex(Array.from({ length: n }, (_, i) => i));
    }
    for (const k of Object.keys(h.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') h.deleteAttribute(k);
    h.morphAttributes = {};
    return h;
  });
  const m = mergeGeometries(norm, false) ?? new THREE.BufferGeometry();
  for (const g of gs) g.dispose();
  return m;
}

/** Tube through points (wipers, rails, pipes). */
export function tubeGeo(pts: THREE.Vector3[], r: number, radial = 8, seg = 24, closed = false): THREE.BufferGeometry {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed, 'centripetal'), seg, r, radial, closed);
}

/** Extruded side profile (y up) across z from z0 to z1, with a small bevel. */
export function slab(shape: V2[], z0: number, z1: number, bevel = 0.004): THREE.BufferGeometry {
  const sh = new THREE.Shape(shape.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(1e-4, z1 - z0 - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, z0 + bevel);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------
// Materials + assembly

export type MatKey =
  | 'paint'
  | 'hood'
  | 'glass'
  | 'glassDark'
  | 'chrome'
  | 'blackChrome'
  | 'trim'
  | 'gloss'
  | 'rubber'
  | 'gap'
  | 'liner'
  | 'under'
  | 'grille'
  | 'grilleMesh'
  | 'grilleSlats'
  | 'lensClear'
  | 'lensRed'
  | 'lensAmber'
  | 'lensSmoke'
  | 'reflector'
  | 'head'
  | 'tail'
  | 'amber'
  | 'seat'
  | 'dash'
  | 'carpet'
  | 'wheel'
  | 'intTrim'
  | 'carbon'
  | 'metal'
  | 'mirror'
  | 'plate'
  | 'badge'
  | 'badgeRear';

export interface BodyOpts {
  plate?: string;
  badge?: string;
}

/** Collects geometry per material, merges, and returns the BodyBuild pieces. */
export class Assembler {
  readonly group = new THREE.Group();
  private bins = new Map<MatKey, THREE.BufferGeometry[]>();
  private mats = new Map<MatKey, THREE.Material>();
  headLights: THREE.Mesh[] = [];
  tailLights: THREE.Mesh[] = [];
  paint: THREE.Mesh[] = [];
  constructor(
    readonly spec: CarSpec,
    readonly o: BodyOpts = {},
  ) {}
  add(k: MatKey, g: THREE.BufferGeometry) {
    let b = this.bins.get(k);
    if (!b) this.bins.set(k, (b = []));
    b.push(g);
  }
  mat(k: MatKey): THREE.Material {
    let m = this.mats.get(k);
    if (m) return m;
    m = makeMat(k, this.spec, this.o);
    this.mats.set(k, m);
    return m;
  }
  finish(): THREE.Group {
    for (const [k, gs] of this.bins) {
      if (!gs.length) continue;
      const g = merge(gs);
      const mesh = new THREE.Mesh(g, this.mat(k));
      mesh.name = k === 'paint' ? 'body' : k;
      mesh.userData.bin = k;
      if (k === 'glass' || k === 'glassDark' || k.startsWith('lens')) {
        mesh.castShadow = false;
        mesh.renderOrder = 2;
      }
      if (k === 'paint' || k === 'hood') this.paint.push(mesh);
      if (k === 'head') this.headLights.push(mesh);
      if (k === 'tail') this.tailLights.push(mesh);
      this.group.add(mesh);
    }
    return this.group;
  }
}

function makeMat(k: MatKey, spec: CarSpec, o: BodyOpts): THREE.Material {
  switch (k) {
    case 'paint':
    case 'hood':
      return look.paintMaterial(spec.paint);
    case 'glass':
      return look.glass({ opacity: 0.3 });
    case 'glassDark':
      return look.glass({ tint: '#0e1114', opacity: 0.55 });
    case 'chrome':
      return look.chrome();
    case 'blackChrome':
      return look.blackChrome();
    case 'trim':
      return look.plastic('#0f0f11', { gloss: 0.15 });
    case 'gloss':
      return look.plastic('#0a0a0c', { gloss: 0.85 });
    case 'rubber':
      return look.plastic('#09090a', { gloss: 0.05 });
    case 'gap':
      return gapMat();
    case 'liner':
      return look.plastic('#0b0b0c', { gloss: 0 });
    case 'under':
      return look.plastic('#060607', { gloss: 0 });
    case 'grille':
      return look.grille({ pattern: 'honeycomb', repeat: [14, 3] });
    case 'grilleMesh':
      return look.grille({ pattern: 'mesh', repeat: [18, 4] });
    case 'grilleSlats':
      return look.grille({ pattern: 'slats', repeat: [1, 8] });
    case 'lensClear':
      return look.lens({ tint: '#f4f6f8', opacity: 0.1 });
    case 'lensRed':
      return look.lens({ tint: '#d0101a', opacity: 0.5 });
    case 'lensAmber':
      return look.lens({ tint: '#ff9a1a', opacity: 0.35 });
    case 'lensSmoke':
      return look.lens({ tint: '#202226', opacity: 0.45 });
    case 'reflector':
      return look.chrome();
    case 'head':
      return look.lightMaterial('#eef4ff', 7);
    case 'tail':
      return look.lightMaterial('#ff1a22', 7);
    case 'amber':
      return look.lightMaterial('#ff9a20', 2.5);
    case 'seat':
      return look.interior('seat');
    case 'dash':
      return look.interior('dash');
    case 'carpet':
      return look.interior('carpet');
    case 'wheel':
      return look.interior('wheel');
    case 'intTrim':
      return look.interior('trim');
    case 'carbon':
      return look.carbon();
    case 'metal':
      return look.brushedMetal();
    case 'mirror':
      return look.chrome();
    case 'plate':
      return look.plateMaterial(o.plate ?? 'RVL 777');
    case 'badge':
      return look.badgeMaterial(o.badge ?? 'RVL');
    case 'badgeRear':
      return look.badgeMaterial(o.badge ?? 'RVL');
  }
}

let gapM: THREE.MeshStandardMaterial | null = null;
/** Shut-line material: near-black, drawn just above the paint. */
function gapMat(): THREE.Material {
  if (!gapM) {
    gapM = new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    gapM.userData.shared = true;
    gapM.name = 'carsC:gap';
  }
  return gapM;
}

// ---------------------------------------------------------------------------------------------------------------
// Common sub-assemblies

/** Wheel well: liner arc (radius r around the hub, axis z) from zIn to the body side, plus the inner wall. */
export function wellGeo(cx: number, cy: number, r: number, zIn: number, zOut: (ang: number) => number, yFloor: number, segs = 28): THREE.BufferGeometry {
  const g = newGeo();
  const a0 = Math.asin(Math.max(-1, Math.min(1, (yFloor - cy) / r)));
  const angs: number[] = [];
  for (let i = 0; i <= segs; i++) angs.push(lerp(Math.PI - a0, a0, i / segs));
  // liner (normals point toward the hub)
  for (const a of angs) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (const z of [zIn, zOut(a)]) {
      g.pos.push(cx + c * r, cy + s * r, z);
      g.nor.push(-c, -s, 0);
      g.uv.push(a, z);
    }
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    g.idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  // inner wall disc segment at zIn (normal +z, facing outward toward the wheel)
  const base = g.pos.length / 3;
  g.pos.push(cx, Math.max(yFloor, cy - r * 0.2), zIn);
  g.nor.push(0, 0, 1);
  g.uv.push(0.5, 0.5);
  for (const a of angs) {
    g.pos.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r, zIn);
    g.nor.push(0, 0, 1);
    g.uv.push(0, 0);
  }
  for (let i = 0; i < segs; i++) g.idx.push(base, base + 2 + i, base + 1 + i);
  return toBuffer(g);
}

/** Simple bucket seat (cushion, backrest with bolsters, headrest) facing +x, centred at (x, y floor, z). */
export function seatGeo(x: number, y: number, z: number, rake = 0.32, w = 0.5): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(place(rbox(0.5, 0.11, w * 0.86, 0.04), x + 0.02, y + 0.06, z, 0, 0, -0.08));
  for (const s of [-1, 1]) parts.push(place(rbox(0.46, 0.08, 0.08, 0.035, 1), x + 0.02, y + 0.12, z + s * w * 0.42, 0, 0, -0.08));
  const bx = x - 0.24;
  const by = y + 0.36;
  parts.push(place(rbox(0.11, 0.58, w * 0.8, 0.045), bx, by, z, 0, 0, rake));
  for (const s of [-1, 1]) parts.push(place(rbox(0.13, 0.5, 0.09, 0.04, 1), bx + 0.02, by - 0.02, z + s * w * 0.42, 0, 0, rake));
  parts.push(place(rbox(0.09, 0.17, w * 0.5, 0.04, 1), bx - Math.sin(rake) * 0.36, by + Math.cos(rake) * 0.36, z, 0, 0, rake));
  return merge(parts);
}

/** Steering wheel (rim, hub, 3 spokes) + column, wheel centre at c, tilted back by tilt rad. */
export function steeringGeo(c: THREE.Vector3, tilt = 0.45, R = 0.18): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rim = new THREE.TorusGeometry(R, 0.016, 6, 28);
  rim.rotateY(Math.PI / 2);
  parts.push(rim);
  const hub = new THREE.CylinderGeometry(0.05, 0.055, 0.04, 16);
  hub.rotateZ(Math.PI / 2);
  parts.push(hub);
  for (const a of [Math.PI / 2 + 0.2, -Math.PI / 2 - 0.2, Math.PI]) {
    const sp = rbox(0.012, R - 0.03, 0.03, 0.005);
    sp.translate(0, (R - 0.03) / 2 + 0.02, 0);
    sp.rotateX(a);
    parts.push(sp);
  }
  const col = new THREE.CylinderGeometry(0.03, 0.035, 0.32, 10);
  col.rotateZ(Math.PI / 2);
  col.translate(0.18, 0, 0);
  parts.push(col);
  const g = merge(parts);
  g.rotateZ(-tilt);
  g.translate(c.x, c.y, c.z);
  return g;
}

/** Side mirror: painted housing + mirror glass + stalk; root at the door (x, y, z) on the left side. */
export function mirrorGeos(x: number, y: number, z: number, o: { len?: number; h?: number; w?: number; out?: number; yaw?: number; stalkUp?: number } = {}) {
  const len = o.len ?? 0.2;
  const h = o.h ?? 0.1;
  const w = o.w ?? 0.075;
  const out = o.out ?? 0.12;
  const sph = new THREE.SphereGeometry(1, 24, 14, 0, Math.PI * 2, 0, Math.PI);
  // squash into a teardrop housing: blunt rear (-x, mirror face), rounded nose forward
  const p = sph.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    let X = p.getX(i);
    const Y = p.getY(i);
    const Z = p.getZ(i);
    X = X < -0.55 ? -0.55 + (X + 0.55) * 0.15 : X;
    p.setXYZ(i, X * w, Y * h * 0.5, Z * len * 0.5);
  }
  sph.computeVertexNormals();
  const cx = x - 0.02;
  const cy = y + (o.stalkUp ?? 0.06);
  const cz = z + out;
  sph.rotateY(o.yaw ?? 0.08);
  sph.translate(cx, cy, cz);
  const glassG = new THREE.CircleGeometry(1, 24);
  glassG.scale(len * 0.44, h * 0.42, 1);
  glassG.rotateY(-Math.PI / 2 + (o.yaw ?? 0.08));
  glassG.translate(cx - w * 0.56, cy, cz);
  const st = rbox(0.06, 0.03, out + 0.02, 0.01);
  st.translate(x, y + 0.03, z + out / 2);
  return { housing: withMirror(sph), glass: withMirror(glassG), stalk: withMirror(st) };
}

/** Standard anchors helper. */
export function vec(x: number, y: number, z: number) {
  return new THREE.Vector3(x, y, z);
}

export type { BodyBuild };

// ---------------------------------------------------------------------------------------------------------------
// Wheel arches, floors

export interface ArchParts {
  /** Exclusion polygon in (u, v) (cuts the shell). */
  exc: V2[];
  /** The visible arch edge in (u, v) (lip ribbons). */
  edge: V2[];
  /** Dark liner + inner wall (both halves). */
  liner: THREE.BufferGeometry;
}

/** Round arch outline in side view, from the bottom behind the wheel, over the top, to the bottom in front. */
export function roundArch(xw: number, yc: number, R: number, yBottom: number, n = 36): V2[] {
  const al = Math.asin(Math.min(0.99, Math.max(-0.99, (yc - yBottom) / R)));
  const pts: V2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = lerp(Math.PI + al, -al, i / n);
    pts.push([xw + Math.cos(t) * R, yc + Math.sin(t) * R]);
  }
  return pts;
}

/** Cut a side-view arch outline into a loft: exclusion polygon, lip path, liner (axis z, flaring open inboard). */
export function archParts(loft: Loft, outline: V2[], o: { zIn: number; hub: V2; vMax: number; flare?: number; yFloor: number }): ArchParts {
  const uv: V2[] = outline.map(([x, y]) => [x, loft.vAtY(x, y, 0, o.vMax)]);
  const first = uv[0];
  const last = uv[uv.length - 1];
  const exc: V2[] = [[first[0], -0.05], ...uv, [last[0], -0.05]];
  const g = newGeo();
  const P = V();
  const n = outline.length;
  const flare = o.flare ?? 0.03;
  for (let i = 0; i < n; i++) {
    const [x, y] = outline[i];
    loft.at(uv[i][0], uv[i][1], P);
    const dx = x - o.hub[0];
    const dy = y - o.hub[1];
    const l = Math.hypot(dx, dy) || 1;
    const yo = Math.max(o.yFloor, y);
    const yi = Math.max(o.yFloor, y + (dy / l) * flare);
    g.pos.push(x, yo, P.z - 0.004, x + (dx / l) * flare, yi, o.zIn);
    g.nor.push(-dx / l, -dy / l, 0, -dx / l, -dy / l, 0);
    g.uv.push(i / (n - 1), 0, i / (n - 1), 1);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    // inner faces toward the hub
    g.idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1);
  }
  const base = g.pos.length / 3;
  g.pos.push(o.hub[0], Math.max(o.yFloor, o.hub[1] - 0.05), o.zIn);
  g.nor.push(0, 0, 1);
  g.uv.push(0.5, 0.5);
  for (let i = 0; i < n; i++) {
    const [x, y] = outline[i];
    const dx = x - o.hub[0];
    const dy = y - o.hub[1];
    const l = Math.hypot(dx, dy) || 1;
    g.pos.push(x + (dx / l) * flare, Math.max(o.yFloor, y + (dy / l) * flare), o.zIn);
    g.nor.push(0, 0, 1);
    g.uv.push(0, 0);
  }
  for (let i = 0; i < n - 1; i++) g.idx.push(base, base + 1 + i, base + 2 + i);
  // make sure both liner faces point at the hub side (fix winding by a test triangle)
  fixWinding(g);
  mirrorGeo(g);
  return { exc, edge: uv, liner: toBuffer(g) };
}

/** Flip triangles whose winding disagrees with their vertex normals. */
function fixWinding(g: Geo) {
  const a = V();
  const b = V();
  const c = V();
  const n = V();
  for (let i = 0; i < g.idx.length; i += 3) {
    const [x, y, z] = [g.idx[i], g.idx[i + 1], g.idx[i + 2]];
    a.fromArray(g.pos, x * 3);
    b.fromArray(g.pos, y * 3).sub(a);
    c.fromArray(g.pos, z * 3).sub(a);
    n.fromArray(g.nor, x * 3);
    if (b.cross(c).dot(n) < 0) {
      g.idx[i + 1] = z;
      g.idx[i + 2] = y;
    }
  }
}

/** Flat underbody between the sills (normal down), y(x) and half-width hw(x). */
export function floorGeo(xs: number[], y: (x: number) => number, hw: (x: number) => number): THREE.BufferGeometry {
  const g = newGeo();
  for (const x of xs) {
    const w = hw(x);
    const yy = y(x);
    for (const z of [-w, 0, w]) {
      g.pos.push(x, yy, z);
      g.nor.push(0, -1, 0);
      g.uv.push(x, z);
    }
  }
  for (let i = 0; i < xs.length - 1; i++)
    for (let c = 0; c < 2; c++) {
      const a = i * 3 + c;
      const b = a + 3;
      g.idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  fixWinding(g);
  return toBuffer(g);
}

/** Flip a geometry's faces + normals (see it from the other side). */
export function flipGeo(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const idx = geo.getIndex();
  if (idx) {
    const a = idx.array as unknown as number[];
    for (let i = 0; i < a.length; i += 3) {
      const t = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = t;
    }
    idx.needsUpdate = true;
  }
  const n = geo.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return geo;
}

/** Thin out sorted samples closer than `min`. */
export function thin(xs: number[], min: number): number[] {
  const out: number[] = [];
  for (const x of xs) if (!out.length || x - out[out.length - 1] >= min) out.push(x);
  if (out[out.length - 1] !== xs[xs.length - 1]) out[out.length - 1] = xs[xs.length - 1];
  return out;
}

/** Point + outward normal on a surface (for placing parts). */
export function frame(s: Surf, a: number, b: number): { p: THREE.Vector3; n: THREE.Vector3 } {
  a = Math.min(s.a1, Math.max(s.a0, a));
  b = Math.min(s.b1, Math.max(s.b0, b));
  return { p: s.at(a, b, V()), n: surfNormal(s, a, b, s.a0, s.a1, s.b0, s.b1, V()) };
}

/** Orient a geometry built facing +z so its +z points along n, then move to p. */
export function onSurface(g: THREE.BufferGeometry, p: THREE.Vector3, n: THREE.Vector3, spin = 0): THREE.BufferGeometry {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n.clone().normalize());
  if (spin) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), spin));
  g.applyMatrix4(new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)));
  return g;
}

/** Fillet the interior corners of an open polyline (end points kept). */
export function roundOpen(pts: V2[], r: number, n = 5): V2[] {
  const m = pts.length;
  const far: V2 = [(pts[0][0] + pts[m - 1][0]) / 2, Math.min(pts[0][1], pts[m - 1][1]) - 10];
  const closed = roundPoly([...pts, far], [0, ...pts.slice(1, -1).map(() => r), 0, 0], n);
  // drop the helper corner (its fillet radius is 0, so it appears once)
  return closed.filter((p) => p !== far && p[1] > far[1] + 1e-6);
}
