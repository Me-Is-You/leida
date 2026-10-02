export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** k-th smallest (0-based) via in-place quickselect, O(n) average. Mutates `a`. */
export function selectKth(a: Float64Array | number[], k: number): number {
  let lo = 0;
  let hi = a.length - 1;
  while (lo < hi) {
    // median-of-three pivot
    const mid = (lo + hi) >> 1;
    const x = a[lo] as number, y = a[mid] as number, z = a[hi] as number;
    const pivot = x < y ? (y < z ? y : x < z ? z : x) : x < z ? x : y < z ? z : y;
    let i = lo;
    let j = hi;
    while (i <= j) {
      while ((a[i] as number) < pivot) i++;
      while ((a[j] as number) > pivot) j--;
      if (i <= j) {
        const t = a[i] as number;
        a[i] = a[j] as number;
        a[j] = t;
        i++;
        j--;
      }
    }
    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return a[k] as number;
  }
  return a[k] as number;
}

export function median(values: ArrayLike<number>): number {
  const n = values.length;
  if (n === 0) return 0;
  const a = Float64Array.from(values as ArrayLike<number>);
  const mid = n >> 1;
  const hiV = selectKth(a, mid);
  if (n % 2) return hiV;
  // after selection every element left of `mid` is ≤ hiV
  let loV = -Infinity;
  for (let i = 0; i < mid; i++) if ((a[i] as number) > loV) loV = a[i] as number;
  return (loV + hiV) / 2;
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
