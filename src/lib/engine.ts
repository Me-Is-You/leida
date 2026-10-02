import { clamp, dist3, lerp } from "./utils";
import type {
  Detection,
  EnvManual,
  EnvMode,
  FusionWeights,
  GeoSample,
  ImuSample,
  MagSample,
  MapPoint,
  PersonTrack,
  SampleSource,
  SceneObject,
  Vec3,
  WifiSample,
} from "./types";

export const ROOM = { w: 14, d: 10, h: 2.8 };
export const AP: Vec3 = { x: -5.4, y: 1.15, z: -3.8 };
export const WALL_X = 3.2;

const SOUND_MPS = 343;

export interface TwinState {
  t: number;
  people: PersonTrack[];
  objects: SceneObject[];
  wifi: WifiSample;
  mag: MagSample;
  imu: ImuSample;
  geo: GeoSample;
  sonarM: number;
  brightness: number;
  texture: number;
  noise: number;
  env: EnvMode;
}

const OBJECTS: SceneObject[] = [
  { id: "sofa", name: "沙发", kind: "furniture", pos: { x: -2.2, y: 0.42, z: 2.4 }, size: { x: 2.4, y: 0.84, z: 0.9 }, metal: false },
  { id: "tv", name: "电视", kind: "appliance", pos: { x: -2.1, y: 1.05, z: -3.1 }, size: { x: 1.4, y: 0.8, z: 0.08 }, metal: true },
  { id: "pipe", name: "金属立管", kind: "metal", pos: { x: 5.6, y: 1.4, z: -2.2 }, size: { x: 0.08, y: 2.8, z: 0.08 }, metal: true },
  { id: "keys", name: "钥匙串", kind: "metal", pos: { x: 0.6, y: 0.82, z: 1.1 }, size: { x: 0.08, y: 0.02, z: 0.04 }, metal: true },
  { id: "plant", name: "绿植", kind: "plant", pos: { x: 1.8, y: 0.7, z: 3.4 }, size: { x: 0.5, y: 1.4, z: 0.5 }, metal: false },
  { id: "buds", name: "蓝牙耳机盒", kind: "device", pos: { x: -1.4, y: 0.84, z: 2.1 }, size: { x: 0.07, y: 0.03, z: 0.05 }, metal: true },
  { id: "ap", name: "Wi-Fi 7 路由", kind: "device", pos: AP, size: { x: 0.22, y: 0.05, z: 0.16 }, metal: true },
  { id: "desk", name: "工作台", kind: "furniture", pos: { x: 5.1, y: 0.74, z: 1.6 }, size: { x: 1.6, y: 0.74, z: 0.7 }, metal: false },
  { id: "fridge", name: "冰箱", kind: "appliance", pos: { x: 6.2, y: 0.9, z: -4.1 }, size: { x: 0.7, y: 1.8, z: 0.7 }, metal: true },
];

interface Actor {
  id: string;
  name: string;
  heightM: number;
  gait: "orbit" | "sit" | "pace";
  cx: number;
  cz: number;
  rx: number;
  rz: number;
  speed: number;
  phase: number;
  restY: number;
}

const ACTORS: Actor[] = [
  { id: "p1", name: "林晚", heightM: 1.68, gait: "orbit", cx: -1.6, cz: 0.4, rx: 2.4, rz: 1.6, speed: 0.42, phase: 0.2, restY: 0 },
  { id: "p2", name: "顾深", heightM: 1.76, gait: "sit", cx: -2.4, cz: 2.35, rx: 0.12, rz: 0.08, speed: 0.15, phase: 1.1, restY: 0.42 },
  { id: "p3", name: "墙后目标", heightM: 1.72, gait: "pace", cx: 6.4, cz: -0.6, rx: 1.8, rz: 0.4, speed: 0.55, phase: 2.4, restY: 0 },
];

const rssiWindow: number[] = [];
const magWindow: number[] = [];

function actorPos(a: Actor, t: number): Vec3 {
  const ph = t * a.speed + a.phase;
  if (a.gait === "sit") {
    return {
      x: a.cx + Math.sin(ph * 0.4) * a.rx,
      y: a.restY,
      z: a.cz + Math.cos(ph * 0.3) * a.rz,
    };
  }
  if (a.gait === "pace") {
    return {
      x: a.cx + Math.sin(ph) * a.rx,
      y: 0,
      z: a.cz + Math.sin(ph * 0.25) * a.rz,
    };
  }
  return {
    x: a.cx + Math.cos(ph) * a.rx,
    y: 0,
    z: a.cz + Math.sin(ph * 0.73) * a.rz,
  };
}

