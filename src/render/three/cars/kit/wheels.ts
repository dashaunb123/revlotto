// Hand-built wheels by tier: tyres with real sidewall profiles (tread grooves, lettering), rims (stock hubcaps,
// street multi-spoke, sport split-spoke deep dish, pro forged mesh / Weld-style drag wheels with beadlocks), brake
// discs (plain / slotted / drilled) with accent calipers, and a motion-blur disc. Built around the Z axle with the
// outer face toward +Z; geometry is shared between every car that uses the same wheel (Res cache).
import * as THREE from 'three';
import type { Tier } from '../../../../core/types';
import type { BodyType } from '../../../car';
import type { CarSpec } from '../../types';
import { bendZ, circlePath, circleShape, dropBack, extrude, sanitize, insetConvex, merge, planarUV, polar, revolve, roundedPath, type P2, type Strip } from './geom';
import type { KitMats } from './mats';
import { lum } from './tex';
import type { Res } from './res';
import { blurTexture, discTextures, textCanvas, texFrom, type TyreKind } from './tex';

export type Quality = 'low' | 'medium' | 'high';

/** Level of detail per quality: revolve segments, profile density, face outline and which small parts exist. */
export interface Lod { segs: number; side: number; rib: number; arc: number; fil: number; bev: number; grooves: boolean; holes: boolean; bolts: boolean; lugs: boolean; logo: boolean }
export const LOD: Record<Quality, Lod> = {
  high: { segs: 36, side: 5, rib: 4, arc: 3, fil: 2, bev: 1, grooves: false, holes: false, bolts: true, lugs: true, logo: true },
  medium: { segs: 28, side: 4, rib: 2, arc: 2, fil: 1, bev: 0, grooves: false, holes: false, bolts: false, lugs: true, logo: false },
  low: { segs: 18, side: 3, rib: 1, arc: 2, fil: 1, bev: 0, grooves: false, holes: false, bolts: false, lugs: false, logo: false },
};
export type RimDesign = 'hubcap' | 'multi' | 'split' | 'mesh' | 'weld';
export type DiscKind = 'plain' | 'slotted' | 'drilled';

export interface WheelSpec {
  /** Size scale (body wheel radius / 0.33 m). */
  k: number;
  R: number; // tyre outer radius
  W: number; // tyre section width
  rb: number; // bead seat radius (rim size)
  rimW: number; // bead-to-bead width
  tyre: TyreKind;
  design: RimDesign;
  /** Deep-dish lip depth (m); 0 = flush face. */
  dish: number;
  /** Face concavity (centre recessed by this much). */
  conc: number;
  disc: { r: number; kind: DiscKind; th: number };
  caliper: { pistons: number; big: boolean };
  beadlock: boolean;
}

export interface AxleSpecs { front: WheelSpec; rear: WheelSpec; drag: boolean }

const EXOTIC: BodyType[] = ['super', 'hyper', 'wedge'];

