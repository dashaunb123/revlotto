// The shop: buy parts / powerups / packs between races. The most important menu in the game.
//
// LAYOUT (640x360, all integer coords)
// ┌ TOP BAR (0,0)-(640,30) ─────────────────────────────────────────────────────────────────┐
// │ $CASH 24px yellow @x10   ROUND 1 - RACE 1/4 @x128,y6   NEXT: NAME (right @x632,y6)        │
// │                  SEED XXXXXX [HEAT n] [tag][tag].. y18   [BOSS] MOD  TARGET 13.800 (y18)   │
// ├ GARAGE (6,34)-(206,118) ─────┬ INVENTORY (214,34)-(634,118) ──────────────────────────────┤
// │ owned upgrades 13px @x62+14i │ PASSIVES 2/5 ..LEFT>RIGHT  | ITEMS 1/2  | TUNE                 │
// │ car (makeCar x2) ground y108 │ n cards 44x60 cx=244+p*i cy=86 | m cards after a 14px gap | cx=608 │
// │ [PAINT] (160,37,42,13)       │ p = min(50, 300/(n+m-1)): cards overlap when slots grow       │
// ├ PARTS (6,122)-(206,354) ─────┼ SHOP (214,122)-(634,240) ───────────────────────────────────┤
// │ 4x3 tiles 44x52 brand strip  │ [TO THE STRIP] (222,128,92,48)  offers 64x92 cy=188         │
// │ x=10+48c, y=136+54r          │ [REROLL $3]    (222,184,92,48)  cx=358,428 | 508,578        │
// │                              ├ PACKS (214,244)-(454,354) ───────┬ STATS (460,244)-(634,354) ┤
// │ SETS (8,298)-(204,352) 3 rows│ packs 52x76 cx=254,334; GARAGE   │ 6 rows y=263+15i, bars x592│
// │                              │ upgrade card 56x80 cx=414 cy=300 │                           │
// └──────────────────────────────┴────────────────────────────┴────────────────────────────────┘
// The pack overlay covers y>=120 so the inventory band stays usable for making room.
import Phaser from 'phaser';
import type { CarStats, SlotId, StatKey } from '../core/types';
import { SLOTS } from '../core/types';
import { game } from '../game/game';
import { goToPhase, runLook } from './nav';
import { GAME_W, PAL, TIER_COLOR, hex } from '../render/palette';
import {
  Tooltip,
  burst,
  button,
  closeContextMenu,
  contextMenu,
  drawPanel,
  floatText,
  hitBox,
  hoverTilt,
  panel,
  pop,
  sfx,
  shadowTxt,
  shake,
  tickNumber,
  toast,
  txt,
  heatBadge,
  roundLabel,
  tagIconKey,
  garageIconKey,
  type Button,
  type TipLine,
} from '../render/ui';
import { PACK_W, SLOT_SHORT, ensureTextures, slotIcon } from '../render/icons';
import { Card } from '../render/shop/card';
import { consumableSlotCard, garageCard, iconKeyFor, passiveSlotCard, shopItemCard } from '../render/shop/factory';
import { STAT_LABEL, brandTip, consumableTip, fmtStat, garageTip, installedPartTip, isGood, paragonTip, passiveTip, shopItemTip, tagTip, tuningTip } from '../render/shop/describe';
import { brandInfo, brandLogo, ownedBrands, paragonOf } from '../render/shop/factory';
import { activeParagon, setLevel } from '../game/brands';
import { ParagonTransform } from '../render/shop/packOverlay';
import { PackOverlay } from '../render/shop/packOverlay';
import { carVisualFromParts, makeCar } from '../render/car';
import { engineProfileFromParts, revBlip, sfx as audio } from '../render/audio';

type Obj = Phaser.GameObjects.GameObject;
type XY = { x: number; y: number };

const TOAST_Y = 150;
// Inventory band: passives from x 244 then consumables, squeezed (cards overlap, Balatro-style) when slots grow.
let INV_PITCH = 50;
let INV_NP = 5;
const INV_GAP = 14;
const PASSIVE_X = (i: number) => Math.round(244 + i * INV_PITCH);
const CONS_X = (j: number) => Math.round(244 + (INV_NP + j) * INV_PITCH + INV_GAP);
function layoutInventory(np: number, nc: number) {
  INV_NP = np;
  INV_PITCH = Math.min(50, (314 - INV_GAP) / Math.max(1, np + nc - 1));
}
const INV_Y = 86;
// Offers: 4 = the classic 358,428 | 508,578; more (Extra Shelf, Back Room deal) squeeze into x 326..628.
function offerX(n: number): number[] {
  if (n <= 4) return [358, 428, 508, 578].slice(0, Math.max(n, 4));
  const pitch = (300 - 64) / (n - 1);
  return Array.from({ length: n }, (_, i) => Math.round(358 + i * pitch));
}
const OFFER_Y = 188;
const PACK_X = [254, 334];
const GARAGE_X = 414;
const STAT_X = 460; // stats panel left edge
const PACK_Y = 298;
const STAT_KEYS: StatKey[] = ['power', 'grip', 'weight', 'gearing', 'drag', 'shiftWindow'];
const TILE_H = 52;
const tileXY = (i: number): XY => ({ x: 10 + (i % 4) * 48 + 22, y: 136 + Math.floor(i / 4) * 54 + TILE_H / 2 });
const SETS_Y = 298; // set-progress rows under the part tiles

function barFrac(k: StatKey, v: number): number {
  const f: Record<string, number> = {
    power: v / 1000,
    grip: v / 2,
    weight: (1700 - v) / 1000,
    gearing: v / 1.6,
    drag: (1.6 - v) / 1.1,
    shiftWindow: v / 2,
  };
  return Phaser.Math.Clamp(f[k] ?? 0.5, 0.04, 1);
}

export class ShopScene extends Phaser.Scene {
  private tip!: Tooltip;
  private unsub: (() => void) | null = null;
  private sig: Record<string, string> = {};
  private bgTile!: Phaser.GameObjects.TileSprite;

  // top bar
  private cashText!: Phaser.GameObjects.Text;
  private shownCash = 0;
  private topObjs: Obj[] = [];
  // garage
  private car: Phaser.GameObjects.Container | null = null;
  private tileObjs: Obj[] = [];
  private tiles = new Map<SlotId, Phaser.GameObjects.Container>();
  // inventory
  private invObjs: Obj[] = [];
  private passiveCards: Card[] = [];
  private consCards: Card[] = [];
  private tuneCard: Card | null = null;
  // shop
  private offerObjs: Obj[] = [];
  private offerCards: (Card | null)[] = [];
  private offerSig: string[] = [];
  private packObjs: Obj[] = [];
  private packConts: (Phaser.GameObjects.Container | null)[] = [];
  private garageObjs: Obj[] = [];
  private garageCont: Card | null = null;
  private ownedObjs: Obj[] = [];
  private leaveBtn!: Button;
  private rerollBtn!: Button;
  // stats
  private statVal: Partial<Record<StatKey, Phaser.GameObjects.Text>> = {};
  private statBars!: Phaser.GameObjects.Graphics;
  private nosText!: Phaser.GameObjects.Text;
  private lastStats: CarStats | null = null;
  // pack
  private overlay: PackOverlay | null = null;
  private packFrom: XY | null = null;
  private picking: number | null = null;
  private dragging = false;
  private leaving = false;
  // part installs: the car rebuild waits for the flying icon to land, then pops with the sound
  private deferCarPop = false;
  private statDelay = 0;
  // brand sets / paragon
  private setObjs: Obj[] = [];
  private lastLevels: Record<string, number> | null = null;
  private lastParagon: string | null = null;
  private prevParts: Record<SlotId, import('../core/types').InstalledPart> | null = null;
  private transform: ParagonTransform | null = null;
  private transformPending: string | null = null;

  constructor() {
    super('Shop');
  }

