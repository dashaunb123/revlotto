// Writes devlog/status/activity.js every 10 s: which files each agent's area changed, and when.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const OWNERS = {
  p_core: ['src/core', 'src/game/game.ts', 'src/game/run.ts', 'src/game/shop.ts', 'src/game/economy.ts', 'src/game/stats.ts', 'src/game/brands.ts', 'src/data/parts.json', 'src/data/brands.json', 'src/data/balance.json', 'src/data/content.ts'],
  p_abilities: ['src/game/effects.ts', 'src/render/shop/describe.ts', 'src/render/icons.ts'],
  p_visual: ['src/render/car.ts', 'src/render/audio.ts', 'src/render/race/dev'],
  p_ui: ['src/scenes/ShopScene.ts', 'src/scenes/StagingScene.ts', 'src/scenes/ResultScene.ts', 'src/scenes/VictoryScene.ts', 'src/render/shop/card.ts', 'src/render/shop/factory.ts', 'src/render/shop/packOverlay.ts', 'src/render/ui.ts'],
};

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
