// Vice Versa Vera: a vain glam backwards-diva. A towering silver bouffant with a hot-pink swoop and 60s flip curls,
// mirrored pink cat-eye shades, purple-pink eyeshadow and big lashes, pink lipstick in a permanent smug pout, a
// beauty mark, pink hoop earrings, a sequined silver jacket with pink lapels and huge shoulder pads, and her hand
// mirror (props.mirror, in her left fist) that she cannot stop admiring herself in.
// Signature: the hair toss (the whole bouffant bounces and swishes, the head flicks, the sequins blaze).
// Extra controls:
//   setShades(k 0..1)    0 = pushed up on the bouffant, 1 = down over the eyes (mirrored lenses).
//   setAdmire(k 0..1)    gazing into the mirror: heavy dreamy lids, brows up, sparkly eyes, blush, head tilted, pout.
//   setKiss(k 0..1)      puckered lipstick kiss, cheeks sucked in, eyes shut.
//   setRaspberry(k 0..1) the "kiss" was a raspberry: tongue out and flapping between the lips, cheeks puffed,
//                        smug half-lids, brows up.
//   setEyeRoll(k 0..1)   ugh: pupils roll up under half lids, head tips back.
//   mirror               the HandMirror (vera_props.ts): setReflection('self' | 'monster'), setSnarl, setCrack, shatter.
// setTurn(1) (the jerk face, from frame 0): looking down her nose, one brow arched high, lids lazy, smug pout.
import * as THREE from 'three';
import { buildBase, finish, type CharacterRigX } from './character';
import { clamp, damp } from './kit';
import { shell, strand } from './parts';
import { buildHandMirror, type HandMirror } from './vera_props';

export interface VeraRig extends CharacterRigX {
  setShades(k: number): void;
  setAdmire(k: number): void;
  setKiss(k: number): void;
  setRaspberry(k: number): void;
  setEyeRoll(k: number): void;
  mirror: HandMirror;
}

const PINK = 0xff4fa3;
const LIPS = 0xff2f8f;