  create() {
    // Scenes are reused: reset every field.
    this.sig = {};
    this.topObjs = [];
    this.car = null;
    this.tileObjs = [];
    this.tiles = new Map();
    this.invObjs = [];
    this.passiveCards = [];
    this.consCards = [];
    this.tuneCard = null;
    this.offerObjs = [];
    this.offerCards = [];
    this.offerSig = [];
    this.packObjs = [];
    this.packConts = [];
    this.garageObjs = [];
    this.garageCont = null;
    this.ownedObjs = [];
    this.statVal = {};
    this.lastStats = null;
    this.overlay = null;
    this.packFrom = null;
    this.picking = null;
    this.dragging = false;
    this.leaving = false;
    this.deferCarPop = false;
    this.statDelay = 0;
    this.setObjs = [];
    this.lastLevels = null;
    this.lastParagon = null;
    this.prevParts = null;
    this.transform = null;
    this.transformPending = null;

    ensureTextures(this);
    if (game.state.phase !== 'shop' || !game.state.shop) {
      goToPhase(this, 0);
      return;
    }
    this.cameras.main.fadeIn(180, 11, 10, 20);
    this.input.dragDistanceThreshold = 4;

    this.buildStatic();
    this.tip = new Tooltip(this);
    this.shownCash = game.state.cash;
    this.refresh();

    this.unsub = game.subscribe(() => this.refresh());
    this.showEntryLines();
    this.events.once('shutdown', () => {
      this.unsub?.();
      this.unsub = null;
      closeContextMenu(this);
    });

    const kb = this.input.keyboard;
    kb?.on('keydown-R', () => !this.overlay && !this.transform && this.doReroll());
    kb?.on('keydown-ENTER', () => !this.overlay && !this.transform && this.leave());
    kb?.on('keydown-ESC', () => closeContextMenu(this));
    kb?.on('keydown-P', () => this.openGarage());
  }

  update(_t: number, dt: number) {
    if (this.bgTile) this.bgTile.tilePositionX -= dt * 0.006;
    if (this.bgTile) this.bgTile.tilePositionY -= dt * 0.003;
  }

  // ------------------------------------------------------------------------------------------
  // static frame

  private buildStatic() {
    if (!this.textures.exists('shop_bg')) {
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(PAL.bg, 1).fillRect(0, 0, 32, 32);
      g.fillStyle(0x15122a, 1);
      for (let i = 0; i < 32; i++) {
        g.fillRect(i, (i + 0) % 32, 1, 1).fillRect(i, (i + 1) % 32, 1, 1).fillRect(i, (i + 16) % 32, 1, 1).fillRect(i, (i + 17) % 32, 1, 1);
      }
      g.generateTexture('shop_bg', 32, 32);
      g.destroy();
    }
    this.bgTile = this.add.tileSprite(0, 0, GAME_W, 360, 'shop_bg').setOrigin(0, 0);

    panel(this, -2, -2, 644, 32, PAL.panel, PAL.panelEdge);
    panel(this, 6, 34, 200, 84, 0x15122a);
    panel(this, 6, 122, 200, 232);
    panel(this, 214, 34, 420, 84);
    panel(this, 214, 122, 420, 118, 0x231d3d);
    panel(this, 214, 244, 240, 110, 0x231d3d);
    panel(this, STAT_X, 244, 174, 110);

    // garage
    txt(this, 12, 39, 'GARAGE', 8, PAL.inkDim);
    button(this, 160, 37, 42, 13, 'PAINT', () => this.openGarage(), PAL.orange);
    const road = this.add.graphics();
    road.fillStyle(PAL.asphalt, 1).fillRect(8, 104, 196, 12);
    road.fillStyle(PAL.asphaltLight, 1).fillRect(8, 104, 196, 2);
    for (let x = 12; x < 200; x += 16) road.fillStyle(PAL.stripe, 0.4).fillRect(x, 110, 8, 1);

    // parts
    txt(this, 12, 127, 'PARTS', 8, PAL.ink);

    // inventory: tuning label (passive / item labels move with the slot count)
    txt(this, 588, 38, 'TUNE', 8, PAL.yellow);

    // shop buttons
    this.leaveBtn = button(this, 222, 128, 92, 48, 'TO THE\nSTRIP >', () => this.leave(), PAL.red);
    this.rerollBtn = button(this, 222, 184, 92, 48, 'REROLL\n$3', () => this.doReroll(), PAL.green);

    // stats panel
    txt(this, STAT_X + 8, 249, 'STATS', 8, PAL.ink);
    this.nosText = txt(this, 626, 249, '', 8, PAL.blue, [1, 0]);
    this.statBars = this.add.graphics();
    STAT_KEYS.forEach((k, i) => {
      const y = 263 + i * 15;
      this.add.image(STAT_X + 8, y, `stat_${k}`).setOrigin(0, 0);
      txt(this, STAT_X + 20, y, (k === 'shiftWindow' ? 'SHIFT' : STAT_LABEL[k]).slice(0, 7), 8, PAL.inkDim);
      this.statVal[k] = txt(this, STAT_X + 128, y, '', 8, PAL.ink, [1, 0]);
    });
    const statZone = this.add.zone(STAT_X, 244, 174, 110).setOrigin(0, 0).setInteractive();
    statZone.on('pointerover', () =>
      this.tip.show({ x: STAT_X, y: 244, w: 174, h: 110 }, 'Car stats', PAL.teal, [
        'Final stats for the next race: parts, tuning and passives (left to right), plus the boss modifier.',
        { t: 'Consumables are chosen at staging.', c: PAL.inkDim },
        { t: 'Lower WEIGHT and DRAG are better.', c: PAL.inkDim },
      ], statZone),
    );
    statZone.on('pointerout', () => this.tip.hide(statZone));

    // top bar static
    this.cashText = shadowTxt(this, 10, 15, '', 24, PAL.cash, [0, 0.5]);
  }

  // ------------------------------------------------------------------------------------------
  // refresh: rebuild only the sections whose state slice changed

  private changed(key: string, value: unknown): boolean {
    const s = JSON.stringify(value);
    if (this.sig[key] === s) return false;
    this.sig[key] = s;
    return true;
  }

  private refresh() {
    const s = game.state;
    if (s.phase !== 'shop' || !s.shop || this.leaving) return;
    const shop = s.shop;
    this.tip?.hide();

    // cash
    if (s.cash !== this.shownCash) {
      const from = this.shownCash;
      this.shownCash = s.cash;
      tickNumber(this, this.cashText, from, s.cash, (n) => `$${n}`, 400);
      if (s.cash > from) sfx('cash');
      floatText(this, 60, 34, `${s.cash > from ? '+' : '-'}$${Math.abs(s.cash - from)}`, s.cash > from ? PAL.green : PAL.red);
    } else this.cashText.setText(`$${s.cash}`);

    if (this.changed('top', [s.round, s.race, s.seed, s.heat, s.tags])) this.buildTop();
    if (this.changed('owned', s.garage)) this.buildOwnedGarage();
    if (this.changed('garage', [shop.garageOffer, s.cash])) this.buildGarageOffer();
    this.watchSets();
    if (this.changed('car', s.parts)) this.buildCar(this.sig.carInit === undefined);
    this.sig.carInit = '1';
    if (this.changed('tiles', [s.parts, s.tuningCards])) this.buildTiles();
    if (this.changed('sets', s.parts)) this.buildSets();
    if (this.changed('inv', [s.passives, s.passiveEditions, s.passiveSlots, s.consumableSlots, s.consumables, s.tuningCards, !!shop.openPack])) this.buildInventory();
    if (this.changed('offers', [shop.items, s.cash])) this.buildOffers();
    if (this.changed('packs', [shop.packs, s.cash])) this.buildPacks();
    const free = (shop.freeRerolls ?? 0) > 0;
    this.rerollBtn.setLabel(free ? `REROLL\nFREE x${shop.freeRerolls}` : `REROLL\n$${shop.rerollCost}`);
    this.rerollBtn.setEnabled(free || s.cash >= shop.rerollCost);
    this.updateStats();
    this.syncOverlay();
    this.maybeTransform();
  }

  // ------------------------------------------------------------------------------------------
  // top bar

