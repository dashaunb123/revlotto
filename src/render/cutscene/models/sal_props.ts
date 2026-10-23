// Shortstack Sal's props: the phone books he stands on, and his comically tiny gearstick.
// Same conventions as props.ts: root origin = the prop's base / grip, dispose() frees everything.
import * as THREE from 'three';
import { Kit, outlineTree } from './kit';
import type { Prop } from './props';

const OL = 0.012;

export interface PhoneBookStyle {
  cover: number;
  ink: string;
  title: string;
  w: number;
  h: number;
  d: number;
}

export const BOOK_STYLES: PhoneBookStyle[] = [
  { cover: 0xf2c230, ink: '#141018', title: 'YELLOW\nPAGES', w: 0.95, h: 0.2, d: 0.68 },
  { cover: 0xf4f2ea, ink: '#1f4fb8', title: 'WHITE\nPAGES', w: 0.9, h: 0.17, d: 0.64 },
  { cover: 0x2f6ad8, ink: '#ffffff', title: 'PHONE\nBOOK', w: 0.92, h: 0.22, d: 0.66 },
  { cover: 0xf2c230, ink: '#141018', title: 'YELLOW\nPAGES', w: 0.86, h: 0.18, d: 0.62 },
  { cover: 0xe0412c, ink: '#ffffff', title: 'CITY\nDIRECTORY', w: 0.94, h: 0.2, d: 0.67 },
];

/** A fat phone book lying flat. Origin at the bottom centre; the title faces +Y and its spine is at -Z. */
export function buildPhoneBook(st: PhoneBookStyle): Prop {
  const kit = new Kit();
  const root = new THREE.Group();
  root.name = 'phoneBook';
  const { w, h, d } = st;
  const cover = kit.toon(st.cover, { gloss: 0.5 });
  const pages = kit.toon(0xf6f0dc, { gloss: 0 });
  const lines = kit.canvas(64, 16, (g, cw, ch) => {
    g.fillStyle = '#f6f0dc';
    g.fillRect(0, 0, cw, ch);
    g.fillStyle = '#c9bfa2';
    for (let y = 1; y < ch; y += 2) g.fillRect(0, y, cw, 1);
  });
  const pageLines = kit.toon(0xffffff, { gloss: 0 });
  pageLines.map = lines;
  // the page block, a touch inset, with page lines on the three open edges
  const block = kit.box(w - 0.04, h - 0.05, d - 0.03, pages, OL);
  (block as THREE.Mesh).material = [pageLines, pageLines, pages, pages, pageLines, pageLines];
  block.position.set(0.01, h / 2, 0.01);
  root.add(block);
  // covers + spine
  const top = kit.box(w, 0.03, d, cover, OL);
  top.position.y = h - 0.015;
  root.add(top);
  const bot = kit.box(w, 0.03, d, cover, OL);
  bot.position.y = 0.015;
  root.add(bot);
  const spine = kit.cyl(h / 2, h / 2, w, cover, 12, OL);
  spine.rotation.z = Math.PI / 2;
  spine.scale.set(1, 1, 0.35);
  spine.position.set(0, h / 2, -d / 2 + 0.01);
  root.add(spine);
  // the title on the cover
  const tex = kit.canvas(128, 96, (g, cw, ch) => {
    g.clearRect(0, 0, cw, ch);
    g.fillStyle = st.ink;
    g.font = 'bold 26px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const ls = st.title.split('\n');
    ls.forEach((l, i) => g.fillText(l, cw / 2, ch / 2 + (i - (ls.length - 1) / 2) * 30, cw - 8));
    g.fillRect(14, ch - 12, cw - 28, 4);
  }, true);
  const lab = new THREE.Mesh(kit.geo(new THREE.PlaneGeometry(w * 0.8, d * 0.7)), kit.own(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })));
  lab.rotation.x = -Math.PI / 2;
  lab.position.y = h + 0.002;
  root.add(lab);
  outlineTree(root, kit.outlineMat);
  return {
    root,
    update() {},
    dispose() {
      root.removeFromParent();
      kit.dispose();
    },
  };
}

/**
 * The world's smallest gearstick: a chrome pencil of a lever on a little rubber boot, a glossy black knob with a
 * white shift pattern. Origin = where his fingers pinch the knob; the lever runs down -Y to the boot.
 * setShift(k 0..1) rocks the lever from 1st to 2nd (it pivots at the boot).
 */
export function buildTinyShifter(): Prop & { setShift(k: number): void; knob: THREE.Object3D } {
  const kit = new Kit();
  const root = new THREE.Group();
  root.name = 'tinyShifter';
  const boot = kit.cyl(0.035, 0.06, 0.05, 0x141416, 12, 0.006);
  boot.position.y = -0.2;
  root.add(boot);
  const plate = kit.box(0.14, 0.012, 0.1, 0x2a2a30, 0.006);
  plate.position.y = -0.228;
  root.add(plate);
  const lever = new THREE.Group();
  lever.position.y = -0.2;
  root.add(lever);
  const rod = kit.cyl(0.009, 0.012, 0.17, kit.toon(0xdfe4ec, { gloss: 1, shine: 90 }), 10, 0.005);
  rod.position.y = 0.085;
  lever.add(rod);
  const knob = kit.ball(0.03, kit.toon(0x101014, { gloss: 1, shine: 90 }), 1, 1, 1, 14, 0.006);
  knob.position.y = 0.19;
  lever.add(knob);
  const pat = kit.canvas(32, 32, (g) => {
    g.strokeStyle = '#ffffff';
    g.lineWidth = 3;
    g.beginPath();
    for (const x of [8, 16, 24]) g.moveTo(x, 6), g.lineTo(x, 26);
    g.moveTo(8, 16);
    g.lineTo(24, 16);
    g.stroke();
  });
  const decal = new THREE.Mesh(kit.geo(new THREE.CircleGeometry(0.02, 16)), kit.own(new THREE.MeshBasicMaterial({ map: pat, transparent: true })));
  decal.rotation.x = -Math.PI / 2;
  decal.position.y = 0.031;
  knob.add(decal);
  outlineTree(root, kit.outlineMat);
  return {
    root,
    knob,
    update() {},
    setShift(k: number) {
      lever.rotation.z = 0.35 - 0.7 * Math.max(0, Math.min(1, k));
    },
    dispose() {
      root.removeFromParent();
      kit.dispose();
    },
  };
}
