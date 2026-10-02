import type { Detection, ObjectKind, SampleSource, Vec3 } from "./types";
import type { FrameBlob } from "./device";

const COCO_KIND: Record<string, ObjectKind> = {
  person: "person",
  bicycle: "vehicle",
  car: "vehicle",
  motorcycle: "vehicle",
  bus: "vehicle",
  truck: "vehicle",
  bird: "animal",
  cat: "animal",
  dog: "animal",
  horse: "animal",
  chair: "furniture",
  couch: "furniture",
  bed: "furniture",
  "dining table": "furniture",
  "potted plant": "plant",
  tv: "appliance",
  laptop: "device",
  mouse: "device",
  remote: "device",
  keyboard: "device",
  "cell phone": "device",
  microwave: "appliance",
  oven: "appliance",
  toaster: "appliance",
  sink: "appliance",
  refrigerator: "appliance",
  book: "device",
  clock: "device",
  vase: "furniture",
  scissors: "metal",
  "hair drier": "appliance",
  toothbrush: "device",
  bottle: "device",
  cup: "device",
  bowl: "device",
  backpack: "device",
  umbrella: "device",
  handbag: "device",
  suitcase: "device",
};

export function kindOfClass(cls: string): ObjectKind {
  return COCO_KIND[cls] ?? (cls === "person" ? "person" : "device");
}

export function blobsToDetections(
  blobs: FrameBlob[],
  observer: Vec3,
  source: SampleSource,
): Detection[] {
  return blobs.map((b, i) => {
    const depth = Math.max(0.55, Math.min(9, 1.55 / Math.sqrt(b.area + 0.012)));
    const px = (b.cx - 0.5) * depth * 1.35 + observer.x;
    const py = Math.max(0, (0.55 - b.cy) * depth * 0.85);
    const pz = observer.z - depth * 0.92;
    return {
      id: `vis-${i}-${b.cls}`,
      cls: b.cls,
      score: b.score,
      bbox: [b.cx - b.w / 2, b.cy - b.h / 2, b.w, b.h],
      depthM: depth,
      world: { x: px, y: py, z: pz },
      source,
      kind: kindOfClass(b.cls),
      contour: b.contour ?? boxContour(b.cx, b.cy, b.w, b.h),
    };
  });
}

export function boxContour(cx: number, cy: number, w: number, h: number): number[] {
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  const x1 = cx + w / 2;
  const y1 = cy + h / 2;
  return [x0, y0, x1, y0, x1, y1, x0, y1];
}

export function extractContour(
  gray: Float32Array,
  w: number,
  h: number,
  bbox: [number, number, number, number],
): number[] {
  const [bx, by, bw, bh] = bbox;
  const x0 = Math.max(1, Math.floor(bx * w));
  const y0 = Math.max(1, Math.floor(by * h));
  const x1 = Math.min(w - 2, Math.ceil((bx + bw) * w));
  const y1 = Math.min(h - 2, Math.ceil((by + bh) * h));
  const pts: number[] = [];
  const push = (x: number, y: number) => {
    pts.push(x / w, y / h);
  };
  for (let x = x0; x <= x1; x += 2) {
    for (let y = y0; y <= y1; y++) {
      const g = gray[y * w + x] ?? 0;
      const n = gray[(y - 1) * w + x] ?? g;
      if (Math.abs(g - n) > 26) {
        push(x, y);
        break;
      }
    }
  }
  for (let y = y0; y <= y1; y += 2) {
    for (let x = x1; x >= x0; x--) {
      const g = gray[y * w + x] ?? 0;
      const n = gray[y * w + x + 1] ?? g;
      if (Math.abs(g - n) > 26) {
        push(x, y);
        break;
      }
    }
  }
  if (pts.length < 6) return boxContour(bx + bw / 2, by + bh / 2, bw, bh);
  return pts;
}

type CocoModel = {
  detect: (src: HTMLVideoElement) => Promise<Array<{ class: string; score: number; bbox: [number, number, number, number] }>>;
};

let coco: CocoModel | null = null;
let cocoStatus: "idle" | "loading" | "ready" | "fail" = "idle";

export function cocoState() {
  return cocoStatus;
}

export async function loadCoco(): Promise<boolean> {
  if (coco) return true;
  if (typeof window === "undefined") return false;
  if (cocoStatus === "loading") return false;
  cocoStatus = "loading";
  try {
    const tf = await import("@tensorflow/tfjs");
    await tf.setBackend("webgl").catch(() => tf.setBackend("cpu"));
    await tf.ready();
    const mod = await import("@tensorflow-models/coco-ssd");
    coco = (await mod.load({ base: "lite_mobilenet_v2" })) as unknown as CocoModel;
    cocoStatus = "ready";
    return true;
  } catch {
    cocoStatus = "fail";
    coco = null;
    return false;
  }
}

export async function detectCoco(
  video: HTMLVideoElement,
  observer: Vec3,
): Promise<Detection[] | null> {
  if (!coco || video.readyState < 2) return null;
  try {
    const raw = await coco.detect(video);
    const vw = video.videoWidth || 1;
    const vh = video.videoHeight || 1;
    return raw.slice(0, 12).map((d, i) => {
      const [x, y, bw, bh] = d.bbox;
      const nx = x / vw;
      const ny = y / vh;
      const nw = bw / vw;
      const nh = bh / vh;
      const area = nw * nh;
      const depth = Math.max(0.5, Math.min(10, 1.7 / Math.sqrt(area + 0.01)));
      return {
        id: `coco-${i}-${d.class}`,
        cls: d.class,
        score: d.score,
        bbox: [nx, ny, nw, nh] as [number, number, number, number],
        depthM: depth,
        world: {
          x: (nx + nw / 2 - 0.5) * depth * 1.35 + observer.x,
          y: Math.max(0, (0.55 - (ny + nh / 2)) * depth * 0.85),
          z: observer.z - depth * 0.92,
        },
        source: "device" as const,
        kind: kindOfClass(d.class),
        contour: boxContour(nx + nw / 2, ny + nh / 2, nw, nh),
      };
    });
  } catch {
    return null;
  }
}

export async function runOcr(canvas: HTMLCanvasElement): Promise<string> {
  const T = (window as unknown as { Tesseract?: { recognize: (src: HTMLCanvasElement, lang: string) => Promise<{ data: { text: string } }> } }).Tesseract;
  if (T) {
    const r = await T.recognize(canvas, "chi_sim+eng");
    return (r.data.text || "").trim();
  }
  return "";
}

export function injectTesseract(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if ((window as unknown as { Tesseract?: unknown }).Tesseract) return Promise.resolve(true);
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}
