// Phaser-side glue for the 3D car showcases (three-free, so scenes can import it statically; the three side
// in showcase.ts is only ever loaded through the dynamic import below, in 3D mode).
//
// A slot punches a hole into the scene: a Graphics rect with Phaser's ERASE blend (dst * (1 - alpha)) placed in
// the display list right above the panel background, so everything drawn before it in that rect is cleared to
// transparent and the shared three canvas behind Phaser shows through, while everything drawn after it (labels,
// buttons, icons, tooltips) stays on top. The hole only opens once the 3D car has rendered its first frame; until
// then, and for good if anything fails (no WebGL2, a load error, a bad car build, a lost context), the scene's
// pixel car stays exactly as in 2D.
import Phaser from 'phaser';
import { settings } from '../../game/settings';
import type { CarVisual } from '../car';
import type { CarShowcase, GameRect, ShowcaseOpts, SwapFx } from './showcase';

let gl2: boolean | null = null;
const openSlots = new Set<ShowcaseSlot>();

/** How many showcases are up right now (dev harness / tests). */
export function openShowcases(): number {
  return openSlots.size;
}

/** True if a WebGL2 context can be made here (checked once on a throwaway canvas). */
export function webgl2Ok(): boolean {
  if (gl2 !== null) return gl2;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    gl2 = !!gl;
    (gl?.getExtension('WEBGL_lose_context') as { loseContext(): void } | null)?.loseContext();
  } catch {
    gl2 = false;
  }
  return gl2;
}

/** 3D showcases are on: the 3D mode is selected and this browser can run it. */
export function use3D(): boolean {
  return settings.renderMode() === '3d' && webgl2Ok();
}

/** Move `obj` to sit directly above `ref` in the scene's display list (same depth keeps that order). */
function placeAbove(scene: Phaser.Scene, obj: Phaser.GameObjects.GameObject, ref: Phaser.GameObjects.GameObject) {
  const list = scene.children.list;
  const i = list.indexOf(obj);
  if (i < 0 || list.indexOf(ref) < 0) return;
  list.splice(i, 1);
  list.splice(list.indexOf(ref) + 1, 0, obj);
}

type ShowcaseModule = typeof import('./showcase');
let mod: Promise<ShowcaseModule> | null = null;

/** Start fetching the three chunk early (Title in 3D mode) so the first showcase opens instantly. */
export function preloadShowcase(): Promise<ShowcaseModule> | null {
  if (!use3D()) return null;
  if (!mod) {
    mod = import('./showcase').catch((e) => {
      mod = null;
      throw e;
    });
    mod.catch(() => {}); // a fire-and-forget preload must not surface as an unhandled rejection
  }
  return mod;
}

export interface SlotOpts extends Omit<ShowcaseOpts, 'rect' | 'shake'> {
  rect: GameRect;
  /** Put the hole right above this object in the display list (and at its depth). */
  after?: Phaser.GameObjects.GameObject & Partial<Phaser.GameObjects.Components.Depth>;
  /** ...or at this depth (above everything already there at that depth). */
  depth?: number;
  /** Drag-to-rotate over the rect. */
  drag?: boolean;
  /** Start with the hole closed (alpha 0); fade it with slot.hole alpha (e.g. a cross-fade). */
  holeAlpha?: number;
}

export class ShowcaseSlot {
  readonly hole: Phaser.GameObjects.Graphics;
  /** The 3D car is up and the hole is open. */
  ready = false;
  failed = false;
  private show: CarShowcase | null = null;
  private visual: CarVisual | null = null;
  private preparing: CarVisual | null = null;
  private covered: Phaser.GameObjects.Components.Visible[] = [];
  private zone: Phaser.GameObjects.Zone | null = null;
  private dead = false;
  private readyCbs: (() => void)[] = [];
  private onMove: ((p: Phaser.Input.Pointer) => void) | null = null;
  private onUp: (() => void) | null = null;

