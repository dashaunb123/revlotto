// Shared toon look for the cutscene models (v3 candy look): a soft 4-band ramp, cached glossy toon materials
// (rim light + specular from fx.applyLook), thin inverted-hull outlines, auto higher-poly round geometry,
// and a Kit that owns every geometry/material it makes so a rig can dispose() in one call.
import * as THREE from 'three';
import { INK, applyLook, softRamp } from '../fx';

/** Soft-banded light ramp: `steps` are the band levels (default 4 bands), edges blend smoothly. */
export function gradientTexture(steps: number[] = [0.3, 0.52, 0.76, 1]): THREE.DataTexture {
  return softRamp(steps);
}

export interface ToonOpts {
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  side?: THREE.Side;
  /** Specular strength: 0 matte (cloth, hair), 0.4 default sheen (skin, plastic), 0.8-1 car paint / candy / chrome. */
  gloss?: number;
  /** Highlight tightness (default 48; 90+ = small hot glint). */
  shine?: number;
  /** Fresnel rim multiplier (default 1). */
  rim?: number;
}

/** Outline thickness in world metres; 0 = none. Characters use ~0.02, cars ~0.03. */
export const OUTLINE = 0.022;
/** v3: every hull is drawn at this fraction of its requested thickness (thinner, cleaner lines). */
export const OUTLINE_SCALE = 0.68;
/** v3: round-geometry segment counts >= 8 are multiplied by this (capped at 64); < 8 stay (intentional facets). */
export const SEG_MUL = 1.75;
export const hiSeg = (n: number) => (n < 8 ? n : Math.min(64, Math.round(n * SEG_MUL)));

type GeoParams = Record<string, unknown>;
/**
 * Rebuilds a Sphere/Cylinder/Cone/Lathe/Torus geometry with SEG_MUL more segments. Any per-axis scale /
 * translate applied after construction is recovered (bbox mapping, verified against a rebuilt original), so
 * `new SphereGeometry(r, 14, 10).scale(1, 1.2, 0.9)` upgrades fine. Rotated or otherwise edited geometry,
 * and anything flagged userData.lowPoly, is returned untouched.
 */
export function upgradeGeo(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = (g as unknown as { parameters?: GeoParams }).parameters;
  if (!p || g.userData.lowPoly || g.userData.hiPoly || g.morphAttributes.position) return g;
  const make = (k: (n: number) => number): THREE.BufferGeometry | null => {
    switch (g.type) {
      case 'SphereGeometry':
        return new THREE.SphereGeometry(p.radius as number, k(p.widthSegments as number), k(p.heightSegments as number),
          p.phiStart as number, p.phiLength as number, p.thetaStart as number, p.thetaLength as number);
      case 'CylinderGeometry':
        return new THREE.CylinderGeometry(p.radiusTop as number, p.radiusBottom as number, p.height as number, k(p.radialSegments as number),
          p.heightSegments as number, p.openEnded as boolean, p.thetaStart as number, p.thetaLength as number);
      case 'ConeGeometry':
        return new THREE.ConeGeometry(p.radius as number, p.height as number, k(p.radialSegments as number), p.heightSegments as number,
          p.openEnded as boolean, p.thetaStart as number, p.thetaLength as number);
      case 'LatheGeometry':
        return new THREE.LatheGeometry(p.points as THREE.Vector2[], k(p.segments as number), p.phiStart as number, p.phiLength as number);
      case 'TorusGeometry':
        return new THREE.TorusGeometry(p.radius as number, p.tube as number, k(p.radialSegments as number), k(p.tubularSegments as number), p.arc as number);
      default:
        return null;
    }
  };
  const main = (g.type === 'SphereGeometry' ? p.widthSegments : g.type === 'LatheGeometry' ? p.segments : p.radialSegments) as number;
  if (!(main >= 8) || hiSeg(main) <= main) return g;
  const ref = make((n) => n);
  const hi = make(hiSeg);
  if (!ref || !hi) return g;
  const a = g.getAttribute('position');
  const b = ref.getAttribute('position');
  let ok = a && b && a.count === b.count && !!g.index === !!ref.index;
  const sc = new THREE.Vector3(1, 1, 1);
  const off = new THREE.Vector3();
  if (ok) {
    g.computeBoundingBox();
    ref.computeBoundingBox();
    const ga = g.boundingBox!;
    const ra = ref.boundingBox!;
    for (const ax of ['x', 'y', 'z'] as const) {
      const rs = ra.max[ax] - ra.min[ax];
      const gs = ga.max[ax] - ga.min[ax];
      sc[ax] = rs > 1e-6 ? gs / rs : 1;
      off[ax] = ga.min[ax] - ra.min[ax] * sc[ax];
    }
    const eps = 1e-4 * (1 + ga.getSize(new THREE.Vector3()).length());
    for (let i = 0; ok && i < a.count; i += Math.max(1, Math.floor(a.count / 40)))
      ok =
        Math.abs(b.getX(i) * sc.x + off.x - a.getX(i)) < eps &&
        Math.abs(b.getY(i) * sc.y + off.y - a.getY(i)) < eps &&
        Math.abs(b.getZ(i) * sc.z + off.z - a.getZ(i)) < eps;
  }
  ref.dispose();
  if (!ok) {
    hi.dispose();
    return g;
  }
  hi.scale(sc.x, sc.y, sc.z); // applyMatrix4 also fixes the normals for non-uniform scale
  hi.translate(off.x, off.y, off.z);
  hi.userData = { ...g.userData, hiPoly: true };
  hi.name = g.name;
  g.dispose();
  return hi;
}