function headingOf(a: Actor, t: number): number {
  const p0 = actorPos(a, t);
  const p1 = actorPos(a, t + 0.05);
  return Math.atan2(p1.x - p0.x, p1.z - p0.z);
}

function wallsBetween(a: Vec3, b: Vec3) {
  const crosses = (a.x - WALL_X) * (b.x - WALL_X) < 0;
  return crosses ? 1 : 0;
}

function wifiAt(observer: Vec3, movers: Vec3[]): WifiSample {
  const d = dist3(observer, AP);
  const walls = wallsBetween(observer, AP);
  const pathLoss = 20 * Math.log10(Math.max(d, 0.4)) + 28;
  let rssi = -22 - pathLoss - walls * 8.4;
  for (const m of movers) {
    const md = dist3(m, AP);
    const mw = wallsBetween(m, AP);
    if (mw > 0) {
      const fade = 1.8 * Math.exp(-md / 6);
      rssi -= fade * (0.4 + 0.6 * Math.sin(md));
    }
  }
  rssi += (Math.random() - 0.5) * 0.7;
  rssiWindow.push(rssi);
  if (rssiWindow.length > 24) rssiWindow.shift();
  const mean = rssiWindow.reduce((s, v) => s + v, 0) / rssiWindow.length;
  const sigma = Math.sqrt(rssiWindow.reduce((s, v) => s + (v - mean) ** 2, 0) / rssiWindow.length);
  return {
    rssi,
    sigma,
    ssid: "X300-AETHER",
    throughWall: sigma > 2.5,
    source: "twin",
  };
}

function magAt(observer: Vec3, t: number): MagSample {
  let x = 18.2 + 0.15 * Math.sin(t * 0.03);
  let y = -4.6;
  let z = 42.4;
  for (const obj of OBJECTS) {
    if (!obj.metal) continue;
    const dx = observer.x - obj.pos.x;
    const dy = observer.y - obj.pos.y;
    const dz = observer.z - obj.pos.z;
    const r2 = dx * dx + dy * dy + dz * dz + 0.04;
    const r = Math.sqrt(r2);
    const moment = obj.kind === "metal" ? 38 : 12;
    const k = moment / (r2 * r);
    x += k * dx;
    y += k * dy;
    z += k * dz;
  }
  const mag = Math.sqrt(x * x + y * y + z * z);
  magWindow.push(mag);
  if (magWindow.length > 20) magWindow.shift();
  const mean = magWindow.reduce((s, v) => s + v, 0) / magWindow.length;
  return {
    x,
    y,
    z,
    mag,
    anomaly: Math.abs(mag - mean) > 4.5 || mag > 58,
    source: "twin",
  };
}

function rayRange(origin: Vec3, heading: number): number {
  const dir = { x: Math.sin(heading), z: Math.cos(heading) };
  let best = 6.5;
  const walls = [
    { x0: -ROOM.w / 2, z0: -ROOM.d / 2, x1: ROOM.w / 2, z1: -ROOM.d / 2 },
    { x0: -ROOM.w / 2, z0: ROOM.d / 2, x1: ROOM.w / 2, z1: ROOM.d / 2 },
    { x0: -ROOM.w / 2, z0: -ROOM.d / 2, x1: -ROOM.w / 2, z1: ROOM.d / 2 },
    { x0: ROOM.w / 2, z0: -ROOM.d / 2, x1: ROOM.w / 2, z1: ROOM.d / 2 },
    { x0: WALL_X, z0: -ROOM.d / 2, x1: WALL_X, z1: ROOM.d / 2 },
  ];
  for (const w of walls) {
    const hit = raySeg(origin.x, origin.z, dir.x, dir.z, w.x0, w.z0, w.x1, w.z1);
    if (hit !== null && hit < best) best = hit;
  }
  for (const obj of OBJECTS) {
    const dx = obj.pos.x - origin.x;
    const dz = obj.pos.z - origin.z;
    const along = dx * dir.x + dz * dir.z;
    if (along <= 0.05) continue;
    const px = origin.x + dir.x * along;
    const pz = origin.z + dir.z * along;
    if (Math.abs(px - obj.pos.x) < obj.size.x * 0.55 && Math.abs(pz - obj.pos.z) < obj.size.z * 0.55) {
      if (along < best) best = along;
    }
  }
  return clamp(best + (Math.random() - 0.5) * 0.012, 0.08, 8);
}

