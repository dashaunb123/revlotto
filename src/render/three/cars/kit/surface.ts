// Axis-aligned ray casts against a hand-built body (in body space), so kit parts can sit ON any body: hood pieces
// follow the hood, wings find the deck and its trailing edge, splitters trace the bumper, skirts follow the sills.
// Triangles are bucketed per projection plane, so a cast only tests a handful of triangles.
import * as THREE from 'three';

export interface Hit {
  /** The coordinate along the ray axis (y for down/up, z for side, x for front/rear). */
  d: number;
  n: THREE.Vector3;
  paint: boolean;
  glass: boolean;
}

type Plane = 'xz' | 'xy' | 'yz';
const AX: Record<Plane, [number, number, number]> = { xz: [0, 2, 1], xy: [0, 1, 2], yz: [1, 2, 0] }; // [a, b, ray axis]

export class BodySurface {
  private pos: Float32Array;
  private nor: Float32Array;
  private flag: Uint8Array; // 1 paint, 2 glass
  private count: number;
  private grids = new Map<Plane, { min: [number, number]; cell: number; nx: number; ny: number; cells: Int32Array[] }>();
  readonly box = new THREE.Box3();

  constructor(body: THREE.Object3D, paint: Set<THREE.Object3D>, skip?: THREE.Object3D) {
    body.updateWorldMatrix(true, true);
    const inv = body.matrixWorld.clone().invert();
    const P: number[] = [];
    const N: number[] = [];
    const F: number[] = [];
    const m = new THREE.Matrix4();
    const nm = new THREE.Matrix3();
    const v = new THREE.Vector3();
    const skipSet = new Set<THREE.Object3D>();
    skip?.traverse((o) => skipSet.add(o));
    body.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || skipSet.has(mesh) || !mesh.visible) return;
      const g = mesh.geometry as THREE.BufferGeometry;
      const pa = g.attributes.position;
      if (!pa) return;
      const na = g.attributes.normal;
      m.multiplyMatrices(inv, mesh.matrixWorld);
      nm.getNormalMatrix(m);
      const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material | undefined;
      const isGlass = !!mat && (mat.transparent || /glass|window|windshield|lens/i.test(mesh.name + (mat.name ?? '')));
      const fl = paint.has(mesh) ? 1 : isGlass ? 2 : 0;
      const idx = g.index;
      const tri = idx ? idx.count / 3 : pa.count / 3;
      for (let t = 0; t < tri; t++)
        for (let c = 0; c < 3; c++) {
          const i = idx ? idx.getX(t * 3 + c) : t * 3 + c;
          v.fromBufferAttribute(pa, i).applyMatrix4(m);
          P.push(v.x, v.y, v.z);
          if (na) v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
          else v.set(0, 0, 0);
          N.push(v.x, v.y, v.z);
          if (c === 0) F.push(fl);
        }
    });
    this.pos = new Float32Array(P);
    this.nor = new Float32Array(N);
    this.flag = new Uint8Array(F);
    this.count = F.length;
    for (let i = 0; i < P.length; i += 3) this.box.expandByPoint(v.set(P[i], P[i + 1], P[i + 2]));
    // flat-shaded meshes without normals: use face normals
    for (let t = 0; t < this.count; t++) {
      const o = t * 9;
      if (this.nor[o] === 0 && this.nor[o + 1] === 0 && this.nor[o + 2] === 0) {
        const a = new THREE.Vector3(this.pos[o], this.pos[o + 1], this.pos[o + 2]);
        const b = new THREE.Vector3(this.pos[o + 3], this.pos[o + 4], this.pos[o + 5]);
        const c = new THREE.Vector3(this.pos[o + 6], this.pos[o + 7], this.pos[o + 8]);
        const n = b.sub(a).cross(c.sub(a)).normalize();
        for (let k = 0; k < 3; k++) this.nor.set([n.x, n.y, n.z], o + k * 3);
      }
    }
  }

  private grid(p: Plane) {
    let g = this.grids.get(p);
    if (g) return g;
    const [A, B] = AX[p];
    const lo: [number, number] = [Infinity, Infinity];
    const hi: [number, number] = [-Infinity, -Infinity];
    for (let i = 0; i < this.pos.length; i += 3) {
      lo[0] = Math.min(lo[0], this.pos[i + A]);
      lo[1] = Math.min(lo[1], this.pos[i + B]);
      hi[0] = Math.max(hi[0], this.pos[i + A]);
      hi[1] = Math.max(hi[1], this.pos[i + B]);
    }
    const cell = 0.04;
    const nx = Math.max(1, Math.ceil((hi[0] - lo[0]) / cell) + 1);
    const ny = Math.max(1, Math.ceil((hi[1] - lo[1]) / cell) + 1);
    const lists: number[][] = Array.from({ length: nx * ny }, () => []);
    for (let t = 0; t < this.count; t++) {
      const o = t * 9;
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const a = this.pos[o + k * 3 + A];
        const b = this.pos[o + k * 3 + B];
        a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
      }
      const i0 = Math.floor((a0 - lo[0]) / cell), i1 = Math.floor((a1 - lo[0]) / cell);
      const j0 = Math.floor((b0 - lo[1]) / cell), j1 = Math.floor((b1 - lo[1]) / cell);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) lists[j * nx + i]?.push(t);
    }
    g = { min: lo, cell, nx, ny, cells: lists.map((l) => Int32Array.from(l)) };
    this.grids.set(p, g);
    return g;
  }

  /** Cast along an axis at (a, b) in the plane; returns the extreme hit (max or min along the ray axis). */
  private cast(p: Plane, a: number, b: number, takeMax: boolean, filter?: (fl: number) => boolean): Hit | null {
    const g = this.grid(p);
    const i = Math.floor((a - g.min[0]) / g.cell);
    const j = Math.floor((b - g.min[1]) / g.cell);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) return null;
    const [A, B, C] = AX[p];
    let best: Hit | null = null;
    const P = this.pos;
    for (const t of g.cells[j * g.nx + i]) {
      if (filter && !filter(this.flag[t])) continue;
      const o = t * 9;
      const ax = P[o + A], ay = P[o + B];
      const bx = P[o + 3 + A], by = P[o + 3 + B];
      const cx = P[o + 6 + A], cy = P[o + 6 + B];
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-12) continue;
      const w0 = ((by - cy) * (a - cx) + (cx - bx) * (b - cy)) / den;
      const w1 = ((cy - ay) * (a - cx) + (ax - cx) * (b - cy)) / den;
      const w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const d = w0 * P[o + C] + w1 * P[o + 3 + C] + w2 * P[o + 6 + C];
      if (best && (takeMax ? d <= best.d : d >= best.d)) continue;
      const N = this.nor;
      const n = new THREE.Vector3(
        w0 * N[o] + w1 * N[o + 3] + w2 * N[o + 6],
        w0 * N[o + 1] + w1 * N[o + 4] + w2 * N[o + 7],
        w0 * N[o + 2] + w1 * N[o + 5] + w2 * N[o + 8],
      ).normalize();
      best = { d, n, paint: this.flag[t] === 1, glass: this.flag[t] === 2 };
    }
    return best;
  }

  /** Highest surface at (x, z) (a ray from above). */
  down(x: number, z: number, filter?: (fl: number) => boolean): Hit | null {
    return this.cast('xz', x, z, true, filter);
  }
  /** Lowest surface at (x, z) (a ray from below). */
  up(x: number, z: number): Hit | null {
    return this.cast('xz', x, z, false);
  }
  /** Outermost surface at (x, y) on the left (+z, s = 1) or right (s = -1) side. */
  side(x: number, y: number, s = 1): Hit | null {
    return this.cast('xy', x, y, s > 0);
  }
  /** Frontmost (s = 1) or rearmost (s = -1) surface at (y, z). */
  front(y: number, z: number, s = 1): Hit | null {
    return this.cast('yz', y, z, s > 0);
  }
}
