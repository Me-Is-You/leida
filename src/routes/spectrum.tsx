import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/panels/page-header";
import { Metric, SourceBadge } from "@/components/panels/metric";
import { Wave } from "@/components/charts/trace";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardHint, CardTitle } from "@/components/ui/card";
import { Spark } from "@/components/charts/spark";
import { nearestMetal } from "@/lib/fusion";
import { observerPose } from "@/lib/engine";
import { useRadar } from "@/lib/radar-store";
import { Compass, Radio } from "lucide-react";

export const Route = createFileRoute("/spectrum")({ component: SpectrumPage });

function SpectrumPage() {
  const wifi = useRadar((s) => s.wifi);
  const mag = useRadar((s) => s.mag);
  const imu = useRadar((s) => s.imu);
  const bt = useRadar((s) => s.bt);
  const objects = useRadar((s) => s.objects);
  const t = useRadar((s) => s.t);
  const rssiHist = useRadar((s) => s.rssiHist);
  const magHist = useRadar((s) => s.magHist);
  const magXHist = useRadar((s) => s.magXHist);
  const magYHist = useRadar((s) => s.magYHist);
  const magZHist = useRadar((s) => s.magZHist);
  const scanBt = useRadar((s) => s.scanBt);
  const heading = useRadar((s) => s.heading);
  const lightLux = useRadar((s) => s.lightLux);
  const realFlags = useRadar((s) => s.realFlags);
  const metal = nearestMetal(observerPose(t).pos, objects);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader
        kicker="Spectrum"
        title="电磁频谱"
        hint="Wi-Fi 穿墙用 RSSI 方差，磁场嗅探金属，蓝牙需用户手势。浏览器不开放 CSI 与原生 RSSI。"
        actions={
          <Button onClick={() => void scanBt()}>
            <Radio /> 扫描蓝牙
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Metric label="RSSI" value={`${wifi.rssi.toFixed(1)} dBm`} hint={wifi.ssid} />
        <Metric label="σ" value={wifi.sigma.toFixed(2)} hint={wifi.throughWall ? "穿墙" : "视距"} accent={wifi.throughWall} />
        <Metric label="|B|" value={`${mag.mag.toFixed(1)} μT`} hint={mag.anomaly ? "异常" : "背景"} accent={mag.anomaly} />
        <Metric label="航向" value={`${heading.toFixed(0)}°`} hint={realFlags.orient ? "罗盘" : "孪生"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Wi-Fi 7 链路</CardTitle>
            <SourceBadge source={wifi.source} />
          </CardHeader>
          <p className="text-sm text-muted">
            路径损耗 + 墙体衰减 + 人体遮挡写入物理孪生。σ > 2.5 判定穿墙扰动。真机 dumpsys 需 Root，浏览器拿不到 RSSI。
          </p>
          <div className="mt-3">
            <Wave data={rssiHist} />
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>磁力计</CardTitle>
            <SourceBadge source={mag.source} />
          </CardHeader>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Axis k="X" v={mag.x} />
            <Axis k="Y" v={mag.y} />
            <Axis k="Z" v={mag.z} />
          </div>
          <div className="mt-3 space-y-1">
            <Spark data={magXHist} />
            <Spark data={magYHist} stroke="var(--color-live)" />
            <Spark data={magZHist} stroke="var(--color-warn)" />
            <Spark data={magHist} />
          </div>
          {metal ? (
            <p className="mt-3 text-sm">
              最近金属 <span className="text-fg">{metal.name}</span>
              <span className="ml-2 font-mono text-muted">{metal.dist.toFixed(2)} m</span>
            </p>
          ) : null}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>IMU</CardTitle>
            <SourceBadge source={imu.source} />
          </CardHeader>
          <div className="grid grid-cols-3 gap-2">
            <Axis k="ax" v={imu.ax} unit="m/s²" />
            <Axis k="ay" v={imu.ay} unit="m/s²" />
            <Axis k="az" v={imu.az} unit="m/s²" />
            <Axis k="gx" v={imu.gx} unit="°/s" />
            <Axis k="gy" v={imu.gy} unit="°/s" />
            <Axis k="gz" v={imu.gz} unit="°/s" />
          </div>
          <p className="mt-3 flex items-center gap-2 text-xs text-muted">
            <Compass className="size-3.5" />
            Chrome Android 可走 Generic Sensor；iOS 需用户手势授权 DeviceMotion。
          </p>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>蓝牙设备</CardTitle>
            <CardHint>{bt.length} 台</CardHint>
          </CardHeader>
          <ul className="space-y-2">
            {bt.map((d) => (
              <li key={d.id} className="flex items-center justify-between rounded-md bg-raised px-3 py-2">
                <div>
                  <div className="text-sm">{d.name}</div>
                  <div className="font-mono text-[11px] text-faint">{d.rssi} dBm</div>
                </div>
                <SourceBadge source={d.source} />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Web Bluetooth 必须由点击触发，且无法静默扫描。环境光
            {lightLux != null ? ` ${lightLux.toFixed(0)} lx` : " 传感器未接入"}。
          </p>
        </Card>
      </div>
    </div>
  );
}

function Axis({ k, v, unit }: { k: string; v: number; unit?: string }) {
  return (
    <div className="rounded-md bg-raised px-2 py-2 text-center">
      <div className="text-[10px] uppercase tracking-widest text-faint">{k}</div>
      <div className="font-mono text-sm tabular">{v.toFixed(2)}</div>
      {unit ? <div className="text-[10px] text-faint">{unit}</div> : null}
    </div>
  );
}
