# AETHER v18 · 功能模块 Bug 与优化点总清单

> 对象:`grok-workspace.zip`(AETHER v18.0)及内嵌 v16 附件。分析日期 2026-10-02。
> 配套文件:`BUGS_AND_OPTIMIZATIONS.csv`(同一份数据,可直接导入 Excel / 飞书 / Jira / GitHub Issues)。
> 背景与路线图见 `ANALYSIS_v18_ROADMAP.md`。

## 0. 怎么读

**优先级**:`P0` 阻断/严重失真,必须先修 · `P1` 明显缺陷或可信度问题 · `P2` 体验/性能/可维护性 · `P3` 打磨

**依据**:`已运行验证` = 我实际跑 tsc / eslint / test / build 得到 · `读码确认` = 逐行读代码确认逻辑 · `需真机验证` = 取决于手机/浏览器实际行为,需上机测

**合计 109 项**:Bug 71 · 优化 36 · 安全 2;P0 10 · P1 30 · P2 48 · P3 21

## 1. 模块 × 级别 一览

| 模块 | P0 | P1 | P2 | P3 | 合计 |
|---|---:|---:|---:|---:|---:|
| 0 工程·仓库·安全 | 3 | 5 | 5 | 1 | 14 |
| 1 应用外壳·指挥台(app-shell / routes/index) | - | 1 | 5 | 1 | 7 |
| 2 视觉(vision.ts / device.ts analyzeFrame / camera-engine / live-view) | - | 5 | 9 | 2 | 16 |
| 3 声呐(sonar.ts / routes/sonar) | 4 | 2 | 4 | 2 | 12 |
| 4 电磁/传感器(device.ts / routes/spectrum) | 1 | 6 | 6 | 2 | 15 |
| 5 建图与 3D 渲染(engine sampleMapPoints / fusion occupancy / radar-canvas / routes/map) | 2 | 3 | 7 | 5 | 17 |
| 6 融合与环境自适应(fusion.ts / hardware.ts / routes/environment) | - | 2 | 3 | 1 | 6 |
| 7 物理孪生(engine.ts) | - | 1 | 1 | 2 | 4 |
| 8 状态管理(radar-store.ts) | - | 2 | 5 | 1 | 8 |
| 9 硬件档案·日志页·图表组件 | - | - | 1 | 4 | 5 |
| 10 附件:v16 Python 后端 / 旧前端(attachments) | - | 3 | 2 | - | 5 |
| **合计** | **10** | **30** | **48** | **21** | **109** |

## 2. 必须最先处理的 P0 清单

| 编号 | 位置 | 问题 | 修复 |
|---|---|---|---|
| M0-S01 | `attachments/…v16_full.zip → radar_platform/scripts/deploy_to_phone.sh` | 公开仓库内含明文凭据(手机 SSH 账号密码、FRP 跳板账号密码、内网 IP、主机指纹) | 立即轮换全部密码;仓库转私有或 git filter-repo 清历史;脚本改读环境变量 / SSH 密钥;禁止 zip 入库 |
| M0-B01 | `src/routes/spectrum.tsx:60` | 项目无法构建:JSX 文本中直接写 `σ > 2.5` | 改为 `σ {">"} 2.5` 或 `σ &gt; 2.5` |
| M0-B02 | `src/routes/vision.tsx` | 「视觉」页是空文件:只有 15 行 import,无 Route 导出、无组件;侧栏链接 404 | 补全页面(LiveView + 相机/变焦/手电/切换镜头/轮廓/OCR/检测列表),store 里对应方法都已就绪 |
| M3-B01 | `sonar.ts:60-80` | 采集时间轴失真:用 AnalyserNode.getFloatTimeDomainData 在 rAF 中抓音;每帧只新增≈800 样本却拷贝 2048 个,相邻帧重叠 2.56 倍,rAF 抖动/后台节流还会丢段 | AudioWorklet(或 MediaStreamTrackProcessor)采集连续 PCM,带 currentFrame 时间戳 |
| M3-B02 | `sonar.ts 全流程` | 未补偿播放/采集系统延迟(Android 通常数十 ms ≈ 数米),也不处理直达声(设扬声器–麦克风约 12cm,仅≈17 个采样,且通常强于回波)→ 峰值多半是直达声/系统延迟 | 标定流程(取直达声峰为 t0)+ 模板相减;使用 outputLatency/baseLatency;只在 t0 后窗口找回波 |
| M3-B03 | `sonar.ts:30-32` | 互相关实现错误:`i+=4` 把 48kHz 的 18–21.5kHz 信号降采样到 12kHz 直接混叠;`l+=2` 丢分辨率;未归一化 | FFT 匹配滤波 + 归一化 + 包络(Hilbert)找峰 + 抛物线插值 |
| M3-B04 | `sonar.ts:83` | 「有效」判定形同虚设:`peak>0.002` 对未归一化相关值几乎必过;距离落在 5cm–8m 就标 device/REAL | 用 SNR(峰/噪声底)与峰宽判定;置信度低显示「无回波」 |
| M4-B01 | `device.ts:234` | 蓝牙 RSSI 写死 -55,却标 source=device 并写 REAL 日志与 toast | 用 watchAdvertisements()/advertisementreceived 取真实 RSSI;取不到就显示 '—' |
| M5-B01 | `engine.ts:303 + radar-store.ts:371` | 点云约 45 秒后冻结:sampleMapPoints 在 existing>18000 时返回 [],而 store 要 >20000 才裁剪到 18000,于是永远卡在 ~18000;densify 又用 cap 22000,三个上限相互矛盾 | 统一容量常量;用环形缓冲覆盖最旧点;或体素下采样 |
| M5-B04 | `engine.ts observerPose` | 观测者位姿是正弦函数 `-4.2+0.35·sin(0.07t)`;真实 IMU 没积分、没有视觉里程计 → 「建图」是在模拟房间里撒点 | 姿态滤波(短期)→ WebXR/ARCore 6DoF(中期,需真机验证)→ 原生 VIO(长期) |

## 3. 按版本排期

### v18.1「能跑起来」(1–2 天) — 18 项

**P0**

- [ ] `M0-S01` 公开仓库内含明文凭据(手机 SSH 账号密码、FRP 跳板账号密码、内网 IP、主机指纹)
- [ ] `M0-B01` 项目无法构建:JSX 文本中直接写 `σ > 2.5`
- [ ] `M0-B02` 「视觉」页是空文件:只有 15 行 import,无 Route 导出、无组件;侧栏链接 404
- [ ] `M4-B01` 蓝牙 RSSI 写死 -55,却标 source=device 并写 REAL 日志与 toast
- [ ] `M5-B01` 点云约 45 秒后冻结:sampleMapPoints 在 existing>18000 时返回 [],而 store 要 >20000 才裁剪到 18000,于是永远卡在 ~18000;densify 又用 cap 22000,三个上限相互矛盾

**P1**

- [ ] `M0-B03` npm test:189 通过 / 8 失败
- [ ] `M0-B05` tsc 另有 6 类类型错误(Points ref 类型、`<line geometry>` 被当作 SVG、Navigator.bluetooth、setState 返回类型、/vision 路由类型)
- [ ] `M0-O01` 整个代码库只是一个 zip 提交(git log 仅一条),无法 diff / review / blame;README 为空
- [ ] `M0-O02` 没有 CI
- [ ] `M2-B01` 切换前后镜头后画面黑屏:startCamera 换了新 stream,但 srcObject 的 effect 只依赖 [cameraOn](仍为 true),video 还挂着已 stop 的旧流
- [ ] `M2-B03` 条码几乎不可能识别:传给 BarcodeDetector 的是 96×72 分析画布;且用 `now % 1400 < 160` 判节拍
- [ ] `M3-B05` 每次 ping 都 createMediaStreamSource 且从不 disconnect;AudioContext 永不 close;开自动声呐(2.2s)持续泄漏节点
- [ ] `M4-B06` stop() 只清定时器和 geo watch;Magnetometer、AmbientLight、devicemotion/deviceorientation 监听从不移除;`lightSensor` 赋值后未使用;startImu 被调两次
- [ ] `M5-B02` SonarRay 与自己的朝向相反:盒子沿 +cos(h) 方向放置,位置却用 z=3.6−cos(h)·d/2;并写死观察点 (-4.2, 3.6) 而不是 observerPose(t)

