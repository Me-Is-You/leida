import { createFileRoute } from "@tanstack/react-router";
import { useRef } from "react";
import { RadarCanvas } from "@/components/radar/radar-canvas";
import { PageHeader } from "@/components/panels/page-header";
import { Metric } from "@/components/panels/metric";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cloud, useRadar } from "@/lib/radar-store";
import type { MapPointKind, ViewPreset } from "@/lib/types";
import { downloadJson, downloadText } from "@/lib/utils";
import { Box, Download, Eraser, Grid3x3, MapPinned, Upload } from "lucide-react";

export const Route = createFileRoute("/map")({ component: MapPage });

const KINDS: { id: MapPointKind; label: string }[] = [
  { id: "person", label: "人物" },
  { id: "object", label: "物品" },
  { id: "wall", label: "墙" },
  { id: "free", label: "自由" },
  { id: "traj", label: "轨迹" },
  { id: "sonar", label: "声呐" },
];

const VIEWS: { id: ViewPreset; label: string }[] = [
  { id: "iso", label: "轴测" },
  { id: "top", label: "俯视" },
  { id: "follow", label: "跟随" },
];

function MapPage() {
  const mapping = useRadar((s) => s.mapping);
  const toggleMapping = useRadar((s) => s.toggleMapping);
  const clearMap = useRadar((s) => s.clearMap);
  const trajectory = useRadar((s) => s.trajectory);
  const meshOn = useRadar((s) => s.meshOn);
  const setMesh = useRadar((s) => s.setMesh);
  const exploredM2 = useRadar((s) => s.exploredM2);
  const trajLen = useRadar((s) => s.trajLen);
  const steps = useRadar((s) => s.steps);
  const kindFilter = useRadar((s) => s.settings.kindFilter);
  const setKindFilter = useRadar((s) => s.setKindFilter);
  const exportSession = useRadar((s) => s.exportSession);
  const importSession = useRadar((s) => s.importSession);
  const viewPreset = useRadar((s) => s.settings.viewPreset);
  const setView = useRadar((s) => s.setView);
  const cloudCounts = useRadar((s) => s.cloudCounts);
  const orientLive = useRadar((s) => s.sensors.orient.state === "live");
  const resetPdr = useRadar((s) => s.resetPdr);
  const fileRef = useRef<HTMLInputElement>(null);

  const counts = KINDS.map((k) => ({ ...k, n: cloudCounts[k.id] }));
  const total = counts.reduce((a, k) => a + k.n, 0);

  return (
    <div className="flex h-full min-h-[calc(100dvh-52px)] flex-col lg:flex-row">
      <section className="relative min-h-[360px] flex-1">
        <RadarCanvas className="absolute inset-0" />
        <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap gap-2">
          <Badge tone={mapping ? "live" : "mute"}>{mapping ? "建图中" : "空闲"}</Badge>
          <Badge tone="real">真实</Badge>
          <Badge tone="mute">{total} 点</Badge>
        </div>
      </section>

      <aside className="flex w-full flex-col gap-3 overflow-y-auto border-t border-line p-4 lg:w-[340px] lg:border-l lg:border-t-0">
        <PageHeader kicker="Map" title="3D 环境图" hint="视觉目标按相机几何投影、声呐落点、PDR 航迹，累积成去重点云 + 对数几率占用栅格。这是稀疏点云，不是 SLAM；室内走 20 m 以上累积误差会明显。" />

        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant={mapping ? "accent" : "default"} onClick={toggleMapping}>
            <MapPinned /> {mapping ? "暂停" : "开始建图"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMesh(!meshOn)}>
            <Grid3x3 /> {meshOn ? "隐藏栅格" : "显示栅格"}
          </Button>
          <Button size="sm" variant="outline" onClick={resetPdr}>
            航迹清零
          </Button>
          <Button size="sm" variant="outline" onClick={clearMap}>
            <Eraser /> 清空
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadJson(`aether-session-${Date.now()}.json`, exportSession())}
          >
            <Download /> 导出 JSON
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={total === 0}
            onClick={() => downloadText(`aether-cloud-${Date.now()}.ply`, cloud.toPly(), "text/plain")}
          >
            <Box /> 导出 PLY
          </Button>
          <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
            <Upload /> 导入
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              if (f.size > 20 * 1024 * 1024) throw new Error("file too large");
              importSession(JSON.parse(await f.text()));
            } catch {
              useRadar.getState().pushLog("导入 JSON 失败", "WARN");
            }
            e.target.value = "";
          }}
        />

        <div className="grid grid-cols-2 gap-2">
          <Metric label="点云" value={String(total)} hint="去重后" />
          <Metric label="航迹" value={`${trajLen.toFixed(1)} m`} hint={`${steps} 步 · ${trajectory.length} 点`} />
          <Metric label="已探索" value={`${exploredM2.toFixed(1)} m²`} hint="栅格有证据的面积" />
          <Metric
            label="定向"
            value={orientLive ? "罗盘" : "无"}
            hint={orientLive ? "" : "没有罗盘时只能朝 0°"}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>视角</CardTitle>
          </CardHeader>
          <div className="flex gap-1">
            {VIEWS.map((v) => (
              <Button key={v.id} size="sm" variant={viewPreset === v.id ? "accent" : "outline"} onClick={() => setView(v.id)}>
                {v.label}
              </Button>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>图例 / 过滤</CardTitle>
          </CardHeader>
          <ul className="space-y-2">
            {counts.map((k) => (
              <li key={k.id} className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={kindFilter[k.id]} onCheckedChange={(v) => setKindFilter(k.id, v)} />
                  {k.label}
                </label>
                <span className="font-mono text-xs tabular text-faint">{k.n}</span>
              </li>
            ))}
          </ul>
        </Card>
      </aside>
    </div>
  );
}
