import { toast } from "sonner";
import { create } from "zustand";
import {
  detectBarcodes,
  probeCapabilities,
  readGeo,
  requestMotionPermission,
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
} from "./device";
import { densify, envWeights, observerPose, pingFromDistance, sampleMapPoints, stepTwin } from "./engine";
import { computeSar, coverageRatio, maybeAlerts, occupancyGrid, trajLength } from "./fusion";
import { pingSonar } from "./sonar";
import type {
  Alert,
  BtDevice,
  CameraFacing,
  Capability,
  Detection,
  EnvManual,
  FusionWeights,
  GeoSample,
  ImuSample,
  KindFilter,
  LogEntry,
  MagSample,
  MapPoint,
  ModelStatus,
  OccupancyCell,
  PersonTrack,
  SampleSource,
  SarState,
  SceneObject,
  SonarPing,
  VideoCaps,
  ViewPreset,
  WifiSample,
} from "./types";

const HISTORY = 80;
const SETTINGS_KEY = "aether-v18-settings";

export interface RadarState {
  running: boolean;
  t: number;
  fps: number;
  latencyUs: number;
  clock: string;
  envManual: EnvManual;
  env: ReturnType<typeof stepTwin>["env"];
  brightness: number;
  texture: number;
  noise: number;
  motion: number;
  people: PersonTrack[];
  objects: SceneObject[];
  detections: Detection[];
  wifi: WifiSample;
  mag: MagSample;
  imu: ImuSample;
  geo: GeoSample;
  sonar: SonarPing | null;
  bt: BtDevice[];
  barcodes: string[];
  ocrText: string;
  mapPoints: MapPoint[];
  occupancy: OccupancyCell[];
  trajectory: { x: number; y: number; z: number }[];
  mapping: boolean;
  mapDensity: number;
  meshOn: boolean;
  cameraOn: boolean;
  detectOn: boolean;
  personOnly: boolean;
  contourOn: boolean;
  nightVision: boolean;
  hdr: boolean;
  torch: boolean;
  facing: CameraFacing;
  zoom: number;
  modelStatus: ModelStatus;
  logs: LogEntry[];
  capabilities: Capability[];
  rssiHist: number[];
  magHist: number[];
  magXHist: number[];
  magYHist: number[];
  magZHist: number[];
  sonarHist: number[];
  fpsHist: number[];
  brightHist: number[];
  pingHistory: SonarPing[];
  realFlags: {
    mag: boolean;
    imu: boolean;
    geo: boolean;
    camera: boolean;
    sonar: boolean;
    bt: boolean;
    light: boolean;
    orient: boolean;
  };
  lightLux: number | null;
  heading: number;
  selectedId: string | null;
  alerts: Alert[];
  kindFilter: KindFilter;
  autoPing: boolean;
  fusion: FusionWeights;
  trajLen: number;
  coverage: number;
  sar: SarState;
  videoCaps: VideoCaps | null;
  viewPreset: ViewPreset;
  start: () => void;
  stop: () => void;
  setEnv: (m: EnvManual) => void;
  toggleMapping: () => void;
  clearMap: () => void;
  densifyMap: () => void;
  setDensity: (n: number) => void;
  setMesh: (v: boolean) => void;
  enableCamera: () => Promise<void>;
  disableCamera: () => void;
  toggleFacing: () => Promise<void>;
  setDetect: (v: boolean) => void;
  setPersonOnly: (v: boolean) => void;
  setContour: (v: boolean) => void;
  setNight: (v: boolean) => void;
  setHdr: (v: boolean) => void;
  toggleTorch: () => Promise<void>;
  setZoomLevel: (n: number) => Promise<void>;
  ping: () => Promise<void>;
  setAutoPing: (v: boolean) => void;
  scanBt: () => Promise<void>;
  locate: () => Promise<void>;
  fullCheck: () => void;
  ingestVision: (
    dets: Detection[],
    metrics: { brightness: number; texture: number; noise: number; motion: number },
  ) => void;
  ingestBarcodes: (codes: string[]) => void;
  setOcr: (text: string) => void;
  setModelStatus: (s: ModelStatus) => void;
  pushLog: (msg: string, level?: LogEntry["level"]) => void;
  exportMap: () => unknown;
  importMap: (data: unknown) => void;
  resetSession: () => void;
  select: (id: string | null) => void;
  setKindFilter: (k: keyof KindFilter, v: boolean) => void;
  setView: (v: ViewPreset) => void;
  dismissAlert: (id: string) => void;
}