  constructor(
    private scene: Phaser.Scene,
    private opts: SlotOpts,
  ) {
    const r = opts.rect;
    this.hole = scene.add.graphics();
    this.hole.fillStyle(0xffffff, 1).fillRect(r.x, r.y, r.w, r.h);
    this.hole.setBlendMode(Phaser.BlendModes.ERASE).setVisible(false).setAlpha(opts.holeAlpha ?? 1);
    if (opts.after) {
      this.hole.setDepth(opts.after.depth ?? 0);
      placeAbove(scene, this.hole, opts.after);
    } else if (opts.depth !== undefined) this.hole.setDepth(opts.depth);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.dispose());
    scene.events.once(Phaser.Scenes.Events.DESTROY, () => this.dispose());
    const cam = scene.cameras.main;
    const shake = () => {
      const s = cam.shakeEffect as unknown as { isRunning: boolean; _offsetX: number; _offsetY: number };
      return s?.isRunning ? { x: s._offsetX ?? 0, y: s._offsetY ?? 0 } : { x: 0, y: 0 };
    };
    const p = preloadShowcase();
    if (!p) {
      this.fail();
      return;
    }
    p.then((m) => m.CarShowcase.create(scene.game, { ...opts, shake }))
      .then((show) => {
        if (!show) return this.fail();
        if (this.dead) return show.dispose();
        this.show = show;
        show.onFail(() => this.fail());
        show.onFirstFrame(() => this.open());
        if (this.visual) show.setCar(this.visual, 'none');
        if (this.preparing) show.prepare(this.preparing);
        if (opts.drag) this.makeDrag();
      })
      .catch((e) => {
        console.error('[3d showcase] unavailable, keeping the pixel car', e);
        this.fail();
      });
  }

  /** Show this car (built in 3D; the pixel car stays the fallback). */
  setCar(v: CarVisual, fx: SwapFx = 'swap') {
    this.visual = v;
    if (this.show && !this.failed) this.show.setCar(v, this.ready ? fx : 'none');
  }

  /** Build + compile this car in the background so a later setCar(v) swaps instantly. */
  prepare(v: CarVisual) {
    this.preparing = v;
    if (this.show && !this.failed) this.show.prepare(v);
  }

  /** Hide these pixel-mode objects while the 3D car is up (and bring them back if 3D fails). */
  cover(...objs: (Phaser.GameObjects.Components.Visible | null | undefined)[]) {
    for (const o of objs) {
      if (!o) continue;
      this.covered.push(o);
      if (this.ready) o.setVisible(false);
    }
  }

  onReady(cb: () => void) {
    if (this.ready) cb();
    else this.readyCbs.push(cb);
  }

  /** The 3D showcase itself (null until loaded / in 2D): pop, flash, setHeat, setRays, enter... */
  get car3d(): CarShowcase | null {
    return this.ready ? this.show : null;
  }

  pop(amount?: number) {
    if (this.ready) this.show?.pop(amount);
  }

  flash(k?: number) {
    if (this.ready) this.show?.flash(k);
  }

  setVisible(on: boolean) {
    this.hole.setVisible(on && this.ready);
    this.show?.setVisible(on);
  }

  private open() {
    if (this.dead || this.failed) return;
    this.ready = true;
    openSlots.add(this);
    this.hole.setVisible(true);
    for (const o of this.covered) (o as unknown as { active?: boolean }).active !== false && o.setVisible(false);
    const cbs = this.readyCbs;
    this.readyCbs = [];
    cbs.forEach((cb) => cb());
  }

  private fail() {
    if (this.failed) return;
    this.failed = true;
    this.ready = false;
    openSlots.delete(this);
    if (!this.dead) {
      this.hole.setVisible(false);
      for (const o of this.covered) (o as unknown as { active?: boolean }).active !== false && o.setVisible(true);
    }
    this.show?.dispose();
    this.show = null;
  }

  private makeDrag() {
    const r = this.opts.rect;
    const z = this.scene.add.zone(r.x, r.y, r.w, r.h).setOrigin(0, 0).setDepth(this.hole.depth);
    placeAbove(this.scene, z, this.hole);
    z.setInteractive({ cursor: 'grab' });
    let lastX = 0;
    let down = false;
    z.on('pointerdown', (p: Phaser.Input.Pointer) => {
      down = true;
      lastX = p.x;
      this.show?.dragStart();
      this.scene.input.setDefaultCursor('grabbing');
    });
    this.onMove = (p: Phaser.Input.Pointer) => {
      if (!down) return;
      this.show?.dragBy(p.x - lastX);
      lastX = p.x;
    };
    this.onUp = () => {
      if (!down) return;
      down = false;
      this.show?.dragEnd();
      this.scene.input.setDefaultCursor('default');
    };
    this.scene.input.on('pointermove', this.onMove);
    this.scene.input.on('pointerup', this.onUp);
    this.scene.input.on('pointerupoutside', this.onUp);
    this.zone = z;
  }

  dispose() {
    if (this.dead) return;
    this.dead = true;
    openSlots.delete(this);
    if (this.onMove) this.scene.input?.off('pointermove', this.onMove);
    if (this.onUp) {
      this.scene.input?.off('pointerup', this.onUp);
      this.scene.input?.off('pointerupoutside', this.onUp);
    }
    this.zone?.destroy();
    this.show?.dispose();
    this.show = null;
    this.hole.destroy();
  }
}
