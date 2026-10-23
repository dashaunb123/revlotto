// Vera's hand mirror: a pink oval vanity mirror with a silver handle. The glass is a live canvas: her shimmering
// "flattering" reflection, or the SNEERING MONSTER that is the truth, with cracks spreading across it, and it can
// shatter into shards (UV-mapped pieces of the same picture) that the scene flings at the lens.
//
// Prop space (props.ts conventions): origin = the grip, the handle runs up +Y out of the thumb side, the glass faces +Z,
// the ornate pink back faces -Z.
import * as THREE from 'three';
import { Kit, outlineTree } from './kit';
import type { Prop } from './props';

export type Reflection = 'self' | 'monster';

export interface HandMirror extends Prop {
  /** The glass's centre (prop space y = HEAD_Y), for aiming / framing. */
  glass: THREE.Object3D;
  /** The mirror head (frame + glass + back) without the handle. */
  head: THREE.Object3D;
  setReflection(r: Reflection): void;
  /** Monster snarl 0..1 (the jaw drops, the eyes narrow). */
  setSnarl(k: number): void;
  /** Cracks spreading from the impact point, 0..1. */
  setCrack(k: number): void;
  /** Hides the glass and returns its shards (meshes under `head`, in glass space) for the scene to fling. */
  shatter(): THREE.Mesh[];
  /** Puts the glass back (seek / replay). */
  reset(): void;
}

const HEAD_Y = 0.46;
const RX = 0.2, RY = 0.25; // glass ellipse radii
const OL = 0.011;
const INKC = '#140a1e';

function hash(n: number) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** The flattering reflection: chrome shimmer with pink light and glints. */
function drawSelf(g: CanvasRenderingContext2D, w: number, h: number) {
  const gr = g.createLinearGradient(0, 0, w, h);
  gr.addColorStop(0, '#fbe9ff');
  gr.addColorStop(0.35, '#c9cfe6');
  gr.addColorStop(0.6, '#ff9fd0');
  gr.addColorStop(1, '#8f8fb8');
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (const [x, ww] of [[0.18, 0.12], [0.38, 0.05], [0.62, 0.03]]) {
    g.beginPath();
    g.moveTo(w * x, h);
    g.lineTo(w * (x + ww), h);
    g.lineTo(w * (x + ww + 0.45), 0);
    g.lineTo(w * (x + 0.45), 0);
    g.closePath();
    g.fill();
  }
}

