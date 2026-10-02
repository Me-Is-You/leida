import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/panels/page-header";
import { Metric, SourceBadge } from "@/components/panels/metric";
import { Wave } from "@/components/charts/trace";
import { Spark } from "@/components/charts/spark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardHint, CardTitle } from "@/components/ui/card";
import { nearestMetal } from "@/lib/fusion";
import { useRadar } from "@/lib/radar-store";
import { Compass, MapPin, Radio } from "lucide-react";

export const Route = createFileRoute("/spectrum")({ component: SpectrumPage });

const fmt = (v: number, d = 1, unit = "") => (Number.isFinite(v) ? `${v.toFixed(d)}${unit ? ` ${unit}` : ""}` : "—");

function SpectrumPage() {
  const wifi = useRadar((s) => s.wifi);
  const mag = useRadar((s) => s.mag);
  const magBaseline = useRadar((s) => s.magBaseline);
  const imu = useRadar((s) => s.imu);
  const geo = useRadar((s) => s.geo);
  const bt = useRadar((s) => s.bt);
  const objects = useRadar((s) => s.objects);
  const pose = useRadar((s) => s.pose);
  const rssiHist = useRadar((s) => s.rssiHist);
  const magHist = useRadar((s) => s.magHist);
  const magXHist = useRadar((s) => s.magXHist);
  const magYHist = useRadar((s) => s.magYHist);
  const magZHist = useRadar((s) => s.magZHist);
  const scanBt = useRadar((s) => s.scanBt);
  const enableSensors = useRadar((s) => s.enableSensors);
  const sensors = useRadar((s) => s.sensors);
  const lightLux = useRadar((s) => s.lightLux);
  const steps = useRadar((s) => s.steps);
  const trajLen = useRadar((s) => s.trajLen);
  const resetPdr = useRadar((s) => s.resetPdr);
  const stepLen = useRadar((s) => s.settings.stepLengthM);
  const metal = objects.length ? nearestMetal({ x: pose.x, y: pose.heightM, z: pose.z }, objects) : null;
  const accel = Math.hypot(imu.ax, imu.ay, imu.az);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader
        kicker="Spectrum"
        title="电磁与运动"
        hint="磁力计嗅探铁磁物体，IMU 计步 + 罗盘做航迹推算。浏览器拿不到 Wi-Fi RSSI / CSI，所以真实模式下该通道显示「—」，演示模式的 Wi-Fi 为模拟。"
        actions={
          <>
            <Button variant="outline" onClick={() => void enableSensors()}>
              <Compass /> 启用传感器
            </Button>
            <Button onClick={() => void scanBt()}>
              <Radio /> 扫描蓝牙
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Metric label="|B|" value={fmt(mag.mag, 1, "μT")} hint={Number.isFinite(mag.mag) ? (mag.anomaly ? "异常" : "背景") : sensors.mag.note || "未接入"} accent={mag.anomaly} />
        <Metric label="ΔB" value={magBaseline !== null && Number.isFinite(mag.mag) ? `${(mag.mag - magBaseline).toFixed(1)} μT` : "—"} hint={magBaseline !== null ? `基线 ${magBaseline.toFixed(1)}` : ""} />
        <Metric label="航向" value={sensors.orient.state === "live" || pose.source === "twin" ? `${pose.headingDeg.toFixed(0)}°` : "—"} hint={sensors.orient.note || (sensors.orient.state === "live" ? "罗盘" : "无读数")} />
        <Metric label="步数" value={String(steps)} hint={`${trajLen.toFixed(1)} m`} />
        <Metric label="环境光" value={lightLux != null ? `${lightLux.toFixed(0)} lx` : "—"} hint={sensors.light.state === "live" ? "" : "传感器未接入"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>磁力计</CardTitle>
            <SourceBadge source={mag.source} />
          </CardHeader>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Axis k="X" v={mag.x} unit="μT" ok={mag.source !== "none"} />
            <Axis k="Y" v={mag.y} unit="μT" ok={mag.source !== "none"} />
            <Axis k="Z" v={mag.z} unit="μT" ok={mag.source !== "none"} />
          </div>
          <div className="mt-3">
            <Spark data={magXHist} label="X" unit="μT" />
            <Spark data={magYHist} stroke="var(--color-live)" label="Y" unit="μT" />
            <Spark data={magZHist} stroke="var(--color-warn)" label="Z" unit="μT" />
            <Spark data={magHist} label="|B|" unit="μT" />
          </div>
          {metal ? (
            <p className="mt-3 text-sm">
              最近金属（模拟场景） <span className="text-fg">{metal.name}</span>
              <span className="ml-2 font-mono text-muted">{metal.dist.toFixed(2)} m</span>
            </p>
          ) : null}
          <p className="mt-3 text-xs text-muted">
            自适应基线 + 稳健 σ：偏离超过 max(3 μT, 4σ) 才报警，异常期间基线冻结，不会被金属“学走”。手机自身磁性/保护壳会抬高背景。
          </p>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Wi-Fi 链路</CardTitle>
            <SourceBadge source={wifi.source} />
          </CardHeader>
          {wifi.source === "none" ? (
            <p className="text-sm text-muted">
              网页无法读取 Wi-Fi RSSI 或 CSI（浏览器沙箱限制），所以这里没有真实数据。切换到演示模式可查看模拟的穿墙扰动。要真实 RSSI 需要 Android 原生/Termux 桥接。
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Axis k="RSSI" v={wifi.rssi} unit="dBm" ok />
                <Axis k="σ" v={wifi.sigma} ok />
                <div className="rounded-md bg-raised px-2 py-2 text-center">
                  <div className="text-[10px] uppercase tracking-widest text-faint">状态</div>
                  <Badge tone={wifi.throughWall ? "warn" : "mute"}>{wifi.throughWall ? "扰动" : "稳定"}</Badge>
                </div>
              </div>
              <div className="mt-3">
                <Wave data={rssiHist} unit="dBm" digits={1} xLabel="模拟数据" />
              </div>
              <p className="mt-3 text-xs text-muted">路径损耗 + 墙体衰减 + 人体遮挡写入物理孪生；σ &gt; 2.5 判定扰动。</p>
            </>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>IMU</CardTitle>
            <SourceBadge source={imu.source} />
          </CardHeader>
          <div className="grid grid-cols-3 gap-2">
            <Axis k="ax" v={imu.ax} unit="m/s²" ok={imu.source !== "none"} />
            <Axis k="ay" v={imu.ay} unit="m/s²" ok={imu.source !== "none"} />
            <Axis k="az" v={imu.az} unit="m/s²" ok={imu.source !== "none"} />
            <Axis k="绕 x" v={imu.gx} unit="°/s" ok={imu.source !== "none"} />
            <Axis k="绕 y" v={imu.gy} unit="°/s" ok={imu.source !== "none"} />
            <Axis k="绕 z" v={imu.gz} unit="°/s" ok={imu.source !== "none"} />
          </div>
          <p className="mt-2 font-mono text-[11px] text-muted">|a| = {fmt(accel, 2, "m/s²")}（静止应 ≈ 9.8）</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
            <Compass className="size-3.5" />
            步长 {stepLen.toFixed(2)} m
            <Button size="sm" variant="outline" onClick={resetPdr}>
              PDR 清零
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted">计步：加速度模量低通 + 自适应阈值 + 最小间隔 0.28 s。航迹误差随距离累积（约 3–10%），长距离需重新校准。</p>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>蓝牙设备</CardTitle>
            <CardHint>{bt.length} 台</CardHint>
          </CardHeader>
          {bt.length === 0 ? (
            <p className="text-sm text-muted">还没有配对设备。点「扫描蓝牙」并在系统弹窗里选择一台设备。</p>
          ) : (
            <ul className="space-y-2">
              {bt.map((d) => (
                <li key={d.id} className="flex items-center justify-between rounded-md bg-raised px-3 py-2">
                  <div>
                    <div className="text-sm">{d.name}</div>
                    <div className="font-mono text-[11px] text-faint">{d.rssi !== null ? `${d.rssi} dBm` : "无 RSSI 广播"}</div>
                  </div>
                  <SourceBadge source={d.source} />
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">Web Bluetooth 必须由点击触发，无法后台静默扫描；RSSI 仅在设备正在广播且浏览器支持 watchAdvertisements 时可得。</p>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>定位 GNSS</CardTitle>
          <SourceBadge source={geo.source} />
        </CardHeader>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="纬度" value={Number.isFinite(geo.lat) ? geo.lat.toFixed(5) : "—"} />
          <Metric label="经度" value={Number.isFinite(geo.lng) ? geo.lng.toFixed(5) : "—"} />
          <Metric label="精度" value={Number.isFinite(geo.accuracy) ? `±${geo.accuracy.toFixed(0)} m` : "—"} />
          <Metric label="状态" value={sensors.geo.state} hint={sensors.geo.note} />
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-muted">
          <MapPin className="size-3.5" /> 定位仅用于显示，不参与室内航迹（室内 GNSS 精度不足）。点「启用传感器」后才会请求定位权限。
        </p>
      </Card>
    </div>
  );
}

function Axis({ k, v, unit, ok = true }: { k: string; v: number; unit?: string; ok?: boolean }) {
  return (
    <div className="rounded-md bg-raised px-2 py-2 text-center">
      <div className="text-[10px] uppercase tracking-widest text-faint">{k}</div>
      <div className="font-mono text-sm tabular">{ok && Number.isFinite(v) ? v.toFixed(2) : "—"}</div>
      {unit ? <div className="text-[10px] text-faint">{unit}</div> : null}
    </div>
  );
}
