# ToneMap LCE Target 计算与权重

适用于 `src/views/mtk/isp6s/ImagePane/ToneChartMapMode.tsx` 的 Target 卡片。计算集中在同目录 `toneLceTarget.ts`，权重图由 `ToneLceTargetWeight.tsx` 展示；都消费当前图片已经加载的 TOML，不新增 IPC、图片解码、持久化设置或缓存。

## 计算链路

原始输入与 EXIF 混合中间值必须分开读取：

| 输入 | EXIF 关键字 |
| --- | --- |
| LumaProb | `SW_LCE_LumaProb` |
| FlatProb | `SW_LCE_FlatProb` |
| LumaTarget | `SW_LCE_LumaTarget` |
| FlatTarget | `SW_LCE_FlatTarget` |
| LVTarget | `SW_LCE_LVTarget` |
| LVProb | `SW_LCE_LVProb` |

```text
LumaFlatProb = round(LumaProb × FlatProb / 1000)
LumaFlatTarget = (FlatTarget × LumaFlatProb + LumaTarget × (1000 − LumaFlatProb)) / 1000
FinalTarget = round((LVTarget × LVProb + LumaFlatTarget × (1000 − LVProb)) / 1000)
```

- 每一级重算值传给下一级，不以 EXIF 的已混合结果作为原始输入，也不在中间目标阶段做显示舍入。保留原页面概率和最终值的 `Math.round` 约定；没有设备算法源码证据时，不声称与固件的整数截断、后续限制或平滑完全一致。
- Cal 位于下方 Target 参数卡片的第二栏（标题下、参数网格前的公式栏），按概率、混合目标、最终目标顺序显示公式和代入值；分别对照 `SW_LCE_LumaFlatProb`、`SW_LCE_LumaFlatTarget`、`SW_LCE_FinalTarget` 的记录值，差值方向为“重算 − EXIF”。以 embedded 模式复用原 `ToneLceCalCard`，不再作为 Ratio 右侧独立卡片。显示最多两位小数，不回写计算输入。
- “LV 参数混合”只替换 `LVTarget` 为当前 Tone.cpp 草稿的表格插值，其他输入来自 EXIF，与重算侧共用后续混合逻辑。
- 缺少/非有限输入不以另一字段填补，显示 `-`；概率仅接受 `0..1000`，零值合法。关键字支持现有小写别名。

参考图中的 `LumaTarget=2282`、`FlatTarget=523`、`LumaProb=1000`、`FlatProb=253` 得到重算概率 `253` 和混合目标 `1836.973`，而记录混合目标为 `1774`。这项剩余差异不能归因于显示舍入；界面保留对照，不擅自猜测设备公式、增加限制或覆盖记录值。

## LCE Target Weight

外层 Target 区域首行左右分别为 `LCE Curve` 与 `LCE Target Weight`，采用等宽双列 CSS Grid。两张卡片共用 `.tone-lce-chart-card/header/body/footer`，标题栏 40px、图表区按相同宽高比伸展、底部栏 120px；不再读取旧分隔条比例，以免左右不对称。卡片统一使用项目的浅紫主题标题、语义背景/边框/轻阴影，仅上方圆角、底部直角，底栏零 padding、表格铺满底栏。曲线标题仅保留 LCE Curve，实际来源保留在节点/单元格提示中。Ratio 参数表在两张图下方独立全宽一栏，原编辑/保存/热力图/源码跳转继续保留；下方 Target 参数卡片的公式栏仍维护 Cal 内容。

图体显式 `width/max-width: 100%`、`min-height: 0`、`aspect-ratio: 1.6`，行高使用 auto；SVG 使用 `xMidYMid meet` 在图体内等比缩放。不能同时设置 `min-height: 240px` 和 auto 宽度：浏览器会通过宽高比产生 384px 的宽度，窄卡片中越界覆盖相邻图。卡片和 SVG 增加溢出边界作为保护，底栏横向滚动限定在表格区域，不撑宽图表。

