import { createFileRoute } from "@tanstack/react-router";
import { useRef } from "react";
import { RadarCanvas } from "@/components/radar/radar-canvas";
import { PageHeader } from "@/components/panels/page-header";
import { Metric } from "@/components/panels/metric";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardHint, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useRadar } from "@/lib/radar-store";
import type { MapPointKind, ViewPreset } from "@/lib/types";
import { downloadJson } from "@/lib/utils";
import { Download, Eraser, Grid3x3, MapPinned, Upload } from "lucide-react";

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
  const densifyMap = useRadar((s) => s.densifyMap);
  const mapPoints = useRadar((s) => s.mapPoints);
  const trajectory = useRadar((s) => s.trajectory);
  const mapDensity = useRadar((s) => s.mapDensity);
  const setDensity = useRadar((s) => s.setDensity);
  const meshOn = useRadar((s) => s.meshOn);
  const setMesh = useRadar((s) => s.setMesh);
  const occupancy = useRadar((s) => s.occupancy);
  const coverage = useRadar((s) => s.coverage);
  const trajLen = useRadar((s) => s.trajLen);
  const kindFilter = useRadar((s) => s.kindFilter);
  const setKindFilter = useRadar((s) => s.setKindFilter);
  const exportMap = useRadar((s) => s.exportMap);
  const importMap = useRadar((s) => s.importMap);
  const viewPreset = useRadar((s) => s.viewPreset);
  const setView = useRadar((s) => s.setView);
  const fileRef = useRef<HTMLInputElement>(null);

  const counts = KINDS.map((k) => ({ ...k, n: mapPoints.filter((p) => p.kind === k.id).length }));

  return (
    <div className="flex h-full min-h-[calc(100dvh-52px)] flex-col lg:flex-row">
      <section className="relative min-h-[360px] flex-1">
        <RadarCanvas className="absolute inset-0" />
        <div className="pointer-events-none absolute left-4 top-4 flex flex-wrap gap-2">
          <Badge tone={mapping ? "live" : "mute"}>{mapping ? "建图中" : "空闲"}</Badge>
          <Badge tone="mute">{mapPoints.length} 点</Badge>
        </div>
      </section>

      <aside className="flex w-full flex-col gap-3 overflow-y-auto border-t border-line p-4 lg:w-[340px] lg:border-l lg:border-t-0">
        <PageHeader kicker="Map" title="3D 环境图" hint="视觉投影 + 声呐落点 + IMU 轨迹累积。点云而非完整 SLAM。" />

        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant={mapping ? "accent" : "default"} onClick={toggleMapping}>
            <MapPinned /> {mapping ? "暂停" : "开始建图"}
          </Button>
          <Button size="sm" variant="outline" onClick={densifyMap}>
            加密
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMesh(!meshOn)}>
            <Grid3x3 /> {meshOn ? "关网格" : "生成网格"}
          </Button>
          <Button size="sm" variant="outline" onClick={clearMap}>
            <Eraser /> 清空
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => downloadJson(`aether-map-${Date.now()}.json`, exportMap())}
          >
            <Download /> 导出
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
              importMap(JSON.parse(await f.text()));
            } catch {
              useRadar.getState().pushLog("导入 JSON 失败", "WARN");
            }
            e.target.value = "";
          }}
        />

        <div className="grid grid-cols-2 gap-2">
          <Metric label="点云" value={String(mapPoints.length)} />
          <Metric label="轨迹" value={`${trajLen.toFixed(1)} m`} hint={`${trajectory.length} 点`} />
          <Metric label="覆盖" value={`${(coverage * 100).toFixed(0)}%`} />
          <Metric label="网格" value={String(occupancy.length)} />
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
            <CardTitle>密度</CardTitle>
            <CardHint>{mapDensity.toFixed(1)}×</CardHint>
          </CardHeader>
          <Slider min={0.3} max={3} step={0.1} value={[mapDensity]} onValueChange={(v) => setDensity(v[0] ?? 1)} />
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
