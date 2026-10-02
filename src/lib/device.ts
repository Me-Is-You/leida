import { compassHeading, cameraPitchDeg } from "./core/compass.ts";
import { grayStats, rgbaToGray } from "./core/imageops.ts";
import { MotionDetector } from "./core/motion-detect.ts";
import type { Capability, GeoSample, ImuSample, MagSample } from "./types";

type SensorCtor<T> = new (opts?: { frequency?: number }) => T & {
  start: () => void;
  stop: () => void;
  addEventListener: (type: string, fn: () => void) => void;
};
type MagLike = SensorCtor<{ x: number; y: number; z: number }>;
type LightLike = SensorCtor<{ illuminance: number }>;

let cameraStream: MediaStream | null = null;
let prevGray: Uint8Array | null = null;
let grayBuf: Uint8Array | null = null;
let motionDet: MotionDetector | null = null;
let frameCtx: CanvasRenderingContext2D | null = null;
let frameCanvas: HTMLCanvasElement | null = null;

export function getCameraStream() {
  return cameraStream;
}

export async function startCamera(facing: "environment" | "user" = "environment"): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("此浏览器不支持相机 (需要 HTTPS)");
  // Release the old track *before* asking for the new one: many phones cannot
  // open two cameras at once (the cause of the black screen when flipping).
  stopCamera();
  await new Promise((r) => setTimeout(r, 80));
  const tries: MediaStreamConstraints[] = [
    { video: { facingMode: { exact: facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } }, audio: false },
    { video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: true, audio: false },
  ];
  let lastErr: unknown;
  for (const c of tries) {
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia(c);
      return cameraStream;
    } catch (e) {
      lastErr = e;
      if (e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError")) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("相机不可用");
}

export function cameraSettings(): { width: number; height: number; fps: number; facing: string } | null {
  const t = cameraStream?.getVideoTracks()[0];
  if (!t) return null;
  const s = t.getSettings();
  return { width: s.width ?? 0, height: s.height ?? 0, fps: s.frameRate ?? 0, facing: s.facingMode ?? "?" };
}

export function stopCamera() {
  cameraStream?.getTracks().forEach((t) => t.stop());
  cameraStream = null;
}

export function getVideoTrack() {
  return cameraStream?.getVideoTracks()[0] ?? null;
}

export function videoCapabilities(): { torch: boolean; zoomMin: number; zoomMax: number } | null {
  const track = getVideoTrack();
  if (!track || typeof track.getCapabilities !== "function") return null;
  const caps = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean; zoom?: { min: number; max: number } };
  return {
    torch: !!caps.torch,
    zoomMin: caps.zoom?.min ?? 1,
    zoomMax: caps.zoom?.max ?? 1,
  };
}

