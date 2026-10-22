// Chunky side-view pixel cars, generated in code and cached as textures.
// Used by the race scenes and the shop's garage view.
//
//   const car = makeCar(scene, x, y, carVisualFromParts(game.state.parts), 2);
//   car.setWheelSpin(revsPerSecond); car.setBodyRoll(deg); car.setNitro(true); car.flameBurst();
//
// (x, y) is the point on the ground under the middle of the car. The car faces right.
import Phaser from 'phaser';
import type { InstalledPart, OpponentDef, SlotId, Tier } from '../core/types';
import { partById } from '../data/content';
import { Pix, framesToTexture, mix, parseColor, shade, texRng } from './race/pix';

export type BodyType = 'compact' | 'muscle' | 'wedge' | 'truck' | 'super';

export interface CarVisual {
  body: BodyType;
  color: string;
  accent: string;
  tires: Tier;
  aero: Tier;
  exhaust: Tier;
  intake: Tier;
  forcedInduction: Tier;
  nitrous: boolean;
  /** Optional extra: carbon hood (pro chassis). */
  carbon?: boolean;
}

/** The player's signature colors. */
export const PLAYER_COLOR = '#e8413c';
export const PLAYER_ACCENT = '#f7d23e';

function tierOf(parts: Record<SlotId, InstalledPart> | undefined, slot: SlotId): Tier {
  const ip = parts?.[slot];
  if (!ip) return 'stock';
  try {
    return partById(ip.partId)?.tier ?? 'stock';
  } catch {
    return 'stock';
  }
}

export function carVisualFromParts(parts: Record<SlotId, InstalledPart>): CarVisual {
  return {
    body: 'compact',
    color: PLAYER_COLOR,
    accent: PLAYER_ACCENT,
    tires: tierOf(parts, 'tires'),
    aero: tierOf(parts, 'aero'),
    exhaust: tierOf(parts, 'exhaust'),
    intake: tierOf(parts, 'intake'),
    forcedInduction: tierOf(parts, 'forced_induction'),
    nitrous: tierOf(parts, 'nitrous') !== 'stock',
    carbon: tierOf(parts, 'chassis') === 'pro',
  };
}

/** Opponent look: mid-tier parts, rising with the round; bosses get the full treatment. */
export function carVisualForOpponent(op: Pick<OpponentDef, 'car' | 'round' | 'race'>): CarVisual {
  const boss = op.race === 3;
  const hi = boss || op.round >= 3;
  const t: Tier = hi ? 'pro' : 'street';
  return {
    body: op.car.body,
    color: op.car.color,
    accent: op.car.accent,
    tires: hi ? 'pro' : op.round >= 2 ? 'street' : 'stock',
    aero: boss ? 'pro' : op.round >= 2 ? 'street' : 'stock',
    exhaust: t,
    intake: op.round >= 2 ? 'street' : 'stock',
    forcedInduction: boss ? 'pro' : op.round >= 3 ? 'street' : 'stock',
    nitrous: boss || op.round >= 4,
  };
}

// ---------------------------------------------------------------------------
// Body geometry. Local coords: x 0..L (rear -> front), y 0 (top) .. 21 (bottom of body).

interface BodyDef {
  L: number;
  poly: number[][];
  windows: number[][][];
  rearX: number;
  frontX: number;
  belt: number;
  clearance: number;
  vent?: number[]; // x, y, w, h dark side vent
}

