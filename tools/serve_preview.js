#!/usr/bin/env node
'use strict';
/**
 * serve_preview.js - build the browser bundle, serve web/, open the preview.
 *
 *   node tools/serve_preview.js
 *   npm run preview
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const PORT = Number(process.env.PORT) || 8765;

console.log('Building web/bundle.js …');
const build = spawnSync('python3', [path.join(ROOT, 'tools/build_web.py'), 'web'], {
  cwd: ROOT, stdio: 'inherit',
});
if (build.status !== 0) process.exit(build.status || 1);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(WEB, url.replace(/^\//, '')));
  if (!file.startsWith(WEB)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + PORT + '/';
  console.log('Preview: ' + url);
  const open = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try { spawnSync(open, [url], { stdio: 'ignore', shell: process.platform === 'win32' }); } catch (e) { /* ignore */ }
});
