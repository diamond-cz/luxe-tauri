# Face 表格实现与笛卡尔热力图维护说明

本文以 Face / Face_FLT 页面中的 `fd_th_tbl` 为二维表格基准，记录数据、选中、编辑和热力图的实现；`FaceProb`、`FDSZ_RA`、`FDDR_RA` 则复用其中的轴命中规则，按单轴统计。代码入口均在 `src/views/mtk/isp6s/ImagePane/ChartMapMode.tsx`。

## `fd_th_tbl` 二维表格

| 环节 | 代码入口 | 约定 |
| --- | --- | --- |
| 源码读取 | `loadFaceBvDrTableSource`、`FaceFbtSource` | 分别解析值矩阵、BV 行轴和 DR 列轴，并保存每个单元格的 `FieldEntry`，供编辑和源码跳转使用；Face 与 Face_FLT 使用各自的路径常量 |
| 表格渲染 | `FaceBvDrTableCard`、`FaceBvDrEditableCell` | 左上角为 BV/DR 斜角单元格；表头和数据区保持固定网格；编辑态沿用 `EditableNumberTableCell` |
| 当前图片选中 | `boundsForTableAxis`、`hsDarkAreaDataCellStyle` | BV 和 DR 分别定位相邻轴点；两组索引的交集为选中数据单元格；普通模式通过背景色和字体颜色标示，轴表头只改字体颜色 |
| 预览和保存 | `previewCell`、`updateCell`、`FaceTableSaveButton` | 输入时先预览；提交时用 `FieldEntry` 定位源码 token，更新 `sourceDraftTextRef`、草稿和可编辑源；保存按钮调用统一的 `onSaveSourceDraft` |
| 源码跳转 | `jumpToCellSource` | 根据字段所在源码行、同一行内的序号和当前值定位并选中对应 token |
| 热力图状态 | `useChartTableHeatmapMode` | 以 `${faceTab}_${tableKey}` 保存开关及参数值/命中数模式；左键切换开关，开启后右键图标切换显示模式 |
| 命中统计 | `countFaceBvDrHits`、`faceBvDrHitPaths` | 仅统计 BV、DR 均有效的图片；NS 表另外要求 `NS_PROB` 有效且非零；分别用 `boundsForTableAxis` 判定行列命中，筛选结果按路径去重 |
| 热力颜色 | `faceBvDrHeatCellStyle` | 命中数先用 `log1p` 归一化，再混合 `--face-heat-low/high`；命中数单元格左键选中所有命中图片，右键跳转对应参数，加载中显示 `…`，失败显示 `-` |

`boundsForTableAxis` 先过滤无效轴值并按数值排序。恰好落在轴点上只命中该点；落在两点之间命中相邻两点；超出轴范围命中最近端点。二维表格对行、列分别执行该规则，所以一张图片最多命中四个数据单元格。新增表格时应先核对图片 EXIF 的单位与源码轴单位一致。

## 单轴表格接入

Face、Face_FLT 页面中的 `FaceProb`、`FDSZ_RA`、`FDDR_RA` 使用相同的轴边界规则，但只按首行横轴统计：

| 环节 | 现有实现 | 新表格接入方式 |
| --- | --- | --- |
| 图片数据 | `ChartMapMode.tsx` 中的 `loadImageTomlFieldsBatchShared` 批量读取图片 TOML | 把表格横轴对应的 EXIF key 加入批量读取列表 |
| 图片点 | `FaceHeatmapPoint` 保存图片路径、BV、DR 及 Face 相关轴值 | 在 `imageHeatmapPoints` 后派生 `{ path, value }` 点集 |
| 坐标命中 | `boundsForTableAxis(value, axis)` 计算相邻轴点的命中范围 | 使用 `faceAxisHeatmapData(source, points)` 得到每列的命中数和图片路径 |
| 颜色 | `faceAxisHeatCellStyle` 根据 `log1p(count)` 混合 `--face-heat-low/high` | 选中列只改变背景色和字体颜色，不添加外框阴影 |
| 网格边线 | `faceProbTableStyle` 绘制外框，`faceProbTableValueStyle`、`faceProbTableLabelStyle` 绘制单元格右边线和下边线 | 热力图样式从数据格样式继承边线，命中数模式也保持完整网格 |
| 控件 | `useChartTableHeatmapMode` 保存开关和显示模式 | 使用唯一 key，例如 `Face_faceProb`、`Face_FLT_fddrRa` |
| 交互 | 图标左键开关，图标右键切换参数值/命中数；命中数单元格左键选中图片、右键跳转参数 | 复用 `FaceProbEditableCell` 的 `heatmap*` 属性 |
| 折叠 | 三个卡片标题栏最右侧共用 `FaceAxisTableCollapseButton` | 只卸载各自的表格区域，保留标题、计算结果、保存及热力图按钮；折叠时暂停该表的命中统计 |

