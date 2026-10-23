// Balatro-ish card: chunky border, colored band, big pixel icon, wrapped name, price tag on top.
// The container's origin is the card's center so it can tilt / flip around it.
import Phaser from 'phaser';
import { PAL, hex } from '../palette';
import { hitBox, txt, wrap } from '../ui';

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
  edition?: string | null; // 'foil' | 'holo' | 'chrome': tinted frame, moving sheen, label chip
  brand?: CardBrand; // brand part: brand band + logo, tier line, set-progress chip
}

/** Brand bits of a part card (built in factory.ts). */
export interface CardBrand {
  name: string; // band label, e.g. 'MALIBRU'
  color: number; // band fill
  ink: number; // band text colour
  logo: string | null; // logo texture key (icons.ts), drawn left in the band
  tier: string; // 'SPORT'
  tierColor: number;
  progress: string; // '4/12' (after buying when it advances)
  advance: string | null; // '+1 MALIBRU' / 'PARAGON!' when this offer advances a set you own
  breaks: string | null; // '-1 KAIJU' when it replaces a part of another set you own
}

/** Edition looks: frame color, sheen color, label. Holo cycles its frame through the rainbow. */
export const EDITION_STYLE: Record<string, { frame: number; sheen: number; label: string; short: string; text: number }> = {
  foil: { frame: 0x8fd3ff, sheen: 0xcfeeff, label: 'FOIL', short: 'FOIL', text: PAL.bgDeep },
  holo: { frame: PAL.pink, sheen: 0xffffff, label: 'HOLO', short: 'HOLO', text: PAL.bgDeep },
  chrome: { frame: 0xd6d4e4, sheen: 0xffffff, label: 'CHROME', short: 'CHRM', text: PAL.bgDeep },
};
const HOLO = [PAL.red, PAL.orange, PAL.yellow, PAL.green, PAL.teal, PAL.blue, PAL.purple, PAL.pink];

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
    const br = spec.brand;
    if (br) {
      // brand band (logo + name in brand colours), then the tier word in tier colour
      g.fillStyle(br.color, 1).fillRect(L + 2, T + 2, w - 4, 12);
      g.fillStyle(0xffffff, 0.3).fillRect(L + 2, T + 2, w - 4, 1);
      g.fillStyle(0x000000, 0.25).fillRect(L + 2, T + 13, w - 4, 1);
      const logoW = br.logo ? 11 : 0;
      const maxC = Math.floor((w - 6 - logoW) / 8);
      const label = br.name.length > maxC ? br.name.slice(0, maxC) : br.name;
      const bx = logoW ? L + 3 + logoW + (w - 6 - logoW) / 2 : 0;
      const bt = txt(scene, Math.round(bx), T + 8, label, 8, br.ink, [0.5, 0.5]);
      this.front.add(bt);
      if (br.logo) {
        const li = scene.add.image(L + 8, T + 8, br.logo);
        const m = Math.max(li.width, li.height) || 10;
        li.setScale(m > 10 ? 10 / m : 1);
        this.front.add(li);
      }
      const tt = txt(scene, 0, T + 15, br.tier, 8, br.tierColor, [0.5, 0]);
      tt.setShadow(1, 1, hex(PAL.bgDeep), 0, false, true);
      this.front.add(tt);
      iconY = T + 24 + Math.round((h - 24) * 0.2) + 6 * ((spec.iconScale ?? 2) - 1);
    } else if (spec.band) {
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
    if (br) this.makeSetChip(br);
    // card back (hidden until flipped)
    this.backG = scene.add.graphics();
    this.drawBack();
    this.backG.setVisible(false);
    this.add([this.front, this.backG]);
    if (spec.edition && EDITION_STYLE[spec.edition]) this.makeEdition(spec.edition);
    if (spec.price !== undefined && spec.price !== null) this.makeChip(spec.price);
    this.setSize(w, h);
    scene.add.existing(this);
  }

  /** Edition overlay: recolored frame, a diagonal sheen sweeping across, and a label chip on the bottom edge. */
  private makeEdition(ed: string) {
    const st = EDITION_STYLE[ed];
    const { w, h } = this;
    const L = -w / 2;
    const T = -h / 2;
    const g = this.scene.add.graphics();
    const chipG = this.scene.add.graphics();
    const label = w >= 60 ? st.label : st.short;
    const cw = label.length * 8 + 6;
    // small (inventory) cards overlap when slots grow: keep the chip on the visible left edge
    const cx = w >= 60 ? 0 : L + 1 + cw / 2;
    const lt = txt(this.scene, cx, T + h - 1, label, 8, st.text, [0.5, 0.5]);
    this.front.add([g, chipG, lt]);
    const t0 = Math.random() * 3000;
    const draw = (time: number) => {
      const t = time + t0;
      const frame = ed === 'holo' ? HOLO[Math.floor(t / 120) % HOLO.length] : st.frame;
      g.clear();
      // frame
      g.fillStyle(frame, 1).fillRect(L, T, w, 2).fillRect(L, T + h - 2, w, 2).fillRect(L, T, 2, h).fillRect(L + w - 2, T, 2, h);
      // tint wash
      g.fillStyle(frame, ed === 'chrome' ? 0.1 : 0.08).fillRect(L + 3, T + 3, w - 6, h - 6);
      // sheen: a diagonal band x + 0.6y = pos, swept every 1.6s, drawn as 2px columns
      const span = w + h * 0.6 + 24;
      const pos = ((t % 1600) / 1600) * span * 1.6 - 12 + L;
      const band = ed === 'chrome' ? 7 : 5;
      for (let x = L + 3; x < L + w - 3; x += 2) {
        const ya = T + (pos - x - band) / 0.6;
        const yb = T + (pos - x + band) / 0.6;
        const lo = Math.max(T + 3, ya);
        const hi = Math.min(T + h - 3, yb);
        if (hi > lo) g.fillStyle(ed === 'holo' ? HOLO[Math.floor((x - L) / 6 + t / 90) % HOLO.length] : st.sheen, ed === 'holo' ? 0.28 : 0.32).fillRect(x, lo, 2, hi - lo);
      }
      chipG.clear();
      chipG.fillStyle(PAL.bgDeep, 1).fillRect(cx - cw / 2 + 1, T + h - 6 + 1, cw, 10);
      chipG.fillStyle(frame, 1).fillRect(cx - cw / 2, T + h - 6, cw, 10);
      chipG.fillStyle(0xffffff, 0.4).fillRect(cx - cw / 2, T + h - 6, cw, 1);
    };
    draw(this.scene.time.now);
    const onUpdate = (time: number) => {
      if (this.active && this.visible) draw(time);
    };
    const sc = this.scene;
    sc.events.on('update', onUpdate);
    this.once('destroy', () => sc.events.off('update', onUpdate));
  }

  /** Bottom-edge set chip: '4/12' in brand colours, or a glowing '+1 MALIBRU' / 'PARAGON!' when it advances a set. */
  private makeSetChip(br: CardBrand) {
    const { w, h } = this;
    const T = -h / 2;
    const y = T + h - 1;
    const warn = !br.advance && !!br.breaks;
    const label = br.advance ?? br.breaks ?? br.progress;
    const maxC = Math.floor((w + 4) / 8);
    const lbl = label.length > maxC ? label.slice(0, maxC) : label;
    const cw = Math.min(w + 6, lbl.length * 8 + 6);
    const g = this.scene.add.graphics();
    const glow = this.scene.add.graphics();
    const hot = !!br.advance;
    const para = br.advance === 'PARAGON!';
    const fill = para ? PAL.yellow : hot ? br.color : warn ? PAL.red : PAL.bgDeep;
    const ink = para ? PAL.bgDeep : hot ? br.ink : warn ? PAL.ink : br.color === PAL.bgDeep ? PAL.ink : br.color;
    g.fillStyle(PAL.bgDeep, 1).fillRect(-cw / 2 + 1, y - 5 + 1, cw, 11);
    g.fillStyle(hot ? 0xffffff : warn ? PAL.red : br.color, 1).fillRect(-cw / 2, y - 5, cw, 11);
    g.fillStyle(fill, 1).fillRect(-cw / 2 + 1, y - 4, cw - 2, 9);
    const t = txt(this.scene, 0, y + 1, lbl, 8, ink, [0.5, 0.5]);
    this.front.add([glow, g, t]);
    if (hot) {
      // pulsing halo + twinkles so set-advancing offers jump out of the shelf
      glow.fillStyle(para ? PAL.yellow : br.color, 1).fillRect(-cw / 2 - 3, y - 8, cw + 6, 17);
      glow.setAlpha(0.35);
      this.scene.tweens.add({ targets: glow, alpha: { from: 0.15, to: 0.6 }, duration: 380, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.scene.tweens.add({ targets: t, scale: { from: 1, to: 1.08 }, duration: 380, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      const sp = this.scene.add.graphics();
      this.front.add(sp);
      const draw = (time: number) => {
        sp.clear();
        const k = Math.floor(time / 140);
        for (let i = 0; i < 3; i++) {
          const ph = (k + i * 3) % 8;
          if (ph > 3) continue;
          const sx = Math.round(-w / 2 + 6 + ((i * 23 + Math.floor(k / 8) * 17) % (w - 12)));
          const sy = Math.round(T + 20 + ((i * 31 + Math.floor(k / 8) * 13) % (h - 34)));
          const a = ph === 1 || ph === 2 ? 2 : 1;
          sp.fillStyle(0xffffff, 0.9).fillRect(sx - a, sy, a * 2 + 1, 1).fillRect(sx, sy - a, 1, a * 2 + 1);
        }
      };
      const sc = this.scene;
      const onUpdate = (time: number) => this.active && this.visible && draw(time);
      sc.events.on('update', onUpdate);
      this.once('destroy', () => sc.events.off('update', onUpdate));
    }
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
    hitBox(this, -this.w / 2, -this.h / 2, this.w, this.h);
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
