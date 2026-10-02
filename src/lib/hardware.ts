export const DEVICE = {
  model: "vivo X300",
  code: "V2509A",
  os: "OriginOS 6 / Android 16",
  soc: "MediaTek Dimensity 9500 (MT6993)",
  cpu: "1× C1-Ultra 4.21 GHz + 3× C1-Premium 3.5 GHz + 4× C1-Pro 2.7 GHz",
  gpu: "Mali-G1 Ultra MP12",
  npu: "NPU 990",
  ram: "15.7 GB LPDDR5X",
  storage: "UFS 4.1 · 无 microSD",
  display: "6.31″ LTPO AMOLED 2640×1216 120 Hz 4500 nits",
  battery: "6040 mAh Si/C · 90 W 有线 / 40 W 无线",
  wifi: "Wi-Fi 7 802.11be 2×2 MIMO · 2.4 / 5 / 6 GHz",
  bt: "Bluetooth 5.4 + BLE",
  gnss: "GPS L1+L5 · GLONASS · BeiDou · Galileo · QZSS · NavIC · AGPS",
  usb: "USB 3.2 Type-C · OTG · DisplayPort · PD",
  ip: "IP68 / IP69",
} as const;

export const CAMERAS = [
  { name: "主摄", spec: "200 MP Samsung ISOCELL HPB · 1/1.4″ · f/1.68 · 23 mm · OIS · 蔡司 T*" },
  { name: "长焦", spec: "50 MP Sony LYT-602 · f/2.57 · 70 mm · 3× 光变 · APO · OIS" },
  { name: "超广角", spec: "50 MP S5KJN1 · f/2.0 · 15 mm" },
  { name: "前置", spec: "50 MP S5KJN1 · f/2.0 · 20 mm · PDAF · 92°" },
] as const;

export const SENSORS = [
  { name: "加速度计", model: "Bosch BMI270", range: "±16 g", use: "步态 / SAR 轨迹" },
  { name: "陀螺仪", model: "BMI270 集成", range: "±2000 dps", use: "姿态 / 防抖" },
  { name: "磁力计", model: "qmc6309 推测", range: "±4900 μT · 0.1 μT", use: "罗盘 / 墙内金属" },
  { name: "环境光", model: "AMS TMD3725", range: "0–100 k lux", use: "环境自适应" },
  { name: "接近", model: "—", range: "0 / 1", use: "遮挡" },
  { name: "激光对焦", model: "ST VL53L5", range: "0.2–5 m", use: "AR 测距" },
  { name: "超声波指纹", model: "高通 3D Sonic", range: "单点", use: "解锁" },
  { name: "霍尔", model: "—", range: "0 / 1", use: "磁吸" },
  { name: "红外遥控", model: "IR blaster", range: "家电", use: "遥控" },
  { name: "Flicker", model: "—", range: "50 / 60 Hz", use: "频闪" },
] as const;

export const CEILINGS = [
  {
    level: "hard" as const,
    title: "热成像",
    body: "CMOS 仅响应 0.4–1 μm，远红外 8–14 μm 物理不可达。需 OTG 热像仪。",
  },
  {
    level: "hard" as const,
    title: "Wi-Fi CSI",
    body: "Nexmon 仅 Broadcom。天玑 9500 集成 Wi-Fi 未开放 CSI，需特殊固件 + Root，普通 Android 应用拿不到。本站只通过 Termux 桥接读取 RSSI，做「无线环境相对基线的扰动」检测，不能判断墙后有没有人。",
  },
  {
    level: "soft" as const,
    title: "ToF 深度",
    body: "机身无 ToF。视觉目标的深度由「类别典型高度 + 针孔相机模型」估算（带 ±σ），声呐只在命中同一方向时参与融合，不是真值深度图。",
  },
  {
    level: "soft" as const,
    title: "探测距离",
    body: "无外设方案中近距 ≤10 m。更远依赖 OTG（SDR / 热像 / 网卡）。",
  },
] as const;

export const FUSION_MODES = [
  {
    id: "indoor",
    label: "室内",
    range: "0.2–5 m",
    detect: "亮度 50–150 · 噪声低",
    weights: { vision: 0.3, sonar: 0.3, mag: 0.2, wifi: 0.1, depth: 0.1 },
  },
  {
    id: "outdoor",
    label: "室外",
    range: "5–50 m",
    detect: "高亮 · GNSS 移动",
    weights: { vision: 0.45, sonar: 0.1, mag: 0.1, wifi: 0.05, depth: 0.3 },
  },
  {
    id: "lowlight",
    label: "暗光",
    range: "≤30 m 轮廓",
    detect: "亮度 < 35",
    weights: { vision: 0.2, sonar: 0.35, mag: 0.15, wifi: 0.15, depth: 0.15 },
  },
  {
    id: "bright",
    label: "强光",
    range: "HDR",
    detect: "亮度 > 180",
    weights: { vision: 0.4, sonar: 0.15, mag: 0.1, wifi: 0.1, depth: 0.25 },
  },
  {
    id: "through",
    label: "无线扰动",
    range: "1–2 墙",
    detect: "RSSI σ>2.5（需 Termux 桥接）",
    weights: { vision: 0.1, sonar: 0.2, mag: 0.3, wifi: 0.3, depth: 0.1 },
  },
  {
    id: "noisy",
    label: "噪声",
    range: "滤波",
    detect: "噪声 > 40",
    weights: { vision: 0.25, sonar: 0.15, mag: 0.2, wifi: 0.2, depth: 0.2 },
  },
  {
    id: "clutter",
    label: "杂乱",
    range: "近距分割",
    detect: "纹理 > 0.45",
    weights: { vision: 0.4, sonar: 0.25, mag: 0.1, wifi: 0.1, depth: 0.15 },
  },
] as const;
