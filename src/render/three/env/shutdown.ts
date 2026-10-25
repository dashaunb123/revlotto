// Shutdown area past the finish: a sand trap and catch net at the very end, "BRAKE" boards, and the turn-off
// road that leaves the strip and runs off into the dark with reflector posts.
import * as THREE from 'three';
import type { Ctx } from './ctx';
import { mesh } from './ctx';
import { box, member, merge, panel } from './geo';
import * as L from './layout';
import { chainLink, fbm, signTexture } from './textures';

function sandTexture(n: number): THREE.CanvasTexture {
  const a = fbm(4, 5, 71), b = fbm(64, 2, 72), r = L.rng(73);
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const img = g.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n, v = y / n, k = 0.75 + a(u, v) * 0.35 + b(u, v) * 0.15 + (r() - 0.5) * 0.12;
    const i = (y * n + x) * 4;
    img.data[i] = 150 * k; img.data[i + 1] = 128 * k; img.data[i + 2] = 96 * k; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A flat ribbon along a curve (y = lift), UV u across, v along (metres / 4). */
function ribbon(curve: THREE.Curve<THREE.Vector3>, width: number, lift: number, segs: number, offset = 0): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const len = curve.getLength();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = curve.getPointAt(t), tg = curve.getTangentAt(t);
    const side = new THREE.Vector3(-tg.z, 0, tg.x).normalize();
    for (const s of [-0.5, 0.5]) {
      const q = p.clone().addScaledVector(side, s * width + offset);
      pos.push(q.x, lift, q.z);
      uv.push(s + 0.5, (t * len) / 4);
    }
    if (i < segs) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildShutdown(ctx: Ctx, asphalt: THREE.Material) {
  const S = new THREE.Group();
  S.name = 'shutdown';
  ctx.group.add(S);
  // sand trap across the end of the strip
  const st = ctx.own(sandTexture(ctx.cfg.tex / 2));
  st.repeat.set(10, 4);
  const sandMat = ctx.std({ map: st, roughness: 0.97 }, 0.2);
  const sg = new THREE.PlaneGeometry(L.SAND.x1 - L.SAND.x0, 16, 24, 8);
  sg.rotateX(-Math.PI / 2);
  const sp = sg.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < sp.count; i++) sp.setY(i, 0.04 + Math.sin(sp.getX(i) * 0.9) * 0.03 + Math.cos(sp.getZ(i) * 1.3) * 0.02);
  sg.computeVertexNormals();
  sg.translate((L.SAND.x0 + L.SAND.x1) / 2, 0, 0);
  mesh(S, sg, sandMat, { name: 'sandTrap' });
  // catch net: tall posts, a top cable, net panels
  const steel = ctx.std({ color: 0x3a3e44, roughness: 0.5, metalness: 0.7 }, 1);
  const postG: THREE.BufferGeometry[] = [];
  for (let z = -8; z <= 8.01; z += 4) postG.push(member(new THREE.Vector3(L.NET_X, 0, z), new THREE.Vector3(L.NET_X, 5.2, z), 0.09, 8));
  postG.push(member(new THREE.Vector3(L.NET_X, 5.1, -8), new THREE.Vector3(L.NET_X, 5.1, 8), 0.03, 5));
  postG.push(member(new THREE.Vector3(L.NET_X, 0.4, -8), new THREE.Vector3(L.NET_X, 0.4, 8), 0.03, 5));
  mesh(S, merge(postG), steel, { cast: true, name: 'netPosts' });
  const nt = ctx.own(chainLink(64));
  nt.repeat.set(16 / 0.35, 5 / 0.35);
  const netMat = ctx.std({ color: 0xd8a018, map: nt, alphaMap: nt, transparent: true, opacity: 0.9, roughness: 0.7, side: THREE.DoubleSide, depthWrite: false }, 0.4);
  const ng = new THREE.PlaneGeometry(16, 4.9);
  ng.rotateY(-Math.PI / 2);
  ng.translate(L.NET_X - 0.05, 2.6, 0);
  mesh(S, ng, netMat, { receive: false, name: 'catchNet' }).renderOrder = 2;
  // "BRAKE" / "SLOW" boards on the walls through the shutdown
  const bt = ctx.own(signTexture([{ text: 'BRAKE', size: 0.6, color: '#111' }], 256, 128, '#ffd400', { border: '#111', aniso: ctx.cfg.aniso }));
  const bm = ctx.std({ map: bt, emissiveMap: bt, emissive: 0xffffff, emissiveIntensity: 0.3, roughness: 0.5 }, 0.4);
  const boards: THREE.BufferGeometry[] = [];
  for (const x of [470, 540]) for (const s of [1, -1]) boards.push(panel(new THREE.Vector3(x, 2.1, s * (L.OUTER_Z + L.OWALL_T / 2 - 0.08)), new THREE.Vector3(0, 0, -s), 2.0, 1.0));
  mesh(S, merge(boards), bm, { name: 'brakeBoards' });

  // turn-off road: leaves the +Z side where that wall ends, swings out, then runs off into the dark
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(L.OWALL_END_L - 25, 0, 4.5),
    new THREE.Vector3(L.OWALL_END_L + 10, 0, 9),
    new THREE.Vector3(L.OWALL_END_L + 60, 0, 22),
    new THREE.Vector3(L.OWALL_END_L + 140, 0, 34),
    new THREE.Vector3(L.OWALL_END_L + 400, 0, 40),
    new THREE.Vector3(L.OWALL_END_L + 1100, 0, 44),
  ], false, 'centripetal');
  const road = ribbon(curve, 7.4, 0.012, 160);
  // asphalt UVs are in metres / 3.5 like the strip
  const ruv = road.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < ruv.count; i++) ruv.setXY(i, (ruv.getX(i) * 7.4) / 3.5, (ruv.getY(i) * 4) / 3.5);
  mesh(S, road, asphalt, { name: 'turnoffRoad' });
  // dashed centre line + edge lines
  const paint = ctx.std({ color: 0xd8d4c8, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }, 0.3);
  const yellow = ctx.std({ color: 0xd8a010, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }, 0.3);
  const len = curve.getLength();
  const dashes: THREE.BufferGeometry[] = [];
  for (let s = 6; s < len - 4; s += 9) {
    const a = s / len, b = Math.min(1, (s + 3.5) / len);
    const sub = new THREE.CatmullRomCurve3([curve.getPointAt(a), curve.getPointAt((a + b) / 2), curve.getPointAt(b)]);
    dashes.push(ribbon(sub, 0.12, 0.02, 2));
  }
  mesh(S, merge(dashes), yellow, { name: 'roadDashes' });
  mesh(S, merge([ribbon(curve, 0.12, 0.02, 160, 3.4), ribbon(curve, 0.12, 0.02, 160, -3.4)]), paint, { name: 'roadEdges' });
  // reflector posts with tiny retro-reflective glints
  const postGeo: THREE.BufferGeometry[] = [], glint: THREE.BufferGeometry[] = [];
  for (let s = 20; s < len; s += 24) {
    const t = s / len, p = curve.getPointAt(t), tg = curve.getTangentAt(t);
    const side = new THREE.Vector3(-tg.z, 0, tg.x).normalize();
    for (const k of [-1, 1]) {
      const q = p.clone().addScaledVector(side, k * 4.6);
      postGeo.push(box(0.1, 1.0, 0.1, q.x, 0.5, q.z));
      glint.push(box(0.105, 0.12, 0.105, q.x, 0.85, q.z));
    }
  }
  mesh(S, merge(postGeo), ctx.std({ color: 0xdedede, roughness: 0.6 }, 0.3), { name: 'reflectorPosts' });
  mesh(S, merge(glint), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.0, 0.25) }), { receive: false, name: 'reflectors' });
  return { group: S };
}
