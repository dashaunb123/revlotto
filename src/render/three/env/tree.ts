// The Christmas tree: pole, housing, per-lane pre-stage / stage bulbs, 3 ambers, green and red with LED-cluster
// lenses, visors, glow sprites and (medium/high) a real point light per column so the tree tints the cars.
import * as THREE from 'three';
import type { Ctx } from './ctx';
import { mesh } from './ctx';
import { box, merge } from './geo';
import { TREE_X } from './layout';
import { glowTexture, signTexture } from './textures';

export interface TreeState {
  /** 0-3 ambers lit, 4 green (the sim's SimState.lights). */
  lights: number;
  /** Red-light on the player's lane (or `redLane`). */
  falseStart?: boolean;
  /** Decoy Tree's fake flash (lime green lamp before the real green). */
  decoy?: boolean;
  /** Pre-stage / stage bulbs per lane [player, ghost]: 0 none, 1 pre-staged, 2 staged. Default [2, 2]. */
  staged?: [number, number];
  redLane?: 'player' | 'ghost' | 'both';
}

const AMBER = new THREE.Color(1.0, 0.42, 0.04);
const GREEN = new THREE.Color(0.12, 1.0, 0.25);
const RED = new THREE.Color(1.0, 0.04, 0.03);
const STAGE = new THREE.Color(1.0, 0.86, 0.55);
const DECOY = new THREE.Color(0xc8ff3a);

