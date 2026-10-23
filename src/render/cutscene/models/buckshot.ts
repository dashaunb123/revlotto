// Sheriff Buckshot: smug deadpan lawman. Hat, mirrored teardrop aviators, push-broom moustache with a
// hiked smirk corner, a fat toothpick, star badge.
//
// Explicit beat controls (drive them from the scene on real beats; no oscillators):
//   setShades(k 0..1)  0 = aviators on (eyes hidden), 1 = slid down the nose, eyes staring over the top.
//                      While k is changing his left index finger pushes the bridge.
//   flickPick()        toothpick snaps to the other mouth corner in ~60 ms (rig time) with a short smear.
//   tipHat(k 0..1)     right hand, two fingers on the brim, hat dips forward.
//   fingerGuns(k 0..1) both hands point finger-guns straight out of his front (+Z, at the camera).
//   flipShades(k 0..1) 0 = aviators flipped up onto the hat brim, 1 = flipped down over the eyes (instant;
//                      ramp it, ease-back for a snap). The first call wraps props.glasses in a carrier group
//                      (props.shadesHinge); until then the glasses' parent is untouched, so scenes that
//                      re-parent them themselves keep working (use one approach or the other, not both).
// setTurn(k): sweet = big twinkly blue eyes, rosy cheeks, moustache lifted on a closed smile, hat pushed back,
// upright. Jerk = smug deadpan contempt: heavy level lids, one brow cocked, chin up, leaning BACK with the belly
// out, the smirk corner of the moustache hiked. Hands use the shared poses (guns = 'gun', tip = 'grip',
// shades push = 'flat' fingers together) and are released to setHandPose's pose afterwards.
// setSignature still works: until any of these is called it plays the old idle twirl/tip loop; after
// that it only adds the smug brow and a small toothpick wiggle, so it never fights the beats.
import * as THREE from 'three';
import { buildBase, finish, reach, type CharacterRigX } from './character';
import { clamp, damp } from './kit';
import { starShape } from './parts';

export interface BuckshotRig extends CharacterRigX {
  setShades(k: number): void;
  flickPick(): void;
  tipHat(k: number): void;
  fingerGuns(k: number): void;
  flipShades(k: number): void;
}

/** Teardrop aviator outline for the lens on side s (+1 = character's left): flat-ish top, lobe drooping down and outward. */
function aviatorShape(s: number, w = 0.15, top = 0.11, bot = 0.18): THREE.Shape {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2, cx = Math.cos(a), cy = Math.sin(a);
    let x = w * cx, y = cy > 0 ? top * Math.pow(cy, 0.5) : bot * cy;
    if (cy < 0) x = w * cx * (1 - 0.42 * -cy) + 0.07 * -cy; // bottom narrows into a lobe that sags outward
    if (cy > 0) x += 0.02 * cy; // slight outward lean of the top bar
    pts.push(new THREE.Vector2(s * x, y));
  }
  if (s < 0) pts.reverse();
  return new THREE.Shape(pts);
}

/** Planar UVs over the geometry's XY bounding box (so a texture spans the whole lens). */
function boxUV(g: THREE.BufferGeometry) {
  g.computeBoundingBox();
  const bb = g.boundingBox!, p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - bb.min.x) / (bb.max.x - bb.min.x), (p.getY(i) - bb.min.y) / (bb.max.y - bb.min.y));
  uv.needsUpdate = true;
  return g;
}