const BODIES: Record<BodyType, BodyDef> = {
  compact: {
    L: 60,
    poly: [[0, 20], [0, 10], [3, 5], [8, 2], [32, 2], [41, 9], [54, 10], [59, 12], [60, 15], [60, 20], [59, 21], [1, 21]],
    windows: [
      [[5, 9], [8, 4], [18, 4], [18, 9]],
      [[20, 9], [20, 4], [31, 4], [37, 9]],
    ],
    rearX: 12,
    frontX: 48,
    belt: 10,
    clearance: 4,
  },
  muscle: {
    L: 72,
    poly: [[0, 19], [0, 11], [2, 9], [14, 8], [22, 3], [38, 3], [46, 8], [66, 9], [70, 11], [72, 13], [72, 19], [70, 21], [2, 21]],
    windows: [
      [[20, 8], [24, 4], [30, 4], [30, 8]],
      [[32, 8], [32, 4], [37, 4], [43, 8]],
    ],
    rearX: 14,
    frontX: 58,
    belt: 10,
    clearance: 4,
  },
  wedge: {
    L: 70,
    poly: [[0, 18], [0, 10], [12, 9], [24, 8], [30, 3], [40, 3], [70, 12], [70, 18], [68, 21], [2, 21]],
    windows: [[[28, 8], [31, 4], [39, 4], [48, 8]]],
    rearX: 14,
    frontX: 56,
    belt: 10,
    clearance: 4,
    vent: [18, 12, 6, 3],
  },
  truck: {
    L: 74,
    poly: [[0, 20], [0, 8], [28, 8], [30, 1], [46, 1], [50, 8], [66, 9], [71, 10], [74, 12], [74, 20], [72, 21], [2, 21]],
    windows: [[[32, 7], [33, 3], [44, 3], [47, 7]]],
    rearX: 14,
    frontX: 60,
    belt: 9,
    clearance: 6,
  },
  super: {
    L: 72,
    poly: [[0, 17], [0, 11], [8, 10], [24, 7], [32, 5], [42, 5], [52, 10], [66, 12], [72, 15], [72, 18], [70, 21], [2, 21]],
    windows: [[[28, 9], [32, 6], [41, 6], [49, 10]]],
    rearX: 14,
    frontX: 58,
    belt: 12,
    clearance: 3,
    vent: [19, 13, 6, 3],
  },
};

const OUT = 0x0b0a14; // outline
const GLASS = 0x26324f;
const GLASS_HI = 0x8fb4e8;
const CHROME = 0xd6d4e4;
const CHROME_DK = 0x7d7a92;
const DARK = 0x16141e;

const TW = 96;
const TH = 48;
const GROUND = 44; // texture row of the ground line
const OX = 12; // texture x of body local x=0

function tireRadius(v: CarVisual): { rear: number; front: number } {
  if (v.tires === 'pro') return { rear: 9, front: 5 };
  if (v.tires === 'street') return { rear: 7, front: 7 };
  return { rear: 6, front: 6 };
}

function clearanceOf(v: CarVisual): number {
  const b = BODIES[v.body];
  return b.clearance + (v.tires === 'pro' ? 3 : v.tires === 'street' ? 1 : 0);
}

function visualKey(v: CarVisual): string {
  return `car_${v.body}_${v.color}_${v.accent}_${v.tires}_${v.aero}_${v.exhaust}_${v.intake}_${v.forcedInduction}_${v.nitrous ? 1 : 0}_${v.carbon ? 1 : 0}`;
}

interface BodyTex {
  key: string;
  exhaustX: number; // body-local coords (texture-local minus OX/oy) of the exhaust tip
  exhaustY: number;
}

