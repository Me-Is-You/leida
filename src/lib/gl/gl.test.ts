import assert from "node:assert/strict";
import test from "node:test";
import { invert, mat4, multiply, project, rayAabb } from "./mat4.ts";
import { OrbitCamera } from "./orbit.ts";

const near = (a: number, b: number, e = 1e-4) => assert.ok(Math.abs(a - b) < e, `${a} vs ${b}`);

test("the orbit target projects to the screen centre; points in front have positive w", () => {
  const c = new OrbitCamera();
  c.set(0.8, 0.6, 15, 2, -1, false);
  const vp = c.viewProj(16 / 9);
  const p = project(vp, 2, c.ty, -1) as number[];
  near(p[0]!, 0);
  near(p[1]!, 0);
  assert.ok(p[3]! > 0);
});

test("a point to the camera's right projects to +x NDC, up to +y", () => {
  const c = new OrbitCamera();
  c.set(0, 0.5, 12, 0, 0, false); // camera on +z looking toward −z → right = +x
  const vp = c.viewProj(1);
  assert.ok((project(vp, 1, c.ty, 0) as number[])[0]! > 0);
  assert.ok((project(vp, 0, c.ty + 1, 0) as number[])[1]! > 0);
});

test("invert · matrix ≈ identity", () => {
  const c = new OrbitCamera();
  c.set(1.2, 0.4, 9, 3, 2, false);
  const m = c.viewProj(1.5);
  const inv = invert(mat4(), m)!;
  const id = multiply(mat4(), inv, m);
  for (let i = 0; i < 16; i++) near(id[i]!, i % 5 === 0 ? 1 : 0, 1e-3);
});

test("pickRay through the screen centre hits the target; rayAabb finds a box around it", () => {
  const c = new OrbitCamera();
  c.set(0.4, 0.7, 14, 1, 1, false);
  const r = c.pickRay(0, 0, 1.2)!;
  const t = rayAabb(...r.o, ...r.d, [0.5, -0.5, 0.5], [1.5, 1.5, 1.5]);
  assert.ok(t !== null && t > 0);
  const miss = rayAabb(...r.o, ...r.d, [8, 0, 8], [9, 1, 9]);
  assert.equal(miss, null);
});

test("smoothing converges and reports motion; pan moves the target along the ground", () => {
  const c = new OrbitCamera();
  c.set(0, 0.5, 10, 0, 0, false);
  c.zoom(0.5);
  c.pan(100, 0, 800); // drag right → scene follows → target moves left (−x at yaw 0)
  assert.ok(c.gtx < 0);
  let steps = 0;
  while (c.update(1 / 60) && steps++ < 600);
  assert.ok(steps < 600);
  near(c.dist, 5, 1e-3);
});

test("elevation and distance are clamped", () => {
  const c = new OrbitCamera();
  c.rotate(0, 99);
  assert.ok(c.gElev < Math.PI / 2);
  c.zoom(1e-6);
  assert.equal(c.gDist, c.limits.minDist);
  c.zoom(1e9);
  assert.equal(c.gDist, c.limits.maxDist);
});
