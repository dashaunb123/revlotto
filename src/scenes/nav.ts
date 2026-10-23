// Maps the run phase to its scene. Every scene transition goes through here.
import Phaser from 'phaser';
import type { RunPhase } from '../core/types';
import { game } from '../game/game';
import { loadLook } from '../game/cosmetics';
import type { CarLook } from '../render/car';

export const PHASE_SCENE: Record<RunPhase, string> = {
  shop: 'Shop',
  staging: 'Staging',
  race: 'Race',
  result: 'Result',
  gameover: 'GameOver',
  victory: 'Victory',
};

/** The player's look for this run: paint/livery from the Paint Shop, body from the run's starting car. */
export function runLook(): CarLook {
  const look = loadLook();
  try {
    const car = game.startingCars().find((c) => c.id === game.state.car);
    return car ? { ...look, body: car.body } : look;
  } catch {
    return look;
  }
}

// Boss intro cutscenes (three.js) play once per boss per run, between the fade-out and Staging.
const SEEN_KEY = 'revlotto.cutscenesSeen';
const CUTSCENE_TIMEOUT_MS = 25000;

function seenList(seed: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? 'null') as { seed: string; ids: string[] } | null;
    return v && v.seed === seed ? v.ids : [];
  } catch {
    return [];
  }
}

function markSeen(seed: string, key: string) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify({ seed, ids: [...seenList(seed), key] }));
  } catch {
    /* private mode: it may replay, that's fine */
  }
}

/** Starts loading the cutscene module if this Staging is a boss's first appearance this run. */
function pendingCutscene(): { load: Promise<typeof import('../render/cutscene')>; seenKey: string } | null {
  try {
    if (localStorage.getItem('revlotto.noCutscenes') === '1') return null;
    const op = game.currentOpponent();
    if (op.race !== 3) return null;
    if (op.bossId && !op.cutscene) return null; // pool bosses without a cutscene go straight to the name card
    const seenKey = op.bossId ? `boss:${op.bossId}` : `boss${op.round}`;
    if (seenList(game.state.seed).includes(seenKey)) return null;
    return { load: import('../render/cutscene'), seenKey };
  } catch {
    return null;
  }
}

async function playBossIntro(from: Phaser.Scene, p: NonNullable<ReturnType<typeof pendingCutscene>>) {
  const input = from.game.input;
  const kb = input.keyboard;
  input.enabled = false;
  if (kb) kb.enabled = false;
  try {
    const mod = await p.load;
    const id = mod.cutsceneFor(game.currentOpponent());
    if (!id) return;
    markSeen(game.state.seed, p.seenKey); // before playing: a reload mid-scene won't replay it
    const parent = from.game.canvas.parentElement ?? document.body;
    let timer = 0;
    await Promise.race([
      mod.playCutscene(id, parent),
      new Promise<void>((res) => (timer = window.setTimeout(res, CUTSCENE_TIMEOUT_MS))),
    ]);
    clearTimeout(timer);
  } catch (e) {
    console.error('[cutscene] skipped, continuing to staging', e);
  } finally {
    document.querySelectorAll('canvas[data-cutscene]').forEach((c) => c.remove());
    input.enabled = true;
    if (kb) kb.enabled = true;
  }
}

/** Fade out and start whichever scene matches game.state.phase. */
export function goToPhase(from: Phaser.Scene, fadeMs = 150): void {
  const key = PHASE_SCENE[game.state.phase];
  const intro = key === 'Staging' ? pendingCutscene() : null;
  from.cameras.main.fadeOut(fadeMs, 11, 10, 20);
  from.cameras.main.once('camerafadeoutcomplete', () => {
    if (!intro) return from.scene.start(key);
    playBossIntro(from, intro).then(() => from.scene.start(key));
  });
}
