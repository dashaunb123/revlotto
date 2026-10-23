// OILSLICK OLGA: a jerk from the first frame. Her truck rolls up to the line with her surfing on the roof,
// a gremlin grin on her face and a GIANT oil super-soaker at her hip, already hosing. She coats the track,
// drenches the rail fans (they scatter screaming, one takes it in the face in slow-mo), floods your lane
// and your car, then swings it round straight down the barrel at us: slow-mo, SPLAT on the lens. Card,
// still cackling.
import * as THREE from 'three';
import { Director, clamp01, easeInOut, easeOut, lerp, rand, seg, type CardInfo } from '../director';
import { outline, toonMat } from '../fx';
import { buildBossCar, buildCar, buildCharacter } from '../models';
import { buildOilGun } from '../models/props';
import { buildDragStrip } from '../stage';
import { harshJerk, headPos, rate, type Boss } from './common';

const LANE = -2.6; // Olga's lane
const YOUR_LANE = 2.6;
const INK_C = new THREE.Color(0x07070c);
const G = 9.8;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

// ---------- glossy oil surfaces (splats + the flooded lane) ----------

// Oil-slick thin-film palette: cyan -> magenta -> yellow -> cyan.
const SLICK = /* glsl */ `
vec3 slick(float h) {
  h = fract(h);
  vec3 c = mix(vec3(0.25, 0.95, 1.0), vec3(1.0, 0.18, 0.8), smoothstep(0.0, 0.33, h));
  c = mix(c, vec3(1.0, 0.86, 0.15), smoothstep(0.33, 0.66, h));
  return mix(c, vec3(0.25, 0.95, 1.0), smoothstep(0.66, 1.0, h));
}`;

// Wet black mirror: sky + two stadium highlights + a thin rainbow film.
const GLOSS = /* glsl */ `
${SLICK}
vec3 gloss(vec3 W, float t, float seed) {
  vec3 V = normalize(cameraPosition - W);
  vec3 R = reflect(-V, vec3(0.0, 1.0, 0.0));
  vec3 col = vec3(0.006, 0.006, 0.012);
  col += vec3(0.004, 0.008, 0.012) * smoothstep(0.0, 0.6, R.y);
  col += vec3(0.8, 1.0, 1.0) * pow(max(dot(R, normalize(vec3(-0.4, 0.55, 0.7))), 0.0), 160.0) * 1.1;
  col += vec3(1.0, 0.9, 1.0) * pow(max(dot(R, normalize(vec3(0.5, 0.5, 0.7))), 0.0), 220.0) * 0.8;
  float sw = sin(W.x * 0.9 + sin(W.z * 1.3 + t * 0.6 + seed) * 1.6 + t * 0.3) + sin(W.z * 1.7 - W.x * 0.4 + seed);
  float band = 1.0 - smoothstep(0.0, 0.03, abs(fract(sw * 0.5) - 0.5));
  col += slick(sw * 0.3 + W.x * 0.02 + t * 0.1 + seed) * band * 0.05;
  return col;
}`;

