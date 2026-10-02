import { useEffect, useRef } from "react";
import { getCameraStream } from "@/lib/device";
import { useRadar } from "@/lib/radar-store";
import { cn } from "@/lib/utils";

/** Live preview with detection overlay. Boxes are mapped through the same object-fit:cover transform as the video. */
export function LiveView({ className, hud = true }: { className?: string; hud?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const cameraOn = useRadar((s) => s.cameraOn);
  const cameraEpoch = useRadar((s) => s.cameraEpoch);
  const nightVision = useRadar((s) => s.settings.nightVision);
  const hdr = useRadar((s) => s.settings.hdr);

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
    let alive = true;
    let raf = 0;
    const draw = () => {
      if (!alive) return;
      raf = requestAnimationFrame(draw);
      const video = videoRef.current;
      const canvas = overlayRef.current;
      if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = canvas.clientWidth || 1;
      const ch = canvas.clientHeight || 1;
      if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(ch * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      // object-fit: cover mapping of normalised video coordinates → canvas pixels
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const scale = Math.max(cw / vw, ch / vh);
      const ox = (cw - vw * scale) / 2;
      const oy = (ch - vh * scale) / 2;
      const px = (nx: number) => ox + nx * vw * scale;
      const py = (ny: number) => oy + ny * vh * scale;

      const st = useRadar.getState();
      const dets = st.detections;
      ctx.font = "11px 'IBM Plex Mono', ui-monospace, monospace";
      for (const d of dets) {
        const [x, y, bw, bh] = d.bbox;
        const person = d.cls === "person";
        const col = person ? "#8fb4b8" : "#c4a574";
        const X = px(x);
        const Y = py(y);
        const W = bw * vw * scale;
        const H = bh * vh * scale;
        ctx.strokeStyle = col;
        ctx.lineWidth = 1.5;
        if (st.settings.contourOn) {
          // corner brackets are easier on the eye than a full rectangle
          const L = Math.min(14, W / 3, H / 3);
          ctx.beginPath();
          for (const [cx, cy, dx, dy] of [
            [X, Y, 1, 1],
            [X + W, Y, -1, 1],
            [X + W, Y + H, -1, -1],
            [X, Y + H, 1, -1],
          ] as const) {
            ctx.moveTo(cx + dx * L, cy);
            ctx.lineTo(cx, cy);
            ctx.lineTo(cx, cy + dy * L);
          }
          ctx.stroke();
        } else {
          ctx.strokeRect(X, Y, W, H);
        }
        const depth = `≈${d.depthM.toFixed(1)}${d.sigmaM ? `±${d.sigmaM.toFixed(1)}` : ""}m${d.truncated ? "↑" : ""}`;
        const label = `#${d.trackId ?? "?"} ${d.cls} ${(d.score * 100).toFixed(0)}% ${depth}`;
        const tw = ctx.measureText(label).width + 10;
        const ly = Math.max(0, Y - 17);
        ctx.fillStyle = "rgba(8,9,11,0.74)";
        ctx.fillRect(X, ly, tw, 16);
        ctx.fillStyle = col;
        ctx.fillText(label, X + 5, ly + 12);
      }
      // centre cross-hair
      ctx.strokeStyle = "rgba(236,232,224,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cw / 2 - 8, ch / 2);
      ctx.lineTo(cw / 2 + 8, ch / 2);
      ctx.moveTo(cw / 2, ch / 2 - 8);
      ctx.lineTo(cw / 2, ch / 2 + 8);
      ctx.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);

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
        data-live-video
        playsInline
        muted
        autoPlay
        className="h-full w-full object-cover"
        style={filter ? { filter } : undefined}
      />
      <canvas ref={overlayRef} className="absolute inset-0 h-full w-full" />
      {hud && cameraOn ? <Hud /> : null}
      {!cameraOn && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface">
          <p className="text-sm text-muted">相机未开启</p>
        </div>
      )}
    </div>
  );
}

function Hud() {
  const pose = useRadar((s) => s.pose);
  const fused = useRadar((s) => s.fused);
  const info = useRadar((s) => s.cameraInfo);
  const detectMs = useRadar((s) => s.detectMs);
  const orient = useRadar((s) => s.sensors.orient.state === "live");
  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-2 flex flex-wrap gap-1.5 font-mono text-[10px] text-fg">
      <span className="rounded bg-bg/70 px-1.5 py-0.5">
        {info ? `${info.width}×${info.height} @${info.fps.toFixed(0)}` : "—"}
      </span>
      <span className="rounded bg-bg/70 px-1.5 py-0.5">
        航向 {orient ? `${pose.headingDeg.toFixed(0)}° 俯仰 ${pose.pitchDeg.toFixed(0)}°` : "—"}
      </span>
      <span className="rounded bg-bg/70 px-1.5 py-0.5">检测 {detectMs ? `${detectMs.toFixed(0)} ms` : "—"}</span>
      {fused.rangeM !== null ? (
        <span className="rounded bg-bg/70 px-1.5 py-0.5 text-live">
          中心 {fused.rangeM.toFixed(2)} m{fused.sigmaM ? ` ±${fused.sigmaM.toFixed(2)}` : ""} · {fused.used.join("+")}
        </span>
      ) : null}
    </div>
  );
}
