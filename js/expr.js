/* A small expression language over scalars (Frac) and matrices (Frac[][]). */
(function (G) {
  'use strict';
  const MX = G.MX;
  const { Frac, M } = MX;
  const isMat = Array.isArray;

  const SUPMAP = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁻': '-' };
  function preprocess(s) {
    return String(s)
      .replace(/[−–]/g, '-').replace(/[×·⋅]/g, '*').replace(/÷/g, '/').replace(/ᵀ/g, "'")
      .replace(/[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (m) => '^(' + m.split('').map((c) => SUPMAP[c]).join('') + ')')
      .replace(/∘/g, '.*').replace(/⊗/g, ' kronop ');
  }
  function tokenize(src) {
    const s = preprocess(src); const toks = []; let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
      if (num) { toks.push({ t: 'num', v: num[0] }); i += num[0].length; continue; }
      const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
      if (id) { toks.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
      if (s.startsWith('.*', i)) { toks.push({ t: 'op', v: '.*' }); i += 2; continue; }
      if ('+-*/^(),;[]\'='.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
      throw new Error(`Unexpected character "${c}"`);
    }
    return toks;
  }

  const FUNCS = {
    inv: 'inverse', inverse: 'inverse', det: 'det', rref: 'rref', ref: 'ref', rank: 'rank', tr: 'trace', trace: 'trace',
    adj: 'adj', cof: 'cofactor', cofactor: 'cofactor', null: 'null', kernel: 'null', col: 'colspace', colspace: 'colspace', row: 'rowspace', rowspace: 'rowspace',
    solve: 'solve', solveaug: 'solveaug', lstsq: 'lstsq', kron: 'kron', had: 'hadamard', hadamard: 'hadamard', lu: 'lu', qr: 'qr', svd: 'svd',
    eig: 'eigvecs', eigvals: 'eigvals', eigvecs: 'eigvecs', charpoly: 'charpoly', diagonalize: 'diag', props: 'props', transpose: 'transpose',
  };
  MX.exprFuncs = FUNCS;

  function asScalar(v, what) {
    if (v instanceof Frac) return v;
    if (isMat(v) && v.length === 1 && v[0].length === 1) return v[0][0];
    throw new Error(`${what} must be a number`);
  }
  function opResult(key, args) {
    const r = MX.run(key, args, {}, false);
    if (r.error) throw new Error(r.error);
    const res = r.result;
    if (key === 'rank') return res.items[0].v;
    if (res.kind === 'matrix') return res.M.map((row) => row.map((x) => (x instanceof Frac ? x : Frac.fromNumber(x, 10))));
    if (res.kind === 'scalar') return res.v;
    return { special: res };
  }
  function add(a, b, sign) {
    if (a instanceof Frac && b instanceof Frac) return sign > 0 ? a.add(b) : a.sub(b);
    if (isMat(a) && isMat(b)) {
      if (M.rows(a) !== M.rows(b) || M.cols(a) !== M.cols(b)) throw new Error(`Size mismatch: ${M.dimStr(a)} ${sign > 0 ? '+' : '−'} ${M.dimStr(b)}`);
      return sign > 0 ? M.add(a, b) : M.sub(a, b);
    }
    if (isMat(a) && a.length === 1 && a[0].length === 1) return add(a[0][0], b, sign);
    if (isMat(b) && b.length === 1 && b[0].length === 1) return add(a, b[0][0], sign);
    throw new Error('Cannot add a number and a matrix (use k*I for a multiple of the identity)');
  }
  function mul(a, b) {
    if (a instanceof Frac && b instanceof Frac) return a.mul(b);
    if (a instanceof Frac) return M.scale(b, a);
    if (b instanceof Frac) return M.scale(a, b);
    if (a.length === 1 && a[0].length === 1 && M.rows(b) !== 1) return M.scale(b, a[0][0]);
    if (b.length === 1 && b[0].length === 1 && M.cols(a) !== 1) return M.scale(a, b[0][0]);
    return M.mul(a, b);
  }
  function div(a, b) {
    if (b instanceof Frac || (isMat(b) && b.length === 1 && b[0].length === 1)) {
      b = asScalar(b);
      if (b.isZero()) throw new Error('Division by zero');
      return a instanceof Frac ? a.div(b) : M.scale(a, b.inv());
    }
    return mul(a, MX.inverse(b));
  }
  function power(a, b) {
    if (b === 'T') { if (!isMat(a)) return a; return M.transpose(a); }
    const k = asScalar(b, 'Exponent');
    if (a instanceof Frac) { if (!k.isInt()) throw new Error('Only integer exponents are supported'); return a.pow(Number(k.n)); }
    if (!k.isInt()) throw new Error('Matrix powers must be integers');
    return opResult('pow', [a, Number(k.n)]);
  }

  /**
   * Evaluate an expression.
   * resolve(name) → Frac | Frac[][] | undefined
   */
  function evaluate(src, resolve) {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const isOp = (v) => toks[p] && toks[p].t === 'op' && toks[p].v === v;
    const eat = (v) => { if (!isOp(v)) throw new Error(`Expected "${v}"`); p++; };
    function expr() {
      let v = term();
      while (isOp('+') || isOp('-')) { const s = toks[p++].v === '+' ? 1 : -1; v = add(v, term(), s); }
      return v;
    }
    function startsPrimary() { const t = peek(); return t && (t.t === 'num' || (t.t === 'id' && t.v !== 'kronop') || (t.t === 'op' && (t.v === '(' || t.v === '['))); }
    function term() {
      let v = unary();
      for (;;) {
        if (isOp('*')) { p++; v = mul(v, unary()); }
        else if (isOp('/')) { p++; v = div(v, unary()); }
        else if (isOp('.*')) { p++; v = opResult('hadamard', [v, unary()]); }
        else if (peek() && peek().t === 'id' && peek().v === 'kronop') { p++; v = opResult('kron', [v, unary()]); }
        else if (startsPrimary()) { v = mul(v, power_()); } // implicit multiplication: 2A, 3R1, (A)(B)
        else break;
      }
      return v;
    }
    function unary() {
      if (isOp('-')) { p++; const v = unary(); return v instanceof Frac ? v.neg() : M.scale(v, Frac.ONE.neg()); }
      if (isOp('+')) { p++; return unary(); }
      return power_();
    }
    function power_() {
      let v = postfix();
      if (isOp('^')) {
        p++;
        if (peek() && peek().t === 'id' && peek().v === 'T' && resolve('T') === undefined) { p++; return power(v, 'T'); }
        const e = unary();
        v = power(v, e);
      }
      return v;
    }
    function postfix() {
      let v = primary();
      while (isOp("'")) { p++; v = power(v, 'T'); }
      return v;
    }
    function primary() {
      const t = toks[p];
      if (!t) throw new Error('Unexpected end of expression');
      if (t.t === 'num') { p++; return Frac.tryParse(t.v); }
      if (t.t === 'op' && t.v === '(') { p++; const v = expr(); eat(')'); return v; }
      if (t.t === 'op' && t.v === '[') { return literal(); }
      if (t.t === 'id') {
        p++;
        const name = t.v;
        if (isOp('(')) {
          p++;
          const args = [];
          if (!isOp(')')) { args.push(expr()); while (isOp(',')) { p++; args.push(expr()); } }
          eat(')');
          return call(name, args);
        }
        const v = resolve(name);
        if (v !== undefined) return v;
        if (name === 'I' || name === 'eye') throw new Error('Use I(n) for the n×n identity');
        throw new Error(`Unknown name "${name}"`);
      }
      throw new Error(`Unexpected "${t.v}"`);
    }
    function literal() {
      eat('[');
      const rows = [[]];
      while (!isOp(']')) {
        if (isOp(';')) { p++; rows.push([]); continue; }
        if (isOp(',')) { p++; continue; }
        rows[rows.length - 1].push(asScalar(unary(), 'Matrix entry'));
      }
      eat(']');
      const n = rows[0].length;
      if (!rows.every((r) => r.length === n)) throw new Error('All rows of a matrix literal must have the same length');
      return rows;
    }
    function call(name, args) {
      const lname = name.toLowerCase();
      const intArg = (v) => { const k = asScalar(v, 'Size'); if (!k.isInt() || k.sign() < 0) throw new Error('Sizes must be non-negative integers'); return Number(k.n); };
      if (lname === 'i' || lname === 'eye' || lname === 'identity') return M.identity(intArg(args[0]));
      if (lname === 'zeros') return M.zeros(intArg(args[0]), intArg(args[1] ?? args[0]));
      if (lname === 'ones') { const m = intArg(args[0]), n = intArg(args[1] ?? args[0]); return M.zeros(m, n).map((r) => r.map(() => Frac.ONE)); }
      if (lname === 't') return power(args[0], 'T');
      if (lname === 'pow') return power(args[0], args[1]);
      if (lname === 'abs') return asScalar(args[0], 'abs()').abs();
      if (lname === 'dot') { const a = args[0].flat(), b = args[1].flat(); if (a.length !== b.length) throw new Error('dot(): vectors differ in length'); return a.reduce((s, x, i) => s.add(x.mul(b[i])), Frac.ZERO); }
      if (lname === 'diagm' || lname === 'diag_') { const vals = args.length === 1 && isMat(args[0]) ? args[0].flat() : args.map((a) => asScalar(a, 'diag entry')); return vals.map((v, i) => vals.map((_, j) => (i === j ? v : Frac.ZERO))); }
      const key = FUNCS[lname];
      if (!key) throw new Error(`Unknown function "${name}()"`);
      const op = MX.ops[key];
      const want = op.inputs.length;
      if (args.length !== want) throw new Error(`${name}() takes ${want} argument${want > 1 ? 's' : ''}`);
      const conv = args.map((a, i) => {
        const kind = op.inputs[i].kind;
        if (kind === 'scalar') return asScalar(a, 'Argument');
        if (kind === 'int') return Number(asScalar(a, 'Argument').n);
        if (a instanceof Frac) return [[a]];
        if (!isMat(a)) throw new Error(`Argument ${i + 1} of ${name}() must be a matrix`);
        return a;
      });
      return opResult(key, conv);
    }
    const v = expr();
    if (p < toks.length) throw new Error(`Unexpected "${toks[p].v}"`);
    return v;
  }
  MX.evaluate = evaluate;

  /** Parse "Name = expr" or "expr". */
  MX.parseCommand = function (src) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)(.*)$/s.exec(src);
    if (m) return { name: m[1], expr: m[2] };
    return { name: null, expr: src };
  };

  MX.evalScalar = function (s) {
    const v = evaluate(s, () => undefined);
    if (!(v instanceof Frac)) throw new Error('Not a number: ' + s);
    return v;
  };
})(typeof window !== 'undefined' ? window : globalThis);
