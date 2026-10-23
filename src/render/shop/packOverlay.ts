// Booster pack opening: the pack drops in, shakes, bursts, three cards fan out and flip.
// Covers y >= TOP only, so the passives/consumables band above stays usable for making room.
//
//   y 120 ............................................ scrim top (inventory band stays live above)
//   y 130  "PARTS PACK" (16px)       y 150 "CHOOSE 1 OF 3" / red hint
//   cards 84x112 centered at x 180 / 320 / 460 (4 cards: 110..530, pitch 140), y 218   (162..274)
//   Pack Rat: picksLeft > 1 keeps the overlay open; the picked card flies off and the rest close ranks.
//   y 280..322  short description under each card (16 chars x 4 lines)
//   SKIP button (280, 330, 80, 20)
import Phaser from 'phaser';
import type { InstalledPart, PackCard, PackKind, SlotId } from '../../core/types';
import { GAME_H, GAME_W, PAL, hex } from '../palette';
import { Tooltip, burst, button, shadowTxt, sfx, shake, txt, wrap, type Button } from '../ui';
import { Card } from './card';
import { brandInfo, brandLogoKey, packCardCard, paragonOf } from './factory';
import { paragonAbility } from '../../game/effects';
import { carVisualFromParts, makeCar, type CarLook, type CarSprite } from '../car';
import { sfx as audio } from '../audio';
import { packCardTip, shortDesc } from './describe';

