// Shared toon character base (v3): stubby body, huge round head with a hinged jaw, glossy lidded cartoon
// eyes (upper + lower lids, two highlights, a sparkle), arched brows, chubby cheeks with blush, projected
// mouth decals, three-finger cartoon hands with poses, blinks and breathing. Each boss file dresses it and
// adds a signature and its own jerk flavour.
//
// Layout (metres): root origin at the feet, hips at hipHeight, head pivot on top of the neck. Exposed
// head/jaw/eyes/arms are outer pivots left alone by the rig; it animates *Inner children.
//
// Heel turn: setTurn(k) (0 sweet .. 1 jerk) replaces the expression's eyes/brows/mouth/head pose with a
// blend of the boss's SWEET and JERK faces (spec.sweet / spec.jerk over the defaults below) and blends the
// posture (upright and soft -> lean-in slouch, chin up). It is applied instantly (no smoothing), so the
// glitch can flicker it 0 <-> 1 every frame. Expressions still drive the jaw (yell/crazy open the mouth),
// setTalk still flaps it. Until setTurn is first called the rig behaves exactly as before.
//
// Hands: setHandPose(side, 'open' | 'fist' | 'grip' | 'point' | 'wave') with side 'L' | 'R' (also 1 / -1,
// 'left' / 'right'). Poses blend in ~0.08 s. props.gripL / props.gripR are where a held prop's origin goes:
// prop +X runs out of the fist along the forearm (a gun barrel, toward the knuckles), prop +Y out of the
// thumb side (a lollipop / pinwheel stick), so with the arm reaching forward a prop's +X points forward and
// its +Y up. Call setHandPose(side, 'grip') when you parent something there.
import * as THREE from 'three';
import type { CharacterRig, Expression } from '../types';
import { TessellateModifier } from 'three/examples/jsm/modifiers/TessellateModifier.js';
import { Chain } from './chain';
import { Kit, clamp, damp, outlineTree } from './kit';
import { starShape } from './parts';

export type HandPose = 'open' | 'fist' | 'grip' | 'point' | 'wave' | 'gun' | 'flat';
export type HandSide = 'L' | 'R' | 'left' | 'right' | 1 | -1;

export interface CharacterRigX extends CharacterRig {
  props: Record<string, THREE.Object3D>;
  torso: THREE.Object3D;
  legs: THREE.Object3D;
  hipHeight: number;
  height: number;
  /** Jaw flapping for dialogue, 0..1. */
  setTalk(amount: number): void;
  /** Pupil aim, -1..1 each (x = character's left, y = up). */
  setLook(x: number, y: number): void;
  /**
   * Real-time clock for the beat controls (setShades, flickPick, setEyeGlow, setBellow, ...): pass the
   * frame's REAL dt before update() and the controls' smoothing/timing uses it instead of the world dt, so
   * beats stay snappy under slow-mo and keep moving through freezes. Consumed by the next update().
   * Scene usage: d.every((dt) => (rig as any).setBeatDt?.(dt)).
   */
  setBeatDt(dt: number): void;
  /** 0 = sweet, 1 = jerk. Instant (no smoothing). See the header. */
  setTurn(k: number): void;
  /** Finger pose for one hand. 'gun' (index out, thumb up) and 'flat' (fingers together) are extras. */
  setHandPose(side: HandSide, pose: HandPose): void;
}

export interface Spec {
  skin: number;
  shirt: number;
  sleeve?: number;
  pants: number;
  shoes: number;
  hands?: number;
  brow: number;
  iris: number;
  lid?: number;
  chestW?: number; // multiplier
  chestD?: number;
  belly?: number;
  nose?: 'bulb' | 'button' | 'sharp';
  jawW?: number;
  headScale?: number;
  browScale?: number;
  /** Blush colour (sweet cheeks). */
  blush?: number;
  /** Overrides of the default SWEET / JERK faces for setTurn. */
  sweet?: Partial<Face>;
  jerk?: Partial<Face>;
}

/** Face pose: everything an expression drives. L = character's left (+X). */
export interface Face {
  jaw: number;
  jawRoll: number;
  browY: [number, number];
  browRot: [number, number]; // + = outer end up (angry/sly)
  lid: [number, number]; // 0 open .. 1 closed
  lidTilt: [number, number]; // + = outer corner down
  /** Lower lid rise, 0 = open .. ~0.5 = squint / happy cheek push. */
  lidLo: [number, number];
  eye: [number, number]; // eye scale
  pupil: number;
  headX: number; // + = chin down
  headZ: number;
  mouth: Mouth;
  /** Cheek blush 0..1. */
  blush: number;
  /** Eye sparkle (star highlight) 0..1. */
  sparkle: number;
}
export type Mouth = 'line' | 'smirk' | 'smirkR' | 'grin' | 'none' | 'smile' | 'sneer' | 'sneerR' | 'teeth';

export const F = (f: Partial<Face>): Face => ({
  jaw: 0, jawRoll: 0, browY: [0, 0], browRot: [0, 0], lid: [0.1, 0.1], lidTilt: [0, 0], lidLo: [0, 0], eye: [1, 1], pupil: 1,
  headX: 0, headZ: 0, mouth: 'line', blush: 0, sparkle: 0, ...f,
});

export const EXPRESSIONS: Record<Expression, Face> = {
  smirk: F({ jawRoll: 0.06, browY: [0.035, -0.015], browRot: [-0.1, 0.35], lid: [0.38, 0.5], lidTilt: [0, 0.15], lidLo: [0.1, 0.15], headX: 0.06, headZ: 0.08, mouth: 'smirk' }),
  crazy: F({ jaw: 0.32, jawRoll: -0.08, browY: [0.07, 0.04], browRot: [-0.35, 0.1], lid: [0, 0.05], eye: [1.28, 1.08], pupil: 0.5, headZ: -0.16, mouth: 'none' }),
  yell: F({ jaw: 0.62, browY: [-0.03, -0.03], browRot: [0.55, 0.55], lid: [0.22, 0.22], lidTilt: [-0.35, -0.35], eye: [1, 1], pupil: 0.75, headX: -0.18, mouth: 'none' }),
  wink: F({ jawRoll: -0.05, browY: [0.04, -0.03], browRot: [-0.2, 0.3], lid: [0.05, 1], lidLo: [0.1, 0.3], headZ: -0.12, mouth: 'smirk' }),
  grin: F({ browY: [0.045, 0.045], browRot: [-0.2, -0.2], lid: [0.32, 0.32], lidTilt: [0.2, 0.2], lidLo: [0.2, 0.2], headX: -0.04, mouth: 'grin' }),
};

