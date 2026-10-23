// Deacon Dread's props: the skull shift-knob cane, the hourglass (with a single last grain), the coffin tape
// measure, a funeral candle, the "YOU" tombstone and the roof coffin for his hearse.
// Same conventions as props.ts: root origin = the grip point, +X out of the fist, +Y up on the prop, flat faces +Z.
import * as THREE from 'three';
import { Kit, outlineTree } from './kit';
import { roundedBoxGeometry, type Prop } from './props';

const OL = 0.011;

function base(name: string) {
  const kit = new Kit();
  const root = new THREE.Group();
  root.name = name;
  return { kit, root };
}
function done(kit: Kit, root: THREE.Group) {
  outlineTree(root, kit.outlineMat);
  return () => {
    root.removeFromParent();
    kit.dispose();
  };
}
const clamp01 = (k: number) => (k < 0 ? 0 : k > 1 ? 1 : k);
const rbox = (kit: Kit, w: number, h: number, d: number, r: number, mat: THREE.Material | THREE.ColorRepresentation, ol = OL) =>
  kit.mesh(roundedBoxGeometry(w, h, d, r, 3), mat, ol);

/** Ivory skull (shift knob / cane topper), facing +Z, ~0.17 m tall, origin at the base of the jaw. */
function skull(kit: Kit, r = 0.085, eyeGlow?: THREE.Material) {
  const g = new THREE.Group();
  const bone = kit.toon(0xf2ead2, { gloss: 0.7, shine: 70 });
  const hole = kit.toon(0x1a1420, { gloss: 0 });
  const cran = kit.ball(r, bone, 1, 0.95, 1.02, 18, OL);
  cran.position.y = r * 1.25;
  g.add(cran);
  const jaw = kit.ball(r * 0.7, bone, 1.05, 0.62, 0.95, 14, OL);
  jaw.position.set(0, r * 0.45, r * 0.18);
  g.add(jaw);
  for (const s of [-1, 1]) {
    const e = kit.ball(r * 0.27, eyeGlow ?? hole, 1.1, 1, 0.5, 12, 0);
    e.position.set(s * r * 0.38, r * 1.15, r * 0.86);
    e.rotation.y = s * 0.3;
    g.add(e);
  }
  const nose = kit.mesh(new THREE.ConeGeometry(r * 0.12, r * 0.22, 3), hole, 0);
  nose.rotation.x = Math.PI;
  nose.position.set(0, r * 0.82, r * 0.98);
  g.add(nose);
  // teeth: a row of little ticks along the jaw front
  for (let i = -3; i <= 3; i++) {
    const tk = kit.box(r * 0.025, r * 0.2, r * 0.05, hole, 0);
    const a = i * 0.16;
    tk.position.set(Math.sin(a) * r * 0.66, r * 0.55, r * 0.18 + Math.cos(a) * r * 0.62);
    tk.rotation.y = a;
    g.add(tk);
  }
  // the shift pattern engraved on the crown: it IS a shift knob
  const ink = kit.toon(0x6a6070, { gloss: 0 });
  const top = new THREE.Group();
  top.position.y = r * 2.18;
  top.rotation.x = -0.1;
  g.add(top);
  for (const x of [-1, 0, 1]) {
    const bar = kit.box(r * 0.04, 0.004, r * 0.6, ink, 0);
    bar.position.x = x * r * 0.3;
    top.add(bar);
  }
  const cross = kit.box(r * 0.64, 0.004, r * 0.04, ink, 0);
  top.add(cross);
  return g;
}

