// 'hatch': the Civique, an aggressive five-door hot hatch (Civic Type R FK8 vibe): low raked nose with a black wing bar
// between razor lamps, huge honeycomb mouth with corner fangs, hood intake, fender vents behind the front wheels, flared
// arches, black skirts with a red lip, fastback glass into a ducktail, boomerang tail lamps, finned diffuser with three
// centre tips, vortex generators on the roof edge. Wings come from the kit (deck anchor on the lower hatch).
// Contract: ../../types.ts BodyBuild. Car faces +X, +Z = the car's right, driver (LHD) on -Z. Units: metres.
import * as THREE from 'three';
import { badgeMaterial, grille, plateMaterial } from '../../materials';
import type { BodyBuild, CarSpec } from '../../types';
import {
  Body, Surf, cabinInterior, castAt, crLoop, curve, doorMirror, finish, frontP, greenhouse, gridLine, lowerShell, mats, merge, mirrorZ,
  patch, place, rbox, rearP, ribbon, rowRange, rrect, shellMeshes, sideP, sweep, topP, tube, underbody, v3, wellGeo, wrapP, type V2, type V3,
} from './_helpersA';

const WB = 2.7;
const WR = 0.33;
const TF = 1.6;
const TR = 1.59;
const XF = 2.28;
const XR = -2.16;