**P2**

- [ ] `M0-B04` 2 个 error + 26 个 warning
- [ ] `M1-B01` 「真实通道」分母不一致:顶栏 x/6,硬件页 x/8
- [ ] `M6-B04` 同一份权重表写了两遍,易漂移
- [ ] `M10-O01` FINAL_REPORT.md 与 FINAL_REPORT_v14.md 内容完全相同;v14–v16 文案(微秒级、SAR 成像、穿墙看人、去模拟)与代码不符;history/ 有 8 份遗留 HTML/Python

### v19「Honest Core 让真实名副其实」(1–2 周) — 70 项

**P0**

- [ ] `M3-B01` 采集时间轴失真:用 AnalyserNode.getFloatTimeDomainData 在 rAF 中抓音;每帧只新增≈800 样本却拷贝 2048 个,相邻帧重叠 2.56 倍,rAF 抖动/后台节流还会丢段
- [ ] `M3-B02` 未补偿播放/采集系统延迟(Android 通常数十 ms ≈ 数米),也不处理直达声(设扬声器–麦克风约 12cm,仅≈17 个采样,且通常强于回波)→ 峰值多半是直达声/系统延迟
- [ ] `M3-B03` 互相关实现错误:`i+=4` 把 48kHz 的 18–21.5kHz 信号降采样到 12kHz 直接混叠;`l+=2` 丢分辨率;未归一化
- [ ] `M3-B04` 「有效」判定形同虚设:`peak>0.002` 对未归一化相关值几乎必过;距离落在 5cm–8m 就标 device/REAL

**P1**

- [ ] `M0-O03` 业务逻辑零测试(engine/fusion/sonar/vision/store 全无),197 个测试都是平台脚手架
- [ ] `M1-B02` 人物数与告警混入模拟数据:`people=[...twin.people,...visionPeople]` 永远含 3 个虚拟人;模拟「穿墙」告警会触发真手机震动
- [ ] `M2-B02` 回退模式把任何「高/窄」连通块(aspect>1.45)标成 person,score 0.62–0.9、source=device,进入人物计数、3D 人形云和「新增目标」告警
- [ ] `M2-B05` 模型权重默认从 storage.googleapis.com 拉取,大陆网络大概率失败,且只静默回退
- [ ] `M2-O02` 模型过时(COCO-SSD lite_mobilenet_v2);无目标跟踪(id=coco-${i}-${cls},框闪烁、告警抖动)
- [ ] `M3-B06` 失败时静默回落孪生并继续显示距离,用户不知道声呐没工作
- [ ] `M4-B02` Wi-Fi RSSI、σ、穿墙判定 100% 来自孪生,realFlags 里没有 wifi 项,UI 还给出「穿墙扰动」
- [ ] `M4-B03` 陀螺轴映射错误:gx=alpha(实为 z 轴)、gy=beta(x 轴)、gz=gamma(y 轴);accelerationIncludingGravity 符号随平台不同
- [ ] `M4-B04` 航向错误:非 iOS 直接用 alpha 当罗盘航向(alpha 相对初始方向且方向与罗盘相反);未使用 deviceorientationabsolute
- [ ] `M4-B05` iOS 的 DeviceMotion.requestPermission 必须在点击手势中调用,这里在 useEffect 里调用会失败且静默
- [ ] `M4-O01` 所有数据用 tick 的 performance.now()(无传感器事件时间戳),多传感器融合有 10–50ms 错位
- [ ] `M5-B03` 地图点用 observerPose(t) 默认航向,轨迹用设备航向 → 声呐落点不随真实航向转
- [ ] `M5-O01` 点云是 20k 个对象数组,每 tick concat 整个数组
- [ ] `M6-B01` 「五模态融合权重」仅用于显示,没有任何计算使用它(vision/sonar/mag/wifi/depth 并未被加权融合);normalizeWeights、blend、filterPoints 为死代码
- [ ] `M6-B02` 环境分类被孪生驱动:模拟人走到墙后 → wifi.throughWall → env 变「穿墙」,即使相机真实在工作
- [ ] `M7-B01` 孪生与真实数据路径混在同一管线,source 仅为标签;生产默认就启用
- [ ] `M8-B01` SSR/CSR 水合不一致风险:模块加载时读 localStorage,服务端渲染用默认值、客户端用已保存值
- [ ] `M8-O01` 单一巨型 store,20Hz 全量 set(每 tick 新建 8 个历史数组 + 约 25 个字段)

**P2**

