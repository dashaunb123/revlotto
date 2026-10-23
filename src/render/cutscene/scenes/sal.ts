// SHORTSTACK SAL: a tiny, hot-headed motormouth with a Napoleon complex and a towering pompadour. He is yelling
// from the first frame and never stops. His orange compact skids in and all you can see over the door is a
// pompadour and a pair of wraparound shades, hopping ("HEY! HEY YOU!"). He springs out of the window on his
// little legs, storms over and KICKS your tyre (the hubcap pops off). He whistles: a stack of phone books rains
// down THUD THUD THUD, he hops on top, finally taller than you, slides his shades down and pokes the lens
// ("WHO YOU CALLIN' SHORT?!"). He holds up a comically tiny gearstick and shifts it way before redline (CLICK,
// "SHORT IS FAST") - and the click topples the stack. Slow-mo: books everywhere, arms windmilling, still yelling,
// he face-plants right in front of the lens ("I MEANT TO DO THAT!"). Cut: he's up on the heap, hand tucked in
// his jacket, chin up: NAPOLEON MODE. Card.
import * as THREE from 'three';
import { Director, easeBack, easeInOut, easeOut, lerp, seg, type CardInfo } from '../director';
import { buildBossCar, buildCar3D, buildCharacter } from '../models';
import type { SalRig } from '../models/sal';
import { BOOK_STYLES, buildPhoneBook, buildTinyShifter } from '../models/sal_props';
import { buildDragStrip } from '../stage';
import type { CarRig } from '../types';
import { harshJerk, headPos, headR, rays, type Boss } from './common';

type Sfx = Record<string, ((...a: unknown[]) => void) | undefined>;

// ---- timeline (real seconds) ----
const STOP = 0.95; // his car skids to a stop
const PEEK = 1.0; // pompadour + shades hopping over the door
const HOP = 1.85; // he springs out of the window
const LAND = 2.25;
const KICK = 3.0; // boot meets your tyre
const WHISTLE = 3.35;
const BOOK0 = 3.55; // first phone book lands
const BOOK_DT = 0.12;
const NBOOKS = 6;
const CLIMB = 4.32; // hops up the stack
const GLARE = 4.6; // shades down, looming over you
const POKES = [5.0, 5.25, 5.5];
const SHIFT0 = 5.8; // the tiny gearstick comes out
const CLICK = 6.2; // ... and he shifts it
const TIP = 6.5; // the stack goes
const LANDF = 7.55; // face-plant in front of the lens
const HERO = 8.0;
const CARD = 8.6;

const SAL_LANE = -2.6;
const YOU_LANE = 2.6;
const S = 0.5; // Sal's rig scale (he is TINY)

