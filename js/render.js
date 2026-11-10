/* DOM helpers and read-only matrix rendering (used by the explainer and results). */
(function (G) {
  'use strict';
  const MX = G.MX;

  MX.el = function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    return e;
  };
  const el = MX.el;

  MX.renderMatrix = function (A, hl = {}, label) {
    const m = A.length, n = m ? A[0].length : 0;
    const has = (list, i) => list && list.includes(i);
    const cellIn = (list, i, j) => list && list.some((p) => p[0] === i && p[1] === j);
    const grid = el('div', { class: 'mgrid', style: { gridTemplateColumns: `repeat(${n}, auto)` } });
    for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) {
      const cls = ['mc'];
      if (has(hl.rows, i)) cls.push('hl-row');
      if (has(hl.src, i)) cls.push('hl-src');
      if (has(hl.cols, j)) cls.push('hl-col');
      if (cellIn(hl.cells, i, j)) cls.push('hl-cell');
      if ((hl.pivot && hl.pivot[0] === i && hl.pivot[1] === j) || cellIn(hl.pivots, i, j)) cls.push('piv');
      if (hl.diag && i === j) cls.push('diag');
      if (hl.aug != null && j === hl.aug) cls.push('aug');
      if (hl.strikeRow === i || hl.strikeCol === j) cls.push('strike');
      const v = A[i][j];
      const s = MX.fmt(v);
      grid.append(el('div', { class: cls.join(' ') + (s.length > 14 ? ' long' : ''), title: typeof v === 'number' ? String(v) : null }, s === '' ? ' ' : s));
    }
    const fig = el('figure', { class: 'mview' + (m === 0 ? ' empty' : '') });
    if (label) fig.append(el('figcaption', null, label));
    fig.append(el('div', { class: 'mbr' }, grid));
    return fig;
  };

  /**
   * "Plug in values": pick numbers for the free parameters and see the resulting solution.
   * param: { names, free, xp, basis, A, b } (Frac arrays)
   */
  MX.renderPlugIn = function (param, onInsert) {
    const { Frac } = MX;
    const n = param.xp.length;
    const box = el('div', { class: 'plugin' });
    const inputs = param.names.map((nm, t) => el('input', { class: 'plugin-in', value: t === 0 ? '1' : '0', 'aria-label': nm, inputmode: 'text', autocomplete: 'off', spellcheck: 'false' }));
    const out = el('div', { class: 'plugin-out' });
    const msg = el('div', { class: 'plugin-msg' });
    let current = null;
    const compute = () => {
      out.innerHTML = ''; msg.textContent = ''; msg.className = 'plugin-msg'; current = null;
      let vals;
      try { vals = inputs.map((i, t) => { try { return Frac.parse(i.value.trim() || '0'); } catch (e) { throw new Error(`"${i.value}" is not a number (${param.names[t]})`); } }); }
      catch (e) { msg.textContent = e.message; msg.classList.add('err'); return; }
      const x = param.xp.slice();
      vals.forEach((v, t) => { param.basis[t].forEach((bi, i) => { x[i] = x[i].add(v.mul(bi)); }); });
      current = x;
      const lines = x.map((xi, i) => {
        const fi = param.free.indexOf(i);
        return el('div', { class: 'plugin-line' + (fi >= 0 ? ' free' : '') }, `x${MX.sub(i + 1)} = ${MX.fmt(xi)}`, fi >= 0 ? el('span', { class: 'muted' }, `  (= ${param.names[fi]})`) : null);
      });
      out.append(el('div', { class: 'plugin-lines' }, lines), MX.renderMatrix(x.map((v) => [v]), {}, 'x'));
      // verify A x = b
      const ok = param.A.every((row, i) => row.reduce((s, a, j) => s.add(a.mul(x[j])), Frac.ZERO).eq(param.b[i]));
      msg.textContent = ok ? '✓ This x satisfies every equation (Ax = b)' : '✗ check failed';
      msg.classList.add(ok ? 'ok' : 'err');
    };
    inputs.forEach((i) => i.addEventListener('input', compute));
    const acts = el('div', { class: 'res-actions' });
    if (MX.App && MX.App.copyResult) acts.append(el('button', { class: 'tb small', onclick: () => current && MX.App.copyResult({ kind: 'matrix', M: current.map((v) => [v]) }) }, '⎘ Copy x'));
    if (onInsert) acts.append(el('button', { class: 'tb small', onclick: () => current && onInsert({ kind: 'matrix', label: 'x', M: current.map((v) => [v]) }) }, '＋ to scratchpad'));
    box.append(
      el('div', { class: 'plugin-title' }, 'Plug in values for the free variable' + (param.names.length > 1 ? 's' : '')),
      el('div', { class: 'plugin-row' }, param.names.map((nm, t) => el('label', { class: 'plugin-param' }, el('span', null, `${nm} = `), inputs[t], el('span', { class: 'muted' }, ` (x${MX.sub(param.free[t] + 1)})`)))),
      out, msg, acts);
    compute();
    return box;
  };

  /** Render an operation result (matrix/scalar/text/multi). onInsert(item) adds it to the workspace. */
  MX.renderResult = function (res, onInsert) {
    const wrap = el('div', { class: 'result' });
    const items = res.kind === 'multi' ? res.items : [res];
    for (const it of items) {
      const box = el('div', { class: 'res-item' });
      if (it.kind === 'matrix') box.append(MX.renderMatrix(it.M, {}, it.label));
      else if (it.kind === 'scalar') box.append(el('div', { class: 'res-scalar' }, el('span', { class: 'res-lbl' }, (it.label || '') + ' = '), MX.fmt(it.v)));
      else box.append(el('pre', { class: 'res-text' }, it.text));
      const acts = el('div', { class: 'res-actions' });
      if (MX.App && MX.App.copyResult) acts.append(el('button', { class: 'tb small', title: 'Copy this answer (uses your copy format, e.g. @MATX)', onclick: () => MX.App.copyResult(it) }, '⎘ Copy'));
      if (onInsert) acts.append(el('button', { class: 'tb small', title: 'Add to the workspace', onclick: () => onInsert(it) }, '＋ to scratchpad'));
      box.append(acts);
      wrap.append(box);
    }
    if (res.param && res.param.names.length) wrap.append(MX.renderPlugIn(res.param, onInsert));
    return wrap;
  };
})(window);
