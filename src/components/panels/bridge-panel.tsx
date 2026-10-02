import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardHint, CardTitle } from "@/components/ui/card";
import { validateBridgeUrl } from "@/lib/core/bridge-protocol.ts";
import { useRadar } from "@/lib/radar-store";

const TONE = { off: "mute", connecting: "accent", live: "live", error: "warn" } as const;
const LABEL = { off: "未连接", connecting: "连接中", live: "已连接", error: "断开" } as const;

/** Connection settings for the Termux bridge (the only way a web page can get Wi-Fi RSSI). */
export function BridgePanel() {
  const bridge = useRadar((s) => s.bridge);
  const saved = useRadar((s) => s.settings.bridgeUrl);
  const connect = useRadar((s) => s.connectBridge);
  const disconnect = useRadar((s) => s.disconnectBridge);
  const [url, setUrl] = useState(saved);
  const [show, setShow] = useState(false);
  const problem = url.trim() ? validateBridgeUrl(url.trim()) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Termux 桥接（Wi-Fi RSSI）</CardTitle>
        <div className="flex items-center gap-2">
          <CardHint>{bridge.note || (bridge.status === "live" ? "读数在流动" : "")}</CardHint>
          <Badge tone={TONE[bridge.status]}>{LABEL[bridge.status]}</Badge>
        </div>
      </CardHeader>
      <p className="mb-3 text-xs text-muted">
        浏览器读不到 Wi-Fi 信号强度。在手机的 Termux 里运行本仓库的{" "}
        <code className="font-mono">bridge/termux-bridge.mjs</code>
        （只读 termux-api，仅监听 127.0.0.1，令牌 + 来源双重校验），把它打印的地址粘贴到下面。
      </p>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem && url.trim()) connect(url.trim());
        }}
      >
        <input
          type={show ? "text" : "password"}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="ws://127.0.0.1:8765/ws?token=…"
          autoComplete="off"
          spellCheck={false}
          aria-label="桥接地址"
          aria-invalid={problem ? true : undefined}
          className="min-w-0 flex-1 rounded-md bg-raised px-3 py-2 font-mono text-xs text-fg shadow-[var(--shadow-border)] outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setShow((v) => !v)}>
            {show ? "隐藏" : "显示"}
          </Button>
          <Button type="submit" size="sm" variant="accent" disabled={!url.trim() || !!problem}>
            连接
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!saved && bridge.status === "off"}
            onClick={() => {
              disconnect();
              setUrl("");
            }}
          >
            断开并清除
          </Button>
        </div>
      </form>
      {problem ? <p className="mt-2 text-xs text-warn">{problem}</p> : null}
      {bridge.caps ? (
        <ul className="mt-3 flex flex-wrap gap-2 text-[11px]">
          <li>
            <Badge tone={bridge.caps.wifiLink ? "real" : "mute"}>
              当前连接 RSSI {bridge.caps.wifiLink ? "✓" : "—"}
            </Badge>
          </li>
          <li>
            <Badge tone={bridge.caps.wifiScan ? "real" : "mute"}>
              周边 AP 扫描 {bridge.caps.wifiScan ? `✓ ${bridge.apsTracked} 个已跟踪` : "—"}
            </Badge>
          </li>
          <li>
            <Badge tone={bridge.caps.battery ? "real" : "mute"}>
              电量{" "}
              {bridge.battery
                ? `${Math.round(bridge.battery.level * 100)}%${bridge.battery.charging ? "（充电）" : ""}`
                : "—"}
            </Badge>
          </li>
        </ul>
      ) : null}
      <p className="mt-3 text-[11px] text-faint">
        地址（含令牌）只保存在本机浏览器，不会写入导出的会话。检测的是「Wi-Fi
        环境相对基线的变化」，无法判断墙后有没有人；Android 应用拿不到 CSI。
      </p>
    </Card>
  );
}
