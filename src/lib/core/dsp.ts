/**
 * Small DSP toolkit for the active-sonar pipeline: radix-2 FFT, FFT based
 * cross-correlation (matched filter), analytic-signal envelope and sub-sample
 * peak interpolation. Pure functions, no DOM — unit tested in node.
 */

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Cached twiddle + bit-reversal tables for one transform size. */
export interface FftPlan {
  n: number;
  rev: Uint32Array;
  cos: Float64Array;
  sin: Float64Array;
}

const plans = new Map<number, FftPlan>();

/** Plan for size `n` (power of two); tables are built once and reused. */
export function fftPlan(n: number): FftPlan {
  let plan = plans.get(n);
  if (plan) return plan;
  if (n < 1 || n & (n - 1)) throw new Error("fft length must be a power of two");
  const rev = new Uint32Array(n);
  const bits = Math.round(Math.log2(n));
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
    rev[i] = r;
  }
  const half = Math.max(1, n >> 1);
  const cos = new Float64Array(half);
  const sin = new Float64Array(half);
  // direct evaluation (no recurrence) keeps the twiddles accurate for large n
  for (let k = 0; k < half; k++) {
    const a = (-2 * Math.PI * k) / n;
    cos[k] = Math.cos(a);
    sin[k] = Math.sin(a);
  }
  plan = { n, rev, cos, sin };
  if (plans.size > 12) plans.clear();
  plans.set(n, plan);
  return plan;
}

/**
 * In-place iterative radix-2 FFT with table twiddles. `re`/`im` length must
 * be a power of two. The first two stages are fused into a radix-4 butterfly
 * (no multiplications), which removes ~25 % of the work for large sizes.
 */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  const { rev, cos, sin } = fftPlan(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i] as number;
    if (i < j) {
      const tr = re[i] as number;
      re[i] = re[j] as number;
      re[j] = tr;
      const ti = im[i] as number;
      im[i] = im[j] as number;
      im[j] = ti;
    }
  }
  const sgn = inverse ? -1 : 1;
  let len = 2;
  if (n >= 4) {
    // fused stages len=2 and len=4: twiddles are 1 and ∓j
    for (let i = 0; i < n; i += 4) {
      const r0 = re[i] as number, i0 = im[i] as number;
      const r1 = re[i + 1] as number, i1 = im[i + 1] as number;
      const r2 = re[i + 2] as number, i2 = im[i + 2] as number;
      const r3 = re[i + 3] as number, i3 = im[i + 3] as number;
      const ar = r0 + r1, ai = i0 + i1, br = r0 - r1, bi = i0 - i1;
      const cr = r2 + r3, ci = i2 + i3;
      // (r2 - r3, i2 - i3) · (-j·sgn) = sgn·(i2 - i3, -(r2 - r3))
      const dr = sgn * (i2 - i3), di = -sgn * (r2 - r3);
      re[i] = ar + cr; im[i] = ai + ci;
      re[i + 2] = ar - cr; im[i + 2] = ai - ci;
      re[i + 1] = br + dr; im[i + 1] = bi + di;
      re[i + 3] = br - dr; im[i + 3] = bi - di;
    }
    len = 8;
  } else if (n === 2) {
    const r0 = re[0] as number, i0 = im[0] as number;
    re[0] = r0 + (re[1] as number); im[0] = i0 + (im[1] as number);
    re[1] = r0 - (re[1] as number); im[1] = i0 - (im[1] as number);
    len = 4;
  }
  for (; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0, t = 0; k < half; k++, t += step) {
        const wr = cos[t] as number;
        const wi = sgn * (sin[t] as number);
        const a = i + k;
        const b = a + half;
        const xr = re[b] as number;
        const xi = im[b] as number;
        const tr = xr * wr - xi * wi;
        const ti = xr * wi + xi * wr;
        const ar = re[a] as number;
        const ai = im[a] as number;
        re[b] = ar - tr;
        im[b] = ai - ti;
        re[a] = ar + tr;
        im[a] = ai + ti;
      }
    }
  }
  if (inverse) {
    const inv = 1 / n;
    for (let i = 0; i < n; i++) {
      re[i] = (re[i] as number) * inv;
      im[i] = (im[i] as number) * inv;
    }
  }
}

/**
 * Linear-FM chirp with a Hann window, optionally delayed by a fractional
 * number of samples (the window moves with the delay). Output length `total`
 * (defaults to the chirp length).
 */
