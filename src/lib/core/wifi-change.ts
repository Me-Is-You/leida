/**
 * Wi-Fi link disturbance detector.
 *
 * What it can and cannot say: RSSI of a link (or of the surrounding APs) moves
 * when something absorbs, reflects or blocks the radio path — a person walking
 * through the room, a door closing, the phone being turned. A change detector
 * with a learned baseline can report "the radio environment is being disturbed".
 * It cannot say *what* disturbs it or whether anything stands behind a wall.
 *
 * Per tracked link we keep a short window (fast mean / σ) and a slow baseline
 * (mean / σ, adapted only while the link is quiet). A link is disturbed when the
 * fast mean departs from the baseline by more than 2.5 baseline-σ (floored at
 * 1.5 dB, the quantisation noise of phone RSSI) or the fast σ exceeds 2.2× the
 * baseline σ. Hysteresis: enter after 2 hits, leave after 5 clear evaluations.
 * A link that stays disturbed but steady (the phone moved to another room)
 * re-learns its baseline after 30 steady samples.
 */

const SD_FLOOR = 1.5;
const WINDOW = 12;
const WARMUP = 10;

class RssiTrack {
  private win: number[] = [];
  private baseMean = 0;
  private baseVar = 0;
  private nBase = 0;
  private hits = 0;
  private clears = 0;
  private steady = 0;
  disturbed = false;
  z = 0;
  sigma = 0;
  mean = NaN;
  lastSeen = 0;

  /** Feed one RSSI sample (dBm). */
  push(rssi: number, now: number) {
    this.lastSeen = now;
    this.win.push(rssi);
    if (this.win.length > WINDOW) this.win.shift();
    const n = this.win.length;
    let s = 0;
    for (const v of this.win) s += v;
    this.mean = s / n;
    let q = 0;
    for (const v of this.win) q += (v - this.mean) ** 2;
    this.sigma = n > 1 ? Math.sqrt(q / (n - 1)) : 0;

    if (this.nBase < WARMUP) {
      // learn the baseline from the first samples
      this.nBase++;
      const d = rssi - this.baseMean;
      this.baseMean += d / this.nBase;
      this.baseVar += (d * (rssi - this.baseMean) - this.baseVar) / this.nBase;
      this.z = 0;
      return;
    }
    const sd = Math.max(SD_FLOOR, Math.sqrt(Math.max(0, this.baseVar)));
    this.z = (this.mean - this.baseMean) / sd;
    const hit = Math.abs(this.z) > 2.5 || (n >= 6 && this.sigma > 2.2 * sd);
    if (hit) {
      this.hits++;
      this.clears = 0;
      if (this.hits >= 2) this.disturbed = true;
    } else {
      this.clears++;
      this.hits = 0;
      if (this.clears >= 5) this.disturbed = false;
    }
    if (!this.disturbed) {
      // adapt the baseline only while quiet, and only with samples that agree with it: the first samples of a
      // developing disturbance must not drag the baseline (and inflate its σ) along with them
      const d = rssi - this.baseMean;
      if (this.hits === 0 && Math.abs(d) < 3 * sd) {
        const a = 0.03;
        this.baseMean += a * d;
        this.baseVar += a * (d * d - this.baseVar);
      }
      this.steady = 0;
    } else if (n >= 8 && this.sigma < 1.2 * sd) {
      // disturbed but steady: the environment itself changed (moved room) → re-learn
      if (++this.steady >= 30) {
        this.baseMean = this.mean;
        this.baseVar = this.sigma * this.sigma;
        this.disturbed = false;
        this.steady = 0;
        this.hits = 0;
      }
    } else this.steady = 0;
  }

  get ready() {
    return this.nBase >= WARMUP;
  }
}

export interface WifiScanEntry {
  bssid: string;
  rssi: number;
}

export interface WifiState {
  /** Current link RSSI (dBm) or NaN. */
  rssi: number;
  /** Short-window σ of the link RSSI (dB), NaN until two samples exist. */
  sigma: number;
  /** Link or ≥40 % of ≥3 surrounding APs disturbed. */
  disturbed: boolean;
  /** Share of tracked APs currently disturbed (0‥1), null with fewer than 3 ready APs. */
  apDisturbedShare: number | null;
  /** How many APs are being tracked (ready ones). */
  apsTracked: number;
  /** True once the baseline has been learned (≥10 samples of the link). */
  baselineReady: boolean;
}

export class WifiMonitor {
  private link = new RssiTrack();
  private linkBssid = "";
  private aps = new Map<string, RssiTrack>();

  reset() {
    this.link = new RssiTrack();
    this.linkBssid = "";
    this.aps.clear();
  }

  /** Link RSSI sample (about 1 Hz). A different BSSID (roaming) restarts the link baseline. */
  pushLink(bssid: string, rssi: number, now: number) {
    if (!Number.isFinite(rssi) || rssi > 0 || rssi < -127) return;
    if (bssid !== this.linkBssid) {
      this.link = new RssiTrack();
      this.linkBssid = bssid;
    }
    this.link.push(rssi, now);
  }

  /** One full scan (about every 5 s). The 10 strongest APs are tracked; stale ones are dropped after 2 min. */
  pushScan(entries: WifiScanEntry[], now: number) {
    const top = entries
      .filter((e) => Number.isFinite(e.rssi) && e.rssi <= 0 && e.rssi >= -127 && e.bssid)
      .sort((a, b) => b.rssi - a.rssi)
      .slice(0, 10);
    for (const e of top) {
      let t = this.aps.get(e.bssid);
      if (!t) {
        t = new RssiTrack();
        this.aps.set(e.bssid, t);
      }
      t.push(e.rssi, now);
    }
    for (const [k, t] of this.aps) if (now - t.lastSeen > 120_000) this.aps.delete(k);
  }

  state(): WifiState {
    const ready = [...this.aps.values()].filter((t) => t.ready);
    const share = ready.length >= 3 ? ready.filter((t) => t.disturbed).length / ready.length : null;
    return {
      rssi: this.link.mean,
      sigma: this.link.mean === this.link.mean ? this.link.sigma : NaN,
      disturbed: this.link.disturbed || (share !== null && share >= 0.4),
      apDisturbedShare: share,
      apsTracked: ready.length,
      baselineReady: this.link.ready,
    };
  }
}
