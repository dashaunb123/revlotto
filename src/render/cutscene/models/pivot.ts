// Professor Pivot: a smug, pedantic professor who has already failed you. Tweed jacket with leather elbow
// patches, cream shirt, red bow tie, chalk sticks in the breast pocket, a mortarboard with a swinging gold
// tassel, a gold monocle on his left eye (with its dangling chain), a pointy grey goatee, grey ear tufts and
// huge bushy brows. Holds a long wooden pointer stick with a red chalk tip in his right fist.
//
// Extra controls (drive them from the scene on real beats; all instant targets with short smoothing):
//   setPointer(k 0..1)   0 = pointer stick hidden, 1 = in his right fist (props.pointer, tip props.pointerTip).
//   adjustMonocle(k 0..1) his left hand pinches the monocle rim (thumb + finger 'grip' pinch at the eye), the
//                        monocle eye pops extra wide behind the glass and the brow shoots up.
//   setSmug(k 0..1)      nose in the air: chin up high, both eyes shut in contempt, brows raised, a tight smirk.
//   setScold(k 0..1)     the lecture face: brows slammed down and in, eyes narrowed, mouth bared (teeth).
// setTurn(k): sweet = a kindly old teacher (soft brows, twinkly eyes). Jerk = condescension itself: the
// monocle eye wide and magnified under a sky-high brow, the other eye half-lidded and squinting, chin up,
// looking down his nose, a lopsided smirk. Signature: the "harrumph": nose up, shoulders shrug, tassel flick.
import * as THREE from 'three';
import { buildBase, finish, reach, type CharacterRigX } from './character';
import { clamp, damp } from './kit';
import { shell, strand } from './parts';

export interface PivotRig extends CharacterRigX {
  setPointer(k: number): void;
  adjustMonocle(k: number): void;
  setSmug(k: number): void;
  setScold(k: number): void;
}

