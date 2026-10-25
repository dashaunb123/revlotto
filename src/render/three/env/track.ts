// Track surface (concrete launch pad → asphalt, rubbered-in grooves, burnout + water box, paint), walls, catch
// fences, sponsor boards, distance markers, timing blocks, start / finish gantries and the ground.
import * as THREE from 'three';
import type { Ctx } from './ctx';
import { mesh } from './ctx';
import { box, capX, extrudeX, member, merge, panel, quad, tint, truss } from './geo';
import * as L from './layout';
import { asphaltSet, chainLink, concreteSet, groundSet, signTexture, sponsorAtlas, wallConcreteSet } from './textures';

const f = (n: number) => n.toFixed(3);

/** Plane in XZ from (x0, z0) to (x1, z1), facing up, UVs in metres / tile. */
function ground(x0: number, x1: number, z0: number, z1: number, tu: number, tv: number, segX = 1): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, segX, 1);
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / tu, p.getZ(i) / tv);
  return g;
}

/** The shared track-marks shader: rubber, paint, water, wall contact AO. Works for both pavements. */
function trackShader(ctx: Ctx) {
  const ticks = L.MARKERS.filter((m) => m.label !== 'FINISH').map((m) => `paint += ln(x - ${f(m.x)}, 0.05) * (step(${f(L.OUTER_Z - 1.0)}, az) + step(0.55, az) * step(az, 1.3));`).join('\n');
  return (sh: THREE.WebGLProgramParametersWithUniforms) => {
    sh.uniforms.uNoise = { value: ctx.noise };
    sh.vertexShader = 'varying vec2 vTrk;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTrk = ( modelMatrix * vec4( transformed, 1.0 ) ).xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vTrk;
uniform sampler2D uNoise;
float ln( float d, float hw ) { float w = fwidth( d ) * 0.75 + 1e-4; return 1.0 - smoothstep( hw - w, hw + w, abs( d ) ); }
`)
      .replace('#include <map_fragment>', `#include <map_fragment>
vec2 P = vTrk;
float x = P.x, az = abs( P.y ), dl = az - ${f(L.LANE_Z)};
vec3 nA = texture2D( uNoise, P * vec2( 0.021, 0.09 ) ).rgb;
vec3 nB = texture2D( uNoise, P * vec2( 0.29, 0.83 ) ).rgb;
vec3 nC = texture2D( uNoise, P * vec2( 1.7, 2.3 ) ).rgb;
// rubber: two tyre grooves per lane, heaviest at the hit, a broad film and burnout smears
float tw = 0.24 + 0.1 * nA.g;
float tyre = exp( -pow( ( abs( dl ) - 0.8 ) / tw, 2.0 ) );
float film = exp( -pow( dl / 1.5, 2.0 ) );
float launchK = smoothstep( ${f(L.BURNOUT.x0 - 1)}, ${f(L.BURNOUT.x0 + 2)}, x ) * ( 0.1 + 0.9 * exp( -max( x - 2.0, 0.0 ) / 75.0 ) );
float rub = ( tyre * 1.0 + film * 0.28 ) * launchK;
float bo = smoothstep( ${f(L.BURNOUT.x0 - 0.5)}, ${f(L.BURNOUT.x0 + 3)}, x ) * ( 1.0 - smoothstep( -3.0, 4.0, x ) );
rub = max( rub, bo * ( 0.8 * tyre + 0.55 * film ) * ( 0.5 + 1.0 * nA.r ) );
rub = max( rub, tyre * 0.16 * smoothstep( -5.0, 20.0, x ) * ( 1.0 - smoothstep( ${f(L.FINISH_X + 150)}, ${f(L.FINISH_X + 260)}, x ) ) );
rub *= 0.55 + 0.9 * nB.g * ( 0.6 + 0.8 * nC.b );
rub = clamp( rub, 0.0, 1.0 ) * ( 1.0 - step( 5.7, az ) );
// water box + water tracked forward by the tyres
float wx = abs( x - ${f((L.WATERBOX.x0 + L.WATERBOX.x1) / 2)} ) - ${f((L.WATERBOX.x1 - L.WATERBOX.x0) / 2 - 0.6)};
float wz = abs( dl ) - 2.0;
float wet = 1.0 - smoothstep( -0.5, 0.7, max( wx, wz ) + ( nA.r - 0.5 ) * 2.2 + ( nB.b - 0.5 ) * 0.6 );
wet = max( wet, tyre * step( ${f(L.WATERBOX.x1 - 1)}, x ) * ( 1.0 - smoothstep( ${f(L.WATERBOX.x1)}, ${f(L.BURNOUT.x1 + 2)}, x ) ) * smoothstep( 0.35, 0.65, nB.g ) );
wet = clamp( wet, 0.0, 1.0 ) * ( 1.0 - step( 5.4, az ) );
// paint
float paint = 0.0;
paint += ln( az - 0.48, 0.05 ) * step( ${f(L.BURNOUT.x0)}, x );
paint += ln( az - ${f(L.OUTER_Z - 0.25)}, 0.05 ) * step( ${f(L.BURNOUT.x0)}, x );
paint += ln( x, 0.05 ) * step( 0.6, az ) * step( az, ${f(L.OUTER_Z - 0.4)} );
paint += ln( x + 0.18, 0.025 ) * step( 0.6, az ) * step( az, ${f(L.OUTER_Z - 0.4)} ) * 0.6;
paint += ln( x - ${f(L.FINISH_X)}, 0.16 ) * step( 0.6, az ) * step( az, ${f(L.OUTER_Z - 0.4)} );
float inBox = step( ${f(L.BURNOUT.x0)}, x ) * step( x, ${f(L.BURNOUT.x1)} );
paint += ( ln( x - ${f(L.BURNOUT.x0)}, 0.05 ) + ln( x - ${f(L.BURNOUT.x1)}, 0.05 ) ) * step( 0.85, az ) * step( az, 5.25 );
paint += ( ln( dl + 2.2, 0.05 ) + ln( dl - 2.2, 0.05 ) ) * inBox;
${ticks}
paint = clamp( paint, 0.0, 1.0 ) * ( 1.0 - rub * 0.8 ) * ( 0.7 + 0.3 * nC.r );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.022, 0.021, 0.023 ), rub * 0.94 );
diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.80, 0.80, 0.77 ), paint );
diffuseColor.rgb *= 1.0 - 0.5 * wet;
// tar-sealed transverse seams across the asphalt, ~13.5 m apart with +-2 m jitter: subtle dark lines that only read as
// rhythm at speed (matte, no bright edges)
float sxw = x - ${f(L.CONCRETE_END)} + ( nA.r - 0.5 ) * 0.3 + ( nC.g - 0.5 ) * 0.03;
float seamK = floor( sxw / 13.5 + 0.5 );
float seamD = 1e3;
for ( int k = -1; k <= 1; k ++ ) {
  float kk = seamK + float( k );
  float sp = kk * 13.5 + ( fract( sin( kk * 12.9898 + 4.1 ) * 43758.5453 ) - 0.5 ) * 4.0;
  seamD = min( seamD, abs( sxw - sp ) );
}
// near-field only: beyond ~45 m the seams are sub-pixel and would alias into a ladder
float seamOn = step( ${f(L.CONCRETE_END + 3)}, x ) * ( 1.0 - step( ${f(L.OUTER_Z)}, az ) ) * ( 1.0 - smoothstep( 22.0, 45.0, length( vViewPosition ) ) );
float seamW = 0.05 + 0.03 * nB.r;
float seamEdge = ln( seamD - seamW - 0.02, 0.02 ) * seamOn;
float seam = ln( seamD, seamW ) * seamOn * ( 0.75 + 0.25 * nC.b );
diffuseColor.rgb *= 1.0 - 0.55 * seam;
diffuseColor.rgb *= 1.0 + 0.08 * seamEdge * ( 1.0 - seam );
// contact darkening along the walls
float ao = 1.0;
ao *= mix( 1.0, mix( 0.45, 1.0, smoothstep( 0.0, 0.8, ${f(L.OUTER_Z)} - az ) ), step( ${f(L.OWALL_X0)}, x ) * step( x, P.y > 0.0 ? ${f(L.OWALL_END_L)} : ${f(L.OWALL_END_R)} ) );
ao *= mix( 1.0, mix( 0.5, 1.0, smoothstep( 0.3, 1.0, az ) ), step( ${f(L.CWALL_START)}, x ) * step( x, ${f(L.CWALL_END)} ) );
diffuseColor.rgb *= ao;
`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix( roughnessFactor, 0.36 + 0.2 * nC.g, rub * 0.85 );
roughnessFactor = mix( roughnessFactor, 0.5, paint );
roughnessFactor = mix( roughnessFactor, 0.78, seam ); // matte tar: no glints that read as bright rungs
roughnessFactor = mix( roughnessFactor, 0.04, wet );
`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize( mix( normal, nonPerturbedNormal, max( wet, rub * 0.6 ) ) );
`);
  };
}

export function buildTrack(ctx: Ctx) {
  const { cfg, group } = ctx;
  const T = new THREE.Group();
  T.name = 'track';
  group.add(T);

  // ---------------- pavements ----------------
  const con = ctx.own(concreteSet(cfg.tex, cfg.aniso));
  const asp = ctx.own(asphaltSet(cfg.tex, cfg.aniso));
  const ext = trackShader(ctx);
  const conMat = ctx.std({ map: con.map, roughnessMap: con.roughnessMap, normalMap: con.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 1, metalness: 0 }, 0.7, ext, 'trk');
  const aspMat = ctx.std({ map: asp.map, roughnessMap: asp.roughnessMap, normalMap: asp.normalMap, normalScale: new THREE.Vector2(0.22, 0.22), roughness: 1, metalness: 0 }, 0.6, ext, 'trk');
  const W = L.OUTER_Z + 0.02;
  mesh(T, merge([
    ground(L.OWALL_X0, L.CONCRETE_END, -W, W, 5, 2.75, 40),
    ground(L.TRACK_X0, L.OWALL_X0, -13, 13, 5, 2.75, 8),
  ]), conMat, { name: 'concrete' });
  mesh(T, merge([
    ground(L.CONCRETE_END, L.TRACK_X1, -W, W, 3.5, 3.5, 80),
    // run-off between the shutdown walls and the turn-off apron
    ground(L.OWALL_END_L - 30, L.TRACK_X1, W, 14, 3.5, 3.5, 12),
  ]), aspMat, { name: 'asphalt' });

  // grass / dirt everywhere else
  const gs = ctx.own(groundSet(cfg.tex / 2, cfg.aniso));
  // texture contrast fades with distance so the tiling never bands into moire near the horizon
  const gMat = ctx.std({ map: gs.map, roughness: 1, metalness: 0, normalMap: gs.normalMap }, 0.04, (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_fragment>', '#include <map_fragment>\nfloat gFar = smoothstep( 40.0, 220.0, length( vViewPosition ) );\ndiffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.0075, 0.0095, 0.006 ), gFar );')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize( mix( normal, nonPerturbedNormal, gFar ) );');
  }, 'gnd');
  const gnd = ground(-1400, 2200, -1600, 1600, 14, 14, 1);
  gnd.translate(0, -0.03, 0);
  mesh(T, gnd, gMat, { name: 'ground', receive: false });

  // ---------------- walls ----------------
  const wc = ctx.own(wallConcreteSet(cfg.tex / 2, cfg.aniso));
  const wallMat = ctx.std({ map: wc.map, roughnessMap: wc.roughnessMap, normalMap: wc.normalMap, color: 0xd8d8d4, roughness: 1 }, 0.6);
  const steel = ctx.std({ color: 0x9aa2ab, metalness: 0.85, roughness: 0.38 }, 1.2);
  const darkSteel = ctx.std({ color: 0x2a2d31, metalness: 0.7, roughness: 0.5 }, 1);
  const zi = L.OUTER_Z, zo = L.OUTER_Z + L.OWALL_T, h = L.OWALL_H;
  const outerProf: [number, number][] = [[zi, 0], [zi, h - 0.04], [zi + 0.05, h], [zo - 0.05, h], [zo, h - 0.04], [zo, 0]];
  const mirror = (p: [number, number][]) => p.map(([z, y]) => [-z, y] as [number, number]).reverse();
  const cProf: [number, number][] = [[-0.3, 0], [-0.28, 0.08], [-0.1, 0.33], [-0.075, 0.62], [0.075, 0.62], [0.1, 0.33], [0.28, 0.08], [0.3, 0]];
  const wallG: THREE.BufferGeometry[] = [];
  const addWall = (prof: [number, number][], x0: number, x1: number) => {
    wallG.push(extrudeX(prof, x0, x1, 3, 3), capX(prof, x0, -1), capX(prof, x1, 1));
  };
  addWall(outerProf, L.OWALL_X0, L.OWALL_END_L);
  addWall(mirror(outerProf), L.OWALL_X0, L.OWALL_END_R);
  addWall(cProf, L.CWALL_START, L.CWALL_END);
  mesh(T, merge(wallG), wallMat, { cast: true, name: 'walls' });
  // steel cap on the centre wall, rail on the outer walls
  const steelG: THREE.BufferGeometry[] = [
    box(L.CWALL_END - L.CWALL_START, 0.15, 0.17, (L.CWALL_START + L.CWALL_END) / 2, 0.695, 0),
    box(L.OWALL_END_L - L.OWALL_X0, 0.06, 0.2, (L.OWALL_X0 + L.OWALL_END_L) / 2, h + 0.03, (zi + zo) / 2),
    box(L.OWALL_END_R - L.OWALL_X0, 0.06, 0.2, (L.OWALL_X0 + L.OWALL_END_R) / 2, h + 0.03, -(zi + zo) / 2),
  ];
  // impact attenuator at the nose of the centre wall
  const fenceG: THREE.BufferGeometry[] = [];
  const postStep = 3.05;
  for (const [side, x1] of [[1, L.OWALL_END_L], [-1, L.OWALL_END_R]] as const) {
    for (let x = L.OWALL_X0 + 0.2; x <= x1; x += postStep) {
      fenceG.push(member(new THREE.Vector3(x, h, side * (zi + zo) / 2), new THREE.Vector3(x, 4.4, side * (zi + zo) / 2), 0.035, 6));
    }
    const len = x1 - L.OWALL_X0;
    fenceG.push(member(new THREE.Vector3(L.OWALL_X0, 4.4, side * (zi + zo) / 2), new THREE.Vector3(x1, 4.4, side * (zi + zo) / 2), 0.03, 5));
    fenceG.push(member(new THREE.Vector3(L.OWALL_X0, 2.8, side * (zi + zo) / 2), new THREE.Vector3(x1, 2.8, side * (zi + zo) / 2), 0.022, 5));
    void len;
  }
  mesh(T, merge(steelG), steel, { cast: true, name: 'steel' });
  mesh(T, merge(fenceG), darkSteel, { name: 'fencePosts' });
  // chain link panels
  const chain = ctx.own(chainLink(128));
  chain.repeat.set(1, 1);
  const linkMat = ctx.std({ color: 0x8c949c, map: chain, alphaMap: chain, transparent: true, opacity: 0.72, metalness: 0.6, roughness: 0.45, side: THREE.DoubleSide, depthWrite: false }, 0.8);
  const linkG: THREE.BufferGeometry[] = [];
  for (const [side, x1] of [[1, L.OWALL_END_L], [-1, L.OWALL_END_R]] as const) {
    const z = side * (zi + zo) / 2;
    linkG.push(quad([new THREE.Vector3(L.OWALL_X0, h + 0.04, z), new THREE.Vector3(x1, h + 0.04, z), new THREE.Vector3(x1, 4.4, z), new THREE.Vector3(L.OWALL_X0, 4.4, z)], L.OWALL_X0 / 0.5, 0, x1 / 0.5, (4.4 - h) / 0.5));
  }
  const links = mesh(T, merge(linkG), linkMat, { receive: false, name: 'chainlink' });
  links.renderOrder = 2;

  // nose attenuator (yellow / black chevrons)
  const chevTex = ctx.own(chevronTexture());
  const noseMat = ctx.std({ map: chevTex, roughness: 0.55 }, 0.5);
  mesh(T, box(1.1, 0.86, 0.66, L.CWALL_START + 0.45, 0.43, 0), noseMat, { cast: true, name: 'attenuator' });

  // ---------------- sponsor boards on the inner faces of the outer walls ----------------
  const atlas = sponsorAtlas(cfg.aniso);
  ctx.own(atlas.texture);
  const boardMat = ctx.std({ map: atlas.texture, emissiveMap: atlas.texture, emissive: 0xffffff, emissiveIntensity: 0.05, roughness: 0.42, metalness: 0 }, 0.8);
  const boardG: THREE.BufferGeometry[] = [];
  let bi = 0;
  for (const side of [1, -1]) {
    const z = side * (zi - 0.012);
    const n = new THREE.Vector3(0, 0, -side);
    const place = (x: number) => {
      const r = atlas.rect((bi++ * 7 + (side > 0 ? 0 : 5)) % atlas.count);
      boardG.push(panel(new THREE.Vector3(x, 0.54, z), n, 4.4, 0.86, r.u0, r.v0, r.u1, r.v1));
    };
    for (let x = L.OWALL_X0 + 2.5; x < 250; x += 4.55) place(x);
    for (let x = 270; x < L.FINISH_X - 20; x += 36) place(x);
    for (let x = L.FINISH_X + 6; x < L.FINISH_X + 60; x += 4.55) place(x);
  }
  mesh(T, merge(boardG), boardMat, { name: 'sponsorBoards' });

  // ---------------- distance markers + timing blocks ----------------
  const signG: THREE.BufferGeometry[] = [];
  const signMats: THREE.Material[] = [];
  for (const m of L.MARKERS) {
    const fin = m.label === 'FINISH';
    const t = ctx.own(signTexture([{ text: m.label, size: 0.62, color: fin ? '#ffffff' : '#ffd400' }], 256, 128, fin ? '#b00010' : '#0b0b0b', { border: fin ? '#ffffff' : '#ffd400', aniso: cfg.aniso }));
    const sm = ctx.std({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.5 }, 0.5);
    signMats.push(sm);
    const g: THREE.BufferGeometry[] = [];
    for (const side of [1, -1]) {
      const z = side * ((zi + zo) / 2 - 0.08);
      g.push(panel(new THREE.Vector3(m.x, 2.1, z), new THREE.Vector3(0, 0, -side), 2.0, 1.0));
      // and one facing the drivers on the centre wall top for the bigger markers
    }
    mesh(T, merge(g), sm, { name: 'marker_' + m.label });
    // timing blocks at the lane edges
    for (const side of [1, -1]) {
      signG.push(box(0.16, 0.32, 0.14, m.x, 0.16, side * (zi - 0.12)));
      signG.push(box(0.16, 0.32, 0.14, m.x, 0.16, side * 0.42));
    }
  }
  for (const x of [-0.18, 0]) for (const side of [1, -1]) {
    signG.push(box(0.12, 0.26, 0.12, x, 0.13, side * (zi - 0.12)));
    signG.push(box(0.12, 0.26, 0.12, x, 0.13, side * 0.5));
  }
  mesh(T, merge(signG), darkSteel, { cast: true, name: 'timingBlocks' });
  const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.15, 0.08) });
  const ledG: THREE.BufferGeometry[] = [];
  for (const x of [-0.18, 0, ...L.MARKERS.map((m) => m.x)]) for (const side of [1, -1]) for (const zz of [zi - 0.12, x > 1 ? 0.42 : 0.5]) {
    ledG.push(box(0.04, 0.04, 0.16, x - 0.07, 0.26, side * zz));
  }
  mesh(T, merge(ledG), ledMat, { receive: false, name: 'timingLeds' });
  // wall reflectors every 6 m through the asphalt half (outer walls amber at 0.7 m, centre wall clear at 0.45 m):
  // small emitters that stream past the chase cam and smear into speed streaks under motion blur
  const boardXs: number[] = [];
  for (let x = 270; x < L.FINISH_X - 20; x += 36) boardXs.push(x);
  for (let x = L.FINISH_X + 6; x < L.FINISH_X + 60; x += 4.55) boardXs.push(x);
  const onBoard = (x: number) => x < 252 || boardXs.some((b) => Math.abs(b - x) < 2.45);
  const housG: THREE.BufferGeometry[] = [], lensG: THREE.BufferGeometry[] = [];
  const AMBER = new THREE.Color(2.4, 1.05, 0.18), CLEAR = new THREE.Color(1.9, 1.9, 1.75);
  const lens = (x: number, y: number, z: number, side: number, c: THREE.Color) => {
    const g = panel(new THREE.Vector3(x, y, z), new THREE.Vector3(0, 0, -side), 0.2, 0.08);
    lensG.push(tint(g, c));
  };
  for (let x = L.CONCRETE_END + 3; x < L.OWALL_END_R - 4; x += 6) {
    for (const side of [1, -1]) {
      if (side > 0 && x > L.OWALL_END_L - 4) continue;
      if (!onBoard(x)) {
        const zf = side * (zi - 0.035);
        housG.push(box(0.3, 0.14, 0.07, x, 0.7, zf));
        lens(x, 0.7, side * (zi - 0.072), side, AMBER);
      }
      if (x < L.CWALL_END - 4) {
        // clear reflector on each face of the centre wall (jersey slope at y = 0.45: half-width ~0.09)
        housG.push(box(0.2, 0.1, 0.05, x + 3, 0.45, -side * 0.105));
        lens(x + 3, 0.45, -side * 0.133, side, CLEAR);
      }
    }
  }
  mesh(T, merge(housG), darkSteel, { name: 'reflectorHousings' });
  const reflMat = new THREE.MeshBasicMaterial({ vertexColors: true, name: 'env:reflectors' });
  mesh(T, merge(lensG), reflMat, { receive: false, name: 'wallReflectors' });

  // faint staging beams across each lane (visualised IR)
  const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.05, 0.02), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
  const beamG: THREE.BufferGeometry[] = [];
  for (const x of [-0.18, 0]) for (const side of [1, -1]) beamG.push(member(new THREE.Vector3(x - 0.07, 0.2, side * 0.56), new THREE.Vector3(x - 0.07, 0.2, side * (zi - 0.18)), 0.006, 4));
  const beams = mesh(T, merge(beamG), beamMat, { receive: false, name: 'stagingBeams' });
  beams.renderOrder = 3;

  // painted lane logo on the launch pad (between the burnout box and the start line)
  const logoTex = ctx.own(signTexture([{ text: 'REVLOTTO', size: 0.7, color: '#ffffff' }], 512, 128, 'rgba(0,0,0,0)', { aniso: cfg.aniso }));
  const logoMat = ctx.std({ map: logoTex, transparent: true, opacity: 0.55, roughness: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }, 0.4);
  const logoG: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    const g = new THREE.PlaneGeometry(3.6, 0.9);
    g.rotateX(-Math.PI / 2);
    g.rotateY(-Math.PI / 2); // text reads from the stands... rotated to read toward +X travel
    g.translate(-3.2, 0.005, side * L.LANE_Z);
    logoG.push(g);
  }
  mesh(T, merge(logoG), logoMat, { receive: true, name: 'laneLogos' });

  // ---------------- gantries ----------------
  buildGantry(ctx, T, 1.6, 'start', [steel, darkSteel]);
  buildGantry(ctx, T, L.FINISH_X, 'finish', [steel, darkSteel]);

  return { conMat, aspMat, signMats, asp };
}

function chevronTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffcc00';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#111';
  for (let i = -2; i < 8; i++) {
    g.beginPath();
    g.moveTo(i * 48, 0); g.lineTo(i * 48 + 24, 0); g.lineTo(i * 48 + 24 + 64, 128); g.lineTo(i * 48 + 64, 128);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Overhead truss with banners and down-lights. */
function buildGantry(ctx: Ctx, parent: THREE.Object3D, x: number, kind: 'start' | 'finish', [steel, dark]: THREE.Material[]) {
  const zc = 7.1, top = 7.6, beamY = 7.0;
  const gs: THREE.BufferGeometry[] = [];
  for (const s of [1, -1]) {
    gs.push(truss(new THREE.Vector3(x, 0, s * zc), new THREE.Vector3(x, top, s * zc), 0.55, 0.55, 0.7, 0.03, new THREE.Vector3(1, 0, 0)));
    gs.push(box(0.9, 0.3, 0.9, x, 0.15, s * zc)); // footing
  }
  gs.push(truss(new THREE.Vector3(x, beamY, -zc - 0.3), new THREE.Vector3(x, beamY, zc + 0.3), 0.6, 0.85, 0.75, 0.03));
  mesh(parent, merge(gs), steel, { cast: true, name: kind + 'Gantry' });
  // banner (front faces -X toward the approaching cars, back faces +X)
  const front = kind === 'start'
    ? signTexture([{ text: 'REVLOTTO RACEWAY', size: 0.42, color: '#ffd23f' }, { text: 'STARTING LINE', size: 0.22, color: '#ffffff' }], 1024, 160, '#0d0d16', { border: '#ff3b30', aniso: ctx.cfg.aniso })
    : signTexture([{ text: 'FINISH', size: 0.52, color: '#ffffff' }, { text: '1/4 MILE  -  1320 FT', size: 0.2, color: '#ffd23f' }], 1024, 160, '#b0000e', { border: '#ffffff', aniso: ctx.cfg.aniso });
  const back = kind === 'start'
    ? signTexture([{ text: 'GRIPZILLA  x  NITROUZ', size: 0.4, color: '#ffffff' }], 1024, 160, '#0a2a8c', { border: '#45c8ff', aniso: ctx.cfg.aniso })
    : signTexture([{ text: 'SHUTDOWN  -  BRAKE', size: 0.4, color: '#111111' }], 1024, 160, '#ffd400', { border: '#111111', aniso: ctx.cfg.aniso });
  ctx.own(front); ctx.own(back);
  const bw = 11.6, bh = 1.6;
  const fm = ctx.std({ map: front, emissiveMap: front, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.5 }, 0.4);
  const bm = ctx.std({ map: back, emissiveMap: back, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.5 }, 0.4);
  mesh(parent, panel(new THREE.Vector3(x - 0.34, beamY, 0), new THREE.Vector3(-1, 0, 0), bw, bh), fm, { name: kind + 'BannerF' });
  mesh(parent, panel(new THREE.Vector3(x + 0.34, beamY, 0), new THREE.Vector3(1, 0, 0), bw, bh), bm, { name: kind + 'BannerB' });
  // down-lights under the truss: housings + glowing lenses (their light is in the stadium rig)
  const hous: THREE.BufferGeometry[] = [], lens: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const z = -5 + i * 2;
    hous.push(box(0.36, 0.22, 0.36, x + 0.1, beamY - 0.58, z));
    const lg = new THREE.CircleGeometry(0.14, 12);
    lg.rotateX(Math.PI / 2);
    lg.translate(x + 0.1, beamY - 0.695, z);
    lens.push(lg);
  }
  mesh(parent, merge(hous), dark, { name: kind + 'Lamps' });
  const lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8.4, 7.4) });
  mesh(parent, merge(lens), lensMat, { receive: false, name: kind + 'Lenses' });
  if (kind === 'finish') {
    // win lights: a big lamp per lane on the beam, lit by the scene when a lane wins
    void tint;
  }
}
