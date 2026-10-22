// PLACEHOLDER: replaced by the owning agent.
import Phaser from 'phaser';
import { txt } from '../render/ui';

export class VictoryScene extends Phaser.Scene {
  constructor() {
    super('Victory');
  }
  create() {
    txt(this, 320, 180, 'Victory (placeholder)', 16, undefined, [0.5, 0.5]);
  }
}