export const OVERLAY_TOP = 120;
const cardX = (i: number, n: number) => Math.round(320 + (i - (n - 1) / 2) * Math.min(140, 560 / Math.max(1, n)));
const CARD_Y = 218;
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
    private picksLeft: number,
    private onPick: (i: number) => void,
    private onSkip: () => void,
  ) {
    this.sig = JSON.stringify({ kind, packCards });
    const s = scene;
    const scrim = s.add.rectangle(0, OVERLAY_TOP, GAME_W, 360 - OVERLAY_TOP, PAL.bgDeep, 0.88).setOrigin(0, 0).setDepth(DEPTH);
    scrim.setInteractive(); // eat clicks to the shop below
    const edge = s.add.rectangle(0, OVERLAY_TOP, GAME_W, 2, kind === 'parts' ? PAL.orange : PAL.purple).setOrigin(0, 0).setDepth(DEPTH);
    const title = shadowTxt(s, 320, 132, kind === 'parts' ? 'PARTS PACK' : 'POWER PACK', 16, kind === 'parts' ? PAL.orange : PAL.pink, [0.5, 0]).setDepth(DEPTH + 1);
    this.hint = txt(s, 320, 152, this.hintText(), 8, PAL.inkDim, [0.5, 0]).setDepth(DEPTH + 1);
    this.skipBtn = button(s, 280, 330, 80, 20, 'SKIP', () => this.ready && this.onSkip(), PAL.panelLight);
    this.skipBtn.container.setDepth(DEPTH + 1).setVisible(false);
    this.objs.push(scrim, edge, title, this.hint, this.skipBtn.container);
    scrim.setAlpha(0);
    s.tweens.add({ targets: scrim, alpha: 1, duration: 150 });

    if (from) this.openAnim(kind, from);
    else this.dealCards(false);
  }

  private hintText() {
    return this.picksLeft > 1 ? `CHOOSE ${this.picksLeft} OF ${this.packCards.length}` : `CHOOSE 1 OF ${this.packCards.length}`;
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
    const n = this.packCards.length;
    this.packCards.forEach((pc, i) => {
      const c = packCardCard(s, animate ? 320 : cardX(i, n), CARD_Y, pc).setDepth(DEPTH + 2);
      this.cards.push(c);
      const d = txt(s, cardX(i, n), 282, wrap(shortDesc(pc).toUpperCase(), 16, 4), 8, PAL.ink, [0.5, 0])
        .setAlign('center')
        .setLineSpacing(3)
        .setDepth(DEPTH + 1);
      this.descs.push(d);
      if (animate) {
        c.showBack(true).setScale(0.6).setAngle((i - 1) * 14);
        d.setAlpha(0);
        s.tweens.add({
          targets: c,
          x: cardX(i, n),
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
      for (const ev of ['pointerover', 'pointermove', 'pointerout', 'pointerup']) c.off(ev);
      c.makeInteractive();
      const baseY = CARD_Y;
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

  /**
   * Pack Rat: one card was taken but picks remain. It flies to `target`, the rest slide together and the
   * overlay stays open with the new card list.
   */
  consume(picked: number, target: { x: number; y: number } | null, remaining: PackCard[], picksLeft: number, onLanded?: () => void) {
    const s = this.scene;
    const c = this.cards[picked];
    const d = this.descs[picked];
    this.tip.hide();
    this.cards.splice(picked, 1);
    this.descs.splice(picked, 1);
    this.packCards = remaining;
    this.picksLeft = picksLeft;
    if (c) {
      c.disableInteractive();
      sfx('pick');
      burst(s, c.x, c.y, [PAL.yellow, PAL.ink, PAL.green], 24, 140, DEPTH + 5);
      c.setDepth(1100);
      s.tweens.add({
        targets: c,
        x: target?.x ?? c.x,
        y: target?.y ?? c.y - 120,
        scale: 0.35,
        alpha: 0.2,
        duration: 360,
        ease: 'Cubic.easeIn',
        onComplete: () => {
          c.destroy();
          onLanded?.();
        },
      });
    }
    d?.destroy();
    const n = this.cards.length;
    this.cards.forEach((card, i) => {
      s.tweens.add({ targets: card, x: cardX(i, n), y: CARD_Y, scale: 1, angle: 0, duration: 260, delay: 120, ease: 'Back.easeOut' });
      const dd = this.descs[i];
      if (dd) s.tweens.add({ targets: dd, x: cardX(i, n), duration: 260, delay: 120 });
    });
    this.hint.setText(this.hintText()).setColor('#f7d23e');
    s.tweens.add({ targets: this.hint, scale: { from: 1.4, to: 1 }, duration: 220, ease: 'Back.easeOut' });
    this.arm();
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

// =============================================================================================
// THE TRANSFORM MOMENT (~3.5 s, skippable): the 12th part of a brand just installed.
//   0.00  screen darkens, the garage car flies to centre stage (x3), sfx.paragon(brand) starts (its hit lands at 1.5 s)
//   0.35  car shakes harder and harder, brand-coloured light rays spin up, a white glow swells over it
//   1.50  WHITE-OUT: flash, camera shake, light burst; the paragon car slams in
//   1.65  "PARAGON!" slams down (24px), 1.85 paragon name (16px), 2.05 signature ability + description
//   1.50+ confetti rains;  2.2 "CLICK TO CONTINUE";  3.6 auto fade
// Everything sits at depth 2000+, above the pack overlay and the toasts.

const TF_DEPTH = 2000;
const HIT_MS = 1500;
const STAGE = { x: 320, y: 196 };

export class ParagonTransform {
  private objs: Phaser.GameObjects.GameObject[] = [];
  private timers: Phaser.Time.TimerEvent[] = [];
  private done = false;
  private keyFns: [string, () => void][] = [];
  private updateFn: ((t: number, dt: number) => void) | null = null;

  constructor(
    private scene: Phaser.Scene,
    private brandId: string,
    oldParts: Record<SlotId, InstalledPart>,
    newParts: Record<SlotId, InstalledPart>,
    look: CarLook,
    private onDone: () => void,
  ) {
    const s = scene;
    const b = brandInfo(brandId);
    const col = b?.color ?? PAL.yellow;
    const acc = b?.accent ?? PAL.ink;
    const para = paragonOf(brandId);
    const abil = paragonAbility(para?.ability);
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => (this.objs.push(o), o);
    const at = (ms: number, fn: () => void) => this.timers.push(s.time.delayedCall(ms, () => !this.done && fn()));

    try {
      (audio as unknown as { paragon?: (id: string) => void }).paragon?.(brandId);
    } catch {
      /* audio optional */
    }

    // scrim (also the click-to-skip catcher)
    const scrim = add(s.add.rectangle(0, 0, GAME_W, GAME_H, PAL.bgDeep, 1).setOrigin(0, 0).setDepth(TF_DEPTH).setAlpha(0));
    scrim.setInteractive();
    scrim.on('pointerup', () => this.finish());
    s.tweens.add({ targets: scrim, alpha: 0.92, duration: 260 });

    // spinning light rays behind the car
    const rays = add(s.add.graphics().setDepth(TF_DEPTH + 1).setPosition(STAGE.x, STAGE.y).setAlpha(0));
    const drawRays = (c: number, n = 14) => {
      rays.clear();
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = a0 + Math.PI / n / 1.4;
        rays.fillStyle(i % 2 ? c : 0xffffff, i % 2 ? 0.55 : 0.18);
        rays.fillTriangle(0, 0, Math.cos(a0) * 420, Math.sin(a0) * 420, Math.cos(a1) * 420, Math.sin(a1) * 420);
      }
    };
    drawRays(col);
    s.tweens.add({ targets: rays, alpha: 0.5, duration: HIT_MS, ease: 'Quad.easeIn' });
    s.tweens.add({ targets: rays, angle: 360, duration: 6000, repeat: -1 });

    // swelling glow (concentric squares, pixel style)
    const glow = add(s.add.graphics().setDepth(TF_DEPTH + 2).setPosition(STAGE.x, STAGE.y - 10));
    const drawGlow = (r: number, c: number, a: number) => {
      glow.clear();
      for (let k = 5; k >= 1; k--) {
        const rr = Math.round(r * (k / 5));
        glow.fillStyle(k % 2 ? c : 0xffffff, a * (1 - k / 6)).fillRect(-rr * 1.6, -rr * 0.7, rr * 3.2, rr * 1.4);
      }
    };
    const glowState = { r: 20, a: 0.2 };
    s.tweens.add({ targets: glowState, r: 70, a: 0.9, duration: HIT_MS, ease: 'Quad.easeIn' });

    // the old car flies to centre stage and starts to shake
    let oldCar: CarSprite | null = null;
    try {
      oldCar = add(makeCar(s, 106, 108, carVisualFromParts(oldParts, look), 2).setDepth(TF_DEPTH + 3));
      s.tweens.add({ targets: oldCar, x: STAGE.x, y: STAGE.y, scale: 3, duration: 380, ease: 'Back.easeOut' });
    } catch {
      oldCar = null;
    }
    // white-hot overlay over the car (the car "glows" by being washed out in light)
    const hot = add(s.add.graphics().setDepth(TF_DEPTH + 4).setPosition(STAGE.x, STAGE.y - 14).setAlpha(0));
    hot.fillStyle(0xffffff, 1).fillRect(-90, -26, 180, 52);
    hot.fillStyle(0xffffff, 0.5).fillRect(-104, -32, 208, 64);
    s.tweens.add({ targets: hot, alpha: { from: 0, to: 0.85 }, delay: 700, duration: HIT_MS - 700, ease: 'Expo.easeIn' });

    // brand logo above the car, then it flies apart at the hit
    const lk = brandLogoKey(s, brandId);
    const logo = lk ? add(s.add.image(STAGE.x, 66, lk).setScale(0).setDepth(TF_DEPTH + 5)) : null;
    if (logo) s.tweens.add({ targets: logo, scale: 4, delay: 200, duration: 300, ease: 'Back.easeOut' });

    const shakeState = { amp: 0.5 };
    s.tweens.add({ targets: shakeState, amp: 6, delay: 380, duration: HIT_MS - 380, ease: 'Quad.easeIn' });
    let flick = 0;
    this.updateFn = (_t, dt) => {
      drawGlow(glowState.r, col, glowState.a);
      flick += dt;
      if (oldCar && oldCar.active && this.timers.length && flick > 30) {
        flick = 0;
        const a = shakeState.amp;
        oldCar.x = STAGE.x + Math.round((Math.random() * 2 - 1) * a);
        oldCar.y = STAGE.y + Math.round((Math.random() * 2 - 1) * a * 0.6);
        oldCar.angle = (Math.random() * 2 - 1) * a * 0.4;
      }
    };
    s.events.on('update', this.updateFn);
    // sparks fly off the shaking car
    for (let k = 0; k < 8; k++) at(500 + k * 120, () => burst(s, STAGE.x + (k % 2 ? 50 : -50), STAGE.y - 10, [col, acc, 0xffffff], 8 + k * 2, 70 + k * 12, TF_DEPTH + 6));
    at(450, () => oldCar?.flameBurst?.(900));

    // ---- the hit ----
    at(HIT_MS, () => {
      s.cameras.main.flash(260, 255, 255, 255);
      s.cameras.main.shake(380, 0.018);
      if (oldCar) oldCar.setVisible(false);
      if (logo) s.tweens.add({ targets: logo, scale: 6, alpha: 0, duration: 300 });
      burst(s, STAGE.x, STAGE.y - 10, [0xffffff, col, acc, PAL.yellow], 70, 260, TF_DEPTH + 6);
      burst(s, STAGE.x, STAGE.y - 10, [0xffffff, PAL.yellow], 40, 160, TF_DEPTH + 6);
      drawRays(PAL.yellow, 18);
      rays.setAlpha(0.7);
      s.tweens.add({ targets: rays, alpha: 0.35, duration: 900 });
      s.tweens.add({ targets: hot, alpha: 0, duration: 420, ease: 'Quad.easeOut' });
      s.tweens.add({ targets: glowState, r: 120, a: 0, duration: 600, ease: 'Cubic.easeOut' });
      // light ring blasting outward
      const ring = add(s.add.graphics().setDepth(TF_DEPTH + 6).setPosition(STAGE.x, STAGE.y - 10));
      const rs = { r: 10, a: 1 };
      s.tweens.add({
        targets: rs, r: 340, a: 0, duration: 650, ease: 'Cubic.easeOut',
        onUpdate: () => ring.clear().lineStyle(6, 0xffffff, rs.a).strokeCircle(0, 0, rs.r).lineStyle(3, col, rs.a).strokeCircle(0, 0, rs.r * 0.8),
      });
      try {
        const car = add(makeCar(s, STAGE.x, STAGE.y, carVisualFromParts(newParts, look), 3).setDepth(TF_DEPTH + 3));
        car.setScale(4.6);
        s.tweens.add({ targets: car, scale: 3, duration: 420, ease: 'Back.easeOut' });
        s.tweens.add({ targets: car, y: STAGE.y - 1, duration: 70, yoyo: true, repeat: -1, repeatDelay: 40, delay: 450 });
        car.flameBurst?.(700);
        this.timers.push(s.time.addEvent({ delay: 900, loop: true, callback: () => car.active && car.flameBurst?.(260) }));
      } catch {
        /* car renderer unavailable */
      }
      this.confetti(col, acc);
    });

    // ---- the words ----
    at(HIT_MS + 150, () => {
      const t = add(shadowTxt(s, 320, 52, 'PARAGON!', 24, PAL.yellow, [0.5, 0.5]).setDepth(TF_DEPTH + 8));
      t.setScale(3.2).setAngle(-6);
      s.tweens.add({ targets: t, scale: 1, angle: -3, duration: 240, ease: 'Back.easeOut', onComplete: () => s.cameras.main.shake(120, 0.008) });
      s.tweens.add({ targets: t, scale: 1.08, delay: 400, duration: 300, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      sfx('fanfare');
    });
    at(HIT_MS + 350, () => {
      const name = (para?.name ?? `${b?.name ?? brandId} Paragon`).toUpperCase();
      const plate = add(s.add.graphics().setDepth(TF_DEPTH + 7));
      const w = name.length * 16 + 28;
      plate.fillStyle(PAL.bgDeep, 1).fillRect(320 - w / 2 + 3, 75 + 3, w, 24);
      plate.fillStyle(col, 1).fillRect(320 - w / 2, 75, w, 24);
      plate.fillStyle(0xffffff, 0.3).fillRect(320 - w / 2, 75, w, 2);
      const t = add(txt(s, 320, 88, name, 16, b?.ink ?? PAL.ink, [0.5, 0.5]).setDepth(TF_DEPTH + 8));
      t.setShadow(1, 1, hex(b?.ink === PAL.ink ? PAL.bgDeep : 0xffffff), 0, false, true);
      plate.setScale(1, 0);
      plate.y = 87;
      s.tweens.add({ targets: plate, scaleY: 1, y: 0, duration: 180, ease: 'Back.easeOut' });
      t.setScale(0);
      s.tweens.add({ targets: t, scale: 1, duration: 220, ease: 'Back.easeOut' });
    });
    at(HIT_MS + 550, () => {
      const head = (abil?.name ?? para?.ability ?? 'SIGNATURE').toUpperCase();
      const desc = (abil?.desc ?? para?.abilityDesc ?? para?.desc ?? '').toUpperCase();
      const box = add(s.add.graphics().setDepth(TF_DEPTH + 7));
      const W = 440, H = 58, x = 320 - W / 2, y = 268;
      box.fillStyle(PAL.bgDeep, 0.95).fillRect(x, y, W, H);
      box.fillStyle(col, 1).fillRect(x, y, W, 2).fillRect(x, y + H - 2, W, 2).fillRect(x, y, 2, H).fillRect(x + W - 2, y, 2, H);
      const ht = add(txt(s, 320, y + 8, `SIGNATURE: ${head}`, 8, PAL.yellow, [0.5, 0]).setDepth(TF_DEPTH + 8));
      const dt = add(txt(s, 320, y + 22, wrap(desc, 52, 3), 8, PAL.ink, [0.5, 0]).setAlign('center').setLineSpacing(3).setDepth(TF_DEPTH + 8));
      for (const o of [box, ht, dt]) {
        (o as unknown as Phaser.GameObjects.Components.Alpha).setAlpha(0);
        s.tweens.add({ targets: o, alpha: 1, duration: 200 });
      }
      box.y = 10;
      s.tweens.add({ targets: box, y: 0, duration: 220, ease: 'Back.easeOut' });
    });
    at(HIT_MS + 900, () => {
      const t = add(txt(s, 320, 340, 'CLICK TO CONTINUE', 8, PAL.inkDim, [0.5, 0.5]).setDepth(TF_DEPTH + 8));
      s.tweens.add({ targets: t, alpha: 0.3, yoyo: true, repeat: -1, duration: 400 });
    });
    at(3700, () => this.finish());

    const kb = s.input.keyboard;
    for (const k of ['keydown-SPACE', 'keydown-ENTER', 'keydown-ESC']) {
      const fn = () => this.finish();
      kb?.on(k, fn);
      this.keyFns.push([k, fn]);
    }
    s.events.once('shutdown', () => this.cleanup());
  }

  /** Confetti: chunky pixel strips tumbling down for ~2 s. */
  private confetti(col: number, acc: number) {
    const s = this.scene;
    if (!s.textures.exists('px')) return;
    const cols = [col, acc, PAL.yellow, PAL.ink, PAL.pink, PAL.teal, PAL.orange];
    for (let i = 0; i < 90; i++) {
      const p = s.add.image(Math.random() * GAME_W, -10 - Math.random() * 120, 'px').setTint(cols[i % cols.length]).setDepth(TF_DEPTH + 9);
      p.setScale(Math.random() < 0.5 ? 2 : 3, Math.random() < 0.5 ? 4 : 2);
      this.objs.push(p);
      s.tweens.add({
        targets: p,
        y: GAME_H + 20,
        x: p.x + (Math.random() * 2 - 1) * 60,
        angle: (Math.random() * 2 - 1) * 720,
        duration: 1400 + Math.random() * 1400,
        delay: Math.random() * 500,
        ease: 'Quad.easeIn',
      });
    }
  }

  /** Skip or end: fade it all out, then hand the shop back. */
  finish() {
    if (this.done) return;
    this.done = true;
    const s = this.scene;
    for (const t of this.timers) t.remove(false);
    this.timers = [];
    const objs = this.objs;
    this.objs = [];
    s.tweens.add({
      targets: objs,
      alpha: 0,
      duration: 220,
      onComplete: () => objs.forEach((o) => o.destroy()),
    });
    this.cleanup();
    s.time.delayedCall(60, () => this.onDone());
  }

  private cleanup() {
    if (this.updateFn) this.scene.events.off('update', this.updateFn);
    this.updateFn = null;
    for (const [k, fn] of this.keyFns) this.scene.input.keyboard?.off(k, fn);
    this.keyFns = [];
    if (!this.done) {
      this.done = true;
      for (const t of this.timers) t.remove(false);
      for (const o of this.objs) o.destroy();
      this.objs = [];
    }
  }
}
