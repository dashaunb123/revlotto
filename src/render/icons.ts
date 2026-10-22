// Chunky pixel icons drawn from ASCII maps and baked into textures (no image files).
// Owned by the shop/menus agent. Call ensureTextures(scene) before using any key.
//
// Keys:
//   slot_<slotId>          12x12  part slot icons (engine, intake, ...)
//   stat_<statKey>          8x8   stat icons (power, grip, weight, gearing, drag, shiftWindow)
//   pas_<id>               12x12  passive icons (falls back to pas_generic)
//   con_<id>               12x12  consumable icons (falls back to con_generic)
//   tuning                 12x12  tuning card icon
//   coin                    8x8
//   pack_parts / pack_power 52x76 booster pack art
//   px                      1x1 white pixel (particles / confetti)
import Phaser from 'phaser';
import { PAL } from './palette';
import type { SlotId } from '../core/types';

const C: Record<string, number> = {
  k: PAL.bgDeep,
  w: PAL.ink,
  d: PAL.inkDim,
  r: PAL.red,
  o: PAL.orange,
  y: PAL.yellow,
  g: PAL.green,
  t: PAL.teal,
  T: 0x9af0ea,
  b: PAL.blue,
  B: 0x8fb4ff,
  p: PAL.purple,
  P: PAL.pink,
  l: PAL.panelLight,
  e: PAL.panelEdge,
  s: 0x6b6680,
  S: 0xb8b2c8,
  n: 0x8a5a33,
  N: 0xc28a52,
};

const SLOT_MAPS: Record<SlotId, string[]> = {
  engine: [
    '............',
    '.SS......SS.',
    '.sSS....SSs.',
    '..sSS..SSs..',
    '..ssSSSSss..',
    '.ssssssssss.',
    '.srrssssrrs.',
    '.ssssssssss.',
    '.sSSSSSSSSs.',
    '..ssssssss..',
    '..kk.kk.kk..',
    '............',
  ],
  intake: [
    '............',
    '..tttttttt..',
    '.tTTTTTTTTt.',
    '.tTtTtTtTTt.',
    '.tTTTTTTTTt.',
    '..tttttttt..',
    '....ssss....',
    '....sSSs....',
    '....ssss....',
    '....sSSs....',
    '...ssssss...',
    '............',
  ],
  forced_induction: [
    '............',
    '...ssssss...',
    '..sSSSSSSs..',
    '.sSs....sSs.',
    '.sS.oooo.Ss.',
    '.sS.oyyo.Ss.',
    '.sS.oooo.Ss.',
    '.sSs....sSs.',
    '..sSSSSSSs..',
    '..ssssssss..',
    '.SSSs.......',
    '............',
  ],
  exhaust: [
    '.........d.d',
    '..........d.',
    '........dd.d',
    '............',
    'ssssssssss..',
    'SSSSSSSSSSs.',
    'SSSSSSSSSSso',
    'sssssssssso.',
    '..........o.',
    '.........o..',
    '............',
    '............',
  ],
  ecu: [
    '............',
    '..s.s.s.s...',
    '.kkkkkkkkkk.',
    'skggggggggks',
    '.kgkkkkkkgk.',
    'skgkyyyykgks',
    '.kgkyyyykgk.',
    'skgkkkkkkgks',
    '.kggggggggk.',
    '.kkkkkkkkkk.',
    '..s.s.s.s...',
    '............',
  ],
  transmission: [
    '.....SS.....',
    '..SS.SS.SS..',
    '..SSSSSSSS..',
    '...SssssS...',
    '.SSSs..sSSS.',
    '.SSs....sSS.',
    '.SSs....sSS.',
    '.SSSs..sSSS.',
    '...SssssS...',
    '..SSSSSSSS..',
    '..SS.SS.SS..',
    '.....SS.....',
  ],
  differential: [
    '............',
    '.....oo.....',
    '....oyyo....',
    '...oyssyo...',
    'sssoysSsyosss',
    'SSSoysSsyoSSS',
    'sssoyssyosss',
    '...oyyyyo...',
    '....oooo....',
    '.....oo.....',
    '............',
    '............',
  ],
  tires: [
    '...kkkkkk...',
    '..kllllllk..',
    '.kllkkkkllk.',
    'klkkssssskkl',
    'klkssSSssklk',
    'klksSSSSsklk',
    'klksSSSSsklk',
    'klkssSSssklk',
    'klkkssssskkl',
    '.kllkkkkllk.',
    '..kllllllk..',
    '...kkkkkk...',
  ],
  suspension: [
    '...SSSSSS...',
    '.....ss.....',
    '..rrrrrrr...',
    '....rrrrrrr.',
    '..rrrrrrr...',
    '....rrrrrrr.',
    '..rrrrrrr...',
    '....rrrrrrr.',
    '..rrrrrrr...',
    '.....ss.....',
    '...SSSSSS...',
    '............',
  ],
  chassis: [
    '............',
    '............',
    '....SSSS....',
    '...S....S...',
    '..S......S..',
    '.SSSSSSSSSSS',
    '.S.S....S..S',
    '.SSSSSSSSSSS',
    '..kk....kk..',
    '..kk....kk..',
    '............',
    '............',
  ],
  aero: [
    '............',
    '............',
    'rrrrrrrrrrrr',
    'rwwwwwwwwwwr',
    'rrrrrrrrrrrr',
    '..ss....ss..',
    '..ss....ss..',
    '..ss....ss..',
    '.ssss..ssss.',
    '............',
    'd.dd..dd.dd.',
    '............',
  ],
  nitrous: [
    '.....rr.....',
    '....rrrr....',
    '.....SS.....',
    '....bbbb....',
    '...bBBbbb...',
    '...bBbbbb...',
    '...bBwwwb...',
    '...bBwbbb...',
    '...bBwwwb...',
    '...bBbbbb...',
    '...bbbbbb...',
    '....bbbb....',
  ],
};