/** Default heel-turn faces (bosses override parts through spec.sweet / spec.jerk). */
export const SWEET: Face = F({
  browY: [0.055, 0.055], browRot: [-0.42, -0.42], lid: [0.04, 0.04], lidTilt: [0.1, 0.1], lidLo: [0.12, 0.12], eye: [1.14, 1.14],
  pupil: 1.38, headX: 0.04, headZ: 0.08, mouth: 'smile', blush: 1, sparkle: 1,
});
export const JERK: Face = F({
  jawRoll: 0.05, browY: [-0.035, -0.005], browRot: [0.55, 0.3], lid: [0.46, 0.4], lidTilt: [-0.22, -0.1], lidLo: [0.3, 0.26],
  eye: [0.98, 1.02], pupil: 0.86, headX: -0.12, headZ: -0.07, mouth: 'sneer', blush: 0, sparkle: 0,
});

export interface Base {
  kit: Kit;
  spec: Spec;
  root: THREE.Group;
  hips: THREE.Group;
  legs: THREE.Group;
  torso: THREE.Group;
  torsoInner: THREE.Group;
  chest: THREE.Mesh;
  /** The belly ball (only when spec.belly is set). */
  belly?: THREE.Mesh;
  head: THREE.Group;
  headInner: THREE.Group;
  cranium: THREE.Mesh;
  jaw: THREE.Group;
  jawInner: THREE.Group;
  eyes: THREE.Group[];
  irises: THREE.Mesh[];
  armL: THREE.Group;
  armR: THREE.Group;
  armInnerL: THREE.Group;
  armInnerR: THREE.Group;
  elbowL: THREE.Group;
  elbowR: THREE.Group;
  handL: THREE.Group;
  handR: THREE.Group;
  /** Head-space surfaces, for placing things on the face. */
  R: number;
  hipHeight: number;
  chains: Chain[];
  ears: THREE.Mesh[];
  /** Cheek balls [L, R] (head space), carrying the blush. */
  cheeks: THREE.Mesh[];
  nose: THREE.Mesh;
  /** The skin material (per rig: tint it for a red face). */
  skinMat: THREE.MeshToonMaterial;
  props: Record<string, THREE.Object3D>;
  /** Upper arm / forearm meshes [L, R], for cartoon stretch in reach(). */
  armSegs: { up: THREE.Mesh; fore: THREE.Mesh }[];
  /** Projects a 2D mouth-space outline onto the chin as a decal (x across, y up; 0,0 = mouth centre). */
  chinDecal(pts: [number, number][], mat: THREE.Material, lift?: number, dy?: number): THREE.Mesh;
}

export interface Ctx {
  t: number;
  dt: number;
  sig: number;
  expr: Expression | null;
  face: Face; // mutable: final pose before it is applied
  b: Base;
  /** Added to the pupil aim this frame (reset every update). */
  lookAdd: THREE.Vector2;
  /** Beat-control dt: the real dt from setBeatDt() this frame, else the world dt. */
  bdt: number;
  /** Heel turn 0..1 (0 when setTurn was never called; see turnOn). */
  turn: number;
  turnOn: boolean;
  /** Hand pose targets [L, R] for this frame: start as setHandPose's, hooks may override. */
  hand: [HandPose, HandPose];
}

const HEAD_R = 0.42;

/** A capsule hanging from its top (origin at the top cap's centre, extends along -Y). */
function capsule(kit: Kit, r: number, len: number, mat: THREE.Material, outline = 0.011) {
  const g = new THREE.CapsuleGeometry(r, len, 5, 12);
  g.translate(0, -len / 2, 0);
  return kit.mesh(g, mat, outline);
}

/** Bent, tapered brow: an ellipsoid arched upward in the middle and thinner at the outer end. */
export function browGeo(w: number, h: number, d: number, arch: number, s: number) {
  const g = new THREE.SphereGeometry(1, 20, 10);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const u = x; // -1..1; +1 = outer end for s=1
    const taper = 1 - 0.35 * clamp(u * s, 0, 1);
    p.setXYZ(i, x * w, y * h * taper + arch * (1 - u * u), z * d);
  }
  g.computeVertexNormals();
  return g;
}

interface Finger {
  k1: THREE.Group;
  k2: THREE.Group;
  spreadDir: number;
}
interface HandRig {
  s: number;
  inner: THREE.Group;
  fingers: Finger[];
  thumb: THREE.Group;
  thumb2: THREE.Group;
  grip: THREE.Object3D;
  cur: PoseVals;
}
interface PoseVals {
  curl: [number, number, number];
  spread: number;
  thumb: THREE.Vector3; // direction (x is flipped per side)
  tc: number; // thumb tip curl
  wave: number;
}
const P = (curl: [number, number, number], spread: number, th: [number, number, number], tc: number, wave = 0): PoseVals => ({
  curl, spread, thumb: new THREE.Vector3(...th).normalize(), tc, wave,
});
const POSES: Record<HandPose, PoseVals> = {
  open: P([0.14, 0.18, 0.24], 0.07, [-0.35, -0.75, 0.55], 0.15),
  flat: P([0.04, 0.04, 0.05], 0.0, [-0.3, -0.85, 0.4], 0.05),
  fist: P([1, 1, 1], 0, [-0.55, -0.55, -0.6], 0.7),
  grip: P([0.86, 0.9, 0.94], 0, [-0.6, -0.55, -0.35], 0.45),
  point: P([0, 1, 1], 0, [-0.55, -0.55, -0.55], 0.7),
  gun: P([0, 1, 1], 0, [-0.12, 0.35, 0.93], 0),
  wave: P([0, 0.02, 0.05], 0.24, [-0.25, -0.4, 0.88], 0, 1),
};

