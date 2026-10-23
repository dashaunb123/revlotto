// DEACON DREAD (final boss): the undertaker who has already measured you for the box. A jerk from frame one.
// A dead-silent stadium drowned in fog. A funeral bell tolls twice; each toll rolls a shockwave through the fog and
// the hearse's headlights burn brighter. Cut to him out of the window, hat brim low, a candle under his chin: his head
// comes up and the hollow eyes ignite. He pinches the candle out (and a stadium bank dies with it). Tape measure:
// it zips straight into the lens, he squints, sizing you up ("PERFECT FIT."). A tombstone slams up out of the fog
// and he burns "YOU" into it with a fingertip, sparks flying, and grins. He flips an hourglass at you ("ONE
// MISTAKE.") and time crawls: an extreme close-up of the last grain of sand falling... it lands, the bell TOLLS,
// black. Only his eyes. Then the lights slam on cold white: he towers out of the hearse, skull cane raised,
// ("REST IN PIECES."). Card.
import * as THREE from 'three';
import { Director, easeBack, easeInOut, easeOut, lerp, rand, seg, type CardInfo } from '../director';
import { buildBossCar, buildCharacter } from '../models';
import type { DeaconRig } from '../models/deacon';
import { buildCandle, buildCoffin, buildHourglass, buildSkullCane, buildTapeMeasure, buildTombstone } from '../models/deacon_props';
import { Kit, outlineTree } from '../models/kit';
import { cutsceneSfx } from '../sfx';
import { buildDragStrip, glowSprite, glowTexture } from '../stage';
import { faceCam, harshJerk, headPos, headR, mixLook, mountBoss, rays } from './common';

const LANE = -2.6;
const MINT = 0x8affd8;
const BONE = '#ece6d2';

