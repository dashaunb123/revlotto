// Grandstands (stepped bleachers, a covered main stand), the instanced crowd (idle bob, cheer, camera flashes)
// and the timing tower.
import * as THREE from 'three';
import type { Ctx } from './ctx';
import { mesh } from './ctx';
import { box, extrudeX, member, merge, panel } from './geo';
import * as L from './layout';
import { canvas, glowTexture, memo, signTexture, tex } from './textures';

interface Stand { side: 1 | -1; x0: number; x1: number; rows: number; roof?: boolean; fill: number }
const ROW_D = 0.85, ROW_H = 0.42, BASE_H = 1.3;

export const STANDS: Stand[] = [
  { side: 1, x0: -34, x1: 126, rows: 18, roof: true, fill: 0.93 },
  { side: 1, x0: 134, x1: 236, rows: 14, fill: 0.62 },
  { side: -1, x0: 12, x1: 132, rows: 16, fill: 0.85 },
  { side: -1, x0: 140, x1: 230, rows: 12, fill: 0.55 },
];

function standProfile(rows: number): [number, number][] {
  const z0 = L.STAND_Z0;
  const p: [number, number][] = [[z0, 0], [z0, BASE_H + 0.9]]; // front wall + parapet
  p.push([z0 + 0.15, BASE_H + 0.9], [z0 + 0.15, BASE_H]);
  for (let r = 0; r < rows; r++) {
    const z = z0 + 0.15 + r * ROW_D, y = BASE_H + r * ROW_H;
    p.push([z + ROW_D, y]);
    p.push([z + ROW_D, y + ROW_H]);
  }
  const zb = z0 + 0.15 + rows * ROW_D;
  const yt = BASE_H + rows * ROW_H;
  p.push([zb + 0.25, yt], [zb + 0.25, 0]);
  void yt;
  return p;
}

/** A standing spectator, ~1.75 m, facing local +Z; aPart: 0 shirt, 1 skin, 2 pants, 3 left arm, 4 right arm. */
function personGeometry(): THREE.BufferGeometry {
  const parts: [THREE.BufferGeometry, number][] = [];

  const legs = new THREE.BoxGeometry(0.32, 0.86, 0.2);
  legs.translate(0, 0.43, 0);
  parts.push([legs, 2]);
  const torso = new THREE.BoxGeometry(0.42, 0.6, 0.24);
  const tp = torso.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < tp.count; i++) if (tp.getY(i) < 0) tp.setX(i, tp.getX(i) * 0.82);
  torso.translate(0, 1.16, 0);
  parts.push([torso, 0]);
  const head = new THREE.IcosahedronGeometry(0.115, 0);
  head.scale(0.9, 1.08, 0.95);
  head.translate(0, 1.6, 0.01);
  parts.push([head, 1]);
  for (const s of [1, -1]) {
    const arm = new THREE.BoxGeometry(0.1, 0.6, 0.12);
    arm.translate(s * 0.265, 1.13, 0);
    parts.push([arm, s > 0 ? 3 : 4]);
  }
  const gs = parts.map(([g, part]) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    n.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n.getAttribute('position').count).fill(part), 1));
    return n;
  });
  // manual merge keeping aPart
  const total = gs.reduce((a, g) => a + g.getAttribute('position').count, 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), part = new Float32Array(total), uvs = new Float32Array(total * 2);
  let o = 0;
  for (const g of gs) {
    const c = g.getAttribute('position').count;
    pos.set(g.getAttribute('position').array as Float32Array, o * 3);
    nor.set(g.getAttribute('normal').array as Float32Array, o * 3);
    part.set(g.getAttribute('aPart').array as Float32Array, o);
    uvs.set(g.getAttribute('uv').array as Float32Array, o * 2);
    o += c;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return out;
}

const SHIRTS = ['#111111', '#1b1b1f', '#f2f2f2', '#d7d7d7', '#7a7a80', '#b3121e', '#0c2d6b', '#1f4fa8', '#e8b100', '#ff6a00', '#2e7d32', '#5d1f7a', '#00838f', '#c2185b', '#3e2a1e', '#8d6e63', '#202a44', '#9e1b32'];

