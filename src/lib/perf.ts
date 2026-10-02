/**
 * Pipeline node profiler. Every stage of the data path (sensor → DSP → fusion →
 * render) reports its wall time here; the hardware page shows the table.
 * Overhead is two `performance.now()` calls and a few float ops per sample.
 */
export interface NodeStat {
  name: string;
  /** Exponential moving average of the duration (ms). */
  avgMs: number;
  /** Decaying maximum (ms). */
  maxMs: number;
  /** Samples per second over the last full second. */
  hz: number;
  total: number;
}

interface Acc extends NodeStat {
  winStart: number;
  winCount: number;
}

const nodes = new Map<string, Acc>();
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function record(name: string, ms: number): void {
  let a = nodes.get(name);
  const t = now();
  if (!a) {
    a = { name, avgMs: ms, maxMs: ms, hz: 0, total: 0, winStart: t, winCount: 0 };
    nodes.set(name, a);
  }
  a.avgMs += (ms - a.avgMs) * 0.1;
  a.maxMs = Math.max(ms, a.maxMs * 0.995);
  a.total++;
  a.winCount++;
  if (t - a.winStart >= 1000) {
    a.hz = (a.winCount * 1000) / (t - a.winStart);
    a.winStart = t;
    a.winCount = 0;
  }
}

export function timed<T>(name: string, fn: () => T): T {
  const t0 = now();
  try {
    return fn();
  } finally {
    record(name, now() - t0);
  }
}

export async function timedAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const t0 = now();
  try {
    return await fn();
  } finally {
    record(name, now() - t0);
  }
}

export function snapshot(): NodeStat[] {
  const t = now();
  return [...nodes.values()]
    .map((a) => ({
      name: a.name,
      avgMs: a.avgMs,
      maxMs: a.maxMs,
      // a node that stopped reporting decays to 0 Hz instead of showing its last rate
      hz: t - a.winStart > 3000 ? 0 : a.hz,
      total: a.total,
    }))
    .sort((x, y) => x.name.localeCompare(y.name));
}

export function resetPerf(): void {
  nodes.clear();
}
