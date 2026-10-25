// Finish-line scoreboards: one per lane, LED dot-matrix seven-segment ET / MPH, win light, sponsor header.
import * as THREE from 'three';
import type { Ctx } from './ctx';
import { mesh } from './ctx';
import { box, merge } from './geo';
import { SCOREBOARD } from './layout';
import { glowTexture, signTexture } from './textures';

// seven-segment: a b c d e f g
const SEG: Record<string, number> = {
  '0': 0b1111110, '1': 0b0110000, '2': 0b1101101, '3': 0b1111001, '4': 0b0110011, '5': 0b1011011,
  '6': 0b1011111, '7': 0b1110000, '8': 0b1111111, '9': 0b1111011, '-': 0b0000001, ' ': 0,
};

const LW = 192, LH = 96; // LED grid

/** Draw seven-segment text into an LED-resolution canvas (white on black). */
function drawSegs(g: CanvasRenderingContext2D, text: string, x: number, y: number, dw: number, dh: number) {
  const t = Math.max(2, Math.round(dw * 0.2));
  let cx = x;
  for (const ch of text) {
    if (ch === '.') {
      // the decimal point gets its own narrow slot so it reads clearly between the digits
      g.fillStyle = '#fff';
      g.fillRect(Math.round(cx - t * 0.4), Math.round(y + dh - t * 1.3), Math.round(t * 1.3), Math.round(t * 1.3));
      cx += t * 1.5;
      continue;
    }
    const m = SEG[ch] ?? 0;
    const segs: [number, number, number, number][] = [
      [cx + t, y, dw - 2 * t, t], // a
      [cx + dw - t, y + t, t, dh / 2 - 1.5 * t], // b
      [cx + dw - t, y + dh / 2 + t / 2, t, dh / 2 - 1.5 * t], // c
      [cx + t, y + dh - t, dw - 2 * t, t], // d
      [cx, y + dh / 2 + t / 2, t, dh / 2 - 1.5 * t], // e
      [cx, y + t, t, dh / 2 - 1.5 * t], // f
      [cx + t, y + dh / 2 - t / 2, dw - 2 * t, t], // g
    ];
    segs.forEach((s, i) => {
      const on = (m >> (6 - i)) & 1;
      g.fillStyle = on ? '#fff' : '#181818';
      g.fillRect(Math.round(s[0]), Math.round(s[1]), Math.round(s[2]), Math.round(s[3]));
    });
    cx += dw + t * 1.6;
  }
}

export function buildScoreboards(ctx: Ctx) {
  const glowT = ctx.own(glowTexture(64, 0.15));
  const cab = ctx.std({ color: 0x111215, roughness: 0.6, metalness: 0.3 }, 0.8);
  const steel = ctx.std({ color: 0x4a4f56, roughness: 0.45, metalness: 0.8 }, 1);
  const boards: { draw(et: number | null, mph: number | null, win: boolean): void }[] = [];
  const winLamps: THREE.Sprite[] = [];
  const winMats: THREE.MeshBasicMaterial[] = [];
  for (const [i, side] of [[0, 1], [1, -1]] as const) {
    const G = new THREE.Group();
    G.name = 'scoreboard' + i;
    G.position.set(SCOREBOARD.x, 0, side * SCOREBOARD.z);
    G.rotation.y = -side * THREE.MathUtils.degToRad(14); // toe in toward the lanes
    ctx.group.add(G);
    const W = 7.2, H = 3.7, y0 = 4.5; // digits clear the 4.4 m catch fence for low post-finish cameras
    mesh(G, merge([
      box(0.5, H + 0.5, W + 0.5, 0.25, y0 + H / 2, 0), // cabinet
      box(0.35, y0, 0.45, 0.4, y0 / 2, W * 0.3), box(0.35, y0, 0.45, 0.4, y0 / 2, -W * 0.3), // legs
      box(0.7, 0.18, W + 0.7, 0.1, y0 + H + 0.33, 0), // hood
    ]), cab, { cast: true, name: 'cabinet' });
    mesh(G, merge([box(0.8, 0.4, 1.0, 0.4, 0.2, W * 0.3), box(0.8, 0.4, 1.0, 0.4, 0.2, -W * 0.3), box(0.08, 0.08, W, -0.05, y0 - 0.12, 0)]), steel);
    // header sign
    const ht = ctx.own(signTexture([{ text: side > 0 ? 'YOU' : 'OPP', size: 0.62, color: '#ffffff' }], 512, 80, side > 0 ? '#0a2a8c' : '#8c0a1a', { aniso: ctx.cfg.aniso }));
    const hm = new THREE.MeshBasicMaterial({ map: ht, color: new THREE.Color(1.4, 1.4, 1.4), fog: false });
    const hg = new THREE.PlaneGeometry(W, 0.62);
    hg.rotateY(-Math.PI / 2);
    hg.translate(-0.02, y0 + H - 0.31, 0);
    mesh(G, hg, hm, { receive: false });
    // LED face: a 192×96 canvas holds one texel per LED; the shader turns texels into round amber LEDs
    // (no per-dot canvas drawing, so setScoreboard is cheap).
    const low = document.createElement('canvas');
    low.width = LW; low.height = LH;
    const tex = ctx.own(new THREE.CanvasTexture(low));
    tex.magFilter = THREE.NearestFilter;
    tex.anisotropy = ctx.cfg.aniso;
    const fm = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.6, 2.6, 2.6), fog: false });
    fm.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