function buildBody(scene: Phaser.Scene, v: CarVisual): BodyTex {
  const def = BODIES[v.body];
  const key = visualKey(v);
  const oy = GROUND - clearanceOf(v) - 21;
  const tx = (x: number) => x + OX;
  const ty = (y: number) => y + oy;
  const base = parseColor(v.color);
  const accent = parseColor(v.accent);
  const { rear: rR, front: rF } = tireRadius(v);
  const exhaustTipLen = v.exhaust === 'pro' ? 5 : v.exhaust === 'street' ? 4 : 2;
  const exY = 19;
  if (scene.textures.exists(key)) return { key, exhaustX: -exhaustTipLen, exhaustY: exY };

  const p = new Pix(TW, TH);
  const poly = def.poly.map(([x, y]) => [tx(x), ty(y)]);
  p.poly(poly, base);

  // Column extents of the body for shading.
  const top: number[] = [];
  const bot: number[] = [];
  for (let x = 0; x < TW; x++) {
    top[x] = -1;
    bot[x] = -1;
    for (let y = 0; y < TH; y++)
      if (p.filled(x, y)) {
        if (top[x] < 0) top[x] = y;
        bot[x] = y;
      }
  }
  for (let x = 0; x < TW; x++) {
    if (top[x] < 0) continue;
    for (let y = top[x]; y <= bot[x]; y++) {
      let c = base;
      if (y === top[x]) c = shade(base, 0.45);
      else if (y === top[x] + 1) c = shade(base, 0.2);
      else if (y >= bot[x] - 1) c = shade(base, -0.45);
      else if (y >= bot[x] - 4) c = shade(base, -0.22);
      p.set(x, y, c);
    }
  }
  // Carbon hood: dark weave from windshield base to nose on the top rows.
  if (v.carbon) {
    for (let x = tx(def.frontX - 14); x < tx(def.L - 2); x++) {
      if (top[x] < 0) continue;
      for (let y = top[x]; y < top[x] + 2; y++) p.set(x, y, (x + y) % 2 ? 0x24222c : 0x34313f);
    }
  }
  // Accent stripe along the beltline.
  for (let x = tx(1); x < tx(def.L - 1); x++) {
    if (p.filled(x, ty(def.belt + 1)) && p.filled(x, ty(def.belt + 2))) {
      p.set(x, ty(def.belt + 1), accent);
      p.set(x, ty(def.belt + 2), shade(accent, -0.25));
    }
  }
  // Windows with a glare streak and pillars.
  def.windows.forEach((w) => {
    const pts = w.map(([x, y]) => [tx(x), ty(y)]);
    p.poly(pts, GLASS);
    let minX = 999,
      maxX = -1;
    pts.forEach(([x]) => ((minX = Math.min(minX, x)), (maxX = Math.max(maxX, x))));
    const gx = Math.round(minX + (maxX - minX) * 0.35);
    for (let i = 0; i < 6; i++) {
      const x = gx + i,
        y = ty(def.belt) - 1 - i;
      if (p.get(x, y) === GLASS) p.set(x, y, GLASS_HI);
      if (p.get(x + 2, y) === GLASS) p.set(x + 2, y, mix(GLASS, GLASS_HI, 0.5));
    }
  });
  // Nitrous bottle in the rearmost window.
  if (v.nitrous) {
    const w = def.windows[0];
    let minX = 999,
      maxX = -1;
    w.forEach(([x]) => ((minX = Math.min(minX, x)), (maxX = Math.max(maxX, x))));
    const bx = tx(Math.round((minX + maxX) / 2) - 1);
    for (let y = ty(def.belt) - 5; y < ty(def.belt); y++) {
      if (p.get(bx, y) === GLASS || p.get(bx, y) === GLASS_HI || p.get(bx, y) === mix(GLASS, GLASS_HI, 0.5)) {
        p.set(bx, y, 0x3c78e8);
        p.set(bx + 1, y, 0x6fa0ff);
        p.set(bx + 2, y, 0x2a56b0);
      }
    }
    p.set(bx + 1, ty(def.belt) - 6, CHROME);
    // little blue decal on the rear quarter
    p.rect(tx(4), ty(def.belt + 4), 4, 2, 0x3c78e8);
    p.set(tx(4), ty(def.belt + 4), 0x9cc0ff);
  }
  // Door seam and handle.
  const doorX = tx(Math.round((def.rearX + def.frontX) / 2) + 2);
  for (let y = ty(def.belt + 3); y < ty(19); y++) if (p.filled(doorX, y)) p.set(doorX, y, shade(base, -0.4));
  p.rect(doorX - 4, ty(def.belt + 3), 2, 1, shade(base, -0.5));
  if (def.vent) {
    const [vx, vy, vw, vh] = def.vent;
    for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) p.set(tx(vx + i), ty(vy + j), i % 2 ? DARK : 0x2c2938);
  }
  // Lights.
  p.rect(tx(def.L - 2), ty(def.belt + 1), 2, 2, 0xfff2b0);
  p.set(tx(def.L - 1), ty(def.belt + 1), 0xffffff);
  p.rect(tx(0), ty(def.belt + 1), 2, 2, 0xe8413c);
  p.set(tx(0), ty(def.belt + 1), 0xff9a8a);

  // Wheel wells (dark, behind the wheels).
  const wells: [number, number][] = [
    [def.rearX, rR],
    [def.frontX, rF],
  ];
  for (const [wx, r] of wells) {
    const cx = tx(wx) + 0.5;
    const cy = GROUND - r;
    for (let y = Math.floor(cy - r - 3); y <= GROUND; y++)
      for (let x = Math.floor(cx - r - 3); x <= Math.ceil(cx + r + 3); x++) {
        if (!p.filled(x, y)) continue;
        const dx = x + 0.5 - cx,
          dy = y + 0.5 - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= r + 1.5) p.set(x, y, DARK);
        else if (d <= r + 2.5 && y < cy) p.set(x, y, shade(base, -0.5));
      }
  }

  // ---- Aero ----
  const deckTop = (x: number) => {
    const c = tx(x);
    return top[c] >= 0 ? top[c] : ty(10);
  };
  if (v.aero === 'street') {
    const d = deckTop(3);
    p.poly([[tx(0), d + 1], [tx(0), d - 3], [tx(2), d - 3], [tx(8), d], [tx(8), d + 1]], accent);
    p.hline(tx(0), tx(2), d - 3, shade(accent, 0.4));
  } else if (v.aero === 'pro') {
    const d = deckTop(6);
    p.vline(tx(4), d - 7, d, DARK);
    p.vline(tx(9), d - 7, d, DARK);
    p.rect(tx(-3), d - 10, 16, 3, accent);
    p.hline(tx(-3), tx(12), d - 10, shade(accent, 0.45));
    p.hline(tx(-3), tx(12), d - 8, shade(accent, -0.35));
    p.rect(tx(-3), d - 12, 2, 6, shade(accent, -0.3)); // endplate
    // splitter and skirts
    p.rect(tx(def.L - 8), ty(21), 11, 1, DARK);
    for (let x = tx(def.rearX + rR + 2); x < tx(def.frontX - rF - 2); x++) p.set(x, ty(21), DARK);
    for (let x = tx(def.rearX + rR + 2); x < tx(def.frontX - rF - 2); x++) p.set(x, ty(20), 0x2c2938);
  }

  // ---- Hood: intake / forced induction ----
  const hoodX = def.frontX - 6; // local x of the hood bulge centre
  const hoodTop = deckTop(hoodX);
  if (v.forcedInduction === 'pro') {
    // Supercharger blower poking out of the hood.
    const bx = tx(hoodX - 6);
    p.rect(bx, hoodTop - 5, 11, 5, CHROME);
    p.hline(bx, bx + 10, hoodTop - 5, 0xffffff);
    for (let i = 1; i < 11; i += 2) p.vline(bx + i, hoodTop - 4, hoodTop - 1, CHROME_DK);
    p.rect(bx + 10, hoodTop - 4, 2, 4, DARK); // belt
    p.rect(bx + 1, hoodTop - 9, 9, 4, accent); // scoop
    p.rect(bx + 7, hoodTop - 8, 3, 2, DARK);
    p.hline(bx + 1, bx + 9, hoodTop - 9, shade(accent, 0.45));
  } else if (v.intake === 'pro') {
    // Individual throttle bodies: velocity stacks through the hood.
    const bx = tx(hoodX - 5);
    for (let i = 0; i < 3; i++) {
      p.rect(bx + i * 4, hoodTop - 4, 3, 4, CHROME);
      p.set(bx + i * 4 + 1, hoodTop - 4, DARK);
      p.set(bx + i * 4, hoodTop - 3, 0xffffff);
    }
  } else if (v.intake === 'street') {
    const bx = tx(hoodX - 5);
    p.poly([[bx, hoodTop], [bx + 2, hoodTop - 3], [bx + 9, hoodTop - 3], [bx + 9, hoodTop]], shade(base, 0.12));
    p.rect(bx + 7, hoodTop - 2, 2, 2, DARK);
  }
  if (v.forcedInduction === 'street') {
    // Front-mount intercooler peeking out of the bumper.
    const ix = tx(def.L - 4);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) p.set(ix + i, ty(15 + j), (i + j) % 2 ? CHROME_DK : CHROME);
  }

  // ---- Exhaust tip ----
  const exC = v.exhaust === 'pro' ? CHROME : v.exhaust === 'street' ? CHROME : 0x8a879c;
  const eh = v.exhaust === 'pro' ? 2 : v.exhaust === 'street' ? 2 : 1;
  p.rect(tx(-exhaustTipLen), ty(exY), exhaustTipLen + 1, eh, exC);
  p.set(tx(-exhaustTipLen), ty(exY), DARK);
  if (v.exhaust === 'pro') {
    p.rect(tx(-exhaustTipLen), ty(exY - 3), exhaustTipLen + 1, 2, exC);
    p.set(tx(-exhaustTipLen), ty(exY - 3), DARK);
  }

  p.outline(OUT);
  p.toTexture(scene, key);
  return { key, exhaustX: -exhaustTipLen, exhaustY: exY };
}

