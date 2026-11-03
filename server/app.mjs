// Studio request handler, shared by the local server (index.mjs) and the
// Vercel function (api/index.mjs). [core]
//
//   const handler = await createHandler({ serveApp: true });
//   http.createServer(handler).listen(4747);
//
// Module files are mounted when present: each of rules.mjs, slots.mjs,
// video.mjs, recurring.mjs, images.mjs and link.mjs may export `routes` (see api.mjs)
// and `enrichToday`. Missing or broken files are reported and skipped, so the
// core runs on its own.
//
// Media: a file under /media/ that is not on this machine is redirected to
// STUDIO_MEDIA_BASE_URL (a CDN, a bucket, a Drive proxy), so the heavy files
// never have to ship with the tool.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from './store.mjs';
import { createRouter, registerCoreRoutes, handleApi, sendJson } from './api.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
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
    if (!fs.existsSync(path.join(here, `${name}.mjs`))) { modules[name] = null; continue; }
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
  let decoded;
  try { decoded = decodeURIComponent(urlPath).replace(/\\/g, '/'); } catch { return null; }
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

// The media library left the repo on 3 November 2026; until it moves to Google
// Drive it is served from the last commit that held it (V1), through jsDelivr.
// STUDIO_MEDIA_BASE_URL overrides this; an empty value turns the redirect off.
export const DEFAULT_MEDIA_BASE = 'https://cdn.jsdelivr.net/gh/craftedbypalak/VD-Marketing-Studio@e6ba358f1e4599f3ee4999522cebe0dd185a1c6a/media';
const mediaBase = () => (process.env.STUDIO_MEDIA_BASE_URL ?? DEFAULT_MEDIA_BASE).replace(/\/+$/, '');

function serveMedia(res, url) {
  const rel = url.pathname.slice('/media/'.length);
  const file = safeJoin(path.join(store.root, 'media'), rel);
  if (file && fs.existsSync(file) && fs.statSync(file).isFile()) return serveFile(res, file, { cache: 'public, max-age=3600' });
  const base = mediaBase();
  if (file && base) {
    res.writeHead(302, { location: `${base}/${rel.split('/').map(encodeURIComponent).join('/')}`, 'cache-control': 'public, max-age=3600' });
    return res.end();
  }
  return sendJson(res, 404, { error: 'Media not found' });
}

// /data/<collection>.json read-only, for inspection. Settings and the log hold the
// link token, the PIN hashes and who did what, and the master registry lists every
// company and its owners: never served raw. Other workspaces are not served here.
function serveData(res, url) {
  const file = safeJoin(store.dataDir, url.pathname.slice('/data/'.length));
  if (file && /[/\\](settings|log)\.json$/.test(file)) return sendJson(res, 403, { error: 'Not served; use the API' });
  if (file && /[/\\]data[/\\](master|workspaces)([/\\]|$)/.test(file.slice(store.root.length))) return sendJson(res, 403, { error: 'Not served; use the API' });
  if (file && file.endsWith('.json') && fs.existsSync(file)) return serveFile(res, file);
  return sendJson(res, 404, { error: 'Not found' });
}

// app/ with index.html for anything that is not a file (local server only; on
// Vercel the app is served as static files).
function serveApp(res, url, appDir) {
  const rel = url.pathname === '/' ? '/index.html' : url.pathname;
  const file = safeJoin(appDir, rel);
  if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const cache = /\/(fonts|img)\//.test(rel) ? 'public, max-age=86400' : 'no-cache';
    return serveFile(res, file, { cache });
  }
  if (path.extname(rel)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  return serveFile(res, path.join(appDir, 'index.html'));
}

/**
 * Builds the router once and returns `(req, res) => Promise<void>`.
 *   serveApp: also serve app/ (the local server); off on Vercel.
 */
export async function createHandler({ serveApp: withApp = true, appDir = path.join(store.root, 'app') } = {}) {
  const modules = await loadModules();
  const router = createRouter();
  // Module routes first, so a module can own a more specific path.
  for (const [name, mod] of Object.entries(modules)) {
    if (mod && Array.isArray(mod.routes)) router.mount(mod.routes, name);
  }
  registerCoreRoutes(router, modules);

  const handler = async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    try {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        await handleApi(router, req, res, url);
      } else if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('Method not allowed');
      } else if (url.pathname.startsWith('/media/')) {
        serveMedia(res, url);
      } else if (url.pathname.startsWith('/data/')) {
        serveData(res, url);
      } else if (withApp) {
        serveApp(res, url, appDir);
      } else {
        sendJson(res, 404, { error: 'Not found' });
      }
    } catch (err) {
      console.error('[studio]', err);
      if (!res.headersSent) sendJson(res, 500, { error: err.message });
      else res.end();
    }
  };
  handler.router = router;
  handler.modules = modules;
  return handler;
}

export { MODULE_FILES };
