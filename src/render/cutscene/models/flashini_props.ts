// The Great Flashini's trick props: a spring-loaded bouquet of fake flowers, playing cards (his purple-and-gold
// backs, a few faces, and THE JOKER, which is you), a carpenter's saw, a cardboard cut-out of "YOUR CAR" that
// splits in two, and a dove. Plain scene props (toonMat + outline); the Director's scene dispose frees them.
import * as THREE from 'three';
import { FONT } from '../../palette';
import { outline, toonMat } from '../fx';

const PURPLE = '#5a1a8a';
const GOLD = '#ffd23f';

function tex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, smooth = false) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d')!);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = t.minFilter = smooth ? THREE.LinearFilter : THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

function mesh(g: THREE.BufferGeometry, col: number | THREE.Material, line = true) {
  const m = new THREE.Mesh(g, col instanceof THREE.Material ? col : toonMat(col));
  if (line) outline(m);
  return m;
}

// ---------- bouquet ----------

/**
 * A bouquet of fake paper flowers on coiled springs, origin at the base (stems along +Y). set(k 0..1) springs it
 * out: stems stretch from nothing to full with a wobbly overshoot (k > 1 overshoots).
 */
export function buildBouquet() {
  const root = new THREE.Group();
  const cols = [0xff4fa3, 0xffd23f, 0x5cf2ff, 0xff6a3a, 0xb07cf0, 0x6ad88a, 0xff4f6a];
  const stems: { piv: THREE.Group; len: number; dir: THREE.Vector3; head: THREE.Group }[] = [];
  const green = toonMat(0x3aa84a);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const spread = i === 0 ? 0 : 0.5;
    const dir = new THREE.Vector3(Math.cos(a) * spread, 1, Math.sin(a) * spread).normalize();
    const piv = new THREE.Group();
    piv.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    root.add(piv);
    const len = i === 0 ? 1.2 : 0.95 + (i % 3) * 0.08;
    // the spring: a helix tube from 0 to len (scaled in y by set())
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 120; k++) {
      const u = k / 120;
      pts.push(new THREE.Vector3(Math.cos(u * Math.PI * 28) * 0.03, u, Math.sin(u * Math.PI * 28) * 0.03));
    }
    const spring = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5), 220, 0.009, 5, false), green, false);
    spring.scale.y = len;
    piv.add(spring);
    const head = new THREE.Group();
    head.position.y = len;
    piv.add(head);
    const petalM = toonMat(cols[i % cols.length], { side: THREE.DoubleSide });
    const n = 6;
    for (let p = 0; p < n; p++) {
      const pa = (p / n) * Math.PI * 2;
      const petal = mesh(new THREE.SphereGeometry(0.11, 12, 8).scale(1.25, 0.35, 0.8), petalM);
      petal.position.set(Math.cos(pa) * 0.12, 0, Math.sin(pa) * 0.12);
      petal.rotation.y = -pa;
      head.add(petal);
    }
    const ctr = mesh(new THREE.SphereGeometry(0.075, 12, 8).scale(1, 0.6, 1), i % 2 ? 0xfff4d0 : 0xffd23f);
    ctr.position.y = 0.03;
    head.add(ctr);
    // a paper price tag on the biggest one: "FAKE"
    if (i === 0) {
      const tag = new THREE.Mesh(
        new THREE.PlaneGeometry(0.34, 0.17),
        new THREE.MeshBasicMaterial({
          side: THREE.DoubleSide,
          map: tex(48, 24, (g) => {
            g.fillStyle = '#fff4d0';
            g.fillRect(0, 0, 48, 24);
            g.fillStyle = '#e8413c';
            g.font = `8px ${FONT}`;
            g.textBaseline = 'middle';
            g.fillText('FAKE', 8, 13);
          }),
        }),
      );
      tag.position.set(0.24, -0.18, 0.08);
      tag.rotation.set(0, 0, -0.35);
      head.add(tag);
    }
    stems.push({ piv, len, dir, head });
  }
  // a little paper wrap round the base
  const wrap = mesh(new THREE.CylinderGeometry(0.22, 0.08, 0.3, 14, 1, true), toonMat(0xfff4d0, { side: THREE.DoubleSide }));
  wrap.position.y = 0.12;
  root.add(wrap);
  return {
    root,
    set(k: number) {
      for (const s of stems) {
        const e = Math.max(0.001, k);
        s.piv.scale.set(Math.min(1, e * 1.5) + 0.001, e, Math.min(1, e * 1.5) + 0.001);
        s.head.scale.set(1 / Math.max(0.3, e), 1 / Math.max(0.3, e), 1 / Math.max(0.3, e)).multiplyScalar(Math.min(1, e * 1.4));
      }
    },
  };
}

