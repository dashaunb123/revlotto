// Writes devlog/status/activity.js every 10 s: which files each agent's area changed, and when.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const OWNERS = {
  engine: ['src/data', 'src/sim', 'src/game/stats.ts', 'src/game/effects.ts', 'scripts/balance.ts', 'scripts/simSmoke.ts'],
  run: ['src/game', 'scripts/runSmoke.ts'],
  race: ['src/scenes/StagingScene.ts', 'src/scenes/RaceScene.ts', 'src/scenes/ResultScene.ts', 'src/render/car.ts', 'src/render/track.ts', 'src/render/fx.ts', 'src/render/audio.ts', 'src/render/race'],
  shop: ['src/scenes/BootScene.ts', 'src/scenes/TitleScene.ts', 'src/scenes/ShopScene.ts', 'src/scenes/GameOverScene.ts', 'src/scenes/VictoryScene.ts', 'src/render/ui.ts', 'src/render/shop', 'src/render/icons.ts'],
};
const ENGINE_GAME = new Set(['src/game/stats.ts', 'src/game/effects.ts']);

function walk(rel, out) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return;
  const st = fs.statSync(abs);
  if (st.isDirectory()) for (const f of fs.readdirSync(abs)) walk(path.posix.join(rel, f), out);
  else out.push({ file: rel, mtime: st.mtimeMs, lines: fs.readFileSync(abs, 'utf8').split('\n').length });
}

function tick() {
  const result = {};
  for (const [agent, roots] of Object.entries(OWNERS)) {
    let files = [];
    for (const r of roots) walk(r, files);
    if (agent === 'run') files = files.filter(f => !ENGINE_GAME.has(f.file));
    files = files.filter(f => !/PLACEHOLDER/.test(fs.readFileSync(path.join(ROOT, f.file), 'utf8').slice(0, 40)));
    files.sort((a, b) => b.mtime - a.mtime);
    result[agent] = {
      files: files.length,
      lines: files.reduce((s, f) => s + f.lines, 0),
      recent: files.slice(0, 4).map(f => ({ file: f.file, at: new Date(f.mtime).toISOString(), lines: f.lines })),
    };
  }
  const js = `window.DEVLOG.activity = ${JSON.stringify({ at: new Date().toISOString(), agents: result })};\n`;
  fs.writeFileSync(path.join(ROOT, 'devlog/status/activity.js'), js);
}

tick();
setInterval(tick, 10000);
