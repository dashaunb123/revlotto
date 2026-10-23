// Chunky side-view pixel cars, generated in code and cached as textures.
// Used by the race scenes and the shop's garage view.
//
//   const car = makeCar(scene, x, y, carVisualFromParts(game.state.parts), 2);
//   car.setWheelSpin(revsPerSecond); car.setBodyRoll(deg); car.setNitro(true); car.flameBurst();
//   car.setWheelie(deg); car.setBrakeLights(on); car.setSuspension(frontLift, rearSquat);
//
// (x, y) is the point on the ground under the middle of the car. The car faces right.
import Phaser from 'phaser';
import type { InstalledPart, OpponentDef, SlotId, Tier } from '../core/types';
import { partById } from '../data/content';
import { activeParagon } from '../game/brands';
import { Pix, framesToTexture, mix, parseColor, pointInPoly, shade, texRng } from './race/pix';

export type BodyType = 'compact' | 'muscle' | 'wedge' | 'truck' | 'super' | 'sedan' | 'hatch' | 'tuner' | 'brick' | 'widebody' | 'hyper';

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
  // ---- polish-pass contract (optional so opponents keep working) ----
  /** Rim colour override ('#rrggbb'). */
  rim?: string;
  livery?: LiveryId;
  /** Door number, 0 = none. */
  number?: number;
  engine?: Tier;
  suspension?: Tier;
  /** Sum of tuning levels across installed parts (0..36): tier stickers. */
  tuneLevels?: number;
  /** Brand id of a PARAGON look (see PARAGONS below): adds that car's own livery, wings, scoops and decals. */
  paragon?: string;
}

export type LiveryId = 'none' | 'stripes' | 'flames' | 'checker' | 'split';

/** The player's chosen look (persisted by src/game/cosmetics.ts). */
export interface CarLook {
  body: BodyType;
  color: string;
  accent: string;
  rim: string;
  livery: LiveryId;
  number: number;
}

/** The player's signature colors. */
export const PLAYER_COLOR = '#e8413c';
export const PLAYER_ACCENT = '#f7d23e';

export const DEFAULT_LOOK: CarLook = {
  body: 'compact',
  color: PLAYER_COLOR,
  accent: PLAYER_ACCENT,
  rim: '#d6d4e4',
  livery: 'none',
  number: 0,
};

function tierOf(parts: Record<SlotId, InstalledPart> | undefined, slot: SlotId): Tier {
  const ip = parts?.[slot];
  if (!ip) return 'stock';
  try {
    return partById(ip.partId)?.tier ?? 'stock';
  } catch {
    return 'stock';
  }
}

/**
 * The player's car from the installed parts and their chosen look. When all 12 parts of one brand are installed
 * (activeParagon), the car IS that brand's paragon: its body, paint and dressing replace the look.
 * Pass { paragon: false } to always draw the plain look (e.g. a paint-shop body picker).
 */
export function carVisualFromParts(
  parts: Record<SlotId, InstalledPart>,
  look: CarLook = DEFAULT_LOOK,
  opts: { paragon?: boolean } = {},
): CarVisual {
  let tune = 0;
  for (const ip of Object.values(parts ?? {})) tune += ip?.level ?? 0;
  if (opts.paragon !== false) {
    let brand: string | null = null;
    try {
      brand = parts ? activeParagon(parts) : null;
    } catch {
      brand = null;
    }
    const pv = brand ? paragonVisual(brand) : null;
    if (pv) return { ...pv, tuneLevels: tune };
  }
  return {
    body: look.body,
    color: look.color,
    accent: look.accent,
    rim: look.rim,
    livery: look.livery,
    number: look.number,
    tires: tierOf(parts, 'tires'),
    aero: tierOf(parts, 'aero'),
    exhaust: tierOf(parts, 'exhaust'),
    intake: tierOf(parts, 'intake'),
    forcedInduction: tierOf(parts, 'forced_induction'),
    nitrous: tierOf(parts, 'nitrous') !== 'stock',
    carbon: tierOf(parts, 'chassis') === 'pro',
    engine: tierOf(parts, 'engine'),
    suspension: tierOf(parts, 'suspension'),
    tuneLevels: tune,
  };
}

/** Opponent look: mid-tier parts, rising with the round; bosses get the full treatment. */
export function carVisualForOpponent(op: Pick<OpponentDef, 'car' | 'round' | 'race'>): CarVisual {
  const boss = op.race === 3;
  const hi = boss || op.round >= 4;
  const mid = op.round >= 3;
  const t: Tier = hi ? 'pro' : mid ? 'sport' : 'street';
  return {
    body: op.car.body,
    color: op.car.color,
    accent: op.car.accent,
    tires: hi ? 'pro' : mid ? 'sport' : op.round >= 2 ? 'street' : 'stock',
    aero: boss ? 'pro' : mid ? 'sport' : op.round >= 2 ? 'street' : 'stock',
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
  door: [number, number]; // x of the rear / front door gap
  vent?: number[]; // x, y, w, h dark side vent
  flares?: boolean; // bolt-on wheel-arch flares
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
    door: [19, 38],
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
    door: [27, 47],
  },
  wedge: {
    L: 70,
    // Countach-style wedge: the roof is the high point, the engine deck slopes DOWN to a modest tail, and the
    // windshield breaks into a long low hood. A tall tail reads as a nose lifting off to the left, so keep it low.
    poly: [[0, 19], [0, 11], [2, 10], [20, 7], [26, 3], [36, 3], [44, 7], [70, 13], [71, 15], [70, 18], [68, 21], [2, 21]],
    windows: [[[24, 7], [27, 4], [35, 4], [41, 7]]],
    rearX: 14,
    frontX: 56,
    belt: 11,
    clearance: 4,
    door: [24, 42],
    vent: [12, 11, 6, 3],
  },
  truck: {
    L: 74,
    poly: [[0, 20], [0, 8], [28, 8], [30, 1], [46, 1], [50, 8], [66, 9], [71, 10], [74, 12], [74, 20], [72, 21], [2, 21]],
    windows: [[[32, 7], [33, 3], [44, 3], [47, 7]]],
    rearX: 14,
    frontX: 60,
    belt: 9,
    clearance: 6,
    door: [29, 49],
  },
  super: {
    L: 72,
    poly: [[0, 17], [0, 11], [8, 10], [24, 7], [32, 5], [42, 5], [52, 10], [66, 12], [72, 15], [72, 18], [70, 21], [2, 21]],
    windows: [[[28, 9], [32, 6], [41, 6], [49, 10]]],
    rearX: 14,
    frontX: 58,
    belt: 12,
    clearance: 3,
    door: [27, 47],
    vent: [19, 13, 6, 3],
  },
  // ---- paragon bodies ----
  // Boxy 4-door family sedan: flat trunk, upright glasshouse with three side windows, square nose.
  sedan: {
    L: 68,
    poly: [[0, 19], [0, 9], [2, 8], [15, 8], [21, 2], [40, 2], [47, 8], [64, 9], [67, 10], [68, 12], [68, 19], [66, 21], [2, 21]],
    windows: [
      [[18, 8], [22, 4], [27, 4], [27, 8]],
      [[29, 8], [29, 4], [37, 4], [37, 8]],
      [[39, 8], [39, 4], [40, 4], [45, 8]],
    ],
    rearX: 13,
    frontX: 55,
    belt: 9,
    clearance: 4,
    door: [28, 47],
  },
  // Hot hatch: short, tall roof running to a near-vertical hatch, stubby nose.
  hatch: {
    L: 60,
    poly: [[0, 19], [0, 7], [2, 3], [6, 2], [30, 2], [39, 8], [53, 9], [58, 11], [60, 14], [60, 19], [58, 21], [2, 21]],
    windows: [
      [[4, 8], [6, 4], [16, 4], [16, 8]],
      [[18, 8], [18, 4], [29, 4], [35, 8]],
    ],
    rearX: 11,
    frontX: 48,
    belt: 9,
    clearance: 4,
    door: [17, 37],
  },
  // Long-hood tuner coupe: bubble cabin set far back, round tail, long low hood.
  tuner: {
    L: 74,
    poly: [[0, 18], [0, 11], [2, 9], [11, 8], [19, 4], [25, 2], [35, 2], [43, 8], [64, 10], [71, 12], [74, 15], [74, 19], [72, 21], [2, 21]],
    windows: [
      [[20, 8], [24, 4], [29, 3], [29, 8]],
      [[31, 8], [31, 3], [35, 3], [41, 8]],
    ],
    rearX: 13,
    frontX: 60,
    belt: 10,
    clearance: 3,
    door: [28, 45],
  },
  // Brick muscle: long flat trunk, short upright roof, long flat hood, square nose.
  brick: {
    L: 74,
    poly: [[0, 19], [0, 9], [1, 8], [18, 8], [24, 3], [40, 3], [47, 8], [70, 8], [73, 9], [74, 11], [74, 19], [72, 21], [2, 21]],
    windows: [
      [[23, 8], [26, 4], [31, 4], [31, 8]],
      [[33, 8], [33, 4], [40, 4], [45, 8]],
    ],
    rearX: 14,
    frontX: 61,
    belt: 9,
    clearance: 4,
    door: [30, 48],
  },
  // The brick, slammed and flared: bolt-on arches over fat tyres.
  widebody: {
    L: 74,
    poly: [[0, 19], [0, 9], [1, 8], [18, 8], [24, 3], [40, 3], [47, 8], [70, 8], [73, 9], [74, 11], [74, 19], [72, 21], [2, 21]],
    windows: [
      [[23, 8], [26, 4], [31, 4], [31, 8]],
      [[33, 8], [33, 4], [40, 4], [45, 8]],
    ],
    rearX: 14,
    frontX: 61,
    belt: 9,
    clearance: 2,
    door: [30, 48],
    flares: true,
  },
  // Hypercar wedge: very low, cab-forward, one straight line from the roof down to a low pointed NOSE (right);
  // the engine deck falls gently to the tail, which stays low.
  hyper: {
    L: 74,
    poly: [[0, 18], [0, 12], [2, 10], [14, 9], [24, 6], [30, 5], [37, 5], [43, 7], [72, 15], [74, 16], [74, 18], [72, 21], [2, 21]],
    windows: [[[26, 9], [30, 6], [37, 6], [46, 10]]],
    rearX: 15,
    frontX: 59,
    belt: 10,
    clearance: 3,
    door: [34, 47],
  },
};

