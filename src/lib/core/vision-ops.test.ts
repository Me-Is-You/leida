import assert from "node:assert/strict";
import test from "node:test";
import { components, grayStats, iou, rgbaToGray, sauvola, textRegions } from "./imageops.ts";
import { MotionDetector } from "./motion-detect.ts";
import { mulberry32 } from "./fixtures/prng.ts";

test("rgbaToGray weights sum to 256 (white stays 255, black 0)", () => {
  const out = new Uint8Array(2);
  rgbaToGray([255, 255, 255, 255, 0, 0, 0, 255], out);
  assert.deepEqual([...out], [255, 0]);
});

test("grayStats: flat frame has zero texture/contrast; difference gives motion", () => {
  const a = new Uint8Array(64 * 48).fill(100);
  const b = new Uint8Array(64 * 48).fill(110);
  const s = grayStats(a, 64, b);
  assert.equal(s.brightness, 100);
  assert.equal(s.texture, 0);
  assert.equal(s.contrast, 0);
  assert.ok(Math.abs(s.motion - 10 / 255) < 1e-9);
  assert.equal(grayStats(a, 64, null).motion, 0);
});

/** Dark "text" bars on paper with a strong left→right lighting gradient. */
function page(w: number, h: number) {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const paper = 90 + (150 * x) / w; // 90 … 240
      const bar = y % 14 >= 4 && y % 14 < 9 && x > 8 && x < w - 8 && (x % 7 < 5);
      g[y * w + x] = bar ? paper * 0.45 : paper;
    }
  return g;
}

test("Sauvola recovers ink under uneven light where a global threshold cannot", () => {
  const w = 160, h = 84;
  const g = page(w, h);
  const ink = sauvola(g, w, h, 15);
  let tp = 0, fn = 0, fp = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const truth = y % 14 >= 4 && y % 14 < 9 && x > 8 && x < w - 8 && x % 7 < 5;
      const got = ink[y * w + x] === 1;
      if (truth && got) tp++;
      else if (truth) fn++;
      else if (got) fp++;
    }
  assert.ok(tp / (tp + fn) > 0.95, `recall ${tp / (tp + fn)}`);
  assert.ok(fp / (tp + fp) < 0.05, `false-positive share ${fp / (tp + fp)}`);
  // a global mid threshold fails on the dark side of the gradient
  let globalHit = 0;
  for (let i = 0; i < g.length; i++) if (g[i]! < 128) globalHit++;
  assert.ok(globalHit > tp * 1.5);
});

test("textRegions finds the text lines", () => {
  const w = 160, h = 84;
  const boxes = textRegions(page(w, h), w, h);
  assert.ok(boxes.length >= 4 && boxes.length <= 8, `${boxes.length} boxes`);
  for (const b of boxes) assert.ok(b.w > 100);
});

test("components labels separate blobs and merges U-shapes", () => {
  const w = 12, h = 8;
  const m = new Uint8Array(w * h);
  const set = (x: number, y: number) => (m[y * w + x] = 1);
  for (let y = 1; y < 6; y++) { set(1, y); set(4, y); }
  set(2, 5); set(3, 5); // U shape
  set(9, 2); set(10, 2); // separate blob
  const boxes = components(m, w, h).sort((a, b) => a.x - b.x);
  assert.equal(boxes.length, 2);
  assert.deepEqual([boxes[0]!.x, boxes[0]!.w, boxes[0]!.h], [1, 4, 5]);
  assert.equal(boxes[1]!.area, 2);
});

test("iou", () => {
  assert.equal(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 }), 1);
  assert.equal(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 0, w: 5, h: 5 }), 0);
  assert.ok(Math.abs(iou({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 0, w: 10, h: 10 }) - 1 / 3) < 1e-9);
});

function scene(w: number, h: number, t: number, rnd: () => number, exposure = 0, still = false) {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) g[y * w + x] = Math.max(0, Math.min(255, 80 + 40 * Math.sin(x / 9) + 30 * Math.cos(y / 7) + (rnd() - 0.5) * 6 + exposure));
  // moving bright square 14×14 travelling right
  const sx = still ? 6 : 6 + t * 3;
  if (t >= 0) for (let y = 20; y < 34; y++) for (let x = sx; x < sx + 14 && x < w; x++) g[y * w + x] = 235;
  return g;
}