/** Tyre/rim/brake sizes by tier for a body (wheelR = the body's design wheel radius). */
export function axleSpecs(spec: CarSpec, wheelR: number, carWidth: number): AxleSpecs {
  const k = wheelR / 0.33;
  const w0 = THREE.MathUtils.clamp(carWidth * 0.118, 0.19, 0.25);
  const t: Tier = spec.parts.tires;
  const mk = (o: Partial<WheelSpec> & Pick<WheelSpec, 'R' | 'W' | 'rb' | 'tyre' | 'design'>): WheelSpec => ({
    k,
    rimW: o.W * 0.8,
    dish: 0,
    conc: 0.02 * k,
    disc: { r: 0.14 * k, kind: 'plain', th: 0.024 * k },
    caliper: { pistons: 1, big: false },
    beadlock: false,
    ...o,
  });
  if (t === 'stock') {
    const s = mk({ R: wheelR, W: w0 * 0.95, rb: 0.19 * k, tyre: 'eco', design: 'hubcap', rimW: w0 * 0.95 * 0.78, conc: 0, disc: { r: 0.13 * k, kind: 'plain', th: 0.022 * k } });
    return { front: s, rear: s, drag: false };
  }
  if (t === 'street') {
    const s = mk({ R: wheelR, W: w0, rb: 0.215 * k, tyre: 'street', design: 'multi', conc: 0.022 * k, disc: { r: 0.15 * k, kind: 'plain', th: 0.026 * k }, caliper: { pistons: 2, big: false } });
    return { front: s, rear: s, drag: false };
  }
  if (t === 'sport') {
    const base = { rb: 0.235 * k, tyre: 'sport' as TyreKind, design: 'split' as RimDesign, dish: 0.045 * k, conc: 0.012 * k, caliper: { pistons: 4, big: true } };
    return {
      front: mk({ ...base, R: wheelR, W: w0 * 1.08, disc: { r: 0.17 * k, kind: 'slotted', th: 0.028 * k } }),
      rear: mk({ ...base, R: wheelR * 1.02, W: w0 * 1.22, dish: 0.06 * k, disc: { r: 0.165 * k, kind: 'slotted', th: 0.026 * k } }),
      drag: false,
    };
  }
  // pro: Weld-style drag setup (slicks + skinnies), or forged mesh on track-car exotics without drag suspension
  const drag = spec.parts.suspension === 'pro' || !EXOTIC.includes(spec.body);
  if (drag)
    return {
      front: mk({ R: wheelR * 0.99, W: w0 * 0.52, rb: 0.19 * k, rimW: w0 * 0.52 * 0.82, tyre: 'skinny', design: 'weld', conc: 0.01 * k, dish: 0.012 * k, disc: { r: 0.125 * k, kind: 'drilled', th: 0.014 * k }, caliper: { pistons: 2, big: false } }),
      rear: mk({ R: wheelR * 1.13, W: w0 * 1.62, rb: 0.19 * k, rimW: w0 * 1.62 * 0.78, tyre: 'slick', design: 'weld', conc: 0.01 * k, dish: 0.03 * k, disc: { r: 0.13 * k, kind: 'drilled', th: 0.016 * k }, caliper: { pistons: 2, big: false }, beadlock: true }),
      drag: true,
    };
  const base = { rb: 0.245 * k, tyre: 'rcomp' as TyreKind, design: 'mesh' as RimDesign, dish: 0.018 * k, conc: 0.028 * k, caliper: { pistons: 6, big: true } };
  return {
    front: mk({ ...base, R: wheelR, W: w0 * 1.15, disc: { r: 0.185 * k, kind: 'drilled', th: 0.032 * k } }),
    rear: mk({ ...base, R: wheelR * 1.03, W: w0 * 1.42, dish: 0.03 * k, disc: { r: 0.178 * k, kind: 'drilled', th: 0.03 * k } }),
    drag: false,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry

/** Per-material geometry slots (each slot is one draw call per wheel). */
interface WheelGeo {
  tyre: THREE.BufferGeometry; // one material (sidewall + tread atlas)
  lip: THREE.BufferGeometry; // polished: rim lip, lug nuts, valve, rivets, beadlock ring + bolts
  face: THREE.BufferGeometry; // rim finish: spokes / hubcap + centre cap
  dark: THREE.BufferGeometry; // inner barrel, disc hat, backing plate, steel wheel behind a hubcap
  disc: THREE.BufferGeometry;
  caliper: THREE.BufferGeometry;
  logo: THREE.BufferGeometry;
  blur: THREE.BufferGeometry;
  /** Z of the caliper's outer face (logo plane) and the caliper's mid radius. */
  calZ: number;
  calR: number;
  dispose(): void;
}

const TYRE: Record<TyreKind, { n: number; tread: number; grooves: [number, number, number][] }> = {
  // superellipse exponent, tread half-width fraction, grooves [centre (fraction of tread half-width), width m, depth m]
  eco: { n: 3.6, tread: 0.74, grooves: [[-0.62, 0.008, 0.007], [-0.2, 0.01, 0.008], [0.2, 0.01, 0.008], [0.62, 0.008, 0.007]] },
  street: { n: 4.2, tread: 0.78, grooves: [[-0.45, 0.011, 0.008], [0.08, 0.012, 0.008], [0.55, 0.009, 0.007]] },
  sport: { n: 5, tread: 0.82, grooves: [[-0.3, 0.013, 0.007], [0.3, 0.013, 0.007]] },
  rcomp: { n: 5.5, tread: 0.86, grooves: [[-0.4, 0.006, 0.004], [0.4, 0.006, 0.004]] },
  slick: { n: 2.7, tread: 0.84, grooves: [] },
  skinny: { n: 3.2, tread: 0.62, grooves: [[-0.4, 0.004, 0.003], [0, 0.004, 0.003], [0.4, 0.004, 0.003]] },
};

function tyreGeo(s: WheelSpec, lod: Lod): THREE.BufferGeometry {
  const { R, W, rb, rimW } = s;
  const T = TYRE[s.tyre];
  const n = T.n;
  const b = W / 2;
  const q = Math.pow(1 - Math.pow(Math.min(0.98, rimW / W), n), 1 / n);
  const a = (R - rb) / (1 + q);
  const rc = R - a;
  const zt = b * T.tread;
  const pe = (t: number): P2 => {
    const st = Math.sin(t);
    const ct = Math.cos(t);
    return [rc + a * Math.sign(st) * Math.pow(Math.abs(st), 2 / n), b * Math.sign(ct) * Math.pow(Math.abs(ct), 2 / n)];
  };
  const rOf = (z: number) => rc + a * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(z / b), n)), 1 / n);
  const s0 = Math.pow(Math.max(0, (rc - rb) / a), n / 2);
  const c0 = Math.pow(zt / b, n / 2);
  const sideV = (r: number) => 0.49 * THREE.MathUtils.clamp((r - rb) / (R - rb), 0, 1);
  const side = (t0: number, t1: number): Strip => {
    const pts: P2[] = [];
    const N = lod.side;
    for (let i = 0; i <= N; i++) pts.push(pe(t0 + ((t1 - t0) * i) / N));
    return { pts, mat: 0, v: (r) => sideV(r) };
  };
  const strips: Strip[] = [];
  strips.push(side(Math.PI + Math.asin(Math.min(1, s0)), Math.PI - Math.acos(c0)));
  // tread: ribs between grooves (sharp groove walls)
  const tv = (z: number) => 0.51 + 0.49 * ((z + zt) / (2 * zt));
  const cuts = (lod.grooves ? T.grooves : []).map(([c, w, d]) => [c * zt - w / 2, c * zt + w / 2, d] as const).sort((x, y) => x[0] - y[0]);
  let z0 = -zt;
  const rib = (za: number, zb: number) => {
    const pts: P2[] = [];
    const N = Math.max(1, Math.ceil(((zb - za) / (2 * zt)) * lod.rib));
    for (let i = 0; i <= N; i++) {
      const z = za + ((zb - za) * i) / N;
      pts.push([rOf(z), z]);
    }
    strips.push({ pts, mat: 0, v: (_r, z) => tv(z) });
  };
  for (const [ga, gb, d] of cuts) {
    rib(z0, ga);
    const ra = rOf(ga);
    const rb2 = rOf(gb);
    strips.push({ pts: [[ra, ga], [ra - d, ga + 0.0008]], mat: 0, v: () => 0.51 });
    strips.push({ pts: [[ra - d, ga + 0.0008], [rb2 - d, gb - 0.0008]], mat: 0, v: () => 0.51 });
    strips.push({ pts: [[rb2 - d, gb - 0.0008], [rb2, gb]], mat: 0, v: () => 0.51 });
    z0 = gb;
  }
  rib(z0, zt);
  strips.push(side(Math.acos(c0), -Math.asin(Math.min(1, s0))));
  return revolve(strips, lod.segs);
}

