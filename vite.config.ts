import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// The devlog status files are rewritten every few seconds. Vite must not watch them (that reloads the game
// mid-race), and unwatched files would be served from Vite's transform cache forever, so serve them raw.
function devlogRaw(): Plugin {
  return {
    name: 'devlog-raw',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (url !== '/devlog.html' && !url.startsWith('/devlog/')) return next();
        const file = path.join(server.config.root, decodeURIComponent(url));
        if (!file.startsWith(path.join(server.config.root, 'devlog')) && url !== '/devlog.html') return next();
        fs.readFile(file, (err, data) => {
          if (err) return next();
          res.setHeader('Content-Type', url.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(data);
        });
      });
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [devlogRaw()],
  server: { port: 5173, open: false, watch: { ignored: ['**/devlog/**', '**/devlog.html'] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
