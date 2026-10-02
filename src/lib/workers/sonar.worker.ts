/// <reference lib="webworker" />
import { processEcho } from "../core/sonar-core.ts";
import { buildSonarParams, type SonarConfig } from "../core/sonar-params.ts";

export interface SonarJob {
  id: number;
  fs: number;
  cfg: SonarConfig;
  rec: Float32Array;
}

self.onmessage = (e: MessageEvent<SonarJob>) => {
  const { id, fs, cfg, rec } = e.data;
  const t0 = performance.now();
  try {
    const result = processEcho(rec, buildSonarParams(fs, cfg));
    (self as unknown as Worker).postMessage({ id, result, ms: performance.now() - t0 });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
