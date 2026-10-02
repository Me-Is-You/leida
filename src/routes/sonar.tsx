import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/panels/page-header";
import { Metric, SourceBadge } from "@/components/panels/metric";
import { Trace, Wave } from "@/components/charts/trace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardHint, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { speedOfSound } from "@/lib/core/dsp.ts";
import { audioLatencyInfo, buildChirpPreview, chirpEnvelopePreview } from "@/lib/sonar";
import { effectiveSonar, useRadar } from "@/lib/radar-store";
import { formatMeters, formatUs } from "@/lib/utils";
import { Waves } from "lucide-react";

export const Route = createFileRoute("/sonar")({ component: SonarPage });

const HINTS: Record<string, string> = {
  "no-direct":
    "没有听到自己发出的 chirp。常见原因：媒体音量太低；系统/浏览器仍在对麦克风做回声消除或降噪；手机喇叭/麦克风对 18 kHz 以上衰减严重；手指或保护壳挡住了底部喇叭/麦克风孔。",
  "no-echo": "听到了直达声，但在量程内没有足够强的回波。对准 0.3–4 m 外的硬质平整表面（墙、柜门）再试，或降低「最小 SNR」。",
  error: "",
};

function SonarPage() {
  const ping = useRadar((s) => s.ping);
  const busy = useRadar((s) => s.sonarBusy);
  const sonar = useRadar(effectiveSonar);
  const lastReal = useRadar((s) => s.sonar);
  const autoPing = useRadar((s) => s.autoPing);
  const setAutoPing = useRadar((s) => s.setAutoPing);
  const history = useRadar((s) => s.pingHistory);
  const sonarHist = useRadar((s) => s.sonarHist);
  const settings = useRadar((s) => s.settings);
  const update = useRadar((s) => s.updateSettings);
  const calibrate = useRadar((s) => s.calibrateSonar);
  const micState = useRadar((s) => s.sensors.mic);
  const [known, setKnown] = useState("1.00");
  const [calMsg, setCalMsg] = useState("");
  const [calBusy, setCalBusy] = useState(false);

  const chirp = useMemo(() => buildChirpPreview(), []);
  const env = useMemo(() => chirpEnvelopePreview(), []);
  const c = speedOfSound(settings.sonarTempC);
  const lat = audioLatencyInfo();
  const real = sonar?.source === "device";
  const trace = lastReal?.trace ?? sonar?.trace ?? [];
  const markers =
    lastReal?.echoes.map((e) => Math.min(1, Math.max(0, (2 * e.distM - settings.sonarSpacingM) / (2 * settings.sonarMaxRangeM - settings.sonarSpacingM)))) ?? [];
  const failed = lastReal && lastReal.status !== "ok" ? lastReal : null;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader
        kicker="Sonar"
        title="主动声呐"
        hint="手机喇叭发出 18–21.5 kHz 线性调频，麦克风录音后做匹配滤波。以直达声为时间零点，所以不需要知道系统音频延迟。没听到回波就显示「—」，不会编造数字。"
        actions={
          <>
            <Button onClick={() => void ping()} disabled={busy}>
              <Waves /> {busy ? "测量中…" : settings.sonarAverage > 1 ? `发射 ×${settings.sonarAverage}` : "发射脉冲"}
            </Button>
            <label className="flex h-10 items-center gap-2 rounded-sm px-3 text-sm shadow-[var(--shadow-border)]">
              自动 · {settings.autoPingSec}s
              <Switch checked={autoPing} onCheckedChange={setAutoPing} />
            </label>
          </>
        }
      />

      {failed ? (
        <Card className="border-warn/30 bg-warn/5">
          <p className="text-sm text-warn">{failed.message}</p>
          {HINTS[failed.status] ? <p className="mt-1 text-xs text-muted">{HINTS[failed.status]}</p> : null}
          {failed.micRaw === false ? (
            <p className="mt-1 text-xs text-warn">浏览器没有关闭回声消除/降噪（getSettings 报告为开启）。这会直接抹掉超声 chirp。</p>
          ) : null}
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <Metric
          label="距离"
          value={formatMeters(sonar?.distM ?? null)}
          accent={real}
          hint={real ? "真实测量" : "按「发射脉冲」测量"}
        />
        <Metric label="置信度" value={sonar ? `${(sonar.confidence * 100).toFixed(0)}%` : "—"} />
        <Metric label="回波 SNR" value={sonar && sonar.status === "ok" ? `${sonar.snrDb.toFixed(1)} dB` : "—"} />
        <Metric label="直达声 SNR" value={lastReal ? `${lastReal.directSnrDb.toFixed(0)} dB` : "—"} hint="喇叭→麦克风" />
        <Metric label="额外时延" value={formatUs(sonar?.dtUs ?? null)} hint="回波 − 直达" />
        <Metric
          label="有效脉冲"
          value={sonar ? `${sonar.accepted}/${sonar.pings}` : "—"}
          hint={sonar?.sigmaM != null ? `σ ${(sonar.sigmaM * 100).toFixed(1)} cm` : ""}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>回波包络</CardTitle>
            <CardHint>0 → {settings.sonarMaxRangeM.toFixed(1)} m · 竖线 = 检测到的回波</CardHint>
          </CardHeader>
          <Trace
            data={trace}
            markers={markers}
            xLabels={["0 m", `${(settings.sonarMaxRangeM / 2).toFixed(1)}`, `${settings.sonarMaxRangeM.toFixed(1)} m`]}
          />
          <p className="mt-3 font-mono text-[11px] text-faint">
            {lastReal ? `${new Date(lastReal.t).toLocaleTimeString("zh-CN", { hour12: false })} · ${lastReal.message}` : "等待脉冲"}
          </p>
          {lastReal && lastReal.echoes.length > 1 ? (
            <p className="mt-1 text-xs text-muted">
              其他回波：{lastReal.echoes.slice(1, 5).map((e) => `${e.distM.toFixed(2)} m (${e.snrDb.toFixed(0)} dB)`).join(" · ")}
            </p>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>发射信号</CardTitle>
            <CardHint>18 → 21.5 kHz · 45 ms · Hann</CardHint>
          </CardHeader>
          <p className="mb-1 text-[10px] uppercase tracking-widest text-faint">波形（中段 4.5 ms，原始采样）</p>
          <Wave data={chirp} digits={2} />
          <p className="mb-1 mt-3 text-[10px] uppercase tracking-widest text-faint">包络（45 ms）</p>
          <Wave data={env} stroke="var(--color-live)" digits={2} xLabel="0 → 45 ms" />
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] text-muted">
            <dt>声速 c</dt>
            <dd className="text-right text-fg">{c.toFixed(1)} m/s @ {settings.sonarTempC} °C</dd>
            <dt>理论距离分辨率</dt>
            <dd className="text-right text-fg">{((c / (2 * 3500)) * 100).toFixed(1)} cm（c / 2B）</dd>
            <dt>麦克风原始模式</dt>
            <dd className="text-right text-fg">{lastReal?.micRaw == null ? "未测" : lastReal.micRaw ? "是（回声消除/降噪/AGC 已关）" : "否 ⚠"}</dd>
            <dt>音频上下文</dt>
            <dd className="text-right text-fg">{lat ? `${lat.sampleRate} Hz · 输出延迟 ${lat.outputLatencyMs.toFixed(0)} ms` : "未启动"}</dd>
            <dt>麦克风通道</dt>
            <dd className="text-right text-fg">{micState.state}{micState.note ? ` · ${micState.note}` : ""}</dd>
          </dl>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>参数</CardTitle>
            <CardHint>自动保存</CardHint>
          </CardHeader>
          <div className="space-y-4">
            <Setting label="环境温度" value={`${settings.sonarTempC.toFixed(0)} °C`} note={`c = ${c.toFixed(1)} m/s；温度差 10 °C ≈ 1.7% 距离误差`}>
              <Slider min={-10} max={45} step={1} value={[settings.sonarTempC]} onValueChange={(v) => update({ sonarTempC: v[0] ?? 22 })} />
            </Setting>
            <Setting label="喇叭—麦克风间距" value={`${(settings.sonarSpacingM * 100).toFixed(1)} cm`} note="底部喇叭到底部麦克风，约 3–8 cm；可用下方校准自动求得">
              <Slider min={0} max={0.2} step={0.005} value={[settings.sonarSpacingM]} onValueChange={(v) => update({ sonarSpacingM: v[0] ?? 0.06 })} />
            </Setting>
            <Setting label="最大量程" value={`${settings.sonarMaxRangeM.toFixed(1)} m`} note="越大，每次录音处理越久，远处噪声也更多">
              <Slider min={1} max={8} step={0.5} value={[settings.sonarMaxRangeM]} onValueChange={(v) => update({ sonarMaxRangeM: v[0] ?? 5 })} />
            </Setting>
            <Setting label="最小 SNR" value={`${settings.sonarMinSnrDb.toFixed(0)} dB`} note="回波必须高出本底噪声这么多才算命中；调低更灵敏但会误报">
              <Slider min={3} max={24} step={1} value={[settings.sonarMinSnrDb]} onValueChange={(v) => update({ sonarMinSnrDb: v[0] ?? 8 })} />
            </Setting>
            <Setting label="平均次数" value={`${settings.sonarAverage}`} note="多次发射取中位数，抑制偶发误检；每次约 0.7 s">
              <Slider min={1} max={5} step={1} value={[settings.sonarAverage]} onValueChange={(v) => update({ sonarAverage: v[0] ?? 1 })} />
            </Setting>
            <Setting label="发射增益" value={`${(settings.sonarGain * 100).toFixed(0)}%`} note="不要超过必要音量；18 kHz 以上多数成年人听不到，但宠物和部分年轻人可能听到">
              <Slider min={0.1} max={1} step={0.05} value={[settings.sonarGain]} onValueChange={(v) => update({ sonarGain: v[0] ?? 0.8 })} />
            </Setting>
            <Setting label="自动间隔" value={`${settings.autoPingSec} s`}>
              <Slider min={1} max={15} step={1} value={[settings.autoPingSec]} onValueChange={(v) => update({ autoPingSec: v[0] ?? 3 })} />
            </Setting>
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>校准</CardTitle>
              <CardHint>一次对准即可</CardHint>
            </CardHeader>
            <p className="text-xs text-muted">
              把手机底部对准一面平整的墙，用卷尺量出到墙的距离，填入下面再点校准。程序会发射 3 次以上并反推喇叭—麦克风间距。
            </p>
            <div className="mt-3 flex items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                min={0.2}
                max={5}
                step={0.01}
                value={known}
                onChange={(e) => setKnown(e.target.value)}
                className="h-10 w-28 rounded-sm bg-raised px-3 font-mono text-sm shadow-[var(--shadow-border)]"
                aria-label="已知距离（米）"
              />
              <span className="text-sm text-muted">m</span>
              <Button
                variant="outline"
                disabled={calBusy || busy}
                onClick={async () => {
                  const k = Number.parseFloat(known);
                  if (!Number.isFinite(k) || k < 0.2 || k > 5) {
                    setCalMsg("请输入 0.2–5 m 之间的距离");
                    return;
                  }
                  setCalBusy(true);
                  setCalMsg(await calibrate(k));
                  setCalBusy(false);
                }}
              >
                {calBusy ? "校准中…" : "校准间距"}
              </Button>
            </div>
            {calMsg ? <p className="mt-2 text-xs text-muted">{calMsg}</p> : null}
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>距离历史</CardTitle>
              <CardHint>每次有效脉冲</CardHint>
            </CardHeader>
            <Wave data={sonarHist} stroke="var(--color-live)" unit="m" xLabel={`最近 ${sonarHist.length} 次`} />
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>脉冲日志</CardTitle>
          <CardHint>最近 {history.length}</CardHint>
        </CardHeader>
        {history.length === 0 ? (
          <p className="text-sm text-muted">点击发射脉冲。首次会请求麦克风权限（需要 HTTPS）。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-widest text-faint">
                <tr>
                  <th className="py-2 font-medium">时间</th>
                  <th className="py-2 font-medium">结果</th>
                  <th className="py-2 font-medium">距离</th>
                  <th className="py-2 font-medium">SNR</th>
                  <th className="py-2 font-medium">有效</th>
                  <th className="py-2 font-medium">通道</th>
                </tr>
              </thead>
              <tbody>
                {history.map((p, i) => (
                  <tr key={`${p.t}-${i}`} className="border-t border-line">
                    <td className="py-2 font-mono text-xs tabular">{new Date(p.t).toLocaleTimeString("zh-CN", { hour12: false })}</td>
                    <td className="py-2">
                      <Badge tone={p.status === "ok" ? "live" : "warn"}>{p.status}</Badge>
                    </td>
                    <td className="py-2 font-mono tabular">{formatMeters(p.distM)}</td>
                    <td className="py-2 font-mono tabular">{p.status === "ok" ? `${p.snrDb.toFixed(1)} dB` : "—"}</td>
                    <td className="py-2 font-mono tabular">{p.accepted}/{p.pings}</td>
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

function Setting({ label, value, note, children }: { label: string; value: string; note?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-sm">{label}</span>
        <span className="font-mono text-xs text-muted tabular">{value}</span>
      </div>
      {children}
      {note ? <p className="mt-1 text-[11px] text-faint">{note}</p> : null}
    </div>
  );
}