/** Builds the body and face. Dress it, then call finish(). */
export function buildBase(spec: Spec): Base {
  const kit = new Kit();
  const hs = spec.headScale ?? 1;
  const cw = spec.chestW ?? 1, cd = spec.chestD ?? 1;
  const hipHeight = 0.66;
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = hipHeight;
  root.add(hips);
  const skin = kit.toonUnique(spec.skin);

  // Legs: stubby columns with big rounded shoes (toe cap + sole).
  const legs = new THREE.Group();
  hips.add(legs);
  for (const s of [-1, 1]) {
    const leg = kit.cyl(0.12, 0.11, 0.56, spec.pants, 12);
    leg.position.set(s * 0.16, -0.3, 0);
    legs.add(leg);
    const cuffL = kit.cyl(0.13, 0.135, 0.06, spec.pants, 12, 0.012);
    cuffL.position.set(s * 0.16, -0.55, 0);
    legs.add(cuffL);
    const shoe = kit.ball(0.13, spec.shoes, 1.05, 0.7, 1.55, 16);
    shoe.position.set(s * 0.17, -hipHeight + 0.08, 0.07);
    legs.add(shoe);
    const sole = kit.cyl(0.13, 0.13, 0.03, 0x2a2224, 14, 0.01);
    sole.scale.set(1.05, 1, 1.55);
    sole.position.set(s * 0.17, -hipHeight + 0.02, 0.07);
    legs.add(sole);
  }

  const torso = new THREE.Group();
  hips.add(torso);
  const torsoInner = new THREE.Group();
  torso.add(torsoInner);
  const pelvis = kit.ball(0.27, spec.pants, 1.15 * cw, 0.62, 0.95 * cd);
  pelvis.position.y = 0.04;
  torsoInner.add(pelvis);
  const chest = kit.ball(0.34, spec.shirt, 1.0 * cw, 1.0, 0.82 * cd, 22);
  chest.position.y = 0.38;
  torsoInner.add(chest);
  let bellyM: THREE.Mesh | undefined;
  if (spec.belly) {
    const belly = bellyM = kit.ball(0.27 * spec.belly, spec.shirt, 1.1, 0.95, 1);
    belly.position.set(0, 0.22, 0.12 * cd);
    torsoInner.add(belly);
  }

  // Arms: shoulder pivot -> upper arm -> elbow -> forearm -> three-finger cartoon hand.
  const sleeve = spec.sleeve ?? spec.shirt;
  const handC = spec.hands !== undefined ? kit.toon(spec.hands) : skin;
  const hands: HandRig[] = [];
  const mkArm = (s: number) => {
    const arm = new THREE.Group();
    arm.position.set(s * (0.33 * cw + 0.02), 0.55, 0);
    torsoInner.add(arm);
    const inner = new THREE.Group();
    inner.rotation.z = s * 0.18;
    arm.add(inner);
    const sh = kit.ball(0.13, sleeve);
    inner.add(sh);
    const up = kit.cyl(0.1, 0.09, 0.3, sleeve, 10);
    up.position.y = -0.16;
    inner.add(up);
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    elbow.rotation.x = -0.25;
    inner.add(elbow);
    const elbowBall = kit.ball(0.092, sleeve, 1, 1, 1, 12, 0);
    elbow.add(elbowBall);
    const fore = kit.cyl(0.09, 0.08, 0.26, sleeve, 10);
    fore.position.y = -0.12;
    elbow.add(fore);
    const sleeveCuff = kit.cyl(0.094, 0.098, 0.05, sleeve, 10, 0.012);
    sleeveCuff.position.y = -0.235;
    elbow.add(sleeveCuff);
    const hand = new THREE.Group();
    hand.position.y = -0.3;
    elbow.add(hand);
    const hi = new THREE.Group();
    hand.add(hi);
    // Palm: thin across (X), wide front-to-back (Z); the thumb sits on the front (+Z) edge.
    const palm = kit.ball(0.105, handC, 0.62, 0.95, 1.0, 20);
    palm.position.y = -0.02;
    hi.add(palm);
    const wrist = kit.cyl(0.07, 0.075, 0.08, handC, 12, 0.012);
    wrist.position.y = 0.07;
    hi.add(wrist);
    const fingers: Finger[] = [];
    ([[0.062, 1.0], [0, 1.06], [-0.062, 0.9]] as const).forEach(([z, L], fi) => {
      const k1 = new THREE.Group();
      k1.position.set(0, -0.1, z);
      hi.add(k1);
      k1.add(capsule(kit, 0.033, 0.05 * L, handC));
      const k2 = new THREE.Group();
      k2.position.y = -0.062 * L;
      k1.add(k2);
      k2.add(capsule(kit, 0.031, 0.04 * L, handC));
      fingers.push({ k1, k2, spreadDir: fi === 0 ? 1 : fi === 2 ? -1 : 0 });
    });
    const thumb = new THREE.Group();
    thumb.position.set(-s * 0.03, -0.02, 0.07);
    hi.add(thumb);
    thumb.add(capsule(kit, 0.036, 0.05, handC));
    const thumb2 = new THREE.Group();
    thumb2.position.y = -0.065;
    thumb.add(thumb2);
    thumb2.add(capsule(kit, 0.032, 0.035, handC));
    // Grip: prop +X along the forearm out of the fist, +Y out of the thumb side, +Z = X x Y.
    const grip = new THREE.Object3D();
    grip.position.set(-s * 0.045, -0.15, 0.0);
    grip.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0)));
    hi.add(grip);
    const cur: PoseVals = { curl: [...POSES.open.curl], spread: POSES.open.spread, thumb: POSES.open.thumb.clone(), tc: POSES.open.tc, wave: 0 };
    hands.push({ s, inner: hi, fingers, thumb, thumb2, grip, cur });
    return { arm, inner, elbow, hand, up, fore };
  };
  const L = mkArm(1), Rr = mkArm(-1);

  // Neck + head.
  const neck = kit.cyl(0.11, 0.13, 0.16, skin, 10);
  neck.position.y = 0.7;
  torsoInner.add(neck);
  const head = new THREE.Group();
  head.position.y = 0.74;
  torsoInner.add(head);
  const headInner = new THREE.Group();
  headInner.scale.setScalar(hs);
  head.add(headInner);

  const R = HEAD_R;
  const cranium = kit.ball(R, skin, 1.06, 0.98, 0.95, 22);
  cranium.position.y = 0.5;
  headInner.add(cranium);
  // Chubby cheeks (no outline of their own, so they read as soft bulges) with a blush on each.
  const cheeks: THREE.Mesh[] = [];
  const blushMat = kit.own(new THREE.MeshBasicMaterial({ color: spec.blush ?? 0xff6f86, transparent: true, opacity: 0, depthWrite: false }));
  for (const s of [1, -1]) {
    const ch = kit.ball(0.12, skin, 1.1, 0.85, 0.75, 18, 0);
    ch.position.set(s * 0.215, 0.415, 0.235);
    headInner.add(ch);
    cheeks.push(ch);
    const bl = new THREE.Mesh(kit.geo(new THREE.CircleGeometry(0.085, 24)), blushMat);
    bl.scale.set(1.3, 0.75, 1);
    bl.position.set(s * 0.02, 0.005, 0.1);
    bl.rotation.y = s * 0.22;
    bl.renderOrder = 2;
    ch.add(bl);
  }
  const ears: THREE.Mesh[] = [];
  const earIn = kit.toon(new THREE.Color(spec.skin).multiplyScalar(0.82).getHex());
  for (const s of [-1, 1]) {
    const ear = kit.ball(0.095, skin, 0.5, 1, 0.85, 18);
    ear.position.set(s * 0.44, 0.47, -0.02);
    ear.rotation.z = -s * 0.12;
    headInner.add(ear);
    const inn = kit.ball(0.06, earIn, 0.3, 0.8, 0.65, 14, 0);
    inn.position.set(s * 0.03, -0.005, 0.01);
    ear.add(inn);
    ears.push(ear);
  }

  // Jaw: hinged chin. Cavity, teeth and tongue hide inside until it drops.
  const jaw = new THREE.Group();
  jaw.position.set(0, 0.34, -0.04);
  headInner.add(jaw);
  const jawInner = new THREE.Group();
  jaw.add(jawInner);
  const jw = spec.jawW ?? 1;
  const JC = new THREE.Vector3(0, -0.1, 0.12), JS = new THREE.Vector3(0.36 * jw, 0.186, 0.336);
  const chin = kit.ball(1, skin, JS.x, JS.y, JS.z, 22);
  chin.position.copy(JC);
  jawInner.add(chin);
  const cavity = kit.ball(0.22, 0x4a0d1c, 1.15, 0.75, 0.8, 12, 0);
  cavity.position.set(0, 0.27, 0.15);
  headInner.add(cavity);
  const teeth = kit.toon(0xfffbef);
  const upT = kit.ball(0.15 * jw, teeth, 1, 0.26, 0.3, 16, 0.012);
  upT.position.set(0, 0.255, 0.3);
  headInner.add(upT);
  const loT = kit.ball(0.13 * jw, teeth, 1, 0.22, 0.3, 16, 0.012);
  loT.position.set(0, -0.005, 0.29);
  jawInner.add(loT);
  const tongue = kit.ball(0.12, 0xd84a5a, 1.15, 0.4, 1, 10, 0);
  tongue.position.set(0, -0.04, 0.18);
  jawInner.add(tongue);

  // Mouth decals projected onto the chin's front surface.
  const mouths = new Map<Mouth, THREE.Object3D>();
  const onChin = (g: THREE.BufferGeometry, lift: number, dy = -0.06) => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i) + dy;
      const u = (x - JC.x) / JS.x, v = (y - JC.y) / JS.y;
      p.setXYZ(i, x, y, JC.z + JS.z * Math.sqrt(Math.max(0.02, 1 - u * u - v * v)) + lift);
    }
    g.computeVertexNormals();
    return g;
  };
  const dark = kit.toon(0x2a0a12);
  // Tessellated first so big shapes hug the curved chin instead of cutting chords through it.
  const tess = new TessellateModifier(0.012, 8);
  const decal = (pts: [number, number][], mat: THREE.Material, lift = 0.004, dy = -0.06) => {
    const g0 = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), 4);
    const g = tess.modify(g0);
    g0.dispose();
    g.userData.lowPoly = true;
    return new THREE.Mesh(kit.geo(onChin(g, lift, dy)), mat);
  };
  const curve = (f: (u: number) => [number, number], th: (u: number) => number, n = 16): [number, number][] => {
    const top: [number, number][] = [], bot: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, [x, y] = f(u), w = th(u);
      top.push([x, y + w]);
      bot.unshift([x, y - w]);
    }
    return [...top, ...bot];
  };
  const mw = 0.15 * jw;
  const pink = kit.toon(0xe0566a);
  {
    const g = new THREE.Group();
    g.add(decal(curve((u) => [(u * 2 - 1) * mw * 0.8, -0.018 * Math.sin(u * Math.PI)], (u) => 0.006 + 0.009 * Math.sin(u * Math.PI)), dark));
    mouths.set('line', g);
  }
  for (const [name, s] of [['smirk', 1], ['smirkR', -1]] as const) {
    const g = new THREE.Group();
    g.add(decal(curve((u) => [s * (u * 2 - 1) * mw * 0.85, 0.05 * u * u - 0.01 * Math.sin(u * Math.PI)], (u) => 0.005 + 0.012 * Math.sin(u * Math.PI * 0.85)), dark));
    const dimple = decal(curve((u) => [s * (mw * 0.92 + u * 0.03), 0.05 + u * 0.03], (u) => 0.008 * (1 - u * 0.6), 6), dark);
    g.add(dimple);
    mouths.set(name, g);
  }
  {
    // Happy closed smile: a soft upturned U with little corner ticks.
    const g = new THREE.Group();
    g.add(decal(curve((u) => [(u * 2 - 1) * mw * 0.95, -0.045 * Math.sin(u * Math.PI) + 0.028 * (u * 2 - 1) ** 4], (u) => 0.004 + 0.012 * Math.sin(u * Math.PI)), dark));
    for (const s of [-1, 1]) g.add(decal(curve((u) => [s * (mw * 0.93 + u * 0.035), 0.03 - u * 0.012], (u) => 0.007 * (1 - 0.7 * u), 5), dark));
    mouths.set('smile', g);
  }
  {
    const g = new THREE.Group();
    const D: [number, number][] = [];
    for (let i = 0; i <= 20; i++) {
      const a = Math.PI + (i / 20) * Math.PI;
      D.push([Math.cos(a) * mw * 1.25, 0.03 + Math.sin(a) * 0.1 - 0.015 * Math.cos(a) ** 2]);
    }
    D.push([mw * 1.35, 0.06], [-mw * 1.35, 0.06]);
    g.add(decal(D, dark, 0.004, -0.11));
    const T: [number, number][] = [[-mw * 1.08, 0.035], [mw * 1.08, 0.035], [mw * 0.95, -0.02], [-mw * 0.95, -0.02]];
    g.add(decal(T, teeth, 0.008, -0.11));
    const tg = decal(curve((u) => [(u * 2 - 1) * mw * 0.55, -0.045], () => 0.02, 6), pink, 0.008, -0.11);
    g.add(tg);
    mouths.set('grin', g);
  }
  // Crooked sneer: one corner hiked up, an open lopsided gap with the upper teeth bared on that side.
  for (const [name, s] of [['sneer', 1], ['sneerR', -1]] as const) {
    const g = new THREE.Group();
    const n = 18, top: [number, number][] = [], bot: [number, number][] = [], tt: [number, number][] = [], tb: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, x = s * (u * 2 - 1) * mw * 1.05;
      const yT = -0.012 + 0.07 * u ** 1.6;
      const open = (0.006 + 0.055 * Math.sin(Math.PI * u ** 0.8) * (0.3 + 0.7 * u)) * (u > 0.97 ? 0.4 : 1);
      top.push([x, yT]);
      bot.unshift([x, yT - open]);
      tt.push([x, yT - 0.004]);
      tb.unshift([x, yT - 0.004 - open * 0.55]);
    }
    g.add(decal([...top, ...bot], dark, 0.004, -0.07));
    g.add(decal([...tt.slice(2, -1), ...tb.slice(1, -2)], teeth, 0.008, -0.07));
    // Tooth gaps (two short dark ticks) so the bar reads as teeth.
    for (const u of [0.55, 0.75]) {
      const x = s * (u * 2 - 1) * mw * 1.05, yT = -0.012 + 0.07 * u ** 1.6;
      g.add(decal([[x - 0.003, yT], [x + 0.003, yT], [x + 0.003, yT - 0.02], [x - 0.003, yT - 0.02]], dark, 0.011, -0.07));
    }
    g.add(decal(curve((u) => [s * (mw * 1.08 + u * 0.035), 0.06 + u * 0.035], (u) => 0.008 * (1 - u * 0.6), 6), dark, 0.004, -0.07));
    mouths.set(name, g);
  }
  {
    // Bared clenched teeth (bluster).
    const g = new THREE.Group();
    const D = curve((u) => [(u * 2 - 1) * mw * 1.15, -0.012 * Math.sin(u * Math.PI)], (u) => 0.012 + 0.03 * Math.sin(u * Math.PI) ** 0.5, 16);
    g.add(decal(D, dark, 0.004, -0.07));
    g.add(decal(curve((u) => [(u * 2 - 1) * mw * 1.0, -0.012 * Math.sin(u * Math.PI)], (u) => 0.026 * Math.sin(u * Math.PI) ** 0.6, 14), teeth, 0.008, -0.07));
    g.add(decal(curve((u) => [(u * 2 - 1) * mw * 1.02, -0.012 * Math.sin(u * Math.PI)], () => 0.003, 14), dark, 0.011, -0.07));
    for (const x of [-0.06, -0.02, 0.02, 0.06]) g.add(decal([[x - 0.003, 0.02], [x + 0.003, 0.02], [x + 0.003, -0.04], [x - 0.003, -0.04]], dark, 0.011, -0.07));
    mouths.set('teeth', g);
  }
  for (const m of mouths.values()) jawInner.add(m), (m.visible = false);

  // Nose.
  const noseKind = spec.nose ?? 'bulb';
  const nose =
    noseKind === 'bulb' ? kit.ball(0.1, skin, 1.15, 0.9, 1, 20) : noseKind === 'button' ? kit.ball(0.065, skin, 1.1, 0.95, 1, 18) : kit.ball(0.07, skin, 0.75, 0.9, 1.5, 18);
  nose.position.set(0, 0.4, noseKind === 'sharp' ? 0.4 : 0.39);
  headInner.add(nose);
  const noseHl = new THREE.Mesh(kit.geo(new THREE.CircleGeometry(noseKind === 'bulb' ? 0.028 : 0.018, 12)), kit.own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false })));
  noseHl.position.set(0.03, noseKind === 'bulb' ? 0.045 : 0.03, noseKind === 'bulb' ? 0.085 : noseKind === 'sharp' ? 0.1 : 0.058);
  noseHl.rotation.set(-0.4, 0.3, 0);
  nose.add(noseHl);

  // Eyes: glossy white + iris + pupil + two unlit highlights + a sparkle star in a unit sphere, upper and
  // lower lids, scaled into place.
  const eyes: THREE.Group[] = [], irises: THREE.Mesh[] = [];
  const lids: { z: THREE.Group; x: THREE.Group }[] = [];
  const lidsLo: { z: THREE.Group; x: THREE.Group }[] = [];
  const pupils: THREE.Group[] = [];
  const inners: THREE.Group[] = [];
  const brows: THREE.Group[] = [];
  const lashes: THREE.Mesh[] = [];
  const sparkles: THREE.Mesh[] = [];
  const hls: THREE.Mesh[] = [];
  const white = kit.toon(0xffffff);
  const shine = kit.own(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const lidMat = kit.toon(spec.lid ?? new THREE.Color(spec.skin).multiplyScalar(0.94).getHex(), { gloss: 0.05, rim: 0.4 });
  const irisMat = kit.toonUnique(spec.iris);
  const irisDark = kit.toon(new THREE.Color(spec.iris).multiplyScalar(0.55).getHex());
  const browMat = kit.toon(spec.brow);
  const lashMat = kit.toon(0x1a0e10, { gloss: 0 });
  const sparkGeo = kit.geo(new THREE.ShapeGeometry(starShape(0.2, 0.38)));
  for (const s of [1, -1]) {
    const eye = new THREE.Group();
    eye.position.set(s * 0.155, 0.57, 0.335);
    eye.rotation.y = s * 0.28;
    headInner.add(eye);
    const inner = new THREE.Group();
    inner.scale.set(0.115, 0.145, 0.07);
    eye.add(inner);
    inner.add(kit.ball(1, white, 1, 1, 1, 22, 0.018));
    const pg = new THREE.Group();
    inner.add(pg);
    const ring = kit.ball(0.58, irisDark, 1, 1, 0.3, 20, 0);
    ring.position.z = 0.79;
    pg.add(ring);
    const iris = kit.ball(0.52, irisMat, 1, 1, 0.3, 20, 0);
    iris.position.z = 0.82;
    pg.add(iris);
    irises.push(iris);
    const pupil = kit.ball(0.31, 0x0b0b14, 1, 1, 0.3, 16, 0);
    pupil.position.z = 0.93;
    pg.add(pupil);
    const hl = new THREE.Mesh(kit.geo(new THREE.CircleGeometry(0.17, 14)), shine);
    hl.position.set(s * 0.2, 0.26, 1.03);
    pg.add(hl);
    hls.push(hl);
    const hl2 = new THREE.Mesh(kit.geo(new THREE.CircleGeometry(0.075, 10)), shine);
    hl2.position.set(-s * 0.17, -0.2, 1.03);
    pg.add(hl2);
    const sp = new THREE.Mesh(sparkGeo, shine);
    sp.position.set(-s * 0.05, 0.3, 1.05);
    pg.add(sp);
    sparkles.push(sp);
    pupils.push(pg);
    const lz = new THREE.Group();
    inner.add(lz);
    const lx = new THREE.Group();
    lz.add(lx);
    const lid = kit.mesh(new THREE.SphereGeometry(1.1, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2), lidMat, 0.012);
    lx.add(lid);
    // Lash line along the lid's edge: defines the eye shape at any opening.
    const lashGeo = new THREE.TorusGeometry(1.1, 0.11, 5, 24, Math.PI);
    lashGeo.rotateX(Math.PI / 2);
    lx.add(kit.mesh(lashGeo, lashMat, 0));
    lids.push({ z: lz, x: lx });
    const lzo = new THREE.Group();
    inner.add(lzo);
    const lxo = new THREE.Group();
    lzo.add(lxo);
    const lidLo = kit.mesh(new THREE.SphereGeometry(1.08, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2), lidMat, 0.01);
    lxo.add(lidLo);
    const lashLoGeo = new THREE.TorusGeometry(1.09, 0.05, 4, 24, Math.PI);
    lashLoGeo.rotateX(Math.PI / 2);
    lxo.add(kit.mesh(lashLoGeo, lashMat, 0));
    lidsLo.push({ z: lzo, x: lxo });
    // Closed-eye arc, shown when the lid is shut (wink).
    const lash = kit.mesh(new THREE.TorusGeometry(0.72, 0.13, 6, 16, Math.PI), kit.toon(0x1a0e10), 0);
    lash.position.set(0, -0.25, 1.12);
    lash.visible = false;
    inner.add(lash);
    lashes.push(lash);
    eyes.push(eye);
    inners.push(inner);
    // Brow: arched, tapering toward the outer end.
    const brow = new THREE.Group();
    brow.position.set(s * 0.165, 0.76, 0.3);
    brow.rotation.y = s * 0.3;
    headInner.add(brow);
    const bs = spec.browScale ?? 1;
    const bm = kit.mesh(browGeo(0.115 * bs, 0.036 * bs, 0.045, 0.018 * bs, s), browMat, 0.016);
    bm.rotation.x = -0.35;
    brow.add(bm);
    brows.push(brow);
  }

  const chinDecal = (pts: [number, number][], mat: THREE.Material, lift = 0.008, dy = -0.07) => decal(pts, mat, lift, dy);
  const b: Base = {
    kit, spec, root, hips, legs, torso, torsoInner, chest, belly: bellyM, head, headInner, cranium, jaw, jawInner, eyes, irises,
    armL: L.arm, armR: Rr.arm, armInnerL: L.inner, armInnerR: Rr.inner, elbowL: L.elbow, elbowR: Rr.elbow, handL: L.hand, handR: Rr.hand,
    R, hipHeight, chains: [], ears, cheeks, nose, skinMat: skin,
    props: { handL: L.hand, handR: Rr.hand, gripL: hands[0].grip, gripR: hands[1].grip, legs },
    armSegs: [{ up: L.up, fore: L.fore }, { up: Rr.up, fore: Rr.fore }],
    chinDecal,
  };
  (b as BaseInternal)._face = {
    mouths, lids, lidsLo, pupils, inners, brows, browBase: brows.map((x) => x.position.y), cavity, upT, lashes, sparkles, hls, blushMat, hands,
  };
  return b;
}

