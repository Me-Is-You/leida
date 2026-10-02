import { useEffect } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { Logo } from "@/components/brand/logo";
import { NAV } from "@/components/layout/nav";
import { CameraEngine } from "@/components/vision/camera-engine";
import { cn } from "@/lib/utils";
import { useRadar } from "@/lib/radar-store";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const start = useRadar((s) => s.start);
  const running = useRadar((s) => s.running);
  const clock = useRadar((s) => s.clock);
  const fps = useRadar((s) => s.fps);
  const stop = useRadar((s) => s.stop);
  const env = useRadar((s) => s.env);
  const sensors = useRadar((s) => s.sensors);
  const dataMode = useRadar((s) => s.dataMode);
  const setDataMode = useRadar((s) => s.setDataMode);
  const enableSensors = useRadar((s) => s.enableSensors);

  useEffect(() => {
    start();
    return () => stop();
  }, [start, stop]);

  const liveCount = Object.values(sensors).filter((x) => x.state === "live").length;
  const total = Object.keys(sensors).length;
  const demo = dataMode === "demo";

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg lg:flex-row">
      <aside className="hidden w-[220px] shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <Logo className="size-7 text-accent" />
          <div>
            <div className="font-display text-sm font-semibold tracking-tight">AETHER</div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-faint">X300 探测站</div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          {NAV.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors duration-150",
                  active ? "bg-raised text-fg" : "text-muted hover:bg-raised/70 hover:text-fg",
                )}
              >
                <Icon className="size-4 shrink-0" strokeWidth={1.6} />
                <span className="flex-1">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-line px-5 py-4 text-[11px] text-faint">
          <div className="flex items-center gap-2">
            <span className="live-dot" />
            <span className="uppercase tracking-widest">{running ? "Live" : "Idle"}</span>
          </div>
          <div className="mt-2 font-mono tabular text-muted">v19.0 · 诚实内核</div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line bg-surface/80 px-4 py-2.5 backdrop-blur-sm">
          <div className="flex items-center gap-2 lg:hidden">
            <Logo className="size-6 text-accent" />
            <span className="font-display text-sm font-semibold">AETHER</span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-[11px]">
            <button
              type="button"
              onClick={() => setDataMode(demo ? "real" : "demo")}
              title={demo ? "当前：演示数据（缺失通道由孪生补位）。点击切换到真实模式" : "当前：只显示真实设备数据。点击切换到演示模式"}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
                demo ? "bg-warn/20 text-warn" : "bg-accent/20 text-accent",
              )}
            >
              <span className={cn("size-1.5 rounded-full", demo ? "bg-warn" : "bg-accent")} />
              {demo ? "演示数据" : "真实模式"}
            </button>
            <button
              type="button"
              onClick={() => void enableSensors()}
              className="rounded-full bg-raised px-2.5 py-1 text-muted hover:text-fg"
            >
              启用传感器
            </button>
            <Stat label="环境" value={env.toUpperCase()} />
            <Stat label="真实通道" value={`${liveCount}/${total}`} accent={liveCount > 0} />
            <Stat label="帧率" value={fps.toFixed(0)} />
            <Stat label="时钟" value={clock} />
          </div>
        </header>

        {demo ? (
          <div className="border-b border-warn/25 bg-warn/10 px-4 py-1.5 text-[11px] text-warn">
            演示模式：带 <b>DEMO</b> 标记的人物 / 物体 / Wi-Fi / 声呐为模拟数据。要看真实传感器，请点右上角切换到「真实模式」。
          </div>
        ) : null}

        <main className="relative min-h-0 flex-1 overflow-auto pb-20 lg:pb-0">{children}</main>

        <nav className="fixed inset-x-0 bottom-0 z-30 flex gap-1 overflow-x-auto border-t border-line bg-surface/95 px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur-sm lg:hidden">
          {NAV.map((item) => {
            const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex min-w-14 flex-1 flex-col items-center gap-1 rounded-md px-2 py-1.5 text-[10px]",
                  active ? "text-fg" : "text-faint",
                )}
              >
                <Icon className="size-4" strokeWidth={1.6} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <CameraEngine />
      <Toaster theme="dark" position="bottom-right" />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-raised px-2.5 py-1">
      <span className="text-faint">{label}</span>
      <span className={cn("font-mono tabular", accent ? "text-live" : "text-fg")}>{value}</span>
    </div>
  );
}
