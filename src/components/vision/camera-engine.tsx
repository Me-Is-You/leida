import { useEffect, useRef } from "react";
import { analyzeFrame, getCameraStream } from "@/lib/device";
import { observerPose } from "@/lib/engine";
import { scanFrameBarcodes, useRadar } from "@/lib/radar-store";
import { blobsToDetections, cocoState, detectCoco, extractContour, loadCoco } from "@/lib/vision";

export function CameraEngine() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraOn = useRadar((s) => s.cameraOn);
  const detectOn = useRadar((s) => s.detectOn);
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
  }, [cameraOn]);

  useEffect(() => {
    if (!cameraOn || !detectOn) return;
    let cancelled = false;
    setModelStatus("loading");
    void loadCoco().then((ok) => {
      if (cancelled) return;
      setModelStatus(ok ? "ready" : "fallback");
      useRadar.getState().pushLog(ok ? "COCO-SSD lite 已加载" : "视觉走帧分析回退 · 仍为真实像素", ok ? "REAL" : "INFO");
    });
    return () => {
      cancelled = true;
    };
  }, [cameraOn, detectOn, setModelStatus]);

  useEffect(() => {
    if (!cameraOn || !detectOn) return;
    let alive = true;
    let last = 0;
    let busy = false;
    const loop = (now: number) => {
      if (!alive) return;
      if (now - last > 120 && !busy) {
        last = now;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const st = useRadar.getState();
        if (video && canvas && video.readyState >= 2) {
          const metrics = analyzeFrame(video, canvas);
          const obs = observerPose(st.t);
          busy = true;
          const finish = (dets: ReturnType<typeof blobsToDetections>) => {
            if (st.contourOn) {
              for (const d of dets) {
                d.contour = extractContour(metrics.gray, metrics.width, metrics.height, d.bbox);
              }
            }
            st.ingestVision(dets, metrics);
            if (now % 1400 < 160) void scanFrameBarcodes(canvas);
            busy = false;
          };
          if (cocoState() === "ready") {
            void detectCoco(video, obs.pos).then((ml) => {
              if (!alive) return;
              finish(ml && ml.length ? ml : blobsToDetections(metrics.blobs, obs.pos, "device"));
            });
          } else {
            finish(blobsToDetections(metrics.blobs, obs.pos, "device"));
          }
        }
      }
      requestAnimationFrame(loop);
    };
    const id = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(id);
    };
  }, [cameraOn, detectOn]);

  return (
    <div className="pointer-events-none absolute -left-[9999px] size-0 overflow-hidden">
      <video ref={videoRef} playsInline muted autoPlay />
      <canvas ref={canvasRef} />
    </div>
  );
}