export function buildPivot(): PivotRig {
  const TWEED = 0x8a6238;
  const b = buildBase({
    skin: 0xf2c6a0, shirt: TWEED, pants: 0x4e3a26, shoes: 0x2e1c10, brow: 0xdcdce4, iris: 0x4a8a52, hands: 0xf2c6a0,
    nose: 'sharp', jawW: 0.92, chestW: 0.98, chestD: 1.05, belly: 0.95, headScale: 1.05, browScale: 1.45,
    sweet: { eye: [1.1, 1.1], pupil: 1.3, browY: [0.05, 0.05], browRot: [-0.4, -0.4], headZ: 0.06 },
    jerk: {
      lid: [0.02, 0.55], lidLo: [0.05, 0.32], lidTilt: [0.05, -0.18], eye: [1.28, 0.94], pupil: 0.72,
      browY: [0.085, -0.03], browRot: [-0.3, 0.5], headX: -0.2, headZ: -0.08, jawRoll: 0.06, mouth: 'sneerR',
    },
  });
  const k = b.kit, h = b.headInner;

  // ---- Tweed: a flecked two-tone weave on the jacket (body + sleeves) ----
  const tweedTex = k.canvas(32, 32, (g, w, hh) => {
    g.fillStyle = '#8a6238';
    g.fillRect(0, 0, w, hh);
    for (let y = 0; y < hh; y += 2)
      for (let x = 0; x < w; x += 2) {
        const herring = ((x >> 2) + (y >> 1)) % 4 < 2;
        g.fillStyle = herring ? '#93693e' : '#835c34';
        g.fillRect(x, y, 2, 2);
      }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = i % 3 ? '#a87e4e' : '#6a4626';
      g.fillRect((i * 37) % w, (i * 53) % hh, 1, 1);
    }
  });
  tweedTex.wrapS = tweedTex.wrapT = THREE.RepeatWrapping;
  tweedTex.repeat.set(2, 2);
  const tweedOld = k.toon(TWEED);
  const tweed = k.toonUnique(0xffffff, { gloss: 0.08 });
  tweed.map = tweedTex;
  b.root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.material === tweedOld) m.material = tweed;
  });

  // Lapels, cream shirt V, red bow tie, breast pocket with chalk sticks, buttons.
  const shirtV = k.ball(0.17, 0xf4ead2, 0.9, 1.3, 0.35, 14, 0.012);
  shirtV.position.set(0, 0.52, 0.265);
  shirtV.rotation.x = -0.25;
  b.torsoInner.add(shirtV);
  const lapelM = k.toon(0x5e3e20);
  for (const s of [-1, 1]) {
    const lapel = k.box(0.1, 0.36, 0.04, lapelM, 0.012);
    lapel.position.set(s * 0.11, 0.48, 0.28);
    lapel.rotation.set(-0.28, s * 0.35, s * 0.38);
    b.torsoInner.add(lapel);
  }
  const bowM = k.toon(0xd8283a, { gloss: 0.6 });
  const bow = new THREE.Group();
  bow.position.set(0, 0.66, 0.27);
  b.torsoInner.add(bow);
  for (const s of [-1, 1]) {
    const wing = k.mesh(new THREE.ConeGeometry(0.075, 0.15, 10), bowM, 0.012);
    wing.rotation.z = (s * Math.PI) / 2;
    wing.position.x = s * 0.075;
    bow.add(wing);
  }
  bow.add(k.ball(0.04, bowM, 1, 1, 0.8, 10, 0.01));
  const pocket = k.box(0.15, 0.1, 0.03, 0x5e3e20, 0.012);
  pocket.position.set(0.2, 0.42, 0.25);
  pocket.rotation.y = 0.5;
  b.torsoInner.add(pocket);
  [0xffffff, 0xff8aa8, 0x9ad8ff].forEach((c, i) => {
    const chalk = k.cyl(0.018, 0.018, 0.14, c, 8, 0.008);
    chalk.position.set(0.16 + i * 0.035, 0.49, 0.26 - i * 0.02);
    chalk.rotation.z = -0.15 + i * 0.12;
    b.torsoInner.add(chalk);
  });
  for (const y of [0.3, 0.17]) {
    const btn = k.cyl(0.03, 0.03, 0.02, 0x3a2414, 10, 0.008);
    btn.rotation.x = Math.PI / 2;
    btn.position.set(0, y, 0.33);
    b.torsoInner.add(btn);
  }
  // Leather elbow patches: on the back of each elbow (arms hang with the elbow pointing back).
  const leather = k.toon(0x4a2c16, { gloss: 0.3 });
  for (const el of [b.elbowL, b.elbowR]) {
    const patch = k.ball(0.075, leather, 0.85, 1.25, 0.45, 12, 0.01);
    patch.position.set(0, -0.03, -0.075);
    el.add(patch);
  }

  // ---- Head: bald dome, grey ear tufts, goatee, monocle, mortarboard ----
  const grey = k.toon(0xe6e6ee), greyS = k.toon(0xb8bccc);
  for (const s of [-1, 1]) {
    for (const [x, y, z, r] of [[0.4, 0.58, -0.08, 0.1], [0.43, 0.48, -0.16, 0.09], [0.36, 0.68, -0.16, 0.08]] as const) {
      const tuft = k.ball(r, x > 0.42 ? greyS : grey, 1, 1.1, 1, 10);
      tuft.position.set(s * x, y, z);
      h.add(tuft);
    }
  }
  // Pointy goatee riding the chin.
  const goatee = k.mesh(new THREE.ConeGeometry(0.1, 0.34, 12), grey, 0.012);
  goatee.rotation.x = Math.PI + 0.45;
  goatee.position.set(0, -0.3, 0.3);
  b.jawInner.add(goatee);
  const goateeTop = k.ball(0.09, grey, 1.4, 0.6, 0.7, 10, 0.01);
  goateeTop.position.set(0, -0.15, 0.33);
  b.jawInner.add(goateeTop);
  // Pencil moustache.
  const stache = k.ball(0.085, grey, 1.7, 0.3, 0.5, 10, 0.01);
  stache.position.set(0, 0.345, 0.41);
  stache.rotation.z = 0.08;
  h.add(stache);

  // Monocle on his left eye (+X): gold rim, faint glass, a glint and a dangling chain.
  const gold = k.toon(0xf2c040, { gloss: 0.9, shine: 90 });
  const monocle = new THREE.Group();
  const M0 = new THREE.Vector3(0.158, 0.57, 0.4);
  monocle.position.copy(M0);
  monocle.rotation.y = 0.28;
  h.add(monocle);
  const rim = k.mesh(new THREE.TorusGeometry(0.135, 0.02, 8, 28), gold, 0.012);
  monocle.add(rim);
  const glass = new THREE.Mesh(
    k.geo(new THREE.CircleGeometry(0.128, 28)),
    k.own(new THREE.MeshBasicMaterial({ color: 0xcfeeff, transparent: true, opacity: 0.22, depthWrite: false })),
  );
  monocle.add(glass);
  const glint = new THREE.Mesh(k.geo(new THREE.PlaneGeometry(0.03, 0.15)), k.own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })));
  glint.position.set(-0.05, 0.03, 0.005);
  glint.rotation.z = -0.65;
  monocle.add(glint);
  const chainAnchor = new THREE.Object3D();
  chainAnchor.position.set(0.11, -0.08, 0);
  monocle.add(chainAnchor);
  strand(b, chainAnchor, { x: 0, y: 0, z: 0 }, {
    n: 6, len: 0.07, r0: 0.016, r1: 0.016, color: gold, rx: 0.15, rz: 0.3, stiffness: 40, damping: 3, inertia: 0.12, outline: 0.006,
  });

  // Mortarboard: a snug skull cap, a flat square board tilted rakishly, a button, a cord and a gold tassel.
  const capM = k.toon(0x1c1a24, { gloss: 0.35 });
  const mortar = new THREE.Group();
  mortar.position.set(0, 0.97, -0.05);
  mortar.rotation.set(-0.12, 0, 0.14);
  h.add(mortar);
  const skull = shell(b, 0.43, capM, 0, Math.PI * 2, 0, 0.95, 1.07, 0.7, 1.0);
  skull.position.y = -0.4;
  mortar.add(skull);
  const brimBand = k.cyl(0.41, 0.43, 0.08, capM, 20, 0.012);
  brimBand.position.y = -0.13;
  mortar.add(brimBand);
  const board = k.box(0.98, 0.045, 0.98, capM, 0.016);
  board.rotation.y = Math.PI / 4 + 0.15;
  board.position.y = 0.06;
  mortar.add(board);
  const btnTop = k.cyl(0.05, 0.05, 0.03, gold, 10, 0.008);
  btnTop.position.y = 0.095;
  mortar.add(btnTop);
  // Cord along the board to the front-left corner, then the tassel hangs off the edge on a spring chain.
  const corner = new THREE.Vector3(0.6, 0.09, 0.18);
  const cordLen = corner.length();
  const cord = k.cyl(0.014, 0.014, cordLen, gold, 6, 0.006);
  cord.geometry.rotateZ(Math.PI / 2);
  cord.position.set(corner.x / 2, 0.09, corner.z / 2);
  cord.rotation.y = -Math.atan2(corner.z, corner.x);
  mortar.add(cord);
  const tasselAnchor = new THREE.Object3D();
  tasselAnchor.position.copy(corner);
  mortar.add(tasselAnchor);
  const tassel = strand(b, tasselAnchor, { x: 0, y: 0, z: 0 }, {
    n: 4, len: 0.085, r0: 0.018, r1: 0.05, color: gold, rx: 0.1, rz: 0.15, stiffness: 30, damping: 2.4, inertia: 0.16, lag: 0.8, outline: 0.008,
  });
  // Fringe on the last link.
  const last = tassel.joints[tassel.joints.length - 1];
  const fringe = k.mesh(new THREE.CylinderGeometry(0.03, 0.07, 0.13, 12), k.toon(0xffd84a), 0.008);
  fringe.position.y = -0.12;
  last.add(fringe);

  // ---- The pointer stick (right fist): long tapered wood, brass ferrule, red chalk tip ----
  const pointer = new THREE.Group();
  const wood = k.toon(0xc8945a, { gloss: 0.5 });
  const stick = k.cyl(0.018, 0.034, 1.25, wood, 10, 0.01);
  stick.geometry.rotateZ(-Math.PI / 2);
  stick.position.x = 0.5;
  pointer.add(stick);
  const knob = k.ball(0.045, 0x6a3e1c, 1, 1, 1, 10, 0.01);
  knob.position.x = -0.12;
  pointer.add(knob);
  const ferrule = k.cyl(0.024, 0.024, 0.06, gold, 10, 0.008);
  ferrule.geometry.rotateZ(-Math.PI / 2);
  ferrule.position.x = 1.1;
  pointer.add(ferrule);
  const tip = k.ball(0.03, 0xe8202e, 1.6, 1, 1, 10, 0.008);
  tip.position.x = 1.16;
  pointer.add(tip);
  const pointerTip = new THREE.Object3D();
  pointerTip.position.x = 1.19;
  pointer.add(pointerTip);
  pointer.visible = false;
  const gripR = b.props.gripR;
  gripR.add(pointer);

  b.props.mortarboard = mortar;
  b.props.tassel = tassel.joints[0];
  b.props.monocle = monocle;
  b.props.pointer = pointer;
  b.props.pointerTip = pointerTip;
  b.props.bowtie = bow;
  b.props.goatee = goatee;

  let ptrT = 0, monoT = 0, mono = 0, smugT = 0, smug = 0, scoldT = 0, scold = 0;
  const _w = new THREE.Vector3();
  const rig = finish(b, (c) => {
    const { t, face, sig } = c;
    const bdt = c.bdt;
    mono = damp(mono, monoT, 18, bdt);
    smug = damp(smug, smugT, 14, bdt);
    scold = damp(scold, scoldT, 18, bdt);
    pointer.visible = ptrT > 0.5;
    if (pointer.visible) c.hand[1] = 'grip';

    // Jerk posture: sits up very straight, chest out, chin up (looking down his nose at you).
    const j = c.turn;
    if (c.turnOn) {
      b.torsoInner.rotation.x -= 0.16 * j;
      b.torsoInner.position.z -= 0.03 * j;
    }
    // Signature: the harrumph (nose up, shoulders shrug, tassel flick).
    const hm = sig * Math.max(0, Math.sin(t * 5)) ** 2;
    face.headX -= 0.12 * sig + 0.05 * hm;
    b.torsoInner.position.y += 0.03 * hm;
    tassel.gust = 0.15 + 0.6 * sig;
    tassel.freq = 2 + 2 * sig;
    tassel.wind.set(0.1 * sig, 0);

    // Scold: furious lecture face.
    if (scold > 0.001) {
      const s = scold;
      for (let i = 0; i < 2; i++) {
        face.browRot[i] += (0.7 - face.browRot[i]) * s;
        face.browY[i] += (-0.04 - face.browY[i]) * s;
        face.lid[i] += (0.3 - face.lid[i]) * s;
        face.lidTilt[i] += (-0.35 - face.lidTilt[i]) * s;
        if (i === 1) face.eye[i] += (1.0 - face.eye[i]) * s;
      }
      face.pupil += (0.55 - face.pupil) * s;
      face.headX += (0.08 - face.headX) * s;
      if (s > 0.5 && face.jaw < 0.1) face.mouth = 'teeth';
    }
    // Smug: nose in the air, eyes shut, brows raised.
    if (smug > 0.001) {
      const s = smug;
      for (let i = 0; i < 2; i++) {
        face.lid[i] += (0.92 - face.lid[i]) * s;
        face.lidLo[i] += (0.2 - face.lidLo[i]) * s;
        face.lidTilt[i] += (0.15 - face.lidTilt[i]) * s;
        face.browY[i] += (0.06 - face.browY[i]) * s;
        face.browRot[i] += (-0.25 - face.browRot[i]) * s;
      }
      face.headX += (-0.34 - face.headX) * s;
      face.headZ += (0.12 - face.headZ) * s;
      if (s > 0.5) face.mouth = 'smirk';
    }
    // Monocle adjust: eye pops huge behind the glass, the brow shoots up.
    if (mono > 0.001) {
      face.eye[0] += (1.42 - face.eye[0]) * mono;
      face.lid[0] *= 1 - mono;
      face.browY[0] += (0.11 - face.browY[0]) * mono;
      face.browRot[0] += (-0.4 - face.browRot[0]) * mono;
      face.pupil += (0.6 - face.pupil) * mono;
    }
    monocle.position.set(M0.x, M0.y + 0.012 * mono, M0.z + 0.02 * mono);
    monocle.rotation.z = 0.25 * mono * Math.sin(t * 9) * 0.4;
    monocle.scale.setScalar(1 + 0.08 * mono);
    // Bushy brows always a little twitchy.
    face.browY[0] += 0.006 * Math.sin(t * 3.1);
    // Arms: the monocle pinch (left hand to the rim).
    if (mono > 0.01) {
      b.root.updateMatrixWorld(true);
      _w.set(0.13, -0.04, 0.05);
      monocle.localToWorld(_w);
      reach(b, 1, _w, clamp(mono * 1.4, 0, 1), 1.5);
      c.hand[0] = 'grip';
    }
  });
  return Object.assign(rig, {
    setPointer(v: number) {
      ptrT = clamp(v, 0, 1);
    },
    adjustMonocle(v: number) {
      monoT = clamp(v, 0, 1);
    },
    setSmug(v: number) {
      smugT = clamp(v, 0, 1);
    },
    setScold(v: number) {
      scoldT = clamp(v, 0, 1);
    },
  });
}
