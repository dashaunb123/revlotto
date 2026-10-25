// Shared build context for the strip modules: quality, the stadium light rig, material factory and disposal.
import * as THREE from 'three';
import type { QualityCfg } from './layout';
import type { StadiumRig } from './stadiumLights';

export interface Ctx {
  cfg: QualityCfg;
  rig: StadiumRig;
  group: THREE.Group;
  noise: THREE.Texture;
  /** Last rendered camera position (world), refreshed every frame by the sky dome. */
  camPos: THREE.Vector3;
  /** Every lit material that should pick up the env map once it is baked. */
  envMats: (THREE.MeshStandardMaterial & { userData: { envK?: number } })[];
  updaters: ((dt: number, t: number) => void)[];
  /** Register a texture / geometry / material / render target for dispose(). */
  own<T extends { dispose(): void }>(x: T): T;
  /** A MeshStandardMaterial lit by the stadium rig (registered for the env map). */
  std(p: THREE.MeshStandardMaterialParameters, envK?: number, extra?: (sh: THREE.WebGLProgramParametersWithUniforms) => void, key?: string): THREE.MeshStandardMaterial;
}

export function makeCtx(cfg: QualityCfg, rig: StadiumRig, group: THREE.Group, noise: THREE.Texture): Ctx & { disposeAll(): void } {
  const owned = new Set<{ dispose(): void }>();
  const ctx: Ctx & { disposeAll(): void } = {
    cfg, rig, group, noise,
    camPos: new THREE.Vector3(0, 2, 0),
    envMats: [],
    updaters: [],
    own(x) { owned.add(x); return x; },
    std(p, envK = 1, extra, key) {
      const m = new THREE.MeshStandardMaterial(p);
      m.userData.envK = envK;
      rig.patch(m, extra, key);
      ctx.envMats.push(m);
      owned.add(m);
      return m;
    },
    disposeAll() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) owned.add(m.geometry);
        const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : [];
        for (const mt of mats) {
          owned.add(mt);
          for (const v of Object.values(mt)) if (v instanceof THREE.Texture) owned.add(v);
        }
        if ((o as THREE.InstancedMesh).isInstancedMesh) owned.add(o as THREE.InstancedMesh);
      });
      owned.forEach((x) => x.dispose());
      owned.clear();
    },
  };
  return ctx;
}

/** Mesh helper: adds to a parent with shadow flags. */
export function mesh(parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, opts: { cast?: boolean; receive?: boolean; name?: string } = {}) {
  const me = new THREE.Mesh(g, m);
  if (!m.name) m.name = 'env:' + (opts.name ?? (parent.name || 'mesh'));
  me.castShadow = !!opts.cast;
  me.receiveShadow = opts.receive ?? true;
  if (opts.name) me.name = opts.name;
  me.matrixAutoUpdate = false;
  me.updateMatrix();
  parent.add(me);
  return me;
}
