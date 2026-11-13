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
| 热力颜色 | `faceBvDrHeatCellStyle` | 命中数先用 `log1p` 归一化，再混合 `--face-heat-low/high`；命中数单元格右键筛选图片，加载中显示 `…`，失败显示 `-` |

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
| 交互 | 左键开关，右键切换参数值/命中数；命中数单元格右键筛选图片 | 复用 `FaceProbEditableCell` 的 `heatmap*` 属性 |
| 折叠 | 三个卡片标题栏最右侧共用 `FaceAxisTableCollapseButton` | 只卸载各自的表格区域，保留标题、计算结果、保存及热力图按钮；折叠时暂停该表的命中统计 |

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
- **显示与复用**：`FaceLinkFormula.tsx` 将公式栏精简为 EXIF / 参数计算两行“加权值 → 限制范围 → 最终值”摘要，并标明范围内/抬至下限/压至上限/数据不全；行内加权值、范围与最终值统一四舍五入为整数；行悬浮提示按“加权计算 / 极值范围 / 最终结果 / 来源”分区，计算数字统一显示一位小数，按“数值 | 标签/路径”分别列出 AE Target、FDSZ_RA、Normal Target、low/high 系数来源。参数 FDSZ_RA 同时列出真实 `face_sz / face_sz_ra` 轴路径，Tab 聚焦该行同样可查看。`data-tooltip-monospace="true"` 仅为这些公式/路径提示启用等宽字体、较大行距和内边距，普通全局 tooltip 保持原样；所有舍入只用于展示，不回写共享计算器或改变边界判断。摘要不重新计算数值，标题和图片列表仍共享 `calculateFaceTargetMetrics` 的最终结果；列表批量读取列表补入 AE Target 与两项 EXIF 系数，不为每个单元格额外发请求。现有 FDSZ_RA 来源切换只改变 EXIF 加权因子，不混用两套边界。
- **参数超链接**：摘要下保留 AE.cpp 下限 `[0][4][1].19`、上限 `[0][4][1].20` 两个 Fluent Link 按钮。`jumpToFaceCwrBoundSource` 复用既有 `onSourceJump → ImagePane.handleSourceJump → param_map` 路由，传入精确 path、当前源码 token、行号及同一行 ordinal，既定位对应参数又避免相同数值/同一行多个参数误选。字段缺失、行号无效或没有跳转能力时禁用链接，不打开浏览器、不新增 IPC 或观察器，也不改写/保存参数。
- **异常边界**：缺少/非有限的基数、系数或加权输入时对应最终值显示 `-`，不能拿另一条链路的边界或未钳制值冒充成功；零边界有效，颠倒上下限沿用现有 `limitNumber / limit` 的排序语义。Face 页的 FBT `Back Scene Target` 不新增本次 FLT 限制。
- **验证**：`scripts/face-link-target.test.mjs` 执行实际 TOML 公式、Face 表求值器、卡片/列表计算器、源码边界加载与草稿映射，并执行真实公式栏 JSX 的渲染逻辑；由 `npm run sync:test` 接入既有 Windows CI。Rust schema 用例仅验证资源契约，编译/行为测试由 CI 执行。本次未通过本地 Tauri 编译验收真实桌面显示。

## 性能约束

- 图片 TOML 必须批量读取，不能在每个单元格内发起 IPC。
- 统计结果只在热力图开启时计算，并使用 `useMemo` 或等价的稳定输入缓存。
- 只保存图片路径集合，不保存图片对象、缩略图或完整 TOML，筛选完成后沿用现有图片列表清理流程。
