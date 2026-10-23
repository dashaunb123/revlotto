// 3D cars: the 2D sprite side profiles (src/render/car.ts BODIES) extruded into chunky toon bodies.
// Root origin = ground, mid-car. +X forward, +Z = the driver's (camera) side.
import * as THREE from 'three';
import type { CarLook3D, CarRig, CutsceneId } from '../types';
import { Kit, outlineTree } from './kit';
import { starShape } from './parts';
import { roundedBoxGeometry as roundedBox } from './props';

type Pt = [number, number];
interface Body3D {
  L: number;
  poly: Pt[];
  windows: Pt[][];
  rearX: number;
  frontX: number;
  belt: number;
  clearance: number;
  width: number;
  wheel: [number, number]; // front, rear radius (sprite px)
  spoiler?: boolean;
  stripes?: boolean;
}

// Mirrors BODIES in src/render/car.ts (sprite px, y down, 0..21 = roof..sill) plus 3D-only extras.
const BODIES: Record<CarLook3D['body'], Body3D> = {
  compact: {
    L: 60,
    poly: [[0, 20], [0, 10], [3, 5], [8, 2], [32, 2], [41, 9], [54, 10], [59, 12], [60, 15], [60, 20], [59, 21], [1, 21]],
    windows: [[[5, 9], [8, 4], [18, 4], [18, 9]], [[20, 9], [20, 4], [31, 4], [37, 9]]],
    rearX: 12, frontX: 48, belt: 10, clearance: 4, width: 1.8, wheel: [6.5, 6.5],
  },
  muscle: {
    L: 72,
    poly: [[0, 19], [0, 11], [2, 9], [14, 8], [22, 3], [38, 3], [46, 8], [66, 9], [70, 11], [72, 13], [72, 19], [70, 21], [2, 21]],
    windows: [[[20, 8], [24, 4], [30, 4], [30, 8]], [[32, 8], [32, 4], [37, 4], [43, 8]]],
    rearX: 14, frontX: 58, belt: 10, clearance: 4, width: 2.0, wheel: [6.5, 8], spoiler: true, stripes: true,
  },
  wedge: {
    L: 70,
    poly: [[0, 18], [0, 10], [12, 9], [24, 8], [30, 3], [40, 3], [70, 12], [70, 18], [68, 21], [2, 21]],
    windows: [[[28, 8], [31, 4], [39, 4], [48, 8]]],
    rearX: 14, frontX: 56, belt: 10, clearance: 4, width: 1.95, wheel: [6.5, 7.5],
  },
  truck: {
    L: 74,
    poly: [[0, 20], [0, 8], [28, 8], [30, 1], [46, 1], [50, 8], [66, 9], [71, 10], [74, 12], [74, 20], [72, 21], [2, 21]],
    windows: [[[32, 7], [33, 3], [44, 3], [47, 7]]],
    rearX: 14, frontX: 60, belt: 9, clearance: 6, width: 2.1, wheel: [8.5, 8.5],
  },
  super: {
    L: 72,
    poly: [[0, 17], [0, 11], [8, 10], [24, 7], [32, 5], [42, 5], [52, 10], [66, 12], [72, 15], [72, 18], [70, 21], [2, 21]],
    windows: [[[28, 9], [32, 6], [41, 6], [49, 10]]],
    rearX: 14, frontX: 58, belt: 12, clearance: 3, width: 2.05, wheel: [6.5, 7.5], spoiler: true, stripes: true,
  },
};

/** Metres per sprite pixel. */
const S = 0.062;

/** Sutherland-Hodgman clip of a polygon against the half-plane keep(p) (edge given by a lerp fn). */
function clip(poly: Pt[], inside: (p: Pt) => boolean, cut: (a: Pt, b: Pt) => Pt): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ia = inside(a), ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) out.push(cut(a, b));
  }
  return out;
}
const atY = (y: number) => (a: Pt, b: Pt): Pt => [a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]), y];
const above = (poly: Pt[], y: number) => clip(poly, (p) => p[1] <= y, atY(y));
const below = (poly: Pt[], y: number) => clip(poly, (p) => p[1] >= y, atY(y));

