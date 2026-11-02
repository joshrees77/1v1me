import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {attachMultiplayer} from './multiplayer/server.mjs';

const root = fileURLToPath(new URL('./dist/', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  '.gz': 'application/gzip', '.bin': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8'
};
// Fail startup rather than reporting healthy when the packaged game is missing.
await stat(path.join(root, 'index.html'));
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-cache');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }); res.end('Method not allowed'); return;
  }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); res.end('Invalid URL'); return; }
  if (pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(req.method === 'HEAD' ? undefined : '{"status":"ok"}'); return;
  }
  const target = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative) || pathname.includes('\0') || pathname.split('/').some(part => part.startsWith('.'))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Content-Length': info.size });
    if (req.method === 'HEAD') { res.end(); return; }
    // map.bin.gz is decompressed by the game itself. Do not set Content-Encoding.
    await pipeline(createReadStream(target), res);
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    const missing = ['ENOENT', 'ENOTDIR'].includes(error.code);
    res.writeHead(missing ? 404 : 500); res.end(missing ? 'Not found' : 'Server error');
  }
});
const stopMultiplayer = await attachMultiplayer(server);
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '0.0.0.0';
server.listen(port, host, () => console.log(`Listening on http://${host}:${server.address().port}`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopMultiplayer(); server.close(() => process.exit(0)); });
