// Natural-language quick-add parser: "Call mom tomorrow 5pm p1 #Family @phone every week"
(function (global) {
  const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function iso(d) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function addDays(d, n) { const c = new Date(d); c.setDate(c.getDate() + n); return c; }

  function parse(input, today = new Date()) {
    let text = ' ' + input + ' ';
    const out = { title: '', due: null, priority: 4, project: null, labels: [], repeat: null };
    const take = (re, fn) => { text = text.replace(re, (...m) => { fn(...m); return ' '; }); };

    take(/\s!?p([1-4])(?=\s)/i, (_, p) => { out.priority = Number(p); });
    take(/\s#([\w-]+)/, (_, p) => { out.project = p; });
    take(/\s@([\w-]+)/g, (_, l) => { out.labels.push(l.toLowerCase()); });
    take(/\severy\s+(day|week|month)(?=\s)/i, (_, r) => {
      out.repeat = { day: 'daily', week: 'weekly', month: 'monthly' }[r.toLowerCase()];
      if (!out.due) out.due = iso(today);
    });
    take(/\s(today|tod)(?=\s)/i, () => { out.due = iso(today); });
    take(/\s(tomorrow|tmr|tom)(?=\s)/i, () => { out.due = iso(addDays(today, 1)); });
    take(/\snext\s+week(?=\s)/i, () => { out.due = iso(addDays(today, ((8 - today.getDay()) % 7) || 7)); });
    take(/\sin\s+(\d+)\s+(day|days|week|weeks)(?=\s)/i, (_, n, u) => {
      out.due = iso(addDays(today, Number(n) * (u.startsWith('week') ? 7 : 1)));
    });
    take(new RegExp(`\\s(?:on\\s+|next\\s+)?(${DAYS.join('|')}|${DAYS.map(d => d.slice(0, 3)).join('|')})(?=\\s)`, 'i'), (_, d) => {
      const target = DAYS.findIndex(x => x.startsWith(d.toLowerCase().slice(0, 3)));
      let diff = (target - today.getDay() + 7) % 7; if (diff === 0) diff = 7;
      out.due = iso(addDays(today, diff));
    });
    take(new RegExp(`\\s(\\d{1,2})\\s+(${MONTHS.join('|')})[a-z]*(?=\\s)`, 'i'), (_, day, mon) => {
      const d = new Date(today.getFullYear(), MONTHS.indexOf(mon.toLowerCase().slice(0, 3)), Number(day));
      if (d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) d.setFullYear(d.getFullYear() + 1);
      out.due = iso(d);
    });
    take(new RegExp(`\\s(${MONTHS.join('|')})[a-z]*\\s+(\\d{1,2})(?=\\s)`, 'i'), (_, mon, day) => {
      const d = new Date(today.getFullYear(), MONTHS.indexOf(mon.toLowerCase().slice(0, 3)), Number(day));
      if (d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) d.setFullYear(d.getFullYear() + 1);
      out.due = iso(d);
    });

    out.title = text.replace(/\s+/g, ' ').trim();
    return out;
  }

  global.TaskParser = { parse, iso, addDays };
  if (typeof module !== 'undefined') module.exports = global.TaskParser;
})(typeof window !== 'undefined' ? window : globalThis);
