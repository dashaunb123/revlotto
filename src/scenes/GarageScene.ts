// Paint shop: pick the player car's body, paint, accent, rims, livery and door number.
// Looks only (no stats). Opened from the Title or the Shop, returns to whichever opened it.
//
// LAYOUT (640x360)
// ┌ TOP BAR (0,0)-(640,30): PAINT SHOP 16px @x10 | LOOKS ONLY... | UNLOCKED n/N (right @x632) ┐
// ├ PREVIEW (8,34)-(400,214) ──────────────────────┬ PAINT  (408,34)-(632,102)  12 sw 32x18, 6/row │
// │ car 3x, ground y196, x204; name plate top-left │ ACCENT (408,106)-(632,152)  8 sw 24x18       │
// ├ BODY (8,218)-(400,298) 5 tiles 74x56 @x14+76i  │ RIMS   (408,156)-(632,202)  6 wheels         │
// │ mini cars (1x) in your paint, ground y+36      │ LIVERY (408,206)-(632,252)  5 sw 40x18       │
// ├ (8,302)-(400,352) BACK | SHUFFLE | hint        │ NUMBER (408,256)-(632,352)  [-] 07 [+]       │
// └────────────────────────────────────────────────┴──────────────────────────────────────────────┘
import Phaser from 'phaser';
import { game } from '../game/game';
import { GAME_W, PAL } from '../render/palette';
import { Tooltip, burst, button, panel, pop, sfx, shadowTxt, shake, toast, txt, type TipLine } from '../render/ui';
import { ensureTextures } from '../render/icons';
import { carVisualFromParts, makeCar, type CarLook, type CarSprite } from '../render/car';
import { DEFAULT_ENGINE_PROFILE, engineProfileFromParts, revBlip, unlockAudio } from '../render/audio';
import {
  CATALOG,
  KIND_LABEL,
  isUnlocked,
  loadLook,
  saveLook,
  selectedId,
  unlockHint,
  unlockedCount,
  withItem,
  type CosmeticKind,
} from '../game/cosmetics';

const parse = (c: string) => parseInt(c.replace('#', ''), 16);
const PREVIEW = { x: 204, y: 196 };
const TOAST_Y = 15; // over the top bar, clear of every picker

interface Swatch {
  kind: CosmeticKind;
  id: string;
  c: Phaser.GameObjects.Container;
  draw: (hover: boolean) => void;
}

/** Tiny pixel padlock centered on (cx, cy). */
function drawLock(g: Phaser.GameObjects.Graphics, cx: number, cy: number) {
  g.fillStyle(PAL.bgDeep, 1).fillRect(cx - 4, cy - 1, 9, 7);
  g.fillStyle(PAL.inkDim, 1).fillRect(cx - 3, cy - 5, 2, 5).fillRect(cx + 2, cy - 5, 2, 5).fillRect(cx - 2, cy - 6, 5, 2);
  g.fillStyle(PAL.yellow, 1).fillRect(cx - 4, cy - 1, 8, 6);
  g.fillStyle(PAL.bgDeep, 1).fillRect(cx - 1, cy + 1, 2, 2);
}

export class GarageScene extends Phaser.Scene {
  private from = 'Title';
  private look!: CarLook;
  private tip!: Tooltip;
  private car: CarSprite | null = null;
  private swatches: Swatch[] = [];
  private bodyCars: Phaser.GameObjects.GameObject[] = [];
  private headVal: Partial<Record<CosmeticKind, Phaser.GameObjects.Text>> = {};
  private plateName!: Phaser.GameObjects.Text;
  private plateSub!: Phaser.GameObjects.Text;
  private numText!: Phaser.GameObjects.Text;
  private countText!: Phaser.GameObjects.Text;
  private leaving = false;

  constructor() {
    super('Garage');
  }

  init(data: { from?: string }) {
    this.from = data?.from ?? 'Title';
  }

