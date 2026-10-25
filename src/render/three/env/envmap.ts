// Procedural PMREM environment: a dedicated low-cost scene (night sky, glowing tower heads, lit pools on the
// pavement, the walls, stands and their roof lights, the scoreboards) captured from mid-track at car height so
// paint and glass reflect the stadium.
import * as THREE from 'three';
import type { Ctx } from './ctx';
import * as L from './layout';
import type { TowerDef } from './lights';
import { skyMaterial } from './sky';
import { STANDS } from './stands';

export function bakeEnvMap(ctx: Ctx, renderer: THREE.WebGLRenderer, towers: TowerDef[], skyTex: THREE.Texture, at = new THREE.Vector3(160, 1.1, 0)): THREE.Texture {
  const scene = new THREE.Scene();
  const own: { dispose(): void }[] = [];
  const add = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    own.push(g, m);
    const me = new THREE.Mesh(g, m);
    me.position.set(x - at.x, y - at.y, z - at.z);
    scene.add(me);
    return me;
  };
  const basic = (c: THREE.ColorRepresentation | THREE.Color, k = 1) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c as THREE.ColorRepresentation).multiplyScalar(k), side: THREE.DoubleSide });
  // sky
  const sm = skyMaterial(ctx, skyTex);
  sm.uniforms.uTime.value = 30;
  const dome = add(new THREE.SphereGeometry(300, 48, 24), sm);
  dome.position.set(0, 0, 0);
  dome.renderOrder = -100;
  // pavement + infield
  const gnd = new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2);
  add(gnd, basic(0x0b0c0f), at.x, 0, 0);
  const trk = new THREE.PlaneGeometry(L.TRACK_X1 - L.TRACK_X0, L.OUTER_Z * 2).rotateX(-Math.PI / 2);
  add(trk, basic(0x1a1a1c), (L.TRACK_X0 + L.TRACK_X1) / 2, 0.01, 0);
  // light pools under each tower
  for (const t of towers) {
    const pool = new THREE.CircleGeometry(16, 24).rotateX(-Math.PI / 2);
    const p = add(pool, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.22, 0.2, 0.18).multiplyScalar(t.power), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }), t.x + 4, 0.02, -t.side * 1.5);
    p.scale.set(1.4, 1, 0.6);
  }
  // walls (bright, lit faces) and the centre wall
  for (const s of [1, -1]) add(new THREE.BoxGeometry(L.OWALL_END_R - L.OWALL_X0, L.OWALL_H, 0.3), basic(0x5a5a58), (L.OWALL_X0 + L.OWALL_END_R) / 2, L.OWALL_H / 2, s * (L.OUTER_Z + 0.15));
  add(new THREE.BoxGeometry(L.CWALL_END - L.CWALL_START, 0.8, 0.4), basic(0x48484a), (L.CWALL_START + L.CWALL_END) / 2, 0.4, 0);
  // stands with crowd speckle and roof lights
  for (const st of STANDS) {
    const depth = st.rows * 0.85, hgt = 1.3 + st.rows * 0.42;
    const b = new THREE.BoxGeometry(st.x1 - st.x0, hgt, depth);
    add(b, basic(0x16161a), (st.x0 + st.x1) / 2, hgt / 2, st.side * (L.STAND_Z0 + depth / 2));
    if (st.roof) {
      const strip = new THREE.BoxGeometry(st.x1 - st.x0, 0.2, 6);
      add(strip, basic(0xffe6c0, 3.5), (st.x0 + st.x1) / 2, hgt + 5, st.side * (L.STAND_Z0 + depth / 2));
    }
  }
  // tower heads (very bright) + their poles
  for (const t of towers) {
    const head = new THREE.BoxGeometry(4.4, 2.7, 0.4);
    const m = add(head, basic(new THREE.Color(1, 0.94, 0.86), 60 * t.power), t.head.x, t.head.y, t.head.z);
    m.lookAt(new THREE.Vector3(t.head.x, t.head.y, t.head.z).add(t.aim).sub(at));
    add(new THREE.CylinderGeometry(0.3, 0.3, t.h, 6), basic(0x2a2c30), t.x, t.h / 2, t.side * L.TOWER_Z);
  }
  // scoreboards + gantry banners
  for (const s of [1, -1]) add(new THREE.BoxGeometry(0.2, 3, 7), basic(0xff8a1a, 1.6), L.SCOREBOARD.x, 6.3, s * L.SCOREBOARD.z);
  add(new THREE.BoxGeometry(0.3, 1.6, 11.6), basic(0xb0000e, 0.8), L.FINISH_X, 7, 0);
  add(new THREE.BoxGeometry(0.3, 1.6, 11.6), basic(0x2030a0, 0.8), 1.6, 7, 0);

  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.035, 0.1, 1200);
  pm.dispose();
  own.forEach((o) => o.dispose());
  ctx.own(rt);
  return rt.texture;
}