const OUT = 0x0b0a14; // outline
const GLASS = 0x26324f;
const GLASS_HI = 0x8fb4e8;
const CHROME = 0xd6d4e4;
const CHROME_DK = 0x7d7a92;
const DARK = 0x16141e;
const RUBBER = 0x2c2938;
const DECAL = 0xf4ecd8;
const TAIL = 0xb8221c;
const HEAD = 0xfff2b0;

const TW = 96;
const TH = 48;
const GROUND = 44; // texture row of the ground line
const OX = 12; // texture x of body local x=0
const BAR_X = -8; // body-local x of the wheelie-bar wheel

// 3x5 pixel digits, rows top to bottom.
const DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001001010010', '111101111101111', '111101111001111'];
const STICKERS = [DECAL, 0x38c6f0, 0xf7d23e, 0x9cf06a, 0xff7ab8, 0xffffff];

function tireRadius(v: CarVisual): { rear: number; front: number } {
  if (v.tires === 'pro') return { rear: 9, front: 5 };
  if (v.tires === 'sport') return { rear: 8, front: 6 };
  if (v.tires === 'street') return { rear: 7, front: 7 };
  return { rear: 6, front: 6 };
}

function clearanceOf(v: CarVisual): number {
  const b = BODIES[v.body];
  const tire = v.tires === 'pro' ? 3 : v.tires === 'sport' ? 2 : v.tires === 'street' ? 1 : 0;
  const drop = v.suspension === 'street' ? 1 : v.suspension === 'sport' ? 2 : 0;
  return Math.max(1, b.clearance + tire - drop);
}

/** Tier stickers on the rear quarter: one per ~6 tuning levels, max 6. */
function stickerCount(v: CarVisual): number {
  return Math.min(STICKERS.length, Math.ceil((v.tuneLevels ?? 0) / 6));
}

function visualKey(v: CarVisual): string {
  return (
    `car_${v.body}_${v.color}_${v.accent}_${v.tires}_${v.aero}_${v.exhaust}_${v.intake}_${v.forcedInduction}_${v.nitrous ? 1 : 0}_${v.carbon ? 1 : 0}` +
    `_${v.rim ?? ''}_${v.livery ?? 'none'}_${(v.number ?? 0) % 100}_${v.engine ?? 'stock'}_${v.suspension ?? 'stock'}_${stickerCount(v)}_${v.paragon ?? ''}`
  );
}

/** Topmost body row (local y) of column x, from the polygon alone. */
function polyTop(def: BodyDef, x: number): number {
  for (let y = 0; y < 22; y++) if (pointInPoly(x + 0.5, y + 0.5, def.poly)) return y;
  return def.belt;
}

/** Where the hood bulge sits and how tall the tallest hood piece is (local coords). */
function hoodGeom(v: CarVisual): { x: number; top: number; peak: number } {
  const def = BODIES[v.body];
  const x = def.frontX - 6;
  const top = polyTop(def, x);
  const lift =
    v.forcedInduction === 'pro'
      ? 9
      : v.forcedInduction === 'sport'
        ? 4
        : v.intake === 'pro'
          ? 4
          : v.intake === 'sport' || v.intake === 'street'
            ? 3
            : v.engine === 'pro' || v.engine === 'sport'
              ? 3
              : v.engine === 'street'
                ? 2
                : 0;
  return { x, top, peak: top - lift };
}

