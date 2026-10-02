import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BRIDGE_VERSION, parseBridgeMessage, validateBridgeUrl } from "./bridge-protocol.ts";

const j = (o: unknown) => JSON.stringify(o);

describe("bridge protocol", () => {
  it("parses every valid message type", () => {
    const hello = parseBridgeMessage(
      j({
        type: "hello",
        v: BRIDGE_VERSION,
        caps: { wifiLink: true, wifiScan: false, battery: true },
      }),
    );
    assert.equal(hello?.type, "hello");
    const link = parseBridgeMessage(
      j({ type: "wifi-link", t: 1, ssid: "home", bssid: "aa:bb:cc:dd:ee:ff", rssi: -52 }),
    );
    assert.equal(link?.type, "wifi-link");
    const scan = parseBridgeMessage(
      j({ type: "wifi-scan", t: 1, aps: [{ bssid: "aa:bb:cc:dd:ee:01", rssi: -70 }] }),
    );
    assert.equal(scan?.type, "wifi-scan");
    assert.equal(
      parseBridgeMessage(j({ type: "battery", t: 1, level: 50, charging: false }))?.type,
      "battery",
    );
    assert.equal(
      parseBridgeMessage(j({ type: "error", source: "wifi-link", message: "x" }))?.type,
      "error",
    );
    assert.equal(parseBridgeMessage(j({ type: "pong" }))?.type, "pong");
  });

  it("rejects malformed, hostile or out-of-range payloads", () => {
    for (const bad of [
      "not json",
      "null",
      "[]",
      j({ type: "nope" }),
      j({ type: "wifi-link", rssi: "-50", bssid: "aa", ssid: "x", t: 1 }),
      j({ type: "wifi-link", rssi: -500, bssid: "aa:bb:cc:dd:ee:ff", ssid: "x", t: 1 }),
      j({ type: "wifi-link", rssi: null, bssid: "aa:bb:cc:dd:ee:ff", ssid: "x", t: 1 }),
      j({ type: "battery", level: 700, charging: false, t: 1 }),
      j({ type: "wifi-scan", t: 1, aps: "x" }),
    ]) {
      assert.equal(parseBridgeMessage(bad), null, bad);
    }
    assert.equal(parseBridgeMessage("x".repeat(100_000)), null);
  });

  it("only accepts ws/wss, and plain ws only for loopback", () => {
    assert.equal(validateBridgeUrl("ws://127.0.0.1:8765/ws?token=abc"), null);
    assert.equal(validateBridgeUrl("ws://localhost:8765/ws?token=abc"), null);
    assert.equal(validateBridgeUrl("wss://example.com/ws?token=abc"), null);
    assert.match(validateBridgeUrl("ws://127.0.0.1:8765/ws") ?? "", /token/);
    assert.notEqual(validateBridgeUrl("ws://192.168.1.5:8765/ws"), null);
    assert.notEqual(validateBridgeUrl("http://127.0.0.1:8765/ws"), null);
    assert.notEqual(validateBridgeUrl("javascript:alert(1)"), null);
    assert.notEqual(validateBridgeUrl(""), null);
  });
});
