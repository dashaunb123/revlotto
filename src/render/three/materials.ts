// Look-dev material library for the 3D mode: car paint (clearcoat over a sparkling flake base), glass, chrome, rubber,
// carbon, trim plastics, lights, brakes, grilles, interior, plates and the livery projector.
//
// Shared/cached materials carry userData.shared = true. Never dispose those by hand: use disposeObject(root), which
// skips them. Paint panels need NO UVs: flakes are procedural in object space and liveries are projected in the
// car body's local space (see applyLivery). Parts that DO use UVs (grille planes, plates, discs) expect plain 0..1 UVs.
import * as THREE from 'three';
import type { BodyBuild, CarSpec } from './types';

type Shader = THREE.WebGLProgramParametersWithUniforms;
type M = THREE.MeshPhysicalMaterial;

const cache = new Map<string, THREE.Material>();
const texCache = new Map<string, THREE.Texture>();

function shared<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined;
  if (!m) {
    m = make();
    m.userData.shared = true;
    m.name ||= key;
    cache.set(key, m);
  }
  return m;
}

function sharedTex<T extends THREE.Texture>(key: string, make: () => T): T {
  let t = texCache.get(key) as T | undefined;
  if (!t) {
    t = make();
    t.userData.shared = true;
    texCache.set(key, t);
  }
  return t;
}

/** Chain a shader hook onto a material (keeps any earlier onBeforeCompile, e.g. env's patchStadiumLights). */
export function addShaderHook(m: THREE.Material, key: string, hook: (s: Shader, r: THREE.WebGLRenderer) => void) {
  const prev = m.onBeforeCompile;
  const prevKey = m.userData.hookKey ?? '';
  m.onBeforeCompile = (s, r) => {
    prev.call(m, s, r);
    hook(s, r);
  };
  m.userData.hookKey = prevKey + '|' + key;
  m.customProgramCacheKey = () => m.userData.hookKey as string;
  m.needsUpdate = true;
}

const inject = (src: string, at: string, code: string, before = false) =>
  src.includes(at) ? src.replace(at, before ? code + '\n' + at : at + '\n' + code) : src;

const col = (c: THREE.ColorRepresentation) => new THREE.Color(c);
const hsl = (c: THREE.ColorRepresentation) => col(c).getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Deterministic noise for canvas textures.
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// ---------------------------------------------------------------------------------------------------------------
// GLSL shared bits

const GLSL_HASH = /* glsl */ `
vec3 lkHash3(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}`;

// Object-space position/normal varyings (procedural flake + triplanar textures need no UVs).
const OBJ_VARYINGS = `varying vec3 vLkP;\nvarying vec3 vLkN;`;
function objectSpaceVaryings(s: Shader) {
  s.vertexShader = OBJ_VARYINGS + '\n' + s.vertexShader;
  s.vertexShader = inject(s.vertexShader, '#include <begin_vertex>', 'vLkP = position; vLkN = normal;');
  s.fragmentShader = OBJ_VARYINGS + '\n' + s.fragmentShader;
}

// ---------------------------------------------------------------------------------------------------------------
// Car paint

export type PaintFinish = 'solid' | 'metallic' | 'pearl' | 'matte' | 'candy';
export interface PaintOpts {
  finish?: PaintFinish;
  /** Flake strength 0..1 (metallic default 0.6, pearl 0.35, solid 0). */
  flake?: number;
  /** Clearcoat 0..1 (default 1, matte 0). */
  clearcoat?: number;
  /** Pearl colour shift 0..1 (pearl default 0.7). */
  pearl?: number;
  /** Base-layer roughness override. */
  roughness?: number;
}

/** Sensible finish for a colour: bright saturated colours stay solid (like factory solids), whites go pearl. */
export function autoFinish(color: string): PaintFinish {
  const { s, l } = hsl(color);
  if (l > 0.82 && s < 0.25) return 'pearl';
  if (s > 0.75 && l > 0.42) return 'solid';
  return 'metallic';
}

const FLAKE_PARS = /* glsl */ `
uniform float uFlake;
uniform float uFlakeCells;
${GLSL_HASH}
`;
// Runs after normal_fragment_maps: perturb the BASE normal only (clearcoat keeps nonPerturbedNormal, so the coat stays
// a mirror over the sparkle). Flakes are LOD-blended so they stay ~1-2 px and fade in strength with distance.
const FLAKE_MAIN = /* glsl */ `
#ifndef LK_NO_FLAKE
{
  float lkFoot = max(length(fwidth(vLkP)), 1e-6);
  float lkLod = max(log2(lkFoot * uFlakeCells) + 0.6, 0.0);
  float lkL0 = floor(lkLod);
  float lkC0 = uFlakeCells * exp2(-lkL0);
  vec3 lkA = lkHash3(floor(vLkP * lkC0) + 0.5);
  vec3 lkB = lkHash3(floor(vLkP * lkC0 * 0.5) + 17.5);
  vec3 lkR = mix(lkA, lkB, lkLod - lkL0);
  float lkK = uFlake * lkFlakeMask * exp2(-lkLod * 1.25);
  vec3 lkV = lkR * 2.0 - 1.0;
  lkV -= normal * dot(lkV, normal);
  normal = normalize(normal + lkV * 0.26 * lkK);
  roughnessFactor = clamp(roughnessFactor * mix(1.0, 0.7 + 0.6 * lkR.z, lkK), 0.06, 1.0);
}
#endif
`;

