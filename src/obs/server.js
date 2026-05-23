'use strict';

// ─── Serveur HTTP local pour OBS Browser Source ──────────────────────────────
// Expose une page d'overlay sans contrôles, accessible via http://localhost:PORT
// Diffuse les médias via Server-Sent Events (pas de dépendance WebSocket externe).

const http = require('http');
const path = require('path');
const fs   = require('fs');

const clients = new Set();
let server = null;
let currentPort = null;

function start(port = 7777) {
  if (server) {
    if (currentPort === port) return Promise.resolve(currentPort);
    stop();
  }
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      // CORS — autorise OBS et n'importe quel navigateur local
      res.setHeader('Access-Control-Allow-Origin', '*');

      const url = req.url.split('?')[0];

      if (url === '/' || url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(path.join(__dirname, 'browser-source.html')).pipe(res);
        return;
      }

      if (url === '/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection':    'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write(`event: hello\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
        clients.add(res);
        const keepAlive = setInterval(() => {
          try { res.write(`: ping\n\n`); } catch (_) {}
        }, 15000);
        req.on('close', () => { clearInterval(keepAlive); clients.delete(res); });
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    server.on('error', (err) => {
      server = null; currentPort = null;
      reject(err);
    });

    server.listen(port, '127.0.0.1', () => {
      currentPort = port;
      console.log(`[OBS] Serveur démarré sur http://127.0.0.1:${port}`);
      resolve(port);
    });
  });
}

function broadcast(eventName, payload) {
  if (!server) return;
  const data = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const c of clients) {
    try { c.write(data); } catch (_) {}
  }
}

function stop() {
  if (!server) return;
  for (const c of clients) { try { c.end(); } catch (_) {} }
  clients.clear();
  try { server.close(); } catch (_) {}
  server = null;
  currentPort = null;
  console.log('[OBS] Serveur arrêté');
}

function isRunning() { return !!server; }
function getPort()   { return currentPort; }

module.exports = { start, stop, broadcast, isRunning, getPort };
