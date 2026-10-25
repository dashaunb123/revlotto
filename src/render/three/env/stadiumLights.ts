// Analytic stadium lighting: every light tower is an unshadowed spot evaluated in the fragment shader through
// three's own RE_Direct (so PBR materials get correct diffuse + GGX glints), without paying for real three.js lights.
// This is the "baked" tower light of the strip; materials opt in with rig.patch(material).
import * as THREE from 'three';

export interface TowerLight { pos: THREE.Vector3; aim: THREE.Vector3; intensity: number; color?: THREE.Color }

export interface StadiumRig {
  count: number;
  color: THREE.Color;
  uniforms: { uSLPos: { value: THREE.Vector4[] }; uSLAim: { value: THREE.Vector4[] }; uSLCol: { value: THREE.Color[] }; uSLColor: { value: THREE.Color }; uSLGain: { value: number }; uSLDirK: { value: number } };
  /** Adds the tower lights to a lit material. `extra` runs on the same shader (for material-specific edits). */
  patch(mat: THREE.Material, extra?: (sh: THREE.WebGLProgramParametersWithUniforms) => void, key?: string, scaleDir?: boolean): void;
  /** Scale of the scene's directional lights on patched env materials (the car key light shouldn't flood the strip). */
  setDirScale(k: number): void;
  /** Horizontal-surface illuminance at (x, z), normalised so ~1 is under a light pool, ~0 is dark. */
  lightAt(x: number, z: number, y?: number): number;
}

const COS_OUTER = Math.cos(THREE.MathUtils.degToRad(58));
const RANGE = 230;

/** Merge lights down to `max` by fusing the closest same-side neighbours (same total power). */
function reduce(ls: TowerLight[], max: number): TowerLight[] {
  const cur = ls.map((l) => ({ pos: l.pos.clone(), aim: l.aim.clone(), intensity: l.intensity, color: (l.color ?? new THREE.Color(1, 1, 1)).clone() }));
  while (cur.length > max) {
    let bi = -1, bj = -1, bd = Infinity;
    for (let i = 0; i < cur.length; i++) {
      for (let j = i + 1; j < cur.length; j++) {
        if (Math.sign(cur[i].pos.z) !== Math.sign(cur[j].pos.z)) continue;
        const d = cur[i].pos.distanceToSquared(cur[j].pos);
        if (d < bd) { bd = d; bi = i; bj = j; }
      }
    }
    if (bi < 0) break;
    const a = cur[bi], b = cur[bj], w = a.intensity / (a.intensity + b.intensity);
    a.pos.lerp(b.pos, 1 - w);
    a.aim.add(b.aim).normalize();
    if (a.color && b.color) a.color.lerp(b.color, 1 - w);
    a.intensity += b.intensity;
    cur.splice(bj, 1);
  }
  return cur;
}

const RIGS = new Map<string, StadiumRig>();
/** One shared rig per (layout, light budget): every strip of that quality reuses the same uniforms and programs. */
export function stadiumRig(key: string, lights: () => TowerLight[], max: number): StadiumRig {
  const k = `${key}:${max}`;
  let r = RIGS.get(k);
  if (!r) RIGS.set(k, (r = makeStadiumRig(lights(), max)));
  return r;
}

