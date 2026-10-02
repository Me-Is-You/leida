import { type Infer, arr, issueText, num, obj, oneOf, opt, str } from "./schema.ts";

const KINDS = ["person", "object", "wall", "free", "traj", "sonar"] as const;
const kind = oneOf(KINDS);

const pointV2 = obj({ kind, x: num(), y: num(), z: num(), t: opt(num()) });
const trajPoint = obj({ x: num(), y: opt(num()), z: num() });

export const SessionV2 = obj({
  format: oneOf(["aether-session"] as const),
  version: oneOf([2] as const),
  app: opt(str({ max: 40 })),
  createdAt: opt(str({ max: 40 })),
  /** Only real measurements are ever exported. "demo" exists solely so old simulator files can be recognised and refused. */
  dataMode: opt(oneOf(["demo", "real"] as const)),
  points: arr(pointV2, { max: 60000 }),
  trajectory: arr(trajPoint, { max: 20000, def: [] }),
  stats: opt(obj({ steps: opt(num({ int: true, min: 0 })), distanceM: opt(num()), exploredM2: opt(num()) })),
});

export type SessionData = Infer<typeof SessionV2>;

/** v1 (v18.0 export): { version: "18.0", points: MapPoint[], trajectory } with unvalidated content. */
const LegacyV1 = obj({
  version: str(),
  points: arr(obj({ x: num(), y: num(), z: num(), kind: str(), t: opt(num()) }), { max: 60000 }),
  trajectory: opt(arr(trajPoint, { max: 20000 })),
});

export type ParseResult = { ok: true; data: SessionData } | { ok: false; error: string };

const SIMULATED = "这个文件由旧版演示模拟器生成（不是真实测量），已拒绝导入。";

export function parseSession(raw: unknown): ParseResult {
  const v2 = SessionV2.parse(raw);
  if (v2.ok) {
    if (v2.value.dataMode === "demo") return { ok: false, error: SIMULATED };
    return { ok: true, data: v2.value as SessionData };
  }
  // v18 exports ({version:"18.0", points}) were produced by the simulator unless proven otherwise
  if (LegacyV1.parse(raw).ok) return { ok: false, error: SIMULATED };
  return { ok: false, error: v2.path.length || v2.message ? issueText(v2) : "格式无法识别" };
}
