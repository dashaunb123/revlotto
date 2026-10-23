// BARON VON REDLINE (final boss): an old-money vampire aristocrat with utter contempt for the peasant (you).
// A trumpet fanfare in the dark: a red carpet rolls out AT the lens, candelabras flaring as it passes, two red
// eyes waiting at the far end. A swarm of bats bursts past the camera and the stadium slams on: there he stands,
// cape fluttering, sipping from a wine glass shaped like a tach. He leans in and inspects you through his monocle
// (the eye balloons behind the lens), recoils: "PEASANT." Sips, tosses the glass over his shoulder (it shatters).
// Your rightmost passive card is yanked out of your hand into his; he tears it in half ("CONFISCATED."). He
// tugs off his white racing glove, finger by finger, winds up, and in slow-mo SLAPS THE CAMERA: impact frame, a
// glove print on the lens, "EN GARDE." The camera reels; cut wide: cape flared like bat wings, a blood moon
// behind him, bats wheeling, his royal red-and-gold wedge on the carpet. Card.
import * as THREE from 'three';
import { Director, easeInOut, easeOut, lerp, rand, seg, type CardInfo } from '../director';
import { buildBossCar, buildCharacter } from '../models';
import type { BaronRig } from '../models/baron';
import { buildBats, buildGlove, buildPassiveCard, buildTachGlass, gloveprintTexture } from '../models/baron_props';
import { Kit, outlineTree } from '../models/kit';
import { buildDragStrip, glowSprite, glowTexture } from '../stage';
import { faceCam, harshJerk, headPos, headR, mixLook, talk, type Boss } from './common';

const RED = 0xc8102a;
const GOLD = 0xffd700;
/** Character height in metres (he's BIG). */
const CH = 2.6;

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

