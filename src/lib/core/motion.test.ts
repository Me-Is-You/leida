import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cameraPitchDeg, compassHeading } from "./compass.ts";
import { PdrTracker, StepDetector, stepLengthFromHeight } from "./pdr.ts";
import { MagBaseline } from "./mag.ts";
import { angleDiffDeg, mulberry32, smoothAngleDeg, wrap360 } from "./math.ts";

describe("compass", () => {
  it("upright phone: back camera heading follows alpha (north → 0°, west → 90°)", () => {
    assert.ok(Math.abs(compassHeading(0, 90, 0) - 0) < 1e-6);
    // Rotating the device counter-clockwise by 90° (alpha=90) faces west (270°)
    assert.ok(Math.abs(compassHeading(90, 90, 0) - 270) < 1e-6);
    assert.ok(Math.abs(compassHeading(270, 90, 0) - 90) < 1e-6);
    assert.ok(Math.abs(compassHeading(180, 90, 0) - 180) < 1e-6);
  });

  it("pitch of an upright phone is ~0, tilted up is positive", () => {
    assert.ok(Math.abs(cameraPitchDeg(90, 0)) < 1e-6);
    assert.ok(cameraPitchDeg(120, 0) > 25);
    assert.ok(cameraPitchDeg(60, 0) < -25);
  });

  it("angle helpers wrap correctly", () => {
    assert.equal(wrap360(-10), 350);
    assert.equal(angleDiffDeg(350, 10), 20);
    assert.equal(angleDiffDeg(10, 350), -20);
    const s = smoothAngleDeg(350, 10, 0.5);
    assert.ok(Math.abs(s - 0) < 1e-9 || Math.abs(s - 360) < 1e-9);
  });
});

describe("pedestrian dead reckoning", () => {
  function walk(freqHz: number, amp: number, seconds: number, noise = 0.1, seed = 3) {
    const det = new StepDetector();
    const rnd = mulberry32(seed);
    let steps = 0;
    const dt = 1 / 60;
    for (let i = 0; i < seconds * 60; i++) {
      const t = i * dt;
      const a = 9.81 + amp * Math.sin(2 * Math.PI * freqHz * t) + (rnd() - 0.5) * noise;
      if (det.push(t, 0.3, a, 0.2)) steps++;
    }
    return steps;
  }

  it("counts ≈ 1.8 steps/s while walking", () => {
    const n = walk(1.8, 2.8, 20);
    assert.ok(n >= 32 && n <= 40, `steps=${n}`);
  });

  it("counts slow walking (1.2 Hz) too", () => {
    const n = walk(1.2, 2.2, 20);
    assert.ok(n >= 21 && n <= 26, `steps=${n}`);
  });

  it("counts nothing while standing still", () => {
    assert.equal(walk(0, 0, 20, 0.25), 0);
  });

  it("ignores tiny tremor", () => {
    assert.equal(walk(8, 0.3, 10, 0.1), 0);
  });

  it("integrates the heading into a track", () => {
    const pdr = new PdrTracker({ x: 0, z: 0 }, 0.7);
    for (let i = 0; i < 10; i++) pdr.step(0); // north (+z)
    for (let i = 0; i < 10; i++) pdr.step(90); // east (+x)
    assert.ok(Math.abs(pdr.state.z - 7) < 1e-9);
    assert.ok(Math.abs(pdr.state.x - 7) < 1e-9);
    assert.equal(pdr.state.steps, 20);
    assert.ok(Math.abs(pdr.state.distance - 14) < 1e-9);
  });

  it("step length from height", () => {
    assert.ok(Math.abs(stepLengthFromHeight(1.7) - 0.7055) < 1e-6);
  });
});

describe("magnetic anomaly detector", () => {
  it("stays quiet on a steady field and flags a metal object", () => {
    const m = new MagBaseline();
    const rnd = mulberry32(5);
    let falsePos = 0;
    for (let i = 0; i < 300; i++) if (m.update(46 + (rnd() - 0.5) * 0.8).anomaly) falsePos++;
    assert.equal(falsePos, 0);
    assert.equal(m.update(46 + 12).anomaly, true);
    // baseline must not chase the anomaly
    for (let i = 0; i < 20; i++) m.update(58);
    assert.ok(Math.abs(m.baseline - 46) < 1);
  });

  it("does not alarm during warm-up", () => {
    const m = new MagBaseline();
    assert.equal(m.update(40).anomaly, false);
    assert.equal(m.update(90).anomaly, false);
  });
});
