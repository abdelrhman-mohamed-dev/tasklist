// Minimal static server: node scripts/serve.js <folder> [port]
//   node scripts/serve.js packages/core 5173   -> the Tasklist web app
//   node scripts/serve.js apps/website 5175    -> the landing site
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'packages', 'core'));
const PORT = Number(process.argv[3]) || Number(process.env.PORT) || 5173;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.apk': 'application/vnd.android.package-archive', '.exe': 'application/octet-stream',
};

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const file = path.join(ROOT, urlPath);
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size };
    if (/\.(apk|exe)$/.test(file)) headers['Content-Disposition'] = `attachment; filename="${path.basename(file)}"`;
    res.writeHead(200, headers);
    fs.createReadStream(file).pipe(res);
  });
}).listen(PORT, () => console.log(`Serving ${path.relative(process.cwd(), ROOT) || '.'} at http://localhost:${PORT}`));
