// Geometry helpers for the strip: profile extrusions along X, members between points, merged batches.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Extrude a closed-or-open (z, y) profile along X from x0 to x1. Flat-shaded per profile edge. UV: u = x / uScale, v = arc length / vScale. */
export function extrudeX(profile: [number, number][], x0: number, x1: number, uScale = 3, vScale = 3, closed = false): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const n = profile.length;
  let arc = 0;
  const edges = closed ? n : n - 1;
  for (let i = 0; i < edges; i++) {
    const [z0, y0] = profile[i], [z1, y1] = profile[(i + 1) % n];
    const len = Math.hypot(z1 - z0, y1 - y0);
    // profile runs from the -Z side over the top to the +Z side (clockwise in a z-right / y-up plot)
    const nz = -(y1 - y0) / len, ny = (z1 - z0) / len;
    const b = pos.length / 3;
    for (const [x, z, y, a] of [[x0, z0, y0, arc], [x1, z0, y0, arc], [x1, z1, y1, arc + len], [x0, z1, y1, arc + len]]) {
      pos.push(x, y, z);
      nor.push(0, ny, nz);
      uv.push(x / uScale, a / vScale);
    }
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    arc += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** End cap for an extrusion (convex profile assumed), facing -X (dir = -1) or +X (dir = 1). */
export function capX(profile: [number, number][], x: number, dir: 1 | -1): THREE.BufferGeometry {
  const shape = new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ShapeGeometry(shape);
  // ShapeGeometry is in XY; map shape (z, y) → world (x, y, z)
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const z = p.getX(i), y = p.getY(i);
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, dir, 0, 0);
  // (sx, sy) → (z, y) mirrors the winding, so shape-CCW triangles already face -X
  if (dir === 1) {
    const ix = g.getIndex()!;
    for (let i = 0; i < ix.count; i += 3) {
      const a = ix.getX(i + 1);
      ix.setX(i + 1, ix.getX(i + 2));
      ix.setX(i + 2, a);
    }
  }
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);
/** A cylinder member from a to b. */
export function member(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/** Axis-aligned box centred at (x, y, z), optional Y rotation. */
export function box(w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

/** Box truss between two points (rectangular section w × h, rotated about the axis so `up` is the section's height). */
export function truss(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, step: number, r = 0.035, up = new THREE.Vector3(0, 1, 0)): THREE.BufferGeometry {
  const ax = new THREE.Vector3().subVectors(b, a);
  const len = ax.length();
  ax.normalize();
  const side = new THREE.Vector3().crossVectors(ax, up).normalize();
  const vup = new THREE.Vector3().crossVectors(side, ax).normalize();
  const corner = (i: number, t: number) => {
    const sx = i & 1 ? 0.5 : -0.5, sy = i & 2 ? 0.5 : -0.5;
    return a.clone().addScaledVector(ax, t).addScaledVector(side, sx * w).addScaledVector(vup, sy * h);
  };
  const gs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) gs.push(member(corner(i, 0), corner(i, len), r * 1.4));
  const n = Math.max(1, Math.round(len / step));
  for (let k = 0; k <= n; k++) {
    const t = (k / n) * len, t2 = ((k + 1) / n) * len;
    const ring = [0, 1, 3, 2];
    for (let j = 0; j < 4; j++) gs.push(member(corner(ring[j], t), corner(ring[(j + 1) % 4], t), r * 0.8, 4));
    if (k < n) for (let j = 0; j < 4; j++) gs.push(member(corner(ring[j], t), corner(ring[(j + 1) % 4], t2), r * 0.7, 4));
  }
  return merge(gs);
}

/** Merge geometries (normalising index / attribute sets). Disposes the inputs. */
export function merge(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const list = gs.map((g) => {
    const o = g;
    for (const k of Object.keys(o.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') o.deleteAttribute(k);
    if (!o.getAttribute('uv')) o.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(o.getAttribute('position').count * 2), 2));
    if (!o.getAttribute('normal')) o.computeVertexNormals();
    return o;
  });
  const hasColor = list.some((g) => g.getAttribute('color'));
  const prepared = list.map((g) => {
    let o = g.index ? g.toNonIndexed() : g;
    if (o !== g) g.dispose();
    if (hasColor && !o.getAttribute('color')) {
      const c = new Float32Array(o.getAttribute('position').count * 3).fill(1);
      o.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    }
    return o;
  });
  const m = mergeGeometries(prepared, false)!;
  prepared.forEach((g) => g.dispose());
  return m;
}

/** Paint a whole geometry one vertex colour (for merged multi-colour batches). */
export function tint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3));
  return g;
}

/** A quad from 4 corners (counter-clockwise seen from the front) with a UV rect. */
export function quad(p: THREE.Vector3[], u0 = 0, v0 = 0, u1 = 1, v1 = 1): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p.flatMap((v) => [v.x, v.y, v.z]), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u1, v0, u1, v1, u0, v1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

/** Vertical quad centred at c, facing direction n (horizontal), width w, height h. */
export function panel(c: THREE.Vector3, n: THREE.Vector3, w: number, h: number, u0 = 0, v0 = 0, u1 = 1, v1 = 1): THREE.BufferGeometry {
  // r points to the viewer's right when looking at the front face
  const r = new THREE.Vector3().crossVectors(UP, n).normalize().multiplyScalar(w / 2);
  const up = new THREE.Vector3(0, h / 2, 0);
  return quad([c.clone().sub(r).sub(up), c.clone().add(r).sub(up), c.clone().add(r).add(up), c.clone().sub(r).add(up)], u0, v0, u1, v1);
}
