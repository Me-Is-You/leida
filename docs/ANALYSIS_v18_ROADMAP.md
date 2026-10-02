# AETHER · vivo X300 探测站 —— 深度剖析与下一版本路线图

> 分析对象:`grok-workspace.zip`(AETHER v18.0,TanStack Start + React 19 + three.js + zustand)及其内嵌的 `attachments/vivo_x300_radar_platform_v16_full.zip`(v16 Python 后端 + 单文件前端)。
> 分析日期:2026-10-02。所有"已验证"条目都是实际解压、安装依赖、跑 `tsc / eslint / npm test / vite build` 后得到的结果,不是凭印象。

---

## 0. 一页结论

**这是一个"外壳很精致、内核大半是模拟"的项目。** UI、3D 场景、状态管理都做得不错,但:

1. **当前交付物无法构建**(`spectrum.tsx` 语法错误),**"视觉"页是空文件**(导航里点进去是 404)。
2. **大量标着"真实/device"的数据其实是假的**(蓝牙 RSSI 写死 -55、声呐在大概率下读到的是延迟而不是回波、Wi-Fi 100% 来自孪生)。
3. **"建图"本质是在模拟房间里画点**:观测者位姿是正弦函数,不是 IMU/视觉里程计;点云约 45 秒后就停止增长。
4. **安全问题:公开仓库里提交了含明文密码的部署脚本。** 需要立刻处理。
5. 性能、坐标系一致性、依赖体积、测试覆盖都有明显改进空间。

下一版本(建议叫 **v19 "Honest Core"**)的主题不是加功能,而是:**修好能跑 → 让"真实"二字名副其实 → 再谈建图/深度/穿墙等高级能力**。

---

## 1. 项目画像

| 项 | 内容 |
|---|---|
| 技术栈 | TanStack Start/Router、React 19、Vite 8(rolldown)、Tailwind 4、zustand、three + R3F、TF.js + COCO-SSD、Better Auth + PGlite/Neon(脚手架) |
| 业务代码规模 | `src/` 约 5300 行;核心是 `radar-store.ts`(702)、`device.ts`(526)、`engine.ts`(435,物理孪生) |
| 页面 | 指挥 / 视觉 / 声呐 / 电磁 / 建图 / 环境 / 硬件 / 日志(8 个) |
| 数据来源模型 | `SampleSource = "device" \| "twin"`:设备传感器优先,缺失时由"物理孪生"(模拟器)续上 |
| 版本混乱 | 附件 README 是 v16;代码里 localStorage key 是 `aether-v18-settings`,导出文件 `version: "18.0"`,侧栏 `v18.0`;`docs/` 里 `FINAL_REPORT.md` 与 `FINAL_REPORT_v14.md` 内容完全相同 |
| 业务测试 | **0**。197 个测试全部是平台脚手架(PWA/迁移/鉴权)的,`engine/fusion/sonar/vision` 无一覆盖 |
| 数据库 | PGlite/Neon + Better Auth 已接好但**业务数据一行都没存**(地图/日志只能手动导出 JSON) |

---

## 2. P0:阻断与安全(先于一切)

### 2.1 项目当前无法构建 ✅已验证
- `src/routes/spectrum.tsx:60` JSX 文本里直接写了 `σ > 2.5`,`>` 在 JSX 文本中非法。
  `vite build` 报 `Unexpected token. Did you mean {'>'} or &gt;?`,`tsc` / `eslint` 同样报错。
  修法:`σ {">"} 2.5` 或 `σ &gt; 2.5`。
- 这意味着交付的版本**无法 `npm run build`,也无法部署**。

