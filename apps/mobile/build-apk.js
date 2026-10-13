// Builds the signed release APK and copies it to releases/Tasklist.apk at the repo root.
// Uses Android Studio's bundled Java when JAVA_HOME isn't set (the Android build needs Java 17+).
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const env = { ...process.env };
if (!env.JAVA_HOME) {
  const candidates = [
    'C:\\Program Files\\Android\\Android Studio\\jbr',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Android Studio', 'jbr'),
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
  ];
  const jbr = candidates.find(p => fs.existsSync(path.join(p, 'bin')));
  if (jbr) env.JAVA_HOME = jbr;
  else console.warn('JAVA_HOME is not set and Android Studio\'s Java was not found; the build may fail.');
}

const run = (cmd, cwd) => execSync(cmd, { cwd, env, stdio: 'inherit' });
run('node copy-web.js', __dirname);
run('npx cap sync android', __dirname);
// Full path: some Windows shells don't look in the current folder for gradlew.bat.
const androidDir = path.join(__dirname, 'android');
run(`"${path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')}" assembleRelease`, androidDir);

const apk = path.join(__dirname, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const dest = path.join(__dirname, '..', '..', 'releases', 'Tasklist.apk');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(apk, dest);
console.log(`\nAPK ready: ${path.relative(process.cwd(), dest)} (${(fs.statSync(dest).size / 1048576).toFixed(1)} MB)`);
