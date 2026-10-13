// Captures real screenshots of Tasklist for the website (apps/website/assets/shots/).
// Run: npm run screenshots   (uses the desktop app's Electron; your own tasks are not touched)
// It starts the real desktop app with a throwaway profile and sample data, plus a tiny stand-in AI
// so the completion screenshot has something to show. No API key or network is needed.
const { app, BrowserWindow } = require('electron');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'apps', 'website', 'assets', 'shots');
const PROFILE = path.join(os.tmpdir(), `tasklist-shots-${Date.now()}`);
app.setPath('userData', PROFILE);
require(path.join(ROOT, 'apps', 'desktop', 'electron', 'main.js'));

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
let n = 0;
const id = () => `s${(++n).toString(36)}${Date.now().toString(36)}`;

// ---------- sample data ----------
function sampleData() {
  const now = Date.now();
  const P = (name, color) => ({ id: id(), name, color, updatedAt: now });
  const work = P('Work', '#2f6fdb'), home = P('Home', '#5fa83a'), launch = P('Portfolio launch', '#7a5af0'), move = P('Apartment move', '#e08a12');
  const T = (title, extra = {}) => ({ id: id(), title, desc: '', due: null, priority: 4, projectId: 'inbox', labels: [], repeat: null, done: false, doneAt: null, subtasks: [], created: now, order: now + n, updatedAt: now, ...extra });
  const sub = (titles, doneCount = 0) => titles.map((t, i) => ({ id: id(), title: t, done: i < doneCount }));
  const tasks = [
    T('Review the Q3 budget with Malak', { due: day(0), priority: 1, projectId: work.id, labels: ['finance'] }),
    T('Reply to the design agency about the logo files', { due: day(0), priority: 2, projectId: 'inbox' }),
    T('Water the plants', { due: day(0), projectId: home.id, repeat: 'weekly', labels: ['chores'] }),
    T('Book a dentist appointment', { due: day(-1), priority: 3, projectId: 'inbox', labels: ['health'] }),
    T('Prepare slides for the team meeting', { due: day(1), priority: 2, projectId: work.id, desc: 'Ten minutes, focus on the roadmap', subtasks: sub(['Outline', 'Gather numbers', 'Rehearse'], 1) }),
    T('Pay the electricity bill', { due: day(3), projectId: home.id, labels: ['bills'] }),
    T('Call Youssef about the weekend trip', { due: day(2), projectId: 'inbox' }),
    // roadmap project
    ...[['Research', [['Audit three competitor portfolios', 0, 3, true], ['Pick five projects to feature', 2, 2, true]]],
        ['Design', [['Sketch the homepage layout', 6, 2], ['Choose fonts and colours', 8, 3]]],
        ['Build', [['Write the first two case studies', 13, 1], ['Set up hosting and the domain', 16, 3], ['Add a contact form', 18, 4]]],
        ['Launch', [['Get feedback from two friends', 23, 3], ['Publish and share on LinkedIn', 27, 1]]]]
      .flatMap(([phase, items]) => items.map(([title, d, p, done]) => T(title, { due: day(d), priority: p, projectId: launch.id, phase, done: !!done, doneAt: done ? now : null }))),
    // mind map project
    T('Find movers', { projectId: move.id, subtasks: sub(['Get three quotes', 'Book the moving date'], 1) }),
    T('Pack room by room', { projectId: move.id, subtasks: sub(['Buy boxes and tape', 'Label boxes by room', 'Pack books first']) }),
    T('Change my address', { projectId: move.id, subtasks: sub(['Bank', 'Employer', 'Post office'], 2) }),
    T('Set up utilities', { projectId: move.id, subtasks: sub(['Internet', 'Electricity']) }),
    T('Plan the first week', { projectId: move.id, subtasks: sub(['Groceries', 'Meet the neighbours']) }),
  ];
  return { projects: [work, home, launch, move], tasks, tombstones: {} };
}

// ---------- stand-in AI (OpenAI-compatible) for the completion screenshot ----------
function startMockAI() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', '*');
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      let body = ''; req.on('data', c => body += c);
      req.on('end', () => {
        const prompt = (JSON.parse(body || '{}').messages || []).map(m => m.content).join('\n');
        const typed = (prompt.match(/Typed so far: "([^"]*)"/) || [])[1] || '';
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: `${typed} for Thursday's client review` } }] }));
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

