// Balatro-ish card: chunky border, colored band, big pixel icon, wrapped name, price tag on top.
// The container's origin is the card's center so it can tilt / flip around it.
import Phaser from 'phaser';
import { PAL, hex } from '../palette';
import { txt, wrap } from '../ui';

export interface CardSpec {
  w: number;
  h: number;
  accent: number; // border + band color
  band?: string; // label in the top band (omit for no band)
  icon: string; // texture key
  iconScale?: number; // default 2
  name?: string; // wrapped below the icon
  price?: number | null; // price chip on top; 0 shows FREE
  corner?: string; // small corner label (e.g. passive order)
  fill?: number;
}

export class Card extends Phaser.GameObjects.Container {
  readonly w: number;
  readonly h: number;
  readonly spec: CardSpec;
  private front: Phaser.GameObjects.Container;
  private backG: Phaser.GameObjects.Graphics;
  private chip?: Phaser.GameObjects.Container;
  private chipG?: Phaser.GameObjects.Graphics;
  private chipT?: Phaser.GameObjects.Text;
  iconImg: Phaser.GameObjects.Image;
  private dim = false;

  constructor(scene: Phaser.Scene, x: number, y: number, spec: CardSpec) {
    super(scene, Math.round(x), Math.round(y));
    this.spec = spec;
    const w = (this.w = spec.w);
    const h = (this.h = spec.h);
    const L = -w / 2;
    const T = -h / 2;
    const g = scene.add.graphics();
    // shadow, border, body
    g.fillStyle(PAL.bgDeep, 0.8).fillRect(L + 2, T + 3, w, h);
    g.fillStyle(spec.accent, 1).fillRect(L, T, w, h);
    g.fillStyle(PAL.bgDeep, 1).fillRect(L + 2, T + 2, w - 4, h - 4);
    g.fillStyle(spec.fill ?? PAL.panel, 1).fillRect(L + 3, T + 3, w - 6, h - 6);
    // subtle inner frame + sheen
    g.fillStyle(0xffffff, 0.07).fillRect(L + 3, T + 3, w - 6, Math.round(h / 3));
    g.fillStyle(spec.accent, 0.35).fillRect(L + 3, T + h - 6, w - 6, 3);
    this.front = scene.add.container(0, 0, [g]);
    let iconY = spec.name ? T + Math.round(h * 0.36) : T + Math.round(h / 2) + 2;
    if (spec.band) {
      g.fillStyle(spec.accent, 1).fillRect(L + 2, T + 2, w - 4, 11);
      g.fillStyle(0xffffff, 0.25).fillRect(L + 2, T + 2, w - 4, 1);
      const maxC = Math.floor((w - 4) / 8);
      const bt = txt(scene, 0, T + 8, spec.band.slice(0, maxC), 8, PAL.bgDeep, [0.5, 0.5]);
      this.front.add(bt);
      iconY = T + 13 + Math.round((h - 13) * 0.3);
    }
    const sc = spec.iconScale ?? 2;
    // icon backdrop disc
    const ih = 12 * sc + 6;
    g.fillStyle(PAL.bgDeep, 0.6).fillRect(-ih / 2, iconY - ih / 2, ih, ih);
    g.fillStyle(spec.accent, 0.18).fillRect(-ih / 2 + 1, iconY - ih / 2 + 1, ih - 2, ih - 2);
    this.iconImg = scene.add.image(0, iconY, spec.icon).setScale(sc);
    this.front.add(this.iconImg);
    if (spec.name) {
      const maxC = Math.floor((w - 6) / 8);
      const room = T + h - 7 - (iconY + ih / 2 + 3);
      const maxLines = Math.max(1, Math.floor((room + 3) / 11));
      const nt = txt(scene, 0, iconY + ih / 2 + 4, wrap(spec.name.toUpperCase(), maxC, maxLines), 8, PAL.ink, [0.5, 0])
        .setAlign('center')
        .setLineSpacing(3);
      nt.setShadow(1, 1, hex(PAL.bgDeep), 0, false, true);
      this.front.add(nt);
    }
    if (spec.corner) {
      const ct = txt(scene, L + 4, T + 4, spec.corner, 8, PAL.inkDim);
      this.front.add(ct);
    }
    // card back (hidden until flipped)
    this.backG = scene.add.graphics();
    this.drawBack();
    this.backG.setVisible(false);
    this.add([this.front, this.backG]);
    if (spec.price !== undefined && spec.price !== null) this.makeChip(spec.price);
    this.setSize(w, h);
    scene.add.existing(this);
  }

