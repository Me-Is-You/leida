import { useEffect, useState } from "react";
import { snapshot, type NodeStat } from "@/lib/perf";
import { Card, CardHeader, CardHint, CardTitle } from "@/components/ui/card";

const LABEL: Record<string, string> = {
  "store.tick": "主循环（融合 + 状态）",
  "fusion.range": "测距融合",
  "sonar.record": "声呐 · 录音",
  "sonar.dsp(worker)": "声呐 · 匹配滤波（Worker）",
  "sonar.dsp(main)": "声呐 · 匹配滤波（主线程回退）",
  "sonar.ping": "声呐 · 整次脉冲",
  "vision.frame": "视觉 · 帧统计 + 运动检测",
  "vision.nn": "视觉 · COCO-SSD 推理",
  "ocr.prep": "OCR · 文字定位 + 二值化",
  "ocr.recognize": "OCR · Tesseract 识字",
  "qr.decode": "二维码 · 自研解码",
  "render.3d": "3D 渲染（自研 WebGL2）",
};

/** Live per-node cost table: EMA / decaying max / rate. Polls once a second, only while mounted. */
export function PerfTable() {
  const [rows, setRows] = useState<NodeStat[]>([]);
  useEffect(() => {
    const read = () => setRows(snapshot());
    read();
    const id = window.setInterval(read, 1000);
    return () => window.clearInterval(id);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>管线节点耗时</CardTitle>
        <CardHint>指数滑动平均，每秒刷新</CardHint>
      </CardHeader>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有节点上报。打开任一页面或触发一次声呐 / 相机后这里会出现数据。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">各处理节点的平均耗时、近期最大值和调用频率</caption>
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">节点</th>
                <th scope="col" className="px-2 py-1 text-right font-medium">平均 ms</th>
                <th scope="col" className="px-2 py-1 text-right font-medium">峰值 ms</th>
                <th scope="col" className="px-2 py-1 text-right font-medium">Hz</th>
                <th scope="col" className="pl-2 py-1 text-right font-medium">累计</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {rows.map((r) => (
                <tr key={r.name} className="border-t border-border/50">
                  <th scope="row" className="py-1 pr-3 text-left font-sans font-normal">{LABEL[r.name] ?? r.name}</th>
                  <td className="px-2 py-1 text-right">{r.avgMs < 10 ? r.avgMs.toFixed(2) : r.avgMs.toFixed(1)}</td>
                  <td className="px-2 py-1 text-right text-muted-foreground">{r.maxMs.toFixed(1)}</td>
                  <td className="px-2 py-1 text-right">{r.hz.toFixed(1)}</td>
                  <td className="pl-2 py-1 text-right text-muted-foreground">{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
