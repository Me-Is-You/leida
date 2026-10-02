import { cn } from "@/lib/utils";

export function Spark({
  data,
  className,
  stroke = "var(--color-accent)",
}: {
  data: number[];
  className?: string;
  stroke?: string;
}) {
  const w = 160;
  const h = 36;
  if (data.length < 2) {
    return <div className={cn("h-9 w-full rounded-sm bg-raised", className)} />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const d = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - 3 - ((v - min) / span) * (h - 6);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={cn("h-9 w-full", className)} preserveAspectRatio="none">
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