/** The truth: a sneering swamp-green hag version of Vera. `sn` = snarl 0..1. */
function drawMonster(g: CanvasRenderingContext2D, w: number, h: number, sn: number) {
  const bg = g.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w * 0.75);
  bg.addColorStop(0, '#5a1a4a');
  bg.addColorStop(1, '#12051a');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  const cx = w / 2, cy = h * 0.56;
  const ink = (lw = 7) => {
    g.strokeStyle = INKC;
    g.lineWidth = lw;
    g.stroke();
  };
  // frizzed hair: silver spikes with a pink streak
  for (let i = 0; i < 17; i++) {
    const a = Math.PI * (1.02 + (i / 16) * 0.96);
    const r0 = w * 0.3, r1 = w * (0.5 + 0.12 * hash(i));
    g.beginPath();
    g.moveTo(cx + Math.cos(a - 0.16) * r0, cy - h * 0.1 + Math.sin(a - 0.16) * r0);
    g.lineTo(cx + Math.cos(a) * r1, cy - h * 0.1 + Math.sin(a) * r1 * 1.1);
    g.lineTo(cx + Math.cos(a + 0.16) * r0, cy - h * 0.1 + Math.sin(a + 0.16) * r0);
    g.closePath();
    g.fillStyle = i === 6 || i === 7 ? '#ff4fa3' : '#d9dbe8';
    g.fill();
    ink(5);
  }
  // face: lumpy green
  g.beginPath();
  g.ellipse(cx, cy, w * 0.34, h * 0.33, 0, 0, Math.PI * 2);
  g.fillStyle = '#7fae4a';
  g.fill();
  ink(8);
  // warts
  for (const [x, y, r] of [[-0.2, 0.08, 9], [0.22, -0.02, 6], [0.05, 0.25, 5]]) {
    g.beginPath();
    g.arc(cx + x * w, cy + y * h, r, 0, Math.PI * 2);
    g.fillStyle = '#5f8a32';
    g.fill();
    ink(3);
  }
  // furious brows
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(cx + s * w * 0.04, cy - h * 0.1 + sn * 4);
    g.lineTo(cx + s * w * 0.3, cy - h * 0.2);
    g.lineTo(cx + s * w * 0.28, cy - h * 0.24);
    g.lineTo(cx + s * w * 0.03, cy - h * 0.15 + sn * 4);
    g.closePath();
    g.fillStyle = '#3a1a2a';
    g.fill();
    ink(4);
  }
  // yellow eyes, red slit pupils
  for (const s of [-1, 1]) {
    const ex = cx + s * w * 0.15, ey = cy - h * 0.05;
    g.beginPath();
    g.ellipse(ex, ey, w * 0.1, h * (0.065 - 0.02 * sn), s * 0.25, 0, Math.PI * 2);
    g.fillStyle = '#ffe23a';
    g.fill();
    ink(6);
    g.beginPath();
    g.ellipse(ex + s * 3, ey, 4, h * (0.05 - 0.015 * sn), 0, 0, Math.PI * 2);
    g.fillStyle = '#e0102a';
    g.fill();
  }
  // hooked nose
  g.beginPath();
  g.moveTo(cx - 4, cy - h * 0.02);
  g.quadraticCurveTo(cx + w * 0.12, cy + h * 0.08, cx + w * 0.02, cy + h * 0.13);
  g.quadraticCurveTo(cx - w * 0.04, cy + h * 0.12, cx - 6, cy + h * 0.06);
  g.fillStyle = '#6e9c3c';
  g.fill();
  ink(5);
  // huge lopsided sneer with fangs, lipstick on (of course)
  const my = cy + h * 0.2, mwid = w * 0.24, open = h * (0.06 + 0.07 * sn);
  g.beginPath();
  g.moveTo(cx - mwid, my - 6);
  g.quadraticCurveTo(cx, my - 14, cx + mwid, my - 26);
  g.quadraticCurveTo(cx + mwid * 0.4, my + open * 1.4, cx - mwid, my - 6);
  g.fillStyle = '#2a0614';
  g.fill();
  g.strokeStyle = '#ff2f8f';
  g.lineWidth = 9;
  g.stroke();
  ink(3);
  g.fillStyle = '#fff6dc';
  for (let i = 0; i < 6; i++) {
    const u = (i + 0.5) / 6, x = cx - mwid + u * mwid * 2, yt = my - 6 - u * 18;
    const len = i === 1 || i === 4 ? 22 + sn * 8 : 9;
    g.beginPath();
    g.moveTo(x - 7, yt);
    g.lineTo(x + 7, yt - 1);
    g.lineTo(x, yt + len);
    g.closePath();
    g.fill();
    g.strokeStyle = INKC;
    g.lineWidth = 2;
    g.stroke();
  }
  // tarnish vignette so it still reads as a mirror
  const v = g.createRadialGradient(cx, h / 2, w * 0.3, cx, h / 2, w * 0.7);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(20,0,20,0.6)');
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
}

/** Cracks radiating from (ix, iy) (canvas px). */
function drawCracks(g: CanvasRenderingContext2D, w: number, h: number, k: number, ix: number, iy: number) {
  if (k <= 0) return;
  g.lineCap = 'round';
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + hash(i) * 0.4;
    const L = (0.35 + 0.5 * hash(i + 9)) * w * 1.1 * Math.min(1, k * (1 + hash(i + 3)));
    let x = ix, y = iy;
    g.beginPath();
    g.moveTo(x, y);
    const n = 5;
    for (let j = 1; j <= n; j++) {
      const aa = a + (hash(i * 7 + j) - 0.5) * 0.7;
      x += (Math.cos(aa) * L) / n;
      y += (Math.sin(aa) * L) / n;
      g.lineTo(x, y);
    }
    g.strokeStyle = 'rgba(20,10,30,0.9)';
    g.lineWidth = 4;
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = 1.5;
    g.stroke();
  }
  // impact star
  g.beginPath();
  g.arc(ix, iy, 6 + 8 * k, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.fill();
}

