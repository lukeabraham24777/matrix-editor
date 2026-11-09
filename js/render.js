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
    return wrap;
  };
})(window);