/** Rows (local y) of the tail and head lights. */
function lightRows(def: BodyDef): { tail: number; head: number } {
  return { tail: Math.max(def.belt + 1, polyTop(def, 0)), head: Math.max(def.belt + 1, polyTop(def, def.L - 1)) };
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
  const exhaustTipLen = v.exhaust === 'pro' ? 5 : v.exhaust === 'sport' ? 5 : v.exhaust === 'street' ? 4 : 2;
  const exY = 19;
  if (scene.textures.exists(key)) return { key, exhaustX: -exhaustTipLen, exhaustY: exY };

  const p = new Pix(TW, TH);
  const b = def.belt;
  const livery = v.livery ?? 'none';
  p.poly(def.poly.map(([x, y]) => [tx(x), ty(y)]), base);

  // Column / row extents of the body for shading and liveries.
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
  const nose: number[] = []; // rightmost body column per row
  for (let y = 0; y < TH; y++) {
    nose[y] = -1;
    for (let x = TW - 1; x >= 0; x--) if (p.filled(x, y)) ((nose[y] = x), (x = -1));
  }

  // Paint (livery) per pixel, before light/shadow. Flat paint (checker) skips the shading.
  const flameLen = [9, 15, 11, 19, 13, 17, 8].map((n) => Math.round((n * def.L) / 64));
  const paint = (x: number, y: number): [number, boolean] => {
    const ly = y - oy;
    if (livery === 'split' && ly >= b + 5) return [accent, false];
    if (livery === 'stripes' && (ly === b + 3 || ly === b + 4 || ly === b + 6)) return [accent, false];
    if (livery === 'checker' && ly >= b + 3 && ly <= b + 6)
      return [(Math.floor((x - OX) / 2) + Math.floor((ly - b - 3) / 2)) % 2 ? DECAL : 0x24222c, true];
    if (livery === 'flames' && ly >= b + 1 && ly <= b + 7) {
      const r = ly - b - 1;
      const back = nose[y] - x; // px behind the nose
      if (back < flameLen[r]) {
        if (back === flameLen[r] - 1) return [shade(accent, -0.25), false]; // tip
        if (r >= 1 && r <= 5 && back < flameLen[r] - 5) return [mix(accent, 0xfff2b0, 0.6), false]; // hot core
        return [accent, false];
      }
    }
    return [base, false];
  };
  for (let x = 0; x < TW; x++) {
    if (top[x] < 0) continue;
    for (let y = top[x]; y <= bot[x]; y++) {
      const [c, flat] = paint(x, y);
      let amt = 0;
      if (y === top[x]) amt = 0.45;
      else if (y === top[x] + 1) amt = 0.2;
      else if (y >= bot[x] - 1) amt = -0.45;
      else if (y >= bot[x] - 4) amt = -0.22;
      p.set(x, y, flat ? shade(c, Math.min(amt, 0) * 0.5) : shade(c, amt));
    }
  }
  // Painted-metal lines: dark sill under the glass, a 1px bright crease, soft shadow under it.
  const tweak = (y: number, amt: number, x0 = tx(0), x1 = tx(def.L)) => {
    for (let x = x0; x <= x1; x++) if (top[x] >= 0 && y > top[x] + 1 && y < bot[x] - 3) p.set(x, y, shade(p.get(x, y), amt));
  };
  tweak(ty(b), -0.5);
  tweak(ty(b + 1), 0.4);
  tweak(ty(b + 2), -0.12);
  if (livery === 'split') tweak(ty(b + 5), 0.3);
  // Paragon paint: stripes, bands and lettering (before the glass so it sits on the panels).
  const pg = v.paragon ? PARAGONS[v.paragon] : undefined;
  if (pg) paragonPaint(p, v, def, { tx, ty, top, bot, base, accent });
  // Plain cars keep a thin accent pinstripe.
  if (livery === 'none' && !v.paragon)
    for (let x = tx(1); x < tx(def.L - 1); x++) if (p.filled(x, ty(b + 3)) && ty(b + 3) > top[x] + 1) p.set(x, ty(b + 3), accent);
  // Carbon hood: dark weave from windshield base to nose on the top rows.
  if (v.carbon) {
    for (let x = tx(def.frontX - 14); x < tx(def.L - 2); x++) {
      if (top[x] < 0) continue;
      for (let y = top[x]; y < top[x] + 2; y++) p.set(x, y, (x + y) % 2 ? 0x24222c : 0x34313f);
    }
  }
  // Roof reflection: a short bright streak on the roofline.
  {
    let minX = 999,
      maxX = -1;
    def.windows.flat().forEach(([x]) => ((minX = Math.min(minX, x)), (maxX = Math.max(maxX, x))));
    const rx = tx(Math.round(minX + (maxX - minX) * 0.3));
    for (let i = 0; i < 4; i++) if (top[rx + i] >= 0) p.set(rx + i, top[rx + i], shade(base, 0.8));
  }
  // Windows: light top edge, dark sill row, glare streaks.
  def.windows.forEach((w) => {
    const pts = w.map(([x, y]) => [tx(x), ty(y)]);
    p.poly(pts, GLASS);
    let minX = 999,
      maxX = -1;
    pts.forEach(([x]) => ((minX = Math.min(minX, x)), (maxX = Math.max(maxX, x))));
    for (let x = minX; x <= maxX; x++) {
      let y0 = -1,
        y1 = -1;
      for (let y = 0; y < TH; y++) if (p.get(x, y) === GLASS) (y0 < 0 && (y0 = y), (y1 = y));
      if (y0 < 0) continue;
      p.set(x, y0, mix(GLASS, GLASS_HI, 0.3));
      if (y1 > y0 + 1) p.set(x, y1, shade(GLASS, -0.35));
    }
    const gx = Math.round(minX + (maxX - minX) * 0.35);
    for (let i = 0; i < 6; i++) {
      const x = gx + i,
        y = ty(b) - 2 - i;
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
    const glassy = (c: number) => c === GLASS || c === GLASS_HI || c === mix(GLASS, GLASS_HI, 0.5) || c === mix(GLASS, GLASS_HI, 0.3) || c === shade(GLASS, -0.35);
    for (let y = ty(b) - 5; y < ty(b); y++) {
      if (glassy(p.get(bx, y))) {
        p.set(bx, y, 0x3c78e8);
        p.set(bx + 1, y, 0x6fa0ff);
        p.set(bx + 2, y, 0x2a56b0);
      }
    }
    p.set(bx + 1, ty(b) - 6, CHROME);
  }
  // Panel gaps: door front and rear, handle near the rear gap.
  const gap = shade(base, -0.55);
  for (const dx of def.door)
    for (let y = ty(b + 1); y < ty(20); y++) if (p.filled(tx(dx), y) && y > top[tx(dx)] + 1) p.set(tx(dx), y, mix(p.get(tx(dx), y), gap, 0.75));
  p.hline(tx(def.door[0] + 2), tx(def.door[0] + 4), ty(b + 2), shade(base, -0.5));
  p.hline(tx(def.door[0] + 2), tx(def.door[0] + 4), ty(b + 1), shade(base, 0.5));
  if (def.vent) {
    const [vx, vy, vw, vh] = def.vent;
    for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) p.set(tx(vx + i), ty(vy + j), i % 2 ? DARK : RUBBER);
  }
  // Bumpers: dark rubber strips poking 1px past the panels, lit top edge.
  for (const [x0, x1] of [[-1, 2], [def.L - 3, def.L]]) {
    p.hline(tx(x0), tx(x1), ty(16), 0x4a4658);
    p.hline(tx(x0), tx(x1), ty(17), RUBBER);
  }
  // Lights: tail (red, lit corner), head (warm, white hot spot, amber marker below).
  const lr = lightRows(def);
  p.rect(tx(0), ty(lr.tail), 2, 2, TAIL);
  p.set(tx(0), ty(lr.tail), 0xff6a5a);
  p.set(tx(2), ty(lr.tail), shade(base, -0.45));
  p.rect(tx(def.L - 2), ty(lr.head), 2, 2, HEAD);
  p.set(tx(def.L - 1), ty(lr.head), 0xffffff);
  p.set(tx(def.L - 3), ty(lr.head), shade(base, -0.45));
  if (p.filled(tx(def.L - 1), ty(lr.head + 2))) p.set(tx(def.L - 1), ty(lr.head + 2), 0xf28c28);

  // Wheel wells (dark, behind the wheels) with a shadowed lip.
  const well = new Uint8Array(TW * TH);
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
        else continue;
        well[y * TW + x] = 1;
      }
  }
  if (def.flares) {
    // Bolt-on arches: a lit lip band around each well, a dark outer edge, rivets.
    for (const [wx, r] of wells) {
      const cx = tx(wx) + 0.5;
      const cy = GROUND - r;
      for (let y = Math.floor(cy - r - 6); y <= cy; y++)
        for (let x = Math.floor(cx - r - 6); x <= Math.ceil(cx + r + 6); x++) {
          if (!p.filled(x, y) || well[y * TW + x]) continue;
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          if (d <= r + 3.6) p.set(x, y, shade(base, 0.28));
          else if (d <= r + 4.6) p.set(x, y, shade(base, -0.35));
          else continue;
          well[y * TW + x] = 1;
        }
      for (const a of [-2.6, -1.9, -1.2, -0.55])
        p.set(Math.floor(cx + Math.cos(a) * (r + 3)), Math.floor(cy + Math.sin(a) * (r + 3)), CHROME_DK);
    }
  }
  const busy = new Uint8Array(TW * TH); // roundel: stickers may touch it but not cover it
  const plain = (x: number, y: number) => p.filled(x, y) && !well[y * TW + x] && !busy[y * TW + x] && y > top[x] + 1;

  // Door roundel with the race number.
  const num = Math.floor(Math.abs(v.number ?? 0)) % 100;
  if (num > 0) {
    const digits = String(num);
    const w = digits.length * 4 + 1;
    const x0 = tx(Math.round((def.door[0] + def.door[1]) / 2)) - Math.floor(w / 2);
    const y0 = ty(Math.min(b + 3, 13));
    const corners = [[x0 - 1, y0 - 1], [x0 + w, y0 - 1], [x0 - 1, y0 + 7], [x0 + w, y0 + 7]].map(([cx, cy]) => [cx, cy, p.get(cx, cy)]);
    p.rect(x0 - 1, y0 - 1, w + 2, 9, shade(base, -0.55));
    p.rect(x0, y0, w, 7, DECAL);
    for (let j = -1; j < 8; j++) for (let i = -1; i < w + 1; i++) busy[(y0 + j) * TW + x0 + i] = 1;
    // round it: restore the paint at the outer corners, ring colour at the inner ones
    for (const [cx, cy, c] of corners) p.set(cx, cy, c);
    for (const [cx, cy] of [[x0, y0], [x0 + w - 1, y0], [x0, y0 + 6], [x0 + w - 1, y0 + 6]]) p.set(cx, cy, shade(base, -0.55));
    [...digits].forEach((d, i) => {
      const g = DIGITS[+d];
      for (let j = 0; j < 15; j++) if (g[j] === '1') p.set(x0 + 1 + i * 4 + (j % 3), y0 + 1 + Math.floor(j / 3), OUT);
    });
  }

  // Tier stickers: a row of 2x2 decals, on the rear quarter if the arch leaves room, else on the
  // door / front fender, else right under the side glass. Each needs plain paint and a 1px margin clear of the arches.
  const fits = (x: number, y: number) => {
    for (let j = -1; j < 3; j++)
      for (let i = -1; i < 3; i++) {
        const inner = i >= 0 && i < 2 && j >= 0 && j < 2;
        if (inner ? !plain(x + i, y + j) : !p.filled(x + i, y + j) || well[(y + j) * TW + x + i]) return false;
      }
    return true;
  };
  const total = v.paragon ? 0 : stickerCount(v);
  if (total > 0) {
    let best: number[][] = [];
    const tryRun = (x: number, y: number, dir: number) => {
      const run: number[][] = [];
      while (run.length < total && fits(x + run.length * 3 * dir, y)) run.push([x + run.length * 3 * dir, y]);
      if (run.length > best.length) best = run;
    };
    for (const ly of [b + 2, b + 5]) for (let x = tx(def.door[0] - 3); x >= tx(1) && best.length < total; x--) tryRun(x, ty(ly), -1);
    for (const ly of [b + 2, b + 5, b]) for (let x = tx(def.door[0] + 6); x < tx(def.frontX) && best.length < total; x++) tryRun(x, ty(ly), 1);
    best.forEach(([x, y], i) => {
      const c = STICKERS[i % STICKERS.length];
      p.rect(x, y, 2, 2, c);
      p.set(x + 1, y + 1, shade(c, -0.3));
    });
  }

  // Seat a hood/roof piece onto the body: fill the gap under it down to the sloping body top.
  const seat = (x0: number, x1: number, c: number) => {
    for (let x = x0; x <= x1; x++) {
      if (top[x] < 0) continue;
      let y = top[x] - 1;
      while (y > top[x] - 10 && !p.filled(x, y)) y--;
      if (y <= top[x] - 10) continue;
      for (let yy = y + 1; yy < top[x]; yy++) p.set(x, yy, c);
    }
  };

  // ---- Aero ----
  const deckTop = (x: number) => {
    const c = tx(x);
    return top[c] >= 0 ? top[c] : ty(10);
  };
  if (v.aero === 'street') {
    const d = deckTop(3);
    p.poly([[tx(0), d + 1], [tx(0), d - 3], [tx(2), d - 3], [tx(8), d], [tx(8), d + 1]], accent);
    p.hline(tx(0), tx(2), d - 3, shade(accent, 0.4));
  } else if (v.aero === 'sport') {
    // Pedestal wing on short legs + a front lip.
    const d = deckTop(5);
    p.vline(tx(3), d - 4, d, DARK);
    p.vline(tx(8), d - 4, d, DARK);
    p.rect(tx(-1), d - 6, 12, 2, accent);
    p.hline(tx(-1), tx(10), d - 6, shade(accent, 0.45));
    p.rect(tx(-2), d - 7, 1, 4, shade(accent, -0.3)); // endplate
    p.rect(tx(def.L - 6), ty(21), 8, 1, DARK);
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
    for (let x = tx(def.rearX + rR + 2); x < tx(def.frontX - rF - 2); x++) p.set(x, ty(20), RUBBER);
  }

  // ---- Hood: intake / forced induction / engine bulge ----
  const hood = hoodGeom(v);
  const hoodX = hood.x; // local x of the hood bulge centre
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
    seat(bx, bx + 11, DARK);
  } else if (v.forcedInduction === 'sport') {
    // Turbo hood: a raised dome with heat-extractor slots.
    const bx = tx(hoodX - 7);
    p.poly([[bx, hoodTop], [bx + 3, hoodTop - 4], [bx + 12, hoodTop - 4], [bx + 13, hoodTop]], shade(base, 0.12));
    p.hline(bx + 3, bx + 12, hoodTop - 4, shade(base, 0.5));
    for (let i = 0; i < 3; i++) p.rect(bx + 4 + i * 3, hoodTop - 2, 2, 1, DARK);
    seat(bx, bx + 13, shade(base, 0.12));
  } else if (v.intake === 'pro') {
    // Individual throttle bodies: velocity stacks through the hood.
    const bx = tx(hoodX - 5);
    for (let i = 0; i < 3; i++) {
      p.rect(bx + i * 4, hoodTop - 4, 3, 4, CHROME);
      p.set(bx + i * 4 + 1, hoodTop - 4, DARK);
      p.set(bx + i * 4, hoodTop - 3, 0xffffff);
    }
    seat(bx, bx + 10, CHROME_DK);
  } else if (v.intake === 'street' || v.intake === 'sport') {
    const bx = tx(hoodX - 5);
    p.poly([[bx, hoodTop], [bx + 2, hoodTop - 3], [bx + 9, hoodTop - 3], [bx + 9, hoodTop]], shade(base, 0.12));
    p.hline(bx + 2, bx + 8, hoodTop - 3, shade(base, 0.45));
    p.rect(bx + 7, hoodTop - 2, 2, 2, DARK);
    if (v.intake === 'sport') p.vline(bx + 9, hoodTop - 3, hoodTop - 1, CHROME); // ram-air mouth
    seat(bx, bx + 9, shade(base, 0.12));
  } else if (v.engine === 'pro' || v.engine === 'sport') {
    // Big-block cowl with a forward scoop.
    const bx = tx(hoodX - 6);
    p.poly([[bx, hoodTop], [bx + 3, hoodTop - 3], [bx + 11, hoodTop - 3], [bx + 11, hoodTop]], shade(base, 0.1));
    p.hline(bx + 3, bx + 10, hoodTop - 3, shade(base, 0.5));
    p.rect(bx + 9, hoodTop - 2, 2, 2, DARK);
    seat(bx, bx + 11, shade(base, 0.1));
  } else if (v.engine === 'street') {
    // Low power bulge.
    const bx = tx(hoodX - 5);
    p.poly([[bx, hoodTop], [bx + 2, hoodTop - 2], [bx + 8, hoodTop - 2], [bx + 10, hoodTop]], shade(base, 0.12));
    p.hline(bx + 2, bx + 8, hoodTop - 2, shade(base, 0.45));
    seat(bx, bx + 10, shade(base, 0.12));
  }
  if (v.forcedInduction === 'street' || v.forcedInduction === 'sport') {
    // Front-mount intercooler peeking out of the bumper.
    const ix = tx(def.L - 4);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 3; i++) p.set(ix + i, ty(15 + j), (i + j) % 2 ? CHROME_DK : CHROME);
  }

  // ---- Exhaust tip ----
  // Paragon extras: wings, pipes, scoops, badges (after the hood so they can sit on it).
  if (pg) paragonParts(p, v, def, { tx, ty, top, bot, base, accent, deckTop, seat, rR, rF, hoodX, hoodTop });

  const exC = v.exhaust === 'stock' ? 0x8a879c : CHROME;
  const eh = v.exhaust === 'stock' ? 1 : v.exhaust === 'sport' ? 3 : 2;
  p.rect(tx(-exhaustTipLen), ty(exY - (eh === 3 ? 1 : 0)), exhaustTipLen + 1, eh, exC);
  p.set(tx(-exhaustTipLen), ty(exY), DARK);
  if (v.exhaust === 'pro') {
    p.rect(tx(-exhaustTipLen), ty(exY - 3), exhaustTipLen + 1, 2, exC);
    p.set(tx(-exhaustTipLen), ty(exY - 3), DARK);
  }

  // ---- Pro suspension: drag wheelie bar trailing off the rear, tiny wheel 1px off the ground ----
  if (v.suspension === 'pro') {
    const wx = tx(BAR_X) + 0.5;
    const wy = GROUND - 3.5;
    p.line(tx(1), ty(19), wx, wy, CHROME_DK);
    p.disc(wx, wy, 1.6, RUBBER);
    p.set(wx, wy, CHROME);
  }

  p.outline(OUT);
  p.toTexture(scene, key);
  return { key, exhaustX: -exhaustTipLen, exhaustY: exY };
}

