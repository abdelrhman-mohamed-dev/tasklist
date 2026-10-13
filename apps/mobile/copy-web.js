// Copies the shared web app from packages/core into www/ for the Android build.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', 'packages', 'core');
const OUT = path.join(__dirname, 'www');
const FILES = ['index.html', 'styles.css', 'ai.css', 'icons.js', 'parser.js', 'sync.js', 'ai.js', 'mindmap.js', 'app.js', 'manifest.webmanifest', 'icons'];

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const f of FILES) fs.cpSync(path.join(SRC, f), path.join(OUT, f), { recursive: true });
console.log(`Copied ${FILES.length} items to www/`);
