// Dev page: audition every cutscene sound. http://localhost:5173/src/render/cutscene/dev/sfx.html
import { duck, toggleMute, unlockAudio } from '../../audio';
import { playMusic } from '../../music';
import { cutsceneSfx as S, renderCutsceneSfx, STING_LEAD } from '../sfx';
import type { CutsceneId } from '../types';

const OLD: CutsceneId[] = ['buckshot', 'olga', 'gus', 'rosa'];
const NEW: CutsceneId[] = ['pivot', 'flashini', 'sal', 'vera', 'dj', 'rick', 'deacon', 'baron', 'ivy'];
const IDS: CutsceneId[] = [...OLD, ...NEW];
/** Extra one-shots the new boss scenes asked for (called by duck-typing, `(d.sfx as any).<name>?.()`). */
const EXTRAS: [string, number][] = [
  ['bellToll', 3.5], ['snuff', 0.5], ['tapeZip', 0.7], ['tapeSnap', 0.5], ['chisel', 0.5], ['grainTick', 0.2],
  ['poof', 1.2], ['boing', 1], ['cardRiffle', 0.8], ['saw', 0.4], ['coo', 1.5], ['taDa', 1.6],
  ['reverseBeep', 2.2], ['kiss', 0.6], ['raspberry', 1.1], ['glassShatter', 1.8],
  ['fanfare', 1.8], ['batFlutter', 1.1], ['sip', 0.6], ['glovePull', 0.4], ['candleFwump', 0.8],
  ['tireKick', 0.5], ['bookThud', 0.6], ['lensPoke', 0.3], ['tinyShift', 0.2], ['bookTopple', 1.6], ['faceplant', 0.8],
  ['ding', 1.3], ['spray', 1.3], ['canRattle', 0.6], ['deflate', 1.3], ['kaching', 1.3],
  ['weldArc', 1.3], ['viseClank', 0.7], ['knuckleCrack', 0.3], ['hydraulicHiss', 1.1],
  ['scratch', 0.6], ['powerDown', 1.2], ['clunk', 0.7], ['click', 0.1], ['laserZap', 0.7], ['riser', 2.2], ['bassDrop', 2],
  ['engineIdle', 1.2], ['engineSputter', 1.4], ['feedback', 1.8], ['micThud', 0.8],
  ['schoolBell', 1.6], ['chalkWhack', 0.6], ['rubberStamp', 0.4],
];
const SX = S as unknown as Record<string, ((...a: unknown[]) => void) | undefined>;
const MOODS = ['taunt', 'laugh', 'yell'] as const;
let underMusic = false;
let duckTimer = 0;

function btn(parent: HTMLElement, label: string, fn: () => void) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => {
    unlockAudio();
    fn();
  };
  parent.appendChild(b);
}

const shared = document.getElementById('shared')!;
btn(shared, 'Drift 1.5 s', () => S.drift(1.5));
btn(shared, 'Drift 4 s', () => S.drift(4));
btn(shared, 'Slow-mo in', () => S.slowmoIn());
btn(shared, 'Slow-mo out', () => S.slowmoOut());
btn(shared, 'Impact', () => S.impact());
btn(shared, 'Sequence: in > out > slam', () => {
  S.slowmoIn();
  setTimeout(() => S.slowmoOut(), 2200);
  setTimeout(() => S.impact(), 2850);
});

const turn = document.getElementById('turn')!;
let stopBox: (() => void) | null = null;
btn(turn, 'Glitch 0.6 s', () => S.glitch(0.6));
btn(turn, 'Glitch 1.2 s', () => S.glitch(1.2));
btn(turn, 'Squirt 0.4 s', () => S.squirt(0.4));
btn(turn, 'Squirt 1.5 s', () => S.squirt(1.5));
btn(turn, 'Squirt 4 s', () => S.squirt(4));
btn(turn, 'Sparkle', () => S.sparkle());
btn(turn, 'Splat (lens)', () => S.splat());
btn(turn, 'Slap (ticket)', () => S.slap());
btn(turn, 'Crumple', () => S.crumple());
btn(turn, 'Inhale', () => S.inhale());
btn(turn, 'Crowd scream', () => S.crowdScream());
btn(turn, 'Music box 8 s', () => {
  stopBox?.();
  stopBox = S.musicBox(8);
});
btn(turn, 'Stop music box', () => S.stopMusicBox());
btn(turn, 'Box > glitch (heel turn)', () => {
  S.stopMusicBox();
  const stop = S.musicBox(6);
  setTimeout(() => S.sweet('olga'), 600);
  setTimeout(() => {
    stop();
    S.glitch(0.9);
  }, 3200);
  setTimeout(() => S.voice('olga', 'laugh'), 4200);
});

const polish = document.getElementById('polish')!;
btn(polish, 'Crunch (lollipop)', () => S.crunch());
btn(polish, 'Scribble 0.7 s', () => S.scribble(0.7));
btn(polish, 'Scribble 2 s', () => S.scribble(2));
btn(polish, 'Rip (ticket)', () => S.rip());
btn(polish, 'Scribble > rip', () => {
  S.scribble(0.7);
  setTimeout(() => S.rip(), 850);
});
btn(polish, 'Tink (stick on glass)', () => S.tink());
btn(polish, 'Pump rack', () => S.pumpRack());
btn(polish, 'Pump rack > squirt', () => {
  S.pumpRack();
  setTimeout(() => S.squirt(1), 420);
});
for (const id of OLD) btn(polish, `Hehe (${id})`, () => S.hehe(id));
btn(polish, 'Flash pop', () => S.flashPop());
btn(polish, 'Flash barrage (9 in 1.5 s)', () => {
  for (let i = 0; i < 9; i++) setTimeout(() => S.flashPop(), i * 170 + Math.random() * 40);
});
btn(polish, 'Paper tik (lens)', () => S.paperTik());

