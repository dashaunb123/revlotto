// 'tuner' body: the "Kaiju", a hand-built Mk4-Supra-style 90s Japanese GT. Long low hood rolling into a round nose,
// a bubble cabin set well back, broad rear haunches and the round tail with four round lamps. The hoop wing is the kit's.
// Car faces +X, origin at ground level mid-wheelbase, right side = +Z (LHD: driver on -Z). See _helpersC.ts for the modelling approach.
import * as THREE from 'three';
import type { BodyBuild, CarSpec } from '../../types';
import {
  Assembler, Loft, archParts, arcSamplesMulti, crv, ellipse2, endRound, floorGeo, frame, gridGeo, lerp, merge, mirrorGeos, onSurface, openPath, patchGeo, place, pocketGeo, rbox, ribbon, roundArch, roundPoly, runs, seatGeo, slab, smooth2, span, steeringGeo, tubeGeo, vec, withMirror, type V2,
} from './_helpersC';

// ---- Proportions (m) ----
const XN = 2.295; // nose tip
const XT = -2.225; // tail
const WB = 2.55;
const XF = WB / 2;
const XR = -WB / 2;
const WR = 0.32; // design wheel radius (hub height)
const TRACK_F = 1.52;
const TRACK_R = 1.53;
const ARCH_R = 0.372;

// Knot parameters along the ring: sill, rocker, lower side, max width, shoulder, belt, rail, roof edge, roof mid, centre.
const VK = [0, 0.06, 0.18, 0.3, 0.42, 0.52, 0.64, 0.73, 0.86, 1];
const V_BELT = VK[5];
const V_RAIL = VK[6];

// ---- Character curves ----
const yb = crv([[XT, 0.34], [-2.2, 0.29], [-2.08, 0.25], [-1.85, 0.21], [-1.55, 0.165], [-0.9, 0.15], [0.9, 0.15], [1.65, 0.158], [2.1, 0.155], [2.22, 0.158], [2.262, 0.162], [2.285, 0.166], [XN, 0.172]]);
const side = crv([[XT, 0.85], [-2.0, 0.884], [-1.35, 0.905], [-0.75, 0.888], [0.0, 0.874], [0.7, 0.878], [1.3, 0.888], [1.85, 0.874], [XN, 0.84]]);
const yBelt = crv([[XT, 0.8], [-2.214, 0.87], [-2.18, 0.91], [-2.07, 0.94], [-1.8, 0.955], [-1.45, 0.948], [-1.0, 0.93], [-0.4, 0.905], [0.3, 0.885], [0.62, 0.874], [1.0, 0.832], [1.6, 0.758], [2.0, 0.692], [2.17, 0.632], [2.245, 0.555], [2.28, 0.48], [XN, 0.432]]);
const zBelt = crv([[XT, 0.7], [-1.9, 0.735], [-1.3, 0.762], [-0.3, 0.77], [0.45, 0.765], [0.9, 0.742], [1.6, 0.73], [XN, 0.71]]);
const yHood = crv([[0.45, 0.88], [0.7, 0.866], [1.0, 0.824], [1.5, 0.758], [1.9, 0.7], [2.1, 0.652], [2.2, 0.607], [2.255, 0.55], [2.283, 0.49], [XN, 0.437]]);
const yDeck = crv([[XT, 0.81], [-2.214, 0.885], [-2.18, 0.93], [-2.07, 0.958], [-1.85, 0.975], [-1.5, 0.985], [-1.3, 0.99]]);
const yRoof = crv([[-0.95, 1.2], [-0.74, 1.245], [-0.5, 1.274], [-0.3, 1.268], [-0.1, 1.245], [0.1, 1.2]]);
const pEnd = (x: number) => endRound(x, XN, 0.48, 2.7) * endRound(x, XT, 0.42, 2.8);

// Top-region knots 6..9: base half-widths on the hood/deck and in the cabin, and the glass transition windows (wrap).
const ZH = [0.6, 0.47, 0.25, 0];
const ZC = [0.6, 0.52, 0.29, 0];
const COWL = [0.54, 0.6, 0.65, 0.67];
const HDR = [-0.24, -0.2, -0.17, -0.16];
const ROOF_END = [-0.79, -0.75, -0.72, -0.71];
const DECK = [-1.66, -1.58, -1.53, -1.51];
const CABIN_DY = [-0.072, -0.034, -0.009, 0];

