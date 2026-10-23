// Baron von Redline (final boss): old-money vampire aristocrat. Pale lilac skin, slicked black hair with a
// widow's peak and silver temples, pointed ears, one cartoon fang, red eyes, a gold monocle on a dangling chain,
// an ENORMOUS waxed handlebar moustache that curls into spirals past his ears, a red officer's tunic with gold
// epaulettes and buttons, a royal-blue sash with a jewelled star, a row of medals, white racing gloves, black
// riding boots and a towering high-collared black cape lined in red. Built to STAND (on his red carpet).
// Extra controls:
//   setPeer(k 0..1)      leans the monocle eye in: that eye balloons behind the lens (magnified), its brow
//                        shoots up, the other eye squints shut. The "looking you up and down" gag.
//   setSneer(k 0..1)     maximum contempt: chin way up, lids low and level, nostril sneer, fang out.
//   setSnarl(k 0..1)     the duel face: teeth bared, brows slammed down, eyes wide with tiny pupils.
//   setCape(k 0..1)      the cape flares out and back like bat wings (0 = hanging). Ripples on its own.
//   setBare(k 0|1)       his RIGHT glove is off (bare pale hand) once >= 0.5.
//   setReach(side, target, k, bend?)  blends that arm toward putting the palm on target (a world-space object,
//                        re-read every frame) by k; cartoon-stretches up to 1.6x. side 1 = his left, -1 = right.
// setSignature: the moustache twirl: the tips spin their curls and the whole moustache bristles up.
// setTurn(1) is his permanent face (he has no sweet side): heavy-lidded contempt, one brow arched, chin up.
import * as THREE from 'three';
import { buildBase, faceParts, finish, reach, type CharacterRigX } from './character';
import { clamp, damp } from './kit';
import { shell, strand } from './parts';

export interface BaronRig extends CharacterRigX {
  setPeer(k: number): void;
  setSneer(k: number): void;
  setSnarl(k: number): void;
  setCape(k: number): void;
  setBare(k: number): void;
  setReach(side: 1 | -1, target: THREE.Object3D | null, k: number, bend?: number): void;
}

/** Tapered tube along a smooth curve through `pts`; radius r(u) for u = 0..1 along it. Own outline shell. */
function taperTube(pts: THREE.Vector3[], r: (u: number) => number, n = 40, radial = 10) {
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const make = (extra: number) => {
    const g = new THREE.TubeGeometry(curve, n, 1, radial, false);
    const p = g.attributes.position;
    const c = new THREE.Vector3(), v = new THREE.Vector3();
    for (let i = 0; i <= n; i++) {
      const u = i / n;
      curve.getPointAt(u, c);
      const rr = r(u) + extra;
      for (let j = 0; j <= radial; j++) {
        const k = i * (radial + 1) + j;
        v.set(p.getX(k), p.getY(k), p.getZ(k)).sub(c).multiplyScalar(rr).add(c);
        p.setXYZ(k, v.x, v.y, v.z);
      }
    }
    g.computeVertexNormals();
    g.userData.lowPoly = true;
    return g;
  };
  return { curve, make };
}

/** An n-ring tube (no caps) whose rings setTube() places along a polyline every frame. */
function tubeGeo(n: number, radial: number) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * (radial + 1) * 3), 3));
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j, b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  g.setIndex(idx);
  g.userData = { lowPoly: true, radial };
  return g;
}
const _T = new THREE.Vector3(), _N = new THREE.Vector3(), _B = new THREE.Vector3(), _UP = new THREE.Vector3(0, 1, 0);
function setTube(g: THREE.BufferGeometry, pts: THREE.Vector3[], r: number) {
  const radial = g.userData.radial as number;
  const p = g.attributes.position as THREE.BufferAttribute;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    _T.subVectors(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize();
    _N.crossVectors(_T, _UP);
    if (_N.lengthSq() < 1e-6) _N.set(1, 0, 0);
    _N.normalize();
    _B.crossVectors(_T, _N).normalize();
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2, ca = Math.cos(a) * r, sa = Math.sin(a) * r;
      p.setXYZ(i * (radial + 1) + j, pts[i].x + _N.x * ca + _B.x * sa, pts[i].y + _N.y * ca + _B.y * sa, pts[i].z + _N.z * ca + _B.z * sa);
    }
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
}