## 命中数模式（右键状态二）的点击契约

开启笛卡尔热力图后，右键标题栏热力图图标切换至命中数模式（`showHitCounts / showCounts`）。此时左键点击数据单元格，将该单元格的全部命中路径传入既有 `Isp6sAeVisual.onSelectHeatmapImages`：替换上一组热力图多选、按当前图片索引去重选中，并定位第一张命中图片，同时保留整组高亮。命中数为0时清空该多选，不跳转到无关图片。加载中、统计失败和没有选择回调时不触发选择；右键单元格只执行已有参数映射跳转，没有参数可跳时不再回退为图片选择。

这一契约覆盖 MainT 的 Base/Exp、HS Area、Face/Face_FLT 二维表、FaceProb/FDSZ_RA/FDDR_RA，以及 ToneMap LCE 的命中数单元格。普通参数值模式的左键编辑和图标的模式切换不变；不修改命中算法、NS统计资格、状态持久化和图片扫描。左右键均在各自处理处阻止冒泡，避免外层点击重复处理。

此前图片选择与源码跳转共用右键事件，新增跳转优先分支后，只要存在参数字段，图片选择分支就无法执行。现将左键选择独立接线，继续使用原有命中路径函数、工作区多选和图片列表高亮入口。`scripts/face-link-target.test.mjs` 执行五类单元格的实际事件处理，覆盖左右键隔离、加载/失败拦截、参数模式不选图，以及实际工作区多选/第一张定位链路；桌面交互仍需Windows产物验收。

## 接入步骤

1. 在 `FaceHeatmapPoint` 中增加图片轴值，并在批量 TOML key 列表中加入对应关键字。
2. 为表格生成 `FaceAxisHeatmapPoint[]`，无效数值直接过滤。
3. 调用 `faceAxisHeatmapData`，不要在组件内重复编写轴边界和路径去重逻辑。
4. 为表格使用稳定的热力图 key，并通过 `useChartTableHeatmapMode` 保存开关状态。
5. 单元格传入 `heatmapStyle`；命中数模式传入 `showHeatmapCount` 和 `onSelectHeatmapImages`。
6. 表格切换源码或图片目录时，依赖现有 `entries` 和 `heatmapRetry` 使旧请求失效，避免复用过期统计结果。

`FDSZ_RA` 的图片 `AE_TAG_FLT_FDSZ` 与源码 `face_sz` 轴按现有计算规则统一除以 100；Face 和 Face_FLT 的 `FDDR_RA` 分别读取各自的 FDDR key。FaceProb 读取 `FACE_PROB_KEYS` 中首个有效字段。单轴统计只要求对应的 EXIF 轴值有效；`fd_th_tbl` 的二维统计必须同时具有有效 BV 和 DR。

## Face Link Target 极值限制

详情面板 Face 页的 `FLT.Link_FACE_CWR` 与 Face_FLT 页的 `Face Link Target` 卡片均遵循**先加权、再钳制**，不在混合前限制 FLT Target：

```text
raw = FLTCwrTarget * FDSZ_RA / 1024 + NormalTarget * (1 - FDSZ_RA / 1024)
low = AE_TAG_AE_TARGET * low_bound / 1024
high = AE_TAG_AE_TARGET * high_bound / 1024
Face Link Target = limit(raw, low, high)
```