  private buildTop() {
    for (const o of this.topObjs) o.destroy();
    this.topObjs = [];
    const s = game.state;
    const boss = s.race === 3;
    const raceLbl = boss ? 'BOSS RACE' : `RACE ${s.race + 1}/4`;
    this.topObjs.push(txt(this, 128, 6, `${roundLabel(s.round)} - ${raceLbl}`, 8, boss ? PAL.red : s.round > 4 ? PAL.teal : PAL.ink));
    const seedT = txt(this, 128, 18, `SEED ${s.seed}`, 8, PAL.inkDim);
    this.topObjs.push(seedT);
    let tagX = seedT.x + seedT.width + 8;
    if (s.heat > 0) {
      const hb = heatBadge(this, tagX, 22, s.heat);
      this.topObjs.push(hb);
      const w = hb.getData('w') as number;
      const hz = this.add.zone(tagX, 16, w, 12).setOrigin(0, 0).setInteractive();
      hz.on('pointerover', () => {
        const lines = safe(() => game.heatLevels(), []).filter((h) => h.level > 0 && h.level <= s.heat).map((h) => ({ t: `${h.level} ${h.desc}`, c: PAL.ink }));
        this.tip.show({ x: tagX, y: 16, w, h: 12 }, `Heat ${s.heat}`, PAL.orange, lines, hz);
      });
      hz.on('pointerout', () => this.tip.hide(hz));
      this.topObjs.push(hz);
      tagX += w + 8;
    }
    this.tagMaxX = 0;
    this.tagStartX = tagX;

    let opp;
    try {
      opp = game.currentOpponent();
    } catch {
      this.buildTags(632);
      return;
    }
    const name = opp.name.toUpperCase().slice(0, 24);
    const nameT = txt(this, 632, 6, name, 8, PAL.ink, [1, 0]);
    const nextT = txt(this, nameT.x - nameT.width - 6, 6, 'NEXT:', 8, PAL.inkDim, [1, 0]);
    const et = txt(this, 632, 18, `TARGET ${opp.targetEt.toFixed(3)}`, 8, PAL.yellow, [1, 0]);
    this.topObjs.push(nameT, nextT, et);
    let left = et.x - et.width;
    const mod = game.bossModifier(opp.bossModifier);
    if (boss || mod) {
      if (mod) {
        const mt = txt(this, left - 8, 18, mod.name.toUpperCase(), 8, PAL.orange, [1, 0]);
        this.topObjs.push(mt);
        left = mt.x - mt.width;
      }
      const g = this.add.graphics();
      g.fillStyle(PAL.red, 1).fillRect(left - 46, 16, 38, 12);
      g.fillStyle(0xffffff, 0.3).fillRect(left - 46, 16, 38, 1);
      const bt = txt(this, left - 27, 22, 'BOSS', 8, PAL.ink, [0.5, 0.5]);
      this.topObjs.push(g, bt);
      this.tweens.add({ targets: bt, alpha: 0.4, yoyo: true, repeat: -1, duration: 500 });
      left -= 46;
    }
    this.buildTags(left - 6);
    const zone = this.add.zone(left, 2, 634 - left, 26).setOrigin(0, 0).setInteractive();
    this.topObjs.push(zone);
    zone.on('pointerover', () => {
      const lines: TipLine[] = [
        { t: `TARGET ET ${opp!.targetEt.toFixed(3)}S`, c: PAL.yellow },
        { t: 'Beat it or the run ends.', c: PAL.inkDim },
      ];
      if (mod) lines.push({ t: `${mod.name.toUpperCase()}: ${mod.desc}`, c: PAL.orange });
      if (opp!.taunt) lines.push({ t: `"${opp!.taunt}"`, c: PAL.ink });
      this.tip.show({ x: left, y: 2, w: 634 - left, h: 26 }, opp!.name, boss ? PAL.red : PAL.teal, lines, zone);
    });
    zone.on('pointerout', () => this.tip.hide(zone));
  }

  /** Balatro-style lines for cash gained on entering the shop (interest, Tune-Up, passives), once per shop. */
  private showEntryLines() {
    const s = game.state;
    const lines = s.shop?.entryLines ?? [];
    const notes = safe(() => game.takeRunNotes(), [] as string[]);
    notes.forEach((n, i) => this.time.delayedCall(300 + i * 500, () => floatText(this, 320, 150, n.toUpperCase().slice(0, 36), PAL.teal, 8)));
    const key = `${s.seed}:${s.round}:${s.race}:${s.history.length}`;
    if (!lines.length || ShopScene.entryShown === key) return;
    ShopScene.entryShown = key;
    const W = 240;
    const H = 26 + lines.length * 14;
    const c = this.add.container(320, 196).setDepth(1200);
    const g = this.add.graphics();
    drawPanel(g, -W / 2, -H / 2, W, H, PAL.bgDeep, PAL.cash);
    c.add([g, txt(this, 0, -H / 2 + 7, 'ON THE WAY IN', 8, PAL.cash, [0.5, 0])]);
    lines.forEach((ln, i) => {
      const y = -H / 2 + 22 + i * 14;
      const l = txt(this, -W / 2 + 10, y, ln.label.toUpperCase().slice(0, 22), 8, PAL.ink).setAlpha(0);
      const a = txt(this, W / 2 - 10, y, `+$${ln.amount}`, 8, PAL.cash, [1, 0]).setAlpha(0);
      c.add([l, a]);
      this.time.delayedCall(350 + i * 260, () => {
        l.setAlpha(1);
        a.setAlpha(1);
        pop(this, a, 1.5, 200);
        sfx('cash');
      });
    });
    c.setScale(0.5).setAlpha(0);
    this.tweens.add({ targets: c, scale: 1, alpha: 1, duration: 200, ease: 'Back.easeOut' });
    this.tweens.add({ targets: c, alpha: 0, y: 186, delay: 1400 + lines.length * 260, duration: 300, onComplete: () => c.destroy() });
  }

  private static entryShown = '';
  private tagStartX = 232;
  private tagMaxX = 0;

  /** Held tags: a row of 14px chips in the top bar (second line), tooltips on hover. */
  private buildTags(maxX: number) {
    const s = game.state;
    const tags = s.tags ?? [];
    if (!tags.length) return;
    const x0 = this.tagStartX;
    const room = Math.max(0, Math.floor((maxX - x0) / 16));
    const shown = tags.length > room ? tags.slice(0, Math.max(0, room - 1)) : tags;
    shown.forEach((id, i) => {
      const x = x0 + i * 16;
      const g = this.add.graphics();
      let rar: 'common' | 'uncommon' | 'rare' = 'common';
      try {
        rar = game.tag(id).rarity;
      } catch {
        /* unknown tag */
      }
      const col = rar === 'rare' ? PAL.pink : rar === 'uncommon' ? PAL.teal : PAL.green;
      g.fillStyle(PAL.bgDeep, 1).fillRect(x + 1, 16, 14, 14);
      g.fillStyle(col, 1).fillRect(x, 15, 14, 14);
      g.fillStyle(PAL.bgDeep, 1).fillRect(x + 1, 16, 12, 12);
      const img = this.add.image(x + 7, 22, tagIconKey(this, id));
      const z = this.add.zone(x, 15, 14, 14).setOrigin(0, 0).setInteractive();
      z.on('pointerover', () => {
        sfx('hover');
        pop(this, img, 1.4, 160);
        const t = safe(() => tagTip(id, [{ t: 'HELD: TRIGGERS ON ITS OWN', c: PAL.inkDim }]), null);
        if (t) this.tip.show({ x, y: 15, w: 14, h: 14 }, t.title, t.color, t.lines, z);
      });
      z.on('pointerout', () => this.tip.hide(z));
      this.topObjs.push(g, img, z);
    });
    if (shown.length < tags.length) this.topObjs.push(txt(this, x0 + shown.length * 16, 18, `+${tags.length - shown.length}`, 8, PAL.inkDim));
  }

  /** Owned garage upgrades: small icons along the GARAGE panel's header. */
  private buildOwnedGarage() {
    for (const o of this.ownedObjs) o.destroy();
    this.ownedObjs = [];
    const owned = game.state.garage ?? [];
    const pitch = owned.length > 7 ? Math.floor(96 / owned.length) : 14;
    owned.forEach((id, i) => {
      const x = 62 + i * pitch;
      const g = this.add.graphics();
      let tier = 1;
      try {
        tier = game.garageUpgrade(id).tier;
      } catch {
        /* unknown */
      }
      g.fillStyle(tier === 2 ? PAL.purple : PAL.blue, 1).fillRect(x, 37, 13, 13);
      g.fillStyle(PAL.bgDeep, 1).fillRect(x + 1, 38, 11, 11);
      const img = this.add.image(x + 6.5, 43.5, garageIconKey(this, id)).setScale(0.75);
      const z = this.add.zone(x, 37, 13, 13).setOrigin(0, 0).setInteractive();
      z.on('pointerover', () => {
        sfx('hover');
        const t = safe(() => garageTip(id), null);
        if (t) this.tip.show({ x, y: 37, w: 13, h: 13 }, t.title, t.color, t.lines, z);
      });
      z.on('pointerout', () => this.tip.hide(z));
      this.ownedObjs.push(g, img, z);
    });
  }

