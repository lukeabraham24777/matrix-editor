/* Read a matrix from a screenshot or photo: image clean-up + Tesseract OCR + grid reconstruction. */
(function (G) {
  'use strict';
  const MX = (G.MX = G.MX || {});
  const OCR = (MX.OCR = {});
  const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

  /* ---------------- layout analysis (pure; unit-tested) ---------------- */
  const median = (a) => { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

  /**
   * Group ink blobs into rows and numbers.
   * comps: [{ id, x0, x1, y0, y1 }] (inclusive pixel bounds, brackets already removed)
   * Returns { H, rows: [[{ neg, comps: [...], x0, x1, y0, y1, cx }]] }
   */
  OCR.layout = function (comps) {
    comps = comps.map((k) => ({ ...k, w: k.x1 - k.x0 + 1, h: k.y1 - k.y0 + 1, cy: (k.y0 + k.y1) / 2 }));
    const H = median(comps.filter((k) => k.h >= k.w * 0.9 && k.h >= 5).map((k) => k.h));
    if (!H) return { H: 0, rows: [] };
    const big = comps.filter((k) => k.h >= H * 0.5).sort((a, b) => a.cy - b.cy);
    const rows = [];
    for (const k of big) {
      const r = rows.find((r2) => Math.min(r2.y1, k.y1) - Math.max(r2.y0, k.y0) > Math.min(r2.y1 - r2.y0, k.h) * 0.4);
      if (r) { r.items.push(k); r.y0 = Math.min(r.y0, k.y0); r.y1 = Math.max(r.y1, k.y1); }
      else rows.push({ y0: k.y0, y1: k.y1, items: [k] });
    }
    for (const k of comps) {
      if (k.h >= H * 0.5) continue;
      const r = rows.find((r2) => k.cy >= r2.y0 - H * 0.15 && k.cy <= r2.y1 + H * 0.15);
      if (r) { k.small = true; r.items.push(k); }
    }
    rows.sort((a, b) => a.y0 - b.y0);
    const out = rows.map((r) => {
      const mid = (r.y0 + r.y1) / 2, rh = r.y1 - r.y0 + 1;
      const items = r.items.sort((a, b) => a.x0 - b.x0);
      items.forEach((k) => { k.minus = k.small && k.w >= k.h * 1.4 && Math.abs(k.cy - mid) < rh * 0.3; });
      // cluster into numbers by horizontal gap
      const clusters = [];
      for (const k of items) {
        if (k.minus) { clusters.push({ minus: true, items: [k], x0: k.x0, x1: k.x1 }); continue; }
        const c = clusters[clusters.length - 1];
        if (c && !c.minus && k.x0 - c.x1 < H * 0.42) { c.items.push(k); c.x1 = Math.max(c.x1, k.x1); }
        else clusters.push({ items: [k], x0: k.x0, x1: k.x1 });
      }
      // attach each minus to the number on its right when it is closer to it than to the one on its left
      const nums = [];
      clusters.forEach((c, i) => {
        if (!c.minus) { nums.push({ neg: false, comps: c.items, x0: c.x0, x1: c.x1 }); return; }
        const nx = clusters[i + 1], pv = clusters[i - 1];
        if (nx && !nx.minus && nx.x0 - c.x1 < H * 1.6 && (!pv || nx.x0 - c.x1 <= c.x0 - pv.x1 + H * 0.2)) nx.neg = !nx.neg;
      });
      clusters.forEach((c) => { if (!c.minus && c.neg) { const n = nums.find((x) => x.comps === c.items); n.neg = true; } });
      return nums.filter((n) => n.comps.some((k) => !k.small)).map((n) => {
        n.y0 = Math.min(...n.comps.map((k) => k.y0)); n.y1 = Math.max(...n.comps.map((k) => k.y1)); n.cx = (n.x0 + n.x1) / 2;
        return n;
      });
    }).filter((r) => r.length);
    return { H, rows: out };
  };

  /** Line up rows of {t, cx} into a rectangular grid ('' where nothing was found). */
  OCR.align = function (rows) {
    if (!rows.length) return null;
    const n = Math.max(...rows.map((r) => r.length));
    const anchors = rows.find((r) => r.length === n).map((w) => w.cx);
    // refine anchors with every full row
    const full = rows.filter((r) => r.length === n);
    for (let k = 0; k < n; k++) anchors[k] = full.reduce((s, r) => s + r[k].cx, 0) / full.length;
    return rows.map((r) => {
      if (r.length === n) return r.map((w) => w.t);
      const cells = Array(n).fill('');
      const used = new Set();
      r.forEach((w) => {
        let best = -1, bd = Infinity;
        anchors.forEach((ax, k) => { if (!used.has(k) && Math.abs(ax - w.cx) < bd) { bd = Math.abs(ax - w.cx); best = k; } });
        if (best >= 0) { used.add(best); cells[best] = w.t; }
      });
      return cells;
    });
  };
  OCR.cleanToken = (t) => String(t).replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/,/g, '.').replace(/[^0-9./]/g, '').replace(/^[./]+|[./]+$/g, '');

  /* ---------------- image clean-up ---------------- */
  /** Binarise (black ink on white), upscale, find ink blobs and drop brackets / bars. */
  OCR.preprocess = function (img) {
    const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
    const scale = Math.min(4, Math.max(1, 1400 / Math.max(w0, h0)));
    const W = Math.round(w0 * scale), H = Math.round(h0 * scale);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, W, H);
    const im = ctx.getImageData(0, 0, W, H); const d = im.data;
    const gray = new Uint8Array(W * H);
    const hist = new Uint32Array(256);
    let sum = 0;
    for (let i = 0; i < W * H; i++) { const g = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000 | 0; gray[i] = g; hist[g]++; sum += g; }
    // Otsu threshold
    let sumB = 0, wB = 0, best = 0, thr = 128; const total = W * H;
    let sumAll = 0; for (let t = 0; t < 256; t++) sumAll += t * hist[t];
    for (let t = 0; t < 256; t++) {
      wB += hist[t]; if (!wB) continue; const wF = total - wB; if (!wF) break;
      sumB += t * hist[t]; const mB = sumB / wB, mF = (sumAll - sumB) / wF;
      const v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; thr = t; }
    }
    const darkBg = sum / total < thr; // light text on a dark background
    const ink = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) ink[i] = darkBg ? (gray[i] > thr ? 1 : 0) : (gray[i] <= thr ? 1 : 0);
    // connected components: erase tall, thin shapes (brackets, parentheses, determinant bars)
    const lab = new Int32Array(W * H); const comps = []; const stack = new Int32Array(W * H);
    let id = 0;
    for (let s = 0; s < W * H; s++) {
      if (!ink[s] || lab[s]) continue;
      id++; let sp = 0; stack[sp++] = s; lab[s] = id;
      let x0 = W, x1 = 0, y0 = H, y1 = 0, area = 0;
      while (sp) {
        const p = stack[--sp]; const x = p % W, y = (p / W) | 0; area++;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && ink[p - 1] && !lab[p - 1]) { lab[p - 1] = id; stack[sp++] = p - 1; }
        if (x < W - 1 && ink[p + 1] && !lab[p + 1]) { lab[p + 1] = id; stack[sp++] = p + 1; }
        if (y > 0 && ink[p - W] && !lab[p - W]) { lab[p - W] = id; stack[sp++] = p - W; }
        if (y < H - 1 && ink[p + W] && !lab[p + W]) { lab[p + W] = id; stack[sp++] = p + W; }
      }
      comps[id] = { x0, x1, y0, y1, area, h: y1 - y0 + 1, w: x1 - x0 + 1 };
    }
    const hs = comps.filter(Boolean).filter((k) => k.h >= 6 && k.area >= 12).map((k) => k.h).sort((a, b) => a - b);
    const ref = hs.length ? hs[Math.floor(hs.length * 0.6)] : 0;
    const kill = new Uint8Array(id + 1);
    comps.forEach((k, i) => {
      if (!k) return;
      if (ref && k.h >= ref * 1.4 && k.h >= k.w * 2.2) kill[i] = 1; // bracket / bar / paren
      if (k.area < 4) kill[i] = 1; // specks
    });
    const out = ctx.createImageData(W + 40, H + 40);
    out.data.fill(255);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (ink[p] && !kill[lab[p]]) { const q = ((y + 20) * (W + 40) + x + 20) * 4; out.data[q] = out.data[q + 1] = out.data[q + 2] = 0; }
    }
    const c2 = document.createElement('canvas'); c2.width = W + 40; c2.height = H + 40;
    c2.getContext('2d').putImageData(out, 0, 0);
    const kept = [];
    comps.forEach((k, i) => { if (k && !kill[i]) kept.push({ id: i, x0: k.x0, x1: k.x1, y0: k.y0, y1: k.y1 }); });
    return { canvas: c2, comps: kept, lab, W, H };
  };

  /* ---------------- OCR engine ---------------- */
  let workerP = null;
  function loadScript(src) {
    return new Promise((res, rej) => { if (G.Tesseract) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load the OCR engine (are you offline?)')); document.head.append(s); });
  }
  let progressCb = null;
  function getWorker() {
    if (!workerP) {
      workerP = (async () => {
        await loadScript(TESS_URL);
        const w = await G.Tesseract.createWorker('eng', 1, { logger: (m) => progressCb && progressCb(m) });
        await w.setParameters({ tessedit_char_whitelist: '0123456789./', tessedit_pageseg_mode: '7' });
        return w;
      })().catch((e) => { workerP = null; throw e; });
    }
    return workerP;
  }
  // The OCR engine holds ~100 MB+ of WebAssembly memory: shut it down after a minute of no use.
  let idleTimer = null;
  function scheduleIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(async () => { const p = workerP; workerP = null; if (p) { try { (await p).terminate(); } catch (e) { /* ignore */ } } }, 60000);
  }
  OCR.release = () => { clearTimeout(idleTimer); const p = workerP; workerP = null; if (p) p.then((w) => w.terminate()).catch(() => {}); };
  function loadImage(src) {
    return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => rej(new Error('Could not read that image')); img.src = src; });
  }
  /** Render just the blobs of one number into a fresh, padded canvas. */
  function cropNumber(pre, num, H, target = 44) {
    const pad = Math.round(H * 0.45);
    const x0 = num.x0, y0 = Math.min(num.y0, num.comps.reduce((m, k) => Math.min(m, k.y0), Infinity));
    const w = num.x1 - x0 + 1, h = num.y1 - y0 + 1;
    const sc = Math.max(0.1, Math.min(3, target / H));
    const ids = new Set(num.comps.map((k) => k.id));
    const src = document.createElement('canvas'); src.width = w + 2 * pad; src.height = h + 2 * pad;
    const g = src.getContext('2d'); const im = g.createImageData(src.width, src.height); im.data.fill(255);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = (y0 + y) * pre.W + x0 + x;
      if (ids.has(pre.lab[p])) { const q = ((y + pad) * src.width + x + pad) * 4; im.data[q] = im.data[q + 1] = im.data[q + 2] = 0; }
    }
    g.putImageData(im, 0, 0);
    const c = document.createElement('canvas'); c.width = Math.round(src.width * sc); c.height = Math.round(src.height * sc);
    const g2 = c.getContext('2d'); g2.imageSmoothingQuality = 'high'; g2.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  /** blob/File → { rows: string[][], url } */
  OCR.read = async function (blob, onProgress) {
    progressCb = onProgress;
    const url = URL.createObjectURL(blob);
    const img = await loadImage(url);
    const pre = OCR.preprocess(img);
    const { H, rows } = OCR.layout(pre.comps);
    if (!rows.length) throw new Error('No numbers found in the image');
    clearTimeout(idleTimer);
    const worker = await getWorker();
    progressCb = null;
    const total = rows.reduce((s2, r) => s2 + r.length, 0); let done = 0;
    for (const r of rows) for (const num of r) {
      // try a few text sizes / segmentation modes until something is read
      let t = '';
      for (const [size, psm] of [[44, '7'], [30, '7'], [64, '7'], [44, '10'], [30, '8']]) {
        if (psm !== '7') await worker.setParameters({ tessedit_pageseg_mode: psm });
        t = OCR.cleanToken((await worker.recognize(cropNumber(pre, num, H, size))).data.text);
        if (psm !== '7') await worker.setParameters({ tessedit_pageseg_mode: '7' });
        if (t) break;
      }
      if (!t && num.comps.length === 1) { const k = num.comps[0]; if (k.y1 - k.y0 + 1 >= (k.x1 - k.x0 + 1) * 1.8) t = '1'; } // a lone narrow stroke is a 1
      num.t = t ? (num.neg ? '-' : '') + t : '';
      done++; if (onProgress) onProgress({ status: 'recognizing text', progress: done / total });
    }
    scheduleIdle();
    const grid = OCR.align(rows.map((r) => r.map((n) => ({ t: n.t, cx: n.cx }))));
    return { rows: grid, url };
  };
})(typeof window !== 'undefined' ? window : globalThis);
