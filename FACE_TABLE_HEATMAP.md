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

## 性能约束

- 图片 TOML 必须批量读取，不能在每个单元格内发起 IPC。
- 统计结果只在热力图开启时计算，并使用 `useMemo` 或等价的稳定输入缓存。
- 只保存图片路径集合，不保存图片对象、缩略图或完整 TOML，筛选完成后沿用现有图片列表清理流程。
