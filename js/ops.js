/* Linear-algebra operations that produce a result plus explanatory steps. */
(function (G) {
  'use strict';
  const MX = G.MX;
  const { Frac, M } = MX;
  const ZERO = Frac.ZERO, ONE = Frac.ONE;
  const f = (x) => MX.fmt(x);
  const SUB = '₀₁₂₃₄₅₆₇₈₉';
  const sub = (n) => String(n).split('').map((d) => SUB[+d] || d).join('');
  MX.sub = sub;
  /** Coefficient for use in "c·R1" – parenthesise fractions/negatives. */
  const cf = (x) => { const s = f(x); return /[/\s]/.test(s) || s.startsWith('-') ? '(' + s + ')' : s; };
  /** Show a value inside a product, parenthesising negatives. */
  const pv = (x) => { const s = f(x); return s.startsWith('-') || s.includes('/') ? '(' + s + ')' : s; };

  class Steps {
    constructor(enabled = true) { this.list = []; this.enabled = enabled; }
    add(title, o = {}) { if (this.enabled) this.list.push({ title, text: o.text || '', op: o.op || '', mats: o.mats || [], eq: o.eq || '' }); return this; }
  }
  const snap = (label, A, hl) => ({ label, M: M.clone(A), hl: hl || {} });
  MX.Steps = Steps;

  const ops = (MX.ops = {});
  const opList = (MX.opList = []);
  function def(key, spec) { spec.key = key; spec.inputs = spec.inputs || [{ name: 'A' }]; ops[key] = spec; opList.push(spec); }

  function need(cond, msg) { if (!cond) throw new Error(msg); }
  const square = (A, what) => need(M.isSquare(A), `${what} needs a square matrix, but this one is ${M.dimStr(A)}.`);

  /* ---------------- Row reduction core ---------------- */
  function rowOpText(i, fac, r) {
    // R_i ← R_i − fac·R_r
    const s = fac.sign();
    const a = fac.abs();
    return `R${i + 1} ← R${i + 1} ${s > 0 ? '−' : '+'} ${a.isOne() ? '' : cf(a) + '·'}R${r + 1}`;
  }
  /**
   * Gaussian / Gauss-Jordan elimination.
   * o: { reduced, normalize, stopCol, S, label, aug }
   */
  function gauss(A, o = {}) {
    const R = M.clone(A);
    const m = M.rows(R), n = M.cols(R);
    const lim = o.stopCol == null ? n : o.stopCol;
    const S = o.S || new Steps(false);
    const label = o.label || '';
    const base = o.aug != null ? { aug: o.aug } : {};
    const sn = (hl) => snap(label, R, Object.assign({}, base, hl));
    let r = 0, swaps = 0, scale = ONE;
    const pivots = [];
    for (let c = 0; c < lim && r < m; c++) {
      let p = -1;
      if (!R[r][c].isZero()) p = r;
      else {
        for (let i = r + 1; i < m; i++) if (!R[i][c].isZero()) { if (p < 0) p = i; if (o.normalize && R[i][c].abs().isOne()) { p = i; break; } }
      }
      if (p < 0) {
        S.add(`Column ${c + 1} has no pivot`, { text: `Every entry of column ${c + 1} from row ${r + 1} down is 0, so there is no pivot here (this column corresponds to a free variable). Move on to the next column.`, mats: [sn({ cols: [c] })] });
        continue;
      }
      if (p !== r) {
        const tmp = R[r]; R[r] = R[p]; R[p] = tmp; swaps++;
        S.add('Swap rows to get a nonzero pivot', { op: `R${r + 1} ↔ R${p + 1}`, text: `The entry in row ${r + 1}, column ${c + 1} is 0, so it can't be a pivot. Row ${p + 1} has ${f(R[r][c])} in that column, so swap rows ${r + 1} and ${p + 1}.`, mats: [sn({ rows: [r, p], pivot: [r, c] })] });
      }
      if (o.normalize && !R[r][c].isOne()) {
        const pvv = R[r][c];
        scale = scale.mul(pvv);
        R[r] = R[r].map((x) => x.div(pvv));
        S.add('Scale the pivot row so the pivot is 1', { op: `R${r + 1} ← ${cf(pvv.inv())}·R${r + 1}`, text: `The pivot in column ${c + 1} is ${f(pvv)}. Multiply row ${r + 1} by ${f(pvv.inv())} (that is, divide it by ${f(pvv)}) so the leading entry becomes 1.`, mats: [sn({ rows: [r], pivot: [r, c] })] });
      } else {
        S.add(`Pivot in column ${c + 1}`, { text: `Use ${f(R[r][c])} in row ${r + 1}, column ${c + 1} as the pivot.`, mats: [sn({ pivot: [r, c] })] });
      }
      for (let i = 0; i < m; i++) {
        if (i === r || (!o.reduced && i < r) || R[i][c].isZero()) continue;
        const entry = R[i][c];
        const fac = entry.div(R[r][c]);
        R[i] = R[i].map((x, j) => x.sub(fac.mul(R[r][j])));
        const verb = fac.sign() > 0 ? `subtract ${fac.abs().isOne() ? '' : f(fac.abs()) + ' × '}row ${r + 1} from row ${i + 1}` : `add ${fac.abs().isOne() ? '' : f(fac.abs()) + ' × '}row ${r + 1} to row ${i + 1}`;
        S.add(`Eliminate the entry ${i > r ? 'below' : 'above'} the pivot`, {
          op: rowOpText(i, fac, r),
          text: `Row ${i + 1} has ${f(entry)} in column ${c + 1}. Since ${f(entry)} ÷ ${pv(R[r][c])} = ${f(fac)}, ${verb} to make it 0.`,
          mats: [sn({ rows: [i], src: [r], pivot: [r, c], cells: [[i, c]] })],
        });
      }
      pivots.push([r, c]);
      r++;
    }
    return { M: R, pivots, swaps, scale, rank: pivots.length };
  }
  MX.gauss = gauss;
  MX.rref = (A) => gauss(A, { reduced: true, normalize: true }).M;

  function detQuick(A) {
    const n = M.rows(A);
    if (n === 0) return ONE;
    const g = gauss(A, {});
    if (g.rank < n) return ZERO;
    let d = g.swaps % 2 ? ONE.neg() : ONE;
    for (let i = 0; i < n; i++) d = d.mul(g.M[i][i]);
    return d;
  }
  MX.det = (A) => { square(A, 'The determinant'); return detQuick(A); };
  const minor = (A, i, j) => A.filter((_, r) => r !== i).map((row) => row.filter((_, c) => c !== j));

  function inverseQuick(A) {
    square(A, 'The inverse');
    const n = M.rows(A);
    const g = gauss(M.hstack(A, M.identity(n)), { reduced: true, normalize: true, stopCol: n });
    need(g.rank === n, 'The matrix is singular (not invertible).');
    return g.M.map((r) => r.slice(n));
  }
  MX.inverse = inverseQuick;

  function nullBasis(R, pivots, n) {
    const pcols = pivots.map((p) => p[1]);
    const free = [];
    for (let j = 0; j < n; j++) if (!pcols.includes(j)) free.push(j);
    const basis = free.map((fj) => {
      const v = Array.from({ length: n }, () => ZERO);
      v[fj] = ONE;
      pivots.forEach(([r, c]) => { v[c] = R[r][fj].neg(); });
      return v.map((x) => [x]);
    });
    return { free, basis, pcols };
  }

  /* ---------------- Arithmetic ---------------- */
  def('add', {
    name: 'Addition A + B', short: 'A + B', group: 'Arithmetic', inputs: [{ name: 'A' }, { name: 'B' }],
    run([A, B], o, S) {
      need(M.rows(A) === M.rows(B) && M.cols(A) === M.cols(B), `Matrices must have the same size to add (${M.dimStr(A)} vs ${M.dimStr(B)}).`);
      const sym = A.map((r, i) => r.map((x, j) => `${f(x)} + ${pv(B[i][j])}`));
      const C = M.add(A, B);
      S.add('Check sizes', { text: `Both matrices are ${M.dimStr(A)}, so they can be added entry by entry: (A + B)ᵢⱼ = aᵢⱼ + bᵢⱼ.`, mats: [snap('A', A), snap('B', B)] });
      S.add('Add matching entries', { mats: [snap('A + B', sym)] });
      S.add('Result', { mats: [snap('A + B', C)] });
      return { kind: 'matrix', M: C, label: 'A+B' };
    },
  });
  def('sub', {
    name: 'Subtraction A − B', short: 'A − B', group: 'Arithmetic', inputs: [{ name: 'A' }, { name: 'B' }],
    run([A, B], o, S) {
      need(M.rows(A) === M.rows(B) && M.cols(A) === M.cols(B), `Matrices must have the same size to subtract (${M.dimStr(A)} vs ${M.dimStr(B)}).`);
      const sym = A.map((r, i) => r.map((x, j) => `${f(x)} − ${pv(B[i][j])}`));
      const C = M.sub(A, B);
      S.add('Check sizes', { text: `Both matrices are ${M.dimStr(A)}, so subtract entry by entry: (A − B)ᵢⱼ = aᵢⱼ − bᵢⱼ.`, mats: [snap('A', A), snap('B', B)] });
      S.add('Subtract matching entries', { mats: [snap('A − B', sym)] });
      S.add('Result', { mats: [snap('A − B', C)] });
      return { kind: 'matrix', M: C, label: 'A-B' };
    },
  });
  def('scale', {
    name: 'Scalar multiple k·A', short: 'k·A', group: 'Arithmetic', inputs: [{ name: 'k', kind: 'scalar', def: '2' }, { name: 'A' }],
    run([k, A], o, S) {
      const sym = A.map((r) => r.map((x) => `${pv(k)}·${pv(x)}`));
      const C = M.scale(A, k);
      S.add('Multiply every entry by k', { text: `Scalar multiplication multiplies each entry of A by k = ${f(k)}.`, mats: [snap('A', A), snap(`${f(k)}·A`, sym)] });
      S.add('Result', { mats: [snap(`${f(k)}·A`, C)] });
      return { kind: 'matrix', M: C, label: 'kA' };
    },
  });
  def('mul', {
    name: 'Multiplication A·B', short: 'A·B', group: 'Arithmetic', inputs: [{ name: 'A' }, { name: 'B' }],
    run([A, B], o, S) {
      const m = M.rows(A), n = M.cols(A), p = M.cols(B);
      need(n === M.rows(B), `Cannot multiply: A is ${M.dimStr(A)} and B is ${M.dimStr(B)}. The number of columns of A (${n}) must equal the number of rows of B (${M.rows(B)}).`);
      S.add('Check dimensions', { text: `A is ${m}×${n} and B is ${M.rows(B)}×${p}. The inner dimensions match (${n} = ${n}), so the product is ${m}×${p}. Each entry cᵢⱼ is the dot product of row i of A with column j of B.`, mats: [snap('A', A), snap('B', B)] });
      const C = Array.from({ length: m }, () => Array.from({ length: p }, () => ''));
      const entry = (i, j) => {
        let s = ZERO; const terms = [];
        for (let k = 0; k < n; k++) { s = s.add(A[i][k].mul(B[k][j])); terms.push(`${pv(A[i][k])}·${pv(B[k][j])}`); }
        return { s, txt: `c${sub(i + 1)}${sub(j + 1)} = ${terms.join(' + ')} = ${f(s)}` };
      };
      const perEntry = m * p <= 36;
      for (let i = 0; i < m; i++) {
        if (perEntry) {
          for (let j = 0; j < p; j++) {
            const e = entry(i, j); C[i][j] = e.s;
            S.add(`Entry (${i + 1}, ${j + 1})`, { text: `Row ${i + 1} of A · column ${j + 1} of B:`, eq: e.txt, mats: [snap('A', A, { rows: [i] }), snap('B', B, { cols: [j] }), snap('AB', C, { cells: [[i, j]] })] });
          }
        } else {
          const lines = [];
          for (let j = 0; j < p; j++) { const e = entry(i, j); C[i][j] = e.s; lines.push(e.txt); }
          S.add(`Row ${i + 1} of the product`, { text: `Dot row ${i + 1} of A with every column of B:`, eq: lines.join('\n'), mats: [snap('A', A, { rows: [i] }), snap('AB', C, { rows: [i] })] });
        }
      }
      S.add('Result', { mats: [snap('AB', C)] });
      return { kind: 'matrix', M: C, label: 'AB' };
    },
  });
  def('pow', {
    name: 'Power Aᵏ', short: 'Aᵏ', group: 'Arithmetic', inputs: [{ name: 'A' }, { name: 'k', kind: 'int', def: '2' }],
    run([A, k], o, S) {
      square(A, 'A matrix power');
      const n = M.rows(A);
      let base = A;
      if (k < 0) {
        base = inverseQuick(A);
        S.add('Negative power: invert first', { text: `A⁻ᵏ = (A⁻¹)ᵏ, so first compute A⁻¹ (see the Inverse explainer for the details).`, mats: [snap('A⁻¹', base)] });
        k = -k;
      }
      if (k === 0) { S.add('Zero power', { text: 'By definition A⁰ = I.' }); const I = M.identity(n); S.add('Result', { mats: [snap('A⁰', I)] }); return { kind: 'matrix', M: I, label: 'A^0' }; }
      need(k <= 64, 'Powers above 64 are not supported.');
      let P = base;
      S.add('Start', { text: `Aᵏ means multiplying A by itself ${k} times.`, mats: [snap(k === 1 ? 'A' : 'A¹', P)] });
      for (let e = 2; e <= k; e++) {
        P = M.mul(P, base);
        S.add(`Power ${e}`, { text: `A${toSup(e)} = A${toSup(e - 1)} · A`, mats: [snap('A' + toSup(e), P)] });
      }
      return { kind: 'matrix', M: P, label: 'A^' + k };
    },
  });
  const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const lamEq = (r) => 'λ ' + (r.str.startsWith('≈') ? '' : '= ') + r.str;
  const toSup = (n) => String(n).replace(/-/g, '⁻').replace(/\d/g, (d) => SUP[+d]);
  MX.sup = toSup;
  def('transpose', {
    name: 'Transpose Aᵀ', short: 'Aᵀ', group: 'Arithmetic',
    run([A], o, S) {
      const T = M.transpose(A);
      S.add('Swap rows and columns', { text: `Row i of A becomes column i of Aᵀ, so a ${M.dimStr(A)} matrix becomes ${M.cols(A)}×${M.rows(A)}: (Aᵀ)ᵢⱼ = aⱼᵢ.`, mats: [snap('A', A, { rows: [0] }), snap('Aᵀ', T, { cols: [0] })] });
      S.add('Result', { mats: [snap('Aᵀ', T)] });
      return { kind: 'matrix', M: T, label: 'AT' };
    },
  });
  def('hadamard', {
    name: 'Entrywise (Hadamard) product A∘B', short: 'A∘B', group: 'Arithmetic', inputs: [{ name: 'A' }, { name: 'B' }],
    run([A, B], o, S) {
      need(M.rows(A) === M.rows(B) && M.cols(A) === M.cols(B), 'Matrices must have the same size.');
      const C = A.map((r, i) => r.map((x, j) => x.mul(B[i][j])));
      S.add('Multiply matching entries', { mats: [snap('A∘B', A.map((r, i) => r.map((x, j) => `${pv(x)}·${pv(B[i][j])}`)))] });
      S.add('Result', { mats: [snap('A∘B', C)] });
      return { kind: 'matrix', M: C, label: 'AoB' };
    },
  });
  def('kron', {
    name: 'Kronecker product A⊗B', short: 'A⊗B', group: 'Arithmetic', inputs: [{ name: 'A' }, { name: 'B' }],
    run([A, B], o, S) {
      const m = M.rows(A), n = M.cols(A), p = M.rows(B), q = M.cols(B);
      const C = M.zeros(m * p, n * q);
      for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) for (let k = 0; k < p; k++) for (let l = 0; l < q; l++) C[i * p + k][j * q + l] = A[i][j].mul(B[k][l]);
      S.add('Replace each aᵢⱼ by the block aᵢⱼ·B', { text: `The result is ${m * p}×${n * q}.`, mats: [snap('A⊗B', A.map((r) => r.map((x) => `${pv(x)}·B`)))] });
      S.add('Result', { mats: [snap('A⊗B', C)] });
      return { kind: 'matrix', M: C, label: 'AxB' };
    },
  });

  /* ---------------- Elimination ---------------- */
  def('ref', {
    name: 'Row echelon form (REF)', short: 'REF', group: 'Row reduction',
    run([A], o, S) {
      S.add('Goal', { text: 'Use elementary row operations (swap rows, scale a row, add a multiple of one row to another) to get a staircase shape: each leading entry (pivot) is 1 and sits to the right of the pivot above it, with zeros below every pivot.', mats: [snap('A', A)] });
      const g = gauss(A, { normalize: true, S, label: 'A' });
      S.add('Row echelon form reached', { text: `There are ${g.rank} pivot${g.rank === 1 ? '' : 's'}. (REF is not unique — different row operations can give different echelon forms; RREF is unique.)`, mats: [snap('REF', g.M, { pivots: g.pivots })] });
      return { kind: 'matrix', M: g.M, label: 'REF' };
    },
  });
  def('rref', {
    name: 'Reduced row echelon form (RREF)', short: 'RREF', group: 'Row reduction',
    run([A], o, S) {
      S.add('Goal', { text: 'Gauss–Jordan elimination: make every pivot 1 and clear every other entry in each pivot column (above and below).', mats: [snap('A', A)] });
      const g = gauss(A, { reduced: true, normalize: true, S, label: 'A' });
      S.add('Reduced row echelon form reached', { text: `Each pivot is 1 and is the only nonzero entry in its column. Rank = ${g.rank}.`, mats: [snap('RREF', g.M, { pivots: g.pivots })] });
      return { kind: 'matrix', M: g.M, label: 'RREF' };
    },
  });
  def('rank', {
    name: 'Rank & nullity', short: 'rank', group: 'Row reduction',
    run([A], o, S) {
      S.add('Idea', { text: 'The rank is the number of pivots in an echelon form of A. Reduce A to echelon form and count.', mats: [snap('A', A)] });
      const g = gauss(A, { normalize: true, S, label: 'A' });
      const n = M.cols(A);
      S.add('Count the pivots', { text: `Pivot columns: ${g.pivots.map((p) => p[1] + 1).join(', ') || 'none'}.\nrank(A) = ${g.rank}, and by rank–nullity, nullity(A) = ${n} − ${g.rank} = ${n - g.rank}.`, mats: [snap('REF', g.M, { pivots: g.pivots })] });
      return { kind: 'multi', items: [{ kind: 'scalar', label: 'rank', v: new Frac(g.rank) }, { kind: 'scalar', label: 'nullity', v: new Frac(n - g.rank) }] };
    },
  });
  def('inverse', {
    name: 'Inverse A⁻¹', short: 'A⁻¹', group: 'Row reduction',
    options: [{ key: 'method', label: 'Method', choices: [['gj', 'Gauss–Jordan on [A | I]'], ['adj', 'Adjugate: adj(A)/det(A)']] }],
    run([A], o, S) {
      square(A, 'The inverse');
      const n = M.rows(A);
      if (o.method === 'adj') {
        const d = detQuick(A);
        S.add('Determinant', { text: `det(A) = ${f(d)}.` + (d.isZero() ? ' Since it is 0, A has no inverse.' : ' It is nonzero, so A is invertible and A⁻¹ = adj(A) / det(A).'), mats: [snap('A', A)] });
        need(!d.isZero(), 'A is singular (det = 0), so it has no inverse.');
        const C = cofactorMatrix(A, S);
        const adj = M.transpose(C);
        S.add('Adjugate = transpose of the cofactor matrix', { mats: [snap('adj(A)', adj)] });
        const inv = M.scale(adj, d.inv());
        S.add('Divide by the determinant', { text: `A⁻¹ = (1/${pv(d)})·adj(A)`, mats: [snap('A⁻¹', inv)] });
        return { kind: 'matrix', M: inv, label: 'Ainv' };
      }
      if (n === 2) {
        S.add('Shortcut for 2×2', { text: 'For a 2×2 matrix [[a, b], [c, d]], A⁻¹ = 1/(ad − bc) · [[d, −b], [−c, a]]. Below we use the general Gauss–Jordan method, which works for any size.' });
      }
      const aug = M.hstack(A, M.identity(n));
      S.add('Form the augmented matrix [A | I]', { text: 'Row-reduce [A | I]. If the left side becomes I, the right side is A⁻¹ (the same row operations that turn A into I turn I into A⁻¹).', mats: [snap('[A | I]', aug, { aug: n })] });
      const g = gauss(aug, { reduced: true, normalize: true, stopCol: n, S, label: '[A | I]', aug: n });
      if (g.rank < n) {
        S.add('No inverse', { text: `The left side has only ${g.rank} pivot${g.rank === 1 ? '' : 's'} (a row of zeros appeared), so it can't become I. A is singular and has no inverse.`, mats: [snap('', g.M, { aug: n })] });
        throw Object.assign(new Error('A is singular (not invertible): rank ' + g.rank + ' < ' + n + '.'), { steps: S });
      }
      const inv = g.M.map((r) => r.slice(n));
      S.add('Read off the inverse', { text: 'The left half is now I, so the right half is A⁻¹.', mats: [snap('[I | A⁻¹]', g.M, { aug: n }), snap('A⁻¹', inv)] });
      return { kind: 'matrix', M: inv, label: 'Ainv' };
    },
  });

  function solveSystem(A, b, S, names = { A: 'A', b: 'b' }) {
    const m = M.rows(A), n = M.cols(A);
    need(M.rows(b) === m, `b must have ${m} rows (one per equation) but has ${M.rows(b)}.`);
    const k = M.cols(b);
    const aug = M.hstack(A, b);
    const eqs = A.map((r, i) => {
      const terms = r.map((x, j) => (x.isZero() ? null : `${x.isOne() ? '' : x.neg().isOne() ? '−' : pv(x)}x${sub(j + 1)}`)).filter(Boolean);
      return (terms.join(' + ') || '0').replace(/\+ −/g, '− ') + ' = ' + (k === 1 ? f(b[i][0]) : '…');
    });
    S.add(`Write the augmented matrix [${names.A} | ${names.b}]`, { text: k === 1 ? 'The system of equations:' : 'Solve for all right-hand sides at once.', eq: k === 1 ? eqs.join('\n') : '', mats: [snap(`[${names.A} | ${names.b}]`, aug, { aug: n })] });
    const g = gauss(aug, { reduced: true, normalize: true, stopCol: n, S, label: `[${names.A} | ${names.b}]`, aug: n });
    const R = g.M;
    // inconsistency
    for (let i = g.rank; i < m; i++) {
      for (let j = 0; j < k; j++) {
        if (!R[i][n + j].isZero()) {
          S.add('Inconsistent system', { text: `Row ${i + 1} reads 0 = ${f(R[i][n + j])}, which is impossible. The system has no solution.`, mats: [snap('RREF', R, { aug: n, rows: [i] })] });
          return { kind: 'text', label: 'Solution', text: `No solution — the system is inconsistent (row ${i + 1} gives 0 = ${f(R[i][n + j])}).` };
        }
      }
    }
    const { free, basis, pcols } = nullBasis(R.map((r) => r.slice(0, n)), g.pivots, n);
    if (!free.length) {
      const X = Array.from({ length: n }, () => Array.from({ length: k }, () => ZERO));
      g.pivots.forEach(([r, c]) => { for (let j = 0; j < k; j++) X[c][j] = R[r][n + j]; });
      S.add('Unique solution', { text: 'Every variable column has a pivot, so there are no free variables and the solution is unique. Read it from the last column.', eq: k === 1 ? X.map((r, i) => `x${sub(i + 1)} = ${f(r[0])}`).join('\n') : '', mats: [snap('RREF', R, { aug: n, pivots: g.pivots }), snap('x', X)] });
      return { kind: 'matrix', M: X, label: 'x' };
    }
    need(k === 1, 'The system has infinitely many solutions; use a single right-hand-side column to see the parametric form.');
    const xp = Array.from({ length: n }, () => [ZERO]);
    g.pivots.forEach(([r, c]) => { xp[c][0] = R[r][n]; });
    const params = 'stuvwpqrabcdefgh'.split('');
    const pname = (i) => (free.length <= params.length ? params[i] : 't' + sub(i + 1));
    const lines = [];
    for (let j = 0; j < n; j++) {
      if (free.includes(j)) { lines.push(`x${sub(j + 1)} = ${pname(free.indexOf(j))}  (free)`); continue; }
      const r = g.pivots.find((p) => p[1] === j)[0];
      let s = f(R[r][n]);
      free.forEach((fj, t) => { const c = R[r][fj].neg(); if (!c.isZero()) s += (c.sign() < 0 ? ' − ' : ' + ') + (c.abs().isOne() ? '' : pv(c.abs())) + pname(t); });
      lines.push(`x${sub(j + 1)} = ${s.replace(/^0 \+ /, '').replace(/^0 − /, '−')}`);
    }
    S.add('Infinitely many solutions', { text: `Pivot columns: ${pcols.map((c) => c + 1).join(', ')}. Column${free.length > 1 ? 's' : ''} ${free.map((c) => c + 1).join(', ')} ${free.length > 1 ? 'have' : 'has'} no pivot, so x${free.map((c) => sub(c + 1)).join(', x')} ${free.length > 1 ? 'are free variables' : 'is a free variable'}. Solve each pivot variable in terms of the free ones:`, eq: lines.join('\n'), mats: [snap('RREF', R, { aug: n, pivots: g.pivots })] });
    const vec = `x = xₚ + ${free.map((_, t) => pname(t) + '·v' + sub(t + 1)).join(' + ')}`;
    S.add('Vector (parametric) form', { text: 'Split the solution into a particular solution plus a combination of null-space vectors:', eq: vec, mats: [snap('xₚ', xp)].concat(basis.map((v, t) => snap('v' + sub(t + 1), v))) });
    const param = { names: free.map((_, t) => pname(t)), free, xp: xp.map((r) => r[0]), basis: basis.map((v) => v.map((r) => r[0])), A, b: b.map((r) => r[0]) };
    return { kind: 'multi', param, items: [{ kind: 'text', label: 'General solution', text: vec + '\n' + lines.join('\n') }, { kind: 'matrix', label: 'xp', M: xp }].concat(basis.map((v, t) => ({ kind: 'matrix', label: 'v' + (t + 1), M: v }))) };
  }
  def('solve', {
    name: 'Solve Ax = b', short: 'Ax=b', group: 'Row reduction', inputs: [{ name: 'A' }, { name: 'b', hint: 'column vector' }],
    run([A, b], o, S) { return solveSystem(A, b, S); },
  });
  def('solveaug', {
    name: 'Solve augmented matrix [A | b]', short: 'solve[A|b]', group: 'Row reduction', inputs: [{ name: 'M', hint: 'augmented [A | b]' }],
    run([Mx], o, S) {
      const n = M.cols(Mx) - 1;
      need(n >= 1, 'An augmented matrix needs at least two columns: the coefficients and the right-hand side.');
      const A = Mx.map((r) => r.slice(0, n)), b = Mx.map((r) => [r[n]]);
      S.add('Split into A and b', { text: `Treat the last column as the right-hand side b and the first ${n} column${n > 1 ? 's' : ''} as the coefficient matrix A (${M.rows(A)} equation${M.rows(A) > 1 ? 's' : ''} in ${n} unknown${n > 1 ? 's' : ''}).`, mats: [snap('[A | b]', Mx, { aug: n }), snap('A', A), snap('b', b)] });
      return solveSystem(A, b, S);
    },
  });
  def('lstsq', {
    name: 'Least squares (best fit Ax ≈ b)', short: 'lstsq', group: 'Row reduction', inputs: [{ name: 'A' }, { name: 'b', hint: 'column vector' }],
    run([A, b], o, S) {
      need(M.rows(b) === M.rows(A), 'b must have as many rows as A.');
      const At = M.transpose(A);
      S.add('Normal equations', { text: 'The least-squares solution x̂ minimises ‖Ax − b‖. It satisfies the normal equations AᵀA x̂ = Aᵀb.', mats: [snap('A', A), snap('b', b), snap('Aᵀ', At)] });
      const AtA = M.mul(At, A), Atb = M.mul(At, b);
      S.add('Compute AᵀA and Aᵀb', { mats: [snap('AᵀA', AtA), snap('Aᵀb', Atb)] });
      const res = solveSystem(AtA, Atb, S, { A: 'AᵀA', b: 'Aᵀb' });
      if (res.kind === 'matrix') {
        const r = M.sub(b, M.mul(A, res.M));
        S.add('Residual', { text: `The error vector b − Ax̂ is orthogonal to the column space of A. ‖b − Ax̂‖² = ${f(M.dot(r.map((x) => x[0]), r.map((x) => x[0])))}`, mats: [snap('x̂', res.M), snap('b − Ax̂', r)] });
        res.label = 'xhat';
      }
      return res;
    },
  });

  /* ---------------- Determinants ---------------- */
  function detCofactorSteps(A, S, label, depth) {
    const n = M.rows(A);
    if (n === 1) return A[0][0];
    if (n === 2) {
      const v = A[0][0].mul(A[1][1]).sub(A[0][1].mul(A[1][0]));
      S.add(`2×2 determinant${label ? ' of ' + label : ''}`, { text: 'For a 2×2 matrix, det = ad − bc:', eq: `det = ${pv(A[0][0])}·${pv(A[1][1])} − ${pv(A[0][1])}·${pv(A[1][0])} = ${f(v)}`, mats: [snap(label || 'A', A, { diag: true })] });
      return v;
    }
    // pick row or column with most zeros
    let best = { type: 'row', idx: 0, z: -1 };
    for (let i = 0; i < n; i++) { const z = A[i].filter((x) => x.isZero()).length; if (z > best.z) best = { type: 'row', idx: i, z }; }
    for (let j = 0; j < n; j++) { const z = A.filter((r) => r[j].isZero()).length; if (z > best.z) best = { type: 'col', idx: j, z }; }
    const { type, idx } = best;
    const entries = Array.from({ length: n }, (_, t) => (type === 'row' ? [idx, t] : [t, idx]));
    const word = type === 'row' ? 'row' : 'column';
    S.add(`Cofactor expansion of ${label || 'A'} along ${word} ${idx + 1}`, {
      text: `Expand along ${word} ${idx + 1}${best.z ? ` (it has ${best.z} zero${best.z > 1 ? 's' : ''}, which saves work)` : ''}: det = Σ aᵢⱼ·Cᵢⱼ, where the cofactor Cᵢⱼ = (−1)ⁱ⁺ʲ·det(Mᵢⱼ) and Mᵢⱼ is A with row i and column j removed.\nSign pattern: + − + … starting with + in the top-left.`,
      eq: 'det = ' + entries.map(([i, j]) => `${pv(A[i][j])}·C${sub(i + 1)}${sub(j + 1)}`).join(' + '),
      mats: [snap(label || 'A', A, type === 'row' ? { rows: [idx] } : { cols: [idx] })],
    });
    let total = ZERO; const terms = [];
    for (const [i, j] of entries) {
      const a = A[i][j];
      if (a.isZero()) { terms.push(`0`); continue; }
      const Mi = minor(A, i, j);
      const sign = (i + j) % 2 ? -1 : 1;
      const mname = `M${sub(i + 1)}${sub(j + 1)}`;
      let d;
      if (Mi.length <= 2) {
        d = Mi.length === 1 ? Mi[0][0] : Mi[0][0].mul(Mi[1][1]).sub(Mi[0][1].mul(Mi[1][0]));
        const detTxt = Mi.length === 2 ? `det(${mname}) = ${pv(Mi[0][0])}·${pv(Mi[1][1])} − ${pv(Mi[0][1])}·${pv(Mi[1][0])} = ${f(d)}` : `det(${mname}) = ${f(d)}`;
        S.add(`Cofactor C${sub(i + 1)}${sub(j + 1)}`, { text: `Delete row ${i + 1} and column ${j + 1} of ${label || 'A'} to get the minor ${mname}. Sign: (−1)^${i + j + 2} = ${sign > 0 ? '+1' : '−1'}.`, eq: `${detTxt}\nC${sub(i + 1)}${sub(j + 1)} = ${sign > 0 ? '' : '−'}${pv(d)} = ${f(d.mul(sign))}`, mats: [snap(label || 'A', A, { strikeRow: i, strikeCol: j, cells: [[i, j]] }), snap(mname, Mi)] });
      } else {
        S.add(`Minor ${mname}`, { text: `Delete row ${i + 1} and column ${j + 1}. Sign: ${sign > 0 ? '+' : '−'}. Now find det(${mname}) the same way.`, mats: [snap(label || 'A', A, { strikeRow: i, strikeCol: j, cells: [[i, j]] }), snap(mname, Mi)] });
        d = detCofactorSteps(Mi, S, mname, depth + 1);
        S.add(`Cofactor C${sub(i + 1)}${sub(j + 1)}`, { eq: `C${sub(i + 1)}${sub(j + 1)} = ${sign > 0 ? '+' : '−'}det(${mname}) = ${f(d.mul(sign))}` });
      }
      const c = d.mul(sign);
      total = total.add(a.mul(c));
      terms.push(`${pv(a)}·${pv(c)}`);
    }
    S.add(`Combine${label ? ' for ' + label : ''}`, { eq: `det(${label || 'A'}) = ${terms.join(' + ')} = ${f(total)}` });
    return total;
  }
  def('det', {
    name: 'Determinant det(A)', short: 'det', group: 'Determinants',
    options: [{ key: 'method', label: 'Method', choices: [['row', 'Row reduction'], ['cofactor', 'Cofactor (Laplace) expansion']] }],
    run([A], o, S) {
      square(A, 'The determinant');
      const n = M.rows(A);
      let method = o.method || (n <= 3 ? 'cofactor' : 'row');
      if (method === 'cofactor' && n > 5) { S.add('Too large for cofactor expansion', { text: 'Cofactor expansion of a large matrix takes n! terms; switching to row reduction.' }); method = 'row'; }
      if (n === 1) { S.add('1×1', { text: 'The determinant of a 1×1 matrix is its only entry.' }); return { kind: 'scalar', label: 'det', v: A[0][0] }; }
      if (method === 'cofactor') {
        const d = detCofactorSteps(A, S, 'A', 0);
        S.add('Result', { eq: `det(A) = ${f(d)}` });
        return { kind: 'scalar', label: 'det(A)', v: d };
      }
      S.add('Plan', { text: 'Reduce A to upper-triangular form with row operations, tracking how each changes the determinant:\n• swapping two rows flips the sign\n• adding a multiple of one row to another leaves it unchanged\nThe determinant of a triangular matrix is the product of its diagonal.', mats: [snap('A', A)] });
      const g = gauss(A, { S, label: 'A' });
      if (g.rank < n) {
        S.add('A zero appears on the diagonal', { text: `There are only ${g.rank} pivots, so the triangular form has a 0 on its diagonal. det(A) = 0.`, mats: [snap('U', g.M, { diag: true })] });
        return { kind: 'scalar', label: 'det(A)', v: ZERO };
      }
      let prod = ONE; for (let i = 0; i < n; i++) prod = prod.mul(g.M[i][i]);
      const d = g.swaps % 2 ? prod.neg() : prod;
      S.add('Multiply the diagonal', { text: `${g.swaps} row swap${g.swaps === 1 ? '' : 's'} were used, so the sign is ${g.swaps % 2 ? 'flipped' : 'unchanged'}.`, eq: `det(A) = ${g.swaps % 2 ? '−' : ''}(${g.M.map((r, i) => pv(r[i])).join('·')}) = ${f(d)}`, mats: [snap('U', g.M, { diag: true })] });
      return { kind: 'scalar', label: 'det(A)', v: d };
    },
  });
  function cofactorMatrix(A, S) {
    const n = M.rows(A);
    const C = Array.from({ length: n }, () => Array.from({ length: n }, () => ''));
    const detailed = n <= 4;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const Mi = minor(A, i, j);
      const d = n === 1 ? ONE : detQuick(Mi);
      const sign = (i + j) % 2 ? -1 : 1;
      C[i][j] = d.mul(sign);
      if (detailed) S.add(`Cofactor C${sub(i + 1)}${sub(j + 1)}`, { text: `Remove row ${i + 1} and column ${j + 1}, take the determinant, and apply the sign (−1)^${i + j + 2}.`, eq: `C${sub(i + 1)}${sub(j + 1)} = ${sign > 0 ? '+' : '−'}det(M${sub(i + 1)}${sub(j + 1)}) = ${sign > 0 ? '' : '−'}${pv(d)} = ${f(C[i][j])}`, mats: [snap('A', A, { strikeRow: i, strikeCol: j, cells: [[i, j]] }), snap(`M${sub(i + 1)}${sub(j + 1)}`, Mi), snap('C', C, { cells: [[i, j]] })] });
    }
    if (!detailed) S.add('Cofactors', { text: 'Each Cᵢⱼ = (−1)ⁱ⁺ʲ·det(Mᵢⱼ), computed by row reduction.', mats: [snap('C', C)] });
    return C;
  }
  def('cofactor', {
    name: 'Cofactor matrix', short: 'cof', group: 'Determinants',
    run([A], o, S) { square(A, 'The cofactor matrix'); const C = cofactorMatrix(A, S); S.add('Result', { mats: [snap('C', C)] }); return { kind: 'matrix', M: C, label: 'C' }; },
  });
  def('adj', {
    name: 'Adjugate adj(A)', short: 'adj', group: 'Determinants',
    run([A], o, S) {
      square(A, 'The adjugate');
      S.add('Definition', { text: 'adj(A) is the transpose of the cofactor matrix. It satisfies A·adj(A) = det(A)·I.', mats: [snap('A', A)] });
      const C = cofactorMatrix(A, S);
      const adj = M.transpose(C);
      S.add('Transpose the cofactor matrix', { mats: [snap('C', C), snap('adj(A) = Cᵀ', adj)] });
      return { kind: 'matrix', M: adj, label: 'adjA' };
    },
  });
  def('trace', {
    name: 'Trace tr(A)', short: 'tr', group: 'Determinants',
    run([A], o, S) {
      square(A, 'The trace');
      const t = M.trace(A);
      S.add('Sum the main diagonal', { eq: `tr(A) = ${A.map((r, i) => pv(r[i])).join(' + ')} = ${f(t)}`, text: 'The trace also equals the sum of the eigenvalues.', mats: [snap('A', A, { diag: true })] });
      return { kind: 'scalar', label: 'tr(A)', v: t };
    },
  });

  /* ---------------- Subspaces ---------------- */
  def('null', {
    name: 'Null space (kernel)', short: 'null', group: 'Subspaces',
    run([A], o, S) {
      const n = M.cols(A);
      S.add('Goal', { text: 'The null space is every x with Ax = 0. Row-reduce A (the zero right-hand side never changes) and solve for the pivot variables in terms of the free ones.', mats: [snap('A', A)] });
      const g = gauss(A, { reduced: true, normalize: true, S, label: 'A' });
      const { free, basis } = nullBasis(g.M, g.pivots, n);
      if (!free.length) {
        S.add('Only the zero vector', { text: 'Every column has a pivot, so there are no free variables. Null(A) = {0}.', mats: [snap('RREF', g.M, { pivots: g.pivots })] });
        return { kind: 'text', label: 'Null space', text: 'Null(A) = {0} (only the zero vector). Nullity = 0.' };
      }
      S.add('One basis vector per free variable', { text: `Free variables: x${free.map((c) => sub(c + 1)).join(', x')}. For each, set it to 1 and the other free variables to 0; the pivot variables are the negatives of the entries in that column of the RREF.`, mats: [snap('RREF', g.M, { pivots: g.pivots, cols: free })].concat(basis.map((v, t) => snap('v' + sub(t + 1), v))) });
      let Bm = basis[0]; for (let t = 1; t < basis.length; t++) Bm = M.hstack(Bm, basis[t]);
      S.add('Basis', { text: `Null(A) = span{${basis.map((_, t) => 'v' + sub(t + 1)).join(', ')}}, dimension (nullity) ${basis.length}.`, mats: [snap('basis (as columns)', Bm)] });
      const params = 'stuvwpqrabcdefgh'.split('');
      const param = { names: free.map((_, t) => (free.length <= params.length ? params[t] : 't' + sub(t + 1))), free, xp: Array.from({ length: n }, () => ZERO), basis: basis.map((v) => v.map((r) => r[0])), A, b: A.map(() => ZERO) };
      return { kind: 'matrix', M: Bm, label: 'N', param };
    },
  });
  def('colspace', {
    name: 'Column space basis', short: 'col', group: 'Subspaces',
    run([A], o, S) {
      S.add('Goal', { text: 'The pivot columns of A (the original matrix!) form a basis for its column space. Find them with row reduction.', mats: [snap('A', A)] });
      const g = gauss(A, { normalize: true, S, label: 'A' });
      const pc = g.pivots.map((p) => p[1]);
      if (!pc.length) return { kind: 'text', label: 'Column space', text: 'Col(A) = {0}.' };
      const B = A.map((r) => pc.map((j) => r[j]));
      S.add('Take the pivot columns of A', { text: `Pivots are in columns ${pc.map((c) => c + 1).join(', ')}, so those columns of A form a basis. dim Col(A) = rank = ${pc.length}.`, mats: [snap('A', A, { cols: pc }), snap('basis', B)] });
      return { kind: 'matrix', M: B, label: 'ColA' };
    },
  });
  def('rowspace', {
    name: 'Row space basis', short: 'row', group: 'Subspaces',
    run([A], o, S) {
      S.add('Goal', { text: 'Row operations don\'t change the row space, so the nonzero rows of the RREF form a basis.', mats: [snap('A', A)] });
      const g = gauss(A, { reduced: true, normalize: true, S, label: 'A' });
      const B = g.M.slice(0, g.rank);
      if (!B.length) return { kind: 'text', label: 'Row space', text: 'Row(A) = {0}.' };
      S.add('Nonzero rows of the RREF', { text: `dim Row(A) = rank = ${g.rank}.`, mats: [snap('RREF', g.M, { rows: B.map((_, i) => i) }), snap('basis (as rows)', B)] });
      return { kind: 'matrix', M: B, label: 'RowA' };
    },
  });

  /* ---------------- Decompositions ---------------- */
  def('lu', {
    name: 'LU decomposition', short: 'LU', group: 'Decompositions',
    run([A], o, S) {
      const m = M.rows(A), n = M.cols(A);
      const U = M.clone(A), L = M.identity(m);
      const perm = Array.from({ length: m }, (_, i) => i);
      let used = false;
      S.add('Plan', { text: 'Do Gaussian elimination on A (without scaling rows). The result is U (upper triangular). Each multiplier used to clear an entry below a pivot is stored in L at the same position. If a zero pivot forces a row swap, we record it in a permutation P so that PA = LU.', mats: [snap('U', U), snap('L', L)] });
      let r = 0;
      for (let c = 0; c < n && r < m; c++) {
        if (U[r][c].isZero()) {
          let p = -1; for (let i = r + 1; i < m; i++) if (!U[i][c].isZero()) { p = i; break; }
          if (p < 0) { S.add(`No pivot in column ${c + 1}`, { text: 'Everything at or below the diagonal here is 0, so skip this column.', mats: [snap('U', U, { cols: [c] })] }); continue; }
          [U[r], U[p]] = [U[p], U[r]];
          [perm[r], perm[p]] = [perm[p], perm[r]];
          for (let k = 0; k < r; k++) [L[r][k], L[p][k]] = [L[p][k], L[r][k]];
          used = true;
          S.add('Row swap needed', { op: `R${r + 1} ↔ R${p + 1}`, text: 'The pivot position holds 0, so swap rows (also swapping the multipliers already stored in L and recording the swap in P).', mats: [snap('U', U, { rows: [r, p] }), snap('L', L, { rows: [r, p] })] });
        }
        for (let i = r + 1; i < m; i++) {
          if (U[i][c].isZero()) continue;
          const fac = U[i][c].div(U[r][c]);
          U[i] = U[i].map((x, j) => x.sub(fac.mul(U[r][j])));
          L[i][r] = fac;
          S.add(`Clear entry (${i + 1}, ${c + 1})`, { op: rowOpText(i, fac, r), text: `Multiplier ℓ${sub(i + 1)}${sub(r + 1)} = ${f(fac)}; store it in L.`, mats: [snap('U', U, { rows: [i], src: [r], pivot: [r, c] }), snap('L', L, { cells: [[i, r]] })] });
        }
        r++;
      }
      const P = perm.map((pi) => Array.from({ length: m }, (_, j) => (j === pi ? ONE : ZERO)));
      S.add('Result', { text: used ? 'PA = LU, where P records the row swaps.' : 'A = LU: L is unit lower triangular, U is upper triangular.', mats: (used ? [snap('P', P)] : []).concat([snap('L', L), snap('U', U)]) });
      const items = [];
      if (used) items.push({ kind: 'matrix', label: 'P', M: P });
      items.push({ kind: 'matrix', label: 'L', M: L }, { kind: 'matrix', label: 'U', M: U });
      return { kind: 'multi', items };
    },
  });

  def('qr', {
    name: 'Gram–Schmidt & QR', short: 'QR', group: 'Decompositions',
    run([A], o, S) {
      const m = M.rows(A), n = M.cols(A);
      const cols = Array.from({ length: n }, (_, j) => A.map((r) => r[j]));
      const V = [];
      S.add('Gram–Schmidt', { text: 'Take the columns a₁, a₂, … of A in order. From each, subtract its projections onto the previous orthogonal vectors:\nvₖ = aₖ − Σ (aₖ·vᵢ)/(vᵢ·vᵢ) · vᵢ', mats: [snap('A', A)] });
      cols.forEach((a, k) => {
        let v = a.slice(); const parts = [];
        V.forEach((u, i) => {
          if (!u) return;
          const c = M.dot(a, u).div(M.dot(u, u));
          if (!c.isZero()) { v = v.map((x, t) => x.sub(c.mul(u[t]))); parts.push(`${cf(c)}·v${sub(i + 1)}`); }
        });
        const zero = v.every((x) => x.isZero());
        S.add(`Vector v${sub(k + 1)}`, { eq: `v${sub(k + 1)} = a${sub(k + 1)}${parts.length ? ' − ' + parts.join(' − ') : ''}`, text: zero ? `This is the zero vector: a${sub(k + 1)} is a combination of the earlier columns, so it is skipped.` : '', mats: [snap('a' + sub(k + 1), a.map((x) => [x])), snap('v' + sub(k + 1), v.map((x) => [x]))] });
        V.push(zero ? null : v);
      });
      const kept = V.map((v, i) => ({ v, i })).filter((x) => x.v);
      const Vm = Array.from({ length: m }, (_, r) => kept.map((x) => x.v[r]));
      S.add('Orthogonal basis', { text: 'These vectors are mutually orthogonal and span Col(A).', mats: [snap('V', Vm)] });
      // normalise
      const norms = kept.map((x) => M.dot(x.v, x.v));
      const exact = norms.every((s) => s.sqrt());
      let Q;
      if (exact) Q = Array.from({ length: m }, (_, r) => kept.map((x, t) => x.v[r].div(norms[t].sqrt())));
      else Q = Array.from({ length: m }, (_, r) => kept.map((x, t) => x.v[r].toNumber() / Math.sqrt(norms[t].toNumber())));
      S.add('Normalise to get Q', { text: 'Divide each vᵢ by its length ‖vᵢ‖ = √(vᵢ·vᵢ):', eq: kept.map((x, t) => `‖v${sub(x.i + 1)}‖ = √${pv(norms[t])}${norms[t].sqrt() ? ' = ' + f(norms[t].sqrt()) : ' ≈ ' + MX.fmtNumber(Math.sqrt(norms[t].toNumber()))}`).join('\n'), mats: [snap('Q', Q)] });
      let R;
      if (exact) R = M.mul(M.transpose(Q), A);
      else {
        const Qt = M.transpose(Q), An = M.toNum(A);
        R = Qt.map((q) => An[0].map((_, j) => { const s = q.reduce((acc, x, t) => acc + x * An[t][j], 0); return Math.abs(s) < 1e-12 ? 0 : s; }));
      }
      S.add('R = QᵀA', { text: 'Because Q has orthonormal columns, QᵀQ = I, so R = QᵀA. R is upper triangular and A = QR.', mats: [snap('Q', Q), snap('R', R)] });
      return { kind: 'multi', items: [{ kind: 'matrix', label: 'Q', M: Q }, { kind: 'matrix', label: 'R', M: R }, { kind: 'matrix', label: 'V', M: Vm }] };
    },
  });

  /* ---------------- Polynomials & eigenvalues ---------------- */
  function polyStr(c, v = 'λ') {
    const out = [];
    for (let k = c.length - 1; k >= 0; k--) {
      const a = c[k];
      if (a.isZero()) continue;
      const s = a.sign();
      const abs = a.abs();
      let body = k === 0 ? f(abs) : (abs.isOne() ? '' : pv(abs)) + v + (k > 1 ? toSup(k) : '');
      out.push((out.length ? (s < 0 ? ' − ' : ' + ') : s < 0 ? '−' : '') + body);
    }
    return out.join('') || '0';
  }
  MX.polyStr = polyStr;
  function combos(n, k) {
    const res = [];
    const rec = (start, cur) => { if (cur.length === k) { res.push(cur.slice()); return; } for (let i = start; i < n; i++) { cur.push(i); rec(i + 1, cur); cur.pop(); } };
    rec(0, []);
    return res;
  }
  function charPoly(A, S) {
    const n = M.rows(A);
    // coefficients of det(λI − A), low → high
    const c = Array.from({ length: n + 1 }, () => ZERO);
    c[n] = ONE;
    if (n <= 4) {
      for (let k = 1; k <= n; k++) {
        let E = ZERO; const parts = [];
        for (const idx of combos(n, k)) {
          const sm = idx.map((i) => idx.map((j) => A[i][j]));
          const d = detQuick(sm); E = E.add(d); parts.push(f(d));
        }
        c[n - k] = k % 2 ? E.neg() : E;
        if (S) S.add(`Sum of ${k}×${k} principal minors`, { text: k === 1 ? 'E₁ = sum of the diagonal = tr(A)' : k === n ? `E${sub(n)} = det(A)` : `E${sub(k)} = sum of determinants of all ${k}×${k} submatrices using the same rows and columns`, eq: `E${sub(k)} = ${parts.join(' + ')} = ${f(E)}` });
      }
    } else {
      // Faddeev–LeVerrier
      let Mk = M.zeros(n, n);
      const I = M.identity(n);
      for (let k = 1; k <= n; k++) {
        Mk = M.add(M.mul(A, Mk), M.scale(I, c[n - k + 1]));
        c[n - k] = M.trace(M.mul(A, Mk)).div(new Frac(-k));
      }
      if (S) S.add('Faddeev–LeVerrier algorithm', { text: 'For larger matrices the coefficients are computed with the recurrence Mₖ = A·Mₖ₋₁ + cₙ₋ₖ₊₁I, cₙ₋ₖ = −tr(A·Mₖ)/k.' });
    }
    return c;
  }
  MX.charPoly = (A) => charPoly(A);
  const hornerF = (c, x) => c.reduceRight((acc, a) => acc.mul(x).add(a), ZERO);
  function divisors(N) {
    N = N < 0n ? -N : N;
    if (N === 0n) return [];
    if (N > 10n ** 12n) return null;
    const ds = []; const n = Number(N);
    for (let i = 1; i * i <= n; i++) if (n % i === 0) { ds.push(BigInt(i)); if (i * i !== n) ds.push(BigInt(n / i)); }
    return ds;
  }
  function deflate(c, r) { // divide by (x - r)
    const n = c.length - 1; const q = Array(n);
    let acc = ZERO;
    for (let k = n; k >= 1; k--) { acc = acc.mul(r).add(c[k]); q[k - 1] = acc; }
    return q;
  }
  function squareFree(N) { // N bigint >0 → [k, s] with N = k² s
    let k = 1n, s = N;
    for (let p = 2n; p * p <= s && p < 100000n; p++) while (s % (p * p) === 0n) { s /= p * p; k *= p; }
    return [k, s];
  }
  /** Find roots of polynomial with Frac coefficients. Returns [{v:Frac|null, num, str, mult, kind}] */
  function polyRoots(coef) {
    let c = coef.slice();
    while (c.length > 1 && c[c.length - 1].isZero()) c.pop();
    const roots = [];
    const push = (r) => { const e = roots.find((x) => x.v && x.v.eq(r)); if (e) e.mult++; else roots.push({ v: r, num: r.toNumber(), str: f(r), mult: 1, kind: 'rational' }); };
    while (c.length > 1 && c[0].isZero()) { push(ZERO); c = c.slice(1); }
    // integerise
    let L = 1n; c.forEach((a) => { L = (L * a.d) / MX.bgcd(L, a.d); });
    const ints = () => c.map((a) => a.mul(new Frac(L)).n);
    let found = true;
    while (c.length > 2 && found) {
      found = false;
      L = 1n; c.forEach((a) => { L = (L * a.d) / MX.bgcd(L, a.d); });
      const I = ints();
      const ps = divisors(I[0]), qs = divisors(I[I.length - 1]);
      if (!ps || !qs) break;
      const cands = [];
      for (const p of ps) for (const q of qs) { cands.push(new Frac(p, q), new Frac(-p, q)); }
      cands.sort((a, b) => Math.abs(a.toNumber()) - Math.abs(b.toNumber()));
      for (const r of cands) {
        if (hornerF(c, r).isZero()) { push(r); c = deflate(c, r); found = true; break; }
      }
    }
    const deg = c.length - 1;
    if (deg === 1) push(c[0].neg().div(c[1]));
    else if (deg === 2) {
      const [C0, B, A] = c;
      const D = B.mul(B).sub(A.mul(C0).mul(new Frac(4)));
      const sq = D.abs().sqrt();
      const p = B.neg().div(A.mul(new Frac(2)));
      if (D.sign() >= 0 && sq) { const q = sq.div(A.mul(new Frac(2))).abs(); push(p.add(q)); push(p.sub(q)); }
      else {
        // surd form: √|D| = √(n/d) = √(n·d)/d
        const Dabs = D.abs();
        const [k, s] = squareFree(Dabs.n * Dabs.d);
        const coef2 = new Frac(k, Dabs.d).div(A.mul(new Frac(2))).abs();
        const rad = s === 1n ? (coef2.isOne() ? '' : f(coef2)) + 'i' : (coef2.isOne() ? '' : cf(coef2)) + '√' + s + (D.sign() < 0 ? '·i' : '');
        const ps = p.isZero() ? '' : f(p) + ' ';
        const qn = coef2.toNumber() * Math.sqrt(Number(s));
        if (D.sign() > 0) {
          roots.push({ v: null, num: p.toNumber() + qn, str: `${ps}${ps ? '+ ' : ''}${rad}`, mult: 1, kind: 'real' });
          roots.push({ v: null, num: p.toNumber() - qn, str: `${ps}${ps ? '− ' : '−'}${rad}`, mult: 1, kind: 'real' });
        } else {
          roots.push({ v: null, num: { re: p.toNumber(), im: qn }, str: `${ps}${ps ? '+ ' : ''}${rad}`, mult: 1, kind: 'complex' });
          roots.push({ v: null, num: { re: p.toNumber(), im: -qn }, str: `${ps}${ps ? '− ' : '−'}${rad}`, mult: 1, kind: 'complex' });
        }
      }
    } else if (deg >= 3) {
      durandKerner(c.map((a) => a.toNumber())).forEach((z) => {
        const real = Math.abs(z.im) < 1e-9;
        roots.push({ v: null, num: real ? z.re : z, str: '≈ ' + (real ? MX.fmtNumber(z.re) : MX.fmtComplex(z)), mult: 1, kind: real ? 'real' : 'complex' });
      });
    }
    return roots;
  }
  MX.polyRoots = polyRoots;
  function durandKerner(c) {
    const n = c.length - 1; const lead = c[n];
    const a = c.map((x) => x / lead);
    const mul = (x, y) => ({ re: x.re * y.re - x.im * y.im, im: x.re * y.im + x.im * y.re });
    const subc = (x, y) => ({ re: x.re - y.re, im: x.im - y.im });
    const div = (x, y) => { const d = y.re * y.re + y.im * y.im; return { re: (x.re * y.re + x.im * y.im) / d, im: (x.im * y.re - x.re * y.im) / d }; };
    const ev = (z) => { let acc = { re: 1, im: 0 }; for (let k = n - 1; k >= 0; k--) acc = { re: acc.re * z.re - acc.im * z.im + a[k], im: acc.re * z.im + acc.im * z.re }; return acc; };
    let z = Array.from({ length: n }, (_, k) => { const r = Math.pow(0.4, k); return { re: r * Math.cos(0.9 * k) , im: r * Math.sin(0.9 * k) + 0.1 }; });
    const R = 1 + Math.max(...a.slice(0, n).map(Math.abs));
    z = z.map((w, k) => ({ re: R * Math.cos((2 * Math.PI * k) / n + 0.4), im: R * Math.sin((2 * Math.PI * k) / n + 0.4) }));
    for (let it = 0; it < 500; it++) {
      let delta = 0;
      z = z.map((zi, i) => {
        let den = { re: 1, im: 0 };
        z.forEach((zj, j) => { if (i !== j) den = mul(den, subc(zi, zj)); });
        const step = div(ev(zi), den);
        delta = Math.max(delta, Math.hypot(step.re, step.im));
        return subc(zi, step);
      });
      if (delta < 1e-14) break;
    }
    return z.map((w) => ({ re: Math.abs(w.re) < 1e-11 ? 0 : w.re, im: Math.abs(w.im) < 1e-9 ? 0 : w.im })).sort((x, y) => y.re - x.re);
  }

  function rrefFloat(A, tol = 1e-9) {
    const R = A.map((r) => r.slice()); const m = R.length, n = R[0].length; const piv = []; let r = 0;
    for (let c = 0; c < n && r < m; c++) {
      let p = r; for (let i = r + 1; i < m; i++) if (Math.abs(R[i][c]) > Math.abs(R[p][c])) p = i;
      if (Math.abs(R[p][c]) < tol) continue;
      [R[r], R[p]] = [R[p], R[r]];
      const d = R[r][c]; R[r] = R[r].map((x) => x / d);
      for (let i = 0; i < m; i++) if (i !== r) { const fct = R[i][c]; R[i] = R[i].map((x, j) => x - fct * R[r][j]); }
      piv.push([r, c]); r++;
    }
    return { R, piv };
  }
  function nullFloat(A) {
    const n = A[0].length; const { R, piv } = rrefFloat(A, 1e-7);
    const pc = piv.map((p) => p[1]);
    const out = [];
    for (let fj = 0; fj < n; fj++) if (!pc.includes(fj)) {
      const v = Array(n).fill(0); v[fj] = 1; piv.forEach(([r, c]) => { v[c] = -R[r][fj]; });
      const nr = Math.hypot(...v); out.push(v.map((x) => x / nr));
    }
    return out;
  }

  function eigenvalueSteps(A, S) {
    const n = M.rows(A);
    const sym = A.map((r, i) => r.map((x, j) => (i === j ? (x.isZero() ? '−λ' : `${f(x)} − λ`) : x)));
    S.add('Characteristic equation', { text: 'λ is an eigenvalue exactly when A − λI is singular, i.e. det(A − λI) = 0. We compute p(λ) = det(λI − A) (same roots).', mats: [snap('A − λI', sym, { diag: true })] });
    if (n <= 4) S.add('Coefficients from principal minors', { text: `p(λ) = λⁿ − E₁λⁿ⁻¹ + E₂λⁿ⁻² − … + (−1)ⁿEₙ, where Eₖ is the sum of all k×k principal minors (determinants of submatrices keeping the same row and column indices).` });
    const c = charPoly(A, S);
    S.add('Characteristic polynomial', { eq: `p(λ) = ${polyStr(c)}` });
    const roots = polyRoots(c);
    const rat = roots.filter((r) => r.kind === 'rational');
    S.add('Find the roots', {
      text: (rat.length ? 'Rational roots are found with the rational root theorem (candidates ±p/q with p dividing the constant term and q dividing the leading coefficient), dividing out each root found. ' : '') + (roots.some((r) => r.kind !== 'rational') ? 'Any remaining quadratic factor is solved with the quadratic formula; higher-degree remainders are solved numerically.' : ''),
      eq: roots.map((r) => `${lamEq(r)}${r.mult > 1 ? `   (multiplicity ${r.mult})` : ''}`).join('\n'),
    });
    return { c, roots };
  }
  def('charpoly', {
    name: 'Characteristic polynomial', short: 'p(λ)', group: 'Eigen',
    run([A], o, S) {
      square(A, 'The characteristic polynomial');
      const n = M.rows(A);
      const sym = A.map((r, i) => r.map((x, j) => (i === j ? `λ − ${pv(x)}` : f(x.neg()))));
      S.add('Set up λI − A', { mats: [snap('λI − A', sym, { diag: true })] });
      if (n <= 4) S.add('Use principal minors', { text: 'p(λ) = det(λI − A) = λⁿ − E₁λⁿ⁻¹ + E₂λⁿ⁻² − … + (−1)ⁿEₙ, where Eₖ is the sum of all k×k principal minors of A.' });
      const c = charPoly(A, S);
      S.add('Result', { eq: `p(λ) = ${polyStr(c)}` });
      return { kind: 'text', label: 'p(λ)', text: `p(λ) = det(λI − A) = ${polyStr(c)}` };
    },
  });
  function eigText(roots) { return roots.map((r) => `${lamEq(r)}${r.mult > 1 ? ` (alg. multiplicity ${r.mult})` : ''}`).join('\n'); }
  def('eigvals', {
    name: 'Eigenvalues', short: 'eig', group: 'Eigen',
    run([A], o, S) {
      square(A, 'Eigenvalues');
      const { roots } = eigenvalueSteps(A, S);
      return { kind: 'text', label: 'Eigenvalues', text: eigText(roots) };
    },
  });
  function eigenvectors(A, S, roots) {
    const n = M.rows(A);
    const out = [];
    for (const r of roots) {
      if (r.kind === 'rational') {
        const B = M.sub(A, M.scale(M.identity(n), r.v));
        const g = gauss(B, { reduced: true, normalize: true });
        const { basis } = nullBasis(g.M, g.pivots, n);
        S.add(`Eigenvectors for λ = ${r.str}`, { text: `Solve (A − ${pv(r.v)}I)x = 0. Row-reduce and read off the null space. Geometric multiplicity = ${basis.length}${r.mult > basis.length ? ` < algebraic multiplicity ${r.mult}` : ''}.`, mats: [snap(`A − ${pv(r.v)}I`, B), snap('RREF', g.M, { pivots: g.pivots })].concat(basis.map((v, t) => snap('v' + sub(t + 1), v))) });
        out.push({ root: r, vecs: basis, exact: true });
      } else if (r.kind === 'real') {
        const An = M.toNum(A).map((row, i) => row.map((x, j) => (i === j ? x - r.num : x)));
        const vs = nullFloat(An);
        S.add(`Eigenvectors for ${lamEq(r)}`, { text: 'This eigenvalue is irrational, so the null space of A − λI is computed numerically (vectors normalised to length 1).', mats: vs.map((v, t) => snap('v' + sub(t + 1), v.map((x) => [x]))) });
        out.push({ root: r, vecs: vs.map((v) => v.map((x) => [x])), exact: false });
      } else {
        S.add(`λ = ${r.str} is complex`, { text: 'Complex eigenvalues have complex eigenvectors; those are not computed here.' });
        out.push({ root: r, vecs: [], exact: false });
      }
    }
    return out;
  }
  def('eigvecs', {
    name: 'Eigenvalues & eigenvectors', short: 'eigvec', group: 'Eigen',
    run([A], o, S) {
      square(A, 'Eigenvectors');
      const { roots } = eigenvalueSteps(A, S);
      const ev = eigenvectors(A, S, roots);
      const items = [{ kind: 'text', label: 'Eigenvalues', text: eigText(roots) }];
      ev.forEach((e) => e.vecs.forEach((v, t) => items.push({ kind: 'matrix', label: `v(λ=${e.root.str.replace(/^≈ /, '')})${e.vecs.length > 1 ? '_' + (t + 1) : ''}`, M: v })));
      return { kind: 'multi', items };
    },
  });
  def('diag', {
    name: 'Diagonalization A = PDP⁻¹', short: 'PDP⁻¹', group: 'Decompositions',
    run([A], o, S) {
      square(A, 'Diagonalization');
      const n = M.rows(A);
      S.add('Plan', { text: 'A is diagonalizable when it has n linearly independent eigenvectors. Put them as the columns of P and the matching eigenvalues on the diagonal of D; then A = PDP⁻¹.', mats: [snap('A', A)] });
      const { roots } = eigenvalueSteps(A, S);
      if (roots.some((r) => r.kind === 'complex')) {
        S.add('Not diagonalizable over ℝ', { text: 'A has complex eigenvalues, so it cannot be diagonalized using real matrices.' });
        return { kind: 'text', label: 'Diagonalization', text: 'Not diagonalizable over the reals (complex eigenvalues):\n' + eigText(roots) };
      }
      const ev = eigenvectors(A, S, roots);
      const total = ev.reduce((s, e) => s + e.vecs.length, 0);
      if (total < n) {
        const bad = ev.filter((e) => e.vecs.length < e.root.mult).map((e) => `λ = ${e.root.str}`);
        S.add('Not diagonalizable', { text: `Only ${total} independent eigenvectors exist but ${n} are needed. The geometric multiplicity is smaller than the algebraic multiplicity for ${bad.join(', ')} (a defective eigenvalue).` });
        return { kind: 'text', label: 'Diagonalization', text: `A is not diagonalizable: only ${total} independent eigenvectors (need ${n}).` };
      }
      const allExact = ev.every((e) => e.exact);
      const cols = []; const dv = [];
      ev.forEach((e) => e.vecs.forEach((v) => { cols.push(v.map((x) => x[0])); dv.push(e.root.v || e.root.num); }));
      let P = Array.from({ length: n }, (_, i) => cols.map((c) => c[i]));
      let D, Pinv;
      if (allExact) {
        D = M.zeros(n, n); dv.forEach((x, i) => { D[i][i] = x; });
        Pinv = inverseQuick(P);
      } else {
        P = P.map((r) => r.map((x) => (x instanceof Frac ? x.toNumber() : x)));
        D = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? (dv[i] instanceof Frac ? dv[i].toNumber() : dv[i]) : 0)));
        const Pi = rrefFloat(P.map((r, i) => r.concat(Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))));
        Pinv = Pi.R.map((r) => r.slice(n));
      }
      S.add('Assemble P, D and P⁻¹', { text: 'Column k of P is an eigenvector for the k-th diagonal entry of D.' + (allExact ? '' : ' (Some eigenvalues are irrational, so these are numeric.)'), mats: [snap('P', P), snap('D', D, { diag: true }), snap('P⁻¹', Pinv)] });
      return { kind: 'multi', items: [{ kind: 'matrix', label: 'P', M: P }, { kind: 'matrix', label: 'D', M: D }, { kind: 'matrix', label: 'Pinv', M: Pinv }] };
    },
  });

  function jacobiEigen(Sym) {
    const n = Sym.length; const a = Sym.map((r) => r.slice());
    const V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
    for (let sweep = 0; sweep < 100; sweep++) {
      let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
      if (off < 1e-22) break;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
        for (let k = 0; k < n; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
        for (let k = 0; k < n; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
      }
    }
    return { vals: a.map((r, i) => r[i]), V };
  }
  const clean = (x) => (Math.abs(x) < 1e-10 ? 0 : x);
  def('svd', {
    name: 'Singular value decomposition (SVD)', short: 'SVD', group: 'Decompositions',
    run([A], o, S) {
      const m = M.rows(A), n = M.cols(A);
      const AtA = M.mul(M.transpose(A), A);
      S.add('Compute AᵀA', { text: 'A = UΣVᵀ. The columns of V are eigenvectors of the symmetric matrix AᵀA, and the singular values σᵢ are the square roots of its eigenvalues.', mats: [snap('A', A), snap('AᵀA', AtA)] });
      const { vals, V } = jacobiEigen(M.toNum(AtA));
      const order = vals.map((v, i) => i).sort((i, j) => vals[j] - vals[i]);
      const lam = order.map((i) => Math.max(0, vals[i]));
      const Vs = V.map((r) => order.map((i) => r[i]));
      const sig = lam.map(Math.sqrt);
      S.add('Eigenvalues of AᵀA → singular values', { text: 'Sort the eigenvalues from largest to smallest and take square roots (numerically, using the Jacobi method).', eq: lam.map((l, i) => `λ${sub(i + 1)} = ${MX.fmtNumber(l)}  →  σ${sub(i + 1)} = ${MX.fmtNumber(sig[i])}`).join('\n'), mats: [snap('V', Vs.map((r) => r.map(clean)))] });
      const An = M.toNum(A);
      const Ucols = [];
      for (let i = 0; i < Math.min(m, n); i++) {
        if (sig[i] < 1e-10) break;
        const v = Vs.map((r) => r[i]);
        Ucols.push(An.map((row) => row.reduce((s, x, k) => s + x * v[k], 0) / sig[i]));
      }
      const r = Ucols.length;
      // complete U with Gram–Schmidt on standard basis
      for (let e = 0; e < m && Ucols.length < m; e++) {
        let w = Array.from({ length: m }, (_, i) => (i === e ? 1 : 0));
        for (const u of Ucols) { const d = u.reduce((s, x, i) => s + x * w[i], 0); w = w.map((x, i) => x - d * u[i]); }
        const nr = Math.hypot(...w); if (nr > 1e-8) Ucols.push(w.map((x) => x / nr));
      }
      const U = Array.from({ length: m }, (_, i) => Ucols.map((c) => clean(c[i])));
      const Sig = Array.from({ length: m }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? clean(sig[i] || 0) : 0)));
      S.add('Columns of U', { text: `For each nonzero σᵢ, uᵢ = Avᵢ / σᵢ. ${r < m ? 'The remaining columns of U are completed to an orthonormal basis.' : ''}`, mats: [snap('U', U)] });
      S.add('Result: A = UΣVᵀ', { text: `rank(A) = number of nonzero singular values = ${r}.`, mats: [snap('U', U), snap('Σ', Sig, { diag: true }), snap('Vᵀ', M.transpose(Vs).map((row) => row.map(clean)))] });
      return { kind: 'multi', items: [{ kind: 'matrix', label: 'U', M: U }, { kind: 'matrix', label: 'Sigma', M: Sig }, { kind: 'matrix', label: 'V', M: Vs.map((row) => row.map(clean)) }] };
    },
  });

  def('props', {
    name: 'Properties overview', short: 'props', group: 'Other',
    run([A], o, S) {
      const m = M.rows(A), n = M.cols(A);
      const sq = m === n;
      const rank = gauss(A, {}).rank;
      const lines = [`Size: ${m}×${n}${sq ? ' (square)' : ''}`, `Rank: ${rank}   Nullity: ${n - rank}`];
      if (sq) {
        const d = detQuick(A);
        const T = M.transpose(A);
        const isI = M.eq(A, M.identity(n));
        const upper = A.every((r, i) => r.every((x, j) => j >= i || x.isZero()));
        const lower = A.every((r, i) => r.every((x, j) => j <= i || x.isZero()));
        lines.push(`Determinant: ${f(d)}`, `Trace: ${f(M.trace(A))}`, `Invertible: ${d.isZero() ? 'no' : 'yes'}`, `Symmetric: ${M.eq(A, T) ? 'yes' : 'no'}`, `Skew-symmetric: ${M.eq(A, M.scale(T, ONE.neg())) ? 'yes' : 'no'}`, `Orthogonal (AᵀA = I): ${M.eq(M.mul(T, A), M.identity(n)) ? 'yes' : 'no'}`, `Identity: ${isI ? 'yes' : 'no'}`, `Diagonal: ${upper && lower ? 'yes' : 'no'}`, `Upper triangular: ${upper ? 'yes' : 'no'}`, `Lower triangular: ${lower ? 'yes' : 'no'}`, `Idempotent (A² = A): ${M.eq(M.mul(A, A), A) ? 'yes' : 'no'}`);
      }
      S.add('Properties', { eq: lines.join('\n'), mats: [snap('A', A)] });
      return { kind: 'text', label: 'Properties', text: lines.join('\n') };
    },
  });

  /** Run an operation; returns { result, steps, error } */
  MX.run = function (key, args, opts = {}, withSteps = true) {
    const op = ops[key];
    const S = new Steps(withSteps);
    try {
      const result = op.run(args, opts, S);
      return { result, steps: S.list };
    } catch (e) {
      return { error: e.message, steps: (e.steps || S).list };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
