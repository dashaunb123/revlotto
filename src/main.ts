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
import { initGlobalMuteKey, unlockAudio } from './render/audio';
import { playMusic, type TrackId } from './render/music';
import { game } from './game/game';
import { GarageScene } from './scenes/GarageScene';
import { RunSetupScene } from './scenes/RunSetupScene';

// Title, shop, garage and end screens share one endless track; staging and the race play the round's
// track (or its boss track). Result keeps whatever race track is playing.
const MENU_SCENES = new Set(['Title', 'RunSetup', 'Shop', 'Garage', 'GameOver', 'Victory']);
function syncMusic(key: string) {
  if (MENU_SCENES.has(key)) return playMusic('menu');
  if (key !== 'Staging' && key !== 'Race') return;
  try {
    const op = game.currentOpponent();
    playMusic(`${op.race === 3 ? 'boss' : 'race'}${Math.min(4, Math.max(1, op.round))}` as TrackId);
  } catch {
    /* no run: leave the music alone */
  }
}

async function start() {
  initGlobalMuteKey();
  // Browsers only start audio after a gesture: the first click or key starts the music.
  for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => unlockAudio(), { capture: true });
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
    scene: [BootScene, TitleScene, ShopScene, StagingScene, RaceScene, ResultScene, GameOverScene, VictoryScene, GarageScene, RunSetupScene],
  });
  phaserGame.events.once(Phaser.Core.Events.READY, () => {
    for (const sc of phaserGame.scene.scenes) sc.events.on(Phaser.Scenes.Events.CREATE, () => syncMusic(sc.scene.key));
  });
  // Dev-only hook for the headless playtest harness.
  if (import.meta.env.DEV) (window as unknown as { __PHASER: Phaser.Game }).__PHASER = phaserGame;
}

start();
