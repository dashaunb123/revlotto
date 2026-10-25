// 'hyper' body: the "Lamberghoul", a hand-built Aventador-style V12 hypercar. Ultra low and wide, one blade line from the
// pointed nose up the windshield, a narrow cab-forward canopy on a broad shouldered body, hexagon/Y design language: angular
// arches, Y-shaped lamp signatures, huge side intakes in the door and on the shoulders, scissor-door shut lines, a louvred
// engine cover, a black rear mesh, a central hexagonal exhaust and a big diffuser. Crisp creases (split normals) at the
// waist and the shoulder. Car faces +X, origin at ground level mid-wheelbase, right side = +Z (LHD: driver on -Z).
import * as THREE from 'three';
import type { BodyBuild, CarSpec } from '../../types';
import {
  Assembler, Loft, archParts, arcSamplesMulti, crv, endRound, floorGeo, frame, gridGeo, lerp, merge, mirrorGeos, onSurface, openPath, patchGeo, place, pocketGeo, rbox, ribbon, roundOpen, roundPoly, runs, seatGeo, slab, span, steeringGeo, tubeGeo, vec, withMirror, type V2,
} from './_helpersC';

const XN = 2.44;
const XT = -2.34;
const WB = 2.7;
const XF = WB / 2;
const XR = -WB / 2;
const WR = 0.345;
const TRACK_F = 1.72;
const TRACK_R = 1.7;

// sill, rocker, lower side, WAIST crease, upper side, SHOULDER crease, glass base, rail, roof mid, centre
const VK = [0, 0.07, 0.17, 0.27, 0.37, 0.46, 0.56, 0.68, 0.84, 1];
const CREASE = [false, false, false, true, false, true, false, false, false, false];
const V_SH = VK[5];
const V_GB = VK[6];
const V_RAIL = VK[7];

// ---- Character curves ----
const yb = crv([[XT, 0.37], [-2.2, 0.3], [-2.0, 0.18], [-1.8, 0.115], [1.8, 0.105], [2.2, 0.118], [2.36, 0.13], [XN, 0.155]]);
const yS = crv([[XT, 0.9], [-2.0, 0.925], [-1.4, 0.89], [-0.6, 0.81], [0.4, 0.735], [1.35, 0.64], [2.0, 0.5], [XN, 0.36]]);
const yW = (x: number) => lerp(yb(x), yS(x), 0.45);
const side = crv([[XT, 0.98], [-1.9, 1.01], [-1.35, 1.015], [-0.7, 0.985], [0.2, 0.97], [1.3, 0.995], [1.9, 0.96], [XN, 0.86]]);
const zS = crv([[XT, 0.92], [-1.8, 0.975], [-1.3, 0.985], [-0.7, 0.93], [0.2, 0.92], [1.3, 0.95], [1.9, 0.9], [XN, 0.78]]);
// glass base (in the cabin) and the front lid / roof / engine cover centreline
const yLid = crv([[0.85, 0.79], [1.6, 0.66], [2.2, 0.5], [XN, 0.37]]);
const yRoof = crv([[-1.0, 1.07], [-0.75, 1.118], [-0.42, 1.136], [-0.2, 1.128], [0.05, 1.1]]);
const yDeck = crv([[XT, 0.905], [-2.2, 0.965], [-1.9, 0.99], [-1.5, 1.015], [-1.2, 1.04]]);
const pEnd = (x: number) => endRound(x, XN, 0.26, 1.9) * endRound(x, XT, 0.07, 3);

const ZT = [0.78, 0.6, 0.3, 0]; // knots 6..9 on the lid / deck
const ZC = [0.79, 0.55, 0.3, 0]; // cabin: glass base, rail, roof mid, centre
const COWL = [0.95, 0.88, 0.86, 0.85];
const HDR = [0.6, -0.3, -0.26, -0.25];
const ROOF_END = [-1.05, -0.8, -0.77, -0.76];
const DECK = [-1.25, -1.2, -1.12, -1.1];
const CAB_Y = (j: number, x: number) => (j === 0 ? lerp(0.83, 0.9, sstep01((0.6 - x) / 1.6)) : yRoof(x) + [0, -0.04, -0.008, 0][j]);

