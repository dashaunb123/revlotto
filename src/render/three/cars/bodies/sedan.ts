// 'sedan': the Malibru, a modern midsize four-door (2016+ Malibu vibe): long raked windshield, fastback roofline into a
// short deck, strong shoulder crease, slim swept headlamps tied by a chrome bar, big lower grille, chrome DLO surround,
// wide wrap-round tail lamps joined by a chrome strip, dual exhaust cut-outs.
// Contract: ../../types.ts BodyBuild. Car faces +X, +Z = the car's right, driver (LHD) on -Z. Units: metres.
import * as THREE from 'three';
import { badgeMaterial, grille, plateMaterial } from '../../materials';
import type { BodyBuild, CarSpec } from '../../types';
import {
  Body, Surf, cabinInterior, castAt, crLoop, curve, doorMirror, finish, frontP, greenhouse, gridLine, lowerShell, mats, merge, mirrorZ,
  patch, place, rbox, rearP, ribbon, rowRange, rrect, shellMeshes, sideP, topP, tube, underbody, v3, wellGeo, wrapP, type V2, type V3,
} from './_helpersA';

const WB = 2.83;
const WR = 0.34;
const TF = 1.59;
const TR = 1.58;
const XF = 2.4;
const XR = -2.52;

export default function build(spec: CarSpec): BodyBuild {
  const m = mats(spec);
  const b = new Body(m);
  const ax = WB / 2;
  const arches = [{ x: ax, y: WR, r: 0.395 }, { x: -ax, y: WR, r: 0.395 }];

  const yBelt = curve([[XR, 1.03], [-2.0, 1.058], [-1.3, 1.045], [-0.5, 1.012], [0.56, 0.985], [1.4, 0.93], [2.0, 0.87], [XF, 0.82]]);
  const lower = lowerShell({
    xR: XR, xF: XF, step: 0.046,
    capF: { len: 0.46, p: 2.6, rake: (y) => (y > 0.45 ? -(y - 0.45) * 0.36 : -(0.45 - y) * 0.28) },
    capR: { len: 0.36, p: 2.9, rake: (y) => (y > 0.62 ? (y - 0.62) * 0.2 : (0.62 - y) * 0.22) },
    yBot: curve([[XR, 0.36], [-2.25, 0.27], [-1.95, 0.225], [1.8, 0.215], [2.15, 0.205], [XF, 0.25]]),
    w: curve([[-2.2, 0.9], [-1.5, 0.925], [0, 0.925], [1.4, 0.922], [2.0, 0.895]]),
    yMax: curve([[-2.2, 0.8], [-1.4, 0.78], [0, 0.72], [1.4, 0.68], [2.0, 0.64]]),
    tuck: () => 0.065,
    yBelt,
    roll: () => 0.075,
    yTop: curve([[XR, 1.035], [-2.3, 1.062], [-1.95, 1.058], [0.66, 0.995], [1.4, 0.955], [2.0, 0.885], [XF, 0.82]]),
    shoulder: () => [0.1, 0.03],
    cabin: [-1.92, 0.5],
    floorY: 0.32,
    arches,
  });
  const L = lower.grid;
  const LJ = lower.keyJ;

  const cowl = curve([[0.56, 0.83], [0.6, 0.72], [0.63, 0.61], [0.66, 0.47], [0.68, 0.34], [0.69, 0.24], [0.698, 0.12], [0.7, 0]]);
  const edgeW = curve([[-1.98, 0.76], [-1.6, 0.69], [-1.15, 0.645], [-0.6, 0.648], [-0.28, 0.64], [0.2, 0.73], [0.56, 0.83]]);
  const gh = greenhouse({
    xr: -2.0, xf: 0.7, step: 0.04, rail: 0.03, crown: 0.65,
    yBase: (x) => yBelt(x) - 0.004,
    wBase: curve([[-2.0, 0.72], [-1.8, 0.8], [-1.4, 0.838], [0.3, 0.842], [0.56, 0.832]]),
    yEdge: curve([[-2.06, 0.95], [-1.98, 1.058], [-1.75, 1.2], [-1.45, 1.32], [-1.15, 1.385], [-0.6, 1.405], [-0.28, 1.395], [0.1, 1.228], [0.56, 0.985], [0.7, 0.9]]),
    wEdge: (x) => (x > 0.56 ? cowl(x) : edgeW(x)),
    yTop: curve([[-2.0, 1.054], [-1.9, 1.105], [-1.6, 1.245], [-1.3, 1.36], [-1.0, 1.425], [-0.6, 1.452], [-0.3, 1.442], [0.2, 1.24], [0.7, 0.99]]),
  });
  const G = gh.grid;
  const GJ = gh.keyJ;
  const surf = new Surf([L, G]);
  const S = sideP(1);
  const T = topP();
  const F = frontP([1.9, 2.6]);
  const R = rearP([-2.7, -2.0]);
  const sp = shellMeshes(b, lower, gh, { cabin: [-1.92, 0.5], hood: [0.66, XF - 0.46], ws: -0.24, back: -1.2, quarter: -1.8 });
  const iA = rowRange(gh.rowX, -99, 0.56)[1];
  const iCe = rowRange(gh.rowX, -1.98, 99)[0];
  // chrome DLO surround along the roof rail and C-pillar, black A-pillar seal, chrome belt
  b.add(gridLine(G, GJ[1], iCe, rowRange(gh.rowX, -99, -0.26)[1], 0.016, 0.002), m.chrome, 'dloChrome');
  b.add(gridLine(G, GJ[1], rowRange(gh.rowX, -0.26, 99)[0], iA, 0.014, 0.002), m.rubber, 'aSeal');
  b.add(gridLine(G, 0, rowRange(gh.rowX, -1.97, 99)[0], iA, 0.02, 0.003), m.chrome, 'beltChrome');
  // B-pillar (gloss black) and the quarter-glass divider
  b.add(ribbon(surf, S, [[-0.56, 1.02], [-0.6, 1.39]], 0.075, { offset: 0.0035, n: 10, mirror: true }), m.gloss, 'bPillar');
  b.add(ribbon(surf, S, [[-1.4, 1.05], [-1.36, 1.2], [-1.32, 1.37]], 0.03, { offset: 0.0035, n: 10, mirror: true }), m.gloss, 'quarterDivider');
  b.add(ribbon(surf, S, [[-1.8, 1.07], [-1.8, 1.2]], 0.014, { offset: 0.003, n: 6, mirror: true }), m.chrome, 'quarterChrome');

  // ---- shut lines ----
  const gap = 0.005;
  const archPts = (cx: number, r: number, a0: number, a1: number, n: number): V2[] =>
    Array.from({ length: n + 1 }, (_, k) => {
      const a = a0 + ((a1 - a0) * k) / n;
      return [cx + Math.cos(a) * r, WR + Math.sin(a) * r] as V2;
    });
  b.add(ribbon(surf, S, [[0.56, 0.99], [0.6, 0.8], [0.66, 0.6], [0.69, 0.4], [0.7, 0.29]], gap, { n: 18, mirror: true }), m.gap, 'gapDoorF');
  b.add(ribbon(surf, S, [[-0.55, 1.02], [-0.54, 0.6], [-0.53, 0.29]], gap, { n: 16, mirror: true }), m.gap, 'gapDoorB');
  b.add(ribbon(surf, S, [[-1.41, 1.045], [-1.37, 0.86], ...archPts(-ax, 0.43, Math.PI * 0.36, 0, 8)], gap, { n: 24, mirror: true }), m.gap, 'gapDoorR');
  b.add(ribbon(surf, S, [[-0.985, 0.29], [0.7, 0.285]], gap, { n: 24, mirror: true }), m.gap, 'gapSill');
  b.add(ribbon(surf, T, [[0.68, 0], [0.66, 0.4], [0.6, 0.79]], gap, { n: 14, mirror: true }), m.gap, 'gapCowl');
  b.add(gridLine(L, LJ[5], sp.iH0, sp.iH1, gap, 0.0015), m.gap, 'gapHoodSide');
  // trunk lid: across the deck at the backlight base, down beside the lamps, across under the plate
  b.add(ribbon(surf, T, [[-1.985, 0], [-1.99, 0.4], [-2.02, 0.7]], gap, { n: 14, mirror: true }), m.gap, 'gapTrunkTop');
  b.add(ribbon(surf, R, [[0, 0.665], [0.4, 0.668], [0.5, 0.7], [0.52, 0.86], [0.6, 0.98], [0.72, 1.03]], gap, { n: 26, mirror: true }), m.gap, 'gapTrunk');
  // front & rear bumper cover seams
  b.add(ribbon(surf, S, [...archPts(ax, 0.405, Math.PI * 0.32, Math.PI * 0.08, 5), [2.05, 0.83]].map(([x, y]) => [x, y] as V2), gap, { n: 14, mirror: true }), m.gap, 'gapFascia');
  b.add(ribbon(surf, S, [[-1.9, 0.62], [-2.15, 0.64], [-2.4, 0.66]], gap, { n: 12, mirror: true }), m.gap, 'gapRearCover');
  b.add(ribbon(surf, sideP(-1), crLoop([[-1.78, 0.97], [-1.62, 0.97], [-1.6, 0.87], [-1.76, 0.87]], 24), gap, { closed: true }), m.gap, 'gapFuel');

  // ---- wheel wells + rocker trim ----
  for (const a of arches) b.add(mirrorZ(wellGeo(a.x, a.y, a.r + 0.004, 0.12, 0.9, 0.5)), m.liner, 'well');
  b.add(ribbon(surf, S, [[-0.97, 0.37], [0, 0.36], [0.68, 0.355]], 0.022, { n: 24, crown: 0.004, offset: 0.002, mirror: true }), m.chrome, 'rockerChrome');
  b.add(ribbon(surf, S, [[-0.99, 0.255], [0, 0.245], [1.0, 0.245]], 0.05, { n: 24, offset: 0.002, mirror: true }), m.black, 'rockerBlack');

  // ---- front fascia ----
  const Wf = wrapP(L, 0.79, 'front', 1.6, LJ[1], LJ[5]);
  const lamp: V2[] = [[0.42, 0.742], [0.62, 0.735], [0.88, 0.75], [1.1, 0.785], [1.3, 0.83], [1.24, 0.852], [1.0, 0.835], [0.72, 0.818], [0.44, 0.8]];
  const lampO = crLoop(lamp, 40);
  b.add(patch(surf, Wf, lampO, { offset: 0.002, mirror: true }), m.blackChrome, 'headHousing');
  b.add(patch(surf, Wf, crLoop([[0.47, 0.755], [0.66, 0.75], [0.66, 0.79], [0.47, 0.79]], 28), { offset: 0.005, dome: 0.004, ownNormals: true, mirror: true }), m.chrome, 'projectorBowl');
  b.add(patch(surf, Wf, crLoop([[0.72, 0.755], [0.9, 0.765], [0.9, 0.8], [0.72, 0.795]], 28), { offset: 0.005, dome: 0.004, ownNormals: true, mirror: true }), m.chrome, 'reflectorBowl');
  const proj: THREE.BufferGeometry[] = [];
  for (const u of [0.565, 0.81]) {
    const h = castAt(surf, Wf, u, 0.773);
    if (h) proj.push(place(new THREE.SphereGeometry(0.026, 16, 10), [h.p.x + h.n.x * 0.008, h.p.y, h.p.z + h.n.z * 0.008]));
  }
  b.add(mirrorZ(merge(proj)), m.head, 'projector', 'head');
  b.add(ribbon(surf, Wf, [[0.45, 0.803], [0.75, 0.82], [1.02, 0.838], [1.24, 0.85]], 0.01, { n: 24, offset: 0.006, mirror: true }), m.drl, 'drlStrip', 'head');
  b.add(patch(surf, Wf, crLoop([[1.0, 0.8], [1.2, 0.822], [1.18, 0.838], [1.0, 0.826]], 20), { offset: 0.006, mirror: true }), m.amber, 'sideMarker');
  b.add(patch(surf, Wf, lampO, { offset: 0.012, dome: 0.006, ownNormals: true, mirror: true, scale: 0.99 }), m.lens, 'headLens');
  // upper grille + chrome bar into the lamps, emblem
  b.add(patch(surf, F, crLoop([[0, 0.725], [0.3, 0.728], [0.43, 0.74], [0.43, 0.795], [0.3, 0.8], [0, 0.8], [-0.3, 0.8], [-0.43, 0.795], [-0.43, 0.74], [-0.3, 0.728]], 48), { offset: 0.002 }), m.gloss, 'upperGrille');
  b.add(ribbon(surf, F, [[0, 0.762], [0.3, 0.764], [0.46, 0.768]], 0.028, { n: 20, crown: 0.008, offset: 0.004, mirror: true }), m.chrome, 'chromeBar');
  const emb = castAt(surf, F, 0, 0.762);
  if (emb) {
    const disc = rbox(0.03, 0.06, 0.15, 0.4, 16);
    disc.translate(emb.p.x + 0.014, emb.p.y, 0);
    b.add(disc, m.chrome, 'emblem');
    b.add(new THREE.PlaneGeometry(0.13, 0.04).rotateY(Math.PI / 2).translate(emb.p.x + 0.031, emb.p.y, 0), badgeMaterial('M', '#2a2c34'), 'emblemMark');
  }
  // big lower grille with a chrome lip, corner DRL/fog pods
  const lg: V2[] = [[0, 0.355], [0.4, 0.36], [0.55, 0.42], [0.6, 0.6], [0.4, 0.625], [0, 0.63], [-0.4, 0.625], [-0.6, 0.6], [-0.55, 0.42], [-0.4, 0.36]];
  const lgO = crLoop(lg, 52);
  b.add(patch(surf, F, lgO, { offset: 0.0015 }), m.black, 'lowerGrilleBack');
  b.add(patch(surf, F, lgO, { offset: 0.006, scale: 0.96 }), grille({ pattern: 'mesh', repeat: [10, 3] }), 'lowerGrille');
  b.add(ribbon(surf, F, lgO, 0.016, { closed: true, crown: 0.004, offset: 0.004 }), m.trim, 'lowerGrilleSurround');
  b.add(ribbon(surf, F, [[0, 0.372], [0.3, 0.374], [0.5, 0.39]], 0.014, { n: 16, crown: 0.003, offset: 0.007, mirror: true }), m.chrome, 'grilleLip');
  const pod: V2[] = [[0.68, 0.37], [0.8, 0.39], [0.82, 0.56], [0.7, 0.58], [0.66, 0.5]];
  b.add(patch(surf, F, crLoop(pod, 32), { offset: 0.002, mirror: true }), m.gloss, 'fogPod');
  b.add(ribbon(surf, F, [[0.7, 0.4], [0.775, 0.41], [0.79, 0.48], [0.775, 0.55], [0.71, 0.56]], 0.012, { n: 20, offset: 0.005, mirror: true }), m.drl, 'drlC', 'head');
  b.add(patch(surf, F, rrect(0.0, 0.29, 0.9, 0.04, 0.015, 32), { offset: 0.002 }), m.black, 'chinSlot');

  // ---- rear: wrap-round lamps, chrome strip, plate, valance with dual exhaust cut-outs ----
  const Wr = wrapP(L, 0.93, 'rear', 1.4, LJ[1], LJ[7]);
  const tl: V2[] = [[0.36, 0.87], [0.7, 0.85], [0.95, 0.855], [1.17, 0.885], [1.17, 0.95], [0.95, 0.99], [0.6, 1.005], [0.36, 0.99]];
  const tlO = crLoop(tl, 40);
  b.add(patch(surf, Wr, tlO, { offset: 0.002, mirror: true }), m.black, 'tailHousing');
  b.add(ribbon(surf, Wr, [[0.42, 0.97], [0.7, 0.97], [0.95, 0.958], [1.12, 0.935]], 0.018, { n: 24, offset: 0.005, mirror: true }), m.tail, 'tailLed', 'tail');
  b.add(ribbon(surf, Wr, [[0.42, 0.9], [0.7, 0.884], [0.95, 0.888], [1.12, 0.905]], 0.016, { n: 20, offset: 0.005, mirror: true }), m.tail, 'tailLed2', 'tail');
  b.add(patch(surf, Wr, crLoop([[0.46, 0.918], [0.62, 0.914], [0.62, 0.948], [0.46, 0.952]], 20), { offset: 0.005, mirror: true }), m.reverse, 'reverse');
  b.add(patch(surf, Wr, tlO, { offset: 0.009, dome: 0.004, ownNormals: true, mirror: true, scale: 0.99 }), m.lensRed, 'tailLens');
  b.add(ribbon(surf, R, [[0, 0.905], [0.2, 0.905], [0.37, 0.905]], 0.02, { n: 16, crown: 0.005, offset: 0.004, mirror: true }), m.chrome, 'trunkChrome');
  b.add(patch(surf, R, rrect(0, 0.765, 0.36, 0.2, 0.02, 40), { offset: 0.0015 }), m.black, 'plateRecess');
  const pl = castAt(surf, R, 0, 0.765);
  if (pl) b.add(new THREE.PlaneGeometry(0.31, 0.155).rotateY(-Math.PI / 2).translate(pl.p.x - 0.006, pl.p.y, 0), plateMaterial('MLB 516'), 'plate');
  const bd = castAt(surf, R, 0, 0.955);
  if (bd) b.add(rbox(0.02, 0.05, 0.13, 0.4, 14).translate(bd.p.x - 0.01, bd.p.y, 0), m.chrome, 'emblemR');
  const bdn = castAt(surf, R, -0.42, 0.85);
  if (bdn) b.add(new THREE.PlaneGeometry(0.2, 0.04).rotateY(-Math.PI / 2).translate(bdn.p.x - 0.004, bdn.p.y, -0.42), badgeMaterial('MALIBRU'), 'badgeR');
  b.add(patch(surf, R, crLoop([[0, 0.3], [0.5, 0.31], [0.75, 0.36], [0.75, 0.43], [0.5, 0.42], [0, 0.41], [-0.5, 0.42], [-0.75, 0.43], [-0.75, 0.36], [-0.5, 0.31]], 44), { offset: 0.002 }), m.black, 'diffuser');
  const tips: V3[] = [];
  for (const z of [0.6, -0.6]) {
    const h = castAt(surf, R, Math.abs(z), 0.37);
    if (h) tips.push([h.p.x, h.p.y, z]);
  }
  b.add(patch(surf, R, rrect(0.6, 0.37, 0.17, 0.075, 0.03, 32), { offset: 0.004, mirror: true }), m.gap, 'exhaustCutout');
  b.add(ribbon(surf, R, rrect(0.6, 0.37, 0.18, 0.085, 0.034, 40), 0.012, { closed: true, crown: 0.004, offset: 0.005, mirror: true }), m.chrome, 'exhaustSurround');
  b.add(patch(surf, R, rrect(0.82, 0.52, 0.09, 0.03, 0.01, 20), { offset: 0.004, mirror: true }), m.tailDim, 'reflector', 'tail');

  // ---- side: handles on the crease, mirrors, shark fin ----
  for (const x of [0.02, -1.02]) b.add(patch(surf, S, rrect(x, 0.935, 0.2, 0.034, 0.016, 28), { offset: 0.006, dome: 0.005, ownNormals: true, mirror: true }), m.chrome, 'handle');
  doorMirror(b, 0.42, 1.04, 0.86, { w: 0.21, h: 0.13 });
  b.add(mirrorZ(place(rbox(0.12, 0.05, 0.05, 0.5), [0.4, 1.0, 0.86])), m.amber, 'mirrorRepeater');
  const fin = castAt(surf, T, -1.0, 0);
  if (fin) b.add(place(rbox(0.16, 0.06, 0.06, 0.6, 12), [fin.p.x, fin.p.y + 0.025, 0]), m.gloss, 'sharkFin');

  // ---- wipers ----
  const wiper = (z0: number, z1: number, x0: number) => {
    const pts: V3[] = [];
    for (let k = 0; k <= 12; k++) {
      const z = z0 + (z1 - z0) * (k / 12);
      const h = castAt(surf, T, x0 - (k / 12) * 0.12, z);
      if (h) pts.push([h.p.x + h.n.x * 0.014, h.p.y + h.n.y * 0.014, h.p.z + h.n.z * 0.014]);
    }
    return tube(pts, 0.0065, 18, 6);
  };
  b.add(merge([wiper(-0.66, 0.05, 0.6), wiper(-0.02, 0.6, 0.6)]), m.black, 'wipers');

  underbody(b, { x0: -2.25, x1: 2.05, w: 0.66, y: 0.21, tips: tips.map((t) => [t[0], t[1] - 0.01, t[2]] as V3) });
  cabinInterior(b, { xDash: 0.48, yDash: 0.98, wIn: 0.76, floorY: 0.32, xSeat: -0.42, seatZ: 0.39, xRear: -1.42, xWheel: 0.08, yWheel: 0.9, dashDepth: 0.5 });

  const heads: THREE.Vector3[] = [];
  const hh = castAt(surf, Wf, 0.62, 0.775);
  if (hh) heads.push(hh.p.clone(), new THREE.Vector3(hh.p.x, hh.p.y, -hh.p.z));
  const tails: THREE.Vector3[] = [];
  const th = castAt(surf, Wr, 0.75, 0.94);
  if (th) tails.push(th.p.clone(), new THREE.Vector3(th.p.x, th.p.y, -th.p.z));
  const at = (u: number, v: number, fb: THREE.Vector3) => castAt(surf, T, u, v)?.p ?? fb;
  return finish(
    b,
    { length: XF - XR, width: 1.85, height: 1.45, wheelbase: WB, trackF: TF, trackR: TR, wheelR: WR, rideHeight: 0.14 },
    {
      wheelFL: v3(ax, WR, TF / 2), wheelFR: v3(ax, WR, -TF / 2), wheelRL: v3(-ax, WR, TR / 2), wheelRR: v3(-ax, WR, -TR / 2),
      exhausts: tips.length ? tips.map((t) => ({ pos: v3(t[0] - 0.01, t[1], t[2]), dir: v3(-1, 0, 0) })) : [{ pos: v3(XR, 0.37, 0.6), dir: v3(-1, 0, 0) }, { pos: v3(XR, 0.37, -0.6), dir: v3(-1, 0, 0) }],
      hood: at(1.4, 0, v3(1.4, 0.96, 0)),
      roof: at(-0.6, 0, v3(-0.6, 1.45, 0)),
      deck: at(-2.28, 0, v3(-2.28, 1.06, 0)),
      frontBumper: v3(XF + 0.02, 0.25, 0),
      seat: v3(-0.62, 1.16, -0.39),
      headlights: heads.length ? heads : [v3(XF - 0.1, 0.77, 0.62), v3(XF - 0.1, 0.77, -0.62)],
      taillights: tails.length ? tails : [v3(XR + 0.1, 0.94, 0.7), v3(XR + 0.1, 0.94, -0.7)],
    },
    { belt: 1.01, sill: 0.3, door: [-1.4, 0.58], cowl: 0.66 },
  );
}