export default function build(spec: CarSpec): BodyBuild {
  const m = mats(spec);
  const b = new Body(m);
  const ax = WB / 2;
  const arches = [{ x: ax, y: WR, r: 0.39 }, { x: -ax, y: WR, r: 0.39 }];
  const red = accentRed();

  const yBelt = curve([[XR, 0.995], [-1.98, 1.03], [-1.8, 1.045], [-1.4, 1.052], [-0.5, 1.02], [0.68, 0.975], [1.4, 0.9], [2.0, 0.8], [XF, 0.73]]);
  const lower = lowerShell({
    xR: XR, xF: XF, step: 0.044,
    capF: { len: 0.46, p: 2.5, rake: (y) => (y > 0.42 ? -(y - 0.42) * 0.42 : -(0.42 - y) * 0.12) },
    capR: { len: 0.26, p: 3.4, rake: (y) => (y > 0.75 ? (y - 0.75) * 0.1 : (0.75 - y) * 0.12) },
    yBot: curve([[XR, 0.29], [-1.95, 0.2], [-1.8, 0.17], [1.8, 0.16], [2.1, 0.14], [XF, 0.17]]),
    // flared arches: the body swells over both axles
    w: curve([[-1.9, 0.918], [-1.35, 0.942], [-0.7, 0.922], [0.3, 0.92], [1.35, 0.94], [1.9, 0.912]]),
    yMax: curve([[-1.9, 0.72], [-1.3, 0.7], [0, 0.66], [1.3, 0.63], [2.0, 0.6]]),
    tuck: () => 0.05,
    yBelt,
    roll: () => 0.07,
    yTop: curve([[XR, 0.998], [-2.0, 1.035], [-1.88, 1.042], [0.75, 0.985], [1.4, 0.925], [2.0, 0.815], [XF, 0.735]]),
    shoulder: () => [0.085, 0.028],
    cabin: [-1.88, 0.6],
    floorY: 0.3,
    arches,
  });
  const L = lower.grid;
  const LJ = lower.keyJ;

  const cowl = curve([[0.68, 0.835], [0.72, 0.73], [0.75, 0.62], [0.78, 0.47], [0.8, 0.34], [0.81, 0.24], [0.818, 0.12], [0.82, 0]]);
  const edgeW = curve([[-1.9, 0.7], [-1.7, 0.668], [-1.4, 0.645], [-1.2, 0.638], [-0.6, 0.642], [-0.2, 0.636], [0.2, 0.72], [0.68, 0.835]]);
  const gh = greenhouse({
    xr: -1.92, xf: 0.82, step: 0.04, rail: 0.03, crown: 0.6,
    yBase: (x) => yBelt(x) - 0.004,
    wBase: curve([[-1.92, 0.68], [-1.8, 0.78], [-1.5, 0.83], [0.3, 0.845], [0.68, 0.835]]),
    yEdge: curve([[-1.97, 0.95], [-1.9, 1.05], [-1.8, 1.12], [-1.68, 1.2], [-1.54, 1.29], [-1.4, 1.345], [-1.2, 1.372], [-0.8, 1.39], [-0.2, 1.385], [0.2, 1.205], [0.68, 0.975], [0.82, 0.9]]),
    wEdge: (x) => (x > 0.68 ? cowl(x) : edgeW(x)),
    yTop: curve([[-1.92, 1.04], [-1.86, 1.095], [-1.72, 1.19], [-1.58, 1.28], [-1.45, 1.352], [-1.3, 1.392], [-1.0, 1.42], [-0.55, 1.432], [-0.15, 1.42], [0.3, 1.205], [0.82, 0.985]]),
  });
  const G = gh.grid;
  const GJ = gh.keyJ;
  const surf = new Surf([L, G]);
  const S = sideP(1);
  const T = topP();
  const F = frontP([1.8, 2.45]);
  const R = rearP([-2.35, -1.75]);
  const sp = shellMeshes(b, lower, gh, { cabin: [-1.88, 0.6], hood: [0.76, XF - 0.46], ws: -0.12, back: -1.44, quarter: -1.66, darkFrom: -0.44, pillarMat: m.gloss });
  const iA = rowRange(gh.rowX, -99, 0.68)[1];
  b.add(gridLine(G, GJ[1], rowRange(gh.rowX, -1.9, 99)[0], iA, 0.014, 0.002), m.rubber, 'dloSeal');
  b.add(gridLine(G, 0, rowRange(gh.rowX, -1.88, 99)[0], iA, 0.018, 0.003), m.gloss, 'beltTrim');
  b.add(ribbon(surf, S, [[-0.42, 1.03], [-0.47, 1.38]], 0.075, { offset: 0.0035, n: 10, mirror: true }), m.gloss, 'bPillar');
  b.add(ribbon(surf, S, [[-1.42, 1.055], [-1.38, 1.2], [-1.32, 1.355]], 0.03, { offset: 0.0035, n: 10, mirror: true }), m.gloss, 'quarterDivider');

  // ---- shut lines ----
  const gap = 0.005;
  const archPts = (cx: number, r: number, a0: number, a1: number, n: number): V2[] =>
    Array.from({ length: n + 1 }, (_, k) => {
      const a = a0 + ((a1 - a0) * k) / n;
      return [cx + Math.cos(a) * r, WR + Math.sin(a) * r] as V2;
    });
  b.add(ribbon(surf, S, [[0.68, 0.98], [0.71, 0.8], [0.76, 0.6], [0.79, 0.4], [0.8, 0.26]], gap, { n: 18, mirror: true }), m.gap, 'gapDoorF');
  b.add(ribbon(surf, S, [[-0.41, 1.03], [-0.4, 0.6], [-0.39, 0.27]], gap, { n: 16, mirror: true }), m.gap, 'gapDoorB');
  b.add(ribbon(surf, S, [[-1.41, 1.058], [-1.36, 0.86], ...archPts(-ax, 0.425, Math.PI * 0.36, 0, 8)], gap, { n: 24, mirror: true }), m.gap, 'gapDoorR');
  b.add(ribbon(surf, S, [[-0.925, 0.27], [0.8, 0.262]], gap, { n: 24, mirror: true }), m.gap, 'gapSill');
  b.add(ribbon(surf, T, [[0.8, 0], [0.78, 0.4], [0.72, 0.8]], gap, { n: 14, mirror: true }), m.gap, 'gapCowl');
  b.add(gridLine(L, LJ[5], sp.iH0, sp.iH1, gap, 0.0015), m.gap, 'gapHoodSide');
  b.add(ribbon(surf, R, [[0, 0.62], [0.42, 0.625], [0.5, 0.7], [0.52, 0.86], [0.6, 0.97], [0.66, 1.05]], gap, { n: 26, mirror: true }), m.gap, 'gapHatch');
  b.add(ribbon(surf, S, [...archPts(ax, 0.4, Math.PI * 0.3, Math.PI * 0.08, 5), [1.95, 0.8]], gap, { n: 14, mirror: true }), m.gap, 'gapFascia');
  b.add(ribbon(surf, sideP(-1), crLoop([[-1.64, 0.96], [-1.5, 0.96], [-1.49, 0.87], [-1.63, 0.87]], 24), gap, { closed: true }), m.gap, 'gapFuel');

  // ---- wells, flared lips, skirts with a red lip, fender vents ----
  for (const a of arches) b.add(mirrorZ(wellGeo(a.x, a.y, a.r + 0.004, 0.1, 0.93, 0.5)), m.liner, 'well');
  for (const a of arches) {
    const pts: V3[] = [];
    for (let k = 0; k <= 20; k++) {
      const t = Math.PI * (0.03 + 0.94 * (k / 20));
      const x = a.x + Math.cos(t) * (a.r + 0.004);
      const y = a.y + Math.sin(t) * (a.r + 0.004);
      const h = castAt(surf, S, x, y + 0.014);
      pts.push([x, y, (h?.p.z ?? 0.93) - 0.002]);
    }
    b.add(mirrorZ(tube(pts, 0.012, 24, 5)), m.paint, 'archFlare', 'paint');
  }
  b.add(ribbon(surf, S, [[-0.94, 0.235], [0, 0.225], [0.94, 0.225]], 0.085, { n: 26, crown: 0.012, offset: 0.002, mirror: true }), m.gloss, 'skirt');
  b.add(ribbon(surf, S, [[-0.94, 0.19], [0, 0.18], [0.94, 0.18]], 0.012, { n: 20, offset: 0.012, mirror: true }), red, 'skirtLip');
  const vent: V2[] = [[0.84, 0.58], [0.93, 0.6], [0.99, 0.82], [0.9, 0.8]];
  b.add(patch(surf, S, crLoop(vent, 24), { offset: 0.0015, mirror: true }), m.gap, 'fenderVent');
  for (let k = 0; k < 3; k++) {
    const y0 = 0.63 + k * 0.055;
    b.add(ribbon(surf, S, [[0.855 + k * 0.012, y0], [0.95 + k * 0.012, y0 + 0.018]], 0.012, { n: 6, crown: 0.004, offset: 0.004, mirror: true }), m.gloss, 'fenderVentSlat');
  }

  // ---- front: razor lamps, black wing bar, honeycomb mouth with fangs, splitter with red lip, hood intake ----
  const Wf = wrapP(L, 0.7, 'front', 1.6, LJ[1], LJ[5]);
  const lamp: V2[] = [[0.36, 0.635], [0.5, 0.66], [0.72, 0.695], [0.96, 0.725], [1.16, 0.765], [1.1, 0.79], [0.86, 0.772], [0.58, 0.742], [0.4, 0.705]];
  const lampO = crLoop(lamp, 40);
  b.add(patch(surf, Wf, lampO, { offset: 0.002, mirror: true }), m.blackChrome, 'headHousing');
  const proj: THREE.BufferGeometry[] = [];
  for (const [u, v] of [[0.62, 0.712], [0.78, 0.728], [0.94, 0.744]] as V2[]) {
    const h = castAt(surf, Wf, u, v);
    if (h) proj.push(place(new THREE.SphereGeometry(0.021, 12, 8), [h.p.x + h.n.x * 0.008, h.p.y, h.p.z + h.n.z * 0.008]));
  }
  b.add(mirrorZ(merge(proj)), m.head, 'projector', 'head');
  b.add(ribbon(surf, Wf, [[0.4, 0.69], [0.56, 0.728], [0.84, 0.76], [1.08, 0.782]], 0.011, { n: 24, offset: 0.006, mirror: true }), m.drl, 'drlStrip', 'head');
  b.add(patch(surf, Wf, lampO, { offset: 0.011, dome: 0.005, ownNormals: true, mirror: true, scale: 0.99 }), m.lens, 'headLens');
  b.add(patch(surf, F, crLoop([[0, 0.655], [0.25, 0.655], [0.38, 0.64], [0.38, 0.69], [0.25, 0.705], [0, 0.71], [-0.25, 0.705], [-0.38, 0.69], [-0.38, 0.64], [-0.25, 0.655]], 40), { offset: 0.004, dome: 0.004, ownNormals: true }), m.gloss, 'wingBar');
  const emb = castAt(surf, F, 0, 0.682);
  if (emb) b.add(new THREE.PlaneGeometry(0.09, 0.07).rotateY(Math.PI / 2).translate(emb.p.x + 0.012, emb.p.y, 0), badgeMaterial('R', '#e0182a'), 'emblem');
  const ug: V2[] = [[0, 0.585], [0.3, 0.59], [0.36, 0.63], [0, 0.645], [-0.36, 0.63], [-0.3, 0.59]];
  b.add(patch(surf, F, crLoop(ug, 32), { offset: 0.0015 }), m.gap, 'upperGrilleBack');
  b.add(patch(surf, F, crLoop(ug, 32), { offset: 0.004, scale: 0.96 }), grille({ pattern: 'honeycomb', repeat: [9, 1.5] }), 'upperGrille');
  const mouth: V2[] = [[0, 0.22], [0.45, 0.225], [0.6, 0.3], [0.56, 0.5], [0.3, 0.53], [0, 0.535], [-0.3, 0.53], [-0.56, 0.5], [-0.6, 0.3], [-0.45, 0.225]];
  const mouthO = crLoop(mouth, 52);
  b.add(patch(surf, F, mouthO, { offset: 0.0015 }), m.gap, 'mouthBack');
  b.add(patch(surf, F, mouthO, { offset: 0.006, scale: 0.97 }), grille({ pattern: 'honeycomb', repeat: [14, 4] }), 'mouthGrille');
  b.add(ribbon(surf, F, mouthO, 0.018, { closed: true, crown: 0.005, offset: 0.004 }), m.gloss, 'mouthSurround');
  const fang: V2[] = [[0.66, 0.25], [0.84, 0.3], [0.86, 0.52], [0.7, 0.56], [0.64, 0.4]];
  b.add(patch(surf, F, crLoop(fang, 32), { offset: 0.0015, mirror: true }), m.gap, 'fangBack');
  b.add(patch(surf, F, crLoop(fang, 32), { offset: 0.005, scale: 0.92, mirror: true }), grille({ pattern: 'honeycomb', repeat: [3, 3] }), 'fangGrille');
  b.add(ribbon(surf, F, crLoop(fang, 32), 0.016, { closed: true, crown: 0.004, offset: 0.004, mirror: true }), m.gloss, 'fangSurround');
  b.add(ribbon(surf, F, [[0, 0.17], [0.5, 0.172], [0.8, 0.19]], 0.03, { n: 20, crown: 0.01, offset: 0.012, mirror: true }), m.gloss, 'splitter');
  b.add(ribbon(surf, F, [[0, 0.155], [0.5, 0.157], [0.8, 0.175]], 0.008, { n: 20, offset: 0.024, mirror: true }), red, 'splitterLip');
  const hs: V2[] = [[1.56, 0], [1.6, 0.2], [1.82, 0.24], [1.86, 0], [1.82, -0.24], [1.6, -0.2]];
  b.add(patch(surf, T, crLoop(hs, 36), { offset: 0.0015 }), m.gap, 'hoodScoopBack');
  b.add(patch(surf, T, crLoop(hs, 36), { offset: 0.004, scale: 0.9 }), grille({ pattern: 'mesh', repeat: [5, 2] }), 'hoodScoopMesh');
  b.add(ribbon(surf, T, crLoop(hs, 36), 0.024, { closed: true, crown: 0.012, offset: 0.002 }), m.paint, 'hoodScoopLip', 'paint');

  // ---- rear: boomerang lamps, ducktail, plate, finned diffuser, three centre tips, corner vents ----
  const Wr = wrapP(L, 0.92, 'rear', 1.5, LJ[1], LJ[7]);
  const tl: V2[] = [[0.34, 1.0], [0.58, 0.998], [0.73, 0.986], [0.8, 0.93], [0.79, 0.785], [0.72, 0.76], [0.68, 0.89], [0.6, 0.94], [0.34, 0.952]];
  const tlO = crLoop(tl, 40);
  b.add(patch(surf, Wr, tlO, { offset: 0.002, mirror: true }), m.black, 'tailHousing');
  b.add(ribbon(surf, Wr, [[0.38, 0.976], [0.6, 0.973], [0.72, 0.957], [0.755, 0.87], [0.75, 0.8]], 0.018, { n: 24, offset: 0.005, mirror: true }), m.tail, 'tailLed', 'tail');
  b.add(patch(surf, Wr, crLoop([[0.4, 0.955], [0.55, 0.953], [0.55, 0.972], [0.4, 0.975]], 16), { offset: 0.004, mirror: true }), m.reverse, 'reverse');
  b.add(patch(surf, Wr, tlO, { offset: 0.009, dome: 0.004, ownNormals: true, mirror: true, scale: 0.99 }), m.lensRed, 'tailLens');
  b.add(patch(surf, R, rrect(0, 0.74, 0.56, 0.15, 0.02, 36), { offset: 0.0015 }), m.black, 'plateRecess');
  const pl = castAt(surf, R, 0, 0.74);
  if (pl) b.add(new THREE.PlaneGeometry(0.52, 0.11).rotateY(-Math.PI / 2).translate(pl.p.x - 0.006, pl.p.y, 0), plateMaterial('CVQ R'), 'plate');
  const bdn = castAt(surf, R, 0.42, 0.86);
  if (bdn) b.add(new THREE.PlaneGeometry(0.22, 0.04).rotateY(-Math.PI / 2).translate(bdn.p.x - 0.004, bdn.p.y, 0.42), badgeMaterial('CIVIQUE'), 'badgeR');
  const diff: V2[] = [[0, 0.17], [0.6, 0.18], [0.82, 0.24], [0.8, 0.4], [0.5, 0.42], [0, 0.425], [-0.5, 0.42], [-0.8, 0.4], [-0.82, 0.24], [-0.6, 0.18]];
  b.add(patch(surf, R, crLoop(diff, 44), { offset: 0.002 }), m.gloss, 'diffuser');
  for (const z of [0.3, 0.45, 0.6]) b.add(ribbon(surf, R, [[z, 0.19], [z, 0.36]], 0.012, { n: 6, crown: 0.03, offset: 0.004, mirror: true }), m.black, 'diffuserFin');
  b.add(patch(surf, R, rrect(0, 0.29, 0.42, 0.14, 0.05, 36), { offset: 0.004 }), m.gap, 'exhaustCutout');
  const rv: V2[] = [[0.78, 0.44], [0.86, 0.46], [0.87, 0.66], [0.8, 0.64]];
  b.add(patch(surf, R, crLoop(rv, 20), { offset: 0.002, mirror: true }), m.gap, 'rearVent');
  b.add(patch(surf, R, rrect(0.825, 0.5, 0.022, 0.09, 0.008, 16), { offset: 0.004, mirror: true }), m.tailDim, 'reflector', 'tail');
  const tips: V3[] = [];
  for (const [z, y] of [[-0.1, 0.285], [0, 0.31], [0.1, 0.285]] as V2[]) {
    const h = castAt(surf, R, z, y);
    tips.push([(h?.p.x ?? XR) + 0.02, y, z]);
  }

  // hatch frame: black seals down both sides of the hatch glass and across its top edge
  b.add(gridLine(G, GJ[3], 0, sp.iBk, 0.04, 0.0015), m.gloss, 'hatchFrameSides');
  const xTopEdge = gh.rowX[sp.iBk];
  b.add(ribbon(surf, T, [[xTopEdge, 0], [xTopEdge + 0.004, 0.35], [xTopEdge + 0.012, 0.6]], 0.035, { n: 16, offset: 0.0015, mirror: true }), m.gloss, 'hatchFrameTop');
  // spoiler bar across the base of the hatch glass, with a small lower window beneath it (split rear glass)
  const spPath: V2[] = [];
  for (let k = 0; k <= 14; k++) {
    const z = (k / 14) * 0.74;
    const h = castAt(surf, T, -1.95, z);
    spPath.push([(h?.p.x ?? -1.95) - 0.01, z]);
  }
  const spoiler = sweep(spPath, (k, n) => {
    const t = Math.max(0.35, 1 - (k / (n - 1)) ** 4);
    return [[-0.03, 1.025], [0.03, 1.02], [0.075 * t, 1.032], [0.085 * t, 1.048], [0.035, 1.066], [-0.03, 1.07]];
  });
  b.add(spoiler.geometry(), m.paint, 'hatchSpoiler', 'paint');
  b.add(patch(surf, R, rrect(0, 0.95, 0.6, 0.075, 0.02, 32), { offset: 0.002 }), m.gloss, 'lowerGlassFrame');
  b.add(patch(surf, R, rrect(0, 0.95, 0.56, 0.06, 0.016, 32), { offset: 0.004 }), m.glassDark, 'lowerGlass');

  // ---- roof vortex generators, side details ----
  const vg: THREE.BufferGeometry[] = [];
  for (let k = -4; k <= 4; k++) {
    const z = k * 0.075;
    const h = castAt(surf, T, -1.36, z);
    if (h) vg.push(place(rbox(0.07, 0.03, 0.006, 0.6, 6), [h.p.x, h.p.y + 0.012, z], [0, 0, -0.25]));
  }
  b.add(merge(vg), m.gloss, 'vortexGens');
  for (const x of [0.12, -0.92]) b.add(patch(surf, S, rrect(x, 0.93, 0.2, 0.034, 0.016, 24), { offset: 0.006, dome: 0.005, ownNormals: true, mirror: true }), m.paint, 'handle', 'paint');
  doorMirror(b, 0.55, 1.04, 0.85, { w: 0.2, h: 0.12, paint: false });
  const fin = castAt(surf, T, -1.0, 0);
  if (fin) b.add(place(rbox(0.15, 0.055, 0.055, 0.6, 10), [fin.p.x, fin.p.y + 0.024, 0]), m.gloss, 'sharkFin');

  // ---- wipers, rear wiper ----
  const wiper = (z0: number, z1: number, x0: number) => {
    const pts: V3[] = [];
    for (let k = 0; k <= 12; k++) {
      const h = castAt(surf, T, x0 - (k / 12) * 0.12, z0 + (z1 - z0) * (k / 12));
      if (h) pts.push([h.p.x + h.n.x * 0.014, h.p.y + h.n.y * 0.014, h.p.z + h.n.z * 0.014]);
    }
    return tube(pts, 0.0065, 18, 6);
  };
  b.add(merge([wiper(-0.64, 0.05, 0.72), wiper(-0.02, 0.6, 0.72)]), m.black, 'wipers');
  const rw: V3[] = [];
  for (let k = 0; k <= 8; k++) {
    const h = castAt(surf, T, -1.84 + k * 0.03, -0.02 + k * 0.045);
    if (h) rw.push([h.p.x, h.p.y + 0.014, h.p.z]);
  }
  if (rw.length > 2) b.add(tube(rw, 0.006, 12, 6), m.black, 'rearWiper');

  underbody(b, { x0: -1.9, x1: 1.95, w: 0.66, y: 0.17, tips: [[tips[1][0], 0.3, 0]] });
  cabinInterior(b, { xDash: 0.6, yDash: 0.97, wIn: 0.76, floorY: 0.3, xSeat: -0.3, seatZ: 0.39, xRear: -1.3, xWheel: 0.2, yWheel: 0.88, dashDepth: 0.5 });
  b.group.traverse((o) => {
    const me = o as THREE.Mesh;
    if (me.isMesh && (me.name === 'seats' || me.name === 'rearSeat')) me.material = redSeat();
  });

  const heads: THREE.Vector3[] = [];
  const hh = castAt(surf, Wf, 0.78, 0.728);
  if (hh) heads.push(hh.p.clone(), new THREE.Vector3(hh.p.x, hh.p.y, -hh.p.z));
  const tails: THREE.Vector3[] = [];
  const th = castAt(surf, Wr, 0.74, 0.9);
  if (th) tails.push(th.p.clone(), new THREE.Vector3(th.p.x, th.p.y, -th.p.z));
  const at = (u: number, v: number, fb: THREE.Vector3) => castAt(surf, T, u, v)?.p ?? fb;
  return finish(
    b,
    { length: Math.round((XF - XR) * 100) / 100, width: 1.88, height: 1.43, wheelbase: WB, trackF: TF, trackR: TR, wheelR: WR, rideHeight: 0.12 },
    {
      wheelFL: v3(ax, WR, TF / 2), wheelFR: v3(ax, WR, -TF / 2), wheelRL: v3(-ax, WR, TR / 2), wheelRR: v3(-ax, WR, -TR / 2),
      exhausts: tips.map((t) => ({ pos: v3(t[0], t[1], t[2]), dir: v3(-1, 0, 0) })),
      hood: at(1.3, 0, v3(1.3, 0.94, 0)),
      roof: at(-0.55, 0, v3(-0.55, 1.43, 0)),
      deck: at(-1.98, 0, v3(-1.98, 1.04, 0)),
      frontBumper: v3(XF + 0.02, 0.17, 0),
      seat: v3(-0.52, 1.12, -0.39),
      headlights: heads.length ? heads : [v3(XF - 0.15, 0.72, 0.65), v3(XF - 0.15, 0.72, -0.65)],
      taillights: tails.length ? tails : [v3(XR + 0.1, 0.9, 0.75), v3(XR + 0.1, 0.9, -0.75)],
    },
    { belt: 1.02, sill: 0.27, door: [-1.4, 0.7], cowl: 0.78 },
  );
}

let redMat: THREE.Material | null = null;
function accentRed(): THREE.Material {
  if (!redMat) {
    redMat = new THREE.MeshPhysicalMaterial({ color: 0xd0101c, roughness: 0.3, clearcoat: 1 });
    redMat.userData.shared = true;
  }
  return redMat;
}
let seatMat: THREE.Material | null = null;
function redSeat(): THREE.Material {
  if (!seatMat) {
    seatMat = new THREE.MeshPhysicalMaterial({ color: 0x8a0d16, roughness: 0.85, sheen: 0.6, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xff4050) });
    seatMat.userData.shared = true;
  }
  return seatMat;
}