function ledTexture(n = 128): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, n, n);
  const rg = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  rg.addColorStop(0, 'rgba(255,255,255,0.55)');
  rg.addColorStop(0.85, 'rgba(255,255,255,0.18)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg;
  g.fillRect(0, 0, n, n);
  const s = n / 11;
  for (let row = -6; row <= 6; row++) {
    for (let col = -6; col <= 6; col++) {
      const x = n / 2 + (col + (row & 1 ? 0.5 : 0)) * s, y = n / 2 + row * s * 0.87;
      if (Math.hypot(x - n / 2, y - n / 2) > n * 0.44) continue;
      const dg = g.createRadialGradient(x, y, 0, x, y, s * 0.5);
      dg.addColorStop(0, 'rgba(255,255,255,1)');
      dg.addColorStop(0.5, 'rgba(255,255,255,0.8)');
      dg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = dg;
      g.beginPath();
      g.arc(x, y, s * 0.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Lamp { mat: THREE.MeshStandardMaterial; glow: THREE.Sprite; color: THREE.Color; level: number; target: number; pop: number; base: number; col: number }

export function buildTree(ctx: Ctx) {
  const G = new THREE.Group();
  G.name = 'christmasTree';
  G.position.set(TREE_X, 0, 0);
  ctx.group.add(G);
  const face = -0.11; // lamp face plane (local x)
  const body = ctx.std({ color: 0x15161a, roughness: 0.45, metalness: 0.4 }, 1);
  const pole = ctx.std({ color: 0x3a3d42, roughness: 0.35, metalness: 0.8 }, 1);
  const yellow = ctx.std({ color: 0xf2c200, roughness: 0.5 }, 0.6);
  // base, pole, control box
  mesh(G, merge([box(0.7, 0.05, 0.7, 0, 0.025, 0), box(0.14, 1.3, 0.14, 0, 0.68, 0), box(0.26, 0.42, 0.3, 0.12, 0.26, 0)]), pole, { cast: true });
  // housing: main body, side rails, back cap, the centre stripe
  mesh(G, merge([
    box(0.2, 1.55, 0.64, 0, 2.03, 0),
    box(0.24, 0.06, 0.7, -0.01, 1.24, 0),
    box(0.24, 0.06, 0.7, -0.01, 2.82, 0),
    box(0.24, 1.6, 0.04, -0.01, 2.03, 0.33),
    box(0.24, 1.6, 0.04, -0.01, 2.03, -0.33),
  ]), body, { cast: true });
  mesh(G, box(0.01, 1.48, 0.035, face - 0.004, 2.03, 0), yellow);
  // top sign
  const st = ctx.own(signTexture([{ text: 'REVLOTTO', size: 0.6, color: '#ffd23f' }], 256, 64, '#0b0b10', { border: '#ff3b30', aniso: ctx.cfg.aniso }));
  const sm = ctx.std({ map: st, emissiveMap: st, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.4 }, 0.5);
  mesh(G, box(0.12, 0.26, 0.86, 0, 3.0, 0), body, { cast: true });
  const signG = new THREE.PlaneGeometry(0.84, 0.22);
  signG.rotateY(-Math.PI / 2);
  signG.translate(-0.065, 3.0, 0);
  mesh(G, signG, sm);
  // lane labels under the columns
  const lt = ctx.own(signTexture([{ text: 'L   R', size: 0.7, color: '#ffffff' }], 128, 48, '#15161a', { aniso: ctx.cfg.aniso }));
  void lt;

  const led = ctx.own(ledTexture());
  const glowT = ctx.own(glowTexture(128, 0.1));
  const lamps: Lamp[] = [];
  const rows = { pre: 2.68, stage: 2.55, amber: [2.31, 2.09, 1.87], green: 1.65, red: 1.43 };
  const cols = [0.165, -0.165]; // player (+Z), ghost (-Z)
  const visorG: THREE.BufferGeometry[] = [], ringG: THREE.BufferGeometry[] = [];
  const lens = (r: number) => {
    const g = new THREE.SphereGeometry(r, 20, 8, 0, Math.PI * 2, 0, 0.55);
    g.rotateZ(Math.PI / 2); // dome faces -X
    const uv = g.getAttribute('uv') as THREE.BufferAttribute;
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5 + p.getZ(i) / (2 * r * 0.53), 0.5 + p.getY(i) / (2 * r * 0.53));
    g.translate(face + r * Math.cos(0.55) - 0.005, 0, 0);
    return g;
  };
  const bigLens = lens(0.085), smallLens = lens(0.042);
  const mkLamp = (y: number, z: number, color: THREE.Color, big: boolean, col: number) => {
    const r = big ? 0.085 : 0.042;
    const m = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.12), emissive: color, emissiveMap: led, emissiveIntensity: 0, roughness: 0.12, metalness: 0 });
    m.userData.envK = 1.4;
    ctx.envMats.push(m);
    ctx.own(m);
    const lm = new THREE.Mesh(big ? bigLens : smallLens, m);
    lm.position.set(0, y, z);
    G.add(lm);
    // trim ring + visor (a half tube over the top of the lamp)
    const ring = new THREE.CylinderGeometry(r * 1.18, r * 1.18, 0.03, 18, 1, true);
    ring.rotateZ(Math.PI / 2);
    ring.translate(face - 0.012, y, z);
    ringG.push(ring);
    const vis = new THREE.CylinderGeometry(r * 1.2, r * 1.2, big ? 0.13 : 0.06, 14, 1, true, 0, Math.PI);
    vis.rotateZ(Math.PI / 2);
    vis.translate(face - (big ? 0.065 : 0.03), y, z);
    visorG.push(vis);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    ctx.own(sp.material);
    const base = big ? 0.75 : 0.32;
    sp.scale.setScalar(base);
    sp.position.set(face - 0.06, y, z);
    sp.renderOrder = 5;
    G.add(sp);
    const l: Lamp = { mat: m, glow: sp, color: color.clone(), level: 0, target: 0, pop: 0, base, col };
    lamps.push(l);
    return l;
  };
  type ColLamps = { pre: Lamp[]; stage: Lamp[]; amber: Lamp[]; green: Lamp; red: Lamp };
  const C: ColLamps[] = cols.map((z, ci) => ({
    pre: [mkLamp(rows.pre, z - 0.06, STAGE, false, ci), mkLamp(rows.pre, z + 0.06, STAGE, false, ci)],
    stage: [mkLamp(rows.stage, z - 0.06, STAGE, false, ci), mkLamp(rows.stage, z + 0.06, STAGE, false, ci)],
    amber: rows.amber.map((y) => mkLamp(y, z, AMBER, true, ci)),
    green: mkLamp(rows.green, z, GREEN, true, ci),
    red: mkLamp(rows.red, z, RED, true, ci),
  }));
  mesh(G, merge(visorG), body, { cast: true });
  mesh(G, merge(ringG), pole);
  ctx.own(bigLens); ctx.own(smallLens);

  // real lights that throw the tree's colour onto the cars and the pad
  const pl: THREE.PointLight[] = [];
  if (ctx.cfg.treeLights) {
    for (const z of cols) {
      const p = new THREE.PointLight(0xffffff, 0, 18, 2);
      p.position.set(-3.2, 1.7, z * 8);
      G.add(p);
      pl.push(p);
    }
  }

  let decoyCol: THREE.Color | null = null;
  const set = (s: TreeState) => {
    const staged = s.staged ?? [2, 2];
    const redL = s.redLane ?? 'player';
    C.forEach((c, ci) => {
      c.pre.forEach((l) => (l.target = staged[ci] >= 1 ? 1 : 0));
      c.stage.forEach((l) => (l.target = staged[ci] >= 2 ? 1 : 0));
      c.amber.forEach((l, i) => (l.target = s.lights > i && s.lights < 4 ? 1 : 0));
      const red = !!s.falseStart && (redL === 'both' || (redL === 'player' ? ci === 0 : ci === 1));
      const decoy = !!s.decoy && s.lights < 4;
      c.green.color.copy(decoy ? DECOY : GREEN);
      c.green.mat.emissive.copy(c.green.color);
      (c.green.glow.material as THREE.SpriteMaterial).color.copy(c.green.color);
      c.green.target = decoy || (s.lights >= 4 && !red) ? 1 : 0;
      c.red.target = red ? 1 : 0;
    });
    decoyCol = s.decoy ? DECOY : null;
  };
  set({ lights: 0, staged: [0, 0] });

  const tmp = new THREE.Color();
  ctx.updaters.push((dt) => {
    for (const l of lamps) {
      if (l.target > l.level) {
        if (l.level < 0.05) l.pop = 1;
        l.level = Math.min(l.target, l.level + dt * 45);
      } else l.level = Math.max(l.target, l.level - dt * 22);
      l.pop = Math.max(0, l.pop - dt * 4.5);
      const big = l.base > 0.5;
      l.mat.emissiveIntensity = 0.02 + l.level * (big ? 12 : 6);
      const sm = l.glow.material as THREE.SpriteMaterial;
      sm.opacity = l.level * (0.7 + l.pop * 0.6);
      l.glow.scale.setScalar(l.base * (1 + l.pop * 0.9));
    }
    pl.forEach((p, ci) => {
      tmp.setRGB(0, 0, 0);
      let k = 0;
      const c = C[ci];
      for (const l of [...c.amber, c.green, c.red]) {
        tmp.r += l.color.r * l.level; tmp.g += l.color.g * l.level; tmp.b += l.color.b * l.level;
        k += l.level;
      }
      if (k > 0) tmp.multiplyScalar(1 / k);
      p.color.copy(tmp);
      p.intensity = Math.min(1.5, k) * 14;
    });
    void decoyCol;
  });

  return { group: G, set };
}
