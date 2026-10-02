import { renderChirp } from "./dsp.ts";
import type { SonarParams } from "./sonar-core.ts";

export interface SonarConfig {
  tempC: number;
  spacingM: number;
  maxRangeM: number;
  minSnrDb: number;
  average: number;
  gain: number;
}

export const CHIRP_BAND: [number, number] = [18000, 21500];
export const CHIRP_DURATION = 0.045;

const chirps = new Map<string, Float64Array>();

/**
 * The transmitted chirp, synthesised once per (sample rate, gain). Returning the
 * same object each time lets `matchedFilterFor` keep its kernel spectrum cached.
 */
export function chirpFor(fs: number, gain: number): Float64Array {
  const key = `${fs}|${gain.toFixed(3)}`;
  let c = chirps.get(key);
  if (!c) {
    if (chirps.size > 6) chirps.clear();
    c = renderChirp(fs, CHIRP_BAND[0], CHIRP_BAND[1], CHIRP_DURATION, 0, undefined, gain);
    chirps.set(key, c);
  }
  return c;
}

export function buildSonarParams(fs: number, cfg: SonarConfig): SonarParams {
  return {
    sampleRate: fs,
    chirp: chirpFor(fs, cfg.gain),
    chirpBand: CHIRP_BAND,
    chirpDuration: CHIRP_DURATION,
    tempC: cfg.tempC,
    maxRangeM: cfg.maxRangeM,
    minRangeM: 0.12,
    spacingM: cfg.spacingM,
    minSnrDb: cfg.minSnrDb,
  };
}
