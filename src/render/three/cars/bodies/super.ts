// 'super' body: the "Viperion", a front-mid V10 track car (after the 5th-gen Dodge Viper ACR). Hand-built in code:
// an extremely long clamshell hood between tall fender humps (central bulge, big twin vents, fender louvres), side gills,
// a cab-rearward double-bubble roof with a bubble hatch, coke-bottle waist into huge haunches, side-exit exhausts in the
// sills ahead of the rear wheels, "snake-eye" headlamps, slim scaled taillights and a big ACR diffuser + splitter.
// The rear wing comes from the kit (deck anchor).
import * as THREE from 'three';
import type { BodyBuild, CarSpec } from '../../types';
import {
  HALF_N, Projector, SEC, V3, band, curve, doorMirror, flipA, greenhouse, grillePatch, interior, lamp, loftBody, makeMats, mesh, patch,
  patchWall, rbox, rect, ribbon, roundPoly, secFrom, sstep, superEllipse, sweep, table, tube, underbody, wellLiner,
  mergeByMaterial, type P2, type Wheel,
} from './_helpersB';

type PN = { p: THREE.Vector3; n: THREE.Vector3 };
const cl = (h: PN): PN => ({ p: h.p.clone(), n: h.n.clone() });

const WB = 2.51;
const XF = 2.185;
const XR = -2.275;
const WR = 0.33;
const TF = 1.59;
const TR = 1.58;