// ---------------------------------------------------------------------------
// Wheels: 6 rotation frames + 1 motion-blur frame.

const WHEEL_FRAMES = 6;
const BLUR_FRAME = WHEEL_FRAMES;

function wheelKey(r: number, tier: Tier, rimColor: number): string {
  return `wheel_${r}_${tier}_${rimColor.toString(16)}`;
}

function buildWheel(scene: Phaser.Scene, r: number, tier: Tier, rimColor: number, slick: boolean): string {
  const key = wheelKey(r, tier, rimColor) + (slick ? '_s' : '');
  if (scene.textures.exists(key)) return key;
  const S = 2 * r + 2;
  const c = S / 2;
  const spokes = tier === 'stock' ? 4 : 5;
  const rimR = slick ? r * 0.5 : tier === 'street' ? r * 0.68 : r * 0.58;
  const rimDk = shade(rimColor, -0.45);
  const frames: Pix[] = [];
  for (let f = 0; f <= WHEEL_FRAMES; f++) {
    const p = new Pix(S, S);
    p.disc(c, c, r, 0x1c1a22);
    p.ring(c, c, r - 1, r, 0x2e2b38);
    // tread highlight on top-left
    for (let a = -2.6; a < -1.4; a += 0.08)
      p.set(Math.floor(c + Math.cos(a) * (r - 0.6)), Math.floor(c + Math.sin(a) * (r - 0.6)), 0x4a4658);
    p.disc(c, c, rimR, rimColor);
    p.ring(c, c, rimR - 1, rimR, shade(rimColor, -0.2));
    if (f === BLUR_FRAME) {
      p.ring(c, c, rimR * 0.35, rimR * 0.75, mix(rimColor, rimDk, 0.5));
      if (slick) p.ring(c, c, r - 2.6, r - 1.6, 0x6a6676);
    } else {
      const base = (f / WHEEL_FRAMES) * ((Math.PI * 2) / spokes);
      for (let k = 0; k < spokes; k++) {
        const a = base + (k * Math.PI * 2) / spokes;
        if (tier === 'stock') {
          // steelie: holes instead of spokes
          p.set(Math.floor(c + Math.cos(a) * rimR * 0.6), Math.floor(c + Math.sin(a) * rimR * 0.6), rimDk);
        } else {
          p.line(c - 0.5, c - 0.5, c - 0.5 + Math.cos(a) * (rimR - 0.8), c - 0.5 + Math.sin(a) * (rimR - 0.8), rimDk);
        }
        if (slick) {
          const la = a + 0.3;
          p.set(Math.floor(c + Math.cos(la) * (r - 2)), Math.floor(c + Math.sin(la) * (r - 2)), 0xf4ecd8);
          p.set(Math.floor(c + Math.cos(la + 0.25) * (r - 2)), Math.floor(c + Math.sin(la + 0.25) * (r - 2)), 0xf4ecd8);
        }
      }
    }
    p.rect(c - 1, c - 1, 2, 2, 0xffffff);
    p.set(c, c, CHROME_DK);
    frames.push(p);
  }
  return framesToTexture(scene, key, frames);
}

