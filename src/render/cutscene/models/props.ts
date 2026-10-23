// Hand props for the v3 heel-turn cutscenes: glossy, chunky, cartoony toon props built on the shared Kit.
//
// Conventions (all props):
// - root origin = the grip point (centre of the fist). +X points forward out of the hand, +Y is "up" on the prop,
//   flat props (ticket pad, autograph, pinwheel face) face +Z. Parent the root to char.props.handR / handL.
// - Every prop has dispose() (removes it from its parent and frees everything) and update(dt), so a scene can
//   hand it to Director.rig(). Animated props also animate themselves on render if nobody calls update().
import * as THREE from 'three';
import { Kit, outlineTree } from './kit';

export interface Prop {
  root: THREE.Group;
  dispose(): void;
  /** Optional per-frame tick (slosh, spin). Safe to skip: animated props self-tick on render. */
  update?(dt: number): void;
}

/** Outline thickness for hand props (thinner than characters). */
const OL = 0.011;

function base(name: string) {
  const kit = new Kit();
  const root = new THREE.Group();
  root.name = name;
  return { kit, root };
}

/** Rounded box geometry: a subdivided box whose vertices are pushed onto a box with radius-r rounded edges. */
export function roundedBoxGeometry(w: number, h: number, d: number, r: number, seg = 4): THREE.BufferGeometry {
  r = Math.max(1e-4, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  const g = new THREE.BoxGeometry(w, h, d, seg * 2, seg * 2, seg * 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = g.attributes.normal as THREE.BufferAttribute;
  const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
  const v = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    // Remap the evenly spaced grid so the rounded band gets most of the segments.
    const rm = (x: number, half: number, inner: number) => {
      const t = x / half; // -1..1
      const a = Math.abs(t), s = Math.sign(t);
      const edge = 0.5; // first half of the grid -> flat face, second half -> curve
      return s * (a <= edge ? (a / edge) * inner : inner + ((a - edge) / (1 - edge)) * (half - inner));
    };
    v.set(rm(v.x, w / 2, hx), rm(v.y, h / 2, hy), rm(v.z, d / 2, hz));
    c.set(THREE.MathUtils.clamp(v.x, -hx, hx), THREE.MathUtils.clamp(v.y, -hy, hy), THREE.MathUtils.clamp(v.z, -hz, hz));
    v.sub(c);
    if (v.lengthSq() > 1e-12) v.normalize();
    n.setXYZ(i, v.x, v.y, v.z);
    v.multiplyScalar(r).add(c);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}

/** Rounded box (chamfered, glossy-friendly). */
const rbox = (kit: Kit, w: number, h: number, d: number, r: number, mat: THREE.Material | THREE.ColorRepresentation, ol = OL) =>
  kit.mesh(roundedBoxGeometry(w, h, d, r, 3), mat, ol);

/** Capsule along X. */
const capX = (kit: Kit, r: number, len: number, mat: THREE.Material | THREE.ColorRepresentation, ol = OL) =>
  kit.mesh(new THREE.CapsuleGeometry(r, len, 6, 18).rotateZ(-Math.PI / 2), mat, ol);

/** Cylinder along X (top radius at +X). */
const cylX = (kit: Kit, rFront: number, rBack: number, len: number, mat: THREE.Material | THREE.ColorRepresentation, seg = 18, ol = OL) =>
  kit.mesh(new THREE.CylinderGeometry(rFront, rBack, len, seg).rotateZ(-Math.PI / 2), mat, ol);

/** Pure white specular glint (unlit so it pops like clearcoat). */
function glint(kit: Kit, r: number, sx: number, sy: number, mat?: THREE.Material) {
  const m = kit.ball(r, mat ?? kit.own(new THREE.MeshBasicMaterial({ color: 0xffffff })), sx, sy, 0.25, 8, 0);
  m.userData.glint = true;
  return m;
}

/** Self-ticking unless the scene calls update() itself. */
function ticker(anchor: THREE.Mesh, tick: (dt: number) => void) {
  let manual = false, last = -1;
  anchor.onBeforeRender = () => {
    if (manual) return;
    const now = performance.now() / 1000;
    const dt = last < 0 ? 0 : Math.min(0.05, now - last);
    last = now;
    if (dt > 0) tick(dt);
  };
  return (dt: number) => {
    manual = true;
    tick(dt);
  };
}

function finish(kit: Kit, root: THREE.Group) {
  outlineTree(root, kit.outlineMat);
  return () => {
    root.removeFromParent();
    kit.dispose();
  };
}

const smooth = (k: number) => k * k * (3 - 2 * k);
const clamp01 = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k);

// ---------------------------------------------------------------------------------------------------------
/**
 * Olga's GIANT oil super-soaker (~1.25 m long). Grip = pistol grip in the fist; the blaster runs along +X with
 * the barrel axis ~0.17 m above the grip. `nozzle` sits at the muzzle, its +X along the stream (spawn oil there).
 * setPump(k): 0 = pump forward, 1 = pulled back; pumping bulges the tank and swings the pressure needle.
 * `tank` (the clear oil tank group) and `oil` are exposed for extra wobble.
 */
export function buildOilGun(): Prop & {
  nozzle: THREE.Object3D;
  setPump(k: number): void;
  update(dt: number): void;
  tank: THREE.Object3D;
  oil: THREE.Object3D;
  /** 0..1 how full the tank is (default 0.6); drain it as she sprays. */
  setLevel(k: number): void;
} {
  const { kit, root } = base('prop_oilgun');
  const cyan = kit.toon(0x2fd6d0);
  const cyanDk = kit.toon(0x168c94);
  const black = kit.toon(0x1a1a22);
  const chrome = kit.toon(0xd8dde6);
  const AY = 0.17; // barrel axis height above the grip

  // Pistol grip (raked back) with finger ridges.
  const grip = rbox(kit, 0.1, 0.27, 0.08, 0.035, black);
  grip.position.set(-0.01, -0.02, 0);
  grip.rotation.z = -0.28;
  root.add(grip);
  for (let i = 0; i < 3; i++) {
    const ridge = kit.ball(0.026, cyanDk, 1, 0.7, 1.5, 8, 0);
    ridge.position.set(0.04 + i * 0.022, -0.08 + i * 0.065, 0);
    grip.add(ridge);
  }

  // Receiver: big fat cyan capsule with a black stock bulb at the back.
  const recv = capX(kit, 0.12, 0.6, cyan);
  recv.position.set(0.2, AY, 0);
  root.add(recv);
  const stock = kit.ball(0.13, black, 1.1, 1, 1, 16);
  stock.position.set(-0.17, AY, 0);
  root.add(stock);
  const stockCap = kit.ball(0.07, cyan, 0.5, 1, 1, 12, 0);
  stockCap.position.set(-0.3, AY, 0);
  root.add(stockCap);
  // Black racing band + glints on the receiver.
  for (const x of [0.08, 0.44]) {
    const band = cylX(kit, 0.125, 0.125, 0.04, black, 18, 0);
    band.position.set(x, AY, 0);
    root.add(band);
  }
  for (const z of [-1, 1]) {
    const g = glint(kit, 0.1, 2.2, 0.16);
    g.position.set(0.24, AY + 0.075, z * 0.085);
    g.rotation.x = z * -0.7;
    root.add(g);
  }
  // Side sticker: a cute oil drop + "SLICK 3000".
  const stickerTex = kit.canvas(128, 40, (g, w, h) => {
    g.fillStyle = '#141418';
    g.beginPath();
    g.roundRect(1, 1, w - 2, h - 2, 10);
    g.fill();
    g.fillStyle = '#2fd6d0';
    g.beginPath();
    g.moveTo(20, 6);
    g.quadraticCurveTo(34, 24, 20, 34);
    g.quadraticCurveTo(6, 24, 20, 6);
    g.fill();
    g.fillStyle = '#fff';
    g.fillRect(15, 20, 3, 6);
    g.font = 'bold 15px sans-serif';
    g.textBaseline = 'middle';
    g.fillText('SLICK', 38, 15);
    g.fillStyle = '#2fd6d0';
    g.font = 'bold 13px sans-serif';
    g.fillText('3000', 40, 30);
  }, true);
  const stickerMat = kit.own(new THREE.MeshBasicMaterial({ map: stickerTex }));
  for (const z of [-1, 1]) {
    const s = new THREE.Mesh(kit.geo(new THREE.PlaneGeometry(0.26, 0.08)), stickerMat);
    s.position.set(0.28, AY - 0.02, z * 0.123);
    if (z < 0) s.rotation.y = Math.PI;
    root.add(s);
  }

  // Trigger guard + trigger.
  const guard = kit.mesh(new THREE.TorusGeometry(0.055, 0.014, 6, 14, Math.PI), black, OL);
  guard.position.set(0.1, AY - 0.1, 0);
  guard.rotation.z = Math.PI;
  root.add(guard);
  const trigger = rbox(kit, 0.03, 0.075, 0.035, 0.012, cyanDk);
  trigger.position.set(0.09, AY - 0.12, 0);
  trigger.rotation.z = 0.25;
  root.add(trigger);

  // Barrel + chunky bell nozzle.
  const barrel = cylX(kit, 0.058, 0.064, 0.36, black);
  barrel.position.set(0.68, AY, 0);
  root.add(barrel);
  const bell = cylX(kit, 0.095, 0.06, 0.13, cyan);
  bell.position.set(0.92, AY, 0);
  root.add(bell);
  const lip = kit.mesh(new THREE.TorusGeometry(0.088, 0.022, 8, 20).rotateY(Math.PI / 2), black, OL);
  lip.position.set(0.985, AY, 0);
  root.add(lip);
  const hole = cylX(kit, 0.055, 0.055, 0.012, kit.toon(0x050508), 16, 0);
  hole.position.set(0.988, AY, 0);
  root.add(hole);
  const goo = kit.ball(0.03, kit.toon(0x0b0b12), 1, 2.2, 1, 8, 0); // a lazy oil drip off the lip
  goo.position.set(0.975, AY - 0.1, 0.03);
  root.add(goo);
  const bellGl = glint(kit, 0.05, 1.6, 0.25);
  bellGl.position.set(0.92, AY + 0.07, 0.04);
  root.add(bellGl);
  const nozzle = new THREE.Object3D();
  nozzle.name = 'nozzle';
  nozzle.position.set(1.0, AY, 0);
  root.add(nozzle);

  // Pump: a slide rod under the barrel and a fat ribbed forend that strokes back.
  const rod = cylX(kit, 0.018, 0.018, 0.42, chrome, 10, 0);
  rod.position.set(0.64, AY - 0.1, 0);
  root.add(rod);
  const pump = new THREE.Group();
  const PUMP0 = 0.72;
  pump.position.set(PUMP0, AY - 0.11, 0);
  pump.add(rbox(kit, 0.24, 0.1, 0.12, 0.045, black));
  for (let i = -1; i <= 1; i++) {
    const rib = rbox(kit, 0.03, 0.108, 0.128, 0.014, cyan, 0);
    rib.position.x = i * 0.065;
    pump.add(rib);
  }
  root.add(pump);

  // Tank: a clear bubble on top sloshing with black oil (visible level), cyan end caps and a filler plug.
  const tank = new THREE.Group();
  tank.name = 'tank';
  tank.position.set(0.22, AY + 0.27, 0);
  root.add(tank);
  const TR = 0.17, TSX = 1.55;
  const glassMat = kit.own(new THREE.MeshToonMaterial({
    color: 0x8ff0ff, gradientMap: kit.grad, transparent: true, opacity: 0.16, depthWrite: false,
  }));
  const glass = kit.ball(TR, glassMat, TSX, 1, 1, 22, 0);
  glass.renderOrder = 2;
  tank.add(glass);
  const oilMat = kit.toon(0x07070c);
  const oilTop = kit.toon(0x2a6470);
  const oil = new THREE.Group(); // the oil body; tilts to slosh
  oil.name = 'oil';
  tank.add(oil);
  const oilInner = new THREE.Group();
  oilInner.scale.set(TSX, 1, 1);
  oil.add(oilInner);
  const OR = TR * 0.93;
  let oilBody: THREE.Mesh | null = null, oilSurf: THREE.Mesh | null = null;
  let level = 0.6;
  const buildOil = () => {
    if (oilBody) oilInner.remove(oilBody), oilBody.geometry.dispose();
    if (oilSurf) oilInner.remove(oilSurf), oilSurf.geometry.dispose();
    const th0 = Math.acos(THREE.MathUtils.clamp(1 - 2 * level, -0.98, 0.98));
    oilBody = new THREE.Mesh(new THREE.SphereGeometry(OR, 20, 12, 0, Math.PI * 2, th0, Math.PI - th0), oilMat);
    oilSurf = new THREE.Mesh(new THREE.CircleGeometry(OR * Math.sin(th0), 20).rotateX(-Math.PI / 2), oilTop);
    oilSurf.position.y = OR * Math.cos(th0);
    oilInner.add(oilBody, oilSurf);
  };
  buildOil();
  for (const [x, y, r] of [[-0.12, -0.06, 0.018], [0.08, -0.1, 0.012], [0.02, -0.02, 0.01]] as const) {
    const bub = kit.ball(r, kit.toon(0x3a4a58), 1, 1, 1, 8, 0);
    bub.position.set(x, y, 0.1);
    oil.add(bub);
  }
  for (const s of [-1, 1]) {
    const cap = kit.ball(0.1, cyan, 0.55, 1, 1, 16);
    cap.position.x = s * TR * TSX * 0.93;
    tank.add(cap);
  }
  const ring = kit.mesh(new THREE.TorusGeometry(TR * 1.01, 0.016, 8, 28).rotateY(Math.PI / 2), black, 0);
  tank.add(ring);
  const plug = kit.cyl(0.04, 0.05, 0.06, black, 12);
  plug.position.set(0.1, TR + 0.01, 0);
  tank.add(plug);
  const plugTop = kit.cyl(0.05, 0.05, 0.02, cyan, 12, 0);
  plugTop.position.set(0.1, TR + 0.045, 0);
  tank.add(plugTop);
  const tg1 = glint(kit, 0.1, 1.5, 0.2);
  tg1.position.set(-0.06, 0.1, 0.13);
  tg1.rotation.set(-0.6, 0, 0.25);
  tank.add(tg1);
  const tg2 = glint(kit, 0.022, 1, 1);
  tg2.position.set(0.14, 0.07, 0.14);
  tank.add(tg2);
  const neck = kit.cyl(0.05, 0.065, 0.12, cyanDk, 12);
  neck.position.set(0.22, AY + 0.12, 0);
  root.add(neck);

  // Pressure gauge on the back of the tank: white dial, red needle.
  const gauge = new THREE.Group();
  gauge.position.set(-0.08, AY + 0.17, 0.06);
  gauge.rotation.y = 0.5;
  const dial = kit.cyl(0.05, 0.05, 0.025, black, 16);
  dial.rotation.x = Math.PI / 2;
  gauge.add(dial);
  const face = kit.cyl(0.04, 0.04, 0.01, kit.toon(0xf4f2ea), 16, 0);
  face.rotation.x = Math.PI / 2;
  face.position.z = 0.012;
  gauge.add(face);
  const redZone = kit.box(0.02, 0.01, 0.004, kit.toon(0xff3030), 0);
  redZone.position.set(0.026, 0.02, 0.019);
  redZone.rotation.z = 0.7;
  gauge.add(redZone);
  const needle = new THREE.Group();
  needle.position.z = 0.02;
  const nd = kit.box(0.034, 0.008, 0.004, kit.toon(0xe02020), 0);
  nd.position.x = 0.015;
  needle.add(nd);
  gauge.add(needle);
  root.add(gauge);

  // Pump + slosh state.
  let pumpK = 0, prevPump = 0, pressure = 0, sloshV = 0, slosh = 0, t = 0;
  const apply = () => {
    pump.position.x = PUMP0 - 0.17 * pumpK;
    const b = 1 + 0.16 * pressure;
    tank.scale.set(1 + 0.08 * pressure, b, b);
    needle.rotation.z = Math.PI * 0.85 - pressure * Math.PI * 0.9;
    oil.rotation.z = slosh;
    oil.rotation.x = slosh * 0.4;
  };
  const tick = (dt: number) => {
    t += dt;
    // Spring-damped slosh driven by pump strokes; tiny idle wobble so it always looks liquid.
    const kick = (pumpK - prevPump) / Math.max(dt, 1e-3);
    prevPump = pumpK;
    sloshV += (-slosh * 60 - sloshV * 5 + kick * 0.6) * dt;
    slosh += sloshV * dt;
    slosh = THREE.MathUtils.clamp(slosh + Math.sin(t * 5.3) * 0.0015, -0.3, 0.3);
    apply();
  };
  const update = ticker(glass, tick);
  apply();

  return {
    root, nozzle, tank, oil, update,
    setPump(k) {
      pumpK = clamp01(k);
      pressure = Math.max(pressure * 0.995, pumpK); // bulge holds while pumping
      if (pumpK === 0 && k <= 0) pressure = 0;
      apply();
    },
    setLevel(k) {
      level = THREE.MathUtils.clamp(k, 0.05, 0.95);
      buildOil();
    },
    dispose: (() => {
      const d = finish(kit, root);
      return () => {
        oilBody?.geometry.dispose();
        oilSurf?.geometry.dispose();
        d();
      };
    })(),
  };
}

// ---------------------------------------------------------------------------------------------------------
/**
 * Olga's tiny cute vintage oil can (brass, ~0.3 m with the spout). Grip = the looped handle at the back;
 * the can sits forward (+X) with a long thin spout rising forward. `spout` is the tip; its +X points out of
 * the spout (drip direction ~ +X then gravity). Tilt the root (rotation.z negative) to pour.
 */
export function buildOilCan(): Prop & { spout: THREE.Object3D } {
  const { kit, root } = base('prop_oilcan');
  const brass = kit.toon(0xe0aa3c);
  const brassDk = kit.toon(0xa8741c);
  const red = kit.toon(0xe8413c);

  const can = new THREE.Group();
  can.position.set(0.115, -0.03, 0);
  root.add(can);
  // Lathe body: wide squat base, domed shoulder up to a small neck.
  const prof: THREE.Vector2[] = [];
  const pts: [number, number][] = [[0, 0], [0.085, 0], [0.095, 0.012], [0.098, 0.03], [0.095, 0.07], [0.085, 0.095], [0.06, 0.12], [0.035, 0.135], [0.022, 0.145], [0.022, 0.16], [0, 0.16]];
  for (const [x, y] of pts) prof.push(new THREE.Vector2(x, y));
  const body = kit.mesh(new THREE.LatheGeometry(prof, 24), brass, OL);
  body.position.y = -0.07;
  can.add(body);
  // Rim bands and a red heart sticker on the side (the camera side, +Z).
  for (const y of [-0.064, -0.01]) {
    const band = kit.mesh(new THREE.TorusGeometry(0.096, 0.006, 6, 24).rotateX(Math.PI / 2), brassDk, 0);
    band.position.y = y;
    can.add(band);
  }
  const heartTex = kit.canvas(32, 32, (g) => {
    g.fillStyle = '#e8413c';
    g.beginPath();
    g.moveTo(16, 27);
    g.bezierCurveTo(2, 18, 3, 6, 10, 6);
    g.bezierCurveTo(13, 6, 15, 8, 16, 11);
    g.bezierCurveTo(17, 8, 19, 6, 22, 6);
    g.bezierCurveTo(29, 6, 30, 18, 16, 27);
    g.fill();
    g.fillStyle = '#fff';
    g.fillRect(9, 10, 3, 3);
  }, true);
  const heartMat = kit.own(new THREE.MeshBasicMaterial({ map: heartTex, transparent: true, alphaTest: 0.4 }));
  for (const z of [-1, 1]) {
    const h = new THREE.Mesh(kit.geo(new THREE.PlaneGeometry(0.07, 0.07)), heartMat);
    h.position.set(0, -0.035, z * 0.1);
    if (z < 0) h.rotation.y = Math.PI;
    can.add(h);
  }
  const cg = glint(kit, 0.03, 0.22, 0.9);
  cg.position.set(-0.045, -0.035, 0.086);
  cg.rotation.y = -0.4;
  can.add(cg);
  const cg2 = glint(kit, 0.015, 1, 1);
  cg2.position.set(-0.02, 0.03, 0.06);
  can.add(cg2);
  // Thumb pump button on top.
  const btn = kit.ball(0.022, red, 1, 0.8, 1, 12, OL);
  btn.position.set(-0.025, 0.1, 0);
  can.add(btn);

  // Long thin spout: from the shoulder, angled up/forward, with a tiny flared tip.
  const SA = 0.62; // spout angle above horizontal
  const spoutG = new THREE.Group();
  spoutG.position.set(0.05, 0.04, 0);
  spoutG.rotation.z = SA;
  can.add(spoutG);
  const SL = 0.22;
  const tube = cylX(kit, 0.01, 0.024, SL, brass, 10, 0.008);
  tube.position.x = SL / 2;
  spoutG.add(tube);
  const tipRing = cylX(kit, 0.015, 0.012, 0.022, brassDk, 10, 0.006);
  tipRing.position.x = SL;
  spoutG.add(tipRing);
  const spout = new THREE.Object3D();
  spout.name = 'spout';
  spout.position.x = SL + 0.012;
  spout.rotation.z = -SA * 0.6; // aim the drip a bit downward of the tube line
  spoutG.add(spout);
  const drop = kit.ball(0.012, kit.toon(0x101018), 1, 1.4, 1, 8, 0);
  drop.position.set(SL + 0.01, -0.016, 0);
  spoutG.add(drop);

  // Looped handle at the back, centred on the grip.
  const handle = kit.mesh(new THREE.TorusGeometry(0.06, 0.015, 8, 18, Math.PI * 1.3), brass, OL);
  handle.position.set(0.0, 0.0, 0);
  handle.rotation.z = Math.PI * 0.3;
  root.add(handle);

  return { root, spout, dispose: finish(kit, root), update() {} };
}

// ---------------------------------------------------------------------------------------------------------
/**
 * Buckshot's big swirly rainbow lollipop. Grip = on the stick; the stick runs +X and the candy disc
 * (r 0.17) sits at x ~ 0.42, its faces toward ±Z. A pink ribbon bow ties the neck.
 * setEaten(k): 0 = whole, 1 = gone (bites crunch out of it, then it shrinks away); `candy` is the disc group.
 */
export function buildLollipop(): Prop & { candy: THREE.Object3D; setEaten(k: number): void } {
  const { kit, root } = base('prop_lollipop');
  const stick = cylX(kit, 0.012, 0.012, 0.38, kit.toon(0xf8f4ec), 10, 0.008);
  stick.position.x = 0.12;
  root.add(stick);
  const R = 0.17, T = 0.055;
  const swirl = kit.canvas(128, 128, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    const cols = ['#ff4a6e', '#ffb02e', '#ffe14a', '#5ad66a', '#3aa8ff', '#a066ff'];
    g.fillStyle = '#fff4f8';
    g.fillRect(0, 0, w, h);
    g.lineCap = 'round';
    for (let c = 0; c < cols.length; c++) {
      g.strokeStyle = cols[c];
      g.lineWidth = 9;
      g.beginPath();
      for (let a = 0; a < Math.PI * 7; a += 0.05) {
        const rr = (a / (Math.PI * 7)) * (w / 2 - 2);
        const ang = a + (c / cols.length) * Math.PI * 2;
        const x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr;
        a === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.stroke();
    }
  }, true);
  // Caps use ExtrudeGeometry's world-space UVs (metres), so map [-R, R] onto the swirl texture.
  swirl.repeat.set(1 / (2 * R), 1 / (2 * R));
  swirl.offset.set(0.5, 0.5);
  const face = kit.own(new THREE.MeshToonMaterial({ map: swirl, gradientMap: kit.grad }));
  const rim = kit.toon(0xff6aa0);
  const candy = new THREE.Group();
  candy.name = 'candy';
  candy.position.x = 0.31 + R;
  root.add(candy);
  // Disc = bevelled extrusion of a circle; bites are scalloped notches cut into the silhouette.
  const BITES = [0.75, 0.25, 1.25, -0.2]; // bite centre angles (radians), in eating order
  const discGeo = (n: number) => {
    const sh = new THREE.Shape();
    const N = 96;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      let r = R - T * 0.35;
      for (let b = 0; b < n; b++) {
        let d = Math.abs(a - BITES[b]);
        d = Math.min(d, Math.PI * 2 - d);
        // Two-tooth scallop ~0.5 rad wide, up to 0.06 m deep.
        if (d < 0.32) r -= 0.06 * Math.sqrt(1 - (d / 0.32) ** 2) * (0.75 + 0.25 * Math.abs(Math.cos((d / 0.32) * Math.PI * 1.5)));
      }
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      i ? sh.lineTo(x, y) : sh.moveTo(x, y);
    }
    const g = new THREE.ExtrudeGeometry(sh, {
      depth: T * 0.3, bevelEnabled: true, bevelThickness: T * 0.35, bevelSize: T * 0.35, bevelSegments: 4, curveSegments: 4,
    });
    g.translate(0, 0, -T * 0.15);
    return g;
  };
  let bitten = 0;
  const disc = new THREE.Mesh(discGeo(0), [face, rim]);
  disc.userData.outline = OL;
  candy.add(disc);
  for (const z of [-1, 1]) {
    const g = glint(kit, 0.06, 1.3, 0.45);
    g.position.set(-0.05, 0.06, z * (T / 2 + 0.004));
    g.rotation.z = 0.6;
    candy.add(g);
    const d = glint(kit, 0.016, 1, 1);
    d.position.set(-0.1, -0.02, z * (T / 2 + 0.004));
    candy.add(d);
  }
  // Ribbon bow at the neck.
  const pink = kit.toon(0xff6aa0);
  const bow = new THREE.Group();
  bow.position.x = 0.29;
  for (const s of [-1, 1]) {
    const loop = kit.ball(0.04, pink, 0.7, 1, 0.45, 10);
    loop.position.set(0, s * 0.04, 0.012);
    loop.rotation.z = s * 0.4;
    bow.add(loop);
    const tail = kit.box(0.012, 0.05, 0.012, pink, 0);
    tail.position.set(-0.025, s * 0.03, 0.01);
    tail.rotation.z = s * 0.6;
    bow.add(tail);
  }
  bow.add(kit.ball(0.018, kit.toon(0xff3a7a), 1, 1, 1, 8));
  root.add(bow);

  return {
    root, candy, update() {},
    setEaten(k) {
      k = clamp01(k);
      const n = Math.min(BITES.length, Math.floor((k + 0.04) / 0.16));
      if (n !== bitten) {
        bitten = n;
        const old = disc.geometry;
        disc.geometry = discGeo(n);
        for (const c of disc.children) if (c.userData.hull) (c as THREE.Mesh).geometry = disc.geometry;
        old.dispose();
      }
      const s = k < 0.7 ? 1 : 1 - smooth((k - 0.7) / 0.3);
      candy.scale.setScalar(Math.max(1e-3, s));
      candy.visible = s > 0.01;
    },
    dispose: (() => {
      const d = finish(kit, root);
      return () => (disc.geometry.dispose(), d());
    })(),
  };
}