/** Face shapes per design (XY plane; holes are the windows between spokes). */
function faceShape(s: WheelSpec, rf: number, k: number, cs: number, ring: number): THREE.Shape {
  const sh = circleShape(rf, ring);
  const holes: THREE.Path[] = [];
  const rh = 0.078 * k; // solid hub ring (lugs)
  const spokeWin = (N: number, r0: number, r1: number, w0: number, w1: number, fil: number, rot = 0) => {
    for (let i = 0; i < N; i++) {
      const a0 = rot + (i / N) * Math.PI * 2;
      const a1 = rot + ((i + 1) / N) * Math.PI * 2;
      const at = (a: number, r: number, off: number): P2 => {
        const t = Math.sqrt(Math.max(0, r * r - off * off));
        return [Math.cos(a) * t - Math.sin(a) * off, Math.sin(a) * t + Math.cos(a) * off];
      };
      const A = at(a0, r0, w0 / 2);
      const B = at(a0, r1, w1 / 2);
      const C = at(a1, r1, -w1 / 2);
      const D = at(a1, r0, -w0 / 2);
      const pts: P2[] = [A, B];
      const arc = (p: P2, q2: P2, r: number, steps: number) => {
        let aa = Math.atan2(p[1], p[0]);
        let ab = Math.atan2(q2[1], q2[0]);
        if (ab < aa) ab += Math.PI * 2;
        if (ab - aa > Math.PI * 2 - 1e-3) ab = aa;
        for (let j = 1; j < steps; j++) pts.push(polar(r, aa + ((ab - aa) * j) / steps));
        void aa;
      };
      arc(B, C, r1, cs);
      pts.push(C, D);
      // inner arc back from D to A (reverse direction)
      const ia = Math.atan2(A[1], A[0]);
      let ib = Math.atan2(D[1], D[0]);
      if (ib < ia) ib += Math.PI * 2;
      for (let j = cs - 1; j >= 1; j--) pts.push(polar(r0, ia + ((ib - ia) * j) / cs));
      holes.push(roundedPath(pts, fil));
    }
  };
  if (s.design === 'multi') {
    spokeWin(10, rh + 0.012 * k, rf - 0.017 * k, 0.013 * k, 0.021 * k, 0.007 * k, Math.PI / 2);
  } else if (s.design === 'split') {
    spokeWin(5, rh + 0.014 * k, rf - 0.018 * k, 0.034 * k, 0.062 * k, 0.012 * k, Math.PI / 2);
    for (let i = 0; i < 5; i++) {
      const a = Math.PI / 2 + (i / 5) * Math.PI * 2;
      const r0 = rh + 0.03 * k;
      const r1 = rf - 0.03 * k;
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const nx = -uy;
      const ny = ux;
      const w0 = 0.0035 * k;
      const w1 = 0.009 * k;
      const pts: P2[] = [
        [ux * r0 + nx * w0, uy * r0 + ny * w0],
        [ux * r1 + nx * w1, uy * r1 + ny * w1],
        [ux * r1 - nx * w1, uy * r1 - ny * w1],
        [ux * r0 - nx * w0, uy * r0 - ny * w0],
      ];
      holes.push(roundedPath(pts, 0.004 * k));
    }
  } else if (s.design === 'mesh') {
    // cross-spoke mesh: N spokes leave the hub each way and cross halfway out (diamonds + hub/rim triangles)
    const N = 10;
    const r0 = rh + 0.006 * k;
    const r1 = rf - 0.014 * k;
    const d = 0.0058 * k;
    const P = (a: number, t: number): P2 => polar(r0 + (r1 - r0) * t, a);
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2 + Math.PI / 2;
      const a1 = a0 + (Math.PI * 2) / N;
      const cm = a0 - Math.PI / N; // previous crossing
      const cp = a0 + Math.PI / N;
      const polys: P2[][] = [
        [P(a0, 0.02), P(cp, 0.5), P(a0, 0.98), P(cm, 0.5)], // diamond on the spoke line
        [P(a0, 0), P(a1, 0), P(cp, 0.5)], // hub triangle
        [P(cp, 0.5), P(a1, 1), P(a0, 1)], // rim triangle
      ];
      for (const poly of polys) {
        const ins = insetConvex(poly, d);
        holes.push(roundedPath(ins, 0.004 * k));
      }
    }
  } else if (s.design === 'weld') {
    spokeWin(5, rh + 0.01 * k, rf - 0.016 * k, 0.02 * k, 0.03 * k, 0.014 * k, Math.PI / 2);
    // drilled lightening holes down each spoke and around the hub ring
    for (let i = 0; i < 5; i++) {
      const a = Math.PI / 2 + (i / 5) * Math.PI * 2;
      for (const f of [0.38, 0.62]) {
        const [x, y] = polar(rh + (rf - rh) * f, a);
        holes.push(circlePath(x, y, 0.0055 * k * (0.8 + f * 0.5), true));
      }
      const [x, y] = polar(rh * 0.82, a + Math.PI / 5);
      holes.push(circlePath(x, y, 0.006 * k, true));
    }
  } else if (s.design === 'hubcap') {
    // full wheel cover: 12 slots + a ring of small vents
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r0 = rf * 0.5;
      const r1 = rf * 0.84;
      const pts: P2[] = [polar(r0, a - 0.07), polar(r1, a - 0.09), polar(r1, a + 0.09), polar(r0, a + 0.07)];
      holes.push(roundedPath(pts, 0.006 * k));
    }
  }
  sh.holes.push(...holes);
  if (s.design !== 'hubcap') sh.holes.push(circlePath(0, 0, 0.03 * k, true)); // centre bore (cap sits in it)
  return sh;
}

