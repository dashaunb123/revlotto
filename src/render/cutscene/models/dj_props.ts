// DJ Blackout's props: the handheld mic (for the mic drop) and his car rig - a DJ booth bolted to the driver's
// door (two turntables, a mixer with a big LIGHTS master fader, an LED marquee), twin speaker stacks on the rear
// deck with pumping woofers and laser heads on top, rocker LED strips and a magenta underglow.
import * as THREE from 'three';
import { Kit, outlineTree } from './kit';
import { roundedBoxGeometry, type Prop } from './props';
import type { CarRigX } from './car';

const MAG = 0xff2fd6;
const CYAN = 0x2ff0ff;
const OL = 0.012;

/** Handheld mic. Origin = grip (centre of the fist), the mic runs along +Y (head up out of the thumb side). */
export function buildMic(): Prop & { head: THREE.Object3D } {
  const kit = new Kit();
  const root = new THREE.Group();
  root.name = 'mic';
  const body = kit.cyl(0.036, 0.028, 0.3, kit.toon(0x141018, { gloss: 0.8, shine: 80 }), 16, OL);
  body.position.y = -0.01;
  root.add(body);
  const ring = kit.cyl(0.04, 0.04, 0.025, kit.toon(MAG, { emissive: MAG, emissiveIntensity: 1.2 }), 16, 0);
  ring.position.y = 0.13;
  root.add(ring);
  const collar = kit.cyl(0.05, 0.038, 0.04, kit.toon(0xd8dde6, { gloss: 1, shine: 90 }), 16, OL);
  collar.position.y = 0.16;
  root.add(collar);
  const head = kit.ball(0.072, kit.toon(0xc8ccd6, { gloss: 0.9, shine: 70 }), 1, 1.05, 1, 18, OL);
  head.position.y = 0.22;
  root.add(head);
  // grille lines
  for (let i = 0; i < 3; i++) {
    const g = kit.mesh(new THREE.TorusGeometry(0.073 * Math.cos((i - 1) * 0.5), 0.004, 4, 24), kit.toon(0x6a6e7a), 0);
    g.rotation.x = Math.PI / 2;
    g.position.y = 0.22 + (i - 1) * 0.035;
    root.add(g);
  }
  const glint = kit.ball(0.02, kit.own(new THREE.MeshBasicMaterial({ color: 0xffffff })), 1, 1.6, 0.4, 8, 0);
  glint.position.set(-0.03, 0.25, 0.06);
  root.add(glint);
  outlineTree(root, kit.outlineMat);
  return {
    root,
    head,
    dispose() {
      root.removeFromParent();
      kit.dispose();
    },
  };
}

export interface DjCarKit {
  root: THREE.Group;
  /** The two records (spin about local Y). [0] = character's right (-X), [1] = left (+X). */
  records: THREE.Object3D[];
  /** The LIGHTS master fader knob (slides along local Z of the mixer: setFader). */
  fader: THREE.Object3D;
  /** Laser heads (world origin of the beams), on top of the stacks and the booth's front corners. */
  laserHeads: THREE.Object3D[];
  /** 0 = LIGHTS fader up (on), 1 = pulled all the way down. */
  setFader(k: number): void;
  /** Beat pulse 0..1 (woofers pump, LEDs flash). */
  setPulse(k: number): void;
  /** LED / underglow brightness (0 = dark). */
  setGlow(k: number): void;
  /** Record spin in rad/s (scratching drives it back and forth). */
  setSpin(radPerSec: number): void;
  update(dt: number): void;
  dispose(): void;
}

