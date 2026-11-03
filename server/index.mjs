// Studio server: static app, /api, /media, /data on http://localhost:4747 [core]
//
//   cd Studio && node server/index.mjs
//
// The request handling lives in app.mjs, shared with the Vercel function
// (api/index.mjs), so the local tool and the hosted tool answer the same way.

import http from 'node:http';
import { createHandler, MODULE_FILES } from './app.mjs';

const PORT = parseInt(process.env.PORT || '4747', 10);
const HOST = process.env.HOST || '127.0.0.1';

async function main() {
  const handler = await createHandler({ serveApp: true });
  const server = http.createServer(handler);

  server.listen(PORT, HOST, () => {
    const { modules, router } = handler;
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
