import type { FusionWeights } from "./types";

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
