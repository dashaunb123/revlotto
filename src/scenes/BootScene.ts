// Boot: bake every shared pixel texture once, then go to the title.
import Phaser from 'phaser';
import { ensureTextures } from '../render/icons';
import { PAL } from '../render/palette';
import { txt } from '../render/ui';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }
  create() {
    txt(this, 320, 180, 'REVVING UP...', 8, PAL.inkDim, [0.5, 0.5]);
    ensureTextures(this);
    this.time.delayedCall(50, () => this.scene.start('Title'));
  }
}
