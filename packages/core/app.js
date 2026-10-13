(function () {
  const { parse, iso, addDays } = window.TaskParser;
  const { svg, hydrate } = window.Icons;
  const STORE_KEY = 'tasklist.v1';
  const COLORS = ['#d1453b', '#e08a12', '#c9a400', '#5fa83a', '#1f8a4c', '#1a9bc4', '#2f6fdb', '#7a5af0', '#c561c5', '#8f8981'];
  const $ = (id) => document.getElementById(id);
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} },
  };
  const CHECK_SVG = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle class="ring" cx="10" cy="10" r="8.6"/><path class="tick" d="M6.3 10.4l2.6 2.5 4.9-5.2"/></svg>';

  // ---------- state ----------
  function seed() {
    const today = new Date();
    const work = { id: uid(), name: 'Work', color: '#2f6fdb' };
    const home = { id: uid(), name: 'Home', color: '#5fa83a' };
    const t = (title, extra) => ({ id: uid(), title, desc: '', due: null, priority: 4, projectId: 'inbox', labels: [], repeat: null, done: false, doneAt: null, subtasks: [], created: Date.now(), order: Date.now() + Math.random(), ...extra });
    return {
      projects: [work, home],
      tasks: [
        t('Add a task with the + button (or press Q)', { due: iso(today), priority: 1 }),
        t('Try natural language: “Gym tomorrow p2 #Home @health”', { due: iso(today) }),
        t('Prepare weekly report', { due: iso(addDays(today, 2)), projectId: work.id, priority: 2, labels: ['reports'] }),
        t('Water the plants', { due: iso(today), projectId: home.id, repeat: 'weekly', labels: ['chores'] }),
        t('Plan the trip', { projectId: home.id, desc: 'Lisbon, early spring', subtasks: [{ id: uid(), title: 'Book flights', done: false }, { id: uid(), title: 'Pick hotel', done: true }] }),
      ],
    };
  }
  // Phone pairing: the desktop app's QR code opens this page with #pair=<token>.
  const TOKEN_KEY = 'tasklist.syncToken';
  const pairMatch = location.hash.match(/^#pair=([a-f0-9]{48})$/);
  if (pairMatch) {
    store.set(TOKEN_KEY, pairMatch[1]);
    history.replaceState(null, '', location.pathname + location.search);
  }
  const isDesktop = !!(window.desktop && window.desktop.isDesktop);
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); // Android app
  const HOST_KEY = 'tasklist.syncHost';   // Android app only: "192.168.1.6:5180"
  const SEED_KEY = 'tasklist.untouchedSeed';
  let syncMode = isDesktop ? 'desktop' : store.get(TOKEN_KEY) ? 'phone' : null;
  if (isNative) document.documentElement.classList.add('native');

  function load() {
    try { const s = JSON.parse(store.get(STORE_KEY)); if (s && s.tasks) return s; } catch (_) {}
    if (syncMode === 'phone') return TaskSync.empty(); // a freshly paired phone starts empty and pulls from the PC
    store.set(SEED_KEY, '1');
    return seed();
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  let state = TaskSync.normalize(load());
  let lastSaved = clone(state);
  TaskSync.track(lastSaved, state); // stamp items saved before sync existed
  lastSaved = clone(state);
  const save = () => {
    TaskSync.track(lastSaved, state);
    lastSaved = clone(state);
    store.set(STORE_KEY, JSON.stringify(state));
    try { localStorage.removeItem(SEED_KEY); } catch (_) {}
    scheduleSync();
  };

  let view = { type: 'today' };
  let query = '';
  let showDone = false;
  let editingId = null;
  let selectedId = null;
  let animateEntry = true;
  let lastAddedId = null;
  let undoFn = null, toastTimer = null;

  // ---------- helpers ----------
  const todayIso = () => iso(new Date());
  const projectById = (id) => state.projects.find(p => p.id === id);
  const projectOf = (t) => t.projectId === 'inbox' ? { name: 'Inbox', color: null, inbox: true } : projectById(t.projectId) || { name: 'Inbox', color: null, inbox: true };
  const allLabels = () => [...new Set(state.tasks.flatMap(t => t.labels))].sort();
  const sortTasks = (a, b) => (a.done - b.done) || ((a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0) || (a.priority - b.priority) || (a.order - b.order);
  const dayDiff = (due) => Math.round((new Date(due + 'T00:00') - new Date(todayIso() + 'T00:00')) / 864e5);
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function fmtDue(due) {
    if (!due) return '';
    const n = dayDiff(due);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n === -1) return 'Yesterday';
    const d = new Date(due + 'T00:00');
    if (n > 1 && n < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
  }
  const dueClass = (due, done) => { if (!due || done) return ''; const n = dayDiff(due); return n < 0 ? 'overdue' : n === 0 ? 'today' : n < 7 ? 'soon' : ''; };

  function resolveProject(name) {
    if (!name) return null;
    if (name.toLowerCase() === 'inbox') return 'inbox';
    let p = state.projects.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (!p) { p = { id: uid(), name, color: COLORS[state.projects.length % COLORS.length] }; state.projects.push(p); }
    return p.id;
  }
  const defaultProject = () => view.type === 'project' ? view.id : 'inbox';
  const defaultDue = () => view.type === 'today' ? todayIso() : null;

  // ---------- task ops ----------
  function addTask(fields) {
    const task = { id: uid(), title: '', desc: '', due: null, priority: 4, projectId: 'inbox', labels: [], repeat: null, done: false, doneAt: null, subtasks: [], created: Date.now(), order: Date.now(), ...fields };
    state.tasks.push(task); save();
    lastAddedId = task.id;
    render();
    toast(`Added to ${projectOf(task).name}`, () => { state.tasks = state.tasks.filter(x => x.id !== task.id); });
  }
  function addFromText(text, overrides = {}) {
    const p = parse(text);
    if (!p.title) return;
    addTask({
      title: p.title, priority: p.priority, labels: p.labels, repeat: p.repeat,
      due: p.due || ('due' in overrides ? overrides.due : defaultDue()),
      projectId: resolveProject(p.project) || overrides.projectId || defaultProject(),
      desc: overrides.desc || '',
    });
  }
  function nextDue(due, repeat) {
    const d = new Date((due || todayIso()) + 'T00:00');
    if (repeat === 'daily') d.setDate(d.getDate() + 1);
    if (repeat === 'weekly') d.setDate(d.getDate() + 7);
    if (repeat === 'monthly') d.setMonth(d.getMonth() + 1);
    return iso(d);
  }
  function toggleDone(id) {
    const t = state.tasks.find(x => x.id === id); if (!t) return;
    const before = { ...t };
    if (!t.done && t.repeat) {
      t.due = nextDue(t.due, t.repeat);
      toast(`Next one: ${fmtDue(t.due)}`, () => Object.assign(t, before));
    } else {
      t.done = !t.done; t.doneAt = t.done ? Date.now() : null;
      if (t.done) toast('Task completed', () => Object.assign(t, before));
    }
    save(); render();
  }
  // Animate the checkbox, collapse the row, then commit.
  function completeWithAnimation(id, wrap) {
    const t = state.tasks.find(x => x.id === id); if (!t) return;
    const btn = wrap && wrap.querySelector('.check');
    if (!wrap || t.done) return toggleDone(id);
    btn.classList.add('checked');
    const stays = t.repeat || showDone;
    setTimeout(() => {
      if (stays) return toggleDone(id);
      wrap.querySelector('.task').classList.add('leaving');
      wrap.classList.add('collapse');
      setTimeout(() => toggleDone(id), 260);
    }, 320);
  }
  function deleteTask(id, wrap) {
    const i = state.tasks.findIndex(x => x.id === id); if (i < 0) return;
    const commit = () => {
      const [t] = state.tasks.splice(i, 1);
      if (selectedId === id) selectedId = null;
      save(); render();
      toast('Task deleted', () => state.tasks.splice(i, 0, t));
    };
    if (!wrap) return commit();
    wrap.querySelector('.task').classList.add('leaving'); wrap.classList.add('collapse');
    setTimeout(commit, 260);
  }

  // ---------- toast ----------
  function toast(msg, undo) {
    $('toastMsg').textContent = msg;
    undoFn = undo || null;
    $('toastUndo').hidden = !undo;
    $('toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 4500);
  }
  function hideToast() { $('toast').classList.remove('show'); undoFn = null; }
  $('toastUndo').onclick = () => { if (undoFn) { undoFn(); save(); render(); } hideToast(); };
  $('toastClose').onclick = hideToast;

  // ---------- overlays ----------
  function openOverlay(el) { el.classList.remove('closing'); el.hidden = false; }
  function closeOverlay(el) {
    if (el.hidden || el.classList.contains('closing')) return;
    if (el.contains(document.activeElement)) document.activeElement.blur();
    el.classList.add('closing');
    setTimeout(() => { el.hidden = true; el.classList.remove('closing'); }, 160);
  }
  function confirmBox(title, text, yesLabel = 'Delete') {
    $('confirmTitle').textContent = title; $('confirmText').textContent = text; $('confirmYes').textContent = yesLabel;
    openOverlay($('confirmBox')); $('confirmYes').focus();
    return new Promise((resolve) => {
      const done = (v) => { $('confirmYes').onclick = $('confirmNo').onclick = null; closeOverlay($('confirmBox')); resolve(v); };
      $('confirmYes').onclick = () => done(true);
      $('confirmNo').onclick = () => done(false);
      $('confirmBox').onmousedown = (e) => { if (e.target === $('confirmBox')) done(false); };
    });
  }

  // ---------- view filtering ----------
  function visibleTasks() {
    let list = state.tasks.filter(t => showDone || !t.done);
    if (query) {
      const q = query.toLowerCase();
      return list.filter(t => t.title.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q) || t.labels.some(l => l.includes(q)));
    }
    const t = todayIso();
    switch (view.type) {
      case 'inbox': return list.filter(x => x.projectId === 'inbox');
      case 'today': return list.filter(x => x.due && x.due <= t && (!x.done || x.due === t));
      case 'upcoming': return list.filter(x => x.due && x.due >= t);
      case 'project': return list.filter(x => x.projectId === view.id);
      case 'label': return list.filter(x => x.labels.includes(view.name));
      case 'completed': return state.tasks.filter(x => x.done).sort((a, b) => b.doneAt - a.doneAt);
    }
    return list;
  }

  function groups(tasks) {
    const t = todayIso();
    if (query) return [{ tasks }];
    if (view.type === 'today') {
      const over = tasks.filter(x => x.due < t), today = tasks.filter(x => x.due === t);
      const out = [];
      if (over.length) out.push({ title: 'Overdue', cls: 'overdue', tasks: over });
      out.push({ title: 'Today', cls: 'is-today', sub: new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), tasks: today, addDue: t, hideIfEmpty: !over.length });
      return out;
    }
    if (view.type === 'upcoming') {
      const out = [];
      for (let i = 0; i < 14; i++) {
        const d = iso(addDays(new Date(), i));
        const date = new Date(d + 'T00:00');
        out.push({
          title: date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
          sub: i < 2 ? `${fmtDue(d)} · ${date.toLocaleDateString(undefined, { weekday: 'long' })}` : date.toLocaleDateString(undefined, { weekday: 'long' }),
          cls: i === 0 ? 'is-today' : '', tasks: tasks.filter(x => x.due === d), addDue: d,
        });
      }
      const later = tasks.filter(x => x.due > iso(addDays(new Date(), 13)));
      if (later.length) out.push({ title: 'Later', tasks: later });
      return out;
    }
    return [{ tasks }];
  }

  // ---------- rendering ----------
  function navItem({ label, icon, active, count, onClick, color, iconCls = '' }) {
    const a = document.createElement('a');
    a.href = '#'; a.className = 'nav-item' + (active ? ' active' : '');
    if (active) a.setAttribute('aria-current', 'page');
    a.innerHTML = `<span class="nav-icon ${iconCls}" ${color ? `style="color:${color}"` : ''}>${icon}</span><span class="nav-label"></span><span class="count">${count || ''}</span>`;
    a.querySelector('.nav-label').textContent = label;
    a.onclick = (e) => { e.preventDefault(); onClick(); document.body.classList.remove('nav-open'); };
    return a;
  }
  function setView(v) {
    view = v; query = ''; $('search').value = ''; selectedId = null; animateEntry = true;
    render();
    $('main').scrollTop = 0;
  }
  const sameView = (v) => !query && view.type === v.type && view.id === v.id && view.name === v.name;

  function renderNav() {
    const open = state.tasks.filter(t => !t.done), t = todayIso();
    const todayIcon = `<span class="today-num">${svg('today', 'i-today')}<b>${new Date().getDate()}</b></span>`;
    const main = $('mainNav'); main.innerHTML = '';
    main.append(
      navItem({ label: 'Inbox', icon: svg('inbox', 'i-inbox'), active: sameView({ type: 'inbox' }), count: open.filter(x => x.projectId === 'inbox').length, onClick: () => setView({ type: 'inbox' }) }),
      navItem({ label: 'Today', icon: todayIcon, active: sameView({ type: 'today' }), count: open.filter(x => x.due && x.due <= t).length, onClick: () => setView({ type: 'today' }) }),
      navItem({ label: 'Upcoming', icon: svg('upcoming', 'i-upcoming'), active: sameView({ type: 'upcoming' }), onClick: () => setView({ type: 'upcoming' }) }),
      navItem({ label: 'Completed', icon: svg('done', 'i-done'), active: sameView({ type: 'completed' }), onClick: () => setView({ type: 'completed' }) }),
    );
    const pn = $('projectNav'); pn.innerHTML = '';
    state.projects.forEach(p => pn.append(navItem({ label: p.name, icon: svg('hash'), iconCls: 'proj-hash', color: p.color, active: sameView({ type: 'project', id: p.id }), count: open.filter(x => x.projectId === p.id).length, onClick: () => setView({ type: 'project', id: p.id }) })));
    const labels = allLabels();
    $('labelSection').hidden = !labels.length;
    const ln = $('labelNav'); ln.innerHTML = '';
    labels.forEach(l => ln.append(navItem({ label: l, icon: svg('tag'), color: 'var(--muted)', active: sameView({ type: 'label', name: l }), count: open.filter(x => x.labels.includes(l)).length, onClick: () => setView({ type: 'label', name: l }) })));
  }

  function taskEl(task, index) {
    const wrap = document.createElement('li');
    wrap.className = 'task-wrap'; wrap.dataset.id = task.id; wrap.draggable = !task.done;
    const proj = projectOf(task);
    const subDone = task.subtasks.filter(s => s.done).length;
    const showProj = view.type !== 'project' || query;
    const dc = dueClass(task.due, task.done);
    const meta = [
      task.due ? `<span class="meta ${dc}">${svg(task.repeat ? 'repeat' : 'calendar')}${esc(fmtDue(task.due))}</span>` : '',
      task.subtasks.length ? `<span class="meta">${svg('subtasks')}${subDone}/${task.subtasks.length}</span>` : '',
      ...task.labels.map(l => `<span class="meta label">${svg('tag')}${esc(l)}</span>`),
      showProj ? `<span class="meta proj" style="--pc:${proj.color || 'var(--muted)'}">${esc(proj.name)}${svg(proj.inbox ? 'inbox' : 'hash')}</span>` : '',
    ].join('');
    const cls = ['task', `p${task.priority}`, task.done && 'done', task.id === selectedId && 'selected', animateEntry && 'enter', task.id === lastAddedId && 'added'].filter(Boolean).join(' ');
    wrap.innerHTML = `
      <div class="${cls}" style="--i:${Math.min(index, 14)}">
        <button class="check" aria-label="${task.done ? 'Mark incomplete' : 'Complete task'}">${CHECK_SVG}</button>
        <div class="task-body">
          <div class="task-title">${esc(task.title)}</div>
          <div class="task-desc">${esc(task.desc.split('\n')[0])}</div>
          <div class="task-meta">${meta}</div>
        </div>
        <div class="row-actions">
          <button class="icon-btn act-edit" title="Edit" aria-label="Edit task">${svg('edit')}</button>
          <button class="icon-btn danger act-del" title="Delete" aria-label="Delete task">${svg('trash')}</button>
        </div>
      </div>`;
    const row = wrap.firstElementChild;
    wrap.querySelector('.check').onclick = (e) => { e.stopPropagation(); completeWithAnimation(task.id, wrap); };
    wrap.querySelector('.act-del').onclick = (e) => { e.stopPropagation(); deleteTask(task.id, wrap); };
    wrap.querySelector('.act-edit').onclick = (e) => { e.stopPropagation(); openDetail(task.id); };
    row.onclick = () => { select(task.id); openDetail(task.id); };
    wrap.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', task.id); e.dataTransfer.effectAllowed = 'move'; setTimeout(() => row.classList.add('dragging'), 0); });
    wrap.addEventListener('dragend', () => { row.classList.remove('dragging'); document.querySelectorAll('.drop-hint').forEach(x => x.classList.remove('drop-hint')); });
    return wrap;
  }

  function enableDrop(ul, group) {
    ul.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = document.querySelector('.task.dragging'); if (!dragging) return;
      const wrapEl = dragging.parentElement;
      const after = [...ul.querySelectorAll('.task-wrap')].filter(x => x !== wrapEl).find(el => e.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2);
      after ? ul.insertBefore(wrapEl, after) : ul.appendChild(wrapEl);
      document.querySelectorAll('.drop-hint').forEach(x => x !== ul && x.classList.remove('drop-hint'));
      if (view.type === 'upcoming') ul.classList.add('drop-hint');
    });
    ul.addEventListener('drop', (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      const t = state.tasks.find(x => x.id === id);
      if (t && group.addDue && view.type === 'upcoming') t.due = group.addDue;
      [...ul.querySelectorAll('.task-wrap')].forEach((el, i) => { const x = state.tasks.find(y => y.id === el.dataset.id); if (x) x.order = i; });
      save(); render();
    });
  }

  function emptyState() {
    const copy = query ? ['Nothing matches', `No tasks contain “${query}”.`]
      : view.type === 'today' ? ['You’re all done for today', 'Enjoy the rest of your day, or plan ahead in Upcoming.']
      : view.type === 'completed' ? ['No completed tasks yet', 'Tasks you check off will show up here.']
      : ['No tasks here', 'Add one below, or press Q from anywhere.'];
    return `<div class="empty"><div class="empty-art">${svg(view.type === 'completed' ? 'done' : 'leaf')}</div><h3>${esc(copy[0])}</h3><p>${esc(copy[1])}</p></div>`;
  }

  function renderTasks() {
    const area = $('taskArea'); area.innerHTML = '';
    const tasks = visibleTasks();
    if (view.type !== 'completed') tasks.sort(sortTasks);
    let index = 0, any = false;
    groups(tasks).forEach(g => {
      if (g.hideIfEmpty && !g.tasks.length) return;
      const sec = document.createElement('section'); sec.className = 'group';
      if (g.title) {
        const h = document.createElement('div'); h.className = 'group-head ' + (g.cls || '');
        h.innerHTML = `<h2></h2><span class="sub"></span><span class="count">${g.tasks.length || ''}</span>`;
        h.querySelector('h2').textContent = g.title; h.querySelector('.sub').textContent = g.sub || '';
        sec.append(h);
      }
      const ul = document.createElement('ul'); ul.className = 'task-list';
      g.tasks.forEach(t => { ul.append(taskEl(t, index++)); any = true; });
      enableDrop(ul, g);
      sec.append(ul);
      if (view.type === 'upcoming' && g.addDue) {
        const add = document.createElement('button'); add.className = 'mini-add';
        add.innerHTML = `<span class="add-dot">${svg('plus')}</span>Add task`;
        add.onclick = () => openQuickAdd({ due: g.addDue });
        sec.append(add);
      }
      area.append(sec);
    });
    if (!any && view.type !== 'upcoming') area.innerHTML = emptyState();
    animateEntry = false; lastAddedId = null;
  }

  let lastTitle = '';
  function renderHeader() {
    const titles = { inbox: 'Inbox', today: 'Today', upcoming: 'Upcoming', completed: 'Completed' };
    let title = titles[view.type];
    if (view.type === 'project') title = projectById(view.id)?.name || 'Project';
    if (view.type === 'label') title = view.name;
    if (query) title = 'Search';
    const h1 = $('viewTitle');
    h1.textContent = title;
    if (title !== lastTitle) { h1.classList.remove('swap'); void h1.offsetWidth; h1.classList.add('swap'); lastTitle = title; }
    const open = visibleTasks().filter(t => !t.done).length;
    $('viewSub').textContent = query ? `${open} result${open === 1 ? '' : 's'}`
      : view.type === 'today' ? new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }) + (open ? ` · ${open} task${open === 1 ? '' : 's'}` : '')
      : view.type === 'upcoming' || view.type === 'completed' ? '' : open ? `${open} task${open === 1 ? '' : 's'}` : '';
    $('deleteProject').hidden = view.type !== 'project' || !!query;
    $('inlineAdd').hidden = view.type === 'completed';
    $('showDoneBtn').hidden = view.type === 'completed';
    $('showDoneBtn').setAttribute('aria-pressed', String(showDone));
    const mode = projectMode();
    $('viewModes').hidden = view.type !== 'project' || !!query;
    $('viewModes').querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
    $('showDoneBtn').hidden = view.type === 'completed' || mode === 'mindmap';
    const ai = TaskAI.getConfig();
    $('suggestBtn').hidden = !(TaskAI.isReady(ai) && ai.suggestions) || view.type === 'completed' || !!query;
    $('aiSection').hidden = !TaskAI.isReady(ai);
    document.title = `${title} · Tasklist`;
  }

  // Project view mode (List / Roadmap / Mind map), remembered per project on this device.
  const modeKey = 'tasklist.viewModes';
  function projectMode() {
    if (view.type !== 'project' || query) return 'list';
    try { return (JSON.parse(store.get(modeKey)) || {})[view.id] || 'list'; } catch (_) { return 'list'; }
  }
  function setProjectMode(mode) {
    let m = {}; try { m = JSON.parse(store.get(modeKey)) || {}; } catch (_) {}
    m[view.id] = mode; store.set(modeKey, JSON.stringify(m));
    animateEntry = true; render();
  }

  function render() {
    if (view.type === 'project' && !projectById(view.id)) view = { type: 'inbox' };
    if (view.type === 'label' && !allLabels().includes(view.name)) view = { type: 'inbox' };
    renderNav(); renderHeader();
    const mode = projectMode();
    $('taskArea').classList.toggle('wide', mode !== 'list');
    $('taskArea').dataset.mode = mode;
    if (mode === 'roadmap') renderRoadmap();
    else if (mode === 'mindmap') renderMindmap();
    else renderTasks();
  }

  // ---------- keyboard selection ----------
  function rowIds() { return [...document.querySelectorAll('#taskArea .task-wrap')].map(x => x.dataset.id); }
  function select(id, scroll) {
    selectedId = id;
    document.querySelectorAll('.task.selected').forEach(x => x.classList.remove('selected'));
    const wrap = id && document.querySelector(`.task-wrap[data-id="${CSS.escape(id)}"]`);
    if (wrap) { wrap.firstElementChild.classList.add('selected'); if (scroll) wrap.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }
  function moveSelection(dir) {
    const ids = rowIds(); if (!ids.length) return;
    const i = ids.indexOf(selectedId);
    select(ids[i < 0 ? (dir > 0 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, i + dir))], true);
  }

  // ---------- selects ----------
  function fillProjectSelect(sel, value) {
    sel.innerHTML = '<option value="inbox">Inbox</option>' + state.projects.map(p => `<option value="${p.id}"></option>`).join('');
    state.projects.forEach((p, i) => { sel.options[i + 1].textContent = p.name; });
    sel.value = value;
  }
  function syncPrio(selectEl, holder) { holder.dataset.prio = selectEl.value; }
  function autosize(ta) { ta.style.height = 'auto'; if (ta.scrollHeight) ta.style.height = Math.min(ta.scrollHeight, 220) + 'px'; } // skip while hidden (scrollHeight is 0)

  // ---------- quick add ----------
  function openQuickAdd(pre = {}) {
    $('qaTitle').value = ''; $('qaDesc').value = ''; autosize($('qaDesc'));
    $('qaDate').value = pre.due || defaultDue() || '';
    $('qaPriority').value = '4'; syncPrio($('qaPriority'), $('qaPriorityChip'));
    fillProjectSelect($('qaProject'), defaultProject());
    $('qaPreview').innerHTML = ''; $('qaSubmit').disabled = true;
    openOverlay($('quickAdd'));
    $('qaTitle').focus();
  }
  const closeQuickAdd = () => closeOverlay($('quickAdd'));
  $('openQuickAdd').onclick = () => openQuickAdd();
  $('qaCancel').onclick = closeQuickAdd;
  $('qaPriority').onchange = () => syncPrio($('qaPriority'), $('qaPriorityChip'));
  $('qaDesc').oninput = () => autosize($('qaDesc'));
  $('qaTitle').oninput = () => {
    const p = parse($('qaTitle').value);
    const tok = (icon, text) => `<span class="token">${svg(icon)}${esc(text)}</span>`;
    const bits = [];
    if (p.due) bits.push(tok('calendar', fmtDue(p.due)));
    if (p.priority < 4) bits.push(tok('flagFill', 'P' + p.priority));
    if (p.project) bits.push(tok('hash', p.project));
    p.labels.forEach(l => bits.push(tok('tag', l)));
    if (p.repeat) bits.push(tok('repeat', p.repeat));
    $('qaPreview').innerHTML = bits.join('');
    $('qaSubmit').disabled = !p.title;
  };
  $('qaTitle').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('quickAddForm').requestSubmit(); } };
  $('quickAddForm').onsubmit = (e) => {
    e.preventDefault();
    const p = parse($('qaTitle').value);
    if (!p.title) return;
    addTask({
      title: p.title, desc: $('qaDesc').value.trim(), labels: p.labels, repeat: p.repeat,
      due: p.due || $('qaDate').value || null,
      priority: p.priority < 4 ? p.priority : Number($('qaPriority').value),
      projectId: resolveProject(p.project) || $('qaProject').value,
    });
    closeQuickAdd();
  };
  $('inlineAdd').onsubmit = (e) => { e.preventDefault(); addFromText($('inlineInput').value); $('inlineInput').value = ''; };

  // ---------- detail ----------
  let draftSubs = [];
  function renderSubs() {
    const ul = $('dSubtasks'); ul.innerHTML = '';
    draftSubs.forEach(s => {
      const li = document.createElement('li');
      if (s.done) li.className = 'done';
      li.innerHTML = `<button type="button" class="check" aria-label="Toggle sub-task">${CHECK_SVG}</button><span></span><button type="button" class="icon-btn danger" aria-label="Remove sub-task">${svg('close')}</button>`;
      li.querySelector('span').textContent = s.title;
      li.querySelector('.check').onclick = () => { s.done = !s.done; li.classList.toggle('done', s.done); updateSubCount(); };
      li.querySelector('.icon-btn').onclick = () => { draftSubs = draftSubs.filter(x => x !== s); renderSubs(); };
      ul.append(li);
    });
    updateSubCount();
  }
  function updateSubCount() { $('dSubCount').textContent = draftSubs.length ? `${draftSubs.filter(s => s.done).length}/${draftSubs.length}` : ''; }
  function openDetail(id) {
    const t = state.tasks.find(x => x.id === id); if (!t) return;
    editingId = id;
    const proj = projectOf(t);
    $('dCrumb').innerHTML = `${svg(proj.inbox ? 'inbox' : 'hash')}<span></span>`;
    $('dCrumb').querySelector('span').textContent = proj.name;
    $('dCrumb').style.color = proj.color || '';
    $('dTitle').value = t.title; $('dDesc').value = t.desc;
    $('dDate').value = t.due || ''; $('dPriority').value = String(t.priority); syncPrio($('dPriority'), $('dPriorityField'));
    $('dRepeat').value = t.repeat || '';
    $('dLabels').value = t.labels.join(', ');
    $('dPhase').value = t.phase || '';
    $('phaseList').innerHTML = [...new Set(state.tasks.filter(x => x.projectId === t.projectId && x.phase).map(x => x.phase))].map(p => `<option value="${esc(p)}">`).join('');
    fillProjectSelect($('dProject'), t.projectId);
    draftSubs = t.subtasks.map(s => ({ ...s })); renderSubs();
    openOverlay($('detail'));
    autosize($('dDesc'));
  }
  const closeDetail = () => { closeOverlay($('detail')); editingId = null; };
  $('dCancel').onclick = closeDetail;
  $('dClose').onclick = closeDetail;
  $('dPriority').onchange = () => syncPrio($('dPriority'), $('dPriorityField'));
  $('dDesc').oninput = () => autosize($('dDesc'));
  $('dDelete').onclick = () => { const id = editingId; closeDetail(); deleteTask(id); };
  $('dSubInput').onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const v = e.target.value.trim(); if (v) { draftSubs.push({ id: uid(), title: v, done: false }); e.target.value = ''; renderSubs(); } }
  };
  $('detailForm').onsubmit = (e) => {
    e.preventDefault();
    const t = state.tasks.find(x => x.id === editingId); if (!t) return;
    Object.assign(t, {
      title: $('dTitle').value.trim() || t.title, desc: $('dDesc').value,
      due: $('dDate').value || null, priority: Number($('dPriority').value),
      projectId: $('dProject').value, repeat: $('dRepeat').value || null,
      labels: [...new Set($('dLabels').value.split(',').map(s => s.trim().replace(/^@/, '').toLowerCase()).filter(Boolean))],
      subtasks: draftSubs,
      phase: $('dPhase').value.trim().slice(0, 60) || null,
    });
    save(); closeDetail(); render();
    toast('Changes saved');
  };

  // ---------- projects ----------
  function showNewProject() {
    $('newProjectForm').hidden = false;
    $('newProjectDot').style.background = COLORS[state.projects.length % COLORS.length];
    $('newProjectInput').value = ''; $('newProjectInput').focus();
  }
  const hideNewProject = () => { $('newProjectForm').hidden = true; };
  $('addProject').onclick = showNewProject;
  $('newProjectInput').onblur = () => setTimeout(hideNewProject, 120);
  $('newProjectInput').onkeydown = (e) => { if (e.key === 'Escape') { e.stopPropagation(); hideNewProject(); } };
  $('newProjectForm').onsubmit = (e) => {
    e.preventDefault();
    const name = $('newProjectInput').value.trim(); if (!name) return hideNewProject();
    const existing = state.projects.find(p => p.name.toLowerCase() === name.toLowerCase());
    const p = existing || { id: uid(), name, color: COLORS[state.projects.length % COLORS.length] };
    if (!existing) state.projects.push(p);
    save(); hideNewProject(); setView({ type: 'project', id: p.id });
  };
  $('deleteProject').onclick = async () => {
    const p = projectById(view.id); if (!p) return;
    const n = state.tasks.filter(x => x.projectId === p.id).length;
    if (!await confirmBox(`Delete “${p.name}”?`, n ? `This also deletes its ${n} task${n === 1 ? '' : 's'}. You can’t undo this.` : 'This project is empty.')) return;
    state.projects = state.projects.filter(x => x.id !== p.id);
    state.tasks = state.tasks.filter(x => x.projectId !== p.id);
    save(); setView({ type: 'inbox' });
    toast('Project deleted');
  };

  // ---------- chrome ----------
  $('search').oninput = (e) => { query = e.target.value.trim(); animateEntry = true; render(); };
  $('showDoneBtn').onclick = () => { showDone = !showDone; animateEntry = true; render(); };
  $('menuBtn').onclick = () => {
    if (matchMedia('(max-width: 820px)').matches) document.body.classList.toggle('nav-open');
    else setSidebarHidden(false);
  };
  $('scrim').onclick = () => document.body.classList.remove('nav-open');
  function setSidebarHidden(h) { document.body.classList.toggle('sidebar-hidden', h); store.set('tasklist.sidebar', h ? 'hidden' : ''); }
  $('collapseBtn').onclick = () => setSidebarHidden(true);
  if (store.get('tasklist.sidebar') === 'hidden') document.body.classList.add('sidebar-hidden');
  [$('quickAdd'), $('detail')].forEach(m => m.addEventListener('mousedown', (e) => { if (e.target === m) m.id === 'quickAdd' ? closeQuickAdd() : closeDetail(); }));

  const isDark = () => document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  function applyTheme(t) {
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    $('themeToggle').innerHTML = svg(isDark() ? 'sun' : 'moon');
    // phone status bar colour follows the chosen theme, not just the system one
    document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
      if (!m.dataset.auto) m.dataset.auto = m.content;
      m.content = t ? (t === 'dark' ? '#1a1918' : '#fdfcfa') : m.dataset.auto;
    });
  }
  applyTheme(store.get('tasklist.theme'));
  $('themeToggle').onclick = () => { const next = isDark() ? 'light' : 'dark'; applyTheme(next); store.set('tasklist.theme', next); };

  // keyboard
  document.addEventListener('keydown', (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    const overlayOpen = !!document.querySelector('.overlay:not([hidden])');
    if (e.key === 'Escape') {
      if (!$('confirmBox').hidden) return $('confirmNo').click();
      for (const id of ['pairBox', 'connectBox', 'settingsBox', 'suggestBox', 'roadmapBox', 'brainstormBox']) if (!$(id).hidden) return closeOverlay($(id));
      if (overlayOpen) { closeQuickAdd(); closeDetail(); return; }
      if (typing) return document.activeElement.blur();
      return select(null);
    }
    if (typing || overlayOpen || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'q' || k === 'Q') { e.preventDefault(); openQuickAdd(); }
    else if (k === '/') { e.preventDefault(); $('search').focus(); }
    else if (k === 'g' || k === 'G') setView({ type: 'today' });
    else if (k === 'i' || k === 'I') setView({ type: 'inbox' });
    else if (k === 'u' || k === 'U') setView({ type: 'upcoming' });
    else if (k === 'ArrowDown' || k === 'j') { e.preventDefault(); moveSelection(1); }
    else if (k === 'ArrowUp' || k === 'k') { e.preventDefault(); moveSelection(-1); }
    else if (selectedId && k === 'Enter') { e.preventDefault(); openDetail(selectedId); }
    else if (selectedId && (k === 'e' || k === 'E')) { e.preventDefault(); completeWithAnimation(selectedId, document.querySelector(`.task-wrap[data-id="${CSS.escape(selectedId)}"]`)); }
    else if (selectedId && (k === 'Delete' || k === 'Backspace')) { e.preventDefault(); deleteTask(selectedId, document.querySelector(`.task-wrap[data-id="${CSS.escape(selectedId)}"]`)); }
  });

  // desktop (Electron): tasks sent from the global quick-add window land in the Inbox unless they name a #project
  if (window.desktop && window.desktop.isDesktop) {
    window.desktop.onTaskAdd((text) => addFromText(text, { projectId: 'inbox', due: null }));
    window.desktop.shortcuts().then((s) => {
      $('openQuickAdd').title = `Global quick add: ${s.quickAdd.replace('CommandOrControl', 'Ctrl')}`;
    });
  }

  // installable web app: offline cache (not in Electron, and only where service workers are allowed)
  if (!window.desktop && !isNative && window.isSecureContext && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  // home-screen shortcuts from the manifest
  function openFromHash() {
    if (location.hash === '#add') openQuickAdd();
    else if (location.hash === '#today') setView({ type: 'today' });
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  }
  window.addEventListener('hashchange', openFromHash);

  // ---------- sync (desktop hub <-> phones on the same Wi-Fi) ----------
  let syncing = false, syncAgain = false, syncTimer = null, lastSyncAt = 0, syncStatus = 'idle';

  // The browser version is served by the PC itself (same origin); the Android app talks to the PC's address.
  const apiUrl = (p) => (isNative ? `http://${store.get(HOST_KEY)}/api/${p}` : `api/${p}`);
  async function request(p, opts = {}, timeoutMs = 8000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try { return await fetch(apiUrl(p), { ...opts, signal: ctl.signal }); } finally { clearTimeout(timer); }
  }
  async function exchange(payload) {
    if (isDesktop) return window.desktop.sync(payload);
    const res = await request('sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + store.get(TOKEN_KEY) },
      body: JSON.stringify(payload),
    });
    if (res.status === 401) { const err = new Error('unpaired'); err.unpaired = true; throw err; }
    if (!res.ok) throw new Error('sync failed');
    return res.json();
  }
  function scheduleSync(delay = 400) {
    if (!syncMode) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, delay);
  }
  async function syncNow() {
    if (!syncMode) return;
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    if (syncStatus !== 'ok') setSyncStatus('busy');
    try {
      const remote = await exchange(clone(state));
      if (!remote) throw new Error('hub unavailable');
      const merged = TaskSync.merge(state, remote);
      if (!TaskSync.same(merged, state)) {
        state = merged;
        lastSaved = clone(state);
        store.set(STORE_KEY, JSON.stringify(state));
        render();
      }
      lastSyncAt = Date.now();
      setSyncStatus('ok');
    } catch (err) {
      setSyncStatus(err.unpaired ? 'unpaired' : 'off');
    } finally {
      syncing = false;
      if (syncAgain) { syncAgain = false; scheduleSync(0); }
    }
  }
  function ago(ts) {
    const s = Math.round((Date.now() - ts) / 1000);
    return s < 10 ? 'just now' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
  }
  function setSyncStatus(s) {
    syncStatus = s;
    $('syncDot').className = 'sync-dot ' + ({ ok: 'ok', busy: 'busy', off: 'off', unpaired: 'off' }[s] || '');
    if (isDesktop) {
      $('syncTitle').textContent = 'Phone sync';
      $('syncSub').textContent = s === 'off' ? 'Unavailable on this PC' : 'Scan a code to connect';
    } else if (s === 'none') {
      $('syncTitle').textContent = 'Not connected';
      $('syncSub').textContent = 'Sync tasks with your PC';
    } else {
      $('syncTitle').textContent = s === 'ok' ? 'Synced with PC' : s === 'unpaired' ? 'Not paired' : s === 'off' ? 'PC not reachable' : 'Syncing…';
      $('syncSub').textContent = s === 'ok' ? ago(lastSyncAt)
        : s === 'unpaired' ? (isNative ? 'Connect again with a new code' : 'Scan the code on your PC again')
        : s === 'off' ? (lastSyncAt ? `Last synced ${ago(lastSyncAt)}` : 'Same Wi-Fi? Is Tasklist running?') : '';
    }
    // The card's button: desktop shows the pairing code; the Android app connects or syncs; the browser syncs.
    const needsConnect = isNative && (s === 'none' || s === 'unpaired');
    $('connectPhone').innerHTML = isDesktop ? `${svg('phone')}<span>Connect</span>` : needsConnect ? `${svg('phone')}<span>Connect</span>` : `${svg('sync')}<span>Sync</span>`;
    $('connectPhone').onclick = isDesktop ? openPairing : needsConnect ? openConnect : () => syncNow();
  }

  let syncStarted = false;
  function startSync() {
    if (syncStarted || !syncMode) return;
    syncStarted = true;
    if (isDesktop) window.desktop.onSyncChanged(() => scheduleSync(0));
    setSyncStatus('busy');
    syncNow();
    setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, isDesktop ? 15000 : 4000);
    setInterval(() => { if (syncStatus === 'ok' || syncStatus === 'off') setSyncStatus(syncStatus); }, 10000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
    window.addEventListener('online', () => syncNow());
  }
  if (syncMode || isNative) $('syncCard').hidden = false;
  if (syncMode) startSync(); else if (isNative) setSyncStatus('none');

  // ---------- connect dialog (Android app) ----------
  function openConnect() {
    $('cAddress').value = store.get(HOST_KEY) || '';
    $('cCode').value = '';
    $('cError').hidden = true;
    openOverlay($('connectBox'));
    ($('cAddress').value ? $('cCode') : $('cAddress')).focus();
  }
  const closeConnect = () => closeOverlay($('connectBox'));
  $('cCancel').onclick = $('cClose').onclick = closeConnect;
  $('connectBox').addEventListener('mousedown', (e) => { if (e.target === $('connectBox')) closeConnect(); });
  $('cCode').oninput = () => { $('cCode').value = $('cCode').value.replace(/\D/g, '').slice(0, 6); };
  function connectError(msg) { $('cError').textContent = msg; $('cError').hidden = false; }
  $('connectForm').onsubmit = async (e) => {
    e.preventDefault();
    let host = $('cAddress').value.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (!/^[\w.-]+(:\d{2,5})?$/.test(host)) return connectError('Enter the PC address shown on your PC, like 192.168.1.6:5180.');
    if (!/:\d+$/.test(host)) host += ':5180';
    const code = $('cCode').value;
    if (code.length !== 6) return connectError('Enter the 6-digit code shown on your PC.');
    $('cSubmit').disabled = true; $('cSubmit').textContent = 'Connecting…'; $('cError').hidden = true;
    try {
      store.set(HOST_KEY, host);
      const res = await request('pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return connectError(res.status === 403 ? 'That code isn’t right. Check the code on your PC and try again.' : body.error || 'Your PC refused the connection.');
      finishPairing(body.token, body.name);
    } catch (err) {
      console.warn('Tasklist: pairing request failed', err);
      connectError(unreachable(host));
    } finally {
      $('cSubmit').disabled = false; $('cSubmit').textContent = 'Connect';
    }
  };
  const unreachable = (host) => `Couldn’t reach your PC at ${host}. Make sure both are on the same Wi-Fi, Tasklist is running on the PC, and Windows Firewall allows it.`;
  function finishPairing(token, name) {
    store.set(TOKEN_KEY, token);
    if (store.get(SEED_KEY)) { // drop the untouched sample tasks so they don't copy onto the PC
      state = TaskSync.empty(); lastSaved = clone(state); store.set(STORE_KEY, JSON.stringify(state));
      try { localStorage.removeItem(SEED_KEY); } catch (_) {}
      render();
    }
    syncMode = 'phone';
    closeConnect();
    toast(`Connected to ${name || 'your PC'}`);
    if (syncStarted) syncNow(); else startSync();
  }

  // QR scan (Android app): the PC's QR code holds http://<address>/#pair=<token>, so a scan pairs without typing.
  $('cScan').onclick = async () => {
    const C = window.Capacitor;
    if (!C) return;
    $('cError').hidden = true;
    let text;
    try {
      const opts = { hint: 0 /* QR_CODE */, scanInstructions: 'Point at the QR code in Tasklist on your PC', scanButton: false, cameraDirection: 1 /* back */, scanOrientation: 3 /* adaptive */, android: { scanningLibrary: 'zxing' } };
      // No bundler here, so call the native plugin through the Capacitor bridge directly.
      const result = C.nativePromise ? await C.nativePromise('CapacitorBarcodeScanner', 'scanBarcode', opts)
        : await C.Plugins.CapacitorBarcodeScanner.scanBarcode(opts);
      text = result && result.ScanResult;
    } catch (err) {
      const msg = String(err && (err.message || err.code) || '');
      if (/cancel/i.test(msg)) return; // user closed the scanner
      console.warn('Tasklist: QR scan failed', err);
      return connectError(/permission/i.test(msg) ? 'Tasklist needs camera access to scan. Allow it in Android Settings → Apps → Tasklist → Permissions.' : 'The scanner couldn’t start. Enter the address and code instead.');
    }
    if (!text) return;
    let host, token;
    try {
      const u = new URL(text.trim());
      const m = u.hash.match(/^#pair=([a-f0-9]{48})$/);
      if (/^https?:$/.test(u.protocol) && m) { host = u.host; token = m[1]; }
    } catch (_) {}
    if (!host) return connectError('That QR code isn’t from Tasklist. Scan the code in Tasklist’s Connect window on your PC.');
    $('cScan').disabled = true;
    try {
      store.set(HOST_KEY, host);
      $('cAddress').value = host;
      const res = await request('ping', { headers: { Authorization: 'Bearer ' + token } });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) return connectError('That QR code is no longer valid. Open Connect on your PC and scan the new one.');
      if (!res.ok) return connectError('Your PC refused the connection.');
      finishPairing(token, body.name);
    } catch (err) {
      console.warn('Tasklist: pairing request failed', err);
      connectError(unreachable(host));
    } finally {
      $('cScan').disabled = false;
    }
  };

  // ---------- pairing dialog (desktop) ----------
  function showPairInfo(info) {
    if (!info || !info.url) {
      $('pairQr').removeAttribute('src');
      $('pairUrl').textContent = '—';
      $('pairNote').textContent = 'This PC doesn’t seem to be on a network. Connect it to Wi-Fi or Ethernet and try again.';
      return;
    }
    $('pairQr').src = info.qr;
    $('pairUrl').textContent = info.plainUrl;
    $('pairAddress').textContent = info.address;
    $('pairCode').textContent = info.code;
    $('pairNote').textContent = 'Tasks sync whenever this PC is on and Tasklist is running in the tray. If your phone can’t connect, allow Tasklist through Windows Firewall on private networks.';
  }
  async function openPairing() {
    openOverlay($('pairBox'));
    showPairInfo(await window.desktop.pairInfo());
  }
  $('pairClose').onclick = $('pairDone').onclick = () => closeOverlay($('pairBox'));
  $('pairBox').addEventListener('mousedown', (e) => { if (e.target === $('pairBox')) closeOverlay($('pairBox')); });
  $('pairReset').onclick = async () => {
    closeOverlay($('pairBox'));
    if (!await confirmBox('Unpair all phones?', 'Phones that are already paired stop syncing until you scan the new code. Their tasks stay on the phone.', 'Unpair')) return;
    openOverlay($('pairBox'));
    showPairInfo(await window.desktop.resetPairing());
    toast('New pairing code created');
  };

  // ================= AI =================
  const aiReady = () => TaskAI.isReady();
  const aiErrorHtml = (err) => `<div class="ai-error"><p>${esc(err.message || 'Something went wrong.')}</p><button type="button" class="btn sm" data-open-settings>Open AI settings</button></div>`;
  document.addEventListener('click', (e) => { if (e.target.closest('[data-open-settings]')) { document.querySelectorAll('.overlay:not([hidden])').forEach(o => closeOverlay(o)); openSettings(); } });
  const spinner = '<span class="spin" aria-hidden="true"></span>';
  function busy(btn, on, label) {
    if (on) { btn.dataset.label = btn.innerHTML; btn.innerHTML = `${spinner}<span>${esc(label)}</span>`; btn.disabled = true; }
    else { if (btn.dataset.label) btn.innerHTML = btn.dataset.label; btn.disabled = false; }
  }
  const viewName = () => view.type === 'project' ? `the project “${projectById(view.id)?.name}”` : view.type === 'label' ? `tasks labelled “${view.name}”` : { inbox: 'the Inbox', today: 'Today', upcoming: 'Upcoming (next two weeks)' }[view.type] || 'their tasks';

  // ---------- settings ----------
  let draftAi = null;
  const P = TaskAI.PROVIDERS;
  $('sProvider').innerHTML = Object.entries(P).map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join('');
  function readSettingsForm() {
    return { ...draftAi, enabled: $('sEnabled').checked, provider: $('sProvider').value, base: $('sBase').value.trim(), key: $('sKey').value.trim(), model: $('sModel').value.trim(), completion: $('sCompletion').checked, suggestions: $('sSuggestions').checked };
  }
  function fillSettingsForm(c) {
    $('sEnabled').checked = c.enabled; $('sProvider').value = c.provider; $('sBase').value = c.base; $('sKey').value = c.key; $('sModel').value = c.model;
    $('sCompletion').checked = c.completion; $('sSuggestions').checked = c.suggestions;
    const p = P[c.provider] || P.custom;
    $('sKey').placeholder = p.keyHint; $('sBase').placeholder = p.base || 'https://your-server/v1';
    $('sKeyField').classList.toggle('muted', !!p.noKey);
    $('sFields').classList.toggle('off', !c.enabled);
    $('sTestResult').textContent = ''; $('sTestResult').className = 'test-result';
  }
  function openSettings() {
    draftAi = TaskAI.getConfig();
    draftAi.profiles = draftAi.profiles || {};
    fillSettingsForm(draftAi);
    $('sModelList').innerHTML = '';
    $('sKey').type = 'password';
    openOverlay($('settingsBox'));
  }
  $('settingsBtn').onclick = openSettings;
  $('sEnabled').onchange = () => $('sFields').classList.toggle('off', !$('sEnabled').checked);
  $('sProvider').onchange = () => {
    const cur = readSettingsForm(), prev = draftAi.provider;
    draftAi.profiles[prev] = { base: cur.base, key: cur.key, model: cur.model }; // remember each provider's own address, key and model
    const next = $('sProvider').value, saved = draftAi.profiles[next] || {};
    draftAi = { ...cur, provider: next, base: saved.base || P[next].base, key: saved.key || '', model: saved.model || P[next].model };
    fillSettingsForm(draftAi);
    $('sModelList').innerHTML = '';
  };
  $('sKeyShow').onclick = () => { $('sKey').type = $('sKey').type === 'password' ? 'text' : 'password'; };
  function testResult(text, ok) { $('sTestResult').textContent = text; $('sTestResult').className = 'test-result ' + (ok ? 'ok' : 'bad'); }
  $('sLoadModels').onclick = async () => {
    const btn = $('sLoadModels'); busy(btn, true, 'Loading');
    try {
      const models = await TaskAI.listModels(readSettingsForm());
      $('sModelList').innerHTML = models.map(m => `<option value="${esc(m)}">`).join('');
      testResult(models.length ? `${models.length} models found. Pick one in the Model field.` : 'The provider returned no models. Type the model name instead.', !!models.length);
      if (models.length) $('sModel').focus();
    } catch (err) { testResult(err.message, false); }
    finally { busy(btn, false); }
  };
  $('sTest').onclick = async () => {
    const btn = $('sTest'); busy(btn, true, 'Testing');
    const c = { ...readSettingsForm(), enabled: true };
    try {
      const out = await TaskAI.chat({ system: 'You are a connection test.', prompt: 'Reply with exactly the word OK.', maxTokens: 1000, effort: 'low' }, c);
      testResult(`Connected. ${c.model} replied “${out.slice(0, 40)}”.`, true);
    } catch (err) { testResult(err.message, false); }
    finally { busy(btn, false); }
  };
  $('sClose').onclick = $('sCancel').onclick = () => closeOverlay($('settingsBox'));
  $('settingsBox').addEventListener('mousedown', (e) => { if (e.target === $('settingsBox')) closeOverlay($('settingsBox')); });
  $('settingsForm').onsubmit = (e) => {
    e.preventDefault();
    const c = readSettingsForm();
    if (c.enabled && !c.base) return testResult('Enter the API address.', false);
    if (c.enabled && !c.model) return testResult('Choose a model (use Load models) or type its name.', false);
    if (c.enabled && !c.key && !P[c.provider].noKey && c.provider !== 'custom') return testResult('Enter your API key.', false);
    c.profiles = { ...(draftAi.profiles || {}), [c.provider]: { base: c.base, key: c.key, model: c.model } };
    TaskAI.saveConfig(c);
    closeOverlay($('settingsBox'));
    render();
    toast(c.enabled ? 'AI settings saved' : 'AI turned off');
  };

  // ---------- inline completion (ghost text) ----------
  function completionContext() {
    const pid = view.type === 'project' ? view.id : 'inbox';
    const pool = state.tasks.filter(t => t.projectId === pid).length >= 3 ? state.tasks.filter(t => t.projectId === pid) : state.tasks;
    return { project: pid === 'inbox' ? 'Inbox' : projectById(pid)?.name, recent: [...pool].sort((a, b) => b.created - a.created).slice(0, 12).map(t => t.title) };
  }
  const touch = matchMedia('(hover: none)').matches;
  function setupGhost(input) {
    const ghost = input.parentElement.querySelector('.ac-ghost');
    let sugg = '', seq = 0, timer = null;
    const show = () => {
      ghost.innerHTML = sugg ? `<span class="g-typed">${esc(input.value)}</span><span class="g-sugg">${esc(sugg)}</span><kbd class="g-kbd">${touch ? 'Tap to add' : 'Tab'}</kbd>` : '';
      ghost.scrollLeft = input.scrollLeft;
    };
    const clear = () => { sugg = ''; seq++; show(); };
    const accept = () => { input.value += sugg; clear(); input.dispatchEvent(new Event('input')); };
    // Phones have no Tab key: tapping the faded suggestion (or its hint) accepts it. preventDefault keeps the keyboard open.
    ghost.addEventListener('pointerdown', (e) => { if (sugg && e.target.closest('.g-sugg, .g-kbd')) { e.preventDefault(); accept(); } });
    input.addEventListener('input', () => {
      clear(); clearTimeout(timer);
      const c = TaskAI.getConfig();
      const v = input.value;
      if (!TaskAI.isReady(c) || !c.completion || v.trim().length < 3 || input.selectionStart !== v.length) return;
      timer = setTimeout(async () => {
        const my = ++seq;
        try {
          const s = await TaskAI.complete(v, completionContext());
          if (my === seq && input.value === v && document.activeElement === input && s.trim()) { sugg = s; show(); }
        } catch (_) { /* completion is best-effort; errors surface in Settings → Test */ }
      }, 650);
    });
    input.addEventListener('keydown', (e) => {
      if (sugg && (e.key === 'Tab' || (e.key === 'ArrowRight' && input.selectionStart === input.value.length))) {
        e.preventDefault();
        accept();
      } else if (sugg && e.key === 'Escape') { e.stopPropagation(); clear(); }
    }, true);
    input.addEventListener('blur', () => { clearTimeout(timer); clear(); });
    input.addEventListener('scroll', () => { ghost.scrollLeft = input.scrollLeft; });
  }
  setupGhost($('qaTitle'));
  setupGhost($('inlineInput'));

  // ---------- suggest next tasks ----------
  let sgItems = [];
  function suggestContext() {
    const scope = visibleTasks();
    const inScope = (t) => view.type === 'project' ? t.projectId === view.id : view.type === 'label' ? t.labels.includes(view.name) : view.type === 'inbox' ? t.projectId === 'inbox' : true;
    return {
      today: todayIso(), viewName: viewName(),
      open: scope.filter(t => !t.done).slice(0, 40).map(t => ({ title: t.title, due: t.due })),
      done: state.tasks.filter(t => t.done && inScope(t)).sort((a, b) => b.doneAt - a.doneAt).slice(0, 10).map(t => t.title),
      projects: state.projects.map(p => p.name),
    };
  }
  async function runSuggest() {
    const body = $('sgBody');
    $('sgAdd').disabled = true;
    body.innerHTML = `<p class="ai-status">${spinner} Thinking about what comes next in ${esc(viewName())}…</p>` + '<div class="skel"></div>'.repeat(4);
    try {
      sgItems = await TaskAI.suggestTasks(suggestContext());
      if (!sgItems.length) { body.innerHTML = '<p class="ai-status">No new suggestions this time. Try again, or add a few tasks first so AI has more context.</p>'; return; }
      body.innerHTML = `<ul class="sg-list">${sgItems.map((t, i) => `
        <li style="--i:${i}"><label>
          <input type="checkbox" data-i="${i}" checked>
          <span class="sg-main"><b>${esc(t.title)}</b>${t.why ? `<small>${esc(t.why)}</small>` : ''}</span>
          <span class="sg-meta">${t.priority < 4 ? `<span class="pill p${t.priority}">P${t.priority}</span>` : ''}${t.dueInDays != null ? `<span class="pill">${esc(fmtDue(iso(addDays(new Date(), t.dueInDays))))}</span>` : ''}</span>
        </label></li>`).join('')}</ul>`;
      $('sgAdd').disabled = false;
      body.querySelectorAll('input[type=checkbox]').forEach(cb => cb.onchange = () => { $('sgAdd').disabled = !body.querySelector('input:checked'); });
    } catch (err) { body.innerHTML = aiErrorHtml(err); }
  }
  $('suggestBtn').onclick = () => { $('suggestTitle').textContent = `Suggested for ${view.type === 'project' ? projectById(view.id)?.name : $('viewTitle').textContent}`; openOverlay($('suggestBox')); runSuggest(); };
  $('sgRetry').onclick = runSuggest;
  $('sgClose').onclick = () => closeOverlay($('suggestBox'));
  $('suggestBox').addEventListener('mousedown', (e) => { if (e.target === $('suggestBox')) closeOverlay($('suggestBox')); });
  $('sgAdd').onclick = () => {
    const picked = [...$('sgBody').querySelectorAll('input:checked')].map(cb => sgItems[Number(cb.dataset.i)]);
    const now = Date.now();
    const added = picked.map((t, i) => ({
      id: uid(), title: t.title, desc: '', priority: t.priority, labels: view.type === 'label' ? [view.name] : [], repeat: null, done: false, doneAt: null, subtasks: [],
      due: t.dueInDays != null ? iso(addDays(new Date(), t.dueInDays)) : defaultDue(), projectId: defaultProject(), created: now + i, order: now + i,
    }));
    state.tasks.push(...added); save();
    closeOverlay($('suggestBox')); animateEntry = true; render();
    toast(`Added ${added.length} task${added.length === 1 ? '' : 's'}`, () => { const ids = new Set(added.map(t => t.id)); state.tasks = state.tasks.filter(t => !ids.has(t.id)); });
  };

  // ---------- roadmap generator ----------
  let rmPlan = null;
  function openRoadmap() {
    rmPlan = null;
    $('rmGoal').value = ''; $('rmStart').value = todayIso();
    $('rmInputs').hidden = false; $('rmPreview').innerHTML = ''; $('rmBack').hidden = true;
    $('rmGo').innerHTML = `${svg('sparkle')}<span>Generate roadmap</span>`;
    openOverlay($('roadmapBox')); $('rmGoal').focus();
  }
  function renderPlanPreview() {
    const start = $('rmStart').value || todayIso();
    $('rmPreview').innerHTML = `
      <label class="field"><span>Project name</span><input id="rmName" value="${esc(rmPlan.project)}" maxlength="60"></label>
      <div class="rm-phases">${rmPlan.phases.map((p, pi) => `
        <section class="rm-phase" style="--i:${pi}">
          <h4><span class="rm-num">${pi + 1}</span>${esc(p.name)}<small>${p.tasks.length} tasks</small></h4>
          <ul>${p.tasks.map((t, ti) => `<li><label><input type="checkbox" data-p="${pi}" data-t="${ti}" checked><span>${esc(t.title)}</span><em>${esc(fmtDue(iso(addDays(new Date(start + 'T00:00'), t.dueInDays))))}</em></label></li>`).join('')}</ul>
        </section>`).join('')}</div>`;
  }
  $('openRoadmap').onclick = (e) => { e.preventDefault(); document.body.classList.remove('nav-open'); openRoadmap(); };
  $('rmBack').onclick = () => { rmPlan = null; $('rmInputs').hidden = false; $('rmPreview').innerHTML = ''; $('rmBack').hidden = true; $('rmGo').innerHTML = `${svg('sparkle')}<span>Generate roadmap</span>`; };
  $('rmClose').onclick = () => closeOverlay($('roadmapBox'));
  $('roadmapBox').addEventListener('mousedown', (e) => { if (e.target === $('roadmapBox')) closeOverlay($('roadmapBox')); });
  $('roadmapForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('rmGo');
    if (!rmPlan) {
      const goal = $('rmGoal').value.trim();
      if (goal.length < 4) { $('rmGoal').focus(); return; }
      busy(btn, true, 'Planning…');
      $('rmPreview').innerHTML = `<p class="ai-status">${spinner} Breaking your goal into phases and tasks…</p>` + '<div class="skel"></div>'.repeat(5);
      try {
        rmPlan = await TaskAI.roadmap({ goal, timeframe: $('rmTime').value, start: $('rmStart').value || todayIso() });
        if (!rmPlan.phases.length) throw new Error('The AI didn’t return any phases. Try describing the goal in more detail.');
        busy(btn, false);
        $('rmInputs').hidden = true; $('rmBack').hidden = false;
        btn.innerHTML = `${svg('check')}<span>Create project</span>`;
        renderPlanPreview();
      } catch (err) { busy(btn, false); rmPlan = null; $('rmPreview').innerHTML = aiErrorHtml(err); }
      return;
    }
    const start = new Date(($('rmStart').value || todayIso()) + 'T00:00');
    const project = { id: uid(), name: ($('rmName').value.trim() || rmPlan.project).slice(0, 60), color: COLORS[state.projects.length % COLORS.length] };
    const now = Date.now(); let n = 0;
    const tasks = [];
    $('rmPreview').querySelectorAll('input[type=checkbox]:checked').forEach(cb => {
      const p = rmPlan.phases[Number(cb.dataset.p)], t = p.tasks[Number(cb.dataset.t)];
      tasks.push({ id: uid(), title: t.title, desc: '', priority: t.priority, labels: [], repeat: null, done: false, doneAt: null, subtasks: [], due: iso(addDays(start, t.dueInDays)), projectId: project.id, phase: p.name, created: now + n, order: now + n++ });
    });
    state.projects.push(project); state.tasks.push(...tasks); save();
    closeOverlay($('roadmapBox'));
    setView({ type: 'project', id: project.id }); setProjectMode('roadmap');
    toast(`Created “${project.name}” with ${tasks.length} tasks`);
  };

  // ---------- brainstorm mind map ----------
  $('openBrainstorm').onclick = (e) => {
    e.preventDefault(); document.body.classList.remove('nav-open');
    $('bsTopic').value = ''; $('bsError').hidden = true;
    openOverlay($('brainstormBox')); $('bsTopic').focus();
  };
  $('bsClose').onclick = $('bsCancel').onclick = () => closeOverlay($('brainstormBox'));
  $('brainstormBox').addEventListener('mousedown', (e) => { if (e.target === $('brainstormBox')) closeOverlay($('brainstormBox')); });
  $('brainstormForm').onsubmit = async (e) => {
    e.preventDefault();
    const topic = $('bsTopic').value.trim();
    if (topic.length < 3) { $('bsTopic').focus(); return; }
    busy($('bsGo'), true, 'Brainstorming…'); $('bsError').hidden = true;
    try {
      const map = await TaskAI.mindmap(topic);
      if (!map.branches.length) throw new Error('The AI didn’t return any ideas. Try a more specific topic.');
      const project = { id: uid(), name: map.title.slice(0, 60), color: COLORS[state.projects.length % COLORS.length] };
      const now = Date.now();
      const tasks = map.branches.map((b, i) => ({ id: uid(), title: b.title, desc: '', priority: 4, labels: [], repeat: null, done: false, doneAt: null, due: null, projectId: project.id, created: now + i, order: now + i, subtasks: b.children.map(c => ({ id: uid(), title: c, done: false })) }));
      state.projects.push(project); state.tasks.push(...tasks); save();
      closeOverlay($('brainstormBox'));
      setView({ type: 'project', id: project.id }); setProjectMode('mindmap');
      toast(`Created “${project.name}”`);
    } catch (err) { $('bsError').textContent = err.message; $('bsError').hidden = false; }
    finally { busy($('bsGo'), false); }
  };

  // ---------- view mode switch ----------
  $('viewModes').addEventListener('click', (e) => { const b = e.target.closest('[data-mode]'); if (b) setProjectMode(b.dataset.mode); });

  // ---------- Roadmap view: phases on a weekly timeline ----------
  function weekStart(d) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; }
  function renderRoadmap() {
    const area = $('taskArea'); area.innerHTML = '';
    const project = projectById(view.id);
    const tasks = state.tasks.filter(t => t.projectId === view.id && (showDone || !t.done || t.phase));
    if (!tasks.length) {
      area.innerHTML = `<div class="empty"><div class="empty-art">${svg('route')}</div><h3>No roadmap yet</h3><p>Give tasks a date and a phase, or let AI plan one for you.</p>${aiReady() ? `<button type="button" class="btn primary" id="rmEmptyGo">${svg('sparkle')} Plan a roadmap</button>` : ''}</div>`;
      const b = $('rmEmptyGo'); if (b) b.onclick = openRoadmap;
      return;
    }
    const dated = tasks.filter(t => t.due).map(t => new Date(t.due + 'T00:00'));
    const today = new Date(todayIso() + 'T00:00');
    let first = weekStart(dated.length ? new Date(Math.min(today, ...dated)) : today);
    let last = weekStart(dated.length ? new Date(Math.max(...dated)) : today);
    const weeks = [];
    for (let w = new Date(first); w <= last || weeks.length < 4; w.setDate(w.getDate() + 7)) { weeks.push(new Date(w)); if (weeks.length >= 60) break; }
    const weekIndex = (due) => Math.floor((new Date(due + 'T00:00') - first) / (7 * 864e5));
    const todayCol = weekIndex(todayIso());
    // phases in order of their earliest date; tasks without a phase go last
    const names = [...new Set(tasks.map(t => t.phase || ''))];
    const earliest = (n) => Math.min(...tasks.filter(t => (t.phase || '') === n && t.due).map(t => +new Date(t.due)), Infinity);
    names.sort((a, b) => (a === '') - (b === '') || earliest(a) - earliest(b));
    const hasUndated = tasks.some(t => !t.due);
    const total = tasks.length, done = tasks.filter(t => t.done).length;
    const end = dated.length ? new Date(Math.max(...dated)) : null;

    const wrap = document.createElement('div'); wrap.className = 'rm';
    wrap.innerHTML = `
      <div class="rm-summary">
        <div class="rm-progress"><span style="width:${total ? Math.round(done / total * 100) : 0}%"></span></div>
        <span><b>${done}</b> of ${total} done${end ? ` · ends ${esc(end.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}` : ''}</span>
      </div>
      <div class="rm-scroll"><div class="rm-grid" style="grid-template-columns: minmax(170px, 210px) repeat(${weeks.length}, minmax(132px, 1fr))${hasUndated ? ' minmax(150px, 1fr)' : ''}">
        <div class="rm-corner">Phase</div>
        ${weeks.map((w, i) => `<div class="rm-week${i === todayCol ? ' now' : ''}">${esc(w.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}${i === todayCol ? '<small>This week</small>' : ''}</div>`).join('')}
        ${hasUndated ? '<div class="rm-week nodate">No date</div>' : ''}
        ${names.map((name, ri) => {
          const pts = tasks.filter(t => (t.phase || '') === name);
          const pd = pts.filter(t => t.done).length;
          const cells = weeks.map((_, i) => `<div class="rm-cell${i === todayCol ? ' now' : ''}" data-row="${ri}" data-col="${i}"></div>`).join('');
          return `<div class="rm-phase-cell" style="--i:${ri}"><b>${esc(name || 'No phase')}</b><span class="rm-mini"><span style="width:${Math.round(pd / pts.length * 100)}%"></span></span><small>${pd}/${pts.length} done</small></div>${cells}${hasUndated ? `<div class="rm-cell nodate" data-row="${ri}" data-col="x"></div>` : ''}`;
        }).join('')}
      </div></div>`;
    area.append(wrap);
    names.forEach((name, ri) => {
      tasks.filter(t => (t.phase || '') === name).sort(sortTasks).forEach(t => {
        const col = t.due ? weekIndex(t.due) : 'x';
        const cell = wrap.querySelector(`.rm-cell[data-row="${ri}"][data-col="${col}"]`);
        if (!cell) return;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `rm-chip p${t.priority}${t.done ? ' done' : ''}${dueClass(t.due, t.done) === 'overdue' ? ' overdue' : ''}`;
        chip.title = `${t.title}${t.due ? ` · ${fmtDue(t.due)}` : ''}`;
        chip.innerHTML = `<i></i><span></span>`;
        chip.querySelector('span').textContent = t.title;
        chip.onclick = () => openDetail(t.id);
        cell.append(chip);
      });
    });
    const now = wrap.querySelector('.rm-week.now');
    if (now) requestAnimationFrame(() => { const sc = wrap.querySelector('.rm-scroll'); sc.scrollLeft = Math.max(0, now.offsetLeft - 220); });
    animateEntry = false; lastAddedId = null;
  }

  // ---------- Mind map view: project → tasks → sub-tasks ----------
  function renderMindmap() {
    const area = $('taskArea'); area.innerHTML = '';
    const project = projectById(view.id);
    const tasks = state.tasks.filter(t => t.projectId === view.id).sort((a, b) => (a.done - b.done) || (a.order - b.order));
    const tree = {
      id: 'root', title: project.name, kind: 'root',
      children: tasks.map((t, i) => ({ id: t.id, title: t.title, kind: 'task', done: t.done, children: t.subtasks.map(s => ({ id: `${t.id}:${s.id}`, title: s.title, kind: 'sub', done: s.done, taskId: t.id })) })),
    };
    const box = document.createElement('div'); box.className = 'mm-wrap';
    area.append(box);
    if (!tasks.length) {
      const hint = document.createElement('p'); hint.className = 'mm-hint';
      hint.textContent = aiReady() ? 'Tap + on the project to brainstorm ideas with AI, or add tasks below.' : 'Add tasks below. Each task becomes a branch, and its sub-tasks the leaves.';
      area.append(hint);
    }
    MindMap.render(box, tree, {
      onNodeClick: (n) => openDetail(n.kind === 'task' ? n.id : n.taskId),
      onExpand: aiReady() ? (n, btn) => expandNode(n, btn, project, tasks) : null,
    });
    animateEntry = false; lastAddedId = null;
  }
  async function expandNode(n, btn, project, tasks) {
    btn.classList.add('busy');
    try {
      const task = n.kind === 'task' ? state.tasks.find(t => t.id === n.id) : null;
      const siblings = task ? task.subtasks.map(s => s.title) : tasks.map(t => t.title);
      const items = await TaskAI.expand({ node: n.title, parent: task ? project.name : null, siblings });
      if (!items.length) { toast('No new ideas this time'); return; }
      if (task) {
        const before = task.subtasks.slice();
        task.subtasks = [...task.subtasks, ...items.map(x => ({ id: uid(), title: x, done: false }))];
        save(); render();
        toast(`Added ${items.length} sub-tasks`, () => { task.subtasks = before; });
      } else {
        const now = Date.now();
        const added = items.map((x, i) => ({ id: uid(), title: x, desc: '', priority: 4, labels: [], repeat: null, done: false, doneAt: null, due: null, subtasks: [], projectId: project.id, created: now + i, order: now + i }));
        state.tasks.push(...added); save(); render();
        toast(`Added ${added.length} tasks`, () => { const ids = new Set(added.map(t => t.id)); state.tasks = state.tasks.filter(t => !ids.has(t.id)); });
      }
    } catch (err) { toast(err.message); }
    finally { btn.classList.remove('busy'); }
  }

  // refresh "Today" when the date changes
  let lastDay = todayIso();
  setInterval(() => { if (todayIso() !== lastDay) { lastDay = todayIso(); render(); } }, 60000);

  hydrate();
  applyTheme(store.get('tasklist.theme'));
  render();
  openFromHash();
})();