const STAT_MAPS: Record<string, string[]> = {
  power: ['....yy..', '...yy...', '..yy....', '.yyyyyy.', '....yy..', '...yy...', '..yy....', '.y......'],
  grip: ['.kkkkkk.', 'kgkgkgkk', 'kkgkgkgk', 'kgkgkgkk', 'kkgkgkgk', 'kgkgkgkk', 'kkgkgkgk', '.kkkkkk.'],
  weight: ['..ssss..', '..s..s..', '.ssssss.', 'sSSSSSSs', 'sSkSkSSs', 'sSkkSSSs', 'sSkSkSSs', '.ssssss.'],
  gearing: ['..S..S..', '.SSSSSS.', 'SSs..sSS', '.S....S.', '.S....S.', 'SSs..sSS', '.SSSSSS.', '..S..S..'],
  drag: ['........', 'tttttt..', '......t.', '.ttttt..', '........', 'tttt.t..', '.....t..', '..ttt...'],
  shiftWindow: ['..PPPP..', '..PwwP..', '..PPPP..', '...ss...', '...ss...', '...ss...', '.ssssss.', '.ssssss.'],
  coin: ['..yyyy..', '.yooooy.', 'yoyyyyoy', 'yoyooooy', 'yoyyyyoy', 'yooooyoy', '.yyyyyy.', '..yyyy..'],
};

const PASSIVE_MAPS: Record<string, string[]> = {
  clean_launcher: [
    '...kkkkkk...',
    '..kkddddkk..',
    '..kd....dk..',
    '..kkddddkk..',
    '..kkooookk..',
    '..koyyyyok..',
    '..kkooookk..',
    '..kkggggkk..',
    '..kgwgggk...',
    '..kggggggk..',
    '..kkggggkk..',
    '...kkkkkk...',
  ],
  shift_savant: [
    '.....gg.....',
    '....gggg....',
    '...gggggg...',
    '..gggggggg..',
    '.....gg.....',
    '.....gg..y..',
    '.....gg.yyy.',
    '.....gg..y..',
    '..SSSSSSSS..',
    '..SkSkkSkS..',
    '..SSSSSSSS..',
    '............',
  ],
  double_clutch: [
    '............',
    '.SSSS..SSSS.',
    '.SwwS..SwwS.',
    '.SSSS..SSSS.',
    '..ss....ss..',
    '..ss....ss..',
    '..ss....ss..',
    '..ss....ss..',
    '..sss...sss.',
    '...sss...sss',
    '............',
    '............',
  ],
  redline_gambler: [
    '...kkkkkk...',
    '..kwwwwwwk..',
    '.kwwwwwwrrk.',
    'kwwwwwwrrrwk',
    'kwwwwwrrwwwk',
    'kwwwwrrwwwwk',
    'kwwwkkwwwwwk',
    'kwwwkkwwwwwk',
    '.kwwwwwwwwk.',
    '..kkkkkkkk..',
    '..rrrrrrrr..',
    '............',
  ],
  sticky_compound: [
    '..kkkkkkkk..',
    '.klllllllk..',
    'klkkkkkkklk.',
    'klkpppppklk.',
    'klkpPPppklk.',
    'klkpppppklk.',
    'klkkkkkkklk.',
    '.klllllllk..',
    '..kpkkpkk...',
    '...p..p.....',
    '...p..P.....',
    '...P........',
  ],
  featherweight: [
    '.........ww.',
    '.......wwww.',
    '......wwwdw.',
    '.....wwwdww.',
    '....wwwdww..',
    '...wwwdww...',
    '..wwwdww....',
    '..wwdww.....',
    '..wdww......',
    '..dw........',
    '.d..........',
    'd...........',
  ],
  boost_brain: [
    '............',
    '...PPPPPP...',
    '..PPwPPwPP..',
    '.PPwPPPPwPP.',
    '.PwPPwwPPwP.',
    '.PPPwPPwPPP.',
    '.PwPPPPPPwP.',
    '..PPwPPwPP..',
    '...PPPPPP...',
    '.....PP.....',
    '....oooo....',
    '...oyyyyo...',
  ],
  garage_rat: [
    '............',
    '............',
    '..ss........',
    '.sPPs.......',
    '.sPsssssss..',
    'ssssssssssss',
    'sksssssssssP',
    'sssssssssss.',
    '.Pssssssss..',
    '..s.s..s.s..',
    '...........P',
    '.........PP.',
  ],
  cash_cow: [
    '............',
    '.w........w.',
    '.ww......ww.',
    '..wwwwwwww..',
    '..wkwwwwkw..',
    '..wwwkkwww..',
    '..wwkkkkww..',
    '...wPPPPw...',
    '...wPkPkw...',
    '....wwww....',
    '...yyyyyy...',
    '..yoyyyyoy..',
  ],
  finish_line_flair: [
    's...........',
    'swwkkwwkkww.',
    'swwkkwwkkww.',
    'skkwwkkwwkk.',
    'skkwwkkwwkk.',
    'swwkkwwkkww.',
    'swwkkwwkkww.',
    's...........',
    's...........',
    's...........',
    's...........',
    'ss..........',
  ],
  generic: [
    '............',
    '...yyyyyy...',
    '..yy....yy..',
    '..yy....yy..',
    '.......yy...',
    '......yy....',
    '.....yy.....',
    '.....yy.....',
    '............',
    '.....yy.....',
    '.....yy.....',
    '............',
  ],
};