// ---------------------------------------------------------------------------
// PARAGONS: the transformed car per brand (all 12 parts of one brand installed). Fixed body, paint, parts look and
// dressing, so each one is instantly that car. Brand ids match src/data/brands.json.

interface ParagonLook {
  name: string;
  body: BodyType;
  color: string;
  accent: string;
  rim: string;
  parts: Pick<CarVisual, 'tires' | 'aero' | 'exhaust' | 'intake' | 'forcedInduction' | 'nitrous' | 'engine' | 'suspension' | 'carbon'>;
}

const P_BLACK = 0x1c1a24;
const P_WHITE = 0xf4f2ea;

export const PARAGONS: Record<string, ParagonLook> = {
  // Sleeper sedan: rental-car beige, but slammed, fat rear tyres, cowl hood, black SS hood stripes, red SS badge.
  malibru: {
    name: 'Malibru SS', body: 'sedan', color: '#b9b3a3', accent: '#d0182c', rim: '#24222c',
    parts: { tires: 'sport', aero: 'stock', exhaust: 'sport', intake: 'stock', forcedInduction: 'stock', nitrous: false, engine: 'sport', suspension: 'sport' },
  },
  // Phoenix-yellow hot hatch: black swan-neck wing, white wheels, red R badge and sill stripe, honeycomb grille.
  civique: {
    name: 'Civique Type-Arr', body: 'hatch', color: '#f5c400', accent: '#d6202a', rim: '#f4f2ea',
    parts: { tires: 'sport', aero: 'stock', exhaust: 'sport', intake: 'stock', forcedInduction: 'stock', nitrous: false, engine: 'street', suspension: 'sport' },
  },
  // White fastback with twin blue over-the-top stripes, GT500 rocker script, hood scoop, ducktail, quad pipes.
  stallion: {
    name: 'Stallion Shelbee', body: 'muscle', color: '#f2f0ea', accent: '#1e50d2', rim: '#d6d4e4',
    parts: { tires: 'sport', aero: 'street', exhaust: 'pro', intake: 'street', forcedInduction: 'stock', nitrous: false, engine: 'sport', suspension: 'sport' },
  },
  // Plum brick with the black bumblebee tail stripe, black hood stripes, shaker scoop, black wheels.
  avenger: {
    name: 'Avenger Scatpak', body: 'brick', color: '#6c2c94', accent: '#1c1a24', rim: '#1c1a24',
    parts: { tires: 'sport', aero: 'street', exhaust: 'sport', intake: 'stock', forcedInduction: 'stock', nitrous: false, engine: 'stock', suspension: 'street' },
  },
  // Orange long-hood tuner: the tall hoop wing, black claw graphics, bronze wheels, intercooler, NOS.
  kaiju: {
    name: 'Kaiju 2JZ', body: 'tuner', color: '#ff7a1a', accent: '#1c1a24', rim: '#c8a050',
    parts: { tires: 'sport', aero: 'stock', exhaust: 'sport', intake: 'stock', forcedInduction: 'sport', nitrous: true, engine: 'stock', suspension: 'sport' },
  },
  // Red V10 brute: twin white stripes, fender gills, chrome side pipes, huge black ACR wing and splitter.
  viperion: {
    name: 'Viperion ACR', body: 'super', color: '#c8161e', accent: '#f4f2ea', rim: '#1c1a24',
    parts: { tires: 'pro', aero: 'stock', exhaust: 'stock', intake: 'stock', forcedInduction: 'stock', nitrous: false, engine: 'sport', suspension: 'sport' },
  },
  // Black widebody demon: blower through the hood, red stripes and wheels, drag slicks, wheelie bar, NOS.
  hellkat: {
    name: 'Hellkat Demon', body: 'widebody', color: '#2c2b34', accent: '#e0201a', rim: '#e0201a',
    parts: { tires: 'pro', aero: 'street', exhaust: 'pro', intake: 'stock', forcedInduction: 'pro', nitrous: true, engine: 'pro', suspension: 'pro' },
  },
  // Lime wedge hypercar: nose low and forward, carbon hood, black side intake, skirts, big black wing.
  lamberghoul: {
    name: 'Lamberghoul Aventadoom', body: 'hyper', color: '#8ee000', accent: '#1c1a24', rim: '#1c1a24',
    parts: { tires: 'sport', aero: 'stock', exhaust: 'pro', intake: 'stock', forcedInduction: 'stock', nitrous: false, engine: 'stock', suspension: 'sport', carbon: true },
  },
};