// ---------------------------------------------------------------------------
// Flames (exhaust orange, nitrous blue): 3 frames each, pointing left, origin at right-middle.

function buildFlames(scene: Phaser.Scene, kind: 'fire' | 'nitro'): string {
  const key = `flame_${kind}`;
  if (scene.textures.exists(key)) return key;
  const W = kind === 'nitro' ? 28 : 18;
  const H = 9;
  const cols =
    kind === 'nitro' ? [0x2a56d8, 0x38c6f0, 0xbfefff, 0xffffff] : [0xc8261e, 0xf28c28, 0xf7d23e, 0xfff6c8];
  const frames: Pix[] = [];
  const rnd = texRng(kind === 'nitro' ? 77 : 33);
  for (let f = 0; f < 3; f++) {
    const p = new Pix(W, H);
    const len = W - 2 - Math.floor(rnd() * 4);
    for (let layer = 0; layer < 4; layer++) {
      const l = len * (1 - layer * 0.22);
      const hh = (H / 2) * (1 - layer * 0.25);
      for (let x = 0; x < l; x++) {
        const t = x / l; // 0 at the pipe
        const half = Math.max(0.5, hh * (1 - t * t) + (rnd() - 0.5) * 1.4 * t);
        for (let y = Math.floor(H / 2 - half); y < Math.ceil(H / 2 + half); y++) p.set(W - 1 - x, y, cols[layer]);
      }
    }
    // a few loose sparks at the tip
    for (let i = 0; i < 3; i++) p.set(Math.floor(rnd() * 6), Math.floor(1 + rnd() * (H - 2)), cols[1 + (i % 2)]);
    frames.push(p);
  }
  return framesToTexture(scene, key, frames);
}

