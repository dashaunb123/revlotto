// PLACEHOLDER: replaced by the owning agent.
import Phaser from 'phaser';
import { txt } from '../render/ui';

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }
  create() {
    txt(this, 320, 180, 'Title (placeholder)', 16, undefined, [0.5, 0.5]);
  }
}
