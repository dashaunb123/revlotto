// Booster pack opening: the pack drops in, shakes, bursts, three cards fan out and flip.
// Covers y >= TOP only, so the passives/consumables band above stays usable for making room.
//
//   y 120 ............................................ scrim top (inventory band stays live above)
//   y 130  "PARTS PACK" (16px)       y 150 "CHOOSE 1 OF 3" / red hint
//   cards 84x112 centered at x 180 / 320 / 460, y 214   (158..270)
//   y 280..322  short description under each card (16 chars x 4 lines)
//   SKIP button (280, 330, 80, 20)
import Phaser from 'phaser';
import type { PackCard, PackKind } from '../../core/types';
import { GAME_W, PAL } from '../palette';
import { Tooltip, burst, button, shadowTxt, sfx, shake, txt, wrap, type Button } from '../ui';
import { Card } from './card';
import { packCardCard } from './factory';
import { packCardTip, shortDesc } from './describe';

export const OVERLAY_TOP = 120;
const CARD_X = [180, 320, 460];
const CARD_Y = 214;
const DEPTH = 50;

export class PackOverlay {
  readonly sig: string;
  private objs: Phaser.GameObjects.GameObject[] = [];
  private cards: Card[] = [];
  private descs: Phaser.GameObjects.Text[] = [];
  private hint!: Phaser.GameObjects.Text;
  private skipBtn!: Button;
  private ready = false;
  private closed = false;

  constructor(
    private scene: Phaser.Scene,
    private tip: Tooltip,
    kind: PackKind,
    private packCards: PackCard[],
    from: { x: number; y: number } | null,
    private onPick: (i: number) => void,
    private onSkip: () => void,
  ) {
    this.sig = JSON.stringify({ kind, packCards });
    const s = scene;
    const scrim = s.add.rectangle(0, OVERLAY_TOP, GAME_W, 360 - OVERLAY_TOP, PAL.bgDeep, 0.88).setOrigin(0, 0).setDepth(DEPTH);
    scrim.setInteractive(); // eat clicks to the shop below
    const edge = s.add.rectangle(0, OVERLAY_TOP, GAME_W, 2, kind === 'parts' ? PAL.orange : PAL.purple).setOrigin(0, 0).setDepth(DEPTH);
    const title = shadowTxt(s, 320, 132, kind === 'parts' ? 'PARTS PACK' : 'POWER PACK', 16, kind === 'parts' ? PAL.orange : PAL.pink, [0.5, 0]).setDepth(DEPTH + 1);
    this.hint = txt(s, 320, 152, 'CHOOSE 1 OF 3', 8, PAL.inkDim, [0.5, 0]).setDepth(DEPTH + 1);
    this.skipBtn = button(s, 280, 330, 80, 20, 'SKIP', () => this.ready && this.onSkip(), PAL.panelLight);
    this.skipBtn.container.setDepth(DEPTH + 1).setVisible(false);
    this.objs.push(scrim, edge, title, this.hint, this.skipBtn.container);
    scrim.setAlpha(0);
    s.tweens.add({ targets: scrim, alpha: 1, duration: 150 });

    if (from) this.openAnim(kind, from);
    else this.dealCards(false);
  }

  private openAnim(kind: PackKind, from: { x: number; y: number }) {
    const s = this.scene;
    const pack = s.add.image(from.x, from.y, kind === 'parts' ? 'pack_parts' : 'pack_power').setDepth(DEPTH + 2);
    this.objs.push(pack);
    s.tweens.add({
      targets: pack,
      x: 320,
      y: CARD_Y,
      scale: 2,
      duration: 280,
      ease: 'Back.easeOut',
      onComplete: () => {
        sfx('pack');
        s.tweens.add({
          targets: pack,
          angle: { from: -7, to: 7 },
          duration: 55,
          yoyo: true,
          repeat: 5,
          onComplete: () => {
            s.tweens.add({
              targets: pack,
              scale: 2.4,
              duration: 90,
              onComplete: () => {
                const flash = s.add.rectangle(0, OVERLAY_TOP, GAME_W, 360 - OVERLAY_TOP, 0xffffff, 0.9).setOrigin(0, 0).setDepth(DEPTH + 3);
                s.tweens.add({ targets: flash, alpha: 0, duration: 260, onComplete: () => flash.destroy() });
                const cols = kind === 'parts' ? [PAL.orange, PAL.yellow, PAL.ink] : [PAL.purple, PAL.pink, PAL.ink];
                burst(s, 320, CARD_Y, cols, 40, 220, DEPTH + 4);
                s.cameras.main.shake(120, 0.004);
                pack.destroy();
                this.dealCards(true);
              },
            });
          },
        });
      },
    });
  }

