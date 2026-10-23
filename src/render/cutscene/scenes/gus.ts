// GALE FORCE GUS: a red-faced, blustering blowhard from the first frame. COLD OPEN: he is already bellowing a
// gale from his sky-blue truck, sneering, holding a pinwheel up at you and blowing it until it SHREDS. The
// grandstand gets blown clean out of its seats. Then the big one: a deep comic INHALE (he balloons up out of
// the window, a flick of glitch at the peak) and the BIGGEST BELLOW, straight down the lens: a cone, a DRAG
// STRIP sign, a lawn chair, a porta-potty (occupied) and the cow skim the camera. Slow-mo: your car's spoiler
// tears off, tumbles at the lens and SMACKS it (crack). He laughs his head off; the cone lands on his head
// like a party hat. Card.
import * as THREE from 'three';
import { FONT } from '../../palette';
import { Director, easeInOut, easeOut, lerp, rand, type CardInfo } from '../director';
import { easeIn, outline, toonMat } from '../fx';
import { buildBossCar, buildCar3D, buildCharacter } from '../models';
import { buildPinwheel } from '../models/props';
import { buildDragStrip } from '../stage';
import { faceCam, harshJerk, headPos, headR, mountBoss, rate, talk } from './common';

const LANE = -2.6;
const PLAYER_LANE = 2.6;

// ---------- debris (from v2) ----------

/** Outlined toon box, added to `parent`. */
function box(parent: THREE.Object3D, w: number, h: number, dp: number, col: number, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dp), toonMat(col));
  m.position.set(x, y, z);
  outline(m);
  parent.add(m);
  return m;
}

function buildCone() {
  const g = new THREE.Group();
  const c = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.9, 12), toonMat(0xf28c28));
  outline(c);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.14, 12), toonMat(0xf4f2ee));
  band.position.y = 0.02;
  box(g, 0.75, 0.08, 0.75, 0xf28c28, 0, -0.45, 0);
  g.add(c, band);
  return g;
}

function signTexture() {
  const cv = document.createElement('canvas');
  cv.width = 96;
  cv.height = 54;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#f7d23e';
  g.fillRect(0, 0, 96, 54);
  g.fillStyle = '#07060d';
  g.fillRect(0, 0, 96, 3);
  g.fillRect(0, 51, 96, 3);
  g.fillRect(0, 0, 3, 54);
  g.fillRect(93, 0, 3, 54);
  g.font = `10px ${FONT}`;
  g.textBaseline = 'top';
  g.fillText('DRAG', 8, 8);
  g.fillText('STRIP', 8, 22);
  g.fillRect(8, 40, 56, 6);
  g.beginPath();
  g.moveTo(62, 34);
  g.lineTo(80, 43);
  g.lineTo(62, 52);
  g.closePath();
  g.fill();
  const t = new THREE.CanvasTexture(cv);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildSign() {
  const g = new THREE.Group();
  const side = toonMat(0xd8b02a);
  const face = toonMat(0xffffff, { map: signTexture() });
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 0.08), [side, side, side, side, face, face]);
  outline(board);
  g.add(board);
  box(g, 0.12, 1.6, 0.12, 0x8a8496, -0.5, -1.2, -0.06);
  box(g, 0.12, 1.6, 0.12, 0x8a8496, 0.5, -1.2, -0.06);
  return g;
}

/** Blue porta-potty with a flapping door (and a very surprised man inside). Origin at its centre. */
function buildPotty() {
  const g = new THREE.Group();
  box(g, 1.0, 2.0, 1.0, 0x3a8ce0, 0, 0, 0);
  box(g, 0.84, 1.8, 0.02, 0x07060d, 0, -0.05, 0.51);
  // the occupant: a round pink face with two dot eyes and an O mouth
  const face = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), toonMat(0xf0b090));
  face.position.set(0, 0.35, 0.5);
  outline(face);
  g.add(face);
  box(g, 0.05, 0.07, 0.02, 0x07060d, -0.07, 0.4, 0.69);
  box(g, 0.05, 0.07, 0.02, 0x07060d, 0.07, 0.4, 0.69);
  box(g, 0.08, 0.08, 0.02, 0x3a0a14, 0, 0.26, 0.68);
  box(g, 1.12, 0.14, 1.12, 0xf4f2ee, 0, 1.06, 0);
  box(g, 0.14, 0.3, 0.14, 0xf4f2ee, 0.28, 1.25, -0.2);
  const hinge = new THREE.Group();
  hinge.position.set(-0.42, -0.05, 0.53);
  g.add(hinge);
  const door = box(hinge, 0.84, 1.8, 0.05, 0x5aa8f0, 0.42, 0, 0);
  box(door, 0.2, 0.06, 0.02, 0xe84a3a, 0.2, 0.1, 0.03);
  box(door, 0.12, 0.12, 0.02, 0x07060d, 0, 0.6, 0.03);
  g.userData.door = hinge;
  return g;
}

