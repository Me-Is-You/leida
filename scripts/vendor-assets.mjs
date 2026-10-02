// Copies third-party runtime assets (OCR engine, language data, COCO-SSD model)
// into public/vendor/ so the app never depends on a CDN at runtime.
// public/vendor/ is git-ignored; this runs when vite loads its config.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const COCO_PKG = "node-red-contrib-tfjs-coco-ssd@1.0.6";

function copyTesseract(root) {
  const out = join(root, "public/vendor/tesseract");
  const marker = join(out, "worker.min.js");
  if (existsSync(marker) && existsSync(join(out, "lang/eng.traineddata.gz"))) return;
  const core = join(root, "node_modules/tesseract.js-core");
  const worker = join(root, "node_modules/tesseract.js/dist/worker.min.js");
  if (!existsSync(core) || !existsSync(worker)) {
    console.warn("[vendor] tesseract.js not installed — OCR disabled");
    return;
  }
  mkdirSync(join(out, "lang"), { recursive: true });
  cpSync(worker, marker);
  for (const f of readdirSync(core)) {
    if (/^tesseract-core.*\.(js|wasm)$/.test(f)) cpSync(join(core, f), join(out, f));
  }
  for (const [lang, dir] of [
    ["eng", "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"],
    ["chi_sim", "node_modules/@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz"],
  ]) {
    const src = join(root, dir);
    if (existsSync(src)) cpSync(src, join(out, "lang", `${lang}.traineddata.gz`));
  }
  console.log("[vendor] tesseract assets ready");
}

function fetchCoco(root) {
  const out = join(root, "public/vendor/coco-ssd");
  if (existsSync(join(out, "model.json"))) return;
  let tmp;
  try {
    tmp = mkdtempSync(join(tmpdir(), "coco-"));
    execFileSync("npm", ["pack", COCO_PKG, "--silent"], { cwd: tmp, stdio: "pipe", timeout: 120000 });
    const tgz = readdirSync(tmp).find((f) => f.endsWith(".tgz"));
    if (!tgz) throw new Error("no tarball");
    execFileSync("tar", ["xzf", tgz, "package/models/coco-ssd"], { cwd: tmp, stdio: "pipe" });
    mkdirSync(out, { recursive: true });
    cpSync(join(tmp, "package/models/coco-ssd"), out, { recursive: true });
    console.log("[vendor] COCO-SSD model ready");
  } catch (e) {
    console.warn(`[vendor] COCO-SSD model not fetched (${e instanceof Error ? e.message : e}); the app falls back to the default model host`);
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  }
}

export function vendorAssets(root = process.cwd()) {
  try {
    copyTesseract(root);
    fetchCoco(root);
  } catch (e) {
    console.warn("[vendor] asset copy failed:", e);
  }
}
