import { cn } from "@/lib/utils";

/** Small line chart with a label, the latest value and the min/max range (so the scale is never a mystery). */
export function Spark({
  data,
  className,
  stroke = "var(--color-accent)",
  label,
  unit = "",
  digits = 1,
}: {
  data: number[];
  className?: string;
  stroke?: string;
  label?: string;
  unit?: string;
  digits?: number;
}) {
  const w = 160;
  const h = 36;
  const clean = data.filter((v) => Number.isFinite(v));
  const latest = clean.length ? (clean[clean.length - 1] as number) : null;
  const min = clean.length ? Math.min(...clean) : 0;
  const max = clean.length ? Math.max(...clean) : 0;
  const span = max - min || 1;
  const d =
    clean.length >= 2
      ? clean
          .map((v, i) => {
            const x = (i / (clean.length - 1)) * w;
            const y = h - 3 - ((v - min) / span) * (h - 6);
            return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
          })
          .join(" ")
      : "";
  return (
    <div className={cn("mt-2 first:mt-0", className)}>
      {label ? (
        <div className="flex items-baseline justify-between text-[10px] uppercase tracking-widest text-faint">
          <span>{label}</span>
          <span className="font-mono normal-case tracking-normal text-muted tabular">
            {latest !== null ? `${latest.toFixed(digits)} ${unit}` : "—"}
          </span>
        </div>
      ) : null}
      {d ? (
        <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full" preserveAspectRatio="none" role="img" aria-label={label}>
          <path d={d} fill="none" stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : (
        <div className="grid h-9 w-full place-items-center rounded-sm bg-raised text-[10px] text-faint">无数据</div>
      )}
      {label && clean.length >= 2 ? (
        <div className="flex justify-between font-mono text-[9px] text-faint tabular">
          <span>
            {min.toFixed(digits)}
          </span>
          <span>
            {max.toFixed(digits)} {unit}
          </span>
        </div>
      ) : null}
    </div>
  );
}
