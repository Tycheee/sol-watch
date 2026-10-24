#!/usr/bin/env node
/**
 * Sol Watch — 可选夹具静态服务器（http://127.0.0.1:8765/fixture.html）
 * 仅用于在本机浏览器手动预览；扩展本身不依赖任何服务器。
 * 注意：Browser Use 后端禁访 127.0.0.1，自动化验证直接用 file:// 打开。
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8765;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.json': 'application/json'
};

createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const safe = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, safe === '/' ? 'test/fixture/fixture.html' : safe);
  if (!file.startsWith(ROOT) || !existsSync(file)) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(readFileSync(file));
}).listen(PORT, '127.0.0.1', () => {
  console.log(`fixture server: http://127.0.0.1:${PORT}/fixture.html`);
});
