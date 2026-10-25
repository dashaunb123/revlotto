// 'brick' body: the "Avenger", a long boxy retro coupe (after the 2015+ Dodge Challenger). Hand-built in code:
// slab sides with a straight shoulder and a rear hip kick, the classic side scallop, a recessed full-width grille
// "mouth" with quad round halo headlamps under an overhanging hood lip, a power-bulge hood with a scoop, a thick C-pillar,
// a full-width "racetrack" taillight ring and the racing fuel cap.
// buildAvenger(spec, true) is the "Hellkat" widebody (bolt-on riveted flares, deeper splitter, air-catcher lamp,
// airgrabber hood with heat extractors, wider stance); see widebody.ts.
import * as THREE from 'three';
import type { BodyBuild, CarSpec } from '../../types';
import {
  HALF_N, Projector, SEC, V3, archY, band, curve, doorMirror, flipA, greenhouse, grillePatch, interior, lamp, loftBody, makeMats,
  mesh, patch, patchWall, rbox, rect, ribbon, roundPoly, secFrom, sstep, superEllipse, sweep, table, tube, underbody, wellLiner,
  mergeByMaterial, type Mats, type P2, type Wheel,
} from './_helpersB';

type PN = { p: THREE.Vector3; n: THREE.Vector3 };
const cl = (h: PN): PN => ({ p: h.p.clone(), n: h.n.clone() });

/** Round halo headlamp facing +x at c (cup, reflector, projector, LED halo, lens, bezel). airCatcher: hollow intake. */
function roundLamp(M: Mats, c: THREE.Vector3, r: number, airCatcher = false): { group: THREE.Group; head: THREE.Mesh | null } {
  const g = new THREE.Group();
  const cup = mesh(new THREE.CylinderGeometry(r + 0.01, r * 0.8, 0.05, 32, 1, true), M.housing, 'lampCup');
  cup.rotation.x = Math.PI / 2;
  cup.position.z = -0.025;
  const back = mesh(new THREE.CircleGeometry(r * 0.82, 32), airCatcher ? M.liner : M.reflector, 'reflector');
  back.position.z = -0.045;
  const halo = mesh(new THREE.TorusGeometry(r * 0.86, 0.0065, 6, 32), M.drl, 'halo');
  halo.position.z = -0.006;
  const bezel = mesh(new THREE.TorusGeometry(r + 0.008, 0.007, 6, 32), airCatcher ? M.gloss : M.chrome, 'bezel');
  g.add(cup, back, halo, bezel);
  let head: THREE.Mesh | null = null;
  if (airCatcher) {
    const mesh_ = grilleDisc(M, r * 0.7);
    mesh_.position.z = -0.03;
    g.add(mesh_);
  } else {
    head = mesh(new THREE.SphereGeometry(r * 0.38, 20, 12), M.head, 'projector');
    head.position.z = -0.03;
    head.scale.z = 0.6;
    const ring = mesh(new THREE.TorusGeometry(r * 0.45, 0.006, 6, 32), M.chrome, 'projRing');
    ring.position.z = -0.028;
    const lens = mesh(new THREE.CircleGeometry(r + 0.004, 32), M.lensClear, 'lens');
    lens.position.z = 0.002;
    g.add(head, ring, lens);
  }
  g.rotation.y = Math.PI / 2;
  g.position.copy(c);
  return { group: g, head };
}
function grilleDisc(M: Mats, r: number) {
  const d = new THREE.CircleGeometry(r, 32);
  const uv = d.getAttribute('uv');
  void uv;
  return mesh(d, M.grille([6, 6], 'mesh'), 'airCatcher');
}

