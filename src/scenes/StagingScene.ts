// PLACEHOLDER: replaced by the owning agent.
import Phaser from 'phaser';
import { txt } from '../render/ui';

export class StagingScene extends Phaser.Scene {
  constructor() {
    super('Staging');
  }
  create() {
    txt(this, 320, 180, 'Staging (placeholder)', 16, undefined, [0.5, 0.5]);
  }
}