/** The skull-topped cane: knob above the fist (+Y), black shaft down -Y, silver ferrule. */
export function buildSkullCane(): Prop & { skull: THREE.Object3D; setEyes(k: number): void } {
  const { kit, root } = base('prop_skullcane');
  const eyeMat = kit.own(new THREE.MeshBasicMaterial({ color: 0x1a1420 }));
  const silver = kit.toon(0xd8dde6, { gloss: 1, shine: 90 });
  const ebony = kit.toon(0x111116, { gloss: 0.9, shine: 80 });
  const sk = skull(kit, 0.085, eyeMat);
  sk.position.y = 0.075;
  root.add(sk);
  const collar = kit.cyl(0.04, 0.03, 0.05, silver, 14, OL);
  collar.position.y = 0.06;
  root.add(collar);
  const ring = kit.mesh(new THREE.TorusGeometry(0.036, 0.008, 6, 18).rotateX(Math.PI / 2), silver, 0);
  ring.position.y = 0.036;
  root.add(ring);
  const shaft = kit.cyl(0.022, 0.018, 1.15, ebony, 12, OL);
  shaft.position.y = -0.52;
  root.add(shaft);
  const fer = kit.cyl(0.02, 0.016, 0.07, silver, 12, OL);
  fer.position.y = -1.1;
  root.add(fer);
  const tip = kit.ball(0.017, silver, 1, 0.8, 1, 10, 0);
  tip.position.y = -1.14;
  root.add(tip);
  const dispose = done(kit, root);
  const cGlow = new THREE.Color(0xc8ffe8), cOff = new THREE.Color(0x1a1420);
  return {
    root, dispose, skull: sk,
    setEyes(k: number) {
      eyeMat.color.copy(cOff).lerp(cGlow, clamp01(k));
    },
  };
}

/**
 * Hourglass, ~0.36 m tall, centred on the origin (the neck). setSand(u): 0 = full top, 1 = all run out.
 * setStream(k): the falling thread. `grain` (a glowing bead) is left for the scene to drop by hand.
 */