// ---------------------------------------------------------------------------

export class CarSprite extends Phaser.GameObjects.Container {
  readonly visual: CarVisual;
  readonly length: number; // body length in local (unscaled) px
  /** Local (unscaled) position of the exhaust tip relative to the container origin. */
  readonly exhaustLocal: { x: number; y: number };
  /** Local (unscaled) position of the rear tire contact patch. */
  readonly rearContactLocal: { x: number; y: number };
  /** Front / rear tire radius in local (unscaled) px. */
  readonly frontR: number;
  readonly rearR: number;
  private chassis: Phaser.GameObjects.Container;
  private bodyImg: Phaser.GameObjects.Image;
  private wheels: { img: Phaser.GameObjects.Image; rear: boolean }[] = [];
  private fire: Phaser.GameObjects.Image;
  private nitroFlame: Phaser.GameObjects.Image;
  private spinFront = 0;
  private spinRear = 0;
  private angFront = 0;
  private angRear = 0;
  private nitroOn = false;
  private fireUntil = 0;
  private flick = 0;
  private now = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, visual: CarVisual) {
    super(scene, x, y);
    this.visual = visual;
    const def = BODIES[visual.body];
    this.length = def.L;
    const half = Math.round(def.L / 2);
    const { rear: rR, front: rF } = tireRadius(visual);
    this.frontR = rF;
    this.rearR = rR;
    const body = buildBody(scene, visual);
    const oy = GROUND - clearanceOf(visual) - 21;

    // The chassis pivots around the rear axle for body roll / squat.
    const pivotX = def.rearX - half;
    const pivotY = -rR;
    this.chassis = scene.add.container(pivotX, pivotY);

    const shadow = scene.add.rectangle(0, 0, def.L + 6, 3, 0x000000, 0.35).setOrigin(0.5, 0.5);
    this.add(shadow);

    const exX = body.exhaustX - half; // container-local
    const exY = body.exhaustY + oy - GROUND + 1;
    this.exhaustLocal = { x: exX, y: exY };
    this.rearContactLocal = { x: pivotX, y: 0 };

    this.fire = scene.add.image(exX - pivotX, exY - pivotY, buildFlames(scene, 'fire'), 0).setOrigin(1, 0.5);
    this.fire.setVisible(false);
    this.nitroFlame = scene.add.image(exX - pivotX, exY - pivotY, buildFlames(scene, 'nitro'), 0).setOrigin(1, 0.5);
    this.nitroFlame.setVisible(false);

    // Body image: texture pixel (OX + half, GROUND) sits at container (0,0).
    this.bodyImg = scene.add.image(-(OX + half) - pivotX, -GROUND - pivotY, body.key).setOrigin(0, 0);
    this.chassis.add([this.nitroFlame, this.fire, this.bodyImg]);
    this.add(this.chassis);

    const rim = visual.tires === 'street' ? parseColor(visual.accent) : visual.tires === 'pro' ? CHROME : 0x9a97ac;
    const rearKey = buildWheel(scene, rR, visual.tires, rim, visual.tires === 'pro');
    const frontKey = buildWheel(scene, rF, visual.tires === 'pro' ? 'street' : visual.tires, rim, false);
    const wr = scene.add.image(def.rearX - half + 0.5, -rR, rearKey, 0);
    const wf = scene.add.image(def.frontX - half + 0.5, -rF, frontKey, 0);
    this.wheels.push({ img: wr, rear: true }, { img: wf, rear: false });
    this.add([wr, wf]);

    this.setSize(def.L, 30);
    scene.add.existing(this);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick, this);
    this.once(Phaser.GameObjects.Events.DESTROY, () => scene.events.off(Phaser.Scenes.Events.UPDATE, this.tick, this));
  }

  /** Wheel speed in revolutions per second. Optional separate rear speed (wheelspin). */
  setWheelSpin(speed: number, rearSpeed?: number): this {
    this.spinFront = speed;
    this.spinRear = rearSpeed ?? speed;
    return this;
  }

  /** Body pitch in degrees around the rear axle. Positive = nose up (launch squat). */
  setBodyRoll(angle: number): this {
    this.chassis.setRotation(Phaser.Math.DegToRad(-angle));
    return this;
  }

  setNitro(on: boolean): this {
    this.nitroOn = on;
    this.nitroFlame.setVisible(on);
    return this;
  }

  /** A short backfire flame from the exhaust (shifts, limiter). */
  flameBurst(ms = 160): this {
    this.fireUntil = this.now + ms;
    this.fire.setVisible(true);
    const big = this.visual.exhaust === 'pro' ? 1.3 : this.visual.exhaust === 'street' ? 1.1 : 0.85;
    this.fire.setScale(big * 1.3, big);
    this.scene.tweens.add({ targets: this.fire, scaleX: big, duration: ms, ease: 'Quad.easeOut' });
    return this;
  }

  private tick(time: number, delta: number) {
    this.now = time;
    const dt = Math.min(delta, 50) / 1000;
    this.angFront = (this.angFront + this.spinFront * dt) % 1;
    this.angRear = (this.angRear + this.spinRear * dt) % 1;
    for (const w of this.wheels) {
      const spin = w.rear ? this.spinRear : this.spinFront;
      const ang = w.rear ? this.angRear : this.angFront;
      if (Math.abs(spin) > 9) w.img.setFrame(BLUR_FRAME);
      else {
        // 5 or 4 spokes -> the frame cycle repeats every 1/spokes of a turn; 6 frames per cycle
        const spokes = 5;
        const f = Math.floor(((((ang * spokes) % 1) + 1) % 1) * WHEEL_FRAMES) % WHEEL_FRAMES;
        w.img.setFrame(f);
      }
    }
    this.flick += delta;
    if (this.flick > 45) {
      this.flick = 0;
      const f = Math.floor(Math.random() * 3);
      if (this.nitroOn) {
        this.nitroFlame.setFrame(f);
        this.nitroFlame.setScale(0.9 + Math.random() * 0.25, 1);
      }
      if (this.fire.visible) this.fire.setFrame((f + 1) % 3);
    }
    if (this.fire.visible && time > this.fireUntil) this.fire.setVisible(false);
  }
}

export function makeCar(scene: Phaser.Scene, x: number, y: number, visual: CarVisual, scale = 1): CarSprite {
  const c = new CarSprite(scene, Math.round(x), Math.round(y), visual);
  c.setScale(scale);
  return c;
}
