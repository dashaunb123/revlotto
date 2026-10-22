// PLACEHOLDER: replaced by the owning agent.
import Phaser from 'phaser';
import { txt } from '../render/ui';

export class ResultScene extends Phaser.Scene {
  constructor() {
    super('Result');
  }
  create() {
    txt(this, 320, 180, 'Result (placeholder)', 16, undefined, [0.5, 0.5]);
  }
}
