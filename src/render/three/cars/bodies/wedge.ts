// 'wedge' body: an 80s wedge supercar (Countach LP400 / Esprit S1 vibe). A knife-edge nose low at the FRONT (+X), one
// straight wedge line rising from the nose over the front lid and the steeply raked windshield to a short flat roof, a broad
// flat engine deck and a chopped, square tail with a black lamp panel. Folded-paper creases (split normals at the waist and
// the shoulder), trapezoidal arches, NACA ducts in the doors, raised pop-up headlamps, scissor-door shut lines.
// Car faces +X, origin at ground level mid-wheelbase, right side = +Z (LHD: driver on -Z). See _helpersC.ts for the modelling approach.
import * as THREE from 'three';
import type { BodyBuild, CarSpec } from '../../types';
import {
  Assembler, Loft, archParts, arcSamplesMulti, crv, endRound, floorGeo, frame, gridGeo, lerp, merge, mirrorGeos, onSurface, openPath, patchGeo, place, pocketGeo, rbox, ribbon, roundOpen, roundPoly, runs, seatGeo, slab, smooth2, span, steeringGeo, tubeGeo, vec, withMirror, type V2,
} from './_helpersC';

const XN = 2.175;
const XT = -1.965;
const WB = 2.45;
const XF = WB / 2;
const XR = -WB / 2;
const WR = 0.31;
const TRACK_F = 1.5;
const TRACK_R = 1.53;

// sill, rocker, lower side, WAIST crease, upper side, SHOULDER crease, rail, roof edge, roof mid, centre
const VK = [0, 0.07, 0.18, 0.28, 0.4, 0.5, 0.64, 0.72, 0.86, 1];
const CREASE = [false, false, false, true, false, true, false, false, false, false];
const V_SH = VK[5];
const V_RAIL = VK[6];

// ---- Character curves (side view y, plan view z) ----
const yb = crv([[XT, 0.3], [-1.86, 0.25], [-1.6, 0.15], [1.55, 0.13], [1.85, 0.16], [2.05, 0.235], [2.13, 0.3], [XN, 0.335]]);
// shoulder crease: the wedge line, straight from the nose up past the doors, then level to the tail
const yS = crv([[XT, 0.855], [-1.6, 0.875], [-1.0, 0.872], [-0.4, 0.83, 'c'], [XN, 0.39]]);
const yW = (x: number) => lerp(yb(x), yS(x), x > 1.9 ? 0.45 : 0.42);
const side = crv([[XT, 0.94], [-1.4, 0.945], [-0.6, 0.93], [0.4, 0.915], [1.2, 0.915], [1.7, 0.885], [XN, 0.77]]);
const zS = crv([[XT, 0.9], [-1.4, 0.9], [-0.6, 0.87], [0.4, 0.855], [1.2, 0.86], [1.8, 0.82], [XN, 0.7]]);
// front lid / windshield / roof / engine deck centreline
const yLid = crv([[0.46, 0.79], [XN, 0.4]]); // straight lid: the wedge line
const yRoof = crv([[-0.95, 1.05], [-0.8, 1.064], [-0.5, 1.07], [-0.24, 1.066]]);
const yDeck = crv([[XT, 0.865], [-1.6, 0.893], [-1.15, 0.918]]);
const pEnd = (x: number) => endRound(x, XN, 0.16, 2.2) * endRound(x, XT, 0.06, 3.2);

const ZT = [0.62, 0.46, 0.24, 0]; // lid/deck knots
const ZC = [0.56, 0.5, 0.27, 0]; // cabin knots
const COWL = [0.43, 0.45, 0.47, 0.47];
const HDR = [-0.27, -0.25, -0.23, -0.23];
const ROOF_END = [-0.84, -0.82, -0.8, -0.8];
const DECK = [-1.2, -1.12, -1.06, -1.05];
const CABIN_DY = [-0.05, -0.012, -0.003, 0];

