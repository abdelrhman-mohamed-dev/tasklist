// Prepares apps/website for serving or deploying:
//   packages/core -> apps/website/app/  (the web version at /app/, plus the parser and icons the site reuses)
// Downloads are served from the repo's GitHub Releases, not from the site.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const app = path.join(ROOT, 'apps', 'website', 'app');
fs.rmSync(app, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'packages', 'core'), app, { recursive: true });
fs.rmSync(path.join(ROOT, 'apps', 'website', 'downloads'), { recursive: true, force: true }); // left over from older builds
console.log('Copied packages/core to apps/website/app/');
