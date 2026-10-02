import { prepareForOcr } from "./ocr-prep.ts";
import { record } from "./perf.ts";
import type { ObjectKind } from "./types";

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

/** Raw detector output, normalised to 0‥1 of the video frame. */
export interface RawDet {
  cls: string;
  score: number;
  bbox: [number, number, number, number];
}

type CocoModel = {
  detect: (
    src: HTMLVideoElement,
    maxDetections?: number,
    minScore?: number,
  ) => Promise<Array<{ class: string; score: number; bbox: [number, number, number, number] }>>;
};

let coco: CocoModel | null = null;
let cocoStatus: "idle" | "loading" | "ready" | "fail" = "idle";
let cocoPromise: Promise<boolean> | null = null;
let cocoSource: "local" | "cdn" | "none" = "none";

export function cocoState() {
  return cocoStatus;
}

export function cocoModelSource() {
  return cocoSource;
}

const LOCAL_MODEL = "/vendor/coco-ssd/model.json";

/** Loads the self-hosted COCO-SSD; only if that is missing does it try the library default host. */
export function loadCoco(): Promise<boolean> {
  if (coco) return Promise.resolve(true);
  if (typeof window === "undefined") return Promise.resolve(false);
  if (cocoPromise) return cocoPromise;
  cocoStatus = "loading";
  cocoPromise = (async () => {
    try {
      const tf = await import("@tensorflow/tfjs");
      await tf.setBackend("webgl").catch(() => tf.setBackend("cpu"));
      await tf.ready();
      const mod = await import("@tensorflow-models/coco-ssd");
      try {
        coco = (await mod.load({ modelUrl: LOCAL_MODEL })) as unknown as CocoModel;
        cocoSource = "local";
      } catch {
        coco = (await mod.load({ base: "lite_mobilenet_v2" })) as unknown as CocoModel;
        cocoSource = "cdn";
      }
      cocoStatus = "ready";
      return true;
    } catch {
      cocoStatus = "fail";
      coco = null;
      cocoPromise = null; // allow a retry
      return false;
    }
  })();
  return cocoPromise;
}

/** Runs the detector on the live <video>. Returns null when not ready. */
export async function detectCoco(video: HTMLVideoElement, minScore: number): Promise<RawDet[] | null> {
  if (!coco || video.readyState < 2) return null;
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  try {
    const raw = await coco.detect(video, 20, minScore);
    return raw
      .filter((d) => d.score >= minScore)
      .map((d) => ({
        cls: d.class,
        score: d.score,
        bbox: [d.bbox[0] / vw, d.bbox[1] / vh, d.bbox[2] / vw, d.bbox[3] / vh] as [number, number, number, number],
      }));
  } catch {
    return null;
  }
}

export function boxContour(x: number, y: number, w: number, h: number): number[] {
  return [x, y, x + w, y, x + w, y + h, x, y + h];
}

// ───────────────────────── OCR (self-hosted tesseract.js) ─────────────────────────

type OcrWorker = {
  recognize: (img: HTMLCanvasElement) => Promise<{ data: { text: string; confidence: number } }>;
  terminate: () => Promise<unknown>;
};

let ocrWorker: OcrWorker | null = null;
let ocrLang = "";
let ocrBusy = false;

export function ocrBusyNow() {
  return ocrBusy;
}

export async function runOcr(
  canvas: HTMLCanvasElement,
  lang: "eng" | "chi_sim+eng",
): Promise<{ text: string; confidence: number; lines: number; enhanced: boolean }> {
  if (ocrBusy) return { text: "", confidence: 0, lines: 0, enhanced: false };
  ocrBusy = true;
  try {
    if (!ocrWorker || ocrLang !== lang) {
      await ocrWorker?.terminate();
      const T = await import("tesseract.js");
      ocrWorker = (await T.createWorker(lang, 1, {
        workerPath: "/vendor/tesseract/worker.min.js",
        corePath: "/vendor/tesseract",
        langPath: "/vendor/tesseract/lang",
        gzip: true,
      })) as unknown as OcrWorker;
      ocrLang = lang;
    }
    // own pre-processing first (crop to text lines, Sauvola); if it reads poorly, retry on the untouched frame and keep the better one
    const prep = prepareForOcr(canvas);
    if (prep) record("ocr.prep", prep.ms);
    const t0 = performance.now();
    const pick = (r: { data: { text: string; confidence: number } }) => ({ text: (r.data.text || "").trim(), confidence: r.data.confidence ?? 0 });
    let best = pick(await ocrWorker.recognize(prep ? prep.canvas : canvas));
    let enhanced = !!prep;
    if (prep && (best.text.length < 3 || best.confidence < 45)) {
      const raw = pick(await ocrWorker.recognize(canvas));
      if (raw.text.length > best.text.length * 0.8 && raw.confidence >= best.confidence) {
        best = raw;
        enhanced = false;
      }
    }
    record("ocr.recognize", performance.now() - t0);
    return { ...best, lines: prep?.lines ?? 0, enhanced };
  } finally {
    ocrBusy = false;
  }
}

export async function disposeOcr() {
  const w = ocrWorker;
  ocrWorker = null;
  ocrLang = "";
  await w?.terminate();
}
