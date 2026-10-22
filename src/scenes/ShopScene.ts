// The shop: buy parts / powerups / packs between races. The most important menu in the game.
//
// LAYOUT (640x360, all integer coords)
// ┌ TOP BAR (0,0)-(640,30) ─────────────────────────────────────────────────────────────────┐
// │ $CASH 24px yellow @x10   ROUND 1 - RACE 1/4 @x128,y6   NEXT: NAME (right @x632,y6)        │
// │                           SEED XXXXXX @x128,y18          [BOSS] MOD  TARGET 13.800 (y18)   │
// ├ GARAGE (6,34)-(206,118) ─────┬ INVENTORY (214,34)-(634,118) ──────────────────────────────┤
// │ car (makeCar x2) ground y108 │ PASSIVES 2/5 ..LEFT>RIGHT  | ITEMS 1/2  | TUNE             │
// │                              │ 5 cards 44x60 cx=244+50i cy=86 | 2 cards cx=508+50j | cx=608 │
// ├ PARTS (6,122)-(206,354) ─────┼ SHOP (214,122)-(634,240) ───────────────────────────────────┤
// │ 4x3 tiles 44x58              │ [TO THE STRIP] (222,128,92,48)  offers 64x92 cy=188         │
// │ x=10+48c, y=140+62r          │ [REROLL $3]    (222,184,92,48)  cx=358,428 | 508,578        │
// │                              ├ PACKS (214,244)-(374,354) ─┬ STATS (380,244)-(634,354) ─────┤
// │ footer hint y=330            │ packs 52x76 cx=254,334 cy=298│ 6 rows y=262+15i, bars x550  │
// └──────────────────────────────┴────────────────────────────┴────────────────────────────────┘
// The pack overlay covers y>=120 so the inventory band stays usable for making room.
import Phaser from 'phaser';
import type { CarStats, SlotId, StatKey } from '../core/types';
import { SLOTS } from '../core/types';
import { game } from '../game/game';
import { goToPhase } from './nav';
import { GAME_W, PAL, TIER_COLOR, hex } from '../render/palette';
import {
  Tooltip,
  burst,
  button,
  closeContextMenu,
  contextMenu,
  drawPanel,
  floatText,
  hoverTilt,
  panel,
  pop,
  sfx,
  shadowTxt,
  shake,
  tickNumber,
  toast,
  txt,
  type Button,
  type TipLine,
} from '../render/ui';
import { PACK_W, SLOT_SHORT, ensureTextures, slotIcon } from '../render/icons';
import { Card } from '../render/shop/card';
import { consumableSlotCard, iconKeyFor, passiveSlotCard, shopItemCard } from '../render/shop/factory';
import { STAT_LABEL, consumableTip, fmtStat, installedPartTip, isGood, passiveTip, shopItemTip, tuningTip } from '../render/shop/describe';
import { PackOverlay } from '../render/shop/packOverlay';
import { carVisualFromParts, makeCar } from '../render/car';

type Obj = Phaser.GameObjects.GameObject;
type XY = { x: number; y: number };