// ---------- cards ----------

const backTex = () =>
  tex(40, 56, (g) => {
    g.fillStyle = '#fbfbff';
    g.fillRect(0, 0, 40, 56);
    g.fillStyle = PURPLE;
    g.fillRect(2, 2, 36, 52);
    g.fillStyle = GOLD;
    for (let y = 4; y < 54; y += 6)
      for (let x = (y / 6) % 2 ? 4 : 7; x < 38; x += 6) {
        g.beginPath();
        g.moveTo(x, y - 2);
        g.lineTo(x + 2, y);
        g.lineTo(x, y + 2);
        g.lineTo(x - 2, y);
        g.fill();
      }
    g.fillStyle = PURPLE;
    g.fillRect(12, 20, 16, 16);
    g.fillStyle = GOLD;
    g.font = `8px ${FONT}`;
    g.fillText('F', 16, 32);
  });

const SUITS = ['♥', '♠', '♦', '♣'];
const faceTex = (rank: string, suit: number) =>
  tex(40, 56, (g) => {
    g.fillStyle = '#fbfbff';
    g.fillRect(0, 0, 40, 56);
    const red = suit % 2 === 0;
    g.fillStyle = red ? '#e8413c' : '#1a1020';
    g.font = 'bold 11px monospace';
    g.fillText(rank, 3, 12);
    g.font = 'bold 24px monospace';
    g.textAlign = 'center';
    g.fillText(SUITS[suit], 20, 40);
  });