- **EXIF 链路**：`low_bound / high_bound` 分别来自图片的 `AE_TAG_FACE_LOW_BOUND / AE_TAG_FACE_HIGH_BOUND`。详情表资源 `src-tauri/resources/face_table.toml` 直接引用顶部已有的 `TOP.极值限制_low / TOP.极值限制_high`；`FaceTable.tsx` 的既有表达式求值器保留原始精度，仅最终展示四舍五入，悬浮提示同步显示带 `limit(...)` 的公式及代入值。`Cal_FLT / Cal_Gain` 自动使用钳制后结果。
- **参数链路**：AE.cpp 的标量路径 `[0][4][1].19 / [0][4][1].20` 分别提供下限/上限系数，基数仍是图片 `AE_TAG_AE_TARGET`，不是 `NormalTarget`，也不是 `[0][4][1][19] / [0][4][1][20]` 数组。`loadFaceCwrBounds` 在加载 Face_FLT 源码快照时读取两项，源码草稿变化时 `previewFaceCwrBoundsFromDraft` 用现有 token 定位更新派生范围，不写图片 TOML。
- **显示与复用**：`FaceLinkFormula.tsx` 使用 EXIF / 参数计算两行、五列“来源 → 加权值 → 边界显示 → 限制范围 → 最终值”摘要，并标明范围内/抬至下限/压至上限/数据不全；摘要统一四舍五入为整数。公式在表格上方直接显示，问号按钮通过 `FormulaHeader.tsx` 的 Fluent Popover 打开“变量、EXIF、参数计算、差值、来源”紧凑对照表；数值为一位小数，差值方向为参数计算减 EXIF，相同来源只展示一次，不同来源合并在同一来源列中区分。Face Link 除输入外还对照 raw/low/high/final；完整代入过程默认折叠，点击“展开完整推导”再显示，避免初次打开即重复展开两套来源与公式。参数 FDSZ_RA 仍列出真实轴路径。所有舍入只用于展示，不回写共享计算器或改变边界判断；标题和图片列表仍共享 `calculateFaceTargetMetrics`，不增加请求。
- **边界系数与数值跳转**：“边界显示”列位于加权值右侧，各来源行内显示原始下限/上限系数；不再在表格下重复展示独立边界行。原始系数与乘以 AE Target 后的“限制范围”分别展示。EXIF 系数只读，点击问号可查看 `AE_TAG_FACE_LOW_BOUND / AE_TAG_FACE_HIGH_BOUND` 及一位小数值；参数系数数值本身为 Fluent Link 按钮，AE.cpp 下限 `[0][4][1].19`、上限 `[0][4][1].20` 路径放在来源对照表和按钮无障碍名称中。`jumpToFaceCwrBoundSource` 复用既有 `onSourceJump → ImagePane.handleSourceJump → param_map` 路由，传入精确 path、当前源码 token、行号及同一行 ordinal，定位并选中对应参数，避免相同数值/同一行多个参数误选。参数值非有限、字段缺失、行号无效或没有跳转能力时禁用链接；零值有效。不打开浏览器、不新增 IPC 或自定义观察器，也不改写/保存参数。
- **派生 Target 公式摘要**：`DerivedTargetFormula.tsx` 的 FLT/FBT 均使用“来源、CWV、FLT_TH/FBT_TH、FDY、最终值”五列；Normal 使用“来源、MainT + HS、NS_Prob、NS_Target、最终值”五列。原悬浮说明位置直接显示计算公式，旁边问号按钮打开来源对照表与详细代入过程；移除行及数值的悬浮预览。CWV 标明实际命中的 EXIF key，参数行 CWV/FDY 仍来自 EXIF，只有阈值来自当前 AE.cpp 草稿推导。Normal 的 EXIF 与参数两侧同时保留 BT/MT/DT 六个明细和 HS_Tar/HS_Wt 汇总，按变量名匹配，参数来源保留真实表路径和计算表达式；具体契约见下节。结果直接消费共享计算器；摘要整数、对照/详情一位小数，舍入不参与计算。沿用折叠状态，折叠时卸载摘要与弹层。
- **字体与公式样式**：摘要继续使用 `--font-family-formula` 的 CJK 等宽字体栈。常显公式单独使用 `--font-family-formula-expression`（Cascadia Code、Consolas、Sarasa Mono SC、monospace），字号 13px、字重 500、正文级文字对比度；取消原顶部横线和公式行间横线，仅保留公式组底部分隔。来源弹层采用 Fluent/Segoe UI 正文无衬线字体、13px 数值及 tabular-nums，常规字重、浅色主题表头、细行线，来源次级显示；不继承卡片的高字重或中文衬线回退。全局应用正文和图片表格不受影响，没有字体下载。
- **Back Scene 与视口约束**：Back Scene Target 使用“来源、FBT_Target、FaceProb、Normal_Target、最终值”两行摘要，直接消费 raw EXIF/参数混合结果，不引入 Face Link 钳制。共用 Popover 使用 fixed 定位、窗口边界、16px 留白、自动翻转及可覆盖锚点的位移；`autoSize: "height"` 根据真实可用空间写入高度约束，不仅按总窗口高度限制。Surface 为纵向 flex，标题和关闭按钮固定，正文 `min-height: 0`、内部 overflow-auto，上限为 `min(60dvh, 520px)`；窄窗口表格横向滚动、纵向表头 sticky。关闭按钮是弹层首个可聚焦控件，避免默认焦点落在底部详情按钮。关闭/Escape/焦点约束、定位和监听器清理由 Fluent 提供，不增加自定义全局监听器。
- **异常边界**：缺少/非有限的基数、系数或加权输入时对应最终值显示 `-`，不能拿另一条链路的边界或未钳制值冒充成功；零边界有效，颠倒上下限沿用现有 `limitNumber / limit` 的排序语义。Face 页的 FBT `Back Scene Target` 不新增本次 FLT 限制。
- **验证**：`scripts/face-link-target.test.mjs` 执行实际 TOML 公式、Face 表求值器、卡片/列表计算器、源码边界加载与草稿映射，并执行真实公式栏 JSX 的渲染逻辑；由 `npm run sync:test` 接入既有 Windows CI。Rust schema 用例仅验证资源契约，编译/行为测试由 CI 执行。本次未通过本地 Tauri 编译验收真实桌面显示。