// ---------------------------------------------------------------------------------------------------------
/**
 * Buckshot's citation pad (~0.22 x 0.3). Grip = pinched at the left edge; the pad extends +X, text reads
 * along +X with +Y up, face toward +Z. `ticket` is the top sheet (its origin at the sheet centre): reparent
 * it (attach) and fling it at the lens. setWritten(k) scrawls the pen writing in 0..1. `pen` sits clipped
 * at the top edge (pull it into the other hand if you like).
 */
export function buildTicketPad(): Prop & { ticket: THREE.Object3D; pen: THREE.Object3D; setWritten(k: number): void } {
  const { kit, root } = base('prop_ticketpad');
  const PW = 0.22, PH = 0.3;
  const cx = 0.03 + PW / 2;
  // Black leather backing board with a metal clip at the top.
  const board = rbox(kit, PW + 0.03, PH + 0.03, 0.025, 0.012, kit.toon(0x1c1c24));
  board.position.set(cx, 0, -0.012);
  root.add(board);
  // Stack of pale sheets.
  const stack = rbox(kit, PW, PH, 0.02, 0.004, kit.toon(0xf2ecd6), 0);
  stack.position.set(cx, -0.004, 0.012);
  root.add(stack);
  const clip = rbox(kit, 0.1, 0.045, 0.03, 0.01, kit.toon(0xd8dde6));
  clip.position.set(cx, PH / 2 + 0.005, 0.01);
  root.add(clip);
  const clipGl = glint(kit, 0.03, 1.2, 0.2);
  clipGl.position.set(cx - 0.02, PH / 2 + 0.017, 0.026);
  root.add(clipGl);
  const badge = kit.ball(0.02, kit.toon(0xf5c542), 1, 1, 0.4, 10, 0.006);
  badge.position.set(cx, PH / 2 + 0.005, 0.03);
  root.add(badge);

  // Ticket top sheet: CanvasTexture with a red CITATION header and pen scrawl revealed by setWritten.
  const c = document.createElement('canvas');
  c.width = 176;
  c.height = 240;
  const g = c.getContext('2d')!;
  const tex = kit.tex(new THREE.CanvasTexture(c));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const scrawl: [number, number][][] = [];
  {
    // Pre-baked pen strokes: three lines of loopy "handwriting" + a big signature and an underline.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const [y, x0, x1] of [[100, 18, 150], [128, 18, 132], [156, 18, 156]] as const) {
      const s: [number, number][] = [];
      for (let x = x0; x <= x1; x += 2) s.push([x, y - 6 + Math.sin(x * 0.55) * 5 + (rnd() - 0.5) * 3]);
      scrawl.push(s);
    }
    const sig: [number, number][] = [];
    for (let a = 0; a <= Math.PI * 6; a += 0.12) sig.push([30 + a * 6.5, 200 + Math.sin(a * 1.6) * 9 - Math.cos(a) * 4]);
    scrawl.push(sig);
  }
  const total = scrawl.reduce((s, p) => s + p.length, 0);
  let written = -1;
  const draw = (k: number) => {
    const w = c.width, h = c.height;
    g.fillStyle = '#fbf7e8';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#d61f26';
    g.fillRect(0, 0, w, 44);
    g.fillStyle = '#fff';
    g.font = 'bold 26px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('CITATION', w / 2, 23);
    g.fillStyle = '#d61f26';
    g.font = 'bold 12px sans-serif';
    g.fillText('SPEEDING · ATTITUDE', w / 2, 60);
    g.strokeStyle = '#9cb4d8';
    g.lineWidth = 1.5;
    for (const y of [104, 132, 160, 206]) {
      g.beginPath();
      g.moveTo(12, y);
      g.lineTo(w - 12, y);
      g.stroke();
    }
    g.fillStyle = '#d61f26';
    g.font = 'bold 16px sans-serif';
    g.textAlign = 'right';
    g.fillText('$$$$', w - 12, 228);
    g.strokeStyle = '#d61f26';
    g.lineWidth = 3;
    g.strokeRect(2, 2, w - 4, h - 4);
    // Pen ink.
    let left = Math.round(total * k);
    g.strokeStyle = '#1a2a6a';
    g.lineWidth = 2.6;
    g.lineCap = g.lineJoin = 'round';
    for (const s of scrawl) {
      if (left <= 1) break;
      g.beginPath();
      const n = Math.min(s.length, left);
      for (let i = 0; i < n; i++) (i ? g.lineTo : g.moveTo).call(g, s[i][0], s[i][1]);
      g.stroke();
      left -= n;
    }
    tex.needsUpdate = true;
  };
  const ticket = new THREE.Group();
  ticket.name = 'ticket';
  ticket.position.set(cx, -0.004, 0.024);
  const sheet = new THREE.Mesh(kit.geo(new THREE.PlaneGeometry(PW, PH)), kit.own(new THREE.MeshBasicMaterial({ map: tex })));
  ticket.add(sheet);
  const back = new THREE.Mesh(sheet.geometry, kit.own(new THREE.MeshBasicMaterial({ color: 0xe8e0c8, side: THREE.BackSide })));
  ticket.add(back);
  root.add(ticket);

  // Pen clipped along the top edge, angled.
  const pen = new THREE.Group();
  pen.name = 'pen';
  pen.position.set(cx + PW / 2 + 0.005, -0.02, 0.04);
  pen.rotation.z = Math.PI / 2 - 0.12;
  const barrel = capX(kit, 0.012, 0.15, kit.toon(0x2a3a8a), 0.006);
  pen.add(barrel);
  const tip = cylX(kit, 0.002, 0.012, 0.03, kit.toon(0xd8dde6), 8, 0);
  tip.position.x = 0.095;
  pen.add(tip);
  const penGl = glint(kit, 0.04, 1.4, 0.15);
  penGl.position.set(-0.01, 0.007, 0.009);
  pen.add(penGl);
  root.add(pen);

  draw(0);
  return {
    root, ticket, pen, update() {},
    setWritten(k) {
      k = clamp01(k);
      if (Math.abs(k - written) < 0.02 && !(k === 1 && written !== 1)) return;
      written = k;
      draw(k);
    },
    dispose: finish(kit, root),
  };
}

