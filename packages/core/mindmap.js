// Radial mind map renderer (SVG). Tree: { id, title, kind: 'root'|'task'|'sub', done, color, children: [...] }
(function (global) {
  const NS = 'http://www.w3.org/2000/svg';
  const BRANCH_COLORS = ['#d1453b', '#2f6fdb', '#1f8a4c', '#e08a12', '#7a5af0', '#1a9bc4', '#c561c5', '#5fa83a'];
  const el = (tag, attrs = {}, parent) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  };
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const LABEL = { 0: [34, 16, 40], 1: [30, 13.5, 28], 2: [34, 12.5, 28] }; // max chars, font size, padding per depth
  const boxWidth = (title, depth) => {
    const [max, fs, pad] = LABEL[depth];
    return Math.max(depth === 0 ? 120 : 70, trunc(title || 'Untitled', max).length * fs * 0.56 + pad);
  };

  // Assign each node an angle and radius. Leaves share the circle; subtrees get space by leaf count.
  // Each ring is just large enough that neighbouring boxes (spaced by angle) don't overlap.
  function layout(root) {
    const leaves = (n) => (n.children && n.children.length ? n.children.reduce((a, c) => a + leaves(c), 0) : 1);
    const total = Math.max(leaves(root), 1);
    const kids = root.children || [];
    const grand = kids.flatMap(k => k.children || []);
    const w1 = Math.max(0, ...kids.map(k => boxWidth(k.title, 1))) + 18;
    const w2 = Math.max(0, ...grand.map(g => boxWidth(g.title, 2))) + 14;
    const ringFor = (w, n) => (n > 1 ? w / (2 * Math.sin(Math.PI / n)) : 0);
    // Branches sit at least one leaf-slot (2π / total) apart, so size ring 1 for that spacing.
    const R1 = Math.max(190, ringFor(w1, total), boxWidth(root.title, 0) / 2 + w1 / 2 + 30);
    const R2 = Math.max(R1 + 170, grand.length ? ringFor(w2, total) : 0);
    const out = [];
    let cursor = -Math.PI / 2;
    const span = (2 * Math.PI) / total;
    (root.children || []).forEach((b, i) => {
      const n = leaves(b), a0 = cursor, a1 = cursor + n * span;
      cursor = a1;
      const ang = (a0 + a1) / 2;
      const color = b.color || BRANCH_COLORS[i % BRANCH_COLORS.length];
      out.push({ node: b, parent: root, depth: 1, ang, r: R1, color });
      let c0 = a0;
      (b.children || []).forEach((c) => {
        const ca = c0 + span / 2; c0 += span;
        out.push({ node: c, parent: b, depth: 2, ang: ca, r: R2, color });
      });
    });
    return { items: out, extent: R2 + 160 };
  }

  function render(container, tree, opts = {}) {
    container.innerHTML = '';
    container.classList.add('mm');
    const svg = el('svg', { class: 'mm-svg', role: 'img', 'aria-label': `Mind map: ${tree.title}` }, container);
    const world = el('g', {}, svg);
    const edges = el('g', { class: 'mm-edges' }, world);
    const nodes = el('g', { class: 'mm-nodes' }, world);
    const { items, extent } = layout(tree);
    const pos = new Map([[tree.id, { x: 0, y: 0 }]]);
    items.forEach(it => pos.set(it.node.id, { x: Math.cos(it.ang) * it.r, y: Math.sin(it.ang) * it.r, it }));

    // edges
    items.forEach((it) => {
      const a = pos.get(it.parent.id), b = pos.get(it.node.id);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const cx = it.depth === 1 ? mx * 0.6 : (a.x * 0.35 + mx * 0.65), cy = it.depth === 1 ? my * 0.6 : (a.y * 0.35 + my * 0.65);
      el('path', { d: `M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`, stroke: it.color, class: `mm-edge d${it.depth}${it.node.done ? ' done' : ''}` }, edges);
    });

    function drawNode(n, p, depth, color) {
      const label = trunc(n.title || 'Untitled', LABEL[depth][0]);
      const fs = LABEL[depth][1];
      const w = boxWidth(n.title, depth);
      const h = depth === 0 ? 46 : depth === 1 ? 36 : 30;
      const g = el('g', { class: `mm-node d${depth}${n.done ? ' done' : ''}`, transform: `translate(${p.x},${p.y})`, tabindex: n.kind === 'root' ? null : 0, role: n.kind === 'root' ? null : 'button' }, nodes);
      el('title', {}, g).textContent = n.title;
      g.style.setProperty('--c', color || 'var(--accent)');
      el('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: depth === 2 ? 8 : 12, class: 'mm-box' }, g);
      const t = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': fs, class: 'mm-text' }, g);
      t.textContent = label;
      if (n.done) el('line', { x1: -w / 2 + 14, x2: w / 2 - 14, y1: 0.5, y2: 0.5, class: 'mm-strike' }, g);
      if (opts.onNodeClick && n.kind !== 'root') {
        g.addEventListener('click', (e) => { if (!moved) opts.onNodeClick(n, e); });
        g.addEventListener('keydown', (e) => { if (e.key === 'Enter') opts.onNodeClick(n, e); });
      }
      if (opts.onExpand && depth < 2 && !n.done) {
        // "+": ask AI for more children under this node
        const bx = depth === 0 ? 0 : w / 2 + 4, by = depth === 0 ? h / 2 + 4 : 0;
        const b = el('g', { class: 'mm-plus', transform: `translate(${bx},${by})`, role: 'button', tabindex: 0, 'aria-label': `Expand “${n.title}” with AI` }, g);
        el('title', {}, b).textContent = 'Expand with AI';
        el('circle', { r: 11 }, b);
        el('path', { d: 'M-5,0H5M0,-5V5' }, b);
        const go = (e) => { e.stopPropagation(); if (!moved) opts.onExpand(n, b); };
        b.addEventListener('click', go);
        b.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e); });
      }
      return g;
    }
    items.filter(i => i.depth === 2).forEach(i => drawNode(i.node, pos.get(i.node.id), 2, i.color));
    items.filter(i => i.depth === 1).forEach(i => drawNode(i.node, pos.get(i.node.id), 1, i.color));
    drawNode(tree, { x: 0, y: 0 }, 0, null);

    // ---------- pan / zoom ----------
    let vb = { x: -extent, y: -extent, w: extent * 2, h: extent * 2 };
    const apply = () => svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    function fit() {
      const bb = world.getBBox();
      const pad = 40, r = container.clientWidth / Math.max(container.clientHeight, 1);
      let w = bb.width + pad * 2, h = bb.height + pad * 2;
      if (w / h < r) w = h * r; else h = w / r;
      vb = { x: bb.x + bb.width / 2 - w / 2, y: bb.y + bb.height / 2 - h / 2, w, h };
      apply();
    }
    function zoom(f, cx, cy) {
      const nw = Math.min(Math.max(vb.w * f, 200), extent * 8), k = nw / vb.w;
      const px = cx == null ? vb.x + vb.w / 2 : cx, py = cy == null ? vb.y + vb.h / 2 : cy;
      vb = { x: px - (px - vb.x) * k, y: py - (py - vb.y) * k, w: nw, h: vb.h * k };
      apply();
    }
    const toWorld = (clientX, clientY) => {
      const r = svg.getBoundingClientRect();
      return { x: vb.x + ((clientX - r.left) / r.width) * vb.w, y: vb.y + ((clientY - r.top) / r.height) * vb.h };
    };
    svg.addEventListener('wheel', (e) => { e.preventDefault(); const p = toWorld(e.clientX, e.clientY); zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12, p.x, p.y); }, { passive: false });
    const pointers = new Map();
    let moved = false, startDist = 0, startVb = null;
    svg.addEventListener('pointerdown', (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = false; startVb = { ...vb };
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; startDist = Math.hypot(a.x - b.x, a.y - b.y); }
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      const prev = pointers.get(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const r = svg.getBoundingClientRect();
      if (pointers.size === 1) {
        const dx = (e.clientX - prev.x) * (vb.w / r.width), dy = (e.clientY - prev.y) * (vb.h / r.height);
        if (Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y) > 0) moved = moved || Math.hypot(dx, dy) > vb.w * 0.004;
        vb.x -= dx; vb.y -= dy; apply();
      } else if (pointers.size === 2 && startDist) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        moved = true;
        vb = { ...startVb }; zoom(startDist / d);
      }
    });
    const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) startDist = 0; setTimeout(() => { if (!pointers.size) moved = false; }, 0); };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);

    // controls
    const ctl = document.createElement('div');
    ctl.className = 'mm-controls';
    ctl.innerHTML = '<button type="button" class="icon-btn" data-z="in" aria-label="Zoom in">+</button><button type="button" class="icon-btn" data-z="out" aria-label="Zoom out">−</button><button type="button" class="icon-btn" data-z="fit" aria-label="Fit to screen">⤢</button>';
    ctl.addEventListener('click', (e) => { const z = e.target.closest('[data-z]'); if (!z) return; z.dataset.z === 'in' ? zoom(1 / 1.25) : z.dataset.z === 'out' ? zoom(1.25) : fit(); });
    container.appendChild(ctl);
    requestAnimationFrame(fit);
    return { fit };
  }

  global.MindMap = { render, BRANCH_COLORS };
})(window);