## Normal Target 的 HS 数据与图片列表联动

Face / Face_FLT 页的 Normal Target 使用 `readNormalTargetFormulaSource` 读取 EXIF，使用 `calculateParameterNormalTargetFormula` 计算参数结果；卡片和 `loadFaceLinkTargetCalculator` 共用这两个入口。

| 变量 | EXIF 来源 | 参数计算来源 |
| --- | --- | --- |
| `HS_BT_Tar` | `AE_TAG_HSV6_BT_TARGET` | HS Bright Area：BV 轴 `[0][3][1][25]`、EVD 轴 `[0][3][1][27]`、矩阵 `[0][3][1][28]` 双线性插值为 THD；`CWV × THD / AE_TAG_HSV6_BT_Final_Y` |
| `HS_MT_Tar` | `AE_TAG_HSV6_MT_TARGET` | HS Middle Area：BV 轴 `[0][3][1][33]`、CORR_B2M 轴 `[0][3][1][35]`、矩阵 `[0][3][1][36]` 双线性插值为 THD；`CWV × THD / AE_TAG_HSV6_MT_Final_Y` |
| `HS_DT_Tar` | `AE_TAG_HSV6_DT_TARGET` | HS Dark Area：BV 轴 `[0][3][1][37]`、B2D 轴 `[0][3][1][38]`、矩阵 `[0][3][1][39]` 双线性插值为 THD；`CWV × THD / AE_TAG_HSV6_DT_Final_Y` |
| `HS_BT_Wt / HS_MT_Wt / HS_DT_Wt` | `AE_TAG_HSV6_BT_WET / AE_TAG_HSV6_MT_WET / AE_TAG_HSV6_DT_WET` | HS Weight 的 BV/B2D/Mid 三线性插值；轴路径 `[0][3][1][40..42]`、值路径 `[0][3][1][43]`，通道顺序为 MainT、DT、MT、BT，须按通道名映射 |
| `HS_Tar` | `AE_TAG_HSV6_HS_TARGET` | 三个区域 Target 按各自插值权重求加权平均 |
| `HS_Wt` | `AE_TAG_HSV6_HS_WET` | 三个区域插值权重之和 |

以上 HS 的 CWV 来自图片 `AE_TAG_CWV`，缺少时沿用 MainT 的 CWV 来源；Area 轴沿用 HS 页的 `HS_BRIGHT_EVD_KEY / HS_MIDDLE_CORR_B2M_KEY / AE_TAG_DRV6_B2D`，不能替换为数值相似的其他 EXIF 字段。

