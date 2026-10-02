import type { Capability, GeoSample, ImuSample, MagSample } from "./types";

type MagCtor = new (opts?: { frequency?: number }) => {
  x: number;
  y: number;
  z: number;
  start: () => void;
  stop: () => void;
  addEventListener: (type: string, fn: () => void) => void;
};

type LightCtor = new (opts?: { frequency?: number }) => {
  illuminance: number;
  start: () => void;
  stop: () => void;
  addEventListener: (type: string, fn: () => void) => void;
};

let cameraStream: MediaStream | null = null;
let audioStream: MediaStream | null = null;
let magSensor: { stop: () => void } | null = null;
let lightSensor: { stop: () => void } | null = null;
let motionHooked = false;
let orientHooked = false;
let prevGray: Float32Array | null = null;

export function getCameraStream() {
  return cameraStream;
}

export async function startCamera(facing: "environment" | "user" = "environment"): Promise<MediaStream> {
  stopCamera();
  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: facing },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    },
    audio: false,
  });
  return cameraStream;
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

export async function startMic(): Promise<MediaStream> {
  if (audioStream) return audioStream;
  audioStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    video: false,
  });
  return audioStream;
}

export function stopMic() {
  audioStream?.getTracks().forEach((t) => t.stop());
  audioStream = null;
}

export async function startMagnetometer(onReading: (s: MagSample) => void): Promise<boolean> {
  const Mag = (window as unknown as { Magnetometer?: MagCtor }).Magnetometer;
  if (!Mag) return false;
  try {
    const perm = await navigator.permissions.query({ name: "magnetometer" as PermissionName });
    if (perm.state === "denied") return false;
  } catch {
    /* some browsers omit this permission name */
  }
  try {
    const mag = new Mag({ frequency: 20 });
    mag.addEventListener("reading", () => {
      const x = mag.x ?? 0;
      const y = mag.y ?? 0;
      const z = mag.z ?? 0;
      const m = Math.sqrt(x * x + y * y + z * z);
      onReading({ x, y, z, mag: m, anomaly: m > 65, source: "device" });
    });
    mag.start();
    magSensor = mag;
    return true;
  } catch {
    return false;
  }
}

export function stopMagnetometer() {
  magSensor?.stop();
  magSensor = null;
}

export async function startAmbientLight(onLux: (lux: number) => void): Promise<boolean> {
  const Light = (window as unknown as { AmbientLightSensor?: LightCtor }).AmbientLightSensor;
  if (!Light) return false;
  try {
    const s = new Light({ frequency: 5 });
    s.addEventListener("reading", () => onLux(s.illuminance ?? 0));
    s.start();
    lightSensor = s;
    return true;
  } catch {
    return false;
  }
}

export async function requestMotionPermission(): Promise<boolean> {
  const DM = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
  try {
    if (typeof DM.requestPermission === "function") {
      const r = await DM.requestPermission();
      return r === "granted";
    }
  } catch {
    return false;
  }
  return true;
}

export function startImu(onReading: (s: ImuSample) => void): boolean {
  if (motionHooked) return true;
  const handler = (e: DeviceMotionEvent) => {
    const a = e.accelerationIncludingGravity;
    const g = e.rotationRate;
    if (!a) return;
    onReading({
      ax: a.x ?? 0,
      ay: a.y ?? 0,
      az: a.z ?? 0,
      gx: g?.alpha ?? 0,
      gy: g?.beta ?? 0,
      gz: g?.gamma ?? 0,
      heading: 0,
      source: "device",
    });
  };
  window.addEventListener("devicemotion", handler);
  motionHooked = true;
  return true;
}

export function startOrientation(onHeading: (deg: number) => void): boolean {
  if (orientHooked) return true;
  const handler = (e: DeviceOrientationEvent) => {
    const abs = (e as DeviceOrientationEvent & { webkitCompassHeading?: number }).webkitCompassHeading;
    const alpha = e.alpha;
    const heading = typeof abs === "number" ? abs : alpha ?? 0;
    onHeading(heading);
  };
  window.addEventListener("deviceorientation", handler);
  orientHooked = true;
  return true;
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
      { enableHighAccuracy: true, timeout: 4000, maximumAge: 8000 },
    );
  });
}