  /** The round's garage upgrade (voucher): its own slot right of the packs. */
  private buildGarageOffer() {
    for (const o of this.garageObjs) o.destroy();
    this.garageCont?.destroy();
    this.garageObjs = [];
    this.garageCont = null;
    const s = game.state;
    const off = s.shop?.garageOffer ?? null;
    const x = GARAGE_X;
    const y = PACK_Y + 2;
    if (!off || off.sold) {
      const g = this.add.graphics();
      g.fillStyle(PAL.bgDeep, 0.45).fillRect(x - 32, y - 42, 64, 84);
      g.fillStyle(PAL.panelEdge, 1);
      for (let k = 0; k < 64; k += 4) g.fillRect(x - 32 + k, y - 42, 2, 1).fillRect(x - 32 + k, y + 41, 2, 1);
      for (let k = 0; k < 84; k += 4) g.fillRect(x - 32, y - 42 + k, 1, 2).fillRect(x + 31, y - 42 + k, 1, 2);
      const t = txt(this, x, y, off ? 'OWNED' : 'GARAGE\nNEXT\nROUND', 8, PAL.panelEdge, [0.5, 0.5]).setAlign('center').setLineSpacing(4);
      this.garageObjs.push(g, t);
      return;
    }
    const c = garageCard(this, x, y, off.id, off.price).makeInteractive();
    c.setDim(off.price > s.cash);
    this.garageCont = c;
    if (this.sig.garageFlip !== off.id) {
      this.sig.garageFlip = off.id;
      c.flipIn(200, 300, () => sfx('flip'));
    }
    hoverTilt(this, c, c.w, c.h);
    c.on('pointerover', () => {
      sfx('hover');
      const t = safe(() => garageTip(off.id, ['', { t: `PRICE $${off.price}`, c: PAL.yellow }, { t: 'ONE OFFER PER ROUND', c: PAL.inkDim }]), null);
      if (t) this.tip.show(c.rect(), t.title, t.color, t.lines, c);
    });
    c.on('pointerout', () => this.tip.hide(c));
    c.on('pointerup', () => this.buyGarage(c));
  }

  private buyGarage(c: Card) {
    const off = game.state.shop?.garageOffer;
    if (!off) return;
    const from = { x: c.x, y: c.y };
    const r = game.buyGarage();
    if (!r.ok) return this.fail(r.reason, c);
    sfx('buy');
    audio.unlock?.();
    this.cameras.main.shake(120, 0.004);
    this.cameras.main.flash(90, 247, 210, 62);
    const n = (game.state.garage ?? []).indexOf(off.id);
    const to = { x: 62 + Math.max(0, n) * 14 + 6, y: 43 };
    this.fly(garageIconKey(this, off.id), from, to, () => {
      burst(this, to.x, to.y, [PAL.yellow, PAL.blue, PAL.ink], 20, 90, 60);
      floatText(this, 106, 60, game.garageUpgrade(off.id).name.toUpperCase().slice(0, 22), PAL.yellow);
      this.popCar();
    });
  }

  // ------------------------------------------------------------------------------------------
  // garage car

  private buildCar(first: boolean) {
    this.car?.destroy();
    this.car = null;
    const parts = this.transformPending && this.prevParts ? this.prevParts : game.state.parts;
    if (!this.transformPending) this.prevParts = JSON.parse(JSON.stringify(game.state.parts));
    try {
      // a pending transform keeps the old car on the road until the light show swaps it
      const car = makeCar(this, 106, 108, carVisualFromParts(parts, runLook()), 2);
      this.car = car;
      this.tweens.add({ targets: car, y: 107, duration: 70, yoyo: true, repeat: -1, repeatDelay: 40 });
      if (!first && !this.deferCarPop) this.popCar();
      this.deferCarPop = false;
    } catch (e) {
      // car renderer unavailable: simple placeholder silhouette
      const g = this.add.graphics();
      g.fillStyle(PAL.red, 1).fillRect(56, 80, 100, 18).fillRect(76, 68, 50, 14);
      g.fillStyle(PAL.bgDeep, 1).fillCircle(76, 100, 8).fillCircle(136, 100, 8);
      this.car = this.add.container(0, 0, [g]);
    }
  }

  private popCar() {
    const car = this.car as (Phaser.GameObjects.Container & { flameBurst?: (ms?: number) => unknown }) | null;
    if (!car || !car.active) return;
    pop(this, car, 1.15, 300);
    car.flameBurst?.(260);
    burst(this, 106, 90, [PAL.ink, PAL.orange, PAL.yellow], 16, 80, 20);
  }

  /** A part just landed in its slot: install sound + tier stinger, then the car revs with its new parts. */
  private installFx(slot: SlotId) {
    const ip = game.state.parts[slot];
    let tier: import('../core/types').Tier = 'stock';
    try {
      tier = game.part(ip.partId).tier;
    } catch {
      /* unknown part */
    }
    audio.install(slot, tier);
    this.popCar();
    // let the install sound (and the pro stinger) finish before the engine revs
    const revAt = tier === 'pro' ? 950 : tier === 'sport' ? 800 : tier === 'street' ? 650 : 300;
    if (this.transformPending || this.transform) return; // the paragon moment brings its own engine
    this.time.delayedCall(revAt, () => revBlip(engineProfileFromParts(game.state.parts)));
  }

  // ------------------------------------------------------------------------------------------
  // part tiles

  private buildTiles() {
    for (const o of this.tileObjs) o.destroy();
    this.tileObjs = [];
    this.tiles.clear();
    const s = game.state;
    let upgraded = 0;
    const para = safe(() => activeParagon(s.parts), null);
    SLOTS.forEach((slot, i) => {
      const ip = s.parts[slot];
      if (!ip) return;
      const def = game.part(ip.partId);
      if (def.tier !== 'stock') upgraded++;
      const { x, y } = tileXY(i);
      const H = TILE_H;
      const T = -H / 2;
      const c = this.add.container(x, y);
      const g = this.add.graphics();
      const stock = def.tier === 'stock';
      const col = stock ? PAL.panelEdge : TIER_COLOR[def.tier] ?? PAL.panelEdge;
      const b = def.brand ? brandInfo(def.brand) : null;
      g.fillStyle(PAL.bgDeep, 1).fillRect(-22 + 1, T + 2, 44, H);
      g.fillStyle(para && b?.id === para ? PAL.yellow : col, 1).fillRect(-22, T, 44, H);
      g.fillStyle(stock ? PAL.panel : 0x15122a, 1).fillRect(-20, T + 2, 40, H - 4);
      const objs: Obj[] = [g];
      if (b) {
        // brand strip: logo + short name in brand colours
        g.fillStyle(b.color, 1).fillRect(-20, T + 2, 40, 10);
        g.fillStyle(0xffffff, 0.3).fillRect(-20, T + 2, 40, 1);
        g.fillStyle(col, 0.18).fillRect(-20, T + 12, 40, 20);
        objs.push(...brandLogo(this, -14, T + 7, b.id, 8));
        objs.push(txt(this, 3, T + 7, b.name.toUpperCase().slice(0, 3), 8, b.ink, [0.5, 0.5]));
      }
      const icon = this.add.image(0, T + (b ? 23 : 18), slotIcon(slot)).setScale(2).setAlpha(stock ? 0.55 : 1);
      const lbl = txt(this, 0, T + 36, SLOT_SHORT[slot], 8, stock ? PAL.inkDim : PAL.ink, [0.5, 0]);
      // level pips
      if (!stock) {
        for (let p = 0; p < 3; p++) {
          const px = -13 + p * 10;
          g.fillStyle(PAL.bgDeep, 1).fillRect(px, T + 45, 8, 4);
          g.fillStyle(p < ip.level ? PAL.yellow : PAL.panelLight, 1).fillRect(px + 1, T + 46, 6, 2);
        }
      }
      c.add([...objs, icon, lbl]);
      c.setSize(44, H);
      hitBox(c, -22, T, 44, H);
      if (c.input) c.input.cursor = 'pointer';
      c.on('pointerover', () => {
        const t = installedPartTip(slot);
        this.tip.show({ x: x - 22, y: y + T, w: 44, h: H }, t.title, t.color, t.lines, c);
        this.tweens.add({ targets: c, scale: 1.08, duration: 100 });
        sfx('hover');
      });
      c.on('pointerout', () => {
        this.tip.hide(c);
        this.tweens.add({ targets: c, scale: 1, duration: 100 });
      });
      c.on('pointerup', () => this.partMenu(slot, x, y));
      // tuning available: pulse the tunable tiles
      if (s.tuningCards > 0 && !stock && ip.level < 3) {
        const glow = this.add.rectangle(x, y, 46, H + 2).setStrokeStyle(1, PAL.yellow).setFillStyle();
        this.tweens.add({ targets: glow, alpha: 0.2, yoyo: true, repeat: -1, duration: 450 });
        this.tileObjs.push(glow);
      }
      this.tiles.set(slot, c);
      this.tileObjs.push(c);
    });
    const hdr = txt(this, 200, 127, `${upgraded}/12 UPGRADED`, 8, PAL.inkDim, [1, 0]);
    this.tileObjs.push(hdr);
  }

