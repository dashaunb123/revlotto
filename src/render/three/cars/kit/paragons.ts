// PARAGON dressings. Each brand's transformed car = its body + Look's paragon livery (stripes, bumblebee, claws, SS
// badges...) + the kit style overrides in style.ts (wings, hoods, pipes, wheelie bar...) + the small 3D touches here.
import * as THREE from 'three';
import type { BodyBuild, CarSpec } from '../../types';
import type { AddonsOut } from './addons';
import { extrude, roundedPath } from './geom';
import type { KitMats } from './mats';
import type { Res } from './res';
import type { Quality } from './wheels';

export interface ParagonCtx {
  build: BodyBuild;
  spec: CarSpec;
  res: Res;
  mats: KitMats;
  quality: Quality;
  inner: THREE.Group;
  addons: AddonsOut;
}

export interface ParagonOut {
  update?(dt: number): void;
  dispose?(): void;
}

function add(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

export function buildParagon(ctx: ParagonCtx): ParagonOut {
  const { build, spec, mats, addons } = ctx;
  const kit = addons.group;
  const surf = addons.surface;
  const A = build.anchors;
  const box = surf.box;
  const black = mats.paint('#141418', { finish: 'solid' });
  switch (spec.paragon) {
    case 'civique': {
      // roof-edge vortex generators (the FK8 tell)
      const x = A.roof.x - 0.35;
      for (let i = 0; i < 9; i++) {
        const z = (i - 4) * 0.075;
        const h = surf.down(x, z);
        if (!h) continue;
        const fin = new THREE.Shape();
        roundedPath([[0, 0], [-0.07, 0], [-0.07, 0.022]], 0.004, fin);
        const g = extrude(fin, 0.004, 0.0008, 3, -0.002);
        g.rotateY((i % 2 ? 1 : -1) * 0.25);
        const m = add(kit, g, black, 'vortexGen');
        m.position.set(x, h.d, z);
      }
      break;
    }
    case 'viperion': {
      // fender gills behind the front wheels: three black vents per side
      const xw = A.wheelFL.x - build.dims.wheelR - 0.12;
      for (const s of [-1, 1])
        for (let i = 0; i < 3; i++) {
          const x = xw - i * 0.055;
          const y = A.wheelFL.y + 0.1;
          const h = surf.side(x, y, s);
          if (!h) continue;
          const slot = new THREE.BoxGeometry(0.018, 0.16, 0.012);
          slot.rotateZ(0.35);
          const m = add(kit, slot, mats.plastic('#060608', 0.1), 'gill');
          m.position.set(x, y, h.d - s * 0.002);
        }
      break;
    }
    case 'lamberghoul': {
      // black side intakes behind the doors
      const x = A.seat.x - 0.55;
      for (const s of [-1, 1]) {
        const y = A.seat.y - 0.35;
        const h = surf.side(x, y, s);
        if (!h) continue;
        const sh = new THREE.Shape();
        roundedPath([[0.18, -0.12], [-0.16, -0.12], [-0.22, 0.1], [0.06, 0.12]], 0.02, sh);
        const g = extrude(sh, 0.03, 0.006, 6, -0.015);
        const m = add(kit, g, mats.carbon(), 'sideIntake');
        m.position.set(x, y, h.d - s * 0.012);
        m.rotation.y = s * 0.12;
        for (let k = 0; k < 4; k++) {
          const slat = new THREE.BoxGeometry(0.26, 0.008, 0.014);
          const sm = add(m, slat, black, 'intakeSlat');
          sm.position.set(-0.03, -0.075 + k * 0.05, 0.016);
        }
      }
      break;
    }
    default:
      break;
  }
  void box;
  return {};
}
