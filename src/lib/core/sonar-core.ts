import { dbFromRatio, findPeaks, renderChirp, speedOfSound } from "./dsp.ts";
import { matchedFilterFor } from "./matched.ts";
import { clamp, median } from "./math.ts";

export interface SonarParams {
  sampleRate: number;
  /** Transmitted reference chirp (as synthesised, not as recorded). */
  chirp: ArrayLike<number>;
  chirpBand: [number, number];
  chirpDuration: number;
  tempC: number;
  maxRangeM: number;
  minRangeM: number;
  /** Distance between loudspeaker and microphone (m). */
  spacingM: number;
  /** Minimum echo SNR (dB) to accept a detection. */
  minSnrDb: number;
}

export type EchoStatus = "ok" | "no-echo" | "no-direct";

export interface EchoResult {
  status: EchoStatus;
  distM: number | null;
  /** Echo SNR in dB (matched-filter envelope peak vs. median floor). */
  snrDb: number;
  /** 0‥1 */
  confidence: number;
  directLag: number | null;
  echoLag: number | null;
  directSnrDb: number;
  directPeak: number;
  echoPeak: number;
  /** Round-trip excess delay in µs (echo − direct). */
  dtUs: number | null;
  /** Echo envelope (0‥1) from direct arrival to max range. */
  trace: number[];
  /** All echo candidates, nearest first. */
  echoes: { distM: number; snrDb: number }[];
  message: string;
}

export const TRACE_BINS = 96;

function emptyResult(status: EchoStatus, message: string, extra: Partial<EchoResult> = {}): EchoResult {
  return {
    status,
    distM: null,
    snrDb: 0,
    confidence: 0,
    directLag: null,
    echoLag: null,
    directSnrDb: 0,
    directPeak: 0,
    echoPeak: 0,
    dtUs: null,
    trace: new Array<number>(TRACE_BINS).fill(0),
    echoes: [],
    message,
    ...extra,
  };
}

/**
 * Self-referenced echo ranging.
 *
 * The microphone hears the loudspeaker directly first (strongest arrival) and
 * the room echoes later. Measuring *excess delay relative to the direct
 * arrival* removes the unknown output/input latency (tens of ms on Android)
 * without a separate calibration step:
 *
 *   path_echo = spacing + c · (lag_echo − lag_direct) / fs ,  R ≈ path_echo / 2
 *
 * The direct arrival is then subtracted (fractional-delay template) so its
 * ringing does not mask close echoes.
 */
export function processEcho(rec: ArrayLike<number>, p: SonarParams): EchoResult {
  const fs = p.sampleRate;
  const c = speedOfSound(p.tempC);
  const M = p.chirp.length;
  if (rec.length < M * 3) return emptyResult("no-direct", "录音太短");

  // 1. Locate the direct arrival: strongest matched-filter peak overall.
  const mf = matchedFilterFor(p.chirp as ArrayLike<number> & object, rec.length);
  const env0 = mf.envelope(rec);
  const floor0 = median(env0) || 1e-12;
  const peaks0 = findPeaks(env0, 1, env0.length - 1, 0, 8);
  const d0 = peaks0[0];
  if (!d0) return emptyResult("no-direct", "未检测到任何信号");
  const directSnrDb = dbFromRatio(d0.value / floor0);
  if (directSnrDb < 12) {
    return emptyResult("no-direct", "没有听到自己发出的 chirp(音量过低 / 扬声器或麦克风不响应该频段 / 被回声消除吃掉)", {
      directSnrDb,
      directPeak: d0.value,
    });
  }
  const lagD = d0.pos;

  // 2. Cancel the direct arrival in the correlation domain (see matched.ts).
  const amp = templateAmplitude(rec, p, lagD);
  const env1 = mf.cancel(lagD, amp);

  // 3. Echo search window relative to the direct arrival.
  const minLag = Math.ceil(((2 * p.minRangeM - p.spacingM) / c) * fs);
  const maxLag = Math.floor(((2 * p.maxRangeM - p.spacingM) / c) * fs);
  const from = lagD + Math.max(minLag, 24);
  const to = Math.min(env1.length - 1, lagD + maxLag);
  if (to - from < 8) {
    return emptyResult("no-echo", "录音窗口不足以覆盖量程", { directLag: lagD, directSnrDb, directPeak: d0.value });
  }

  // Noise floor: everything except the neighbourhood of the direct arrival.
  const guard = M * 2;
  const noiseVals = new Float64Array(Math.ceil(env1.length / 3));
  let nn = 0;
  for (let i = 0; i < env1.length; i += 3) {
    if (Math.abs(i - lagD) > guard) noiseVals[nn++] = env1[i] as number;
  }
  const floor1 = Math.max(median(noiseVals.subarray(0, nn)), 1e-12);

  const thr = floor1 * Math.pow(10, p.minSnrDb / 20);
  // Cancellation is never perfect on real hardware: inside the chirp length
  // the residual can only be trusted above ≈ -30 dB relative to the direct sound.
  const leak = d0.value * 0.03;
  const found = findPeaks(env1, from, to, thr, Math.ceil((2 * fs) / Math.abs(p.chirpBand[1] - p.chirpBand[0]))).filter(
    (q) => q.index - lagD > M || q.value >= leak,
  );
  const trace = buildTrace(env1, lagD, lagD + maxLag, found[0]?.value ?? thr * 2);
  const toDist = (lag: number) => Math.max(0, (p.spacingM + (c * (lag - lagD)) / fs) / 2);

  if (found.length === 0) {
    return emptyResult("no-echo", `${p.maxRangeM.toFixed(1)} m 内没有足够强的回波(门限 ${p.minSnrDb} dB)`, {
      directLag: lagD,
      directSnrDb,
      directPeak: d0.value,
      trace,
    });
  }

  // Nearest *significant* echo: ignore peaks far weaker than the strongest.
  const strongest = found[0] as { value: number };
  const sig = found.filter((q) => q.value >= strongest.value * 0.45).sort((a, b) => a.pos - b.pos);
  const best = sig[0] as { pos: number; value: number };
  const snrDb = dbFromRatio(best.value / floor1);
  const confidence = clamp((snrDb - p.minSnrDb) / 16, 0, 1) * clamp((directSnrDb - 10) / 15, 0.3, 1);
  const dist = toDist(best.pos);
  return {
    status: "ok",
    distM: dist,
    snrDb,
    confidence,
    directLag: lagD,
    echoLag: best.pos,
    directSnrDb,
    directPeak: d0.value,
    echoPeak: best.value,
    dtUs: ((best.pos - lagD) / fs) * 1e6,
    trace,
    echoes: sig.map((q) => ({ distM: toDist(q.pos), snrDb: dbFromRatio(q.value / floor1) })),
    message: `${dist.toFixed(3)} m · SNR ${snrDb.toFixed(1)} dB`,
  };
}

