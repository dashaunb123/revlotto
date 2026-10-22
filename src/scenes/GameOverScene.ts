// PLACEHOLDER: replaced by the owning agent.
import Phaser from 'phaser';
import { txt } from '../render/ui';

export class GameOverScene extends Phaser.Scene {
  constructor() {
    super('GameOver');
  }
  create() {
    txt(this, 320, 180, 'GameOver (placeholder)', 16, undefined, [0.5, 0.5]);
  }
}
