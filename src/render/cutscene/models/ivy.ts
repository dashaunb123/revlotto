// Iron Vise Ivy (final boss): a hulking, swaggering metalworker and arm-wrestling champ. Massive bare arms and
// traps, a ribbed tank top smeared with oil, a buzzcut with orange streaks, a hex-nut earring, a scar through her
// brow, a welding mask flipped up on her head, and one GIANT hydraulic bench-vise gauntlet on her right arm (a
// gunmetal sleeve with a pressure gauge, a sliding jaw on twin hydraulic rams, a big screw with a spinning T-bar).
// Extra controls (all instant; the scene animates them):
//   setVise(k 0..1)    0 = jaws wide open, 1 = clamped shut. The rams slide out, the T-bar spins, the gauge
//                      needle climbs into the red. props.viseGrip sits centred between the jaw faces (re-centred
//                      every frame): parent the thing being crushed there, its +X across the jaws.
//   viseGap()          the current gap between the jaw faces (character-local metres).
//   setHeat(k 0..1)    the jaw faces glow orange-hot.
//   setMask(k 0..1)    welding mask: 0 = flipped up on her head, 1 = down over the face.
//   setFlex(k 0..1)    the arms pump up (biceps, delts and forearms swell). setSignature drives it too.
//   setMouth(m | null) forces a mouth decal (e.g. 'grin', 'teeth') over whatever the face says.
//   setArmBend(side, x, z) extra elbow bend (radians) on top of the rig's pose; z swings the forearm sideways.
// setTurn(1) gives her jerk face: heavy lids, brows hammered down, chin up, a crooked one-sided sneer.
import * as THREE from 'three';
import { buildBase, faceParts, finish, type CharacterRigX, type Mouth } from './character';
import { clamp } from './kit';
import { band, shell } from './parts';

export interface IvyRig extends CharacterRigX {
  setVise(k: number): void;
  viseGap(): number;
  setHeat(k: number): void;
  setMask(k: number): void;
  setFlex(k: number): void;
  setMouth(m: Mouth | null): void;
  setArmBend(side: 'L' | 'R', x: number, z?: number): void;
}

const SKIN = 0xd99468;
const STEEL = 0x4b4f58;
const ORANGE = 0xff8a1f;

/** Jaw gap (character-local metres) fully open / clamped. */
export const VISE_OPEN = 0.6;
export const VISE_SHUT = 0.035;

