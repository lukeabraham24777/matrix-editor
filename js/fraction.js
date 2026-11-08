/* Exact rational arithmetic using BigInt. */
(function (G) {
  'use strict';
  const MX = (G.MX = G.MX || {});

  function bgcd(a, b) {
    if (a < 0n) a = -a;
    if (b < 0n) b = -b;
    while (b) { const t = a % b; a = b; b = t; }
    return a;
  }
  function babs(a) { return a < 0n ? -a : a; }

  class Frac {
    constructor(n, d = 1n) {
      n = BigInt(n); d = BigInt(d);
      if (d === 0n) throw new Error('Division by zero');
      if (d < 0n) { n = -n; d = -d; }
      const g = bgcd(n, d) || 1n;
      this.n = n / g; this.d = d / g;
    }
    static of(x) {
      if (x instanceof Frac) return x;
      if (typeof x === 'bigint') return new Frac(x);
      if (typeof x === 'number') return Frac.fromNumber(x);
      return Frac.parse(String(x));
    }
    static fromNumber(x, sig = 12) {
      if (!isFinite(x)) throw new Error('Not a finite number');
      if (Number.isInteger(x) && Math.abs(x) < 2 ** 53) return new Frac(BigInt(x));
      const s = String(parseFloat(x.toPrecision(sig)));
      return Frac.parseDecimal(s);
    }
    static parseDecimal(s) {
      const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(s);
      if (!m || (m[2] === '' && (m[3] === undefined || m[3] === ''))) return null;
      const sign = m[1] === '-' ? -1n : 1n;
      const ip = m[2] || '0', fp = m[3] || '';
      let n = BigInt(ip + fp) * sign;
      let d = 10n ** BigInt(fp.length);
      const e = m[4] ? parseInt(m[4], 10) : 0;
      if (Math.abs(e) > 400) return null;
      if (e > 0) n *= 10n ** BigInt(e); else if (e < 0) d *= 10n ** BigInt(-e);
      return new Frac(n, d);
    }
    /** Strict parse of "a", "a.b", "a/b", "-a/b". Returns null on failure. */
    static tryParse(s) {
      s = String(s).replace(/\s+/g, '').replace(/−/g, '-');
      if (s === '') return Frac.ZERO;
      const parts = s.split('/');
      if (parts.length === 1) return Frac.parseDecimal(parts[0]);
      if (parts.length === 2) {
        const a = Frac.parseDecimal(parts[0]), b = Frac.parseDecimal(parts[1]);
        if (!a || !b || b.isZero()) return null;
        return a.div(b);
      }
      return null;
    }
    static parse(s) {
      const f = Frac.tryParse(s);
      if (f) return f;
      if (MX.evalScalar) return MX.evalScalar(s);
      throw new Error('Cannot parse number: ' + s);
    }
    add(b) { b = Frac.of(b); return new Frac(this.n * b.d + b.n * this.d, this.d * b.d); }
    sub(b) { b = Frac.of(b); return new Frac(this.n * b.d - b.n * this.d, this.d * b.d); }
    mul(b) { b = Frac.of(b); return new Frac(this.n * b.n, this.d * b.d); }
    div(b) { b = Frac.of(b); if (b.n === 0n) throw new Error('Division by zero'); return new Frac(this.n * b.d, this.d * b.n); }
    neg() { return new Frac(-this.n, this.d); }
    inv() { return new Frac(this.d, this.n); }
    abs() { return new Frac(babs(this.n), this.d); }
    pow(k) {
      k = Number(k);
      if (!Number.isInteger(k)) throw new Error('Only integer powers of numbers are supported');
      if (k < 0) return this.inv().pow(-k);
      return new Frac(this.n ** BigInt(k), this.d ** BigInt(k));
    }
    isZero() { return this.n === 0n; }
    isOne() { return this.n === 1n && this.d === 1n; }
    isInt() { return this.d === 1n; }
    sign() { return this.n > 0n ? 1 : this.n < 0n ? -1 : 0; }
    eq(b) { b = Frac.of(b); return this.n === b.n && this.d === b.d; }
    cmp(b) { b = Frac.of(b); const x = this.n * b.d - b.n * this.d; return x > 0n ? 1 : x < 0n ? -1 : 0; }
    toNumber() {
      const n = Number(this.n), d = Number(this.d);
      if (isFinite(n) && isFinite(d)) return n / d;
      // scale down huge values
      const shift = BigInt(Math.max(this.n.toString().length, this.d.toString().length) - 300);
      const s = 10n ** (shift > 0n ? shift : 0n);
      return Number(this.n / s) / Number(this.d / s);
    }
    toString() { return this.d === 1n ? this.n.toString() : this.n + '/' + this.d; }
    toDecimal(digits = 6) { return MX.fmtNumber(this.toNumber(), digits); }
    toLatex() {
      if (this.d === 1n) return this.n.toString();
      const s = this.n < 0n ? '-' : '';
      return s + '\\frac{' + babs(this.n) + '}{' + this.d + '}';
    }
    /** Square root if exact rational, else null. */
    sqrt() {
      if (this.n < 0n) return null;
      const a = bisqrt(this.n), b = bisqrt(this.d);
      if (a * a === this.n && b * b === this.d) return new Frac(a, b);
      return null;
    }
  }
  function bisqrt(n) {
    if (n < 2n) return n;
    let x = BigInt(Math.floor(Math.sqrt(Number(n))));
    while (x * x > n) x--;
    while ((x + 1n) * (x + 1n) <= n) x++;
    return x;
  }
  Frac.ZERO = new Frac(0n);
  Frac.ONE = new Frac(1n);

  MX.Frac = Frac;
  MX.bgcd = bgcd;
  MX.bisqrt = bisqrt;

  MX.settings = MX.settings || { display: 'frac', digits: 6 };

  MX.fmtNumber = function (x, digits = 6) {
    if (typeof x !== 'number') x = Number(x);
    if (!isFinite(x)) return String(x);
    if (Math.abs(x) < 1e-12) return '0';
    let s = String(parseFloat(x.toPrecision(digits)));
    if (s.includes('e')) s = x.toPrecision(digits).replace(/\.?0+e/, 'e');
    return s;
  };

  /** Format any value that may appear in a matrix: Frac, number, complex, string. */
  MX.fmt = function (v, mode) {
    mode = mode || MX.settings.display;
    if (v == null) return '';
    if (v instanceof Frac) return mode === 'dec' && !v.isInt() ? v.toDecimal(MX.settings.digits) : v.toString();
    if (typeof v === 'number') return MX.fmtNumber(v, MX.settings.digits);
    if (typeof v === 'object' && 're' in v) return MX.fmtComplex(v);
    return String(v);
  };
  MX.fmtComplex = function (z) {
    const re = MX.fmtNumber(z.re), im = MX.fmtNumber(Math.abs(z.im));
    if (Math.abs(z.im) < 1e-10) return re;
    const sign = z.im < 0 ? ' − ' : ' + ';
    if (Math.abs(z.re) < 1e-10) return (z.im < 0 ? '−' : '') + im + 'i';
    return re + sign + im + 'i';
  };
})(typeof window !== 'undefined' ? window : globalThis);