interface BaseInternal extends Base {
  _face: {
    mouths: Map<Mouth, THREE.Object3D>;
    lids: { z: THREE.Group; x: THREE.Group }[];
    lidsLo: { z: THREE.Group; x: THREE.Group }[];
    pupils: THREE.Group[];
    inners: THREE.Group[];
    brows: THREE.Group[];
    browBase: number[];
    cavity: THREE.Mesh;
    upT: THREE.Mesh;
    lashes: THREE.Mesh[];
    sparkles: THREE.Mesh[];
    hls: THREE.Mesh[];
    blushMat: THREE.MeshBasicMaterial;
    hands: HandRig[];
  };
}

/** Face internals (brow pivots, eye highlights, ...) for boss files that need to restyle them. */
export function faceParts(b: Base): { brows: THREE.Group[]; hls: THREE.Mesh[]; sparkles: THREE.Mesh[]; inners: THREE.Group[] } {
  return (b as BaseInternal)._face;
}

/** Cartoon arm stretch (1 = rest length): upper arm + forearm scale along their length. */
function stretch(b: Base, i: 0 | 1, s: number) {
  const { up, fore } = b.armSegs[i];
  const elbow = i ? b.elbowR : b.elbowL, hand = i ? b.handR : b.handL;
  up.scale.y = s;
  up.position.y = -0.16 * s;
  elbow.position.y = -0.3 * s;
  fore.scale.y = s;
  fore.position.y = -0.12 * s;
  hand.position.y = -0.3 * s;
}

