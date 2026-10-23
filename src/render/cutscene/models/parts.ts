// Reusable dress-up parts: spring strands (hair, beard, scarf), goggles, a 5-point star.
import * as THREE from 'three';
import { Chain, type ChainOpts } from './chain';
import type { Base } from './character';
import { OUTLINE } from './kit';

export interface StrandOpts extends ChainOpts {
  n: number;
  len: number; // per segment
  r0: number; // root radius
  r1: number; // tip radius
  color: number | THREE.Material;
  rx?: number; // first-joint rest bend about X (+ = back, toward -Z)
  rz?: number;
  ry?: number;
  curl?: number; // extra bend per joint about X
  flat?: number; // z squash of segments (1 = round)
  wide?: number; // x stretch of segments
  box?: boolean; // flat boxes instead of blobs (scarves)
  outline?: number;
  /** Sphere segments for blob strands (default 10). */
  seg?: number;
}

/** A hanging chain of tapered blobs (or boxes) at `at` under `parent`. Registers it on the base. */
export function strand(b: Base, parent: THREE.Object3D, at: THREE.Vector3Like, o: StrandOpts): Chain {
  const c = new Chain(parent, o);
  const mat = o.color instanceof THREE.Material ? o.color : b.kit.toon(o.color);
  for (let i = 0; i < o.n; i++) {
    const u = o.n > 1 ? i / (o.n - 1) : 0;
    const r = o.r0 + (o.r1 - o.r0) * u;
    const j = c.add(i === 0 ? at : { x: 0, y: -o.len, z: 0 }, i === 0 ? (o.rx ?? 0) : (o.curl ?? 0), i === 0 ? (o.rz ?? 0) : 0, i === 0 ? (o.ry ?? 0) : 0);
    const m = o.box
      ? b.kit.box(r * 2 * (o.wide ?? 1), o.len * 1.08, r * 2 * (o.flat ?? 1), mat, o.outline ?? OUTLINE)
      : b.kit.ball(r, mat, o.wide ?? 1, (o.len * 0.62) / r, o.flat ?? 1, o.seg ?? 10, o.outline ?? OUTLINE);
    m.position.y = -o.len / 2;
    j.add(m);
  }
  b.chains.push(c);
  return c;
}

/** Goggles facing +Z: two chunky rings with lenses and a strap. */
export function goggles(b: Base, lens: number, rim = 0xc9ced8, strap = 0x2a2420, emissive = false): THREE.Group {
  const k = b.kit, g = new THREE.Group();
  const lensMat = emissive ? k.toon(lens, { emissive: lens, emissiveIntensity: 0.6 }) : k.toon(lens);
  for (const s of [-1, 1]) {
    const ring = k.cyl(0.11, 0.12, 0.09, rim, 14, 0.016);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(s * 0.13, 0, 0);
    g.add(ring);
    const l = k.cyl(0.085, 0.085, 0.02, lensMat, 14, 0);
    l.rotation.x = Math.PI / 2;
    l.position.set(s * 0.13, 0, 0.05);
    g.add(l);
    const glint = k.box(0.03, 0.09, 0.01, 0xffffff, 0);
    glint.position.set(s * 0.13 + 0.03, 0.01, 0.062);
    glint.rotation.z = -0.6;
    g.add(glint);
  }
  const bridge = k.box(0.06, 0.04, 0.05, rim, 0.012);
  g.add(bridge);
  return g;
}

/** Strap band around the head at height y (head space). */
export function band(b: Base, y: number, color: number, h = 0.07, r = 0.452, tilt = 0): THREE.Mesh {
  const m = b.kit.mesh(new THREE.CylinderGeometry(r, r, h, 18, 1, true), b.kit.toon(color, { side: THREE.DoubleSide }), 0);
  m.position.y = y;
  m.rotation.x = tilt;
  return m;
}

export function starShape(r: number, inner = 0.45): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * inner : r;
    i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return s;
}

/** Partial sphere shell (hair caps, leather caps): phi/theta ranges like SphereGeometry. */
export function shell(b: Base, r: number, color: number | THREE.Material, phiStart: number, phiLen: number, thStart: number, thLen: number,
  sx = 1, sy = 1, sz = 1): THREE.Mesh {
  const g = new THREE.SphereGeometry(r, 18, 12, phiStart, phiLen, thStart, thLen);
  g.scale(sx, sy, sz);
  const mat = color instanceof THREE.Material ? color : b.kit.toon(color, { side: THREE.DoubleSide });
  const m = b.kit.mesh(g, mat, 0);
  // An open shell's own hull would show black through the opening: outline it with a closed ball instead.
  const t = OUTLINE * 1.1;
  const hull = b.kit.ball(r, b.kit.outlineMat, sx * (1 + t / r), sy * (1 + t / r), sz * (1 + t / r), 14, 0);
  hull.userData.hull = true;
  m.add(hull);
  return m;
}
