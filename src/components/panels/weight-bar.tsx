import type { FusionWeights } from "@/lib/types";

const LABELS: { key: keyof FusionWeights; label: string }[] = [
  { key: "vision", label: "视觉" },
  { key: "sonar", label: "声呐" },
  { key: "mag", label: "磁场" },
  { key: "wifi", label: "Wi-Fi" },
  { key: "depth", label: "深度" },
];

export function WeightBar({ weights }: { weights: FusionWeights }) {
  return (
    <div className="space-y-2">
      {LABELS.map((row) => (
        <div key={row.key} className="flex items-center gap-3">
          <span className="w-10 text-[11px] text-muted">{row.label}</span>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-raised">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-200"
              style={{ width: `${Math.round(weights[row.key] * 100)}%` }}
            />
          </div>
          <span className="w-10 text-right font-mono text-[11px] tabular text-faint">
            {(weights[row.key] * 100).toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  );
}