/** Decorates a super car (adds to car.body). `seatX` = the seat's X in body space. */
export function buildDjCarKit(car: CarRigX): DjCarKit {
  const kit = new Kit();
  const root = new THREE.Group();
  root.name = 'djKit';
  car.body.add(root);
  const seatX = car.seat.position.x;
  const black = kit.toon(0x141018, { gloss: 0.7, shine: 70 });
  const grey = kit.toon(0x2a2632, { gloss: 0.3 });
  const chrome = kit.toon(0xd8dde6, { gloss: 1, shine: 90 });
  const led = kit.toonUnique(MAG, { emissive: MAG, emissiveIntensity: 1.2, gloss: 0.2 });
  const ledC = kit.toonUnique(CYAN, { emissive: CYAN, emissiveIntensity: 1.2, gloss: 0.2 });
  const rb = (w: number, h: number, d: number, r: number, mat: THREE.Material, ol = OL * 1.5) => kit.mesh(roundedBoxGeometry(w, h, d, r, 3), mat, ol);

  // ---------- the booth on the driver's door ----------
  const booth = new THREE.Group();
  booth.position.set(seatX - 0.05, 0.98, 1.38);
  root.add(booth);
  const table = rb(1.7, 0.1, 0.62, 0.04, black);
  booth.add(table);
  const edge = kit.box(1.72, 0.03, 0.03, led, 0);
  edge.position.set(0, 0.0, 0.32);
  booth.add(edge);
  // front panel with an LED marquee
  const panel = rb(1.7, 0.5, 0.06, 0.03, black);
  panel.position.set(0, -0.28, 0.3);
  booth.add(panel);
  const marqTex = kit.canvas(128, 24, (g, w, h) => {
    g.fillStyle = '#0a0610';
    g.fillRect(0, 0, w, h);
    g.font = '16px "Press Start 2P", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ff2fd6';
    g.fillText('BLACKOUT', w / 2, h / 2 + 1);
  });
  const marq = new THREE.Mesh(kit.geo(new THREE.PlaneGeometry(1.5, 0.3)), kit.own(new THREE.MeshBasicMaterial({ map: marqTex, fog: false })));
  marq.position.set(0, -0.26, 0.335);
  booth.add(marq);
  // two struts down to the door
  for (const s of [-1, 1]) {
    const strut = kit.box(0.06, 0.5, 0.06, chrome, OL);
    strut.position.set(s * 0.6, -0.3, -0.15);
    strut.rotation.x = 0.5;
    booth.add(strut);
  }
  const records: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const tt = new THREE.Group();
    tt.position.set(s * 0.5, 0.07, 0);
    booth.add(tt);
    const base = rb(0.56, 0.06, 0.5, 0.02, grey, OL);
    tt.add(base);
    const platter = kit.cyl(0.21, 0.21, 0.03, chrome, 28, OL);
    platter.position.set(-0.03, 0.045, 0);
    tt.add(platter);
    const rec = new THREE.Group();
    rec.position.set(-0.03, 0.065, 0);
    tt.add(rec);
    rec.add(kit.cyl(0.2, 0.2, 0.012, kit.toon(0x0a0810, { gloss: 1, shine: 100 }), 28, 0));
    const lab = kit.cyl(0.07, 0.07, 0.016, led, 18, 0);
    rec.add(lab);
    const mark = kit.box(0.05, 0.018, 0.012, 0xffffff, 0);
    mark.position.set(0.04, 0, 0);
    rec.add(mark);
    for (const r of [0.11, 0.15, 0.185]) {
      const gr = kit.mesh(new THREE.TorusGeometry(r, 0.0035, 3, 32), kit.toon(0x2e2a38), 0);
      gr.rotation.x = Math.PI / 2;
      gr.position.y = 0.007;
      rec.add(gr);
    }
    const arm = kit.box(0.3, 0.02, 0.02, chrome, 0.008);
    arm.position.set(0.17, 0.09, 0.15);
    arm.rotation.y = 0.5;
    tt.add(arm);
    const pivot = kit.cyl(0.03, 0.03, 0.06, chrome, 10, 0.008);
    pivot.position.set(0.22, 0.07, 0.18);
    tt.add(pivot);
    records.push(rec);
  }
  // mixer with cyan channel faders and the big LIGHTS master
  const mixer = new THREE.Group();
  mixer.position.set(0, 0.08, 0);
  booth.add(mixer);
  mixer.add(rb(0.3, 0.08, 0.5, 0.02, grey, OL));
  for (const x of [-0.08, 0.08]) {
    const slot = kit.box(0.02, 0.01, 0.3, 0x050308, 0);
    slot.position.set(x, 0.045, 0);
    mixer.add(slot);
    const f = kit.box(0.05, 0.04, 0.03, ledC, 0.006);
    f.position.set(x, 0.06, x * 0.6);
    mixer.add(f);
  }
  const fader = new THREE.Group();
  fader.position.set(0, 0.075, 0.17);
  mixer.add(fader);
  const knob = rb(0.12, 0.07, 0.08, 0.02, led, 0.008);
  fader.add(knob);
  const lightsTex = kit.canvas(48, 12, (g, w, h) => {
    g.fillStyle = '#ffffff';
    g.font = '8px "Press Start 2P", monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('LIGHTS', w / 2, h / 2 + 1);
  });
  const lightsLab = new THREE.Mesh(kit.geo(new THREE.PlaneGeometry(0.24, 0.06)), kit.own(new THREE.MeshBasicMaterial({ map: lightsTex, transparent: true, fog: false })));
  lightsLab.rotation.x = -Math.PI / 2;
  lightsLab.position.set(0, 0.047, 0.0);
  mixer.add(lightsLab);

  // ---------- speaker stacks on the rear deck ----------
  if (car.props.spoiler) car.props.spoiler.visible = false;
  const cones: THREE.Object3D[] = [];
  const laserHeads: THREE.Object3D[] = [];
  const deckY = 0.82;
  for (const x of [-1.85, -1.2]) {
    const stack = new THREE.Group();
    stack.position.set(x, deckY, 0.1);
    root.add(stack);
    let y = 0;
    for (const [w, hgt, n] of [[0.62, 0.62, 1], [0.56, 0.5, 2]] as const) {
      const cab = rb(w, hgt, 0.7, 0.04, black);
      cab.position.y = y + hgt / 2;
      stack.add(cab);
      const trim = kit.box(w + 0.02, 0.025, 0.02, led, 0);
      trim.position.set(0, y + hgt - 0.03, 0.36);
      stack.add(trim);
      for (let i = 0; i < n; i++) {
        const cr = n === 1 ? 0.24 : 0.16;
        const cone = new THREE.Group();
        cone.position.set(n === 1 ? 0 : (i - 0.5) * 0.27, y + hgt / 2, 0.355);
        stack.add(cone);
        const surround = kit.mesh(new THREE.TorusGeometry(cr, 0.03, 8, 24), grey, 0.008);
        cone.add(surround);
        const c = kit.mesh(new THREE.ConeGeometry(cr * 0.95, 0.1, 24, 1, true).rotateX(-Math.PI / 2), kit.toon(0x221e2a, { side: THREE.DoubleSide }), 0);
        c.position.z = -0.03;
        cone.add(c);
        const cap = kit.ball(cr * 0.32, ledC, 1, 1, 0.5, 12, 0);
        cap.position.z = -0.02;
        cone.add(cap);
        cones.push(cone);
      }
      y += hgt;
    }
    // laser head on top: a little turret with a glowing lens
    const head = new THREE.Group();
    head.position.set(0, y + 0.1, 0.05);
    stack.add(head);
    head.add(kit.cyl(0.1, 0.12, 0.14, grey, 14, OL));
    const lens = kit.ball(0.06, ledC, 1, 1, 1, 12, 0);
    lens.position.set(0, 0.06, 0.06);
    head.add(lens);
    laserHeads.push(head);
  }
  // booth front corners get lasers too
  for (const s of [-1, 1]) {
    const h = new THREE.Object3D();
    h.position.set(s * 0.82, -0.05, 0.34);
    booth.add(h);
    const lens = kit.ball(0.045, led, 1, 1, 1, 10, 0);
    h.add(lens);
    laserHeads.push(h);
  }

  // ---------- LED rocker strips + underglow ----------
  for (const z of [1.06, -1.06]) {
    const strip = kit.box(3.4, 0.035, 0.02, led, 0);
    strip.position.set(0.1, 0.32, z);
    root.add(strip);
  }
  const ugMat = kit.own(new THREE.MeshBasicMaterial({ color: MAG, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  const ugTex = kit.canvas(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }, true);
  ugMat.map = ugTex;
  const ug = new THREE.Mesh(kit.geo(new THREE.PlaneGeometry(6.4, 3.6)), ugMat);
  ug.rotation.x = -Math.PI / 2;
  ug.position.set(0, 0.03, 0);
  root.add(ug);

  outlineTree(root, kit.outlineMat);

  let pulse = 0, glow = 1, spin = 3.5, fk = 0;
  const z0 = 0.17, z1 = -0.15; // up (away from the DJ) .. down (toward him)
  return {
    root, records, fader, laserHeads,
    setFader(k: number) {
      fk = Math.max(0, Math.min(1, k));
      fader.position.z = z0 + (z1 - z0) * fk;
    },
    setPulse(k: number) {
      pulse = k;
    },
    setGlow(k: number) {
      glow = k;
    },
    setSpin(r: number) {
      spin = r;
    },
    update(dt: number) {
      for (const r of records) r.rotation.y -= spin * dt;
      for (const c of cones) c.scale.set(1 + 0.18 * pulse, 1 + 0.18 * pulse, 1 + 1.6 * pulse);
      const g = glow * (0.6 + 0.6 * pulse);
      led.emissiveIntensity = 0.15 + 1.6 * g;
      ledC.emissiveIntensity = 0.15 + 1.5 * g;
      ugMat.opacity = Math.min(0.9, 0.55 * g);
      (marq.material as THREE.MeshBasicMaterial).color.setScalar(Math.min(1, 0.1 + g));
    },
    dispose() {
      root.removeFromParent();
      kit.dispose();
    },
  };
}
