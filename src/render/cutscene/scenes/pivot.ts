// PROFESSOR PIVOT: a pedant who failed you before you arrived. School bell. His tweed-brown wedge screams in
// with a chalkboard bolted to the roof and slides to a stop in a chalk-dust explosion ("CLASS IS IN SESSION.").
// He lectures you: every WHACK of his pointer on the board makes the green SHIFT window jump somewhere else
// (his Drifting Window), and he looks down his nose at you about it. Then he grades your test: three huge
// red-chalk strokes, a giant "F", skewers the paper on the pointer and, in slow-mo, rams it onto the lens
// ("WRONG."). "SEE ME AFTER CLASS." thunks onto the paper, which peels away; one last WHACK fills the screen
// with chalk dust and, as it clears, he adjusts his monocle (SHING). Card: him in the right third, nose up.
import * as THREE from 'three';
import { Director, easeBack, easeInOut, easeOut, lerp, seg, type CardInfo } from '../director';
import { buildBossCar, buildCharacter } from '../models';
import type { CarRigX } from '../models/car';
import type { PivotRig } from '../models/pivot';
import { buildDragStrip, glowSprite, glowTexture } from '../stage';
import { faceCam, harshJerk, headPos, headR, mountBoss, rate, rays, rearPoints } from './common';

type Sfx = Record<string, ((...a: unknown[]) => void) | undefined>;

// ---- timeline (real seconds) ----
const STOP = 1.15; // dead stop, chalk explosion
const WHACK = [1.75, 2.15, 2.55]; // lecture whacks: the shift window jumps on each
const WRITE = 3.05; // F: three strokes
const STROKES = [3.12, 3.4, 3.62];
const SKEWER = 3.95; // stab the paper off the board
const RAM0 = 4.15; // swing at the lens (slow-mo)
const RAM = 4.8; // paper hits the glass
const SEEME = 5.5; // "SEE ME AFTER CLASS." thunks onto the paper
const PEEL = 6.0; // paper peels off the lens
const BOOM = 6.45; // last whack: chalk dust fills the frame
const MONO = 6.95; // monocle adjust, SHING
const CARD = 7.85;

const CHALK = '#f4f2e8';

/** Chalkboard canvas: header, the tach with its drifting green window, sliding equations, the pinned test. */
function drawBoard(g: CanvasRenderingContext2D, w: number, h: number, win: number, t: number, paper: boolean) {
  g.fillStyle = '#23402f';
  g.fillRect(0, 0, w, h);
  // smudges
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 7; i++) g.fillRect((i * 83) % w, (i * 47) % h, 90, 22);
  g.strokeStyle = CHALK;
  g.fillStyle = CHALK;
  g.lineCap = 'round';
  g.font = 'bold 34px "Press Start 2P", monospace';
  g.textAlign = 'left';
  g.fillText('LESSON 1', 22 + Math.sin(t * 1.3) * 4, 52);
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(20, 64);
  g.lineTo(300, 66);
  g.stroke();
  // the tach: an arc of ticks, the green window wherever he says it is today
  const cx = 150, cy = 210, r = 96;
  const a0 = Math.PI * 0.95, a1 = Math.PI * 2.05;
  g.lineWidth = 5;
  g.beginPath();
  g.arc(cx, cy, r, a0, a1);
  g.stroke();
  for (let i = 0; i <= 8; i++) {
    const a = a0 + ((a1 - a0) * i) / 8;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14));
    g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.stroke();
  }
  const wa = a0 + (a1 - a0) * win;
  g.strokeStyle = '#5cff7a';
  g.lineWidth = 16;
  g.beginPath();
  g.arc(cx, cy, r - 6, wa - 0.17, wa + 0.17);
  g.stroke();
  g.fillStyle = '#5cff7a';
  g.font = 'bold 18px "Press Start 2P", monospace';
  g.textAlign = 'center';
  g.fillText('SHIFT', cx + Math.cos(wa) * (r + 30), cy + Math.sin(wa) * (r + 30) + 6);
  // needle + arrow
  g.strokeStyle = CHALK;
  g.lineWidth = 4;
  g.beginPath();
  g.moveTo(cx, cy);
  g.lineTo(cx + Math.cos(wa) * (r - 22), cy + Math.sin(wa) * (r - 22));
  g.stroke();
  // sliding equations (they never stay put)
  g.fillStyle = CHALK;
  g.textAlign = 'left';
  g.font = 'bold 20px "Press Start 2P", monospace';
  const lines = paper ? ['RPM+YOU=F', 'x = ???', 'dW/dt > 0'] : ['RPM+YOU=F', 'x = ???', 'dW/dt > 0', 'u r late'];
  lines.forEach((s, i) => {
    const x = 300 + Math.sin(t * (1.7 + i * 0.6) + i * 2) * 26 + (paper ? -10 : 0);
    g.fillText(s, Math.min(x, paper ? 300 : 330), 120 + i * 40 + Math.sin(t * 2.2 + i) * 4);
  });
}

