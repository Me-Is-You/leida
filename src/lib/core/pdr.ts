/**
 * Pedestrian dead reckoning: step detection from the accelerometer magnitude
 * and 2-D position integration with the compass heading.
 */
export class StepDetector {
  private g = 9.81;
  private s = 0;
  private p1 = 0;
  private p2 = 0;
  private t1 = 0;
  private lastStepT = -Infinity;
  private amp = 1.2;
  private inited = false;

  private readonly opts: { minIntervalS: number; baseThreshold: number };

  constructor(opts: { minIntervalS: number; baseThreshold: number } = { minIntervalS: 0.28, baseThreshold: 0.9 }) {
    this.opts = opts;
  }

  /** Feed one accelerometer sample (m/s², incl. gravity). Returns true when a step completes. */
  push(tSec: number, ax: number, ay: number, az: number): boolean {
    const m = Math.hypot(ax, ay, az);
    if (!this.inited) {
      this.g = m;
      this.inited = true;
    }
    this.g += 0.02 * (m - this.g);
    const d = m - this.g;
    const prevS = this.s;
    this.s += 0.35 * (d - this.s);
    // peak on the previous smoothed sample
    const isPeak = this.p1 > this.p2 && this.p1 >= prevS && this.p1 > this.s;
    let step = false;
    if (isPeak) {
      const thr = Math.max(this.opts.baseThreshold, this.amp * 0.45);
      const since = this.t1 - this.lastStepT;
      if (this.p1 > thr && since >= this.opts.minIntervalS) {
        step = true;
        this.lastStepT = this.t1;
        this.amp += 0.3 * (this.p1 - this.amp);
      }
    }
    if (tSec - this.lastStepT > 6) this.amp = 1.2;
    this.p2 = this.p1;
    this.p1 = this.s;
    this.t1 = tSec;
    return step;
  }

  reset() {
    this.s = 0;
    this.p1 = 0;
    this.p2 = 0;
    this.lastStepT = -Infinity;
    this.inited = false;
    this.amp = 1.2;
  }
}

export interface PdrState {
  x: number;
  z: number;
  steps: number;
  distance: number;
}

export class PdrTracker {
  readonly state: PdrState;
  stepLength: number;
  constructor(origin: { x: number; z: number } = { x: 0, z: 0 }, stepLength = 0.68) {
    this.stepLength = stepLength;
    this.state = { x: origin.x, z: origin.z, steps: 0, distance: 0 };
  }

  /** Advance one step along compass heading `headingDeg` (clockwise from north → +z). */
  step(headingDeg: number) {
    const h = (headingDeg * Math.PI) / 180;
    this.state.x += Math.sin(h) * this.stepLength;
    this.state.z += Math.cos(h) * this.stepLength;
    this.state.steps += 1;
    this.state.distance += this.stepLength;
  }

  reset(origin: { x: number; z: number } = { x: 0, z: 0 }) {
    this.state.x = origin.x;
    this.state.z = origin.z;
    this.state.steps = 0;
    this.state.distance = 0;
  }
}

/** Typical walking step length from body height (m). */
export function stepLengthFromHeight(heightM: number): number {
  return 0.415 * heightM;
}
