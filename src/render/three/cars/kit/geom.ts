// Geometry helpers for the kit: lathe-style revolves with analytic normals and material groups, face bending,
// merging, polygon insets and planar UVs. Wheel parts are built around the Z axle (outer face toward +Z).
import * as THREE from 'three';

export type P2 = [number, number];

/** A polyline in (r, z) revolved around Z. Normals are smooth within a strip; strips meet with hard edges. */
export interface Strip {
  pts: P2[];
  mat?: number;
  /** v coordinate per point (default: arc length in metres). */
  v?: (r: number, z: number, s: number) => number;
  /** Normal flip (default normal = outward when walking +z along the outside of a cylinder). */
  flip?: boolean;
}

export function revolve(strips: Strip[], segs: number, opts: { phi0?: number; phiLen?: number; uScale?: number } = {}): THREE.BufferGeometry {
  const phi0 = opts.phi0 ?? 0;
  const phiLen = opts.phiLen ?? Math.PI * 2;
  const uScale = opts.uScale ?? 1;
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const byMat = new Map<number, number[]>();
  for (const st of strips) {
    const n = st.pts.length;
    if (n < 2) continue;
    const base = pos.length / 3;
    let s = 0;
    const ns: P2[] = [];
    const vs: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = st.pts[Math.max(0, i - 1)];
      const b = st.pts[Math.min(n - 1, i + 1)];
      let dr = b[0] - a[0];
      let dz = b[1] - a[1];
      const l = Math.hypot(dr, dz) || 1;
      dr /= l;
      dz /= l;
      ns.push(st.flip ? [-dz, dr] : [dz, -dr]);
      if (i > 0) s += Math.hypot(st.pts[i][0] - st.pts[i - 1][0], st.pts[i][1] - st.pts[i - 1][1]);
      vs.push(st.v ? st.v(st.pts[i][0], st.pts[i][1], s) : s);
    }
    for (let j = 0; j <= segs; j++) {
      const ph = phi0 + (j / segs) * phiLen;
      const c = Math.cos(ph);
      const sn = Math.sin(ph);
      for (let i = 0; i < n; i++) {
        const [r, z] = st.pts[i];
        pos.push(r * c, r * sn, z);
        nor.push(ns[i][0] * c, ns[i][0] * sn, ns[i][1]);
        uv.push((j / segs) * uScale, vs[i]);
      }
    }
    // winding: check one quad against the analytic normal
    const mid = Math.floor((n - 1) / 2);
    const P = (i: number, j: number) => new THREE.Vector3().fromArray(pos, (base + j * n + i) * 3);
    const a = P(mid, 0);
    const e1 = P(mid, 1).sub(a);
    const e2 = P(mid + 1, 0).sub(a);
    const fn = new THREE.Vector3().crossVectors(e1, e2);
    const vn = new THREE.Vector3().fromArray(nor, (base + mid) * 3);
    const flipW = fn.dot(vn) < 0;
    const idx = byMat.get(st.mat ?? 0) ?? [];
    byMat.set(st.mat ?? 0, idx);
    for (let j = 0; j < segs; j++)
      for (let i = 0; i < n - 1; i++) {
        const a0 = base + j * n + i;
        const b0 = base + (j + 1) * n + i;
        if (!flipW) idx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1);
        else idx.push(a0, a0 + 1, b0, b0, a0 + 1, b0 + 1);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  const all: number[] = [];
  [...byMat.keys()].sort((x, y) => x - y).forEach((m) => {
    const ix = byMat.get(m) as number[];
    g.addGroup(all.length, ix.length, m);
    for (const k of ix) all.push(k);
  });
  g.setIndex(all);
  return sanitize(g);
}

/** Concatenate geometries (indexed or not) into one non-indexed geometry with position/normal/uv. */
export function merge(geos: THREE.BufferGeometry[], dispose = true): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  for (const g0 of geos) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(u ? u.getX(i) : 0, u ? u.getY(i) : 0);
    }
    if (g !== g0) g.dispose();
    if (dispose) g0.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return sanitize(out);
}

/** Displace z by f(r) (r = distance from the Z axis) and fix normals with the deformation's inverse transpose. */
export function bendZ(g: THREE.BufferGeometry, f: (r: number) => number, df: (r: number) => number): THREE.BufferGeometry {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const r = Math.hypot(x, y) || 1e-6;
    p.setZ(i, p.getZ(i) + f(r));
    const d = df(r);
    const fx = (d * x) / r;
    const fy = (d * y) / r;
    v.set(n.getX(i) - fx * n.getZ(i), n.getY(i) - fy * n.getZ(i), n.getZ(i)).normalize();
    n.setXYZ(i, v.x, v.y, v.z);
  }
  p.needsUpdate = true;
  n.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