/** Least-squares amplitude of the unit template at fractional delay `lag`. */
function templateAmplitude(rec: ArrayLike<number>, p: SonarParams, lag: number): number {
  const lo = Math.max(0, Math.floor(lag));
  const hi = Math.min(rec.length, Math.ceil(lag + p.chirp.length) + 1);
  const tpl = renderChirp(p.sampleRate, p.chirpBand[0], p.chirpBand[1], p.chirpDuration, lag, hi, 1);
  let num = 0;
  let den = 0;
  for (let i = lo; i < hi; i++) {
    num += (rec[i] as number) * (tpl[i] as number);
    den += (tpl[i] as number) ** 2;
  }
  return den > 0 ? num / den : 0;
}

function buildTrace(env: Float64Array, start: number, end: number, ref: number): number[] {
  const out = new Array<number>(TRACE_BINS).fill(0);
  const span = Math.max(1, end - start);
  for (let i = Math.max(0, Math.floor(start)); i < Math.min(env.length, end); i++) {
    const b = Math.min(TRACE_BINS - 1, Math.floor(((i - start) / span) * TRACE_BINS));
    const v = (env[i] as number) / (ref || 1);
    if (v > (out[b] as number)) out[b] = v;
  }
  return out.map((v) => clamp(v, 0, 1));
}

/** Combine several pings: median distance of accepted ones, blended confidence. */
export function aggregateEchoes(results: EchoResult[]): EchoResult {
  const ok = results.filter((r) => r.status === "ok" && r.distM !== null);
  if (ok.length === 0) {
    return results.find((r) => r.status === "no-echo") ?? results[0] ?? emptyResult("no-direct", "无数据");
  }
  const dists = ok.map((r) => r.distM as number);
  const m = median(dists);
  const nearest = ok.reduce((a, b) =>
    Math.abs((a.distM as number) - m) <= Math.abs((b.distM as number) - m) ? a : b,
  );
  const spread = Math.sqrt(dists.reduce((s, d) => s + (d - m) ** 2, 0) / dists.length);
  const agree = clamp(1 - spread / 0.15, 0, 1);
  const meanConf = ok.reduce((s, r) => s + r.confidence, 0) / ok.length;
  return {
    ...nearest,
    distM: m,
    confidence: clamp(meanConf * (0.5 + 0.5 * agree) * Math.sqrt(ok.length / results.length), 0, 1),
    message: `${m.toFixed(3)} m · ${ok.length}/${results.length} 次有效 · σ ${(spread * 100).toFixed(1)} cm`,
  };
}
