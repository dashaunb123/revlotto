// Night drag strip for the 3D race: buildDragStrip({ quality, renderer }) assembles the track, tree, scoreboards,
// grandstands + crowd, light towers, sky and shutdown, and bakes a PMREM env map of the stadium.
// Units are metres; cars drive +X from the start line at x = 0 (see layout.ts for every coordinate).
import * as THREE from 'three';
import type { Quality } from '../../../game/settings';
import { makeCtx } from './ctx';
import { bakeEnvMap } from './envmap';
import * as L from './layout';
import { buildLightTowers, towerLayout, towerLights } from './lights';
import { buildPits } from './pits';
import { buildScoreboards } from './scoreboard';
import { buildShutdown } from './shutdown';
import { buildSky, HORIZON } from './sky';
import { stadiumRig } from './stadiumLights';
import { buildStands } from './stands';
import { noiseTexture } from './textures';
import { buildTrack } from './track';
import { buildTree, type TreeState } from './tree';

export type { TreeState } from './tree';
export * as stripLayout from './layout';

/**
 * Dev: call once per frame after rendering; logs every shader program that appears after the first call (late
 * compiles = hitches), with the frame, time, material name and cache-key head. Returns the live program count.
 */
export function shaderLog(renderer: THREE.WebGLRenderer, tag = 'shaders'): () => number {
  type P = { id: number; name: string; cacheKey: string };
  const list = () => (renderer.info.programs ?? []) as unknown as P[];
  let known = new Set<P>(list());
  let frame = 0;
  const t0 = performance.now();
  console.info(`[${tag}] start: ${known.size} programs`);
  return () => {
    frame++;
    const ps = list();
    const fresh = ps.filter((p) => !known.has(p));
    if (fresh.length) {
      console.warn(`[${tag}] frame ${frame} @${((performance.now() - t0) / 1000).toFixed(2)}s: +${fresh.length} program(s) (total ${ps.length}): ` +
        fresh.map((p) => `"${p.name || '(unnamed)'}" #${p.id} ${p.cacheKey.slice(0, 90).replace(/\s+/g, ' ')}`).join(' | '));
    }
    if (fresh.length || ps.length !== known.size) known = new Set(ps);
    return ps.length;
  };
}

export interface DragStrip {
  group: THREE.Group;
  /** PMREM env map of the stadium (null when no renderer was passed). Use it for scene.environment / car paint. */
  envMap: THREE.Texture | null;
  /** Assign to scene.fog (matches the sky's horizon). */
  fog: THREE.FogExp2;
  background: THREE.Color;
  laneZ: { player: number; ghost: number };
  startX: number;
  finishX: number;
  quality: Quality;
  setTree(s: TreeState): void;
  /** left = player lane (+Z), right = ghost lane (-Z). null blanks a value; winner lights that board's win lamp. */
  setScoreboard(leftEt: number | null, leftMph: number | null, rightEt: number | null, rightMph: number | null, winner?: 'player' | 'ghost' | null): void;
  /**
   * Crowd cheers for ms milliseconds. k 0..1 = how big: share of the crowd on its feet with arms up, jump height and
   * camera-flash rate (1 = everyone, e.g. a player win or a photo finish; ~0.35 = polite applause for a loss).
   */
  cheer(ms: number, k?: number): void;
  /** Stadium light level 0..~1.2 at a point on the strip (e.g. drive raceLighting().setLevel or a car key light). */
  lightAt(x: number, z: number, y?: number): number;
  /** Opt-in: makes a lit material (Standard / Physical / Lambert) receive the light-tower pools. */
  patchStadiumLights(mat: THREE.Material): void;
  /** How much of the scene's directional lights (the car key) reaches the strip's own materials (default 0.35). */
  setEnvKeyScale(k: number): void;
  /**
   * Optional: compile every program the strip will ever show (KHR_parallel_shader_compile), then render one frame
   * into `target` (default: the current one) so the shadow-map depth programs that compile() skips exist too.
   * Pass the composer's HDR target if you render through post. Nothing in the strip creates or swaps materials after
   * load (LODs swap instance counts, lamps change uniforms / opacity), so nothing compiles late.
   */
  warmup(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene, target?: THREE.WebGLRenderTarget | null): Promise<void>;
  /** Bake (or re-bake) the env map with a renderer if it wasn't passed at build time. */
  bakeEnv(renderer: THREE.WebGLRenderer): THREE.Texture;
  update(dt: number, t: number): void;
  dispose(): void;
  /** Stats for perf reports. */
  stats: { crowd: number; stadiumLights: number; towers: number; timing: Record<string, number> };
}

