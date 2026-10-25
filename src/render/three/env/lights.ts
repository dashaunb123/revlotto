// Light towers: poles, flood heads with glowing lamp faces, instanced lens-glare billboards (view-dependent, with
// anamorphic streaks), cheap volumetric shafts (additive cones with soft falloff and drifting haze) and ground mist.
import * as THREE from 'three';
import type { Ctx } from './ctx';
import { mesh } from './ctx';
import { box, member, merge } from './geo';
import * as L from './layout';
import type { TowerLight } from './stadiumLights';
import { flareTexture, glowTexture, puffTexture } from './textures';

export interface TowerDef { x: number; side: 1 | -1; h: number; head: THREE.Vector3; aim: THREE.Vector3; power: number; color: THREE.Color }


/** Tower positions (staggered left / right) + their aimed flood heads. */
export function towerLayout(): TowerDef[] {
  const out: TowerDef[] = [];
  const cool = new THREE.Color(0.93, 0.96, 1.0), white = new THREE.Color(1.0, 0.95, 0.88), sodium = new THREE.Color(1.0, 0.62, 0.3);
  const add = (x: number, side: 1 | -1, power = 1, h = 24, color = white) => {
    const head = new THREE.Vector3(x, h + 1.2, side * (L.TOWER_Z - 0.7));
    const target = new THREE.Vector3(x + 3, 0, -side * 0.5);
    out.push({ x, side, h, head, aim: target.sub(head).normalize(), power, color });
  };
  // paired towers (both sides at the same x) so the lanes get distinct pools with darker gaps between
  const xs = [-26, 18, 66, 116, 168, 222, 278, 336, 392, 446];
  xs.forEach((x, k) => {
    const c = k === 0 || k === 1 ? white : k % 3 === 2 ? cool : white;
    add(x, 1, k < 2 ? 1.15 : 1, 24, c);
    add(x + 1.5, -1, k < 2 ? 1.15 : 1, 24, c);
  });
  // older sodium lights through the shutdown
  add(520, 1, 0.5, 18, sodium);
  add(585, -1, 0.45, 18, sodium);
  add(650, 1, 0.4, 16, sodium);
  return out;
}

export function towerLights(t: TowerDef[]): TowerLight[] {
  return t.map((d) => ({ pos: d.head.clone().addScaledVector(d.aim, 0.6), aim: d.aim.clone(), intensity: 1150 * d.power, color: d.color }));
}

/** Instanced camera-facing quads. attrs: iPos (vec3), iSize (vec2 world m), iColor (vec3 HDR), iAim (vec3; 0 = omni). */
function billboards(n: number, map: THREE.Texture, opts: { additive: boolean; minPx?: number; fog?: boolean; aimPow?: number; drift?: boolean; toward?: number }) {
  const g = new THREE.InstancedBufferGeometry();
  const base = new THREE.PlaneGeometry(1, 1);
  g.index = base.index;
  g.setAttribute('position', base.getAttribute('position'));
  g.setAttribute('uv', base.getAttribute('uv'));
  const iPos = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  const iSize = new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2);
  const iColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  const iAim = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  g.setAttribute('iPos', iPos);
  g.setAttribute('iSize', iSize);
  g.setAttribute('iColor', iColor);
  g.setAttribute('iAim', iAim);
  g.instanceCount = n;
  const m = new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, uTime: { value: 0 }, uGain: { value: 1 }, fogColor: { value: new THREE.Color() }, fogDensity: { value: 0 } },
    vertexShader: `
attribute vec3 iPos; attribute vec2 iSize; attribute vec3 iColor; attribute vec3 iAim;
uniform float uTime;
varying vec2 vUv; varying vec3 vCol; varying float vFogDepth;
void main() {
  vUv = uv;
  vec3 wp = iPos;
  ${opts.drift ? 'wp.x += sin( uTime * 0.05 + iPos.z * 0.3 ) * 6.0; wp.z += cos( uTime * 0.04 + iPos.x * 0.1 ) * 3.0;' : ''}
  vec4 mv = viewMatrix * vec4( wp, 1.0 );
  float dist = -mv.z;
  vec3 camW = cameraPosition;
  float k = 1.0;
  if ( dot( iAim, iAim ) > 0.1 ) {
    float facing = dot( normalize( camW - wp ), iAim );
    k = pow( clamp( facing * 0.5 + 0.5, 0.0, 1.0 ), ${(opts.aimPow ?? 3).toFixed(1)} );
  }
  vCol = iColor * k;
  vec2 sz = iSize * max( 1.0, dist * ${(opts.minPx ?? 0).toFixed(5)} / max( iSize.y, 0.01 ) );
  mv.xyz += normalize( -mv.xyz ) * ${(opts.toward ?? 0).toFixed(2)};
  mv.xy += position.xy * sz;
  vFogDepth = dist;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `
uniform sampler2D map; uniform float uGain; uniform vec3 fogColor; uniform float fogDensity;
varying vec2 vUv; varying vec3 vCol; varying float vFogDepth;
void main() {
  vec4 t = texture2D( map, vUv );
  ${opts.additive
    ? 'float f = exp( -fogDensity * fogDensity * vFogDepth * vFogDepth * 0.35 ); gl_FragColor = vec4( vCol * t.rgb * t.a * uGain * f, 1.0 );'
    : 'float f = 1.0 - exp( -fogDensity * fogDensity * vFogDepth * vFogDepth ); gl_FragColor = vec4( mix( vCol, fogColor, f * 0.6 ), t.a * uGain );'}
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    transparent: true,
    depthWrite: false,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const me = new THREE.Mesh(g, m);
  me.frustumCulled = false;
  return { mesh: me, mat: m, iPos, iSize, iColor, iAim, dispose() { g.dispose(); base.dispose(); m.dispose(); } };
}

export function buildLightTowers(ctx: Ctx, towers: TowerDef[]) {
  const { cfg } = ctx;
  const G = new THREE.Group();
  G.name = 'lightTowers';
  ctx.group.add(G);
  const galv = ctx.std({ color: 0x8d949c, roughness: 0.42, metalness: 0.85 }, 1);
  const dark = ctx.std({ color: 0x1d2024, roughness: 0.5, metalness: 0.6 }, 1);
  const poleG: THREE.BufferGeometry[] = [], frameG: THREE.BufferGeometry[] = [], housG: THREE.BufferGeometry[] = [], faceG: THREE.BufferGeometry[] = [];
  const lamps: { p: THREE.Vector3; aim: THREE.Vector3; power: number; color: THREE.Color }[] = [];
  const COLS = 4, ROWS = 3;
  for (const t of towers) {
    const base = new THREE.Vector3(t.x, 0, t.side * L.TOWER_Z);
    // tapered pole (two sections) + footing + ladder rails
    const p1 = new THREE.CylinderGeometry(0.22, 0.34, t.h * 0.55, 10);
    p1.translate(base.x, t.h * 0.275, base.z);
    const p2 = new THREE.CylinderGeometry(0.15, 0.22, t.h * 0.47, 10);
    p2.translate(base.x, t.h * 0.55 + t.h * 0.22, base.z);
    poleG.push(p1, p2, box(1.1, 0.5, 1.1, base.x, 0.25, base.z));
    for (const dz of [-0.28, 0.28]) poleG.push(member(new THREE.Vector3(base.x + 0.32, 2.5, base.z + dz * 0.5), new THREE.Vector3(base.x + 0.24, t.h, base.z + dz * 0.5), 0.018, 4));
    // head frame: a tilted rack facing the aim direction
    const fwd = t.aim.clone();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const c = t.head;
    const W = 4.4, H = 2.7;
    const corner = (u: number, v: number) => c.clone().addScaledVector(right, u * W / 2).addScaledVector(up, v * H / 2);
    for (const v of [-1, -0.33, 0.33, 1]) frameG.push(member(corner(-1.05, v), corner(1.05, v), 0.05, 5));
    for (const u of [-1.05, 1.05]) frameG.push(member(corner(u, -1), corner(u, 1), 0.06, 5));
    frameG.push(member(new THREE.Vector3(base.x, t.h - 0.2, base.z), c.clone().addScaledVector(up, -H / 2), 0.1, 6));
    frameG.push(member(new THREE.Vector3(base.x, t.h + 0.4, base.z), c.clone().addScaledVector(up, H / 2), 0.07, 6));
    // service platform
    frameG.push(box(2.2, 0.06, 1.0, base.x, t.h - 0.25, base.z));
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd.clone().negate()));
    for (let i = 0; i < COLS; i++) {
      for (let j = 0; j < ROWS; j++) {
        const u = -0.75 + (i / (COLS - 1)) * 1.5, v = -0.66 + (j / (ROWS - 1)) * 1.32;
        const lp = corner(u, v).addScaledVector(fwd, 0.15);
        const hg = new THREE.BoxGeometry(0.82, 0.6, 0.42);
        hg.applyQuaternion(q);
        hg.translate(lp.x, lp.y, lp.z);
        housG.push(hg);
        const fg = new THREE.PlaneGeometry(0.7, 0.48);
        // PlaneGeometry faces +Z; basis maps local -Z → fwd, so flip to face fwd
        fg.rotateY(Math.PI);
        fg.applyQuaternion(q);
        const fp = lp.clone().addScaledVector(fwd, 0.215);
        fg.translate(fp.x, fp.y, fp.z);
        const cn = fg.getAttribute('position').count, ca = new Float32Array(cn * 3);
        for (let k = 0; k < cn; k++) { ca[k * 3] = t.color.r; ca[k * 3 + 1] = t.color.g; ca[k * 3 + 2] = t.color.b; }
        fg.setAttribute('color', new THREE.Float32BufferAttribute(ca, 3));
        faceG.push(fg);
        lamps.push({ p: fp, aim: fwd, power: t.power, color: t.color });
      }
    }
  }
  mesh(G, merge(poleG), galv, { cast: false, name: 'poles' });
  mesh(G, merge(frameG), galv, { name: 'heads' });
  mesh(G, merge(housG), dark, { name: 'housings' });
  // lamp faces: very bright emitters (bloom does the rest)
  const faceMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(26, 26, 26), vertexColors: true, side: THREE.FrontSide });
  mesh(G, merge(faceG), faceMat, { receive: false, name: 'lampFaces' });

  // ---------------- glare ----------------
  const glowT = ctx.own(glowTexture(128, 0.06));
  const flareT = ctx.own(flareTexture(256));
  const nGlow = lamps.length + towers.length;
  const glow = billboards(nGlow, glowT, { additive: true, minPx: 0.004, aimPow: 2.5, toward: 0.8 });
  ctx.own(glow);
  lamps.forEach((l, i) => {
    glow.iPos.setXYZ(i, l.p.x, l.p.y, l.p.z);
    glow.iSize.setXY(i, 1.5, 1.5);
    const k = 1.3 * l.power;
    glow.iColor.setXYZ(i, l.color.r * k, l.color.g * k, l.color.b * k);
    glow.iAim.setXYZ(i, l.aim.x, l.aim.y, l.aim.z);
  });
  towers.forEach((t, j) => {
    const i = lamps.length + j;
    const p = t.head.clone().addScaledVector(t.aim, 0.6);
    glow.iPos.setXYZ(i, p.x, p.y, p.z);
    glow.iSize.setXY(i, 13, 13);
    const k = 0.42 * t.power;
    glow.iColor.setXYZ(i, t.color.r * k, t.color.g * k * 0.97, t.color.b * k * 0.92);
    glow.iAim.setXYZ(i, t.aim.x, t.aim.y, t.aim.z);
  });
  glow.mesh.renderOrder = 8;
  glow.mesh.name = 'glare';
  G.add(glow.mesh);
  const flare = billboards(towers.length, flareT, { additive: true, minPx: 0.002, aimPow: 4, toward: 1.0 });
  ctx.own(flare);
  towers.forEach((t, i) => {
    const p = t.head.clone().addScaledVector(t.aim, 0.6);
    flare.iPos.setXYZ(i, p.x, p.y, p.z);
    flare.iSize.setXY(i, 26, 26);
    const k = 0.5 * t.power;
    flare.iColor.setXYZ(i, 0.85 * k, 0.9 * k, 1.0 * k);
    flare.iAim.setXYZ(i, t.aim.x, t.aim.y, t.aim.z);
  });
  flare.mesh.renderOrder = 9;
  G.add(flare.mesh);
  const fogged = [glow.mat, flare.mat];

  // ---------------- volumetric shafts ----------------
  let shaftMat: THREE.ShaderMaterial | null = null;
  if (cfg.shafts) {
    const len = 34;
    const cone = new THREE.CylinderGeometry(0.9, 11, len, 18, 1, true);
    cone.translate(0, -len / 2, 0); // apex region at the origin, opening down -Y
    const im = new THREE.InstancedMesh(cone, undefined as unknown as THREE.Material, towers.length);
    ctx.own(cone);
    shaftMat = new THREE.ShaderMaterial({
      uniforms: { uNoise: { value: ctx.noise }, uTime: { value: 0 }, uColor: { value: new THREE.Color(0.05, 0.05, 0.05) }, uLen: { value: len }, uCam: { value: new THREE.Vector3() } },
      vertexShader: `
varying vec3 vN; varying vec3 vW; varying float vT; varying vec3 vCol;
uniform float uLen;
void main() {
  #ifdef USE_INSTANCING_COLOR
  vCol = instanceColor;
  #else
  vCol = vec3( 1.0 );
  #endif
  vec4 w = modelMatrix * instanceMatrix * vec4( position, 1.0 );
  vW = w.xyz;
  vN = normalize( mat3( modelMatrix * instanceMatrix ) * normal );
  vT = clamp( -position.y / uLen, 0.0, 1.0 );
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
      fragmentShader: `
uniform sampler2D uNoise; uniform float uTime; uniform vec3 uColor; uniform vec3 uCam;
varying vec3 vN; varying vec3 vW; varying float vT; varying vec3 vCol;
void main() {
  vec3 v = normalize( uCam - vW );
  float th = pow( abs( dot( normalize( vN ), v ) ), 1.6 );
  float along = pow( 1.0 - vT, 1.4 ) * smoothstep( 0.0, 0.08, vT );
  float n = texture2D( uNoise, vW.xz * 0.012 + vec2( uTime * 0.006, uTime * 0.004 ) ).g;
  n *= texture2D( uNoise, vW.xy * 0.03 + vec2( -uTime * 0.01, 0.0 ) ).r * 1.6;
  float near = smoothstep( 3.0, 22.0, distance( uCam, vW ) );
  float ground = smoothstep( 0.0, 5.0, vW.y );
  gl_FragColor = vec4( uColor * vCol * th * along * ( 0.45 + n ) * near * ground, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    im.material = shaftMat;
    ctx.own(shaftMat);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    towers.forEach((t, i) => {
      q.setFromUnitVectors(new THREE.Vector3(0, -1, 0), t.aim);
      m4.compose(t.head.clone().addScaledVector(t.aim, 0.5), q, new THREE.Vector3(1, t.power, 1).setScalar(0.75 + 0.25 * t.power));
      im.setMatrixAt(i, m4);
      im.setColorAt(i, t.color);
    });
    im.frustumCulled = false;
    im.renderOrder = 7;
    im.name = 'shafts';
    G.add(im);
  }

  // ---------------- ground mist ----------------
  let mist: ReturnType<typeof billboards> | null = null;
  if (cfg.haze > 0) {
    const pt = ctx.own(puffTexture(128));
    mist = billboards(cfg.haze, pt, { additive: false, drift: true });
    ctx.own(mist);
    const r = L.rng(404);
    for (let i = 0; i < cfg.haze; i++) {
      const x = -120 + r() * 900;
      const side = r() < 0.5 ? 1 : -1;
      const z = side * (7 + r() * 40);
      mist.iPos.setXYZ(i, x, 0.8 + r() * 1.6, z);
      const s = 14 + r() * 18;
      mist.iSize.setXY(i, s * 1.6, s * 0.35);
      const c = 0.03 + r() * 0.025;
      mist.iColor.setXYZ(i, c * 0.85, c * 0.95, c * 1.2);
    }
    mist.mat.uniforms.uGain.value = 0.13;
    mist.mesh.renderOrder = 4;
    mist.mesh.name = 'mist';
    G.add(mist.mesh);
    fogged.push(mist.mat);
  }

  const camPos = new THREE.Vector3();
  return {
    lamps,
    /** Call before render: feeds camera / fog to the custom shaders. */
    preRender(camera: THREE.Camera, fog: THREE.FogExp2 | null, t: number) {
      camera.getWorldPosition(camPos);
      if (shaftMat) {
        shaftMat.uniforms.uCam.value.copy(camPos);
        shaftMat.uniforms.uTime.value = t;
      }
      for (const m of fogged) {
        m.uniforms.uTime.value = t;
        if (fog) {
          m.uniforms.fogColor.value.copy(fog.color);
          m.uniforms.fogDensity.value = fog.density;
        }
      }
    },
  };
}