- [ ] `M0-O04` 约 30 个依赖未被业务 import:~20 个 @radix-ui/*、react-query、react-table、recharts、cmdk、date-fns、react-day-picker、react-hook-form、@hookform/resolvers、react-resizable-panels、vaul;pg/better-auth/pglite/jose/kysely 对业务无用
- [ ] `M0-O05` radar-canvas chunk 935KB,另有 729/433/402KB 大块
- [ ] `M0-O06` 字体走 fonts.googleapis.com(大陆不稳定);theme-color 与平台注入的 #000000 重复且不一致
- [ ] `M0-O08` manifest 有但无离线:模型/字体/WASM 未预缓存
- [ ] `M1-B03` 只显示 alerts[0],关闭按钮只在日志页;tone 原样显示成 'warn/live/real'
- [ ] `M1-B04` 告警无去重:同一条件每 4s 新增一条,24 条上限很快被同一告警刷满;lastAlertAt 仅在有新告警时更新
- [ ] `M1-O01` 首页订阅 20+ 个切片,store 20Hz 写入使面板与 4 个 Spark 全部 20Hz 重渲染
- [ ] `M1-O03` start() 在 useEffect 里启动,卸载时从不 stop;传感器权限(定位等)在没有用户手势/说明时立刻弹出
- [ ] `M2-B04` 并发调用第二次直接 return false,effect 误判为 fallback;fail 后永不重试;setBackend('webgl') 失败常是返回 false 而非 reject,catch 兜不住
- [ ] `M2-B06` 坐标系不一致:视觉投影前向为 −z 且完全忽略 heading;声呐/孪生前向为 +z(sin h, cos h)
- [ ] `M2-B07` 深度 = 1.7/√(area+0.01),与类别、镜头、变焦无关,却显示到厘米
- [ ] `M2-B08` 每帧 `canvas.width=w` 重置画布与 2D 上下文;每帧 gray.slice()、extractBlobs 每像素 new 数组;边缘只算水平差分且行首行尾串行
- [ ] `M2-O03` 检测/分析跑主线程,与 3D 渲染争帧;CameraEngine 与 LiveView 各挂一个 <video> 且重复 srcObject 逻辑
- [ ] `M2-O04` 每帧 rAF 重绘覆盖层且每帧读 canvas.clientWidth(强制布局);无 devicePixelRatio 处理
- [ ] `M2-O05` 「夜视 / HDR」只是 CSS filter(色相/对比度),不是多曝光融合;v14 报告中的去雾/超分/双边滤波不存在
- [ ] `M3-B07` 设了 echoCancellation:false,但 Chrome Android 常忽略;未用 track.getSettings() 校验,AEC 会吃掉自己的 chirp
- [ ] `M3-B08` 孪生回波迹是合成高斯 + 噪声,显示在「回波迹」图里,与真实采集波形无关(真实路径也复用同一函数生成 trace)
- [ ] `M3-B09` UI 宣称「微秒声呐」「毫米」:采样周期 20.8μs=单程 3.6mm,计入空气温度/设备抖动实际是厘米级
- [ ] `M4-B07` 真机路径用固定阈值 m>65μT 判异常,无硬/软铁标定、无背景估计;与孪生路径(滑窗)逻辑不一致
- [ ] `M4-B08` 定位:readGeo 与 watchGeo 同时发起(重复请求),应用一打开就弹定位权限;未过滤低精度点;未用 speed/heading
- [ ] `M4-B09` 已读取的真实 AmbientLightSensor lux 没参与环境分类;且 Chrome 默认需开 flag,基本不可用
- [ ] `M4-B10` 文案说「Chrome Android 可走 Generic Sensor」,代码实际用 DeviceMotion
- [ ] `M4-B11` `torch: available:true` 写死;wifi/csi/tof/thermal 写死 false 当成「探测结果」
- [ ] `M5-B06` MapCloud 每帧先 filter 全部点再判断是否需要更新 → 空闲时也每帧 O(N);更新时每帧新建两个 Float32Array 与 BufferAttribute,旧 attribute 未 dispose(GPU 内存泄漏/GC 抖动)
- [ ] `M5-B07` `counts` 每次渲染对 20k 点做 6 次 filter,而 mapPoints 20Hz 变化 → 20Hz×6×2 万
- [ ] `M5-B08` 占用网格最多 400 个独立 <mesh>,每次更新整体重建;slice(0,400) 导致大场景只显示前 400 格
- [ ] `M5-B09` 导入无校验:字段可为 NaN/字符串、kind 非法;不恢复 occupancy;不看版本;导入后如继续建图会触发冻结 bug
- [ ] `M5-O03` / 与 /map 各挂一个 Canvas,切页会销毁/重建 WebGL 上下文且丢失相机视角
- [ ] `M6-B03` 规则粗糙:室内明亮(>125)且纹理<0.18 即判「室外」;`noise>42`(其实是对比度)判「噪声」;`wifi.throughWall && sigma>2.5` 重复判断
- [ ] `M6-O01` 环境切换无滞回/平滑,权重突变;手动锁定后无超时提示
- [ ] `M8-B02` 设置无校验/无版本迁移;key 为 aether-v18-settings,换版本全部丢失;kindFilter 缺键会出 undefined
- [ ] `M8-B03` 日志里 `Math.random()<0.12` 随机抽样记录检测事件,日志不可复现
- [ ] `M8-B04` setInterval(50ms):后台标签页被降频到 1s,而 t/动画/融合语义依赖固定步长;无 visibilitychange 暂停
- [ ] `M8-O03` 「延迟 μs」测的是 tick 自身计算耗时
- [ ] `M9-B01` BMI270 / TMD3725 / VL53L5 等型号来自推测(源报告写的是「推测」),界面作为事实陈列;「激光对焦 AR 测距」网页根本访问不到该传感器

**P3**

- [ ] `M1-O02` 「测距 / FPS」两条 Spark 共用一个标签,无单位无坐标轴
- [ ] `M2-B09` `noise` 实际是像素标准差(对比度),并非噪声;`texture` 只统计水平边缘
- [ ] `M2-O07` Tesseract 从 jsdelivr 动态注入,无 SRI,chi_sim 语言包联网下载(约数十 MB);且因 vision 页缺失,OCR 入口目前不可达
- [ ] `M4-B12` ping() 里再次调用 stepTwin(),而 wifiAt/magAt 会向模块级 rssiWindow/magWindow 压入样本 → 每次 ping 污染滑窗并造成 σ 突变
- [ ] `M4-O03` 不同浏览器能力差异(vivo 浏览器/国行无 GMS)未探测与提示
- [ ] `M5-B11` 最多 8 个人形云,按数组下标映射;人员顺序变化时颜色/位置闪烁;超过 8 个直接丢弃
- [ ] `M5-B12` PolarRadar 说「相对观测点」,实际以世界原点居中、观察点画在 (-4.2,3.6),航向扇形绕画布中心旋转而不是绕观察点
- [ ] `M5-O04` 扫描扇形是纯装饰动画,与数据无关,易被误解为真实扫描
- [ ] `M6-B05` 仅显示 V/S 两项权重,格式「V30 S30」不可读;envWeights 每行调用两次
- [ ] `M7-B03` 渲染路径内使用 Math.random()(noise、wifi 抖动、地图点),结果不可复现
- [ ] `M9-B02` 档案写死为 X300,在其它设备上打开仍显示 X300
- [ ] `M9-B04` SVG 折线无坐标轴/单位/最新值;每次渲染重建 path
- [ ] `M9-O01` Metric/SourceBadge 仅 real/twin 二值,看不出置信度与新鲜度

### v20「Real Map 真建图」(2–4 周) — 21 项

**P0**

- [ ] `M5-B04` 观测者位姿是正弦函数 `-4.2+0.35·sin(0.07t)`;真实 IMU 没积分、没有视觉里程计 → 「建图」是在模拟房间里撒点

**P1**

- [ ] `M10-S01` Access-Control-Allow-Origin:* + 默认监听 0.0.0.0 + subprocess.run(shell=True) + 无鉴权:同网任何人/网页可读传感器与 SSE
- [ ] `M10-B01` 文档称「无模拟」,实际 Wi-Fi/磁场失败时返回 random(),并在 `std>1.5 and random()<0.3` 时随机生成「穿墙目标」
- [ ] `M10-O02` v18 丢掉后端后,Wi-Fi/BLE RSSI 只能模拟

**P2**

- [ ] `M2-O01` 「轮廓」是在 96×72 灰度图上逐列逐行找第一个梯度点,噪声大、多数回落为矩形
- [ ] `M2-O06` 固定请求 1280×720@30,未枚举镜头(超广角/长焦)、未锁曝光对焦、无 ImageCapture;建图需要稳定内参
- [ ] `M3-O01` 量程 8m / 单麦克风:只能得到最近强反射体距离,无方位
- [ ] `M4-O02` 每次只能选 1 台设备(requestDevice 弹窗),列表无法持续更新
- [ ] `M5-B05` 覆盖率分母写死为 14×10m 房间面积;每 tick 对 2 万点做字符串 key(≈40 万次分配/秒)
- [ ] `M5-O02` 只有 2D 计数,无光线投射(free/occupied/unknown)、无 log-odds 概率更新
- [ ] `M7-B02` 全局写死的 14×10m 房间、AP、墙、9 件家具、3 个角色名字(林晚/顾深…)
- [ ] `M8-O02` 会话数据只能手动导出 JSON,PGlite/Neon 已接好但业务数据不落库
- [ ] `M10-B02` /proc/net/wireless 的解析做了 `-100` 的粗略换算;正则 `RSSI.*?(-?\d+)` 可能匹配到无关数字

**P3**

- [ ] `M0-O07` 无 i18n(中文硬编码);按钮/状态缺 aria;颜色对比未审计
- [ ] `M3-B10` SAR 的孔径 L 来自模拟轨迹;δ=λR/2L 只是公式展示,没有成像
- [ ] `M3-O02` chirp 频段 18–21.5kHz 对部分设备扬声器/麦克风响应弱,且部分人可听见;无自适应
- [ ] `M5-B10` 导出缺会话元数据(设备、时间、传感器可用性、坐标系说明);包含模拟的 people
- [ ] `M5-O05` 加密是在相邻点之间插中点,会制造不存在的几何
- [ ] `M7-O01` 物体碰撞只做粗略轴对齐近似,墙体仅一堵
- [ ] `M8-B05` 多标签页同时打开会争用相机/麦克风,无互斥提示
- [ ] `M9-B03` 日志上限 240 条、新→旧,过滤用 toLowerCase 重复计算;导出不含地图与能力快照

## 4. 分模块明细

### 0 工程·仓库·安全

| 编号 | 级别 | 类型 | 位置 | 问题 | 原因 | 修复建议 | 版本 | 依据 |
|---|---|---|---|---|---|---|---|---|
| M0-B01 | P0 | Bug | `src/routes/spectrum.tsx:60` | 项目无法构建:JSX 文本中直接写 `σ > 2.5` | `>` 在 JSX 文本中非法;vite build / tsc / eslint 均报错 | 改为 `σ {">"} 2.5` 或 `σ &gt; 2.5` | v18.1 | 已运行验证 |
| M0-B02 | P0 | Bug | `src/routes/vision.tsx` | 「视觉」页是空文件:只有 15 行 import,无 Route 导出、无组件;侧栏链接 404 | 文件疑被截断;构建警告 `does not export a Route`;`tsc` 对 /vision 链接报类型错误 | 补全页面(LiveView + 相机/变焦/手电/切换镜头/轮廓/OCR/检测列表),store 里对应方法都已就绪 | v18.1 | 已运行验证 |
| M0-S01 | P0 | 安全 | `attachments/…v16_full.zip → radar_platform/scripts/deploy_to_phone.sh` | 公开仓库内含明文凭据(手机 SSH 账号密码、FRP 跳板账号密码、内网 IP、主机指纹) | 部署脚本硬编码,并随 zip 提交到 public 仓库 | 立即轮换全部密码;仓库转私有或 git filter-repo 清历史;脚本改读环境变量 / SSH 密钥;禁止 zip 入库 | v18.1 | 读码确认 |
| M0-B03 | P1 | Bug | `scripts/grok-pwa-plugin.test.mjs(8 个用例)` | npm test:189 通过 / 8 失败 | 测试直接读真实 src/lib/og/site.json(标题 AETHER…),断言却期望 Hello World / Wild Race | 测试注入 fixture,不读真实站点配置 | v18.1 | 已运行验证 |
| M0-B05 | P1 | Bug | `radar-canvas.tsx:170,303 / device.ts:227 / radar-store.ts:596 / app-shell.tsx:43,88` | tsc 另有 6 类类型错误(Points ref 类型、`<line geometry>` 被当作 SVG、Navigator.bluetooth、setState 返回类型、/vision 路由类型) | three/R3F 类型与 JSX 内置 `line` 冲突;缺 Web Bluetooth 类型;`source:string` 未收窄 | `<primitive object={new THREE.Line(...)}>`;安装 @types/web-bluetooth;`source: "device" as const` | v18.1 | 已运行验证 |
| M0-O01 | P1 | 优化 | `仓库整体` | 整个代码库只是一个 zip 提交(git log 仅一条),无法 diff / review / blame;README 为空 | 导出产物直接入库 | 解压为真实源码树提交;写 README(运行、权限、HTTPS、已知限制);.grok/ attachments/ artifacts/ 入 .gitignore | v18.1 | 读码确认 |
| M0-O02 | P1 | 优化 | `无` | 没有 CI | — | GitHub Actions:typecheck + lint + test + build,PR 必须全绿 | v18.1 | 读码确认 |
| M0-O03 | P1 | 优化 | `src/**` | 业务逻辑零测试(engine/fusion/sonar/vision/store 全无),197 个测试都是平台脚手架 | — | 为纯函数补单测;声呐用合成回波做回归(已知延迟→已知距离);录制回放做集成测试 | v19 | 读码确认 |
| M0-B04 | P2 | Bug | `eslint` | 2 个 error + 26 个 warning | spectrum 解析错误、空 block、vision.tsx 未使用 import、`lightSensor` 未使用、use-current-user 多余 disable | 修复后把 lint 设为 CI 门禁(warning 也不允许新增) | v18.1 | 已运行验证 |
| M0-O04 | P2 | 优化 | `package.json` | 约 30 个依赖未被业务 import:~20 个 @radix-ui/*、react-query、react-table、recharts、cmdk、date-fns、react-day-picker、react-hook-form、@hookform/resolvers、react-resizable-panels、vaul;pg/better-auth/pglite/jose/kysely 对业务无用 | shadcn 脚手架遗留 + 平台自带鉴权/数据库 | 删除未用依赖;鉴权/数据库若不用,整体移除 src/lib/auth、app-data、db 与 migrations | v19 | 读码确认 |
| M0-O05 | P2 | 优化 | `vite build 产物` | radar-canvas chunk 935KB,另有 729/433/402KB 大块 | TF.js 全量包 + coco-ssd + three 同步进主流程 | 路由级懒加载;TF 只引 core+webgl backend 或改 ORT-Web;three 按需引入;目标主 chunk <300KB gz | v19 | 已运行验证 |
| M0-O06 | P2 | 优化 | `src/routes/__root.tsx` | 字体走 fonts.googleapis.com(大陆不稳定);theme-color 与平台注入的 #000000 重复且不一致 | 外链字体;平台中间件再注入 | 字体自托管 woff2;统一 theme-color | v19 | 读码确认 |
| M0-O08 | P2 | 优化 | `PWA` | manifest 有但无离线:模型/字体/WASM 未预缓存 | — | Service Worker 预缓存模型与引擎,野外无网可用 | v19 | 读码确认 |
| M0-O07 | P3 | 优化 | `全站` | 无 i18n(中文硬编码);按钮/状态缺 aria;颜色对比未审计 | — | 抽出文案字典;补 aria-live/role;跑对比度检查 | v20 | 读码确认 |

### 1 应用外壳·指挥台(app-shell / routes/index)

| 编号 | 级别 | 类型 | 位置 | 问题 | 原因 | 修复建议 | 版本 | 依据 |
|---|---|---|---|---|---|---|---|---|
| M1-B02 | P1 | Bug | `radar-store.ts:363,424` | 人物数与告警混入模拟数据:`people=[...twin.people,...visionPeople]` 永远含 3 个虚拟人;模拟「穿墙」告警会触发真手机震动 | 孪生与真实未隔离 | 真实通道与孪生分离;孪生仅 demo 模式;告警只基于真实输入 | v19 | 读码确认 |
| M1-B01 | P2 | Bug | `app-shell.tsx:72 vs routes/hardware.tsx:46` | 「真实通道」分母不一致:顶栏 x/6,硬件页 x/8 | realFlags 实有 8 项(mag/imu/geo/camera/sonar/bt/light/orient),顶栏写死 6 | 统一从 Object.keys(realFlags).length 计算 | v18.1 | 读码确认 |
| M1-B03 | P2 | Bug | `routes/index.tsx 告警卡` | 只显示 alerts[0],关闭按钮只在日志页;tone 原样显示成 'warn/live/real' | — | 指挥台增加告警列表+关闭;tone 映射成中文 | v19 | 读码确认 |
| M1-B04 | P2 | Bug | `fusion.ts maybeAlerts + store:416-427` | 告警无去重:同一条件每 4s 新增一条,24 条上限很快被同一告警刷满;lastAlertAt 仅在有新告警时更新 | 无 dedup key / 冷却按类型 | 按类型冷却 + 状态翻转触发(进入/离开)而非电平触发 | v19 | 读码确认 |
| M1-O01 | P2 | 优化 | `routes/index.tsx` | 首页订阅 20+ 个切片,store 20Hz 写入使面板与 4 个 Spark 全部 20Hz 重渲染 | 每 tick 新建数组 | UI 订阅节流到 ≤10Hz;历史改环形 Float32Array | v19 | 读码确认 |
| M1-O03 | P2 | 优化 | `app-shell.tsx start()` | start() 在 useEffect 里启动,卸载时从不 stop;传感器权限(定位等)在没有用户手势/说明时立刻弹出 | — | 改成「开始探测」按钮触发;按需逐项申请权限并解释用途 | v19 | 读码确认 |
| M1-O02 | P3 | 优化 | `routes/index.tsx 波形卡` | 「测距 / FPS」两条 Spark 共用一个标签,无单位无坐标轴 | — | 每条独立标签+单位+当前值 | v19 | 读码确认 |

### 2 视觉(vision.ts / device.ts analyzeFrame / camera-engine / live-view)

| 编号 | 级别 | 类型 | 位置 | 问题 | 原因 | 修复建议 | 版本 | 依据 |
|---|---|---|---|---|---|---|---|---|
| M2-B01 | P1 | Bug | `camera-engine.tsx:24 / live-view.tsx:24` | 切换前后镜头后画面黑屏:startCamera 换了新 stream,但 srcObject 的 effect 只依赖 [cameraOn](仍为 true),video 还挂着已 stop 的旧流 | effect 依赖不含 stream 版本 | store 里维护 streamId/version 并加入依赖;或提供 useCameraStream hook | v18.1 | 读码确认 |
| M2-B02 | P1 | Bug | `device.ts:473 extractBlobs` | 回退模式把任何「高/窄」连通块(aspect>1.45)标成 person,score 0.62–0.9、source=device,进入人物计数、3D 人形云和「新增目标」告警 | 用亮度偏离均值>28 的 blob 当人,门/书架/窗帘都会中 | 回退模式不得输出 person,只输出 'object' 且标 low-confidence;或直接关闭回退 | v19 | 读码确认 |
| M2-B03 | P1 | Bug | `camera-engine.tsx:63` | 条码几乎不可能识别:传给 BarcodeDetector 的是 96×72 分析画布;且用 `now % 1400 < 160` 判节拍 | 分析画布分辨率太小;节拍写法脆弱 | 对原始视频帧(或 ROI 放大)调用 detect,用计时器节流 | v18.1 | 读码确认 |
| M2-B05 | P1 | Bug | `vision.ts(coco-ssd BASE_PATH)` | 模型权重默认从 storage.googleapis.com 拉取,大陆网络大概率失败,且只静默回退 | 外链模型 | 权重自托管到 /public/models + SW 预缓存;失败时 UI 明确提示 | v19 | 读码确认 |
| M2-O02 | P1 | 优化 | `vision.ts` | 模型过时(COCO-SSD lite_mobilenet_v2);无目标跟踪(id=coco-${i}-${cls},框闪烁、告警抖动) | — | 换 YOLO11n/YOLOv8n(ORT-Web WebGPU/WASM)或 MediaPipe Object Detector;加 IoU/ByteTrack 简易跟踪与滑窗平滑 | v19 | 读码确认 |
| M2-B04 | P2 | Bug | `vision.ts loadCoco` | 并发调用第二次直接 return false,effect 误判为 fallback;fail 后永不重试;setBackend('webgl') 失败常是返回 false 而非 reject,catch 兜不住 | 状态机不完整 | 用 Promise 缓存 + 指数退避重试;检查 setBackend 返回值 | v19 | 读码确认 |
| M2-B06 | P2 | Bug | `vision.ts:59,178 vs engine.ts rayRange` | 坐标系不一致:视觉投影前向为 −z 且完全忽略 heading;声呐/孪生前向为 +z(sin h, cos h) | 各模块各自约定 | 新建 Pose/Frame 模块;所有传感器先变到统一世界系 | v19 | 读码确认 |
| M2-B07 | P2 | Bug | `vision.ts depth 公式` | 深度 = 1.7/√(area+0.01),与类别、镜头、变焦无关,却显示到厘米 | 魔法常数 | 针孔模型 + 类别先验高度 d=f·H/h_px(f 来自 FOV/变焦);长期换单目深度网络并用声呐/先验标尺 | v19 | 读码确认 |
| M2-B08 | P2 | Bug | `device.ts analyzeFrame` | 每帧 `canvas.width=w` 重置画布与 2D 上下文;每帧 gray.slice()、extractBlobs 每像素 new 数组;边缘只算水平差分且行首行尾串行 | 实现粗糙 | 画布只设一次;复用缓冲;4 邻域用偏移常量;补垂直梯度 | v19 | 读码确认 |
| M2-O01 | P2 | 优化 | `extractContour` | 「轮廓」是在 96×72 灰度图上逐列逐行找第一个梯度点,噪声大、多数回落为矩形 | — | 人体用 MediaPipe 分割/Pose;通用物体用实例分割(YOLO-seg) | v20 | 读码确认 |
| M2-O03 | P2 | 优化 | `camera-engine.tsx` | 检测/分析跑主线程,与 3D 渲染争帧;CameraEngine 与 LiveView 各挂一个 <video> 且重复 srcObject 逻辑 | — | Worker + OffscreenCanvas/createImageBitmap;抽 useCameraStream hook,单视频源 | v19 | 读码确认 |
| M2-O04 | P2 | 优化 | `live-view.tsx` | 每帧 rAF 重绘覆盖层且每帧读 canvas.clientWidth(强制布局);无 devicePixelRatio 处理 | — | ResizeObserver 缓存尺寸;只在检测更新时重绘;按 dpr 缩放 | v19 | 读码确认 |
| M2-O05 | P2 | 优化 | `environment.tsx / live-view.tsx` | 「夜视 / HDR」只是 CSS filter(色相/对比度),不是多曝光融合;v14 报告中的去雾/超分/双边滤波不存在 | — | 改名「增强滤镜」;或实现真 HDR(连续不同曝光合成)/ 暗通道去雾,不做就从文案删除 | v19 | 读码确认 |
| M2-O06 | P2 | 优化 | `device.ts startCamera` | 固定请求 1280×720@30,未枚举镜头(超广角/长焦)、未锁曝光对焦、无 ImageCapture;建图需要稳定内参 | — | enumerateDevices 选镜头;读 getSettings;记录 FOV/内参;支持帧时间戳 | v20 | 读码确认 |
| M2-B09 | P3 | Bug | `device.ts analyzeFrame` | `noise` 实际是像素标准差(对比度),并非噪声;`texture` 只统计水平边缘 | 指标语义与命名不符 | 改名 contrast;噪声用相邻帧差/高频能量估计 | v19 | 读码确认 |
| M2-O07 | P3 | 优化 | `vision.ts runOcr / injectTesseract` | Tesseract 从 jsdelivr 动态注入,无 SRI,chi_sim 语言包联网下载(约数十 MB);且因 vision 页缺失,OCR 入口目前不可达 | — | tesseract.js 与语言包自托管(npm 依赖 + public);加载进度 UI;SRI/版本锁定 | v19 | 读码确认 |

### 3 声呐(sonar.ts / routes/sonar)

| 编号 | 级别 | 类型 | 位置 | 问题 | 原因 | 修复建议 | 版本 | 依据 |
|---|---|---|---|---|---|---|---|---|
| M3-B01 | P0 | Bug | `sonar.ts:60-80` | 采集时间轴失真:用 AnalyserNode.getFloatTimeDomainData 在 rAF 中抓音;每帧只新增≈800 样本却拷贝 2048 个,相邻帧重叠 2.56 倍,rAF 抖动/后台节流还会丢段 | AnalyserNode 不是连续采样接口 | AudioWorklet(或 MediaStreamTrackProcessor)采集连续 PCM,带 currentFrame 时间戳 | v19 | 读码确认 |
| M3-B02 | P0 | Bug | `sonar.ts 全流程` | 未补偿播放/采集系统延迟(Android 通常数十 ms ≈ 数米),也不处理直达声(设扬声器–麦克风约 12cm,仅≈17 个采样,且通常强于回波)→ 峰值多半是直达声/系统延迟 | 没有标定与直达声消除 | 标定流程(取直达声峰为 t0)+ 模板相减;使用 outputLatency/baseLatency;只在 t0 后窗口找回波 | v19 | 读码确认,需真机验证 |
| M3-B03 | P0 | Bug | `sonar.ts:30-32` | 互相关实现错误:`i+=4` 把 48kHz 的 18–21.5kHz 信号降采样到 12kHz 直接混叠;`l+=2` 丢分辨率;未归一化 | 性能取巧 | FFT 匹配滤波 + 归一化 + 包络(Hilbert)找峰 + 抛物线插值 | v19 | 读码确认 |
| M3-B04 | P0 | Bug | `sonar.ts:83` | 「有效」判定形同虚设:`peak>0.002` 对未归一化相关值几乎必过;距离落在 5cm–8m 就标 device/REAL | 门限无物理依据 | 用 SNR(峰/噪声底)与峰宽判定;置信度低显示「无回波」 | v19 | 读码确认 |
| M3-B05 | P1 | Bug | `sonar.ts:51` | 每次 ping 都 createMediaStreamSource 且从不 disconnect;AudioContext 永不 close;开自动声呐(2.2s)持续泄漏节点 | 生命周期缺失 | 复用单个 source/worklet;stop 时 disconnect+close | v18.1 | 读码确认 |
| M3-B06 | P1 | Bug | `sonar.ts catch / plausible=false` | 失败时静默回落孪生并继续显示距离,用户不知道声呐没工作 | — | 明确状态:未授权/无回波/低信噪比;不再用孪生填值 | v19 | 读码确认 |
| M3-B07 | P2 | Bug | `device.ts startMic` | 设了 echoCancellation:false,但 Chrome Android 常忽略;未用 track.getSettings() 校验,AEC 会吃掉自己的 chirp | — | 读取实际设置,不满足时提示;能力自检(播扫频看接收谱) | v19 | 读码确认,需真机验证 |
| M3-B08 | P2 | Bug | `engine.ts pingFromDistance / sonarEchoTrace` | 孪生回波迹是合成高斯 + 噪声,显示在「回波迹」图里,与真实采集波形无关(真实路径也复用同一函数生成 trace) | trace 由距离反推,而非来自采样 | 真实路径显示真实匹配滤波输出;孪生路径明确标注 | v19 | 读码确认 |
| M3-B09 | P2 | Bug | `routes/sonar.tsx + utils.formatMeters/formatUs` | UI 宣称「微秒声呐」「毫米」:采样周期 20.8μs=单程 3.6mm,计入空气温度/设备抖动实际是厘米级 | 指标夸大 | 改为「近距声学测距」,显示不确定度 ±x cm;温度补偿 c=331.3+0.606T | v19 | 读码确认 |
| M3-O01 | P2 | 优化 | `sonar.ts` | 量程 8m / 单麦克风:只能得到最近强反射体距离,无方位 | — | 多 ping 平均/中值;多麦克风需原生层;限定量程到 <3m 并标定 | v20 | 读码确认 |
| M3-B10 | P3 | Bug | `routes/sonar.tsx SAR 卡` | SAR 的孔径 L 来自模拟轨迹;δ=λR/2L 只是公式展示,没有成像 | — | 改名「孔径估计」或下线;真 SAR 需 cm 级位姿,手机 IMU 做不到 | v20 | 读码确认 |
| M3-O02 | P3 | 优化 | `sonar.ts makeChirp` | chirp 频段 18–21.5kHz 对部分设备扬声器/麦克风响应弱,且部分人可听见;无自适应 | — | 可配置频段+设备自检,选择响应最好的子带 | v20 | 需真机验证 |

### 4 电磁/传感器(device.ts / routes/spectrum)

| 编号 | 级别 | 类型 | 位置 | 问题 | 原因 | 修复建议 | 版本 | 依据 |
|---|---|---|---|---|---|---|---|---|
| M4-B01 | P0 | Bug | `device.ts:234` | 蓝牙 RSSI 写死 -55,却标 source=device 并写 REAL 日志与 toast | Web Bluetooth requestDevice 不给 RSSI | 用 watchAdvertisements()/advertisementreceived 取真实 RSSI;取不到就显示 '—' | v18.1 | 读码确认 |
| M4-B02 | P1 | Bug | `engine.ts wifiAt / store` | Wi-Fi RSSI、σ、穿墙判定 100% 来自孪生,realFlags 里没有 wifi 项,UI 还给出「穿墙扰动」 | 浏览器拿不到 RSSI;v18 丢弃了 v16 的 Termux 后端 | 明确标注「模拟」;提供可选 Termux 桥接/原生壳获取真实 RSSI | v19 | 读码确认 |
| M4-B03 | P1 | Bug | `device.ts:162-175 startImu` | 陀螺轴映射错误:gx=alpha(实为 z 轴)、gy=beta(x 轴)、gz=gamma(y 轴);accelerationIncludingGravity 符号随平台不同 | DeviceMotion rotationRate 的 alpha/beta/gamma 不等于 x/y/z | 按规范映射为 z/x/y;文档里写明坐标约定;统一转换到机体系 | v19 | 读码确认 |
| M4-B04 | P1 | Bug | `device.ts:184` | 航向错误:非 iOS 直接用 alpha 当罗盘航向(alpha 相对初始方向且方向与罗盘相反);未使用 deviceorientationabsolute | — | 监听 deviceorientationabsolute;heading=360−alpha 并做磁偏角处理;姿态用互补/Madgwick 滤波 | v19 | 读码确认 |
| M4-B05 | P1 | Bug | `radar-store.ts start()` | iOS 的 DeviceMotion.requestPermission 必须在点击手势中调用,这里在 useEffect 里调用会失败且静默 | — | 放到「开始探测」按钮的 onClick | v19 | 读码确认 |
| M4-B06 | P1 | Bug | `radar-store.ts start()/stop()` | stop() 只清定时器和 geo watch;Magnetometer、AmbientLight、devicemotion/deviceorientation 监听从不移除;`lightSensor` 赋值后未使用;startImu 被调两次 | 生命周期缺失 | 统一 SensorHub:start/stop 返回 disposer,卸载时全部释放 | v18.1 | 读码确认 |
| M4-O01 | P1 | 优化 | `device.ts` | 所有数据用 tick 的 performance.now()(无传感器事件时间戳),多传感器融合有 10–50ms 错位 | — | 用 SensorEvent.timestamp / AudioContext 帧时钟;统一时钟对齐 | v19 | 读码确认 |
| M4-B07 | P2 | Bug | `device.ts startMagnetometer` | 真机路径用固定阈值 m>65μT 判异常,无硬/软铁标定、无背景估计;与孪生路径(滑窗)逻辑不一致 | — | 背景滑窗 + 标定向导(八字);统一为同一判定函数 | v19 | 读码确认 |
| M4-B08 | P2 | Bug | `radar-store.ts start()` | 定位:readGeo 与 watchGeo 同时发起(重复请求),应用一打开就弹定位权限;未过滤低精度点;未用 speed/heading | — | 只用 watchPosition;用户确认后再启用;accuracy>50m 丢弃 | v19 | 读码确认 |
| M4-B09 | P2 | Bug | `engine.ts classifyEnv / store` | 已读取的真实 AmbientLightSensor lux 没参与环境分类;且 Chrome 默认需开 flag,基本不可用 | — | lux 作为亮度主输入(可用时),相机亮度做备份 | v19 | 读码确认 |
| M4-B10 | P2 | Bug | `routes/spectrum.tsx IMU 卡` | 文案说「Chrome Android 可走 Generic Sensor」,代码实际用 DeviceMotion | 文案与实现不符 | 统一实现或改文案;可用时用 Accelerometer/Gyroscope Generic Sensor(带硬件时间戳) | v19 | 读码确认 |
| M4-B11 | P2 | Bug | `device.ts probeCapabilities` | `torch: available:true` 写死;wifi/csi/tof/thermal 写死 false 当成「探测结果」 | — | torch 由 videoCapabilities 决定;写死项分组为「平台限制」而非探测 | v19 | 读码确认 |
| M4-O02 | P2 | 优化 | `device.ts scanBluetooth` | 每次只能选 1 台设备(requestDevice 弹窗),列表无法持续更新 | — | watchAdvertisements + 过滤器;持续刷新 RSSI 与老化 | v20 | 读码确认 |
| M4-B12 | P3 | Bug | `radar-store.ts ping() / engine.ts` | ping() 里再次调用 stepTwin(),而 wifiAt/magAt 会向模块级 rssiWindow/magWindow 压入样本 → 每次 ping 污染滑窗并造成 σ 突变 | stepTwin 有副作用 | stepTwin 纯函数化(窗口放入显式 state);ping 只读 twin 当前快照 | v19 | 读码确认 |
| M4-O03 | P3 | 优化 | `—` | 不同浏览器能力差异(vivo 浏览器/国行无 GMS)未探测与提示 | — | 首次进入跑能力矩阵并给出「建议使用的浏览器/安装方式」 | v19 | 需真机验证 |

### 5 建图与 3D 渲染(engine sampleMapPoints / fusion occupancy / radar-canvas / routes/map)

| 编号 | 级别 | 类型 | 位置 | 问题 | 原因 | 修复建议 | 版本 | 依据 |
|---|---|---|---|---|---|---|---|---|
| M5-B01 | P0 | Bug | `engine.ts:303 + radar-store.ts:371` | 点云约 45 秒后冻结:sampleMapPoints 在 existing>18000 时返回 [],而 store 要 >20000 才裁剪到 18000,于是永远卡在 ~18000;densify 又用 cap 22000,三个上限相互矛盾 | 上限散落三处 | 统一容量常量;用环形缓冲覆盖最旧点;或体素下采样 | v18.1 | 读码确认 |
| M5-B04 | P0 | Bug | `engine.ts observerPose` | 观测者位姿是正弦函数 `-4.2+0.35·sin(0.07t)`;真实 IMU 没积分、没有视觉里程计 → 「建图」是在模拟房间里撒点 | 没有真实位姿估计 | 姿态滤波(短期)→ WebXR/ARCore 6DoF(中期,需真机验证)→ 原生 VIO(长期) | v20 | 读码确认 |
| M5-B02 | P1 | Bug | `radar-canvas.tsx:317` | SonarRay 与自己的朝向相反:盒子沿 +cos(h) 方向放置,位置却用 z=3.6−cos(h)·d/2;并写死观察点 (-4.2, 3.6) 而不是 observerPose(t) | 符号错误 + 硬编码 | 位置用 +cos;观察点读 store | v18.1 | 读码确认 |
| M5-B03 | P1 | Bug | `engine.ts sampleMapPoints / store tick` | 地图点用 observerPose(t) 默认航向,轨迹用设备航向 → 声呐落点不随真实航向转 | 两处姿态来源不同 | 传入同一 pose 对象 | v19 | 读码确认 |
| M5-O01 | P1 | 优化 | `MapPoint 结构` | 点云是 20k 个对象数组,每 tick concat 整个数组 | — | SoA(Float32Array 环形缓冲)+ 体素/空间哈希下采样 | v19 | 读码确认 |
| M5-B05 | P2 | Bug | `fusion.ts coverageRatio` | 覆盖率分母写死为 14×10m 房间面积;每 tick 对 2 万点做字符串 key(≈40 万次分配/秒) | — | 按已探索栅格数/可达范围计算;增量更新 | v20 | 读码确认 |
| M5-B06 | P2 | Bug | `radar-canvas.tsx:229` | MapCloud 每帧先 filter 全部点再判断是否需要更新 → 空闲时也每帧 O(N);更新时每帧新建两个 Float32Array 与 BufferAttribute,旧 attribute 未 dispose(GPU 内存泄漏/GC 抖动) | early-return 位置错误 | 预分配固定容量 BufferAttribute,setDrawRange + needsUpdate 局部更新;用版本号判脏 | v19 | 读码确认 |
| M5-B07 | P2 | Bug | `routes/map.tsx:55` | `counts` 每次渲染对 20k 点做 6 次 filter,而 mapPoints 20Hz 变化 → 20Hz×6×2 万 | — | store 内增量维护各类计数 | v19 | 读码确认 |
| M5-B08 | P2 | Bug | `radar-canvas.tsx OccupancyMesh` | 占用网格最多 400 个独立 <mesh>,每次更新整体重建;slice(0,400) 导致大场景只显示前 400 格 | — | InstancedMesh;按视锥/距离裁剪 | v19 | 读码确认 |
| M5-B09 | P2 | Bug | `radar-store.ts importMap` | 导入无校验:字段可为 NaN/字符串、kind 非法;不恢复 occupancy;不看版本;导入后如继续建图会触发冻结 bug | JSON.parse 后直接信任 | 用 zod 校验 + 版本迁移 + 限制数量与数值范围 | v19 | 读码确认 |
| M5-O02 | P2 | 优化 | `occupancyGrid` | 只有 2D 计数,无光线投射(free/occupied/unknown)、无 log-odds 概率更新 | — | 对每个测距光线更新栅格(Bresenham + log-odds) | v20 | 读码确认 |
| M5-O03 | P2 | 优化 | `RadarCanvas` | / 与 /map 各挂一个 Canvas,切页会销毁/重建 WebGL 上下文且丢失相机视角 | — | 常驻 Canvas,路由内容叠加;保存相机状态 | v19 | 读码确认 |
| M5-B10 | P3 | Bug | `radar-store.ts exportMap` | 导出缺会话元数据(设备、时间、传感器可用性、坐标系说明);包含模拟的 people | — | 加 schema 版本与元数据;排除模拟数据或明确标记;支持 PLY/GLB | v20 | 读码确认 |
| M5-B11 | P3 | Bug | `radar-canvas.tsx PeopleClouds` | 最多 8 个人形云,按数组下标映射;人员顺序变化时颜色/位置闪烁;超过 8 个直接丢弃 | 按 index 绑定 | 按 id 绑定并做对象池 | v19 | 读码确认 |
| M5-B12 | P3 | Bug | `radar-canvas.tsx / polar-radar.tsx` | PolarRadar 说「相对观测点」,实际以世界原点居中、观察点画在 (-4.2,3.6),航向扇形绕画布中心旋转而不是绕观察点 | — | 以观察点为中心做相对坐标变换 | v19 | 读码确认 |
| M5-O04 | P3 | 优化 | `radar-canvas.tsx Sweep` | 扫描扇形是纯装饰动画,与数据无关,易被误解为真实扫描 | — | 绑定真实声呐/视场,或去掉 | v19 | 读码确认 |
| M5-O05 | P3 | 优化 | `densify` | 加密是在相邻点之间插中点,会制造不存在的几何 | — | 改为按表面法线/体素填充,或删除并避免伪造数据 | v20 | 读码确认 |

### 6 融合与环境自适应(fusion.ts / hardware.ts / routes/environment)

| 编号 | 级别 | 类型 | 位置 | 问题 | 原因 | 修复建议 | 版本 | 依据 |
|---|---|---|---|---|---|---|---|---|
| M6-B01 | P1 | Bug | `radar-store.ts:403` | 「五模态融合权重」仅用于显示,没有任何计算使用它(vision/sonar/mag/wifi/depth 并未被加权融合);normalizeWeights、blend、filterPoints 为死代码 | 权重只是展示 | 要么真实现(置信度加权融合 / 卡尔曼);要么改名「场景预设」并删除融合的措辞 | v19 | 读码确认 |
| M6-B02 | P1 | Bug | `engine.ts:215` | 环境分类被孪生驱动:模拟人走到墙后 → wifi.throughWall → env 变「穿墙」,即使相机真实在工作 | 分类输入含模拟 Wi-Fi | 真实模式下只用真实输入;缺项则该类别不参与 | v19 | 读码确认 |
| M6-B03 | P2 | Bug | `engine.ts classifyEnv` | 规则粗糙:室内明亮(>125)且纹理<0.18 即判「室外」;`noise>42`(其实是对比度)判「噪声」;`wifi.throughWall && sigma>2.5` 重复判断 | — | 加入 lux、GNSS 精度/速度、帧间运动;用滞回(hysteresis)避免抖动 | v19 | 读码确认 |
| M6-B04 | P2 | Bug | `hardware.ts FUSION_MODES vs engine.ts envWeights` | 同一份权重表写了两遍,易漂移 | 双重数据源 | 只保留一份(FUSION_MODES),envWeights 从中读取 | v18.1 | 读码确认 |
| M6-O01 | P2 | 优化 | `environment` | 环境切换无滞回/平滑,权重突变;手动锁定后无超时提示 | — | 指数平滑权重;锁定态显著提示 | v19 | 读码确认 |
| M6-B05 | P3 | Bug | `routes/environment.tsx 底部列表` | 仅显示 V/S 两项权重,格式「V30 S30」不可读;envWeights 每行调用两次 | — | 展示全部 5 项或迷你条形图 | v19 | 读码确认 |

### 7 物理孪生(engine.ts)

| 编号 | 级别 | 类型 | 位置 | 问题 | 原因 | 修复建议 | 版本 | 依据 |
|---|---|---|---|---|---|---|---|---|
| M7-B01 | P1 | Bug | `engine.ts 整体` | 孪生与真实数据路径混在同一管线,source 仅为标签;生产默认就启用 | — | Simulator 适配器独立,仅 ?demo=1 / 测试启用;UI 对模拟数据加醒目水印 | v19 | 读码确认 |
| M7-B02 | P2 | Bug | `engine.ts ROOM/AP/WALL_X/OBJECTS` | 全局写死的 14×10m 房间、AP、墙、9 件家具、3 个角色名字(林晚/顾深…) | — | 场景配置化(JSON);演示场景与产品逻辑分离 | v20 | 读码确认 |
| M7-B03 | P3 | Bug | `engine.ts stepTwin` | 渲染路径内使用 Math.random()(noise、wifi 抖动、地图点),结果不可复现 | — | 注入 seeded PRNG,支持录制回放与确定性测试 | v19 | 读码确认 |
| M7-O01 | P3 | 优化 | `engine.ts rayRange` | 物体碰撞只做粗略轴对齐近似,墙体仅一堵 | — | 若保留孪生,改成正确的 AABB/射线求交 | v20 | 读码确认 |

### 8 状态管理(radar-store.ts)

| 编号 | 级别 | 类型 | 位置 | 问题 | 原因 | 修复建议 | 版本 | 依据 |
|---|---|---|---|---|---|---|---|---|
| M8-B01 | P1 | Bug | `radar-store.ts:216` | SSR/CSR 水合不一致风险:模块加载时读 localStorage,服务端渲染用默认值、客户端用已保存值 | 初始状态依赖 window | 初始用默认值,mount 后再 hydrate 设置 | v19 | 读码确认 |
| M8-O01 | P1 | 优化 | `radar-store.ts(702 行)` | 单一巨型 store,20Hz 全量 set(每 tick 新建 8 个历史数组 + 约 25 个字段) | — | 拆分:sensorsRing(高频,外部 store)/ session(中频)/ settings(低频);transient subscription + ≤10Hz UI 节流 | v19 | 读码确认 |
| M8-B02 | P2 | Bug | `radar-store.ts:200-216 loadSettings` | 设置无校验/无版本迁移;key 为 aether-v18-settings,换版本全部丢失;kindFilter 缺键会出 undefined | — | zod 校验 + 带版本迁移 + 合并默认值 | v19 | 读码确认 |
| M8-B03 | P2 | Bug | `radar-store.ts:627` | 日志里 `Math.random()<0.12` 随机抽样记录检测事件,日志不可复现 | — | 按时间节流(如 1 次/秒) | v19 | 读码确认 |
| M8-B04 | P2 | Bug | `radar-store.ts tick` | setInterval(50ms):后台标签页被降频到 1s,而 t/动画/融合语义依赖固定步长;无 visibilitychange 暂停 | — | 暂停/恢复,或使用 dt 积分;长期放入 Worker | v19 | 读码确认 |
| M8-O02 | P2 | 优化 | `radar-store.ts` | 会话数据只能手动导出 JSON,PGlite/Neon 已接好但业务数据不落库 | — | IndexedDB 自动保存会话;按会话列表/恢复 | v20 | 读码确认 |
| M8-O03 | P2 | 优化 | `radar-store.ts latencyUs` | 「延迟 μs」测的是 tick 自身计算耗时 | 指标误导 | 改为「内核耗时 ms」,另测真实传感器到显示延迟 | v19 | 读码确认 |
| M8-B05 | P3 | Bug | `radar-store.ts` | 多标签页同时打开会争用相机/麦克风,无互斥提示 | — | BroadcastChannel/Web Locks 保证单实例 | v20 | 需真机验证 |

### 9 硬件档案·日志页·图表组件

| 编号 | 级别 | 类型 | 位置 | 问题 | 原因 | 修复建议 | 版本 | 依据 |
|---|---|---|---|---|---|---|---|---|
| M9-B01 | P2 | Bug | `lib/hardware.ts SENSORS` | BMI270 / TMD3725 / VL53L5 等型号来自推测(源报告写的是「推测」),界面作为事实陈列;「激光对焦 AR 测距」网页根本访问不到该传感器 | 文案夸大 | 型号列「推测/未证实」;删除无法在 Web 访问的传感器用途声明 | v19 | 读码确认 |
| M9-B02 | P3 | Bug | `routes/hardware.tsx / DEVICE` | 档案写死为 X300,在其它设备上打开仍显示 X300 | — | 用 UA Client Hints(model)检测并提示「当前不是 X300」 | v19 | 读码确认 |
| M9-B03 | P3 | Bug | `routes/log.tsx` | 日志上限 240 条、新→旧,过滤用 toLowerCase 重复计算;导出不含地图与能力快照 | — | 分页/虚拟列表;导出会话包 | v20 | 读码确认 |
| M9-B04 | P3 | Bug | `components/charts/trace.tsx / spark.tsx` | SVG 折线无坐标轴/单位/最新值;每次渲染重建 path | — | Canvas 绘制 + 环形缓冲;加单位与刻度 | v19 | 读码确认 |
| M9-O01 | P3 | 优化 | `components/panels/*` | Metric/SourceBadge 仅 real/twin 二值,看不出置信度与新鲜度 | — | 统一 DataBadge:source + quality + age | v19 | 读码确认 |

### 10 附件:v16 Python 后端 / 旧前端(attachments)

| 编号 | 级别 | 类型 | 位置 | 问题 | 原因 | 修复建议 | 版本 | 依据 |
|---|---|---|---|---|---|---|---|---|
| M10-B01 | P1 | Bug | `backend/app.py:93,134,377-420` | 文档称「无模拟」,实际 Wi-Fi/磁场失败时返回 random(),并在 `std>1.5 and random()<0.3` 时随机生成「穿墙目标」 | — | 失败就返回 null+原因,绝不生成目标 | v20 | 读码确认 |
| M10-O02 | P1 | 优化 | `桥接` | v18 丢掉后端后,Wi-Fi/BLE RSSI 只能模拟 | — | 重写最小 Termux 桥接:只读 termux-* API,127.0.0.1,WebSocket,token,前端探测到才点亮 REAL | v20 | 读码确认 |
| M10-S01 | P1 | 安全 | `backend/app.py` | Access-Control-Allow-Origin:* + 默认监听 0.0.0.0 + subprocess.run(shell=True) + 无鉴权:同网任何人/网页可读传感器与 SSE | — | 仅监听 127.0.0.1;随机 token + Origin 白名单;subprocess 用参数数组 | v20 | 读码确认 |
| M10-B02 | P2 | Bug | `backend/app.py get_real_wifi` | /proc/net/wireless 的解析做了 `-100` 的粗略换算;正则 `RSSI.*?(-?\d+)` 可能匹配到无关数字 | — | 改用 termux-wifi-connectioninfo 的 JSON;去掉启发式 | v20 | 读码确认 |
| M10-O01 | P2 | 优化 | `docs/` | FINAL_REPORT.md 与 FINAL_REPORT_v14.md 内容完全相同;v14–v16 文案(微秒级、SAR 成像、穿墙看人、去模拟)与代码不符;history/ 有 8 份遗留 HTML/Python | — | 删重复;文档按「已实现/部分/不可能」三栏重写;history 移出主仓库 | v18.1 | 读码确认 |

## 5. 说明与边界

- 「已运行验证」项的命令:`npx tsc --noEmit`、`npx eslint src`、`npm test`、`npx vite build`(在解压后的源码上执行;未改动你的仓库源码)。
- 声呐、IMU 轴向、航向、麦克风 AEC、AmbientLightSensor、ARCore/WebXR 可用性等**依赖真机行为**的结论,标了「需真机验证」;建议 v19 先做一次 vivo X300 实机测量并把结果写进 docs。
- 编号规则:`M<模块号>-<B/O/S><序号>`,B=Bug、O=优化、S=安全。
