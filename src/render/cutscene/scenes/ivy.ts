// IRON VISE IVY (final boss): a hulking metalworker and arm-wrestling champ, a jerk from the first frame.
// Darkness, then a welding arc: sparks pour down the lens as she welds fresh teeth onto her vise gauntlet, mask down.
// CLANK: she flips the mask up (the stadium slams on behind her), already sneering at you. Then she shows off: a
// gold trophy in the vise, crushed flat ("SQUEEZE."); a car door, crunched into a wafer ("TIGHTER."). And every crush,
// the frame itself gets squeezed: the letterbox is a pair of steel vise jaws that clank in a notch tighter each time
// (her modifier, The Squeeze, made visual). She cracks her knuckles at you, one by one. Then the big one: a tiny toy
// of YOUR car, held up to the lens while the jaws close the frame down to a slit around her eyes... slow-mo CRUNCH:
// wheels, glass and a "YOU" flag fly at the lens, oil splats it. The jaws SLAM open, the gunmetal muscle car's
// exposed pistons pump, the exhausts blow fire, and she holds the vise up like a title belt. Card.
import * as THREE from 'three';
import { Director, easeBack, easeInOut, easeOut, lerp, rand, seg, type CardInfo } from '../director';
import { buildBossCar, buildCharacter } from '../models';
import type { CarRigX } from '../models/car';
import type { IvyRig } from '../models/ivy';
import { VISE_OPEN, VISE_SHUT } from '../models/ivy';
import { buildCarDoor, buildToyCar, buildTorch, buildTrophy, type Crushable } from '../models/ivy_props';
import { Kit, outlineTree } from '../models/kit';
import { buildDragStrip, glowSprite, glowTexture } from '../stage';
import { cutsceneSfx } from '../sfx';
import { carLocal, exhaustPoints, faceCam, harshJerk, headPos, headR, mixLook, mountBoss, rate } from './common';

const LANE = -2.6;
const ORANGE = 0xff8a1f;

/** Deterministic 0..1 noise (screenshots at a given t look the same every time). */
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * The frame vise: two steel jaws drawn straight in clip space over the 3D frame (under the 2D overlay), each
 * covering `c` of the screen height from its edge: a gunmetal plate with bolts and brushed lines, an orange/black
 * hazard band, a knurled face and a row of teeth along the bite, inked edges and an orange-hot glow when `heat`.
 */
function buildFrameVise() {
  const col = (h: number) => new THREE.Color(h);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uC: { value: 0 },
      uHeat: { value: 0 },
      uAspect: { value: 16 / 9 },
      uSteel: { value: col(0x5a5f6a) },
      uSteelD: { value: col(0x2a2d34) },
      uSteelL: { value: col(0xaab2c0) },
      uOrange: { value: col(ORANGE) },
      uInk: { value: col(0x140a1e) },
    },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uC, uHeat, uAspect; uniform vec3 uSteel, uSteelD, uSteelL, uOrange, uInk;
      varying vec2 vUv;
      float h1(float n){ return fract(sin(n * 127.1 + 311.7) * 43758.5453); }
      void main(){
        if (uC < 0.002) discard;
        bool top = vUv.y > 0.5;
        float e = top ? 1.0 - vUv.y : vUv.y;          // distance from the screen edge (screen heights)
        float x = vUv.x * uAspect + (top ? 0.0 : 0.0375); // the bottom row of teeth meshes between the top's
        float per = 0.075;
        float f = fract(x / per);
        float tri = abs(f - 0.5) * 2.0;                 // 1 at the tooth gaps, 0 at the points
        float tooth = 0.024 * (1.0 - tri);
        float edge = uC + tooth;
        if (e > edge) discard;
        float d0 = uC - e;                               // depth past the tooth roots (<0 inside a tooth)
        vec3 c;
        if (d0 < 0.0) {
          c = mix(uSteelL, uSteel, f < 0.5 ? 0.15 : 0.65);  // two-tone faceted teeth
        } else if (d0 < 0.028) {
          float a = step(0.5, fract((x + d0) * 55.0)), b = step(0.5, fract((x - d0) * 55.0));
          c = mix(uSteelD, uSteelL * 0.8, abs(a - b));    // diamond knurl
        } else if (d0 < 0.062) {
          c = fract((x + (top ? d0 : -d0)) * 9.0) < 0.5 ? uOrange : uInk; // hazard band
        } else {
          float g = clamp((d0 - 0.062) * 3.0, 0.0, 1.0);
          c = mix(uSteel * 1.15, uSteelD, g);
          c *= 0.93 + 0.07 * h1(floor(e * 420.0));        // brushed
          c += uSteelL * 0.18 * smoothstep(0.012, 0.0, abs(d0 - 0.075)); // a chamfer highlight under the band
          // bolts along the plate
          vec2 bp = vec2(fract(x / 0.32) - 0.5, (d0 - 0.1) / 0.32 * (top ? 1.0 : 1.0));
          float r = length(bp);
          if (d0 > 0.08 && r < 0.06) c = r > 0.045 ? uInk : mix(uSteelL, uSteel, smoothstep(0.0, 0.04, r + bp.y * 0.6));
        }
        // ink lines: the bite edge and the band seams
        float dist = edge - e;
        if (dist < 0.005) c = uInk;
        if (abs(d0) < 0.002 || abs(d0 - 0.028) < 0.0016 || abs(d0 - 0.062) < 0.002) c = mix(c, uInk, 0.8);
        // orange-hot bite
        c += uOrange * uHeat * 2.0 * exp(-dist * 60.0);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1000;
  return {
    mesh,
    set(c: number, heat: number) {
      mat.uniforms.uC.value = Math.max(0, c);
      mat.uniforms.uHeat.value = heat;
    },
  };
}

