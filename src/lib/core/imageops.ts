/**
 * Small, allocation-free image primitives on 8-bit gray buffers: luma
 * conversion, one-pass frame statistics, Sauvola adaptive binarisation
 * (integral images, O(n)), union-find connected components and text-line
 * localisation. All pure; unit tested in node.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Foreground pixel count. */
  area: number;
}

/** RGBA → 8-bit luma (BT.709, integer weights summing to 256). */
export function rgbaToGray(rgba: ArrayLike<number>, out: Uint8Array): void {
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    out[p] = (54 * (rgba[i] as number) + 183 * (rgba[i + 1] as number) + 19 * (rgba[i + 2] as number)) >> 8;
  }
}

export interface GrayStats {
  brightness: number;
  texture: number;
  contrast: number;
  /** Mean absolute frame difference, 0‥1 (0 when there is no previous frame). */
  motion: number;
}

/** Brightness, edge density, contrast (σ) and inter-frame motion in a single pass. */
export function grayStats(gray: Uint8Array, w: number, prev: Uint8Array | null, edgeThr = 28): GrayStats {
  const n = gray.length;
  let sum = 0;
  let sum2 = 0;
  let edge = 0;
  let md = 0;
  const hasPrev = prev !== null && prev.length === n;
  for (let p = 0; p < n; p++) {
    const g = gray[p] as number;
    sum += g;
    sum2 += g * g;
    if (p % w > 0 && Math.abs(g - (gray[p - 1] as number)) > edgeThr) edge++;
    if (hasPrev) md += Math.abs(g - (prev[p] as number));
  }
  const mean = sum / n;
  return {
    brightness: mean,
    texture: edge / n,
    contrast: Math.sqrt(Math.max(0, sum2 / n - mean * mean)),
    motion: hasPrev ? md / (n * 255) : 0,
  };
}

/**
 * Sauvola local threshold: T = m·(1 + k·(s/R − 1)) with window mean m and std s
 * from integral images. Returns a mask (1 = ink/foreground, i.e. darker than T)
 * — robust to uneven lighting where a global threshold fails.
 */
export function sauvola(gray: Uint8Array, w: number, h: number, win = 15, k = 0.34, R = 128): Uint8Array {
  const W = w + 1;
  const I = new Float64Array(W * (h + 1));
  const I2 = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let r = 0;
    let r2 = 0;
    for (let x = 0; x < w; x++) {
      const g = gray[y * w + x] as number;
      r += g;
      r2 += g * g;
      I[(y + 1) * W + x + 1] = (I[y * W + x + 1] as number) + r;
      I2[(y + 1) * W + x + 1] = (I2[y * W + x + 1] as number) + r2;
    }
  }
  const half = win >> 1;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - half);
    const y1 = Math.min(h, y + half + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - half);
      const x1 = Math.min(w, x + half + 1);
      const area = (x1 - x0) * (y1 - y0);
      const s = (I[y1 * W + x1] as number) - (I[y0 * W + x1] as number) - (I[y1 * W + x0] as number) + (I[y0 * W + x0] as number);
      const s2 = (I2[y1 * W + x1] as number) - (I2[y0 * W + x1] as number) - (I2[y1 * W + x0] as number) + (I2[y0 * W + x0] as number);
      const m = s / area;
      const sd = Math.sqrt(Math.max(0, s2 / area - m * m));
      const t = m * (1 + k * (sd / R - 1));
      out[y * w + x] = (gray[y * w + x] as number) < t ? 1 : 0;
    }
  }
  return out;
}