export function makeStadiumRig(lights: TowerLight[], max: number, color = new THREE.Color(1, 1, 1)): StadiumRig {
  const ls = reduce(lights, Math.max(1, max));
  const n = ls.length;
  const uniforms = {
    uSLPos: { value: ls.map((l) => new THREE.Vector4(l.pos.x, l.pos.y, l.pos.z, l.intensity)) },
    uSLAim: { value: ls.map((l) => new THREE.Vector4(l.aim.x, l.aim.y, l.aim.z, COS_OUTER)) },
    uSLCol: { value: ls.map((l) => (l.color ?? new THREE.Color(1, 1, 1)).clone()) },
    uSLColor: { value: color },
    uSLGain: { value: 1 },
    uSLDirK: { value: 0.35 },
  };
  const decl = `
#define SL_N ${n}
uniform vec4 uSLPos[SL_N];
uniform vec4 uSLAim[SL_N];
uniform vec3 uSLCol[SL_N];
uniform vec3 uSLColor;
uniform float uSLGain;
uniform float uSLDirK;
`;
  const begin = THREE.ShaderChunk.lights_fragment_begin.replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= uSLDirK;');
  const loopBody = `
#if defined( RE_Direct )
for ( int i = 0; i < SL_N; i ++ ) {
  vec3 slP = ( viewMatrix * vec4( uSLPos[ i ].xyz, 1.0 ) ).xyz;
  vec3 slV = slP - geometryPosition;
  float slD2 = dot( slV, slV );
  if ( slD2 > ${(RANGE * RANGE).toFixed(1)} ) continue;
  vec3 slL = slV * inversesqrt( slD2 );
  vec3 slAim = ( viewMatrix * vec4( uSLAim[ i ].xyz, 0.0 ) ).xyz;
  float slSpot = smoothstep( uSLAim[ i ].w, uSLAim[ i ].w + 0.4, dot( -slL, slAim ) );
  float slWin = 1.0 - slD2 / ${(RANGE * RANGE).toFixed(1)};
  directLight.direction = slL;
  directLight.color = uSLColor * uSLCol[ i ] * ( uSLPos[ i ].w * uSLGain * slSpot * slWin * slWin / max( slD2, 4.0 ) );
  directLight.visible = true;
  RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
}
#endif
`;
  const loopEnv = begin + loopBody, loopObj = '#include <lights_fragment_begin>\n' + loopBody;
  // CPU mirror of the shader for lightAt (horizontal surface, Lambert only)
  const ref = (() => {
    let best = 0;
    for (const l of ls) best = Math.max(best, l.intensity / (l.pos.y * l.pos.y));
    return best * 1.25;
  })();
  const v = new THREE.Vector3();
  const lightAt = (x: number, z: number, y = 0.5) => {
    let e = 0;
    for (const l of ls) {
      v.set(l.pos.x - x, l.pos.y - y, l.pos.z - z);
      const d2 = v.lengthSq();
      if (d2 > RANGE * RANGE) continue;
      v.normalize();
      const spot = THREE.MathUtils.smoothstep(-v.dot(l.aim), COS_OUTER, COS_OUTER + 0.4);
      const win = 1 - d2 / (RANGE * RANGE);
      e += (l.intensity * spot * win * win * Math.max(0, v.y)) / Math.max(d2, 4);
    }
    return Math.min(1.5, e / ref);
  };
  return {
    count: n,
    color,
    uniforms,
    lightAt,
    setDirScale(k) { uniforms.uSLDirK.value = k; },
    patch(mat, extra, key = '', scaleDir = true) {
      // Idempotent: a material is lit by the first rig that patches it (rigs are cached per light count, so their
      // uniforms are shared by every strip and outlive any one of them). userData.slPatched stays core's own flag.
      if (mat.userData.stadiumLit) return;
      mat.userData.stadiumLit = `sl${n}`;
      const tag = `|sl${n}|${key}|${scaleDir ? 1 : 0}`;
      const prev = mat.onBeforeCompile;
      mat.onBeforeCompile = (sh, r) => {
        prev?.call(mat, sh, r);
        if (sh.fragmentShader.includes('uSLPos')) return; // never inject twice, whatever chained us
        Object.assign(sh.uniforms, uniforms);
        sh.fragmentShader = decl + sh.fragmentShader.replace('#include <lights_fragment_begin>', scaleDir ? loopEnv : loopObj);
        extra?.(sh);
      };
      // keep the tag in userData.hookKey too: look's addShaderHook keys programs on it
      mat.userData.hookKey = (mat.userData.hookKey ?? '') + tag;
      const pk = mat.customProgramCacheKey.bind(mat);
      mat.customProgramCacheKey = () => pk() + tag;
      mat.needsUpdate = true;
    },
  };
}