function inPoly(x: number, y: number, pts: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Topmost body row of sprite column x. */
const topAt = (d: Body3D, x: number) => {
  for (let y = 0; y < 22; y += 0.25) if (inPoly(x, y, d.poly)) return y;
  return d.belt;
};
/** Front-most / rear-most body column on sprite row y. */
const frontAt = (d: Body3D, y: number) => {
  for (let x = d.L; x > 0; x -= 0.25) if (inPoly(x, y, d.poly)) return x;
  return d.L;
};
const rearAt = (d: Body3D, y: number) => {
  for (let x = 0; x < d.L; x += 0.25) if (inPoly(x, y, d.poly)) return x;
  return 0;
};

/** Rounds every corner of a polygon with a ~r px fillet (quadratic, `seg` steps), clamped to the edge lengths. */
function roundPoly(pts: Pt[], r: number, seg = 4): Pt[] {
  const out: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const ra = Math.min(r, la / 2.2), rb = Math.min(r, lb / 2.2);
    if (ra < 0.05 || rb < 0.05) {
      out.push(p);
      continue;
    }
    const p0: Pt = [p[0] + ((a[0] - p[0]) * ra) / la, p[1] + ((a[1] - p[1]) * ra) / la];
    const p2: Pt = [p[0] + ((b[0] - p[0]) * rb) / lb, p[1] + ((b[1] - p[1]) * rb) / lb];
    for (let k = 0; k <= seg; k++) {
      const t = k / seg, u = 1 - t;
      out.push([u * u * p0[0] + 2 * u * t * p[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p[1] + t * t * p2[1]]);
    }
  }
  return out;
}

export interface CarOpts {
  /** Police light bar on the roof (Buckshot). props.lightBar / lightRed / lightBlue. */
  lightBar?: boolean;
  /** Oil barrels in the truck bed (Olga). */
  barrels?: boolean;
  /** Twin air horns + roof scoop (Gus). */
  horns?: boolean;
  /** Rim colour override (default chrome). */
  rim?: THREE.ColorRepresentation;
  /** 'bw' = police black-and-white: white doors + roof, gold star on the doors, SHERIFF blocks, front push bar. */
  livery?: 'bw';
}

export interface CarRigX extends CarRig {
  /** Top of the roof, mid-cabin: stand a character here (feet at the origin). */
  roof: THREE.Object3D;
  /** The sprung body (leans with setLean); seat, roof, lights and exhausts live under it. */
  body: THREE.Group;
  /**
   * Named parts: lightBar / lightRed / lightBlue (lightBar), horns, barrels, and `spoiler` on bodies with a wing
   * (muscle, super). The spoiler group's origin is the wing's base on the deck lid, so rattle it with
   * rotation.x/z, then `scene.attach(props.spoiler)` and fling it to blow it off.
   */
  props: Record<string, THREE.Object3D>;
  /** Siren on/off for the light bar (flashes in update). */
  setSiren(on: boolean): void;
  /** Headlight/taillight brightness multiplier (1 = default). */
  setLights(k: number): void;
}

export const BOSS_CARS: Record<CutsceneId, CarLook3D & { opts: CarOpts }> = {
  buckshot: { body: 'muscle', color: '#141418', accent: '#f4f2ea', opts: { lightBar: true, livery: 'bw' } },
  olga: { body: 'truck', color: '#2a2a30', accent: '#38c6c0', opts: { barrels: true, rim: '#38c6c0' } },
  gus: { body: 'truck', color: '#7cc4f0', accent: '#f4ecd8', opts: { horns: true } },
  rosa: { body: 'super', color: '#e8413c', accent: '#f4ecd8', opts: { rim: '#f4ecd8' } },
  pivot: { body: 'wedge', color: '#6b4f2a', accent: '#f2e3b3', opts: {} },
  flashini: { body: 'compact', color: '#5a1a8a', accent: '#ffd23f', opts: {} },
  sal: { body: 'compact', color: '#e07b1f', accent: '#1a1a1a', opts: {} },
  vera: { body: 'wedge', color: '#c0c8d8', accent: '#ff4fa3', opts: {} },
  dj: { body: 'super', color: '#0a0a0a', accent: '#ff2fd6', opts: {} },
  rick: { body: 'muscle', color: '#2a7a3a', accent: '#e8e8e8', opts: {} },
  deacon: { body: 'super', color: '#161616', accent: '#d8d8d8', opts: {} },
  baron: { body: 'wedge', color: '#8a0f1a', accent: '#ffd700', opts: {} },
  ivy: { body: 'muscle', color: '#4b4f58', accent: '#ff8a1f', opts: {} },
};

export function buildBossCar(id: CutsceneId): CarRigX {
  const c = BOSS_CARS[id];
  return buildCar3D(c, c.opts);
}

export function buildCar3D(look: CarLook3D, opts: CarOpts = {}): CarRigX {
  const d = BODIES[look.body] ?? BODIES.compact;
  const kit = new Kit();
  const G = 21 + d.clearance;
  const X = (px: number) => (px - d.L / 2) * S;
  const Y = (py: number) => (G - py) * S;
  const W = d.width;
  const OL = 0.03;

  const root = new THREE.Group();
  root.name = `car_${look.body}`;
  const sprung = new THREE.Group(); // lean pivot at axle height
  const pivotY = 0.45;
  sprung.position.y = pivotY;
  root.add(sprung);
  const body = new THREE.Group();
  body.position.y = -pivotY;
  sprung.add(body);

  const paint = kit.toon(look.color);
  const accent = kit.toon(look.accent);
  const dark = kit.toon(0x1b1a24);
  const chrome = kit.toon(0xd8dde6);
  const glass = kit.toon(0x2b3d66);
  // Fake clearcoat: unlit white slivers that ride the panels (reads as a hard specular at any light).
  const spec = kit.own(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const specSoft = kit.own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }));

  const shine = (r: number, sx: number, sy: number, mat: THREE.Material = spec) => kit.ball(r, mat, sx, sy, 0.3, 8, 0);
  const shapeOf = (pts: Pt[]) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(X(x), Y(y))));
  const extrude = (pts: Pt[], depth: number, bevel: number, round = 0) => {
    const g = new THREE.ExtrudeGeometry(shapeOf(round > 0 ? roundPoly(pts, round) : pts), {
      depth: Math.max(0.001, depth - 2 * bevel),
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel * 0.8,
      bevelSegments: bevel > 0 ? 4 : 1,
      curveSegments: 1,
    });
    g.translate(0, 0, -(depth - 2 * bevel) / 2);
    return g;
  };

  // Lower body full width; greenhouse narrower (tumblehome) above the window sills.
  const yb = Math.max(...d.windows.flat().map((p) => p[1]));
  const lower = below(d.poly, yb);
  const upper = above(d.poly, yb + 0.8);
  const bev = 0.12, bevC = 0.1;
  const Wc = W * 0.8;
  const bw = opts.livery === 'bw';
  const white = kit.toon(0xf4f2ea);
  body.add(kit.mesh(extrude(lower, W, bev, 2.6), paint, OL));
  body.add(kit.mesh(extrude(upper, Wc, bevC, 2.2), bw ? white : paint, OL));

  if (bw) {
    // Black-and-white: white door panels spanning the windows, gold star, SHERIFF blocks.
    const xs = d.windows.flat().map((p) => p[0]);
    const x0 = Math.min(...xs) - 1, x1 = Math.max(...xs) + 1;
    const door = clip(clip(below(lower, yb - 0.2), (p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]),
      (p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]);
    const doorPanel = above(door, 18.6);
    const sheriffTex = kit.canvas(64, 12, (g, w, h) => {
      g.fillStyle = '#141418';
      g.font = 'bold 11px monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('SHERIFF', w / 2, h / 2 + 1);
    });
    const sheriffMat = kit.own(new THREE.MeshBasicMaterial({ map: sheriffTex, transparent: true, alphaTest: 0.3 }));
    const goldStar = kit.toon(0xf5c542);
    const cx = (x0 + x1) / 2;
    for (const side of [-1, 1]) {
      const g = extrude(doorPanel, 0.012, 0);
      g.translate(0, 0, side * (W / 2 + 0.006));
      body.add(kit.mesh(g, white, 0));
      const star = kit.mesh(new THREE.ExtrudeGeometry(starShape(0.2), { depth: 0.03, bevelEnabled: false }), goldStar, 0.012);
      star.position.set(X(cx), Y(yb + 3.6), side * (W / 2 + 0.03));
      if (side < 0) star.rotation.y = Math.PI;
      body.add(star);
      const txt = new THREE.Mesh(kit.geo(new THREE.PlaneGeometry(1.25, 0.24)), sheriffMat);
      txt.position.set(X(cx), Y(yb + 7.6), side * (W / 2 + 0.03));
      if (side < 0) txt.rotation.y = Math.PI;
      body.add(txt);
    }
    // Push bar on the nose.
    const fxp = X(frontAt(d, 15));
    const pb = new THREE.Group();
    for (const z of [-0.36, 0.36]) {
      const post = kit.box(0.09, 0.62, 0.09, dark, 0.02);
      post.position.set(0, 0, z);
      pb.add(post);
    }
    for (const y of [-0.18, 0.18]) {
      const rail = kit.box(0.09, 0.08, 0.9, dark, 0.02);
      rail.position.set(0.02, y, 0);
      pb.add(rail);
    }
    pb.position.set(fxp + 0.2, Y(16), 0);
    body.add(pb);
  }

  // Racing stripes wrap the whole profile, just proud of the paint.
  if (d.stripes && !bw) {
    for (const z of [-0.2, 0.2]) {
      const g = new THREE.ExtrudeGeometry(shapeOf(roundPoly(d.poly, 2.6)), {
        depth: 0.2, bevelEnabled: true, bevelThickness: 0.001, bevelSize: bev * 0.8 + 0.008, bevelSegments: 1, curveSegments: 1,
      });
      g.translate(0, 0, z - 0.1);
      body.add(kit.mesh(g, accent, 0));
    }
  } else {
    // Side stripe along the flank.
    const band = below(above(d.poly, d.belt + 3.4), d.belt + 1.6);
    for (const side of [-1, 1]) {
      const g = extrude(band, 0.012, 0);
      g.translate(0, 0, side * (W / 2 + 0.004));
      body.add(kit.mesh(g, accent, 0));
    }
  }

  // Clearcoat + chrome: a hard specular streak along each shoulder, chrome belt and rocker trim, a roof glint.
  {
    const xs = d.windows.flat().map((p) => p[0]);
    const wx0 = Math.min(...xs), wx1 = Math.max(...xs);
    const clipX = (poly: Pt[], x0: number, x1: number) =>
      clip(clip(poly, (p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]),
        (p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]);
    const streak = clipX(below(above(d.poly, yb + 2.2), yb + 1.5), d.L * 0.08, d.L * 0.9);
    const soft = clipX(below(above(d.poly, yb + 3.6), yb + 2.2), d.L * 0.2, d.L * 0.75);
    for (const side of [-1, 1]) {
      const z = side * (W / 2 + 0.008);
      if (streak.length > 2) {
        const g = extrude(streak, 0.004, 0, 0.6);
        g.translate(0, 0, z);
        body.add(kit.mesh(g, spec, 0));
      }
      if (soft.length > 2) {
        const g = extrude(soft, 0.004, 0, 0.6);
        g.translate(0, 0, z);
        body.add(kit.mesh(g, specSoft, 0));
      }
      const belt = kit.mesh(new THREE.CapsuleGeometry(0.018, (wx1 - wx0 + 2) * S, 4, 8).rotateZ(Math.PI / 2), chrome, 0);
      belt.position.set(X((wx0 + wx1) / 2), Y(yb) + 0.01, side * (Wc / 2 + 0.03));
      body.add(belt);
      const rx0 = d.rearX + d.wheel[1] * 1.3, rx1 = d.frontX - d.wheel[0] * 1.3;
      const rocker = kit.mesh(new THREE.CapsuleGeometry(0.022, (rx1 - rx0) * S, 4, 8).rotateZ(Math.PI / 2), chrome, 0);
      rocker.position.set(X((rx0 + rx1) / 2), Y(20.2), side * (W / 2 + 0.012));
      body.add(rocker);
    }
  }

  // Side windows on the greenhouse flanks, with a glint.
  const glint = kit.toon(0xbfd4ff);
  for (const w of d.windows) {
    for (const side of [-1, 1]) {
      const g = extrude(w, 0.014, 0, 1.2);
      g.translate(0, 0, side * (Wc / 2 + 0.006));
      body.add(kit.mesh(g, glass, 0));
      const xs = w.map((p) => p[0]), ys = w.map((p) => p[1]);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const gl = kit.box(0.07, (Math.max(...ys) - Math.min(...ys)) * S * 0.8, 0.01, glint, 0);
      gl.position.set(X(cx + 1), Y(cy), side * (Wc / 2 + 0.018));
      gl.rotation.z = -0.5;
      body.add(gl);
    }
  }
  // Windshield / rear glass on the steep greenhouse edges.
  const cxU = upper.reduce((s, p) => s + p[0], 0) / upper.length;
  for (let i = 0; i < upper.length; i++) {
    const a = upper[i], b = upper[(i + 1) % upper.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (Math.abs(dx) < 0.5 || Math.abs(dy / dx) < 0.22 || a[1] > yb + 0.9 || b[1] > yb + 0.9) continue;
    const ax = X(a[0]), ay = Y(a[1]), bx = X(b[0]), by = Y(b[1]);
    const len = Math.hypot(bx - ax, by - ay);
    let nx = by - ay, ny = -(bx - ax);
    const mx = (ax + bx) / 2;
    if ((mx - X(cxU)) * nx < 0) (nx = -nx), (ny = -ny);
    const n = Math.hypot(nx, ny);
    const pane = kit.box(len * 0.86, 0.025, Wc * 0.84, glass, 0);
    pane.position.set(mx + (nx / n) * (bevC * 0.8 + 0.012), (ay + by) / 2 + (ny / n) * (bevC * 0.8 + 0.012), 0);
    pane.rotation.z = Math.atan2(by - ay, bx - ax);
    body.add(pane);
    const pg = kit.box(len * 0.5, 0.01, 0.12, glint, 0);
    pg.position.copy(pane.position).addScaledVector(new THREE.Vector3(nx / n, ny / n, 0), 0.015);
    pg.position.z = Wc * 0.18;
    pg.rotation.copy(pane.rotation);
    pg.rotation.y = 0.6;
    body.add(pg);
  }

  // Lights.
  const lightMats: { m: THREE.MeshToonMaterial; base: number }[] = [];
  const lamp = (color: number, k: number) => {
    const m = kit.toonUnique(color, { emissive: color, emissiveIntensity: k });
    lightMats.push({ m, base: k });
    return m;
  };
  const headY = Math.max(d.belt + 1.5, topAt(d, d.L - 1) + 1.5);
  const tailY = Math.max(d.belt + 1, topAt(d, 0.5) + 1.2);
  const fx = X(frontAt(d, headY)), rx = X(rearAt(d, tailY));
  const headM = lamp(0xfff3b0, 1.6), tailM = lamp(0xff2a2a, 1.8);
  for (const side of [-1, 1]) {
    const h = kit.ball(0.12, headM, 0.6, 0.75, 1.55, 16, 0.02);
    h.position.set(fx + 0.06, Y(headY), side * (W / 2 - 0.32));
    body.add(h);
    const bez = kit.mesh(new THREE.TorusGeometry(0.1, 0.022, 6, 18).scale(1, 0.85, 1.9).rotateY(Math.PI / 2), chrome, 0);
    bez.position.copy(h.position).x += 0.01;
    body.add(bez);
    const hg = shine(0.03, 0.8, 1.2);
    hg.position.set(fx + 0.135, Y(headY) + 0.035, side * (W / 2 - 0.32) - 0.06);
    body.add(hg);
    const t = kit.ball(0.11, tailM, 0.5, 0.65, 2.2, 14, 0.02);
    t.position.set(rx - 0.05, Y(tailY), side * (W / 2 - 0.34));
    body.add(t);
  }
  const grille = kit.box(0.08, 0.16, W * 0.36, dark, 0.015);
  grille.position.set(fx + 0.02, Y(headY + 1.5), 0);
  body.add(grille);
  // Bumpers: rounded chrome bars at the ends, with a hard glint.
  for (const [x, w] of [[X(frontAt(d, 19.5)) + 0.02, 1], [X(rearAt(d, 19.5)) - 0.02, -1]] as const) {
    const b = kit.mesh(new THREE.CapsuleGeometry(0.075, W * 0.86, 6, 14).rotateX(Math.PI / 2), chrome, 0.02);
    b.position.set(x + w * 0.06, Y(19.5), 0);
    body.add(b);
    const bg = kit.box(0.02, 0.022, W * 0.6, spec, 0);
    bg.position.set(x + w * 0.12, Y(19.5) + 0.04, 0);
    body.add(bg);
  }

  // Mirrors at the A-pillar base.
  const win0 = d.windows[d.windows.length - 1];
  const wFront = Math.max(...win0.map((p) => p[0]));
  for (const side of [-1, 1]) {
    const m = kit.ball(0.1, paint, 0.85, 0.65, 1.1, 12, 0.02);
    m.position.set(X(wFront - 1), Y(yb) + 0.1, side * (W / 2 - 0.02));
    body.add(m);
  }

  // Exhausts: chrome pipes poking out the back under the bumper.
  const exhausts: THREE.Object3D[] = [];
  const exZ = look.body === 'compact' ? [W / 2 - 0.45] : [-(W / 2 - 0.45), W / 2 - 0.45];
  for (const z of exZ) {
    const p = kit.cyl(0.075, 0.075, 0.32, chrome, 10, 0.02);
    p.rotation.z = Math.PI / 2;
    const x0 = X(rearAt(d, 20)) - 0.06;
    p.position.set(x0, Y(20.3), z);
    body.add(p);
    const hole = kit.cyl(0.05, 0.05, 0.02, 0x0a0a0a, 10, 0);
    hole.rotation.z = Math.PI / 2;
    hole.position.set(x0 - 0.155, Y(20.3), z);
    body.add(hole);
    const tip = new THREE.Object3D();
    tip.name = 'exhaust';
    tip.position.set(x0 - 0.17, Y(20.3), z);
    body.add(tip);
    exhausts.push(tip);
  }

  // Spoiler: its own group (props.spoiler), origin at the base of the posts on the deck lid, so it can be torn off.
  let spoilerG: THREE.Group | null = null;
  if (d.spoiler) {
    const sx = X(3.5), top = Y(topAt(d, 3.5)) + bev * 0.6;
    spoilerG = new THREE.Group();
    spoilerG.name = 'spoiler';
    spoilerG.position.set(sx, top, 0);
    for (const side of [-1, 1]) {
      const post = kit.mesh(roundedBox(0.1, 0.34, 0.06, 0.025), dark, 0.02);
      post.position.set(0, 0.14, side * (W * 0.32));
      post.rotation.z = 0.15;
      spoilerG.add(post);
    }
    // Aerofoil: a rounded teardrop section extruded across the car.
    const foil = new THREE.Shape();
    foil.moveTo(0.3, 0);
    foil.quadraticCurveTo(0.1, 0.07, -0.22, 0.045);
    foil.quadraticCurveTo(-0.3, 0.02, -0.26, -0.02);
    foil.quadraticCurveTo(0.0, -0.03, 0.3, 0);
    const fg = new THREE.ExtrudeGeometry(foil, { depth: W * 1.02, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 3, curveSegments: 6 });
    fg.translate(0, 0, -W * 0.51);
    const wing = kit.mesh(fg, accent, 0.025);
    wing.position.set(-0.05, 0.3, 0);
    wing.rotation.z = 0.1;
    spoilerG.add(wing);
    const wg = kit.box(0.24, 0.018, W * 0.8, spec, 0);
    wg.position.set(-0.07, 0.36, 0);
    wg.rotation.z = 0.12;
    spoilerG.add(wg);
    for (const side of [-1, 1]) {
      const plate = kit.mesh(roundedBox(0.62, 0.22, 0.045, 0.02), paint, 0.02);
      plate.position.set(-0.05, 0.3, side * (W * 0.51 + 0.04));
      spoilerG.add(plate);
    }
    body.add(spoilerG);
  }

  // Wheels: tyre + spinning rim with chunky spokes so the spin reads; fronts steer.
  const wheelsF: THREE.Object3D[] = [], wheelsR: THREE.Object3D[] = [], steers: THREE.Object3D[] = [];
  const rearContacts: THREE.Object3D[] = [];
  const rimMat = opts.rim !== undefined ? kit.toon(opts.rim) : chrome;
  const tireMat = kit.toon(0x1d1c22);
  const wellMat = kit.toon(0x0c0b10);
  const wallMat = kit.toon(0x34333c);
  const makeWheel = (rPx: number, width: number, side: number) => {
    const r = rPx * S;
    const spin = new THREE.Group();
    // Tyre: a lathed rounded section (bulging sidewalls, flat tread), axis along Z.
    const hw = width / 2, rr = Math.min(0.07, r * 0.2);
    const prof: THREE.Vector2[] = [];
    const ri = r * 0.6;
    prof.push(new THREE.Vector2(ri, -hw * 0.9));
    for (let i = 0; i <= 5; i++) {
      const a = -Math.PI / 2 + (i / 5) * (Math.PI / 2);
      prof.push(new THREE.Vector2(r - rr + Math.cos(a) * rr, -hw + rr + Math.sin(a) * rr));
    }
    for (let i = 0; i <= 5; i++) {
      const a = (i / 5) * (Math.PI / 2);
      prof.push(new THREE.Vector2(r - rr + Math.cos(a) * rr, hw - rr + Math.sin(a) * rr));
    }
    prof.push(new THREE.Vector2(ri, hw * 0.9));
    const tg = new THREE.LatheGeometry(prof, 28);
    tg.rotateX(Math.PI / 2);
    spin.add(kit.mesh(tg, tireMat, 0.03));
    // Raised sidewall ring (reads as a lettered sidewall) on the outer face.
    const wall = kit.mesh(new THREE.TorusGeometry(r * 0.8, r * 0.035, 6, 28), wallMat, 0);
    wall.position.z = side * (hw * 0.93);
    spin.add(wall);
    // Rim: chrome lip + dished face + chunky spokes + hub.
    const lip = kit.mesh(new THREE.TorusGeometry(r * 0.6, r * 0.06, 8, 28), rimMat, 0);
    lip.position.z = side * (hw * 0.86);
    spin.add(lip);
    const rg = new THREE.CylinderGeometry(r * 0.6, r * 0.6, 0.04, 28);
    rg.rotateX(Math.PI / 2);
    const rim = kit.mesh(rg, rimMat, 0.015);
    rim.position.z = side * (hw * 0.8);
    spin.add(rim);
    const dish = kit.mesh(rg.clone().scale(0.8, 0.8, 1), dark, 0);
    dish.position.z = side * (hw * 0.8 + 0.015);
    spin.add(dish);
    for (let i = 0; i < 5; i++) {
      const sp = kit.mesh(roundedBox(r * 0.56, r * 0.17, 0.05, r * 0.05), rimMat, 0);
      const a = (i / 5) * Math.PI * 2;
      sp.position.set(Math.cos(a) * r * 0.28, Math.sin(a) * r * 0.28, side * (hw * 0.8 + 0.03));
      sp.rotation.z = a;
      spin.add(sp);
    }
    const hub = kit.cyl(r * 0.15, r * 0.15, 0.07, accent, 14, 0.01);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = side * (hw * 0.8 + 0.05);
    spin.add(hub);
    const cap = kit.ball(r * 0.1, rimMat, 1, 1, 0.6, 10, 0);
    cap.position.z = side * (hw * 0.8 + 0.085);
    spin.add(cap);
    return { spin, r };
  };
  const axles: [number, number, boolean][] = [[d.frontX, d.wheel[0], true], [d.rearX, d.wheel[1], false]];
  for (const [px, rPx, front] of axles) {
    for (const side of [-1, 1]) {
      const width = front ? 0.4 : 0.5;
      const { spin, r } = makeWheel(rPx, width, side);
      const mount = new THREE.Group();
      mount.position.set(X(px), r, side * (W / 2 - width * 0.3));
      root.add(mount);
      if (front) {
        const steer = new THREE.Group();
        steer.add(spin);
        mount.add(steer);
        steers.push(steer);
        wheelsF.push(spin);
      } else {
        mount.add(spin);
        wheelsR.push(spin);
        const c = new THREE.Object3D();
        c.name = 'rearContact';
        c.position.set(X(px), 0, mount.position.z);
        root.add(c);
        rearContacts.push(c);
      }
      // Dark wheel-well decal on the flank behind the tyre.
      const wg = new THREE.CylinderGeometry(r * 1.16, r * 1.16, 0.01, 16);
      wg.rotateX(Math.PI / 2);
      const well = kit.mesh(wg, wellMat, 0);
      well.position.set(X(px), r, side * (W / 2 + 0.006));
      body.add(well);
      // Rounded fender flare hugging the top of the wheel, in body paint, with a glint on its crown.
      const flare = kit.mesh(new THREE.TorusGeometry(r * 1.2, 0.075, 8, 22, Math.PI).scale(1, 1, 0.8), paint, 0.02);
      flare.position.set(X(px), r, side * (W / 2 - 0.02));
      body.add(flare);
      const fgl = shine(0.06, 1.6, 0.35);
      fgl.position.set(X(px) - r * 0.35, r + r * 1.2 + 0.03, side * (W / 2 + 0.03));
      fgl.rotation.z = 0.35;
      body.add(fgl);
    }
  }

  // Truck bed opening.
  if (look.body === 'truck') {
    const bed = kit.box((27 - 1.5) * S, 0.02, W - 0.36, dark, 0);
    bed.position.set(X(14.2), Y(8) + 0.075, 0);
    body.add(bed);
  }

  const props: Record<string, THREE.Object3D> = {};
  const roofPx = upper.filter((p) => p[1] <= Math.min(...upper.map((q) => q[1])) + 0.01).map((p) => p[0]);
  const roofX = X((Math.min(...roofPx) + Math.max(...roofPx)) / 2);
  const roofY = Y(Math.min(...d.poly.map((p) => p[1]))) + bevC * 0.8;
  const roof = new THREE.Object3D();
  roof.name = 'roof';
  roof.position.set(roofX, roofY, 0);
  body.add(roof);
  // Roof + hood/deck glints (clearcoat on the top surfaces).
  {
    const span = (Math.max(...roofPx) - Math.min(...roofPx)) * S;
    const rg = kit.box(Math.max(0.2, span * 0.7), 0.006, 0.05, spec, 0);
    rg.position.set(roofX, roofY + 0.004, Wc * 0.2);
    body.add(rg);
    const rs = kit.box(Math.max(0.2, span * 0.8), 0.006, 0.16, specSoft, 0);
    rs.position.set(roofX, roofY + 0.003, Wc * 0.2);
    body.add(rs);
  }
  if (spoilerG) props.spoiler = spoilerG;

  // Boss extras.
  const sirenMats: { m: THREE.MeshToonMaterial; phase: number }[] = [];
  if (opts.lightBar) {
    // Big chunky bar at the back of the roof, behind the driver's window so it never floats in front of him.
    const bar = new THREE.Group();
    bar.position.copy(roof.position);
    bar.position.x = X(Math.min(...roofPx) + 2.5);
    const base = kit.box(0.46, 0.1, Wc * 1.0, dark, 0.025);
    base.position.y = 0.05;
    bar.add(base);
    for (const [i, col] of [[0, 0xff2030], [1, 0x2060ff]] as const) {
      const m = kit.toonUnique(col, { emissive: col, emissiveIntensity: 2 });
      sirenMats.push({ m, phase: i });
      const lens = kit.box(0.4, 0.26, Wc * 0.42, m, 0.025);
      lens.position.set(0, 0.23, (i ? 1 : -1) * Wc * 0.27);
      bar.add(lens);
      props[i ? 'lightBlue' : 'lightRed'] = lens;
    }
    const mid = kit.box(0.34, 0.2, Wc * 0.1, kit.toon(0xf4f2ea, { emissive: 0xffffff, emissiveIntensity: 0.6 }), 0.02);
    mid.position.y = 0.2;
    bar.add(mid);
    body.add(bar);
    props.lightBar = bar;
    roof.position.y += 0.24;
  }
  if (opts.barrels) {
    // Glossy black drums, cyan bands, a white highlight and a white drip/hazard splat facing the camera.
    const oil = kit.toon(0x141418), band = kit.toon(0x38e0e0), hi = kit.toon(0xffffff);
    const barrels = new THREE.Group();
    barrels.name = 'barrels';
    body.add(barrels);
    props.barrels = barrels;
    for (const [x, z, tip] of [[6, -0.42, 0], [12, 0.42, 0], [20, -0.3, 1]] as const) {
      const b = new THREE.Group();
      const drum = kit.cyl(0.32, 0.32, 0.8, oil, 22, 0.025);
      b.add(drum);
      for (const y of [-0.22, 0.22]) {
        const ring = kit.mesh(new THREE.TorusGeometry(0.325, 0.03, 6, 24).rotateX(Math.PI / 2), band, 0);
        ring.position.y = y;
        b.add(ring);
      }
      const shine = kit.box(0.05, 0.62, 0.02, spec, 0);
      shine.position.set(-0.12, 0, 0.3);
      shine.rotation.y = -0.4;
      b.add(shine);
      const splat = kit.ball(0.11, hi, 1, 0.8, 0.25, 8, 0);
      splat.position.set(0.1, 0.05, 0.3);
      splat.rotation.y = 0.3;
      b.add(splat);
      const drip = kit.ball(0.035, hi, 1, 2.6, 0.5, 6, 0);
      drip.position.set(0.12, -0.08, 0.31);
      drip.rotation.y = 0.3;
      b.add(drip);
      b.position.set(X(x), Y(8) + (tip ? 0.32 : 0.48), z);
      if (tip) b.rotation.x = Math.PI / 2;
      barrels.add(b);
    }
    // Oil drips down the flank.
    const goo = kit.toon(0x0b0b12);
    for (const [x, len] of [[24, 0.4], [36, 0.25], [52, 0.33], [8, 0.3]]) {
      const drip = kit.ball(0.07, goo, 1, len / 0.07 / 2, 0.4, 8, 0);
      drip.position.set(X(x), Y(d.belt + 1) - len / 2 + 0.05, W / 2 + 0.01);
      body.add(drip);
    }
  }
  if (opts.horns) {
    // Twin chrome air-horn trumpets on the cab roof, pointing forward (bells ~3x the old size).
    const horns = new THREE.Group();
    horns.position.copy(roof.position);
    const throat = kit.toon(0x1b1a24);
    for (const [z, len, y] of [[-0.1, 1.3, 0.62], [-0.62, 1.05, 0.48]] as const) {
      const hg = new THREE.Group();
      hg.position.set(0.45, y, z);
      const tube = kit.cyl(0.07, 0.07, len * 0.5, chrome, 10, 0.02);
      tube.rotation.z = Math.PI / 2;
      tube.position.x = -len * 0.5;
      hg.add(tube);
      const bell = kit.cyl(0.3, 0.07, len * 0.6, chrome, 14, 0.025);
      bell.rotation.z = -Math.PI / 2;
      bell.position.x = len * 0.05;
      hg.add(bell);
      const mouth = kit.cyl(0.24, 0.24, 0.02, throat, 14, 0);
      mouth.rotation.z = Math.PI / 2;
      mouth.position.x = len * 0.35 + 0.005;
      hg.add(mouth);
      const glint = kit.box(len * 0.4, 0.035, 0.03, 0xffffff, 0);
      glint.position.set(0, 0.2, 0.08);
      glint.rotation.z = -0.38;
      hg.add(glint);
      for (const px of [-len * 0.45, -len * 0.05]) {
        const strut = kit.box(0.06, y, 0.06, dark, 0.015);
        strut.position.set(px, -y / 2, 0);
        hg.add(strut);
      }
      horns.add(hg);
    }
    body.add(horns);
    props.horns = horns;
    roof.position.y += 0.18;
  }

  // Seat: hips at the driver's window sill (+Z side). See CarRigX docs in models.ts.
  const win = d.windows[d.windows.length - 1];
  const seatX = X(win.reduce((s, p) => s + p[0], 0) / win.length);
  const seat = new THREE.Object3D();
  seat.name = 'seat';
  seat.position.set(seatX, Y(yb) - 0.05, Wc * 0.22);
  body.add(seat);

  outlineTree(root, kit.outlineMat);

  let spinF = 0, spinR = 0, t = 0, siren = !!opts.lightBar;
  return {
    root, body, seat, roof, exhausts, rearContacts, props,
    setWheelSpin(front, rear = front) {
      spinF = front;
      spinR = rear;
    },
    setSteer(rad) {
      for (const s of steers) s.rotation.y = rad;
    },
    setLean(roll, pitch) {
      sprung.rotation.x = roll;
      sprung.rotation.z = pitch;
    },
    setSiren(on) {
      siren = on;
    },
    setLights(k) {
      for (const l of lightMats) l.m.emissiveIntensity = l.base * k;
    },
    update(dt) {
      t += dt;
      for (const w of wheelsF) w.rotation.z -= spinF * dt;
      for (const w of wheelsR) w.rotation.z -= spinR * dt;
      for (const s of sirenMats) {
        const on = siren && Math.floor(t * 6 + s.phase) % 2 === 0;
        s.m.emissiveIntensity = on ? 3 : 0.15;
      }
    },
    dispose() {
      root.removeFromParent();
      kit.dispose();
    },
  };
}
