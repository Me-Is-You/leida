import assert from "node:assert/strict";
import test from "node:test";
import { WifiMonitor } from "./wifi-change.ts";
import { mulberry32 } from "./fixtures/prng.ts";

const noisy = (r: () => number, mean: number, sd: number) =>
  Math.round(mean + (r() + r() + r() - 1.5) * 2 * sd);

test("quiet link with ±1.5 dB jitter never raises a disturbance", () => {
  const m = new WifiMonitor();
  const r = mulberry32(1);
  for (let t = 0; t < 300; t++) {
    m.pushLink("aa", noisy(r, -55, 1), t * 1000);
    assert.equal(m.state().disturbed, false, `false alarm at ${t}s`);
  }
});

test("a 9 dB drop is flagged within a few seconds and clears after recovery", () => {
  const m = new WifiMonitor();
  const r = mulberry32(2);
  let t = 0;
  for (; t < 60; t++) m.pushLink("aa", noisy(r, -55, 1), t * 1000);
  let flagged = -1;
  for (let k = 0; k < 20; k++, t++) {
    m.pushLink("aa", noisy(r, -64, 1), t * 1000);
    if (flagged < 0 && m.state().disturbed) flagged = k;
  }
  assert.ok(flagged >= 0 && flagged <= 5, `flagged after ${flagged}s`);
  for (let k = 0; k < 40; k++, t++) m.pushLink("aa", noisy(r, -55, 1), t * 1000);
  assert.equal(m.state().disturbed, false);
});

test("a variance burst (someone walking through the link) is flagged without a mean shift", () => {
  const m = new WifiMonitor();
  const r = mulberry32(3);
  let t = 0;
  for (; t < 60; t++) m.pushLink("aa", noisy(r, -50, 1), t * 1000);
  let any = false;
  for (let k = 0; k < 15; k++, t++) {
    m.pushLink("aa", -50 + (k % 2 ? 7 : -7), t * 1000);
    any ||= m.state().disturbed;
  }
  assert.ok(any);
});

test("a steady new level (moved to another room) re-learns the baseline", () => {
  const m = new WifiMonitor();
  const r = mulberry32(4);
  let t = 0;
  for (; t < 60; t++) m.pushLink("aa", noisy(r, -50, 1), t * 1000);
  for (let k = 0; k < 120; k++, t++) m.pushLink("aa", noisy(r, -72, 1), t * 1000);
  assert.equal(m.state().disturbed, false);
});

test("roaming to another BSSID restarts the baseline instead of alarming", () => {
  const m = new WifiMonitor();
  const r = mulberry32(5);
  let t = 0;
  for (; t < 40; t++) m.pushLink("aa", noisy(r, -50, 1), t * 1000);
  for (let k = 0; k < 30; k++, t++) {
    m.pushLink("bb", noisy(r, -70, 1), t * 1000);
    assert.equal(m.state().disturbed, false);
  }
});

test("AP scan: many surrounding APs shifting together raise the share; invalid entries are ignored", () => {
  const m = new WifiMonitor();
  const r = mulberry32(6);
  const aps = ["a", "b", "c", "d", "e"];
  let t = 0;
  for (; t < 30; t++)
    m.pushScan(
      aps.map((b, i) => ({ bssid: b, rssi: noisy(r, -50 - 5 * i, 1) })),
      t * 5000,
    );
  assert.equal(m.state().apDisturbedShare, 0);
  for (let k = 0; k < 8; k++, t++)
    m.pushScan(
      aps.map((b, i) => ({ bssid: b, rssi: noisy(r, -60 - 5 * i, 1) })),
      t * 5000,
    );
  assert.ok((m.state().apDisturbedShare ?? 0) >= 0.8);
  assert.equal(m.state().disturbed, true);
  m.pushScan(
    [
      { bssid: "", rssi: -40 },
      { bssid: "x", rssi: 5 },
      { bssid: "y", rssi: NaN },
    ],
    t * 5000,
  );
  assert.equal(m.state().apsTracked, 5);
  const fresh = new WifiMonitor();
  assert.equal(fresh.state().apDisturbedShare, null);
  assert.ok(Number.isNaN(fresh.state().rssi));
});