const TOAST_Y = 150;
const PASSIVE_X = (i: number) => 244 + i * 50;
const CONS_X = (j: number) => 508 + j * 50;
const INV_Y = 86;
const OFFER_X = [358, 428, 508, 578];
const OFFER_Y = 188;
const PACK_X = [254, 334];
const PACK_Y = 298;
const STAT_KEYS: StatKey[] = ['power', 'grip', 'weight', 'gearing', 'drag', 'shiftWindow'];
const tileXY = (i: number): XY => ({ x: 10 + (i % 4) * 48 + 22, y: 140 + Math.floor(i / 4) * 62 + 29 });

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
    this.statVal = {};
    this.lastStats = null;
    this.overlay = null;
    this.packFrom = null;
    this.picking = null;
    this.dragging = false;
    this.leaving = false;

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
    this.events.once('shutdown', () => {
      this.unsub?.();
      this.unsub = null;
      closeContextMenu(this);
    });

    const kb = this.input.keyboard;
    kb?.on('keydown-R', () => !this.overlay && this.doReroll());
    kb?.on('keydown-ENTER', () => !this.overlay && this.leave());
    kb?.on('keydown-ESC', () => closeContextMenu(this));
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
    panel(this, 214, 244, 160, 110, 0x231d3d);
    panel(this, 380, 244, 254, 110);

    // garage
    txt(this, 12, 39, 'GARAGE', 8, PAL.inkDim);
    const road = this.add.graphics();
    road.fillStyle(PAL.asphalt, 1).fillRect(8, 104, 196, 12);
    road.fillStyle(PAL.asphaltLight, 1).fillRect(8, 104, 196, 2);
    for (let x = 12; x < 200; x += 16) road.fillStyle(PAL.stripe, 0.4).fillRect(x, 110, 8, 1);

    // parts
    txt(this, 12, 127, 'PARTS', 8, PAL.ink);
    txt(this, 106, 334, 'CLICK: SELL / TUNE', 8, PAL.inkDim, [0.5, 0]);

    // inventory labels + order arrow
    const ag = this.add.graphics();
    ag.fillStyle(PAL.inkDim, 1);
    for (let x = 326; x < 378; x += 4) ag.fillRect(x, 41, 2, 2);
    ag.fillRect(378, 39, 2, 6).fillRect(380, 40, 2, 4).fillRect(382, 41, 2, 2);
    txt(this, 466, 38, 'LEFT>RIGHT', 8, PAL.inkDim, [1, 0]);
    txt(this, 588, 38, 'TUNE', 8, PAL.yellow);

    // shop buttons
    this.leaveBtn = button(this, 222, 128, 92, 48, 'TO THE\nSTRIP >', () => this.leave(), PAL.red);
    this.rerollBtn = button(this, 222, 184, 92, 48, 'REROLL\n$3', () => this.doReroll(), PAL.green);

    // stats panel
    txt(this, 388, 249, 'STATS', 8, PAL.ink);
    this.nosText = txt(this, 626, 249, '', 8, PAL.blue, [1, 0]);
    this.statBars = this.add.graphics();
    STAT_KEYS.forEach((k, i) => {
      const y = 263 + i * 15;
      this.add.image(388, y, `stat_${k}`).setOrigin(0, 0);
      txt(this, 400, y, STAT_LABEL[k], 8, PAL.inkDim);
      this.statVal[k] = txt(this, 544, y, '', 8, PAL.ink, [1, 0]);
    });
    const statZone = this.add.zone(380, 244, 254, 110).setOrigin(0, 0).setInteractive();
    statZone.on('pointerover', () =>
      this.tip.show({ x: 380, y: 244, w: 254, h: 110 }, 'Car stats', PAL.teal, [
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

    if (this.changed('top', [s.round, s.race, s.seed])) this.buildTop();
    if (this.changed('car', s.parts)) this.buildCar(this.sig.carInit === undefined);
    this.sig.carInit = '1';
    if (this.changed('tiles', [s.parts, s.tuningCards])) this.buildTiles();
    if (this.changed('inv', [s.passives, s.consumables, s.tuningCards, !!shop.openPack])) this.buildInventory();
    if (this.changed('offers', [shop.items, s.cash])) this.buildOffers();
    if (this.changed('packs', [shop.packs, s.cash])) this.buildPacks();
    this.rerollBtn.setLabel(`REROLL\n$${shop.rerollCost}`);
    this.rerollBtn.setEnabled(s.cash >= shop.rerollCost);
    this.updateStats();
    this.syncOverlay();
  }

  // ------------------------------------------------------------------------------------------
  // top bar

  private buildTop() {
    for (const o of this.topObjs) o.destroy();
    this.topObjs = [];
    const s = game.state;
    const boss = s.race === 3;
    const raceLbl = boss ? 'BOSS RACE' : `RACE ${s.race + 1}/4`;
    this.topObjs.push(txt(this, 128, 6, `ROUND ${s.round} - ${raceLbl}`, 8, boss ? PAL.red : PAL.ink));
    this.topObjs.push(txt(this, 128, 18, `SEED ${s.seed}`, 8, PAL.inkDim));

    let opp;
    try {
      opp = game.currentOpponent();
    } catch {
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

  // ------------------------------------------------------------------------------------------
  // garage car

  private buildCar(first: boolean) {
    this.car?.destroy();
    this.car = null;
    try {
      const car = makeCar(this, 106, 108, carVisualFromParts(game.state.parts), 2);
      this.car = car;
      this.tweens.add({ targets: car, y: 107, duration: 70, yoyo: true, repeat: -1, repeatDelay: 40 });
      if (!first) {
        pop(this, car, 1.15, 300);
        car.flameBurst?.(260);
        burst(this, 106, 90, [PAL.ink, PAL.orange, PAL.yellow], 16, 80, 20);
      }
    } catch (e) {
      // car renderer unavailable: simple placeholder silhouette
      const g = this.add.graphics();
      g.fillStyle(PAL.red, 1).fillRect(56, 80, 100, 18).fillRect(76, 68, 50, 14);
      g.fillStyle(PAL.bgDeep, 1).fillCircle(76, 100, 8).fillCircle(136, 100, 8);
      this.car = this.add.container(0, 0, [g]);
    }
  }

  // ------------------------------------------------------------------------------------------
  // part tiles

  private buildTiles() {
    for (const o of this.tileObjs) o.destroy();
    this.tileObjs = [];
    this.tiles.clear();
    const s = game.state;
    let upgraded = 0;
    SLOTS.forEach((slot, i) => {
      const ip = s.parts[slot];
      if (!ip) return;
      const def = game.part(ip.partId);
      if (def.tier !== 'stock') upgraded++;
      const { x, y } = tileXY(i);
      const c = this.add.container(x, y);
      const g = this.add.graphics();
      const stock = def.tier === 'stock';
      const col = stock ? PAL.panelEdge : TIER_COLOR[def.tier];
      g.fillStyle(PAL.bgDeep, 1).fillRect(-22 + 1, -29 + 2, 44, 58);
      g.fillStyle(col, 1).fillRect(-22, -29, 44, 58);
      g.fillStyle(stock ? PAL.panel : 0x15122a, 1).fillRect(-20, -27, 40, 54);
      if (!stock) g.fillStyle(col, 0.18).fillRect(-20, -27, 40, 30);
      const icon = this.add.image(0, -13, slotIcon(slot)).setScale(2).setAlpha(stock ? 0.55 : 1);
      const lbl = txt(this, 0, 8, SLOT_SHORT[slot], 8, stock ? PAL.inkDim : PAL.ink, [0.5, 0]);
      // level pips
      if (!stock) {
        for (let p = 0; p < 3; p++) {
          const px = -13 + p * 10;
          g.fillStyle(PAL.bgDeep, 1).fillRect(px, 19, 8, 5);
          g.fillStyle(p < ip.level ? PAL.yellow : PAL.panelLight, 1).fillRect(px + 1, 20, 6, 3);
        }
      }
      c.add([g, icon, lbl]);
      c.setSize(44, 58);
      c.setInteractive(new Phaser.Geom.Rectangle(-22, -29, 44, 58), Phaser.Geom.Rectangle.Contains);
      if (c.input) c.input.cursor = 'pointer';
      c.on('pointerover', () => {
        const t = installedPartTip(slot);
        this.tip.show({ x: x - 22, y: y - 29, w: 44, h: 58 }, t.title, t.color, t.lines, c);
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
        const glow = this.add.rectangle(x, y, 46, 60).setStrokeStyle(1, PAL.yellow).setFillStyle();
        this.tweens.add({ targets: glow, alpha: 0.2, yoyo: true, repeat: -1, duration: 450 });
        this.tileObjs.push(glow);
      }
      this.tiles.set(slot, c);
      this.tileObjs.push(c);
    });
    const hdr = txt(this, 200, 127, `${upgraded}/12 UPGRADED`, 8, PAL.inkDim, [1, 0]);
    this.tileObjs.push(hdr);
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
    sfx('buy');
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

    this.invObjs.push(txt(this, 222, 38, `PASSIVES ${s.passives.length}/5`, 8, PAL.ink));
    this.invObjs.push(txt(this, 486, 38, `ITEMS ${s.consumables.length}/2`, 8, PAL.ink));

    const slotOutline = (cx: number, label: string) => {
      const g = this.add.graphics();
      g.fillStyle(PAL.bgDeep, 0.5).fillRect(cx - 22, INV_Y - 30, 44, 60);
      g.fillStyle(PAL.panelEdge, 1);
      for (let k = 0; k < 44; k += 4) g.fillRect(cx - 22 + k, INV_Y - 30, 2, 1).fillRect(cx - 22 + k, INV_Y + 29, 2, 1);
      for (let k = 0; k < 60; k += 4) g.fillRect(cx - 22, INV_Y - 30 + k, 1, 2).fillRect(cx + 21, INV_Y - 30 + k, 1, 2);
      this.invObjs.push(g, txt(this, cx, INV_Y, label, 8, PAL.panelEdge, [0.5, 0.5]));
    };

    for (let i = 0; i < 5; i++) {
      const id = s.passives[i];
      if (!id) {
        slotOutline(PASSIVE_X(i), String(i + 1));
        continue;
      }
      const c = passiveSlotCard(this, PASSIVE_X(i), INV_Y, id, i + 1).makeInteractive();
      this.passiveCards.push(c);
      this.wirePassive(c, i, id);
    }
    for (let j = 0; j < 2; j++) {
      const id = s.consumables[j];
      if (!id) {
        slotOutline(CONS_X(j), '-');
        continue;
      }
      const c = consumableSlotCard(this, CONS_X(j), INV_Y, id).makeInteractive();
      this.consCards.push(c);
      hoverTilt(this, c, c.w, c.h);
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
      const t = passiveTip(id, ['', { t: `SLOT ${i + 1} OF 5 (LEFT RUNS FIRST)`, c: PAL.inkDim }, { t: `SELL VALUE $${sell}`, c: PAL.yellow }, { t: 'DRAG: REORDER  CLICK: SELL', c: PAL.inkDim }]);
      this.tip.show(c.rect(), t.title, t.color, t.lines, c);
      this.tweens.add({ targets: c, scale: 1.08, y: baseY - 3, duration: 110, ease: 'Back.easeOut' });
      sfx('hover');
    });
    c.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.dragging) return;
      c.angle = Phaser.Math.Clamp((p.x - c.x) / 22, -1, 1) * 5;
    });
    c.on('pointerout', () => {
      this.tip.hide(c);
      if (!this.dragging) this.tweens.add({ targets: c, scale: 1, y: baseY, angle: 0, duration: 140 });
    });
    c.on('dragstart', () => {
      this.dragging = true;
      this.tip.hide();
      closeContextMenu(this);
      this.tweens.killTweensOf(c);
      c.setDepth(40).setScale(1.12).setAngle(-4);
    });
    c.on('drag', (_p: Phaser.Input.Pointer, dx: number, dy: number) => {
      c.x = Phaser.Math.Clamp(Math.round(dx), 222, 466);
      c.y = Phaser.Math.Clamp(Math.round(dy), 60, 112);
      c.angle = Phaser.Math.Clamp((c.x - baseX) / 10, -8, 8);
    });
    c.on('dragend', () => {
      const n = game.state.passives.length;
      const to = Phaser.Math.Clamp(Math.round((c.x - 244) / 50), 0, n - 1);
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
    OFFER_X.forEach((x, i) => {
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
    const r = game.buyItem(i);
    if (!r.ok) return this.fail(r.reason, c);
    sfx('buy');
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
      if (target && target.active) pop(this, target, 1.3, 260);
      burst(this, to.x, to.y, [PAL.yellow, PAL.ink], 14, 70, 60);
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
      c.setInteractive(new Phaser.Geom.Rectangle(-PACK_W / 2, -38, PACK_W, 76), Phaser.Geom.Rectangle.Contains);
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
    this.packObjs.push(txt(this, 294, 249, 'PACKS', 8, PAL.inkDim, [0.5, 0]));
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
        (i) => this.pickCard(i),
        () => {
          sfx('click');
          game.skipPack();
        },
      );
      this.leaveBtn.setEnabled(false);
    } else if (!open && this.overlay) {
      const ov = this.overlay;
      this.overlay = null;
      this.leaveBtn.setEnabled(true);
      const picked = this.picking;
      this.picking = null;
      ov.close(picked, picked !== null ? this.pickTarget() : null, () => {
        const t = this.lastPickTarget;
        if (t && t.active) pop(this, t, 1.35, 280);
      });
    }
  }

  private lastPickTarget: Phaser.GameObjects.Container | null = null;
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
    const r = game.pickPackCard(i);
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
    STAT_KEYS.forEach((k, i) => {
      const y = 263 + i * 15;
      const t = this.statVal[k]!;
      const v = st[k];
      t.setText(fmtStat(k, v));
      const f = barFrac(k, v);
      g.fillStyle(PAL.bgDeep, 1).fillRect(550, y + 1, 76, 6);
      const col = k === 'power' ? PAL.yellow : k === 'grip' ? PAL.green : k === 'weight' ? 0xb8b2c8 : k === 'gearing' ? PAL.orange : k === 'drag' ? PAL.teal : PAL.pink;
      g.fillStyle(col, 1).fillRect(551, y + 2, Math.max(1, Math.round(74 * f)), 4);
      g.fillStyle(0xffffff, 0.3).fillRect(551, y + 2, Math.max(1, Math.round(74 * f)), 1);
      if (prev && Math.abs(prev[k] - v) > 1e-6) {
        const good = isGood(k, v - prev[k]);
        const c = good ? PAL.green : PAL.red;
        t.setColor(hex(c));
        pop(this, t, 1.3, 260);
        this.time.delayedCall(1100, () => t.active && t.setColor(hex(PAL.ink)));
        const d = v - prev[k];
        const ds = k === 'power' || k === 'weight' ? `${d > 0 ? '+' : ''}${Math.round(d)}` : `${d > 0 ? '+' : ''}${d.toFixed(2)}`;
        floatText(this, 520, y, ds, c);
      }
    });
    this.nosText.setText(st.nitroPower > 0 ? `NOS +${Math.round(st.nitroPower)} ${st.nitroDuration.toFixed(1)}S` : '');
  }

  // ------------------------------------------------------------------------------------------
  // actions

  private doReroll() {
    const r = game.reroll();
    if (!r.ok) return this.fail(r.reason, this.rerollBtn.container);
    sfx('reroll');
    pop(this, this.rerollBtn.container, 1.1);
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
