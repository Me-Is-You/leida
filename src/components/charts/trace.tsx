import { cn } from "@/lib/utils";

export function Trace({
  data,
  className,
  color = "var(--color-accent)",
}: {
  data: number[];
  className?: string;
  color?: string;
}) {
  const max = Math.max(0.001, ...data);
  return (
    <div className={cn("flex h-16 w-full items-end gap-px", className)}>
      {data.map((v, i) => (
        <div
          key={i}
          className="min-w-0 flex-1 rounded-sm"
          style={{ height: `${(v / max) * 100}%`, background: color, opacity: 0.35 + 0.65 * (v / max) }}
        />
      ))}
    </div>
  );
}

export function Wave({
  data,
  className,
  stroke = "var(--color-accent)",
}: {
  data: number[];
  className?: string;
  stroke?: string;
}) {
  const w = 320;
  const h = 72;
  if (data.length < 2) return <div className={cn("h-[72px] w-full rounded-sm bg-raised", className)} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const d = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - 6 - ((v - min) / span) * (h - 12);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-[72px] w-full", className)} preserveAspectRatio="none">
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
