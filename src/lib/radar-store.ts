import { toast } from "sonner";
import { createStore } from "./store";
import { AlertEngine } from "./core/alerts.ts";
import { estimateDepth, bearingOf, projectToWorld, CLASS_HEIGHT_M, type CameraModel } from "./core/camera-model.ts";
import { PointCloud, type CloudKind } from "./core/cloud.ts";
import { EnvClassifier, type EnvMetrics } from "./core/env-classify.ts";
import { fuseRanges, type FusedRange } from "./core/fuse.ts";
import { MagBaseline } from "./core/mag.ts";
import { smoothAngleDeg } from "./core/math.ts";
import { OccupancyGrid } from "./core/occupancy.ts";
import { PdrTracker, StepDetector } from "./core/pdr.ts";
import { DEFAULT_SETTINGS, loadSettings, parseSettings, saveSettings, type Settings } from "./core/settings.ts";
import { parseSession, type SessionData } from "./core/session-schema.ts";
import { IouTracker } from "./core/tracker.ts";
import {
  cameraSettings,
  detectBarcodes,
  probeCapabilities,
  readGeo,
  requestMotionPermission,
  resetFrameHistory,
  scanBluetooth,
  setTorch,
  setZoom,
  startAmbientLight,
  startCamera,
  startImu,
  startMagnetometer,
  startOrientation,
  stopCamera,
  videoCapabilities,
  vibrate,
  watchGeo,
  type FrameMetrics,
  type StopFn,
} from "./device";
import { emitTwinPoints, envWeights, observerPose, resetTwin, stepTwin, twinPing, twinSonarRange } from "./engine";
import { computeSar, trajLength } from "./fusion";
import { pingSonar, stopSonar, sonarBusy, type SonarConfig } from "./sonar";
import { kindOfClass, type RawDet } from "./vision";
import type {
  Alert,
  BtDevice,
  CameraFacing,
  Capability,
  DataMode,
  Detection,
  EnvManual,
  EnvMode,
  FusionWeights,
  GeoSample,
  ImuSample,
  KindFilter,
  LogEntry,
  MagSample,
  ModelStatus,
  PersonTrack,
  Pose,
  SarState,
  SceneObject,
  SensorId,
  SensorStatus,
  SonarPing,
  VideoCaps,
  ViewPreset,
  WifiSample,
} from "./types";

const HISTORY = 150;
const SONAR_FRESH_MS = 10_000;
const TICK_MS = 100;

/** Point cloud + occupancy grid live OUTSIDE zustand (they are large and mutate in place). */
export const cloud = new PointCloud();
export const grid = new OccupancyGrid(0.25);

export const SENSOR_IDS: SensorId[] = ["camera", "mic", "imu", "orient", "mag", "light", "geo", "bt"];

const NONE_WIFI: WifiSample = { rssi: NaN, sigma: NaN, ssid: "—", throughWall: false, source: "none" };
const NONE_MAG: MagSample = { x: 0, y: 0, z: 0, mag: NaN, anomaly: false, source: "none" };
const NONE_IMU: ImuSample = { ax: 0, ay: 0, az: 0, gx: 0, gy: 0, gz: 0, heading: 0, source: "none" };
const NONE_GEO: GeoSample = { lat: NaN, lng: NaN, accuracy: NaN, source: "none" };

export interface BarcodeHit {
  value: string;
  format: string;
  t: number;
}

export interface OcrResult {
  text: string;
  confidence: number;
  t: number;
}

export interface RadarState {
  settings: Settings;
  dataMode: DataMode;
  running: boolean;
  t: number;
  fps: number;
  latencyUs: number;
  clock: string;
  hidden: boolean;
  envManual: EnvManual;
  env: EnvMode;
  vision: { brightness: number | null; texture: number | null; noise: number | null; motion: number | null };
  lightLux: number | null;
  pose: Pose;
  people: PersonTrack[];
  objects: SceneObject[];
  detections: Detection[];
  wifi: WifiSample;
  mag: MagSample;
  magBaseline: number | null;
  imu: ImuSample;
  geo: GeoSample;
  sonar: SonarPing | null;
  sonarTwin: SonarPing | null;
  sonarBusy: boolean;
  fused: FusedRange;
  bt: BtDevice[];
  barcodes: BarcodeHit[];
  ocr: OcrResult | null;
  cloudVersion: number;
  cloudCounts: Record<CloudKind, number>;
  gridVersion: number;
  exploredM2: number;
  trajectory: { x: number; y: number; z: number }[];
  mapping: boolean;
  meshOn: boolean;
  cameraOn: boolean;
  cameraEpoch: number;
  cameraInfo: { width: number; height: number; fps: number; facing: string } | null;
  facing: CameraFacing;
  torch: boolean;
  zoom: number;
  videoCaps: VideoCaps | null;
  modelStatus: ModelStatus;
  detectMs: number;
  logs: LogEntry[];
  capabilities: Capability[];
  sensors: Record<SensorId, SensorStatus>;
  needsMotionGesture: boolean;
  rssiHist: number[];
  magHist: number[];
  magXHist: number[];
  magYHist: number[];
  magZHist: number[];
  sonarHist: number[];
  fpsHist: number[];
  brightHist: number[];
  pingHistory: SonarPing[];
  selectedId: string | null;
  alerts: Alert[];
  autoPing: boolean;
  fusion: FusionWeights;
  trajLen: number;
  steps: number;
  sar: SarState;
  // actions
  start: () => void;
  stop: () => void;
  setDataMode: (m: DataMode) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setEnv: (m: EnvManual) => void;
  enableSensors: () => Promise<void>;
  toggleMapping: () => void;
  clearMap: () => void;
  setMesh: (v: boolean) => void;
  enableCamera: () => Promise<void>;
  disableCamera: () => void;
  toggleFacing: () => Promise<void>;
  toggleTorch: () => Promise<void>;
  setZoomLevel: (n: number) => Promise<void>;
  ping: () => Promise<SonarPing>;
  calibrateSonar: (knownM: number) => Promise<string>;
  setAutoPing: (v: boolean) => void;
  scanBt: () => Promise<void>;
  locate: () => Promise<void>;
  fullCheck: () => void;
  ingestVision: (dets: RawDet[], metrics: FrameMetrics | null, aspect: number, detectMs: number) => void;
  scanBarcodesOn: (video: HTMLVideoElement) => Promise<void>;
  setOcr: (r: OcrResult | null) => void;
  setModelStatus: (s: ModelStatus) => void;
  pushLog: (msg: string, level?: LogEntry["level"]) => void;
  exportSession: () => SessionData;
  importSession: (data: unknown) => boolean;
  resetPdr: () => void;
  resetSession: () => void;
  select: (id: string | null) => void;
  setKindFilter: (k: keyof KindFilter, v: boolean) => void;
  setView: (v: ViewPreset) => void;
  dismissAlert: (id: string) => void;
}

