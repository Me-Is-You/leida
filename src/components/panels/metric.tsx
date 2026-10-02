import { cn } from "@/lib/utils";

export function Metric({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg bg-raised px-3 py-2.5 shadow-[var(--shadow-border)]">
      <div className="text-[10px] uppercase tracking-widest text-faint">{label}</div>
      <div className={cn("font-mono text-lg tabular", accent ? "text-live" : "text-fg")}>{value}</div>
      {hint ? <div className="text-[11px] text-muted">{hint}</div> : null}
    </div>
  );
}

export function SourceBadge({ source }: { source: string }) {
  const real = source === "device";
  return (
    <span
      title={real ? "真实设备数据" : "无数据"}
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        real ? "bg-accent/20 text-accent" : "bg-raised text-faint/60",
      )}
    >
      {real ? "real" : "—"}
    </span>
  );
}
