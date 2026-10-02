import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyticEnvelope, fft, findPeaks, renderChirp, speedOfSound, xcorr } from "./dsp.ts";
import { aggregateEchoes, processEcho, type SonarParams } from "./sonar-core.ts";
import { mulberry32 } from "./fixtures/prng.ts";

const FS = 48000;
const BAND: [number, number] = [18000, 21500];
const DUR = 0.045;

function params(over: Partial<SonarParams> = {}): SonarParams {
  return {
    sampleRate: FS,
    chirp: renderChirp(FS, BAND[0], BAND[1], DUR, 0, undefined, 0.9),
    chirpBand: BAND,
    chirpDuration: DUR,
    tempC: 20,
    maxRangeM: 6,
    minRangeM: 0.15,
    spacingM: 0.08,
    minSnrDb: 8,
    ...over,
  };
}

/** Synthesise a microphone recording: direct arrival + echoes + noise. */
function synth(opts: {
  directLag: number;
  directAmp?: number;
  echoes?: { distM: number; amp: number }[];
  noise?: number;
  seed?: number;
  length?: number;
  tempC?: number;
  spacingM?: number;
}): Float64Array {
  const rnd = mulberry32(opts.seed ?? 7);
  const n = opts.length ?? Math.round(FS * 0.5);
  const out = new Float64Array(n);
  const add = (lag: number, amp: number) => {
    const c = renderChirp(FS, BAND[0], BAND[1], DUR, lag, n, amp);
    for (let i = 0; i < n; i++) out[i] = (out[i] as number) + (c[i] as number);
  };
  add(opts.directLag, opts.directAmp ?? 1);
  const c = speedOfSound(opts.tempC ?? 20);
  for (const e of opts.echoes ?? []) {
    const path = 2 * e.distM - (opts.spacingM ?? 0.08);
    add(opts.directLag + (path / c) * FS, e.amp);
  }
  const sigma = opts.noise ?? 0.02;
  for (let i = 0; i < n; i++) {
    // Box–Muller
    const u = Math.max(rnd(), 1e-9);
    const v = rnd();
    out[i] = (out[i] as number) + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  return out;
}

describe("dsp", () => {
  it("fft → ifft round-trips", () => {
    const n = 64;
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin(i * 0.37) + 0.2 * Math.cos(i * 1.1);
    const ref = re.slice();
    fft(re, im);
    fft(re, im, true);
    for (let i = 0; i < n; i++) assert.ok(Math.abs((re[i] as number) - (ref[i] as number)) < 1e-9);
  });

  it("xcorr locates a delayed copy exactly", () => {
    const k = renderChirp(FS, BAND[0], BAND[1], DUR);
    const s = new Float64Array(10000);
    const lag = 3210;
    for (let i = 0; i < k.length; i++) s[lag + i] = k[i] as number;
    const c = xcorr(s, k);
    let best = 0;
    for (let i = 0; i < c.length; i++) if ((c[i] as number) > (c[best] as number)) best = i;
    assert.equal(best, lag);
  });

  it("envelope peak survives phase changes", () => {
    const x = new Float64Array(2048);
    for (let i = 0; i < x.length; i++) x[i] = Math.sin(i * 0.9) * Math.exp(-(((i - 1000) / 80) ** 2));
    const env = analyticEnvelope(x);
    const peaks = findPeaks(env, 1, 2000, 0.1, 10);
    assert.ok(Math.abs((peaks[0]?.index ?? 0) - 1000) <= 2);
  });

  it("speed of sound follows temperature", () => {
    assert.ok(Math.abs(speedOfSound(20) - 343.4) < 0.2);
    assert.ok(speedOfSound(35) > speedOfSound(0));
  });
});

describe("processEcho (self-referenced ranging)", () => {
  for (const d of [0.4, 1.0, 1.5, 2.5, 4.0]) {
    it(`measures ${d} m within 2 cm with unknown latency`, () => {
      const lag = 7000 + Math.round(d * 100); // arbitrary system latency
      const rec = synth({ directLag: lag, echoes: [{ distM: d, amp: 0.12 }] });
      const r = processEcho(rec, params());
      assert.equal(r.status, "ok");
      assert.ok(Math.abs((r.distM as number) - d) < 0.02, `got ${r.distM} expected ${d}`);
      assert.ok(r.confidence > 0.3);
    });
  }

  it("is invariant to the absolute output latency", () => {
    const a = processEcho(synth({ directLag: 3000, echoes: [{ distM: 2, amp: 0.1 }] }), params());
    const b = processEcho(synth({ directLag: 9000, echoes: [{ distM: 2, amp: 0.1 }] }), params());
    assert.ok(Math.abs((a.distM as number) - (b.distM as number)) < 0.01);
  });

  it("applies temperature compensation", () => {
    const rec = synth({ directLag: 5000, echoes: [{ distM: 3, amp: 0.1 }], tempC: 35 });
    const cold = processEcho(rec, params({ tempC: 20 }));
    const hot = processEcho(rec, params({ tempC: 35 }));
    assert.ok(Math.abs((hot.distM as number) - 3) < 0.03);
    assert.ok(Math.abs((cold.distM as number) - 3) > 0.03, "uncompensated reading must be off");
  });

  it("reports no echo instead of inventing a distance", () => {
    const r = processEcho(synth({ directLag: 5000, echoes: [] }), params());
    assert.equal(r.status, "no-echo");
    assert.equal(r.distM, null);
  });

  it("reports no direct arrival when the speaker is silent", () => {
    const r = processEcho(synth({ directLag: 5000, directAmp: 0 }), params());
    assert.equal(r.status, "no-direct");
    assert.equal(r.distM, null);
  });

  it("picks the nearest significant echo, ignores a weak ghost", () => {
    const rec = synth({
      directLag: 6000,
      echoes: [
        { distM: 1.2, amp: 0.1 },
        { distM: 3.0, amp: 0.15 },
        { distM: 0.7, amp: 0.004 },
      ],
    });
    const r = processEcho(rec, params());
    assert.equal(r.status, "ok");
    assert.ok(Math.abs((r.distM as number) - 1.2) < 0.02, `got ${r.distM}`);
    assert.ok(r.echoes.length >= 2);
  });

  it("detects an echo right behind the direct sound (30 cm)", () => {
    const rec = synth({ directLag: 6500, echoes: [{ distM: 0.3, amp: 0.2 }] });
    const r = processEcho(rec, params());
    assert.equal(r.status, "ok");
    assert.ok(Math.abs((r.distM as number) - 0.3) < 0.03, `got ${r.distM}`);
  });

  it("rejects out-of-range echoes", () => {
    const rec = synth({ directLag: 6000, echoes: [{ distM: 5.5, amp: 0.2 }] });
    const r = processEcho(rec, params({ maxRangeM: 3 }));
    assert.notEqual(r.status, "ok");
  });

  it("aggregates pings by median and lowers confidence on disagreement", () => {
    const mk = (d: number) => processEcho(synth({ directLag: 6000, echoes: [{ distM: d, amp: 0.12 }], seed: Math.round(d * 1000) }), params());
    const tight = aggregateEchoes([mk(2.0), mk(2.005), mk(1.995)]);
    const loose = aggregateEchoes([mk(1.0), mk(2.0), mk(3.0)]);
    assert.ok(Math.abs((tight.distM as number) - 2) < 0.02);
    assert.ok(tight.confidence > loose.confidence);
  });
});
