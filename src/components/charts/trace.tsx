import { cn } from "@/lib/utils";

/** Bar trace (e.g. echo envelope). `xLabels` draws tick labels under the bars. */
export function Trace({
  data,
  className,
  color = "var(--color-accent)",
  xLabels,
  markers,
}: {
  data: number[];
  className?: string;
  color?: string;
  xLabels?: string[];
  /** Fractions 0‥1 along the x axis to mark (e.g. detected echoes). */
  markers?: number[];
}) {
  const max = Math.max(0.001, ...data);
  return (
    <div className={className}>
      <div className={cn("relative flex h-20 w-full items-end gap-px", )}>
        {data.map((v, i) => (
          <div
            key={i}
            className="min-w-0 flex-1 rounded-sm"
            style={{ height: `${Math.max(1, (v / max) * 100)}%`, background: color, opacity: 0.3 + 0.7 * (v / max) }}
          />
        ))}
        {markers?.map((m, i) => (
          <div key={i} className="absolute inset-y-0 w-px bg-live" style={{ left: `${m * 100}%` }} />
        ))}
      </div>
      {xLabels ? (
        <div className="mt-1 flex justify-between font-mono text-[9px] text-faint tabular">
          {xLabels.map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Wave({
  data,
  className,
  stroke = "var(--color-accent)",
  unit = "",
  digits = 2,
  xLabel,
}: {
  data: number[];
  className?: string;
  stroke?: string;
  unit?: string;
  digits?: number;
  xLabel?: string;
}) {
  const w = 320;
  const h = 72;
  const clean = data.filter((v) => Number.isFinite(v));
  if (clean.length < 2) {
    return <div className={cn("grid h-[72px] w-full place-items-center rounded-sm bg-raised text-[11px] text-faint", className)}>无数据</div>;
  }
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const d = clean
    .map((v, i) => {
      const x = (i / (clean.length - 1)) * w;
      const y = h - 6 - ((v - min) / span) * (h - 12);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div className={className}>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-[72px] w-full" preserveAspectRatio="none">
        <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="flex justify-between font-mono text-[9px] text-faint tabular">
        <span>
          {min.toFixed(digits)}
          {unit ? ` ${unit}` : ""}
        </span>
        <span>{xLabel ?? ""}</span>
        <span>
          {max.toFixed(digits)}
          {unit ? ` ${unit}` : ""}
        </span>
      </div>
    </div>
  );
}