export function buildWheelGeo(s: WheelSpec, q: Quality): WheelGeo {
  const k = s.k;
  const lod = LOD[q];
  const segs = lod.segs;
  const cs = lod.arc; // sampled arc steps in the spoke windows
  const fil = lod.fil; // fillet curve segments
  const tyre = tyreGeo(s, lod);

  // --- barrel + lip ---
  const zLip = s.rimW / 2 + 0.012 * k;
  const lipW = s.dish > 0 ? (s.design === 'split' ? 0.03 * k : 0.018 * k) : 0.006 * k;
  const rf = s.rb - lipW; // face outer radius
  const tf = s.design === 'hubcap' ? 0.006 * k : s.design === 'weld' ? 0.022 * k : s.design === 'split' ? 0.034 * k : 0.03 * k;
  const zFace = zLip - 0.004 * k - s.dish - (s.design === 'hubcap' ? 0.004 * k : 0.008 * k); // face front at its outer edge
  const rbIn = s.rb - 0.009 * k;
  const lip: Strip = {
    pts: [
      [s.rb + 0.002 * k, s.rimW / 2 - 0.004 * k],
      [s.rb + 0.01 * k, s.rimW / 2 + 0.003 * k],
      [s.rb + 0.012 * k, zLip - 0.004 * k],
      [s.rb + 0.008 * k, zLip],
      [s.rb, zLip],
      [rf, zLip],
    ],
    mat: 0,
  };
  const dishWall: Strip = { pts: [[rf, zLip], [rf, zFace - tf * 0.5]], mat: s.dish > 0 ? 0 : 1 };
  const inner: Strip = { pts: [[rbIn, zFace - tf * 0.6], [rbIn, -s.rimW / 2 + 0.01 * k], [s.rb + 0.008 * k, -s.rimW / 2]], mat: 1 };
  const lipG = revolve(s.dish > 0 ? [lip, dishWall] : [lip], segs);
  const innerG = revolve(s.dish > 0 ? [inner] : [dishWall, inner], segs);

  // --- face (spokes), bent concave (hubcap: domed) ---
  const fshape = faceShape(s, rf + 0.001 * k, k, cs, segs);
  const face = dropBack(extrude(fshape, tf, lod.bev ? Math.min(0.0045 * k, tf * 0.3) : 0, fil, 0, Math.max(1, lod.bev)));
  face.translate(0, 0, zFace - tf);
  const conc = s.design === 'hubcap' ? -0.018 * k : s.conc;
  sanitize(bendZ(face, (r) => -conc * (1 - Math.min(1, (r / rf) ** 2)), (r) => (r < rf ? (2 * conc * r) / (rf * rf) : 0)));
  const faceZAt = (r: number) => zFace - conc * (1 - Math.min(1, (r / rf) ** 2));

  const bright: THREE.BufferGeometry[] = [];
  let capG: THREE.BufferGeometry | undefined;
  let steel: THREE.BufferGeometry | undefined;
  // hub mounting face: back of the spokes at the centre (hubcap: the steel wheel behind the cover)
  const steelZ = zFace - 0.05 * k;
  const zHub = s.design === 'hubcap' ? steelZ - 0.004 * k : faceZAt(0) - tf;
  if (s.design === 'hubcap') {
    // painted steel wheel behind the cover (only glimpsed through the slots): a plain dished disc
    steel = revolve([{ pts: [[rf, steelZ], [rf * 0.7, steelZ - 0.012 * k], [0.06 * k, steelZ - 0.02 * k], [0.0005, steelZ - 0.02 * k]], flip: true }], Math.max(16, segs / 2));
    // cover centre emblem
    capG = revolve([{ pts: [[0.045 * k, 0], [0.04 * k, 0.006 * k], [0.02 * k, 0.009 * k], [0.0005, 0.0095 * k]] }], Math.max(12, segs / 2));
    capG.translate(0, 0, faceZAt(0) - 0.001);
  } else {
    // lug nuts with conical seats, centre cap, valve stem
    if (lod.lugs) {
      const pcd = 0.057 * k;
      for (let i = 0; i < 5; i++) {
        const [x, y] = polar(pcd, Math.PI / 2 + Math.PI / 5 + (i / 5) * Math.PI * 2);
        const nut = new THREE.CylinderGeometry(0.0095 * k, 0.0095 * k, 0.016 * k, 6, 1);
        nut.rotateX(Math.PI / 2);
        nut.translate(x, y, faceZAt(pcd) - 0.002 * k);
        bright.push(nut);
      }
    }
    const capR = 0.034 * k;
    capG = revolve([{ pts: [[capR, -0.004 * k], [capR, 0.004 * k], [capR * 0.8, 0.009 * k], [capR * 0.3, 0.012 * k], [0.0005, 0.0125 * k]] }], Math.max(12, segs / 2));
    capG.translate(0, 0, faceZAt(0) - 0.006 * k);
    const valve = new THREE.CylinderGeometry(0.0035 * k, 0.003 * k, 0.03 * k, 8);
    valve.rotateX(Math.PI / 2);
    const [vx, vy] = polar(rf - 0.012 * k, -0.35);
    valve.translate(vx, vy, faceZAt(rf) + 0.004 * k);
    bright.push(valve);
    if (s.design === 'mesh' && lod.bolts) {
      // two-piece rim rivets around the lip joint
      for (let i = 0; i < 16; i++) {
        const [x, y] = polar(rf + lipW * 0.5 + 0.002 * k, (i / 16) * Math.PI * 2);
        const rv = new THREE.SphereGeometry(0.0032 * k, 6, 2, 0, Math.PI * 2, 0, Math.PI / 2);
        rv.rotateX(Math.PI / 2);
        rv.translate(x, y, zLip);
        bright.push(rv);
      }
    }
  }
  let beadlock: THREE.BufferGeometry | undefined;
  if (s.beadlock) {
    const r0 = s.rb - 0.008 * k;
    const r1 = s.rb + 0.024 * k;
    const z = zLip + 0.002 * k;
    const th = 0.011 * k;
    beadlock = revolve([{ pts: [[r1, z], [r1, z + th * 0.7], [r1 - 0.004 * k, z + th], [r0 + 0.003 * k, z + th], [r0, z + th * 0.6], [r0, z]] }], segs);
    if (lod.bolts)
      for (let i = 0; i < 16; i++) {
        const [x, y] = polar((r0 + r1) / 2, (i / 16) * Math.PI * 2);
        const bolt = new THREE.CylinderGeometry(0.0052 * k, 0.0052 * k, 0.006 * k, 6);
        bolt.rotateX(Math.PI / 2);
        bolt.translate(x, y, z + th + 0.003 * k);
        bright.push(bolt);
      }
  }

  // --- brakes ---
  const rd = s.disc.r;
  const rIn = rd * 0.6;
  const th = s.disc.th;
  const zDiscFront =
    (s.design === 'hubcap' ? steelZ - 0.02 * k : Math.min(faceZAt(rd + 0.015 * k), faceZAt(rd - 0.05 * k)) - tf) - 0.043 * k;
  const zDisc = zDiscFront - th / 2; // disc centre plane
  const dshape = circleShape(rd, segs);
  dshape.holes.push(circlePath(0, 0, rIn, true, Math.max(16, segs * 0.75)));
  if (s.disc.kind === 'drilled' && lod.holes) {
    const rows = 3;
    for (let row = 0; row < rows; row++) {
      const rr = rIn + (rd - rIn) * (0.28 + row * 0.22);
      const N = 12;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 + row * ((Math.PI * 2) / N / rows);
        const [x, y] = polar(rr, a);
        const hr = 0.0042 * k;
        dshape.holes.push(circlePath(x, y, hr, true, 6));
      }
    }
  }
  const disc = extrude(dshape, th, 0, 1, zDisc - th / 2, 1);
  planarUV(disc, rd * 2);
  // disc hat + backing plate + hub
  const hat = revolve(
    [
      { pts: [[rIn + 0.003 * k, zDisc + th / 2 - 0.001], [rIn - 0.004 * k, zDisc + th / 2 + 0.004 * k], [rIn - 0.006 * k, zHub - 0.004 * k], [rIn - 0.01 * k, zHub], [0.03 * k, zHub]] },
      { pts: [[rd + 0.012 * k, zDisc - th / 2 - 0.03 * k], [rd + 0.008 * k, zDisc - th / 2 - 0.022 * k], [0.05 * k, zDisc - th / 2 - 0.022 * k]], flip: false },
    ],
    Math.max(14, segs / 2),
  );
  // caliper: a rounded sector straddling the disc edge, at angle 0 (rotated per wheel)
  const span = s.caliper.pistons >= 6 ? 1.05 : s.caliper.pistons >= 4 ? 0.85 : s.caliper.pistons >= 2 ? 0.62 : 0.55;
  const cr0 = rd - (s.caliper.big ? 0.055 : 0.045) * k;
  const cr1 = rd + 0.014 * k;
  const cpts: P2[] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) cpts.push(polar(cr1, -span / 2 + (span * i) / steps));
  for (let i = steps; i >= 0; i--) cpts.push(polar(cr0, -span / 2 + (span * i) / steps * 0.94 + span * 0.03));
  const csh = new THREE.Shape();
  roundedPath(cpts, 0.014 * k, csh);
  const cz0 = zDisc - th / 2 - 0.028 * k;
  const cz1 = zDisc + th / 2 + 0.036 * k;
  const caliper = extrude(csh, cz1 - cz0, 0.007 * k, fil, cz0, 1);
  // logo plane on the caliper's outer face
  const calR = (cr0 + cr1) / 2 + 0.002 * k;
  const logo = new THREE.PlaneGeometry(span * calR * 0.62, (cr1 - cr0) * 0.36);
  logo.rotateZ(-Math.PI / 2);
  logo.translate(calR, 0, cz1 + 0.0006);
  // motion blur disc
  // outboard of everything on the face (lip, beadlock bolts, tyre bulge) so nothing pokes through it
  const blur = new THREE.CircleGeometry(s.R * 0.985, Math.max(16, segs / 2));
  blur.translate(0, 0, Math.max(zLip + (s.beadlock ? 0.026 * k : 0.012 * k), s.W / 2 + 0.006 * k));

  const lipAll = merge([lipG, ...bright, ...(beadlock ? [beadlock] : [])]);
  const faceAll = capG ? merge([face, capG]) : face;
  const darkAll = merge([innerG, hat, ...(steel ? [steel] : [])]);
  const parts = [tyre, lipAll, faceAll, darkAll, disc, caliper, logo, blur];
  return {
    tyre, lip: lipAll, face: faceAll, dark: darkAll, disc, caliper, logo, blur,
    calZ: cz1, calR,
    dispose: () => parts.forEach((g) => g?.dispose()),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Assembly

export interface Wheel3D {
  /** Positioned at the hub centre in car space; steer rotates this. */
  steer: THREE.Group;
  /** Rotates with the wheel (tyre, rim, disc). */
  spin: THREE.Group;
  disc: THREE.Mesh;
  blur: THREE.Mesh;
  /** Spinning detail hidden at full blur (rim face/spokes, lip with lugs) so it can't strobe. */
  sharp: THREE.Mesh[];
  /** The tyre and its [lettered, smeared] materials (same shader; swapped at full blur so lettering can't ghost). */
  tyre: THREE.Mesh;
  tyreMats: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial];
  spec: WheelSpec;
  /** +1 for left wheels (outer face +Z), -1 for right. */
  side: 1 | -1;
}

