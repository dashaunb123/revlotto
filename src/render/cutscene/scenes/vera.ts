// VICE VERSA VERA: a vain glam backwards-diva, a jerk from the first frame. Everything is backwards.
// The picture opens upside down on a VHS rewind: her chrome-pink wedge screams in IN REVERSE, its tyre smoke
// sucked back INTO the wheels, and she isn't even looking: she's gazing into her hand mirror. The shot card-flips
// over to her, fluffing her bouffant and ignoring you completely; she notices you, rolls her eyes. She puckers up,
// blows you a kiss (a pink heart floats at the lens in slow-mo)... and it pops into a RASPBERRY, spit all over
// the lens. Left is right: the shots flip mirror-image cut to cut while she snaps her mirrored cat-eye shades
// down ("!NUF EVAH"). Then the big one, in slow-mo: she holds the mirror up to the lens. "MIRROR, MIRROR"...
// the reflection is a sneering swamp-hag monster, the glass cracks and SHATTERS into glittering shards at you,
// and through the empty frame she's still smirking. Hair toss: the whole picture flips left/right with it. Card.
import * as THREE from 'three';
import { Director, easeInOut, easeOut, lerp, rand, seg, type CardInfo } from '../director';
import { buildBossCar, buildCharacter } from '../models';
import type { VeraRig } from '../models/vera';
import { buildDragStrip, glowSprite, glowTexture } from '../stage';
import { faceCam, harshJerk, headPos, headR, mixLook, mountBoss, rate, rearPoints, talk } from './common';

const LANE = -2.6;
const PINK = 0xff4fa3;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Arm / torso / head pose on the outer pivots (the rig's idle and controls play on the inner ones). */
interface Pose {
  lx: number; // armL (mirror hand) forward raise (negative = forward/up)
  lz: number; // armL sideways (positive = out to her left)
  rx: number;
  rz: number; // armR (positive = across the body)
  tx: number;
  ty: number;
  hx: number; // head pitch (down +)
  hy: number; // head yaw (+ = toward her left)
  hz: number;
}
const P = (lx: number, lz: number, rx: number, rz: number, tx = 0, ty = 0, hx = 0, hy = 0, hz = 0): Pose => ({ lx, lz, rx, rz, tx, ty, hx, hy, hz });

/** A puffy 3D heart (the blown kiss). */
function heartMesh() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.5);
  s.bezierCurveTo(0.9, 0.1, 0.55, 0.85, 0, 0.42);
  s.bezierCurveTo(-0.55, 0.85, -0.9, 0.1, 0, -0.5);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.1, bevelSegments: 4, curveSegments: 18 });
  g.center();
  return new THREE.Mesh(g, new THREE.MeshToonMaterial({ color: 0xff3a9a, emissive: 0xff2a8a, emissiveIntensity: 0.35 }));
}

