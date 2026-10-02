import assert from "node:assert/strict";
import test from "node:test";
import { fft, matchedEnvelope, renderChirp } from "./dsp.ts";
import { MatchedFilter } from "./matched.ts";
import { median, mulberry32, selectKth } from "./math.ts";

function dft(re: number[], im: number[], inv = false) {
  const n = re.length;
  const or = new Array<number>(n).fill(0);
  const oi = new Array<number>(n).fill(0);
  for (let k = 0; k < n; k++)
    for (let t = 0; t < n; t++) {
      const a = ((inv ? 2 : -2) * Math.PI * k * t) / n;
      or[k] += re[t]! * Math.cos(a) - im[t]! * Math.sin(a);
      oi[k] += re[t]! * Math.sin(a) + im[t]! * Math.cos(a);
    }
  return { or, oi };
}

test("fft matches the naive DFT for every size 1..256 (fused radix-4 stage included)", () => {
  const rnd = mulberry32(7);
  for (const n of [1, 2, 4, 8, 16, 32, 64, 128, 256]) {
    const re = Array.from({ length: n }, () => rnd() - 0.5);
    const im = Array.from({ length: n }, () => rnd() - 0.5);
    for (const inv of [false, true]) {
      const ref = dft(re, im, inv);
      const a = Float64Array.from(re);
      const b = Float64Array.from(im);
      fft(a, b, inv);
      const s = inv ? 1 / n : 1;
      for (let k = 0; k < n; k++) {
        assert.ok(Math.abs(a[k]! - ref.or[k]! * s) < 1e-9, `re n=${n} k=${k}`);
        assert.ok(Math.abs(b[k]! - ref.oi[k]! * s) < 1e-9, `im n=${n} k=${k}`);
      }
    }
  }
});

test("quickselect / median agree with a full sort", () => {
  const rnd = mulberry32(3);
  for (const n of [1, 2, 3, 10, 101, 1000, 4097]) {
    const v = Array.from({ length: n }, () => Math.round(rnd() * 50)); // many ties
    const s = [...v].sort((x, y) => x - y);
    const exp = n % 2 ? s[n >> 1]! : (s[(n >> 1) - 1]! + s[n >> 1]!) / 2;
    assert.equal(median(v), exp, `median n=${n}`);
    for (const k of [0, n >> 1, n - 1]) assert.equal(selectKth(Float64Array.from(v), k), s[k]);
  }
});

test("MatchedFilter.envelope equals the reference matchedEnvelope", () => {
  const fs = 48000;
  const chirp = renderChirp(fs, 18000, 21500, 0.045);
  const rnd = mulberry32(11);
  const N = 20000;
  const rec = new Float64Array(N);
  for (let i = 0; i < N; i++) rec[i] = (rnd() - 0.5) * 0.02;
  const echo = renderChirp(fs, 18000, 21500, 0.045, 5000.37, N, 0.4);
  for (let i = 0; i < N; i++) rec[i]! += echo[i]!;
  const ref = matchedEnvelope(rec, chirp);
  const got = new MatchedFilter(chirp, N).envelope(rec);
  assert.equal(got.length, ref.length);
  let maxRef = 0;
  let maxErr = 0;
  for (let i = 0; i < ref.length; i++) {
    maxRef = Math.max(maxRef, ref[i]!);
    maxErr = Math.max(maxErr, Math.abs(ref[i]! - got[i]!));
  }
  // the references differ only in how the analytic signal's edges are padded
  assert.ok(maxErr / maxRef < 0.02, `relative error ${maxErr / maxRef}`);
});

test("direct-path cancellation in the correlation domain removes ≥ 40 dB", () => {
  const fs = 48000;
  const chirp = renderChirp(fs, 18000, 21500, 0.045);
  const N = 24000;
  for (const tau of [3000, 3000.25, 3000.5, 3000.83, 8123.4]) {
    const rec = renderChirp(fs, 18000, 21500, 0.045, tau, N, 0.7);
    const mf = new MatchedFilter(chirp, N);
    const e0 = mf.envelope(rec);
    const peak0 = Math.max(...e0);
    const e1 = mf.cancel(tau, 0.7);
    const peak1 = Math.max(...e1);
    const db = 20 * Math.log10(peak0 / Math.max(peak1, 1e-12));
    assert.ok(db > 40, `tau=${tau}: only ${db.toFixed(1)} dB`);
  }
});

import { arr, num, obj, oneOf, opt } from "./schema.ts";

test("schema: defaults, bounds, optional keys, stripping and salvage", () => {
  const S = obj({ a: num({ min: 0, max: 10, def: 5 }), b: opt(num()), c: oneOf(["x", "y"] as const, "x"), l: arr(num(), { max: 2, def: [] }) });
  const r = S.parse({ extra: 1 });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.value, { a: 5, c: "x", l: [] });
  const bad = S.parse({ a: 11 });
  assert.ok(!bad.ok);
  if (!bad.ok) assert.deepEqual(bad.path, ["a"]);
  const nested = S.parse({ l: [1, "z"] });
  assert.ok(!nested.ok);
  if (!nested.ok) assert.deepEqual(nested.path, ["l", 1]);
  assert.ok(!S.parse({ l: [1, 2, 3] }).ok);
  assert.ok(!S.parse(null).ok && !S.parse([]).ok);
  assert.ok(!num().parse(Number.NaN).ok && !num({ int: true }).parse(1.5).ok);
  assert.deepEqual(S.salvage({ a: 99, c: "q", b: 3 }), { a: 5, b: 3, c: "x", l: [] });
  assert.equal(obj({ need: num() }).salvage({}), null);
});