const _rv = new THREE.Vector3(), _rd = new THREE.Vector3(), _rq = new THREE.Quaternion(), _rq0 = new THREE.Quaternion();

/**
 * Blends one arm toward putting its hand (palm centre) on `world` (a world-space point), by `k` 0..1.
 * side 1 = armL (character's left, +X), -1 = armR. `bend` = elbow bend (rad). Stretches up to 1.6x
 * like a cartoon if the point is out of reach. Call from a rig hook (after the idle pose is set).
 */
export function reach(b: Base, side: 1 | -1, world: THREE.Vector3, k: number, bend = 0.35) {
  if (k <= 0.001) return;
  const arm = side === 1 ? b.armL : b.armR, inner = side === 1 ? b.armInnerL : b.armInnerR, elbow = side === 1 ? b.elbowL : b.elbowR;
  arm.updateWorldMatrix(true, false);
  _rv.copy(world);
  arm.worldToLocal(_rv);
  const dist = _rv.length() || 1;
  _rv.divideScalar(dist);
  // Rest-pose direction from the shoulder to the palm with this elbow bend (elbow rotation.x = -bend).
  _rd.set(0, -(1 + Math.cos(bend)), Math.sin(bend)).normalize();
  _rq.setFromUnitVectors(_rd, _rv);
  _rq0.copy(inner.quaternion);
  inner.quaternion.slerpQuaternions(_rq0, _rq, k);
  elbow.rotation.x += (-bend - elbow.rotation.x) * k;
  const s = clamp(dist / (0.6 * Math.cos(bend / 2)), 0.8, 1.6);
  stretch(b, side === 1 ? 0 : 1, 1 + (s - 1) * k);
}

