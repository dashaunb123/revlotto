// DJ Blackout: an obnoxious club DJ who hijacks the stadium. Enormous glowing LED headphones, magenta shutter
// shades, a black hoodie with neon trim and a lightning-bolt print, a gold chain with a vinyl medallion, a short
// fade, and a huge cocky grin with a gold tooth. A jerk from frame 0 (setTurn is never needed).
// Signature: the vibe - head nodding on the beat, shoulders bouncing, the LEDs pumping.
// Extra controls (all instant targets, smoothed on the beat clock):
//   setShades(k 0..1)   0 = shutter shades pushed up on the forehead, 1 = down over the eyes.
//   setGlow(k 0..1+)    LED brightness: headphone rings, shades slats, the record medallion.
//   setGrinGlow(k 0..1) the grin's teeth and gold tooth glow (they stay lit in total darkness).
//   setTrimGlow(k)      the hoodie's neon trims, bolt and medallion (0 = dark).
//   setShadesGlow(k)    the shades' slats light separately (0 = dark slats, 1 = default).
//   setPulse(k 0..1)    beat pulse for the LEDs and the nod (scenes drive it with their own beat clock; when never
//                       called the rig makes its own 128 bpm pulse while the signature is on).
//   setCup(k 0..1)      left hand pressed to the left headphone cup (the DJ listen).
//   setScratch(k, world?) right hand on a record at `world` (a world point), scratching back and forth.
//   setScratchSpeed(hz) how fast the scratch hand saws (default 7).
import * as THREE from 'three';
import { buildBase, finish, reach, type CharacterRigX } from './character';
import { clamp, damp } from './kit';
import { shell } from './parts';

export interface DjRig extends CharacterRigX {
  setShades(k: number): void;
  setGlow(k: number): void;
  setGrinGlow(k: number): void;
  setPulse(k: number): void;
  setShadesGlow(k: number): void;
  setTrimGlow(k: number): void;
  setCup(k: number): void;
  setScratch(k: number, world?: THREE.Vector3): void;
  setScratchSpeed(hz: number): void;
}

const MAG = 0xff2fd6;
const CYAN = 0x2ff0ff;
const GOLD = 0xffc832;

