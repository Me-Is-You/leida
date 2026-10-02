import { FUSION_MODES } from "../hardware";
import type { EnvMode, FusionWeights } from "../types";

/** Channel weights per environment mode — single source: the FUSION_MODES table in hardware.ts. */
export const envWeights = (env: EnvMode): FusionWeights => {
  const m = FUSION_MODES.find((x) => x.id === env) ?? FUSION_MODES[0];
  return { ...m.weights };
};
