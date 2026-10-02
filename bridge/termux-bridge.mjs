#!/usr/bin/env node
// AETHER Termux bridge — gives the web app what a browser cannot read: Wi-Fi RSSI
// (current link + surrounding access points) and battery state.
//
// Design (replaces the v16 Python backend, which had open CORS, 0.0.0.0, shell=True
// and no auth):
//   • read-only: runs three fixed termux-api commands, never anything a client sends
//   • listens on 127.0.0.1 only; connections from other addresses are refused
//   • random 128-bit token required (?token=…), compared in constant time
//   • strict Origin check: only origins passed with --origin (plus http(s)://localhost)
//   • no shell: execFile with a fixed argument list, timeout and output cap
//   • polls only while at least one client is connected (battery friendly)
//
// Usage in Termux:
//   pkg install nodejs termux-api       (and install the Termux:API Android app)
//   node termux-bridge.mjs --origin https://your-app.example
//
// Zero dependencies: a minimal RFC 6455 text-frame WebSocket server is included.

import { createServer } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_CLIENTS = 4;
const MAX_FRAME = 4096;
const VERSION = 1;

/** Default command runner: fixed command, fixed args, no shell. */
export function runCommand(cmd, args = []) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 6000, maxBuffer: 256 * 1024, shell: false }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });
}

const isLoopback = (a) => a === "127.0.0.1" || a === "::1" || a === "::ffff:127.0.0.1";

