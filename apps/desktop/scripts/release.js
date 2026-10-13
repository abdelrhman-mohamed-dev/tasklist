// Copies the built Windows installer to releases/Tasklist-Setup.exe at the repo root.
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const exe = fs.readdirSync(dist).find(f => /^Tasklist Setup .*\.exe$/.test(f));
if (!exe) { console.error('No installer found in apps/desktop/dist. Run the build first.'); process.exit(1); }
const dest = path.join(__dirname, '..', '..', '..', 'releases', 'Tasklist-Setup.exe');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(path.join(dist, exe), dest);
console.log(`\nInstaller ready: releases/Tasklist-Setup.exe (${(fs.statSync(dest).size / 1048576).toFixed(0)} MB)`);
