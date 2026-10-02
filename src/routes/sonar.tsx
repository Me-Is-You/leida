import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/panels/page-header";
import { Metric, SourceBadge } from "@/components/panels/metric";
import { Trace, Wave } from "@/components/charts/trace";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardHint, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { buildChirpPreview } from "@/lib/sonar";
import { useRadar } from "@/lib/radar-store";
import { formatMeters, formatUs } from "@/lib/utils";
import { Waves } from "lucide-react";
import { useMemo } from "react";

export const Route = createFileRoute("/sonar")({ component: SonarPage });

function SonarPage() {
  const ping = useRadar((s) => s.ping);
  const sonar = useRadar((s) => s.sonar);
  const autoPing = useRadar((s) => s.autoPing);
  const setAutoPing = useRadar((s) => s.setAutoPing);
  const history = useRadar((s) => s.pingHistory);
  const sonarHist = useRadar((s) => s.sonarHist);
  const sar = useRadar((s) => s.sar);
  const trajLen = useRadar((s) => s.trajLen);
  const mapping = useRadar((s) => s.mapping);
  const chirp = useMemo(() => buildChirpPreview(), []);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader
        kicker="Sonar"
        title="微秒声呐"
        hint="18–21.5 kHz chirp，Hann 窗，麦克风互相关。d = Δt × 343 / 2。无授权时使用场景射线孪生回波。"
        actions={
          <>
            <Button onClick={() => void ping()}>
              <Waves /> 发射脉冲
            </Button>
            <label className="flex h-10 items-center gap-2 rounded-sm px-3 text-sm shadow-[var(--shadow-border)]">
              自动
              <Switch checked={autoPing} onCheckedChange={setAutoPing} />
            </label>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Metric label="距离" value={formatMeters(sonar?.distM ?? null)} accent />
        <Metric label="时延" value={sonar ? formatUs(sonar.dtUs) : "—"} hint="往返" />
        <Metric label="滞后" value={sonar ? `${sonar.lagSamples}` : "—"} hint="samples @ 48 kHz" />
        <Metric
          label="峰值"
          value={sonar ? sonar.peak.toFixed(3) : "—"}
          hint={sonar ? (sonar.source === "device" ? "互相关" : "孪生") : ""}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>回波迹</CardTitle>
            <CardHint>主峰 + 多径</CardHint>
          </CardHeader>
          <Trace data={sonar?.trace ?? []} />
          <p className="mt-3 font-mono text-[11px] text-faint">
            {sonar ? `${sonar.source} · ${new Date(sonar.t).toLocaleTimeString("zh-CN", { hour12: false })}` : "等待脉冲"}
          </p>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>发射 chirp</CardTitle>
            <CardHint>18 kHz → 21.5 kHz · 45 ms</CardHint>
          </CardHeader>
          <Wave data={chirp} />
          <div className="mt-3">
            <label className="text-[10px] uppercase tracking-widest text-faint">距离历史</label>
            <Wave data={sonarHist} stroke="var(--color-live)" />
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>合成孔径 SAR</CardTitle>
          <CardHint>δ = λR / 2L · λ ≈ 1.7 cm @ 20 kHz</CardHint>
        </CardHeader>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="孔径 L" value={`${sar.L.toFixed(2)} m`} hint={mapping ? "建图中累积" : "开始建图以拉长孔径"} />
          <Metric label="斜距 R" value={`${sar.R.toFixed(2)} m`} />
          <Metric label="分辨率 δ" value={`${(sar.delta * 100).toFixed(1)} cm`} />
          <Metric label="轨迹" value={`${trajLen.toFixed(2)} m`} />
        </div>
        <p className="mt-3 text-xs text-muted">
          沿 IMU 轨迹相干叠加的思路：孔径越长，方位向越细。本站给出解析分辨率上界，不假装已做完整后向投影成像。
        </p>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>脉冲日志</CardTitle>
          <CardHint>最近 {history.length}</CardHint>
        </CardHeader>
        {history.length === 0 ? (
          <p className="text-sm text-muted">点击发射脉冲。首次会请求麦克风权限。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-widest text-faint">
                <tr>
                  <th className="py-2 font-medium">时间</th>
                  <th className="py-2 font-medium">距离</th>
                  <th className="py-2 font-medium">Δt</th>
                  <th className="py-2 font-medium">通道</th>
                </tr>
              </thead>
              <tbody>
                {history.map((p, i) => (
                  <tr key={`${p.t}-${i}`} className="border-t border-line">
                    <td className="py-2 font-mono text-xs tabular">
                      {new Date(p.t).toLocaleTimeString("zh-CN", { hour12: false })}
                    </td>
                    <td className="py-2 font-mono tabular">{formatMeters(p.distM)}</td>
                    <td className="py-2 font-mono tabular">{formatUs(p.dtUs)}</td>
                    <td className="py-2">
                      <SourceBadge source={p.source} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
