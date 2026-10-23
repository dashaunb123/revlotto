// THE GREAT FLASHINI: a sleazy stage magician and con artist; every beat is a trick played on YOU.
// The tree is counting down (amber, amber...) when a purple smoke bomb goes off in the next lane: POOF, there he
// is, twirling his wand, smug. He whips his top hat off, taps it: a GREEN light floats up out of it. "GO!" You
// LUNGE for it (speed lines, the camera rockets forward)... and it springs open into a bouquet of fake flowers
// right in your face. GOTCHA! He laughs his head off. "PICK A CARD." He fans a deck at you and fires every card
// at the lens; the last one sticks: the JOKER (it's you). He saws a cardboard cut-out of YOUR CAR in half:
// HALF OFF! Then the big one, in slow-mo: TA-DA! A blinding flash, gold rays, sparkles, the cape flares into
// gold-lined wings and doves burst out... one of which flies over the lens and drops a PLOP on it. Card.
import * as THREE from 'three';
import { Director, easeInOut, easeOut, lerp, rand, type CardInfo } from '../director';
import { easeIn, outline, toonMat } from '../fx';
import { buildBossCar, buildCharacter } from '../models';
import type { FlashiniRig } from '../models/flashini';
import { buildBouquet, buildCutout, buildDeck, buildDove, buildJoker, buildSaw } from '../models/flashini_props';
import { starShape } from '../models/parts';
import { buildDragStrip, buildTree, glowSprite, glowTexture } from '../stage';
import { faceCam, harshJerk, headPos, headR, mountBoss, rays, talk } from './common';

const LANE = -2.6;
const GREEN = 0x3cff5a;
const GOLD = 0xffd23f;
const PURPLE = 0x8a3ad8;

type SfxX = Director['sfx'] & {
  poof?: () => void;
  boing?: () => void;
  cardRiffle?: () => void;
  saw?: () => void;
  coo?: () => void;
  taDa?: () => void;
  sparkle?: () => void;
  splat?: () => void;
  slap?: () => void;
  tink?: () => void;
  flashPop?: () => void;
  paperTik?: () => void;
  rip?: () => void;
  whoosh?: () => void;
  crumple?: () => void;
};

