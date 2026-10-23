// Ivy's crushables and tools: a welding torch, a gold trophy, a car door, and a tiny toy of YOUR car. Every
// crushable has crush(k 0..1): squashed flat along X (the vise's clamp axis), bulging out in Y/Z, and crumpled with
// hashed wrinkles (vertices are deformed in the prop's root frame, so outlines follow). Root origin = centre of
// the thing; +X across the jaws, +Y up, +Z faces the camera. Each has dispose().
import * as THREE from 'three';
import { Kit, outlineTree } from './kit';
import { roundedBoxGeometry } from './props';

export interface Crushable {
  root: THREE.Group;
  /** 0 = pristine, 1 = a flat crumpled wafer. */
  crush(k: number): void;
  /** Width across the jaws at rest (prop-local metres). */
  width: number;
  dispose(): void;
}

const OL = 0.012;
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Snapshot every (non-hull) mesh under root in root space; crush(k) deforms them. */
function crushRig(root: THREE.Group, width: number, flatTo = 0.12, wrinkle = 0.06) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const items: { geo: THREE.BufferGeometry; rest: Float32Array; toRoot: THREE.Matrix4; toMesh: THREE.Matrix4; seed: number }[] = [];
  const seen = new Set<THREE.BufferGeometry>();
  let n = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.hull || seen.has(m.geometry)) return;
    seen.add(m.geometry);
    const toRoot = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    items.push({ geo: m.geometry, rest: Float32Array.from(m.geometry.attributes.position.array as Float32Array), toRoot, toMesh: toRoot.clone().invert(), seed: n++ * 17.3 });
  });
  const v = new THREE.Vector3();
  return (k: number) => {
    // linear in k (the scene eases it): k = 1 - (width now / width at rest) / (1 - flatTo)
    k = Math.min(1, Math.max(0, k));
    const e = k;
    const sx = 1 - (1 - flatTo) * e;
    const bulge = 1 + 0.28 * e;
    for (const it of items) {
      const p = it.geo.attributes.position as THREE.BufferAttribute;
      const a = p.array as Float32Array;
      for (let i = 0; i < p.count; i++) {
        v.set(it.rest[i * 3], it.rest[i * 3 + 1], it.rest[i * 3 + 2]).applyMatrix4(it.toRoot);
        // quantise so coincident verts on seams move together (no cracks)
        const q = Math.round(v.x * 40) * 3.1 + Math.round(v.y * 40) * 7.7 + Math.round(v.z * 40) * 1.3;
        const w = (hash(q) - 0.5) * wrinkle * Math.sin(Math.PI * Math.min(1, k * 1.3) * 0.5 + 0.2) * 2 * Math.sqrt(e);
        v.x = v.x * sx + w * 0.5;
        v.y = v.y * bulge + w * 0.6 * (hash(q + 3) - 0.5);
        v.z = v.z * bulge + w;
        v.applyMatrix4(it.toMesh);
        a[i * 3] = v.x;
        a[i * 3 + 1] = v.y;
        a[i * 3 + 2] = v.z;
      }
      p.needsUpdate = true;
      it.geo.computeVertexNormals();
      it.geo.computeBoundingSphere();
    }
    void width;
  };
}

function done(kit: Kit, root: THREE.Group, width: number, flatTo?: number, wrinkle?: number): Crushable {
  outlineTree(root, kit.outlineMat);
  const crush = crushRig(root, width, flatTo, wrinkle);
  return {
    root, width, crush,
    dispose() {
      root.removeFromParent();
      kit.dispose();
    },
  };
}

const rbox = (kit: Kit, w: number, h: number, d: number, r: number, mat: THREE.Material, seg = 3) => kit.mesh(roundedBoxGeometry(w, h, d, r, seg), mat, OL);

