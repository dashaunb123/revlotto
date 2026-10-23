// Chunky pixel icons drawn from ASCII maps and baked into textures (no image files).
// Owned by the shop/menus agent. Call ensureTextures(scene) before using any key.
//
// Keys:
//   slot_<slotId>          12x12  part slot icons (engine, intake, ...)
//   stat_<statKey>          8x8   stat icons (power, grip, weight, gearing, drag, shiftWindow)
//   pas_<id>               12x12  passive icons (falls back to pas_generic)
//   con_<id>               12x12  consumable icons (falls back to con_generic)
//   tuning                 12x12  tuning card icon
//   tag_<id>               12x12  skip-race tags (tagIcon(); falls back to tag_generic)
//   gar_<id>               12x12  garage upgrades (garageIcon(); tier 2 = gold frame)
//   brand_<brandId>        12x12  brand logo badges in the brand colours (brandIcon(); parodies only)
//   tier_<tier>             8x8   tier chevrons: stock dash, street 1, sport 2, pro 3 (tierIcon())
//   coin                    8x8
//   pack_parts / pack_power 52x76 booster pack art
//   px                      1x1 white pixel (particles / confetti)
import Phaser from 'phaser';
import { PAL } from './palette';
import type { SlotId, Tier } from '../core/types';
import { brandById } from '../game/brands';

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
  brand_loyalist: [
    '.yyyyyyyyyy.',
    'ykkkkkkkkkky',
    'ykkkkyykkkky',
    'ykkkkyykkkky',
    'ykyyyyyyyyky',
    'ykkyyyyyykky',
    'ykkkyyyykkky',
    'ykkyykkyykky',
    '.ykykkkkyky.',
    '..ykkkkkky..',
    '...ykkkky...',
    '....yyyy....',
  ],
  mixed_bag: [
    '....nnnn....',
    '.....nn.....',
    '...NNNNNN...',
    '..NrrNNbbN..',
    '.NNrrNNbbNN.',
    '.NNNNNNNNNN.',
    '.NNggNNyyNN.',
    '.NNggNNyyNN.',
    '.NNNNNNNNNN.',
    '..NNNNNNNN..',
    '...nnnnnn...',
    '............',
  ],
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
  // ---------- Perfect-shift streak ----------
  hot_streak: [
    '.....r......',
    '....rr......',
    '....rro.....',
    '...rroo..r..',
    '...roooo.rr.',
    '..rrooyoorr.',
    '..roooyyoor.',
    '.rrooyyyoor.',
    '.rooyywyyor.',
    '.rooywwwyor.',
    '..rooyyyor..',
    '...rrrrrr...',
  ],
  perfectionist: [
    '............',
    '...BBBBBB...',
    '..BwwBBBBB..',
    '.BwBBBBBBBB.',
    'bbbbbbbbbbbb',
    '.bBbBBBbBbb.',
    '..bBbBBbBb..',
    '...bBbbBb...',
    '....bBBb....',
    '.....bb.....',
    '............',
    '............',
  ],
  rev_matcher: [
    '....gggg....',
    '..gg....gg..',
    '.g........g.',
    '.g..w.....g.',
    'g....w....yg',
    'g.....w..y.g',
    'g.....kkk..g',
    '......kwk...',
    '......kkk...',
    '............',
    '..SSSSSSSS..',
    '............',
  ],
  tightrope: [
    '............',
    '.....ww.....',
    '.....ww.....',
    '....wwww....',
    '...w.ww.w...',
    '.....ww.....',
    '....w..w....',
    'nNnNnNnNnNnN',
    '............',
    '.s........s.',
    '.s........s.',
    'sss......sss',
  ],
  second_wind: [
    '............',
    '.TTTTTTT....',
    '........T...',
    '.TTTT...T...',
    '.....T.T....',
    '..TTT.......',
    '............',
    '.tttttttttt.',
    '...........t',
    '.ttttttt..t.',
    '........tt..',
    '............',
  ],
  shift_light: [
    '............',
    '.kkkkkkkkkk.',
    '.kggkyykrrk.',
    '.kggkyykrrk.',
    '.kkkkkkkkkk.',
    '.....ss.....',
    '.....ss.....',
    '............',
    '...w.ww.w...',
    '....w..w....',
    '..w......w..',
    '............',
  ],
  perfect_record: [
    '...kkkkkk...',
    '..kssssssk..',
    '.ksskkkkssk.',
    'kssksssskssk',
    'ksksyyyysksk',
    'ksksywwysksk',
    'ksksyyyysksk',
    'kssksssskssk',
    '.ksskkkkssk.',
    '..kssssssk..',
    '...kkkkkk...',
    '............',
  ],
  all_or_nothing: [
    '...wwwwww...',
    '..wwwwwwww..',
    '.wwwwwwwwww.',
    '.wkkwwwwkkw.',
    '.wkkwwwwkkw.',
    '.wwwwkkwwww.',
    '..wwwwwwww..',
    '...wkwkwk...',
    '...wwwwww...',
    '............',
    '.rrr....rrr.',
    '..rrr..rrr..',
  ],
  // ---------- Launch ----------
  quick_draw: [
    '.....kk.....',
    '....kook....',
    '....kyyk....',
    '....kook....',
    '....kyyk....',
    '....kook....',
    '....kggk....',
    '....kgwk....',
    '....kkkk....',
    '.....ss.....',
    '.....ss.....',
    '....ssss....',
  ],
  holeshot: [
    '............',
    '..kkkkk.....',
    '.kkssskk..g.',
    'kksdddskk.gg',
    'kssdkdsskggg',
    'kssdkdsskggg',
    'kksdddskk.gg',
    '.kkssskk..g.',
    '..kkkkk.....',
    'pppppppppppp',
    '............',
    '............',
  ],
  burnout_box: [
    '..SS..SS....',
    '.SSSSSSSS...',
    'SSSSSSSSSS..',
    '.SSSSSSSSSSS',
    '...SSSSSSSS.',
    '............',
    '...kkkkkk...',
    '..kkddddkk..',
    '..kdkkkkdk..',
    '..kkddddkk..',
    '...kkkkkk...',
    'oooooooooooo',
  ],
  torque_monster: [
    '............',
    '....rrr.....',
    '...rrrr.....',
    '..rr.rr.....',
    '.....rr..yy.',
    '.....rr.yy..',
    '.....rr.yyyy',
    '.....rr...yy',
    '.....rr..yy.',
    '...rrrrrryy.',
    '...rrrrrr...',
    '............',
  ],
  slingshot: [
    '.n........n.',
    '.nn......nn.',
    '..nP....Pn..',
    '..n.P..P.n..',
    '..n..PP..n..',
    '..n..ww..n..',
    '..nn.ww.nn..',
    '...nnnnnn...',
    '.....nn.....',
    '.....nn.....',
    '.....nn.....',
    '.....NN.....',
  ],
  // ---------- Nitro ----------
  hot_mix: [
    '....SSSS....',
    '.....ss.....',
    '.....ss.....',
    '....s..s....',
    '...s....s...',
    '..sppppppS..',
    '..spPpPppS..',
    '.sppppPpppS.',
    '.spPpppppPS.',
    '.sppppppppS.',
    '..ssssssss..',
    '............',
  ],
  wet_shot: [
    '.....b......',
    '....bb......',
    '...bBbb.....',
    '...bBbb..b..',
    '....bb..bb..',
    '.......bBbb.',
    '.......bBbb.',
    '..b.....bb..',
    '.bb.........',
    'bBbb........',
    'bBbb........',
    '.bb.........',
  ],
  spooled_up: [
    '............',
    '...oooooo...',
    '..oyyyyyyo..',
    '.oyoooooyo..',
    '.oyoyyyoyo..',
    '.oyoyoyoyo..',
    '.oyoyyoyo...',
    '.oyoooyo..pp',
    '.oyyyyyo..pP',
    '..ooooo...pp',
    '..........pp',
    '............',
  ],
  natural_aspiration: [
    '..........g.',
    '........ggg.',
    '......gggtg.',
    '.....ggggtg.',
    '....ggggtgg.',
    '...ggggtggg.',
    '...gggtgggg.',
    '...ggtgggg..',
    '...gtgggg...',
    '...tggg.....',
    '..t.........',
    '.t..........',
  ],
  late_spray: [
    '............',
    '.pppp.......',
    '....pp......',
    '..ppp...T.T.',
    '....pp.T.T..',
    '.pppp.TTTTT.',
    '.......T.T..',
    'ssss....T.T.',
    'sSSsss......',
    'ssss........',
    '............',
    '............',
  ],
  blow_off_valve: [
    '.....S..S...',
    '....S..S..S.',
    '.....S..S...',
    '............',
    '....ssss....',
    '...sSSSSs...',
    '...ssssss...',
    '....soos....',
    '....soos....',
    '..ssssssss..',
    '..sSSSSSSs..',
    '..ssssssss..',
  ],
  // ---------- Economy ----------
  nest_egg: [
    '............',
    '....yyyy....',
    '...yyyyyy...',
    '..yywyyyyy..',
    '..ywyyyyyy..',
    '..yyyyyyyy..',
    '..yyyyyyyo..',
    '.nNnNnNnNnN.',
    'nNnnNnnNnnNn',
    '.nnNnnNnnNn.',
    '..nnnnnnnn..',
    '............',
  ],
  piggy_bank: [
    '............',
    '.....kk.....',
    '..PPPPPPPP..',
    '.PPPPPPPPPP.',
    '.PkPPPPPPPPP',
    'PPPPPPPPPPPP',
    'PPPPPPPPPPP.',
    '.PPPPPPPPPP.',
    '..PP....PP..',
    '..PP....PP..',
    '...........y',
    '..........yo',
  ],
  sponsor_decal: [
    '............',
    '.wwwwwwwwww.',
    '.wrrrrrrrrw.',
    '.wrrrwwrrrw.',
    '.wrrwwwwrrw.',
    '.wrwwwwwwrw.',
    '.wrrwwwwrrw.',
    '.wrrwrrwrrw.',
    '.wrrrrrrrrw.',
    '.wwwwwwwwww.',
    '............',
    '............',
  ],
  bargain_hunter: [
    '.......yyyy.',
    '......yooooy',
    '.....yoookoy',
    '....yooooooy',
    '...yoooooooy',
    '..yoooooooy.',
    '.yoooooooy..',
    'yoooooooy...',
    '.yooooooy...',
    '..yooooy....',
    '...yyyy.....',
    '............',
  ],
  day_off: [
    '.......wwww.',
    '.........w..',
    '........w...',
    '.......wwww.',
    '..www.......',
    '...w........',
    '..www.......',
    '............',
    '.nnnnnnnnnn.',
    '.nBBBBBBBBn.',
    '.nnnnnnnnnn.',
    '.n........n.',
  ],
  scrap_dealer: [
    '............',
    '.......yyy..',
    '......yoooy.',
    '......yoyoy.',
    '......yoooy.',
    '.......yyy..',
    '....s.......',
    '...sSs..S...',
    '..sSssSsSs..',
    '.sSsSsssSSs.',
    'ssssssssssss',
    '............',
  ],
  prize_fighter: [
    '............',
    '...rrrrr....',
    '..rrrrrrr...',
    '.rrwrrrrrr..',
    '.rrrrrrrrrr.',
    '.rrrrrrrrrr.',
    '.rrrrrrrrr..',
    '..rrrrrrr...',
    '...wwwww....',
    '...wwwww....',
    '...ddddd....',
    '............',
  ],
  golden_wrench: [
    '.........yy.',
    '........y..y',
    '........y...',
    '.......yyy.y',
    '......yyy.y.',
    '.....yyy....',
    '....yyy.....',
    '...yyy......',
    '..yyy.......',
    'y.yy........',
    'yyy.........',
    '.y..........',
  ],
  // ---------- Scaling ----------
  momentum: [
    '............',
    '............',
    '.oo..oo..oo.',
    '..oo..oo..oo',
    '...oo..oo..o',
    '....oo..oo..',
    '...oo..oo..o',
    '..oo..oo..oo',
    '.oo..oo..oo.',
    '............',
    '............',
    '............',
  ],
  trophy_case: [
    '............',
    '.yyyyyyyyyy.',
    'y.yyyyyyyy.y',
    'y.yywyyyyy.y',
    '.yyywyyyyyy.',
    '...yyyyyy...',
    '....yyyy....',
    '.....yy.....',
    '.....yy.....',
    '....oooo....',
    '...oooooo...',
    '...nnnnnn...',
  ],
  patience: [
    '..nnnnnnnn..',
    '...SSSSSS...',
    '...SyyyyS...',
    '....SyyS....',
    '.....Sy.....',
    '.....yS.....',
    '....S.yS....',
    '...S..y.S...',
    '...SyyyyS...',
    '...SSSSSS...',
    '..nnnnnnnn..',
    '............',
  ],
  recycler: [
    '....gggg....',
    '...gg..gg...',
    '..gg....g...',
    '..g.....ggg.',
    '.ggg.....g..',
    '..g.........',
    '.........g..',
    '..g.....ggg.',
    '.ggg.....g..',
    '...g....gg..',
    '...gg..gg...',
    '....gggg....',
  ],
  old_money: [
    '....nnnn....',
    '.....nn.....',
    '....nNNn....',
    '...nNNNNn...',
    '..nNNyNNNn..',
    '.nNNyyyNNNn.',
    '.nNNyNNNNNn.',
    '.nNNNyyNNNn.',
    '.nNNNNNyNNn.',
    '.nNNyyyNNNn.',
    '..nNNyNNNn..',
    '...nnnnnn...',
  ],
  broken_in: [
    '....kkkk....',
    '...kSSSSk...',
    '..kSwwSdSk..',
    '..kSwSSSSk..',
    '..kSSdSSdk..',
    '...kSSSSk...',
    '....kssk....',
    '.....ss.....',
    '.....ss.....',
    '.....ss.....',
    '...nnnnnn...',
    '..nnnnnnnn..',
  ],
  // ---------- Position ----------
  mirror: [
    '............',
    '.....ss.....',
    '.....ss.....',
    '.kkkkkkkkkk.',
    'kSBBBBBBBBSk',
    'kSBwBBBBBBSk',
    'kSBBwBBBBBSk',
    'kSBBBBBBBBSk',
    '.kkkkkkkkkk.',
    '.......t....',
    '.tttttttt...',
    '.......t....',
  ],
  tow_hook: [
    '..t.ss......',
    '.tt.ss......',
    'tttttt......',
    '.tt.ss......',
    '..t.ss......',
    '....ss...ss.',
    '....ss...ss.',
    '....ss...ss.',
    '....sss.sss.',
    '.....sssss..',
    '......sss...',
    '............',
  ],
  pole_position: [
    's...........',
    'sgggggggg...',
    'sggggwgggg..',
    'sgggwwgggg..',
    'sggggwgggg..',
    'sggggwgggg..',
    'sgggwwwggg..',
    'sgggggggg...',
    's...........',
    's...........',
    's...........',
    'ss..........',
  ],
  convoy: [
    '............',
    '............',
    '............',
    '.bb..rr..yy.',
    'bbbbrrrryyyy',
    'bBbbrPrryoyy',
    '.k.k.k.k.k.k',
    '............',
    '.d.....t....',
    '.dd....tt...',
    '.ddd...ttt..',
    '............',
  ],
  // ---------- Weird / risky ----------
  coin_flip: [
    '...yyyyyy...',
    '..yyooooyy..',
    '.yyoyyyyoyy.',
    '.yoyyooyyoy.',
    '.yoyoyyoyoy.',
    '.yoyyyyoyoy.',
    '.yoyyyoyyoy.',
    '.yoyyoyyyoy.',
    '.yyoyyyyoyy.',
    '..yyoyyoyy..',
    '...yyyyyy...',
    '............',
  ],
  wild_card: [
    '..kkkkkkkk..',
    '..kwwwwwwk..',
    '..kwrwwwwk..',
    '..kwwwwwwk..',
    '..kwwPPwwk..',
    '..kwPPPPwk..',
    '..kwwPPwwk..',
    '..kwwwwwwk..',
    '..kwwwwrwk..',
    '..kwwwwwwk..',
    '..kkkkkkkk..',
    '............',
  ],
  overclock: [
    '..s.s.s.s...',
    '.kkkkkkkkk..',
    'skrrrrrrrks.',
    '.krryyrrrk..',
    'skrryyrrrks.',
    '.krrrryyrk..',
    'skrrryyrrks.',
    '.krrrrryrk..',
    'skrrrrrrrks.',
    '.kkkkkkkkk..',
    '..s.s.s.s...',
    '............',
  ],
  sandbagger: [
    '............',
    '....n..n....',
    '.....nn.....',
    '...NNNNNN...',
    '..NNNNNNNN..',
    '.NNnNNNNNNN.',
    '.NNNNNNNnNN.',
    '.NNNNNNNNNN.',
    '.NNNNnNNNNN.',
    '..NNNNNNNN..',
    '...nnnnnn...',
    '............',
  ],
  // ---------- New systems ----------
  boss_hunter: [
    '.....rr.....',
    '...rrrrrr...',
    '..rr.rr.rr..',
    '.r...rr...r.',
    '.r........r.',
    'rrrr.ww.rrrr',
    'rrrr.ww.rrrr',
    '.r........r.',
    '.r...rr...r.',
    '..rr.rr.rr..',
    '...rrrrrr...',
    '.....rr.....',
  ],
  home_garage: [
    '.....rr.....',
    '....rrrr....',
    '...rrrrrr...',
    '..rrrrrrrr..',
    '.rrrrrrrrrr.',
    '..ssssssss..',
    '..sSSSSSSs..',
    '..skkkkkks..',
    '..sSSSSSSs..',
    '..skkkkkks..',
    '..sSSSSSSs..',
    '..ssssssss..',
  ],
  heat_seeker: [
    '.....ss.....',
    '....sSSs....',
    '....sSSs.o..',
    '....sSrs....',
    '....sSrs.o..',
    '....sSrs....',
    '....sSrs.o..',
    '....srrs....',
    '...srrrrs...',
    '...srrrrs...',
    '....ssss....',
    '............',
  ],
  ballast: [
    '............',
    '............',
    '.ssssssssss.',
    'sSSSSSSSSSSs',
    '.sssssssss..',
    '...sssss....',
    '...sssss....',
    '..sssssss...',
    '.sssssssss..',
    '.kkkkkkkkk..',
    '............',
    '............',
  ],
  tag_along: [
    '............',
    '....s.......',
    '...s.s......',
    '..s...s.....',
    '.kkkkkkkkk..',
    '.kyyyyyyyk..',
    '.kyokkkoyk..',
    '.kyyyyyyyk..',
    '.kyokkoyyk..',
    '.kyyyyyyyk..',
    '.kkkkkkkkk..',
    '............',
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

// ---------- Tags and garage upgrades: a frame plus a 6x6 glyph ----------

const GLYPH: Record<string, string[]> = {
  gear: ['.S..S.', 'SSSSSS', 'SS..SS', 'SS..SS', 'SSSSSS', '.S..S.'],
  bolt: ['...yy.', '..yy..', '.yyyy.', '..yy..', '.yy...', 'yy....'],
  x2: ['......', 'w.w.ww', '.w...w', 'w.w.w.', '....ww', '......'],
  star: ['..pp..', 'pppppp', '.pppp.', '.pppp.', 'pp..pp', '......'],
  wrench: ['S...S.', 'SS.SS.', '.SSS..', '..SS..', '...SS.', '....SS'],
  arrows: ['.gggg.', 'g....g', 'g..ggg', 'ggg..g', 'g....g', '.gggg.'],
  up: ['..gg..', '.gggg.', 'gggggg', '..gg..', '..gg..', '..gg..'],
  house: ['..rr..', '.rrrr.', 'rrrrrr', '.SkkS.', '.SkkS.', '.SSSS.'],
  bottle: ['..ww..', '..tt..', '.tTTt.', '.tTTt.', '.tttt.', '.tttt.'],
  heart: ['.PP.PP', 'PPPPPP', 'PPPPPP', '.PPPP.', '..PP..', '......'],
  shelf: ['y.o.b.', 'nnnnnn', '.p.y.o', 'nnnnnn', 'n....n', 'n....n'],
  percent: ['ww...w', 'ww..w.', '...w..', '..w...', '.w..ww', 'w...ww'],
  toolbox: ['..rr..', '.r..r.', 'rrrrrr', 'rryyrr', 'rrrrrr', 'rrrrrr'],
  tire: ['.SSSS.', 'SsddsS', 'SdkkdS', 'SdkkdS', 'SsddsS', '.SSSS.'],
  cards: ['wwww..', 'wrrw..', 'wwwwww', '..wrrw', '..wwww', '......'],
  coin: ['.yyyy.', 'yooooy', 'yoyyoy', 'yoyyoy', 'yooooy', '.yyyy.'],
  q: ['.yyyy.', 'yy..yy', '...yy.', '..yy..', '......', '..yy..'],
};

/** Ticket-shaped tag frame; C = rarity color, glyph drawn at (4,3). */
const TAG_FRAME = [
  '...CCCCCCCC.',
  '..CkkkkkkkkC',
  '.CkkkkkkkkkC',
  'CkwkkkkkkkkC',
  'CkkkkkkkkkkC',
  'CkkkkkkkkkkC',
  'CkkkkkkkkkkC',
  'CkkkkkkkkkkC',
  '.CkkkkkkkkkC',
  '..CkkkkkkkkC',
  '...CCCCCCCC.',
  '............',
];
/** Shield-shaped garage badge; C = tier color, glyph drawn at (3,2). Tier 2 gets gold pips. */
const GARAGE_FRAME = [
  '.CCCCCCCCCC.',
  'CkkkkkkkkkkC',
  'CkkkkkkkkkkC',
  'CkkkkkkkkkkC',
  'CkkkkkkkkkkC',
  'CkkkkkkkkkkC',
  'CkkkkkkkkkkC',
  'CkkkkkkkkkkC',
  '.CkkkkkkkkC.',
  '..CkkkkkkC..',
  '...CkkkkC...',
  '....CCCC....',
];

const TAG_ICONS: Record<string, { glyph: string; c: string }> = {
  free_parts_pack: { glyph: 'gear', c: 'o' },
  free_power_pack: { glyph: 'bolt', c: 'p' },
  double_cash: { glyph: 'x2', c: 'y' },
  rare_part: { glyph: 'star', c: 'p' },
  tuning_card: { glyph: 'wrench', c: 'y' },
  reroll_party: { glyph: 'arrows', c: 'g' },
  investment: { glyph: 'up', c: 'g' },
  garage_coupon: { glyph: 'house', c: 'B' },
  extra_consumable: { glyph: 'bottle', c: 't' },
  mulligan: { glyph: 'heart', c: 'P' },
  generic: { glyph: 'q', c: 'S' },
};

const GARAGE_ICONS: Record<string, string> = {
  extra_shelf: 'shelf',
  showroom: 'shelf',
  discount: 'percent',
  wholesale: 'percent',
  reroll_surplus: 'arrows',
  reroll_glut: 'arrows',
  toolbox: 'toolbox',
  mega_toolbox: 'toolbox',
  pit_crew: 'tire',
  pit_crew_pro: 'tire',
  pack_rat: 'cards',
  pack_hoarder: 'cards',
  savings: 'coin',
  high_yield: 'coin',
  tune_up: 'wrench',
  master_tuner: 'wrench',
  generic: 'q',
};
const GARAGE_TIER2 = new Set(['showroom', 'wholesale', 'reroll_glut', 'mega_toolbox', 'pit_crew_pro', 'pack_hoarder', 'high_yield', 'master_tuner']);

function composeIcon(frame: string[], color: string, glyph: string[], ox: number, oy: number): string[] {
  const rows = frame.map((r) => r.replace(/C/g, color).split(''));
  glyph.forEach((gr, y) => {
    for (let x = 0; x < gr.length; x++) if (gr[x] !== '.') rows[oy + y][ox + x] = gr[x];
  });
  return rows.map((r) => r.join(''));
}

function tagMap(id: string): string[] {
  const t = TAG_ICONS[id] ?? TAG_ICONS.generic;
  return composeIcon(TAG_FRAME, t.c, GLYPH[t.glyph], 4, 3);
}

function garageMap(id: string): string[] {
  const tier2 = GARAGE_TIER2.has(id);
  const rows = composeIcon(GARAGE_FRAME, tier2 ? 'y' : 'B', GLYPH[GARAGE_ICONS[id] ?? 'q'], 3, 2);
  if (tier2) rows[1] = 'CwkkkkkkkkwC'.replace(/C/g, 'y');
  return rows;
}

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
  for (const k of Object.keys(TAG_ICONS)) bake(scene, `tag_${k}`, tagMap(k), 12);
  for (const k of Object.keys(GARAGE_ICONS)) bake(scene, `gar_${k}`, garageMap(k), 12);
  for (const [k, rows] of Object.entries(TIER_MAPS)) bake(scene, `tier_${k}`, rows, 8);
  for (const k of BRAND_ICON_IDS) brandIcon(scene, k);
  bakePack(scene, 'pack_parts', PAL.orange, PAL.yellow, SLOT_MAPS.transmission);
  bakePack(scene, 'pack_power', PAL.purple, PAL.pink, BOLT);
}

