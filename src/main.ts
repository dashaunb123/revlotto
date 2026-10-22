import Phaser from 'phaser';
import '@fontsource/press-start-2p';
import { GAME_H, GAME_W, PAL } from './render/palette';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { ShopScene } from './scenes/ShopScene';
import { StagingScene } from './scenes/StagingScene';
import { RaceScene } from './scenes/RaceScene';
import { ResultScene } from './scenes/ResultScene';
import { GameOverScene } from './scenes/GameOverScene';
import { VictoryScene } from './scenes/VictoryScene';

async function start() {
  // Phaser Text needs the web font loaded before the first text is drawn.
  await document.fonts.load('8px "Press Start 2P"');
  const phaserGame = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    width: GAME_W,
    height: GAME_H,
    backgroundColor: PAL.bg,
    pixelArt: true,
    roundPixels: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [BootScene, TitleScene, ShopScene, StagingScene, RaceScene, ResultScene, GameOverScene, VictoryScene],
  });
  // Dev-only hook for the headless playtest harness.
  if (import.meta.env.DEV) (window as unknown as { __PHASER: Phaser.Game }).__PHASER = phaserGame;
}

start();