/** Exposed V8 through the hood: a block, two banks of four chrome cylinders with pumping pistons, an orange blower. */
function buildEngine(body: THREE.Group) {
  const kit = new Kit();
  const g = new THREE.Group();
  g.position.set(1.15, 0.98, 0);
  body.add(g);
  const chrome = kit.toon(0xe2e7ee, { gloss: 1, shine: 110 });
  const dark = kit.toon(0x24262c, { gloss: 0.5 });
  const orange = kit.toon(ORANGE, { gloss: 0.8, shine: 80 });
  const block = kit.box(0.82, 0.18, 0.62, dark, 0.02);
  block.position.y = 0.04;
  g.add(block);
  const pistons: { p: THREE.Object3D; ph: number }[] = [];
  for (let i = 0; i < 4; i++)
    for (const s of [-1, 1]) {
      const c = new THREE.Group();
      c.position.set(-0.3 + i * 0.2, 0.1, s * 0.15);
      c.rotation.x = s * 0.5;
      g.add(c);
      const sleeve = kit.cyl(0.075, 0.08, 0.24, orange, 14, 0.014);
      sleeve.position.y = 0.12;
      c.add(sleeve);
      const ring = kit.cyl(0.085, 0.085, 0.03, chrome, 14, 0.01);
      ring.position.y = 0.24;
      c.add(ring);
      const p = new THREE.Group();
      c.add(p);
      const rod = kit.cyl(0.025, 0.025, 0.2, chrome, 10, 0.008);
      rod.position.y = 0.22;
      p.add(rod);
      const crown = kit.cyl(0.07, 0.07, 0.07, chrome, 14, 0.012);
      crown.position.y = 0.33;
      p.add(crown);
      pistons.push({ p, ph: i * 1.7 + (s > 0 ? 0 : Math.PI) });
    }
  const blower = kit.box(0.5, 0.16, 0.26, orange, 0.02);
  blower.position.y = 0.36;
  g.add(blower);
  const scoop = kit.box(0.26, 0.14, 0.24, chrome, 0.016);
  scoop.position.set(0.0, 0.5, 0);
  g.add(scoop);
  const mouth = kit.box(0.02, 0.09, 0.18, 0x0c0c10, 0);
  mouth.position.set(0.135, 0.5, 0);
  g.add(mouth);
  // headers: orange pipes swooping down the flank
  for (let i = 0; i < 4; i++) {
    const p = kit.mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 12, Math.PI * 0.6), orange, 0.01);
    p.position.set(-0.3 + i * 0.2, -0.02, 0.38);
    p.rotation.set(0, Math.PI / 2, -0.4);
    g.add(p);
  }
  outlineTree(g, kit.outlineMat);
  return {
    update(t: number, rev: number) {
      for (const { p, ph } of pistons) p.position.y = 0.05 * (0.4 + rev) * Math.sin(t * (6 + 30 * rev) + ph);
      g.position.y = 0.98 + Math.sin(t * 47) * 0.006 * rev;
    },
    dispose() {
      kit.dispose();
    },
  };
}

/** Arm / torso / head pose on the outer pivots, plus elbow bends (radians). */
interface Pose {
  lx: number; // armL forward raise (negative = forward/up)
  lz: number; // armL sideways (positive = out to her left)
  rx: number;
  rz: number; // armR (positive = across the body)
  lb: number; // left elbow extra bend
  rb: number; // right elbow extra bend
  lbz: number; // left elbow sideways swing (+ with the arm out = forearm up: the bicep flex)
  tx: number; // torso pitch
  ty: number; // torso yaw
  hx: number; // head pitch (down +)
  hy: number; // head yaw
  hz: number; // head tilt
}
const P = (lx: number, lz: number, rx: number, rz: number, lb = 0, rb = 0, tx = 0, ty = 0, hx = 0, hy = 0, hz = 0, lbz = 0): Pose => ({ lx, lz, rx, rz, lb, rb, lbz, tx, ty, hx, hy, hz });

