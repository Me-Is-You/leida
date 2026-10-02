import { type Infer, bool, num, obj, oneOf } from "./schema.ts";

export const SETTINGS_KEY = "aether-settings-v2";
export const LEGACY_SETTINGS_KEY = "aether-v18-settings";

const envMode = oneOf(["indoor", "outdoor", "lowlight", "bright", "through", "noisy", "clutter"] as const);
const KIND_DEFAULT = { person: true, object: true, wall: true, free: true, traj: true, sonar: true };

export const SettingsSchema = obj({
  version: num({ def: 2 }),
  dataMode: oneOf(["demo", "real"] as const, "demo"),
  envManual: oneOf(["auto", ...envMode.options] as const, "auto"),
  mapDensity: num({ min: 0.3, max: 3, def: 1 }),
  personOnly: bool(false),
  contourOn: bool(true),
  nightVision: bool(false),
  hdr: bool(false),
  detectOn: bool(true),
  viewPreset: oneOf(["iso", "top", "follow"] as const, "iso"),
  kindFilter: obj(
    { person: bool(true), object: bool(true), wall: bool(true), free: bool(true), traj: bool(true), sonar: bool(true) },
    { def: KIND_DEFAULT },
  ),
  // vision
  hfovDeg: num({ min: 40, max: 120, def: 75 }),
  minScore: num({ min: 0.2, max: 0.95, def: 0.5 }),
  // sonar
  sonarTempC: num({ min: -20, max: 50, def: 22 }),
  sonarSpacingM: num({ min: 0, max: 0.3, def: 0.06 }),
  sonarMaxRangeM: num({ min: 1, max: 8, def: 5 }),
  sonarMinSnrDb: num({ min: 3, max: 30, def: 8 }),
  sonarAverage: num({ min: 1, max: 5, int: true, def: 1 }),
  sonarGain: num({ min: 0.05, max: 1, def: 0.8 }),
  autoPingSec: num({ min: 1, max: 30, def: 3 }),
  // pdr
  heightM: num({ min: 1, max: 2.3, def: 1.7 }),
  stepLengthM: num({ min: 0.3, max: 1.2, def: 0.7 }),
  cameraHeightM: num({ min: 0.3, max: 2.2, def: 1.35 }),
});

export type Settings = Infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = SettingsSchema.salvage({}) as Settings;

/** Parse arbitrary stored JSON; unknown / invalid fields fall back to defaults, never throw. */
export function parseSettings(raw: unknown): Settings {
  const r = SettingsSchema.parse(raw);
  if (r.ok) return r.value;
  // field-by-field salvage so a single bad value does not reset everything
  return (SettingsSchema.salvage(raw) as Settings | null) ?? DEFAULT_SETTINGS;
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
