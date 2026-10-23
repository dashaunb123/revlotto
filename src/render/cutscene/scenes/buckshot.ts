// SHERIFF BUCKSHOT: a smug jerk from the first frame. Black frame, siren strobe, the cruiser blasts past the
// lens and slides to a dead stop ("PULLED OVER."), and he's already sucking on a lollipop (stolen, obviously).
// He CHOMPS it to bits (the bare stick stays in as his toothpick), flips his aviators down off the hat brim
// (SHING), scribbles you a ticket, rips it and SLAPS it onto the lens in slow-mo. Then he flicks the stick at
// you (TINK off the glass), the siren blares and he finger-guns you. Card: him in the right third, the ticket
// still stuck to the left of the lens.
import * as THREE from 'three';
import { Director, easeBack, easeInOut, easeOut, lerp, seg, type CardInfo } from '../director';
import { buildBossCar, buildCharacter } from '../models';
import { buildLollipop, buildTicketPad, type Prop } from '../models/props';
import { buildDragStrip, glowSprite, glowTexture } from '../stage';
import type { CarRig } from '../types';
import { faceCam, harshJerk, headPos, headR, lamp, mountBoss, rate, rays, rearPoints } from './common';

type HandPose = 'open' | 'fist' | 'grip' | 'point' | 'wave' | 'gun' | 'flat';
/** The Modeler's Buckshot controls (duck-typed: everything optional). */
type BuckRig = {
  setTurn?: (k: number) => void;
  setLook?: (x: number, y: number) => void;
  setTalk?: (k: number) => void;
  setBeatDt?: (dt: number) => void;
  setHandPose?: (side: 'L' | 'R', pose: HandPose) => void;
  fingerGuns?: (k: number) => void;
  props?: Record<string, THREE.Object3D>;
};
type Sfx = Record<string, ((...a: unknown[]) => void) | undefined>;

// ---- timeline (real seconds) ----
const OPEN = 0.42; // black opener ends: the cruiser blasts past the lens
const STOP = 1.6; // dead stop, PULLED OVER.
const CHOMP1 = 2.25;
const CHOMP2 = 2.55;
const SHADES = 3.0;
const WRITE = 3.55;
const RIP = 4.25;
const SLAP0 = 4.4; // lunge at the lens (slow-mo)
const SLAP = 5.0; // ticket hits the glass
const FLICK = 5.65;
const GUNS = 6.25; // siren blares, finger guns
const CARD = 7.05;

