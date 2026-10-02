/** Adaptive magnetic-field background estimator and anomaly detector. */
export class MagBaseline {
  baseline = 0;
  sigma = 0.6;
  n = 0;
  private readonly minAbs: number;
  private readonly k: number;
  private readonly warmup: number;
  constructor(minAbs = 3, k = 4, warmup = 25) {
    this.minAbs = minAbs;
    this.k = k;
    this.warmup = warmup;
  }

  update(magUt: number): { baseline: number; sigma: number; delta: number; anomaly: boolean; ready: boolean } {
    this.n += 1;
    if (this.n === 1) this.baseline = magUt;
    const delta = magUt - this.baseline;
    const ready = this.n >= this.warmup;
    const anomaly = ready && Math.abs(delta) > Math.max(this.minAbs, this.k * this.sigma);
    if (!anomaly) {
      // slow baseline, robust sigma (≈ mean absolute deviation × 1.25)
      const rate = ready ? 0.01 : 0.1;
      this.baseline += rate * delta;
      this.sigma += 0.05 * (Math.abs(delta) * 1.25 - this.sigma);
      this.sigma = Math.max(this.sigma, 0.15);
    }
    return { baseline: this.baseline, sigma: this.sigma, delta, anomaly, ready };
  }

  reset() {
    this.baseline = 0;
    this.sigma = 0.6;
    this.n = 0;
  }
}
