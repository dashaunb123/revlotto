// 'truck': the Tow Rig, a full-size extended-cab pickup (F-150 / Silverado SuperCab vibe): tall flat hood with a power
// dome, a huge chrome-framed grille with twin bars into tall C-lamp headlights, chrome wrap bumper with tow hooks,
// upright windshield, square cab with a vertical back window and third brake light, a separate bed (liner, wheel tubs,
// rail caps) with vertical corner tail lamps, tailgate and a chrome step bumper. Ladder frame, axle and spare underneath.
// Contract: ../../types.ts BodyBuild. Car faces +X, +Z = the car's right, driver (LHD) on -Z. Units: metres.
import * as THREE from 'three';
import { badgeMaterial, grille, plateMaterial } from '../../materials';
import type { BodyBuild, CarSpec } from '../../types';
import {
  Body, Grid, Surf, bumperProfile, cabinInterior, castAt, crLoop, crPath, curve, doorMirror, finish, frontP, greenhouse, gridLine, lowerShell, mats,
  merge, mirrorZ, offsetPath, patch, place, planOutline, rbox, rearP, resample, ribbon, rowRange, rrect, shellMeshes, sideP, sweep, topP, tube,
  v3, wellGeo, wrapP, type V2, type V3,
} from './_helpersA';

const WB = 3.68;
const WR = 0.395;
const TF = 1.7;
const TR = 1.7;
const XF = 2.8;
const XR = -2.8;
const XCAB = -0.66; // back of the cab
const XBED = -0.7; // front of the bed