let timer = 0;
let lastFps = 0;
let frames = 0;
let bootT = 0;
let lastPingAt = 0;
let lastAlertAt = 0;
let prevPerson = 0;
let geoWatch: number | null = null;
let deviceMag: MagSample | null = null;
let deviceImu: ImuSample | null = null;
let deviceGeo: GeoSample | null = null;
let deviceHeading: number | null = null;
let visionMetrics: { brightness: number; texture: number; noise: number; motion: number } | null = null;
let visionDets: Detection[] = [];

function pushHist(arr: number[], v: number) {
  arr.push(v);
  if (arr.length > HISTORY) arr.shift();
}

function loadSettings(): Partial<RadarState> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<RadarState>;
  } catch {
    return {};
  }
}

function saveSettings(st: RadarState) {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        envManual: st.envManual,
        mapDensity: st.mapDensity,
        personOnly: st.personOnly,
        contourOn: st.contourOn,
        nightVision: st.nightVision,
        hdr: st.hdr,
        detectOn: st.detectOn,
        viewPreset: st.viewPreset,
        kindFilter: st.kindFilter,
      }),
    );
  } catch {
    /* quota */
  }
}

const saved = typeof window !== "undefined" ? loadSettings() : {};

export const useRadar = create<RadarState>((set, get) => ({
  running: false,
  t: 0,
  fps: 0,
  latencyUs: 180,
  clock: "--:--:--",
  envManual: saved.envManual ?? "auto",
  env: "indoor",
  brightness: 78,
  texture: 0.22,
  noise: 12,
  motion: 0,
  people: [],
  objects: [],
  detections: [],
  wifi: { rssi: -58, sigma: 1.1, ssid: "X300-AETHER", throughWall: false, source: "twin" },
  mag: { x: 18, y: -5, z: 42, mag: 46, anomaly: false, source: "twin" },
  imu: { ax: 0, ay: 9.81, az: 0, gx: 0, gy: 0, gz: 0, heading: 0, source: "twin" },
  geo: { lat: 31.2304, lng: 121.4737, accuracy: 4, source: "twin" },
  sonar: null,
  bt: [
    { id: "buds", name: "vivo TWS 4", rssi: -47, source: "twin" },
    { id: "watch", name: "Watch GT", rssi: -62, source: "twin" },
  ],
  barcodes: [],
  ocrText: "",
  mapPoints: [],
  occupancy: [],
  trajectory: [],
  mapping: false,
  mapDensity: saved.mapDensity ?? 1,
  meshOn: false,
  cameraOn: false,
  detectOn: saved.detectOn ?? true,
  personOnly: saved.personOnly ?? false,
  contourOn: saved.contourOn ?? true,
  nightVision: saved.nightVision ?? false,
  hdr: saved.hdr ?? false,
  torch: false,
  facing: "environment",
  zoom: 1,
  modelStatus: "idle",
  logs: [],
  capabilities: [],
  rssiHist: [],
  magHist: [],
  magXHist: [],
  magYHist: [],
  magZHist: [],
  sonarHist: [],
  fpsHist: [],
  brightHist: [],
  pingHistory: [],
  realFlags: { mag: false, imu: false, geo: false, camera: false, sonar: false, bt: false, light: false, orient: false },
  lightLux: null,
  heading: 0,
  selectedId: null,
  alerts: [],
  kindFilter: saved.kindFilter ?? { person: true, object: true, wall: true, free: true, traj: true, sonar: true },
  autoPing: false,
  fusion: envWeights("indoor"),
  trajLen: 0,
  coverage: 0,
  sar: { L: 0.05, R: 2, delta: 0.17, lambda: 0.017 },
  videoCaps: null,
  viewPreset: saved.viewPreset ?? "iso",

  start: () => {
    if (get().running) return;
    bootT = performance.now();
    lastFps = bootT;
    frames = 0;
    set({ running: true, capabilities: probeCapabilities() });
    get().pushLog("探测站上线 · 融合内核 20 Hz · 设备优先 / 孪生续航", "INFO");

    void requestMotionPermission().then((ok) => {
      if (ok) startImu((s) => {
        deviceImu = s;
        set((st) => ({ realFlags: { ...st.realFlags, imu: true } }));
      });
    });
    startImu((s) => {
      deviceImu = s;
      set((st) => ({ realFlags: { ...st.realFlags, imu: true } }));
    });
    startOrientation((deg) => {
      deviceHeading = deg;
      set((st) => ({ heading: deg, realFlags: { ...st.realFlags, orient: true } }));
    });
    void startMagnetometer((s) => {
      deviceMag = s;
      set((st) => ({ realFlags: { ...st.realFlags, mag: true } }));
    }).then((ok) => {
      if (ok) {
        get().pushLog("磁力计 Generic Sensor 已接入", "REAL");
        toast.success("磁力计真实通道");
      }
    });
    void startAmbientLight((lux) => {
      set((st) => ({ lightLux: lux, realFlags: { ...st.realFlags, light: true } }));
    });
    void readGeo().then((g) => {
      if (g) {
        deviceGeo = g;
        set((st) => ({ realFlags: { ...st.realFlags, geo: true }, geo: g }));
        get().pushLog(`GNSS 锁定 ${g.lat.toFixed(5)}, ${g.lng.toFixed(5)}`, "REAL");
        toast.success("GNSS 已锁定");
      }
    });
    void watchGeo((g) => {
      deviceGeo = g;
      set((st) => ({ geo: g, realFlags: { ...st.realFlags, geo: true } }));
    }).then((id) => {
      geoWatch = id;
    });

    const tick = () => {
      const t0 = performance.now();
      const t = (t0 - bootT) / 1000;
      const headingRad =
        deviceHeading != null ? (deviceHeading * Math.PI) / 180 : deviceImu ? (deviceImu.heading * Math.PI) / 180 : undefined;
      const twin = stepTwin(t, get().envManual, visionMetrics ?? undefined, headingRad);
      const mag = deviceMag ?? twin.mag;
      const imuBase = deviceImu ?? twin.imu;
      const imu = {
        ...imuBase,
        heading: deviceHeading ?? imuBase.heading,
        source: (deviceImu ? "device" : twin.imu.source) as SampleSource,
      };
      const geo = deviceGeo ?? twin.geo;
      const sonarKeep = get().sonar;
      const visionPeople: PersonTrack[] = visionDets
        .filter((d) => d.cls === "person")
        .map((d, i) => ({
          id: d.id,
          name: `视觉目标 ${i + 1}`,
          pos: d.world,
          heading: 0,
          bpm: 16,
          confidence: d.score,
          source: "device" as const,
          behindWall: false,
          heightM: Math.max(1.4, d.bbox[3] * d.depthM * 1.8),
          cls: "person",
        }));
      const people = [...twin.people, ...visionPeople];
      const detections = get().personOnly ? visionDets.filter((d) => d.cls === "person") : visionDets.length ? visionDets : [];

      let mapPoints = get().mapPoints;
      let trajectory = get().trajectory;
      if (get().mapping) {
        const extra = sampleMapPoints(twin, get().mapDensity, mapPoints.length, visionDets);
        mapPoints = mapPoints.concat(extra);
        if (mapPoints.length > 20000) mapPoints = mapPoints.slice(mapPoints.length - 18000);
        const obs = observerPose(t, headingRad);
        trajectory = trajectory.concat([{ x: obs.pos.x, y: 0.04, z: obs.pos.z }]);
        if (trajectory.length > 800) trajectory = trajectory.slice(trajectory.length - 800);
      }

      frames += 1;
      const now = performance.now();
      let fps = get().fps;
      if (now - lastFps > 500) {
        fps = (frames * 1000) / (now - lastFps);
        frames = 0;
        lastFps = now;
      }
      const latencyUs = (performance.now() - t0) * 1000;
      const rssiHist = get().rssiHist.slice();
      const magHist = get().magHist.slice();
      const magXHist = get().magXHist.slice();
      const magYHist = get().magYHist.slice();
      const magZHist = get().magZHist.slice();
      const sonarHist = get().sonarHist.slice();
      const fpsHist = get().fpsHist.slice();
      const brightHist = get().brightHist.slice();
      pushHist(rssiHist, twin.wifi.rssi);
      pushHist(magHist, mag.mag);
      pushHist(magXHist, mag.x);
      pushHist(magYHist, mag.y);
      pushHist(magZHist, mag.z);
      pushHist(sonarHist, sonarKeep?.distM ?? twin.sonarM);
      pushHist(fpsHist, fps);
      pushHist(brightHist, twin.brightness);

      const fusion = envWeights(twin.env);
      const L = trajLength(trajectory);
      const R = sonarKeep?.distM ?? twin.sonarM;
      const sar = computeSar(L, R);
      const coverage = coverageRatio(mapPoints);
      const occupancy = get().meshOn ? occupancyGrid(mapPoints) : get().occupancy;

      let alerts = get().alerts;
      if (now - lastAlertAt > 4000) {
        const fresh = maybeAlerts({
          t: now,
          throughWall: twin.wifi.throughWall,
          magAnomaly: mag.anomaly,
          sonarM: R,
          personCount: people.length,
          prevPerson,
          brightness: twin.brightness,
        });
        if (fresh.length) {
          alerts = [...fresh, ...alerts].slice(0, 24);
          lastAlertAt = now;
          if (fresh.some((a) => a.tone === "warn")) vibrate(18);
        }
      }
      prevPerson = people.length;

      if (get().autoPing && now - lastPingAt > 2200) {
        lastPingAt = now;
        void get().ping();
      }

      set({
        t,
        people,
        objects: twin.objects,
        detections,
        wifi: twin.wifi,
        mag,
        imu,
        geo,
        env: twin.env,
        brightness: twin.brightness,
        texture: twin.texture,
        noise: twin.noise,
        motion: visionMetrics?.motion ?? 0,
        mapPoints,
        occupancy,
        trajectory,
        fps,
        latencyUs,
        clock: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        rssiHist,
        magHist,
        magXHist,
        magYHist,
        magZHist,
        sonarHist,
        fpsHist,
        brightHist,
        sonar: sonarKeep ?? { ...pingFromDistance(twin.sonarM, "twin"), t: now },
        fusion,
        trajLen: L,
        coverage,
        sar,
        alerts,
        heading: deviceHeading ?? imu.heading,
      });
    };

    timer = window.setInterval(tick, 50);
    tick();
  },

  stop: () => {
    window.clearInterval(timer);
    if (geoWatch != null) navigator.geolocation.clearWatch(geoWatch);
    set({ running: false });
  },

  setEnv: (m) => {
    set({ envManual: m });
    get().pushLog(m === "auto" ? "环境自适应 AUTO" : `环境锁定 ${m}`);
    saveSettings(get());
  },
  toggleMapping: () => {
    const next = !get().mapping;
    set({ mapping: next });
    get().pushLog(next ? "开始自主建图" : "建图暂停");
  },
  clearMap: () => {
    set({ mapPoints: [], trajectory: [], occupancy: [], trajLen: 0, coverage: 0 });
    get().pushLog("点云已清空");
  },
  densifyMap: () => {
    set({ mapPoints: densify(get().mapPoints) });
    get().pushLog(`点云加密 · ${get().mapPoints.length} 点`);
  },
  setDensity: (n) => {
    set({ mapDensity: n });
    saveSettings(get());
  },
  setMesh: (v) => {
    set({ meshOn: v, occupancy: v ? occupancyGrid(get().mapPoints) : [] });
    get().pushLog(v ? "占用网格已生成" : "网格已关闭");
  },

  enableCamera: async () => {
    try {
      await startCamera(get().facing);
      const caps = videoCapabilities();
      set((st) => ({ cameraOn: true, realFlags: { ...st.realFlags, camera: true }, videoCaps: caps }));
      get().pushLog("相机已授权 · 实时画面接入", "REAL");
      toast.success("相机真实通道");
    } catch (e) {
      get().pushLog(`相机不可用：${e instanceof Error ? e.message : "权限拒绝"}`, "WARN");
      toast.error("相机授权失败");
    }
  },
  disableCamera: () => {
    stopCamera();
    visionDets = [];
    visionMetrics = null;
    set({ cameraOn: false, torch: false });
    get().pushLog("相机已关闭");
  },
  toggleFacing: async () => {
    const next: CameraFacing = get().facing === "environment" ? "user" : "environment";
    set({ facing: next });
    if (get().cameraOn) {
      try {
        await startCamera(next);
        set({ videoCaps: videoCapabilities() });
        get().pushLog(next === "user" ? "切换前置镜头" : "切换环境镜头");
      } catch {
        get().pushLog("切换镜头失败", "WARN");
      }
    }
  },
  setDetect: (v) => {
    set({ detectOn: v });
    saveSettings(get());
  },
  setPersonOnly: (v) => {
    set({ personOnly: v });
    saveSettings(get());
  },
  setContour: (v) => {
    set({ contourOn: v });
    saveSettings(get());
  },
  setNight: (v) => {
    set({ nightVision: v });
    saveSettings(get());
  },
  setHdr: (v) => {
    set({ hdr: v });
    saveSettings(get());
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
    const ok = await setZoom(n);
    if (ok) set({ zoom: n });
  },

  ping: async () => {
    const twin = stepTwin(get().t, get().envManual);
    const ping = await pingSonar(twin.sonarM);
    lastPingAt = performance.now();
    set((st) => ({
      sonar: ping,
      pingHistory: [ping, ...st.pingHistory].slice(0, 40),
      realFlags: { ...st.realFlags, sonar: ping.source === "device" },
    }));
    get().pushLog(
      `声呐 ${ping.distM.toFixed(3)} m · Δt ${ping.dtUs.toFixed(0)} μs · ${ping.source === "device" ? "互相关真实" : "孪生回波"}`,
      ping.source === "device" ? "REAL" : "INFO",
    );
  },
  setAutoPing: (v) => {
    set({ autoPing: v });
    get().pushLog(v ? "自动声呐 2.2 s" : "自动声呐关闭");
  },

  scanBt: async () => {
    const found = await scanBluetooth();
    if (found) {
      set((st) => ({
        bt: [{ ...found, source: "device" }, ...st.bt.filter((d) => d.id !== found.id)].slice(0, 12),
        realFlags: { ...st.realFlags, bt: true },
      }));
      get().pushLog(`蓝牙发现 ${found.name}`, "REAL");
      toast.success(`蓝牙 ${found.name}`);
    } else {
      get().pushLog("Web Bluetooth 取消或不可用 · 保留孪生设备", "WARN");
    }
  },

  locate: async () => {
    const g = await readGeo();
    if (g) {
      deviceGeo = g;
      set((st) => ({ geo: g, realFlags: { ...st.realFlags, geo: true } }));
      get().pushLog("GNSS 已刷新", "REAL");
    } else get().pushLog("定位失败或被拒绝", "WARN");
  },

  fullCheck: () => {
    const caps = probeCapabilities();
    set({ capabilities: caps });
    const ok = caps.filter((c) => c.available).length;
    get().pushLog(`全检查 ${ok}/${caps.length} 项浏览器能力可用`);
    toast.message(`能力 ${ok}/${caps.length}`);
  },

  ingestVision: (dets, metrics) => {
    visionDets = dets;
    visionMetrics = metrics;
    if (dets.length && Math.random() < 0.12) {
      const top = dets[0];
      if (top) get().pushLog(`视觉 ${top.cls} ${(top.score * 100).toFixed(0)}% · ${top.depthM.toFixed(2)} m`, "DETECT");
    }
  },
  ingestBarcodes: (codes) => {
    if (!codes.length) return;
    set({ barcodes: codes });
    get().pushLog(`条码 ${codes.join(" / ")}`, "REAL");
  },
  setOcr: (text) => {
    set({ ocrText: text });
    if (text) get().pushLog(`OCR ${text.slice(0, 48)}`, "REAL");
  },
  setModelStatus: (s) => set({ modelStatus: s }),

  pushLog: (msg, level = "INFO") =>
    set((st) => ({ logs: [{ t: Date.now(), level, msg }, ...st.logs].slice(0, 240) })),

  exportMap: () => ({
    version: "18.0",
    device: "vivo X300 V2509A",
    t: get().t,
    points: get().mapPoints,
    trajectory: get().trajectory,
    occupancy: get().occupancy,
    people: get().people,
    env: get().env,
  }),
  importMap: (data) => {
    const d = data as { points?: MapPoint[]; trajectory?: RadarState["trajectory"] };
    if (!d?.points) {
      get().pushLog("导入失败：无点云", "WARN");
      return;
    }
    set({
      mapPoints: d.points.slice(0, 20000),
      trajectory: d.trajectory?.slice(0, 800) ?? [],
    });
    get().pushLog(`导入点云 ${d.points.length}`);
  },

  resetSession: () => {
    visionDets = [];
    visionMetrics = null;
    set({
      mapPoints: [],
      trajectory: [],
      occupancy: [],
      logs: [],
      detections: [],
      barcodes: [],
      ocrText: "",
      mapping: false,
      alerts: [],
      pingHistory: [],
      selectedId: null,
    });
    get().pushLog("会话已重置");
  },
  select: (id) => set({ selectedId: id }),
  setKindFilter: (k, v) => {
    set((st) => ({ kindFilter: { ...st.kindFilter, [k]: v } }));
    saveSettings(get());
  },
  setView: (v) => {
    set({ viewPreset: v });
    saveSettings(get());
  },
  dismissAlert: (id) => set((st) => ({ alerts: st.alerts.filter((a) => a.id !== id) })),
}));

export async function scanFrameBarcodes(canvas: HTMLCanvasElement) {
  const codes = await detectBarcodes(canvas);
  if (codes.length) useRadar.getState().ingestBarcodes(codes);
}