/** The joker: it's you. A clown face, "JOKER", and a "(YOU)" with an arrow. */
const jokerTex = () =>
  tex(80, 112, (g) => {
    g.fillStyle = '#fbfbff';
    g.fillRect(0, 0, 80, 112);
    g.strokeStyle = PURPLE;
    g.lineWidth = 4;
    g.strokeRect(2, 2, 76, 108);
    g.fillStyle = '#e8413c';
    g.font = `8px ${FONT}`;
    g.textAlign = 'center';
    g.fillText('JOKER', 40, 17);
    // jester hat
    g.fillStyle = '#e8413c';
    g.beginPath();
    g.moveTo(22, 46);
    g.lineTo(14, 26);
    g.lineTo(40, 40);
    g.lineTo(66, 26);
    g.lineTo(58, 46);
    g.fill();
    g.fillStyle = GOLD;
    for (const [x, y] of [[14, 26], [66, 26]]) {
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fill();
    }
    // goofy face
    g.fillStyle = '#f3d0b2';
    g.beginPath();
    g.arc(40, 60, 16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#1a1020';
    g.fillRect(32, 54, 4, 6);
    g.fillRect(44, 54, 4, 6);
    g.fillStyle = '#e8413c';
    g.beginPath();
    g.arc(40, 63, 4, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#1a1020';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(40, 66, 8, 0.2, Math.PI - 0.2);
    g.stroke();
    // (YOU)
    g.fillStyle = PURPLE;
    g.font = `8px ${FONT}`;
    g.fillText('(YOU)', 40, 96);
  });

export interface Card {
  root: THREE.Group;
  /** card size (the root is unscaled) */
  w: number;
  h: number;
}

const _cardGeo = () => new THREE.BoxGeometry(1, 1, 0.012);

/** One card, face toward +Z, back toward -Z. `w` wide, 1.4w tall. face: [rank, suit] or 'joker'. */
export function buildCard(w: number, face: [string, number] | 'joker', back: THREE.Texture, edgeMat: THREE.Material): Card {
  const root = new THREE.Group();
  const h = w * 1.4;
  const fm = new THREE.MeshBasicMaterial({ color: 0xc8c8cc, map: face === 'joker' ? jokerTex() : faceTex(face[0], face[1]) });
  const bm = new THREE.MeshBasicMaterial({ color: 0xc8c8cc, map: back });
  const m = new THREE.Mesh(_cardGeo(), [edgeMat, edgeMat, edgeMat, edgeMat, fm, bm]);
  m.scale.set(w, h, 1);
  outline(m);
  root.add(m);
  return { root, w, h };
}

/** A deck's worth of cards sharing one back texture. */
export function buildDeck(n: number, w: number): { cards: Card[]; back: THREE.Texture } {
  const back = backTex();
  const edge = toonMat(0xfbfbff);
  const ranks = ['A', 'K', 'Q', 'J', '7', '3', '9', '5', '2', '10'];
  const cards: Card[] = [];
  for (let i = 0; i < n; i++) cards.push(buildCard(w, [ranks[i % ranks.length], i % 4], back, edge));
  return { cards, back };
}

export function buildJoker(w: number, back: THREE.Texture) {
  return buildCard(w, 'joker', back, toonMat(0xfbfbff));
}

// ---------- saw ----------

/** A big carpenter's saw: origin in the handle grip, blade along +X, teeth on -Y. */
export function buildSaw() {
  const root = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(0.1, -0.13);
  // teeth along the bottom edge
  const L = 1.25;
  const n = 26;
  for (let i = 0; i <= n; i++) {
    const x = 0.1 + (i / n) * (L - 0.1);
    s.lineTo(x, i % 2 ? -0.16 : -0.12 - 0.0 * i);
  }
  s.lineTo(L, -0.08);
  s.lineTo(0.1, 0.12);
  s.lineTo(0.1, -0.13);
  const blade = mesh(new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: false }), toonMat(0xd6dae4, {}, { gloss: 1, shine: 90 }));
  blade.position.z = -0.006;
  root.add(blade);
  const handle = mesh(new THREE.BoxGeometry(0.2, 0.3, 0.06), 0xb0602a);
  handle.position.set(0.04, 0.0, 0);
  root.add(handle);
  const hole = mesh(new THREE.BoxGeometry(0.08, 0.12, 0.07), 0x1a1020, false);
  hole.position.set(0.04, 0.02, 0);
  root.add(hole);
  return root;
}

// ---------- cut-out ----------

/**
 * A cardboard cut-out of the player's yellow car with a "YOUR CAR" sign, standing on two easel legs. It is in two
 * halves (front / back), each on a hinge at its bottom outer corner: split(k 0..1) slides them apart and topples
 * them outward. Origin at the bottom centre, the painted side toward +Z, car facing +X. ~3.6 m long.
 */