function buildChair() {
  const g = new THREE.Group();
  const al = 0xd6dae4;
  for (const x of [-0.4, 0.4]) {
    box(g, 0.06, 0.06, 0.9, al, x, 0, 0);
    box(g, 0.06, 0.06, 0.95, al, x, 0.42, -0.62).rotation.x = -1.25;
    box(g, 0.06, 0.5, 0.06, al, x, -0.25, 0.4);
    box(g, 0.06, 0.5, 0.06, al, x, -0.25, -0.4);
  }
  for (let i = 0; i < 5; i++) box(g, 0.8, 0.03, 0.14, i % 2 ? 0xf4f2ee : 0x4ec07a, 0, 0.02, -0.36 + i * 0.18);
  for (let i = 0; i < 5; i++) {
    const s = box(g, 0.8, 0.14, 0.03, i % 2 ? 0xf4f2ee : 0x4ec07a, 0, 0.1 + i * 0.17, -0.5 - i * 0.05);
    s.rotation.x = -0.3;
  }
  return g;
}

/** A Holstein, built from boxes. Head points +Z (so lookAt() makes her stare). Origin at the hooves. */
function buildCow() {
  const g = new THREE.Group();
  const W = 0xf4f2ee;
  const K = 0x17151d;
  const P = 0xf29aa8;
  box(g, 1.0, 0.75, 1.6, W, 0, 0.95, 0);
  box(g, 0.04, 0.4, 0.55, K, 0.51, 1.0, 0.2);
  box(g, 0.04, 0.3, 0.4, K, 0.51, 0.85, -0.5);
  box(g, 0.04, 0.45, 0.5, K, -0.51, 1.05, -0.25);
  box(g, 0.5, 0.04, 0.45, K, 0.15, 1.33, -0.35);
  box(g, 0.35, 0.04, 0.3, K, -0.2, 1.33, 0.4);
  for (const x of [-0.35, 0.35])
    for (const z of [-0.6, 0.6]) {
      box(g, 0.22, 0.6, 0.22, W, x, 0.32, z);
      box(g, 0.24, 0.1, 0.24, K, x, 0.05, z);
    }
  box(g, 0.42, 0.2, 0.36, P, 0, 0.5, -0.4);
  for (const x of [-0.1, 0.1]) box(g, 0.06, 0.12, 0.06, P, x, 0.36, -0.4);
  const tail = box(g, 0.06, 0.6, 0.06, W, 0, 0.95, -0.83);
  box(tail, 0.12, 0.14, 0.12, K, 0, -0.3, 0);
  const head = new THREE.Group();
  head.position.set(0, 1.3, 0.95);
  g.add(head);
  box(head, 0.56, 0.56, 0.62, W, 0, 0, 0);
  box(head, 0.2, 0.3, 0.04, K, -0.12, 0.1, 0.32);
  box(head, 0.52, 0.28, 0.2, P, 0, -0.18, 0.36);
  box(head, 0.07, 0.07, 0.02, K, -0.12, -0.16, 0.47);
  box(head, 0.07, 0.07, 0.02, K, 0.12, -0.16, 0.47);
  for (const x of [-0.17, 0.17]) {
    box(head, 0.17, 0.17, 0.04, 0xffffff, x, 0.14, 0.32);
    box(head, 0.08, 0.08, 0.02, K, x, 0.13, 0.355);
  }
  box(head, 0.08, 0.2, 0.08, 0xefe2b8, -0.24, 0.36, 0.05).rotation.z = 0.4;
  box(head, 0.08, 0.2, 0.08, 0xefe2b8, 0.24, 0.36, 0.05).rotation.z = -0.4;
  box(head, 0.26, 0.1, 0.14, W, -0.38, 0.12, -0.05);
  box(head, 0.26, 0.1, 0.14, W, 0.38, 0.12, -0.05);
  return g;
}

// ---------- props ----------

/** Stand-in pinwheel until the Props agent's buildPinwheel() has real blades (only used if the stub is a flat box). */
function pinwheelLooksStubbed(p: { root: THREE.Object3D }) {
  let n = 0;
  p.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) n++;
  });
  return n <= 1;
}

function buildFallbackPinwheel() {
  const root = new THREE.Group();
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), toonMat(0xf4ecd8));
  stick.position.y = 0.38;
  outline(stick);
  root.add(stick);
  const hub = new THREE.Group();
  hub.position.set(0, 0.82, 0.04);
  root.add(hub);
  const cols = [0xff6aa0, 0xf7d23e, 0x7cc4f0, 0x6ad88a];
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.lineTo(0.3, 0);
    s.lineTo(0.3, 0.3);
    s.closePath();
    const m = new THREE.Mesh(new THREE.ShapeGeometry(s), toonMat(cols[i], { side: THREE.DoubleSide }));
    m.rotation.z = (i * Math.PI) / 2;
    outline(m);
    hub.add(m);
  }
  const pin = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), toonMat(0xffffff));
  hub.add(pin);
  return {
    root,
    setSpin(_r: number) {
      void _r;
    },
    hub,
    dispose() {
      /* the director disposes the scene graph */
    },
  };
}

/** Rear wing for the player's car (fallback when the car has no detachable props.spoiler). */
function buildSpoiler(w: number, col: number, dark: number) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) box(g, 0.08, 0.32, 0.06, dark, 0, 0.14, s * w * 0.32);
  const wing = box(g, 0.5, 0.07, w * 1.02, col, -0.05, 0.32, 0);
  wing.rotation.z = 0.12;
  for (const s of [-1, 1]) box(g, 0.6, 0.2, 0.04, dark, -0.05, 0.3, s * (w * 0.51 + 0.02));
  return g;
}

// ---------- the scene ----------