function raySeg(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
): number | null {
  const vx = x1 - x0;
  const vz = z1 - z0;
  const den = dx * vz - dz * vx;
  if (Math.abs(den) < 1e-8) return null;
  const t = ((x0 - ox) * vz - (z0 - oz) * vx) / den;
  const u = ((x0 - ox) * dz - (z0 - oz) * dx) / den;
  if (t > 0.05 && u >= 0 && u <= 1) return t;
  return null;
}

function classifyEnv(brightness: number, texture: number, noise: number, wifi: WifiSample): EnvMode {
  if (wifi.throughWall && wifi.sigma > 2.5) return "through";
  if (noise > 42) return "noisy";
  if (brightness < 35) return "lowlight";
  if (brightness > 180) return "bright";
  if (texture > 0.45) return "clutter";
  if (brightness > 125 && texture < 0.18) return "outdoor";
  return "indoor";
}

export function observerPose(t: number, headingOverride?: number): { pos: Vec3; heading: number } {
  const heading = headingOverride ?? 0.15 * Math.sin(t * 0.11);
  const walk = 0.35 * Math.sin(t * 0.07);
  return {
    pos: { x: -4.2 + walk, y: 1.35, z: 3.6 - 0.2 * Math.cos(t * 0.05) },
    heading,
  };
}

export function stepTwin(
  t: number,
  envManual: EnvManual,
  vision?: { brightness: number; texture: number; noise: number },
  headingOverride?: number,
): TwinState {
  const people: PersonTrack[] = ACTORS.map((a) => {
    const pos = actorPos(a, t);
    const bpm = 14 + 2.2 * Math.sin(t * 0.33 + a.phase) + (a.gait === "orbit" ? 4 : 0);
    return {
      id: a.id,
      name: a.name,
      pos: { ...pos, y: pos.y },
      heading: headingOf(a, t),
      bpm,
      confidence: a.gait === "sit" ? 0.92 : 0.78,
      source: "twin" as SampleSource,
      behindWall: pos.x > WALL_X,
      heightM: a.heightM,
      cls: "person",
    };
  });

  const obs = observerPose(t, headingOverride);
  const movers = people.map((p) => p.pos);
  const wifi = wifiAt(obs.pos, movers);
  const mag = magAt(obs.pos, t);
  const sonarM = rayRange(obs.pos, obs.heading);

  const brightness = vision?.brightness ?? 78 + 18 * Math.sin(t * 0.05);
  const texture = vision?.texture ?? 0.22 + 0.04 * Math.sin(t * 0.2);
  const noise = vision?.noise ?? 12 + 3 * Math.random();
  const autoEnv = classifyEnv(brightness, texture, noise, wifi);
  const env = envManual === "auto" ? autoEnv : envManual;

  const imu: ImuSample = {
    ax: 0.02 * Math.sin(t * 1.7),
    ay: 9.81 + 0.01 * Math.sin(t * 2.1),
    az: 0.015 * Math.cos(t * 1.3),
    gx: 0.4 * Math.sin(t * 0.8),
    gy: 0.2 * Math.cos(t * 0.5),
    gz: 1.2 * Math.sin(t * 0.11),
    heading: (obs.heading * 180) / Math.PI,
    source: "twin",
  };

  const geo: GeoSample = {
    lat: 31.2304 + 0.00002 * Math.sin(t * 0.02),
    lng: 121.4737 + 0.00002 * Math.cos(t * 0.02),
    accuracy: 3.4,
    source: "twin",
  };

  return {
    t,
    people,
    objects: OBJECTS,
    wifi,
    mag,
    imu,
    geo,
    sonarM,
    brightness,
    texture,
    noise,
    env,
  };
}

