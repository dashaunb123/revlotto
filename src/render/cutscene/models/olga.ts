// Oilslick Olga: gleeful chaos gremlin. Oily black overalls, cyan goggles up top, a wild braid, grease
// smudges, a huge grin. Signature: the cackle (shoulders bounce, head thrown back, jaw flapping).
// Extra controls:
//   setCackle(k 0..1, {eyes?: 'keep' | 'shut'})
//                       the laugh: jaw flaps k*(0.55+0.4|sin(22t)|), head back, shoulders bounce. Once called,
//                       setSignature no longer drives the cackle. eyes 'shut' squeezes them "^ ^" above k 0.4;
//                       eyes 'keep' holds the squinty sly gremlin eyes (and cocked brow) at any strength, with
//                       the cheeks pushing the lower lids up and the head bobbing. Default: 'keep' while
//                       setTurn >= 0.5, else 'shut'.
//   setInnocent(k 0..1) "oops": hands clasped under the chin, huge sweet eyes, brows up, head tilted.
//   setGoggles(k 0..1)  0 = goggles up on the forehead, 1 = snapped down over the eyes (props.goggles
//                       now pivots at the head centre, so rotating its x forward also brings them down).
//   setTurn(k)          sweet: huge sparkly green eyes, freckles + rosy cheeks, a happy closed smile.
//                       jerk: a mischievous little gremlin: squinty eyes, one brow cocked, scrunched nose,
//                       toothy grin with the tongue poked out of the corner, hunched and tilted.
import * as THREE from 'three';
import { buildBase, finish, reach, type CharacterRigX } from './character';
import { clamp, damp } from './kit';
import { band, goggles, shell, strand } from './parts';

export interface OlgaRig extends CharacterRigX {
  setCackle(k: number, opts?: { eyes?: 'keep' | 'shut' }): void;
  setInnocent(k: number): void;
  setGoggles(k: number): void;
}