export function buildIvy(): IvyRig {
  const b = buildBase({
    skin: SKIN, shirt: 0xf1ece0, sleeve: SKIN, pants: 0x2b3444, shoes: 0x1a1a1e, brow: 0x24140e, iris: ORANGE, lid: 0xb4724e,
    nose: 'button', jawW: 1.08, chestW: 1.55, chestD: 1.25, headScale: 0.94, browScale: 1.25, blush: 0xe06a50,
    jerk: {
      lid: [0.44, 0.36], lidLo: [0.26, 0.22], lidTilt: [-0.2, -0.08], browRot: [0.62, 0.42], browY: [-0.045, -0.02], eye: [0.96, 1.02],
      pupil: 0.78, headX: -0.14, headZ: -0.06, jawRoll: 0.06, mouth: 'sneerR',
    },
  });
  const k = b.kit, h = b.headInner, T = b.torsoInner;
  const skin = b.skinMat;
  const steel = k.toon(STEEL, { gloss: 0.75, shine: 70 });
  const steelD = k.toon(0x2a2d34, { gloss: 0.6, shine: 60 });
  const chrome = k.toon(0xe2e7ee, { gloss: 1, shine: 110 });
  const orange = k.toon(ORANGE, { gloss: 0.8, shine: 80 });
  const ink = k.toon(0x16141a, { gloss: 0.2 });
  const oil = k.toon(0x1c1a20, { gloss: 0.9, shine: 120 });
  const spec = k.own(new THREE.MeshBasicMaterial({ color: 0xffffff }));

  // ---------- body: tank top, traps, oil smears ----------
  // A scooped neckline: bare upper chest above the tank top, two straps over the traps.
  const yoke = k.ball(0.3, skin, 1.4, 0.4, 0.85, 18);
  yoke.position.set(0, 0.6, 0.06);
  T.add(yoke);
  const traps = k.ball(0.2, skin, 2.1, 0.5, 0.95, 18);
  traps.position.set(0, 0.64, -0.1);
  T.add(traps);
  // pecs under the tank top
  for (const s of [-1, 1]) {
    const pec = k.ball(0.17, 0xf1ece0, 1.15, 0.78, 0.7, 18);
    pec.position.set(s * 0.17, 0.5, 0.17);
    T.add(pec);
  }
  // ribs on the tank top
  const rib = k.toon(0xd8d2c2);
  for (let i = 0; i < 5; i++) {
    const r = k.box(0.012, 0.36, 0.01, rib, 0);
    const x = -0.24 + i * 0.12;
    r.position.set(x, 0.33, 0.27 * Math.sqrt(Math.max(0.1, 1 - (x / 0.53) ** 2)) + 0.012);
    r.rotation.y = Math.atan2(x, 0.4);
    T.add(r);
  }
  // oil smears (tank top + one on her cheek, below)
  const smear = k.toon(0x6a5a52, { gloss: 0.3 });
  for (const [x, y, sx, sy, rz] of [[0.3, 0.3, 2.2, 0.45, -0.6], [-0.2, 0.18, 1.8, 0.4, 0.4]] as const) {
    const sm = k.ball(0.045, smear, sx, sy, 0.3, 10, 0);
    const z = 0.34 * 1.025 * Math.sqrt(Math.max(0.05, 1 - (x / (0.34 * 1.55)) ** 2 - ((y - 0.38) / 0.34) ** 2));
    sm.position.set(x, y, z + 0.005);
    sm.rotation.set(0, Math.atan2(x, 0.5), rz);
    T.add(sm);
  }
  // work belt: thick, with a big orange buckle
  const belt = k.cyl(0.33, 0.33, 0.08, 0x2a1c14, 18, 0.012);
  belt.scale.set(1.5, 1, 1.15);
  belt.position.y = 0.1;
  T.add(belt);
  const buckle = k.box(0.14, 0.1, 0.04, orange, 0.012);
  buckle.position.set(0, 0.1, 0.39);
  T.add(buckle);

  // ---------- arms: HUGE ----------
  const delts: THREE.Mesh[] = [], bis: THREE.Mesh[] = [], fores: THREE.Mesh[] = [];
  for (const [s, inner, elbow] of [[1, b.armInnerL, b.elbowL], [-1, b.armInnerR, b.elbowR]] as const) {
    const delt = k.ball(0.2, skin, 1.05, 1, 1, 18);
    delt.position.set(s * 0.03, 0.0, 0);
    inner.add(delt);
    delts.push(delt);
    const bi = k.ball(0.16, skin, 1.0, 1.35, 1.08, 18);
    bi.position.set(0, -0.19, 0.03);
    inner.add(bi);
    bis.push(bi);
    if (s === 1) {
      const fore = k.ball(0.14, skin, 1.0, 1.45, 1.0, 18);
      fore.position.set(0, -0.13, 0);
      elbow.add(fore);
      fores.push(fore);
      // a leather wrist wrap
      const wrap = k.cyl(0.1, 0.1, 0.09, 0x3a2418, 14, 0.012);
      wrap.position.y = -0.265;
      elbow.add(wrap);
    }
  }
  // a gear tattoo on her left bicep
  {
    const tat = new THREE.Group();
    tat.position.set(0.085, -0.17, 0.14);
    tat.rotation.set(0, 0.55, 0);
    bis[0].add(tat);
    const tm = k.toon(0x2a4a6a, { gloss: 0 });
    const ring = k.mesh(new THREE.TorusGeometry(0.045, 0.013, 5, 16), tm, 0);
    tat.add(ring);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const tooth = k.box(0.022, 0.022, 0.004, tm, 0);
      tooth.position.set(Math.cos(a) * 0.062, Math.sin(a) * 0.062, 0);
      tooth.rotation.z = a;
      tat.add(tooth);
    }
  }
  b.handL.scale.setScalar(1.45);
  b.handR.visible = false; // the vise replaces it

  // ---------- the vise gauntlet (right arm, elbow space: forearm runs down -Y, jaws clamp along X) ----------
  const G = new THREE.Group();
  b.elbowR.add(G);
  const elbowCap = k.ball(0.13, steel, 1, 1, 1, 16);
  G.add(elbowCap);
  const sleeve = k.cyl(0.16, 0.18, 0.36, steel, 18, 0.02);
  sleeve.position.y = -0.18;
  G.add(sleeve);
  for (const [y, r] of [[-0.03, 0.165], [-0.33, 0.185]] as const) {
    const bandM = k.cyl(r, r, 0.06, orange, 18, 0.012);
    bandM.position.y = y;
    G.add(bandM);
    // hazard ticks
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const tick = k.box(0.025, 0.065, 0.02, ink, 0);
      tick.position.set(Math.sin(a) * (r + 0.004), y, Math.cos(a) * (r + 0.004));
      tick.rotation.set(0, a, 0.6);
      G.add(tick);
    }
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const bolt = k.ball(0.022, chrome, 1, 1, 0.6, 8, 0.008);
    bolt.position.set(Math.sin(a) * 0.172, -0.25, Math.cos(a) * 0.172);
    bolt.rotation.y = a;
    G.add(bolt);
  }
  const sGlint = k.box(0.02, 0.26, 0.01, spec, 0);
  sGlint.position.set(-0.07, -0.17, 0.155);
  sGlint.rotation.y = -0.4;
  G.add(sGlint);
  // pressure gauge on the front of the sleeve
  const gauge = new THREE.Group();
  gauge.position.set(0.0, -0.17, 0.17);
  G.add(gauge);
  const gRim = k.cyl(0.07, 0.07, 0.04, chrome, 18, 0.012);
  gRim.rotation.x = Math.PI / 2;
  gauge.add(gRim);
  const gFace = k.cyl(0.058, 0.058, 0.01, 0xf4f0e6, 18, 0);
  gFace.rotation.x = Math.PI / 2;
  gFace.position.z = 0.02;
  gauge.add(gFace);
  const gRed = k.mesh(new THREE.RingGeometry(0.036, 0.054, 12, 1, -0.75, 0.9), k.toon(0xe0281e, { gloss: 0 }), 0);
  gRed.position.z = 0.026;
  gauge.add(gRed);
  const needle = new THREE.Group();
  needle.position.z = 0.03;
  gauge.add(needle);
  const nm = k.box(0.008, 0.05, 0.004, 0xd01010, 0);
  nm.position.y = 0.022;
  needle.add(nm);
  const hub = k.cyl(0.01, 0.01, 0.01, ink, 10, 0);
  hub.rotation.x = Math.PI / 2;
  needle.add(hub);

  // vise head: base block + rail, fixed jaw (inner, +X), moving jaw (outer, -X) on rams, screw + T-bar
  const head = new THREE.Group();
  head.position.y = -0.4;
  G.add(head);
  const block = k.box(0.86, 0.13, 0.32, steelD, 0.02);
  block.position.set(-0.13, -0.02, 0);
  head.add(block);
  const blockTop = k.box(0.86, 0.02, 0.33, orange, 0);
  blockTop.position.set(-0.13, 0.045, 0);
  head.add(blockTop);
  const rail = k.box(0.92, 0.05, 0.12, chrome, 0.012);
  rail.position.set(-0.13, -0.1, 0);
  head.add(rail);
  const JY = -0.24; // jaw centre height (head space)
  const JH = 0.34, JD = 0.3, JW = 0.1;
  const XF = 0.18; // fixed jaw face x
  const faceHeat = k.toonUnique(0x8a8f99, { gloss: 0.9, shine: 90, emissive: 0xff6a10, emissiveIntensity: 0 });
  const mkJaw = (dir: number) => {
    // dir = +1: body extends to +X from the face (fixed jaw); -1: to -X (moving jaw)
    const g = new THREE.Group();
    const body = k.box(JW, JH, JD, orange, 0.02);
    body.position.set(dir * (JW / 2 + 0.025), 0, 0);
    g.add(body);
    const cap = k.box(JW + 0.02, 0.05, JD + 0.02, steel, 0.012);
    cap.position.set(dir * (JW / 2 + 0.025), JH / 2 + 0.02, 0);
    g.add(cap);
    const plate = k.box(0.03, JH - 0.03, JD - 0.02, faceHeat, 0.012);
    plate.position.set(dir * 0.012, 0, 0);
    g.add(plate);
    // knurled grooves on the face
    for (let i = 0; i < 7; i++) {
      const gr = k.box(0.006, 0.012, JD - 0.04, ink, 0);
      gr.position.set(-dir * 0.004, -JH / 2 + 0.04 + i * ((JH - 0.08) / 6), 0);
      g.add(gr);
    }
    const gl = k.box(0.012, JH * 0.7, 0.012, spec, 0);
    gl.position.set(dir * (JW + 0.02), 0.02, JD / 2 + 0.002);
    g.add(gl);
    return g;
  };
  const fixedJaw = mkJaw(1);
  fixedJaw.position.set(XF, JY, 0);
  head.add(fixedJaw);
  const moveJaw = mkJaw(-1);
  head.add(moveJaw);
  // hydraulic rams: housings bolted to the outer end of the block, chrome rods out of the moving jaw
  const HX0 = -0.58, HX1 = -0.9;
  const rods: THREE.Mesh[] = [];
  for (const z of [-0.11, 0.11]) {
    const hous = k.mesh(new THREE.CylinderGeometry(0.045, 0.045, HX0 - HX1, 14).rotateZ(Math.PI / 2), steel, 0.014);
    hous.position.set((HX0 + HX1) / 2, -0.1, z);
    head.add(hous);
    const capR = k.mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.04, 14).rotateZ(Math.PI / 2), orange, 0.012);
    capR.position.set(HX1, -0.1, z);
    head.add(capR);
    const rod = k.mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.32, 12).rotateZ(Math.PI / 2), chrome, 0.01);
    rod.position.set(-0.16 - 0.025, -0.1 - JY, z); // in moving-jaw space: out of its back face
    moveJaw.add(rod);
    rods.push(rod);
  }
  const steamL = new THREE.Object3D();
  steamL.position.set(HX1 - 0.03, -0.1, 0);
  head.add(steamL);
  // screw + T-bar out of the moving jaw's back
  const screw = k.mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.42, 12).rotateZ(Math.PI / 2), chrome, 0.01);
  screw.position.set(-0.155 - 0.21, 0.02, 0);
  moveJaw.add(screw);
  for (let i = 0; i < 8; i++) {
    const th = k.mesh(new THREE.TorusGeometry(0.033, 0.007, 4, 10).rotateY(Math.PI / 2), steelD, 0);
    th.position.set(-0.19 - i * 0.045, 0.02, 0);
    moveJaw.add(th);
  }
  const tbar = new THREE.Group();
  tbar.position.set(-0.6, 0.02, 0);
  moveJaw.add(tbar);
  const tHub = k.ball(0.05, steel, 1, 1, 1, 12);
  tbar.add(tHub);
  const tRod = k.cyl(0.022, 0.022, 0.5, chrome, 10, 0.01);
  tRod.rotation.x = Math.PI / 2;
  tbar.add(tRod);
  for (const z of [-0.26, 0.26]) {
    const knob = k.ball(0.045, orange, 1, 1, 1, 12);
    knob.position.z = z;
    tbar.add(knob);
  }
  const viseGrip = new THREE.Object3D();
  head.add(viseGrip);

  // ---------- head: buzzcut with orange streaks, welding mask, earring, scar, oil on the cheek ----------
  const buzz = k.toon(0x2e1c16, { side: THREE.DoubleSide, gloss: 0.1 });
  // hairline high above the brows at the front, down to the nape at the back and sides
  h.add(shell(b, 0.44, buzz, 0, Math.PI * 2, 0, 0.62, 1.06, 0.97, 0.98).translateY(0.5));
  h.add(shell(b, 0.441, buzz, Math.PI - 0.55, Math.PI + 1.1, 0.5, 1.15, 1.06, 0.97, 0.98).translateY(0.5));
  const streak = k.toon(ORANGE, { side: THREE.DoubleSide, gloss: 0.3 });
  for (const [ph, w, th0, th1] of [[Math.PI / 2 - 0.3, 0.16, 0.05, 0.62], [Math.PI / 2 + 0.25, 0.12, 0.12, 0.6], [0.05, 0.14, 0.35, 1.15], [Math.PI - 0.05, 0.14, 0.35, 1.15]] as const) {
    const m = k.mesh(new THREE.SphereGeometry(0.446, 10, 8, ph - w / 2, w, th0, th1 - th0).scale(1.06, 0.97, 0.98), streak, 0);
    m.position.y = 0.5;
    h.add(m);
  }
  // hex-nut earring (her left ear)
  const nut = new THREE.Group();
  nut.position.set(0.455, 0.36, 0.0);
  h.add(nut);
  const nutM = k.mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.026, 6).rotateZ(Math.PI / 2), chrome, 0.008);
  nut.add(nutM);
  const nutHole = k.mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 10).rotateZ(Math.PI / 2), ink, 0);
  nut.add(nutHole);
  const loop = k.mesh(new THREE.TorusGeometry(0.02, 0.005, 4, 10).rotateY(Math.PI / 2), chrome, 0);
  loop.position.y = 0.05;
  nut.add(loop);
  // oil smear on her right cheek
  const cs = k.ball(0.05, oil, 1.5, 0.5, 0.3, 10, 0);
  cs.position.set(-0.03, 0.03, 0.105);
  cs.rotation.set(0, -0.2, 0.35);
  b.cheeks[1].add(cs);
  // scar through her left brow
  const fp = faceParts(b);
  const scar = k.box(0.018, 0.09, 0.03, k.toon(0xe8a888), 0);
  scar.position.set(0.035, 0.0, 0.03);
  scar.rotation.z = 0.25;
  fp.brows[0].add(scar);

  // welding mask on a temple hinge (pivot at the head centre: it swings over the skull)
  const maskPiv = new THREE.Group();
  maskPiv.position.y = 0.5;
  h.add(maskPiv);
  h.add(band(b, 0.87, 0x1e1e24, 0.05, 0.27, 0));
  for (const s of [-1, 1]) {
    const hinge = k.cyl(0.06, 0.06, 0.05, steel, 14, 0.012);
    hinge.rotation.z = Math.PI / 2;
    hinge.position.set(s * 0.47, 0.62, -0.02);
    h.add(hinge);
    const hc = k.cyl(0.035, 0.035, 0.06, orange, 10, 0);
    hc.rotation.z = Math.PI / 2;
    hc.position.set(s * 0.475, 0.62, -0.02);
    h.add(hc);
  }
  const maskMat = k.toon(0x3a3e46, { side: THREE.DoubleSide, gloss: 0.7, shine: 70 });
  const shield = k.mesh(new THREE.SphereGeometry(0.53, 22, 14, Math.PI / 2 - 1.15, 2.3, 0.55, 1.35).scale(1.04, 1.06, 1.12), maskMat, 0.02);
  maskPiv.add(shield);
  // closed outline hull for the open shell is unnecessary: the 0.02 hull follows its shape
  const lens = new THREE.Group();
  lens.position.set(0, 0.08, 0.565);
  lens.rotation.x = -0.12;
  maskPiv.add(lens);
  const lensFrame = k.box(0.42, 0.17, 0.05, steelD, 0.014);
  lens.add(lensFrame);
  const lensGlass = k.box(0.36, 0.11, 0.02, k.toon(0x16301e, { gloss: 1, shine: 120 }), 0);
  lensGlass.position.z = 0.026;
  lens.add(lensGlass);
  const lg = k.box(0.03, 0.09, 0.01, spec, 0);
  lg.position.set(0.11, 0.0, 0.04);
  lg.rotation.z = -0.5;
  lens.add(lg);
  // orange flames painted up the mask
  // a hazard stripe across the brow of the mask, above the lens
  {
    const st = k.mesh(new THREE.SphereGeometry(0.538, 22, 4, Math.PI / 2 - 0.9, 1.8, 0.78, 0.09).scale(1.04, 1.06, 1.12), k.toon(ORANGE, { side: THREE.DoubleSide, gloss: 0.8 }), 0);
    maskPiv.add(st);
  }

  b.props.mask = maskPiv;
  b.props.gauntlet = G;
  b.props.vise = head;
  b.props.viseGrip = viseGrip;
  b.props.viseJaw = moveJaw;
  b.props.viseSteam = steamL;
  b.props.gauge = gauge;
  b.props.earring = nut;

  let vise = 0, heat = 0, mask = 0, flex = 0, mouthO: Mouth | null = null;
  const bend = { L: [0, 0], R: [0, 0] };
  const gap = () => VISE_OPEN + (VISE_SHUT - VISE_OPEN) * vise;
  const rig = finish(b, (c) => {
    const { t, face, sig } = c;
    // jaws, rams, screw, gauge
    const xm = XF - gap();
    moveJaw.position.set(xm, JY, 0);
    tbar.rotation.x = -vise * Math.PI * 7;
    viseGrip.position.set((XF + xm) / 2, JY, 0);
    for (const r of rods) r.visible = true;
    needle.rotation.z = 2.2 - vise * 3.1 + (vise > 0.9 ? Math.sin(t * 60) * 0.06 : 0);
    faceHeat.emissiveIntensity = 0.55 * heat;
    // mask: 0 up (flipped back over the skull), 1 down over the face
    maskPiv.rotation.x = -1.42 * (1 - mask);
    // pump: the arms swell
    const f = Math.max(flex, sig);
    for (const d of delts) d.scale.setScalar(1 + 0.18 * f);
    for (const bi of bis) bi.scale.set(1 + 0.32 * f, 1 + 0.22 * f, 1 + 0.38 * f);
    for (const fo of fores) fo.scale.set(1 + 0.2 * f, 1 + 0.1 * f, 1 + 0.2 * f);
    // swagger: shoulders rolled forward, chest out; brows always hammered down a notch
    T.rotation.x += 0.05;
    if (mouthO) face.mouth = mouthO;
    // extra elbow bend
    b.elbowL.rotation.x -= bend.L[0];
    b.elbowL.rotation.z += bend.L[1];
    b.elbowR.rotation.x -= bend.R[0];
    b.elbowR.rotation.z += bend.R[1];
  }, { height: 2.3 });
  return Object.assign(rig, {
    setVise(v: number) {
      vise = clamp(v, 0, 1);
    },
    viseGap: () => gap(),
    setHeat(v: number) {
      heat = clamp(v, 0, 1);
    },
    setMask(v: number) {
      mask = clamp(v, 0, 1);
    },
    setFlex(v: number) {
      flex = clamp(v, 0, 1);
    },
    setMouth(m: Mouth | null) {
      mouthO = m;
    },
    setArmBend(side: 'L' | 'R', x: number, z = 0) {
      bend[side][0] = x;
      bend[side][1] = z;
    },
  });
}
