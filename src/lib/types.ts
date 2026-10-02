/** device = real sensor/measurement, twin = simulated (demo), none = no data (shown as "—"). */
export type SampleSource = "device" | "twin" | "none";
export type DataMode = "demo" | "real";
export type EnvMode =
  | "indoor"
  | "outdoor"
  | "lowlight"
  | "bright"
  | "through"
  | "noisy"
  | "clutter";
export type MapPointKind = "person" | "object" | "wall" | "free" | "traj" | "sonar";
export type ObjectKind =
  | "person"
  | "furniture"
  | "metal"
  | "appliance"
  | "plant"
  | "device"
  | "wall"
  | "vehicle"
  | "animal";
export type SensorId = "camera" | "mic" | "imu" | "orient" | "mag" | "light" | "geo" | "bt";
export interface SensorStatus {
  state: "off" | "pending" | "live" | "denied" | "unsupported" | "error";
  /** Measured readings per second. */
  hz: number;
  /** Milliseconds since the last reading (performance.now based), or null. */
  lastMs: number | null;
  note: string;
}

export type LogLevel = "INFO" | "DETECT" | "WARN" | "REAL";
export type ModelStatus = "idle" | "loading" | "ready" | "fallback";
export type CameraFacing = "environment" | "user";
export type ViewPreset = "iso" | "top" | "follow";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Detection {
  id: string;
  trackId?: number;
  /** 1σ depth uncertainty (m). */
  sigmaM?: number;
  depthBasis?: string;
  truncated?: boolean;
  cls: string;
  score: number;
  bbox: [number, number, number, number];
  depthM: number;
  world: Vec3;
  source: SampleSource;
  kind: ObjectKind;
  contour: number[];
}

export interface Pose {
  x: number;
  z: number;
  headingDeg: number;
  pitchDeg: number;
  heightM: number;
  steps: number;
  source: SampleSource;
}

export interface PersonTrack {
  id: string;
  name: string;
  pos: Vec3;
  heading: number;
  /** Breathing rate — only the demo twin has one; real tracks are null. */
  bpm: number | null;
  confidence: number;
  source: SampleSource;
  behindWall: boolean;
  heightM: number;
  cls: string;
}

export interface SceneObject {
  id: string;
  name: string;
  kind: ObjectKind;
  pos: Vec3;
  size: Vec3;
  metal: boolean;
  rssiHint?: number;
}

export interface MapPoint {
  x: number;
  y: number;
  z: number;
  kind: MapPointKind;
  t: number;
}

export interface OccupancyCell {
  x: number;
  z: number;
  y: number;
  n: number;
}

export interface BtDevice {
  id: string;
  name: string;
  rssi: number | null;
  source: SampleSource;
}

export interface LogEntry {
  t: number;
  level: LogLevel;
  msg: string;
}

export interface Capability {
  id: string;
  label: string;
  available: boolean;
  note: string;
}

export interface SonarPing {
  t: number;
  /** null = no valid echo (never a made-up number). */
  distM: number | null;
  status: "ok" | "no-echo" | "no-direct" | "error";
  message: string;
  snrDb: number;
  confidence: number;
  directSnrDb: number;
  peak: number;
  lagSamples: number | null;
  dtUs: number | null;
  /** Number of pings averaged / accepted. */
  pings: number;
  accepted: number;
  sigmaM: number | null;
  echoes: { distM: number; snrDb: number }[];
  source: SampleSource;
  trace: number[];
  /** Mic constraint report (echoCancellation etc.) — false is what we want. */
  micRaw: boolean | null;
}

export interface MagSample {
  x: number;
  y: number;
  z: number;
  mag: number;
  anomaly: boolean;
  source: SampleSource;
}

export interface WifiSample {
  rssi: number;
  sigma: number;
  ssid: string;
  throughWall: boolean;
  source: SampleSource;
}

export interface ImuSample {
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
  heading: number;
  source: SampleSource;
}

export interface GeoSample {
  lat: number;
  lng: number;
  accuracy: number;
  source: SampleSource;
}

export interface FusionWeights {
  vision: number;
  sonar: number;
  mag: number;
  wifi: number;
  depth: number;
}

export interface Alert {
  id: string;
  t: number;
  tone: "warn" | "live" | "real";
  title: string;
  body: string;
}

export interface SarState {
  L: number;
  R: number;
  delta: number;
  lambda: number;
}

export interface VideoCaps {
  torch: boolean;
  zoomMin: number;
  zoomMax: number;
}

export interface KindFilter {
  person: boolean;
  object: boolean;
  wall: boolean;
  free: boolean;
  traj: boolean;
  sonar: boolean;
}

export type EnvManual = EnvMode | "auto";

export const ENV_LABEL: Record<EnvMode, string> = {
  indoor: "室内",
  outdoor: "室外",
  lowlight: "暗光",
  bright: "强光",
  through: "穿墙",
  noisy: "噪声",
  clutter: "杂乱",
};

export const KIND_LABEL: Record<ObjectKind, string> = {
  person: "人物",
  furniture: "家具",
  metal: "金属",
  appliance: "电器",
  plant: "植物",
  device: "设备",
  wall: "墙体",
  vehicle: "载具",
  animal: "动物",
};
