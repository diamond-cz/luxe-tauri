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
- Cal 按概率、混合目标、最终目标顺序显示公式和代入值；分别对照 `SW_LCE_LumaFlatProb`、`SW_LCE_LumaFlatTarget`、`SW_LCE_FinalTarget` 的记录值，差值方向为“重算 − EXIF”。显示最多两位小数，不回写计算输入。
- “LV 参数混合”只替换 `LVTarget` 为当前 Tone.cpp 草稿的表格插值，其他输入来自 EXIF，与重算侧共用后续混合逻辑。
- 缺少/非有限输入不以另一字段填补，显示 `-`；概率仅接受 `0..1000`，零值合法。关键字支持现有小写别名。

参考图中的 `LumaTarget=2282`、`FlatTarget=523`、`LumaProb=1000`、`FlatProb=253` 得到重算概率 `253` 和混合目标 `1836.973`，而记录混合目标为 `1774`。这项剩余差异不能归因于显示舍入；界面保留对照，不擅自猜测设备公式、增加限制或覆盖记录值。

## LCE Target Weight

图放在 Target 卡片内部、Target 参数网格下方。蓝色 LV、绿色 Luma、红色 Flat 使用 Fluent 语义令牌，以 SVG 环形图和百分比图例表示；窄布局自动换行。图旁显示以下四项 EXIF 原始记录：

```text
SW_LCE_LumaProb
SW_LCE_FlatProb
SW_LCE_LumaFlatProb
SW_LCE_LVProb
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

`scripts/tone-lce-target.test.mjs` 直接执行实际 TypeScript 计算器和 JSX，覆盖原始字段选择、上下游依赖、两处归一化、记录/重算隔离、缺失/零值/小写字段、概率合法性、权重总和/端点、环形图图例及五语言插值。测试已加入 `npm run sync:test`，由现有 Windows CI 执行。

本地按规则只运行类型检查及 Node 测试，不编译 Tauri/Rust；Windows 实际布局、深浅主题、切图与参数编辑联动需使用已有应用或 CI 产物验收。逻辑测试不替代桌面截图验收。
