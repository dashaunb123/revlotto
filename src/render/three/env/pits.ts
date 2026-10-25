// Surroundings that sell the venue from wide shots: the pit area behind the start line (race trailers, pop-up
// tents, work lights) and the spectator car park behind the far stands (instanced parked cars, sodium lot lights
// with baked ground pools).
import * as THREE from 'three';
import type { Ctx } from './ctx';
import { mesh } from './ctx';
import { box, member, merge, tint } from './geo';
import * as L from './layout';
import type { PbrSet } from './textures';
import { glowTexture } from './textures';

function poolTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const rg = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  rg.addColorStop(0, 'rgba(255,255,255,1)');
  rg.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  rg.addColorStop(0.7, 'rgba(255,255,255,0.12)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A parked car: body + cabin, ~4.5 m, facing +X. Vertex colours: paint (1) / glass (dark). */
function parkedCar(): THREE.BufferGeometry {
  const body = tint(box(4.5, 0.78, 1.8, 0, 0.52, 0), 0xffffff);
  const sill = tint(box(4.3, 0.14, 1.7, 0, 0.07, 0), 0x050505);
  const cabin = new THREE.BoxGeometry(2.4, 0.55, 1.6);
  const p = cabin.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * 0.72); p.setZ(i, p.getZ(i) * 0.86); }
  cabin.computeVertexNormals();
  cabin.translate(-0.25, 1.18, 0);
  tint(cabin, 0x101318);
  return merge([body, sill, cabin]);
}

