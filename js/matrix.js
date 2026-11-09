/* Matrix helpers on arrays of Frac. */
(function (G) {
  'use strict';
  const MX = G.MX;
  const { Frac } = MX;
  const Z = () => Frac.ZERO, O = () => Frac.ONE;

  const M = (MX.M = {});
  M.zeros = (m, n) => Array.from({ length: m }, () => Array.from({ length: n }, Z));
  M.identity = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? O() : Z())));
  M.clone = (A) => A.map((r) => r.slice());
  M.rows = (A) => A.length;
  M.cols = (A) => (A.length ? A[0].length : 0);
  M.dimStr = (A) => M.rows(A) + '×' + M.cols(A);
  M.isSquare = (A) => M.rows(A) === M.cols(A);
  M.transpose = (A) => (A.length ? A[0].map((_, j) => A.map((r) => r[j])) : []);
  M.add = (A, B) => A.map((r, i) => r.map((x, j) => x.add(B[i][j])));
  M.sub = (A, B) => A.map((r, i) => r.map((x, j) => x.sub(B[i][j])));
  M.scale = (A, k) => A.map((r) => r.map((x) => x.mul(k)));
  M.mul = (A, B) => {
    const m = M.rows(A), n = M.cols(A), p = M.cols(B);
    if (n !== M.rows(B)) throw new Error(`Cannot multiply ${M.dimStr(A)} by ${M.dimStr(B)}: inner dimensions differ`);
    const C = M.zeros(m, p);
    for (let i = 0; i < m; i++) for (let j = 0; j < p; j++) {
      let s = Frac.ZERO;
      for (let k = 0; k < n; k++) s = s.add(A[i][k].mul(B[k][j]));
      C[i][j] = s;
    }
    return C;
  };
  M.eq = (A, B) => M.rows(A) === M.rows(B) && M.cols(A) === M.cols(B) && A.every((r, i) => r.every((x, j) => x.eq(B[i][j])));
  M.isZeroRow = (r) => r.every((x) => x.isZero());
  M.col = (A, j) => A.map((r) => [r[j]]);
  M.hstack = (A, B) => A.map((r, i) => r.concat(B[i]));
  M.vstack = (A, B) => A.concat(B);
  M.trace = (A) => A.reduce((s, r, i) => s.add(r[i]), Frac.ZERO);
  M.toNum = (A) => A.map((r) => r.map((x) => (x instanceof Frac ? x.toNumber() : Number(x))));
  M.fromNum = (A) => A.map((r) => r.map((x) => Frac.fromNumber(Math.abs(x) < 1e-12 ? 0 : x, 10)));
  M.dot = (u, v) => u.reduce((s, x, i) => s.add(x.mul(v[i])), Frac.ZERO);

  /** Parse an array of string rows (from the editor) into Frac. Throws with cell position. */
  M.fromStrings = (cells) => cells.map((r, i) => r.map((s, j) => {
    try { return Frac.parse(s); } catch (e) { throw new Error(`Invalid entry "${s}" at row ${i + 1}, column ${j + 1}`); }
  }));
  M.toStrings = (A) => A.map((r) => r.map((x) => MX.fmt(x, 'frac')));

  /** Parse free-form text (TSV/CSV/spaces, MATLAB `;`, JSON/numpy, LaTeX) into string[][] or null. */
  M.parseText = (text) => {
    if (text == null) return null;
    let t = String(text).trim();
    if (!t) return null;
    // homework-site format @MATX{{1,2};{3,4}}
    const mx = /^@MATX\s*\{(.*)\}$/s.exec(t);
    if (mx) {
      const rows = mx[1].split(/\}\s*;\s*\{/).map((r) => r.replace(/^\s*\{|\}\s*$/g, '').split(',').map((c) => c.trim()));
      return normalize(rows);
    }
    // LaTeX
    if (/\\begin\{[bpvBV]?matrix\}|\\\\|&/.test(t)) {
      t = t.replace(/\\(begin|end)\{[a-zA-Z*]*\}/g, '').replace(/\\left|\\right|[[\]()]/g, '');
      t = t.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)').replace(/\\cdot/g, '*');
      const rows = t.split(/\\\\|\n/).map((r) => r.trim()).filter(Boolean).map((r) => r.split('&').map((c) => c.trim()));
      return normalize(rows);
    }
    // JSON / numpy style [[1,2],[3,4]]
    if (/^\s*(np\.array\(|Matrix\(|array\()?\s*\[\s*\[/.test(t)) {
      const inner = t.replace(/^[^[]*/, '').replace(/[^\]]*$/, '');
      const rows = [];
      const re = /\[([^[\]]*)\]/g;
      let m;
      while ((m = re.exec(inner))) rows.push(m[1].split(',').map((c) => c.trim()).filter((c) => c !== ''));
      return normalize(rows);
    }
    // MATLAB [1 2; 3 4]
    t = t.replace(/^\[|\]$/g, '').trim();
    let rows = t.includes(';') && !t.includes('\n') ? t.split(';') : t.split(/\r?\n/);
    rows = rows.map((r) => r.trim()).filter(Boolean).map((r) => {
      if (r.includes('\t')) return r.split('\t').map((c) => c.trim());
      if (r.includes(',')) return r.split(',').map((c) => c.trim());
      return splitSpaces(r);
    });
    return normalize(rows);
  };
  function splitSpaces(r) {
    // split on whitespace but keep things like "1 / 2" or "-3" sane
    return r.replace(/\s*\/\s*/g, '/').split(/\s+/).filter(Boolean);
  }
  function normalize(rows) {
    rows = rows.filter((r) => r.length);
    if (!rows.length) return null;
    const n = Math.max(...rows.map((r) => r.length));
    return rows.map((r) => { const c = r.slice(); while (c.length < n) c.push('0'); return c; });
  }

  M.toText = (A, sep = '\t') => A.map((r) => r.map((x) => MX.fmt(x)).join(sep)).join('\n');
  M.toLatex = (A) => '\\begin{bmatrix}\n' + A.map((r) => r.map((x) => (x instanceof Frac ? x.toLatex() : MX.fmt(x))).join(' & ')).join(' \\\\\n') + '\n\\end{bmatrix}';
  M.toPython = (A) => '[' + A.map((r) => '[' + r.map((x) => (x instanceof Frac && !x.isInt() ? x.toNumber() : MX.fmt(x))).join(', ') + ']').join(', ') + ']';
  /** Homework-site format: @MATX{{1,2};{3,4}} (rows in braces separated by ';', entries by ','). */
  M.toMATX = (A) => '@MATX{' + A.map((r) => '{' + r.map((x) => MX.fmt(x, 'frac')).join(',') + '}').join(';') + '}';
  M.toMatlab = (A) => '[' + A.map((r) => r.map((x) => MX.fmt(x)).join(' ')).join('; ') + ']';
})(typeof window !== 'undefined' ? window : globalThis);
