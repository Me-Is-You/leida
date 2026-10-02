# v19 自研算法与节点精修

本文记录哪些算法已经换成自研实现、怎么验证、实测数字，以及哪些**没有**换、为什么。

## 一、自研清单

| 节点 | 之前 | 现在（文件） | 验证 |
|---|---|---|---|
| FFT / 匹配滤波 | 每次 ping 约 10 次满尺寸 FFT | 预计算计划缓存的 FFT；一次脉冲约 1.7 次满尺寸 FFT 当量（`core/dsp.ts`、`core/matched.ts`） | 节点测试；bench 63.3 → 11.7 ms（5.4×） |
| 声呐数据通路 | 主线程做 DSP | Worker 里做 DSP，下一次录音与上一次 DSP 流水线重叠；失败自动永久回退主线程（`sonar-client.ts`、`workers/sonar.worker.ts`、`core/sonar-params.ts`） | 浏览器端到端：假麦克风 + 已知回波，0.4/0.8/1.5/3.2/4.6 m 读数 0.400/0.798/1.498/3.200/4.600 m；无回波时显示「没有足够强的回波」，不编造数字 |
| 3D 渲染 | three + r3f + drei（radar-canvas 块 936 kB） | 自研 WebGL2 渲染器（`gl/mat4.ts`、`gl/orbit.ts`、`gl/renderer.ts`）；radar-canvas 块约 22 kB | 6 个 GL 数学测试；浏览器里拖动/滚轮/点击无报错，场景正常绘制 |
| 状态仓库 | zustand | `store.ts`（`useSyncExternalStore`，SSR/水合使用初始快照） | 3 个测试；顺带修复了 `/sonar` 的水合不一致 |
| 配置/会话校验 | zod | `core/schema.ts`（逐字段修复、默认值、剥离未知键） | 测试含旧版 V1 会话迁移 |
| 点云环 | `Map` | 开放寻址 Int32 哈希表 + 后移删除（`core/cloud.ts`） | 与 Map 参考实现等价测试；20k 次 add 6.0 → 2.1 ms |
| 占据栅格 | `Map<string,…>` | 可倍增的类型化哈希表，`forEachOccupied`（`core/occupancy.ts`） | 与旧实现（`fixtures/occupancy-ref.ts`）等价测试；无分配 |
| 运动检测 | 无 | 背景减除：背景只在静止像素更新、直方图中位数估噪声、曝光偏移补偿、停放/鬼影吸收、自运动闸门（`core/motion-detect.ts`） | 合成场景测试：跟随移动方块、静止场景无框、曝光跳变不误报、手抖被闸掉 |
| 推理调度 | 固定 ~7 Hz | 场景活跃时连续推理，静止时降到约 1 Hz，长时间安静约 0.4 Hz，电量低且未充电时再放慢（`core/detect-sched.ts`） | 调度器测试；节省的是 GPU/电量，不影响变化后的响应（任何变化一帧内唤醒） |
| 帧统计 | Float32 + 多遍 | 整数亮度、单遍统计（`core/imageops.ts`） | 单测 |
| OCR 预处理 | 整帧直接交给 Tesseract | 文字行定位 + 极性判断 + 裁剪 + Sauvola 自适应二值化；识别太差时自动回退原图（`core/imageops.ts`、`ocr-prep.ts`） | 单测；浏览器里对带强光照渐变的图识别 3 行，置信度 95% |
| 二维码 | 仅 BarcodeDetector | 自研 QR 解码器：有限域 GF(256) + Berlekamp–Massey/Chien/Forney 纠错、版本 1–40、全部纠错级别、数字/字母/字节/汉字/ECI；定位器：Sauvola → 1:1:3:1:1 探测 → 三点定向 → 对齐图形 → 单应变换 → 5 点多数采样（`core/qr-decode.ts`、`core/qr-locate.ts`） | 8 个由 `qrcode` 包一次性生成的参考符号；随机错误纠错测试；旋转/透视/模糊/噪声/不均匀光照图像测试；浏览器 7/8 通过（唯一失败是 77 模块的 v15 码被缩到约 2.4 px/模块） |
| 节点耗时 | 无 | `perf.ts` + 硬件页「管线节点耗时」表（平均/峰值/Hz/累计） | 浏览器里能看到各节点实测值 |

测试：`node --experimental-strip-types --test src/lib/core/*.test.ts src/lib/gl/*.test.ts src/lib/store.test.ts`（93 项）。
基准：`node --experimental-strip-types bench/core.bench.ts ../src/lib/core`。
端到端脚本在 `e2e/`（需要本地安装 `@sparticuz/chromium` 与 `playwright-core`，没有加入依赖）。

## 二、页面 / 路由节点

- 顶栏状态条抽成独立 `memo` 组件，10 Hz 的帧率/时钟更新不再重渲染导航和页面；帧率取整后才触发更新。
- 无障碍：跳到主内容链接、`aria-label` 导航、`aria-current="page"`、数据模式按钮 `aria-pressed`、性能表带 `caption` 与 `scope`。
- 路由本来就按文件拆块；tfjs/COCO-SSD 只在开启检测时动态加载；首屏不再带 three（radar-canvas 936 kB → 22 kB）。
- 相机引擎：检测关闭时只做帧统计；模型缺失时用自研运动检测给出「运动物体」候选（深度用面积回退并标大不确定度，不进入建图）。

## 三、没有换的，以及原因

- **COCO-SSD 权重**：没有训练数据和算力，无法自研模型；自写神经网络运行时会比 tfjs 的 WebGL 后端慢，所以保留 tfjs，只在需要时加载，并用自研调度减少调用。
- **Tesseract 的字符识别**：保留；前后处理是自研的。
- **zod**：仍在 package.json，因为平台文件 `src/lib/preview-host-bridge.ts` 使用它；业务代码已不再依赖。
- **真机行为**：沙箱没有真实喇叭/麦克风/IMU，真机上的声呐精度、输出延迟、电量节省幅度需要在 X300 上复测。录音时长（0.55 s）没有自适应缩短，因为输出延迟未知。
