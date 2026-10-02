import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bearingOf, estimateDepth, projectToWorld, vfovDeg, type CameraModel, type Pose } from "./camera-model.ts";
import { IouTracker, iou } from "./tracker.ts";
import { PointCloud, PointRing } from "./cloud.ts";
import { OccupancyGrid } from "./occupancy.ts";
import { fuseRanges } from "./fuse.ts";
import { EnvClassifier, classifyOnce } from "./env-classify.ts";
import { AlertEngine } from "./alerts.ts";
import { DEFAULT_SETTINGS, LEGACY_SETTINGS_KEY, SETTINGS_KEY, loadSettings, parseSettings, saveSettings } from "./settings.ts";
import { parseSession } from "./session-schema.ts";

const cam: CameraModel = { hfovDeg: 75, aspect: 4 / 3 };
const pose0: Pose = { x: 0, z: 0, headingDeg: 0, pitchDeg: 0, heightM: 1.4 };

describe("camera model", () => {
  it("vertical FOV from horizontal FOV and aspect", () => {
    const v = vfovDeg({ hfovDeg: 90, aspect: 1 });
    assert.ok(Math.abs(v - 90) < 1e-9);
    assert.ok(vfovDeg(cam) < 75);
  });

  it("person height prior gives a sensible depth", () => {
    // person filling half of the frame height at 75°/4:3 → ≈ 1.7 / (2·tan(vfov/2)·0.5)
    const e = estimateDepth("person", { x: 0.4, y: 0.25, w: 0.2, h: 0.5 }, cam);
    assert.equal(e.basis, "height-prior");
    assert.ok(e.depthM > 2.0 && e.depthM < 3.5, `depth ${e.depthM}`);
    assert.equal(e.truncated, false);
  });

  it("a cropped box is flagged and has larger σ", () => {
    const a = estimateDepth("person", { x: 0.4, y: 0.25, w: 0.2, h: 0.5 }, cam);
    const b = estimateDepth("person", { x: 0.4, y: 0.0, w: 0.2, h: 0.7 }, cam);
    assert.equal(b.truncated, true);
    assert.ok(b.sigmaM / b.depthM > a.sigmaM / a.depthM);
  });

  it("unknown class falls back with high uncertainty", () => {
    const e = estimateDepth("banana", { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, cam);
    assert.equal(e.basis, "area-fallback");
    assert.ok(e.sigmaM / e.depthM >= 0.5);
  });

  it("projects the image centre straight ahead and respects heading", () => {
    const p = projectToWorld(0.5, 0.5, 2, cam, pose0);
    assert.ok(Math.abs(p.x) < 1e-9 && Math.abs(p.z - 2) < 1e-9 && Math.abs(p.y - 1.4) < 1e-9);
    const e = projectToWorld(0.5, 0.5, 2, cam, { ...pose0, headingDeg: 90 });
    assert.ok(Math.abs(e.x - 2) < 1e-9 && Math.abs(e.z) < 1e-9);
    const r = projectToWorld(1, 0.5, 2, cam, pose0);
    assert.ok(r.x > 0, "right edge is east when facing north");
    const w = projectToWorld(1, 0.5, 2, cam, { ...pose0, headingDeg: 180 });
    assert.ok(w.x < 0, "right edge is west when facing south");
  });

  it("pitch raises the projected point", () => {
    const p = projectToWorld(0.5, 0.5, 2, cam, { ...pose0, pitchDeg: 30 });
    assert.ok(p.y > 1.4 + 0.9);
    assert.ok(p.z < 2);
  });

  it("bearing of the right edge is half the horizontal FOV", () => {
    assert.ok(Math.abs(bearingOf(1, cam) - 37.5) < 1e-9);
    assert.ok(Math.abs(bearingOf(0.5, cam)) < 1e-9);
  });
});

describe("iou tracker", () => {
  const det = (x: number, cls = "person") => ({ cls, score: 0.8, bbox: [x, 0.2, 0.2, 0.5] as [number, number, number, number] });

  it("iou basics", () => {
    assert.equal(iou([0, 0, 1, 1], [2, 2, 1, 1]), 0);
    assert.ok(Math.abs(iou([0, 0, 1, 1], [0, 0, 1, 1]) - 1) < 1e-12);
    assert.ok(Math.abs(iou([0, 0, 1, 1], [0.5, 0, 1, 1]) - 1 / 3) < 1e-12);
  });

  it("keeps ids stable while an object moves, confirms after 2 hits", () => {
    const t = new IouTracker();
    assert.equal(t.update([det(0.1)]).length, 0, "not confirmed on first frame");
    const a = t.update([det(0.12)]);
    assert.equal(a.length, 1);
    const id = a[0]?.id;
    for (let i = 0; i < 10; i++) {
      const o = t.update([det(0.12 + i * 0.01)]);
      assert.equal(o[0]?.id, id);
    }
  });

  it("separates classes and survives a short occlusion, then expires", () => {
    const t = new IouTracker({ maxMisses: 3 });
    t.update([det(0.1), det(0.6, "chair")]);
    const out = t.update([det(0.1), det(0.6, "chair")]);
    assert.equal(out.length, 2);
    const ids = out.map((o) => o.id);
    t.update([]);
    const back = t.update([det(0.1), det(0.6, "chair")]);
    assert.deepEqual(back.map((o) => o.id).sort(), ids.sort());
    for (let i = 0; i < 5; i++) t.update([]);
    assert.equal(t.tracks.length, 0);
  });
});

describe("point cloud", () => {
  it("de-duplicates static observations (voxel) and counts distinct points", () => {
    const r = new PointRing(100, 0.1);
    for (let i = 0; i < 1000; i++) r.add(1 + (i % 3) * 0.001, 1, 1);
    assert.equal(r.size, 1);
    r.add(2, 1, 1);
    assert.equal(r.size, 2);
  });

  it("is bounded: overwrites the oldest points when full", () => {
    const r = new PointRing(50, 0.01);
    for (let i = 0; i < 500; i++) r.add(i * 0.5, 0, 0);
    assert.equal(r.size, 50);
    // oldest voxel was evicted → can be added again as new
    assert.equal(r.add(0, 0, 0), true);
  });

  it("rejects NaN, reports version changes and exports PLY", () => {
    const c = new PointCloud();
    const v0 = c.version;
    assert.equal(c.add("wall", NaN, 0, 0), false);
    assert.equal(c.version, v0);
    c.add("wall", 1, 2, 3);
    c.add("person", 0, 1, 2);
    assert.ok(c.version > v0);
    assert.equal(c.total, 2);
    const ply = c.toPly();
    assert.ok(ply.includes("element vertex 2"));
    assert.equal(c.toJSON().length, 2);
    c.clear();
    assert.equal(c.total, 0);
  });
});

describe("occupancy grid", () => {
  it("marks the hit occupied and the ray free", () => {
    const g = new OccupancyGrid(0.25);
    for (let i = 0; i < 3; i++) g.integrateRay(0, 0, 0, 3, true);
    assert.ok((g.probability(0.1, 3.1) as number) > 0.8);
    assert.ok((g.probability(0.1, 1.5) as number) < 0.3);
    assert.equal(g.probability(5, 5), null);
    assert.ok(g.occupiedCells().length >= 1);
    assert.ok(g.explored().cells > 10);
  });

  it("a max-range ray without hit makes no occupied cell", () => {
    const g = new OccupancyGrid(0.25);
    g.integrateRay(0, 0, 0, 4, false);
    assert.equal(g.occupiedCells().length, 0);
  });
});

describe("range fusion", () => {
  it("combines by inverse variance and shrinks σ", () => {
    const f = fuseRanges([
      { id: "sonar", rangeM: 2.0, sigmaM: 0.02, weight: 1 },
      { id: "vision", rangeM: 2.2, sigmaM: 0.5, weight: 1 },
    ]);
    assert.ok(Math.abs((f.rangeM as number) - 2.0) < 0.01);
    assert.ok((f.sigmaM as number) < 0.02);
    assert.deepEqual(f.used.sort(), ["sonar", "vision"]);
  });

  it("mode weights shift the result", () => {
    const base = [
      { id: "sonar" as const, rangeM: 2.0, sigmaM: 0.3, weight: 1 },
      { id: "vision" as const, rangeM: 2.4, sigmaM: 0.3, weight: 1 },
    ];
    const eq = fuseRanges(base).rangeM as number;
    const vis = fuseRanges([base[0] as (typeof base)[0], { ...(base[1] as (typeof base)[0]), weight: 4 }]).rangeM as number;
    assert.ok(Math.abs(eq - 2.2) < 1e-9);
    assert.ok(vis > eq);
  });

  it("rejects outliers and reports the conflict", () => {
    const f = fuseRanges([
      { id: "sonar", rangeM: 1.0, sigmaM: 0.02, weight: 1 },
      { id: "vision", rangeM: 4.0, sigmaM: 0.4, weight: 1 },
    ]);
    assert.equal(f.conflict, true);
    assert.deepEqual(f.rejected, ["vision"]);
    assert.ok(Math.abs((f.rangeM as number) - 1.0) < 1e-9);
  });

  it("returns null when there is no data", () => {
    assert.equal(fuseRanges([]).rangeM, null);
    assert.equal(fuseRanges([{ id: "sonar", rangeM: NaN, sigmaM: 1, weight: 1 }]).rangeM, null);
  });
});

describe("environment classifier", () => {
  const m = (o: Partial<Parameters<typeof classifyOnce>[0]>) => ({
    brightness: 80,
    texture: 0.2,
    noise: 20,
    lux: null,
    rssiSigma: null,
    ...o,
  });

  it("classifies once", () => {
    assert.equal(classifyOnce(m({ brightness: 20 })), "lowlight");
    assert.equal(classifyOnce(m({ brightness: 200 })), "bright");
    assert.equal(classifyOnce(m({ texture: 0.6 })), "clutter");
    assert.equal(classifyOnce(m({ rssiSigma: 4 })), "through");
    assert.equal(classifyOnce(m({ brightness: null })), null);
  });

  it("needs dwell before flipping and ignores flicker", () => {
    const c = new EnvClassifier(5);
    for (let i = 0; i < 4; i++) c.update(m({ brightness: 20 }));
    assert.equal(c.mode, "indoor");
    c.update(m({ brightness: 80 })); // flicker back resets
    for (let i = 0; i < 4; i++) c.update(m({ brightness: 20 }));
    assert.equal(c.mode, "indoor");
    for (let i = 0; i < 2; i++) c.update(m({ brightness: 20 }));
    assert.equal(c.mode, "lowlight");
  });

  it("holds the mode without camera data", () => {
    const c = new EnvClassifier(2);
    for (let i = 0; i < 3; i++) c.update(m({ brightness: 20 }));
    assert.equal(c.mode, "lowlight");
    for (let i = 0; i < 10; i++) c.update(m({ brightness: null }));
    assert.equal(c.mode, "lowlight");
  });
});

describe("alerts", () => {
  it("fires once on the rising edge, then stays quiet while the condition persists", () => {
    const a = new AlertEngine(8000, 1500);
    let n = 0;
    for (let t = 0; t < 30000; t += 100) n += a.update(t, { magAnomaly: true }).length;
    assert.equal(n, 1);
  });

  it("re-arms after clearing and respects the cooldown", () => {
    const a = new AlertEngine(8000, 1000);
    assert.equal(a.update(0, { magAnomaly: true }).length, 1);
    a.update(500, { magAnomaly: false });
    a.update(2000, { magAnomaly: false });
    assert.equal(a.update(2500, { magAnomaly: true }).length, 0, "cooldown");
    a.update(3000, { magAnomaly: false });
    a.update(4500, { magAnomaly: false });
    assert.equal(a.update(9000, { magAnomaly: true }).length, 1);
  });

  it("reports new persons and ignores null sonar / brightness", () => {
    const a = new AlertEngine();
    assert.equal(a.update(0, { personCount: 0, sonarM: null, brightness: null }).length, 0);
    const out = a.update(100, { personCount: 1 });
    assert.equal(out[0]?.key, "person");
    assert.equal(a.update(200, { personCount: 1 }).length, 0);
  });

  it("near-echo alert needs a real distance", () => {
    const a = new AlertEngine();
    assert.equal(a.update(0, { sonarM: 0.3 })[0]?.key, "near");
  });
});

describe("settings", () => {
  const mem = (init: Record<string, string> = {}) => {
    const m = new Map(Object.entries(init));
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };

  it("defaults are valid and demo mode is the default", () => {
    assert.equal(DEFAULT_SETTINGS.dataMode, "demo");
    assert.equal(DEFAULT_SETTINGS.version, 2);
  });

  it("salvages valid fields when one is corrupt", () => {
    const s = parseSettings({ mapDensity: 99, personOnly: true, envManual: "lowlight" });
    assert.equal(s.personOnly, true);
    assert.equal(s.envManual, "lowlight");
    assert.equal(s.mapDensity, DEFAULT_SETTINGS.mapDensity);
  });

  it("migrates the v18 key and round-trips", () => {
    const st = mem({ [LEGACY_SETTINGS_KEY]: JSON.stringify({ envManual: "bright", detectOn: false, junk: 1 }) });
    const s = loadSettings(st);
    assert.equal(s.envManual, "bright");
    assert.equal(s.detectOn, false);
    saveSettings(st, { ...s, hdr: true });
    assert.equal(loadSettings(st).hdr, true);
    assert.ok(st.m.has(SETTINGS_KEY));
  });

  it("tolerates garbage", () => {
    assert.equal(loadSettings(mem({ [SETTINGS_KEY]: "{not json" })).dataMode, "demo");
    assert.equal(loadSettings(null).dataMode, "demo");
  });
});

describe("session schema", () => {
  it("accepts v2", () => {
    const r = parseSession({
      format: "aether-session",
      version: 2,
      dataMode: "real",
      points: [{ kind: "wall", x: 1, y: 2, z: 3 }],
      trajectory: [{ x: 0, z: 0 }],
    });
    assert.equal(r.ok, true);
  });

  it("migrates legacy v18 exports as demo data and drops unknown kinds", () => {
    const r = parseSession({
      version: "18.0",
      points: [
        { x: 1, y: 1, z: 1, kind: "wall", t: 1 },
        { x: 1, y: 1, z: 1, kind: "ufo", t: 1 },
      ],
      trajectory: [{ x: 0, y: 0, z: 0 }],
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.legacy, true);
      assert.equal(r.data.dataMode, "demo");
      assert.equal(r.data.points.length, 1);
    }
  });

  it("rejects NaN / malformed / hostile input with a message", () => {
    const bad = parseSession({ format: "aether-session", version: 2, dataMode: "real", points: [{ kind: "wall", x: "a", y: 0, z: 0 }] });
    assert.equal(bad.ok, false);
    assert.equal(parseSession(null).ok, false);
    assert.equal(parseSession({ version: "18.0", points: [{ x: null, y: 0, z: 0, kind: "wall" }] }).ok, false);
  });
});