const CONSUMABLE_MAPS: Record<string, string[]> = {
  nitro_bottle: SLOT_MAPS.nitrous,
  grip_spray: [
    '....SS......',
    '...SkS..P.P.',
    '...SSS...P..',
    '..gggg..P.P.',
    '..gwwg......',
    '..gggg......',
    '..gwgg......',
    '..gwgg......',
    '..gwgg......',
    '..gggg......',
    '..gggg......',
    '...gg.......',
  ],
  wide_tach: [
    '...kkkkkk...',
    '..kwwwwwwk..',
    '.kwgwwwwrwk.',
    'kwggwwwwrrwk',
    'kwgggwwrrrwk',
    'kwwwwkkwwwwk',
    'kwwwwkkkwwwk',
    'kwwwwwwwkwwk',
    '.kwwwwwwwwk.',
    '..kkkkkkkk..',
    '............',
    '............',
  ],
  mulligan: [
    '....PPPP....',
    '..PP....PP..',
    '.P........P.',
    '.P.........P',
    'P..........P',
    'P..........P',
    'P........PPPP',
    'P.........PP.',
    '.P.........P',
    '.P..........',
    '..PP....PP..',
    '....PPPP....',
  ],
  generic: [
    '....kkkk....',
    '....wwww....',
    '....kddk....',
    '...kddddk...',
    '..kttttttk..',
    '..ktTttttk..',
    '..ktTttttk..',
    '..ktTttttk..',
    '..ktttttTk..',
    '..kttttttk..',
    '...kkkkkk...',
    '............',
  ],
};

const TUNING_MAP = [
  '.........SS.',
  '........S..S',
  '.......S...S',
  '......SS..S.',
  '.....SSSSS..',
  '....SSS.....',
  '...SSS......',
  '..SSS.......',
  '.SSS....y...',
  'SSS....yyy..',
  'SS......y...',
  '............',
];

