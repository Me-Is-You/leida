import { processEcho, type EchoResult } from "./core/sonar-core.ts";
import { buildSonarParams, type SonarConfig } from "./core/sonar-params.ts";
import { record } from "./perf";

let worker: Worker | null = null;
let broken = false;
let seq = 0;
const pending = new Map<number, { resolve: (r: EchoResult) => void; reject: (e: Error) => void; timer: number }>();

function getWorker(): Worker | null {
  if (broken || typeof Worker === "undefined") return null;
  if (worker) return worker;
  try {
    const w = new Worker(new URL("./workers/sonar.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ id: number; result?: EchoResult; error?: string; ms?: number }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      window.clearTimeout(p.timer);
      if (e.data.result) {
        if (e.data.ms !== undefined) record("sonar.dsp(worker)", e.data.ms);
        p.resolve(e.data.result);
      } else p.reject(new Error(e.data.error ?? "worker error"));
    };
    w.onerror = () => {
      // a worker that cannot start (CSP, old browser) → permanently use the main thread
      broken = true;
      for (const [id, p] of pending) {
        window.clearTimeout(p.timer);
        p.reject(new Error("worker crashed"));
        pending.delete(id);
      }
      worker?.terminate();
      worker = null;
    };
    worker = w;
    return w;
  } catch {
    broken = true;
    return null;
  }
}

/**
 * Matched-filter processing of one recording. Runs in a Web Worker so the UI
 * thread never stalls (≈12 ms per ping, more with averaging); transparently
 * falls back to the main thread when workers are unavailable.
 */
export async function processEchoAsync(rec: Float32Array, fs: number, cfg: SonarConfig): Promise<EchoResult> {
  const w = getWorker();
  if (w) {
    try {
      const copy = rec.slice(); // transferred; the original stays intact for the main-thread fallback
      return await new Promise<EchoResult>((resolve, reject) => {
        const id = ++seq;
        const timer = window.setTimeout(() => {
          pending.delete(id);
          reject(new Error("worker timeout"));
        }, 5000);
        pending.set(id, { resolve, reject, timer });
        w.postMessage({ id, fs, cfg, rec: copy }, [copy.buffer]);
      });
    } catch {
      // fall through to main-thread processing (rec may be detached → caller passes a clone below)
    }
  }
  const t0 = performance.now();
  const r = processEcho(rec, buildSonarParams(fs, cfg));
  record("sonar.dsp(main)", performance.now() - t0);
  return r;
}

export function disposeSonarWorker(): void {
  worker?.terminate();
  worker = null;
}
