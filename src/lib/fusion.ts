import { speedOfSound } from "./core/dsp.ts";
import type { FusionWeights, SarState } from "./types";
import { dist3 } from "./utils";

export function trajLength(tr: { x: number; z: number }[]): number {
  let s = 0;
  for (let i = 1; i < tr.length; i++) {
    const a = tr[i - 1];
    const b = tr[i];
    if (!a || !b) continue;
    s += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return s;
}

/**
 * Analytic bound for the cross-range resolution of a synthetic aperture:
 * δ = λR / 2L. This is a *bound*, not an image — no back-projection is done.
 */
export function computeSar(L: number, R: number, tempC = 20, centreHz = 19750): SarState {
  const lambda = speedOfSound(tempC) / centreHz;
  const aperture = Math.max(L, 0.05);
  const delta = (lambda * Math.max(R, 0.2)) / (2 * aperture);
  return { L: aperture, R, delta, lambda };
}

export function nearestMetal(
  observer: { x: number; y: number; z: number },
  objects: { name: string; metal: boolean; pos: { x: number; y: number; z: number } }[],
) {
  let best: { name: string; dist: number } | null = null;
  for (const o of objects) {
    if (!o.metal) continue;
    const d = dist3(observer, o.pos);
    if (!best || d < best.dist) best = { name: o.name, dist: d };
  }
  return best;
}

export function normalizeWeights(w: FusionWeights): FusionWeights {
  const s = w.vision + w.sonar + w.mag + w.wifi + w.depth || 1;
  return {
    vision: w.vision / s,
    sonar: w.sonar / s,
    mag: w.mag / s,
    wifi: w.wifi / s,
    depth: w.depth / s,
  };
}
