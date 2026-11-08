const test = require('node:test');
const assert = require('node:assert/strict');
const MX = require('./load.js');
const { layout, align } = MX.OCR;

// Fake ink blobs: digits are 10 wide × 20 tall, a minus is 10 × 3 at mid-height.
let id = 0;
const digit = (x, y) => ({ id: ++id, x0: x, x1: x + 9, y0: y, y1: y + 19 });
const minus = (x, y) => ({ id: ++id, x0: x, x1: x + 9, y0: y + 9, y1: y + 11 });
const dot = (x, y) => ({ id: ++id, x0: x, x1: x + 2, y0: y + 17, y1: y + 19 });
const shape = (L) => L.rows.map((r) => r.map((n) => (n.neg ? '-' : '') + n.comps.filter((k) => k.y1 - k.y0 > 5).length));

test('groups rows, numbers and minus signs (spaced "- 6" style)', () => {
  // row 1: 0   1  - 6   6     row 2: 1  - 2   8  - 7
  const comps = [digit(0, 0), digit(60, 0), minus(105, 0), digit(122, 0), digit(180, 0),
    digit(0, 40), minus(45, 40), digit(62, 40), digit(120, 40), minus(165, 40), digit(182, 40)];
  const L = layout(comps);
  assert.deepEqual(shape(L), [['1', '1', '-1', '1'], ['1', '-1', '1', '-1']]);
});
test('multi-digit numbers and decimals stay together', () => {
  const comps = [digit(0, 0), digit(12, 0), dot(24, 0), digit(29, 0), digit(90, 0)];
  const L = layout(comps);
  assert.equal(L.rows.length, 1);
  assert.equal(L.rows[0].length, 2);
  assert.equal(L.rows[0][0].comps.length, 4);
});
test('align pads short rows into the right columns', () => {
  const g = align([[{ t: '1', cx: 0 }, { t: '2', cx: 50 }, { t: '3', cx: 100 }], [{ t: '4', cx: 2 }, { t: '6', cx: 98 }]]);
  assert.deepEqual(g, [['1', '2', '3'], ['4', '', '6']]);
});
test('token clean-up', () => {
  assert.equal(MX.OCR.cleanToken(' 1O.5\n'), '10.5');
  assert.equal(MX.OCR.cleanToken('3/4.'), '3/4');
});
