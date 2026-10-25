// Body-mounted kit by tier, seated on the hand-built body with surface casts: wings (lip → pedestal → big drag /
// swan-neck, plus the paragon hoop / ACR / SVJ wings), hood pieces (bulge, cowl, scoop, shaker, ITB stacks, louvres,
// turbo, blower), front-mount intercooler, exhaust tips (single/dual/quad/side/triple), nitrous bottles in the cabin,
// splitter/canards/skirts/diffuser, carbon hood, and the chassis-mounted wheelie bar + parachute.
import * as THREE from 'three';
import type { BodyBuild, CarSpec } from '../../types';
import { extrude, merge, revolve, roundedPath, sanitize, tube, type P2, type Strip } from './geom';
import type { KitMats } from './mats';
import type { Res } from './res';
import { kitStyle, type KitStyle } from './style';
import { BodySurface } from './surface';
import { canvas, textCanvas, texFrom } from './tex';
import type { AxleSpecs, Quality } from './wheels';

export interface ExhaustTip { pos: THREE.Vector3; dir: THREE.Vector3; r: number }

export interface AddonCtx {
  build: BodyBuild;
  spec: CarSpec;
  res: Res;
  mats: KitMats;
  quality: Quality;
  inner: THREE.Group;
  chassis: THREE.Group;
  axles: AxleSpecs;
  rearAxleX: number;
  rearR: number;
}

export interface AddonsOut {
  group: THREE.Group;
  /** Body-mounted parts that move on their own (shaker scoop / blower): kept out of the static merge. */
  animated: THREE.Object3D[];
  /** Chassis-mounted wheelie bar (its own merge root), if any. */
  bar: THREE.Group | null;
  style: KitStyle;
  surface: BodySurface;
  tips: ExhaustTip[];
  afterPaint?(): void;
  update?(dt: number, s: { time: number; rpm: number; nitro: number }): void;
  setWheelie?(rad: number): void;
  /** Contact point of the wheelie-bar wheels while they touch the ground, else null. */
  wheelieBarContact?(out: THREE.Vector3): THREE.Vector3 | null;
  /** Parachute riser attach point (body space) when the car carries a chute pack. */
  chuteAttach: THREE.Vector3 | null;
  dispose?(): void;
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
/** Wheelie angle at which the wheelie-bar wheels reach the ground (world.ts WHEELIE_BAR_MAX = 3.2 deg). */
export const BAR_TOUCH = (3.2 * Math.PI) / 180;
const Z = V(0, 0, 1);

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], name: string): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/** A rounded rectangle Shape centred at (cx, cy). */
function rrect(w: number, h: number, r: number, cx = 0, cy = 0): THREE.Shape {
  const s = new THREE.Shape();
  roundedPath([[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]], r, s);
  return s;
}

/** Extrude an XY profile across the car (along Z), centred on z = 0. */
function acrossZ(shape: THREE.Shape, span: number, bevel: number, cs = 8): THREE.BufferGeometry {
  return extrude(shape, span, bevel, cs, -span / 2, 1);
}

/** Inverted (downforce) airfoil, LE at x = 0, TE at x = -chord. */
function airfoil(chord: number, thick = 0.12, camber = 0.05): THREE.Shape {
  const up: P2[] = [];
  const lo: P2[] = [];
  const N = 14;
  for (let i = 0; i <= N; i++) {
    const s = (1 - Math.cos((i / N) * Math.PI)) / 2;
    const yt = 5 * thick * chord * (0.2969 * Math.sqrt(s) - 0.126 * s - 0.3516 * s * s + 0.2843 * s ** 3 - 0.1036 * s ** 4);
    const yc = -camber * chord * 4 * s * (1 - s);
    up.push([-s * chord, yc + yt]);
    lo.push([-s * chord, yc - yt]);
  }
  const sh = new THREE.Shape();
  sh.moveTo(0, 0);
  for (const p of up) sh.lineTo(p[0], p[1]);
  for (let i = lo.length - 2; i > 0; i--) sh.lineTo(lo[i][0], lo[i][1]);
  sh.closePath();
  return sh;
}

