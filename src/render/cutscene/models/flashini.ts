// The Great Flashini: a sleazy stage magician and con artist. Tall black top hat with a purple band and an ace
// tucked in it, a high purple cape collar lined in gold, a velvet tailcoat over a white shirt front and a gold
// bow tie, white gloves, a black-and-white wand, a pencil-thin curly moustache and a pointy goatee. Smug from
// frame 0: heavy lids, one brow hiked, chin up, a smirk.
// Extra controls (all smoothed on the beat clock unless noted):
//   setHat(k 0..1)       0 = on his head, 1 = off and held upside down (opening up) in his LEFT hand, out in
//                        front of his chest like a magician about to pull something out of it.
//   setTaDa(k 0..1)      the big finish: both arms flung up and out in a V, open palms, chin up, a huge grin,
//                        and the cape flares out into gold-lined wings from his shoulders to his wrists.
//   setLaugh(k 0..1)     head thrown back, eyes squeezed "^ ^", shoulders bouncing, jaw flapping, moustache
//                        tips bouncing.
//   setReach(side, p, k) side 1 = left hand, -1 = right hand: blends that hand onto the world point p (a
//                        Vector3 the scene may keep mutating) by k. Instant (scenes animate k / p). p = null
//                        releases it. Wins over setHat's left arm.
//   setWings(k 0..1)     cape wings on their own (setTaDa drives them too; the max wins).
// setSignature(k): the showman flourish: right forearm swirls the wand in circles over his shoulder, the cape
// billows. props: hat, wand (in the right grip, along +Y out of the thumb side), wandTip, ace (the card in the hat band),
// hatAnchor (left-hand hat holder, for parenting things into the hat's mouth: its +Y is "out of the hat").
import * as THREE from 'three';
import { buildBase, finish, reach, type CharacterRigX } from './character';
import { clamp, damp } from './kit';

export interface FlashiniRig extends CharacterRigX {
  setHat(k: number): void;
  setTaDa(k: number): void;
  setLaugh(k: number): void;
  setReach(side: 1 | -1, p: THREE.Vector3 | null, k?: number, bend?: number): void;
  setWings(k: number): void;
}

const PURPLE = 0x5a1a8a;
const GOLD = 0xffd23f;

/** A tapered tube along a curve (radius r0 at the start to r1 at the end). */
function taperTube(curve: THREE.Curve<THREE.Vector3>, segs: number, r0: number, r1: number, radial = 8) {
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const p = g.attributes.position;
  const c = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    curve.getPointAt(u, c);
    const r = r0 + (r1 - r0) * u;
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(p, idx).sub(c).multiplyScalar(r).add(c);
      p.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  g.userData.lowPoly = true;
  return g;
}