export default function build(spec: CarSpec): BodyBuild {
  const M = makeMats(spec);
  const body = new THREE.Group();
  body.name = 'viperion';
  const paint: THREE.Mesh[] = [];
  const add = (m: THREE.Mesh, isPaint = false) => {
    body.add(m);
    if (isPaint) paint.push(m);
    return m;
  };
  const wheels: Wheel[] = [
    { x: WB / 2, y: 0.335, r: 0.375 },
    { x: -WB / 2, y: 0.335, r: 0.38 },
  ];
  //               yB    tuck   yW    w      yS     wS     r      yT
  const S = table([
    [-2.275, 0.32, 0.06, 0.62, 0.9, 0.95, 0.8, 0.08, 0.972],
    [-1.9, 0.26, 0.07, 0.6, 0.952, 0.958, 0.82, 0.1, 0.978],
    [-1.255, 0.19, 0.08, 0.56, 0.97, 0.945, 0.8, 0.15, 0.965],
    [-0.65, 0.15, 0.08, 0.48, 0.925, 0.855, 0.8, 0.1, 0.9],
    [0.15, 0.15, 0.08, 0.48, 0.93, 0.865, 0.81, 0.1, 0.89],
    [0.8, 0.17, 0.08, 0.52, 0.955, 0.885, 0.79, 0.15, 0.82],
    [1.255, 0.19, 0.07, 0.52, 0.962, 0.87, 0.77, 0.16, 0.765],
    [1.8, 0.19, 0.08, 0.47, 0.93, 0.77, 0.73, 0.15, 0.69],
    [2.185, 0.15, 0.08, 0.4, 0.86, 0.66, 0.66, 0.13, 0.63],
  ]);
  const sec = (x: number) => secFrom(S(x));
  const beltW = (x: number) => {
    const s = sec(x);
    return s.wS - s.r * 0.62;
  };
  const wsBase = (az: number) => 0.01 - 0.13 * (az / 0.72) ** 2;
  const blBase = (az: number) => -1.7 + 0.06 * (az / 0.72) ** 2;
  const lo = loftBody({
    x0: XR,
    x1: XF,
    sec,
    wheels,
    dx: 0.055,
    front: { rx: 0.26, rz: 0.17, ryT: 0.06, ryB: 0.035, yc: 0.4, rake: 0.08, K: 10 },
    rear: { rx: 0.15, rz: 0.1, ryT: 0.02, ryB: 0.07, yc: 0.62, rake: 0.14, K: 8 },
    deform: (p, k, side, x) => {
      const az = Math.abs(p.z);
      if (k >= SEC.topEdge) {
        // central hood bulge running from the cowl to the nose vent
        p.y += 0.055 * band(-0.05, 1.95, 0.25, x) * (1 - sstep(0.17, 0.33, az));
      }
      if (k <= SEC.shoulderLo + 1) {
        // coke-bottle pinch behind the door + a side strake line
        p.z -= side * 0.012 * band(-0.9, 0.5, 0.3, x) * band(0.35, 0.75, 0.1, p.y);
      }
    },
    part: (c, kk) => {
      const az = Math.abs(c.z);
      if (kk >= SEC.shoulder && az < beltW(c.x) - 0.012 && c.x < wsBase(az) - 0.012 && c.x > blBase(az) + 0.012) return null;
      if (kk >= SEC.shoulder && c.x > 0.06 && c.x < 2.06) return 'hood';
      if (kk >= 23 && c.x < -1.75 && c.x > -2.16) return 'trunk';
      return 'body';
    },
  });
  for (const [name, g] of lo.parts) add(mesh(g, M.paint, name), true);
  const bodyGeos = [...lo.parts.values()];

  // ---- greenhouse: raked screen, double-bubble roof, bubble hatch
  const railY = curve([[-1.72, 0.97], [-1.4, 1.065], [-1.12, 1.168], [-0.95, 1.198], [-0.72, 1.2], [-0.42, 1.1], [-0.13, 0.88], [0.02, 0.87]]);
  const railW = curve([[-1.72, 0.74], [-1.2, 0.6], [-0.8, 0.575], [-0.45, 0.61], [-0.13, 0.73], [0.02, 0.74]]);
  const crown = curve([[-1.73, 0.975], [-1.4, 1.1], [-1.1, 1.215], [-0.85, 1.24], [-0.65, 1.232], [-0.35, 1.115], [-0.1, 0.955], [0.02, 0.9]]);
  const belt = (x: number): P2 => {
    const h = lo.at(x, SEC.topEdge - 1, 1);
    return [h.p.y - 0.006, Math.min(h.p.z, beltW(x))];
  };
  const xh = (f: number) => -0.69 + 0.05 * (1 - (1 - f) ** 2);
  const xb = (f: number) => -1.06 - 0.03 * (1 - (1 - f) ** 2);
  const xr = (f: number) => -1.0 + 0.25 * f;
  const gh = greenhouse({
    x0: -1.73,
    x1: 0.02,
    belt,
    rail: (x) => [Math.max(railY(x), belt(x)[0]), x > -0.13 || x < -1.71 ? belt(x)[1] : Math.min(railW(x), belt(x)[1])],
    crown,
    bulge: 0.03,
    rr: 0.06,
    deform: (p, kind, f) => {
      // double bubble: a shallow valley down the roof centreline
      if (kind === 'top') p.y -= 0.022 * band(-1.2, -0.6, 0.15, p.x) * Math.exp(-((p.z / 0.13) ** 2)) * sstep(0.5, 0.9, f);
    },
    part: (c, kind, f) => {
      const x = c.x;
      if (kind === 'top') {
        if (x > xh(f) && f > 0.07) return 'glass';
        if (x < xb(f) && x > -1.66 && f > 0.1) return 'glass';
        return 'roof';
      }
      if (f > 0.1 && f < 0.9 && x < -0.2 && x > xr(f)) return 'glass';
      return 'roof';
    },
  });
  for (const [name, g] of gh.parts) {
    if (name === 'glass') add(mesh(g, M.glass, 'glass'));
    else add(mesh(g, M.paint, 'roof'), true);
  }
  for (const sd of [1, -1]) {
    const at = (x: number, f: number) => cl(gh.at(x, 'side', f, sd));
    const loop: PN[] = [];
    for (let x = -0.21; x >= xr(0.9); x -= 0.02) loop.push(at(x, 0.9));
    for (let f = 0.9; f >= 0.1; f -= 0.05) loop.push(at(xr(f), f));
    for (let x = xr(0.1); x <= -0.21; x += 0.02) loop.push(at(x, 0.1));
    for (let f = 0.1; f <= 0.9; f += 0.05) loop.push(at(-0.205, f));
    add(mesh(ribbon(loop, 0.022, 0.003), M.gloss, 'dloTrim'));
    const ap: PN[] = [];
    for (let x = -0.66; x <= -0.02; x += 0.02) ap.push(cl(gh.at(x, 'top', 0.07, sd)));
    add(mesh(ribbon(ap, 0.03, 0.002), M.gloss, 'frit'));
    const bl: PN[] = [];
    for (let x = xb(0.1); x >= -1.66; x -= 0.02) bl.push(cl(gh.at(x, 'top', 0.1, sd)));
    add(mesh(ribbon(bl, 0.03, 0.002), M.gloss, 'frit'));
  }
  const across = (fx: (f: number) => number, w: number) => {
    const pts: PN[] = [];
    for (let f = 0.07; f <= 1.0001; f += 0.05) pts.push(cl(gh.at(fx(f), 'top', f, -1)));
    for (let f = 1; f >= 0.07; f -= 0.05) pts.push(cl(gh.at(fx(f), 'top', f, 1)));
    return mesh(ribbon(pts, w, 0.002), M.gloss, 'frit');
  };
  add(across(xh, 0.045));
  add(across(xb, 0.035));
  add(across(() => -1.65, 0.035));
  const cowl: THREE.Vector3[] = [];
  for (let z = -0.7; z <= 0.7001; z += 0.05) cowl.push(V3(wsBase(Math.abs(z)) + 0.004, 0.885 + 0.012 * (1 - (z / 0.72) ** 2), z));
  add(mesh(tube(cowl, 0.012, 6), M.trim, 'cowl'));
  const pG = new Projector([gh.parts.get('glass')!], 'y');
  for (const z0 of [0.05, -0.6]) {
    const w: THREE.Vector3[] = [];
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const h = pG.hit(-0.06 - t * 0.12, z0 + t * 0.5);
      if (h) w.push(h.p.addScaledVector(h.n, 0.012));
    }
    if (w.length > 2) add(mesh(tube(w, 0.007, 5), M.trim, 'wiper'));
  }

  const pF = new Projector(bodyGeos, 'x');
  const pR = new Projector(bodyGeos, '-x');
  const pL = new Projector(bodyGeos, 'z');
  const pRt = new Projector(bodyGeos, '-z');
  const pT = new Projector(bodyGeos, 'y');

  // ---- nose: wide central mouth, corner intakes, snake-eye lamps, ACR splitter + dive planes
  const mouth = roundPoly([[-0.44, 0.47], [0.44, 0.47], [0.5, 0.36], [0.4, 0.26], [-0.4, 0.26], [-0.5, 0.36]], [0.05, 0.05, 0.06, 0.06, 0.06, 0.06]);
  grillePatch(pF, M, mouth, { cell: 0.026, pattern: 'honeycomb', off: 0.004 }).forEach((m) => add(m));
  add(mesh(patchWall(pF, mouth, 0.0, 0.016), M.gloss, 'mouthWall'));
  add(mesh(patch(pF, superEllipse(0, 0.505, 0.06, 0.022, 2.5, 24), { off: 0.006, res: 0.01 }), M.badge('VIPERION', '#c9ccd4'), 'badge'));
  const heads: THREE.Mesh[] = [];
  for (const sd of [1, -1]) {
    const o = (pts: P2[]): P2[] => (sd > 0 ? pts : flipA(pts));
    const side = o(roundPoly([[0.56, 0.36], [0.8, 0.36], [0.76, 0.24], [0.6, 0.24]], 0.03));
    grillePatch(pF, M, side, { cell: 0.022 }).forEach((m) => add(m));
    const outline = o(roundPoly([[0.48, 0.55], [0.62, 0.62], [0.83, 0.6], [0.88, 0.53], [0.7, 0.5], [0.55, 0.5]], [0.03, 0.05, 0.04, 0.03, 0.04, 0.03]));
    const parts = lamp(pF, M, outline, {
      depth: 0.012,
      inner: [
        { outline: o(superEllipse(0.66, 0.565, 0.035, 0.028, 2.2, 24)), mat: M.reflector, off: 0.004 },
        { outline: o(superEllipse(0.66, 0.565, 0.022, 0.018, 2.2, 20)), mat: M.head, off: 0.007 },
        { outline: o(superEllipse(0.76, 0.56, 0.03, 0.024, 2.2, 20)), mat: M.reflector, off: 0.004 },
        { outline: o(roundPoly([[0.52, 0.515], [0.86, 0.535], [0.86, 0.545], [0.53, 0.528]], 0.005)), mat: M.drl, off: 0.006 },
      ],
    });
    parts.forEach((m) => add(m));
    heads.push(parts[2]);
    // dive planes on the bumper corners
    for (const [y, len] of [[0.3, 0.12], [0.21, 0.15]] as [number, number][]) {
      const h = pF.hit(0.86 * sd, y);
      const x = h ? h.p.x : XF - 0.2;
      const dp = mesh(new THREE.BoxGeometry(len, 0.008, 0.16), M.carbon, 'canard');
      dp.position.set(x + len * 0.25, y, 0.83 * sd);
      dp.rotation.set(0, -0.35 * sd, -0.12);
      add(dp);
    }
  }
  const sp: THREE.Vector3[] = [];
  for (let z = -0.92; z <= 0.9201; z += 0.04) {
    const h = pF.hit(z * 0.97, 0.2);
    // follow the nose plan; past the nose corners the hit lands far back on the sides, so clamp to the nose zone
    sp.push(V3(Math.max(h ? h.p.x : XF, XF - 0.3) - 0.06, 0.135, z));
  }
  add(mesh(sweep(sp, [[0, 0.012], [0.13, 0.0], [0.13, -0.012], [-0.1, -0.012], [-0.1, 0.012]], { caps: true }), M.trim, 'splitter'));
  for (const sd of [1, -1]) {
    const ep = mesh(new THREE.BoxGeometry(0.22, 0.07, 0.01), M.carbon, 'splitterEnd');
    ep.position.set(XF - 0.06, 0.155, 0.92 * sd);
    add(ep);
  }

  // ---- hood: nose vent, twin vents ahead of the screen, fender louvres
  const vent = (out: P2[], cell: number, pat = 'slats') => {
    grillePatch(pT, M, out, { cell, pattern: pat, off: 0.002, res: 0.02 }).forEach((m) => add(m));
    add(mesh(patchWall(pT, out, 0.0, 0.01), M.gloss, 'ventLip'));
  };
  vent(roundPoly([[1.5, -0.17], [1.82, -0.13], [1.82, 0.13], [1.5, 0.17]], 0.04), 0.03);
  for (const sd of [1, -1]) {
    vent(roundPoly([[0.35, 0.2 * sd], [0.95, 0.19 * sd], [0.9, 0.42 * sd], [0.38, 0.44 * sd]], 0.05), 0.03, 'honeycomb');
    vent(roundPoly([[1.05, 0.56 * sd], [1.42, 0.55 * sd], [1.4, 0.74 * sd], [1.08, 0.75 * sd]], 0.03), 0.028);
  }

  // ---- sides: gills, sill side-exits + heat shields, door handle, mirrors
  const exhausts: { pos: THREE.Vector3; dir: THREE.Vector3 }[] = [];
  for (const [pr, sd] of [[pL, 1], [pRt, -1]] as [Projector, number][]) {
    const o = (pts: P2[]) => pts;
    const gill = o(roundPoly([[0.62, 0.42], [0.86, 0.47], [0.86, 0.7], [0.7, 0.66]], 0.03));
    grillePatch(pr, M, gill, { cell: 0.03, pattern: 'slats', off: 0.003, res: 0.02 }).forEach((m) => add(m));
    add(mesh(patchWall(pr, gill, 0.0, 0.012), M.gloss, 'gillLip'));
    // sill: carbon rocker with a brushed heat shield over the side exits
    add(mesh(patch(pr, roundPoly([[-0.86, 0.17], [0.85, 0.17], [0.87, 0.23], [-0.86, 0.25]], 0.02), { off: 0.003, res: 0.04 }), M.carbon, 'rocker'));
    const shield = roundPoly([[-1.0, 0.2], [-0.42, 0.2], [-0.4, 0.34], [-0.98, 0.36]], 0.03);
    add(mesh(patch(pr, shield, { off: 0.006, res: 0.02 }), M.metal, 'heatShield'));
    add(mesh(patchWall(pr, shield, 0.0, 0.006), M.trim, 'shieldEdge'));
    for (let i = 0; i < 9; i++) {
      const x = -0.95 + i * 0.06;
      add(mesh(patch(pr, superEllipse(x, 0.29, 0.012, 0.025, 2.5, 12), { off: 0.0075, res: 0.01 }), M.liner, 'shieldSlot'));
    }
    for (const x of [-0.84, -0.74]) {
      const h = pr.hit(x, 0.24);
      if (!h) continue;
      const cut = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 20), M.liner, 'sideExit');
      cut.position.copy(h.p).addScaledVector(h.n, 0.004);
      cut.quaternion.setFromUnitVectors(V3(0, 1, 0), h.n);
      add(cut);
      exhausts.push({ pos: h.p.clone().addScaledVector(h.n, 0.012), dir: V3(-0.3, 0, sd).normalize() });
    }
    const hp = pr.hit(-0.62, 0.78);
    if (hp) {
      add(mesh(patch(pr, superEllipse(-0.62, 0.78, 0.07, 0.022, 3, 20), { off: 0.0015, res: 0.02 }), M.trim, 'handlePocket'));
      const hd = mesh(rbox(0.12, 0.024, 0.025, 0.01), M.paint, 'handle');
      hd.position.copy(hp.p).addScaledVector(hp.n, 0.006);
      add(hd, true);
    }
    add(mesh(patch(pr, superEllipse(1.88, 0.55, 0.035, 0.012, 3, 16), { off: 0.003, res: 0.01 }), M.amber, 'marker'));
    const m = doorMirror(M, V3(-0.2, 0.92, 0.76), { len: 0.2, h: 0.11, reach: 0.16 });
    if (sd < 0) m.scale.z = -1;
    body.add(m);
    m.traverse((c) => {
      if ((c as THREE.Mesh).isMesh && c.name === 'mirror') paint.push(c as THREE.Mesh);
    });
  }

  // ---- tail: slim scaled taillights, plate, ACR diffuser
  const tails: THREE.Mesh[] = [];
  for (const sd of [1, -1]) {
    const o = (pts: P2[]): P2[] => (sd > 0 ? pts : flipA(pts));
    const outline = o(roundPoly([[0.42, 0.82], [0.86, 0.85], [0.9, 0.8], [0.84, 0.77], [0.44, 0.785]], [0.02, 0.03, 0.03, 0.03, 0.02]));
    const scales: { outline: P2[]; mat: THREE.Material; off?: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const z = 0.47 + i * 0.058;
      scales.push({ outline: o(roundPoly([[z, 0.79 + i * 0.002], [z + 0.045, 0.792 + i * 0.002], [z + 0.05, 0.828 + i * 0.002], [z + 0.006, 0.826 + i * 0.002]], 0.008)), mat: M.tail, off: 0.005 });
    }
    const parts = lamp(pR, M, outline, { lens: M.lensRed, depth: 0.012, inner: scales });
    parts.forEach((m) => add(m));
    for (let i = 1; i <= 7; i++) tails.push(parts[i]);
  }
  add(mesh(patch(pR, rect(-0.1, 0.8, 0.1, 0.83, 0.01), { off: 0.006, res: 0.01 }), M.badge('VIPERION', '#c9ccd4'), 'rearBadge'));
  add(mesh(patch(pR, rect(-0.29, 0.5, 0.29, 0.67, 0.03), { off: 0.002, res: 0.03 }), M.trim, 'plateRecess'));
  add(mesh(patch(pR, rect(-0.26, 0.52, 0.26, 0.65, 0.01), { off: 0.005, res: 0.04 }), M.plate('VPR ACR'), 'plate'));
  add(mesh(patch(pR, roundPoly([[-0.86, 0.46], [0.86, 0.46], [0.82, 0.33], [-0.82, 0.33]], 0.03), { off: 0.003, res: 0.03 }), M.carbon, 'rearValance'));
  const dif = new THREE.Group();
  const plate = mesh(new THREE.BoxGeometry(0.75, 0.02, 1.5), M.carbon, 'diffuser');
  plate.position.set(XR + 0.42, 0.22, 0);
  plate.rotation.z = -0.27;
  dif.add(plate);
  for (const z of [-0.6, -0.36, -0.12, 0.12, 0.36, 0.6]) {
    const fin = mesh(new THREE.BoxGeometry(0.66, 0.15, 0.012), M.carbon, 'diffFin');
    fin.position.set(XR + 0.4, 0.21, z);
    fin.rotation.z = -0.27;
    dif.add(fin);
  }
  body.add(dif);

  // ---- shut lines
  const shut = (pts: PN[]) => add(mesh(ribbon(pts, 0.0045, 0.0012), M.shut, 'shut'));
  for (const sd of [1, -1]) {
    const col = (x: number, k0: number, k1: number) => {
      const r: PN[] = [];
      for (let k = k0; k <= k1 + 1e-6; k += 0.5) r.push(cl(lo.at(x, k, sd)));
      return r;
    };
    const row = (k: number, x0: number, x1: number) => {
      const r: PN[] = [];
      for (let x = x0; x <= x1 + 1e-6; x += 0.02) r.push(cl(lo.at(x, k, sd)));
      return r;
    };
    shut(col(0.42, 4, SEC.shoulder - 0.5));
    shut(col(-0.98, 4, SEC.shoulder - 0.5));
    shut(row(4, -0.98, 0.42));
    shut(row(SEC.shoulder, 0.06, 2.06));
    shut(row(23, -2.16, -1.75));
    shut(col(1.95, 4, 13));
  }
  const acrossTop = (x: number, k0: number) => {
    const r: PN[] = [];
    for (let k = k0; k <= HALF_N - 1; k += 0.5) r.push(cl(lo.at(x, k, -1)));
    for (let k = HALF_N - 1; k >= k0; k -= 0.5) r.push(cl(lo.at(x, k, 1)));
    return r;
  };
  shut(acrossTop(0.06, SEC.shoulder));
  shut(acrossTop(2.06, SEC.shoulder));
  shut(acrossTop(-1.75, 23));
  shut(acrossTop(-2.16, 23));

  for (const w of wheels)
    for (const sd of [1, -1]) wellLiner(w.x, w.y, w.r - 0.012, sd * 0.5, sd * 0.98, M.liner).forEach((m) => body.add(m));
  body.add(underbody(M, -1.6, 1.5, 0.78, 0.19));
  body.add(interior(M, { xDash: -0.05, xSeat: -0.9, floorY: 0.2, beltY: 0.86, halfW: 0.68, xRearWall: -1.3 }));

  body.userData = { belt: 0.87, sill: 0.25, door: [-0.98, 0.42], cowl: 0.0 };
  const hood = paint.find((m) => m.name === 'hood')!;
  const paintMeshes = mergeByMaterial(body, paint, [hood, ...heads, ...tails]);
  const hoodY = lo.at(1.2, HALF_N - 1, 1).p.y;
  return {
    body,
    dims: { length: XF - XR, width: 1.94, height: 1.25, wheelbase: WB, trackF: TF, trackR: TR, wheelR: WR, rideHeight: 0.1 },
    anchors: {
      wheelFL: V3(WB / 2, WR, TF / 2),
      wheelFR: V3(WB / 2, WR, -TF / 2),
      wheelRL: V3(-WB / 2, WR, TR / 2),
      wheelRR: V3(-WB / 2, WR, -TR / 2),
      exhausts,
      hood: V3(1.2, hoodY, 0),
      roof: V3(-0.8, 1.24, 0),
      deck: V3(-2.0, 0.98, 0),
      frontBumper: V3(XF - 0.04, 0.2, 0),
      seat: V3(-1.0, 1.04, -0.36),
      headlights: [V3(2.02, 0.56, 0.68), V3(2.02, 0.56, -0.68)],
      taillights: [V3(-2.26, 0.81, 0.66), V3(-2.26, 0.81, -0.66)],
    },
    paintMeshes,
    tailLightMeshes: tails,
    headLightMeshes: heads,
  };
}
