// Local sync hub: serves the web app to phones on the same Wi-Fi and merges their tasks with this PC.
// Data never leaves the local network. The API requires a pairing token that is shown only as a QR code.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const TaskSync = require('../web/sync.js');

const APP_DIR = path.join(__dirname, '..', 'web'); // copy of packages/core
const STATIC = new Set(['index.html', 'styles.css', 'icons.js', 'parser.js', 'sync.js', 'ai.js', 'ai.css', 'mindmap.js', 'app.js', 'manifest.webmanifest', 'sw.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png']);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const MAX_BODY = 5 * 1024 * 1024;

function createHub({ dataDir, onRemoteChange }) {
  const dataFile = path.join(dataDir, 'sync-state.json');
  const tokenFile = path.join(dataDir, 'sync-token');
  let token;
  try { token = fs.readFileSync(tokenFile, 'utf8').trim(); } catch (_) {}
  if (!token || token.length < 32) { token = crypto.randomBytes(24).toString('hex'); fs.writeFileSync(tokenFile, token); }

  let data;
  try { data = TaskSync.normalize(JSON.parse(fs.readFileSync(dataFile, 'utf8'))); } catch (_) { data = TaskSync.empty(); }
  let writeTimer = null;
  const persist = () => {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(() => {
      const tmp = dataFile + '.tmp';
      fs.writeFile(tmp, JSON.stringify(data), (err) => { if (!err) fs.rename(tmp, dataFile, () => {}); });
    }, 300);
  };

  // Merge an incoming state into the hub; returns the merged state.
  function sync(incoming, fromRemote) {
    const merged = TaskSync.merge(data, incoming);
    if (!TaskSync.same(merged, data)) {
      data = merged; persist();
      if (fromRemote && onRemoteChange) onRemoteChange();
    }
    return data;
  }

  const authorized = (req) => {
    const h = String(req.headers.authorization || '');
    const given = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '');
    const want = Buffer.from(token);
    return given.length === want.length && crypto.timingSafeEqual(given, want);
  };
  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  const readJson = (req, cb) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) req.destroy(); else chunks.push(c); });
    req.on('end', () => { try { cb(null, JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { cb(e); } });
  };

  // 6-digit pairing code for the Android app: shown in the PC's Connect dialog, valid 10 minutes, 8 wrong tries max.
  let pairCode = null;
  function newPairCode() {
    pairCode = { code: String(crypto.randomInt(0, 1e6)).padStart(6, '0'), expires: Date.now() + 10 * 60e3, tries: 0 };
    return pairCode.code;
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      // The Android app's page runs on its own origin and authenticates with a bearer token (no cookies), so CORS is safe.
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '600');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      if (url.pathname === '/api/pair' && req.method === 'POST') {
        return readJson(req, (err, body) => {
          if (err || !pairCode || Date.now() > pairCode.expires) return send(res, 410, { error: 'Code expired. Open Connect on your PC for a new one.' });
          const given = Buffer.from(String(body.code || '').replace(/\D/g, '').padEnd(6, 'x').slice(0, 6));
          if (!crypto.timingSafeEqual(given, Buffer.from(pairCode.code))) {
            if (++pairCode.tries >= 8) pairCode = null;
            return send(res, 403, { error: 'Wrong code' });
          }
          pairCode = null;
          send(res, 200, { token, name: os.hostname() });
        });
      }
      if (!authorized(req)) return send(res, 401, { error: 'not paired' });
      if (url.pathname === '/api/ping' && req.method === 'GET') return send(res, 200, { ok: true, name: os.hostname() });
      if (url.pathname === '/api/sync' && req.method === 'POST') {
        return readJson(req, (err, body) => (err ? send(res, 400, { error: 'bad request' }) : send(res, 200, sync(body, true))));
      }
      return send(res, 404, { error: 'not found' });
    }
    if (req.method !== 'GET') return send(res, 405, 'Method not allowed', 'text/plain');
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    if (!STATIC.has(rel)) return send(res, 404, 'Not found', 'text/plain');
    fs.readFile(path.join(APP_DIR, rel), (err, buf) => {
      if (err) return send(res, 404, 'Not found', 'text/plain');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(rel)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.end(buf);
    });
  });

  let port = null;
  function listen(start = 5180, tries = 10) {
    return new Promise((resolve) => {
      const attempt = (p, left) => {
        server.once('error', (err) => { if (err.code === 'EADDRINUSE' && left > 0) attempt(p + 1, left - 1); else resolve(null); });
        server.listen(p, '0.0.0.0', () => { port = p; resolve(p); });
      };
      attempt(start, tries);
    });
  }

  function lanAddress() {
    const skip = /vethernet|virtualbox|vmware|wsl|hyper-v|loopback|docker|tailscale|zerotier/i;
    const all = Object.entries(os.networkInterfaces())
      .flatMap(([name, list]) => (list || []).map(a => ({ name, ...a })))
      .filter(a => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254'));
    const preferred = all.filter(a => !skip.test(a.name));
    const pick = preferred.find(a => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a.address)) || preferred[0] || all[0];
    return pick ? pick.address : null;
  }

  function pairInfo() {
    const ip = lanAddress();
    return {
      ip, port,
      url: ip && port ? `http://${ip}:${port}/#pair=${token}` : null,
      plainUrl: ip && port ? `http://${ip}:${port}` : null,
      address: ip && port ? `${ip}:${port}` : null,
      code: newPairCode(),
    };
  }

  function resetToken() {
    token = crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(tokenFile, token);
    return pairInfo();
  }

  return { listen, sync, pairInfo, resetToken, close: () => server.close() };
}

module.exports = { createHub };