function bake(scene: Phaser.Scene, key: string, rows: string[], size: number) {
  if (scene.textures.exists(key)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  for (let y = 0; y < size; y++) {
    const row = rows[y] ?? '';
    for (let x = 0; x < size; x++) {
      const ch = row[x];
      const col = ch ? C[ch] : undefined;
      if (col === undefined) continue;
      g.fillStyle(col, 1).fillRect(x, y, 1, 1);
    }
  }
  g.generateTexture(key, size, size);
  g.destroy();
}

/** Booster pack art, 52x76 (emblem drawn at 2x). */
export const PACK_W = 52;
export const PACK_H = 76;
function bakePack(scene: Phaser.Scene, key: string, body: number, light: number, emblem: string[]) {
  if (scene.textures.exists(key)) return;
  const W = PACK_W;
  const H = PACK_H;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  // crimped foil ends
  for (let x = 0; x < W; x += 4) {
    g.fillStyle(PAL.ink, 1).fillRect(x, 0, 2, 4).fillRect(x, H - 4, 2, 4);
    g.fillStyle(0xb8b2c8, 1).fillRect(x + 2, 1, 2, 3).fillRect(x + 2, H - 4, 2, 3);
  }
  g.fillStyle(PAL.bgDeep, 1).fillRect(1, 4, W - 2, H - 8);
  g.fillStyle(body, 1).fillRect(2, 5, W - 4, H - 10);
  // darker lower half + stripes
  g.fillStyle(0x000000, 0.18).fillRect(2, 48, W - 4, H - 53);
  g.fillStyle(light, 1).fillRect(2, 50, W - 4, 2);
  g.fillStyle(PAL.bgDeep, 0.5).fillRect(2, 56, W - 4, 1);
  // diagonal sheen
  g.fillStyle(0xffffff, 0.35);
  for (let i = 0; i < 10; i++) g.fillRect(4 + i * 2, 26 - i * 2, 2, 2);
  g.fillStyle(0xffffff, 0.25).fillRect(2, 5, W - 4, 2);
  // emblem disc
  const ex = Math.floor((W - 32) / 2);
  const ey = 12;
  g.fillStyle(PAL.bgDeep, 1).fillRect(ex, ey, 32, 32);
  g.fillStyle(light, 1).fillRect(ex + 1, ey + 1, 30, 30);
  g.fillStyle(PAL.bgDeep, 1).fillRect(ex + 3, ey + 3, 26, 26);
  for (let y = 0; y < 12; y++) {
    const row = emblem[y] ?? '';
    for (let x = 0; x < 12; x++) {
      const col = C[row[x]];
      if (col === undefined) continue;
      g.fillStyle(col, 1).fillRect(ex + 4 + x * 2, ey + 4 + y * 2, 2, 2);
    }
  }
  g.generateTexture(key, W, H);
  g.destroy();
}

const BOLT = [
  '......yy....',
  '.....yy.....',
  '....yy......',
  '...yy.......',
  '..yyyyyyy...',
  '.....yy.....',
  '....yy......',
  '...yy.......',
  '..yy........',
  '.yy.........',
  '............',
  '............',
];

export function ensureTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists('px')) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0xffffff, 1).fillRect(0, 0, 2, 2);
    g.generateTexture('px', 2, 2);
    g.destroy();
  }
  for (const [k, rows] of Object.entries(SLOT_MAPS)) bake(scene, `slot_${k}`, rows, 12);
  for (const [k, rows] of Object.entries(STAT_MAPS)) bake(scene, k === 'coin' ? 'coin' : `stat_${k}`, rows, 8);
  for (const [k, rows] of Object.entries(PASSIVE_MAPS)) bake(scene, `pas_${k}`, rows, 12);
  for (const [k, rows] of Object.entries(CONSUMABLE_MAPS)) bake(scene, `con_${k}`, rows, 12);
  bake(scene, 'tuning', TUNING_MAP, 12);
  bakePack(scene, 'pack_parts', PAL.orange, PAL.yellow, SLOT_MAPS.transmission);
  bakePack(scene, 'pack_power', PAL.purple, PAL.pink, BOLT);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Texture key for a passive, matching by id then by name. */
export function passiveIcon(scene: Phaser.Scene, id: string, name?: string): string {
  for (const k of [id, slug(id), name ? slug(name) : '']) {
    if (k && scene.textures.exists(`pas_${k}`)) return `pas_${k}`;
  }
  return 'pas_generic';
}

export function consumableIcon(scene: Phaser.Scene, id: string, name?: string): string {
  for (const k of [id, slug(id), name ? slug(name) : '']) {
    if (k && scene.textures.exists(`con_${k}`)) return `con_${k}`;
  }
  return 'con_generic';
}

export const slotIcon = (slot: SlotId) => `slot_${slot}`;

export const SLOT_SHORT: Record<SlotId, string> = {
  engine: 'MOTOR',
  intake: 'INTK',
  forced_induction: 'TURBO',
  exhaust: 'EXHST',
  ecu: 'ECU',
  transmission: 'TRANS',
  differential: 'DIFF',
  tires: 'TIRES',
  suspension: 'SUSP',
  chassis: 'BODY',
  aero: 'AERO',
  nitrous: 'NOS',
};

export const SLOT_NAME: Record<SlotId, string> = {
  engine: 'ENGINE',
  intake: 'INTAKE',
  forced_induction: 'FORCED INDUCTION',
  exhaust: 'EXHAUST',
  ecu: 'ECU',
  transmission: 'TRANSMISSION',
  differential: 'DIFFERENTIAL',
  tires: 'TIRES',
  suspension: 'SUSPENSION',
  chassis: 'CHASSIS',
  aero: 'AERO',
  nitrous: 'NITROUS',
};