export default function sal(d: Director, card: CardInfo) {
  const sx = d.sfx as unknown as Sfx;
  const sfx = (name: string, fallback: () => void) => (sx[name] ? sx[name]!() : fallback());
  const set = buildDragStrip(d.stage, { haze: 0x241a30, sky: [0x2a1830, 0x07060d], fogNear: 30, fogFar: 170 });
  d.crowd = set.crowd;
  d.look(0, harshJerk(0xff8a1f, 0x3a6aff));

  // ---- his car + Sal (manual mount: he is much smaller than the other bosses) ----
  const car = d.rig(buildBossCar('sal'));
  d.scene.add(car.root);
  car.root.position.set(-30, 0, SAL_LANE);
  car.root.updateWorldMatrix(true, true);
  const cbox = new THREE.Box3().setFromObject(car.root);
  const ch = buildCharacter('sal') as SalRig;
  d.rig(ch);
  ch.root.scale.setScalar(S);
  ch.legs.visible = false;
  // stood up at the driver's window, so short only the pompadour and the shades clear the sill
  const SEAT_Y = -0.84;
  ch.root.position.set(0, SEAT_Y, 0.3);
  car.seat.add(ch.root);
  const b: Boss = { car, char: ch, size: cbox.getSize(new THREE.Vector3()), roofY: cbox.max.y };
  ch.setTurn(1); // a jerk from frame 0
  ch.setExpression('yell');
  d.every((dt) => ch.setBeatDt(dt));
  headR(b);
  const R = headR(b);

  // decorate his car: a "½" racing roundel on the door (he had it made himself)
  {
    const tex = numberTexture();
    const numMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
    const num = new THREE.Mesh(new THREE.CircleGeometry(0.3, 24), numMat);
    num.position.set(0.35, 0.55, 0.905);
    car.body.add(num);
    d.onDispose(() => (tex.dispose(), numMat.dispose(), num.geometry.dispose()));
  }

  // ---- your car (parked in your lane; he storms over to it) ----
  const pc = d.rig(buildCar3D({ body: 'muscle', color: '#f7d23e', accent: '#e8413c' }) as unknown as CarRig);
  pc.root.position.set(0, 0, YOU_LANE);
  d.scene.add(pc.root);
  // your front-left (camera side is -Z here) wheel: a hubcap he can boot off
  const WHEEL = new THREE.Vector3(1.364, 0.403, YOU_LANE - 1.0);
  const capMat = new THREE.MeshToonMaterial({ color: 0xe8ecf4 });
  const capG = new THREE.CylinderGeometry(0.24, 0.24, 0.05, 24);
  capG.rotateX(Math.PI / 2);
  const hubcap = new THREE.Mesh(capG, capMat);
  hubcap.position.copy(WHEEL).setZ(WHEEL.z - 0.13);
  d.scene.add(hubcap);
  d.onDispose(() => (capG.dispose(), capMat.dispose()));

  // ---- phone books (they rain down next to him) ----
  const STACK = new THREE.Vector3(0.55, 0, 1.1);
  const BS = 0.6; // book scale
  const stack = new THREE.Group(); // tips about its front-bottom edge
  stack.position.copy(STACK);
  d.scene.add(stack);
  const books: { g: THREE.Group; y: number; yaw: number; land: number; dz: number }[] = [];
  let top = 0;
  for (let i = 0; i < NBOOKS; i++) {
    const st = BOOK_STYLES[i % BOOK_STYLES.length];
    const p = buildPhoneBook(st);
    d.rig(p as unknown as CarRig);
    const g = new THREE.Group();
    g.add(p.root);
    p.root.scale.setScalar(BS);
    p.root.position.y = 0;
    g.visible = false;
    stack.add(g);
    const yaw = Math.sin(i * 2.7) * 0.22;
    books.push({ g, y: top, yaw, land: BOOK0 + i * BOOK_DT, dz: Math.sin(i * 1.9) * 0.03 });
    top += st.h * BS;
  }
  const STACK_H = top;

  // ---- tiny gearstick ----
  const shifter = buildTinyShifter();
  d.rig(shifter as unknown as CarRig);
  shifter.root.visible = false;

  // rays behind him for the hero beat
  const ray = rays(0xff8a1f, 16, 9, { opacity: 0.4 });
  ray.visible = false;
  d.scene.add(ray);

  // ---- Sal's body state (root is ours; the rig animates the insides) ----
  const P = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, roll: 0, squash: 0 };
  let onGround = false;
  const camPos = new THREE.Vector3();
  const H = new THREE.Vector3();

  const leaveCar = () => {
    if (!onGround) {
      d.scene.attach(ch.root);
      ch.root.scale.setScalar(S);
      ch.legs.visible = true;
      onGround = true;
    }
  };
  d.every(() => {
    if (!onGround) return;
    ch.root.position.set(P.x, P.y, P.z);
    ch.root.rotation.set(P.pitch, P.yaw, P.roll, 'YXZ');
    ch.root.scale.set(S * (1 + 0.25 * P.squash), S * (1 - 0.3 * P.squash), S * (1 + 0.25 * P.squash));
  });

  // ===================== 1. SKID IN =====================
  d.bars(true);
  const CAR_X = 0.4;
  d.span(0, STOP, (u) => {
    const k = 1 - Math.pow(1 - u, 2.6);
    car.root.position.x = lerp(-30, CAR_X, k);
    car.setWheelSpin(lerp(80, 4, u), lerp(110, 10, u));
    car.setLean(0, -0.04 * (1 - u));
  });
  d.span(STOP, STOP + 0.8, (u) => {
    const a = (1 - u) ** 2;
    car.setLean(Math.sin(u * 20) * 0.04 * a, 0.09 * a * Math.cos(u * 14));
    car.setWheelSpin(0, 0);
  });
  d.at(0.1, () => {
    d.sfx.drift(0.85);
    d.hype = 0.5;
  });
  d.at(0.05, () => d.sfx.roar('sal'));
  d.every((_dt, wdt) => {
    if (d.t > 0.25 && d.t < STOP + 0.05) {
      const pts = car.rearContacts.map((o) => Director.wp(o));
      for (const p of pts) if (Math.random() < wdt * 60) d.fx.smoke(p, 1, { vel: { x: -2, y: 1, z: 0 }, size: 0.6, spread: 0.8, outline: false });
    }
  });
  d.cut(0, [9, 0.45, -0.4], [0, 0.7, SAL_LANE], 34, 0.06);
  d.follow(0, STOP, (u) => ({
    pos: new THREE.Vector3(lerp(9, 4.2, easeOut(u)), lerp(0.45, 0.7, u), lerp(-0.4, 0.4, u)),
    look: car.root.position.clone().add(new THREE.Vector3(1, 0.7, 0)),
    fov: lerp(34, 40, u),
    roll: lerp(0.06, -0.04, u),
  }));
  d.at(STOP, () => {
    d.cam.shake(0.7);
    d.cam.punch(-7);
    d.flash('#ffffff', 0.5, 10);
    d.fx.smoke(Director.wp(car.rearContacts[0] ?? car.root), 10, { size: 0.8, vel: { x: -2, y: 1.2, z: 1 }, spread: 1, outline: false });
  });

  // ===================== 2. PEEK: pompadour and shades bouncing over the door =====================
  d.follow(PEEK, HOP, (u) => {
    const sp = Director.wp(car.seat);
    const look = sp.clone().add(new THREE.Vector3(0, 0.22, 0));
    return { pos: look.clone().add(new THREE.Vector3(0.35 - 0.1 * u, 0.05, 2.5 - 0.3 * u)), look, fov: 34, roll: -0.05 };
  });
  d.span(PEEK, HOP, (u) => {
    const tt = (u * (HOP - PEEK)) / 0.24;
    const hop = Math.abs(Math.sin(tt * Math.PI));
    ch.root.position.y = SEAT_Y + 0.13 * hop + 0.12 * seg(u, 0.75, 1);
    ch.root.rotation.z = Math.sin(tt * Math.PI) * 0.05;
  });
  d.at(PEEK + 0.05, () => {
    d.sfx.voice('sal', 'yell');
    talkSpan(PEEK + 0.05, HOP - PEEK + 0.2);
  });
  d.stamp(PEEK + 0.12, 'HEY!', { color: '#ff8a1f', x: 170, y: 110, size: 24, rot: -0.15, dur: 0.4, burst: '#ffffff' });
  d.stamp(PEEK + 0.42, 'HEY YOU!!', { color: '#ffd23f', x: 470, y: 90, size: 24, rot: 0.1, dur: 0.5, burst: '#ff4a2a' });

  // ===================== 3. HOP OUT and STORM OVER =====================
  const HOP_TO = new THREE.Vector3(1.25, 0, -0.5);
  const KICK_AT = new THREE.Vector3(WHEEL.x, 0, WHEEL.z - 0.34);
  let hopFrom = new THREE.Vector3();
  d.at(HOP, () => {
    leaveCar();
    hopFrom = ch.root.position.clone();
    P.x = hopFrom.x;
    P.y = hopFrom.y;
    P.z = hopFrom.z;
    ch.setFlail(1);
    sx.whoosh?.();
  });
  d.span(HOP, LAND, (u) => {
    if (!onGround) return;
    // straight up out of the window first, then over and down
    const o = easeInOut(seg(u, 0.28, 1));
    P.x = lerp(hopFrom.x, HOP_TO.x, o);
    P.z = lerp(hopFrom.z, HOP_TO.z, o);
    P.y = lerp(hopFrom.y, 0, u * u) + 1.5 * Math.sin(Math.min(1, u * 1.2) * Math.PI) * (1 - 0.2 * u);
    P.pitch = 0.3 * Math.sin(u * Math.PI);
    ch.setFlail(1 - seg(u, 0.75, 1));
  });
  d.at(LAND, () => {
    d.fx.dust(new THREE.Vector3(HOP_TO.x, 0.05, HOP_TO.z), 14, { vel: { x: 0, y: 0.6, z: 0 }, spread: 1.2, size: 0.3 });
    d.cam.shake(0.35);
    sx.impact?.();
  });
  d.span(LAND, LAND + 0.18, (u) => (P.squash = Math.sin(u * Math.PI) * 0.9));
  // storm: furious waddle (tantrum fists) to your front tyre
  d.span(LAND + 0.15, KICK - 0.17, (u) => {
    const e = easeInOut(u);
    P.x = lerp(HOP_TO.x, KICK_AT.x, e);
    P.z = lerp(HOP_TO.z, KICK_AT.z, e);
    P.yaw = 0.3 * Math.sin(u * Math.PI);
    ch.setStep(u * Math.PI * 7);
    ch.setStepAmt(u >= 1 ? 0 : 1);
    ch.setSignature(u >= 1 ? 0 : 0.7);
  });
  d.cut(HOP, [CAR_X + 3.4, 1.0, 1.4], [CAR_X + 0.8, 0.9, -1.2], 40, 0.04);
  d.follow(HOP, LAND + 0.15, () => {
    headPos(b, H);
    return { pos: new THREE.Vector3(CAR_X + 3.4, 1.0, 1.4), look: H.clone().lerp(new THREE.Vector3(1.0, 0.6, -0.6), 0.5), fov: 40, roll: 0.04 };
  });
  // low "your tyre" shot: tyre in the right foreground, the little guy marching in
  const TYRE_CAM = new THREE.Vector3(WHEEL.x + 1.75, 0.36, WHEEL.z - 0.28);
  d.cut(LAND + 0.15, TYRE_CAM.toArray() as [number, number, number], [WHEEL.x - 0.6, 0.45, WHEEL.z - 0.6], 42, -0.06);
  d.follow(LAND + 0.15, WHISTLE, (u) => {
    headPos(b, H);
    const look = new THREE.Vector3(WHEEL.x - 0.1, 0.45, lerp(WHEEL.z - 0.8, WHEEL.z - 0.3, easeOut(u)));
    look.lerp(H, 0.25);
    return { pos: TYRE_CAM.clone().add(new THREE.Vector3(-0.2 * u, 0, 0)), look, fov: lerp(46, 42, u), roll: -0.06 };
  });
  d.at(LAND + 0.2, () => talkSpan(LAND + 0.2, KICK - LAND - 0.3));

  // ===================== 4. KICK =====================
  d.span(KICK - 0.17, KICK, (u) => ch.setKick(0.5 * easeOut(u)));
  d.span(KICK, KICK + 0.06, (u) => ch.setKick(0.5 + 0.5 * u));
  d.span(KICK + 0.25, KICK + 0.45, (u) => ch.setKick(1 - u));
  let capFlying = false;
  d.at(KICK, () => {
    sfx('tireKick', () => (d.sfx.slap(), d.sfx.impact()));
    d.cam.shake(0.8);
    d.cam.punch(-6);
    d.flash('#ffffff', 0.45, 12);
    d.fx.sparks(WHEEL.clone().setZ(WHEEL.z - 0.2), 18, { color: 0xfff2a0, vel: { x: 0, y: 2, z: -2 }, spread: 2.5, gravity: 8, size: 0.06 });
    capFlying = true;
    d.hype = 0.8;
  });
  d.impactFrame(KICK, 'invert', 1);
  d.span(KICK, KICK + 0.6, (u) => {
    const a = (1 - u) ** 2;
    pc.setLean(Math.sin(u * 30) * 0.05 * a, 0);
  });
  d.span(KICK, KICK + 1.4, (u) => {
    if (!capFlying) return;
    const t = u * 1.4;
    hubcap.position.set(WHEEL.x + 0.9 * t, WHEEL.y + 2.6 * t - 4.9 * t * t, WHEEL.z - 0.13 - 1.6 * t);
    if (hubcap.position.y < 0.24) hubcap.position.y = 0.24;
    hubcap.rotation.set(t * 9, t * 14, 0);
  });
  d.at(KICK + 0.05, () => sx.tink?.());
  d.stamp(KICK + 0.02, 'KICK!', { color: '#ff8a1f', x: 530, y: 70, size: 24, rot: 0.14, dur: 0.45, burst: '#ffffff' });
  d.at(KICK + 0.1, () => ch.setExpression('crazy'));
  d.span(KICK + 0.12, KICK + 0.3, (u) => (P.yaw = 1.1 * easeOut(u))); // turns to sneer at you
  d.at(KICK + 0.3, () => ch.setExpression('yell'));

  // ===================== 5. PHONE BOOKS =====================
  // he whistles (finger up at the sky), the books rain down beside him
  d.at(WHISTLE, () => {
    d.sfx.whistle();
    ch.setHandPose('R', 'point');
    pc.root.visible = false; // the rest happens between you and him
    hubcap.visible = false;
  });
  d.span(WHISTLE, BOOK0 + NBOOKS * BOOK_DT, (u) => {
    const a = Math.min(1, u * 5) * (1 - seg(u, 0.85, 1));
    ch.armR.rotation.set(-2.6 * a, 0, -0.3 * a);
    P.yaw = lerp(0, -0.35, a);
  });
  for (let i = 0; i < NBOOKS; i++) {
    const bk = books[i];
    const t0 = bk.land - 0.16;
    d.span(t0, bk.land, (u) => {
      bk.g.visible = true;
      bk.g.position.set(0, bk.y + 4.5 * (1 - u * u), bk.dz);
      bk.g.rotation.set(0.3 * (1 - u), bk.yaw + (1 - u) * 1.2, 0.2 * (1 - u));
    });
    d.at(bk.land, () => {
      sfx('bookThud', () => d.sfx.impact());
      d.cam.shake(0.35 + 0.06 * i);
      d.fx.dust(new THREE.Vector3(STACK.x, bk.y + 0.02, STACK.z), 8, { vel: { x: 0, y: 0.4, z: 0 }, spread: 0.9, size: 0.22 });
    });
    d.span(bk.land, bk.land + 0.12, (u) => {
      const sq = Math.sin(u * Math.PI) * 0.18;
      bk.g.scale.set(1 + sq, 1 - sq, 1 + sq);
    });
  }
  d.stamp(BOOK0 + 0.02, 'THUD', { color: '#ffd23f', x: 150, y: 250, size: 16, rot: -0.15, dur: 0.3 });
  d.stamp(BOOK0 + BOOK_DT * 2 + 0.02, 'THUD', { color: '#ffd23f', x: 470, y: 200, size: 16, rot: 0.15, dur: 0.3 });
  d.stamp(BOOK0 + BOOK_DT * 4 + 0.02, 'THUD!', { color: '#ffd23f', x: 180, y: 130, size: 24, rot: -0.1, dur: 0.35 });
  const BOOK_CAM = new THREE.Vector3(STACK.x + 0.45, 0.5, STACK.z + 2.4);
  d.cut(WHISTLE, BOOK_CAM.toArray() as [number, number, number], [STACK.x + 0.3, 0.55, STACK.z], 44, 0.05);
  d.follow(WHISTLE, CLIMB + 0.3, (u) => {
    const h = lerp(0.55, STACK_H + 0.75, easeInOut(seg(u, 0.2, 1)));
    return { pos: BOOK_CAM.clone().add(new THREE.Vector3(-0.2 * u, 0.25 * u, 0.3 * u)), look: new THREE.Vector3(STACK.x + 0.3, h, STACK.z), fov: 44, roll: 0.05 };
  });
  // hop up on top
  let climbFrom = new THREE.Vector3();
  d.at(CLIMB, () => {
    climbFrom = new THREE.Vector3(P.x, P.y, P.z);
    ch.setHandPose('R', 'fist');
    sx.whoosh?.();
  });
  d.span(CLIMB, CLIMB + 0.26, (u) => {
    P.x = lerp(climbFrom.x, STACK.x, u);
    P.z = lerp(climbFrom.z, STACK.z + 0.04, u);
    P.y = lerp(0, STACK_H, u) + 0.5 * Math.sin(u * Math.PI);
    P.yaw = lerp(-0.35, 0, u);
    P.squash = u < 0.15 ? 0.6 * Math.sin((u / 0.15) * Math.PI) : 0;
  });
  d.span(CLIMB + 0.26, CLIMB + 0.42, (u) => (P.squash = Math.sin(u * Math.PI) * 0.7));
  d.at(CLIMB + 0.26, () => {
    sfx('bookThud', () => d.sfx.impact());
    d.cam.shake(0.3);
  });

  // ===================== 6. GLARE + POKES =====================
  // you are sitting; he is finally taller than you. Shades slide down, he jabs the lens.
  const glareCam = () => {
    headPos(b, H);
    return H.clone().add(new THREE.Vector3(-0.15, -0.38, 1.3));
  };
  d.at(GLARE, () => {
    camPos.copy(glareCam());
    ch.setLook(0, -0.4);
  });
  d.follow(GLARE, SHIFT0, (u) => {
    headPos(b, H);
    const p = camPos.clone().add(new THREE.Vector3(0, 0, -0.15 * easeOut(u)));
    return { pos: p, look: H.clone().add(new THREE.Vector3(0.05, -0.12, 0)), fov: lerp(44, 40, easeOut(u)), roll: -0.1 };
  });
  d.span(GLARE, GLARE + 0.25, (u) => ch.setShades(easeBack(u)));
  d.at(GLARE + 0.12, () => {
    sx.sparkle?.();
    d.sparkle(Director.wp(ch.eyes[0]), 18, '#fff6c8');
  });
  d.at(GLARE + 0.05, () => {
    d.sfx.voice('sal', 'yell');
    talkSpan(GLARE + 0.05, SHIFT0 - GLARE + 0.1);
    ch.setSignature(0.5);
  });
  for (const [i, tp] of POKES.entries()) {
    d.span(tp - 0.09, tp, (u) => {
      ch.setPoke(easeOut(u), d.stage.camera.position);
      P.pitch = 0.3 * u;
    });
    d.span(tp, tp + 0.12, (u) => {
      ch.setPoke(1 - easeInOut(u), d.stage.camera.position);
      P.pitch = 0.3 * (1 - u);
    });
    d.at(tp, () => {
      sfx('lensPoke', () => (sx.tink?.(), d.sfx.slap()));
      d.cam.shake(0.45 + 0.15 * i);
      d.cam.punch(i === 2 ? 7 : 4);
      d.flash('#ffffff', 0.25, 14);
    });
  }
  d.at(POKES[0] - 0.1, () => ch.setSignature(0));
  // cartoon: the jabbing hand balloons as it comes at the lens
  d.span(POKES[0] - 0.1, POKES[2] + 0.15, (u) => {
    let k = 0;
    for (const tp of POKES) k = Math.max(k, 1 - Math.min(1, Math.abs(d.t - tp) / 0.11));
    ch.props.handR.scale.setScalar(u >= 1 ? 1 : 1 + 1.6 * easeOut(k));
  });
  d.stamp(POKES[0] + 0.02, "WHO YOU\nCALLIN' SHORT?!", { color: '#ff8a1f', x: 190, y: 92, size: 24, rot: -0.1, dur: 0.75, burst: '#ffd23f' });
  d.stamp(POKES[1] + 0.02, 'POKE', { color: '#ffffff', x: 480, y: 210, size: 16, rot: 0.18, dur: 0.25 });
  d.stamp(POKES[2] + 0.02, 'POKE!', { color: '#ffffff', x: 470, y: 250, size: 16, rot: -0.12, dur: 0.3 });

  // ===================== 7. TINY GEARSTICK =====================
  d.at(SHIFT0, () => {
    shifter.root.visible = true;
    ch.setHandPose('L', 'grip');
    const g = ch.props.gripL;
    g.add(shifter.root);
    // he pinches the little base plate; the lever and knob stick up out of his fist
    shifter.root.position.set(0.26, 0, 0);
    shifter.root.rotation.set(0, 0, -Math.PI / 2);
    shifter.root.scale.setScalar(1.15);
    shifter.setShift(0);
    ch.setShades(0.6);
  });
  d.span(SHIFT0, SHIFT0 + 0.15, (u) => {
    const a = easeBack(u);
    ch.armL.rotation.set(-2.5 * a, 0, 0.35 * a);
  });
  d.follow(SHIFT0, TIP, (u) => {
    headPos(b, H);
    const hp = Director.wp(shifter.knob);
    const look = H.clone().lerp(hp, 0.45);
    const pos = look.clone().add(new THREE.Vector3(-0.2, -0.12, 1.25 - 0.2 * easeOut(u)));
    return { pos, look, fov: 34, roll: 0.08 };
  });
  d.span(CLICK - 0.06, CLICK, (u) => shifter.setShift(u));
  d.at(CLICK, () => {
    sfx('tinyShift', () => sx.tink?.());
    d.cam.punch(-5);
    d.cam.shake(0.3);
    d.flash('#ffffff', 0.4, 12);
    d.sparkle(Director.wp(shifter.knob), 26, '#ffffff');
    ch.setExpression('crazy');
  });
  d.stamp(CLICK - 0.02, 'click.', { color: '#ffffff', x: 470, y: 120, size: 8, rot: 0.1, dur: 0.35 });
  d.stamp(CLICK + 0.06, 'SHORT\nIS FAST', { color: '#ff8a1f', x: 170, y: 100, size: 24, rot: -0.12, dur: 0.5, burst: '#1a1a1a' });

  // ===================== 8. TOPPLE (slow-mo) =====================
  // the click jolts the stack: wobble, then everything goes toward the lens
  d.span(CLICK + 0.05, TIP, (u) => {
    const w = Math.sin(u * Math.PI * 4) * 0.07 * u;
    stack.rotation.set(w, 0, w * 0.6);
    P.roll = w * 1.5;
    P.pitch = w;
  });
  d.at(TIP, () => {
    shifter.root.visible = false;
    ch.armL.rotation.set(0, 0, 0);
    ch.setExpression('yell');
    ch.setShades(1);
    d.sfx.voice('sal', 'yell');
    sfx('bookTopple', () => d.sfx.whoosh());
  });
  d.slowmo(TIP + 0.15, LANDF - 0.12, 0.16, 0.18);
  // books slide out and tumble, each a little differently
  const bookFall = books.map((bk, i) => ({
    vz: 0.6 + i * 0.22 + Math.sin(i * 3.1) * 0.15,
    vx: Math.sin(i * 4.3) * 0.5,
    spin: Math.sin(i * 2.2) * 2 + (i % 2 ? 2.5 : -2),
    p0: new THREE.Vector3(),
  }));
  d.at(TIP, () => {
    stack.rotation.set(0, 0, 0);
    books.forEach((bk, i) => bookFall[i].p0.copy(bk.g.position));
  });
  d.span(TIP, LANDF + 0.2, (u) => {
    const t = u * (LANDF + 0.2 - TIP);
    books.forEach((bk, i) => {
      const f = bookFall[i];
      const dl = Math.max(0, t - (NBOOKS - 1 - i) * 0.04);
      const y = Math.max(0, f.p0.y + 0.8 * dl - 4.9 * dl * dl);
      const ground = y <= 0 ? 1 : 0;
      bk.g.position.set(f.p0.x + f.vx * dl, y + ground * 0.0, f.p0.z + f.vz * dl);
      bk.g.rotation.set(dl * f.spin * (ground ? 0.4 : 1), bk.yaw + dl * f.vx, dl * f.spin * 0.3 * (ground ? 0.3 : 1));
    });
  });
  // Sal pitches forward off the top, flailing and yelling the whole way
  const FALL_TO = new THREE.Vector3(STACK.x, 0.12, STACK.z + 0.55);
  let fallFrom = new THREE.Vector3();
  d.at(TIP, () => {
    fallFrom = new THREE.Vector3(P.x, P.y, P.z);
    ch.setFlail(1);
    talkSpan(TIP, LANDF - TIP + 0.6);
  });
  d.span(TIP, LANDF, (u) => {
    const e = u * u;
    P.x = lerp(fallFrom.x, FALL_TO.x, u);
    P.z = lerp(fallFrom.z, FALL_TO.z, easeOut(u));
    P.y = lerp(fallFrom.y, FALL_TO.y, e) + 0.35 * Math.sin(u * Math.PI);
    P.pitch = lerp(0, Math.PI / 2 - 0.15, easeInOut(u));
    P.roll = Math.sin(u * 7) * 0.15;
    ch.setFlail(1 - 0.6 * seg(u, 0.85, 1));
    ch.setLook(0, lerp(-0.4, 0.6, u));
  });
  const FALL_CAM = new THREE.Vector3(STACK.x + 0.1, 0.22, STACK.z + 2.25);
  d.cut(TIP, FALL_CAM.toArray() as [number, number, number], [STACK.x, STACK_H + 0.6, STACK.z], 52, 0.12);
  d.follow(TIP, LANDF + 0.4, (u) => {
    headPos(b, H);
    const look = H.clone();
    look.y -= 0.55 * (1 - seg(u, 0.6, 1)); // keep the tumbling books in frame until he lands
    return { pos: FALL_CAM.clone().add(new THREE.Vector3(0, 0.02 * u, -0.1 * easeIn2(u))), look, fov: lerp(58, 46, easeInOut(u)), roll: lerp(0.12, -0.05, u) };
  });
  d.at(LANDF, () => {
    sfx('faceplant', () => (d.sfx.slap(), d.sfx.impact()));
    d.cam.shake(1);
    d.cam.punch(9);
    d.fx.dust(new THREE.Vector3(FALL_TO.x, 0.05, FALL_TO.z + 0.4), 22, { vel: { x: 0, y: 0.7, z: 0.4 }, spread: 1.4, size: 0.35 });
    d.hype = 1;
    ch.setFlail(0);
    ch.setSignature(1);
  });
  d.impactFrame(LANDF, '#ffffff', 2);
  d.freeze(LANDF, 0.12, 0.5);
  d.span(LANDF, LANDF + 0.15, (u) => (P.squash = Math.sin(u * Math.PI) * 0.5));
  // flat on his belly, chin up off the asphalt: still yelling straight into the lens
  d.span(TIP + 0.4, HERO, (u) => (ch.head.rotation.x = u >= 1 ? 0 : -1.25 * easeInOut(Math.min(1, u * 1.6))));
  d.stamp(LANDF + 0.05, 'I MEANT TO\nDO THAT!!', { color: '#ffd23f', x: 330, y: 80, size: 24, rot: -0.08, dur: 0.45, burst: '#ff4a2a' });

  // ===================== 9. NAPOLEON MODE =====================
  // cut: he's up on the heap, hand in his jacket, chin up, his car behind him
  const HERO_AT = new THREE.Vector3(STACK.x, BOOK_STYLES[0].h * BS * 2, STACK.z);
  d.at(HERO, () => {
    P.x = HERO_AT.x;
    P.y = HERO_AT.y;
    P.z = HERO_AT.z;
    P.pitch = 0;
    P.roll = 0;
    P.yaw = 0.25;
    P.squash = 0;
    ch.setSignature(0);
    ch.setFlail(0);
    ch.setNapoleon(1);
    ch.setShades(0);
    ch.setExpression('smirk');
    ch.setLook(0, 0);
    ch.setHandPose('L', 'fist');
    // the heap: two books flat under his feet, the rest scattered
    books.forEach((bk, i) => {
      if (i < 2) {
        bk.g.position.set(0, i * BOOK_STYLES[0].h * BS, 0);
        bk.g.rotation.set(0, bk.yaw * 2, 0);
      } else {
        const a = i * 1.7;
        bk.g.position.set(Math.cos(a) * 0.55, (i % 2) * 0.05, Math.sin(a) * 0.4 + 0.1);
        bk.g.rotation.set(i % 2 ? 0.25 : 0, a, i % 3 ? -0.3 : 0);
      }
    });
    stack.rotation.set(0, 0, 0);
    ray.visible = true;
    d.flash('#ff8a1f', 0.45, 8);
    d.cam.punch(-6);
    d.cam.shake(0.4);
    d.sfx.roar('sal');
  });
  d.stamp(HERO + 0.08, 'NAPOLEON\nMODE', { color: '#ff8a1f', x: 210, y: 92, size: 24, rot: -0.1, dur: 0.55, burst: '#1a1a1a' });
  d.follow(HERO, 30, (u) => {
    headPos(b, H);
    const pos = new THREE.Vector3(STACK.x - 0.9, 0.35, STACK.z + 2.35 - 0.15 * easeOut(Math.min(1, u * 5)));
    return { pos, look: frameAt(H, pos, 42, 0.72, 0.42), fov: 42, roll: -0.05 };
  });
  d.every(() => {
    if (!ray.visible) return;
    headPos(b, H);
    const cam = d.stage.camera.position;
    ray.position.copy(H).addScaledVector(H.clone().sub(cam).normalize(), 3);
    ray.lookAt(cam);
    ray.rotateZ(d.wt * 1.2);
  });

  // ---- CARD ----
  d.freeze(CARD, 0.25, 0.6);
  d.at(CARD + 0.7, () => {
    d.sfx.voice('sal', 'taunt');
    talkSpan(CARD + 0.7, 1.3);
  });
  d.nameCard(CARD, { ...card, color: '#e07b1f', accent: '#ffd23f', layout: 'left' }, 0.9, 'sal');

  function talkSpan(t0: number, dur: number) {
    d.span(t0, t0 + dur, (u) => ch.setTalk(u >= 1 ? 0 : 0.55 + 0.45 * Math.abs(Math.sin(d.wt * 15 + u * 20))));
  }
  void R;
  void camPos;
}

const easeIn2 = (u: number) => u * u;

/** Camera look target that puts world point `p` at screen fraction (sx, sy) (0..1 from left / top). */
function frameAt(p: THREE.Vector3, cam: THREE.Vector3, fov: number, sx: number, sy: number) {
  const UP = new THREE.Vector3(0, 1, 0);
  const f = p.clone().sub(cam);
  const dist = f.length();
  f.normalize();
  const right = new THREE.Vector3().crossVectors(f, UP).normalize();
  const up = new THREE.Vector3().crossVectors(right, f);
  const halfH = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * dist;
  const halfW = halfH * (16 / 9);
  return p.clone().addScaledVector(right, -(sx - 0.5) * 2 * halfW).addScaledVector(up, (sy - 0.5) * 2 * halfH);
}

function numberTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1a1a1a';
  g.beginPath();
  g.arc(32, 32, 31, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#f4f2ea';
  g.beginPath();
  g.arc(32, 32, 26, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#e07b1f';
  g.font = 'bold 34px monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('½', 32, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
