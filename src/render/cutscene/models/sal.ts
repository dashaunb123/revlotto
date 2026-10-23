// Shortstack Sal: a tiny, hot-headed motormouth with a Napoleon complex. A towering glossy pompadour (it adds a
// third to his height and he knows it), wraparound shades, a gold rope chain with a "#1" medallion, a popped-collar
// orange racing jacket, a puffed-out chest, very short legs on elevator shoes. Always yelling.
//
// Beat controls (drive them from the scene; all instant, ramp them yourself):
//   setShades(k 0..1)   0 = wraparounds on (eyes hidden), 1 = slid down the nose: he glares over the top. No hands.
//   setKick(k 0..1)     his right leg swings forward in a toe-punt (0.5 = wind-up back, 1 = full kick forward).
//   setStep(k)          waddle phase in radians (legs alternate, body bobs); setStepAmt(0..1) scales it.
//   setNapoleon(k 0..1) right hand tucked into the jacket front, left fist on the hip, chest out, chin up.
//   setFlail(k 0..1)    arms and legs windmilling (the fall).
//   setPoke(k 0..1, target?) right arm jabs out, index finger leading ('point' pose); with a world target (the lens)
//                      the arm reaches for it, cartoon-stretching up to 1.6x.
// setSignature(k): TANTRUM - face flushes red, the temple vein pops, he vibrates with rage and pumps both fists.
// setTurn(k): sweet face is unused by the scene (he is a jerk from frame 0); jerk = furious scowl, chin up.
// props: pomp (pompadour pivot, springs on its own), shades, medallion, gripL / gripR, legL / legR (leg pivots).
import * as THREE from 'three';
import { buildBase, finish, reach, type CharacterRigX } from './character';
import { clamp, damp } from './kit';
import { shell } from './parts';

export interface SalRig extends CharacterRigX {
  setShades(k: number): void;
  setKick(k: number): void;
  setStep(phase: number): void;
  setStepAmt(k: number): void;
  setNapoleon(k: number): void;
  setFlail(k: number): void;
  setPoke(k: number, target?: THREE.Vector3): void;
}

const HIP = 0.44;