function sstep01(t: number) {
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
}
function lidK(j: number, x: number): [number, number] {
  const f = ZT[j] / zS(x);
  // shallow V: the lid's centre panel sits slightly proud between two ridge lines
  return [yLid(x) + 0.014 * (1 - f * f) - (yLid(x) - yS(x)) * Math.pow(f, 5), ZT[j]];
}
function deckK(j: number, x: number): [number, number] {
  const f = ZT[j] / zS(x);
  return [yDeck(x) + 0.01 * (1 - f * f) - (yDeck(x) - yS(x)) * Math.pow(f, 3.5), ZT[j]];
}
function cabinK(j: number, x: number): [number, number] {
  return [CAB_Y(j, x), ZC[j]];
}
function topK(j: number, x: number): [number, number] {
  if (x >= COWL[j]) return lidK(j, x);
  if (x >= HDR[j]) {
    const t = (COWL[j] - x) / (COWL[j] - HDR[j]);
    const a = lidK(j, COWL[j]);
    const b = cabinK(j, HDR[j]);
    return [lerp(a[0], b[0], t) + 0.006 * Math.sin(Math.PI * t), lerp(a[1], b[1], t)];
  }
  if (x >= ROOF_END[j]) return cabinK(j, x);
  if (x >= DECK[j]) {
    const t = (ROOF_END[j] - x) / (ROOF_END[j] - DECK[j]);
    const a = cabinK(j, ROOF_END[j]);
    const b = deckK(j, DECK[j]);
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
  }
  return deckK(j, x);
}

function ring(x: number): number[] {
  const p = pEnd(x);
  const b = yb(x);
  const s = side(x);
  const ySh = yS(x);
  const zSh = zS(x);
  const yw = yW(x);
  const k: number[] = [
    b, (s - 0.07) * p,
    b + 0.05, (s - 0.03) * p,
    lerp(b, yw, 0.55), (s - 0.012) * p,
    yw, s * p,
    lerp(yw, ySh, 0.5), lerp(s, zSh, 0.4) * p,
    ySh, zSh * p,
  ];
  for (let j = 0; j < 4; j++) {
    const [y, z] = topK(j, x);
    k.push(Math.max(y, ySh + 0.0006 * (j + 1)), z * p);
  }
  return k;
}

