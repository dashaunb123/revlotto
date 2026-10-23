// Dev jukebox: audition every music track and the duck. http://localhost:5173/src/render/race/dev/music.html
import { DEFAULT_ENGINE_PROFILE, revBlip, sfx, toggleMute, unlockAudio } from '../../audio';
import { playMusic, type TrackId } from '../../music';

const IDS: TrackId[] = ['menu', 'race1', 'race2', 'race3', 'race4', 'boss1', 'boss2', 'boss3', 'boss4'];
const grid = document.getElementById('grid')!;
const btns = IDS.map((id) => {
  const b = document.createElement('button');
  b.textContent = id.toUpperCase();
  b.onclick = () => {
    unlockAudio();
    playMusic(id);
    btns.forEach((x) => x.classList.toggle('on', x === b));
  };
  grid.appendChild(b);
  return b;
});
document.getElementById('duck')!.onclick = () => {
  sfx.install('forced_induction', 'pro');
  setTimeout(() => revBlip({ ...DEFAULT_ENGINE_PROFILE, engine: 'pro', exhaust: 'pro', forcedInduction: 'pro' }), 950);
};
document.getElementById('mute')!.onclick = () => toggleMute();
