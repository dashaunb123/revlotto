// REDLINE ROSA (final boss): a cold, contemptuous champion, a jerk from the first frame.
// Total darkness: a giant glowing tach sweeps to redline. Hard cut up at the dead stadium as lightning hits the
// towers and the banks slam on. There she is, eyes already burning, a fan's autograph (her own smiling photo) in
// her fist while the stands keep flashing: she crumples it slowly, holding your eye, and flicks it at the lens
// ("NO PHOTOS."). The helmet slams down over the burning eyes (a short glitch on the slam), then a dead-still
// stare through the visor while the stadium dies bank by bank. She burns rubber in your face: smoke and flames
// pour down the lens, her eyes on you over her shoulder. Everything slams back red: the tach is her halo and the
// needle snaps into the one sweet spot. Card.
import * as THREE from 'three';
import { Director, easeInOut, easeOut, lerp, rand, seg, type CardInfo } from '../director';
import { buildBossCar, buildCharacter } from '../models';
import { buildAutograph } from '../models/props';
import { buildDragStrip, glowSprite, glowTexture } from '../stage';
import type { CharacterRig } from '../types';
import { exhaustPoints, faceCam, harshJerk, headPos, headR, mixLook, mountBoss, rate, rearPoints } from './common';


const LANE = -2.6;
const RED = 0xff2a2a;
/** The one sweet spot on her tach (0..1 of the sweep). */
const SWEET = 0.84;


/**
 * The giant tach: segmented ring that lights white-hot as the needle passes, numerals 0..9 (8-9 red),
 * red zone, white needle with afterimage ghosts, and the sweet-spot notch. Needle angle via set(0..1).
 */