export default function flashini(d: Director, card: CardInfo) {
  const sfx = d.sfx as SfxX;
  /** A requested sound (REQUEST for audio) if the audio agent has added it, else the fallback. */
  const opt = (name: 'poof' | 'boing' | 'cardRiffle' | 'saw' | 'coo' | 'taDa', fb?: () => void) => {
    const f = (d.sfx as SfxX)[name];
    if (f) f.call(d.sfx);
    else fb?.();
  };

  // ---------- set: a showtime night at the strip ----------
  const set = buildDragStrip(d.stage, { haze: 0x2a1640, sky: [0x3a1a58, 0x0c0614], fogNear: 25, fogFar: 140 });
  d.crowd = set.crowd;
  d.hype = 0.5;
  const JERK = harshJerk(0xb04aff, GOLD);
  JERK.keyI = 1.15;
  JERK.hemiI = 0.85;
  d.look(0, JERK);

  // ---------- cast ----------
  const b = mountBoss(d, buildBossCar('flashini'), buildCharacter('flashini'), 2.3);
  const car = b.car.root;
  car.position.set(0, 0, LANE);
  const ch = b.char as FlashiniRig;
  d.every((dt) => ch.setBeatDt?.(dt));
  ch.setTurn?.(1); // a jerk from frame 0
  const R = headR(b);
  const H = new THREE.Vector3();
  headPos(b, H);
  const H0 = H.clone();

  // car dressing: gold stars on the door and a gold pinstripe
  {
    const body = (b.car as unknown as { body: THREE.Object3D }).body ?? car;
    const sz = b.size;
    const star = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape(0.32, 0.45), { depth: 0.03, bevelEnabled: false }), toonMat(GOLD, {}, { gloss: 0.9 }));
    star.position.set(-0.15, sz.y * 0.42, sz.z / 2 - 0.02);
    star.rotation.z = 0.2;
    body.add(star);
    for (const [x, y, r] of [[0.55, sz.y * 0.5, 0.1], [-0.8, sz.y * 0.32, 0.08]] as const) {
      const s2 = new THREE.Mesh(new THREE.ExtrudeGeometry(starShape(r, 0.45), { depth: 0.02, bevelEnabled: false }), toonMat(GOLD, {}, { gloss: 0.9 }));
      s2.position.set(x, y, sz.z / 2 - 0.02);
      body.add(s2);
    }
  }

  // the christmas tree, in the middle of the start line ahead of him
  const tree = buildTree();
  tree.root.position.set(H0.x + 7.5, 0, 0);
  tree.root.rotation.y = -0.35;
  d.scene.add(tree.root);
  tree.set('stage');

  const camPos = () => d.stage.camera.position;
  const camFwd = () => d.stage.camera.getWorldDirection(new THREE.Vector3());
  const hatMouth = () => {
    ch.props.hatAnchor.updateWorldMatrix(true, false);
    return ch.props.hatAnchor.getWorldPosition(new THREE.Vector3());
  };
  const wandTip = () => {
    ch.props.wandTip.updateWorldMatrix(true, false);
    return ch.props.wandTip.getWorldPosition(new THREE.Vector3());
  };
  d.bars(true);

  // ---------- timeline ----------
  const POOF = 0.8;
  const DECOY = 1.55; // cut: the hat trick
  const TAP = 1.95; // wand taps the hat
  const RISE = 2.05; // the green light floats up
  const GO = 2.45; // "GO!" and you lunge
  const BOING = 2.85; // it's flowers
  const LAUGH1 = 3.15;
  const PICK = 3.85; // "PICK A CARD."
  const FIRE = 4.35; // cards at the lens
  const STICK = 4.95; // the joker sticks
  const SAW = 5.45; // the saw
  const SPLIT = 6.35; // HALF OFF
  const TADA = 6.85; // TA-DA (slow-mo)
  const PLOP = 7.95;
  const CARD = 8.5;

  // ================= COLD OPEN (0 - 1.55): the tree counts down, then POOF =================
  car.visible = false;
  d.at(0.15, () => (tree.set('amber1'), sfx.tink?.()));
  d.at(0.45, () => (tree.set('amber2'), sfx.tink?.()));
  d.at(0.75, () => (tree.set('amber3'), sfx.tink?.()));
  // the start-line view: the tree ahead, his empty lane beside it
  // tight on the tree's ambers, then a whip pan to the POOF in the next lane
  {
    const tp = tree.root.position;
    d.cut(0, [tp.x + 1.6, 4.9, 5.4], [tp.x, 4.3, 0], 34, 0.06);
    d.move(0, POOF - 0.12, { pos: [tp.x + 1.3, 4.8, 4.6], fov: 30, roll: -0.04 });
  }
  d.at(POOF - 0.12, () => d.sfx.whoosh());
  d.at(POOF, () => {
    car.visible = true;
    b.char.setSignature(1);
    const c = car.position.clone().add(new THREE.Vector3(0, 1.5, 0));
    for (let i = 0; i < 9; i++)
      d.fx.smoke(c.clone().add(new THREE.Vector3(rand(-2.8, 2.8), rand(-0.8, 1.6), rand(-1.8, 0.2))), 1, {
        color: i % 3 ? 0x8a3ad8 : 0xc89af0,
        size: rand(0.5, 0.85),
        grow: 1.7,
        life: rand(0.45, 0.65),
        spread: 3,
        drag: 2.5,
        gravity: -0.4,
      });
    d.fx.sparks(c, 40, { color: GOLD, spread: 9, gravity: 4, life: 0.8 });
    d.flash('#d8a0ff', 0.7, 7);
    d.cam.shake(0.5);
    d.cam.punch(-5);
    opt('poof', () => d.sfx.impact());
    d.sfx.voice('flashini', 'laugh');
    d.hype = 0.9;
  });
  d.stamp(POOF + 0.03, 'POOF!', { color: '#e0b0ff', x: 250, y: 120, size: 24, rot: -0.12, dur: 0.6, burst: '#5a1a8a' });
  {
    const f = faceCam(b, 9, 0.55, -0.6, -0.6);
    d.whip(POOF - 0.12, 0.12, { pos: f.pos, look: f.look, fov: 42, roll: -0.06 });
  }
  d.follow(POOF, DECOY, (u) => {
    const e = easeOut(u);
    const f = faceCam(b, lerp(9, 6.5, e), lerp(0.55, 0.3, e), lerp(-0.6, -0.4, e), -0.6);
    return { ...f, fov: 42, roll: lerp(-0.06, 0.03, e) };
  });
  d.at(DECOY - 0.15, () => b.char.setSignature(0));

  // ================= THE DECOY (1.55 - 3.15): green light from the hat, you lunge, it's flowers =================
  d.at(DECOY - 0.1, () => ch.setHat(1));
  const decoyCam = (u: number) => {
    const f = faceCam(b, lerp(7.4, 6.6, u), lerp(-0.32, -0.26, u), lerp(-0.2, -0.1, u), -0.75);
    return { ...f, fov: 40, roll: 0.04 };
  };
  d.follow(DECOY, GO, (u) => {
    const f = decoyCam(easeOut(u));
    const k = Math.min(1, Math.max(0, (d.t - RISE) / 0.35));
    if (k > 0) f.look.lerp(bulbAt, 0.35 * easeOut(k));
    return f;
  });
  // the wand taps the brim, twice
  const tapP = new THREE.Vector3();
  d.span(DECOY + 0.15, RISE, (u) => {
    tapP.copy(hatMouth()).add(new THREE.Vector3(-0.15, 0.05 + Math.abs(Math.sin(u * Math.PI * 2)) * 0.25, 0.25));
    ch.setReach(-1, tapP, Math.min(1, u * 4), 0.6);
    ch.setHandPose('R', 'grip');
  });
  d.at(TAP - 0.18, () => (sfx.tink?.(), d.sparkle(hatMouth(), 10, '#ffd23f')));
  d.at(TAP, () => (sfx.tink?.(), sfx.sparkle?.(), d.sparkle(hatMouth(), 14, '#ffd23f'), d.fx.sparks(hatMouth(), 12, { color: GOLD, spread: 3, gravity: 3 })));
  // the wand flips in the fist to point down at the hat for the taps
  d.at(DECOY + 0.15, () => (ch.props.wand.rotation.x = Math.PI));
  d.at(RISE + 0.2, () => (ch.setReach(-1, null), (ch.props.wand.rotation.x = 0)));
  d.stamp(DECOY + 0.25, 'WATCH\nTHE LIGHT...', { color: '#ffffff', x: 470, y: 90, size: 16, rot: 0.08, dur: 0.62, burst: '#5a1a8a' });
  // the green "light": a bulb with a halo and a real light
  const bulb = new THREE.Group();
  {
    // a drag-tree green lamp: black housing, hood, a glowing green lens facing the lens (+Z after lookAt)
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.62, 0.3), toonMat(0x1b1922));
    outline(housing);
    bulb.add(housing);
    const hood = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.26, 20, 1, true, -Math.PI / 2, Math.PI), toonMat(0x1b1922, { side: THREE.DoubleSide }));
    hood.rotation.x = Math.PI / 2;
    hood.position.set(0, 0.0, 0.25);
    bulb.add(hood);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.23, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9dffa8, fog: false }));
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 0.15;
    bulb.add(lens);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.035, 8, 24), toonMat(0xc9ced8, {}, { gloss: 1 }));
    ring.position.z = 0.16;
    bulb.add(ring);
  }
  const halo = glowSprite(glowTexture(), GREEN, 2.6);
  halo.position.z = 0.3;
  bulb.add(halo);
  const bulbLight = new THREE.PointLight(GREEN, 0, 9, 1.4);
  bulb.add(bulbLight);
  bulb.visible = false;
  d.scene.add(bulb);
  const bulbAt = new THREE.Vector3();
  d.span(RISE, BOING, (u) => {
    bulb.visible = u < 1;
    if (u >= 1) return;
    const m = hatMouth();
    const k = easeOut(Math.min(1, (d.t - RISE) / 0.35));
    bulbAt.copy(m).add(new THREE.Vector3(0.1 * k, 0.25 + 0.6 * k, 0.25 * k));
    bulb.position.copy(bulbAt).add(new THREE.Vector3(0, Math.sin(d.t * 9) * 0.03, 0));
    bulb.lookAt(camPos());
    const pulse = 1 + 0.06 * Math.sin(d.t * 30);
    bulb.scale.setScalar(Math.max(0.01, k * pulse * 0.9));
    bulbLight.intensity = 2.2 * k;
    halo.scale.setScalar(2.2 * (1 + 0.6 * (d.t > GO ? (d.t - GO) / (BOING - GO) : 0)));
  });
  d.at(RISE, () => {
    d.flash('#3cff5a', 0.25, 8);
    sfx.sparkle?.();
  });
  // GO!: the screen goes green and the camera LUNGES at the light
  d.at(GO, () => {
    d.flash('#3cff5a', 0.55, 5);
    d.cam.punch(-8);
    d.cam.shake(0.4);
    d.sfx.whoosh();
    d.speedFocus = [320, 160];
  });
  d.stamp(GO, 'GO!', { color: '#3cff5a', x: 320, y: 120, size: 24, rot: -0.06, dur: 0.4, burst: '#0a3a14' });
  const lungeFrom = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  d.span(GO, BOING, (u) => {
    if (u === 0) {
      lungeFrom.pos.copy(d.cam.pos);
      lungeFrom.look.copy(d.cam.look);
    }
    const e = easeIn(u * 0.7 + 0.3 * u * u);
    const tgt = bulbAt.clone();
    const dir = lungeFrom.pos.clone().sub(tgt).normalize();
    d.cam.pos.lerpVectors(lungeFrom.pos, tgt.clone().addScaledVector(dir, 1.9).add(new THREE.Vector3(0, -0.5, 0)), e);
    d.cam.look.lerpVectors(lungeFrom.look, tgt, Math.min(1, e * 2));
    d.cam.fov = lerp(40, 62, e);
    d.cam.roll = lerp(0.04, -0.08, e);
    d.speedLines = Math.max(d.speedLines, 0.4 + 0.6 * e);
  });
  // ...BOING: it's a bouquet of fake flowers on springs, right in your face
  const bq = buildBouquet();
  bq.root.visible = false;
  d.scene.add(bq.root);
  const up = new THREE.Vector3(0, 1, 0);
  d.impactFrame(BOING, '#ff4fa3', 2);
  d.at(BOING, () => {
    bq.root.visible = true;
    d.cam.shake(0.9);
    d.cam.punch(8);
    d.speedLines = 0;
    d.fx.sparks(bulbAt, 10, { color: 0xff4fa3, spread: 5, gravity: 5, size: 0.04 });
    opt('boing', () => sfx.slap?.());
  });
  d.span(BOING, PICK - 0.15, (u) => {
    const t = d.t - BOING;
    // springy overshoot: 0 -> 1.25 -> 0.9 -> 1.05...
    const k = 1 - Math.exp(-t * 9) * Math.cos(t * 30);
    bq.set(Math.max(0.01, k));
    bq.root.position.copy(hatMouth());
    // at you, then (once he's laughing) it droops back up out of the hat
    const toCam = camPos().clone().sub(bq.root.position).normalize();
    const aim = d.t < LAUGH1 ? toCam : up.clone().add(toCam.multiplyScalar(0.25)).normalize();
    bq.root.quaternion.setFromUnitVectors(up, aim);
    bq.root.scale.setScalar(d.t < LAUGH1 ? 0.85 : 0.55);
    void u;
  });
  // the camera "bonks" into the flowers and recoils
  d.span(BOING, LAUGH1, (u) => {
    d.cam.fov = lerp(62, 48, easeOut(u));
    d.cam.roll = lerp(-0.08, 0.06, easeOut(u)) + Math.sin(u * 40) * 0.03 * (1 - u);
  });
  d.stamp(BOING + 0.03, 'BOING!', { color: '#ff4fa3', x: 170, y: 250, size: 16, rot: 0.15, dur: 0.5, burst: '#ffffff' });
  d.stamp(BOING + 0.12, 'GOTCHA!', { color: '#ffd23f', x: 330, y: 105, size: 24, rot: -0.1, dur: 0.9, burst: '#5a1a8a' });

  // ---------- he laughs at you (3.15 - 3.85) ----------
  d.at(LAUGH1, () => {
    ch.setLaugh(1);
    d.sfx.voice('flashini', 'laugh');
  });
  talk(d, b, LAUGH1, PICK - LAUGH1 - 0.05, 18);
  d.follow(LAUGH1, PICK, (u) => {
    const f = faceCam(b, lerp(7.4, 6.8, u), lerp(0.3, 0.36, u), lerp(-0.5, -0.4, u), -0.4);
    return { ...f, fov: 42, roll: lerp(-0.05, -0.02, u) };
  });
  d.stamp(LAUGH1 + 0.3, 'HAH! HA HA!', { color: '#ffffff', x: 470, y: 260, size: 16, rot: 0.1, dur: 0.65, burst: '#5a1a8a' });
  d.at(PICK - 0.15, () => {
    ch.setLaugh(0);
    ch.setHat(0);
    bq.root.visible = false;
  });

  // ================= PICK A CARD (3.85 - 5.45) =================
  const deck = buildDeck(9, 0.24);
  const fan = new THREE.Group();
  fan.visible = false;
  d.scene.add(fan);
  deck.cards.forEach((c, i) => {
    const piv = new THREE.Group();
    piv.rotation.z = lerp(0.85, -0.85, i / (deck.cards.length - 1));
    piv.position.z = i * 0.004;
    c.root.position.y = c.h * 0.45;
    piv.add(c.root);
    fan.add(piv);
  });
  const joker = buildJoker(0.2, deck.back);
  joker.root.visible = false;
  d.scene.add(joker.root);
  const fanP = new THREE.Vector3();
  const pickCam = (u: number) => {
    const f = faceCam(b, lerp(6.4, 5.8, u), lerp(-0.3, -0.22, u), lerp(-0.6, -0.5, u), -0.55);
    return { ...f, fov: 40, roll: lerp(0.05, 0.02, u) };
  };
  d.follow(PICK, FIRE, (u) => pickCam(easeOut(u)));
  d.span(PICK, STICK, (u) => {
    // left hand thrust out at the lens, fanning the deck
    b.char.root.updateWorldMatrix(true, true);
    const f = headPos(b, new THREE.Vector3());
    const toCam = camPos().clone().sub(f).setY(0).normalize();
    const side = new THREE.Vector3().crossVectors(up, toCam).normalize();
    fanP.copy(f).addScaledVector(toCam, 1.15 * R * 2.2).addScaledVector(side, 0.7 * R * 2.2).add(new THREE.Vector3(0, -1.0 * R * 2.2 * 0.5, 0));
    ch.setReach(1, fanP, Math.min(1, u * 6), 0.4);
    ch.setHandPose('L', 'grip');
  });
  d.at(STICK + 0.3, () => ch.setReach(1, null));
  d.at(PICK + 0.12, () => {
    fan.visible = true;
    opt('cardRiffle', () => sfx.paperTik?.());
  });
  d.every(() => {
    if (!fan.visible) return;
    ch.props.handL.updateWorldMatrix(true, false);
    ch.props.handL.getWorldPosition(fan.position);
    fan.position.y += 0.05;
    fan.lookAt(camPos());
    const open = easeOut(Math.min(1, (d.t - PICK - 0.12) / 0.3));
    fan.children.forEach((p, i) => (p.rotation.z = lerp(0, lerp(0.85, -0.85, i / (fan.children.length - 1)), open)));
  });
  d.stamp(PICK + 0.18, 'PICK A CARD.', { color: '#ffffff', x: 210, y: 92, size: 16, rot: -0.08, dur: 0.75, burst: '#5a1a8a' });
  d.at(PICK + 0.2, () => d.sfx.voice('flashini', 'taunt'));
  talk(d, b, PICK + 0.2, 0.5, 15);
  d.stamp(FIRE - 0.15, 'ANY CARD!', { color: '#ffd23f', x: 450, y: 70, size: 16, rot: 0.1, dur: 0.45 });
  // FIRE: every card flies off the fan at the lens, one after another, spinning
  const n = deck.cards.length;
  deck.cards.forEach((c, i) => {
    const t0 = FIRE + i * 0.055;
    const from = new THREE.Vector3();
    const q0 = new THREE.Quaternion();
    const off = new THREE.Vector2(rand(-0.5, 0.5), rand(-0.3, 0.3));
    const spin = new THREE.Vector3(rand(-14, 14), rand(-14, 14), rand(-20, 20));
    d.span(
      t0,
      t0 + 0.24,
      (u) => {
        if (u >= 1) {
          c.root.visible = false;
          return;
        }
        const cam = d.stage.camera;
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
        const upv = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
        const to = camPos().clone().addScaledVector(camFwd(), 0.35).addScaledVector(right, off.x * 0.4).addScaledVector(upv, off.y * 0.4);
        const e = easeIn(u * 0.5 + 0.5 * u * u);
        c.root.position.lerpVectors(from, to, e);
        c.root.quaternion.copy(q0).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(spin.x * u, spin.y * u, spin.z * u)));
      },
      () => {
        c.root.updateWorldMatrix(true, false);
        c.root.getWorldPosition(from);
        c.root.getWorldQuaternion(q0);
        d.scene.attach(c.root);
        sfx.paperTik?.();
      },
    );
    d.at(t0 + 0.22, () => {
      d.cam.shake(0.12);
      d.cam.punch(-1);
      if (i % 2 === 0) sfx.slap?.();
    });
  });
  d.at(FIRE + n * 0.055, () => (fan.visible = false));
  // the joker comes last, slow and spinning, and slaps flat on the lens
  const jFrom = new THREE.Vector3();
  d.span(
    STICK - 0.3,
    STICK,
    (u) => {
      joker.root.visible = true;
      const cam = d.stage.camera;
      const to = camPos().clone().addScaledVector(camFwd(), 0.5);
      joker.root.position.lerpVectors(jFrom, to, easeIn(u));
      const qEnd = cam.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.12)));
      const tumble = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (1 - u) * 9, (1 - u) * 3));
      joker.root.quaternion.copy(qEnd).multiply(tumble);
    },
    () => {
      ch.props.handL.updateWorldMatrix(true, false);
      ch.props.handL.getWorldPosition(jFrom);
    },
  );
  d.impactFrame(STICK, '#ffffff', 2);
  d.at(STICK, () => {
    d.cam.shake(0.8);
    d.cam.punch(5);
    sfx.slap?.();
    d.sfx.impact();
  });
  d.stamp(STICK + 0.05, 'THWAP!', { color: '#ffd23f', x: 520, y: 290, size: 16, rot: 0.15, dur: 0.5, burst: '#1a1020' });
  // glued to the lens: parented to the camera (shake and all) until it slides off
  d.scene.add(d.stage.camera);
  d.onDispose(() => d.stage.camera.removeFromParent());
  d.span(STICK, SAW, (u) => {
    if (joker.root.parent !== d.stage.camera) d.stage.camera.add(joker.root);
    // it sticks a beat, then peels off and slides down the glass
    const drop = easeIn(Math.max(0, u - 0.45) / 0.55);
    joker.root.position.set(0.02, -drop * 0.45, -0.5);
    joker.root.rotation.set(drop * 0.6, 0, 0.12 + drop * 0.3);
    joker.root.visible = u < 1;
  });
  d.follow(FIRE, SAW, (u) => pickCam(1 - 0.15 * u));

  // ================= SAWED IN HALF (5.45 - 6.85) =================
  const cut = buildCutout();
  const CX = H0.x + 0.9;
  const CZ = LANE + 1.75;
  cut.root.position.set(CX, 0, CZ);
  cut.root.visible = false;
  d.scene.add(cut.root);
  d.at(SAW - 0.01, () => (cut.root.visible = true));
  const saw = buildSaw();
  saw.scale.setScalar(1.5);
  saw.visible = false;
  d.scene.add(saw);
  const sawHand = new THREE.Vector3();
  const sawQ = new THREE.Quaternion().setFromRotationMatrix(
    // saw +X (blade) along world +Z (through the board), +Y up, +Z = world -X
    new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0)),
  );
  const SAW_END = SPLIT - 0.05;
  d.at(SAW, () => {
    saw.visible = true;
    ch.setHandPose('R', 'grip');
    ch.props.wand.visible = false;
    d.sfx.voice('flashini', 'yell');
  });
  d.span(SAW, SAW_END, (u) => {
    const strokes = Math.sin(u * Math.PI * 9);
    const yCut = lerp(1.95, 0.55, easeInOut(u));
    sawHand.set(CX, yCut + 0.2, CZ - 0.65 + strokes * 0.3);
    ch.setReach(-1, sawHand, Math.min(1, u * 8), 0.5);
    ch.props.handR.updateWorldMatrix(true, false);
    ch.props.handR.getWorldPosition(saw.position);
    saw.position.y -= 0.12;
    saw.quaternion.copy(sawQ).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.15 + strokes * 0.05)));
    if (Math.random() < 0.8)
      d.fx.sparks(new THREE.Vector3(CX, yCut, CZ + 0.05), 2, { color: 0xe8c08a, size: 0.05, life: 0.5, spread: 2, gravity: 6, vel: { x: rand(-1, 1), y: 1, z: 1.5 } });
  });
  for (let i = 0; i < 5; i++) d.at(SAW + 0.05 + i * ((SAW_END - SAW) / 4.6), () => opt('saw', () => sfx.crumple?.()));
  d.stamp(SAW + 0.25, 'ZZK! ZZK!', { color: '#ffffff', x: 450, y: 250, size: 16, rot: 0.1, dur: 0.6, burst: '#b07a40' });
  d.stamp(SAW + 0.75, 'ZZRRK!', { color: '#ffffff', x: 180, y: 240, size: 16, rot: -0.12, dur: 0.45, burst: '#b07a40' });
  // 3/4 view so the blade reads through the board
  d.follow(SAW, TADA, (u) => {
    const e = easeInOut(u);
    const pos = new THREE.Vector3(CX + lerp(4.4, 4.0, e), lerp(2.6, 2.45, e), CZ + lerp(2.9, 2.5, e));
    const look = new THREE.Vector3(CX - 0.4, lerp(2.0, 1.75, e), CZ - 0.7);
    return { pos, look, fov: 42, roll: lerp(0.04, -0.03, e) };
  });
  d.span(SPLIT, TADA, (u) => cut.split(easeOut(u)));
  d.at(SPLIT, () => {
    d.cam.shake(0.6);
    d.cam.punch(-4);
    sfx.rip?.();
    d.sfx.impact();
    ch.setReach(-1, null);
    ch.setLaugh(0.6);
    d.fx.sparks(new THREE.Vector3(CX, 1.0, CZ + 0.2), 20, { color: 0xe8c08a, size: 0.06, life: 0.6, spread: 4, gravity: 6 });
  });
  d.stamp(SPLIT + 0.03, 'HALF OFF!', { color: '#ffd23f', x: 320, y: 100, size: 24, rot: -0.1, dur: 0.6, burst: '#e8413c' });
  // the saw gets tossed over his shoulder
  d.at(TADA - 0.1, () => {
    cut.root.visible = false;
    ch.setLaugh(0);
    ch.props.wand.visible = true;
  });

  // ================= TA-DA! (6.85 - card): slow-mo, blinding flash, rays, sparkles, wings, doves =================
  d.slowmo(TADA + 0.05, TADA + 0.95, 0.15, 0.18);
  d.at(TADA, () => {
    ch.setTaDa(1);
    saw.visible = false; // gone in the flash
    d.flash('#fff4c0', 1, 3.6);
    d.cam.shake(0.6);
    d.cam.punch(-6);
    opt('taDa', () => sfx.flashPop?.());
    d.sfx.signature('flashini');
    d.sfx.voice('flashini', 'yell');
    d.hype = 1;
  });
  d.impactFrame(TADA, '#ffffff', 3);
  d.stamp(TADA + 0.12, 'TA-DA!', { color: '#ffd23f', x: 200, y: 92, size: 24, rot: -0.12, dur: 1.0, burst: '#5a1a8a' });
  // gold rays fanning behind him
  const ray = rays(GOLD, 18, 14, { opacity: 0.4 });
  ray.visible = false;
  d.scene.add(ray);
  const ray2 = rays(0xff4fa3, 18, 14, { opacity: 0.18 });
  ray.add(ray2);
  ray2.rotation.z = Math.PI / 18;
  d.span(TADA, CARD + 4, (u) => {
    headPos(b, H);
    ray.visible = true;
    const toCam = camPos().clone().sub(H).normalize();
    ray.position.copy(H).addScaledVector(toCam, -1.6).add(new THREE.Vector3(0, -0.2, 0));
    ray.lookAt(camPos());
    ray.rotateZ(d.wt * 0.4);
    ray.scale.setScalar(Math.min(1, (d.t - TADA) * 4));
    void u;
  });
  // sparkle storm (real time so it keeps glittering through the slow-mo)
  d.every((dt) => {
    if (d.t < TADA || d.t > CARD + 3) return;
    headPos(b, H);
    const k = d.t < TADA + 1.2 ? 1 : 0.4;
    if (Math.random() < 0.6 * k)
      d.sparkle(H.clone().add(new THREE.Vector3(rand(-3, 3), rand(-1.5, 2.2), rand(-0.5, 1.5))), Math.round(rand(8, 16)), Math.random() < 0.5 ? '#ffd23f' : '#ffffff');
    if (Math.random() < 0.5 * k) d.fx.sparks(H.clone().add(new THREE.Vector3(rand(-1.2, 1.2), rand(-0.4, 1.2), 0.4)), 2, { color: Math.random() < 0.5 ? GOLD : 0xffffff, spread: 5, gravity: 2 });
    void dt;
  });
  // hero framing: low, a touch wide, his V and wings filling the frame
  d.follow(TADA, PLOP, (u) => {
    const e = easeOut(u);
    const f = faceCam(b, lerp(7.2, 8.6, e), lerp(0.1, 0.05, e), lerp(-2.2, -1.8, e), lerp(-0.4, -0.7, e));
    return { ...f, fov: 46, roll: lerp(0.08, 0.02, e) };
  });
  // doves burst out of the cape
  const doves = [0, 1, 2, 3, 4].map(() => buildDove());
  doves.forEach((dv, i) => {
    dv.root.visible = false;
    d.scene.add(dv.root);
    const t0 = TADA + 0.08 + i * 0.04;
    const sgn = i % 2 ? 1 : -1;
    const dir = new THREE.Vector3(sgn * rand(1.2, 2.6) * (0.5 + i * 0.2), rand(3.0, 4.0), rand(0.2, 0.8));
    const from = new THREE.Vector3();
    d.span(
      t0,
      PLOP + 0.5,
      () => {
        const t = d.wt - (dv.root.userData.w0 as number);
        dv.root.visible = true;
        dv.root.position.copy(from).addScaledVector(dir, t * 1.0).add(new THREE.Vector3(0, t * t * 0.4, 0));
        dv.root.lookAt(dv.root.position.clone().add(dir));
        dv.flap(d.wt * 1.0 + i);
        dv.root.scale.setScalar(Math.min(1.2, (d.wt - (dv.root.userData.w0 as number)) * 8));
      },
      () => {
        ch.props.hat.updateWorldMatrix(true, false);
        ch.props.hat.localToWorld(from.set(0, 0.75, 0));
        dv.root.userData.w0 = d.wt;
      },
    );
  });
  d.at(TADA + 0.15, () => opt('coo'));
  // ...and one flies right over the lens. PLOP.
  const jerkDove = buildDove();
  jerkDove.root.visible = false;
  d.scene.add(jerkDove.root);
  const jdFrom = new THREE.Vector3();
  d.span(
    PLOP - 0.45,
    PLOP + 0.15,
    (u) => {
      jerkDove.root.visible = d.t < PLOP - 0.06;
      const to = camPos().clone().addScaledVector(camFwd(), 0.6).add(new THREE.Vector3(0, 1.0, 0));
      jerkDove.root.position.lerpVectors(jdFrom, to, easeIn(Math.min(1, u * 1.1)));
      jerkDove.root.lookAt(camPos().clone().add(new THREE.Vector3(0, 1.2, 0)));
      jerkDove.flap(d.t * 1.3);
      jerkDove.root.scale.setScalar(1.3);
    },
    () => {
      headPos(b, jdFrom);
      jdFrom.y += R * 2.5;
      opt('coo');
    },
  );
  d.lensSplat(PLOP, '#fbfbff', '#ffffff');
  d.at(PLOP, () => {
    sfx.splat?.();
    d.cam.shake(0.3);
  });
  d.stamp(PLOP + 0.05, 'PLOP.', { color: '#ffffff', x: 470, y: 250, size: 16, rot: 0.12, dur: 0.6, burst: '#1a1020' });
  d.at(PLOP - 0.2, () => {
    ch.setTaDa(0);
    ch.setLaugh(1);
    d.sfx.voice('flashini', 'laugh');
  });
  talk(d, b, PLOP - 0.2, CARD - PLOP + 0.3, 18);

  // ---------- card: him in the right third, head in the upper half ----------
  const cardCam = (u: number) => {
    const f = faceCam(b, lerp(10, 11.5, easeOut(u)), lerp(-0.3, -0.4, u), lerp(-0.8, -1.0, u), -1.0);
    const toCam = f.pos.clone().sub(H0).setY(0).normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(toCam).normalize();
    f.look.addScaledVector(right, -2.5);
    return { ...f, fov: 42, roll: lerp(0.05, -0.03, u) };
  };
  d.follow(PLOP, CARD + 4, (u) => cardCam(Math.min(1, u * 1.4)));
  d.at(CARD - 0.05, () => {
    ch.setLaugh(0);
    b.char.setSignature(1);
  });
  d.freeze(CARD, 0.25, 0.6);
  d.at(CARD + 0.7, () => d.sfx.voice('flashini', 'taunt'));
  d.nameCard(CARD, { ...card, color: '#5a1a8a', accent: '#ffd23f' }, 1.1, 'flashini');
}
