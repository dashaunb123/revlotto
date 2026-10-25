// The shared three.js layer of the 3D mode: ONE WebGLRenderer on a <canvas data-three> laid exactly over the
// Phaser canvas's on-screen rect (Scale.FIT + CENTER_BOTH) but BEHIND it, so the Phaser HUD/UI draws on top.
// The race and the car showcases share it (claim/release): browsers cap live WebGL contexts, and a context per
// race would leak across Mulligan reruns. Lazy: only ever imported through a dynamic import in 3D mode.
//
// Layering: the canvas is appended AFTER the Phaser canvas (the cutscene stage looks up "the game canvas" as the
// first canvas:not([data-cutscene])), and the Phaser canvas gets position:relative + z-index:1 so it stays on top.
// Transparency: main.ts boots Phaser with transparent:true (a context with alpha) but restores the opaque PAL.bg
// clear, so 2D renders pixel-identically (every pixel keeps alpha 1). setPhaserClear(game, true) switches the
// clear to rgba(0,0,0,0) while the 3D race runs.
import * as THREE from 'three';
import type Phaser from 'phaser';
import { settings, type Quality } from '../../game/settings';
import { GAME_W, PAL } from '../palette';

export interface ThreeLayer {
  renderer: THREE.WebGLRenderer;
  canvas: HTMLCanvasElement;
  /** The Phaser canvas's on-screen rect (CSS px). */
  gameRect(): DOMRect;
  /** CSS px per game px (640x360 game grid). */
  cssPerGamePx(): number;
  /** Device px per CSS px for the current quality. */
  pixelRatio(): number;
  /** Drawing-buffer size (device px). */
  size(): { w: number; h: number };
  quality(): Quality;
  /** Called after every layout change (resize, quality) with the drawing-buffer size. Returns an unsubscribe. */
  onResize(cb: (w: number, h: number) => void): () => void;
  /** Called if the WebGL context is lost. Returns an unsubscribe. */
  onLost(cb: () => void): () => void;
  /** Show the canvas for an owner (race, showcase id). Hidden again once every owner released it. */
  claim(owner: string): void;
  release(owner: string): void;
  /** Re-measure now (e.g. right after Phaser rescaled). */
  layout(): void;
}

/** Device px per CSS px by quality (the drawing buffer is also capped at MAX_W device px wide). */
const PIXEL_RATIO: Record<Quality, (dpr: number) => number> = {
  low: (d) => Math.min(d, 1) * 0.7,
  medium: (d) => Math.min(d, 1),
  high: (d) => Math.min(d, 1.5),
};
const MAX_W = 2560;

let pending: Promise<ThreeLayer | null> | null = null;
let failed = false;

/** True if a WebGL2 context can be made (checked once, on a throwaway canvas). */
export function webgl2Supported(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** The shared layer (created on first call). Resolves null when 3D can't run here (no WebGL2, context failure). */
export function getThreeLayer(game: Phaser.Game): Promise<ThreeLayer | null> {
  if (failed) return Promise.resolve(null);
  if (!pending)
    pending = Promise.resolve().then(() => {
      try {
        return createLayer(game);
      } catch (e) {
        console.error('[3d] renderer unavailable, staying in 2D', e);
        failed = true;
        pending = null;
        return null;
      }
    });
  return pending;
}

function createLayer(game: Phaser.Game): ThreeLayer {
  if (!webgl2Supported()) throw new Error('WebGL2 not supported');
  const pc = game.canvas;
  const canvas = document.createElement('canvas');
  canvas.dataset.three = '1';
  Object.assign(canvas.style, { position: 'fixed', left: '0px', top: '0px', zIndex: '0', pointerEvents: 'none', imageRendering: 'auto', display: 'none' });
  const q0 = settings.get().quality;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance', stencil: false });
  if (!renderer.capabilities.isWebGL2) {
    renderer.dispose();
    throw new Error('WebGL2 context unavailable');
  }
  renderer.setClearColor(PAL.bg, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  // Phaser stays on top: positioned with a z-index above ours (no layout change: relative with no offsets).
  pc.style.position = 'relative';
  pc.style.zIndex = '1';
  pc.insertAdjacentElement('afterend', canvas);

  const resizeCbs = new Set<(w: number, h: number) => void>();
  const lostCbs = new Set<() => void>();
  const owners = new Set<string>();
  let quality = q0;
  let pr = 1;
  let bw = 0;
  let bh = 0;
  let rect = pc.getBoundingClientRect();

  const layout = () => {
    rect = pc.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    Object.assign(canvas.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    pr = PIXEL_RATIO[quality](window.devicePixelRatio || 1);
    pr = Math.min(pr, MAX_W / rect.width);
    const w = Math.max(1, Math.round(rect.width * pr));
    const h = Math.max(1, Math.round(rect.height * pr));
    renderer.shadowMap.enabled = quality !== 'low';
    if (w === bw && h === bh) return;
    bw = w;
    bh = h;
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    resizeCbs.forEach((cb) => cb(w, h));
  };
  let raf = 0;
  const schedule = () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(layout);
  };
  window.addEventListener('resize', schedule);
  new ResizeObserver(schedule).observe(pc);
  game.scale.on('resize', schedule);
  settings.subscribe((s) => {
    if (s.quality === quality) return;
    quality = s.quality;
    bw = bh = 0; // force the callbacks: post chains rebuild per quality
    layout();
  });
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    console.error('[3d] WebGL context lost');
    lostCbs.forEach((cb) => cb());
  });
  layout();

  return {
    renderer,
    canvas,
    gameRect: () => rect,
    cssPerGamePx: () => rect.width / GAME_W,
    pixelRatio: () => pr,
    size: () => ({ w: bw, h: bh }),
    quality: () => quality,
    onResize(cb) {
      resizeCbs.add(cb);
      return () => resizeCbs.delete(cb);
    },
    onLost(cb) {
      lostCbs.add(cb);
      return () => lostCbs.delete(cb);
    },
    claim(owner) {
      owners.add(owner);
      layout();
      canvas.style.display = 'block';
    },
    release(owner) {
      owners.delete(owner);
      if (owners.size) return;
      canvas.style.display = 'none';
      renderer.setRenderTarget(null);
      renderer.clear();
    },
    layout,
  };
}

/**
 * Make Phaser clear to transparent (true: the 3D layer shows through wherever Phaser draws nothing) or back to
 * the opaque PAL.bg (false: exactly the 2D look). WebGL clears premultiplied, so transparent must be (0,0,0,0).
 */
export function setPhaserClear(game: Phaser.Game, transparent: boolean): void {
  const r = game.renderer as unknown as { gl?: WebGLRenderingContext; config: { backgroundColor: Phaser.Display.Color; transparent?: boolean } };
  const bg = r.config.backgroundColor;
  if (transparent) bg.setTo(0, 0, 0, 0);
  else bg.setTo((PAL.bg >> 16) & 255, (PAL.bg >> 8) & 255, PAL.bg & 255, 255);
  if (!r.gl) r.config.transparent = transparent; // Canvas renderer: skip the background fill
}

/** Dispose a whole subtree's geometries, materials and their textures. */
export function disposeTree(root: THREE.Object3D): void {
  const seen = new Set<unknown>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !seen.has(m.geometry)) {
      seen.add(m.geometry);
      m.geometry.dispose();
    }
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      if (seen.has(x)) continue;
      seen.add(x);
      for (const v of Object.values(x)) if (v instanceof THREE.Texture && !seen.has(v)) (seen.add(v), v.dispose());
      x.dispose();
    }
  });
}