export default function ivy(d: Director, card: CardInfo) {
  // ---------- set + light ----------
  const set = buildDragStrip(d.stage, { haze: 0x0a0604, sky: [0x140804, 0x020102], fogNear: 2, fogFar: 30, dark: true });
  d.crowd = set.crowd;
  d.hype = 0.2;
  set.power(() => false);
  const fog = d.stage.scene.fog as THREE.Fog;
  const bg = d.stage.scene.background as THREE.Color;
  // looks: the arc-lit dark (cold blue key off the arc, orange rim); the foundry jerk light; the hero blaze
  const ARC = harshJerk(0x5aa8ff, 0xff8a1f);
  ARC.exposure = 0.85;
  ARC.vignette = 0.9;
  const JERK = harshJerk(ORANGE, 0xffe0b0);
  const HERO = harshJerk(ORANGE, 0xffb040);
  HERO.bloom = 1.2;
  const TIGHT = mixLook(JERK, ARC, 0.35);
  d.look(0, ARC);
  const rim = new THREE.PointLight(ORANGE, 0, 26, 1.2);
  rim.position.set(-1, 4, LANE - 4);
  d.scene.add(rim);
  const arcLight = new THREE.PointLight(0xa8d4ff, 0, 9, 1.4);
  d.scene.add(arcLight);

  // ---------- Ivy in her gunmetal muscle car (exposed V8 through the hood) ----------
  const carRig = buildBossCar('ivy') as CarRigX;
  const b = mountBoss(d, carRig, buildCharacter('ivy'), 2.5);
  const car = b.car.root;
  car.position.set(0, 0, LANE);
  const engine = buildEngine(carRig.body);
  d.onDispose(() => engine.dispose());
  const rig = b.char as unknown as IvyRig;
  const head = b.char.head;
  const torso = rig.torso;
  b.char.root.position.y += 0.32; // up out of the window so the vise clears the door
  const R = headR(b);
  const armL0 = b.char.armL.rotation.clone();
  const armR0 = b.char.armR.rotation.clone();
  const torso0 = torso.rotation.clone();
  const head0 = head.rotation.clone();
  rig.setTurn(1);
  b.char.setExpression('smirk');
  rig.setMask(1);
  rig.setVise(0);
  d.every((dt) => rig.setBeatDt(dt));

  // the welding torch in her left fist
  const torch = buildTorch();
  rig.props.gripL.add(torch.root);
  torch.root.scale.setScalar(1.3);
  rig.setHandPose('L', 'grip');
  d.onDispose(() => torch.dispose());

  // the crushables (only one in the vise at a time; the cuts hide the swaps)
  const trophy = buildTrophy();
  const door = buildCarDoor();
  const toy = buildToyCar();
  for (const c of [trophy, door, toy]) {
    c.root.visible = false;
    rig.props.viseGrip.add(c.root);
    c.root.rotation.x = Math.PI; // +Y along the jaws (up when the forearm is raised), +Z toward the lens
    d.onDispose(() => c.dispose());
  }
  /** Squash `c` to the current jaw gap. */
  const crushed = new Map<Crushable, number>();
  const squeeze = (c: Crushable) => {
    const gap = rig.viseGap();
    const w = c.width * c.root.scale.x;
    const k = Math.max(crushed.get(c) ?? 0, Math.min(1, (1 - Math.min(1, gap / w)) / 0.88)); // metal stays crushed
    crushed.set(c, k);
    c.crush(k);
  };
  /** Vise value whose gap equals `w` (contact with something `w` wide). */
  const viseFor = (w: number) => (VISE_OPEN - w) / (VISE_OPEN - VISE_SHUT);
  toy.root.scale.setScalar(1.15);

  // ---------- the frame vise (the letterbox IS her vise) ----------
  const fv = buildFrameVise();
  d.scene.add(fv.mesh);
  let frameC = 0.1;
  let frameHeat = 0;

  // ---------- timeline ----------
  const FLIP = 1.3; // mask up
  const TROPHY = 1.95; // cut: trophy in the vise
  const T_BITE = 2.3; // jaws touch it
  const T_CRUNCH = 2.6;
  const DOOR = 3.0;
  const D_BITE = 3.25;
  const D_CRUNCH = 3.5;
  const KNUCK = 4.0;
  const TOY = 5.0;
  const SLIT = 6.0; // the frame is a slit around her eyes
  const BITE = 6.25; // slow-mo bite
  const CRUNCH = 6.55;
  const HERO_T = 7.45; // jaws slam open
  const POSE_T = 7.92; // cut from the engine insert to the hero frame
  const CARD = 8.55;

  // ---------- poses ----------
  const WELD = P(-1.25, -0.55, -1.1, 0.35, 0.55, 1.15, 0.12, 0, 0.3, 0.05, 0);
  const FLIPP = P(-2.3, 0.1, -1.0, 0.35, 1.25, 1.1, -0.06, 0, -0.12, 0, 0.05);
  const SHOW = P(-0.2, 0.05, -1.25, 0.25, 0.1, 1.25, 0, 0.12, -0.06, 0.12, 0.08);
  const FIST = P(-1.6, -0.35, -0.3, 0.05, 0.95, 0.5, 0.05, -0.15, -0.04, -0.15, -0.06);
  const TOYP = P(-0.3, 0.05, -1.45, 0.42, 0.1, 1.35, 0.08, 0.15, 0.0, 0.18, 0.04);
  // hero: the left arm up in a bicep flex, the open vise thrust at the lens ("you're next")
  const RAISE = P(0.0, 1.35, -1.45, 0.35, -0.25, 0.15, -0.04, 0.15, 0.08, 0.2, 0.08, 1.65);
  const keys: [number, Pose][] = [
    [0, WELD], [FLIP - 0.12, WELD], [FLIP + 0.05, FLIPP], [FLIP + 0.5, FLIPP], [TROPHY, SHOW], [KNUCK - 0.12, SHOW], [KNUCK + 0.1, FIST],
    [TOY - 0.1, FIST], [TOY + 0.05, TOYP], [POSE_T - 0.25, TOYP], [POSE_T - 0.05, RAISE],
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
  // little extra layers: neck crack snaps, knuckle jolts
  let headSnapZ = 0;
  let jolt = 0;
  d.every(() => {
    evalPose(d.t);
    b.char.armL.rotation.set(armL0.x + pose.lx, armL0.y, armL0.z + pose.lz);
    b.char.armR.rotation.set(armR0.x + pose.rx, armR0.y, armR0.z + pose.rz);
    rig.setArmBend('L', pose.lb, pose.lbz);
    rig.setArmBend('R', pose.rb);
    torso.rotation.set(torso0.x + pose.tx, torso0.y + pose.ty, torso0.z + jolt * 0.04);
    head.rotation.set(head0.x + pose.hx, head0.y + pose.hy, head0.z + pose.hz + headSnapZ);
  });

  /** Character-relative camera (see faceCam), as a follow() frame. */
  const fc = (dist: number, yaw: number, up: number, lookUp: number, fov: number, roll = 0) => ({ ...faceCam(b, dist, yaw, up, lookUp), fov, roll });
  const H = new THREE.Vector3();
  const vp = new THREE.Vector3();
  const visePos = () => Director.wp(rig.props.viseGrip, vp);

  // =====================================================================================
  // 0: darkness. A welding arc. Sparks pour at the lens; the mask is down.
  // =====================================================================================
  let arc = 1;
  const torchTip = new THREE.Vector3();
  const arcSpr = glowSprite(glowTexture(), 0xd8ecff, 1.2, 0);
  (arcSpr.material as THREE.SpriteMaterial).depthTest = false;
  arcSpr.renderOrder = 30;
  d.scene.add(arcSpr);
  const arcCore = glowSprite(glowTexture(), 0xffffff, 0.35, 0);
  (arcCore.material as THREE.SpriteMaterial).depthTest = false;
  arcCore.renderOrder = 31;
  d.scene.add(arcCore);
  const sparks = rate(90);
  d.follow(0, 0.62, (u) => {
    // low and tight on the arc, the mask looming over it
    Director.wp(torch.tip, torchTip);
    headPos(b, H);
    const look = torchTip.clone().lerp(H, 0.3);
    const f = faceCam(b, lerp(6.2, 5.6, u), 0.5, -1.6, 0);
    return { pos: f.pos, look, fov: 30, roll: lerp(-0.12, -0.07, u) };
  });
  d.follow(0.62, FLIP, (u) => fc(lerp(5.4, 4.8, easeOut(u)), 0.3, -0.4, -0.5, 34, lerp(0.05, 0.02, u)));
  d.at(0.62, () => d.cam.punch(-3));
  d.at(0.05, () => extra('weldArc', () => d.sfx.drift(1.0), 1.2));
  d.at(0.2, () => d.sfx.roar('ivy'));
  d.bars(false);

  // =====================================================================================
  // 1.3: CLANK. Mask up; the stadium slams on behind her; already sneering.
  // =====================================================================================
  d.span(FLIP - 0.1, FLIP + 0.04, (u) => rig.setMask(1 - easeBack(u, 1.4)));
  d.at(FLIP - 0.1, () => {
    arc = 0;
    d.sfx.whoosh();
  });
  d.at(FLIP + 0.02, () => {
    extra('viseClank', () => d.sfx.pumpRack());
    d.sfx.impact();
    d.cam.punch(-7);
    d.cam.shake(0.7);
    d.flash('#ffd0a0', 0.4, 10);
    set.power(() => true);
    fog.color.setHex(0x2a1206);
    fog.near = 30;
    fog.far = 190;
    bg.setHex(0x0c0503);
    rim.intensity = 8;
    d.hype = 0.9;
    torch.root.visible = false;
    rig.setHandPose('L', 'fist');
  });
  d.look(FLIP, JERK);
  d.follow(FLIP, TROPHY, (u) => fc(lerp(5.6, 5.0, easeOut(u)), 0.15, 0.1, -0.2, 32, -0.04));
  d.at(FLIP + 0.25, () => d.sfx.voice('ivy', 'laugh'));
  d.at(FLIP + 0.2, () => (b.char.setExpression('grin'), rig.setMouth('grin')));

  // =====================================================================================
  // 1.95: the trophy. SQUEEZE.
  // =====================================================================================
  d.at(TROPHY, () => {
    trophy.root.visible = true;
    rig.setMouth(null);
    b.char.setExpression('smirk');
    d.cam.punch(-3);
  });
  const crushCam = (dist: number, side: number, fov: number) => {
    // between her face and the vise, from a little low: both the sneer and the bite in frame
    headPos(b, H);
    visePos();
    const mid = H.clone().lerp(vp, 0.55);
    const f = faceCam(b, dist, side, -0.6, 0);
    return { pos: f.pos, look: mid, fov };
  };
  d.follow(TROPHY, DOOR, (u) => ({ ...crushCam(lerp(7.5, 6.6, easeOut(u)), 0.32, 34), roll: 0.05 }));
  d.span(TROPHY, T_BITE, (u) => rig.setVise(lerp(0, viseFor(trophy.width), easeInOut(u))));
  d.span(T_BITE, T_CRUNCH, (u) => {
    rig.setVise(lerp(viseFor(trophy.width), 1, easeOut(u) * 0.97 + (u >= 1 ? 0.03 : 0)));
    squeeze(trophy);
    rig.setHeat(u);
  });
  // (the trophy keeps squeezing as long as it is in the vise)
  d.every(() => {
    if (trophy.root.visible) squeeze(trophy);
    if (door.root.visible) squeeze(door);
    if (toy.root.visible) squeeze(toy);
  });
  crunchFx(T_CRUNCH, 0xffd040, 'gold');
  d.stamp(T_CRUNCH + 0.02, 'SQUEEZE.', { color: '#ff8a1f', x: 190, y: 100, size: 24, rot: -0.1, dur: 0.8 });
  notch(T_CRUNCH, 0.1, 0.17);

  // =====================================================================================
  // 3.0: a car door. TIGHTER.
  // =====================================================================================
  d.at(DOOR, () => {
    trophy.root.visible = false;
    door.root.visible = true;
    rig.setVise(0);
    rig.setHeat(0);
    d.cam.punch(-4);
  });
  d.follow(DOOR, KNUCK, (u) => ({ ...crushCam(lerp(6.0, 5.3, easeOut(u)), -0.2, 32), roll: -0.07 }));
  d.span(DOOR, D_BITE, (u) => rig.setVise(lerp(0, viseFor(door.width), easeInOut(u))));
  d.span(D_BITE, D_CRUNCH, (u) => {
    rig.setVise(lerp(viseFor(door.width), 1, easeOut(u)));
    rig.setHeat(u);
  });
  crunchFx(D_CRUNCH, 0x9cd8ff, 'glass');
  d.stamp(D_CRUNCH + 0.02, 'TIGHTER.', { color: '#ffffff', x: 180, y: 120, size: 24, rot: 0.08, dur: 0.8 });
  notch(D_CRUNCH, 0.17, 0.24);
  d.at(D_CRUNCH + 0.15, () => b.char.setExpression('grin'));

  // =====================================================================================
  // 4.0: knuckles. One. By. One.
  // =====================================================================================
  d.at(KNUCK, () => {
    door.root.visible = false;
    rig.setVise(0.3);
    rig.setHeat(0);
    b.char.setExpression('smirk');
    rig.setHandPose('L', 'open');
  });
  // the fist in the foreground, her smirk right behind it
  d.follow(KNUCK, TOY, (u) => {
    headPos(b, H);
    const F = Director.wp(rig.props.handL, vp);
    const f = faceCam(b, lerp(5.0, 4.4, easeOut(u)), -0.42, -0.4, 0);
    return { pos: f.pos, look: F.clone().lerp(H, 0.5), fov: 34, roll: 0.05 };
  });
  for (const [i, t] of [[0, KNUCK + 0.28], [1, KNUCK + 0.48], [2, KNUCK + 0.66]] as const)
    d.at(t, () => {
      rig.setHandPose('L', i % 2 ? 'flat' : 'fist');
      jolt = i % 2 ? -1 : 1;
      const p = Director.wp(rig.props.handL);
      d.sparkle(p.add(new THREE.Vector3(rand(-0.2, 0.2), 0.25, 0.2)), 16, '#ffffff');
      d.cam.punch(-2.5);
      d.cam.shake(0.3);
      extra('knuckleCrack', () => d.sfx.tink());
    });
  d.at(KNUCK + 0.8, () => {
    rig.setHandPose('L', 'fist');
    jolt = 0;
  });
  d.stamp(KNUCK + 0.3, 'CRACK', { color: '#ffffff', x: 470, y: 120, size: 16, rot: 0.15, dur: 0.4 });
  d.stamp(KNUCK + 0.5, 'CRACK', { color: '#ffffff', x: 500, y: 150, size: 16, rot: -0.12, dur: 0.4 });
  // neck crack, both ways
  d.span(KNUCK + 0.75, KNUCK + 0.98, (u) => (headSnapZ = u < 0.5 ? 0.3 * easeOut(u * 2) : 0.3 - 0.55 * easeOut((u - 0.5) * 2)));
  d.span(KNUCK + 0.98, TOY - 0.02, (u) => (headSnapZ = -0.25 * (1 - easeInOut(u))));
  d.at(KNUCK + 0.85, () => (d.cam.shake(0.25), d.sfx.tink()));
  d.at(KNUCK + 0.97, () => (d.cam.shake(0.25), d.sfx.tink()));
  d.stamp(KNUCK + 0.86, 'CRK', { color: '#ff8a1f', x: 420, y: 90, size: 16, rot: -0.2, dur: 0.35 });
  notch(KNUCK + 0.66, 0.24, 0.29);

  // =====================================================================================
  // 5.0: the big one. A toy of YOUR car. The frame closes to a slit around her eyes. Slow-mo CRUNCH.
  // =====================================================================================
  d.at(TOY, () => {
    toy.root.visible = true;
    rig.setVise(0);
    rig.setHandPose('L', 'fist');
    d.cam.punch(-4);
    b.char.setExpression('smirk');
  });
  d.look(TOY, TIGHT, 0.6);
  // straight down the barrel: her eyes over the toy, the vise right up at the lens
  d.follow(TOY, HERO_T, (u) => {
    // aim at the eye line so the slit lands on her eyes
    Director.wp(b.char.eyes[0], H).add(Director.wp(b.char.eyes[1], H2)).multiplyScalar(0.5);
    visePos();
    const k = easeInOut(seg(u, 0, 0.4));
    const f = faceCam(b, lerp(6.0, 4.4, k), 0.14, -0.1, 0);
    const look = H.clone().lerp(vp, 0.25 + 0.15 * k);
    look.y = H.y;
    return { pos: f.pos, look, fov: lerp(36, 32, k), roll: lerp(-0.03, 0.0, k) };
  });
  d.span(TOY, BITE, (u) => rig.setVise(lerp(0, viseFor(toy.width * 1.15), easeInOut(seg(u, 0.1, 1)))));
  // the frame squeezes in, creeping, notch by notch
  d.span(TOY + 0.2, SLIT, (u) => {
    const steps = 4;
    const s = Math.min(steps, Math.floor(u * steps + 1e-6));
    const f = (u * steps) % 1;
    frameC = lerp(0.29, 0.385, (s + (u >= 1 ? 0 : easeOut(seg(f, 0, 0.25)))) / steps);
  });
  for (let i = 1; i <= 4; i++)
    d.at(TOY + 0.2 + ((SLIT - TOY - 0.2) * i) / 4 - 0.18, () => {
      d.cam.shake(0.15);
      extra('viseClank', () => d.sfx.pumpRack());
    });
  d.at(SLIT - 0.3, () => (rig.setMouth('teeth'), b.char.setExpression('smirk')));
  d.slowmo(BITE, CRUNCH + 0.5, 0.14, 0.12);
  d.span(BITE, CRUNCH, (u) => {
    rig.setVise(lerp(viseFor(toy.width * 1.15), 1, easeInOut(u)));
    rig.setHeat(u);
    frameC = lerp(0.385, 0.41, u);
    frameHeat = u;
  });
  d.at(BITE, () => extra('hydraulicHiss', () => d.sfx.squirt(0.4)));
  d.impactFrame(CRUNCH, '#ffffff', 1);
  d.impactFrame(CRUNCH + 1 / 60, '#000000', 2);
  crunchFx(CRUNCH, 0xf4ecd8, 'toy');
  d.at(CRUNCH, () => {
    d.cam.punch(6);
    d.cam.shake(1.2);
    d.sfx.crunch();
    d.sfx.impact();
    b.char.setExpression('grin');
    rig.setMouth('grin');
  });
  d.lensSplat(CRUNCH + 0.22, '#141018', '#ff8a1f');
  d.stamp(CRUNCH + 0.04, 'CRUNCH.', { color: '#ff8a1f', x: 320, y: 70, size: 24, rot: -0.06, dur: 1.0 });
  // the toy's parts fly at the lens
  const flying: { o: THREE.Object3D; v: THREE.Vector3; w: THREE.Vector3 }[] = [];
  d.at(CRUNCH, () => {
    const cam = d.stage.camera.position;
    const parts = [...toy.wheels, toy.tag];
    parts.forEach((o, i) => {
      d.scene.attach(o);
      const to = cam.clone().add(new THREE.Vector3((i - 2) * 0.5, (i % 2 ? 0.4 : -0.3), 0)).sub(Director.wp(o)).normalize();
      flying.push({ o, v: to.multiplyScalar(rand(9, 13)).add(new THREE.Vector3(0, 2, 0)), w: new THREE.Vector3(rand(-14, 14), rand(-14, 14), rand(-14, 14)) });
    });
    toy.glass.visible = false;
  });
  d.every((_dt, wdt) => {
    for (const f of flying) {
      f.v.y -= 6 * wdt;
      f.o.position.addScaledVector(f.v, wdt);
      f.o.rotation.x += f.w.x * wdt;
      f.o.rotation.y += f.w.y * wdt;
      f.o.rotation.z += f.w.z * wdt;
      f.o.scale.setScalar(f.o.scale.x || 1);
      if (f.o.position.distanceTo(d.stage.camera.position) < 0.6) f.o.visible = false;
    }
  });

  // =====================================================================================
  // 7.45: the jaws SLAM open. Pistons pump, exhausts blow fire, the vise up like a title belt.
  // =====================================================================================
  let rev = 0.15;
  d.span(HERO_T - 0.08, HERO_T + 0.05, (u) => {
    frameC = lerp(0.41, 0, easeOut(u));
    frameHeat = 1 - u;
  });
  d.impactFrame(HERO_T, '#ff8a1f', 2);
  d.at(HERO_T, () => {
    d.fx.clear();
    for (const f of flying) f.o.visible = false;
    rig.setVise(0.15);
    rig.setHeat(0.3);
    rig.setFlex(1);
    rig.setMouth(null);
    b.char.setExpression('yell');
    rev = 1;
    d.hype = 1;
    fog.color.setHex(0x3a1806);
    bg.setHex(0x140803);
    rim.intensity = 10;
    d.cam.punch(-10);
    d.cam.shake(1);
    d.sfx.roar('ivy');
    d.sfx.impact();
    extra('viseClank', () => d.sfx.pumpRack());
    d.flash('#ffd0a0', 0.4, 10);
  });
  // the crumpled toy wafer drops out of the opened jaws
  d.at(POSE_T + 0.12, () => {
    rig.setVise(0);
    d.scene.attach(toy.root);
    toy.root.visible = true;
  });
  d.fling(toy.root, POSE_T + 0.12, [0.6, 1.5, 1.4], [3, 5, 2], 9.8, 0.2);
  d.look(HERO_T, HERO);
  d.at(HERO_T + 0.45, () => b.char.setExpression('grin'));
  const heroCam = () => {
    const f = faceCam(b, 6.6, 0.25, -2.4, 0);
    const c = f.pos;
    const hp = f.look;
    const fov = 40;
    const dir = hp.clone().sub(c).normalize();
    const right = dir.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
    const up = right.clone().cross(dir).normalize();
    const dist = c.distanceTo(hp);
    const ty = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const tx = ty * (16 / 9);
    // head on the right third, upper half (clear of the left name card)
    const look = hp.clone().addScaledVector(right, -0.5 * tx * dist).addScaledVector(up, -0.3 * ty * dist);
    return { pos: c, look, fov };
  };
  // the insert: the exposed V8 going berserk, fire out of the blower
  d.follow(HERO_T, POSE_T, (u) => {
    const pos = carLocal(b, lerp(3.0, 2.75, u), lerp(1.55, 1.5, u), lerp(-1.25, -1.1, u));
    return { pos, look: carLocal(b, 1.0, 1.3, 0.1), fov: 40, roll: lerp(0.1, 0.14, u) };
  });
  const blowerFire = (t: number) =>
    d.at(t, () => {
      const p = carLocal(b, 1.15, 1.62, 0);
      for (let i = 0; i < 6; i++) d.fx.flame(p, 1, { size: rand(0.35, 0.55), spread: 0.8, life: 0.3, vel: { x: rand(-1, 1), y: 7, z: rand(-1, 1) } });
      d.cam.shake(0.35);
    });
  blowerFire(HERO_T + 0.06);
  blowerFire(HERO_T + 0.24);
  d.stamp(HERO_T + 0.05, 'VRRRM', { color: '#ff8a1f', x: 190, y: 110, size: 24, rot: -0.12, dur: 0.45 });
  d.at(POSE_T, () => {
    d.cam.punch(-6);
    d.cam.shake(0.6);
    d.sfx.impact();
    rig.setHandPose('L', 'fist');
    rig.setLook(0, -0.35);
  });
  d.follow(POSE_T, 30, (u) => {
    const h = heroCam();
    return { pos: h.pos.addScaledVector(new THREE.Vector3(0, 1, 0), lerp(-0.3, 0.2, easeOut(Math.min(1, u * 4)))), look: h.look, fov: lerp(48, 40, easeOut(Math.min(1, u * 6))), roll: 0.07 };
  });
  const backfire = (t: number, big = 1) =>
    d.at(t, () => {
      for (const p of exhaustPoints(b))
        for (let i = 0; i < 7; i++)
          d.fx.flame(p, 1, { size: rand(1.0, 1.5) * big, spread: 2.2, life: 0.3, color: [0xffd060, 0xff8a20, 0xff3a10][i % 3], vel: { x: -10, y: 1, z: 0 } });
      d.flash('#ff6a00', 0.25 * big, 14);
      d.cam.shake(0.4 * big);
    });
  backfire(HERO_T + 0.1, 0.5);
  backfire(POSE_T + 0.05, 0.7);
  backfire(POSE_T + 0.3, 0.5);
  // steam blasts off the vise rams
  d.at(POSE_T + 0.02, () => steam(14));

  // ---------- card ----------
  d.freeze(CARD, 0.25, 0.6);
  d.nameCard(CARD, { ...card, color: '#3a3e48', accent: '#ff8a1f', layout: 'left' }, 0.8, 'ivy');
  d.at(CARD + 0.7, () => d.sfx.voice('ivy', 'taunt'));

  // ---------- helpers ----------
  /** A sound the audio agent may not have added yet (see the devlog REQUESTs): falls back until it lands. */
  function extra(name: string, fallback: () => void, ...args: number[]) {
    if (name in cutsceneSfx) (d.sfx as unknown as Record<string, (...a: number[]) => void>)[name](...args);
    else fallback();
  }
  /** The frame vise clanks in from `c0` to `c1` at t (a hard bite with overshoot), plus the clank. */
  function notch(t: number, c0: number, c1: number) {
    d.span(t, t + 0.16, (u) => (frameC = lerp(c0, c1, easeBack(u, 2.6))));
    d.at(t, () => {
      extra('viseClank', () => d.sfx.pumpRack());
      d.cam.shake(0.5);
    });
  }
  function steam(n: number) {
    const p = Director.wp(rig.props.viseSteam);
    d.fx.smoke(p, n, { color: 0xf0eee8, size: 0.25, grow: 3, life: 0.7, spread: 1.2, vel: { x: rand(-2, 2), y: 2.5, z: rand(-1, 2) }, outline: false });
  }
  /** Crunch hit: hit-stop, flash, shards + chips off the vise, steam, the crunch sound. */
  function crunchFx(t: number, color: number, kind: 'gold' | 'glass' | 'toy') {
    d.impactFrame(t, kind === 'toy' ? '#ffffff' : '#000000', kind === 'toy' ? 1 : 2);
    d.at(t, () => {
      const p = visePos().clone();
      const cam = d.stage.camera.position;
      const toCam = cam.clone().sub(p).normalize();
      const n = kind === 'toy' ? 46 : 28;
      for (let i = 0; i < n; i++) {
        const v = toCam.clone().multiplyScalar(rand(4, 11)).add(new THREE.Vector3(rand(-5, 5), rand(-2, 6), rand(-5, 5)));
        d.fx.sparks(p, 1, { vel: v, color: i % 3 === 0 ? 0xffffff : color, size: rand(0.03, 0.065), life: 0.7, gravity: 10, spread: 1, stretch: 0.05 });
      }
      d.fx.sparks(p, 20, { color: ORANGE, size: 0.05, life: 0.5, spread: 7, gravity: 12 });
      if (kind === 'toy') d.fx.oil(p, 10, { size: 0.16, spread: 4, vel: toCam.clone().multiplyScalar(6) });
      if (kind !== 'toy') d.fx.glow.spawn(p, { life: 0.14, size: 0.9, color: 0xffe0b0, spread: 0, grow: 0.4 });
      steam(8);
      d.sparkle(p, 22, '#ffffff');
      d.flash('#ffe0b0', kind === 'toy' ? 0.15 : 0.25, 14);
      d.cam.punch(kind === 'toy' ? 0 : -5);
      d.cam.shake(kind === 'toy' ? 0 : 0.9);
      if (kind !== 'toy') {
        d.sfx.crunch();
        d.sfx.impact();
      }
    });
  }

  // ---------- per frame ----------
  const H2 = new THREE.Vector3();
  d.every((_dt, wdt) => {
    // the frame vise (fades to the director's own bars once the card is up)
    fv.set(d.cardAt >= 0 && d.t >= d.cardAt ? 0 : frameC, frameHeat);
    engine.update(d.wt, rev);
    if (rev > 0.5) {
      b.car.setLean(Math.sin(d.t * 37) * 0.012, -0.02 - Math.sin(d.t * 23) * 0.01);
      if (d.t > HERO_T + 0.05) rev = Math.max(0.6, rev - wdt * 0.2);
    }
    // the welding arc: strobing light, sparks pouring off the jaw at the lens
    Director.wp(torch.tip, torchTip);
    const fl = arc * (0.65 + 0.35 * hash(Math.floor(d.t * 40)));
    arcSpr.position.copy(torchTip);
    arcCore.position.copy(torchTip);
    arcSpr.scale.setScalar(R * 1.3 * fl + 0.001);
    arcCore.scale.setScalar(R * 0.35 * fl + 0.001);
    (arcSpr.material as THREE.SpriteMaterial).opacity = fl;
    (arcCore.material as THREE.SpriteMaterial).opacity = fl;
    arcLight.position.copy(torchTip);
    arcLight.intensity = 9 * fl;
    const n = sparks(wdt, arc);
    if (n) {
      const toCam = d.stage.camera.position.clone().sub(torchTip).normalize();
      for (let i = 0; i < n; i++)
        d.fx.sparks(torchTip, 1, {
          vel: toCam.clone().multiplyScalar(rand(1, 5)).add(new THREE.Vector3(rand(-3, 3), rand(0, 4), rand(-3, 3))),
          color: [0xffffff, 0xffe08a, 0xffb040][i % 3], size: rand(0.015, 0.03), life: 0.6, gravity: 9, spread: 0.6, stretch: 0.05, bounce: 0.4,
        });
    }
    if (arc > 0 && hash(Math.floor(d.t * 24) + 5) > 0.7) d.flash('#cfe6ff', 0.07, 30);
    // embers drifting up behind her once the lights are on
    if (d.t > FLIP && hash(Math.floor(d.t * 60)) < 0.35) {
      headPos(b, H2);
      const away = H2.clone().sub(d.stage.camera.position).setY(0).normalize();
      d.fx.glow.spawn(H2.clone().addScaledVector(away, rand(1.5, 4)).add(new THREE.Vector3(rand(-3, 3), rand(-2.5, 0), rand(-3, 3))), {
        life: 1.5, size: d.t > HERO_T ? 0.11 : 0.08, color: hash(d.t) < 0.5 ? ORANGE : 0xffc060, gravity: -1.5, spread: 0.6,
      });
    }
  });
}