// ────────────────────────────── module state (non-reactive) ──────────────────────────────

let timer = 0;
let houseTimer = 0;
let bootT = 0;
let lastFrameAt = 0;
let lastPingAt = 0;
let lastTwinSonarAt = 0;
let lastTrajAt = { x: NaN, z: NaN };
let visibilityHooked = false;

const sensorMem: Record<SensorId, SensorStatus> = Object.fromEntries(
  SENSOR_IDS.map((id) => [id, { state: "off", hz: 0, lastMs: null, note: "" } satisfies SensorStatus]),
) as Record<SensorId, SensorStatus>;
const rateCount: Record<SensorId, number> = Object.fromEntries(SENSOR_IDS.map((id) => [id, 0])) as Record<SensorId, number>;
const startedAt: Partial<Record<SensorId, number>> = {};
let sensorsDirty = true;

const stops: Partial<Record<SensorId, StopFn>> = {};
let geoRequested = false;

let devMag: MagSample | null = null;
let devImu: ImuSample | null = null;
let devGeo: GeoSample | null = null;
let devHeading: number | null = null;
let devPitch = 0;
let headingAbsolute = false;
let devLux: number | null = null;

let visionMetrics: FrameMetrics | null = null;
let visionMetricsAt = 0;
let visionDets: Detection[] = [];
let visionPeople: PersonTrack[] = [];
let barcodeAt = 0;
let detectMsEma = 0;

const stepDet = new StepDetector();
const pdr = new PdrTracker({ x: 0, z: 0 }, DEFAULT_SETTINGS.stepLengthM);
const magBase = new MagBaseline();
const envCls = new EnvClassifier(8);
const alertEng = new AlertEngine();
const tracker = new IouTracker();

function setSensor(id: SensorId, patch: Partial<SensorStatus>) {
  sensorMem[id] = { ...sensorMem[id], ...patch };
  sensorsDirty = true;
}

function hit(id: SensorId) {
  rateCount[id] += 1;
  const s = sensorMem[id];
  s.lastMs = performance.now();
  if (s.state !== "live") {
    s.state = "live";
    s.note = "";
    sensorsDirty = true;
  }
}

