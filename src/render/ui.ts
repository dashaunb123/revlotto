// Pixel UI kit shared by every scene. Owned by the shop/menus agent; others may use it freely.
// Stable API (used by other scenes): txt, panel, button. Everything else is additive.
import Phaser from 'phaser';
import { FONT, GAME_H, GAME_W, PAL, hex } from './palette';

export type TextSize = 8 | 16 | 24 | 32;

export function txt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  str: string,
  size: TextSize = 8,
  color: number = PAL.ink,
  origin: [number, number] = [0, 0],
): Phaser.GameObjects.Text {
  return scene.add
    .text(Math.round(x), Math.round(y), str, { fontFamily: FONT, fontSize: `${size}px`, color: hex(color), resolution: 1 })
    .setOrigin(origin[0], origin[1]);
}

/** Text with a 1px (or 2px for big sizes) hard drop shadow baked in. */
export function shadowTxt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  str: string,
  size: TextSize = 8,
  color: number = PAL.ink,
  origin: [number, number] = [0, 0],
): Phaser.GameObjects.Text {
  const t = txt(scene, x, y, str, size, color, origin);
  const d = size >= 24 ? 2 : 1;
  t.setShadow(d, d, hex(PAL.bgDeep), 0, false, true);
  return t;
}

/** Chunky bevelled panel. */
export function panel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: number = PAL.panel,
  edge: number = PAL.panelEdge,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  drawPanel(g, x, y, w, h, fill, edge);
  return g;
}

export function drawPanel(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: number = PAL.panel,
  edge: number = PAL.panelEdge,
) {
  g.fillStyle(PAL.bgDeep, 1).fillRect(x + 2, y + 2, w, h); // drop shadow
  g.fillStyle(edge, 1).fillRect(x, y, w, h);
  g.fillStyle(fill, 1).fillRect(x + 2, y + 2, w - 4, h - 4);
  g.fillStyle(0xffffff, 0.06).fillRect(x + 2, y + 2, w - 4, 1);
}

export interface Button {
  container: Phaser.GameObjects.Container;
  setEnabled(on: boolean): void;
  setLabel(s: string): void;
}

/**
 * Make a container clickable over the local box (x, y, w, h).
 * Phaser adds a sized container's displayOrigin (half its size) to the local pointer position
 * before testing the hit area, so the rectangle has to be shifted by the same amount.
 */
export function hitBox(c: Phaser.GameObjects.Container, x: number, y: number, w: number, h: number): void {
  c.setInteractive(
    new Phaser.Geom.Rectangle(x + c.displayOriginX, y + c.displayOriginY, w, h),
    Phaser.Geom.Rectangle.Contains,
  );
}