蓝色 LV、绿色 Luma、红色 Flat 使用 Fluent 语义令牌，以 SVG 环形图、外侧引线和带框的百分比标签表示。图形按可用列宽缩放，SVG viewBox 为 420×230，同侧标签保持至少 24 个逻辑单位间距，位置限制在画布内；零权重保留 0.0% 标签，不绘制虚构扇区。图下使用四行“关键字 / 数值”表格，与左侧 EXIF 表头/P/O/Gain 四行表共用行高；从上到下固定如下，来源说明保留在图标题提示中：

```text
SW_LCE_LVProb
SW_LCE_LumaFlatProb
SW_LCE_LumaProb
SW_LCE_FlatProb
```

为了对照参考工具，图形使用记录的 `SW_LCE_LumaFlatProb`，而不是静默替换成上面的重算概率。设 `v = LVProb / 1000`，`p = 记录的 LumaFlatProb / 1000`：

```text
LV   = v
Flat = (1 − v) × p
Luma = (1 − v) × (1 − p)
```

三项合计为 100%，表示混合系数占比，而非目标数值乘以权重后的贡献占比。参考图 `LVProb=715`、`LumaFlatProb=253` 对应 `71.5% / 21.3% / 7.2%`，参考工具按整数百分比显示为 `72% / 21% / 7%`。LumaProb 与 FlatProb 用于解释记录概率来源，不能在绘图时再把记录的 LumaFlatProb 乘一次 FlatProb。

记录概率缺失或超出 `0..1000` 时显示中性圆环、`-` 和本地化提示，不猜测或强行归一化；100% 单一分量和 0% 分量均有效。SVG 提供描述和分段 title，颜色以外也能通过文字读取权重。

## 验证

新增曲线由 `ToneLceCurve.tsx` 与 `toneLceCurveModel.ts` 实现：对 8 对实际 P/O 坐标连线、0..3700 固定坐标、O=P 基准线、人脸上下界的 `log10×1024` 转换、节点悬浮/聚焦和 P/O/Gain 表格。图例位于 SVG 绘图区左上角、三项纵向排列，O 在纵轴上端，P 在横轴右端；SVG 随等宽图表区伸展，不设旧的 330px 最大高度。优先显示软件 GCEO 输出（按参考工具去除 `%10000` 打包信息），没有有效 GCEO 才明确回退到 SW_LCE_O；缺失/逆序节点不跨段连接。普通 LCE 详情页的小图不改变。完整 REA 清单、字节码观察、字段选择差异与未实现模拟结果边界见 [ToneTool 曲线分析](../engineering/TONE_TOOL_CURVE_ANALYSIS.md)。

`scripts/tone-lce-target.test.mjs` 直接执行实际 TypeScript 计算器和 JSX，覆盖原始字段选择、上下游依赖、两处归一化、记录/重算隔离、缺失/零值/小写字段、概率合法性、权重总和/端点、环形图图例、曲线坐标/Gain/边界变换/GCEO 来源/缺口与五语言插值。测试已加入 `npm run sync:test`，由现有 Windows CI 执行。

本地按规则只运行类型检查及 Node 测试，不编译 Tauri/Rust；Windows 实际布局、深浅主题、切图与参数编辑联动需使用已有应用或 CI 产物验收。逻辑测试不替代桌面截图验收。

2026-11-14 补充浏览器组件布局验证：使用真实组件 SSR、项目 globals.css/Tailwind 和 Fluent 深浅主题 tokens，Playwright/Chromium 测量 1200→900→720→560→420→900 的连续容器宽度变化，DPR 1/1.5、两主题共 24 场景通过。断言卡片/图体/SVG 宽度不越界、不跨卡重叠、底栏高度对齐/贴底/零 padding/直角，并检查底表不产生纵向截断。详细测量 JSON 为本地 `docs/engineering/evidence/TONE_LCE_RESIZE_VALIDATION.json`，通过 `.gitignore` 排除；仓库保留 [浅色截图](../engineering/evidence/TONE_LCE_RESIZE_LIGHT.png) / [深色截图](../engineering/evidence/TONE_LCE_RESIZE_DARK.png) 供界面审查。这是隔离组件的真实浏览器布局验证，未启动 Tauri，不等同于整应用分割器拖动验收。
