import { planOcr, rgbaToGray, sauvola, type OcrPlan } from "./core/imageops.ts";

export interface OcrPrep {
  /** Canvas to hand to the recogniser (cropped, polarity-normalised, Sauvola-binarised). */
  canvas: HTMLCanvasElement;
  plan: OcrPlan;
  /** Number of text lines found. */
  lines: number;
  ms: number;
}

const ANALYSIS_W = 320;
const MAX_LONG = 1100;

/**
 * Own pre-processing in front of Tesseract: locate text lines on a 320-px copy,
 * crop to them, normalise polarity, and binarise with Sauvola so uneven light
 * (shadow across a page) does not wipe out half the text.
 */
export function prepareForOcr(src: HTMLCanvasElement): OcrPrep | null {
  const t0 = performance.now();
  const sw = src.width;
  const sh = src.height;
  if (sw < 32 || sh < 32) return null;
  // 1) low-res analysis
  const aw = Math.min(ANALYSIS_W, sw);
  const ah = Math.max(8, Math.round((sh * aw) / sw));
  const a = document.createElement("canvas");
  a.width = aw;
  a.height = ah;
  const actx = a.getContext("2d", { willReadFrequently: true });
  if (!actx) return null;
  actx.drawImage(src, 0, 0, aw, ah);
  const ad = actx.getImageData(0, 0, aw, ah).data;
  const ag = new Uint8Array(aw * ah);
  rgbaToGray(ad, ag);
  const plan = planOcr(ag, aw, ah);

  // 2) crop in source coordinates
  const kx = sw / aw;
  const ky = sh / ah;
  const c = plan.crop ?? { x: 0, y: 0, w: aw, h: ah };
  const cx = Math.floor(c.x * kx);
  const cy = Math.floor(c.y * ky);
  const cw = Math.min(sw - cx, Math.ceil(c.w * kx));
  const ch = Math.min(sh - cy, Math.ceil(c.h * ky));
  const k = Math.min(1, MAX_LONG / Math.max(cw, ch));
  const ow = Math.max(8, Math.round(cw * k));
  const oh = Math.max(8, Math.round(ch * k));
  const out = document.createElement("canvas");
  out.width = ow;
  out.height = oh;
  const octx = out.getContext("2d", { willReadFrequently: true });
  if (!octx) return null;
  octx.drawImage(src, cx, cy, cw, ch, 0, 0, ow, oh);
  const img = octx.getImageData(0, 0, ow, oh);
  const g = new Uint8Array(ow * oh);
  rgbaToGray(img.data, g);
  if (plan.invert) for (let i = 0; i < g.length; i++) g[i] = 255 - (g[i] as number);

  // 3) Sauvola: window ≈ 1.5 line heights keeps thin strokes (CJK) intact
  const lineH = plan.regions.length ? plan.regions.map((r) => r.h).sort((p, q) => p - q)[plan.regions.length >> 1]! * ky * k : oh / 24;
  const win = Math.max(15, Math.min(101, Math.round(lineH * 1.5) | 1));
  const ink = sauvola(g, ow, oh, win, 0.2);
  const d = img.data;
  for (let i = 0, p = 0; p < ink.length; i += 4, p++) {
    const v = ink[p] ? 0 : 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  return { canvas: out, plan, lines: plan.regions.length, ms: performance.now() - t0 };
}
