/* The free-form workspace: matrices and notes on a pannable, zoomable sheet of paper. */
(function (G) {
  'use strict';
  const MX = G.MX;
  const { Frac, M, el } = MX;

  const Ed = (MX.Ed = {
    state: { items: [], view: { x: 0, y: 0, z: 1 }, seq: 1 },
    sel: [],
    els: new Map(),
    undoStack: [], redoStack: [],
    lineSel: null,
    clip: null,
    lastPointerWorld: null,
    listeners: {},
  });
  const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
  const isCoarse = () => matchMedia('(pointer: coarse)').matches;

  Ed.on = (ev, fn) => { (Ed.listeners[ev] = Ed.listeners[ev] || []).push(fn); };
  Ed.emit = (ev, ...a) => (Ed.listeners[ev] || []).forEach((fn) => fn(...a));

  /* ---------- state & persistence ---------- */
  const STORE = 'matrix-scratchpad-v1';
  Ed.snapshot = () => JSON.stringify({ items: Ed.state.items, seq: Ed.state.seq });
  let lastSnap = null, saveTimer = null, typingTimer = null;
  Ed.commit = function () {
    clearTimeout(typingTimer); typingTimer = null;
    const s = Ed.snapshot();
    if (s === lastSnap) return;
    if (lastSnap) { Ed.undoStack.push(lastSnap); if (Ed.undoStack.length > 100) Ed.undoStack.shift(); }
    Ed.redoStack = [];
    lastSnap = s;
    Ed.save();
    Ed.emit('change');
  };
  Ed.commitSoon = function () { clearTimeout(typingTimer); typingTimer = setTimeout(Ed.commit, 700); };
  Ed.save = function () {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE, JSON.stringify(Ed.state)); } catch (e) { /* storage unavailable */ }
    }, 200);
  };
  Ed.load = function (data) {
    Ed.state.items = (data && data.items) || [];
    Ed.state.seq = (data && data.seq) || 1;
    if (data && data.view) Ed.state.view = data.view;
    Ed.state.items.forEach(normalizeItem);
    lastSnap = Ed.snapshot();
    Ed.sel = [];
    Ed.renderAll();
    Ed.applyView();
  };
  Ed.restore = function () {
    try { const raw = localStorage.getItem(STORE); if (raw) { Ed.load(JSON.parse(raw)); return true; } } catch (e) { /* ignore */ }
    return false;
  };
  function applySnap(s) {
    const d = JSON.parse(s);
    Ed.state.items = d.items; Ed.state.seq = d.seq;
    lastSnap = s;
    Ed.sel = Ed.sel.filter((id) => Ed.get(id));
    Ed.lineSel = null; Ed.closePopover();
    Ed.renderAll(); Ed.save(); Ed.emit('change'); Ed.emit('selection');
  }
  Ed.undo = function () { if (typingTimer) Ed.commit(); if (!Ed.undoStack.length) return; Ed.redoStack.push(lastSnap); applySnap(Ed.undoStack.pop()); };
  Ed.redo = function () { if (!Ed.redoStack.length) return; Ed.undoStack.push(lastSnap); applySnap(Ed.redoStack.pop()); };

  function normalizeItem(it) {
    if (it.kind === 'matrix') {
      it.tmpRows = it.tmpRows || []; it.tmpCols = it.tmpCols || []; it.log = it.log || [];
      if (it.showLog == null) it.showLog = true;
    }
    return it;
  }
  Ed.get = (id) => Ed.state.items.find((i) => i.id === id);
  Ed.byName = (name) => Ed.state.items.find((i) => i.name === name && (i.kind === 'matrix' || i.value != null));
  Ed.matrices = () => Ed.state.items.filter((i) => i.kind === 'matrix');
  Ed.nextName = function (pref) {
    const used = new Set(Ed.state.items.map((i) => i.name).filter(Boolean));
    if (pref && NAME_RE.test(pref) && !used.has(pref)) return pref;
    const L = 'ABCDEFGHJKLMNPQRSUVWXYZ';
    for (let k = 0; ; k++) for (const c of L) { const nm = k ? c + k : c; if (!used.has(nm)) return nm; }
  };
  Ed.matrixOf = function (item) {
    if (item.kind !== 'matrix') throw new Error(`${item.name || 'This item'} is not a matrix`);
    try { return M.fromStrings(item.cells); } catch (e) { throw new Error(`${item.name}: ${e.message}`); }
  };
  Ed.resolve = function (name) {
    const it = Ed.byName(name);
    if (!it) return undefined;
    if (it.kind === 'matrix') return Ed.matrixOf(it);
    return Frac.parse(it.value);
  };
  Ed.dims = (it) => [it.cells.length, it.cells[0] ? it.cells[0].length : 0];

  Ed.addMatrix = function (o = {}) {
    const cells = o.cells || Array.from({ length: o.rows || 2 }, () => Array.from({ length: o.cols || 2 }, () => ''));
    const it = normalizeItem({ id: 'i' + Ed.state.seq++, kind: 'matrix', name: Ed.nextName(o.name), x: o.x ?? 0, y: o.y ?? 0, cells, caption: o.caption || '' });
    Ed.state.items.push(it);
    Ed.renderItem(it);
    return it;
  };
  Ed.addNote = function (o = {}) {
    const it = { id: 'i' + Ed.state.seq++, kind: 'note', x: o.x ?? 0, y: o.y ?? 0, text: o.text || '', result: !!o.result };
    if (o.name) { it.name = Ed.nextName(o.name); it.value = o.value; }
    Ed.state.items.push(it);
    Ed.renderItem(it);
    return it;
  };
  Ed.remove = function (ids) {
    Ed.state.items = Ed.state.items.filter((i) => !ids.includes(i.id));
    ids.forEach((id) => { const e = Ed.els.get(id); if (e) e.remove(); Ed.els.delete(id); });
    Ed.sel = Ed.sel.filter((id) => !ids.includes(id));
    if (Ed.lineSel && ids.includes(Ed.lineSel.id)) { Ed.lineSel = null; Ed.closePopover(); }
    Ed.emit('selection');
  };

  /* ---------- structure edits (keep temp lines in sync) ---------- */
  const blankRow = (n) => Array.from({ length: n }, () => '');
  Ed.insertRow = (it, at, vals) => { const n = Ed.dims(it)[1]; it.cells.splice(at, 0, vals || blankRow(n)); it.tmpCols.forEach((t) => t.cells.splice(at, 0, '')); };
  Ed.removeRow = (it, i) => { if (it.cells.length <= 1) return false; it.cells.splice(i, 1); it.tmpCols.forEach((t) => t.cells.splice(i, 1)); return true; };
  Ed.swapRows = (it, a, b) => { [it.cells[a], it.cells[b]] = [it.cells[b], it.cells[a]]; it.tmpCols.forEach((t) => { [t.cells[a], t.cells[b]] = [t.cells[b], t.cells[a]]; }); };
  Ed.insertCol = (it, at, vals) => { it.cells.forEach((r, i) => r.splice(at, 0, vals ? vals[i] : '')); it.tmpRows.forEach((t) => t.cells.splice(at, 0, '')); };
  Ed.removeCol = (it, j) => { if (Ed.dims(it)[1] <= 1) return false; it.cells.forEach((r) => r.splice(j, 1)); it.tmpRows.forEach((t) => t.cells.splice(j, 1)); return true; };
  Ed.swapCols = (it, a, b) => { it.cells.forEach((r) => { [r[a], r[b]] = [r[b], r[a]]; }); it.tmpRows.forEach((t) => { [t.cells[a], t.cells[b]] = [t.cells[b], t.cells[a]]; }); };
  Ed.resize = (it, m, n) => {
    while (it.cells.length < m) Ed.insertRow(it, it.cells.length);
    while (it.cells.length > m) Ed.removeRow(it, it.cells.length - 1);
    while (Ed.dims(it)[1] < n) Ed.insertCol(it, Ed.dims(it)[1]);
    while (Ed.dims(it)[1] > n) Ed.removeCol(it, Ed.dims(it)[1] - 1);
  };
  Ed.setCells = (it, cells) => {
    it.cells = cells.map((r) => r.slice());
    const [m, n] = Ed.dims(it);
    it.tmpRows.forEach((t) => { t.cells = t.cells.slice(0, n); while (t.cells.length < n) t.cells.push(''); });
    it.tmpCols.forEach((t) => { t.cells = t.cells.slice(0, m); while (t.cells.length < m) t.cells.push(''); });
  };

  /* ---------- line expressions (row / column operations) ---------- */
  const cellStr = (x) => (x instanceof Frac ? x.toString() : typeof x === 'number' ? MX.fmtNumber(x, 10) : String(x));
  function lineVecs(it, type) {
    // returns resolver for R#/T# (rows) or C#/T# (cols), each a 1×L matrix
    const A = Ed.matrixOf(it);
    return (name) => {
      let m = /^([RC])(\d+)$/.exec(name);
      if (m && ((m[1] === 'R') === (type === 'row'))) {
        const k = +m[2] - 1;
        const vec = type === 'row' ? A[k] : A.map((r) => r[k]);
        if (!vec) throw new Error(`${name} does not exist`);
        return [vec.slice()];
      }
      m = /^T(\d+)$/.exec(name);
      if (m) {
        const t = (type === 'row' ? it.tmpRows : it.tmpCols)[+m[1] - 1];
        if (!t) throw new Error(`${name} does not exist`);
        return [t.cells.map((s) => Frac.parse(s))];
      }
      return Ed.resolve(name);
    };
  }
  /** Evaluate an expression to a vector of length L for a row/col of `it`. */
  Ed.evalLine = function (it, type, expr) {
    const L = type === 'row' ? Ed.dims(it)[1] : Ed.dims(it)[0];
    const v = MX.evaluate(expr, lineVecs(it, type));
    if (v instanceof Frac) return Array.from({ length: L }, () => v);
    if (Array.isArray(v)) {
      if (v.length === 1 && v[0].length === L) return v[0];
      if (v[0] && v[0].length === 1 && v.length === L) return v.map((r) => r[0]);
      throw new Error(`Result has size ${M.dimStr(v)}, expected ${L} entries`);
    }
    throw new Error('Expression does not give a vector');
  };
  Ed.recomputeTemps = function (it) {
    for (const [type, list] of [['row', it.tmpRows], ['col', it.tmpCols]]) {
      list.forEach((t) => {
        if (!t.expr) { t.err = ''; return; }
        try { t.cells = Ed.evalLine(it, type, t.expr).map(cellStr); t.err = ''; } catch (e) { t.err = e.message; }
      });
    }
  };
  const pretty = (s) => s.replace(/\s+/g, ' ').trim().replace(/\*/g, '·').replace(/-/g, '−').replace(/(\d)\s*([RCT]\d)/g, '$1$2');

  /**
   * Apply a row/column command such as "R2 - 3R1", "*2", "/3", "swap R1", "= 1 2 3".
   * Returns the log line.
   */
  Ed.applyLineCommand = function (it, type, idx, cmd) {
    const P = type === 'row' ? 'R' : 'C';
    const me = P + (idx + 1);
    cmd = cmd.trim().replace(/[−–]/g, '-');
    if (!cmd) throw new Error('Type an operation');
    const write = (vals) => {
      if (type === 'row') it.cells[idx] = vals.map(cellStr);
      else vals.forEach((v, i) => { it.cells[i][idx] = cellStr(v); });
    };
    let m;
    if ((m = /^(?:swap|<->|↔|<>)\s*[RC]?\s*(\d+)$/i.exec(cmd))) {
      const k = +m[1] - 1;
      const L = type === 'row' ? Ed.dims(it)[0] : Ed.dims(it)[1];
      if (k < 0 || k >= L) throw new Error(`${P}${k + 1} does not exist`);
      if (k === idx) throw new Error('Pick a different line to swap with');
      type === 'row' ? Ed.swapRows(it, idx, k) : Ed.swapCols(it, idx, k);
      return `${me} ↔ ${P}${k + 1}`;
    }
    let expr, logRhs;
    if ((m = /^=\s*(.*)$/s.exec(cmd))) {
      const t = M.parseText(m[1]);
      const L = type === 'row' ? Ed.dims(it)[1] : Ed.dims(it)[0];
      if (t && ((t.length === 1 && t[0].length === L) || (t.length === L && t[0].length === 1)) && !/[A-Za-z(]/.test(m[1])) {
        write(t.flat().map((s) => Frac.parse(s)));
        return `${me} = (${t.flat().join(', ')})`;
      }
      expr = m[1]; logRhs = pretty(m[1]);
    } else if ((m = /^([*×·]|\/|÷)\s*(.+)$/.exec(cmd))) {
      const k = MX.evalScalar(m[2]);
      const isDiv = m[1] === '/' || m[1] === '÷';
      if (k.isZero()) throw new Error(isDiv ? 'Cannot divide by 0' : 'Scaling a row by 0 is not an elementary row operation');
      expr = `${me}${isDiv ? '/' : '*'}(${m[2]})`;
      logRhs = isDiv ? `${me} ÷ ${k}` : `${/[/-]/.test(k.toString()) ? '(' + k + ')' : k}·${me}`;
    } else if (/^[+-]/.test(cmd)) {
      expr = `${me} ${cmd}`; logRhs = pretty(`${me} ${cmd}`);
    } else {
      const t = /^[\d\s.,/-]+$/.test(cmd) ? M.parseText(cmd) : null;
      if (t && t.flat().length > 1) return Ed.applyLineCommand(it, type, idx, '= ' + cmd);
      expr = cmd; logRhs = pretty(cmd);
    }
    write(Ed.evalLine(it, type, expr));
    return `${me} ← ${logRhs}`;
  };
  Ed.log = (it, line) => { it.log.push(line); if (it.log.length > 40) it.log.shift(); };

  /* ---------- view ---------- */
  Ed.init = function (stage, world) {
    Ed.stage = stage; Ed.world = world;
    setupStage();
  };
  let viewRaf = 0;
  /** Coalesce view changes (pan / zoom / pinch) into one update per frame. */
  Ed.requestView = function () { if (!viewRaf) viewRaf = requestAnimationFrame(() => { viewRaf = 0; Ed.applyView(); }); };
  Ed.applyView = function () {
    const { x, y, z } = Ed.state.view;
    Ed.world.style.transform = `translate(${x}px, ${y}px) scale(${z})`;
    const g = 24 * z;
    Ed.stage.style.backgroundSize = `${g * 5}px ${g * 5}px, ${g * 5}px ${g * 5}px, ${g}px ${g}px, ${g}px ${g}px`;
    Ed.stage.style.backgroundPosition = `${x}px ${y}px`;
    Ed.emit('view');
    Ed.save();
  };
  Ed.toWorld = (cx, cy) => { const r = Ed.stage.getBoundingClientRect(); const { x, y, z } = Ed.state.view; return { x: (cx - r.left - x) / z, y: (cy - r.top - y) / z }; };
  Ed.zoomAt = function (cx, cy, factor) {
    const v = Ed.state.view; const r = Ed.stage.getBoundingClientRect();
    const nz = Math.min(2.5, Math.max(0.25, v.z * factor));
    const px = cx - r.left, py = cy - r.top;
    v.x = px - ((px - v.x) * nz) / v.z; v.y = py - ((py - v.y) * nz) / v.z; v.z = nz;
    Ed.requestView();
  };
  Ed.viewCenter = function () { const r = Ed.stage.getBoundingClientRect(); return Ed.toWorld(r.left + r.width / 2, r.top + r.height / 2.6); };
  Ed.itemRect = (it) => { const e = Ed.els.get(it.id); return { x: it.x, y: it.y, w: e ? e.offsetWidth : 120, h: e ? e.offsetHeight : 80 }; };
  Ed.fit = function () {
    if (!Ed.state.items.length) { Ed.state.view = { x: 40, y: 40, z: 1 }; Ed.applyView(); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    Ed.state.items.forEach((it) => { const r = Ed.itemRect(it); x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); });
    const sr = Ed.stage.getBoundingClientRect();
    const pad = 40;
    const z = Math.min(1.4, Math.max(0.25, Math.min((sr.width - 2 * pad) / (x1 - x0), (sr.height - 2 * pad - 60) / (y1 - y0))));
    Ed.state.view = { z, x: (sr.width - (x1 - x0) * z) / 2 - x0 * z, y: pad + ((sr.height - 60 - 2 * pad) - (y1 - y0) * z) / 2 - y0 * z };
    Ed.applyView();
  };
  Ed.scrollIntoView = function (it) {
    const r = Ed.itemRect(it); const v = Ed.state.view; const sr = Ed.stage.getBoundingClientRect();
    const sx = r.x * v.z + v.x, sy = r.y * v.z + v.y, sw = r.w * v.z, sh = r.h * v.z;
    let dx = 0, dy = 0;
    if (sx < 10) dx = 10 - sx; else if (sx + sw > sr.width - 10) dx = Math.max(sr.width - 10 - sx - sw, 10 - sx);
    if (sy < 10) dy = 10 - sy; else if (sy + sh > sr.height - 80) dy = Math.max(sr.height - 80 - sy - sh, 10 - sy);
    if (dx || dy) { v.x += dx; v.y += dy; Ed.applyView(); }
  };
  /** Find a free spot near `it` (to the right, then below). */
  Ed.freeSpot = function (near, w = 160, h = 120) {
    const rects = Ed.state.items.map(Ed.itemRect);
    const hit = (x, y) => rects.some((r) => x < r.x + r.w + 24 && x + w + 24 > r.x && y < r.y + r.h + 24 && y + h + 24 > r.y);
    let base;
    if (near) { const r = Ed.itemRect(near); base = { x: r.x + r.w + 48, y: r.y }; } else base = Ed.viewCenter();
    for (let k = 0; k < 400; k++) {
      const x = base.x + Math.floor(k / 20) * 60, y = base.y + (k % 20) * 36;
      if (!hit(x, y)) return { x: Math.round(x), y: Math.round(y) };
    }
    return base;
  };

  /* ---------- selection ---------- */
  /** Items grouped with `id` (Ctrl+G) select together. */
  Ed.groupOf = (id) => { const it = Ed.get(id); return it && it.group ? Ed.state.items.filter((o) => o.group === it.group).map((o) => o.id) : [id]; };
  Ed.select = function (id, mode) {
    const ids = id ? Ed.groupOf(id) : [];
    if (mode === 'toggle') { Ed.sel = Ed.sel.includes(id) ? Ed.sel.filter((x) => !ids.includes(x)) : Ed.sel.concat(ids.filter((x) => !Ed.sel.includes(x))); }
    else if (mode === 'add') { Ed.sel = Ed.sel.concat(ids.filter((x) => !Ed.sel.includes(x))); }
    else Ed.sel = ids;
    syncSelection();
  };
  Ed.clearSelection = () => { Ed.sel = []; syncSelection(); };
  function syncSelection() {
    Ed.els.forEach((e, id) => { e.classList.toggle('selected', Ed.sel.includes(id)); const b = e.querySelector('.sel-badge'); if (b) b.textContent = Ed.sel.length > 1 && Ed.sel.includes(id) ? Ed.sel.indexOf(id) + 1 : ''; });
    Ed.emit('selection');
  }

  /* ---------- rendering ---------- */
  Ed.renderAll = function () {
    Ed.world.innerHTML = ''; Ed.els.clear();
    Ed.state.items.forEach((it) => Ed.renderItem(it));
    syncSelection();
  };
  Ed.renderItem = function (it) {
    const old = Ed.els.get(it.id);
    const active = document.activeElement;
    let focusKey = null, caret = null;
    if (old && old.contains(active) && active.dataset && active.dataset.k) { focusKey = active.dataset.k; caret = active.selectionStart; }
    const e = it.kind === 'matrix' ? buildMatrix(it) : it.kind === 'note' ? buildNote(it) : MX.Draw.build(it);
    e.style.left = it.x + 'px'; e.style.top = it.y + 'px';
    e.classList.toggle('selected', Ed.sel.includes(it.id));
    if (old) old.replaceWith(e); else Ed.world.append(e);
    Ed.els.set(it.id, e);
    if (focusKey) { const f = e.querySelector(`[data-k="${focusKey}"]`); if (f) { f.focus(); try { f.setSelectionRange(caret, caret); } catch (x) { /* ignore */ } } }
    return e;
  };
  Ed.refresh = function (it) { if (it.kind === 'matrix') Ed.recomputeTemps(it); return Ed.renderItem(it); };

  const textW = (s) => Math.max(38, Math.ceil(String(s || '').length * 9.6 + 20));
  function colWidths(it) {
    const [m, n] = Ed.dims(it);
    const w = [];
    for (let j = 0; j < n; j++) { let mx = 1; for (let i = 0; i < m; i++) mx = Math.max(mx, (it.cells[i][j] || '').length); it.tmpRows.forEach((t) => { mx = Math.max(mx, (t.cells[j] || '').length); }); w.push(textW('x'.repeat(mx))); }
    it.tmpCols.forEach((t) => { let mx = Math.max(2, (t.expr || '').length * 0.6); t.cells.forEach((c) => { mx = Math.max(mx, (c || '').length); }); w.push(textW('x'.repeat(mx))); });
    return w;
  }
  function applyWidths(it, grid) {
    grid.style.gridTemplateColumns = 'var(--hw) ' + colWidths(it).map((w) => w + 'px').join(' ');
  }

  function buildMatrix(it) {
    Ed.recomputeTemps(it);
    const [m, n] = Ed.dims(it);
    const TR = it.tmpRows, TC = it.tmpCols;
    const card = el('div', { class: 'card mat', 'data-id': it.id });
    const head = el('div', { class: 'head' },
      el('span', { class: 'grip', title: 'Drag to move · drop on another matrix to swap places' }, '⠿'),
      el('span', { class: 'sel-badge' }),
      el('input', { class: 'name', value: it.name, 'data-k': 'name', spellcheck: 'false', autocomplete: 'off', size: Math.max(1, it.name.length), title: 'Rename' }),
      el('span', { class: 'dims' }, `${m}×${n}`),
      it.caption ? el('span', { class: 'caption', title: it.caption }, it.caption) : null,
      el('span', { class: 'spacer' }),
      el('button', { class: 'hb ops', title: 'Operations on ' + it.name }, 'ƒ'),
      el('button', { class: 'hb more', title: 'More' }, '⋯'));
    const grid = el('div', { class: 'grid' });
    applyWidths(it, grid);
    const put = (node, r, c) => { node.style.gridRow = r; node.style.gridColumn = c; grid.append(node); return node; };
    const ls = Ed.lineSel && Ed.lineSel.id === it.id ? Ed.lineSel : null;
    put(el('div', { class: 'corner', title: 'Select all cells' }), 1, 1);
    for (let j = 0; j < n; j++) put(el('div', { class: 'ch' + (ls && ls.type === 'col' && ls.idx === j ? ' on' : ''), 'data-col': j, title: `Column ${j + 1}: tap for column operations, drag to reorder` }, 'C' + (j + 1)), 1, j + 2);
    TC.forEach((t, k) => put(el('div', { class: 'ch tmp' + (t.err ? ' err' : '') + (ls && ls.type === 'tcol' && ls.idx === k ? ' on' : ''), 'data-tcol': k, title: (t.expr ? 'T' + (k + 1) + ' = ' + t.expr : 'Temporary column T' + (k + 1)) + (t.err ? '\n⚠ ' + t.err : '') }, 'T' + (k + 1)), 1, n + 2 + k));
    for (let i = 0; i < m; i++) {
      const rowOn = ls && ls.type === 'row' && ls.idx === i;
      put(el('div', { class: 'rh' + (rowOn ? ' on' : ''), 'data-row': i, title: `Row ${i + 1}: tap for row operations, drag to reorder` }, 'R' + (i + 1)), i + 2, 1);
      for (let j = 0; j < n; j++) {
        const on = rowOn || (ls && ls.type === 'col' && ls.idx === j);
        put(el('input', { class: 'cell' + (on ? ' line-on' : '') + (validCell(it.cells[i][j]) ? '' : ' bad'), value: it.cells[i][j], placeholder: '0', 'data-r': i, 'data-c': j, 'data-k': `c${i}_${j}`, inputmode: 'text', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'next' }), i + 2, j + 2);
      }
      TC.forEach((t, k) => put(el('input', { class: 'cell tmp', value: t.cells[i] || '', placeholder: '·', 'data-tc': k, 'data-r': i, 'data-k': `tc${k}_${i}`, autocomplete: 'off', spellcheck: 'false' }), i + 2, n + 2 + k));
    }
    TR.forEach((t, k) => {
      const r = m + 2 + k;
      put(el('div', { class: 'rh tmp' + (t.err ? ' err' : '') + (ls && ls.type === 'trow' && ls.idx === k ? ' on' : ''), 'data-trow': k, title: (t.expr ? 'T' + (k + 1) + ' = ' + t.expr : 'Temporary row T' + (k + 1)) + (t.err ? '\n⚠ ' + t.err : '') }, 'T' + (k + 1)), r, 1);
      for (let j = 0; j < n; j++) put(el('input', { class: 'cell tmp' + (k === 0 ? ' first' : ''), value: t.cells[j] || '', placeholder: '·', 'data-tr': k, 'data-c': j, 'data-k': `tr${k}_${j}`, autocomplete: 'off', spellcheck: 'false' }), r, j + 2);
    });
    put(el('div', { class: 'br br-l' }), `2 / span ${m}`, 2);
    put(el('div', { class: 'br br-r' }), `2 / span ${m}`, n + 1);
    const body = el('div', { class: 'body' }, grid,
      el('button', { class: 'edge add-col', title: 'Add column' }, '+'),
      el('button', { class: 'edge add-row', title: 'Add row' }, '+'),
      el('div', { class: 'resize', title: 'Drag to add or remove rows and columns' }));
    const foot = el('div', { class: 'foot' },
      el('button', { class: 'fb add-trow', title: 'Add a temporary row for scratch calculations (not part of the matrix)' }, '+ temp row'),
      el('button', { class: 'fb add-tcol', title: 'Add a temporary column for scratch calculations' }, '+ temp col'));
    card.append(head, body, foot);
    if (it.showLog && it.log.length) {
      const log = el('div', { class: 'oplog' }, it.log.slice(-8).map((l) => el('div', { class: 'logline' }, l)), el('button', { class: 'fb clear-log', title: 'Clear history' }, 'clear'));
      card.append(log);
    }
    wireMatrix(card, it, grid);
    return card;
  }
  function validCell(s) { if (s == null || String(s).trim() === '') return true; try { Frac.parse(s); return true; } catch (e) { return false; } }

  function buildNote(it) {
    const card = el('div', { class: 'card note' + (it.result ? ' result-note' : ''), 'data-id': it.id });
    const head = el('div', { class: 'head' }, el('span', { class: 'grip' }, '⠿'), el('span', { class: 'sel-badge' }), it.name ? el('span', { class: 'name static' }, it.name) : el('span', { class: 'note-lbl' }, it.result ? 'result' : 'note'), el('span', { class: 'spacer' }), el('button', { class: 'hb more', title: 'More' }, '⋯'));
    const body = el('div', { class: 'note-body', contenteditable: 'true', spellcheck: 'false', 'data-k': 'note' });
    body.textContent = it.text;
    body.addEventListener('input', () => { it.text = body.innerText; Ed.commitSoon(); });
    body.addEventListener('blur', () => { if (!it.text.trim() && !it.name) { Ed.remove([it.id]); } Ed.commit(); });
    card.append(head, body);
    wireCardCommon(card, it, head);
    return card;
  }

  /* ---------- interactions ---------- */
  function wireCardCommon(card, it, head) {
    head.addEventListener('pointerdown', (ev) => {
      if (ev.button > 0 || ev.target.closest('button') || (ev.target.classList.contains('name') && document.activeElement === ev.target)) return;
      startCardDrag(ev, it, card);
    });
    head.querySelector('.more').addEventListener('click', (ev) => { ev.stopPropagation(); Ed.emit('more', it, ev.currentTarget); });
    card.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('.head')) return;
      if (!Ed.sel.includes(it.id) || ev.shiftKey || ev.metaKey || ev.ctrlKey) Ed.select(it.id, ev.shiftKey || ev.metaKey || ev.ctrlKey ? 'toggle' : null);
    });
    card.addEventListener('contextmenu', (ev) => { ev.preventDefault(); if (!Ed.sel.includes(it.id)) Ed.select(it.id); Ed.emit(it.kind === 'matrix' ? 'ops' : 'more', it, { getBoundingClientRect: () => ({ left: ev.clientX, right: ev.clientX, top: ev.clientY, bottom: ev.clientY }) }); });
  }

  function wireMatrix(card, it, grid) {
    const head = card.querySelector('.head');
    wireCardCommon(card, it, head);
    head.querySelector('.ops').addEventListener('click', (ev) => { ev.stopPropagation(); Ed.emit('ops', it, ev.currentTarget); });
    const nameI = head.querySelector('.name');
    nameI.addEventListener('input', () => { nameI.size = Math.max(1, nameI.value.length); });
    nameI.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') nameI.blur(); if (ev.key === 'Escape') { nameI.value = it.name; nameI.blur(); } });
    nameI.addEventListener('change', () => {
      const v = nameI.value.trim();
      if (v === it.name) return;
      if (!NAME_RE.test(v)) { Ed.toast('Names must start with a letter and contain only letters, digits and _'); nameI.value = it.name; return; }
      if (Ed.state.items.some((o) => o !== it && o.name === v)) { Ed.toast(`"${v}" is already used`); nameI.value = it.name; return; }
      it.name = v; Ed.commit(); Ed.emit('selection');
    });

    grid.addEventListener('input', (ev) => {
      const t = ev.target; if (!t.classList.contains('cell')) return;
      const d = t.dataset;
      if (d.tr != null) { const tr = it.tmpRows[+d.tr]; tr.cells[+d.c] = t.value; if (tr.expr) { tr.expr = ''; grid.querySelector(`[data-trow="${d.tr}"]`).title = 'Temporary row'; } }
      else if (d.tc != null) { const tc = it.tmpCols[+d.tc]; tc.cells[+d.r] = t.value; if (tc.expr) tc.expr = ''; }
      else {
        it.cells[+d.r][+d.c] = t.value;
        t.classList.remove('bad');
        // live-update temp lines that depend on the matrix
        if (it.tmpRows.some((x) => x.expr) || it.tmpCols.some((x) => x.expr)) { Ed.recomputeTemps(it); updateTempCells(card, it); }
      }
      applyWidths(it, grid);
      Ed.commitSoon();
      Ed.emit('cells', it);
    });
    grid.addEventListener('focusout', (ev) => {
      const t = ev.target; if (!t.classList || !t.classList.contains('cell')) return;
      const v = t.value.trim();
      if (v && !Frac.tryParse(v)) {
        try { const x = Frac.parse(v); t.value = x.toString(); t.dispatchEvent(new Event('input', { bubbles: true })); }
        catch (e) { t.classList.add('bad'); t.title = 'Not a number: ' + e.message; }
      }
      Ed.commit();
    });
    grid.addEventListener('keydown', (ev) => cellKeys(ev, it, card));
    grid.addEventListener('paste', (ev) => {
      const t = ev.target; if (!t.classList.contains('cell') || t.dataset.tr != null || t.dataset.tc != null) return;
      const text = ev.clipboardData.getData('text/plain');
      const P = M.parseText(text);
      if (!P || (P.length === 1 && P[0].length === 1)) return;
      ev.preventDefault();
      const r0 = +t.dataset.r, c0 = +t.dataset.c;
      const [m, n] = Ed.dims(it);
      Ed.resize(it, Math.max(m, r0 + P.length), Math.max(n, c0 + P[0].length));
      P.forEach((row, i) => row.forEach((s, j) => { it.cells[r0 + i][c0 + j] = s; }));
      Ed.refresh(it); Ed.commit(); Ed.toast(`Pasted ${P.length}×${P[0].length} block`);
    });
    grid.addEventListener('focusin', (ev) => { if (ev.target.classList.contains('cell') && !Ed.sel.includes(it.id)) Ed.select(it.id); });

    // line handles
    grid.addEventListener('pointerdown', (ev) => {
      const h = ev.target.closest('.rh, .ch, .corner');
      if (!h) return;
      ev.preventDefault();
      if (h.classList.contains('corner')) { Ed.select(it.id); Ed.emit('ops', it, h); return; }
      const d = h.dataset;
      if (d.trow != null) return Ed.openLine(it, 'trow', +d.trow, h);
      if (d.tcol != null) return Ed.openLine(it, 'tcol', +d.tcol, h);
      startLineDrag(ev, it, card, d.row != null ? 'row' : 'col', +(d.row ?? d.col), h);
    });
    card.querySelector('.add-col').addEventListener('click', () => { Ed.insertCol(it, Ed.dims(it)[1]); Ed.refresh(it); Ed.commit(); focusCell(it, 0, Ed.dims(it)[1] - 1); });
    card.querySelector('.add-row').addEventListener('click', () => { Ed.insertRow(it, it.cells.length); Ed.refresh(it); Ed.commit(); focusCell(it, it.cells.length - 1, 0); });
    card.querySelector('.add-trow').addEventListener('click', () => { Ed.addTemp(it, 'row'); });
    card.querySelector('.add-tcol').addEventListener('click', () => { Ed.addTemp(it, 'col'); });
    const cl = card.querySelector('.clear-log');
    if (cl) cl.addEventListener('click', () => { it.log = []; Ed.refresh(it); Ed.commit(); });
    card.querySelector('.resize').addEventListener('pointerdown', (ev) => startResize(ev, it, card));
  }
  function updateTempCells(card, it) {
    card.querySelectorAll('.cell.tmp').forEach((inp) => {
      const d = inp.dataset;
      if (d.tr != null && it.tmpRows[+d.tr].expr) inp.value = it.tmpRows[+d.tr].cells[+d.c] || '';
      if (d.tc != null && it.tmpCols[+d.tc].expr) inp.value = it.tmpCols[+d.tc].cells[+d.r] || '';
    });
    card.querySelectorAll('.rh.tmp, .ch.tmp').forEach((h) => {
      const t = h.dataset.trow != null ? it.tmpRows[+h.dataset.trow] : it.tmpCols[+h.dataset.tcol];
      h.classList.toggle('err', !!t.err);
    });
  }
  Ed.addTemp = function (it, type, vals, expr) {
    const [m, n] = Ed.dims(it);
    const L = type === 'row' ? n : m;
    const t = { cells: vals ? vals.slice() : Array.from({ length: L }, () => ''), expr: expr || '' };
    (type === 'row' ? it.tmpRows : it.tmpCols).push(t);
    Ed.refresh(it); Ed.commit();
    const k = (type === 'row' ? it.tmpRows : it.tmpCols).length - 1;
    const h = Ed.els.get(it.id).querySelector(type === 'row' ? `[data-trow="${k}"]` : `[data-tcol="${k}"]`);
    if (h) Ed.openLine(it, type === 'row' ? 'trow' : 'tcol', k, h, true);
  };
  function focusCell(it, r, c) {
    const e = Ed.els.get(it.id); if (!e) return;
    const inp = e.querySelector(`.cell[data-r="${r}"][data-c="${c}"]:not(.tmp)`);
    if (inp) { inp.focus(); inp.select(); }
  }
  Ed.focusCell = focusCell;
  function cellKeys(ev, it, card) {
    const t = ev.target; if (!t.classList.contains('cell')) return;
    const all = [...card.querySelectorAll('.cell')];
    const pos = (x) => [x.style.gridRow, x.style.gridColumn].map(Number);
    const [r, c] = pos(t);
    const find = (dr, dc) => all.find((x) => { const [rr, cc] = pos(x); return rr === r + dr && cc === c + dc; });
    let target = null;
    if (ev.key === 'Enter') {
      target = find(ev.shiftKey ? -1 : 1, 0);
      if (!target && !ev.shiftKey && t.dataset.tr == null && +t.dataset.r === it.cells.length - 1 && (ev.ctrlKey || ev.metaKey)) { Ed.insertRow(it, it.cells.length); Ed.refresh(it); Ed.commit(); focusCell(it, it.cells.length - 1, +t.dataset.c); ev.preventDefault(); return; }
      if (!target) { t.blur(); }
    } else if (ev.key === 'ArrowDown') target = find(1, 0);
    else if (ev.key === 'ArrowUp') target = find(-1, 0);
    else if (ev.key === 'ArrowLeft' && t.selectionStart === 0 && t.selectionEnd === 0) target = find(0, -1);
    else if (ev.key === 'ArrowRight' && t.selectionStart === t.value.length) target = find(0, 1);
    else if (ev.key === 'Escape') { t.blur(); return; }
    else return;
    ev.preventDefault();
    if (target) { target.focus(); target.select(); }
  }

  /* drag helpers using window listeners (robust to re-rendering) */
  function track(ev, onMove, onUp) {
    const id = ev.pointerId;
    const mv = (e) => { if (e.pointerId === id) onMove(e); };
    const up = (e) => { if (e.pointerId !== id) return; window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); onUp(e, e.type === 'pointercancel'); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  Ed.startDrag = (ev, it, e) => startCardDrag(ev, it, e);
  function startCardDrag(ev, it, card) {
    const sx = ev.clientX, sy = ev.clientY, z = Ed.state.view.z;
    const additive = ev.shiftKey || ev.metaKey || ev.ctrlKey;
    const wasSelected = Ed.sel.includes(it.id);
    if (!wasSelected) Ed.select(it.id, additive ? 'add' : null);
    const moving = (Ed.sel.includes(it.id) ? Ed.sel : [it.id]).map((id) => Ed.get(id)).filter(Boolean);
    const start = moving.map((m) => ({ m, x: m.x, y: m.y }));
    let moved = false, target = null;
    const lp = setTimeout(() => { if (!moved && ev.pointerType !== 'mouse') { moved = 'lp'; Ed.select(it.id, 'toggle'); if (navigator.vibrate) navigator.vibrate(15); } }, 480);
    const isName = ev.target.classList && ev.target.classList.contains('name');
    track(ev, (e) => {
      const dx = (e.clientX - sx) / z, dy = (e.clientY - sy) / z;
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return;
      if (moved === 'lp') return;
      if (!moved) { moved = true; clearTimeout(lp); if (isName) ev.target.blur(); moving.forEach((m) => { const e3 = Ed.els.get(m.id); if (e3) e3.classList.add('dragging'); }); }
      start.forEach((s) => { s.m.x = Math.round(s.x + dx); s.m.y = Math.round(s.y + dy); const e2 = Ed.els.get(s.m.id); e2.style.left = s.m.x + 'px'; e2.style.top = s.m.y + 'px'; });
      Ed.emit('moved');
      // swap target (matrix dropped on matrix)
      let t = null;
      if (moving.length === 1 && it.kind === 'matrix') {
        card.style.pointerEvents = 'none';
        const under = document.elementFromPoint(e.clientX, e.clientY);
        card.style.pointerEvents = '';
        const c = under && under.closest('.card.mat');
        if (c && c !== card) t = Ed.get(c.dataset.id);
      }
      if (target !== t) { if (target) Ed.els.get(target.id)?.classList.remove('swap-target'); target = t; if (target) Ed.els.get(target.id).classList.add('swap-target'); }
    }, () => {
      clearTimeout(lp);
      moving.forEach((m) => Ed.els.get(m.id)?.classList.remove('dragging'));
      if (!moved) {
        if (isName) { ev.target.focus(); ev.target.select(); }
        else if (wasSelected && additive) Ed.select(it.id, 'toggle');
        else if (!additive) Ed.select(it.id);
        return;
      }
      if (moved === 'lp') return;
      if (target) {
        Ed.els.get(target.id).classList.remove('swap-target');
        const sx0 = start[0].x, sy0 = start[0].y;
        it.x = target.x; it.y = target.y; target.x = sx0; target.y = sy0;
        [it, target].forEach((m) => { const e2 = Ed.els.get(m.id); e2.classList.add('animate'); e2.style.left = m.x + 'px'; e2.style.top = m.y + 'px'; setTimeout(() => e2.classList.remove('animate'), 300); });
        Ed.toast(`Swapped ${it.name || 'item'} and ${target.name || 'item'}`);
      }
      Ed.commit(); Ed.emit('moved');
    });
  }

  function startLineDrag(ev, it, card, type, idx, handle) {
    const sx = ev.clientX, sy = ev.clientY;
    let moved = false, cur = idx;
    const swaps = [];
    track(ev, (e) => {
      if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 6) return;
      if (!moved) { moved = true; Ed.closePopover(); Ed.lineSel = { id: it.id, type, idx: cur }; }
      const c = Ed.els.get(it.id);
      const hs = [...c.querySelectorAll(type === 'row' ? '.rh[data-row]' : '.ch[data-col]')];
      const p = type === 'row' ? e.clientY : e.clientX;
      for (const h of hs) {
        const r = h.getBoundingClientRect();
        const k = +(type === 'row' ? h.dataset.row : h.dataset.col);
        const mid = type === 'row' ? r.top + r.height / 2 : r.left + r.width / 2;
        const lo = type === 'row' ? r.top : r.left, hi = type === 'row' ? r.bottom : r.right;
        if (k !== cur && p > lo && p < hi && ((k > cur && p > mid - (hi - lo) * 0.2) || (k < cur && p < mid + (hi - lo) * 0.2))) {
          const step = k > cur ? 1 : -1;
          while (cur !== k) { const nx = cur + step; type === 'row' ? Ed.swapRows(it, cur, nx) : Ed.swapCols(it, cur, nx); swaps.push([cur, nx]); cur = nx; }
          Ed.lineSel = { id: it.id, type, idx: cur };
          Ed.refresh(it);
          Ed.els.get(it.id).classList.add('line-dragging');
          break;
        }
      }
    }, () => {
      const c = Ed.els.get(it.id); if (c) c.classList.remove('line-dragging');
      if (!moved) { Ed.select(it.id); Ed.openLine(it, type, idx, handle); return; }
      if (swaps.length) {
        const P = type === 'row' ? 'R' : 'C';
        swaps.forEach(([a, b]) => Ed.log(it, `${P}${Math.min(a, b) + 1} ↔ ${P}${Math.max(a, b) + 1}`));
        Ed.refresh(it); Ed.commit();
      }
    });
  }

  function startResize(ev, it, card) {
    ev.preventDefault(); ev.stopPropagation();
    const sx = ev.clientX, sy = ev.clientY, z = Ed.state.view.z;
    const snap = JSON.parse(JSON.stringify({ cells: it.cells, tmpRows: it.tmpRows, tmpCols: it.tmpCols }));
    const [m0, n0] = Ed.dims(it);
    const cellW = Math.max(40, card.querySelector('.grid').offsetWidth / (n0 + it.tmpCols.length + 0.6));
    const cellH = 36;
    let last = `${m0}x${n0}`;
    card.classList.add('resizing');
    track(ev, (e) => {
      const m = Math.max(1, Math.min(30, m0 + Math.round((e.clientY - sy) / z / cellH)));
      const n = Math.max(1, Math.min(30, n0 + Math.round((e.clientX - sx) / z / cellW)));
      if (`${m}x${n}` === last) return;
      last = `${m}x${n}`;
      const s = JSON.parse(JSON.stringify(snap));
      it.cells = s.cells; it.tmpRows = s.tmpRows; it.tmpCols = s.tmpCols;
      Ed.resize(it, m, n);
      Ed.refresh(it).classList.add('resizing');
    }, () => { const c = Ed.els.get(it.id); if (c) c.classList.remove('resizing'); Ed.commit(); });
  }

  /* ---------- line popover (row/column operations, temp lines) ---------- */
  Ed.openLine = function (it, type, idx, anchor, focusExpr) {
    if (anchor && anchor.getBoundingClientRect) { const r0 = anchor.getBoundingClientRect(); anchor = { getBoundingClientRect: () => r0 }; }
    Ed.lineSel = { id: it.id, type, idx };
    Ed.refresh(it);
    const [m, n] = Ed.dims(it);
    const isRow = type === 'row' || type === 'trow';
    const P = isRow ? 'R' : 'C';
    const count = isRow ? m : n;
    const pop = el('div', { class: 'linepop' });
    const msg = el('div', { class: 'pop-msg' });
    const fail = (e) => { msg.textContent = e.message || e; msg.className = 'pop-msg err'; };
    const done = (line) => { if (line) Ed.log(it, line); Ed.refresh(it); Ed.commit(); };
    const reopen = (t, k) => { const c = Ed.els.get(it.id); const h = c && c.querySelector(t === 'row' ? `[data-row="${k}"]` : t === 'col' ? `[data-col="${k}"]` : t === 'trow' ? `[data-trow="${k}"]` : `[data-tcol="${k}"]`); if (h) Ed.openLine(it, t, k, h); else Ed.closePopover(); };

    if (type === 'row' || type === 'col') {
      const me = P + (idx + 1);
      const inp = el('input', { class: 'pop-in', placeholder: isRow ? `e.g. ${me} - 3R${idx === 0 ? 2 : 1}  ·  *2  ·  /3  ·  swap R${idx === 0 ? 2 : 1}` : `e.g. ${me} + 2C${idx === 0 ? 2 : 1}  ·  *-1  ·  swap C${idx === 0 ? 2 : 1}`, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go' });
      const apply = () => { try { const line = Ed.applyLineCommand(it, isRow ? 'row' : 'col', idx, inp.value); done(line); inp.value = ''; reopen(type, Ed.lineSel ? Ed.lineSel.idx : idx); } catch (e) { fail(e); } };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
      const b = (label, title, fn, cls) => el('button', { class: 'tb small' + (cls ? ' ' + cls : ''), title, onclick: () => { try { fn(); } catch (e) { fail(e); } } }, label);
      const moveTo = (k) => { if (k < 0 || k >= count) return; isRow ? Ed.swapRows(it, idx, k) : Ed.swapCols(it, idx, k); done(`${P}${Math.min(idx, k) + 1} ↔ ${P}${Math.max(idx, k) + 1}`); reopen(type, k); };
      const vals = () => (isRow ? it.cells[idx].slice() : it.cells.map((r) => r[idx]));
      pop.append(
        el('div', { class: 'pop-title' }, el('b', null, isRow ? `Row ${idx + 1}` : `Column ${idx + 1}`), el('span', { class: 'muted' }, ` ${me} ←`)),
        el('div', { class: 'pop-line' }, inp, b('Apply', 'Apply the operation (Enter)', apply, 'primary')),
        msg,
        el('div', { class: 'pop-btns' },
          b('×(−1)', 'Negate', () => { done(Ed.applyLineCommand(it, isRow ? 'row' : 'col', idx, '*-1')); reopen(type, idx); }),
          b(isRow ? '↑' : '←', 'Swap with previous', () => moveTo(idx - 1)),
          b(isRow ? '↓' : '→', 'Swap with next', () => moveTo(idx + 1)),
          b('→ temp', `Copy ${me} into a temporary ${isRow ? 'row' : 'column'} for scratch work`, () => { Ed.addTemp(it, isRow ? 'row' : 'col', vals()); }),
          b('Fill…', 'Set every entry to a value', () => { inp.value = '= '; inp.focus(); msg.textContent = 'Type "= value" to fill, or "= 1 2 3" to set each entry'; msg.className = 'pop-msg'; }),
          b('Clear', 'Set all entries to 0', () => { (isRow ? it.cells[idx] : it.cells).forEach((_, k) => { if (isRow) it.cells[idx][k] = ''; else it.cells[k][idx] = ''; }); done(); reopen(type, idx); })),
        el('div', { class: 'pop-btns' },
          b(isRow ? '+ above' : '+ left', 'Insert before', () => { isRow ? Ed.insertRow(it, idx) : Ed.insertCol(it, idx); done(); reopen(type, idx + 1); }),
          b(isRow ? '+ below' : '+ right', 'Insert after', () => { isRow ? Ed.insertRow(it, idx + 1) : Ed.insertCol(it, idx + 1); done(); reopen(type, idx); }),
          b('Duplicate', 'Duplicate this line', () => { isRow ? Ed.insertRow(it, idx + 1, it.cells[idx].slice()) : Ed.insertCol(it, idx + 1, vals()); done(); reopen(type, idx); }),
          b('Delete', 'Delete this line', () => { if (!(isRow ? Ed.removeRow(it, idx) : Ed.removeCol(it, idx))) throw new Error('A matrix needs at least one ' + (isRow ? 'row' : 'column')); Ed.lineSel = null; done(); Ed.closePopover(); }, 'danger')),
        el('div', { class: 'pop-hint' }, isRow ? 'Tip: drag the R handle up/down to reorder rows.' : 'Tip: drag the C handle left/right to reorder columns.'));
      Ed.showPopover(anchor, pop, () => { if (Ed.lineSel && Ed.lineSel.id === it.id) { Ed.lineSel = null; if (Ed.get(it.id)) Ed.refresh(it); } });
      if (!isCoarse()) inp.focus();
      return;
    }
    // temp row / temp column
    const list = type === 'trow' ? it.tmpRows : it.tmpCols;
    const t = list[idx];
    const tname = 'T' + (idx + 1);
    const inp = el('input', { class: 'pop-in', value: t.expr || '', placeholder: isRow ? 'e.g. R1 - 2R2   or   3R1 + T2' : 'e.g. C1 + C2', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done' });
    const setExpr = () => {
      try {
        const v = inp.value.trim();
        if (v) t.cells = Ed.evalLine(it, isRow ? 'row' : 'col', v).map(cellStr);
        t.expr = v; t.err = '';
        Ed.refresh(it); Ed.commit(); msg.textContent = v ? `${tname} = ${pretty(v)}` : ''; msg.className = 'pop-msg ok';
      } catch (e) { fail(e); }
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') setExpr(); });
    const targetSel = el('select', { class: 'pop-sel' }, Array.from({ length: count }, (_, k) => el('option', { value: k }, P + (k + 1))));
    const tvals = () => t.cells.map((s) => Frac.parse(s));
    const b = (label, title, fn, cls) => el('button', { class: 'tb small' + (cls ? ' ' + cls : ''), title, onclick: () => { try { fn(); } catch (e) { fail(e); } } }, label);
    pop.append(
      el('div', { class: 'pop-title' }, el('b', null, `Temporary ${isRow ? 'row' : 'column'} ${tname}`), el('span', { class: 'muted' }, ' — scratch space, not part of the matrix')),
      el('div', { class: 'pop-line' }, el('span', { class: 'pop-eq' }, tname + ' ='), inp, b('Set', 'Compute from the expression (Enter)', setExpr, 'primary')),
      msg,
      el('div', { class: 'pop-btns' },
        el('span', { class: 'muted' }, 'Write into'), targetSel,
        b('Replace', `Replace the chosen ${isRow ? 'row' : 'column'} with ${tname}`, () => {
          const k = +targetSel.value; const v = tvals();
          if (isRow) it.cells[k] = v.map(cellStr); else v.forEach((x, i) => { it.cells[i][k] = cellStr(x); });
          done(`${P}${k + 1} ← ${t.expr ? pretty(t.expr) : tname}`); reopen(type, idx);
        }),
        b('Insert', `Insert ${tname} into the matrix as a new ${isRow ? 'row' : 'column'} after the chosen one`, () => {
          const k = +targetSel.value + 1; const v = tvals().map(cellStr);
          if (isRow) Ed.insertRow(it, k, v); else Ed.insertCol(it, k, v);
          done(`insert ${tname} as ${P}${k + 1}`); Ed.closePopover();
        })),
      el('div', { class: 'pop-btns' },
        b('Freeze values', 'Keep the numbers but drop the expression', () => { t.expr = ''; done(); reopen(type, idx); }),
        b('Delete', 'Remove this temporary line', () => { list.splice(idx, 1); Ed.lineSel = null; done(); Ed.closePopover(); }, 'danger')),
      el('div', { class: 'pop-hint' }, isRow ? 'Use R1, R2… for rows and T1, T2… for temp rows. The temp row updates live as the matrix changes.' : 'Use C1, C2… for columns and T1, T2… for temp columns.'));
    if (t.err) fail(t.err);
    Ed.showPopover(anchor, pop, () => { if (Ed.lineSel && Ed.lineSel.id === it.id) { Ed.lineSel = null; if (Ed.get(it.id)) Ed.refresh(it); } });
    if (focusExpr || !isCoarse()) inp.focus();
  };

  /* ---------- popover ---------- */
  let popClose = null;
  Ed.showPopover = function (anchor, content, onClose) {
    const pop = document.getElementById('popover');
    if (popClose) { const f = popClose; popClose = null; f(); }
    pop.innerHTML = ''; pop.append(content); pop.hidden = false;
    popClose = onClose || null;
    const vw = window.innerWidth, vh = window.innerHeight;
    if (vw < 560) { pop.classList.add('sheet'); pop.style.left = ''; pop.style.top = ''; return; }
    pop.classList.remove('sheet');
    const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : anchor;
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x = r.left, y = r.bottom + 6;
    if (x + pw > vw - 8) x = vw - pw - 8;
    if (y + ph > vh - 8) y = Math.max(8, r.top - ph - 6);
    pop.style.left = Math.max(8, x) + 'px'; pop.style.top = Math.max(8, y) + 'px';
  };
  Ed.closePopover = function () {
    const pop = document.getElementById('popover');
    if (pop.hidden) return;
    pop.hidden = true; pop.innerHTML = '';
    if (popClose) { const f = popClose; popClose = null; f(); }
  };
  Ed.popoverOpen = () => !document.getElementById('popover').hidden;

  let toastTimer;
  Ed.toast = function (msg, isErr) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false; t.classList.toggle('err', !!isErr);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, isErr ? 4200 : 2200);
  };

  /* ---------- stage: pan, zoom, marquee, double-tap ---------- */
  function setupStage() {
    const stage = Ed.stage;
    const pointers = new Map();
    let pan = null, pinch = null, lastTap = { t: 0, x: 0, y: 0 };
    stage.addEventListener('pointerdown', (ev) => {
      Ed.lastPointerWorld = Ed.toWorld(ev.clientX, ev.clientY);
      if (ev.target !== stage && ev.target !== Ed.world) return;
      if (ev.button > 0 && ev.button !== 1) return;
      if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
      Ed.closePopover();
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      stage.setPointerCapture(ev.pointerId);
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, z: Ed.state.view.z, vx: Ed.state.view.x, vy: Ed.state.view.y };
        pan = null;
        return;
      }
      if (ev.pointerType === 'mouse' && ev.button === 0) {
        const mq = document.getElementById('marquee');
        pan = { marquee: true, sx: ev.clientX, sy: ev.clientY, mq, add: ev.shiftKey, moved: false };
        return;
      }
      pan = { sx: ev.clientX, sy: ev.clientY, vx: Ed.state.view.x, vy: Ed.state.view.y, moved: false };
    });
    stage.addEventListener('pointermove', (ev) => {
      if (!pointers.has(ev.pointerId)) { return; }
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (pinch && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const r = stage.getBoundingClientRect();
        const nz = Math.min(2.5, Math.max(0.25, pinch.z * d / pinch.d));
        const px = pinch.cx - r.left, py = pinch.cy - r.top;
        Ed.state.view = { z: nz, x: px - ((px - pinch.vx) * nz) / pinch.z + (cx - pinch.cx), y: py - ((py - pinch.vy) * nz) / pinch.z + (cy - pinch.cy) };
        Ed.requestView();
        return;
      }
      if (!pan) return;
      if (pan.marquee) {
        const x0 = Math.min(pan.sx, ev.clientX), y0 = Math.min(pan.sy, ev.clientY);
        const sr = stage.getBoundingClientRect();
        if (!pan.moved && Math.hypot(ev.clientX - pan.sx, ev.clientY - pan.sy) < 4) return;
        pan.moved = true;
        Object.assign(pan.mq.style, { left: x0 - sr.left + 'px', top: y0 - sr.top + 'px', width: Math.abs(ev.clientX - pan.sx) + 'px', height: Math.abs(ev.clientY - pan.sy) + 'px' });
        pan.mq.hidden = false;
        return;
      }
      if (Math.hypot(ev.clientX - pan.sx, ev.clientY - pan.sy) > 4) pan.moved = true;
      Ed.state.view.x = pan.vx + ev.clientX - pan.sx; Ed.state.view.y = pan.vy + ev.clientY - pan.sy;
      Ed.requestView();
      stage.classList.add('panning');
    });
    const end = (ev) => {
      if (!pointers.has(ev.pointerId)) return;
      pointers.delete(ev.pointerId);
      stage.classList.remove('panning');
      if (pinch) { if (pointers.size < 2) { pinch = null; pan = null; } return; }
      if (!pan) return;
      if (pan.marquee && pan.moved) {
        pan.mq.hidden = true;
        const a = Ed.toWorld(Math.min(pan.sx, ev.clientX), Math.min(pan.sy, ev.clientY));
        const b = Ed.toWorld(Math.max(pan.sx, ev.clientX), Math.max(pan.sy, ev.clientY));
        if (!pan.add) Ed.sel = [];
        // like Excalidraw: select what is fully inside the box
        Ed.state.items.forEach((it) => { const r = MX.Draw ? MX.Draw.bounds(it) : Ed.itemRect(it); if (r.x >= a.x && r.x + r.w <= b.x && r.y >= a.y && r.y + r.h <= b.y) Ed.select(it.id, 'add'); });
        syncSelection();
        pan = null; return;
      }
      if (!pan.moved && ev.type === 'pointerup') {
        const now = Date.now();
        if (now - lastTap.t < 350 && Math.hypot(ev.clientX - lastTap.x, ev.clientY - lastTap.y) < 24) {
          lastTap.t = 0;
          Ed.emit('dbltap', ev.clientX, ev.clientY);
        } else {
          lastTap = { t: now, x: ev.clientX, y: ev.clientY };
          Ed.clearSelection();
        }
      }
      pan = null;
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('wheel', (ev) => {
      if (ev.target.closest && ev.target.closest('.note-body')) return;
      ev.preventDefault();
      if (ev.ctrlKey || ev.metaKey) Ed.zoomAt(ev.clientX, ev.clientY, Math.exp(-ev.deltaY * 0.01));
      else { Ed.state.view.x -= ev.deltaX; Ed.state.view.y -= ev.deltaY; Ed.requestView(); }
    }, { passive: false });
    stage.addEventListener('pointermove', (ev) => { Ed.lastPointerWorld = Ed.toWorld(ev.clientX, ev.clientY); });
    // Safari pinch gestures
    stage.addEventListener('gesturestart', (e) => e.preventDefault());
  }
})(window);