/** The pop quiz: lined paper, crossed-out answers, the giant red F (k 0..3 strokes), "SEE ME" (0..1). */
function drawPaper(g: CanvasRenderingContext2D, w: number, h: number, f: number, seeMe: number) {
  g.fillStyle = '#fbf7ea';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = '#9cc4ea';
  g.lineWidth = 2;
  for (let y = 70; y < h; y += 26) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(w, y);
    g.stroke();
  }
  g.strokeStyle = '#f08a9a';
  g.beginPath();
  g.moveTo(34, 0);
  g.lineTo(34, h);
  g.stroke();
  g.fillStyle = '#20263a';
  g.font = 'bold 16px "Press Start 2P", monospace';
  g.textAlign = 'left';
  g.fillText('POP QUIZ', 46, 36);
  g.font = 'bold 10px "Press Start 2P", monospace';
  g.fillText('NAME: you', 46, 60);
  ['1. SHIFT AT?', '2. WHEN??', '3. WHY?!'].forEach((s, i) => g.fillText(s, 46, 92 + i * 52));
  // red X's on every answer
  g.strokeStyle = '#e0202e';
  g.lineWidth = 5;
  for (let i = 0; i < 3; i++) {
    const x = w - 46, y = 110 + i * 52;
    g.beginPath();
    g.moveTo(x - 12, y - 12);
    g.lineTo(x + 12, y + 12);
    g.moveTo(x + 12, y - 12);
    g.lineTo(x - 12, y + 12);
    g.stroke();
  }
  // the F: three fat strokes (down, top bar, middle bar) + a circle
  g.lineWidth = 26;
  g.lineCap = 'round';
  g.strokeStyle = '#e8101e';
  const fx = 74, fy = 110;
  const k1 = Math.min(1, f), k2 = Math.min(1, Math.max(0, f - 1)), k3 = Math.min(1, Math.max(0, f - 2));
  if (k1 > 0) {
    g.beginPath();
    g.moveTo(fx, fy);
    g.lineTo(fx - 4, fy + 200 * k1);
    g.stroke();
  }
  if (k2 > 0) {
    g.beginPath();
    g.moveTo(fx, fy);
    g.lineTo(fx + 130 * k2, fy - 6 * k2);
    g.stroke();
  }
  if (k3 > 0) {
    g.beginPath();
    g.moveTo(fx - 2, fy + 90);
    g.lineTo(fx - 2 + 95 * k3, fy + 86);
    g.stroke();
    g.lineWidth = 7;
    g.beginPath();
    g.ellipse(fx + 56, fy + 100, 110, 140, -0.1, -Math.PI * 0.6, -Math.PI * 0.6 + Math.PI * 2 * k3);
    g.stroke();
  }
  if (seeMe > 0) {
    g.save();
    g.translate(w / 2, h - 40);
    g.rotate(-0.12);
    g.globalAlpha = Math.min(1, seeMe * 2);
    const s = 1 + 0.6 * Math.max(0, 1 - seeMe * 3);
    g.scale(s, s);
    g.strokeStyle = '#e8101e';
    g.lineWidth = 5;
    g.strokeRect(-112, -30, 224, 54);
    g.fillStyle = '#e8101e';
    g.font = 'bold 14px "Press Start 2P", monospace';
    g.textAlign = 'center';
    g.fillText('SEE ME AFTER', 0, -6);
    g.fillText('CLASS.', 0, 16);
    g.restore();
  }
}

