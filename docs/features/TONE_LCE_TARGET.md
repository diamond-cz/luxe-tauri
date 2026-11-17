# ToneMap LCE Target 计算与权重

适用于 `src/views/mtk/isp6s/ImagePane/ToneChartMapMode.tsx` 的 LCE 图表和 Target 卡片。计算集中在同目录 `toneLceTarget.ts`，权重图由 `ToneLceTargetWeight.tsx` 展示；都消费当前图片已经加载的 TOML，不新增图片读取 IPC、图片解码或缓存。图表分割比例经现有 visual 状态保存。

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
- Cal 位于外层 Target 卡片标题下的第二栏，按概率、混合目标、最终目标顺序显示公式和代入值；分别对照 `SW_LCE_LumaFlatProb`、`SW_LCE_LumaFlatTarget`、`SW_LCE_FinalTarget` 的记录值，差值方向为“重算 − EXIF”。以 embedded 模式复用原 `ToneLceCalCard`；其下依次是 Ratio、LVTarget 和 Prob 内部参数卡片。原内部 Target 已改名 LVTarget，Cal 不再嵌入 LVTarget 参数卡片。显示最多两位小数，不回写计算输入。
- “LV 参数混合”只替换 `LVTarget` 为当前 Tone.cpp 草稿的表格插值，其他输入来自 EXIF，与重算侧共用后续混合逻辑。
- 缺少/非有限输入不以另一字段填补，显示 `-`；概率仅接受 `0..1000`，零值合法。关键字支持现有小写别名。

参考图中的 `LumaTarget=2282`、`FlatTarget=523`、`LumaProb=1000`、`FlatProb=253` 得到重算概率 `253` 和混合目标 `1836.973`，而记录混合目标为 `1774`。这项剩余差异不能归因于显示舍入；界面保留对照，不擅自猜测设备公式、增加限制或覆盖记录值。

## LCE Target Weight

LCE 标签页首行左右分别为 `LCE Curve` 与 `LCE Target Weight`，独立于下方 Target 卡片，使用可记忆比例的横向分割器。当前卡片依次为标题栏40px、可折叠第二栏144px、图表区，原底栏表格已移到标题下第二栏。两张卡片统一使用项目主题标题、语义背景/边框/轻阴影。曲线标题仅保留 LCE Curve，实际来源保留在节点/单元格提示中。下方 Target 包含 Ratio、Target 参数表及 Cal，原编辑/保存/热力图/源码跳转继续保留。

`ToneLceChartHeader.tsx` 在各自标题右侧提供 Fluent 上/下箭头按钮，分别显示/隐藏本卡片第二栏。默认展开，折叠只隐藏公式与数据；不改变左右分割比例或另一张卡片的展开状态。单侧折叠时共用外框仍保持对齐，两侧都折叠时整体高度随之缩减。按钮包含五语言 aria-label/title、aria-expanded 和指向唯一公式栏的 aria-controls，不新增持久化字段。

第二栏仅包含数据表，2026-11-16 按用户要求移除 Curve 的 `Gain = O − P` 和 Weight 的 Target 概率混合说明行及对应分隔线；保留 Gain 数据、权重表、图表、提示和标题栏折叠功能，Target 卡片中的 Cal 计算说明仍保留。表格参考 Back Scene Target 公式栏：仅横向细分隔线、数值加粗，移除纵向网格和交替底色。行列标题与右侧目标关键字使用项目 `--fontFamilyBase` 无衬线字体、600字重及 `--colorNeutralForeground2`，提高可辨识度；数值保留原等宽字体。截图已清理，当前样式以实现和本文说明为准。

公式表最后一行取消底线，保留公式区唯一外边界作为与图体的分隔，避免重复横线。展开/折叠行为保留自动化验收记录，过渡版本截图已清理。

图体显式 `width/max-width: 100%`、`min-height: 0`，分割器内覆盖为 `aspect-ratio: auto` 并由公共图表行控制高度；SVG 使用 `xMidYMid meet` 在图体内等比缩放。不能同时设置 `min-height: 240px` 和 auto 宽度：浏览器会通过宽高比产生 384px 的宽度，窄卡片中越界覆盖相邻图。卡片和 SVG 增加溢出边界作为保护；第二栏表格填满可用宽度，通过自适应字号和必要换行容纳数据，不出现滚动条。