/** Gold "#1" trophy cup on a black plinth (~0.5 wide, 0.72 tall). */
export function buildTrophy(): Crushable {
  const kit = new Kit();
  const root = new THREE.Group();
  const gold = kit.toon(0xffc83a, { gloss: 1, shine: 100 });
  const black = kit.toon(0x1c1a22, { gloss: 0.6 });
  const plinth = rbox(kit, 0.34, 0.12, 0.26, 0.03, black);
  plinth.position.y = -0.3;
  root.add(plinth);
  const plaque = kit.box(0.2, 0.06, 0.01, gold, 0);
  plaque.position.set(0, -0.3, 0.135);
  root.add(plaque);
  const stem = kit.lathe([new THREE.Vector2(0.09, -0.24), new THREE.Vector2(0.03, -0.18), new THREE.Vector2(0.03, -0.06), new THREE.Vector2(0.06, -0.02)], gold, 24, OL);
  root.add(stem);
  const cup = kit.lathe(
    [new THREE.Vector2(0.0, -0.03), new THREE.Vector2(0.12, 0.0), new THREE.Vector2(0.17, 0.1), new THREE.Vector2(0.19, 0.22), new THREE.Vector2(0.2, 0.3), new THREE.Vector2(0.17, 0.3), new THREE.Vector2(0.0, 0.2)],
    gold, 28, OL,
  );
  root.add(cup);
  for (const s of [-1, 1]) {
    const handle = kit.mesh(new THREE.TorusGeometry(0.07, 0.018, 8, 14, Math.PI * 1.2), gold, OL);
    handle.position.set(s * 0.2, 0.17, 0);
    handle.rotation.z = s > 0 ? -Math.PI * 0.6 : Math.PI * 1.6;
    root.add(handle);
  }
  // a star on the cup + glints
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 0.025 : 0.06;
    i ? star.lineTo(Math.cos(a) * r, Math.sin(a) * r) : star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const st = kit.mesh(new THREE.ExtrudeGeometry(star, { depth: 0.012, bevelEnabled: false }), kit.toon(0xfff2b0, { emissive: 0xffd040, emissiveIntensity: 0.4 }), 0);
  st.position.set(0, 0.16, 0.175);
  st.rotation.x = -0.12;
  root.add(st);
  const gl = kit.box(0.025, 0.16, 0.01, kit.own(new THREE.MeshBasicMaterial({ color: 0xffffff })), 0);
  gl.position.set(-0.1, 0.17, 0.16);
  gl.rotation.set(-0.1, -0.5, -0.15);
  root.add(gl);
  return done(kit, root, 0.5, 0.14, 0.05);
}

/** A car door (blue paint, chrome handle, window) standing on its edge (~0.58 wide across the jaws, 0.5 tall). */
export function buildCarDoor(): Crushable {
  const kit = new Kit();
  const root = new THREE.Group();
  const paint = kit.toon(0x3a7ae0, { gloss: 1, shine: 90 });
  const chrome = kit.toon(0xe2e7ee, { gloss: 1, shine: 110 });
  const glass = kit.toon(0x9cd8ff, { gloss: 1, shine: 120 });
  // the door panel faces the camera (+Z), its long axis across the jaws (X)
  const panel = rbox(kit, 0.58, 0.3, 0.06, 0.025, paint, 4);
  panel.position.y = -0.08;
  root.add(panel);
  const frame = rbox(kit, 0.5, 0.2, 0.03, 0.012, paint, 3);
  frame.position.set(0.03, 0.17, 0);
  root.add(frame);
  const win = kit.box(0.42, 0.15, 0.035, glass, 0);
  win.position.set(0.03, 0.17, 0);
  root.add(win);
  const handle = rbox(kit, 0.1, 0.025, 0.03, 0.01, chrome, 2);
  handle.position.set(-0.17, -0.02, 0.04);
  root.add(handle);
  const stripe = kit.box(0.58, 0.035, 0.065, kit.toon(0xf4f0e6), 0);
  stripe.position.set(0, -0.13, 0);
  root.add(stripe);
  const num = kit.cyl(0.07, 0.07, 0.066, kit.toon(0xf4f0e6), 16, 0);
  num.rotation.x = Math.PI / 2;
  num.position.set(0.12, -0.05, 0);
  root.add(num);
  return done(kit, root, 0.58, 0.12, 0.07);
}

/**
 * A tiny toy of YOUR car (cream with a red racing stripe and a "YOU" tag on the roof), ~0.5 long across the
 * jaws. Exposes its wheels + windscreen + tag for flinging as debris (scene re-parents them).
 */
