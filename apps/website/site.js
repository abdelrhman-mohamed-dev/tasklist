(function () {
  const { svg, hydrate } = window.Icons;
  const { parse } = window.TaskParser;
  hydrate();

  // ---------- quick-add demo (the app's own parser) ----------
  const input = document.getElementById('demoInput');
  const titleEl = document.getElementById('demoTitle');
  const chipsEl = document.getElementById('demoChips');
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function friendly(iso) {
    const d = new Date(iso + 'T00:00'), today = new Date(new Date().toDateString());
    const n = Math.round((d - today) / 864e5);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n > 1 && n < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  let last = '';
  function renderDemo() {
    const r = parse(input.value);
    titleEl.innerHTML = r.title ? `Task: <b>${esc(r.title)}</b>` : 'Start typing a task…';
    const chips = [];
    if (r.due) chips.push(['calendar', friendly(r.due)]);
    if (r.repeat) chips.push(['repeat', { daily: 'Every day', weekly: 'Every week', monthly: 'Every month' }[r.repeat]]);
    if (r.priority < 4) chips.push(['flagFill', `Priority ${r.priority}`]);
    if (r.project) chips.push(['hash', r.project]);
    r.labels.forEach(l => chips.push(['tag', l]));
    const html = chips.length
      ? chips.map(([i, t], k) => `<span class="chip" style="animation-delay:${k * 50}ms">${svg(i)}${esc(t)}</span>`).join('')
      : '<span class="chip muted">Try “tomorrow”, “p1”, “#Project” or “@label”</span>';
    if (html !== last) { chipsEl.innerHTML = html; last = html; }
  }
  input.addEventListener('input', renderDemo);
  document.querySelectorAll('[data-ex]').forEach(b => b.addEventListener('click', () => { input.value = b.dataset.ex; renderDemo(); input.focus(); }));
  renderDemo();

  // ---------- reveal on scroll ----------
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const items = document.querySelectorAll('.reveal');
  if (reduce || !('IntersectionObserver' in window)) items.forEach(el => el.classList.add('in'));
  else {
    const io = new IntersectionObserver((entries) => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
    items.forEach(el => io.observe(el));
  }

  // ---------- nav border once the page scrolls (sentinel, no scroll listener) ----------
  const nav = document.querySelector('.nav');
  const sentinel = document.createElement('div');
  sentinel.style.cssText = 'position:absolute;top:0;height:1px;width:1px';
  document.body.prepend(sentinel);
  new IntersectionObserver(([e]) => nav.classList.toggle('scrolled', !e.isIntersecting)).observe(sentinel);

  // ---------- downloads: show file sizes, mark missing builds ----------
  document.querySelectorAll('[data-file]').forEach(async (a) => {
    try {
      const res = await fetch(a.dataset.file, { method: 'HEAD' });
      if (!res.ok) throw new Error();
      const bytes = Number(res.headers.get('content-length'));
      if (bytes) a.querySelector('.size').textContent = `(${bytes > 10485760 ? Math.round(bytes / 1048576) : (bytes / 1048576).toFixed(1)} MB)`;
    } catch (_) {
      a.classList.add('missing');
      a.title = 'This build has not been published yet';
    }
  });

  // ---------- point the hero buttons at the matching download card ----------
  document.querySelectorAll('[data-platform]').forEach(a => a.addEventListener('click', () => {
    const card = document.getElementById(`dl-${a.dataset.platform}`);
    if (card) setTimeout(() => card.querySelector('.btn')?.focus({ preventScroll: true }), 600);
  }));
})();