// ---------- Brand logo badges (parody shapes only, never real logos) ----------
// Glyphs are 10x10, drawn inside a 12x12 rounded badge. 'X' = brand colour, 'A' = brand accent (badge rim),
// other letters use the shared icon palette C.
const BRAND_GLYPH: Record<string, string[]> = {
  // Malibru: slanted bowtie-ish cross
  malibru: [
    '..........',
    '..........',
    '...XXXXXX.',
    'XXXXwwwwXX',
    'XwwwwwwwwX',
    'XXXXXXXXXX',
    'XXXXXXXXX.',
    '.XXXXXX...',
    '..........',
    '..........',
  ],
  // Civique: flared H
  civique: [
    '..........',
    '.XXX..XXX.',
    '..XX..XX..',
    '..XX..XX..',
    '..XXXXXX..',
    '..XXwwXX..',
    '..XX..XX..',
    '..XX..XX..',
    '.XXX..XXX.',
    '..........',
  ],
  // Stallion: galloping horse, running left
  stallion: [
    '..X.......',
    '.XXX......',
    'XXwXX.....',
    'X.XXXXXX..',
    '..XXXXXXXX',
    '..XXXXXXX.',
    '..X.X..XX.',
    '.X..X...X.',
    'X...X...X.',
    '..........',
  ],
  // Avenger: "A" crest with wings
  avenger: [
    '....XX....',
    '...XwwX...',
    '...XXXX...',
    '..XX..XX..',
    'X.XXXXXX.X',
    'XXXX..XXXX',
    '.XX....XX.',
    '.XX....XX.',
    'XX......XX',
    '..........',
  ],
  // Kaiju: spiky monster head, jaws open
  kaiju: [
    '.X..X..X..',
    '.XXXXXXX..',
    'XXyXXXXXX.',
    'XXXXXXXXXX',
    'XXXXXXXXXX',
    'XXw.w.w...',
    'XX........',
    'XXw.w.w...',
    'XXXXXXXXX.',
    '.XXXXXXX..',
  ],
  // Viperion: snake head with fangs over an S-coil
  viperion: [
    '..XXXXXX..',
    '.XyXXXXyX.',
    'XXXXXXXXXX',
    '.XwXXXXwX.',
    '..w.XX.w..',
    '....XX....',
    '...XX.....',
    '..XX...XX.',
    '..XXXXXXX.',
    '...XXXXX..',
  ],
  // Hellkat: snarling cat head
  hellkat: [
    'X........X',
    'XX......XX',
    'XXXXXXXXXX',
    'XyyXXXXyyX',
    'XXXXXXXXXX',
    'XXXXkkXXXX',
    '.XwXXXXwX.',
    '.XXwXXwXX.',
    '..XXXXXX..',
    '...XXXX...',
  ],
  // Lamberghoul: bull skull, brand-coloured horns
  lamberghoul: [
    'X........X',
    'XX......XX',
    '.XXwwwwXX.',
    '..wwwwww..',
    '..wkwwkw..',
    '..wwwwww..',
    '...wwww...',
    '...wkkw...',
    '...wwww...',
    '....ww....',
  ],
};

