/**
 * Spectral matched filter with direct-path cancellation done *in the
 * correlation domain*.
 *
 *   c  = corr(rec, chirp)                    (one half-size real FFT + one inverse FFT)
 *   y  = analytic(c)  = IFFT( 2·S·conj(K) on k>0 )
 *   y' = y − a·shift(autocorr(chirp), τ)     (cancel the direct arrival)
 *
 * The residual after subtracting a fractionally delayed chirp is, by
 * linearity, the correlation of the residual — so the second full-length
 * transform the straightforward implementation needs (re-correlating the
 * subtracted recording) collapses to a short FFT of the *chirp's own*
 * autocorrelation. A ping costs ≈ 1.7 full-size FFT equivalents instead of 10.
 */
import { fft, fftPlan, nextPow2 } from "./dsp.ts";

/** Real input x (length ≤ P) → spectrum bins 0..P/2 using one complex FFT of size P/2. */
function rfft(x: ArrayLike<number>, P: number, outRe: Float64Array, outIm: Float64Array, zr: Float64Array, zi: Float64Array): void {
  const h = P >> 1;
  const n = x.length;
  for (let i = 0; i < h; i++) {
    const a = 2 * i;
    zr[i] = a < n ? (x[a] as number) : 0;
    zi[i] = a + 1 < n ? (x[a + 1] as number) : 0;
  }
  fft(zr, zi);
  const { cos, sin } = fftPlan(P);
  for (let k = 0; k <= h; k++) {
    const k1 = k === h ? 0 : k;
    const k2 = k === 0 ? 0 : h - k;
    const ar = zr[k1] as number;
    const ai = zi[k1] as number;
    const br = zr[k2] as number;
    const bi = -(zi[k2] as number); // conj(Z[h-k])
    const er = 0.5 * (ar + br);
    const ei = 0.5 * (ai + bi);
    // odd part: (a − b) / (2j) = ((ai − bi) − j(ar − br)) / 2
    const or = 0.5 * (ai - bi);
    const oi = -0.5 * (ar - br);
    // twiddle e^{-j2πk/P}; table holds k < P/2, k = P/2 → −1
    const wr = k < h ? (cos[k] as number) : -1;
    const wi = k < h ? (sin[k] as number) : 0;
    outRe[k] = er + or * wr - oi * wi;
    outIm[k] = ei + or * wi + oi * wr;
  }
}

export class MatchedFilter {
  readonly N: number;
  readonly M: number;
  readonly P: number;
  /** Number of valid lags (N − M + 1). */
  readonly L: number;
  private readonly kr: Float64Array;
  private readonly ki: Float64Array;
  private readonly sr: Float64Array;
  private readonly si: Float64Array;
  private readonly zr: Float64Array;
  private readonly zi: Float64Array;
  private readonly yr: Float64Array;
  private readonly yi: Float64Array;
  // chirp autocorrelation spectrum for cancellation
  private readonly Q: number;
  private readonly ac: Float64Array;
  private readonly qr: Float64Array;
  private readonly qi: Float64Array;

  constructor(kernel: ArrayLike<number>, signalLength: number) {
    this.N = signalLength;
    this.M = kernel.length;
    this.L = Math.max(0, signalLength - kernel.length + 1);
    this.P = Math.max(8, nextPow2(signalLength + kernel.length));
    const P = this.P;
    const h = P >> 1;
    this.kr = new Float64Array(h + 1);
    this.ki = new Float64Array(h + 1);
    this.sr = new Float64Array(h + 1);
    this.si = new Float64Array(h + 1);
    this.zr = new Float64Array(h);
    this.zi = new Float64Array(h);
    this.yr = new Float64Array(P);
    this.yi = new Float64Array(P);
    rfft(kernel, P, this.kr, this.ki, this.zr, this.zi);

    this.Q = Math.max(16, nextPow2(2 * kernel.length + 256));
    const Q = this.Q;
    this.ac = new Float64Array((Q >> 1) + 1);
    this.qr = new Float64Array(Q);
    this.qi = new Float64Array(Q);
    const hq = Q >> 1;
    const kqr = new Float64Array(hq + 1);
    const kqi = new Float64Array(hq + 1);
    rfft(kernel, Q, kqr, kqi, new Float64Array(hq), new Float64Array(hq));
    for (let k = 0; k <= hq; k++) this.ac[k] = (kqr[k] as number) ** 2 + (kqi[k] as number) ** 2;
  }

  /**
   * Analytic matched-filter output for `rec`. Returns the envelope |y| per
   * valid lag. The complex output stays inside the object for `cancel()`.
   */
  envelope(rec: ArrayLike<number>): Float64Array {
    const { P, kr, ki, sr, si, yr, yi } = this;
    const h = P >> 1;
    rfft(rec, P, sr, si, this.zr, this.zi);
    yr.fill(0);
    yi.fill(0);
    for (let k = 0; k <= h; k++) {
      const a = sr[k] as number;
      const b = si[k] as number;
      const c = kr[k] as number;
      const d = ki[k] as number;
      // S · conj(K)
      const xr = a * c + b * d;
      const xi = b * c - a * d;
      const w = k === 0 || k === h ? 1 : 2;
      yr[k] = w * xr;
      yi[k] = w * xi;
    }
    fft(yr, yi, true);
    const out = new Float64Array(this.L);
    for (let i = 0; i < out.length; i++) out[i] = Math.hypot(yr[i] as number, yi[i] as number);
    return out;
  }

  /**
   * Envelope of the correlation after removing `amp · chirp(t − tau)` from
   * the recording (tau in fractional samples). Must follow `envelope()` on
   * the same recording.
   */
  cancel(tau: number, amp: number): Float64Array {
    const { Q, ac, qr, qi, yr, yi, L } = this;
    const hq = Q >> 1;
    const base = Math.floor(tau);
    const frac = tau - base;
    qr.fill(0);
    qi.fill(0);
    for (let k = 0; k <= hq; k++) {
      const a = (-2 * Math.PI * k * frac) / Q;
      const w = (k === 0 || k === hq ? 1 : 2) * (ac[k] as number);
      qr[k] = w * Math.cos(a);
      qi[k] = w * Math.sin(a);
    }
    fft(qr, qi, true);
    const out = new Float64Array(L);
    for (let i = 0; i < L; i++) out[i] = Math.hypot(yr[i] as number, yi[i] as number);
    const reach = Math.min(Q / 2 - 1, this.M + 96);
    for (let m = -reach; m <= reach; m++) {
      const i = base + m;
      if (i < 0 || i >= L) continue;
      const q = (m + Q) % Q;
      out[i] = Math.hypot((yr[i] as number) - amp * (qr[q] as number), (yi[i] as number) - amp * (qi[q] as number));
    }
    return out;
  }
}

const cache = new WeakMap<object, Map<number, MatchedFilter>>();

/** Reuse filters (kernel spectrum, scratch buffers) across pings. */
export function matchedFilterFor(kernel: ArrayLike<number> & object, signalLength: number): MatchedFilter {
  let byLen = cache.get(kernel);
  if (!byLen) {
    byLen = new Map();
    cache.set(kernel, byLen);
  }
  let mf = byLen.get(signalLength);
  if (!mf) {
    if (byLen.size > 4) byLen.clear();
    mf = new MatchedFilter(kernel, signalLength);
    byLen.set(signalLength, mf);
  }
  return mf;
}
