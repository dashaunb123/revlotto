// Redline Rosa (final boss): cold perfectionist. Red/white race suit, removable helmet, flowing red
// hair, sharp lined eyes. Signature: eyes glow red while her hair streams.
// Extra controls:
//   setEyeGlow(k 0..1)  white-hot core + red bloom + thin anamorphic streak per eye (sprites, drawn over
//                       everything but faded out when the eye faces away). props.eyeGlowL / eyeGlowR.
//                       Once called, setSignature no longer drives the glow (it still drives the hair).
//                       Reaches its target in ~0.1 s of beat time (see setBeatDt); setEyeGlow(k, true) snaps.
//   setCold(k 0..1)     flat, cold, narrowed-lid stare with the mouth shut (overrides talk).
//                       With setTurn(1) too it becomes her MEAN face: straight blade brows driven down at
//                       the centre, heavy dark lids slicing across the eyes (inner corners down), narrowed
//                       eyes, small pupils, chin down, and a thin one-sided sneer with a sliver of teeth.
//   liftHelmet(k 0..1)  helmet (visor + chin guard included) rises straight up and back off the head,
//                       hidden at 1. Optional: scenes may move props.helmet themselves instead.
// setTurn(k): sweet = the gracious champion (bright eyes with a sparkle and lashes, rosy cheeks, a polite closed
// smile, head tilted, upright). Jerk = cold glowing-eyed menace: heavy level lids, low flat brows, chin DOWN
// staring up from under them, a thin one-sided smirk, irises smouldering red, perfectly still and leaning in.
// (setEyeGlow still drives the full blaze; the turn adds only an ember.)
// The hair mane grows (strands x1.5 longer, +4 strands, spread wider) with setSignature.
import * as THREE from 'three';
import { buildBase, faceParts, finish, type CharacterRigX } from './character';
import { clamp, damp } from './kit';
import { shell, strand } from './parts';

export interface RosaRig extends CharacterRigX {
  setEyeGlow(k: number, snap?: boolean): void;
  setCold(k: number): void;
  liftHelmet(k: number): void;
}