test("MotionDetector reports the moving square, nothing when the scene is static", () => {
  const w = 96, h = 72;
  const rnd = mulberry32(2);
  const det = new MotionDetector(w, h);
  let last = null as ReturnType<typeof det.update> | null;
  for (let t = 0; t < 10; t++) det.update(scene(w, h, -1, rnd)); // empty scene warm-up
  for (let t = 1; t < 12; t++) last = det.update(scene(w, h, t, rnd));
  assert.ok(last && !last.egoMotion);
  assert.equal(last.boxes.length, 1, `boxes ${last.boxes.length}`);
  const b = last.boxes[0]!;
  assert.ok(b.w >= 12 && b.h >= 12 && b.y >= 17 && b.y <= 22);
  assert.ok(b.x > 6 + 8 * 3 - 4, `box should follow the square, x=${b.x}`);
  // static scene (square frozen) → after the background absorbs it, no motion boxes
  const det2 = new MotionDetector(w, h);
  const rnd2 = mulberry32(3);
  let r2 = null as ReturnType<typeof det2.update> | null;
  for (let t = 0; t < 40; t++) r2 = det2.update(scene(w, h, -1, rnd2));
  assert.equal(r2!.boxes.length, 0);
});

test("MotionDetector: exposure jump is compensated, camera shake is gated as ego-motion", () => {
  const w = 96, h = 72;
  const rnd = mulberry32(4);
  const det = new MotionDetector(w, h);
  for (let t = 0; t < 12; t++) det.update(scene(w, h, -1, rnd));
  const bright = det.update(scene(w, h, -1, rnd, 25)); // auto-exposure +25 levels everywhere
  assert.equal(bright.egoMotion, false);
  assert.equal(bright.boxes.length, 0);
  const noisy = new Uint8Array(w * h);
  for (let i = 0; i < noisy.length; i++) noisy[i] = rnd() * 255; // completely different frame
  const shake = det.update(noisy);
  assert.equal(shake.egoMotion, true);
  assert.equal(shake.boxes.length, 0);
});

import { DetectScheduler } from "./detect-sched.ts";

test("DetectScheduler: always runs when active, relaxes when static, wakes on change", () => {
  const s = new DetectScheduler();
  let now = 0;
  let runs = 0;
  // 3 s of active scene at 8 fps: every frame runs
  for (let i = 0; i < 24; i++, now += 125) {
    const d = s.decide(now, { motion: 0.05, moving: 1, ego: false, tracks: 1 });
    assert.equal(d.mode, "active");
    if (d.runNN) { s.noteNn(now); runs++; }
  }
  assert.equal(runs, 24);
  // 12 s static, no tracks: ≈ 1 run / 1.2 s then 1 / 2.5 s
  runs = 0;
  const t0 = now;
  for (let i = 0; i < 96; i++, now += 125) {
    const d = s.decide(now, { motion: 0.001, moving: 0, ego: false, tracks: 0 });
    if (d.runNN) { s.noteNn(now); runs++; }
  }
  assert.ok(runs >= 4 && runs <= 9, `static runs ${runs} over ${(now - t0) / 1000}s`);
  assert.ok(s.savedFraction > 0.4);
  // sudden motion wakes it immediately
  const w = s.decide(now, { motion: 0.0, moving: 0, ego: true, tracks: 0 });
  assert.equal(w.runNN, true);
  assert.equal(w.mode, "active");
});

import { planOcr } from "./imageops.ts";

test("planOcr: detects light-on-dark polarity and a tight crop", () => {
  const w = 200, h = 120;
  // text block only in the lower-right quarter, white text on dark paper
  const g = new Uint8Array(w * h).fill(30);
  for (let y = 70; y < 110; y++)
    for (let x = 100; x < 190; x++) if (y % 12 >= 3 && y % 12 < 8 && x % 6 < 4) g[y * w + x] = 225;
  const p = planOcr(g, w, h);
  assert.equal(p.invert, true);
  assert.ok(p.regions.length >= 2, `${p.regions.length} lines`);
  assert.ok(p.crop && p.crop.x >= 60 && p.crop.y >= 40, JSON.stringify(p.crop));
  // dark text on light paper: no inversion
  const q = new Uint8Array(w * h).fill(220);
  for (let y = 20; y < 60; y++) for (let x = 20; x < 150; x++) if (y % 12 >= 3 && y % 12 < 8 && x % 6 < 4) q[y * w + x] = 30;
  const pq = planOcr(q, w, h);
  assert.equal(pq.invert, false);
  assert.ok(pq.regions.length >= 2);
});
