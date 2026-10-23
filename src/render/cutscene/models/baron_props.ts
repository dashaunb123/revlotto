// Baron von Redline's props: the tach-faced wine glass, YOUR passive card (tears in two), his white racing
// glove (the duel challenge), a flock of bats, and the glove print the slap leaves on the lens.
// Conventions as props.ts: root origin = the grip point, +X forward out of the fist, +Y up, flat faces to +Z.
import * as THREE from 'three';
import { Kit, outlineTree } from './kit';
import type { Prop } from './props';

const OL = 0.011;

function done(kit: Kit, root: THREE.Object3D) {
  return () => {
    root.removeFromParent();
    kit.dispose();
  };
}

/** A stemmed wine glass whose bowl is a TACH: gold bezel, dial ticks, redline arc, needle pinned at red. Red wine inside. */
export function buildTachGlass(): Prop & { setLevel(k: number): void; bowl: THREE.Object3D } {
  const kit = new Kit();
  const root = new THREE.Group();
  root.name = 'prop_tachGlass';
  const glass = kit.toon(0xe8f0ff, { gloss: 1, shine: 120, rim: 1.6 });
  glass.transparent = true;
  glass.opacity = 0.35;
  glass.depthWrite = false;
  const gold = kit.toon(0xf2c230, { gloss: 0.9, shine: 90 });
  const foot = kit.cyl(0.07, 0.075, 0.014, glass, 20, 0);
  foot.position.y = -0.06;
  root.add(foot);
  const stem = kit.cyl(0.011, 0.011, 0.16, glass, 10, 0);
  stem.position.y = 0.02;
  root.add(stem);
  const knot = kit.ball(0.02, gold, 1, 0.7, 1, 10, 0.006);
  knot.position.y = 0.06;
  root.add(knot);
  const bowl = new THREE.Group();
  bowl.position.y = 0.21;
  root.add(bowl);
  const R = 0.12;
  const shellM = kit.ball(R, glass, 1, 1, 0.62, 22, 0);
  shellM.renderOrder = 3;
  bowl.add(shellM);
  // wine: the bottom part of the bowl
  const wineG = new THREE.Group();
  wineG.position.y = -R;
  bowl.add(wineG);
  const wineGeo = new THREE.SphereGeometry(R * 0.94, 24, 14, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.58);
  wineGeo.scale(1, 1, 0.6);
  wineGeo.translate(0, R, 0);
  const wine = kit.mesh(wineGeo, kit.toon(0x8a0618, { gloss: 1, shine: 100, emissive: 0x3a0008, emissiveIntensity: 0.6 }), 0);
  wineG.add(wine);
  const surf = kit.mesh(new THREE.CircleGeometry(R * 0.94 * Math.sin(Math.PI * 0.42), 24), kit.toon(0xb0122a, { gloss: 1 }), 0);
  surf.rotation.x = -Math.PI / 2;
  surf.scale.set(1, 0.6, 1);
  surf.position.y = R + R * 0.94 * Math.cos(Math.PI * 0.42);
  wineG.add(surf);
  // the dial: ticks, numerals, redline arc and needle, floating on the front of the bowl
  const dialTex = kit.canvas(128, 128, (g, w) => {
    const c = w / 2;
    const A0 = Math.PI * 0.75, A1 = Math.PI * 2.25;
    g.lineCap = 'round';
    // redline arc
    g.strokeStyle = 'rgba(255,40,40,0.95)';
    g.lineWidth = 9;
    g.beginPath();
    g.arc(c, c, 52, A0 + (A1 - A0) * 0.8, A1);
    g.stroke();
    for (let i = 0; i <= 18; i++) {
      const a = A0 + ((A1 - A0) * i) / 18;
      const major = i % 2 === 0;
      g.strokeStyle = i >= 15 ? '#ff4040' : '#ffffff';
      g.lineWidth = major ? 4 : 2;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * (major ? 40 : 45), c + Math.sin(a) * (major ? 40 : 45));
      g.lineTo(c + Math.cos(a) * 56, c + Math.sin(a) * 56);
      g.stroke();
    }
    g.fillStyle = '#ffffff';
    g.font = 'bold 13px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let n = 0; n <= 9; n += 3) {
      const a = A0 + ((A1 - A0) * n) / 9;
      g.fillText(String(n), c + Math.cos(a) * 30, c + Math.sin(a) * 30);
    }
    // needle at redline
    const an = A0 + (A1 - A0) * 0.9;
    g.strokeStyle = '#ffdd33';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(c - Math.cos(an) * 8, c - Math.sin(an) * 8);
    g.lineTo(c + Math.cos(an) * 50, c + Math.sin(an) * 50);
    g.stroke();
    g.fillStyle = '#ffdd33';
    g.beginPath();
    g.arc(c, c, 7, 0, Math.PI * 2);
    g.fill();
  }, true);
  const dial = new THREE.Mesh(kit.geo(new THREE.PlaneGeometry(R * 2, R * 2)), kit.own(new THREE.MeshBasicMaterial({ map: dialTex, transparent: true, depthWrite: false })));
  dial.position.z = R * 0.62 + 0.004;
  dial.renderOrder = 4;
  bowl.add(dial);
  const bezel = kit.mesh(new THREE.TorusGeometry(R * 1.0, 0.014, 8, 36), gold, 0.008);
  bezel.position.z = 0.02;
  bowl.add(bezel);
  // glass glints
  const gm = kit.own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
  for (const [x, y, w, hh] of [[-0.06, 0.06, 0.016, 0.07], [-0.035, 0.085, 0.01, 0.03]] as const) {
    const gl = new THREE.Mesh(kit.geo(new THREE.PlaneGeometry(w, hh)), gm);
    gl.position.set(x, y, R * 0.62 + 0.01);
    gl.rotation.z = 0.6;
    gl.renderOrder = 5;
    bowl.add(gl);
  }
  outlineTree(root, kit.outlineMat);
  return {
    root,
    bowl,
    setLevel(k: number) {
      wineG.scale.y = Math.max(0.02, k);
      surf.visible = k > 0.05;
    },
    dispose: done(kit, root),
  };
}