  private dealCards(animate: boolean) {
    const s = this.scene;
    this.packCards.forEach((pc, i) => {
      const c = packCardCard(s, animate ? 320 : CARD_X[i], CARD_Y, pc).setDepth(DEPTH + 2);
      this.cards.push(c);
      const d = txt(s, CARD_X[i], 282, wrap(shortDesc(pc).toUpperCase(), 16, 4), 8, PAL.ink, [0.5, 0])
        .setAlign('center')
        .setLineSpacing(3)
        .setDepth(DEPTH + 1);
      this.descs.push(d);
      if (animate) {
        c.showBack(true).setScale(0.6).setAngle((i - 1) * 14);
        d.setAlpha(0);
        s.tweens.add({
          targets: c,
          x: CARD_X[i],
          scale: 1,
          angle: (i - 1) * 4,
          delay: i * 70,
          duration: 300,
          ease: 'Back.easeOut',
          onComplete: () => {
            s.tweens.add({ targets: c, angle: 0, duration: 200 });
            c.flipIn(80 + i * 140, 260, () => sfx('flip'));
            s.tweens.add({ targets: d, alpha: 1, delay: 200 + i * 140, duration: 200 });
            if (i === this.packCards.length - 1) s.time.delayedCall(260 + i * 140 + 300, () => this.arm());
          },
        });
      }
    });
    if (!animate) this.arm();
  }

  private arm() {
    if (this.closed) return;
    this.ready = true;
    this.skipBtn.container.setVisible(true);
    this.cards.forEach((c, i) => {
      c.makeInteractive();
      const baseY = c.y;
      c.on('pointerover', () => {
        sfx('hover');
        const t = packCardTip(this.packCards[i]);
        this.tip.show(c.rect(), t.title, t.color, t.lines, c);
        this.scene.tweens.add({ targets: c, scale: 1.1, y: baseY - 4, duration: 120, ease: 'Back.easeOut' });
      });
      c.on('pointermove', (p: Phaser.Input.Pointer) => {
        c.angle = Phaser.Math.Clamp((p.x - c.x) / (c.w / 2), -1, 1) * 6;
      });
      c.on('pointerout', () => {
        this.tip.hide(c);
        this.scene.tweens.add({ targets: c, scale: 1, y: baseY, angle: 0, duration: 150 });
      });
      c.on('pointerup', () => this.ready && this.onPick(i));
    });
  }

  /** Pick refused (slots full etc): shake, show the reason, keep the pack open. */
  failPick(i: number, reason: string) {
    const c = this.cards[i];
    if (c) shake(this.scene, c, 4);
    sfx('error');
    const full = /full/i.test(reason);
    this.hint.setText((reason + (full ? ' (ABOVE)' : '')).toUpperCase()).setColor('#e8413c');
    shake(this.scene, this.hint, 3);
  }

  /** Close. If `picked` is set, that card flies to `target` (screen coords) and the rest drop away. */
  close(picked: number | null, target: { x: number; y: number } | null, onLanded?: () => void) {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    this.tip.hide();
    const s = this.scene;
    this.cards.forEach((c, i) => {
      c.disableInteractive();
      if (i === picked) {
        sfx('pick');
        burst(s, c.x, c.y, [PAL.yellow, PAL.ink, PAL.green], 24, 140, DEPTH + 5);
        c.setDepth(1100);
        s.tweens.add({
          targets: c,
          scale: 1.25,
          duration: 120,
          ease: 'Quad.easeOut',
          onComplete: () =>
            s.tweens.add({
              targets: c,
              x: target?.x ?? c.x,
              y: target?.y ?? c.y - 120,
              scale: 0.35,
              alpha: 0.2,
              duration: 320,
              ease: 'Cubic.easeIn',
              onComplete: () => {
                c.destroy();
                onLanded?.();
              },
            }),
        });
      } else {
        s.tweens.add({ targets: c, y: c.y + 220, angle: (i - 1) * 25, alpha: 0, delay: i * 40, duration: 380, ease: 'Cubic.easeIn', onComplete: () => c.destroy() });
      }
    });
    for (const d of this.descs) s.tweens.add({ targets: d, alpha: 0, duration: 150, onComplete: () => d.destroy() });
    for (const o of this.objs) {
      s.tweens.add({ targets: o, alpha: 0, duration: 220, delay: 120, onComplete: () => o.destroy() });
    }
  }
}