/** 4-connected components of a binary mask (union-find, two passes). */
export function components(mask: Uint8Array, w: number, h: number, minArea = 1): Box[] {
  const parent = new Int32Array(w * h).fill(-1);
  const find = (a: number): number => {
    while ((parent[a] as number) !== a) {
      parent[a] = parent[parent[a] as number] as number;
      a = parent[a] as number;
    }
    return a;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      parent[i] = i;
      if (x > 0 && mask[i - 1]) parent[find(i)] = find(i - 1);
      if (y > 0 && mask[i - w]) {
        const a = find(i);
        const b = find(i - w);
        if (a !== b) parent[a] = b;
      }
    }
  }
  const boxes = new Map<number, { x0: number; y0: number; x1: number; y1: number; area: number }>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const r = find(i);
      const b = boxes.get(r);
      if (!b) boxes.set(r, { x0: x, y0: y, x1: x, y1: y, area: 1 });
      else {
        if (x < b.x0) b.x0 = x;
        if (x > b.x1) b.x1 = x;
        if (y > b.y1) b.y1 = y;
        b.area++;
      }
    }
  }
  const out: Box[] = [];
  for (const b of boxes.values()) if (b.area >= minArea) out.push({ x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1, area: b.area });
  return out;
}

/** Horizontal run-length smear: bridges gaps ≤ `gap` between foreground pixels (merges letters into lines). */
export function smearX(mask: Uint8Array, w: number, h: number, gap: number): Uint8Array {
  const out = new Uint8Array(mask);
  for (let y = 0; y < h; y++) {
    let last = -1e9;
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) {
        if (x - last <= gap + 1) for (let k = last + 1; k < x; k++) out[y * w + k] = 1;
        last = x;
      }
    }
  }
  return out;
}

/**
 * Locate text lines: Sauvola ink mask → horizontal smear → components filtered
 * by size/aspect/fill. Used to crop OCR work to where text actually is.
 */
export function textRegions(gray: Uint8Array, w: number, h: number): Box[] {
  const ink = sauvola(gray, w, h, Math.max(11, (Math.min(w, h) / 24) | 1));
  const smeared = smearX(ink, w, h, Math.max(3, Math.round(w / 30)));
  return components(smeared, w, h, Math.max(12, (w * h) / 4000))
    .filter((b) => {
      const ar = b.w / b.h;
      const fill = b.area / (b.w * b.h);
      return b.h >= 5 && b.h < h * 0.5 && ar > 1.5 && fill > 0.25 && b.w < w * 0.98;
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Box intersection-over-union. */
export function iou(a: Pick<Box, "x" | "y" | "w" | "h">, b: Pick<Box, "x" | "y" | "w" | "h">): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const u = a.w * a.h + b.w * b.h - inter;
  return u > 0 ? inter / u : 0;
}

export interface OcrPlan {
  /** Light text on dark paper: invert before recognition. */
  invert: boolean;
  /** Text-line boxes in the analysed (low-res) frame. */
  regions: Box[];
  /** Union of all regions plus margin, or null when there is nothing to crop to / cropping would not help. */
  crop: { x: number; y: number; w: number; h: number } | null;
}

/**
 * Pre-OCR analysis on a low-res gray copy: decide polarity, find text lines and
 * the tight crop that contains them (margin = one median line height).
 */
export function planOcr(gray: Uint8Array, w: number, h: number): OcrPlan {
  const win = Math.max(11, (Math.min(w, h) / 24) | 1);
  const share = (m: Uint8Array) => {
    let c = 0;
    for (let i = 0; i < m.length; i++) c += m[i] as number;
    return c / m.length;
  };
  // Text is the sparser class: pick the polarity whose "ink" covers fewer pixels.
  const inv = new Uint8Array(gray.length);
  for (let i = 0; i < inv.length; i++) inv[i] = 255 - (gray[i] as number);
  const invert = share(sauvola(inv, w, h, win)) < share(sauvola(gray, w, h, win));
  const g = invert ? inv : gray;
  const regions = textRegions(g, w, h);
  if (!regions.length) return { invert, regions, crop: null };
  const hs = regions.map((r) => r.h).sort((a, b) => a - b);
  const margin = Math.max(2, hs[hs.length >> 1] as number);
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (const r of regions) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  x0 = Math.max(0, x0 - margin);
  y0 = Math.max(0, y0 - margin);
  x1 = Math.min(w, x1 + margin);
  y1 = Math.min(h, y1 + margin);
  const area = ((x1 - x0) * (y1 - y0)) / (w * h);
  return { invert, regions, crop: area < 0.7 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null };
}