const wkey = (s: WheelSpec, q: Quality) =>
  `wg:${s.design}:${s.tyre}:${[s.R, s.W, s.rb, s.rimW, s.dish, s.conc, s.disc.r, s.disc.th].map((x) => x.toFixed(4)).join(',')}:${s.disc.kind}:${s.caliper.pistons}:${s.beadlock ? 1 : 0}:${q}`;

export interface WheelMats {
  disc: THREE.MeshStandardMaterial; // per car (glow)
  blurF: THREE.MeshStandardMaterial; // per car (opacity)
  blurR: THREE.MeshStandardMaterial;
}

/** Per-car wheel materials (brake glow and blur opacity must not leak between cars). */
export function wheelMats(res: Res, spec: CarSpec, axles: AxleSpecs): WheelMats {
  const mkDisc = (kind: DiscKind) => {
    const t = res.get(`t:disc:${kind}`, () => {
      const holes: [number, number, number][] = [];
      if (kind === 'drilled')
        for (let row = 0; row < 3; row++)
          for (let i = 0; i < 12; i++) {
            const rr = 0.6 + 0.4 * (0.28 + row * 0.22);
            const [x, y] = polar(rr, (i / 12) * Math.PI * 2 + row * ((Math.PI * 2) / 36));
            holes.push([x, y, 0.028]);
          }
      const d = discTextures(kind, 0.6, holes);
      return { ...d, dispose: () => (d.map.dispose(), d.glow.dispose()) };
    });
    return res.own(
      new THREE.MeshStandardMaterial({ map: t.map, color: 0xffffff, metalness: 0.82, roughness: 0.4, emissive: 0xff4810, emissiveMap: t.glow, emissiveIntensity: 0 }),
    );
  };
  const blur = (s: WheelSpec) => {
    const rimC = s.design === 'weld' && lum(spec.rim) > 0.55 ? '#d8d8de' : spec.rim;
    const cover = s.design === 'hubcap' ? 0.9 : s.design === 'multi' ? 0.55 : s.design === 'mesh' ? 0.6 : s.design === 'weld' ? 0.42 : 0.5;
    const D = s.R * 0.985;
    const h = s.R - s.rb;
    const white = s.tyre === 'slick' || s.tyre === 'skinny';
    const band: [number, number] = [(s.rb + h * 0.18) / D, Math.min(0.99, (s.rb + h * 0.8) / D)];
    const t = res.get(`t:blur5:${rimC}:${(s.rb / s.R).toFixed(3)}:${s.tyre}:${s.design}`, () =>
      blurTexture(rimC, (s.rb + 0.012 * s.k) / D, band, white ? '#56544f' : '#1c1c1f', cover),
    );
    return res.own(new THREE.MeshStandardMaterial({ map: t, transparent: true, opacity: 0, depthWrite: false, metalness: 0.15, roughness: 0.6 }));
  };
  return { disc: mkDisc(axles.rear.disc.kind === 'drilled' || axles.front.disc.kind === 'drilled' ? 'drilled' : axles.front.disc.kind), blurF: blur(axles.front), blurR: blur(axles.rear) };
}

