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

/** In-place iterative radix-2 FFT. `re`/`im` length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (n & (n - 1)) throw new Error("fft length must be a power of two");
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] as number;
      re[i] = re[j] as number;
      re[j] = tr;
      const ti = im[i] as number;
      im[i] = im[j] as number;
      im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((2 * Math.PI) / len) * (inverse ? 1 : -1);
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k;
        const b = a + half;
        const tr = (re[b] as number) * cr - (im[b] as number) * ci;
        const ti = (re[b] as number) * ci + (im[b] as number) * cr;
        re[b] = (re[a] as number) - tr;
        im[b] = (im[a] as number) - ti;
        re[a] = (re[a] as number) + tr;
        im[a] = (im[a] as number) + ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] = (re[i] as number) / n;
      im[i] = (im[i] as number) / n;
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