export default function baron(d: Director, card: CardInfo) {
  // ---------- set + light ----------
  const set = buildDragStrip(d.stage, { haze: 0x0a0308, sky: [0x1a0610, 0x020104], fogNear: 4, fogFar: 60, dark: true });
  d.crowd = set.crowd;
  d.hype = 0.1;
  set.power(() => false);
  // the white start line runs down x = 0, right under his carpet: hide it
  set.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.geometry instanceof THREE.PlaneGeometry && m.geometry.parameters.width === 0.5 && m.material instanceof THREE.MeshBasicMaterial) m.visible = false;
  });
  const fog = d.stage.scene.fog as THREE.Fog;
  const bg = d.stage.scene.background as THREE.Color;
  const JERK = harshJerk(0xff1a2a, 0xffc830);
  JERK.bloom = 1.0;
  const DARKL = mixLook(JERK, harshJerk(0xff1a2a, 0x8070ff), 0.5);
  DARKL.exposure = 0.85;
  DARKL.vignette = 0.9;
  const HEROL = harshJerk(0xff1a2a, 0xffd040);
  HEROL.bloom = 1.25;
  HEROL.sat = 1.3;
  d.look(0, DARKL);
  const warm = new THREE.PointLight(0xffb050, 0, 14, 1.3);
  warm.position.set(0, 5.0, 1.5);
  // a warm glow riding the carpet roll in the dark
  const rollLight = new THREE.PointLight(0xffa040, 0, 7, 1.5);
  d.scene.add(rollLight);
  d.scene.add(warm);
  const rim = new THREE.PointLight(0xff1a2a, 0, 20, 1.2);
  rim.position.set(0, 4.5, -3.5);
  d.scene.add(rim);

  // ---------- local props (one kit for everything this scene builds) ----------
  const kit = new Kit();
  d.onDispose(() => kit.dispose());
  const goldM = kit.toon(GOLD, { gloss: 0.9, shine: 90 });
  const carpetM = kit.toon(0xa00a1e, { gloss: 0, rim: 0 }); // flat set piece: no rim (grazing glow)

  // ---------- the Baron, standing on his carpet ----------
  const rig = buildCharacter('baron') as BaronRig;
  d.rig(rig);
  d.scene.add(rig.root);
  rig.root.scale.setScalar(CH / rig.height);
  const car = buildBossCar('baron');
  d.rig(car);
  d.scene.add(car.root);
  car.root.position.set(-0.6, 0, -3.6);
  car.root.updateWorldMatrix(true, true);
  const b: Boss = { car, char: rig, size: new THREE.Box3().setFromObject(car.root).getSize(new THREE.Vector3()), roofY: 1.3 };
  const R = headR(b);
  const head = rig.head;
  const torso = rig.torso;
  const armL0 = rig.armL.rotation.clone();
  const armR0 = rig.armR.rotation.clone();
  const torso0 = torso.rotation.clone();
  const head0 = head.rotation.clone();
  rig.setTurn(1);
  rig.setExpression('smirk');
  rig.setSneer(0.45);
  d.every((dt) => rig.setBeatDt(dt));

  // Royal carriage livery on the wedge: gold pinstripe, crest, crown, carriage lanterns.
  {
    const body = car.body;
    const bb = new THREE.Box3().setFromObject(body);
    const sz = bb.getSize(new THREE.Vector3());
    const cx = (bb.min.x + bb.max.x) / 2;
    for (const s of [-1, 1]) {
      const stripe = kit.box(sz.x * 0.7, 0.035, 0.02, goldM, 0.006);
      stripe.position.set(cx, 0.24, s * (sz.z / 2 + 0.005));
      body.add(stripe);
      const crest = new THREE.Group();
      crest.position.set(cx + 0.1, 0.42, s * (sz.z / 2 + 0.02));
      crest.rotation.y = s > 0 ? 0 : Math.PI;
      body.add(crest);
      const shield = kit.ball(0.17, goldM, 0.85, 1, 0.15, 14, 0.01);
      crest.add(shield);
      const inner = kit.ball(0.13, kit.toon(0x7a0814), 0.85, 1, 0.15, 14, 0);
      inner.position.z = 0.012;
      crest.add(inner);
      // a little gold crown on the shield
      const cb = kit.box(0.14, 0.04, 0.02, goldM, 0);
      cb.position.set(0, -0.03, 0.03);
      crest.add(cb);
      for (const x of [-0.055, 0, 0.055]) {
        const pt = kit.mesh(new THREE.ConeGeometry(0.025, 0.08, 4), goldM, 0);
        pt.position.set(x, 0.03, 0.03);
        crest.add(pt);
      }
    }
    const crown = new THREE.Group();
    crown.position.set(cx - 0.1, bb.max.y + 0.02, 0);
    body.add(crown);
    const band = kit.cyl(0.2, 0.18, 0.12, goldM, 16, 0.01);
    band.position.y = 0.06;
    crown.add(band);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const pt = kit.mesh(new THREE.ConeGeometry(0.05, 0.16, 8), goldM, 0.008);
      pt.position.set(Math.cos(a) * 0.17, 0.19, Math.sin(a) * 0.17);
      crown.add(pt);
      const gem = kit.ball(0.025, kit.toon(i % 2 ? 0xe0102a : 0x2050e0, { gloss: 1, shine: 120 }), 1, 1, 1, 8, 0.006);
      gem.position.set(Math.cos(a) * 0.2, 0.07, Math.sin(a) * 0.2);
      crown.add(gem);
    }
    for (const s of [-1, 1]) {
      const lan = new THREE.Group();
      lan.position.set(bb.max.x - 0.5, 0.95, s * (sz.z / 2 + 0.1));
      body.add(lan);
      lan.add(kit.box(0.12, 0.2, 0.12, goldM, 0.008));
      const glassL = kit.box(0.09, 0.15, 0.13, kit.toon(0xfff0b0, { emissive: 0xffc040, emissiveIntensity: 1.2 }), 0);
      lan.add(glassL);
      const cap = kit.mesh(new THREE.ConeGeometry(0.1, 0.1, 4), goldM, 0.008);
      cap.position.y = 0.15;
      cap.rotation.y = Math.PI / 4;
      lan.add(cap);
    }
    outlineTree(body, kit.outlineMat);
  }

  // ---------- the red carpet (rolls out toward the lens) + candelabras ----------
  const CZ0 = -2.4, CLEN = 9.6, CW = 1.9; // ends short of the wall at z = 8.4
  const carpet = new THREE.Group();
  d.scene.add(carpet);
  const cGeo = new THREE.PlaneGeometry(CW, 1);
  cGeo.rotateX(-Math.PI / 2);
  cGeo.translate(0, 0, 0.5);
  const cMesh = kit.mesh(cGeo, carpetM, 0);
  cMesh.position.set(0, 0.03, CZ0);
  carpet.add(cMesh);
  const edges: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const eg = new THREE.PlaneGeometry(0.1, 1);
    eg.rotateX(-Math.PI / 2);
    eg.translate(0, 0, 0.5);
    const e = kit.mesh(eg, goldM, 0);
    e.position.set(s * (CW / 2 - 0.12), 0.035, CZ0);
    carpet.add(e);
    edges.push(e);
  }
  const roll = new THREE.Group();
  carpet.add(roll);
  const rollM = kit.cyl(1, 1, CW, carpetM, 20, 0.02);
  rollM.rotation.z = Math.PI / 2;
  roll.add(rollM);
  for (const s of [-1, 1]) {
    const cap = kit.cyl(1.02, 1.02, 0.03, goldM, 20, 0);
    cap.rotation.z = Math.PI / 2;
    cap.position.x = s * (CW / 2 - 0.12);
    roll.add(cap);
  }
  outlineTree(roll, kit.outlineMat);
  let unrolled = 0;
  const setCarpet = (k: number) => {
    unrolled = k;
    const len = 2.2 + (CLEN - 2.2) * k; // the bit under him is already down
    cMesh.scale.z = len;
    for (const e of edges) e.scale.z = len;
    const r = Math.sqrt(0.32 * 0.32 * (1 - k) + 0.04 * 0.04);
    roll.scale.setScalar(r);
    roll.position.set(0, r + 0.02, CZ0 + len);
    rollM.rotation.x = -len / r;
    roll.visible = k < 0.999;
  };
  setCarpet(0);
  // candelabras along the carpet; each lights up as the roll passes
  const flameTex = glowTexture();
  const candles: { z: number; flames: THREE.Sprite[]; lit: boolean; at: THREE.Vector3[] }[] = [];
  for (const z of [1.0, 2.9, 4.8, 6.7]) {
    for (const s of [-1, 1]) {
      const cg = new THREE.Group();
      cg.position.set(s * 1.55, 0, z);
      d.scene.add(cg);
      const base = kit.cyl(0.2, 0.26, 0.08, goldM, 14, 0.01);
      base.position.y = 0.04;
      cg.add(base);
      const pole = kit.cyl(0.035, 0.05, 1.4, goldM, 10, 0.01);
      pole.position.y = 0.75;
      cg.add(pole);
      const knob = kit.ball(0.07, goldM, 1, 0.8, 1, 10, 0.01);
      knob.position.y = 1.0;
      cg.add(knob);
      const arm = kit.mesh(new THREE.TorusGeometry(0.28, 0.025, 6, 16, Math.PI), goldM, 0.008);
      arm.position.y = 1.45;
      arm.rotation.z = Math.PI;
      cg.add(arm);
      const flames: THREE.Sprite[] = [];
      const at: THREE.Vector3[] = [];
      for (const x of [-0.28, 0, 0.28]) {
        const cup = kit.cyl(0.05, 0.035, 0.05, goldM, 10, 0.008);
        cup.position.set(x, x === 0 ? 1.5 : 1.47, 0);
        cg.add(cup);
        const candle = kit.cyl(0.03, 0.03, 0.18, 0xf6f0e0, 10, 0.008);
        candle.position.set(x, cup.position.y + 0.11, 0);
        cg.add(candle);
        const fl = glowSprite(flameTex, 0xffb040, 0.4, 0);
        fl.position.set(x, cup.position.y + 0.28, 0);
        cg.add(fl);
        flames.push(fl);
        at.push(new THREE.Vector3(s * 1.55 + x, cup.position.y + 0.24, z));
      }
      outlineTree(cg, kit.outlineMat);
      candles.push({ z, flames, lit: false, at });
    }
  }

  // ---------- a blood moon (behind him in the wides; his halo in the hero shot) ----------
  const moonTex = kit.canvas(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, w * 0.3, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.08, 'rgba(255,255,255,0.5)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(w / 2, h / 2, w * 0.3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(120,0,20,0.35)';
    for (const [x, y, r] of [[52, 50, 9], [74, 70, 12], [60, 80, 6], [80, 46, 5]]) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }, true);
  const moon = new THREE.Mesh(kit.geo(new THREE.PlaneGeometry(1, 1)), kit.own(new THREE.MeshBasicMaterial({ map: moonTex, color: 0xff3040, transparent: true, depthWrite: false, fog: false })));
  moon.position.set(4, 26, -70);
  moon.scale.setScalar(34);
  moon.renderOrder = -1;
  d.scene.add(moon);

  // ---------- props in hand ----------
  const glass = buildTachGlass();
  d.onDispose(() => glass.dispose());
  glass.root.scale.setScalar(1.5);
  rig.props.gripL.add(glass.root);
  // grip frame: +X along the forearm, +Y out of the thumb: stand the glass up out of the fist, dial to the front
  glass.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)));
  glass.root.position.set(0, 0, 0);
  glass.setLevel(0.8);
  rig.setHandPose('L', 'grip');
  rig.setHandPose('R', 'open');

  const pc = buildPassiveCard();
  d.onDispose(() => pc.dispose());
  pc.root.scale.setScalar(1.25);
  pc.root.visible = false;
  d.scene.add(pc.root);
  // hand anchors on the halves' outer edges
  const anchorL = new THREE.Object3D(), anchorR = new THREE.Object3D();
  anchorL.position.set(0.17, 0.02, -0.06);
  anchorR.position.set(-0.17, 0.02, -0.06);
  pc.halves[0].add(anchorR); // his right hand takes the screen-left half
  pc.halves[1].add(anchorL);
  // where the card hangs in front of his chest (torso space)
  const cardSpot = new THREE.Object3D();
  cardSpot.position.set(0, 0.48, 0.62);
  torso.add(cardSpot);

  const glove = buildGlove();
  d.onDispose(() => glove.dispose());
  glove.root.scale.setScalar(1.35);
  glove.root.visible = false;
  rig.props.gripL.add(glove.root);
  glove.setFlop(0.6);

  // targets the arms reach for
  const mouthT = new THREE.Object3D();
  head.add(mouthT);
  mouthT.position.set(0.12, 0.25, 0.75);
  const handRTip = new THREE.Object3D();
  rig.props.handR.add(handRTip);
  handRTip.position.set(0, -0.12, 0.0);
  const lensT = new THREE.Object3D();
  d.scene.add(lensT);

  // ---------- bats ----------
  const NB = 34;
  const bats = buildBats(NB);
  d.onDispose(() => bats.dispose());
  d.scene.add(bats.root);
  bats.root.visible = false;

  // ---------- timeline ----------
  const ROLL0 = 0.15; // the carpet starts rolling
  const ROLL1 = 1.05; // it bumps the lens
  const BATS = 1.0; // the swarm bursts out
  const LIGHTS = 1.3; // stadium slams on: there he is
  const PEER = 2.25; // monocle inspection
  const PEASANT = 3.0;
  const SIP = 3.35;
  const TOSS = 3.95;
  const SNATCH = 4.3; // your card flies into his hand
  const TEAR = 5.0;
  const RIP = 5.25;
  const GLOVE = 5.85; // tugs off the glove
  const YANK = 6.35;
  const WIND = 6.5;
  const SWING = 6.75;
  const HIT = 7.35;
  const HERO = 7.75;
  const CARD = 8.65;

  // ---------- poses ----------
  const STAND = P(-0.55, 0.05, 0.1, -0.12, 0, 0, 0, 0, 0); // glass at the chest, other hand on the hip-ish
  const LEAN = P(-0.55, 0.05, 0.1, -0.12, 0.28, 0, 0.12, 0, 0.0); // leaning in to inspect
  const RECOIL = P(-0.55, 0.1, 0.1, -0.12, -0.12, 0, -0.06, 0, 0.1);
  const TOSSP = P(-2.6, 0.3, 0.1, -0.12, -0.05, 0.15, -0.05, 0, 0.05); // flicks the glass back over his shoulder
  const PALM = P(0.1, 0.1, -1.2, 0.15, 0, 0, 0.08, 0, 0); // right palm up for the card
  const TEARP = P(0, 0, 0, 0, 0.05, 0, 0.1, 0, 0);
  const PULL = P(0, 0, -1.5, 0.45, -0.04, 0.1, -0.05, -0.2, 0.08); // right hand up in front, nose in the air // right hand up in front, left pulls the glove
  const YANKP = P(-0.6, 1.3, -1.0, 0.3, -0.05, 0.2, 0.0, 0, 0.0);
  const WINDP = P(-2.4, 1.0, 0.1, -0.3, -0.12, 0.45, -0.05, 0.1, -0.1); // glove high over his left shoulder
  const STRIKE = P(0, 0, 0.1, -0.3, 0.25, -0.3, 0.05, 0, 0.1);
  const HEROP = P(-1.45, 0.35, 0.15, -0.9, -0.05, 0.0, -0.05, 0.0, 0.05); // glove pointed at you, right arm flung out
  const keys: [number, Pose][] = [
    [0, STAND], [PEER - 0.05, STAND], [PEER + 0.15, LEAN], [PEASANT - 0.02, LEAN], [PEASANT + 0.1, RECOIL],
    [TOSS - 0.12, RECOIL], [TOSS + 0.06, TOSSP], [SNATCH, TOSSP], [SNATCH + 0.2, PALM], [TEAR - 0.1, PALM], [TEAR + 0.05, TEARP],
    [GLOVE - 0.15, TEARP], [GLOVE, PULL], [YANK, PULL], [YANK + 0.08, YANKP], [WIND, YANKP], [SWING - 0.02, WINDP], [SWING + 0.25, STRIKE],
    [HERO - 0.001, STRIKE], [HERO, HEROP],
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

  // =====================================================================================
  // 0: darkness, a fanfare. The red carpet rolls out AT the lens; candelabras flare as it passes.
  // =====================================================================================
  d.bars(true);
  d.at(0.02, () => (d.sfx as unknown as Record<string, () => void>).fanfare?.());
  d.cut(0, [0.25, 0.3, 7.9], [0, 1.3, -2], 46, 0.04);
  d.move(0, ROLL1, { pos: [0.2, 0.36, 7.6], look: [0, 1.6, -2], fov: 40, roll: -0.03 }, easeInOut);
  d.span(ROLL0, ROLL1, (u) => setCarpet(easeInOut(u)));
  d.at(0, () => (rim.intensity = 5));
  d.span(0, LIGHTS, (u) => {
    rollLight.position.set(0, 1.6, CZ0 + 2.2 + (CLEN - 2.2) * unrolled - 0.6);
    rollLight.intensity = u >= 1 ? 0 : 4;
  });
  d.at(ROLL1, () => {
    d.cam.shake(0.7);
    d.cam.punch(6);
    d.sfx.impact();
  });
  // eyes glowing at the far end of the dark
  const eyeTex = glowTexture();
  const eyeGlow = rig.eyes.map(() => {
    const s = glowSprite(eyeTex, 0xff2030, 0.5, 0);
    (s.material as THREE.SpriteMaterial).depthTest = false;
    s.renderOrder = 20;
    d.scene.add(s);
    return s;
  });

  // =====================================================================================
  // 1.0: bats burst past the lens; 1.3 the stadium slams on and there he is (crane up from the boots)
  // =====================================================================================
  d.at(BATS, () => {
    bats.root.visible = true;
    (d.sfx as unknown as Record<string, () => void>).batFlutter?.();
    d.sfx.whoosh();
  });
  d.cut(LIGHTS, [0.9, 0.35, 4.6], [0, 0.6, 0], 50, -0.06);
  d.follow(LIGHTS, PEER, (u) => {
    const e = easeOut(u);
    headPos(b, H);
    return {
      pos: new THREE.Vector3(lerp(0.35, 0.2, e), lerp(0.35, 1.5, e), lerp(4.6, 4.2, e)),
      look: new THREE.Vector3(0, lerp(0.6, H.y - 0.05, easeInOut(u)), 0),
      fov: lerp(52, 34, e),
      roll: lerp(-0.08, 0.03, e),
    };
  });
  d.at(LIGHTS, () => {
    set.power(() => true);
    fog.color.setHex(0x1a0610);
    fog.near = 30;
    fog.far = 190;
    bg.setHex(0x0a0306);
    warm.intensity = 2.5;
    rim.intensity = 10;
    d.hype = 0.85;
    d.cam.punch(-8);
    d.cam.shake(0.6);
    d.flash('#fff0d0', 0.5, 9);
    d.sfx.impact();
    d.sfx.thunder();
  });
  d.look(LIGHTS, JERK, 0.15);
  d.at(LIGHTS + 0.5, () => {
    headPos(b, H);
    d.sparkle(rig.props.monocle.getWorldPosition(new THREE.Vector3()), 18, '#fff6c0');
    d.sfx.tink();
  });

  // =====================================================================================
  // 2.25: he leans in and inspects you through the monocle (the eye balloons), then recoils: "PEASANT."
  // =====================================================================================
  d.follow(PEER, PEASANT, (u) => fc(lerp(9.0, 6.2, easeOut(u)), -0.18, 0.05, -0.1, lerp(34, 30, u), 0.04));
  d.at(PEER, () => {
    rig.setSneer(0);
    d.cam.punch(-3);
  });
  d.at(PEER + 0.12, () => {
    rig.setPeer(1);
    d.sfx.tink();
  });
  // looks you up... and down
  d.span(PEER + 0.15, PEASANT, (u) => rig.setLook(0.05, u < 0.5 ? lerp(0.3, -0.9, easeInOut(u * 2)) : lerp(-0.9, 0.1, easeInOut(u * 2 - 1))));
  d.at(PEASANT, () => {
    rig.setPeer(0);
    rig.setSneer(1);
    rig.setLook(0, 0);
    d.cam.punch(7);
    d.cam.shake(0.5);
    d.flash('#ff2a3a', 0.25, 10);
    d.sfx.impact();
    d.sfx.voice('baron', 'taunt');
  });
  talk(d, b, PEASANT + 0.02, 0.4, 12);
  d.impactFrame(PEASANT, '#ffd700', 1);
  d.stamp(PEASANT + 0.02, 'PEASANT.', { color: '#ffd700', x: 168, y: 96, size: 24, rot: -0.1, dur: 0.95, burst: '#c8102a' });
  d.follow(PEASANT, TOSS, (u) => fc(lerp(6.0, 6.6, u), 0.32, -0.45, -0.3, 34, -0.05));

  // sip (eyes on you the whole time)
  d.span(SIP, TOSS - 0.05, (u) => {
    const k = Math.sin(Math.PI * Math.min(1, u * 1.15));
    rig.setReach(1, mouthT, k * 0.95, 1.1);
    glass.setLevel(lerp(0.8, 0.35, seg(u, 0.35, 0.7)));
  });
  d.at(SIP + 0.25, () => (d.sfx as unknown as Record<string, () => void>).sip?.());

  // toss it over his shoulder
  let glassFrom: THREE.Vector3 | null = null;
  const glassVel = new THREE.Vector3(-1.8, 5.5, -6);
  d.at(TOSS + 0.04, () => {
    rig.setReach(1, null, 0);
    d.scene.attach(glass.root);
    glassFrom = glass.root.position.clone();
    rig.setHandPose('L', 'open');
    d.sfx.whoosh();
    d.sfx.voice('baron', 'laugh');
  });
  let glassT = 0;
  d.every((_dt, wdt) => {
    if (!glassFrom || !glass.root.parent || !glass.root.visible) return;
    glassT += wdt;
    glass.root.position.copy(glassFrom).addScaledVector(glassVel, glassT);
    glass.root.position.y -= 4.9 * glassT * glassT;
    glass.root.rotation.x += wdt * 14;
    glass.root.rotation.z += wdt * 6;
    if (glassT > 0.55) {
      glass.root.visible = false;
      const p = glass.root.position.clone();
      d.fx.sparks(p, 22, { color: 0xe8f4ff, gravity: 10, spread: 4, life: 0.7, size: 0.06 });
      d.fx.sparks(p, 10, { color: 0xc00818, gravity: 10, spread: 3, life: 0.7, size: 0.08 });
      (d.sfx as unknown as Record<string, () => void>).glassShatter?.();
      d.sfx.crunch();
    }
  });

  // =====================================================================================
  // 4.3: YOUR rightmost passive card is yanked out of your hand into his; he reads it; tears it in half
  // =====================================================================================
  d.follow(TOSS + 0.15, TEAR, (u) => fc(lerp(8.4, 7.6, u), -0.12, -0.9, -0.95, 34, 0.03));
  const camFwd = new THREE.Vector3();
  let cardFrom: THREE.Vector3 | null = null;
  d.at(SNATCH, () => {
    pc.root.visible = true;
    const c = d.stage.camera;
    c.getWorldDirection(camFwd);
    cardFrom = c.position.clone().addScaledVector(camFwd, 0.9).add(new THREE.Vector3(0, -0.55, 0));
    d.sfx.whoosh();
  });
  const cardW = new THREE.Vector3();
  const qCard = new THREE.Quaternion();
  d.span(SNATCH, SNATCH + 0.32, (u) => {
    if (!cardFrom) return;
    cardSpot.updateWorldMatrix(true, false);
    cardSpot.getWorldPosition(cardW);
    const e = easeOut(u);
    pc.root.position.lerpVectors(cardFrom, cardW, e);
    pc.root.position.y += Math.sin(u * Math.PI) * 0.3;
    torso.getWorldQuaternion(qCard);
    pc.root.quaternion.copy(qCard);
    pc.root.rotateY((1 - e) * 5.5); // face out of his hands, toward you, spinning in
    pc.root.rotateZ((1 - e) * 1.2);
  });
  d.at(SNATCH + 0.32, () => {
    torso.attach(pc.root);
    rig.setHandPose('R', 'grip');
    d.sfx.paperTik();
    d.cam.shake(0.25);
  });
  d.stamp(SNATCH + 0.36, 'CONFISCATED.', { color: '#ff4fa3', x: 470, y: 300, size: 16, rot: 0.08, dur: 0.8 });
  // his right hand holds it out; at TEAR both hands grab its edges
  d.span(SNATCH + 0.2, TEAR, (u) => rig.setReach(-1, anchorR, easeInOut(u), 0.6));
  d.span(TEAR - 0.1, RIP + 0.6, (u) => rig.setReach(1, anchorL, easeInOut(Math.min(1, u * 4)), 0.6));
  d.at(TEAR, () => {
    rig.setHandPose('L', 'grip');
    rig.setPeer(0.55);
  });
  d.follow(TEAR, GLOVE - 0.1, (u) => fc(lerp(7.4, 6.6, u), 0.1, -0.7, -1.0, 36, lerp(0.02, -0.04, u)));
  // slow strain... RRRIP
  d.span(TEAR, RIP, (u) => {
    pc.halves[0].rotation.set(0, 0, -0.04 * u);
    pc.halves[1].rotation.set(0, 0, 0.04 * u);
    pc.halves[0].position.x = -0.006 * u + Math.sin(d.t * 70) * 0.003 * u;
    pc.halves[1].position.x = 0.006 * u - Math.sin(d.t * 70) * 0.003 * u;
  });
  d.slowmo(RIP - 0.02, RIP + 0.42, 0.3, 0.05);
  d.at(RIP, () => {
    rig.setPeer(0);
    rig.setSneer(1);
    d.sfx.rip();
    d.cam.punch(-5);
    d.cam.shake(0.5);
    d.flash('#5cf2ff', 0.3, 12);
    (pc.glow.material as THREE.MeshBasicMaterial).opacity = 0;
    const p = pc.root.getWorldPosition(new THREE.Vector3());
    d.fx.sparks(p, 26, { color: 0x5cf2ff, gravity: 3, spread: 3, life: 0.6, size: 0.05 });
    d.fx.sparks(p, 12, { color: 0xf7d23e, gravity: 3, spread: 2.5, life: 0.6, size: 0.05 });
  });
  d.span(RIP, RIP + 0.45, (u) => {
    const e = easeOut(u);
    pc.halves[0].position.set(-0.32 * e, 0.06 * e, 0.05 * e);
    pc.halves[1].position.set(0.32 * e, -0.03 * e, 0.05 * e);
    pc.halves[0].rotation.set(0.2 * e, -0.5 * e, 0.55 * e);
    pc.halves[1].rotation.set(-0.15 * e, 0.5 * e, -0.45 * e);
  });
  // he lets the halves drop and flutter away
  d.at(RIP + 0.5, () => {
    for (let i = 0; i < 2; i++) {
      const hv = pc.halves[i];
      d.scene.attach(hv);
      d.fling(hv, d.t, [i ? 0.8 : -0.8, 0.6, 0.6], [rand(-4, 4), rand(-6, 6), rand(-4, 4)], 2.2, 0.05);
    }
    rig.setReach(1, null, 0);
    rig.setReach(-1, null, 0);
    rig.setHandPose('L', 'open');
    rig.setHandPose('R', 'open');
  });

  // =====================================================================================
  // 5.85: tugs off his right glove, finger by finger... and YANKS it free
  // =====================================================================================
  const HM = new THREE.Vector3();
  d.follow(YANK, WIND, (u) => fc(lerp(7.4, 7.8, u), -0.3, -0.5, -0.8, 40, -0.04));
  d.follow(GLOVE - 0.1, YANK, (u) => {
    // on the hands, his smug face just above them
    headPos(b, H);
    Director.wp(rig.props.handR, HM);
    const look = HM.lerp(H, 0.45);
    return { pos: look.clone().add(new THREE.Vector3(lerp(0.9, 0.7, u), lerp(-0.25, -0.15, u), lerp(2.9, 2.6, u))), look, fov: 36, roll: 0.06 };
  });
  d.at(GLOVE - 0.1, () => {
    rig.setHandPose('R', 'open');
    rig.setSneer(0.7);
  });
  d.span(GLOVE, YANK, (u) => {
    // three tugs: the pinch slides out along the fingers
    const tug = Math.floor(u * 3);
    const f = u * 3 - tug;
    const pull = 0.02 + tug * 0.025 + (f < 0.4 ? f / 0.4 : 1) * 0.02;
    handRTip.position.set(0, -0.12 - pull, 0);
    rig.setReach(1, handRTip, easeOut(Math.min(1, u * 5)), 0.9);
    rig.setHandPose('L', f < 0.15 ? 'open' : 'grip');
  });
  for (let i = 0; i < 3; i++)
    d.at(GLOVE + ((YANK - GLOVE) / 3) * (i + 0.15), () => {
      (d.sfx as unknown as Record<string, () => void>).glovePull?.();
      d.sfx.paperTik();
      d.cam.shake(0.15);
      d.cam.punch(-1.5);
      d.sparkle(Director.wp(handRTip), 10, '#ffffff');
    });
  d.at(YANK, () => {
    rig.setReach(1, null, 0);
    rig.setBare(1);
    glove.root.visible = true;
    rig.setHandPose('L', 'grip');
    rig.setHandPose('R', 'open');
    d.sfx.whoosh();
    d.cam.punch(-3);
  });

  // =====================================================================================
  // 6.5: wind-up... 6.75 the slow-mo SLAP, straight across the lens. "EN GARDE."
  // =====================================================================================
  d.at(WIND, () => {
    rig.setSnarl(1);
    rig.setSneer(0);
    rig.setCape(1);
    d.sfx.voice('baron', 'yell');
  });
  // the camera holds close on his face; the glove comes round from his left and fills the frame
  d.follow(WIND, HIT, (u) => fc(lerp(4.4, 3.4, easeInOut(u)), 0.05, -0.15, -0.15, lerp(38, 42, u), lerp(0.05, -0.08, u)));
  d.slowmo(SWING + 0.05, HIT + 0.02, 0.16, 0.12);
  d.every(() => {
    const c = d.stage.camera;
    c.getWorldDirection(camFwd);
    // a point just in front of the lens, a touch to screen-left (the backhand comes from his left = screen right)
    lensT.position.copy(c.position).addScaledVector(camFwd, 0.9);
    const right = camFwd.clone().cross(c.up).normalize();
    lensT.position.addScaledVector(right, -0.15).add(new THREE.Vector3(0, -0.1, 0));
  });
  d.span(SWING, HIT, (u) => {
    rig.setReach(1, lensT, easeInOut(u), lerp(1.3, 0.2, u));
    glove.setFlop(0.6 + Math.sin(u * 9) * 0.35);
  });
  d.at(SWING, () => d.sfx.whoosh());
  d.at(HIT, () => {
    rig.setReach(1, null, 0);
    rig.setExpression('yell');
    d.sfx.slap();
    d.sfx.impact();
    d.cam.punch(12);
    d.cam.shake(1.3);
  });
  d.impactFrame(HIT, '#ffffff', 2);
  d.impactFrame(HIT + 2 / 60, 'invert', 1);
  d.stamp(HIT + 0.05, 'EN GARDE.', { color: '#ffffff', x: 330, y: 150, size: 24, rot: -0.14, dur: 0.85, burst: '#c8102a' });
  // the camera reels from the slap (a whip to the side)
  d.whip(HIT + 0.04, 0.3, { look: [-5, 4.5, -6], roll: 0.4, fov: 46 });
  // glove print on the lens
  const printTex = gloveprintTexture();
  kit.tex(printTex);
  const print = new THREE.Mesh(kit.geo(new THREE.PlaneGeometry(1, 1)), kit.own(new THREE.MeshBasicMaterial({ map: printTex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false })));
  print.renderOrder = 50;
  d.scene.add(print);
  const q = new THREE.Quaternion();
  d.span(HIT, HERO, (u) => {
    const c = d.stage.camera;
    c.getWorldDirection(camFwd);
    c.getWorldQuaternion(q);
    const age = (HERO - HIT) * u;
    print.position.copy(c.position).addScaledVector(camFwd, 0.5);
    print.quaternion.copy(q);
    print.rotateZ(0.2);
    const ty = Math.tan(THREE.MathUtils.degToRad(c.fov / 2)) * 0.5;
    print.scale.setScalar(ty * 1.7 * (1 + 0.05 * u));
    print.translateY(-ty * 0.25 * u);
    print.translateX(-ty * 0.3);
    (print.material as THREE.MeshBasicMaterial).opacity = u >= 1 ? 0 : age < 0.2 ? 1 : Math.max(0, 1 - (age - 0.2) / 0.2);
  });

  // =====================================================================================
  // 7.75: HERO. Cape flared like bat wings, the blood moon behind him, bats wheeling, the glove aimed at you.
  // =====================================================================================
  const heroCam = (lift: number) => {
    const f = faceCam(b, 8.8, 0.14, -1.9 + lift, 0);
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
  d.at(HERO, () => {
    rig.setExpression('smirk');
    rig.setSnarl(0);
    rig.setSneer(1);
    rig.setCape(1.25);
    rig.setSignature(1);
    rig.setHandPose('R', 'open');
    d.hype = 1;
    warm.intensity = 12;
    rim.intensity = 14;
    fog.color.setHex(0x2a0812);
    bg.setHex(0x12030a);
    d.cam.punch(-10);
    d.cam.shake(0.8);
    d.flash('#ff1a2a', 0.45, 8);
    d.sfx.impact();
    d.sfx.signature('baron');
  });
  d.at(HERO + 0.15, () => d.sfx.roar('baron'));
  d.look(HERO, HEROL);
  d.impactFrame(HERO, '#7a0814', 2);
  d.follow(HERO, 30, (u) => {
    const h = heroCam(lerp(0, 0.5, easeOut(Math.min(1, u * 4))));
    return { pos: h.pos, look: h.look, fov: lerp(48, 40, easeOut(Math.min(1, u * 6))), roll: 0.06 };
  });
  // gold glitter raining down
  d.span(HERO, CARD + 0.3, () => {
    if (Math.random() < 0.7) {
      headPos(b, H);
      d.fx.glow.spawn(new THREE.Vector3(H.x + rand(-4, 4), H.y + rand(1, 3), H.z + rand(-2, 1)), { life: 1.4, size: 0.07, color: hash(d.t) < 0.5 ? 0xffd700 : 0xfff2b0, gravity: 1.2, spread: 0.4 });
    }
  });

  // ---------- card ----------
  d.freeze(CARD, 0.25, 0.6);
  d.nameCard(CARD, { ...card, color: '#8a0f1a', accent: '#ffd700', layout: 'left' }, 0.8, 'baron');
  d.at(CARD + 0.7, () => d.sfx.voice('baron', 'taunt'));

  // ---------- per frame ----------
  const camPos = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const qh = new THREE.Quaternion();
  d.every((_dt, wdt) => {
    void wdt;
    const t = d.t;
    camPos.copy(d.stage.camera.position);
    // candelabras ignite as the roll passes
    const front = CZ0 + 2.2 + (CLEN - 2.2) * unrolled;
    for (const c of candles) {
      if (!c.lit && front > c.z) {
        c.lit = true;
        for (const p of c.at) d.fx.flame(p, 2, { size: 0.35, life: 0.3, spread: 0.3 });
        (d.sfx as unknown as Record<string, () => void>).candleFwump?.();
      }
      c.flames.forEach((f, i) => {
        const m = f.material as THREE.SpriteMaterial;
        m.opacity = c.lit ? 0.85 + 0.15 * Math.sin(t * 23 + i * 2 + c.z) : 0;
        const s = 0.38 + 0.06 * Math.sin(t * 31 + i + c.z * 3);
        f.scale.set(s * 0.8, s * 1.25, 1);
      });
    }
    // glowing eyes at the end of the carpet (only in the dark)
    head.getWorldQuaternion(qh);
    fwd.set(0, 0, 1).applyQuaternion(qh);
    rig.eyes.forEach((e, i) => {
      Director.wp(e, tmp);
      const s = eyeGlow[i];
      s.position.copy(tmp);
      const facing = seg(fwd.dot(camPos.clone().sub(tmp).normalize()), 0.0, 0.4);
      const k = t < LIGHTS ? facing * (0.75 + 0.25 * Math.sin(t * 9 + i)) : 0;
      (s.material as THREE.SpriteMaterial).opacity = k;
      s.scale.setScalar(R * (0.9 + 0.2 * Math.sin(t * 7)));
    });
    // the moon: a halo behind his head in the hero shot
    if (t >= HERO) {
      headPos(b, H);
      const dir = H.clone().sub(camPos).normalize();
      moon.position.copy(H).addScaledVector(dir, 40).add(new THREE.Vector3(0, 0.3, 0));
      moon.lookAt(camPos);
      const dist = camPos.distanceTo(moon.position);
      const ty = Math.tan(THREE.MathUtils.degToRad(d.stage.camera.fov / 2));
      moon.scale.setScalar(ty * dist * 1.7);
    } else moon.lookAt(camPos);
    // bats
    if (bats.root.visible) {
      bats.flap(d.wt, 26);
      headPos(b, H);
      for (let i = 0; i < NB; i++) {
        const bt = bats.bats[i];
        const h1 = hash(i + 1), h2 = hash(i + 7), h3 = hash(i + 13);
        let p: THREE.Vector3;
        if (t < HERO) {
          // burst: from behind him, streaming past the lens, then wheeling high overhead
          const u = (t - BATS) / 0.7 - h1 * 0.3;
          if (u < 1) {
            const e = Math.max(0, u);
            const from = new THREE.Vector3((h2 - 0.5) * 1.5, 1.6 + h3 * 1.2, -1.2);
            const to = new THREE.Vector3((h2 - 0.5) * 5, 0.2 + h3 * 2.4, 9.5);
            p = from.lerp(to, e);
            p.y += Math.sin(e * Math.PI) * 0.8 * (h1 - 0.3);
            bt.root.visible = u > 0;
          } else {
            const a = d.wt * (0.8 + h1 * 0.6) + i * 1.7;
            const r = 3 + h2 * 3;
            p = new THREE.Vector3(Math.cos(a) * r, 4.2 + h3 * 2.5 + Math.sin(a * 2) * 0.4, -2 + Math.sin(a) * r * 0.6);
            bt.root.visible = true;
          }
        } else {
          // vortex round him
          const a = d.wt * (2.6 + h1) + i * ((Math.PI * 2) / NB) * 3;
          const r = 1.6 + h2 * 1.6;
          // always behind him (never across his face)
          p = new THREE.Vector3(H.x + Math.cos(a) * r * 1.3, 0.8 + (i / NB) * 3.8 + Math.sin(a * 3) * 0.2, H.z - 0.9 - Math.abs(Math.sin(a)) * r * 0.8);
          bt.root.visible = true;
        }
        bt.root.scale.setScalar((1.6 + h1 * 1.2) * (t < HERO ? 1.4 : 0.75));
        const prev = bt.root.position.clone();
        bt.root.position.copy(p);
        if (prev.distanceToSquared(p) > 1e-6) bt.root.lookAt(p.clone().add(p.clone().sub(prev)));
      }
    }
  });
}
