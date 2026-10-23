// DEV ONLY (not imported by the game): plays a boss cutscene on its own.
// /src/render/cutscene/dev/cutscene.html?id=buckshot          plays it (click / Space skips, then replays)
// ?id=rosa&t=3.2&pause=1                                       freezes at t seconds (for screenshots)
import '@fontsource/press-start-2p';
import { createCutscene } from '../index';
import type { CutsceneId } from '../types';

const q = new URLSearchParams(location.search);
const id = (q.get('id') ?? 'buckshot') as CutsceneId;
const t = Number(q.get('t') ?? 0);
const pause = q.get('pause') === '1';
const parent = document.getElementById('game')!;
const W = window as unknown as { __ready: boolean; __err: string; __t: number; __d: unknown };

const bar = document.getElementById('bar')!;
if (!pause)
  for (const k of ['buckshot', 'olga', 'gus', 'rosa', 'pivot', 'flashini', 'sal', 'vera', 'dj', 'rick', 'deacon', 'baron', 'ivy']) {
    const a = document.createElement('a');
    a.href = `?id=${k}`;
    a.textContent = k;
    bar.appendChild(a);
  }

async function run() {
  await document.fonts.load('8px "Press Start 2P"');
  try {
    const d = createCutscene(id, parent);
    W.__d = d;
    if (pause) {
      d.seek(t);
      W.__t = d.t;
      W.__ready = true;
      return;
    }
    if (t > 0) d.seek(t);
    await d.play();
    setTimeout(run, 600);
  } catch (e) {
    console.error(e);
    W.__err = String(e);
    W.__ready = true;
  }
}
run();