### 2.2 `/vision` 页面是空壳 ✅已验证
- `src/routes/vision.tsx` 只有 15 行 import,**没有 `Route` 导出,也没有组件**(疑似生成时被截断)。
- 构建日志:`Route file ".../vision.tsx" does not export a Route. This file will not be included in the route tree.`
- 后果:侧栏的"视觉"链接 `tsc` 报类型错误、运行时 404;**相机预览、OCR、变焦/手电、轮廓开关这些 UI 全部不可达**(对应的 store 方法和 `runOcr`/`injectTesseract` 都写好了,只差页面)。

### 2.3 公开仓库里有明文凭据 ⚠️严重
- 仓库 `Me-Is-You/leida` **是 public**。`grok-workspace.zip → attachments/…v16_full.zip → radar_platform/scripts/deploy_to_phone.sh` 里**硬编码了手机 SSH 账号/密码、FRP 跳板账号/密码、内网 IP、SSH 主机指纹**。
- 处置清单:
  1. **立刻轮换**手机 SSH 密码、FRP 账号密码(视为已泄露,git 历史里仍在)。
  2. 把仓库转私有,或用 `git filter-repo` 清历史后强推;同时不要再把 zip 当源码提交。
  3. 脚本改为读环境变量 / `~/.ssh/config` + 密钥登录,密码一律不进仓库。

### 2.4 其他安全点
- v16 后端 `app.py`:`Access-Control-Allow-Origin: *` + 默认监听 `0.0.0.0` + `subprocess.run(shell=True)` + 无任何鉴权 —— 同一 Wi-Fi 下任何人/任何网页都能读你的传感器和 SSE 流。
- 前端 `injectTesseract()` 从 jsdelivr 动态注入脚本,**无 SRI、无版本锁到 patch**。
- `importMap(JSON.parse(file))` 对导入文件**零校验**(项目里已经有 zod,没用上)。

### 2.5 仓库形态问题
- 整个代码库是**一个 zip 提交**,`git log` 只有一条 "1"。没有 diff、没有 review、没有 CI,也无法 blame。
- 一并打包进去的还有 `.grok/skills/**`(Agent 技能文档,几百个文件)和 `artifacts/`,与业务无关。`README.md` 是空的。
- 建议:解压成真实源码树提交;`.grok/`、`attachments/`、`artifacts/` 进 `.gitignore`;补 README。

---

## 3. "真实"二字的诚实度审计(最关键的产品问题)

项目的卖点是"每项都有真实物理实现和诚实 real 徽章"。但读代码后发现徽章与实现脱节:

| 通道 | UI 显示 | 代码里实际发生的事 | 严重度 |
|---|---|---|---|
| **蓝牙 RSSI** | `source:"device"`(REAL 日志+toast) | `scanBluetooth()` 返回 **`rssi: -55` 写死**。Web Bluetooth `requestDevice` 本来就不给 RSSI;要用 `watchAdvertisements()` 才能拿到 | 高 |
| **声呐** | "互相关真实",μs 级 | 见 §4.1:`AnalyserNode` 抓取方式使时间轴失真;没有扣除播放/采集延迟;峰值大概率是直达声/系统延迟。只要结果落在 5cm–8m 且 `peak>0.002`(未归一化,几乎必过)就标 `device` | 高 |
| **Wi-Fi RSSI / 穿墙** | "穿墙扰动"告警 + 手机震动 | **`wifiAt()` 完全是模拟**(路径损耗公式 + 3 个虚拟人)。`realFlags` 里甚至没有 wifi 项。"穿墙"告警由虚拟人走到墙后触发,还会让真手机 `vibrate()` | 高 |
| **人物计数** | HUD"人物 N" | `people = [...twin.people, ...visionPeople]`,**3 个虚拟人永远混在里面**,相机开不开都在;"新增目标"告警也基于混合计数 | 高 |
| **环境分类** | 自适应 7 模式 | 相机关闭时亮度/纹理是正弦曲线;**已读取的真实 `AmbientLightSensor` lux 没有参与分类** | 中 |
| **观测者位姿 / 轨迹 / SAR 孔径 L** | 建图、SAR 指标 | `observerPose(t)` 是 `sin` 函数;真实 IMU 只用了 heading,没有积分,更没有视觉里程计。SAR 的 L 来自这条假轨迹 | 高 |
| **"微秒级 / 毫米级"** | `latencyUs`、`formatMeters` 显示 mm | `latencyUs` 测的是 JS tick 自身耗时,不是传感器延迟;`performance.now()` 在浏览器里被故意降精度(跨域隔离时 ≤5μs,否则 100μs 量级),`AudioContext` 一个采样点=20.8μs=单程 3.6mm,真实手机扬声器/麦克风+空气温度误差下可靠精度是厘米级 | 中 |
| **HDR / 夜视 / 去雾 / 超分** | 开关按钮 | 全是 CSS `filter`(对比度/色相),不是多曝光融合/暗通道/超分。v14 报告里的"去雾、超分、双边滤波"代码里并不存在 | 中 |
| **磁异常** | `anomaly` | 真机路径是固定阈值 `m > 65 μT`(无标定、无背景估计);孪生路径是滑窗,两条逻辑不一致 | 中 |

