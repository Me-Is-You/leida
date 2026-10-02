import assert from "node:assert/strict";
import test from "node:test";
import { QR_VECTORS } from "./fixtures/qr-vectors.ts";
import { decodeQrMatrix, rsCorrect, alignmentPositions } from "./qr-decode.ts";
import { mulberry32 } from "./fixtures/prng.ts";

export function matrixOf(v: (typeof QR_VECTORS)[number]): Uint8Array {
  const m = new Uint8Array(v.size * v.size);
  for (let y = 0; y < v.size; y++) for (let x = 0; x < v.size; x++) m[y * v.size + x] = v.rows[y]![x] === "1" ? 1 : 0;
  return m;
}

test("decodes every reference symbol (v1‥v15, L/M/Q/H, numeric/alnum/byte/utf-8/mixed)", () => {
  for (const v of QR_VECTORS) {
    const r = decodeQrMatrix(matrixOf(v), v.size);
    assert.ok(r, `${v.name} failed to decode`);
    assert.equal(r.text, v.text, v.name);
    assert.equal(r.version, v.version);
    assert.equal(r.level, v.level);
    assert.equal(r.mask, v.mask);
    assert.equal(r.corrected, 0);
  }
});

test("corrects damaged modules via Reed–Solomon, rejects hopeless ones", () => {
  const rnd = mulberry32(5);
  const v = QR_VECTORS.find((q) => q.name === "url-M")!; // level M ≈ 15 % recoverable
  const m = matrixOf(v);
  // flip 12 random data-area modules (outside the 9×9 corners so the format info survives)
  let flipped = 0;
  while (flipped < 12) {
    const x = Math.floor(rnd() * v.size);
    const y = Math.floor(rnd() * v.size);
    if ((x < 9 && y < 9) || (x > v.size - 9 && y < 9) || (x < 9 && y > v.size - 9) || x === 6 || y === 6) continue;
    m[y * v.size + x] ^= 1;
    flipped++;
  }
  const r = decodeQrMatrix(m, v.size);
  assert.ok(r, "should recover");
  assert.equal(r.text, v.text);
  assert.ok(r.corrected > 0);
  // destroy half the symbol
  const bad = matrixOf(v);
  for (let i = 0; i < bad.length; i += 2) if (i > 100) bad[i] ^= 1;
  assert.equal(decodeQrMatrix(bad, v.size), null);
});

