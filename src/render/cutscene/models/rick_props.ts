// Slick Rick Radial's hand props, built on the rig's Kit (disposed with the rig): the TIRE SHINE spray can
// and the "like new" bald tire with its price tag.
import * as THREE from 'three';
import type { Kit } from './kit';

const OL = 0.011;

/**
 * Spray can for a fist grip: the can's axis runs +Y (out of the thumb side), the fist wraps its middle, the
 * nozzle sits on top and fires along +X (forward when the arm reaches forward). `nozzle` is the spray origin
 * (its +X = the spray direction); setPress(k) pushes the actuator down.
 */
export function sprayCan(k: Kit) {
  const root = new THREE.Group();
  root.name = 'tireShine';
  const green = k.toon(0x2fb04a, { gloss: 1, shine: 80 });
  const chrome = k.toon(0xdfe6f0, { gloss: 1, shine: 110, rim: 1.3 });
  const white = k.toon(0xf6f6f2, { gloss: 0.8 });
  const R = 0.092, H = 0.44;
  // Body: lathe with a rolled base rim and a domed chrome shoulder.
  const prof = [[0, -H / 2], [R - 0.012, -H / 2], [R, -H / 2 + 0.012], [R, H / 2 - 0.05]].map(([x, y]) => new THREE.Vector2(x, y));
  root.add(k.lathe(prof, green, 28, OL));
  const domeP: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    domeP.push(new THREE.Vector2(Math.cos(a) * R, H / 2 - 0.05 + Math.sin(a) * 0.05));
  }
  domeP.push(new THREE.Vector2(0.024, H / 2 + 0.002), new THREE.Vector2(0, H / 2 + 0.002));
  root.add(k.lathe(domeP, chrome, 28, OL));
  const rim = k.mesh(new THREE.TorusGeometry(R - 0.004, 0.009, 6, 28).rotateX(Math.PI / 2), chrome, 0);
  rim.position.y = -H / 2 + 0.01;
  root.add(rim);
  // Label sleeve: white band with TIRE SHINE + a sparkle, wrapped twice round so it reads from either side.
  const tex = k.canvas(128, 48, (g, w, h) => {
    g.fillStyle = '#f6f6f2';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1f7a2c';
    g.fillRect(0, 0, w, 5);
    g.fillRect(0, h - 5, w, 5);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const x of [w * 0.25, w * 0.75]) {
      g.fillStyle = '#e8413c';
      g.font = 'bold 13px sans-serif';
      g.fillText('TIRE', x, 16);
      g.fillStyle = '#16161e';
      g.font = 'bold 15px sans-serif';
      g.fillText('SHINE', x, 31);
      g.fillStyle = '#ffd23f';
      g.fillRect(x + 22, 8, 2, 8);
      g.fillRect(x + 19, 11, 8, 2);
    }
  }, true);
  const labelMat = k.toonUnique(0xffffff, { gloss: 0.9, shine: 90 });
  labelMat.map = tex;
  const label = k.mesh(new THREE.CylinderGeometry(R + 0.003, R + 0.003, 0.15, 28, 1, true), labelMat, 0);
  label.position.y = 0.035;
  label.rotation.y = -Math.PI / 2; // the text faces +Z
  root.add(label);
  // A tall chrome glint down one side.
  const glintM = k.own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false }));
  const gl = new THREE.Mesh(k.geo(new THREE.PlaneGeometry(0.014, H * 0.75)), glintM);
  gl.position.set(-0.03, 0, R * 0.95);
  gl.rotation.y = -0.4;
  root.add(gl);
  // Actuator + nozzle on top.
  const act = new THREE.Group();
  act.position.y = H / 2 + 0.002;
  root.add(act);
  const btn = k.cyl(0.03, 0.032, 0.05, white, 14, OL);
  btn.position.y = 0.025;
  act.add(btn);
  const tip = k.cyl(0.012, 0.014, 0.03, white, 10, 0.006);
  tip.rotation.z = -Math.PI / 2;
  tip.position.set(0.035, 0.03, 0);
  act.add(tip);
  const hole = k.cyl(0.006, 0.006, 0.004, 0x16161e, 8, 0);
  hole.rotation.z = -Math.PI / 2;
  hole.position.set(0.051, 0.03, 0);
  act.add(hole);
  const nozzle = new THREE.Object3D();
  nozzle.position.set(0.055, 0.03, 0);
  act.add(nozzle);
  return {
    root,
    nozzle,
    setPress(v: number) {
      act.position.y = H / 2 + 0.002 - 0.012 * v;
    },
  };
}