export function buildSal(): SalRig {
  const b = buildBase({
    skin: 0xeab48c, shirt: 0xe07b1f, sleeve: 0xe07b1f, pants: 0x1c1a20, shoes: 0x141216, brow: 0x16121a, iris: 0x7a4a22,
    nose: 'sharp', jawW: 1.08, browScale: 1.45, chestW: 1.12, chestD: 1.2, headScale: 1.04,
    sweet: { mouth: 'smile' },
    jerk: {
      lid: [0.28, 0.28], lidLo: [0.22, 0.22], lidTilt: [-0.38, -0.38], eye: [1.06, 1.06], pupil: 0.6, browRot: [0.78, 0.78],
      browY: [-0.045, -0.045], jaw: 0.0, headX: -0.14, headZ: 0, mouth: 'teeth',
    },
  });
  const k = b.kit, h = b.headInner;

  // ---- short legs on elevator shoes, each on its own hip pivot (kicks, waddles, flails) ----
  b.hips.position.y = HIP;
  b.hipHeight = HIP;
  const legPiv: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const p = new THREE.Group();
    p.position.set(s * 0.16, -0.02, 0);
    legPiv.push(p);
  }
  for (const m of [...b.legs.children]) {
    const s = m.position.x > 0 ? 0 : 1;
    const p = legPiv[s];
    m.position.x -= p.position.x;
    p.add(m);
  }
  b.legs.add(legPiv[0], legPiv[1]);
  for (const p of legPiv) {
    // rebuild the vertical layout for the shorter hip: leg column, cuff, shoe on a fat platform sole
    for (const m of p.children as THREE.Mesh[]) {
      const g = m.geometry as THREE.BufferGeometry & { parameters?: { height?: number; radiusTop?: number } };
      const prm = g.parameters ?? {};
      if (g.type === 'CylinderGeometry' && prm.height && prm.height > 0.3) {
        m.scale.y = 0.42;
        m.position.y = -0.11;
      } else if (g.type === 'CylinderGeometry' && prm.height && prm.height > 0.05) {
        m.position.y = -0.235;
      } else if (g.type === 'CylinderGeometry') {
        m.scale.set(1.12, 3.4, 1.62); // elevator sole
        m.position.y = -HIP + 0.07;
        m.material = k.toon(0x5a3a22, { gloss: 0.3 });
      } else {
        m.position.y = -HIP + 0.15;
      }
    }
  }
  b.props.legL = legPiv[0];
  b.props.legR = legPiv[1];

  // ---- racing jacket: popped black collar, zip, black racing stripes, sleeve bands, a chest patch ----
  const black = k.toon(0x18161c, { gloss: 0.35 });
  const orange = k.toon(0xe07b1f, { gloss: 0.45 });
  const white = k.toon(0xf6f2ea);
  for (const s of [-1, 1]) {
    const col = k.ball(0.17, black, 0.55, 1.0, 0.85, 14);
    col.position.set(s * 0.21, 0.76, -0.07);
    col.rotation.set(-0.2, s * 0.6, s * -0.45);
    b.torsoInner.add(col);
  }
  const collarBack = k.ball(0.2, black, 1.2, 0.85, 0.5, 14);
  collarBack.position.set(0, 0.8, -0.14);
  collarBack.rotation.x = -0.2;
  b.torsoInner.add(collarBack);
  const zip = k.box(0.035, 0.42, 0.03, 0xc9ced8, 0.008);
  zip.position.set(0, 0.34, 0.33);
  b.torsoInner.add(zip);
  // racing stripes painted on the jacket (sphere u = 0.25 faces +Z)
  const jacketTex = k.canvas(128, 8, (g, w, hh) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, w, hh);
    g.fillStyle = '#18161c';
    for (const u of [0.13, 0.37]) {
      g.fillRect(Math.round((u - 0.022) * w), 0, Math.round(0.03 * w), hh);
      g.fillRect(Math.round((u + (u < 0.25 ? -0.045 : 0.025)) * w), 0, Math.round(0.012 * w), hh);
    }
  }, true);
  const jacketMat = k.toonUnique(0xe07b1f, { gloss: 0.45 });
  jacketMat.map = jacketTex;
  b.chest.material = jacketMat;
  for (const inner of [b.armInnerL, b.armInnerR]) {
    const bandU = k.cyl(0.104, 0.1, 0.06, black, 12, 0.008);
    bandU.position.y = -0.12;
    inner.add(bandU);
  }
  for (const el of [b.elbowL, b.elbowR]) {
    const cuff = k.cyl(0.1, 0.104, 0.06, black, 12, 0.008);
    cuff.position.y = -0.22;
    el.add(cuff);
  }
  // "SAL" chest patch (his left)
  const patchTex = k.canvas(64, 32, (g, w, hh) => {
    g.fillStyle = '#18161c';
    g.beginPath();
    g.ellipse(w / 2, hh / 2, w / 2 - 1, hh / 2 - 1, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#e07b1f';
    g.beginPath();
    g.ellipse(w / 2, hh / 2, w / 2 - 4, hh / 2 - 4, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#18161c';
    g.font = 'bold 18px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('SAL', w / 2, hh / 2 + 1);
  }, true);
  const patch = new THREE.Mesh(k.geo(new THREE.PlaneGeometry(0.17, 0.085)), k.own(new THREE.MeshBasicMaterial({ map: patchTex, transparent: true })));
  patch.position.set(0.15, 0.5, 0.375);
  patch.rotation.set(-0.25, 0.42, 0);
  b.torsoInner.add(patch);

  // ---- gold rope chain + a fat "#1" medallion ----
  const gold = k.toon(0xffc83a, { gloss: 1, shine: 80 });
  const chain = new THREE.Group();
  chain.position.set(0, 0.7, 0.02);
  b.torsoInner.add(chain);
  const N = 22;
  const chainPt = (u: number) => {
    const a = u * Math.PI * 2;
    const front = Math.max(0, Math.cos(a));
    return new THREE.Vector3(Math.sin(a) * 0.25, -0.22 * front ** 2 + 0.02 * (1 - front), Math.cos(a) * (0.2 + 0.12 * front));
  };
  for (let i = 0; i < N; i++) {
    const p = chainPt(i / N);
    const bead = k.ball(0.032, gold, 1.2, 0.85, 0.85, 8, 0.007);
    bead.position.copy(p);
    bead.rotation.y = (i / N) * Math.PI * 2 + Math.PI / 2;
    chain.add(bead);
  }
  const medTex = k.canvas(64, 64, (g, w) => {
    g.fillStyle = '#c8901c';
    g.beginPath();
    g.arc(w / 2, w / 2, w / 2 - 1, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffd95a';
    g.beginPath();
    g.arc(w / 2, w / 2, w / 2 - 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#7a4a10';
    g.font = 'bold 30px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('#1', w / 2, w / 2 + 2);
  }, true);
  const medallion = new THREE.Group();
  medallion.position.set(0, -0.24, 0.335);
  chain.add(medallion);
  const disc = k.cyl(0.085, 0.085, 0.025, gold, 20, 0.01);
  disc.rotation.x = Math.PI / 2;
  medallion.add(disc);
  const face = new THREE.Mesh(k.geo(new THREE.CircleGeometry(0.083, 24)), k.own(new THREE.MeshBasicMaterial({ map: medTex })));
  face.position.z = 0.0135;
  medallion.add(face);
  medallion.rotation.x = -0.25;
  const glint = k.box(0.02, 0.07, 0.005, 0xffffff, 0);
  glint.position.set(0.04, 0.03, 0.017);
  glint.rotation.z = -0.7;
  medallion.add(glint);

  // ---- the POMPADOUR: a tall, glossy, forward-rolling quiff on a springy pivot ----
  const hairM = k.toon(0x1d1a26, { gloss: 1, shine: 70, rim: 1.2 });
  const cap = shell(b, 0.445, hairM, 0, Math.PI * 2, 0, 0.85, 1.07, 1.0, 1.0);
  cap.position.set(0, 0.5, -0.02);
  h.add(cap);
  const back = k.ball(0.4, hairM, 1.08, 0.82, 0.95, 18);
  back.position.set(0, 0.55, -0.2);
  h.add(back);
  for (const s of [-1, 1]) {
    const burn = k.ball(0.07, hairM, 0.6, 1.6, 0.9, 10);
    burn.position.set(s * 0.41, 0.48, 0.07);
    h.add(burn);
  }
  const pomp = new THREE.Group();
  pomp.position.set(0, 0.86, -0.02);
  h.add(pomp);
  const pompInner = new THREE.Group();
  pomp.add(pompInner);
  // one big lacquered mound sweeping up and forward, a taller crest on it, and the fat front roll (the wave)
  const mound = k.ball(0.42, hairM, 1.04, 0.7, 1.15, 22);
  mound.position.set(0, 0.14, 0.06);
  mound.rotation.x = -0.35;
  pompInner.add(mound);
  const crest = k.ball(0.34, hairM, 0.94, 0.72, 1.2, 22);
  crest.position.set(0, 0.34, 0.2);
  crest.rotation.x = -0.55;
  pompInner.add(crest);
  const roll = k.ball(0.19, hairM, 1.95, 1.0, 1.15, 20);
  roll.position.set(0, 0.4, 0.47);
  roll.rotation.x = -0.3;
  pompInner.add(roll);
  // comb grooves + hot specular streaks (it is LACQUERED)
  const groove = k.toon(0x0b0a10, { gloss: 0 });
  for (const x of [-0.17, 0, 0.17]) {
    const g = k.ball(0.013, groove, 1, 1, 18, 6, 0);
    g.position.set(x, 0.56 - Math.abs(x) * 0.5, 0.18);
    g.rotation.set(-0.42, x * 0.6, 0);
    pompInner.add(g);
  }
  const spec = k.own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
  for (const [x, y, z, rx, l] of [[0.1, 0.6, 0.24, -0.5, 0.15], [-0.08, 0.6, 0.22, -0.5, 0.09], [0.16, 0.5, 0.58, 0, 0.05]] as const) {
    const sp = k.ball(0.02, spec, 1, 1, l / 0.02, 6, 0);
    sp.position.set(x, y, z);
    sp.rotation.x = rx;
    pompInner.add(sp);
  }

  // ---- wraparound shades on a slide pivot (down the nose) ----
  const shadesPiv = new THREE.Group();
  h.add(shadesPiv);
  const shades = new THREE.Group();
  shades.position.set(0, 0.555, -0.02);
  shadesPiv.add(shades);
  const lensTex = k.canvas(8, 64, (g, w, hh) => {
    const gr = g.createLinearGradient(0, 0, 0, hh);
    gr.addColorStop(0, '#0a0814');
    gr.addColorStop(0.42, '#3a1a5a');
    gr.addColorStop(0.62, '#ff6a2a');
    gr.addColorStop(0.8, '#ffd04a');
    gr.addColorStop(1, '#2a0e30');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, hh);
  }, true);
  const lensMat = k.toonUnique(0xffffff, { gloss: 1, shine: 110, rim: 1.4 });
  lensMat.map = lensTex;
  const lensGeo = new THREE.CylinderGeometry(0.49, 0.515, 0.23, 30, 1, true, -1.2, 2.4);
  const lens = k.mesh(lensGeo, lensMat, 0);
  lens.material = lensMat;
  (lens.material as THREE.Material).side = THREE.DoubleSide;
  shades.add(lens);
  // the outline hull of an open strip: a slightly fatter, back-faced copy
  const hullGeo = new THREE.CylinderGeometry(0.505, 0.53, 0.26, 30, 1, true, -1.24, 2.48);
  const hull = new THREE.Mesh(k.geo(hullGeo), k.outlineMat);
  hull.userData.hull = true;
  shades.add(hull);
  const ftg = new THREE.TorusGeometry(0.495, 0.022, 6, 30, 2.5);
  ftg.rotateZ(Math.PI / 2 - 1.25);
  ftg.rotateX(Math.PI / 2);
  const frameTop = k.mesh(ftg, black, 0.008);
  frameTop.position.y = 0.115;
  shades.add(frameTop);
  for (const s of [-1, 1]) {
    const arm = k.box(0.025, 0.03, 0.28, black, 0.006);
    arm.position.set(s * 0.45, 0.08, -0.22);
    arm.rotation.y = s * 0.12;
    shades.add(arm);
  }
  const shine = k.own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
  for (const [a, w] of [[-0.45, 0.025], [-0.32, 0.012], [0.5, 0.02]] as const) {
    const st = new THREE.Mesh(k.geo(new THREE.PlaneGeometry(w, 0.2)), shine);
    st.position.set(Math.sin(a) * 0.505, 0.0, Math.cos(a) * 0.505);
    st.rotation.set(0, a, 0.5);
    shades.add(st);
  }

  // ---- anger vein (tantrum) ----
  const vein = new THREE.Group();
  vein.position.set(0.3, 0.74, 0.27);
  vein.rotation.set(-0.4, 0.75, 0);
  h.add(vein);
  const veinM = k.toon(0xd02040);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    const arc = k.mesh(new THREE.TorusGeometry(0.035, 0.011, 5, 10, Math.PI * 0.75), veinM, 0);
    arc.position.set(Math.cos(a) * 0.045, Math.sin(a) * 0.045, 0);
    arc.rotation.z = a + Math.PI * 0.62;
    vein.add(arc);
  }

  b.props.pomp = pomp;
  b.props.shades = shades;
  b.props.medallion = medallion;
  b.props.chain = chain;

  const skin0 = new THREE.Color(b.spec.skin), flush = new THREE.Color(0xf05a40);
  let shadesK = 0, kick = 0, step = 0, stepAmt = 0, nap = 0, flail = 0, poke = 0;
  let pokeAt: THREE.Vector3 | null = null;
  // pompadour spring, driven by the head's world acceleration
  const hp = new THREE.Vector3(), hpPrev = new THREE.Vector3(), hv = new THREE.Vector3(), hvPrev = new THREE.Vector3();
  let sprX = 0, sprV = 0, sprZ = 0, sprVZ = 0, primed = 0, rage = 0;
  const q = new THREE.Quaternion();

  const rig = finish(b, (c) => {
    const { t, dt, face } = c;
    const sig = c.sig;
    rage = damp(rage, sig, 10, dt);
    // tantrum: red face, vein, vibrate, fists pumping
    b.skinMat.color.copy(skin0).lerp(flush, 0.55 * rage + 0.12);
    vein.visible = rage > 0.25 || c.turn > 0.5;
    vein.scale.setScalar((0.8 + 0.3 * rage) * (1 + 0.25 * Math.abs(Math.sin(t * 9))));
    b.torsoInner.position.x += Math.sin(t * 47) * 0.012 * rage;
    face.headZ += Math.sin(t * 39) * 0.03 * rage;
    // posture: chest out, chin up (always), plus the Napoleon pose
    b.torsoInner.rotation.x -= 0.06 + 0.08 * nap;
    face.headX -= 0.06 * nap;
    if (rage > 0.01) {
      const pump = Math.sin(t * 16);
      b.armInnerL.rotation.set(-0.5 * rage + 0.35 * pump * rage, 0, 0.18 + 0.75 * rage);
      b.armInnerR.rotation.set(-0.5 * rage - 0.35 * pump * rage, 0, -0.18 - 0.75 * rage);
      b.elbowL.rotation.x = -0.25 - 1.5 * rage;
      b.elbowR.rotation.x = -0.25 - 1.5 * rage;
      c.hand[0] = c.hand[1] = 'fist';
    }
    // Napoleon: right hand into the jacket front, left fist on the hip
    if (nap > 0.001) {
      const a = nap;
      b.armInnerR.rotation.set(b.armInnerR.rotation.x * (1 - a) - 0.55 * a, b.armInnerR.rotation.y * (1 - a) - 0.15 * a, b.armInnerR.rotation.z * (1 - a) + 0.25 * a);
      b.elbowR.rotation.set(b.elbowR.rotation.x * (1 - a) - 1.7 * a, 0, -0.95 * a);
      b.armInnerL.rotation.set(b.armInnerL.rotation.x * (1 - a) + 0.25 * a, 0, b.armInnerL.rotation.z * (1 - a) + 0.75 * a);
      b.elbowL.rotation.set(b.elbowL.rotation.x * (1 - a) - 1.2 * a, 0, -0.9 * a);
      if (a > 0.5) {
        c.hand[1] = 'flat';
        c.hand[0] = 'fist';
      }
    }
    // poke: right arm straight out at the camera, index leading
    if (poke > 0.001 && pokeAt) {
      reach(b, -1, pokeAt, poke, 0.05);
      c.hand[1] = 'point';
    } else if (poke > 0.001) {
      const a = poke;
      b.armInnerR.rotation.set(b.armInnerR.rotation.x * (1 - a) - 1.5 * a, 0, b.armInnerR.rotation.z * (1 - a) - 0.12 * a);
      b.elbowR.rotation.set(b.elbowR.rotation.x * (1 - a) - 0.05 * a, 0, 0);
      c.hand[1] = 'point';
    }
    // flail: windmilling arms, bicycling legs
    if (flail > 0.001) {
      const a = flail;
      b.armInnerL.rotation.set(Math.sin(t * 19) * 1.4 * a, 0, 0.6 + 1.3 * a + Math.cos(t * 19) * 0.5 * a);
      b.armInnerR.rotation.set(Math.sin(t * 19 + 2) * 1.4 * a, 0, -0.6 - 1.3 * a - Math.cos(t * 19 + 2) * 0.5 * a);
      b.elbowL.rotation.x = -0.6 * a;
      b.elbowR.rotation.x = -0.6 * a;
      c.hand[0] = c.hand[1] = 'open';
    }
    // legs: waddle, kick, flail
    const sw = Math.sin(step) * 0.6 * stepAmt;
    let lL = sw, lR = -sw;
    lR += kick < 0.5 ? 0.9 * (kick / 0.5) : 0.9 - 2.6 * ((kick - 0.5) / 0.5);
    if (flail > 0.001) {
      lL += Math.sin(t * 17) * 0.9 * flail;
      lR += Math.sin(t * 17 + Math.PI) * 0.9 * flail;
    }
    legPiv[0].rotation.x = lL;
    legPiv[1].rotation.x = lR;
    b.torsoInner.position.y += Math.abs(Math.cos(step)) * 0.04 * stepAmt;
    b.torsoInner.rotation.z += Math.sin(step) * 0.08 * stepAmt;
    b.torsoInner.rotation.x += 0.12 * Math.max(0, kick - 0.5) * 2;
    // shades slide down the nose (eyes glare over the top)
    const sk = shadesK;
    shadesPiv.position.set(0, -0.12 * sk, 0.06 * sk);
    shadesPiv.rotation.x = 0.25 * sk;
    if (sk > 0.3) {
      face.lid = [Math.min(face.lid[0], 0.3), Math.min(face.lid[1], 0.3)];
      face.pupil = Math.min(face.pupil, 0.55);
    }
    // pompadour spring
    b.head.updateWorldMatrix(true, false);
    hp.setFromMatrixPosition(b.head.matrixWorld);
    if (dt > 1e-5) {
      hv.subVectors(hp, hpPrev).divideScalar(dt);
      if (primed > 1) {
        const acc = hv.clone().sub(hvPrev).divideScalar(dt);
        b.head.getWorldQuaternion(q).invert();
        acc.applyQuaternion(q);
        sprV += (-acc.z * 0.02 - acc.y * 0.01) * dt;
        sprVZ += acc.x * 0.02 * dt;
      }
      primed++;
      hpPrev.copy(hp);
      hvPrev.copy(hv);
      sprV += (-sprX * 220 - sprV * 9) * dt;
      sprVZ += (-sprZ * 220 - sprVZ * 9) * dt;
      sprX = clamp(sprX + sprV * dt, -0.5, 0.5);
      sprZ = clamp(sprZ + sprVZ * dt, -0.5, 0.5);
    }
    pompInner.rotation.set(sprX + Math.sin(t * 47) * 0.02 * rage, 0, sprZ);
  });
  rig.height = 2.4;
  return Object.assign(rig, {
    setShades(v: number) {
      shadesK = clamp(v, 0, 1);
    },
    setKick(v: number) {
      kick = clamp(v, 0, 1);
    },
    setStep(v: number) {
      step = v;
    },
    setStepAmt(v: number) {
      stepAmt = clamp(v, 0, 1);
    },
    setNapoleon(v: number) {
      nap = clamp(v, 0, 1);
    },
    setFlail(v: number) {
      flail = clamp(v, 0, 1);
    },
    setPoke(v: number, target?: THREE.Vector3) {
      poke = clamp(v, 0, 1);
      pokeAt = target ? (pokeAt ?? new THREE.Vector3()).copy(target) : null;
    },
  });
}
