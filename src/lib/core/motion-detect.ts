import { type Box, components } from "./imageops.ts";

export interface MotionResult {
  /** Fraction of pixels classified as changed (0‥1). */
  changed: number;
  /** True when so much of the frame changed that the camera itself moved (or exposure jumped). */
  egoMotion: boolean;
  boxes: Box[];
  /** Adaptive per-frame threshold actually used (gray levels). */
  threshold: number;
}

/**
 * Moving-object detector for a fixed camera on a low-resolution gray stream.
 *
 *  - background = slow exponential average (updated *only* where nothing moves,
 *    so a person standing still is absorbed slowly, a passer-by is not);
 *  - threshold = max(minThr, 3.2 · noise) with the noise level taken as the
 *    median absolute difference (histogram median, O(n));
 *  - global brightness change (auto-exposure) is removed by subtracting the
 *    median signed difference before thresholding;
 *  - ego-motion gate: if > 35 % of pixels change, the background is reset and
 *    no boxes are reported (a hand-held phone sees "motion" everywhere).
 *    The same holds if the median |difference| itself is large (> 24).
 */
export class MotionDetector {
  readonly w: number;
  readonly h: number;
  private bg: Float32Array | null = null;
  private diff: Int16Array;
  private mask: Uint8Array;
  private dil: Uint8Array;
  private warm = 0;
  private prev: Uint8Array;
  /** Consecutive frames a pixel has been still while differing from the background (ghost / parked object). */
  private still: Uint8Array;
  /** Frames a changed pixel must stay still before the background adopts it. */
  absorbAfter = 8;
  minThr = 12;
  alpha = 0.06;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.diff = new Int16Array(w * h);
    this.mask = new Uint8Array(w * h);
    this.dil = new Uint8Array(w * h);
    this.prev = new Uint8Array(w * h);
    this.still = new Uint8Array(w * h);
  }

  reset() {
    this.bg = null;
    this.warm = 0;
    this.still.fill(0);
  }

  update(gray: Uint8Array): MotionResult {
    const { w, h, diff, mask, dil, prev, still } = this;
    const n = w * h;
    if (!this.bg) {
      this.bg = Float32Array.from(gray);
      this.warm = 1;
      this.prev.set(gray);
      return { changed: 0, egoMotion: false, boxes: [], threshold: this.minThr };
    }
    const bg = this.bg;
    // signed difference + histograms for robust medians
    const hs = new Uint32Array(511);
    for (let i = 0; i < n; i++) {
      const d = Math.round((gray[i] as number) - (bg[i] as number));
      diff[i] = d;
      hs[d + 255]!++;
    }
    let acc = 0;
    let med = 0;
    for (let k = 0; k < 511; k++) {
      acc += hs[k] as number;
      if (acc >= n / 2) {
        med = k - 255;
        break;
      }
    }
    // noise = median of |d − med| ≈ median |d| once the exposure offset is removed
    const hn = new Uint32Array(256);
    for (let k = 0; k < 511; k++) hn[Math.min(255, Math.abs(k - 255 - med))]! += hs[k] as number;
    acc = 0;
    let noise = 0;
    for (let k = 0; k < 256; k++) {
      acc += hn[k] as number;
      if (acc >= n / 2) {
        noise = k;
        break;
      }
    }
    const thr = Math.min(40, Math.max(this.minThr, 3.2 * Math.max(1, noise)));
    let changed = 0;
    for (let i = 0; i < n; i++) {
      const on = Math.abs((diff[i] as number) - med) > thr ? 1 : 0;
      mask[i] = on;
      changed += on;
    }
    const frac = changed / n;
    if (frac > 0.35 || noise > 24) {
      this.bg = Float32Array.from(gray);
      this.warm = 1;
      this.still.fill(0);
      this.prev.set(gray);
      return { changed: frac, egoMotion: true, boxes: [], threshold: thr };
    }
    // background update only where static (plus fast convergence while warming up)
    const a = this.warm < 20 ? Math.max(this.alpha, 1 / (this.warm + 1)) : this.alpha;
    for (let i = 0; i < n; i++) {
      if (!mask[i]) {
        bg[i] = (bg[i] as number) + ((gray[i] as number) - (bg[i] as number)) * a;
        still[i] = 0;
      } else if (Math.abs((gray[i] as number) - (prev[i] as number)) < thr * 0.5) {
        // differs from background but is no longer changing: ghost of a departed object or a parked one
        const c = (still[i] as number) + 1;
        still[i] = c > 250 ? 250 : c;
        if (c >= this.absorbAfter) {
          bg[i] = gray[i] as number;
          mask[i] = 0;
        }
      } else still[i] = 0;
    }
    prev.set(gray);
    this.warm++;
    if (this.warm < 6) return { changed: frac, egoMotion: false, boxes: [], threshold: thr };

    // 3×3 dilation then components → boxes
    dil.fill(0);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!mask[y * w + x]) continue;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx >= 0 && xx < w) dil[yy * w + xx] = 1;
          }
        }
      }
    }
    const minArea = Math.max(8, Math.round(n * 0.006));
    const boxes = components(dil, w, h, minArea).filter((b) => b.area / (b.w * b.h) > 0.25);
    return { changed: frac, egoMotion: false, boxes, threshold: thr };
  }
}