function lidK(j: number, x: number): [number, number] {
  const f = ZT[j] / zS(x);
  return [yLid(x) + 0.018 * (1 - f * f) - (yLid(x) - yS(x)) * Math.pow(f, 6) * 0.5, ZT[j]];
}
function cabinK(j: number, x: number): [number, number] {
  return [yRoof(x) + CABIN_DY[j], ZC[j]];
}
function deckK(j: number, x: number): [number, number] {
  const f = ZT[j] / zS(x);
  return [yDeck(x) + 0.012 * (1 - f * f) - (yDeck(x) - yS(x)) * Math.pow(f, 4), ZT[j]];
}
function topK(j: number, x: number): [number, number] {
  if (x >= COWL[j]) return lidK(j, x);
  if (x >= HDR[j]) {
    const t = (COWL[j] - x) / (COWL[j] - HDR[j]);
    const a = lidK(j, COWL[j]);
    const b = cabinK(j, HDR[j]);
    return [lerp(a[0], b[0], t) + 0.008 * Math.sin(Math.PI * t), lerp(a[1], b[1], t)];
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
    b, (s - 0.06) * p,
    b + 0.05, (s - 0.02) * p,
    lerp(b, yw, 0.55), (s - 0.006) * p,
    yw, s * p,
    lerp(yw, ySh, 0.5), lerp(s, zSh, 0.45) * p,
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
  const A = new Assembler(spec, { plate: 'WEDGE', badge: 'CUNEO' });

  // ---------------- Outlines ----------------
  // trapezoid arches (Countach): sloped front side, flat top, steep rear side
  const archLine = (xc: number, k: number): V2[] =>
    roundOpen([[xc + 0.42 * k, 0.1], [xc + 0.35 * k, 0.48], [xc + 0.19 * k, 0.6], [xc - 0.25 * k, 0.6], [xc - 0.39 * k, 0.46], [xc - 0.41 * k, 0.1]], 0.07, 5);
  const fArch = archLine(XF, 1).reverse();
  const rArch = archLine(XR, 1.06).reverse();
  const archF = archParts(S, fArch, { zIn: 0.48, hub: [XF, WR], vMax: VK[5], yFloor: 0.12 });
  const archR = archParts(S, rArch, { zIn: 0.46, hub: [XR, WR], vMax: VK[5], yFloor: 0.12 });

  const wsh: V2[] = [[0.42, V_RAIL + 0.03], [0.45, 1.03], [-0.2, 1.03], [-0.22, V_RAIL + 0.03]];
  // trapezoid side glass with the LP400 split (lower sliding pane) + rear quarter
  const dlo: V2[] = smooth2([[0.33, V_SH + 0.012], [0.2, V_RAIL - 0.016], [-0.24, V_RAIL - 0.016], [-0.62, V_RAIL - 0.016], [-0.74, V_SH + 0.03], [-0.7, V_SH + 0.012]], true, 3);
  const backW: V2[] = [[-0.86, 0.9], [-0.86, 1.03], [-0.98, 1.03], [-0.98, 0.9]];
  // NACA duct in the door running back into the rear fender (narrow front, wide rear)
  const naca: V2[] = S.side(smooth2([[0.1, 0.705], [-0.3, 0.705], [-0.62, 0.725], [-0.7, 0.79], [-0.55, 0.81], [-0.3, 0.765], [0.0, 0.725]], true, 4), VK[3], VK[5] - 0.002);
  // slatted intake on the sail behind the side glass
  const gill: V2[] = smooth2([[-0.82, V_SH + 0.02], [-0.84, V_RAIL - 0.025], [-1.12, V_RAIL - 0.05], [-1.16, V_SH + 0.02]], true, 3);
  // front: knife-edge lamp slot across the nose + corner lamps; rear: black lamp panel
  const slot = S.face(roundPoly([[0, 0.348], [0.4, 0.352], [0.4, 0.384], [0, 0.384]], [0, 0.008, 0.008, 0], 2));
  const cornerL = S.face(roundPoly([[0.47, 0.348], [0.68, 0.352], [0.68, 0.392], [0.47, 0.388]], 0.008, 2));
  const tailPanel = S.face(roundPoly([[0, 0.55], [0.86, 0.55], [0.86, 0.79], [0, 0.79]], [0, 0.02, 0.02, 0], 3), false, 0.5);
  const intake = S.face(roundPoly([[0, 0.31], [0.55, 0.31], [0.55, 0.47], [0, 0.47]], [0, 0.02, 0.02, 0], 3), false, 0.5);
  const louvre: V2[] = S.top(roundPoly([[-1.25, 0.001], [-1.25, 0.5], [-1.8, 0.5], [-1.8, 0.001]], [0.03, 0.03, 0.03, 0.03], 3), VK[5], 1).map(([u, v]) => [u, v > 0.995 ? 1.03 : v] as V2);
  const periscope: V2[] = [[-0.4, 0.93], [-0.4, 1.03], [-0.84, 1.03], [-0.84, 0.93]];

  const holes = [archF.exc, archR.exc, wsh, dlo, backW, naca, gill, slot, cornerL, tailPanel, intake, louvre, periscope];

  // ---------------- Shell ----------------
  const as = arcSamplesMulti(S, [0.15, 0.4, 0.6, 1], XT, XN, 0.058);
  const bs = runs(span(0, 1, 1 / 40), VK);
  const creaseB = [VK[3], VK[5]];
  const lidPoly: V2[] = [[0.5, V_RAIL - 0.04], [0.5, 1.03], [2.12, 1.03], [2.12, VK[5] + 0.035], [1.7, V_RAIL - 0.04]];
  A.add('hood', gridGeo(S, { as, bs, creaseB, inc: [lidPoly], exc: holes }));
  A.add('paint', gridGeo(S, { as, bs, creaseB, exc: [...holes, lidPoly] }));
  A.add('dash', gridGeo(S, { as: span(-1.15, 0.45, 0.08), bs: span(0.05, 1, 1 / 20), offset: -0.03, inside: true }));

  // ---------------- Shut lines ----------------
  const gap = (path: V2[], closed = false) => A.add('gap', ribbon(S, path, { width: 0.0045, closed }));
  gap(openPath(lidPoly, S));
  // scissor door: front edge behind the front arch up the A-pillar base, rear edge ahead of the NACA lip, along the sill
  gap(S.side([[0.6, 0.2], [0.62, 0.55], [0.5, 0.7]], 0.02, VK[5] - 0.001));
  gap(S.side([[-0.5, 0.2], [-0.52, 0.5], [-0.6, 0.79]], 0.02, VK[5] - 0.001));
  gap(S.side([[0.6, 0.2], [-0.5, 0.2]], 0.02, 0.2));
  // engine lid: between the rear fenders from the rear window to the tail
  gap(openPath([[-1.0, 1.03], [-1.0, 0.58], [-1.93, 0.58], [-1.93, 1.03]], S));
  // nose cap / bumper line
  gap(S.side([[1.95, 0.24], [1.98, 0.35], [2.0, 0.46]], 0.02, VK[5] - 0.002));

  // ---------------- Glass ----------------
  A.add('glass', patchGeo(S, wsh, { offset: -0.003, step: 0.035 }));
  A.add('glass', patchGeo(S, dlo, { offset: -0.006, step: 0.03 }));
  A.add('glassDark', patchGeo(S, backW, { offset: -0.004, step: 0.03 }));
  A.add('rubber', ribbon(S, openPath(wsh, S), { width: 0.018, prof: 'round', bump: 0.003 }));
  A.add('rubber', ribbon(S, openPath(backW, S), { width: 0.014, prof: 'round', bump: 0.003 }));
  A.add('rubber', ribbon(S, dlo, { width: 0.016, closed: true, prof: 'round', bump: 0.003 }));
  // LP400 split side window: horizontal rail across the door glass
  A.add('gloss', ribbon(S, [[0.22, lerp(V_SH, V_RAIL, 0.32)], [-0.66, lerp(V_SH, V_RAIL, 0.32)]], { width: 0.016, lift: 0.002 }));
  // black A-pillars
  A.add('gloss', ribbon(S, [[0.43, V_RAIL + 0.003], [0.1, V_RAIL + 0.003], [-0.27, V_RAIL + 0.003]], { width: 0.05, lift: 0.0015 }));

  // ---------------- Arches ----------------
  for (const ar of [archF, archR]) {
    A.add('liner', ar.liner);
    A.add('gloss', ribbon(S, ar.edge, { width: 0.03, prof: 'round', bump: 0.006, shift: 0.008 }));
  }

  // ---------------- NACA ducts, gills, louvres, periscope ----------------
  {
    const t0 = 0.1;
    const t1 = -0.7;
    const pn = pocketGeo(S, naca, { depth: 0.07, backDisp: (u) => 0.065 * Math.min(1, Math.max(0, (u - t1) / (t0 - t1))) ** 1.5 });
    A.add('paint', pn.wall);
    A.add('trim', pn.back);
    const pg = pocketGeo(S, gill, { depth: 0.05, taper: 0.05 });
    A.add('trim', pg.wall);
    A.add('under', pg.back);
    for (let i = 1; i <= 5; i++) {
      const v = lerp(V_SH + 0.02, V_RAIL - 0.04, i / 6);
      A.add('paint', ribbon(S, [[-0.83, v + 0.004], [-1.15, v - 0.012]], { width: 0.014, lift: -0.012, prof: 'round', bump: 0.008 }));
    }
    const pl = pocketGeo(S, louvre, { depth: 0.04 });
    A.add('trim', pl.wall);
    A.add('under', pl.back);
    for (let i = 0; i < 9; i++) {
      const u = lerp(-1.29, -1.76, i / 8);
      A.add('paint', ribbon(S, [[u, S.vAtZ(u, 0.47, VK[5], 1)], [u, 1.0]], { width: 0.03, lift: -0.012, prof: 'round', bump: 0.012 }));
    }
    const pp = pocketGeo(S, periscope, { depth: 0.06, taper: 0.1 });
    A.add('paint', pp.wall);
    A.add('trim', pp.back);
  }

  // ---------------- Front: knife-edge slot, corner lamps, pop-up headlamps, chin ----------------
  {
    const ps = pocketGeo(S, slot, { depth: 0.05 });
    A.add('trim', ps.wall);
    A.add('under', ps.back);
    A.add('grilleSlats', patchGeo(S, slot, { offset: -0.015, step: 0.02 }));
    const pc = pocketGeo(S, cornerL, { depth: 0.02 });
    A.add('trim', pc.wall);
    A.add('amber', pc.back);
    A.add('lensAmber', patchGeo(S, cornerL, { offset: 0.002, step: 0.02 }));
    A.add('gloss', ribbon(S, span(1.9, XN, 0.015).map((u) => [u, 0.016] as V2), { width: 0.022, prof: 'round', bump: 0.006 }));
    // pop-ups RAISED: a pod per side standing up out of the lid (painted top, black body), two lamps facing forward
    {
      const zc = 0.53;
      const w = 0.36;
      const xr = 1.64;
      const xf = 1.88;
      const yTop = lidK(1, xr)[0] + 0.07;
      const yBot = lidK(1, xf)[0] - 0.03;
      const box = rbox(xf - xr, yTop - yBot, w, 0.012);
      box.translate((xf + xr) / 2, (yTop + yBot) / 2, zc);
      A.add('paint', withMirror(box));
      const face = new THREE.PlaneGeometry(w - 0.02, yTop - yBot - 0.03).rotateY(Math.PI / 2);
      face.translate(xf + 0.002, (yTop + yBot) / 2 + 0.005, zc);
      A.add('gloss', withMirror(face));
      const top = rbox(xf - xr + 0.006, 0.016, w + 0.006, 0.006);
      top.translate((xf + xr) / 2, yTop, zc);
      A.add('paint', withMirror(top));
      for (const dz of [-0.088, 0.088]) {
        const yl = yTop - 0.05;
        const bez = rbox(0.012, 0.085, 0.15, 0.006);
        bez.translate(xf + 0.004, yl, zc + dz);
        A.add('chrome', withMirror(bez));
        const lamp = new THREE.CircleGeometry(0.036, 24).rotateY(Math.PI / 2);
        lamp.translate(xf + 0.0115, yl, zc + dz);
        A.add('head', withMirror(lamp));
        const ringG = new THREE.TorusGeometry(0.038, 0.004, 6, 24).rotateY(Math.PI / 2);
        ringG.translate(xf + 0.012, yl, zc + dz);
        A.add('chrome', withMirror(ringG));
      }
      // the lid opening the pod rises from
      const foot: V2[] = S.top(roundPoly([[xr - 0.01, zc - w / 2 - 0.01], [xf + 0.01, zc - w / 2 - 0.01], [xf + 0.01, zc + w / 2 + 0.01], [xr - 0.01, zc + w / 2 + 0.01]], 0.02, 2), VK[5], 1);
      A.add('gap', ribbon(S, foot, { width: 0.006, closed: true }));
    }
    // front lid badge
    const nb = frame(S, 2.02, 1);
    A.add('badge', onSurface(new THREE.PlaneGeometry(0.2, 0.05), nb.p.clone().addScaledVector(nb.n, 0.003), nb.n, Math.PI / 2));
  }

  // ---------------- Rear: lamp panel (3 lamps a side), engine intake grille, plate, exhaust ----------------
  {
    const pt = pocketGeo(S, tailPanel, { depth: 0.02 });
    A.add('gloss', pt.wall);
    A.add('gloss', pt.back);
    const lampZ: [number, number, string][] = [[0.78, 0.11, 'amber'], [0.62, 0.13, 'tail'], [0.44, 0.13, 'tail']];
    for (const [zc, w, k] of lampZ) {
      const poly = S.face(roundPoly([[zc - w / 2, 0.6], [zc + w / 2, 0.6], [zc + w / 2, 0.74], [zc - w / 2, 0.74]], 0.012, 2), false, 0.5);
      const pk = pocketGeo(S, poly, { depth: 0.035, lift: -0.019 });
      A.add('chrome', pk.wall);
      A.add(k === 'amber' ? 'amber' : 'tail', pk.back);
      A.add(k === 'amber' ? 'lensAmber' : 'lensRed', patchGeo(S, poly, { offset: -0.017, step: 0.02 }));
    }
    const pi = pocketGeo(S, intake, { depth: 0.09 });
    A.add('trim', pi.wall);
    A.add('under', pi.back);
    A.add('grille', patchGeo(S, intake, { offset: -0.03, step: 0.02 }));
    const pf = frame(S, ...S.endUV(0.002, 0.67, false, 0.5));
    A.add('plate', onSurface(new THREE.PlaneGeometry(0.4, 0.1), pf.p.clone().addScaledVector(pf.n, -0.014), pf.n));
    const bf = frame(S, -1.93, 1);
    A.add('badgeRear', onSurface(new THREE.PlaneGeometry(0.22, 0.055), bf.p.clone().addScaledVector(bf.n, 0.003), bf.n, Math.PI / 2));
    // bumper blade + lower valance
    A.add('gloss', ribbon(S, S.face(span(0, 0.9, 0.03).map((z) => [z, 0.52] as V2), false, 0.5), { width: 0.05, prof: 'round', bump: 0.025 }));
    const dif: THREE.BufferGeometry[] = [];
    dif.push(place(new THREE.BoxGeometry(0.5, 0.012, 1.4), -1.75, 0.2, 0, 0, 0, 0.1));
    for (const z of [-0.55, -0.3, 0.3, 0.55]) dif.push(place(new THREE.BoxGeometry(0.4, 0.07, 0.01), -1.78, 0.18, z, 0, 0, 0.1));
    A.add('gloss', merge(dif));
  }

  // ---------------- Side mirrors, door handle recess, sill ----------------
  {
    const m = mirrorGeos(0.34, 0.78, zS(0.34) - 0.03, { len: 0.17, h: 0.08, w: 0.06, out: 0.1, yaw: 0.05, stalkUp: 0.07 });
    A.add('paint', m.housing);
    A.add('mirror', m.glass);
    A.add('gloss', m.stalk);
    A.add('gloss', ribbon(S, [[1.0, 0.04], [-0.9, 0.04]], { width: 0.03, prof: 'round', bump: 0.006 }));
  }

  // ---------------- Underbody ----------------
  A.add('under', floorGeo(span(-1.85, 2.05, 0.1), (x) => yb(x) + 0.012, (x) => {
    const w = side(x) * pEnd(x) - 0.08;
    const near = Math.abs(x - XF) < 0.48 || Math.abs(x - XR) < 0.5;
    return Math.max(0.1, near ? Math.min(w, 0.45) : w);
  }));

  // ---------------- Interior ----------------
  {
    const fy = 0.2;
    A.add('carpet', place(rbox(1.5, 0.03, 1.3, 0.01), -0.3, fy, 0));
    for (const z of [-0.36, 0.36]) A.add('seat', seatGeo(-0.4, fy, z, 0.55, 0.48));
    A.add('dash', place(rbox(0.04, 0.6, 1.4, 0.01), -0.98, 0.55, 0));
    const dashP: V2[] = [[0.46, 0.76], [0.25, 0.8], [0.06, 0.78], [0.02, 0.68], [0.1, 0.5], [0.46, 0.5]];
    A.add('dash', slab(dashP, -0.74, 0.74, 0.01));
    A.add('dash', place(rbox(0.14, 0.07, 0.34, 0.03), 0.1, 0.81, -0.36));
    A.add('dash', place(rbox(1.0, 0.28, 0.26, 0.04), -0.2, fy + 0.14, 0));
    A.add('intTrim', place(rbox(0.06, 0.1, 0.03, 0.01), -0.25, fy + 0.33, 0));
    A.add('wheel', steeringGeo(vec(-0.05, 0.72, -0.36), 0.75, 0.17));
    A.add('gloss', tubeGeo([vec(0.46, 0.79, 0.45), vec(0.43, 0.8, 0.05), vec(0.4, 0.81, -0.45)], 0.008, 6, 12));
  }

  const body = A.finish();
  body.userData = { belt: 0.76, sill: 0.2, door: [-0.5, 0.6], cowl: 0.45 };
  const v = vec;
  return {
    body,
    dims: { length: XN - XT, width: 1.89, height: 1.07, wheelbase: WB, trackF: TRACK_F, trackR: TRACK_R, wheelR: WR, rideHeight: 0.12 },
    anchors: {
      wheelFL: v(XF, WR, -TRACK_F / 2), wheelFR: v(XF, WR, TRACK_F / 2),
      wheelRL: v(XR, WR, -TRACK_R / 2), wheelRR: v(XR, WR, TRACK_R / 2),
      exhausts: [-0.26, -0.12, 0.12, 0.26].map((z) => ({ pos: v(XT + 0.08, 0.26, z), dir: v(-1, 0, 0) })),
      hood: v(1.3, yLid(1.3) + 0.018, 0),
      roof: v(-0.55, 1.07, 0),
      deck: v(-1.6, yDeck(-1.6) + 0.012, 0),
      frontBumper: v(XN - 0.03, 0.3, 0),
      seat: v(-0.5, 0.95, -0.36),
      headlights: [v(1.85, 0.66, 0.53), v(1.85, 0.66, -0.53)],
      taillights: [v(XT, 0.67, 0.62), v(XT, 0.67, 0.44), v(XT, 0.67, -0.62), v(XT, 0.67, -0.44)],
    },
    paintMeshes: A.paint,
    tailLightMeshes: A.tailLights,
    headLightMeshes: A.headLights,
  };
}