const bosses = document.getElementById('bosses')!;
for (const id of IDS) {
  const h = document.createElement('h2');
  h.textContent = id.toUpperCase();
  bosses.appendChild(h);
  const g = document.createElement('div');
  g.className = 'grid';
  bosses.appendChild(g);
  btn(g, 'Roar', () => S.roar(id));
  btn(g, 'Sting', () => S.sting(id));
  btn(g, 'Signature', () => S.signature(id));
  if (OLD.includes(id)) {
    btn(g, 'Sweet', () => S.sweet(id));
    btn(g, 'Sweet > glitch > laugh', () => {
      S.sweet(id);
      setTimeout(() => S.glitch(0.8), 1300);
      setTimeout(() => S.voice(id, 'laugh'), 2150);
    });
  } else btn(g, 'Hehe', () => S.hehe(id));
  for (const m of MOODS) btn(g, `Voice: ${m}`, () => S.voice(id, m));
  btn(g, 'Sting + slam + yell', () => {
    S.sting(id);
    setTimeout(() => S.impact(), (STING_LEAD[id] ?? 0.7) * 1000);
    setTimeout(() => S.voice(id, 'yell'), (STING_LEAD[id] ?? 0.7) * 1000 + 450);
  });
}

if (EXTRAS.length) {
  const h = document.createElement('h2');
  h.textContent = 'NEW BOSS SCENE EXTRAS';
  bosses.appendChild(h);
  const g = document.createElement('div');
  g.className = 'grid';
  bosses.appendChild(g);
  for (const [name] of EXTRAS) btn(g, name, () => SX[name]?.());
  for (const b of [1.3, 2.2]) btn(g, `bellToll(${b})`, () => S.bellToll(b));
}

const musicBtn = document.getElementById('music')!;
musicBtn.onclick = () => {
  unlockAudio();
  underMusic = !underMusic;
  musicBtn.textContent = `Music: ${underMusic ? 'muffled (cutscene)' : 'open'}`;
  musicBtn.classList.toggle('on', underMusic);
  clearInterval(duckTimer);
  playMusic('boss4');
  if (underMusic) {
    duck(4);
    duckTimer = window.setInterval(() => duck(4), 3000);
  }
};
document.getElementById('mute')!.onclick = () => toggleMute();

document.getElementById('measure')!.onclick = async () => {
  const out = document.getElementById('lvl')!;
  out.textContent = 'rendering...';
  const jobs: [string, () => void, number][] = [
    ['drift 1.5s', () => S.drift(1.5), 2.5],
    ['slowmoIn', () => S.slowmoIn(), 3.5],
    ['slowmoOut', () => S.slowmoOut(), 1.6],
    ['impact', () => S.impact(), 2.5],
    ['glitch 0.6', () => S.glitch(0.6), 1.5],
    ['glitch 1.2', () => S.glitch(1.2), 2.1],
    ['squirt 0.4', () => S.squirt(0.4), 1.4],
    ['squirt 4', () => S.squirt(4), 5],
    ['sparkle', () => S.sparkle(), 1],
    ['splat', () => S.splat(), 1.4],
    ['slap', () => S.slap(), 0.5],
    ['crumple', () => S.crumple(), 1],
    ['inhale', () => S.inhale(), 1.6],
    ['crowdScream', () => S.crowdScream(), 2],
    ['musicBox 8', () => S.musicBox(8), 8.5],
    ['crunch', () => S.crunch(), 0.5],
    ['scribble 0.7', () => S.scribble(0.7), 1],
    ['scribble 3', () => S.scribble(3), 3.3],
    ['rip', () => S.rip(), 0.6],
    ['tink', () => S.tink(), 0.6],
    ['pumpRack', () => S.pumpRack(), 0.5],
    ['flashPop', () => S.flashPop(), 0.3],
    ['paperTik', () => S.paperTik(), 0.4],
  ];
  for (const id of IDS) {
    if (OLD.includes(id)) jobs.push([`sweet ${id}`, () => S.sweet(id), 1.8]);
    jobs.push([`roar ${id}`, () => S.roar(id), 4], [`sting ${id}`, () => S.sting(id), 6.5], [`signature ${id}`, () => S.signature(id), 4.5]);
    jobs.push([`hehe ${id}`, () => S.hehe(id), 0.8]);
    for (const m of MOODS) jobs.push([`voice ${id} ${m}`, () => S.voice(id, m), 2.6]);
  }
  for (const [name, secs] of EXTRAS) jobs.push([name, () => SX[name]?.(), secs]);
  for (const b of [1.3, 2.2]) jobs.push([`bellToll ${b}`, () => S.bellToll(b), 7]);
  const lines: string[] = ['sound                  peak   rms (master input)'];
  for (const [name, fn, secs] of jobs) {
    const b = await renderCutsceneSfx(fn, secs);
    if (!b) continue;
    const d = b.getChannelData(0);
    let pk = 0;
    let ss = 0;
    let n = 0;
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      pk = Math.max(pk, a);
      if (a > 0.003) {
        ss += d[i] * d[i];
        n++;
      }
    }
    lines.push(`${name.padEnd(22)} ${pk.toFixed(3)}  ${Math.sqrt(ss / Math.max(1, n)).toFixed(3)}`);
  }
  out.textContent = lines.join('\n');
};
