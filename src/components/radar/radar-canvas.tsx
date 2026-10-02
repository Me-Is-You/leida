import { useEffect, useRef, useState } from "react";
import { CLOUD_KINDS, type CloudKind } from "@/lib/core/cloud.ts";
import { OrbitCamera } from "@/lib/gl/orbit.ts";
import { Batch, BoxBatch, GLRenderer, type PointLayer, type RGBA, hex } from "@/lib/gl/renderer.ts";
import { record } from "@/lib/perf";
import { cloud, effectiveSonar, grid, useRadar } from "@/lib/radar-store";
import type { ViewPreset } from "@/lib/types";
import { cn } from "@/lib/utils";

/** yaw (rad), elevation (rad), distance (m) for the camera presets. */
const PRESET: Record<ViewPreset, [number, number, number]> = {
  iso: [0.58, 0.54, 20.3],
  top: [0, Math.PI / 2 - 0.02, 22],
  follow: [0, 0.5, 10.6],
};

const COLOR: Record<CloudKind, RGBA> = {
  person: hex("#8fb4b8", 0.9),
  object: hex("#c7bda3", 0.9),
  wall: hex("#8a909c", 0.85),
  free: hex("#739e85", 0.8),
  traj: hex("#c4a673", 0.9),
  sonar: hex("#b8c7d6", 0.95),
};
const SIZE: Record<CloudKind, number> = { person: 0.07, object: 0.07, wall: 0.06, free: 0.05, traj: 0.06, sonar: 0.11 };
const BG: RGBA = hex("#08090b");
const TAU = Math.PI * 2;

export function RadarCanvas({ className }: { className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const box = wrap.current;
    if (!canvas || !box) return;
    let renderer: GLRenderer;
    try {
      renderer = new GLRenderer(canvas);
    } catch (e) {
      setError(e instanceof Error ? e.message : "WebGL 初始化失败");
      return;
    }
    const stop = runScene(renderer, canvas, box);
    return () => {
      stop();
      renderer.dispose();
    };
  }, []);

  return (
    <div ref={wrap} className={cn("relative h-full min-h-[280px] overflow-hidden bg-bg", className)}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none" aria-label="3D 环境图：拖动旋转，双指缩放和平移" />
      {error ? (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-muted">
          3D 视图不可用：{error}
          <br />
          需要支持 WebGL2 的浏览器。
        </div>
      ) : null}
    </div>
  );
}

