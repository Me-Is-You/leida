import type { ReactNode } from "react";

export function PageHeader({
  kicker,
  title,
  hint,
  actions,
}: {
  kicker: string;
  title: string;
  hint: string;
  actions?: ReactNode;
}) {
  return (
    <header className="stagger-in flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <p className="text-[11px] uppercase tracking-[0.18em] text-faint">{kicker}</p>
        <h1 className="font-display text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="max-w-xl text-sm text-muted">{hint}</p>
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}