export const PARAGON_IDS = Object.keys(PARAGONS);

/** The paragon car for a brand id (null for an unknown brand). */
export function paragonVisual(brandId: string): CarVisual | null {
  const pg = PARAGONS[brandId];
  if (!pg) return null;
  return { body: pg.body, color: pg.color, accent: pg.accent, rim: pg.rim, livery: 'none', number: 0, ...pg.parts, paragon: brandId };
}

// 3x5 letters for badges, rows top to bottom.
const GLYPHS: Record<string, string> = {
  S: '011100010001110', R: '110101110101101', G: '111100101101111', T: '111010010010010', J: '001001001101111',
  Z: '111001010100111', A: '010101111101101', C: '111100100100111',
};
function glyph(ch: string): string | undefined {
  return GLYPHS[ch] ?? (ch >= '0' && ch <= '9' ? DIGITS[+ch] : undefined);
}
function drawText(p: Pix, str: string, x: number, y: number, c: number) {
  [...str].forEach((ch, i) => {
    const g = glyph(ch);
    if (g) for (let j = 0; j < 15; j++) if (g[j] === '1') p.set(x + i * 4 + (j % 3), y + Math.floor(j / 3), c);
  });
}

interface PaintCtx {
  tx: (x: number) => number;
  ty: (y: number) => number;
  top: number[];
  bot: number[];
  base: number;
  accent: number;
}

/** Over-the-top stripes seen from the side: the top two rows of each column from x0 to x1 (body-local). */
function topStripe(p: Pix, k: PaintCtx, x0: number, x1: number, c: number) {
  for (let x = k.tx(x0); x <= k.tx(x1); x++) {
    if (k.top[x] < 0) continue;
    p.set(x, k.top[x], shade(c, 0.35));
    p.set(x, k.top[x] + 1, c);
  }
}