/** Fallback citation texture (used when the prop's sheet has no texture). */
function ticketTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 176;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fbf6e4';
  g.fillRect(0, 0, 128, 176);
  g.fillStyle = '#e8402f';
  g.fillRect(0, 0, 128, 30);
  g.fillStyle = '#fff';
  g.font = 'bold 20px monospace';
  g.textAlign = 'center';
  g.fillText('CITATION', 64, 22);
  g.fillStyle = '#20263a';
  g.font = 'bold 17px monospace';
  g.textAlign = 'left';
  g.fillText('BEING SLOW', 8, 66);
  g.fillStyle = '#e8402f';
  g.font = 'bold 26px monospace';
  g.fillText('$9999', 8, 124);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export default function buckshot(d: Director, card: CardInfo) {
  const sx = d.sfx as unknown as Sfx;
  const set = buildDragStrip(d.stage, { haze: 0x1c1834, fogNear: 30, fogFar: 170 });
  d.crowd = set.crowd;
  // harsh from frame 0: red rim on the left edges, police blue on the right
  d.look(0, harshJerk(0xff2a3a, 0x2a6aff));

  const b = mountBoss(d, buildBossCar('buckshot'), buildCharacter('buckshot'), 2.3);
  const car = b.car.root;
  const x = b.char as typeof b.char & BuckRig;
  const cx = b.car as typeof b.car & { setSiren?: (on: boolean) => void };
  const LANE = 2.6;
  const X0 = -40;
  car.position.set(X0, 0, LANE);
  cx.setSiren?.(true);

  const hand = (side: 'L' | 'R', p: HandPose) => x.setHandPose?.(side, p);
  const glasses = x.props?.glasses;
  const pick = x.props?.toothpick;
  const gripR = x.props?.gripR ?? x.props?.handR ?? b.char.armR;

  // aviators ride a flip pivot on the hat brim (the rig keeps posing them inside it); up until the SHING
  const flipPiv = new THREE.Group();
  const flipOff = new THREE.Group();
  let flipK = -1.1;
  if (glasses?.parent) {
    const host = glasses.parent;
    flipPiv.position.set(0, 0.8, 0.36);
    flipOff.position.set(0, -0.8, -0.36);
    host.add(flipPiv);
    flipPiv.add(flipOff);
    flipOff.add(glasses);
    glasses.visible = false; // tucked away until the SHING
  }
  if (pick) pick.visible = false; // the lollipop stick becomes the toothpick after the chomp

  // ---- props in his right fist (Characters' grip: +X out of the fist, +Y thumb side) ----
  const fit = (p: Prop, h: number) => {
    const holder = new THREE.Group();
    holder.add(p.root);
    p.root.updateWorldMatrix(true, true);
    const sz = new THREE.Box3().setFromObject(p.root).getSize(new THREE.Vector3());
    p.root.scale.multiplyScalar(h / Math.max(0.01, sz.y, sz.x));
    d.rig(p as unknown as CarRig); // toon + outlines, update(dt), disposed with the scene
    d.onDispose(() => holder.removeFromParent());
    return holder;
  };
  const toGrip = (o: THREE.Object3D, grip: THREE.Object3D, rx: number, ry: number, rz: number) => {
    if (o.parent !== grip) grip.add(o);
    o.position.set(0, 0, 0);
    o.rotation.set(rx, ry, rz);
    grip.updateWorldMatrix(true, false);
    o.scale.setScalar(1 / grip.getWorldScale(new THREE.Vector3()).x);
  };
  const camAhead = (ox: number, oy: number, oz: number) =>
    d.stage.camera.position.clone().add(new THREE.Vector3(ox, oy, oz).applyQuaternion(d.stage.camera.quaternion));
  const lollyP = buildLollipop() as Prop & { setEaten?: (k: number) => void };
  const lolly = fit(lollyP, 0.7);
  const padP = buildTicketPad() as Prop & { ticket?: THREE.Object3D; setWritten?: (k: number) => void };
  const pad = fit(padP, 0.46);
  pad.visible = false;
  const padRot = new THREE.Euler(0, Math.PI / 2, 0);
  let sheet: THREE.Object3D | null = null;
  let flying = false;

  // the ticket that ends up on the lens: the prop's own sheet texture (scrawl and all)
  let sheetMap: THREE.Texture | null = null;
  padP.ticket?.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
    if (!sheetMap && m?.map) sheetMap = m.map;
  });
  const fallbackTex = sheetMap ? null : ticketTexture();
  const lensMat = new THREE.MeshBasicMaterial({ map: sheetMap ?? fallbackTex, transparent: true, depthTest: false, depthWrite: false, fog: false });
  const lensTicket = new THREE.Mesh(new THREE.PlaneGeometry(0.052, 0.07), lensMat);
  lensTicket.renderOrder = 999;
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false, fog: false });
  const lensShadow = new THREE.Mesh(new THREE.PlaneGeometry(0.052, 0.07), shadowMat);
  lensShadow.renderOrder = 998;
  lensTicket.visible = lensShadow.visible = false;
  d.scene.add(lensTicket, lensShadow);
  d.onDispose(() => (fallbackTex?.dispose(), lensMat.dispose(), shadowMat.dispose()));
  let lensOn = false;

  // the flicked stick
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0xf6f0e2 }));
  stick.visible = false;
  d.scene.add(stick);

  // police light bar glow + light
  const red = lamp(0xff2a3a, 2.4, 12, 18);
  const blue = lamp(0x2a6aff, 2.4, 12, 18);
  const bar = new THREE.Group();
  red.group.position.z = -0.55;
  blue.group.position.z = 0.55;
  bar.add(red.group, blue.group);
  const kitBar = b.car.props?.lightBar;
  if (kitBar) {
    kitBar.add(bar);
    bar.position.y = 0.15;
  } else {
    bar.position.set(-0.3, b.roofY + 0.08, 0);
    car.add(bar);
  }
  const rayR = rays(0xff2a3a, 12, 16);
  const rayB = rays(0x2a6aff, 12, 16);
  rayR.visible = rayB.visible = false;
  d.scene.add(rayR, rayB);
  const ray = rays(0x6a8cff, 16, 10);
  ray.visible = false;
  d.scene.add(ray);

  // the opener: a black card in front of the lens with the siren glowing through
  const blackMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 1, depthTest: false, depthWrite: false, fog: false });
  const black = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), blackMat);
  black.renderOrder = 998;
  const gtex = glowTexture();
  const sirL = glowSprite(gtex, 0xff2030, 0.9, 0);
  const sirR = glowSprite(gtex, 0x2060ff, 0.9, 0);
  for (const s of [sirL, sirR]) {
    s.renderOrder = 999;
    (s.material as THREE.SpriteMaterial).depthTest = false;
  }
  d.scene.add(black, sirL, sirR);
  let opener = true;

  // ---- body control, applied after the rig poses each frame ----
  const pose = { suck: 1, pad: 0, write: 0, slap: 0, lunge: 0 };
  let lollyOn = true;
  const lollyRot = new THREE.Euler(0, 0, Math.PI / 2);
  const rootZ = b.char.root.position.z;
  const rigUpdate = b.char.update.bind(b.char);
  b.char.update = (dt: number) => {
    rigUpdate(dt);
    // lean out of the window at the lens on the slap
    b.char.root.position.z = rootZ + 0.7 * pose.lunge;
    b.char.root.rotation.x = 0.25 * pose.lunge;
    const sk = Math.sin(d.wt * 9) * 0.05 * pose.suck;
    b.char.armR.rotation.set(
      -1.55 * pose.suck + sk - 1.15 * pose.pad - 1.5 * pose.slap,
      0,
      0.55 * pose.suck + 0.45 * pose.pad + 0.25 * pose.slap,
    );
    b.char.armL.rotation.set(-1.05 * pose.write, 0, -0.5 * pose.write);
    if (pose.write > 0.01) {
      b.char.armL.rotation.x += 0.1 * pose.write * Math.sin(d.t * 40) * Math.sin(d.t * 9);
      b.char.armL.rotation.z += 0.08 * pose.write * Math.sin(d.t * 23);
    }
    lolly.visible = lollyOn;
    if (lollyOn) toGrip(lolly, gripR, lollyRot.x, lollyRot.y, lollyRot.z);
    if (pad.visible) toGrip(pad, gripR, padRot.x, padRot.y, padRot.z);
    if (sheet && !flying && sheet.parent !== gripR) {
      gripR.attach(sheet);
      sheet.position.set(0.14, 0, 0);
      sheet.rotation.set(padRot.x, padRot.y, padRot.z);
    }
    if (flipPiv.parent) flipPiv.rotation.x = flipK;
  };

  const H = new THREE.Vector3();
  const look = new THREE.Vector3();
  const smoke = rate(140);
  let sirenAmt = 1;

  d.every((dt, wdt) => {
    x.setBeatDt?.(dt);
    x.setTurn?.(1); // jerk, start to finish
    // siren strobe: red-red / blue-blue
    const ph = Math.floor(d.t / 0.22) % 2;
    const r = ph === 0 ? 1 : 0;
    red.set(r * sirenAmt);
    blue.set((1 - r) * sirenAmt);
    d.wash.col = r ? '#ff2040' : '#2050ff';
    const pop = 1 - (d.t % 0.22) / 0.22;
    d.wash.a = (opener ? 0.06 + 0.4 * pop * pop : 0.07) * Math.min(1, sirenAmt);
    const cam = d.stage.camera;
    if (opener) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const rt = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      black.position.copy(cam.position).addScaledVector(fwd, 0.6);
      black.quaternion.copy(cam.quaternion);
      const grow = 0.6 + d.t * 3;
      sirL.position.copy(cam.position).addScaledVector(fwd, 0.55).addScaledVector(rt, -0.05 * grow);
      sirR.position.copy(cam.position).addScaledVector(fwd, 0.55).addScaledVector(rt, 0.05 * grow);
      sirL.scale.setScalar(0.12 * grow * (r ? 1.3 : 0.8));
      sirR.scale.setScalar(0.12 * grow * (r ? 0.8 : 1.3));
      (sirL.material as THREE.SpriteMaterial).opacity = r ? 1 : 0.12;
      (sirR.material as THREE.SpriteMaterial).opacity = r ? 0.12 : 1;
    }
    black.visible = sirL.visible = sirR.visible = opener;
    // slide smoke
    const sliding = d.t > 0.7 && d.t < STOP;
    const n = smoke(wdt, sliding ? 1 : 0);
    const pts = rearPoints(b);
    for (let i = 0; i < n; i++) d.fx.smoke(pts[i % 2], 1, { vel: { x: -3, y: 1.2, z: 0 }, size: 0.8, spread: 1.2, outline: false });
    headPos(b, H);
    if (ray.visible) {
      ray.position.copy(H).addScaledVector(H.clone().sub(cam.position).normalize(), 4);
      ray.lookAt(cam.position);
      ray.rotateZ(d.wt * 1.5);
    }
    if (rayR.visible) {
      const bp = Director.wp(bar);
      for (const [rr, on, s] of [[rayR, r, 1], [rayB, 1 - r, -1]] as const) {
        rr.position.copy(bp).addScaledVector(bp.clone().sub(cam.position).normalize(), 1.5);
        rr.lookAt(cam.position);
        rr.rotateZ(d.t * 3 * s);
        (rr.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.45 * on;
      }
    }
    // the ticket stuck on the lens
    lensTicket.visible = lensShadow.visible = lensOn;
    if (lensOn) {
      const a = d.t - SLAP;
      const k = 1 + 0.25 * Math.exp(-a * 18) * Math.cos(a * 50);
      lensTicket.position.copy(cam.position).add(new THREE.Vector3(-0.072, 0.024, -0.2).applyQuaternion(cam.quaternion));
      lensTicket.quaternion.copy(cam.quaternion);
      lensTicket.rotateZ(0.2 + 0.02 * Math.sin(a * 3));
      lensTicket.scale.setScalar(k);
      lensShadow.position.copy(cam.position).add(new THREE.Vector3(-0.07, 0.021, -0.201).applyQuaternion(cam.quaternion));
      lensShadow.quaternion.copy(lensTicket.quaternion);
      lensShadow.scale.setScalar(k);
    }
  });

  // ---- car: screaming in, flick sideways, dead stop (he never stops sucking that lollipop) ----
  const END_X = 2.5;
  const YAW = Math.PI / 2;
  d.span(0, STOP, (u) => {
    const k = 1 - Math.pow(1 - u, 2.4);
    car.position.x = lerp(X0, END_X, k);
    const yu = seg(u, 0.42, 0.86);
    car.rotation.y = lerp(0, YAW + 0.22, easeOut(yu)) - 0.22 * seg(u, 0.86, 1);
    b.car.setWheelSpin(lerp(90, 8, u), lerp(140, 30, u));
    b.car.setSteer(yu > 0 && yu < 1 ? -0.5 : 0);
    b.car.setLean(yu > 0 ? 0.12 * (1 - u) : 0, 0);
  });
  d.at(0.55, () => d.sfx.drift(1.1));
  d.span(STOP + 0.12, STOP + 1.0, (u) => {
    const w = u * Math.PI * 2 * 3;
    const a = (1 - u) * (1 - u);
    b.car.setLean(Math.sin(w) * 0.13 * a, Math.sin(w + 0.6) * 0.05 * a);
    b.car.setWheelSpin(0, 0);
    b.car.setSteer(0);
  });
  d.at(STOP, () => {
    d.cam.shake(0.9);
    d.cam.punch(-9);
    const pts = rearPoints(b);
    d.fx.smoke(pts[0], 12, { size: 1, vel: { x: -4, y: 1.5, z: -2 }, outline: false });
    d.fx.sparks({ x: car.position.x + 1, y: 0.2, z: LANE + 1 }, 40, { vel: { x: 10, y: 4, z: 0 }, spread: 4 });
    d.sfx.roar('buckshot');
    d.hype = 0.9;
  });
  d.impactFrame(STOP, '#ffffff', 2);
  d.at(STOP, () => d.flash('#ffffff', 0.8, 10));
  d.stamp(STOP + 0.03, 'PULLED OVER.', { color: '#f5c542', x: 330, y: 92, size: 24, rot: -0.12, dur: 0.5, burst: '#ff2a3a' });

  // ---- camera ----
  d.bars(true);
  d.cut(0, [X0 + 60, 0.6, LANE], [X0, 0.8, LANE], 30);
  d.at(0, () => {
    d.sfx.siren();
    hand('R', 'grip');
    d.hype = 0.4;
  });
  const CAM_A = new THREE.Vector3(-8, 0.42, LANE + 1.55);
  d.at(OPEN, () => {
    opener = false;
    d.flash('#ffffff', 0.6, 9);
    d.cam.shake(0.3);
  });
  d.follow(OPEN, 0.84, (u) => {
    const cxp = car.position.x;
    if (cxp < CAM_A.x - 1.5) look.set(cxp, 0.8, LANE);
    else look.set(Math.max(cxp + 4, CAM_A.x + 6), 0.9, LANE - 1.2);
    return { pos: CAM_A, look, fov: lerp(30, 44, u), roll: lerp(0.08, -0.2, u) };
  });
  d.at(0.68, () => {
    d.cam.shake(0.8);
    d.cam.punch(6);
    d.flash('#ffffff', 0.35, 10);
    d.speedLines = 1;
  });
  d.follow(0.84, STOP, (u) => {
    look.set(car.position.x, 1.2, LANE - 0.5);
    return { pos: new THREE.Vector3(lerp(17, 14, u), 0.9, 4.6), look, fov: lerp(24, 32, easeInOut(u)), roll: -0.1 };
  });
  // the stop: medium on him in the window, slurping away while the car rocks
  d.follow(STOP, CHOMP1 - 0.1, (u) => ({ ...faceCam(b, lerp(11, 9.5, easeOut(u)), 0.5, -1.2, -0.9), fov: 36, roll: 0.06 }));
  d.at(STOP + 0.2, () => talk(STOP + 0.2, 0.5, 9));

  // CHOMP x2: tight on the mouth, candy shards everywhere; the bare stick stays in as his toothpick
  d.follow(CHOMP1 - 0.1, SHADES - 0.12, (u) => ({ ...faceCam(b, lerp(6.4, 5.8, u), -0.45, -0.7, -0.5), fov: 30, roll: -0.1 }));
  const chomp = (t: number, k: number, last: boolean) => {
    d.at(t, () => {
      lollyP.setEaten?.(k);
      d.sfx.crunch();
      if (last) d.sfx.impact();
      d.cam.punch(-6);
      d.cam.shake(0.45);
      const p = Director.wp(lollyP.root);
      p.lerp(headPos(b), 0.3);
      d.fx.sparks(p, 24, { color: 0xff5c9a, vel: { x: 0, y: 2.5, z: 0 }, spread: 4, gravity: 9, size: 0.1 });
      d.fx.sparks(p, 12, { color: 0x7ad8ff, vel: { x: 0, y: 2.5, z: 0 }, spread: 3.5, gravity: 9, size: 0.08 });
      d.fx.sparks(p, 10, { color: 0xfff2a0, vel: { x: 0, y: 2.5, z: 0 }, spread: 3.5, gravity: 9, size: 0.08 });
      if (last) {
        lollyOn = false;
        if (pick) pick.visible = true;
        hand('R', 'open');
      }
    });
    d.impactFrame(t, 'invert', 1);
  };
  chomp(CHOMP1, 0.55, false);
  chomp(CHOMP2, 1, true);
  d.stamp(CHOMP1 + 0.02, 'CHOMP', { color: '#ff5c9a', x: 470, y: 100, size: 24, rot: 0.14, dur: 0.3, burst: '#ffffff' });
  d.stamp(CHOMP2 + 0.02, 'CHOMP!', { color: '#ff5c9a', x: 450, y: 130, size: 24, rot: -0.1, dur: 0.4, burst: '#7ad8ff' });
  d.span(CHOMP2 + 0.05, CHOMP2 + 0.3, (u) => (pose.suck = 1 - easeInOut(u)));
  d.at(CHOMP2 + 0.15, () => talk(CHOMP2 + 0.15, 0.3, 14));

  // AVIATORS: flip down off the hat brim. SHING.
  d.follow(SHADES - 0.12, WRITE, (u) => ({ ...faceCam(b, lerp(6.2, 5.4, easeOut(u)), 0.35, -0.1, 0), fov: 30, roll: 0.1 }));
  d.span(SHADES, SHADES + 0.14, (u) => {
    if (glasses) glasses.visible = true;
    flipK = lerp(-1.1, 0, easeBack(u));
  });
  d.at(SHADES + 0.14, () => {
    d.cam.punch(-6);
    d.flash('#ffffff', 0.45, 10);
    const e = b.char.eyes;
    d.sparkle(Director.wp(e[1] ?? b.char.head), 34, '#ffffff');
    d.sparkle(Director.wp(e[0] ?? b.char.head), 20, '#fff6c8');
    sx.sparkle?.();
    ray.visible = true;
  });

  // TICKET: pad out, scribble scribble, RRRIP
  d.at(WRITE, () => {
    ray.visible = false;
    hand('R', 'grip');
    hand('L', 'fist');
    pad.visible = true;
  });
  d.follow(WRITE, SLAP0, (u) => ({ ...faceCam(b, lerp(9.5, 8.6, u), -0.2, -1.4, -1.6), fov: 34, roll: 0.06 }));
  d.span(WRITE, WRITE + 0.15, (u) => {
    pose.pad = easeOut(u);
    pose.write = easeOut(u);
  });
  d.span(WRITE + 0.1, RIP - 0.05, (u) => padP.setWritten?.(u));
  d.at(WRITE + 0.1, () => d.sfx.scribble(RIP - WRITE - 0.15));
  d.stamp(WRITE + 0.15, 'SCRIBBLE\nSCRIBBLE', { color: '#ffffff', x: 140, y: 80, size: 16, rot: -0.1, dur: 0.5 });
  d.at(RIP, () => {
    if (padP.ticket) {
      d.scene.attach(padP.ticket);
      sheet = padP.ticket;
    }
    d.sfx.rip();
    d.cam.punch(-3);
  });
  d.stamp(RIP, 'RRRIP', { color: '#f5c542', x: 470, y: 120, size: 16, rot: 0.12, dur: 0.3 });
  d.span(RIP, SLAP0, (u) => (pose.write = 1 - u));

  // THE SLAP: he lunges out of the window, palm first, in slow-mo; the ticket slaps the glass
  d.at(SLAP0, () => {
    hand('R', 'flat');
    hand('L', 'open');
    pad.visible = false;
  });
  d.span(SLAP0, SLAP0 + 0.15, (u) => (pose.pad = 1 - u));
  d.slowmo(SLAP0 + 0.05, SLAP - 0.02, 0.12, 0.12);
  d.span(SLAP0, SLAP, (u) => {
    pose.slap = easeOut(seg(u, 0, 0.5));
    pose.lunge = easeInOut(u);
  });
  let slapCam = new THREE.Vector3();
  d.at(SLAP0, () => (slapCam = faceCam(b, 5.6, 0.1, -0.6, 0).pos));
  d.follow(SLAP0, SLAP, (u) => {
    headPos(b, H);
    return { pos: slapCam, look: H.clone().setY(H.y - 0.3), fov: lerp(34, 46, u), roll: lerp(0, 0.12, u) };
  });
  d.at(SLAP0 + 0.08, () => talk(SLAP0 + 0.08, 0.5, 14));
  // the last stretch: the sheet leaves his palm and fills the lens (slow-mo makes it loom)
  const flyQ = new THREE.Quaternion();
  let flyFrom: THREE.Vector3 | null = null;
  let flyQ0 = new THREE.Quaternion();
  d.span(SLAP0 + 0.3, SLAP, (u) => {
    if (!sheet) return;
    if (!flyFrom) {
      flying = true;
      d.scene.attach(sheet);
      flyFrom = sheet.position.clone();
      flyQ0 = sheet.quaternion.clone();
    }
    const e = u * u;
    const cam = d.stage.camera;
    sheet.position.lerpVectors(flyFrom, camAhead(-0.072, 0.024, -0.2), e);
    flyQ.copy(cam.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.2));
    sheet.quaternion.slerpQuaternions(flyQ0, flyQ, Math.min(1, u * 1.5));
  });
  d.at(SLAP, () => {
    lensOn = true;
    if (sheet) sheet.visible = false;
    d.sfx.slap();
    d.sfx.impact();
    d.cam.shake(1);
    d.cam.punch(10);
    d.hype = 1;
  });
  d.impactFrame(SLAP, '#ffffff', 2);
  d.freeze(SLAP, 0.16, 0.5);
  d.glitch(SLAP + 0.02, SLAP + 0.22, 0.45); // a brief hiccup from the hit, not a transformation
  d.stamp(SLAP + 0.02, 'SLAP!', { color: '#ffffff', x: 470, y: 90, size: 24, rot: -0.12, dur: 0.55, burst: '#ff2a3a' });
  d.span(SLAP + 0.15, SLAP + 0.5, (u) => {
    pose.slap = 1 - easeInOut(u);
    pose.lunge = 1 - easeInOut(u);
  });
  d.follow(SLAP + 0.16, GUNS, (u) => ({ ...faceCam(b, lerp(7.4, 6.4, easeOut(u)), 0.25, -0.2, -0.25), fov: 32, roll: -0.06 }));

  // FLICK: the stick spins straight at the lens, TINK, bounces off
  let flickP0 = new THREE.Vector3();
  d.at(FLICK, () => {
    if (pick) {
      pick.visible = false;
      Director.wp(x.props?.toothpickTip ?? pick, flickP0);
    } else flickP0 = Director.wp(b.char.jaw);
    stick.visible = true;
    d.sfx.signature('buckshot');
    d.cam.punch(-4);
  });
  d.span(FLICK, FLICK + 0.16, (u) => {
    stick.position.lerpVectors(flickP0, camAhead(0.05, -0.02, -0.35), u * u);
    stick.rotation.set(u * 14, 0.4, u * 9);
  });
  d.at(FLICK + 0.16, () => {
    d.sfx.tink();
    d.cam.shake(0.45);
    d.flash('#ffffff', 0.3, 12);
    d.sparkle(stick.position, 30, '#ffffff');
  });
  d.stamp(FLICK + 0.17, 'TINK', { color: '#9ef0ff', x: 330, y: 150, size: 16, rot: 0.2, dur: 0.4 });
  d.span(FLICK + 0.16, FLICK + 0.6, (u) => {
    stick.position.copy(camAhead(0.05 + 0.3 * u, -0.02 - 1.6 * u * u, -0.35 - 0.6 * u));
    stick.rotation.set(1.4 + u * 10, 0.4, 2 - u * 6);
    if (u >= 1) stick.visible = false;
  });

  // GUNS: siren BLARES, light-bar sunbursts, finger guns at the lens; low hero angle in the right third
  d.at(GUNS, () => {
    d.sfx.siren();
    sirenAmt = 1.3;
    rayR.visible = rayB.visible = true;
    ray.visible = true;
    d.flash('#ff2a3a', 0.35, 8);
    d.cam.shake(0.5);
    d.cam.punch(-6);
    d.hype = 1;
    x.setLook?.(0, 0);
  });
  d.span(GUNS + 0.05, GUNS + 0.17, (u) => x.fingerGuns?.(easeOut(u)));
  d.at(GUNS + 0.17, () => {
    d.cam.punch(-5);
    d.sparkle(Director.wp(b.char.armR), 26, '#fff6c8');
    d.sparkle(Director.wp(b.char.armL), 20, '#fff6c8');
  });
  const camRight = new THREE.Vector3();
  d.follow(GUNS, 30, (u) => {
    const f = faceCam(b, lerp(13, 12, easeOut(Math.min(1, u * 4))), 0.55, -1.8, 0);
    const r = headR(b);
    camRight.subVectors(f.look, f.pos).cross(new THREE.Vector3(0, 1, 0)).normalize();
    f.look.addScaledVector(camRight, -3.4 * r);
    f.look.y -= 1.2 * r;
    return { ...f, fov: 34, roll: -0.08 };
  });

  // CARD
  d.freeze(CARD, 0.25, 0.6);
  d.at(CARD + 0.7, () => d.sfx.voice('buckshot', 'taunt'));
  d.at(CARD + 0.7, () => talk(CARD + 0.7, 1.3, 14));
  d.nameCard(CARD, { ...card, color: '#2b55c8', accent: '#ff3a48', layout: 'left' }, 0.8, 'buckshot');

  function talk(t0: number, dur: number, rate: number) {
    if (!x.setTalk) return;
    d.span(t0, t0 + dur, (u) => x.setTalk!(u >= 1 ? 0 : Math.abs(Math.sin(d.wt * rate + u * 20))));
  }
}
