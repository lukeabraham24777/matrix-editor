const test = require('node:test');
const assert = require('node:assert/strict');
const MX = require('./load.js');
const { M, Frac } = MX;
const P = (s) => M.fromStrings(M.parseText(s));
const T = (A) => M.toText(A, ' ');
const run = (k, args, o) => { const r = MX.run(k, args, o); if (r.error) throw new Error(r.error); assert.ok(r.steps.length > 0, 'has steps'); return r.result; };

test('fractions', () => {
  assert.equal(Frac.parse('3/6').toString(), '1/2');
  assert.equal(Frac.parse('-0.25').toString(), '-1/4');
  assert.equal(Frac.parse('1/3 + 2').toString(), '7/3');
  assert.equal(Frac.parse('2^-2').toString(), '1/4');
});
test('parse formats', () => {
  assert.deepEqual(M.parseText('1 2\n3 4'), [['1', '2'], ['3', '4']]);
  assert.deepEqual(M.parseText('[[1, 2], [3, 4]]'), [['1', '2'], ['3', '4']]);
  assert.deepEqual(M.parseText('[1 2; 3 4]'), [['1', '2'], ['3', '4']]);
  assert.deepEqual(M.parseText('1\t2\n3\t4'), [['1', '2'], ['3', '4']]);
  assert.equal(T(M.fromStrings(M.parseText('\\begin{bmatrix} 1 & \\frac{1}{2} \\\\ 3 & 4 \\end{bmatrix}'))), '1 1/2\n3 4');
});
test('multiply / add / transpose', () => {
  assert.equal(T(run('mul', [P('1 2\n3 4'), P('5 6\n7 8')]).M), '19 22\n43 50');
  assert.equal(T(run('add', [P('1 2'), P('3 4')]).M), '4 6');
  assert.equal(T(run('transpose', [P('1 2 3')]).M), '1\n2\n3');
  assert.equal(T(run('pow', [P('1 1\n0 1'), 5]).M), '1 5\n0 1');
  assert.equal(T(run('pow', [P('2 0\n0 4'), -1]).M), '1/2 0\n0 1/4');
  assert.throws(() => run('mul', [P('1 2'), P('1 2')]));
});
test('determinant methods agree', () => {
  const A = P('2 -1 0 3\n1 4 -2 0\n0 5 1 -1\n3 0 2 2');
  const d1 = run('det', [A], { method: 'cofactor' }).v, d2 = run('det', [A], { method: 'row' }).v;
  assert.ok(d1.eq(d2));
  assert.equal(run('det', [P('1 2\n2 4')]).v.toString(), '0');
});
test('inverse both methods', () => {
  const A = P('2 1 -1\n-3 -1 2\n-2 1 2');
  const I1 = run('inverse', [A]).M, I2 = run('inverse', [A], { method: 'adj' }).M;
  assert.ok(M.eq(I1, I2));
  assert.ok(M.eq(M.mul(A, I1), M.identity(3)));
  assert.ok(MX.run('inverse', [P('1 2\n2 4')]).error);
});
test('rref, rank, subspaces', () => {
  const A = P('1 2 3\n2 4 6\n1 0 1');
  assert.equal(T(run('rref', [A]).M), '1 0 1\n0 1 1\n0 0 0');
  assert.equal(run('rank', [A]).items[0].v.toString(), '2');
  const N = run('null', [A]).M;
  assert.ok(M.mul(A, N).every((r) => r.every((x) => x.isZero())));
  assert.equal(T(run('colspace', [A]).M), '1 2\n2 4\n1 0');
});
test('solve systems', () => {
  assert.equal(T(run('solve', [P('2 1 -1\n-3 -1 2\n-2 1 2'), P('8\n-11\n-3')]).M), '2\n3\n-1');
  assert.equal(run('solve', [P('1 1\n1 1'), P('1\n2')]).kind, 'text');
  assert.equal(run('solve', [P('1 2 3\n2 4 6'), P('1\n2')]).kind, 'multi');
  assert.equal(T(run('lstsq', [P('1 0\n1 1\n1 2'), P('6\n0\n0')]).M), '5\n-3');
});
test('LU and QR reconstruct A', () => {
  const A = P('2 1 1\n4 -6 0\n-2 7 2');
  const [L, U] = run('lu', [A]).items.map((i) => i.M);
  assert.ok(M.eq(M.mul(L, U), A));
  const B = P('0 1\n2 3');
  const [Pm, L2, U2] = run('lu', [B]).items.map((i) => i.M);
  assert.ok(M.eq(M.mul(Pm, B), M.mul(L2, U2)));
  const [Q, R] = run('qr', [P('3 0\n4 5')]).items.map((i) => i.M);
  assert.ok(M.eq(M.mul(Q, R), P('3 0\n4 5')));
});
test('eigen', () => {
  assert.equal(run('charpoly', [P('2 1\n1 2')]).text, 'p(λ) = det(λI − A) = λ² − 4λ + 3');
  assert.match(run('eigvals', [P('0 -1\n1 0')]).text, /λ = i/);
  const big = run('charpoly', [P('1 2 0 0 0\n3 4 0 0 0\n0 0 1 1 0\n0 0 0 2 0\n0 0 0 0 5')]).text;
  assert.match(big, /λ⁵/);
  const [Pm, D, Pi] = run('diag', [P('4 1\n2 3')]).items.map((i) => i.M);
  assert.ok(M.eq(M.mul(M.mul(Pm, D), Pi), P('4 1\n2 3')));
  assert.equal(run('diag', [P('1 1\n0 1')]).kind, 'text');
});
test('svd reconstructs', () => {
  const A = P('3 2 2\n2 3 -2');
  const [U, S, V] = run('svd', [A]).items.map((i) => i.M);
  const n = (X) => X.map((r) => r.map((x) => (typeof x === 'number' ? x : x.toNumber())));
  const mm = (X, Y) => X.map((r) => Y[0].map((_, j) => r.reduce((s, x, k) => s + x * Y[k][j], 0)));
  const R = mm(mm(n(U), n(S)), n(M.transpose(V)));
  R.forEach((r, i) => r.forEach((x, j) => assert.ok(Math.abs(x - A[i][j].toNumber()) < 1e-9)));
});
test('expressions', () => {
  const env = { A: P('1 2\n3 4'), B: P('0 1\n1 0') };
  const ev = (s) => MX.evaluate(s, (n) => env[n]);
  assert.equal(T(ev('A*B')), '2 1\n4 3');
  assert.equal(T(ev('2A - B')), '2 3\n5 8');
  assert.equal(T(ev("A'")), '1 3\n2 4');
  assert.equal(T(ev('A^T')), '1 3\n2 4');
  assert.equal(T(ev('A^-1 * A')), '1 0\n0 1');
  assert.equal(T(ev('A⁻¹A')), '1 0\n0 1');
  assert.equal(ev('det(A)').toString(), '-2');
  assert.equal(T(ev('[1 2; 3 4] + I(2)')), '2 2\n3 5');
  assert.equal(T(ev('rref(A)')), '1 0\n0 1');
  assert.deepEqual(MX.parseCommand('C = A*B'), { name: 'C', expr: ' A*B' });
});
test('solve augmented matrix [A | b]', () => {
  const unique = run('solveaug', [P('2 1 -1 8\n-3 -1 2 -11\n-2 1 2 -3')]);
  assert.equal(T(unique.M), '2\n3\n-1');
  assert.equal(run('solveaug', [P('1 2 4 3\n2 4 6 4\n4 6 8 0')]).kind, 'matrix');
  const gen = run('solveaug', [P('0 1 -6 6\n1 -2 8 -7')]);
  assert.equal(gen.kind, 'multi');
  assert.match(gen.items[0].text, /x = xₚ \+ s·v₁/);
  // particular solution + s·v must satisfy A x = b
  const A = P('0 1 -6\n1 -2 8'), b = P('6\n-7');
  const xp = gen.items[1].M, v = gen.items[2].M;
  assert.ok(M.eq(M.mul(A, xp), b));
  assert.ok(M.mul(A, v).every((r) => r[0].isZero()));
  assert.equal(run('solveaug', [P('1 1 1\n1 1 2')]).kind, 'text');
  assert.equal(T(MX.evaluate('solveaug([1 0 5; 0 1 7])', () => undefined)), '5\n7');
});
test('@MATX homework format', () => {
  assert.equal(M.toMATX(P('6\n0')), '@MATX{{6};{0}}');
  assert.equal(M.toMATX(P('2 1 -3\n0 6 3')), '@MATX{{2,1,-3};{0,6,3}}');
  assert.equal(M.toMATX(P('1/2 0.25')), '@MATX{{1/2,1/4}}');
  assert.deepEqual(M.parseText('@MATX{{2,1,-3};{0,6,3}}'), [['2', '1', '-3'], ['0', '6', '3']]);
  assert.deepEqual(M.parseText('@MATX{{6};{0}}'), [['6'], ['0']]);
});