test("rsCorrect fixes up to nsym/2 byte errors at random positions and never mis-corrects silently", () => {
  const rnd = mulberry32(11);
  // build a codeword with the reference decoder's generator by taking a real block
  const v = QR_VECTORS.find((q) => q.name === "alnum-L")!; // 19 data + 7 ecc
  assert.ok(decodeQrMatrix(matrixOf(v), v.size));
  // synthetic: encode with a straightforward RS encoder (generator roots α^0…α^{n-1})
  const nsym = 10;
  const exp: number[] = [], log: number[] = new Array(256).fill(0);
  let x = 1;
  for (let i = 0; i < 255; i++) { exp[i] = x; log[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
  const mul = (a: number, b: number) => (a && b ? exp[(log[a]! + log[b]!) % 255]! : 0);
  let g = [1];
  for (let i = 0; i < nsym; i++) {
    const ng = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) { ng[j] ^= g[j]!; ng[j + 1] ^= mul(g[j]!, exp[i]!); }
    g = ng;
  }
  for (let trial = 0; trial < 200; trial++) {
    const data = Array.from({ length: 30 }, () => Math.floor(rnd() * 256));
    const rem = new Array(nsym).fill(0);
    for (const d of data) {
      const f = d ^ rem[0]!;
      rem.shift(); rem.push(0);
      for (let j = 0; j < nsym; j++) rem[j] ^= mul(g[j + 1]!, f);
    }
    const cw = Uint8Array.from([...data, ...rem]);
    const orig = Uint8Array.from(cw);
    const nErr = trial % 6; // 0‥5 = t
    const used = new Set<number>();
    while (used.size < nErr) used.add(Math.floor(rnd() * cw.length));
    for (const p of used) cw[p] ^= 1 + Math.floor(rnd() * 255);
    const r = rsCorrect(cw, nsym);
    assert.equal(r, nErr, `trial ${trial}`);
    assert.deepEqual([...cw], [...orig]);
  }
});

test("alignment pattern positions match the standard for known versions", () => {
  assert.deepEqual(alignmentPositions(1), []);
  assert.deepEqual(alignmentPositions(2), [6, 18]);
  assert.deepEqual(alignmentPositions(7), [6, 22, 38]);
  assert.deepEqual(alignmentPositions(32), [6, 34, 60, 86, 112, 138]);
  assert.deepEqual(alignmentPositions(40), [6, 30, 58, 86, 114, 142, 170]);
});

import { decodeQrImage, homography, applyH } from "./qr-locate.ts";

/** Renders a symbol to gray pixels through a projective warp, with lighting gradient, blur and noise. */
function render(v: (typeof QR_VECTORS)[number], opt: { px: number; rot: number; persp: number; noise: number; blur: boolean; seed: number; invertLight?: boolean }) {
  const quiet = 4;
  const total = v.size + 2 * quiet;
  const W = Math.round(total * opt.px * 1.6);
  const Hh = W;
  const rnd = mulberry32(opt.seed);
  const cx = W / 2, cy = Hh / 2;
  const s = opt.px;
  const cos = Math.cos(opt.rot), sin = Math.sin(opt.rot);
  // module-space (centred) → image
  const src = [{ x: -total / 2, y: -total / 2 }, { x: total / 2, y: -total / 2 }, { x: total / 2, y: total / 2 }, { x: -total / 2, y: total / 2 }];
  const dst = src.map((p, i) => {
    const k = 1 + opt.persp * (i === 2 ? 1 : i === 1 || i === 3 ? 0.4 : 0); // pull one corner → trapezoid
    const x = p.x * s * k, y = p.y * s * k;
    return { x: cx + x * cos - y * sin, y: cy + x * sin + y * cos };
  });
  const Hm = homography(dst, src)!; // image → module
  const img = new Float32Array(W * Hh);
  for (let y = 0; y < Hh; y++)
    for (let x = 0; x < W; x++) {
      const m = applyH(Hm, x, y);
      const mx = Math.floor(m.x + total / 2) - quiet, my = Math.floor(m.y + total / 2) - quiet;
      let dark = 0;
      if (mx >= 0 && my >= 0 && mx < v.size && my < v.size) dark = v.rows[my]![mx] === "1" ? 1 : 0;
      const light = 215 - 110 * (x / W) + (opt.invertLight ? 0 : 0); // strong horizontal illumination gradient
      img[y * W + x] = dark ? light * 0.18 : light;
    }
  const out = new Uint8Array(W * Hh);
  for (let y = 0; y < Hh; y++)
    for (let x = 0; x < W; x++) {
      let a = img[y * W + x]!;
      if (opt.blur) {
        let sum = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < W && yy < Hh) { sum += img[yy * W + xx]!; c++; }
        }
        a = sum / c;
      }
      out[y * W + x] = Math.max(0, Math.min(255, a + (rnd() - 0.5) * opt.noise));
    }
  return { gray: out, W, H: Hh };
}

test("locator: reads symbols from rotated, perspective-warped, blurred, noisy, unevenly lit images", () => {
  const cases: [string, Parameters<typeof render>[1]][] = [
    ["alnum-L", { px: 8, rot: 0, persp: 0, noise: 0, blur: false, seed: 1 }],
    ["url-M", { px: 6, rot: 0.35, persp: 0, noise: 20, blur: true, seed: 2 }],
    ["numeric-Q", { px: 7, rot: -0.6, persp: 0.12, noise: 24, blur: true, seed: 3 }],
    ["utf8-H", { px: 6, rot: 2.4, persp: 0.1, noise: 20, blur: true, seed: 4 }],
    ["mixed-Q", { px: 6, rot: 1.0, persp: 0.15, noise: 24, blur: true, seed: 5 }],
    ["long-M", { px: 5, rot: 0.2, persp: 0.06, noise: 16, blur: true, seed: 6 }],
    ["v7plus-H", { px: 5, rot: -0.3, persp: 0.08, noise: 16, blur: true, seed: 7 }],
    ["huge-L", { px: 4, rot: 0.05, persp: 0.0, noise: 10, blur: false, seed: 8 }],
  ];
  for (const [name, opt] of cases) {
    const v = QR_VECTORS.find((q) => q.name === name)!;
    const im = render(v, opt);
    const t0 = performance.now();
    const r = decodeQrImage(im.gray, im.W, im.H);
    const ms = performance.now() - t0;
    assert.ok(r, `${name}: no decode (${im.W}×${im.H})`);
    assert.equal(r.text, v.text, name);
    if (process.env.QR_TIMING) console.log(name, im.W, im.H, ms.toFixed(1) + " ms");
    assert.ok(ms < 400, `${name}: ${ms.toFixed(0)} ms`);
  }
});

test("locator: blank / noise-only images return null without throwing", () => {
  const w = 200, h = 200;
  const flat = new Uint8Array(w * h).fill(128);
  assert.equal(decodeQrImage(flat, w, h), null);
  const rnd = mulberry32(9);
  const noise = new Uint8Array(w * h);
  for (let i = 0; i < noise.length; i++) noise[i] = rnd() * 255;
  assert.equal(decodeQrImage(noise, w, h), null);
});
