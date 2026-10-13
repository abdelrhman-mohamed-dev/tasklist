// Generates the Android launcher icons and launch screen from the shared icon drawing.
const fs = require('fs');
const path = require('path');
const { draw } = require('../../scripts/make-icons.js');

const RES = path.join(__dirname, 'android', 'app', 'src', 'main', 'res');
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const write = (rel, buf) => { const f = path.join(RES, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf); };

for (const [d, k] of Object.entries(DENSITIES)) {
  write(`mipmap-${d}/ic_launcher.png`, draw(Math.round(48 * k)));
  write(`mipmap-${d}/ic_launcher_round.png`, draw(Math.round(48 * k), { radius: 0.5 }));
  // adaptive icon foreground: 108dp canvas, white check inside the 66dp safe zone, on the red background color
  write(`mipmap-${d}/ic_launcher_foreground.png`, draw(Math.round(108 * k), { markOnly: true, markScale: 0.95 }));
}

// Replace Capacitor's placeholder splash images with a plain launch background (Android 12+ shows the app icon on it).
for (const dir of fs.readdirSync(RES)) {
  const f = path.join(RES, dir, 'splash.png');
  if (fs.existsSync(f)) fs.rmSync(f);
}
for (const f of ['drawable-v24/ic_launcher_foreground.xml', 'drawable/ic_launcher_background.xml']) fs.rmSync(path.join(RES, f), { force: true });
fs.readdirSync(RES).filter(d => /^drawable-(land|port)-/.test(d) && !fs.readdirSync(path.join(RES, d)).length).forEach(d => fs.rmdirSync(path.join(RES, d)));

write('drawable/splash.xml', `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="@color/launch_background" />
</shape>
`);
write('values/ic_launcher_background.xml', `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#D1493C</color>
</resources>
`);
write('values/colors.xml', `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">#D1493C</color>
    <color name="colorPrimaryDark">#BD3C30</color>
    <color name="colorAccent">#D1493C</color>
    <color name="launch_background">#FDFCFA</color>
</resources>
`);
write('values-night/colors.xml', `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="launch_background">#1A1918</color>
</resources>
`);
console.log('Android icons and launch screen written');