export function buildHandMirror(): HandMirror {
  const kit = new Kit();
  const root = new THREE.Group();
  root.name = 'handMirror';
  const pink = kit.toon(0xff4fa3, { gloss: 0.9, shine: 70 });
  const pinkDark = kit.toon(0xc72a7c, { gloss: 0.6 });
  const silver = kit.toon(0xdfe3f0, { gloss: 1, shine: 90 });

  // handle: silver shaft with pink rings and a pearl knob
  const shaft = kit.cyl(0.032, 0.026, 0.3, silver, 12, OL);
  shaft.position.y = 0.06;
  root.add(shaft);
  for (const y of [-0.08, 0.17]) {
    const ring = kit.cyl(0.042, 0.042, 0.035, pink, 12, OL);
    ring.position.y = y;
    root.add(ring);
  }
  const knob = kit.ball(0.05, kit.toon(0xfff0f8, { gloss: 1, shine: 90 }), 1, 1, 1, 14, OL);
  knob.position.y = -0.12;
  root.add(knob);

  const head = new THREE.Group();
  head.position.y = HEAD_Y;
  root.add(head);
  // frame: a fat pink oval ring with a scalloped heart crest on top
  const frameShape = new THREE.Shape();
  frameShape.absellipse(0, 0, RX + 0.05, RY + 0.05, 0, Math.PI * 2, false, 0);
  const hole = new THREE.Path();
  hole.absellipse(0, 0, RX, RY, 0, Math.PI * 2, true, 0);
  frameShape.holes.push(hole);
  const fg = new THREE.ExtrudeGeometry(frameShape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.012, bevelSegments: 2, curveSegments: 40 });
  fg.translate(0, 0, -0.02);
  head.add(kit.mesh(fg, pink, OL));
  // pearls round the frame
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const p = kit.ball(0.017, kit.toon(0xfff4fb, { gloss: 1, shine: 90 }), 1, 1, 1, 8, 0);
    p.position.set(Math.cos(a) * (RX + 0.028), Math.sin(a) * (RY + 0.028), 0.04);
    head.add(p);
  }
  // heart crest
  const heart = new THREE.Shape();
  heart.moveTo(0, -0.05);
  heart.bezierCurveTo(0.09, 0.0, 0.06, 0.07, 0, 0.04);
  heart.bezierCurveTo(-0.06, 0.07, -0.09, 0.0, 0, -0.05);
  const hg = new THREE.ExtrudeGeometry(heart, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 2 });
  hg.translate(0, 0, -0.015);
  const crest = kit.mesh(hg, pinkDark, OL);
  crest.position.y = RY + 0.08;
  head.add(crest);
  // ornate back: pink disc + a silver "V"
  const backG = new THREE.ShapeGeometry(new THREE.Shape().absellipse(0, 0, RX + 0.01, RY + 0.01, 0, Math.PI * 2, false, 0), 32);
  const back = kit.mesh(backG, pinkDark, 0);
  back.rotation.y = Math.PI;
  back.position.z = -0.022;
  head.add(back);
  const vShape = new THREE.Shape([new THREE.Vector2(-0.1, 0.1), new THREE.Vector2(-0.05, 0.1), new THREE.Vector2(0, -0.02), new THREE.Vector2(0.05, 0.1), new THREE.Vector2(0.1, 0.1), new THREE.Vector2(0, -0.12)]);
  const vm = kit.mesh(new THREE.ShapeGeometry(vShape), silver, 0);
  vm.rotation.y = Math.PI;
  vm.position.z = -0.026;
  head.add(vm);

  // glass: canvas picture
  const CW = 256, CH = 320;
  const cv = document.createElement('canvas');
  cv.width = CW;
  cv.height = CH;
  const g = cv.getContext('2d')!;
  const tex = kit.tex(new THREE.CanvasTexture(cv));
  tex.colorSpace = THREE.SRGBColorSpace;
  const glassMat = kit.own(new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false }));
  const glassGeo = new THREE.ShapeGeometry(new THREE.Shape().absellipse(0, 0, RX, RY, 0, Math.PI * 2, false, 0), 40);
  {
    const p = glassGeo.attributes.position, uv = glassGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / (2 * RX) + 0.5, p.getY(i) / (2 * RY) + 0.5);
  }
  const glassM = new THREE.Mesh(kit.geo(glassGeo), glassMat);
  glassM.position.z = 0.012;
  head.add(glassM);
  const glass = new THREE.Object3D();
  glass.position.z = 0.012;
  head.add(glass);

  let refl: Reflection = 'self', snarl = 0, crack = 0, dirty = true;
  const IX = CW * 0.56, IY = CH * 0.4; // impact point (canvas px)
  const redraw = () => {
    if (!dirty) return;
    dirty = false;
    if (refl === 'self') drawSelf(g, CW, CH);
    else drawMonster(g, CW, CH, snarl);
    drawCracks(g, CW, CH, crack, IX, IY);
    tex.needsUpdate = true;
  };
  redraw();
  glassM.onBeforeRender = redraw;

  // shards: radial wedges from the impact point, split into an inner and an outer ring, clipped to the ellipse
  const shards: THREE.Mesh[] = [];
  {
    const c = new THREE.Vector2((IX / CW - 0.5) * 2 * RX, (0.5 - IY / CH) * 2 * RY);
    const N = 11;
    const angs: number[] = [];
    for (let i = 0; i < N; i++) angs.push(((i + 0.3 * (hash(i + 50) - 0.5)) / N) * Math.PI * 2);
    // ray from c at angle a to the ellipse
    const edge = (a: number) => {
      const dx = Math.cos(a), dy = Math.sin(a);
      const A = (dx * dx) / (RX * RX) + (dy * dy) / (RY * RY);
      const B = 2 * ((c.x * dx) / (RX * RX) + (c.y * dy) / (RY * RY));
      const C = (c.x * c.x) / (RX * RX) + (c.y * c.y) / (RY * RY) - 1;
      const t = (-B + Math.sqrt(B * B - 4 * A * C)) / (2 * A);
      return new THREE.Vector2(c.x + dx * t, c.y + dy * t);
    };
    for (let i = 0; i < N; i++) {
      const a0 = angs[i], a1 = i + 1 < N ? angs[i + 1] : angs[0] + Math.PI * 2;
      const split = 0.35 + 0.25 * hash(i + 70);
      const outer: THREE.Vector2[] = [];
      const steps = 5;
      for (let s = 0; s <= steps; s++) outer.push(edge(a0 + ((a1 - a0) * s) / steps));
      const inner = outer.map((p) => c.clone().lerp(p, split + 0.1 * (hash(i * 3 + 1) - 0.5)));
      const polys: THREE.Vector2[][] = [
        [c.clone(), ...inner],
        [...outer, ...inner.slice().reverse()],
      ];
      for (const poly of polys) {
        if (poly.length < 3) continue;
        const cen = poly.reduce((acc, p) => acc.add(p), new THREE.Vector2()).divideScalar(poly.length);
        const sg = new THREE.ShapeGeometry(new THREE.Shape(poly.map((p) => p.clone().sub(cen))));
        const p = sg.attributes.position, uv = sg.attributes.uv;
        for (let k = 0; k < p.count; k++) uv.setXY(k, (p.getX(k) + cen.x) / (2 * RX) + 0.5, (p.getY(k) + cen.y) / (2 * RY) + 0.5);
        const m = new THREE.Mesh(kit.geo(sg), glassMat);
        m.position.set(cen.x, cen.y, 0.014);
        m.userData.home = m.position.clone();
        m.visible = false;
        head.add(m);
        shards.push(m);
      }
    }
  }

  outlineTree(root, kit.outlineMat);
  return {
    root,
    glass,
    head,
    setReflection(r) {
      if (r !== refl) (refl = r), (dirty = true);
    },
    setSnarl(k) {
      const q = Math.round(Math.max(0, Math.min(1, k)) * 8) / 8;
      if (q !== snarl) (snarl = q), (dirty = refl === 'monster' || dirty);
    },
    setCrack(k) {
      const q = Math.round(Math.max(0, Math.min(1, k)) * 12) / 12;
      if (q !== crack) (crack = q), (dirty = true);
    },
    shatter() {
      redraw();
      glassM.visible = false;
      back.visible = vm.visible = false; // an empty frame: you can see right through it
      for (const s of shards) s.visible = true;
      return shards;
    },
    reset() {
      glassM.visible = true;
      back.visible = vm.visible = true;
      for (const s of shards) {
        if (s.parent !== head) head.add(s);
        s.position.copy(s.userData.home);
        s.rotation.set(0, 0, 0);
        s.scale.setScalar(1);
        s.visible = false;
      }
    },
    dispose() {
      root.removeFromParent();
      for (const s of shards) s.removeFromParent();
      kit.dispose();
    },
  };
}