/** A horizontal band (body-local rows y0..y1) from x0 to x1, clipped to the body. */
function band(p: Pix, k: PaintCtx, x0: number, x1: number, y0: number, y1: number, c: number) {
  for (let x = k.tx(x0); x <= k.tx(x1); x++)
    for (let y = k.ty(y0); y <= k.ty(y1); y++) if (p.filled(x, y) && y > k.top[x] + 1 && y < k.bot[x] - 1) p.set(x, y, y === k.ty(y0) ? shade(c, 0.3) : c);
}

function paragonPaint(p: Pix, v: CarVisual, def: BodyDef, k: PaintCtx) {
  const b = def.belt;
  const { tx, ty, top, bot } = k;
  switch (v.paragon) {
    case 'malibru': {
      // The tells: a black side stripe, black rockers and a red SS badge on the front fender.
      band(p, k, 1, def.L - 1, b + 2, b + 3, P_BLACK);
      band(p, k, 1, def.L - 1, 19, 19, 0x4a4658);
      p.rect(tx(39) - 1, ty(b + 5) - 1, 9, 7, P_BLACK);
      drawText(p, 'SS', tx(39), ty(b + 5), k.accent);
      break;
    }
    case 'civique': {
      band(p, k, 2, def.L - 2, b + 8, b + 9, k.accent);
      // White badge with a red R on the door.
      const x0 = tx(21);
      const y0 = ty(b + 2);
      p.rect(x0 - 1, y0 - 1, 5, 7, P_WHITE);
      drawText(p, 'R', x0, y0, k.accent);
      // Honeycomb grille.
      for (let y = ty(12); y <= ty(15); y++) for (let x = tx(def.L - 3); x < tx(def.L); x++) if (p.filled(x, y)) p.set(x, y, (x + y) % 2 ? P_BLACK : 0x3a3746);
      break;
    }
    case 'stallion': {
      topStripe(p, k, 0, def.L - 1, k.accent);
      // Rocker stripe with the GT500 script above it, between the wheels.
      band(p, k, 21, 50, 19, 19, k.accent);
      drawText(p, 'GT', tx(36), ty(b + 3), k.accent);
      // Side scoop just ahead of the rear wheel.
      p.poly([[tx(22), ty(b + 2)], [tx(19), ty(b + 5)], [tx(22), ty(b + 5)]], P_BLACK);
      break;
    }
    case 'avenger': {
      topStripe(p, k, 46, def.L - 1, P_BLACK);
      topStripe(p, k, 0, 17, P_BLACK);
      // Full-length black side stripe swelling into the bumblebee tail band, with the yellow bee on the fender.
      band(p, k, 0, def.L - 8, b + 2, b + 3, P_BLACK);
      for (let x = tx(0); x <= tx(5); x++) for (let y = top[x]; y < bot[x] - 1; y++) p.set(x, y, P_BLACK);
      const bx = tx(50);
      const by = ty(b + 5);
      p.rect(bx - 1, by - 1, 6, 5, P_BLACK);
      p.rect(bx, by, 4, 3, 0xf7d23e);
      p.hline(bx, bx + 3, by + 1, P_BLACK);
      p.set(bx + 1, by - 1, P_WHITE);
      p.set(bx + 2, by - 1, P_WHITE);
      break;
    }
    case 'kaiju': {
      // Three black claw slashes ripping across the door, and a 2JZ decal on the fender.
      for (let i = 0; i < 3; i++) {
        const x0 = tx(31 + i * 4);
        for (let j = 0; j < 8; j++) {
          const x = x0 + Math.floor(j * 0.7);
          const y = ty(b + 1 + j);
          if (p.filled(x, y)) p.set(x, y, P_BLACK);
          if (j > 1 && j < 6 && p.filled(x + 1, y)) p.set(x + 1, y, P_BLACK);
        }
      }
      break;
    }
    case 'viperion': {
      // Twin white stripes over the top (two rows each, a body-colour gap between).
      for (let x = tx(0); x <= tx(def.L - 1); x++) {
        if (top[x] < 0) continue;
        p.set(x, top[x], P_WHITE);
        p.set(x, top[x] + 2, shade(P_WHITE, -0.12));
      }
      // Fender gills behind the front wheel.
      for (let i = 0; i < 3; i++) p.line(tx(46 + i * 2), ty(b + 2), tx(47 + i * 2), ty(b + 6), P_BLACK);
      break;
    }
    case 'hellkat': {
      topStripe(p, k, 0, def.L - 1, k.accent);
      band(p, k, 1, def.L - 1, b + 3, b + 3, k.accent);
      // Demon horns badge on the fender.
      const x0 = tx(51);
      const y0 = ty(b + 5);
      p.set(x0, y0, k.accent);
      p.set(x0 + 4, y0, k.accent);
      p.hline(x0, x0 + 4, y0 + 1, k.accent);
      p.hline(x0 + 1, x0 + 3, y0 + 2, k.accent);
      p.set(x0 + 1, y0 + 1, 0xffd040);
      p.set(x0 + 3, y0 + 1, 0xffd040);
      break;
    }
    case 'lamberghoul': {
      // Black lower body: skirts from nose to tail.
      band(p, k, 0, def.L, 18, 19, P_BLACK);
      break;
    }
  }
}

interface PartsCtx extends PaintCtx {
  deckTop: (x: number) => number;
  seat: (x0: number, x1: number, c: number) => void;
  rR: number;
  rF: number;
  hoodX: number;
  hoodTop: number;
}

/** A wing: plane from x0 to x1 (texture px) at row y, h thick, on legs at the given columns down to the deck. */
function wing(p: Pix, k: PartsCtx, x0: number, x1: number, y: number, h: number, legs: number[], c: number, end?: number) {
  for (const lx of legs) p.vline(lx, y + h, k.deckTop(lx - k.tx(0)), DARK);
  p.rect(x0, y, x1 - x0 + 1, h, c);
  p.hline(x0, x1, y, shade(c, c === P_BLACK ? 1.2 : 0.45));
  if (h > 2) p.hline(x0, x1, y + h - 1, shade(c, -0.35));
  if (end !== undefined) p.rect(x0 - 1, y - 2, 2, h + 4, end);
}