/** Deterministic 0..1 noise (screenshots at a given t look the same every time). */
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Arm / torso / head pose on the outer pivots (the rig's idle sway still plays on the inner ones). */
interface Pose {
  lx: number; // armL forward raise (negative = forward)
  lz: number; // armL sideways (positive = out to his left)
  rx: number;
  rz: number; // armR (negative = out to his right)
  tx: number; // torso pitch (+ = lean in)
  ty: number; // torso yaw
  hx: number; // head pitch (down +)
  hy: number; // head yaw
  hz: number; // head tilt
}
const P = (lx: number, lz: number, rx: number, rz: number, tx = 0, ty = 0, hx = 0, hy = 0, hz = 0): Pose => ({ lx, lz, rx, rz, tx, ty, hx, hy, hz });

export default function deacon(d: Director, card: CardInfo) {
  // ---------- set + light ----------
  const set = buildDragStrip(d.stage, { haze: 0x0a0c14, sky: [0x10121e, 0x020205], fogNear: 3, fogFar: 40, dark: true });
  d.crowd = set.crowd;
  d.hype = 0; // dead silent
  set.power(() => false);
  const fog = d.stage.scene.fog as THREE.Fog;
  const bg = d.stage.scene.background as THREE.Color;
  const fogTo = (col: number, near: number, far: number) => {
    fog.color.setHex(col);
    fog.near = near;
    fog.far = far;
  };
  // looks: a cold mint/lavender jerk light, a near-black one for the fog, a white-hot hero one
  const JERK = harshJerk(MINT, 0xb8c0ff);
  JERK.sat = 0.85;
  const DARKL = mixLook(JERK, harshJerk(0x6a80ff, 0x8affd8), 0.5);
  DARKL.exposure = 0.78;
  DARKL.vignette = 0.9;
  DARKL.sat = 0.7;
  const CANDLEL = mixLook(DARKL, harshJerk(0xffa040, MINT), 0.35);
  CANDLEL.exposure = 0.85;
  const HEROL = harshJerk(MINT, 0xffffff);
  HEROL.bloom = 0.9;
  HEROL.exposure = 0.9;
  HEROL.sat = 0.8;
  HEROL.contrast = 1.38;
  d.look(0, DARKL);
  const rim = new THREE.PointLight(0xbfe8ff, 0, 22, 1.2);
  rim.position.set(-1, 4.5, LANE - 3.5);
  d.scene.add(rim);
  const top = new THREE.PointLight(0xe8f0ff, 0, 9, 1.3); // the cold spot straight down on him
  d.scene.add(top);

  // ---------- the hearse ----------
  const carRig = buildBossCar('deacon');
  const charRig = buildCharacter('deacon') as DeaconRig;
  const b = mountBoss(d, carRig, charRig, 2.3);
  const car = carRig.root;
  car.position.set(0, 0, LANE);
  carRig.setLights(0);
  const rig = charRig;
  const head = rig.head;
  const torso = rig.torso;
  const R = headR(b);
  const armL0 = rig.armL.rotation.clone();
  const armR0 = rig.armR.rotation.clone();
  const torso0 = torso.rotation.clone();
  const head0 = head.rotation.clone();
  const root0 = rig.root.position.clone();
  rig.setTurn(1);
  rig.setExpression('smirk');
  rig.setEyeGlow(0, true);
  rig.setHat(0);
  d.every((dt) => rig.setBeatDt(dt));

  // hearse dressing: a coffin strapped on the roof, a funeral wreath on the nose, silver landau bars
  const kit = new Kit();
  d.onDispose(() => kit.dispose());
  const coffin = buildCoffin();
  d.onDispose(() => coffin.dispose());
  carRig.roof.add(coffin.root);
  coffin.root.position.set(-0.35, -0.04, -0.45);
  coffin.root.scale.setScalar(0.8);
  const deco = new THREE.Group();
  carRig.body.add(deco);
  const front = b.size.x / 2;
  {
    const green = kit.toon(0x1e3a26, { gloss: 0.2 });
    const lily = kit.toon(0xf4f2ea, { gloss: 0.4 });
    const ribbon = kit.toon(0x4a1a5a, { gloss: 0.5 });
    const w = new THREE.Group();
    w.position.set(front - 0.02, 0.55, 0);
    w.rotation.y = Math.PI / 2;
    deco.add(w);
    w.add(kit.mesh(new THREE.TorusGeometry(0.28, 0.08, 10, 24), green, 0.02));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const f = kit.ball(0.06, lily, 1, 1, 0.6, 10, 0.012);
      f.position.set(Math.cos(a) * 0.28, Math.sin(a) * 0.28, 0.07);
      w.add(f);
    }
    for (const s of [-1, 1]) {
      const tail = kit.box(0.07, 0.34, 0.02, ribbon, 0.012);
      tail.position.set(s * 0.06, -0.38, 0.05);
      tail.rotation.z = s * 0.25;
      w.add(tail);
    }
    const silver = kit.toon(0xd8dde6, { gloss: 1, shine: 90 });
    for (const z of [-1, 1]) {
      const bar = new THREE.Group();
      bar.position.set(-b.size.x * 0.28, 1.0, z * (b.size.z / 2 - 0.02));
      deco.add(bar);
      const arc = kit.mesh(new THREE.TorusGeometry(0.22, 0.025, 6, 18, Math.PI), silver, 0.012);
      arc.rotation.z = Math.PI * 0.15;
      bar.add(arc);
    }
    outlineTree(deco, kit.outlineMat);
  }
  // headlights: pale sprites + long beams cutting through the fog toward the lens
  const glowTex = glowTexture();
  const beams: { s: THREE.Sprite; beam: THREE.Mesh }[] = [];
  for (const z of [-0.55, 0.55]) {
    const s = glowSprite(glowTex, 0xe8f4ff, 1.4, 0);
    s.position.set(front + 0.05, 0.62, z);
    carRig.body.add(s);
    const bm = new THREE.Mesh(
      new THREE.ConeGeometry(2.6, 18, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
    );
    bm.rotation.z = Math.PI / 2; // apex at the lamp, opening toward +X
    bm.position.set(front + 9, 0.62, z);
    carRig.body.add(bm);
    beams.push({ s, beam: bm });
  }
  let headl = 0;
  const setHeadlights = (k: number) => {
    headl = k;
    carRig.setLights(k * 1.5);
    for (const h of beams) {
      (h.s.material as THREE.SpriteMaterial).opacity = Math.min(1, k);
      h.s.scale.setScalar(1.2 + 1.4 * k);
      (h.beam.material as THREE.MeshBasicMaterial).opacity = 0.05 * k;
    }
  };
  setHeadlights(0);

  // ---------- props ----------
  const candle = buildCandle();
  const cane = buildSkullCane();
  const tape = buildTapeMeasure();
  const glass = buildHourglass();
  const stone = buildTombstone();
  for (const p of [candle, cane, tape, glass, stone]) d.onDispose(() => p.dispose());
  const gripL = rig.props.gripL, gripR = rig.props.gripR;
  gripR.add(candle.root);
  candle.root.scale.setScalar(1.5);
  const candleLight = new THREE.PointLight(0xffa850, 0, 4, 1.4);
  candle.flame.add(candleLight);
  gripR.add(cane.root);
  cane.root.scale.setScalar(1.1);
  cane.root.visible = false;
  // cane orientations in the grip: knob up (+Y = grip +Y), or held aloft along the forearm (+Y = grip +X)
  const Q_UP = new THREE.Quaternion();
  const Q_ALOFT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2);
  gripL.add(tape.root);
  tape.root.scale.setScalar(2.0);
  tape.root.visible = false;
  const glassHold = new THREE.Group(); // the fist holds the bottom cap; flips about the grip's Z
  gripL.add(glassHold);
  glassHold.add(glass.root);
  glass.root.position.set(0.02, 0.22, 0);
  glassHold.scale.setScalar(1.7);
  glassHold.visible = false;
  d.scene.add(stone.root);
  stone.root.visible = false;
  rig.setHandPose('R', 'grip');
  rig.setHandPose('L', 'open');

  // ---------- timeline ----------
  const TOLL1 = 0.12;
  const TOLL2 = 0.82;
  const REVEAL = 1.3; // him: head bowed, candle under his chin
  const LIFT = 1.72; // the head comes up, the eyes ignite
  const SNUFF = 2.32; // the hand closes on the flame
  const TAPE = 2.72; // cut: the tape measure
  const ZIP = 2.86;
  const HITL = 3.06; // tape hook smacks the lens
  const FIT = 3.4;
  const STONE = 4.05; // tombstone slams up
  const CARVE = 4.36; // Y, O, U
  const GRIN = 5.0;
  const GLASS = 5.42; // hourglass flip at the lens
  const ONE = 5.66;
  const MACRO = 6.2; // the last grain
  const LAND = 7.3;
  const HERO = 7.62;
  const CARD = 8.55;

  // ---------- poses ----------
  const BOW = P(-0.15, 0.05, -1.05, 0.38, 0.12, 0, 0.42, 0, 0.05); // candle up under the chin, head bowed
  const RISE = P(-0.15, 0.05, -1.1, 0.4, 0.04, 0, -0.04, 0, -0.04);
  const PINCH = P(-0.5, -0.2, -0.8, 0.3, 0.06, 0.1, 0.06, -0.12, 0.08);
  const MEASURE = P(-1.5, -0.12, -1.05, -0.12, 0.12, 0.12, -0.02, 0.1, 0.1);
  const SIZEUP = P(-1.45, -0.1, -1.05, -0.12, 0.08, 0.12, -0.08, 0.12, 0.16);
  const CARVEP = P(-0.4, 0.1, -1.05, -0.12, 0.28, 0.35, 0.18, 0.35, 0.0);
  const GRINP = P(-0.4, 0.1, -1.05, -0.12, 0.2, 0.15, 0.04, -0.05, -0.1);
  const OFFER = P(-1.35, -0.42, -1.05, -0.12, 0.1, 0.05, 0.02, 0.05, 0.05);
  const HEROP = P(-0.55, 0.55, -2.75, -0.3, -0.06, -0.1, 0.1, -0.05, -0.04);
  const keys: [number, Pose][] = [
    [0, BOW], [LIFT - 0.05, BOW], [LIFT + 0.12, RISE], [SNUFF - 0.22, RISE], [SNUFF, PINCH], [TAPE - 0.001, PINCH],
    [TAPE, MEASURE], [FIT - 0.1, MEASURE], [FIT + 0.05, SIZEUP], [STONE - 0.201, SIZEUP], [STONE - 0.2, GRINP], [STONE + 0.1, CARVEP], [GRIN - 0.1, CARVEP],
    [GRIN + 0.08, GRINP], [GLASS - 0.12, GRINP], [GLASS + 0.05, OFFER], [HERO - 0.001, OFFER], [HERO, HEROP],
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
    rig.armL.rotation.set(armL0.x + pose.lx, armL0.y, armL0.z + pose.lz);
    rig.armR.rotation.set(armR0.x + pose.rx, armR0.y, armR0.z + pose.rz);
    torso.rotation.set(torso0.x + pose.tx, torso0.y + pose.ty, torso0.z);
    head.rotation.set(head0.x + pose.hx, head0.y + pose.hy, head0.z + pose.hz);
  });

  /** Character-relative camera (see faceCam), as a follow() frame. */
  const fc = (dist: number, yaw: number, up: number, lookUp: number, fov: number, roll = 0) => ({ ...faceCam(b, dist, yaw, up, lookUp), fov, roll });
  const H = new THREE.Vector3();

  // ---------- the bell ----------
  const hasBell = 'bellToll' in cutsceneSfx;
  const toll = (big = 1) => {
    if (hasBell) (d.sfx as unknown as Record<string, (k?: number) => void>).bellToll(big);
    else {
      d.sfx.thunder();
      if (big > 1) d.sfx.impact();
    }
  };
  // shockwave rings rolling through the fog from the hearse
  const rings: { m: THREE.Mesh; t0: number; big: number }[] = [];
  const ringGeo = new THREE.RingGeometry(0.92, 1, 64);
  d.onDispose(() => ringGeo.dispose());
  const shock = (t: number, big = 1) =>
    d.at(t, () => {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xc8fff0, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, 0.25, LANE);
      d.scene.add(m);
      rings.push({ m, t0: d.t, big });
      fogKick = big;
    });

  // ---------- rolling ground fog ----------
  const fogTex = glowTexture('rgba(255,255,255,0.85)', 'rgba(255,255,255,0)');
  d.onDispose(() => fogTex.dispose());
  const puffs: { s: THREE.Sprite; x: number; y: number; z: number; sx: number; sy: number; v: number; ph: number; m: THREE.SpriteMaterial }[] = [];
  for (let i = 0; i < 70; i++) {
    const m = new THREE.SpriteMaterial({ map: fogTex, color: 0x404860, transparent: true, opacity: 0.3, depthWrite: false, fog: false });
    const s = new THREE.Sprite(m);
    s.renderOrder = 5;
    d.scene.add(s);
    puffs.push({
      s, m, x: lerp(-26, 26, hash(i)), y: lerp(0.15, 1.1, hash(i + 11)), z: lerp(LANE - 7, LANE + 9, hash(i + 23)),
      sx: lerp(5, 10, hash(i + 37)), sy: lerp(1.6, 3.2, hash(i + 51)), v: lerp(0.4, 1.1, hash(i + 67)), ph: hash(i + 79) * 6.28,
    });
  }
  d.onDispose(() => puffs.forEach((p) => p.m.dispose()));
  let fogKick = 0;
  let fogPush = 0;
  const fogCol = new THREE.Color(0x4a5474);
  const fogDim = new THREE.Color(0x4a5474), fogLit = new THREE.Color(0x8a96b4), fogHero = new THREE.Color(0xa8c8c4);
  let fogLevel = 0; // 0 dark .. 1 lit .. 2 hero
  let fogAlpha = 0.32;
  let hideAll = false; // the blackout (only the eyes)

  // =====================================================================================
  // 0: fog, silence, the bell tolls twice; the hearse's headlights burn through
  // =====================================================================================
  d.bars(true);
  d.cut(0, [16, 0.4, LANE + 2.2], [0, 1.0, LANE], 40, 0.04);
  d.move(0, REVEAL, { pos: [8.2, 0.7, LANE + 1.2], look: [0, 1.5, LANE], fov: 34, roll: -0.03 }, (u) => u * (2 - u));
  for (const [t, big] of [[TOLL1, 1], [TOLL2, 1.3]] as const) {
    shock(t, big);
    d.at(t, () => {
      toll(big);
      d.flash('#c8e8ff', 0.12 * big, 6);
      d.cam.shake(0.15 * big);
      d.cam.punch(-1.5 * big);
    });
  }
  d.span(TOLL1, TOLL1 + 0.5, (u) => setHeadlights(Math.max(headl, 0.45 * easeOut(u))));
  d.span(TOLL2, TOLL2 + 0.3, (u) => setHeadlights(0.45 + 0.75 * easeOut(u)));
  d.stamp(TOLL1 + 0.02, 'DONG.', { color: '#9aa6c0', x: 520, y: 70, size: 16, rot: 0.1, dur: 0.6 });
  d.stamp(TOLL2 + 0.02, 'DONG.', { color: '#c8d4e8', x: 130, y: 84, size: 24, rot: -0.12, dur: 0.6 });

  // =====================================================================================
  // 1.3: him. Head bowed under the brim, a candle under his chin. The head comes up; the eyes ignite.
  // =====================================================================================
  d.at(REVEAL, () => {
    candleLight.intensity = 1.6;
    top.intensity = 2.2;
    fogTo(0x0c0e16, 6, 46);
  });
  d.look(REVEAL, CANDLEL);
  d.follow(REVEAL, SNUFF - 0.25, (u) => fc(lerp(6.8, 5.6, easeInOut(u)), lerp(0.3, 0.2, u), lerp(-0.2, -0.45, u), lerp(-0.9, -0.55, easeInOut(seg(u, 0.4, 0.7))), 32, 0.04));
  d.at(LIFT, () => {
    rig.setEyeGlow(1, true);
    rig.setHat(0.35);
    d.cam.punch(-6);
    d.cam.shake(0.45);
    d.flash('#bfffe8', 0.35, 12);
    d.sfx.impact();
    d.sfx.voice('deacon', 'laugh');
  });
  d.span(LIFT, LIFT + 0.4, (u) => rig.setEyeGlow(u >= 1 ? 0.45 : 1 - 0.55 * u));
  d.impactFrame(LIFT, '#ffffff', 1);

  // =====================================================================================
  // 2.3: he pinches the flame out without looking at it. A stadium bank dies with it.
  // =====================================================================================
  const flameW = new THREE.Vector3();
  d.follow(SNUFF - 0.25, TAPE - 0.001, (u) => fc(lerp(6.4, 5.8, u), 0.38, -1.0, -0.95, 32, -0.04));
  d.span(SNUFF - 0.3, TAPE - 0.001, (u) => {
    Director.wp(candle.flame, flameW);
    // reach for the flame, then hold the pinch
    const k = easeOut(seg(u, 0, 0.45));
    rig.reachTo(1, flameW.clone().add(new THREE.Vector3(0.03, 0.0, 0.02)), u >= 1 ? 0 : k, 0.9);
    if (u > 0.3) rig.setHandPose('L', 'fist');
  });
  d.at(SNUFF, () => {
    candle.setLit(0);
    candleLight.intensity = 0;
    top.intensity = 0;
    (d.sfx as unknown as Record<string, () => void>).snuff?.();
    d.sfx.hush?.(0.1);
    Director.wp(candle.flame, flameW);
    for (let i = 0; i < 5; i++)
      d.fx.smoke(flameW, 1, { color: 0x8a8e9e, size: rand(0.06, 0.1), grow: 3, life: 1.2, spread: 0.05, vel: { x: rand(-0.05, 0.05), y: 0.6, z: 0 }, outline: false });
    d.cam.shake(0.15);
  });
  d.look(SNUFF, DARKL);
  d.stamp(SNUFF + 0.04, 'tss.', { color: '#9aa6c0', x: 470, y: 110, size: 16, rot: 0.08, dur: 0.45 });

  // =====================================================================================
  // 2.7: the tape measure. It zips straight into the lens; he squints: PERFECT FIT.
  // =====================================================================================
  d.at(TAPE, () => {
    candle.root.visible = false;
    cane.root.visible = true;
    tape.root.visible = true;
    rig.setHandPose('L', 'grip');
    rig.reachTo(1, null, 0);
    top.intensity = 3;
    rim.intensity = 6;
    d.cam.punch(-4);
    d.sfx.whoosh();
  });
  d.look(TAPE, JERK);
  d.follow(TAPE, STONE - 0.001, (u) => {
    const f = fc(lerp(6.0, 5.2, easeOut(u)), -0.12, -0.6, -0.5, 34, 0.03);
    return f;
  });
  let tapeLen = 0;
  d.span(ZIP, HITL, (u) => (tapeLen = easeOut(u)));
  d.at(ZIP, () => (d.sfx as unknown as Record<string, () => void>).tapeZip?.());
  d.at(HITL, () => {
    d.cam.punch(7);
    d.cam.shake(0.9);
    d.flash('#ffe14a', 0.25, 14);
    d.sfx.tink();
    d.sfx.impact();
  });
  d.impactFrame(HITL, '#ffe14a', 1);
  d.at(FIT - 0.12, () => rig.setSquint(1));
  d.at(FIT + 0.45, () => rig.setSquint(0));
  d.stamp(FIT, 'PERFECT\nFIT.', { color: '#ffe14a', x: 175, y: 95, size: 24, rot: -0.1, dur: 0.48, burst: '#3a3a4a' });
  d.span(FIT + 0.35, STONE - 0.05, (u) => (tapeLen = 1 - easeOut(u)));
  d.at(FIT + 0.4, () => (d.sfx as unknown as Record<string, () => void>).tapeSnap?.());
  // aim the tape at the lens: +X of the tape root toward the camera, +Y kept up
  const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4(), _pq = new THREE.Quaternion();
  const aimAtCam = (o: THREE.Object3D) => {
    // aim just past the lens (low right), so the tape whips by big and flat instead of edge-on
    const cam = d.stage.camera;
    const p = Director.wp(o);
    const cf = new THREE.Vector3();
    cam.getWorldDirection(cf);
    const cr = cf.clone().cross(cam.up).normalize();
    const cu = cr.clone().cross(cf).normalize();
    const aim = cam.position.clone().addScaledVector(cf, 0.9).addScaledVector(cr, 0.3).addScaledVector(cu, -0.16);
    _x.copy(aim).sub(p);
    const dist = _x.length();
    _x.normalize();
    // the tape's face (+Z) toward the lens
    _z.copy(cam.position).sub(p).normalize();
    _z.addScaledVector(_x, -_z.dot(_x)).normalize();
    _y.copy(_z).cross(_x).normalize();
    _m.makeBasis(_x, _y, _z);
    const wq = new THREE.Quaternion().setFromRotationMatrix(_m);
    o.parent!.getWorldQuaternion(_pq);
    o.quaternion.copy(_pq.invert().multiply(wq));
    return dist;
  };

  // =====================================================================================
  // 4.05: a tombstone slams up out of the fog; he burns "YOU" into it with a fingertip, then grins
  // =====================================================================================
  const shoulder = new THREE.Vector3();
  let stoneS = 1;
  let stoneBase = 0;
  d.at(STONE - 0.2, () => {
    tape.root.visible = false;
    rig.setHandPose('L', 'point');
    // stand it right in front of his left shoulder, sized so the letters sit at hand height
    Director.wp(rig.armL, shoulder);
    // dropped onto the hearse's hood, right by his left hand: the letters sit at hand height
    stoneS = 0.95;
    stoneBase = Math.max(0.3, shoulder.y - 0.12 - 0.62 * stoneS);
    stone.root.scale.setScalar(stoneS);
    stone.root.position.set(shoulder.x + 0.95, stoneBase, shoulder.z + 0.25);
    stone.root.rotation.y = 0;
    stone.root.visible = true;
    stone.setCarved(0);
  });
  d.span(STONE, STONE + 0.4, (u) => carRig.setLean(Math.sin(u * 18) * 0.03 * (1 - u), -0.08 * Math.sin(u * Math.PI * 3) * (1 - u)));
  d.at(STONE, () => {
    d.cam.shake(1.0);
    d.cam.punch(-5);
    d.sfx.impact();
    d.sfx.crunch();
    for (let i = 0; i < 18; i++)
      d.fx.sparks(stone.root.position.clone().add(new THREE.Vector3(rand(-0.4, 0.4), 0.05, rand(-0.2, 0.2))), 1, { color: [0xbfffe8, 0xffffff, 0x9aa6c0][i % 3], size: 0.05, life: 0.4, vel: { x: rand(-3, 3), y: rand(1, 3), z: rand(0, 2) }, gravity: 9, stretch: 0.04 });
  });
  shock(STONE, 0.7);
  d.span(STONE - 0.2, STONE, (u) => {
    // drops out of the dark onto the hood: THUNK, the hearse bottoms out
    stone.root.position.y = stoneBase + 4 * (1 - u) * (1 - u);
    if (u >= 1) carRig.setLean(0, 0);
  });
  d.follow(STONE - 0.2, GLASS - 0.001, (u) => {
    // two-shot: his face left, the tombstone on the hood right
    const f = fc(lerp(7.2, 6.6, easeOut(u)), lerp(0.22, 0.28, u), -0.4, -0.55, 36, -0.03);
    return f;
  });
  const letterW = new THREE.Vector3();
  const tip = new THREE.Vector3();
  d.span(STONE + 0.15, GRIN - 0.05, (u) => {
    const t = d.t;
    // which letter we're on, and a small scribble around it
    const i = Math.min(2, Math.max(0, Math.floor((t - CARVE) / 0.2)));
    letterW.copy(stone.letterPos(t < CARVE ? 0 : i));
    const w = t < CARVE ? 0 : (t - CARVE) * 40;
    tip.copy(letterW).add(new THREE.Vector3(Math.sin(w) * 0.08 * stoneS, Math.cos(w * 1.3) * 0.08 * stoneS, 0.12));
    rig.reachTo(1, tip, u >= 1 ? 0 : easeOut(seg(u, 0, 0.25)), 0.25);
    stone.setCarved(seg(t, CARVE, CARVE + 0.6));
  });
  for (let i = 0; i < 3; i++)
    d.at(CARVE + i * 0.2, () => {
      const p = stone.letterPos(i);
      d.fx.sparks(p, 16, { color: [0xbfffe8, 0xffffff, 0xffe8a0][i], size: 0.05, life: 0.35, spread: 3, vel: { x: 0, y: 2, z: 2.5 }, gravity: 9, stretch: 0.05 });
      d.sparkle(p, 12, '#bfffe8');
      d.cam.shake(0.25);
      (d.sfx as unknown as Record<string, () => void>).chisel?.();
      d.sfx.tink();
    });
  d.at(GRIN - 0.08, () => {
    rig.reachTo(1, null, 0);
    rig.setHandPose('L', 'open');
    rig.setGrin(1);
    d.cam.punch(-4);
    d.sfx.voice('deacon', 'laugh');
  });

  // =====================================================================================
  // 5.4: he flips an hourglass at you. ONE MISTAKE.
  // =====================================================================================
  let flip = 0;
  d.at(GLASS - 0.12, () => {
    stone.root.visible = false;
    glassHold.visible = true;
    rig.setHandPose('L', 'grip');
    glass.setSand(0.9);
    glass.setStream(1);
    d.sfx.whoosh();
  });
  d.span(GLASS, GLASS + 0.3, (u) => (flip = easeBack(u, 1.4)));
  d.at(GLASS + 0.3, () => {
    d.cam.shake(0.4);
    d.sfx.tink();
  });
  d.span(GLASS + 0.3, MACRO, (u) => glass.setSand(lerp(0.9, 0.985, u)));
  d.follow(GLASS - 0.12, MACRO - 0.001, (u) => {
    const f = fc(lerp(5.8, 4.9, easeOut(u)), -0.18, -0.9, -0.85, 34, lerp(0.05, -0.03, u));
    return f;
  });
  d.stamp(ONE, 'ONE\nMISTAKE.', { color: BONE, x: 170, y: 100, size: 24, rot: -0.08, dur: 0.6, burst: '#1a1a22' });

  // =====================================================================================
  // 6.2: BIG MOMENT. Extreme close-up: the last grain of sand falls... in slow motion.
  // =====================================================================================
  const grainGlow = glowSprite(glowTex, 0xfff2c8, 0.12, 0);
  (grainGlow.material as THREE.SpriteMaterial).depthTest = false;
  grainGlow.renderOrder = 22;
  d.scene.add(grainGlow);
  const neck = new THREE.Vector3();
  d.slowmo(MACRO, LAND + 0.02, 0.12, 0.15);
  d.at(MACRO, () => {
    glass.setSand(0.995);
    glass.setStream(0);
    glass.grain.visible = true;
    d.cam.punch(-3);
  });
  d.look(MACRO, DARKL, 0.3);
  let grainY = 0;
  d.span(MACRO, LAND, (u) => {
    // hangs at the neck, wobbles... lets go, and falls
    const fall = seg(u, 0.35, 1);
    grainY = u < 0.35 ? Math.sin(u * 60) * 0.002 : -fall * fall * (0 - glass.pileTop());
    glass.grain.position.set(u < 0.35 ? Math.sin(u * 40) * 0.003 : 0, grainY - 0.004, 0);
    glass.grain.visible = u < 1;
    Director.wp(glass.grain, neck);
    grainGlow.position.copy(neck);
    (grainGlow.material as THREE.SpriteMaterial).opacity = u >= 1 ? 0 : 0.9;
    grainGlow.scale.setScalar(0.1 + 0.03 * Math.sin(d.t * 30));
  });
  const faceW = new THREE.Vector3();
  d.follow(MACRO, LAND, (u) => {
    // straight down the line face -> hourglass -> lens: his eyes burn right behind the glass
    glass.root.updateWorldMatrix(true, false);
    const c = glass.root.localToWorld(new THREE.Vector3(0, 0, 0));
    const g = glass.root.localToWorld(new THREE.Vector3(0, grainY, 0));
    headPos(b, faceW);
    const dir = c.clone().sub(faceW).setY(0).normalize();
    const pos = c.clone().addScaledVector(dir, lerp(1.35, 1.1, u)).add(new THREE.Vector3(0, lerp(0.1, -0.02, u), 0));
    return { pos: pos.add(new THREE.Vector3(0, -0.12, 0)), look: g.clone().lerp(c, 0.5).add(new THREE.Vector3(0, 0.1, 0)), fov: lerp(30, 25, u), roll: lerp(-0.05, 0.04, u) };
  });
  d.stamp(MACRO + 0.3, '...', { color: BONE, x: 470, y: 260, size: 24, rot: 0, dur: 0.75 });

  // =====================================================================================
  // 7.3: it lands. The bell. Black. Only his eyes.
  // =====================================================================================
  d.impactFrame(LAND, '#000000', 3);
  shock(LAND, 2);
  d.at(LAND, () => {
    toll(2.2);
    (d.sfx as unknown as Record<string, () => void>).grainTick?.();
    d.cam.shake(0.8);
    hideAll = true;
    setHeadlights(0);
    glass.grain.visible = false;
    rig.setEyeGlow(1, true);
    rig.setGrin(1);
    d.crowd = null;
  });
  d.follow(LAND, HERO - 0.001, (u) => fc(lerp(6.5, 5.8, u), 0, -0.2, 0, 30));
  // blink once in the dark (funny, horrible)
  d.at(LAND + 0.17, () => rig.setEyeGlow(0, true));
  d.at(LAND + 0.21, () => rig.setEyeGlow(1, true));

  // =====================================================================================
  // 7.6: HERO. The stadium slams on cold white bank by bank: he towers out of the hearse, skull cane aloft.
  // =====================================================================================
  const halo = rays(0xd8fff0, 20, 40, { opacity: 0.16 });
  halo.visible = false;
  d.scene.add(halo);
  d.onDispose(() => {
    halo.geometry.dispose();
    (halo.material as THREE.Material).dispose();
  });
  let caneAloft = 0;
  d.at(HERO, () => {
    hideAll = false;
    d.fx.clear();
    glassHold.visible = false;
    stone.root.visible = true;
    stone.setCarved(1);
    rig.setHandPose('L', 'open');
    rig.setHat(0.15);
    rig.setSignature(1);
    rig.setEyeGlow(0.6);
    rig.root.position.copy(root0).add(new THREE.Vector3(0, 0.35, 0));
    d.crowd = set.crowd;
    d.hype = 0.15;
    fogTo(0x1a2028, 20, 160);
    bg.setHex(0x060810);
    rim.intensity = 10;
    top.intensity = 3;
    halo.visible = true;
    setHeadlights(1.4);
    fogLevel = 2;
    d.cam.punch(-10);
    d.cam.shake(1.0);
    d.flash('#e8fff6', 0.5, 10);
    d.sfx.roar('deacon');
    d.sfx.impact();
    cane.setEyes(1);
  });
  for (let i = 0; i < 5; i++)
    d.at(HERO + i * 0.05, () => {
      set.power((x) => Math.abs(x) >= 100 - i * 30);
      d.cam.punch(-1.5);
      if (i === 4) set.power(() => true);
    });
  d.span(HERO, HERO + 0.25, (u) => (caneAloft = easeOut(u)));
  d.look(HERO, HEROL);
  d.impactFrame(HERO, '#e8fff6', 1);
  d.stamp(HERO + 0.06, 'REST IN\nPIECES.', { color: BONE, x: 190, y: 92, size: 24, rot: -0.1, dur: CARD - HERO - 0.02, burst: '#1a1a22' });
  const heroCam = () => {
    const f = faceCam(b, 7.4, 0.25, -2.8, 0);
    const c = f.pos;
    const hp = f.look;
    const fov = 40;
    const dir = hp.clone().sub(c).normalize();
    const right = dir.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
    const up = right.clone().cross(dir).normalize();
    const dist = c.distanceTo(hp);
    const ty = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const tx = ty * (16 / 9);
    // head on the right third, upper half (clear of the left name card): aim to his lower-left
    const look = hp.clone().addScaledVector(right, -0.5 * tx * dist).addScaledVector(up, -0.3 * ty * dist);
    return { pos: c, look, fov };
  };
  d.follow(HERO, 30, (u) => {
    const h = heroCam();
    return { pos: h.pos.add(new THREE.Vector3(0, lerp(0, 0.5, easeOut(Math.min(1, u * 4))), 0)), look: h.look, fov: lerp(48, 40, easeOut(Math.min(1, u * 6))), roll: 0.07 };
  });

  // ---------- card ----------
  d.freeze(CARD, 0.25, 0.6);
  d.nameCard(CARD, { ...card, color: '#24222c', accent: '#bfffe8', layout: 'left' }, 0.9, 'deacon');
  d.at(CARD + 0.7, () => d.sfx.voice('deacon', 'taunt'));

  // ---------- eyes through everything ----------
  const eyeSpr = (c: number) => {
    const s = glowSprite(glowTex, c, 1, 0);
    (s.material as THREE.SpriteMaterial).depthTest = false;
    s.renderOrder = 21;
    d.scene.add(s);
    return s;
  };
  const eyes = rig.eyes.map(() => ({ bloom: eyeSpr(MINT), core: eyeSpr(0xffffff) }));
  const fwd = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const hidden: THREE.Object3D[] = [];
  let wasHidden = false;

  // ---------- per frame ----------
  d.every((_dt, wdt) => {
    const cam = d.stage.camera.position;
    // tape aimed at the lens
    if (tape.root.visible) {
      const full = aimAtCam(tape.root) / 2.0;
      tape.setExtend(Math.max(0, tapeLen * full - 0.1));
    }
    // hourglass flip (about the grip's Z) toward the lens
    glassHold.rotation.set(0, 0, Math.PI * (1 - flip));
    if (glassHold.visible) {
      // turn a gap between the posts toward the lens
      glassHold.updateWorldMatrix(true, false);
      const lc = glassHold.worldToLocal(cam.clone());
      glass.root.rotation.y = Math.PI / 2 - Math.atan2(lc.z, lc.x);
    }
    // cane: knob up, or aloft along the forearm in the hero shot
    cane.root.quaternion.copy(Q_UP).slerp(Q_ALOFT, caneAloft);
    if (cane.root.visible) {
      // spin the cane about its shaft so the skull grins at the lens
      cane.root.updateWorldMatrix(true, false);
      const lc = cane.root.worldToLocal(cam.clone());
      cane.root.rotateY(Math.atan2(lc.x, lc.z));
    }
    candle.update(wdt);
    // the toll rings
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      const u = (d.t - r.t0) / 1.4;
      if (u >= 1) {
        r.m.removeFromParent();
        (r.m.material as THREE.Material).dispose();
        rings.splice(i, 1);
        continue;
      }
      r.m.scale.setScalar(0.5 + easeOut(u) * 26 * r.big);
      (r.m.material as THREE.MeshBasicMaterial).opacity = 0.45 * (1 - u) * Math.min(1, r.big);
    }
    // fog: drifts along, bulges away from the hearse on each toll, colour follows the light
    fogPush = Math.max(fogKick, fogPush - wdt * 1.2);
    fogKick = 0;
    const tgt = fogLevel >= 2 ? fogHero : fogLevel >= 1 || d.t >= TAPE ? fogLit : fogDim;
    fogCol.lerp(tgt, 1 - Math.exp(-8 * wdt));
    fogAlpha = fogLevel >= 2 ? 0.22 : d.t >= TAPE ? 0.24 : 0.42;
    for (const p of puffs) {
      p.x += p.v * wdt;
      if (p.x > 26) p.x -= 52;
      const dx = p.x, dz = p.z - LANE;
      const dist = Math.max(1, Math.hypot(dx, dz));
      const push = (fogPush * 2.2) / Math.sqrt(dist);
      p.s.position.set(p.x + (dx / dist) * push, p.y + Math.sin(d.wt * 0.7 + p.ph) * 0.12, p.z + (dz / dist) * push);
      p.s.scale.set(p.sx * (1 + 0.1 * fogPush), p.sy, 1);
      p.m.color.copy(fogCol);
      p.m.opacity = fogAlpha * (0.7 + 0.3 * Math.sin(d.wt * 0.5 + p.ph));
      p.s.visible = !hideAll;
    }
    // blackout: everything but the eyes
    if (hideAll !== wasHidden) {
      wasHidden = hideAll;
      if (hideAll) {
        d.scene.traverse((o) => {
          if ((o as THREE.Mesh).isMesh && o.visible && o !== d.fx.group) {
            o.visible = false;
            hidden.push(o);
          }
        });
        set.group.visible = false;
      } else {
        for (const o of hidden) o.visible = true;
        hidden.length = 0;
        set.group.visible = true;
      }
    }
    // headlight beams flicker faintly in the fog
    if (headl > 0) for (const h of beams) (h.beam.material as THREE.MeshBasicMaterial).opacity = 0.05 * headl * (0.85 + 0.15 * Math.sin(d.wt * 7));
    // the spot straight down on him
    headPos(b, H);
    top.position.set(H.x, H.y + 2.4, H.z + 0.8);
    // the halo of rays behind him, facing the lens
    if (halo.visible) {
      const dir = H.clone().sub(cam).normalize();
      halo.position.copy(H).addScaledVector(dir, 14);
      halo.lookAt(cam);
      halo.rotation.z += d.wt * 0.15;
    }
    // eye sprites: big and cold; faded when he faces away
    head.getWorldQuaternion(q);
    fwd.set(0, 0, 1).applyQuaternion(q);
    const on = d.t >= LIFT ? 1 : 0;
    rig.eyes.forEach((e, i) => {
      const sp = eyes[i];
      Director.wp(e, H);
      const k = on * seg(fwd.dot(cam.clone().sub(H).normalize()), -0.1, 0.35) * (hideAll ? 1.4 : d.t >= HERO ? 0.45 : 0.35);
      const fl = 1 + Math.sin(d.t * 23 + i) * 0.07;
      sp.bloom.position.copy(H);
      sp.core.position.copy(H);
      sp.bloom.scale.setScalar(R * (0.35 + 0.45 * Math.min(1, k)) * fl);
      sp.core.scale.set(R * 0.22 * Math.min(1, k), R * 0.16 * Math.min(1, k), 1);
      (sp.bloom.material as THREE.SpriteMaterial).opacity = Math.min(1, k * 0.7);
      (sp.core.material as THREE.SpriteMaterial).opacity = Math.min(1, k);
    });
    // a few cold motes drifting up round him once he's lit
    if (d.t > HERO && Math.random() < 0.5) {
      const away = H.clone().sub(cam).setY(0).normalize();
      d.fx.glow.spawn(H.clone().addScaledVector(away, rand(1, 4)).add(new THREE.Vector3(rand(-3, 3), rand(-2.5, 0.5), rand(-2, 2))), {
        life: 1.6, size: 0.12, color: Math.random() < 0.5 ? 0xbfffe8 : 0xe8f0ff, gravity: -1.2, spread: 0.4,
      });
    }
  });
}