function makePaint(color: string, o: PaintOpts, flipKey = ''): M {
  const finish = o.finish ?? 'metallic';
  const c = col(color);
  const m = new THREE.MeshPhysicalMaterial({ color: c });
  let flake = 0;
  switch (finish) {
    case 'solid':
      m.metalness = 0;
      m.roughness = 0.32;
      flake = o.flake ?? 0;
      break;
    case 'metallic':
      m.metalness = 0.62;
      m.roughness = 0.38;
      flake = o.flake ?? 0.6;
      break;
    case 'candy': {
      m.metalness = 0.85;
      m.roughness = 0.22;
      flake = o.flake ?? 0.75;
      const { h, s, l } = hsl(color);
      m.color.setHSL(h, Math.min(1, s * 1.15), l * 0.8, THREE.SRGBColorSpace);
      break;
    }
    case 'pearl':
      m.metalness = 0.25;
      m.roughness = 0.3;
      flake = o.flake ?? 0.35;
      m.iridescence = o.pearl ?? 0.7;
      m.iridescenceIOR = 1.32;
      m.iridescenceThicknessRange = [180, 420];
      m.sheen = 0.35;
      m.sheenRoughness = 0.45;
      m.sheenColor = c.clone().lerp(col('#ffffff'), 0.5);
      break;
    case 'matte':
      m.metalness = 0.35;
      m.roughness = 0.55;
      flake = o.flake ?? 0.2;
      break;
  }
  if (o.roughness !== undefined) m.roughness = o.roughness;
  // Cap the base colour's linear luminance: bright saturated paint (lime, yellow) otherwise reads self-lit under ACES.
  // Saturated colours cap at 0.5, near-whites at 0.75 so a white car stays white.
  {
    const L = 0.2126 * m.color.r + 0.7152 * m.color.g + 0.0722 * m.color.b;
    const cap = 0.75 - 0.25 * hsl(color).s;
    if (L > cap) m.color.multiplyScalar(cap / L);
  }
  m.clearcoat = o.clearcoat ?? (finish === 'matte' ? 0 : 1);
  m.clearcoatRoughness = 0.035;
  // The coat carries the air/paint Fresnel; the base layer's own specular sits under it (paint/coat interface).
  m.specularIntensity = m.clearcoat > 0 ? 0.7 : 1;
  m.ior = 1.5;
  // Reflections sell the paint at race distance (stadium towers sliding over the panels).
  m.envMapIntensity = 1.5;
  // Direct-light glints: boosted when env's stadium lights are patched in (race), plain under the studio rig.
  const glint = { get value() { return m.userData.stadiumLit ? 1.4 : 1.0; } };
  const u = { uFlake: { value: flake }, uFlakeCells: { value: 380 }, uGlint: glint };
  m.userData.uniforms = u;
  m.userData.paint = { color, finish, flake };
  addShaderHook(m, 'paint' + (flake > 0 ? '+flake' : '') + flipKey, (s) => {
    Object.assign(s.uniforms, u);
    if (flake <= 0) s.fragmentShader = '#define LK_NO_FLAKE\n' + s.fragmentShader;
    objectSpaceVaryings(s);
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n' + FLAKE_PARS + '\nuniform float uGlint;\nfloat lkFlakeMask = 1.0;');
    s.fragmentShader = inject(s.fragmentShader, '#include <normal_fragment_maps>', FLAKE_MAIN);
    s.fragmentShader = inject(
      s.fragmentShader,
      '#include <lights_fragment_end>',
      'reflectedLight.directSpecular *= uGlint;\n#ifdef USE_CLEARCOAT\nclearcoatSpecularDirect *= uGlint;\n#endif',
    );
  });
  return m;
}

/** Car paint. Cached by colour + options (shared; per-car liveries get their own via applyLivery). */
export function paintMaterial(color: string, o: PaintOpts = {}): M {
  return shared(`paint:${color}:${JSON.stringify(o)}`, () => makePaint(color, o));
}

// ---------------------------------------------------------------------------------------------------------------
// Glass: premultiplied output so reflections stay at full strength while the tinted body stays see-through; Fresnel
// raises the opacity at grazing angles. No transmission pass.

export interface GlassOpts {
  tint?: string;
  /** Head-on opacity of side glass (floored at 0.5: night glass must read as glass, not as an open cabin). */
  opacity?: number;
  /** Head-on opacity of raked panes (windshield / rear glass; picked by the pane's world-up tilt). Floored at 0.62. */
  front?: number;
  /** Force backlight treatment (dark tint, ~0.66 opaque). Rear-facing panes get it automatically (car-space normal). */
  rear?: boolean;
  roughness?: number;
}

interface GlassCfg {
  side: number;
  front: number;
  /** Backlight (rear-facing pane) opacity + tint; rearAuto picks it from the pane's car-space normal. */
  rear: number;
  rearTint: string;
  rearAuto: boolean;
  /** Env reflection strength and how much of the direct lights' glint is kept. */
  env: number;
  glint: number;
  depthWrite: boolean;
}

function makeGlass(tint: string, roughness: number, c: GlassCfg): M {
  const m = new THREE.MeshPhysicalMaterial({
    color: col(tint),
    metalness: 0,
    roughness,
    transparent: true,
    opacity: c.side,
    // Car glass writes depth so smoke/FX behind the cabin can't paint over it unattenuated (it read as no glass).
    depthWrite: c.depthWrite,
    side: THREE.DoubleSide,
    premultipliedAlpha: true,
    specularIntensity: 1,
    ior: 1.52,
    envMapIntensity: c.env,
  });
  const u = {
    uFrontOp: { value: c.front },
    uGlassGlint: { value: c.glint },
    uRearOp: { value: c.rear },
    uRearTint: { value: col(c.rearTint) },
    uRearAuto: { value: c.rearAuto ? 1 : 0 },
  };
  addShaderHook(m, 'glass', (s) => {
    Object.assign(s.uniforms, u);
    // Pane geometry is authored in body space, so the object-space normal says which way the pane faces on the car.
    s.vertexShader = 'varying vec3 vLkObjN;\n' + inject(s.vertexShader, '#include <begin_vertex>', 'vLkObjN = normal;');
    s.fragmentShader = s.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nuniform float uFrontOp;\nuniform float uGlassGlint;\nuniform float uRearOp;\nuniform vec3 uRearTint;\nuniform float uRearAuto;\nvarying vec3 vLkObjN;',
    );
    // Delta (directional/point) lights glint over a whole flat pane at mirror roughness ("a sheet of paper"). The env
    // carries most of the light's image as streaks; keep part of the glint so tower lights still slide across.
    s.fragmentShader = inject(s.fragmentShader, '#include <lights_fragment_end>', 'reflectedLight.directSpecular *= uGlassGlint;');
    // Always shade glass from the viewer's side: a pane whose winding disagrees with its normals would otherwise get
    // an inward normal from the double-sided flip, read as grazing (Fresnel -> opaque) and mirror the wrong direction.
    s.fragmentShader = inject(
      s.fragmentShader,
      '#include <normal_fragment_maps>',
      /* glsl */ `
      if (dot(normal, normalize(vViewPosition)) < 0.0) normal = -normal;
      // car-space normal on the viewer's side (same flips as the shading normal), then: is this a backlight?
      vec3 lkON = normalize(vLkObjN) * (dot(normalize(vNormal), normal) < 0.0 ? -1.0 : 1.0);
      float lkRear = max(uRearAuto * smoothstep(0.35, 0.6, -lkON.x), 1.0 - uRearAuto);
      lkRear *= step(0.5, uRearOp);
      diffuseColor.rgb = mix(diffuseColor.rgb, uRearTint, lkRear);`,
    );
    s.fragmentShader = s.fragmentShader.replace(
      '#include <opaque_fragment>',
      /* glsl */ `
      float lkNV = saturate(dot(normal, normalize(vViewPosition)));
      float lkF = 0.1 + 0.9 * pow(1.0 - lkNV, 5.0);
      float lkUp = abs(inverseTransformDirection(normal, viewMatrix).y);
      float lkOp = mix(diffuseColor.a, uFrontOp, smoothstep(0.3, 0.6, lkUp));
      lkOp = mix(lkOp, max(lkOp, uRearOp), lkRear);
      float lkA = mix(lkOp, 1.0, lkF);
      gl_FragColor = vec4(totalDiffuse * lkA + (outgoingLight - totalDiffuse), lkA);`,
    );
    s.fragmentShader = s.fragmentShader.replace('#include <premultiplied_alpha_fragment>', '');
  });
  return m;
}

