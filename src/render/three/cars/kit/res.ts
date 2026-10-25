// Shared, ref-counted GPU resources for the car kit. Every Car3D owns a Res; identical wheels, materials and
// textures are built once and shared by every car that asks for the same key. Resources created while another
// shared resource is being built (a texture inside a material factory) become that resource's dependencies.
import type * as THREE from 'three';

type Disp = { dispose(): void };
interface Entry { v: Disp; refs: number; deps: string[] }

const store = new Map<string, Entry>();
const building: string[][] = [];
/** Everything handed out by the cache (Car3D.dispose skips these; the cache frees them when unused). */
export const SHARED = new WeakSet<object>();

export function isShared(o: object | null | undefined): boolean {
  if (!o) return false;
  return SHARED.has(o) || !!(o as { userData?: { shared?: boolean } }).userData?.shared;
}

function releaseKey(k: string) {
  const e = store.get(k);
  if (!e || --e.refs > 0) return;
  store.delete(k);
  e.v.dispose();
  e.deps.forEach(releaseKey);
}

export class Res {
  private keys: string[] = [];
  private mine: Disp[] = [];

  /** A shared resource by key (built on first use). */
  get<T extends Disp>(key: string, make: () => T): T {
    let e = store.get(key);
    if (!e) {
      building.push([]);
      let v: T;
      try {
        v = make();
      } catch (err) {
        building.pop();
        throw err;
      }
      e = { v, refs: 0, deps: building.pop() as string[] };
      SHARED.add(v);
      store.set(key, e);
    }
    e.refs++;
    if (building.length) building[building.length - 1].push(key);
    else this.keys.push(key);
    return e.v as T;
  }

  /** A per-car resource (disposed with the car). */
  own<T extends Disp>(v: T): T {
    this.mine.push(v);
    return v;
  }

  release() {
    this.keys.forEach(releaseKey);
    this.keys = [];
    this.mine.forEach((d) => d.dispose());
    this.mine = [];
  }
}

/** Debug: live shared entries. */
export function resStats(): { entries: number } {
  return { entries: store.size };
}

export type Tex = THREE.Texture;