export function buildDj(): DjRig {
  const b = buildBase({
    skin: 0x9a6442, shirt: 0x1d1828, pants: 0x241f2e, shoes: 0xf2f2f2, brow: 0x1a1012, iris: MAG,
    nose: 'button', jawW: 1.12, chestW: 1.08, chestD: 1.05, headScale: 1.05, browScale: 1.2,
    jerk: {
      mouth: 'grin', lid: [0.36, 0.28], lidLo: [0.22, 0.18], lidTilt: [-0.12, 0.05], browRot: [0.5, -0.25], browY: [-0.02, 0.05],
      eye: [1, 1.06], pupil: 0.95, headX: -0.13, headZ: 0.09, jawRoll: 0.04,
    },
  });
  const k = b.kit, h = b.headInner;
  for (const e of b.ears) e.visible = false; // under the cups
  const black = k.toon(0x141018, { gloss: 0.7, shine: 80 });
  const leather = k.toon(0x221c2a, { gloss: 0.3 });
  const gold = k.toon(GOLD, { gloss: 1, shine: 90, emissive: 0x5a3a00, emissiveIntensity: 0.4 });
  const hoodie = k.toon(0x1d1828, { gloss: 0.05 });
  // LED materials: unique so the rig can pump them (emissive toon, they bloom and survive the blackout).
  const led = k.toonUnique(MAG, { emissive: MAG, emissiveIntensity: 1, gloss: 0.2 });
  const ledB = k.toonUnique(MAG, { emissive: MAG, emissiveIntensity: 1, gloss: 0.2 }); // body trims
  const ledC = k.toonUnique(CYAN, { emissive: CYAN, emissiveIntensity: 1, gloss: 0.2 });
  const ledGlow = k.own(new THREE.MeshBasicMaterial({ color: MAG, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));

  // ---------- hair: a short fade with a crisp line-up and a magenta streak ----------
  const hairC = k.toon(0x1a1214, { side: THREE.DoubleSide, gloss: 0.1 });
  h.add(shell(b, 0.445, hairC, 0, Math.PI * 2, 0, 0.82, 1.1, 1.12, 1.0).translateY(0.52));
  // a crisp line-up at the temples
  for (const sd of [-1, 1]) {
    const lu = k.ball(0.06, hairC, 0.6, 1.4, 0.8, 10, 0);
    lu.position.set(sd * 0.36, 0.72, 0.2);
    lu.rotation.y = sd * 0.9;
    h.add(lu);
  }
  const streak = k.ball(0.07, ledB, 1.0, 0.45, 2.8, 12, 0);
  streak.position.set(0.17, 0.95, 0.05);
  streak.rotation.set(0, 0, -0.35);
  h.add(streak);

  // ---------- the ENORMOUS headphones ----------
  const phones = new THREE.Group();
  phones.position.y = 0.52;
  h.add(phones);
  const bandArc = k.mesh(new THREE.TorusGeometry(0.62, 0.065, 10, 28, Math.PI), black, 0.016);
  bandArc.position.y = 0.0;
  bandArc.scale.set(1, 0.92, 1);
  phones.add(bandArc);
  const bandPad = k.mesh(new THREE.TorusGeometry(0.62, 0.05, 8, 20, Math.PI * 0.42), leather, 0.012);
  bandPad.rotation.z = Math.PI * 0.29;
  bandPad.position.y = -0.02;
  bandPad.scale.set(0.95, 0.88, 1.6);
  phones.add(bandPad);
  const bandStripe = k.mesh(new THREE.TorusGeometry(0.625, 0.018, 6, 28, Math.PI * 0.8), led, 0);
  bandStripe.rotation.z = Math.PI * 0.1;
  bandStripe.position.z = 0.05;
  bandStripe.scale.set(1, 0.92, 1);
  phones.add(bandStripe);
  const cups: THREE.Group[] = [];
  const cupGlow: THREE.Mesh[] = [];
  for (const s of [-1, 1]) {
    const cup = new THREE.Group();
    cup.position.set(s * 0.6, -0.04, -0.02);
    phones.add(cup);
    const fork = k.box(0.05, 0.24, 0.07, 0xc9ced8, 0.012);
    fork.position.set(-s * 0.02, 0.2, 0);
    cup.add(fork);
    const cushion = k.mesh(new THREE.TorusGeometry(0.2, 0.075, 10, 24), leather, 0.014);
    cushion.rotation.y = Math.PI / 2;
    cushion.position.x = -s * 0.07;
    cup.add(cushion);
    const shellM = k.cyl(0.29, 0.25, 0.2, black, 28, 0.018);
    shellM.rotation.z = Math.PI / 2;
    shellM.position.x = s * 0.06;
    cup.add(shellM);
    const ring = k.mesh(new THREE.TorusGeometry(0.24, 0.032, 8, 30), led, 0);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = s * 0.165;
    cup.add(ring);
    const face = k.cyl(0.2, 0.2, 0.02, 0x0c0a10, 24, 0);
    face.rotation.z = Math.PI / 2;
    face.position.x = s * 0.165;
    cup.add(face);
    // Equaliser bars on the cup face: little cyan LED stacks that bounce on the beat.
    const eq = new THREE.Group();
    eq.position.x = s * 0.178;
    eq.rotation.y = s * Math.PI / 2;
    cup.add(eq);
    for (let i = 0; i < 5; i++) {
      const bar = k.box(0.045, 0.2, 0.01, ledC, 0);
      bar.position.set((i - 2) * 0.065, 0, 0);
      bar.geometry.translate(0, 0.1, 0);
      bar.position.y = -0.1;
      eq.add(bar);
    }
    cup.userData.eq = eq;
    const glow = new THREE.Mesh(k.geo(new THREE.CircleGeometry(0.42, 28)), ledGlow);
    glow.rotation.y = s * Math.PI / 2;
    glow.position.x = s * 0.2;
    cup.add(glow);
    cupGlow.push(glow);
    cups.push(cup);
  }

  // ---------- shutter shades (pivot at the head centre: rotate up onto the forehead) ----------
  const shadesPiv = new THREE.Group();
  shadesPiv.position.y = 0.5;
  h.add(shadesPiv);
  const shades = new THREE.Group();
  shadesPiv.add(shades);
  const frame = k.toon(0x0e0a12, { gloss: 0.8, shine: 90 });
  const slatMat = k.toonUnique(MAG, { emissive: MAG, emissiveIntensity: 0.8, gloss: 0.4, side: THREE.DoubleSide });
  const arc = (r: number, y: number, hgt: number, th0: number, thL: number, mat: THREE.Material, ol = 0) => {
    const g = new THREE.CylinderGeometry(r, r, hgt, 40, 1, true, th0, thL);
    const m = k.mesh(g, mat, ol);
    m.position.y = y;
    return m;
  };
  // two lenses (left/right of the nose), each with 5 slats, a chunky top bar across both, a bridge
  for (const s of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const y = 0.15 - i * 0.042;
      const w = 0.5 - Math.abs(i - 1.5) * 0.04;
      const sl = arc(0.475, y - 0.08, 0.022, s > 0 ? 0.08 : -0.08 - w, w, slatMat);
      shades.add(sl);
    }
    const side = k.box(0.03, 0.2, 0.05, frame, 0.012);
    side.position.set(s * 0.43, 0.0, 0.2);
    side.rotation.y = s * 0.95;
    shades.add(side);
    const arm = k.box(0.025, 0.03, 0.3, frame, 0.01);
    arm.position.set(s * 0.46, 0.06, 0.03);
    shades.add(arm);
  }
  const topBar = arc(0.478, 0.1, 0.03, -1.0, 2.0, frame, 0);
  shades.add(topBar);
  const bridge = k.box(0.035, 0.08, 0.03, frame, 0.01);
  bridge.position.set(0, 0.06, 0.47);
  shades.add(bridge);
  shades.position.y = 0.07; // eye height (0.57) relative to the pivot (0.5)

  // ---------- grin extras: gold tooth, glow overlay for the blackout ----------
  const mw = 0.15 * 1.12;
  const goldTooth = b.chinDecal([[0.03, 0.035], [0.075, 0.035], [0.07, -0.012], [0.035, -0.012]], gold, 0.012, -0.11);
  b.jawInner.add(goldTooth);
  const grinGlowMat = k.own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  const goldGlowMat = k.own(new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  const grinGlow = b.chinDecal([[-mw * 1.08, 0.035], [mw * 1.08, 0.035], [mw * 0.95, -0.02], [-mw * 0.95, -0.02]], grinGlowMat, 0.016, -0.11);
  const goldGlow = b.chinDecal([[0.03, 0.035], [0.075, 0.035], [0.07, -0.012], [0.035, -0.012]], goldGlowMat, 0.02, -0.11);
  grinGlow.renderOrder = 3;
  goldGlow.renderOrder = 4;
  b.jawInner.add(grinGlow, goldGlow);
  // Open-mouth gold tooth (yell / talk): on the upper teeth row.
  const goldUp = k.box(0.045, 0.05, 0.03, gold, 0.008);
  goldUp.position.set(0.055, 0.245, 0.37);
  h.add(goldUp);

  // ---------- hoodie: hood bunched behind the neck, neon trim, drawstrings, pocket, bolt print ----------
  const hood = k.ball(0.3, hoodie, 1.45, 0.75, 0.9, 18);
  hood.position.set(0, 0.68, -0.2);
  b.torsoInner.add(hood);
  const hoodTrim = k.mesh(new THREE.TorusGeometry(0.27, 0.025, 8, 28), ledB, 0);
  hoodTrim.rotation.x = Math.PI / 2 - 0.25;
  hoodTrim.scale.set(1.15, 1, 1);
  hoodTrim.position.set(0, 0.7, 0.0);
  b.torsoInner.add(hoodTrim);
  for (const s of [-1, 1]) {
    const str = k.cyl(0.014, 0.014, 0.3, 0xf4f0f8, 6, 0.008);
    str.position.set(s * 0.08, 0.55, 0.3);
    str.rotation.x = -0.25;
    b.torsoInner.add(str);
    const ag = k.cyl(0.02, 0.02, 0.05, ledB, 8, 0.008);
    ag.position.set(s * 0.08, 0.39, 0.34);
    b.torsoInner.add(ag);
  }
  const pocket = k.box(0.42, 0.16, 0.06, 0x18141f, 0.012);
  pocket.position.set(0, 0.17, 0.27);
  b.torsoInner.add(pocket);
  const pocketTrim = k.box(0.44, 0.022, 0.065, ledB, 0);
  pocketTrim.position.set(0, 0.255, 0.27);
  b.torsoInner.add(pocketTrim);
  // cuff trim on both sleeves
  for (const el of [b.elbowL, b.elbowR]) {
    const cuff = k.cyl(0.1, 0.1, 0.03, ledB, 12, 0);
    cuff.position.y = -0.21;
    el.add(cuff);
  }
  // lightning bolt print on the chest
  const bolt = new THREE.Shape();
  [[-0.02, 0.12], [0.07, 0.12], [0.02, 0.03], [0.07, 0.03], [-0.04, -0.13], [0.0, -0.02], [-0.05, -0.02]].forEach(([x, y], i) =>
    i ? bolt.lineTo(x, y) : bolt.moveTo(x, y));
  const boltM = new THREE.Mesh(k.geo(new THREE.ShapeGeometry(bolt)), ledB);
  boltM.position.set(-0.12, 0.42, 0.285);
  boltM.rotation.y = -0.3;
  boltM.scale.setScalar(1.1);
  b.torsoInner.add(boltM);

  // ---------- gold chain with a vinyl-record medallion ----------
  const chain = k.mesh(new THREE.TorusGeometry(0.24, 0.022, 8, 30), gold, 0.01);
  chain.rotation.x = Math.PI / 2 - 0.62;
  chain.scale.set(1.05, 1.35, 1);
  chain.position.set(0, 0.6, 0.1);
  b.torsoInner.add(chain);
  const medal = new THREE.Group();
  medal.position.set(0, 0.33, 0.33);
  medal.rotation.x = -0.25;
  b.torsoInner.add(medal);
  const rec = k.cyl(0.11, 0.11, 0.02, 0x0c0a10, 24, 0.01);
  rec.rotation.x = Math.PI / 2;
  medal.add(rec);
  const groove = k.mesh(new THREE.TorusGeometry(0.075, 0.004, 4, 24), k.toon(0x3a3444), 0);
  groove.position.z = 0.012;
  medal.add(groove);
  const label = k.cyl(0.04, 0.04, 0.024, ledB, 16, 0);
  label.rotation.x = Math.PI / 2;
  medal.add(label);
  const bail = k.mesh(new THREE.TorusGeometry(0.025, 0.008, 6, 12), gold, 0.006);
  bail.position.y = 0.12;
  medal.add(bail);

  b.props.headphones = phones;
  b.props.cupL = cups[1];
  b.props.cupR = cups[0];
  b.props.shades = shadesPiv;
  b.props.medal = medal;
  if (b.nose.children[0]) b.props.noseHl = b.nose.children[0]; // the nose's highlight (hidden in the blackout)

  let trimGlow = 1, shadeGlow = 1, shadesT = 1, shadesK = 1, glowT = 1, glowK = 1, grinT = 0, grinK = 0, pulseManual = -1, cupT = 0, cupK = 0;
  let scrT = 0, scrK = 0, scrHz = 7;
  const scrAt = new THREE.Vector3();
  let scrHas = false;
  const _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _x = new THREE.Vector3();
  const eqH = [0.5, 0.8, 1, 0.7, 0.45];

  const rig = finish(b, (c) => {
    const { t, sig, face } = c;
    const bd = c.bdt;
    shadesK = damp(shadesK, shadesT, 22, bd);
    glowK = damp(glowK, glowT, 26, bd);
    grinK = damp(grinK, grinT, 26, bd);
    cupK = damp(cupK, cupT, 16, bd);
    scrK = damp(scrK, scrT, 18, bd);
    // the beat: 128 bpm, a hard attack and a quick decay
    const auto = Math.exp(-((t * (128 / 60)) % 1) * 5) * sig;
    const pulse = pulseManual >= 0 ? pulseManual : auto;

    // jerk posture: chest out, leaning back, chin up (no sweet half at all)
    b.torsoInner.rotation.x += -0.06;
    b.armInnerL.rotation.z += 0.1;
    b.armInnerR.rotation.z -= 0.1;

    // the vibe: nod on the beat, shoulders bounce
    const vibe = Math.max(sig, pulseManual >= 0 ? 0.6 : 0);
    face.headX += 0.16 * pulse * vibe - 0.03 * vibe;
    b.torsoInner.position.y += -0.025 * pulse * vibe;
    b.armInnerL.rotation.z += 0.08 * pulse * vibe;
    b.armInnerR.rotation.z -= 0.08 * pulse * vibe;

    // shades up/down
    shadesPiv.rotation.x = -0.5 * (1 - shadesK);
    shadesPiv.position.z = 0.02 * (1 - shadesK);
    const behind = shadesK > 0.6;
    if (behind) {
      // eyes behind the slats: keep them cocky (the brows do the talking)
      c.lookAdd.x += 0;
    }

    // LEDs
    const g = glowK * (0.55 + 0.75 * pulse);
    const gk = Math.min(1, glowK);
    led.emissiveIntensity = 0.5 * gk + 1.6 * g;
    led.color.setHex(MAG).multiplyScalar(0.12 + 0.88 * gk);
    ledB.emissiveIntensity = (0.4 + 1.2 * g) * trimGlow;
    ledB.color.setHex(MAG).multiplyScalar(0.12 + 0.88 * Math.min(1, trimGlow));
    ledC.emissiveIntensity = 0.5 * gk + 1.5 * g;
    slatMat.emissiveIntensity = (0.3 + 1.4 * g) * shadeGlow;
    slatMat.color.setHex(MAG).multiplyScalar(0.15 + 0.85 * Math.min(1, shadeGlow));
    ledGlow.opacity = clamp(0.12 * gk + 0.5 * g, 0, 0.9);
    for (const cg of cupGlow) cg.scale.setScalar(0.9 + 0.35 * pulse);
    cups.forEach((cup, ci) => {
      const eq = cup.userData.eq as THREE.Group;
      eq.children.forEach((bar, i) => {
        const v = 0.25 + 0.75 * eqH[(i + ci * 2) % 5] * (0.35 + 0.65 * pulse) * (0.7 + 0.3 * Math.sin(t * 13 + i * 2));
        bar.scale.y = clamp(v * Math.max(0.2, glowK), 0.08, 1.2);
      });
    });
    // the grin: glows in the dark
    const showGrin = face.mouth === 'grin' && face.jaw <= 0.1;
    goldTooth.visible = showGrin;
    grinGlow.visible = goldGlow.visible = showGrin && grinK > 0.01;
    grinGlowMat.opacity = clamp(grinK, 0, 1) * 0.95;
    goldGlowMat.opacity = clamp(grinK, 0, 1);
    goldUp.visible = face.jaw > 0.1;

    // left hand to the left headphone cup (the DJ listen)
    if (cupK > 0.001) {
      b.root.updateMatrixWorld(true);
      cups[1].getWorldPosition(_w);
      cups[1].getWorldQuaternion(_q);
      _x.set(1, 0, 0).applyQuaternion(_q);
      _w.addScaledVector(_x, 0.25 * b.root.scale.x);
      reach(b, 1, _w, cupK, 1.6);
      face.headZ += -0.12 * cupK;
      c.hand[0] = 'flat';
    }
    // right hand scratching a record
    if (scrK > 0.001 && scrHas) {
      b.root.updateMatrixWorld(true);
      _w.copy(scrAt);
      // saw back and forth along the camera-facing direction of the body (+X of the torso)
      b.torsoInner.getWorldQuaternion(_q);
      _x.set(1, 0, 0).applyQuaternion(_q);
      _w.addScaledVector(_x, Math.sin(t * scrHz * Math.PI * 2) * 0.12 * b.root.scale.x);
      reach(b, -1, _w, scrK, 0.9);
      if (scrHz > 0) c.hand[1] = 'flat';
      face.headX += 0.05 * scrK;
    }
  });
  rig.setTurn(1); // a jerk from frame 0
  return Object.assign(rig, {
    setShades(v: number) {
      shadesT = clamp(v, 0, 1);
    },
    setGlow(v: number) {
      glowT = Math.max(0, v);
    },
    setGrinGlow(v: number) {
      grinT = clamp(v, 0, 1);
    },
    setTrimGlow(v: number) {
      trimGlow = Math.max(0, v);
    },
    setShadesGlow(v: number) {
      shadeGlow = Math.max(0, v);
    },
    setPulse(v: number) {
      pulseManual = clamp(v, 0, 1);
    },
    setCup(v: number) {
      cupT = clamp(v, 0, 1);
    },
    setScratch(v: number, world?: THREE.Vector3) {
      scrT = clamp(v, 0, 1);
      if (world) {
        scrAt.copy(world);
        scrHas = true;
      }
    },
    setScratchSpeed(hz: number) {
      scrHz = hz;
    },
  });
}