  create() {
    this.swatches = [];
    this.bodyCars = [];
    this.headVal = {};
    this.car = null;
    this.leaving = false;
    this.look = loadLook();
    ensureTextures(this);
    this.cameras.main.fadeIn(180, 11, 10, 20);

    // backdrop: same diagonal weave as the shop
    const bg = this.add.graphics();
    bg.fillStyle(PAL.bg, 1).fillRect(0, 0, GAME_W, 360);
    for (let y = 0; y < 360; y += 16) for (let x = (y / 16) % 2 ? 16 : 0; x < GAME_W; x += 32) bg.fillStyle(0x100e1c, 1).fillRect(x, y, 16, 16);

    // top bar
    panel(this, -2, -2, 644, 32);
    shadowTxt(this, 10, 15, 'PAINT SHOP', 16, PAL.yellow, [0, 0.5]);
    txt(this, 184, 11, 'LOOKS ONLY: NO STAT CHANGES', 8, PAL.inkDim);
    this.countText = txt(this, 632, 11, '', 8, PAL.ink, [1, 0]);

    this.tip = new Tooltip(this);
    this.buildPreviewFrame();
    this.buildBodies();
    this.buildColorRow('color', 34, 68, 32, 36, 6);
    this.buildColorRow('accent', 106, 46, 24, 27, 8);
    this.buildRims();
    this.buildLiveries();
    this.buildNumber();
    this.buildFooter();
    this.refreshAll(false);

    const kb = this.input.keyboard;
    kb?.on('keydown-ESC', () => this.back());
    kb?.on('keydown-BACKSPACE', () => this.back());
    kb?.on('keydown-LEFT', () => this.bumpNumber(-1));
    kb?.on('keydown-RIGHT', () => this.bumpNumber(1));
    this.input.on('pointerdown', () => unlockAudio());
  }

  // ------------------------------------------------------------------------------------------
  // preview

  private buildPreviewFrame() {
    panel(this, 8, 34, 392, 180, 0x15122a);
    const g = this.add.graphics();
    // back wall with panel seams, then a checker floor
    g.fillStyle(0x1c1830, 1).fillRect(10, 36, 388, 120);
    for (let x = 10; x < 398; x += 48) g.fillStyle(0x15122a, 1).fillRect(x, 36, 2, 120);
    g.fillStyle(PAL.panelEdge, 1).fillRect(10, 154, 388, 2);
    for (let y = 156; y < 212; y += 8)
      for (let x = 10 + (((y - 156) / 8) % 2) * 8; x < 398; x += 16) g.fillStyle(0x221c3a, 1).fillRect(x, y, Math.min(8, 398 - x), Math.min(8, 212 - y));
    // spotlight cone + pool
    g.fillStyle(PAL.yellow, 0.06).fillTriangle(PREVIEW.x, 36, PREVIEW.x - 150, PREVIEW.y + 6, PREVIEW.x + 150, PREVIEW.y + 6);
    g.fillStyle(PAL.yellow, 0.05).fillTriangle(PREVIEW.x, 36, PREVIEW.x - 90, PREVIEW.y + 6, PREVIEW.x + 90, PREVIEW.y + 6);
    g.fillStyle(PAL.yellow, 0.08).fillEllipse(PREVIEW.x, PREVIEW.y + 2, 280, 18);
    g.fillStyle(PAL.ink, 1).fillRect(PREVIEW.x - 10, 36, 20, 4);
    // name plate
    this.plateName = shadowTxt(this, 18, 44, '', 16, PAL.ink);
    this.plateSub = txt(this, 18, 64, '', 8, PAL.inkDim);
  }

