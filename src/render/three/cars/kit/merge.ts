// Draw-call reduction: after assembly, every static mesh under a root (hand-built body + body-mounted kit) is baked
// into ONE mesh per material, in the root's space. Animated parts are excluded. Light toggles keep working because
// they drive materials, and Look's livery hook (onBeforeRender) is carried over to the merged paint mesh.
import * as THREE from 'three';
import { isShared } from './res';

interface Bucket {
  mat: THREE.Material;
  parts: THREE.BufferGeometry[];
  cast: boolean;
  receive: boolean;
  order: number;
  hook?: THREE.Mesh['onBeforeRender'];
  colors: boolean;
  names: Set<string>;
}

const noop = THREE.Object3D.prototype.onBeforeRender;

/** Triangles of one material group as a standalone non-indexed geometry with position/normal/uv(/color). */
function piece(src: THREE.BufferGeometry, start: number, count: number, m: THREE.Matrix4, colors: boolean): THREE.BufferGeometry {
  const idx = src.index;
  const P = src.attributes.position;
  const N = src.attributes.normal;
  const U = src.attributes.uv;
  const C = src.attributes.color;
  const total = idx ? idx.count : P.count;
  const s0 = Math.max(0, start);
  const e0 = Math.min(total, start + count);
  const n = Math.max(0, e0 - s0);
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const col = colors ? new Float32Array(n * 3) : null;
  const nm = new THREE.Matrix3().getNormalMatrix(m);
  const flip = m.determinant() < 0;
  const v = new THREE.Vector3();
  for (let k = 0; k < n; k++) {
    // flip winding for mirrored parts so they stay front-facing once baked
    const kk = flip ? k - (k % 3) + (2 - (k % 3)) : k;
    const i = idx ? idx.getX(s0 + kk) : s0 + kk;
    v.fromBufferAttribute(P, i).applyMatrix4(m);
    pos.set([v.x, v.y, v.z], k * 3);
    if (N) {
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      if (!Number.isFinite(v.x + v.y + v.z) || v.lengthSq() < 0.25) v.set(0, 1, 0);
      nor.set([v.x, v.y, v.z], k * 3);
    }
    if (U) uv.set([U.getX(i), U.getY(i)], k * 2);
    if (col) {
      if (C) col.set([C.getX(i), C.getY(i), C.getZ(i)], k * 3);
      else col.set([1, 1, 1], k * 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!N) g.computeVertexNormals();
  return g;
}

function concat(parts: THREE.BufferGeometry[], colors: boolean): THREE.BufferGeometry {
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const col = colors ? new Float32Array(n * 3) : null;
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    nor.set(p.attributes.normal.array as Float32Array, o * 3);
    uv.set(p.attributes.uv.array as Float32Array, o * 2);
    if (col && p.attributes.color) col.set(p.attributes.color.array as Float32Array, o * 3);
    o += p.attributes.position.count;
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export interface MergeResult {
  /** Old mesh → the merged mesh that now draws it (for re-pointing paintMeshes / light lists). */
  map: Map<THREE.Mesh, THREE.Mesh>;
  meshes: THREE.Mesh[];
}

/**
 * Bake every visible static mesh under `root` (except `exclude` subtrees, instanced/skinned meshes) into one mesh
 * per material, parented to `root`. Source geometries that are not shared are disposed.
 */
export function mergeStatic(root: THREE.Object3D, exclude: THREE.Object3D[] = []): MergeResult {
  root.updateWorldMatrix(true, true);
  const inv = root.matrixWorld.clone().invert();
  const skip = new Set<THREE.Object3D>();
  for (const e of exclude) e.traverse((o) => skip.add(o));
  const buckets = new Map<THREE.Material, Bucket>();
  const victims: THREE.Mesh[] = [];
  const m = new THREE.Matrix4();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || skip.has(mesh) || (mesh as unknown as THREE.InstancedMesh).isInstancedMesh || (mesh as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
    if (!mesh.visible || mesh.morphTargetInfluences?.length) return;
    // hidden ancestors keep their meshes out (e.g. optional parts toggled off)
    let p: THREE.Object3D | null = mesh.parent;
    while (p && p !== root) {
      if (!p.visible) return;
      p = p.parent;
    }
    const g = mesh.geometry as THREE.BufferGeometry;
    if (!g?.attributes?.position) return;
    m.multiplyMatrices(inv, mesh.matrixWorld);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const total = g.index ? g.index.count : g.attributes.position.count;
    const groups = Array.isArray(mesh.material) && g.groups.length ? g.groups : [{ start: g.drawRange.start, count: Math.min(total, g.drawRange.count), materialIndex: 0 }];
    for (const gr of groups) {
      const mat = mats[gr.materialIndex ?? 0];
      if (!mat) continue;
      let b = buckets.get(mat);
      if (!b) {
        b = { mat, parts: [], cast: false, receive: false, order: mesh.renderOrder, colors: !!(mat as THREE.MeshStandardMaterial).vertexColors, names: new Set() };
        buckets.set(mat, b);
      }
      b.parts.push(piece(g, gr.start, gr.count, m, b.colors));
      b.cast ||= mesh.castShadow;
      b.receive ||= mesh.receiveShadow;
      b.order = Math.max(b.order, mesh.renderOrder);
      if (mesh.onBeforeRender !== noop) b.hook = mesh.onBeforeRender;
      if (mesh.name) b.names.add(mesh.name);
    }
    victims.push(mesh);
  });
  const map = new Map<THREE.Mesh, THREE.Mesh>();
  const meshes: THREE.Mesh[] = [];
  const byMat = new Map<THREE.Material, THREE.Mesh>();
  for (const b of buckets.values()) {
    const mesh = new THREE.Mesh(concat(b.parts, b.colors), b.mat);
    mesh.name = 'merged:' + [...b.names].slice(0, 3).join('+');
    mesh.castShadow = b.cast && !b.mat.transparent;
    mesh.receiveShadow = b.receive;
    mesh.renderOrder = b.order;
    if (b.hook) mesh.onBeforeRender = b.hook;
    root.add(mesh);
    meshes.push(mesh);
    byMat.set(b.mat, mesh);
  }
  for (const v of victims) {
    const mat = Array.isArray(v.material) ? v.material[0] : v.material;
    const to = byMat.get(mat);
    if (to) map.set(v, to);
    v.removeFromParent();
    if (!isShared(v.geometry)) v.geometry.dispose();
  }
  return { map, meshes };
}
