import { createFileRoute, Link } from "@tanstack/react-router";
import { RadarCanvas } from "@/components/radar/radar-canvas";
import { PolarRadar } from "@/components/panels/polar-radar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardHint, CardTitle } from "@/components/ui/card";
import { Spark } from "@/components/charts/spark";
import { SourceBadge } from "@/components/panels/metric";
import { useRadar } from "@/lib/radar-store";
import { ENV_LABEL } from "@/lib/types";
import { formatMeters } from "@/lib/utils";
import { Camera, MapPinned, Radio, Waves } from "lucide-react";

export const Route = createFileRoute("/")({ component: CommandPage });

function CommandPage() {
  const people = useRadar((s) => s.people);
  const wifi = useRadar((s) => s.wifi);
  const mag = useRadar((s) => s.mag);
  const sonar = useRadar((s) => s.sonar);
  const detections = useRadar((s) => s.detections);
  const mapPoints = useRadar((s) => s.mapPoints);
  const mapping = useRadar((s) => s.mapping);
  const realFlags = useRadar((s) => s.realFlags);
  const rssiHist = useRadar((s) => s.rssiHist);
  const magHist = useRadar((s) => s.magHist);
  const sonarHist = useRadar((s) => s.sonarHist);
  const fpsHist = useRadar((s) => s.fpsHist);
  const env = useRadar((s) => s.env);
  const ping = useRadar((s) => s.ping);
  const enableCamera = useRadar((s) => s.enableCamera);
  const toggleMapping = useRadar((s) => s.toggleMapping);
  const scanBt = useRadar((s) => s.scanBt);
  const locate = useRadar((s) => s.locate);
  const alerts = useRadar((s) => s.alerts);
  const fusion = useRadar((s) => s.fusion);
  const coverage = useRadar((s) => s.coverage);
  const objects = useRadar((s) => s.objects);
  const select = useRadar((s) => s.select);
  const selectedId = useRadar((s) => s.selectedId);

  return (
    <div className="grid h-full min-h-[calc(100dvh-52px)] grid-cols-1 lg:grid-cols-[1fr_360px]">
      <section className="relative min-h-[380px]">
        <RadarCanvas className="absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-4 top-4 flex flex-wrap gap-2">
          <Badge tone="live">Live fusion</Badge>
          <Badge tone={realFlags.camera ? "real" : "twin"}>{realFlags.camera ? "相机真实" : "视觉孪生"}</Badge>
          <Badge tone={wifi.throughWall ? "warn" : "mute"}>{wifi.throughWall ? "穿墙扰动" : "视距链路"}</Badge>
          <Badge tone="mute">{ENV_LABEL[env]}</Badge>
        </div>
        <div className="pointer-events-none absolute bottom-4 left-4 right-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Hud label="人物" value={String(people.length)} />
          <Hud label="检测" value={String(detections.length)} />
          <Hud label="点云" value={String(mapPoints.length)} />
          <Hud label="声呐" value={formatMeters(sonar?.distM ?? null)} />
        </div>
      </section>

      <aside className="flex flex-col gap-3 overflow-y-auto border-t border-line p-4 lg:border-t-0 lg:border-l">
        <div className="stagger-in space-y-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-faint">Command</p>
          <h1 className="font-display text-2xl font-semibold tracking-tight">实时指挥台</h1>
          <p className="text-sm text-muted">
            视觉 · 声呐 · 电磁 · 建图同一时钟。设备传感器优先，缺失时由物理孪生续航。
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" onClick={() => void enableCamera()}>
            <Camera /> 启动相机
          </Button>
          <Button size="sm" variant="outline" onClick={() => void ping()}>
            <Waves /> 声呐脉冲
          </Button>
          <Button size="sm" variant={mapping ? "accent" : "outline"} onClick={toggleMapping}>
            <MapPinned /> {mapping ? "建图中" : "开始建图"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void scanBt()}>
            <Radio /> 扫描蓝牙
          </Button>
        </div>

        {alerts[0] ? (
          <Card className="bg-raised">
            <CardHeader className="mb-1">
              <CardTitle>告警</CardTitle>
              <Badge tone={alerts[0].tone}>{alerts[0].tone}</Badge>
            </CardHeader>
            <p className="text-sm">{alerts[0].title}</p>
            <p className="mt-1 text-xs text-muted">{alerts[0].body}</p>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>通道</CardTitle>
            <CardHint>20 Hz</CardHint>
          </CardHeader>
          <Row k="Wi-Fi RSSI" v={`${wifi.rssi.toFixed(1)} dBm`} sub={`σ ${wifi.sigma.toFixed(2)}`} src={wifi.source} />
          <Row k="磁场" v={`${mag.mag.toFixed(1)} μT`} sub={mag.anomaly ? "异常" : "背景"} src={mag.source} />
          <Row
            k="声呐"
            v={formatMeters(sonar?.distM ?? null)}
            sub={sonar ? `${sonar.dtUs.toFixed(0)} μs` : "—"}
            src={sonar?.source ?? "twin"}
          />
          <Row k="覆盖" v={`${(coverage * 100).toFixed(0)}%`} sub="占用网格" src="twin" />
          <button type="button" onClick={() => void locate()} className="mt-2 text-left text-xs text-accent hover:underline">
            刷新 GNSS
          </button>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>平面雷达</CardTitle>
            <CardHint>相对观测点</CardHint>
          </CardHeader>
          <div className="mx-auto h-44 w-44 text-fg">
            <PolarRadar size={176} />
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>波形</CardTitle>
          </CardHeader>
          <label className="text-[10px] uppercase tracking-widest text-faint">RSSI</label>
          <Spark data={rssiHist} />
          <label className="mt-2 text-[10px] uppercase tracking-widest text-faint">磁场</label>
          <Spark data={magHist} stroke="var(--color-warn)" />
          <label className="mt-2 text-[10px] uppercase tracking-widest text-faint">测距 / FPS</label>
          <Spark data={sonarHist} />
          <Spark data={fpsHist} stroke="var(--color-live)" />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>融合权重</CardTitle>
            <CardHint>{ENV_LABEL[env]}</CardHint>
          </CardHeader>
          <div className="flex gap-1">
            {Object.entries(fusion).map(([k, v]) => (
              <div key={k} className="flex-1 text-center">
                <div className="mx-auto h-12 w-1.5 overflow-hidden rounded-full bg-raised">
                  <div className="w-full rounded-full bg-accent" style={{ height: `${v * 100}%`, marginTop: `${(1 - v) * 100}%` }} />
                </div>
                <div className="mt-1 text-[10px] text-faint">{k}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>现场目标</CardTitle>
            <CardHint>{people.length} 人</CardHint>
          </CardHeader>
          <ul className="space-y-2">
            {people.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => select(selectedId === p.id ? null : p.id)}
                  className="flex w-full items-center justify-between rounded-md bg-raised px-3 py-2 text-left"
                >
                  <div>
                    <div className="text-sm">{p.name}</div>
                    <div className="font-mono text-[11px] text-faint">
                      {p.pos.x.toFixed(1)}, {p.pos.z.toFixed(1)} · {p.bpm.toFixed(0)} bpm
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <SourceBadge source={p.source} />
                    <Badge tone={p.behindWall ? "warn" : "live"}>{p.behindWall ? "墙后" : "视距"}</Badge>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>场景物体</CardTitle>
            <Link to="/map" className="text-xs text-accent hover:underline">
              建图
            </Link>
          </CardHeader>
          <ul className="space-y-1.5">
            {objects.slice(0, 6).map((o) => (
              <li key={o.id} className="flex items-center justify-between text-sm">
                <span>{o.name}</span>
                <span className="font-mono text-[11px] text-faint">{o.metal ? "金属" : o.kind}</span>
              </li>
            ))}
          </ul>
        </Card>
      </aside>
    </div>
  );
}

function Hud({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface/80 px-3 py-2 shadow-[var(--shadow-border)] backdrop-blur-sm">
      <div className="text-[10px] uppercase tracking-widest text-faint">{label}</div>
      <div className="font-mono text-lg tabular text-fg">{value}</div>
    </div>
  );
}

function Row({ k, v, sub, src }: { k: string; v: string; sub: string; src: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-2 last:border-0">
      <div>
        <div className="text-sm">{k}</div>
        <div className="text-[11px] text-faint">{sub}</div>
      </div>
      <div className="text-right">
        <div className="font-mono text-sm tabular">{v}</div>
        <SourceBadge source={src} />
      </div>
    </div>
  );
}