export function buildOlga(): OlgaRig {
  const b = buildBase({
    skin: 0xf3c29c, shirt: 0x26262e, sleeve: 0xe9e2d0, pants: 0x26262e, shoes: 0x4a3020, brow: 0xa83a10, iris: 0x3fcf5a,
    nose: 'button', jawW: 1.15, chestW: 0.95, headScale: 1.04, browScale: 1.15,
    sweet: { eye: [1.2, 1.2], pupil: 1.42, browY: [0.06, 0.06], headZ: 0.12 },
    jerk: {
      lid: [0.4, 0.36], lidLo: [0.5, 0.46], lidTilt: [-0.32, -0.22], browRot: [0.6, 0.38], browY: [-0.035, 0.025], eye: [0.94, 0.98],
      pupil: 1.0, headX: -0.06, headZ: 0.16, jawRoll: -0.04, mouth: 'grin',
    },
  });
  const k = b.kit, h = b.headInner;
  for (const e of b.ears) e.visible = false;
  const hair = k.toon(0xf07a22, { side: THREE.DoubleSide });
  const oil = k.toon(0x3b3f5c);
  const smudge = k.toon(0x5c4650);

  // Overalls: bib, straps, cyan buttons, oil blotches, wrench pocket.
  const bib = k.box(0.42, 0.34, 0.08, 0x26262e, 0.016);
  bib.position.set(0, 0.36, 0.25);
  b.torsoInner.add(bib);
  for (const s of [-1, 1]) {
    const strap = k.box(0.08, 0.42, 0.05, 0x26262e, 0.012);
    strap.position.set(s * 0.16, 0.52, 0.18);
    strap.rotation.set(-0.5, 0, s * 0.12);
    b.torsoInner.add(strap);
    const btn = k.cyl(0.035, 0.035, 0.03, 0x38e0e0, 8, 0.01);
    btn.rotation.x = Math.PI / 2;
    btn.position.set(s * 0.15, 0.5, 0.3);
    b.torsoInner.add(btn);
  }
  for (const [x, y, z, r] of [[0.12, 0.3, 0.3, 0.07], [-0.1, 0.42, 0.3, 0.05], [0.24, 0.05, 0.22, 0.08], [-0.2, 0.0, 0.24, 0.06]]) {
    const blot = k.ball(r, oil, 1.4, 1, 0.3, 8, 0);
    blot.position.set(x, y, z);
    b.torsoInner.add(blot);
  }
  const wrench = k.box(0.05, 0.3, 0.04, 0xc9ced8, 0.012);
  wrench.position.set(-0.3, 0.05, 0.12);
  wrench.rotation.z = 0.25;
  b.torsoInner.add(wrench);

  // Wild hair: cap, spiky tufts, and the big braid.
  h.add(shell(b, 0.44, hair, 0, Math.PI * 2, 0, 0.72, 1.07, 0.98, 0.97).translateY(0.5));
  h.add(shell(b, 0.445, hair, Math.PI - 0.45, Math.PI + 0.9, 0, 2.25, 1.07, 0.99, 0.98).translateY(0.5));
  // Wild hair: long spiky tufts all over (base sits inside the hair cap, tip sticks way out).
  const tufts: [number, number, number, number, number][] = [
    [0.3, 0.82, 0.05, -0.9, 0.3], [-0.32, 0.8, 0.0, 0.95, -0.2], [0.05, 0.94, -0.05, 0.15, 0.3], [-0.15, 0.9, 0.18, 0.4, 0.6],
    [0.2, 0.9, 0.2, -0.4, 0.5], [0.42, 0.6, -0.1, -1.5, 0], [-0.43, 0.62, -0.08, 1.5, 0],
    [0.38, 0.75, -0.2, -1.1, -0.4], [-0.38, 0.74, -0.2, 1.15, -0.4], [0.0, 0.92, -0.25, -0.1, -0.6], [0.22, 0.88, -0.28, -0.6, -0.7],
    [-0.22, 0.86, -0.3, 0.6, -0.7], [0.44, 0.5, 0.05, -1.8, 0.2], [-0.45, 0.5, 0.04, 1.8, 0.2], [-0.05, 0.96, 0.1, -0.3, 0.45],
  ];
  tufts.forEach(([x, y, z, rz, rx], i) => {
    const len = 0.5 + (i % 3) * 0.08;
    const t = k.cyl(0.0, 0.11, len, hair, 6);
    t.geometry.translate(0, len / 2 - 0.08, 0);
    t.position.set(x * 0.92, y * 0.95 + 0.02, z * 0.92);
    t.rotation.set(rx, 0, rz);
    h.add(t);
  });
  const braid = strand(b, h, { x: 0.05, y: 0.62, z: -0.4 }, {
    n: 7, len: 0.15, r0: 0.11, r1: 0.08, color: hair, rx: 0.9, rz: -0.15, curl: -0.12, stiffness: 60, damping: 5, lag: 0.6,
  });
  const tie = k.cyl(0.07, 0.07, 0.06, 0x38e0e0, 8, 0.01);
  tie.position.y = -0.15;
  braid.joints[braid.joints.length - 1].add(tie);
  const tip = k.cyl(0.11, 0.0, 0.16, hair, 6);
  tip.rotation.x = Math.PI;
  tip.position.y = -0.24;
  braid.joints[braid.joints.length - 1].add(tip);

  // Goggles pushed up onto the forehead; the group pivots at the head centre so they can snap down.
  const gog = new THREE.Group();
  gog.position.y = 0.5;
  h.add(gog);
  const strapG = new THREE.Group();
  gog.add(strapG);
  strapG.add(band(b, 0.74 - 0.5, 0x2a2420, 0.08, 0.475, -0.3));
  const lenses = goggles(b, 0x38e0e0, 0xc9ced8, 0x2a2420, true);
  lenses.position.set(0, 0.9 - 0.5, 0.3);
  lenses.rotation.x = -0.9;
  gog.add(lenses);

  // Grease smudges on the cheeks and a freckle splat.
  for (const [x, y, z, sx] of [[-0.3, 0.68, 0.29, 1.6], [0.33, 0.27, 0.24, 1.3]]) {
    const s = k.ball(0.035, smudge, sx, 0.55, 0.25, 8, 0);
    s.position.set(x, y, z);
    s.rotation.y = x > 0 ? 0.75 : -0.65;
    h.add(s);
  }
  // Freckles across the cheeks and nose bridge.
  const freckle = k.toon(0xc77a4e);
  const frGeo = k.geo(new THREE.CircleGeometry(0.011, 8));
  b.cheeks.forEach((ch, i) => {
    const s = i === 0 ? 1 : -1;
    for (const [x, y] of [[-0.03, 0.06], [0.01, 0.075], [0.045, 0.05], [-0.005, 0.035]]) {
      const fm = new THREE.Mesh(frGeo, freckle);
      const nx = s * x, nz = Math.sqrt(Math.max(0.01, 1 - (x / 0.132) ** 2 - (y / 0.102) ** 2)) * 0.09 + 0.004;
      fm.position.set(nx, y * 0.5, nz);
      fm.rotation.y = s * 0.45;
      ch.add(fm);
    }
  });
  // Scrunched-nose wrinkles (jerk): two little arcs on the bridge.
  const wrinkles = new THREE.Group();
  for (const [y, w] of [[0.475, 0.045], [0.5, 0.035]]) {
    const wr = k.mesh(new THREE.TorusGeometry(w, 0.006, 4, 10, Math.PI * 0.8), k.toon(0x9a5a3c), 0);
    wr.position.set(0, y, 0.405);
    wr.rotation.set(-0.3, 0, Math.PI * 0.1);
    wrinkles.add(wr);
  }
  h.add(wrinkles);
  // Tongue poking out of the grin's corner (jerk): a pink blob with a centre groove, riding the jaw.
  const tongueP = new THREE.Group();
  tongueP.position.set(0.085, -0.19, 0.4);
  tongueP.rotation.set(0.9, 0, -0.35);
  b.jawInner.add(tongueP);
  const tng = k.ball(0.062, 0xe85a70, 1.0, 1.25, 0.5, 16, 0.014);
  tng.position.set(0, -0.045, 0.0);
  tongueP.add(tng);
  const groove = k.box(0.006, 0.07, 0.006, 0xb83048, 0);
  groove.position.set(0, -0.05, 0.03);
  tongueP.add(groove);

  b.props.goggles = gog;
  b.props.braid = braid.joints[0];

  let cackleEyes: 'keep' | 'shut' | 'auto' = 'auto';
  let manual = false, cackleT = 0, cackle = 0, innocentT = 0, innocent = 0, gogT = 0, gogK = 0;
  const _w = new THREE.Vector3();
  const rig = finish(b, (c) => {
    const { t, sig, face, dt } = c;
    // Heel turn: gremlin hunch + scrunched nose + tongue poke.
    const j = c.turn;
    const gremlin = c.turnOn && j >= 0.5;
    tongueP.visible = gremlin && face.jaw < 0.12;
    wrinkles.visible = c.turnOn && j > 0.3;
    b.nose.scale.set(1 + 0.18 * j, 1 - 0.2 * j, 1);
    b.nose.position.y = 0.4 + 0.02 * j;
    for (const ch of b.cheeks) ch.position.y = 0.415 + 0.025 * j;
    if (c.turnOn) {
      b.torsoInner.rotation.x += 0.08 * j;
      b.torsoInner.rotation.z += -0.06 * j;
      b.armInnerL.rotation.z += 0.15 * j;
      b.armInnerR.rotation.z -= 0.15 * j;
      face.headZ += Math.sin(t * 2.2) * 0.03 * j;
      c.lookAdd.x += 0.45 * j; // sly sideways glance
    }
    braid.gust = 0.15 + sig * 0.6;
    cackle = damp(cackle, manual ? cackleT : sig, 14, manual ? c.bdt : dt);
    innocent = damp(innocent, innocentT, 14, c.bdt);
    gogK = damp(gogK, gogT, 30, c.bdt);
    gog.rotation.x = 0.62 * gogK;
    gog.position.z = 0.03 * gogK;
    strapG.rotation.x = -0.42 * gogK; // the strap stays up round the skull
    const ck = cackle * (1 - innocent);
    if (ck > 0.01) {
      // Cackle: shoulders bounce, head back, jaw going like a jackhammer, eyes squeezed shut "^ ^".
      const keep = cackleEyes === 'keep' || (cackleEyes === 'auto' && c.turnOn && j >= 0.5);
      const hop = Math.abs(Math.sin(t * 11)) * ck;
      b.torsoInner.position.y = hop * 0.07;
      b.torsoInner.rotation.x = -0.1 * ck;
      b.armInnerL.rotation.set(-0.5 * ck, 0, 0.18 + hop * 0.6 + 0.5 * ck);
      b.armInnerR.rotation.set(-0.5 * ck, 0, -0.18 - hop * 0.6 - 0.5 * ck);
      b.elbowL.rotation.x = -0.25 - 1.4 * ck;
      b.elbowR.rotation.x = -0.25 - 1.4 * ck;
      face.jaw = Math.max(face.jaw, ck * (0.55 + 0.4 * Math.abs(Math.sin(t * 22))));
      if (keep) {
        // Gremlin cackle: the sly squint stays (cheeks shove the lower lids up), the cocked brow bounces,
        // and the head bobs on the laugh instead of tipping right back (the eyes stay on the camera).
        face.headX += -0.04 * ck + Math.sin(t * 11) * 0.06 * ck;
        face.headZ += Math.sin(t * 5.5) * 0.12 * ck;
        for (let i = 0; i < 2; i++) {
          // A readable slit (upper + lower lid well short of meeting), never the shut "^ ^".
          face.lid[i] += (0.4 + 0.03 * hop - face.lid[i]) * ck;
          face.lidLo[i] += (0.44 - face.lidLo[i]) * ck;
          face.eye[i] += (1.0 - face.eye[i]) * ck;
          face.browY[i] += (0.012 + 0.025 * hop) * ck;
        }
        face.pupil += (1.1 - face.pupil) * ck;
      } else {
        face.headX += -0.3 * ck + Math.sin(t * 11) * 0.05 * ck;
        face.headZ += Math.sin(t * 5.5) * 0.1 * ck;
        if (ck > 0.4) face.lid = [1, 1];
        face.lidTilt = [0, 0];
        face.browY = [face.browY[0] + 0.06 * ck, face.browY[1] + 0.06 * ck];
        face.browRot = [-0.45 * ck, -0.45 * ck];
      }
    }
    if (innocent > 0.01) {
      // "Oops": huge sweet eyes, brows up, small closed mouth, head tilt, hands clasped under the chin.
      const n = innocent;
      for (let i = 0; i < 2; i++) {
        face.lid[i] += (0 - face.lid[i]) * n;
        face.lidTilt[i] += (0.15 - face.lidTilt[i]) * n;
        face.eye[i] += (1.3 - face.eye[i]) * n;
        face.browY[i] += (0.07 - face.browY[i]) * n;
        face.browRot[i] += (-0.4 - face.browRot[i]) * n;
      }
      face.pupil += (1.45 - face.pupil) * n;
      face.jaw *= 1 - n;
      face.headZ += 0.2 * n;
      face.headX += 0.06 * n;
      if (n > 0.5) face.mouth = 'line';
      c.lookAdd.y += 0.25 * n;
      b.root.updateMatrixWorld(true);
      for (const s of [1, -1] as const) {
        _w.set(s * 0.06, 0.66, 0.42);
        b.torsoInner.localToWorld(_w);
        reach(b, s, _w, n, 1.4);
      }
    }
  });
  return Object.assign(rig, {
    setCackle(v: number, opts?: { eyes?: 'keep' | 'shut' }) {
      manual = true;
      if (opts?.eyes) cackleEyes = opts.eyes;
      cackleT = clamp(v, 0, 1);
    },
    setInnocent(v: number) {
      innocentT = clamp(v, 0, 1);
    },
    setGoggles(v: number) {
      gogT = clamp(v, 0, 1);
    },
  });
}