export function buildBaron(): BaronRig {
  const SKIN = 0xe4d8f0;
  const b = buildBase({
    skin: SKIN, shirt: 0x9c0f22, sleeve: 0x9c0f22, pants: 0x1c1420, shoes: 0x141018, hands: 0xfbfaf6, brow: 0x16101c, iris: 0xe0102a,
    lid: 0xc8b8dc, nose: 'sharp', jawW: 0.92, chestW: 1.08, chestD: 1.05, headScale: 1.0, browScale: 1.05,
    jerk: {
      lid: [0.5, 0.36], lidLo: [0.2, 0.14], lidTilt: [-0.05, -0.12], browRot: [0.05, -0.32], browY: [-0.01, 0.05], eye: [0.96, 1.04],
      pupil: 0.72, headX: -0.2, headZ: 0.05, jawRoll: 0.04, mouth: 'smirkR',
    },
  });
  const k = b.kit, h = b.headInner;
  const fp = faceParts(b);
  const gold = k.toon(0xf2c230, { gloss: 0.9, shine: 90 });
  const goldDark = k.toon(0xb8841a, { gloss: 0.7 });
  const black = k.toon(0x17111c, { gloss: 0.25 });
  const capeIn = k.toon(0xc8102a, { side: THREE.BackSide, gloss: 0.55, shine: 60 });
  const capeOut = k.toon(0x1a1220, { side: THREE.FrontSide, gloss: 0.35 });
  const ink = b.kit.outlineMat;

  // ---------- head: hair, ears, moustache, monocle, fang ----------
  const hairM = k.toon(0x120c18, { side: THREE.DoubleSide, gloss: 0.9, shine: 70 });
  const silver = k.toon(0xc8c8d8, { gloss: 0.6 });
  // Slicked-back cap that sits high on the forehead, plus the back of the head.
  h.add(shell(b, 0.452, hairM, 0, Math.PI * 2, 0, 0.78, 1.07, 0.99, 0.98).translateY(0.5));
  h.add(shell(b, 0.456, hairM, Math.PI - 0.62, Math.PI + 1.24, 0, 2.15, 1.07, 0.99, 0.98).translateY(0.5));
  // Widow's peak: a sharp V of hair dipping down the forehead.
  {
    const s = new THREE.Shape();
    s.moveTo(-0.2, 0.06);
    s.quadraticCurveTo(-0.08, 0.0, 0, -0.12);
    s.quadraticCurveTo(0.08, 0.0, 0.2, 0.06);
    s.lineTo(0.2, 0.14);
    s.lineTo(-0.2, 0.14);
    const g = new THREE.ShapeGeometry(s, 8);
    // wrap onto the forehead
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i) + 0.82;
      const u = x / (0.452 * 1.07), v = (y - 0.5) / (0.452 * 0.99);
      p.setXYZ(i, x, y, 0.452 * 0.98 * Math.sqrt(Math.max(0.02, 1 - u * u - v * v)) + 0.006);
    }
    g.computeVertexNormals();
    g.userData.lowPoly = true;
    const peak = k.mesh(g, hairM, 0);
    h.add(peak);
  }
  // Silver temples (old money).
  for (const s of [-1, 1]) {
    const tm = k.ball(0.09, silver, 0.45, 1.1, 0.9, 12, 0.012);
    tm.position.set(s * 0.44, 0.6, 0.06);
    tm.rotation.z = s * 0.15;
    h.add(tm);
  }
  // Pointed ears: stretch the base ears and add a swept-back tip.
  b.ears.forEach((e, i) => {
    const s = i === 0 ? -1 : 1;
    e.scale.set(1.0, 1.25, 1.0);
    const tip = k.mesh(new THREE.ConeGeometry(0.05, 0.16, 12), b.skinMat, 0.012);
    tip.position.set(s * 0.02, 0.12, -0.03);
    tip.rotation.set(-0.5, 0, -s * 0.35);
    e.add(tip);
  });

  // The moustache: two waxed horns from under the nose, sweeping out past the ears and curling up into spirals.
  const stache = k.toon(0x150d14, { gloss: 1, shine: 110 });
  const stacheG = new THREE.Group();
  stacheG.position.set(0, 0.335, 0.39);
  h.add(stacheG);
  const staches: THREE.Group[] = [];
  const curls: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const side = new THREE.Group();
    stacheG.add(side);
    const pts = [
      [0.0, 0.0, 0.05], [0.07, -0.02, 0.05], [0.16, -0.035, 0.02], [0.27, -0.03, -0.04], [0.38, -0.0, -0.12], [0.48, 0.05, -0.18],
      [0.56, 0.13, -0.2],
    ].map(([x, y, z]) => new THREE.Vector3(s * x, y, z));
    const t = taperTube(pts, (u) => 0.012 + 0.058 * Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * u * 0.62)), 1.2) * (1 - u * 0.55), 40, 12);
    side.add(k.mesh(t.make(0), stache, 0));
    const ol = k.mesh(t.make(0.011), ink, 0);
    side.add(ol);
    // The curl: a tight spiral at the tip, on its own pivot so the twirl can spin it.
    const cp = new THREE.Group();
    cp.position.set(s * 0.56, 0.13, -0.2);
    side.add(cp);
    const sp: THREE.Vector3[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 1.75;
      const rr = 0.085 * (1 - (i / 24) * 0.75);
      sp.push(new THREE.Vector3(s * (Math.sin(a) * rr * 0.9 - 0.0), (1 - Math.cos(a)) * rr * 0.5 + Math.sin(a) * rr * 0.6 - 0.0, 0));
    }
    // start tangent continuing up-and-out, then rolling back in
    const sp2 = sp.map((p, i) => {
      const a = (i / 24) * Math.PI * 1.75;
      const rr = 0.085 * (1 - (i / 24) * 0.75);
      return new THREE.Vector3(s * (rr * Math.sin(a) * 1.0 + 0.0), rr * (1 - Math.cos(a)) - 0.0 + p.y * 0, 0);
    });
    const ct = taperTube(sp2.map((p) => p.clone().applyAxisAngle(new THREE.Vector3(0, 0, 1), s * 0.9)), (u) => 0.018 * (1 - u * 0.55), 30, 8);
    cp.add(k.mesh(ct.make(0), stache, 0));
    cp.add(k.mesh(ct.make(0.009), ink, 0));
    // wax glint on the sweep
    const gl = k.ball(0.02, k.own(new THREE.MeshBasicMaterial({ color: 0xffffff })), 2.6, 0.5, 0.5, 8, 0);
    gl.position.set(s * 0.2, 0.0, 0.035);
    gl.rotation.z = s * -0.15;
    side.add(gl);
    staches.push(side);
    curls.push(cp);
  }
  // Under-nose bulk so the two horns read as one moustache.
  const bulk = k.ball(0.08, stache, 1.5, 0.7, 0.8, 14, 0.014);
  bulk.position.set(0, -0.005, 0.03);
  stacheG.add(bulk);

  // One fang over the lip on the smirk side.
  const fang = k.mesh(new THREE.ConeGeometry(0.024, 0.075, 10), k.toon(0xfffbef, { gloss: 0.8 }), 0.01);
  fang.rotation.x = Math.PI;
  fang.position.set(-0.075, 0.28, 0.405);
  h.add(fang);

  // Monocle on his right eye (eyes[1], x < 0): gold rim, glass, glint, and a dangling gold chain.
  const eyeR = b.eyes[1];
  const mono = new THREE.Group();
  mono.position.set(0, 0, 0.075);
  eyeR.add(mono);
  const rimM = k.mesh(new THREE.TorusGeometry(0.15, 0.022, 10, 32), gold, 0.012);
  mono.add(rimM);
  const lens = new THREE.Mesh(k.geo(new THREE.CircleGeometry(0.15, 28)), k.own(new THREE.MeshBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.18, depthWrite: false })));
  lens.position.z = 0.004;
  mono.add(lens);
  const glintMat = k.own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }));
  const glint = new THREE.Mesh(k.geo(new THREE.PlaneGeometry(0.035, 0.16)), glintMat);
  glint.position.set(0.05, 0.04, 0.01);
  glint.rotation.z = -0.7;
  mono.add(glint);
  const glint2 = new THREE.Mesh(k.geo(new THREE.PlaneGeometry(0.018, 0.07)), glintMat);
  glint2.position.set(0.095, -0.02, 0.01);
  glint2.rotation.z = -0.7;
  mono.add(glint2);
  const monoChain = strand(b, mono, { x: -0.1, y: -0.12, z: 0 }, {
    n: 7, len: 0.07, r0: 0.014, r1: 0.014, color: gold, rx: 0.1, rz: 0.4, outline: 0.006, stiffness: 40, damping: 3, inertia: 0.12, seg: 8,
  });
  void monoChain;

  // ---------- body: tunic, sash, medals, epaulettes, boots ----------
  const ti = b.torsoInner;
  // Gold-trimmed high tunic collar.
  const tcol = k.cyl(0.16, 0.19, 0.12, 0x9c0f22, 14, 0.012);
  tcol.position.y = 0.67;
  ti.add(tcol);
  const tcolTrim = k.mesh(new THREE.TorusGeometry(0.162, 0.014, 6, 24), gold, 0);
  tcolTrim.rotation.x = Math.PI / 2;
  tcolTrim.position.y = 0.73;
  ti.add(tcolTrim);
  // White shirt front + cravat.
  // Black silk bow at the throat, a ruby pin in the knot.
  const silk = k.toon(0x1a1220, { gloss: 0.9, shine: 80 });
  for (const sd of [-1, 1]) {
    const wing = k.ball(0.075, silk, 1.25, 0.75, 0.45, 12, 0.012);
    wing.position.set(sd * 0.085, 0.645, 0.29);
    wing.rotation.z = sd * -0.25;
    ti.add(wing);
  }
  const knotB = k.ball(0.038, silk, 1, 1, 0.8, 10, 0.01);
  knotB.position.set(0, 0.645, 0.31);
  ti.add(knotB);
  const pin = k.ball(0.022, k.toon(0xe0102a, { gloss: 1, shine: 120 }), 1, 1, 0.7, 10, 0.006);
  pin.position.set(0, 0.645, 0.345);
  ti.add(pin);
  // Gold buttons, two rows.
  for (const s of [-1, 1])
    for (let i = 0; i < 3; i++) {
      const bt = k.ball(0.024, gold, 1, 1, 0.6, 10, 0.008);
      bt.position.set(s * 0.13, 0.42 - i * 0.11, 0.282 - i * 0.008);
      ti.add(bt);
    }
  // Belt with a gold buckle.
  const belt = k.cyl(0.315, 0.315, 0.07, 0x17111c, 18, 0.01);
  belt.position.y = 0.13;
  ti.add(belt);
  const buckle = k.box(0.09, 0.07, 0.03, gold, 0.008);
  buckle.position.set(0, 0.13, 0.31);
  ti.add(buckle);
  // Royal-blue sash from his left shoulder to his right hip, gold edged, with the jewelled star of his order.
  const sashG = new THREE.Group();
  sashG.position.set(0, 0.36, 0.0);
  sashG.rotation.z = -0.62;
  ti.add(sashG);
  const sash = k.mesh(new THREE.TorusGeometry(0.33, 0.05, 6, 40), k.toon(0x1c3aa8, { gloss: 0.5 }), 0.012);
  sash.scale.set(1.0, 1.0, 0.55);
  sash.rotation.y = Math.PI / 2;
  sash.scale.set(1, 1.18, 1);
  sashG.add(sash);
  const sashFront = new THREE.Group();
  sashG.add(sashFront);
  // the visible front band, flattened onto the chest
  const sb = k.box(0.11, 0.62, 0.03, k.toon(0x1c3aa8, { gloss: 0.5 }), 0.012);
  sb.position.set(0, 0, 0.29);
  sashFront.add(sb);
  for (const s of [-1, 1]) {
    const e = k.box(0.016, 0.62, 0.034, gold, 0);
    e.position.set(s * 0.058, 0, 0.292);
    sashFront.add(e);
  }
  sash.visible = false; // the flat band reads better than the hoop from the front
  const star = new THREE.Group();
  star.position.set(-0.13, 0.22, 0.33);
  ti.add(star);
  {
    const sh = new THREE.Shape();
    for (let i = 0; i < 16; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / 8, rr = i % 2 ? 0.035 : 0.075;
      i ? sh.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : sh.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    const sg = new THREE.ExtrudeGeometry(sh, { depth: 0.015, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.006, bevelSegments: 2 });
    star.add(k.mesh(sg, k.toon(0xe8e8f4, { gloss: 1, shine: 110 }), 0.008));
    const jewel = k.ball(0.025, k.toon(0xe0102a, { gloss: 1, shine: 120 }), 1, 1, 0.6, 10, 0.006);
    jewel.position.z = 0.03;
    star.add(jewel);
  }
  // Medals on his left chest: ribbon + disc, a row of five.
  const ribbons = [0xe0102a, 0x1c3aa8, 0xf2c230, 0x2a9a5a, 0xf6f2ea];
  for (let i = 0; i < 5; i++) {
    const x = 0.1 + i * 0.05, y = 0.5 - i * 0.012;
    const z = 0.27 - i * 0.022;
    const rb = k.box(0.045, 0.06, 0.02, ribbons[i], 0.006);
    rb.position.set(x, y, z);
    rb.rotation.y = 0.12 + i * 0.05;
    ti.add(rb);
    const md = k.cyl(0.028, 0.028, 0.014, i % 2 ? silver : gold, 12, 0.006);
    md.rotation.x = Math.PI / 2;
    md.position.set(x, y - 0.06, z + 0.006);
    ti.add(md);
  }
  // Gold epaulettes with fringe, on the shoulder pivots (they ride the arms).
  for (const [arm, s] of [[b.armInnerL, 1], [b.armInnerR, -1]] as const) {
    const ep = k.ball(0.13, gold, 1.25, 0.38, 1.05, 16, 0.012);
    ep.position.set(s * 0.02, 0.085, 0);
    arm.add(ep);
    for (let i = 0; i < 7; i++) {
      const a = -1.2 + (i / 6) * 2.4;
      const fr = k.cyl(0.014, 0.014, 0.09, goldDark, 6, 0.006);
      fr.position.set(s * (0.04 + Math.cos(a) * 0.12) * 1.0, 0.03, Math.sin(a) * 0.11);
      arm.add(fr);
    }
  }
  // Gold cuffs on the sleeves.
  for (const el of [b.elbowL, b.elbowR]) {
    const cf = k.cyl(0.1, 0.104, 0.06, gold, 12, 0.01);
    cf.position.y = -0.2;
    el.add(cf);
  }
  // Boots: tall glossy black riding boots with a gold stripe on the trouser.
  const boot = k.toon(0x0e0a12, { gloss: 1, shine: 100 });
  for (const s of [-1, 1]) {
    const bt = k.cyl(0.135, 0.13, 0.36, boot, 14, 0.014);
    bt.position.set(s * 0.16, -0.44, 0.0);
    b.legs.add(bt);
    const top = k.cyl(0.15, 0.14, 0.06, boot, 14, 0.012);
    top.position.set(s * 0.16, -0.25, 0.0);
    b.legs.add(top);
    const st = k.box(0.02, 0.22, 0.02, gold, 0);
    st.position.set(s * 0.275, -0.12, 0);
    b.legs.add(st);
  }

  // ---------- the cape + towering collar ----------
  const capeG = new THREE.Group();
  ti.add(capeG);
  // cape: an open shell behind the body from the shoulders to the boots
  const CS = 28, CH = 10;
  const capeGeo = new THREE.CylinderGeometry(0.42, 0.62, 1.32, CS, CH, true, Math.PI / 2 + 0.12, Math.PI - 0.24);
  capeGeo.translate(0, 0.0, 0);
  capeGeo.userData.lowPoly = true;
  const capeBase = Float32Array.from(capeGeo.attributes.position.array as Float32Array);
  const capeOuter = k.mesh(capeGeo, capeOut, 0);
  const capeInner = new THREE.Mesh(capeGeo, capeIn);
  capeG.add(capeOuter, capeInner);
  capeG.position.set(0, 0.0, -0.02);
  // the outline: an inked hem along the bottom + side edges (an open shell can't use a hull)
  // collar: a flared cone behind the head with pointed scallops
  const COL = 24, CROWS = 4;
  const CLEN = Math.PI + 0.3, C0 = Math.PI / 2 - 0.15;
  const colGeo = new THREE.CylinderGeometry(0.86, 0.26, 0.95, COL, CROWS, true, C0, CLEN);
  colGeo.userData.lowPoly = true;
  {
    const p = colGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const u = (y + 0.475) / 0.95; // 0 bottom .. 1 top
      const v = (i % (COL + 1)) / COL; // 0..1 around
      // pointed scallops on the top edge, and the front tips rise higher (Dracula points)
      const pts = Math.pow(Math.abs(Math.sin(v * Math.PI * 3)), 0.6) * 0.12 + Math.pow(Math.abs(v - 0.5) * 2, 3) * 0.22;
      const lean = u * u * 0.22; // the top flares back
      p.setXYZ(i, x, y + u * pts, z - lean);
    }
    colGeo.computeVertexNormals();
  }
  const collar = new THREE.Group();
  collar.position.set(0, 1.12, -0.1);
  ti.add(collar);
  collar.add(k.mesh(colGeo, capeOut, 0), new THREE.Mesh(colGeo, capeIn));
  // gold edge along the collar's top rim
  {
    const p = colGeo.attributes.position;
    const rim: THREE.Vector3[] = [];
    for (let j = 0; j <= COL; j++) rim.push(new THREE.Vector3(p.getX(j), p.getY(j), p.getZ(j)));
    const rt = taperTube(rim, () => 0.018, 60, 6);
    collar.add(k.mesh(rt.make(0), gold, 0));
    collar.add(k.mesh(rt.make(0.008), ink, 0));
  }
  // cape hem: gold-trimmed edge
  const hemPts = () => {
    const p = capeGeo.attributes.position;
    const out: THREE.Vector3[] = [];
    const row = CH; // bottom ring = last row
    for (let j = 0; j <= CS; j++) {
      const i = row * (CS + 1) + j;
      out.push(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
    }
    return out;
  };
  const hemGeo = k.geo(tubeGeo(CS + 1, 6));
  const hemOlGeo = k.geo(tubeGeo(CS + 1, 6));
  capeG.add(k.mesh(hemGeo, gold, 0), k.mesh(hemOlGeo, ink, 0));
  setTube(hemGeo, hemPts(), 0.022);
  setTube(hemOlGeo, hemPts(), 0.032);

  b.props.monocle = mono;
  b.props.moustache = stacheG;
  b.props.cape = capeG;
  b.props.collar = collar;
  b.props.fang = fang;
  b.props.hairPeak = h;

  // Bare right hand: the glove material on the right hand swapped for skin.
  const bareMat = k.toonUnique(0xd8cce6);
  const handRMeshes: { m: THREE.Mesh; mat: THREE.Material }[] = [];
  b.handR.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && !m.userData.hull && m.material !== ink) handRMeshes.push({ m, mat: m.material as THREE.Material });
  });
  // the gauntlet cuffs: white with a red strap, on both gloves
  const cuffs: THREE.Object3D[] = [];
  for (const hd of [b.handL, b.handR]) {
    const c = k.cyl(0.095, 0.11, 0.1, 0xfbfaf6, 12, 0.01);
    c.position.y = 0.1;
    hd.add(c);
    const strap = k.box(0.05, 0.035, 0.24, 0xd8102a, 0.006);
    strap.position.set(0, 0.1, 0);
    hd.add(strap);
    cuffs.push(c, strap);
  }

  let peerT = 0, peer = 0, sneerT = 0, sneer = 0, snarlT = 0, snarl = 0, capeT = 0, cape = 0, bare = false;
  const reachT: [{ o: THREE.Object3D | null; k: number; bend: number }, { o: THREE.Object3D | null; k: number; bend: number }] = [
    { o: null, k: 0, bend: 0.35 }, { o: null, k: 0, bend: 0.35 },
  ];
  const _w = new THREE.Vector3();
  const rig = finish(b, (c) => {
    const { t, sig, face, dt } = c;
    const bdt = c.bdt;
    peer = damp(peer, peerT, 16, bdt);
    sneer = damp(sneer, sneerT, 14, bdt);
    snarl = damp(snarl, snarlT, 18, bdt);
    cape = damp(cape, capeT, 7, bdt);
    // Aristocratic posture: chest out, shoulders back, a slow regal sway.
    b.torsoInner.rotation.x -= 0.06;
    b.armInnerL.rotation.z += 0.08;
    b.armInnerR.rotation.z -= 0.08;
    // Sneer: chin way up, lids low and level, the fang shows.
    if (sneer > 0.001) {
      for (let i = 0; i < 2; i++) {
        face.lid[i] += (0.55 - face.lid[i]) * sneer;
        face.lidTilt[i] += (0.05 - face.lidTilt[i]) * sneer;
        face.lidLo[i] += (0.22 - face.lidLo[i]) * sneer;
      }
      face.browRot[1] += (-0.45 - face.browRot[1]) * sneer;
      face.browY[1] += (0.07 - face.browY[1]) * sneer;
      face.headX += -0.16 * sneer;
      face.headZ += 0.06 * sneer;
      face.pupil += (0.7 - face.pupil) * sneer;
      if (sneer > 0.5 && face.jaw < 0.1) face.mouth = 'sneerR';
      c.lookAdd.y -= 0.5 * sneer; // looking DOWN his nose at you
    }
    // Snarl (the duel): brows slammed, eyes wide with pinprick pupils, teeth bared.
    if (snarl > 0.001) {
      for (let i = 0; i < 2; i++) {
        face.lid[i] += (0.05 - face.lid[i]) * snarl;
        face.lidLo[i] += (0.05 - face.lidLo[i]) * snarl;
        face.lidTilt[i] += (-0.35 - face.lidTilt[i]) * snarl;
        face.browRot[i] += (0.75 - face.browRot[i]) * snarl;
        face.browY[i] += (-0.045 - face.browY[i]) * snarl;
        face.eye[i] += (1.18 - face.eye[i]) * snarl;
      }
      face.pupil += (0.42 - face.pupil) * snarl;
      face.headX += 0.1 * snarl;
      if (snarl > 0.5 && face.jaw < 0.1) face.mouth = 'teeth';
    }
    // Peer through the monocle: that eye balloons, its brow flies up, the other squints.
    if (peer > 0.001) {
      face.eye[1] += (1.75 - face.eye[1]) * peer;
      face.lid[1] += (0.0 - face.lid[1]) * peer;
      face.lidLo[1] += (0.0 - face.lidLo[1]) * peer;
      face.browY[1] += (0.13 - face.browY[1]) * peer;
      face.browRot[1] += (-0.5 - face.browRot[1]) * peer;
      face.lid[0] += (0.72 - face.lid[0]) * peer;
      face.lidLo[0] += (0.3 - face.lidLo[0]) * peer;
      face.browY[0] += (-0.03 - face.browY[0]) * peer;
      face.browRot[0] += (0.45 - face.browRot[0]) * peer;
      face.pupil += (1.15 - face.pupil) * peer;
      face.headZ += -0.12 * peer;
    }
    mono.scale.setScalar(1 + 0.62 * peer);
    mono.position.z = 0.075 + 0.05 * peer;
    fang.visible = face.jaw < 0.1 && face.mouth !== 'teeth';
    // Moustache: bristles with the sneer/snarl, twirls with the signature.
    const bristle = Math.max(sig, 0.4 * sneer, 0.8 * snarl);
    staches.forEach((s, i) => {
      const sd = i === 0 ? 1 : -1;
      s.rotation.set(0, 0, sd * (0.18 * bristle + Math.sin(t * 9) * 0.04 * sig));
      s.scale.setScalar(1 + 0.08 * bristle);
    });
    curls.forEach((cp, i) => (cp.rotation.z = (i === 0 ? 1 : -1) * (Math.sin(t * 2.2) * 0.08 + sig * t * 6)));
    stacheG.position.y = 0.335 + 0.012 * bristle;
    // Cape: ripples on its own; flares out and back like wings.
    {
      const p = capeGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x0 = capeBase[i * 3], y0 = capeBase[i * 3 + 1], z0 = capeBase[i * 3 + 2];
        const u = (0.66 - y0) / 1.32; // 0 top .. 1 hem
        const a = Math.atan2(x0, z0);
        const side = Math.sin(a); // -1..1 across
        const rip = Math.sin(t * 3.1 + a * 3 + u * 4) * 0.03 * u + Math.sin(t * 5.3 + a * 5) * 0.012 * u * (0.5 + cape);
        const fl = cape * u;
        const r = 1 + fl * 1.6 + rip * 3;
        p.setXYZ(i, x0 * r + side * fl * 0.35, y0 + fl * u * 0.35 + Math.abs(side) * fl * 0.25, z0 * (1 + fl * 0.6) - fl * 0.55 + rip);
      }
      p.needsUpdate = true;
      capeGeo.computeVertexNormals();
      capeGeo.computeBoundingSphere();
      const hp = hemPts();
      setTube(hemGeo, hp, 0.022);
      setTube(hemOlGeo, hp, 0.032);
    }
    collar.rotation.x = -0.04 * cape;
    // Right glove on/off.
    for (const { m, mat } of handRMeshes) m.material = bare ? bareMat : mat;
    cuffs[2].visible = cuffs[3].visible = !bare;
    // Reaches (world targets, re-read every frame).
    reachT.forEach((r, i) => {
      if (!r.o || r.k <= 0.001) return;
      r.o.updateWorldMatrix(true, false);
      r.o.getWorldPosition(_w);
      reach(b, i === 0 ? 1 : -1, _w, r.k, r.bend);
    });
    void dt;
  }, { height: 2.3 });

  return Object.assign(rig, {
    setPeer(v: number) {
      peerT = clamp(v, 0, 1);
    },
    setSneer(v: number) {
      sneerT = clamp(v, 0, 1);
    },
    setSnarl(v: number) {
      snarlT = clamp(v, 0, 1);
    },
    setCape(v: number) {
      capeT = clamp(v, 0, 1.5);
    },
    setBare(v: number) {
      bare = v >= 0.5;
    },
    setReach(side: 1 | -1, target: THREE.Object3D | null, v: number, bend = 0.35) {
      const r = reachT[side === 1 ? 0 : 1];
      r.o = target;
      r.k = clamp(v, 0, 1);
      r.bend = bend;
    },
  });
}
