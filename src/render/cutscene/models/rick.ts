// Slick Rick Radial: a sleazy used-tire salesman. Fake orange tan, a shiny slicked-back black pompadour with a
// spit curl, pencil moustache, a loud green plaid sport coat with wide lapels over an open disco collar, gold
// chain with a little tire medallion, gold watch, cream slacks and white loafers. Gold tooth in a big
// salesman grin. Holds a can of TIRE SHINE (props.can, nozzle at props.nozzle) in the right hand.
// Jerk face from frame 0 (setTurn(1)): heavy-lidded smarmy eyes, one brow cocked, chin up, toothy grin.
// Signature: the hair slick: the left hand slides back over the pompadour, which gleams.
// Extra controls (all 0..1, smoothed on the beat clock):
//   setWink(k)   right eye shut, left brow up, cheek hiked: the "ayyy".
//   setPitch(k)  the sales pitch: mouth wide open on a huge grin, brows up, eyes wide, arms flung out.
//   setShake(k)  rattles the can (right forearm pumping).
//   setSpray(k)  presses the nozzle.
//   setGlint(k)  the gold tooth twinkle ("DING!"), props.tooth is its world anchor.
//   setTire(k)   shows the bald tire in the left fist (props.tire); setFlat(k) lets the air out of it.
import * as THREE from 'three';
import { buildBase, finish, reach, type CharacterRigX } from './character';
import { clamp, damp } from './kit';
import { shell } from './parts';
import { baldTire, sprayCan, twinkle } from './rick_props';

export interface RickRig extends CharacterRigX {
  setWink(k: number): void;
  setPitch(k: number): void;
  setShake(k: number): void;
  setSpray(k: number): void;
  setGlint(k: number): void;
  setTire(k: number): void;
  setFlat(k: number): void;
  /** Left arm raised forward presenting what's in the hand (the tire). */
  setPresent(k: number): void;
  /** Left-hand finger gun pointed past the camera (with the wink: "ayyy"). */
  setGun(k: number): void;
}

const COAT = 0x35b046;
const GOLD = 0xffc93a;