**建议原则(写入 v19 设计文档):**
> 凡未经设备实测的数值,**不得**显示 REAL 徽章;模拟数据必须在 UI 上有明显的"SIMULATED"视觉(而不是仅一个小 badge),并且可在设置里**一键关闭孪生**("纯真实模式")。

---

## 4. 模块级深度剖析

### 4.1 声呐(`lib/sonar.ts`)—— 概念对,实现有硬伤

问题(逐条对应代码):

1. **用 `AnalyserNode.getFloatTimeDomainData` 在 `requestAnimationFrame` 里抓麦克风**:每帧(≈16.7ms=800 个新样本)却拷贝 2048 个样本,相邻帧**重叠 2.56 倍**,且 rAF 抖动/后台节流会丢段。拼出的 `captured` 时间轴既不连续也不均匀,xcorr 的 lag 没有物理意义。
   → 应改用 **`AudioWorklet`**(或 `MediaStreamTrackProcessor`)拿**连续、带 `currentFrame` 时间戳**的 PCM。
2. **没有补偿系统延迟**:Android 的输出延迟+输入延迟通常几十 ms(≈ 5–15 米的"距离")。`audio.outputLatency/baseLatency` 没用。直达声(扬声器→麦克风,~十几厘米,约 17 个采样)通常**比回波强得多**,峰值多半是它或系统延迟。
   → 需要**标定流程**:先在"已知无近物"的位置打一发,取直达声峰作 t0;之后只在 t0 之后的窗口里找回波,并做**直达声消除**(模板相减)。
3. **互相关实现粗糙**:`l += 2`、`i += 4`(把 48kHz 的 18–21.5kHz chirp 降采样到 12kHz,**直接混叠**)、**不归一化**,所以 `peak > 0.002` 这个门限没有意义。
   → 改成**FFT 匹配滤波 + 归一化**(用 Hilbert 包络找峰,峰值/噪声底作 SNR),并做**抛物线插值**得到亚采样精度。
4. **每次 ping 都 `createMediaStreamSource` 且从不 `disconnect`**,开启"自动声呐"(2.2s 一次)会不断泄漏节点。`AudioContext` 也从不 `close`。
5. **设备能力没探测**:`getUserMedia` 里设 `echoCancellation:false`,但 Chrome Android 经常忽略;应读 `track.getSettings()` 校验,否则 AEC 会把自己的 chirp 当回声吃掉。扬声器/麦克风在 18kHz 以上的频响也因机而异,需要能力自检(播一发扫频,看接收谱)。
6. **失败静默回落到孪生**:`catch` 里直接返回孪生数据,用户无从知道声呐其实没工作。
7. 信噪比很可能撑不起 8m 量程;单扬声器+单麦克风只能测"最近强反射体距离",没有方位。