export default function pivot(d: Director, card: CardInfo) {
  const sx = d.sfx as unknown as Sfx;
  const set = buildDragStrip(d.stage, { haze: 0x241c18, fogNear: 30, fogFar: 170 });
  d.crowd = set.crowd;
  // harsh from frame 0: a lamp-amber rim on one side, chalkboard green on the other
  d.look(0, harshJerk(0xffb040, 0x5cff9a));

  const carRig = buildBossCar('pivot') as CarRigX;
  const b = mountBoss(d, carRig, buildCharacter('pivot'), 2.3);
  const car = b.car.root;
  const x = b.char as PivotRig;
  const LANE = 2.6;
  const X0 = -42;
  car.position.set(X0, 0, LANE);

  // ---- car decoration: a chalkboard bolted to the roof behind him, an apple on the hood ----
  const body = carRig.body;
  const seatP = carRig.seat.position;
  const BW = 2.3, BH = 1.3;
  const board = new THREE.Group();
  board.position.set(seatP.x - 1.25, b.roofY + 0.95, -0.15);
  board.rotation.y = 0.12;
  body.add(board);
  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = 512;
  boardCanvas.height = 290;
  const bg = boardCanvas.getContext('2d')!;
  const boardTex = new THREE.CanvasTexture(boardCanvas);
  boardTex.colorSpace = THREE.SRGBColorSpace;
  const slate = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), new THREE.MeshBasicMaterial({ color: 0xd8d8d8, map: boardTex }));
  slate.userData.noOutline = true;
  board.add(slate);
  const woodM = new THREE.MeshStandardMaterial({ color: 0xa8743e, roughness: 0.6 });
  for (const [w, h, px, py] of [[BW + 0.2, 0.1, 0, BH / 2 + 0.05], [BW + 0.2, 0.12, 0, -BH / 2 - 0.06], [0.1, BH + 0.2, -BW / 2 - 0.05, 0], [0.1, BH + 0.2, BW / 2 + 0.05, 0]] as const) {
    const fr = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.1), woodM);
    fr.position.set(px, py, 0.02);
    board.add(fr);
  }
  const ledge = new THREE.Mesh(new THREE.BoxGeometry(BW * 0.8, 0.05, 0.16), woodM);
  ledge.position.set(0, -BH / 2 - 0.1, 0.1);
  board.add(ledge);
  for (const px of [-0.7, 0.7]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.1, 8), new THREE.MeshStandardMaterial({ color: 0x3a3a44, metalness: 0.6, roughness: 0.3 }));
    post.position.set(px, -BH / 2 - 0.45, -0.06);
    board.add(post);
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 6), new THREE.MeshStandardMaterial({ color: 0xc9ced8, metalness: 0.8, roughness: 0.2 }));
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(px, -BH / 2 + 0.06, 0.06);
    board.add(bolt);
  }
  // the pinned test paper on the board's right half
  const paperCanvas = document.createElement('canvas');
  paperCanvas.width = 256;
  paperCanvas.height = 320;
  const pg = paperCanvas.getContext('2d')!;
  const paperTex = new THREE.CanvasTexture(paperCanvas);
  paperTex.colorSpace = THREE.SRGBColorSpace;
  const PW = 0.84, PH = 1.05;
  const paperMat = new THREE.MeshBasicMaterial({ color: 0xd0d0d0, map: paperTex, side: THREE.DoubleSide });
  const paper = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), paperMat);
  paper.userData.noOutline = true;
  paper.position.set(-BW / 2 + 0.58, -0.02, 0.03);
  paper.rotation.z = 0.05;
  board.add(paper);
  const pin = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshStandardMaterial({ color: 0xe8202e }));
  pin.position.set(0, PH / 2 - 0.06, 0.03);
  paper.add(pin);
  // the teacher's apple on the hood
  const apple = new THREE.Group();
  const appleBody = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12), new THREE.MeshStandardMaterial({ color: 0xe0202a, roughness: 0.25 }));
  appleBody.scale.set(1, 0.9, 1);
  apple.add(appleBody);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.14, 6), new THREE.MeshStandardMaterial({ color: 0x5a3a1a }));
  stem.position.y = 0.27;
  apple.add(stem);
  const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshStandardMaterial({ color: 0x4ac040 }));
  leaf.scale.set(1.4, 0.3, 0.7);
  leaf.position.set(0.08, 0.3, 0);
  apple.add(leaf);
  apple.position.set(b.size.x * 0.33, b.roofY - 0.25, 0);
  body.add(apple);
  d.onDispose(() => {
    boardTex.dispose();
    paperTex.dispose();
  });
  // toon + outline the new car parts (the car rig is already converted, so convert the decorations now)
  d.rig({ root: board, update() {}, dispose() {} } as unknown as Parameters<typeof d.rig>[0]);
  d.rig({ root: apple, update() {}, dispose() {} } as unknown as Parameters<typeof d.rig>[0]);

  // the lens copy of the paper (stuck to the glass after the ram)
  const lensMat = new THREE.MeshBasicMaterial({ color: 0xdedede, map: paperTex, transparent: true, depthTest: false, depthWrite: false, fog: false });
  const lensPaper = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.094), lensMat);
  lensPaper.renderOrder = 999;
  const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthTest: false, depthWrite: false, fog: false });
  const lensShadow = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.094), shadowMat);
  lensShadow.renderOrder = 998;
  lensPaper.visible = lensShadow.visible = false;
  lensPaper.frustumCulled = lensShadow.frustumCulled = false;
  d.scene.add(lensPaper, lensShadow);
  d.onDispose(() => {
    lensMat.dispose();
    shadowMat.dispose();
    lensPaper.geometry.dispose();
    lensShadow.geometry.dispose();
  });
  let lensOn = false;

  // monocle glint rays + a sunburst behind him for the card
  const ray = rays(0xfff2c0, 16, 10);
  ray.visible = false;
  d.scene.add(ray);
  const gtex = glowTexture();
  const glint = glowSprite(gtex, 0xffffff, 0.6, 0);
  d.scene.add(glint);
  d.onDispose(() => gtex.dispose());

  // ---- state redrawn each frame ----
  const st = { win: 0.62, winTo: 0.62, f: 0, seeMe: 0 };
  let lastKey = '';
  const redraw = () => {
    const key = `${Math.round(d.t * 30)}|${st.f.toFixed(2)}|${st.seeMe.toFixed(2)}|${st.win.toFixed(3)}`;
    if (key === lastKey) return;
    lastKey = key;
    drawBoard(bg, boardCanvas.width, boardCanvas.height, st.win, d.t, paper.parent === board);
    boardTex.needsUpdate = true;
    drawPaper(pg, paperCanvas.width, paperCanvas.height, st.f, st.seeMe);
    paperTex.needsUpdate = true;
  };

  // ---- body control, applied after the rig poses each frame ----
  // lecture: right arm up and out to the board (pointer rides the arm); whack: a snap down onto it.
  const pose = { lect: 0, whack: 0, write: 0, ram: 0, lunge: 0, wx: 0, wy: 0, card: 0 };
  const rootZ = b.char.root.position.z;
  const rigUpdate = b.char.update.bind(b.char);
  b.char.update = (dt: number) => {
    rigUpdate(dt);
    b.char.root.position.z = rootZ + 0.55 * pose.lunge;
    b.char.root.rotation.x = 0.2 * pose.lunge;
    // right arm (character's right = toward the car's rear and the board)
    const up = pose.lect * (1 - pose.ram);
    b.char.armR.rotation.set(
      -0.35 * up - 0.2 * pose.write + pose.wy - 1.45 * pose.ram + 0.4 * pose.card,
      0.2 * up,
      -1.95 * up + 0.55 * pose.whack - 0.15 * pose.write + pose.wx + 0.3 * pose.ram - 2.2 * pose.card,
    );
    b.char.armL.rotation.set(-0.5 * pose.lect * (1 - pose.ram) - 0.4 * pose.ram, 0, 0.35 * pose.lect + 0.3 * pose.ram);
  };

  const H = new THREE.Vector3();
  const tipW = new THREE.Vector3();
  const tip = x.props.pointerTip;
  const camAhead = (ox: number, oy: number, oz: number) =>
    d.stage.camera.position.clone().add(new THREE.Vector3(ox, oy, oz).applyQuaternion(d.stage.camera.quaternion));
  const smoke = rate(140);
  const chalkTrail = rate(60);

  d.every((dt, wdt) => {
    x.setBeatDt?.(dt);
    x.setTurn?.(1); // jerk, start to finish
    redraw();
    const cam = d.stage.camera;
    // slide smoke + chalk dust streaming off the board on the run in
    const sliding = d.t > 0.45 && d.t < STOP;
    const n = smoke(wdt, sliding ? 1 : 0);
    const pts = rearPoints(b);
    for (let i = 0; i < n; i++) d.fx.smoke(pts[i % 2], 1, { vel: { x: -3, y: 1.2, z: 0 }, size: 0.8, spread: 1.2, outline: false });
    const m = chalkTrail(wdt, d.t < STOP ? 1 : 0);
    if (m) {
      const bp = Director.wp(board);
      for (let i = 0; i < m; i++) d.fx.smoke(bp, 1, { vel: { x: -6, y: 1.2, z: 0 }, spread: 2.2, size: 0.25, grow: 2.5, color: 0xf6f4ec, outline: false, life: 0.6 });
    }
    headPos(b, H);
    if (ray.visible) {
      ray.position.copy(H).addScaledVector(H.clone().sub(cam.position).normalize(), 4);
      ray.lookAt(cam.position);
      ray.rotateZ(d.wt * 1.5);
    }
    // the paper skewered on the pointer tip
    if (paper.parent !== board && !lensOn && paper.visible && !flying) {
      Director.wp(tip, tipW);
      paper.position.copy(tipW);
      paper.quaternion.copy(cam.quaternion);
      paper.rotateZ(0.15);
    }
    lensPaper.visible = lensShadow.visible = lensOn;
    if (lensOn && d.t >= PEEL + 0.45) lensOn = false;
  });
  // Placed at render time against the camera actually drawing (no one-frame lag on cuts).
  lensShadow.onBeforeRender = (_r, _s, cam) => {
    const a = d.t - RAM;
    const k = 1 + 0.25 * Math.exp(-a * 18) * Math.cos(a * 50);
    // peel: slides down and tips off the glass
    const p = easeInOut(seg(d.t, PEEL, PEEL + 0.45));
    const at = (o: THREE.Object3D, ox: number, oy: number, oz: number) => {
      o.position.copy(cam.position).add(new THREE.Vector3(ox, oy, oz).applyQuaternion(cam.quaternion));
      o.quaternion.copy(cam.quaternion);
      o.rotateZ(0.14 + 0.02 * Math.sin(a * 3) + 0.5 * p);
      o.rotateX(-0.6 * p);
      o.scale.setScalar(k);
      o.updateMatrixWorld();
    };
    at(lensPaper, -0.062, 0.012 - 0.16 * p * p, -0.2);
    at(lensShadow, -0.06, 0.009 - 0.16 * p * p, -0.201);
  };

  // ---- car: screaming in, flick sideways, dead stop ----
  const END_X = 2.5;
  const YAW = 0.55; // drift kick, then it straightens out broadside to us
  d.span(0, STOP, (u) => {
    const k = 1 - Math.pow(1 - u, 2.4);
    car.position.x = lerp(X0, END_X, k);
    const yu = seg(u, 0.4, 1);
    car.rotation.y = -YAW * Math.sin(Math.PI * yu) * (1 - 0.35 * yu);
    b.car.setWheelSpin(lerp(90, 8, u), lerp(140, 30, u));
    b.car.setSteer(yu > 0 && yu < 1 ? -0.5 : 0);
    b.car.setLean(yu > 0 ? 0.12 * (1 - u) : 0, 0);
  });
  d.at(0.4, () => d.sfx.drift(0.8));
  d.span(STOP + 0.1, STOP + 0.9, (u) => {
    const w = u * Math.PI * 2 * 3;
    const a = (1 - u) * (1 - u);
    b.car.setLean(Math.sin(w) * 0.13 * a, Math.sin(w + 0.6) * 0.05 * a);
    b.car.setWheelSpin(0, 0);
    b.car.setSteer(0);
  });
  // board wobbles on its bolts after the stop
  d.span(STOP, STOP + 0.9, (u) => {
    board.rotation.z = Math.sin(u * 30) * 0.12 * (1 - u) * (1 - u);
  });
  const chalkBurst = (n: number, size: number, speed: number) => {
    const bp = Director.wp(board);
    for (let i = 0; i < n; i++)
      d.fx.smoke(bp, 1, {
        vel: { x: (Math.random() - 0.5) * speed, y: Math.random() * speed * 0.6, z: (Math.random() - 0.3) * speed },
        spread: 1.5, size: size * (0.7 + Math.random() * 0.6), grow: 1.8, color: 0xffffff, outline: i % 3 === 0, life: 0.75, drag: 3,
      });
    d.fx.dust(bp, n, { color: 0xffffff, size: size, grow: 2, spread: speed * 0.8, life: 0.8 });
    d.fx.sparks(bp, 16, { color: 0xffffff, vel: { x: 0, y: 2, z: 2 }, spread: 5, gravity: 6, size: 0.06 });
  };
  d.at(STOP, () => {
    d.cam.shake(0.9);
    d.cam.punch(-9);
    const pts = rearPoints(b);
    d.fx.smoke(pts[0], 12, { size: 1, vel: { x: -4, y: 1.5, z: -2 }, outline: false });
    chalkBurst(12, 0.55, 5);
    d.sfx.roar('pivot');
    sx.schoolBell?.();
    d.hype = 0.9;
  });
  d.impactFrame(STOP, '#ffffff', 2);
  d.at(STOP, () => d.flash('#ffffff', 0.8, 10));
  d.stamp(STOP + 0.03, 'CLASS IS\nIN SESSION.', { color: CHALK, x: 330, y: 84, size: 24, rot: -0.1, dur: 0.6, burst: '#2a6a44' });

  // ---- camera: the run in ----
  d.bars(true);
  const look = new THREE.Vector3();
  d.cut(0, [X0 + 34, 0.55, LANE + 3.2], [X0, 1.0, LANE], 26);
  d.at(0, () => {
    x.setPointer(1);
    x.setHandPose('L', 'open');
    d.hype = 0.4;
    sx.schoolBell?.();
  });
  d.follow(0, 0.62, (u) => {
    look.set(car.position.x, 1.1, LANE);
    return { pos: new THREE.Vector3(X0 + 34, 0.55, LANE + 3.2), look, fov: lerp(26, 40, u), roll: lerp(0.06, -0.12, u) };
  });
  d.at(0.5, () => {
    d.cam.shake(0.7);
    d.cam.punch(6);
    d.flash('#ffffff', 0.3, 10);
    d.speedLines = 1;
  });
  d.follow(0.62, STOP, (u) => {
    look.set(car.position.x - 0.6, 1.4, LANE - 0.4);
    return { pos: new THREE.Vector3(lerp(16, 13.5, u), 1.1, 5.4), look, fov: lerp(24, 34, easeInOut(u)), roll: -0.08 };
  });

  // ---- LECTURE: medium two-shot of him and the board; WHACK x3, the window jumps each time ----
  d.follow(STOP, WRITE - 0.1, (u) => {
    const bp = Director.wp(board);
    headPos(b, H);
    const mid = bp.clone().lerp(H, 0.55);
    const pos = mid.clone().add(new THREE.Vector3(0.8, -0.4, lerp(8.6, 7.6, easeOut(u))));
    return { pos, look: mid.setY(mid.y - 0.15), fov: 34, roll: 0.05 };
  });
  d.span(STOP + 0.15, WHACK[0] - 0.12, (u) => (pose.lect = easeBack(u)));
  d.at(STOP + 0.2, () => x.setScold(1));
  d.at(STOP + 0.25, () => {
    d.sfx.voice('pivot', 'yell');
    talk(STOP + 0.25, 0.4, 13);
  });
  const WINS = [0.18, 0.88, 0.4];
  WHACK.forEach((t, i) => {
    // wind up then snap down onto the board
    d.span(t - 0.16, t, (u) => (pose.whack = -0.5 * Math.sin(u * Math.PI * 0.5) + 1.0 * easeOut(seg(u, 0.55, 1))));
    d.span(t, t + 0.2, (u) => (pose.whack = 0.5 * (1 - easeInOut(u))));
    d.at(t, () => {
      st.win = WINS[i];
      d.cam.shake(0.45);
      d.cam.punch(-4);
      sx.chalkWhack?.();
      d.sfx.slap();
      Director.wp(tip, tipW);
      d.fx.smoke(tipW, 6, { vel: { x: 0, y: 0.6, z: 1.2 }, spread: 1, size: 0.35, grow: 2, color: 0xf8f6ee, outline: false, life: 0.9, drag: 2 });
      d.fx.sparks(tipW, 10, { color: 0x5cff7a, vel: { x: 0, y: 1.5, z: 1.5 }, spread: 3, gravity: 6, size: 0.06 });
      board.rotation.z = (i % 2 ? 1 : -1) * 0.05;
    });
    d.span(t, t + 0.3, (u) => (board.rotation.z = (i % 2 ? 1 : -1) * 0.05 * (1 - u) * Math.cos(u * 20)));
    d.impactFrame(t, 'invert', 1);
  });
  d.stamp(WHACK[0] + 0.02, 'WHACK', { color: CHALK, x: 140, y: 110, size: 16, rot: -0.15, dur: 0.35 });
  d.stamp(WHACK[1] + 0.02, 'WHACK!', { color: CHALK, x: 170, y: 150, size: 16, rot: 0.12, dur: 0.35 });
  d.stamp(WHACK[2] + 0.02, 'PAY\nATTENTION!', { color: '#5cff7a', x: 470, y: 80, size: 24, rot: -0.1, dur: 0.5, burst: '#1a3a28' });
  d.at(WHACK[1] + 0.1, () => talk(WHACK[1] + 0.1, 0.35, 14));
  d.at(WHACK[2] + 0.1, () => {
    x.setScold(0);
    talk(WHACK[2] + 0.1, 0.35, 14);
  });

  // ---- THE F: tight on the paper + his face, three huge red strokes ----
  d.follow(WRITE - 0.1, SKEWER + 0.05, (u) => {
    const pp = Director.wp(paper);
    headPos(b, H);
    const mid = pp.clone().lerp(H, 0.4);
    return { pos: mid.clone().add(new THREE.Vector3(0.5, -0.1, lerp(5.6, 5.0, u))), look: mid, fov: 32, roll: -0.06 };
  });
  d.at(WRITE, () => {
    d.sfx.signature('pivot'); // chalk screech + pointer slap
    d.sfx.scribble(SKEWER - WRITE - 0.1);
    x.setScold(0.6);
  });
  d.span(WRITE - 0.1, WRITE + 0.05, (u) => (pose.write = easeOut(u)));
  STROKES.forEach((t, i) => {
    const dur = 0.16;
    d.span(t, t + dur, (u) => {
      st.f = i + easeOut(u);
      // the arm scrawls: down stroke, then two sideways bars
      if (i === 0) (pose.wy = 0), (pose.wx = 0.35 * u);
      else (pose.wx = 0.35 - 0.25 * Math.sin(u * Math.PI)), (pose.wy = -0.15 * u * (i === 1 ? 1 : 0.5));
    });
    d.at(t, () => d.cam.shake(0.25));
  });
  d.stamp(STROKES[0] + 0.05, 'SCRAWL', { color: '#ff3a4a', x: 150, y: 90, size: 16, rot: -0.12, dur: 0.3 });
  d.stamp(STROKES[2] + 0.12, 'GRADE: F', { color: '#ff2a3a', x: 480, y: 80, size: 16, rot: 0.1, dur: 0.5, burst: '#fbf7ea' });
  d.at(STROKES[2] + 0.15, () => {
    x.setScold(0);
    x.setSmug(0.6);
    d.sfx.voice('pivot', 'laugh');
    talk(STROKES[2] + 0.15, 0.3, 16);
  });

  // ---- SKEWER: stab the paper off the board; RAM: swing it into the lens in slow-mo ----
  let flying = false;
  d.at(SKEWER, () => {
    x.setSmug(0);
    d.scene.attach(paper);
    sx.rip?.();
    d.cam.punch(-3);
    d.flash('#ffffff', 0.3, 12);
  });
  d.stamp(SKEWER, 'SHHK', { color: '#ffffff', x: 180, y: 120, size: 16, rot: 0.12, dur: 0.3 });
  d.span(SKEWER - 0.08, SKEWER + 0.1, (u) => (pose.whack = 0.35 * Math.sin(u * Math.PI)));
  d.slowmo(RAM0 + 0.05, RAM - 0.02, 0.12, 0.12);
  d.span(RAM0, RAM, (u) => {
    pose.ram = easeInOut(seg(u, 0, 0.55));
    pose.lunge = easeInOut(u);
    pose.write = 1 - u;
    pose.wx = 0.35 * (1 - u);
  });
  d.at(RAM0, () => {
    x.setScold(1);
    d.sfx.voice('pivot', 'yell');
    talk(RAM0, 0.6, 12);
  });
  let ramCam = new THREE.Vector3();
  d.at(RAM0, () => (ramCam = faceCam(b, 6.4, 0.25, -0.5, 0).pos));
  d.follow(RAM0, RAM, (u) => {
    headPos(b, H);
    return { pos: ramCam, look: H.clone().setY(H.y - 0.4), fov: lerp(36, 48, u), roll: lerp(0, -0.12, u) };
  });
  // last stretch: the sheet leaves the tip and fills the lens
  const flyQ = new THREE.Quaternion();
  let flyFrom: THREE.Vector3 | null = null;
  let flyQ0 = new THREE.Quaternion();
  d.span(RAM0 + 0.25, RAM, (u) => {
    d.speedLines = Math.max(d.speedLines, 0.8);
    if (!flyFrom) {
      flying = true;
      flyFrom = paper.position.clone();
      flyQ0 = paper.quaternion.clone();
    }
    const e = u * u;
    const cam = d.stage.camera;
    paper.position.lerpVectors(flyFrom, camAhead(-0.062, 0.012, -0.2), e);
    flyQ.copy(cam.quaternion).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.14));
    paper.quaternion.slerpQuaternions(flyQ0, flyQ, Math.min(1, u * 1.5));
    paper.scale.setScalar(lerp(1, 0.089, e * e));
  });
  d.at(RAM, () => {
    lensOn = true;
    paper.visible = false;
    d.sfx.slap();
    d.sfx.impact();
    sx.tink?.();
    d.cam.shake(1);
    d.cam.punch(10);
    d.hype = 1;
    x.setScold(0);
  });
  d.impactFrame(RAM, '#ffffff', 2);
  d.freeze(RAM, 0.16, 0.5);
  d.stamp(RAM + 0.02, 'WRONG.', { color: '#ff2a3a', x: 470, y: 96, size: 24, rot: -0.12, dur: 0.75, burst: '#ffffff' });
  d.span(RAM + 0.15, RAM + 0.5, (u) => {
    pose.ram = 1 - easeInOut(u);
    pose.lunge = 1 - easeInOut(u);
  });
  // through the glass: he leans back and laughs at you
  d.follow(RAM + 0.16, BOOM - 0.05, (u) => ({ ...faceCam(b, lerp(7.6, 6.8, easeOut(u)), 0.3, -0.6, -0.4), fov: 32, roll: -0.05 }));
  d.at(RAM + 0.4, () => {
    x.setSmug(1);
    d.sfx.voice('pivot', 'laugh');
    talk(RAM + 0.4, 0.7, 15);
  });
  d.span(SEEME, SEEME + 0.25, (u) => (st.seeMe = u));
  d.at(SEEME, () => {
    sx.rubberStamp?.();
    d.sfx.impact();
    d.cam.shake(0.5);
    d.cam.punch(-5);
  });
  d.stamp(SEEME + 0.02, 'SEE ME\nAFTER CLASS.', { color: '#ff2a3a', x: 450, y: 250, size: 16, rot: 0.08, dur: 0.75, burst: '#fbf7ea' });
  d.at(PEEL, () => sx.paperTik?.());

  // ---- BOOM: one last whack, chalk dust fills the frame ----
  d.span(PEEL + 0.1, BOOM - 0.15, (u) => (pose.lect = easeOut(u)));
  d.at(PEEL + 0.1, () => x.setSmug(0));
  d.span(BOOM - 0.15, BOOM, (u) => (pose.whack = -0.6 * Math.sin(u * Math.PI * 0.5) + 1.2 * easeOut(seg(u, 0.5, 1))));
  d.span(BOOM, BOOM + 0.35, (u) => (pose.whack = 0.6 * (1 - easeInOut(u))));
  d.follow(BOOM - 0.05, MONO, (u) => {
    const bp = Director.wp(board);
    headPos(b, H);
    const mid = bp.clone().lerp(H, 0.6);
    return { pos: mid.clone().add(new THREE.Vector3(0.6, -0.3, lerp(7.2, 6.4, u))), look: mid, fov: 36, roll: 0.08 };
  });
  d.at(BOOM, () => {
    st.win = 0.7;
    chalkBurst(26, 0.8, 7);
    // a wall of dust toward the lens
    const cam = d.stage.camera.position;
    const bp = Director.wp(board);
    for (let i = 0; i < 14; i++) {
      const p = bp.clone().lerp(cam, 0.3 + Math.random() * 0.45);
      d.fx.smoke(p, 1, { vel: { x: (Math.random() - 0.5) * 2, y: Math.random(), z: 0.5 }, spread: 1, size: 0.8, grow: 2.2, color: 0xffffff, outline: false, life: 0.6, drag: 2 });
    }
    d.sfx.slap();
    d.sfx.impact();
    sx.chalkWhack?.();
    d.cam.shake(1);
    d.cam.punch(-8);
    d.flash('#f8f6ee', 0.6, 7);
    d.hype = 1;
  });
  d.impactFrame(BOOM, 'invert', 2);
  d.stamp(BOOM + 0.03, 'WHAM!', { color: CHALK, x: 200, y: 120, size: 24, rot: -0.14, dur: 0.45, burst: '#2a6a44' });

  // ---- MONOCLE: close-up as the dust clears; pinch, the eye pops, SHING ----
  d.at(MONO, () => d.fx.clear()); // the cut lands as the dust settles
  d.span(MONO - 0.3, MONO, (u) => (pose.lect = 1 - easeInOut(u)));
  d.follow(MONO, CARD, (u) => ({ ...faceCam(b, lerp(4.8, 4.1, easeOut(u)), -0.3, 0.05, 0.05), fov: 30, roll: 0.1 }));
  d.span(MONO, MONO + 0.12, (u) => x.adjustMonocle(u));
  d.at(MONO + 0.12, () => {
    d.cam.punch(-6);
    d.flash('#ffffff', 0.45, 10);
    const mp = Director.wp(x.props.monocle);
    d.sparkle(mp, 40, '#ffffff');
    d.sparkle(mp.clone().add(new THREE.Vector3(0.1, 0.1, 0)), 22, '#fff6c8');
    sx.sparkle?.();
    d.sfx.tink();
    ray.visible = true;
  });
  d.stamp(MONO + 0.14, 'SHING', { color: '#ffe680', x: 200, y: 110, size: 16, rot: -0.1, dur: 0.4 });
  d.span(MONO + 0.12, MONO + 0.55, (u) => {
    const mp = Director.wp(x.props.monocle);
    glint.position.copy(mp).add(new THREE.Vector3(0, 0, 0.12));
    glint.scale.setScalar(0.7 * Math.sin(u * Math.PI));
    (glint.material as THREE.SpriteMaterial).opacity = Math.sin(u * Math.PI);
  });
  d.span(MONO + 0.6, MONO + 0.75, (u) => x.adjustMonocle(1 - u));
  d.at(MONO + 0.6, () => x.setSmug(0.35));

  // ---- CARD: low hero angle, him in the right third, pointer raised, nose up ----
  d.span(CARD - 0.25, CARD, (u) => (pose.card = easeBack(u)));
  d.at(CARD - 0.25, () => {
    ray.visible = true;
    x.setSmug(0.5);
  });
  const camRight = new THREE.Vector3();
  d.follow(CARD, 30, (u) => {
    const f = faceCam(b, lerp(13, 12, easeOut(Math.min(1, u * 4))), 0.5, -1.4, 0);
    const r = headR(b);
    camRight.subVectors(f.look, f.pos).cross(new THREE.Vector3(0, 1, 0)).normalize();
    f.look.addScaledVector(camRight, -3.4 * r);
    f.look.y -= 1.0 * r;
    return { ...f, fov: 34, roll: -0.08 };
  });
  d.freeze(CARD, 0.25, 0.6);
  d.at(CARD + 0.7, () => d.sfx.voice('pivot', 'taunt'));
  d.at(CARD + 0.7, () => talk(CARD + 0.7, 1.3, 14));
  d.nameCard(CARD, { ...card, color: '#6b4f2a', accent: '#f2e3b3', layout: 'left' }, 0.8, 'pivot');

  function talk(t0: number, dur: number, rate: number) {
    d.span(t0, t0 + dur, (u) => x.setTalk(u >= 1 ? 0 : Math.abs(Math.sin(d.wt * rate + u * 20))));
  }
}
