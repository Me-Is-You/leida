export type EnvModeId = "indoor" | "outdoor" | "lowlight" | "bright" | "through" | "noisy" | "clutter";

export interface EnvMetrics {
  /** 0–255 mean luma; null when no camera. */
  brightness: number | null;
  /** 0–1 edge density. */
  texture: number | null;
  /** Luma standard deviation (global contrast). */
  noise: number | null;
  lux: number | null;
  /** RSSI σ when a real Wi-Fi link is available. */
  rssiSigma: number | null;
}

export function classifyOnce(m: EnvMetrics): EnvModeId | null {
  if (m.rssiSigma !== null && m.rssiSigma > 2.5) return "through";
  if (m.lux !== null) {
    if (m.lux < 10) return "lowlight";
    if (m.lux > 20000) return "bright";
  }
  if (m.brightness === null) return null;
  if (m.brightness < 35) return "lowlight";
  if (m.brightness > 180) return "bright";
  if (m.texture !== null && m.texture > 0.45) return "clutter";
  if (m.noise !== null && m.noise > 70 && m.texture !== null && m.texture < 0.2) return "noisy";
  if (m.lux !== null && m.lux > 2500 && (m.texture ?? 0) < 0.2) return "outdoor";
  if (m.brightness > 125 && (m.texture ?? 0.3) < 0.18) return "outdoor";
  return "indoor";
}

/** Hysteresis: the candidate must persist `dwell` consecutive updates before the mode flips. */
export class EnvClassifier {
  mode: EnvModeId = "indoor";
  private cand: EnvModeId | null = null;
  private count = 0;
  private readonly dwell: number;

  constructor(dwell = 8) {
    this.dwell = dwell;
  }

  update(m: EnvMetrics): EnvModeId {
    const c = classifyOnce(m);
    if (c === null || c === this.mode) {
      this.cand = null;
      this.count = 0;
      return this.mode;
    }
    if (c === this.cand) this.count++;
    else {
      this.cand = c;
      this.count = 1;
    }
    if (this.count >= this.dwell) {
      this.mode = c;
      this.cand = null;
      this.count = 0;
    }
    return this.mode;
  }
}