/** Planar UVs from x/y: u = x/size + 0.5, v = y/size + 0.5. */
export function planarUV(g: THREE.BufferGeometry, size: number): THREE.BufferGeometry {
  const p = g.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) / size + 0.5;
    uv[i * 2 + 1] = p.getY(i) / size + 0.5;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Inset a convex polygon (CCW, in the XY plane) by d. */
export function insetConvex(pts: P2[], d: number): P2[] {
  const n = pts.length;
  // make CCW
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    area += x0 * y1 - x1 * y0;
  }
  const P = area < 0 ? [...pts].reverse() : pts;
  const lines: { p: P2; d: P2 }[] = [];
  for (let i = 0; i < n; i++) {
    const a = P[i];
    const b = P[(i + 1) % n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l;
    const ny = dx / l; // inward for CCW
    lines.push({ p: [a[0] + nx * d, a[1] + ny * d], d: [dx / l, dy / l] });
  }
  const out: P2[] = [];
  for (let i = 0; i < n; i++) {
    const L0 = lines[(i + n - 1) % n];
    const L1 = lines[i];
    const den = L0.d[0] * L1.d[1] - L0.d[1] * L1.d[0];
    if (Math.abs(den) < 1e-9) {
      out.push(L1.p);
      continue;
    }
    const t = ((L1.p[0] - L0.p[0]) * L1.d[1] - (L1.p[1] - L0.p[1]) * L1.d[0]) / den;
    out.push([L0.p[0] + L0.d[0] * t, L0.p[1] + L0.d[1] * t]);
  }
  return out;
}

/** A closed path with rounded corners (fillet radius rad, clamped per corner). */
export function roundedPath(pts: P2[], rad: number, path: THREE.Path = new THREE.Path()): THREE.Path {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const l0 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const l2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const r = Math.min(rad, l0 * 0.45, l2 * 0.45);
    const a: P2 = [p1[0] + ((p0[0] - p1[0]) / l0) * r, p1[1] + ((p0[1] - p1[1]) / l0) * r];
    const b: P2 = [p1[0] + ((p2[0] - p1[0]) / l2) * r, p1[1] + ((p2[1] - p1[1]) / l2) * r];
    if (i === 0) path.moveTo(a[0], a[1]);
    else path.lineTo(a[0], a[1]);
    path.quadraticCurveTo(p1[0], p1[1], b[0], b[1]);
  }
  path.closePath();
  return path;
}

/** An annular sector (polar window) as a closed point loop, sampled along the arcs. */
export function sector(r0: number, r1: number, a0: number, a1: number, steps = 8): P2[] {
  const pts: P2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push([Math.cos(a) * r1, Math.sin(a) * r1]);
  }
  for (let i = steps; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push([Math.cos(a) * r0, Math.sin(a) * r0]);
  }
  return pts;
}

/** A circle as an explicit polyline (n points), so curveSegments can stay low for the fillets elsewhere. */
export function circlePts(x: number, y: number, r: number, n: number, cw = false): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const a = ((cw ? -i : i) / n) * Math.PI * 2;
    pts.push(new THREE.Vector2(x + Math.cos(a) * r, y + Math.sin(a) * r));
  }
  return pts;
}

export function circlePath(x: number, y: number, r: number, cw = false, n = 14): THREE.Path {
  const p = new THREE.Path();
  p.setFromPoints(circlePts(x, y, r, n, cw));
  p.closePath();
  return p;
}

export function circleShape(r: number, n: number): THREE.Shape {
  const s = new THREE.Shape();
  s.setFromPoints(circlePts(0, 0, r, n));
  s.closePath();
  return s;
}

export const polar = (r: number, a: number): P2 => [Math.cos(a) * r, Math.sin(a) * r];

/**
 * Remove zero-area triangles and repair zero-length normals. Degenerate triangles (duplicate outline points from
 * fillets / closed polylines) get zero normals, which shade as NaN and bloom into white blobs.
 */
