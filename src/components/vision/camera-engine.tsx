import { useEffect, useRef } from "react";
import { DetectScheduler } from "@/lib/core/detect-sched";
import { analyzeFrame, getCameraStream, readBattery, resetFrameHistory } from "@/lib/device";
import { record } from "@/lib/perf";
import { useRadar } from "@/lib/radar-store";
import { cocoState, detectCoco, loadCoco, type RawDet } from "@/lib/vision";

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
    const sched = new DetectScheduler();
    resetFrameHistory();
    void readBattery().then((b) => {
      sched.saver = !!b && !b.charging && b.level < 0.2;
    });
    const loop = async () => {
      if (!alive) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const st = useRadar.getState();
      let wait = 150;
      if (video && canvas && !document.hidden && video.readyState >= 2 && video.videoWidth > 0) {
        const t0 = performance.now();
        const metrics = analyzeFrame(video, canvas);
        record("vision.frame", performance.now() - t0);
        const aspect = video.videoWidth / video.videoHeight;
        const detecting = st.settings.detectOn;
        const modelReady = cocoState() === "ready";
        const d = sched.decide(t0, {
          motion: metrics?.motion ?? 0,
          moving: metrics?.moving.length ?? 0,
          ego: metrics?.egoMotion ?? false,
          tracks: st.detections.length,
        });
        let ms = 0;
        if (!detecting) {
          // no inference requested: only the cheap frame statistics feed the environment classifier
          st.ingestVision(st.detections.length ? [] : null, metrics, aspect, 0);
        } else if (modelReady && d.runNN) {
          const t1 = performance.now();
          const raw = await detectCoco(video, st.settings.minScore);
          if (!alive) return;
          ms = performance.now() - t1;
          record("vision.nn", ms);
          sched.noteNn(t1);
          useRadar.getState().ingestVision(raw ?? [], metrics, aspect, ms);
          void useRadar.getState().scanBarcodesOn(video);
        } else if (!modelReady) {
          // model missing/offline: the own motion detector still yields unlabeled moving blobs
          const blobs: RawDet[] = (metrics?.moving ?? []).map((b) => ({ cls: "运动物体", score: 0.5, bbox: b }));
          st.ingestVision(blobs, metrics, aspect, 0);
          void st.scanBarcodesOn(video);
        } else {
          st.ingestVision(null, metrics, aspect, 0);
        }
        // keep ≥ 60 ms idle so the UI thread is never starved on slow phones
        wait = Math.max(60, 130 - ms, d.delayMs);
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