export function buildWheel(res: Res, mats: KitMats, wm: WheelMats, spec: CarSpec, s: WheelSpec, side: 1 | -1, front: boolean, q: Quality): Wheel3D {
  const g = res.get(wkey(s, q), () => buildWheelGeo(s, q));
  const steer = new THREE.Group();
  const flip = new THREE.Group();
  if (side < 0) flip.rotation.y = Math.PI;
  steer.add(flip);
  const spin = new THREE.Group();
  flip.add(spin);
  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry | undefined, mat: THREE.Material | THREE.Material[], name: string) => {
    if (!geo) return undefined;
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const T = TYRE[s.tyre];
  const tyreArgs = [s.tyre, s.R, s.rb, s.W * T.tread, T.grooves.map(([c, w]) => [c, w])] as const;
  const tyreMats: [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial] = [mats.tyre(...tyreArgs), mats.tyre(...tyreArgs, true)];
  const tyreMesh = add(spin, g.tyre, tyreMats[0], 'tyre') as THREE.Mesh;
  const silver = lum(spec.rim) > 0.6;
  const lipMesh = add(spin, g.lip, mats.polished(), 'rimLip');
  const faceM = s.design === 'hubcap' ? mats.hubcap(spec.rim) : s.design === 'weld' && silver ? mats.polished() : mats.rim(spec.rim);
  const faceMesh = add(spin, g.face, faceM, 'rimFace');
  add(spin, g.dark, mats.zinc(), 'hub');
  const disc = add(spin, g.disc, wm.disc, 'disc') as THREE.Mesh;
  // calipers: front trailing, rear leading (both near the top)
  const cal = new THREE.Group();
  const ang = front ? Math.PI - 0.55 : 0.6;
  cal.rotation.z = side > 0 ? ang : Math.PI - ang;
  flip.add(cal);
  const calColor = spec.parts.tires === 'stock' ? '#3a3a40' : spec.accent;
  add(cal, g.caliper, mats.caliper(calColor), 'caliper');
  if (spec.parts.tires !== 'stock' && LOD[q].logo) {
    const logoM = res.get(`m:calLogo:${lum(calColor) > 0.6 ? 'd' : 'w'}`, () => {
      const t = texFrom(textCanvas('REVLOTTO', { w: 256, h: 48, color: lum(calColor) > 0.6 ? '#141418' : '#f4f2ea' }), { srgb: true });
      const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 });
      const d = m.dispose.bind(m);
      m.dispose = () => (d(), t.dispose());
      return m;
    });
    add(cal, g.logo, logoM, 'calLogo');
  }
  const blur = add(flip, g.blur, front ? wm.blurF : wm.blurR, 'blur') as THREE.Mesh;
  blur.castShadow = false;
  blur.renderOrder = 2;
  return { steer, spin, disc, blur, sharp: [faceMesh, lipMesh].filter(Boolean) as THREE.Mesh[], tyre: tyreMesh, tyreMats, spec: s, side };
}
