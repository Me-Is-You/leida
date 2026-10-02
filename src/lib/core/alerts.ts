export interface AlertEvent {
  key: string;
  tone: "warn" | "live" | "real";
  title: string;
  body: string;
}

export interface AlertInput {
  /** Wi-Fi link disturbance reported by the bridge-fed change detector. */
  linkDisturbed?: boolean;
  magAnomaly?: boolean;
  magDeltaUt?: number;
  sonarM?: number | null;
  personCount?: number;
  brightness?: number | null;
}

/**
 * Edge-triggered alerts: a condition fires once when it becomes true, then
 * is silent until it has been false for `rearmMs` *and* the per-key cooldown
 * has passed. Avoids the 4-second nag loop of a level-triggered alarm.
 */
export class AlertEngine {
  private readonly state = new Map<string, { active: boolean; lastFire: number; clearSince: number | null }>();
  private prevPersons = 0;
  private readonly cooldownMs: number;
  private readonly rearmMs: number;

  constructor(cooldownMs = 8000, rearmMs = 1500) {
    this.cooldownMs = cooldownMs;
    this.rearmMs = rearmMs;
  }

  private edge(key: string, cond: boolean, now: number): boolean {
    const s = this.state.get(key) ?? { active: false, lastFire: -Infinity, clearSince: null };
    this.state.set(key, s);
    if (cond) {
      s.clearSince = null;
      if (!s.active) {
        s.active = true;
        if (now - s.lastFire >= this.cooldownMs) {
          s.lastFire = now;
          return true;
        }
      }
      return false;
    }
    if (s.active) {
      if (s.clearSince === null) s.clearSince = now;
      if (now - s.clearSince >= this.rearmMs) {
        s.active = false;
        s.clearSince = null;
      }
    }
    return false;
  }

  update(now: number, i: AlertInput): AlertEvent[] {
    const out: AlertEvent[] = [];
    if (this.edge("through", !!i.linkDisturbed, now)) {
      out.push({
        key: "through",
        tone: "warn",
        title: "链路扰动",
        body: "Wi-Fi RSSI 偏离了学到的基线：周围无线环境正被扰动（有人走动、门开合或手机被遮挡）。这不能说明墙后有人。",
      });
    }
    if (this.edge("mag", !!i.magAnomaly, now)) {
      const d = i.magDeltaUt !== undefined ? `（Δ ${i.magDeltaUt.toFixed(1)} μT）` : "";
      out.push({ key: "mag", tone: "warn", title: "磁场异常", body: `磁场偏离背景${d}，疑似铁磁物体靠近。` });
    }
    if (this.edge("near", i.sonarM != null && i.sonarM < 0.45, now)) {
      out.push({ key: "near", tone: "live", title: "近距回波", body: `声呐 ${(i.sonarM as number).toFixed(2)} m，前方障碍接近。` });
    }
    if (i.personCount !== undefined) {
      if (i.personCount > this.prevPersons) {
        out.push({ key: "person", tone: "real", title: "新增目标", body: `人物 ${this.prevPersons} → ${i.personCount}` });
      }
      this.prevPersons = i.personCount;
    }
    if (this.edge("dark", i.brightness != null && i.brightness < 28, now)) {
      out.push({ key: "dark", tone: "warn", title: "暗光", body: "画面亮度偏低，视觉检测会变差；可开启手电。" });
    }
    return out;
  }

  reset() {
    this.state.clear();
    this.prevPersons = 0;
  }
}
