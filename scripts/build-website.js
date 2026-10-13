// Prepares apps/website for serving or deploying:
//   packages/core  -> apps/website/app/        (the web version, plus the parser and icons the site reuses)
//   releases/*     -> apps/website/downloads/  (Windows installer and Android APK, when they've been built)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE = path.join(ROOT, 'apps', 'website');

const app = path.join(SITE, 'app');
fs.rmSync(app, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'packages', 'core'), app, { recursive: true });
console.log('Copied packages/core to apps/website/app/');

const downloads = path.join(SITE, 'downloads');
fs.rmSync(downloads, { recursive: true, force: true });
fs.mkdirSync(downloads, { recursive: true });
for (const file of ['Tasklist-Setup.exe', 'Tasklist.apk']) {
  const src = path.join(ROOT, 'releases', file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(downloads, file));
    console.log(`Copied releases/${file} to apps/website/downloads/`);
  } else {
    console.log(`releases/${file} not built yet; its download button will show as unavailable`);
  }
}