/** Fallback colours if brands.json has no entry yet (brandById wins). */
const BRAND_FALLBACK: Record<string, { color: number; accent: number }> = {
  malibru: { color: 0xe0b040, accent: 0xb8b2c8 },
  civique: { color: 0xf4ecd8, accent: 0xe8443a },
  stallion: { color: 0xb8b2c8, accent: 0x3c78e8 },
  avenger: { color: 0xf28c28, accent: 0x2b2833 },
  kaiju: { color: 0x5bc24a, accent: 0xf2d43a },
  viperion: { color: 0x3c78e8, accent: 0xf4ecd8 },
  hellkat: { color: 0xe8443a, accent: 0x2b2833 },
  lamberghoul: { color: 0xf2d43a, accent: 0x9b4de0 },
};

const BRAND_FRAME = [
  '.AAAAAAAAAA.',
  'AkkkkkkkkkkA',
  'AkkkkkkkkkkA',
  'AkkkkkkkkkkA',
  'AkkkkkkkkkkA',
  'AkkkkkkkkkkA',
  'AkkkkkkkkkkA',
  'AkkkkkkkkkkA',
  'AkkkkkkkkkkA',
  'AkkkkkkkkkkA',
  'AkkkkkkkkkkA',
  '.AAAAAAAAAA.',
];