export function buildHourglass(): Prop & {
  setSand(u: number): void;
  setStream(k: number): void;
  grain: THREE.Mesh;
  neckTop: number;
  pileTop(): number;
} {
  const { kit, root } = base('prop_hourglass');
  const H = 0.17; // half height of the glass
  const wood = kit.toon(0x2a2430, { gloss: 0.9, shine: 70 });
  const silver = kit.toon(0xd8dde6, { gloss: 1, shine: 90 });
  const sandM = kit.toon(0xffe4a0, { emissive: 0xc89a40, emissiveIntensity: 0.9, gloss: 0.2 });
  // glass: a lathe double bulb, see-through
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 24; i++) {
    const v = i / 24; // 0 bottom .. 1 top
    const y = (v * 2 - 1) * H;
    const a = Math.abs(v * 2 - 1);
    const r = 0.012 + 0.085 * Math.sin(Math.min(1, a) * Math.PI * 0.62) ** 1.2;
    prof.push(new THREE.Vector2(r, y));
  }
  const glassMat = kit.own(new THREE.MeshPhongMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.18, shininess: 120, side: THREE.DoubleSide, depthWrite: false }));
  const glass = kit.mesh(new THREE.LatheGeometry(prof, 28), glassMat, 0);
  glass.renderOrder = 3;
  root.add(glass);
  const rOf = (y: number) => {
    const a = Math.abs(y) / H;
    return 0.012 + 0.085 * Math.sin(Math.min(1, a) * Math.PI * 0.62) ** 1.2;
  };
  // glass highlight streaks (unlit)
  const hl = kit.own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false }));
  for (const s of [1, -1]) {
    const st = new THREE.Mesh(kit.geo(new THREE.PlaneGeometry(0.012, 0.09)), hl);
    st.position.set(-0.05, s * H * 0.55, 0.08);
    st.rotation.z = s * 0.25;
    root.add(st);
  }
  // end caps + posts
  for (const s of [1, -1]) {
    const cap = kit.cyl(0.115, 0.115, 0.035, wood, 18, OL);
    cap.position.y = s * (H + 0.018);
    root.add(cap);
    const trim = kit.mesh(new THREE.TorusGeometry(0.115, 0.007, 6, 24).rotateX(Math.PI / 2), silver, 0);
    trim.position.y = s * (H + 0.002);
    root.add(trim);
    const knob = kit.ball(0.03, silver, 1, 0.6, 1, 10, OL);
    knob.position.y = s * (H + 0.045);
    root.add(knob);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const post = kit.cyl(0.006, 0.006, H * 2, silver, 8, 0.006);
    post.position.set(Math.cos(a) * 0.1, 0, Math.sin(a) * 0.1);
    root.add(post);
  }
  // sand: top cone (shrinks), bottom pile (grows), thin stream
  const top = new THREE.Group();
  root.add(top);
  const topSand = kit.mesh(new THREE.LatheGeometry([new THREE.Vector2(0.001, 0), new THREE.Vector2(1, 1), new THREE.Vector2(0.001, 1)], 20), sandM, 0);
  top.add(topSand);
  const pile = kit.mesh(new THREE.ConeGeometry(1, 1, 20), sandM, 0);
  root.add(pile);
  const stream = kit.mesh(new THREE.CylinderGeometry(0.005, 0.005, 1, 6), sandM, 0);
  root.add(stream);
  const grain = kit.ball(0.011, kit.own(new THREE.MeshBasicMaterial({ color: 0xfff6d8 })), 1, 1, 1, 8, 0);
  grain.visible = false;
  root.add(grain);
  let sand = 0, streamK = 1;
  const apply = () => {
    // top: a funnel of sand sitting on the neck, height shrinking with u
    const ht = H * 0.85 * (1 - sand) ** 0.8;
    const yTop = 0.004 + ht;
    top.visible = ht > 0.004;
    topSand.scale.set(rOf(yTop) * 0.92, ht, rOf(yTop) * 0.92);
    topSand.position.y = 0.004;
    // pile in the bottom bulb
    const hp = H * 0.62 * sand ** 0.7 + 0.01;
    pile.scale.set(Math.min(0.09, 0.05 + 0.04 * sand), hp, Math.min(0.09, 0.05 + 0.04 * sand));
    pile.position.y = -H + hp / 2;
    const flow = streamK * (sand < 0.999 ? 1 : 0);
    stream.visible = flow > 0.01;
    const sTop = 0, sBot = -H + hp;
    stream.scale.set(flow, sTop - sBot, flow);
    stream.position.y = (sTop + sBot) / 2;
  };
  apply();
  const dispose = done(kit, root);
  return {
    root, dispose, grain, neckTop: 0,
    pileTop: () => -H + H * 0.62 * sand ** 0.7 + 0.01,
    setSand(u: number) {
      sand = clamp01(u);
      apply();
    },
    setStream(k: number) {
      streamK = clamp01(k);
      apply();
    },
  };
}

/**
 * Tape measure: yellow case in the fist, the tape runs out along +X. setExtend(m) = metres of tape out.
 * The tape faces +Z (numbers readable from the front) and droops a touch.
 */
