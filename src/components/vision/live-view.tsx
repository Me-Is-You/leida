import { useEffect, useRef } from "react";
import { getCameraStream } from "@/lib/device";
import { useRadar } from "@/lib/radar-store";
import { cn } from "@/lib/utils";

export function LiveView({ className }: { className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const cameraOn = useRadar((s) => s.cameraOn);
  const nightVision = useRadar((s) => s.nightVision);
  const hdr = useRadar((s) => s.hdr);
  const contourOn = useRadar((s) => s.contourOn);

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
    let alive = true;
    const draw = () => {
      if (!alive) return;
      const video = videoRef.current;
      const canvas = overlayRef.current;
      if (video && canvas && video.readyState >= 2) {
        const w = canvas.clientWidth || 1;
        const h = canvas.clientHeight || 1;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, w, h);
          const dets = useRadar.getState().detections;
          const contour = useRadar.getState().contourOn;
          for (const d of dets) {
            const [x, y, bw, bh] = d.bbox;
            const person = d.cls === "person";
            ctx.strokeStyle = person ? "rgba(143,180,184,0.95)" : "rgba(196,165,116,0.9)";
            ctx.lineWidth = 1.4;
            ctx.strokeRect(x * w, y * h, bw * w, bh * h);
            ctx.fillStyle = "rgba(8,9,11,0.72)";
            const label = `${d.cls} ${(d.score * 100).toFixed(0)}%  ${d.depthM.toFixed(2)}m`;
            ctx.font = "11px IBM Plex Mono, ui-monospace, monospace";
            const tw = ctx.measureText(label).width + 10;
            ctx.fillRect(x * w, Math.max(0, y * h - 16), tw, 16);
            ctx.fillStyle = person ? "#8fb4b8" : "#c4a574";
            ctx.fillText(label, x * w + 5, Math.max(12, y * h - 4));
            if (contour && d.contour.length >= 4) {
              ctx.beginPath();
              ctx.strokeStyle = person ? "rgba(125,186,154,0.8)" : "rgba(196,165,116,0.7)";
              for (let i = 0; i < d.contour.length; i += 2) {
                const px = (d.contour[i] ?? 0) * w;
                const py = (d.contour[i + 1] ?? 0) * h;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
              }
              ctx.closePath();
              ctx.stroke();
            }
          }
        }
      }
      requestAnimationFrame(draw);
    };
    const id = requestAnimationFrame(draw);
    return () => {
      alive = false;
      cancelAnimationFrame(id);
    };
  }, [contourOn]);

  const filter = [
    nightVision ? "hue-rotate(72deg) saturate(0.55) contrast(1.35) brightness(1.25)" : "",
    hdr ? "contrast(1.18) saturate(1.08)" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cn("relative overflow-hidden rounded-xl bg-raised shadow-[var(--shadow-border)]", className)}>
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="h-full w-full object-cover"
        style={filter ? { filter } : undefined}
      />
      <canvas ref={overlayRef} className="absolute inset-0 h-full w-full" />
      {!cameraOn && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface">
          <p className="text-sm text-muted">相机未开启</p>
        </div>
      )}
    </div>
  );
}