/**
 * Car glass: dark tint; head-on opacity side ~0.47, raked windshield ~0.62, rear-facing backlight ~0.66 with a darker
 * tint (detected per pane, or forced with rear: true); a mirror at grazing angles. Night glass must read as glass.
 */
export function glass(o: GlassOpts = {}): M {
  const tint = o.tint ?? '#0e1216';
  const side = Math.max(0.45, o.opacity ?? 0.47);
  const front = Math.max(0.62, o.front ?? side + 0.08);
  const rear = Math.max(0.66, side);
  const r = o.roughness ?? 0.03;
  const forced = !!o.rear;
  return shared(`glass:${tint}:${side}:${front}:${r}:${forced}`, () =>
    makeGlass(tint, r, { side, front, rear, rearTint: '#07090c', rearAuto: !forced, env: 1.5, glint: 0.35, depthWrite: true }),
  );
}

/** Light lens over an emitter (clear, red, amber, smoked). Mostly see-through. */
export function lens(o: { tint?: string; opacity?: number } = {}): M {
  const tint = o.tint ?? '#f4f6f8';
  const op = o.opacity ?? 0.12;
  return shared(`lens:${tint}:${op}`, () =>
    makeGlass(tint, 0.03, { side: op, front: op, rear: 0, rearTint: tint, rearAuto: true, env: 0.9, glint: 0.15, depthWrite: false }),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Metals

export function chrome(): M {
  return shared('chrome', () => new THREE.MeshPhysicalMaterial({ color: col('#c8ccd2'), metalness: 1, roughness: 0.035 }));
}

/** Black chrome / smoked metal (window trim on modern cars, tail pipe interiors). */
export function blackChrome(): M {
  return shared('blackChrome', () => new THREE.MeshPhysicalMaterial({ color: col('#2a2c30'), metalness: 1, roughness: 0.12 }));
}

function brushedTex() {
  return sharedTex('brushed', () =>
    canvasTex(
      256,
      256,
      (g) => {
        const r = rng(7);
        g.fillStyle = '#9a9a9a';
        g.fillRect(0, 0, 256, 256);
        for (let y = 0; y < 256; y++) {
          const v = 120 + r() * 90;
          g.fillStyle = `rgb(${v},${v},${v})`;
          g.fillRect(0, y, 256, 1);
          if (r() < 0.25) {
            g.fillStyle = `rgba(255,255,255,${r() * 0.25})`;
            g.fillRect(r() * 256, y, 20 + r() * 120, 1);
          }
        }
      },
      false,
    ),
  );
}

/** Brushed metal (intakes, plenum, wheelie bar, interior trim). Brush lines run along U. */
export function brushedMetal(color = '#b4b6ba'): M {
  return shared(`brushed:${color}`, () => {
    const m = new THREE.MeshPhysicalMaterial({ color: col(color), metalness: 1, roughness: 0.5, roughnessMap: brushedTex() });
    m.roughnessMap!.repeat.set(1, 4);
    return m;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Rubber, plastics, carbon

/** Tyre rubber: tread is dull, the sidewall slightly dressed (a touch of sheen). */
export function rubber(o: { sidewall?: boolean } = {}): M {
  return o.sidewall
    ? shared('rubber:side', () =>
        new THREE.MeshPhysicalMaterial({ color: col('#18181a'), metalness: 0, roughness: 0.68, sheen: 0.25, sheenRoughness: 0.6, sheenColor: col('#4a4a50') }),
      )
    : shared('rubber', () => new THREE.MeshPhysicalMaterial({ color: col('#131315'), metalness: 0, roughness: 0.93 }));
}

/** Matte trim plastic (bumper inserts, mirrors bases, wheel-well liners, diffusers). gloss 0..1. */
export function plastic(color = '#141416', o: { gloss?: number } = {}): M {
  const g = o.gloss ?? 0;
  return shared(`plastic:${color}:${g}`, () =>
    new THREE.MeshPhysicalMaterial({ color: col(color), metalness: 0, roughness: 0.7 - g * 0.5, clearcoat: g > 0.5 ? 1 : 0, clearcoatRoughness: 0.08 }),
  );
}

function weaveTex() {
  // 2x2 twill, 8 tows per tile. R = albedo factor, G = roughness factor.
  return sharedTex('weave', () =>
    canvasTex(
      256,
      256,
      (g) => {
        const n = 8;
        const s = 256 / n;
        const r = rng(3);
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++) {
            const warp = (i + j) % 4 < 2;
            const grd = warp ? g.createLinearGradient(i * s, 0, (i + 1) * s, 0) : g.createLinearGradient(0, j * s, 0, (j + 1) * s);
            const hi = warp ? 255 : 150;
            const lo = warp ? 150 : 90;
            grd.addColorStop(0, `rgb(${lo},${lo + 30},0)`);
            grd.addColorStop(0.5, `rgb(${hi},${warp ? 90 : 200},0)`);
            grd.addColorStop(1, `rgb(${lo},${lo + 30},0)`);
            g.fillStyle = grd;
            g.fillRect(i * s, j * s, s, s);
            // fibre strands along the tow
            g.fillStyle = 'rgba(0,0,0,0.18)';
            for (let k = 0; k < 6; k++) {
              const o = r() * s;
              if (warp) g.fillRect(i * s + o, j * s, 1, s);
              else g.fillRect(i * s, j * s + o, s, 1);
            }
            g.fillStyle = 'rgba(0,0,0,0.5)';
            g.fillRect(i * s, j * s, warp ? 1 : s, warp ? s : 1);
          }
      },
      false,
    ),
  );
}

/** Carbon fibre with a clear coat. Triplanar in object space, so it works on UV-less body panels (carbon hoods). */
export function carbon(o: { gloss?: boolean; scale?: number } = {}): M {
  const gloss = o.gloss ?? true;
  const scale = o.scale ?? 7; // weave tiles per metre (8 tows each: ~18 mm tows, readable in close-ups)
  return shared(`carbon:${gloss}:${scale}`, () => {
    const m = new THREE.MeshPhysicalMaterial({ color: col('#3a3c42'), metalness: 0.35, roughness: 0.42, clearcoat: gloss ? 1 : 0, clearcoatRoughness: 0.09 });
    const u = { uWeave: { value: weaveTex() }, uWeaveScale: { value: scale } };
    addShaderHook(m, 'carbon', (s) => {
      Object.assign(s.uniforms, u);
      objectSpaceVaryings(s);
      s.fragmentShader = s.fragmentShader.replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D uWeave;\nuniform float uWeaveScale;\n' +
          /* glsl */ `
          vec4 lkTri(sampler2D t, vec3 p, vec3 n) {
            vec3 w = pow(abs(normalize(n)), vec3(6.0)); w /= (w.x + w.y + w.z);
            return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z;
          }`,
      );
      s.fragmentShader = inject(
        s.fragmentShader,
        '#include <metalnessmap_fragment>',
        `vec4 lkW = lkTri(uWeave, vLkP * uWeaveScale, vLkN);
         diffuseColor.rgb *= 0.25 + 0.95 * lkW.r;
         roughnessFactor *= 0.55 + 0.9 * lkW.g;`,
      );
    });
    return m;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Lights

/**
 * Emissive light emitter (LEDs, bulbs, reflectors). intensity is the ON level (HDR: >1 blooms; 4-12 for brake lights
 * and headlights). Not shared: each car toggles its own. Use setLightLevel(mat, k) (0 = off glow, 1 = on, 1.5 = boost).
 */
export function lightMaterial(color: string, intensity = 6): THREE.MeshStandardMaterial {
  const c = col(color);
  const m = new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.35), emissive: c, emissiveIntensity: intensity, roughness: 0.35, metalness: 0 });
  m.userData.on = intensity;
  m.userData.off = Math.min(0.08 * intensity, 0.5);
  setLightLevel(m, 1);
  return m;
}

/** 0 = off (faint reflector glow), 1 = fully on; values between fade, >1 boosts. */
export function setLightLevel(m: THREE.Material, k: number) {
  const s = m as THREE.MeshStandardMaterial;
  if (!s.isMeshStandardMaterial) return;
  const on = (s.userData.on as number) ?? 1;
  const off = (s.userData.off as number) ?? 0.05;
  s.emissiveIntensity = off + (on - off) * k;
}

// ---------------------------------------------------------------------------------------------------------------
// Brakes, wheels, grilles

function discTex() {
  return sharedTex('disc', () =>
    canvasTex(512, 512, (g) => {
      const c = 256;
      const r = rng(11);
      g.fillStyle = '#5a5a5e';
      g.fillRect(0, 0, 512, 512);
      // swept area: concentric machining rings
      for (let rad = 250; rad > 120; rad -= 1.5) {
        const v = 120 + r() * 50;
        g.strokeStyle = `rgb(${v},${v},${v + 4})`;
        g.lineWidth = 1.5;
        g.beginPath();
        g.arc(c, c, rad, 0, Math.PI * 2);
        g.stroke();
      }
      // hat (inner bell)
      g.fillStyle = '#3c3c42';
      g.beginPath();
      g.arc(c, c, 118, 0, Math.PI * 2);
      g.fill();
      // cross-drilled holes in 3 staggered rings + curved slots
      g.fillStyle = '#0c0c0e';
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        const rr = [150, 185, 220][i % 3];
        g.beginPath();
        g.arc(c + Math.cos(a) * rr, c + Math.sin(a) * rr, 7, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = '#1a1a1c';
      g.lineWidth = 4;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.2;
        g.beginPath();
        g.arc(c, c, 205, a, a + 0.35);
        g.stroke();
      }
      // heat tint at the edge of the swept area
      const grd = g.createRadialGradient(c, c, 120, c, c, 256);
      grd.addColorStop(0, 'rgba(90,70,120,0.18)');
      grd.addColorStop(0.5, 'rgba(0,0,0,0)');
      grd.addColorStop(1, 'rgba(120,80,40,0.15)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 512, 512);
    }),
  );
}

/** Drilled + slotted brake disc. UVs: planar disc UVs centred on (0.5, 0.5) (CircleGeometry / cylinder caps). */
export function brakeDisc(): M {
  return shared('brakeDisc', () => new THREE.MeshPhysicalMaterial({ color: col('#ffffff'), map: discTex(), metalness: 0.9, roughness: 0.42 }));
}

/** Painted brake caliper (glossy). */
export function caliper(color = '#c8161e'): M {
  return shared(`caliper:${color}`, () => new THREE.MeshPhysicalMaterial({ color: col(color), metalness: 0.1, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 }));
}

/** Wheel finish from the rim colour: silver -> machined alloy, gold/bronze -> metallic, black/white/colours -> gloss paint. */
export function rimMaterial(color: string): M {
  return shared(`rim:${color}`, () => {
    const { h, s, l } = hsl(color);
    const c = col(color);
    if (s < 0.2 && l > 0.6 && l < 0.9) return new THREE.MeshPhysicalMaterial({ color: c, metalness: 1, roughness: 0.2, clearcoat: 0.6, clearcoatRoughness: 0.06 });
    if (h > 0.08 && h < 0.17 && s > 0.3 && l < 0.75) return new THREE.MeshPhysicalMaterial({ color: c, metalness: 1, roughness: 0.28, clearcoat: 0.6 });
    return new THREE.MeshPhysicalMaterial({ color: c, metalness: l < 0.2 ? 0.4 : 0.15, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.05 });
  });
}

export type GrillePattern = 'honeycomb' | 'mesh' | 'bars' | 'slats';
function grilleTex(p: GrillePattern) {
  return sharedTex('grille:' + p, () =>
    canvasTex(
      256,
      256,
      (g) => {
        g.fillStyle = '#000';
        g.fillRect(0, 0, 256, 256);
        g.fillStyle = g.strokeStyle = '#fff';
        if (p === 'honeycomb') {
          g.lineWidth = 10;
          const r = 32;
          const hx = r * Math.sqrt(3);
          for (let row = -1; row < 6; row++)
            for (let k = -1; k < 6; k++) {
              const cx = k * hx + (row % 2 ? hx / 2 : 0);
              const cy = row * r * 1.5;
              g.beginPath();
              for (let i = 0; i < 6; i++) {
                const a = Math.PI / 6 + (i * Math.PI) / 3;
                g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
              }
              g.closePath();
              g.stroke();
            }
        } else if (p === 'mesh') {
          g.lineWidth = 12;
          for (let i = -256; i < 512; i += 48) {
            g.beginPath();
            g.moveTo(i, 0);
            g.lineTo(i + 256, 256);
            g.moveTo(i + 256, 0);
            g.lineTo(i, 256);
            g.stroke();
          }
        } else if (p === 'bars') {
          for (let y = 0; y < 256; y += 64) g.fillRect(0, y, 256, 26);
        } else {
          for (let y = 0; y < 256; y += 32) g.fillRect(0, y, 256, 14);
          for (let x = 0; x < 256; x += 128) g.fillRect(x, 0, 10, 256);
        }
      },
      false,
    ),
  );
}

/** Grille insert: a plane with alpha-tested holes (put a dark plastic() backing behind it). repeat = tiles across U,V. */
export function grille(o: { pattern?: GrillePattern; repeat?: [number, number]; color?: string } = {}): M {
  const p = o.pattern ?? 'honeycomb';
  const rep = o.repeat ?? [6, 2];
  const color = o.color ?? '#1a1a1e';
  return shared(`grille:${p}:${rep}:${color}`, () => {
    const t = grilleTex(p).clone();
    t.userData.shared = true;
    t.repeat.set(rep[0], rep[1]);
    t.needsUpdate = true;
    return new THREE.MeshPhysicalMaterial({ color: col(color), metalness: 0.4, roughness: 0.45, alphaMap: t, alphaTest: 0.5, side: THREE.DoubleSide });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Interior, plates, badges

export function interior(kind: 'seat' | 'dash' | 'carpet' | 'wheel' | 'trim' = 'dash'): M {
  // Inside a closed cabin: dark albedo and little sky light (IBL has no roof occlusion, so the env would light the
  // cabin as if it were open).
  return shared('int:' + kind, () => {
    let m: M;
    switch (kind) {
      case 'seat':
        m = new THREE.MeshPhysicalMaterial({ color: col('#1a1a1d'), roughness: 0.9, sheen: 0.15, sheenRoughness: 0.8, sheenColor: col('#2c2c32') });
        break;
      case 'carpet':
        m = new THREE.MeshPhysicalMaterial({ color: col('#101012'), roughness: 1 });
        break;
      case 'wheel':
        m = new THREE.MeshPhysicalMaterial({ color: col('#161619'), roughness: 0.55, clearcoat: 0.3 });
        break;
      case 'trim':
        m = new THREE.MeshPhysicalMaterial({ color: col('#34343a'), metalness: 0.8, roughness: 0.35 });
        break;
      default:
        m = new THREE.MeshPhysicalMaterial({ color: col('#19191d'), roughness: 0.72 });
    }
    m.color.multiplyScalar(0.55);
    m.envMapIntensity = kind === 'trim' || kind === 'wheel' ? 0.4 : 0.3;
    return m;
  });
}

/** Licence plate with a parody header (UV 0..1 on a 2:1 plane, ~0.52 x 0.11 m US or 0.52 x 0.26 m square-ish). */
export function plateMaterial(text = 'RVL 777'): M {
  return shared('plate:' + text, () => {
    const t = canvasTex(512, 256, (g) => {
      g.fillStyle = '#eef0ee';
      g.fillRect(0, 0, 512, 256);
      g.strokeStyle = '#20263a';
      g.lineWidth = 10;
      g.strokeRect(8, 8, 496, 240);
      g.fillStyle = '#9b1c22';
      g.font = 'bold 40px Arial, sans-serif';
      g.textAlign = 'center';
      g.fillText('QUARTER MILE STATE', 256, 58);
      g.fillStyle = '#1b2244';
      g.font = 'bold 128px "Arial Narrow", Arial, sans-serif';
      g.fillText(text, 256, 196);
      g.font = '24px Arial, sans-serif';
      g.fillText('REVLOTTO', 256, 236);
    });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.35, metalness: 0.2, clearcoat: 0.5 });
  });
}

/** Chrome lettering / emblem on a transparent plane (alpha-tested). */
export function badgeMaterial(text: string, color = '#d8dce2'): M {
  return shared(`badge:${text}:${color}`, () => {
    const t = canvasTex(512, 128, (g) => {
      g.clearRect(0, 0, 512, 128);
      g.fillStyle = '#fff';
      g.font = 'italic bold 96px "Arial Black", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 256, 68, 500);
    });
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return new THREE.MeshPhysicalMaterial({ color: col(color), metalness: 1, roughness: 0.15, alphaMap: t, alphaTest: 0.4, transparent: false });
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Liveries: projected in BODY space, so modelers never need paint UVs. The atlas holds five views of the car
// (left side, right side, top, front, rear); the paint shader picks them by the body-space normal (triplanar blend).

export interface LiveryLayout {
  min: THREE.Vector3;
  max: THREE.Vector3;
  /** Beltline (window sill) height, rocker top, door shut lines, cowl x (windshield base), wheel centres. */
  belt: number;
  sill: number;
  door: [number, number];
  cowl: number;
  wheelF: number;
  wheelR: number;
  wheelRad: number;
}

const ATLAS_G = 10; // gutter px per region (keeps mips from bleeding)
type Region = 'L' | 'R' | 'T' | 'F' | 'B';
// Canvas px rects (top-left origin) for an S x S atlas: four rows of S/4.
function regionRect(r: Region, S: number): [number, number, number, number] {
  const q = S / 4;
  switch (r) {
    case 'L':
      return [0, 0, S, q];
    case 'R':
      return [0, q, S, q];
    case 'T':
      return [0, 2 * q, S, q];
    case 'F':
      return [0, 3 * q, S / 2, q];
    case 'B':
      return [S / 2, 3 * q, S / 2, q];
  }
}

/** Shader rect (texture uv space, bottom-left origin) of a region's usable area. */
function regionUv(r: Region, S: number): THREE.Vector4 {
  const [x, y, w, h] = regionRect(r, S);
  return new THREE.Vector4((x + ATLAS_G) / S, 1 - (y + h - ATLAS_G) / S, (w - 2 * ATLAS_G) / S, (h - 2 * ATLAS_G) / S);
}

/** Painter that draws in body-space metres onto one atlas region. */
class LiveryPainter {
  constructor(
    readonly g: CanvasRenderingContext2D,
    readonly S: number,
    readonly L: LiveryLayout,
  ) {}

  /** Map (a, b) in metres for a region to canvas px. a/b are (x, y) for sides, (x, z) top, (z, y) front/rear. */
  frame(r: Region) {
    const [rx, ry, rw, rh] = regionRect(r, this.S);
    const { min, max } = this.L;
    const W = rw - 2 * ATLAS_G;
    const H = rh - 2 * ATLAS_G;
    let a0 = min.x,
      a1 = max.x,
      b0 = min.y,
      b1 = max.y,
      flip = false;
    if (r === 'R') flip = true; // viewed from the right: front on the left
    if (r === 'T') ((b0 = min.z), (b1 = max.z));
    if (r === 'F') ((a0 = min.z), (a1 = max.z), (flip = true)); // viewed from the front: +Z (car's left) on the right... mirrored
    if (r === 'B') ((a0 = min.z), (a1 = max.z));
    const sa = W / (a1 - a0);
    const sb = H / (b1 - b0);
    const px = (a: number) => rx + ATLAS_G + (flip ? a1 - a : a - a0) * sa;
    const py = (b: number) => ry + ATLAS_G + (b1 - b) * sb;
    return { px, py, sa, sb, flip, rect: [rx, ry, rw, rh] as const };
  }

  /** Set the canvas transform so paths are drawn in region metres; clip to the region. */
  begin(r: Region) {
    const f = this.frame(r);
    const g = this.g;
    g.save();
    g.beginPath();
    g.rect(...f.rect);
    g.clip();
    const ox = f.px(0);
    const oy = f.py(0);
    g.setTransform(f.flip ? -f.sa : f.sa, 0, 0, -f.sb, ox, oy);
    return f;
  }
  end() {
    this.g.restore();
  }

  rect(r: Region, a0: number, a1: number, b0: number, b1: number, fill: string | CanvasGradient) {
    this.begin(r);
    this.g.fillStyle = fill;
    this.g.fillRect(Math.min(a0, a1), Math.min(b0, b1), Math.abs(a1 - a0), Math.abs(b1 - b0));
    this.end();
  }

  /** Both sides at once. */
  sides(fn: (r: Region) => void) {
    fn('L');
    fn('R');
  }

  /** Upright text centred at (a, b) metres with cap height h metres (never mirrored). */
  text(r: Region, s: string, a: number, b: number, h: number, fill: string, o: { font?: string; stroke?: string; italic?: boolean; maxW?: number } = {}) {
    const f = this.frame(r);
    const g = this.g;
    g.save();
    g.beginPath();
    g.rect(...f.rect);
    g.clip();
    const k = 100;
    g.setTransform((f.sa * h) / k, 0, 0, (f.sb * h) / k, f.px(a), f.py(b));
    g.font = `${o.italic ? 'italic ' : ''}${o.font ?? '900 132px "Arial Black", Impact, Arial, sans-serif'}`.replace('132px', `${k * 1.36}px`);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const maxW = o.maxW ? (o.maxW / h) * k : undefined;
    if (o.stroke) {
      g.lineWidth = 14;
      g.lineJoin = 'round';
      g.strokeStyle = o.stroke;
      if (maxW) g.strokeText(s, 0, 4, maxW);
      else g.strokeText(s, 0, 4);
    }
    g.fillStyle = fill;
    if (maxW) g.fillText(s, 0, 4, maxW);
    else g.fillText(s, 0, 4);
    g.restore();
  }
}

/** Estimate the livery layout from the body's paint meshes (bounds in body space) + optional modeler hints. */
export function liveryLayout(build: BodyBuild): LiveryLayout {
  const body = build.body;
  body.updateWorldMatrix(true, true);
  const inv = body.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  const m = new THREE.Matrix4();
  for (const mesh of build.paintMeshes) {
    const geo = mesh.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    tmp.copy(geo.boundingBox!).applyMatrix4(m.multiplyMatrices(inv, mesh.matrixWorld));
    box.union(tmp);
  }
  if (box.isEmpty()) box.set(new THREE.Vector3(-build.dims.length / 2, 0.2, -build.dims.width / 2), new THREE.Vector3(build.dims.length / 2, build.dims.height, build.dims.width / 2));
  const ud = body.userData as { belt?: number; sill?: number; door?: [number, number]; cowl?: number };
  const a = build.anchors;
  const H = box.max.y - box.min.y;
  const wheelF = a.wheelFL.x;
  const wheelR = a.wheelRL.x;
  const belt = ud.belt ?? box.min.y + H * 0.62;
  return {
    min: box.min.clone(),
    max: box.max.clone(),
    belt,
    sill: ud.sill ?? box.min.y + H * 0.1,
    door: ud.door ?? [wheelR + (wheelF - wheelR) * 0.3, wheelF - (wheelF - wheelR) * 0.18],
    cowl: ud.cowl ?? THREE.MathUtils.clamp(wheelF - 0.85, wheelR + 0.5, wheelF),
    wheelF,
    wheelR,
    wheelRad: build.dims.wheelR,
  };
}

const DECAL = '#f4f2ea';
const INK = '#1c1a24';

function shadeHex(c: string, amt: number): string {
  const x = col(c);
  if (amt >= 0) x.lerp(col('#ffffff'), amt);
  else x.multiplyScalar(1 + amt);
  return '#' + x.getHexString();
}

/** Draw the livery atlas for a car. Transparent where the base paint shows. */
export function liveryTexture(spec: Pick<CarSpec, 'livery' | 'paint' | 'accent' | 'number' | 'paragon'>, layout: LiveryLayout, size = 2048): THREE.CanvasTexture | null {
  const pg = spec.paragon;
  const num = Math.floor(Math.abs(spec.number ?? 0)) % 100;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const P = new LiveryPainter(g, size, layout);
  const L = layout;
  const { min, max } = L;
  const len = max.x - min.x;
  const acc = spec.accent;
  const sideH = L.belt - L.sill;

  // Twin stripes over the top (hood/roof/trunk + front and rear faces): widths in metres, centred on z=0.
  const overTop = (color: string, w: number, gap: number, x0 = min.x, x1 = max.x) => {
    for (const s of [-1, 1]) {
      const z0 = s * (gap / 2);
      const z1 = s * (gap / 2 + w);
      P.rect('T', x0, x1, z0, z1, color);
      if (x1 >= max.x - 0.01) P.rect('F', z0, z1, min.y, max.y, color);
      if (x0 <= min.x + 0.01) P.rect('B', z0, z1, min.y, max.y, color);
    }
  };
  const sideBand = (y0: number, y1: number, color: string, x0 = min.x, x1 = max.x) => P.sides((r) => P.rect(r, x0, x1, y0, y1, color));

  if (pg) {
    switch (pg) {
      case 'malibru':
        sideBand(L.belt - 0.15, L.belt - 0.08, INK, min.x + 0.03 * len, max.x - 0.03 * len);
        sideBand(min.y, L.sill + 0.03, '#4a4658');
        overTop(INK, 0.16, 0.12, L.cowl, max.x);
        overTop(INK, 0.16, 0.12, min.x, L.wheelR + 0.15);
        P.sides((r) => {
          P.rect(r, L.wheelF - 0.62, L.wheelF - 0.36, L.belt - 0.33, L.belt - 0.21, INK);
          P.text(r, 'SS', L.wheelF - 0.49, L.belt - 0.27, 0.085, '#d0182c', { italic: true });
        });
        break;
      case 'civique':
        sideBand(L.sill - 0.02, L.sill + 0.05, acc, L.wheelR + L.wheelRad, L.wheelF - L.wheelRad);
        P.sides((r) => {
          const x = L.door[0] + 0.25;
          P.rect(r, x - 0.07, x + 0.07, L.sill + 0.12, L.sill + 0.28, DECAL);
          P.text(r, 'R', x, L.sill + 0.2, 0.11, acc);
        });
        break;
      case 'stallion':
        overTop(acc, 0.24, 0.07);
        sideBand(L.sill - 0.01, L.sill + 0.05, acc, L.wheelR + L.wheelRad + 0.05, L.wheelF - L.wheelRad - 0.05);
        P.sides((r) => P.text(r, 'GT500', L.door[0] + (L.door[1] - L.door[0]) * 0.35, L.sill + 0.13, 0.08, acc, { italic: true }));
        break;
      case 'avenger': {
        overTop(INK, 0.2, 0.1, L.cowl, max.x);
        overTop(INK, 0.2, 0.1, min.x, L.wheelR + 0.2);
        sideBand(L.belt - 0.14, L.belt - 0.05, INK, min.x, max.x - 0.12 * len);
        // bumblebee tail band: full side height, across the trunk lid tail and the rear face
        const bx0 = min.x + 0.015 * len;
        const bx1 = min.x + 0.075 * len;
        sideBand(L.sill + 0.04, max.y, INK, bx0, bx1);
        P.rect('T', bx0, bx1, min.z, max.z, INK);
        P.rect('B', min.z, max.z, L.sill + 0.12, L.belt - 0.02, INK);
        P.sides((r) => {
          const x = L.wheelF - 0.5;
          const y = L.belt - 0.27;
          P.rect(r, x - 0.1, x + 0.1, y - 0.06, y + 0.06, INK);
          P.rect(r, x - 0.075, x + 0.075, y - 0.04, y + 0.03, '#f7d23e');
          P.rect(r, x - 0.075, x + 0.075, y - 0.01, y + 0.005, INK);
          P.rect(r, x - 0.03, x + 0.03, y + 0.03, y + 0.06, DECAL);
        });
        break;
      }
      case 'kaiju':
        P.sides((r) => {
          P.begin(r);
          g.fillStyle = INK;
          for (let i = 0; i < 3; i++) {
            const x = L.door[0] + 0.15 + i * 0.2;
            const yt = L.belt - 0.04;
            const yb = L.sill + 0.1;
            g.beginPath();
            g.moveTo(x, yt);
            g.quadraticCurveTo(x + 0.05, (yt + yb) / 2, x + 0.34, yb);
            g.quadraticCurveTo(x + 0.05 + 0.08, (yt + yb) / 2, x + 0.1, yt - 0.02);
            g.closePath();
            g.fill();
          }
          P.end();
          P.text(r, '2JZ', L.wheelF - 0.55, L.belt - 0.2, 0.07, INK, { italic: true });
        });
        break;
      case 'viperion':
        overTop(DECAL, 0.2, 0.09);
        P.sides((r) => {
          P.begin(r);
          g.strokeStyle = INK;
          g.lineWidth = 0.035;
          for (let i = 0; i < 3; i++) {
            const x = L.wheelF - L.wheelRad - 0.18 - i * 0.09;
            g.beginPath();
            g.moveTo(x, L.belt - 0.08);
            g.lineTo(x - 0.06, L.belt - 0.3);
            g.stroke();
          }
          P.end();
        });
        break;
      case 'hellkat':
        overTop(acc, 0.12, 0.2);
        sideBand(L.belt - 0.1, L.belt - 0.08, acc);
        P.sides((r) => {
          P.begin(r);
          const x = L.wheelF - 0.55;
          const y = L.belt - 0.26;
          g.fillStyle = acc;
          g.beginPath();
          g.moveTo(x - 0.1, y + 0.07);
          g.quadraticCurveTo(x - 0.09, y, x - 0.04, y - 0.03);
          g.lineTo(x + 0.04, y - 0.03);
          g.quadraticCurveTo(x + 0.09, y, x + 0.1, y + 0.07);
          g.quadraticCurveTo(x + 0.05, y + 0.02, x, y + 0.02);
          g.quadraticCurveTo(x - 0.05, y + 0.02, x - 0.1, y + 0.07);
          g.fill();
          g.fillStyle = '#ffd040';
          g.fillRect(x - 0.035, y - 0.015, 0.02, 0.015);
          g.fillRect(x + 0.015, y - 0.015, 0.02, 0.015);
          P.end();
        });
        break;
      case 'lamberghoul':
        sideBand(min.y, L.sill + 0.06, INK);
        P.rect('F', min.z, max.z, min.y, min.y + 0.12, INK);
        P.rect('B', min.z, max.z, min.y, min.y + 0.18, INK);
        break;
    }
  } else {
    switch (spec.livery) {
      case 'none':
        sideBand(L.belt - 0.105, L.belt - 0.093, acc, min.x + 0.04 * len, max.x - 0.04 * len);
        break;
      case 'stripes':
        sideBand(L.belt - 0.2, L.belt - 0.12, acc);
        sideBand(L.belt - 0.27, L.belt - 0.24, acc);
        break;
      case 'split': {
        const ys = L.sill + sideH * 0.45;
        sideBand(min.y, ys, acc);
        sideBand(ys - 0.004, ys + 0.008, shadeHex(acc, 0.35));
        P.rect('F', min.z, max.z, min.y, ys, acc);
        P.rect('B', min.z, max.z, min.y, ys, acc);
        break;
      }
      case 'checker': {
        const sq = 0.085;
        const y0 = L.belt - 0.1 - 2 * sq;
        P.sides((r) => {
          P.begin(r);
          for (let x = min.x, i = 0; x < max.x; x += sq, i++)
            for (let j = 0; j < 2; j++) {
              g.fillStyle = (i + j) % 2 ? DECAL : '#24222c';
              g.fillRect(x, y0 + j * sq, sq + 0.001, sq + 0.001);
            }
          P.end();
        });
        break;
      }
      case 'flames':
        drawFlames(P, acc);
        break;
    }
    if (num > 0)
      P.sides((r) => {
        const x = (L.door[0] + L.door[1]) / 2;
        const y = L.sill + sideH * 0.55;
        const rad = Math.min(0.19, sideH * 0.36);
        P.begin(r);
        g.fillStyle = shadeHex(spec.paint, -0.55);
        g.beginPath();
        g.ellipse(x, y, rad * 1.12, rad * 1.12, 0, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = DECAL;
        g.beginPath();
        g.ellipse(x, y, rad, rad, 0, 0, Math.PI * 2);
        g.fill();
        P.end();
        P.text(r, String(num), x, y, rad * 0.95, INK, { maxW: rad * 1.7 });
      });
  }

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.userData.atlas = size;
  return t;
}

/** Hot-rod flames: tongues licking back from the nose along both sides and over the hood, with a hot core. */
function drawFlames(P: LiveryPainter, acc: string) {
  const L = P.L;
  const g = P.g;
  const len = L.max.x - L.min.x;
  const tongues = [0.17, 0.29, 0.21, 0.36, 0.25, 0.32, 0.15];
  const yTop = L.belt - 0.03;
  const yBot = L.sill + (L.belt - L.sill) * 0.25;
  const n = tongues.length;
  const hot = shadeHex(acc, 0.55);
  const edge = shadeHex(acc, -0.35);
  const tongue = (cx: number, base: number, reach: number, half: number, wob: number) => {
    // A tapered S-curve tongue from the nose (cx) back to cx - reach, centred on `base` across.
    const tip = cx - reach;
    g.beginPath();
    g.moveTo(cx + 0.2, base + half);
    g.bezierCurveTo(cx - reach * 0.35, base + half * 1.3 + wob, cx - reach * 0.7, base - half * 0.2 - wob, tip, base + wob * 0.6);
    g.bezierCurveTo(cx - reach * 0.7, base - half * 0.9 - wob, cx - reach * 0.35, base - half * 1.2 + wob * 0.5, cx + 0.2, base - half);
    g.closePath();
  };
  const paint = (r: Region, across0: number, across1: number, along: (i: number) => number) => {
    P.begin(r);
    const nose = L.max.x;
    const grd = g.createLinearGradient(nose, 0, nose - len * 0.4, 0);
    grd.addColorStop(0, hot);
    grd.addColorStop(0.35, acc);
    grd.addColorStop(1, acc);
    for (let i = 0; i < n; i++) {
      const b = across0 + ((i + 0.5) / n) * (across1 - across0);
      const half = ((across1 - across0) / n) * 0.85;
      tongue(nose, b, tongues[i] * len * along(i), half, (i % 2 ? 1 : -1) * half * 0.35);
      g.fillStyle = grd;
      g.fill();
      g.lineWidth = 0.012;
      g.strokeStyle = edge;
      g.stroke();
    }
    P.end();
  };
  paint('L', yBot, yTop, () => 1);
  paint('R', yBot, yTop, () => 1);
  // hood: from the nose back toward the cowl, spread across the hood
  const hz = (L.max.z - L.min.z) * 0.36;
  paint('T', -hz, hz, (i) => Math.min(1, (L.max.x - L.cowl) / (len * 0.36)) * (0.7 + 0.3 * Math.sin(i * 1.7)));
  P.rect('F', L.min.z, L.max.z, yBot - 0.05, L.max.y, hot);
}

const LIVERY_PARS = /* glsl */ `
uniform sampler2D uLiv;
uniform vec3 uLivMin;
uniform vec3 uLivSize;
uniform vec4 uLivL, uLivR, uLivT, uLivF, uLivB;
varying vec3 vLivP;
varying vec3 vLivN;
vec4 lkLiv(vec4 rc, vec2 st, vec2 dx, vec2 dy) {
  return textureGrad(uLiv, rc.xy + clamp(st, 0.0, 1.0) * rc.zw, dx * rc.zw, dy * rc.zw);
}
vec4 lkLivery() {
  vec3 q = (vLivP - uLivMin) / uLivSize;
  vec3 dqx = dFdx(q), dqy = dFdy(q);
  vec3 n = normalize(vLivN);
  vec3 w = pow(abs(n), vec3(5.0));
  w /= (w.x + w.y + w.z + 1e-5);
  vec4 c = vec4(0.0);
  if (w.z > 0.01) c += w.z * (n.z > 0.0
    ? lkLiv(uLivL, q.xy, dqx.xy, dqy.xy)
    : lkLiv(uLivR, vec2(1.0 - q.x, q.y), vec2(-dqx.x, dqx.y), vec2(-dqy.x, dqy.y)));
  if (w.y > 0.01) c += w.y * lkLiv(uLivT, q.xz, dqx.xz, dqy.xz);
  if (w.x > 0.01) c += w.x * (n.x > 0.0
    ? lkLiv(uLivF, vec2(1.0 - q.z, q.y), vec2(-dqx.z, dqx.y), vec2(-dqy.z, dqy.y))
    : lkLiv(uLivB, q.zy, dqx.zy, dqy.zy));
  return c;
}`;

export interface LiveryHandle {
  material: M;
  texture: THREE.Texture | null;
  layout: LiveryLayout;
  dispose(): void;
}

/**
 * Re-skin a body: a per-car paint material (finish from the colour, or opts.finish) with the livery projected in
 * body space, assigned to every build.paintMeshes entry. Call once after the body is built (before animating).
 */
export function applyLivery(build: BodyBuild, spec: CarSpec, opts: PaintOpts & { atlas?: number } = {}): LiveryHandle {
  const layout = liveryLayout(build);
  const finish = opts.finish ?? autoFinish(spec.paint);
  const tex = liveryTexture(spec, layout, opts.atlas ?? 2048);
  const m = makePaint(spec.paint, { ...opts, finish }, ':livery');
  m.userData.shared = false;
  const S = (tex?.userData.atlas as number) ?? 2048;
  const bodyInv = new THREE.Matrix4();
  const u = {
    uLiv: { value: tex },
    uLivMin: { value: layout.min.clone() },
    uLivSize: { value: layout.max.clone().sub(layout.min).max(new THREE.Vector3(1e-3, 1e-3, 1e-3)) },
    uLivL: { value: regionUv('L', S) },
    uLivR: { value: regionUv('R', S) },
    uLivT: { value: regionUv('T', S) },
    uLivF: { value: regionUv('F', S) },
    uLivB: { value: regionUv('B', S) },
    uBodyInv: { value: bodyInv },
  };
  addShaderHook(m, 'livery', (s) => {
    Object.assign(s.uniforms, u);
    s.vertexShader = 'uniform mat4 uBodyInv;\nvarying vec3 vLivP;\nvarying vec3 vLivN;\n' + s.vertexShader;
    s.vertexShader = inject(
      s.vertexShader,
      '#include <begin_vertex>',
      'mat4 lkTB = uBodyInv * modelMatrix; vLivP = (lkTB * vec4(position, 1.0)).xyz; vLivN = mat3(lkTB) * normal;',
    );
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n' + LIVERY_PARS + '\nvec4 lkLv = vec4(0.0);');
    s.fragmentShader = inject(s.fragmentShader, '#include <color_fragment>', 'lkLv = lkLivery(); diffuseColor.rgb = mix(diffuseColor.rgb, lkLv.rgb, lkLv.a);');
    // Decals are solid paint/vinyl under the clearcoat: no metal, no flake.
    s.fragmentShader = inject(
      s.fragmentShader,
      '#include <metalnessmap_fragment>',
      'metalnessFactor = mix(metalnessFactor, 0.0, lkLv.a); roughnessFactor = mix(roughnessFactor, 0.32, lkLv.a); lkFlakeMask = 1.0 - lkLv.a;',
    );
  });
  const onBefore = () => {
    bodyInv.copy(build.body.matrixWorld).invert();
  };
  const prev = new Map<THREE.Mesh, THREE.Mesh['onBeforeRender']>();
  for (const mesh of build.paintMeshes) {
    prev.set(mesh, mesh.onBeforeRender);
    mesh.material = m;
    const old = mesh.onBeforeRender;
    mesh.onBeforeRender = function (this: THREE.Mesh, ...a: Parameters<THREE.Mesh['onBeforeRender']>) {
      onBefore();
      old.apply(this, a);
    };
  }
  return {
    material: m,
    texture: tex,
    layout,
    dispose() {
      prev.forEach((f, mesh) => (mesh.onBeforeRender = f));
      tex?.dispose();
      m.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Disposal

/** Dispose a subtree's geometries + non-shared materials/textures (shared library materials are left alone). */
export function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) disposeMaterial(m);
  });
}

export function disposeMaterial(m: THREE.Material) {
  if (m.userData.shared) return;
  for (const v of Object.values(m)) {
    const t = v as THREE.Texture | null;
    if (t && t.isTexture && !t.userData?.shared) t.dispose();
  }
  m.dispose();
}

/** Free the whole library cache (on leaving 3D mode). */
export function disposeLibrary() {
  cache.forEach((m) => m.dispose());
  texCache.forEach((t) => t.dispose());
  cache.clear();
  texCache.clear();
}