const parseHex = (c: string | undefined): number | null => {
  if (!c) return null;
  const n = parseInt(c.replace(/^#|^0x/i, ''), 16);
  return Number.isFinite(n) ? n : null;
};

/** Brand colour + accent as numbers (brands.json first, then the fallback table). */
export function brandColors(id: string): { color: number; accent: number } {
  const b = brandById(id);
  const fb = BRAND_FALLBACK[id] ?? { color: PAL.ink, accent: PAL.inkDim };
  return { color: parseHex(b?.color) ?? fb.color, accent: parseHex(b?.accent) ?? fb.accent };
}

/** Pixel map of a brand badge (12x12) with X/A still symbolic. */
function brandMap(id: string): string[] {
  const glyph = BRAND_GLYPH[id];
  const rows = BRAND_FRAME.map((r) => r.split(''));
  if (glyph) {
    glyph.forEach((gr, y) => {
      for (let x = 0; x < gr.length; x++) if (gr[x] !== '.') rows[1 + y][1 + x] = gr[x];
    });
  } else {
    // Unknown brand: a plain colour chip
    for (let y = 3; y < 9; y++) for (let x = 3; x < 9; x++) rows[y][x] = 'X';
  }
  return rows.map((r) => r.join(''));
}

/**
 * Texture key for a brand's logo badge (12x12, baked on first use with the brand colours).
 * Scale it up (setScale(2)) for big set panels.
 */
export function brandIcon(scene: Phaser.Scene, id: string): string {
  const key = `brand_${id}`;
  if (scene.textures.exists(key)) return key;
  const { color, accent: acc } = brandColors(id);
  // Very dark accents (black stripes) vanish on the dark badge: rim with the brand colour instead.
  const lum = ((acc >> 16) & 255) * 0.3 + ((acc >> 8) & 255) * 0.59 + (acc & 255) * 0.11;
  const accent = lum < 48 ? color : acc;
  const rows = brandMap(id);
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  for (let y = 0; y < 12; y++) {
    for (let x = 0; x < 12; x++) {
      const ch = rows[y][x];
      const col = ch === 'X' ? color : ch === 'A' ? accent : C[ch];
      if (col === undefined) continue;
      g.fillStyle(col, 1).fillRect(x, y, 1, 1);
    }
  }
  g.generateTexture(key, 12, 12);
  g.destroy();
  return key;
}

/** All brand ids that have a drawn logo. */
export const BRAND_ICON_IDS = Object.keys(BRAND_GLYPH);

// ---------- Tier chevrons (8x8) ----------
const TIER_MAPS: Record<Tier, string[]> = {
  stock: ['........', '........', '........', '.dddddd.', '.dddddd.', '........', '........', '........'],
  street: ['........', '........', '...tt...', '..tTTt..', '.tT..Tt.', 't......t', '........', '........'],
  sport: ['...pp...', '..pPPp..', '.pP..Pp.', 'p..pp..p', '..pPPp..', '.pP..Pp.', 'p......p', '........'],
  pro: ['...oo...', '..oyyo..', '.oo..oo.', '...oo...', '..oyyo..', '.oo..oo.', '...oo...', '..oyyo..'],
};

/** Texture key for a tier chevron badge ('tier_sport'). Baked in ensureTextures. */
export const tierIcon = (tier: Tier) => `tier_${tier}`;

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

/** Texture key for a tag (TagDef id); falls back to tag_generic. */
export function tagIcon(scene: Phaser.Scene, id: string): string {
  return scene.textures.exists(`tag_${id}`) ? `tag_${id}` : 'tag_generic';
}

/** Texture key for a garage upgrade (GarageDef id); falls back to gar_generic. */
export function garageIcon(scene: Phaser.Scene, id: string): string {
  return scene.textures.exists(`gar_${id}`) ? `gar_${id}` : 'gar_generic';
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
