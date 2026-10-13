// Sync model shared by the browser/phone app and the desktop sync hub.
// Every task and project carries `updatedAt`; deletions are kept as tombstones { id: deletedAt }.
// Merging is last-write-wins per item, so any number of devices converge on the same state.
(function (global) {
  const KINDS = ['tasks', 'projects'];

  function empty() { return { tasks: [], projects: [], tombstones: {} }; }

  function normalize(s) {
    const out = { ...empty(), ...(s || {}) };
    KINDS.forEach(k => { out[k] = Array.isArray(out[k]) ? out[k] : []; });
    out.tombstones = out.tombstones && typeof out.tombstones === 'object' ? out.tombstones : {};
    return out;
  }

  const strip = (item) => { const { updatedAt, ...rest } = item; return JSON.stringify(rest); };

  // Stamp items that changed since `prev` and record tombstones for removed ones.
  function track(prev, next, now = Date.now()) {
    prev = normalize(prev); next = normalize(next);
    KINDS.forEach(k => {
      const before = new Map(prev[k].map(x => [x.id, x]));
      const ids = new Set();
      next[k].forEach(item => {
        ids.add(item.id);
        const old = before.get(item.id);
        if (!old || strip(old) !== strip(item) || !item.updatedAt) item.updatedAt = Math.max(now, (old && old.updatedAt || 0) + 1);
        delete next.tombstones[item.id];
      });
      before.forEach((_, id) => { if (!ids.has(id)) next.tombstones[id] = now; });
    });
    return next;
  }

  function merge(a, b) {
    a = normalize(a); b = normalize(b);
    const tomb = { ...a.tombstones };
    Object.entries(b.tombstones).forEach(([id, t]) => { tomb[id] = Math.max(tomb[id] || 0, t); });
    const out = { tombstones: tomb };
    KINDS.forEach(k => {
      const map = new Map();
      [...a[k], ...b[k]].forEach(item => {
        if (!item || !item.id) return;
        const cur = map.get(item.id);
        if (!cur || (item.updatedAt || 0) > (cur.updatedAt || 0)) map.set(item.id, item);
      });
      // keep a's order first so local ordering stays stable, then items only b has
      const order = [...a[k], ...b[k]].map(x => x && x.id).filter((id, i, arr) => id && arr.indexOf(id) === i);
      out[k] = order.map(id => map.get(id)).filter(item => !(tomb[item.id] >= (item.updatedAt || 0)));
    });
    // forget tombstones older than 60 days
    const cutoff = Date.now() - 60 * 864e5;
    Object.keys(tomb).forEach(id => { if (tomb[id] < cutoff) delete tomb[id]; });
    return out;
  }

  const same = (a, b) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));

  global.TaskSync = { empty, normalize, track, merge, same };
  if (typeof module !== 'undefined') module.exports = global.TaskSync;
})(typeof window !== 'undefined' ? window : globalThis);
