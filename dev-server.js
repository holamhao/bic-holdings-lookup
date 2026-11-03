// Local stand-in for Vercel: serves public/ statically and routes the API paths
// to the same handlers Vercel deploys. Run with `npm run dev`.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import lookupHandler from './api/lookup.js';
import lookupBatchHandler from './api/lookup-batch.js';

const PORT = Number(process.env.PORT) || 3000;
const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
const apiRoutes = { '/api/lookup': lookupHandler, '/api/lookup-batch': lookupBatchHandler };
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
};

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (apiRoutes[pathname]) return apiRoutes[pathname](req, res);

  const file = join(publicDir, pathname === '/' ? 'index.html' : pathname);
  const contentType = contentTypes[extname(file)];
  if (contentType && file.startsWith(publicDir)) {
    try {
      const body = await readFile(file);
      res.setHeader('Content-Type', contentType);
      return res.end(body);
    } catch {
      // Missing file: fall through to 404.
    }
  }
  res.statusCode = 404;
  res.end('Not found');
}).listen(PORT, () => console.log(`BIC checker: http://localhost:${PORT}`));