// ---------------------------------------------------------------------------------------------------------
/**
 * Gus's colourful pinwheel. Grip = on the stick; the stick runs +X (hold it up), the wheel (r ~0.2) sits at
 * the end with its face toward +Z, spinning about its Z axis. setSpin(radPerSec) sets the spin rate.
 * `wheel` is the spinning head (rip it off the stick with attach + fling).
 */
export function buildPinwheel(): Prop & { setSpin(radPerSec: number): void; update(dt: number): void; wheel: THREE.Object3D } {
  const { kit, root } = base('prop_pinwheel');
  const L = 0.5;
  const stick = cylX(kit, 0.013, 0.013, L + 0.12, kit.toon(0xf4ecd8), 10, 0.008);
  stick.position.x = L / 2 - 0.04;
  root.add(stick);
  const stripe = kit.toon(0xff4a6e);
  for (let i = 0; i < 4; i++) {
    const s = cylX(kit, 0.0135, 0.0135, 0.03, stripe, 10, 0);
    s.position.x = -0.05 + i * 0.13;
    root.add(s);
  }
  const wheel = new THREE.Group();
  wheel.name = 'wheel';
  wheel.position.set(L, 0, 0.03);
  root.add(wheel);
  // Four curled blades: each a two-tone triangle pair with its tip pulled toward the centre (the curl).
  const R = 0.21;
  const cols: [number, number][] = [[0xff4a6e, 0xc8284a], [0xffd23a, 0xd8a018], [0x3aa8ff, 0x1f78c8], [0x5ad66a, 0x2fa04a]];
  cols.forEach(([ca, cb], i) => {
    const a = (i / 4) * Math.PI * 2;
    const blade = new THREE.Group();
    blade.rotation.z = a;
    // Square quadrant (0,0)-(R,0)-(R,R)-(0,R), diagonally split; the (R,R) corner curls up and in.
    const mk = (pts: number[], col: number) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      geo.computeVertexNormals();
      return kit.mesh(geo, kit.toon(col, { side: THREE.DoubleSide }), 0);
    };
    // Flat sail (bright) from the centre out to the rim, plus a folded flap (shadow tone) curling back to the pin.
    const ax = R, ay = 0, bx = R * 0.92, by = R * 0.78;
    blade.add(mk([0, 0, 0, ax, ay, 0, bx, by, 0.03], ca));
    blade.add(mk([0, 0, 0.0, bx, by, 0.03, R * 0.12, R * 0.92, 0.11], cb));
    // Thin white highlight along the fold.
    const e = kit.box(R * 0.62, 0.008, 0.004, kit.own(new THREE.MeshBasicMaterial({ color: 0xffffff })), 0);
    e.position.set(R * 0.5, R * 0.4, 0.035);
    e.rotation.z = Math.atan2(by, bx) - 0.08;
    blade.add(e);
    wheel.add(blade);
  });
  const pin = kit.ball(0.03, kit.toon(0xffffff), 1, 1, 0.8, 12, OL);
  pin.position.z = 0.05;
  wheel.add(pin);
  const pinDot = kit.ball(0.014, kit.toon(0xff4a6e), 1, 1, 0.6, 8, 0);
  pinDot.position.z = 0.075;
  wheel.add(pinDot);

  let rate = 0;
  const update = ticker(pin, (dt) => {
    wheel.rotation.z += rate * dt;
  });
  return {
    root, wheel, update,
    setSpin(radPerSec) {
      rate = radPerSec;
    },
    dispose: finish(kit, root),
  };
}

