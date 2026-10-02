import { DEG } from "./math.ts";

/**
 * Monocular geometry. A phone camera has no depth sensor, so range is
 * *estimated* from the apparent size of objects with a known real-world size.
 * Every value produced here is therefore an estimate with a stated basis.
 */

/** Typical real-world heights (m) of COCO classes — rough priors, ±25 %. */
export const CLASS_HEIGHT_M: Record<string, number> = {
  person: 1.7,
  bicycle: 1.0,
  car: 1.5,
  motorcycle: 1.1,
  bus: 3.0,
  truck: 3.0,
  bird: 0.2,
  cat: 0.28,
  dog: 0.5,
  horse: 1.6,
  chair: 0.9,
  couch: 0.85,
  bed: 0.55,
  "dining table": 0.75,
  "potted plant": 0.5,
  tv: 0.5,
  laptop: 0.25,
  mouse: 0.04,
  remote: 0.04,
  keyboard: 0.03,
  "cell phone": 0.15,
  microwave: 0.3,
  oven: 0.6,
  refrigerator: 1.7,
  sink: 0.25,
  book: 0.22,
  clock: 0.3,
  vase: 0.3,
  bottle: 0.24,
  cup: 0.1,
  bowl: 0.08,
  backpack: 0.45,
  umbrella: 0.9,
  suitcase: 0.65,
  "traffic light": 0.9,
  "stop sign": 0.75,
  "fire hydrant": 0.6,
  bench: 0.85,
};

export interface CameraModel {
  /** Horizontal field of view in degrees for the *frame as displayed*. */
  hfovDeg: number;
  /** Frame aspect ratio w / h. */
  aspect: number;
}

export function vfovDeg(cam: CameraModel): number {
  const th = Math.tan((cam.hfovDeg * DEG) / 2);
  return (2 * Math.atan(th / cam.aspect)) / DEG;
}

export interface DepthEstimate {
  depthM: number;
  /** 1σ in metres. */
  sigmaM: number;
  basis: "height-prior" | "width-prior" | "area-fallback";
  truncated: boolean;
}

export interface BoxNorm {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Depth along the optical axis from the pinhole model: d = H / (2·tan(vfov/2)·h_norm). */
export function estimateDepth(cls: string, box: BoxNorm, cam: CameraModel): DepthEstimate {
  const H = CLASS_HEIGHT_M[cls];
  const tv = Math.tan((vfovDeg(cam) * DEG) / 2);
  const th = Math.tan((cam.hfovDeg * DEG) / 2);
  const eps = 0.01;
  const truncated = box.y <= eps || box.y + box.h >= 1 - eps || box.x <= eps || box.x + box.w >= 1 - eps;
  const clampD = (d: number) => Math.max(0.3, Math.min(15, d));
  if (H) {
    // Use the larger relative dimension: a lying/sitting object is wider than tall.
    const dh = H / (2 * tv * Math.max(box.h, 1e-3));
    let d = dh;
    let basis: DepthEstimate["basis"] = "height-prior";
    // A very wide, short box suggests the object is seen laterally: fall back to width ≈ 1.3·H
    if (box.w / cam.aspect > box.h * 1.6 && cls !== "person") {
      d = (1.3 * H) / (2 * th * Math.max(box.w, 1e-3));
      basis = "width-prior";
    }
    d = clampD(d);
    // Truncated boxes under-estimate size → depth is a lower bound; widen σ.
    const rel = truncated ? 0.45 : 0.25;
    return { depthM: d, sigmaM: d * rel, basis, truncated };
  }
  const area = Math.max(box.w * box.h, 1e-4);
  const d = clampD(0.35 / Math.sqrt(area));
  return { depthM: d, sigmaM: d * 0.6, basis: "area-fallback", truncated };
}

export interface Pose {
  x: number;
  z: number;
  /** Compass heading of the camera axis, degrees clockwise from +z. */
  headingDeg: number;
  /** Camera elevation above the horizon (deg, +up). */
  pitchDeg: number;
  /** Camera height above the floor (m). */
  heightM: number;
}

/** Project a normalised image point at optical-axis depth `d` into world coordinates (x east, y up, z north). */
export function projectToWorld(u: number, v: number, d: number, cam: CameraModel, pose: Pose) {
  const th = Math.tan((cam.hfovDeg * DEG) / 2);
  const tv = Math.tan((vfovDeg(cam) * DEG) / 2);
  const X = (u - 0.5) * 2 * th * d;
  const Y = -(v - 0.5) * 2 * tv * d;
  const p = pose.pitchDeg * DEG;
  const h = pose.headingDeg * DEG;
  const horizontal = d * Math.cos(p) - Y * Math.sin(p);
  const vertical = d * Math.sin(p) + Y * Math.cos(p);
  return {
    x: pose.x + horizontal * Math.sin(h) + X * Math.cos(h),
    y: pose.heightM + vertical,
    z: pose.z + horizontal * Math.cos(h) - X * Math.sin(h),
  };
}

/** Bearing (deg, relative to camera heading, +right) of normalised x. */
export function bearingOf(u: number, cam: CameraModel): number {
  const th = Math.tan((cam.hfovDeg * DEG) / 2);
  return Math.atan((u - 0.5) * 2 * th) / DEG;
}