function pushHist(arr: number[], v: number) {
  arr.push(v);
  if (arr.length > HISTORY) arr.shift();
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

const initial = loadSettings(storage());

function camModel(s: Settings, aspect: number): CameraModel {
  return { hfovDeg: s.hfovDeg, aspect: aspect > 0 ? aspect : 4 / 3 };
}

function sonarConfig(s: Settings): SonarConfig {
  return {
    tempC: s.sonarTempC,
    spacingM: s.sonarSpacingM,
    maxRangeM: s.sonarMaxRangeM,
    minSnrDb: s.sonarMinSnrDb,
    average: s.sonarAverage,
    gain: s.sonarGain,
  };
}

/** The sonar reading the UI should show: a fresh real ping, else (demo only) the simulated one. */
export function effectiveSonar(st: Pick<RadarState, "sonar" | "sonarTwin" | "dataMode">): SonarPing | null {
  if (st.sonar && Date.now() - st.sonar.t < SONAR_FRESH_MS) return st.sonar;
  if (st.dataMode === "demo") return st.sonarTwin;
  return null;
}

const NO_OBJECTS: SceneObject[] = [];
const EMPTY_FUSED: FusedRange = { rangeM: null, sigmaM: null, used: [], rejected: [], conflict: false };

const initialPose: Pose = { x: 0, z: 0, headingDeg: 0, pitchDeg: 0, heightM: initial.cameraHeightM, steps: 0, source: "none" };

export const useRadar = createStore<RadarState>((set, get) => {
  function computePose(t: number, s: Settings, mode: DataMode): Pose {
    if (mode === "demo") {
      const hRad = devHeading != null ? (devHeading * Math.PI) / 180 : undefined;
      const obs = observerPose(t, hRad);
      return {
        x: obs.pos.x,
        z: obs.pos.z,
        headingDeg: (obs.heading * 180) / Math.PI,
        pitchDeg: devPitch,
        heightM: obs.pos.y,
        steps: 0,
        source: "twin",
      };
    }
    return {
      x: pdr.state.x,
      z: pdr.state.z,
      headingDeg: devHeading ?? 0,
      pitchDeg: devPitch,
      heightM: s.cameraHeightM,
      steps: pdr.state.steps,
      source: devHeading != null ? "device" : "none",
    };
  }

  function integratePing(ping: SonarPing, pose: Pose) {
    if (!get().mapping) return;
    const h = (pose.headingDeg * Math.PI) / 180;
    const maxR = get().settings.sonarMaxRangeM;
    if (ping.status === "ok" && ping.distM !== null) {
      const hx = pose.x + Math.sin(h) * ping.distM;
      const hz = pose.z + Math.cos(h) * ping.distM;
      cloud.add("sonar", hx, pose.heightM - 0.25, hz, get().t);
      cloud.add("wall", hx, pose.heightM - 0.25, hz, get().t);
      grid.integrateRay(pose.x, pose.z, hx, hz, true);
    } else if (ping.status === "no-echo") {
      grid.integrateRay(pose.x, pose.z, pose.x + Math.sin(h) * maxR, pose.z + Math.cos(h) * maxR, false);
    }
  }

  const tick = () => {
    if (document.hidden) return;
    const t0 = performance.now();
    const t = (t0 - bootT) / 1000;
    const st = get();
    const s = st.settings;
    const mode = st.dataMode;
    const demo = mode === "demo";

    // ── twin (demo only) ──
    const hRad = devHeading != null ? (devHeading * Math.PI) / 180 : undefined;
    const twin = demo ? stepTwin(t, hRad) : null;

    // ── sensors → channels ──
    const mag: MagSample = devMag ?? twin?.mag ?? NONE_MAG;
    const imu: ImuSample = devImu
      ? { ...devImu, heading: devHeading ?? 0 }
      : twin
        ? twin.imu
        : NONE_IMU;
    const geo: GeoSample = devGeo ?? twin?.geo ?? NONE_GEO;
    const wifi: WifiSample = twin?.wifi ?? NONE_WIFI;

    let magOut = mag;
    let magBaseline: number | null = null;
    if (Number.isFinite(mag.mag)) {
      const r = magBase.update(mag.mag);
      magOut = { ...mag, anomaly: r.anomaly };
      magBaseline = r.baseline;
    }

    // ── pose ──
    const pose = computePose(t, s, mode);
    let trajectory = st.trajectory;
    const moved = Math.hypot(pose.x - lastTrajAt.x, pose.z - lastTrajAt.z);
    if (!Number.isFinite(moved) || moved >= 0.15) {
      lastTrajAt = { x: pose.x, z: pose.z };
      trajectory = trajectory.concat([{ x: pose.x, y: 0.04, z: pose.z }]);
      if (trajectory.length > 3000) trajectory = trajectory.slice(trajectory.length - 3000);
      if (st.mapping && (pose.source !== "none" || demo)) cloud.add("traj", pose.x, 0.05, pose.z, t);
    }

    // ── twin geometry into the cloud ──
    if (twin && st.mapping) emitTwinPoints(cloud, twin, s.mapDensity, t);

    // ── demo sonar (1 Hz, clearly labelled twin) ──
    let sonarTwin = st.sonarTwin;
    if (demo && t0 - lastTwinSonarAt > 1000) {
      lastTwinSonarAt = t0;
      sonarTwin = twinPing(twinSonarRange(t, hRad));
    } else if (!demo) sonarTwin = null;

    // ── vision freshness ──
    const visionFresh = visionMetrics !== null && t0 - visionMetricsAt < 2500;
    const vm = visionFresh ? visionMetrics : null;
    const bright = vm ? vm.brightness : twin ? twin.brightness : null;
    const texture = vm ? vm.texture : twin ? twin.texture : null;
    const noise = vm ? vm.noise : twin ? twin.noise : null;

    // ── environment ──
    const metrics: EnvMetrics = {
      brightness: bright,
      texture,
      noise,
      lux: devLux,
      rssiSigma: twin ? twin.wifi.sigma : null,
    };
    const autoEnv = envCls.update(metrics);
    const env = st.envManual === "auto" ? autoEnv : st.envManual;
    const fusion = envWeights(env);

    // ── people / detections ──
    const people = twin ? [...twin.people, ...visionPeople] : visionPeople;
    const detections = s.personOnly ? visionDets.filter((d) => d.cls === "person") : visionDets;

    // ── range fusion (real sources only; the weights are the active mode's) ──
    const sonarNow = effectiveSonar({ sonar: st.sonar, sonarTwin, dataMode: mode });
    const centre = visionDets
      .filter((d) => !d.truncated && Math.abs(bearingOf(d.bbox[0] + d.bbox[2] / 2, camModel(s, 4 / 3))) < 12)
      .sort((a, b) => a.depthM - b.depthM)[0];
    const fused = fuseRanges([
      ...(sonarNow && sonarNow.distM !== null && sonarNow.source === "device"
        ? [
            {
              id: "sonar" as const,
              rangeM: sonarNow.distM,
              sigmaM: Math.max(0.015, 0.01 + (1 - sonarNow.confidence) * 0.25, sonarNow.sigmaM ?? 0),
              weight: fusion.sonar,
            },
          ]
        : []),
      ...(centre ? [{ id: "vision" as const, rangeM: centre.depthM, sigmaM: centre.sigmaM ?? centre.depthM * 0.3, weight: fusion.vision }] : []),
    ]);

    // ── alerts ──
    const fresh = alertEng.update(t0, {
      throughWall: twin?.wifi.throughWall ?? false,
      magAnomaly: magOut.anomaly,
      magDeltaUt: magBaseline !== null ? mag.mag - magBaseline : undefined,
      sonarM: sonarNow?.distM ?? null,
      personCount: people.length,
      brightness: bright,
    });
    let alerts = st.alerts;
    if (fresh.length) {
      alerts = [
        ...fresh.map((a) => ({ id: `${a.key}-${Math.round(t0)}`, t: Date.now(), tone: a.tone, title: a.title, body: a.body })),
        ...alerts,
      ].slice(0, 30);
      if (fresh.some((a) => a.tone === "warn")) vibrate(18);
    }

    // ── fps (real frame rate of this loop) & histories ──
    const dtFrame = lastFrameAt ? t0 - lastFrameAt : TICK_MS;
    lastFrameAt = t0;
    const fps = 0.8 * st.fps + 0.2 * (1000 / Math.max(dtFrame, 1));
    const rssiHist = st.rssiHist.slice();
    const magHist = st.magHist.slice();
    const magXHist = st.magXHist.slice();
    const magYHist = st.magYHist.slice();
    const magZHist = st.magZHist.slice();
    const fpsHist = st.fpsHist.slice();
    const brightHist = st.brightHist.slice();
    if (Number.isFinite(wifi.rssi)) pushHist(rssiHist, wifi.rssi);
    if (Number.isFinite(mag.mag)) {
      pushHist(magHist, mag.mag);
      pushHist(magXHist, mag.x);
      pushHist(magYHist, mag.y);
      pushHist(magZHist, mag.z);
    }
    pushHist(fpsHist, fps);
    if (bright !== null) pushHist(brightHist, bright);

    // ── derived map stats (cheap) ──
    const L = trajLength(trajectory);
    const sar = computeSar(L, fused.rangeM ?? sonarNow?.distM ?? 2, s.sonarTempC);
    const cv = cloud.version;
    const gv = grid.version;

    // ── auto ping ──
    if (st.autoPing && !sonarBusy() && t0 - lastPingAt > s.autoPingSec * 1000) {
      lastPingAt = t0;
      void get().ping();
    }

    set({
      t,
      pose,
      people,
      objects: twin ? twin.objects : NO_OBJECTS,
      detections,
      wifi,
      mag: magOut,
      magBaseline,
      imu,
      geo,
      env,
      vision: { brightness: bright, texture, noise, motion: vm ? vm.motion : null },
      lightLux: devLux,
      sonarTwin,
      fused,
      sonarBusy: sonarBusy(),
      trajectory,
      trajLen: L,
      steps: pdr.state.steps,
      sar,
      fusion,
      fps,
      latencyUs: (performance.now() - t0) * 1000,
      clock: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      rssiHist,
      magHist,
      magXHist,
      magYHist,
      magZHist,
      fpsHist,
      brightHist,
      alerts,
      ...(cv !== st.cloudVersion ? { cloudVersion: cv, cloudCounts: cloud.counts() } : {}),
      ...(gv !== st.gridVersion ? { gridVersion: gv, exploredM2: grid.explored().areaM2 } : {}),
    });
  };

  /** 1 Hz: sensor rates, stale detection, flush sensor map. */
  const housekeeping = () => {
    const now = performance.now();
    for (const id of SENSOR_IDS) {
      const s = sensorMem[id];
      const hz = rateCount[id];
      rateCount[id] = 0;
      if (s.hz !== hz) {
        s.hz = hz;
        sensorsDirty = true;
      }
      if (s.state === "live" && s.lastMs !== null && now - s.lastMs > 5000 && id !== "mic" && id !== "bt" && id !== "geo" && id !== "camera") {
        s.state = "error";
        s.note = "读数中断";
        sensorsDirty = true;
      }
      const t0 = startedAt[id];
      if (s.state === "pending" && t0 && now - t0 > 4000 && id !== "geo") {
        s.state = "error";
        s.note = "启动后没有收到任何读数（设备无此传感器 / 桌面浏览器）";
        sensorsDirty = true;
      }
    }
    if (sensorsDirty) {
      sensorsDirty = false;
      set({ sensors: Object.fromEntries(SENSOR_IDS.map((id) => [id, { ...sensorMem[id] }])) as Record<SensorId, SensorStatus> });
    }
    if (get().cameraOn) set({ cameraInfo: cameraSettings() });
  };

  function startMotion() {
    if (!stops.imu) {
      setSensor("imu", { state: "pending" });
      startedAt.imu = performance.now();
      stops.imu = startImu((m) => {
        hit("imu");
        devImu = { ax: m.ax, ay: m.ay, az: m.az, gx: m.gx, gy: m.gy, gz: m.gz, heading: 0, source: "device" };
        // A step without a compass heading cannot be placed on the map, so it is not counted.
        if (stepDet.push(m.tSec, m.ax, m.ay, m.az) && devHeading != null) pdr.step(devHeading);
      });
    }
    if (!stops.orient) {
      setSensor("orient", { state: "pending" });
      startedAt.orient = performance.now();
      stops.orient = startOrientation((o) => {
        hit("orient");
        devHeading = smoothAngleDeg(devHeading, o.heading, 0.3);
        devPitch = devPitch + (o.pitch - devPitch) * 0.3;
        if (headingAbsolute !== o.absolute) {
          headingAbsolute = o.absolute;
          setSensor("orient", { note: o.absolute ? "磁北参考" : "相对航向（无磁北参考）" });
        }
      });
    }
  }

  function startEnvSensors() {
    if (!stops.mag) {
      setSensor("mag", { state: "pending" });
      startedAt.mag = performance.now();
      void startMagnetometer((m) => {
        hit("mag");
        devMag = m;
      }).then((stop) => {
        if (stop) stops.mag = stop;
        else setSensor("mag", { state: "unsupported", note: "此浏览器没有 Magnetometer API（需 Chrome Android + HTTPS）" });
      });
    }
    if (!stops.light) {
      setSensor("light", { state: "pending" });
      startedAt.light = performance.now();
      void startAmbientLight((lux) => {
        hit("light");
        devLux = lux;
      }).then((stop) => {
        if (stop) stops.light = stop;
        else setSensor("light", { state: "unsupported", note: "没有 AmbientLightSensor（Chrome 默认关闭）" });
      });
    }
  }

  function startGeo() {
    if (geoRequested) return;
    geoRequested = true;
    setSensor("geo", { state: "pending" });
    startedAt.geo = performance.now();
    stops.geo = watchGeo((g) => {
      hit("geo");
      devGeo = g;
    });
    void readGeo().then((g) => {
      if (g) {
        hit("geo");
        devGeo = g;
        get().pushLog(`GNSS ${g.lat.toFixed(5)}, ${g.lng.toFixed(5)} ±${g.accuracy.toFixed(0)} m`, "REAL");
      } else if (sensorMem.geo.state === "pending") {
        setSensor("geo", { state: "denied", note: "定位被拒绝或超时" });
      }
    });
  }

  const onVisibility = () => {
    set({ hidden: document.hidden });
    if (!document.hidden && get().cameraOn) {
      // browsers mute/freeze camera tracks in the background — re-open it
      void startCamera(get().facing)
        .then(() => set((st) => ({ cameraEpoch: st.cameraEpoch + 1, videoCaps: videoCapabilities() })))
        .catch(() => undefined);
    }
  };

  return {
    settings: initial,
    dataMode: initial.dataMode,
    running: false,
    t: 0,
    fps: 0,
    latencyUs: 0,
    clock: "--:--:--",
    hidden: false,
    envManual: initial.envManual,
    env: "indoor",
    vision: { brightness: null, texture: null, noise: null, motion: null },
    lightLux: null,
    pose: initialPose,
    people: [],
    objects: [],
    detections: [],
    wifi: NONE_WIFI,
    mag: NONE_MAG,
    magBaseline: null,
    imu: NONE_IMU,
    geo: NONE_GEO,
    sonar: null,
    sonarTwin: null,
    sonarBusy: false,
    fused: EMPTY_FUSED,
    bt: [],
    barcodes: [],
    ocr: null,
    cloudVersion: 0,
    cloudCounts: cloud.counts(),
    gridVersion: 0,
    exploredM2: 0,
    trajectory: [],
    mapping: false,
    meshOn: false,
    cameraOn: false,
    cameraEpoch: 0,
    cameraInfo: null,
    facing: "environment",
    torch: false,
    zoom: 1,
    videoCaps: null,
    modelStatus: "idle",
    detectMs: 0,
    logs: [],
    capabilities: [],
    sensors: Object.fromEntries(SENSOR_IDS.map((id) => [id, { ...sensorMem[id] }])) as Record<SensorId, SensorStatus>,
    needsMotionGesture: false,
    rssiHist: [],
    magHist: [],
    magXHist: [],
    magYHist: [],
    magZHist: [],
    sonarHist: [],
    fpsHist: [],
    brightHist: [],
    pingHistory: [],
    selectedId: null,
    alerts: [],
    autoPing: false,
    fusion: envWeights("indoor"),
    trajLen: 0,
    steps: 0,
    sar: { L: 0.05, R: 2, delta: 0.17, lambda: 0.017 },

    // ───────────────────────── lifecycle ─────────────────────────
    start: () => {
      if (get().running) return;
      bootT = performance.now();
      lastFrameAt = 0;
      set({
        running: true,
        capabilities: probeCapabilities(),
        hidden: document.hidden,
      });
      get().pushLog(
        get().dataMode === "demo"
          ? "站点上线 · 演示模式：缺失通道由物理孪生补位并标注 TWIN"
          : "站点上线 · 真实模式：只显示真实设备数据，没有数据的通道显示 —",
        "INFO",
      );
      const needGesture = typeof (globalThis as { DeviceMotionEvent?: { requestPermission?: unknown } }).DeviceMotionEvent?.requestPermission === "function";
      set({ needsMotionGesture: needGesture });
      if (!needGesture) startMotion();
      startEnvSensors();
      if (!visibilityHooked) {
        document.addEventListener("visibilitychange", onVisibility);
        visibilityHooked = true;
      }
      timer = window.setInterval(tick, TICK_MS);
      houseTimer = window.setInterval(housekeeping, 1000);
      tick();
    },

    stop: () => {
      window.clearInterval(timer);
      window.clearInterval(houseTimer);
      if (visibilityHooked) {
        document.removeEventListener("visibilitychange", onVisibility);
        visibilityHooked = false;
      }
      for (const id of SENSOR_IDS) {
        stops[id]?.();
        delete stops[id];
        setSensor(id, { state: "off", hz: 0, lastMs: null, note: "" });
      }
      geoRequested = false;
      devMag = null;
      devImu = null;
      devGeo = null;
      devHeading = null;
      devLux = null;
      stopCamera();
      stopSonar();
      set({ running: false, cameraOn: false, autoPing: false });
      housekeeping();
    },

    setDataMode: (m) => {
      if (get().dataMode === m) return;
      cloud.clear();
      grid.clear();
      tracker.reset();
      visionDets = [];
      visionPeople = [];
      lastTrajAt = { x: NaN, z: NaN };
      pdr.reset();
      stepDet.reset();
      magBase.reset();
      resetTwin();
      const settings = { ...get().settings, dataMode: m };
      saveSettings(storage(), settings);
      set({
        dataMode: m,
        settings,
        trajectory: [],
        sonar: null,
        sonarTwin: null,
        fused: EMPTY_FUSED,
        cloudVersion: cloud.version,
        cloudCounts: cloud.counts(),
        gridVersion: grid.version,
        exploredM2: 0,
        rssiHist: [],
        magHist: [],
        magXHist: [],
        magYHist: [],
        magZHist: [],
        sonarHist: [],
        pingHistory: [],
        alerts: [],
        detections: [],
        people: [],
        steps: 0,
      });
      alertEng.reset();
      get().pushLog(m === "demo" ? "切换到演示模式 · 孪生数据会补位" : "切换到真实模式 · 仅显示真实设备数据", m === "demo" ? "INFO" : "REAL");
    },

    updateSettings: (patch) => {
      const next = parseSettings({ ...get().settings, ...patch });
      pdr.stepLength = next.stepLengthM;
      saveSettings(storage(), next);
      set({ settings: next });
    },

    setEnv: (m) => {
      get().updateSettings({ envManual: m });
      set({ envManual: m });
      get().pushLog(m === "auto" ? "环境自适应 AUTO" : `环境锁定 ${m}`);
    },

    enableSensors: async () => {
      const ok = await requestMotionPermission();
      if (ok) {
        startMotion();
        set({ needsMotionGesture: false });
      } else {
        setSensor("imu", { state: "denied", note: "运动传感器权限被拒绝" });
        setSensor("orient", { state: "denied", note: "方向传感器权限被拒绝" });
      }
      startEnvSensors();
      startGeo();
      get().pushLog("已请求传感器权限（运动 / 方向 / 磁力计 / 光 / 定位）");
    },

    // ───────────────────────── mapping ─────────────────────────
    toggleMapping: () => {
      const next = !get().mapping;
      set({ mapping: next });
      get().pushLog(next ? "开始建图" : "建图暂停");
      if (next && get().dataMode === "real" && get().sensors.orient.state !== "live") {
        toast.warning("没有罗盘读数：点云只能以 0° 朝向累积，请先启用传感器");
      }
    },
    clearMap: () => {
      cloud.clear();
      grid.clear();
      lastTrajAt = { x: NaN, z: NaN };
      set({
        trajectory: [],
        cloudVersion: cloud.version,
        cloudCounts: cloud.counts(),
        gridVersion: grid.version,
        exploredM2: 0,
        trajLen: 0,
      });
      get().pushLog("点云 / 占用栅格已清空");
    },
    setMesh: (v) => {
      set({ meshOn: v });
      get().pushLog(v ? "占用栅格显示开启" : "占用栅格显示关闭");
    },
    resetPdr: () => {
      pdr.reset();
      stepDet.reset();
      lastTrajAt = { x: NaN, z: NaN };
      set({ trajectory: [], steps: 0, trajLen: 0 });
      get().pushLog("PDR 已清零（当前位置 = 原点）");
    },

    // ───────────────────────── camera ─────────────────────────
    enableCamera: async () => {
      setSensor("camera", { state: "pending" });
      try {
        await startCamera(get().facing);
        tracker.reset();
        resetFrameHistory();
        setSensor("camera", { state: "live", note: "" });
        set((st) => ({
          cameraOn: true,
          cameraEpoch: st.cameraEpoch + 1,
          videoCaps: videoCapabilities(),
          cameraInfo: cameraSettings(),
        }));
        get().pushLog("相机已授权 · 画面接入", "REAL");
      } catch (e) {
        const name = e instanceof DOMException ? e.name : "";
        const msg = name === "NotAllowedError" ? "相机权限被拒绝" : e instanceof Error ? e.message : "相机不可用";
        setSensor("camera", { state: name === "NotAllowedError" ? "denied" : "error", note: msg });
        get().pushLog(`相机不可用：${msg}`, "WARN");
        toast.error(msg);
      }
    },
    disableCamera: () => {
      stopCamera();
      tracker.reset();
      visionDets = [];
      visionPeople = [];
      visionMetrics = null;
      setSensor("camera", { state: "off", note: "", hz: 0 });
      set({ cameraOn: false, torch: false, detections: [], cameraInfo: null });
      get().pushLog("相机已关闭");
    },
    toggleFacing: async () => {
      const prev = get().facing;
      const next: CameraFacing = prev === "environment" ? "user" : "environment";
      if (!get().cameraOn) {
        set({ facing: next });
        return;
      }
      try {
        await startCamera(next);
        tracker.reset();
        visionDets = [];
        visionPeople = [];
        resetFrameHistory();
        set((st) => ({
          facing: next,
          torch: false,
          cameraEpoch: st.cameraEpoch + 1, // forces every <video> to re-bind to the new stream
          videoCaps: videoCapabilities(),
          cameraInfo: cameraSettings(),
        }));
        get().pushLog(next === "user" ? "切换前置镜头" : "切换后置镜头");
      } catch {
        try {
          await startCamera(prev);
          set((st) => ({ cameraEpoch: st.cameraEpoch + 1, videoCaps: videoCapabilities() }));
          get().pushLog("切换镜头失败，已恢复原镜头", "WARN");
        } catch {
          set({ cameraOn: false });
          setSensor("camera", { state: "error", note: "切换镜头失败且无法恢复" });
        }
      }
    },
    toggleTorch: async () => {
      const next = !get().torch;
      const ok = await setTorch(next);
      if (ok) {
        set({ torch: next });
        get().pushLog(next ? "手电已开" : "手电已关", "REAL");
      } else get().pushLog("当前镜头不支持 torch", "WARN");
    },
    setZoomLevel: async (n) => {
      if (await setZoom(n)) set({ zoom: n });
    },

    // ───────────────────────── sonar ─────────────────────────
    ping: async () => {
      lastPingAt = performance.now();
      set({ sonarBusy: true });
      const cfg = sonarConfig(get().settings);
      const ping = await pingSonar(cfg);
      const pose = get().pose;
      integratePing(ping, pose);
      set((st) => {
        const hist = st.sonarHist.slice();
        if (ping.distM !== null) pushHist(hist, ping.distM);
        return {
          sonar: ping.status === "error" && st.sonar ? st.sonar : ping,
          pingHistory: [ping, ...st.pingHistory].slice(0, 40),
          sonarHist: hist,
          sonarBusy: false,
        };
      });
      if (ping.status === "error") setSensor("mic", { state: /权限/.test(ping.message) ? "denied" : "error", note: ping.message });
      else {
        setSensor("mic", { state: "live", note: ping.micRaw === false ? "系统仍在对麦克风做回声消除/降噪，测距可能失败" : "" });
        rateCount.mic += 1;
        sensorMem.mic.lastMs = performance.now();
      }
      get().pushLog(
        ping.status === "ok"
          ? `声呐 ${ping.distM?.toFixed(3)} m · SNR ${ping.snrDb.toFixed(1)} dB · ${ping.accepted}/${ping.pings}`
          : `声呐无结果：${ping.message}`,
        ping.status === "ok" ? "REAL" : "WARN",
      );
      return ping;
    },
    calibrateSonar: async (knownM) => {
      const cfg = sonarConfig(get().settings);
      const ping = await pingSonar({ ...cfg, average: Math.max(3, cfg.average) });
      if (ping.status !== "ok" || ping.distM === null) return `校准失败：${ping.message}`;
      // R = (spacing + cΔ)/2  ⇒  spacing_new = spacing + 2·(known − measured)
      const next = cfg.spacingM + 2 * (knownM - ping.distM);
      if (next < 0 || next > 0.3) {
        return `测得 ${ping.distM.toFixed(3)} m，与已知 ${knownM.toFixed(3)} m 偏差过大（扬声器-麦克风间距应在 0–30 cm）。请检查是否对准墙面。`;
      }
      get().updateSettings({ sonarSpacingM: Math.round(next * 1000) / 1000 });
      return `已校准：扬声器-麦克风间距 = ${(next * 100).toFixed(1)} cm（测得 ${ping.distM.toFixed(3)} m → ${knownM.toFixed(3)} m）`;
    },
    setAutoPing: (v) => {
      set({ autoPing: v });
      get().pushLog(v ? `自动声呐 ${get().settings.autoPingSec} s` : "自动声呐关闭");
    },

    // ───────────────────────── radios ─────────────────────────
    scanBt: async () => {
      setSensor("bt", { state: "pending" });
      const found = await scanBluetooth();
      if (found) {
        const dev: BtDevice = { id: found.id, name: found.name, rssi: found.rssi, source: "device" };
        set((st) => ({ bt: [dev, ...st.bt.filter((d) => d.id !== dev.id)].slice(0, 12) }));
        setSensor("bt", {
          state: "live",
          note: found.rssi === null ? "已配对，但浏览器没有返回 RSSI 广播" : "",
        });
        rateCount.bt += 1;
        sensorMem.bt.lastMs = performance.now();
        get().pushLog(`蓝牙 ${found.name}${found.rssi !== null ? ` · ${found.rssi} dBm` : " · 无 RSSI"}`, "REAL");
        toast.success(`蓝牙 ${found.name}`);
      } else {
        const supported = "bluetooth" in navigator;
        setSensor("bt", { state: supported ? "off" : "unsupported", note: supported ? "已取消" : "此浏览器没有 Web Bluetooth" });
        get().pushLog(supported ? "蓝牙选择已取消" : "此浏览器不支持 Web Bluetooth", "WARN");
      }
    },
    locate: async () => {
      geoRequested = false;
      stops.geo?.();
      startGeo();
    },
    fullCheck: () => {
      const caps = probeCapabilities();
      set({ capabilities: caps });
      const ok = caps.filter((c) => c.available).length;
      get().pushLog(`能力探测 ${ok}/${caps.length} 项可用`);
      toast.message(`能力 ${ok}/${caps.length}`);
    },

    // ───────────────────────── vision ─────────────────────────
    ingestVision: (raw, metrics, aspect, detectMs) => {
      const s = get().settings;
      const cam = camModel(s, aspect);
      const pose = get().pose;
      if (metrics) {
        visionMetrics = metrics;
        visionMetricsAt = performance.now();
      }
      detectMsEma = detectMsEma ? detectMsEma * 0.8 + detectMs * 0.2 : detectMs;
      const confirmed = tracker.update(raw.map((d) => ({ cls: d.cls, score: d.score, bbox: d.bbox })));
      const dets: Detection[] = confirmed.map((trk) => {
        const [x, y, w, h] = trk.bbox;
        const depth = estimateDepth(trk.cls, { x, y, w, h }, cam);
        const u = x + w / 2;
        const v = y + h / 2;
        const world = projectToWorld(u, v, depth.depthM, cam, pose);
        return {
          id: `trk-${trk.id}`,
          trackId: trk.id,
          cls: trk.cls,
          score: trk.score,
          bbox: [x, y, w, h],
          depthM: depth.depthM,
          sigmaM: depth.sigmaM,
          depthBasis: depth.basis,
          truncated: depth.truncated,
          world,
          source: "device",
          kind: kindOfClass(trk.cls),
          contour: [],
        };
      });
      visionDets = dets;
      visionPeople = dets
        .filter((d) => d.cls === "person")
        .map((d) => ({
          id: d.id,
          name: `目标 #${d.trackId}`,
          pos: { x: d.world.x, y: 0, z: d.world.z },
          heading: 0,
          bpm: null,
          confidence: d.score,
          source: "device" as const,
          behindWall: false,
          heightM: CLASS_HEIGHT_M.person ?? 1.7,
          cls: "person",
        }));
      if (get().mapping) {
        const t = get().t;
        for (const d of dets) {
          if ((d.sigmaM ?? 0) > d.depthM * 0.5) continue;
          const hM = CLASS_HEIGHT_M[d.cls] ?? 0.4;
          const kind: CloudKind = d.cls === "person" ? "person" : "object";
          const n = d.cls === "person" ? 8 : 3;
          for (let i = 0; i <= n; i++) cloud.add(kind, d.world.x, (hM * i) / n, d.world.z, t);
          if (!d.truncated && d.depthM < 8) grid.markOccupied(d.world.x, d.world.z);
        }
      }
      const top = dets[0];
      const prevN = get().detections.length;
      set({ detectMs: detectMsEma });
      if (top && prevN === 0) {
        get().pushLog(`视觉 ${top.cls} ${(top.score * 100).toFixed(0)}% · ≈${top.depthM.toFixed(1)} m（${top.depthBasis}）`, "DETECT");
      }
    },
    scanBarcodesOn: async (video) => {
      const now = performance.now();
      if (now - barcodeAt < 900) return;
      barcodeAt = now;
      const codes = await detectBarcodes(video);
      if (!codes.length) return;
      const prev = get().barcodes;
      const fresh = codes.filter((c) => !prev.some((p) => p.value === c.value));
      if (!fresh.length) return;
      set({ barcodes: [...fresh.map((c) => ({ ...c, t: Date.now() })), ...prev].slice(0, 20) });
      get().pushLog(`条码 ${fresh.map((c) => `${c.format}:${c.value}`).join(" / ")}`, "REAL");
      vibrate(30);
    },
    setOcr: (r) => {
      set({ ocr: r });
      if (r?.text) get().pushLog(`OCR (${r.confidence.toFixed(0)}%) ${r.text.slice(0, 48)}`, "REAL");
    },
    setModelStatus: (s) => set({ modelStatus: s }),

    pushLog: (msg, level = "INFO") => set((st) => ({ logs: [{ t: Date.now(), level, msg }, ...st.logs].slice(0, 300) })),

    // ───────────────────────── session I/O ─────────────────────────
    exportSession: () => ({
      format: "aether-session",
      version: 2,
      app: "AETHER 19",
      createdAt: new Date().toISOString(),
      dataMode: get().dataMode,
      points: cloud.toJSON(),
      trajectory: get().trajectory.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      stats: {
        steps: get().steps,
        distanceM: Math.round(get().trajLen * 100) / 100,
        exploredM2: Math.round(get().exploredM2 * 100) / 100,
      },
    }),
    importSession: (data) => {
      const r = parseSession(data);
      if (!r.ok) {
        get().pushLog(`导入失败：${r.error}`, "WARN");
        toast.error(`导入失败：${r.error}`);
        return false;
      }
      cloud.clear();
      grid.clear();
      for (const p of r.data.points) cloud.add(p.kind, p.x, p.y, p.z, p.t ?? 0);
      const traj = r.data.trajectory.map((p) => ({ x: p.x, y: p.y ?? 0.04, z: p.z }));
      set({
        trajectory: traj.slice(-3000),
        cloudVersion: cloud.version,
        cloudCounts: cloud.counts(),
        gridVersion: grid.version,
        exploredM2: 0,
      });
      const note = r.legacy ? "（v18 旧格式，视作演示数据）" : r.data.dataMode === "demo" ? "（演示数据）" : "";
      get().pushLog(`导入 ${r.data.points.length} 点 ${note}`);
      return true;
    },

    resetSession: () => {
      cloud.clear();
      grid.clear();
      tracker.reset();
      visionDets = [];
      visionPeople = [];
      alertEng.reset();
      lastTrajAt = { x: NaN, z: NaN };
      set({
        trajectory: [],
        cloudVersion: cloud.version,
        cloudCounts: cloud.counts(),
        gridVersion: grid.version,
        exploredM2: 0,
        logs: [],
        detections: [],
        barcodes: [],
        ocr: null,
        mapping: false,
        alerts: [],
        pingHistory: [],
        sonarHist: [],
        selectedId: null,
      });
      get().pushLog("会话已重置");
    },
    select: (id) => set({ selectedId: id }),
    setKindFilter: (k, v) => {
      const kindFilter = { ...get().settings.kindFilter, [k]: v };
      get().updateSettings({ kindFilter });
    },
    setView: (v) => get().updateSettings({ viewPreset: v }),
    dismissAlert: (id) => set((st) => ({ alerts: st.alerts.filter((a) => a.id !== id) })),
  };
});