function hoodK(j: number, x: number): [number, number] {
  const zb = zBelt(x);
  const f = Math.pow(ZH[j] / zb, 3);
  return [yHood(x) + (yBelt(x) - yHood(x)) * f, ZH[j]];
}
function cabinK(j: number, x: number): [number, number] {
  return [yRoof(x) + CABIN_DY[j], ZC[j]];
}
function deckK(j: number, x: number): [number, number] {
  const zb = zBelt(x);
  const f = Math.pow(ZH[j] / zb, 2);
  return [yDeck(x) - (yDeck(x) - yBelt(x)) * f, ZH[j]];
}
function topK(j: number, x: number): [number, number] {
  if (x >= COWL[j]) return hoodK(j, x);
  if (x >= HDR[j]) {
    const t = (COWL[j] - x) / (COWL[j] - HDR[j]);
    const a = hoodK(j, COWL[j]);
    const b = cabinK(j, HDR[j]);
    return [lerp(a[0], b[0], t) + 0.014 * Math.sin(Math.PI * t), lerp(a[1], b[1], t)];
  }
  if (x >= ROOF_END[j]) return cabinK(j, x);
  if (x >= DECK[j]) {
    const t = (ROOF_END[j] - x) / (ROOF_END[j] - DECK[j]);
    const a = cabinK(j, ROOF_END[j]);
    const b = deckK(j, DECK[j]);
    return [lerp(a[0], b[0], t) + 0.04 * Math.sin(Math.PI * t), lerp(a[1], b[1], t)];
  }
  return deckK(j, x);
}

function ring(x: number): number[] {
  const p = pEnd(x);
  const b = yb(x);
  const s = side(x);
  const yB = yBelt(x);
  const zB = zBelt(x);
  const yS = lerp(b, yB, 0.45);
  const k: number[] = [
    b, (s - 0.075) * p,
    b + 0.035, (s - 0.028) * p,
    lerp(b, yS, 0.5), (s - 0.006) * p,
    yS, s * p,
    lerp(yS, yB, 0.62), lerp(s, zB, 0.26) * p,
    yB, zB * p,
  ];
  for (let j = 0; j < 4; j++) {
    const [y, z] = topK(j, x);
    k.push(Math.max(y, yB + 0.0005 * (j + 1)), z * p);
  }
  return k;
}