**改进路线**:AudioWorklet 采集 → 标定 → 归一化 FFT 匹配滤波 → 直达声消除 → 连续多 ping 平均/中值 → 输出 `{dist, snr, confidence}`,置信度低就显示"无回波"而不是造一个数。现实预期:**近距(<3m)± 1–3 cm**。多麦克风(底部+顶部)可以做粗略到达角,但浏览器拿不到多路原始麦克风,需要原生层。

### 4.2 视觉(`lib/vision.ts`、`device.ts`、`camera-engine.tsx`)

1. **深度估计是魔法常数**:`depth = 1.7 / sqrt(area + 0.01)`,对任何类别、任何镜头(主摄/广角/长焦)一视同仁。
   → 至少换成**针孔模型 + 类别先验高度**(人≈1.7m、椅≈0.9m…):`d = f·H / h_px`,`f` 由镜头 FOV/`track.getSettings()` 推出;长远用**单目深度网络(Depth Anything V2-small,ONNX + WebGPU)** 出相对深度,再用声呐/人体先验标定尺度。
2. **检测模型过时且联网加载**:COCO-SSD lite_mobilenet_v2(2019,精度低)。其权重默认从 `storage.googleapis.com` 拉取(源码里 `BASE_PATH` 已确认)——**在中国大陆网络下大概率加载失败**,而代码只会静默走"帧分析回退"(其实就是平均亮度阈值的连通域)。Google Fonts、jsdelivr(Tesseract)同理。
   → **模型/字体/OCR 引擎全部自托管**到 `/public/models`,由 Service Worker 预缓存,支持离线;换 **YOLO11n/YOLOv8n(ONNX Runtime Web,WebGPU/WASM)** 或 **MediaPipe Object Detector**;人体轮廓用 **MediaPipe Pose/Selfie Segmentation**。
3. **"轮廓"是假的**:`extractContour` 在 96×72 灰度图上对 bbox 内逐列/逐行找第一个梯度点,噪声很大;大部分情况回落成矩形框。真正的轮廓需要实例分割。
4. **条码识别基本不可能成功**:`scanFrameBarcodes(canvas)` 传入的是 **96×72 的分析画布**,QR 根本解不出来。应对原始视频帧(或 ROI 放大后)调用 `BarcodeDetector`。另外用 `now % 1400 < 160` 判断节拍,逻辑脆弱。
5. **性能细节**:`analyzeFrame` 每帧重设 `canvas.width/height`(会清空并重建 2D 上下文)、每帧 `gray.slice()`、`extractBlobs` 内每个像素 `[p-1,p+1,p-w,p+w]` 新建数组。检测跑在主线程,与 3D 渲染争帧。
   → 分析画布只设一次尺寸;复用缓冲;把检测/分析搬到 **Worker + `OffscreenCanvas` / `createImageBitmap`**。
6. 同一个相机流被 `CameraEngine`(隐藏 `<video>`)和 `LiveView` 各挂一个 `<video>`;两处重复的 `srcObject` 逻辑,可以抽成一个 hook / 单例。
7. 检测结果没有**跟踪**(每帧 id 都是 `coco-${i}-${cls}`),人会闪烁、告警会抖;需要 IoU/ByteTrack 一类简单跟踪 + 滑窗平滑。
8. 相机能力:未使用 `ImageCapture`/多镜头枚举(`enumerateDevices` 选超广角/长焦)、未锁曝光/对焦;后续建图需要稳定的内参。

### 4.3 建图与融合(`engine.ts`、`fusion.ts`、`radar-store.ts`)

这是**最大的架构问题**:地图是在"一个写死的 14×10 m 房间"里往外撒点。