export function buildTapeMeasure(): Prop & { setExtend(len: number): void; hookTip: THREE.Object3D } {
  const { kit, root } = base('prop_tape');
  const yellow = kit.toon(0xffd23a, { gloss: 0.8 });
  const black = kit.toon(0x18161c);
  const silver = kit.toon(0xd8dde6, { gloss: 1, shine: 90 });
  const caseG = new THREE.Group();
  caseG.position.set(0.03, 0.02, 0);
  root.add(caseG);
  const body = rbox(kit, 0.15, 0.15, 0.06, 0.03, yellow);
  caseG.add(body);
  const hub = kit.cyl(0.045, 0.045, 0.066, black, 18, OL);
  hub.rotation.x = Math.PI / 2;
  caseG.add(hub);
  const cap = kit.cyl(0.02, 0.02, 0.07, silver, 12, 0);
  cap.rotation.x = Math.PI / 2;
  caseG.add(cap);
  const lock = rbox(kit, 0.04, 0.025, 0.04, 0.008, black);
  lock.position.set(0.0, 0.08, 0);
  caseG.add(lock);
  // a little skull sticker on the case
  const stk = kit.canvas(32, 32, (g) => {
    g.fillStyle = '#f2ead2';
    g.beginPath();
    g.arc(16, 13, 10, 0, Math.PI * 2);
    g.fill();
    g.fillRect(10, 18, 12, 8);
    g.fillStyle = '#18161c';
    g.beginPath();
    g.arc(12, 13, 3, 0, Math.PI * 2);
    g.arc(20, 13, 3, 0, Math.PI * 2);
    g.fill();
    g.fillRect(13, 22, 1, 4);
    g.fillRect(16, 22, 1, 4);
    g.fillRect(19, 22, 1, 4);
  });
  const sticker = new THREE.Mesh(kit.geo(new THREE.PlaneGeometry(0.07, 0.07)), kit.own(new THREE.MeshBasicMaterial({ map: stk, transparent: true })));
  sticker.position.set(-0.04, -0.03, 0.0335);
  caseG.add(sticker);
  // the tape strip: a texture with ticks + numbers, repeated along its length
  const tex = kit.canvas(128, 16, (g, w, h) => {
    g.fillStyle = '#ffe14a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#18161c';
    for (let i = 0; i < 32; i++) {
      const x = i * 4;
      g.fillRect(x, 0, 1, i % 8 === 0 ? 9 : i % 4 === 0 ? 6 : 3);
    }
    g.fillStyle = '#c81e1e';
    g.font = 'bold 7px monospace';
    g.fillText('6', 2, 15);
    g.fillText('FT', 66, 15);
  });
  tex.wrapS = THREE.RepeatWrapping;
  const tapeMat = kit.own(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
  const tapeGeo = kit.geo(new THREE.PlaneGeometry(1, 0.045, 12, 1));
  tapeGeo.translate(0.5, 0, 0);
  const tape = new THREE.Mesh(tapeGeo, tapeMat);
  tape.position.set(0.1, -0.03, 0.0);
  root.add(tape);
  const hookTip = new THREE.Group();
  root.add(hookTip);
  const hook = kit.box(0.008, 0.05, 0.03, kit.toon(0xc8a040, { gloss: 1, shine: 90 }), OL);
  hook.position.set(0, -0.005, 0);
  hookTip.add(hook);
  const p0 = tapeGeo.attributes.position.array.slice() as Float32Array;
  const setExtend = (len: number) => {
    const L = Math.max(0.001, len);
    const p = tapeGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const u = p0[i * 3];
      const x = u * L;
      p.setXYZ(i, x, p0[i * 3 + 1] - 0.006 * L * u * u, p0[i * 3 + 2]);
    }
    p.needsUpdate = true;
    tapeGeo.computeBoundingSphere();
    tex.repeat.x = L / 0.3;
    tape.visible = len > 0.005;
    hookTip.position.set(0.1 + L, -0.03 - 0.006 * L, 0);
  };
  setExtend(0);
  const dispose = done(kit, root);
  return { root, dispose, setExtend, hookTip };
}

