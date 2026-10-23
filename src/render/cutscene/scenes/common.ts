// Shared choreography helpers for the boss scenes.
import * as THREE from 'three';
import { Director } from '../director';
import { glowSprite, glowTexture, harshJerk, mixLook, neutralLook, warmSweet, type Look } from '../stage';

// Lighting presets (see stage.ts): d.look(t, warmSweet()), d.look(t, harshJerk(0xff2a5a), 0.3), mixLook(a, b, k).
export { harshJerk, mixLook, neutralLook, warmSweet, type Look };
import type { CarRig, CharacterRig } from '../types';

export type CarRigLike = CarRig & { props?: Record<string, THREE.Object3D>; roof?: THREE.Object3D };

export interface Boss {
  car: CarRigLike;
  char: CharacterRig;
  /** Car body size from its bounding box (local, unscaled). */
  size: THREE.Vector3;
  roofY: number;
}

/**
 * Builds the boss's car and puts the (oversized) character in its seat. `charH` is the character's
 * height in metres: bigger than real so they read on screen.
 */
export function mountBoss(d: Director, car: CarRigLike, char: CharacterRig, charH = 2.2): Boss {
  d.rig(car);
  d.rig(char);
  car.root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(car.root);
  const size = box.getSize(new THREE.Vector3());
  const x = char as CharacterRig & { hipHeight?: number; height?: number; legs?: THREE.Object3D };
  // the Modeler's seating: hips on the window sill, legs hidden, torso + big head out of the window
  if (x.legs) x.legs.visible = false;
  const s = x.height ? charH / x.height : 1;
  if (x.height) char.root.scale.setScalar(s);
  else Director.fitHeight(char.root, charH);
  char.root.position.y = -(x.hipHeight ?? 0) * s;
  car.seat.add(char.root);
  d.scene.add(car.root);
  const boss = { car, char, size, roofY: box.max.y };
  headR(boss); // measure the head at rest, before hair and hats fly around
  return boss;
}

/** World positions of the rear tyre contacts (falls back to the bbox's rear corners). */
export function rearPoints(b: Boss): THREE.Vector3[] {
  const pts = b.car.rearContacts.length
    ? b.car.rearContacts.map((o) => Director.wp(o))
    : [new THREE.Vector3(-b.size.x * 0.32, 0.05, b.size.z * 0.45), new THREE.Vector3(-b.size.x * 0.32, 0.05, -b.size.z * 0.45)].map((p) =>
        b.car.root.localToWorld(p),
      );
  return pts;
}

export function exhaustPoints(b: Boss): THREE.Vector3[] {
  return b.car.exhausts.length
    ? b.car.exhausts.map((o) => Director.wp(o))
    : [new THREE.Vector3(-b.size.x * 0.5, 0.35, b.size.z * 0.25), new THREE.Vector3(-b.size.x * 0.5, 0.35, -b.size.z * 0.25)].map((p) =>
        b.car.root.localToWorld(p),
      );
}

const _box = new THREE.Box3();
const _q = new THREE.Quaternion();
/** Head centre in world space (bbox centre, so hats/hair pivots don't throw the framing off). */
export function headPos(b: Boss, out = new THREE.Vector3()) {
  b.char.head.updateWorldMatrix(true, true);
  // the face: between the eyes, pushed back to the skull centre (hair and hats don't move the framing)
  if (b.char.eyes.length >= 2) {
    const a = b.char.eyes[0].getWorldPosition(new THREE.Vector3());
    const c = b.char.eyes[1].getWorldPosition(new THREE.Vector3());
    b.char.root.getWorldQuaternion(_q);
    const back = new THREE.Vector3(0, 0, -1).applyQuaternion(_q);
    return out.copy(a).add(c).multiplyScalar(0.5).addScaledVector(back, headR(b) * 0.6);
  }
  _box.setFromObject(b.char.head);
  return _box.getCenter(out);
}

const radii = new WeakMap<object, number>();
/** Head radius in world units (half the bbox's largest side, measured once at rest). */
export function headR(b: Boss) {
  let r = radii.get(b.char);
  if (r === undefined) {
    b.char.head.updateWorldMatrix(true, true);
    _box.setFromObject(b.char.head);
    const s = _box.getSize(new THREE.Vector3());
    r = Math.max(0.2, Math.min(s.x, s.y, s.z) / 2);
    radii.set(b.char, r);
  }
  return r;
}

/**
 * Close-up framing relative to the face: `dist` in head radii in front of the face, `yaw` radians
 * around it (+ = toward the face's left), `up` in head radii. Returns camera pos + look target.
 */