vec4 ledT = texture2D( map, vMapUv );
vec2 cell = fract( vMapUv * vec2( ${LW}.0, ${LH}.0 ) ) - 0.5;
float aa = fwidth( vMapUv.x * ${LW}.0 );
float dotM = mix( smoothstep( 0.44, 0.3, length( cell ) ), 0.55, smoothstep( 0.35, 0.9, aa ) );
float v = ledT.r;
vec3 led = v > 0.6 ? vec3( 1.0, 0.36, 0.04 ) * v : v > 0.03 ? vec3( 0.03, 0.01, 0.003 ) : vec3( 0.008, 0.005, 0.004 );
diffuseColor.rgb *= led * dotM + vec3( 0.0015 ) * ( 1.0 - dotM );
`);
    };
    const fg = new THREE.PlaneGeometry(W - 0.2, H - 0.75);
    fg.rotateY(-Math.PI / 2);
    fg.translate(-0.02, y0 + (H - 0.75) / 2 + 0.06, 0);
    mesh(G, fg, fm, { receive: false, name: 'led' });
    const draw = (et: number | null, mph: number | null, win: boolean) => {
      const g = low.getContext('2d')!;
      g.fillStyle = '#000';
      g.fillRect(0, 0, LW, LH);
      g.font = 'bold 11px monospace';
      g.fillStyle = '#fff';
      g.fillText('ET', 4, 14);
      g.fillText('MPH', 4, 62);
      const etS = et == null ? ' -.---' : et >= 99 ? ' --.--' : et.toFixed(3).padStart(6, ' ');
      const mphS = mph == null ? '---.--' : mph.toFixed(2).padStart(6, ' ');
      drawSegs(g, etS, 28, 4, 21, 40);
      drawSegs(g, mphS, 28, 51, 21, 40);
      tex.needsUpdate = true;
      winMats[i].color.setRGB(win ? 3.5 : 0.05, win ? 2.6 : 0.04, win ? 0.7 : 0.02);
      winLamps[i].userData.on = win;
      (winLamps[i].material as THREE.SpriteMaterial).opacity = win ? 0.6 : 0;
    };
    // win light on top
    const wm = new THREE.MeshBasicMaterial({ color: 0x110800 });
    winMats.push(wm);
    const wg = new THREE.SphereGeometry(0.2, 16, 10);
    wg.translate(0.25, y0 + H + 1.35, 0);
    mesh(G, wg, wm, { receive: false });
    mesh(G, box(0.08, 0.9, 0.08, 0.25, y0 + H + 0.75, 0), cab); // mast: the lamp sits well above the digits
    const ws = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowT, color: 0xffb040, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    ctx.own(ws.material);
    ws.position.set(0.0, y0 + H + 1.35, 0);
    ws.scale.setScalar(1.8);
    (ws.material as THREE.SpriteMaterial).opacity = 0;
    G.add(ws);
    winLamps.push(ws);
    boards.push({ draw });
  }
  boards.forEach((b) => b.draw(null, null, false));
  let pulse = 0;
  ctx.updaters.push((dt, t) => {
    pulse = t;
    for (const s of winLamps) if (s.userData.on) (s.material as THREE.SpriteMaterial).opacity = 0.45 + 0.25 * Math.sin(pulse * 9);
  });
  return {
    set(leftEt: number | null, leftMph: number | null, rightEt: number | null, rightMph: number | null, winner?: 'player' | 'ghost' | null) {
      boards[0].draw(leftEt, leftMph, winner === 'player');
      boards[1].draw(rightEt, rightMph, winner === 'ghost');
    },
  };
}
