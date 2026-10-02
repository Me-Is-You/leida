import {
  Activity,
  Aperture,
  Cpu,
  Map as MapIcon,
  Radio,
  ScanLine,
  SunMedium,
  Waves,
} from "lucide-react";

export const NAV = [
  { to: "/", label: "指挥", hint: "实时融合", icon: Activity },
  { to: "/vision", label: "视觉", hint: "相机 / 轮廓", icon: Aperture },
  { to: "/sonar", label: "声呐", hint: "chirp 测距", icon: Waves },
  { to: "/spectrum", label: "电磁", hint: "Wi-Fi / 磁 / BT", icon: Radio },
  { to: "/map", label: "建图", hint: "点云 / 轨迹", icon: MapIcon },
  { to: "/environment", label: "环境", hint: "自适应", icon: SunMedium },
  { to: "/hardware", label: "硬件", hint: "X300 档案", icon: Cpu },
  { to: "/log", label: "日志", hint: "会话记录", icon: ScanLine },
] as const;