export default function build(spec: CarSpec): BodyBuild {
  const S = new Loft(ring, VK, XT, XN, [], 1.8);
  const A = new Assembler(spec, { plate: 'KAIJU', badge: 'KAIJU' });

  // ---------------- Feature outlines in (u, v) ----------------
  const archF = archParts(S, roundArch(XF, WR + 0.012, ARCH_R, 0.1), { zIn: 0.46, hub: [XF, WR], vMax: VK[5], yFloor: 0.14 });
  const archR = archParts(S, roundArch(XR, WR + 0.012, ARCH_R + 0.006, 0.1), { zIn: 0.46, hub: [XR, WR], vMax: VK[5], yFloor: 0.14 });

  // Glass: windshield, side DLO (door glass + quarter), backlight. Defined on the knot lines (rail = A-pillar/roof rail).
  const wsh: V2[] = smooth2([[0.6, V_RAIL + 0.03], [0.64, 0.86], [0.655, 1.03], [-0.135, 1.03], [-0.15, 0.86], [-0.19, V_RAIL + 0.03]], true, 5);
  const dlo: V2[] = smooth2([[0.42, V_BELT + 0.012], [0.3, V_RAIL - 0.02], [-0.2, V_RAIL - 0.014], [-0.62, V_RAIL - 0.014], [-0.8, V_RAIL - 0.04], [-0.98, V_BELT + 0.06], [-1.02, V_BELT + 0.014], [-0.4, V_BELT + 0.01]], true, 6);
  const back: V2[] = smooth2([[-0.745, 1.03], [-0.75, 0.8], [-0.8, VK[7] - 0.005], [-1.42, VK[7] - 0.01], [-1.47, 0.86], [-1.48, 1.03]], true, 6);
  // Headlights (top-front corners), front intakes, side vent, taillights (rear view), plate recess.
  const headL: V2[] = smooth2([[2.262, 0.6], [2.242, 0.74], [2.17, 0.75], [1.98, 0.66], [1.8, VK[5] + 0.025], [1.83, VK[5] - 0.012], [2.02, VK[4] + 0.02], [2.2, VK[4] - 0.025], [2.258, 0.47]], true, 5);
  const mouth = S.face(roundPoly([[0, 0.185], [0.4, 0.195], [0.46, 0.29], [0.41, 0.375], [0, 0.39]], [0, 0.07, 0.05, 0.07, 0], 4));
  const corner = S.face(roundPoly([[0.55, 0.25], [0.76, 0.27], [0.75, 0.41], [0.56, 0.4]], 0.035, 4));
  const ventR: V2[] = S.side(roundPoly([[-0.78, 0.6], [-0.98, 0.585], [-1.0, 0.655], [-0.8, 0.688]], 0.03, 4), 0.2, VK[5]);
  const tailO = S.face(ellipse2(0.655, 0.8, 0.098, 0.098, 36), false);
  const tailI = S.face(ellipse2(0.43, 0.805, 0.09, 0.09, 36), false);
  const plate = S.face(roundPoly([[0, 0.45], [0.29, 0.45], [0.29, 0.6], [0, 0.6]], [0, 0.02, 0.02, 0], 3), false);
  const exhCut = S.face(ellipse2(0.52, 0.33, 0.075, 0.05, 24), false);

  const glassAll = [wsh, dlo, back];
  const holes = [archF.exc, archR.exc, ...glassAll, headL, mouth, corner, ventR, tailO, tailI, plate];

  // ---------------- Shell ----------------
  const as = arcSamplesMulti(S, [0.12, 0.36, 0.6, 1], XT, XN, 0.058);
  const bs = runs(span(0, 1, 1 / 40), VK);
  // hood as its own mesh (kit swaps it to carbon): plan outline between the fender shut lines, cowl to the nose
  const hoodPoly: V2[] = [[0.7, V_RAIL - 0.005], [0.7, 1.01], [2.21, 1.01], [2.2, 0.8], [2.16, 0.75], [1.96, V_RAIL + 0.005]];
  A.add('hood', gridGeo(S, { as, bs, inc: [hoodPoly], exc: holes }));
  A.add('paint', gridGeo(S, { as, bs, exc: [...holes, hoodPoly] }));
  // inner skin (seen through the glass): cabin region only, inside-out, dark
  A.add('dash', gridGeo(S, { as: span(-1.5, 0.62, 0.085), bs: span(0.04, 1, 1 / 20), offset: -0.03, inside: true }));

  // ---------------- Shut lines ----------------
  const gap = (path: V2[], closed = false, w = 0.0045) => A.add('gap', ribbon(S, path, { width: w, closed }));
  gap(openPath(hoodPoly, S));
  // doors: front line behind the front arch up to the A-pillar sail, rear line ahead of the rear haunch, sill line
  const doorF: V2[] = S.side([[0.72, 0.2], [0.735, 0.5], [0.66, 0.84]], 0.03, VK[5]).concat([[0.5, V_BELT + 0.004]]);
  const doorR: V2[] = S.side([[-0.46, 0.2], [-0.47, 0.6], [-0.46, 0.89]], 0.03, VK[5] + 0.003);
  gap(doorF);
  gap(doorR);
  gap(S.side([[0.72, 0.2], [-0.46, 0.2]], 0.02, 0.2));
  // bumpers: front bumper to fender (ahead of the arch, up under the headlamp), rear bumper behind the rear arch
  gap(S.side([[1.66, 0.42], [1.74, 0.6], [1.82, 0.68]], 0.03, VK[5] + 0.01));
  gap(S.side([[-1.67, 0.38], [-1.72, 0.55], [-1.76, 0.6]], 0.03, VK[5]));
  // trunk lid: across the base of the backlight, along the deck sides, down to the rear panel above the lamps
  const trunk: V2[] = [[-1.49, 1], [-1.5, 0.83], [-1.56, 0.62], [-1.75, 0.575], [-2.15, 0.575]];
  gap(trunk);
  gap(S.face(span(0, 0.72, 0.03).map((z) => [z, 0.912 - 0.035 * (z / 0.72) ** 2] as V2), false));
  gap(S.face(span(0, 0.84, 0.03).map((z) => [z, 0.62 + 0.02 * (z / 0.84) ** 3] as V2), false));
  // targa roof panel
  A.add('gap', ribbon(S, roundPoly([[-0.2, 0.795], [-0.2, 1.003], [-0.68, 1.003], [-0.68, 0.795]], 0.03, 3), { width: 0.004, closed: true, mirror: true }));

  // ---------------- Glass + seals ----------------
  A.add('glass', patchGeo(S, wsh, { offset: -0.003, step: 0.045 }));
  A.add('glass', patchGeo(S, dlo, { offset: -0.006, step: 0.04 }));
  A.add('glassDark', patchGeo(S, back, { offset: -0.004, step: 0.045 }));
  for (const g of [wsh, back]) A.add('rubber', ribbon(S, openPath(g, S), { width: 0.016, prof: 'round', bump: 0.003 }));
  A.add('rubber', ribbon(S, dlo, { width: 0.016, closed: true, prof: 'round', bump: 0.003 }));
  // B-pillar (black) between door glass and quarter glass
  A.add('gloss', ribbon(S, S.side([[-0.6, 0.93], [-0.62, 1.16]], V_BELT, V_RAIL), { width: 0.045, lift: 0.002 }));
  // A-pillar trim
  A.add('rubber', ribbon(S, [[0.52, V_RAIL + 0.002], [0.1, V_RAIL + 0.002], [-0.2, V_RAIL + 0.002]], { width: 0.03, prof: 'round', bump: 0.004 }));

  // ---------------- Arches ----------------
  for (const ar of [archF, archR]) {
    A.add('liner', ar.liner);
    A.add('paint', ribbon(S, ar.edge, { width: 0.026, prof: 'round', bump: 0.007, shift: 0.006 }));
  }

  // ---------------- Headlights ----------------
  {
    const pk = pocketGeo(S, headL, { depth: 0.06, taper: 0.12 });
    A.add('trim', pk.wall);
    A.add('reflector', pk.back);
    A.add('lensClear', patchGeo(S, headL, { offset: 0.0015, step: 0.03 }));
    A.add('trim', ribbon(S, headL, { width: 0.012, closed: true, prof: 'round', bump: 0.002 }));
    // three round lamps in a row inside the housing (low, high, signal)
    const lamps: [number, number, number][] = [[2.17, 0.66, 0.05], [2.06, 0.62, 0.043], [1.95, 0.585, 0.036]];
    for (const [u, v, r] of lamps) {
      const f = frame(S, u, v);
      const c = f.p.clone().addScaledVector(f.n, -0.035);
      A.add('chrome', withMirror(onSurface(new THREE.CylinderGeometry(r, r * 0.8, 0.04, 24, 1, true).rotateX(Math.PI / 2), c, f.n)));
      A.add('head', withMirror(onSurface(new THREE.CircleGeometry(r * 0.62, 24), c.clone().addScaledVector(f.n, 0.012), f.n)));
      A.add('chrome', withMirror(onSurface(new THREE.TorusGeometry(r * 0.66, 0.004, 4, 20), c.clone().addScaledVector(f.n, 0.013), f.n)));
    }
  }

  // ---------------- Front intakes ----------------
  {
    const pm = pocketGeo(S, mouth, { depth: 0.09, taper: 0.06 });
    A.add('trim', pm.wall);
    A.add('under', pm.back);
    A.add('grille', patchGeo(S, mouth, { offset: -0.03, step: 0.02 }));
    A.add('gloss', ribbon(S, openPath(mouth, S), { width: 0.012, prof: 'round', bump: 0.003 }));
    const pc = pocketGeo(S, corner, { depth: 0.06, taper: 0.08 });
    A.add('trim', pc.wall);
    A.add('under', pc.back);
    A.add('grilleMesh', patchGeo(S, corner, { offset: -0.035, step: 0.02 }));
    // fog lamp in the corner intake + amber side marker
    const fc = frame(S, ...S.endUV(0.655, 0.33, true));
    A.add('chrome', withMirror(onSurface(new THREE.CylinderGeometry(0.038, 0.038, 0.03, 20, 1, true).rotateX(Math.PI / 2), fc.p.clone().addScaledVector(fc.n, -0.03), fc.n)));
    A.add('head', withMirror(onSurface(new THREE.CircleGeometry(0.03, 20), fc.p.clone().addScaledVector(fc.n, -0.016), fc.n)));
    const mk = S.side(roundPoly([[1.9, 0.43], [2.04, 0.425], [2.04, 0.455], [1.9, 0.46]], 0.012, 3), 0.05, VK[4]);
    A.add('amber', patchGeo(S, mk, { offset: 0.002, step: 0.01 }));
    // chin lip
    A.add('gloss', ribbon(S, span(1.95, XN, 0.015).map((u) => [u, 0.014] as V2), { width: 0.024, prof: 'round', bump: 0.006 }));
    // nose emblem
    const nb = frame(S, ...S.endUV(0.002, 0.46, true));
    A.add('chrome', onSurface(new THREE.TorusGeometry(0.03, 0.005, 4, 20).scale(1.4, 1, 1), nb.p.clone().addScaledVector(nb.n, 0.004), nb.n));
  }

  // ---------------- Side details ----------------
  {
    const pv = pocketGeo(S, ventR, { depth: 0.05, taper: 0.25 });
    A.add('trim', pv.wall);
    A.add('under', pv.back);
    A.add('grilleSlats', patchGeo(S, ventR, { offset: -0.02, step: 0.01 }));
    // door handle (flush pull at the rear top of the door)
    const hu = -0.36;
    const hv = S.vAtY(hu, 0.81, 0.2, VK[5]);
    const hf = frame(S, hu, hv);
    A.add('paint', withMirror(onSurface(rbox(0.13, 0.03, 0.022, 0.009).translate(0, 0, 0.004), hf.p, hf.n)));
    A.add('trim', withMirror(onSurface(rbox(0.11, 0.018, 0.01, 0.005), hf.p.clone().addScaledVector(hf.n, -0.002), hf.n)));
    // mirrors on the sail
    const m = mirrorGeos(0.43, 0.9, zBelt(0.43) - 0.01, { len: 0.2, h: 0.1, w: 0.07, out: 0.11, yaw: 0.06 });
    A.add('paint', m.housing);
    A.add('mirror', m.glass);
    A.add('gloss', m.stalk);
    // sill skirt line
    A.add('gloss', ribbon(S, [[0.85, 0.035], [-0.62, 0.035]], { width: 0.02, prof: 'round', bump: 0.004 }));
  }

  // ---------------- Rear: four round lamps, plate, badge, valance ----------------
  {
    for (const [poly, rin] of [
      [tailO, 0.088],
      [tailI, 0.078],
    ] as [V2[], number][]) {
      const pk = pocketGeo(S, poly, { depth: 0.045, taper: 0.1 });
      A.add('trim', pk.wall);
      A.add('tail', pk.back);
      A.add('lensRed', patchGeo(S, poly, { offset: 0.003, step: 0.022 }));
      A.add('chrome', ribbon(S, poly, { width: 0.012, closed: true, prof: 'round', bump: 0.004 }));
      // concentric reflector ring + bright centre
      let cu = 0;
      let cv = 0;
      for (const [u, v] of poly) {
        cu += u / poly.length;
        cv += v / poly.length;
      }
      const f = frame(S, cu, cv);
      A.add('chrome', withMirror(onSurface(new THREE.TorusGeometry(rin * 0.55, 0.005, 4, 24), f.p.clone().addScaledVector(f.n, -0.012), f.n)));
      A.add('tail', withMirror(onSurface(new THREE.CircleGeometry(rin * 0.4, 24), f.p.clone().addScaledVector(f.n, -0.016), f.n)));
    }
    const pp = pocketGeo(S, plate, { depth: 0.025 });
    A.add('paint', pp.wall);
    A.add('trim', pp.back);
    const pf = frame(S, ...S.endUV(0.002, 0.525, false));
    const pl = new THREE.PlaneGeometry(0.52, 0.12);
    A.add('plate', onSurface(pl, pf.p.clone().addScaledVector(pf.n, -0.018), pf.n));
    const bf = frame(S, ...S.endUV(0.002, 0.8, false));
    A.add('badge', onSurface(new THREE.PlaneGeometry(0.24, 0.06), bf.p.clone().addScaledVector(bf.n, 0.003), bf.n));
    const pe = pocketGeo(S, exhCut, { depth: 0.12, mirror: false });
    A.add('under', pe.wall);
    A.add('under', pe.back);
    // lower valance (black) + small diffuser strakes
    A.add('gloss', ribbon(S, S.face(span(0, 0.8, 0.03).map((z) => [z, 0.4 + 0.02 * (z / 0.8) ** 2] as V2), false), { width: 0.012, prof: 'round', bump: 0.004 }));
    const dif: THREE.BufferGeometry[] = [];
    dif.push(place(new THREE.BoxGeometry(0.5, 0.012, 1.3), -1.98, 0.27, 0, 0, 0, 0.12));
    for (const z of [-0.45, -0.15, 0.15, 0.45]) dif.push(place(new THREE.BoxGeometry(0.42, 0.06, 0.01), -2.0, 0.24, z, 0, 0, 0.12));
    A.add('gloss', merge(dif));
  }

  // ---------------- Underbody + firewall ----------------
  A.add('under', floorGeo(span(-2.05, 2.15, 0.1), (x) => yb(x) + 0.012, (x) => {
    const w = side(x) * pEnd(x) - 0.09;
    const nearWheel = Math.abs(x - XF) < 0.45 || Math.abs(x - XR) < 0.45;
    return Math.max(0.1, nearWheel ? Math.min(w, 0.44) : w);
  }));

  // ---------------- Interior ----------------
  {
    const fy = 0.26;
    A.add('carpet', place(rbox(1.7, 0.03, 1.4, 0.01), -0.3, fy, 0));
    for (const z of [-0.37, 0.37]) A.add('seat', seatGeo(-0.22, fy, z, 0.3, 0.5));
    A.add('seat', place(rbox(0.36, 0.12, 1.1, 0.04), -0.86, fy + 0.13, 0));
    A.add('seat', place(rbox(0.1, 0.38, 1.1, 0.04), -1.02, fy + 0.36, 0, 0, 0, 0.25));
    // parcel shelf + rear bulkhead
    A.add('dash', place(rbox(0.5, 0.025, 1.4, 0.01), -1.28, 0.93, 0));
    A.add('dash', place(rbox(0.04, 0.6, 1.4, 0.01), -1.1, 0.6, 0));
    // dashboard: wraps from the windshield base back toward the driver, gauge hood on the driver side
    const dashP: V2[] = [[0.66, 0.84], [0.45, 0.93], [0.24, 0.92], [0.18, 0.84], [0.22, 0.62], [0.45, 0.55], [0.66, 0.6]];
    A.add('dash', slab(dashP, -0.72, 0.72, 0.012));
    A.add('dash', place(rbox(0.16, 0.08, 0.36, 0.03), 0.27, 0.95, -0.37));
    A.add('intTrim', place(rbox(0.012, 0.07, 0.3, 0.004, 1), 0.192, 0.89, -0.37));
    A.add('dash', place(rbox(0.85, 0.24, 0.2, 0.04), -0.05, fy + 0.13, 0));
    A.add('intTrim', place(rbox(0.06, 0.12, 0.12, 0.02), 0.08, 0.5, 0, 0, 0, 0.5));
    A.add('wheel', steeringGeo(vec(0.08, 0.86, -0.37), 0.5, 0.18));
    // wipers parked along the cowl
    for (const [z0, z1] of [[-0.42, 0.08], [0.1, 0.56]]) {
      const pts = [vec(0.62, 0.872, z0), vec(0.6, 0.885, (z0 + z1) / 2), vec(0.585, 0.893, z1)];
      A.add('gloss', tubeGeo(pts, 0.007, 6, 12));
    }
  }

  const body = A.finish();
  body.userData = { belt: 0.89, sill: 0.2, door: [-0.46, 0.72], cowl: 0.62 };

  const v = vec;
  return {
    body,
    dims: { length: XN - XT, width: 1.81, height: 1.275, wheelbase: WB, trackF: TRACK_F, trackR: TRACK_R, wheelR: WR, rideHeight: 0.13 },
    anchors: {
      wheelFL: v(XF, WR, -TRACK_F / 2), wheelFR: v(XF, WR, TRACK_F / 2),
      wheelRL: v(XR, WR, -TRACK_R / 2), wheelRR: v(XR, WR, TRACK_R / 2),
      exhausts: [{ pos: v(XT + 0.06, 0.33, 0.52), dir: v(-1, 0, 0) }],
      hood: v(1.35, yHood(1.35) + 0.002, 0),
      roof: v(-0.48, 1.275, 0),
      deck: v(-1.9, yDeck(-1.9), 0),
      frontBumper: v(XN - 0.04, 0.2, 0),
      seat: v(-0.32, 1.06, -0.37),
      headlights: [v(2.17, 0.62, 0.62), v(2.17, 0.62, -0.62)],
      taillights: [v(-2.16, 0.79, 0.64), v(-2.19, 0.795, 0.43), v(-2.16, 0.79, -0.64), v(-2.19, 0.795, -0.43)],
    },
    paintMeshes: A.paint,
    tailLightMeshes: A.tailLights,
    headLightMeshes: A.headLights,
  };
}
