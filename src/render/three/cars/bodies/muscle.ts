// 'muscle' body: the "Stallion", a modern pony-car fastback (after the S550 Mustang GT). Hand-built in code:
// long hood with a power dome + twin vents, shark-nose trapezoid grille, swept tri-slash headlamps, fastback roof with
// wide sail panels, sculpted doors into muscular rear haunches, tri-bar taillights, quad-exit diffuser.
import * as THREE from 'three';
import type { BodyBuild, CarSpec } from '../../types';
import {
  HALF_N, Projector, SEC, V3, addPair, band, curve, doorMirror, greenhouse, interior, lamp, loftBody, makeMats, mesh, patch,
  patchWall, ribbon, rbox, secFrom, sstep, superEllipse, sweep, table, tube, underbody, wellLiner, roundPoly, rect, flipA, grillePatch, mergeByMaterial,
  type P2, type Wheel,
} from './_helpersB';

const WB = 2.72;
const XF = 2.29;
const XR = -2.5;
const WR = 0.355; // 20in wheels (255/40R20)
const TF = 1.6;
const TR = 1.64;

export default function build(spec: CarSpec): BodyBuild {
  const M = makeMats(spec);
  const body = new THREE.Group();
  body.name = 'stallion';
  const paint: THREE.Mesh[] = [];
  const add = (m: THREE.Mesh, isPaint = false) => {
    body.add(m);
    if (isPaint) paint.push(m);
    return m;
  };
  const wheels: Wheel[] = [
    { x: WB / 2, y: 0.35, r: 0.385 },
    { x: -WB / 2, y: 0.35, r: 0.388 },
  ];
  //               yB    tuck   yW    w      yS     wS     r      yT
  const S = table([
    [-2.5, 0.32, 0.06, 0.7, 0.92, 1.07, 0.83, 0.06, 1.085],
    [-2.15, 0.26, 0.07, 0.66, 0.952, 1.065, 0.8, 0.09, 1.075],
    [-1.36, 0.19, 0.08, 0.62, 0.958, 1.04, 0.79, 0.075, 1.02],
    [-0.7, 0.18, 0.08, 0.56, 0.93, 0.965, 0.8, 0.09, 0.96],
    [0.3, 0.18, 0.08, 0.56, 0.925, 0.945, 0.81, 0.08, 0.955],
    [0.95, 0.2, 0.075, 0.58, 0.93, 0.935, 0.83, 0.07, 0.955],
    [1.36, 0.22, 0.06, 0.6, 0.94, 0.915, 0.83, 0.065, 0.935],
    [1.9, 0.24, 0.07, 0.6, 0.93, 0.895, 0.81, 0.065, 0.91],
    [2.29, 0.25, 0.08, 0.58, 0.89, 0.875, 0.76, 0.065, 0.89],
  ]);
  const sec = (x: number) => secFrom(S(x));
  const beltW = (x: number) => {
    const s = sec(x);
    return s.wS - s.r * 0.62;
  };
  // greenhouse base curves (plan view)
  const wsBase = (az: number) => 0.86 - 0.14 * (az / 0.74) ** 2;
  const blBase = (az: number) => -2.13 + 0.08 * (az / 0.74) ** 2;

  const lo = loftBody({
    x0: XR,
    x1: XF,
    sec,
    wheels,
    front: { rx: 0.2, rz: 0.15, ryT: 0.03, ryB: 0.06, yc: 0.6, rake: 0.3, K: 10 },
    rear: { rx: 0.15, rz: 0.1, ryT: 0.03, ryB: 0.07, yc: 0.72, rake: 0.1, K: 8 },
    deform: (p, k, side, x) => {
      const az = Math.abs(p.z);
      if (k <= SEC.shoulderLo + 1) {
        // door sculpt: a concave scoop below the shoulder that sweeps up into the rear haunch
        // the scoop sculpt: a concave band that sweeps up from the front door into the rear haunch, crisp top edge
        const yc = 0.56 + 0.22 * sstep(0.5, -0.95, x);
        const s = band(-1.0, 0.75, 0.2, x) * band(yc - 0.12, yc + 0.07, 0.02, p.y) * (0.4 + 0.6 * sstep(yc - 0.16, yc + 0.06, p.y));
        p.z -= side * 0.022 * s;
        // haunch bulge over the rear wheel
        const h = Math.exp(-(((x + 1.36) / 0.58) ** 2)) * band(0.42, 1.04, 0.12, p.y);
        p.z += side * 0.032 * h;
      }
      if (k >= SEC.topEdge) {
        // hood power dome (raised centre) fading toward the nose
        const d = band(0.95, 2.05, 0.18, x) * (1 - sstep(0.2, 0.36, az));
        p.y += 0.034 * d;
      }
    },
    part: (c, kk) => {
      const az = Math.abs(c.z);
      if (kk >= SEC.shoulder && az < beltW(c.x) - 0.012 && c.x < wsBase(az) - 0.015 && c.x > blBase(az) + 0.015) return null;
      if (kk >= 23 && c.x > 0.93 && c.x < 2.2) return 'hood';
      if (kk >= 23 && c.x < -2.16 && c.x > -2.43) return 'trunk';
      return 'body';
    },
  });
  for (const [name, g] of lo.parts) add(mesh(g, M.paint, name), true);
  const bodyGeos = [...lo.parts.values()];

  // ---- greenhouse
  const railY = curve([[-2.15, 1.06], [-1.7, 1.135], [-1.2, 1.22], [-0.7, 1.29], [-0.3, 1.322], [0.0, 1.31], [0.35, 1.17], [0.72, 0.96], [0.9, 0.95]]);
  const railW = curve([[-2.15, 0.72], [-1.4, 0.665], [-0.7, 0.625], [0.05, 0.615], [0.4, 0.665], [0.72, 0.735], [0.9, 0.74]]);
  const crown = curve([[-2.15, 1.065], [-1.8, 1.14], [-1.3, 1.245], [-0.8, 1.34], [-0.35, 1.38], [0.0, 1.37], [0.4, 1.2], [0.7, 1.045], [0.88, 0.968]]);
  const belt = (x: number): P2 => {
    const h = lo.at(x, SEC.topEdge - 1, 1);
    return [h.p.y - 0.006, Math.min(h.p.z, beltW(x))];
  };
  const xh = (f: number) => 0.03 + 0.07 * (1 - (1 - f) ** 2); // windshield header
  const xb = (f: number) => -0.66 - 0.06 * (1 - (1 - f) ** 2); // backlight top
  const xr = (f: number) => -1.36 + 0.6 * f; // long quarter glass tapering to a point toward the fastback
  const gh = greenhouse({
    x0: -2.15,
    x1: 0.88,
    belt,
    rail: (x) => [Math.max(railY(x), belt(x)[0]), x > 0.72 || x < -2.13 ? belt(x)[1] : Math.min(railW(x), belt(x)[1])],
    crown,
    bulge: 0.025,
    rr: 0.05,
    part: (c, kind, f) => {
      const x = c.x;
      if (kind === 'top') {
        if (x > xh(f) && f > 0.07) return 'glass';
        if (x < xb(f) && x > -1.98 && f > 0.17) return 'glass';
        return 'roof';
      }
      if (f > 0.1 && f < 0.9 && x < 0.66 && x > xr(f)) return x > -0.475 && x < -0.44 ? 'bpillar' : 'glass';
      return 'roof';
    },
  });
  for (const [name, g] of gh.parts) {
    if (name === 'glass') add(mesh(g, M.glass, 'glass'));
    else if (name === 'bpillar') add(mesh(g, M.gloss, 'bpillar'));
    else add(mesh(g, M.paint, 'roof'), true);
  }
  // window trims (gloss black) around the side DLO, windshield and backlight
  for (const sd of [1, -1]) {
    const loop: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
    const at = (x: number, f: number) => {
      const h = gh.at(x, 'side', f, sd);
      return { p: h.p.clone(), n: h.n.clone() };
    };
    for (let x = 0.65; x >= xr(0.9); x -= 0.02) loop.push(at(x, 0.9));
    for (let f = 0.9; f >= 0.1; f -= 0.05) loop.push(at(xr(f), f));
    for (let x = xr(0.1); x <= 0.65; x += 0.02) loop.push(at(x, 0.1));
    add(mesh(ribbon(loop, 0.022, 0.003), M.gloss, 'dloTrim'));
    const fr: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
    for (let f = 0.1; f <= 0.9; f += 0.05) fr.push(at(0.655, f));
    add(mesh(ribbon(fr, 0.02, 0.003), M.gloss, 'dloTrim'));
    // windshield side frit along the A-pillar
    const ap: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
    for (let x = 0.06; x <= 0.84; x += 0.02) {
      const h = gh.at(x, 'top', 0.07, sd);
      ap.push({ p: h.p.clone(), n: h.n.clone() });
    }
    add(mesh(ribbon(ap, 0.03, 0.002), M.gloss, 'frit'));
    // backlight side edge
    const bl: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
    for (let x = xb(0.17); x >= -1.98; x -= 0.02) {
      const h = gh.at(x, 'top', 0.17, sd);
      bl.push({ p: h.p.clone(), n: h.n.clone() });
    }
    add(mesh(ribbon(bl, 0.025, 0.002), M.gloss, 'frit'));
  }
  const across = (fx: (f: number) => number, w: number) => {
    const pts: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
    for (let f = 0.07; f <= 1.0001; f += 0.05) pts.push(clonePN(gh.at(fx(f), 'top', f, -1)));
    for (let f = 1; f >= 0.07; f -= 0.05) pts.push(clonePN(gh.at(fx(f), 'top', f, 1)));
    return mesh(ribbon(pts, w, 0.002), M.gloss, 'frit');
  };
  add(across(xh, 0.04));
  add(across(xb, 0.03));
  add(across(() => -1.97, 0.03));
  // cowl + wipers
  const cowl: THREE.Vector3[] = [];
  for (let z = -0.7; z <= 0.7; z += 0.05) cowl.push(V3(wsBase(Math.abs(z)) + 0.005, 0.958 + 0.01 * (1 - (z / 0.74) ** 2), z));
  add(mesh(tube(cowl, 0.012, 6), M.trim, 'cowl'));
  const pG = new Projector([gh.parts.get('glass')!], 'y');
  for (const z0 of [0.04, -0.64]) {
    const w: THREE.Vector3[] = [];
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const x = 0.79 - t * 0.1;
      const z = z0 + t * 0.56;
      const h = pG.hit(x, z);
      if (h) w.push(h.p.addScaledVector(h.n, 0.012));
    }
    if (w.length > 2) add(mesh(tube(w, 0.007, 5), M.trim, 'wiper'));
  }

  // ---- projectors for details
  const pF = new Projector(bodyGeos, 'x');
  const pR = new Projector(bodyGeos, '-x');
  const pL = new Projector(bodyGeos, 'z');
  const pT = new Projector(bodyGeos, 'y');
  const pRt = new Projector(bodyGeos, '-z');

  // ---- front fascia: shark-nose trapezoid grille, lower intake, lamps
  const grille = roundPoly([[-0.6, 0.8], [0.6, 0.8], [0.64, 0.75], [0.47, 0.47], [-0.47, 0.47], [-0.64, 0.75]], [0.03, 0.03, 0.05, 0.06, 0.06, 0.05]);
  grillePatch(pF, M, grille, { cell: 0.026, off: 0.004 }).forEach((m) => add(m));
  add(mesh(patchWall(pF, grille, 0.0, 0.014), M.gloss, 'grilleSurround'));
  const lower = roundPoly([[-0.68, 0.45], [0.68, 0.45], [0.74, 0.36], [0.62, 0.32], [-0.62, 0.32], [-0.74, 0.36]], 0.025);
  grillePatch(pF, M, lower, { cell: 0.024 }).forEach((m) => add(m));
  add(mesh(patchWall(pF, lower, 0.0, 0.01), M.gloss, 'intakeSurround'));
  add(mesh(patch(pF, rect(-0.1, 0.625, 0.1, 0.67, 0.02), { off: 0.016, res: 0.01 }), M.badge('STALLION', '#c9ccd4'), 'badge'));
  const heads: THREE.Mesh[] = [];
  for (const sd of [1, -1]) {
    const o = (pts: P2[]): P2[] => (sd > 0 ? pts : flipA(pts));
    const outline = o(roundPoly([[0.6, 0.805], [0.64, 0.85], [0.87, 0.85], [0.905, 0.8], [0.78, 0.772], [0.66, 0.77]], [0.02, 0.03, 0.03, 0.02, 0.04, 0.02]));
    const proj = o(superEllipse(0.81, 0.818, 0.026, 0.02, 2.4, 24));
    const projRing = o(superEllipse(0.81, 0.818, 0.034, 0.025, 2.4, 24));
    const slash = (z: number): P2[] => o([[z, 0.778], [z + 0.014, 0.776], [z + 0.028, 0.828], [z + 0.014, 0.83]]);
    const parts = lamp(pF, M, outline, {
      depth: 0.012,
      inner: [
        { outline: projRing, mat: M.reflector, off: 0.004 },
        { outline: proj, mat: M.head, off: 0.007 },
        { outline: slash(0.655), mat: M.drl, off: 0.005 },
        { outline: slash(0.69), mat: M.drl, off: 0.005 },
        { outline: slash(0.725), mat: M.drl, off: 0.005 },
        { outline: o(superEllipse(0.865, 0.818, 0.02, 0.016, 3, 20)), mat: M.reflector, off: 0.004 },
      ],
    });
    parts.forEach((m) => add(m));
    heads.push(parts[2]);
    const fog = o(superEllipse(0.79, 0.4, 0.03, 0.02, 2.6, 20));
    add(mesh(patch(pF, fog, { off: 0.007, res: 0.01 }), M.drl, 'fog'));
  }
  // chin splitter lip
  const chin: THREE.Vector3[] = [];
  for (let z = -0.82; z <= 0.8201; z += 0.04) {
    const h = pF.hit(z, 0.34);
    chin.push(V3(Math.max(h ? h.p.x : XF, XF - 0.3) + 0.005, 0.3, z));
  }
  const lip = mesh(tube(chin, 0.024, 6), M.trim, 'chin');
  lip.scale.set(1, 0.45, 1);
  lip.position.y = 0.3 - 0.3 * 0.45;
  add(lip);

  // ---- hood vents (GT heat extractors)
  for (const sd of [1, -1]) {
    const v = roundPoly([[1.6, 0.2 * sd], [1.86, 0.17 * sd], [1.88, 0.37 * sd], [1.62, 0.41 * sd]], 0.03);
    grillePatch(pT, M, v, { cell: 0.03, pattern: 'slats', off: 0.002, res: 0.02 }).forEach((m) => add(m));
    add(mesh(patchWall(pT, v, 0.0, 0.008), M.gloss, 'hoodVentLip'));
  }

  // ---- rear fascia: tri-bar lamps, black panel, plate, diffuser with quad cut-outs
  const tails: THREE.Mesh[] = [];
  for (const sd of [1, -1]) {
    const o = (pts: P2[]): P2[] => (sd > 0 ? pts : flipA(pts));
    const outline = o(roundPoly([[0.43, 0.85], [0.44, 1.0], [0.8, 1.005], [0.865, 0.95], [0.84, 0.85]], [0.02, 0.02, 0.05, 0.03, 0.02]));
    const bars: { outline: P2[]; mat: THREE.Material; off?: number }[] = [];
    for (let b = 0; b < 3; b++) {
      const z = 0.47 + b * 0.12;
      bars.push({ outline: o(roundPoly([[z, 0.862], [z + 0.07, 0.862], [z + 0.08, 0.99], [z + 0.01, 0.99]], 0.014)), mat: M.tail, off: 0.006 });
    }
    const parts = lamp(pR, M, outline, { lens: M.lensRed, depth: 0.012, inner: bars });
    parts.forEach((m) => add(m));
    for (let b = 1; b <= 3; b++) tails.push(parts[b]);
  }
  // full-width gloss black tail panel the lamps sit in
  const panel = rect(-0.885, 0.835, 0.885, 1.02, 0.04);
  add(mesh(patch(pR, panel, { off: 0.0008, res: 0.03 }), M.gloss, 'tailPanel'));
  add(mesh(patch(pR, superEllipse(0, 0.93, 0.05, 0.05, 2, 24), { off: 0.006, res: 0.01 }), M.chrome, 'fuelBadge'));
  const plate = rect(-0.26, 0.58, 0.26, 0.71, 0.01);
  add(mesh(patch(pR, rect(-0.29, 0.56, 0.29, 0.73, 0.03), { off: 0.002, res: 0.03 }), M.trim, 'plateRecess'));
  add(mesh(patch(pR, plate, { off: 0.005, res: 0.04 }), M.plate('STLN GT'), 'plate'));
  // decklid lip spoiler (the chopped, ducktail-ish tail)
  const spl: THREE.Vector3[] = [];
  for (let z = -0.78; z <= 0.7801; z += 0.04) {
    const h = pT.hit(XR + 0.07, z);
    spl.push(V3(XR + 0.06, (h ? h.p.y : 1.07) + 0.003, z));
  }
  add(mesh(sweep(spl, [[0.03, 0], [-0.005, 0.026], [-0.03, 0.008], [-0.03, -0.004], [0.03, -0.004]], { caps: true }), M.paint, 'spoilerLip'), true);
  // diffuser below the bumper
  const dif = new THREE.Group();
  const dpl = mesh(new THREE.BoxGeometry(0.36, 0.025, 1.62), M.liner, 'diffuser');
  dpl.position.set(XR + 0.24, 0.27, 0);
  dpl.rotation.z = -0.32;
  dif.add(dpl);
  for (const z of [-0.36, -0.12, 0.12, 0.36]) {
    const fin = mesh(new THREE.BoxGeometry(0.3, 0.08, 0.012), M.liner, 'fin');
    fin.position.set(XR + 0.24, 0.25, z);
    dif.add(fin);
  }
  const exhausts: { pos: THREE.Vector3; dir: THREE.Vector3 }[] = [];
  for (const sd of [1, -1])
    for (const z of [0.5, 0.65]) {
      const cut = mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.08, 20), M.liner, 'exhaustCut');
      cut.rotation.z = Math.PI / 2;
      cut.position.set(XR + 0.1, 0.3, z * sd);
      cut.scale.set(1, 1, 0.8);
      dif.add(cut);
      exhausts.push({ pos: V3(XR + 0.08, 0.3, z * sd), dir: V3(-1, 0, 0) });
    }
  const valance = mesh(rbox(0.12, 0.13, 1.66, 0.04), M.trim, 'valance');
  valance.position.set(XR + 0.13, 0.33, 0);
  dif.add(valance);
  body.add(dif);

  // ---- sides: rockers, mirrors, handles, shut lines, liners
  for (const [pr, sd] of [[pL, 1], [pRt, -1]] as [Projector, number][]) {
    const rock = roundPoly([[-0.98, 0.205], [0.98, 0.205], [1.0, 0.255], [-0.98, 0.27]], 0.02);
    add(mesh(patch(pr, rock, { off: 0.003, res: 0.04 }), M.gloss, 'rocker'));
    const hd = mesh(rbox(0.14, 0.028, 0.03, 0.012), M.paint, 'handle');
    const h = pr.hit(-0.34, 0.885);
    if (h) {
      hd.position.copy(h.p).addScaledVector(h.n, 0.006);
      hd.lookAt(hd.position.clone().add(h.n));
      hd.rotateY(Math.PI / 2);
      add(hd, true);
      const pocket = mesh(patch(pr, superEllipse(-0.34, 0.885, 0.08, 0.025, 3, 20), { off: 0.0015, res: 0.02 }), M.trim, 'handlePocket');
      add(pocket);
    }
    // side marker + bumper seam
    add(mesh(patch(pr, superEllipse(1.98, 0.62, 0.045, 0.012, 3, 16), { off: 0.003, res: 0.01 }), M.amber, 'marker'));
  }
  const shut = (pts: { p: THREE.Vector3; n: THREE.Vector3 }[]) => add(mesh(ribbon(pts, 0.0045, 0.0012), M.shut, 'shut'));
  for (const sd of [1, -1]) {
    const col = (x: number, k0: number, k1: number) => {
      const r: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
      for (let k = k0; k <= k1 + 1e-6; k += 0.5) r.push(clonePN(lo.at(x, k, sd)));
      return r;
    };
    const row = (k: number, x0: number, x1: number) => {
      const r: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
      for (let x = x0; x <= x1 + 1e-6; x += 0.02) r.push(clonePN(lo.at(x, k, sd)));
      return r;
    };
    shut(col(0.71, 3, SEC.shoulder - 0.5)); // door front
    shut(col(-0.56, 3, SEC.shoulder - 0.5)); // door rear
    shut(row(3, -0.56, 0.71)); // door bottom
    shut(row(23, 0.93, 2.2)); // hood side
    shut(row(23, -2.43, -2.16)); // decklid side
    shut(col(1.86, 4, 14)); // fascia seam
    shut(col(-2.2, 4, 15)); // rear fascia seam
    const m = doorMirror(M, V3(0.6, 0.985, 0.8), { len: 0.22, h: 0.12, reach: 0.15 });
    if (sd < 0) m.scale.z = -1;
    body.add(m);
    m.traverse((c) => {
      if ((c as THREE.Mesh).isMesh && c.name === 'mirror') paint.push(c as THREE.Mesh);
    });
  }
  const acrossTop = (x: number, k0: number) => {
    const r: { p: THREE.Vector3; n: THREE.Vector3 }[] = [];
    for (let k = k0; k <= HALF_N - 1; k += 0.5) r.push(clonePN(lo.at(x, k, -1)));
    for (let k = HALF_N - 1; k >= k0; k -= 0.5) r.push(clonePN(lo.at(x, k, 1)));
    return r;
  };
  shut(acrossTop(0.93, 23));
  shut(acrossTop(2.2, 23));
  shut(acrossTop(-2.16, 23));
  shut(acrossTop(-2.43, 23));

  for (const w of wheels)
    for (const sd of [1, -1]) {
      const zo = sd * 0.99;
      const zi = sd * 0.5;
      wellLiner(w.x, w.y, w.r - 0.012, zi, zo, M.liner).forEach((m) => body.add(m));
    }
  body.add(underbody(M, -1.85, 1.85, 0.78, 0.21));
  body.add(interior(M, { xDash: 0.78, xSeat: -0.35, floorY: 0.26, beltY: 0.93, halfW: 0.72, xRearWall: -1.35, rearSeats: true }));

  body.userData = { belt: 0.95, sill: 0.27, door: [-0.56, 0.71], cowl: 0.86 };
  const hood = paint.find((m) => m.name === 'hood')!;
  const paintMeshes = mergeByMaterial(body, paint, [hood, ...heads, ...tails]);
  const hoodY = lo.at(1.5, HALF_N - 1, 1).p.y;
  return {
    body,
    dims: { length: XF - XR, width: 1.96, height: 1.38, wheelbase: WB, trackF: TF, trackR: TR, wheelR: WR, rideHeight: 0.12 },
    anchors: {
      wheelFL: V3(WB / 2, WR, TF / 2),
      wheelFR: V3(WB / 2, WR, -TF / 2),
      wheelRL: V3(-WB / 2, WR, TR / 2),
      wheelRR: V3(-WB / 2, WR, -TR / 2),
      exhausts,
      hood: V3(1.5, hoodY, 0),
      roof: V3(-0.35, 1.38, 0),
      deck: V3(-2.3, 1.085, 0),
      frontBumper: V3(XF - 0.02, 0.32, 0),
      seat: V3(-0.45, 1.12, -0.37),
      headlights: [V3(2.2, 0.815, 0.76), V3(2.2, 0.815, -0.76)],
      taillights: [V3(-2.5, 0.93, 0.65), V3(-2.5, 0.93, -0.65)],
    },
    paintMeshes,
    tailLightMeshes: tails,
    headLightMeshes: heads,
  };
}

function clonePN(h: { p: THREE.Vector3; n: THREE.Vector3 }) {
  return { p: h.p.clone(), n: h.n.clone() };
}