function buildTach() {
  const root = new THREE.Group();
  const add = (m: THREE.Mesh) => (root.add(m), m);
  const glow = (c: number, o = 1) =>
    new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
  const A0 = Math.PI * 1.25; // 0 rpm, lower left
  const A1 = -Math.PI * 0.25; // max, lower right
  const ang = (u: number) => lerp(A0, A1, u);
  add(new THREE.Mesh(new THREE.CircleGeometry(5.4, 40), new THREE.MeshBasicMaterial({ color: 0x07050a, fog: false, side: THREE.DoubleSide })));
  // ring segments: dim ember red until the needle passes, then white-hot cooling to red-white
  const RS = 30;
  const ring: { m: THREE.MeshBasicMaterial; u: number }[] = [];
  for (let i = 0; i < RS; i++) {
    const u0 = i / RS;
    const u1 = (i + 1) / RS;
    const m = glow(0x5a1010, 0.7);
    const r = new THREE.Mesh(new THREE.RingGeometry(5.0, 5.4, 3, 1, ang(u1), (A0 - A1) / RS * 0.92), m);
    r.position.z = 0.02;
    root.add(r);
    ring.push({ m, u: (u0 + u1) / 2 });
  }
  const red = add(new THREE.Mesh(new THREE.RingGeometry(3.9, 4.9, 32, 1, A1, (A0 - A1) * 0.2), glow(RED, 0.25)));
  red.position.z = 0.03;
  const ticks: THREE.Mesh[] = [];
  for (let i = 0; i <= 45; i++) {
    const u = i / 45;
    const major = i % 5 === 0;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(major ? 0.9 : 0.45, major ? 0.16 : 0.08), glow(u > 0.8 ? RED : 0xf4ecd8, 0.25));
    const a = ang(u);
    m.position.set(Math.cos(a) * (major ? 4.4 : 4.6), Math.sin(a) * (major ? 4.4 : 4.6), 0.05);
    m.rotation.z = a;
    root.add(m);
    ticks.push(m);
  }
  // numerals: one canvas texture across the dial
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '10px "Press Start 2P", monospace';
  for (let n = 0; n <= 9; n++) {
    const a = ang(n / 9);
    g.fillStyle = n >= 8 ? '#ff3a2a' : '#f4ecd8';
    g.fillText(String(n), 64 + Math.cos(a) * 41, 64 - Math.sin(a) * 41);
  }
  const numTex = new THREE.CanvasTexture(cv);
  numTex.magFilter = THREE.NearestFilter;
  numTex.colorSpace = THREE.SRGBColorSpace;
  const nums = add(new THREE.Mesh(new THREE.PlaneGeometry(10.8, 10.8), new THREE.MeshBasicMaterial({ map: numTex, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })));
  nums.position.z = 0.06;
  // a big flashing "9" over the red zone for the zoom-punch
  const cv9 = document.createElement('canvas');
  cv9.width = 32;
  cv9.height = 32;
  const g9 = cv9.getContext('2d')!;
  g9.textAlign = 'center';
  g9.textBaseline = 'middle';
  g9.font = '24px "Press Start 2P", monospace';
  g9.fillStyle = '#ffffff';
  g9.fillText('9', 16, 17);
  const tex9 = new THREE.CanvasTexture(cv9);
  tex9.magFilter = THREE.NearestFilter;
  const nine = add(new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ map: tex9, color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })));
  const a9 = ang(0.94);
  nine.position.set(Math.cos(a9) * 2.9, Math.sin(a9) * 2.9, 0.1);
  // the sweet-spot notch: one thin white-hot line across the ring + a glint
  const notch = new THREE.Group();
  notch.rotation.z = ang(SWEET);
  notch.position.z = 0.11;
  root.add(notch);
  const notchM = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.2), glow(0xffffff, 0));
  notchM.position.x = 6.1;
  notch.add(notchM);
  const notchG = glowSprite(glowTexture(), 0xfff0e0, 4, 0);
  notchG.position.x = 6.0;
  notch.add(notchG);
  // needle + afterimage ghosts
  const mkNeedle = (o: number) => {
    const pivot = new THREE.Group();
    pivot.position.z = 0.08 + o * 0.001;
    root.add(pivot);
    const needle = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 0.22), glow(0xffffff, o > 0 ? 0 : 1));
    needle.position.x = 2.0;
    pivot.add(needle);
    return { pivot, mat: needle.material as THREE.MeshBasicMaterial };
  };
  const main = mkNeedle(0);
  const needleGlow = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 0.7), glow(RED, 0.5));
  needleGlow.position.x = 2.0;
  main.pivot.add(needleGlow);
  const ghosts = [1, 2, 3].map((i) => mkNeedle(i));
  for (const gh of ghosts) gh.mat.color.setHex(0xff5a3a);
  const hist: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  add(new THREE.Mesh(new THREE.CircleGeometry(0.55, 16), new THREE.MeshBasicMaterial({ color: 0x2a2433, fog: false, side: THREE.DoubleSide }))).position.z = 0.12;
  const halo = glowSprite(glowTexture(), RED, 16, 0);
  halo.position.z = -0.2;
  root.add(halo);
  const cHot = new THREE.Color(0xffffff);
  const cWarm = new THREE.Color(0xffc8b8);
  const cRedHot = new THREE.Color(0xff3020);
  const cDim = new THREE.Color(0x5a1010);
  let cur = 0;
  return {
    root,
    get u() {
      return cur;
    },
    set(u: number, heat: number) {
      cur = u;
      main.pivot.rotation.z = ang(u);
      hist.unshift(u);
      hist.length = 9;
      ghosts.forEach((gh, i) => {
        const hu = hist[(i + 1) * 2];
        gh.pivot.rotation.z = ang(hu);
        gh.mat.opacity = Math.min(1, Math.abs(u - hu) * 6) * (0.55 - i * 0.15);
      });
      ticks.forEach((t, i) => ((t.material as THREE.MeshBasicMaterial).opacity = i / 45 <= u ? 1 : 0.22));
      for (const r of ring) {
        if (r.u > u) {
          r.m.color.copy(cDim);
          r.m.opacity = 0.7;
        } else {
          const age = Math.min(1, (u - r.u) * 4);
          r.m.color.copy(cHot).lerp(r.u > 0.8 ? cRedHot : cWarm, age);
          r.m.opacity = 1;
        }
      }
      (red.material as THREE.MeshBasicMaterial).opacity = 0.25 + heat * 0.75;
      (halo.material as THREE.SpriteMaterial).opacity = heat * 0.9;
      (needleGlow.material as THREE.MeshBasicMaterial).color.setHex(heat > 0.5 ? RED : 0xff8a6a);
    },
    nine(a: number) {
      (nine.material as THREE.MeshBasicMaterial).opacity = a;
    },
    notch(a: number) {
      (notchM.material as THREE.MeshBasicMaterial).opacity = a;
      (notchG.material as THREE.SpriteMaterial).opacity = a;
    },
    /** Clears the afterimages (after a cut). */
    settle() {
      hist.fill(cur);
    },
  };
}

/** Jagged additive lightning between two points, with a few forks. */
function bolt(from: THREE.Vector3, to: THREE.Vector3, w = 0.45): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xf0eaff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false });
  const seg3 = (a: THREE.Vector3, b: THREE.Vector3, w: number) => {
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, w), mat);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.add(m);
  };
  const path = (a: THREE.Vector3, b: THREE.Vector3, n: number, jag: number, w: number, forks: number) => {
    let p = a.clone();
    for (let i = 1; i <= n; i++) {
      const q = a.clone().lerp(b, i / n);
      if (i < n) q.add(new THREE.Vector3(rand(-jag, jag), rand(-jag, jag) * 0.3, rand(-jag, jag)));
      seg3(p, q, w);
      if (forks > 0 && Math.random() < 0.35) path(q, q.clone().add(new THREE.Vector3(rand(-8, 8), -rand(4, 10), rand(-6, 6))), 4, jag * 0.6, w * 0.5, 0);
      p = q;
    }
  };
  path(from, to, 10, 3, w, 1);
  const s = glowSprite(glowTexture(), 0xb8a8ff, 30, 1);
  s.position.copy(to);
  g.add(s);
  return g;
}


