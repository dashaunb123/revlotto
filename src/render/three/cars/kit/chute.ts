// Drag parachute: a vented, flattened red/white gored canopy (darker inside) on 8 shroud lines and a riser, that
// bursts out of the bumper pack, swings onto the car's centre line and trails ~7 m back at about roof height on a
// damped spring with a little flutter. Everything is built (and prewarmed) with the car; deploying only animates
// transforms, so no shader compiles at the finish.
import * as THREE from 'three';
import type { Res } from './res';
import { canvas, texFrom } from './tex';

const LINES = 8;
const R = 1.15; // canopy sphere radius (~2.4 m across once flattened)
const T0 = 0.12; // vent half-angle at the pole
const T1 = 0.95; // canopy edge polar angle

export interface Chute {
  group: THREE.Group;
  /** 0 = packed (instantly cleared), > 0 = deploy toward that openness (1 = fully blown). */
  set(k: number): void;
  update(dt: number, attach: THREE.Vector3): void;
  /** Show everything for shader compilation, then hide again. */
  showForPrewarm(on: boolean): void;
}

export function buildChute(res: Res, color: string): Chute {
  const group = new THREE.Group();
  group.name = 'chute';
  group.visible = false;
  const tex = res.get(`t:chute:${color}`, () => {
    const [c, g] = canvas(256, 64);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#f4f2ea' : color;
      g.fillRect(i * 32, 0, 32, 64);
    }
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 8; i++) g.fillRect(i * 32, 0, 1.5, 64); // seams
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.fillRect(0, 58, 256, 6); // reinforced skirt band
    return texFrom(c, { srgb: true, wrapS: true });
  });
  const outerM = res.get(`m:chuteOut:${color}`, () => new THREE.MeshStandardMaterial({ map: tex, side: THREE.FrontSide, roughness: 0.85 }));
  const innerM = res.get(`m:chuteIn:${color}`, () => new THREE.MeshStandardMaterial({ map: tex, color: 0x6a6a6a, side: THREE.BackSide, roughness: 0.9 }));
  const ventM = res.get('m:chuteVent', () => new THREE.MeshBasicMaterial({ color: 0x0b0b0e, side: THREE.DoubleSide }));
  const lineM = res.get('m:chuteLine', () => new THREE.MeshStandardMaterial({ color: 0xe8e4d8, roughness: 0.8 }));
  const dome = res.get('g:chuteDome2', () => {
    const g = new THREE.SphereGeometry(R, 24, 8, 0, Math.PI * 2, T0, T1 - T0);
    g.rotateZ(Math.PI / 2); // pole -> -X, mouth toward the car
    return g;
  });
  const ventG = res.get('g:chuteVent', () => {
    const g = new THREE.CircleGeometry(R * Math.sin(T0) * 1.05, 16);
    g.rotateY(Math.PI / 2);
    g.translate(-R * Math.cos(T0) + 0.04, 0, 0);
    return g;
  });
  const lineG = res.get('g:chuteLineCyl', () => {
    const g = new THREE.CylinderGeometry(0.007, 0.007, 1, 4, 1, true);
    g.translate(0, 0.5, 0); // base at the origin, +Y length 1
    return g;
  });
  const canopy = new THREE.Group();
  const outer = new THREE.Mesh(dome, outerM);
  const inner = new THREE.Mesh(dome, innerM);
  const vent = new THREE.Mesh(ventG, ventM);
  outer.castShadow = true;
  canopy.add(outer, inner, vent);
  canopy.name = 'chuteCanopy';
  group.add(canopy);
  const lines = new THREE.InstancedMesh(lineG, lineM, LINES + 1);
  lines.name = 'chuteLines';
  lines.frustumCulled = false;
  group.add(lines);

  const rimR = R * Math.sin(T1);
  const rimX = -R * Math.cos(T1); // rim plane (local), toward the car from the pole
  let target = 0;
  let open = 0;
  let len = 0;
  let lenV = 0;
  let t = 0;
  const c = new THREE.Vector3();
  const conf = new THREE.Vector3();
  const rim = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const dir = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const sc = new THREE.Vector3();
  const seg = (i: number, a: THREE.Vector3, b: THREE.Vector3) => {
    dir.subVectors(b, a);
    const l = dir.length();
    q.setFromUnitVectors(UP, l > 1e-5 ? dir.divideScalar(l) : UP);
    lines.setMatrixAt(i, m4.compose(a, q, sc.set(1, Math.max(1e-3, l), 1)));
  };
  return {
    group,
    set(k) {
      target = THREE.MathUtils.clamp(k, 0, 1);
      if (target === 0) {
        open = 0;
        len = 0;
        lenV = 0;
        group.visible = false;
      }
    },
    showForPrewarm(on) {
      group.visible = on || target > 0;
    },
    update(dt, attach) {
      if (target <= 0) return;
      group.visible = true;
      // only the canopy casts (plain depth program, already compiled); the instanced lines / vent never do, even
      // if the host flips castShadow on the whole car (an instanced depth program would compile at the finish)
      lines.castShadow = false;
      vent.castShadow = false;
      inner.castShadow = false;
      t += dt;
      open = Math.min(1, open + dt / 0.3);
      // trail length on an under-damped spring: shoots out, overshoots, settles ~7.2 m back
      const L = 7.2 * target * open;
      const w = 7;
      const z = 0.4;
      lenV += (-w * w * (len - L) - 2 * z * w * lenV) * dt;
      len = Math.max(0, len + lenV * dt);
      const blow = THREE.MathUtils.smoothstep(open, 0.15, 1) * target;
      const flutter = blow * (0.07 * Math.sin(t * 6.3) + 0.035 * Math.sin(t * 11.9 + 1));
      // swings from the pack onto the centre line as it blooms, at about roof height
      const cz = THREE.MathUtils.lerp(attach.z, 0, blow);
      c.set(attach.x - len, attach.y + 0.35 + 0.6 * blow + flutter, cz + blow * 0.1 * Math.sin(t * 4.7 + 2));
      const breathe = 1 + 0.045 * Math.sin(t * 9.7) * blow;
      const s = Math.max(0.05, blow);
      canopy.position.copy(c);
      canopy.scale.set(s * 0.6, s * breathe, s * breathe);
      canopy.rotation.x = flutter * 0.7;
      canopy.rotation.y = 0.05 * Math.sin(t * 3.3) * blow;
      // 8 shroud lines from the skirt to a confluence point, then the riser to the pack
      conf.set(attach.x - len * 0.4, THREE.MathUtils.lerp(attach.y, c.y, 0.45), THREE.MathUtils.lerp(attach.z, cz, 0.6));
      canopy.updateMatrix();
      for (let i = 0; i < LINES; i++) {
        const a = (i / LINES) * Math.PI * 2 + Math.PI / LINES;
        rim.set(rimX, Math.cos(a) * rimR, Math.sin(a) * rimR).applyMatrix4(canopy.matrix);
        seg(i, conf, rim);
      }
      seg(LINES, attach, conf);
      lines.instanceMatrix.needsUpdate = true;
    },
  };
}