```text
HS_Wt = HS_BT_Wt + HS_MT_Wt + HS_DT_Wt
HS_Tar = (HS_BT_Tar × HS_BT_Wt + HS_MT_Tar × HS_MT_Wt + HS_DT_Tar × HS_DT_Wt) / HS_Wt
Cal_mt+hs_tar = (MainT_Tar × MainT_Wt + HS_Tar × HS_Wt) / (MainT_Wt + HS_Wt)
Cal_final_tar = Cal_mt+hs_tar × (1024 − NS_Prob) / 1024 + NS_Target × NS_Prob / 1024
```

- **EXIF 与参数隔离**：EXIF 优先消费有效的两个 HS 汇总标签，六个原始明细用于对照，不与汇总重复计权。旧图片缺少有效汇总标签时，对缺失项由三项原始明细计算回退值，来源列显示推导公式。参数侧始终由当前 HS 表插值计算汇总，不能拿 EXIF 汇总替代修改后的参数结果。
- **草稿预览**：`previewHsWeightSourceFromDraft / previewHsAreaSourceFromDraft` 按已有 `FieldEntry` 的 path、line、index 和行内 token 次序覆盖数字，生成不可变派生快照。投影同时覆盖轴和值，无改动时复用原快照，变化映射只在本次调用中存在；HS 与 Normal 使用相同投影。结构变动后以现有草稿解析/重载链路更新坐标，不把旧坐标当作新源码坐标。
- **编辑期间保持挂载**：HS 的来源身份使用原参数文件 `sourceBasePath + HS`，临时文件路径或草稿版本更新时继续投影已有快照，后台重解析完成再替换字段数据。切换原文件会失效旧身份；原加载effect的取消机制仍隔离过期结果。已有Weight快照时不插入loading占位，避免编辑期间纵向布局跳动。BV分组key只使用稳定的行索引，不含可编辑数值；Weight布局观察器只随列数变化重建，普通数值预览由既有观察器响应尺寸变化，不反复解绑/注册。
- **HS Weight 保存**：标题右侧通过 `FaceTableSaveButton` 复用当前AE.cpp草稿保存入口，位于源码跳转和折叠按钮之前。`hsWeightHasUnsavedChanges` 对比BV/B2D/Mid轴与四通道权重的当前预览值、已提交草稿及已保存快照；合法聚焦预览即可启用按钮，点击时先失焦提交，再保存最新源码草稿。未修改/保存中禁用，修改显示星号，失败保留修改并支持重试，成功更新保存快照后恢复禁用。本卡片的修改标记只检查Weight字段，保存动作沿用整份源码草稿的边界，也会保存该文件其他已提交修改。
- **NS 编辑与保存**：NS同样使用 `sourceBasePath + NS` 作为逻辑来源，Probability、NorT、BT、DT在临时稿重解析时保留输入控件；已有数据时不插入loading占位。同卡片只保留一个当前单元格预览，后台快照到达时重新应用未提交值，提交/恢复原值后清除，原文件切换导致source失效时释放，避免连续编辑被前一次解析覆盖。Probability、NorT、BT标题增加共享保存按钮，`nsTableHasUnsavedChanges` 检查两条概率曲线、BV/THD表、EVD区间/百分比定义、平坦区参数及概率曲线的预览与草稿。支持聚焦时直接保存、失败重试和成功后清除修改标记；NorT与BT共用BV/flat_thd，改动共享字段会使两个相关卡片都显示修改。NorT的两个EVD百分比定义必须全部保留在source.fields，支持同一行第二个token定位。保存仍写整份当前源码草稿，实际写入/编码处理复用原入口。
- **图片列表**：批量字段请求包含两个 HS 汇总 EXIF 标签。`Normal_old` 是 EXIF 链路最终结果，`Normal_new` 是当前已应用参数的最终结果；通过既有 `normalCwr → imageTableFormulaAlias` 提供给列显示、差值及用户公式。修改草稿后，卡片预览随草稿更新；列表依照现有“应用当前 / 应用全部”提交的参数快照更新，保留单张应用及撤销范围。MainT 的 CWV 和 HS 的 CWV 回退规则与卡片一致，不借用 Face 专用 CWV 回退链路。
- **数值边界**：中间插值及加权不调用三位小数输入格式化，也不将缺失项变为零。非零权重对应的 Target 缺失、权重缺失或为负、NS 概率不在 `0..1024` 时结果不可用；零权重支路允许 Target 缺失。`NS_Prob=0/1024` 时只要求实际参与的支路有效。HS 页的 Target 汇总也复用同一加权检查。
- **自动化验证**：`scripts/face-link-target.test.mjs` 新增10项用例，执行实际 HS 路径加载、双线性/三线性插值、三个 Area 与 Weight 草稿修改、轴修改、同一行多 token、汇总 EXIF 优先/缺失兼容、零/缺失边界、列表两个别名以及公式来源 JSX；不需要 Tauri 运行时。用例中的 MainT/NS/Face 加载为隔离夹具，不代表真实图片或桌面应用已验收。