蓝色 LV、绿色 Luma、红色 Flat 使用 Fluent 语义令牌，以 SVG 环形图、外侧引线和带框的百分比标签表示。图形按可用列宽缩放，SVG viewBox 为 420×230，同侧标签保持至少 24 个逻辑单位间距，位置限制在画布内；零权重保留 0.0% 标签，不绘制虚构扇区。标题下第二栏包含四行四列表格，配合左侧 EXIF 表头/P/O/Gain 四行表；从左到右为“概率关键字 / 概率值 / 目标值 / 目标关键字”，固定配对如下：

```text
SW_LCE_LVProb        LVProb        LVTarget        SW_LCE_LVTarget
SW_LCE_LumaFlatProb  LumaFlatProb  LumaFlatTarget  SW_LCE_LumaFlatTarget
SW_LCE_LumaProb      LumaProb      LumaTarget      SW_LCE_LumaTarget
SW_LCE_FlatProb      FlatProb      FlatTarget      SW_LCE_FlatTarget
```

这里的数值全部取当前图片的 EXIF 记录值，尤其 `SW_LCE_LumaFlatTarget` 使用 `recordedLumaFlatTarget`，不显示 Cal 的重算混合结果或 Tone.cpp 参数插值。缺失值显示 `-`，0 保留为 0。权重表使用 table-layout:auto，无固定列宽比例、无最小表宽，第一列左对齐，中间两列居中，最后一列右对齐；曲线表保留九列等宽，但移除原380px最小宽度。

两张公式栏文字保持11px，不再按列宽缩小到6px；单元格左右内边距仍使用 `clamp(1px, 0.6cqw, 6px)`。公式栏最小高度144px，文字变窄时允许自然换行和行高增长，避免挤压或裁掉标题；数据仍无横向滚动条。行列标题无衬线600字重、数值等宽700字重，字体职责分开。验收同时检查 scrollWidth/clientWidth 和实际文字边界，不能仅隐藏溢出掩盖裁切。

第二栏布局在实际浏览器中覆盖两主题、DPR 1/1.5、25%/50%/75% 分割比例、420/560/720/900/1100/1320px 容器宽度，共72个场景。检查所有单元格文字 Range 完整落在边界内、表格无横纵溢出、单横线/加粗样式，以及两卡独立折叠、键盘切换、恢复后节点 Tooltip 继续可用。先前底栏版本截图已清理，验证过程见经验账本。

LCE Curve 节点统一使用 `HoverTooltip` 的 SVG 锚点模式。将 P/O 的真实字段名和值及 Gain (O−P) 合并为一个三行提示，共用项目主题、圆角、阴影、箭头与视口内定位；移除节点原生 `<title>` 和图内自绘文字框，保留节点高亮及定位虚线。悬停/键盘聚焦均显示，离开/失焦关闭，切换标签卸载时清理 Portal 与监听器。节点本身保留 aria-label；边界线和表格的来源提示仍按原功能提供。

为了对照参考工具，图形使用记录的 `SW_LCE_LumaFlatProb`，而不是静默替换成上面的重算概率。设 `v = LVProb / 1000`，`p = 记录的 LumaFlatProb / 1000`：

```text
LV   = v
Flat = (1 − v) × p
Luma = (1 − v) × (1 − p)
```

三项合计为 100%，表示混合系数占比，而非目标数值乘以权重后的贡献占比。参考图 `LVProb=715`、`LumaFlatProb=253` 对应 `71.5% / 21.3% / 7.2%`，参考工具按整数百分比显示为 `72% / 21% / 7%`。LumaProb 与 FlatProb 用于解释记录概率来源，不能在绘图时再把记录的 LumaFlatProb 乘一次 FlatProb。

记录概率缺失或超出 `0..1000` 时显示中性圆环、`-` 和本地化提示，不猜测或强行归一化；100% 单一分量和 0% 分量均有效。百分比标签和各扇区均使用公共 `HoverTooltip` 的 SVG 模式，合并“名称+百分比”和权重公式为单一项目风格浮层，移除原生 SVG title；支持鼠标悬停与键盘聚焦，SVG及触发节点保留可访问描述。历史 Tooltip 截图已清理，相关行为由组件测试和浏览器验证记录覆盖。

## 验证

2026-11-15 布局调整：ToneMap 的 LTM/LCE/GMA/DCE/CA-LTM 与 AE Basic 的 MainT/HS 等共用 `ImagePane/chartMapTabStyles.ts`，激活项使用品牌色实心背景、非激活项使用中性背景和边框。LCE Curve 与 LCE Target Weight 从 Target 内移到 LCE 标签页首行，通过 `ToneLceCharts.tsx` 横向 PanelGroup 和公共 ResizeHandle 调整左右比例；Target 下的 Ratio、Target 参数表与 Cal 保持原有编辑/热力图/源码跳转逻辑。

