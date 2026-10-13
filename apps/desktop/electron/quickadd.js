(function () {
  const f = document.getElementById('f'), t = document.getElementById('t'), p = document.getElementById('p'), a = document.getElementById('a');
  const { parse } = window.TaskParser;
  const { svg, hydrate } = window.Icons;
  hydrate();

  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function fmt(due) {
    const d = new Date(due + 'T00:00'), n = Math.round((d - new Date(new Date().toDateString())) / 864e5);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    if (n > 1 && n < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  function preview() {
    const r = parse(t.value), tok = (i, s) => `<span class="token">${svg(i)}${esc(s)}</span>`, bits = [];
    if (r.due) bits.push(tok('calendar', fmt(r.due)));
    if (r.priority < 4) bits.push(tok('flagFill', 'P' + r.priority));
    if (r.project) bits.push(tok('hash', r.project));
    r.labels.forEach(l => bits.push(tok('tag', l)));
    if (r.repeat) bits.push(tok('repeat', r.repeat));
    p.innerHTML = bits.join('');
    a.disabled = !r.title;
  }
  function reset() {
    t.value = ''; preview(); t.focus();
    f.classList.remove('again'); void f.offsetWidth; f.classList.add('again');
  }

  t.addEventListener('input', preview);
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!parse(t.value).title) return;
    window.desktop.submitQuickAdd(t.value);
    reset();
  });
  document.getElementById('c').onclick = () => window.desktop.closeQuickAdd();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.desktop.closeQuickAdd(); });
  window.desktop.onQuickAddReset(reset);
})();