1. **点云在约 45 秒后冻结**(真实 bug):`sampleMapPoints` 里 `if (existing > 18000) return []`,而 store 只在 `>20000` 时才裁剪到 18000 → 一旦到达 ~18000,采样永远返回空,**地图再也不增长**(密度=1 时每 tick 约 20 点 ×20Hz≈400 点/s)。`densify` 的 cap 又是 22000,三个上限互相矛盾。
2. **坐标系不统一**:
   - 声呐/孪生:前向 = `(sin h, cos h)`,即 **+z**;
   - 视觉投影:`pz = observer.z - depth*0.92`,前向 = **−z**,且**完全忽略 heading**(转手机检测点不跟着转);
   - `SonarRay` 组件:`z = 3.6 - cos(h)*(d/2)`,而旋转后的盒子是沿 `+cos` 方向延伸 → **射线可视化和它自己的朝向相反**;并且观测点写死 `(-4.2, 3.6)`,而不是 `observerPose(t)`。
   → 建一个统一的 `Frame/Pose` 模块,所有传感器输出先变换到同一世界系再入库。
3. **没有真实位姿**:应使用
   - 短期:`DeviceMotion` + `deviceorientationabsolute` 做**互补/Madgwick 滤波**得到姿态;(当前 `alpha` 是相对角,且罗盘航向 = 360−alpha,代码直接用了 alpha,方向会反。)
   - 中期:**WebXR(ARCore)** 的 6DoF 位姿 + hit-test + depth-sensing,这是浏览器里最接近"真 SLAM"的路径。⚠️ 国行 vivo 通常没有 GMS/ARCore,Chrome 也未必在,需要先在真机上探测 `navigator.xr.isSessionSupported('immersive-ar')`。
   - 长期:原生 App(Capacitor/Kotlin + ARCore 或自研 VIO)。
4. **覆盖率 `coverageRatio` 的分母是写死的房间面积**,换场景就没意义;占用栅格也只有 2D 计数,没有光线投射(free/occupied 区分)、没有概率更新(log-odds)。
5. **点云数据结构**:`MapPoint` 是 `{x,y,z,kind,t}` 对象数组(20k 个对象)。每个 tick `concat` 整个数组、`coverageRatio` 对 2 万点做字符串 key(每秒 20 次 → 40 万次字符串分配)、`occupancyGrid`(开网格时)也是。
   → 改成 **SoA(`Float32Array` 环形缓冲)+ 空间哈希/体素下采样**;覆盖率/栅格增量更新而不是每帧重算。
6. **SAR 只是展示公式**:`computeSar` 算 `δ = λR/2L`,但没有任何相干叠加成像;而且 L 来自假轨迹。要么真做(需要精确位姿,手机 IMU 做不到波长级 ~1.7cm 的相位相干),要么改名成"孔径估计",不要暗示成像。

### 4.4 传感器接入(`device.ts`)

- **Wi-Fi**:浏览器拿不到 RSSI/CSI,这是事实;但 v16 的 Termux 后端**能**拿(`termux-wifi-connectioninfo` 等),v18 把后端整个丢了,所以 Wi-Fi 只剩模拟。→ 保留一个**可选的本机桥接服务**(见 §5)。
  另外 Android 9+ 起 `Wi-Fi RTT (802.11mc)` 能做米级测距,但需要原生 API。
- **监听器泄漏/生命周期**:`start()` 里注册了 devicemotion/deviceorientation/Magnetometer/AmbientLight/geolocation watch,`stop()` 只清了定时器和 geo watch,**其余传感器与事件监听器从不移除**;`lightSensor` 变量赋值后从未使用(lint 警告);`startImu` 被调两次(靠 `motionHooked` 兜底)。
- **磁力计**:无硬铁/软铁标定、无背景估计;阈值写死 65μT;`Magnetometer` 需要 HTTPS + 权限,失败路径没有给用户可见的提示。
- **GNSS**:`readGeo` + `watchGeo` 重复;没用 `speed/heading`,没做精度过滤。
- **时间基准**:所有数据用 `performance.now()` 的 tick 时间,不是**传感器事件自带的 timestamp**,多传感器融合会有 10–50ms 的错位。
- **`probeCapabilities` 的 `torch: available: true`** 写死;`bluetooth` 的 TS 类型报错(`Navigator.bluetooth` 缺类型声明)。