export function buildToyCar(): Crushable & { wheels: THREE.Object3D[]; glass: THREE.Object3D; tag: THREE.Object3D } {
  const kit = new Kit();
  const root = new THREE.Group();
  const paint = kit.toon(0xf4ecd8, { gloss: 1, shine: 90 });
  const red = kit.toon(0xe8413c, { gloss: 1, shine: 90 });
  const tyre = kit.toon(0x1a1a20, { gloss: 0.3 });
  const hubM = kit.toon(0xd8dde6, { gloss: 1 });
  const body = rbox(kit, 0.5, 0.12, 0.24, 0.05, paint, 4);
  body.position.y = 0.0;
  root.add(body);
  const cabin = rbox(kit, 0.26, 0.1, 0.2, 0.04, paint, 3);
  cabin.position.set(-0.02, 0.1, 0);
  root.add(cabin);
  const stripe = kit.box(0.5, 0.125, 0.06, red, 0);
  stripe.position.set(0, 0.002, 0);
  root.add(stripe);
  const glassM = kit.toon(0x2b3d66, { gloss: 1, shine: 120 });
  const glass = kit.box(0.2, 0.07, 0.205, glassM, 0);
  glass.position.set(-0.02, 0.105, 0);
  root.add(glass);
  // "YOU" tag on a little flag
  const tex = kit.canvas(32, 16, (g, w, h) => {
    g.fillStyle = '#ffd23f';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#16141a';
    g.font = 'bold 12px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('YOU', w / 2, h / 2 + 1);
  });
  const tag = new THREE.Group();
  tag.position.set(-0.04, 0.16, 0);
  root.add(tag);
  const pole = kit.box(0.008, 0.12, 0.008, tyre, 0);
  pole.position.y = 0.06;
  tag.add(pole);
  const flag = new THREE.Mesh(kit.geo(new THREE.PlaneGeometry(0.13, 0.065)), kit.own(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })));
  flag.position.set(0.07, 0.09, 0);
  tag.add(flag);
  const wheels: THREE.Object3D[] = [];
  for (const x of [-0.16, 0.16])
    for (const z of [-0.12, 0.12]) {
      const w = new THREE.Group();
      w.position.set(x, -0.06, z);
      root.add(w);
      const t = kit.cyl(0.06, 0.06, 0.05, tyre, 16, OL);
      t.rotation.x = Math.PI / 2;
      w.add(t);
      const hub = kit.cyl(0.03, 0.03, 0.055, hubM, 12, 0);
      hub.rotation.x = Math.PI / 2;
      w.add(hub);
      wheels.push(w);
    }
  const c = done(kit, root, 0.5, 0.12, 0.08);
  return Object.assign(c, { wheels, glass, tag });
}

/** Welding torch (stinger): orange handle in the fist (+X forward), copper nozzle; `tip` is where the arc burns. */
export function buildTorch(): { root: THREE.Group; tip: THREE.Object3D; dispose(): void } {
  const kit = new Kit();
  const root = new THREE.Group();
  const grip = kit.mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.2, 14).rotateZ(-Math.PI / 2), kit.toon(0xff8a1f, { gloss: 0.6 }), OL);
  grip.position.x = 0.02;
  root.add(grip);
  const neck = kit.mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.18, 10).rotateZ(-Math.PI / 2), kit.toon(0x2a2d34, { gloss: 0.6 }), OL);
  neck.position.set(0.2, 0.0, 0);
  root.add(neck);
  const nozzle = kit.mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.08, 12).rotateZ(-Math.PI / 2), kit.toon(0xd08a4a, { gloss: 1 }), OL);
  nozzle.position.set(0.32, 0, 0);
  root.add(nozzle);
  const cable = kit.mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8).rotateZ(-Math.PI / 2), kit.toon(0x16141a), 0);
  cable.position.set(-0.22, -0.02, 0);
  cable.rotation.z = 0.4;
  root.add(cable);
  const tip = new THREE.Object3D();
  tip.position.set(0.39, 0, 0);
  root.add(tip);
  outlineTree(root, kit.outlineMat);
  return { root, tip, dispose: () => (root.removeFromParent(), kit.dispose()) };
}
