import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/panels/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardHint, CardTitle } from "@/components/ui/card";
import { useRadar } from "@/lib/radar-store";
import type { LogLevel } from "@/lib/types";
import { cn, downloadJson } from "@/lib/utils";

export const Route = createFileRoute("/log")({ component: LogPage });

const LEVELS: LogLevel[] = ["INFO", "DETECT", "WARN", "REAL"];

function LogPage() {
  const logs = useRadar((s) => s.logs);
  const resetSession = useRadar((s) => s.resetSession);
  const alerts = useRadar((s) => s.alerts);
  const dismissAlert = useRadar((s) => s.dismissAlert);
  const t = useRadar((s) => s.t);
  const realFlags = useRadar((s) => s.realFlags);
  const [q, setQ] = useState("");
  const [level, setLevel] = useState<LogLevel | "ALL">("ALL");

  const filtered = useMemo(() => {
    return logs.filter((e) => {
      if (level !== "ALL" && e.level !== level) return false;
      if (q && !e.msg.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [logs, q, level]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader
        kicker="Log"
        title="会话日志"
        hint="融合内核、真实通道与检测事件。可导出，可重置。不会上传。"
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => downloadJson(`aether-log-${Date.now()}.json`, { t, logs, alerts, realFlags })}
            >
              导出
            </Button>
            <Button size="sm" variant="danger" onClick={resetSession}>
              重置会话
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        {(["ALL", ...LEVELS] as const).map((lv) => (
          <Button key={lv} size="sm" variant={level === lv ? "accent" : "outline"} onClick={() => setLevel(lv)}>
            {lv}
          </Button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="过滤"
          className="h-8 min-w-40 flex-1 rounded-sm bg-raised px-3 text-sm text-fg shadow-[var(--shadow-border)] outline-none placeholder:text-faint focus-visible:ring-2 focus-visible:ring-accent/50"
        />
      </div>

      {alerts.length ? (
        <Card>
          <CardHeader>
            <CardTitle>活动告警</CardTitle>
            <CardHint>{alerts.length}</CardHint>
          </CardHeader>
          <ul className="space-y-2">
            {alerts.slice(0, 8).map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-3 rounded-md bg-raised px-3 py-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge tone={a.tone}>{a.tone}</Badge>
                    <span className="text-sm">{a.title}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{a.body}</p>
                </div>
                <button type="button" className="text-xs text-faint hover:text-fg" onClick={() => dismissAlert(a.id)}>
                  关闭
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>事件</CardTitle>
          <CardHint>
            {filtered.length}/{logs.length}
          </CardHint>
        </CardHeader>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted">尚无匹配记录。启动相机、声呐或建图会产生事件。</p>
        ) : (
          <ul className="space-y-1">
            {filtered.map((e, i) => (
              <li key={`${e.t}-${i}`} className="grid grid-cols-[72px_56px_1fr] items-baseline gap-2 py-1.5 text-sm">
                <span className="font-mono text-[11px] tabular text-faint">
                  {new Date(e.t).toLocaleTimeString("zh-CN", { hour12: false })}
                </span>
                <Badge
                  tone={e.level === "REAL" ? "real" : e.level === "WARN" ? "warn" : e.level === "DETECT" ? "live" : "mute"}
                  className={cn("justify-center")}
                >
                  {e.level}
                </Badge>
                <span>{e.msg}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
