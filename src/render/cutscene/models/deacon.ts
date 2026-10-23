// Deacon Dread (final boss): a gaunt undertaker-preacher who has already measured you for the box. Black
// wide-brim hat, long black coat with a white preacher's tab collar, a necklace of spark plugs, a pale bony face
// with sunken cheeks, deep dark sockets and hollow, glowing white eyes. Carries a cane topped with a skull
// shift knob (props.cane; the scene parents it to a grip).
// Extra controls:
//   setEyeGlow(k 0..1, snap?)  the hollow eyes blaze: white-hot irises + a cold spectral bloom and a thin streak
//                       (sprites, faded when facing away). Once called, setSignature no longer drives the glow.
//   setGrin(k 0..1)     the death's-head grin: a too-wide crescent full of teeth, cheeks hollowing, lids
//                       narrowing (above 0.5 it replaces the mouth).
//   setSquint(k 0..1)   sizing you up: his left eye screws shut, the other brow arches high.
//   setHat(k 0..1)      0 = brim low over the eyes (only the glow shows under it), 1 = tipped back, face bare.
//   reachTo(side, worldPoint, k, bend?)  cartoon IK: blends that hand's palm onto a world point (applied after
//                       the idle pose; the scene's outer armL/armR rotations still count). k = 0 releases.
// setTurn(1) = his resting face: heavy level lids, low brows angled in, chin down staring up from under the
// brim, a thin cold one-sided smirk. (There is no sweet version worth seeing.)
import * as THREE from 'three';
import { buildBase, faceParts, finish, reach, type CharacterRigX } from './character';
import { clamp, damp } from './kit';
import { strand } from './parts';

export interface DeaconRig extends CharacterRigX {
  setEyeGlow(k: number, snap?: boolean): void;
  setGrin(k: number): void;
  setSquint(k: number): void;
  setHat(k: number): void;
  /** Blend one hand (1 = his left / armL, -1 = his right / armR) toward a world point (null releases it). */
  reachTo(side: 1 | -1, world: THREE.Vector3 | null, k: number, bend?: number): void;
}

