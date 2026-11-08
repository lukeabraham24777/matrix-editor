/* Step-by-step explainer panel. */
(function (G) {
  'use strict';
  const MX = G.MX;
  const { M, el } = MX;
  const Ed = MX.Ed;

  const X = (MX.Explainer = { op: 'mul', inputs: {}, opts: {}, steps: [], idx: 0, result: null, error: null, mode: null });
  let panel, opSel, inputsBox, optsBox, out;

  X.init = function () {
    panel = document.getElementById('explainer');
    opSel = document.getElementById('ex-op');
    inputsBox = document.getElementById('ex-inputs');
    optsBox = document.getElementById('ex-options');
    out = document.getElementById('ex-out');
    const groups = {};
    MX.opList.forEach((op) => { (groups[op.group] = groups[op.group] || []).push(op); });
    for (const [g, list] of Object.entries(groups)) opSel.append(el('optgroup', { label: g }, list.map((op) => el('option', { value: op.key }, op.name))));
    opSel.value = X.op;
    opSel.addEventListener('change', () => { X.op = opSel.value; X.opts = {}; buildForm(); clearOut(); });
    document.getElementById('ex-steps').addEventListener('click', () => X.run('steps'));
    document.getElementById('ex-answer').addEventListener('click', () => X.run('answer'));
    document.getElementById('ex-close').addEventListener('click', X.close);
    document.getElementById('ex-wide').addEventListener('click', () => { panel.classList.toggle('wide'); panel.style.width = ''; document.documentElement.style.setProperty('--exw', panel.classList.contains('wide') ? Math.min(980, window.innerWidth - 120) + 'px' : '460px'); });
    // resize
    const rz = document.getElementById('ex-resize');
    rz.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const sx = ev.clientX, w0 = panel.offsetWidth;
      const mv = (e) => { document.documentElement.style.setProperty('--exw', Math.min(window.innerWidth - 80, Math.max(320, w0 + sx - e.clientX)) + 'px'); panel.classList.remove('wide'); };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
    panel.addEventListener('keydown', (ev) => {
      if (/INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
      if (ev.key === 'ArrowRight') { X.next(); ev.preventDefault(); }
      if (ev.key === 'ArrowLeft') { X.prev(); ev.preventDefault(); }
    });
    Ed.on('change', () => { if (!panel.hidden) refreshPickers(); });
    buildForm();
    clearOut();
  };
  X.isOpen = () => !panel.hidden;
  X.toggle = () => (X.isOpen() ? X.close() : X.open());
  X.open = function (cfg) {
    panel.hidden = false;
    Ed.closePopover();
    document.body.classList.add('ex-open');
    if (cfg) {
      if (cfg.op) { X.op = cfg.op; opSel.value = cfg.op; X.opts = cfg.opts || {}; }
      X.inputs = {};
      const op = MX.ops[X.op];
      (cfg.operands || []).forEach((o, i) => { if (op.inputs[i]) X.inputs[i] = o; });
      buildForm();
      if (cfg.run) X.run(cfg.run); else clearOut();
    } else refreshPickers();
  };
  X.close = function () { panel.hidden = true; document.body.classList.remove('ex-open'); };

  function matrixChoices() { return Ed.matrices(); }
  function buildForm() {
    const op = MX.ops[X.op];
    inputsBox.innerHTML = '';
    const mats = matrixChoices();
    let mi = 0;
    op.inputs.forEach((inp, i) => {
      const kind = inp.kind || 'matrix';
      const row = el('div', { class: 'ex-row' }, el('span', null, inp.name + (inp.hint ? ` (${inp.hint})` : '')));
      if (kind === 'matrix') {
        let cur = X.inputs[i];
        if (!cur) { const m = mats[mi++]; cur = X.inputs[i] = m ? { id: m.id } : { text: '' }; }
        const sel = el('select', { class: 'ex-pick', 'data-i': i });
        const ta = el('textarea', { class: 'ex-text', rows: 3, placeholder: 'Type or paste, e.g.\n1 2\n3 4', spellcheck: 'false', autocapitalize: 'off' });
        const fill = () => {
          sel.innerHTML = '';
          matrixChoices().forEach((m) => sel.append(el('option', { value: m.id }, `${m.name}  (${Ed.dims(m).join('×')})`)));
          sel.append(el('option', { value: '__text' }, '✎ type a matrix…'));
          if (X.inputs[i].id && Ed.get(X.inputs[i].id)) sel.value = X.inputs[i].id; else { sel.value = '__text'; X.inputs[i] = { text: X.inputs[i].text || '' }; }
          ta.hidden = sel.value !== '__text';
          ta.value = X.inputs[i].text || '';
        };
        sel._fill = fill;
        fill();
        sel.addEventListener('change', () => { X.inputs[i] = sel.value === '__text' ? { text: ta.value } : { id: sel.value }; ta.hidden = sel.value !== '__text'; if (!ta.hidden) ta.focus(); });
        ta.addEventListener('input', () => { X.inputs[i] = { text: ta.value }; });
        row.append(el('div', { class: 'ex-field' }, sel, ta));
      } else {
        if (!X.inputs[i]) X.inputs[i] = { value: inp.def || '' };
        const ti = el('input', { class: 'ex-scalar', value: X.inputs[i].value, inputmode: 'text', autocomplete: 'off' });
        ti.addEventListener('input', () => { X.inputs[i] = { value: ti.value }; });
        row.append(el('div', { class: 'ex-field' }, ti));
      }
      inputsBox.append(row);
    });
    optsBox.innerHTML = '';
    (op.options || []).forEach((o) => {
      const s = el('select', null, o.choices.map(([v, l]) => el('option', { value: v }, l)));
      if (X.opts[o.key]) s.value = X.opts[o.key]; else X.opts[o.key] = s.value;
      s.addEventListener('change', () => { X.opts[o.key] = s.value; });
      optsBox.append(el('label', { class: 'ex-row' }, el('span', null, o.label), s));
    });
  }
  function refreshPickers() { inputsBox.querySelectorAll('.ex-pick').forEach((s) => s._fill && s._fill()); }

  function gatherArgs() {
    const op = MX.ops[X.op];
    const names = [];
    const args = op.inputs.map((inp, i) => {
      const kind = inp.kind || 'matrix';
      const v = X.inputs[i] || {};
      if (kind === 'matrix') {
        if (v.id) { const it = Ed.get(v.id); if (!it) throw new Error(`Pick a matrix for ${inp.name}`); names.push(it.name); return Ed.matrixOf(it); }
        const P = M.parseText(v.text || '');
        if (!P) throw new Error(`Enter a matrix for ${inp.name}`);
        names.push(inp.name);
        return M.fromStrings(P);
      }
      const x = MX.Frac.parse(v.value || '0');
      names.push(x.toString());
      if (kind === 'int') { if (!x.isInt()) throw new Error(`${inp.name} must be a whole number`); return Number(x.n); }
      return x;
    });
    return { args, names };
  }

  X.run = function (mode) {
    X.mode = mode;
    let r;
    try {
      const { args, names } = gatherArgs();
      X.names = names;
      r = MX.run(X.op, args, X.opts, true);
    } catch (e) { r = { error: e.message, steps: [] }; }
    X.steps = r.steps; X.result = r.result || null; X.error = r.error || null;
    X.idx = mode === 'answer' ? X.steps.length - 1 : 0;
    X.showAll = false;
    renderOut();
    if (window.innerWidth < 760) out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  X.next = () => { if (X.idx < X.steps.length - 1) { X.idx++; renderOut(true); } };
  X.prev = () => { if (X.idx > 0) { X.idx--; renderOut(); } };

  function clearOut() {
    out.innerHTML = '';
    const op = MX.ops[X.op];
    out.append(el('div', { class: 'ex-empty' },
      el('div', { class: 'ex-empty-title' }, op.name),
      el('p', null, 'Choose the input matri' + (op.inputs.length > 1 ? 'ces' : 'x') + ' — pick one from your scratchpad or type one in — then press ', el('b', null, 'Step by step'), ' to walk through the method, or ', el('b', null, 'Just the answer'), '.'),
      el('p', { class: 'muted' }, 'Everything is computed with exact fractions, so you see 1/3 rather than 0.3333.')));
  }

  function stepCard(s, i, current) {
    const card = el('div', { class: 'step' + (current ? ' current' : '') });
    card.append(el('div', { class: 'step-title' }, el('span', { class: 'step-no' }, i + 1), s.title));
    if (s.op) card.append(el('div', { class: 'step-op' }, s.op));
    if (s.text) card.append(el('div', { class: 'step-text' }, s.text));
    if (s.eq) card.append(el('pre', { class: 'step-eq' }, s.eq));
    if (s.mats && s.mats.length) card.append(el('div', { class: 'step-mats' }, s.mats.map((m) => MX.renderMatrix(m.M, m.hl, m.label))));
    return card;
  }

  function renderOut(scrollToCurrent) {
    out.innerHTML = '';
    const total = X.steps.length;
    const answerMode = X.mode === 'answer';
    if (!answerMode && total) {
      const nav = el('div', { class: 'ex-nav' },
        el('button', { class: 'tb', disabled: X.idx === 0 || X.showAll, onclick: X.prev, title: 'Previous step (←)' }, '◀'),
        el('span', { class: 'ex-count' }, X.showAll ? `All ${total} steps` : `Step ${X.idx + 1} / ${total}`),
        el('button', { class: 'tb primary', disabled: X.idx >= total - 1 || X.showAll, onclick: X.next, title: 'Next step (→)' }, 'Next ▶'),
        el('span', { class: 'spacer' }),
        el('button', { class: 'tb small', onclick: () => { X.showAll = !X.showAll; if (X.showAll) X.idx = total - 1; renderOut(); } }, X.showAll ? 'One at a time' : 'Show all'),
        el('button', { class: 'tb small', onclick: () => { X.idx = total - 1; renderOut(true); } }, 'Jump to end'));
      out.append(nav);
      const progress = el('div', { class: 'ex-progress' }, el('div', { style: { width: ((X.idx + 1) / total) * 100 + '%' } }));
      out.append(progress);
    }
    const list = el('div', { class: 'steps' });
    if (!answerMode) {
      const upto = X.showAll ? total - 1 : X.idx;
      for (let i = 0; i <= upto && i < total; i++) list.append(stepCard(X.steps[i], i, i === upto && !X.showAll));
    }
    out.append(list);
    const finished = answerMode || X.idx >= total - 1 || !total;
    if (X.error && finished) out.append(el('div', { class: 'ex-error' }, '⚠ ', X.error));
    if (X.result && finished) {
      const box = el('div', { class: 'ex-final' }, el('div', { class: 'ex-final-title' }, 'Answer'));
      box.append(MX.renderResult(X.result, (item) => MX.App.insertResultItem(item, MX.App.caption(X.op, X.names || []))));
      if (answerMode && total) box.append(el('button', { class: 'tb small', onclick: () => { X.mode = 'steps'; X.idx = 0; renderOut(); } }, 'Show the steps'));
      out.append(box);
    }
    if (scrollToCurrent) {
      const cur = out.querySelector('.step.current') || out.querySelector('.ex-final');
      if (cur) cur.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
})(window);