type GusX = ReturnType<typeof buildCharacter> & {
  setBellow?: (k: number) => void;
  setTurn?: (k: number) => void;
  setInhale?: (k: number) => void;
  setBeatDt?: (dt: number) => void;
  setLook?: (x: number, y: number) => void;
  setLaugh?: (k: number) => void;
  grip?: (hand: 'L' | 'R', prop: THREE.Object3D) => void;
};
type DirectorX = Director & { glitch?: (t0: number, t1: number, strength?: number) => void };
type SfxX = Director['sfx'] & {
  inhale?: (sec?: number) => void;
  crowdScream?: (sec?: number) => void;
  musicBox?: (sec?: number) => (() => void) | void;
  splat?: () => void;
  stopMusicBox?: () => void;
  sparkle?: () => void;
  slap?: () => void;
  glitch?: (sec?: number) => void;
  sweet?: (id: 'gus') => void;
  whoosh?: () => void;
};

export default function gus(dd: Director, card: CardInfo) {
  const d = dd as DirectorX;
  const sfx = d.sfx as SfxX;

  // ---------- set: a sunny afternoon at the strip ----------
  const set = buildDragStrip(d.stage, { haze: 0x2a3448, sky: [0x3a4258, 0x10141f], fogNear: 25, fogFar: 140 });
  d.crowd = set.crowd;
  d.hype = 0.6;
  // harsh storm light: cold key, electric-blue / hot-pink rims
  const JERK = harshJerk(0x3aa8ff, 0xff4aa8);
  JERK.keyI = 1.1;
  JERK.hemiI = 0.8;
  d.look(0, JERK);
  // bright shirts so the crowd reads when it gets blown away
  const inst = set.group.children.filter((o) => (o as THREE.InstancedMesh).isInstancedMesh) as THREE.InstancedMesh[];
  const [crowdBody, crowdHead] = inst;
  const shirts = [0xff6aa0, 0xf7d23e, 0x7cc4f0, 0x6ad88a, 0xf28c28, 0xffffff, 0xb07cf0, 0xe8413c];
  const skins = [0xf0b090, 0xc88a60, 0x8a5a3a, 0xf4c8a8];
  const tmpC = new THREE.Color();
  if (crowdBody && crowdHead) {
    for (let i = 0; i < crowdBody.count; i++) {
      crowdBody.setColorAt(i, tmpC.setHex(shirts[(i * 5 + 3) % shirts.length]));
      crowdHead.setColorAt(i, tmpC.setHex(skins[(i * 3) % skins.length]));
    }
    if (crowdBody.instanceColor) crowdBody.instanceColor.needsUpdate = true;
    if (crowdHead.instanceColor) crowdHead.instanceColor.needsUpdate = true;
  }

  // ---------- cast ----------
  const b = mountBoss(d, buildBossCar('gus'), buildCharacter('gus'), 2.4);
  const car = b.car.root;
  car.position.set(0, 0, LANE);
  const ch = b.char as GusX;
  d.every((dt) => ch.setBeatDt?.(dt));
  ch.setTurn?.(1); // a jerk from frame 0
  const R = headR(b);
  const H = new THREE.Vector3();
  headPos(b, H);
  const H0 = H.clone(); // rest head position (framing anchor)
  const rootY = b.char.root.position.y;

  // the player's car, parked in the other lane a little ahead of him
  const look = { body: 'muscle' as const, color: '#f7d23e', accent: '#e8413c' };
  const pc = d.rig(buildCar3D(look));
  pc.root.position.set(H0.x + 8.5, 0, PLAYER_LANE);
  d.scene.add(pc.root);
  let spoiler = pc.props.spoiler as THREE.Object3D | undefined;
  if (!spoiler) {
    // no detachable wing yet: hide the built-in one (meshes near the tail, above the roof line) and add ours
    pc.root.updateWorldMatrix(true, true);
    const bb = new THREE.Box3().setFromObject(pc.root);
    const tailX = bb.min.x;
    const top = bb.max.y;
    const hidden: THREE.Object3D[] = [];
    pc.root.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      const wp = new THREE.Vector3();
      o.getWorldPosition(wp);
      if (wp.x < tailX + 0.7 && wp.y > top - 0.45) hidden.push(o);
    });
    for (const o of hidden) o.visible = false;
    spoiler = buildSpoiler(2.05, 0xe8413c, 0x22202a);
    spoiler.position.copy(pc.root.worldToLocal(new THREE.Vector3(tailX + 0.25, top - 0.35, PLAYER_LANE)));
    pc.root.add(spoiler);
  }

  // pinwheel in his right hand
  const pwStub = buildPinwheel();
  const pw = pinwheelLooksStubbed(pwStub) ? buildFallbackPinwheel() : pwStub;
  if (pw !== pwStub) pwStub.dispose();
  if ('update' in pw) d.rig(pw as unknown as Parameters<typeof d.rig>[0]);
  else d.onDispose(() => pw.dispose());
  const hand = ch.props.gripR ?? ch.props.handR;
  hand.add(pw.root);
  (ch as { setHandPose?: (s: string, p: string) => void }).setHandPose?.('R', 'grip');
  pw.root.scale.setScalar(1.6);
  let spin = 5;
  let spinA = 0;
  const pwHub = (pw as { hub?: THREE.Object3D }).hub;
  let pwHeld = true;
  // keep the pinwheel upright and facing the camera side while he holds it
  const qWant = new THREE.Quaternion();
  const PW_UP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  const qPar = new THREE.Quaternion();
  d.every((_dt, wdt) => {
    spinA += spin * wdt;
    pw.setSpin(spin);
    if (pwHub) pwHub.rotation.z = -spinA;
    if (!pwHeld) return;
    // stick (+X) straight up, the wheel's face (+Z) toward the lens side
    b.char.root.getWorldQuaternion(qWant).multiply(PW_UP);
    pw.root.parent!.getWorldQuaternion(qPar);
    pw.root.quaternion.copy(qPar.invert().multiply(qWant));
  });

  // the right arm raises the pinwheel to his lips (outer pivots are the Director's to pose)
  const armR = b.char.armR;
  const pose = (k: number) => {
    armR.rotation.set(-1.25 * k, 0.5 * k, 0.35 * k);
  };
  pose(1);

  // the left-out debris
  const potty = buildPotty();
  const cow = buildCow();
  const cone = buildCone();
  const junk = [cone, buildSign(), buildChair(), potty, cow];
  for (const j of junk) {
    j.visible = false;
    d.scene.add(j);
  }
  d.every(() => {
    (potty.userData.door as THREE.Object3D).rotation.y = -Math.abs(Math.sin(d.wt * 13)) * 1.7;
  });

  const camPos = () => d.stage.camera.position;
  const camFwd = () => d.stage.camera.getWorldDirection(new THREE.Vector3());

  d.bars(true);

  // ---------- timeline ----------
  const SHRED = 0.72; // the pinwheel wheel tears off
  const S2 = 1.05; // reverse: the grandstand blows away
  const INHALE = 1.85; // the big breath
  const GLITCH = 2.8; // a flick of glitch at the peak of the breath
  const BELLOW = 2.95; // THE BIGGEST BELLOW
  const S3 = 4.15; // the player's car: spoiler
  const mouth = () => {
    headPos(b, H);
    return H.clone().add(new THREE.Vector3(0, -0.45 * R, 1.0 * R));
  };
  const talkK = (k: number) => (ch as { setTalk?: (k: number) => void }).setTalk?.(k);

  // ================= COLD OPEN (0 - 1.05): already blowing a gale, mocking you with the pinwheel =================
  const openCam = (u: number) => {
    const f = faceCam(b, lerp(5.4, 4.4, easeOut(u)), lerp(0.35, 0.2, u), lerp(-1.4, -1.1, u), lerp(-0.05, -0.15, u));
    f.look.x -= 0.2;
    return { ...f, fov: 42, roll: lerp(-0.1, -0.04, u) };
  };
  {
    const f = openCam(0);
    d.cam.pos.copy(f.pos);
    d.cam.look.copy(f.look);
    d.cam.fov = 42;
    d.cam.apply(d.stage.camera, 0, 0);
  }
  d.at(0, () => {
    d.sfx.signature('gus');
    d.sfx.voice('gus', 'yell');
    b.char.setSignature(0.7);
    ch.setBellow?.(0.75);
    d.cam.buffet = 0.14;
    spin = 30;
  });
  d.follow(0, S2, (u) => openCam(u));
  // he blows the pinwheel at you harder and harder until it spins into a blur
  d.span(0, SHRED, (u) => {
    spin = lerp(30, 160, easeIn(u));
    pw.root.position.x = Math.sin(d.wt * 60) * 0.02 * u;
  });
  d.stamp(0.08, 'PFFFFBBBT!', { color: '#bfe6ff', x: 470, y: 74, size: 16, rot: 0.1, dur: 0.6, burst: '#2a7cc0' });
  // SHRED: the wheel tears off the stick and whips past the lens; he keeps the bare stick
  const wheel = (pw as { wheel?: THREE.Object3D }).wheel ?? pw.root;
  const pwFrom = new THREE.Vector3();
  const pwTo = new THREE.Vector3();
  d.at(SHRED, () => {
    wheel.updateWorldMatrix(true, true);
    d.scene.attach(wheel);
    pwFrom.copy(wheel.position);
    d.sfx.whoosh();
    d.cam.shake(0.3);
    d.fx.sparks(pwFrom, 8, { color: 0xffd36a });
  });
  d.span(SHRED, SHRED + 0.3, (u) => {
    if (u === 0) return;
    pwTo.copy(camPos()).addScaledVector(camFwd(), 0.2).add(new THREE.Vector3(-0.7, 0.5, 0));
    wheel.position.lerpVectors(pwFrom, pwTo, easeIn(u));
    wheel.rotation.x += 0.5;
    wheel.rotation.z += 0.9;
    wheel.visible = u < 0.98;
  });
  d.stamp(SHRED + 0.04, 'SHRED!', { color: '#ffd36a', x: 190, y: 90, size: 16, rot: -0.15, dur: 0.45, burst: '#e8413c' });
  // the bare stick is flicked away at the crowd shot
  d.at(S2, () => {
    pwHeld = false;
    pw.root.visible = false;
    pose(0);
    (ch as { setHandPose?: (s: string, p: string) => void }).setHandPose?.('R', 'fist');
  });

  // ================= INHALE (1.85 - 2.95): he balloons up out of the window =================
  d.follow(INHALE, GLITCH, (u) => {
    const e = easeInOut(u);
    // a 3/4 profile so the swelling chest reads against the sky
    const f = faceCam(b, lerp(6.0, 8.0, e), lerp(0.7, 1.0, e), lerp(-1.4, -1.2, e), lerp(-0.6, -1.4, e));
    return { ...f, fov: lerp(42, 44, e), roll: lerp(0.04, -0.08, e) };
  });
  const inflate = (k: number) => {
    if (ch.setInhale) {
      ch.setInhale(k);
      return;
    }
    const t = b.char as { torso?: THREE.Object3D };
    if (!t.torso) return;
    const sx = 1 + 0.55 * k;
    const sy = 1 + 0.25 * k;
    const sz = 1 + 0.95 * k;
    t.torso.scale.set(sx, sy, sz);
    b.char.head.scale.set(1 / sx, 1 / sy, 1 / sz);
  };
  d.at(INHALE, () => {
    ch.setBellow?.(0);
    b.char.setSignature(0.25);
    d.cam.buffet = 0.03;
  });
  d.at(BELLOW - 1.4, () => sfx.inhale?.());
  d.span(INHALE, BELLOW, (u) => {
    const e = easeInOut(u);
    inflate(e);
    b.char.root.position.y = rootY + 0.45 * e + Math.sin(u * 40) * 0.015 * e; // he rises out of the window like a balloon
    b.char.head.rotation.x = lerp(0, -0.3, e);
    talkK(0.18 * Math.min(1, u * 4));
    d.cam.buffet = 0.02 + 0.05 * e;
  });
  d.stamp(INHALE + 0.15, 'HHHHNNNNK...', { color: '#ffffff', x: 470, y: 70, size: 16, rot: 0.1, dur: 0.85, burst: '#ff4aa8' });
  // a brief glitch accent at the top of the breath, then a punch in on the face
  d.glitch?.(GLITCH, BELLOW, 0.6);
  d.at(GLITCH, () => {
    sfx.glitch?.(BELLOW - GLITCH);
    d.cam.punch(-6);
  });
  d.follow(GLITCH, BELLOW, (u) => {
    const e = easeOut(u);
    const f = faceCam(b, lerp(8.0, 5.2, e), lerp(1.0, 0.12, e), lerp(-1.2, -0.5, e), lerp(-1.4, -0.5, e));
    return { ...f, fov: 42, roll: lerp(-0.06, 0.1, e) };
  });

  // ================= THE BIGGEST BELLOW (2.95 - 4.15) =================
  d.impactFrame(BELLOW, 'invert', 2);
  d.at(BELLOW, () => {
    ch.setBellow?.(1);
    b.char.setSignature(1);
    d.sfx.voice('gus', 'yell');
    d.sfx.signature('gus');
    d.cam.punch(-10);
    d.cam.shake(0.8);
    d.cam.buffet = 0.22;
    d.flash('#bfe6ff', 0.5, 10);
    d.hype = 1;
  });
  d.stamp(BELLOW + 0.04, 'HWOOOOAAAAR!', { color: '#bfe6ff', x: 330, y: 64, size: 24, rot: -0.12, dur: 0.8, burst: '#2a7cc0' });
  // the chest deflates as the hurricane comes out
  d.span(BELLOW, BELLOW + 1.6, (u) => {
    inflate(1 - easeOut(u));
    b.char.root.position.y = rootY + 0.45 * (1 - easeOut(Math.min(1, u * 3)));
    b.char.head.rotation.x = lerp(-0.3, 0.12, easeOut(Math.min(1, u * 4)));
  });
  // shot 1: straight down his throat, the camera shoved back by the blast
  d.follow(BELLOW, S3, (u) => {
    const e = easeOut(Math.min(1, u * 1.6));
    const f = faceCam(b, lerp(3.4, 7.5, e), lerp(0.05, -0.2, e), lerp(-0.4, -0.7, e), lerp(-0.35, -0.6, e));
    return { ...f, fov: lerp(46, 42, e), roll: lerp(0.18, -0.08, e) + Math.sin(u * 40) * 0.04 * (1 - e) };
  });

  // debris skims the lens: each one lerps from the track in front of him to just past the lens, accelerating
  const lensOff = (side: number, up: number) => {
    const c = camPos();
    const f = camFwd();
    const right = f.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
    return c.clone().addScaledVector(f, -1.2).addScaledVector(right, side).add(new THREE.Vector3(0, up, 0));
  };
  const flyBy = (j: THREE.Object3D, t0: number, dur: number, side: number, up: number, from: () => THREE.Vector3, spinK = 1, lin = false) => {
    const a = new THREE.Vector3();
    const sp = new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)).multiplyScalar(spinK);
    d.span(
      t0,
      t0 + dur,
      (u) => {
        j.visible = u < 1;
        j.position.lerpVectors(a, lensOff(side, up), lin ? u * u * 0.6 + u * 0.4 : easeIn(u * 0.7 + 0.3 * u * u) ** 0.8);
        j.rotation.set(sp.x * u, sp.y * u, sp.z * u);
      },
      () => {
        a.copy(from());
        d.sfx.whoosh();
      },
    );
    d.at(t0 + dur * 0.85, () => {
      d.cam.shake(0.18);
      d.cam.punch(-2);
    });
  };
  const behind = (dx: number, dy: number, dz: number) => () => H0.clone().add(new THREE.Vector3(dx, dy, dz));
  // cold open: the sign and the lawn chair are already flying
  flyBy(junk[1], 0.18, 0.4, -1.6, 1.2, behind(-2.5, 0, 1)); // DRAG STRIP sign
  flyBy(junk[2], 0.42, 0.36, 1.5, -0.6, behind(2, -2.4, 3)); // lawn chair
  // the big bellow: cone, porta-potty, then the cow
  const B = BELLOW;
  flyBy(junk[0], B + 0.12, 0.36, 1.3, 0.9, behind(1.5, -2, 2.5)); // cone
  flyBy(potty, B + 0.25, 0.5, -1.1, -0.3, behind(-2.5, 0.5, -3), 0.4, true); // porta-potty (occupied)
  // the cow: over his head, a slow tumble, staring
  flyBy(cow, B + 0.5, 0.62, -0.5, -0.9, behind(2.4, -0.9, -1.0), 0.12, true);
  d.at(B + 0.65, () => d.sfx.moo());
  d.every(() => {
    if (d.t > B + 0.6 && d.t < B + 1.1) cow.lookAt(camPos());
  });

  // wind out of his mouth: a cone of glow streaks at the lens
  d.every(() => {
    if (!(d.t < S2 || (d.t >= BELLOW && d.t < S3))) return;
    const m = mouth();
    const dir = camPos().clone().sub(m).normalize();
    const m2 = m.clone().addScaledVector(dir, R * 1.6);
    for (let k = 0; k < 4; k++) {
      const v = dir.clone().multiplyScalar(rand(16, 30)).add(new THREE.Vector3(rand(-6, 6), rand(-5, 5), rand(-6, 6)));
      d.fx.glow.spawn(m2, { vel: v, life: 0.5, size: rand(0.02, 0.045), color: k % 3 ? 0xffffff : 0x9fd4ff, stretch: 0.3 });
    }
    if (Math.random() < 0.5) d.fx.dust(m.clone().add(dir.clone().multiplyScalar(1.2)), 1, { vel: dir.clone().multiplyScalar(14), size: 0.25, grow: 0.8, life: 0.45, color: 0xdfe8f4, spread: 0.8, stretch: 0.05 });
  });

  // ---------- shot 2: reverse over his shoulder, the grandstand gets blown out of its seats ----------
  const crowdFly: { i: number; p: THREE.Vector3; v: THREE.Vector3; q: THREE.Quaternion; w: THREE.Vector3; t0: number }[] = [];
  const m4 = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  const headOff = new THREE.Vector3(0, 0.57, 0);
  const tmpV = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const BLOW = S2 + 0.05;
  d.at(BLOW, () => {
    if (!crowdBody || !crowdHead) return;
    d.crowd = null; // we drive the instances now
    for (let i = 0; i < crowdBody.count; i++) {
      crowdBody.getMatrixAt(i, m4);
      const p = new THREE.Vector3().setFromMatrixPosition(m4);
      if (p.z < 0 || p.x < H0.x - 40 || p.x > H0.x + 50) continue;
      // the gust front sweeps outward from straight in front of him; front rows go first
      const dist = Math.abs(p.x - H0.x) * 0.006 + (p.z - 17) * 0.01;
      crowdFly.push({
        i,
        p,
        v: new THREE.Vector3(rand(-4, 4) + (p.x - H0.x) * 0.1, rand(11, 17), rand(4, 9)),
        q: new THREE.Quaternion(),
        w: new THREE.Vector3(rand(-10, 10), rand(-6, 6), rand(-10, 10)),
        t0: d.wt + dist + rand(0, 0.06),
      });
    }
    sfx.crowdScream?.(1.2);
  });
  d.every((_dt, wdt) => {
    if (!crowdFly.length || !crowdBody || !crowdHead) return;
    for (const c of crowdFly) {
      if (d.wt >= c.t0) {
        c.v.y -= 4 * wdt;
        c.p.addScaledVector(c.v, wdt);
        tmpQ.setFromEuler(new THREE.Euler(c.w.x * wdt, c.w.y * wdt, c.w.z * wdt));
        c.q.multiply(tmpQ);
      } else {
        // the moment before: a little jitter
        c.p.y += Math.sin(d.wt * 60 + c.i) * 0.003;
      }
      crowdBody.setMatrixAt(c.i, m4.compose(c.p, c.q, one));
      tmpV.copy(headOff).applyQuaternion(c.q).add(c.p);
      crowdHead.setMatrixAt(c.i, m4.compose(tmpV, c.q, one));
    }
    crowdBody.instanceMatrix.needsUpdate = crowdHead.instanceMatrix.needsUpdate = true;
  });
  d.follow(S2, INHALE, (u) => {
    const pos = new THREE.Vector3(H0.x + lerp(1.5, 0.5, u), lerp(2.0, 2.4, u), 1.5);
    void S3;
    const look = new THREE.Vector3(H0.x + lerp(4, 3, u), lerp(3.6, 6.2, easeInOut(u)), 21);
    return { pos, look, fov: lerp(46, 50, u), roll: lerp(0.1, 0.03, u) };
  });
  d.at(S2, () => {
    d.cam.buffet = 0.18;
    d.cam.shake(0.3);
  });
  d.stamp(S2 + 0.25, 'AAAAAAH!', { color: '#ffd36a', x: 430, y: 90, size: 16, rot: 0.12, dur: 0.6, burst: '#e8413c' });
  // big wind streaks blowing away from the camera, toward the stands
  d.every(() => {
    if (d.t < S2 || d.t > INHALE) return;
    const c = camPos();
    for (let k = 0; k < 5; k++)
      d.fx.glow.spawn(c.clone().add(new THREE.Vector3(rand(-4, 4), rand(-1.5, 2.5), rand(1.5, 4))), {
        vel: { x: rand(-2, 2), y: rand(0, 2), z: rand(30, 45) },
        life: 0.8,
        size: rand(0.03, 0.06),
        color: k % 2 ? 0xdfe8f4 : 0x9fd4ff,
        stretch: 0.35,
      });
  });

  // ---------- shot 3: low behind the player's car; slow-mo; the spoiler tears off and SMACKS the lens ----------
  const SM0 = S3 + 0.15;
  const RIP = S3 + 0.32;
  const SMACK = 4.95;
  const SMACK_END = 5.35;
  d.slowmo(SM0, SMACK + 0.05, 0.15, 0.15);
  const spoW = new THREE.Vector3();
  const s3cam = () => {
    pc.root.updateWorldMatrix(true, true);
    const base = pc.root.position;
    const pos = new THREE.Vector3(base.x + 1.2, 1.7, PLAYER_LANE + 1.4);
    const look = H0.clone().add(new THREE.Vector3(0.6, -0.9, 0));
    return { pos, look };
  };
  d.follow(S3, SMACK, (u) => {
    const s = s3cam();
    s.pos.x += lerp(0, 0.4, u);
    s.pos.y += lerp(0, 0.15, u);
    return { ...s, fov: lerp(46, 40, u), roll: -0.05 };
  });
  d.at(S3, () => {
    d.cam.buffet = 0.12;
    // the bellow continues in the background
    ch.setBellow?.(1);
  });
  // the wing rattles, then rips
  d.span(S3, RIP, (u) => {
    if (!spoiler) return;
    spoiler.rotation.x = Math.sin(d.wt * 70) * 0.06 * u;
    spoiler.rotation.z = Math.sin(d.wt * 53) * 0.05 * u;
    pc.setLean(Math.sin(d.wt * 40) * 0.02, -0.03 * u);
  });
  const spoFrom = new THREE.Vector3();
  const spoQ0 = new THREE.Quaternion();
  d.at(RIP, () => {
    if (!spoiler) return;
    spoiler.updateWorldMatrix(true, true);
    d.scene.attach(spoiler);
    spoFrom.copy(spoiler.position);
    spoQ0.copy(spoiler.quaternion);
    d.fx.sparks(spoFrom, 10, { color: 0xffd36a });
    d.sfx.whoosh();
  });
  d.stamp(RIP + 0.05, 'SKRANNK!', { color: '#ffffff', x: 210, y: 250, size: 16, rot: -0.15, dur: 0.6, burst: '#e8413c' });
  // tumble toward the lens (slow-mo makes it hang in the air), ending broadside, flat on the glass
  const qEnd = new THREE.Quaternion();
  d.span(RIP, SMACK, (u) => {
    if (!spoiler) return;
    const cam = d.stage.camera;
    // final rest: 0.45 m in front of the lens, the wing's long axis across the screen
    const end = camPos().clone().addScaledVector(camFwd(), 1.25).add(new THREE.Vector3(0, -0.05, 0));
    const mid = spoFrom.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 1.2, 0));
    const e = easeIn(u * 0.55 + 0.45 * u * u);
    // quadratic bezier: rises, then dives at the lens
    spoW.copy(spoFrom).multiplyScalar((1 - e) * (1 - e)).addScaledVector(mid, 2 * (1 - e) * e).addScaledVector(end, e * e);
    spoiler.position.copy(spoW);
    qEnd.copy(cam.quaternion).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.2, Math.PI / 2, 0)));
    const tumble = new THREE.Quaternion().setFromEuler(new THREE.Euler((1 - u) * 9, (1 - u) * 4, (1 - u) * 6));
    spoiler.quaternion.copy(spoQ0).multiply(tumble).slerp(qEnd, easeIn(u));
    spoiler.scale.setScalar(1);
  });
  // SMACK
  d.impactFrame(SMACK, '#ffffff', 2);
  d.at(SMACK, () => {
    d.cam.shake(1.1);
    d.cam.punch(6);
    sfx.slap?.();
    d.sfx.impact();
  });
  d.stamp(SMACK + 0.02, 'THWACK!', { color: '#f7d23e', x: 320, y: 110, size: 24, rot: 0.1, dur: 0.6, burst: '#07060d' });
  // it sticks a beat, then slides down off the glass
  d.span(SMACK, SMACK_END, (u) => {
    if (!spoiler) return;
    const cam = d.stage.camera;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const end = camPos().clone().addScaledVector(camFwd(), 1.25).add(new THREE.Vector3(0, -0.05, 0));
    spoiler.position.copy(end).addScaledVector(up, -easeIn(Math.max(0, u - 0.3) / 0.7) * 0.9);
  });
  d.follow(SMACK, SMACK_END, () => ({ ...s3cam(), fov: 40, roll: -0.05 }));
  // a spider-web crack on the lens where it hit
  const crackPts: number[] = [];
  const cx = 0.012;
  const cy = 0.008;
  for (let i = 0; i < 9; i++) {
    let a = (i / 9) * Math.PI * 2 + rand(-0.2, 0.2);
    let x = cx;
    let y = cy;
    const n = 4 + Math.floor(rand(0, 3));
    for (let k = 0; k < n; k++) {
      const len = rand(0.012, 0.03);
      a += rand(-0.4, 0.4);
      const nx = x + Math.cos(a) * len;
      const ny = y + Math.sin(a) * len;
      crackPts.push(x, y, 0, nx, ny, 0);
      x = nx;
      y = ny;
    }
  }
  for (const r of [0.018, 0.04]) {
    for (let i = 0; i < 9; i++) {
      const a0 = (i / 9) * Math.PI * 2;
      const a1 = a0 + rand(0.4, 0.7);
      crackPts.push(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, 0, cx + Math.cos(a1) * r * 1.1, cy + Math.sin(a1) * r * 1.1, 0);
    }
  }
  const crackGeo = new THREE.BufferGeometry();
  crackGeo.setAttribute('position', new THREE.Float32BufferAttribute(crackPts, 3));
  const crack = new THREE.LineSegments(crackGeo, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9, fog: false }));
  crack.renderOrder = 999;
  crack.frustumCulled = false;
  crack.visible = false;
  d.scene.add(crack);
  d.at(SMACK, () => (crack.visible = true));
  d.every(() => {
    if (!crack.visible) return;
    const cam = d.stage.camera;
    crack.position.copy(cam.position).addScaledVector(camFwd(), 0.2);
    crack.quaternion.copy(cam.quaternion);
    if (d.t > SMACK_END + 0.45) crack.visible = false;
  });
  d.at(SMACK_END, () => spoiler && (spoiler.visible = false));

  // ================= THE LAUGH (7.4 - card) =================
  const LAUGH = SMACK_END;
  const CARD = 6.45;
  d.at(LAUGH, () => {
    ch.setBellow?.(0);
    b.char.setSignature(0.35);
    b.char.setExpression('grin');
    d.sfx.voice('gus', 'laugh');
    d.cam.buffet = 0.06;
    (ch as { setLaugh?: (k: number) => void }).setLaugh?.(1);
  });
  talk(d, b, LAUGH, CARD - LAUGH + 0.9, 17);
  // head thrown back, belly heaving
  d.span(LAUGH, CARD + 3, (u) => {
    const k = Math.min(1, u * 8);
    const w = d.wt;
    b.char.head.rotation.x = -0.32 * k + Math.sin(w * 16) * 0.06 * k;
    b.char.head.rotation.z = Math.sin(w * 5) * 0.08 * k;
    const t = b.char as { torso?: THREE.Object3D };
    if (t.torso) {
      const s = 1 + Math.abs(Math.sin(w * 16)) * 0.05 * k;
      t.torso.scale.set(s, 1 + (s - 1) * 0.5, s);
      t.torso.rotation.x = -0.12 * k;
    }
  });
  d.stamp(LAUGH + 0.1, 'HAW HAW HAW!', { color: '#ffffff', x: 230, y: 80, size: 16, rot: 0.08, dur: 1.0, burst: '#2a7cc0' });
  // final framing: he sits in the right third with his head in the upper half (left card)
  const cardCam = (u: number) => {
    const f = faceCam(b, lerp(9.5, 12.5, easeOut(u)), lerp(-0.25, -0.38, u), lerp(-0.6, -0.9, u), -1.3);
    // aim left of him so he lands in the right third
    const toCam = f.pos.clone().sub(H0).setY(0).normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(toCam).normalize(); // screen-left direction
    f.look.addScaledVector(right, -2.6);
    return { ...f, fov: 42, roll: lerp(0.06, -0.04, u) };
  };
  d.follow(LAUGH, CARD + 3, (u) => cardCam(Math.min(1, u * 1.6)));
  // the cone party hat: drops out of the sky onto his head
  const HAT0 = LAUGH + 0.25;
  const HAT1 = HAT0 + 0.3;
  d.span(HAT0, HAT1, (u) => {
    headPos(b, H);
    cone.visible = true;
    cone.scale.setScalar(R * 1.7);
    cone.position.copy(H).setY(lerp(H.y + 8, H.y + 1.5 * R, easeIn(u)));
    cone.rotation.set(0, 0, (1 - u) * 6);
  });
  d.at(HAT1, () => {
    headPos(b, H);
    cone.position.copy(H).setY(H.y + 1.5 * R);
    cone.rotation.set(0, 0, 0.25);
    b.char.head.attach(cone);
    d.cam.shake(0.25);
    d.sparkle(cone.getWorldPosition(new THREE.Vector3()), 16, '#ffd36a');
  });

  // ---------- card ----------
  d.at(CARD, () => (d.cam.buffet = 0.03));
  d.freeze(CARD, 0.25, 0.6);
  d.at(CARD + 0.7, () => d.sfx.voice('gus', 'taunt'));
  d.nameCard(CARD, { ...card, color: '#2a7cc0', accent: '#ffffff' }, 1.1, 'gus');

  // jerk-half ambience: blown grit across the frame
  const grit = rate(30);
  d.every((_dt, wdt) => {
    if ((d.t > S2 && d.t < INHALE) || (d.t > S3 && d.t < LAUGH)) return;
    const n = grit(wdt, d.t > LAUGH ? 0.4 : 1);
    headPos(b, H);
    for (let i = 0; i < n; i++)
      d.fx.glow.spawn(H.clone().add(new THREE.Vector3(rand(-6, 6), rand(-3, 3), rand(-1, 3))), {
        vel: { x: rand(-3, 3), y: rand(-1, 1), z: rand(18, 28) },
        life: 0.5,
        size: rand(0.02, 0.04),
        color: 0xdfe8f4,
        stretch: 0.3,
      });
  });
}
