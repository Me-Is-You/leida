import { useEffect, useRef } from "react";
import { analyzeFrame, getCameraStream } from "@/lib/device";
import { useRadar } from "@/lib/radar-store";
import { cocoState, detectCoco, loadCoco } from "@/lib/vision";

/**
 * Headless vision pump. Owns an off-screen <video>, runs frame statistics for
 * the environment classifier and (when enabled) the COCO-SSD detector, then
 * hands the raw detections to the store, which tracks / projects / maps them.
 * One detection runs at a time — never overlapping, so a slow phone just lowers the rate.
 */
export function CameraEngine() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraOn = useRadar((s) => s.cameraOn);
  const cameraEpoch = useRadar((s) => s.cameraEpoch);
  const detectOn = useRadar((s) => s.settings.detectOn);
  const setModelStatus = useRadar((s) => s.setModelStatus);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const stream = getCameraStream();
    if (cameraOn && stream) {
      video.srcObject = stream;
      void video.play().catch(() => undefined);
    } else {
      video.srcObject = null;
    }
  }, [cameraOn, cameraEpoch]);

  useEffect(() => {
    if (!cameraOn || !detectOn) return;
    let cancelled = false;
    setModelStatus("loading");
    void loadCoco().then((ok) => {
      if (cancelled) return;
      setModelStatus(ok ? "ready" : "fallback");
      const st = useRadar.getState();
      st.pushLog(ok ? "COCO-SSD 已加载（本地模型）" : "COCO-SSD 加载失败：无检测，仅统计画面亮度/纹理", ok ? "REAL" : "WARN");
    });
    return () => {
      cancelled = true;
    };
  }, [cameraOn, detectOn, setModelStatus]);

  useEffect(() => {
    if (!cameraOn) return;
    let alive = true;
    let timer = 0;
    const loop = async () => {
      if (!alive) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const st = useRadar.getState();
      let wait = 150;
      if (video && canvas && !document.hidden && video.readyState >= 2 && video.videoWidth > 0) {
        const metrics = analyzeFrame(video, canvas);
        const aspect = video.videoWidth / video.videoHeight;
        const t0 = performance.now();
        let raw: Awaited<ReturnType<typeof detectCoco>> = [];
        if (st.settings.detectOn && cocoState() === "ready") {
          raw = await detectCoco(video, st.settings.minScore);
        }
        if (!alive) return;
        const ms = performance.now() - t0;
        useRadar.getState().ingestVision(raw ?? [], metrics, aspect, ms);
        if (st.settings.detectOn) void useRadar.getState().scanBarcodesOn(video);
        // keep ≥ 60 ms idle so the UI thread is never starved on slow phones
        wait = Math.max(60, 130 - ms);
      }
      timer = window.setTimeout(() => void loop(), wait);
    };
    timer = window.setTimeout(() => void loop(), 200);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [cameraOn, cameraEpoch]);

  return (
    <div className="pointer-events-none absolute -left-[9999px] size-0 overflow-hidden" aria-hidden>
      <video ref={videoRef} playsInline muted autoPlay />
      <canvas ref={canvasRef} />
    </div>
  );
}
