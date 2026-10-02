/** IoU multi-object tracker with exponential smoothing and short-term memory. */

export interface DetBox {
  cls: string;
  score: number;
  /** Normalised [x, y, w, h]. */
  bbox: [number, number, number, number];
}

export interface Track {
  id: number;
  cls: string;
  score: number;
  bbox: [number, number, number, number];
  hits: number;
  misses: number;
  age: number;
  /** True once the track survived `minHits` frames. */
  confirmed: boolean;
}

export function iou(a: readonly number[], b: readonly number[]): number {
  const ax1 = (a[0] as number) + (a[2] as number);
  const ay1 = (a[1] as number) + (a[3] as number);
  const bx1 = (b[0] as number) + (b[2] as number);
  const by1 = (b[1] as number) + (b[3] as number);
  const iw = Math.min(ax1, bx1) - Math.max(a[0] as number, b[0] as number);
  const ih = Math.min(ay1, by1) - Math.max(a[1] as number, b[1] as number);
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  const ua = (a[2] as number) * (a[3] as number) + (b[2] as number) * (b[3] as number) - inter;
  return ua > 0 ? inter / ua : 0;
}

export interface TrackerOptions {
  iouMin: number;
  maxMisses: number;
  minHits: number;
  smooth: number;
}

export class IouTracker {
  tracks: Track[] = [];
  private nextId = 1;
  private readonly o: TrackerOptions;

  constructor(opts: Partial<TrackerOptions> = {}) {
    this.o = { iouMin: 0.25, maxMisses: 4, minHits: 2, smooth: 0.55, ...opts };
  }

  update(dets: DetBox[]): Track[] {
    const pairs: { ti: number; di: number; v: number }[] = [];
    this.tracks.forEach((t, ti) => {
      dets.forEach((d, di) => {
        if (d.cls !== t.cls) return;
        const v = iou(t.bbox, d.bbox);
        if (v >= this.o.iouMin) pairs.push({ ti, di, v });
      });
    });
    pairs.sort((a, b) => b.v - a.v);
    const usedT = new Set<number>();
    const usedD = new Set<number>();
    for (const p of pairs) {
      if (usedT.has(p.ti) || usedD.has(p.di)) continue;
      usedT.add(p.ti);
      usedD.add(p.di);
      const t = this.tracks[p.ti] as Track;
      const d = dets[p.di] as DetBox;
      const s = this.o.smooth;
      t.bbox = [
        t.bbox[0] + (d.bbox[0] - t.bbox[0]) * s,
        t.bbox[1] + (d.bbox[1] - t.bbox[1]) * s,
        t.bbox[2] + (d.bbox[2] - t.bbox[2]) * s,
        t.bbox[3] + (d.bbox[3] - t.bbox[3]) * s,
      ];
      t.score += (d.score - t.score) * 0.4;
      t.hits += 1;
      t.misses = 0;
      t.age += 1;
      if (t.hits >= this.o.minHits) t.confirmed = true;
    }
    this.tracks.forEach((t, ti) => {
      if (!usedT.has(ti)) {
        t.misses += 1;
        t.age += 1;
      }
    });
    dets.forEach((d, di) => {
      if (usedD.has(di)) return;
      this.tracks.push({
        id: this.nextId++,
        cls: d.cls,
        score: d.score,
        bbox: [...d.bbox] as [number, number, number, number],
        hits: 1,
        misses: 0,
        age: 1,
        confirmed: this.o.minHits <= 1,
      });
    });
    this.tracks = this.tracks.filter((t) => t.misses <= this.o.maxMisses);
    return this.tracks.filter((t) => t.confirmed && t.misses === 0);
  }

  reset() {
    this.tracks = [];
  }
}