export function renderChirp(
  sampleRate: number,
  f0: number,
  f1: number,
  duration: number,
  delaySamples = 0,
  total?: number,
  gain = 1,
): Float64Array {
  const n = Math.floor(sampleRate * duration);
  const len = total ?? n;
  const out = new Float64Array(len);
  const start = Math.max(0, Math.floor(delaySamples));
  const rate = (f1 - f0) / duration;
  for (let i = start; i < len; i++) {
    const tt = (i - delaySamples) / sampleRate;
    if (tt < 0) continue;
    if (tt >= duration) break;
    const hann = 0.5 * (1 - Math.cos((2 * Math.PI * tt) / duration));
    // phase = 2π (f0 t + rate t² / 2)
    out[i] = Math.sin(2 * Math.PI * (f0 * tt + 0.5 * rate * tt * tt)) * hann * gain;
  }
  return out;
}

/**
 * Cross-correlation c[l] = Σ s[l+i]·k[i] for l = 0 … N-M (valid lags),
 * computed with FFTs.
 */
export function xcorr(signal: ArrayLike<number>, kernel: ArrayLike<number>): Float64Array {
  const N = signal.length;
  const M = kernel.length;
  if (M > N) return new Float64Array(0);
  const P = nextPow2(N + M);
  const sr = new Float64Array(P);
  const si = new Float64Array(P);
  const kr = new Float64Array(P);
  const ki = new Float64Array(P);
  for (let i = 0; i < N; i++) sr[i] = signal[i] as number;
  for (let i = 0; i < M; i++) kr[i] = kernel[i] as number;
  fft(sr, si);
  fft(kr, ki);
  for (let i = 0; i < P; i++) {
    // S · conj(K)
    const a = sr[i] as number;
    const b = si[i] as number;
    const c = kr[i] as number;
    const d = ki[i] as number;
    sr[i] = a * c + b * d;
    si[i] = b * c - a * d;
  }
  fft(sr, si, true);
  return sr.slice(0, N - M + 1);
}

/** Envelope |x + j·H{x}| via the FFT analytic signal. */
export function analyticEnvelope(x: ArrayLike<number>): Float64Array {
  const n = x.length;
  const P = nextPow2(Math.max(2, n));
  const re = new Float64Array(P);
  const im = new Float64Array(P);
  for (let i = 0; i < n; i++) re[i] = x[i] as number;
  fft(re, im);
  const half = P >> 1;
  for (let k = 1; k < half; k++) {
    re[k] = (re[k] as number) * 2;
    im[k] = (im[k] as number) * 2;
  }
  for (let k = half + 1; k < P; k++) {
    re[k] = 0;
    im[k] = 0;
  }
  fft(re, im, true);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.hypot(re[i] as number, im[i] as number);
  return out;
}

/** Matched-filter envelope of `signal` against `kernel` (one value per valid lag). */
export function matchedEnvelope(signal: ArrayLike<number>, kernel: ArrayLike<number>): Float64Array {
  return analyticEnvelope(xcorr(signal, kernel));
}

/** Parabolic interpolation around integer peak `i`. Returns fractional index. */
export function parabolicPeak(y: ArrayLike<number>, i: number): number {
  if (i <= 0 || i >= y.length - 1) return i;
  const a = y[i - 1] as number;
  const b = y[i] as number;
  const c = y[i + 1] as number;
  const den = a - 2 * b + c;
  if (Math.abs(den) < 1e-12) return i;
  const d = (0.5 * (a - c)) / den;
  return i + Math.max(-0.5, Math.min(0.5, d));
}

export interface Peak {
  index: number;
  pos: number;
  value: number;
}

/** Local maxima of `y` in [from, to) above `minValue`, strongest first. */
export function findPeaks(y: ArrayLike<number>, from: number, to: number, minValue: number, minSep = 1): Peak[] {
  const lo = Math.max(1, Math.floor(from));
  const hi = Math.min(y.length - 1, Math.ceil(to));
  const cand: Peak[] = [];
  for (let i = lo; i < hi; i++) {
    const v = y[i] as number;
    if (v >= minValue && v >= (y[i - 1] as number) && v > (y[i + 1] as number)) {
      cand.push({ index: i, pos: parabolicPeak(y, i), value: v });
    }
  }
  cand.sort((a, b) => b.value - a.value);
  const out: Peak[] = [];
  for (const p of cand) {
    if (out.every((q) => Math.abs(q.index - p.index) >= minSep)) out.push(p);
  }
  return out;
}

/** Speed of sound in dry air (m/s) at temperature `tempC`. */
export function speedOfSound(tempC: number): number {
  return 331.3 + 0.606 * tempC;
}

export function dbFromRatio(r: number): number {
  return 20 * Math.log10(Math.max(r, 1e-12));
}
