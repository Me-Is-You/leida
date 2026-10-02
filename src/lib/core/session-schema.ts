import { z } from "zod";

const finite = z.number().refine(Number.isFinite, "must be finite");
const kind = z.enum(["person", "object", "wall", "free", "traj", "sonar"]);

const pointV2 = z.object({ kind, x: finite, y: finite, z: finite, t: finite.optional() });
const trajPoint = z.object({ x: finite, y: finite.optional(), z: finite });

export const SessionV2 = z.object({
  format: z.literal("aether-session"),
  version: z.literal(2),
  app: z.string().max(40).optional(),
  createdAt: z.string().max(40).optional(),
  dataMode: z.enum(["demo", "real"]),
  points: z.array(pointV2).max(60000),
  trajectory: z.array(trajPoint).max(20000).default([]),
  stats: z
    .object({
      steps: z.number().int().nonnegative().optional(),
      distanceM: finite.optional(),
      exploredM2: finite.optional(),
    })
    .optional(),
});

export type SessionData = z.infer<typeof SessionV2>;

/** v1 (v18.0 export): { version: "18.0", points: MapPoint[], trajectory } with unvalidated content. */
const LegacyV1 = z.object({
  version: z.string(),
  points: z.array(z.object({ x: finite, y: finite, z: finite, kind: z.string(), t: finite.optional() })).max(60000),
  trajectory: z.array(trajPoint).max(20000).optional(),
});

export type ParseResult = { ok: true; data: SessionData; legacy: boolean } | { ok: false; error: string };

export function parseSession(raw: unknown): ParseResult {
  const v2 = SessionV2.safeParse(raw);
  if (v2.success) return { ok: true, data: v2.data, legacy: false };
  const v1 = LegacyV1.safeParse(raw);
  if (v1.success) {
    const valid = new Set(kind.options as readonly string[]);
    const pts = v1.data.points
      .filter((p) => valid.has(p.kind))
      .map((p) => ({ kind: p.kind as z.infer<typeof kind>, x: p.x, y: p.y, z: p.z, t: p.t }));
    return {
      ok: true,
      legacy: true,
      data: {
        format: "aether-session",
        version: 2,
        // v18 exports were generated from the simulator unless proven otherwise
        dataMode: "demo",
        points: pts,
        trajectory: v1.data.trajectory ?? [],
      },
    };
  }
  const issue = v2.error.issues[0];
  return { ok: false, error: issue ? `${issue.path.join(".") || "root"}: ${issue.message}` : "格式无法识别" };
}