/**
 * YOUR passive card (the rightmost one, slot 5): gold frame, PASSIVE band, a lightning icon, its name. Two halves
 * (halves[0] = left, [1] = right) meeting along a zigzag tear; both halves' origins are the card centre, so
 * move/rotate them apart to tear it. Faces +Z.
 */
export function buildPassiveCard(name = 'SHIFT\nSAVANT'): Prop & { halves: THREE.Group[]; glow: THREE.Mesh } {
  const kit = new Kit();
  const root = new THREE.Group();
  root.name = 'prop_passiveCard';
  const W = 0.36, H = 0.5;
  const tex = kit.canvas(144, 200, (g, w, h) => {
    g.fillStyle = '#f7d23e';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#140a1e';
    g.fillRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#2e2650';
    g.fillRect(9, 9, w - 18, h - 18);
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(9, 9, w - 18, 60);
    // band
    g.fillStyle = '#f7d23e';
    g.fillRect(6, 6, w - 12, 26);
    g.fillStyle = '#140a1e';
    g.font = 'bold 15px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('PASSIVE', w / 2, 20);
    // icon: a lightning bolt in a glowing disc
    const cx = w / 2, cy = 84;
    const gr = g.createRadialGradient(cx, cy, 4, cx, cy, 40);
    gr.addColorStop(0, 'rgba(92,242,255,0.9)');
    gr.addColorStop(1, 'rgba(92,242,255,0)');
    g.fillStyle = gr;
    g.fillRect(cx - 44, cy - 44, 88, 88);
    g.fillStyle = '#fff6a8';
    g.strokeStyle = '#140a1e';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(cx + 6, cy - 32);
    g.lineTo(cx - 16, cy + 4);
    g.lineTo(cx - 2, cy + 4);
    g.lineTo(cx - 8, cy + 32);
    g.lineTo(cx + 16, cy - 6);
    g.lineTo(cx + 2, cy - 6);
    g.closePath();
    g.fill();
    g.stroke();
    // name
    g.fillStyle = '#ffffff';
    g.font = 'bold 17px monospace';
    name.split('\n').forEach((ln, i) => g.fillText(ln, w / 2, 140 + i * 20));
    // slot chip: rightmost
    g.fillStyle = '#ff4fa3';
    g.fillRect(w - 34, h - 30, 24, 18);
    g.fillStyle = '#140a1e';
    g.font = 'bold 13px monospace';
    g.fillText('5', w - 22, h - 20);
    // sheen
    const sh = g.createLinearGradient(0, 0, w, h);
    sh.addColorStop(0.3, 'rgba(255,255,255,0)');
    sh.addColorStop(0.38, 'rgba(255,255,255,0.35)');
    sh.addColorStop(0.46, 'rgba(255,255,255,0)');
    g.fillStyle = sh;
    g.fillRect(0, 0, w, h);
  }, true);
  const face = kit.own(new THREE.MeshToonMaterial({ map: tex, gradientMap: kit.grad }));
  const edge = kit.toon(0xf7d23e);
  // zigzag tear down the middle
  const zig: [number, number][] = [];
  const N = 9;
  for (let i = 0; i <= N; i++) zig.push([(i % 2 ? 1 : -1) * 0.022 + (i === 0 || i === N ? 0 : 0), H / 2 - (H * i) / N]);
  const halves: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const pts: [number, number][] = s < 0 ? [[-W / 2, -H / 2], [-W / 2, H / 2], ...zig] : [[W / 2, H / 2], [W / 2, -H / 2], ...[...zig].reverse()];
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.006, bevelEnabled: false });
    g.translate(0, 0, -0.003);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getX(i) + W / 2) / W, (p.getY(i) + H / 2) / H);
    g.userData.lowPoly = true;
    const m = kit.mesh(g, face, OL);
    m.material = [face, edge];
    const hg = new THREE.Group();
    hg.add(m);
    root.add(hg);
    halves.push(hg);
  }
  // a glow behind it (the card "lifts" out of your hand)
  const glowTex = kit.canvas(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }, true);
  const glow = new THREE.Mesh(kit.geo(new THREE.PlaneGeometry(W * 2.6, H * 2.2)), kit.own(new THREE.MeshBasicMaterial({ map: glowTex, color: 0x5cf2ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })));
  glow.position.z = -0.02;
  root.add(glow);
  outlineTree(root, kit.outlineMat);
  return { root, halves, glow, dispose: done(kit, root) };
}