/** Funeral candle in a little iron holder (the fist holds the ring). The flame sits at `flame`. setLit(k). */
export function buildCandle(): Prop & { setLit(k: number): void; flame: THREE.Object3D; update(dt: number): void } {
  const { kit, root } = base('prop_candle');
  const wax = kit.toon(0xf4efe2, { gloss: 0.5 });
  const iron = kit.toon(0x2a262e, { gloss: 0.6 });
  const g = new THREE.Group();
  g.position.set(0.08, 0.0, 0);
  root.add(g);
  const dish = kit.cyl(0.08, 0.06, 0.025, iron, 18, OL);
  g.add(dish);
  const ring = kit.mesh(new THREE.TorusGeometry(0.035, 0.009, 6, 14), iron, OL);
  ring.position.set(-0.09, 0, 0);
  ring.rotation.x = Math.PI / 2;
  g.add(ring);
  const stick = kit.cyl(0.035, 0.035, 0.2, wax, 14, OL);
  stick.position.y = 0.11;
  g.add(stick);
  for (const [a, l] of [[0.4, 0.06], [2.3, 0.09], [4.1, 0.05]] as const) {
    const drip = kit.cyl(0.01, 0.012, l, wax, 8, 0);
    drip.position.set(Math.cos(a) * 0.034, 0.2 - l / 2, Math.sin(a) * 0.034);
    g.add(drip);
    const bead = kit.ball(0.012, wax, 1, 1, 1, 8, 0);
    bead.position.set(Math.cos(a) * 0.034, 0.2 - l, Math.sin(a) * 0.034);
    g.add(bead);
  }
  const wick = kit.cyl(0.004, 0.004, 0.03, 0x1a1418, 6, 0);
  wick.position.y = 0.225;
  g.add(wick);
  const flame = new THREE.Group();
  flame.position.y = 0.27;
  g.add(flame);
  const outer = kit.ball(0.028, kit.own(new THREE.MeshBasicMaterial({ color: 0xffa83a, transparent: true, opacity: 0.95 })), 1, 1.9, 1, 12, 0);
  flame.add(outer);
  const inner = kit.ball(0.014, kit.own(new THREE.MeshBasicMaterial({ color: 0xfff6d0 })), 1, 1.7, 1, 10, 0);
  inner.position.y = -0.008;
  flame.add(inner);
  const blue = kit.ball(0.012, kit.own(new THREE.MeshBasicMaterial({ color: 0x5a8aff })), 1, 0.8, 1, 8, 0);
  blue.position.y = -0.04;
  flame.add(blue);
  let lit = 1, t = 0;
  const dispose = done(kit, root);
  const apply = () => {
    flame.visible = lit > 0.02;
    const f = 1 + Math.sin(t * 23) * 0.08 + Math.sin(t * 37) * 0.05;
    flame.scale.set(lit * (1 - (f - 1) * 0.5), lit * f, lit);
    flame.rotation.z = Math.sin(t * 9) * 0.08;
  };
  return {
    root, dispose, flame,
    setLit(k: number) {
      lit = clamp01(k);
      apply();
    },
    update(dt: number) {
      t += dt;
      apply();
    },
  };
}

/**
 * Tombstone, ~1.2 m tall, origin at the ground under its centre, face toward +Z: "R.I.P." over a carved "YOU".
 * setCarved(k 0..1) reveals Y, O, U in turn (each letter pops in with a fresh-cut light edge).
 */
