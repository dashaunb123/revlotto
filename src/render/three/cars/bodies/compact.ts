// 'compact': the starter car. An 80s-90s three-door economy hatch (Golf Mk2 vibe): upright glasshouse with a thick
// C-pillar, flat hood, quad round lamps in a black slatted grille, thick black wrap bumpers, wide wrap-round tail lamps.
// Contract: ../../types.ts BodyBuild. Car faces +X, +Z = the car's right, driver (LHD) on -Z. Units: metres.
import * as THREE from 'three';
import { badgeMaterial, plateMaterial } from '../../materials';
import type { BodyBuild, CarSpec } from '../../types';
import {
  Body, Surf, bumperProfile, cabinInterior, castAt, crPath, curve, doorMirror, ellipse, finish, frontP, greenhouse, gridLine, lowerShell,
  mats, merge, mirrorZ, offsetPath, patch, place, planOutline, rbox, rearP, resample, ribbon, rowRange, rrect, sideP, sweep, topP, tube, v3,
  wellGeo, type V2, type V3,
} from './_helpersA';

const WB = 2.47;
const WR = 0.29;
const TF = 1.43;
const TR = 1.42;
const XF = 1.97;
const XR = -1.9;

export default function build(spec: CarSpec): BodyBuild {
  const m = mats(spec);
  const b = new Body(m);
  const ax = WB / 2;
  const arches = [{ x: ax, y: WR, r: 0.345 }, { x: -ax, y: WR, r: 0.345 }];

  // ---- lower shell: bumpers' backing, fenders, doors, flat hood, tailgate ----
  const yBelt = curve([[XR, 0.982], [-1.2, 0.978], [0, 0.967], [0.7, 0.955], [1.3, 0.898], [XF, 0.83]]);
  const yHood = curve([[XR, 0.988], [-1.74, 0.994], [0.74, 0.972], [1.3, 0.915], [XF, 0.842]]);
  const lower = lowerShell({
    xR: XR, xF: XF, step: 0.042,
    capF: { len: 0.3, p: 3.6, rake: (y) => (y > 0.5 ? -(y - 0.5) * 0.11 : (0.5 - y) * 0.02) },
    capR: { len: 0.2, p: 3.8, rake: (y) => (y > 0.55 ? (y - 0.55) * 0.14 : 0) },
    yBot: curve([[XR, 0.29], [-1.74, 0.25], [-1.5, 0.215], [1.5, 0.215], [1.8, 0.235], [XF, 0.27]]),
    w: curve([[-1.7, 0.826], [-1.2, 0.836], [0, 0.838], [1.2, 0.835], [1.67, 0.822]]),
    yMax: () => 0.66,
    tuck: () => 0.045,
    yBelt,
    roll: () => 0.04,
    yTop: yHood,
    shoulder: () => [0.05, 0.012],
    cabin: [-1.74, 0.6],
    floorY: 0.32,
    arches,
  });
  const L = lower.grid;
  const LJ = lower.keyJ;
  const st = lower.stations;
  const rowOf = (x: number) => {
    let i = st.findIndex((s) => s >= x);
    return i < 0 ? st.length - 1 : i;
  };

  // ---- greenhouse: windshield, roof, hatch glass, pillars ----
  const edgeW = curve([[-1.79, 0.7], [-1.62, 0.66], [-1.52, 0.642], [-0.6, 0.652], [0.1, 0.645], [0.4, 0.71], [0.68, 0.776]]);
  const cowl = curve([[0.68, 0.776], [0.7, 0.693], [0.72, 0.6], [0.74, 0.49], [0.76, 0.347], [0.77, 0.245], [0.776, 0.15], [0.78, 0.0]]);
  const gh = greenhouse({
    xr: -1.81, xf: 0.78, step: 0.036, rail: 0.035, crown: 0.55,
    yBase: (x) => yBelt(x) - 0.004,
    wBase: curve([[-1.81, 0.7], [-1.68, 0.765], [-1.4, 0.784], [0.4, 0.786], [0.68, 0.778]]),
    yEdge: curve([[-1.84, 0.92], [-1.79, 0.994], [-1.73, 1.11], [-1.66, 1.255], [-1.59, 1.338], [-1.52, 1.355], [-1.2, 1.366], [-0.6, 1.376], [0.1, 1.364], [0.4, 1.155], [0.66, 0.96], [0.8, 0.86]]),
    wEdge: (x) => (x > 0.68 ? cowl(x) : edgeW(x)),
    yTop: curve([[-1.81, 0.985], [-1.775, 1.07], [-1.715, 1.19], [-1.655, 1.3], [-1.6, 1.36], [-1.53, 1.388], [-1.2, 1.401], [-0.6, 1.41], [0.16, 1.398], [0.47, 1.18], [0.78, 0.962]]),
  });
  const G = gh.grid;
  const GJ = gh.keyJ;
  const surf = new Surf([L, G]);
  const S = sideP(1);
  const T = topP();
  const F = frontP([1.55, 2.1]);
  const R = rearP([-2.05, -1.5]);

  // lower shell meshes: sides, tops split into tailgate lip / cabin (door cards) / cowl / hood / nose
  const nL = L.ni - 1;
  b.add(L.geometry(0, nL, 0, LJ[5]), m.paint, 'sides', 'paint');
  const iC0 = rowOf(-1.74);
  const iC1 = rowOf(0.6);
  const iH0 = rowOf(0.745);
  const iH1 = rowOf(XF - 0.3);
  b.add(L.geometry(0, iC0, LJ[5], LJ[7]), m.paint, 'tailgateTop', 'paint');
  b.add(L.geometry(iC0, iC1, LJ[5], LJ[7]), m.dash, 'doorCards');
  b.add(L.geometry(iC1, iH0, LJ[5], LJ[7]), m.paint, 'cowl', 'paint');
  b.add(L.geometry(iH0, iH1, LJ[5], LJ[7]), m.paint, 'hood', 'paint');
  b.add(L.geometry(iH1, nL, LJ[5], LJ[7]), m.paint, 'nose', 'paint');

  // greenhouse meshes
  const nG = G.ni - 1;
  const [iWs] = rowRange(gh.rowX, 0.13, 9);
  const [, iBk] = rowRange(gh.rowX, -9, -1.55);
  b.add(G.geometry(0, nG, 0, GJ[1]), m.glass, 'sideGlass');
  b.add(G.geometry(0, nG, GJ[1], GJ[3]), m.paint, 'pillars', 'paint');
  b.add(G.geometry(iWs, nG, GJ[3], GJ[5]), m.glass, 'windshield');
  b.add(G.geometry(iBk, iWs, GJ[3], GJ[5]), m.paint, 'roof', 'paint');
  b.add(G.geometry(0, iBk, GJ[3], GJ[5]), m.glass, 'hatchGlass');
  b.add(G.geometry(iBk, iWs, GJ[1], GJ[5], { offset: -0.012, flip: true }), m.headliner, 'headliner');
  // black glass frit borders and seals
  b.add(gridLine(G, GJ[3], iWs, nG, 0.05, 0.0008), m.black, 'wsFrit');
  b.add(gridLine(G, GJ[1], 0, nG, 0.014, 0.002), m.rubber, 'drip');
  b.add(gridLine(G, 0, gh.rowX.findIndex((x) => x > -1.72), gh.rowX.findIndex((x) => x > 0.66), 0.018, 0.003), m.rubber, 'beltSeal');

  // thick C-pillar (body colour) and black B-pillar trim over the side glass band
  b.add(ribbon(surf, S, [[-0.6, 0.985], [-0.615, 1.365]], 0.065, { offset: 0.0035, n: 10, mirror: true }), m.gloss, 'bPillar');
  // rear quarter window (trapezoid narrowing back) ends at a thick C-pillar that slopes forward into the hatch;
  // the pillar is laid over the glass band and built from the band's own rows so it stays inside it
  const qx0 = -1.44;
  const qx1 = -1.2;
  const bandTop = (x: number) => G.point(rowRange(gh.rowX, x, 99)[0], GJ[1]).y;
  const cp: V2[] = [[qx0, yBelt(qx0) + 0.006], [(qx0 + qx1) / 2, (yBelt(qx0) + bandTop(qx1)) / 2], [qx1, bandTop(qx1) - 0.006]];
  const iQ1 = rowRange(gh.rowX, qx1, 99)[0];
  let iEnd = 0;
  for (let i = iQ1; i >= 0; i--) {
    const h = G.point(i, GJ[1]).y - G.point(i, 0).y;
    if (h < 0.03) break;
    iEnd = i;
    if (i < iQ1) cp.push([gh.rowX[i], G.point(i, GJ[1]).y - 0.006]);
  }
  for (let i = iEnd; gh.rowX[i] < qx0 - 0.02; i++) cp.push([gh.rowX[i], G.point(i, 0).y + 0.006]);
  b.add(patch(new Surf([G]), S, cp, { offset: 0.003, mirror: true }), m.paint, 'cPillar', 'paint');
  b.add(ribbon(surf, S, [cp[0], cp[1], cp[2]], 0.02, { offset: 0.0045, n: 12, mirror: true }), m.rubber, 'qSeal');
  b.add(ribbon(surf, S, [[qx1 - 0.01, bandTop(qx1) - 0.004], [-0.6, bandTop(-0.6) - 0.004]], 0.012, { offset: 0.004, n: 20, mirror: true }), m.rubber, 'qSealTop');

  // ---- shut lines ----
  const gap = 0.0055;
  const doorF: V2[] = [[0.66, 0.965], [0.69, 0.7], [0.705, 0.42], [0.712, 0.25]];
  const doorR: V2[] = [[-0.6, 0.982], [-0.592, 0.6], [-0.585, 0.26]];
  b.add(ribbon(surf, S, doorF, gap, { n: 16, mirror: true }), m.gap, 'gapDoorF');
  b.add(ribbon(surf, S, doorR, gap, { n: 16, mirror: true }), m.gap, 'gapDoorR');
  b.add(ribbon(surf, S, [[-0.585, 0.262], [0.712, 0.252]], gap, { n: 24, mirror: true }), m.gap, 'gapSill');
  b.add(gridLine(L, LJ[5], iH0, iH1 + 2, gap, 0.0015), m.gap, 'gapHoodSide');
  b.add(ribbon(surf, T, [[0.748, 0], [0.745, 0.4], [0.74, 0.78]], gap, { n: 16, mirror: true }), m.gap, 'gapCowl');
  // tailgate: across above the bumper and up beside the lamps
  b.add(ribbon(surf, R, [[0, 0.535], [0.3, 0.535], [0.405, 0.55], [0.415, 0.67], [0.41, 0.93], [0.43, 0.985]], gap, { n: 30, mirror: true }), m.gap, 'gapTailgate');
  // fuel flap on the right rear quarter
  b.add(ribbon(surf, S, ellipse(-1.52, 0.77, 0.075, 0.075, 24), gap, { closed: true }), m.gap, 'gapFuel');

  // ---- wheel wells ----
  for (const a of arches) b.add(mirrorZ(wellGeo(a.x, a.y, a.r + 0.004, 0.12, 0.82, 0.47)), m.liner, 'well');
  // arch lips: a slim rolled edge
  for (const a of arches) {
    const pts: V3[] = [];
    for (let k = 0; k <= 20; k++) {
      const t = Math.PI * (0.02 + 0.96 * (k / 20));
      const x = a.x + Math.cos(t) * (a.r + 0.002);
      const y = a.y + Math.sin(t) * (a.r + 0.002);
      const h = castAt(surf, S, x, y + 0.012);
      pts.push([x, y, (h?.p.z ?? 0.83) - 0.004]);
    }
    b.add(mirrorZ(tube(pts, 0.009, 24, 5)), m.paint, 'archLip', 'paint');
  }

  // ---- bumpers: thick black wrap-rounds with a rub groove ----
  const fOut = resample(planOutline(L, 0.4, 1.6, 2.2, LJ[1], LJ[5]), 44);
  const fPath = offsetPath(fOut, -0.012);
  const fb = sweep(fPath, (k, n) => bumperProfile(0.07 * Math.min(1, k / 6 + 0.25), 0.27, 0.5, 0.03, 4, 0.006));
  const rOut = resample(planOutline(L, 0.42, -2.2, -1.6, LJ[1], LJ[5]), 40);
  const rPath = offsetPath(rOut, -0.012);
  const rb = sweep(rPath, (k, n) => bumperProfile(0.065 * Math.min(1, (n - 1 - k) / 6 + 0.25), 0.29, 0.52, 0.03, 4, 0.006));
  b.add(fb.geometry(), m.trim, 'bumperF');
  b.add(rb.geometry(), m.trim, 'bumperR');
  const bs = new Surf([fb, rb]);
  b.add(ribbon(bs, frontP([1.6, 2.2]), [[0, 0.405], [0.5, 0.405], [0.74, 0.405]], 0.022, { n: 24, mirror: true, offset: 0.001 }), m.gap, 'bumperGrooveF');
  b.add(ribbon(bs, rearP([-2.2, -1.6]), [[0, 0.42], [0.5, 0.42], [0.74, 0.42]], 0.022, { n: 24, mirror: true, offset: 0.001 }), m.gap, 'bumperGrooveR');
  // front valance with a slot intake
  b.add(patch(surf, F, rrect(0, 0.245, 0.9, 0.035, 0.015, 32), { offset: 0.003 }), m.black, 'valanceSlot');

  // ---- front fascia: black slatted grille band with quad round lamps ----
  b.add(patch(surf, F, rrect(0, 0.7, 1.41, 0.215, 0.05, 64), { offset: 0.002, rings: 5 }), m.black, 'grilleBand');
  for (let k = 0; k < 4; k++) {
    const y = 0.636 + k * 0.04;
    b.add(ribbon(surf, F, [[0, y], [0.2, y], [0.405, y]], 0.013, { n: 12, crown: 0.004, offset: 0.004, mirror: true }), m.gloss, 'slat');
  }
  b.add(ribbon(surf, F, [[0, 0.606], [0.2, 0.606], [0.43, 0.606]], 0.008, { n: 12, offset: 0.004, mirror: true }), lightAccent(), 'grilleStripe');
  // emblem
  const emb = castAt(surf, F, 0, 0.7);
  if (emb) {
    const ring = new THREE.TorusGeometry(0.052, 0.006, 8, 32).rotateY(Math.PI / 2);
    ring.translate(emb.p.x + 0.012, emb.p.y, 0);
    b.add(ring, m.chrome, 'emblemRing');
    const disc = new THREE.CircleGeometry(0.05, 32).rotateY(Math.PI / 2).translate(emb.p.x + 0.01, emb.p.y, 0);
    b.add(disc, m.gloss, 'emblemDisc');
    const badge = new THREE.PlaneGeometry(0.09, 0.03).rotateY(Math.PI / 2).translate(emb.p.x + 0.014, emb.p.y, 0);
    b.add(badge, badgeMaterial('RV'), 'emblem');
  }
  const heads: THREE.Vector3[] = [];
  for (const [z, r] of [[0.585, 0.088], [0.43, 0.06]] as [number, number][]) {
    const c = castAt(surf, F, z, 0.7);
    if (!c) continue;
    if (r > 0.07) heads.push(c.p.clone(), new THREE.Vector3(c.p.x, c.p.y, -c.p.z));
    b.add(patch(surf, F, ellipse(z, 0.7, r, r, 36), { offset: 0.004, rings: 4, mirror: true }), m.chrome, 'lampReflector');
    b.add(ribbon(surf, F, ellipse(z, 0.7, r + 0.006, r + 0.006, 40), 0.012, { closed: true, crown: 0.006, offset: 0.004, mirror: true }), m.chrome, 'lampBezel');
    b.add(patch(surf, F, ellipse(z, 0.7, r * 0.45, r * 0.45, 24), { offset: 0.009, rings: 3, dome: 0.006, ownNormals: true, mirror: true }), m.head, 'headLamp', 'head');
    b.add(patch(surf, F, ellipse(z, 0.7, r, r, 36), { offset: 0.012, rings: 6, dome: 0.012, ownNormals: true, mirror: true }), m.lens, 'headLens');
  }
  // bumper turn signals + fogs
  b.add(patch(bs, frontP([1.6, 2.2]), rrect(0.6, 0.455, 0.15, 0.04, 0.008, 24), { offset: 0.003, mirror: true }), m.amber, 'indicatorF');
  b.add(patch(bs, frontP([1.6, 2.2]), rrect(0.6, 0.455, 0.15, 0.04, 0.008, 24), { offset: 0.006, dome: 0.003, ownNormals: true, mirror: true }), m.lensAmber, 'indicatorLensF');

  // ---- rear: wide wrap-round lamp clusters, plate recess, badge ----
  const tails: THREE.Vector3[] = [];
  const tl: V2[] = [[0.43, 0.63], [0.8, 0.63], [0.818, 0.73], [0.805, 0.875], [0.43, 0.875]];
  const tlo = crLoopish(tl);
  b.add(patch(surf, R, tlo, { offset: 0.002, mirror: true }), m.black, 'tailHousing');
  b.add(patch(surf, R, rrect(0.6, 0.82, 0.33, 0.085, 0.01, 28), { offset: 0.0045, mirror: true }), m.tail, 'tailLamp', 'tail');
  b.add(patch(surf, R, rrect(0.6, 0.735, 0.33, 0.06, 0.008, 28), { offset: 0.0045, mirror: true }), m.amber, 'tailIndicator');
  b.add(patch(surf, R, rrect(0.52, 0.67, 0.16, 0.05, 0.008, 24), { offset: 0.0045, mirror: true }), m.reverse, 'reverse');
  b.add(patch(surf, R, rrect(0.7, 0.67, 0.16, 0.05, 0.008, 24), { offset: 0.0045, mirror: true }), m.tailDim, 'tailFog', 'tail');
  b.add(patch(surf, R, tlo, { offset: 0.008, dome: 0.004, ownNormals: true, mirror: true, scale: 0.985 }), m.lensRed, 'tailLens');
  for (const z of [0.6, -0.6]) {
    const h = castAt(surf, R, Math.abs(z), 0.77);
    if (h) tails.push(new THREE.Vector3(h.p.x, h.p.y, z));
  }
  b.add(patch(surf, R, rrect(0, 0.6, 0.56, 0.135, 0.012, 32), { offset: 0.0015 }), m.black, 'plateRecess');
  const pl = castAt(surf, R, 0, 0.6);
  if (pl) b.add(new THREE.PlaneGeometry(0.52, 0.11).rotateY(-Math.PI / 2).translate(pl.p.x - 0.006, pl.p.y, 0), plateMaterial('RVL 001'), 'plate');
  const bd = castAt(surf, R, -0.2, 0.92);
  if (bd) b.add(new THREE.PlaneGeometry(0.16, 0.04).rotateY(-Math.PI / 2).translate(bd.p.x - 0.004, bd.p.y, -0.2), badgeMaterial('RV-1', '#d8dce2'), 'badgeR');

  // ---- side details: rub strip, door handle, mirrors ----
  b.add(ribbon(surf, S, [[-0.86, 0.52], [0, 0.52], [0.87, 0.52]], 0.032, { n: 30, crown: 0.006, offset: 0.002, mirror: true }), m.trim, 'rubStrip');
  b.add(patch(surf, S, rrect(-0.43, 0.89, 0.17, 0.032, 0.012, 24), { offset: 0.006, dome: 0.004, ownNormals: true, mirror: true }), m.black, 'handle');
  b.add(patch(surf, S, rrect(-0.43, 0.89, 0.13, 0.014, 0.006, 20), { offset: 0.0095, mirror: true }), m.gap, 'handleSlot');
  doorMirror(b, 0.56, 1.03, 0.79, { w: 0.17, h: 0.11, paint: false });

  // ---- wipers (parked across the windshield base) + rear wiper ----
  const wiper = (z0: number, z1: number) => {
    const pts: V3[] = [];
    for (let k = 0; k <= 12; k++) {
      const z = z0 + (z1 - z0) * (k / 12);
      const x = 0.7 - (k / 12) * 0.07;
      const h = castAt(surf, T, x, z);
      if (h) pts.push([h.p.x + h.n.x * 0.014, h.p.y + h.n.y * 0.014, h.p.z + h.n.z * 0.014]);
    }
    return tube(pts, 0.0065, 18, 6);
  };
  b.add(merge([wiper(-0.62, 0.05), wiper(-0.02, 0.52)]), m.black, 'wipers');
  const rw: V3[] = [];
  for (let k = 0; k <= 8; k++) {
    const h = castAt(surf, R, -0.02 + k * 0.05, 1.0 + k * 0.035);
    if (h) rw.push([h.p.x - 0.014, h.p.y, h.p.z]);
  }
  if (rw.length > 2) b.add(tube(rw, 0.006, 12, 6), m.black, 'rearWiper');

  // ---- underbody: pan, tunnel, tank, exhaust run ----
  const under = merge([
    place(new THREE.PlaneGeometry(3.3, 1.18).rotateX(Math.PI / 2), [0.05, 0.2, 0]),
    place(rbox(1.9, 0.12, 0.26, 0.5), [0.1, 0.24, 0]),
    place(rbox(0.6, 0.18, 0.8, 0.4), [-0.85, 0.27, 0]),
    place(rbox(0.5, 0.25, 1.2, 0.5), [1.45, 0.4, 0]),
  ]);
  b.add(under, m.under, 'underbody');
  b.add(tube([[1.2, 0.22, 0.1], [0.4, 0.2, 0.12], [-0.6, 0.2, 0.2], [-1.4, 0.21, 0.38], [-1.8, 0.235, 0.45]], 0.03, 24, 8), m.metal, 'exhaustPipe');
  b.add(place(rbox(0.36, 0.14, 0.22, 0.5), [-1.48, 0.24, 0.42]), m.metal, 'muffler');

  // ---- interior ----
  cabinInterior(b, { xDash: 0.62, yDash: 0.96, wIn: 0.7, floorY: 0.32, xSeat: -0.22, seatZ: 0.37, xRear: -1.1, xWheel: 0.24, yWheel: 0.89 });

  const anchor = (P: typeof S, u: number, v: number, fb: THREE.Vector3) => castAt(surf, P, u, v)?.p ?? fb;
  const hood = anchor(T, 1.3, 0, v3(1.3, 0.88, 0));
  const roof = anchor(T, -0.6, 0, v3(-0.6, 1.4, 0));
  const deck = anchor(T, -1.52, 0, v3(-1.52, 1.39, 0));
  return finish(
    b,
    { length: XF - XR + 0.06, width: 1.68, height: 1.41, wheelbase: WB, trackF: TF, trackR: TR, wheelR: WR, rideHeight: 0.13 },
    {
      wheelFL: v3(ax, WR, TF / 2), wheelFR: v3(ax, WR, -TF / 2), wheelRL: v3(-ax, WR, TR / 2), wheelRR: v3(-ax, WR, -TR / 2),
      exhausts: [{ pos: v3(-1.93, 0.235, 0.45), dir: v3(-1, 0, 0) }],
      hood, roof, deck,
      frontBumper: v3(2.02, 0.27, 0),
      seat: v3(-0.4, 1.12, -0.37),
      headlights: heads.length ? heads : [v3(XF, 0.67, 0.58), v3(XF, 0.67, -0.58)],
      taillights: tails.length ? tails : [v3(XR, 0.74, 0.6), v3(XR, 0.74, -0.6)],
    },
    { belt: 0.97, sill: 0.27, door: [-0.6, 0.7], cowl: 0.745 },
  );
}

/** Smooth closed outline through a few keys. */
function crLoopish(keys: V2[]): V2[] {
  const pts = crPath([...keys, keys[0]], 6);
  pts.pop();
  return pts;
}

let accentMat: THREE.Material | null = null;
function lightAccent(): THREE.Material {
  // a thin red grille pinstripe (classic hot-hatch cue); shared and never disposed per car
  if (!accentMat) {
    accentMat = new THREE.MeshPhysicalMaterial({ color: 0xc0141c, roughness: 0.35, clearcoat: 1 });
    accentMat.userData.shared = true;
  }
  return accentMat;
}