/** Builds the scene, wires gestures and runs the render loop. Returns a disposer. */
function runScene(r: GLRenderer, canvas: HTMLCanvasElement, box: HTMLElement): () => void {
  const cam = new OrbitCamera();
  r.setFog(22, 52);

  // ─ static geometry ───────────────────────────────────────────────
  const gridB = new Batch();
  const gMinor = hex("#1c2630", 0.55);
  const gMajor = hex("#34404c", 0.8);
  const N = 40;
  for (let i = -N; i <= N; i++) {
    const c = i % 5 === 0 ? gMajor : gMinor;
    gridB.line(i, 0, -N, i, 0, N, c);
    gridB.line(-N, 0, i, N, 0, i, c);
  }
  const ringsB = new Batch();
  for (const rr of [1, 2, 3, 5]) ringsB.ring(0, 0.02, 0, rr, hex("#8fb4b8", rr === 5 ? 0.3 : 0.18));

  const occB = new BoxBatch(3000);
  const dyn = new Batch();
  const trajB = new Batch();

  // person marker glyph (a fixed icon, not data): 140 points on a lathe + head, spread with low-discrepancy sequences
  const frac = (x: number) => x - Math.floor(x);
  const personPts = new Float32Array(180 * 3);
  for (let i = 0; i < 180; i++) {
    const h = frac((i + 0.5) * 0.6180339887);
    const t = frac(i * 0.7548776662) * TAU;
    if (i >= 140) {
      const p = frac((i - 140 + 0.5) / 40 + 0.31) * Math.PI;
      personPts[i * 3] = Math.sin(p) * Math.cos(t) * 0.18;
      personPts[i * 3 + 1] = 1.52 + Math.cos(p) * 0.18;
      personPts[i * 3 + 2] = Math.sin(p) * Math.sin(t) * 0.18;
    } else {
      const rad = 0.28 * (0.55 + 0.45 * Math.sin(h * Math.PI));
      personPts[i * 3] = Math.cos(t) * rad;
      personPts[i * 3 + 1] = h * 1.55;
      personPts[i * 3 + 2] = Math.sin(t) * rad;
    }
  }
  const person: PointLayer = { data: personPts, count: 180, version: 1, color: hex("#8fb4b8", 0.9), size: 0.07, additive: true };

  const marker: PointLayer = { data: new Float32Array(3), count: 1, version: 1, color: hex("#ece8e0", 1), size: 0.26, additive: true };
  const layers = {} as Record<CloudKind, PointLayer>;
  for (const k of CLOUD_KINDS) {
    const ring = cloud.rings[k];
    layers[k] = { data: ring.pos, count: 0, version: -1, color: COLOR[k], size: SIZE[k] };
  }

  r.onRestore = () => {
    for (const b of [gridB, ringsB, dyn, trajB]) r.forget(b);
    for (const b of [occB]) r.forget(b);
    for (const l of [person, marker, ...Object.values(layers)]) r.forget(l);
    occV = -1;
    trajN = -1;
  };

  // ─ scene state tracked for rebuilds ──────────────────────────────
  let occV = -1;
  let occOn = false;
  let trajN = -1;
  let preset: ViewPreset | "" = "";
  let followYawOffset = 0;
  let lastSig = "";
  let lastDraw = 0;
  let lastFrame = 0;
  let slow = 0;
  let dprCap = Math.min(window.devicePixelRatio || 1, 1.6);
  let visible = true;
  let alive = true;
  let raf = 0;

  // ─ gestures ──────────────────────────────────────────────────────
  const ptrs = new Map<number, { x: number; y: number }>();
  let lastPinch = 0;
  const rect = () => canvas.getBoundingClientRect();
  const onDown = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()] as [{ x: number; y: number }, { x: number; y: number }];
      lastPinch = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onMove = (e: PointerEvent) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (ptrs.size === 1) {
      const dYaw = -dx * 0.006;
      cam.rotate(dYaw, dy * 0.005);
      if (preset === "follow") followYawOffset += dYaw;
    } else if (ptrs.size === 2) {
      const before = [...ptrs.values()] as [{ x: number; y: number }, { x: number; y: number }];
      p.x = e.clientX;
      p.y = e.clientY;
      const [a, b] = before;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (lastPinch > 0 && d > 0) cam.zoom(lastPinch / d);
      lastPinch = d;
      cam.pan(dx / 2, dy / 2, rect().height);
      return;
    }
    p.x = e.clientX;
    p.y = e.clientY;
  };
  const onUp = (e: PointerEvent) => {
    ptrs.delete(e.pointerId);
    lastPinch = 0;
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    cam.zoom(Math.exp(e.deltaY * 0.0012));
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  const io = new IntersectionObserver((es) => {
    visible = es[es.length - 1]?.isIntersecting ?? true;
  });
  io.observe(box);

  // ─ frame ─────────────────────────────────────────────────────────
  const frame = (now: number) => {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    if (!visible || document.hidden) return;
    const dt = (now - lastFrame) / 1000;
    if (now - lastDraw < 32 && lastDraw !== 0) return; // ≤ 30 fps
    lastFrame = now;

    const st = useRadar.getState();
    const pose = st.pose;
    const want = st.settings.viewPreset;

    // camera presets & target following
    const followPose = true;
    if (want !== preset) {
      preset = want;
      followYawOffset = 0;
      const [yaw, elev, dist] = PRESET[want];
      cam.set(yaw, elev, dist, followPose ? pose.x : 0, followPose ? pose.z : 0);
    }
    cam.gtx += ((followPose ? pose.x : 0) - cam.gtx) * 0.12;
    cam.gtz += ((followPose ? pose.z : 0) - cam.gtz) * 0.12;
    if (want === "follow" && ptrs.size === 0) {
      const base = (pose.headingDeg * Math.PI) / 180 + Math.PI + followYawOffset;
      cam.gYaw = base + TAU * Math.round((cam.gYaw - base) / TAU);
    }
    const camMoving = cam.update(Math.max(dt, 1 / 60));

    // cheap change detection → skip the draw when nothing visible changed
    const sonar = effectiveSonar(st);
    const sig = `${cloud.version}|${grid.version}|${pose.x.toFixed(2)}|${pose.z.toFixed(2)}|${pose.headingDeg.toFixed(0)}|${sonar?.distM ?? "-"}|${st.meshOn}|${st.trajectory.length}|${st.people.length}|${JSON.stringify(st.settings.kindFilter)}`;
    if (!camMoving && sig === lastSig && now - lastDraw < 1000 && lastDraw !== 0 && ptrs.size === 0)
      return;
    lastSig = sig;
    lastDraw = now;
    const tStart = performance.now();

    // size & dpr (adaptive: drop resolution when frames are consistently slow)
    const b = box.getBoundingClientRect();
    r.resize(b.width, b.height, dprCap, cam.fov);

    const kf = st.settings.kindFilter;
    r.begin(cam.viewProj(Math.max(0.1, b.width / Math.max(1, b.height))), BG);
    // grid snaps to whole metres around the target so it feels infinite
    r.drawBatch(gridB, Math.round(cam.tx), 0, Math.round(cam.tz));
    r.drawBatch(ringsB, pose.x, 0, pose.z);

    // occupancy cells
    if (st.meshOn) {
      if (!occOn || grid.version !== occV) {
        occOn = true;
        occV = grid.version;
        occB.clear();
        const c = grid.cell;
        const col = hex("#4d6b60", 0.55);
        grid.forEachOccupied(0.65, (x, z, p) => {
          const h = 0.1 + (p - 0.65) * 1.2;
          occB.add(x, h / 2, z, c * 0.92, h, c * 0.92, col);
        });
      }
      r.drawBoxes(occB);
    } else occOn = false;

    // clouds (zero-copy from the ring buffers; re-uploaded only on version change)
    for (const k of CLOUD_KINDS) {
      if (!kf[k]) continue;
      const ring = cloud.rings[k];
      const l = layers[k];
      l.count = ring.size;
      l.version = ring.version;
      r.drawPoints(l);
    }

    // tracked people silhouettes
    for (let i = 0; i < Math.min(8, st.people.length); i++) {
      const p = st.people[i];
      if (!p) continue;
      person.offset = [p.pos.x, p.pos.y, p.pos.z];
      person.scale = [1, 1, 1];
      person.color = hex("#7dba9a", 0.95);
      r.drawPoints(person);
    }

    // trajectory polyline
    if (kf.traj !== false) {
      const tr = st.trajectory;
      if (tr.length !== trajN) {
        trajN = tr.length;
        trajB.clear();
        const c = hex("#c4a574", 0.85);
        for (let i = 1; i < Math.min(tr.length, 3000); i++) {
          const a = tr[i - 1] as { x: number; z: number };
          const p = tr[i] as { x: number; z: number };
          trajB.line(a.x, 0.06, a.z, p.x, 0.06, p.z, c);
        }
      }
      r.drawBatch(trajB);
    }

    // observer: heading wedge on the floor, marker, sonar ray
    dyn.clear();
    const h = (pose.headingDeg * Math.PI) / 180;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const rx = fz;
    const rz = -fx;
    const wc = hex("#8fb4b8", 0.28);
    dyn.tri(
      pose.x + fx * 1.1, 0.05, pose.z + fz * 1.1,
      pose.x - rx * 0.4, 0.05, pose.z - rz * 0.4,
      pose.x + rx * 0.4, 0.05, pose.z + rz * 0.4,
      wc,
    );
    const edge = hex("#8fb4b8", 0.7);
    dyn.line(pose.x, 0.06, pose.z, pose.x + fx * 1.1, 0.06, pose.z + fz * 1.1, edge);
    dyn.line(pose.x, 0.0, pose.z, pose.x, pose.heightM, pose.z, hex("#ece8e0", 0.35));
    const d = sonar?.distM ?? null;
    if (d !== null) {
      const c = sonar?.source === "device" ? hex("#7dba9a", 0.6) : hex("#8fb4b8", 0.5);
      const y = pose.heightM - 0.2;
      const ex = pose.x + fx * d;
      const ez = pose.z + fz * d;
      const w = 0.03;
      dyn.quad(pose.x - rx * w, y, pose.z - rz * w, pose.x + rx * w, y, pose.z + rz * w, ex + rx * w, y, ez + rz * w, ex - rx * w, y, ez - rz * w, c);
      dyn.quad(pose.x, y - w, pose.z, pose.x, y + w, pose.z, ex, y + w, ez, ex, y - w, ez, c);
    }
    r.drawBatch(dyn);
    marker.offset = [pose.x, pose.heightM, pose.z];
    r.drawPoints(marker);

    const ms = performance.now() - tStart;
    record("render.3d", ms);
    // frame pacing: if the draw is consistently > 12 ms, lower the pixel ratio (floor 1.0)
    slow = ms > 12 ? Math.min(slow + 1, 120) : Math.max(slow - 1, 0);
    if (slow > 90 && dprCap > 1) {
      dprCap = Math.max(1, dprCap - 0.25);
      slow = 0;
    }
  };
  raf = requestAnimationFrame(frame);

  return () => {
    alive = false;
    cancelAnimationFrame(raf);
    io.disconnect();
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("pointercancel", onUp);
    canvas.removeEventListener("wheel", onWheel);
  };
}