export function buildVera(): VeraRig {
  const b = buildBase({
    skin: 0xf8cdb6, shirt: 0xcdd2e0, sleeve: 0xcdd2e0, pants: PINK, shoes: PINK, brow: 0x6a3a64, iris: 0xff3aa8,
    lid: 0xb45ad8, nose: 'button', jawW: 0.88, chestW: 0.9, chestD: 0.95, headScale: 1.05, browScale: 1.05, blush: 0xff5aa0,
    jerk: {
      lid: [0.4, 0.46], lidLo: [0.16, 0.2], lidTilt: [0.05, 0.12], browRot: [-0.3, 0.32], browY: [0.04, -0.012], eye: [1.06, 1.0],
      pupil: 0.95, headX: -0.13, headZ: 0.1, jawRoll: 0.03, mouth: 'none', blush: 0.5, sparkle: 0,
    },
  });
  const k = b.kit, h = b.headInner;
  for (const e of b.ears) e.visible = false;
  const hairC = k.toon(0xe6e8f2, { side: THREE.DoubleSide, gloss: 0.7, shine: 60 });
  const hairShade = k.toon(0xc4c8da, { gloss: 0.5 });
  const pinkHair = k.toon(PINK, { side: THREE.DoubleSide, gloss: 0.7, shine: 60 });
  const pinkM = k.toon(PINK, { gloss: 0.8, shine: 70 });
  const silverM = k.toon(0xdfe3f0, { gloss: 1, shine: 90 });
  // the jacket's own material: chrome-glossy silver
  (b.chest.material as THREE.Material).userData.look && ((b.chest.material as THREE.Material).userData.look.uGloss.value = 1);

  // ---------- jacket: huge shoulder pads, pink lapels in a V over a pink top, sequins ----------
  for (const s of [-1, 1]) {
    const lap = k.box(0.12, 0.4, 0.035, pinkM, 0.012);
    lap.position.set(s * 0.1, 0.42, 0.26);
    lap.rotation.set(-0.3, s * 0.4, -s * 0.42);
    b.torsoInner.add(lap);
  }
  // a pearl choker
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const p = k.ball(0.028, 0xfff4fb, 1, 1, 1, 8, 0.008);
    p.position.set(Math.sin(a) * 0.125, 0.69, Math.cos(a) * 0.125);
    b.torsoInner.add(p);
  }
  for (const arm of [b.armInnerL, b.armInnerR]) {
    const pad = k.ball(0.17, b.chest.material as THREE.Material, 1.15, 0.7, 1.05, 16);
    pad.position.y = 0.06;
    arm.add(pad);
    const cuff = k.cyl(0.1, 0.1, 0.06, pinkM, 10, 0.01);
    cuff.position.y = -0.24;
    (arm.children.find((c) => c.position.y === -0.3) ?? arm).add(cuff);
  }
  // sequins on the front of the chest (twinkle in update)
  const seqMat = k.own(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const seqPink = k.own(new THREE.MeshBasicMaterial({ color: 0xffb8e0 }));
  const seqGeo = k.geo(new THREE.CircleGeometry(0.02, 6));
  const sequins: THREE.Mesh[] = [];
  {
    const cw = 0.9, cd = 0.95, R0 = 0.34;
    const C = new THREE.Vector3(0, 0.38, 0);
    for (let i = 0; i < 70; i++) {
      const a = -1.25 + 2.5 * ((i * 0.618) % 1);
      const el = -0.95 + 1.6 * ((i * 0.377 + 0.13) % 1);
      const n = new THREE.Vector3(Math.sin(a) * Math.cos(el), Math.sin(el), Math.cos(a) * Math.cos(el));
      if (Math.abs(n.x) < 0.3 && n.y > -0.1) continue; // leave the V (lapels + top) clear
      const p = new THREE.Vector3(n.x * R0 * cw, n.y * R0, n.z * R0 * 0.82 * cd).add(C);
      const m = new THREE.Mesh(seqGeo, i % 4 === 0 ? seqPink : seqMat);
      m.position.copy(p).addScaledVector(n, 0.006);
      m.lookAt(p.clone().addScaledVector(new THREE.Vector3(n.x / cw, n.y, n.z / (0.82 * cd)).normalize(), 1));
      b.torsoInner.add(m);
      sequins.push(m);
    }
  }

  // ---------- hair: towering silver bouffant, hot-pink swoop, flip curls ----------
  const hairG = new THREE.Group();
  hairG.position.y = 0.62; // pivot low in the skull so the toss swings the whole mass
  h.add(hairG);
  const H = (o: THREE.Object3D, x: number, y: number, z: number) => (o.position.set(x, y - 0.62, z), hairG.add(o), o);
  const cap = shell(b, 0.44, hairC, 0, Math.PI * 2, 0, 0.8, 1.06, 0.98, 0.97);
  cap.position.y = 0.5;
  cap.rotation.x = -0.3; // hairline swept back: the brows stay on skin
  h.add(cap);
  h.add(shell(b, 0.445, hairC, Math.PI - 0.5, Math.PI + 1.0, 0, 2.3, 1.07, 0.99, 0.98).translateY(0.5));
  H(k.ball(0.5, hairC, 1.12, 0.95, 1.0, 22), 0, 1.08, -0.3);
  H(k.ball(0.32, hairC, 1.1, 0.85, 0.9, 16), 0, 1.4, -0.26);
  // the hot-pink streak: a fat stripe rolling over the bouffant from the forehead to the back, and a front curl
  const streak = H(k.mesh(new THREE.TorusGeometry(0.47, 0.11, 10, 24, Math.PI * 1.1), pinkHair), 0.2, 1.08, -0.3);
  streak.rotation.set(0, Math.PI / 2, -0.25);
  streak.scale.set(1, 0.92, 1);
  const curl = H(k.mesh(new THREE.TorusGeometry(0.1, 0.06, 10, 16, Math.PI * 1.6), pinkHair), 0.3, 0.9, 0.24);
  curl.rotation.set(0, 0.5, -0.9);
  // side volume + flip curls (pink tips)
  const curls: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const side = H(k.ball(0.22, hairC, 0.85, 1.25, 1.0, 16), s * 0.43, 0.56, -0.08);
    side.rotation.z = s * 0.15;
    const flipP = new THREE.Group();
    H(flipP, s * 0.46, 0.34, -0.06);
    const flip = k.mesh(new THREE.TorusGeometry(0.11, 0.055, 8, 14, Math.PI * 1.3), hairC);
    flip.rotation.set(0, Math.PI / 2, s > 0 ? -0.2 : Math.PI + 0.2);
    flip.position.set(s * 0.04, 0, 0);
    flipP.add(flip);
    const tip = k.ball(0.06, pinkHair, 1, 1, 1, 10);
    tip.position.set(s * 0.12, 0.08, 0);
    flipP.add(tip);
    curls.push(flipP);
  }
  // back of the bouffant: a few springy flipped ends
  const ends = [-0.25, 0, 0.25].map((x, i) =>
    strand(b, hairG, { x, y: 0.4 - 0.62, z: -0.42 }, {
      n: 4, len: 0.12, r0: 0.11, r1: 0.07, color: i === 1 ? pinkHair : hairShade, rx: 0.5, rz: -x, curl: -0.35, stiffness: 70, damping: 6, lag: 0.5,
    }),
  );

  // ---------- face: eyeliner wings + lashes, beauty mark, lips ----------
  const liner = k.toon(0x1a0a18, { gloss: 0 });
  b.eyes.forEach((eye, i) => {
    const s = i === 0 ? 1 : -1;
    const w = k.box(0.1, 0.024, 0.02, liner, 0);
    w.position.set(s * 0.12, 0.075, 0.035);
    w.rotation.z = s * 0.5;
    eye.add(w);
    for (let n = 0; n < 4; n++) {
      const lash = k.box(0.06 - n * 0.008, 0.016, 0.012, liner, 0);
      lash.position.set(s * (0.06 + n * 0.028), 0.12 - n * 0.018, 0.03);
      lash.rotation.z = s * (0.6 + n * 0.28);
      eye.add(lash);
    }
  });
  const mole = k.ball(0.014, 0x3a1424, 1, 1, 0.5, 8, 0);
  mole.position.set(-0.2, 0.33, 0.33);
  h.add(mole);

  // Lips: a glossy pink smug pout decal (cupid's bow, fuller lower lip, right corner hiked) on the chin.
  const lipM = k.toon(LIPS, { gloss: 0.9, shine: 80 });
  const lipDark = k.toon(0x8a0a40);
  const lipHi = k.own(new THREE.MeshBasicMaterial({ color: 0xffd0ea }));
  const pout = new THREE.Group();
  {
    const n = 16, up: [number, number][] = [], lo: [number, number][] = [];
    const W = 0.125;
    const cornerY = (u: number) => 0.012 * u + 0.004; // u -1..1, right (+x... her left) corner a touch higher
    for (let i = 0; i <= n; i++) {
      const u = (i / n) * 2 - 1, x = u * W;
      const bow = 0.034 * Math.cos(u * Math.PI * 0.5) - 0.012 * Math.exp(-(u * u) / 0.02);
      up.push([x, cornerY(u) + bow * (1 - Math.abs(u) ** 3)]);
    }
    for (let i = n; i >= 0; i--) {
      const u = (i / n) * 2 - 1, x = u * W;
      lo.push([x, cornerY(u) - 0.058 * Math.sqrt(Math.max(0, 1 - u * u)) * (1 - 0.1 * u)]);
    }
    pout.add(b.chinDecal([...up, ...lo], lipM, 0.006, -0.06));
    // the parting line
    const line: [number, number][] = [], line2: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const u = (i / n) * 2 - 1;
      line.push([u * W * 0.96, cornerY(u) - 0.004 * (1 - u * u) + 0.0035]);
      line2.unshift([u * W * 0.96, cornerY(u) - 0.004 * (1 - u * u) - 0.0035]);
    }
    pout.add(b.chinDecal([...line, ...line2], lipDark, 0.01, -0.06));
    // gloss highlight on the lower lip
    pout.add(b.chinDecal([[-0.03, -0.02], [0.02, -0.018], [0.03, -0.026], [-0.02, -0.03]], lipHi, 0.012, -0.06));
  }
  b.jawInner.add(pout);
  // open-mouth lipstick rims (upper on the head, lower on the jaw)
  const upLip = k.ball(0.13, lipM, 1.0, 0.18, 0.4, 16, 0.01);
  upLip.position.set(0, 0.285, 0.36);
  h.add(upLip);
  const loLip = k.ball(0.12, lipM, 1.0, 0.2, 0.4, 16, 0.01);
  loLip.position.set(0, -0.045, 0.37);
  b.jawInner.add(loLip);
  // kiss pucker
  const pucker = new THREE.Group();
  pucker.position.set(0, -0.06, 0.44);
  b.jawInner.add(pucker);
  const pk = k.mesh(new THREE.TorusGeometry(0.042, 0.03, 10, 18), lipM, 0.012);
  pk.scale.set(1, 0.85, 1);
  pucker.add(pk);
  const pkHole = k.ball(0.022, 0x5a0420, 1, 0.8, 0.4, 10, 0);
  pkHole.position.z = 0.008;
  pucker.add(pkHole);
  // raspberry tongue
  const tongueP = new THREE.Group();
  tongueP.position.set(0, -0.07, 0.43);
  b.jawInner.add(tongueP);
  const tng = k.ball(0.07, 0xe85a80, 1.15, 1.3, 0.55, 16, 0.014);
  tng.position.set(0, -0.06, 0.02);
  tongueP.add(tng);
  const groove = k.box(0.006, 0.08, 0.006, 0xb83058, 0);
  groove.position.set(0, -0.06, 0.06);
  tongueP.add(groove);

  // hoop earrings, under the side curls
  const hoops: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const hp = new THREE.Group();
    hp.position.set(s * 0.4, 0.36, 0.02);
    h.add(hp);
    const ring = k.mesh(new THREE.TorusGeometry(0.075, 0.014, 8, 20), pinkM, 0.01);
    ring.position.y = -0.075;
    ring.rotation.y = Math.PI / 2;
    hp.add(ring);
    hoops.push(hp);
  }

  // ---------- mirrored cat-eye shades (pivot at the head centre: rotate up onto the bouffant) ----------
  const shadesP = new THREE.Group();
  shadesP.position.y = 0.5;
  h.add(shadesP);
  const shades = new THREE.Group();
  shades.position.set(0, 0.07, 0.47);
  shadesP.add(shades);
  const catEye = (s: number, sc = 1) => {
    const P: [number, number][] = [[-0.085, 0.02], [-0.07, -0.05], [0.0, -0.08], [0.09, -0.065], [0.14, -0.01], [0.19, 0.1], [0.1, 0.075], [0.0, 0.07], [-0.07, 0.055]];
    const sh = new THREE.Shape();
    const pts = P.map(([x, y]) => new THREE.Vector2(s * x * sc, y * sc));
    sh.setFromPoints(new THREE.SplineCurve([...pts, pts[0]]).getPoints(40));
    return sh;
  };
  const lensCv = k.canvas(32, 32, (g, w, hh) => {
    const gr = g.createLinearGradient(0, 0, 0, hh);
    gr.addColorStop(0, '#ff7ac0');
    gr.addColorStop(0.45, '#f0d8f4');
    gr.addColorStop(0.55, '#a8b0d8');
    gr.addColorStop(1, '#5a3a8a');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, hh);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath();
    g.moveTo(w * 0.15, hh);
    g.lineTo(w * 0.32, hh);
    g.lineTo(w * 0.72, 0);
    g.lineTo(w * 0.55, 0);
    g.fill();
  }, true);
  const lensMat = k.own(new THREE.MeshBasicMaterial({ map: lensCv }));
  for (const s of [1, -1]) {
    const lens = new THREE.Group();
    lens.position.set(s * 0.165, 0, s * 0 - 0.0);
    lens.rotation.y = s * 0.28;
    shades.add(lens);
    const fg = new THREE.ExtrudeGeometry(catEye(s, 1.25), { depth: 0.03, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 2, curveSegments: 6 });
    fg.translate(0, 0, -0.015);
    lens.add(k.mesh(fg, pinkM, 0.012));
    const lg = new THREE.ShapeGeometry(catEye(s, 1.05));
    lg.computeBoundingBox();
    const bb = lg.boundingBox!;
    const p = lg.attributes.position, uv = lg.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) - bb.min.x) / (bb.max.x - bb.min.x), (p.getY(i) - bb.min.y) / (bb.max.y - bb.min.y));
    const lm = new THREE.Mesh(k.geo(lg), lensMat);
    lm.position.z = 0.031;
    lens.add(lm);
    // rhinestone on the wing tip
    const gem = k.ball(0.022, 0xffffff, 1, 1, 0.6, 8, 0);
    gem.position.set(s * 0.21, 0.11, 0.03);
    lens.add(gem);
    // temple arm back to the hair
    const arm = k.box(0.02, 0.025, 0.36, pinkM, 0.008);
    arm.position.set(s * 0.25, 0.03, -0.2);
    arm.rotation.y = s * 0.12;
    lens.add(arm);
  }
  const bridge = k.box(0.08, 0.025, 0.025, pinkM, 0.01);
  bridge.position.set(0, 0.02, 0.05);
  shades.add(bridge);

  // ---------- the hand mirror in her left fist, glass facing her ----------
  const mirror = buildHandMirror();
  b.props.mirror = mirror.root;
  b.props.shades = shadesP;
  b.props.hair = hairG;
  b.props.pout = pout;

  let shT = 0, shK = 0, adT = 0, ad = 0, kiT = 0, ki = 0, raT = 0, ra = 0, erT = 0, er = 0;
  const rig = finish(b, (c) => {
    const { t, sig, face } = c;
    shK = damp(shK, shT, 22, c.bdt);
    ad = damp(ad, adT, 12, c.bdt);
    ki = damp(ki, kiT, 18, c.bdt);
    ra = damp(ra, raT, 18, c.bdt);
    er = damp(er, erT, 12, c.bdt);
    // jerk posture: chin up, a hip-cocked lean, shoulders back
    if (c.turnOn) {
      const j = c.turn;
      b.torsoInner.rotation.x -= 0.1 * j;
      b.torsoInner.rotation.z += -0.08 * j;
      c.lookAdd.y -= 0.15 * j; // looking down her nose
    }
    // shades: up on the bouffant -> down on the nose
    shadesP.rotation.x = -1.4 * (1 - shK);
    shadesP.position.z = -0.06 * (1 - shK);
    shadesP.position.y = 0.5 + 0.08 * (1 - shK);
    shades.position.y = 0.0 + 0.1 * (1 - shK);
    // hair toss
    const toss = sig;
    hairG.rotation.z = Math.sin(t * 7) * 0.14 * toss + 0.04;
    hairG.rotation.x = -Math.abs(Math.sin(t * 7)) * 0.08 * toss;
    hairG.scale.set(1 + 0.05 * toss * Math.sin(t * 14), 1 - 0.05 * toss * Math.sin(t * 14), 1);
    face.headZ += Math.sin(t * 7 + 0.6) * 0.12 * toss;
    face.headX += -0.06 * toss;
    for (const [i, cu] of curls.entries()) cu.rotation.z = (i ? 1 : -1) * (Math.sin(t * 9 + i) * 0.2 * (0.25 + toss));
    for (const [i, hp] of hoops.entries()) hp.rotation.x = Math.sin(t * 5 + i * 2) * (0.15 + 0.4 * toss);
    for (const e of ends) e.gust = 0.2 + toss * 0.8;
    // sequins twinkle (a few blaze at a time; all of them on the toss)
    sequins.forEach((m, i) => {
      const ph = Math.sin(t * (3 + (i % 5)) + i * 1.7);
      const on = ph > 0.86 - 0.5 * toss;
      m.scale.setScalar(on ? 1.6 : 0.85);
    });
    // admire: dreamy, besotted with herself
    if (ad > 0.01) {
      for (let i = 0; i < 2; i++) {
        face.lid[i] += (0.3 - face.lid[i]) * ad;
        face.lidLo[i] += (0.22 - face.lidLo[i]) * ad;
        face.lidTilt[i] += (0.18 - face.lidTilt[i]) * ad;
        face.browY[i] += (0.065 - face.browY[i]) * ad;
        face.browRot[i] += (-0.32 - face.browRot[i]) * ad;
        face.eye[i] += (1.08 - face.eye[i]) * ad;
      }
      face.pupil += (1.3 - face.pupil) * ad;
      face.sparkle += (1 - face.sparkle) * ad;
      face.blush += (1 - face.blush) * ad;
      face.headZ += 0.12 * ad;
    }
    if (er > 0.01) {
      for (let i = 0; i < 2; i++) {
        face.lid[i] += (0.5 - face.lid[i]) * er;
        face.lidLo[i] *= 1 - er;
        face.browY[i] += 0.03 * er;
      }
      face.headX -= 0.12 * er;
      face.headZ -= 0.08 * er;
      c.lookAdd.y += 1.4 * er;
      c.lookAdd.x += 0.3 * er;
    }
    if (ki > 0.01) {
      for (let i = 0; i < 2; i++) {
        face.lid[i] += (1 - face.lid[i]) * ki;
        face.browY[i] += (0.05 - face.browY[i]) * ki;
        face.browRot[i] += (-0.2 - face.browRot[i]) * ki;
      }
      face.jaw *= 1 - ki;
      face.headZ += 0.1 * ki;
      face.headX += 0.04 * ki;
    }
    if (ra > 0.01) {
      for (let i = 0; i < 2; i++) {
        face.lid[i] += (0.48 - face.lid[i]) * ra;
        face.lidLo[i] += (0.3 - face.lidLo[i]) * ra;
        face.browY[i] += ((i ? 0.03 : 0.07) - face.browY[i]) * ra;
        face.browRot[i] += ((i ? 0.2 : -0.35) - face.browRot[i]) * ra;
      }
      face.jaw = Math.max(face.jaw * (1 - ra), 0.05 * ra);
      face.headZ += Math.sin(t * 40) * 0.025 * ra;
      c.lookAdd.x -= 0.2 * ra;
    }
    // cheeks: sucked in for the kiss, puffed for the raspberry
    const cheekS = 1 - 0.25 * ki + 0.4 * ra + 0.06 * Math.sin(t * 38) * ra;
    for (const ch of b.cheeks) ch.scale.set(cheekS, 1 + 0.15 * ra, cheekS);
    // mouth: the lipstick pout replaces the stock decals; pucker / raspberry take over the closed mouth
    const open = face.jaw > 0.1;
    const kiss = ki > 0.5, rasp = ra > 0.3;
    if (!open) face.mouth = 'none';
    pout.visible = !open && !kiss;
    pucker.visible = kiss && !open;
    pucker.scale.setScalar(0.6 + 0.5 * clamp(ki * 1.4 - 0.4, 0, 1));
    tongueP.visible = rasp && !open && !kiss;
    tongueP.scale.set(1, 0.8 + 0.4 * ra + Math.sin(t * 46) * 0.12 * ra, 1);
    tongueP.rotation.x = 0.35 + Math.sin(t * 46) * 0.25 * ra;
    upLip.visible = open;
    loLip.visible = open;
    // the stock mouth would hide under these; tongue blob sits on the lips
  });
  // added after finish() so the rig's outline pass doesn't hull the mirror twice
  b.props.gripL.add(mirror.root);
  mirror.root.scale.setScalar(1.3);
  rig.setHandPose('L', 'grip');
  const baseDispose = rig.dispose.bind(rig);
  return Object.assign(rig, {
    mirror,
    setShades(v: number) {
      shT = clamp(v, 0, 1);
    },
    setAdmire(v: number) {
      adT = clamp(v, 0, 1);
    },
    setKiss(v: number) {
      kiT = clamp(v, 0, 1);
    },
    setRaspberry(v: number) {
      raT = clamp(v, 0, 1);
    },
    setEyeRoll(v: number) {
      erT = clamp(v, 0, 1);
    },
    dispose() {
      mirror.dispose();
      baseDispose();
    },
  });
}
