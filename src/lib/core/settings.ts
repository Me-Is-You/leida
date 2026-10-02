import { z } from "zod";

export const SETTINGS_KEY = "aether-settings-v2";
export const LEGACY_SETTINGS_KEY = "aether-v18-settings";

const envMode = z.enum(["indoor", "outdoor", "lowlight", "bright", "through", "noisy", "clutter"]);

export const SettingsSchema = z.object({
  version: z.literal(2).default(2),
  dataMode: z.enum(["demo", "real"]).default("demo"),
  envManual: z.union([z.literal("auto"), envMode]).default("auto"),
  mapDensity: z.number().min(0.3).max(3).default(1),
  personOnly: z.boolean().default(false),
  contourOn: z.boolean().default(true),
  nightVision: z.boolean().default(false),
  hdr: z.boolean().default(false),
  detectOn: z.boolean().default(true),
  viewPreset: z.enum(["iso", "top", "follow"]).default("iso"),
  kindFilter: z
    .object({
      person: z.boolean().default(true),
      object: z.boolean().default(true),
      wall: z.boolean().default(true),
      free: z.boolean().default(true),
      traj: z.boolean().default(true),
      sonar: z.boolean().default(true),
    })
    .default({ person: true, object: true, wall: true, free: true, traj: true, sonar: true }),
  // vision
  hfovDeg: z.number().min(40).max(120).default(75),
  minScore: z.number().min(0.2).max(0.95).default(0.5),
  // sonar
  sonarTempC: z.number().min(-20).max(50).default(22),
  sonarSpacingM: z.number().min(0).max(0.3).default(0.06),
  sonarMaxRangeM: z.number().min(1).max(8).default(5),
  sonarMinSnrDb: z.number().min(3).max(30).default(8),
  sonarAverage: z.number().int().min(1).max(5).default(1),
  sonarGain: z.number().min(0.05).max(1).default(0.8),
  autoPingSec: z.number().min(1).max(30).default(3),
  // pdr
  heightM: z.number().min(1).max(2.3).default(1.7),
  stepLengthM: z.number().min(0.3).max(1.2).default(0.7),
  cameraHeightM: z.number().min(0.3).max(2.2).default(1.35),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.parse({});

/** Parse arbitrary stored JSON; unknown / invalid fields fall back to defaults, never throw. */
export function parseSettings(raw: unknown): Settings {
  const r = SettingsSchema.safeParse(raw);
  if (r.success) return r.data;
  // field-by-field salvage so a single bad value does not reset everything
  if (raw && typeof raw === "object") {
    const salvaged: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const one = SettingsSchema.safeParse({ ...salvaged, [k]: v });
      if (one.success) salvaged[k] = v;
    }
    const again = SettingsSchema.safeParse(salvaged);
    if (again.success) return again.data;
  }
  return DEFAULT_SETTINGS;
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export function loadSettings(storage: StorageLike | null): Settings {
  if (!storage) return DEFAULT_SETTINGS;
  try {
    const cur = storage.getItem(SETTINGS_KEY);
    if (cur) return parseSettings(JSON.parse(cur));
    const legacy = storage.getItem(LEGACY_SETTINGS_KEY);
    if (legacy) return parseSettings(JSON.parse(legacy)); // v18 fields are a strict subset
  } catch {
    /* corrupt storage → defaults */
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(storage: StorageLike | null, s: Settings): void {
  if (!storage) return;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* quota / private mode */
  }
}