export default function build(spec: CarSpec): BodyBuild {
  const S = new Loft(ring, VK, XT, XN, CREASE, 1.7);
  const A = new Assembler(spec, { plate: 'GHOUL', badge: 'LAMBERGHOUL' });

  // ---------------- Outlines ----------------
  // angular (hexagon-cut) arches
  const archLine = (xc: number, k: number): V2[] =>
    roundOpen([[xc + 0.47 * k, 0.08], [xc + 0.42 * k, 0.48], [xc + 0.22 * k, 0.68], [xc - 0.24 * k, 0.68], [xc - 0.42 * k, 0.5], [xc - 0.46 * k, 0.08]], 0.035, 3).reverse();
  const archF = archParts(S, archLine(XF, 1), { zIn: 0.56, hub: [XF, WR], vMax: VK[5], yFloor: 0.1 });
  const archR = archParts(S, archLine(XR, 1.05), { zIn: 0.54, hub: [XR, WR], vMax: VK[5], yFloor: 0.1 });

  const wsh: V2[] = [[0.84, V_RAIL + 0.03], [0.85, 1.03], [-0.22, 1.03], [-0.27, V_RAIL + 0.03]];
  const dlo: V2[] = [[0.62, V_GB + 0.012], [0.3, V_RAIL - 0.016], [-0.62, V_RAIL - 0.016], [-0.78, V_RAIL - 0.04], [-0.86, V_GB + 0.012]];
  const backW: V2[] = [[-0.8, 0.86], [-0.8, 1.03], [-0.9, 1.03], [-0.9, 0.86]];
  // engine cover: a hexagonal glass centre panel with louvres either side
  const coverGlass: V2[] = S.top([[-1.25, 0.0005], [-1.25, 0.2], [-1.45, 0.3], [-1.95, 0.3], [-2.1, 0.18], [-2.1, 0.0005]], VK[6], 1).map(([u, v]) => [u, v > 0.995 ? 1.03 : v] as V2);
  const louvL: V2[] = S.top(roundPoly([[-1.3, 0.38], [-1.45, 0.62], [-2.05, 0.62], [-2.05, 0.38]], 0.02, 2), VK[5], 1);
  // big lower side intake carved through the door into the rear fender, and the shoulder intake behind the glass
  const sideIn: V2[] = S.side(roundPoly([[0.1, 0.5], [-0.55, 0.36], [-0.86, 0.36], [-0.86, 0.66], [-0.5, 0.66]], [0.04, 0.03, 0.03, 0.03, 0.04], 3), 0.02, VK[5] - 0.004);
  const shoulderIn: V2[] = roundPoly([[-0.9, V_SH + 0.01], [-0.95, V_GB + 0.045], [-1.32, V_GB + 0.06], [-1.4, V_SH + 0.01]], 0.01, 2);
  // front: corner intakes (angular), headlamps on the lid corners; rear: mesh, lamp bands, exhaust, plate
  const fIntake = S.face([[0.4, 0.17], [0.84, 0.17], [0.86, 0.3], [0.72, 0.4], [0.48, 0.36], [0.38, 0.25]]);
  const headL: V2[] = S.top([[2.27, 0.56], [2.2, 0.86], [1.95, 0.93], [1.88, 0.86], [2.0, 0.63], [2.16, 0.5]], VK[4], VK[8]);
  const tailBand = S.face([[0.48, 0.8], [0.88, 0.775], [0.87, 0.86], [0.48, 0.875]], false, 0.3);
  const rMesh = S.face(roundPoly([[0, 0.6], [0.42, 0.6], [0.42, 0.865], [0, 0.875]], [0, 0.01, 0.01, 0], 2), false, 0.3);
  const rVent = S.face([[0.6, 0.44], [0.92, 0.44], [0.92, 0.71], [0.6, 0.71]], false, 0.3);
  const exh = S.face([[0, 0.4], [0.12, 0.4], [0.2, 0.47], [0.12, 0.54], [0, 0.54]], false, 0.3);

  const holes = [archF.exc, archR.exc, wsh, dlo, backW, coverGlass, louvL, sideIn, shoulderIn, fIntake, headL, tailBand, rMesh, rVent, exh];

  // ---------------- Shell ----------------
  const as = arcSamplesMulti(S, [0.15, 0.4, 0.6, 1], XT, XN, 0.058);
  const bs = runs(span(0, 1, 1 / 40), VK);
  const creaseB = [VK[3], VK[5]];
  const lidPoly: V2[] = [[0.98, VK[6] + 0.02], [0.98, 1.03], [2.36, 1.03], [2.3, 0.6], [2.2, VK[6] + 0.02]];
  A.add('hood', gridGeo(S, { as, bs, creaseB, inc: [lidPoly], exc: holes }));
  A.add('paint', gridGeo(S, { as, bs, creaseB, exc: [...holes, lidPoly] }));
  A.add('dash', gridGeo(S, { as: span(-1.0, 0.9, 0.09), bs: span(0.05, 1, 1 / 20), offset: -0.03, inside: true }));

  // ---------------- Shut lines ----------------
  const gap = (path: V2[]) => A.add('gap', ribbon(S, path, { width: 0.0045 }));
  gap(openPath(lidPoly, S));
  // scissor door: front edge rises diagonally from behind the front arch, rear edge ahead of the side intake lip, sill
  gap(S.side([[0.82, 0.22], [0.86, 0.5], [0.8, 0.7]], 0.02, VK[5] - 0.002));
  gap(S.side([[-0.62, 0.22], [-0.6, 0.38]], 0.02, VK[5] - 0.002));
  gap(S.side([[-0.52, 0.66], [-0.6, 0.79]], 0.02, VK[5] - 0.002));
  gap(S.side([[0.82, 0.21], [-0.62, 0.21]], 0.01, 0.2));
  // engine cover outline + rear bumper split + front bumper split
  gap(openPath([[-1.18, 1.03], [-1.18, VK[6] + 0.03], [-2.2, VK[6] + 0.03], [-2.2, 1.03]], S));
  gap(S.side([[-1.85, 0.2], [-1.92, 0.5], [-2.02, 0.7]], 0.02, VK[5] - 0.002));
  gap(S.side([[1.86, 0.18], [1.9, 0.38], [1.98, 0.52]], 0.02, VK[5] - 0.002));
  // the lid's two ridge lines converging toward the windshield
  A.add('paint', ribbon(S, S.top([[2.25, 0.5], [1.6, 0.4], [1.0, 0.32]], VK[5], 1), { width: 0.02, prof: 'round', bump: 0.006 }));

  // ---------------- Glass ----------------
  A.add('glass', patchGeo(S, wsh, { offset: -0.003, step: 0.045 }));
  A.add('glass', patchGeo(S, dlo, { offset: -0.006, step: 0.04 }));
  A.add('glassDark', patchGeo(S, backW, { offset: -0.004, step: 0.04 }));
  A.add('glassDark', patchGeo(S, coverGlass, { offset: -0.004, step: 0.05 }));
  A.add('rubber', ribbon(S, openPath(wsh, S), { width: 0.016, prof: 'round', bump: 0.003 }));
  A.add('rubber', ribbon(S, openPath(coverGlass, S), { width: 0.02, prof: 'round', bump: 0.004 }));
  A.add('rubber', ribbon(S, dlo, { width: 0.016, closed: true, prof: 'round', bump: 0.003 }));
  A.add('gloss', ribbon(S, [[0.85, V_RAIL + 0.004], [0.3, V_RAIL + 0.004], [-0.27, V_RAIL + 0.004]], { width: 0.05, lift: 0.0015 }));
  // carbon spine down the engine cover
  A.add('gloss', ribbon(S, [[-1.2, 1.0], [-2.15, 1.0]], { width: 0.05, prof: 'round', bump: 0.01, mirror: false }));

  // ---------------- Arches ----------------
  for (const ar of [archF, archR]) {
    A.add('liner', ar.liner);
    A.add('paint', ribbon(S, ar.edge, { width: 0.024, prof: 'round', bump: 0.005, shift: 0.006 }));
  }

  // ---------------- Intakes, louvres ----------------
  {
    const ps = pocketGeo(S, sideIn, { depth: 0.12, taper: 0.15, backDisp: (u) => 0.09 * Math.min(1, Math.max(0, (u + 0.1) / 0.6)) });
    A.add('paint', ps.wall);
    A.add('under', ps.back);
    A.add('grille', patchGeo(S, S.side(roundPoly([[-0.62, 0.38], [-0.84, 0.38], [-0.84, 0.64], [-0.56, 0.64]], 0.02, 2), 0.02, VK[5] - 0.004), { offset: -0.09, step: 0.04 }));
    const pq = pocketGeo(S, shoulderIn, { depth: 0.09, taper: 0.1 });
    A.add('trim', pq.wall);
    A.add('under', pq.back);
    A.add('grilleSlats', patchGeo(S, shoulderIn, { offset: -0.05, step: 0.03 }));
    const pl = pocketGeo(S, louvL, { depth: 0.035 });
    A.add('trim', pl.wall);
    A.add('under', pl.back);
    for (let i = 0; i < 8; i++) {
      const u = lerp(-1.36, -2.0, i / 7);
      A.add('carbon', ribbon(S, [[u, S.vAtZ(u, 0.6, VK[5], 1)], [u, S.vAtZ(u, 0.4, VK[5], 1)]], { width: 0.035, lift: -0.012, prof: 'round', bump: 0.012 }));
    }
  }

  // ---------------- Front: corner intakes with Y vanes, headlamps with Y DRLs, nose, splitter ----------------
  {
    const pf = pocketGeo(S, fIntake, { depth: 0.1, taper: 0.06 });
    A.add('gloss', pf.wall);
    A.add('under', pf.back);
    A.add('grille', patchGeo(S, fIntake, { offset: -0.05, step: 0.03 }));
    // the Y vane across each intake
    const yc = S.endUV(0.66, 0.3, true);
    for (const [z, y] of [[0.45, 0.22], [0.87, 0.24], [0.8, 0.39]] as V2[]) A.add('gloss', ribbon(S, [S.endUV(z, y, true), yc], { width: 0.03, lift: 0.004 }));
    const ph = pocketGeo(S, headL, { depth: 0.05, taper: 0.1 });
    A.add('gloss', ph.wall);
    A.add('blackChrome', ph.back);
    A.add('lensClear', patchGeo(S, headL, { offset: 0.0015, step: 0.03 }));
    A.add('gloss', ribbon(S, headL, { width: 0.012, closed: true, prof: 'round', bump: 0.002 }));
    // Y-shaped LED: three strips meeting at a node, sunk inside the lamp
    const node: V2 = S.top([[2.08, 0.75]], VK[4], VK[8])[0];
    const arms = S.top([[2.22, 0.62], [2.15, 0.88], [1.93, 0.88]], VK[4], VK[8]);
    for (const a of arms) A.add('head', ribbon(S, [a, node], { width: 0.014, lift: -0.02 }));
    for (const [x, z] of [[2.03, 0.8], [2.12, 0.7]] as V2[]) {
      const f = frame(S, ...S.top([[x, z]], VK[4], VK[8])[0]);
      const c = f.p.clone().addScaledVector(f.n, -0.03);
      A.add('chrome', withMirror(onSurface(new THREE.CylinderGeometry(0.03, 0.026, 0.03, 18, 1, true).rotateX(Math.PI / 2), c, f.n)));
      A.add('head', withMirror(onSurface(new THREE.CircleGeometry(0.02, 18), c.clone().addScaledVector(f.n, 0.01), f.n)));
    }
    A.add('gloss', ribbon(S, span(2.0, XN, 0.015).map((u) => [u, 0.012] as V2), { width: 0.034, prof: 'round', bump: 0.008 }));
    const nb = frame(S, ...S.endUV(0.002, 0.33, true));
    A.add('badge', onSurface(new THREE.PlaneGeometry(0.2, 0.05), nb.p.clone().addScaledVector(nb.n, 0.003), nb.n));
  }

  // ---------------- Rear: Y lamps in black bands, mesh, vents, hex exhaust, diffuser ----------------
  {
    const pb = pocketGeo(S, tailBand, { depth: 0.03 });
    A.add('gloss', pb.wall);
    A.add('gloss', pb.back);
    const yn = S.endUV(0.72, 0.83, false, 0.3);
    for (const [z, y] of [[0.5, 0.84], [0.86, 0.79], [0.86, 0.85]] as V2[]) A.add('tail', ribbon(S, [S.endUV(z, y, false, 0.3), yn], { width: 0.016, lift: -0.026 }));
    A.add('lensSmoke', patchGeo(S, tailBand, { offset: 0.001, step: 0.03 }));
    for (const [poly, d] of [
      [rMesh, 0.07],
      [rVent, 0.08],
    ] as [V2[], number][]) {
      const pk = pocketGeo(S, poly, { depth: d });
      A.add('gloss', pk.wall);
      A.add('under', pk.back);
      A.add('grille', patchGeo(S, poly, { offset: -0.02, step: 0.035 }));
    }
    const pe = pocketGeo(S, exh, { depth: 0.1 });
    A.add('chrome', pe.wall);
    A.add('under', pe.back);
    // plate on a bracket under the exhaust, above the diffuser
    A.add('plate', new THREE.PlaneGeometry(0.4, 0.1).rotateY(-Math.PI / 2).translate(XT + 0.03, 0.31, 0));
    A.add('gloss', new THREE.BoxGeometry(0.04, 0.12, 0.44).translate(XT + 0.052, 0.31, 0));
    const dif: THREE.BufferGeometry[] = [];
    dif.push(place(new THREE.BoxGeometry(0.8, 0.012, 1.7), -2.0, 0.2, 0, 0, 0, 0.2));
    for (const z of [-0.7, -0.45, -0.2, 0.2, 0.45, 0.7]) dif.push(place(new THREE.BoxGeometry(0.75, 0.16, 0.012), -2.0, 0.19, z, 0, 0, 0.2));
    A.add('carbon', merge(dif));
  }

  // ---------------- Mirrors, sill ----------------
  {
    const m = mirrorGeos(0.62, 0.84, ZC[0] + 0.02, { len: 0.2, h: 0.075, w: 0.06, out: 0.17, yaw: 0.05, stalkUp: 0.07 });
    A.add('paint', m.housing);
    A.add('mirror', m.glass);
    A.add('carbon', m.stalk);
    A.add('carbon', ribbon(S, [[0.85, 0.035], [-0.85, 0.035]], { width: 0.04, prof: 'round', bump: 0.008 }));
  }

  // ---------------- Underbody ----------------
  A.add('under', floorGeo(span(-2.1, 2.3, 0.1), (x) => yb(x) + 0.012, (x) => {
    const w = side(x) * pEnd(x) - 0.09;
    const near = Math.abs(x - XF) < 0.5 || Math.abs(x - XR) < 0.52;
    return Math.max(0.1, near ? Math.min(w, 0.5) : w);
  }));

  // ---------------- Interior ----------------
  {
    const fy = 0.17;
    A.add('carpet', place(rbox(1.6, 0.03, 1.4, 0.01), -0.2, fy, 0));
    for (const z of [-0.38, 0.38]) A.add('dash', seatGeo(-0.35, fy, z, 0.5, 0.5));
    A.add('dash', place(rbox(0.04, 0.6, 1.5, 0.01), -1.02, 0.55, 0));
    const dashP: V2[] = [[0.9, 0.78], [0.62, 0.83], [0.36, 0.8], [0.3, 0.7], [0.38, 0.5], [0.9, 0.5]];
    A.add('dash', slab(dashP, -0.8, 0.8, 0.01));
    A.add('dash', place(rbox(0.16, 0.07, 0.36, 0.03), 0.4, 0.84, -0.38));
    A.add('carbon', place(rbox(1.1, 0.3, 0.3, 0.05), 0.0, fy + 0.15, 0));
    A.add('intTrim', place(rbox(0.12, 0.05, 0.05, 0.01, 1), 0.2, fy + 0.32, 0));
    A.add('wheel', steeringGeo(vec(0.18, 0.72, -0.38), 0.65, 0.175));
    A.add('gloss', tubeGeo([vec(0.9, 0.79, -0.45), vec(0.87, 0.8, -0.05), vec(0.84, 0.81, 0.4)], 0.008, 6, 12));
  }

  const body = A.finish();
  body.userData = { belt: 0.84, sill: 0.18, door: [-0.62, 0.84], cowl: 0.86 };
  const v = vec;
  return {
    body,
    dims: { length: XN - XT, width: 2.03, height: 1.136, wheelbase: WB, trackF: TRACK_F, trackR: TRACK_R, wheelR: WR, rideHeight: 0.11 },
    anchors: {
      wheelFL: v(XF, WR, -TRACK_F / 2), wheelFR: v(XF, WR, TRACK_F / 2),
      wheelRL: v(XR, WR, -TRACK_R / 2), wheelRR: v(XR, WR, TRACK_R / 2),
      exhausts: [-0.07, 0.07].map((z) => ({ pos: v(XT + 0.06, 0.46, z), dir: v(-1, 0, 0) })),
      hood: v(1.5, yLid(1.5) + 0.014, 0),
      roof: v(-0.42, 1.136, 0),
      deck: v(-2.05, yDeck(-2.05) + 0.01, 0),
      frontBumper: v(XN - 0.05, 0.16, 0),
      seat: v(-0.45, 0.93, -0.38),
      headlights: [v(2.1, 0.55, -0.75), v(2.1, 0.55, 0.75)],
      taillights: [v(XT + 0.02, 0.89, -0.72), v(XT + 0.02, 0.89, 0.72)],
    },
    paintMeshes: A.paint,
    tailLightMeshes: A.tailLights,
    headLightMeshes: A.headLights,
  };
}