  private drawBack() {
    const { w, h } = this;
    const L = -w / 2;
    const T = -h / 2;
    const g = this.backG;
    g.clear();
    g.fillStyle(PAL.bgDeep, 0.8).fillRect(L + 2, T + 3, w, h);
    g.fillStyle(PAL.ink, 1).fillRect(L, T, w, h);
    g.fillStyle(PAL.red, 1).fillRect(L + 2, T + 2, w - 4, h - 4);
    g.fillStyle(0x000000, 0.25);
    for (let y = 0; y < h - 4; y += 6) g.fillRect(L + 2, T + 2 + y, w - 4, 3);
    // checker emblem
    const s = 4;
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        g.fillStyle((i + j) % 2 ? PAL.ink : PAL.bgDeep, 1).fillRect(-8 + i * s, -8 + j * s, s, s);
      }
    g.fillStyle(PAL.yellow, 1).fillRect(-10, -10, 20, 2).fillRect(-10, 8, 20, 2).fillRect(-10, -10, 2, 20).fillRect(8, -10, 2, 20);
  }

  private makeChip(price: number) {
    const label = price === 0 ? 'FREE' : `$${price}`;
    const cw = label.length * 8 + 8;
    this.chipG = this.scene.add.graphics();
    this.chipT = txt(this.scene, 0, 0, label, 8, PAL.bgDeep, [0.5, 0.5]);
    this.chip = this.scene.add.container(0, Math.round(-this.h / 2 - 4), [this.chipG, this.chipT]);
    this.chip.setData('w', cw);
    this.drawChip();
    this.add(this.chip);
  }

  private drawChip() {
    if (!this.chipG || !this.chip) return;
    const cw = this.chip.getData('w') as number;
    const col = this.dim ? PAL.red : this.spec.price === 0 ? PAL.green : PAL.yellow;
    this.chipG.clear();
    this.chipG.fillStyle(PAL.bgDeep, 1).fillRect(-cw / 2 + 1, -6 + 2, cw, 12);
    this.chipG.fillStyle(col, 1).fillRect(-cw / 2, -6, cw, 12);
    this.chipG.fillStyle(0xffffff, 0.35).fillRect(-cw / 2, -6, cw, 1);
    this.chipT?.setColor(hex(this.dim ? PAL.ink : PAL.bgDeep));
  }

  /** Can't afford / unavailable: dim the art, redden the price. */
  setDim(on: boolean): this {
    this.dim = on;
    this.front.setAlpha(on ? 0.5 : 1);
    this.drawChip();
    return this;
  }

  showBack(on: boolean): this {
    this.backG.setVisible(on);
    this.front.setVisible(!on);
    this.chip?.setVisible(!on);
    return this;
  }

  /** Make the whole card clickable (hit area in local, centered coords). */
  makeInteractive(): this {
    this.setInteractive(new Phaser.Geom.Rectangle(-this.w / 2, -this.h / 2, this.w, this.h), Phaser.Geom.Rectangle.Contains);
    if (this.input) this.input.cursor = 'pointer';
    return this;
  }

  /** Flip in from the back. */
  flipIn(delay = 0, ms = 260, onFace?: () => void): this {
    this.showBack(true);
    this.scaleX = 1;
    this.scene.tweens.add({
      targets: this,
      scaleX: 0,
      delay,
      duration: ms / 2,
      ease: 'Quad.easeIn',
      onComplete: () => {
        this.showBack(false);
        onFace?.();
        this.scene.tweens.add({ targets: this, scaleX: 1, duration: ms / 2, ease: 'Back.easeOut' });
      },
    });
    return this;
  }

  /** Screen-space bounding rect (unrotated) for tooltip anchoring. */
  rect(): { x: number; y: number; w: number; h: number } {
    const m = this.getWorldTransformMatrix();
    return { x: Math.round(m.tx - this.w / 2), y: Math.round(m.ty - this.h / 2), w: this.w, h: this.h };
  }
}
