// Boss hazards in the 3D race. Oil: glossy, iridescent puddles on the player's lane exactly where the sim judges
// them (at the rear wheels), with a hazard board on the outer wall. Gale Force: a rolling front of wind sheets,
// grit and litter that sweeps in from down-track and buffets the strip while a gust is on. The Decoy Tree's fake
// flash is driven through the strip's tree (world.ts); Tach-mode bosses (blind / mirror / blackout / drift) stay
// HUD-only (render/race/bossHud.ts).
import * as THREE from 'three';
import type { Quality } from '../../../game/settings';
import { GUST_WARN, gustAt, untilSpan } from '../../../sim/bossMods';
import { REAR_M, type RaceSim } from '../../../sim/RaceSim';

export interface HazardOpts {
  quality: Quality;
  /** Lane centre z of the player and the lane width (m). */
  laneZ: number;
  laneW: number;
  /** Inner face z of the player's outer wall (hazard boards hang there); sign follows laneZ. */
  wallZ: number;
  /** Player wheelbase: s.x maps to the front wheels, so the rear wheels sit at s.x - wheelbase. */
  wheelbase: number;
}

function rnd(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 4294967296;
}

/** A soft, ragged puddle mask (white = oil) with satellite drips; R = mask, G = thin-film thickness noise. */
function puddleTexture(seed: number, w = 512, h = 256): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const r = rnd(seed);
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  g.filter = 'blur(3px)';
  const blob = (cx: number, cy: number, rx: number, ry: number, k: number) => {
    g.beginPath();
    const n = 28;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const j = 1 + (r() - 0.5) * k;
      const x = cx + Math.cos(a) * rx * j;
      const y = cy + Math.sin(a) * ry * j;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.closePath();
    g.fill();
  };
  // main pool: a few overlapping lobes, then drips and a smeared tyre track through it
  g.fillStyle = 'rgb(255,0,0)';
  for (let i = 0; i < 6; i++) blob(w * (0.2 + r() * 0.6), h * (0.35 + r() * 0.3), w * (0.14 + r() * 0.12), h * (0.18 + r() * 0.14), 0.35);
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2;
    const d = 0.32 + r() * 0.2;
    blob(w * (0.5 + Math.cos(a) * d), h * (0.5 + Math.sin(a) * d * 0.9), 3 + r() * 10, 2 + r() * 7, 0.5);
  }
  g.filter = 'none';
  // thin-film thickness in G: soft swirls so the rainbow sheen bands instead of being flat
  const img = g.getImageData(0, 0, w, h);
  const ph = [r() * 6, r() * 6, r() * 6];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const u = x / w,
        v = y / h;
      const s = Math.sin(u * 13 + ph[0] + Math.sin(v * 7 + ph[1]) * 2) * 0.5 + Math.sin(v * 19 + u * 5 + ph[2]) * 0.3;
      img.data[i + 1] = Math.round(128 + s * 100);
      img.data[i + 2] = 0;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Yellow/black hazard board with OIL lettering (wall sign at each patch). */
function boardTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#111';
  g.fillRect(0, 0, 512, 128);
  for (let x = -128; x < 640; x += 48) {
    g.fillStyle = '#f7d23e';
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + 24, 0);
    g.lineTo(x + 24 - 40, 128);
    g.lineTo(x - 40, 128);
    g.fill();
  }
  g.fillStyle = '#111';
  g.fillRect(150, 20, 212, 88);
  g.strokeStyle = '#f7d23e';
  g.lineWidth = 6;
  g.strokeRect(150, 20, 212, 88);
  g.fillStyle = '#f7d23e';
  g.font = 'bold 72px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('OIL', 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Soft horizontal wind streaks (alpha) for the gust sheets; tiles in u. */
function streakTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  const r = rnd(99);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 512, 256);
  g.filter = 'blur(2px)';
  for (let i = 0; i < 140; i++) {
    const y = r() * 256;
    const x = r() * 512;
    const len = 40 + r() * 220;
    const a = 0.15 + r() * 0.5;
    const grad = g.createLinearGradient(x, 0, x + len, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.3, `rgba(255,255,255,${a})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(x, y, len, 1 + r() * 2.5);
    if (x + len > 512) g.fillRect(x - 512, y, len, 1 + r() * 2.5);
  }
  g.filter = 'none';
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const SHEET_VS = /* glsl */ `
varying vec2 vUv; varying float vFog;
void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vFog = -mv.z; gl_Position = projectionMatrix * mv; }`;
const SHEET_FS = /* glsl */ `
uniform sampler2D uMap; uniform float uT; uniform float uAmt; uniform vec3 uCol; uniform float uScroll;
varying vec2 vUv; varying float vFog;
void main() {
  // two layers of streaks scrolling at different speeds, faded at the sheet's edges and with distance
  float a = texture2D(uMap, vec2(vUv.x * 2.0 + uT * uScroll, vUv.y)).r;
  float b = texture2D(uMap, vec2(vUv.x * 3.1 + uT * uScroll * 1.6 + 0.37, vUv.y * 0.8 + 0.1)).r;
  float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x) * smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
  float fog = 1.0 - smoothstep(60.0, 160.0, vFog);
  float k = (a * 0.7 + b * 0.5) * edge * uAmt * fog;
  gl_FragColor = vec4(uCol * k, k);
}`;

interface OilPatch {
  mesh: THREE.Mesh;
  board: THREE.Mesh;
  x0: number;
  x1: number;
}

export class Hazards3D {
  readonly group = new THREE.Group();
  private sim: RaceSim;
  private o: HazardOpts;
  private oil: OilPatch[] = [];
  private textures: THREE.Texture[] = [];
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private gust?: {
    sheets: THREE.Mesh[];
    mats: THREE.ShaderMaterial[];
    debris: THREE.InstancedMesh;
    dv: Float32Array; // per debris: x, y, z, vx, vy, vz, spin, phase
    haze: THREE.Mesh;
  };
  private t = 0;
  private dummy = new THREE.Object3D();
  private debrisIdle = true;
  /** Gust strength on the car now (0..1) and seconds until the next front (Infinity if none). */
  gustNow = 0;
  gustUntil = Infinity;

  constructor(scene: THREE.Scene, sim: RaceSim, o: HazardOpts) {
    this.sim = sim;
    this.o = o;
    scene.add(this.group);
    const hz = sim.hz;
    if (hz.oil.length) this.buildOil();
    if (hz.gusts.length) this.buildGust();
  }

  /** Where (world x) the sim's rear-wheel distance d lands, given s.x maps to the front wheels. */
  private oilX(d: number) {
    return d + REAR_M - this.o.wheelbase;
  }

  private buildOil() {
    const board = boardTexture();
    this.textures.push(board);
    const boardMat = new THREE.MeshStandardMaterial({ map: board, roughness: 0.6, metalness: 0.1, emissive: 0xffffff, emissiveMap: board, emissiveIntensity: 0.18 });
    const boardGeo = new THREE.PlaneGeometry(2.2, 0.55);
    this.mats.push(boardMat);
    this.geos.push(boardGeo);
    const side = Math.sign(this.o.laneZ) || 1;
    this.sim.hz.oil.forEach((span, i) => {
      const x0 = this.oilX(span.a);
      const x1 = this.oilX(span.b);
      // the puddle overhangs the judged span a little so the tyres visibly roll into it
      const len = x1 - x0 + 1.2;
      const wid = this.o.laneW * 0.62;
      const tex = puddleTexture(i * 7919 + 17);
      this.textures.push(tex);
      const geo = new THREE.PlaneGeometry(len, wid, 1, 1);
      geo.rotateX(-Math.PI / 2);
      this.geos.push(geo);
      // Motor oil: a near-black, low-albedo film. Glossy, but the reflections are dimmed and capped so the stadium
      // lights glint dark instead of turning the pool mirror-white, and a thin-film rainbow shows only at grazing
      // angles (thickness swirls from the texture's G channel). Splatter and drops share the same mask.
      const mat = new THREE.MeshPhysicalMaterial({
        color: 0x030303,
        roughness: 0.16,
        metalness: 0,
        specularIntensity: 0.55,
        envMapIntensity: 0.4,
        alphaMap: tex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
      mat.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader
          // the mask lives in R (three's alphaMap reads G, which here holds the film thickness)
          .replace('#include <alphamap_fragment>', 'vec2 oilT = texture2D( alphaMap, vAlphaMapUv ).rg;\ndiffuseColor.a *= smoothstep( 0.08, 0.55, oilT.r );')
          .replace(
            '#include <opaque_fragment>',
            `{
  float lum = dot( outgoingLight, vec3( 0.2126, 0.7152, 0.0722 ) );
  outgoingLight *= 0.55 * min( 1.0, 0.32 / max( lum * 0.55, 1e-4 ) );
  float ndv = saturate( dot( normalize( normal ), normalize( vViewPosition ) ) );
  float graze = pow( 1.0 - ndv, 4.0 );
  vec3 film = 0.5 + 0.5 * cos( 6.2832 * ( oilT.g * 2.2 + ndv * 0.8 + vec3( 0.0, 0.33, 0.67 ) ) );
  outgoingLight += film * graze * 0.09;
}
#include <opaque_fragment>`,
          );
      };
      mat.customProgramCacheKey = () => 'core-oil-v2';
      this.mats.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set((x0 + x1) / 2, 0.006, this.o.laneZ + (i % 2 ? 0.25 : -0.2));
      mesh.rotation.y = (i % 2 ? 1 : -1) * 0.04;
      mesh.renderOrder = 2;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      const b = new THREE.Mesh(boardGeo, boardMat);
      // hung on the catch fence above the wall's sponsor boards, facing the lane
      b.position.set((x0 + x1) / 2, 1.38, this.o.wallZ * side - side * 0.06);
      b.rotation.y = side > 0 ? Math.PI : 0;
      this.group.add(b);
      this.oil.push({ mesh, board: b, x0, x1 });
    });
  }

  private buildGust() {
    const tex = streakTexture();
    this.textures.push(tex);
    const sheets: THREE.Mesh[] = [];
    const mats: THREE.ShaderMaterial[] = [];
    // a stack of tall sheets across the whole strip, facing down-track; staggered so the front reads as a volume
    const n = this.o.quality === 'low' ? 3 : 6;
    const geo = new THREE.PlaneGeometry(30, 7);
    geo.rotateY(Math.PI / 2);
    geo.translate(0, 3.5, 0);
    this.geos.push(geo);
    for (let i = 0; i < n; i++) {
      const m = new THREE.ShaderMaterial({
        vertexShader: SHEET_VS,
        fragmentShader: SHEET_FS,
        uniforms: { uMap: { value: tex }, uT: { value: Math.random() * 10 }, uAmt: { value: 0 }, uCol: { value: new THREE.Color(0xb8a890) }, uScroll: { value: 0.35 + i * 0.07 } }, // dusty wind
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      mats.push(m);
      this.mats.push(m);
      // Always drawn (uAmt 0 = no contribution) so the program is built at warm-up, never on the first gust.
      const s = new THREE.Mesh(geo, m);
      s.rotation.y = (i - n / 2) * 0.12; // fanned: the sheets cross the strip at slightly different angles
      s.frustumCulled = false;
      sheets.push(s);
      this.group.add(s);
    }
    // debris: grit, leaves and paper scraps (instanced quads, double sided, lit)
    const count = this.o.quality === 'low' ? 120 : this.o.quality === 'medium' ? 260 : 420;
    const dgeo = new THREE.PlaneGeometry(0.035, 0.025); // grit and litter, not cardboard tiles
    this.geos.push(dgeo);
    const dmat = new THREE.MeshStandardMaterial({ color: 0xb8a684, roughness: 0.9, side: THREE.DoubleSide });
    this.mats.push(dmat);
    const debris = new THREE.InstancedMesh(dgeo, dmat, count);
    debris.frustumCulled = false;
    const col = new THREE.Color();
    const palette = [0xb8a684, 0x8a7a5a, 0xd8d0c0, 0x6a5a3a, 0xe8e2d4, 0x9a8a62];
    for (let i = 0; i < count; i++) debris.setColorAt(i, col.set(palette[i % palette.length]).multiplyScalar((0.7 + Math.random() * 0.4) * 0.6));
    // always drawn; idle instances are scaled to zero
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < count; i++) debris.setMatrixAt(i, zero);
    this.group.add(debris);
    const dv = new Float32Array(count * 8);
    // ground-hugging dust haze that rides the front
    const hgeo = new THREE.PlaneGeometry(14, 30);
    hgeo.rotateX(-Math.PI / 2);
    this.geos.push(hgeo);
    const hmat = new THREE.ShaderMaterial({
      vertexShader: SHEET_VS,
      fragmentShader: SHEET_FS,
      uniforms: { uMap: { value: tex }, uT: { value: 0 }, uAmt: { value: 0 }, uCol: { value: new THREE.Color(0xc8b89a) }, uScroll: { value: 0.6 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mats.push(hmat);
    mats.push(hmat);
    const haze = new THREE.Mesh(hgeo, hmat);
    haze.position.y = 0.05;
    haze.frustumCulled = false;
    this.group.add(haze);
    this.gust = { sheets, mats, debris, dv, haze };
    for (let i = 0; i < count; i++) this.respawn(i, 0, 0, true);
  }

  private respawn(i: number, px: number, frontX: number, anywhere: boolean) {
    const d = this.gust!.dv;
    const k = i * 8;
    const ahead = anywhere ? Math.random() * 80 - 20 : 20 + Math.random() * 50;
    d[k] = Math.max(px - 10, frontX) + ahead;
    d[k + 1] = 0.05 + Math.random() * Math.random() * 3.5;
    d[k + 2] = (Math.random() - 0.5) * 16;
    d[k + 3] = -(14 + Math.random() * 16); // headwind: blows against the cars
    d[k + 4] = (Math.random() - 0.4) * 1.5;
    d[k + 5] = (Math.random() - 0.5) * 6; // crosswind swirl
    d[k + 6] = 4 + Math.random() * 14;
    d[k + 7] = Math.random() * 10;
  }

  /** Per frame. playerX = the player's front-wheel world x (the sim's state.x mapping). */
  update(dt: number, playerX: number, camera: THREE.Camera) {
    this.t += dt;
    const s = this.sim.state;
    const hz = this.sim.hz;
    // oil: a slow glint as the camera moves (the sheen does the rest); fade the boards in as you near them
    for (const p of this.oil) {
      const near = THREE.MathUtils.clamp(1 - (p.x0 - playerX) / 120, 0.25, 1);
      (p.board.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.12 + 0.18 * near;
    }
    const g = this.gust;
    if (!g) return;
    const running = s.phase === 'running';
    const str = running ? gustAt(hz, s.t) : 0;
    const until = running ? untilSpan(hz.gusts, s.t) : Infinity;
    this.gustNow = str;
    this.gustUntil = until;
    // the front: GUST_WARN s before it hits it's ~70 m down-track, then rolls onto the car
    const incoming = until > 0 && until < GUST_WARN + 1.5;
    const frontX = incoming ? playerX + (until / (GUST_WARN + 1.5)) * 90 : str > 0.02 ? playerX - 30 : playerX + 200;
    const amt = str > 0.02 ? 0.35 + str * 0.65 : incoming ? 0.9 * (1 - until / (GUST_WARN + 1.5)) + 0.1 : 0;
    g.sheets.forEach((sh, i) => {
      // during the gust the sheets ride along with the car, slipping backwards past it
      const base = str > 0.02 ? playerX + 18 - (((this.t * 22 + i * 11) % 60)) : frontX + i * 2.2;
      sh.position.set(base, 0, (i % 2 ? 1 : -1) * 1.5);
    });
    for (const m of g.mats) {
      m.uniforms.uT.value = this.t;
      m.uniforms.uAmt.value = amt * (m === g.mats[g.mats.length - 1] ? 0.6 : 0.5); // sheets and ground haze readable mid-run
    }
    g.haze.position.x = str > 0.02 ? playerX + 4 : frontX + 6;
    // debris streams in with the front and swirls around the car during the gust (zero-scaled while idle)
    if (amt <= 0.01) {
      if (!this.debrisIdle) {
        this.debrisIdle = true;
        this.dummy.scale.set(0, 0, 0);
        this.dummy.updateMatrix();
        for (let i = 0; i < g.debris.count; i++) g.debris.setMatrixAt(i, this.dummy.matrix);
        g.debris.instanceMatrix.needsUpdate = true;
      }
      return;
    }
    this.debrisIdle = false;
    const d = g.dv;
    const n = g.debris.count;
    const live = Math.round(n * Math.min(1, amt));
    const camPos = (camera as THREE.PerspectiveCamera).position;
    for (let i = 0; i < n; i++) {
      const k = i * 8;
      d[k] += d[k + 3] * dt;
      d[k + 1] = Math.max(0.03, d[k + 1] + d[k + 4] * dt + Math.sin(this.t * 3 + d[k + 7]) * 0.6 * dt);
      d[k + 2] += d[k + 5] * dt;
      if (d[k] < playerX - 40 || d[k] < camPos.x - 8 || Math.abs(d[k + 2]) > 9) this.respawn(i, playerX, str > 0.02 ? playerX : frontX, false);
      // only debris behind the front exists
      const vis = i < live && (str > 0.02 || d[k] > frontX);
      this.dummy.position.set(d[k], d[k + 1], d[k + 2]);
      this.dummy.rotation.set(this.t * d[k + 6] + d[k + 7], this.t * d[k + 6] * 0.7, d[k + 7]);
      const sc = vis ? 0.6 + (i % 7) * 0.25 : 0;
      this.dummy.scale.set(sc * (i % 9 === 0 ? 1.6 : 1), sc * (i % 9 === 0 ? 1.6 : 1), sc); // the odd bigger scrap
      this.dummy.updateMatrix();
      g.debris.setMatrixAt(i, this.dummy.matrix);
    }
    g.debris.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.group.removeFromParent();
    this.geos.forEach((x) => x.dispose());
    this.mats.forEach((x) => x.dispose());
    this.textures.forEach((x) => x.dispose());
    this.gust?.debris.dispose();
    this.oil = [];
  }
}
