import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/panels/page-header";
import { Metric } from "@/components/panels/metric";
import { WeightBar } from "@/components/panels/weight-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardHint, CardTitle } from "@/components/ui/card";
import { Wave } from "@/components/charts/trace";
import { FUSION_MODES } from "@/lib/hardware";
import { envWeights } from "@/lib/core/env-weights.ts";
import { useRadar } from "@/lib/radar-store";
import { ENV_LABEL, type EnvMode } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/environment")({ component: EnvPage });

function EnvPage() {
  const env = useRadar((s) => s.env);
  const envManual = useRadar((s) => s.envManual);
  const setEnv = useRadar((s) => s.setEnv);
  const vision = useRadar((s) => s.vision);
  const wifi = useRadar((s) => s.wifi);
  const fusion = useRadar((s) => s.fusion);
  const brightHist = useRadar((s) => s.brightHist);
  const lightLux = useRadar((s) => s.lightLux);
  const nightVision = useRadar((s) => s.settings.nightVision);
  const hdr = useRadar((s) => s.settings.hdr);
  const updateSettings = useRadar((s) => s.updateSettings);
  const setNight = (v: boolean) => updateSettings({ nightVision: v });
  const setHdr = (v: boolean) => updateSettings({ hdr: v });
  const f = (v: number | null, d = 0) => (v === null ? "—" : v.toFixed(d));

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader
        kicker="Environment"
        title="环境自适应"
        hint="画面亮度 / 纹理 / 对比度、环境光传感器（若有）共同分类场景，带 8 帧滞回防抖，并改写距离融合中各来源的权重。"
        actions={
          <Button size="sm" variant={envManual === "auto" ? "accent" : "outline"} onClick={() => setEnv("auto")}>
            AUTO
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Metric label="当前" value={ENV_LABEL[env]} hint={envManual === "auto" ? "自适应" : "已锁定"} accent />
        <Metric label="亮度" value={f(vision.brightness)} hint={lightLux != null ? `${lightLux.toFixed(0)} lx` : vision.brightness === null ? "需要相机" : "帧均值 0–255"} />
        <Metric label="纹理" value={f(vision.texture, 2)} hint="边缘密度" />
        <Metric label="对比度" value={f(vision.noise, 1)} hint={`画面运动 ${f(vision.motion, 3)}`} />
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <ModeCard
          id="auto"
          label="AUTO"
          active={envManual === "auto"}
          range="分类器"
          detect="亮度 / 纹理 / σ"
          onClick={() => setEnv("auto")}
        />
        {FUSION_MODES.map((m) => (
          <ModeCard
            key={m.id}
            id={m.id}
            label={m.label}
            active={envManual === m.id}
            current={env === m.id}
            range={m.range}
            detect={m.detect}
            onClick={() => setEnv(m.id as EnvMode)}
          />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>融合权重</CardTitle>
            <CardHint>{ENV_LABEL[env]}</CardHint>
          </CardHeader>
          <WeightBar weights={fusion} />
          <p className="mt-4 text-xs text-muted">
            权重放大/缩小各来源在距离融合里的置信度。暗光时视觉下降、声呐上升；强光/室外相反。可手动锁定模式。
          </p>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>光学状态</CardTitle>
            <CardHint>
              {wifi.source === "none"
                ? "无 Wi-Fi 通道（需 Termux 桥接）"
                : `RSSI ${wifi.rssi.toFixed(0)} dBm · σ ${Number.isFinite(wifi.sigma) ? wifi.sigma.toFixed(2) : "—"}`}
            </CardHint>
          </CardHeader>
          <Wave data={brightHist} digits={0} xLabel="帧亮度 0–255" />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant={nightVision ? "accent" : "outline"} onClick={() => setNight(!nightVision)}>
              夜视 {nightVision ? "开" : "关"}
            </Button>
            <Button size="sm" variant={hdr ? "accent" : "outline"} onClick={() => setHdr(!hdr)}>
              HDR {hdr ? "开" : "关"}
            </Button>
            {wifi.source === "device" ? (
              <Badge tone={wifi.disturbed ? "warn" : "mute"}>
                {wifi.disturbed ? "Wi-Fi 链路扰动" : "Wi-Fi 链路平稳"}
              </Badge>
            ) : null}
          </div>
          <ul className="mt-4 space-y-1 text-xs text-muted">
            {FUSION_MODES.map((m) => (
              <li key={m.id} className="flex justify-between font-mono">
                <span>{m.label}</span>
                <span>
                  V{(envWeights(m.id as EnvMode).vision * 100).toFixed(0)} S
                  {(envWeights(m.id as EnvMode).sonar * 100).toFixed(0)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function ModeCard({
  id,
  label,
  active,
  current,
  range,
  detect,
  onClick,
}: {
  id: string;
  label: string;
  active: boolean;
  current?: boolean;
  range: string;
  detect: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl p-4 text-left shadow-[var(--shadow-border)] transition-[box-shadow,background-color] duration-150",
        active ? "bg-raised shadow-[var(--shadow-border-hover)]" : "bg-surface hover:shadow-[var(--shadow-border-hover)]",
      )}
    >
      <div className="flex items-center justify-between">
        <span className="font-display text-sm font-medium">{label}</span>
        {current ? <Badge tone="live">live</Badge> : null}
      </div>
      <p className="mt-2 text-xs text-muted">{range}</p>
      <p className="mt-1 text-[11px] text-faint">{detect}</p>
      <span className="sr-only">{id}</span>
    </button>
  );
}
