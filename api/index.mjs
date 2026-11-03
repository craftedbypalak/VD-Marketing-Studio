// Vercel function: every /api, /media and /data request lands here (vercel.json
// rewrites them), and the same handler as the local server answers it.
//
// The deployed code folder is read-only, so on a cold start the data is copied
// to /tmp and the store works on that copy. Changes there last only as long as
// this server instance: the hosted tool is a working preview until the Google
// Sheets store (docs/SPLIT-AND-HOSTING.md, section 3) keeps the data for good.
//
// Environment (Vercel project settings):
//   ANTHROPIC_API_KEY       AI steps run on the Claude API (there is no `claude` command here)
//   STUDIO_MEDIA_BASE_URL   where /media/* files live; see server/app.mjs for the default
//   STUDIO_AI_MODE          'api' or 'cli' to force; defaults to 'api' when a key is set

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN_ROOT = process.env.STUDIO_RUN_ROOT || '/tmp/studio';

function prepare() {
  const dataCopy = path.join(RUN_ROOT, 'data');
  if (!fs.existsSync(path.join(dataCopy, 'settings.json'))) {
    fs.mkdirSync(RUN_ROOT, { recursive: true });
    fs.cpSync(path.join(CODE_ROOT, 'data'), dataCopy, { recursive: true });
  }
  // The video hand-off reads the brand tokens and fonts from app/.
  const appLink = path.join(RUN_ROOT, 'app');
  if (!fs.existsSync(appLink) && fs.existsSync(path.join(CODE_ROOT, 'app'))) {
    try { fs.symlinkSync(path.join(CODE_ROOT, 'app'), appLink, 'dir'); } catch { /* optional */ }
  }
  process.env.STUDIO_ROOT = RUN_ROOT;
  process.env.STUDIO_EPHEMERAL = '1';
  if (!process.env.STUDIO_AI_MODE && process.env.ANTHROPIC_API_KEY) process.env.STUDIO_AI_MODE = 'api';
}

let ready = null;
function boot() {
  if (!ready) {
    ready = (async () => {
      prepare();
      // Imported only after STUDIO_ROOT is set: the store reads it once, at load.
      const { createHandler } = await import('../server/app.mjs');
      return createHandler({ serveApp: false });
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

export default async function handler(req, res) {
  let h;
  try {
    h = await boot();
  } catch (err) {
    console.error('[studio] boot failed', err);
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: `Studio could not start: ${err.message}` }));
    return;
  }
  return h(req, res);
}
