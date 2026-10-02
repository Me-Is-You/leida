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
  dataMode: oneOf(["demo", "real"] as const),
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

export type ParseResult = { ok: true; data: SessionData; legacy: boolean } | { ok: false; error: string };

export function parseSession(raw: unknown): ParseResult {
  const v2 = SessionV2.parse(raw);
  if (v2.ok) return { ok: true, data: v2.value as SessionData, legacy: false };
  const v1 = LegacyV1.parse(raw);
  if (v1.ok) {
    const valid = new Set<string>(KINDS);
    const pts = v1.value.points
      .filter((p) => valid.has(p.kind))
      .map((p) => ({ kind: p.kind as (typeof KINDS)[number], x: p.x, y: p.y, z: p.z, t: p.t }));
    return {
      ok: true,
      legacy: true,
      data: {
        format: "aether-session",
        version: 2,
        // v18 exports were generated from the simulator unless proven otherwise
        dataMode: "demo",
        points: pts,
        trajectory: v1.value.trajectory ?? [],
      },
    };
  }
  return { ok: false, error: v2.path.length || v2.message ? issueText(v2) : "格式无法识别" };
}