export function buildStands(ctx: Ctx) {
  const { cfg } = ctx;
  const S = new THREE.Group();
  S.name = 'stands';
  ctx.group.add(S);
  const concrete = ctx.std({ color: 0x5c5d60, roughness: 0.85, side: THREE.DoubleSide }, 0.5);
  const alu = ctx.std({ color: 0xb4bac2, roughness: 0.35, metalness: 0.9 }, 1.2);
  const steel = ctx.std({ color: 0x2b2e33, roughness: 0.5, metalness: 0.7 }, 1);
  const standG: THREE.BufferGeometry[] = [], benchG: THREE.BufferGeometry[] = [], railG: THREE.BufferGeometry[] = [], roofG: THREE.BufferGeometry[] = [];
  const roofLights: THREE.BufferGeometry[] = [];
  const seats: { x: number; y: number; z: number; side: number; fill: number }[] = [];
  const stands = cfg.crowd < 2000 ? STANDS.filter((st) => st.roof || (st.side < 0 && st.x0 < 50)) : STANDS;
  for (const st of stands) {
    const prof = standProfile(st.rows);
    const pr = st.side > 0 ? prof : prof.map(([z, y]) => [-z, y] as [number, number]).reverse();
    standG.push(extrudeX(pr, st.x0, st.x1, 4, 4));
    // end walls
    for (const x of [st.x0, st.x1]) {
      const zb = L.STAND_Z0 + 0.4 + st.rows * ROW_D, yt = BASE_H + st.rows * ROW_H;
      const g = new THREE.BufferGeometry();
      const zs = st.side;
      const pts: number[] = [];
      // triangle-ish side wall as a quad fan following the rake
      const z0 = L.STAND_Z0;
      pts.push(x, 0, zs * z0, x, BASE_H + 0.9, zs * z0, x, yt + 0.3, zs * zb, x, 0, zs * zb);
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      g.setIndex(x === st.x0 ? (zs > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]) : zs > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
      g.computeVertexNormals();
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(8), 2));
      standG.push(g);
    }
    for (let r = 0; r < st.rows; r++) {
      const zc = st.side * (L.STAND_Z0 + 0.15 + r * ROW_D + ROW_D * 0.62);
      const y = BASE_H + r * ROW_H;
      benchG.push(box(st.x1 - st.x0 - 0.4, 0.05, 0.3, (st.x0 + st.x1) / 2, y + 0.42, zc));
      for (let x = st.x0 + 0.6; x < st.x1 - 0.5; x += 0.6) {
        // seat positions (skip aisles every 20 m)
        const ax = (x - st.x0) % 20;
        if (ax < 1.4) continue;
        seats.push({ x, y, z: zc - st.side * 0.05, side: st.side, fill: st.fill });
      }
    }
    // front rail
    const zr = st.side * (L.STAND_Z0 + 0.08);
    railG.push(member(new THREE.Vector3(st.x0, BASE_H + 1.0, zr), new THREE.Vector3(st.x1, BASE_H + 1.0, zr), 0.03, 6));
    for (let x = st.x0; x <= st.x1; x += 4) railG.push(member(new THREE.Vector3(x, BASE_H + 0.9, zr), new THREE.Vector3(x, BASE_H + 1.0, zr), 0.025, 4));
    // aisle hand rails
    for (let x = st.x0 + 0.7; x < st.x1; x += 20) {
      const za = st.side * L.STAND_Z0, zb = st.side * (L.STAND_Z0 + st.rows * ROW_D);
      railG.push(member(new THREE.Vector3(x, BASE_H + 0.9, za), new THREE.Vector3(x, BASE_H + st.rows * ROW_H + 0.9, zb), 0.025, 4));
    }
    if (st.roof) {
      const zf = st.side * (L.STAND_Z0 - 1.0), zb = st.side * (L.STAND_Z0 + st.rows * ROW_D + 0.6);
      const yb = BASE_H + st.rows * ROW_H + 4.2, yf = yb + 1.6;
      // roof slab (sloping up toward the track), columns at the back, cantilever trusses
      const slab = new THREE.BufferGeometry();
      const v = [st.x0 - 1, yb, zb, st.x1 + 1, yb, zb, st.x1 + 1, yf, zf, st.x0 - 1, yf, zf];
      slab.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      slab.setIndex(st.side > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
      slab.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(8), 2));
      slab.computeVertexNormals();
      roofG.push(slab);
      roofG.push(box(st.x1 - st.x0 + 2, 0.5, 0.25, (st.x0 + st.x1) / 2, yf - 0.1, zf)); // fascia
      for (let x = st.x0; x <= st.x1 + 0.1; x += 10) {
        roofG.push(box(0.4, yb, 0.4, x, yb / 2, zb));
        roofG.push(member(new THREE.Vector3(x, yb - 0.1, zb), new THREE.Vector3(x, yf - 0.2, zf), 0.12, 6));
        roofG.push(member(new THREE.Vector3(x, yb - 2.2, zb), new THREE.Vector3(x, yf - 0.25, zf), 0.07, 5));
      }
      // underside strip lights
      for (let k = 0; k < 3; k++) {
        const t = 0.2 + k * 0.3;
        const z = zb + (zf - zb) * t, y = yb + (yf - yb) * t - 0.08;
        for (let x = st.x0 + 3; x < st.x1 - 2; x += 6) roofLights.push(box(2.4, 0.04, 0.18, x, y, z));
      }
    }
  }
  mesh(S, merge(standG), concrete, { name: 'bleachers', cast: false });
  mesh(S, merge(benchG), alu, { name: 'benches' });
  mesh(S, merge(railG), steel, { name: 'standRails' });
  if (roofG.length) mesh(S, merge(roofG), steel, { name: 'roof', cast: true });
  if (roofLights.length) {
    const rl = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 4.4, 3.4) });
    mesh(S, merge(roofLights), rl, { receive: false, name: 'roofLights' });
  }

  // ---------------- crowd ----------------
  // Far LOD: one camera-facing card per spectator (2 tris, R/G/B mask = shirt/skin/pants, idle + cheering frames).
  // Near LOD (medium/high, within cfg.nearCrowd m): low-poly 3D figures with raised arms. Both share instance buffers.
  const r = L.rng(77);
  const chosen = seats.filter((s) => r() < s.fill * (s.x < 80 ? 1 : 1 - (s.x - 80) / 400));
  for (let i = chosen.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [chosen[i], chosen[j]] = [chosen[j], chosen[i]];
  }
  const people = chosen.slice(0, cfg.crowd).sort((a, b) => a.side - b.side || a.x - b.x);
  const uniforms = { uTime: { value: 0 }, uCheer: { value: 0 }, uCheerK: { value: 1 }, uCrowd: { value: ctx.own(crowdAtlas()) } };
  const crowdVert = (sh: THREE.WebGLProgramParametersWithUniforms) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSeed;\nuniform float uTime;\nuniform float uCheer;\nuniform float uCheerK;\nvarying vec3 vShirt; varying vec3 vSkin; varying vec3 vPants; varying vec2 vCUv;')
      .replace('#include <color_vertex>', `#include <color_vertex>
{
  float sd0 = aSeed;
  float k = fract( sd0 * 13.7 );
  vSkin = k < 0.3 ? vec3( 0.62, 0.40, 0.29 ) : k < 0.55 ? vec3( 0.44, 0.27, 0.17 ) : k < 0.8 ? vec3( 0.25, 0.14, 0.08 ) : vec3( 0.11, 0.06, 0.035 );
  vPants = mix( vec3( 0.012, 0.014, 0.022 ), vec3( 0.05, 0.07, 0.12 ), fract( sd0 * 5.3 ) );
  vShirt = vColor.rgb;
  vCUv = uv;
}
`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vShirt; varying vec3 vSkin; varying vec3 vPants; varying vec2 vCUv;\nuniform sampler2D uCrowd;');
  };
  // near: 3D figure, aPart picks shirt / skin / pants, arms swing up when cheering
  const nearMat = ctx.own(new THREE.MeshLambertMaterial({ color: 0xffffff, name: 'env:crowdNear' }));
  ctx.rig.patch(nearMat, (sh) => {
    crowdVert(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPart;\nvarying float vPart;')
      .replace('vCUv = uv;', 'vCUv = uv; vPart = aPart;')
      .replace('#include <begin_vertex>', `
vec3 transformed = vec3( position );
float sd = aSeed;
float ch = uCheer * step( fract( sd * 7.31 ), 0.15 + 0.65 * uCheerK );
float ph = sd * 6.2831 + uTime * ( 1.1 + sd * 0.9 );
if ( aPart > 2.5 ) {
  float side = aPart > 3.5 ? -1.0 : 1.0;
  vec3 piv = vec3( 0.24 * side, 1.42, 0.0 );
  float ang = side * ( 0.08 * sin( ph * 0.8 ) + 0.12 * step( 0.85, fract( sd * 3.7 ) ) + ch * ( 2.55 + 0.3 * sin( uTime * 10.0 + sd * 40.0 ) ) );
  vec3 q = transformed - piv;
  float c = cos( ang ), s = sin( ang );
  q.xy = vec2( c * q.x - s * q.y, s * q.x + c * q.y );
  transformed = q + piv;
}
transformed.y += sin( ph ) * 0.012 + ch * max( 0.0, sin( uTime * 7.5 + sd * 30.0 ) ) * ( 0.06 + 0.1 * uCheerK );
`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vPart;')
      .replace('#include <color_fragment>', 'diffuseColor.rgb = vPart > 0.5 && vPart < 1.5 ? vSkin : vPart > 1.5 && vPart < 2.5 ? vPants : vShirt;');
  }, 'crowdNear');
  // far: billboard card
  const farMat = ctx.own(new THREE.MeshLambertMaterial({ color: 0xffffff, name: 'env:crowdCards' }));
  ctx.rig.patch(farMat, (sh) => {
    crowdVert(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <begin_vertex>', `
vec3 transformed = vec3( position );
float sd = aSeed;
float ch = uCheer * step( fract( sd * 7.31 ), 0.15 + 0.65 * uCheerK );
float jump = sin( sd * 6.2831 + uTime * ( 1.1 + sd * 0.9 ) ) * 0.012 + ch * max( 0.0, sin( uTime * 7.5 + sd * 30.0 ) ) * ( 0.06 + 0.1 * uCheerK );
float frame = ch > 0.5 && sin( uTime * 6.0 + sd * 20.0 ) > -0.7 ? 1.0 : 0.0;
float flip = step( 0.5, fract( sd * 17.3 ) );
vCUv = vec2( ( mix( uv.x, 1.0 - uv.x, flip ) + frame ) * 0.5, uv.y );
`)
      .replace('#include <project_vertex>', `
vec4 cW = modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
float sx = length( instanceMatrix[ 0 ].xyz ), sy = length( instanceMatrix[ 1 ].xyz );
vec4 mvPosition = viewMatrix * cW;
vec3 upV = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
vec3 rtV = normalize( cross( upV, vec3( 0.0, 0.0, 1.0 ) ) );
mvPosition.xyz += rtV * transformed.x * sx + upV * ( transformed.y * sy + jump );
gl_Position = projectionMatrix * mvPosition;
`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', `
vec4 cm = texture2D( uCrowd, vCUv );
if ( cm.a < 0.42 ) discard;
float cs = cm.r + cm.g + cm.b;
vec3 cw = cm.rgb / max( cs, 1e-3 );
diffuseColor.rgb = mix( vec3( 0.015 ), vShirt * cw.r + vSkin * cw.g + vPants * cw.b, clamp( cs * 1.4, 0.0, 1.0 ) );
`);
  }, 'crowdFar');
  const nearGeo = ctx.own(personGeometry());
  const card = ctx.own(new THREE.PlaneGeometry(1, 2).translate(0, 1, 0));
  const lods: { near: THREE.InstancedMesh | null; far: THREE.InstancedMesh; c: THREE.Vector3; r: number; n: number }[] = [];
  const CH = 20; // chunk length along x: frustum culling + LOD switching
  const chunks = new Map<string, typeof people>();
  for (const p of people) {
    const k = `${p.side}:${Math.floor(p.x / CH)}`;
    if (!chunks.has(k)) chunks.set(k, []);
    chunks.get(k)!.push(p);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), eul = new THREE.Euler();
  const col = new THREE.Color();
  const shirts = SHIRTS.map((s) => new THREE.Color(s));
  const flashPos: THREE.Vector3[] = [];
  for (const list of chunks.values()) {
    const seeds = new Float32Array(list.length);
    const fg = card.clone();
    const far = new THREE.InstancedMesh(fg, farMat, list.length);
    list.forEach((p, i) => {
      const sit = r() < 0.35;
      const s = 0.92 + r() * 0.16;
      // face the track, turned a little toward the start line where the action is
      const toStart = Math.atan2(-p.x, p.side * 20) * 0.25;
      eul.set(0, (p.side > 0 ? Math.PI : 0) - toStart * p.side + (r() - 0.5) * 0.5, 0);
      q.setFromEuler(eul);
      sc.set(s, sit ? s * 0.74 : s, s);
      pos.set(p.x + (r() - 0.5) * 0.18, p.y + (sit ? 0.18 : 0.02), p.z + (r() - 0.5) * 0.1);
      m4.compose(pos, q, sc);
      far.setMatrixAt(i, m4);
      const c = r() < 0.7 ? shirts[Math.floor(r() * 6)] : shirts[Math.floor(r() * shirts.length)];
      col.copy(c).multiplyScalar(0.55 + r() * 0.3);
      far.setColorAt(i, col);
      seeds[i] = r();
      if (r() < 0.05) flashPos.push(pos.clone().add(new THREE.Vector3(0, 1.5, 0)));
    });
    const seedA = new THREE.InstancedBufferAttribute(seeds, 1);
    fg.setAttribute('aSeed', seedA);
    far.computeBoundingSphere();
    far.name = 'crowd';
    far.receiveShadow = false;
    S.add(far);
    let near: THREE.InstancedMesh | null = null;
    if (cfg.nearCrowd > 0) {
      const ng = nearGeo.clone();
      ng.setAttribute('aSeed', seedA);
      near = new THREE.InstancedMesh(ng, nearMat, list.length);
      near.instanceMatrix = far.instanceMatrix;
      near.instanceColor = far.instanceColor;
      near.boundingSphere = far.boundingSphere!.clone();
      near.name = 'crowdNear';
      near.count = 0; // LOD swaps instance counts, never visibility / materials (compile-friendly)
      S.add(near);
    }
    lods.push({ near, far, c: far.boundingSphere!.center.clone(), r: far.boundingSphere!.radius, n: list.length });
  }

  // camera / phone flashes in the crowd (one Points batch)
  const FL = cfg.crowd > 3000 ? 48 : 16;
  const fGeo = new THREE.BufferGeometry();
  const fPos = new Float32Array(FL * 3), fA = new Float32Array(FL);
  fGeo.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
  fGeo.setAttribute('alpha', new THREE.BufferAttribute(fA, 1));
  const fTex = ctx.own(glowTexture(64, 0.08));
  const fMat = ctx.own(new THREE.ShaderMaterial({
    uniforms: { map: { value: fTex }, scale: { value: 900 } },
    vertexShader: 'attribute float alpha; varying float vA; uniform float scale; void main(){ vA = alpha; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = min(64.0, scale * 0.35 / -mv.z) * step(0.01, alpha); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform sampler2D map; varying float vA; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vec3(6.0, 6.2, 7.0) * t.a * vA, 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}',
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  const flashes = new THREE.Points(fGeo, fMat);
  flashes.frustumCulled = false;
  flashes.renderOrder = 6;
  S.add(flashes);
  const fT = new Float32Array(FL).fill(-1);
  let cheerT = 0, cheerLevel = 0, cheerK = 1;
  ctx.updaters.push((dt, t) => {
    for (const l of lods) {
      if (!l.near) continue;
      const near = ctx.camPos.distanceTo(l.c) - l.r < cfg.nearCrowd;
      l.near.count = near ? l.n : 0;
      l.far.count = near ? 0 : l.n;
    }
    uniforms.uTime.value = t;
    cheerT = Math.max(0, cheerT - dt);
    const target = cheerT > 0 ? 1 : 0;
    cheerLevel += (target - cheerLevel) * Math.min(1, dt * (target > cheerLevel ? 5 : 1.6));
    uniforms.uCheer.value = cheerLevel;
    if (!flashPos.length) return;
    uniforms.uCheerK.value = cheerK;
    const rate = 1.2 + cheerLevel * 18 * cheerK; // flashes per second
    for (let i = 0; i < FL; i++) {
      if (fT[i] >= 0) {
        fT[i] += dt;
        fA[i] = fT[i] < 0.05 ? 1 : Math.max(0, 1 - (fT[i] - 0.05) * 14);
        if (fT[i] > 0.2) { fT[i] = -1; fA[i] = 0; }
      } else if (Math.random() < (rate * dt) / FL * 4) {
        const p = flashPos[Math.floor(Math.random() * flashPos.length)];
        fPos[i * 3] = p.x; fPos[i * 3 + 1] = p.y; fPos[i * 3 + 2] = p.z;
        fT[i] = 0;
      }
    }
    fGeo.attributes.position.needsUpdate = true;
    fGeo.attributes.alpha.needsUpdate = true;
  });

  buildTimingTower(ctx, S, [concrete, steel]);

  return {
    count: people.length,
    cheer(ms: number, k = 1) {
      // a stronger cheer overrides a weaker one still running; a weaker one never cuts a big one short
      if (cheerT <= 0 || k >= cheerK) cheerK = Math.max(0.05, Math.min(1, k));
      cheerT = Math.max(cheerT, ms / 1000);
    },
    flashScale(px: number) { fMat.uniforms.scale.value = px; },
  };
}

/** Crowd card atlas (128×128): frame 0 idle, frame 1 arms up. R shirt, G skin, B pants, black hair, A coverage. */
function crowdAtlas(): THREE.CanvasTexture {
  const [c] = memo('crowdAtlas', () => {
    const c = canvas(128, 128);
    const g = c.getContext('2d')!;
    const SH = 'rgb(255,0,0)', SK = 'rgb(0,255,0)', PA = 'rgb(0,0,255)', HA = 'rgb(0,0,0)';
    for (const f of [0, 1]) {
      const ox = f * 64;
      g.fillStyle = PA;
      g.fillRect(ox + 23, 74, 8, 54); g.fillRect(ox + 33, 74, 8, 54);
      g.fillStyle = SH;
      g.beginPath(); g.moveTo(ox + 19, 38); g.lineTo(ox + 45, 38); g.lineTo(ox + 43, 76); g.lineTo(ox + 21, 76); g.fill();
      g.lineCap = 'round';
      g.lineWidth = 6;
      g.strokeStyle = SH;
      const arm = (x0: number, y0: number, x1: number, y1: number) => {
        g.strokeStyle = SH; g.beginPath(); g.moveTo(ox + x0, y0); g.lineTo(ox + x1, y1); g.stroke();
        g.fillStyle = SK; g.beginPath(); g.arc(ox + x1, y1, 3, 0, Math.PI * 2); g.fill();
      };
      if (f === 0) { arm(18, 41, 15, 70); arm(46, 41, 49, 70); } else { arm(19, 40, 9, 9); arm(45, 40, 55, 9); }
      g.fillStyle = SK;
      g.fillRect(ox + 29, 30, 6, 8);
      g.beginPath(); g.ellipse(ox + 32, 23, 7.5, 9, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = HA;
      g.beginPath(); g.ellipse(ox + 32, 18, 7.8, 5, 0, Math.PI, Math.PI * 2); g.fill();
    }
    return [c];
  });
  const t = tex(c, false, false, 1);
  return t;
}

/** Three-storey timing tower at the start line (-Z side): lit offices, a glass control room, roof sign and mast. */
function buildTimingTower(ctx: Ctx, parent: THREE.Object3D, [concrete, steel]: THREE.Material[]) {
  const T = new THREE.Group();
  T.name = 'timingTower';
  parent.add(T);
  const x0 = -16, x1 = 2, zf = -14.2, zb = -21.5; // footprint
  const xc = (x0 + x1) / 2, w = x1 - x0, d = zf - zb;
  const fl = 3.4;
  const walls = ctx.std({ color: 0x8a8c90, roughness: 0.8 }, 0.5);
  mesh(T, merge([box(w, fl * 2, d, xc, fl, (zf + zb) / 2), box(w + 0.8, 0.35, d + 1.6, xc, fl * 3 + 0.1 + 0.3, (zf + zb) / 2 + 0.5)]), walls, { cast: true });
  // office windows on the two lower floors (facing +Z, toward the track)
  const wt = ctx.own(officeTexture());
  const wm = new THREE.MeshBasicMaterial({ map: wt, color: new THREE.Color(1.5, 1.35, 1.2) });
  ctx.own(wm);
  for (let f = 0; f < 2; f++) mesh(T, panel(new THREE.Vector3(xc, fl * f + 1.9, zf + 0.02), new THREE.Vector3(0, 0, 1), w - 1, 1.5), wm, { receive: false });
  // control room: lit interior box + reflective glass, overhanging toward the track
  const cr = { y0: fl * 2, y1: fl * 3, zf: zf + 1.2 };
  const it = ctx.own(controlRoomTexture());
  const im = new THREE.MeshBasicMaterial({ map: it, color: new THREE.Color(1.5, 1.35, 1.2) });
  ctx.own(im);
  mesh(T, panel(new THREE.Vector3(xc, (cr.y0 + cr.y1) / 2, cr.zf - 0.6), new THREE.Vector3(0, 0, 1), w - 0.6, fl - 0.3), im, { receive: false });
  const glass = ctx.std({ color: 0x0a0f14, roughness: 0.04, metalness: 0.2, transparent: true, opacity: 0.35, depthWrite: false }, 2.2);
  mesh(T, panel(new THREE.Vector3(xc, (cr.y0 + cr.y1) / 2, cr.zf), new THREE.Vector3(0, 0, 1), w, fl), glass, { receive: false });
  const mull: THREE.BufferGeometry[] = [box(w, 0.25, 1.4, xc, cr.y0 + 0.12, cr.zf - 0.6)];
  for (let x = x0; x <= x1 + 0.01; x += 2.25) mull.push(box(0.1, fl, 0.12, x, (cr.y0 + cr.y1) / 2, cr.zf));
  mull.push(box(w, 0.15, 0.15, xc, cr.y1 - 0.05, cr.zf));
  mesh(T, merge(mull), steel, { cast: true });
  // roof sign + mast with an aviation light
  const st = ctx.own(signTexture([{ text: 'REVLOTTO RACEWAY', size: 0.5, color: '#ffd23f' }, { text: 'TIMING  &  SCORING', size: 0.24, color: '#ffffff' }], 1024, 200, '#0d0d16', { border: '#ff3b30', aniso: ctx.cfg.aniso }));
  const sm = new THREE.MeshBasicMaterial({ map: st, color: new THREE.Color(1.8, 1.8, 1.8) });
  ctx.own(sm);
  mesh(T, panel(new THREE.Vector3(xc, fl * 3 + 1.6, zf + 0.6), new THREE.Vector3(0, 0, 1), w * 0.9, w * 0.9 * 200 / 1024), sm, { receive: false });
  mesh(T, merge([box(w * 0.9, 0.12, 0.2, xc, fl * 3 + 0.55, zf + 0.5), member(new THREE.Vector3(x0 + 2, fl * 3, zb + 2), new THREE.Vector3(x0 + 2, fl * 3 + 9, zb + 2), 0.07, 6)]), steel);
  const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctx.own(glowTexture(64, 0.1)), color: 0xff2010, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  ctx.own(beacon.material);
  beacon.position.set(x0 + 2, fl * 3 + 9.1, zb + 2);
  beacon.scale.setScalar(1.6);
  T.add(beacon);
  ctx.updaters.push((_dt, t) => { (beacon.material as THREE.SpriteMaterial).opacity = Math.sin(t * 3) > 0.2 ? 1 : 0.05; });
  void concrete;
}

/** A row of office windows (frames, warm interiors, some blinds down). */
function officeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1a1b1e';
  g.fillRect(0, 0, 1024, 96);
  const r = L.rng(31);
  const n = 10, w = 1024 / n;
  for (let i = 0; i < n; i++) {
    const x = i * w + 8, ww = w - 16;
    const on = r() > 0.2;
    const gr = g.createLinearGradient(0, 8, 0, 88);
    gr.addColorStop(0, on ? '#ffe2b0' : '#2a3038');
    gr.addColorStop(1, on ? '#a8794a' : '#151a20');
    g.fillStyle = gr;
    g.fillRect(x, 8, ww, 80);
    if (on && r() < 0.4) { g.fillStyle = 'rgba(40,30,20,0.55)'; g.fillRect(x, 8, ww, 20 + r() * 40); }
    g.fillStyle = '#2b2d31';
    g.fillRect(x + ww / 2 - 2, 8, 4, 80);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function controlRoomTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, 128);
  bg.addColorStop(0, '#5a4630');
  bg.addColorStop(0.6, '#2c241c');
  bg.addColorStop(1, '#141210');
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 128);
  // ceiling lights
  for (let x = 20; x < 512; x += 60) { g.fillStyle = '#fff4d8'; g.fillRect(x, 6, 34, 5); }
  // monitors + people silhouettes
  const r = L.rng(5);
  for (let x = 10; x < 500; x += 26 + r() * 20) {
    g.fillStyle = r() > 0.5 ? '#6fb6ff' : '#9fe0a0';
    g.fillRect(x, 70, 16, 10);
    if (r() < 0.5) {
      g.fillStyle = '#0a0806';
      g.beginPath(); g.arc(x + 22, 62, 6, 0, Math.PI * 2); g.fill();
      g.fillRect(x + 14, 68, 16, 40);
    }
  }
  g.fillStyle = '#0c0a08';
  g.fillRect(0, 86, 512, 42); // desk
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