export class Kit {
  readonly geos = new Set<THREE.BufferGeometry>();
  readonly mats = new Set<THREE.Material>();
  readonly texs = new Set<THREE.Texture>();
  readonly grad = gradientTexture();
  readonly outlineMat = this.own(new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }));
  private cache = new Map<string, THREE.MeshToonMaterial>();

  own<T extends THREE.Material>(m: T): T {
    this.mats.add(m);
    return m;
  }
  geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.add(g);
    return g;
  }
  tex<T extends THREE.Texture>(t: T): T {
    this.texs.add(t);
    return t;
  }
  /** Small nearest-filtered canvas texture drawn by `draw` (w x h px). */
  canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, smooth = false): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!, w, h);
    const t = this.tex(new THREE.CanvasTexture(c));
    t.colorSpace = THREE.SRGBColorSpace;
    t.minFilter = t.magFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
    t.generateMipmaps = false;
    return t;
  }

  /** Cached toon material (same colour + options = same material). */
  toon(color: THREE.ColorRepresentation, o: ToonOpts = {}): THREE.MeshToonMaterial {
    const key = `${new THREE.Color(color).getHexString()}|${o.emissive ?? ''}|${o.emissiveIntensity ?? ''}|${o.side ?? ''}|${o.gloss ?? ''}|${o.shine ?? ''}|${o.rim ?? ''}`;
    let m = this.cache.get(key);
    if (!m) {
      m = this.own(applyLook(new THREE.MeshToonMaterial({ color, gradientMap: this.grad, side: o.side ?? THREE.FrontSide }), o));
      if (o.emissive !== undefined) {
        m.emissive.set(o.emissive);
        m.emissiveIntensity = o.emissiveIntensity ?? 1;
      }
      this.cache.set(key, m);
    }
    return m;
  }
  /** Unique (uncached) toon material, for things animated per rig (glowing eyes, flashing lights). */
  toonUnique(color: THREE.ColorRepresentation, o: ToonOpts = {}): THREE.MeshToonMaterial {
    const m = this.own(applyLook(new THREE.MeshToonMaterial({ color, gradientMap: this.grad, side: o.side ?? THREE.FrontSide }), o));
    if (o.emissive !== undefined) m.emissive.set(o.emissive), (m.emissiveIntensity = o.emissiveIntensity ?? 1);
    return m;
  }
  glow(color: THREE.ColorRepresentation, opacity = 0.6): THREE.MeshBasicMaterial {
    return this.own(
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
  }

  /** Wraps a geometry (round primitives get auto-upgraded to more segments, see upgradeGeo). */
  mesh(g: THREE.BufferGeometry, mat: THREE.Material | THREE.ColorRepresentation, outline = OUTLINE): THREE.Mesh {
    const m = new THREE.Mesh(this.geo(upgradeGeo(g)), mat instanceof THREE.Material ? mat : this.toon(mat));
    m.userData.outline = outline;
    return m;
  }
  box(w: number, h: number, d: number, mat: THREE.Material | THREE.ColorRepresentation, outline = OUTLINE) {
    return this.mesh(new THREE.BoxGeometry(w, h, d), mat, outline);
  }
  /** Ellipsoid: radius r, scaled per axis (baked into the geometry so outlines stay even). */
  /** v3: `seg` is multiplied by SEG_MUL (default 14 -> 25 around, 18 rings). */
  ball(r: number, mat: THREE.Material | THREE.ColorRepresentation, sx = 1, sy = 1, sz = 1, seg = 14, outline = OUTLINE) {
    const s = hiSeg(seg);
    const g = new THREE.SphereGeometry(r, s, Math.max(6, Math.round(s * 0.7)));
    g.scale(sx, sy, sz);
    g.userData.hiPoly = true;
    return this.mesh(g, mat, outline);
  }
  /** v3: `seg` is multiplied by SEG_MUL (default 12 -> 21). */
  cyl(rt: number, rb: number, h: number, mat: THREE.Material | THREE.ColorRepresentation, seg = 12, outline = OUTLINE) {
    const g = new THREE.CylinderGeometry(rt, rb, h, hiSeg(seg));
    g.userData.hiPoly = true;
    return this.mesh(g, mat, outline);
  }
  /** Lathe (profile revolved around Y): 24 segments by default (not multiplied). */
  lathe(points: THREE.Vector2[], mat: THREE.Material | THREE.ColorRepresentation, seg = 24, outline = OUTLINE) {
    const g = new THREE.LatheGeometry(points, seg);
    g.userData.hiPoly = true;
    return this.mesh(g, mat, outline);
  }

  dispose() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const t of this.texs) t.dispose();
    this.texs.clear();
    this.grad.dispose();
    this.geos.clear();
    this.mats.clear();
    this.cache.clear();
  }
}

