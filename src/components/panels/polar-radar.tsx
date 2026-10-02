import { effectiveSonar, useRadar } from "@/lib/radar-store";

/** Heading-up plan view centred on the observer: up = where the camera points. */
export function PolarRadar({ size = 220, range = 6 }: { size?: number; range?: number }) {
  const people = useRadar((s) => s.people);
  const objects = useRadar((s) => s.objects);
  const detections = useRadar((s) => s.detections);
  const pose = useRadar((s) => s.pose);
  const sonar = useRadar(effectiveSonar);
  const c = size / 2;
  const R = c - 14;
  const h = (pose.headingDeg * Math.PI) / 180;
  // world → radar (right, forward) → svg
  const to = (x: number, z: number) => {
    const dx = x - pose.x;
    const dz = z - pose.z;
    const f = dx * Math.sin(h) + dz * Math.cos(h);
    const r = dx * Math.cos(h) - dz * Math.sin(h);
    return { px: c + (r / range) * R, py: c - (f / range) * R };
  };
  const inside = (p: { px: number; py: number }) => Math.hypot(p.px - c, p.py - c) <= R + 1;
  const rings = [range / 3, (2 * range) / 3, range];

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full" role="img" aria-label="平面雷达（航向朝上）">
      {rings.map((r) => (
        <g key={r}>
          <circle cx={c} cy={c} r={(r / range) * R} fill="none" stroke="currentColor" className="text-line" strokeWidth="1" />
          <text x={c + 3} y={c - (r / range) * R + 10} className="fill-faint" fontSize="8">
            {r.toFixed(0)}m
          </text>
        </g>
      ))}
      <line x1={c} y1={c - R} x2={c} y2={c + R} className="text-line" stroke="currentColor" strokeWidth="1" />
      <line x1={c - R} y1={c} x2={c + R} y2={c} className="text-line" stroke="currentColor" strokeWidth="1" />
      <text x={c} y={11} textAnchor="middle" fontSize="9" className="fill-muted">
        前
      </text>
      <polygon points={`${c},${c - R} ${c + 0.42 * R},${c} ${c - 0.42 * R},${c}`} fill="var(--color-accent)" opacity="0.1" />
      {objects.map((o) => {
        const p = to(o.pos.x, o.pos.z);
        return inside(p) ? <circle key={o.id} cx={p.px} cy={p.py} r={o.metal ? 3.2 : 2.2} fill="var(--color-muted)" opacity="0.7" /> : null;
      })}
      {detections
        .filter((d) => d.cls !== "person")
        .map((d) => {
          const p = to(d.world.x, d.world.z);
          return inside(p) ? <rect key={d.id} x={p.px - 2.5} y={p.py - 2.5} width="5" height="5" fill="var(--color-warn)" opacity="0.85" /> : null;
        })}
      {people.map((p) => {
        const pt = to(p.pos.x, p.pos.z);
        return inside(pt) ? (
          <circle
            key={p.id}
            cx={pt.px}
            cy={pt.py}
            r={p.source === "device" ? 4.2 : 3.4}
            fill={p.behindWall ? "var(--color-warn)" : "var(--color-accent)"}
            opacity={p.source === "device" ? 1 : 0.7}
          />
        ) : null;
      })}
      {sonar?.distM != null && sonar.distM <= range ? (
        <g>
          <line x1={c} y1={c} x2={c} y2={c - (sonar.distM / range) * R} stroke="var(--color-live)" strokeWidth="1.5" opacity="0.8" />
          <circle cx={c} cy={c - (sonar.distM / range) * R} r="3" fill="none" stroke="var(--color-live)" strokeWidth="1.5" />
        </g>
      ) : null}
      <circle cx={c} cy={c} r="3.2" fill="var(--color-fg)" />
    </svg>
  );
}
