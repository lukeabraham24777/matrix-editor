/* Excalidraw-style drawing layer: tools, shapes, text, images, selection handles and the style panel. */
(function (G) {
  'use strict';
  const MX = G.MX;
  const { el } = MX;
  const Ed = MX.Ed;
  const SVG = 'http://www.w3.org/2000/svg';
  const PAD = 24; // room around a shape for rough strokes and arrowheads

  const D = (MX.Draw = {
    tool: 'select',
    locked: false,
    spacePan: false,
    style: { stroke: '#1e1e1e', bg: 'transparent', fill: 'hachure', sw: 2, ss: 'solid', rough: 1, round: true, opacity: 100, startArrow: 'none', endArrow: 'arrow', fontSize: 24, font: 'hand', align: 'left' },
  });
  const CREATE_TOOLS = ['rect', 'diamond', 'ellipse', 'arrow', 'line', 'draw', 'text', 'image', 'eraser'];
  const isDrawable = (it) => it && (it.kind === 'shape' || it.kind === 'text' || it.kind === 'image');
  const FONTS = { hand: "'Caveat', 'Kalam', cursive", normal: 'system-ui, -apple-system, sans-serif', code: "ui-monospace, 'SF Mono', Menlo, monospace" };
  const FONT_SCALE = { hand: 1.25, normal: 1, code: 0.95 };

  /* ---------------- rough.js (hand-drawn strokes) ---------------- */
  let rough = null;
  (function loadRough() {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/roughjs@4.6.6/bundled/rough.js';
    s.onload = () => { rough = G.rough || null; Ed.state.items.filter((i) => i.kind === 'shape').forEach((i) => Ed.renderItem(i)); };
    document.head.append(s);
  })();

  const svg = (tag, attrs) => { const e = document.createElementNS(SVG, tag); for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]); return e; };
  const dashFor = (st) => (st.ss === 'dashed' ? [8 + st.sw * 2, 6 + st.sw] : st.ss === 'dotted' ? [1.5, 5 + st.sw * 1.5] : null);
  const rot = (x, y, a) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];

  /** Smooth path through points (Catmull-Rom → cubic Bézier). */
  function smoothPath(pts, closed) {
    if (pts.length < 2) return pts.length ? `M${pts[0][0]} ${pts[0][1]}l0.01 0` : '';
    if (pts.length === 2) return `M${pts[0][0]} ${pts[0][1]}L${pts[1][0]} ${pts[1][1]}`;
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return closed ? d + 'Z' : d;
  }
  /** Freehand stroke: midpoint-quadratic smoothing. */
  function freehandPath(pts) {
    if (pts.length < 3) return smoothPath(pts);
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; d += `Q${pts[i][0]} ${pts[i][1]} ${mx.toFixed(1)} ${my.toFixed(1)}`; }
    const l = pts[pts.length - 1];
    return d + `L${l[0]} ${l[1]}`;
  }
  function roundRectPath(w, h) {
    const r = Math.min(Math.abs(w), Math.abs(h)) * 0.25 * Math.sign(1);
    const rr = Math.min(r, 32);
    return `M${rr} 0L${w - rr} 0Q${w} 0 ${w} ${rr}L${w} ${h - rr}Q${w} ${h} ${w - rr} ${h}L${rr} ${h}Q0 ${h} 0 ${h - rr}L0 ${rr}Q0 0 ${rr} 0Z`;
  }
  function diamondPts(w, h) { return [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]; }
  function diamondPath(w, h, round) {
    const p = diamondPts(w, h);
    if (!round) return `M${p.map((q) => q.join(' ')).join('L')}Z`;
    const r = 0.18;
    let d = '';
    p.forEach((q, i) => {
      const prev = p[(i + 3) % 4], next = p[(i + 1) % 4];
      const a = [q[0] + (prev[0] - q[0]) * r, q[1] + (prev[1] - q[1]) * r], b = [q[0] + (next[0] - q[0]) * r, q[1] + (next[1] - q[1]) * r];
      d += (i ? 'L' : 'M') + a.join(' ') + 'Q' + q.join(' ') + ' ' + b.join(' ');
    });
    return d + 'Z';
  }
  function arrowHead(kind, tip, from, sw) {
    // returns [{type:'line'|'poly'|'circle', pts}] in local coords
    const ang = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
    const len = Math.min(30, Math.max(10, 8 + sw * 4), Math.hypot(tip[0] - from[0], tip[1] - from[1]) * 0.6 || 30);
    const wing = (s) => [tip[0] - len * Math.cos(ang + s), tip[1] - len * Math.sin(ang + s)];
    if (kind === 'arrow') return [{ type: 'line', pts: [wing(0.42), tip] }, { type: 'line', pts: [wing(-0.42), tip] }];
    if (kind === 'triangle') return [{ type: 'poly', pts: [tip, wing(0.4), wing(-0.4)] }];
    if (kind === 'bar') { const p = Math.PI / 2; const s = len * 0.6; return [{ type: 'line', pts: [[tip[0] + s * Math.cos(ang + p), tip[1] + s * Math.sin(ang + p)], [tip[0] - s * Math.cos(ang + p), tip[1] - s * Math.sin(ang + p)]] }]; }
    if (kind === 'dot') return [{ type: 'circle', pts: [tip], r: Math.max(4, sw * 2.2) }];
    return [];
  }

  /* ---------------- rendering ---------------- */
  function drawShape(it, g, svgRoot) {
    const st = it.style; const w = it.w, h = it.h;
    const fill = st.bg && st.bg !== 'transparent' ? st.bg : null;
    const opts = { seed: it.seed, roughness: st.rough, bowing: st.rough ? 1 : 0, stroke: st.stroke, strokeWidth: st.sw, fill: fill || undefined, fillStyle: st.fill, fillWeight: st.sw / 2, hachureGap: 4 + st.sw * 2, strokeLineDash: dashFor(st) || undefined, disableMultiStroke: st.ss !== 'solid', preserveVertices: true };
    const rc = rough && rough.svg(svgRoot);
    const add = (n) => g.append(n);
    const plain = (d, extra = {}) => svg('path', Object.assign({ d, stroke: st.stroke, 'stroke-width': st.sw, fill: extra.fill || 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': dashFor(st) ? dashFor(st).join(' ') : null }, extra));
    let hitD;
    if (it.type === 'rect') {
      const d = st.round ? roundRectPath(w, h) : `M0 0H${w}V${h}H0Z`;
      hitD = d;
      if (rc && st.rough) add(st.round ? rc.path(d, opts) : rc.rectangle(0, 0, w, h, opts));
      else { if (fill && st.fill !== 'solid' && rc) add(rc.path(d, Object.assign({}, opts, { stroke: 'none' }))); add(plain(d, { fill: fill && (st.fill === 'solid' || !rc) ? fill : 'none' })); }
    } else if (it.type === 'diamond') {
      const d = diamondPath(w, h, st.round);
      hitD = d;
      if (rc && st.rough) add(st.round ? rc.path(d, opts) : rc.polygon(diamondPts(w, h), opts));
      else { if (fill && st.fill !== 'solid' && rc) add(rc.path(d, Object.assign({}, opts, { stroke: 'none' }))); add(plain(d, { fill: fill && (st.fill === 'solid' || !rc) ? fill : 'none' })); }
    } else if (it.type === 'ellipse') {
      const d = `M0 ${h / 2}A${w / 2} ${h / 2} 0 1 0 ${w} ${h / 2}A${w / 2} ${h / 2} 0 1 0 0 ${h / 2}Z`;
      hitD = d;
      if (rc && st.rough) add(rc.ellipse(w / 2, h / 2, w, h, opts));
      else { if (fill && st.fill !== 'solid' && rc) add(rc.path(d, Object.assign({}, opts, { stroke: 'none' }))); add(plain(d, { fill: fill && (st.fill === 'solid' || !rc) ? fill : 'none' })); }
    } else if (it.type === 'line' || it.type === 'arrow') {
      const pts = it.points;
      if (!pts || pts.length < 2) return; // still being created
      hitD = smoothPath(pts);
      if (rc && st.rough) add(pts.length > 2 ? rc.curve(pts, Object.assign({}, opts, { fill: undefined })) : rc.line(pts[0][0], pts[0][1], pts[1][0], pts[1][1], opts));
      else add(plain(hitD));
      const heads = [];
      if (pts.length >= 2) {
        const n = pts.length;
        // direction from a point a little way back along the curve
        if (st.endArrow && st.endArrow !== 'none') heads.push(...arrowHead(st.endArrow, pts[n - 1], n > 2 ? lerpCurve(pts, 0.92) : pts[0], st.sw));
        if (st.startArrow && st.startArrow !== 'none') heads.push(...arrowHead(st.startArrow, pts[0], n > 2 ? lerpCurve(pts, 0.08) : pts[1], st.sw));
      }
      heads.forEach((hd) => {
        const o2 = Object.assign({}, opts, { strokeLineDash: undefined, fill: undefined });
        if (hd.type === 'line') add(rc && st.rough ? rc.line(hd.pts[0][0], hd.pts[0][1], hd.pts[1][0], hd.pts[1][1], o2) : svg('path', { d: `M${hd.pts[0].join(' ')}L${hd.pts[1].join(' ')}`, stroke: st.stroke, 'stroke-width': st.sw, 'stroke-linecap': 'round' }));
        else if (hd.type === 'poly') add(rc && st.rough ? rc.polygon(hd.pts, Object.assign({}, o2, { fill: st.stroke, fillStyle: 'solid' })) : svg('path', { d: `M${hd.pts.map((p) => p.join(' ')).join('L')}Z`, fill: st.stroke, stroke: st.stroke, 'stroke-width': st.sw, 'stroke-linejoin': 'round' }));
        else add(svg('circle', { cx: hd.pts[0][0], cy: hd.pts[0][1], r: hd.r, fill: st.stroke }));
      });
    } else if (it.type === 'draw') {
      hitD = freehandPath(it.points);
      add(svg('path', { d: hitD, stroke: st.stroke, 'stroke-width': st.sw * 1.4 + 0.5, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'stroke-dasharray': dashFor(st) ? dashFor(st).join(' ') : null }));
    }
    // invisible, generous hit area
    const filled = fill && ['rect', 'diamond', 'ellipse'].includes(it.type);
    g.append(svg('path', { d: hitD, class: 'hit', fill: filled ? 'transparent' : 'none', stroke: 'transparent', 'stroke-width': Math.max(14, st.sw + 10), 'stroke-linecap': 'round', 'pointer-events': filled ? 'all' : 'stroke' }));
  }
  function lerpCurve(pts, t) {
    // approximate point on the polyline at fraction t
    const seg = []; let total = 0;
    for (let i = 0; i < pts.length - 1; i++) { const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); seg.push(l); total += l; }
    let d = total * t;
    for (let i = 0; i < seg.length; i++) { if (d <= seg[i]) { const f = seg[i] ? d / seg[i] : 0; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f]; } d -= seg[i]; }
    return pts[pts.length - 1];
  }

  D.build = function (it) {
    const e = el('div', { class: 'item ' + it.kind + (it.kind === 'shape' ? ' shape-' + it.type : ''), 'data-id': it.id });
    e.style.width = Math.max(1, it.w || 0) + 'px'; e.style.height = Math.max(1, it.h || 0) + 'px';
    if (it.angle) e.style.transform = `rotate(${it.angle}rad)`;
    const op = (it.style ? it.style.opacity : it.opacity) ?? 100;
    if (op < 100) e.style.opacity = op / 100;
    if (it.kind === 'shape') {
      const s = svg('svg', { width: it.w + 2 * PAD, height: it.h + 2 * PAD, class: 'shape-svg' });
      s.style.left = -PAD + 'px'; s.style.top = -PAD + 'px';
      const g = svg('g', { transform: `translate(${PAD} ${PAD})` });
      s.append(g); drawShape(it, g, s); e.append(s);
    } else if (it.kind === 'text') {
      e.style.width = ''; e.style.height = '';
      const t = el('div', { class: 'tx', 'data-k': 'tx', spellcheck: 'false' });
      t.textContent = it.text;
      Object.assign(t.style, { fontSize: it.fontSize * (FONT_SCALE[it.font] || 1) + 'px', fontFamily: FONTS[it.font] || FONTS.hand, color: it.color, textAlign: it.align || 'left' });
      e.append(t);
      t.addEventListener('blur', () => finishText(it, t));
      t.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' || (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey))) { ev.preventDefault(); t.blur(); } });
      t.addEventListener('input', () => { it.text = t.innerText; requestAnimationFrame(D.updateOverlay); });
      e.addEventListener('dblclick', (ev) => { ev.stopPropagation(); D.editText(it); });
    } else if (it.kind === 'image') {
      e.append(el('img', { src: it.src, draggable: 'false', alt: '' }));
    }
    e.addEventListener('pointerdown', (ev) => {
      if (ev.button > 0 || D.tool !== 'select' || D.spacePan) return;
      if (it.kind === 'text' && e.querySelector('.tx').isContentEditable) return;
      if (it.kind === 'shape' && !ev.target.classList.contains('hit')) return;
      ev.stopPropagation();
      if (document.activeElement && document.activeElement !== document.body && !e.contains(document.activeElement)) document.activeElement.blur();
      Ed.closePopover();
      Ed.startDrag(ev, it, e);
    });
    return e;
  };

  /* ---------------- text editing ---------------- */
  D.editText = function (it) {
    const e = Ed.els.get(it.id); if (!e) return;
    const t = e.querySelector('.tx');
    t.contentEditable = 'true'; e.classList.add('editing');
    Ed.select(it.id);
    t.focus();
    const r = document.createRange(); r.selectNodeContents(t); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  };
  function finishText(it, t) {
    t.contentEditable = 'false';
    const e = Ed.els.get(it.id); if (e) e.classList.remove('editing');
    it.text = t.innerText.replace(/\n$/, '');
    if (!it.text.trim()) { Ed.remove([it.id]); }
    Ed.commit(); D.updateOverlay();
  }

  /* ---------------- geometry helpers ---------------- */
  function normalizePoints(it) {
    const xs = it.points.map((p) => p[0]), ys = it.points.map((p) => p[1]);
    const mx = Math.min(...xs), my = Math.min(...ys);
    it.points = it.points.map((p) => [Math.round((p[0] - mx) * 10) / 10, Math.round((p[1] - my) * 10) / 10]);
    it.x = Math.round((it.x + mx) * 10) / 10; it.y = Math.round((it.y + my) * 10) / 10;
    it.w = Math.max(...xs) - mx; it.h = Math.max(...ys) - my;
  }
  D.normalizePoints = normalizePoints;
  /** Axis-aligned bounds of any item in world units (rotation included). */
  D.bounds = function (it) {
    const r = Ed.itemRect(it);
    if (!it.angle) return r;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const cs = [[-r.w / 2, -r.h / 2], [r.w / 2, -r.h / 2], [r.w / 2, r.h / 2], [-r.w / 2, r.h / 2]].map(([x, y]) => rot(x, y, it.angle));
    const xs = cs.map((c) => c[0] + cx), ys = cs.map((c) => c[1] + cy);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };

  /* ---------------- tools ---------------- */
  const TOOLBAR = [
    ['lock', '🔓', 'Keep the selected tool active after drawing (Q)'],
    ['hand', 'hand', 'Hand — pan the paper (H, or hold Space)'],
    ['select', 'select', 'Selection (V or 1)', '1'],
    ['rect', 'rect', 'Rectangle (R or 2)', '2'],
    ['diamond', 'diamond', 'Diamond (D or 3)', '3'],
    ['ellipse', 'ellipse', 'Ellipse (O or 4)', '4'],
    ['arrow', 'arrow', 'Arrow (A or 5)', '5'],
    ['line', 'line', 'Line (L or 6)', '6'],
    ['draw', 'draw', 'Draw (P or 7)', '7'],
    ['text', 'text', 'Text (T or 8)', '8'],
    ['image', 'image', 'Insert image (9)', '9'],
    ['eraser', 'eraser', 'Eraser (E or 0)', '0'],
    ['matrix', 'matrix', 'New matrix (M)'],
    ['style', 'style', 'Style panel'],
  ];
  const ICONS = {
    hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-6.5v-1a1.5 1.5 0 0 1 3 0V12m0-5.5a1.5 1.5 0 0 1 3 0V12m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L3.3 15a1.5 1.5 0 0 1 2.4-1.8L8 15.5"/>',
    select: '<path d="M6 3l12 9-5.5 1L15 19l-2.5 1.2-2.6-6L6 17z"/>',
    rect: '<rect x="4" y="5" width="16" height="14" rx="2.5"/>',
    diamond: '<path d="M12 3l9 9-9 9-9-9z"/>',
    ellipse: '<circle cx="12" cy="12" r="8.5"/>',
    arrow: '<path d="M4 20L20 4M20 4h-8M20 4v8"/>',
    line: '<path d="M4 20L20 4"/>',
    draw: '<path d="M4 20c3-1 4-5 7-8s6-6 8-4-2 5-5 7-4 3-3 4 4 0 6-1"/>',
    text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20 16l-5-5-8 8"/>',
    eraser: '<path d="M8.5 20H20M4.6 14.6l8.8-8.8a2 2 0 0 1 2.8 0l2 2a2 2 0 0 1 0 2.8L10 19H7.8z"/>',
    matrix: '<path d="M7 4H4v16h3M17 4h3v16h-3"/><path d="M9 9h1M14 9h1M9 15h1M14 15h1"/>',
    style: '<circle cx="12" cy="12" r="8.5"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="9" r="1.2"/><circle cx="9" cy="15" r="1.2"/><path d="M14 15h3"/>',
  };
  const icon = (k) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[k] || ''}</svg>`;

  function buildToolbar() {
    const bar = document.getElementById('toolbar');
    bar.innerHTML = '';
    TOOLBAR.forEach(([key, ic, title, num]) => {
      const b = el('button', { class: 'tool', 'data-tool': key, title, 'aria-label': title });
      if (key === 'lock') b.textContent = D.locked ? '🔒' : '🔓';
      else b.innerHTML = icon(ic) + (num ? `<span class="tool-num">${num}</span>` : '');
      b.addEventListener('click', () => {
        if (key === 'lock') { D.locked = !D.locked; buildToolbar(); return; }
        if (key === 'matrix') { MX.App.newMatrixPicker(b); return; }
        if (key === 'style') { D.toggleProps(); return; }
        D.setTool(key);
      });
      if (key === 'lock' || key === 'hand' || key === 'matrix') bar.append(b);
      else bar.append(b);
      if (key === 'lock' || key === 'eraser') bar.append(el('span', { class: 'tool-sep' }));
    });
    syncToolbar();
  }
  function syncToolbar() {
    document.querySelectorAll('#toolbar .tool').forEach((b) => {
      b.classList.toggle('on', b.dataset.tool === D.tool || (b.dataset.tool === 'lock' && D.locked) || (b.dataset.tool === 'style' && propsForced));
    });
    const stage = Ed.stage;
    stage.className = stage.className.replace(/\btool-\S+/g, '').trim() + ' tool-' + (D.spacePan ? 'hand' : D.tool);
  }
  D.setTool = function (t) {
    if (t === 'image') { pickImage(); return; }
    D.tool = t;
    if (t !== 'select') Ed.closePopover();
    if (CREATE_TOOLS.includes(t) && t !== 'eraser') Ed.clearSelection();
    syncToolbar(); D.renderProps();
  };

  /* ---------------- creation & pointer handling ---------------- */
  let gesture = null; const pointers = new Map(); let pinch = null;
  function newShape(type, x, y) {
    const it = { id: 'i' + Ed.state.seq++, kind: 'shape', type, x, y, w: 0, h: 0, angle: 0, seed: (Math.random() * 2 ** 31) | 0, style: Object.assign({}, D.style) };
    if (type === 'line') { it.style.endArrow = 'none'; it.style.startArrow = 'none'; }
    if (type === 'arrow') { it.style.endArrow = D.style.endArrow === 'none' ? 'arrow' : D.style.endArrow; it.style.startArrow = D.style.startArrow; }
    if (type === 'line' || type === 'arrow' || type === 'draw') it.points = [[0, 0]];
    if (type === 'draw') it.style.rough = 0;
    Ed.state.items.push(it);
    return it;
  }
  D.addText = function (x, y, text, opts = {}) {
    const it = { id: 'i' + Ed.state.seq++, kind: 'text', x, y, text: text || '', fontSize: opts.fontSize || D.style.fontSize, font: opts.font || D.style.font, color: opts.color || D.style.stroke, align: D.style.align, opacity: D.style.opacity, angle: 0 };
    Ed.state.items.push(it);
    Ed.renderItem(it);
    return it;
  };
  const isChrome = (t) => t.closest && t.closest('.zoom-ctl, .selbar, #toolbar, #props, #toast');
  function onDown(ev) {
    if (!Ed.stage.contains(ev.target) || isChrome(ev.target)) return;
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    // two fingers: cancel whatever we were drawing and pinch-zoom instead
    if (pointers.size === 2 && (gesture || D.tool !== 'select')) {
      if (gesture && gesture.item) { Ed.state.items = Ed.state.items.filter((i) => i !== gesture.item); const e = Ed.els.get(gesture.item.id); if (e) e.remove(); Ed.els.delete(gesture.item.id); }
      gesture = null;
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, v: Object.assign({}, Ed.state.view) };
      ev.preventDefault(); ev.stopPropagation();
      return;
    }
    const panning = D.tool === 'hand' || D.spacePan || ev.button === 1;
    if (!panning && !CREATE_TOOLS.includes(D.tool)) return; // selection tool: editor handles it
    ev.preventDefault(); ev.stopPropagation();
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    Ed.closePopover();
    const p = Ed.toWorld(ev.clientX, ev.clientY);
    if (panning) { gesture = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, vx: Ed.state.view.x, vy: Ed.state.view.y }; Ed.stage.classList.add('panning'); return; }
    if (D.tool === 'eraser') { gesture = { kind: 'erase', hit: new Set() }; eraseAt(ev.clientX, ev.clientY); return; }
    if (D.tool === 'text') { gesture = { kind: 'text', p }; return; }
    const it = newShape(D.tool, p.x, p.y);
    gesture = { kind: 'create', item: it, p0: p, alt: ev.altKey };
    Ed.renderItem(it);
  }
  function onMove(ev) {
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const r = Ed.stage.getBoundingClientRect();
      const nz = Math.min(2.5, Math.max(0.25, pinch.v.z * d / pinch.d));
      const px = pinch.cx - r.left, py = pinch.cy - r.top;
      Ed.state.view = { z: nz, x: px - ((px - pinch.v.x) * nz) / pinch.v.z + (cx - pinch.cx), y: py - ((py - pinch.v.y) * nz) / pinch.v.z + (cy - pinch.cy) };
      Ed.requestView();
      return;
    }
    if (!gesture) return;
    if (gesture.kind === 'pan') { Ed.state.view.x = gesture.vx + ev.clientX - gesture.sx; Ed.state.view.y = gesture.vy + ev.clientY - gesture.sy; Ed.requestView(); return; }
    if (gesture.kind === 'erase') { eraseAt(ev.clientX, ev.clientY); return; }
    if (gesture.kind !== 'create') return;
    const it = gesture.item; const p = Ed.toWorld(ev.clientX, ev.clientY); const p0 = gesture.p0;
    if (it.type === 'draw') {
      const last = it.points[it.points.length - 1];
      const lx = p.x - it.x, ly = p.y - it.y;
      if (Math.hypot(lx - last[0], ly - last[1]) * Ed.state.view.z < 1.5) return;
      it.points.push([Math.round(lx * 10) / 10, Math.round(ly * 10) / 10]);
      // live render without normalising (keep origin stable while drawing)
      const xs = it.points.map((q) => q[0]), ys = it.points.map((q) => q[1]);
      const mx = Math.min(0, ...xs), my = Math.min(0, ...ys);
      const tmp = Object.assign({}, it, { x: it.x + mx, y: it.y + my, points: it.points.map((q) => [q[0] - mx, q[1] - my]), w: Math.max(...xs) - mx, h: Math.max(...ys) - my });
      liveRender(it, tmp);
      return;
    }
    if (it.type === 'line' || it.type === 'arrow') {
      let dx = p.x - p0.x, dy = p.y - p0.y;
      if (ev.shiftKey) { const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12); const L = Math.hypot(dx, dy); dx = L * Math.cos(a); dy = L * Math.sin(a); }
      it.x = p0.x; it.y = p0.y; it.points = [[0, 0], [dx, dy]];
      const tmp = Object.assign({}, it, { points: it.points.map((q) => q.slice()) }); normalizePoints(tmp);
      liveRender(it, tmp);
      return;
    }
    let w = p.x - p0.x, h = p.y - p0.y;
    if (ev.shiftKey) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; }
    if (ev.altKey) { it.x = p0.x - Math.abs(w); it.y = p0.y - Math.abs(h); it.w = Math.abs(w) * 2; it.h = Math.abs(h) * 2; }
    else { it.x = Math.min(p0.x, p0.x + w); it.y = Math.min(p0.y, p0.y + h); it.w = Math.abs(w); it.h = Math.abs(h); }
    Ed.renderItem(it);
  }
  function liveRender(it, tmp) {
    const e = D.build(tmp); e.style.left = tmp.x + 'px'; e.style.top = tmp.y + 'px';
    const old = Ed.els.get(it.id); if (old) old.replaceWith(e); else Ed.world.append(e);
    Ed.els.set(it.id, e);
  }
  function onUp(ev) {
    pointers.delete(ev.pointerId);
    if (pinch) { if (pointers.size < 2) pinch = null; return; }
    if (!gesture) return;
    const g = gesture; gesture = null;
    Ed.stage.classList.remove('panning');
    if (g.kind === 'pan') { Ed.save(); return; }
    if (g.kind === 'erase') {
      if (g.hit.size) { Ed.remove([...g.hit]); Ed.commit(); }
      return;
    }
    if (g.kind === 'text') {
      const it = D.addText(g.p.x, g.p.y - D.style.fontSize * 0.7);
      D.editText(it);
      if (!D.locked) D.setTool('select');
      return;
    }
    const it = g.item;
    const z = Ed.state.view.z;
    if (it.type === 'line' || it.type === 'arrow' || it.type === 'draw') {
      if (it.points.length < 2) {
        if (it.type === 'draw') it.points.push([0.1, 0.1]); // a dot
        else { Ed.remove([it.id]); return; }
      }
      normalizePoints(it);
      if (it.type !== 'draw' && Math.hypot(it.w, it.h) * z < 4) { Ed.remove([it.id]); return; }
    } else if (it.w * z < 4 && it.h * z < 4) {
      // a click: make a default-sized shape centred on the click
      it.w = 120; it.h = it.type === 'ellipse' || it.type === 'diamond' ? 90 : 70; it.x = g.p0.x - it.w / 2; it.y = g.p0.y - it.h / 2;
    }
    Ed.renderItem(it);
    Ed.commit();
    if (it.type === 'draw' || D.locked) return;
    D.setTool('select');
    Ed.select(it.id);
  }
  function eraseAt(cx, cy) {
    const r = 8;
    for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      for (const node of document.elementsFromPoint(cx + dx, cy + dy)) {
        const e = node.closest && node.closest('[data-id]');
        if (!e || !Ed.world.contains(e)) continue;
        const it = Ed.get(e.dataset.id);
        if (!it || it.kind === 'matrix') continue;
        if (it.kind === 'shape' && !(node.classList && node.classList.contains('hit'))) continue;
        if (!gesture.hit.has(it.id)) { gesture.hit.add(it.id); e.classList.add('erasing'); }
      }
    }
  }

  /* ---------------- images ---------------- */
  function pickImage(at) {
    const inp = el('input', { type: 'file', accept: 'image/*' });
    inp.onchange = () => { if (inp.files[0]) D.insertImage(inp.files[0], at); };
    inp.click();
  }
  D.pickImage = pickImage;
  D.insertImage = function (blob, at) {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      // downscale so the scratchpad still fits in browser storage
      const max = 1400; const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const src = blob.type === 'image/png' && c.width * c.height < 600000 ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85);
      URL.revokeObjectURL(url);
      const vw = Ed.stage.getBoundingClientRect().width / Ed.state.view.z;
      const w = Math.min(c.width, vw * 0.5, 560), h = (w * c.height) / c.width;
      const pos = at || Ed.viewCenter();
      const it = { id: 'i' + Ed.state.seq++, kind: 'image', src, x: Math.round(pos.x - w / 2), y: Math.round(pos.y - h / 2), w: Math.round(w), h: Math.round(h), angle: 0, opacity: 100 };
      Ed.state.items.push(it); Ed.renderItem(it); Ed.commit();
      D.setTool('select'); Ed.select(it.id);
    };
    img.onerror = () => { URL.revokeObjectURL(url); Ed.toast('Could not read that image', true); };
    img.src = url;
  };

  /* ---------------- selection overlay & handles ---------------- */
  let overlay = null;
  D.updateOverlay = function () {
    if (!overlay || !overlay.isConnected) { overlay = el('div', { class: 'sel-overlay' }); Ed.world.append(overlay); }
    else if (overlay !== Ed.world.lastChild) Ed.world.append(overlay);
    overlay.innerHTML = '';
    const items = Ed.sel.map(Ed.get).filter(Boolean);
    if (!items.length || gesture) return;
    const z = Ed.state.view.z;
    overlay.style.setProperty('--hs', 10 / z + 'px');
    overlay.style.setProperty('--bw', 1.25 / z + 'px');
    const draw = items.filter(isDrawable);
    // per-item outlines for drawable things (cards show their own selected state)
    draw.forEach((it) => {
      const r = Ed.itemRect(it);
      const box = el('div', { class: 'sel-box' + (items.length > 1 ? ' multi' : '') });
      const pad = 6 / z;
      Object.assign(box.style, { left: r.x - pad + 'px', top: r.y - pad + 'px', width: r.w + 2 * pad + 'px', height: r.h + 2 * pad + 'px', transform: it.angle ? `rotate(${it.angle}rad)` : '' });
      overlay.append(box);
      if (items.length !== 1) return;
      if (it.kind === 'shape' && (it.type === 'line' || it.type === 'arrow')) {
        box.classList.add('thin');
        it.points.forEach((pt, i) => overlay.append(handle('pt', i, it.x + pt[0], it.y + pt[1])));
        if (it.points.length === 2) overlay.append(handle('mid', 0, it.x + (it.points[0][0] + it.points[1][0]) / 2, it.y + (it.points[0][1] + it.points[1][1]) / 2));
        return;
      }
      const dirs = it.kind === 'text' ? [[-1, -1], [1, -1], [1, 1], [-1, 1]] : [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
      dirs.forEach(([dx, dy]) => {
        const [ox, oy] = rot(dx * (r.w / 2 + pad), dy * (r.h / 2 + pad), it.angle || 0);
        overlay.append(handle('rs', [dx, dy], r.x + r.w / 2 + ox, r.y + r.h / 2 + oy));
      });
      const [rx, ry] = rot(0, -(r.h / 2 + pad + 22 / z), it.angle || 0);
      overlay.append(handle('rot', 0, r.x + r.w / 2 + rx, r.y + r.h / 2 + ry));
    });
    if (items.length > 1) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      items.forEach((it) => { const b = D.bounds(it); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); });
      const pad = 10 / z;
      const box = el('div', { class: 'sel-box group' });
      Object.assign(box.style, { left: x0 - pad + 'px', top: y0 - pad + 'px', width: x1 - x0 + 2 * pad + 'px', height: y1 - y0 + 2 * pad + 'px' });
      overlay.prepend(box);
    }
  };
  function handle(kind, data, x, y) {
    const h = el('div', { class: 'sel-h ' + kind + (kind === 'rs' ? ' d' + data.join('') : '') });
    h.style.left = x + 'px'; h.style.top = y + 'px';
    h.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); startHandle(ev, kind, data); });
    return h;
  }
  function startHandle(ev, kind, data) {
    const it = Ed.get(Ed.sel[0]); if (!it) return;
    const o = JSON.parse(JSON.stringify(it));
    const r0 = Ed.itemRect(it);
    const c0 = [r0.x + r0.w / 2, r0.y + r0.h / 2];
    const id = ev.pointerId;
    const mv = (e) => {
      if (e.pointerId !== id) return;
      const p = Ed.toWorld(e.clientX, e.clientY);
      if (kind === 'rot') {
        let a = Math.atan2(p.y - c0[1], p.x - c0[0]) + Math.PI / 2;
        if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
        it.angle = Math.abs(a) < 0.01 ? 0 : a;
      } else if (kind === 'pt' || kind === 'mid') {
        let pts = o.points.map((q) => [q[0] + o.x, q[1] + o.y]);
        if (kind === 'mid') { pts = [pts[0], [p.x, p.y], pts[1]]; }
        else pts[data] = [p.x, p.y];
        if (e.shiftKey && kind === 'pt' && pts.length === 2) { const a0 = pts[1 - data]; const dx = p.x - a0[0], dy = p.y - a0[1]; const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12); const L = Math.hypot(dx, dy); pts[data] = [a0[0] + L * Math.cos(a), a0[1] + L * Math.sin(a)]; }
        it.x = 0; it.y = 0; it.points = pts; normalizePoints(it);
      } else {
        const [dx, dy] = data; const ang = o.angle || 0;
        const [lx, ly] = rot(p.x - c0[0], p.y - c0[1], -ang);
        let L = -o.w / 2, R = o.w / 2, T = -o.h / 2, B = o.h / 2;
        if (it.kind === 'text') { const ow = r0.w, oh = r0.h; L = -ow / 2; R = ow / 2; T = -oh / 2; B = oh / 2; }
        const keep = it.kind === 'text' || (it.kind === 'image' ? !e.shiftKey : e.shiftKey);
        if (dx > 0) R = lx; else if (dx < 0) L = lx;
        if (dy > 0) B = ly; else if (dy < 0) T = ly;
        let w = Math.max(4, R - L), h = Math.max(4, B - T);
        const w0 = R - L === w ? (it.kind === 'text' ? r0.w : o.w) : (it.kind === 'text' ? r0.w : o.w);
        const baseW = it.kind === 'text' ? r0.w : o.w, baseH = it.kind === 'text' ? r0.h : o.h;
        void w0;
        if (keep && dx && dy) { const s = Math.max(w / baseW, h / baseH); w = baseW * s; h = baseH * s; if (dx < 0) L = R - w; else R = L + w; if (dy < 0) T = B - h; else B = T + h; }
        else if (keep && dx) { const s = w / baseW; h = baseH * s; T = (T + B) / 2 - h / 2; B = T + h; }
        else if (keep && dy) { const s = h / baseH; w = baseW * s; L = (L + R) / 2 - w / 2; R = L + w; }
        const [cx, cy] = rot((L + R) / 2, (T + B) / 2, ang);
        const ncx = c0[0] + cx, ncy = c0[1] + cy;
        if (it.kind === 'text') { it.fontSize = Math.max(6, Math.round(o.fontSize * (h / baseH) * 10) / 10); it.x = ncx - w / 2; it.y = ncy - h / 2; }
        else {
          it.w = w; it.h = h; it.x = ncx - w / 2; it.y = ncy - h / 2;
          if (it.points) { const sx = o.w ? w / o.w : 1, sy = o.h ? h / o.h : 1; it.points = o.points.map((q) => [q[0] * sx, q[1] * sy]); }
        }
      }
      Ed.renderItem(it);
      D.updateOverlay();
    };
    const up = (e) => { if (e.pointerId !== id) return; window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); Ed.commit(); D.updateOverlay(); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }

  /* ---------------- style panel ---------------- */
  const STROKES = ['#1e1e1e', '#e03131', '#2f9e44', '#1971c2', '#f08c00'];
  const BGS = ['transparent', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#ffec99'];
  let propsForced = false;
  D.toggleProps = () => { propsForced = !propsForced; D.renderProps(); syncToolbar(); };
  function targets() { return Ed.sel.map(Ed.get).filter(isDrawable); }
  function current(key) {
    const t = targets();
    const v = (it) => (key === 'stroke' && it.kind === 'text' ? it.color : key === 'opacity' && it.kind !== 'shape' ? it.opacity : ['fontSize', 'font', 'align'].includes(key) && it.kind === 'text' ? it[key] : it.style ? it.style[key] : undefined);
    for (const it of t) { const x = v(it); if (x !== undefined) return x; }
    return D.style[key];
  }
  function setProp(key, val) {
    D.style[key] = val;
    const t = targets();
    t.forEach((it) => {
      if (it.kind === 'text') {
        if (key === 'stroke') it.color = val; else if (key === 'opacity') it.opacity = val; else if (['fontSize', 'font', 'align'].includes(key)) it[key] = val;
      } else if (it.kind === 'image') { if (key === 'opacity') it.opacity = val; }
      else if (it.style) {
        if ((key === 'startArrow' || key === 'endArrow') && it.type !== 'arrow' && it.type !== 'line') return;
        it.style[key] = val;
      }
      Ed.renderItem(it);
    });
    if (t.length) Ed.commit();
    D.renderProps(); D.updateOverlay();
  }
  D.setProp = setProp;
  function reorder(mode) {
    const ids = new Set(Ed.sel);
    const items = Ed.state.items;
    if (mode === 'front') Ed.state.items = items.filter((i) => !ids.has(i.id)).concat(items.filter((i) => ids.has(i.id)));
    else if (mode === 'back') Ed.state.items = items.filter((i) => ids.has(i.id)).concat(items.filter((i) => !ids.has(i.id)));
    else {
      const arr = items.slice();
      if (mode === 'forward') { for (let i = arr.length - 2; i >= 0; i--) if (ids.has(arr[i].id) && !ids.has(arr[i + 1].id)) [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]]; }
      else { for (let i = 1; i < arr.length; i++) if (ids.has(arr[i].id) && !ids.has(arr[i - 1].id)) [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]]; }
      Ed.state.items = arr;
    }
    Ed.state.items.forEach((it) => { const e = Ed.els.get(it.id); if (e) Ed.world.append(e); });
    D.updateOverlay(); Ed.commit();
  }
  D.reorder = reorder;
  function align(mode) {
    const items = Ed.sel.map(Ed.get).filter(Boolean); if (items.length < 2) return;
    const bs = items.map((it) => ({ it, b: D.bounds(it) }));
    const x0 = Math.min(...bs.map((q) => q.b.x)), x1 = Math.max(...bs.map((q) => q.b.x + q.b.w));
    const y0 = Math.min(...bs.map((q) => q.b.y)), y1 = Math.max(...bs.map((q) => q.b.y + q.b.h));
    if (mode === 'dh' || mode === 'dv') {
      const hz = mode === 'dh';
      bs.sort((a, b) => (hz ? a.b.x - b.b.x : a.b.y - b.b.y));
      const total = bs.reduce((s, q) => s + (hz ? q.b.w : q.b.h), 0);
      const gap = ((hz ? x1 - x0 : y1 - y0) - total) / (bs.length - 1);
      let cur = hz ? x0 : y0;
      bs.forEach((q) => { const d = cur - (hz ? q.b.x : q.b.y); if (hz) q.it.x += d; else q.it.y += d; cur += (hz ? q.b.w : q.b.h) + gap; });
    } else bs.forEach(({ it, b }) => {
      if (mode === 'l') it.x += x0 - b.x; if (mode === 'r') it.x += x1 - (b.x + b.w); if (mode === 'ch') it.x += (x0 + x1) / 2 - (b.x + b.w / 2);
      if (mode === 't') it.y += y0 - b.y; if (mode === 'b') it.y += y1 - (b.y + b.h); if (mode === 'cv') it.y += (y0 + y1) / 2 - (b.y + b.h / 2);
    });
    items.forEach((it) => { it.x = Math.round(it.x); it.y = Math.round(it.y); const e = Ed.els.get(it.id); if (e) { e.style.left = it.x + 'px'; e.style.top = it.y + 'px'; } });
    D.updateOverlay(); Ed.commit();
  }
  D.align = align;
  D.renderProps = function () {
    const panel = document.getElementById('props');
    const t = targets();
    const all = Ed.sel.map(Ed.get).filter(Boolean);
    const drawingTool = CREATE_TOOLS.includes(D.tool) && D.tool !== 'eraser';
    const small = window.innerWidth <= 760;
    // matrix-only selections keep using the bottom bar; the panel is for drawings
    const show = small ? propsForced : propsForced || drawingTool || t.length > 0;
    panel.hidden = !show;
    if (!show) return;
    panel.innerHTML = '';
    const types = new Set(t.map((i) => (i.kind === 'shape' ? i.type : i.kind)));
    if (drawingTool && !t.length) types.add(D.tool);
    const hasShape = [...types].some((x) => ['rect', 'diamond', 'ellipse', 'line', 'arrow', 'draw'].includes(x));
    const closed = [...types].some((x) => ['rect', 'diamond', 'ellipse'].includes(x));
    const lineish = [...types].some((x) => ['line', 'arrow'].includes(x));
    const hasText = types.has('text');
    const section = (label, ...kids) => panel.append(el('div', { class: 'pp-sec' }, el('div', { class: 'pp-lbl' }, label), el('div', { class: 'pp-row' }, ...kids)));
    const opt = (key, val, content, title) => el('button', { class: 'pp-btn' + (current(key) === val ? ' on' : ''), title, onclick: () => setProp(key, val) }, content);
    const swatch = (key, c) => el('button', { class: 'pp-sw' + (current(key) === c ? ' on' : '') + (c === 'transparent' ? ' none' : ''), title: c, style: { background: c === 'transparent' ? '' : c }, onclick: () => setProp(key, c) });
    const colorPick = (key) => { const i = el('input', { type: 'color', class: 'pp-color', value: /^#[0-9a-f]{6}$/i.test(current(key)) ? current(key) : '#000000', title: 'Custom colour' }); i.addEventListener('input', () => setProp(key, i.value)); return i; };
    if (hasShape || hasText || types.size === 0 || propsForced) section(hasText && !hasShape ? 'Text colour' : 'Stroke', ...STROKES.map((c) => swatch('stroke', c)), colorPick('stroke'));
    if (closed) {
      section('Background', ...BGS.map((c) => swatch('bg', c)), colorPick('bg'));
      if (current('bg') !== 'transparent') section('Fill', opt('fill', 'hachure', '▨', 'Hachure'), opt('fill', 'cross-hatch', '▦', 'Cross-hatch'), opt('fill', 'solid', '■', 'Solid'));
    }
    if (hasShape) {
      section('Stroke width', opt('sw', 1, el('span', { class: 'pp-ln', style: { height: '1px' } }), 'Thin'), opt('sw', 2, el('span', { class: 'pp-ln', style: { height: '2px' } }), 'Bold'), opt('sw', 4, el('span', { class: 'pp-ln', style: { height: '4px' } }), 'Extra bold'));
      section('Stroke style', opt('ss', 'solid', '—', 'Solid'), opt('ss', 'dashed', '- -', 'Dashed'), opt('ss', 'dotted', '···', 'Dotted'));
      if (!(types.size === 1 && types.has('draw'))) section('Sloppiness', opt('rough', 0, '⌒', 'Architect'), opt('rough', 1, '〰', 'Artist'), opt('rough', 2, '∿∿', 'Cartoonist'));
    }
    if (types.has('rect') || types.has('diamond')) section('Edges', opt('round', false, '⌐', 'Sharp'), opt('round', true, '◜', 'Round'));
    if (lineish) {
      const heads = [['none', '—'], ['arrow', '→'], ['triangle', '▶'], ['bar', '⊣'], ['dot', '●']];
      section('Arrowheads', el('span', { class: 'pp-small' }, 'start'), ...heads.map(([v, s]) => opt('startArrow', v, s === '→' ? '←' : s === '▶' ? '◀' : s === '⊣' ? '⊢' : s, v)));
      section('', el('span', { class: 'pp-small' }, 'end'), ...heads.map(([v, s]) => opt('endArrow', v, s, v)));
    }
    if (hasText) {
      section('Font size', opt('fontSize', 16, 'S'), opt('fontSize', 24, 'M'), opt('fontSize', 36, 'L'), opt('fontSize', 56, 'XL'));
      section('Font', opt('font', 'hand', el('span', { style: { fontFamily: FONTS.hand, fontSize: '18px' } }, 'Aa'), 'Hand-drawn'), opt('font', 'normal', el('span', { style: { fontFamily: FONTS.normal } }, 'Aa'), 'Normal'), opt('font', 'code', el('span', { style: { fontFamily: FONTS.code } }, '</>'), 'Code'));
      section('Align', opt('align', 'left', '⇤', 'Left'), opt('align', 'center', '↔', 'Center'), opt('align', 'right', '⇥', 'Right'));
    }
    if (t.length || drawingTool) {
      const rng = el('input', { type: 'range', min: 10, max: 100, step: 10, value: current('opacity') ?? 100, class: 'pp-range' });
      rng.addEventListener('input', () => { D.style.opacity = +rng.value; targets().forEach((it) => { if (it.kind === 'shape') it.style.opacity = +rng.value; else it.opacity = +rng.value; Ed.renderItem(it); }); });
      rng.addEventListener('change', () => Ed.commit());
      section('Opacity', rng);
    }
    if (all.length) {
      section('Layers', el('button', { class: 'pp-btn', title: 'Send to back (Ctrl+Shift+[)', onclick: () => reorder('back') }, '⤓'), el('button', { class: 'pp-btn', title: 'Send backward (Ctrl+[)', onclick: () => reorder('backward') }, '↓'), el('button', { class: 'pp-btn', title: 'Bring forward (Ctrl+])', onclick: () => reorder('forward') }, '↑'), el('button', { class: 'pp-btn', title: 'Bring to front (Ctrl+Shift+])', onclick: () => reorder('front') }, '⤒'));
    }
    if (all.length > 1) {
      const a = (m, s, title) => el('button', { class: 'pp-btn', title, onclick: () => align(m) }, s);
      section('Align', a('l', '⫷', 'Align left'), a('ch', '⏸', 'Center horizontally'), a('r', '⫸', 'Align right'), a('t', '⊤', 'Align top'), a('cv', '⊝', 'Center vertically'), a('b', '⊥', 'Align bottom'));
      if (all.length > 2) section('Distribute', a('dh', '⇹', 'Distribute horizontally'), a('dv', '⇳', 'Distribute vertically'));
    }
    if (all.length) {
      const grouped = all.length > 1 && all.every((i) => i.group && i.group === all[0].group);
      section('Actions',
        el('button', { class: 'pp-btn', title: 'Duplicate (Ctrl+D)', onclick: () => MX.App.duplicate(Ed.sel) }, '⧉'),
        all.length > 1 ? el('button', { class: 'pp-btn', title: grouped ? 'Ungroup (Ctrl+Shift+G)' : 'Group (Ctrl+G)', onclick: () => (grouped ? D.ungroup() : D.group()) }, grouped ? '⊟' : '⊞') : null,
        el('button', { class: 'pp-btn danger', title: 'Delete (Del)', onclick: () => { Ed.remove(Ed.sel.slice()); Ed.commit(); } }, '🗑'));
    }
  };

  /* ---------------- grouping ---------------- */
  D.group = function () { if (Ed.sel.length < 2) return; const g = 'g' + Ed.state.seq++; Ed.sel.forEach((id) => { const it = Ed.get(id); if (it) it.group = g; }); Ed.commit(); D.renderProps(); Ed.toast('Grouped ' + Ed.sel.length + ' items'); };
  D.ungroup = function () { Ed.sel.forEach((id) => { const it = Ed.get(id); if (it) delete it.group; }); Ed.commit(); D.renderProps(); Ed.toast('Ungrouped'); };

  /* ---------------- keyboard ---------------- */
  const KEYMAP = { v: 'select', 1: 'select', h: 'hand', r: 'rect', 2: 'rect', d: 'diamond', 3: 'diamond', o: 'ellipse', 4: 'ellipse', a: 'arrow', 5: 'arrow', l: 'line', 6: 'line', p: 'draw', x: 'draw', 7: 'draw', t: 'text', 8: 'text', 9: 'image', e: 'eraser', 0: 'eraser' };
  D.handleKey = function (ev) {
    const k = ev.key.toLowerCase();
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && k === 'g') { ev.preventDefault(); ev.shiftKey ? D.ungroup() : D.group(); return true; }
    if (mod && (ev.key === ']' || ev.key === '}' || ev.code === 'BracketRight')) { ev.preventDefault(); reorder(ev.shiftKey ? 'front' : 'forward'); return true; }
    if (mod && (ev.key === '[' || ev.key === '{' || ev.code === 'BracketLeft')) { ev.preventDefault(); reorder(ev.shiftKey ? 'back' : 'backward'); return true; }
    if (mod || ev.altKey) return false;
    if (ev.key === ' ' && !D.spacePan) { D.spacePan = true; syncToolbar(); ev.preventDefault(); return true; }
    if (k === 'q') { D.locked = !D.locked; buildToolbar(); return true; }
    if (KEYMAP[k] !== undefined && !(ev.shiftKey && k === 'e')) { D.setTool(KEYMAP[k]); return true; }
    if (ev.key.startsWith('Arrow') && Ed.sel.length) {
      ev.preventDefault();
      const s = ev.shiftKey ? 10 : 1;
      const dx = ev.key === 'ArrowLeft' ? -s : ev.key === 'ArrowRight' ? s : 0, dy = ev.key === 'ArrowUp' ? -s : ev.key === 'ArrowDown' ? s : 0;
      Ed.sel.forEach((id) => { const it = Ed.get(id); if (!it) return; it.x += dx; it.y += dy; const e = Ed.els.get(id); if (e) { e.style.left = it.x + 'px'; e.style.top = it.y + 'px'; } });
      D.updateOverlay(); Ed.commitSoon();
      return true;
    }
    if (ev.key === 'Enter' && Ed.sel.length === 1) { const it = Ed.get(Ed.sel[0]); if (it && it.kind === 'text') { ev.preventDefault(); D.editText(it); return true; } }
    return false;
  };

  D.init = function () {
    buildToolbar();
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('keyup', (ev) => { if (ev.key === ' ' && D.spacePan) { D.spacePan = false; syncToolbar(); } });
    window.addEventListener('blur', () => { if (D.spacePan) { D.spacePan = false; syncToolbar(); } });
    Ed.on('selection', () => { D.updateOverlay(); D.renderProps(); });
    Ed.on('moved', D.updateOverlay);
    Ed.on('view', D.updateOverlay);
    Ed.on('change', () => { D.updateOverlay(); });
    D.renderProps();
  };
})(window);