function paragonParts(p: Pix, v: CarVisual, def: BodyDef, k: PartsCtx) {
  const { tx, ty, deckTop } = k;
  switch (v.paragon) {
    case 'malibru': {
      // Second (dual) exhaust tip and a blacked-out grille.
      p.rect(tx(-3), ty(17), 4, 1, CHROME_DK);
      for (let y = ty(12); y <= ty(14); y++) p.set(tx(def.L - 1), y, P_BLACK);
      break;
    }
    case 'civique': {
      // Tall black swan-neck wing over the hatch.
      const roof = deckTop(4);
      for (const lx of [3, 9]) p.line(tx(lx + 2), roof, tx(lx), roof - 6, P_BLACK);
      wing(p, k, tx(-4), tx(12), roof - 8, 2, [], P_BLACK, k.accent);
      break;
    }
    case 'avenger': {
      // Shaker scoop through the hood.
      const bx = tx(k.hoodX - 5);
      p.rect(bx, k.hoodTop - 4, 9, 4, P_BLACK);
      p.hline(bx, bx + 8, k.hoodTop - 4, 0x4a4658);
      p.rect(bx + 7, k.hoodTop - 3, 2, 2, 0x0b0a14);
      p.hline(bx - 1, bx + 9, k.hoodTop, CHROME);
      k.seat(bx, bx + 8, P_BLACK);
      break;
    }
    case 'kaiju': {
      // The hoop wing: tall body-colour uprights, plane arched slightly at the middle.
      const d = deckTop(4);
      const c = shade(k.base, 0.05);
      for (const lx of [1, 10]) p.rect(tx(lx), d - 8, 2, 8, c);
      p.rect(tx(-3), d - 10, 18, 2, c);
      p.hline(tx(0), tx(11), d - 11, c);
      p.hline(tx(0), tx(11), d - 11, shade(k.base, 0.45));
      p.hline(tx(-3), tx(-1), d - 10, shade(k.base, 0.45));
      p.hline(tx(12), tx(14), d - 10, shade(k.base, 0.45));
      break;
    }
    case 'viperion': {
      // ACR: huge black wing on tall struts, deep splitter; chrome side pipes along the sill.
      const d = deckTop(5);
      wing(p, k, tx(-5), tx(12), d - 11, 3, [tx(2), tx(8)], P_BLACK, P_BLACK);
      p.rect(tx(def.L - 10), ty(21), 13, 1, P_BLACK);
      const x0 = tx(def.rearX + k.rR + 2);
      const x1 = tx(def.frontX - k.rF - 3);
      p.rect(x0, ty(19), x1 - x0, 2, CHROME);
      p.hline(x0, x1 - 1, ty(19), 0xffffff);
      for (let x = x0 + 2; x < x1 - 2; x += 3) p.set(x, ty(20), CHROME_DK);
      p.rect(x0 - 2, ty(19), 2, 2, DARK);
      break;
    }
    case 'hellkat': {
      // Demon eyes: a red halo ring by the headlight.
      const lr = lightRows(def);
      p.set(tx(def.L - 3), ty(lr.head), k.accent);
      p.set(tx(def.L - 3), ty(lr.head + 1), k.accent);
      break;
    }
    case 'lamberghoul': {
      // Big black side intake behind the door, black wing, splitter.
      const b = def.belt;
      p.poly([[tx(33), ty(b)], [tx(25), ty(b)], [tx(28), ty(b + 6)], [tx(33), ty(b + 6)]], P_BLACK);
      for (let y = ty(b + 1); y < ty(b + 6); y += 2) p.hline(tx(28), tx(32), y, 0x3a3746);
      // Y-shaped running light streak over the headlight.
      p.line(tx(def.L - 9), ty(13), tx(def.L - 3), ty(15), 0xfff2b0);
      const d = deckTop(5);
      wing(p, k, tx(-4), tx(12), d - 7, 2, [tx(3), tx(9)], P_BLACK, P_BLACK);
      p.rect(tx(def.L - 12), ty(21), 14, 1, P_BLACK);
      break;
    }
  }
}

/** Additive light overlays aligned with the body texture: brake lights + glow, headlight glow. */
function buildLights(scene: Phaser.Scene, v: CarVisual): { brake: string; head: string } {
  const def = BODIES[v.body];
  const oy = GROUND - clearanceOf(v) - 21;
  const lr = lightRows(def);
  const k = `carlights_${v.body}_${oy}`;
  const brake = `${k}_brake`;
  const head = `${k}_head`;
  if (scene.textures.exists(brake)) return { brake, head };
  const tx = (x: number) => x + OX;
  const ty = (y: number) => y + oy;

  const b = new Pix(TW, TH);
  const ry = ty(lr.tail) + 1; // glow centre (pixel edge between the two light rows)
  for (let y = ry - 4; y < ry + 4; y++)
    for (let x = tx(-5); x < tx(2); x++) {
      const d = Math.hypot(x + 0.5 - tx(0.5), y + 0.5 - ry);
      if (d < 4.5) b.set(x, y, 0xff2a1a, Math.round(110 * (1 - d / 4.5)));
    }
  b.rect(tx(0), ty(lr.tail), 2, 2, 0xff4a3a);
  b.set(tx(0), ty(lr.tail), 0xffd0c0);
  b.toTexture(scene, brake);

  const h = new Pix(TW, TH);
  const hy = ty(lr.head) + 1;
  for (let i = 0; i < 6; i++) {
    const spread = 1 + Math.floor(i / 3);
    for (let j = -spread; j < spread; j++) h.set(tx(def.L) + i, hy + j, 0xffc848, Math.round(42 * (1 - i / 6) * (1 - Math.abs(j + 0.5) / (spread + 1))));
  }
  h.toTexture(scene, head);
  return { brake, head };
}

// ---------------------------------------------------------------------------
// Wheels: 6 rotation frames + 1 motion-blur frame.

const WHEEL_FRAMES = 6;
const BLUR_FRAME = WHEEL_FRAMES;

function wheelKey(r: number, tier: Tier, rimColor: number): string {
  return `wheel2_${r}_${tier}_${rimColor.toString(16)}`;
}