const _s = new THREE.Vector3();
const _b = new THREE.Box3();
const _c = new THREE.Vector3();
const _z = new THREE.Vector3();

/**
 * Inverted-hull outline: a black backface copy of the mesh, scaled per axis so the rim is about
 * `thickness` world metres thick. Uses the mesh's current world scale, so call it once the mesh sits in
 * its final hierarchy. Shares the mesh's geometry (nothing new to dispose besides `mat`).
 */
export function addOutline(mesh: THREE.Mesh, thickness = OUTLINE, mat: THREE.Material = SHARED_OUTLINE): THREE.Mesh {
  const g = mesh.geometry;
  if (!g.boundingBox) g.computeBoundingBox();
  _b.copy(g.boundingBox!);
  _b.getSize(_z);
  _b.getCenter(_c);
  mesh.updateWorldMatrix(true, false);
  mesh.getWorldScale(_s);
  const th = thickness * OUTLINE_SCALE;
  const k = (size: number, ws: number) => Math.min(3, 1 + (2 * th) / Math.max(1e-4, size * Math.abs(ws)));
  const hull = new THREE.Mesh(g, mat);
  hull.scale.set(k(_z.x, _s.x), k(_z.y, _s.y), k(_z.z, _s.z));
  hull.position.set(_c.x * (1 - hull.scale.x), _c.y * (1 - hull.scale.y), _c.z * (1 - hull.scale.z));
  hull.userData.hull = true;
  hull.raycast = () => {};
  mesh.add(hull);
  return hull;
}

/** Outlines every mesh under root that has userData.outline > 0 (as Kit meshes do). */
export function outlineTree(root: THREE.Object3D, mat: THREE.Material = SHARED_OUTLINE) {
  root.updateMatrixWorld(true);
  const list: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !o.userData.hull && o.userData.outline > 0 && !o.userData.outlined) list.push(o as THREE.Mesh);
  });
  for (const m of list) {
    addOutline(m, m.userData.outline, mat);
    m.userData.outlined = true;
  }
}

/** Module-wide resources for the exported helpers (never disposed; tiny). */
const SHARED_GRAD = gradientTexture();
export const SHARED_OUTLINE = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });

/** A glossy toon material on the shared soft ramp, for the Director's own props. Caller disposes it. */
export function toonMaterial(color: THREE.ColorRepresentation, o: ToonOpts = {}): THREE.MeshToonMaterial {
  const m = applyLook(new THREE.MeshToonMaterial({ color, gradientMap: SHARED_GRAD, side: o.side ?? THREE.FrontSide }), o);
  if (o.emissive !== undefined) m.emissive.set(o.emissive), (m.emissiveIntensity = o.emissiveIntensity ?? 1);
  return m;
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** Frame-rate independent approach of `cur` toward `to` (rate ~ 1/seconds). */
export const damp = (cur: number, to: number, rate: number, dt: number) => cur + (to - cur) * (1 - Math.exp(-rate * dt));