/** His white racing glove, held by the cuff: origin at the cuff opening, the glove runs along +X. setFlop bends the fingers. */
export function buildGlove(): Prop & { setFlop(k: number): void } {
  const kit = new Kit();
  const root = new THREE.Group();
  root.name = 'prop_glove';
  const white = kit.toon(0xfbfaf6, { gloss: 0.5 });
  const cuff = kit.cyl(0.075, 0.1, 0.12, white, 14, OL);
  cuff.rotation.z = Math.PI / 2;
  cuff.position.x = 0.04;
  root.add(cuff);
  const strap = kit.box(0.04, 0.05, 0.2, 0xd8102a, 0.006);
  strap.position.set(0.05, 0, 0);
  root.add(strap);
  const snap = kit.cyl(0.018, 0.018, 0.012, kit.toon(0xf2c230, { gloss: 1 }), 10, 0.005);
  snap.rotation.x = Math.PI / 2;
  snap.position.set(0.05, 0, 0.105);
  root.add(snap);
  const palm = kit.ball(0.1, white, 1.25, 0.5, 1.0, 16, OL);
  palm.position.x = 0.17;
  root.add(palm);
  const fingers: THREE.Group[] = [];
  for (const [z, L] of [[0.06, 1], [0, 1.08], [-0.06, 0.92]] as const) {
    const f = new THREE.Group();
    f.position.set(0.26, 0, z);
    root.add(f);
    const k1 = kit.mesh(new THREE.CapsuleGeometry(0.034, 0.09 * L, 4, 10), white, OL);
    k1.rotation.z = -Math.PI / 2;
    k1.position.x = 0.055 * L;
    f.add(k1);
    const tip = new THREE.Group();
    tip.position.x = 0.11 * L;
    f.add(tip);
    const k2 = kit.mesh(new THREE.CapsuleGeometry(0.032, 0.06 * L, 4, 10), white, OL);
    k2.rotation.z = -Math.PI / 2;
    k2.position.x = 0.04 * L;
    tip.add(k2);
    fingers.push(f, tip);
  }
  const thumb = new THREE.Group();
  thumb.position.set(0.16, 0, 0.09);
  thumb.rotation.y = -0.8;
  root.add(thumb);
  const th = kit.mesh(new THREE.CapsuleGeometry(0.034, 0.07, 4, 10), white, OL);
  th.rotation.z = -Math.PI / 2;
  th.position.x = 0.05;
  thumb.add(th);
  // seam stitches on the back
  for (let i = 0; i < 3; i++) {
    const st = kit.box(0.09, 0.008, 0.008, 0xd8d0c8, 0);
    st.position.set(0.18, 0.052, -0.04 + i * 0.04);
    root.add(st);
  }
  outlineTree(root, kit.outlineMat);
  return {
    root,
    setFlop(k: number) {
      for (let i = 0; i < fingers.length; i++) fingers[i].rotation.z = -k * (i % 2 ? 0.7 : 0.45);
      thumb.rotation.z = -k * 0.4;
    },
    dispose: done(kit, root),
  };
}