export function buildFlashini(): FlashiniRig {
  const b = buildBase({
    skin: 0xf3d0b2, shirt: 0x34174f, sleeve: 0x34174f, pants: 0x1c1226, shoes: 0x14101a, hands: 0xfbfbff, brow: 0x1a1020,
    iris: 0xa44cf0, lid: 0xd9a9a0, nose: 'sharp', jawW: 0.92, chestW: 0.98, headScale: 1.02, browScale: 1.05,
    sweet: { eye: [1.15, 1.15], pupil: 1.35 },
    jerk: {
      // the smug showman: heavy lids, one brow hiked high (his left), the other low and level, chin up, smirk
      lid: [0.4, 0.5], lidLo: [0.22, 0.26], lidTilt: [-0.05, -0.18], browY: [0.065, -0.03], browRot: [-0.3, 0.42],
      eye: [1.02, 0.96], pupil: 0.9, headX: -0.13, headZ: 0.09, jawRoll: 0.05, mouth: 'smirk',
    },
  });
  const k = b.kit, h = b.headInner, T = b.torsoInner;
  const ink = k.toon(0x1a1020, { gloss: 0.7, shine: 70 });
  const purple = k.toon(PURPLE, { gloss: 0.3 });
  const gold = k.toon(GOLD, { gloss: 0.9, shine: 90 });
  const goldDS = k.toon(GOLD, { gloss: 0.6, side: THREE.DoubleSide });
  const purpleDS = k.toon(PURPLE, { gloss: 0.25, side: THREE.DoubleSide });
  const white = k.toon(0xfbfbff, { gloss: 0.3 });

  // ---------- face ----------
  // Slicked-back black hair under the hat: a shell over the back and sides + two sharp sideburns.
  {
    const g = new THREE.SphereGeometry(0.445, 18, 12, Math.PI / 2 + 1.15, Math.PI * 2 - 2.3, 0.25, 1.6);
    g.scale(1.06, 0.98, 0.97);
    const hair = k.mesh(g, k.toon(0x1a1020, { gloss: 0.8, shine: 80, side: THREE.DoubleSide }), 0);
    hair.position.y = 0.5;
    h.add(hair);
    for (const s of [-1, 1]) {
      const sb = k.cyl(0.0, 0.045, 0.2, ink, 6, 0.01);
      sb.position.set(s * 0.405, 0.5, 0.06);
      sb.rotation.set(Math.PI, 0, s * 0.12);
      h.add(sb);
    }
  }
  // Pencil-thin curly moustache: each half on a pivot under the nose (they bounce on the laugh).
  const staches: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const piv = new THREE.Group();
    piv.position.set(0, 0.33, 0.405);
    h.add(piv);
    const pts: THREE.Vector3[] = [];
    // out along the lip, sweeping up into a tight curl at the tip
    pts.push(new THREE.Vector3(s * 0.01, 0.0, 0.02), new THREE.Vector3(s * 0.09, -0.012, 0.0), new THREE.Vector3(s * 0.18, 0.005, -0.04));
    const cx = s * 0.225, cy = 0.055, R0 = 0.05;
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (i / 10) * Math.PI * 1.55;
      const r = R0 * (1 - 0.45 * (i / 10));
      pts.push(new THREE.Vector3(cx + s * Math.cos(a) * r, cy + Math.sin(a) * r, -0.05 + i * 0.002));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const m = k.mesh(taperTube(curve, 40, 0.026, 0.008), ink, 0.008);
    piv.add(m);
    staches.push(piv);
  }
  // Pointy goatee on the chin.
  const goatee = k.cyl(0.055, 0.0, 0.17, ink, 10, 0.01);
  goatee.position.set(0, -0.31, 0.29);
  goatee.rotation.x = 0.35;
  b.jawInner.add(goatee);

  // ---------- top hat ----------
  const hatAnchorHead = new THREE.Object3D();
  hatAnchorHead.position.set(0.02, 0.84, -0.02);
  hatAnchorHead.rotation.set(-0.1, 0, -0.12);
  h.add(hatAnchorHead);
  const hat = new THREE.Group();
  b.root.add(hat);
  {
    const brimPts = [[0.0, -0.005], [0.5, -0.005], [0.6, 0.05], [0.6, 0.075], [0.5, 0.035], [0.0, 0.035]].map(([x, y]) => new THREE.Vector2(x, y));
    const brim = k.mesh(new THREE.LatheGeometry(brimPts, 28).scale(1, 1, 0.84), ink);
    hat.add(brim);
    const crownPts = [[0.0, 0.0], [0.33, 0.0], [0.32, 0.3], [0.345, 0.66], [0.36, 0.72], [0.0, 0.72]].map(([x, y]) => new THREE.Vector2(x, y));
    const crown = k.mesh(new THREE.LatheGeometry(crownPts, 28).scale(1, 1, 0.9), ink);
    hat.add(crown);
    const band = k.mesh(new THREE.CylinderGeometry(0.333, 0.338, 0.14, 28, 1, true).scale(1, 1, 0.9), k.toon(PURPLE, { gloss: 0.5, side: THREE.DoubleSide }), 0.01);
    band.position.y = 0.1;
    hat.add(band);
    // a gold pin-stripe above the band
    const pin = k.mesh(new THREE.TorusGeometry(0.33, 0.012, 6, 32).scale(1, 0.9, 1), gold, 0);
    pin.rotation.x = Math.PI / 2;
    pin.scale.set(1.01, 0.9, 1);
    pin.position.y = 0.18;
    hat.add(pin);
  }
  // the ace of spades tucked in the band (card face drawn on a tiny canvas)
  const aceTex = k.canvas(40, 56, (g, w, hh) => {
    g.fillStyle = '#fbfbff';
    g.fillRect(0, 0, w, hh);
    g.fillStyle = '#1a1020';
    g.font = 'bold 12px monospace';
    g.fillText('A', 3, 12);
    // a spade
    g.beginPath();
    g.moveTo(20, 16);
    g.bezierCurveTo(34, 28, 30, 40, 20, 34);
    g.bezierCurveTo(10, 40, 6, 28, 20, 16);
    g.fill();
    g.fillRect(18, 33, 4, 9);
    g.strokeStyle = '#a44cf0';
    g.lineWidth = 2;
    g.strokeRect(1, 1, w - 2, hh - 2);
  });
  const ace = new THREE.Group();
  ace.position.set(0.2, 0.2, 0.24);
  ace.rotation.set(-0.1, 0.65, -0.25);
  hat.add(ace);
  {
    const cardM = k.toon(0xffffff);
    const face = k.own(new THREE.MeshToonMaterial({ map: aceTex, gradientMap: k.grad }));
    const c = new THREE.Mesh(k.geo(new THREE.BoxGeometry(0.15, 0.21, 0.008)), [cardM, cardM, cardM, cardM, face, cardM]);
    c.userData.outline = 0.008;
    ace.add(c);
  }
  // In-hand holder (left grip): hat upside down, mouth up. hatAnchor +Y = out of the hat's mouth.
  const hatMouth = new THREE.Object3D(); // where things come out (scenes parent to props.hatAnchor)
  hat.add(hatMouth);
  hatMouth.rotation.x = Math.PI; // +Y = out of the hat's mouth

  // ---------- body: tailcoat, shirt front, bow tie ----------
  const shirt = k.ball(0.2, white, 1.0, 1.35, 0.5, 18, 0.012);
  shirt.position.set(0, 0.42, 0.24);
  T.add(shirt);
  for (const s of [-1, 1]) {
    // satin lapels: long gold-edged wedges either side of the shirt front
    const lap = k.box(0.12, 0.42, 0.04, k.toon(0x1c1226, { gloss: 0.8, shine: 70 }), 0.012);
    lap.position.set(s * 0.17, 0.42, 0.27);
    lap.rotation.set(-0.25, s * 0.35, s * 0.28);
    T.add(lap);
    const edge = k.box(0.02, 0.42, 0.045, gold, 0);
    edge.position.set(s * 0.06, 0, 0.002);
    lap.add(edge);
  }
  for (const y of [0.34, 0.24]) {
    const st = k.ball(0.022, ink, 1, 1, 0.6, 8, 0);
    st.position.set(0, y, 0.33);
    T.add(st);
  }
  // gold bow tie
  const bow = new THREE.Group();
  bow.position.set(0, 0.63, 0.27);
  bow.rotation.x = -0.3;
  T.add(bow);
  for (const s of [-1, 1]) {
    const w = k.cyl(0.0, 0.085, 0.13, gold, 4, 0.01);
    w.rotation.z = s * Math.PI / 2;
    w.scale.set(1, 1, 0.5);
    w.position.x = s * 0.07;
    bow.add(w);
  }
  bow.add(k.ball(0.035, gold, 1, 1, 0.8, 10, 0.01));
  // a purple carnation on the lapel
  const flower = k.ball(0.05, k.toon(0xd04af0), 1, 1, 0.7, 10, 0.01);
  flower.position.set(0.21, 0.52, 0.31);
  T.add(flower);

  // ---------- cape ----------
  // Vampire collar: two pointed panels flaring up behind the head, gold inside, purple outside.
  const collarShape = new THREE.Shape();
  collarShape.moveTo(0, 0);
  collarShape.quadraticCurveTo(0.3, 0.02, 0.42, 0.12);
  collarShape.lineTo(0.5, 0.62);
  collarShape.quadraticCurveTo(0.3, 0.42, 0.05, 0.5);
  collarShape.lineTo(0, 0.4);
  collarShape.lineTo(0, 0);
  const collarGeo = new THREE.ExtrudeGeometry(collarShape, { depth: 0.035, bevelEnabled: false, curveSegments: 8 });
  for (const s of [-1, 1]) {
    const piv = new THREE.Group();
    piv.position.set(s * 0.05, 0.64, -0.14);
    piv.rotation.set(-0.12, s * -0.42, 0);
    piv.scale.set(s * 1.3, 1.35, 1.3);
    T.add(piv);
    const back = k.mesh(collarGeo, purpleDS, 0.014);
    back.position.z = -0.035;
    piv.add(back);
    const front = k.mesh(new THREE.ShapeGeometry(collarShape, 8), goldDS, 0);
    front.scale.setScalar(0.94);
    front.position.set(0.02, 0.02, 0.003);
    piv.add(front);
  }
  // Cape body: an open shell round the back of the torso, purple outside, gold lining inside.
  {
    const g = new THREE.CylinderGeometry(0.36, 0.62, 1.05, 24, 1, true, Math.PI * 0.42, Math.PI * 1.16);
    const out = k.mesh(g, purple, 0.012);
    out.position.set(0, 0.12, -0.05);
    T.add(out);
    const lin = k.mesh(new THREE.CylinderGeometry(0.35, 0.6, 1.04, 24, 1, true, Math.PI * 0.42, Math.PI * 1.16), k.toon(GOLD, { gloss: 0.5, side: THREE.BackSide }), 0);
    lin.position.copy(out.position);
    T.add(lin);
    // gold clasp chain across the chest
    const chain = k.mesh(new THREE.TorusGeometry(0.2, 0.012, 6, 20, Math.PI * 0.8), gold, 0);
    chain.position.set(0, 0.7, 0.13);
    chain.rotation.set(0.3, 0, Math.PI * 1.1);
    T.add(chain);
    for (const s of [-1, 1]) {
      const clasp = k.ball(0.04, gold, 1, 1, 0.6, 10, 0.01);
      clasp.position.set(s * 0.22, 0.64, 0.18);
      T.add(clasp);
    }
  }
  // Cape wings (TA-DA): dynamic sheets from the back of each shoulder out to the wrist, gold lining forward.
  const NW = 7, NH = 6;
  const wings: { geo: THREE.BufferGeometry; root: THREE.Group; s: 1 | -1 }[] = [];
  for (const s of [1, -1] as const) {
    const geo = k.geo(new THREE.BufferGeometry());
    const pos = new Float32Array((NW + 1) * (NH + 1) * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const idx: number[] = [];
    for (let i = 0; i < NW; i++)
      for (let j = 0; j < NH; j++) {
        const a = i * (NH + 1) + j, c = a + NH + 1;
        if (s > 0) idx.push(a, c, a + 1, a + 1, c, c + 1);
        else idx.push(a, a + 1, c, a + 1, c + 1, c);
      }
    geo.setIndex(idx);
    const root = new THREE.Group();
    T.add(root);
    // gold lining (both faces: it is what the audience sees when the cape flares open)
    const lin = new THREE.Mesh(geo, k.toon(GOLD, { gloss: 0.6, side: THREE.DoubleSide }));
    lin.frustumCulled = false;
    root.add(lin);
    root.visible = false;
    b.props[s > 0 ? 'wingL' : 'wingR'] = root;
    wings.push({ geo, root, s });
  }

  // ---------- wand ----------
  const wand = new THREE.Group();
  b.props.gripR.add(wand);
  {
    const shaft = k.cyl(0.022, 0.022, 0.5, ink, 10, 0.01);
    shaft.position.y = 0.17;
    wand.add(shaft);
    for (const x of [-0.1, 0.44]) {
      const tip = k.cyl(0.025, 0.025, 0.08, white, 10, 0.01);
      tip.position.y = x;
      wand.add(tip);
    }
  }
  const wandTip = new THREE.Object3D();
  wandTip.position.y = 0.48;
  wand.add(wandTip);

  b.props.hat = hat;
  b.props.wand = wand;
  b.props.wandTip = wandTip;
  b.props.ace = ace;
  b.props.hatAnchor = hatMouth;

  // ---------- controls ----------
  let hatT = 0, hatK = 0, taT = 0, taK = 0, laughT = 0, laughK = 0, wingT = 0, wingK = 0;
  const reachP: (THREE.Vector3 | null)[] = [null, null];
  const reachK = [0, 0], reachB = [0.35, 0.35];
  const _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Vector3(), _p2 = new THREE.Vector3();
  const _m = new THREE.Matrix4(), _s = new THREE.Vector3();
  const _sh = new THREE.Vector3(), _hand = new THREE.Vector3(), _a = new THREE.Vector3(), _bb = new THREE.Vector3();
  const flipQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI - 0.5, 0, 0));

  const rig = finish(b, (c) => {
    const { t, face, dt } = c;
    const bd = c.bdt;
    hatK = damp(hatK, hatT, 10, bd);
    taK = damp(taK, taT, 16, bd);
    laughK = damp(laughK, laughT, 14, bd);
    wingK = damp(wingK, Math.max(wingT, taT), 12, bd);
    const sig = c.sig * (1 - taK);
    // Smug idle: a slow showman sway of the head, the hiked brow twitching.
    face.headZ += Math.sin(t * 1.7) * 0.03;
    face.browY[0] += Math.max(0, Math.sin(t * 2.3)) ** 8 * 0.02;
    // Moustache: a tiny twitch, big bounce on the laugh.
    staches.forEach((p, i) => {
      const s = i ? 1 : -1;
      p.rotation.z = s * (0.04 * Math.sin(t * 3 + i) + laughK * (0.15 + 0.15 * Math.abs(Math.sin(t * 22))));
    });

    // Signature: the wand flourish over the right shoulder.
    if (sig > 0.01) {
      b.armInnerR.rotation.set(-0.7 * sig + Math.sin(t * 9) * 0.3 * sig, 0, -1.9 * sig + Math.cos(t * 9) * 0.25 * sig);
      b.elbowR.rotation.x = -0.25 - 0.7 * sig;
      c.hand[1] = 'grip';
    }
    // Laugh: head thrown back, shoulders bounce, jaw flapping, eyes shut.
    if (laughK > 0.01) {
      const L = laughK, hop = Math.abs(Math.sin(t * 12)) * L;
      T.position.y += hop * 0.05;
      T.rotation.x -= 0.12 * L;
      b.armInnerL.rotation.z += 0.25 * L + hop * 0.3;
      b.armInnerR.rotation.z -= 0.25 * L + hop * 0.3;
      face.jaw = Math.max(face.jaw, L * (0.45 + 0.35 * Math.abs(Math.sin(t * 22))));
      face.headX += -0.32 * L + Math.sin(t * 12) * 0.05 * L;
      face.headZ += Math.sin(t * 6) * 0.08 * L;
      if (L > 0.4) face.lid = [1, 1];
      face.lidTilt = [0, 0];
      face.browY = [face.browY[0] + 0.05 * L, face.browY[1] + 0.07 * L];
      face.browRot = [face.browRot[0] * (1 - L) - 0.4 * L, face.browRot[1] * (1 - L) - 0.4 * L];
    }
    // TA-DA: arms in a V, chin up, huge grin.
    if (taK > 0.01) {
      const A = taK;
      for (const [inner, elbow, s] of [[b.armInnerL, b.elbowL, 1], [b.armInnerR, b.elbowR, -1]] as const) {
        inner.rotation.x += (-0.35 - inner.rotation.x) * A;
        inner.rotation.y += (0 - inner.rotation.y) * A;
        inner.rotation.z += (s * 2.35 - inner.rotation.z) * A;
        elbow.rotation.x += (-0.15 - elbow.rotation.x) * A;
      }
      T.rotation.x -= 0.1 * A;
      face.headX += (-0.22 - face.headX) * A;
      face.headZ *= 1 - A;
      if (A > 0.5) {
        face.mouth = 'grin';
        face.lid = [0.35, 0.35];
        face.lidLo = [0.35, 0.35];
        face.browY = [0.06, 0.06];
        face.browRot = [-0.3, -0.3];
        c.hand[0] = c.hand[1] = 'open';
      }
      if (A > 0.5) face.jaw = Math.min(face.jaw, 0.05);
    }

    b.root.updateMatrixWorld(true);
    // Hat: blend between the head anchor and upside down in the left hand.
    if (hatK > 0.01) {
      _w.set(0.45, 0.55, 0.55);
      T.localToWorld(_w);
      reach(b, 1, _w, Math.min(1, hatK * 1.4) * (1 - reachK[0]), 1.0);
      c.hand[0] = 'grip';
      b.root.updateMatrixWorld(true);
    }
    for (const i of [0, 1] as const) {
      const p = reachP[i];
      if (p && reachK[i] > 0.001) {
        reach(b, i === 0 ? 1 : -1, p, reachK[i], reachB[i]);
        b.root.updateMatrixWorld(true);
      }
    }
    hatAnchorHead.updateWorldMatrix(true, false);
    hatAnchorHead.matrixWorld.decompose(_p, _q, _s);
    if (hatK > 0.01) {
      // in hand: brim at the palm, upside down, opening tipped a little toward the camera
      b.handL.updateWorldMatrix(true, false);
      b.handL.getWorldPosition(_p2);
      b.root.getWorldQuaternion(_q2).multiply(flipQ);
      _p2.y += 0.05 * b.root.scale.y;
      const e = hatK;
      const arc = Math.sin(e * Math.PI) * 0.35 * b.root.scale.y;
      _p.lerp(_p2, e);
      _p.y += arc;
      _q.slerp(_q2, e);
    }
    // to root-local
    _m.compose(_p, _q, _s.set(1, 1, 1).multiplyScalar(b.root.scale.x));
    _m.premultiply(new THREE.Matrix4().copy(b.root.matrixWorld).invert());
    _m.decompose(hat.position, hat.quaternion, hat.scale);

    // Cape wings.
    const wk = Math.max(wingK, sig * 0.25);
    for (const wg of wings) {
      wg.root.visible = wk > 0.02;
      if (!wg.root.visible) continue;
      const s = wg.s;
      _sh.set(s * 0.12, 0.66, -0.16); // collar root (torso space)
      const hand = s > 0 ? b.handL : b.handR;
      hand.updateWorldMatrix(true, false);
      hand.getWorldPosition(_hand);
      T.worldToLocal(_hand);
      const pos = wg.geo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i <= NW; i++) {
        const u = i / NW; // 0 = spine edge, 1 = outer (wrist) edge
        // top edge: from the collar out to the wrist; bottom edge: from the hem out under the wrist
        _a.set(s * 0.12, 0.98, -0.17).lerp(_p2.set(_hand.x * 1.12, _hand.y + 0.1, _hand.z - 0.05), u * wk);
        _bb.set(s * 0.32, 0.5, -0.24);
        _bb.lerp(_p2.set(_hand.x * 1.25, _hand.y - 0.5, _hand.z - 0.12), u * wk);
        for (let j = 0; j <= NH; j++) {
          const v = j / NH;
          const sag = Math.sin(u * Math.PI) * Math.sin(v * Math.PI) * 0.12;
          const flut = Math.sin(t * 7 + u * 3 + v * 2) * 0.03 * u;
          _w.copy(_a).lerp(_bb, v);
          _w.z -= sag + 0.05 * u * wk;
          _w.y += (Math.sin(u * Math.PI) * 0.06 - 0.06 * u * v) * wk + flut;
          pos.setXYZ(i * (NH + 1) + j, _w.x, _w.y, _w.z);
        }
      }
      pos.needsUpdate = true;
      wg.geo.computeVertexNormals();
      wg.geo.computeBoundingSphere();
    }
    void dt;
    void _sh;
  });
  rig.setTurn(1);
  return Object.assign(rig, {
    setHat(v: number) {
      hatT = clamp(v, 0, 1);
    },
    setTaDa(v: number) {
      taT = clamp(v, 0, 1);
    },
    setLaugh(v: number) {
      laughT = clamp(v, 0, 1);
    },
    setReach(side: 1 | -1, p: THREE.Vector3 | null, kk = 1, bend = 0.35) {
      const i = side === 1 ? 0 : 1;
      reachP[i] = p;
      reachK[i] = p ? clamp(kk, 0, 1) : 0;
      reachB[i] = bend;
    },
    setWings(v: number) {
      wingT = clamp(v, 0, 1);
    },
  });
}