export function buildBuckshot(): BuckshotRig {
  const b = buildBase({
    skin: 0xe8b088, shirt: 0xc9a66b, pants: 0x3f4660, shoes: 0x5a3520, brow: 0x5b3a22, iris: 0x3a7bd5,
    nose: 'bulb', jawW: 1.18, chestW: 1.1, belly: 1.05,
    sweet: { eye: [1.12, 1.12], pupil: 1.35, browY: [0.06, 0.06], headZ: -0.08, headX: 0.02 },
    jerk: {
      lid: [0.52, 0.5], lidLo: [0.16, 0.16], lidTilt: [0.04, 0.04], browRot: [-0.05, 0.32], browY: [-0.02, 0.045], eye: [1, 1],
      pupil: 0.85, headX: -0.17, headZ: 0.06, jawRoll: 0.04, mouth: 'smirk',
    },
  });
  const k = b.kit, h = b.headInner;

  // Hat: wide curled brim + pinched crown + band.
  const hat = new THREE.Group();
  hat.position.set(0, 0.84, -0.02);
  hat.rotation.x = -0.12;
  h.add(hat);
  const felt = k.toon(0x6b4226);
  const brimPts = [[0.0, 0.0], [0.62, 0.0], [0.74, 0.09], [0.74, 0.12], [0.6, 0.04], [0.0, 0.04]].map(([x, y]) => new THREE.Vector2(x, y));
  const brim = k.mesh(new THREE.LatheGeometry(brimPts, 20).scale(1, 1, 0.82), felt);
  hat.add(brim);
  const crownPts = [[0.0, 0.0], [0.36, 0.0], [0.34, 0.2], [0.3, 0.33], [0.12, 0.3], [0.0, 0.25]].map(([x, y]) => new THREE.Vector2(x, y));
  const crown = k.mesh(new THREE.LatheGeometry(crownPts, 16).scale(1, 1, 0.85), felt);
  hat.add(crown);
  const hband = k.cyl(0.365, 0.365, 0.07, 0x2a1a10, 16, 0.01);
  hband.scale.z = 0.85;
  hband.position.y = 0.06;
  hat.add(hband);
  const hstar = k.mesh(new THREE.ExtrudeGeometry(starShape(0.07), { depth: 0.02, bevelEnabled: false }), 0xf5c542, 0.01);
  hstar.position.set(0, 0.18, 0.29);
  hstar.rotation.x = -0.15;
  hat.add(hstar);

  // Aviators: gold teardrop frames with opaque mirror lenses (dark sky top, hard horizon, silver bottom).
  const glasses = new THREE.Group();
  const G0 = new THREE.Vector3(0, 0.6, 0.43);
  glasses.position.copy(G0);
  h.add(glasses);
  const mirrorTex = k.canvas(16, 32, (g, w, hh) => {
    const gr = g.createLinearGradient(0, 0, 0, hh);
    gr.addColorStop(0, '#0a0f1e');
    gr.addColorStop(0.42, '#1e3058');
    gr.addColorStop(0.5, '#5a7cb0');
    gr.addColorStop(0.53, '#eef6ff');
    gr.addColorStop(0.6, '#9aa8bc');
    gr.addColorStop(1, '#e8eef6');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, hh);
    // Two diagonal glints across the dark half.
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.moveTo(9, 2), g.lineTo(13, 2), g.lineTo(6, 14), g.lineTo(3, 14);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.beginPath();
    g.moveTo(14, 4), g.lineTo(15.5, 4), g.lineTo(10, 14), g.lineTo(8.5, 14);
    g.fill();
  });
  const mirror = k.own(new THREE.MeshBasicMaterial({ map: mirrorTex }));
  const gold = k.toon(0xf0c040);
  for (const s of [1, -1]) {
    const lensG = new THREE.Group();
    lensG.position.set(s * 0.17, 0, 0);
    lensG.rotation.set(0, s * 0.26, 0);
    glasses.add(lensG);
    const frameShape = aviatorShape(s, 0.168, 0.128, 0.198);
    const frame = k.mesh(new THREE.ExtrudeGeometry(frameShape, { depth: 0.03, bevelEnabled: false, curveSegments: 1 }), gold, 0.014);
    frame.position.z = -0.035;
    lensG.add(frame);
    const lens = new THREE.Mesh(k.geo(boxUV(new THREE.ShapeGeometry(aviatorShape(s), 1))), mirror);
    lens.position.z = 0.0;
    lensG.add(lens);
    const arm = k.box(0.025, 0.03, 0.44, gold, 0.008);
    arm.position.set(s * 0.33, 0.06, -0.22);
    arm.rotation.y = s * 0.1;
    glasses.add(arm);
  }
  const bridgeTop = k.box(0.16, 0.028, 0.03, gold, 0.008);
  bridgeTop.position.set(0, 0.095, -0.0);
  glasses.add(bridgeTop);
  const bridge = k.box(0.08, 0.025, 0.03, gold, 0.008);
  bridge.position.set(0, 0.02, -0.0);
  glasses.add(bridge);

  // Push-broom moustache: one solid bar (no gap under it) + two end lobes; the smirk hikes one corner.
  const stacheM = k.toon(0x5b3a22);
  const stache = new THREE.Group();
  h.add(stache);
  const bar = k.ball(0.15, stacheM, 1.55, 0.6, 0.62, 12);
  bar.position.set(0, 0.325, 0.4);
  stache.add(bar);
  const lobes: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const piv = new THREE.Group();
    piv.position.set(s * 0.1, 0.33, 0.385);
    stache.add(piv);
    const lobe = k.ball(0.11, stacheM, 1.45, 0.62, 0.62, 10);
    lobe.position.set(s * 0.13, -0.01, 0);
    piv.add(lobe);
    lobes.push(piv);
  }

  // Toothpick: fat enough to read at 320x180. Pivot rides the jaw at a mouth corner; it snaps sides.
  const PICK_X = 0.16;
  const pickPivot = new THREE.Group();
  pickPivot.position.set(PICK_X, -0.11, 0.37);
  b.jawInner.add(pickPivot);
  const pickSpin = new THREE.Group();
  pickSpin.rotation.order = 'YZX';
  pickPivot.add(pickSpin);
  const pickMat = k.toon(0xf4dfa4);
  const pick = k.cyl(0.042, 0.022, 0.5, pickMat, 6, 0.014);
  pick.rotation.z = Math.PI / 2;
  pick.position.x = 0.2;
  pickSpin.add(pick);
  const pickTip = new THREE.Object3D();
  pickTip.position.x = 0.45;
  pickSpin.add(pickTip);
  // Smear ghosts for the flick.
  const smearMat = k.glow(0xfff2c8, 0.5);
  const ghosts: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const gg = new THREE.Group();
    gg.rotation.order = 'YZX';
    const gm = k.mesh(pick.geometry, smearMat, 0);
    gm.rotation.z = Math.PI / 2;
    gm.position.x = 0.2;
    gm.scale.set(1.6, 1, 1.6);
    gg.add(gm);
    gg.visible = false;
    pickPivot.add(gg);
    ghosts.push(gg);
  }

  // Badge, collar, belt + buckle, shirt pockets.
  const badge = k.mesh(new THREE.ExtrudeGeometry(starShape(0.11), { depth: 0.03, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1 }), 0xf5c542, 0.014);
  badge.position.set(0.15, 0.46, 0.25);
  badge.rotation.y = 0.45;
  b.torsoInner.add(badge);
  const pocket = k.box(0.14, 0.1, 0.03, 0xb08f58, 0.012);
  pocket.position.set(-0.15, 0.44, 0.255);
  pocket.rotation.y = -0.45;
  b.torsoInner.add(pocket);
  const belt = k.cyl(0.33, 0.33, 0.08, 0x3a2414, 16, 0.012);
  belt.scale.set(1.12, 1, 0.92);
  belt.position.y = 0.13;
  b.torsoInner.add(belt);
  const buckle = k.box(0.16, 0.1, 0.04, 0xf0c040, 0.012);
  buckle.position.set(0, 0.13, 0.32);
  b.torsoInner.add(buckle);
  for (const s of [-1, 1]) {
    const collar = k.box(0.16, 0.05, 0.12, 0xc9a66b, 0.012);
    collar.position.set(s * 0.1, 0.7, 0.13);
    collar.rotation.set(0.3, s * 0.5, s * -0.5);
    b.torsoInner.add(collar);
  }

  // Remember where the rendering camera is (finger guns aim at the lens wherever it is).
  let camKnown = false;
  const camW = new THREE.Vector3();
  badge.onBeforeRender = (_r, _s, camera) => {
    camera.getWorldPosition(camW);
    camKnown = true;
  };

  b.props.hat = hat;
  b.props.glasses = glasses;
  b.props.toothpick = pickPivot;
  b.props.toothpickTip = pickTip;
  b.props.moustache = stache;
  b.props.badge = badge;

  let flipPiv: THREE.Group | null = null;
  // Beat state.
  let manual = false;
  let shadesT = 0, shades = 0, pushW = 0, pushT = 0, shadesU = 1, shadesFrom = 0;
  const SLIDE = 0.2;
  let tipT = 0, tip = 0, gunT = 0, gun = 0;
  let pickSide = 1, flickU = 1, smear = 0;
  const FLICK = 0.06;
  const yawFor = (side: number) => (side > 0 ? -0.45 : -Math.PI + 0.45);
  let spin = 0;
  const _w = new THREE.Vector3(), _aim = new THREE.Vector3(), _sh = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

  const rig = finish(b, (c) => {
    const { t, dt, sig, face } = c;
    const bdt = c.bdt;
    // Deadpan: the jaw barely moves even when talking (gritted teeth round the toothpick).
    face.jaw = Math.min(face.jaw * 0.4, 0.14);
    // Smirk corner: hike the moustache lobe on the smirk side.
    const hikeL = face.mouth === 'smirk' || face.mouth === 'sneer' ? 1 : face.mouth === 'grin' || face.mouth === 'smile' ? 0.7 : 0.15;
    const hikeR = face.mouth === 'smirkR' || face.mouth === 'sneerR' ? 1 : face.mouth === 'grin' || face.mouth === 'smile' ? 0.7 : 0;
    // Heel turn posture: sweet = hat pushed back, upright; jerk = leaning back, belly out, chin up.
    const j = c.turn;
    if (c.turnOn) {
      b.torsoInner.rotation.x -= 0.2 * j;
      b.torsoInner.position.z -= 0.06 * j;
      b.head.position.z = -0.02 * j;
    }
    lobes[0].rotation.z = -0.3 + 0.42 * hikeL;
    lobes[0].position.y = 0.33 + 0.025 * hikeL;
    lobes[1].rotation.z = 0.3 - 0.42 * hikeR;
    lobes[1].position.y = 0.33 + 0.025 * hikeR;
    stache.rotation.z = 0.06 * (hikeL - hikeR);

    // --- Shades ---
    // A big jump in setShades = one fixed 0.2 s slide with the two-finger push riding along (hand up in the
    // first quarter, gone by the end). Small per-frame steps (a scene ramp) drive the shades directly and the
    // hand lets go within ~0.1 s of them stopping.
    if (shadesU < 1) {
      shadesU = Math.min(1, shadesU + bdt / SLIDE);
      const e = shadesU * shadesU * (3 - 2 * shadesU);
      shades = shadesFrom + (shadesT - shadesFrom) * e;
      pushW = shadesU < 0.25 ? shadesU / 0.25 : shadesU > 0.65 ? Math.max(0, (1 - shadesU) / 0.35) : 1;
    } else {
      if (Math.abs(shadesT - shades) > 1e-4) (shades = shadesT), (pushT = 0.08);
      else pushT = Math.max(0, pushT - bdt);
      pushW = pushT > 0 ? Math.min(1, pushW + bdt * 14) : Math.max(0, pushW - bdt * 14);
    }
    glasses.position.set(G0.x, G0.y - 0.27 * shades, G0.z + 0.08 * shades);
    glasses.rotation.set(0.32 * shades, 0, 0);
    const stare = shades * (c.turnOn ? c.turn : 1);
    if (stare > 0.01) {
      // Over-the-top stare: heavy smug lids, pupils up at the lens.
      // Deadpan over-the-top stare: heavy level lids, flat low brows, eyes straight down the lens.
      for (let i = 0; i < 2; i++) {
        if (face.lid[i] < 0.85) face.lid[i] += (0.4 - face.lid[i]) * stare;
        face.lidTilt[i] *= 1 - stare;
        face.browRot[i] *= 1 - 0.7 * stare;
        face.browY[i] += (-0.025 - face.browY[i]) * stare;
      }
      c.lookAdd.y += 0.1 * stare;
    }

    // --- Toothpick ---
    let yaw: number, px: number;
    if (flickU < 1) {
      flickU = Math.min(1, flickU + bdt / FLICK);
      smear = 1;
    } else smear = Math.max(0, smear - bdt / 0.12);
    const e = flickU * flickU * (3 - 2 * flickU);
    const from = yawFor(-pickSide), to = yawFor(pickSide);
    yaw = from + (to - from) * e;
    px = PICK_X * (-pickSide + 2 * pickSide * e);
    if (!manual) {
      // Legacy signature loop: twirl + periodic flick (kept for scenes that only call setSignature).
      spin += dt * sig * 16;
      const fl = sig * Math.max(0, Math.sin(t * 3.1)) ** 8;
      pickSpin.rotation.set(0, yawFor(pickSide) - 0.2 * Math.sin(t * 2.3) * (1 - sig), 0.2 + Math.sin(t * 1.7) * 0.08 + spin + fl * 1.2);
      pickPivot.position.set(PICK_X * pickSide, -0.11 + fl * 0.03, 0.37);
    } else {
      pickSpin.rotation.set(0, yaw, 0.22 + Math.sin(t * 1.7) * 0.05 * sig + 0.25 * smear * Math.sin(flickU * Math.PI));
      pickPivot.position.set(px, -0.11 + 0.02 * Math.sin(flickU * Math.PI), 0.37);
    }
    ghosts.forEach((g, i) => {
      g.visible = manual && smear > 0.02;
      g.rotation.set(0, from + (yaw - from) * ((i + 1) / 4), 0.22);
      g.position.set(0, 0, 0);
    });
    smearMat.opacity = 0.55 * smear;

    // --- Hat tip + finger guns ---
    tip = damp(tip, tipT, 20, bdt);
    gun = damp(gun, gunT, 20, bdt);
    let hatTip = tip;
    if (!manual) hatTip = sig * (0.5 + 0.5 * Math.sin(t * 2.2 - 1.2)) ** 2;
    const hatBack = c.turnOn ? 0.18 * (1 - j) - 0.06 * j : 0;
    hat.rotation.set(-0.12 + hatTip * 0.5 - hatBack, 0, hatTip * 0.1 + 0.05 * j);
    hat.position.set(0, 0.84 + hatTip * 0.05, -0.02 + hatTip * 0.06);
    face.headX += hatTip * 0.1;
    if (!manual) {
      b.armInnerR.rotation.set(-hatTip * 2.5, 0, -0.18 - hatTip * 0.25);
      b.elbowR.rotation.x = -0.25 - hatTip * 1.3;
    }
    if (sig > 0.3) face.browRot[0] -= 0.25 * sig, (face.browY[0] += 0.03 * sig);

    // Arms (after the face/hat pose so targets are current).
    b.root.updateMatrixWorld(true);
    if (gun > 0.001) {
      // Aim at the camera (last rendered), each arm splayed ~30 deg outward and a little up so they don't
      // foreshorten into the lens; falls back to straight out of his front (+Z).
      _aim.set(0, 0, 1);
      if (camKnown) {
        _w.copy(camW);
        b.torsoInner.worldToLocal(_w);
        _w.y -= 0.6;
        _w.y *= 0.5;
        if (_w.lengthSq() > 0.01) {
          // Clamp the aim to +-70 deg of his front so the arms never wrap behind him.
          const yaw = clamp(Math.atan2(_w.x, _w.z), -1.2, 1.2), h = Math.hypot(_w.x, _w.z);
          const pitch = clamp(Math.atan2(_w.y, h), -0.3, 0.25);
          _aim.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
        }
      }
      for (const s of [1, -1] as const) {
        _w.copy(_aim).applyAxisAngle(_up, s * 0.4);
        _w.multiplyScalar(0.8).add(_sh.set(s * 0.36, 0.68, 0));
        b.torsoInner.localToWorld(_w);
        reach(b, s, _w, gun, 0.1);
      }
      face.headZ += 0.08 * gun;
    }
    if (tip > 0.001 && manual) {
      _w.set(-0.5, -0.12, 0.36);
      hat.localToWorld(_w);
      reach(b, -1, _w, tip * (1 - gun), 1.3);
    }
    if (pushW > 0.01 && gun < 0.5) {
      _w.set(0, 0.03, 0.12);
      glasses.localToWorld(_w);
      _w.y -= 0.17;
      reach(b, 1, _w, pushW * (1 - gun), 1.2);
    }
    if (gun > 0.05) c.hand[0] = c.hand[1] = 'gun';
    else {
      if (tip > 0.05) c.hand[1] = 'grip';
      if (pushW > 0.05) c.hand[0] = 'flat';
    }
  });

  return Object.assign(rig, {
    flipShades(v: number) {
      if (!flipPiv) {
        const host = glasses.parent ?? h;
        flipPiv = new THREE.Group(); // pivots at the glasses' rest centre
        flipPiv.position.copy(G0);
        const off = new THREE.Group();
        off.position.copy(G0).negate();
        host.add(flipPiv);
        flipPiv.add(off);
        off.add(glasses);
        b.props.shadesHinge = flipPiv;
      }
      // Up: perched on the brim's front, lenses tipped to the sky, arms tucked back over the brim.
      // Down: over the eyes. In between they arc out in front of the face.
      const u = 1 - clamp(v, 0, 1);
      flipPiv.position.set(G0.x, G0.y + 0.34 * u, G0.z + 0.02 * u + 0.1 * Math.sin(Math.PI * u));
      flipPiv.rotation.set(-0.6 * u, 0, 0);
    },
    setShades(v: number) {
      manual = true;
      v = clamp(v, 0, 1);
      if (Math.abs(v - shadesT) > 0.2) (shadesFrom = shades), (shadesU = 0);
      shadesT = v;
    },
    flickPick() {
      manual = true;
      pickSide = -pickSide;
      flickU = 0;
    },
    tipHat(v: number) {
      manual = true;
      tipT = clamp(v, 0, 1);
    },
    fingerGuns(v: number) {
      manual = true;
      gunT = clamp(v, 0, 1);
    },
  });
}