export function buildTombstone(): Prop & { setCarved(k: number): void; letterPos(i: number): THREE.Vector3 } {
  const { kit, root } = base('prop_tombstone');
  const stone = kit.toon(0x8a8c98, { gloss: 0.15 });
  const stoneDk = kit.toon(0x5c5e6a, { gloss: 0.1 });
  const moss = kit.toon(0x4a6a3a, { gloss: 0 });
  const W = 0.8, HH = 0.8, D = 0.2;
  const slab = rbox(kit, W, HH, D, 0.05, stone, 0.02);
  slab.position.y = 0.18 + HH / 2;
  root.add(slab);
  const arch = kit.mesh(new THREE.CylinderGeometry(W / 2, W / 2, D, 28, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), stone, 0.02);
  arch.position.y = 0.18 + HH;
  root.add(arch);
  const baseS = rbox(kit, W + 0.24, 0.18, D + 0.2, 0.03, stoneDk, 0.02);
  baseS.position.y = 0.09;
  root.add(baseS);
  for (const [x, y, r] of [[-0.3, 0.22, 0.09], [0.33, 0.2, 0.07], [-0.36, 0.95, 0.05]] as const) {
    const m = kit.ball(r, moss, 1.4, 0.6, 0.8, 10, 0);
    m.position.set(x, y, D / 2 + 0.01);
    root.add(m);
  }
  // crack
  const crack = kit.box(0.012, 0.2, 0.01, 0x2a2a34, 0);
  crack.position.set(0.28, 0.98, D / 2 + 0.003);
  crack.rotation.z = 0.5;
  root.add(crack);
  const face = (text: string, w: number, h: number, size: number) =>
    kit.canvas(w, h, (g, cw, ch) => {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `${size}px "Press Start 2P", monospace`;
      // carved: dark letter, light lower edge
      g.fillStyle = '#d8dae4';
      g.fillText(text, cw / 2, ch / 2 + 1);
      g.fillStyle = '#2a2a36';
      g.fillText(text, cw / 2, ch / 2);
    });
  const plane = (tex: THREE.Texture, w: number, h: number) =>
    new THREE.Mesh(kit.geo(new THREE.PlaneGeometry(w, h)), kit.own(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })));
  const rip = plane(face('R.I.P.', 96, 24, 16), 0.6, 0.15);
  rip.position.set(0, 1.02, D / 2 + 0.004);
  root.add(rip);
  const letters: THREE.Mesh[] = [];
  'YOU'.split('').forEach((ch, i) => {
    const m = plane(face(ch, 32, 32, 24), 0.36, 0.36);
    m.position.set((i - 1) * 0.24, 0.62, D / 2 + 0.004);
    m.visible = false;
    root.add(m);
    letters.push(m);
  });
  const dispose = done(kit, root);
  return {
    root, dispose,
    setCarved(k: number) {
      letters.forEach((m, i) => {
        const v = clamp01(k * 3 - i);
        m.visible = v > 0.05;
        const s = 0.6 + 0.4 * Math.min(1, v * 1.4);
        m.scale.set(s, s, 1);
      });
    },
    letterPos(i: number) {
      root.updateWorldMatrix(true, false);
      return root.localToWorld(new THREE.Vector3((i - 1) * 0.24, 0.62, D / 2 + 0.02));
    },
  };
}

/** A glossy black coffin with silver handles, lying along +X (for the hearse's roof). ~1.7 m long. */
export function buildCoffin(): Prop {
  const { kit, root } = base('prop_coffin');
  const black = kit.toon(0x141418, { gloss: 1, shine: 80 });
  const silver = kit.toon(0xd8dde6, { gloss: 1, shine: 90 });
  const s = new THREE.Shape();
  const L = 1.7, w0 = 0.22, w1 = 0.3, w2 = 0.18;
  s.moveTo(-L / 2, -w2);
  s.lineTo(L * 0.18, -w1);
  s.lineTo(L / 2, -w0 * 0.75);
  s.lineTo(L / 2, w0 * 0.75);
  s.lineTo(L * 0.18, w1);
  s.lineTo(-L / 2, w2);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.24, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
  g.rotateX(-Math.PI / 2);
  const box = kit.mesh(g, black, 0.025);
  root.add(box);
  const lid = kit.mesh(new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2 }).rotateX(-Math.PI / 2), black, 0.02);
  lid.position.y = 0.27;
  lid.scale.set(0.92, 1, 0.85);
  root.add(lid);
  for (const x of [-0.45, 0.0, 0.45])
    for (const z of [-1, 1]) {
      const h = kit.box(0.18, 0.03, 0.03, silver, 0.01);
      const zz = z * (x > 0.2 ? 0.29 : x < -0.2 ? 0.22 : 0.29);
      h.position.set(x, 0.12, zz);
      root.add(h);
    }
  const plate = kit.box(0.26, 0.012, 0.12, silver, 0.008);
  plate.position.set(0.25, 0.32, 0);
  root.add(plate);
  const dispose = done(kit, root);
  return { root, dispose };
}
