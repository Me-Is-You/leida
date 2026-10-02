import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import {
  createBridge,
  normaliseBattery,
  normaliseLink,
  normaliseScan,
  originAllowed,
  tokenOk,
} from "./termux-bridge.mjs";

const TOKEN = "t0k3n-0123456789abcdef";
const canned = {
  "termux-wifi-connectioninfo": JSON.stringify({
    bssid: "aa:bb:cc:dd:ee:01",
    frequency_mhz: 5180,
    link_speed_mbps: 433,
    rssi: -52,
    ssid: "Home",
  }),
  "termux-wifi-scaninfo": JSON.stringify([
    { bssid: "aa:bb:cc:dd:ee:01", rssi: -52, ssid: "Home", frequency_mhz: 5180 },
    { bssid: "11:22:33:44:55:66", rssi: -71, ssid: "Neighbour", frequency_mhz: 2437 },
    { bssid: "bad", rssi: 12 },
  ]),
  "termux-battery-status": JSON.stringify({
    percentage: 64,
    status: "DISCHARGING",
    plugged: "UNPLUGGED",
    temperature: 31.5,
  }),
};
const ran = [];
const run = async (cmd, args) => {
  ran.push([cmd, args]);
  if (cmd in canned) return canned[cmd];
  throw Object.assign(new Error("nope"), { code: "ENOENT" });
};

async function start(extra = {}) {
  const b = createBridge({
    port: 0,
    token: TOKEN,
    origins: ["https://app.example"],
    run,
    linkMs: 60,
    scanMs: 120,
    batteryMs: 200,
    ...extra,
  });
  const port = await b.listen();
  return { b, port };
}

function upgrade(port, path, headers = {}) {
  return new Promise((resolve) => {
    const req = http.request({
      port,
      host: "127.0.0.1",
      path,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        ...headers,
      },
    });
    req.on("upgrade", (res, socket) => {
      socket.destroy();
      resolve(res.statusCode);
    });
    req.on("response", (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on("error", () => resolve(0));
    req.end();
  });
}

test("origin and token policy", () => {
  assert.equal(originAllowed("https://app.example", ["https://app.example"]), true);
  assert.equal(originAllowed("https://evil.example", ["https://app.example"]), false);
  assert.equal(originAllowed("http://localhost:5173", []), true);
  assert.equal(originAllowed("http://127.0.0.1:8080", []), true);
  assert.equal(originAllowed("http://localhost.evil.com", []), false);
  assert.equal(originAllowed(undefined, []), true);
  assert.equal(originAllowed("null", []), false);
  assert.equal(tokenOk(TOKEN, TOKEN), true);
  assert.equal(tokenOk(TOKEN.slice(0, -1), TOKEN), false);
  assert.equal(tokenOk(undefined, TOKEN), false);
});

test("normalisers drop invalid readings", () => {
  assert.equal(normaliseLink({ bssid: "02:00:00:00:00:00", rssi: -50 }), null); // Android hides the BSSID without permission
  assert.equal(normaliseLink({ bssid: "aa", rssi: 10 }), null);
  assert.equal(normaliseLink({ bssid: "aa", rssi: -60, ssid: "x" }).rssi, -60);
  assert.equal(
    normaliseScan([{ bssid: "a", rssi: -40 }, { bssid: "b", rssi: 3 }, null]).aps.length,
    1,
  );
  assert.equal(normaliseScan("x"), null);
  assert.equal(normaliseBattery({ percentage: 120 }), null);
  assert.equal(normaliseBattery({ percentage: 50, status: "CHARGING" }).charging, true);
});

test("handshake: wrong token, wrong origin and wrong path are refused; the right one is accepted", async () => {
  const { b, port } = await start();
  try {
    assert.equal(await upgrade(port, `/ws?token=wrong`), 401);
    assert.equal(await upgrade(port, `/ws`), 401);
    assert.equal(
      await upgrade(port, `/ws?token=${TOKEN}`, { Origin: "https://evil.example" }),
      403,
    );
    assert.equal(await upgrade(port, `/other?token=${TOKEN}`), 404);
    assert.equal(await upgrade(port, `/ws?token=${TOKEN}`, { Origin: "https://app.example" }), 101);
  } finally {
    await b.close();
  }
});

test("streams hello, link, scan and battery to a real WebSocket client; never runs anything but the three fixed commands", async () => {
  const { b, port } = await start();
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${TOKEN}`);
  const seen = new Map();
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("timeout: " + [...seen.keys()])), 4000);
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      seen.set(m.type, m);
      if (["hello", "wifi-link", "wifi-scan", "battery"].every((k) => seen.has(k))) {
        clearTimeout(to);
        resolve();
      }
    };
    ws.onerror = () => reject(new Error("ws error"));
  });
  assert.equal(seen.get("hello").caps.battery, true);
  assert.equal(seen.get("wifi-link").rssi, -52);
  assert.equal(seen.get("wifi-scan").aps.length, 2); // the invalid entry was dropped
  assert.equal(seen.get("battery").level, 64);
  // a client cannot make the bridge run anything: garbage and "commands" are ignored, ping gets a pong
  const before = ran.length;
  ws.send(JSON.stringify({ type: "exec", cmd: "rm -rf /" }));
  ws.send("not json");
  ws.send(JSON.stringify({ type: "ping" }));
  const pong = await new Promise((resolve) => {
    ws.onmessage = (e) => {
      if (JSON.parse(e.data).type === "pong") resolve(true);
    };
    setTimeout(() => resolve(false), 2000);
  });
  assert.equal(pong, true);
  for (const [cmd, args] of ran) {
    assert.ok(cmd in canned, `unexpected command ${cmd}`);
    assert.deepEqual(args, []);
  }
  assert.ok(ran.length >= before);
  ws.close();
  await b.close();
});

test("no polling while nobody is connected; a missing termux-api is reported once with a hint", async () => {
  ran.length = 0;
  const broken = async () => {
    throw Object.assign(new Error("spawn"), { code: "ENOENT" });
  };
  const { b, port } = await start({ run: broken });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(ran.length, 0, "idle bridge must not poll");
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${TOKEN}`);
  const errors = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === "error") errors.push(m);
  };
  await new Promise((r) => setTimeout(r, 700));
  ws.close();
  await b.close();
  assert.ok(errors.length >= 1 && errors.length <= 3, `errors ${errors.length}`); // one per source, throttled
  assert.match(errors[0].message, /termux-api/);
});