### 4.5 状态管理与渲染性能

- **单个 700 行 store + 20Hz `set()`**:每 50ms 新建 8 个历史数组(`slice()`)、写 ~25 个字段,首页订阅了 20 多个切片,于是 React 以 20Hz 重渲染面板和 4 个 Spark 图。
  → 数据面(传感器历史)放**环形 `Float32Array` + `useSyncExternalStore`/transient subscription**,UI 以 ≤10Hz 节流;React 状态只放低频配置。
- **`MapCloud`**:每帧(建图时)`filter` + 新建两个 `Float32Array` + `new BufferAttribute` 重新上传整块 GPU 缓冲;旧 attribute 没 `dispose`,**长时间运行大概率有 GPU 内存泄漏/GC 抖动**。
  → 预分配固定容量(如 50k)的 `BufferAttribute`,`setDrawRange` + `needsUpdate` 局部更新,颜色按 kind 写一次。
- `OccupancyMesh` 用 400 个独立 `<mesh>`;应换成 `InstancedMesh`。
- `RadarCanvas` 在 `/` 和 `/map` 各挂一个完整 `Canvas`,切页会销毁/重建 WebGL 上下文;可用常驻 Canvas + 路由内容叠加。
- `setInterval(tick, 50)`:后台标签页会被降频到 1s,融合内核语义变了;应使用 `visibilitychange` 暂停/恢复,或把融合内核放进 Worker。
- 报告里宣传的"20Hz 融合内核""延迟 μs"应该改成可复现的 benchmark(见 §6)。

### 4.6 构建、依赖、PWA、工程化

- **包体**(`vite build` 产物):`radar-canvas` chunk **935 KB**,另有 729 KB / 433 KB / 402 KB 的块;TF.js 全量包 + coco-ssd 是大头。→ 路由级 `lazy`,TF.js 改按需 backend(`@tensorflow/tfjs-core + tfjs-backend-webgl`),或迁到 ORT-Web。
- **依赖冗余**:约 20 个 `@radix-ui/*`、`@tanstack/react-query`、`react-table`、`recharts`、`cmdk`、`date-fns`、`react-day-picker`、`react-hook-form`、`@hookform/resolvers`、`react-resizable-panels`、`vaul` **在业务代码里没有被 import**(shadcn 脚手架遗留)。`pg`、`better-auth`、`@electric-sql/pglite`、`jose`、`kysely` 对业务也无作用。→ 删掉,安装时间/攻击面/升级成本都会降。
- **lint**:2 个 error(`spectrum.tsx` 解析错误 + 一个空 block),26 个 warning(`vision.tsx` 因被截断全是未使用 import)。
- **测试**:`npm test` 当前 **189 通过 / 8 失败**。失败全在 `grok-pwa-plugin.test.mjs`,原因是测试直接读了仓库里真实的 `src/lib/og/site.json`(标题是"AETHER…"),而断言期望 "Hello World / Wild Race" → 测试和站点配置**耦合**,改个站点标题测试就红。→ 测试里注入 fixture。
- **PWA/离线**:有 manifest,但没有为模型、字体、WASM 做预缓存;对一个"野外探测"产品,离线可用是刚需。
- **字体**:`fonts.googleapis.com` 在大陆不稳定 → 自托管 woff2。
- **i18n/可访问性**:全中文硬编码,无 i18n 层;按钮只有图标+文字、无 aria 状态;颜色对比靠主题未审计。
- **CI**:无。至少要 `typecheck + lint + test + build` 四道门,否则 §2.1 这种问题会反复出现。

---

## 5. 架构层面的下一步:把"数据来源"做成一等公民

当前 `source: "device" | "twin"` 只是一个标签。建议改成**传感器适配器(Adapter)架构**:

```
┌────────── Sensor Adapters ──────────┐
│ WebSensors   (Mag/IMU/GNSS/Light)   │  ┐
│ AudioSonar   (AudioWorklet)         │  │   统一 SensorFrame
│ CameraVision (Worker + ORT/MediaPipe)│  ├──► { t(传感器时间), kind, value,
│ WebXR        (pose/depth, 可选)      │  │     quality, source: real|replay|sim }
│ TermuxBridge (WS, 可选, Wi-Fi/BT)    │  │
│ Simulator    (twin, 仅 demo/测试)    │  ┘
└──────────────────┬──────────────────┘
                   ▼
        Fusion Core (Worker): 位姿(EKF/互补) → 统一世界系 → 体素/栅格
                   ▼
        Ring buffers (SoA)  ──►  UI(≤10Hz) / three.js(instanced, 增量上传)
```

- **Simulator 与真实通道在类型上隔离**,UI 只读 `quality` 与 `source`;生产构建默认**不加载**模拟器。
- **Replay**:录制 `SensorFrame` 流(JSONL/二进制),离线回放 —— 这是后面写算法测试、做回归的基础,现在完全缺失。
- **TermuxBridge(可选)**:把 v16 后端精简重写 —— 只读 `termux-*` API、`127.0.0.1` 监听、**随机 token + 严格 Origin 校验**、`subprocess` 用参数数组而非 `shell=True`、WebSocket 推送;前端只在探测到桥接时才点亮 Wi-Fi/BT 的 REAL 徽章。

---

## 6. 路线图

### v18.1 "Make it build"(1–2 天,必做)
- [ ] 修 `spectrum.tsx` 的 `>`;补全 `vision.tsx`(或从 v16 拆回);`tsc/eslint/build` 全绿。
- [ ] **轮换已泄露凭据,仓库转私有/清历史**,删 `deploy_to_phone.sh` 里的密码。
- [ ] 解压成真实源码树提交;加 `.gitignore`;写 README(启动、权限、HTTPS 要求)。
- [ ] 修 3 个真 bug:点云 18000 冻结;`SonarRay` 方向/位置;BT 假 RSSI(去掉 REAL 标记或改用 `watchAdvertisements`)。
- [ ] CI:GitHub Actions 跑 typecheck / lint / test / build。
- [ ] 修 8 个测试(fixture 注入)。
**验收**:`npm ci && npm run build && npm test` 零失败。

### v19 "Honest Core"(1–2 周)
- [ ] **纯真实模式**开关;模拟数据全局醒目标识;孪生默认仅在 `?demo=1` 启用。
- [ ] 人物计数/告警/环境分类只用真实输入;`AmbientLightSensor` 并入环境分类。
- [ ] **声呐 v2**:AudioWorklet + 标定 + 归一化 FFT 匹配滤波 + 直达声消除 + 置信度;失败显示"无回波",不再静默回落。
- [ ] 视觉:模型/字体/OCR **自托管 + SW 预缓存**;YOLO/MediaPipe 替换 COCO-SSD;针孔+先验高度估距;简单目标跟踪;条码改用全分辨率帧。
- [ ] 统一坐标系与 `Pose` 模块;姿态用互补滤波 + `deviceorientationabsolute`;视觉点云随 heading 旋转。
- [ ] 传感器生命周期:`stop()` 真正释放;`visibilitychange` 暂停;事件用传感器时间戳。
- [ ] 点云改 SoA 环形缓冲 + 体素下采样;`MapCloud` 预分配 + `setDrawRange`;`InstancedMesh`;UI 节流 10Hz。
- [ ] 清理未使用依赖;路由懒加载;主 chunk < 300KB gz。
- [ ] 单元测试:`fusion/engine/sonar/vision` 纯函数;**声呐用合成回波做回归**(已知延迟→已知距离)。
**验收**:真机上声呐 1m/2m/3m 三点实测,误差报告(含标准差)写进 docs;首页 60fps、`mapPoints` 无增长性 GC;无任何"REAL"徽章对应的是写死/模拟值。