export default function build(spec: CarSpec): BodyBuild {
  const m = mats(spec);
  const b = new Body(m);
  const ax = WB / 2;
  const archF = { x: ax, y: WR, r: 0.47 };
  const archR = { x: -ax, y: WR, r: 0.47 };

  // ---- cab + front clip ----
  const yBelt = curve([[XCAB, 1.31], [0.3, 1.3], [1.3, 1.272], [1.4, 1.255], [1.84, 1.222], [2.5, 1.192], [XF, 1.165]]);
  const lower = lowerShell({
    xR: XCAB, xF: XF, step: 0.05,
    capF: { len: 0.24, p: 5, rake: (y) => (y > 0.9 ? -(y - 0.9) * 0.12 : -(0.9 - y) * 0.06) },
    capR: { len: 0.05, p: 8 },
    yBot: curve([[XCAB, 0.56], [0.0, 0.53], [1.3, 0.52], [2.35, 0.5], [2.6, 0.58], [XF, 0.66]]),
    w: curve([[XCAB, 0.972], [0, 0.982], [1.84, 0.998], [2.55, 0.99]]),
    yMax: curve([[XCAB, 0.88], [1.0, 0.9], [1.84, 0.98], [2.6, 1.0]]),
    tuck: () => 0.035,
    yBelt,
    roll: () => 0.045,
    yTop: curve([[XCAB, 1.31], [1.42, 1.262], [1.84, 1.24], [2.5, 1.212], [XF, 1.175]]),
    shoulder: () => [0.11, 0.018],
    cabin: [-0.6, 1.28],
    floorY: 0.62,
    arches: [archF],
  });
  const L = lower.grid;
  const LJ = lower.keyJ;

  const cowl = curve([[1.3, 0.95], [1.33, 0.86], [1.36, 0.74], [1.38, 0.62], [1.4, 0.44], [1.41, 0.31], [1.418, 0.15], [1.42, 0]]);
  const gh = greenhouse({
    xr: -0.645, xf: 1.42, step: 0.045, rail: 0.035, crown: 0.3,
    yBase: (x) => yBelt(x) - 0.004,
    wBase: curve([[-0.645, 0.93], [-0.56, 0.95], [1.2, 0.955], [1.3, 0.95]]),
    yEdge: curve([[-0.7, 1.2], [-0.645, 1.31], [-0.615, 1.85], [-0.55, 1.872], [0.6, 1.88], [0.95, 1.6], [1.3, 1.272], [1.42, 1.2]]),
    wEdge: (x) => (x > 1.3 ? cowl(x) : curve([[-0.62, 0.84], [-0.4, 0.832], [0.6, 0.832], [1.0, 0.89], [1.3, 0.95]])(x)),
    yTop: curve([[-0.645, 1.305], [-0.612, 1.885], [-0.5, 1.915], [0.3, 1.925], [0.66, 1.9], [1.05, 1.58], [1.42, 1.255]]),
  });
  const G = gh.grid;
  const GJ = gh.keyJ;
  const surf = new Surf([L, G]);
  const S = sideP(1);
  const T = topP();
  const F = frontP([2.4, 2.95]);
  const sp = shellMeshes(b, lower, gh, { cabin: [-0.6, 1.28], hood: [1.42, XF - 0.24], ws: 0.68, back: -99, quarter: -0.52 });
  const iA = rowRange(gh.rowX, -99, 1.3)[1];
  b.add(gridLine(G, GJ[1], 1, iA, 0.016, 0.002), m.rubber, 'dloSeal');
  b.add(gridLine(G, 0, rowRange(gh.rowX, -0.58, 99)[0], iA, 0.02, 0.003), m.rubber, 'beltSeal');
  b.add(ribbon(surf, S, [[0.24, 1.31], [0.24, 1.86]], 0.05, { offset: 0.0035, n: 10, mirror: true }), m.gloss, 'bPillarSeal');
  // back window in the cab's back wall, framed, plus the third brake light
  const RB = rearP([-0.75, -0.5]);
  b.add(patch(surf, RB, rrect(0, 1.6, 1.3, 0.4, 0.05, 48), { offset: 0.002 }), m.black, 'backWindowFrame');
  b.add(patch(surf, RB, rrect(0, 1.6, 1.22, 0.34, 0.04, 48), { offset: 0.004 }), m.glass, 'backWindow');
  b.add(ribbon(surf, RB, [[0, 1.6], [0.0, 1.43], [0.0, 1.77]], 0.012, { offset: 0.006, n: 6 }), m.black, 'slider');
  b.add(patch(surf, RB, rrect(0, 1.865, 0.26, 0.03, 0.01, 20), { offset: 0.004 }), m.tail, 'chmsl', 'tail');

  // ---- shut lines ----
  const gap = 0.006;
  b.add(ribbon(surf, S, [[1.3, 1.27], [1.33, 1.0], [1.36, 0.7], [1.37, 0.56]], gap, { n: 16, mirror: true }), m.gap, 'gapDoorF');
  b.add(ribbon(surf, S, [[0.24, 1.3], [0.24, 0.9], [0.245, 0.56]], gap, { n: 14, mirror: true }), m.gap, 'gapDoorB');
  b.add(ribbon(surf, S, [[-0.58, 1.31], [-0.585, 0.9], [-0.58, 0.57]], gap, { n: 14, mirror: true }), m.gap, 'gapDoorR');
  b.add(ribbon(surf, S, [[-0.58, 0.575], [1.37, 0.56]], gap, { n: 20, mirror: true }), m.gap, 'gapSill');
  b.add(ribbon(surf, T, [[1.44, 0], [1.43, 0.5], [1.4, 0.94]], gap, { n: 14, mirror: true }), m.gap, 'gapCowl');
  b.add(gridLine(L, LJ[5], sp.iH0, sp.iH1, gap, 0.0015), m.gap, 'gapHoodSide');
  // power dome on the hood
  b.add(ribbon(surf, T, [[1.55, 0.36], [2.0, 0.35], [2.6, 0.34]], 0.012, { n: 20, crown: 0.006, offset: 0.0015, mirror: true }), m.paint, 'domeCrease', 'paint');

  // ---- front: big grille, twin chrome bars, C-lamp headlights ----
  const gO = rrect(0, 0.93, 1.28, 0.42, 0.04, 64);
  b.add(patch(surf, F, gO, { offset: 0.002 }), m.gap, 'grilleBack');
  b.add(patch(surf, F, gO, { offset: 0.008, scale: 0.97 }), grille({ pattern: 'mesh', repeat: [12, 4] }), 'grilleMesh');
  b.add(ribbon(surf, F, gO, 0.045, { closed: true, crown: 0.016, offset: 0.006 }), m.chrome, 'grilleSurround');
  for (const y of [0.86, 1.0]) b.add(ribbon(surf, F, [[0, y], [0.4, y], [0.66, y]], 0.05, { n: 16, crown: 0.02, offset: 0.012, mirror: true }), m.chrome, 'grilleBar');
  const emb = castAt(surf, F, 0, 0.93);
  if (emb) {
    b.add(rbox(0.04, 0.12, 0.3, 0.45, 14).translate(emb.p.x + 0.035, emb.p.y, 0), m.chrome, 'emblem');
    b.add(new THREE.PlaneGeometry(0.26, 0.07).rotateY(Math.PI / 2).translate(emb.p.x + 0.057, emb.p.y, 0), badgeMaterial('TOW RIG', '#1d2a4a'), 'emblemText');
  }
  const Wf = wrapP(L, 1.0, 'front', 1.3, LJ[1], LJ[5]);
  const lamp: V2[] = [[0.68, 0.88], [0.96, 0.88], [1.04, 0.92], [1.04, 1.1], [0.96, 1.13], [0.68, 1.13]];
  const lampO = crLoop(lamp, 40);
  b.add(patch(surf, Wf, lampO, { offset: 0.003, mirror: true }), m.blackChrome, 'headHousing');
  b.add(ribbon(surf, Wf, [[0.95, 0.9], [0.72, 0.9], [0.72, 1.11], [0.95, 1.11]], 0.018, { n: 24, offset: 0.007, mirror: true }), m.drl, 'drlC', 'head');
  const proj: THREE.BufferGeometry[] = [];
  for (const [u, v] of [[0.82, 1.04], [0.82, 0.96]] as V2[]) {
    const h = castAt(surf, Wf, u, v);
    if (h) proj.push(place(new THREE.SphereGeometry(0.034, 14, 10), [h.p.x + h.n.x * 0.01, h.p.y, h.p.z + h.n.z * 0.01]));
  }
  b.add(mirrorZ(merge(proj)), m.head, 'projector', 'head');
  b.add(patch(surf, Wf, crLoop([[0.98, 0.94], [1.03, 0.94], [1.03, 1.08], [0.98, 1.08]], 16), { offset: 0.006, mirror: true }), m.amber, 'sideMarker');
  b.add(patch(surf, Wf, lampO, { offset: 0.014, dome: 0.006, ownNormals: true, mirror: true, scale: 0.99 }), m.lens, 'headLens');

  // chrome front bumper wrapping to the arches, black air dam, fogs, red tow hooks
  const fOut = resample(planOutline(L, 0.7, 2.3, 3.2, LJ[1], LJ[5]), 34);
  const fb = sweep(offsetPath(fOut, -0.01), (k) => bumperProfile(0.12 * Math.min(1, k / 5 + 0.3), 0.4, 0.72, 0.045, 4, 0.012));
  b.add(fb.geometry(), m.chrome, 'bumperF');
  const fbs = new Surf([fb]);
  const FB = frontP([2.4, 3.2]);
  b.add(patch(fbs, FB, rrect(0, 0.47, 1.2, 0.08, 0.03, 40), { offset: 0.002 }), m.trim, 'bumperInsert');
  b.add(patch(fbs, FB, rrect(0.72, 0.6, 0.16, 0.07, 0.02, 24), { offset: 0.003, mirror: true }), m.gloss, 'fogBezel');
  b.add(patch(fbs, FB, rrect(0.72, 0.6, 0.12, 0.045, 0.015, 20), { offset: 0.006, dome: 0.004, ownNormals: true, mirror: true }), m.drl, 'fog', 'head');
  const fx = castAt(fbs, FB, 0, 0.56)?.p.x ?? XF + 0.1;
  b.add(place(rbox(0.2, 0.08, 1.7, 0.4, 10), [fx - 0.08, 0.37, 0]), m.trim, 'airDam');
  const hook = (z: number) => mirrorZ(tube([[fx - 0.1, 0.4, z], [fx + 0.02, 0.4, z], [fx + 0.06, 0.45, z], [fx + 0.02, 0.5, z]], 0.017, 10, 6));
  b.add(hook(0.42), towRed(), 'towHooks');

  // ---- wells, running boards, mirrors, handles, fender badge ----
  b.add(mirrorZ(wellGeo(archF.x, archF.y, archF.r + 0.004, 0.3, 0.97, 0.52)), m.liner, 'well');
  const archLip = (a: { x: number; y: number; r: number }, s: Surf, zf: number) => {
    const pts: V3[] = [];
    for (let k = 0; k <= 20; k++) {
      const t = Math.PI * (0.03 + 0.94 * (k / 20));
      const x = a.x + Math.cos(t) * (a.r + 0.012);
      const y = a.y + Math.sin(t) * (a.r + 0.012);
      const h = castAt(s, S, x, y + 0.02);
      pts.push([x, y, (h?.p.z ?? zf) + 0.004]);
    }
    return mirrorZ(tube(pts, 0.022, 24, 5));
  };
  b.add(archLip(archF, surf, 0.99), m.trim, 'archMolding');
  const step: THREE.BufferGeometry[] = [];
  step.push(place(rbox(1.75, 0.07, 0.16, 0.35, 10), [0.38, 0.47, 1.06]));
  for (const x of [-0.3, 0.6, 1.2]) step.push(place(rbox(0.06, 0.1, 0.12, 0.5, 8), [x, 0.53, 0.98]));
  b.add(mirrorZ(merge(step)), m.trim, 'runningBoards');
  doorMirror(b, 1.2, 1.42, 0.95, { w: 0.24, h: 0.3, paint: false });
  for (const x of [0.6, -0.48]) b.add(patch(surf, S, rrect(x, 1.18, 0.24, 0.05, 0.02, 24), { offset: 0.008, dome: 0.006, ownNormals: true, mirror: true }), m.chrome, 'handle');
  b.add(patch(surf, S, crLoop([[1.98, 0.98], [2.3, 1.0], [2.3, 1.06], [1.98, 1.03]], 20), { offset: 0.006, dome: 0.004, ownNormals: true, mirror: true }), m.chrome, 'fenderBadge');

  // ---- the bed: own loft (outer skin, rail cap, liner), wheel tubs, front wall, corner posts, tailgate ----
  const bedRows: V3[][] = [];
  const nB = 46;
  for (let i = 0; i <= nB; i++) {
    const x = XR + 0.1 + ((XBED - (XR + 0.1)) * i) / nB;
    const dx = x - archR.x;
    const arch = Math.abs(dx) < archR.r ? archR.y + Math.sqrt(archR.r * archR.r - dx * dx) : 0;
    const yb = Math.max(0.6, arch);
    const keys: V2[] = [
      [yb + 0.03, 0.95],
      [yb, 0.985],
      [Math.min(yb + 0.06, 1.2), 0.998],
      [1.0, 1.0],
      [1.22, 0.996],
      [1.3, 0.985],
      [1.325, 0.95],
      [1.31, 0.915],
      [1.22, 0.905],
      [0.9, 0.9],
      [0.86, 0.87],
      [0.85, 0.45],
      [0.85, 0],
    ];
    bedRows.push(crPath(keys, [1, 2, 3, 3, 1, 1, 1, 1, 3, 1, 3, 2]).map(([y, z]) => [x, y, z] as V3));
  }
  const bed = new Grid(bedRows);
  const jRail = 13; // outer skin ends at the rail cap's inner edge
  b.add(bed.geometry(0, nB, 0, 10), m.paint, 'bedSides', 'paint');
  b.add(bed.geometry(0, nB, 10, jRail), m.trim, 'bedRailCap');
  b.add(bed.geometry(0, nB, jRail, bed.nj - 1), m.black, 'bedLiner');
  const bs = new Surf([bed]);
  b.add(mirrorZ(wellGeo(archR.x, archR.y, archR.r + 0.004, 0.3, 0.99, 0.6)), m.liner, 'well');
  b.add(archLip(archR, bs, 0.998), m.trim, 'archMolding');
  b.add(mirrorZ(place(rbox(1.0, 0.16, 0.24, 0.45, 10), [archR.x, 0.9, 0.78])), m.black, 'wheelTubs');
  b.add(place(rbox(0.05, 0.72, 1.99, 0.3, 10), [XBED + 0.005, 0.96, 0]), m.paint, 'bedFront', 'paint');
  b.add(place(new THREE.BoxGeometry(0.02, 0.45, 1.78), [XBED - 0.03, 1.08, 0]), m.black, 'bedFrontInner');
  const posts = mirrorZ(place(rbox(0.12, 0.74, 0.15, 0.25, 10), [XR + 0.08, 0.96, 0.925]));
  b.add(posts, m.paint, 'bedPosts', 'paint');
  b.add(place(rbox(0.06, 0.68, 1.7, 0.2, 12), [XR + 0.04, 0.97, 0]), m.paint, 'tailgate', 'paint');
  b.add(place(rbox(0.012, 0.05, 0.26, 0.5, 8), [XR + 0.006, 1.24, 0]), m.gap, 'tailgateHandle');
  b.add(new THREE.PlaneGeometry(0.62, 0.11).rotateY(-Math.PI / 2).translate(XR + 0.006, 1.06, 0), badgeMaterial('TOW RIG', '#c8ccd2'), 'tailgateBadge');
  // vertical corner tail lamps on the posts
  const lampBox = mirrorZ(place(rbox(0.03, 0.5, 0.12, 0.3, 10), [XR + 0.01, 1.04, 0.925]));
  b.add(lampBox, m.tail, 'tailLamp', 'tail');
  b.add(mirrorZ(place(rbox(0.03, 0.1, 0.11, 0.3, 8), [XR + 0.004, 0.86, 0.925])), m.reverse, 'reverse');
  b.add(mirrorZ(place(rbox(0.045, 0.53, 0.135, 0.3, 10), [XR + 0.012, 1.0, 0.925])), m.lensRed, 'tailLens');
  // chrome step bumper with a plate recess and the hitch receiver
  b.add(place(rbox(0.2, 0.2, 2.02, 0.25, 12), [XR - 0.02, 0.58, 0]), m.chrome, 'bumperR');
  b.add(place(rbox(0.16, 0.02, 0.42, 0.3, 8), [XR - 0.03, 0.685, 0]), m.trim, 'stepPad');
  b.add(place(new THREE.BoxGeometry(0.02, 0.17, 0.33), [XR - 0.121, 0.57, 0]), m.black, 'plateRecess');
  b.add(new THREE.PlaneGeometry(0.305, 0.152).rotateY(-Math.PI / 2).translate(XR - 0.133, 0.57, 0), plateMaterial('TOW 4X4'), 'plate');
  b.add(place(new THREE.BoxGeometry(0.2, 0.06, 0.06), [XR - 0.06, 0.45, 0]), m.black, 'hitch');

  // ---- underbody: ladder frame, rear axle + diff, spare, tank, exhaust ----
  const frame: THREE.BufferGeometry[] = [];
  for (const z of [0.5, -0.5]) frame.push(place(new THREE.BoxGeometry(5.1, 0.16, 0.07), [-0.15, 0.55, z]));
  for (const x of [2.2, 0.8, -0.7, -2.1]) frame.push(place(new THREE.BoxGeometry(0.07, 0.12, 1.0), [x, 0.55, 0]));
  frame.push(place(new THREE.PlaneGeometry(2.0, 1.8).rotateX(Math.PI / 2), [0.35, 0.52, 0]));
  b.add(merge(frame), m.under, 'frame');
  b.add(merge([place(new THREE.CylinderGeometry(0.045, 0.045, 1.5, 10).rotateX(Math.PI / 2), [archR.x, WR, 0]), place(new THREE.SphereGeometry(0.15, 12, 10), [archR.x, WR, 0])]), m.metal, 'rearAxle');
  b.add(place(new THREE.TorusGeometry(0.3, 0.1, 8, 20).rotateX(Math.PI / 2), [-2.45, 0.5, 0]), m.rubber, 'spare');
  b.add(place(rbox(0.8, 0.25, 0.55, 0.4, 10), [-0.2, 0.5, 0.62]), m.under, 'tank');
  const tip: V3 = [XR + 0.25, 0.47, 0.72];
  b.add(tube([[1.8, 0.5, 0.15], [0.6, 0.48, 0.3], [-0.9, 0.48, 0.32], [-1.4, 0.48, 0.45], [-2.2, 0.47, 0.6], [tip[0] + 0.05, tip[1], tip[2]]], 0.035, 30, 8), m.metal, 'exhaustPipe');
  b.add(place(rbox(0.7, 0.2, 0.3, 0.45, 10), [-1.1, 0.48, 0.3]), m.metal, 'muffler');

  // ---- wipers + interior ----
  const wiper = (z0: number, z1: number, x0: number) => {
    const pts: V3[] = [];
    for (let k = 0; k <= 12; k++) {
      const h = castAt(surf, T, x0 - (k / 12) * 0.1, z0 + (z1 - z0) * (k / 12));
      if (h) pts.push([h.p.x + h.n.x * 0.016, h.p.y + h.n.y * 0.016, h.p.z + h.n.z * 0.016]);
    }
    return tube(pts, 0.007, 18, 6);
  };
  b.add(merge([wiper(-0.72, 0.05, 1.36), wiper(-0.02, 0.7, 1.36)]), m.black, 'wipers');
  cabinInterior(b, { xDash: 1.26, yDash: 1.3, wIn: 0.86, floorY: 0.62, xSeat: 0.42, seatZ: 0.44, xRear: -0.36, xWheel: 0.86, yWheel: 1.2, dashDepth: 0.55, seatH: 1.05, wheelR: 0.2 });

  const heads: THREE.Vector3[] = [];
  const hh = castAt(surf, Wf, 0.82, 1.0);
  if (hh) heads.push(hh.p.clone(), new THREE.Vector3(hh.p.x, hh.p.y, -hh.p.z));
  const at = (u: number, v: number, fbk: THREE.Vector3) => castAt(surf, T, u, v)?.p ?? fbk;
  return finish(
    b,
    { length: XF - XR, width: 2.0, height: 1.93, wheelbase: WB, trackF: TF, trackR: TR, wheelR: WR, rideHeight: 0.23 },
    {
      wheelFL: v3(ax, WR, TF / 2), wheelFR: v3(ax, WR, -TF / 2), wheelRL: v3(-ax, WR, TR / 2), wheelRR: v3(-ax, WR, -TR / 2),
      exhausts: [{ pos: v3(tip[0], tip[1], tip[2]), dir: v3(-1, 0, 0) }],
      hood: at(2.0, 0, v3(2.0, 1.23, 0)),
      roof: at(0.0, 0, v3(0, 1.925, 0)),
      deck: v3(-2.62, 1.33, 0),
      frontBumper: v3(fx + 0.04, 0.42, 0),
      seat: v3(0.2, 1.68, -0.44),
      headlights: heads.length ? heads : [v3(XF - 0.05, 1.0, 0.82), v3(XF - 0.05, 1.0, -0.82)],
      taillights: [v3(XR - 0.005, 1.04, 0.925), v3(XR - 0.005, 1.04, -0.925)],
    },
    { belt: 1.3, sill: 0.58, door: [-0.58, 1.3], cowl: 1.43 },
  );
}

let towMat: THREE.Material | null = null;
function towRed(): THREE.Material {
  if (!towMat) {
    towMat = new THREE.MeshPhysicalMaterial({ color: 0xc41a1a, roughness: 0.4, clearcoat: 0.6 });
    towMat.userData.shared = true;
  }
  return towMat;
}
