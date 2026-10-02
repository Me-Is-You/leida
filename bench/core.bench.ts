// Usage: node --experimental-strip-types bench/core.bench.ts [coreDir]
const dir = process.argv[2] ?? "../src/lib/core";
const { processEcho } = await import(`${dir}/sonar-core.ts`);
const { renderChirp } = await import(`${dir}/dsp.ts`);
const { PointRing } = await import(`${dir}/cloud.ts`);
const { OccupancyGrid } = await import(`${dir}/occupancy.ts`);

function time(name: string, iters: number, fn: () => void) {
  for (let i = 0; i < Math.min(5, iters); i++) fn();
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const ms = (performance.now() - t0) / iters;
  console.log(`${name.padEnd(34)} ${ms.toFixed(3).padStart(9)} ms/op`);
}

const fs = 48000;
const chirp = renderChirp(fs, 18000, 21500, 0.045, 0, undefined, 1);
const params = { sampleRate: fs, chirp, chirpBand: [18000, 21500], chirpDuration: 0.045, tempC: 22, maxRangeM: 5, minRangeM: 0.2, spacingM: 0.06, minSnrDb: 8 };
const N = 40000;
let seed = 1;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const rec = new Float64Array(N);
const d = renderChirp(fs, 18000, 21500, 0.045, 6000.3, N, 0.8);
const e = renderChirp(fs, 18000, 21500, 0.045, 6000.3 + 0.0083 * fs, N, 0.08);
for (let i = 0; i < N; i++) rec[i] = d[i] + e[i] + (rnd() - 0.5) * 0.01;
time("processEcho (40k samples)", 40, () => processEcho(rec, params));

const pts = Array.from({ length: 20000 }, () => [rnd() * 8 - 4, rnd() * 2, rnd() * 8 - 4]);
time("PointRing.add ×20k", 20, () => {
  const r = new PointRing(12000, 0.08);
  for (const p of pts) r.add(p[0], p[1], p[2], 0);
});

time("OccupancyGrid 200 rays + scan", 40, () => {
  const g = new OccupancyGrid(0.1);
  for (let i = 0; i < 200; i++) {
    const a = (i / 200) * Math.PI * 2;
    g.integrateRay(0, 0, Math.cos(a) * 4, Math.sin(a) * 4, true);
  }
  g.occupiedCells(0.65);
});
