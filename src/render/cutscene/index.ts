// Entry point for the cutscenes, loaded lazily so three.js stays out of the main bundle until a boss.
import { CONTENT, bossModifierById } from '../../data/content';
import type { BossDef, OpponentDef } from '../../core/types';
import { hex, PAL } from '../palette';
import { Director, type CardInfo } from './director';
import { Stage } from './stage';
import type { CutsceneId } from './types';
import buckshot from './scenes/buckshot';
import olga from './scenes/olga';
import gus from './scenes/gus';
import rosa from './scenes/rosa';
import pivot from './scenes/pivot';
import flashini from './scenes/flashini';
import sal from './scenes/sal';
import vera from './scenes/vera';
import dj from './scenes/dj';
import rick from './scenes/rick';
import deacon from './scenes/deacon';
import baron from './scenes/baron';
import ivy from './scenes/ivy';

const SCENES: Record<CutsceneId, (d: Director, card: CardInfo) => void> = { buckshot, olga, gus, rosa, pivot, flashini, sal, vera, dj, rick, deacon, baron, ivy };
const isCutscene = (id: string | undefined): id is CutsceneId => !!id && id in SCENES;

/** Boss races only: the drawn boss's `cutscene` field (bosses.json), or null (the game flows on without one). */
export function cutsceneFor(op: Pick<OpponentDef, 'race'> & Partial<Pick<OpponentDef, 'round' | 'bossId' | 'cutscene'>>): CutsceneId | null {
  if (op.race !== 3) return null;
  let id = op.cutscene;
  if (!id && op.bossId) id = CONTENT.bosses.find((b) => b.id === op.bossId)?.cutscene;
  return isCutscene(id) ? id : null;
}

/** The last opponent a cutscene was asked for (playCutscene), so the card shows the right round. */
let lastOp: Partial<OpponentDef> | null = null;

/** Name card text for a boss, from bosses.json + its modifier. */
export function cardFor(id: CutsceneId, op: Partial<OpponentDef> | null = lastOp): CardInfo {
  const boss: BossDef | undefined =
    CONTENT.bosses.find((b) => op?.bossId && b.id === op.bossId) ?? CONTENT.bosses.find((b) => b.cutscene === id);
  const name = boss?.name ?? op?.name ?? id.toUpperCase();
  const mod = bossModifierById(boss?.modifier ?? op?.bossModifier)?.name ?? '';
  const final = boss?.tier === 'final';
  const round = op?.round;
  const words = name.toUpperCase().split(' ');
  const big = words.pop() ?? name;
  return {
    title: words.join(' '),
    name: big,
    round: final ? 'FINAL BOSS' : round ? `ROUND ${round} BOSS` : 'BOSS',
    modifier: mod.toUpperCase(),
    taunt: boss?.taunt ?? op?.taunt ?? '',
    color: boss?.car.color ?? hex(PAL.red),
    accent: boss?.car.accent ?? hex(PAL.yellow),
  };
}

/** Builds the stage + director for a scene without starting it (the dev page seeks it). */
export function createCutscene(id: CutsceneId, parent: HTMLElement): Director {
  const stage = new Stage(parent);
  const d = new Director(stage);
  try {
    SCENES[id](d, cardFor(id));
  } catch (e) {
    d.dispose();
    throw e;
  }
  return d;
}

/** Plays the cutscene in a canvas over the game. Resolves when it ends or is skipped. */
export async function playCutscene(id: CutsceneId, parent: HTMLElement, op?: Partial<OpponentDef>): Promise<void> {
  if (op) lastOp = op;
  else {
    // the opponent being introduced (lazy import keeps game state out of the dev cutscene page)
    try {
      lastOp = (await import('../../game/game')).game.currentOpponent();
    } catch {
      lastOp = null;
    }
  }
  await document.fonts.load('8px "Press Start 2P"').catch(() => undefined);
  const d = createCutscene(id, parent);
  await d.play();
}