export function buildAddons(ctx: AddonCtx): AddonsOut {
  const { build, spec, res, mats, quality: q } = ctx;
  const { dims, anchors: A } = build;
  const style = kitStyle(spec);
  const kit = new THREE.Group();
  kit.name = 'kit';
  build.body.add(kit);
  const surf = new BodySurface(build.body, new Set(build.paintMeshes), kit);
  const box = surf.box;
  const L = box.max.x - box.min.x;
  const W = box.max.z - box.min.z;
  const cs = q === 'high' ? 5 : q === 'medium' ? 3 : 2;
  const paintParts: THREE.Mesh[] = []; // body-colour add-ons: re-skinned with the livery paint
  const tips: ExhaustTip[] = [];
  const updaters: ((dt: number, s: { time: number; rpm: number; nitro: number }) => void)[] = [];
  const own = <T extends { dispose(): void }>(x: T) => res.own(x);
  const accent = mats.paint(spec.accent);
  const black = mats.paint('#141418', { finish: 'solid' });
  const finish = (f: KitStyle['wingFinish'] | KitStyle['endplate']) =>
    f === 'carbon' ? mats.carbon() : f === 'black' ? black : f === 'accent' ? accent : mats.paint(spec.paint);
  const darkPlastic = mats.plastic('#121214', 0.15);
  const surfaceY = (x: number, z: number, fallback: number) => surf.down(x, z)?.d ?? fallback;
  const mouthM = res.get('m:mouth', () => new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.95, side: THREE.DoubleSide }));

  // ---------------------------------------------------------------- deck / hood analysis
  const deckX = A.deck.x;
  const deckY0 = surfaceY(deckX, 0, A.deck.y);
  let xTail = deckX;
  for (let x = deckX; x > box.min.x - 0.01; x -= 0.01) {
    const h = surf.down(x, 0);
    if (!h || h.d < deckY0 - 0.08) break;
    xTail = x;
  }
  const halfWAt = (x: number, y: number) => {
    const l = surf.side(x, y, 1)?.d;
    const r = surf.side(x, y, -1)?.d;
    return l !== undefined && r !== undefined ? (l - r) / 2 : W / 2;
  };
  const hoodX = A.hood.x;
  let xCowl = hoodX - 0.4;
  for (let x = hoodX; x > hoodX - 1.6; x -= 0.01) {
    const h = surf.down(x, 0);
    if (!h || h.glass || h.d > A.hood.y + 0.25) break;
    xCowl = x;
  }
  let xNose = hoodX + 0.4;
  for (let x = hoodX; x < box.max.x; x += 0.01) {
    const h = surf.down(x, 0);
    if (!h || h.n.y < 0.45) break;
    xNose = x;
  }

  /** A paint-coloured bulge grown out of the surface (scoops, cowls, ducktails). h(u, v): u along x (0 at x0), v across. */
  function bulge(x0: number, x1: number, hw: number, h: (u: number, v: number) => number, nx: number, nz: number, mouth?: 'x0' | 'x1') {
    const pos: number[] = [];
    const idx: number[] = [];
    const base: THREE.Vector3[] = [];
    const top: THREE.Vector3[] = [];
    const ok: boolean[] = [];
    const ref = surf.down((x0 + x1) / 2, 0)?.d ?? A.hood.y;
    for (let i = 0; i <= nx; i++)
      for (let j = 0; j <= nz; j++) {
        const u = i / nx;
        const v = (j / nz) * 2 - 1;
        const x = x0 + (x1 - x0) * u;
        const z = v * hw;
        const hit = surf.down(x, z);
        const good = !!hit && hit.paint && hit.n.y > 0.3 && Math.abs(hit.d - ref) < 0.14;
        ok.push(good);
        const y = good ? hit!.d : ref;
        const n = good ? hit!.n : V(0, 1, 0);
        const k = h(u, v);
        const p = V(x, y, z).addScaledVector(n.y > 0.2 ? n : V(0, 1, 0), 0.002 + k);
        pos.push(p.x, p.y, p.z);
        if ((mouth === 'x0' && i === 0) || (mouth === 'x1' && i === nx)) {
          top.push(p);
          base.push(V(x, y + 0.001, z));
        }
      }
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) {
        const a = i * (nz + 1) + j;
        const b = a + nz + 1;
        if (ok[a] && ok[a + 1] && ok[b] && ok[b + 1]) idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
      sanitize(g, new THREE.Vector3(0, 1, 0));
    // flip winding if the normals point down
    const nrm = g.attributes.normal;
    if (nrm.getY(Math.floor(nrm.count / 2)) < 0) {
      const ix = g.index as THREE.BufferAttribute;
      for (let t = 0; t < ix.count; t += 3) {
        const tmp = ix.getX(t + 1);
        ix.setX(t + 1, ix.getX(t + 2));
        ix.setX(t + 2, tmp);
      }
      g.computeVertexNormals();
      sanitize(g, new THREE.Vector3(0, 1, 0));
    }
    const m = add(kit, g, mats.paint(spec.paint), 'bulge');
    paintParts.push(m);
    if (mouth && top.length) {
      const mp: number[] = [];
      const mi: number[] = [];
      top.forEach((t, j) => {
        const b = base[j];
        const inset = mouth === 'x0' ? 0.03 : -0.03;
        mp.push(t.x + inset * 0.2, t.y - 0.004, t.z, b.x + inset, b.y, b.z);
        if (j > 0) {
          const a = (j - 1) * 2;
          mi.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
        }
      });
      const mg = new THREE.BufferGeometry();
      mg.setAttribute('position', new THREE.Float32BufferAttribute(mp, 3));
      mg.setIndex(mi);
      mg.computeVertexNormals();
      sanitize(mg, new THREE.Vector3(0, 1, 0));
      add(kit, mg, mouthM, 'mouth');
    }
    return m;
  }
  const smooth = THREE.MathUtils.smoothstep;
  const edge = (v: number, k = 0.7) => smooth(1 - Math.abs(v), 0, 1 - k);

  /** Seat a group on the surface at (x, z) with the hood slope. */
  function seat(g: THREE.Object3D, x: number, z: number, fallbackY: number) {
    const h = surf.down(x, z);
    g.position.set(x, h?.d ?? fallbackY, z);
    if (h && h.n.y > 0.5) g.rotation.z = -Math.atan2(h.n.x, h.n.y);
    kit.add(g);
    return g;
  }

  // ---------------------------------------------------------------- wings
  const deckHalf = halfWAt(xTail + 0.08, deckY0 - 0.04);
  const wingSpan = Math.min(W * 0.96, deckHalf * 2 + 0.06);
  function wingAt(chord: number, h: number, aoa: number, span: number, opts: { flap?: boolean; endplate?: [number, number]; mounts: 'pedestal' | 'swan' | 'hoop' | 'tall'; xTE?: number; arch?: number }) {
    const g = new THREE.Group();
    g.name = 'wing';
    const xTE = opts.xTE ?? xTail + 0.03;
    const xLE = xTE + chord;
    const yDeck = surfaceY(xTE + chord * 0.5, 0, deckY0);
    const yW = yDeck + h;
    const wm = finish(style.wingFinish);
    const main = acrossZ(airfoil(chord, 0.11, 0.05), span, 0.003, cs);
    main.rotateZ(-aoa);
    main.translate(xLE, yW, 0);
    if (opts.arch) {
      const p = main.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + opts.arch * (1 - (p.getZ(i) / (span / 2)) ** 2));
      main.computeVertexNormals();
    }
    add(g, main, wm, 'wingMain');
    if (opts.flap) {
      const fc = chord * 0.42;
      const flap = acrossZ(airfoil(fc, 0.1, 0.06), span - 0.004, 0.002, cs);
      flap.rotateZ(-aoa * 2.6);
      flap.translate(xLE - chord * 0.86, yW + chord * 0.08, 0);
      add(g, flap, wm, 'wingFlap');
      const gurney = new THREE.BoxGeometry(0.004, 0.022, span - 0.01);
      gurney.translate(xLE - chord * 0.86 - fc * Math.cos(aoa * 2.6), yW + chord * 0.08 + fc * Math.sin(aoa * 2.6) + 0.011, 0);
      add(g, gurney, wm, 'gurney');
    }
    if (opts.endplate) {
      const [ew, eh] = opts.endplate;
      const ep = new THREE.Shape();
      const x0 = xLE + 0.03;
      const x1 = xLE - ew;
      roundedPath([[x0, yW - eh * 0.45], [x0, yW + eh * 0.25], [x1 + 0.04, yW + eh * 0.55], [x1, yW + eh * 0.55], [x1, yW - eh * 0.45]], 0.02, ep);
      const em = finish(style.endplate);
      for (const s of [-1, 1]) {
        const eg = extrude(ep, 0.008, 0.002, cs, s * (span / 2) - 0.004 + s * 0.004);
        add(g, eg, em, 'endplate');
      }
    }
    // mounts
    const spread = Math.min(span * 0.32, 0.42);
    const mountM = opts.mounts === 'hoop' ? mats.paint(spec.paint) : style.wingFinish === 'carbon' ? mats.carbon() : black;
    for (const s of [-1, 1]) {
      const zm = opts.mounts === 'hoop' ? s * (span / 2 - 0.04) : s * spread;
      const xm = xTE + chord * 0.55;
      const yb = surfaceY(xm, zm, deckY0) - 0.01;
      const top = yW + (opts.arch ? 0 : 0) - (opts.mounts === 'swan' ? -0.02 : chord * 0.06);
      const sh = new THREE.Shape();
      if (opts.mounts === 'swan') {
        // swan neck: rises behind the wing and hooks over onto its upper surface
        const xf = xTE + chord * 0.15;
        sh.moveTo(xf + 0.05, yb);
        sh.quadraticCurveTo(xf - 0.05, yb + (top - yb) * 0.55, xf - 0.02, top + 0.05);
        sh.quadraticCurveTo(xf + 0.02, top + 0.095, xf + chord * 0.5, top + 0.035);
        sh.lineTo(xf + chord * 0.5, top + 0.008);
        sh.quadraticCurveTo(xf + 0.03, top + 0.045, xf + 0.02, top + 0.02);
        sh.quadraticCurveTo(xf + 0.0, yb + (top - yb) * 0.5, xf + 0.12, yb);
        sh.closePath();
      } else if (opts.mounts === 'hoop') {
        const w0 = chord * 0.9;
        roundedPath([[xm - w0 * 0.55, yb], [xm + w0 * 0.45, yb], [xm + w0 * 0.3, yW + 0.02], [xm - w0 * 0.55, yW + 0.03]], 0.03, sh);
      } else {
        const w0 = opts.mounts === 'tall' ? 0.16 : 0.12;
        roundedPath([[xm - w0 / 2, yb], [xm + w0 / 2, yb], [xm + w0 * 0.25, top], [xm - w0 * 0.45, top]], 0.012, sh);
      }
      const th = opts.mounts === 'hoop' ? 0.05 : 0.014;
      const mg = extrude(sh, th, opts.mounts === 'hoop' ? 0.015 : 0.003, cs, zm - th / 2);
      const mm = add(g, mg, mountM, 'wingMount');
      if (opts.mounts === 'hoop') paintParts.push(mm);
      if (opts.mounts !== 'hoop' && q !== 'low') {
        // foot plate + bolts
        const foot = new THREE.BoxGeometry(0.16, 0.01, 0.05);
        foot.translate(xm, yb + 0.012, zm);
        add(g, foot, black, 'wingFoot');
      }
    }
    if (opts.mounts === 'hoop') paintParts.push(g.children[0] as THREE.Mesh);
    kit.add(g);
    return g;
  }
  switch (style.wing) {
    case 'lip': {
      // ducktail: a kicked-up lip grown from the trailing edge of the deck
      const x0 = xTail - 0.005;
      const x1 = xTail + 0.2;
      bulge(x0, x1, deckHalf - 0.05, (u, v) => 0.05 * Math.pow(1 - u, 1.6) * edge(v, 0.85), 6, 12);
      break;
    }
    case 'pedestal':
      wingAt(0.24, 0.17, 0.12, wingSpan * 0.9, { mounts: 'pedestal', endplate: [0.3, 0.12] });
      break;
    case 'big':
      wingAt(0.3, 0.36, 0.16, Math.min(W * 0.98, wingSpan + 0.04), { flap: true, mounts: 'tall', endplate: [0.36, 0.2] });
      break;
    case 'swan':
      wingAt(0.27, 0.26, 0.14, wingSpan, { flap: true, mounts: 'swan', endplate: [0.34, 0.18] });
      break;
    case 'hoop':
      wingAt(0.2, 0.2, 0.08, deckHalf * 2 - 0.02, { mounts: 'hoop', arch: 0.035 });
      break;
    case 'acr':
      wingAt(0.34, 0.4, 0.17, Math.min(W * 1.02, wingSpan + 0.12), { flap: true, mounts: 'tall', endplate: [0.46, 0.3], xTE: xTail - 0.04 });
      break;
    case 'svj':
      wingAt(0.28, 0.2, 0.12, wingSpan * 0.96, { flap: true, mounts: 'pedestal', endplate: [0.34, 0.16] });
      break;
  }

  // ---------------------------------------------------------------- hood
  const hoodHW = Math.min(0.42 * W, 0.8);
  // mid-engine cars (wedge, hyper) wear their induction on the ENGINE COVER behind the cabin, not on the front lid
  const mid = spec.body === 'wedge' || spec.body === 'hyper';
  const engX = A.deck.x + (A.roof.x - A.deck.x) * 0.45;
  const hy = mid ? surfaceY(engX, 0, A.deck.y) : A.hood.y;
  const pc0 = mid ? engX - 0.42 : xCowl; // piece region (rear edge .. front edge)
  const pc1 = mid ? engX + 0.38 : xNose;
  const hoodLen = pc1 - pc0;
  const hx = mid ? engX : THREE.MathUtils.clamp(hoodX, xCowl + 0.3, xNose - 0.3);
  let shaker: THREE.Object3D | null = null;
  let blowerBelt: THREE.Object3D | null = null;
  switch (style.hood) {
    case 'bulge':
      bulge(pc0 + 0.04, pc0 + hoodLen * 0.8, hoodHW * 0.55, (u, v) => 0.028 * smooth(u, 0, 0.35) * smooth(u, 1, 0.75) * edge(v, 0.55), 12, 9);
      break;
    case 'cowl':
      // rear-facing cowl induction: rises toward the windshield, mouth at the back
      bulge(pc0 + 0.02, pc0 + hoodLen * 0.72, hoodHW * 0.5, (u, v) => 0.055 * Math.pow(1 - u, 0.8) * smooth(u, 1, 0.7) * edge(v, 0.6), 12, 9, 'x0');
      break;
    case 'scoop':
      // forward-facing ram-air scoop: mouth at the front
      bulge(hx - 0.36, hx + 0.24, hoodHW * 0.42, (u, v) => 0.065 * smooth(u, 0, 0.9) * edge(v, 0.55), 12, 9, 'x1');
      break;
    case 'shaker': {
      const g = new THREE.Group();
      const prof = new THREE.Shape();
      roundedPath([[-0.2, 0], [0.18, 0], [0.24, 0.14], [0.16, 0.17], [-0.16, 0.15], [-0.22, 0.08]], 0.03, prof);
      const body = acrossZ(prof, 0.44, 0.022, cs);
      add(g, body, mats.plastic('#16161a', 0.35), 'shaker');
      const mouth = new THREE.PlaneGeometry(0.36, 0.1);
      mouth.rotateY(Math.PI / 2);
      mouth.translate(0.2265, 0.085, 0);
      mouth.rotateZ(0);
      add(g, mouth, mouthM, 'shakerMouth');
      const ring = revolve([{ pts: [[0.25, 0], [0.26, 0.012], [0.235, 0.02]] }], 28);
      ring.rotateX(-Math.PI / 2);
      ring.scale(1, 1, 1);
      add(g, ring, mats.chrome(), 'shakerRing');
      const gg = new THREE.Group();
      gg.add(g);
      seat(gg, hx - 0.05, 0, hy);
      shaker = g;
      break;
    }
    case 'itb': {
      const g = new THREE.Group();
      const plate = extrude(rrect(0.5, 0.34, 0.04), 0.02, 0.006, cs);
      plate.rotateX(-Math.PI / 2);
      add(g, plate, darkPlastic, 'itbPlate');
      const stack = res.get(`g:stack:${q}`, () =>
        revolve([{ pts: [[0.03, -0.02], [0.03, 0.06], [0.034, 0.09], [0.05, 0.11], [0.056, 0.118], [0.05, 0.122], [0.04, 0.112], [0.026, 0.09], [0.024, 0.0]] }], q === 'low' ? 10 : 16),
      );
      for (let i = 0; i < 8; i++) {
        const m = add(g, stack, mats.chrome(), 'stack');
        m.rotation.x = -Math.PI / 2;
        m.position.set(-0.18 + (i % 4) * 0.12, 0.012, i < 4 ? -0.075 : 0.075);
      }
      seat(g, hx, 0, hy);
      break;
    }
    case 'vents':
    case 'turbo': {
      const g = new THREE.Group();
      const pw = 0.46;
      const pd = Math.min(0.5, hoodLen * 0.42);
      const frame = new THREE.Shape();
      roundedPath([[-pd / 2, -pw / 2], [pd / 2, -pw / 2], [pd / 2, pw / 2], [-pd / 2, pw / 2]], 0.03, frame);
      frame.holes.push(roundedPath([[-pd / 2 + 0.03, -pw / 2 + 0.03], [pd / 2 - 0.03, -pw / 2 + 0.03], [pd / 2 - 0.03, pw / 2 - 0.03], [-pd / 2 + 0.03, pw / 2 - 0.03]], 0.015));
      const fg = extrude(frame, 0.018, 0.005, cs);
      fg.rotateX(-Math.PI / 2);
      add(g, fg, black, 'ventFrame');
      const cav = new THREE.BoxGeometry(pd - 0.05, 0.08, pw - 0.05);
      cav.translate(0, -0.035, 0);
      add(g, cav, res.get('m:cavity', () => new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 1, side: THREE.BackSide })), 'ventCavity');
      const n = 7;
      for (let i = 0; i < n; i++) {
        const slat = new THREE.BoxGeometry(0.05, 0.004, pw - 0.06);
        slat.rotateZ(0.6);
        slat.translate(-pd / 2 + 0.05 + (i * (pd - 0.1)) / (n - 1), 0.012, 0);
        add(g, slat, black, 'louvre');
      }
      if (style.hood === 'turbo') {
        // the snail: polished compressor cover + inlet, hot side behind it (visible between the louvres)
        const cover = new THREE.TorusGeometry(0.07, 0.032, 12, 28);
        cover.translate(0, -0.03, -0.06);
        add(g, cover, mats.polished(), 'turboComp');
        const inlet = revolve([{ pts: [[0.045, 0], [0.045, 0.05], [0.055, 0.065], [0.048, 0.07], [0.038, 0.06], [0.036, 0.0]] }], 28);
        inlet.translate(0, -0.03, -0.06 + 0.02);
        add(g, inlet, mats.polished(), 'turboInlet');
        const hot = new THREE.TorusGeometry(0.065, 0.03, 10, 24);
        hot.translate(0, -0.03, 0.08);
        add(g, hot, res.get('m:turboHot', () => new THREE.MeshStandardMaterial({ color: 0x2a2018, metalness: 0.6, roughness: 0.6, emissive: 0xff3a08, emissiveIntensity: 0.25 })), 'turboHot');
      }
      seat(g, hx, 0, hy);
      break;
    }
    case 'blower': {
      const g = new THREE.Group();
      const plate = extrude(rrect(0.6, 0.36, 0.05), 0.025, 0.006, cs);
      plate.rotateX(-Math.PI / 2);
      add(g, plate, black, 'blowerPlate');
      // intake manifold + roots case (polished), ribbed sides
      const manifold = extrude(rrect(0.56, 0.3, 0.05), 0.06, 0.01, cs);
      manifold.rotateX(-Math.PI / 2);
      manifold.translate(0, 0.025, 0);
      add(g, manifold, mats.polished(), 'manifold');
      const sec = rrect(0.28, 0.17, 0.07, 0, 0.085 + 0.085);
      const caseG = extrude(sec, 0.5, 0.012, cs, -0.25);
      caseG.rotateY(Math.PI / 2);
      add(g, caseG, mats.polished(), 'blowerCase');
      if (q !== 'low') {
        const ribs: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 9; i++)
          for (const s of [-1, 1]) {
            const r = new THREE.BoxGeometry(0.012, 0.13, 0.014);
            r.translate(-0.2 + i * 0.05, 0.17, s * 0.147);
            ribs.push(r);
          }
        add(g, merge(ribs), mats.polished(), 'blowerRibs');
      }
      // snout, pulley + belt into the engine bay
      const snout = new THREE.CylinderGeometry(0.05, 0.06, 0.08, 20);
      snout.rotateZ(Math.PI / 2);
      snout.translate(0.29, 0.12, 0);
      add(g, snout, mats.polished(), 'snout');
      const pulley = new THREE.CylinderGeometry(0.075, 0.075, 0.05, 32);
      pulley.rotateZ(Math.PI / 2);
      pulley.translate(0.35, 0.12, 0);
      add(g, pulley, mats.machined(), 'pulley');
      const belt = tube([V(0.35, 0.2, 0), V(0.36, 0.1, 0.02), V(0.37, -0.15, 0.03)], 0.012, 6, 8);
      blowerBelt = add(g, belt, mats.plastic('#0a0a0c', 0.1), 'belt');
      // the hat: accent scoop with a dark mouth and butterflies
      const hat = new THREE.Shape();
      roundedPath([[-0.19, 0], [0.16, 0], [0.2, 0.15], [0.12, 0.16], [-0.17, 0.12]], 0.025, hat);
      const hatG = acrossZ(hat, 0.3, 0.018, cs);
      hatG.translate(0, 0.255, 0);
      add(g, hatG, accent, 'hat');
      const mouth = new THREE.PlaneGeometry(0.24, 0.11);
      mouth.rotateY(Math.PI / 2);
      mouth.rotateZ(-0.35);
      mouth.translate(0.185, 0.335, 0);
      add(g, mouth, mouthM, 'hatMouth');
      for (let i = 0; i < 3; i++) {
        const fly = new THREE.BoxGeometry(0.004, 0.09, 0.06);
        fly.rotateZ(-0.35);
        fly.translate(0.172, 0.335, -0.08 + i * 0.08);
        add(g, fly, mats.chrome(), 'butterfly');
      }
      seat(g, hx, 0, hy);
      shaker = g;
      break;
    }
  }

  // ---------------------------------------------------------------- front: intercooler, splitter, canards, grille
  const yBumper = A.frontBumper.y;
  if (style.intercooler) {
    const yc = yBumper + 0.02;
    const xf = surf.front(yc, 0)?.d ?? A.frontBumper.x;
    let half = 0.1;
    for (let z = 0.1; z < W * 0.4; z += 0.02) {
      const h = surf.front(yc, z)?.d;
      if (h === undefined || xf - h > 0.02) break;
      half = z;
    }
    const cw = Math.min(half * 2, W * 0.36);
    const ch = 0.15;
    const g = new THREE.Group();
    const finTex = res.get('t:icfins', () => {
      const [c, x] = canvas(256, 128);
      x.fillStyle = '#9a9aa2';
      x.fillRect(0, 0, 256, 128);
      for (let i = 0; i < 128; i += 4) {
        x.fillStyle = '#2c2c32';
        x.fillRect(0, i, 256, 2);
      }
      for (let i = 0; i < 256; i += 16) {
        x.fillStyle = '#c4c4cc';
        x.fillRect(i, 0, 3, 128);
      }
      const t = texFrom(c, { srgb: true, wrapS: true, wrapT: true });
      t.repeat.set(3, 2);
      return t;
    });
    const coreM = res.get('m:iccore', () => new THREE.MeshStandardMaterial({ map: finTex, metalness: 0.7, roughness: 0.5 }));
    const core = new THREE.BoxGeometry(0.05, ch, cw);
    add(g, core, coreM, 'icCore');
    for (const s of [-1, 1]) {
      const tank = new THREE.CylinderGeometry(0.035, 0.035, ch + 0.02, 16);
      tank.translate(-0.005, 0, s * (cw / 2 + 0.03));
      add(g, tank, mats.machined(), 'icTank');
      const pipe = tube([V(-0.03, 0.04 * s, s * (cw / 2 + 0.03)), V(-0.16, 0.05 * s, s * (cw / 2 + 0.03)), V(-0.38, 0.06 * s, s * (cw / 2 - 0.06))], 0.028, 8, 8);
      add(g, pipe, mats.polished(), 'icPipe');
    }
    // recessed behind the bumper face: it shows through the mouth instead of hanging in front like a bull bar
    g.position.set(xf - 0.05, yc, 0);
    kit.add(g);
  }
  if (style.sideIntakes && spec.paragon !== 'lamberghoul') {
    const x = (A.wheelRL.x + ctx.rearR) + 0.32;
    const y = Math.max(dims.rideHeight + 0.25, A.wheelRL.y + 0.12);
    const finTex = res.get('t:icfins', () => {
      const [c, gx] = canvas(256, 128);
      gx.fillStyle = '#9a9aa2';
      gx.fillRect(0, 0, 256, 128);
      for (let i = 0; i < 128; i += 4) {
        gx.fillStyle = '#2c2c32';
        gx.fillRect(0, i, 256, 2);
      }
      const t = texFrom(c, { srgb: true, wrapS: true, wrapT: true });
      t.repeat.set(3, 2);
      return t;
    });
    const coreM = res.get('m:iccore', () => new THREE.MeshStandardMaterial({ map: finTex, metalness: 0.7, roughness: 0.5 }));
    for (const s of [-1, 1]) {
      const h = surf.side(x, y, s);
      if (!h) continue;
      const duct = new THREE.Group();
      const sh = new THREE.Shape();
      roundedPath([[0.2, -0.1], [-0.18, -0.1], [-0.24, 0.09], [0.08, 0.11]], 0.025, sh);
      const lip = extrude(sh, 0.035, 0.008, cs, -0.0175);
      add(duct, lip, black, 'sideDuct');
      const core = new THREE.PlaneGeometry(0.3, 0.15);
      const cm = add(duct, core, coreM, 'sideCore');
      cm.position.set(-0.02, 0.0, 0.019);
      duct.position.set(x, y, h.d - s * 0.012);
      if (s < 0) duct.rotation.y = Math.PI;
      duct.rotation.y += s * 0.1;
      kit.add(duct);
    }
  }
  // splitter: traced from the bumper's plan outline just above its lowest edge
  let ySplit = Math.max(0.05, (surf.up(box.max.x - 0.12, 0)?.d ?? yBumper - 0.08) - 0.006);
  if (style.splitter > 0) {
    const ext = style.splitter === 2 ? 0.08 : 0.04;
    const depth = 0.32;
    const zs: number[] = [];
    const xs: number[] = [];
    const maxZ = W * 0.46;
    for (let z = -maxZ; z <= maxZ + 1e-6; z += maxZ / 12) {
      const h = surf.front(ySplit + 0.03, z)?.d;
      if (h === undefined) continue;
      zs.push(z);
      xs.push(h);
    }
    if (zs.length > 3) {
      const pts: P2[] = [];
      zs.forEach((z, i) => pts.push([xs[i] + ext * (1 - 0.4 * Math.abs(z / maxZ) ** 2), -z]));
      for (let i = zs.length - 1; i >= 0; i--) pts.push([xs[i] - depth, -zs[i]]);
      const sh = new THREE.Shape();
      roundedPath(pts, 0.03, sh);
      const sg = extrude(sh, 0.014, 0.003, cs);
      sg.rotateX(-Math.PI / 2);
      sg.translate(0, ySplit - 0.012, 0);
      add(kit, sg, style.splitter === 2 || spec.parts.carbon ? mats.carbon() : black, 'splitter');
      if (style.canards) {
        for (const s of [-1, 1]) {
          const zc = s * zs[zs.length - 1] * 0.92;
          const xc = surf.front(ySplit + 0.12, zc)?.d ?? xs[0];
          for (let k = 0; k < 2; k++) {
            const cg = new THREE.Shape();
            roundedPath([[0, 0], [-0.16, 0], [-0.16, 0.012], [0, 0.02]], 0.004, cg);
            const c3 = extrude(cg, 0.004, 0.001, 4);
            c3.rotateX(-Math.PI / 2);
            c3.rotateZ(0.18);
            c3.translate(xc + 0.03, ySplit + 0.1 + k * 0.08, zc);
            add(kit, c3, mats.carbon(), 'canard');
          }
        }
      }
    }
  }
  // grille: black out or honeycomb a mesh the modeler named 'grille'
  if (style.grille) {
    const grilleM = mats.grille(style.grille === 'honeycomb' ? 'honeycomb' : 'slats');
    build.body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && /grille/i.test(o.name)) (o as THREE.Mesh).material = style.grille === 'black' ? black : grilleM;
    });
  }

  // ---------------------------------------------------------------- sides & rear: skirts, diffuser
  const xRw = A.wheelRL.x;
  const xFw = A.wheelFL.x;
  if (style.skirts) {
    // side skirts: a lofted blade along each sill between the wheels (cross-section re-fitted every 5 cm)
    const prof: P2[] = [[0, 0.07], [0.012, 0.07], [0.03, 0.0], [0.035, -0.03], [0.0, -0.035]]; // (out, up) from the sill corner
    for (const s of [-1, 1]) {
      const x0 = xRw + ctx.rearR + 0.06;
      const x1 = xFw - ctx.axles.front.R - 0.06;
      if (x1 - x0 < 0.3) continue;
      const pos: number[] = [];
      const idx: number[] = [];
      const n = Math.max(4, Math.round((x1 - x0) / 0.05));
      // sill height: the median underside hit near the rocker, ignoring mirrors/handles above it
      const ys: number[] = [];
      for (let i = 0; i <= 8; i++) {
        const h = surf.up(x0 + ((x1 - x0) * i) / 8, s * (W / 2 - 0.12));
        if (h && h.d < dims.rideHeight + 0.22) ys.push(h.d);
      }
      ys.sort((p, q2) => p - q2);
      const ySill = Math.max(0.08, (ys.length ? ys[Math.floor(ys.length / 2)] : dims.rideHeight) + 0.005);
      const zs: number[] = [];
      for (let i = 0; i <= n; i++) {
        const h = surf.side(x0 + ((x1 - x0) * i) / n, ySill + 0.035, s);
        zs.push(h && Math.abs(h.d) <= W / 2 + 0.02 && Math.abs(h.d) > W / 2 - 0.25 ? h.d : NaN);
      }
      // fill misses from neighbours, then smooth
      const okZ = zs.filter((z) => !Number.isNaN(z));
      const zDef = okZ.length ? okZ.reduce((p, q2) => p + q2, 0) / okZ.length : s * (W / 2 - 0.02);
      for (let i = 0; i <= n; i++) if (Number.isNaN(zs[i])) zs[i] = zDef;
      const zSm = zs.map((_, i) => (zs[Math.max(0, i - 1)] + 2 * zs[i] + zs[Math.min(n, i + 1)]) / 4);
      for (let i = 0; i <= n; i++) {
        const x = x0 + ((x1 - x0) * i) / n;
        const zo = zSm[i];
        for (const [o, u] of prof) pos.push(x, ySill + u, zo + s * (o - 0.012));
      }
      const m = prof.length;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < m - 1; j++) {
          const a0 = i * m + j;
          const b0 = a0 + m;
          if (s > 0) idx.push(a0, a0 + 1, b0, b0, a0 + 1, b0 + 1);
          else idx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1);
        }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      sg.setIndex(idx);
      sg.computeVertexNormals();
      sanitize(sg, new THREE.Vector3(0, 1, 0));
      add(kit, sg, style.splitter === 2 || spec.parts.carbon ? mats.carbon() : black, 'skirt');
    }
  }
  if (style.diffuser) {
    const xr = box.min.x;
    const yu = surf.up(xr + 0.15, 0)?.d ?? 0.3;
    const fins: THREE.BufferGeometry[] = [];
    const nf = 5;
    for (let i = 0; i < nf; i++) {
      const z = (i / (nf - 1) - 0.5) * W * 0.55;
      const sh = new THREE.Shape();
      sh.moveTo(xr + 0.02, yu);
      sh.lineTo(xr + 0.42, yu);
      sh.lineTo(xr + 0.02, Math.max(0.08, yu - 0.14));
      sh.closePath();
      fins.push(extrude(sh, 0.008, 0.002, 4, z - 0.004));
    }
    const plate = new THREE.BoxGeometry(0.42, 0.008, W * 0.6);
    plate.rotateZ(-0.3);
    plate.translate(xr + 0.22, yu - 0.06, 0);
    fins.push(plate);
    add(kit, merge(fins), mats.carbon(), 'diffuser');
  }

  // ---------------------------------------------------------------- exhaust tips
  const tipMetal = res.get(`m:tip:${style.exhaust}`, () => {
    if (style.exhaust === 'stock') return new THREE.MeshStandardMaterial({ color: 0x8a8a90, metalness: 0.8, roughness: 0.55 });
    if (style.exhaust === 'dual') {
      // burnt titanium: steel → gold → blue → purple toward the tip
      const [c, x] = canvas(8, 256);
      const gr = x.createLinearGradient(0, 256, 0, 0);
      gr.addColorStop(0, '#c8c8cc');
      gr.addColorStop(0.55, '#c8c8cc');
      gr.addColorStop(0.68, '#d8b46a');
      gr.addColorStop(0.8, '#7a4aa8');
      gr.addColorStop(0.92, '#3a64c8');
      gr.addColorStop(1, '#8aa8e0');
      x.fillStyle = gr;
      x.fillRect(0, 0, 8, 256);
      const t = texFrom(c, { srgb: true });
      const m = new THREE.MeshPhysicalMaterial({ map: t, metalness: 1, roughness: 0.18, clearcoat: 0.5 });
      const d = m.dispose.bind(m);
      m.dispose = () => (d(), t.dispose());
      return m;
    }
    return new THREE.MeshPhysicalMaterial({ color: 0xf0f0f4, metalness: 1, roughness: 0.07, clearcoat: 0.3 });
  });
  const soot = res.get('m:soot', () => new THREE.MeshStandardMaterial({ color: 0x0c0b0a, roughness: 0.95, metalness: 0.2 }));
  const tipGlow = own(new THREE.MeshStandardMaterial({ color: 0x050506, emissive: 0x3a6cff, emissiveIntensity: 0, roughness: 1 }));
  function tipGeo(r: number, len: number, rolled: boolean): THREE.BufferGeometry {
    return res.get(`g:tip:${r.toFixed(3)}:${len.toFixed(3)}:${rolled ? 1 : 0}:${q}`, () => {
      const segs = q === 'low' ? 10 : 16;
      const strips: Strip[] = rolled
        ? [
            { pts: [[r, -len], [r, -0.012]], mat: 0, v: (_r, z) => (z + len) / len },
            { pts: [[r, -0.012], [r + 0.004, -0.006], [r + 0.002, 0.0], [r - 0.004, 0.001], [r - 0.007, -0.004]], mat: 0, v: () => 0.99 },
            { pts: [[r - 0.007, -0.004], [r - 0.007, -len * 0.8]], mat: 1 },
          ]
        : [
            { pts: [[r, -len], [r, 0]], mat: 0, v: (_r, z) => (z + len) / len },
            { pts: [[r, 0], [r - 0.003, 0]], mat: 0 },
            { pts: [[r - 0.003, 0], [r - 0.003, -len * 0.8]], mat: 1 },
          ];
      return revolve(strips, segs);
    });
  }
  const glowDisc = (r: number) => res.get(`g:tipglow:${r.toFixed(3)}`, () => new THREE.CircleGeometry(r, 16));
  function addTip(pos: THREE.Vector3, dir: THREE.Vector3, r: number, len: number, rolled: boolean) {
    const g = new THREE.Group();
    g.position.copy(pos);
    g.quaternion.setFromUnitVectors(Z, dir.clone().normalize());
    add(g, tipGeo(r, len, rolled), [tipMetal, soot], 'exhaustTip');
    const gd = add(g, glowDisc(r - 0.008), tipGlow, 'tipGlow');
    gd.position.z = -0.05;
    gd.castShadow = false;
    kit.add(g);
    tips.push({ pos: pos.clone().addScaledVector(dir, 0.005), dir: dir.clone().normalize(), r });
  }
  const anchors = A.exhausts.length ? A.exhausts : [{ pos: V(box.min.x + 0.05, 0.3, -0.4), dir: V(-1, 0, 0) }];
  const rearAnchors = anchors.filter((a) => Math.abs(a.dir.z) < 0.7);
  const sideAnchors = anchors.filter((a) => Math.abs(a.dir.z) >= 0.7);
  const rearOf = (a: { pos: THREE.Vector3 }) => {
    // tip sits just proud of the rear bumper surface at that height
    const xr = surf.front(a.pos.y, a.pos.z, -1)?.d;
    return V(Math.min(a.pos.x, (xr ?? a.pos.x) + 0.04), a.pos.y, a.pos.z);
  };
  const ex = style.exhaust;
  if (ex === 'side') {
    const list = sideAnchors.length ? sideAnchors : [1, -1].map((s) => ({ pos: V(xRw + ctx.rearR + 0.12, Math.max(0.18, dims.rideHeight + 0.05), s * (W / 2 + 0.01)), dir: V(-0.2, 0, s).normalize() }));
    for (const a of list) {
      const s = Math.sign(a.pos.z) || 1;
      const zs = a.pos.z;
      const x0 = a.pos.x;
      const x1 = Math.min(xFw - ctx.axles.front.R - 0.12, x0 + 1.0);
      const pipe = new THREE.CylinderGeometry(0.045, 0.045, x1 - x0, 20);
      pipe.rotateZ(Math.PI / 2);
      pipe.translate((x0 + x1) / 2, a.pos.y, zs);
      add(kit, pipe, mats.chrome(), 'sidePipe');
      const shieldTex = res.get('t:shield', () => {
        const [c, x] = canvas(256, 64);
        x.fillStyle = '#d0d0d6';
        x.fillRect(0, 0, 256, 64);
        x.fillStyle = '#1a1a1e';
        for (let i = 0; i < 32; i++) for (let j = 0; j < 6; j++) {
          x.beginPath();
          x.arc(4 + i * 8 + (j % 2) * 4, 6 + j * 10, 2.4, 0, Math.PI * 2);
          x.fill();
        }
        return texFrom(c, { srgb: true, wrapS: true });
      });
      const shieldM = res.get('m:shield', () => new THREE.MeshStandardMaterial({ map: shieldTex, metalness: 0.9, roughness: 0.25 }));
      const shield = new THREE.CylinderGeometry(0.056, 0.056, (x1 - x0) * 0.7, 20, 1, true, s > 0 ? -Math.PI * 0.1 : Math.PI * 0.9, Math.PI * 1.2);
      shield.rotateZ(Math.PI / 2);
      shield.translate((x0 + x1) / 2 + 0.05, a.pos.y, zs);
      add(kit, shield, shieldM, 'heatShield');
      addTip(V(x0, a.pos.y, zs), V(-0.55, 0, s * 0.83).normalize(), 0.05, 0.12, true);
    }
  } else if (ex === 'triple' || ex === 'center2') {
    const a = rearAnchors[0] ?? anchors[0];
    const y = ex === 'center2' ? Math.max(a.pos.y, A.taillights[0]?.y ?? a.pos.y) : a.pos.y;
    const offs = ex === 'triple' ? [-0.1, 0, 0.1] : [-0.075, 0.075];
    for (const dz of offs) addTip(rearOf({ pos: V(a.pos.x, y, dz) }), V(-1, 0, 0), ex === 'triple' && dz === 0 ? 0.034 : 0.042, 0.12, true);
  } else {
    let list = rearAnchors.length ? rearAnchors : anchors;
    if (ex === 'quad' && list.length === 1) list = [list[0], { pos: list[0].pos.clone().setZ(-list[0].pos.z || 0.4), dir: list[0].dir.clone().setZ(-list[0].dir.z) }];
    for (const a of list) {
      const p = rearOf(a);
      const d = a.dir.clone().normalize();
      if (ex === 'stock') addTip(p.clone().add(V(0.03, -0.01, 0)), d.clone().add(V(0, -0.35, 0)).normalize(), 0.024, 0.1, false);
      else if (ex === 'single') addTip(p, d, 0.046, 0.12, true);
      else {
        const n = 2;
        const r = ex === 'quad' ? 0.048 : 0.04;
        const gap = r * 2 + 0.014;
        for (let i = 0; i < n; i++) addTip(p.clone().add(V(0, 0, (i - (n - 1) / 2) * gap)), d, r, 0.12, true);
      }
    }
  }

  // ---------------------------------------------------------------- nitrous bottles
  if (style.nitrous) {
    const bottle = res.get(`g:n2o:${q}`, () =>
      revolve(
        [{ pts: [[0.0005, 0], [0.04, 0.003], [0.062, 0.02], [0.068, 0.05], [0.068, 0.4], [0.06, 0.44], [0.035, 0.465], [0.018, 0.475], [0.018, 0.5], [0.0005, 0.5]] }],
        q === 'low' ? 10 : 18,
      ),
    );
    const blue = mats.paint('#2457d6', { finish: 'metallic' });
    const labelM = res.get('m:n2oLabel', () => {
      const t = texFrom(textCanvas('NITROUS OXIDE', { w: 512, h: 96, color: '#1c1a24', bg: '#f4f2ea' }), { srgb: true, wrapS: true });
      t.repeat.x = 2;
      const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 });
      const d = m.dispose.bind(m);
      m.dispose = () => (d(), t.dispose());
      return m;
    });
    const label = res.get('g:n2oLabelG', () => new THREE.CylinderGeometry(0.0695, 0.0695, 0.12, 18, 1, true));
    const valve = res.get('g:n2oValve', () => {
      const a = new THREE.CylinderGeometry(0.014, 0.014, 0.05, 12);
      a.translate(0, 0.52, 0);
      const b = new THREE.CylinderGeometry(0.03, 0.03, 0.01, 16);
      b.translate(0, 0.548, 0);
      const c = new THREE.BoxGeometry(0.06, 0.012, 0.012);
      c.translate(0.03, 0.53, 0);
      return merge([a, b, c], true);
    });
    const g = new THREE.Group();
    g.name = 'nitrous';
    const lying = ['tuner', 'super', 'hyper', 'wedge'].includes(spec.body);
    for (const s of [-1, 1]) {
      const b = new THREE.Group();
      add(b, bottle, blue, 'n2o');
      const lm = add(b, label, labelM, 'n2oLabel');
      lm.position.y = 0.24;
      add(b, valve, mats.chrome(), 'n2oValve');
      for (const y of [0.12, 0.36]) {
        const strap = new THREE.Mesh(res.get('g:strap', () => new THREE.CylinderGeometry(0.071, 0.071, 0.025, 18, 1, true)), black);
        strap.position.y = y;
        b.add(strap);
      }
      if (lying) {
        b.rotation.x = s * Math.PI / 2;
        b.position.set(0, 0, -s * 0.03);
        b.position.x = s * 0.08;
      } else b.position.set(0, 0, s * 0.16);
      g.add(b);
    }
    if (spec.body === 'truck') {
      const xb = A.seat.x - 1.45;
      g.position.set(xb, surfaceY(xb, 0.3, A.seat.y - 0.8) + 0.002, 0);
      g.rotation.y = Math.PI / 2;
    } else if (lying) g.position.set(A.seat.x - 0.34, A.seat.y - 0.52, 0);
    else g.position.set(A.seat.x - 0.66, A.seat.y - 0.74, 0);
    // braided line forward to the engine
    if (q !== 'low') {
      const line = tube([V(0, 0.55, 0.16), V(0.25, 0.3, 0.2), V(0.6, 0.05, 0.3), V(1.2, 0.0, 0.32)], 0.006, 5, 12);
      add(g, line, mats.brushed('#7a7a84'), 'n2oLine');
    }
    kit.add(g);
  }

  // ---------------------------------------------------------------- carbon hood
  let carbonShell: THREE.Mesh | null = null;
  if (style.carbonHood) {
    let found = false;
    build.body.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && o.name === 'hood') {
        (o as THREE.Mesh).material = mats.carbon();
        const i = build.paintMeshes.indexOf(o as THREE.Mesh);
        if (i >= 0) build.paintMeshes.splice(i, 1);
        found = true;
      }
    });
    if (!found) {
      // conformal carbon panel over the hood (between the cowl and the nose, inside the shut lines)
      const nx = q === 'low' ? 10 : q === 'medium' ? 16 : 22;
      const nz = q === 'low' ? 6 : q === 'medium' ? 10 : 14;
      const x0 = xCowl + 0.03;
      const x1 = xNose - 0.03;
      const hw = hoodHW;
      const pos: number[] = [];
      const ok: boolean[] = [];
      for (let i = 0; i <= nx; i++)
        for (let j = 0; j <= nz; j++) {
          const x = x0 + ((x1 - x0) * i) / nx;
          const z = (j / nz - 0.5) * 2 * hw;
          const h = surf.down(x, z);
          const n = h?.n ?? V(0, 1, 0);
          const y = h?.d ?? A.hood.y;
          pos.push(x + n.x * 0.003, y + n.y * 0.003, z + n.z * 0.003);
          ok.push(!!h && h.paint && n.y > 0.4);
        }
      const idx: number[] = [];
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < nz; j++) {
          const a = i * (nz + 1) + j;
          const b = a + nz + 1;
          if (ok[a] && ok[a + 1] && ok[b] && ok[b + 1]) idx.push(a, a + 1, b, b, a + 1, b + 1);
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      sanitize(g, new THREE.Vector3(0, 1, 0));
      const nrm = g.attributes.normal;
      if (idx.length && nrm.getY(idx[0]) < 0) {
        for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
        g.setIndex(idx);
        g.computeVertexNormals();
      sanitize(g, new THREE.Vector3(0, 1, 0));
      }
      carbonShell = add(kit, g, mats.carbon(), 'carbonHood');
    }
  }

  // ---------------------------------------------------------------- chassis: wheelie bar + chute
  let bar: THREE.Group | null = null;
  let chuteAttach: THREE.Vector3 | null = null;
  let wheelieNow = 0;
  let barContact: THREE.Vector3 | null = null;
  if (style.wheelieBar) {
    bar = new THREE.Group();
    bar.name = 'wheelieBar';
    const rR = ctx.rearR;
    const back = ctx.rearAxleX - box.min.x + 0.7; // reaches 0.7 m past the rear bumper
    const wr = 0.05;
    // rigid with the chassis: rest clearance chosen so the bar wheels touch down at BAR_TOUCH of wheelie (~8 cm at rest)
    const yEnd = (wr - rR + back * Math.sin(BAR_TOUCH)) / Math.cos(BAR_TOUCH); // wheel centre relative to the axle
    const tubeM = mats.polished();
    const parts: THREE.BufferGeometry[] = [];
    for (const s of [-1, 1]) {
      parts.push(tube([V(0, -0.06, s * 0.36), V(-back * 0.5, -0.1 + (yEnd + 0.06) * 0.5, s * 0.28), V(-back, yEnd + 0.03, s * 0.2)], 0.016, 6, 10));
      parts.push(tube([V(-0.12, 0.08, s * 0.3), V(-back * 0.55, 0.0, s * 0.24), V(-back, yEnd + 0.06, s * 0.2)], 0.012, 6, 10));
    }
    parts.push(tube([V(-back, yEnd + 0.03, -0.24), V(-back, yEnd + 0.03, 0.24)], 0.016, 6, 1));
    parts.push(tube([V(-back * 0.5, -0.1 + (yEnd + 0.06) * 0.5, -0.28), V(-back * 0.5, -0.1 + (yEnd + 0.06) * 0.5, 0.28)], 0.012, 6, 1));
    add(bar, merge(parts), tubeM, 'barTubes');
    const wheel = res.get('g:barWheel', () => {
      const t = new THREE.CylinderGeometry(wr, wr, 0.04, 14);
      t.rotateX(Math.PI / 2);
      return t;
    });
    const hub = res.get('g:barHub', () => {
      const t = new THREE.CylinderGeometry(wr * 0.55, wr * 0.55, 0.044, 16);
      t.rotateX(Math.PI / 2);
      return t;
    });
    for (const s of [-1, 1]) {
      add(bar, wheel, mats.plastic('#101012', 0.05), 'barWheel').position.set(-back - 0.02, yEnd, s * 0.24);
      add(bar, hub, mats.polished(), 'barHub').position.set(-back - 0.02, yEnd, s * 0.24);
    }
    bar.position.set(ctx.rearAxleX, rR, 0);
    ctx.chassis.add(bar);
    barContact = V(-back - 0.02, yEnd - wr, 0);
  }
  if (style.chute) {
    // parachute pack bolted to the rear bumper, off to the driver side so the plate stays visible
    const yc = Math.max(0.3, (A.taillights[0]?.y ?? 0.7) - 0.26);
    const zc = -Math.min(0.42, W * 0.24);
    const xr = (surf.front(yc, zc, -1)?.d ?? box.min.x) - 0.075;
    chuteAttach = V(xr - 0.11, yc, zc);
    const pack = extrude(rrect(0.15, 0.17, 0.045), 0.2, 0.025, cs, -0.1);
    pack.rotateY(Math.PI / 2);
    pack.translate(xr, yc, zc);
    add(kit, pack, mats.paint(spec.accent === '#1c1a24' ? '#d0182c' : spec.accent, { finish: 'solid' }), 'chute');
    const strap = new THREE.BoxGeometry(0.16, 0.018, 0.21);
    strap.translate(xr, yc + 0.03, zc);
    add(kit, strap, black, 'chuteStrap');
  }

  // body-colour parts join the paint panels so the livery covers them too
  for (const m of paintParts) if (!build.paintMeshes.includes(m)) build.paintMeshes.push(m);

  const shakeBase = shaker ? shaker.position.clone() : null;
  return {
    group: kit,
    animated: shaker ? [shaker] : [],
    bar,
    style,
    surface: surf,
    tips,
    afterPaint() {
      const pm = build.paintMeshes[0]?.material as THREE.Material | undefined;
      if (pm) for (const m of paintParts) m.material = pm;
    },
    update(dt, s) {
      if (shaker && shakeBase) {
        const a = (0.0025 + s.rpm * 0.004) * (style.hood === 'blower' ? 0.5 : 1);
        shaker.position.set(shakeBase.x + Math.sin(s.time * 47) * a * 0.3, shakeBase.y + Math.abs(Math.sin(s.time * 31)) * a, shakeBase.z);
        shaker.rotation.x = Math.sin(s.time * 23 + 1) * a * 2.2;
      }
      if (blowerBelt) blowerBelt.rotation.x = Math.sin(s.time * 90) * 0.004;
      tipGlow.emissiveIntensity = s.nitro * 4;
      for (const u of updaters) u(dt, s);
      void carbonShell;
    },
    chuteAttach,
    setWheelie(rad) {
      wheelieNow = rad;
    },
    wheelieBarContact: barContact
      ? (out) => {
          if (wheelieNow < BAR_TOUCH - 0.003) return null; // airborne: no sparks
          bar!.updateWorldMatrix(true, false);
          return bar!.localToWorld(out.copy(barContact!));
        }
      : undefined,
  };
}
