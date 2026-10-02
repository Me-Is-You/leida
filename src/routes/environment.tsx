import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/panels/page-header";
import { Metric } from "@/components/panels/metric";
import { WeightBar } from "@/components/panels/weight-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardHint, CardTitle } from "@/components/ui/card";
import { Wave } from "@/components/charts/trace";
import { FUSION_MODES } from "@/lib/hardware";
import { envWeights } from "@/lib/engine";
import { useRadar } from "@/lib/radar-store";
import { ENV_LABEL, type EnvMode } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/environment")({ component: EnvPage });

function EnvPage() {
  const env = useRadar((s) => s.env);
  const envManual = useRadar((s) => s.envManual);
  const setEnv = useRadar((s) => s.setEnv);
  const brightness = useRadar((s) => s.brightness);
  const texture = useRadar((s) => s.texture);
  const noise = useRadar((s) => s.noise);
  const motion = useRadar((s) => s.motion);
  const wifi = useRadar((s) => s.wifi);
  const fusion = useRadar((s) => s.fusion);
  const brightHist = useRadar((s) => s.brightHist);
  const lightLux = useRadar((s) => s.lightLux);
  const nightVision = useRadar((s) => s.nightVision);
  const setNight = useRadar((s) => s.setNight);
  const hdr = useRadar((s) => s.hdr);
  const setHdr = useRadar((s) => s.setHdr);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader
        kicker="Environment"
        title="环境自适应"
        hint="亮度、纹理、噪声、RSSI 方差共同分类场景，并改写五模态融合权重。"
        actions={
          <Button size="sm" variant={envManual === "auto" ? "accent" : "outline"} onClick={() => setEnv("auto")}>
            AUTO
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Metric label="当前" value={ENV_LABEL[env]} hint={envManual === "auto" ? "自适应" : "已锁定"} accent />
        <Metric label="亮度" value={brightness.toFixed(0)} hint={lightLux != null ? `${lightLux.toFixed(0)} lx` : "帧均值"} />
        <Metric label="纹理" value={texture.toFixed(2)} />
        <Metric label="噪声" value={noise.toFixed(1)} hint={`运动 ${motion.toFixed(2)}`} />
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
            穿墙时磁场与 Wi-Fi 上升、视觉下降；室外相反。权重来自场景分类，可手动锁定。
          </p>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>光学状态</CardTitle>
            <CardHint>σ {wifi.sigma.toFixed(2)}</CardHint>
          </CardHeader>
          <Wave data={brightHist} />
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant={nightVision ? "accent" : "outline"} onClick={() => setNight(!nightVision)}>
              夜视 {nightVision ? "开" : "关"}
            </Button>
            <Button size="sm" variant={hdr ? "accent" : "outline"} onClick={() => setHdr(!hdr)}>
              HDR {hdr ? "开" : "关"}
            </Button>
            <Badge tone={wifi.throughWall ? "warn" : "mute"}>{wifi.throughWall ? "穿墙扰动" : "视距"}</Badge>
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
