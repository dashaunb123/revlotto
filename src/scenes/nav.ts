// Maps the run phase to its scene. Every scene transition goes through here.
import Phaser from 'phaser';
import type { RunPhase } from '../core/types';
import { game } from '../game/game';

export const PHASE_SCENE: Record<RunPhase, string> = {
  shop: 'Shop',
  staging: 'Staging',
  race: 'Race',
  result: 'Result',
  gameover: 'GameOver',
  victory: 'Victory',
};

/** Fade out and start whichever scene matches game.state.phase. */
export function goToPhase(from: Phaser.Scene, fadeMs = 150): void {
  const key = PHASE_SCENE[game.state.phase];
  from.cameras.main.fadeOut(fadeMs, 11, 10, 20);
  from.cameras.main.once('camerafadeoutcomplete', () => from.scene.start(key));
}