export function sampleMapPoints(twin: TwinState, density: number, existing: number, dets: Detection[] = []): MapPoint[] {
  if (existing > 18000) return [];
  const out: MapPoint[] = [];
  const n = Math.round(4 * density);
  for (const p of twin.people) {
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const h = Math.random() * p.heightM;
      const r = 0.22 * (0.5 + 0.5 * Math.sin(h * Math.PI));
      out.push({
        x: p.pos.x + Math.cos(ang) * r,
        y: h,
        z: p.pos.z + Math.sin(ang) * r,
        kind: "person",
        t: twin.t,
      });
    }
  }
  for (const d of dets) {
    if (Math.random() > 0.7) continue;
    out.push({
      x: d.world.x + (Math.random() - 0.5) * 0.12,
      y: Math.max(0, d.world.y),
      z: d.world.z + (Math.random() - 0.5) * 0.12,
      kind: d.kind === "person" ? "person" : "object",
      t: twin.t,
    });
  }
  for (const obj of twin.objects) {
    if (Math.random() > 0.45 * density) continue;
    out.push({
      x: obj.pos.x + (Math.random() - 0.5) * obj.size.x,
      y: Math.random() * obj.size.y,
      z: obj.pos.z + (Math.random() - 0.5) * obj.size.z,
      kind: "object",
      t: twin.t,
    });
  }
  const obs = observerPose(twin.t);
  out.push({ x: obs.pos.x, y: 0.05, z: obs.pos.z, kind: "traj", t: twin.t });
  const hd = obs.heading;
  const d = twin.sonarM;
  out.push({
    x: obs.pos.x + Math.sin(hd) * d,
    y: 1.1,
    z: obs.pos.z + Math.cos(hd) * d,
    kind: "sonar",
    t: twin.t,
  });
  if (Math.random() < 0.4) {
    out.push({
      x: WALL_X + (Math.random() - 0.5) * 0.06,
      y: Math.random() * ROOM.h,
      z: (Math.random() - 0.5) * ROOM.d,
      kind: "wall",
      t: twin.t,
    });
  }
  if (Math.random() < 0.25) {
    out.push({
      x: obs.pos.x + (Math.random() - 0.5) * 1.4,
      y: 0.02,
      z: obs.pos.z - Math.random() * 2.2,
      kind: "free",
      t: twin.t,
    });
  }
  return out;
}

export function densify(points: MapPoint[], cap = 22000): MapPoint[] {
  const extra: MapPoint[] = [];
  for (let i = 0; i < points.length - 1 && extra.length < 2400; i += 3) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b || a.kind !== b.kind) continue;
    const d = dist3(a, b);
    if (d > 0.25 && d < 1.8) {
      extra.push({
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        z: (a.z + b.z) / 2,
        kind: a.kind,
        t: performance.now() / 1000,
      });
    }
  }
  const next = points.concat(extra);
  return next.length > cap ? next.slice(next.length - cap) : next;
}

export function sonarEchoTrace(distM: number): number[] {
  const n = 96;
  const peakAt = clamp((distM / 8) * n, 2, n - 3);
  const trace: number[] = [];
  for (let i = 0; i < n; i++) {
    const main = Math.exp(-((i - peakAt) ** 2) / 3.2);
    const multi = 0.28 * Math.exp(-((i - peakAt * 1.7) ** 2) / 8);
    const noise = 0.04 * Math.random();
    trace.push(clamp(main + multi + noise, 0, 1));
  }
  return trace;
}

export function pingFromDistance(distM: number, source: SampleSource) {
  const dt = (2 * distM) / SOUND_MPS;
  return {
    distM,
    dtUs: dt * 1e6,
    lagSamples: Math.round(dt * 48000),
    peak: 0.72 + Math.random() * 0.2,
    source,
    trace: sonarEchoTrace(distM),
  };
}

export function envWeights(env: EnvMode): FusionWeights {
  return {
    indoor: { vision: 0.3, sonar: 0.3, mag: 0.2, wifi: 0.1, depth: 0.1 },
    outdoor: { vision: 0.45, sonar: 0.1, mag: 0.1, wifi: 0.05, depth: 0.3 },
    lowlight: { vision: 0.2, sonar: 0.35, mag: 0.15, wifi: 0.15, depth: 0.15 },
    bright: { vision: 0.4, sonar: 0.15, mag: 0.1, wifi: 0.1, depth: 0.25 },
    through: { vision: 0.1, sonar: 0.2, mag: 0.3, wifi: 0.3, depth: 0.1 },
    noisy: { vision: 0.25, sonar: 0.15, mag: 0.2, wifi: 0.2, depth: 0.2 },
    clutter: { vision: 0.4, sonar: 0.25, mag: 0.1, wifi: 0.1, depth: 0.15 },
  }[env];
}

export function blend(device: number | null, twin: number, preferDevice: boolean) {
  if (device === null || !preferDevice) return twin;
  return lerp(twin, device, 0.85);
}

export { OBJECTS };