export async function setTorch(on: boolean): Promise<boolean> {
  const track = getVideoTrack();
  if (!track) return false;
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as unknown as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

export async function setZoom(value: number): Promise<boolean> {
  const track = getVideoTrack();
  if (!track) return false;
  try {
    await track.applyConstraints({ advanced: [{ zoom: value } as unknown as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

export type StopFn = () => void;
const noop: StopFn = () => undefined;

export async function startMagnetometer(onReading: (s: MagSample) => void, hz = 20): Promise<StopFn | null> {
  const Mag = (window as unknown as { Magnetometer?: MagLike }).Magnetometer;
  if (!Mag) return null;
  try {
    const perm = await navigator.permissions.query({ name: "magnetometer" as PermissionName });
    if (perm.state === "denied") return null;
  } catch {
    /* some browsers omit this permission name */
  }
  try {
    const mag = new Mag({ frequency: hz });
    mag.addEventListener("reading", () => {
      const x = mag.x ?? 0;
      const y = mag.y ?? 0;
      const z = mag.z ?? 0;
      onReading({ x, y, z, mag: Math.sqrt(x * x + y * y + z * z), anomaly: false, source: "device" });
    });
    mag.addEventListener("error", () => undefined);
    mag.start();
    return () => mag.stop();
  } catch {
    return null;
  }
}

export async function startAmbientLight(onLux: (lux: number) => void): Promise<StopFn | null> {
  const Light = (window as unknown as { AmbientLightSensor?: LightLike }).AmbientLightSensor;
  if (!Light) return null;
  try {
    const s = new Light({ frequency: 5 });
    s.addEventListener("reading", () => onLux(s.illuminance ?? 0));
    s.addEventListener("error", () => undefined);
    s.start();
    return () => s.stop();
  } catch {
    return null;
  }
}

/** iOS needs an explicit permission call from a user gesture; Android resolves true. */
export async function requestMotionPermission(): Promise<boolean> {
  const DM = (typeof DeviceMotionEvent !== "undefined" ? DeviceMotionEvent : null) as unknown as {
    requestPermission?: () => Promise<string>;
  } | null;
  const DO = (typeof DeviceOrientationEvent !== "undefined" ? DeviceOrientationEvent : null) as unknown as {
    requestPermission?: () => Promise<string>;
  } | null;
  try {
    if (DM && typeof DM.requestPermission === "function") {
      const r = await DM.requestPermission();
      if (r !== "granted") return false;
    }
    if (DO && typeof DO.requestPermission === "function") {
      const r = await DO.requestPermission();
      if (r !== "granted") return false;
    }
  } catch {
    return false;
  }
  return true;
}

export interface MotionEvt extends ImuSample {
  /** Event time in seconds (performance.now based). */
  tSec: number;
}

export function startImu(onReading: (s: MotionEvt) => void): StopFn {
  if (typeof window === "undefined" || !("DeviceMotionEvent" in window)) return noop;
  const handler = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    const g = e.rotationRate;
    if (!a || a.x == null || a.y == null || a.z == null) return;
    onReading({
      ax: a.x,
      ay: a.y,
      az: a.z,
      // W3C: rotationRate.alpha = about z, beta = about x, gamma = about y (deg/s)
      gx: g?.beta ?? 0,
      gy: g?.gamma ?? 0,
      gz: g?.alpha ?? 0,
      heading: 0,
      source: "device",
      tSec: performance.now() / 1000,
    });
  };
  window.addEventListener("devicemotion", handler);
  return () => window.removeEventListener("devicemotion", handler);
}

export interface OrientEvt {
  /** Compass heading of the BACK camera axis, deg clockwise from north. */
  heading: number;
  /** Elevation of the back camera axis above the horizon, deg. */
  pitch: number;
  /** True when the heading is referenced to magnetic north (not an arbitrary start). */
  absolute: boolean;
}

export function startOrientation(on: (o: OrientEvt) => void): StopFn {
  if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return noop;
  const hasAbs = "ondeviceorientationabsolute" in window;
  const handler = (e: DeviceOrientationEvent) => {
    const wk = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
    if (e.beta == null || e.gamma == null) return;
    const pitch = cameraPitchDeg(e.beta, e.gamma);
    if (typeof wk === "number" && Number.isFinite(wk)) {
      // iOS: already tilt-compensated compass heading, magnetic north referenced.
      on({ heading: wk, pitch, absolute: true });
      return;
    }
    if (e.alpha == null) return;
    on({ heading: compassHeading(e.alpha, e.beta, e.gamma), pitch, absolute: e.absolute === true || hasAbs });
  };
  const evt = hasAbs ? "deviceorientationabsolute" : "deviceorientation";
  window.addEventListener(evt, handler as EventListener);
  return () => window.removeEventListener(evt, handler as EventListener);
}

export async function readGeo(): Promise<GeoSample | null> {
  if (!("geolocation" in navigator)) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
          source: "device",
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 6000, maximumAge: 8000 },
    );
  });
}

export function watchGeo(onPos: (g: GeoSample) => void): StopFn {
  if (!("geolocation" in navigator)) return noop;
  const id = navigator.geolocation.watchPosition(
    (p) =>
      onPos({
        lat: p.coords.latitude,
        lng: p.coords.longitude,
        accuracy: p.coords.accuracy,
        source: "device",
      }),
    () => undefined,
    { enableHighAccuracy: true, maximumAge: 2000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

export interface BtResult {
  id: string;
  name: string;
  /** dBm, or null when the browser did not deliver an advertisement. */
  rssi: number | null;
}

type BtDeviceLike = {
  id: string;
  name?: string;
  watchAdvertisements?: (o?: { signal?: AbortSignal }) => Promise<void>;
  addEventListener: (t: string, fn: (e: Event) => void) => void;
  removeEventListener: (t: string, fn: (e: Event) => void) => void;
};

/** Must be called from a click. RSSI is only known if advertisements arrive within `waitMs`. */
export async function scanBluetooth(waitMs = 3500): Promise<BtResult | null> {
  const bt = (navigator as Navigator & { bluetooth?: { requestDevice: (o: unknown) => Promise<BtDeviceLike> } }).bluetooth;
  if (!bt) return null;
  try {
    const device = await bt.requestDevice({ acceptAllDevices: true, optionalServices: [] });
    let rssi: number | null = null;
    if (typeof device.watchAdvertisements === "function") {
      const ac = new AbortController();
      const on = (e: Event) => {
        const r = (e as Event & { rssi?: number }).rssi;
        if (typeof r === "number") rssi = r;
      };
      device.addEventListener("advertisementreceived", on);
      try {
        await device.watchAdvertisements({ signal: ac.signal });
        await new Promise((r) => setTimeout(r, waitMs));
      } catch {
        /* unsupported / blocked */
      } finally {
        ac.abort();
        device.removeEventListener("advertisementreceived", on);
      }
    }
    return { id: device.id, name: device.name || "未命名设备", rssi };
  } catch {
    return null;
  }
}

type BarcodeDetectorLike = { detect: (src: CanvasImageSource) => Promise<Array<{ rawValue: string; format?: string }>> };
let barcodeDetector: BarcodeDetectorLike | null = null;

export function barcodeSupported(): boolean {
  return typeof window !== "undefined" && "BarcodeDetector" in window;
}

/** Scans `source` at its native resolution (pass the <video>, not a 96×72 thumbnail). */
export async function detectBarcodes(source: CanvasImageSource): Promise<{ value: string; format: string }[]> {
  if (!barcodeSupported()) return [];
  try {
    if (!barcodeDetector) {
      const BD = (window as unknown as { BarcodeDetector: new (o?: { formats: string[] }) => BarcodeDetectorLike }).BarcodeDetector;
      barcodeDetector = new BD();
    }
    const codes = await barcodeDetector.detect(source);
    return codes.filter((c) => c.rawValue).map((c) => ({ value: c.rawValue, format: c.format ?? "?" }));
  } catch {
    return [];
  }
}

export function probeCapabilities(): Capability[] {
  const has = (k: string) => k in navigator || k in window;
  return [
    {
      id: "camera",
      label: "相机 getUserMedia",
      available: !!navigator.mediaDevices?.getUserMedia,
      note: "200 MP 主摄 / 环境镜头",
    },
    {
      id: "mic",
      label: "麦克风",
      available: !!navigator.mediaDevices?.getUserMedia,
      note: "18–22 kHz chirp 互相关声呐",
    },
    {
      id: "mag",
      label: "磁力计 Generic Sensor",
      available: "Magnetometer" in window,
      note: "Chrome Android · ±4900 μT",
    },
    {
      id: "imu",
      label: "DeviceMotion IMU",
      available: "DeviceMotionEvent" in window,
      note: "BMI270 加速度 + 陀螺",
    },
    {
      id: "geo",
      label: "Geolocation GNSS",
      available: "geolocation" in navigator,
      note: "双频六系统",
    },
    {
      id: "bt",
      label: "Web Bluetooth",
      available: "bluetooth" in navigator,
      note: "需用户手势 · HTTPS",
    },
    {
      id: "light",
      label: "AmbientLightSensor",
      available: "AmbientLightSensor" in window,
      note: "TMD3725 环境光",
    },
    {
      id: "barcode",
      label: "BarcodeDetector",
      available: "BarcodeDetector" in window,
      note: "原生条码 / QR",
    },
    {
      id: "orient",
      label: "DeviceOrientation",
      available: "DeviceOrientationEvent" in window,
      note: "航向 / 俯仰",
    },
    {
      id: "torch",
      label: "手电筒 torch",
      available: !!videoCapabilities()?.torch,
      note: "需相机开启且镜头轨道支持 torch 约束",
    },
    {
      id: "wifi",
      label: "Wi-Fi RSSI API",
      available: false,
      note: "浏览器不开放 RSSI · 物理孪生 + 原机 dumpsys",
    },
    {
      id: "csi",
      label: "Wi-Fi CSI",
      available: false,
      note: "MediaTek 未开放 · 硬天花板",
    },
    {
      id: "tof",
      label: "ToF 深度",
      available: false,
      note: "X300 无 ToF · 视觉估距",
    },
    {
      id: "thermal",
      label: "热成像",
      available: false,
      note: "需 OTG 外设",
    },
    {
      id: "secure",
      label: "安全上下文 HTTPS",
      available: typeof window !== "undefined" && window.isSecureContext,
      note: "相机 / 麦克风 / 传感器 / 蓝牙均要求 HTTPS 或 localhost",
    },
    {
      id: "perf",
      label: "performance.now",
      available: has("performance"),
      note: "微秒级时间戳",
    },
    {
      id: "vibrate",
      label: "振动反馈",
      available: "vibrate" in navigator,
      note: "近距 / 异常告警",
    },
  ];
}

export interface FrameMetrics {
  /** Mean luma 0–255 of a 96×72 thumbnail. */
  brightness: number;
  /** Edge density 0–1. */
  texture: number;
  /** Luma standard deviation (global contrast, not sensor noise). */
  noise: number;
  /** Mean absolute frame difference 0–1. */
  motion: number;
  /** Moving blobs (normalised x,y,w,h) from the own background-subtraction detector; empty while the camera itself moves. */
  moving: [number, number, number, number][];
  /** True when most of the frame changed (hand-held motion / exposure jump) so blobs are not meaningful. */
  egoMotion: boolean;
}

const TW = 96;
const TH = 72;

/**
 * One-pass frame analysis on a 96×72 thumbnail: brightness / texture / contrast /
 * global motion (integer luma, no per-frame float allocations) plus the moving
 * blobs of the background-subtraction detector. Returns null when no frame is ready.
 */
export function analyzeFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): FrameMetrics | null {
  if (video.readyState < 2 || !video.videoWidth) return null;
  if (frameCanvas !== canvas || !frameCtx) {
    canvas.width = TW;
    canvas.height = TH;
    frameCtx = canvas.getContext("2d", { willReadFrequently: true });
    frameCanvas = canvas;
  }
  const ctx = frameCtx;
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, TW, TH);
  const d = ctx.getImageData(0, 0, TW, TH).data;
  const gray = new Uint8Array(TW * TH);
  rgbaToGray(d, gray);
  const st = grayStats(gray, TW, prevGray);
  motionDet ??= new MotionDetector(TW, TH);
  const m = motionDet.update(gray);
  prevGray = gray;
  grayBuf = gray;
  return {
    brightness: st.brightness,
    texture: st.texture,
    noise: st.contrast,
    motion: st.motion,
    moving: m.boxes.map((b) => [b.x / TW, b.y / TH, b.w / TW, b.h / TH] as [number, number, number, number]),
    egoMotion: m.egoMotion,
  };
}

/** Last analysed thumbnail (96×72 gray), e.g. for text-region hints. */
export function lastGray(): { data: Uint8Array; w: number; h: number } | null {
  return grayBuf ? { data: grayBuf, w: TW, h: TH } : null;
}

export function resetFrameHistory() {
  prevGray = null;
  motionDet?.reset();
}

export function hostRuntime() {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string; downlink?: number } };
  return {
    ua: nav.userAgent,
    cores: nav.hardwareConcurrency || 0,
    memoryGb: nav.deviceMemory ?? null,
    lang: nav.language,
    touch: nav.maxTouchPoints || 0,
    dpr: typeof window !== "undefined" ? window.devicePixelRatio : 1,
    screen: typeof window !== "undefined" ? `${window.screen.width}×${window.screen.height}` : "—",
    connection: nav.connection?.effectiveType ?? "—",
    downlink: nav.connection?.downlink ?? null,
    online: nav.onLine,
    platform: nav.platform,
  };
}

export async function readBattery(): Promise<{ level: number; charging: boolean } | null> {
  const n = navigator as Navigator & { getBattery?: () => Promise<{ level: number; charging: boolean }> };
  if (!n.getBattery) return null;
  try {
    const b = await n.getBattery();
    return { level: b.level, charging: b.charging };
  } catch {
    return null;
  }
}

export function vibrate(ms = 24) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* ignore */
  }
}