export function buildRick(): RickRig {
  const b = buildBase({
    skin: 0xf0985a, shirt: COAT, pants: 0xf2ead2, shoes: 0xf6f2ea, brow: 0x1a1218, iris: 0x2a9a46, lid: 0xd8834a,
    nose: 'sharp', jawW: 1.12, chestW: 1.08, browScale: 0.95, headScale: 1.02,
    jerk: {
      lid: [0.42, 0.4], lidLo: [0.24, 0.22], lidTilt: [-0.06, 0.02], browRot: [-0.28, 0.42], browY: [0.05, -0.012], eye: [1.02, 1.0],
      pupil: 0.95, headX: -0.1, headZ: 0.1, jawRoll: 0.03, mouth: 'grin',
    },
  });
  const k = b.kit, h = b.headInner;
  const gold = k.toon(GOLD, { gloss: 1, shine: 110, rim: 1.3 });
  const hairM = k.toon(0x1a1424, { gloss: 1, shine: 120, rim: 1.5, side: THREE.DoubleSide });
  const shineM = k.own(new THREE.MeshBasicMaterial({ color: 0xdff8ff, transparent: true, opacity: 0.85, depthWrite: false }));

  // ---- the loud plaid sport coat (chest + sleeves), dark-green lapels, an open disco collar ----
  const drawPlaid = (g: CanvasRenderingContext2D) => {
    g.fillStyle = '#35b046';
    g.fillRect(0, 0, 32, 32);
    g.fillStyle = 'rgba(20,90,40,0.55)';
    g.fillRect(0, 4, 32, 7);
    g.fillRect(4, 0, 7, 32);
    g.fillStyle = '#f4e04a';
    g.fillRect(0, 20, 32, 2);
    g.fillRect(20, 0, 2, 32);
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillRect(0, 27, 32, 1);
    g.fillRect(27, 0, 1, 32);
  };
  const plaidMat = (rx: number, ry: number) => {
    const tx = k.canvas(32, 32, drawPlaid);
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    tx.repeat.set(rx, ry);
    const m = k.toonUnique(0xffffff, { gloss: 0.35 });
    m.map = tx;
    return m;
  };
  const coatM = plaidMat(3, 2), sleeveM = plaidMat(1, 1);
  const coatPlain = k.toon(COAT);
  for (const [root, mat] of [[b.armL, sleeveM], [b.armR, sleeveM], [b.root, coatM]] as const)
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material === coatPlain) m.material = mat;
    });
  // Open shirt: a V of tanned chest (with a tuft of chest hair) and the chain on it.
  const vee = k.ball(0.2, b.skinMat, 0.55, 0.85, 0.32, 18, 0);
  vee.position.set(0, 0.5, 0.215);
  b.torsoInner.add(vee);
  const tuftM = k.toon(0x2a1a1a);
  for (const [x, y] of [[-0.03, 0.47], [0.02, 0.45], [0.0, 0.5], [0.035, 0.49], [-0.02, 0.42]]) {
    const t = k.ball(0.018, tuftM, 1, 1.3, 0.5, 8, 0);
    t.position.set(x, y, 0.272);
    b.torsoInner.add(t);
  }
  const lapelM = k.toon(0x145a22, { gloss: 0.6 });
  const collarM = k.toon(0xfffaf0, { gloss: 0.4, side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    // wide lapel down each side of the V
    const lap = k.box(0.15, 0.44, 0.05, lapelM, 0.016);
    lap.position.set(s * 0.14, 0.44, 0.26);
    lap.rotation.set(-0.32, s * 0.25, s * 0.38);
    b.torsoInner.add(lap);
    // the shirt's huge pointy disco collar flopped out over the lapel
    const col = new THREE.Mesh(k.geo(new THREE.ConeGeometry(0.1, 0.32, 3)), collarM);
    col.userData.outline = 0.012;
    col.scale.set(1, 1, 0.25);
    col.position.set(s * 0.19, 0.6, 0.27);
    col.rotation.set(-0.35, 0, s * 2.45);
    b.torsoInner.add(col);
  }
  // Coat buttons (gold) and a red pocket square.
  for (const y of [0.2, 0.08]) {
    const bt = k.cyl(0.026, 0.026, 0.02, gold, 10, 0.008);
    bt.rotation.x = Math.PI / 2 - 0.25;
    bt.position.set(0.02, y, 0.3 - (0.2 - y) * 0.15);
    b.torsoInner.add(bt);
  }
  const sq = k.box(0.08, 0.08, 0.02, 0xe8413c, 0.01);
  sq.rotation.set(-0.3, 0.25, Math.PI / 4);
  sq.position.set(0.2, 0.43, 0.26);
  b.torsoInner.add(sq);
  // Gold chain round the neck, hanging onto the chest V, with a little gold tire medallion.
  const chain = k.mesh(new THREE.TorusGeometry(0.15, 0.017, 6, 30), gold, 0.008);
  chain.scale.set(1, 1.05, 1);
  chain.position.set(0, 0.6, 0.1);
  chain.rotation.x = Math.PI / 2 - 0.62;
  b.torsoInner.add(chain);
  const med = k.mesh(new THREE.TorusGeometry(0.04, 0.017, 8, 16), gold, 0.008);
  med.position.set(0, 0.47, 0.28);
  med.rotation.x = -0.3;
  b.torsoInner.add(med);
  // Gold watch on the left wrist.
  const watch = k.mesh(new THREE.TorusGeometry(0.078, 0.022, 6, 16).rotateX(Math.PI / 2), gold, 0.008);
  watch.position.y = 0.045;
  b.handL.add(watch);
  const face = k.cyl(0.035, 0.035, 0.02, 0xf6f6f2, 12, 0.006);
  face.rotation.z = Math.PI / 2;
  face.position.set(0.085, 0.045, 0);
  b.handL.add(face);
  // White loafers get gold bits.
  b.legs.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.position.y < -0.5 && m.geometry.type === 'SphereGeometry') {
      const bit = k.box(0.08, 0.02, 0.02, gold, 0.006);
      bit.position.set(m.position.x, m.position.y + 0.07, m.position.z + 0.13);
      b.legs.add(bit);
    }
  });

  // ---- the hair: a glossy black slicked-back pompadour with a spit curl and a ducktail ----
  for (const e of b.ears) e.visible = false;
  h.add(shell(b, 0.445, hairM, 0, Math.PI * 2, 0, 0.78, 1.07, 0.99, 0.97).translateY(0.5));
  h.add(shell(b, 0.45, hairM, Math.PI - 0.5, Math.PI + 1.0, 0, 2.05, 1.07, 1.0, 0.99).translateY(0.5));
  const hair = new THREE.Group();
  h.add(hair);
  // the pompadour: a tall glossy mass swept up off the forehead into a big forward roll, slicked-back wings
  const pomp = k.ball(0.26, hairM, 1.6, 0.8, 1.4, 22, 0.018);
  pomp.position.set(0, 0.86, 0.02);
  pomp.rotation.x = -0.15;
  hair.add(pomp);
  const roll = k.ball(0.2, hairM, 2.0, 0.95, 1.3, 22, 0.018);
  roll.position.set(0.02, 0.98, 0.3);
  roll.rotation.set(-0.3, 0, -0.1);
  hair.add(roll);
  // the classic anime hair-shine band across the front of the roll
  for (const [y, w, len] of [[0.075, 0.03, 1.5], [0.02, 0.016, 0.9]] as const) {
    const g = new THREE.TorusGeometry(1, w, 4, 28, len);
    g.rotateZ(Math.PI / 2 - len / 2 + 0.15);
    g.rotateX(Math.PI / 2);
    g.scale(0.4 * Math.sqrt(1 - (y / 0.19) ** 2) + 0.012, 1, 0.26 * Math.sqrt(1 - (y / 0.19) ** 2) + 0.012);
    const m = new THREE.Mesh(k.geo(g), shineM);
    m.position.y = y;
    roll.add(m);
  }
  const crest = k.ball(0.12, hairM, 1.5, 0.9, 1.0, 16, 0.016);
  crest.position.set(0.1, 1.08, 0.47);
  crest.rotation.set(-0.6, 0, -0.1);
  hair.add(crest);
  for (const s of [-1, 1]) {
    const wing = k.ball(0.18, hairM, 0.55, 0.85, 1.65, 16, 0.016);
    wing.position.set(s * 0.37, 0.74, -0.02);
    wing.rotation.set(0.25, 0, s * -0.12);
    hair.add(wing);
  }
  // wet-look shine streaks combed back over the roll, the top and the wings
  const streaks: THREE.Mesh[] = [];
  const streak = (x: number, y: number, z: number, len: number, rx: number, ry = 0, rz = 0) => {
    const m = k.ball(1, shineM, 0.012, 0.012, len, 10, 0);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    hair.add(m);
    streaks.push(m);
  };
  streak(-0.14, 1.145, 0.3, 0.14, -0.5, 0, -0.1);
  streak(0.0, 1.16, 0.3, 0.16, -0.5, 0, -0.1);
  streak(0.14, 1.145, 0.3, 0.14, -0.5, 0, -0.1);
  streak(-0.1, 1.06, -0.02, 0.22, 0.15);
  streak(0.06, 1.07, -0.04, 0.22, 0.15);
  for (const s of [-1, 1]) streak(s * 0.465, 0.82, -0.02, 0.22, 0.25, 0, s * -0.12);
  // spit curl dangling on the forehead
  const curl = k.mesh(new THREE.TorusGeometry(0.04, 0.014, 6, 14, Math.PI * 1.6), hairM, 0.01);
  curl.position.set(-0.09, 0.79, 0.38);
  curl.rotation.set(-0.2, 0.2, 0.6);
  hair.add(curl);
  // ducktail at the back + sideburns
  for (const s of [-1, 1]) {
    const dt = k.mesh(new THREE.ConeGeometry(0.1, 0.3, 10), hairM, 0.014);
    dt.position.set(s * 0.09, 0.42, -0.42);
    dt.rotation.set(-2.2, 0, s * 0.35);
    hair.add(dt);
  }

  // ---- pencil moustache ----
  const stache = new THREE.Group();
  stache.position.set(0, 0.318, 0.425);
  h.add(stache);
  for (const s of [-1, 1]) {
    const m = k.ball(0.06, hairM, 1.25, 0.16, 0.45, 12, 0.008);
    m.position.set(s * 0.068, 0.004, -0.004);
    m.rotation.set(0, s * 0.35, s * 0.18);
    stache.add(m);
  }

  // ---- the gold tooth (on the grin decal and on the real upper teeth) + its twinkle ----
  const toothGold = k.toonUnique(GOLD, { gloss: 1, shine: 110, rim: 1.3 });
  const goldTooth = b.chinDecal([[0.05, 0.033], [0.084, 0.033], [0.08, -0.018], [0.054, -0.018]], toothGold, 0.011, -0.11);
  b.jawInner.add(goldTooth);
  const capT = k.ball(0.032, toothGold, 1, 1.15, 0.6, 12, 0);
  capT.position.set(0.06, 0.25, 0.33);
  h.add(capT);
  const tooth = new THREE.Object3D();
  tooth.position.set(0.067, -0.1, 0.5);
  b.jawInner.add(tooth);
  const star = twinkle(k);
  tooth.add(star);
  const star2 = twinkle(k, 0xffe9a0);
  star2.rotation.z = Math.PI / 4;
  tooth.add(star2);
  // hair gleam twinkle (signature)
  const hairStar = twinkle(k);
  hairStar.position.set(0.12, 0.98, 0.3);
  h.add(hairStar);

  // ---- props in hand ----
  const can = sprayCan(k);
  can.root.position.set(0, 0.02, 0);
  b.props.gripR.add(can.root);
  const tire = baldTire(k);
  tire.root.rotation.set(0, 0.9, 0);
  tire.root.scale.setScalar(1.15);
  b.props.gripL.add(tire.root);
  tire.root.visible = false;

  b.props.can = can.root;
  b.props.nozzle = can.nozzle;
  b.props.tooth = tooth;
  b.props.tire = tire.root;
  b.props.tireTag = tire.tag;
  b.props.hair = hair;
  b.props.stache = stache;

  const T = { wink: 0, pitch: 0, shake: 0, spray: 0, glint: 0, tire: 0, flat: 0, present: 0, gun: 0 };
  const C = { wink: 0, pitch: 0, shake: 0, spray: 0, glint: 0, tire: 0, flat: 0, present: 0, gun: 0 };
  const _w = new THREE.Vector3();
  const rig = finish(b, (c) => {
    const { t, face, sig } = c;
    const bdt = c.bdt;
    C.wink = damp(C.wink, T.wink, 22, bdt);
    C.pitch = damp(C.pitch, T.pitch, 14, bdt);
    C.shake = damp(C.shake, T.shake, 16, bdt);
    C.spray = damp(C.spray, T.spray, 30, bdt);
    C.glint = damp(C.glint, T.glint, 26, bdt);
    C.flat = damp(C.flat, T.flat, 6, bdt);
    C.tire = T.tire;
    C.present = damp(C.present, T.present, 14, bdt);
    C.gun = damp(C.gun, T.gun, 16, bdt);
    const pr = C.present;
    if (pr > 0.005) {
      b.armInnerL.rotation.x += -1.45 * pr;
      b.armInnerL.rotation.z += 0.15 * pr;
      b.elbowL.rotation.x += -0.35 * pr;
    }
    const gn = C.gun;
    if (gn > 0.005) {
      b.armInnerL.rotation.x += -1.25 * gn;
      b.armInnerL.rotation.z += 0.55 * gn;
      b.elbowL.rotation.x += -0.55 * gn;
      if (gn > 0.4) c.hand[0] = 'gun';
    }
    // smarm: the head bobs a little to its own sleazy groove
    face.headZ += Math.sin(t * 2.1) * 0.03;
    // gold tooth shows with the closed grin
    goldTooth.visible = face.mouth === 'grin' && face.jaw <= 0.1;

    // Pitch: "HAVE I GOT A DEAL FOR YOU!" mouth wide, brows up, eyes wide, arms flung out with open hands.
    const p = C.pitch;
    if (p > 0.005) {
      face.jaw = Math.max(face.jaw, 0.36 * p + Math.abs(Math.sin(t * 13)) * 0.08 * p);
      for (let i = 0; i < 2; i++) {
        // a used-car-salesman beam: brows hiked, eyes crinkled up on the cheeks
        face.lid[i] += (0.3 - face.lid[i]) * p;
        face.lidLo[i] += (0.42 - face.lidLo[i]) * p;
        face.lidTilt[i] += (0.15 - face.lidTilt[i]) * p;
        face.browY[i] += (0.075 - face.browY[i]) * p;
        face.browRot[i] += (-0.35 - face.browRot[i]) * p;
        face.eye[i] += (1.08 - face.eye[i]) * p;
      }
      face.pupil += (1.1 - face.pupil) * p;
      face.sparkle = Math.max(face.sparkle, 0.8 * p);
      face.headX += -0.06 * p;
      b.torsoInner.rotation.x -= 0.08 * p;
      b.armInnerL.rotation.z += 1.1 * p;
      b.armInnerR.rotation.z -= 1.1 * p;
      b.armInnerL.rotation.x += -0.4 * p;
      b.armInnerR.rotation.x += -0.4 * p;
      b.elbowL.rotation.x += -0.5 * p;
      b.elbowR.rotation.x += -0.5 * p;
      if (p > 0.5) c.hand[0] = 'wave';
    }
    // Wink: right eye shut, left brow up, cheek hiked, head tipped into it.
    const w = C.wink;
    if (w > 0.005) {
      face.lid[1] += (1 - face.lid[1]) * w;
      face.lidLo[1] += (0.4 - face.lidLo[1]) * w;
      face.browY[1] += (-0.03 - face.browY[1]) * w;
      face.browRot[1] += (0.5 - face.browRot[1]) * w;
      face.browY[0] += (0.07 - face.browY[0]) * w;
      face.browRot[0] += (-0.35 - face.browRot[0]) * w;
      face.lid[0] += (0.12 - face.lid[0]) * w;
      face.headZ += -0.16 * w;
      face.jawRoll += -0.05 * w;
      b.cheeks[1].position.y = 0.415 + 0.04 * w;
    } else b.cheeks[1].position.y = 0.415;
    // Signature: the hair slick: left palm slides back over the side of the pompadour, gleam follows the hand.
    const slick = sig;
    if (slick > 0.01) {
      const ph = (t * 1.3) % 1;
      const slide = ph < 0.7 ? ph / 0.7 : 1 - (ph - 0.7) / 0.3;
      _w.set(0.36, 0.86, 0.28 - 0.55 * slide);
      b.headInner.localToWorld(_w);
      reach(b, 1, _w, slick, 1.6);
      c.hand[0] = 'flat';
      face.headX += -0.06 * slick;
      face.lid[0] += (0.5 - face.lid[0]) * slick * 0.5;
      hairStar.position.set(0.3, 0.95, 0.3 - 0.5 * slide);
    }
    hairStar.visible = slick > 0.05;
    hairStar.scale.setScalar(0.09 * slick * (0.7 + 0.5 * Math.abs(Math.sin(t * 9))));
    hairStar.rotation.z = t * 2;
    // Shake the can: the right forearm pumps, the can rattles.
    const sh = C.shake;
    if (sh > 0.005) {
      b.elbowR.rotation.x += -0.6 * sh + Math.sin(t * 34) * 0.45 * sh;
      b.armInnerR.rotation.x += -0.25 * sh;
    }
    c.hand[1] = 'grip';
    can.setPress(C.spray);
    // Tooth twinkle.
    const g = C.glint;
    star.visible = star2.visible = g > 0.02;
    star.scale.setScalar(0.16 * g);
    star2.scale.setScalar(0.09 * g);
    star.rotation.z = t * 3;
    star2.rotation.z = Math.PI / 4 - t * 2;
    toothGold.emissive.setRGB(0.6 * g, 0.45 * g, 0.08 * g);
    // The bald tire in the left fist.
    const inHand = tire.root.parent === b.props.gripL;
    if (inHand) tire.root.visible = C.tire > 0.5;
    else tire.update(t);
    if (inHand && C.tire > 0.5) {
      c.hand[0] = 'grip';
      tire.update(t);
      tire.setFlat(C.flat);
    }
    for (const s of streaks) (s.material as THREE.MeshBasicMaterial).opacity = 0.7 + 0.25 * Math.sin(t * 3);
  });
  return Object.assign(rig, {
    setWink(v: number) {
      T.wink = clamp(v, 0, 1);
    },
    setPitch(v: number) {
      T.pitch = clamp(v, 0, 1);
    },
    setShake(v: number) {
      T.shake = clamp(v, 0, 1);
    },
    setSpray(v: number) {
      T.spray = clamp(v, 0, 1);
    },
    setGlint(v: number) {
      T.glint = clamp(v, 0, 1);
    },
    setTire(v: number) {
      T.tire = clamp(v, 0, 1);
    },
    setFlat(v: number) {
      T.flat = clamp(v, 0, 1);
    },
    setPresent(v: number) {
      T.present = clamp(v, 0, 1);
    },
    setGun(v: number) {
      T.gun = clamp(v, 0, 1);
    },
  });
}
