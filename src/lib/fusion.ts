import { ROOM } from "./engine";
import type { Alert, FusionWeights, MapPoint, MapPointKind, OccupancyCell, SarState } from "./types";
import { dist3 } from "./utils";

const SOUND_HZ = 20000;
const SOUND_MPS = 343;

export function occupancyGrid(points: MapPoint[], cell = 0.35): OccupancyCell[] {
  const map = new Map<string, OccupancyCell>();
  for (const p of points) {
    const ix = Math.round(p.x / cell);
    const iz = Math.round(p.z / cell);
    const k = `${ix}:${iz}`;
    const cur = map.get(k);
    if (cur) {
      cur.n += 1;
      cur.y += p.y;
    } else {
      map.set(k, { x: ix * cell, z: iz * cell, y: p.y, n: 1 });
    }
  }
  const out: OccupancyCell[] = [];
  for (const c of map.values()) {
    if (c.n < 2) continue;
    out.push({ ...c, y: c.y / c.n });
  }
  return out;
}

export function trajLength(tr: { x: number; z: number }[]): number {
  let s = 0;
  for (let i = 1; i < tr.length; i++) {
    const a = tr[i - 1];
    const b = tr[i];
    if (!a || !b) continue;
    s += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return s;
}

export function coverageRatio(points: MapPoint[], cell = 0.35): number {
  if (!points.length) return 0;
  const seen = new Set<string>();
  for (const p of points) seen.add(`${Math.round(p.x / cell)}:${Math.round(p.z / cell)}`);
  const total = Math.max(1, Math.round(ROOM.w / cell) * Math.round(ROOM.d / cell));
  return Math.min(1, seen.size / total);
}

export function computeSar(L: number, R: number): SarState {
  const lambda = SOUND_MPS / SOUND_HZ;
  const aperture = Math.max(L, 0.05);
  const delta = (lambda * Math.max(R, 0.2)) / (2 * aperture);
  return { L: aperture, R, delta, lambda };
}

export function filterPoints(points: MapPoint[], kind: Record<MapPointKind, boolean>): MapPoint[] {
  return points.filter((p) => kind[p.kind] !== false);
}

export function nearestMetal(
  observer: { x: number; y: number; z: number },
  objects: { name: string; metal: boolean; pos: { x: number; y: number; z: number } }[],
) {
  let best: { name: string; dist: number } | null = null;
  for (const o of objects) {
    if (!o.metal) continue;
    const d = dist3(observer, o.pos);
    if (!best || d < best.dist) best = { name: o.name, dist: d };
  }
  return best;
}

export function maybeAlerts(input: {
  t: number;
  throughWall: boolean;
  magAnomaly: boolean;
  sonarM: number;
  personCount: number;
  prevPerson: number;
  brightness: number;
}): Alert[] {
  const out: Alert[] = [];
  const id = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  if (input.throughWall) {
    out.push({
      id: id(),
      t: input.t,
      tone: "warn",
      title: "穿墙扰动",
      body: "RSSI 方差升高，链路可能穿越障碍或有人体遮挡。",
    });
  }
  if (input.magAnomaly) {
    out.push({
      id: id(),
      t: input.t,
      tone: "warn",
      title: "磁场异常",
      body: "近场磁矩偏离背景，疑似金属体接近。",
    });
  }
  if (input.sonarM < 0.45) {
    out.push({
      id: id(),
      t: input.t,
      tone: "live",
      title: "近距回波",
      body: `声呐 ${input.sonarM.toFixed(2)} m，前方障碍接近。`,
    });
  }
  if (input.personCount > input.prevPerson) {
    out.push({
      id: id(),
      t: input.t,
      tone: "real",
      title: "新增目标",
      body: `现场人物 ${input.prevPerson} → ${input.personCount}`,
    });
  }
  if (input.brightness < 28) {
    out.push({
      id: id(),
      t: input.t,
      tone: "warn",
      title: "暗光",
      body: "场景亮度偏低，建议开启夜视或手电。",
    });
  }
  return out;
}

export function normalizeWeights(w: FusionWeights): FusionWeights {
  const s = w.vision + w.sonar + w.mag + w.wifi + w.depth || 1;
  return {
    vision: w.vision / s,
    sonar: w.sonar / s,
    mag: w.mag / s,
    wifi: w.wifi / s,
    depth: w.depth / s,
  };
}