const lerp2 = (a: [number, number], to: [number, number], k: number) => {
  a[0] += (to[0] - a[0]) * k;
  a[1] += (to[1] - a[1]) * k;
};
const lerpFace = (a: Face, to: Face, k: number) => {
  a.jaw += (to.jaw - a.jaw) * k;
  a.jawRoll += (to.jawRoll - a.jawRoll) * k;
  a.pupil += (to.pupil - a.pupil) * k;
  a.headX += (to.headX - a.headX) * k;
  a.headZ += (to.headZ - a.headZ) * k;
  a.blush += (to.blush - a.blush) * k;
  a.sparkle += (to.sparkle - a.sparkle) * k;
  lerp2(a.browY, to.browY, k);
  lerp2(a.browRot, to.browRot, k);
  lerp2(a.lid, to.lid, k);
  lerp2(a.lidTilt, to.lidTilt, k);
  lerp2(a.lidLo, to.lidLo, k);
  lerp2(a.eye, to.eye, k);
  a.mouth = to.mouth;
};
export const copyFace = (f: Face): Face => ({
  ...f, browY: [...f.browY], browRot: [...f.browRot], lid: [...f.lid], lidTilt: [...f.lidTilt], lidLo: [...f.lidLo], eye: [...f.eye],
});

const sideIndex = (s: HandSide): 0 | 1 => (s === 'L' || s === 'left' || s === 1 ? 0 : 1);
const _qa = new THREE.Quaternion(), _down = new THREE.Vector3(0, -1, 0), _td = new THREE.Vector3();