export function buildDragStrip(opts: { quality: Quality; renderer?: THREE.WebGLRenderer }): DragStrip {
  const cfg = L.qualityCfg(opts.quality);
  const group = new THREE.Group();
  group.name = 'dragStrip';
  const towers = towerLayout();
  const rig = stadiumRig('strip', () => towerLights(towers), cfg.lights);
  const noise = noiseTexture(256);
  const ctx = makeCtx(cfg, rig, group, noise);
  ctx.own(noise);

  const timing: Record<string, number> = {};
  let tm = performance.now();
  const lap = (k: string) => { const n = performance.now(); timing[k] = Math.round(n - tm); tm = n; };
  lap('rig');
  const track = buildTrack(ctx);
  lap('track');
  const tree = buildTree(ctx);
  const boards = buildScoreboards(ctx);
  lap('tree+boards');
  const stands = buildStands(ctx);
  lap('stands');
  const lights = buildLightTowers(ctx, towers);
  lap('towers');
  const sky = buildSky(ctx);
  lap('sky');
  // everything is built here (nothing is created after load, so warmup / compileAsync covers every program)
  buildShutdown(ctx, track.aspMat);
  buildPits(ctx, track.asp);
  lap('shutdown+pits');

  const fog = new THREE.FogExp2(HORIZON.clone(), 0.0021);
  // feed camera + fog to the custom shaders each frame (the dome is always rendered first)
  const prevBR = sky.dome.onBeforeRender;
  let time = 0;
  sky.dome.onBeforeRender = function (r, s, camera, g, m, gr) {
    prevBR.call(this, r, s, camera, g, m, gr);
    camera.getWorldPosition(ctx.camPos);
    lights.preRender(camera, (s.fog as THREE.FogExp2) ?? fog, time);
    sky.setPixelRatio(r.getPixelRatio());
  };

  let envMap: THREE.Texture | null = null;
  const applyEnv = (tex: THREE.Texture) => {
    envMap = tex;
    for (const m of ctx.envMats) {
      m.envMap = tex;
      m.envMapIntensity = m.userData.envK ?? 1;
      m.needsUpdate = true;
    }
  };
  const bakeEnv = (renderer: THREE.WebGLRenderer) => {
    const tex = bakeEnvMap(ctx, renderer, towers, sky.skyTex);
    applyEnv(tex);
    return tex;
  };
  if (opts.renderer) bakeEnv(opts.renderer);
  lap('envmap');

  group.updateMatrixWorld(true);
  return {
    group,
    get envMap() { return envMap; },
    fog,
    background: HORIZON.clone(),
    laneZ: { player: L.LANE_Z, ghost: -L.LANE_Z },
    startX: L.START_X,
    finishX: L.FINISH_X,
    quality: opts.quality,
    setTree: tree.set,
    setScoreboard: boards.set,
    cheer: stands.cheer,
    lightAt: rig.lightAt,
    patchStadiumLights: (m) => rig.patch(m, undefined, 'obj', false),
    bakeEnv,
    setEnvKeyScale: rig.setDirScale,
    async warmup(renderer, camera, scene, target) {
      const prev = renderer.getRenderTarget();
      const tgt = target === undefined ? prev : target;
      renderer.setRenderTarget(tgt);
      const ready = renderer.compileAsync(scene, camera);
      renderer.setRenderTarget(prev);
      await ready;
      renderer.setRenderTarget(tgt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(prev);
    },
    update(dt, t) {
      time = t;
      for (const u of ctx.updaters) u(dt, t);
    },
    dispose() {
      group.removeFromParent();
      ctx.disposeAll();
    },
    stats: { crowd: stands.count, stadiumLights: rig.count, towers: towers.length, timing },
  };
}