function buildWheel(scene: Phaser.Scene, r: number, tier: Tier, rimColor: number, slick: boolean): string {
  const key = wheelKey(r, tier, rimColor) + (slick ? '_s' : '');
  if (scene.textures.exists(key)) return key;
  const S = 2 * r + 2;
  const c = S / 2;
  const spokes = tier === 'stock' ? 4 : 5;
  const rimR = slick ? r * 0.5 : tier === 'street' ? r * 0.68 : tier === 'sport' ? r * 0.64 : r * 0.58;
  const rimDk = shade(rimColor, -0.5);
  const frames: Pix[] = [];
  for (let f = 0; f <= WHEEL_FRAMES; f++) {
    const p = new Pix(S, S);
    p.disc(c, c, r, 0x1c1a22);
    p.ring(c, c, r - 1, r, 0x2e2b38);
    // tread highlight on top-left
    for (let a = -2.6; a < -1.4; a += 0.08)
      p.set(Math.floor(c + Math.cos(a) * (r - 0.6)), Math.floor(c + Math.sin(a) * (r - 0.6)), 0x4a4658);
    // sidewall ring just outside the rim
    p.ring(c, c, rimR + 0.4, rimR + 1.3, 0x3a3746);
    const steel = tier === 'stock';
    // steelies: flat face with holes; alloys: dark dish with bright spokes
    p.disc(c, c, rimR, steel ? rimColor : shade(rimColor, -0.55));
    if (f === BLUR_FRAME) {
      p.ring(c, c, rimR * 0.3, rimR - 1, mix(rimColor, rimDk, 0.35));
      if (slick) p.ring(c, c, r - 2.6, r - 1.6, 0x6a6676);
    } else {
      const base = (f / WHEEL_FRAMES) * ((Math.PI * 2) / spokes);
      for (let k = 0; k < spokes; k++) {
        const a = base + (k * Math.PI * 2) / spokes;
        if (steel) p.set(Math.floor(c + Math.cos(a) * rimR * 0.6), Math.floor(c + Math.sin(a) * rimR * 0.6), rimDk);
        else p.line(c - 0.5, c - 0.5, c - 0.5 + Math.cos(a) * (rimR - 1), c - 0.5 + Math.sin(a) * (rimR - 1), rimColor);
        if (slick) {
          const la = a + 0.3;
          p.set(Math.floor(c + Math.cos(la) * (r - 2)), Math.floor(c + Math.sin(la) * (r - 2)), 0xf4ecd8);
          p.set(Math.floor(c + Math.cos(la + 0.25) * (r - 2)), Math.floor(c + Math.sin(la + 0.25) * (r - 2)), 0xf4ecd8);
        }
      }
    }
    // rim lip: rim-coloured edge, bright arc on the top-left catching the light
    p.ring(c, c, rimR - 1, rimR, steel ? shade(rimColor, -0.3) : rimColor);
    for (let a = -2.8; a < -1.2; a += 0.06)
      p.set(Math.floor(c + Math.cos(a) * (rimR - 0.5)), Math.floor(c + Math.sin(a) * (rimR - 0.5)), shade(rimColor, 0.6));
    p.rect(c - 1, c - 1, 2, 2, shade(rimColor, 0.7));
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
// Container layout:
//   CarSprite (ground point under the middle of the car)
//     shadow                       stays on the ground
//     rig  @ rear contact patch    setWheelie() pitches this (body + both wheels)
//       chassis @ rear axle        setBodyRoll() / setSuspension() pitch and squat this
//         flames, body, light overlays
//       rear wheel, front wheel
//
// All *Local points are in unscaled container-local px for the car at rest (no wheelie, no roll).
// Use livePoint() for where a point is right now, and multiply by the car's scale for screen px.

type Pt = { x: number; y: number };

export class CarSprite extends Phaser.GameObjects.Container {
  readonly visual: CarVisual;
  readonly length: number; // body length in local (unscaled) px
  /** Exhaust tip (moves with body roll and wheelie: use livePoint(car.exhaustLocal)). */
  readonly exhaustLocal: Pt;
  /** Rear tire contact patch; the wheelie pivot, so it never moves. */
  readonly rearContactLocal: Pt;
  /** Front tire contact patch (lifts off during a wheelie: livePoint(car.frontContactLocal, false)). */
  readonly frontContactLocal: Pt;
  /** Top of the hood / tallest hood piece (blower, stacks, scoop): where a turbo flutter puff comes from.
   *  Moves with body roll and wheelie: livePoint(car.hoodLocal). */
  readonly hoodLocal: Pt;
  /** Bottom of the wheelie-bar wheel (pro suspension), ~1px off the ground at rest. It drops onto the
   *  ground once a wheelie passes ~3 deg: spark there. Without a bar this is the rear bumper's bottom
   *  corner (what scrapes instead). Moves: livePoint(car.wheelieBarLocal). */
  readonly wheelieBarLocal: Pt;
  readonly hasWheelieBar: boolean;
  /** Front / rear tire radius in local (unscaled) px. */
  readonly frontR: number;
  readonly rearR: number;
  private rig: Phaser.GameObjects.Container;
  private chassis: Phaser.GameObjects.Container;
  private bodyImg: Phaser.GameObjects.Image;
  private brakeImg: Phaser.GameObjects.Image;
  private wheels: { img: Phaser.GameObjects.Image; rear: boolean }[] = [];
  private fire: Phaser.GameObjects.Image;
  private nitroFlame: Phaser.GameObjects.Image;
  private wheelbase: number;
  private roll = 0;
  private frontLift = 0;
  private rearSquat = 0;
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
    this.wheelbase = def.frontX - def.rearX;
    const body = buildBody(scene, visual);
    const lights = buildLights(scene, visual);
    const oy = GROUND - clearanceOf(visual) - 21;
    // body-local (lx, ly) -> container-local at rest
    const loc = (lx: number, ly: number): Pt => ({ x: lx - half, y: ly + oy - GROUND });

    const pivotX = def.rearX - half;
    this.rig = scene.add.container(pivotX, 0);
    this.chassis = scene.add.container(0, -rR);

    const shadow = scene.add.rectangle(0, 0, def.L + 6, 3, 0x000000, 0.35).setOrigin(0.5, 0.5);
    this.add(shadow);

    const ex = loc(body.exhaustX, body.exhaustY + 1);
    this.exhaustLocal = ex;
    this.rearContactLocal = { x: pivotX, y: 0 };
    this.frontContactLocal = { x: def.frontX - half, y: 0 };
    const hood = hoodGeom(visual);
    this.hoodLocal = loc(hood.x + 0.5, hood.peak);
    this.hasWheelieBar = visual.suspension === 'pro';
    this.wheelieBarLocal = this.hasWheelieBar ? { x: BAR_X - half + 0.5, y: -1 } : loc(0, 21);

    // Chassis children: container-local p sits at chassis-local (p.x - pivotX, p.y + rR).
    this.fire = scene.add.image(ex.x - pivotX, ex.y + rR, buildFlames(scene, 'fire'), 0).setOrigin(1, 0.5);
    this.fire.setVisible(false);
    this.nitroFlame = scene.add.image(ex.x - pivotX, ex.y + rR, buildFlames(scene, 'nitro'), 0).setOrigin(1, 0.5);
    this.nitroFlame.setVisible(false);

    // Body image: texture pixel (OX + half, GROUND) sits at container (0,0).
    const ix = -(OX + half) - pivotX;
    const iy = -GROUND + rR;
    this.bodyImg = scene.add.image(ix, iy, body.key).setOrigin(0, 0);
    const headImg = scene.add.image(ix, iy, lights.head).setOrigin(0, 0).setBlendMode(Phaser.BlendModes.ADD);
    this.brakeImg = scene.add.image(ix, iy, lights.brake).setOrigin(0, 0).setBlendMode(Phaser.BlendModes.ADD);
    this.brakeImg.setVisible(false);
    this.chassis.add([this.nitroFlame, this.fire, this.bodyImg, headImg, this.brakeImg]);

    const rim = visual.rim
      ? parseColor(visual.rim)
      : visual.tires === 'street'
        ? parseColor(visual.accent)
        : visual.tires === 'sport'
          ? 0xc8a050
          : visual.tires === 'pro'
          ? CHROME
          : 0x9a97ac;
    const rearKey = buildWheel(scene, rR, visual.tires, rim, visual.tires === 'pro');
    const frontKey = buildWheel(scene, rF, visual.tires === 'pro' ? 'street' : visual.tires, rim, false);
    const wr = scene.add.image(0.5, -rR, rearKey, 0);
    const wf = scene.add.image(this.wheelbase + 0.5, -rF, frontKey, 0);
    this.wheels.push({ img: wr, rear: true }, { img: wf, rear: false });
    this.rig.add([this.chassis, wr, wf]);
    this.add(this.rig);

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

  /** Body pitch in degrees around the rear axle. Positive = nose up (launch squat). Wheels stay put. */
  setBodyRoll(angle: number): this {
    this.roll = angle;
    return this.applyChassis();
  }

  /** Body-only squat / settle in local px, wheels untouched: frontLift > 0 raises the nose,
   *  rearSquat > 0 sinks the tail. Combines with setBodyRoll. */
  setSuspension(frontLift: number, rearSquat: number): this {
    this.frontLift = frontLift;
    this.rearSquat = rearSquat;
    return this.applyChassis();
  }

  /** Whole-car pitch around the rear contact patch in degrees (front wheel lifts). 0 = grounded.
   *  The ground shadow stays put. */
  setWheelie(deg: number): this {
    this.rig.setRotation(Phaser.Math.DegToRad(-deg));
    return this;
  }

  /** Bright taillights with a small red glow. */
  setBrakeLights(on: boolean): this {
    this.brakeImg.setVisible(on);
    return this;
  }

  /** Where a rest-pose local point (e.g. car.hoodLocal) is right now, after wheelie, roll and squat.
   *  onBody = false for points on the wheels / ground (contact patches): those ignore roll and squat.
   *  Result is unscaled container-local; screen = car.x + p.x * car.scaleX, car.y + p.y * car.scaleY. */
  livePoint(p: Pt, onBody = true): Pt {
    let x = p.x - this.rig.x;
    let y = p.y;
    if (onBody) {
      const cx = x,
        cy = y + this.rearR; // chassis-local at rest
      const r = this.chassis.rotation;
      x = this.chassis.x + cx * Math.cos(r) - cy * Math.sin(r);
      y = this.chassis.y + cx * Math.sin(r) + cy * Math.cos(r);
    }
    const a = this.rig.rotation;
    return { x: this.rig.x + x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
  }

  /** livePoint() in scene coordinates. */
  worldPoint(p: Pt, onBody = true): Pt {
    const l = this.livePoint(p, onBody);
    return { x: this.x + l.x * this.scaleX, y: this.y + l.y * this.scaleY };
  }

  private applyChassis(): this {
    this.chassis.setPosition(0, -this.rearR + this.rearSquat);
    this.chassis.setRotation(Phaser.Math.DegToRad(-this.roll) - Math.atan2(this.frontLift + this.rearSquat, this.wheelbase));
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
    const big = this.visual.exhaust === 'pro' ? 1.3 : this.visual.exhaust === 'sport' ? 1.2 : this.visual.exhaust === 'street' ? 1.1 : 0.85;
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