export function buildRosa(): RosaRig {
  const b = buildBase({
    skin: 0xf2c4a2, shirt: 0xd81e2a, pants: 0xd81e2a, shoes: 0x1a1a22, hands: 0x1c1c26, brow: 0x8a1018, iris: 0xff2a2a,
    lid: 0x3c2430, nose: 'sharp', jawW: 0.86, chestW: 0.92, chestD: 0.95,
    sweet: { eye: [1.12, 1.12], pupil: 1.3, lid: [0.08, 0.08], lidLo: [0.16, 0.16], headZ: 0.14, headX: 0.05 },
    jerk: {
      lid: [0.4, 0.4], lidLo: [0.22, 0.22], lidTilt: [-0.14, -0.14], browRot: [0.4, 0.4], browY: [-0.03, -0.03], eye: [1.02, 1.02],
      pupil: 0.7, headX: 0.12, headZ: -0.03, jawRoll: 0.03, mouth: 'smirkR',
    },
  });
  const k = b.kit, h = b.headInner;
  for (const e of b.ears) e.visible = false;
  const hairC = k.toon(0xe0262c, { side: THREE.DoubleSide });
  const hairDark = k.toon(0xa8141c);

  // Suit details: white chest panel + shoulder stripes, black collar, number disc.
  const white = k.toon(0xf4f0ea);
  const panel = k.ball(0.34, white, 0.38, 0.95, 0.85);
  panel.position.set(0, 0.38, 0.012);
  b.torsoInner.add(panel);
  for (const arm of [b.armInnerL, b.armInnerR]) {
    const st = k.cyl(0.103, 0.093, 0.1, white, 10, 0.01);
    st.position.y = -0.2;
    arm.add(st);
  }
  const collar = k.cyl(0.15, 0.17, 0.1, 0x1a1a22, 12, 0.012);
  collar.position.y = 0.66;
  b.torsoInner.add(collar);
  const belt = k.cyl(0.31, 0.31, 0.07, 0x1a1a22, 16, 0.01);
  belt.position.y = 0.13;
  b.torsoInner.add(belt);
  for (const s of [-1, 1]) {
    const knee = k.cyl(0.125, 0.125, 0.08, white, 10, 0.01);
    knee.position.set(s * 0.16, -0.32, 0);
    b.legs.add(knee);
  }

  // Hair: cap, back mass, side-swept bangs, flowing strands.
  h.add(shell(b, 0.44, hairC, 0, Math.PI * 2, 0, 0.8, 1.06, 0.98, 0.97).translateY(0.5));
  h.add(shell(b, 0.445, hairC, Math.PI - 0.5, Math.PI + 1.0, 0, 2.3, 1.07, 0.99, 0.98).translateY(0.5));
  for (const [x, y, z, rz, sx] of [[0.2, 0.8, 0.27, -0.7, 1.3], [0.02, 0.84, 0.3, -0.45, 1.4], [-0.22, 0.78, 0.27, 0.5, 1.0]]) {
    const bang = k.ball(0.13, hairC, sx, 0.6, 0.55, 10);
    bang.position.set(x, y + 0.045, z - 0.02);
    bang.rotation.set(-0.5, 0, rz);
    h.add(bang);
  }
  const mane = k.ball(0.36, hairC, 1.1, 1.0, 0.8, 14);
  mane.position.set(0, 0.36, -0.2);
  h.add(mane);
  const strands: ReturnType<typeof strand>[] = [];
  const roots: [number, number, number, number][] = [
    [0, 0.62, -0.36, 0], [0.2, 0.6, -0.32, -0.35], [-0.2, 0.6, -0.32, 0.35], [0.33, 0.45, -0.18, -0.5], [-0.33, 0.45, -0.18, 0.5],
    [0.1, 0.4, -0.36, -0.12], [-0.1, 0.4, -0.36, 0.12],
    // Extra mane strands, grown in by the signature.
    [0.3, 0.7, -0.26, -0.7], [-0.3, 0.7, -0.26, 0.7], [0.12, 0.76, -0.3, -0.25], [-0.12, 0.76, -0.3, 0.25],
  ];
  const LEN = 0.22, EXTRA = 7;
  roots.forEach(([x, y, z, rz], i) =>
    strands.push(strand(b, h, { x, y, z }, {
      n: 7, len: LEN, r0: 0.19, r1: 0.11, wide: 2.1, color: i % 3 === 2 ? hairDark : hairC, rx: 0.15, rz: rz * 0.8, curl: 0.06, flat: 0.5,
      stiffness: 60, damping: 8, lag: 0.5,
    })),
  );

  // Sharp eyeliner wings + red glow.
  const liner = k.toon(0x1a0a12);
  const radial = k.canvas(32, 32, (g, w, hh) => {
    const gr = g.createRadialGradient(w / 2, hh / 2, 0, w / 2, hh / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.25, 'rgba(255,255,255,0.8)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.25)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, hh);
  }, true);
  const spriteMat = (color: number) =>
    k.own(new THREE.SpriteMaterial({ map: radial, color, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
  const glowGroups: THREE.Group[] = [];
  const glowMats: { m: THREE.SpriteMaterial; base: number }[] = [];
  const _ep = new THREE.Vector3(), _ef = new THREE.Vector3(), _q = new THREE.Quaternion();
  let glow = 0;
  b.eyes.forEach((eye, i) => {
    const s = i === 0 ? 1 : -1;
    const w = k.box(0.09, 0.022, 0.02, liner, 0);
    w.position.set(s * 0.115, 0.065, 0.035);
    w.rotation.z = s * 0.55;
    eye.add(w);
    for (let n = 0; n < 3; n++) {
      const lash = k.box(0.05 - n * 0.008, 0.014, 0.012, liner, 0);
      lash.position.set(s * (0.085 + n * 0.022), 0.085 - n * 0.022, 0.03);
      lash.rotation.z = s * (0.9 + n * 0.25);
      eye.add(lash);
    }
    const gg = new THREE.Group();
    gg.position.set(0, -0.005, 0.085);
    gg.visible = false;
    eye.add(gg);
    // [colour, base opacity, sx, sy]
    for (const [col, op, sx, sy] of [[0xff1a10, 0.6, 0.38, 0.32], [0xff5030, 0.8, 1.15, 0.04], [0xffffff, 1, 0.12, 0.09]] as const) {
      const m = spriteMat(col);
      glowMats.push({ m, base: op });
      const sp = new THREE.Sprite(m);
      sp.scale.set(sx, sy, 1);
      sp.renderOrder = 20;
      // Fade when the eye turns away from the camera (the sprites ignore depth).
      sp.onBeforeRender = (_r, _s, camera) => {
        eye.getWorldPosition(_ep);
        eye.getWorldQuaternion(_q);
        _ef.set(0, 0, 1).applyQuaternion(_q);
        const toCam = camera.getWorldPosition(new THREE.Vector3()).sub(_ep).normalize();
        const f = clamp((_ef.dot(toCam) - 0.05) / 0.35, 0, 1);
        m.opacity = op * f * clamp(glow * 1.4, 0, 1);
      };
      gg.add(sp);
    }
    glowGroups.push(gg);
  });

  // Mean face (setTurn(1) + setCold): straight blade brows (thick inner end, pointed outer end, no arch)
  // that replace the arched ones, and a thin one-sided sneer decal with a sliver of bared teeth.
  const fp = faceParts(b);
  const bladeMat = k.toon(0x6a0a12);
  const blades = fp.brows.map((bg, i) => {
    const s = i === 0 ? 1 : -1;
    const g = new THREE.SphereGeometry(1, 20, 10);
    const p = g.attributes.position;
    for (let n = 0; n < p.count; n++) {
      const x = p.getX(n), y = p.getY(n), z = p.getZ(n);
      const taper = clamp(0.78 - 0.5 * x * s, 0.18, 1.3); // inner end thick, outer end a point
      p.setXYZ(n, x * 0.13, y * 0.034 * taper - 0.008 * x * s, z * 0.045);
    }
    g.computeVertexNormals();
    const m = k.mesh(g, bladeMat, 0.016);
    m.rotation.x = -0.35;
    m.visible = false;
    bg.add(m);
    return m;
  });
  const sneer = new THREE.Group();
  {
    const dark = k.toon(0x2a0a12), teeth = k.toon(0xfffbef);
    const S = -1, mw = 0.15 * 0.86, n = 18; // hiked corner on her right (matches the jerk smirkR)
    const top: [number, number][] = [], bot: [number, number][] = [], tt: [number, number][] = [], tb: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const u = i / n, x = S * (u * 2 - 1) * mw;
      const y = -0.014 * (1 - u) ** 2 + 0.006 + 0.05 * u ** 2.6; // flat, a dip at the low corner, hooked up at the other
      const w = 0.0045 + 0.004 * Math.sin(Math.PI * u) + 0.008 * clamp((u - 0.55) / 0.35, 0, 1) * (u > 0.95 ? 0.4 : 1);
      top.push([x, y + w * 0.5]);
      bot.unshift([x, y - w]);
      if (u >= 0.55 && u <= 0.9) tt.push([x, y - 0.001]), tb.unshift([x, y - w * 0.85]);
    }
    sneer.add(b.chinDecal([...top, ...bot], dark, 0.004, -0.06));
    sneer.add(b.chinDecal([...tt, ...tb], teeth, 0.008, -0.06));
    // Hard crease at the hiked corner and a tiny down-tick at the low one.
    const cx = S * mw, cy = 0.056;
    sneer.add(b.chinDecal([[cx, cy], [cx + S * 0.035, cy + 0.04], [cx + S * 0.028, cy + 0.043], [cx - S * 0.006, cy + 0.006]], dark, 0.006, -0.06));
    const lx = -S * mw, ly = -0.008;
    sneer.add(b.chinDecal([[lx, ly + 0.004], [lx - S * 0.02, ly - 0.014], [lx - S * 0.014, ly - 0.017], [lx + S * 0.004, ly - 0.003]], dark, 0.006, -0.06));
  }
  sneer.visible = false;
  b.jawInner.add(sneer);

  // Helmet (on by default; take it off with props.helmet.visible / reparenting).
  const helmet = new THREE.Group();
  helmet.position.y = 0.5;
  h.add(helmet);
  const hw = k.ball(0.53, white, 1.04, 1.02, 1.06, 18);
  helmet.add(hw);
  const stripe = k.mesh(new THREE.SphereGeometry(0.535, 18, 12, 0, Math.PI * 2, 0.95, 0.22).scale(1.04, 1.02, 1.06), k.toon(0xd81e2a, { side: THREE.DoubleSide }), 0);
  helmet.add(stripe);
  const crest = k.box(0.12, 0.08, 0.95, 0xd81e2a, 0.014);
  crest.position.y = 0.53;
  helmet.add(crest);
  const visor = new THREE.Group();
  helmet.add(visor);
  const vm = k.mesh(new THREE.SphereGeometry(0.55, 18, 8, Math.PI / 2 - 1.0, 2.0, 1.2, 0.55).scale(1.04, 1.02, 1.06), k.toon(0x161a30, { side: THREE.DoubleSide }), 0.016);
  visor.add(vm);
  const vg = k.box(0.05, 0.16, 0.01, 0xbfd4ff, 0);
  vg.position.set(0.18, -0.06, 0.56);
  vg.rotation.set(0, 0.3, -0.6);
  visor.add(vg);
  // Chin guard: white, part of the helmet group, with a dark vent (no loose black bar over the face).
  const chin = new THREE.Group();
  chin.position.set(0, -0.36, 0.3);
  helmet.add(chin);
  const guard = k.ball(0.3, white, 1.15, 0.45, 0.75, 14);
  chin.add(guard);
  const vent = k.box(0.22, 0.035, 0.04, 0x1a1a22, 0);
  vent.position.set(0, -0.01, 0.22);
  chin.add(vent);

  b.props.helmet = helmet;
  b.props.chinBar = chin;
  b.props.eyeGlowL = glowGroups[0];
  b.props.eyeGlowR = glowGroups[1];
  b.props.visor = visor;
  b.props.hair = mane;

  let glowManual = false, glowT = 0, coldT = 0, cold = 0, liftManual = false, liftT = 0, lift = 0;
  const H0 = helmet.position.clone();
  const rig = finish(b, (c) => {
    const { sig, face, dt } = c;
    if (c.turnOn) {
      // Jerk: dead still, square to the camera, leaning in; no idle sway.
      const j = c.turn;
      b.torsoInner.rotation.z *= 1 - j;
      b.torsoInner.rotation.x += 0.04 * j;
      b.armInnerL.rotation.x *= 1 - j;
      b.armInnerR.rotation.x *= 1 - j;
      c.lookAdd.y += 0.55 * j; // glaring up from under the brows
    }
    glow = glowManual ? damp(glow, glowT, 30, c.bdt) : damp(glow, sig, 6, dt);
    cold = damp(cold, coldT, 14, c.bdt);
    lift = damp(lift, liftT, 14, c.bdt);
    // Cold glare under the signature: brows hard down, lids narrowed.
    face.browRot[0] += 0.35 * sig;
    face.browRot[1] += 0.35 * sig;
    face.browY[0] -= 0.02 * sig;
    face.browY[1] -= 0.02 * sig;
    face.lid[0] = Math.max(face.lid[0], 0.35 * sig);
    face.lid[1] = Math.max(face.lid[1], 0.35 * sig);
    face.pupil = face.pupil * (1 - sig) + 0.85 * sig;
    if (cold > 0.001) {
      // Flat, cold, narrowed: level heavy lids, low flat brows, mouth shut, chin a touch down.
      for (let i = 0; i < 2; i++) {
        face.lid[i] += (0.48 - face.lid[i]) * cold;
        face.lidTilt[i] += (-0.08 - face.lidTilt[i]) * cold;
        face.browRot[i] += (0.18 - face.browRot[i]) * cold;
        face.browY[i] += (-0.03 - face.browY[i]) * cold;
        face.eye[i] += (1 - face.eye[i]) * cold;
      }
      face.pupil += (0.8 - face.pupil) * cold;
      face.jaw *= 1 - cold;
      face.jawRoll *= 1 - cold;
      face.headX += 0.05 * cold;
      if (cold > 0.5) face.mouth = 'line';
    }
    // Mean: the cold stare on top of the jerk turn. Hard, narrowed and contemptuous, chin down.
    const mean = c.turnOn ? clamp(c.turn * cold * 1.25 - 0.1, 0, 1) : 0;
    if (mean > 0.001) {
      for (let i = 0; i < 2; i++) {
        face.lid[i] += (0.58 - face.lid[i]) * mean;
        face.lidTilt[i] += (-0.32 - face.lidTilt[i]) * mean;
        face.lidLo[i] += (0.3 - face.lidLo[i]) * mean;
        face.browRot[i] += ((i === 0 ? 0.62 : 0.72) - face.browRot[i]) * mean;
        face.browY[i] += ((i === 0 ? -0.05 : -0.065) - face.browY[i]) * mean;
        face.eye[i] += ((i === 0 ? 0.88 : 0.86) - face.eye[i]) * mean;
      }
      face.pupil += (0.6 - face.pupil) * mean;
      face.headX += 0.12 * mean;
      face.headZ += (-0.06 - face.headZ) * mean;
      face.sparkle *= 1 - mean;
      face.blush *= 1 - mean;
    }
    const meanOn = mean > 0.5;
    for (let i = 0; i < 2; i++) {
      blades[i].visible = meanOn;
      fp.brows[i].children[0].visible = !meanOn;
    }
    sneer.visible = meanOn && face.jaw <= 0.1;
    if (meanOn) face.mouth = 'none';
    // Helmet lift: straight up and back first (clears the face), then away; hidden at the end.
    if (liftManual) {
      const e = lift * lift * (3 - 2 * lift);
      helmet.position.set(H0.x + 0.3 * Math.max(0, e - 0.5), H0.y + 1.25 * e, H0.z - 0.45 * e);
      helmet.rotation.set(-0.7 * e, 0, 0.25 * e);
      helmet.visible = lift < 0.985;
      chin.visible = lift < 0.04;
    }
    const helmetOn = helmet.visible && !(liftManual && lift > 0.35);
    for (const ir of b.irises) {
      const m = ir.material as THREE.MeshToonMaterial;
      m.emissive.setHex(0xff2020);
      m.emissiveIntensity = Math.max(glow * 2, c.turnOn ? 0.45 * c.turn : 0);
    }
    for (const g of glowGroups) {
      g.visible = glow > 0.03 && !helmetOn;
      const sc = 0.75 + 0.35 * glow;
      g.scale.set(sc, sc, 1);
    }
    // Hair streams back in the wind of her own aura; the mane grows with the signature.
    const free = helmetOn ? 0.5 : 1;
    const grow = 1 + 0.6 * sig;
    strands.forEach((s, i) => {
      const spread = roots[i][3];
      const up = clamp((roots[i][1] - 0.4) / 0.36, 0, 1); // higher roots stream up, lower ones droop: a fanned mane
      s.wind.set(Math.sign(spread) * Math.min(0.6, Math.abs(spread)) * 0.45 * sig * free, (0.3 + sig * (0.55 + 0.6 * up)) * free);
      s.gust = 0.25 + sig * 0.5;
      s.freq = 1.4 + sig * 1.4;
      s.joints.forEach((j, n) => {
        if (n > 0) j.position.y = -LEN * grow;
        const m = j.children[0];
        m.scale.y = grow;
        m.position.y = (-LEN * grow) / 2;
      });
      if (i >= EXTRA) {
        const g = clamp((sig - 0.15) * 2, 0, 1);
        s.joints[0].visible = g > 0.01;
        s.joints[0].scale.setScalar(Math.max(0.01, g));
      }
    });
  });
  return Object.assign(rig, {
    setEyeGlow(v: number, snap = false) {
      glowManual = true;
      glowT = clamp(v, 0, 1);
      if (snap) glow = glowT;
    },
    setCold(v: number) {
      coldT = clamp(v, 0, 1);
    },
    liftHelmet(v: number) {
      liftManual = true;
      liftT = clamp(v, 0, 1);
    },
  });
}
