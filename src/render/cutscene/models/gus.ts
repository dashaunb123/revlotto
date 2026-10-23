// Gale Force Gus: bombastic storm of a man. Enormous segmented white beard, leather aviator cap with
// goggles, long scarf, barrel chest. Signature: hurricane - beard and scarf whip, he bellows.
// setBellow(k 0..1): the face alone - jaw ~0.9 open, moustache lifted up and out over a huge dark mouth,
// brows angry-down, small pupils. Once called, setSignature only drives the storm (wind + arms).
// setInhale(k 0..1): the deep breath before the bellow. Chest and belly balloon hugely (forward, out and up),
// the shoulders ride out on the swollen chest (the arms themselves never inflate), the head lifts on top,
// cheeks puff out, eyes bulge with tiny pupils, mouth clamped shut. Instant (scenes ramp it).
// setTurn(k): sweet = jolly grandpa (smiling crinkled eyes with a twinkle, big rosy cheeks, soft brows, a gentle
// sway). Jerk = red-faced bluster: the face flushes red, eyes bulge with pinprick pupils, bushy brows slam down,
// a popping anger vein, puffed cheeks, teeth bared through the moustache, chest puffed out and leaning in.
import * as THREE from 'three';
import { buildBase, finish, type CharacterRigX } from './character';
import { clamp, damp } from './kit';
import type { Chain } from './chain';
import { band, goggles, shell, strand } from './parts';

export interface GusRig extends CharacterRigX {
  setBellow(k: number): void;
  setInhale(k: number): void;
}

