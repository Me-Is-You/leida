import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { PageHeader } from "@/components/panels/page-header";
import { Metric, SourceBadge } from "@/components/panels/metric";
import { LiveView } from "@/components/vision/live-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardHint, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Spark } from "@/components/charts/spark";
import { KIND_LABEL } from "@/lib/types";
import { cocoModelSource, runOcr } from "@/lib/vision";
import { useRadar } from "@/lib/radar-store";
import { downloadText, formatMeters } from "@/lib/utils";
import { Aperture, Camera, CameraOff, Download, Flashlight, ScanText, SwitchCamera } from "lucide-react";

export const Route = createFileRoute("/vision")({ component: VisionPage });

const MODEL_LABEL = { idle: "未加载", loading: "加载中…", ready: "COCO-SSD（本地）", fallback: "COCO-SSD（远程回退）" } as const;

function liveVideo(): HTMLVideoElement | null {
  return document.querySelector<HTMLVideoElement>("video[data-live-video]");
}

function VisionPage() {
  const cameraOn = useRadar((s) => s.cameraOn);
  const enableCamera = useRadar((s) => s.enableCamera);
  const disableCamera = useRadar((s) => s.disableCamera);
  const toggleFacing = useRadar((s) => s.toggleFacing);
  const toggleTorch = useRadar((s) => s.toggleTorch);
  const setZoomLevel = useRadar((s) => s.setZoomLevel);
  const facing = useRadar((s) => s.facing);
  const torch = useRadar((s) => s.torch);
  const zoom = useRadar((s) => s.zoom);
  const caps = useRadar((s) => s.videoCaps);
  const info = useRadar((s) => s.cameraInfo);
  const model = useRadar((s) => s.modelStatus);
  const detectMs = useRadar((s) => s.detectMs);
  const detections = useRadar((s) => s.detections);
  const people = useRadar((s) => s.people);
  const settings = useRadar((s) => s.settings);
  const update = useRadar((s) => s.updateSettings);
  const barcodes = useRadar((s) => s.barcodes);
  const ocr = useRadar((s) => s.ocr);
  const setOcr = useRadar((s) => s.setOcr);
  const select = useRadar((s) => s.select);
  const selectedId = useRadar((s) => s.selectedId);
  const scanBarcodesOn = useRadar((s) => s.scanBarcodesOn);
  const pushLog = useRadar((s) => s.pushLog);
  const vision = useRadar((s) => s.vision);
  const brightHist = useRadar((s) => s.brightHist);
  const sensors = useRadar((s) => s.sensors);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrLang, setOcrLang] = useState<"eng" | "chi_sim+eng">("chi_sim+eng");
  const [ocrMsg, setOcrMsg] = useState("");
  const [barBusy, setBarBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const snapshot = () => {
    const v = liveVideo();
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    c.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `aether-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, "image/png");
  };

  const doOcr = async () => {
    const v = liveVideo();
    if (!v || !v.videoWidth) {
      setOcrMsg("请先开启相机");
      return;
    }
    setOcrBusy(true);
    setOcrMsg(ocrLang === "eng" ? "识别中…（首次需加载语言包）" : "识别中…（中文语言包约 20 MB，首次较慢）");
    try {
      const c = (canvasRef.current ??= document.createElement("canvas"));
      // cap the long side: OCR cost grows with pixels and gains nothing past ~1600 px
      const k = Math.min(1, 1600 / Math.max(v.videoWidth, v.videoHeight));
      c.width = Math.round(v.videoWidth * k);
      c.height = Math.round(v.videoHeight * k);
      c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
      const r = await runOcr(c, ocrLang);
      setOcr({ ...r, t: Date.now() });
      setOcrMsg(r.text ? "" : "没有识别到文字。让文字占满画面、光线充足、避免反光。");
      pushLog(`OCR ${r.text.length} 字 · 置信 ${r.confidence.toFixed(0)}%`, "INFO");
    } catch (e) {
      setOcrMsg(`OCR 失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setOcrBusy(false);
    }
  };

  const doBarcode = async () => {
    const v = liveVideo();
    if (!v) return;
    setBarBusy(true);
    await scanBarcodesOn(v);
    setBarBusy(false);
  };

  const sorted = [...detections].sort((a, b) => b.score - a.score);
  const camState = sensors.camera;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 lg:px-6">
      <PageHeader
        kicker="Vision"
        title="视觉"
        hint="COCO-SSD 在设备本地识别 80 类物体；深度由「类别典型高度 + 针孔相机模型」估算，不是测距，误差标在每个框上（±σ）。"
        actions={
          <>
            <Button variant={cameraOn ? "outline" : "default"} onClick={() => (cameraOn ? disableCamera() : void enableCamera())}>
              {cameraOn ? <CameraOff /> : <Camera />} {cameraOn ? "关闭相机" : "开启相机"}
            </Button>
            <Button variant="outline" onClick={() => void toggleFacing()} disabled={!cameraOn}>
              <SwitchCamera /> {facing === "environment" ? "后置" : "前置"}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <LiveView className="aspect-[3/4] w-full lg:aspect-[4/3]" />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={snapshot} disabled={!cameraOn}>
              <Aperture /> 截图
            </Button>
            <Button size="sm" variant={torch ? "accent" : "outline"} onClick={() => void toggleTorch()} disabled={!cameraOn || !caps?.torch}>
              <Flashlight /> 手电 {caps?.torch ? "" : "（不支持）"}
            </Button>
            <Badge tone={model === "ready" ? "live" : model === "loading" ? "accent" : model === "fallback" ? "warn" : "mute"}>{MODEL_LABEL[model]}</Badge>
            {cameraOn && camState.state !== "live" ? <Badge tone="warn">{camState.note || "等待画面"}</Badge> : null}
          </div>
          {caps && caps.zoomMax > caps.zoomMin ? (
            <div>
              <div className="mb-1 flex justify-between text-xs text-muted">
                <span>变焦</span>
                <span className="font-mono tabular">{zoom.toFixed(1)}×</span>
              </div>
              <Slider min={caps.zoomMin} max={caps.zoomMax} step={0.1} value={[zoom]} onValueChange={(v) => void setZoomLevel(v[0] ?? 1)} />
              <p className="mt-1 text-[11px] text-faint">变焦会改变视场角，深度估算假设的是 {settings.hfovDeg}°，变焦后请相应调整下方「水平视场角」。</p>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            <Metric label="目标" value={String(detections.length)} hint={`${people.filter((p) => p.source === "device").length} 人（真实）`} />
            <Metric label="推理" value={detectMs > 0 ? `${detectMs.toFixed(0)} ms` : "—"} hint={model === "ready" || model === "fallback" ? cocoModelSource() : ""} />
            <Metric label="分辨率" value={info ? `${info.width}×${info.height}` : "—"} hint={info ? `${info.fps.toFixed(0)} fps · ${info.facing}` : ""} />
            <Metric label="亮度" value={vision.brightness !== null ? vision.brightness.toFixed(0) : "—"} hint={vision.texture !== null ? `纹理 ${vision.texture.toFixed(2)}` : ""} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>检测设置</CardTitle>
            </CardHeader>
            <div className="space-y-4">
              <Row label="开启检测">
                <Switch checked={settings.detectOn} onCheckedChange={(v) => update({ detectOn: v })} />
              </Row>
              <Row label="显示框与标签">
                <Switch checked={settings.contourOn} onCheckedChange={(v) => update({ contourOn: v })} />
              </Row>
              <Row label="只看人">
                <Switch checked={settings.personOnly} onCheckedChange={(v) => update({ personOnly: v })} />
              </Row>
              <Row label="夜视增强（仅显示）">
                <Switch checked={settings.nightVision} onCheckedChange={(v) => update({ nightVision: v })} />
              </Row>
              <Row label="HDR 对比（仅显示）">
                <Switch checked={settings.hdr} onCheckedChange={(v) => update({ hdr: v })} />
              </Row>
              <div>
                <div className="mb-2 flex justify-between text-sm">
                  <span>最低置信度</span>
                  <span className="font-mono text-xs text-muted tabular">{(settings.minScore * 100).toFixed(0)}%</span>
                </div>
                <Slider min={0.2} max={0.95} step={0.05} value={[settings.minScore]} onValueChange={(v) => update({ minScore: v[0] ?? 0.5 })} />
              </div>
              <div>
                <div className="mb-2 flex justify-between text-sm">
                  <span>水平视场角</span>
                  <span className="font-mono text-xs text-muted tabular">{settings.hfovDeg.toFixed(0)}°</span>
                </div>
                <Slider min={40} max={120} step={1} value={[settings.hfovDeg]} onValueChange={(v) => update({ hfovDeg: v[0] ?? 75 })} />
                <p className="mt-1 text-[11px] text-faint">主摄约 75–80°。设置不对，距离和方位都会按比例偏。可用已知距离的人对照校正。</p>
              </div>
              <div>
                <div className="mb-2 flex justify-between text-sm">
                  <span>相机离地高度</span>
                  <span className="font-mono text-xs text-muted tabular">{settings.cameraHeightM.toFixed(2)} m</span>
                </div>
                <Slider min={0.3} max={2.2} step={0.05} value={[settings.cameraHeightM]} onValueChange={(v) => update({ cameraHeightM: v[0] ?? 1.35 })} />
              </div>
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>跟踪目标</CardTitle>
          <CardHint>{sorted.length} 个 · 点击高亮</CardHint>
        </CardHeader>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted">{cameraOn ? "画面中没有高于阈值的目标。" : "开启相机后这里会列出识别到的物体、估算距离及不确定度。"}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-widest text-faint">
                <tr>
                  <th className="py-2 font-medium">ID</th>
                  <th className="py-2 font-medium">类别</th>
                  <th className="py-2 font-medium">置信</th>
                  <th className="py-2 font-medium">距离 ±σ</th>
                  <th className="py-2 font-medium">依据</th>
                  <th className="py-2 font-medium">方位</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => select(selectedId === d.id ? null : d.id)}
                    className={`cursor-pointer border-t border-line ${selectedId === d.id ? "bg-raised" : "hover:bg-raised/60"}`}
                  >
                    <td className="py-2 font-mono text-xs tabular">{d.trackId != null ? `#${d.trackId}` : "—"}</td>
                    <td className="py-2">
                      {d.cls} <span className="text-xs text-faint">{KIND_LABEL[d.kind]}</span>
                      {d.truncated ? <Badge tone="warn" className="ml-2">截断</Badge> : null}
                    </td>
                    <td className="py-2 font-mono tabular">{(d.score * 100).toFixed(0)}%</td>
                    <td className="py-2 font-mono tabular">
                      {formatMeters(d.depthM)}
                      {d.sigmaM != null ? <span className="text-faint"> ±{d.sigmaM.toFixed(1)}</span> : null}
                    </td>
                    <td className="py-2 text-xs text-muted">{d.depthBasis ?? "—"}</td>
                    <td className="py-2 font-mono tabular">{bearingOf(d.bbox, settings.hfovDeg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>文字识别 OCR</CardTitle>
            <CardHint>Tesseract · 本地</CardHint>
          </CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void doOcr()} disabled={!cameraOn || ocrBusy}>
              <ScanText /> {ocrBusy ? "识别中…" : "识别当前画面"}
            </Button>
            <Button size="sm" variant={ocrLang === "chi_sim+eng" ? "accent" : "outline"} onClick={() => setOcrLang("chi_sim+eng")} disabled={ocrBusy}>
              中文+英文
            </Button>
            <Button size="sm" variant={ocrLang === "eng" ? "accent" : "outline"} onClick={() => setOcrLang("eng")} disabled={ocrBusy}>
              仅英文
            </Button>
          </div>
          {ocrMsg ? <p className="mt-2 text-xs text-muted">{ocrMsg}</p> : null}
          {ocr?.text ? (
            <div className="mt-3">
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-raised p-3 text-sm">{ocr.text}</pre>
              <div className="mt-2 flex items-center justify-between text-xs text-muted">
                <span>置信度 {ocr.confidence.toFixed(0)}%</span>
                <span className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void navigator.clipboard?.writeText(ocr.text)}>
                    复制
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => downloadText(`ocr-${Date.now()}.txt`, ocr.text)}>
                    <Download /> 保存
                  </Button>
                </span>
              </div>
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>条码 / 二维码</CardTitle>
            <CardHint>BarcodeDetector</CardHint>
          </CardHeader>
          <Button size="sm" onClick={() => void doBarcode()} disabled={!cameraOn || barBusy}>
            {barBusy ? "扫描中…" : "扫描当前画面"}
          </Button>
          {barcodes.length === 0 ? (
            <p className="mt-3 text-xs text-muted">
              {typeof window !== "undefined" && "BarcodeDetector" in window ? "没有识别到条码。" : "此浏览器不支持 BarcodeDetector（Chrome / Android 可用）。"}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {barcodes.map((b) => (
                <li key={`${b.t}-${b.value}`} className="rounded-md bg-raised px-3 py-2">
                  <div className="flex items-center justify-between">
                    <Badge tone="mute">{b.format}</Badge>
                    <span className="font-mono text-[11px] text-faint">{new Date(b.t).toLocaleTimeString("zh-CN", { hour12: false })}</span>
                  </div>
                  <p className="mt-1 break-all text-sm">{b.value}</p>
                  {/^https?:\/\//.test(b.value) ? <p className="mt-1 text-[11px] text-warn">这是链接，打开前请确认来源，程序不会自动跳转。</p> : null}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <SourceBadge source="device" />
            <Spark data={brightHist} label="画面亮度" unit="" digits={0} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span>{label}</span>
      {children}
    </div>
  );
}

/** Bearing relative to the optical axis from a normalised bbox (negative = left). */
function bearingOf(bbox: [number, number, number, number], hfovDeg: number): string {
  const cx = bbox[0] + bbox[2] / 2;
  const f = 0.5 / Math.tan((hfovDeg * Math.PI) / 360);
  const a = (Math.atan((cx - 0.5) / f) * 180) / Math.PI;
  return `${a >= 0 ? "右" : "左"} ${Math.abs(a).toFixed(0)}°`;
}