  // ------------------------------------------------------------------------------------------
  // brand sets: up to 3 rows under the tiles: logo, name, 12 pips (4 / 8 gold steps, 12 = paragon car), count

  private buildSets() {
    for (const o of this.setObjs) o.destroy();
    this.setObjs = [];
    const s = game.state;
    const owned = ownedBrands(s.parts);
    const para = safe(() => activeParagon(s.parts), null);
    const y0 = SETS_Y;
    const g = this.add.graphics();
    this.setObjs.push(g);
    g.fillStyle(PAL.panelEdge, 1);
    for (let x = 10; x < 202; x += 4) g.fillRect(x, y0 - 3, 2, 1);
    if (!owned.length) {
      this.setObjs.push(
        txt(this, 106, y0 + 6, 'SETS: COLLECT A BRAND', 8, PAL.inkDim, [0.5, 0]),
        txt(this, 106, y0 + 20, '4 / 8 BONUS  12 PARAGON', 8, PAL.panelEdge, [0.5, 0]),
        txt(this, 106, y0 + 34, 'CLICK PART: SELL/TUNE', 8, PAL.panelEdge, [0.5, 0]),
      );
      return;
    }
    const rows = owned.slice(0, 3);
    rows.forEach((r, i) => {
      const b = brandInfo(r.id);
      if (!b) return;
      const y = y0 + 2 + i * 17;
      const full = r.n >= 12;
      const isPara = para === r.id;
      // row backing (brand tint), gold when transformed
      g.fillStyle(isPara ? PAL.yellow : b.color, isPara ? 0.3 : 0.14).fillRect(8, y - 1, 196, 15);
      this.setObjs.push(...brandLogo(this, 16, y + 6, r.id, 10));
      const label = b.name.toUpperCase().slice(0, 8);
      const nt = txt(this, 24, y + 2, label, 8, isPara ? PAL.yellow : b.color === PAL.bgDeep ? PAL.ink : b.color);
      nt.setShadow(1, 1, hex(PAL.bgDeep), 0, false, true);
      this.setObjs.push(nt);
      // 12 pips: 5px, step gaps after 4 and 8; steps 4/8 are tall gold-capped, 12 is a little car
      let px = 90;
      for (let k = 1; k <= 12; k++) {
        const on = k <= r.n;
        const step = k === 4 || k === 8;
        if (k === 12) {
          const cc = on ? PAL.yellow : PAL.panelLight;
          g.fillStyle(PAL.bgDeep, 1).fillRect(px - 1, y + 3, 11, 8);
          g.fillStyle(cc, 1).fillRect(px, y + 6, 9, 3).fillRect(px + 2, y + 4, 5, 2);
          g.fillStyle(PAL.bgDeep, 1).fillRect(px + 1, y + 9, 2, 2).fillRect(px + 6, y + 9, 2, 2);
          break;
        }
        const top = step ? y + 1 : y + 3;
        const hh = step ? 11 : 9;
        g.fillStyle(PAL.bgDeep, 1).fillRect(px, top, 5, hh);
        g.fillStyle(on ? (step ? PAL.yellow : b.color === PAL.bgDeep ? PAL.ink : b.color) : PAL.panelLight, 1).fillRect(px + 1, top + 1, 3, hh - 2);
        if (on) g.fillStyle(0xffffff, 0.35).fillRect(px + 1, top + 1, 3, 1);
        px += 6 + (step ? 1 : 0);
      }
      const ct = txt(this, 202, y + 2, `${r.n}/12`, 8, full ? PAL.yellow : r.n >= 8 ? PAL.ink : PAL.inkDim, [1, 0]);
      this.setObjs.push(ct);
      if (isPara) this.tweens.add({ targets: nt, alpha: 0.55, yoyo: true, repeat: -1, duration: 420 });
      const z = this.add.zone(8, y - 1, 196, 15).setOrigin(0, 0).setInteractive();
      z.on('pointerover', () => {
        sfx('hover');
        const t = safe(() => (full ? paragonTip(r.id) : brandTip(r.id)), null);
        if (t) this.tip.show({ x: 8, y: y - 1, w: 196, h: 15 }, t.title, t.color, t.lines, z);
      });
      z.on('pointerout', () => this.tip.hide(z));
      this.setObjs.push(z);
    });
    if (owned.length > rows.length) this.setObjs.push(txt(this, 202, y0 - 12, `+${owned.length - rows.length} MORE`, 8, PAL.inkDim, [1, 0]));
  }

  /** Set steps gained / lost and the paragon turning off: Balatro-style callouts. The transform itself is maybeTransform(). */
  private watchSets() {
    const s = game.state;
    const counts: Record<string, number> = {};
    for (const r of ownedBrands(s.parts)) counts[r.id] = setLevel(s.parts, r.id);
    const para = safe(() => activeParagon(s.parts), null);
    if (s.paragonJustUnlocked && !this.transform) this.transformPending = s.paragonJustUnlocked;
    const prev = this.lastLevels;
    const prevPara = this.lastParagon;
    this.lastLevels = counts;
    this.lastParagon = para;
    if (!prev) return;
    if (prevPara && prevPara !== para) {
      const pn = paragonOf(prevPara)?.name ?? `${brandInfo(prevPara)?.name ?? prevPara} paragon`;
      this.time.delayedCall(120, () => {
        toast(this, `${pn} LOST`, PAL.red, TOAST_Y);
        this.cameras.main.shake(160, 0.006);
        burst(this, 106, 90, [PAL.inkDim, PAL.panelEdge, PAL.red], 24, 110, 40);
      });
    }
    for (const id of new Set([...Object.keys(prev), ...Object.keys(counts)])) {
      const a = prev[id] ?? 0;
      const b = counts[id] ?? 0;
      if (a === b || b === 12 || (a === 12 && prevPara)) continue;
      const nm = (brandInfo(id)?.name ?? id).toUpperCase();
      if (b > a) {
        this.time.delayedCall(520, () => {
          floatText(this, 106, SETS_Y - 8, `${nm} SET ${b}!`, PAL.yellow, 8);
          sfx('pick');
        });
      } else this.time.delayedCall(120, () => floatText(this, 106, SETS_Y - 8, `${nm} SET ${a} LOST`, PAL.red, 8));
    }
  }

  /** The 12th part of a brand just installed: once the flying icon lands (and any pack overlay closed), transform. */
  private maybeTransform() {
    const id = this.transformPending;
    if (!id || this.transform || this.overlay || this.leaving) return;
    if (this.sig.transformWait === id) return;
    this.sig.transformWait = id;
    this.time.delayedCall(480, () => {
      if (!this.scene.isActive() || this.transform) return;
      this.closeTip();
      closeContextMenu(this);
      const oldCar = this.car;
      oldCar?.setVisible(false);
      this.transform = new ParagonTransform(this, id, this.prevParts ?? game.state.parts, game.state.parts, runLook(), () => {
        this.transform = null;
        this.transformPending = null;
        this.sig.transformWait = '';
        game.ackParagon();
        this.buildCar(true);
        this.prevParts = JSON.parse(JSON.stringify(game.state.parts));
        this.popCar();
        this.time.delayedCall(250, () => safe(() => revBlip(engineProfileFromParts(game.state.parts)), undefined));
      });
    });
  }

  private closeTip() {
    this.tip?.hide();
  }

  private partMenu(slot: SlotId, x: number, y: number) {
    const s = game.state;
    const def = game.part(s.parts[slot].partId);
    const lvl = s.parts[slot].level;
    if (def.tier === 'stock' && s.tuningCards === 0) {
      toast(this, 'Stock part: buy an upgrade in the shop', PAL.panelLight, TOAST_Y);
      return;
    }
    const sell = game.partSellValue(slot);
    contextMenu(this, x + 24, y - 20, [
      { label: def.tier === 'stock' ? 'STOCK' : `SELL +$${sell}`, color: PAL.orange, enabled: def.tier !== 'stock', onClick: () => this.sellPart(slot) },
      {
        label: lvl >= 3 ? 'MAX LEVEL' : `TUNE (${s.tuningCards})`,
        color: PAL.yellow,
        enabled: s.tuningCards > 0 && def.tier !== 'stock' && lvl < 3,
        onClick: () => this.tunePart(slot),
      },
    ]);
  }