export function buildDeacon(): DeaconRig {
  const b = buildBase({
    skin: 0xd2d6e2, shirt: 0x17171d, sleeve: 0x17171d, pants: 0x17171d, shoes: 0x0c0c10, brow: 0x2e2c38, iris: 0xf4fbff,
    lid: 0x4a4458, nose: 'sharp', jawW: 0.8, chestW: 0.86, chestD: 0.9, browScale: 1.15, blush: 0x8a90a8,
    sweet: { eye: [1.0, 1.0], pupil: 0.6 },
    jerk: {
      lid: [0.3, 0.3], lidLo: [0.16, 0.16], lidTilt: [-0.2, -0.2], browRot: [0.5, 0.5], browY: [-0.03, -0.03], eye: [0.96, 0.96],
      pupil: 1.0, headX: 0.12, headZ: -0.04, jawRoll: -0.03, mouth: 'smirkR', blush: 0, sparkle: 0,
    },
  });
  const k = b.kit, h = b.headInner;
  for (const e of b.ears) e.visible = false;
  // Gaunt: a longer, narrower skull, no chubby cheeks.
  b.cranium.scale.set(0.93, 1.07, 1);
  b.cranium.position.y = 0.52;
  for (const c of b.cheeks) c.visible = false;
  b.nose.scale.set(0.75, 1.0, 0.9);

  // Hollow eyes: dark sockets behind each eye, the eyeball itself goes near-black, the iris is a white-hot orb.
  const fp = faceParts(b);
  const socketMat = k.toon(0x231d2c, { gloss: 0, rim: 0.2 });
  const hollow = k.toon(0x16121e, { gloss: 0.6, shine: 80 });
  b.eyes.forEach((eye, i) => {
    const s = i === 0 ? 1 : -1;
    const sock = k.ball(0.15, socketMat, 1.05, 1.0, 0.35, 16, 0);
    sock.position.set(s * 0.158, 0.555, 0.3);
    sock.rotation.y = s * 0.28;
    h.add(sock);
    const ball = fp.inners[i].children[0] as THREE.Mesh;
    ball.material = hollow;
  });
  // The iris becomes a pale glowing orb (unlit, so it reads even under the brim's shadow); no pupil.
  const orbMat = k.own(new THREE.MeshBasicMaterial({ color: 0xdcfff0 }));
  const orbCore = k.own(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const orbs: THREE.Mesh[] = [];
  fp.hls.forEach((hl) => {
    const pg = hl.parent!;
    for (let n = 0; n < 3; n++) pg.children[n].visible = false; // ring, iris, pupil
    const orb = k.ball(0.56, orbMat, 1, 1, 0.3, 16, 0);
    orb.position.z = 0.9;
    pg.add(orb);
    const core = k.ball(0.3, orbCore, 1, 1, 0.3, 12, 0);
    core.position.z = 0.98;
    pg.add(core);
    orbs.push(orb);
  });
  const cOrbDim = new THREE.Color(0x9adcc8), cOrbHot = new THREE.Color(0xf0fff8);
  // Cheekbones + hollows below them (sunken), dark under-eye bags, a long chin.
  const hollowMat = k.toon(0xbfc2d0, { gloss: 0 });
  for (const s of [1, -1]) {
    const bone = k.ball(0.07, b.skinMat, 1.4, 0.55, 0.7, 14, 0);
    bone.position.set(s * 0.25, 0.46, 0.25);
    bone.rotation.y = s * 0.6;
    h.add(bone);
    const hol = k.ball(0.06, hollowMat, 0.8, 1.4, 0.3, 14, 0);
    hol.position.set(s * 0.245, 0.33, 0.262);
    hol.rotation.y = s * 0.75;
    h.add(hol);
    const bag = k.box(0.1, 0.01, 0.01, 0x8a8698, 0);
    bag.position.set(s * 0.16, 0.455, 0.392);
    bag.rotation.set(0, s * 0.3, s * 0.22);
    h.add(bag);
  }
  const chinTip = k.ball(0.1, b.skinMat, 1.1, 0.8, 0.9, 14, 0.016);
  chinTip.position.set(0, -0.22, 0.2);
  b.jawInner.add(chinTip);

  // Lank grey hair hanging from under the hat at the back and sides.
  const hairM = k.toon(0x9a98a8, { gloss: 0.2 });
  const strands = ([
    [0.25, 0.6, -0.3, 0.12], [-0.25, 0.6, -0.3, -0.12], [0.0, 0.62, -0.38, 0.0],
  ] as const).map(([x, y, z, rz]) => strand(b, h, { x, y, z }, { n: 5, len: 0.11, r0: 0.04, r1: 0.016, wide: 1.6, box: true, color: hairM, rx: 0.12, rz, curl: -0.03, flat: 0.35, outline: 0.012, stiffness: 50, damping: 6, lag: 0.5 }));

  // The hat: wide flat brim, flat-topped crown, a dull silver band with a spark-plug pin.
  const felt = k.toon(0x121216, { gloss: 0.35, shine: 40 });
  const hat = new THREE.Group();
  hat.position.set(0, 0.88, 0.0);
  h.add(hat);
  const hatTilt = new THREE.Group();
  hat.add(hatTilt);
  const brimPts = [[0.0, 0.0], [0.6, 0.0], [0.68, 0.03], [0.68, 0.05], [0.6, 0.028], [0.0, 0.028]].map(([x, y]) => new THREE.Vector2(x, y));
  const brim = k.mesh(new THREE.LatheGeometry(brimPts, 36), felt, 0.02);
  hatTilt.add(brim);
  const crownPts = [[0.41, 0], [0.4, 0.2], [0.385, 0.33], [0.35, 0.385], [0.2, 0.4], [0.12, 0.37], [0.0, 0.37]].map(([x, y]) => new THREE.Vector2(x, y));
  const crown = k.mesh(new THREE.LatheGeometry(crownPts, 32), felt, 0.02);
  crown.position.y = 0.02;
  hatTilt.add(crown);
  const silver = k.toon(0xc8ccd6, { gloss: 1, shine: 90 });
  const hband = k.cyl(0.412, 0.417, 0.07, 0x3a3a46, 28, 0.012);
  hband.position.y = 0.065;
  hatTilt.add(hband);
  const pin = sparkPlug(0.6);
  pin.position.set(0.23, 0.07, 0.35);
  pin.rotation.set(0, 0.55, 0.9);
  hatTilt.add(pin);

  // Coat: high collar, lapels, silver buttons, white preacher's tab at the throat.
  const coat = k.toon(0x17171d, { gloss: 0.3 });
  const lapelM = k.toon(0x26262e, { gloss: 0.5 });
  const collar = k.cyl(0.17, 0.21, 0.16, coat, 16, 0.014);
  collar.position.y = 0.68;
  b.torsoInner.add(collar);
  const whiteM = k.toon(0xf4f4f8, { gloss: 0.4 });
  const band = k.cyl(0.135, 0.14, 0.05, whiteM, 16, 0.01);
  band.position.y = 0.72;
  b.torsoInner.add(band);
  const tab = k.box(0.06, 0.06, 0.02, whiteM, 0.01);
  tab.position.set(0, 0.69, 0.14);
  tab.rotation.x = -0.25;
  b.torsoInner.add(tab);
  for (const s of [-1, 1]) {
    const lap = k.box(0.1, 0.36, 0.03, lapelM, 0.012);
    lap.position.set(s * 0.12, 0.45, 0.262);
    lap.rotation.set(-0.3, s * 0.35, s * 0.32);
    b.torsoInner.add(lap);
    // pointy shoulder pads: a bony, stooped silhouette
    const pad = k.ball(0.15, coat, 1.2, 0.7, 1, 14, 0.014);
    pad.position.set(s * 0.3, 0.6, 0);
    b.torsoInner.add(pad);
  }
  for (const y of [0.24, 0.12]) {
    const btn = k.ball(0.022, silver, 1, 1, 0.5, 10, 0.006);
    btn.position.set(0, y, 0.27);
    b.torsoInner.add(btn);
  }
  // Coat tails flaring below the waist (seen when he stands).
  const tails = k.cyl(0.34, 0.46, 0.5, coat, 18, 0.016);
  tails.position.y = -0.18;
  b.torsoInner.add(tails);

  // The spark plug necklace: a silver chain over the coat, seven plugs hanging tip-down.
  const chainM = k.toon(0x9a9eaa, { gloss: 0.9 });
  const N = 7;
  const plugs: THREE.Object3D[] = [];
  for (let i = 0; i <= 26; i++) {
    const u = i / 26 * 2 - 1;
    const bead = k.ball(0.011, chainM, 1, 1, 1, 6, 0);
    bead.position.set(u * 0.22, 0.6 - 0.16 * (1 - u * u), 0.2 + 0.1 * (1 - u * u));
    b.torsoInner.add(bead);
  }
  for (let i = 0; i < N; i++) {
    const u = (i / (N - 1)) * 2 - 1;
    const p = sparkPlug(1);
    p.position.set(u * 0.19, 0.6 - 0.16 * (1 - u * u * 0.85) - 0.01, 0.215 + 0.1 * (1 - u * u));
    p.rotation.set(-0.25, 0, -u * 0.35);
    b.torsoInner.add(p);
    plugs.push(p);
  }

  /** A spark plug hanging from its terminal (origin), tip pointing down -Y. ~0.11 m. */
  function sparkPlug(sc: number) {
    const g = new THREE.Group();
    const ceramic = k.toon(0xf6f4ee, { gloss: 0.8, shine: 70 });
    const term = k.cyl(0.008, 0.008, 0.02, silver, 8, 0);
    term.position.y = -0.01;
    g.add(term);
    const ins = k.cyl(0.013, 0.018, 0.05, ceramic, 10, 0.006);
    ins.position.y = -0.045;
    g.add(ins);
    const hex = k.cyl(0.023, 0.023, 0.016, silver, 6, 0.006);
    hex.position.y = -0.077;
    g.add(hex);
    const thread = k.cyl(0.013, 0.013, 0.025, 0x9a9eaa, 8, 0.005);
    thread.position.y = -0.097;
    g.add(thread);
    const elec = k.box(0.004, 0.012, 0.004, silver, 0);
    elec.position.y = -0.114;
    g.add(elec);
    g.scale.setScalar(sc);
    return g;
  }

  // Death's-head grin: a too-wide thin crescent packed with teeth (on the chin, replaces the mouth).
  const grin = new THREE.Group();
  {
    const dark = k.toon(0x1c0e18), teeth = k.toon(0xf4f0e2);
    const mw = 0.15 * 0.8 * 1.45, n = 22;
    const top: [number, number][] = [], bot: [number, number][] = [], tt: [number, number][] = [], tb: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, x = (u * 2 - 1) * mw;
      const yC = 0.055 * (u * 2 - 1) ** 2 - 0.012; // corners hooked high
      const open = 0.004 + 0.036 * Math.sin(Math.PI * u) ** 0.8;
      top.push([x, yC + open * 0.35]);
      bot.unshift([x, yC - open]);
      if (u > 0.06 && u < 0.94) tt.push([x, yC + open * 0.2]), tb.unshift([x, yC - open * 0.8]);
    }
    grin.add(b.chinDecal([...top, ...bot], dark, 0.004, -0.06));
    grin.add(b.chinDecal([...tt, ...tb], teeth, 0.008, -0.06));
    for (let i = 1; i < 10; i++) {
      const u = 0.06 + (i / 10) * 0.88, x = (u * 2 - 1) * mw, yC = 0.055 * (u * 2 - 1) ** 2 - 0.012;
      const open = 0.004 + 0.036 * Math.sin(Math.PI * u) ** 0.8;
      grin.add(b.chinDecal([[x - 0.0025, yC + open * 0.25], [x + 0.0025, yC + open * 0.25], [x + 0.0025, yC - open * 0.85], [x - 0.0025, yC - open * 0.85]], dark, 0.011, -0.06));
    }
    for (const s of [-1, 1]) {
      const cx = s * mw, cy = 0.043;
      grin.add(b.chinDecal([[cx, cy], [cx + s * 0.03, cy + 0.035], [cx + s * 0.024, cy + 0.038], [cx - s * 0.004, cy + 0.006]], dark, 0.006, -0.06));
    }
  }
  grin.visible = false;
  b.jawInner.add(grin);

  // Glow sprites for the hollow eyes (white core, cold spectral bloom, thin streak).
  const radial = k.canvas(32, 32, (g, w, hh) => {
    const gr = g.createRadialGradient(w / 2, hh / 2, 0, w / 2, hh / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.8)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.22)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, hh);
  }, true);
  let glow = 0;
  const glowGroups: THREE.Group[] = [];
  const _ep = new THREE.Vector3(), _ef = new THREE.Vector3(), _q = new THREE.Quaternion(), _cp = new THREE.Vector3();
  b.eyes.forEach((eye) => {
    const gg = new THREE.Group();
    gg.position.set(0, 0, 0.085);
    gg.visible = false;
    eye.add(gg);
    for (const [col, op, sx, sy] of [[0x8affd8, 0.55, 0.42, 0.38], [0xc8fff0, 0.7, 1.2, 0.035], [0xffffff, 1, 0.13, 0.11]] as const) {
      const m = k.own(new THREE.SpriteMaterial({ map: radial, color: col, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
      const sp = new THREE.Sprite(m);
      sp.scale.set(sx, sy, 1);
      sp.renderOrder = 20;
      sp.onBeforeRender = (_r, _s, camera) => {
        eye.getWorldPosition(_ep);
        eye.getWorldQuaternion(_q);
        _ef.set(0, 0, 1).applyQuaternion(_q);
        const toCam = camera.getWorldPosition(_cp).sub(_ep).normalize();
        const f = clamp((_ef.dot(toCam) - 0.05) / 0.35, 0, 1);
        m.opacity = op * f * clamp(glow * 1.4, 0, 1);
      };
      gg.add(sp);
    }
    glowGroups.push(gg);
  });

  b.props.hat = hat;
  b.props.necklace = plugs[3];
  b.props.grin = grin;
  b.props.eyeGlowL = glowGroups[0];
  b.props.eyeGlowR = glowGroups[1];

  const reaches: { side: 1 | -1; pt: THREE.Vector3 | null; k: number; bend: number }[] = [
    { side: 1, pt: null, k: 0, bend: 0.4 }, { side: -1, pt: null, k: 0, bend: 0.4 },
  ];
  let glowManual = false, glowT = 0, grinT = 0, grinK = 0, sqT = 0, sq = 0, hatT = 0, hatK = 0;
  const rig = finish(b, (c) => {
    const { sig, face, dt, t } = c;
    if (c.turnOn) {
      // Stooped, still and looming; the head drifts a hair, like something not quite alive.
      const j = c.turn;
      b.torsoInner.rotation.z *= 1 - 0.8 * j;
      b.torsoInner.rotation.x += 0.06 * j;
      face.headZ += Math.sin(t * 0.9) * 0.025 * j;
      c.lookAdd.y += 0.2 * j; // staring up from under the brim
    }
    glow = glowManual ? damp(glow, glowT, 30, c.bdt) : damp(glow, sig, 6, dt);
    grinK = damp(grinK, grinT, 22, c.bdt);
    sq = damp(sq, sqT, 22, c.bdt);
    hatK = damp(hatK, hatT, 16, c.bdt);
    // hat: brim low by default; tipped back with setHat
    hatTilt.rotation.x = 0.14 - 0.42 * hatK;
    hat.position.set(0, 0.88 + 0.04 * hatK, -0.03 * hatK);
    // eyes: irises run white-hot with the glow
    orbMat.color.copy(cOrbDim).lerp(cOrbHot, clamp(glow * 1.5, 0, 1));
    for (const o of orbs) o.scale.setScalar(0.85 + 0.25 * glow);
    for (const g of glowGroups) {
      g.visible = glow > 0.03;
      const s = 0.75 + 0.35 * glow;
      g.scale.set(s, s, 1);
    }
    if (grinK > 0.01) {
      const g = grinK;
      for (let i = 0; i < 2; i++) {
        face.lid[i] += (0.5 - face.lid[i]) * g;
        face.lidLo[i] += (0.34 - face.lidLo[i]) * g;
        face.lidTilt[i] += (-0.26 - face.lidTilt[i]) * g;
        face.browRot[i] += (0.62 - face.browRot[i]) * g;
        face.browY[i] += (-0.04 - face.browY[i]) * g;
      }
      face.headX += -0.06 * g;
      face.jaw *= 1 - g;
    }
    if (sq > 0.01) {
      // his left eye screwed shut, the right brow arched up: sizing you up
      face.lid[0] += (0.82 - face.lid[0]) * sq;
      face.lidLo[0] += (0.5 - face.lidLo[0]) * sq;
      face.browRot[0] += (0.7 - face.browRot[0]) * sq;
      face.browY[0] += (-0.05 - face.browY[0]) * sq;
      face.lid[1] += (0.12 - face.lid[1]) * sq;
      face.browRot[1] += (-0.35 - face.browRot[1]) * sq;
      face.browY[1] += (0.05 - face.browY[1]) * sq;
      face.eye[1] += (1.12 - face.eye[1]) * sq;
      face.headZ += 0.1 * sq;
    }
    const grinOn = grinK > 0.5 && face.jaw <= 0.1;
    grin.visible = grinOn;
    if (grinOn) face.mouth = 'none';
    for (const s of strands) s.gust = 0.12 + 0.3 * sig;
    for (const r of reaches) if (r.pt && r.k > 0.001) reach(b, r.side, r.pt, r.k, r.bend);
  });
  return Object.assign(rig, {
    setEyeGlow(v: number, snap = false) {
      glowManual = true;
      glowT = clamp(v, 0, 1);
      if (snap) glow = glowT;
    },
    setGrin(v: number) {
      grinT = clamp(v, 0, 1);
    },
    setSquint(v: number) {
      sqT = clamp(v, 0, 1);
    },
    setHat(v: number) {
      hatT = clamp(v, 0, 1);
    },
    reachTo(side: 1 | -1, world: THREE.Vector3 | null, v: number, bend = 0.4) {
      const r = reaches[side === 1 ? 0 : 1];
      r.pt = world ? (r.pt ?? new THREE.Vector3()).copy(world) : null;
      r.k = clamp(v, 0, 1);
      r.bend = bend;
    },
  });
}
