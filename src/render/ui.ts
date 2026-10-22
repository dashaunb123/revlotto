// Minimal pixel UI kit shared by every scene. Owned by the shop/menus agent; others may use it freely.
import Phaser from 'phaser';
import { FONT, PAL, hex } from './palette';

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
    .text(x, y, str, { fontFamily: FONT, fontSize: `${size}px`, color: hex(color), resolution: 1 })
    .setOrigin(origin[0], origin[1]);
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
  g.fillStyle(PAL.bgDeep, 1).fillRect(x + 2, y + 2, w, h); // drop shadow
  g.fillStyle(edge, 1).fillRect(x, y, w, h);
  g.fillStyle(fill, 1).fillRect(x + 2, y + 2, w - 4, h - 4);
  return g;
}

export interface Button {
  container: Phaser.GameObjects.Container;
  setEnabled(on: boolean): void;
  setLabel(s: string): void;
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
): Button {
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  const t = txt(scene, w / 2, h / 2, label, 8, PAL.ink, [0.5, 0.5]);
  let enabled = true;
  let hover = false;
  const draw = () => {
    g.clear();
    const fill = enabled ? color : PAL.panelLight;
    const lift = hover && enabled ? -1 : 0;
    g.fillStyle(PAL.bgDeep, 1).fillRect(0, 2, w, h);
    g.fillStyle(fill, 1).fillRect(0, lift, w, h);
    g.fillStyle(0xffffff, 0.18).fillRect(0, lift, w, 2);
    t.setY(h / 2 + lift);
    t.setAlpha(enabled ? 1 : 0.5);
  };
  c.add([g, t]);
  c.setSize(w, h);
  c.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
  c.on('pointerover', () => ((hover = true), draw()));
  c.on('pointerout', () => ((hover = false), draw()));
  c.on('pointerup', () => enabled && onClick());
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
