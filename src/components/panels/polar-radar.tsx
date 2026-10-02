import { useRadar } from "@/lib/radar-store";

export function PolarRadar({ size = 220 }: { size?: number }) {
  const people = useRadar((s) => s.people);
  const objects = useRadar((s) => s.objects);
  const heading = useRadar((s) => s.heading);
  const range = 12;
  const c = size / 2;
  const to = (x: number, z: number) => {
    const px = c + (x / range) * (c - 10);
    const py = c - (z / range) * (c - 10);
    return { px, py };
  };

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full">
      {[3, 6, 9, 12].map((r) => (
        <circle
          key={r}
          cx={c}
          cy={c}
          r={(r / range) * (c - 10)}
          fill="none"
          stroke="currentColor"
          className="text-line"
          strokeWidth="1"
        />
      ))}
      <line x1={c} y1={8} x2={c} y2={size - 8} className="text-line" stroke="currentColor" strokeWidth="1" />
      <line x1={8} y1={c} x2={size - 8} y2={c} className="text-line" stroke="currentColor" strokeWidth="1" />
      <g transform={`rotate(${heading} ${c} ${c})`}>
        <polygon points={`${c},${8} ${c + 9},${c} ${c - 9},${c}`} fill="var(--color-accent)" opacity="0.18" />
      </g>
      {objects.map((o) => {
        const p = to(o.pos.x, o.pos.z);
        return <circle key={o.id} cx={p.px} cy={p.py} r={o.metal ? 3.2 : 2.2} fill="var(--color-muted)" opacity="0.7" />;
      })}
      {people.map((p) => {
        const pt = to(p.pos.x, p.pos.z);
        return (
          <circle
            key={p.id}
            cx={pt.px}
            cy={pt.py}
            r={p.source === "device" ? 4.2 : 3.4}
            fill={p.behindWall ? "var(--color-warn)" : "var(--color-accent)"}
          />
        );
      })}
      <circle cx={to(-4.2, 3.6).px} cy={to(-4.2, 3.6).py} r="3" fill="var(--color-fg)" />
    </svg>
  );
}