type RosaRig = CharacterRig & {
  props?: Record<string, THREE.Object3D>;
  torso?: THREE.Object3D;
  setTurn?: (k: number) => void;
  setCold?: (k: number) => void;
  setEyeGlow?: (k: number, snap?: boolean) => void;
  liftHelmet?: (k: number) => void;
  setLook?: (x: number, y: number) => void;
  setBeatDt?: (dt: number) => void;
  setHandPose?: (side: 'L' | 'R', pose: 'open' | 'fist' | 'grip' | 'point' | 'wave' | 'flat') => void;
};

/** Deterministic 0..1 noise (screenshots at a given t look the same every time). */
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Arm / torso / head pose on the outer pivots (the rig's idle sway still plays on the inner ones). */
interface Pose {
  lx: number; // armL forward raise (negative = forward)
  lz: number; // armL sideways (positive = out to her left)
  rx: number;
  rz: number; // armR (positive = across the body)
  tx: number; // torso pitch
  ty: number; // torso yaw
  hx: number; // head pitch (down +)
  hy: number; // head yaw
  hz: number; // head tilt
}
const P = (lx: number, lz: number, rx: number, rz: number, tx = 0, ty = 0, hx = 0, hy = 0, hz = 0): Pose => ({ lx, lz, rx, rz, tx, ty, hx, hy, hz });

export default function rosa(d: Director, card: CardInfo) {
  // ---------- set + light ----------
  const set = buildDragStrip(d.stage, { haze: 0x030204, sky: [0x0a0308, 0x010102], fogNear: 2, fogFar: 26, dark: true });
  d.crowd = set.crowd;
  d.hype = 0.15;
  set.power(() => false);
  set.group.visible = false; // pure black until the lightning
  const fog = d.stage.scene.fog as THREE.Fog;
  const fogTo = (col: number, near: number, far: number) => {
    fog.color.setHex(col);
    fog.near = near;
    fog.far = far;
  };
  const bg = d.stage.scene.background as THREE.Color;
  // looks (Style presets): harsh red-rimmed jerk light; a near-black cold one for the dark beats; a hot hero one
  const JERK = harshJerk(0xff1a2a, 0xffe0d0);
  const DARKL = mixLook(JERK, harshJerk(0xff1a2a, 0x8090ff), 0.6);
  DARKL.exposure = 0.8;
  DARKL.vignette = 0.85;
  const HEROL = harshJerk(0xff1a2a, 0xffb040);
  HEROL.bloom = 1.3;
  // the burnout: hot, but held down so the car, the flames and her eyes keep their shapes
  const BURNL = mixLook(DARKL, HEROL, 0.4);
  BURNL.bloom = 0.5;
  BURNL.exposure = 0.82;
  BURNL.contrast = 1.38;
  BURNL.vignette = 0.75;
  d.look(0, DARKL);
  const rim = new THREE.PointLight(0xff1a1a, 0, 26, 1.2);
  rim.position.set(-1, 4, LANE - 4);
  d.scene.add(rim);

  // ---------- Rosa: out of the window, helmet off, eyes already burning ----------
  const b = mountBoss(d, buildBossCar('rosa'), buildCharacter('rosa'), 2.3);
  const car = b.car.root;
  car.position.set(0, 0, LANE);
  const rig = b.char as RosaRig;
  const head = b.char.head;
  const torso = rig.torso;
  b.char.root.position.y += 0.3; // up out of the window: arms and the autograph clear the door
  const R = headR(b);
  const armL0 = b.char.armL.rotation.clone();
  const armR0 = b.char.armR.rotation.clone();
  const torso0 = torso ? torso.rotation.clone() : null;
  const head0 = head.rotation.clone();
  rig.setTurn?.(1);
  b.char.setExpression('smirk');
  rig.setCold?.(1);
  rig.setEyeGlow?.(1, true);
  b.char.setSignature(0.5);
  rig.liftHelmet?.(1);
  if (!rig.liftHelmet && rig.props?.helmet) rig.props.helmet.visible = false;
  // settle the helmet off-screen before frame one (the lift is smoothed on the beat clock)
  for (let i = 0; i < 12; i++) {
    rig.setBeatDt?.(0.1);
    b.char.update(0.0001);
  }
  d.every((dt) => rig.setBeatDt?.(dt));

  // a fan's autograph card (her own smiling photo) in her left fist
  const auto = buildAutograph();
  const gripL = rig.props?.gripL ?? rig.props?.handL ?? b.char.armL;
  gripL.add(auto.root);
  rig.setHandPose?.('L', 'grip');
  rig.setHandPose?.('R', 'open');
  auto.root.scale.setScalar(1.7); // cartoon-big so it reads
  // grip frame: +X out of the fist, +Y up. The card stands up out of the fist, photo side forward.
  auto.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)));
  d.onDispose(() => auto.dispose());

  // ---------- timeline ----------
  const LIGHTS = 1.3; // hard cut to the stadium, lightning, banks slam on
  const SHE = 1.95; // first look at her
  const CR0 = 2.45; // crumple
  const CR1 = 3.05;
  const FLICK = 3.5;
  const HIT = 3.8;
  const HELM = 4.05; // helmet down
  const SLAM = 4.27;
  const STARE = 4.45;
  const BURN = 5.3;
  const HERO = 6.95;
  const SNAP = 7.75;
  const CARD = 8.35;

  // ---------- poses ----------
  const HOLD = P(-1.2, 0.18, -0.2, 0.05, 0, 0, 0.22, 0, 0.06); // holding it up, looking down her nose at it
  const SNEER = P(-1.3, 0.1, -0.2, 0.05, 0.05, 0, 0.05, 0, -0.06); // eyes back on you over the card
  const CRUM = P(-1.3, -0.55, -1.3, 0.6, 0.02, 0, -0.1, 0.08, 0.1); // chin up, head cocked: looking down her nose at you
  const WIND = P(-2.2, -0.05, -0.2, 0.1, -0.05, 0, 0.0, 0, -0.08);
  const FLK = P(-1.45, 0.05, -0.2, 0.1, 0.12, 0, 0.05, 0, -0.04);
  const REST = P(-0.25, 0, -0.25, 0, 0, 0, 0.06, 0, 0);
  const LOOKBACK = P(-0.2, 0, -0.4, 0, 0, -0.55, 0.12, -1.0, 0);
  const keys: [number, Pose][] = [
    [0, HOLD], [SHE + 0.25, HOLD], [SHE + 0.4, SNEER], [CR0 - 0.05, SNEER], [CR0 + 0.12, CRUM], [CR1, CRUM],
    [FLICK - 0.08, WIND], [FLICK + 0.04, FLK], [HIT + 0.05, FLK], [HELM + 0.2, REST],
    [BURN + 0.1, REST], [BURN + 0.45, LOOKBACK], [HERO - 0.001, LOOKBACK], [HERO, REST],
  ];
  const pose = P(0, 0, 0, 0);
  const evalPose = (t: number) => {
    let i = 0;
    while (i < keys.length - 1 && keys[i + 1][0] <= t) i++;
    const [ta, a] = keys[i];
    const [tb, bb] = keys[Math.min(i + 1, keys.length - 1)];
    const u = tb > ta ? easeInOut(seg(t, ta, tb)) : 1;
    for (const k of Object.keys(pose) as (keyof Pose)[]) pose[k] = lerp(a[k], bb[k], u);
  };
  d.every(() => {
    evalPose(d.t);
    b.char.armL.rotation.set(armL0.x + pose.lx, armL0.y, armL0.z + pose.lz);
    b.char.armR.rotation.set(armR0.x + pose.rx, armR0.y, armR0.z + pose.rz);
    if (torso && torso0) torso.rotation.set(torso0.x + pose.tx, torso0.y + pose.ty, torso0.z);
    head.rotation.set(head0.x + pose.hx, head0.y + pose.hy, head0.z + pose.hz);
  });

  /** Character-relative camera (see faceCam), as a follow() frame. */
  const fc = (dist: number, yaw: number, up: number, lookUp: number, fov: number, roll = 0) => ({ ...faceCam(b, dist, yaw, up, lookUp), fov, roll });

  // =====================================================================================
  // 0: darkness. The giant tach sweeps to redline.
  // =====================================================================================
  const tach = buildTach();
  d.scene.add(tach.root);
  tach.root.position.set(-30, 3.2, LANE);
  tach.root.rotation.y = Math.PI / 2; // faces +X (the opening camera)
  tach.set(0, 0);
  const onTach = (x: number, y: number, z = 0) => {
    tach.root.updateWorldMatrix(true, false);
    return tach.root.localToWorld(new THREE.Vector3(x, y, z));
  };
  const A_RED = -Math.PI * 0.25 + Math.PI * 1.5 * 0.08;
  const redPt = onTach(Math.cos(A_RED) * 3.8, Math.sin(A_RED) * 3.8);
  d.bars(true);
  d.cut(0, [-14, 3.2, LANE], [-30, 3.2, LANE], 44);
  d.move(0, 0.98, { pos: [-19, 3.2, LANE], fov: 40, roll: 0.06 }, easeInOut);
  d.move(0.98, 1.08, { pos: [-23, redPt.y, redPt.z * 0.5 + LANE * 0.5], look: redPt, fov: 26, roll: -0.12 }, easeOut);
  d.move(1.08, LIGHTS, { pos: [-24, redPt.y, redPt.z * 0.5 + LANE * 0.5], fov: 23, roll: -0.16 }, easeOut);
  d.at(1.02, () => {
    d.cam.punch(-8);
    d.cam.shake(0.3);
    d.flash('#ff2a2a', 0.35, 10);
    d.sfx.impact();
  });
  d.span(1.02, LIGHTS, (u) => tach.nine(u >= 1 ? 0 : Math.floor(u * 9) % 2 === 0 ? 1 : 0.15));
  d.stamp(1.0, 'REDLINE', { color: '#ff2a2a', x: 440, y: 90, size: 24, rot: -0.12, dur: 0.3 });
  d.at(0.3, () => d.sfx.roar('rosa'));
  d.span(0.25, LIGHTS, (u) => {
    // revs in two blips, then all the way
    const k = u < 0.32 ? Math.sin((u / 0.32) * Math.PI) * 0.45 : easeOut(seg(u, 0.36, 0.72));
    tach.set(Math.min(1, k + (k > 0.98 ? Math.sin(d.t * 90) * 0.012 : 0)), seg(k, 0.8, 1));
    if (k > 0.8) d.cam.shake(0.05);
  });

  // =====================================================================================
  // 1.3: hard cut up at the dead stadium; lightning on the towers; the banks slam on
  // =====================================================================================
  d.cut(LIGHTS, [-6, 0.7, LANE + 5.5], [-40, 17, -23], 62, 0.08);
  d.move(LIGHTS, SHE, { pos: [-8, 0.8, LANE + 5], fov: 54, roll: -0.04 }, easeOut);
  d.at(LIGHTS, () => {
    set.group.visible = true;
    tach.root.visible = false;
    fogTo(0x0a0408, 40, 200);
    bg.setHex(0x020104);
    d.cam.punch(-10);
  });
  strikeAt(LIGHTS, -14, 23.5, -23.2, '#ffffff', 0.4);
  strikeAt(LIGHTS + 0.1, -60, 23.5, -23.2, '#e0d0ff', 0.5);
  strikeAt(1.86, 32, 23.5, -23.2, '#ffffff', 0.4);
  for (let i = 0; i < 6; i++)
    d.at(1.48 + i * 0.075, () => {
      set.power((x) => x <= -60 + i * 56);
      d.flash('#fff0d8', 0.22, 14);
      d.cam.punch(-2.5);
      d.cam.shake(0.25);
      d.hype = 0.3 + i * 0.12;
      fog.color.setHex([0x12060c, 0x1a0810, 0x220a12, 0x2a0c16, 0x300c18, 0x340c18][i]);
      if (i === 0 || i === 5) d.sfx.impact();
    });
  d.look(1.48, JERK, 0.4);

  // =====================================================================================
  // 1.95: there she is. A fan's autograph in her fist; she looks at it like it's dirt.
  // =====================================================================================
  d.at(SHE, () => {
    set.power(() => true);
    fogTo(0x1a0810, 30, 190);
    bg.setHex(0x08030a);
    rim.intensity = 7;
    d.hype = 0.8;
  });
  d.follow(SHE, CR0, (u) => fc(lerp(9.2, 8.2, easeOut(u)), lerp(0.42, 0.34, u), -0.3, -0.7, 32, 0.03));
  d.at(SHE, () => d.cam.punch(-4));
  // the fans keep snapping photos (bad idea)
  for (let i = 0; i < 9; i++) {
    const t = SHE + 0.05 + hash(i) * (FLICK - SHE - 0.1);
    d.at(t, () => {
      const p = new THREE.Vector3(lerp(-24, 24, hash(i + 40)), lerp(2.5, 9, hash(i + 80)), lerp(-17, -21, hash(i + 120)));
      d.fx.glow.spawn(p, { life: 0.12, size: 2.2, color: 0xffffff, spread: 0, grow: 0.3 });
      d.sparkle(p, 10, '#ffffff');
      d.sfx.flashPop?.();
    });
  }
  // crumples it, slowly, holding your eye
  // low and close: she looks down her nose at you over the card
  d.follow(CR0, FLICK, (u) => fc(lerp(5.4, 4.6, easeOut(u)), 0.18, -1.0, -0.2, 30, 0.05));
  d.span(CR0 + 0.1, CR1, (u) => auto.crumple(easeOut(u)));
  d.at(CR0, () => rig.setHandPose?.('R', 'fist'));
  d.at(HIT + 0.2, () => rig.setHandPose?.('R', 'open'));
  d.at(CR0 + 0.1, () => {
    d.sfx.crumple();
    d.cam.shake(0.25);
  });
  // and flicks it at the lens
  d.slowmo(FLICK, HIT + 0.08, 0.3, 0.06, false);
  d.follow(FLICK, HIT, (u) => fc(lerp(6.4, 5.8, u), 0.12, -0.5, -0.5, 30, lerp(0.04, -0.05, u)));
  let ballFrom: THREE.Vector3 | null = null;
  d.at(FLICK, () => {
    d.scene.attach(auto.root);
    ballFrom = auto.root.position.clone();
    d.sfx.whoosh();
  });
  d.span(FLICK, HIT, (u) => {
    if (!ballFrom) return;
    const c = d.stage.camera;
    const f = new THREE.Vector3();
    c.getWorldDirection(f);
    const to = c.position.clone().addScaledVector(f, 0.35);
    auto.root.position.lerpVectors(ballFrom, to, u * u);
    auto.root.position.y += Math.sin(u * Math.PI) * 0.6;
    auto.root.rotation.set(u * 9, u * 6, u * 4);
    auto.root.visible = u < 1;
  });
  d.impactFrame(HIT, '#ffffff', 1);
  d.at(HIT, () => {
    auto.root.visible = false;
    d.cam.punch(9);
    d.cam.shake(1.2);
    d.sfx.paperTik?.();
    d.sfx.impact();
  });
  d.stamp(HIT + 0.03, 'NO PHOTOS.', { color: '#ffffff', x: 420, y: 92, size: 24, rot: 0.08, dur: 0.75 });

  // =====================================================================================
  // 4.05: the helmet slams down over the burning eyes (a short glitch accent on the slam)
  // =====================================================================================
  d.follow(HELM, STARE, (u) => fc(lerp(6.6, 6.1, u), 0.25, 0.3, 0.5, 36, -0.05));
  d.at(HELM, () => {
    rig.liftHelmet?.(0);
    if (!rig.liftHelmet && rig.props?.helmet) rig.props.helmet.visible = true;
    d.sfx.whoosh();
  });
  d.glitch(SLAM - 0.02, SLAM + 0.16, 0.6);
  d.impactFrame(SLAM, '#000000', 2);
  d.at(SLAM, () => {
    d.cam.punch(-8);
    d.cam.shake(1);
    d.sfx.impact();
    d.sfx.thunder();
    d.flash('#ff2a2a', 0.3, 12);
  });

  // =====================================================================================
  // 4.45: cold, dead-still stare through the visor while the stadium dies bank by bank
  // =====================================================================================
  d.follow(STARE, BURN - 0.001, (u) => fc(lerp(4.6, 3.5, easeInOut(u)), 0.02, 0.05, 0.05, lerp(30, 24, easeInOut(u)), lerp(0.02, 0.07, u)));
  d.at(STARE, () => d.cam.punch(-4));
  for (let i = 0; i < 6; i++)
    d.at(STARE + 0.15 + i * 0.12, () => {
      set.power((x) => Math.abs(x) > 6 + i * 34);
      d.cam.shake(0.1);
      fog.color.setHex([0x14060c, 0x10040a, 0x0c0308, 0x080206, 0x050104, 0x030102][i]);
      if (i === 5) {
        d.crowd = null;
        bg.setHex(0x020103);
        rim.intensity = 5;
      }
    });
  d.look(STARE + 0.3, DARKL, 0.5);

  // =====================================================================================
  // 5.3: burns rubber in your face
  // =====================================================================================
  let burn = 0;
  const flames = rate(34);
  const smoke = rate(14);
  // low, right behind the car: the rear tyres and the exhausts point straight down the lens
  d.cut(BURN, [-7.2, 0.55, LANE + 1.2], [0, 1.4, LANE], 44, 0.06);
  d.follow(BURN, HERO - 0.001, (u) => {
    const s = easeOut(seg(u, 0, 0.6));
    const p = new THREE.Vector3(lerp(-7.2, -6.0, s), lerp(0.55, 0.7, s), lerp(LANE + 1.2, LANE + 0.9, s));
    const look = headPos(b, H).lerp(new THREE.Vector3(0, 1.0, LANE), 0.35);
    return { pos: p, look, fov: lerp(46, 34, easeInOut(seg(u, 0.25, 0.75))), roll: lerp(0.06, -0.04, u) };
  });
  d.at(BURN, () => {
    burn = 1;
    d.sfx.roar('rosa');
    d.sfx.drift(1.4);
    d.cam.shake(0.6);
    rim.position.set(-4, 3, LANE + 1);
    rim.intensity = 10;
  });
  d.look(BURN, BURNL);
  d.slowmo(BURN + 0.5, HERO - 0.12, 0.22, 0.18);
  d.span(BURN, HERO, (u) => {
    b.car.setWheelSpin(0, 280);
    b.car.setLean(Math.sin(d.t * 37) * 0.03, -0.05 - Math.sin(d.t * 23) * 0.02);
    car.position.x = Math.sin(d.t * 41) * 0.03;
    d.hype = 0;
    if (u >= 1) burn = 0;
  });
  // flame bursts lick across the lens
  const lick = (t: number) =>
    d.at(t, () => {
      const c = d.stage.camera;
      const f = new THREE.Vector3();
      c.getWorldDirection(f);
      const right = f.clone().cross(c.up).normalize();
      // a few separate tongues along the bottom of the frame (not a wall of fire)
      for (let i = 0; i < 5; i++)
        d.fx.flame(c.position.clone().addScaledVector(f, 4.2).addScaledVector(right, -2.4 + i * 1.2).add(new THREE.Vector3(0, rand(-1.5, -1.2), 0)), 1, {
          size: rand(0.22, 0.3), life: 0.3, spread: 0.1, grow: 0.8, stretch: 0.12, color: [0xffc850, 0xff7a20][i % 2], colorEnd: 0x7a0a04,
          vel: new THREE.Vector3(0, 4.5, 0),
        });
      d.flash('#ff6a00', 0.1, 14);
      d.cam.shake(0.5);
    });
  lick(BURN + 0.3);
  lick(BURN + 0.75);
  d.span(BURN + 0.7, HERO, (u) => {
    d.wash.col = '#ff5a10';
    d.wash.a = u >= 1 ? 0 : 0.035 + 0.025 * Math.sin(d.t * 30);
  });
  d.stamp(BURN + 0.55, 'EAT\nSMOKE.', { color: '#ff7a20', x: 160, y: 96, size: 24, rot: -0.1, dur: 0.85 });

  // =====================================================================================
  // 6.95: HERO. Everything slams back red; the tach is her halo; the needle snaps into the sweet spot.
  // =====================================================================================
  const heroCam = () => {
    const f = faceCam(b, 6.4, 0.2, -2.6, 0);
    const c = f.pos;
    const hp = f.look;
    const fov = 40;
    const dir = hp.clone().sub(c).normalize();
    const right = dir.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
    const up = right.clone().cross(dir).normalize();
    const dist = c.distanceTo(hp);
    const ty = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const tx = ty * (16 / 9);
    // head on the right third, upper half (clear of the left name card): aim to her lower-left
    const look = hp.clone().addScaledVector(right, -0.5 * tx * dist).addScaledVector(up, -0.32 * ty * dist);
    return { pos: c, look, fov };
  };
  let halo = 0;
  d.at(HERO, () => {
    d.fx.clear();
    set.power(() => true);
    d.crowd = set.crowd;
    d.hype = 1;
    fogTo(0x3a0a12, 30, 190);
    bg.setHex(0x12030a);
    rim.position.set(0, 4, LANE - 4);
    rim.intensity = 9;
    car.position.x = 0;
    b.char.setSignature(0.85);
    tach.root.visible = true;
    tach.set(0.5, 1);
    tach.settle();
    halo = 1;
    d.cam.punch(-10);
    d.cam.shake(0.9);
    d.wash.col = '#ff1020';
    d.sfx.impact();
  });
  d.look(HERO, HEROL);
  d.impactFrame(HERO, '#c8141e', 2);
  d.span(HERO, HERO + 0.3, (u) => (d.wash.a = u >= 1 ? 0 : 0.2 * (1 - u)));
  d.follow(HERO, 30, (u) => {
    const h = heroCam();
    return { pos: h.pos.addScaledVector(new THREE.Vector3(0, 1, 0), lerp(0, 0.4, easeOut(u * 4))), look: h.look, fov: lerp(46, 40, easeOut(Math.min(1, u * 6))), roll: 0.08 };
  });
  strikeAt(HERO + 0.02, 30, 23.5, -23.2, '#ffffff', 0.35);
  strikeAt(HERO + 0.4, -40, 23.5, -23.2, '#ffd0d0', 0.3);
  const backfire = (t: number, big = 1) =>
    d.at(t, () => {
      for (const p of exhaustPoints(b))
        for (let i = 0; i < 7; i++)
          d.fx.flame(p, 1, { size: rand(1.0, 1.5) * big, spread: 2.2, life: 0.3, color: [0xffd060, 0xff8a20, 0xff3a10][i % 3], vel: { x: -10, y: 1, z: 0 } });
      d.flash('#ff6a00', 0.3 * big, 14);
      d.cam.shake(0.4 * big);
    });
  d.at(HERO + 0.1, () => d.sfx.roar('rosa'));
  backfire(HERO + 0.12, 0.6);
  backfire(HERO + 0.3, 0.5);
  d.span(HERO, SNAP, (u) => tach.set(lerp(0.5, SWEET, easeOut(u)) + Math.sin(u * 34) * 0.06 * (1 - u), 1));
  d.at(SNAP, () => {
    tach.set(SWEET, 1);
    tach.notch(1);
    d.flash('#ffffff', 0.45, 22);
    d.cam.punch(-5);
    d.sfx.impact();
  });

  // ---------- card ----------
  d.freeze(CARD, 0.25, 0.6);
  d.nameCard(CARD, { ...card, color: '#c8141e', accent: '#ffffff', layout: 'left' }, 0.8, 'rosa');
  d.at(CARD + 0.7, () => d.sfx.voice('rosa', 'taunt'));

  // ---------- lightning ----------
  function strikeAt(t: number, x: number, y: number, z: number, flash = '#ffffff', a = 0.55) {
    d.at(t, () => {
      const g = bolt(new THREE.Vector3(x + rand(-10, 10), 80, z + rand(-6, 6)), new THREE.Vector3(x, y, z));
      d.scene.add(g);
      d.cam.shake(0.6);
      d.sfx.thunder();
      let life = 0.24;
      let flashed = false;
      d.every((dt) => {
        if (life <= 0) return;
        life -= dt;
        if (!flashed && life < 0.2) {
          flashed = true;
          d.flash(flash, a, 9);
        }
        g.visible = life > 0 && (life > 0.16 || Math.random() > 0.35);
      });
    });
  }

  // ---------- eyes: burning through everything (and through the visor) ----------
  const H = new THREE.Vector3();
  const eyeTex = glowTexture();
  const eyeSpr = (c: number) => {
    const s = glowSprite(eyeTex, c, 1, 0);
    (s.material as THREE.SpriteMaterial).depthTest = false;
    s.renderOrder = 20;
    d.scene.add(s);
    return s;
  };
  const eyes = b.char.eyes.map(() => ({ bloom: eyeSpr(RED), streak: eyeSpr(0xff3a2a), core: eyeSpr(0xffffff) }));
  const fwd = new THREE.Vector3();
  const q = new THREE.Quaternion();

  // ---------- per frame ----------
  d.every((_dt, wdt) => {
    // burnout: tyre smoke and exhaust flames pour straight at the lens
    const m = smoke(wdt, burn);
    if (m) {
      const rp = rearPoints(b);
      for (let i = 0; i < m; i++)
        d.fx.smoke(rp[i % rp.length], 1, { color: 0x221a20, size: rand(0.35, 0.55), grow: 2.0, life: 1.1, spread: 0.8, vel: { x: -rand(3, 5), y: rand(0.2, 0.7), z: rand(0.6, 2.0) }, drag: 1.4 });
    }
    const n = flames(wdt, burn);
    if (n) {
      const ex = exhaustPoints(b);
      const cols = [0xffd060, 0xff8a20, 0xff4a14];
      for (let i = 0; i < n; i++) {
        const e = ex[i % ex.length];
        // toward the lens but angled off to the side, so each tongue streaks past as its own shape
        const v = d.stage.camera.position.clone().sub(e).setY(0.15).normalize().multiplyScalar(9).add(new THREE.Vector3(0, 0, 3.5));
        d.fx.flame(e, 1, { vel: v, size: rand(0.26, 0.4), spread: 0.4, grow: 1.0, stretch: 0.08, color: cols[i % 3], colorEnd: 0x6a0804, life: 0.26 });
      }
    }
    // embers rising round her once the lights are on
    if (d.t > SHE && Math.random() < 0.4) {
      headPos(b, H);
      const away = H.clone().sub(d.stage.camera.position).setY(0).normalize();
      d.fx.glow.spawn(H.clone().addScaledVector(away, rand(1.5, 4)).add(new THREE.Vector3(rand(-3, 3), rand(-2.5, 0), rand(-3, 3))), {
        life: 1.6, size: d.t > HERO ? 0.2 : 0.1, color: Math.random() < 0.5 ? 0xff5a2a : 0xff2a10, gravity: -1.6, spread: 0.6,
      });
    }
    // eye sprites: subtle while the rig's own glow shows (helmet off), full through the visor; faded when facing away
    const k0 = d.t < HELM + 0.12 ? 0.45 : 1;
    head.getWorldQuaternion(q);
    fwd.set(0, 0, 1).applyQuaternion(q);
    const cam = d.stage.camera.position;
    b.char.eyes.forEach((e, i) => {
      const sp = eyes[i];
      Director.wp(e, H);
      const k = k0 * seg(fwd.dot(cam.clone().sub(H).normalize()), -0.1, 0.35) * (d.t < LIGHTS ? 0 : 1);
      sp.bloom.position.copy(H);
      sp.streak.position.copy(H);
      sp.core.position.copy(H);
      // bigger and hotter through the burnout smoke, so they stay on you over her shoulder
      const fl = (1 + Math.sin(d.t * 30 + i) * 0.08) * (burn ? 1.5 : 1);
      const s = R * (0.3 + 0.5 * k) * fl;
      sp.bloom.scale.set(s, s, 1);
      sp.core.scale.set(R * 0.3 * k, R * 0.2 * k, 1);
      sp.streak.scale.set(R * 3 * k * fl, R * 0.12 * k, 1);
      (sp.bloom.material as THREE.SpriteMaterial).opacity = k * 0.8;
      (sp.core.material as THREE.SpriteMaterial).opacity = k;
      (sp.streak.material as THREE.SpriteMaterial).opacity = k * 0.8;
    });
    // the giant tach: a halo straight behind her head, facing the lens
    if (halo) {
      headPos(b, H);
      const dir = H.clone().sub(cam).normalize();
      tach.root.position.copy(H).addScaledVector(dir, 34);
      tach.root.lookAt(cam);
      const dist = cam.distanceTo(tach.root.position);
      const ty = Math.tan(THREE.MathUtils.degToRad(d.stage.camera.fov / 2));
      tach.root.scale.setScalar((ty * dist * 0.5) / 5.4);
    }
  });
}
