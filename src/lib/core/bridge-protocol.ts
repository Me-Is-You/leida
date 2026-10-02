/**
 * Messages sent by bridge/termux-bridge.mjs over its WebSocket. The browser
 * treats everything coming from the socket as untrusted input: each message is
 * validated field by field and anything malformed is dropped.
 */

export const BRIDGE_VERSION = 1;

export interface BridgeAp {
  bssid: string;
  ssid: string;
  rssi: number;
  freqMhz: number | null;
}

export type BridgeMessage =
  | { type: "hello"; v: number; caps: { wifiLink: boolean; wifiScan: boolean; battery: boolean } }
  | {
      type: "wifi-link";
      t: number;
      ssid: string;
      bssid: string;
      rssi: number;
      freqMhz: number | null;
      linkMbps: number | null;
    }
  | { type: "wifi-scan"; t: number; aps: BridgeAp[] }
  | { type: "battery"; t: number; level: number; charging: boolean; tempC: number | null }
  | { type: "error"; source: string; message: string }
  | { type: "pong" };

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const str = (x: unknown, max = 64): string | null =>
  typeof x === "string" && x.length <= max ? x : null;
const validRssi = (r: number | null): r is number => r !== null && r <= 0 && r >= -127;

export function parseBridgeMessage(text: string): BridgeMessage | null {
  if (text.length > 64 * 1024) return null;
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(j) || typeof j.type !== "string") return null;
  switch (j.type) {
    case "hello": {
      const caps = j.caps;
      if (!isObj(caps) || num(j.v) === null) return null;
      return {
        type: "hello",
        v: j.v as number,
        caps: {
          wifiLink: caps.wifiLink === true,
          wifiScan: caps.wifiScan === true,
          battery: caps.battery === true,
        },
      };
    }
    case "wifi-link": {
      const rssi = num(j.rssi);
      const bssid = str(j.bssid);
      const t = num(j.t);
      if (!validRssi(rssi) || bssid === null || t === null) return null;
      return {
        type: "wifi-link",
        t,
        ssid: str(j.ssid, 64) ?? "",
        bssid,
        rssi,
        freqMhz: num(j.freqMhz),
        linkMbps: num(j.linkMbps),
      };
    }
    case "wifi-scan": {
      const t = num(j.t);
      if (t === null || !Array.isArray(j.aps) || j.aps.length > 200) return null;
      const aps: BridgeAp[] = [];
      for (const a of j.aps) {
        if (!isObj(a)) continue;
        const rssi = num(a.rssi);
        const bssid = str(a.bssid);
        if (!validRssi(rssi) || !bssid) continue;
        aps.push({ bssid, ssid: str(a.ssid, 64) ?? "", rssi, freqMhz: num(a.freqMhz) });
      }
      return { type: "wifi-scan", t, aps };
    }
    case "battery": {
      const level = num(j.level);
      const t = num(j.t);
      if (level === null || t === null || level < 0 || level > 100) return null;
      return { type: "battery", t, level, charging: j.charging === true, tempC: num(j.tempC) };
    }
    case "error":
      return {
        type: "error",
        source: str(j.source, 32) ?? "bridge",
        message: str(j.message, 200) ?? "",
      };
    case "pong":
      return { type: "pong" };
    default:
      return null;
  }
}

/** ws:// or wss:// URL with a non-empty token; only loopback hosts are accepted for plain ws://. */
export function validateBridgeUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "地址格式不对";
  }
  if (u.protocol !== "ws:" && u.protocol !== "wss:") return "必须以 ws:// 或 wss:// 开头";
  const loopback =
    u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]";
  if (u.protocol === "ws:" && !loopback) return "明文 ws:// 只允许连本机（127.0.0.1 / localhost）";
  if (!u.searchParams.get("token")) return "地址里缺少 ?token=…（桥接启动时会打印完整地址）";
  return null;
}