async function shot(win, name) {
  await wait(700);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
  console.log('captured', name, img.getSize());
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { srv, port } = await startMockAI();
  await wait(3500);
  const main = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('index.html'));
  const js = (w, code) => w.webContents.executeJavaScript(code);
  const data = sampleData();
  const launchId = data.projects[2].id, moveId = data.projects[3].id;
  const ai = { enabled: true, provider: 'custom', base: `http://127.0.0.1:${port}/v1`, key: 'demo', model: 'demo', completion: true, suggestions: true };

  main.setContentSize(1280, 800); main.center(); main.show();
  const load = async (w, theme, modes = {}) => {
    // Replace whatever the app started with (its starter tasks may already be on the sync hub):
    // mark every item that isn't sample data as deleted, so sync removes it everywhere.
    await js(w, `(() => {
      const d = ${JSON.stringify(data)};
      const keep = new Set([...d.tasks, ...d.projects].map(x => x.id));
      let cur = {}; try { cur = JSON.parse(localStorage.getItem('tasklist.v1')) || {}; } catch (_) {}
      for (const x of [...(cur.tasks || []), ...(cur.projects || [])]) if (!keep.has(x.id)) d.tombstones[x.id] = Date.now() + 60000;
      localStorage.setItem('tasklist.v1', JSON.stringify(d));
    })()`);
    await js(w, `true;
      localStorage.setItem('tasklist.ai', ${JSON.stringify(JSON.stringify(ai))});
      localStorage.setItem('tasklist.theme', '${theme}');
      localStorage.setItem('tasklist.viewModes', ${JSON.stringify(JSON.stringify(modes))});
      localStorage.removeItem('tasklist.sidebar'); true`);
    w.webContents.reload();
    await wait(2000);
  };
  const clickNav = async (w, label) => { const ok = await js(w, `(() => { const a = [...document.querySelectorAll('.nav-item')].find(a => a.textContent.includes(${JSON.stringify(label)})); if (a) a.click(); return !!a; })()`); if (!ok) throw new Error(`nav item not found: ${label}`); };

  // Warm-up load: lets the starter data the app created on launch be replaced (and synced away) before capturing.
  await load(main, 'light'); await wait(1500);
  for (const theme of ['light', 'dark']) {
    await load(main, theme, { [launchId]: 'roadmap', [moveId]: 'mindmap' });
    await shot(main, `desktop-today-${theme}`);
    await clickNav(main, 'Portfolio launch'); await shot(main, `desktop-roadmap-${theme}`);
    await clickNav(main, 'Apartment move'); await wait(600); await shot(main, `desktop-mindmap-${theme}`);
    // quick add with an AI completion
    await clickNav(main, 'Today');
    await js(main, `document.getElementById('openQuickAdd').click()`); await wait(400);
    await js(main, `(() => { const i = document.getElementById('qaTitle'); i.focus(); i.value = 'Send the proposal to Lina tomorrow p1'; i.dispatchEvent(new Event('input')); })()`);
    await wait(1600); await shot(main, `desktop-completion-${theme}`);
    await js(main, `document.getElementById('qaCancel').click()`); await wait(300);
    // phone pairing dialog
    await js(main, `document.getElementById('connectPhone').click()`); await wait(900); await shot(main, `desktop-pair-${theme}`);
    await js(main, `document.getElementById('pairDone').click()`);
  }

  // phone: the same app served by the desktop sync hub, paired, at phone size
  const info = await js(main, 'window.desktop.pairInfo()');
  const phone = new BrowserWindow({ width: 390, height: 844, useContentSize: true, show: true, webPreferences: { contextIsolation: true, sandbox: true } });
  phone.webContents.setUserAgent('Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0 Mobile Safari/537.36');
  for (const theme of ['light', 'dark']) {
    await phone.loadURL(`http://127.0.0.1:${info.port}/`);
    await js(phone, `localStorage.setItem('tasklist.theme', '${theme}'); localStorage.setItem('tasklist.syncToken', ${JSON.stringify(info.url.split('#pair=')[1])}); true`);
    phone.webContents.reload();
    await wait(2500);
    await shot(phone, `phone-today-${theme}`);
    await js(phone, `document.getElementById('menuBtn').click()`); await wait(600);
    await shot(phone, `phone-menu-${theme}`);
  }

  srv.close();
  setTimeout(() => { try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch (_) {} app.exit(0); }, 300);
});