左右默认 50/50，各自最小 25%，最大 75%。比例保存为 `isp6s_ae_visual.tone_lce_curve_ratio`，经既有 Zustand visual 状态和 200ms 串行持久化入口写入 TOML，切页和应用重启后恢复；旧配置缺字段默认 50，前端对非有限数值回退 50、超界值限制到 25..75。此设置独立于工作区列宽、图片详情分割器及 AE Basic 布局，不写 localStorage。

图表总高度计算为 `42px + var(--tone-lce-formula-height) + var(--tone-lce-plot-height)`；图体预算使用 `clamp(220px, 32vh, 340px)`，只随窗口可用高度变化，不随左右列宽或分割比例改变。至少一栏展开时保留144px公式预算，两栏都折叠时通过CSS :has切换为0，整体缩短144px；极窄时公式文字自然换行，优先保证完整可读。分割器只改变横向可用空间，透明抓取区域、键盘调整和TOML比例记忆保留。

Curve 使用一个随卸载 disconnect 的 ResizeObserver，读取实际SVG宽高；仅宽高变化时更新视口，将 viewBox 对应到实际绘图区，按像素重排横轴/纵轴与节点，避免等比缩小整张图导致坐标字太小。横向变窄时减少横轴刻度密度，数值/来源/Tooltip不变；Weight 保持圆形SVG等比显示，不将环形拉成椭圆。横向适配与Target层级的四张组件截图已由用户删除，相关浏览器验证结果保留在经验账本中。

浏览器验证使用实际 ToneChartMapMode、两图组件、PanelGroup、Fluent 主题与项目 CSS，覆盖深浅主题共 22 场景：鼠标拖动、键盘调整、标签切换、组件重挂载、模拟状态启动恢复，以及 1100/900/720/560/420px 宽度变化。断言两卡/底表对齐、SVG 不越界、分割比例保留；初始分割布局截图已清理。这是浏览器组件验收，未执行 Rust/Tauri 编译或真实应用重启；Rust TOML 默认值与往返测试留给 CI。

新增曲线由 `ToneLceCurve.tsx` 与 `toneLceCurveModel.ts` 实现：对 8 对实际 P/O 坐标连线、0..3700 固定坐标、O=P 基准线、人脸上下界的 `log10×1024` 转换、节点悬浮/聚焦和 P/O/Gain 表格。图例位于 SVG 绘图区左上角、三项纵向排列，O 在纵轴上端，P 在横轴右端；SVG 随等宽图表区伸展，不设旧的 330px 最大高度。优先显示软件 GCEO 输出（按参考工具去除 `%10000` 打包信息），没有有效 GCEO 才明确回退到 SW_LCE_O；缺失/逆序节点不跨段连接。普通 LCE 详情页的小图不改变。完整 REA 清单、字节码观察、字段选择差异与未实现模拟结果边界见 [ToneTool 曲线分析](../engineering/TONE_TOOL_CURVE_ANALYSIS.md)。

`scripts/tone-lce-target.test.mjs` 直接执行实际 TypeScript 计算器和 JSX，覆盖原始字段选择、上下游依赖、两处归一化、记录/重算隔离、缺失/零值/小写字段、概率合法性、权重总和/端点、环形图图例、曲线坐标/Gain/边界变换/GCEO 来源/缺口与五语言插值。测试已加入 `npm run sync:test`，由现有 Windows CI 执行。

本地按规则只运行类型检查及 Node 测试，不编译 Tauri/Rust；Windows 实际布局、深浅主题、切图与参数编辑联动需使用已有应用或 CI 产物验收。逻辑测试不替代桌面截图验收。

2026-11-14 补充浏览器组件布局验证：使用真实组件 SSR、项目 globals.css/Tailwind 和 Fluent 深浅主题 tokens，Playwright/Chromium 测量 1200→900→720→560→420→900 的连续容器宽度变化，DPR 1/1.5、两主题共 24 场景通过。断言卡片/图体/SVG 宽度不越界、不跨卡重叠、底栏高度对齐/贴底/零 padding/直角，并检查底表不产生纵向截断。该轮测量 JSON 和全部界面截图已于2026-11-15清理，文字验证记录保留；当前不再保留证据PNG。这是隔离组件的真实浏览器布局验证，未启动 Tauri，不等同于整应用分割器拖动验收。
