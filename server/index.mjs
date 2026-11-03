// Studio server: static app, /api, /media, /data on http://localhost:4747 [core]
//
//   cd Studio && node server/index.mjs
//
// Module files are mounted when present: each of rules.mjs, slots.mjs,
// video.mjs, recurring.mjs, images.mjs and link.mjs may export `routes` (see api.mjs)
// and `enrichToday`. Missing or broken files are reported and skipped, so the
// core runs on its own.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from './store.mjs';
import { createRouter, registerCoreRoutes, handleApi, sendJson } from './api.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = store.root;
const APP_DIR = path.join(ROOT, 'app');
const MEDIA_DIR = path.join(ROOT, 'media');
const PORT = parseInt(process.env.PORT || '4747', 10);
const HOST = process.env.HOST || '127.0.0.1';

const MODULE_FILES = ['rules', 'slots', 'video', 'recurring', 'images', 'link'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.otf': 'font/otf', '.ttf': 'font/ttf',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
};

async function loadModules() {
  const modules = {};
  for (const name of MODULE_FILES) {
    const file = path.join(here, `${name}.mjs`);
    if (!fs.existsSync(file)) { modules[name] = null; continue; }
    try {
      modules[name] = await import(`./${name}.mjs`);
    } catch (err) {
      console.error(`[studio] ${name}.mjs failed to load and was skipped: ${err.message}`);
      modules[name] = null;
    }
  }
  return modules;
}

function safeJoin(base, urlPath) {
  const decoded = decodeURIComponent(urlPath).replace(/\\/g, '/');
  const full = path.normalize(path.join(base, decoded));
  if (!full.startsWith(base + path.sep) && full !== base) return null;
  return full;
}

function serveFile(res, file, { cache = 'no-cache' } = {}) {
  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(file);
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': cache,
  });
  fs.createReadStream(file).pipe(res);
}

function serveStatic(req, res, url) {
  // /media/* from media/
  if (url.pathname.startsWith('/media/')) {
    const file = safeJoin(MEDIA_DIR, url.pathname.slice('/media/'.length));
    if (file && fs.existsSync(file) && fs.statSync(file).isFile()) return serveFile(res, file, { cache: 'public, max-age=3600' });
    return sendJson(res, 404, { error: 'Media not found' });
  }
  // /data/<collection>.json read-only, for inspection. Settings and the log hold the
  // link token, the PIN hashes and who did what, and the master registry lists every
  // company and its owners: never served raw. Other workspaces are not served here.
  if (url.pathname.startsWith('/data/')) {
    const file = safeJoin(store.dataDir, url.pathname.slice('/data/'.length));
    if (file && /\/(settings|log)\.json$/.test(file)) return sendJson(res, 403, { error: 'Not served; use the API' });
    if (file && /\/data\/(master|workspaces)(\/|$)/.test(file.slice(store.root.length))) return sendJson(res, 403, { error: 'Not served; use the API' });
    if (file && file.endsWith('.json') && fs.existsSync(file)) return serveFile(res, file);
    return sendJson(res, 404, { error: 'Not found' });
  }
  // app/ with index.html for anything that is not a file
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = safeJoin(APP_DIR, rel);
  if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const cache = /\/(fonts|img)\//.test(rel) ? 'public, max-age=86400' : 'no-cache';
    return serveFile(res, file, { cache });
  }
  if (path.extname(rel)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  return serveFile(res, path.join(APP_DIR, 'index.html'));
}

async function main() {
  const modules = await loadModules();
  const router = createRouter();
  // Module routes first, so a module can own a more specific path.
  for (const [name, mod] of Object.entries(modules)) {
    if (mod && Array.isArray(mod.routes)) router.mount(mod.routes, name);
  }
  registerCoreRoutes(router, modules);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        await handleApi(router, req, res, url);
      } else if (req.method === 'GET' || req.method === 'HEAD') {
        serveStatic(req, res, url);
      } else {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Method not allowed');
      }
    } catch (err) {
      console.error('[studio]', err);
      if (!res.headersSent) sendJson(res, 500, { error: err.message });
      else res.end();
    }
  });

  server.listen(PORT, HOST, () => {
    const loaded = MODULE_FILES.filter((m) => modules[m]).map((m) => `${m} (${modules[m].routes?.length || 0} routes)`);
    console.log(`Venture Drafters Studio on http://localhost:${PORT}`);
    console.log(`Modules: ${loaded.join(', ') || 'none'}`);
    console.log(`Routes: ${router.list().length}`);
  });

  const stop = () => { console.log('\nStudio stopping'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1000); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => { console.error(err); process.exit(1); });