  private sellPart(slot: SlotId) {
    const r = game.sellPart(slot);
    if (!r.ok) return this.fail(r.reason, this.tiles.get(slot));
    sfx('sell');
    const t = this.tiles.get(slot);
    if (t) {
      burst(this, t.x, t.y, [PAL.yellow, PAL.inkDim], 14, 70, 30);
      pop(this, t, 0.8, 250);
    }
  }

  private tunePart(slot: SlotId) {
    const r = game.applyTuning(slot);
    if (!r.ok) return this.fail(r.reason, this.tiles.get(slot));
    try {
      audio.install(slot, game.part(game.state.parts[slot].partId).tier);
    } catch {
      /* audio optional */
    }
    const t = this.tiles.get(slot);
    if (t) {
      burst(this, t.x, t.y, [PAL.yellow, PAL.orange, PAL.ink], 22, 100, 30);
      pop(this, t, 1.3, 300);
      floatText(this, t.x, t.y - 30, `LV ${game.state.parts[slot].level}`, PAL.yellow);
    }
  }

  // ------------------------------------------------------------------------------------------
  // passives / consumables / tuning

  private buildInventory() {
    for (const o of this.invObjs) o.destroy();
    for (const c of [...this.passiveCards, ...this.consCards]) c.destroy();
    this.tuneCard?.destroy();
    this.invObjs = [];
    this.passiveCards = [];
    this.consCards = [];
    this.tuneCard = null;
    const s = game.state;

    const np = Math.max(s.passiveSlots ?? 5, s.passives.length);
    const nc = Math.max(s.consumableSlots ?? 2, s.consumables.length);
    layoutInventory(np, nc);
    this.invObjs.push(txt(this, 222, 38, `PASSIVES ${s.passives.length}/${np}`, 8, s.passives.length >= np ? PAL.orange : PAL.ink));
    const itemsX = CONS_X(0) - 22;
    this.invObjs.push(txt(this, itemsX, 38, `ITEMS ${s.consumables.length}/${nc}`, 8, s.consumables.length >= nc ? PAL.orange : PAL.ink));
    // order hint between the labels, if there is room
    const lrRight = itemsX - 10;
    if (lrRight - 80 >= 326) {
      this.invObjs.push(txt(this, lrRight, 38, 'LEFT>RIGHT', 8, PAL.inkDim, [1, 0]));
      if (lrRight - 80 - 64 >= 326) {
        const ag = this.add.graphics();
        ag.fillStyle(PAL.inkDim, 1);
        for (let x = 326; x < lrRight - 90; x += 4) ag.fillRect(x, 41, 2, 2);
        ag.fillRect(lrRight - 90, 39, 2, 6).fillRect(lrRight - 88, 40, 2, 4).fillRect(lrRight - 86, 41, 2, 2);
        this.invObjs.push(ag);
      }
    }

    const slotOutline = (cx: number, label: string) => {
      const g = this.add.graphics();
      g.fillStyle(PAL.bgDeep, 0.5).fillRect(cx - 22, INV_Y - 30, 44, 60);
      g.fillStyle(PAL.panelEdge, 1);
      for (let k = 0; k < 44; k += 4) g.fillRect(cx - 22 + k, INV_Y - 30, 2, 1).fillRect(cx - 22 + k, INV_Y + 29, 2, 1);
      for (let k = 0; k < 60; k += 4) g.fillRect(cx - 22, INV_Y - 30 + k, 1, 2).fillRect(cx + 21, INV_Y - 30 + k, 1, 2);
      this.invObjs.push(g, txt(this, cx, INV_Y, label, 8, PAL.panelEdge, [0.5, 0.5]));
    };

    for (let i = 0; i < np; i++) {
      const id = s.passives[i];
      if (!id) {
        slotOutline(PASSIVE_X(i), String(i + 1));
        continue;
      }
      const c = passiveSlotCard(this, PASSIVE_X(i), INV_Y, id, i + 1, s.passiveEditions?.[i] ?? null).makeInteractive();
      this.passiveCards.push(c);
      this.wirePassive(c, i, id);
    }
    for (let j = 0; j < nc; j++) {
      const id = s.consumables[j];
      if (!id) {
        slotOutline(CONS_X(j), '-');
        continue;
      }
      const c = consumableSlotCard(this, CONS_X(j), INV_Y, id).makeInteractive();
      this.consCards.push(c);
      hoverTilt(this, c, c.w, c.h);
      c.on('pointerover', () => c.setDepth(30));
      c.on('pointerout', () => c.setDepth(0));
      c.on('pointerover', () => {
        const t = consumableTip(id, ['', { t: 'CLICK: DISCARD', c: PAL.inkDim }]);
        this.tip.show(c.rect(), t.title, t.color, t.lines, c);
        sfx('hover');
      });
      c.on('pointerout', () => this.tip.hide(c));
      c.on('pointerup', () =>
        contextMenu(this, c.x - 30, c.y + 32, [
          {
            label: 'DISCARD',
            color: PAL.red,
            onClick: () => {
              burst(this, c.x, c.y, [PAL.red, PAL.inkDim], 14, 70, 70);
              sfx('sell');
              game.discardConsumable(j);
            },
          },
        ]),
      );
    }
    // tuning cards
    if (s.tuningCards > 0) {
      const c = new Card(this, 608, INV_Y, { w: 40, h: 60, accent: PAL.yellow, icon: 'tuning', iconScale: 2, name: `x${s.tuningCards}` }).makeInteractive();
      this.tuneCard = c;
      hoverTilt(this, c, c.w, c.h);
      c.on('pointerover', () => {
        const t = tuningTip([{ t: `YOU HAVE ${s.tuningCards}. CLICK A GLOWING PART TILE.`, c: PAL.yellow }]);
        this.tip.show(c.rect(), t.title, t.color, t.lines, c);
      });
      c.on('pointerout', () => this.tip.hide(c));
    } else {
      const g = this.add.graphics();
      g.fillStyle(PAL.bgDeep, 0.5).fillRect(588, INV_Y - 30, 40, 60);
      this.invObjs.push(g, txt(this, 608, INV_Y, '0', 8, PAL.panelEdge, [0.5, 0.5]));
    }
  }

