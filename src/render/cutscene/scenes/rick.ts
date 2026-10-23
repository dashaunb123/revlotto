// SLICK RICK RADIAL: a sleazy used-tire salesman and a jerk from frame 0. It opens on his grin: the gold tooth
// goes DING. Whip out to Rick by his green muscle car (RICK'S RADIALS sign on the roof): the sales pitch, arms
// flung wide. He holds up a bald "LIKE NEW!" tire with a wink; it farts flat; he tosses it: SOLD! Then the con:
// he rattles his TIRE SHINE and glosses YOUR tyres, then sweeps it across YOUR lane until it's a mirror (SLICK
// DEAL!). Slow-mo: he turns the can on us and sprays the lens, which glazes over. NO REFUNDS. Card, finger gun
// and a wink.
import * as THREE from 'three';
import { Director, clamp01, easeInOut, easeOut, lerp, rand, seg, type CardInfo } from '../director';
import { toonMat } from '../fx';
import { buildBossCar, buildCar, buildCharacter } from '../models';
import type { RickRig } from '../models/rick';
import { buildDragStrip } from '../stage';
import { harshJerk, headPos, rate, type Boss } from './common';

const RICK_LANE = -2.6;
const YOUR_LANE = 2.6;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

// ---------- the shine: an additive clear-coat gloss over your lane ----------

