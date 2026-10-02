import {
  BRIDGE_VERSION,
  parseBridgeMessage,
  validateBridgeUrl,
  type BridgeMessage,
} from "./core/bridge-protocol.ts";

export type BridgeStatus = "off" | "connecting" | "live" | "error";

export interface BridgeHandlers {
  onStatus: (status: BridgeStatus, note: string) => void;
  onMessage: (msg: BridgeMessage) => void;
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];
const PING_MS = 15000;
const STALE_MS = 12000;

/**
 * Connects to the Termux bridge (bridge/termux-bridge.mjs) and keeps the
 * connection alive: exponential reconnect, heartbeat, stale-link watchdog.
 * Returns a function that closes the connection for good.
 */
export function startBridge(url: string, h: BridgeHandlers): () => void {
  const bad = validateBridgeUrl(url);
  if (bad) {
    h.onStatus("error", bad);
    return () => undefined;
  }
  let ws: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let retry = 0;
  let ping = 0;
  let lastMsg = 0;
  let watchdog = 0;

  const clearTimers = () => {
    window.clearTimeout(retry);
    window.clearInterval(ping);
    window.clearInterval(watchdog);
  };

  const connect = () => {
    if (stopped) return;
    h.onStatus("connecting", attempt ? `重连中（第 ${attempt} 次）` : "连接中");
    let sock: WebSocket;
    try {
      sock = new WebSocket(url);
    } catch {
      h.onStatus("error", "无法创建连接");
      schedule();
      return;
    }
    ws = sock;
    sock.onopen = () => {
      lastMsg = performance.now();
      ping = window.setInterval(() => {
        if (sock.readyState === WebSocket.OPEN) sock.send('{"type":"ping"}');
      }, PING_MS);
      watchdog = window.setInterval(() => {
        if (performance.now() - lastMsg > STALE_MS) sock.close();
      }, 3000);
    };
    sock.onmessage = (e) => {
      lastMsg = performance.now();
      if (typeof e.data !== "string") return;
      const m = parseBridgeMessage(e.data);
      if (!m) return;
      if (m.type === "hello") {
        if (m.v !== BRIDGE_VERSION) {
          h.onStatus(
            "error",
            `桥接版本 ${m.v} 与应用（${BRIDGE_VERSION}）不匹配，请更新 termux-bridge.mjs`,
          );
          sock.close();
          stopped = true;
          return;
        }
        attempt = 0;
        h.onStatus("live", "");
      }
      h.onMessage(m);
    };
    sock.onclose = () => {
      window.clearInterval(ping);
      window.clearInterval(watchdog);
      if (ws === sock) ws = null;
      if (stopped) return;
      h.onStatus("error", "连接断开（桥接没启动、令牌错误或来源未被允许）");
      schedule();
    };
    sock.onerror = () => undefined; // onclose follows and carries the state
  };

  const schedule = () => {
    if (stopped) return;
    const d = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)] as number;
    attempt++;
    retry = window.setTimeout(connect, d);
  };

  connect();
  return () => {
    stopped = true;
    clearTimers();
    ws?.close();
    ws = null;
    h.onStatus("off", "");
  };
}
