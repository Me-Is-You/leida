export interface SchedInput {
  /** Global inter-frame difference 0‥1. */
  motion: number;
  /** Number of moving blobs from the motion detector. */
  moving: number;
  /** Camera itself moving / exposure jump. */
  ego: boolean;
  /** Confirmed tracks currently alive. */
  tracks: number;
}

export interface SchedDecision {
  runNN: boolean;
  /** Delay until the next frame analysis, ms. */
  delayMs: number;
  mode: "active" | "watch" | "idle";
}

/**
 * Adaptive inference scheduler. The neural detector is by far the most
 * expensive node (tens of ms of GPU/CPU per frame); when nothing changes in
 * the scene it is wasted battery. The scheduler runs it back-to-back while the
 * scene is active (motion, camera movement, moving blobs) and relaxes to a
 * ~1 Hz keep-alive when static, ~0.4 Hz after a long quiet spell. Cheap frame
 * statistics keep running so any change wakes it within one frame.
 */
export class DetectScheduler {
  private motionEma = 0;
  private lastNnAt = -1e9;
  private quietSince = 0;
  private quiet = false;
  nnRuns = 0;
  nnSkipped = 0;
  /** Set true on low battery without charger: stretches all intervals. */
  saver = false;

  activeEma = 0.012;
  watchGapMs = 900;
  quietGapMs = 1200;
  idleGapMs = 2500;
  idleAfterMs = 6000;

  decide(now: number, m: SchedInput): SchedDecision {
    this.motionEma = this.motionEma * 0.6 + m.motion * 0.4;
    const active = m.ego || m.moving > 0 || this.motionEma > this.activeEma;
    if (active) this.quiet = false;
    else if (!this.quiet) {
      this.quiet = true;
      this.quietSince = now;
    }
    const k = this.saver ? 1.6 : 1;
    let gap = 0;
    let mode: SchedDecision["mode"] = "active";
    if (!active) {
      if (m.tracks > 0) {
        gap = this.watchGapMs;
        mode = "watch";
      } else {
        mode = now - this.quietSince > this.idleAfterMs ? "idle" : "watch";
        gap = mode === "idle" ? this.idleGapMs : this.quietGapMs;
      }
    } else if (this.saver) gap = 120;
    const runNN = now - this.lastNnAt >= gap * k;
    if (!runNN) this.nnSkipped++;
    return { runNN, mode, delayMs: (active ? 0 : 250) * k };
  }

  noteNn(now: number) {
    this.lastNnAt = now;
    this.nnRuns++;
  }

  /** Share of analysed frames for which inference was skipped. */
  get savedFraction() {
    const n = this.nnRuns + this.nnSkipped;
    return n ? this.nnSkipped / n : 0;
  }

  reset() {
    this.lastNnAt = -1e9;
    this.motionEma = 0;
    this.quiet = false;
  }
}