export default function vera(d: Director, card: CardInfo) {
  // ---------- set + light ----------
  const set = buildDragStrip(d.stage, { haze: 0x2a1438, sky: [0x3a1440, 0x0a0614], fogNear: 30, fogFar: 170 });
  d.crowd = set.crowd;
  d.hype = 0.5;
  const JERK = harshJerk(PINK, 0xc8d4ff);
  const GLAM = mixLook(JERK, harshJerk(0xff7ad0, 0xffffff), 0.5);
  GLAM.bloom = 1.15;
  const MONSTER = harshJerk(0x7aff3a, 0xff2a8a);
  MONSTER.exposure = 0.85;
  MONSTER.vignette = 0.9;
  d.look(0, JERK);
  const key = new THREE.PointLight(0xffb0e0, 3, 20, 1.3);
  key.position.set(0, 4, LANE + 5);
  d.scene.add(key);

  // ---------- Vera in her chrome wedge ----------
  const carRig = buildBossCar('vera');
  // polish the silver paint to chrome; the accent stays hot pink
  carRig.root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshToonMaterial | undefined;
    const look = m?.userData?.look as { uGloss: { value: number }; uShine: { value: number }; uRimK: { value: number } } | undefined;
    if (!m || !look || !m.color) return;
    const c = m.color;
    if (Math.abs(c.r - c.g) < 0.06 && c.b >= c.r && c.r > 0.35) {
      look.uGloss.value = 0.9;
      look.uShine.value = 110;
      look.uRimK.value = 1.1;
    }
  });
  const b = mountBoss(d, carRig, buildCharacter('vera'), 2.3);
  const car = b.car.root;
  car.position.set(0, 0, LANE);
  const rig = b.char as unknown as VeraRig;
  const mirror = rig.mirror;
  const head = b.char.head;
  const torso = rig.torso;
  b.char.root.position.y += 0.3;
  const R = headR(b);
  const armL0 = b.char.armL.rotation.clone();
  const armR0 = b.char.armR.rotation.clone();
  const torso0 = torso.rotation.clone();
  const head0 = head.rotation.clone();
  rig.setTurn(1);
  b.char.setExpression('smirk');
  rig.setHandPose('L', 'grip');
  rig.setHandPose('R', 'open');
  d.every((dt) => rig.setBeatDt(dt));
  d.onDispose(() => (d.stage.canvas.style.transform = ''));

  // car dressing: reverse lights, a backwards plate, a pink pinstripe
  car.updateWorldMatrix(true, true);
  const cb = new THREE.Box3().setFromObject(carRig.body);
  const rearX = cb.min.x - car.position.x;
  const glowTex = glowTexture();
  const revLights: THREE.Sprite[] = [];
  for (const s of [-1, 1]) {
    const sp = glowSprite(glowTex, 0xffffff, 0.6, 0);
    sp.position.set(rearX + 0.02, 0.62, s * 0.62);
    carRig.body.add(sp);
    revLights.push(sp);
  }
  {
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 32;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#fff0f8';
    g.fillRect(0, 0, 64, 32);
    g.strokeStyle = '#ff4fa3';
    g.lineWidth = 4;
    g.strokeRect(2, 2, 60, 28);
    g.fillStyle = '#c0186a';
    g.font = 'bold 18px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('AREV', 32, 17);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.31), new THREE.MeshBasicMaterial({ map: tex }));
    plate.position.set(rearX - 0.02, 0.5, 0);
    plate.rotation.y = -Math.PI / 2;
    carRig.body.add(plate);
  }

  // ---------- timeline ----------
  const UPRIGHT = 0.5; // the upside-down opening flips upright
  const STOP = 1.08; // screech to a stop
  const SHE = 1.25; // flip over to her: admiring herself
  const NOTICE = 2.05; // sees you, eye roll
  const KISS = 2.5; // pucker up
  const THROW = 2.9; // blows it
  const POP = 3.3; // ...raspberry
  const FLIPS = 4.0; // left is right
  const SHADES = 4.3;
  const LIFT = 5.0; // mirror to the lens
  const TRUTH = 5.55; // the monster
  const CRACK = 6.25;
  const SMASH = 6.55;
  const TOSS = 7.3; // hair toss flips the picture
  const CARD = 8.35;

  // ---------- poses ----------
  const ADMIRE = P(-1.55, 0.55, -2.6, 0.55, -0.02, 0.15, 0.05, 0.7, 0.12); // mirror up at her left, right hand fluffing the bouffant
  const ADMIRE2 = P(-1.5, 0.6, -2.75, 0.45, -0.02, 0.15, 0.02, 0.75, 0.18);
  const ROLL = P(-0.5, 0.25, -0.3, 0.05, 0, 0.05, -0.05, 0.05, -0.05);
  const PUCKER = P(-0.5, 0.05, -1.7, 0.75, 0.05, 0, 0.0, 0, 0.08); // flat hand at her lips
  const THROWN = P(-0.5, 0.05, -1.5, -0.1, 0.12, 0, -0.05, 0, -0.06); // arm out to the lens
  const RASP = P(-0.4, 0.05, -0.6, 0.05, 0.08, 0, -0.08, 0, 0.1);
  const COOL = P(-0.35, 0.05, -2.3, 0.35, 0, 0, -0.08, 0, -0.06); // shades push
  const TRUTHP = P(-1.75, -0.2, -0.25, 0, 0.05, 0, -0.05, 0, 0.05); // mirror held out at the lens
  const TOSSP = P(-0.4, 0.15, -2.4, 0.4, -0.05, 0, -0.12, 0, 0.1);
  const keys: [number, Pose][] = [
    [0, ADMIRE], [1.6, ADMIRE], [1.85, ADMIRE2], [NOTICE - 0.05, ADMIRE2], [NOTICE + 0.15, ROLL], [KISS - 0.05, ROLL], [KISS + 0.15, PUCKER],
    [THROW - 0.04, PUCKER], [THROW + 0.1, THROWN], [POP - 0.05, THROWN], [POP + 0.1, RASP], [SHADES - 0.12, RASP], [SHADES, COOL],
    [SHADES + 0.35, COOL], [SHADES + 0.55, RASP], [LIFT, RASP], [LIFT + 0.4, TRUTHP], [SMASH + 0.3, TRUTHP], [TOSS - 0.1, P(-0.5, 0.1, -0.4, 0.05, 0, 0, -0.08, 0, 0.05)],
    [TOSS + 0.15, TOSSP], [CARD, TOSSP],
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
    torso.rotation.set(torso0.x + pose.tx, torso0.y + pose.ty, torso0.z);
    head.rotation.set(head0.x + pose.hx, head0.y + pose.hy, head0.z + pose.hz);
  });

  // ---------- the mirror: keep it in her fist, aim the glass ----------
  // glassTo(t): where the glass faces ('face' = her own face, 'cam' = the lens)
  const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _m = new THREE.Matrix4();
  const _gp = new THREE.Vector3(), _tg = new THREE.Vector3(), _H = new THREE.Vector3();
  const aimMirror = (target: THREE.Vector3, k: number) => {
    const root = mirror.root;
    root.parent!.updateWorldMatrix(true, false);
    Director.wp(mirror.glass, _gp);
    const fwd = _tg.copy(target).sub(_gp).normalize();
    const up = V(0, 1, 0);
    const x = new THREE.Vector3().crossVectors(up, fwd).normalize();
    const y = new THREE.Vector3().crossVectors(fwd, x).normalize();
    _q.setFromRotationMatrix(_m.makeBasis(x, y, fwd));
    root.parent!.getWorldQuaternion(_pq);
    _q.premultiply(_pq.invert());
    root.quaternion.slerp(_q, k);
  };
  let mirrorAim: 'face' | 'cam' = 'face';
  d.at(0, () => (mirrorAim = 'face'));
  d.at(LIFT + 0.05, () => (mirrorAim = 'cam'));
  d.at(TOSS, () => (mirrorAim = 'face'));
  d.every(() => {
    b.char.root.updateWorldMatrix(true, true);
    if (mirrorAim === 'face') aimMirror(headPos(b, _H), 1);
    else aimMirror(d.stage.camera.position, 1);
  });

  // ---------- picture flips (CSS on the 3D canvas only; the card overlay stays readable) ----------
  // [t0, dur, axis, from, to]: scale goes from -> to through 0 (edge-on) at the midpoint, where the cut lands
  const flips: [number, number, 'x' | 'y', number, number][] = [
    [UPRIGHT, 0.2, 'y', -1, 1],
    [SHE - 0.1, 0.2, 'x', 1, -1],
    [FLIPS + 0.42, 0.16, 'x', -1, 1],
    [FLIPS + 0.78, 0.16, 'x', 1, -1],
    [LIFT - 0.1, 0.2, 'x', -1, 1],
    [TOSS + 0.05, 0.22, 'x', 1, -1],
    [TOSS + 0.5, 0.22, 'x', -1, 1],
  ];
  const scaleAt = (t: number) => {
    let sx = 1, sy = -1; // opens upside down
    for (const [t0, dur, ax, a, bb] of flips) {
      if (t < t0) break;
      const u = seg(t, t0, t0 + dur);
      const v = u >= 1 ? bb : lerp(a, bb, (1 - Math.cos(u * Math.PI)) / 2);
      if (ax === 'x') sx = v;
      else sy = v;
    }
    return [sx, sy];
  };
  // the opening is also mirrored left/right (a car "driving forward" that is really reversing)
  d.every(() => {
    const [sx, sy] = scaleAt(d.t);
    const fx = Math.abs(sx) < 0.04 ? 0.04 * Math.sign(sx || 1) : sx;
    const fy = Math.abs(sy) < 0.04 ? 0.04 * Math.sign(sy || 1) : sy;
    d.stage.canvas.style.transform = fx === 1 && fy === 1 ? '' : `scale(${fx.toFixed(3)}, ${fy.toFixed(3)})`;
  });
  for (const [t0, dur] of flips)
    d.at(t0, () => {
      d.sfx.whoosh();
      d.flash('#ffd0ec', 0.18, 12);
      void dur;
    });

  // =====================================================================================
  // 0: VHS rewind, upside down. The wedge screams in IN REVERSE; the smoke gets sucked back into the tyres.
  // =====================================================================================
  d.bars(true);
  const carX = (t: number) => lerp(26, 0, easeOut(seg(t, 0.05, STOP)));
  d.span(0, STOP + 0.4, (u) => {
    const t = d.t;
    car.position.x = carX(t) + (t > STOP ? Math.sin((t - STOP) * 40) * 0.05 * (1 - seg(t, STOP, STOP + 0.4)) : 0);
    const moving = t < STOP;
    b.car.setWheelSpin(moving ? -40 * (1 - seg(t, 0.6, STOP)) - 6 : 0);
    // nose dips on the hard stop (reversing: the tail squats)
    b.car.setLean(0, t > STOP - 0.05 ? -0.08 * Math.exp(-(t - STOP) * 6) * Math.cos((t - STOP) * 18) : 0.03);
    b.car.setSteer(0.2 * Math.sin(t * 3));
    for (const s of revLights) (s.material as THREE.SpriteMaterial).opacity = u >= 1 ? 0.6 : 0.95;
  });
  d.cut(0, [-8.5, 0.55, LANE + 3.6], [8, 1.1, LANE], 42, 0.05);
  d.follow(0.02, STOP + 0.15, () => {
    const c = V(car.position.x, 1.1, LANE);
    return { pos: V(lerp(-8.5, -7.2, seg(d.t, 0, STOP)), 0.55, LANE + 3.6), look: c, fov: lerp(42, 34, easeOut(seg(d.t, 0.2, STOP))) };
  });
  d.stamp(0.05, '<< REW', { color: '#ffffff', x: 96, y: 52, size: 16, rot: 0, dur: 1.1 });
  d.glitch(0.0, 0.18, 0.45);
  d.glitch(UPRIGHT - 0.05, UPRIGHT + 0.12, 0.35);
  d.at(0.15, () => (d.sfx as unknown as Record<string, (() => void) | undefined>).reverseBeep?.());
  d.at(0.25, () => d.sfx.roar('vera'));
  d.at(STOP - 0.12, () => d.sfx.drift(0.7));
  d.at(STOP, () => {
    d.cam.shake(0.7);
    d.cam.punch(-5);
    d.sfx.impact();
  });
  // backwards smoke: puffs appear out in the air and rush INTO the rear tyres, shrinking
  const suck = rate(40);
  d.every((_dt, wdt) => {
    if (d.t > STOP + 0.1) return;
    const n = suck(wdt, 1);
    if (!n) return;
    const rp = rearPoints(b);
    for (let i = 0; i < n; i++) {
      const p = rp[i % rp.length];
      const off = V(rand(1.2, 3.2), rand(0.4, 1.6), (p.z > LANE ? 1 : -1) * rand(1.0, 2.6));
      d.fx.smoke(p.clone().add(off), 1, { color: 0xf0e4f4, size: rand(0.6, 0.9), grow: 0.15, life: 0.35, spread: 0, vel: off.clone().multiplyScalar(-1 / 0.35).setY(-off.y / 0.35), drag: 0, gravity: 0 });
    }
  });

  // =====================================================================================
  // 1.25: flip over to her. Gazing into her mirror, fluffing the bouffant. You don't exist.
  // =====================================================================================
  const fc = (dist: number, yaw: number, up: number, lookUp: number, fov: number, roll = 0) => ({ ...faceCam(b, dist, yaw, up, lookUp), fov, roll });
  d.follow(SHE, NOTICE + 0.25, (u) => fc(lerp(8.2, 6.6, easeOut(u)), lerp(0.55, 0.42, u), -0.4, -0.6, 34, 0.04));
  d.at(SHE, () => {
    rig.setAdmire(1);
    rig.setLook(-1, 0.1);
    d.cam.punch(-3);
    d.sfx.sparkle();
  });
  d.span(SHE, NOTICE, (u) => rig.setHandPose('R', u >= 1 ? 'open' : Math.sin(u * 30) > 0 ? 'flat' : 'open'));
  for (let i = 0; i < 6; i++)
    d.at(SHE + 0.1 + i * 0.12, () => {
      headPos(b, _H);
      d.sparkle(_H.clone().add(V(rand(-1.4, 1.4) * R, rand(0.6, 1.8) * R, rand(0, 0.8) * R)), 10 + (i % 3) * 4, i % 2 ? '#ffffff' : '#ffb8e0');
    });
  d.at(1.75, () => d.sfx.sparkle());
  // ...she notices you. In the mirror. Ugh.
  d.at(NOTICE, () => {
    rig.setAdmire(0);
    rig.setEyeRoll(1);
    rig.setLook(0, 0);
    d.cam.punch(-4);
  });
  d.at(NOTICE + 0.05, () => d.sfx.voice('vera', 'laugh'));
  d.stamp(NOTICE + 0.05, 'UGH.', { color: '#ffb8e0', x: 470, y: 86, size: 16, rot: 0.1, dur: 0.5 });

  // =====================================================================================
  // 2.5: pucker up, blow a kiss... the heart floats at the lens in slow-mo... POP: a raspberry.
  // =====================================================================================
  d.follow(KISS, POP, (u) => fc(lerp(6.2, 5.2, easeOut(u)), 0.15, -0.6, -0.3, 30, -0.03));
  d.at(KISS, () => {
    rig.setEyeRoll(0);
    rig.setKiss(1);
    rig.setHandPose('R', 'flat');
    d.cam.punch(-3);
  });
  d.at(KISS + 0.25, () => (d.sfx as unknown as Record<string, (() => void) | undefined>).kiss?.());
  const heart = heartMesh();
  heart.visible = false;
  d.scene.add(heart);
  d.slowmo(THROW + 0.05, POP + 0.02, 0.3, 0.08, false);
  let hFrom: THREE.Vector3 | null = null;
  d.at(THROW, () => {
    rig.setKiss(0.3);
    rig.setHandPose('R', 'open');
    hFrom = Director.wp(rig.props.handR);
    heart.visible = true;
    d.sfx.whoosh();
  });
  d.span(THROW, POP, (u) => {
    if (!hFrom) return;
    const c = d.stage.camera;
    const f = new THREE.Vector3();
    c.getWorldDirection(f);
    const right = f.clone().cross(c.up).normalize();
    const to = c.position.clone().addScaledVector(f, 2.4).addScaledVector(right, 0.3).add(V(0, 0.1, 0));
    heart.position.lerpVectors(hFrom, to, easeOut(u));
    heart.position.y += Math.sin(u * Math.PI) * 0.4;
    heart.lookAt(c.position);
    heart.rotateZ(Math.sin(u * 12) * 0.25);
    const s = (0.15 + 0.3 * u) * (1 + 0.15 * Math.sin(u * 40));
    heart.scale.setScalar(s);
    if (u >= 1) heart.visible = false;
  });
  // POP
  d.at(POP, () => {
    heart.visible = false;
    for (let i = 0; i < 18; i++) d.fx.glow.spawn(heart.position, { life: 0.4, size: 0.08, color: i % 2 ? 0xff4fa3 : 0xffffff, spread: 5, gravity: 4 });
    rig.setKiss(0);
    rig.setRaspberry(1);
    d.cam.punch(-8);
    d.cam.shake(0.8);
    d.sfx.slap();
  });
  d.at(POP + 0.02, () => (d.sfx as unknown as Record<string, (() => void) | undefined>).raspberry?.());
  d.cut(POP, faceCam(b, 4.6, 0.05, -0.15, -0.1).pos, faceCam(b, 4.6, 0.05, -0.15, -0.1).look, 30, 0.05);
  d.follow(POP, FLIPS, (u) => fc(lerp(4.6, 4.0, easeOut(u)), 0.05, -0.15, -0.1, 30, lerp(0.05, -0.04, u)));
  d.stamp(POP + 0.04, 'PFFFBT!', { color: '#ff4fa3', x: 470, y: 90, size: 24, rot: 0.1, dur: 0.8, burst: '#ffffff' });
  // spit spray at the lens
  const spit = rate(30);
  d.every((_dt, wdt) => {
    if (d.t < POP || d.t > POP + 0.55) return;
    const n = spit(wdt, 1);
    if (!n) return;
    const mouth = headPos(b, new THREE.Vector3()).add(V(0, -0.45 * R, 0));
    const toCam = d.stage.camera.position.clone().sub(mouth).normalize();
    for (let i = 0; i < n; i++)
      d.fx.glow.spawn(mouth.clone().addScaledVector(toCam, 0.9 * R), { life: 0.3, size: rand(0.01, 0.018), color: 0xe0f4ff, vel: toCam.clone().multiplyScalar(rand(6, 10)), spread: 2.2, gravity: 3, stretch: 0.04 });
  });

  // =====================================================================================
  // 4.0: left is right. The picture flips mirror-image cut to cut; the shades snap down. "!NUF EVAH"
  // =====================================================================================
  d.at(FLIPS - 0.1, () => rig.setRaspberry(0));
  d.cut(FLIPS, fc(5.4, -0.55, -0.2, -0.2, 32, -0.12).pos, fc(5.4, -0.55, -0.2, -0.2, 32).look, 32, -0.12);
  d.follow(FLIPS, FLIPS + 0.5, (u) => fc(lerp(5.4, 5.0, u), -0.55, -0.2, -0.2, 32, -0.12));
  d.follow(FLIPS + 0.5, FLIPS + 0.86, (u) => fc(lerp(5.0, 4.6, u), 0.6, -0.4, -0.2, 32, 0.12));
  d.follow(FLIPS + 0.86, LIFT, (u) => fc(lerp(4.6, 4.2, u), -0.2, -0.3, -0.2, 30, -0.05));
  d.at(SHADES, () => {
    rig.setShades(1);
    rig.setHandPose('R', 'flat');
    d.cam.punch(-5);
    d.cam.shake(0.3);
    d.sfx.tink();
  });
  d.at(SHADES + 0.12, () => {
    Director.wp(rig.props.shades, _H);
    d.sparkle(_H.clone().add(V(0.25 * R, 0.6 * R, 0.9 * R)), 22, '#ffffff');
    d.sfx.sparkle();
  });
  d.stamp(FLIPS + 0.5, '!NUF EVAH', { color: '#ffb8e0', x: 200, y: 92, size: 24, rot: -0.1, dur: 0.85 });
  d.at(FLIPS + 0.55, () => d.sfx.voice('vera', 'taunt'));
  talk(d, b, FLIPS + 0.55, 0.45);

  // =====================================================================================
  // 5.0: the big one. Slow-mo: she holds the mirror up to the lens. MIRROR, MIRROR... the truth: a sneering
  // monster. Cracks. SHATTER: glittering shards at you. Through the empty frame, she's still smirking.
  // =====================================================================================
  d.slowmo(LIFT + 0.2, SMASH + 0.55, 0.2, 0.25);
  d.look(LIFT, GLAM, 0.3);
  const mirrorCam = (dist: number, fov: number) => {
    // straight down the glass's axis, looking at it, her face just behind it
    Director.wp(mirror.glass, _gp);
    headPos(b, _H);
    const dir = _gp.clone().sub(_H).normalize();
    return { pos: _gp.clone().addScaledVector(dir, dist).add(V(0, 0.05, 0)), look: _gp.clone().lerp(_H, 0.15), fov };
  };
  d.follow(LIFT, TRUTH, (u) => {
    const a = fc(4.0, -0.2, -0.3, -0.2, 30);
    const m = mirrorCam(lerp(3.2, 2.0, easeInOut(u)), 30);
    const k = easeInOut(seg(u, 0.2, 1));
    return { pos: a.pos.lerp(m.pos, k), look: a.look.lerp(m.look, k), fov: lerp(30, 32, k), roll: lerp(-0.05, 0, k) };
  });
  d.follow(TRUTH, SMASH, (u) => mirrorCam(lerp(2.0, 1.55, easeOut(u)), 34));
  d.at(LIFT, () => {
    rig.setShades(1);
    mirror.reset();
    mirror.setReflection('self');
    mirror.setCrack(0);
  });
  // the truth flickers in
  d.glitch(TRUTH, TRUTH + 0.22, 0.7);
  d.span(TRUTH, TRUTH + 0.22, (u) => mirror.setReflection(u >= 1 || Director.flip(d.t, TRUTH, TRUTH + 0.22) ? 'monster' : 'self'));
  d.look(TRUTH + 0.22, MONSTER);
  d.span(TRUTH + 0.22, CRACK, (u) => mirror.setSnarl(easeOut(u) + Math.sin(u * 40) * 0.08));
  d.at(TRUTH + 0.22, () => {
    d.cam.punch(-6);
    d.cam.shake(0.6);
    d.sfx.roar('vera');
    d.flash('#7aff3a', 0.25, 10);
  });
  d.stamp(TRUTH + 0.3, 'MIRROR,\nMIRROR', { color: '#7aff3a', x: 480, y: 70, size: 24, rot: 0.08, dur: 1.2 });
  // cracks
  d.span(CRACK, SMASH, (u) => mirror.setCrack(u >= 1 ? 1 : 0.15 + 0.85 * easeOut(u)));
  for (const t of [CRACK, CRACK + 0.12, CRACK + 0.22])
    d.at(t, () => {
      d.sfx.tink();
      d.cam.shake(0.25);
    });
  // SHATTER
  d.impactFrame(SMASH, 'invert', 2);
  const shards: { m: THREE.Mesh; v: THREE.Vector3; w: THREE.Vector3 }[] = [];
  d.at(SMASH, () => {
    const list = mirror.shatter();
    const cam = d.stage.camera.position.clone();
    Director.wp(mirror.glass, _gp);
    for (const m of list) {
      d.scene.attach(m);
      const away = m.position.clone().sub(_gp);
      const v = cam.clone().sub(m.position).normalize().multiplyScalar(rand(5, 9)).addScaledVector(away, rand(10, 18)).add(V(0, rand(0.5, 2.0), 0));
      shards.push({ m, v, w: V(rand(-9, 9), rand(-9, 9), rand(-9, 9)) });
    }
    for (let i = 0; i < 60; i++)
      d.fx.glow.spawn(_gp, { life: rand(0.5, 0.9), size: rand(0.03, 0.08), color: [0xffffff, 0xff8ad0, 0xc8d8ff][i % 3], spread: 7, gravity: 2.5, vel: cam.clone().sub(_gp).normalize().multiplyScalar(3) });
    d.flash('#ffffff', 0.5, 12);
    d.cam.punch(-6);
    d.cam.shake(1.2);
    d.sfx.impact();
    d.sfx.crunch();
    (d.sfx as unknown as Record<string, (() => void) | undefined>).glassShatter?.();
  });
  d.every((_dt, wdt) => {
    for (const s of shards) {
      s.v.y -= 6 * wdt;
      s.m.position.addScaledVector(s.v, wdt);
      s.m.rotation.x += s.w.x * wdt;
      s.m.rotation.y += s.w.y * wdt;
      s.m.rotation.z += s.w.z * wdt;
    }
  });
  // glitter twinkles drifting through the slow-mo
  for (let i = 0; i < 10; i++)
    d.at(SMASH + 0.05 + i * 0.07, () => {
      Director.wp(mirror.glass, _gp);
      d.sparkle(_gp.clone().add(V(rand(-1, 1), rand(-0.8, 0.8), rand(0, 1))), 10 + (i % 3) * 5, i % 2 ? '#ffffff' : '#ff8ad0');
    });
  d.look(SMASH, GLAM, 0.2);
  // pull back: through the empty frame, she's smirking
  d.follow(SMASH, TOSS, (u) => {
    const m = mirrorCam(lerp(1.55, 3.2, easeOut(u)), lerp(34, 36, u));
    return { ...m, roll: lerp(0, 0.06, u) };
  });
  d.at(SMASH + 0.3, () => {
    rig.setShades(0.0);
    b.char.setExpression('grin');
  });
  d.at(SMASH + 0.35, () => d.sfx.voice('vera', 'laugh'));

  // =====================================================================================
  // 7.3: hair toss. The whole picture flips with it. Card.
  // =====================================================================================
  const heroCam = () => {
    const f = faceCam(b, 6.6, 0.25, -2.4, 0);
    const c = f.pos;
    const hp = f.look;
    const fov = 40;
    const dir = hp.clone().sub(c).normalize();
    const right = dir.clone().cross(V(0, 1, 0)).normalize();
    const up = right.clone().cross(dir).normalize();
    const dist = c.distanceTo(hp);
    const ty = Math.tan(THREE.MathUtils.degToRad(fov / 2));
    const tx = ty * (16 / 9);
    const look = hp.clone().addScaledVector(right, -0.5 * tx * dist).addScaledVector(up, -0.3 * ty * dist);
    return { pos: c, look, fov };
  };
  d.at(TOSS, () => {
    b.char.setSignature(1);
    b.char.setExpression('smirk');
    rig.setLook(0, -0.5);
    d.sfx.signature('vera');
    d.cam.punch(-6);
  });
  d.follow(TOSS, 30, (u) => {
    const h = heroCam();
    return { pos: h.pos.add(V(0, lerp(0.3, 0, easeOut(u * 4)), 0)), look: h.look, fov: lerp(44, 40, easeOut(Math.min(1, u * 6))), roll: 0.06 };
  });
  d.at(CARD - 0.3, () => b.char.setSignature(0.35));
  d.look(TOSS, GLAM);
  for (let i = 0; i < 8; i++)
    d.at(TOSS + 0.05 + i * 0.1, () => {
      headPos(b, _H);
      d.sparkle(_H.clone().add(V(rand(-1.6, 1.6) * R, rand(0.4, 2.2) * R, rand(0, 1) * R)), 12, i % 2 ? '#ffffff' : '#ffb8e0');
    });

  // ---------- card ----------
  d.freeze(CARD, 0.25, 0.6);
  d.nameCard(CARD, { ...card, color: '#ff4fa3', accent: '#ffffff', layout: 'left' }, 0.9, 'vera');
  d.at(CARD + 0.7, () => d.sfx.voice('vera', 'taunt'));

  d.onDispose(() => {
    heart.geometry.dispose();
    (heart.material as THREE.Material).dispose();
    for (const s of shards) s.m.removeFromParent();
  });
}
