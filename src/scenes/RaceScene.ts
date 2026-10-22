// PLACEHOLDER: replaced by the owning agent.
import Phaser from 'phaser';
import { txt } from '../render/ui';

export class RaceScene extends Phaser.Scene {
  constructor() {
    super('Race');
  }
  create() {
    txt(this, 320, 180, 'Race (placeholder)', 16, undefined, [0.5, 0.5]);
  }
}