  private wirePassive(c: Card, i: number, id: string) {
    this.input.setDraggable(c);
    let baseX = c.x;
    let baseY = c.y;
    c.on('pointerover', () => {
      if (this.dragging) return;
      const sell = game.passiveSellValue(i);
      const n = Math.max(game.state.passiveSlots ?? 5, game.state.passives.length);
      const t = passiveTip(id, ['', { t: `SLOT ${i + 1} OF ${n} (LEFT RUNS FIRST)`, c: PAL.inkDim }, { t: `SELL VALUE $${sell}`, c: PAL.yellow }, { t: 'DRAG: REORDER  CLICK: SELL', c: PAL.inkDim }], { index: i });
      this.tip.show(c.rect(), t.title, t.color, t.lines, c);
      c.setDepth(30);
      this.tweens.add({ targets: c, scale: 1.08, y: baseY - 3, duration: 110, ease: 'Back.easeOut' });
      sfx('hover');
    });
    c.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.dragging) return;
      c.angle = Phaser.Math.Clamp((p.x - c.x) / 22, -1, 1) * 5;
    });
    c.on('pointerout', () => {
      this.tip.hide(c);
      if (!this.dragging) {
        c.setDepth(0);
        this.tweens.add({ targets: c, scale: 1, y: baseY, angle: 0, duration: 140 });
      }
    });
    c.on('dragstart', () => {
      this.dragging = true;
      this.tip.hide();
      closeContextMenu(this);
      this.tweens.killTweensOf(c);
      c.setDepth(40).setScale(1.12).setAngle(-4);
    });
    c.on('drag', (_p: Phaser.Input.Pointer, dx: number, dy: number) => {
      c.x = Phaser.Math.Clamp(Math.round(dx), 222, PASSIVE_X(Math.max(0, game.state.passives.length - 1)) + 22);
      c.y = Phaser.Math.Clamp(Math.round(dy), 60, 112);
      c.angle = Phaser.Math.Clamp((c.x - baseX) / 10, -8, 8);
    });
    c.on('dragend', () => {
      const n = game.state.passives.length;
      const to = Phaser.Math.Clamp(Math.round((c.x - 244) / INV_PITCH), 0, n - 1);
      this.time.delayedCall(0, () => (this.dragging = false));
      if (to !== i) {
        sfx('flip');
        // defer: the rebuild destroys this card, so don't do it inside its own input event
        this.time.delayedCall(0, () => {
          game.movePassive(i, to);
          const moved = this.passiveCards[to];
          if (moved) pop(this, moved, 1.2);
        });
      } else {
        this.tweens.add({ targets: c, x: baseX, y: baseY, scale: 1, angle: 0, duration: 160, ease: 'Back.easeOut' });
        c.setDepth(0);
      }
    });
    c.on('pointerup', () => {
      if (this.dragging) return;
      const sell = game.passiveSellValue(i);
      contextMenu(this, c.x - 34, c.y + 32, [
        {
          label: `SELL +$${sell}`,
          color: PAL.orange,
          onClick: () => {
            const r = game.sellPassive(i);
            if (!r.ok) return this.fail(r.reason);
            sfx('sell');
            burst(this, baseX, baseY, [PAL.yellow, PAL.ink], 16, 80, 70);
          },
        },
      ]);
    });
  }

  // ------------------------------------------------------------------------------------------
  // offers

  private buildOffers() {
    for (const o of this.offerObjs) o.destroy();
    for (const c of this.offerCards) c?.destroy();
    this.offerObjs = [];
    this.offerCards = [];
    const s = game.state;
    const items = s.shop!.items;
    const prevSig = this.offerSig;
    this.offerSig = [];
    let flips = 0;
    offerX(items.length).forEach((x, i) => {
      const it = items[i];
      const sig = it ? JSON.stringify(it) : '';
      this.offerSig.push(sig);
      if (!it || it.sold) {
        this.offerCards.push(null);
        const g = this.add.graphics();
        g.fillStyle(PAL.bgDeep, 0.45).fillRect(x - 32, OFFER_Y - 46, 64, 92);
        g.fillStyle(PAL.panelEdge, 1);
        for (let k = 0; k < 64; k += 4) g.fillRect(x - 32 + k, OFFER_Y - 46, 2, 1).fillRect(x - 32 + k, OFFER_Y + 45, 2, 1);
        for (let k = 0; k < 92; k += 4) g.fillRect(x - 32, OFFER_Y - 46 + k, 1, 2).fillRect(x + 31, OFFER_Y - 46 + k, 1, 2);
        this.offerObjs.push(g, txt(this, x, OFFER_Y, it ? 'SOLD' : '-', 8, PAL.panelEdge, [0.5, 0.5]));
        return;
      }
      const c = shopItemCard(this, x, OFFER_Y, it).makeInteractive();
      c.setDim(it.price > s.cash);
      if (it.kind === 'part' && it.deal) {
        // Back Room tag: 50% off sticker
        const g = this.add.graphics();
        g.fillStyle(PAL.bgDeep, 1).fillRect(-31, 25, 62, 12);
        g.fillStyle(PAL.green, 1).fillRect(-32, 24, 62, 12);
        const dt = txt(this, -1, 30, '50% OFF', 8, PAL.bgDeep, [0.5, 0.5]);
        c.add([g, dt]);
        this.tweens.add({ targets: dt, alpha: 0.4, yoyo: true, repeat: -1, duration: 400 });
      }
      c.on('pointerover', () => c.setDepth(30));
      c.on('pointerout', () => c.setDepth(0));
      this.offerCards.push(c);
      // flip in when this slot shows something new (reroll / first draw), not when only cash changed
      const prevNoSold = (prevSig[i] ?? '').replace('"sold":true', '"sold":false');
      if (prevNoSold !== sig) c.flipIn(flips++ * 90, 260, () => sfx('flip'));
      hoverTilt(this, c, c.w, c.h);
      c.on('pointerover', () => {
        const t = shopItemTip(it);
        this.tip.show(c.rect(), t.title, t.color, t.lines, c);
        sfx('hover');
        if (it.kind === 'part') {
          const tile = this.tiles.get(game.part(it.partId).slot);
          if (tile) this.tweens.add({ targets: tile, scale: 1.12, duration: 120, yoyo: true });
        }
      });
      c.on('pointerout', () => this.tip.hide(c));
      c.on('pointerup', () => this.buyOffer(i, c));
    });
  }

  private buyOffer(i: number, c: Card) {
    const it = game.state.shop!.items[i];
    if (!it) return;
    const from = { x: c.x, y: c.y };
    const isPart = it.kind === 'part';
    // parts: the car rebuild stays quiet until the icon lands; the install sound replaces the buy blip
    this.deferCarPop = isPart;
    this.statDelay = isPart ? 380 : 0;
    const r = game.buyItem(i);
    this.deferCarPop = false;
    this.statDelay = 0;
    if (!r.ok) return this.fail(r.reason, c);
    sfx(isPart ? 'click' : 'buy');
    this.cameras.main.shake(70, 0.003);
    const key = iconKeyFor(this, it);
    let to: XY;
    let target: Phaser.GameObjects.Container | null = null;
    if (it.kind === 'part') {
      const slot = game.part(it.partId).slot;
      to = tileXY(SLOTS.indexOf(slot));
      target = this.tiles.get(slot) ?? null;
    } else if (it.kind === 'passive') {
      const n = game.state.passives.length - 1;
      to = { x: PASSIVE_X(n), y: INV_Y };
      target = this.passiveCards[n] ?? null;
    } else {
      const n = game.state.consumables.length - 1;
      to = { x: CONS_X(n), y: INV_Y };
      target = this.consCards[n] ?? null;
    }
    this.fly(key, from, to, () => {
      // the tile may have been rebuilt while the icon flew: pop whatever is in the slot now
      const t = it.kind === 'part' ? this.tiles.get(game.part(it.partId).slot) ?? target : target;
      if (t && t.active) pop(this, t, 1.3, 260);
      burst(this, to.x, to.y, [PAL.yellow, PAL.ink], 14, 70, 60);
      if (it.kind === 'part') this.installFx(game.part(it.partId).slot);
    });
  }

  private fly(key: string, from: XY, to: XY, done: () => void) {
    const img = this.add.image(from.x, from.y, key).setScale(3).setDepth(1100);
    this.tweens.add({
      targets: img,
      x: to.x,
      y: to.y,
      scale: 2,
      duration: 380,
      ease: 'Cubic.easeInOut',
      onComplete: () => {
        img.destroy();
        done();
      },
    });
    this.tweens.add({ targets: img, angle: 360, duration: 380 });
  }

  // ------------------------------------------------------------------------------------------
  // packs

  private buildPacks() {
    for (const o of this.packObjs) o.destroy();
    this.packObjs = [];
    this.packConts = [];
    const s = game.state;
    s.shop!.packs.forEach((p, i) => {
      const x = PACK_X[i];
      if (!x) return;
      const name = p.kind === 'parts' ? 'PARTS' : 'POWER';
      if (p.sold) {
        this.packConts.push(null);
        const g = this.add.graphics();
        g.fillStyle(PAL.bgDeep, 0.45).fillRect(x - PACK_W / 2, PACK_Y - 38, PACK_W, 76);
        this.packObjs.push(g, txt(this, x, PACK_Y, 'OPENED', 8, PAL.panelEdge, [0.5, 0.5]));
        return;
      }
      const img = this.add.image(0, 0, p.kind === 'parts' ? 'pack_parts' : 'pack_power');
      const label = txt(this, 0, 46, name, 8, p.kind === 'parts' ? PAL.orange : PAL.pink, [0.5, 0.5]);
      const free = p.price === 0;
      const pl = free ? 'FREE' : `$${p.price}`;
      const cw = pl.length * 8 + 8;
      const afford = p.price <= s.cash;
      const chipG = this.add.graphics();
      const chipCol = free ? PAL.green : afford ? PAL.yellow : PAL.red;
      chipG.fillStyle(PAL.bgDeep, 1).fillRect(-cw / 2 + 1, -42 - 6 + 2, cw, 12);
      chipG.fillStyle(chipCol, 1).fillRect(-cw / 2, -42 - 6, cw, 12);
      const chipT = txt(this, 0, -42, pl, 8, afford ? PAL.bgDeep : PAL.ink, [0.5, 0.5]);
      const c = this.add.container(x, PACK_Y, [img, label, chipG, chipT]);
      if (!afford) img.setAlpha(0.5);
      c.setSize(PACK_W, 76);
      hitBox(c, -PACK_W / 2, -38, PACK_W, 76);
      if (c.input) c.input.cursor = 'pointer';
      hoverTilt(this, c, PACK_W, 76, 1.1);
      if (free) this.tweens.add({ targets: chipT, alpha: 0.3, yoyo: true, repeat: -1, duration: 400 });
      c.on('pointerover', () => {
        sfx('hover');
        const lines =
          p.kind === 'parts'
            ? ['3 parts from different slots. Pick 1: it installs right away (old part sells for 50%).']
            : ['3 cards: passives, consumables or a rare Tuning Card. Pick 1.'];
        this.tip.show({ x: x - PACK_W / 2, y: PACK_Y - 38, w: PACK_W, h: 76 }, `${name} PACK`, p.kind === 'parts' ? PAL.orange : PAL.pink, [
          ...lines,
          { t: 'You may skip (no refund).', c: PAL.inkDim },
          '',
          { t: free ? 'FREE THIS TIME!' : `PRICE $${p.price}`, c: free ? PAL.green : PAL.yellow },
        ], c);
      });
      c.on('pointerout', () => this.tip.hide(c));
      c.on('pointerup', () => this.openPack(i, c));
      this.packConts.push(c);
      this.packObjs.push(c);
    });
  }

  private openPack(i: number, c: Phaser.GameObjects.Container) {
    this.packFrom = { x: c.x, y: c.y };
    const r = game.buyPack(i);
    if (!r.ok) {
      this.packFrom = null;
      return this.fail(r.reason, c);
    }
    sfx('buy');
  }

  private syncOverlay() {
    const open = game.state.shop?.openPack ?? null;
    if (open && !this.overlay) {
      closeContextMenu(this);
      const from = this.packFrom;
      this.packFrom = null;
      this.overlay = new PackOverlay(
        this,
        this.tip,
        open.kind,
        open.cards,
        from,
        open.picksLeft ?? 1,
        (i) => this.pickCard(i),
        () => {
          sfx('click');
          game.skipPack();
        },
      );
      this.leaveBtn.setEnabled(false);
      this.overlaySig = JSON.stringify(open.cards);
    } else if (open && this.overlay && this.picking !== null && JSON.stringify(open.cards) !== this.overlaySig) {
      // Pack Rat: a pick with picks left; the overlay stays open
      this.overlaySig = JSON.stringify(open.cards);
      const picked = this.picking;
      this.picking = null;
      const card = this.lastPickCard;
      this.overlay.consume(picked, this.pickTarget(), open.cards, open.picksLeft ?? 1, () => {
        const t = card?.kind === 'part' ? this.tiles.get(game.part(card.partId).slot) ?? this.lastPickTarget : this.lastPickTarget;
        if (t && t.active) pop(this, t, 1.35, 280);
        if (card?.kind === 'part') this.installFx(game.part(card.partId).slot);
      });
    } else if (!open && this.overlay) {
      const ov = this.overlay;
      this.overlay = null;
      this.leaveBtn.setEnabled(true);
      const picked = this.picking;
      this.picking = null;
      const card = picked !== null ? this.lastPickCard : null;
      ov.close(picked, picked !== null ? this.pickTarget() : null, () => {
        const t = card?.kind === 'part' ? this.tiles.get(game.part(card.partId).slot) ?? this.lastPickTarget : this.lastPickTarget;
        if (t && t.active) pop(this, t, 1.35, 280);
        if (card?.kind === 'part') this.installFx(game.part(card.partId).slot);
      });
    }
  }

  private lastPickTarget: Phaser.GameObjects.Container | null = null;
  private overlaySig = '';
  private lastPickCard: import('../core/types').PackCard | null = null;

  private pickTarget(): XY | null {
    const card = this.lastPickCard;
    this.lastPickTarget = null;
    if (!card) return null;
    const s = game.state;
    if (card.kind === 'part') {
      const slot = game.part(card.partId).slot;
      this.lastPickTarget = this.tiles.get(slot) ?? null;
      return tileXY(SLOTS.indexOf(slot));
    }
    if (card.kind === 'passive') {
      const n = s.passives.length - 1;
      this.lastPickTarget = this.passiveCards[n] ?? null;
      return { x: PASSIVE_X(n), y: INV_Y };
    }
    if (card.kind === 'consumable') {
      const n = s.consumables.length - 1;
      this.lastPickTarget = this.consCards[n] ?? null;
      return { x: CONS_X(n), y: INV_Y };
    }
    this.lastPickTarget = this.tuneCard;
    return { x: 608, y: INV_Y };
  }

  private pickCard(i: number) {
    const open = game.state.shop?.openPack;
    if (!open || !this.overlay) return;
    const ov = this.overlay;
    this.lastPickCard = open.cards[i] ?? null;
    this.picking = i;
    const isPart = this.lastPickCard?.kind === 'part';
    this.deferCarPop = isPart;
    this.statDelay = isPart ? 560 : 0;
    const r = game.pickPackCard(i);
    this.deferCarPop = false;
    this.statDelay = 0;
    if (!r.ok) {
      this.picking = null;
      ov.failPick(i, r.reason);
      toast(this, r.reason, PAL.red, TOAST_Y);
    }
  }

  // ------------------------------------------------------------------------------------------
  // stats

  private updateStats() {
    let st: CarStats;
    try {
      st = game.previewStats().setup.stats;
    } catch {
      return;
    }
    const prev = this.lastStats;
    this.lastStats = { ...st };
    const g = this.statBars;
    g.clear();
    let ticks = 0;
    STAT_KEYS.forEach((k, i) => {
      const y = 263 + i * 15;
      const t = this.statVal[k]!;
      const v = st[k];
      t.setText(fmtStat(k, v));
      const f = barFrac(k, v);
      g.fillStyle(PAL.bgDeep, 1).fillRect(STAT_X + 132, y + 1, 36, 6);
      const col = k === 'power' ? PAL.yellow : k === 'grip' ? PAL.green : k === 'weight' ? 0xb8b2c8 : k === 'gearing' ? PAL.orange : k === 'drag' ? PAL.teal : PAL.pink;
      g.fillStyle(col, 1).fillRect(STAT_X + 133, y + 2, Math.max(1, Math.round(34 * f)), 4);
      g.fillStyle(0xffffff, 0.3).fillRect(STAT_X + 133, y + 2, Math.max(1, Math.round(34 * f)), 1);
      if (prev && Math.abs(prev[k] - v) > 1e-6) {
        const good = isGood(k, v - prev[k]);
        const c = good ? PAL.green : PAL.red;
        t.setColor(hex(c));
        pop(this, t, 1.3, 260);
        this.time.delayedCall(1100, () => t.active && t.setColor(hex(PAL.ink)));
        const d = v - prev[k];
        const ds = k === 'power' || k === 'weight' ? `${d > 0 ? '+' : ''}${Math.round(d)}` : `${d > 0 ? '+' : ''}${d.toFixed(2)}`;
        floatText(this, STAT_X + 100, y, ds, c);
        // one soft tick per changed stat, after the install lands
        this.time.delayedCall(this.statDelay + 260 + ticks++ * 70, () => audio.tick());
      }
    });
    this.nosText.setText(st.nitroPower > 0 ? `NOS+${Math.round(st.nitroPower)}` : '');
  }

  // ------------------------------------------------------------------------------------------
  // actions

  private doReroll() {
    const r = game.reroll();
    if (!r.ok) return this.fail(r.reason, this.rerollBtn.container);
    sfx('reroll');
    pop(this, this.rerollBtn.container, 1.1);
  }

  private openGarage() {
    if (this.overlay || this.leaving) return;
    closeContextMenu(this);
    this.leaving = true;
    sfx('click');
    this.cameras.main.fadeOut(150, 11, 10, 20);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('Garage', { from: 'Shop' }));
  }

  private leave() {
    if (this.overlay || this.leaving) return;
    closeContextMenu(this);
    game.leaveShop();
    if (game.state.phase === 'shop') return toast(this, 'Cannot leave yet', PAL.red, TOAST_Y);
    this.leaving = true;
    sfx('click');
    goToPhase(this);
  }

  private fail(reason: string, target?: Phaser.GameObjects.Components.Transform | null) {
    toast(this, reason, PAL.red, TOAST_Y);
    if (target) shake(this, target, 3);
  }
}

function safe<T>(fn: () => T, dflt: T): T {
  try {
    return fn();
  } catch {
    return dflt;
  }
}
