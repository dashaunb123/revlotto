// DJ BLACKOUT: an obnoxious club DJ who hijacks the stadium (a jerk from the first frame).
// Your tach, idling under the stadium lights... a record scratch, the needle spazzes and the tach dies. Cut: his
// hand yanks the LIGHTS fader on his door-mounted decks, and the banks clunk out one by one. Pitch black. Click:
// his giant headphones light up, then the shutter shades, then the grin with a gold tooth ("LIGHTS OUT."). Lasers
// rip on, he's bobbing with a hand on one cup; he points to the sky for the build, then the BASS DROPS: the world
// shakes, a shockwave rolls out, the crowd goes off ("DROP IT."). Your tach now bounces to HIS beat (your engine:
// "vroom..."). He scratches and the whole scene stutters and rewinds, then drops again. Shades up, mic out: in
// slow-mo he drops the mic straight onto the lens. Hard blackout: only the glowing headphones and the grin.
// Everything slams back on for the card.
import * as THREE from 'three';
import { Director, easeInOut, easeOut, lerp, rand, seg, type CardInfo } from '../director';
import { buildBossCar, buildCharacter, toonMaterial } from '../models';
import type { DjRig } from '../models/dj';
import { buildDjCarKit, buildMic } from '../models/dj_props';
import { buildDragStrip, glowSprite, glowTexture } from '../stage';
import { faceCam, harshJerk, headPos, headR, mixLook, mountBoss } from './common';

const LANE = -2.6;
const PL = 2.6; // your lane
const MAG = 0xff2fd6;
const CYAN = 0x2ff0ff;
const BEAT = 60 / 128;

const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** Your dashboard tach: a gauge pod with a glowing face, a needle and a little LCD. */
function buildTach() {
  const root = new THREE.Group();
  const mats: THREE.Material[] = [];
  const texs: THREE.Texture[] = [];
  const own = <T extends THREE.Material>(m: T) => (mats.push(m), m);
  const A0 = Math.PI * 1.2, A1 = -Math.PI * 0.2;
  const ang = (u: number) => lerp(A0, A1, u);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d')!;
  const rg = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  rg.addColorStop(0, '#1c2440');
  rg.addColorStop(1, '#0a0d18');
  g.fillStyle = rg;
  g.beginPath();
  g.arc(128, 128, 128, 0, Math.PI * 2);
  g.fill();
  // red zone
  g.strokeStyle = '#ff3a2a';
  g.lineWidth = 14;
  g.beginPath();
  g.arc(128, 128, 100, -ang(0.8), -ang(1));
  g.stroke();
  for (let i = 0; i <= 40; i++) {
    const u = i / 40, a = ang(u), major = i % 5 === 0;
    g.strokeStyle = u > 0.8 ? '#ff5a3a' : '#e8f0ff';
    g.lineWidth = major ? 5 : 2;
    g.beginPath();
    g.moveTo(128 + Math.cos(a) * (major ? 84 : 94), 128 - Math.sin(a) * (major ? 84 : 94));
    g.lineTo(128 + Math.cos(a) * 108, 128 - Math.sin(a) * 108);
    g.stroke();
  }
  g.font = '16px "Press Start 2P", monospace';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let n = 0; n <= 8; n++) {
    const a = ang(n / 8);
    g.fillStyle = n >= 7 ? '#ff5a3a' : '#e8f0ff';
    g.fillText(String(n), 128 + Math.cos(a) * 64, 128 - Math.sin(a) * 64);
  }
  g.font = '8px "Press Start 2P", monospace';
  g.fillStyle = '#7a8ab0';
  g.fillText('RPM x1000', 128, 168);
  const faceTex = new THREE.CanvasTexture(cv);
  faceTex.colorSpace = THREE.SRGBColorSpace;
  texs.push(faceTex);
  const faceMat = own(new THREE.MeshBasicMaterial({ map: faceTex, fog: false }));
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.5, 48), faceMat);
  root.add(face);
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.62, 0.3, 40, 1, true), own(toonMaterial(0x101018, { gloss: 0.8, side: THREE.DoubleSide })));
  housing.rotation.x = Math.PI / 2;
  housing.position.z = -0.08;
  root.add(housing);
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.54, 0.05, 10, 48), own(toonMaterial(0xc8ccd6, { gloss: 1, shine: 90 })));
  bezel.position.z = 0.02;
  root.add(bezel);
  // LCD: two states (your rpm / hijacked)
  const lcd = (txt: string, col: string) => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 16;
    const x = c.getContext('2d')!;
    x.fillStyle = '#05060a';
    x.fillRect(0, 0, 64, 16);
    x.font = '8px "Press Start 2P", monospace';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = col;
    x.fillText(txt, 32, 9);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    texs.push(t);
    return t;
  };
  const lcdOk = lcd('0950', '#7affc8'), lcdDj = lcd('DJ!!', '#ff2fd6');
  const lcdMat = own(new THREE.MeshBasicMaterial({ map: lcdOk, fog: false }));
  const lcdM = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.07), lcdMat);
  lcdM.position.set(0, -0.26, 0.01);
  root.add(lcdM);
  const pivot = new THREE.Group();
  pivot.position.z = 0.02;
  root.add(pivot);
  const needleMat = own(new THREE.MeshBasicMaterial({ color: 0xff4a2a, fog: false }));
  const needle = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.03), needleMat);
  needle.position.x = 0.17;
  pivot.add(needle);
  const hub = new THREE.Mesh(new THREE.CircleGeometry(0.06, 20), own(new THREE.MeshBasicMaterial({ color: 0x2a2a34, fog: false })));
  hub.position.z = 0.03;
  root.add(hub);
  const glowM = own(new THREE.MeshBasicMaterial({ color: 0x5a8aff, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.75, 40), glowM);
  glow.position.z = -0.05;
  root.add(glow);
  return {
    root,
    set(u: number) {
      pivot.rotation.z = ang(u);
    },
    /** 1 = lit, 0 = dead. hijack = the LCD + glow go magenta. */
    power(k: number, hijack = false) {
      faceMat.color.setScalar(0.06 + 0.94 * k);
      lcdMat.map = hijack ? lcdDj : lcdOk;
      lcdMat.color.setScalar(hijack ? 1 : 0.05 + 0.95 * k);
      needleMat.color.setHex(hijack ? MAG : 0xff4a2a);
      glowM.color.setHex(hijack ? MAG : 0x5a8aff);
      glowM.opacity = hijack ? 0.35 : 0.25 * k;
    },
    dispose() {
      root.removeFromParent();
      root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
      mats.forEach((m) => m.dispose());
      texs.forEach((t) => t.dispose());
    },
  };
}