/** Origin policy. No Origin header (non-browser client on the same device) is allowed; browsers always send one. */
export function originAllowed(origin, allow) {
  if (origin === undefined || origin === "") return true;
  if (allow.includes(origin)) return true;
  try {
    const u = new URL(origin);
    return (
      (u.protocol === "http:" || u.protocol === "https:") &&
      (u.hostname === "localhost" || u.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

export function tokenOk(given, token) {
  const a = Buffer.from(String(given ?? ""));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function textFrame(str) {
  const payload = Buffer.from(str);
  const n = payload.length;
  let head;
  if (n < 126) head = Buffer.from([0x81, n]);
  else if (n < 65536) head = Buffer.from([0x81, 126, n >> 8, n & 255]);
  else {
    head = Buffer.alloc(10);
    head[0] = 0x81;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(n), 2);
  }
  return Buffer.concat([head, payload]);
}

function controlFrame(op, payload = Buffer.alloc(0)) {
  return Buffer.concat([Buffer.from([0x80 | op, payload.length]), payload]);
}

/** Parses one complete client frame from `buf`; returns {frame, rest} or null if incomplete, or {error}. */
export function parseFrame(buf) {
  if (buf.length < 2) return null;
  const op = buf[0] & 0x0f;
  const fin = (buf[0] & 0x80) !== 0;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    return { error: 1009 }; // 64-bit lengths never occur for the 4 KB messages we accept
  }
  if (!masked) return { error: 1002 }; // clients must mask
  if (len > MAX_FRAME) return { error: 1009 };
  if (buf.length < off + 4 + len) return null;
  const mask = buf.subarray(off, off + 4);
  const data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
  for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
  if (!fin || op === 0) return { error: 1003 }; // no fragmentation
  return { frame: { op, data }, rest: buf.subarray(off + 4 + len) };
}

const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);

export function normaliseLink(j) {
  const rssi = num(j?.rssi);
  if (
    rssi === null ||
    rssi > 0 ||
    rssi < -127 ||
    typeof j?.bssid !== "string" ||
    !j.bssid ||
    j.bssid === "02:00:00:00:00:00"
  )
    return null;
  return {
    type: "wifi-link",
    t: Date.now(),
    ssid: String(j.ssid ?? "").slice(0, 64),
    bssid: j.bssid,
    rssi,
    freqMhz: num(j.frequency_mhz),
    linkMbps: num(j.link_speed_mbps),
  };
}

export function normaliseScan(arr) {
  if (!Array.isArray(arr)) return null;
  const aps = [];
  for (const a of arr.slice(0, 200)) {
    const rssi = num(a?.rssi);
    if (rssi === null || rssi > 0 || rssi < -127 || typeof a?.bssid !== "string" || !a.bssid)
      continue;
    aps.push({
      bssid: a.bssid,
      ssid: String(a.ssid ?? "").slice(0, 64),
      rssi,
      freqMhz: num(a.frequency_mhz),
    });
  }
  return { type: "wifi-scan", t: Date.now(), aps };
}

export function normaliseBattery(j) {
  const level = num(j?.percentage);
  if (level === null || level < 0 || level > 100) return null;
  return {
    type: "battery",
    t: Date.now(),
    level,
    charging:
      j.status === "CHARGING" ||
      j.status === "FULL" ||
      (typeof j.plugged === "string" && j.plugged !== "UNPLUGGED"),
    tempC: num(j.temperature),
  };
}

/**
 * @param {{port?: number, token: string, origins?: string[], run?: (cmd: string, args?: string[]) => Promise<string>, battery?: boolean, linkMs?: number, scanMs?: number, batteryMs?: number}} opt
 */
export function createBridge(opt) {
  const token = opt.token;
  const origins = opt.origins ?? [];
  const run = opt.run ?? runCommand;
  const linkMs = opt.linkMs ?? 1000;
  const scanMs = opt.scanMs ?? 5000;
  const batteryMs = opt.batteryMs ?? 30000;
  const clients = new Set();
  const timers = [];
  const busy = { link: false, scan: false, battery: false };
  const lastErr = {};
  const caps = { wifiLink: true, wifiScan: true, battery: opt.battery !== false };

  const broadcast = (msg) => {
    const f = textFrame(JSON.stringify(msg));
    for (const c of clients) c.write(f);
  };
  const reportError = (source, e, cmd = source) => {
    const now = Date.now();
    if (now - (lastErr[source] ?? 0) < 30000) return; // do not flood the browser
    lastErr[source] = now;
    const msg =
      e && e.code === "ENOENT"
        ? `找不到 ${cmd} 命令：请 pkg install termux-api 并安装 Termux:API 应用`
        : String(e?.message ?? e).slice(0, 160);
    broadcast({ type: "error", source, message: msg });
  };

  async function poll(kind, cmd, normalise) {
    if (busy[kind] || clients.size === 0) return;
    busy[kind] = true;
    try {
      const out = await run(cmd, []);
      const msg = normalise(JSON.parse(out));
      if (msg) broadcast(msg);
      else reportError(kind, new Error("unexpected output"));
    } catch (e) {
      reportError(kind, e, cmd);
    } finally {
      busy[kind] = false;
    }
  }

  const server = createServer((_req, res) => {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });

  server.on("upgrade", (req, socket) => {
    const reject = (code, why) => {
      socket.write(`HTTP/1.1 ${code} ${why}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    if (!isLoopback(req.socket.remoteAddress ?? "")) return reject(403, "Forbidden");
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== "/ws") return reject(404, "Not Found");
    if (!originAllowed(req.headers.origin, origins)) return reject(403, "Forbidden");
    if (!tokenOk(url.searchParams.get("token"), token)) return reject(401, "Unauthorized");
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string" || req.headers.upgrade?.toLowerCase() !== "websocket")
      return reject(400, "Bad Request");
    if (clients.size >= MAX_CLIENTS) return reject(503, "Service Unavailable");
    const accept = createHash("sha1")
      .update(key + GUID)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    clients.add(socket);
    socket.write(textFrame(JSON.stringify({ type: "hello", v: VERSION, caps })));
    let buf = Buffer.alloc(0);
    const close = (code) => {
      const p = Buffer.alloc(2);
      p.writeUInt16BE(code);
      try {
        socket.write(controlFrame(0x8, p));
      } catch {
        /* socket already gone */
      }
      socket.end();
    };
    socket.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        const r = parseFrame(buf);
        if (r === null) break;
        if (r.error) return close(r.error);
        buf = Buffer.from(r.rest);
        const { op, data } = r.frame;
        if (op === 0x8) return close(1000);
        if (op === 0x9) socket.write(controlFrame(0xa, data.subarray(0, 125)));
        else if (op === 0x1) {
          try {
            if (JSON.parse(data.toString()).type === "ping")
              socket.write(textFrame('{"type":"pong"}'));
          } catch {
            /* ignore garbage: clients cannot make the bridge do anything */
          }
        }
      }
    });
    const drop = () => clients.delete(socket);
    socket.on("close", drop);
    socket.on("error", drop);
    // immediate first readings
    void poll("wifi-link", "termux-wifi-connectioninfo", normaliseLink);
    void poll("wifi-scan", "termux-wifi-scaninfo", normaliseScan);
    if (caps.battery) void poll("battery", "termux-battery-status", normaliseBattery);
  });

  timers.push(
    setInterval(() => void poll("wifi-link", "termux-wifi-connectioninfo", normaliseLink), linkMs),
  );
  timers.push(
    setInterval(() => void poll("wifi-scan", "termux-wifi-scaninfo", normaliseScan), scanMs),
  );
  if (caps.battery)
    timers.push(
      setInterval(() => void poll("battery", "termux-battery-status", normaliseBattery), batteryMs),
    );
  for (const t of timers) t.unref();

  return {
    server,
    listen: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(opt.port ?? 8765, "127.0.0.1", () => resolve(server.address().port));
      }),
    close: () =>
      new Promise((resolve) => {
        for (const t of timers) clearInterval(t);
        for (const c of clients) c.destroy();
        server.close(() => resolve());
      }),
  };
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (name) => {
    const out = [];
    for (let i = 0; i < argv.length; i++) if (argv[i] === name && argv[i + 1]) out.push(argv[++i]);
    return out;
  };
  const port = Number(arg("--port")[0] ?? 8765);
  const origins = [
    ...arg("--origin"),
    ...(process.env.AETHER_BRIDGE_ORIGINS ? process.env.AETHER_BRIDGE_ORIGINS.split(",") : []),
  ]
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
  const token = arg("--token")[0] ?? randomBytes(16).toString("hex");
  const bridge = createBridge({ port, token, origins, battery: !argv.includes("--no-battery") });
  bridge.listen().then(
    (p) => {
      try {
        const dir = join(homedir(), ".aether");
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        writeFileSync(join(dir, "bridge-token"), token + "\n", { mode: 0o600 });
      } catch {
        /* token is still printed below */
      }
      console.log(`AETHER bridge listening on ws://127.0.0.1:${p}/ws`);
      console.log(`token: ${token}`);
      console.log(
        `allowed origins: ${origins.length ? origins.join(", ") : "(only http(s)://localhost)"}`,
      );
      console.log(
        `paste into the app (Hardware page → Termux bridge):  ws://127.0.0.1:${p}/ws?token=${token}`,
      );
    },
    (e) => {
      console.error("cannot listen:", e.message);
      process.exit(1);
    },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
