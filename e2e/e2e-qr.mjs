import chromium from "@sparticuz/chromium";
import { chromium as pw } from "playwright-core";
const base = process.env.BASE || "http://localhost:8080";
const b = await pw.launch({ executablePath: await chromium.executablePath(), headless: true, args: ["--no-sandbox"] });
const p = await (await b.newContext({ viewport: { width: 800, height: 600 } })).newPage();
p.on("pageerror", (e) => console.log("PAGEERR", e.message.slice(0, 200)));
await p.goto(base + "/vision", { waitUntil: "load" });
await p.waitForTimeout(1500);
const r = await p.evaluate(async () => {
  const { QR_VECTORS } = await import("/src/lib/core/fixtures/qr-vectors.ts");
  const { detectBarcodes, barcodeSupported } = await import("/src/lib/device.ts");
  const out = { bd: barcodeSupported(), res: [] };
  for (const [i, v] of QR_VECTORS.entries()) {
    const c = document.createElement("canvas");
    c.width = 900; c.height = 700;
    const x = c.getContext("2d");
    x.fillStyle = "#cfcfcf"; x.fillRect(0, 0, 900, 700);
    x.translate(450, 350); x.rotate(0.3 + i * 0.4); x.transform(1, 0.05, 0.08, 1, 0, 0);
    const s = Math.floor(320 / (v.size + 8));
    x.fillStyle = "#fff"; x.fillRect(-(v.size + 8) * s / 2, -(v.size + 8) * s / 2, (v.size + 8) * s, (v.size + 8) * s);
    x.fillStyle = "#111";
    for (let yy = 0; yy < v.size; yy++) for (let xx = 0; xx < v.size; xx++) if (v.rows[yy][xx] === "1") x.fillRect((xx - v.size / 2) * s, (yy - v.size / 2) * s, s, s);
    const t0 = performance.now();
    const codes = await detectBarcodes(c, true);
    out.res.push({ name: v.name, ok: codes[0]?.value === v.text, fmt: codes[0]?.format, ms: +(performance.now() - t0).toFixed(1) });
  }
  return out;
});
console.log(JSON.stringify(r));
await b.close();