export interface FinishOpts {
  height?: number;
  /** Extra posture for the heel turn, run after the generic one (k = turn, 0 sweet .. 1 jerk). */
  posture?: (c: Ctx, k: number) => void;
}

/** Outlines everything and returns the rig. `hook` runs each update before the face is applied. */
export function finish(b: Base, hook: (c: Ctx) => void, opts: FinishOpts = {}): CharacterRigX {
  const f = (b as BaseInternal)._face;
  outlineTree(b.root, b.kit.outlineMat);
  let expr: Expression | null = 'smirk';
  const cur = copyFace(EXPRESSIONS.smirk);
  const sweet = F({ ...SWEET, ...b.spec.sweet }), jerk = F({ ...JERK, ...b.spec.jerk });
  const tf = copyFace(sweet);
  let sigT = 0, sig = 0, talk = 0, t = 0, blinkAt = 1.5 + Math.random() * 2, look = new THREE.Vector2();
  let turn = 0, turnOn = false;
  const handT: [HandPose, HandPose] = ['open', 'open'];
  const ctx: Ctx = { t: 0, dt: 0, sig: 0, expr, face: copyFace(cur), b, lookAdd: new THREE.Vector2(), bdt: 0, turn: 0, turnOn: false, hand: ['open', 'open'] };
  let beatDt = -1;

  return {
    root: b.root, head: b.head, jaw: b.jaw, eyes: b.eyes, armL: b.armL, armR: b.armR,
    props: b.props, torso: b.torso, legs: b.legs, hipHeight: b.hipHeight, height: opts.height ?? 2.3,
    setExpression(e) {
      expr = e;
    },
    setSignature(a) {
      sigT = clamp(a, 0, 1);
    },
    setTalk(a) {
      talk = clamp(a, 0, 1);
    },
    setLook(x, y) {
      look.set(clamp(x, -1, 1), clamp(y, -1, 1));
    },
    setBeatDt(d) {
      beatDt = Math.max(0, d);
    },
    setTurn(k) {
      turnOn = true;
      turn = clamp(k, 0, 1);
    },
    setHandPose(side, pose) {
      if (POSES[pose]) handT[sideIndex(side)] = pose;
    },
    update(dt) {
      t += dt;
      sig = damp(sig, sigT, 8, dt);
      lerpFace(cur, EXPRESSIONS[expr ?? 'smirk'], 1 - Math.exp(-14 * dt));
      const face = Object.assign(ctx.face, copyFace(cur));
      if (turnOn) {
        // The turn owns the mood (eyes, brows, mouth shape, head pose); the expression keeps the jaw.
        Object.assign(tf, copyFace(sweet));
        lerpFace(tf, jerk, turn);
        tf.mouth = turn < 0.5 ? sweet.mouth : jerk.mouth;
        tf.jaw = Math.max(cur.jaw, sweet.jaw + (jerk.jaw - sweet.jaw) * turn);
        tf.jawRoll += cur.jawRoll * 0.3;
        Object.assign(face, copyFace(tf));
      }
      // Idle: breathing and a little sway.
      b.torsoInner.position.set(0, 0, 0);
      b.torsoInner.rotation.set(0, 0, Math.sin(t * 1.3) * 0.015);
      b.torsoInner.scale.set(1, 1 + Math.sin(t * 2.4) * 0.012, 1);
      b.headInner.position.set(0, 0, 0);
      b.armInnerL.rotation.set(Math.sin(t * 1.1) * 0.04, 0, 0.18);
      b.armInnerR.rotation.set(-Math.sin(t * 1.1) * 0.04, 0, -0.18);
      b.elbowL.rotation.set(-0.25, 0, 0);
      b.elbowR.rotation.set(-0.25, 0, 0);
      stretch(b, 0, 1);
      stretch(b, 1, 1);
      if (turnOn) {
        // Sweet: upright, soft, a gentle bob. Jerk: lean in at the camera, shoulders up, elbows out.
        const j = turn, s = 1 - turn;
        b.torsoInner.rotation.x += 0.12 * j - 0.03 * s;
        b.torsoInner.rotation.z += 0.05 * j + Math.sin(t * 1.6) * 0.02 * s;
        b.torsoInner.position.y += Math.sin(t * 3.2) * 0.008 * s - 0.02 * j;
        b.torsoInner.position.z += 0.04 * j;
        b.armInnerL.rotation.z += 0.12 * j - 0.04 * s;
        b.armInnerR.rotation.z -= 0.12 * j - 0.04 * s;
        b.elbowL.rotation.x -= 0.25 * j;
        b.elbowR.rotation.x -= 0.25 * j;
        b.head.position.y = 0.74 - 0.03 * j;
        b.head.position.z = 0.05 * j;
      }
      if (talk > 0) face.jaw += talk * (0.5 + 0.5 * Math.sin(t * 17) * Math.sin(t * 5.3 + 1)) * 0.38;
      ctx.t = t;
      ctx.dt = dt;
      ctx.sig = sig;
      ctx.expr = expr;
      ctx.lookAdd.set(0, 0);
      ctx.bdt = beatDt >= 0 ? Math.min(beatDt, 0.1) : dt;
      ctx.turn = turnOn ? turn : 0;
      ctx.turnOn = turnOn;
      ctx.hand[0] = handT[0];
      ctx.hand[1] = handT[1];
      beatDt = -1;
      if (turnOn) opts.posture?.(ctx, turn);
      hook(ctx);
      // Blink.
      if (t > blinkAt) blinkAt = t + 1.8 + Math.random() * 3;
      const bl = blinkAt - t < 0.13 ? 1 : 0;
      // Apply.
      b.headInner.rotation.set(face.headX, 0, face.headZ);
      b.jawInner.rotation.set(Math.max(0, face.jaw), 0, face.jawRoll);
      const open = face.jaw > 0.1;
      for (const [k, m] of f.mouths) m.visible = !open && k === face.mouth;
      f.blushMat.opacity = clamp(face.blush, 0, 1) * 0.8;
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1;
        const lid = Math.max(face.lid[i], bl);
        const lo = clamp(face.lidLo[i], 0, 0.9) * (1 - bl);
        f.lids[i].x.rotation.x = -Math.PI / 2 + clamp(lid, 0, 1) * Math.PI;
        f.lidsLo[i].x.rotation.x = -Math.PI / 2 - clamp(Math.min(lo, 1.02 - lid), 0, 1) * Math.PI;
        f.lashes[i].visible = face.lid[i] > 0.85;
        f.lids[i].z.rotation.z = -s * face.lidTilt[i];
        f.lidsLo[i].z.rotation.z = s * face.lidTilt[i] * 0.4;
        f.inners[i].scale.set(0.115 * face.eye[i], 0.145 * face.eye[i], 0.07);
        f.pupils[i].scale.set(face.pupil, face.pupil, 1);
        f.pupils[i].position.set(clamp(look.x + ctx.lookAdd.x, -1.2, 1.2) * 0.3, clamp(look.y + ctx.lookAdd.y, -1.2, 1.2) * 0.28, 0);
        const sp = clamp(face.sparkle, 0, 1);
        f.sparkles[i].visible = sp > 0.05;
        f.sparkles[i].scale.setScalar(Math.max(0.01, sp) * (1 + 0.15 * Math.sin(t * 6 + i)));
        f.sparkles[i].rotation.z = t * 0.8;
        f.hls[i].scale.setScalar(0.75 + 0.35 * clamp(face.pupil - 0.6, 0, 1));
        f.brows[i].position.y = f.browBase[i] + face.browY[i] + (lid > 0.9 ? -0.015 : 0);
        f.brows[i].rotation.z = s * face.browRot[i];
      }
      // Hands: blend toward the pose targets.
      const hk = 1 - Math.exp(-25 * Math.max(ctx.bdt, dt));
      for (let i = 0; i < 2; i++) {
        const h = f.hands[i], p = POSES[ctx.hand[i]], c = h.cur;
        for (let n = 0; n < 3; n++) c.curl[n] += (p.curl[n] - c.curl[n]) * hk;
        c.spread += (p.spread - c.spread) * hk;
        c.tc += (p.tc - c.tc) * hk;
        c.wave += (p.wave - c.wave) * hk;
        c.thumb.lerp(p.thumb, hk).normalize();
        h.fingers.forEach((fg, n) => {
          fg.k1.rotation.set(fg.spreadDir * c.spread, 0, -h.s * c.curl[n] * 1.55);
          fg.k2.rotation.set(0, 0, -h.s * c.curl[n] * 1.75);
        });
        _td.set(h.s * c.thumb.x, c.thumb.y, c.thumb.z);
        h.thumb.quaternion.copy(_qa.setFromUnitVectors(_down, _td));
        h.thumb2.rotation.set(0, 0, -h.s * c.tc * 1.2);
        h.inner.rotation.set(0, 0, c.wave * Math.sin(t * 9) * 0.35);
      }
      for (const c of b.chains) c.update(dt, t);
    },
    dispose() {
      b.root.removeFromParent();
      b.kit.dispose();
    },
  };
}