  private buildCar(juice: boolean, rev: boolean) {
    this.car?.destroy();
    this.car = null;
    try {
      const car = makeCar(this, PREVIEW.x, PREVIEW.y, carVisualFromParts(game.state.parts, this.look, { paragon: false }), 3);
      car.setDepth(5);
      this.car = car;
      this.tweens.add({ targets: car, y: PREVIEW.y - 1, duration: 90, yoyo: true, repeat: -1, repeatDelay: 600 });
      if (juice) {
        pop(this, car, 1.12, 280);
        burst(this, PREVIEW.x, PREVIEW.y - 40, [parse(this.look.color), parse(this.look.accent), PAL.ink], 22, 140, 20);
      }
      if (rev) {
        car.flameBurst(420);
        car.setWheelSpin(12);
        this.time.delayedCall(700, () => car.active && car.setWheelSpin(0));
      }
    } catch {
      /* car renderer unavailable */
    }
    const body = CATALOG.body.find((b) => b.id === this.look.body);
    const paint = CATALOG.color.find((c) => c.id === selectedId(this.look, 'color'));
    this.plateName.setText((body?.name ?? this.look.body).toUpperCase());
    this.plateSub.setText(`${(paint?.name ?? '').toUpperCase()}${this.look.number ? `  #${this.look.number}` : ''}`);
  }

  // ------------------------------------------------------------------------------------------
  // pickers

  /** Section header: label left, current pick right. */
  private header(kind: CosmeticKind | 'number', x: number, y: number, w: number) {
    txt(this, x + 8, y + 6, kind === 'number' ? 'DOOR NUMBER' : KIND_LABEL[kind], 8, PAL.ink);
    const v = txt(this, x + w - 8, y + 6, '', 8, PAL.yellow, [1, 0]);
    if (kind !== 'number') this.headVal[kind] = v;
    return v;
  }

  /** Generic swatch: a container centered on the swatch; `face` draws its contents. */
  private swatch(kind: CosmeticKind, id: string, cx: number, cy: number, w: number, h: number, face: (g: Phaser.GameObjects.Graphics, lockd: boolean) => void) {
    const c = this.add.container(cx, cy);
    const g = this.add.graphics();
    c.add(g);
    const it = CATALOG[kind].find((i) => i.id === id)!;
    const draw = (hover: boolean) => {
      const sel = selectedId(this.look, kind) === id;
      const lockd = !isUnlocked(kind, id);
      g.clear();
      g.fillStyle(PAL.bgDeep, 1).fillRect(-w / 2 + 1, -h / 2 + 2, w, h);
      g.fillStyle(sel ? PAL.yellow : hover ? PAL.ink : PAL.panelEdge, 1).fillRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2);
      g.fillStyle(PAL.bgDeep, 1).fillRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2);
      face(g, lockd);
      if (lockd) {
        g.fillStyle(PAL.bgDeep, 0.6).fillRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2);
        drawLock(g, 0, 0);
      }
      if (sel) g.fillStyle(PAL.yellow, 1).fillRect(-3, h / 2 + 2, 6, 2);
    };
    c.setSize(w, h);
    // hitBox() is for top-left-origin boxes; this one is centered
    c.setInteractive(new Phaser.Geom.Rectangle(-w / 2 + c.displayOriginX, -h / 2 + c.displayOriginY, w, h), Phaser.Geom.Rectangle.Contains);
    if (c.input) c.input.cursor = 'pointer';
    c.on('pointerover', () => {
      draw(true);
      this.tweens.add({ targets: c, scale: w > 50 ? 1.06 : 1.15, duration: 90, ease: 'Back.easeOut' });
      sfx('hover');
      const lockd = !isUnlocked(kind, id);
      const lines: TipLine[] = lockd
        ? [{ t: 'LOCKED', c: PAL.red }, { t: unlockHint(kind, id), c: PAL.ink }]
        : [{ t: selectedId(this.look, kind) === id ? 'EQUIPPED' : 'CLICK TO APPLY', c: PAL.inkDim }];
      this.tip.show({ x: cx - w / 2, y: cy - h / 2, w, h }, `${it.name} ${KIND_LABEL[kind]}`, lockd ? PAL.inkDim : PAL.yellow, lines, c);
    });
    c.on('pointerout', () => {
      draw(false);
      this.tweens.add({ targets: c, scale: 1, duration: 100 });
      this.tip.hide(c);
    });
    c.on('pointerup', () => this.pick(kind, id, c));
    this.swatches.push({ kind, id, c, draw });
    return c;
  }

  private buildColorRow(kind: 'color' | 'accent', y: number, h: number, sw: number, pitch: number, perRow: number) {
    panel(this, 408, y, 224, h);
    this.header(kind, 408, y, 224);
    const x0 = 414 + sw / 2;
    CATALOG[kind].forEach((it, i) => {
      const cx = x0 + (i % perRow) * pitch;
      const cy = y + 29 + Math.floor(i / perRow) * 22;
      const col = parse(it.value);
      this.swatch(kind, it.id, cx, cy, sw, 18, (g) => {
        g.fillStyle(col, 1).fillRect(-sw / 2 + 2, -7, sw - 4, 14);
        g.fillStyle(0xffffff, 0.3).fillRect(-sw / 2 + 2, -7, sw - 4, 2);
        g.fillStyle(0x000000, 0.2).fillRect(-sw / 2 + 2, 5, sw - 4, 2);
      });
    });
  }

  private buildRims() {
    panel(this, 408, 156, 224, 46);
    this.header('rim', 408, 156, 224);
    CATALOG.rim.forEach((it, i) => {
      const col = parse(it.value);
      this.swatch('rim', it.id, 430 + i * 36, 185, 32, 18, (g) => {
        g.fillStyle(0x16141c, 1).fillCircle(0, 0, 8);
        g.fillStyle(col, 1).fillCircle(0, 0, 5);
        g.fillStyle(0x000000, 0.35).fillRect(-1, -4, 2, 8).fillRect(-4, -1, 8, 2);
        g.fillStyle(0xffffff, 0.5).fillRect(-3, -4, 2, 1);
      });
    });
  }

  private buildLiveries() {
    panel(this, 408, 206, 224, 46);
    this.header('livery', 408, 206, 224);
    CATALOG.livery.forEach((it, i) => {
      this.swatch('livery', it.id, 434 + i * 43, 235, 40, 18, (g) => {
        const body = parse(this.look.color);
        const acc = parse(this.look.accent);
        g.fillStyle(body, 1).fillRect(-18, -7, 36, 14);
        switch (it.id) {
          case 'stripes':
            g.fillStyle(acc, 1).fillRect(-18, -3, 36, 2).fillRect(-18, 1, 36, 2);
            break;
          case 'flames':
            g.fillStyle(PAL.orange, 1);
            for (let k = 0; k < 4; k++) g.fillTriangle(-18, -5 + k * 3, -18, -2 + k * 3, -6 + k * 5, -3 + k * 3);
            g.fillStyle(PAL.yellow, 1).fillTriangle(-18, -1, -18, 3, -4, 1);
            break;
          case 'checker':
            for (let r = 0; r < 4; r++) for (let k = 0; k < 9; k++) if ((r + k) % 2 === 0) g.fillStyle(acc, 1).fillRect(-18 + k * 4, -7 + r * 4, 4, Math.min(4, 14 - r * 4));
            break;
          case 'split':
            g.fillStyle(acc, 1).fillRect(-18, 0, 36, 7);
            break;
        }
        g.fillStyle(0xffffff, 0.25).fillRect(-18, -7, 36, 1);
      });
    });
  }

  /** Body tiles show mini cars in your current paint; rebuilt when the paint changes. */
  private buildBodies() {
    panel(this, 8, 218, 392, 80);
    this.header('body', 8, 218, 392);
    CATALOG.body.forEach((it, i) => {
      this.swatch('body', it.id, 52 + i * 76, 264, 74, 52, (g, lockd) => {
        g.fillStyle(lockd ? 0x100e1c : 0x231d3d, 1).fillRect(-36, -25, 72, 50);
        g.fillStyle(PAL.asphalt, 1).fillRect(-36, 14, 72, 11);
      });
    });
  }

  private buildBodyCars() {
    for (const o of this.bodyCars) o.destroy();
    this.bodyCars = [];
    for (const sw of this.swatches) {
      if (sw.kind !== 'body') continue;
      const lockd = !isUnlocked('body', sw.id);
      try {
        const v = carVisualFromParts(game.state.parts, withItem(this.look, 'body', sw.id), { paragon: false });
        if (lockd) {
          v.color = '#2b2547';
          v.accent = '#1c1830';
          v.livery = 'none';
          v.number = 0;
        }
        const car = makeCar(this, 0, 14, v, 1);
        if (lockd) car.setAlpha(0.7);
        sw.c.addAt(car, 1);
        this.bodyCars.push(car);
      } catch {
        /* renderer unavailable */
      }
      // the lock has to sit above the car: redraw it on a top layer
      if (lockd) {
        const lg = this.add.graphics();
        drawLock(lg, 0, -4);
        sw.c.add(lg);
        this.bodyCars.push(lg);
      }
      const name = txt(this, 0, -21, bodyName(sw.id), 8, lockd ? PAL.inkDim : PAL.ink, [0.5, 0]);
      sw.c.add(name);
      this.bodyCars.push(name);
    }
  }

  private buildNumber() {
    panel(this, 408, 256, 224, 96);
    this.header('number', 408, 256, 224);
    // door roundel
    const g = this.add.graphics();
    g.fillStyle(PAL.bgDeep, 1).fillRect(484, 278, 72, 36);
    g.fillStyle(PAL.ink, 1).fillRect(486, 280, 68, 32);
    g.fillStyle(0xffffff, 0.5).fillRect(486, 280, 68, 2);
    this.numText = txt(this, 520, 297, '', 24, PAL.bgDeep, [0.5, 0.5]);
    button(this, 446, 282, 28, 28, '-', () => this.bumpNumber(-1), PAL.panelLight, 16);
    button(this, 566, 282, 28, 28, '+', () => this.bumpNumber(1), PAL.panelLight, 16);
    txt(this, 520, 324, '0 = NO NUMBER', 8, PAL.inkDim, [0.5, 0]);
    txt(this, 520, 336, 'ARROW KEYS: -/+', 8, PAL.inkDim, [0.5, 0]);
  }

  private buildFooter() {
    panel(this, 8, 302, 392, 50);
    button(this, 16, 310, 96, 34, this.from === 'Shop' ? '< SHOP' : '< BACK', () => this.back(), PAL.red);
    button(this, 120, 310, 96, 34, 'SHUFFLE', () => this.shuffle(), PAL.purple);
    txt(this, 228, 312, 'BEAT BOSSES AND RACE', 8, PAL.inkDim);
    txt(this, 228, 324, 'CLEAN TO UNLOCK MORE', 8, PAL.inkDim);
    txt(this, 228, 336, 'ESC: BACK', 8, PAL.panelEdge);
  }

  // ------------------------------------------------------------------------------------------
  // actions

  private refreshAll(juice: boolean, rev = false) {
    for (const s of this.swatches) s.draw(false);
    for (const kind of Object.keys(this.headVal) as CosmeticKind[]) {
      const it = CATALOG[kind].find((i) => i.id === selectedId(this.look, kind));
      this.headVal[kind]!.setText((it?.name ?? '').toUpperCase());
    }
    this.numText.setText(this.look.number ? String(this.look.number).padStart(2, '0') : '--');
    const n = unlockedCount();
    this.countText.setText(`UNLOCKED ${n.have}/${n.total}`);
    this.buildBodyCars();
    this.buildCar(juice, rev);
  }

  private pick(kind: CosmeticKind, id: string, c: Phaser.GameObjects.Container) {
    if (this.leaving) return;
    if (!isUnlocked(kind, id)) {
      sfx('error');
      shake(this, c, 3);
      toast(this, `Locked: ${unlockHint(kind, id)}`, PAL.panelLight, TOAST_Y);
      return;
    }
    if (selectedId(this.look, kind) === id) {
      pop(this, c, 1.2);
      return;
    }
    this.apply(withItem(this.look, kind, id), kind === 'body');
    pop(this, c, 1.3, 240);
  }

  private apply(look: CarLook, rev: boolean) {
    this.look = look;
    saveLook(look);
    this.look = loadLook();
    sfx('pick');
    if (rev) revBlip(this.from === 'Shop' ? engineProfileFromParts(game.state.parts) : DEFAULT_ENGINE_PROFILE);
    // defer: rebuilding destroys objects inside the input event that triggered it
    this.time.delayedCall(0, () => this.refreshAll(true, rev));
  }

  private bumpNumber(d: number) {
    if (this.leaving) return;
    const n = (this.look.number + d + 100) % 100;
    this.look = { ...this.look, number: n };
    saveLook(this.look);
    sfx('flip');
    this.numText.setText(n ? String(n).padStart(2, '0') : '--');
    pop(this, this.numText, 1.3, 200);
    this.buildCar(false, false);
    if (this.car) pop(this, this.car, 1.05, 160);
  }

  private shuffle() {
    let l = { ...this.look };
    for (const kind of Object.keys(CATALOG) as CosmeticKind[]) {
      const open = CATALOG[kind].filter((i) => isUnlocked(kind, i.id));
      if (kind === 'body' && Math.random() < 0.5) continue; // keep the body half the time
      l = withItem(l, kind, Phaser.Utils.Array.GetRandom(open).id);
    }
    l.number = Phaser.Math.Between(0, 99);
    this.apply(l, l.body !== this.look.body);
  }

  private back() {
    if (this.leaving) return;
    this.leaving = true;
    sfx('click');
    this.cameras.main.fadeOut(150, 11, 10, 20);
    this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start(this.from));
  }
}

function bodyName(id: string): string {
  return (CATALOG.body.find((b) => b.id === id)?.name ?? id).toUpperCase();
}

