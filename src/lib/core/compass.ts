import { DEG, wrap360 } from "./math.ts";

/**
 * Compass heading (degrees clockwise from north) of the direction the *back*
 * of the device points at, from W3C DeviceOrientation Euler angles (degrees).
 * Valid for any tilt except when the back faces straight up/down.
 */
export function compassHeading(alpha: number, beta: number, gamma: number): number {
  const z = alpha * DEG;
  const x = beta * DEG;
  const y = gamma * DEG;
  const cZ = Math.cos(z);
  const cY = Math.cos(y);
  const cX = Math.cos(x);
  const sZ = Math.sin(z);
  const sY = Math.sin(y);
  const sX = Math.sin(x);
  void cX;
  const vx = -cZ * sY - sZ * sX * cY;
  const vy = -sZ * sY + cZ * sX * cY;
  return wrap360(Math.atan2(vx, vy) / DEG);
}

/** Elevation (degrees above the horizon) of the back-camera axis. */
export function cameraPitchDeg(beta: number, gamma: number): number {
  const b = beta * DEG;
  const g = gamma * DEG;
  // The back vector's vertical component is -cosβ·cosγ… negated for "up".
  const up = -(Math.cos(b) * Math.cos(g));
  return Math.asin(Math.max(-1, Math.min(1, up))) / DEG;
}