const GLOSS_VS = /* glsl */ `
varying vec3 vW;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const GLOSS_FS = /* glsl */ `
uniform float uTime;
uniform float uGrow;
uniform float uX0;
uniform float uLen;
varying vec3 vW;
varying vec2 vUv;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  // spreads out along the lane from uX0, with a wobbly wet edge
  float edge = uGrow * uLen + 0.6 * sin(vW.z * 3.0 + vW.x * 0.7) + 0.4 * sin(vW.z * 7.0 - vW.x);
  float m = 1.0 - smoothstep(edge - 0.6, edge, abs(vW.x - uX0));
  float side = smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.88, vUv.y);
  m *= side;
  if (m < 0.002) discard;
  vec3 Vd = normalize(cameraPosition - vW);
  vec3 R = reflect(-Vd, vec3(0.0, 1.0, 0.0));
  vec3 col = vec3(0.04, 0.09, 0.07); // a mint clear-coat film
  col += vec3(0.75, 1.0, 0.9) * pow(max(dot(R, normalize(vec3(-0.35, 0.5, 0.8))), 0.0), 60.0) * 1.4;
  col += vec3(1.0, 0.95, 0.8) * pow(max(dot(R, normalize(vec3(0.6, 0.45, 0.65))), 0.0), 90.0) * 1.1;
  col += vec3(0.2, 0.35, 0.3) * pow(1.0 - max(R.y, 0.0), 3.0) * 0.5;
  // long glossy streaks running down the lane (the "fresh coat")
  float st = smoothstep(0.75, 1.0, sin(vW.z * 9.0 + sin(vW.x * 0.6) * 1.5)) * 0.18;
  col += vec3(0.8, 1.0, 0.95) * st;
  // the wet lip of the spreading edge
  col += vec3(0.7, 1.0, 0.85) * (1.0 - smoothstep(0.0, 0.25, edge - abs(vW.x - uX0))) * 0.5 * side;
  // glitter twinkles
  vec2 cell = floor(vW.xz * 2.2);
  float r = h21(cell);
  vec2 f = fract(vW.xz * 2.2) - vec2(0.5);
  float tw = pow(max(0.0, sin(uTime * (3.0 + r * 5.0) + r * 40.0)), 12.0) * step(0.8, r);
  float star = max(0.0, 1.0 - abs(f.x) * 30.0 - abs(f.y) * 3.0) + max(0.0, 1.0 - abs(f.y) * 30.0 - abs(f.x) * 3.0);
  col += vec3(1.0) * tw * star * 2.0;
  gl_FragColor = vec4(col * m, 1.0);
}`;

function buildGloss(len: number, width: number) {
  const geo = new THREE.PlaneGeometry(len, width);
  geo.rotateX(-Math.PI / 2);
  const uniforms = { uTime: { value: 0 }, uGrow: { value: 0 }, uX0: { value: 0 }, uLen: { value: len / 2 } };
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      uniforms, vertexShader: GLOSS_VS, fragmentShader: GLOSS_FS, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return { mesh, uniforms };
}

// ---------- the glazed lens: a full-screen clear coat with drips and highlights ----------

const GLAZE_VS = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const GLAZE_FS = /* glsl */ `
uniform float uK;
uniform float uDrip;
uniform float uTime;
varying vec2 vUv;
float h11(float x) { return fract(sin(x * 91.3) * 43758.5453); }
void main() {
  vec2 p = vUv;
  vec2 q = (p - 0.5) * vec2(16.0 / 9.0, 1.0);
  float a = 0.0;
  vec3 c = vec3(0.0);
  // the coat: mint haze, thicker toward the edges (a bulging wet lens)
  float rr = length(q);
  float coat = 0.1 + 0.22 * smoothstep(0.35, 0.95, rr);
  a += coat;
  c += vec3(0.75, 1.0, 0.86) * coat;
  // smeared highlights: a big curved sheen top-left and a thin one bottom-right
  float arc1 = 1.0 - smoothstep(0.0, 0.025, abs(length(q - vec2(0.25, -0.25)) - 0.62));
  arc1 *= smoothstep(0.1, 0.5, q.y + 0.35) * step(q.x, 0.2);
  float arc2 = 1.0 - smoothstep(0.0, 0.012, abs(length(q - vec2(-0.2, 0.25)) - 0.66));
  arc2 *= step(0.25, q.x) * step(q.y, -0.05);
  a += arc1 * 0.6 + arc2 * 0.5;
  c += vec3(1.0) * (arc1 * 0.6 + arc2 * 0.5);
  // drips running down from the top
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float y01 = p.y;
    float x = h11(fi + 1.0) + 0.004 * sin(y01 * 9.0 + fi * 2.0);
    float w = 0.01 + 0.014 * h11(fi + 7.0);
    float L = (0.08 + 0.26 * h11(fi + 3.0)) * uDrip;
    float y0 = 1.0 - 0.05 * h11(fi + 9.0);
    float dx = abs(p.x - x);
    float inY = step(y0 - L, p.y) * step(p.y, y0);
    float body = (1.0 - smoothstep(w * 0.6, w, dx)) * inY;
    float bulb = 1.0 - smoothstep(w * 1.2, w * 1.6, length(vec2((p.x - x) * 1.0, (p.y - (y0 - L)) * 0.56)));
    float d = max(body, bulb * step(0.02, uDrip));
    float hl = (1.0 - smoothstep(0.0, w * 0.35, abs(p.x - x + w * 0.35))) * d;
    a += d * 0.14 + hl * 0.18;
    c += vec3(0.7, 1.0, 0.85) * d * 0.1 + vec3(1.0) * hl * 0.25;
  }
  gl_FragColor = vec4(c * uK, clamp(a, 0.0, 0.9) * uK);
}`;

function buildGlaze() {
  const uniforms = { uK: { value: 0 }, uDrip: { value: 0 }, uTime: { value: 0 } };
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms, vertexShader: GLAZE_VS, fragmentShader: GLAZE_FS, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = 999;
  return { mesh, uniforms };
}

// ---------- set dressing ----------

/** RICK'S RADIALS roof sign with chase bulbs, a stack of used tires, a USED TIRES placard. */
function dressRick(car: ReturnType<typeof buildBossCar>, scene: THREE.Scene) {
  const own: { dispose(): void }[] = [];
  const signTex = (() => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#f6f6f2';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#1f7a2c';
    g.fillRect(0, 0, 256, 8);
    g.fillRect(0, 56, 256, 8);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 30px sans-serif';
    g.fillStyle = '#16161e';
    g.fillText("RICK'S", 128 + 2, 22 + 2);
    g.fillStyle = '#e8413c';
    g.fillText("RICK'S", 128, 22);
    g.font = 'bold 22px sans-serif';
    g.fillStyle = '#1f7a2c';
    g.fillText('RADIALS', 128, 46);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    own.push(t);
    return t;
  })();
  const sign = new THREE.Group();
  const roof = car.roof;
  sign.position.copy(roof.position);
  sign.position.y += 0.06;
  car.body.add(sign);
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.48, 0.1), [
    toonMat(0x1f7a2c), toonMat(0x1f7a2c), toonMat(0x1f7a2c), toonMat(0x1f7a2c),
    toonMat(0xffffff, { map: signTex }, { gloss: 0.5 }), toonMat(0xffffff, { map: signTex }, { gloss: 0.5 }),
  ]);
  board.position.y = 0.42;
  sign.add(board);
  for (const x of [-0.5, 0.5]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.2, 8), toonMat(0xd8dee8, {}, { gloss: 1 }));
    post.position.set(x, 0.1, 0);
    sign.add(post);
  }
  // chase bulbs round the board (both faces)
  const bulbs: THREE.Mesh[] = [];
  const bulbOn = new THREE.MeshBasicMaterial({ color: 0xffe27a });
  const bulbOff = new THREE.MeshBasicMaterial({ color: 0x806020 });
  own.push(bulbOn, bulbOff);
  const bg = new THREE.SphereGeometry(0.03, 8, 6);
  own.push(bg);
  for (const z of [-0.06, 0.06]) {
    for (let i = 0; i < 26; i++) {
      const u = i / 26;
      // walk the rectangle's perimeter
      const P = 2 * (1.7 + 0.48), d0 = u * P;
      let x = 0, y = 0;
      if (d0 < 1.7) (x = -0.85 + d0), (y = 0.24);
      else if (d0 < 1.7 + 0.48) (x = 0.85), (y = 0.24 - (d0 - 1.7));
      else if (d0 < 3.4 + 0.48) (x = 0.85 - (d0 - 2.18)), (y = -0.24);
      else (x = -0.85), (y = -0.24 + (d0 - 3.88));
      const b = new THREE.Mesh(bg, bulbOn);
      b.position.set(x, 0.42 + y, z);
      b.userData.noOutline = true;
      b.userData.i = i;
      sign.add(b);
      bulbs.push(b);
    }
  }
  // a stack of used tires and a placard beside the car
  const stack = new THREE.Group();
  const tg = new THREE.TorusGeometry(0.38, 0.17, 10, 22);
  own.push(tg);
  const tireM = toonMat(0x1c1a22, {}, { gloss: 0.9, shine: 60 });
  [[0, 0.17, 0], [0.05, 0.5, 0.02], [-0.04, 0.83, -0.02], [0.02, 1.16, 0.0]].forEach(([x, y, z], i) => {
    const t = new THREE.Mesh(tg, tireM);
    t.rotation.set(Math.PI / 2 + (i % 2 ? 0.05 : -0.04), 0, 0);
    t.position.set(x, y, z);
    stack.add(t);
  });
  stack.position.set(-3.6, 0, -0.9);
  scene.add(stack);
  const plac = (() => {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#ffd23f';
    g.fillRect(0, 0, 128, 64);
    g.fillStyle = '#e8413c';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 22px sans-serif';
    g.fillText('USED', 64, 20);
    g.fillStyle = '#16161e';
    g.font = 'bold 18px sans-serif';
    g.fillText('TIRES $$$', 64, 45);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    own.push(t);
    return t;
  })();
  const placard = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.48, 0.05), [
    toonMat(0xe8c030), toonMat(0xe8c030), toonMat(0xe8c030), toonMat(0xe8c030), toonMat(0xffffff, { map: plac }), toonMat(0xffffff, { map: plac }),
  ]);
  placard.position.set(0, 1.62, 0.1);
  placard.rotation.z = 0.06;
  stack.add(placard);
  const stake = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.4, 0.05), toonMat(0x8a6a3a));
  stake.position.set(0, 1.3, 0.05);
  stack.add(stake);
  return {
    stack,
    update(t: number) {
      for (const b of bulbs) b.material = (Math.floor(t * 9) + b.userData.i) % 3 === 0 ? bulbOff : bulbOn;
    },
    dispose() {
      for (const o of own) o.dispose();
    },
  };
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

interface ShotCam {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
  roll?: number;
}

type Sfx = Record<string, ((...a: unknown[]) => void) | undefined>;

export default function rick(d: Director, card: CardInfo) {
  const set = buildDragStrip(d.stage, { haze: 0x102a1c, sky: [0x123a26, 0x05070a], fogNear: 40, fogFar: 190 });
  d.crowd = set.crowd;
  d.look(0, harshJerk(0x3cff7a, 0xffc93a));
  const sx = d.sfx as unknown as Sfx;
  const sfx = (name: string, fallback: (() => void) | null, ...a: unknown[]) => {
    const f = sx[name];
    if (f) f.apply(d.sfx, a);
    else fallback?.();
  };

  // ---------- the cars ----------
  const car = d.rig(buildBossCar('rick'));
  d.scene.add(car.root);
  car.root.position.set(-0.5, 0, RICK_LANE);
  const dress = dressRick(car, d.scene);
  d.onDispose(() => dress.dispose());
  const you = d.rig(buildCar({ body: 'compact', color: '#e8413c', accent: '#f7d23e' }));
  you.root.position.set(4.2, 0, YOUR_LANE);
  d.scene.add(you.root);
  // your tyres (to gloss up), found by their rubber colour
  const tires: THREE.Mesh[] = [];
  you.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !m.userData.hull && (m.material as THREE.MeshToonMaterial).color?.getHex() === 0x1d1c22) tires.push(m);
  });
  const shinyTire = toonMat(0x262634, {}, { gloss: 1.4, shine: 140, rim: 2.4 });
  shinyTire.emissive.set(0x0c2a1c);
  d.onDispose(() => shinyTire.dispose());

  // ---------- Rick, on foot ----------
  const char = buildCharacter('rick') as RickRig;
  const rig = char;
  d.rig(char);
  const CH = 2.25;
  char.root.scale.setScalar(CH / rig.height);
  d.scene.add(char.root);
  car.root.updateWorldMatrix(true, true);
  const size = new THREE.Box3().setFromObject(car.root).getSize(new THREE.Vector3());
  const b: Boss = { car, char, size, roofY: size.y };
  rig.setTurn(1); // the smarm, start to finish
  rig.setExpression('grin');
  rig.setHandPose('R', 'grip');
  d.every((dt) => rig.setBeatDt(dt));
  const nozzle = rig.props.nozzle;
  const tooth = rig.props.tooth;
  const tireProp = rig.props.tire;

  // glossy lane + lens glaze
  const gloss = buildGloss(26, 4.2);
  gloss.mesh.position.set(4, 0.035, YOUR_LANE);
  gloss.uniforms.uX0.value = 3.2;
  d.scene.add(gloss.mesh);
  const glaze = buildGlaze();
  d.scene.add(glaze.mesh);
  d.onDispose(() => {
    for (const m of [gloss.mesh, glaze.mesh]) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
  });

  // ---------- timeline (real seconds) ----------
  const DING = 0.32; // the gold tooth twinkles in the opening close-up
  const PITCH = 0.85; // whip out: the sales pitch
  const TIRE = 2.25; // the bald tire
  const FLAT = 3.05; // pffft
  const SOLD = 3.45; // tossed: SOLD!
  const GLOSSY = 3.85; // low on YOUR tyres: rattle + spray
  const LANE = 4.95; // sweeping YOUR lane
  const TURN = 6.05; // turns on us
  const SPRAY = 6.55; // slow-mo, straight at the lens
  const GLAZE = 6.95; // the lens glazes over
  const REFUND = 7.35; // NO REFUNDS.
  const CARD = 8.1;

  d.bars(true);
  d.at(0, () => {
    d.hype = 0.6;
    d.sfx.roar('rick');
  });

  // where Rick stands per beat (cuts hide the jumps)
  const POS_PITCH = V(-1.2, 0, -0.2);
  const POS_SPRAY = V(1.55, 0, 3.75);
  const st = { aimK: 0, aim: new THREE.Vector3(), yaw: 0, spray: 0, sprayV: 9, flung: false };
  char.root.position.copy(POS_PITCH);

  // A: DING. Extreme close-up on the grin; the gold tooth twinkles.
  d.at(DING, () => {
    rig.setGlint(1);
    sfx('ding', () => d.sfx.tink());
    d.cam.punch(-2.5);
  });
  d.at(DING + 0.42, () => rig.setGlint(0));
  d.span(DING, DING + 0.4, (u) => {
    if (u > 0 && u < 0.6 && Math.random() < 0.5) d.sparkle(Director.wp(tooth), 22, '#ffffff');
  });

  // B: PITCH. Whip out, arms flung wide: "HAVE I GOT A DEAL FOR YOU!"
  d.at(PITCH, () => {
    rig.setPitch(1);
    d.sfx.voice('rick', 'laugh');
    d.sfx.whoosh();
    d.hype = 0.9;
  });
  d.stamp(PITCH + 0.2, 'HAVE I GOT A DEAL\nFOR YOU!', { color: '#5cff8a', x: 222, y: 92, size: 16, rot: -0.07, dur: 1.15 });
  d.at(TIRE - 0.35, () => rig.setPitch(0));

  // C: the bald tire, held up with a wink. Pffft. Tossed. SOLD!
  d.at(TIRE - 0.2, () => {
    rig.setTire(1);
    rig.setPresent(1);
  });
  d.at(TIRE + 0.25, () => {
    rig.setWink(1);
    sfx('ding', () => d.sfx.tink());
    rig.setGlint(1);
  });
  d.at(TIRE + 0.55, () => rig.setGlint(0));
  d.stamp(TIRE + 0.3, 'LIKE NEW!', { color: '#ffd23f', x: 470, y: 86, size: 16, rot: 0.1, dur: 0.75, burst: '#e8413c' });
  d.at(FLAT, () => {
    rig.setWink(0);
    rig.setFlat(1);
    sfx('deflate', () => d.sfx.whoosh());
  });
  d.stamp(FLAT + 0.05, 'pfffft...', { color: '#ffffff', x: 420, y: 250, size: 8, rot: -0.1, dur: 0.45 });
  d.at(SOLD - 0.05, () => {
    // toss it over his shoulder
    rig.setPresent(0);
    const p = Director.wp(tireProp);
    const q = tireProp.getWorldQuaternion(new THREE.Quaternion());
    d.scene.attach(tireProp);
    tireProp.position.copy(p);
    tireProp.quaternion.copy(q);
    st.flung = true;
    d.fling(tireProp, SOLD - 0.05, [-2.5, 5.5, -3.5], [3, 6, 1], 9.8, 0.35);
  });
  d.at(SOLD, () => {
    sfx('kaching', () => d.sfx.tink());
    d.sfx.impact();
    d.cam.punch(-4);
    d.cam.shake(0.3);
  });
  d.stamp(SOLD, 'SOLD!', { color: '#e8413c', x: 170, y: 240, size: 24, rot: -0.12, dur: 0.55, burst: '#ffd23f' });

  // D: YOUR tyres. Rattle the can, then gloss them up.
  d.at(GLOSSY - 0.05, () => {
    char.root.position.copy(POS_SPRAY);
    rig.setShake(1);
    sfx('canRattle', null);
    d.sfx.voice('rick', 'laugh');
  });
  d.stamp(GLOSSY + 0.05, 'k-tak k-tak', { color: '#ffffff', x: 470, y: 70, size: 8, rot: 0.12, dur: 0.4 });
  d.at(GLOSSY + 0.35, () => {
    rig.setShake(0);
    rig.setSpray(1);
    st.spray = 1;
    sfx('spray', () => d.sfx.squirt(LANE + 0.9 - GLOSSY), LANE + 0.9 - GLOSSY);
  });
  d.stamp(GLOSSY + 0.45, 'PSSSHHHH', { color: '#bfffe0', x: 180, y: 70, size: 16, rot: -0.1, dur: 0.6 });
  // tyre target: your rear wheel on the camera side, then the front
  const wheelW = (i: number) => (tires.length ? Director.wp(tires[Math.min(i, tires.length - 1)]) : V(3, 0.4, YOUR_LANE + 1));
  const rearT = () => {
    // nearest-to-Rick tyre on the camera side (largest z, smallest x)
    let best = tires[0];
    for (const t of tires) {
      const p = Director.wp(t), q = Director.wp(best);
      if (p.z > q.z + 0.3 || (Math.abs(p.z - q.z) < 0.3 && p.x < q.x)) best = t;
    }
    return best;
  };
  let target = new THREE.Vector3();
  d.span(GLOSSY, LANE, (u) => {
    st.aimK = 1;
    const tw = tires.length ? Director.wp(rearT()) : wheelW(0);
    target.copy(tw).add(V(Math.sin(u * 25) * 0.25, 0.1 + Math.cos(u * 19) * 0.15, 0.2));
    st.sprayV = 7;
  });
  d.at(GLOSSY + 0.6, () => {
    for (const t of tires) t.material = shinyTire;
    d.sfx.sparkle();
  });
  d.span(GLOSSY + 0.6, LANE + 1.0, (u) => {
    if (u < 1 && Math.random() < 0.35) {
      const t = tires[Math.floor(Math.random() * tires.length)];
      if (t) d.sparkle(Director.wp(t).add(V(rand(-0.3, 0.3), rand(-0.2, 0.3), 0.25)), rand(10, 20), '#ffffff');
    }
  });
  // E: YOUR lane. Sweep it into a mirror. SLICK DEAL!
  d.span(LANE, TURN - 0.1, (u) => {
    const x = lerp(1.0, 9.5, easeInOut(u)) + Math.sin(u * 30) * 0.3;
    target.set(x, 0, YOUR_LANE + Math.sin(u * 17) * 1.0);
    st.sprayV = 9;
  });
  d.stamp(LANE + 0.45, 'SLICK DEAL!', { color: '#ffd23f', x: 330, y: 96, size: 24, rot: -0.08, dur: 0.95, burst: '#1f9a3a' });
  d.at(LANE + 0.45, () => {
    d.sfx.impact();
    d.cam.punch(-3);
    d.hype = 1;
  });
  // your car squirms on it
  d.span(LANE + 0.4, TURN, (u) => {
    you.root.rotation.y = Math.sin(u * Math.PI * 3) * 0.12 * (1 - u * 0.5);
    you.root.position.z = YOUR_LANE + Math.sin(u * Math.PI * 2) * 0.25;
    you.setWheelSpin(u < 1 ? 14 * Math.sin(u * 9) : 0);
  });
  d.at(TURN - 0.1, () => {
    st.spray = 0;
    rig.setSpray(0);
    st.aimK = 0;
  });

  // F: turns on us. Slow-mo: SPRAY at the lens. It glazes over.
  d.at(TURN, () => {
    char.root.position.copy(POS_PITCH).add(V(0.4, 0, 0.6));
    rig.setShake(1);
    d.sfx.signature('rick'); // rattle, hiss (the spray) and the DING (the glint after NO REFUNDS)
    rig.setWink(0);
  });
  d.at(TURN + 0.3, () => rig.setGlint(1));
  d.at(TURN + 0.55, () => rig.setGlint(0));
  d.slowmo(SPRAY - 0.1, GLAZE + 0.12, 0.16, 0.14);
  d.at(SPRAY - 0.05, () => {
    rig.setShake(0);
    rig.setSpray(1);
    st.spray = 0.8;
    st.aimK = 1;
    st.sprayV = 6;
  });
  d.span(SPRAY - 0.05, GLAZE, () => {
    // dead at the lens
    target.copy(d.stage.camera.position);
  });
  d.at(GLAZE, () => {
    d.sfx.splat();
    d.cam.shake(0.45);
    d.cam.punch(-5);
  });
  d.lensSplat(GLAZE, 'rgba(190,255,215,0.42)', '#ffffff');
    d.span(GLAZE, CARD + 3, (u) => {
    const t = d.t;
    glaze.uniforms.uK.value = t < REFUND + 0.4 ? easeOut(seg(t, GLAZE, GLAZE + 0.08)) : lerp(1, 0, easeInOut(seg(t, REFUND + 0.4, CARD + 0.15)));
    glaze.uniforms.uDrip.value = easeOut(seg(t, GLAZE + 0.05, CARD));
    if (u >= 1) glaze.uniforms.uK.value = 0;
  });
  d.at(GLAZE + 0.12, () => {
    st.spray = 0;
    rig.setSpray(0);
    st.aimK = 0;
  });
  // G: NO REFUNDS. (and that DING)
  d.impactFrame(REFUND, 'invert', 2);
  d.at(REFUND, () => {
    d.sfx.impact();
    d.cam.shake(0.6);
    d.cam.punch(-6);
    rig.setGun(1);
    rig.setWink(1);
  });
  d.stamp(REFUND, 'NO REFUNDS.', { color: '#ff3b3b', x: 300, y: 258, size: 24, rot: -0.1, dur: 1.0, burst: '#ffd23f' });
  d.at(REFUND + 0.45, () => rig.setGlint(1));
  d.at(REFUND + 0.85, () => rig.setGlint(0));
  d.span(REFUND + 0.45, REFUND + 0.8, (u) => {
    if (u < 1 && Math.random() < 0.5) d.sparkle(Director.wp(tooth), 20);
  });

  // H: the card. Finger gun, wink, grin.
  d.freeze(CARD, 0.25, 0.6);
  d.nameCard(CARD, { ...card, color: '#14301c', accent: '#5cff8a', layout: 'left' }, 1.1, 'rick');
  d.at(CARD + 0.7, () => {
    d.sfx.voice('rick', 'taunt');
    rig.setWink(0);
  });
  d.span(CARD + 0.7, CARD + 1.9, (u) => rig.setTalk(u >= 1 ? 0 : Math.abs(Math.sin(d.t * 15))));
  d.at(CARD + 2.0, () => rig.setWink(1));

  // ---------- camera ----------
  const shots: { t0: number; t1: number; fn: (u: number) => ShotCam }[] = [];
  const shot = (t0: number, t1: number, fn: (u: number) => ShotCam) => shots.push({ t0, t1, fn });
  // A: ECU on the grin, slightly low, a slow push
  shot(0, PITCH, (u) => {
    const tp = Director.wp(tooth);
    const h = headPos(b);
    const pos = h.clone().add(V(0.3, -0.4, 2.0 - 0.25 * easeOut(u)));
    const look = tp.clone().lerp(h, 0.25);
    return { pos, look, fov: 34, roll: lerp(-0.08, -0.03, u) };
  });
  // B: wide-ish low on Rick by his car, pushing in (he's on the left, his car + sign behind)
  shot(PITCH, TIRE, (u) => {
    const k = easeOut(u);
    const pos = V(lerp(0.6, 0.2, k), lerp(1.3, 1.6, k), lerp(4.9, 4.1, k));
    return { pos, look: frameHead(b, pos, 46, 0.56, 0.36), fov: 46, roll: lerp(0.06, 0.02, u) };
  });
  // C: medium on the tire, from his right
  shot(TIRE, GLOSSY - 0.05, (u) => {
    const k = easeOut(u);
    const pos = V(lerp(0.4, 0.1, k), lerp(1.9, 2.0, k), lerp(4.2, 3.8, k));
    return { pos, look: frameHead(b, pos, 44, 0.42, 0.34), fov: 44, roll: lerp(-0.04, 0.03, u) };
  });
  // D: low at your rear tyre, Rick looming behind with the can
  shot(GLOSSY - 0.05, LANE, (u) => {
    const tw = tires.length ? Director.wp(rearT()) : V(3, 0.4, 3.5);
    const pos = tw.clone().add(V(lerp(-0.4, -0.6, u), 0.45, lerp(4.4, 3.9, u)));
    const look = tw.clone().lerp(headPos(b), 0.5).add(V(0, 0.05, 0));
    return { pos, look, fov: 54, roll: 0.08 };
  });
  // E: high and wide over your lane as it turns to glass
  shot(LANE, TURN, (u) => ({
    pos: V(lerp(-1.5, 0.5, u), lerp(6.8, 6.2, u), YOUR_LANE + 8.5),
    look: V(lerp(4.0, 5.0, u), 0.2, YOUR_LANE - 0.8),
    fov: 52,
    roll: lerp(-0.04, 0.02, u),
  }));
  // F: in front of Rick, low; he turns the can on us. Slow push in.
  const lensPos = (u: number) => headPos(b).add(V(lerp(0.9, 0.6, easeOut(u)), lerp(-0.9, -0.75, u), lerp(3.6, 2.6, easeOut(u))));
  shot(TURN, REFUND, (u) => {
    const pos = lensPos(u);
    return { pos, look: frameHead(b, pos, 44, lerp(0.5, 0.46, u), 0.4), fov: 44, roll: lerp(0.05, -0.04, u) };
  });
  // G + card: right third, head in the upper half
  shot(REFUND, CARD + 8, (u) => {
    const k = easeOut(seg(u, 0, 0.12));
    const pos = headPos(b).add(V(lerp(0.6, 1.3, k), lerp(-0.75, -0.95, k), lerp(2.6, 4.6, k)));
    return { pos, look: frameHead(b, pos, 44, lerp(0.46, 0.7, k), lerp(0.4, 0.34, k)), fov: 44, roll: lerp(-0.04, 0.05, k) };
  });

  // ---------- arms: aim the right arm (and so the can) at the target ----------
  const restQ = new WeakMap<THREE.Object3D, THREE.Quaternion>();
  const _a = new THREE.Vector3(), _h = new THREE.Vector3(), _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
  function aimArm(arm: THREE.Object3D, hand: THREE.Object3D, tgt: THREE.Vector3, k: number) {
    let r = restQ.get(arm);
    if (!r) restQ.set(arm, (r = arm.quaternion.clone()));
    arm.quaternion.copy(r);
    if (k <= 0.001) return;
    arm.updateWorldMatrix(true, true);
    arm.getWorldPosition(_a);
    hand.getWorldPosition(_h);
    const d0 = _h.sub(_a).normalize();
    const d1 = tgt.clone().sub(_a).normalize();
    arm.parent!.getWorldQuaternion(_pq);
    _q.setFromUnitVectors(d0, d1);
    _q2.copy(_pq).invert().multiply(_q).multiply(_pq).multiply(r);
    arm.quaternion.slerp(_q2, k);
  }
  const handR = rig.props.handR;
  let armK = 0;
  const up0 = rig.update.bind(rig);
  rig.update = (dt: number) => {
    up0(dt);
    aimArm(char.armR, handR, target, armK);
  };

  // ---------- per frame ----------
  const mist = rate(70);
  const glit = rate(40);
  const nozW = new THREE.Vector3();
  const dir = new THREE.Vector3();
  d.every((dt, wdt) => {
    const t = d.t;
    const w = d.wt;
    dress.update(w);
    car.setLean(Math.sin(w * 2.2) * 0.01, 0);
    armK += ((st.aimK ? 1 : 0) - armK) * Math.min(1, dt * 14);
    // Rick turns toward what he's spraying (or the camera)
    const cam = d.stage.camera.position;
    let yawT: number;
    if (st.aimK && t < TURN) yawT = Math.atan2(target.x - char.root.position.x, target.z - char.root.position.z) * 0.75;
    else yawT = Math.atan2(cam.x - char.root.position.x, cam.z - char.root.position.z) * 0.85;
    st.yaw += (yawT - st.yaw) * Math.min(1, dt * 12);
    char.root.rotation.y = st.yaw;
    // the spray
    if (st.spray > 0) {
      nozzle.getWorldPosition(nozW);
      dir.copy(target).sub(nozW).normalize();
      const n = mist(wdt, st.spray);
      for (let i = 0; i < n; i++)
        d.fx.dust(nozW, 1, {
          color: 0xd8fff0, size: rand(0.08, 0.16), grow: 3.5, life: rand(0.35, 0.6), drag: 2.2, gravity: 0.3, spread: 0.7,
          vel: { x: dir.x * st.sprayV, y: dir.y * st.sprayV, z: dir.z * st.sprayV },
        });
      const g = glit(wdt, st.spray);
      for (let i = 0; i < g; i++)
        d.fx.sparks(nozW, 1, {
          color: Math.random() < 0.5 ? 0xffffff : 0xbfffd8, size: 0.035, life: 0.5, gravity: 1, spread: 1.2, stretch: 0.02,
          vel: { x: dir.x * st.sprayV * 1.1, y: dir.y * st.sprayV * 1.1, z: dir.z * st.sprayV * 1.1 },
        });
    }
    // your lane turns to glass
    gloss.uniforms.uTime.value = w;
    gloss.uniforms.uGrow.value = easeOut(seg(t, LANE - 0.05, TURN + 0.2)) * 1.05;
    glaze.uniforms.uTime.value = t;
    if (st.flung) tireProp.rotation.z += wdt * 4;
    // smarm stays real-time through the slow-mo
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