export function buildGus(): GusRig {
  const b = buildBase({
    skin: 0xf0a890, shirt: 0x7a4626, pants: 0x8a7a50, shoes: 0x22201e, hands: 0x4a2e1a, brow: 0xf6f6f6, iris: 0x3070d0,
    nose: 'bulb', jawW: 1.1, browScale: 1.6, chestW: 1.4, chestD: 1.3, belly: 1.25, headScale: 1.02,
    sweet: { lid: [0.2, 0.2], lidLo: [0.34, 0.34], lidTilt: [0.18, 0.18], eye: [1.05, 1.05], pupil: 1.3, browY: [0.06, 0.06], headZ: 0.1 },
    jerk: {
      lid: [0.06, 0.1], lidLo: [0, 0], lidTilt: [-0.3, -0.3], eye: [1.22, 1.18], pupil: 0.48, browRot: [0.75, 0.7], browY: [-0.05, -0.04],
      jaw: 0.34, headX: -0.1, headZ: 0, mouth: 'teeth',
    },
  });
  const k = b.kit, h = b.headInner;
  const beardC = k.toon(0xf4f4f6), beardS = k.toon(0xc6cedf);
  const leather = k.toon(0x4a2a14, { side: THREE.DoubleSide });
  const cream = k.toon(0xf2e8d2);

  // Bomber jacket: fleece collar and a zip.
  const fleece = k.ball(0.3, 0xefe6d2, 1.5, 0.45, 1.2, 12);
  fleece.position.y = 0.66;
  b.torsoInner.add(fleece);
  const zip = k.box(0.04, 0.4, 0.03, 0xc9ced8, 0.01);
  zip.position.set(0, 0.32, 0.39);
  b.torsoInner.add(zip);

  // Ruddy nose (the base nose is skin; tint a second, bigger one on top).
  const rn = k.ball(0.115, 0xe0605a, 1.15, 0.92, 1);
  rn.position.set(0, 0.4, 0.4);
  h.add(rn);

  // Aviator cap with ear flaps + goggles.
  const cap = new THREE.Group();
  cap.position.y = 0.075; // sits high so the bushy brows read
  h.add(cap);
  cap.add(shell(b, 0.445, leather, 0, Math.PI * 2, 0, 1.0, 1.07, 0.99, 0.98).translateY(0.5));
  cap.add(shell(b, 0.45, leather, Math.PI - 0.4, Math.PI + 0.8, 0, 2.0, 1.07, 1.0, 0.99).translateY(0.5));
  // Cream fleece trim round the cap's front edge and on the flaps (so it reads as a cap, not ears/hair).
  const trim = k.mesh(new THREE.TorusGeometry(0.385, 0.05, 6, 22, Math.PI * 1.25), cream, 0.014);
  trim.scale.set(1.07, 1, 1);
  trim.position.set(0, 0.5 + 0.445 * Math.cos(1.0) - 0.01, 0.02);
  trim.rotation.set(Math.PI / 2 - 0.08, 0, -Math.PI * 0.125 + Math.PI);
  trim.visible = false;
  cap.add(trim);
  for (const s of [-1, 1]) {
    const flap = k.ball(0.13, leather, 0.5, 1.15, 0.9, 10);
    flap.position.set(s * 0.45, 0.38, -0.02);
    cap.add(flap);
    const fl = k.ball(0.1, cream, 0.45, 0.5, 0.9, 8, 0.012);
    fl.position.set(s * 0.47, 0.25, -0.02);
    cap.add(fl);
  }
  cap.add(band(b, 0.75, 0x2a180c, 0.08, 0.48, -0.15));
  const gog = goggles(b, 0x141a2a, 0xd8c070, 0x2a180c);
  gog.scale.setScalar(1.3);
  gog.position.set(0, 0.95, 0.27);
  gog.rotation.x = -0.95;
  cap.add(gog);

  // Handlebar moustache: each side on a pivot under the nose so the bellow can lift it up and out.
  const staches: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const piv = new THREE.Group();
    piv.position.set(s * 0.03, 0.34, 0.4);
    h.add(piv);
    const m = k.ball(0.15, beardC, 1.4, 0.55, 0.65, 12);
    m.position.set(s * 0.1, -0.02, -0.02);
    m.rotation.z = s * -0.35;
    piv.add(m);
    const curl = k.ball(0.07, beardC, 1, 1, 0.8, 8);
    curl.position.set(s * 0.27, 0.04, -0.08);
    piv.add(curl);
    staches.push(piv);
  }
  // A deep mouth for the bellow (hidden behind the chin and beard when shut).
  const maw = k.ball(0.2, 0x3a0a14, 1.35, 1.2, 0.8, 12, 0);
  maw.position.set(0, 0.16, 0.18);
  h.add(maw);

  // The beard: ENORMOUS. A wide mass hanging from the jaw + 4 wide, flat, overlapping tapered slabs that
  // reach the belt. It hangs off a pivot that counter-rotates against the jaw, so when he bellows the beard
  // drops with the chin instead of swinging back into his chest. The chin skin is painted beard-white.
  (b.jawInner.children[0] as THREE.Mesh).material = beardC;
  const beardPiv = new THREE.Group();
  beardPiv.position.set(0, -0.12, 0.16);
  b.jawInner.add(beardPiv);
  const mass = k.ball(0.3, beardC, 1.8, 1.1, 0.85, 16);
  mass.position.set(0, -0.26, 0.03);
  beardPiv.add(mass);
  for (const x of [-0.24, 0, 0.24]) {
    const st = k.ball(0.05, beardS, 1, 4.2, 0.5, 8, 0);
    st.position.set(x, -0.33, 0.27 - Math.abs(x) * 0.35);
    st.rotation.set(-0.2, x * 0.9, 0);
    beardPiv.add(st);
  }
  // Cloud puffs round the mass's lower rim and up the sideburns, so its silhouette is lumpy and soft.
  for (const [x, y, z, r] of [
    [-0.5, -0.12, -0.04, 0.13], [0.5, -0.12, -0.04, 0.13], [-0.42, -0.32, 0.04, 0.15], [0.42, -0.32, 0.04, 0.15],
    [-0.2, -0.45, 0.14, 0.15], [0.2, -0.45, 0.14, 0.15], [0, -0.48, 0.18, 0.14], [-0.3, -0.05, 0.2, 0.12], [0.3, -0.05, 0.2, 0.12],
  ] as const) {
    const p = k.ball(r, Math.abs(x) > 0.4 ? beardS : beardC, 1.15, 0.95, 0.85, 16);
    p.position.set(x, y, z);
    beardPiv.add(p);
  }
  // Four tapering cloud tails: stacks of round, overlapping puffs (no flat slabs), narrowing to soft tips.
  const beard: Chain[] = [];
  const slabs: [number, number, number][] = [[-0.3, 0.0, 0.14], [0.3, 0.0, -0.14], [-0.1, 0.07, 0.05], [0.1, 0.07, -0.05]];
  slabs.forEach(([x, z, rz], i) => {
    const outer = i < 2;
    beard.push(strand(b, beardPiv, { x, y: -0.42, z: z + 0.2 }, {
      n: outer ? 4 : 5, len: outer ? 0.15 : 0.16, r0: outer ? 0.19 : 0.21, r1: outer ? 0.07 : 0.08, color: outer ? beardS : beardC,
      rx: -0.75, rz: rz * 1.6, ry: (i % 2 ? -1 : 1) * (outer ? 0.35 : 0.2), curl: 0.16, wide: 1.12, seg: 16,
      flat: 0.78, stiffness: 50, damping: 4, inertia: 0.09, lag: 0.9, outline: 0.009,
    }));
  });

  // Scarf: wrap around the neck + two long tails.
  const red = k.toon(0xe03030), stripe = k.toon(0xf4f0ea);
  const wrap = k.cyl(0.2, 0.22, 0.14, red, 14);
  wrap.position.y = 0.72;
  b.torsoInner.add(wrap);
  const scarves: Chain[] = [];
  for (const [x, n, rz] of [[0.12, 8, -0.25], [0.02, 6, 0.1]] as const) {
    const sc = strand(b, b.torsoInner, { x, y: 0.7, z: -0.2 }, {
      n, len: 0.16, r0: 0.09, r1: 0.085, color: red, rx: 0.9, rz, box: true, wide: 1.4, flat: 0.25, stiffness: 45, damping: 3.5,
      inertia: 0.1, lag: 1.0, outline: 0.016,
    });
    sc.joints.forEach((j, i) => {
      if (i % 2) (j.children[0] as THREE.Mesh).material = stripe;
    });
    scarves.push(sc);
  }

  // Anger vein (jerk): a little popping cross on the temple.
  const vein = new THREE.Group();
  vein.position.set(-0.26, 0.74, 0.3);
  vein.rotation.set(-0.5, -0.6, 0);
  h.add(vein);
  const veinM = k.toon(0xd02040);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const arc = k.mesh(new THREE.TorusGeometry(0.03, 0.009, 5, 10, Math.PI * 0.75), veinM, 0);
    arc.position.set(Math.cos(a) * 0.04, Math.sin(a) * 0.04, 0);
    arc.rotation.z = a + Math.PI * 0.62;
    vein.add(arc);
  }
  const skin0 = new THREE.Color(b.spec.skin), flush = new THREE.Color(0xe8503c);

  b.props.cap = cap;
  b.props.goggles = gog;
  b.props.scarf = scarves[0].joints[0];
  b.props.beard = mass;

  let manual = false, bellowT = 0, bellow = 0, inhale = 0;
  const armL0 = b.armL.position.clone(), armR0 = b.armR.position.clone();
  const belly0 = b.belly?.position.clone(), zip0 = zip.position.clone(), piv0 = beardPiv.position.clone();
  const rig = finish(b, (c) => {
    const { t, sig, face, dt } = c;
    const storm = sig;
    // Heel turn: red-faced bluster vs jolly grandpa.
    const j = c.turn;
    b.skinMat.color.copy(skin0).lerp(flush, 0.6 * j);
    vein.visible = c.turnOn && j > 0.5;
    vein.scale.setScalar(1 + 0.25 * Math.abs(Math.sin(t * 7)) * j);
    for (const ch of b.cheeks) ch.scale.setScalar(1 + 0.3 * j);
    if (c.turnOn) {
      b.torsoInner.rotation.x += 0.05 * j;
      b.torsoInner.position.x += Math.sin(t * 40) * 0.006 * j; // shaking with rage
      face.headZ += Math.sin(t * 1.4) * 0.05 * (1 - j);
    }
    // Inhale: balloon the chest and belly (meshes only; arm pivots slide out, the arms keep their size).
    const ih = inhale;
    const cj = c.turnOn ? j : 0;
    b.chest.scale.set((1 + 0.08 * cj) * (1 + 0.5 * ih), (1 + 0.06 * cj) * (1 + 0.32 * ih), (1 + 0.12 * cj) * (1 + 0.85 * ih));
    if (b.belly && belly0) {
      b.belly.scale.set(1 + 0.6 * ih, 1 + 0.45 * ih, 1 + 0.9 * ih);
      b.belly.position.set(belly0.x, belly0.y + 0.02 * ih, belly0.z + 0.16 * ih);
    }
    fleece.scale.set(1 + 0.35 * ih, 1 + 0.2 * ih, 1 + 0.6 * ih);
    zip.position.set(zip0.x, zip0.y + 0.03 * ih, zip0.z + 0.3 * ih);
    zip.scale.set(1, 1 + 0.3 * ih, 1);
    b.armL.position.set(armL0.x + 0.2 * ih, armL0.y + 0.08 * ih, armL0.z);
    b.armR.position.set(armR0.x - 0.2 * ih, armR0.y + 0.08 * ih, armR0.z);
    b.head.position.y = (c.turnOn ? 0.74 - 0.03 * j : 0.74) + 0.1 * ih;
    b.head.position.z = (c.turnOn ? 0.05 * j : 0) + 0.08 * ih;
    wrap.position.y = 0.72 + 0.1 * ih;
    beardPiv.position.set(piv0.x, piv0.y, piv0.z + 0.22 * ih);
    if (ih > 0.001) {
      for (let i = 0; i < 2; i++) {
        const ch = b.cheeks[i], s = i === 0 ? 1 : -1;
        ch.scale.multiplyScalar(1 + 0.75 * ih);
        ch.position.set(s * (0.215 + 0.07 * ih), 0.415 - 0.02 * ih, 0.235 + 0.05 * ih);
        face.lid[i] += (0 - face.lid[i]) * ih;
        face.lidLo[i] += (0 - face.lidLo[i]) * ih;
        face.lidTilt[i] += (-0.1 - face.lidTilt[i]) * ih;
        face.eye[i] += (1.42 - face.eye[i]) * ih;
        face.browY[i] += (0.07 - face.browY[i]) * ih;
        face.browRot[i] += (0.2 - face.browRot[i]) * ih;
      }
      face.pupil += (0.38 - face.pupil) * ih;
      face.jaw *= 1 - ih;
      if (ih > 0.5) face.mouth = 'line';
    }
    bellow = damp(bellow, manual ? bellowT : sig, 18, manual ? c.bdt : dt);
    const bw = bellow;
    // Bellow face: huge open mouth, moustache up and out, furious brows, pinprick pupils.
    face.jaw = Math.max(face.jaw, 0.9 * bw + Math.abs(Math.sin(t * 9)) * 0.06 * bw);
    face.browRot = [face.browRot[0] + 0.6 * bw, face.browRot[1] + 0.6 * bw];
    face.browY = [face.browY[0] - 0.035 * bw, face.browY[1] - 0.035 * bw];
    face.lid = [face.lid[0] * (1 - bw) + 0.3 * bw, face.lid[1] * (1 - bw) + 0.3 * bw];
    face.lidTilt = [face.lidTilt[0] * (1 - bw) - 0.55 * bw, face.lidTilt[1] * (1 - bw) - 0.55 * bw];
    face.eye = [face.eye[0] * (1 - bw) + 0.95 * bw, face.eye[1] * (1 - bw) + 0.95 * bw];
    face.pupil = face.pupil * (1 - bw) + 0.35 * bw;
    face.headX += -0.14 * bw;
    const sb = Math.max(bw, 0.45 * j); // bluster: the moustache bristles up off the bared teeth
    staches.forEach((p, i) => {
      const s = i === 0 ? -1 : 1;
      p.rotation.set(-0.25 * sb, 0, s * 0.45 * sb);
      p.position.set(s * (0.03 + 0.05 * sb), 0.34 + 0.06 * sb, 0.4 + 0.02 * sb);
    });
    maw.visible = face.jaw > 0.12;
    beardPiv.rotation.x = -0.8 * Math.max(0, face.jaw);
    for (const s of beard) {
      s.wind.set((0.7 + 0.5 * Math.sin(t * 1.3)) * storm, -0.55 * storm);
      s.gust = 0.15 + storm * 1.1;
      s.freq = 1.5 + storm * 2.5;
    }
    for (const s of scarves) {
      s.wind.set(0.2 + 1.5 * storm, 0.4 + 0.3 * storm);
      s.gust = 0.25 + storm * 1.0;
      s.freq = 1.6 + storm * 2.6;
    }
    if (storm < 0.01) return;
    // Storm: arms flung wide with fists, body braced and shaking.
    const shake = Math.sin(t * 31) * 0.02 * storm;
    face.headX += -0.08 * storm + shake;
    b.torsoInner.rotation.x = -0.1 * storm;
    b.torsoInner.position.x = shake;
    b.armInnerL.rotation.set(-0.3 * storm, 0, 0.18 + 1.25 * storm);
    b.armInnerR.rotation.set(-0.3 * storm, 0, -0.18 - 1.25 * storm);
    b.elbowL.rotation.x = -0.25 - 0.7 * storm;
    b.elbowR.rotation.x = -0.25 - 0.7 * storm;
  });
  return Object.assign(rig, {
    setBellow(v: number) {
      manual = true;
      bellowT = clamp(v, 0, 1);
    },
    setInhale(v: number) {
      inhale = clamp(v, 0, 1);
    },
  });
}
