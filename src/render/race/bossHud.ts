// Boss hazards made visible: oil on the lane + its tach band + progress marks, the gust front and
// meter, blackout / blind / mirror tach modes, the pre-race "how to beat it" banner.
import Phaser from 'phaser';
import { bossModifierData, BLACKOUT_WARN, GUST_WARN, gustAt, inSpan, untilSpan } from '../../sim/bossMods';
import { REAR_M, TRACK_LENGTH, type RaceSim } from '../../sim/RaceSim';
import { GustFx, fxText, popup } from '../fx';
import { PAL } from '../palette';
import { LANE_NEAR_Y, PPM, type Track } from '../track';
import { txt } from '../ui';
import type { Tach, TachOpts } from './hud';

const OIL_COLOR = 0x5cf2ff;
const GUST_COLOR = 0x9cd8ff;
const METER = { x0: 262, x1: 412, y: 58, ahead: 3 }; // gust timeline: now .. now + 3 s

/** Splits a hint into lines of at most n chars. */
function wrap(s: string, n: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of s.split(' ')) {
    if (line && (line + ' ' + w).length > n) {
      out.push(line);
      line = w;
    } else line = line ? line + ' ' + w : w;
  }
  if (line) out.push(line);
  return out;
}

export class BossHud {
  readonly active: boolean;
  private scene: Phaser.Scene;
  private sim: RaceSim;
  private hud: Phaser.GameObjects.Layer;
  private g: Phaser.GameObjects.Graphics;
  private gust?: GustFx;
  private hasGust = false;
  private banner?: Phaser.GameObjects.Container;
  private oilTag?: Phaser.GameObjects.Text;
  private gustTag?: Phaser.GameObjects.Text;
  private lastGear = 1;
  private bannerGone = false;
  private gustWas = 0;
  private shift = 0;

  /**
   * rearOffsetPx: player rear contact world x minus state.x * PPM (the car's real geometry).
   * opts.gustStreaks: false skips the 2D gust front + streaks (the 3D race draws its own); meter and tag stay.
   */
  constructor(scene: Phaser.Scene, sim: RaceSim, hud: Phaser.GameObjects.Layer, track: Track, tach: Tach, rearOffsetPx: number, opts: { gustStreaks?: boolean } = {}) {
    this.scene = scene;
    this.sim = sim;
    this.hud = hud;
    const hz = sim.hz;
    this.active = hz.mods.size > 0;
    this.g = scene.add.graphics();
    hud.add(this.g);
    if (!this.active) return;

    // Oil drawn where the sim judges it: rear wheel at state.x - REAR_M.
    const shift = (this.shift = rearOffsetPx + REAR_M * PPM);
    hz.oil.forEach((o, i) => track.oilPatch(o.a * PPM + shift, o.b * PPM + shift, i + 1));
    if (hz.oil.length) {
      this.oilTag = fxText(scene, 0, 0, '', 8, PAL.yellow, 3).setVisible(false);
      hud.add(this.oilTag);
    }
    if (hz.gusts.length) {
      this.hasGust = true;
      if (opts.gustStreaks !== false) this.gust = new GustFx(scene, hud);
      hud.add(txt(scene, 226, METER.y - 4, 'WIND', 8, GUST_COLOR));
      this.gustTag = fxText(scene, 320, 84, '', 8, GUST_COLOR, 3);
      hud.add(this.gustTag);
    }
    if (hz.mirror) tach.setMirror(true);

    // modifier name under the BOSS label, top right
    const mods = [...hz.mods].map((m) => bossModifierData(m)).filter((m): m is NonNullable<typeof m> => !!m);
    const names = mods.map((m) => m.name.toUpperCase()).join(' + ');
    hud.add(txt(scene, 632, 66, names, 8, PAL.pink, [1, 0]));

    // banner: what it does + how to beat it, until the green
    const lines = mods.flatMap((m) => wrap(m.hint, 56));
    const h = 22 + lines.length * 12;
    const c = scene.add.container(330, 81 + h / 2);
    const bg = scene.add.rectangle(0, 0, 490, h, PAL.bgDeep, 0.9).setStrokeStyle(2, PAL.pink);
    c.add(bg);
    c.add(fxText(scene, 0, -h / 2 + 10, `BOSS: ${names}`, 8, PAL.pink, 0));
    lines.forEach((l, i) => c.add(fxText(scene, 0, -h / 2 + 24 + i * 12, l, 8, PAL.ink, 0)));
    hud.add(c);
    c.setScale(0.6).setAlpha(0);
    scene.tweens.add({ targets: c, scale: 1, alpha: 1, duration: 220, delay: 300, ease: 'Back.easeOut' });
    this.banner = c;
  }

