/* Application shell: toolbar, command bar, menus, selection bar, clipboard and keyboard. */
(function (G) {
  'use strict';
  const MX = G.MX;
  const { Frac, M, el } = MX;
  const Ed = MX.Ed, X = MX.Explainer;
  const App = (MX.App = {});
  const $ = (id) => document.getElementById(id);
  let stepsMode = false;

  /* ---------- results ---------- */
  App.insertResultItem = function (item, caption, near, pos) {
    near = near || (Ed.sel.length ? Ed.get(Ed.sel[Ed.sel.length - 1]) : null);
    let it;
    if (item.kind === 'matrix') {
      const cells = item.M.map((r) => r.map((x) => (x instanceof Frac ? x.toString() : typeof x === 'number' ? MX.fmtNumber(x, 8) : String(x))));
      const spot = pos || Ed.freeSpot(near, 60 + cells[0].length * 50, 50 + cells.length * 36);
      const pref = /^[A-Za-z_]\w*$/.test(item.label || '') && item.label.length <= 2 ? item.label : null;
      it = Ed.addMatrix({ cells, x: spot.x, y: spot.y, caption: (caption ? caption + (item.label && item.label.length > 2 ? ' → ' + item.label : '') : ''), name: pref });
    } else {
      const text = item.kind === 'scalar' ? `${item.label || caption || 'value'} = ${MX.fmt(item.v)}` : (caption ? caption + '\n' : '') + item.text;
      const spot = pos || Ed.freeSpot(near, 200, 60);
      it = Ed.addNote({ text, x: spot.x, y: spot.y, result: true });
    }
    Ed.commit();
    requestAnimationFrame(() => Ed.scrollIntoView(it));
    flash(it);
    return it;
  };
  function flash(it) { const e = Ed.els.get(it.id); if (e) { e.classList.add('flash'); setTimeout(() => e.classList.remove('flash'), 900); } }
  App.insertResult = function (res, caption, near) {
    const items = res.kind === 'multi' ? res.items : [res];
    let last = null, made = [];
    items.forEach((item) => {
      let pos = null;
      if (last) { const r = Ed.itemRect(last); pos = Ed.freeSpot(null, 100, 60); pos = { x: r.x, y: r.y + r.h + 28 }; if (overlaps(pos)) pos = null; }
      last = App.insertResultItem(item, caption, near, pos);
      made.push(last);
    });
    return made;
  };
  function overlaps(p) { return Ed.state.items.some((it) => { const r = Ed.itemRect(it); return p.x < r.x + r.w + 20 && p.x + 120 > r.x && p.y < r.y + r.h + 20 && p.y + 80 > r.y; }); }

  const CAP = { mul: (n) => `${n[0]}·${n[1]}`, add: (n) => `${n[0]} + ${n[1]}`, sub: (n) => `${n[0]} − ${n[1]}`, scale: (n) => `${n[0]}·${n[1]}`, pow: (n) => `${n[0]}^${n[1]}`, transpose: (n) => `${n[0]}ᵀ`, inverse: (n) => `${n[0]}⁻¹`, solve: (n) => `${n[0]}x = ${n[1]}`, solveaug: (n) => `solve [${n[0]}]`, lstsq: (n) => `${n[0]}x ≈ ${n[1]}`, hadamard: (n) => `${n[0]}∘${n[1]}`, kron: (n) => `${n[0]}⊗${n[1]}` };
  App.caption = (key, names) => (CAP[key] ? CAP[key](names) : `${MX.ops[key].short}(${names.join(', ')})`);
  /** Compute or explain an operation on workspace items. */
  App.runOp = function (key, operands, mode) {
    const op = MX.ops[key];
    mode = mode || (stepsMode ? 'steps' : 'answer');
    const names = operands.map((o) => (o.id ? Ed.get(o.id).name : o.value));
    if (mode === 'steps') { X.open({ op: key, operands, run: 'steps' }); return; }
    try {
      const args = operands.map((o, i) => {
        const kind = op.inputs[i].kind || 'matrix';
        if (kind === 'matrix') return Ed.matrixOf(Ed.get(o.id));
        const x = Frac.parse(o.value);
        return kind === 'int' ? Number(x.n) : x;
      });
      const r = MX.run(key, args, {}, false);
      if (r.error) throw new Error(r.error);
      const first = operands.find((o) => o.id);
      App.insertResult(r.result, App.caption(key, names), first ? Ed.get(first.id) : null);
    } catch (e) { Ed.toast(e.message, true); }
  };

  /* ---------- command bar ---------- */
  const hist = []; let hIdx = -1;
  function runCommand(src) {
    const msg = $('cmd-msg');
    const show = (t, err) => { msg.textContent = t; msg.hidden = false; msg.classList.toggle('err', !!err); clearTimeout(show.t); show.t = setTimeout(() => { msg.hidden = true; }, err ? 6000 : 3000); };
    src = src.trim(); if (!src) return;
    hist.push(src); hIdx = hist.length;
    const { name, expr } = MX.parseCommand(src);
    try {
      if (name && !/^[A-Za-z_]\w*$/.test(name)) throw new Error('Invalid name');
      const v = MX.evaluate(expr, Ed.resolve);
      const caption = expr.trim();
      if (Array.isArray(v)) {
        const existing = name && Ed.byName(name);
        if (existing && existing.kind === 'matrix') {
          Ed.setCells(existing, v.map((r) => r.map((x) => x.toString())));
          existing.caption = caption; Ed.refresh(existing); Ed.commit(); flash(existing); Ed.scrollIntoView(existing);
          show(`Updated ${name}`);
        } else {
          if (existing) throw new Error(`"${name}" is already used by a note`);
          const it = App.insertResultItem({ kind: 'matrix', M: v, label: name || '' }, caption);
          if (name && it.name !== name) { it.name = name; Ed.refresh(it); Ed.commit(); }
          show(`Created ${it.name} (${M.dimStr(v)})`);
        }
      } else if (v instanceof Frac) {
        if (name) {
          const ex = Ed.byName(name);
          if (ex && ex.kind === 'matrix') throw new Error(`"${name}" is a matrix`);
          if (ex) { ex.value = v.toString(); ex.text = `${name} = ${MX.fmt(v)}   (${caption})`; Ed.refresh(ex); Ed.commit(); }
          else { const sp = Ed.freeSpot(Ed.sel.length ? Ed.get(Ed.sel[0]) : null, 200, 60); const it = Ed.addNote({ name, value: v.toString(), text: `${name} = ${MX.fmt(v)}   (${caption})`, x: sp.x, y: sp.y, result: true }); Ed.commit(); flash(it); }
        } else App.insertResultItem({ kind: 'scalar', v, label: caption });
        show(`${name || caption} = ${MX.fmt(v)}`);
      } else if (v && v.special) {
        App.insertResult(v.special, caption);
        show('Done');
      }
      $('cmd').value = '';
    } catch (e) { show(e.message, true); }
  }

  /* ---------- new-matrix picker ---------- */
  App.newMatrixPicker = function (anchor, worldPos) {
    const N = 6;
    const box = el('div', { class: 'picker' });
    const lbl = el('div', { class: 'picker-lbl' }, 'Pick a size');
    const grid = el('div', { class: 'picker-grid' });
    const create = (m, n, cells) => {
      Ed.closePopover();
      const pos = worldPos || Ed.freeSpot(Ed.sel.length ? Ed.get(Ed.sel[Ed.sel.length - 1]) : null, 60 + n * 46, 40 + m * 36);
      const it = Ed.addMatrix({ rows: m, cols: n, cells, x: Math.round(pos.x), y: Math.round(pos.y) });
      Ed.select(it.id); Ed.commit();
      requestAnimationFrame(() => { Ed.scrollIntoView(it); if (!cells) Ed.focusCell(it, 0, 0); });
    };
    for (let i = 1; i <= N; i++) for (let j = 1; j <= N; j++) {
      const c = el('div', { class: 'pk', 'data-i': i, 'data-j': j });
      c.addEventListener('pointerenter', () => { grid.querySelectorAll('.pk').forEach((x) => x.classList.toggle('on', +x.dataset.i <= i && +x.dataset.j <= j)); lbl.textContent = `${i} × ${j}`; });
      c.addEventListener('click', () => create(i, j));
      grid.append(c);
    }
    const mi = el('input', { type: 'number', min: 1, max: 30, value: 3, class: 'num' }), ni = el('input', { type: 'number', min: 1, max: 30, value: 3, class: 'num' });
    const ta = el('textarea', { rows: 3, placeholder: 'or paste: 1 2; 3 4 · [[1,2],[3,4]] · LaTeX · spreadsheet cells', spellcheck: 'false', autocapitalize: 'off' });
    box.append(el('div', { class: 'pop-title' }, el('b', null, 'New matrix')), lbl, grid,
      el('div', { class: 'pop-line' }, mi, el('span', null, '×'), ni, el('button', { class: 'tb small primary', onclick: () => create(Math.max(1, Math.min(30, +mi.value || 1)), Math.max(1, Math.min(30, +ni.value || 1))) }, 'Create')),
      el('div', { class: 'pop-line' }, el('button', { class: 'tb small accent', style: { flex: 1 }, onclick: () => App.pickImage(worldPos) }, '📷  Screenshot / photo…'), el('button', { class: 'tb small', style: { flex: 1 }, onclick: () => { Ed.closePopover(); App.readClipboard(worldPos); } }, '📋  From clipboard')),
      el('div', { class: 'pop-line col' }, ta, el('button', { class: 'tb small', onclick: () => { const P = M.parseText(ta.value); if (!P) return Ed.toast('Could not read a matrix from that text', true); create(P.length, P[0].length, P); } }, 'Create from text')),
      el('div', { class: 'pop-line' }, el('span', { class: 'muted' }, 'Quick:'),
        el('button', { class: 'tb small', onclick: () => create(3, 3, M.toStrings(M.identity(3))) }, 'I₃'),
        el('button', { class: 'tb small', onclick: () => create(3, 1) }, 'vector 3×1'),
        el('button', { class: 'tb small', onclick: () => { const r = () => String(Math.floor(Math.random() * 11) - 5); create(3, 3, Array.from({ length: 3 }, () => [r(), r(), r()])); } }, 'random 3×3')));
    Ed.showPopover(anchor, box);
  };

  /* ---------- per-matrix operations menu ---------- */
  function opsMenu(it, anchor) {
    if (!Ed.sel.includes(it.id)) Ed.select(it.id);
    const box = el('div', { class: 'opsmenu' });
    box.append(el('div', { class: 'pop-title' }, el('b', null, 'Operations on ' + it.name), el('span', { class: 'spacer' }),
      el('label', { class: 'mode-toggle', title: 'Show steps in the explainer instead of only the answer' }, el('input', { type: 'checkbox', checked: stepsMode || null, onchange: (e) => { stepsMode = e.target.checked; syncSelbar(); } }), ' steps')));
    const others = Ed.matrices().filter((m) => m.id !== it.id);
    const groups = {};
    MX.opList.forEach((op) => { (groups[op.group] = groups[op.group] || []).push(op); });
    for (const [g, list] of Object.entries(groups)) {
      box.append(el('div', { class: 'om-group' }, g));
      list.forEach((op) => {
        const controls = [];
        let firstMatrixUsed = false;
        const getters = op.inputs.map((inp) => {
          const kind = inp.kind || 'matrix';
          if (kind === 'matrix') {
            if (!firstMatrixUsed) { firstMatrixUsed = true; controls.push(el('span', { class: 'om-arg self' }, it.name)); return () => ({ id: it.id }); }
            const s = el('select', { class: 'om-sel', title: inp.name }, others.map((o) => el('option', { value: o.id }, o.name)));
            if (!others.length) s.append(el('option', { value: '' }, '—'));
            // prefer the next selected matrix
            const nxt = Ed.sel.find((id) => id !== it.id && Ed.get(id)?.kind === 'matrix'); if (nxt) s.value = nxt;
            controls.push(s);
            return () => { if (!s.value) throw new Error(`Add another matrix to use for ${inp.name}`); return { id: s.value }; };
          }
          const ti = el('input', { class: 'om-num', value: inp.def || '', title: inp.name, size: 3 });
          controls.push(el('span', { class: 'om-arg' }, inp.name + '='), ti);
          return () => ({ value: ti.value || '0' });
        });
        const go = (mode) => { try { const operands = getters.map((g2) => g2()); Ed.closePopover(); App.runOp(op.key, operands, mode); } catch (e) { Ed.toast(e.message, true); } };
        box.append(el('div', { class: 'om-row' },
          el('button', { class: 'om-name', onclick: () => go(), title: 'Compute and place the result on the scratchpad' }, op.name),
          el('span', { class: 'om-controls' }, controls),
          el('button', { class: 'om-btn', title: 'Compute', onclick: () => go('answer') }, '='),
          el('button', { class: 'om-btn steps', title: 'Explain step by step', onclick: () => go('steps') }, 'steps')));
      });
    }
    Ed.showPopover(anchor, box);
  }

  /* ---------- per-item "more" menu ---------- */
  function copyText(text, what) {
    const done = () => Ed.toast(`Copied ${what}`);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    else fallbackCopy(text, done);
  }
  function fallbackCopy(text, done) { const ta = el('textarea', { style: { position: 'fixed', opacity: 0 } }); ta.value = text; document.body.append(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { Ed.toast('Copy failed', true); } ta.remove(); }
  function moreMenu(it, anchor) {
    const box = el('div', { class: 'menu' });
    const item = (label, fn, cls) => box.append(el('button', { class: 'mi' + (cls ? ' ' + cls : ''), onclick: () => { Ed.closePopover(); try { fn(); } catch (e) { Ed.toast(e.message, true); } } }, label));
    const sep = (t) => box.append(el('div', { class: 'msep' }, t || ''));
    if (it.kind === 'matrix') {
      item('⧉  Duplicate', () => duplicate([it.id]));
      sep('Copy as');
      const A = () => Ed.matrixOf(it);
      item('@MATX  (homework sites)', () => copyText(M.toMATX(A()), 'as @MATX'));
      item('Plain text / spreadsheet', () => copyText(M.toText(A()), 'as text'));
      item('LaTeX (bmatrix)', () => copyText(M.toLatex(A()), 'LaTeX'));
      item('Python / NumPy list', () => copyText(M.toPython(A()), 'Python'));
      item('MATLAB', () => copyText(M.toMatlab(A()), 'MATLAB'));
      sep('Edit');
      item('Transpose in place', () => { Ed.setCells(it, M.transpose(it.cells)); it.tmpRows = []; it.tmpCols = []; Ed.log(it, `${it.name} ← ${it.name}ᵀ`); Ed.refresh(it); Ed.commit(); });
      item('Simplify entries (evaluate)', () => { Ed.setCells(it, M.toStrings(A())); Ed.refresh(it); Ed.commit(); });
      item('Fill with identity', () => { const [m, n] = Ed.dims(it); Ed.setCells(it, Array.from({ length: m }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? '1' : '0')))); Ed.refresh(it); Ed.commit(); });
      item('Fill with random integers', () => { const [m, n] = Ed.dims(it); Ed.setCells(it, Array.from({ length: m }, () => Array.from({ length: n }, () => String(Math.floor(Math.random() * 13) - 6)))); Ed.refresh(it); Ed.commit(); });
      item('Clear all entries', () => { const [m, n] = Ed.dims(it); Ed.setCells(it, Array.from({ length: m }, () => Array.from({ length: n }, () => ''))); Ed.refresh(it); Ed.commit(); });
      item('+ Temporary row', () => Ed.addTemp(it, 'row'));
      item('+ Temporary column', () => Ed.addTemp(it, 'col'));
      item(it.showLog ? 'Hide row-operation history' : 'Show row-operation history', () => { it.showLog = !it.showLog; Ed.refresh(it); Ed.commit(); });
      if (it.caption) item('Remove caption', () => { it.caption = ''; Ed.refresh(it); Ed.commit(); });
    } else {
      item('⧉  Duplicate', () => duplicate([it.id]));
      item('Copy text', () => copyText(it.text, 'text'));
    }
    sep();
    item('Delete', () => { Ed.remove([it.id]); Ed.commit(); }, 'danger');
    Ed.showPopover(anchor, box);
  }

  /* ---------- clipboard (items) ---------- */
  let clip = null; // { text, items }
  const COPY_FORMATS = { matx: ['@MATX (homework sites)', (A) => M.toMATX(A)], text: ['Plain text / spreadsheet', (A) => M.toText(A)], latex: ['LaTeX', (A) => M.toLatex(A)], python: ['Python / NumPy', (A) => M.toPython(A)], matlab: ['MATLAB', (A) => M.toMatlab(A)] };
  App.copyFormat = 'matx';
  /** Text for one matrix in the chosen copy format (falls back to raw cells if an entry is invalid). */
  function matrixText(it, fmt) {
    try { return COPY_FORMATS[fmt || App.copyFormat][1](Ed.matrixOf(it)); }
    catch (e) { return it.cells.map((r) => r.map((s) => s || '0').join('\t')).join('\n'); }
  }
  App.cellsText = (cells) => { try { return COPY_FORMATS[App.copyFormat][1](M.fromStrings(cells.map((r) => r.map((s) => s || '0')))); } catch (e) { return cells.map((r) => r.join('\t')).join('\n'); } };
  function copyItems(ids) {
    const items = ids.map((id) => Ed.get(id)).filter(Boolean).map((i) => JSON.parse(JSON.stringify(i)));
    if (!items.length) return null;
    const text = items.length === 1 && items[0].kind === 'matrix' ? matrixText(Ed.get(items[0].id))
      : items.map((i) => (i.kind === 'matrix' ? `${i.name} = ` + matrixText(Ed.get(i.id)) : i.text || '')).filter(Boolean).join('\n\n') || `[${items.length} drawing item${items.length > 1 ? 's' : ''}]`;
    clip = { text, items };
    return text;
  }
  function pasteItems(items, at) {
    const x0 = Math.min(...items.map((i) => i.x)), y0 = Math.min(...items.map((i) => i.y));
    const groups = {}; items.forEach((i) => { if (i.group) groups[i.group] = groups[i.group] || 'g' + Ed.state.seq++; });
    const base = at || { x: x0 + 32, y: y0 + 32 };
    const ids = [];
    items.forEach((src) => {
      const pos = { x: Math.round(base.x + src.x - x0), y: Math.round(base.y + src.y - y0) };
      let it;
      if (src.kind === 'matrix') {
        it = Ed.addMatrix({ cells: src.cells, x: pos.x, y: pos.y, caption: src.caption, name: src.name });
        it.tmpRows = JSON.parse(JSON.stringify(src.tmpRows || [])); it.tmpCols = JSON.parse(JSON.stringify(src.tmpCols || [])); it.log = []; Ed.refresh(it);
      } else if (src.kind === 'note') it = Ed.addNote({ text: src.text, x: pos.x, y: pos.y, result: src.result });
      else {
        it = JSON.parse(JSON.stringify(src)); it.id = 'i' + Ed.state.seq++; it.x = pos.x; it.y = pos.y;
        if (it.group) it.group = groups[it.group];
        if (it.seed != null) it.seed = (Math.random() * 2 ** 31) | 0;
        Ed.state.items.push(it); Ed.renderItem(it);
      }
      ids.push(it.id);
    });
    Ed.sel = []; ids.forEach((id) => Ed.select(id, 'add'));
    Ed.commit();
  }
  function duplicate(ids) { const t = copyItems(ids); if (t != null) pasteItems(clip.items); }
  App.duplicate = duplicate;
  function pasteText(text, at) {
    if (clip && text && text.trim() === clip.text.trim()) { pasteItems(clip.items, at); return; }
    const P = M.parseText(text);
    if (!P) { Ed.toast(String(text || '').trim() ? 'Could not find numbers in the pasted text' : 'Nothing to paste — copy a matrix or a screenshot of one first', true); return; }
    const pos = at || Ed.freeSpot(null, P[0].length * 50, P.length * 36);
    const it = Ed.addMatrix({ cells: P, x: Math.round(pos.x), y: Math.round(pos.y) });
    Ed.select(it.id); Ed.commit(); flash(it);
    Ed.toast(`Pasted ${P.length}×${P[0].length} matrix as ${it.name}`);
  }
  function pasteModal() {
    const ta = el('textarea', { rows: 6, placeholder: 'Paste a matrix or a screenshot of one here:\n1 2 3\n4 5 6\n\nAlso accepts [[1,2],[3,4]], [1 2; 3 4], LaTeX, or cells copied from a spreadsheet.', spellcheck: 'false', autocapitalize: 'off' });
    openModal('Paste a matrix', el('div', null, ta, el('div', { class: 'modal-actions' },
      el('button', { class: 'tb', onclick: () => { closeModal(); App.readClipboard(); } }, '📋 Paste from clipboard'),
      el('button', { class: 'tb', onclick: () => { closeModal(); App.pickImage(); } }, '📷 Image…'),
      el('button', { class: 'tb primary', onclick: () => { closeModal(); pasteText(ta.value); } }, 'Create matrix'))));
    setTimeout(() => ta.focus(), 50);
  }

  /* ---------- matrix from screenshot / photo ---------- */
  App.importImage = function (file, at) {
    if (file && typeof file.then === 'function') { file.then((b) => App.importImage(b, at), (e) => Ed.toast(e.message, true)); return; }
    if (!file || !/^image\//.test(file.type)) { Ed.toast('That is not an image', true); return; }
    closeModal();
    Ed.closePopover();
    const status = el('div', { class: 'ocr-status' }, 'Reading the image…');
    const bar = el('div', { class: 'ocr-bar' }, el('div'));
    const preview = el('div', { class: 'ocr-preview' });
    const ta = el('textarea', { rows: 4, spellcheck: 'false', autocapitalize: 'off', placeholder: 'Recognised numbers appear here — fix anything that was misread' });
    const warn = el('div', { class: 'ocr-warn' });
    const createBtn = el('button', { class: 'tb primary', disabled: true }, 'Create matrix');
    const img = el('img', { class: 'ocr-img', alt: 'Your screenshot' });
    const refresh = () => {
      preview.innerHTML = ''; warn.textContent = '';
      const P = M.parseText(ta.value);
      createBtn.disabled = !P;
      if (!P) return;
      const bad = [];
      P.forEach((r, i) => r.forEach((s, j) => { if (!Frac.tryParse(s)) bad.push(`row ${i + 1}, col ${j + 1}`); }));
      const raggedNote = ta.value.split('\n').filter((l) => l.trim()).some((l) => M.parseText(l)[0].length !== P[0].length);
      preview.append(MX.renderMatrix(P.map((r) => r.map((s) => s)), {}, `${P.length}×${P[0].length}`));
      warn.textContent = (bad.length ? `Check: ${bad.join('; ')}. ` : '') + (raggedNote ? 'Some rows were shorter and were padded with 0 — check the preview.' : '');
    };
    ta.addEventListener('input', refresh);
    const create = () => {
      const P = M.parseText(ta.value); if (!P) return;
      closeModal();
      const pos = at || Ed.freeSpot(Ed.sel.length ? Ed.get(Ed.sel[Ed.sel.length - 1]) : null, P[0].length * 50, P.length * 36);
      const it = Ed.addMatrix({ cells: P, x: Math.round(pos.x), y: Math.round(pos.y), caption: 'from image' });
      Ed.select(it.id); Ed.commit(); flash(it); requestAnimationFrame(() => Ed.scrollIntoView(it));
      Ed.toast(`Created ${it.name} (${P.length}×${P[0].length})`);
    };
    createBtn.addEventListener('click', create);
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) create(); });
    openModal('Matrix from image', el('div', { class: 'ocr' },
      el('div', { class: 'ocr-top' }, img, el('div', { class: 'ocr-side' }, status, bar, preview)),
      el('label', { class: 'ocr-lbl' }, 'Entries — one row per line (edit freely):'), ta, warn,
      el('div', { class: 'modal-actions' }, el('button', { class: 'tb', onclick: closeModal }, 'Cancel'), el('button', { class: 'tb', title: 'Put the picture itself on the scratchpad instead of reading numbers from it', onclick: () => { closeModal(); MX.Draw.insertImage(file, at); } }, '🖼 Insert as picture'), createBtn)));
    const labels = { 'loading tesseract core': 'Loading the OCR engine', 'initializing tesseract': 'Starting OCR', 'loading language traineddata': 'Loading number recogniser', 'initializing api': 'Starting OCR', 'recognizing text': 'Recognising numbers' };
    MX.OCR.read(file, (m) => {
      status.textContent = (labels[m.status] || m.status) + (m.progress ? ` ${Math.round(m.progress * 100)}%` : '') + '…';
      bar.firstChild.style.width = Math.round((m.progress || 0) * 100) + '%';
    }).then(({ rows, url }) => {
      img.src = url;
      bar.hidden = true;
      const w = rows[0].length;
      const colW = Array.from({ length: w }, (_, j) => Math.max(...rows.map((r) => (r[j] || '?').length)));
      ta.value = rows.map((r) => r.map((s, j) => (s || '?').padStart(colW[j])).join('  ')).join('\n');
      status.textContent = `Found a ${rows.length}×${w} matrix. Check it against the image, then create it.`;
      refresh();
      if (rows.some((r) => r.includes(''))) warn.textContent = 'Some entries could not be read and are marked "?" — please fill them in.';
      ta.focus();
    }).catch((e) => {
      img.src = URL.createObjectURL(file);
      bar.hidden = true;
      status.textContent = '⚠ ' + e.message + ' — you can type the entries below instead.';
      status.classList.add('err');
      ta.focus();
    });
  };
  /** Find an image in a clipboard / drag DataTransfer. Returns a File/Blob, a Promise of one, or null. */
  App.imageFromTransfer = function (dt) {
    if (!dt) return null;
    const f = [...(dt.files || [])].find((x) => /^image\//.test(x.type));
    if (f) return f;
    const it = [...(dt.items || [])].find((i) => i.kind === 'file' && /^image\//.test(i.type));
    if (it) return it.getAsFile();
    // images copied from web pages / docs often arrive only as HTML: <img src="...">
    const html = dt.getData && dt.getData('text/html');
    const m = html && /<img[^>]+src=["']([^"']+)["']/i.exec(html);
    if (m) {
      const src = m[1].replace(/&amp;/g, '&');
      return fetch(src).then((r) => { if (!r.ok) throw new Error(); return r.blob(); })
        .then((b) => { if (!/^image\//.test(b.type)) throw new Error(); return b; })
        .catch(() => { throw new Error('That image is on another website and can’t be read directly. Save it (or take a screenshot of it) and paste or drop that instead.'); });
    }
    return null;
  };
  /** Read the system clipboard on demand (works on phones via the browser's Paste prompt). */
  App.readClipboard = async function (at) {
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const type = item.types.find((t) => /^image\//.test(t));
          if (type) { App.importImage(new File([await item.getType(type)], 'clipboard', { type }), at); return; }
        }
        for (const item of items) if (item.types.includes('text/plain')) { pasteText(await (await item.getType('text/plain')).text(), at); return; }
        Ed.toast('The clipboard is empty', true);
        return;
      }
      if (navigator.clipboard && navigator.clipboard.readText) { pasteText(await navigator.clipboard.readText(), at); return; }
      throw new Error('unsupported');
    } catch (e) {
      Ed.toast('The browser blocked clipboard access — press Ctrl/⌘+V on the paper instead, or use “From a screenshot or photo”.', true);
    }
  };
  App.pickImage = function (at) {
    const inp = el('input', { type: 'file', accept: 'image/*' });
    inp.onchange = () => { if (inp.files[0]) App.importImage(inp.files[0], at); };
    inp.click();
  };

  /* ---------- selection bar ---------- */
  function syncSelbar() {
    const bar = $('selbar');
    const items = Ed.sel.map((id) => Ed.get(id)).filter(Boolean);
    bar.innerHTML = '';
    if (!items.length) { bar.hidden = true; return; }
    bar.hidden = false;
    const mats = items.filter((i) => i.kind === 'matrix');
    const b = (label, title, fn, cls) => el('button', { class: 'sb' + (cls ? ' ' + cls : ''), title, onclick: fn }, label);
    const run = (key, ...ops) => () => App.runOp(key, ops);
    bar.append(el('label', { class: 'mode-toggle', title: 'When on, quick operations open the step-by-step explainer' }, el('input', { type: 'checkbox', checked: stepsMode || null, onchange: (e) => { stepsMode = e.target.checked; syncSelbar(); } }), el('span', null, 'steps')));
    const KIND = { rect: 'rectangle', diamond: 'diamond', ellipse: 'ellipse', arrow: 'arrow', line: 'line', draw: 'drawing' };
    const names = items.length > 3 ? `${items.length} items` : items.map((i) => i.name || (i.kind === 'shape' ? KIND[i.type] : i.kind)).join(', ');
    bar.append(el('span', { class: 'sb-names' }, names));
    if (mats.length === 1 && items.length === 1) {
      const A = mats[0]; const n = A.name; const o = { id: A.id };
      const sq = Ed.dims(A)[0] === Ed.dims(A)[1];
      if (sq) bar.append(b('det', `det(${n})`, run('det', o)), b(n + '⁻¹', 'Inverse', run('inverse', o)));
      bar.append(b(n + 'ᵀ', 'Transpose', run('transpose', o)), b('RREF', 'Reduced row echelon form', run('rref', o)), b('rank', 'Rank', run('rank', o)));
      if (Ed.dims(A)[1] >= 2) bar.append(b('solve [A|b]', `Treat ${n} as an augmented matrix (last column = b) and find the general solution`, run('solveaug', o)));
      if (sq) bar.append(b('eig', 'Eigenvalues & eigenvectors', run('eigvecs', o)));
      bar.append(b('ƒ…', 'All operations', (e) => opsMenu(A, e.currentTarget), 'accent'));
    } else if (mats.length === 2 && items.length === 2) {
      const [A, B] = mats; const a = { id: A.id }, bb = { id: B.id };
      const [m1, n1] = Ed.dims(A), [m2, n2] = Ed.dims(B);
      if (m1 === m2 && n1 === n2) bar.append(b(`${A.name}+${B.name}`, 'Add', run('add', a, bb)), b(`${A.name}−${B.name}`, 'Subtract', run('sub', a, bb)));
      if (n1 === m2) bar.append(b(`${A.name}·${B.name}`, 'Multiply', run('mul', a, bb)));
      if (n2 === m1) bar.append(b(`${B.name}·${A.name}`, 'Multiply', run('mul', bb, a)));
      if (m1 === m2) bar.append(b(`solve ${A.name}x=${B.name}`, `Solve ${A.name}x = ${B.name}`, run('solve', a, bb)));
      bar.append(b('⇄', 'Swap places', () => { [A.x, B.x] = [B.x, A.x]; [A.y, B.y] = [B.y, A.y]; [A, B].forEach((m) => { const e = Ed.els.get(m.id); e.classList.add('animate'); e.style.left = m.x + 'px'; e.style.top = m.y + 'px'; setTimeout(() => e.classList.remove('animate'), 300); }); Ed.commit(); }));
      bar.append(b('ƒ…', 'All operations', (e) => opsMenu(A, e.currentTarget), 'accent'));
    }
    bar.append(el('span', { class: 'sb-sep' }),
      b('⧉', 'Duplicate (Ctrl+D)', () => duplicate(Ed.sel)),
      b('⎘', 'Copy (Ctrl+C)', () => { const t = copyItems(Ed.sel); if (t != null) copyText(t, items.length > 1 ? items.length + ' items' : items[0].name || 'note'); }),
      b('🗑', 'Delete (Del)', () => { Ed.remove(Ed.sel.slice()); Ed.commit(); }, 'danger'),
      b('✕', 'Clear selection (Esc)', () => Ed.clearSelection()));
  }

  /* ---------- modal & app menu ---------- */
  function openModal(title, body) {
    const m = $('modal');
    m.innerHTML = '';
    const card = el('div', { class: 'modal-card' }, el('div', { class: 'modal-head' }, el('h3', null, title), el('button', { class: 'tb icon', onclick: closeModal }, '✕')), body);
    m.append(card); m.hidden = false;
    m.onclick = (e) => { if (e.target === m) closeModal(); };
  }
  function closeModal() {
    const m = $('modal');
    m.querySelectorAll('img[src^="blob:"]').forEach((i) => URL.revokeObjectURL(i.src));
    m.hidden = true; m.innerHTML = '';
  }
  App.help = function () {
    const sec = (t, rows) => el('section', null, el('h4', null, t), el('dl', null, rows.map(([k, v]) => [el('dt', null, k), el('dd', null, v)])));
    openModal('How to use the scratchpad', el('div', { class: 'help' },
      sec('Matrices', [
        ['New', 'Double-click / double-tap empty paper, or press N'],
        ['Edit', 'Type in a cell — fractions (3/4), decimals and arithmetic (1/3+2) all work. Tab moves right; Enter goes to the next row (back to where you started tabbing), and on the last row adds a new one. Backspace in an empty cell steps back through the matrix'],
        ['Resize', 'Drag the corner ◢, or tap the + on the right / bottom edge'],
        ['Paste', 'Paste a block of numbers into any cell to fill (and grow) the matrix, or press Ctrl+V on the paper to create a new one'],
        ['Screenshot', 'Paste a screenshot of a matrix (Ctrl+V), drop an image on the paper, or use + Matrix → From a screenshot or photo. You can check and fix the numbers before it is created'],
        ['Move', 'Drag by the header. Drop it on another matrix to swap their places'],
        ['Select', 'Click a header; Shift-click (or long-press on touch) to select several; drag on empty paper to box-select'],
      ]),
      sec('Rows & columns', [
        ['Row ops', 'Tap R1, R2… to open the row tool. Type R2 - 3R1, *2, /3, swap R1, = 1 2 3, then Enter'],
        ['Reorder', 'Drag an R/C handle to move a row or column'],
        ['Copy a column', 'Tap its C handle → Copy. Then select another matrix and press Ctrl+V to add it as the last column, use "Paste after" in any C/R tool, or Ctrl+V on empty paper for a new matrix. Rows work the same way'],
        ['Temp lines', '+ temp row / col gives scratch space below/right of the matrix. Give it an expression like R1 - 2R2; it updates live. Then write it back into any row'],
        ['History', 'Every row operation is written under the matrix'],
      ]),
      sec('Solving', [
        ['Quick ops', 'Select one or two matrices — the bar at the bottom offers det, inverse, RREF, A·B, solve…'],
        ['All ops', 'ƒ on a matrix lists every operation; "steps" opens the explainer'],
        ['Command bar', 'C = A*B · inv(A) · A^T or A\' · A^-1 · det(A) · rref(A) · solve(A, b) · solveaug(M) · 2A - 3I(3) · [1 2; 3 4] · lu(A) · eig(A)'],
        ['Explainer', 'Press Shift+E. Choose an operation and matrices, then Step by step or Just the answer'],
      ]),
      sec('Drawing (like Excalidraw)', [
        ['Tools', 'Toolbar at the top: hand H · select V/1 · rectangle R/2 · diamond D/3 · ellipse O/4 · arrow A/5 · line L/6 · draw P/7 · text T/8 · image 9 · eraser E/0 · lock Q keeps a tool active'],
        ['Select', 'Drag on empty paper to box-select, Shift-click to add, Ctrl+A for everything, Delete to remove them all'],
        ['Edit', 'Drag handles to resize, the top handle to rotate (Shift snaps), line ends to move them and the middle dot to bend. Double-click text to edit'],
        ['Style', 'The panel on the left sets colour, fill, stroke, sloppiness, arrowheads, fonts, opacity, layer order and alignment'],
        ['Other', 'Ctrl+G group · Ctrl+Shift+G ungroup · Ctrl+] / [ layer order · arrow keys nudge · hold Space (or middle mouse) to pan'],
      ]),
      sec('Keys', [
        ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'], ['Ctrl+C / X / V / D', 'Copy, cut, paste, duplicate selected'], ['Delete', 'Delete selected'], ['Ctrl+scroll / pinch', 'Zoom'], ['Scroll · Space+drag · two fingers', 'Pan'], ['/', 'Focus the command bar'], ['N or M', 'New matrix'], ['Shift+E', 'Explainer'],
      ])));
  };
  function appMenu(anchor) {
    const box = el('div', { class: 'menu' });
    const item = (label, fn, cls) => box.append(el('button', { class: 'mi' + (cls ? ' ' + cls : ''), onclick: () => { Ed.closePopover(); fn(); } }, label));
    const sep = (t) => box.append(el('div', { class: 'msep' }, t || ''));
    item('📋  Paste matrix from text…', pasteModal);
    item('📷  Matrix from screenshot / photo…', () => App.pickImage());
    item('📋  Matrix from clipboard (image or text)', () => App.readClipboard());
    item('🖼  Insert a picture…', () => MX.Draw.pickImage());
    item('⤢  Fit everything in view', Ed.fit);
    sep('Ctrl+C copies matrices as');
    Object.entries(COPY_FORMATS).forEach(([k, [label]]) => item((App.copyFormat === k ? '● ' : '○ ') + label, () => { App.copyFormat = k; savePrefs(); Ed.toast('Ctrl+C now copies matrices as ' + label); }));
    sep('Display');
    item((MX.settings.display === 'frac' ? '● ' : '○ ') + 'Fractions', () => setDisplay('frac'));
    item((MX.settings.display === 'dec' ? '● ' : '○ ') + 'Decimals', () => setDisplay('dec'));
    item('◐  Toggle paper / chalkboard', toggleTheme);
    sep('File');
    item('⬇  Export scratchpad (.json)', exportJSON);
    item('⬆  Import scratchpad…', importJSON);
    item('🧹  Clear everything', () => { if (confirm('Delete every matrix and note on the scratchpad?')) { Ed.remove(Ed.state.items.map((i) => i.id)); Ed.commit(); } }, 'danger');
    sep();
    item('?  Help & shortcuts', App.help);
    Ed.showPopover(anchor, box);
  }
  function setDisplay(mode) { MX.settings.display = mode; savePrefs(); if (X.isOpen() && X.steps.length) X.run(X.mode || 'steps'); Ed.toast(mode === 'frac' ? 'Showing exact fractions in explanations' : 'Showing decimals in explanations'); }
  function toggleTheme() {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme !== 'dark' : !matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'dark' : 'light';
    savePrefs();
  }
  function savePrefs() { try { localStorage.setItem('matrix-scratchpad-prefs', JSON.stringify({ display: MX.settings.display, theme: document.documentElement.dataset.theme || '', copy: App.copyFormat })); } catch (e) { /* ignore */ } }
  function loadPrefs() { try { const p = JSON.parse(localStorage.getItem('matrix-scratchpad-prefs') || '{}'); if (p.display) MX.settings.display = p.display; if (p.theme) document.documentElement.dataset.theme = p.theme; if (p.copy && COPY_FORMATS[p.copy]) App.copyFormat = p.copy; } catch (e) { /* ignore */ } }
  function exportJSON() {
    const blob = new Blob([JSON.stringify({ app: 'matrix-scratchpad', version: 1, items: Ed.state.items, seq: Ed.state.seq }, null, 1)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: 'matrix-scratchpad.json' });
    document.body.append(a); a.click(); a.remove();
  }
  function importJSON() {
    const inp = el('input', { type: 'file', accept: '.json,application/json' });
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      f.text().then((t) => { const d = JSON.parse(t); if (!Array.isArray(d.items)) throw new Error('Not a scratchpad file'); Ed.load(d); Ed.commit(); Ed.fit(); Ed.toast('Imported'); }).catch((e) => Ed.toast(e.message, true));
    };
    inp.click();
  }

  /* ---------- keyboard ---------- */
  const typing = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  function keys(ev) {
    const mod = ev.ctrlKey || ev.metaKey;
    if (ev.key === 'Escape') {
      if (!$('modal').hidden) return closeModal();
      if (Ed.popoverOpen()) return Ed.closePopover();
      if (typing(ev.target)) return;
      if (MX.Draw.tool !== 'select') return MX.Draw.setTool('select');
      if (Ed.sel.length) return Ed.clearSelection();
      if (X.isOpen()) return X.close();
      return;
    }
    if (mod && ev.key.toLowerCase() === 'z' && !typing(ev.target)) { ev.preventDefault(); ev.shiftKey ? Ed.redo() : Ed.undo(); return; }
    if (mod && ev.key.toLowerCase() === 'y' && !typing(ev.target)) { ev.preventDefault(); Ed.redo(); return; }
    if (typing(ev.target)) return;
    if (MX.Draw.handleKey(ev)) return;
    if (mod && ev.key.toLowerCase() === 'd') { ev.preventDefault(); if (Ed.sel.length) duplicate(Ed.sel); return; }
    if (mod && ev.key.toLowerCase() === 'a') { ev.preventDefault(); Ed.sel = []; Ed.state.items.forEach((i) => Ed.select(i.id, 'add')); return; }
    if (mod) return;
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && Ed.sel.length) { ev.preventDefault(); Ed.remove(Ed.sel.slice()); Ed.commit(); return; }
    if (ev.key === 'n' || ev.key === 'N' || ev.key === 'm' || ev.key === 'M') { ev.preventDefault(); App.newMatrixPicker($('btn-new')); return; }
    if (ev.key === 'E' && ev.shiftKey) { ev.preventDefault(); X.toggle(); return; }
    if (ev.key === '/') { ev.preventDefault(); $('cmd').focus(); return; }
    if (ev.key === 'Enter' && Ed.sel.length === 1) { const it = Ed.get(Ed.sel[0]); if (it.kind === 'matrix') { ev.preventDefault(); Ed.focusCell(it, 0, 0); } }
  }

  /* ---------- boot ---------- */
  function seed() {
    Ed.load({ items: [], seq: 1, view: { x: 0, y: 0, z: 1 } });
    const narrow = window.innerWidth < 640;
    const x0 = narrow ? 24 : 80, y0 = narrow ? 30 : 60;
    const A = Ed.addMatrix({ name: 'A', cells: [['2', '1', '-1'], ['-3', '-1', '2'], ['-2', '1', '2']], x: x0, y: y0 });
    Ed.addMatrix({ name: 'b', cells: [['8'], ['-11'], ['-3']], x: x0 + (narrow ? 210 : 260), y: y0 });
    Ed.addMatrix({ name: 'B', cells: [['1', '2'], ['3', '4']], x: x0 + (narrow ? 0 : 400), y: y0 + (narrow ? 230 : 0) });
    Ed.addNote({ text: 'Scratchpad tips ✎\n• tap R1/C1 handles for row & column ops\n• "+ temp row" for side calculations\n• select A then b → "solve Ax=b"\n• ƒ on a matrix → every operation, with steps\n• double-tap the paper for a new matrix\n• paste a screenshot of a matrix to import it\n• draw & annotate with the toolbar (R, O, A, P, T…)', x: x0 + (narrow ? 0 : 400), y: y0 + (narrow ? 380 : 170) });
    Ed.state.view = { x: 0, y: 0, z: narrow ? 0.9 : 1 };
    Ed.commit(); Ed.applyView();
    void A;
  }

  function boot() {
    loadPrefs();
    Ed.init($('stage'), $('world'));
    MX.Draw.init();
    X.init();
    if (!Ed.restore()) seed();
    Ed.applyView();
    Ed.on('selection', syncSelbar);
    Ed.on('change', syncSelbar);
    Ed.on('ops', opsMenu);
    Ed.on('more', moreMenu);
    Ed.on('dbltap', (cx, cy) => { const w = Ed.toWorld(cx, cy); App.newMatrixPicker({ getBoundingClientRect: () => ({ left: cx, right: cx, top: cy, bottom: cy }) }, { x: w.x - 20, y: w.y - 16 }); });
    Ed.on('view', () => { $('zoom-reset').textContent = Math.round(Ed.state.view.z * 100) + '%'; });
    $('zoom-reset').textContent = Math.round(Ed.state.view.z * 100) + '%';
    syncSelbar();

    $('btn-new').addEventListener('click', (e) => App.newMatrixPicker(e.currentTarget));
    $('btn-note').addEventListener('click', () => { const p = Ed.freeSpot(null, 200, 80); const it = Ed.addNote({ text: '', x: p.x, y: p.y }); Ed.select(it.id); Ed.els.get(it.id).querySelector('.note-body').focus(); });
    $('btn-undo').addEventListener('click', Ed.undo);
    $('btn-redo').addEventListener('click', Ed.redo);
    $('btn-explain').addEventListener('click', () => {
      if (X.isOpen()) return X.close();
      const mats = Ed.sel.map(Ed.get).filter((i) => i && i.kind === 'matrix');
      if (mats.length) {
        const [mr, nc] = Ed.dims(mats[0]);
        const op = mats.length >= 2 ? 'mul' : mr === nc ? 'det' : nc > mr ? 'solveaug' : 'rref';
        X.open({ op, operands: mats.map((m) => ({ id: m.id })) });
      } else X.open();
    });
    $('btn-menu').addEventListener('click', (e) => appMenu(e.currentTarget));
    $('zoom-in').addEventListener('click', () => { const r = $('stage').getBoundingClientRect(); Ed.zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.2); });
    $('zoom-out').addEventListener('click', () => { const r = $('stage').getBoundingClientRect(); Ed.zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.2); });
    $('zoom-reset').addEventListener('click', () => { const r = $('stage').getBoundingClientRect(); Ed.zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / Ed.state.view.z); });
    $('zoom-fit').addEventListener('click', Ed.fit);

    const cmd = $('cmd');
    cmd.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') runCommand(cmd.value);
      else if (e.key === 'ArrowUp' && hist.length) { hIdx = Math.max(0, hIdx - 1); cmd.value = hist[hIdx]; e.preventDefault(); }
      else if (e.key === 'ArrowDown' && hist.length) { hIdx = Math.min(hist.length, hIdx + 1); cmd.value = hist[hIdx] || ''; e.preventDefault(); }
      else if (e.key === 'Escape') cmd.blur();
    });

    document.addEventListener('keydown', keys);
    document.addEventListener('pointerdown', (e) => {
      const pop = $('popover');
      if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.rh, .ch, .hb, .corner, #btn-new, #btn-menu, .sb.accent')) Ed.closePopover();
    }, true);
    document.addEventListener('copy', (e) => {
      if (typing(e.target) || !Ed.sel.length || (window.getSelection() && String(window.getSelection()))) return;
      const t = copyItems(Ed.sel); if (t == null) return;
      e.clipboardData.setData('text/plain', t); e.preventDefault(); Ed.toast(Ed.sel.length === 1 && Ed.get(Ed.sel[0]).kind === 'matrix' ? 'Copied ' + t.slice(0, 60) : 'Copied');
    });
    document.addEventListener('cut', (e) => {
      if (typing(e.target) || !Ed.sel.length) return;
      const t = copyItems(Ed.sel); if (t == null) return;
      e.clipboardData.setData('text/plain', t); e.preventDefault(); Ed.remove(Ed.sel.slice()); Ed.commit();
    });
    document.addEventListener('paste', (e) => {
      if (e.target.closest && e.target.closest('.ocr')) return; // editing the recognised numbers
      const img = App.imageFromTransfer(e.clipboardData);
      if (img) { e.preventDefault(); App.importImage(img, Ed.lastPointerWorld && insideStage() ? Ed.lastPointerWorld : null); return; }
      if (typing(e.target)) return;
      e.preventDefault();
      const text = e.clipboardData.getData('text/plain');
      // a copied row/column + one selected matrix → add it to the end of that matrix
      const target = Ed.sel.length === 1 && Ed.get(Ed.sel[0]);
      if (Ed.lineClip && text.trim() === Ed.lineClip.text.trim() && target && target.kind === 'matrix') {
        const len = Ed.lineClip.lines[0].length, k = Ed.lineClip.lines.length;
        const type = Ed.lineClip.type === 'col' ? (len === Ed.dims(target)[0] ? 'col' : 'row') : (len === Ed.dims(target)[1] ? 'row' : 'col');
        try { Ed.pasteLine(target, type); Ed.toast(`Added as the last ${k > 1 ? k + ' ' : ''}${type === 'col' ? 'column' : 'row'}${k > 1 ? 's' : ''} of ${target.name} (Ctrl+Z to undo)`); } catch (err) { Ed.toast(err.message, true); }
        return;
      }
      pasteText(text, Ed.lastPointerWorld && insideStage() ? Ed.lastPointerWorld : null);
    });
    function insideStage() { const p = Ed.lastPointerWorld; const v = Ed.state.view; const r = $('stage').getBoundingClientRect(); const sx = p.x * v.z + v.x, sy = p.y * v.z + v.y; return sx > 0 && sy > 0 && sx < r.width && sy < r.height; }
    const stageEl = $('stage');
    stageEl.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); stageEl.classList.add('drop-on'); } });
    stageEl.addEventListener('dragleave', () => stageEl.classList.remove('drop-on'));
    stageEl.addEventListener('drop', (e) => {
      stageEl.classList.remove('drop-on');
      const f = App.imageFromTransfer(e.dataTransfer);
      if (f) { e.preventDefault(); App.importImage(f, Ed.toWorld(e.clientX, e.clientY)); return; }
      const t = e.dataTransfer.getData('text/plain');
      if (t) { e.preventDefault(); pasteText(t, Ed.toWorld(e.clientX, e.clientY)); }
    });
    window.addEventListener('resize', () => Ed.closePopover());
    window.addEventListener('beforeunload', () => { Ed.commit(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
