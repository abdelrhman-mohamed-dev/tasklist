// Copies the shared web app from packages/core into web/ for the Electron build.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', '..', 'packages', 'core');
const OUT = path.join(__dirname, '..', 'web');

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });
console.log(`Copied packages/core to ${path.relative(process.cwd(), OUT) || 'web'}/`);
