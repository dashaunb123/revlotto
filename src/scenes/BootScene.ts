// PLACEHOLDER: replaced by the owning agent.
import Phaser from 'phaser';
import { txt } from '../render/ui';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }
  create() {
    txt(this, 320, 180, 'Boot (placeholder)', 16, undefined, [0.5, 0.5]);
  }
}