export function sanitize(g: THREE.BufferGeometry, fallback = new THREE.Vector3(0, 0, 1)): THREE.BufferGeometry {
  const p = g.attributes.position;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const area = (i: number, j: number, k: number) => {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, j).sub(a);
    c.fromBufferAttribute(p, k).sub(a);
    return b.cross(c).lengthSq();
  };
  if (g.index) {
    const ix = g.index;
    const keep: number[] = [];
    for (let t = 0; t < ix.count; t += 3) {
      const i = ix.getX(t), j = ix.getX(t + 1), k = ix.getX(t + 2);
      if (area(i, j, k) > 1e-16) keep.push(i, j, k);
    }
    if (keep.length !== ix.count) {
      // keep material groups consistent only when there are none (kit extrudes/grids have a single group)
      if (!g.groups.length) g.setIndex(keep);
    }
  } else if (!g.groups.length) {
    const keep: number[] = [];
    for (let t = 0; t < p.count; t += 3) if (area(t, t + 1, t + 2) > 1e-16) keep.push(t);
    if (keep.length * 3 !== p.count) {
      for (const name of Object.keys(g.attributes)) {
        const at = g.attributes[name] as THREE.BufferAttribute;
        const arr = new Float32Array(keep.length * 3 * at.itemSize);
        keep.forEach((t, i) => {
          for (let k = 0; k < 3; k++) for (let q = 0; q < at.itemSize; q++) arr[(i * 3 + k) * at.itemSize + q] = at.array[(t + k) * at.itemSize + q];
        });
        g.setAttribute(name, new THREE.BufferAttribute(arr, at.itemSize));
      }
    }
  }
  const n = g.attributes.normal;
  if (n)
    for (let i = 0; i < n.count; i++) {
      const l = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
      if (!(l > 0.5)) n.setXYZ(i, fallback.x, fallback.y, fallback.z);
      else if (Math.abs(l - 1) > 1e-3) n.setXYZ(i, n.getX(i) / l, n.getY(i) / l, n.getZ(i) / l);
    }
  g.computeBoundingSphere();
  return g;
}

/** Extrude a shape along +Z from z0 by depth with a small bevel (curveSegments controls arc smoothness). */
export function extrude(shape: THREE.Shape | THREE.Shape[], depth: number, bevel: number, curveSegments = 10, z0 = 0, bevelSegments = 2): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(1e-4, depth - bevel * 2),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments,
    curveSegments,
  });
  g.translate(0, 0, z0 + bevel);
  return sanitize(g);
}

/** Drop back-facing cap triangles (normal pointing -Z) from a non-indexed extrusion: never seen on wheel faces. */
export function dropBack(g: THREE.BufferGeometry, below = -0.9): THREE.BufferGeometry {
  const n = g.attributes.normal;
  const keep: number[] = [];
  for (let t = 0; t < n.count; t += 3) if (!(n.getZ(t) < below && n.getZ(t + 1) < below && n.getZ(t + 2) < below)) keep.push(t);
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name] as THREE.BufferAttribute;
    const arr = new Float32Array(keep.length * 3 * a.itemSize);
    keep.forEach((t, i) => {
      for (let k = 0; k < 3; k++) for (let c = 0; c < a.itemSize; c++) arr[(i * 3 + k) * a.itemSize + c] = a.array[(t + k) * a.itemSize + c];
    });
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  g.dispose();
  out.computeBoundingSphere();
  return out;
}

/** Smooth vertex normals on a non-indexed geometry by welding positions (crease angle in radians). */
export function smoothNormals(g: THREE.BufferGeometry, crease = 0.6): THREE.BufferGeometry {
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const key = (i: number) => `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < p.count; i++) {
    const k = key(i);
    const b = buckets.get(k);
    if (b) b.push(i);
    else buckets.set(k, [i]);
  }
  const cosC = Math.cos(crease);
  const out = new Float32Array(n.count * 3);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const s = new THREE.Vector3();
  for (const ids of buckets.values())
    for (const i of ids) {
      a.fromBufferAttribute(n, i);
      s.set(0, 0, 0);
      for (const j of ids) {
        b.fromBufferAttribute(n, j);
        if (a.dot(b) >= cosC) s.add(b);
      }
      s.normalize();
      out[i * 3] = s.x;
      out[i * 3 + 1] = s.y;
      out[i * 3 + 2] = s.z;
    }
  g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  return g;
}

/** Tube along a polyline/curve with a fixed radius. */
export function tube(points: THREE.Vector3[], radius: number, radial = 10, tubular = 24): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.2);
  return new THREE.TubeGeometry(curve, tubular, radius, radial, false);
}
