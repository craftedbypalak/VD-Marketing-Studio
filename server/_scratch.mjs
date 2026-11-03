// Test helper: a throwaway Studio server on a copy of server/ and data/ in a
// temporary folder, on a free port, so a test never touches the real data.
//
//   import { startScratch } from './_scratch.mjs';
//   const { base, dataDir, stop } = await startScratch();
//   ...
//   await stop();

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
}

export async function startScratch({ label = 'studio-test' } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  fs.cpSync(path.join(root, 'server'), path.join(tmp, 'server'), { recursive: true });
  fs.cpSync(path.join(root, 'data'), path.join(tmp, 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'app'), { recursive: true });
  const port = await freePort();
  const child = spawn(process.execPath, ['server/index.mjs'], { cwd: tmp, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) break; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  const stop = async () => {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
    fs.rmSync(tmp, { recursive: true, force: true });
  };
  return { base, dataDir: path.join(tmp, 'data'), root: tmp, stop };
}
