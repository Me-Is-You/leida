import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/panels/page-header";
import { Metric } from "@/components/panels/metric";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardHint, CardTitle } from "@/components/ui/card";
import { CAMERAS, CEILINGS, DEVICE, SENSORS } from "@/lib/hardware";
import { hostRuntime, readBattery } from "@/lib/device";
import { useRadar } from "@/lib/radar-store";

export const Route = createFileRoute("/hardware")({ component: HardwarePage });

function HardwarePage() {
  const capabilities = useRadar((s) => s.capabilities);
  const fullCheck = useRadar((s) => s.fullCheck);
  const realFlags = useRadar((s) => s.realFlags);
  const fps = useRadar((s) => s.fps);
  const latencyUs = useRadar((s) => s.latencyUs);
  const [runtime, setRuntime] = useState<ReturnType<typeof hostRuntime> | null>(null);
  const [battery, setBattery] = useState<{ level: number; charging: boolean } | null>(null);

  useEffect(() => {
    setRuntime(hostRuntime());
    void readBattery().then(setBattery);
    if (!capabilities.length) fullCheck();
  }, [capabilities.length, fullCheck]);

  const realCount = Object.values(realFlags).filter(Boolean).length;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader
        kicker="Hardware"
        title="X300 档案"
        hint="规格来自真机交叉验证。能力探针读的是当前浏览器，不是广告页。"
        actions={
          <Button size="sm" variant="outline" onClick={fullCheck}>
            重新探测
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Metric label="型号" value={DEVICE.model} hint={DEVICE.code} />
        <Metric label="真实通道" value={`${realCount}/8`} accent={realCount > 0} />
        <Metric label="融合 FPS" value={fps.toFixed(0)} hint={`${latencyUs.toFixed(0)} μs`} />
        <Metric
          label="电量"
          value={battery ? `${Math.round(battery.level * 100)}%` : "—"}
          hint={battery ? (battery.charging ? "充电中" : "放电") : "Battery API"}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>机身</CardTitle>
          <CardHint>{DEVICE.os}</CardHint>
        </CardHeader>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Item k="SoC" v={DEVICE.soc} />
          <Item k="CPU" v={DEVICE.cpu} />
          <Item k="GPU" v={DEVICE.gpu} />
          <Item k="NPU" v={DEVICE.npu} />
          <Item k="内存" v={DEVICE.ram} />
          <Item k="存储" v={DEVICE.storage} />
          <Item k="屏幕" v={DEVICE.display} />
          <Item k="电池" v={DEVICE.battery} />
          <Item k="Wi-Fi" v={DEVICE.wifi} />
          <Item k="蓝牙" v={DEVICE.bt} />
          <Item k="GNSS" v={DEVICE.gnss} />
          <Item k="USB" v={DEVICE.usb} />
          <Item k="防护" v={DEVICE.ip} />
        </dl>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>镜头模组</CardTitle>
          </CardHeader>
          <ul className="space-y-3">
            {CAMERAS.map((c) => (
              <li key={c.name}>
                <div className="text-sm">{c.name}</div>
                <div className="text-xs text-muted">{c.spec}</div>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>传感器</CardTitle>
          </CardHeader>
          <ul className="space-y-2">
            {SENSORS.map((s) => (
              <li key={s.name} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <div>{s.name}</div>
                  <div className="text-xs text-faint">{s.model}</div>
                </div>
                <div className="text-right text-xs text-muted">
                  {s.range}
                  <div className="text-faint">{s.use}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>浏览器能力</CardTitle>
          <CardHint>
            {capabilities.filter((c) => c.available).length}/{capabilities.length || 0}
          </CardHint>
        </CardHeader>
        <ul className="grid gap-2 sm:grid-cols-2">
          {capabilities.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-3 rounded-md bg-raised px-3 py-2">
              <div>
                <div className="text-sm">{c.label}</div>
                <div className="text-[11px] text-faint">{c.note}</div>
              </div>
              <Badge tone={c.available ? "live" : "mute"}>{c.available ? "可用" : "不可"}</Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>当前运行时</CardTitle>
        </CardHeader>
        {runtime ? (
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <Item k="UA" v={runtime.ua} />
            <Item k="核心" v={String(runtime.cores)} />
            <Item k="设备内存" v={runtime.memoryGb != null ? `${runtime.memoryGb} GB` : "—"} />
            <Item k="屏幕" v={`${runtime.screen} @${runtime.dpr.toFixed(2)}`} />
            <Item k="网络" v={`${runtime.connection}${runtime.downlink != null ? ` · ${runtime.downlink} Mb/s` : ""}`} />
            <Item k="触控点" v={String(runtime.touch)} />
          </dl>
        ) : (
          <p className="text-sm text-muted">读取中</p>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>诚实天花板</CardTitle>
        </CardHeader>
        <ul className="space-y-3">
          {CEILINGS.map((c) => (
            <li key={c.title} className="rounded-md bg-raised px-3 py-3">
              <div className="flex items-center gap-2">
                <Badge tone={c.level === "hard" ? "warn" : "mute"}>{c.level}</Badge>
                <span className="text-sm">{c.title}</span>
              </div>
              <p className="mt-1 text-xs text-muted">{c.body}</p>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Item({ k, v }: { k: string; v: string }) {
  return (
    <div className="border-b border-line py-2 last:border-0">
      <dt className="text-[11px] uppercase tracking-widest text-faint">{k}</dt>
      <dd className="mt-0.5 text-sm leading-snug">{v}</dd>
    </div>
  );
}