const SPLAT_VS = /* glsl */ `
attribute float aSeed;
varying vec2 vUv;
varying vec3 vW;
varying float vSeed;
void main() {
  vUv = uv * 2.0 - 1.0;
  vSeed = aSeed;
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const SPLAT_FS = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec3 vW;
varying float vSeed;
${GLOSS}
void main() {
  float a = atan(vUv.y, vUv.x);
  float L = length(vUv);
  float s = vSeed * 6.2831;
  // splat: lumpy body + a few long splash fingers
  float r = 0.62 + 0.08 * sin(a * 5.0 + s) + 0.05 * sin(a * 9.0 + s * 2.3);
  r += 0.3 * pow(max(0.0, sin(a * 7.0 + s * 3.1)), 18.0);
  // satellite droplets
  vec2 q = vUv * 3.2 + vec2(sin(s), cos(s));
  float sat = step(length(fract(q) - 0.5), 0.12 * step(0.72, fract(sin(dot(floor(q), vec2(12.9898, 78.233)) + s) * 43758.5)));
  if (L > r && (sat < 0.5 || L > 0.98)) discard;
  vec3 col = gloss(vW, uTime, vSeed * 7.0);
  // thick black body: a soft dark meniscus inside the rim and only a hairline of glint on the lip
  col *= 0.55 + 0.45 * smoothstep(0.0, 0.25, r - L);
  col += vec3(0.6, 0.85, 0.9) * (1.0 - smoothstep(0.0, 0.012, r - L)) * 0.08 * step(L, r);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** Pool of glossy oil splats on the asphalt; each one pops out to full size in ~0.12 s of world time. */
function buildSplats(max: number) {
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const seeds = new Float32Array(max);
  for (let i = 0; i < max; i++) seeds[i] = Math.random();
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: SPLAT_VS, fragmentShader: SPLAT_FS,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const items = Array.from({ length: max }, () => ({ p: new THREE.Vector3(), r: 0, age: 9, rot: 0, live: false }));
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < max; i++) mesh.setMatrixAt(i, zero);
  let next = 0;
  let n = 0;
  return {
    mesh,
    uniforms,
    get count() {
      return n;
    },
    spawn(p: THREE.Vector3Like, r: number) {
      const it = items[next];
      next = (next + 1) % max;
      n = Math.min(max, n + 1);
      it.p.set(p.x, 0.03 + (next % 7) * 0.0015, p.z);
      it.r = r;
      it.age = 0;
      it.rot = rand(0, 6.28);
      it.live = true;
    },
    clear() {
      for (const it of items) it.live = false;
      n = 0;
    },
    update(wdt: number) {
      items.forEach((it, i) => {
        if (!it.live) return mesh.setMatrixAt(i, zero);
        it.age += wdt;
        const k = easeOut(clamp01(it.age / 0.12));
        q.setFromAxisAngle(UP, it.rot);
        mesh.setMatrixAt(i, m4.compose(it.p, q, sc.set(it.r * 2 * k, 1, it.r * 2 * k * 0.85)));
      });
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

const LAKE_VS = /* glsl */ `
varying vec2 vUv;
varying vec3 vW;
void main() {
  vUv = uv * 2.0 - 1.0;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const LAKE_FS = /* glsl */ `
uniform float uTime;
uniform float uGrow;
varying vec2 vUv;
varying vec3 vW;
${GLOSS}
void main() {
  float a = atan(vUv.y, vUv.x);
  float r = uGrow * (0.9 + 0.06 * sin(a * 6.0 + 1.0) + 0.04 * sin(a * 13.0 + uTime));
  float L = length(vUv);
  if (L > r) discard;
  vec3 col = gloss(vW, uTime, 2.0);
  col = mix(col, vec3(0.5, 0.95, 1.0), (1.0 - smoothstep(0.0, 0.02, r - L)) * 0.6);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** The flood: an elliptical black lake that spreads out from its centre (uGrow 0..1). */
function buildLake(len: number, width: number) {
  const geo = new THREE.PlaneGeometry(len, width);
  geo.rotateX(-Math.PI / 2);
  const uniforms = { uTime: { value: 0 }, uGrow: { value: 0 } };
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({ uniforms, vertexShader: LAKE_VS, fragmentShader: LAKE_FS, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  );
  mesh.frustumCulled = false;
  return { mesh, uniforms };
}

// ---------- the stream ----------

/**
 * The super-soaker jet: a dense pool of glossy black blobs, stretched along their velocity so the stream
 * reads as a continuous rope, each with a cyan glint toward the lens. World-time physics (slow-mo hangs it).
 * `onHit` fires when a blob reaches the ground or `hitTest` claims it.
 */
function buildStream(max: number) {
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 2), toonMat(0x0b0b14, {}, { gloss: 1, shine: 90, rim: 0 }), max);
  mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const glint = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshBasicMaterial({ color: 0xc8fbff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false }),
    max,
  );
  glint.frustumCulled = false;
  glint.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const items = Array.from({ length: max }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0, age: 0, live: false, wob: rand(0, 6) }));
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const gp = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  let next = 0;
  for (let i = 0; i < max; i++) {
    mesh.setMatrixAt(i, zero);
    glint.setMatrixAt(i, zero);
  }
  return {
    mesh,
    glint,
    spawn(p: THREE.Vector3Like, v: THREE.Vector3Like, r: number) {
      const it = items[next];
      next = (next + 1) % max;
      it.p.set(p.x, p.y, p.z);
      it.v.set(v.x, v.y, v.z);
      it.r = r;
      it.age = 0;
      it.live = true;
    },
    clear() {
      for (const it of items) it.live = false;
    },
    update(
      wdt: number,
      t: number,
      cam: THREE.Vector3,
      onHit: (p: THREE.Vector3, v: THREE.Vector3, r: number) => void,
      hitTest?: (p: THREE.Vector3, v: THREE.Vector3, r: number) => boolean,
    ) {
      items.forEach((it, i) => {
        if (it.live) {
          it.v.y -= G * wdt;
          it.p.addScaledVector(it.v, wdt);
          it.age += wdt;
          if (it.p.y <= 0.02) {
            it.p.y = 0.02;
            onHit(it.p, it.v, it.r);
            it.live = false;
          } else if (hitTest?.(it.p, it.v, it.r)) it.live = false;
          else if (it.age > 4 || it.p.distanceToSquared(cam) < 0.3) it.live = false;
        }
        if (!it.live) {
          mesh.setMatrixAt(i, zero);
          glint.setMatrixAt(i, zero);
          return;
        }
        // a wobbling rope segment: long along the velocity, fattening as it leaves the nozzle
        const sp = it.v.length();
        const fat = it.r * (0.55 + 0.45 * clamp01(it.age * 5)) * (1 + 0.15 * Math.sin(t * 23 + it.wob));
        q.setFromUnitVectors(UP, sp > 1e-3 ? tmp.copy(it.v).divideScalar(sp) : tmp.set(0, 1, 0));
        mesh.setMatrixAt(i, m4.compose(it.p, q, sc.set(fat, fat + sp * 0.04, fat)));
        tmp.copy(cam).sub(it.p).normalize();
        gp.copy(it.p).addScaledVector(tmp, fat * 0.9);
        gp.y += fat * 0.45;
        glint.setMatrixAt(i, m4.compose(gp, q, sc.set(fat * 0.22, fat * 0.22 + sp * 0.008, fat * 0.22)));
      });
      mesh.instanceMatrix.needsUpdate = true;
      glint.instanceMatrix.needsUpdate = true;
    },
  };
}

/** Launch direction to hit `to` from `from` at speed v on the flat (low) arc; falls back to 45 degrees. */
function aimAt(from: THREE.Vector3, to: THREE.Vector3, v: number, out = new THREE.Vector3()) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const x = Math.hypot(dx, dz);
  const y = to.y - from.y;
  const disc = v ** 4 - G * (G * x * x + 2 * y * v * v);
  const th = disc < 0 ? Math.PI / 4 : Math.atan2(v * v - Math.sqrt(disc), G * x);
  return out.set((dx / (x || 1)) * Math.cos(th), Math.sin(th), (dz / (x || 1)) * Math.cos(th));
}

// ---------- the victims ----------

/** One rail fan behind the wall: chunky body, round head, two arms, a face that can scream. */
function buildFan(color: number, skin: number) {
  const root = new THREE.Group();
  const shirt = toonMat(color);
  const skinM = toonMat(skin);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.45, 3, 8), shirt);
  body.position.y = 0.75;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 10, 8), skinM);
  head.position.y = 1.42;
  const arms: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const a = new THREE.Group();
    a.position.set(s * 0.33, 1.12, 0);
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.42, 2, 6), shirt);
    m.position.y = 0.26;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), skinM);
    hand.position.y = 0.55;
    a.add(m, hand);
    outline(m);
    root.add(a);
    arms.push(a);
  }
  const eyeM = toonMat(0x111018);
  const eyes: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 4), eyeM);
    e.position.set(s * 0.09, 1.47, 0.24);
    head.parent ?? root.add(e);
    eyes.push(e);
  }
  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), toonMat(0x3a1018));
  mouth.position.set(0, 1.33, 0.24);
  mouth.scale.set(1, 0.4, 0.4);
  root.add(body, head, mouth);
  outline(body);
  outline(head);
  return { root, body, head, arms, eyes, mouth, mats: [shirt, skinM], base: [new THREE.Color(color), new THREE.Color(skin)] };
}

// ---------- rig extras (duck-typed: the Characters agent's controls) ----------

type RigX = {
  setTurn?: (k: number) => void;
  setCackle?: (k: number) => void;
  setInnocent?: (k: number) => void;
  setGoggles?: (k: number) => void;
  setTalk?: (k: number) => void;
  setLook?: (x: number, y: number) => void;
  setHandPose?: (side: 'L' | 'R', pose: 'open' | 'fist' | 'grip') => void;
  setBeatDt?: (dt: number) => void;
  props?: Record<string, THREE.Object3D>;
  height?: number;
  hipHeight?: number;
  legs?: THREE.Object3D;
};

type DirX = Director & { glitch?: (t0: number, t1: number, strength?: number) => void };

interface ShotCam {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  roll?: number;
}

/** Camera look target that puts the head at screen fraction (sx, sy) (0..1 from the left / top). */
function frameHead(b: Boss, cam: THREE.Vector3, fov: number, sx: number, sy: number) {
  const h = headPos(b);
  const f = h.clone().sub(cam);
  const dist = f.length();
  f.normalize();
  const right = new THREE.Vector3().crossVectors(f, UP).normalize();
  const up = new THREE.Vector3().crossVectors(right, f);
  const halfH = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * dist;
  const halfW = halfH * (16 / 9);
  return h.addScaledVector(right, -(sx - 0.5) * 2 * halfW).addScaledVector(up, (sy - 0.5) * 2 * halfH);
}

export default function olga(d: Director, card: CardInfo) {
  const dx = d as DirX;
  const set = buildDragStrip(d.stage, { haze: 0x10202a, sky: [0x0e2a36, 0x05060a], fogNear: 40, fogFar: 190 });
  d.crowd = set.crowd;
  d.look(0, harshJerk(0x5cf2ff, 0xff4ad0));

  // ---------- the truck rolls in with Olga surfing on the roof ----------
  const truck = d.rig(buildBossCar('olga'));
  const truckX = truck as typeof truck & { roof?: THREE.Object3D };
  d.scene.add(truck.root);
  truck.root.position.set(0, 0, LANE);
  truck.root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(truck.root);
  const size = box.getSize(new THREE.Vector3());

  const char = buildCharacter('olga');
  const rig = char as typeof char & RigX;
  d.rig(char);
  const CH = 2.15;
  const s = rig.height ? CH / rig.height : 1;
  char.root.scale.setScalar(s);
  if (rig.legs) rig.legs.visible = true;
  if (truckX.roof) truckX.roof.add(char.root);
  else {
    char.root.position.y = box.max.y;
    truck.root.add(char.root);
  }
  const b: Boss = { car: truck, char, size, roofY: box.max.y };
  rig.setTurn?.(1); // the gremlin face, start to finish
  rig.setExpression('crazy');
  rig.setHandPose?.('R', 'grip');
  rig.setHandPose?.('L', 'grip');
  const handR = rig.props?.handR ?? char.armR;
  const handL = rig.props?.handL ?? char.armL;

  // the GIANT super-soaker (in the world, not the hand: we aim it, the arms follow it)
  const gun = buildOilGun();
  const gunX = gun as typeof gun & { setLevel?: (k: number) => void; update?: (dt: number) => void };
  if (gunX.update) d.every((_dt, wdt) => gunX.update!(wdt));
  const GUN_S = 1.45;
  gun.root.scale.setScalar(GUN_S);
  d.scene.add(gun.root);
  d.onDispose(() => gun.dispose());

  // your car, in your lane, about to have a very bad day
  const you = d.rig(buildCar({ body: 'compact', color: '#e8413c', accent: '#f7d23e' }));
  you.root.position.set(-4.2, 0, YOUR_LANE);
  d.scene.add(you.root);

  // rail fans leaning on the wall on the camera side (they get hosed)
  const FAN_Z = 9.25;
  const fanCols = [0xf7d23e, 0x38c6c0, 0xe8413c, 0x9b4de0, 0xf28c28, 0x3c78e8, 0x7ad04a, 0xff6aa8];
  const skins = [0xf3c29c, 0xc98a5e, 0x8a5a3a, 0xf0d0b0];
  const fans = Array.from({ length: 14 }, (_, i) => {
    const f = buildFan(fanCols[i % fanCols.length], skins[(i * 3) % skins.length]);
    const x = -6.5 + i * 1.0 + rand(-0.2, 0.2);
    f.root.position.set(x, 0, FAN_Z + rand(-0.15, 0.25));
    f.root.rotation.y = Math.PI; // facing the strip (-Z)
    f.root.scale.setScalar(rand(0.92, 1.08));
    d.scene.add(f.root);
    return { ...f, x0: x, oil: 0, flee: 0, dir: x < 0.5 ? -1 : 1, ph: rand(0, 6), hitT: -1 };
  });

  // glossy oil everything
  const splats = buildSplats(320);
  d.scene.add(splats.mesh);
  const lake = buildLake(16, 9);
  lake.mesh.position.set(you.root.position.x + 0.5, 0.04, YOUR_LANE + 0.2);
  d.scene.add(lake.mesh);
  const stream = buildStream(800);
  d.scene.add(stream.mesh, stream.glint);

  // ---------- timeline (real seconds) ----------
  const ROLL = 1.6; // truck rolls in, already hosing; stops here
  const TRACK = 1.7; // sweep the asphalt
  const CROWD = 3.05; // the rail fans
  const FACE = 3.55; // a fan takes one right in the face (slow-mo)
  const MUG = 4.0; // BIG slow-mo close-up: her gremlin face mid-squirt, the soaker bucking, cackling
  const LANEF = 5.25; // your lane
  const LENS = 6.4; // turn it on the camera
  const SPLAT = 7.45;
  const CARD = 7.7;

  d.bars(true);
  d.at(0, () => {
    d.sfx.squirt(ROLL - 0.4); // a gap for the pump rack; the next squirt starts ~0.45 s after the rack
    d.sfx.voice('olga', 'laugh');
    d.sfx.roar('olga');
    d.hype = 0.8;
  });
  d.slowmo(FACE - 0.08, FACE + 0.42, 0.18, 0.1);
  d.slowmo(MUG + 0.05, LANEF - 0.25, 0.2, 0.12);
  d.slowmo(SPLAT - 0.45, SPLAT + 0.06, 0.14, 0.12);
  d.freeze(CARD, 0.25, 0.6);

  // ---------- choreography state ----------
  const st = { aim: V(1, -0.2, 0.3).normalize(), speed: 15, spray: 1, pump: 0, buck: 0, mug: 0 };
  // cackle strength: full once the rig keeps her squinty eyes open while laughing
  const CACKLE = 1;
  const tgt = new THREE.Vector3();
  const nozW = new THREE.Vector3();
  const gripW = new THREE.Vector3();
  const pumpW = new THREE.Vector3();
  // where the jet is pointed along the rail (the fans' camera trails it by the stream's flight time)
  const fanX = (t: number) => lerp(-5.5, 5.5, easeInOut(seg(t, CROWD - 0.35, MUG + 0.1)));
  const truckAt = (t: number) => lerp(-10, 0, easeOut(seg(t, 0, ROLL)));

  // E: hosing the track ahead as she rolls in, a wild figure-eight
  d.span(0, TRACK, (u) => {
    const a = Math.sin(u * 7) * 0.9;
    tgt.set(truckAt(d.t) + 7 + Math.cos(u * 5) * 2, 0, LANE + a * 3.2);
    st.speed = 14;
    aimAt(nozW, tgt, st.speed, st.aim);
  });
  // pump rack mid-roll
  d.stamp(ROLL - 0.35, 'chk', { color: '#ffffff', x: 400, y: 100, size: 8, rot: -0.2, dur: 0.25 });
  d.stamp(ROLL - 0.2, 'CHK!', { color: '#5cf2ff', x: 420, y: 86, size: 16, rot: 0.15, dur: 0.3 });
  d.span(ROLL - 0.38, ROLL - 0.05, (u) => gun.setPump(Math.abs(Math.sin(u * Math.PI * 2))));
  d.at(ROLL - 0.35, () => {
    d.sfx.pumpRack?.();
    d.sfx.hehe?.('olga');
  });
  d.at(ROLL - 0.2, () => {
    d.sfx.impact();
    d.cam.punch(-3);
  });

  d.at(TRACK, () => {
    d.sfx.squirt(CROWD - TRACK);
    rig.setCackle?.(CACKLE);
  });
  d.span(TRACK, CROWD - 0.35, (u) => {
    // sweep the asphalt in front of her, right to left and back
    const a = lerp(-1.2, 1.5, easeInOut(u)) + 0.15 * Math.sin(u * 9);
    tgt.set(Math.sin(a) * 9, 0, LANE + 1 + Math.cos(a) * 7);
    st.speed = 14;
    aimAt(nozW, tgt, st.speed, st.aim);
  });
  d.at(CROWD, () => {
    d.sfx.squirt(LANEF - CROWD);
    d.sfx.voice('olga', 'laugh');
    d.hype = 1;
  });
  d.span(CROWD - 0.35, MUG, () => {
    tgt.set(fanX(d.t), 1.5, FAN_Z);
    st.speed = 17;
    aimAt(nozW, tgt, st.speed, st.aim);
  });
  // MUG: the close-up camera is fixed off her aim as the beat starts; she hoses the rail right past our shoulder
  const mugAim = new THREE.Vector3(1, 0, 0);
  const pastCam = new THREE.Vector3();
  d.span(
    MUG,
    LANEF - 0.1,
    (u) => {
      // a fixed line just past the lens, wobbling as the soaker bucks
      pastCam.copy(mugAim).applyAxisAngle(UP, lerp(PAST, PAST * 0.8, u) + 0.04 * Math.sin(d.wt * 31));
      pastCam.y = 0.02 + 0.05 * st.buck;
      st.aim.lerp(pastCam.normalize(), u <= 0 ? 1 : 0.3).normalize();
      st.speed = 17;
    },
    () => mugAim.set(st.aim.x, 0, st.aim.z).normalize(),
  );
  // MUG: tongue-poke grin as the jet hits, then she throws her head back and cackles, the soaker bucking
  d.at(MUG, () => {
    rig.setCackle?.(0);
    d.sfx.hehe?.('olga');
    d.cam.punch(-4);
  });
  d.at(MUG + 0.45, () => {
    rig.setCackle?.(CACKLE);
    d.sfx.voice('olga', 'laugh');
  });
  d.stamp(MUG + 0.5, 'HEHEHE!', { color: '#5cf2ff', x: 120, y: 70, size: 16, rot: -0.12, dur: 0.6 });
  d.span(MUG - 0.05, LANEF + 0.05, (u) => (st.mug = u >= 1 ? 0 : 1)); // in the close-up
  d.span(MUG, LANEF, (u) => {
    st.buck = Math.pow(Math.abs(Math.sin(d.wt * 26)), 6) * (1 - seg(u, 0.85, 1));
    gun.setPump(Math.abs(Math.sin(d.wt * 13)));
    // fat gobs flung off the jet, flying past the lens
    if (Math.random() < 0.35) {
      const c = d.stage.camera.position;
      const k = rand(4, 7);
      d.fx.oil(nozW, 1, { size: 0.1, spread: 0.8, life: 0.6, vel: { x: (c.x - nozW.x) * k + rand(-1.5, 1.5), y: (c.y - nozW.y) * k + 1, z: (c.z - nozW.z) * k } });
    }
  });
  d.at(LANEF, () => {
    st.buck = 0;
    rig.setCackle?.(0.2);
    d.sfx.squirt(LENS - LANEF);
  });
  d.span(LANEF - 0.1, LENS, (u) => {
    tgt.set(you.root.position.x + lerp(-1.5, 2.5, u) + Math.sin(u * 20) * 0.6, 0.6, YOUR_LANE + Math.sin(u * 13) * 0.8);
    st.speed = 13;
    aimAt(nozW, tgt, st.speed, st.aim);
  });
  d.at(LENS, () => {
    d.sfx.squirt(SPLAT - LENS);
    d.sfx.voice('olga', 'laugh');
    rig.setCackle?.(CACKLE);
  });
  d.span(LENS, CARD, (u) => {
    // swing round, then right down the barrel at us
    const cam = d.stage.camera.position;
    tgt.set(you.root.position.x + 3, 0.5, YOUR_LANE);
    const toLane = aimAt(nozW, tgt, 13, new THREE.Vector3());
    // past our shoulder at first (so the jet doesn't wall off the frame), dead on the lens for the splat
    const miss = 1 - easeInOut(seg(u, 0.6, 0.85));
    const toCam = cam.clone().add(V(1.6 * miss, -1.2 * miss, 0)).sub(nozW).normalize();
    toCam.y += 0.05;
    st.aim.copy(toLane).lerp(toCam, easeInOut(seg(u, 0, 0.35))).normalize();
    st.speed = 15;
    if (u > 0.96) st.spray = 0.3;
  });
  d.lensSplat(SPLAT, '#07070c', '#5cf2ff');
  d.lensSplat(SPLAT + 0.08, '#07070c', '#ff6ad0');
  d.at(SPLAT, () => {
    d.sfx.splat();
    dx.glitch?.(SPLAT, SPLAT + 0.12, 0.5);
    d.cam.shake(0.5);
    d.cam.punch(-6);
  });
  d.at(CARD, () => {
    st.spray = 0;
    rig.setCackle?.(CACKLE);
  });

  // the stream's blobs: splat the ground, drench the fans
  const fanHit = (p: THREE.Vector3) => {
    if (p.z < FAN_Z - 1.2 || p.y < 0.9) return false;
    for (const f of fans) {
      const fx = f.root.position.x;
      if (Math.abs(p.x - fx) < 0.55 && p.y < 2.0 && Math.abs(p.z - f.root.position.z) < 0.9) {
        f.oil = Math.min(1, f.oil + 0.3);
        if (Math.random() < 0.3) d.fx.oil(p, 1, { size: 0.12, spread: 1.5, vel: { x: 0, y: 1.5, z: -1.5 }, life: 0.7 });
        if (f.hitT < 0) {
          f.hitT = d.t;
          d.fx.oil(p, 4, { size: 0.14, spread: 2, vel: { x: 0, y: 2, z: -1 } });
        }
        return true;
      }
    }
    return false;
  };
  const onHit = (p: THREE.Vector3, _v: THREE.Vector3, r: number) => {
    if (Math.random() < 0.4) splats.spawn(p, rand(0.7, 1.4) * (r / 0.09));
    if (Math.random() < 0.08) d.fx.oil(p, 1, { size: 0.12, vel: { x: 0, y: 2.5, z: 0 }, spread: 1.5, life: 0.6 });
  };
  let screamed = false;

  // ---------- camera ----------
  const shots: { t0: number; t1: number; fn: (u: number) => ShotCam }[] = [];
  const shot = (t0: number, t1: number, fn: (u: number) => ShotCam) => shots.push({ t0, t1, fn });

  // E: low, tracking the truck as it rolls in hosing the track, pushing in on her up on the roof
  shot(0, TRACK, (u) => {
    const x = truckAt(d.t);
    const k = easeInOut(u);
    const pos = V(x + lerp(5.2, 3.4, k), lerp(1.3, 2.2, k), LANE + lerp(5.6, 4.0, k));
    return { pos, look: frameHead(b, pos, 38, lerp(0.5, 0.56, k), 0.3), fov: 38, roll: lerp(-0.06, 0.03, u) };
  });
  // TRACK: high wide front, she hoses the asphalt right to left
  shot(TRACK, CROWD, (u) => ({
    pos: V(lerp(2, -1.5, u), lerp(5.5, 5.0, u), LANE + 12.5),
    look: V(lerp(0.5, -1, u), 1.6, LANE + 2.5),
    fov: 50,
    roll: lerp(0.04, -0.03, u),
  }));
  // CROWD: from behind the rail fans: Olga hosing in the background, the jet coming right at them (and us)
  shot(CROWD, LANEF, (u) => ({
    pos: V(fanX(d.t - 0.55) + lerp(1.8, 1.2, u), 2.5, 11.4),
    look: V(fanX(d.t - 0.55) - 1.2, 1.5, 3.5),
    fov: 52,
    roll: 0.05,
  }));
  // MUG: right in her face, low, the soaker bucking below frame-centre and the jet roaring past us
  const fwd = new THREE.Vector3();
  const side = new THREE.Vector3();
  const SIDE = -1.1; // camera swung off her aim toward her face
  const D0 = 3.6; // push-in distance
  const D1 = 3.0;
  const PAST = -0.4; // the jet's line, just past the lens
  shot(MUG, LANEF, (u) => {
    const h = headPos(b);
    // beside the jet, swung round toward her face: the soaker runs across the bottom of frame, the oil roars past us
    fwd.copy(mugAim).applyAxisAngle(UP, SIDE);
    side.crossVectors(UP, fwd).normalize();
    const k = easeOut(u);
    const pos = h.clone().addScaledVector(fwd, lerp(D0, D1, k)).addScaledVector(side, 0.3).add(V(0, lerp(0.28, 0.2, k), 0));
    const look = h.clone().addScaledVector(side, 0.25).add(V(0, lerp(-0.72, -0.62, k), 0));
    return { pos, look, fov: lerp(46, 40, k), roll: lerp(0.1, -0.06, k) };
  });
  // LANE: high and wide on your car and your lane, flooded
  shot(LANEF, LENS, (u) => ({
    pos: V(you.root.position.x + lerp(5.5, 4.5, u), lerp(7.5, 7.0, u), YOUR_LANE + 8.5),
    look: V(you.root.position.x + 0.8, 0.3, YOUR_LANE - 0.8),
    fov: 52,
  }));
  // LENS: on her, low; she swings it round right down the barrel; then right of frame for the card
  // (world-fixed offsets: she aims at the camera, so a face-relative camera would chase its own tail)
  const lensCam = (u: number) => {
    const pos = headPos(b).add(V(lerp(2.4, 1.5, easeOut(u)), lerp(-2.0, -1.4, u), lerp(8.0, 5.6, easeOut(u))));
    return { pos, look: frameHead(b, pos, 42, lerp(0.5, 0.6, u), 0.36), fov: 42, roll: lerp(0.06, -0.05, u) };
  };
  shot(LENS, CARD, (u) => lensCam(u));
  shot(CARD, CARD + 8, (u) => {
    const pos = headPos(b).add(V(2.3 + u * 0.3, -1.5, 7.0 + u * 0.3));
    return { pos, look: frameHead(b, pos, 42, 0.72, 0.36), fov: 42, roll: 0.05 };
  });

  d.nameCard(CARD, { ...card, color: '#16161e', accent: '#5cf2ff', layout: 'left' }, 1.1, 'olga');
  d.at(CARD + 0.7, () => d.sfx.voice('olga', 'taunt'));
  if (rig.setTalk) d.span(CARD + 0.7, CARD + 1.8, (u) => rig.setTalk!(u >= 1 ? 0 : Math.abs(Math.sin(d.t * 15))));

  // ---------- arms: aim the outer arm groups at the gun after the rig has posed ----------
  const restQ = new WeakMap<THREE.Object3D, THREE.Quaternion>();
  const _a = new THREE.Vector3();
  const _h = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _pq = new THREE.Quaternion();
  const _q2 = new THREE.Quaternion();
  function aimArm(arm: THREE.Object3D, hand: THREE.Object3D, target: THREE.Vector3, k: number) {
    let r = restQ.get(arm);
    if (!r) restQ.set(arm, (r = arm.quaternion.clone()));
    arm.quaternion.copy(r);
    if (k <= 0.001) return;
    arm.updateWorldMatrix(true, true);
    arm.getWorldPosition(_a);
    hand.getWorldPosition(_h);
    const d0 = _h.sub(_a).normalize();
    const d1 = target.clone().sub(_a).normalize();
    arm.parent!.getWorldQuaternion(_pq);
    _q.setFromUnitVectors(d0, d1); // world-space delta -> local: parent^-1 * delta * parent * rest
    _q2.copy(_pq).invert().multiply(_q).multiply(_pq).multiply(r);
    arm.quaternion.slerp(_q2, k);
  }
  const up0 = rig.update.bind(rig);
  rig.update = (dt: number) => {
    up0(dt);
    aimArm(char.armR, handR, gripW, 1);
    aimArm(char.armL, handL, pumpW, 1);
  };
  d.every((dt) => rig.setBeatDt?.(dt));

  // ---------- per frame ----------
  const gq = new THREE.Quaternion();
  const gm = new THREE.Matrix4();
  const gx = new THREE.Vector3();
  const gy = new THREE.Vector3();
  const gz = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const jit = new THREE.Vector3();
  const prevAim = st.aim.clone();
  const prevNoz = new THREE.Vector3();
  const sprayRate = rate(300);
  const hip = new THREE.Vector3();
  d.every((dt, wdt) => {
    const t = d.t;
    const w = d.wt;

    // the truck: rolls in, nose dips as it stops; she turns her body with the aim
    const x = truckAt(t);
    truck.root.position.x = x;
    truck.setWheelSpin(t < ROLL ? 10 * (1 - seg(t, 0, ROLL)) : 0);
    truck.setLean(Math.sin(w * 9) * 0.02, t > ROLL - 0.3 && t < ROLL + 0.4 ? -0.05 * Math.sin(seg(t, ROLL - 0.3, ROLL + 0.4) * Math.PI) : 0);
    const yaw = Math.atan2(st.aim.x, st.aim.z) - 0.35 - 0.7 * st.mug; // MUG: she turns her face toward us while she hoses
    char.root.rotation.y = lerp(char.root.rotation.y, yaw, Math.min(1, dt * 10));
    char.root.updateMatrixWorld(true);

    // the gun at her hip, aimed by st.aim
    char.root.localToWorld(hip.set(-0.42, (rig.hipHeight ?? 1) - 0.05, 0.42));
    gx.copy(st.aim).normalize();
    hip.addScaledVector(gx, -0.18 * st.buck); // the soaker kicks back in her hands
    hip.y += 0.06 * st.buck;
    gun.root.position.copy(hip);
    if (st.buck > 0) gx.y += 0.06 * st.buck;
    gx.normalize();
    gz.crossVectors(gx, UP).normalize();
    gy.crossVectors(gz, gx);
    gq.setFromRotationMatrix(gm.makeBasis(gx, gy, gz));
    gun.root.quaternion.copy(gq);
    gun.root.updateMatrixWorld(true);
    gun.nozzle.getWorldPosition(nozW);
    gripW.copy(hip);
    pumpW.copy(hip).addScaledVector(gx, 0.5 * GUN_S).addScaledVector(gy, 0.1 * GUN_S);
    gunX.setLevel?.(lerp(0.95, 0.1, seg(t, 0, SPLAT)));
    if (t < 0.02) {
      prevNoz.copy(nozW);
      prevAim.copy(st.aim);
    }

    // the stream
    if (st.spray > 0) {
      const n = sprayRate(wdt, st.spray);
      for (let i = 0; i < n; i++) {
        // spawned at fraction f through this frame: aim swept from last frame's; update() moves it (1 - f)
        const f = (i + rand(0, 1)) / n;
        jit.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).multiplyScalar(0.02);
        vel.copy(prevAim).lerp(st.aim, f).add(jit).normalize().multiplyScalar(st.speed * rand(0.96, 1.04));
        const p = prevNoz.clone().lerp(nozW, f).addScaledVector(vel, -f * wdt);
        stream.spawn(p, vel, rand(0.07, 0.11));
      }
      if (Math.random() < 0.3) d.fx.oil(nozW, 1, { size: 0.08, vel: { x: st.aim.x * 3, y: 1, z: st.aim.z * 3 }, spread: 1.5, life: 0.5 });
    }
    prevAim.copy(st.aim);
    prevNoz.copy(nozW);
    stream.update(wdt, w, d.stage.camera.position, onHit, fanHit);
    splats.uniforms.uTime.value = w;
    splats.update(wdt);

    // your lane floods
    lake.uniforms.uTime.value = w;
    lake.uniforms.uGrow.value = easeOut(seg(t, LANEF - 0.05, LENS + 0.3)) * 0.98;

    // the fans: cheer, get drenched, scatter screaming
    for (const f of fans) {
      const hit = f.hitT >= 0;
      if (hit && t > f.hitT + 0.3) f.flee = Math.min(1, f.flee + wdt * 1.2);
      const run = f.flee;
      const bob = Math.abs(Math.sin(w * (hit ? 16 : 7) + f.ph));
      f.root.position.x = f.x0 + f.dir * run * run * 4;
      f.root.position.y = bob * (hit ? 0.3 : 0.1);
      f.root.rotation.z = hit ? f.dir * -0.25 * Math.min(1, run * 3) : 0;
      f.root.rotation.y = Math.PI - (hit ? f.dir * 2.3 * easeOut(Math.min(1, (t - f.hitT) * 4)) : 0);
      for (const [i, a] of f.arms.entries()) {
        const sd = i ? 1 : -1;
        a.rotation.z = hit ? sd * (0.25 + Math.sin(w * 20 + i * 2) * 0.35) : sd * (0.6 + bob * 0.9);
      }
      f.mouth.scale.set(hit ? 1.3 : 1, hit ? 1.6 : 0.4, 0.4);
      f.mats[0].color.copy(f.base[0]).lerp(INK_C, f.oil * 0.92);
      f.mats[1].color.copy(f.base[1]).lerp(INK_C, f.oil * 0.85);
      if (hit && !screamed) {
        screamed = true;
        d.sfx.crowdScream();
        d.stamp(t + 0.05, 'AAAAH!', { color: '#ffffff', x: 400, y: 80, size: 16, rot: 0.12, dur: 0.5 });
        d.stamp(t + 0.3, 'EEK!', { color: '#ff6ad0', x: 150, y: 100, size: 16, rot: -0.15, dur: 0.45 });
      }
    }

    // the cackle bounce stays real-time through the slow-mo
    if (dt > wdt) rig.update(dt - wdt);

    // camera
    let cur: (typeof shots)[number] | undefined;
    for (const sh of shots) if (t >= sh.t0) cur = sh;
    if (cur) {
      const r = cur.fn(clamp01((t - cur.t0) / (cur.t1 - cur.t0)));
      d.cam.pos.copy(r.pos);
      d.cam.look.copy(r.look);
      d.cam.fov = r.fov;
      d.cam.roll = r.roll ?? 0;
    }
  });
}