  /** Y for the distance-split popups (moved down when the gust meter sits under the ET box). */
  get splitY(): number {
    return this.hasGust ? 76 : 66;
  }

  private hideBanner() {
    const c = this.banner;
    if (!c || this.bannerGone) return;
    this.bannerGone = true;
    this.scene.tweens.add({ targets: c, alpha: 0, y: c.y - 10, duration: 250, onComplete: () => c.destroy() });
  }

  /** Per frame. playerScreenX = the player's car centre on screen; camX = main camera scrollX. */
  update(dtMs: number, playerScreenX: number, camX: number) {
    const g = this.g;
    g.clear();
    if (!this.active) return;
    const s = this.sim.state;
    const hz = this.sim.hz;
    if (s.t >= 0.15 || s.phase === 'finished') this.hideBanner();

    // ---- oil: off-screen warning arrow on the player's lane ----
    if (this.oilTag) {
      const rear = s.x - REAR_M;
      const next = hz.oil.find((o) => o.b > rear);
      const sx = next ? next.a * PPM + this.shift - camX : 0; // screen x of the patch's near edge
      if (next && s.phase === 'running' && sx > 640) {
        const d = next.a - rear;
        if (d < 60) {
          const y = LANE_NEAR_Y - 14;
          g.fillStyle(PAL.bgDeep, 0.85).fillRect(640 - 74, y - 9, 70, 18);
          g.fillStyle(PAL.yellow, 1).fillTriangle(638, y, 628, y - 7, 628, y + 7);
          this.oilTag.setVisible(true).setPosition(640 - 42, y).setText(`OIL ${Math.round(d)}M`);
        } else this.oilTag.setVisible(false);
      } else this.oilTag.setVisible(false);
    }

    // ---- gusts: front rolling in + meter ----
    if (this.hasGust) {
      const str = gustAt(hz, s.t);
      const until = s.phase === 'running' ? untilSpan(hz.gusts, s.t) : Infinity;
      let front: number | null = null;
      if (until > 0 && until < GUST_WARN) front = playerScreenX + (until / GUST_WARN) * (700 - playerScreenX);
      this.gust?.update(dtMs, s.phase === 'finished' ? null : front, s.phase === 'finished' ? 0 : str);
      if (str > 0.5 && this.gustWas <= 0.5) {
        this.scene.cameras.main.shake(260, 0.004);
      }
      this.gustWas = str;
      this.drawGustMeter(str);
      if (this.gustTag) {
        if (str > 0.05 && s.phase === 'running') this.gustTag.setText('GUST! WINDOW SQUEEZED').setAlpha(Math.floor(this.scene.time.now / 160) % 2 ? 1 : 0.6);
        else if (front !== null) this.gustTag.setText(`GUST IN ${until.toFixed(1)}`).setAlpha(1);
        else this.gustTag.setText('');
      }
    }

    // ---- drifting window: point at the new spot after each shift ----
    if (s.gear !== this.lastGear) {
      this.lastGear = s.gear;
      if (s.gear < 4 && hz.centers[s.gear - 1] !== null) {
        const w = s.shiftWindow;
        popup(this.scene, this.hud, this.tachX((w.perfectLo + w.perfectHi) / 2), 296, 'WINDOW MOVED', PAL.pink, 8, { rise: 6, hold: 500 });
      }
    }
  }