/**
 * The bald tire: a smooth, glossy, tread-free donut with a chrome rim and a price tag on a string. The tire's
 * axis runs along Z (face toward +Z); origin = the top of the tread (where a fist holds it). setFlat(k) sags it.
 */
export function baldTire(k: Kit) {
  const root = new THREE.Group();
  root.name = 'baldTire';
  const body = new THREE.Group();
  root.add(body);
  const TR = 0.26, tube = 0.1;
  const rubber = k.toon(0x1c1a22, { gloss: 1, shine: 70, rim: 1.2 });
  const tire = k.mesh(new THREE.TorusGeometry(TR, tube, 14, 32), rubber, 0.016);
  tire.scale.z = 1.25;
  body.add(tire);
  body.position.y = -TR - tube * 0.6;
  // Chrome hub disc and five lug dots.
  const chrome = k.toon(0xd8dee8, { gloss: 1, shine: 110 });
  const hub = k.cyl(TR - tube * 0.55, TR - tube * 0.55, 0.06, chrome, 24, OL);
  hub.rotation.x = Math.PI / 2;
  body.add(hub);
  const cap = k.cyl(0.05, 0.06, 0.04, 0x9aa2b0, 14, 0.008);
  cap.rotation.x = Math.PI / 2;
  cap.position.z = 0.045;
  body.add(cap);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const lug = k.cyl(0.014, 0.014, 0.02, 0x6a7280, 8, 0);
    lug.rotation.x = Math.PI / 2;
    lug.position.set(Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0.04);
    body.add(lug);
  }
  // A big shiny highlight streak on the bald tread (it's THAT bald).
  const shineM = k.own(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
  const streak = new THREE.Mesh(k.geo(new THREE.TorusGeometry(TR + tube * 0.55, 0.012, 4, 20, Math.PI * 0.45)), shineM);
  streak.rotation.z = Math.PI * 0.42;
  streak.position.z = tube * 0.75;
  body.add(streak);
  // A patch (it's been plugged) on the sidewall.
  const patch = k.box(0.07, 0.05, 0.01, 0x8a6a3a, 0.006);
  patch.position.set(-TR * 0.85, -TR * 0.35, tube * 1.1);
  patch.rotation.z = 0.5;
  body.add(patch);
  // Price tag on a string, hanging off the right of the tread.
  const tagP = new THREE.Group();
  tagP.position.set(TR * 0.72, -TR * 0.1 + tube * 0.4, tube * 1.0);
  body.add(tagP);
  const str = k.box(0.006, 0.12, 0.006, 0xf2e8d2, 0);
  str.position.y = -0.06;
  tagP.add(str);
  const tagTex = k.canvas(64, 40, (g, w, h) => {
    g.fillStyle = '#ffd23f';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#16161e';
    g.fillRect(4, 18, 4, 4);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#e8413c';
    g.font = 'bold 15px sans-serif';
    g.fillText('$999', w / 2 + 4, 13);
    g.fillStyle = '#16161e';
    g.font = 'bold 10px sans-serif';
    g.fillText('LIKE NEW!', w / 2 + 3, 30);
  }, true);
  const tagMat = k.toonUnique(0xffffff, { gloss: 0.2 });
  tagMat.map = tagTex;
  tagMat.side = THREE.DoubleSide;
  const tag = k.box(0.2, 0.125, 0.006, tagMat, 0.006);
  tag.position.set(0.0, -0.17, 0);
  tagP.add(tag);
  return {
    root,
    tag: tagP,
    setFlat(v: number) {
      // sags at the bottom: squashed and spread, the hub sinking
      body.scale.set(1 + 0.18 * v, 1 - 0.32 * v, 1);
      body.position.y = (-TR - tube * 0.6) * (1 - 0.32 * v);
    },
    update(t: number) {
      tagP.rotation.z = Math.sin(t * 3.1) * 0.25;
    },
  };
}

/** Anime 4-point twinkle (unit size), unlit additive white. */
export function twinkle(k: Kit, color = 0xffffff): THREE.Mesh {
  const s = new THREE.Shape();
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = Math.PI / 2 + (i * Math.PI * 2) / n;
    const r = i % 2 ? 0.16 : 1;
    i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const m = new THREE.Mesh(
    k.geo(new THREE.ShapeGeometry(s)),
    k.own(new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })),
  );
  m.renderOrder = 5;
  return m;
}