export function button(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  onClick: () => void,
  color: number = PAL.red,
  size: TextSize = 8,
): Button {
  const c = scene.add.container(Math.round(x), Math.round(y));
  const g = scene.add.graphics();
  const t = txt(scene, w / 2, h / 2, label, size, PAL.ink, [0.5, 0.5]);
  t.setAlign('center').setLineSpacing(4);
  t.setShadow(1, 1, hex(PAL.bgDeep), 0, false, true);
  let enabled = true;
  let hover = false;
  let down = false;
  const draw = () => {
    g.clear();
    const fill = enabled ? color : PAL.panelLight;
    const lift = down && enabled ? 1 : hover && enabled ? -1 : 0;
    g.fillStyle(PAL.bgDeep, 1).fillRect(0, 2, w, h);
    g.fillStyle(fill, 1).fillRect(0, lift, w, h);
    g.fillStyle(0xffffff, hover && enabled ? 0.3 : 0.18).fillRect(0, lift, w, 2);
    g.fillStyle(0x000000, 0.2).fillRect(0, lift + h - 2, w, 2);
    t.setY(Math.round(h / 2 + lift));
    t.setAlpha(enabled ? 1 : 0.5);
  };
  c.add([g, t]);
  c.setSize(w, h);
  hitBox(c, 0, 0, w, h);
  c.on('pointerover', () => {
    hover = true;
    draw();
    if (enabled) sfx('hover');
  });
  c.on('pointerout', () => ((hover = false), (down = false), draw()));
  c.on('pointerdown', () => ((down = true), draw()));
  c.on('pointerup', () => {
    const was = down;
    down = false;
    draw();
    if (enabled && was) {
      sfx('click');
      onClick();
    } else if (!enabled && was) sfx('error');
  });
  if (c.input) c.input.cursor = 'pointer';
  draw();
  return {
    container: c,
    setEnabled(on) {
      enabled = on;
      draw();
    },
    setLabel(s) {
      t.setText(s);
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Text helpers

/** Hard-wrap to `max` chars per line, breaking words longer than a line with a hyphen. */
export function wrap(str: string, max: number, maxLines = 99): string {
  const words = str.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (let w of words) {
    while (w.length > max) {
      if (cur) {
        lines.push(cur);
        cur = '';
      }
      lines.push(w.slice(0, max - 1) + '-');
      w = w.slice(max - 1);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= max) cur += ' ' + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    const last = cut[maxLines - 1];
    cut[maxLines - 1] = (last.length >= max ? last.slice(0, max - 1) : last) + '.';
    return cut.join('\n');
  }
  return lines.join('\n');
}

export const money = (n: number) => `$${Math.round(n)}`;

// ---------------------------------------------------------------------------------------------
// Juice

/** Scale "thunk": quick overshoot pop. Keeps the target's resting scale. */
export function pop(scene: Phaser.Scene, target: Phaser.GameObjects.Components.Transform & Phaser.GameObjects.GameObject, amount = 1.25, ms = 220) {
  const base = (target as any).__baseScale ?? target.scaleX;
  (target as any).__baseScale = base;
  scene.tweens.killTweensOf(target);
  target.setScale(base * amount);
  scene.tweens.add({ targets: target, scaleX: base, scaleY: base, duration: ms, ease: 'Back.easeOut' });
}

/** Horizontal error shake. */
export function shake(scene: Phaser.Scene, target: Phaser.GameObjects.Components.Transform, amp = 3, ms = 260) {
  const x0 = (target as any).__shakeX ?? target.x;
  (target as any).__shakeX = x0;
  scene.tweens.add({
    targets: target,
    x: { from: x0 - amp, to: x0 + amp },
    duration: 40,
    yoyo: true,
    repeat: Math.max(1, Math.floor(ms / 80) - 1),
    onComplete: () => {
      target.x = x0;
      (target as any).__shakeX = undefined;
    },
  });
}

/** Count a text up/down to a number with a pop. */
export function tickNumber(
  scene: Phaser.Scene,
  t: Phaser.GameObjects.Text,
  from: number,
  to: number,
  fmt: (n: number) => string,
  ms = 350,
) {
  const o = { v: from };
  scene.tweens.add({
    targets: o,
    v: to,
    duration: ms,
    ease: 'Cubic.easeOut',
    onUpdate: () => t.setText(fmt(Math.round(o.v))),
    onComplete: () => t.setText(fmt(to)),
  });
  pop(scene, t, to > from ? 1.3 : 0.85, 260);
}

/** Floating text that rises and fades (e.g. "-$6", "+15%"). */
export function floatText(scene: Phaser.Scene, x: number, y: number, str: string, color: number = PAL.yellow, size: TextSize = 8) {
  const t = shadowTxt(scene, x, y, str, size, color, [0.5, 0.5]).setDepth(1200);
  scene.tweens.add({ targets: t, y: y - 18, alpha: { from: 1, to: 0 }, duration: 800, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  return t;
}

/** Pixel particle burst. */
export function burst(scene: Phaser.Scene, x: number, y: number, colors: number[], count = 18, speed = 90, depth = 1100) {
  if (!scene.textures.exists('px')) return;
  for (let i = 0; i < count; i++) {
    const p = scene.add.image(x, y, 'px').setTint(colors[i % colors.length]).setDepth(depth);
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random() * 0.8);
    const sz = Math.random() < 0.3 ? 2 : 1;
    p.setScale(sz);
    scene.tweens.add({
      targets: p,
      x: x + Math.cos(a) * s * 0.6,
      y: y + Math.sin(a) * s * 0.6 + 10,
      alpha: 0,
      duration: 400 + Math.random() * 400,
      ease: 'Cubic.easeOut',
      onComplete: () => p.destroy(),
    });
  }
}

/** Toast message near the top of the screen. Red by default (errors). */
export function toast(scene: Phaser.Scene, msg: string, color: number = PAL.red, y = 64) {
  const key = '__toast';
  const prev = (scene as any)[key] as Phaser.GameObjects.Container | undefined;
  prev?.destroy();
  const t = txt(scene, 0, 0, wrap(msg.toUpperCase(), 40), 8, PAL.ink, [0.5, 0.5]).setAlign('center').setLineSpacing(3);
  const w = Math.ceil(t.width) + 16;
  const h = Math.ceil(t.height) + 12;
  const g = scene.add.graphics();
  g.fillStyle(PAL.bgDeep, 1).fillRect(-w / 2 + 2, -h / 2 + 2, w, h);
  g.fillStyle(color, 1).fillRect(-w / 2, -h / 2, w, h);
  g.fillStyle(0xffffff, 0.2).fillRect(-w / 2, -h / 2, w, 2);
  const c = scene.add.container(GAME_W / 2, y, [g, t]).setDepth(1300);
  (scene as any)[key] = c;
  c.setScale(0.6);
  scene.tweens.add({ targets: c, scale: 1, duration: 180, ease: 'Back.easeOut' });
  scene.tweens.add({ targets: c, alpha: 0, y: y - 8, delay: 1600, duration: 300, onComplete: () => c.destroy() });
  if (color === PAL.red) sfx('error');
}

/**
 * Gold "UNLOCKED" banner that slams in, sparkles and floats away. Several names queue one after
 * another. Returns the total ms it takes so callers can sync a sound per name via onEach.
 */
export function unlockToast(scene: Phaser.Scene, names: string[], x = GAME_W / 2, y = 64, onEach?: (i: number) => void): number {
  const STEP = 1250;
  names.forEach((name, i) => {
    scene.time.delayedCall(i * STEP, () => {
      const head = txt(scene, 0, -7, 'UNLOCKED!', 8, PAL.bgDeep, [0.5, 0.5]);
      const t = txt(scene, 0, 6, name.toUpperCase().slice(0, 28), 8, PAL.ink, [0.5, 0.5]);
      t.setShadow(1, 1, hex(PAL.bgDeep), 0, false, true);
      const w = Math.max(Math.ceil(t.width), 72) + 24;
      const h = 30;
      const g = scene.add.graphics();
      g.fillStyle(PAL.bgDeep, 1).fillRect(-w / 2 + 3, -h / 2 + 3, w, h);
      g.fillStyle(PAL.yellow, 1).fillRect(-w / 2, -h / 2, w, h);
      g.fillStyle(PAL.orange, 1).fillRect(-w / 2 + 2, -1, w - 4, h / 2 - 1);
      g.fillStyle(0xffffff, 0.35).fillRect(-w / 2, -h / 2, w, 2);
      // little stars at both ends
      for (const sx of [-w / 2 + 8, w / 2 - 8]) g.fillStyle(PAL.ink, 1).fillRect(sx - 1, -8, 2, 6).fillRect(sx - 3, -6, 6, 2);
      const c = scene.add.container(Math.round(x), Math.round(y), [g, head, t]).setDepth(1300);
      c.setScale(2.2).setAlpha(0);
      scene.tweens.add({ targets: c, scale: 1, alpha: 1, duration: 260, ease: 'Back.easeOut' });
      scene.time.delayedCall(180, () => {
        burst(scene, x, y, [PAL.yellow, PAL.ink, PAL.orange], 26, 140, 1310);
        scene.cameras.main.shake(90, 0.003);
      });
      scene.tweens.add({ targets: head, alpha: 0.4, yoyo: true, repeat: 4, duration: 160, delay: 260 });
      scene.tweens.add({ targets: c, alpha: 0, y: y - 12, delay: STEP - 260, duration: 240, onComplete: () => c.destroy() });
      onEach?.(i);
    });
  });
  return names.length * STEP;
}

// ---------------------------------------------------------------------------------------------
// Tooltip (one per scene)

export type TipLine = string | { t: string; c?: number };

export class Tooltip {
  private c: Phaser.GameObjects.Container;
  private g: Phaser.GameObjects.Graphics;
  private texts: Phaser.GameObjects.Text[] = [];
  owner: unknown = null;

  constructor(private scene: Phaser.Scene) {
    this.g = scene.add.graphics();
    this.c = scene.add.container(0, 0, [this.g]).setDepth(1000).setVisible(false);
  }

  /** Show a tooltip anchored next to a rect (x,y,w,h) in screen space; it picks the side with room. */
  show(anchor: { x: number; y: number; w: number; h: number }, title: string, titleColor: number, lines: TipLine[], owner?: unknown) {
    this.owner = owner ?? null;
    for (const t of this.texts) t.destroy();
    this.texts = [];
    const W = 168;
    const maxChars = Math.floor((W - 12) / 8);
    let y = 6;
    const head = txt(this.scene, 6, y, wrap(title.toUpperCase(), maxChars), 8, titleColor).setLineSpacing(3);
    this.texts.push(head);
    y += Math.ceil(head.height) + 6;
    for (const ln of lines) {
      const o = typeof ln === 'string' ? { t: ln } : ln;
      if (o.t === '') {
        y += 4;
        continue;
      }
      const t = txt(this.scene, 6, y, wrap(o.t, maxChars), 8, o.c ?? PAL.ink).setLineSpacing(3);
      this.texts.push(t);
      y += Math.ceil(t.height) + 4;
    }
    const H = y + 2;
    this.g.clear();
    this.g.fillStyle(PAL.bgDeep, 0.9).fillRect(3, 3, W, H);
    this.g.fillStyle(titleColor, 1).fillRect(0, 0, W, H);
    this.g.fillStyle(PAL.bgDeep, 1).fillRect(2, 2, W - 4, H - 4);
    this.g.fillStyle(titleColor, 0.25).fillRect(2, 2, W - 4, Math.ceil(head.height) + 8);
    this.c.add(this.texts);
    // placement: prefer right of anchor, else left, else below/above
    let x = anchor.x + anchor.w + 6;
    let yy = anchor.y;
    if (x + W > GAME_W - 2) x = anchor.x - W - 6;
    if (x < 2) {
      x = Phaser.Math.Clamp(anchor.x + anchor.w / 2 - W / 2, 2, GAME_W - W - 2);
      yy = anchor.y + anchor.h + 6;
      if (yy + H > GAME_H - 2) yy = anchor.y - H - 6;
    }
    yy = Phaser.Math.Clamp(yy, 2, GAME_H - H - 2);
    this.c.setPosition(Math.round(x), Math.round(yy)).setVisible(true).setAlpha(0);
    this.scene.tweens.killTweensOf(this.c);
    this.scene.tweens.add({ targets: this.c, alpha: 1, duration: 90 });
  }

  hide(owner?: unknown) {
    if (owner !== undefined && owner !== this.owner) return;
    this.owner = null;
    this.c.setVisible(false);
  }
}

// ---------------------------------------------------------------------------------------------
// Context menu: small stack of chunky buttons that closes when clicking elsewhere.

export interface MenuItem {
  label: string;
  color?: number;
  enabled?: boolean;
  onClick: () => void;
}

export function contextMenu(scene: Phaser.Scene, x: number, y: number, items: MenuItem[]): Phaser.GameObjects.Container {
  const key = '__ctxmenu';
  ((scene as any)[key] as Phaser.GameObjects.Container | undefined)?.destroy();
  const W = Math.max(64, ...items.map((i) => i.label.length * 8 + 12));
  const BH = 16;
  const H = items.length * (BH + 4) + 4;
  const px = Phaser.Math.Clamp(Math.round(x), 2, GAME_W - W - 6);
  const py = Phaser.Math.Clamp(Math.round(y), 2, GAME_H - H - 4);
  const c = scene.add.container(px, py).setDepth(900);
  // full-screen catcher closes the menu
  const catcher = scene.add.zone(-px, -py, GAME_W, GAME_H).setOrigin(0, 0).setInteractive();
  catcher.on('pointerdown', () => close());
  const bg = scene.add.graphics();
  drawPanel(bg, 0, 0, W + 4, H, PAL.bgDeep, PAL.panelEdge);
  c.add([catcher, bg]);
  items.forEach((it, i) => {
    const b = button(scene, 2, 2 + i * (BH + 4) + 1, W, BH, it.label, () => {
      close();
      it.onClick();
    }, it.color ?? PAL.panelLight);
    b.setEnabled(it.enabled !== false);
    c.add(b.container);
  });
  const close = () => {
    if ((scene as any)[key] === c) (scene as any)[key] = undefined;
    c.destroy();
  };
  (scene as any)[key] = c;
  c.setScale(0.8);
  scene.tweens.add({ targets: c, scale: 1, duration: 120, ease: 'Back.easeOut' });
  return c;
}

export function closeContextMenu(scene: Phaser.Scene) {
  ((scene as any).__ctxmenu as Phaser.GameObjects.Container | undefined)?.destroy();
  (scene as any).__ctxmenu = undefined;
}

// ---------------------------------------------------------------------------------------------
// Hover tilt: card leans toward the pointer and lifts. The container's origin must be its center.

export function hoverTilt(scene: Phaser.Scene, c: Phaser.GameObjects.Container, w: number, h: number, lift = 1.08) {
  const baseY = c.y;
  let over = false;
  c.on('pointerover', () => {
    over = true;
    scene.tweens.add({ targets: c, scale: lift, y: baseY - 3, duration: 120, ease: 'Back.easeOut' });
  });
  c.on('pointermove', (p: Phaser.Input.Pointer) => {
    if (!over) return;
    const dx = Phaser.Math.Clamp((p.x - c.x) / (w / 2), -1, 1);
    const dy = Phaser.Math.Clamp((p.y - c.y) / (h / 2), -1, 1);
    c.angle = dx * 5 - dy * dx * 2;
  });
  c.on('pointerout', () => {
    over = false;
    scene.tweens.add({ targets: c, scale: 1, y: baseY, angle: 0, duration: 160, ease: 'Cubic.easeOut' });
  });
}

// ---------------------------------------------------------------------------------------------
// Tiny WebAudio blips (no assets). They play through audio.ts's shared context + master, so M mutes them too.
// (Import kept in this section on purpose: this block is owned by the audio pass.)
import { audioOut } from './audio';

let bus: GainNode | null = null; // x4.5 so blips keep their old loudness under the 0.22 master
let lastHover = 0;
export type Sfx = 'hover' | 'click' | 'buy' | 'error' | 'cash' | 'pack' | 'flip' | 'pick' | 'sell' | 'reroll' | 'fanfare';

function tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number) {
  const a = audioOut();
  if (!a) return;
  const actx = a.ctx;
  if (!bus || bus.context !== actx) {
    bus = actx.createGain();
    bus.gain.value = 4.5;
    bus.connect(a.out);
  }
  const t0 = actx.currentTime + delay;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(bus);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
  o.onended = () => {
    o.disconnect();
    g.disconnect();
  };
}

export function sfx(kind: Sfx) {
  try {
    switch (kind) {
      case 'hover': {
        const now = performance.now();
        if (now - lastHover < 40) return;
        lastHover = now;
        tone(1400, 0.03, 'square', 0.015);
        break;
      }
      case 'click':
        tone(700, 0.05, 'square', 0.04);
        break;
      case 'buy':
        tone(220, 0.08, 'square', 0.06, 0, 110);
        tone(880, 0.06, 'square', 0.04, 0.05);
        tone(1320, 0.08, 'square', 0.04, 0.1);
        break;
      case 'cash':
        tone(1046, 0.05, 'square', 0.03);
        tone(1568, 0.08, 'square', 0.03, 0.05);
        break;
      case 'sell':
        tone(660, 0.06, 'triangle', 0.06);
        tone(990, 0.08, 'triangle', 0.05, 0.06);
        break;
      case 'error':
        tone(140, 0.14, 'sawtooth', 0.05);
        break;
      case 'pack':
        tone(80, 0.3, 'sawtooth', 0.06, 0, 400);
        tone(1200, 0.15, 'square', 0.03, 0.25, 2400);
        break;
      case 'flip':
        tone(500, 0.04, 'triangle', 0.05, 0, 900);
        break;
      case 'pick':
        tone(660, 0.07, 'square', 0.04);
        tone(880, 0.07, 'square', 0.04, 0.07);
        tone(1320, 0.12, 'square', 0.04, 0.14);
        break;
      case 'reroll':
        for (let i = 0; i < 4; i++) tone(400 + i * 150, 0.04, 'square', 0.03, i * 0.04);
        break;
      case 'fanfare':
        [523, 659, 784, 1046, 784, 1046].forEach((f, i) => tone(f, 0.16, 'square', 0.04, i * 0.12));
        break;
    }
  } catch {
    /* audio is optional */
  }
}

// ---------------------------------------------------------------------------------------------
// Content-expansion bits: heat badge, padlock, round labels, tag / garage icon lookup.

export const HEAT_COLORS = [PAL.inkDim, PAL.yellow, PAL.yellow, PAL.orange, PAL.orange, PAL.red, PAL.red, PAL.pink, PAL.purple];
export const heatColor = (h: number) => HEAT_COLORS[Phaser.Math.Clamp(Math.round(h), 0, HEAT_COLORS.length - 1)];

/** Tiny 7x9 flame. */
export function drawFlame(g: Phaser.GameObjects.Graphics, x: number, y: number, col: number) {
  g.fillStyle(col, 1).fillRect(x + 3, y, 1, 2).fillRect(x + 2, y + 2, 3, 2).fillRect(x + 1, y + 4, 5, 3).fillRect(x + 2, y + 7, 3, 2);
  g.fillStyle(PAL.yellow, 1).fillRect(x + 3, y + 5, 1, 3);
}

/** "HEAT 3" chip with a flame. origin 0 = left edge at x, 1 = right edge at x. Box is 12 tall, centered on y. */
export function heatBadge(scene: Phaser.Scene, x: number, y: number, heat: number, originX: 0 | 0.5 | 1 = 0): Phaser.GameObjects.Container {
  const col = heatColor(heat);
  const label = `HEAT ${heat}`;
  const w = label.length * 8 + 18;
  const g = scene.add.graphics();
  g.fillStyle(PAL.bgDeep, 1).fillRect(1, -5, w, 12);
  g.fillStyle(col, 1).fillRect(0, -6, w, 12);
  g.fillStyle(PAL.bgDeep, 1).fillRect(1, -5, 11, 10);
  drawFlame(g, 3, -5, heat >= 5 ? PAL.red : PAL.orange);
  g.fillStyle(0xffffff, 0.3).fillRect(0, -6, w, 1);
  const t = txt(scene, 14, 0, label, 8, PAL.bgDeep, [0, 0.5]);
  const c = scene.add.container(Math.round(x - w * originX), Math.round(y), [g, t]);
  c.setSize(w, 12);
  c.setData('w', w);
  return c;
}

/** Padlock, about 12x14, top-left at (x, y). */
export function drawLock(g: Phaser.GameObjects.Graphics, x: number, y: number, col: number = PAL.inkDim, s = 1) {
  g.fillStyle(col, 1);
  g.fillRect(x + 3 * s, y, 6 * s, 2 * s).fillRect(x + 2 * s, y + 1 * s, 2 * s, 5 * s).fillRect(x + 8 * s, y + 1 * s, 2 * s, 5 * s);
  g.fillRect(x, y + 6 * s, 12 * s, 8 * s);
  g.fillStyle(PAL.bgDeep, 1).fillRect(x + 5 * s, y + 8 * s, 2 * s, 4 * s);
}

/** 'ROUND 6' plus an ENDLESS marker past the final round. */
export const roundLabel = (round: number) => (round > 4 ? `ENDLESS ROUND ${round}` : `ROUND ${round}`);

function iconKey(scene: Phaser.Scene, prefix: string, id: string): string {
  const slug = id.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  for (const k of [id, slug]) if (scene.textures.exists(`${prefix}_${k}`)) return `${prefix}_${k}`;
  if (scene.textures.exists(`${prefix}_generic`)) return `${prefix}_generic`;
  return 'pas_generic';
}
export const tagIconKey = (scene: Phaser.Scene, id: string) => iconKey(scene, 'tag', id);
export const garageIconKey = (scene: Phaser.Scene, id: string) => iconKey(scene, 'gar', id);