本轮在 Node `22.16.0` 执行 `sync:test` 对应六个脚本共131项通过，`npm run typecheck` 通过；未进行 Tauri 桌面切图、应用当前/全部或撤销的人工验收。建议在 Windows 产物中依次编辑三张 Area 表和 HS Weight，确认卡片的六个明细及聚合随之变化，再应用并核对 `Normal_new` 与卡片参数行最终值的整数显示一致，`Normal_old` 保持不变。

### Back Scene / Face Link 的 Normal 来源接线

两个下游卡片及图片列表的 `loadFaceLinkTargetCalculator` 必须消费 Normal Target 卡片的对应链路最终值。`FaceTargetInputs` 强制区分 `exifNormalTarget` 和 `parameterNormalTarget`，不再接受两条链路共享的单个 `normalTarget`：

| 下游链路 | Normal_Target 来源 | 来源对照表标记 |
| --- | --- | --- |
| EXIF | `calculateNormalTargetFormula(...).finalTarget`，即 Normal 卡片 EXIF 行的 `Cal_final_tar` | `Normal Target · Cal_final_tar(EXIF)` |
| 参数计算 | `calculateParameterNormalTargetFormula(...).finalTarget`，即 Normal 卡片参数行的 `Cal_final_tar` | `Normal Target · Cal_final_tar(AE.cpp)` |

```text
BackScene_EXIF = (FBT_EXIF × FaceProb_EXIF + Normal_EXIF × (1024 − FaceProb_EXIF)) / 1024
BackScene_new  = (FBT_new  × FaceProb_new  + Normal_new  × (1024 − FaceProb_new))  / 1024
FaceLink_raw_EXIF = (FLT_EXIF × FDSZ_RA_EXIF + Normal_EXIF × (1024 − FDSZ_RA_EXIF)) / 1024
FaceLink_raw_new  = (FLT_new  × FDSZ_RA_new  + Normal_new  × (1024 − FDSZ_RA_new))  / 1024
FaceLink_final = limit(FaceLink_raw, low, high)  // 每条链路使用自己的边界
```

此前下游两侧都直接读取 `AE_TAG_FACE_20_NORMAL_TARGET`，导致 Normal 卡片显示814/809，但 Back Scene 两行仍同为814；列表也未将新的 Normal 结果继续送入 BackTar/FLinkTar。现由 FaceTabContent 先计算 Normal 两个最终值，再传给共享计算器、摘要行、公式代入及来源对照。这里不再用该记录标量替代 Normal 卡片最终值；参数 Normal 缺失时不借用 EXIF 结果，EXIF Normal 无法推导时也不借用参数结果。计算沿用未舍入的浮点值，卡片及列表展示时才取整。

图片列表应用当前/全部时，同一参数快照的 `Normal_new` 会继续影响 `BackTar_new / FLinkTar_new` 及既有差值/AEGain。只改参数不会改变三个 `_old` 结果；Face Link 若已被上下限钳制，raw 可变化而 final 保持边界值，这是正常行为。该接线不改变权重来源开关、上下限来源或应用范围。

本次新增5项回归，执行真实 `FaceTabContent` 的 Normal 声明及共享计算器调用，再验证实际 JSX 传参、Back Scene 摘要/代入和 Face Link 来源/钳制；另验证缺失值隔离、HS 编辑经目录计算器传递至三个 `_new` 别名。Node `22.16.0` 专项44项、`sync:test` 对应六脚本136项及 `npm run typecheck` 通过。未运行本地 Tauri 编译，真实桌面切图、应用/撤销和截图仍待 Windows 产物验收。

## 性能约束

- 图片 TOML 必须批量读取，不能在每个单元格内发起 IPC。
- 统计结果只在热力图开启时计算，并使用 `useMemo` 或等价的稳定输入缓存。
- 只保存图片路径集合，不保存图片对象、缩略图或完整 TOML，筛选完成后沿用现有图片列表清理流程。
