export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function median(values: ArrayLike<number>): number {
  const n = values.length;
  if (n === 0) return 0;
  const a = Array.from(values).sort((x, y) => x - y);
  const mid = n >> 1;
  return n % 2 ? (a[mid] as number) : ((a[mid - 1] as number) + (a[mid] as number)) / 2;
}

export const DEG = Math.PI / 180;

/** Wrap an angle in degrees to [0, 360). */
export function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Smallest signed difference b - a in degrees, in (-180, 180]. */
export function angleDiffDeg(a: number, b: number): number {
  const d = wrap360(b - a);
  return d > 180 ? d - 360 : d;
}

/** Circular exponential smoothing of an angle in degrees. */
export function smoothAngleDeg(prev: number | null, next: number, alpha: number): number {
  if (prev === null) return wrap360(next);
  return wrap360(prev + angleDiffDeg(prev, next) * alpha);
}

/** Deterministic PRNG (mulberry32) so simulated data is reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
