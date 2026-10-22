// PLACEHOLDER: replaced by the owning agent.
import Phaser from 'phaser';
import { txt } from '../render/ui';

export class ShopScene extends Phaser.Scene {
  constructor() {
    super('Shop');
  }
  create() {
    txt(this, 320, 180, 'Shop (placeholder)', 16, undefined, [0.5, 0.5]);
  }
}
