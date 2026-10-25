// Writes devlog/status/activity.js every 10 s: which files each agent's area changed, and when.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..');
const OWNERS = {
  d3_core: ['src/scenes/Race3DScene.ts', 'src/render/three/renderer.ts', 'src/render/three/race/world.ts', 'src/render/three/race/hazards.ts'],
  d3_cine: ['src/render/three/race/camera.ts', 'src/render/three/race/fx.ts'],
  d3_env: ['src/render/three/env'],
  d3_look: ['src/render/three/materials.ts', 'src/render/three/post.ts', 'src/render/three/lighting.ts'],
  d3_carsA: ['src/render/three/cars/bodies/compact.ts', 'src/render/three/cars/bodies/sedan.ts', 'src/render/three/cars/bodies/hatch.ts', 'src/render/three/cars/bodies/truck.ts'],
  d3_carsB: ['src/render/three/cars/bodies/muscle.ts', 'src/render/three/cars/bodies/brick.ts', 'src/render/three/cars/bodies/widebody.ts', 'src/render/three/cars/bodies/super.ts'],
  d3_carsC: ['src/render/three/cars/bodies/tuner.ts', 'src/render/three/cars/bodies/wedge.ts', 'src/render/three/cars/bodies/hyper.ts'],
  d3_kit: ['src/render/three/cars/index.ts', 'src/render/three/cars/kit'],
  d3_show: ['src/render/three/showcase.ts', 'src/scenes/TitleScene.ts'],
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