### v20 "Real Map"(2–4 周)
- [ ] 探测 WebXR/ARCore 可用性;可用则接入 6DoF 位姿 + hit-test/depth,替代假轨迹;不可用则降级为 IMU+互补滤波并明确标注"仅姿态"。
- [ ] 占用栅格改 log-odds + 光线投射(free/occupied/unknown);覆盖率按已探索面积计算。
- [ ] 单目深度(Depth Anything V2 small, WebGPU)+ 声呐/人体先验做尺度标定。
- [ ] 地图持久化(IndexedDB,按会话);**导入导出加 zod 校验 + 版本迁移**;导出 PLY/GLB。
- [ ] 录制/回放(JSONL),用于回归与问题复现。
- [ ] 可选 TermuxBridge:真实 Wi-Fi RSSI、BLE 广播 RSSI;Wi-Fi 穿墙判定改为"带基线的变化检测"并写明局限(RSSI 方差只能给'环境有扰动',不是'墙后有人')。

### v21+ 探索方向
- 原生壳(Capacitor/Kotlin):Wi-Fi RTT、BLE 扫描 RSSI、多麦克风采集、USB OTG(热像仪/RTL-SDR)。
- 多机协同:项目已带 `multiplayer-p2p` 脚手架,可做**多手机 Wi-Fi/声学三角定位**与地图拼接。
- 报告自动化:一次会话导出 PDF/HTML(含传感器可信度、实测误差)。

---

## 7. 优先级矩阵

| # | 事项 | 影响 | 工作量 | 优先级 |
|---|---|---|---|---|
| 1 | 凭据轮换 + 清理公开仓库 | 极高(安全) | 小 | **P0** |
| 2 | 修 `spectrum.tsx` / 补 `vision.tsx` | 极高(能不能用) | 小 | **P0** |
| 3 | 点云 18000 冻结、`SonarRay`、BT 假 RSSI | 高 | 小 | **P0** |
| 4 | CI + 修 8 个脆弱测试 | 高 | 小 | P1 |
| 5 | 纯真实模式 / 去除模拟混入真实计数 | 高(可信度) | 中 | P1 |
| 6 | 声呐 v2(Worklet+标定+匹配滤波) | 高 | 中 | P1 |
| 7 | 模型/字体自托管 + 离线(国内网络必需) | 高 | 中 | P1 |
| 8 | 统一坐标系 + 姿态滤波 | 高 | 中 | P1 |
| 9 | 点云 SoA + MapCloud 增量上传 + UI 节流 | 中高 | 中 | P2 |
| 10 | 依赖瘦身 + 路由懒加载 | 中 | 小 | P2 |
| 11 | 检测模型升级 + 跟踪 + 真深度 | 中高 | 大 | P2 |
| 12 | WebXR 位姿 / 真建图 | 极高(产品价值) | 大 | P3(依赖真机能力探测) |
| 13 | TermuxBridge / 原生壳(真 Wi-Fi/BT) | 中高 | 大 | P3 |

---

## 8. 关于定位与文案的建议

v14–v16 文档里有些措辞(如"微秒级雷达""SAR 成像""穿墙看人""全能力真实实现""去模拟")**与代码现状不符**,对外/对自己都会造成预期偏差。建议文案向"**手机多传感器环境感知实验平台**"收敛:
- 能做、且做得好的:相机检测+粗估距、近距声学测距、磁场异常提示、GNSS/IMU 记录、点云可视化。
- 明确做不到的(文档已写,但 UI 仍要同样诚实):热成像、Wi-Fi CSI、真穿墙成像、毫米/微秒级。
- 每个指标旁边显示 **来源(real/sim)、置信度、更新时间**,而不是只显示一个数。
