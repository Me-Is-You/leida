import { createFileRoute, Link } from "@tanstack/react-router";
import { RadarCanvas } from "@/components/radar/radar-canvas";
import { PolarRadar } from "@/components/panels/polar-radar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardHint, CardTitle } from "@/components/ui/card";
import { Spark } from "@/components/charts/spark";
import { SourceBadge } from "@/components/panels/metric";
import { effectiveSonar, useRadar } from "@/lib/radar-store";
import { ENV_LABEL } from "@/lib/types";
import { formatMeters } from "@/lib/utils";
import { Camera, MapPinned, Radio, Waves, X } from "lucide-react";

export const Route = createFileRoute("/")({ component: CommandPage });

function CommandPage() {
  const people = useRadar((s) => s.people);
  const wifi = useRadar((s) => s.wifi);
  const mag = useRadar((s) => s.mag);
  const sonar = useRadar(effectiveSonar);
  const detections = useRadar((s) => s.detections);
  const cloudCounts = useRadar((s) => s.cloudCounts);
  const mapping = useRadar((s) => s.mapping);
  const cameraOn = useRadar((s) => s.cameraOn);
  const dataMode = useRadar((s) => s.dataMode);
  const sensors = useRadar((s) => s.sensors);
  const rssiHist = useRadar((s) => s.rssiHist);
  const magHist = useRadar((s) => s.magHist);
  const sonarHist = useRadar((s) => s.sonarHist);
  const fpsHist = useRadar((s) => s.fpsHist);
  const env = useRadar((s) => s.env);
  const ping = useRadar((s) => s.ping);
  const sonarBusy = useRadar((s) => s.sonarBusy);
  const enableCamera = useRadar((s) => s.enableCamera);
  const disableCamera = useRadar((s) => s.disableCamera);
  const toggleMapping = useRadar((s) => s.toggleMapping);
  const scanBt = useRadar((s) => s.scanBt);
  const alerts = useRadar((s) => s.alerts);
  const dismissAlert = useRadar((s) => s.dismissAlert);
  const fusion = useRadar((s) => s.fusion);
  const fused = useRadar((s) => s.fused);
  const exploredM2 = useRadar((s) => s.exploredM2);
  const objects = useRadar((s) => s.objects);
  const select = useRadar((s) => s.select);
  const selectedId = useRadar((s) => s.selectedId);
  const pose = useRadar((s) => s.pose);
  const steps = useRadar((s) => s.steps);
  const trajLen = useRadar((s) => s.trajLen);

  const points = Object.values(cloudCounts).reduce((a, b) => a + b, 0);
  const demo = dataMode === "demo";

  return (
    <div className="grid h-full min-h-[calc(100dvh-52px)] grid-cols-1 lg:grid-cols-[1fr_360px]">
      <section className="relative min-h-[380px]">
        <RadarCanvas className="absolute inset-0" />
        <div className="pointer-events-none absolute inset-x-4 top-4 flex flex-wrap gap-2">
          <Badge tone={demo ? "warn" : "real"}>{demo ? "演示数据" : "真实模式"}</Badge>
          <Badge tone={cameraOn ? "real" : "mute"}>{cameraOn ? "相机已接入" : "相机未开"}</Badge>
          <Badge tone={wifi.throughWall ? "warn" : "mute"}>
            {wifi.source === "none" ? "无 Wi-Fi 通道" : wifi.throughWall ? "链路扰动（模拟）" : "视距链路（模拟）"}
          </Badge>
          <Badge tone="mute">{ENV_LABEL[env]}</Badge>
        </div>
        <div className="pointer-events-none absolute bottom-4 left-4 right-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Hud label="人物" value={String(people.length)} />
          <Hud label="检测" value={String(detections.length)} />
          <Hud label="点云" value={String(points)} />
          <Hud label="声呐" value={formatMeters(sonar?.distM ?? null)} />
          <Hud label="融合距离" value={formatMeters(fused.rangeM)} />
        </div>
      </section>

      <aside className="flex flex-col gap-3 overflow-y-auto border-t border-line p-4 lg:border-t-0 lg:border-l">
        <div className="stagger-in space-y-1">
          <p className="text-[11px] uppercase tracking-[0.18em] text-faint">Command</p>
          <h1 className="font-display text-2xl font-semibold tracking-tight">实时指挥台</h1>
          <p className="text-sm text-muted">
            {demo
              ? "演示模式：真实传感器优先，缺失通道由孪生补位并标 DEMO。"
              : "真实模式：只有真实设备数据；没有数据的通道显示「—」。"}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant={cameraOn ? "accent" : "default"} onClick={() => (cameraOn ? disableCamera() : void enableCamera())}>
            <Camera /> {cameraOn ? "关闭相机" : "启动相机"}
          </Button>
          <Button size="sm" variant="outline" disabled={sonarBusy} onClick={() => void ping()}>
            <Waves /> {sonarBusy ? "发射中…" : "声呐脉冲"}
          </Button>
          <Button size="sm" variant={mapping ? "accent" : "outline"} onClick={toggleMapping}>
            <MapPinned /> {mapping ? "建图中" : "开始建图"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void scanBt()}>
            <Radio /> 扫描蓝牙
          </Button>
        </div>

        {alerts.slice(0, 3).map((a) => (
          <Card key={a.id} className="bg-raised">
            <CardHeader className="mb-1">
              <CardTitle>{a.title}</CardTitle>
              <div className="flex items-center gap-2">
                <Badge tone={a.tone}>{new Date(a.t).toLocaleTimeString("zh-CN", { hour12: false })}</Badge>
                <button type="button" aria-label="关闭告警" onClick={() => dismissAlert(a.id)} className="text-faint hover:text-fg">
                  <X className="size-3.5" />
                </button>
              </div>
            </CardHeader>
            <p className="text-xs text-muted">{a.body}</p>
          </Card>
        ))}

        <Card>
          <CardHeader>
            <CardTitle>通道</CardTitle>
            <CardHint>{sensors.imu.hz} Hz IMU</CardHint>
          </CardHeader>
          <Row
            k="Wi-Fi RSSI"
            v={Number.isFinite(wifi.rssi) ? `${wifi.rssi.toFixed(1)} dBm` : "—"}
            sub={Number.isFinite(wifi.sigma) ? `σ ${wifi.sigma.toFixed(2)}` : "浏览器不开放 RSSI"}
            src={wifi.source}
          />
          <Row
            k="磁场"
            v={Number.isFinite(mag.mag) ? `${mag.mag.toFixed(1)} μT` : "—"}
            sub={Number.isFinite(mag.mag) ? (mag.anomaly ? "异常" : "背景") : (sensors.mag.note || "未接入")}
            src={mag.source}
          />
          <Row
            k="声呐"
            v={formatMeters(sonar?.distM ?? null)}
            sub={sonar ? (sonar.status === "ok" ? `SNR ${sonar.snrDb.toFixed(0)} dB` : sonar.message) : "按「声呐脉冲」测量"}
            src={sonar?.source ?? "none"}
          />
          <Row
            k="航向"
            v={sensors.orient.state === "live" || demo ? `${pose.headingDeg.toFixed(0)}°` : "—"}
            sub={`俯仰 ${sensors.orient.state === "live" ? pose.pitchDeg.toFixed(0) + "°" : "—"}`}
            src={sensors.orient.state === "live" ? "device" : demo ? "twin" : "none"}
          />
          <Row
            k="PDR 步数"
            v={String(steps)}
            sub={`${trajLen.toFixed(1)} m · 已探索 ${exploredM2.toFixed(1)} m²`}
            src={sensors.imu.state === "live" ? "device" : "none"}
          />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>平面雷达</CardTitle>
            <CardHint>航向朝上 · 6 m</CardHint>
          </CardHeader>
          <div className="mx-auto h-44 w-44 text-fg">
            <PolarRadar size={176} />
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>波形</CardTitle>
          </CardHeader>
          <Spark data={rssiHist} label="RSSI (模拟)" unit="dBm" />
          <Spark data={magHist} stroke="var(--color-warn)" label="|B|" unit="μT" />
          <Spark data={sonarHist} label="声呐距离" unit="m" />
          <Spark data={fpsHist} stroke="var(--color-live)" label="主循环帧率" unit="Hz" />
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>距离融合</CardTitle>
            <CardHint>{ENV_LABEL[env]}</CardHint>
          </CardHeader>
          <p className="font-mono text-lg tabular">
            {fused.rangeM !== null ? `${fused.rangeM.toFixed(2)} m` : "—"}
            {fused.sigmaM !== null ? <span className="ml-1 text-xs text-muted">±{fused.sigmaM.toFixed(2)}</span> : null}
          </p>
          <p className="mt-1 text-xs text-muted">
            {fused.used.length ? `采用：${fused.used.join(" + ")}` : "没有可融合的测距来源（需要声呐脉冲或带深度先验的视觉目标）"}
            {fused.conflict ? ` · 剔除离群：${fused.rejected.join(",")}` : ""}
          </p>
          <div className="mt-3 flex gap-1">
            {Object.entries(fusion).map(([k, v]) => (
              <div key={k} className="flex-1 text-center">
                <div className="mx-auto h-12 w-1.5 overflow-hidden rounded-full bg-raised">
                  <div className="w-full rounded-full bg-accent" style={{ height: `${v * 100}%`, marginTop: `${(1 - v) * 100}%` }} />
                </div>
                <div className="mt-1 text-[10px] text-faint">{k}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-faint">权重按当前环境放大/缩小各来源的置信度（逆方差加权）；仅 sonar / vision 参与测距。</p>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>现场目标</CardTitle>
            <CardHint>{people.length} 人</CardHint>
          </CardHeader>
          {people.length === 0 ? (
            <p className="text-sm text-muted">{cameraOn ? "画面里没有检测到人。" : "打开相机后，视觉检测到的人物会出现在这里。"}</p>
          ) : (
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
                        {p.pos.x.toFixed(1)}, {p.pos.z.toFixed(1)}
                        {p.bpm ? ` · ${p.bpm.toFixed(0)} bpm（模拟）` : ` · ${(p.confidence * 100).toFixed(0)}%`}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <SourceBadge source={p.source} />
                      {p.source === "twin" ? <Badge tone={p.behindWall ? "warn" : "live"}>{p.behindWall ? "墙后" : "视距"}</Badge> : null}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{demo ? "场景物体（模拟）" : "视觉物体"}</CardTitle>
            <Link to="/map" className="text-xs text-accent hover:underline">
              建图
            </Link>
          </CardHeader>
          <ul className="space-y-1.5">
            {demo
              ? objects.slice(0, 6).map((o) => (
                  <li key={o.id} className="flex items-center justify-between text-sm">
                    <span>{o.name}</span>
                    <span className="font-mono text-[11px] text-faint">{o.metal ? "金属" : o.kind}</span>
                  </li>
                ))
              : detections
                  .filter((d) => d.cls !== "person")
                  .slice(0, 6)
                  .map((d) => (
                    <li key={d.id} className="flex items-center justify-between text-sm">
                      <span>{d.cls}</span>
                      <span className="font-mono text-[11px] text-faint">≈{d.depthM.toFixed(1)} m</span>
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
      <div className="min-w-0 pr-2">
        <div className="text-sm">{k}</div>
        <div className="truncate text-[11px] text-faint">{sub}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="font-mono text-sm tabular">{v}</div>
        <SourceBadge source={src} />
      </div>
    </div>
  );
}
