import { type Mat4, invert, lookAt, mat4, multiply, perspective } from "./mat4.ts";

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export interface OrbitLimits {
  minDist: number;
  maxDist: number;
  minElev: number;
  maxElev: number;
}

/**
 * Orbit camera with exponential smoothing toward goals. Inputs only touch the
 * goals; `update(dt)` moves the real state, so gestures feel damped without
 * velocity bookkeeping and the camera settles exactly (no drift).
 * Elevation is measured from the ground plane (π/2 = straight down).
 */
export class OrbitCamera {
  yaw = 0.58;
  elev = 0.54;
  dist = 20;
  tx = 0;
  ty = 0.4;
  tz = 0;
  gYaw = 0.58;
  gElev = 0.54;
  gDist = 20;
  gtx = 0;
  gtz = 0;
  fov = (40 * Math.PI) / 180;
  near = 0.1;
  far = 220;
  limits: OrbitLimits = { minDist: 2.5, maxDist: 45, minElev: 0.06, maxElev: Math.PI / 2 - 0.02 };
  private readonly view = mat4();
  private readonly proj = mat4();
  private readonly vp = mat4();
  private readonly inv = mat4();

  /** Snap (no smoothing) — used on first frame and preset changes when `animate` is false. */
  set(yaw: number, elev: number, dist: number, tx: number, tz: number, animate = true) {
    this.gYaw = yaw;
    this.gElev = clamp(elev, this.limits.minElev, this.limits.maxElev);
    this.gDist = clamp(dist, this.limits.minDist, this.limits.maxDist);
    this.gtx = tx;
    this.gtz = tz;
    if (!animate) {
      this.yaw = this.gYaw;
      this.elev = this.gElev;
      this.dist = this.gDist;
      this.tx = tx;
      this.tz = tz;
    }
  }

  rotate(dYaw: number, dElev: number) {
    this.gYaw += dYaw;
    this.gElev = clamp(this.gElev + dElev, this.limits.minElev, this.limits.maxElev);
  }

  zoom(factor: number) {
    this.gDist = clamp(this.gDist * factor, this.limits.minDist, this.limits.maxDist);
  }

  /** Pan on the ground plane by a screen-space drag (pixels). */
  pan(dxPx: number, dyPx: number, viewportH: number) {
    const k = (2 * this.gDist * Math.tan(this.fov / 2)) / Math.max(1, viewportH);
    const sx = Math.cos(this.gYaw);
    const sz = -Math.sin(this.gYaw); // camera right vector on the ground
    const fx = -Math.sin(this.gYaw); // camera forward on the ground
    const fz = -Math.cos(this.gYaw);
    this.gtx += (-dxPx * sx + dyPx * fx) * k;
    this.gtz += (-dxPx * sz + dyPx * fz) * k;
  }

  /** Advance smoothing. Returns true while still moving. */
  update(dt: number): boolean {
    const a = 1 - Math.exp(-Math.min(dt, 0.1) * 12);
    this.yaw += (this.gYaw - this.yaw) * a;
    this.elev += (this.gElev - this.elev) * a;
    this.dist += (this.gDist - this.dist) * a;
    this.tx += (this.gtx - this.tx) * a;
    this.tz += (this.gtz - this.tz) * a;
    const moving =
      Math.abs(this.gYaw - this.yaw) > 1e-4 ||
      Math.abs(this.gElev - this.elev) > 1e-4 ||
      Math.abs(this.gDist - this.dist) > 1e-3 ||
      Math.abs(this.gtx - this.tx) > 1e-4 ||
      Math.abs(this.gtz - this.tz) > 1e-4;
    if (!moving) {
      this.yaw = this.gYaw;
      this.elev = this.gElev;
      this.dist = this.gDist;
      this.tx = this.gtx;
      this.tz = this.gtz;
    }
    return moving;
  }

  eye(out: [number, number, number] = [0, 0, 0]): [number, number, number] {
    const ce = Math.cos(this.elev);
    out[0] = this.tx + this.dist * ce * Math.sin(this.yaw);
    out[1] = this.ty + this.dist * Math.sin(this.elev);
    out[2] = this.tz + this.dist * ce * Math.cos(this.yaw);
    return out;
  }

  viewProj(aspect: number): Mat4 {
    const e = this.eye();
    lookAt(this.view, e[0], e[1], e[2], this.tx, this.ty, this.tz);
    perspective(this.proj, this.fov, aspect, this.near, this.far);
    return multiply(this.vp, this.proj, this.view);
  }

  /** World-space ray through NDC (x, y ∈ [−1, 1]). */
  pickRay(ndcX: number, ndcY: number, aspect: number): { o: [number, number, number]; d: [number, number, number] } | null {
    const vp = this.viewProj(aspect);
    if (!invert(this.inv, vp)) return null;
    const m = this.inv;
    const un = (z: number): [number, number, number] => {
      const x = (m[0] as number) * ndcX + (m[4] as number) * ndcY + (m[8] as number) * z + (m[12] as number);
      const y = (m[1] as number) * ndcX + (m[5] as number) * ndcY + (m[9] as number) * z + (m[13] as number);
      const zz = (m[2] as number) * ndcX + (m[6] as number) * ndcY + (m[10] as number) * z + (m[14] as number);
      const w = (m[3] as number) * ndcX + (m[7] as number) * ndcY + (m[11] as number) * z + (m[15] as number);
      return [x / w, y / w, zz / w];
    };
    const a = un(-1);
    const b = un(1);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    return { o: this.eye(), d: [dx / l, dy / l, dz / l] };
  }
}