export async function watchGeo(onPos: (g: GeoSample) => void): Promise<number | null> {
  if (!("geolocation" in navigator)) return null;
  return navigator.geolocation.watchPosition(
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
}

export async function scanBluetooth(): Promise<{ id: string; name: string; rssi: number } | null> {
  const bt = navigator.bluetooth;
  if (!bt) return null;
  try {
    const device = await bt.requestDevice({
      acceptAllDevices: true,
      optionalServices: [],
    });
    return { id: device.id, name: device.name || "未命名设备", rssi: -55 };
  } catch {
    return null;
  }
}

export async function detectBarcodes(source: CanvasImageSource): Promise<string[]> {
  const BD = (
    window as unknown as {
      BarcodeDetector?: new (opts: { formats: string[] }) => {
        detect: (src: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
      };
    }
  ).BarcodeDetector;
  if (!BD) return [];
  try {
    const det = new BD({ formats: ["qr_code", "ean_13", "code_128", "aztec"] });
    const codes = await det.detect(source);
    return codes.map((c) => c.rawValue).filter(Boolean);
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
      available: true,
      note: "需相机轨道支持 torch 约束",
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

export interface FrameBlob {
  cx: number;
  cy: number;
  w: number;
  h: number;
  area: number;
  aspect: number;
  cls: string;
  score: number;
  contour?: number[];
}

export interface FrameMetrics {
  brightness: number;
  texture: number;
  noise: number;
  motion: number;
  blobs: FrameBlob[];
  gray: Float32Array;
  width: number;
  height: number;
}

export function analyzeFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): FrameMetrics {
  const w = 96;
  const h = 72;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const empty: FrameMetrics = {
    brightness: 80,
    texture: 0.2,
    noise: 10,
    motion: 0,
    blobs: [],
    gray: new Float32Array(w * h),
    width: w,
    height: h,
  };
  if (!ctx || video.readyState < 2) return empty;
  ctx.drawImage(video, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let sum = 0;
  let edge = 0;
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const g = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    gray[p] = g;
    sum += g;
    if (p > 0 && Math.abs(g - (gray[p - 1] ?? g)) > 28) edge++;
  }
  const brightness = sum / (w * h);
  const texture = edge / (w * h);
  let varSum = 0;
  for (let i = 0; i < gray.length; i++) varSum += ((gray[i] ?? 0) - brightness) ** 2;
  const noise = Math.sqrt(varSum / gray.length);

  let motion = 0;
  if (prevGray && prevGray.length === gray.length) {
    let md = 0;
    for (let i = 0; i < gray.length; i += 2) md += Math.abs((gray[i] ?? 0) - (prevGray[i] ?? 0));
    motion = md / (gray.length * 0.5 * 255);
  }
  prevGray = gray.slice();

  const blobs = extractBlobs(gray, w, h);
  return { brightness, texture, noise, motion, blobs, gray, width: w, height: h };
}

function extractBlobs(gray: Float32Array, w: number, h: number): FrameBlob[] {
  const mean = gray.reduce((s, v) => s + v, 0) / gray.length;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i++) mask[i] = Math.abs((gray[i] ?? 0) - mean) > 28 ? 1 : 0;
  const seen = new Uint8Array(w * h);
  const blobs: FrameBlob[] = [];
  const stack: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i] || seen[i]) continue;
      stack.length = 0;
      stack.push(i);
      seen[i] = 1;
      let minX = x,
        maxX = x,
        minY = y,
        maxY = y,
        n = 0;
      while (stack.length) {
        const p = stack.pop()!;
        n++;
        const px = p % w;
        const py = (p / w) | 0;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        const nbs = [p - 1, p + 1, p - w, p + w];
        for (const q of nbs) {
          if (q < 0 || q >= mask.length || seen[q] || !mask[q]) continue;
          seen[q] = 1;
          stack.push(q);
        }
      }
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const area = n / (w * h);
      if (area < 0.012 || bw < 3 || bh < 3) continue;
      const aspect = bh / Math.max(bw, 1);
      let cls = "object";
      let score = 0.55 + Math.min(0.3, area * 2);
      if (aspect > 1.45 && area > 0.03 && area < 0.45) {
        cls = "person";
        score = 0.62 + Math.min(0.28, aspect / 8);
      }
      blobs.push({
        cx: (minX + maxX) / 2 / w,
        cy: (minY + maxY) / 2 / h,
        w: bw / w,
        h: bh / h,
        area,
        aspect,
        cls,
        score,
      });
    }
  }
  blobs.sort((a, b) => b.area - a.area);
  return blobs.slice(0, 8);
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
