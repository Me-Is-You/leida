import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
import fs from "node:fs";
const base = process.env.BASE || "http://localhost:8080";
const b = await pw.launch({ executablePath: await chromium.executablePath(), headless: true, args: ["--no-sandbox"] });
const p = await (await b.newContext({ viewport: { width: 800, height: 600 } })).newPage();
p.on("pageerror", (e) => console.log("PAGEERR", e.message.slice(0, 200)));
await p.goto(base + "/vision", { waitUntil: "load" });
await p.waitForTimeout(1500);
const r = await p.evaluate(async () => {
  const c = document.createElement("canvas");
  c.width = 960; c.height = 640;
  const x = c.getContext("2d");
  const g = x.createLinearGradient(0, 0, 960, 0);
  g.addColorStop(0, "#f2f2f2"); g.addColorStop(1, "#6a6a6a"); // strong lighting gradient
  x.fillStyle = g; x.fillRect(0, 0, 960, 640);
  x.fillStyle = "#111"; x.font = "bold 44px sans-serif";
  const lines = ["AETHER RADAR STATION", "Sonar echo at 1.50 metres", "Serial 4096 Hello World"];
  lines.forEach((t, i) => x.fillText(t, 120, 260 + i * 70));
  const { prepareForOcr } = await import("/src/lib/ocr-prep.ts");
  const prep = prepareForOcr(c);
  const { runOcr } = await import("/src/lib/vision.ts");
  const t0 = performance.now();
  const res = await runOcr(c, "eng");
  return { prepImg: prep.canvas.toDataURL("image/png"), lines: prep.lines, size: [prep.canvas.width, prep.canvas.height], prepMs: prep.ms, res, ocrMs: performance.now() - t0 };
});
fs.writeFileSync("/home/user/browser/ocr_prep.png", Buffer.from(r.prepImg.split(",")[1], "base64"));
console.log(JSON.stringify({ ...r, prepImg: undefined }));
await b.close();