export function buildPits(ctx: Ctx, asp: PbrSet) {
  const P = new THREE.Group();
  P.name = 'pitsAndParking';
  ctx.group.add(P);
  const dens = ctx.cfg.props;
  const r = L.rng(2024);
  const lotMat = ctx.std({ map: asp.map, roughnessMap: asp.roughnessMap, normalMap: asp.normalMap, color: 0x9a9a9a, roughness: 1 }, 0.3);
  const lot = (x0: number, x1: number, z0: number, z1: number) => {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, -0.005, (z0 + z1) / 2);
    const uv = g.getAttribute('uv') as THREE.BufferAttribute, ps = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, ps.getX(i) / 3.5, ps.getZ(i) / 3.5);
    return g;
  };
  const PARK = { x0: 10, x1: 250, z0: -44, z1: -96 };
  const PIT = { x0: -175, x1: -72, z0: -42, z1: 42 };
  mesh(P, merge([lot(PARK.x0, PARK.x1, PARK.z1, PARK.z0), lot(PIT.x0, PIT.x1, PIT.z0, PIT.z1)]), lotMat, { name: 'lots' });

  // ---------------- car park ----------------
  const paint = ctx.std({ color: 0xe8e8e8, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }, 0.2);
  const lines: THREE.BufferGeometry[] = [];
  const spots: { x: number; z: number; flip: boolean }[] = [];
  for (let row = 0; row < 4; row++) {
    const zc = PARK.z0 - 6 - row * 12.5;
    for (const side of [-1, 1]) {
      const zl = zc + side * 2.6;
      for (let x = PARK.x0 + 4; x < PARK.x1 - 4; x += 2.7) {
        const g = new THREE.PlaneGeometry(0.1, 5.0);
        g.rotateX(-Math.PI / 2);
        g.translate(x, 0.004, zl);
        lines.push(g);
        if (r() < 0.62 * (0.6 + dens * 0.4)) spots.push({ x: x + 1.35, z: zl, flip: side > 0 });
      }
    }
  }
  mesh(P, merge(lines), paint, { name: 'stallLines' });
  const carG = ctx.own(parkedCar());
  const carMat = ctx.std({ vertexColors: true, roughness: 0.32, metalness: 0.55 }, 1.4);
  const cars = new THREE.InstancedMesh(carG, carMat, spots.length);
  const palette = ['#d8d8dc', '#111214', '#2a2c30', '#8a8e94', '#7a0d12', '#0d2b5a', '#f2f2f2', '#3a4a3a', '#5a3a20', '#b8a070'].map((c) => new THREE.Color(c));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
  spots.forEach((sp, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (sp.flip ? -Math.PI / 2 : Math.PI / 2) + (r() - 0.5) * 0.08);
    s.setScalar(0.92 + r() * 0.16);
    m4.compose(pos.set(sp.x, 0, sp.z), q, s);
    cars.setMatrixAt(i, m4);
    cars.setColorAt(i, palette[Math.floor(r() * palette.length)]);
  });
  cars.computeBoundingSphere();
  cars.name = 'parkedCars';
  cars.receiveShadow = true;
  P.add(cars);

  // ---------------- pit area ----------------
  const trailerG: THREE.BufferGeometry[] = [], awnG: THREE.BufferGeometry[] = [], stripG: THREE.BufferGeometry[] = [], tentG: THREE.BufferGeometry[] = [];
  const liveries = [0xf2f2f2, 0x15161a, 0xb3121e, 0x0c2d6b, 0xe8b100, 0x2e7d32, 0x5d1f7a, 0xd0d0d0];
  const nT = Math.round(14 * (0.5 + dens * 0.5));
  const lamps: THREE.Vector3[] = [];
  for (let i = 0; i < nT; i++) {
    const row = i % 2, k = Math.floor(i / 2);
    const x = PIT.x0 + 12 + k * 13.5, z = (row ? 1 : -1) * (16 + r() * 6);
    const yaw = (row ? -1 : 1) * (0.25 + r() * 0.2);
    const col = liveries[Math.floor(r() * liveries.length)];
    const tr = tint(new THREE.BoxGeometry(12, 3.6, 2.6), col);
    tr.translate(0, 2.2, 0);
    const cab = tint(new THREE.BoxGeometry(2.4, 2.8, 2.5), 0x222428);
    cab.translate(7.4, 1.8, 0);
    const g = merge([tr, cab]);
    g.rotateY(yaw);
    g.translate(x, 0, z);
    trailerG.push(g);
    // awning on the lane-facing side, a light strip under it, a pop-up tent beside the trailer
    const side = row ? -1 : 1;
    const aw = new THREE.BoxGeometry(9, 0.08, 2.6);
    aw.rotateZ(0);
    aw.translate(0, 3.6, side * 2.6);
    aw.rotateY(yaw);
    aw.translate(x, 0, z);
    awnG.push(tint(aw, 0xe8e8e8));
    const st = new THREE.BoxGeometry(8, 0.05, 0.12);
    st.translate(0, 3.52, side * 3.6);
    st.rotateY(yaw);
    st.translate(x, 0, z);
    stripG.push(st);
    const lp = new THREE.Vector3(0, 0, side * 4).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(new THREE.Vector3(x, 0, z));
    lamps.push(lp);
    if (r() < 0.6) {
      const tc = new THREE.ConeGeometry(2.6, 1.0, 4, 1, true);
      tc.rotateY(Math.PI / 4);
      tc.translate(x + 7, 3.1, z + side * 5);
      const legs = [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]].map(([a, b]) => member(new THREE.Vector3(x + 7 + a, 0, z + side * 5 + b), new THREE.Vector3(x + 7 + a, 2.6, z + side * 5 + b), 0.03, 4));
      tentG.push(tint(tc, [0xc8102e, 0x0a2a8c, 0xffd400, 0x111111][Math.floor(r() * 4)]), ...legs.map((l) => tint(l, 0x888888)));
      lamps.push(new THREE.Vector3(x + 7, 0, z + side * 5));
    }
  }
  const vmat = ctx.std({ vertexColors: true, roughness: 0.45, metalness: 0.3, side: THREE.DoubleSide }, 1);
  mesh(P, merge([...trailerG, ...awnG, ...tentG]), vmat, { name: 'trailers', cast: true });
  mesh(P, merge(stripG), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.4, 4.4) }), { receive: false, name: 'awningLights' });

  // ---------------- lot / pit light poles + baked ground pools ----------------
  const poles: THREE.BufferGeometry[] = [], heads: THREE.BufferGeometry[] = [];
  const sodium = new THREE.Color(1.0, 0.55, 0.22);
  const poolT = ctx.own(poolTexture());
  const poolMat = new THREE.MeshBasicMaterial({ map: poolT, color: sodium.clone().multiplyScalar(0.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  const warmPool = new THREE.MeshBasicMaterial({ map: poolT, color: new THREE.Color(0.55, 0.45, 0.33), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  ctx.own(poolMat); ctx.own(warmPool);
  const pools: THREE.BufferGeometry[] = [], warm: THREE.BufferGeometry[] = [];
  const glowT = ctx.own(glowTexture(64, 0.12));
  const addPole = (x: number, z: number, h: number) => {
    poles.push(member(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, h, z), 0.12, 6));
    heads.push(box(1.0, 0.25, 0.5, x, h, z));
    const pg = new THREE.PlaneGeometry(30, 30);
    pg.rotateX(-Math.PI / 2);
    pg.translate(x, 0.02, z);
    pools.push(pg);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, color: sodium.clone().multiplyScalar(2.2), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    ctx.own(sp.material);
    sp.position.set(x, h - 0.2, z);
    sp.scale.setScalar(4);
    P.add(sp);
  };
  for (let x = PARK.x0 + 20; x < PARK.x1; x += 45) for (const z of [PARK.z0 - 12, PARK.z0 - 37]) addPole(x, z, 11);
  for (let x = PIT.x0 + 15; x < PIT.x1; x += 34) for (const z of [-28, 0, 28]) addPole(x, z, 12);
  for (const lp of lamps) {
    const pg = new THREE.PlaneGeometry(12, 12);
    pg.rotateX(-Math.PI / 2);
    pg.translate(lp.x, 0.025, lp.z);
    warm.push(pg);
  }
  mesh(P, merge(poles), ctx.std({ color: 0x55585e, roughness: 0.5, metalness: 0.7 }, 0.8), { name: 'lotPoles' });
  mesh(P, merge(heads), new THREE.MeshBasicMaterial({ color: sodium.clone().multiplyScalar(8) }), { receive: false, name: 'lotHeads' });
  mesh(P, merge(pools), poolMat, { receive: false, name: 'lotPools' }).renderOrder = 1;
  mesh(P, merge(warm), warmPool, { receive: false, name: 'pitPools' }).renderOrder = 1;
  return { group: P, cars: spots.length };
}