export function faceCam(b: Boss, dist: number, yaw = 0, up = 0, lookUp = 0) {
  const c = headPos(b);
  const r = headR(b);
  b.char.root.getWorldQuaternion(_q);
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(_q).setY(0).normalize();
  fwd.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const pos = c.clone().addScaledVector(fwd, dist * r);
  pos.y += up * r;
  return { pos, look: c.clone().setY(c.y + lookUp * r) };
}

/** Particle emitter with fractional accumulation: call with world dt, returns how many to spawn. */
export function rate(perSec: number) {
  let acc = 0;
  return (wdt: number, mul = 1) => {
    acc += perSec * mul * wdt;
    const n = Math.floor(acc);
    acc -= n;
    return n;
  };
}

/** Camera offset from a point in the car's local frame (so shots follow the car's yaw). */
export function carLocal(b: Boss, x: number, y: number, z: number) {
  b.car.root.updateWorldMatrix(true, true);
  return b.car.root.localToWorld(new THREE.Vector3(x, y, z));
}

/** A coloured glow sprite + point light pair (sirens, eye glow, lamps). */
export function lamp(color: number, size: number, intensity: number, dist = 14) {
  const tex = glowTexture();
  const g = new THREE.Group();
  const s = glowSprite(tex, color, size);
  const l = new THREE.PointLight(color, intensity, dist, 1.4);
  g.add(s, l);
  return {
    group: g,
    sprite: s,
    light: l,
    set(on: number) {
      (s.material as THREE.SpriteMaterial).opacity = on;
      l.intensity = intensity * on;
    },
  };
}

/**
 * Classic big-text cartoon "smack" lines behind a character, as 3D rays. Additive at 0.35 by default;
 * `additive: false` draws them as solid (normal-blended) colour, so dark or black rays work too.
 */
export function rays(color: number, n = 14, len = 9, o: { opacity?: number; additive?: boolean } = {}): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  const p: number[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = a0 + (Math.PI * 2) / n / 2;
    p.push(0, 0, 0, Math.cos(a0) * len, Math.sin(a0) * len, 0, Math.cos(a1) * len, Math.sin(a1) * len, 0);
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: o.opacity ?? 0.35,
      blending: o.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    }),
  );
  return m;
}

/** Flaps the jaw for a voice line (uses the Modeler's setTalk when present). */
export function talk(d: Director, b: Boss, t0: number, dur: number, rate = 14) {
  const r = b.char as CharacterRig & { setTalk?: (k: number) => void };
  if (!r.setTalk) return;
  d.span(t0, t0 + dur, (u) => r.setTalk!(u >= 1 ? 0 : Math.abs(Math.sin(d.wt * rate + u * 20))));
}

export interface HeelTurnOpts {
  /** Jerk rim colour (harshJerk's `color`), default hot pink-red. */
  color?: THREE.ColorRepresentation;
  /** Jerk second rim colour (default: complementary). */
  color2?: THREE.ColorRepresentation;
  /** Glitch strength (default 1; Rosa ~1.3). */
  strength?: number;
  /** Override the looks. */
  sweet?: Look;
  jerk?: Look;
  /** Play sfx.glitch (default true). */
  sound?: boolean;
  /** Camera punch-in degrees at t1 (default 6; 0 = none). */
  punch?: number;
}

/**
 * The whole TURN beat in one call: d.glitch(t0, t1, strength), sfx.glitch, the light flickering warmSweet <->
 * harshJerk in sync with the glitch (then holding harshJerk from t1), the rig's setTurn flickering on the same
 * frames (ends on 1), a small jolt at t0 and a punch-in at t1. Returns the jerk look (to re-key or tweak).
 * Put d.look(0, warmSweet()) (or your own sweet look) at the top of the scene for the SWEET half.
 */
export function heelTurn(d: Director, b: Boss | null, t0: number, t1: number, o: HeelTurnOpts = {}): Look {
  const sweet = o.sweet ?? warmSweet();
  const jerk = o.jerk ?? harshJerk(o.color ?? 0xff2a5a, o.color2);
  d.glitch(t0, t1, o.strength ?? 1);
  d.lookFlicker(t0, t1, sweet, jerk);
  d.look(t1, jerk);
  if (o.sound !== false) d.at(t0, () => d.sfx.glitch(t1 - t0));
  if (b) d.span(t0, t1 + 1 / 30, () => b.char.setTurn?.(d.turnAt()));
  d.at(t0, () => d.cam.shake(0.35));
  const p = o.punch ?? 6;
  if (p) d.at(t1, () => (d.cam.punch(-p), d.cam.shake(0.5)));
  return jerk;
}