export function buildAvenger(spec: CarSpec, wide: boolean): BodyBuild {
  const WB = 2.95;
  const XF = wide ? 2.47 : 2.455;
  const XR = -2.565;
  const WR = wide ? 0.36 : 0.364;
  const TF = wide ? 1.69 : 1.6;
  const TR = wide ? 1.71 : 1.62;
  const M = makeMats(spec);
  const body = new THREE.Group();
  body.name = wide ? 'hellkat' : 'avenger';
  const paint: THREE.Mesh[] = [];
  const add = (m: THREE.Mesh, isPaint = false) => {
    body.add(m);
    if (isPaint) paint.push(m);
    return m;
  };
  const wheels: Wheel[] = [
    { x: WB / 2, y: 0.365, r: wide ? 0.4 : 0.395 },
    { x: -WB / 2, y: 0.365, r: wide ? 0.403 : 0.398 },
  ];
  //               yB    tuck   yW    w      yS     wS     r      yT
  const S = table([
    [-2.565, 0.36, 0.05, 0.72, 0.925, 1.06, 0.865, 0.05, 1.075],
    [-2.2, 0.3, 0.06, 0.7, 0.948, 1.052, 0.885, 0.06, 1.07],
    [-1.475, 0.25, 0.06, 0.68, 0.96, 1.035, 0.88, 0.075, 1.07],
    [-0.6, 0.22, 0.07, 0.62, 0.955, 1.0, 0.885, 0.065, 1.0],
    [0.4, 0.22, 0.07, 0.62, 0.952, 0.99, 0.888, 0.06, 1.0],
    [1.0, 0.24, 0.06, 0.64, 0.95, 0.99, 0.89, 0.055, 1.0],
    [1.475, 0.27, 0.05, 0.65, 0.95, 0.975, 0.89, 0.05, 0.985],
    [2.1, 0.28, 0.05, 0.65, 0.942, 0.952, 0.882, 0.05, 0.955],
    [2.47, 0.27, 0.05, 0.62, 0.925, 0.925, 0.865, 0.05, 0.925],
  ]);
  const sec = (x: number) => secFrom(S(x));
  const beltW = (x: number) => {
    const s = sec(x);
    return s.wS - s.r * 0.62;
  };
  const wsBase = (az: number) => 0.68 - 0.13 * (az / 0.84) ** 2;
  const blBase = (az: number) => -1.73 + 0.06 * (az / 0.84) ** 2;
  const flare = wide ? 0.042 : 0;

  const lo = loftBody({
    x0: XR,
    x1: XF,
    sec,
    wheels,
    dx: wide ? 0.075 : 0.055,
    front: { rx: 0.11, rz: 0.055, ryT: 0.028, ryB: 0.04, yc: 0.62, rake: 0.06, K: 8 },
    rear: { rx: 0.12, rz: 0.06, ryT: 0.02, ryB: 0.06, yc: 0.72, rake: 0.08, K: 8 },
    deform: (p, k, side, x) => {
      const az = Math.abs(p.z);
      if (k <= SEC.shoulderLo + 1) {
        // the side scallop: a crisp-topped concave groove that kicks up ahead of the rear wheel
        const yc = 0.69 + 0.09 * sstep(-0.35, -1.0, x);
        const s = band(-1.02, 0.95, 0.12, x) * band(yc - 0.12, yc + 0.06, 0.014, p.y) * (0.45 + 0.55 * sstep(yc - 0.14, yc + 0.05, p.y));
        p.z -= side * 0.032 * s;
        if (flare > 0) {
          // widebody: fenders swell out toward the bolt-on flares
          for (const w of wheels) {
            const d = Math.hypot(x - w.x, (p.y - w.y) * 1.1);
            p.z += side * flare * (1 - sstep(w.r - 0.02, w.r + 0.32, d)) * sstep(0.18, 0.3, p.y);
          }
        }
      }
      if (k >= SEC.topEdge + 2) {
        // power bulge: highest at the cowl, ends in a short steep face (the scoop mouth) near the front
        const bw = wide ? 0.4 : 0.3;
        const xEnd = wide ? 2.0 : 1.9;
        const d = sstep(0.7, 0.9, x) * (1 - sstep(xEnd - 0.04, xEnd + 0.05, x)) * (1 - sstep(bw - 0.1, bw, az));
        p.y += (wide ? 0.068 : 0.04) * d * (0.75 + 0.25 * sstep(xEnd, 0.9, x));
      }
    },
    part: (c, kk) => {
      const az = Math.abs(c.z);
      if (kk >= SEC.shoulder && az < beltW(c.x) - 0.012 && c.x < wsBase(az) - 0.012 && c.x > blBase(az) + 0.012) return null;
      if (kk >= 23 && c.x > 0.73 && c.x < XF - 0.06) return 'hood';
      if (kk >= 23 && c.x < -1.79 && c.x > XR + 0.08) return 'trunk';
      return 'body';
    },
  });
  for (const [name, g] of lo.parts) add(mesh(g, M.paint, name), true);
  const bodyGeos = [...lo.parts.values()];

  // ---- greenhouse: steep windshield, flat roof, notchback backlight, thick C-pillar
  const railY = curve([[-1.75, 1.07], [-1.45, 1.2], [-1.12, 1.395], [-0.85, 1.42], [-0.05, 1.422], [0.25, 1.255], [0.55, 1.0], [0.7, 0.99]]);
  const railW = curve([[-1.75, 0.82], [-1.2, 0.705], [-0.5, 0.672], [0.0, 0.672], [0.3, 0.74], [0.55, 0.835]]);
  const crown = curve([[-1.76, 1.075], [-1.45, 1.235], [-1.08, 1.43], [-0.6, 1.45], [0.0, 1.445], [0.3, 1.28], [0.55, 1.07], [0.69, 1.005]]);
  const belt = (x: number): P2 => {
    const h = lo.at(x, SEC.topEdge - 1, 1);
    return [h.p.y - 0.006, Math.min(h.p.z, beltW(x))];
  };
  const xh = (f: number) => -0.04 + 0.06 * (1 - (1 - f) ** 2);
  const xb = (f: number) => -1.06 - 0.04 * (1 - (1 - f) ** 2);
  const xr = (f: number) => -1.2 + 0.16 * f;
  const gh = greenhouse({
    x0: -1.76,
    x1: 0.69,
    dx: 0.05,
    belt,
    rail: (x) => [Math.max(railY(x), belt(x)[0]), x > 0.55 || x < -1.74 ? belt(x)[1] : Math.min(railW(x), belt(x)[1])],
    crown,
    bulge: 0.018,
    rr: 0.045,
    part: (c, kind, f) => {
      const x = c.x;
      if (kind === 'top') {
        if (x > xh(f) && f > 0.07) return 'glass';
        if (x < xb(f) && x > -1.7 && f > 0.12) return 'glass';
        return 'roof';
      }
      if (f > 0.1 && f < 0.9 && x < 0.5 && x > xr(f)) return x > -0.68 && x < -0.62 ? 'bpillar' : 'glass';
      return 'roof';
    },
  });
  for (const [name, g] of gh.parts) {
    if (name === 'glass') add(mesh(g, M.glass, 'glass'));
    else if (name === 'bpillar') add(mesh(g, M.gloss, 'bpillar'));
    else add(mesh(g, M.paint, 'roof'), true);
  }
  for (const sd of [1, -1]) {
    const at = (x: number, f: number) => cl(gh.at(x, 'side', f, sd));
    const loop: PN[] = [];
    for (let x = 0.49; x >= xr(0.9); x -= 0.02) loop.push(at(x, 0.9));
    for (let f = 0.9; f >= 0.1; f -= 0.05) loop.push(at(xr(f), f));
    for (let x = xr(0.1); x <= 0.49; x += 0.02) loop.push(at(x, 0.1));
    for (let f = 0.1; f <= 0.9; f += 0.05) loop.push(at(0.495, f));
    add(mesh(ribbon(loop, 0.024, 0.003), M.chrome, 'dloTrim'));
    const ap: PN[] = [];
    for (let x = -0.02; x <= 0.66; x += 0.02) ap.push(cl(gh.at(x, 'top', 0.07, sd)));
    add(mesh(ribbon(ap, 0.03, 0.002), M.gloss, 'frit'));
    const bl: PN[] = [];
    for (let x = xb(0.12); x >= -1.7; x -= 0.02) bl.push(cl(gh.at(x, 'top', 0.12, sd)));
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
  add(across(() => -1.69, 0.035));
  const cowl: THREE.Vector3[] = [];
  for (let z = -0.8; z <= 0.8001; z += 0.05) cowl.push(V3(wsBase(Math.abs(z)) + 0.004, 1.005 + 0.012 * (1 - (z / 0.84) ** 2), z));
  add(mesh(tube(cowl, 0.013, 6), M.trim, 'cowl'));
  const pG = new Projector([gh.parts.get('glass')!], 'y');
  for (const z0 of [0.06, -0.7]) {
    const w: THREE.Vector3[] = [];
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const h = pG.hit(0.6 - t * 0.1, z0 + t * 0.6);
      if (h) w.push(h.p.addScaledVector(h.n, 0.012));
    }
    if (w.length > 2) add(mesh(tube(w, 0.007, 5), M.trim, 'wiper'));
  }

  const pF = new Projector(bodyGeos, 'x');
  const pR = new Projector(bodyGeos, '-x');
  const pL = new Projector(bodyGeos, 'z');
  const pRt = new Projector(bodyGeos, '-z');
  const pT = new Projector(bodyGeos, 'y');

  // ---- front: recessed full-width mouth, quad halo lamps, hood lip, bumper intakes, splitter
  const mouth = rect(-0.85, 0.6, 0.85, 0.875, 0.035);
  if (wide) add(mesh(patch(pF, rect(-0.87, 0.57, 0.87, 0.886, 0.04), { off: 0.0015, res: 0.04 }), M.gloss, 'mouthBezel'));
  grillePatch(pF, M, mouth, { cell: 0.03, pattern: 'mesh', off: 0.004 }).forEach((m) => add(m));
  add(mesh(patchWall(pF, mouth, 0.0, 0.02), M.gloss, 'mouthWall'));
  const lipPath: THREE.Vector3[] = [];
  for (let z = -0.84; z <= 0.8401; z += 0.04) {
    const h = pF.hit(z, 0.89);
    lipPath.push(V3((h ? h.p.x : XF) + 0.012, 0.888, z));
  }
  add(mesh(sweep(lipPath, [[0, 0.012], [0.025, 0.004], [0.025, -0.01], [-0.01, -0.012]], { caps: true, up: V3(0, 1, 0) }), M.paint, 'hoodLip'), true);
  const bar: THREE.Vector3[] = [];
  for (let z = -0.42; z <= 0.4201; z += 0.04) {
    const h = pF.hit(z, 0.74);
    bar.push(V3((h ? h.p.x : XF) + 0.012, 0.74, z));
  }
  add(mesh(tube(bar, 0.008, 6), M.gloss, 'grilleBar'));
  add(mesh(patch(pF, rect(-0.4, 0.775, -0.2, 0.805, 0.012), { off: 0.016, res: 0.01 }), M.badge(wide ? 'HELLKAT' : 'AVENGER', '#c9ccd4'), 'badge'));
  const heads: THREE.Mesh[] = [];
  for (const sd of [1, -1])
    for (const z of [0.56, 0.735]) {
      const h = pF.hit(z * sd, 0.745);
      const x = h ? h.p.x : XF;
      const ac = wide && sd < 0 && z < 0.6; // air-catcher: inner lamp on the driver's (left, -z) side
      const L = roundLamp(M, V3(x + 0.006, 0.745, z * sd), 0.066, ac);
      body.add(L.group);
      if (L.head) heads.push(L.head);
    }
  const lowerI = wide
    ? roundPoly([[-0.7, 0.5], [0.7, 0.5], [0.8, 0.32], [-0.8, 0.32]], 0.035)
    : roundPoly([[-0.55, 0.46], [0.55, 0.46], [0.6, 0.35], [-0.6, 0.35]], 0.035);
  grillePatch(pF, M, lowerI, { cell: 0.024, pattern: 'honeycomb' }).forEach((m) => add(m));
  add(mesh(patchWall(pF, lowerI, 0.0, 0.012), M.gloss, 'intakeWall'));
  for (const sd of [1, -1]) {
    const side = rect(0.73, 0.36, 0.86, 0.44, 0.02);
    const o = sd > 0 ? side : flipA(side);
    grillePatch(pF, M, o, { cell: 0.02 }).forEach((m) => add(m));
    add(mesh(patch(pF, sd > 0 ? rect(0.78, 0.47, 0.88, 0.49, 0.008) : flipA(rect(0.78, 0.47, 0.88, 0.49, 0.008)), { off: 0.005, res: 0.01 }), M.amber, 'turn'));
  }
  // splitter (deeper on the widebody)
  const sp: THREE.Vector3[] = [];
  for (let z = -0.9; z <= 0.9001; z += 0.05) {
    const h = pF.hit(z, 0.32);
    sp.push(V3(Math.max(h ? h.p.x : XF, XF - 0.3) - 0.03, wide ? 0.255 : 0.285, z));
  }
  const spProf: P2[] = wide
    ? [[0.08, 0.016], [-0.16, 0.003], [-0.165, -0.004], [-0.15, -0.016], [0.08, -0.016]]
    : [[0.04, 0.015], [-0.045, 0.0], [-0.045, -0.012], [0.04, -0.012]];
  add(mesh(sweep(sp, spProf, { caps: true }), wide ? M.carbon : M.trim, 'splitter'));
  if (wide)
    for (const sd of [1, -1]) {
      const ep = mesh(new THREE.BoxGeometry(0.26, 0.08, 0.012), M.carbon, 'splitterEnd');
      ep.position.set(XF + 0.02, 0.28, 0.9 * sd);
      add(ep);
    }

  // ---- hood scoop mouth + (widebody) heat extractors
  const scoop = wide ? rect(-0.27, 0.96, 0.27, 1.02, 0.02) : rect(-0.2, 0.958, 0.2, 1.0, 0.015);
  const pS = new Projector([lo.parts.get('hood')!], 'x');
  grillePatch(pS, M, scoop, { cell: 0.02, pattern: 'mesh', off: 0.003, res: 0.01 }).forEach((m) => add(m));
  if (wide) {
    for (const sd of [1, -1]) {
      const v = roundPoly([[1.18, 0.44 * sd], [1.78, 0.42 * sd], [1.8, 0.62 * sd], [1.2, 0.66 * sd]], 0.04);
      grillePatch(pT, M, v, { cell: 0.035, pattern: 'slats', off: 0.002, res: 0.04 }).forEach((m) => add(m));
      add(mesh(patchWall(pT, v, 0.0, 0.01), M.gloss, 'extractorLip'));
    }
  }

  // ---- rear: racetrack taillight ring, decklid spoiler lip, plate, valance with exhaust cut-outs
  const ring = rect(-0.87, 0.86, 0.87, 1.0, 0.04);
  const inner = rect(-0.82, 0.885, 0.82, 0.975, 0.025);
  add(mesh(patch(pR, ring, { off: 0.002, res: 0.025 }), M.housing, 'tailHousing'));
  const tailRing = add(mesh(patch(pR, ring, { off: 0.005, res: 0.025 }), M.tail, 'tailRing'));
  add(mesh(patch(pR, inner, { off: 0.008, res: 0.025 }), M.gloss, 'tailPanel'));
  add(mesh(patch(pR, ring, { off: 0.013, res: 0.025 }), M.lensRed, 'tailLens'));
  add(mesh(patchWall(pR, ring, 0.0, 0.013), M.trim, 'tailGasket'));
  add(mesh(patch(pR, rect(-0.14, 0.915, 0.14, 0.945, 0.01), { off: 0.016, res: 0.01 }), M.badge(wide ? 'HELLKAT' : 'AVENGER', '#c9ccd4'), 'rearBadge'));
  const backup = [rect(-0.5, 0.905, -0.38, 0.955, 0.01), rect(0.38, 0.905, 0.5, 0.955, 0.01)];
  backup.forEach((b) => add(mesh(patch(pR, b, { off: 0.011, res: 0.01 }), M.drl, 'reverse')));
  const spl: THREE.Vector3[] = [];
  for (let z = -0.8; z <= 0.8001; z += 0.04) {
    const h = pT.hit(XR + 0.1, z);
    spl.push(V3(XR + 0.09, (h ? h.p.y : 1.07) + 0.004, z));
  }
  add(mesh(sweep(spl, [[0.03, 0], [0, 0.022], [-0.03, 0.006], [-0.03, -0.004], [0.03, -0.004]], { caps: true }), M.paint, 'spoilerLip'), true);
  add(mesh(patch(pR, rect(-0.3, 0.47, 0.3, 0.66, 0.03), { off: 0.002, res: 0.03 }), M.trim, 'plateRecess'));
  add(mesh(patch(pR, rect(-0.26, 0.495, 0.26, 0.635, 0.01), { off: 0.005, res: 0.04 }), M.plate(wide ? 'HLKT 707' : 'AVNG 392'), 'plate'));
  const val = roundPoly([[-0.86, 0.42], [0.86, 0.42], [0.82, 0.31], [-0.82, 0.31]], 0.03);
  add(mesh(patch(pR, val, { off: 0.003, res: 0.03 }), M.trim, 'valance'));
  const exhausts: { pos: THREE.Vector3; dir: THREE.Vector3 }[] = [];
  const tipZ = wide ? [0.55, 0.7] : [0.63];
  for (const sd of [1, -1])
    for (const z of tipZ) {
      const h = pR.hit(z * sd, 0.365);
      const x = h ? h.p.x : XR;
      const cut = mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.07, 24), M.liner, 'exhaustCut');
      cut.rotation.z = Math.PI / 2;
      cut.position.set(x + 0.025, 0.365, z * sd);
      add(cut);
      exhausts.push({ pos: V3(x - 0.01, 0.365, z * sd), dir: V3(-1, 0, 0) });
    }
  const diff = mesh(new THREE.BoxGeometry(0.4, 0.03, 1.5), M.liner, 'diffuser');
  diff.position.set(XR + 0.3, 0.3, 0);
  diff.rotation.z = -0.2;
  add(diff);

  // ---- sides: rockers, handles, markers, mirrors, fuel cap, shut lines
  for (const [pr, sd] of [[pL, 1], [pRt, -1]] as [Projector, number][]) {
    const o = (pts: P2[]) => pts;
    const rock = o(roundPoly([[-1.0, 0.225], [1.0, 0.225], [1.02, 0.27], [-1.0, 0.285]], 0.02));
    add(mesh(patch(pr, rock, { off: 0.003, res: 0.04 }), wide ? M.carbon : M.trim, 'rocker'));
    const h = pr.hit(-0.55, 0.92);
    if (h) {
      add(mesh(patch(pr, superEllipse(-0.55, 0.92, 0.085, 0.026, 3, 20), { off: 0.0015, res: 0.02 }), M.trim, 'handlePocket'));
      const hd = mesh(rbox(0.15, 0.028, 0.03, 0.012), M.paint, 'handle');
      hd.position.copy(h.p).addScaledVector(h.n, 0.007);
      add(hd, true);
    }
    add(mesh(patch(pr, superEllipse(2.25, 0.73, 0.04, 0.014, 3, 16), { off: 0.003, res: 0.01 }), M.amber, 'marker'));
    add(mesh(patch(pr, superEllipse(-2.4, 0.8, 0.04, 0.014, 3, 16), { off: 0.003, res: 0.01 }), M.lensRed, 'markerR'));
    if (sd > 0) {
      // racing fuel cap on the right (passenger, +z) rear quarter
      const fh = pr.hit(-2.0, 0.93);
      if (fh) {
        const cap = mesh(new THREE.CylinderGeometry(0.06, 0.064, 0.016, 32), M.chrome, 'fuelCap');
        cap.position.copy(fh.p).addScaledVector(fh.n, 0.006);
        cap.quaternion.setFromUnitVectors(V3(0, 1, 0), fh.n);
        add(cap);
        const hub = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 20), M.gloss, 'fuelHub');
        hub.position.copy(fh.p).addScaledVector(fh.n, 0.012);
        hub.quaternion.copy(cap.quaternion);
        add(hub);
      }
    }
    const m = doorMirror(M, V3(0.43, 1.03, 0.86), { len: 0.22, h: 0.13, reach: 0.15 });
    if (sd < 0) m.scale.z = -1;
    body.add(m);
    m.traverse((c) => {
      if ((c as THREE.Mesh).isMesh && c.name === 'mirror') paint.push(c as THREE.Mesh);
    });
  }
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
    shut(col(0.55, 3, SEC.shoulder - 0.5));
    shut(col(-0.76, 3, SEC.shoulder - 0.5));
    shut(row(3, -0.76, 0.55));
    shut(row(23, 0.73, XF - 0.06));
    shut(row(23, XR + 0.08, -1.79));
    shut(col(2.22, 5, 15));
    shut(col(-2.3, 5, 15));
  }
  const acrossTop = (x: number, k0: number) => {
    const r: PN[] = [];
    for (let k = k0; k <= HALF_N - 1; k += 0.5) r.push(cl(lo.at(x, k, -1)));
    for (let k = HALF_N - 1; k >= k0; k -= 0.5) r.push(cl(lo.at(x, k, 1)));
    return r;
  };
  shut(acrossTop(0.73, 23));
  shut(acrossTop(-1.79, 23));
  shut(acrossTop(XR + 0.08, 23));

  // ---- widebody: bolt-on flares with rivets
  if (wide) {
    for (const w of wheels) {
      const path: THREE.Vector3[] = [];
      for (let a = -0.12; a <= Math.PI + 0.1201; a += 0.085) {
        const x = w.x + Math.cos(a) * (w.r + 0.004);
        const y = Math.max(w.y + Math.sin(a) * (w.r + 0.004), 0.26);
        const h = pL.hit(x, y + 0.01);
        path.push(V3(x, y, (h ? h.p.z : 0.98) - 0.012));
      }
      // a broad bolt-on flare that stands well proud of the body, with a flat band for the fasteners
      const prof: P2[] = [[-0.016, 0.056], [0.0, 0.072], [0.04, 0.068], [0.1, 0.038], [0.128, 0.008], [0.132, -0.004], [-0.016, -0.004]];
      const fl = mesh(sweep(path, prof, { up: V3(0, 0, 1), caps: true }), M.paint, 'flare');
      const fr = fl.clone();
      fr.scale.z = -1;
      add(fl, true);
      add(fr, true);
      for (let a = 0.04; a <= Math.PI; a += Math.PI / 9) {
        const x = w.x + Math.cos(a) * (w.r + 0.004 + 0.06);
        const y = w.y + Math.sin(a) * (w.r + 0.004 + 0.06);
        if (y < 0.3) continue;
        const h = pL.hit(w.x + Math.cos(a) * (w.r + 0.004), Math.max(w.y + Math.sin(a) * (w.r + 0.004), 0.26) + 0.01);
        for (const sd of [1, -1]) {
          const rv = mesh(new THREE.SphereGeometry(0.0115, 6, 2, 0, Math.PI * 2, 0, Math.PI / 2), M.chrome, 'rivet');
          rv.position.set(x, y, sd * ((h ? h.p.z : 0.98) - 0.012 + 0.051));
          rv.rotation.x = sd * Math.PI / 2;
          add(rv);
        }
      }
    }
  }

  if (wide) {
    // protruding carbon side skirts between the flares
    const sk: THREE.Vector3[] = [];
    for (let x = -WB / 2 + 0.5; x <= WB / 2 - 0.47; x += 0.08) {
      const h = pL.hit(x, 0.26);
      sk.push(V3(x, 0.245, (h ? h.p.z : 0.94) - 0.01));
    }
    const skirt = mesh(sweep(sk, [[0, 0.002], [0.03, 0.028], [0.048, 0.04], [0.052, -0.012], [0, -0.012]], { up: V3(0, 0, 1), caps: true }), M.carbon, 'skirt');
    const skirtR = skirt.clone();
    skirtR.scale.z = -1;
    add(skirt);
    add(skirtR);
  }
  for (const w of wheels)
    for (const sd of [1, -1]) wellLiner(w.x, w.y, w.r - 0.012, sd * 0.52, sd * (1.0 + flare), M.liner).forEach((m) => body.add(m));
  body.add(underbody(M, -1.95, 1.95, 0.8, 0.22));
  body.add(interior(M, { xDash: 0.6, xSeat: -0.55, floorY: 0.28, beltY: 0.99, halfW: 0.76, xRearWall: -1.6, rearSeats: true }));
  void archY;

  body.userData = { belt: 1.0, sill: 0.29, door: [-0.76, 0.55], cowl: 0.66 };
  const hood = paint.find((m) => m.name === 'hood')!;
  const paintMeshes = mergeByMaterial(body, paint, [hood, ...heads, tailRing]);
  const hoodY = lo.at(1.4, HALF_N - 1, 1).p.y;
  return {
    body,
    dims: { length: XF - XR, width: wide ? 2.06 : 1.92, height: 1.45, wheelbase: WB, trackF: TF, trackR: TR, wheelR: WR, rideHeight: wide ? 0.11 : 0.13 },
    anchors: {
      wheelFL: V3(WB / 2, WR, TF / 2),
      wheelFR: V3(WB / 2, WR, -TF / 2),
      wheelRL: V3(-WB / 2, WR, TR / 2),
      wheelRR: V3(-WB / 2, WR, -TR / 2),
      exhausts,
      hood: V3(1.4, hoodY, 0),
      roof: V3(-0.5, 1.45, 0),
      deck: V3(-2.25, 1.075, 0),
      frontBumper: V3(XF - 0.02, 0.3, 0),
      seat: V3(-0.68, 1.16, -0.38),
      headlights: [V3(XF, 0.745, 0.65), V3(XF, 0.745, -0.65)],
      taillights: [V3(XR, 0.93, 0.7), V3(XR, 0.93, -0.7)],
    },
    paintMeshes,
    tailLightMeshes: [tailRing],
    headLightMeshes: heads,
  };
}

export default function build(spec: CarSpec): BodyBuild {
  return buildAvenger(spec, false);
}
