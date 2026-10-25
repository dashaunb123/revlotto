// Kit materials. Uses the Look agent's library (three/materials.ts) when it is present (paint, chrome, carbon,
// caliper, plastic, lights...), with local fallbacks so the kit works on its own. Look's materials are shared and
// owned by Look (userData.shared); kit-only materials go through the ref-counted Res cache.
import * as THREE from 'three';
import type { Res } from './res';
import { SHARED } from './res';
import { lum, tyreAtlas, type TyreKind } from './tex';
export { lum };

type AnyFn = (...a: never[]) => unknown;
type LookMod = Partial<Record<string, AnyFn>>;
const lookMod = Object.values(import.meta.glob('../../materials.ts', { eager: true }))[0] as LookMod | undefined;

/** Call a Look material factory if it exists; never throws. */
function look<T>(name: string, ...args: unknown[]): T | undefined {
  const f = lookMod?.[name] as ((...a: unknown[]) => T) | undefined;
  if (!f) return undefined;
  try {
    const m = f(...args);
    if (m && typeof m === 'object') SHARED.add(m as object);
    return m;
  } catch (e) {
    console.warn('[kit] look.' + name + ' failed', e);
    return undefined;
  }
}
export const lookApi = lookMod;

const phys = (p: THREE.MeshPhysicalMaterialParameters) => new THREE.MeshPhysicalMaterial(p);
const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
const hex = (c: string | number) => new THREE.Color(c).getHexString();


export class KitMats {
  constructor(private res: Res) {}

  paint(color: string, opts: Record<string, unknown> = {}): THREE.Material {
    return look<THREE.Material>('paintMaterial', color, opts) ??
      this.res.get(`m:paint:${hex(color)}`, () => phys({ color, metalness: 0.45, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05 }));
  }
  chrome(): THREE.Material {
    return look<THREE.Material>('chrome') ?? this.res.get('m:chrome', () => std({ color: 0xffffff, metalness: 1, roughness: 0.06 }));
  }
  /** Polished aluminium (rim lips, Weld faces, blower case). */
  polished(): THREE.Material {
    return this.res.get('m:polished', () => phys({ color: 0xe4e4ea, metalness: 0.92, roughness: 0.26 }));
  }
  /** Machined inner barrel / cast metal. */
  machined(): THREE.Material {
    return this.res.get('m:machined', () => std({ color: 0x8c8c94, metalness: 0.9, roughness: 0.42 }));
  }
  brushed(color = '#b8b8c0'): THREE.Material {
    return look<THREE.Material>('brushedMetal', color) ?? this.res.get(`m:brushed:${hex(color)}`, () => std({ color, metalness: 0.95, roughness: 0.32 }));
  }
  darkMetal(): THREE.Material {
    return this.res.get('m:darkmetal', () => std({ color: 0x2a2a30, metalness: 0.7, roughness: 0.55 }));
  }
  zinc(): THREE.Material {
    return this.res.get('m:zinc', () => std({ color: 0x55565c, metalness: 0.85, roughness: 0.38 }));
  }
  plastic(color = '#141416', gloss = 0.2): THREE.Material {
    return look<THREE.Material>('plastic', color, { gloss }) ??
      this.res.get(`m:plastic:${hex(color)}:${gloss}`, () => std({ color, metalness: 0, roughness: 0.75 - gloss * 0.5 }));
  }
  carbon(): THREE.Material {
    return look<THREE.Material>('carbon', { gloss: 1 }) ??
      this.res.get('m:carbon', () => phys({ color: 0x1a1a1e, metalness: 0.3, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.04 }));
  }
  /** Moulded wheel-cover plastic in the rim colour (stock hubcaps). */
  hubcap(color: string): THREE.Material {
    return this.res.get(`m:hubcap:${hex(color)}`, () => phys({ color, metalness: 0.55, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.15 }));
  }
  grille(pattern: 'honeycomb' | 'mesh' | 'bars' | 'slats'): THREE.Material {
    return look<THREE.Material>('grille', { pattern }) ?? this.plastic('#0c0c0e', 0.3);
  }
  /** Painted / anodized wheel finish from the rim colour. */
  rim(color: string): THREE.Material {
    return look<THREE.Material>('rimMaterial', color) ?? this.res.get(`m:rim:${hex(color)}`, () => {
      const l = lum(color);
      const bronze = new THREE.Color(color).getHSL({ h: 0, s: 0, l: 0 }).s > 0.25 && l > 0.3;
      return phys({
        color,
        metalness: l > 0.55 ? 0.85 : bronze ? 0.8 : 0.45,
        roughness: l > 0.55 ? 0.24 : 0.3,
        clearcoat: 0.8,
        clearcoatRoughness: 0.08,
      });
    });
  }
  caliper(color: string): THREE.Material {
    return look<THREE.Material>('caliper', color) ??
      this.res.get(`m:caliper:${hex(color)}`, () => phys({ color, metalness: 0.1, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.1 }));
  }
  /** One material for the whole tyre (sidewall lettering + tread in a single atlas; see tex.tyreAtlas). */
  tyre(kind: TyreKind, R: number, rb: number, W: number, grooves: number[][], smeared = false): THREE.MeshStandardMaterial {
    const key = `${kind}:${R.toFixed(3)}:${rb.toFixed(3)}:${W.toFixed(3)}${smeared ? ':smear' : ''}`;
    return this.res.get(`m:tyre:${key}`, () => {
      const rMid = (R + rb) / 2;
      const aspect = ((2 * Math.PI * rMid) / 2048) / ((R - rb) / 256);
      const t = this.res.get(`t:tyre:${key}`, () => {
        const a = tyreAtlas(kind, aspect, 2 * Math.PI * R, W, grooves, smeared);
        return { ...a, dispose: () => (a.bump.dispose(), a.map.dispose()) };
      });
      const slick = kind === 'slick' || kind === 'skinny';
      return std({ map: t.map, bumpMap: t.bump, bumpScale: slick ? 2 : 2.4, roughness: slick ? 0.7 : 0.86, metalness: 0 });
    });
  }

}