/** Arm / torso / head pose on the outer pivots (the rig's idle and beat bounce play on the inner ones). */
interface Pose {
  lx: number; lz: number; rx: number; rz: number; tx: number; ty: number; hx: number; hy: number; hz: number;
}
const P = (lx: number, lz: number, rx: number, rz: number, tx = 0, ty = 0, hx = 0, hy = 0, hz = 0): Pose => ({ lx, lz, rx, rz, tx, ty, hx, hy, hz });

export default function dj(d: Director, card: CardInfo) {
  /** Scene-specific sounds (REQUESTs for the audio agent): silent until they exist. */
  const extra = (name: string, ...a: unknown[]) => (d.sfx as unknown as Record<string, ((...x: unknown[]) => void) | undefined>)[name]?.(...a);

  // ---------- set + light ----------
  const set = buildDragStrip(d.stage, { haze: 0x1a0c22, sky: [0x160a20, 0x030206], fogNear: 30, fogFar: 190 });
  d.crowd = set.crowd;
  d.hype = 0.55;
  const fog = d.stage.scene.fog as THREE.Fog;
  const bg = d.stage.scene.background as THREE.Color;
  const JERK = harshJerk(MAG, CYAN);
  const CLUB = mixLook(JERK, harshJerk(MAG, 0x6a4aff), 0.4);
  CLUB.exposure = 0.95;
  CLUB.bloom = 1.25;
  CLUB.vignette = 0.6;
  CLUB.fill.setHex(0xe0d4ff);
  CLUB.fillI = 0.3;
  const BLACK = harshJerk(MAG, CYAN);
  BLACK.rimI = 0;
  BLACK.fillI = 0;
  BLACK.bloom = 1.5;
  BLACK.vignette = 0.9;
  const HERO = harshJerk(MAG, CYAN);
  HERO.bloom = 1.35;
  HERO.fill.setHex(0xfff0f8);
  HERO.fillI = 0.4;
  d.look(0, mixLook(JERK, harshJerk(0xff9a3a, 0x8ab0ff), 0.6));

  const lights = {
    mag: new THREE.PointLight(MAG, 0, 16, 1.3),
    cyan: new THREE.PointLight(CYAN, 0, 16, 1.3),
    under: new THREE.PointLight(MAG, 0, 6, 1.5),
  };
  lights.mag.position.set(-2.2, 3.2, LANE + 3.2);
  lights.cyan.position.set(2.6, 2.6, LANE - 0.5);
  lights.under.position.set(0, 0.4, LANE + 1.8);
  d.scene.add(lights.mag, lights.cyan, lights.under);
  const club = (k: number) => {
    lights.mag.intensity = 14 * k;
    lights.cyan.intensity = 10 * k;
    lights.under.intensity = 4 * k;
  };

  // ---------- DJ Blackout, his car and his decks ----------
  const carRig = buildBossCar('dj');
  const kitCar = buildDjCarKit(carRig);
  d.onDispose(() => kitCar.dispose());
  const b = mountBoss(d, carRig, buildCharacter('dj'), 2.3);
  const car = b.car.root;
  car.position.set(0, 0, LANE);
  const rig = b.char as DjRig;
  const head = b.char.head;
  const torso = rig.torso;
  b.char.root.position.y += 0.22; // up out of the window, over his decks
  const R = headR(b);
  const armL0 = b.char.armL.rotation.clone();
  const armR0 = b.char.armR.rotation.clone();
  const torso0 = torso.rotation.clone();
  const head0 = head.rotation.clone();
  rig.setTurn(1);
  b.char.setExpression('smirk');
  b.char.setSignature(0.35);
  rig.setShades(1);
  rig.setGlow(0.6);
  d.every((dt) => rig.setBeatDt(dt));

  const mic = buildMic();
  mic.root.scale.setScalar(1.7);
  mic.root.visible = false;
  rig.props.gripR.add(mic.root);
  d.onDispose(() => mic.dispose());

  // ---------- timeline ----------
  const SCR1 = 0.5; // record scratch over your tach
  const DIE = 0.82; // your tach dies
  const FADER = 1.1; // his hand on the LIGHTS fader
  const BANKS = 1.42; // the banks clunk out
  const DARK = 1.98;
  const PHONES = 2.12;
  const SHADES = 2.3;
  const GRIN = 2.48;
  const LASER = 2.95;
  const BUILD = 3.5;
  const DROP = 4.15;
  const HIJACK = 4.85;
  const SCRATCH = 5.25;
  const REW = 5.55;
  const FWD = 5.9;
  const MIC = 6.2;
  const HOLD = 6.7;
  const LET = 7.05;
  const LENS = 7.9;
  const BLACKT = LENS + 0.03;
  const CARD = 8.85;

  // ---------- poses ----------
  const REST = P(-0.15, 0, -0.15, 0, 0, 0, 0, 0, 0);
  const CUP = P(0, 0, -0.35, 0.1, 0, 0.1, 0, 0.15, -0.05);
  const UP = P(-0.2, 0.25, 0, 0, -0.1, 0.12, -0.06, 0.12, 0.1); // finger to the sky (the right hand reaches up: setScratch)
  const PUMP = P(-1.0, 0.9, -1.0, -0.9, 0.08, 0, 0.12, 0, 0); // arms flung wide on the drop
  const SCRP = P(-0.4, 0.1, 0, 0, 0.12, -0.1, 0.22, -0.15, 0.05);
  const MICUP = P(-0.3, 0.1, -1.45, 0.3, -0.05, 0.1, -0.1, 0.05, 0.1); // mic up by the mouth
  const OVER = P(-0.2, 0.2, 0, 0, 0.3, 0, 0.32, 0, 0.08); // leaning over the lens (the right hand reaches out: setScratch)
  const keys: [number, Pose][] = [
    [0, REST], [LASER, CUP], [BUILD - 0.05, CUP], [BUILD + 0.2, UP], [DROP - 0.04, UP], [DROP + 0.06, PUMP], [HIJACK, PUMP],
    [SCRATCH - 0.001, SCRP], [REW, SCRP], [REW + 0.001, PUMP], [MIC - 0.001, PUMP], [MIC + 0.15, MICUP], [HOLD - 0.08, MICUP],
    [HOLD + 0.12, OVER], [BLACKT - 0.001, OVER], [BLACKT, REST], [CARD, REST], [CARD + 0.001, PUMP],
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

  /** Character-relative camera (see faceCam), as a follow() frame. */
  const fc = (dist: number, yaw: number, up: number, lookUp: number, fov: number, roll = 0) => ({ ...faceCam(b, dist, yaw, up, lookUp), fov, roll });
  const H = new THREE.Vector3();

  // ---------- the beat ----------
  // Before the drop: a soft four-on-the-floor from LASER, a snare-roll build that speeds up. After: hard 128 bpm on
  // world time (slow-mo slows the music too), except the scratch rewinds it.
  let wDrop = -1;
  d.at(DROP, () => (wDrop = d.wt));
  const pulseAt = () => {
    const t = d.t;
    if (t < LASER) return 0;
    if (t < BUILD) return 0.6 * Math.exp(-(((t - LASER) / BEAT) % 1) * 5);
    if (t < DROP) {
      const u = seg(t, BUILD, DROP);
      const div = u < 0.4 ? 2 : u < 0.75 ? 4 : 8;
      return (0.3 + 0.5 * u) * Math.exp(-(((t - BUILD) / (BEAT / div)) % 1) * 4);
    }
    if (t >= BLACKT && t < CARD) return 0.25 * Math.exp(-(((t - BLACKT) / (BEAT * 2)) % 1) * 3);
    const bt = wDrop >= 0 ? (d.wt - wDrop) / BEAT : 0;
    return Math.exp(-(bt % 1) * 5);
  };
  let pulse = 0;
  d.every((_dt, wdt) => {
    pulse = pulseAt();
    rig.setPulse(pulse);
    kitCar.setPulse(pulse);
    kitCar.update(wdt);
  });

  // =====================================================================================
  // 0: your tach, idling under the stadium lights. A record scratch; the needle spazzes; it dies.
  // =====================================================================================
  const tach = buildTach();
  d.scene.add(tach.root);
  d.onDispose(() => tach.dispose());
  tach.power(1);
  const tachCam = new THREE.Vector3(-5.2, 1.15, PL - 0.2);
  const tachLook = new THREE.Vector3(1.2, 1.7, LANE);
  const placeTach = () => {
    const dir = tachLook.clone().sub(tachCam).normalize();
    const right = dir.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
    tach.root.position.copy(tachCam).addScaledVector(dir, 1.7).addScaledVector(right, -0.62).add(new THREE.Vector3(0, -0.1, 0));
    tach.root.lookAt(tachCam.clone().addScaledVector(right, -0.25));
  };
  tach.root.scale.setScalar(0.55);
  placeTach();
  d.bars(true);
  d.cut(0, tachCam, tachLook, 40, 0.03);
  d.move(0, FADER, { pos: tachCam.clone().add(new THREE.Vector3(0.25, 0.02, -0.05)), fov: 36, roll: 0.05 }, easeOut);
  d.at(0.05, () => extra('engineIdle', 1.0));
  d.span(0, DIE + 0.15, (u) => {
    const t = d.t;
    let n: number;
    if (t < SCR1) n = 0.13 + 0.015 * Math.sin(t * 40) + (t > 0.18 && t < 0.42 ? 0.3 * Math.sin(seg(t, 0.18, 0.42) * Math.PI) : 0); // a little blip
    else if (t < DIE) n = 0.3 + 0.45 * Math.sin((t - SCR1) * 50) * Math.sin((t - SCR1) * 13); // the scratch yanks it around
    else n = lerp(0.3, -0.04, easeOut(seg(t, DIE, DIE + 0.12)));
    tach.set(n);
    if (u >= 1) tach.set(-0.04);
  });
  d.at(SCR1, () => {
    extra('scratch');
    d.cam.shake(0.35);
    d.cam.punch(-3);
  });
  d.glitch(SCR1, SCR1 + 0.2, 0.5);
  d.span(SCR1, DIE, () => tach.power(hash(Math.floor(d.t * 30)) < 0.5 ? 1 : 0.4, hash(Math.floor(d.t * 30) + 7) < 0.4));
  d.at(DIE, () => {
    tach.power(0);
    extra('powerDown');
    d.cam.shake(0.2);
  });
  d.stamp(DIE + 0.02, 'TACH?', { color: '#8aa0d0', x: 230, y: 250, size: 16, rot: 0.1, dur: 0.28 });

  // =====================================================================================
  // 0.98: his hand on the LIGHTS fader. Yank.
  // =====================================================================================
  const knobW = () => Director.wp(kitCar.fader, new THREE.Vector3());
  d.at(FADER, () => {
    tach.root.visible = false;
    rig.setScratchSpeed(0);
    rig.setScratch(1, knobW());
    rig.setHandPose('R', 'grip');
  });
  d.follow(FADER, BANKS - 0.001, (u) => {
    const k = knobW();
    return { pos: k.clone().add(new THREE.Vector3(0.75, 0.75 - 0.15 * u, 1.35)), look: k.clone().add(new THREE.Vector3(-0.05, 0.25, 0)), fov: 34, roll: -0.08 };
  });
  d.span(FADER + 0.12, FADER + 0.24, (u) => {
    kitCar.setFader(easeOut(u));
    rig.setScratch(1, knobW());
  });
  d.at(FADER + 0.24, () => {
    extra('clunk');
    d.cam.shake(0.4);
    d.cam.punch(-4);
  });
  d.at(BANKS - 0.02, () => (rig.setScratch(0), rig.setHandPose('R', 'open')));
  d.stamp(FADER + 0.25, 'CLICK.', { color: '#ff2fd6', x: 470, y: 250, size: 16, rot: -0.1, dur: 0.35 });

  // =====================================================================================
  // 1.32: the banks clunk out, far to near
  // =====================================================================================
  d.cut(BANKS, [-11, 1.3, 5.5], [14, 7, -14], 54, 0.05);
  d.move(BANKS, DARK, { pos: [-10, 1.2, 5.0], fov: 50, roll: -0.03 }, easeOut);
  for (let i = 0; i < 6; i++)
    d.at(BANKS + 0.06 + i * 0.075, () => {
      set.power((x) => x < 200 - i * 52);
      d.cam.shake(0.3);
      d.cam.punch(-1.5);
      d.hype = 0.5 - i * 0.08;
      fog.color.setHex([0x160a1e, 0x12081a, 0x0e0614, 0x0a040e, 0x060208, 0x030104][i]);
      extra('clunk');
      if (i === 0 || i === 5) d.sfx.impact();
    });
  d.look(BANKS + 0.1, mixLook(JERK, CLUB, 0.5), 0.3);

  // =====================================================================================
  // 1.9: pitch black. Click: headphones. Click: shades. Ting: the grin and the gold tooth.
  // =====================================================================================
  const darkness = (on: boolean) => {
    set.group.visible = !on;
    d.crowd = on ? null : set.crowd;
    bg.setHex(on ? 0x000000 : 0x05020a);
  };
  const noseHl = rig.props.noseHl;
  d.at(DARK, () => {
    darkness(true);
    if (noseHl) noseHl.visible = false;
    club(0);
    rig.setGlow(0);
    rig.setShadesGlow(0);
    rig.setTrimGlow(0);
    rig.setGrinGlow(0);
    kitCar.setGlow(0);
    d.sfx.hush(0.1);
  });
  d.look(DARK, BLACK);
  d.follow(DARK, LASER - 0.001, (u) => fc(lerp(5.4, 4.1, easeInOut(u)), 0.05, 0.05, 0, 30, 0.02));
  d.at(PHONES, () => {
    rig.setGlow(1);
    extra('click');
    d.cam.punch(-2);
  });
  d.at(SHADES, () => {
    rig.setShadesGlow(1);
    extra('click');
    d.cam.punch(-2);
  });
  d.at(GRIN, () => {
    rig.setGrinGlow(1);
    d.sfx.tink();
    d.cam.punch(-3);
    const g = Director.wp(b.char.jaw, new THREE.Vector3());
    d.sparkle(g.add(new THREE.Vector3(0.12, 0.05, 0.5)), 22, '#ffe070');
  });
  d.stamp(GRIN + 0.08, 'LIGHTS\nOUT.', { color: '#ffffff', x: 160, y: 120, size: 24, rot: -0.1, dur: 0.48, burst: '#ff2fd6' });

  // =====================================================================================
  // 2.95: lasers rip on; he's vibing with a hand on one cup
  // =====================================================================================
  let laserOn = 0;
  d.at(LASER, () => {
    darkness(false);
    if (noseHl) noseHl.visible = true;
    set.power(() => false);
    club(1);
    rig.setTrimGlow(1);
    rig.setGrinGlow(0.55);
    kitCar.setGlow(1);
    b.char.setSignature(1);
    rig.setCup(1);
    laserOn = 1;
    d.hype = 0.6;
    fog.color.setHex(0x12061a);
    d.cam.punch(-6);
    d.cam.shake(0.5);
    d.flash('#ff2fd6', 0.4, 10);
    d.sfx.roar('dj');
    extra('laserZap');
  });
  d.look(LASER, CLUB);
  d.follow(LASER, BUILD - 0.001, (u) => fc(lerp(9.5, 8.6, u), lerp(0.55, 0.32, easeInOut(u)), lerp(-1.2, -0.9, u), -0.6, 38, 0.06));

  // =====================================================================================
  // 3.5: the build: finger to the sky, lasers converge above him, everything tightens
  // =====================================================================================
  const skyW = () => headPos(b, new THREE.Vector3()).add(new THREE.Vector3(-0.95, 0.5, 0.8));
  d.span(BUILD, DROP, (u) => {
    rig.setScratchSpeed(0);
    rig.setScratch(u >= 1 ? 0 : 1, skyW());
  });
  d.at(BUILD, () => {
    rig.setCup(0);
    rig.setHandPose('R', 'point');
    extra('riser', DROP - BUILD);
    d.sfx.inhale();
  });
  d.follow(BUILD, DROP - 0.001, (u) => {
    headPos(b, H);
    const e = easeInOut(u);
    return {
      pos: H.clone().add(new THREE.Vector3(lerp(-1.3, -0.9, e), lerp(-1.0, -1.3, e), lerp(4.8, 3.7, e))),
      look: H.clone().add(new THREE.Vector3(-0.35, lerp(0.35, 0.5, e), 0)),
      fov: lerp(44, 50, e),
      roll: lerp(-0.04, -0.12, e),
    };
  });
  d.span(BUILD, DROP, (u) => {
    d.cam.shake(0.04 + 0.2 * u * u);
    d.hype = 0.6 + 0.4 * u;
  });

  // =====================================================================================
  // 4.15: THE DROP
  // =====================================================================================
  const shock = new THREE.Mesh(
    new THREE.RingGeometry(0.82, 1, 64),
    new THREE.MeshBasicMaterial({ color: MAG, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
  );
  shock.rotation.x = -Math.PI / 2;
  shock.position.set(0, 0.06, LANE + 1.4);
  d.scene.add(shock);
  const shock2 = shock.clone();
  shock2.material = (shock.material as THREE.MeshBasicMaterial).clone();
  shock2.geometry = new THREE.RingGeometry(0.9, 1, 64);
  (shock2.material as THREE.MeshBasicMaterial).color.setHex(CYAN);
  d.scene.add(shock2);
  d.onDispose(() => {
    shock.geometry.dispose();
    shock2.geometry.dispose();
    (shock.material as THREE.Material).dispose();
    (shock2.material as THREE.Material).dispose();
  });
  /** Shockwave state from an age in seconds (negative = not yet). */
  const setShock = (age: number) => {
    for (const [m, lag] of [[shock, 0], [shock2, 0.04]] as const) {
      const a = age - lag;
      const on = a >= 0 && a < 0.9;
      m.visible = on;
      if (!on) continue;
      const s = (m === shock ? 1 + 34 : 0.6 + 14) * easeOut(Math.min(1, a / 0.8)) + 0.3;
      m.scale.set(s, s, 1);
      if (m === shock2) {
        headPos(b, m.position).y -= 0.6;
        m.lookAt(d.stage.camera.position);
      }
      (m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - a / 0.9);
    }
  };
  setShock(-1);
  const dropHit = (t: number, big: number) => {
    d.impactFrame(t, big > 0.7 ? '#ff2fd6' : '#2ff0ff', big > 0.7 ? 2 : 1);
    d.at(t, () => {
      d.cam.shake(1.6 * big);
      d.cam.punch(-10 * big);
      d.flash('#ffffff', 0.5 * big, 10);
      d.hype = 1;
      d.sfx.signature('dj');
      extra('bassDrop');
      if (big > 0.7) d.sfx.thunder();
      d.sfx.impact();
      rig.setHandPose('R', 'fist');
      rig.setHandPose('L', 'fist');
      // dust and sparks blown off the ground
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2;
        const p = new THREE.Vector3(Math.cos(a) * 2.4, 0.15, LANE + 1.4 + Math.sin(a) * 2.4);
        d.fx.smoke(p, 1, { color: 0x3a2048, size: rand(0.4, 0.7), grow: 2.2, life: 0.8, spread: 0.2, vel: { x: Math.cos(a) * 9, y: rand(0.5, 2), z: Math.sin(a) * 9 }, drag: 2.2 });
      }
    });
  };
  dropHit(DROP, 1);
  d.stamp(DROP + 0.03, 'DROP IT.', { color: '#2ff0ff', x: 200, y: 96, size: 24, rot: -0.12, dur: 0.75, burst: '#ff2fd6' });
  // wide low from the front: car, decks, stacks, lasers, the shockwave rolling out
  const dropCam = (u: number) => {
    const p = new THREE.Vector3(lerp(4.6, 4.0, easeOut(u)), lerp(0.6, 0.75, u), LANE + lerp(5.0, 4.4, easeOut(u)));
    return { pos: p, look: new THREE.Vector3(-0.5, 1.85, LANE + 0.3), fov: lerp(54, 48, easeOut(u)), roll: lerp(0.1, 0.04, u) };
  };
  d.follow(DROP, HIJACK - 0.001, (u) => dropCam(u));
  d.span(DROP, 30, () => {
    // beat: camera kicks, car bounces, strobe wash, fog breathes
    if (d.t < BLACKT || d.t >= CARD) {
      d.cam.shake(0.08 * pulse);
      b.car.setLean(0.02 * pulse * Math.sin(d.wt * 3), -0.05 * pulse);
      car.position.y = 0.06 * pulse;
      d.wash.col = Math.floor((d.wt - wDrop) / BEAT) % 2 ? '#ff2fd6' : '#2ff0ff';
      d.wash.a = d.t < BLACKT || d.t > CARD + 0.4 ? 0.07 * pulse : 0;
      fog.color.setRGB(0.07 + 0.12 * pulse, 0.02 + 0.02 * pulse, 0.1 + 0.1 * pulse);
    } else {
      car.position.y = 0;
      d.wash.a = 0;
    }
  });
  d.span(DROP, HIJACK, (u) => setShock((d.wt - wDrop)));

  // =====================================================================================
  // 4.85: meanwhile, your tach: dead, but the needle bounces to HIS beat. Your engine: "vroom..."
  // =====================================================================================
  d.at(HIJACK, () => {
    tach.root.visible = true;
    tach.power(0, true);
    rig.setHandPose('R', 'open');
    rig.setHandPose('L', 'open');
  });
  d.cut(HIJACK, tachCam, tachLook, 34, -0.06);
  d.move(HIJACK, SCRATCH, { pos: tachCam.clone().add(new THREE.Vector3(0.2, 0, -0.02)), fov: 31, roll: -0.09 }, easeOut);
  d.span(HIJACK, SCRATCH, () => {
    tach.set(0.05 + 0.85 * pulse);
    tach.power(0.1 + 0.25 * pulse, true);
  });
  d.stamp(HIJACK + 0.12, 'vroom...', { color: '#6a6478', x: 160, y: 250, size: 8, rot: 0.05, dur: 0.3 });
  d.at(HIJACK + 0.1, () => extra('engineSputter'));

  // =====================================================================================
  // 5.25: he scratches and the whole scene stutters and REWINDS... then drops again
  // =====================================================================================
  const recW = () => Director.wp(kitCar.records[0], new THREE.Vector3()).add(new THREE.Vector3(0.05, 0.03, 0.04));
  d.at(SCRATCH, () => {
    tach.root.visible = false;
    rig.setScratchSpeed(5.5);
    rig.setScratch(1, recW());
    rig.setHandPose('L', 'fist');
    extra('scratch');
  });
  d.follow(SCRATCH, REW - 0.001, () => {
    const r = recW();
    return { pos: r.clone().add(new THREE.Vector3(0.05, 0.8, 1.35)), look: r.clone().add(new THREE.Vector3(0.2, 0.62, 0)), fov: 44, roll: 0.1 };
  });
  d.span(SCRATCH, REW, () => {
    kitCar.setSpin(Math.cos(d.wt * 5.5 * Math.PI * 2) * 16);
    d.cam.shake(0.06);
  });
  d.glitch(SCRATCH + 0.12, SCRATCH + 0.2, 0.4);
  d.at(REW, () => {
    rig.setScratch(0);
    extra('scratch');
    d.sfx.glitch(FWD - REW);
  });
  // the rewind: back in the drop shot, the world runs backwards in stutters (the shockwave sucks back in)
  d.glitch(REW, FWD, 0.7);
  d.follow(REW, FWD - 0.001, (u) => {
    const back = 1 - (Math.floor(u * 9) / 9) * 0.9; // stepped, like a VHS rewind
    setShock(0.7 * back);
    kitCar.setSpin(-30);
    return dropCam(back * 0.6);
  });
  d.stamp(REW + 0.04, '<< REWIND', { color: '#ffffff', x: 140, y: 60, size: 16, rot: 0, dur: 0.3 });
  dropHit(FWD, 0.6);
  d.at(FWD, () => kitCar.setSpin(3.5));
  d.follow(FWD, MIC - 0.001, (u) => dropCam(0.2 + 0.8 * u));
  d.span(FWD, MIC, () => setShock((d.t - FWD)));
  d.stamp(FWD + 0.02, 'AGAIN!', { color: '#ff2fd6', x: 440, y: 92, size: 24, rot: 0.1, dur: 0.3 });

  // =====================================================================================
  // 6.2: shades up, mic out. 6.7: leans out over the lens. Slow-mo: he drops the mic ON YOU.
  // =====================================================================================
  d.at(MIC, () => {
    setShock(-1);
    mic.root.visible = true;
    rig.setHandPose('R', 'grip');
    rig.setHandPose('L', 'open');
    rig.setShades(0);
    d.sfx.whoosh();
    d.cam.punch(-4);
  });
  d.at(MIC + 0.15, () => d.sfx.voice('dj', 'laugh'));
  d.span(MIC + 0.15, HOLD, (u) => rig.setTalk(u >= 1 ? 0 : Math.abs(Math.sin(d.wt * 15))));
  d.follow(MIC, HOLD - 0.001, (u) => fc(lerp(6.6, 5.6, easeOut(u)), 0.3, -0.3, -0.3, 34, -0.05));
  // he reaches out over his decks and holds the mic right over the lens; we look up at him from below it
  const holdW = () => knobW().add(new THREE.Vector3(-0.55, 1.0, 0.95));
  let micCam: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  const lensCam = () => {
    const g = holdW();
    headPos(b, H);
    const pos = g.clone().add(new THREE.Vector3(0.25, -1.4, 0.5));
    const look = g.clone().lerp(H, 0.62);
    return { pos, look };
  };
  d.at(HOLD, () => {
    rig.setScratchSpeed(0);
    rig.setScratch(1, holdW());
  });
  d.follow(HOLD, LET, (u) => {
    const c = lensCam();
    micCam = c;
    return { pos: c.pos, look: c.look, fov: lerp(58, 52, easeOut(u)), roll: lerp(0.12, 0.05, u) };
  });
  d.slowmo(HOLD + 0.1, LENS - 0.02, 0.14, 0.2);
  d.at(HOLD + 0.1, () => extra('feedback'));
  let micFrom: THREE.Vector3 | null = null;
  d.at(LET, () => {
    rig.setHandPose('R', 'open');
    rig.setScratch(0.85, holdW().add(new THREE.Vector3(0, 0.12, 0)));
    d.scene.attach(mic.root);
    micFrom = mic.root.position.clone();
  });
  d.follow(LET, LENS, () => ({ pos: micCam!.pos, look: micCam!.look, fov: 50, roll: 0.05 }));
  d.span(LET, LENS, (u) => {
    if (!micFrom || !micCam) return;
    const c = d.stage.camera;
    const f = new THREE.Vector3();
    c.getWorldDirection(f);
    const to = c.position.clone().addScaledVector(f, 0.3);
    const k = easeInOut(u) * 0.35 + u * u * 0.65;
    mic.root.position.lerpVectors(micFrom, to, k);
    mic.root.rotation.set(0.4 + u * 2.2, u * 0.8, 0.3 + u * 1.6);
    mic.root.visible = u < 1;
  });
  d.impactFrame(LENS, '#ffffff', 1);
  d.at(LENS, () => {
    mic.root.visible = false;
    d.cam.shake(1.8);
    d.cam.punch(12);
    d.sfx.impact();
    extra('micThud');
  });

  // =====================================================================================
  // 7.93: HARD BLACKOUT. Only the glowing headphones and the grin.
  // =====================================================================================
  d.at(BLACKT, () => {
    darkness(true);
    if (noseHl) noseHl.visible = false;
    club(0);
    laserOn = 0;
    kitCar.setGlow(0);
    rig.setTrimGlow(0);
    rig.setShadesGlow(0);
    rig.setShades(1);
    rig.setGrinGlow(1);
    rig.setScratch(0);
    b.char.setSignature(0.4);
    d.sfx.hush(0.05);
  });
  d.look(BLACKT, BLACK);
  d.follow(BLACKT, CARD - 0.001, (u) => fc(lerp(5.6, 5.0, u), 0.0, -0.25, -0.35, 30, 0));
  d.at(BLACKT + 0.3, () => d.sfx.voice('dj', 'laugh'));
  d.at(BLACKT + 0.55, () => {
    const g = Director.wp(b.char.jaw, new THREE.Vector3());
    d.sparkle(g.add(new THREE.Vector3(0.12, 0.05, 0.5)), 24, '#ffe070');
    d.sfx.tink();
  });

  // =====================================================================================
  // CARD: everything slams back on (club lights, lasers), he's pumping both fists
  // =====================================================================================
  const heroCam = () => {
    const f = faceCam(b, 7.4, 0.32, -2.2, 0);
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
  d.at(CARD, () => {
    darkness(false);
    if (noseHl) noseHl.visible = true;
    set.power(() => false);
    club(1.1);
    laserOn = 1;
    kitCar.setGlow(1);
    rig.setTrimGlow(1);
    rig.setShades(1);
    rig.setGrinGlow(0.4);
    rig.setHandPose('R', 'fist');
    rig.setHandPose('L', 'fist');
    b.char.setSignature(1);
    d.hype = 1;
    fog.color.setHex(0x2a0a30);
    d.cam.shake(0.8);
  });
  d.look(CARD, HERO);
  d.follow(CARD, 30, (u) => {
    const h = heroCam();
    return { pos: h.pos, look: h.look, fov: lerp(46, 40, easeOut(Math.min(1, u * 6))), roll: 0.07 };
  });
  d.freeze(CARD, 0.25, 0.6);
  d.nameCard(CARD, { ...card, color: '#ff2fd6', accent: '#2ff0ff', layout: 'left' }, 0.8, 'dj');
  d.at(CARD + 0.7, () => d.sfx.voice('dj', 'taunt'));

  // ---------- lasers ----------
  const beamMat = (c: number, o: number) =>
    new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const coreGeo = new THREE.CylinderGeometry(0.025, 0.025, 1, 6, 1, true).translate(0, 0.5, 0);
  const haloGeo = new THREE.CylinderGeometry(0.09, 0.09, 1, 8, 1, true).translate(0, 0.5, 0);
  const flareTex = glowTexture();
  const beams: { g: THREE.Group; head: number; i: number; col: number; flare: THREE.Sprite; mats: THREE.MeshBasicMaterial[] }[] = [];
  kitCar.laserHeads.forEach((_h, hi) => {
    for (let i = 0; i < 3; i++) {
      const col = (hi + i) % 2 ? CYAN : MAG;
      const g = new THREE.Group();
      const cm = beamMat(0xffffff, 0.9), hm = beamMat(col, 0.35);
      cm.color.setHex(col).lerp(new THREE.Color(0xffffff), 0.5);
      const core = new THREE.Mesh(coreGeo, cm);
      const halo = new THREE.Mesh(haloGeo, hm);
      core.scale.y = halo.scale.y = 70;
      g.add(core, halo);
      d.scene.add(g);
      const flare = glowSprite(flareTex, col, 0.9, 0);
      d.scene.add(flare);
      beams.push({ g, head: hi, i, col, flare, mats: [cm, hm] });
    }
  });
  d.onDispose(() => {
    coreGeo.dispose();
    haloGeo.dispose();
    flareTex.dispose();
    for (const bm of beams) bm.mats.forEach((m) => m.dispose()), (bm.flare.material as THREE.Material).dispose();
  });
  const _o = new THREE.Vector3(), _dir = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _tgt = new THREE.Vector3();
  d.every(() => {
    const t = d.t;
    // laser "clock": world time, run backwards through the rewind
    let lt = d.wt;
    if (t >= REW && t < FWD) lt = d.wt - (t - REW) * 6;
    const build = t >= BUILD && t < DROP ? easeInOut(seg(t, BUILD, DROP - 0.1)) : 0;
    const on = laserOn && t < BLACKT ? 1 : laserOn && t >= CARD ? 1 : 0;
    if (build > 0) headPos(b, H);
    for (const bm of beams) {
      bm.g.visible = on > 0;
      (bm.flare.material as THREE.SpriteMaterial).opacity = on ? 0.9 : 0;
      if (!on) continue;
      Director.wp(kitCar.laserHeads[bm.head], _o);
      bm.g.position.copy(_o);
      bm.flare.position.copy(_o);
      const ph = bm.head * 1.7 + bm.i * 2.1;
      const stack = bm.head < 2;
      // sweeping fans: stacks throw up and out over both stands, the booth fans out toward the lens side
      const yaw = (stack ? 0 : 0.0) + (bm.i - 1) * 0.55 + Math.sin(lt * (stack ? 1.3 : 2.1) + ph) * (stack ? 1.1 : 0.7);
      const pitch = stack ? 0.35 + 0.25 * Math.sin(lt * 1.7 + ph * 0.7) : 0.12 + 0.18 * Math.sin(lt * 2.6 + ph);
      const side = stack ? (bm.i % 2 ? -1 : 1) : 1;
      _dir.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), side * Math.cos(yaw) * Math.cos(pitch));
      if (build > 0 && stack) {
        // converge on a point high above his raised finger
        _tgt.copy(H).add(new THREE.Vector3(0, 9, 0)).sub(_o).normalize();
        _dir.lerp(_tgt, build).normalize();
      }
      bm.g.quaternion.setFromUnitVectors(_up, _dir);
      const strobe = t >= HOLD && t < BLACKT ? 0.3 : t >= DROP && t < BLACKT ? 0.55 + 0.45 * pulse : 0.8;
      bm.mats[0].opacity = 0.9 * strobe;
      bm.mats[1].opacity = 0.35 * strobe;
    }
    // club lights pump with the beat
    if (laserOn) {
      lights.mag.intensity = 6 + 7 * pulse;
      lights.cyan.intensity = 8 + 7 * pulse;
    }
  });
}