  private tachRef?: Tach;
  /** The scene hands its tach in so popups land over the right rpm. */
  bindTach(t: Tach) {
    this.tachRef = t;
  }
  private tachX(r: number) {
    return this.tachRef ? this.tachRef.xOf(r) : 280;
  }

  private drawGustMeter(str: number) {
    const g = this.g;
    const { x0, x1, y, ahead } = METER;
    const s = this.sim.state;
    const t = Math.max(0, s.t);
    g.fillStyle(PAL.bgDeep, 0.9).fillRect(222, y - 7, 196, 14);
    g.fillStyle(0x15121f, 1).fillRect(x0, y - 3, x1 - x0, 6);
    const px = (tt: number) => x0 + ((tt - t) / ahead) * (x1 - x0);
    for (const gs of this.sim.hz.gusts) {
      const a = Math.max(x0, px(gs.a));
      const b = Math.min(x1, px(gs.b));
      if (b <= a) continue;
      g.fillStyle(GUST_COLOR, gs.a <= t ? 1 : 0.6).fillRect(Math.round(a), y - 3, Math.round(b - a), 6);
      for (let hx = Math.ceil(a); hx < b; hx += 5) g.fillStyle(0xffffff, 0.5).fillRect(hx, y - 3, 1, 6);
    }
    // "now" marker, glowing while a gust is on you
    g.fillStyle(str > 0.05 ? PAL.red : PAL.ink, 1).fillRect(x0 - 1, y - 6, 2, 12);
  }

  /** Overlays for the tach this frame. */
  tachOpts(): TachOpts {
    if (!this.active) return {};
    const s = this.sim.state;
    const hz = this.sim.hz;
    const o: TachOpts = { hidden: hz.hideWindow };
    if (hz.blackouts.length && s.phase === 'running') {
      const on = inSpan(hz.blackouts, s.t);
      const warn = !on && untilSpan(hz.blackouts, s.t) < BLACKOUT_WARN;
      o.off = on || (warn && Math.random() < 0.45);
    }
    if (hz.oil.length && s.launched && s.phase === 'running' && s.gear < 4) o.bands = this.oilBands();
    return o;
  }

  /** Where (in rpm, this gear) the rear wheels will be on the next oil patch, extrapolating the current pull. */
  private oilBands(): NonNullable<TachOpts['bands']> {
    const s = this.sim.state;
    const rear = s.x - REAR_M;
    const vt = this.sim.gearTopSpeed(s.gear);
    const a = Math.max(0.5, s.a);
    const rpmAt = (d: number) => Math.sqrt(Math.max(0, s.v * s.v + 2 * a * Math.max(0, d))) / vt;
    const out: NonNullable<TachOpts['bands']> = [];
    for (const o of this.sim.hz.oil) {
      if (o.b < rear) continue;
      const lo = o.a <= rear ? s.rpm : rpmAt(o.a - rear);
      if (lo > 1.04) break;
      const hi = Math.min(1.06, rpmAt(o.b - rear));
      out.push({ lo, hi, color: OIL_COLOR, label: 'OIL' });
      if (out.length >= 2) break;
    }
    return out;
  }

  /** Oil patches on the progress bar. */
  progressMarks(pg: Phaser.GameObjects.Graphics, x0: number, x1: number, y: number) {
    for (const o of this.sim.hz.oil) {
      const a = x0 + ((o.a + REAR_M) / TRACK_LENGTH) * (x1 - x0);
      const w = Math.max(2, ((o.b - o.a) / TRACK_LENGTH) * (x1 - x0));
      pg.fillStyle(OIL_COLOR, 1).fillRect(Math.round(a) - 1, y - 3, Math.round(w) + 2, 6);
      pg.fillStyle(0x050409, 1).fillRect(Math.round(a), y - 2, Math.round(w), 4);
    }
  }
}