// ---------------------------------------------------------------------------------------------------------
/**
 * Rosa's glossy autograph photo card (0.21 x 0.29, portrait). Grip = pinched at the left edge, the card extends
 * +X, picture upright along +Y, photo facing +Z (white back on -Z). crumple(k): 0 = flat card, 1 = a tight
 * crumpled ball (r ~0.055) centred on the card centre (~x 0.13), so you can then attach + fling it.
 */
export function buildAutograph(): Prop & { crumple(k: number): void; card: THREE.Object3D } {
  const { kit, root } = base('prop_autograph');
  const CW = 0.21, CH = 0.29;
  const tex = kit.canvas(168, 232, (g, w, h) => {
    // Photo: warm studio gradient, Rosa's red mane + smile, champion's star, a gloss sheen and her signature.
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#ffd27a');
    bg.addColorStop(1, '#ff7a5a');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, h);
    g.fillStyle = bg;
    g.fillRect(8, 8, w - 16, h - 52);
    // Sunburst.
    g.fillStyle = 'rgba(255,255,255,0.25)';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(w / 2, 88);
      g.lineTo(w / 2 + Math.cos(a) * 140, 88 + Math.sin(a) * 140);
      g.lineTo(w / 2 + Math.cos(a + 0.22) * 140, 88 + Math.sin(a + 0.22) * 140);
      g.fill();
    }
    g.save();
    g.beginPath();
    g.rect(8, 8, w - 16, h - 52);
    g.clip();
    // Red racing suit shoulders.
    g.fillStyle = '#d81e2a';
    g.beginPath();
    g.ellipse(w / 2, 196, 64, 46, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#f4f0ea';
    g.fillRect(w / 2 - 6, 152, 12, 40);
    // Hair mane behind the head.
    g.fillStyle = '#e0262c';
    g.beginPath();
    g.ellipse(w / 2, 100, 50, 56, 0, 0, Math.PI * 2);
    g.fill();
    // Face.
    g.fillStyle = '#f2c4a2';
    g.beginPath();
    g.ellipse(w / 2, 104, 34, 40, 0, 0, Math.PI * 2);
    g.fill();
    // Bangs.
    g.fillStyle = '#e0262c';
    g.beginPath();
    g.ellipse(w / 2 - 14, 70, 28, 14, -0.4, 0, Math.PI * 2);
    g.ellipse(w / 2 + 16, 70, 24, 12, 0.4, 0, Math.PI * 2);
    g.fill();
    // Eyes (closed happy arcs), cheeks, smile.
    g.strokeStyle = '#1a0a12';
    g.lineWidth = 3.5;
    g.lineCap = 'round';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(w / 2 + s * 13, 100, 7, Math.PI * 1.1, Math.PI * 1.9);
      g.stroke();
    }
    g.fillStyle = 'rgba(255,90,110,0.55)';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(w / 2 + s * 22, 114, 7, 4.5, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#8a1018';
    g.beginPath();
    g.arc(w / 2, 118, 11, 0.1, Math.PI - 0.1);
    g.fill();
    g.fillStyle = '#fff';
    g.fillRect(w / 2 - 8, 119, 16, 3);
    g.restore();
    // Gold star sticker.
    g.fillStyle = '#f5c542';
    g.strokeStyle = '#a8741c';
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 7 : 16, a = -Math.PI / 2 + (i * Math.PI) / 5;
      (i ? g.lineTo : g.moveTo).call(g, 136 + Math.cos(a) * r, 30 + Math.sin(a) * r);
    }
    g.closePath();
    g.fill();
    g.stroke();
    // Signature scribble across the photo and the white strip.
    g.strokeStyle = '#141428';
    g.lineWidth = 4;
    g.lineJoin = 'round';
    g.beginPath();
    for (let a = 0; a <= Math.PI * 7; a += 0.1) {
      const x = 22 + a * 5.6, y = 196 + Math.sin(a * 1.4) * 12 - Math.cos(a * 0.7) * 6 - a * 1.2;
      a ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.stroke();
    g.beginPath();
    g.moveTo(26, 214);
    g.quadraticCurveTo(90, 226, 150, 204);
    g.stroke();
    // Little heart after the name.
    g.fillStyle = '#e8413c';
    g.beginPath();
    g.arc(146, 178, 5, Math.PI, 0);
    g.arc(156, 178, 5, Math.PI, 0);
    g.lineTo(151, 190);
    g.closePath();
    g.fill();
    g.fillStyle = '#141428';
    g.font = 'bold 13px sans-serif';
    g.textAlign = 'center';
    g.fillText('XOXO ROSA', w / 2, h - 10);
    // Glossy sheen.
    const sh = g.createLinearGradient(0, 0, w, h);
    sh.addColorStop(0.25, 'rgba(255,255,255,0)');
    sh.addColorStop(0.33, 'rgba(255,255,255,0.45)');
    sh.addColorStop(0.4, 'rgba(255,255,255,0)');
    g.fillStyle = sh;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3a3040';
    g.lineWidth = 2;
    g.strokeRect(1, 1, w - 2, h - 2);
  }, true);

  const NX = 12, NY = 16;
  const geo = kit.geo(new THREE.PlaneGeometry(CW, CH, NX, NY));
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const flat = Float32Array.from(pos.array as Float32Array);
  // Crumpled-ball target per vertex: wrap the uv grid onto a lumpy sphere, plus hashed jitter.
  const ball = new Float32Array(flat.length);
  const wrinkle = new Float32Array(flat.length / 3);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  const hash = (i: number) => {
    const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  for (let i = 0; i < pos.count; i++) {
    const u = uv.getX(i), v = uv.getY(i);
    const th = u * Math.PI * 2 + hash(i) * 0.6, ph = 0.25 + v * (Math.PI - 0.5) + (hash(i + 99) - 0.5) * 0.5;
    const r = 0.05 * (0.8 + hash(i + 7) * 0.45);
    ball[i * 3] = Math.cos(th) * Math.sin(ph) * r;
    ball[i * 3 + 1] = Math.cos(ph) * r;
    ball[i * 3 + 2] = Math.sin(th) * Math.sin(ph) * r;
    wrinkle[i] = hash(i + 31) - 0.5;
  }
  const front = new THREE.Mesh(geo, kit.own(new THREE.MeshToonMaterial({ map: tex, gradientMap: kit.grad, side: THREE.FrontSide })));
  const back = new THREE.Mesh(geo, kit.toon(0xf4f0ea, { side: THREE.BackSide }));
  const card = new THREE.Group();
  card.name = 'card';
  card.position.set(0.03 + CW / 2, 0, 0);
  card.add(front, back);
  root.add(card);
  // Clearcoat glint that fades as it crumples.
  const glintMat = kit.own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
  const gl = glint(kit, 0.04, 0.3, 1.6, glintMat);
  gl.position.set(-0.05, 0.06, 0.004);
  gl.rotation.z = -0.6;
  card.add(gl);

  const crumple = (k: number) => {
    k = clamp01(k);
    const e = smooth(k);
    const mid = Math.sin(Math.PI * k); // wrinkles peak mid-crumple
    const a = pos.array as Float32Array;
    for (let i = 0; i < pos.count; i++) {
      const fx = flat[i * 3], fy = flat[i * 3 + 1];
      a[i * 3] = fx + (ball[i * 3] - fx) * e;
      a[i * 3 + 1] = fy + (ball[i * 3 + 1] - fy) * e;
      a[i * 3 + 2] = ball[i * 3 + 2] * e + wrinkle[i] * 0.05 * mid;
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    gl.visible = k < 0.4;
    glintMat.opacity = 0.85 * (1 - k / 0.4);
  };

  return { root, card, crumple, update() {}, dispose: finish(kit, root) };
}