export function buildCutout() {
  const root = new THREE.Group();
  const W = 3.6, H = 1.5;
  const art = tex(180, 75, (g) => {
    g.fillStyle = '#c89a5a';
    g.fillRect(0, 0, 180, 75);
    // car silhouette
    g.fillStyle = '#f7d23e';
    g.strokeStyle = '#1a1020';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(10, 55);
    g.lineTo(12, 38);
    g.lineTo(45, 32);
    g.lineTo(70, 16);
    g.lineTo(118, 16);
    g.lineTo(140, 32);
    g.lineTo(170, 36);
    g.lineTo(172, 55);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#7cc4f0';
    g.fillRect(76, 21, 18, 11);
    g.fillRect(98, 21, 18, 11);
    g.fillStyle = '#e8413c';
    g.fillRect(20, 42, 150, 5);
    for (const x of [44, 140]) {
      g.fillStyle = '#1a1020';
      g.beginPath();
      g.arc(x, 56, 13, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#d6dae4';
      g.beginPath();
      g.arc(x, 56, 6, 0, Math.PI * 2);
      g.fill();
    }
    // crayon-ish speed lines + "VROOM"
    g.strokeStyle = '#1a1020';
    g.lineWidth = 2;
    for (const y of [26, 36, 46]) {
      g.beginPath();
      g.moveTo(1, y);
      g.lineTo(8, y);
      g.stroke();
    }
  });
  const halves: THREE.Group[] = [];
  const card = toonMat(0xb07a40);
  for (const side of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set((side * W) / 2, 0, 0);
    root.add(hinge);
    const g = new THREE.PlaneGeometry(W / 2, H);
    // UVs: the back half (-X) uses the left of the art
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, side < 0 ? uv.getX(i) * 0.5 : 0.5 + uv.getX(i) * 0.5);
    const face = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xbdbdbd, map: art, side: THREE.FrontSide }));
    face.position.set((-side * W) / 4, H / 2 + 0.3, 0.031);
    face.userData.noOutline = true;
    hinge.add(face);
    const board = mesh(new THREE.BoxGeometry(W / 2, H, 0.06), card);
    board.position.set((-side * W) / 4, H / 2 + 0.3, 0);
    hinge.add(board);
    // easel leg
    const leg = mesh(new THREE.BoxGeometry(0.08, 1.1, 0.08), 0x8a5a2a);
    leg.position.set((-side * W) / 4, 0.5, -0.3);
    leg.rotation.x = 0.35;
    hinge.add(leg);
    halves.push(hinge);
  }
  // the sign
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 0.5),
    new THREE.MeshBasicMaterial({
      color: 0xbdbdbd,
      side: THREE.DoubleSide,
      map: tex(96, 32, (g) => {
        g.fillStyle = '#fbfbff';
        g.fillRect(0, 0, 96, 32);
        g.strokeStyle = '#1a1020';
        g.lineWidth = 3;
        g.strokeRect(1, 1, 94, 30);
        g.fillStyle = '#e8413c';
        g.font = `8px ${FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('YOUR CAR', 48, 17);
      }),
    }),
  );
  sign.position.set(W / 4 - 0.2, H + 0.62, 0.04);
  sign.rotation.z = 0.08;
  halves[0].add(sign);
  // the dotted "cut here" line
  const dots = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.11), new THREE.MeshBasicMaterial({ color: 0x1a1020 }));
    d.position.set(0, 0.38 + i * 0.2, 0.034);
    dots.add(d);
  }
  root.add(dots);
  return {
    root,
    halves,
    split(k: number) {
      dots.visible = k < 0.02;
      halves.forEach((hg, i) => {
        const s = i ? 1 : -1;
        hg.position.x = (s * W) / 2 + s * 0.35 * Math.min(1, k * 2);
        hg.rotation.z = -s * 1.45 * Math.max(0, k - 0.15) ** 1.5;
      });
    },
  };
}

// ---------- dove ----------

/** A white dove facing +Z; flap(t) beats its wings. */
export function buildDove() {
  const root = new THREE.Group();
  const white = toonMat(0xfbfbff);
  const body = mesh(new THREE.SphereGeometry(0.2, 14, 10).scale(0.85, 0.8, 1.35), white);
  root.add(body);
  const head = mesh(new THREE.SphereGeometry(0.12, 12, 8), white);
  head.position.set(0, 0.14, 0.25);
  root.add(head);
  const beak = mesh(new THREE.ConeGeometry(0.035, 0.1, 8), 0xffa030);
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.12, 0.38);
  root.add(beak);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), new THREE.MeshBasicMaterial({ color: 0x1a1020 }));
    eye.position.set(s * 0.08, 0.17, 0.32);
    root.add(eye);
  }
  const tail = mesh(new THREE.BoxGeometry(0.24, 0.04, 0.22), white);
  tail.position.set(0, 0.02, -0.33);
  tail.rotation.x = -0.25;
  root.add(tail);
  const wings: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const piv = new THREE.Group();
    piv.position.set(s * 0.12, 0.08, 0.02);
    root.add(piv);
    const w = mesh(new THREE.SphereGeometry(0.2, 12, 8).scale(1.6, 0.18, 0.9), white);
    w.position.x = s * 0.28;
    piv.add(w);
    wings.push(piv);
  }
  return {
    root,
    flap(t: number) {
      wings.forEach((w, i) => (w.rotation.z = (i ? -1 : 1) * Math.sin(t * 26) * 0.9));
    },
  };
}