export interface Bat {
  root: THREE.Group;
  wings: THREE.Group[];
  phase: number;
}

/** n bats (forward +Z, wings out along X). flap(t) beats every wing. */
export function buildBats(n: number): Prop & { bats: Bat[]; flap(t: number, speed?: number): void } {
  const kit = new Kit();
  const root = new THREE.Group();
  root.name = 'prop_bats';
  const body = kit.toon(0x2a1a34, { gloss: 0.4, rim: 1.5 });
  const wingM = kit.toon(0x3a2248, { side: THREE.DoubleSide, gloss: 0.2, rim: 1.5 });
  const eye = kit.own(new THREE.MeshBasicMaterial({ color: 0xff2030 }));
  // scalloped wing (right side), in the XZ plane
  const ws = new THREE.Shape();
  ws.moveTo(0, 0.04);
  ws.lineTo(0.12, 0.08);
  ws.lineTo(0.3, 0.05);
  ws.quadraticCurveTo(0.26, -0.02, 0.22, -0.07);
  ws.quadraticCurveTo(0.18, -0.02, 0.14, -0.08);
  ws.quadraticCurveTo(0.1, -0.02, 0.05, -0.07);
  ws.lineTo(0, -0.04);
  const wgR = kit.geo(new THREE.ShapeGeometry(ws, 6));
  wgR.rotateX(-Math.PI / 2);
  wgR.userData.lowPoly = true;
  const bats: Bat[] = [];
  for (let i = 0; i < n; i++) {
    const b = new THREE.Group();
    const bb = kit.ball(0.05, body, 0.9, 0.8, 1.3, 10, 0.008);
    b.add(bb);
    const hd = kit.ball(0.038, body, 1, 1, 1, 10, 0.008);
    hd.position.set(0, 0.02, 0.065);
    b.add(hd);
    for (const s of [-1, 1]) {
      const ear = kit.mesh(new THREE.ConeGeometry(0.016, 0.05, 6), body, 0.006);
      ear.position.set(s * 0.02, 0.06, 0.06);
      ear.rotation.z = -s * 0.3;
      b.add(ear);
      const e = new THREE.Mesh(kit.geo(new THREE.SphereGeometry(0.009, 6, 4)), eye);
      e.position.set(s * 0.015, 0.03, 0.098);
      b.add(e);
    }
    const wings: THREE.Group[] = [];
    for (const s of [-1, 1]) {
      const w = new THREE.Group();
      w.position.set(s * 0.03, 0.01, 0);
      w.scale.x = s;
      w.add(new THREE.Mesh(wgR, wingM));
      b.add(w);
      wings.push(w);
    }
    root.add(b);
    bats.push({ root: b, wings, phase: i * 2.399 });
  }
  outlineTree(root, kit.outlineMat);
  return {
    root,
    bats,
    flap(t: number, speed = 22) {
      for (const b of bats) {
        const a = Math.sin(t * speed + b.phase);
        b.wings[0].rotation.z = -a * 0.9;
        b.wings[1].rotation.z = a * 0.9;
      }
    },
    dispose: done(kit, root),
  };
}

/** The slap's glove print on the lens: a pink-red three-finger cartoon glove print with smack lines (canvas texture). */
export function gloveprintTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.translate(128, 140);
  g.rotate(-0.35);
  const fill = (col: string, grow: number) => {
    g.fillStyle = col;
    g.beginPath();
    g.ellipse(0, 20, 52 + grow, 46 + grow, 0, 0, Math.PI * 2);
    g.fill();
    for (const [x, len] of [[-34, 78], [0, 92], [34, 74]]) {
      g.beginPath();
      g.ellipse(x, -40 - len / 2 + 20, 17 + grow, len / 2 + grow, x * 0.004, 0, Math.PI * 2);
      g.fill();
    }
    g.beginPath();
    g.ellipse(64, 30, 16 + grow, 34 + grow, -0.9, 0, Math.PI * 2);
    g.fill();
  };
  fill('rgba(255,90,120,0.55)', 10);
  fill('rgba(255,40,80,0.85)', 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.strokeStyle = 'rgba(255,240,240,0.9)';
  g.lineWidth = 6;
  g.lineCap = 'round';
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * 0.9 + i * 0.3;
    g.beginPath();
    g.moveTo(128 + Math.cos(a) * 112, 140 + Math.sin(a) * 104);
    g.lineTo(128 + Math.cos(a) * 126, 140 + Math.sin(a) * 118);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
