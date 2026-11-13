# 实现亮点与痛点账本

## 用途

每次完成修改后，记录已验证的可复用方案、实际遇到的根因和后续修改的闭坑条件；没有新经验时明确记录“无新增亮点或痛点”。本文不替代 .codex/rules/ 中的规范断言。新记录应包含日期、主题、亮点、痛点、闭坑和验证；每项写出具体路径、行为或命令。未运行的验证必须标为“未验证”。

### 2026-11-05：整理并准备发布 v0.2.15

**亮点**

- 保留 `v0.2.13..HEAD` 中已推送的 12 个功能提交原有顺序，以独立 `chore: release v0.2.15` 提交标记发行边界；版本唯一来源为 `src-tauri/tauri.conf.json`，发行说明由 `src/data/changelog.json` 供 Release 与应用内更新共用。

**痛点**

- 当前运行环境未安装 GitHub CLI，无法本地查询 Actions 运行详情；发布状态需要通过 tag 推送后的 GitHub Actions 工作流确认。

**闭坑**

- 发布前确认远端不存在目标 tag，执行版本同步与 release 脚本测试；只推送 `main` 与指定版本 tag，不重写已推送功能历史或使用 `git push --tags`。

**验证**

- 发布前验证记录见本次交付；GitHub Actions 构建、签名和 Release 资产状态须在 tag 推送后确认。

### 2026-11-05：统一 Face 参数表标题单元格主题色

**亮点**

- `ChartMapMode.tsx` 中 FaceProb、Face FDSZ_RA/FDDR_RA 的横轴标题格共用 `FACE_AXIS_HEADER_BACKGROUND`；该背景和标题行标签改为读取 `--hs-weight-bv-bg`、`--hs-weight-cell-fg`，使其与 Face 表格 BV 行标题配色一致，并跟随浅色/深色主题令牌切换。参数插值结果映射表的行标题也改用同一令牌。

**痛点**

- 标题格背景原来固定使用浅色主题 `#E1F5D1`，深色主题仍渲染浅底；标签文字也固定深色，造成主题反差不一致。

**闭坑**

- Face 参数表新增标题或行标题样式时复用 `--hs-weight-bv-bg` 和 `--hs-weight-cell-fg`；轴标题的选中状态继续使用品牌前景色，不覆盖背景令牌。

**验证**

- `npm run typecheck`、`git diff --check` 通过；未在 Tauri 窗口实际切换浅色/深色主题验收。

### 2026-11-06：补充临时编译文件清理流程

**亮点**

- README 增加项目根目录可执行的 PowerShell 清理命令，覆盖 `src-tauri/target`、`dist` 和 `luxe-rust-test-*` 临时测试目录，并保留 `node_modules` 依赖目录。

**痛点**

- Rust/Tauri 增量编译产物可能长期占用大量磁盘空间，测试使用独立 `CARGO_TARGET_DIR` 时还会在系统临时目录留下大型目标目录。

**闭坑**

- 清理前先停止 `tauri:dev`、`cargo` 和 `rustc` 进程；删除后重新构建会自动生成所需目录，删除 `node_modules` 后必须运行 `npm ci`。

**验证**

- README 命令按 PowerShell 语法检查；本次仅修改文档，未重新运行构建测试。

### 2026-11-06：核对 README 自动化发布流程

**亮点**

- 对照 `.github/workflows/ci.yml`、`release.yml`、`star-release.yml` 以及 `package.json`、`scripts/prepare-release.mjs`、`scripts/prepare-star-version.mjs` 核对 README；补充 Star 工作流入口和稳定 Release 资产替换行为，修正调试包路径为 `src-tauri/target/debug/bundle/`，并同步 Star 版本实际使用的数字预发布格式。

**痛点**

- README 原自动化表遗漏了实际存在的 Star 发布工作流；本地调试产物路径缺少 `src-tauri/` 前缀，Star 版本格式也误写成了带 `-star` 文本的版本。

**闭坑**

- 修改发布说明前同步检查三个工作流的触发条件、版本校验、资产数量和发布目标；路径以 `src-tauri/tauri.conf.json` 的 Tauri 默认 target 目录为准。

**验证**

- 已完成脚本和工作流静态核对；运行 `git diff --check`，未重新执行构建测试，因为本次只修改文档。

## 记录模板

### YYYY-MM-DD：主题

**亮点**

- 方案、可复用入口和受影响路径。

**痛点**

- 实际根因、失败方案、边界条件或残余风险。

**闭坑**

- 后续修改前要检查的文件、断言或测试。

**验证**

- 实际运行的命令与结果；未验证项单列。

## 已沉淀经验

### 2026-11-04：阻止散点刻度触发全局标题提示并固定表头刻度位置
**亮点**

- `ChartMapMode.tsx` 为刻度覆盖层设置 `data-tooltip-disabled="true"`，阻止 `GlobalTitleTooltip` 从祖先单元格接管悬浮提示；表头数值刻度使用数组索引直接定位到各自单元格中心，提示文本读取同索引表头值。
**痛点**

- 刻度按钮没有自身 `title`，但全局提示通过 `closest([title])` 找到了带标题的祖先元素，仍生成第二个悬浮框；此前以数值反查轴位置在重复或非单调轴值下也可能偏离实际列/行。
**闭坑**

- 在带自绘 tooltip 的区域设置 `data-tooltip-disabled="true"`，防止全局标题提示向上冒泡匹配；表头标记按数组索引定位，散点值仍使用插值映射。
**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 通过；未在 Tauri 窗口手动验证标题提示是否完全消失和刻度顺序。

### 2026-11-04：修正 BV/DR 轴边界刻度值与重复提示
**亮点**

- `ChartMapMode.tsx` 将表头中心刻度与散点坐标统一到 `faceScatterAxisCoordinate`；单元格间轴边界使用相邻表头数值的中点，坐标原点合并显示首个 BV/DR 值。`globals.css` 将原点提示放在刻度下方，移除 button 原生 `title` 后只显示自定义提示。
**痛点**

- 先前轴边界刻度错误地复用了相邻表头值，造成 `-500` 与 `0` 之间显示 `DR 0`；同时 `title` 与 CSS `::after` 生成了重复悬浮文字。
**闭坑**

- 后续修改刻度时区分单元格中心值和单元格间边界值；中心刻度及散点共用坐标函数，边界数值按邻接头值插值，原点不再单独渲染重叠的水平/垂直刻度标签。
**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 通过；未在 Tauri 窗口实测截图对应数据的视觉位置和悬浮提示。

### 2026-11-04：散点图坐标刻度悬浮提示与表格虚线
**亮点**

- `globals.css` 在散点模式仅保留数据表格虚线边框，没有叠加单元格透明度；`ChartMapMode.tsx` 在数据区叠加不可见的轴边界刻度和主题色数值刻度，悬浮或键盘聚焦时才显现并展示 BV/DR 数值。
**痛点**

- 表头与数据区存在固定 72px 左侧、40px 顶部偏移，刻度层必须与 Canvas 数据区使用相同的定位基准；表头数值点则使用 `faceScatterAxisPosition` 插值，不能按索引等距放置。
**闭坑**

- 后续调整表头尺寸时同步更新 `.face-bv-dr-scatter-layer` 和 `.face-bv-dr-scatter-tick-area` 的偏移；保持刻度覆盖层不拦截其他区域的指针事件，并核对超出轴范围及空数据轴的定位。
**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 通过；未在 Tauri 窗口实测鼠标悬浮、键盘聚焦、刻度提示边缘裁切及深浅主题表现。

### 2026-11-04：完成 Face fd_th_tbl 图片 BV/DR 散点叠加

**亮点**

- `ChartMapMode.tsx` 复用 Face 热力图的批量 TOML 字段读取和 `boundsForTableAxis` 权重，按表格列 DR、行 BV 的真实刻度插值定位每张图片；散点点击沿用图片列表的路径选择入口。
- `globals.css` 仅在散点模式下将表格网格改为半透明虚线，并绘制向右、向下的坐标轴；按钮提示加入 16 份翻译资源。

**痛点**

- BV/DR 表头可能不等距，直接按数值范围线性映射会使点与表格插值单元格错位；空轴需要阻止坐标百分比除零。点位超出刻度范围时沿用现有表格边界钳制行为。
- 覆盖整张表格的交互画布会拦截单元格编辑点击，且同时设置 `left` 与 `width: 100%` 会使图层超出数据区；最终画布改为不接收指针事件，只由表格捕获散点 8px 范围内的点击。
- Canvas 本身以 `auto` 尺寸绝对定位时，绘制逻辑把 backing store 调整为设备像素会同时改变其固有布局尺寸；观察该 Canvas 会导致尺寸反馈和散点重绘闪烁。

**闭坑**

- 后续修改 Face 表格的刻度计算时，同步检查 `faceScatterAxisPosition` 与 `boundsForTableAxis` 的权重契约；散点层只覆盖数据区，不能改变表格行列尺寸或阻断原有编辑焦点。
- 后续修改散点点击时，确认非点位点击仍能聚焦可编辑单元格，且图层 `top/left` 与 `FACE_BV_DR_CORNER_HEIGHT/WIDTH` 一致。
- Canvas backing store 使用设备像素尺寸时，CSS 显示尺寸必须固定；`ResizeObserver` 观察布局容器，不能观察会被绘制逻辑改动固有尺寸的 Canvas。

**验证**

- `npm run typecheck`、`npm run build`、16 份翻译 JSON 解析、`git diff --check` 及独立 target 的 `cargo test --locked --manifest-path src-tauri/Cargo.toml --test face_heatmap_state` 通过（1 项）；默认 Cargo target 测试因运行中的 `luxe-tauri.exe` 文件锁失败。修复 Canvas 尺寸反馈后尚未在 Tauri 窗口实测持续显示、散点点击、单元格编辑、不同窗口宽度和深浅主题。

### 2026-11-04：Face BV/DR 散点和图片列表联动选择

**亮点**

- `Isp6sAeVisual.tsx` 继续复用 `heatmapSelection` 保存图片多选；散点、表格行和表格列标题共用选择回调，定位图片时保留选中集合。列标题选择通过 `loadImageTomlFieldsBatchShared` 分批读取当前列依赖字段，再筛出有值的图片。
- `ChartMapMode.tsx` 根据共享路径集合高亮散点；普通点击替换选择，Ctrl/Command 点击切换单张图片。散点开启时 DR 表头输入落在左下、BV 表头输入落在右上，关闭时恢复默认样式。

**痛点**

- 图片行原先只负责切换当前图片并清空热力图选择，散点点击也只更新表格集合，导致图片列表、当前预览和散点高亮没有一致的选择状态。
- 列表列标题与排序共用一个按钮；将标题选择与排序图标拆成独立按钮，避免列多选覆盖排序操作。

**闭坑**

- 后续调整多选时，保持行点击、散点点击和列标题操作使用同一组 `toml_path`，并在 modifier 操作时只切换命中的路径。
- 调整散点轴表头时，检查输入框所在单元格的 flex 对齐和输入框自身高度；仅改表格容器对齐不会移动输入文字。
- 列标题选择会读取全体筛选后图片的字段，保留 128 条一批的请求上限，并忽略空值和 `-`。

**验证**

- `npm run typecheck` 和 `npm run build` 通过，`git diff --check` 通过。尚未在 Tauri 窗口实测散点命中、Ctrl/Command 多选、列标题字段选择及轴对齐。

### 2026-11-04：图片列表表格支持拖动范围选择与显式排序控制

**亮点**

- `TablePane.tsx` 在 idx 行标题按下后跟踪虚拟列表中的显示索引，拖动经过的行先显示范围预览，指针释放时一次性提交路径集合；Ctrl/Command 拖动追加范围，Ctrl/Command 单击切换单行。
- 列标题按下后记录列范围，释放时一次读取范围内列的图片匹配集合；列数据请求按 128 条分批，异步响应以请求序号和当前图片目录隔离。
- 列排序默认关闭；idx 表头右键开关排序，关闭时清除方向和排序结果，上/下箭头分别设置正序和逆序，标题文字只负责选列。

**痛点**

- 虚拟列表只挂载可见行，不能通过 DOM 行范围推导完整选择；选择必须基于排序后 `sortedRows` 的显示索引，再映射到稳定的 `toml_path`。
- 图片选择回调会切换当前图片并触发 TOML 加载；如果每次拖过一行都提交，会重复启动图片加载，因此拖动期间仅更新本地预览，松开时提交一次。
- 标题点击原先同时负责排序/重置；排序和选择分离后，排序方向需要两个独立按钮，排序开关关闭时禁用方向按钮。

**闭坑**

- 修改图片列表多选时，分别验证普通单击、Ctrl/Command 单击、行范围拖动、列范围拖动、虚拟行滚动及指针取消。
- `pointerup`/`pointercancel` 文档监听必须在卸载时解绑；切换图片目录时递增列选择请求序号，丢弃旧字段结果。
- 右键 idx 表头关闭排序必须同时清除 `sortState`，并确认可见顺序恢复 IDX 原序；列标题普通点击不得隐式更改排序。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 通过。尚未在 Tauri 窗口实测行列拖选、右键排序开关和两个方向按钮。

### 2026-11-04：收敛图片表格列选择与散点轴对齐

**亮点**

- `TablePane.tsx` 保留 idx 表头全选和图片行范围多选，移除普通列标题点击/拖动选图片；多选行背景改用 `--colorBrandBackground2` 与当前中性背景混合，并统一选中行文字色。
- 排序关闭时不渲染方向图标；开启后恢复标题旁竖向上下箭头，分别设置正序和逆序。散点开关不再影响 BV/DR 表头，轴输入始终沿用居中样式。

**痛点**

- 列标题选图与既有排序、列设置入口共处一个区域，增加了不必要的操作冲突；散点轴专用对齐也偏离了用户期望的常驻居中状态。

**闭坑**

- 调整表头时区分 idx 全选、列标题排序和列设置按钮；排序关闭态应从 DOM 中移除方向图标，避免留下禁用按钮占位。
- 多选背景使用 Fluent 语义品牌令牌，检查浅色和深色主题下文字与底色对比；散点绘制开关不得改变轴表头输入样式。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 通过。尚未在 Tauri 窗口实测主题对比度、排序图标显示切换及散点轴居中。

### 2026-11-03：修复 bcompare 与 Tone.cpp 表头列对齐

**亮点**

- `src/views/mtk/isp6s/ImagePane/ParaCheckMode.tsx` 的表头行改为复用 `currentRowStyle`，AE Basic 和 ToneMap 各自的表头列宽现在与对应数据行一致。

**痛点**

- 两种模式的列宽改为动态 `gridTemplateColumns` 后，数据行已使用动态样式，表头仍引用不含列定义的基础 `rowStyle`，造成三个标题单元格挤入第一列。

**闭坑**

- 调整表格列宽时检查 `<thead>`、`<tbody>` 和占位行是否共用相同的列定义；验证 AE Basic 与 ToneMap 两种分支。

**验证**

- `npm run typecheck`、`git diff --check` 通过。未在 Tauri 窗口实测截图中的两个详情页面。

### 2026-11-03：恢复 AE Basic 的 EXIF 与 bcompare 页面

**亮点**

- `Isp6sAeVisual.tsx` 恢复 AE Basic 的 EXIF/bcompare 标签和既有布局；ToneMap 继续显示原有 LCE/EXIF/Tone.cpp 标签。`ParaCheckMode.tsx` 依据 `toneMode` 分别读取 `para_check` 与 `tone_para_check`，复用编辑、保存和源码跳转逻辑。
- `Isp6s.toml` 同时保留 AE.CPP 和 Tone.cpp 的独立映射；父组件分别向两种对比页面提供对应源码草稿绑定，CA-LTM 选中时 Tone.cpp 跳转仍定位 Tone.cpp。

**痛点**

- 详情标签状态类型被 AE 与 Tone 两套工作区共用，恢复 AE 的 `bcompare` 时必须保留 ToneMap 的 `tone_cpp` 状态，并在各自渲染入口按模式筛选标签。
- 完整 `npm run rust:test` 在当前 target 产物中遇到 E0460/E0463 crate 解析错误；库测试可运行，集成测试未能验证。

**闭坑**

- 同一详情组件服务多个工作区时，为每个模式单独核对标签白名单、配置 section、源码文件名与 binding；恢复一个模式的旧页面不能覆盖另一个模式的当前页面。

**验证**

- `npm run typecheck`、`npm run build`、`cargo test --manifest-path src-tauri/Cargo.toml --lib` 和 `git diff --check` 通过；Rust 库测试 16 通过、1 忽略。`npm run rust:test` 因 crate 解析错误失败；未在 Tauri 窗口实测两个详情面板的点击交互。

### 2026-11-02：ToneMap 详情承接 EXIF 与 Tone.cpp 参数对比

**亮点**

- `src/views/mtk/isp6s/Isp6sAeVisual.tsx` 将 EXIF 和原 bcompare 从 AE Basic 详情标签移至 ToneMap 下方详情面板；EXIF 继续使用原 `ExifTable`，ToneMap 保留原 LCE 标签和面板比例。
- `src-tauri/resources/Isp6s.toml` 的 `tone_para_check.items` 只定义五项 Tone.cpp 映射，Rust schema 与前端类型同步；无图片 3A 关键字的 DCE 开关行显示 `-`。`ParaCheckMode.tsx` 以完整字段路径匹配参数值，`ImagePane.tsx` 使对比表跳转始终打开导入的 Tone.cpp。

**痛点**

- 原对比表依赖 AE Basic 的 `para_check` 配置和 AE.CPP 文案；ToneMap 的 CA-LTM 子标签还会切换源码卡片当前文件，直接复用当前文件跳转会把 Tone.cpp 对比项定位到 CA-LTM.cpp。
- 仓库没有可核对这五个字段实际数值的 Tone.cpp 样本。完整 `npm run rust:test` 在当前构建产物上出现 E0460/E0463 crate 解析错误，未得到集成测试结果。

**闭坑**

- 修改 Tone.cpp 对比项时同时检查 `Isp6s.toml`、`isp6s_schema.rs`、`cppParser.ts` 和 `ParaCheckMode.tsx`；字段路径必须精确相等，缺失字段显示占位符，不得匹配下级路径。核对 CA-LTM 子标签下的对比表跳转仍落在 Tone.cpp 草稿。

**验证**

- `npm run typecheck`、`npm run build`、`cargo test --manifest-path src-tauri/Cargo.toml --lib`、`git diff --check` 通过；Rust 库测试 16 通过、1 忽略。`npm run rust:test` 因上述 crate 解析错误失败；尚未在 Tauri 窗口实测迁移后的标签、跳转和真实 Tone.cpp 字段值。

### 2026-11-02：源代码卡片隐藏按钮移至映射按钮右侧

**亮点**

- `src/views/mtk/isp6s/ImagePane/ImagePane.tsx` 的标题栏按钮顺序改为图表映射、源码映射、隐藏源代码；复用原有 `WorkspaceHideButton`，按钮样式、提示和折叠入口保持一致。

**痛点**

- 原隐藏入口位于映射按钮组左侧，与预期的标题栏末尾操作位置不符。

**闭坑**

- 后续调整 `TABS` 或标题栏操作时，检查隐藏按钮仍位于 `TABS.map(...)` 之后。

**验证**

- `npm run typecheck`、`git diff --check` 通过；桌面 Tauri 窗口位置未实测。

### 2026-11-02：隐藏与显示卡片使用双向方向过渡

**亮点**

- `src/views/mtk/isp6s/usePanelCollapseTransition.ts` 将卡片状态扩展为 `collapsing`、`expanding` 和 `idle`；横向图片列表从左侧、源代码从右侧，纵向详情面板从底部进行内容位移、缩放和透明度过渡。
- `WorkspaceColumns.tsx` 的恢复按钮现在通过 `expand()` 设置布局，`Isp6sAeVisual.tsx` 的详情恢复也使用同一入口；内容在展开动画期间保持挂载，避免从零尺寸直接跳到完整尺寸。

**痛点**

- 之前隐藏路径有 `flex-grow` 过渡，恢复按钮直接调用 `setLayout`/`expand`，导致显示卡片瞬间出现，缺少从恢复按钮方向扩散的反馈。

**闭坑**

- 展开前必须先进入 `expanding` 状态并让初始样式完成一次绘制，再改变面板布局；折叠和展开期间不能提前卸载内容。`prefers-reduced-motion: reduce` 继续走无动画路径。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 通过；桌面 Tauri 窗口动画观感未实测。

### 2026-11-02：修正图片列表与源代码卡片的过渡节奏

**亮点**

- `usePanelCollapseTransition.ts` 将原先隐藏时的 `0.06` 透明度改为更克制的参数，面板尺寸过渡统一为 300ms；横向两列最终采用内容宽度冻结与边缘裁切，避免整列透明度和缩放影响表格可读性。
- `WorkspaceColumns.tsx` 在展开初始阶段保留恢复图标作为视觉起点；点击隐藏或显示时固定被操作列的内容宽度，图片列表锚定左边、源代码锚定右边，由 `Panel` 的 `overflow: hidden` 从对应边缘裁切或展开。

**痛点**

- 旧样式会先把卡片几乎完全淡出，再开始面板收缩；显示时恢复图标立即消失，内容没有明确的扩散起点。横向两列还共用同一 `motion`，导致未被操作的一列也同时淡化和位移；对含表格的整列缩放会让文字发虚，内容随父级宽度逐帧重排。

**闭坑**

- 横向面板折叠动画以 `flex-grow` 和 `overflow: hidden` 为主，动画期间冻结目标列内容宽度并锚定在折叠边；不要对大表格整体做透明度或缩放动画，也不要让恢复按钮在展开第一帧消失。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 通过；桌面 Tauri 窗口动画观感未实测。

### 2026-11-02：恢复图片详情隐藏图标的原有位置

**亮点**

- `src/views/mtk/isp6s/Isp6sAeVisual.tsx` 在详情标题栏保留原来的 `32×32` 右侧占位，内部居中放置共用的 `WorkspaceHideButton`；图标中心保持在原位置，悬浮颜色与折叠行为继续复用。

**痛点**

- 上次直接把 `28×28` 共用按钮设为 `ml-auto`，使图标中心相对原 `32×32` 按钮向右偏移 2px。

**闭坑**

- 替换标题栏按钮时同时核对原占位盒与图标中心，不只核对按钮本身的尺寸；详情标题栏末尾保持 `32×32` 占位。

**验证**

- 待运行类型检查与差异检查；桌面 Tauri 窗口位置未实测。

### 2026-11-02：三处卡片隐藏按钮统一悬浮态与折叠焦点

**亮点**

- `src/views/mtk/isp6s/WorkspaceColumns.tsx` 的 `WorkspaceHideButton` 供图片列表、源代码和图片详情三处复用；悬浮或键盘聚焦时图标切换为 `--colorBrandForeground1`，默认使用 `--colorNeutralForeground2`。
- `src/views/mtk/isp6s/usePanelCollapseTransition.ts` 为点击隐藏提供 200ms 的面板尺寸过渡，结束后才隐藏内容并聚焦恢复按钮；`Isp6sAeVisual.tsx` 的详情面板也复用此逻辑，减少动态效果设置下直接折叠。动画帧与兜底计时器在完成或卸载时清理。

**痛点**

- 详情隐藏入口原为固定颜色的原生按钮，和横向卡片的 Fluent 悬浮态不同；分割面板立即折叠并卸载详情内容时，焦点停留在消失的按钮上。

**闭坑**

- 分割面板的内容须保留到尺寸过渡完成，恢复按钮出现后再转移焦点；拖拽折叠仍沿用立即响应路径，不能让动画拖慢拖拽。检查 `transitionend` 未触发及减少动态效果两条路径。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 通过；构建产物包含 `flex-grow`、`width`、`height` 的过渡样式。桌面 Tauri 窗口交互未验证。

### 2026-11-02：工作区标题栏图标按钮位置与尺寸统一

**亮点**

- `src/views/mtk/isp6s/TablePane/TablePane.tsx` 将图片列表隐藏入口放在操作组末尾；`src/views/mtk/isp6s/ImagePane/ImagePane.tsx` 将源码隐藏入口放在映射切换按钮之前，图表映射和源码映射固定为 28px 图标按钮，沿用 `HoverTooltip` 显示名称。

**痛点**

- 原映射按钮根据标题栏宽度切换文字，导致按钮宽度随工作区比例变化；图片列表隐藏入口位于操作组起始处，和右侧卡片隐藏入口的位置不一致。

**闭坑**

- 调整工作区标题栏时检查按钮顺序、窄列宽下的可见性，以及图标按钮的悬浮提示和 `aria-label`；不要重新引入依赖标题栏宽度的模式文字切换。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 通过。桌面 Tauri 窗口交互未验证。

### 2026-10-29：图片列表与源代码卡片支持横向隐藏和恢复

**亮点**

- `src/views/mtk/isp6s/WorkspaceColumns.tsx` 统一 AE Basic 与 ToneMap 的横向分割器：两侧均可拖动折叠或点击标题栏按钮隐藏；折叠后在工作区边缘显示对应恢复图标。
- `Isp6sAeVisual.tsx` 复用现有展开比例保存入口，`workspaceSession.ts` 分工作区记录折叠方向；恢复时设置完整双列布局，折叠的 0/100 比例不写入展开比例。
- `TablePane/TablePane.tsx`、`ImagePane/ImagePane.tsx` 接入统一图标按钮，16 份翻译资源补齐提示。横向隐藏保留组件实例，避免清空源码草稿、撤销记录和批量计算结果。

**痛点**

- 左侧横向面板还包含详情/LCE 区，隐藏图片列表侧需要整体收起该列，并保留其纵向分割器状态。若隐藏时卸载图片列表或源码组件，会丢失组件内部的计算状态或未保存编辑。
- 原比例保存会将超界值钳制到展开边界；横向折叠产生的 0/100 布局必须先过滤，否则恢复值会被覆盖。隐藏的分割器也不能驱动顶部路径栏对齐。

**闭坑**

- 保持两侧 Panel 的 id、order 和组件实例稳定；恢复图标必须位于折叠面板外。校验分别隐藏左右侧、交替隐藏、切换 AE Basic/ToneMap 和恢复后再次拖动的行为。
- 折叠方向为工作区会话状态；比例沿用 AE Basic 的持久化配置和 ToneMap 的会话比例，不能在折叠时将 0/100 写回。

**验证**

- `npm run typecheck`、`npm run build`、`node --test scripts/workspace-persistence.test.mjs`（7 项）、`git diff --check` 通过；PowerShell 解析并核对 16 份 JSON，4 个新增翻译键全部存在。桌面窗口的拖拽、折叠恢复、草稿保持和深浅主题未实测。

### 2026-10-29：多开进程与临时资源隔离

**亮点**

- `src-tauri/src/lib.rs`、`src-tauri/Cargo.toml` 和 `src-tauri/Cargo.lock` 移除正式构建的单实例插件，重复启动时创建独立进程。
- `src-tauri/src/config/state_file.rs` 使用进程 ID、递增序号和 `create_new` 创建独立状态临时文件，再原子替换配置；`image_scan/mod.rs` 和 `commands/text_cmds.rs` 按进程隔离图片缓存与源码草稿。`.gitignore` 与 `.taurignore` 同步排除新临时文件。
- `src-tauri/tests/multi_instance.rs` 通过两个子进程并发保存配置、为同一源文件写入不同草稿和生成预览，检查内存状态独立、配置完整与缓存清理隔离。

**痛点**

- 原单实例插件仅在正式构建启用，导致开发环境可多开而安装包不可多开。移除插件后，原共用 `state.toml.tmp` 会被其他进程截断或移动，共用缩略图目录会被其他进程切换目录时删除，同名源码草稿会互相覆盖。
- 持久化仍使用共用 `state.toml` 的完整快照，最后完成的保存决定重启后的状态；不会在运行中的实例间同步配置。全局快捷键遇到已注册组合时沿用原有跳过逻辑。

**闭坑**

- 调整启动生命周期时同时检查正式与开发构建；临时资源必须检查是否跨进程共享。状态临时文件的命名调整须同步更新 Git 忽略和 Tauri 监听排除。
- 多开回归运行 `src-tauri/tests/multi_instance.rs`；托盘退出或重启应只作用于当前进程，不能扫描或终止其他 LUXE 进程。

**验证**

- `cargo check --locked --manifest-path src-tauri/Cargo.toml`、`npm run typecheck`、`npm run rust:test`、`git diff --check` 通过。Rust 全量回归包含双子进程并发保存、草稿隔离和预览缓存隔离；未在实际桌面窗口中验收双实例启动、托盘与快捷键交互。

### 2026-10-29：Apply 后保留热力图已选图片位置

**亮点**

- `src/views/mtk/isp6s/TablePane/TablePane.tsx` 用 `positionedHeatmapSelectionRef` 记录已经定位过的热力图选择；新命中集合仍定位首张，图片切换后 Apply 更新表格行时保留当前位置。

**痛点**

- 原定位 effect 同时依赖 `selectedHeatmapPaths` 和 `sortedRows`。Apply 重算分类使 `sortedRows` 引用变化，旧 effect 把列表重新滚到首张命中图片，即使命中集合与当前图片均未变化。

**闭坑**

- 修改图片表格的排序、分类或计算刷新时，检查滚动 effect 是否只在用户选择发生变化时定位；命中目标暂不在 `sortedRows` 时，保留稍后定位的机会。

**验证**

- `npm run typecheck` 通过；`git diff --check` 通过。未在 Tauri 窗口实测热力图命中、左右切换及 Apply 的完整鼠标流程。

### 2026-10-23：本地状态文档统一归档

**亮点**

- 将 `src-tauri/resources/README.md` 移至 `docs/config/LOCAL_STATE.md`，并更新 `README.md` 与 `docs/README.md` 的链接；实际 `state.toml` 路径不变。

**痛点**

- 原文中的“本目录”依赖文档与状态文件同目录；迁移后已改成明确的 `src-tauri/resources/state.toml`，避免误以为状态文件也迁入 `docs/`。

**闭坑**

- 移动专题文档时检查仓库内引用和相对路径；`src-tauri/tauri.conf.json` 的资源清单未包含此 Markdown 文件，无需更改打包配置。

**验证**

- `rg` 检查文档引用与打包资源清单，`Test-Path` 确认新文件存在且旧文件已移除，`git diff --check` 通过。未运行应用交互测试，因本次仅移动维护文档。

### 2026-10-23：DP 路径保存被小数分栏比例阻断

**亮点**

- `src-tauri/src/config/state_schema.rs` 将 MTK 的 `inner_splitter`、`outer_splitter` 定义为小数比例，并兼容旧 `state.toml` 中的整数比例。
- `src-tauri/src/config/state_file.rs` 验证一次 MTK 状态补丁同时包含小数比例与 DP 工具路径时，落盘和重读都保留原值。

**痛点**

- 拖入 DP 快捷方式后，前端成功解析并显示目标 `.exe` 路径；随后保存整个 `mtk` 状态时，分栏拖动产生的 `32.2005007422` 被 Rust 的 `Vec<u32>` 拒绝，导致同一补丁里的 `debug_parser_path` 也未写入。此前只测试整数比例，未覆盖真实拖拽值。

**闭坑**

- 持久化对象的每个字段都必须能接收 UI 实际产生的数值类型；修改 `Mtk` 字段时同时覆盖旧 TOML、JSON 补丁和磁盘重读。运行中的旧 Tauri 可执行文件须重新编译并重启才会使用新的 Rust 契约。

**验证**

- `cargo test --manifest-path src-tauri/Cargo.toml --lib`（13 项通过、1 项忽略）、`npm run typecheck`、`node --test scripts/workspace-persistence.test.mjs`（7 项）和 `git diff --check` 通过。
- `npm run rust:test` 因运行中的 `target/debug/luxe-tauri.exe` 被占用，Cargo 无法替换文件而未完成；桌面窗口关闭重启的人工验收尚未执行。

### 2026-10-23：DP 解析工具路径未恢复

**亮点**

- `src/views/mtk/debugParserPath.ts` 统一 DP 工具的 `.exe` 检查；选择、拖入、启动校验和 EXIF 入口都使用同一规则，允许重命名的工具文件。
- `src/views/mtk/MtkView.tsx` 选择 DP 路径后显式提交 MTK 状态并等待 `flushStateNow()`，确保同一路径重试也会落盘；失败时展示错误详情。

**痛点**

- 原界面在调用保存逻辑前要求文件名恰好为 `DebugParser.exe`，后端实际只检查路径为文件；重命名的工具会被前端拒绝，无法写入状态。此前路径保存失败只写控制台，界面仍可能显示未落盘的路径。本机开发态 `state.toml` 中 DP 字段缺失，历史路径无法凭空恢复。

**闭坑**

- DP 文件名规则须与 `src-tauri/src/image_scan/mod.rs` 的执行条件一致；新路径应在关闭前完成持久化，旧状态没有 DP 字段时需重新选择一次。

**验证**

- `npm run typecheck`、`npm run build`、`node --test scripts/workspace-persistence.test.mjs`（7 项）和 `cargo test --manifest-path src-tauri/Cargo.toml --lib`（11 项通过、1 项忽略）通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --test workspace_persistence` 因运行中的开发版占用 `target/debug/luxe-tauri.exe` 无法编译；Tauri 窗口中重新选择 DP 工具并关闭重启的人工验收未执行。

### 2026-10-23：MTK 工作区路径重启恢复

**亮点**

- `src/stores/mtkStore.ts` 在启动时一次性恢复 AE/Tone 参数路径和 DP 工具路径；图片目录进入扫描状态即写入 `mtk.image_workspaces`，同一目录重试保留已选图片。
- `src/views/mtk/MtkView.tsx` 按参数文件键分别校验并解析所有已保存路径，手动选择 AE/Tone 或 DP 文件时立即保存路径；路径暂时不可用时保留状态以供下次重试。启动恢复只校验 DP 工具，不自动执行它。

**痛点**

- 旧实现只有扫描出图片、解析成功后才持久化路径，关闭时尚在扫描或解析会丢失本次选择；参数文件恢复只处理当前标签，单一请求序号会让切换标签取消其他文件的恢复。
- 当前本机 `state.toml` 已包含存在的 AE/Tone 文件路径，但图片目录和所选图片当前不可访问；DP 路径未出现在该状态文件中，无法从不存在的记录恢复其具体路径。

**闭坑**

- 重启恢复不能在文件暂时不可访问时清除已保存路径；参数文件使用每个 `ISP|tab` 独立请求序号，异步结果应在路径被替换或页面卸载后失效。React effect 重新挂载时须清空恢复去重记录，否则新一轮解析会被跳过。
- 图片扫描失败须保留目录；同目录重试不得覆盖已保存的图片选择。校验 `scripts/workspace-persistence.test.mjs` 和实际桌面重启行为。

**验证**

- `npm run typecheck`、`node --test scripts/workspace-persistence.test.mjs` 通过；本机状态文件仅检查字段是否存在及路径可达性，未公开具体路径。
- Tauri 窗口关闭、重新启动和真实图片目录导入尚未人工验收。

### 2026-10-23：v0.2.8 发布准备与主页版本说明清理

**亮点**

- `src/views/HomeView.tsx` 移除主页更新卡片的内嵌“版本说明”，保留更新日志和近期更新入口。
- `src-tauri/tauri.conf.json` 作为唯一版本入口，同步 npm/Cargo 元数据；`src/data/changelog.json` 顶部新增 v0.2.8 记录，供应用内日志与 Release 说明共用。

**痛点**

- 运行中的 `src-tauri/target/debug/luxe-tauri.exe` 阻止完整 `npm run rust:test` 替换可执行文件，报 Windows 拒绝访问。
- 当前环境没有 `gh` 命令；正式安装包和 Release 依赖推送版本 tag 后的 GitHub Actions 工作流。
- 首次 v0.2.8 工作流在 `Test Rust` 失败；`src-tauri/tests/image_column_mapping.rs` 仍假设合并字段列表以 `FdMinCWR/B2D/B2M` 结尾，而当前 TOML 已按空景、人像分组。

**闭坑**

- 发版前核对 `npm run version:check`、变更日志首条版本和 `vX.Y.Z` tag 一致；推送后检查 CI、签名安装包和 `latest.json`，不要把 tag 推送当成 Release 已发布。
- 本地完整 Rust 测试需要先关闭占用 debug exe 的应用；CI 在独立环境重新运行。
- 映射顺序断言应检查 `image_table.scene` 的相邻 `B2D/B2M`，避免把两个分组的合并顺序误当作配置顺序。

**验证**

- `npm run version:check`、`npm run release:test`（27 项）、`npm run build`、列设置测试（7 项）、`cargo test --locked --manifest-path src-tauri/Cargo.toml --lib`（11 项通过、1 项忽略）、`git diff --check` 均通过。
- `npm run rust:test` 因 debug exe 被占用而未完成；改用独立 `CARGO_TARGET_DIR` 运行完整 `cargo test --locked --manifest-path src-tauri/Cargo.toml`，修正断言后通过。
- GitHub Actions `Publish Windows release`（run 39902412756）通过；公开的 v0.2.8 Release 包含 NSIS、`.sig`、MSI、`latest.json` 和 `SHA256SUMS.txt`，清单版本为 0.2.8 且包含安装包代理地址与签名。
- Tauri 主页交互和安装升级尚未人工验收。

### 2026-10-23：列设置颜色阈值归入第七条

**亮点**

- `ColumnSettingsWindow.tsx` 将 `∆CWR`、`ΔEV`、`AEGain(new)` 三个共用阈值依次放入颜色规则；`columnSettings.css` 固定输入宽度、左对齐数字，并在右侧排列 Fluent 上下按钮。
- `imageTableColumnSettings.ts` 的 `stepThresholdDraft` 根据当前小数位数调整末位，保留显示精度；16 份翻译资源补齐按钮与无效输入提示。

**痛点**

- 原生数字输入框的步长与用户输入精度无关；旧资源未定义无效阈值提示键，输入错误时会显示键名。

**闭坑**

- 修改阈值输入时核对 `validThreshold` 与 `stepThresholdDraft` 接受相同的非负十进制格式，并检查零值减法及小数进位。
- Tauri 独立窗口中的实际排版和按钮交互仍需人工检查。

**验证**

- `npm run typecheck`、`npm run build`、`node --test src/views/mtk/isp6s/TablePane/imageTableColumnSettings.test.mjs` 通过；16 份翻译 JSON 已解析并检查相关 key。
- 未在 Tauri 独立窗口中人工验收。

### 2026-10-23：列设置规则面板分条排版

**亮点**

- `ColumnSettingsWindow.tsx` 将“添加与修改规则”逐条显示；`columnSettings.css` 为每条规则添加编号和语义令牌分隔线，技术字段、公式和数字使用等宽字体与浅色底。
- `zh_CN.json`、`zh_TW.json`、`en_US.json` 保留原有翻译 key，缩短对应说明；其他语言仍通过现有英文文案显示。

**痛点**

- 原面板只有段间空白，长公式与中文说明混排时不易扫描。翻译资源完整 key 集合已有差异：14 份语言文件缺少关闭窗口相关的 10 个 key，与本次规则面板无关。

**闭坑**

- 修改规则面板时检查 Tone 隐藏 AE 专属条目、深浅主题令牌、长公式换行，以及 16 份资源中的面板 key。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check`：通过。
- 16 份翻译 JSON 均可解析；完整 key 集合检查发现上述既有差异。
- Tauri 独立窗口中的视觉布局、主题和滚动交互：未验证。

### 2026-10-23：图片表格渲染错误修复

**亮点**

- `imageTableColumnSettings.ts` 的 `collectImageTableCustomColumns()` 只读取 `all`、`face`、`normal` 的自定义列；`TablePane.tsx` 使用该入口生成表格列。

**痛点**

- 模式级 `color_thresholds` 加入后，`Object.values(modeSettings)` 不再只包含列配置。旧代码读取阈值对象的 `.custom` 得到 `undefined`，后续访问 `.source` 使图片表格直接渲染失败。

**闭坑**

- 扩展 `ImageTableModeColumns` 时，检查所有整体遍历模式对象的代码；只遍历 `all`、`face`、`normal` 列配置。运行 `imageTableColumnSettings.test.mjs` 中的模式级元数据回归测试。

**验证**

- `node --test src/views/mtk/isp6s/TablePane/imageTableColumnSettings.test.mjs`：6 项通过。
- `npm run typecheck`、`npm run build`、`git diff --check`：通过。
- Tauri 窗口中点击图片表格并确认渲染：未验证。

### 2026-10-23：规则简化与图片表格阈值统一

**亮点**

- `.codex/rules/01-人设与开发准则.md` 至 `.codex/rules/08-数据库与状态管理规范.md` 保留断言、示例和违规特征，并将长句改为编号清晰、可直接检查的规则。
- `ImageTableModeColumns.color_thresholds` 作为每种表格模式的一份共享配置；`All`、`Face`、`Normal` 共用，Tone 继续读取 `All`。

**痛点**

- 原实现把 `color_thresholds` 放在三个 scope 下，与确认的共享阈值要求不一致；旧 Node 测试也仍按每个 tab 分别断言。
- `cargo test` 未完成：正在运行的 `src-tauri/target/debug/luxe-tauri.exe` 占用文件，导致 Rust 构建无法替换可执行文件。

**闭坑**

- 修改阈值字段时同步检查 `src/types/ipc.ts`、`imageTableColumnSettings.ts`、`ColumnSettingsWindow.tsx`、`TablePane.tsx` 和 `src-tauri/src/config/state_schema.rs`。
- 规则检查必须确认 `All / Face / Normal` 不各自保存阈值，Tone 只读取 `All`。

**验证**

- `npm run typecheck`：通过。
- `npm run build`：通过。
- `node --test src/views/mtk/isp6s/TablePane/imageTableColumnSettings.test.mjs`：5 项通过。
- `git diff --check`：通过。
- `cargo test --manifest-path src-tauri/Cargo.toml state_schema`：未通过，原因是运行中的 `luxe-tauri.exe` 文件占用；之后 `cargo test --manifest-path src-tauri/Cargo.toml --lib` 通过，11 项通过、1 项忽略。
- Tauri 窗口中的阈值编辑、筛选恢复和重启恢复：未验证。

### 2026-10-22：AEGain 成对公式与新值局部着色

**亮点**

- `imageTableCustomColumns.ts` 定义 AEGain(new) 的标准来源 `=FLinkTar_old / BackTar_old(FLinkTar_new / BackTar_new)`；`ColumnSettingsWindow.tsx` 在 All、Face 中显示该来源，并允许行内保存识别。
- `TablePane.tsx` 对标准来源保持 `旧比值(新比值)` 的两位小数显示；`imageTableMetrics.ts` 分离两段显示值，只对括号内的新值按 `新值 - 旧值`、±0.05 阈值应用正红负蓝，括号和旧值继承默认文字色。

**痛点**

- 通用四则运算解析器会将 `BackTar_old(...)` 误当成函数调用；成对显示公式须仅在内置 `aeGain` 列按明确约定识别，并在表格渲染的来源覆盖分支复用现有目标比值。
- AEGain(new) 的自定义来源若只返回单个数值，则不存在括号内新值，不能应用成对差值着色。

**闭坑**

- 修改 AEGain(new) 来源时同步核对 All、Face 默认来源、保存识别、`imageColumnSourceKeys()`、来源覆盖渲染和列设置帮助文案；运行 `imageTableCustomColumns.test.mjs`。
- 修改配色时运行 `imageTableMetrics.test.mjs`，核对正负 ±0.05 的等号边界及缺值回退。

**验证**

- `npm run typecheck`、`npm run build`、24 项表格相关 Node 测试、16 份翻译 JSON 校验：通过。
- 未验证：Tauri 窗口中公式编辑与新值局部着色的人工验收。

### 2026-10-22：AEGain 差值着色与 HS Middle Corr_B2M

**亮点**

- `imageTableMetrics.ts` 从 AEGain(new) 已显示的 `旧值(新值)` 提取差值，并消除两位小数相减的浮点边界误差；着色范围后来调整为仅括号内新值，见上方记录。
- `ChartMapMode.tsx` 使用 `AE_TAG_DRV6_CORR_B2M` 统一驱动 HS Middle Area 当前坐标、插值、热力图坐标及目标计算，坐标标签同步为 `Corr_B2M`。

**痛点**

- 只修改 HS 卡片取值仍会让表格计算器缺少新字段；`TablePane.tsx` 的 `FACE_LINK_TARGET_IMAGE_KEYS` 是图片 TOML 批量加载白名单，须同时加入 `AE_TAG_DRV6_CORR_B2M`。
- `AE_TAG_DRV6_B2M` 仍属于原图片列表映射列，不应因 HS Middle Area 换源而删除。

**闭坑**

- 修改 AEGain(new) 阈值时核对两位显示值的 `新值 - 旧值`、±0.05 等号边界、缺值状态及自定义来源分支；运行 `imageTableMetrics.test.mjs`。
- 修改 HS Middle Area 坐标键时同时检查 `ChartMapMode.tsx` 的卡片、热力图和 `loadFaceLinkTargetCalculator()`，以及 `TablePane.tsx` 的 TOML 字段白名单。

**验证**

- `npm run typecheck`、`npm run build`、23 项表格相关 Node 测试、16 份翻译 JSON 校验：通过。
- 未验证：Tauri 窗口中 AEGain(new) 实际着色与 HS Middle Area 图表坐标的人工验收。

### 2026-10-22：列来源识别与 ΔEV 三段显示

**亮点**

- `ColumnEditHistoryInput.tsx` 的历史按钮使用 Fluent `Input.contentAfter`，悬浮、按下和焦点背景沿用 `columnSettings.css` 的语义化主题令牌。
- `columnEditHistory.ts` 用模式、标签页、列 ID、编辑字段组合成存储键；列标题和来源的历史及收藏互不串用。
- `imageTableCustomColumns.ts` 在行内保存时检查公式语法、函数和字段名；`ColumnSettingsWindow.tsx` 显示识别结果，语法失败时恢复原来源，并在列头问号中说明输入规则。
- `imageTableMetrics.ts` 识别 `log2(CWR_new / CWR_old)`；`TablePane.tsx` 对 ΔEV 依次显示 Normal、BackTar、FLinkTar 三组值，各保留三位并分别按 ±0.005 着色。
- 独立列设置窗口在 `columnSettingsMain.tsx` 中加载当前语言；新增提示键已写入 16 份翻译 JSON，简繁中文提供对应文案，其他语言暂用英文。

**痛点**

- 原来源历史按编辑字段全局共享，无法保证某列的下拉项只属于该列；旧的全局历史无法可靠归属到具体列，因此新键不自动迁移旧记录。
- 仅按映射配置校验字段会误拒绝图片 TOML 中真实存在的自定义字段；未配置字段现在只验证语法并明确提示实际值取决于图片 TOML。
- 独立窗口原本没有初始化 i18n；仅增加翻译键不会生效。窗口其余既有文案仍为中文，非中文语言的新增提示暂用英文。
- `sourceOverride` 会绕开内置差值格式；等价的 ∆CWR 和 ΔEV 公式必须先识别再进入分段渲染，其他覆盖公式仍走普通求值。
- 判断新建列时不能直接比较 `pending?.id === row.custom?.id`：两者同时缺失会得到 `true`，导致仅修改内置列标题也触发来源校验和来源历史记录。

**闭坑**

- 修改公式语法时运行 `imageTableCustomColumns.test.mjs`；修改三段值及阈值时运行 `imageTableMetrics.test.mjs`，核对缺值显示 `-` 和每段独立着色。
- 修改历史键时运行 `columnEditHistory.test.mjs`，核对跨列、跨标签和标签/来源字段隔离。
- 只有点击窗口“完成”才将列设置写入 TOML；行内保存只更新预览。新来源的语法识别不保证每张图片都有该字段值。

**验证**

- `npm run build`、22 项表格相关 Node 测试、16 份 JSON 的 12 个新增翻译键检查、`git diff --check`：通过。
- `npm run tauri:dev`：复用已有 Vite，Rust 开发构建完成并启动应用进程。
- 未验证：桌面窗口中实际悬浮、下拉定位、问号面板和行内保存交互的人工验收。

### 2026-10-22：AE Basic 表格列设置与差值标识

**亮点**

- `TablePane.tsx` 根据缩略图列当前显示的 All、Face、Normal 状态打开对应设置标签；已有设置窗口通过 `COLUMN_SETTINGS_SCOPE_EVENT` 切换标签，新窗口通过 URL 的 `scope` 初始化。
- `imageTableMetrics.ts` 统一 ΔEV 的三位带符号格式与两列的正负阈值；混合列表逐行选择人像或空景 CWR 计算 ΔEV。
- `ColumnEditHistoryInput.tsx` 提供与 EXIF 搜索框相近的历史、收藏和移除操作；`columnEditHistory.ts` 将列名和关键字/公式历史分别保存在 localStorage。

**痛点**

- 缩略图标题显示 All 时，内部列范围在“空景 + 未识别图片”条件下可能是 Normal；设置窗口初始化应使用用户看到的缩略图状态。
- 之前 ΔEV 始终使用人像 CWR，空景行没有取 CWR(Normal)；∆CWR 的颜色曾按绝对值大于 2 统一标红。
- 列设置中改写内置差值列的公式会走 `sourceOverride` 分支；该分支也要解析数值并应用同一格式与阈值颜色。
- 下拉层若挂在 `document.body`，会失去独立窗口 `FluentProvider` 上的主题变量；下拉层需挂在 `column-settings-theme-root` 内。

**闭坑**

- 修改缩略图分类或筛选时，核对 `columnScopeForThumbnail()` 与已有窗口的标签切换事件。
- 改动差值公式时运行 `imageTableMetrics.test.mjs`，检查 ±0.005、±5 的边界以及混合列表逐行取值。
- 历史项只在保存编辑后记录实际改动；收藏、移除和独立字段持久化由 `columnEditHistory.test.mjs` 核对。

**验证**

- `npm run build`、`git diff --check`、表格列设置与历史相关 Node 测试：通过。
- `npm run tauri:dev`：复用现有 Vite 服务，Rust 开发构建完成并启动 `target/debug/luxe-tauri.exe`。
- 未验证：在桌面窗口中手动点击 All/Face/Normal、编辑历史下拉框和深浅主题视觉效果。

### 2026-10-22：Tauri 开发端口复用

**亮点**

- `src-tauri/tauri.conf.json` 的 `beforeDevCommand` 改由 `scripts/start-tauri-vite.mjs` 启动：端口 1420 空闲时启动 Vite，已有本项目 Vite 时复用，其他服务占用时报明原因。
- `scripts/start-tauri-vite.test.mjs` 用本地 HTTP 服务验证空闲、复用和冲突分支。

**痛点**

- Vite `strictPort: true` 与 Tauri `devUrl` 都锁定 1420；已有开发服务时重复执行 `npm run dev` 会报 `Port 1420 is already in use`。
- Vite 返回的入口路径可能带 `?t=` 时间戳；按原始 `index.html` 的完整脚本标签匹配会误判已有开发服务。

**闭坑**

- 调整开发端口时同时核对 `vite.config.ts` 的 `server.port`、`src-tauri/tauri.conf.json` 的 `devUrl` 和 `scripts/start-tauri-vite.mjs` 的探测地址。
- 验证服务复用时检查 Vite 实际返回的 HTML；不要只依据 `index.html` 源文件断言。

**验证**

- `node --test scripts/start-tauri-vite.test.mjs`：3 项通过；`npm run typecheck`、`git diff --check`：通过。
- 已有本项目 Vite 占用 1420 时，`npm run tauri:dev` 输出“复用现有开发服务器”，Rust 开发构建完成并运行 `target/debug/luxe-tauri.exe`。
- 未验证：端口空闲时的完整 Tauri 窗口启动；未手动验收窗口交互。

### 2026-10-22：独立表格列设置窗口

**亮点**

- 表格列设置使用独立 Tauri 窗口。打开入口在 src/views/mtk/isp6s/TablePane/TablePane.tsx，窗口组件在同目录的 ColumnSettingsWindow.tsx。
- 窗口位置基于当前显示器计算，定位逻辑在 columnSettingsPlacement.ts。
- isp6s 与 tone 的列设置写入 image_table_columns 不同分支；isp6s 的 All、Face、Normal 列状态独立保存。
- 表头和数据行共用 .column-settings-grid；控制列统一居中，减少滚动条出现后的列中心偏移。

**痛点**

- 表头位于滚动容器外、列表另有右侧内边距时，滚动条会使表头与数据列横向错位。
- ToneMap 只使用 all scope，复用带 Face、Normal 标签的窗口会暴露不适用的设置。
- 若关闭窗口前未等待 flushStateNow()，最近修改存在尚未落盘的风险；此处是由保存流程识别的风险，不代表已复现数据丢失。

**闭坑**

- 修改列布局时同时检查表头、数据行、滚动条和边框宽度。
- mode=tone 时隐藏 All、Face、Normal 标签，但仍读取和保存 tone.all。
- 等待 saveImageTableMode() 和 flushStateNow() 完成后再关闭窗口。

**验证**

- 对应改动曾通过 npm run typecheck、npm run build、git diff --check；未在本次文档改动中重新执行 Tauri 窗口验收。

### 2026-10-22：更新链路与 Star 构建

**亮点**

- src-tauri/tauri.conf.json 的更新端点和 scripts/prepare-release.mjs 生成的安装包地址使用 gh-proxy.com。
- .github/workflows/star-release.yml 限制仓库所有者的 Star 事件触发发布，并处理已签名更新资产。

**痛点**

- latest.json、NSIS 包、签名文件与 Release 资产必须一致；只改客户端端点不能修复清单里的安装包地址。
- Star 是公开事件，发布权限和签名密钥不能暴露给任意触发者。

**闭坑**

- 更新改动核对 src/services/updateCheck.ts、src-tauri/tauri.conf.json、scripts/prepare-release.mjs 和发布工作流。
- 修改清单生成逻辑后运行 npm run release:test，并确认签名文件存在。

**验证**

- 本次只核对代码和现有测试入口；未重新运行发布测试或执行真实安装升级。

### 2026-10-22：图片与解析性能边界

**亮点**

- 前端统一通过 src/ipc/memory.ts 的 trimMemory() 触发清理；Rust 回收入口位于 src-tauri/src/memory_trim.rs。
- 图片列表和字段缓存已有预算；异步请求需隔离过期结果。

**痛点**

- 任务管理器的应用汇总值不能区分 Tauri 宿主、WebView2 browser、renderer 和 GPU 进程。
- 虚拟列表不能修复 React 渲染反馈循环，须先定位持续提交、布局或绘制的来源。

**闭坑**

- 新增缓存说明容量、淘汰条件和清理入口；卸载时释放 Blob URL、Canvas 与观察器。
- 性能结论使用相同构建模式和数据集的分进程采样，参照 docs/performance/MEMORY_RECOVERY.md。

**验证**

- 本次为既有维护约定的归档；未进行新的性能采样。

### 2026-10-22：项目规范接入

**亮点**

- 根目录 AGENTS.md 作为后续修改的统一入口，按改动范围指向 .codex/rules/ 的八份规则。
- 本账本记录实现亮点、实际痛点与闭坑条件，docs/README.md 提供固定索引。

**痛点**

- 原 AGENTS.md 只有项目概况与通用约定，未将具体规则文件映射到改动类型，也没有持续记录可复用经验的位置。
- 规则中的版本号会随依赖升级过期，需要同时核对 package-lock.json、Cargo.lock 和规范文档。

**闭坑**

- 修改代码前先读 AGENTS.md 和相关规则；若断言与代码冲突，在同一改动中核对并修正规则。
- 只记录实际发生的行为和验证结果；未实测的窗口或性能行为必须明确标注。

**验证**

- 已检查规则文件存在、AGENTS.md 与 docs/README.md 的指向；运行 git diff --check 通过。

### 2026-10-22：表格列置顶与实时预览

**亮点**

- src/views/mtk/isp6s/TablePane/ColumnSettingsWindow.tsx 用 Fluent Pin 图标标识置顶状态；新置顶列追加到已置顶列之后，拖拽调整分组内顺序。
- image_table_columns 的每个 scope 新增 pinned 列表，Rust 以 serde 默认值兼容旧 TOML；主表格固定 idx、缩略图和文件名列仍保留在左侧。
- 设置窗口通过预览事件即时更新主表格；关闭未保存窗口时从已落盘配置恢复，完成后再关闭窗口。

**痛点**

- 前端热更新不会重建正在运行的 Tauri 宿主。当前源码已注册 save_image_table_mode，但旧宿主仍会返回 Command not found；本地运行的 luxe-tauri.exe 也会锁住完整 Rust 测试要替换的可执行文件。
- 使用旧宿主的通用 save_state_section 命令作回退有静默丢失新 pinned 字段的风险，因此保存失败应提示完整重启开发应用。

**闭坑**

- 新增 Tauri 命令或 capability 后，必须完全退出并重新运行 npm run tauri:dev；只刷新 WebView 不足以更新 Rust 命令。
- 预览、保存、取消需使用不同事件；未保存关闭恢复 TOML，已保存关闭保留主表格状态。
- 置顶排序只作用于可调整业务列，不得将列移到 idx、缩略图和文件名固定列之前。

**验证**

- npm run typecheck、npm run build、Node 列设置测试、npm run release:test 与 cargo test --manifest-path src-tauri/Cargo.toml --lib 已通过。
- 完整 npm run rust:test 因正在运行的 src-tauri/target/debug/luxe-tauri.exe 被系统占用而未通过；未执行 Tauri 窗口人工验收。

### 2026-10-23：标题栏更新预览与进度同步

**亮点**

- `src/data/changelog.json` 继续作为开发者维护版本内容的唯一文件；发布脚本将其写入 `latest.json`，`src/services/updateNotes.ts` 将本地条目或远端说明整理为标题栏预览。
- `src/components/shell/TitleBar.tsx` 的预览可直接调用 `installAvailableUpdate()`；标题栏与 `src/views/HomeView.tsx` 读取同一 `updateStore` 进度，手动检查统一走 `runUpdateCheck()`。

**痛点**

- 旧预览只截取更新说明前四行，按钮会跳转主页；远端新版本的内容不一定存在于已安装包的本地 JSON，需要读取 updater 返回的发布说明。
- 手动重查若在关闭旧 updater 句柄后才标记 `checking`，同时点击两个入口可能发起重复检查。

**闭坑**

- 下一版发布前在 `src/data/changelog.json` 新增对应版本条目，并运行 `npm run release:test`；不得另建标题栏专用说明文件。
- 更新检查先切换共享状态再关闭旧句柄；下载与安装必须继续通过 Tauri updater 执行，不能绕过签名校验。

**验证**

- `npm run typecheck`、`npm run build`、`npm run release:test` 均通过；`git diff --check` 通过。
- `npm run tauri:dev` 启动了 Vite，但 Rust 无法替换被现有 `luxe-tauri.exe` 占用的调试可执行文件，命令以错误码 1 退出；未在真实 Tauri 窗口完成悬浮、按钮焦点和下载进度人工验收，也未执行实际更新安装。

### 2026-10-23：更新记录改为逐条内容

**亮点**

- `src/data/changelog.json` 的 14 个版本、53 条记录改为每条只维护 `type` 和 `content`；`UpdateNoteList` 让标题栏与近期更新弹窗共用类别标签和正文排版。
- `scripts/release-notes.mjs` 直接生成逐条带类别的发布说明，远端更新预览通过 `src/services/updateNotes.ts` 读取；旧版分组发布说明仍可解析。

**痛点**

- 旧格式的 `sections/title/desc` 使一条更新要维护多个标题层级；发布脚本、测试和两个界面都依赖该结构，迁移时必须一起更新。
- 编辑期间近期更新弹窗出现了新的未提交布局改动；保留该布局并接入新列表组件。

**闭坑**

- 新版本在 `changelog.json` 顶部新增版本对象；每条 `items` 只写 `type` 和完整的 `content`，类别限定为新增、优化、修复。
- 修改记录格式时运行 `npm run release:test`，核对 `latest.json` 中每条内容与应用内显示的数据一致。

**验证**

- 已核对迁移前后均为 14 个版本、53 条记录；`npm run typecheck`、`npm run build`、`npm run release:test`、`git diff --check` 均通过。
- 本次未在 Tauri 窗口中人工检查更新弹窗及标题栏预览，也未执行真实安装更新。

### 2026-10-23：近期更新列表与覆盖入口清理

**亮点**

- `src/components/common/UpdateLogDialog.tsx` 按版本展示无卡片列表，复用 `UpdateNoteList` 显示每条记录的类别标签和正文；所有版本在弹窗内直接滚动查看。
- `src/views/HomeView.tsx` 移除“覆盖更新”按钮、确认弹窗与对应处理函数，保留正常的检查和安装入口。

**痛点**

- 旧弹窗按分类嵌套卡片和标题，与逐条维护的 `type`、`content` 数据格式不一致；覆盖更新还维护了独立确认状态。

**闭坑**

- 更新列表与标题栏预览统一使用 `UpdateNoteList`；移除入口时同时删除相关状态、处理函数和确认弹窗，并搜索残留引用。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 通过；`rg` 搜索未发现“覆盖更新”相关代码残留。
- 未在 Tauri 窗口实测弹窗滚动、深浅主题和窄窗口布局。

### 2026-10-23：更新状态分隔与弹窗背景透出

**亮点**

- `src/views/HomeView.tsx` 将检查结果移到独立通栏区域，上下均由主题边框分隔；`src/components/common/UpdateLogDialog.tsx` 将近期更新弹窗宽度限制为 640px。
- `src/styles/globals.css` 降低更新弹窗遮罩不透明度并去掉模糊，打开时仍可辨认后方主界面。

**痛点**

- 原检查结果放在版本信息容器内，无法用通栏边框对齐下方操作区；原遮罩在浅色模式下不透明度为 0.54 且模糊 8px。

**闭坑**

- 需要全宽分隔线时，将状态行放在卡片主行之外；弹窗遮罩使用局部 `.luxe-update-log-backdrop` 样式，避免影响其他对话框。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 通过；未在新构建的 Tauri 窗口中实测弹窗透明度和窄窗口布局。

### 2026-10-23：主页版本号提示

**亮点**

- `src/views/HomeView.tsx` 将“关于”区域的版本号单独以等宽数字样式显示，悬浮和键盘聚焦时提供轻微位移、主题色高亮与 Fluent 提示。
- `src-tauri/resources/translations/` 的 16 份语言资源统一提供含版本号的“当前版本”提示。

**痛点**

- 原版本号与“版本”标签共用一段灰色文字，缺少可辨识的层级和当前版本提示。

**闭坑**

- 数字版本使用 `CURRENT_VERSION` 单一来源；提示文案通过 i18n 插值，不在视图中拼接固定语言字符串。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 通过；16 份翻译 JSON 均可解析且包含插值键。
- 未在新构建的 Tauri 窗口中实测悬浮动画、提示位置及键盘焦点。

### 2026-10-23：开发窗口白屏与单实例启动

**亮点**

- `src-tauri/src/lib.rs` 仅在正式构建启用单实例插件；开发构建再次启动时可以保留新进程及其 Vite 服务。

**痛点**

- 已运行的开发进程仍持有旧 WebView；再次执行 `tauri dev` 时，新进程被单实例插件结束，CLI 随之退出，旧窗口无法从此前的页面加载失败中恢复。
- 现有 `luxe-tauri.exe` 占用调试可执行文件，完整 `npm run rust:test` 无法替换该文件；全仓库 `cargo fmt --check` 报告了大量既有格式差异。

**闭坑**

- 开发白屏先检查 `localhost:1420`、旧 `luxe-tauri.exe` 和 Vite 模块响应；修改 Rust 后先正常关闭旧开发进程，再启动新构建，避免 Windows 文件占用。
- 多个开发实例会访问同一份本地状态，调试完成后关闭多余窗口；正式构建仍保持单实例。

**验证**

- `npm run typecheck`、`npm run build`、`npm run rust:test`、`git diff --check` 通过；Rust 测试有 2 项按原设置忽略。
- `npm run tauri:dev` 已成功编译，Vite 的入口和主页模块均返回 HTTP 200；第二次启动时两个开发实例均保持运行，未被单实例回调退出。未目视核对窗口画面。
- 首次运行 `npm run rust:test` 时旧进程占用 `target/debug/luxe-tauri.exe`；旧进程退出后重跑通过。`cargo fmt --check` 报告既有全仓库格式差异，未执行全仓库格式化。

### 2026-10-23：开发地址 IPv4/IPv6 对齐与白屏排查

**亮点**

- `src-tauri/tauri.conf.json`、`vite.config.ts` 与 `scripts/start-tauri-vite.mjs` 统一使用 `127.0.0.1:1420`；`scripts/start-tauri-vite.test.mjs` 检查三处地址契约。
- `index.html` 在 React 首次渲染前显示加载状态；`src-tauri/src/lib.rs` 在开发窗口持续隐藏时记录当前 URL 并显示窗口，便于定位启动失败。

**痛点**

- 旧配置以 `localhost` 连接，但实测 Vite 只在 `[::1]:1420` 响应，`127.0.0.1:1420` 拒绝连接；此前仅检查 `localhost` 的 HTTP 200，不能证明 WebView2 选择的地址可用。
- WebView2 共享用户数据目录时曾报 `0x800700AA` 资源占用；该错误发生于调试端口实验，不能直接归为原白屏根因。

**闭坑**

- 开发白屏时分别检查 `127.0.0.1:1420`、`[::1]:1420` 与 Tauri 的 `devUrl`，并以同一显式地址配置 Vite 监听和启动探测。
- Rust 侧的开发兜底日志只用于暴露未完成的前端启动；不可将 HTTP 200 或编译通过视为 WebView 画面验收。

**验证**

- `node --test scripts/start-tauri-vite.test.mjs`（4 项通过）、`npm run typecheck`、`npm run build`、`cargo test --manifest-path src-tauri/Cargo.toml --lib`（13 项通过、1 项忽略）及 `git diff --check` 通过；修改后 `http://127.0.0.1:1420` 返回 HTTP 200。
- `npm run tauri:dev` 编译并启动了调试进程；当时未能读取 WebView 画面，后续确认白屏仍存在，根因见下条。

### 2026-10-23：Fluent Tooltip 门户覆盖主界面

**亮点**

- `src/App.tsx` 与 `src/columnSettingsMain.tsx` 的根 `FluentProvider` 设置 `applyStylesToPortals={false}`，让 Tooltip、Dialog 等门户继承主题变量，但不复制根容器的 `h-full` 与背景样式。
- `index.html` 引用现有的 `src/assets/luxe-logo.png` 作为网页图标，消除开发服务器的 `/favicon.ico` 404。

**痛点**

- FluentProvider 默认将根节点完整类名复制到 `body` 下的 `data-portal-node`。版本号 Tooltip 打开时，门户同时获得 `h-full`、白色主题背景和 `z-index: 1000000`，以 796×624 的白色层覆盖了实际已渲染的首页。
- React Router future flag、React DevTools 和 Tauri 热重载 callback 提示均未导致此次白屏；仅凭控制台消息无法定位覆盖层。

**闭坑**

- 根 FluentProvider 使用填满窗口的布局类时，必须检查门户是否继承该类；白屏但无渲染异常时，先对比 `#root.innerText`、`document.elementsFromPoint()` 和 `[data-portal-node]` 的尺寸及背景。
- 不要将开发地址可达或构建通过当作界面可见的证明；需要检查实际 WebView DOM 与覆盖层。

**验证**

- 在现有 Tauri 开发窗口临时采样：修复前 `#root` 已含完整首页内容，Tooltip 门户为 796×624、白色背景且位于最上层；修复后门户为 796×0、透明背景，窗口中心重新命中首页按钮。采样代码与本地监听器已移除。
- `npm run typecheck`、`npm run build` 通过；构建后的 `dist/index.html` 引用了打包后的 PNG 图标。未在全新启动的 Tauri 进程中目视验收。

### 2026-10-24：bcompare 表格铺满与跨 AE/Tone 图片选择同步

**亮点**

- `src/views/mtk/isp6s/ImagePane/ParaCheckMode.tsx` 移除详情页上下内边距，bcompare 卡片顶部改为直角；数据行使用主题背景交替显示，图片 3A 与参数文件列保持同一行色带。
- `src/stores/mtkStore.ts` 增加按工作区的临时图片选中路径；`src/stores/isp6sVisualStore.ts` 提供同步开关。开启时 AE Basic/ToneMap 互相传播选中路径，关闭时各自保留选中项和对应 TOML 数据。
- `src/views/mtk/isp6s/TablePane/TablePane.tsx` 在图片列表标题栏提供链路图标按钮，并通过 `aria-pressed`、标题和禁用链路图标表达当前状态。

**痛点**

- 两个页面原先共用 `imageDir.current` 和 `imageDir.tomlData`，无法在关闭同步后保留两个不同的当前图片；只增加按钮而不拆分工作区选中态会导致页面仍互相覆盖。

**闭坑**

- 共享目录和扫描结果继续复用，当前图片通过 `imageSelection[ISP6S|tab]` 隔离；切换独立选中项时重新读取该图片 TOML，避免右侧参数卡片显示另一页面的数据。
- 同步开关只影响 ISP6S 的 AE Basic/ToneMap，不改变图片目录持久化和现有热力图多选集合。

**验证**

- `npm run typecheck` 通过。
- `node --test src/views/mtk/isp6s/TablePane/*.test.mjs` 通过（27 项）。
- `git diff --check` 通过；未在 Tauri 窗口中手动验收 bcompare 角位、行色带及开关跨页面点击效果。

### 2026-10-24：跨 AE/Tone 图片选中行恢复

**亮点**

- `Isp6sAeVisual.tsx` 以 `imageSelection[ISP6S|tab]` 为选中路径来源；`workspaceSession.ts` 额外记录滚动位置对应的图片路径。进入另一页面时，若同步后的图片与旧滚动位置不匹配，表格定位到新选中行。
- `TablePane.tsx` 在当前图片索引变化后解除旧滚动位置保护，让虚拟列表把新选中行滚入可见区域。

**痛点**

- 原恢复逻辑在页面重挂载时调用 `onPickImage`，将旧 `session.imagePath` 写回共享选中态；即使路径已同步，虚拟列表仍可能恢复旧滚动位置，选中行处于可视区域外。

**闭坑**

- 恢复页面时先匹配工作区选中路径；滚动位置只有在对应同一张图片时才能复用。切换图片目录时同时清除旧滚动路径，避免跨目录定位错误。

**验证**

- `npm run typecheck`、`npm run build`、`node --test src/views/mtk/isp6s/TablePane/*.test.mjs`（27 项）和 `git diff --check` 通过。
- 未在 Tauri 窗口中手动验证跨页面选中、筛选状态和长列表滚动效果。

### 2026-10-24：AE Basic 与 ToneMap 图片列表滚动同步

**亮点**

- `src/views/mtk/isp6s/Isp6sAeVisual.tsx` 在选中图片、开启同步和列表滚动时，把当前表格的纵向与横向位置写入另一工作区的 `workspaceSession`；切页时沿用已有的滚动恢复入口。

**痛点**

- 此前只同步了选中路径，目标页仍使用自己的旧滚动位置；即使目标行已选中，两页看到的列表区域也可能不同。

**闭坑**

- 只在同步开关开启且目标工作区选中同一图片时传播后续滚动；关闭开关后，各页继续维护独立滚动位置。跨页滚动快照同时绑定图片路径和目录，避免复用旧图片的偏移量。

**验证**

- `npm run typecheck`、`npm run build`、`node --test src/views/mtk/isp6s/TablePane/*.test.mjs`（27 项）和 `git diff --check` 通过。
- 未在 Tauri 窗口中手动验证长列表、不同筛选和横向滚动的跨页效果。

### 2026-10-24：bcompare 标题栏与表格边框对齐

**亮点**

- `src/views/mtk/isp6s/ImagePane/ParaCheckMode.tsx` 将 AE.CPP 标题栏改为与 EXIF 搜索栏相同的 `var(--colorNeutralBackground1)`，高度由 36px 调整为 32px；保存按钮改用 Fluent UI 的紧凑图标按钮，保留未保存标记和禁用状态。
- bcompare 表格补齐上、左外沿，右、下外沿继续由单元格边框组成；详情面板在 bcompare 模式下启用底部圆角，子内容以 7px 圆角贴合父面板的 8px 圆角。
- 保存按钮调整为 32×32px，与详情标题栏右侧的隐藏按钮共用 32px 高度和 8px 右侧留白，两者中心落在同一竖线上。

**痛点**

- 原标题栏使用混合品牌色，且保存按钮自绘边框占据较多高度；表格只绘制单元格右、下边线，外沿依赖另一层卡片边框，底部角位与详情面板的直角不一致。
- 紧凑保存按钮原为 28px，隐藏按钮为 32px；即使两栏右侧留白相同，按钮中心仍有 2px 横向偏差。

**闭坑**

- 表格外沿与单元格线分别由表格上/左边框、单元格右/下边框负责；父面板负责最外层圆角与裁切，避免在 bcompare 子卡片重复绘制一圈边框。
- 上下标题栏的图标按钮对齐时，同时核对按钮宽度与容器右侧留白；只比较图标本身的尺寸不足以判断中心是否对齐。

**验证**

- `npm run typecheck`、`npm run build` 和 `git diff --check` 通过。
- 保存按钮对齐调整后重新运行 `npm run typecheck`，通过。
- 未在 Tauri 窗口中目视检查深浅主题、保存按钮悬浮态和底部圆角。

### 2026-10-24：ToneMap 独立导入 CA-LTM.cpp

**亮点**

- `IspSelectBar.tsx` 在 ISP6S ToneMap 右侧路径槽选择或拖入 CA-LTM.cpp；AE Basic 的 DP 解析工具入口保持可用。
- `MtkView.tsx` 复用 `cpp_paths` 的独立键 `ISP6S|CA-LTM` 和现有 CPP 解析流程；`ToneChartMapMode.tsx` 根据该文件的解析树分组显示字段。

**痛点**

- CA-LTM 标签此前从 Tone.cpp 中寻找注释，无法读取独立文件；直接复用 Tone.cpp 的源码跳转会使用错误的行号和文件。
- 当前仓库没有 CA-LTM.cpp 样本，无法核对具体参数结构与展示名称。

**闭坑**

- CA-LTM 字段与 Tone.cpp 其他标签的数据分开；独立文件中的字段不提供指向 Tone.cpp 的源码跳转。文件未导入、解析中及解析失败时分别显示状态。
- 新路径仍由现有 `cpp_paths` 持久化，旧 TOML 缺少该键时按未导入处理。

**验证**

- `npm run typecheck` 通过；持久化测试加入独立键。其余构建与测试结果见本次交付说明。
- 未在 Tauri 窗口中手动验证文件选择、拖入、重启恢复和 CA-LTM 参数展示。

### 2026-10-24：源码路径栏显示文件名与 CA-LTM 源码映射

**亮点**

- `ParamMapMode.tsx` 的路径栏在压缩目录后固定显示当前参数文件名，悬浮可查看完整路径。
- `ImagePane.tsx` 以同一套草稿处理逻辑分别维护 Tone.cpp 与 CA-LTM.cpp；ToneMap 的 CA-LTM 标签切换到 CA-LTM.cpp 源码映射，其余标签继续使用 Tone.cpp。
- `ToneChartMapMode.tsx` 的 CA-LTM 参数段和字段恢复源码跳转，跳转目标随标签指向 CA-LTM.cpp。

**痛点**

- 原路径栏只取目录片段，文件名被丢弃；原源码映射始终使用 Tone.cpp，即使 CA-LTM 标签展示了独立文件的解析结果，跳转行号也会落在错误文件。

**闭坑**

- 源码草稿、临时解析文件、撤销重做和保存操作按实际文件隔离；AE Basic 的 bcompare 仍绑定原有 AE.cpp 草稿。
- 跨文件跳转携带目标路径，旧标签的跳转范围不会应用到另一份源码。

**验证**

- `npm run typecheck`、`npm run build` 和 `git diff --check` 通过。
- 未在 Tauri 窗口中手动验证窄窗口路径显示、CA-LTM 跳转定位和两个文件的实际保存。

### 2026-10-24：ToneMap LCE 表格与 Ratio LV 表头

**亮点**

- `src/views/mtk/isp6s/ImagePane/ToneChartMapMode.tsx` 的 Ratio 横轴按 `LV(Base10)` 第一行当前值除以 10 显示；参数草稿修改该行时，表头随显示值更新。
- LCE 的 Ratio、Target、Prob、Strength 和 Face 网格统一使用主题表头、单层表格边线与轻量选中态；Ratio 网格行在与 Cal 并排时填满卡片高度。

**痛点**

- Ratio 横轴先前使用列索引，`30/50/80/120` 错标为 `LV0/LV1/LV2/LV3`；Ratio 外层虽拉伸，内部网格仍为固定高度，底部留下空白。

**闭坑**

- 插值仍使用源码的 `LV(Base10)` 原值与图片 LV 比较，仅表头除以 10；不得把显示单位写回参数或用于插值。
- 表头和数据列共用同一网格；Ratio 只在填充模式下按卡片可用高度分配数据行。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 通过。
- 未在 Tauri 窗口中目视验证不同窗口宽度和深浅主题下的 Ratio 高度与 LV 表头。

### 2026-10-24：ToneMap LCE 卡片与表格对齐 FDTH 样式

**亮点**

- `src/views/mtk/isp6s/ImagePane/ToneChartMapMode.tsx` 集中定义 LCE 卡片、标题栏和网格配色，沿用 AE Basic FDTH 所用的语义令牌；Target、Prob、Strength、Face 与 Cal 保持一致。
- LCE 网格使用与 FDTH 相同的浅绿轴表头、外框和高亮交叉单元格样式，原有参数编辑、保存、热力图和源码跳转仍由原组件处理。

**痛点**

- LCE 原有表头为中性灰色且边框较轻，与同项目 FDTH 的卡片层级、轴表头和网格外框不一致；深浅主题需要复用现有变量，不能固定截图中的 RGB 色值。

**闭坑**

- 修改 LCE 网格视觉样式时检查 `src/styles/globals.css` 的 `--hs-weight-bv-bg`、`--normal-sheet-palegreen-fg` 和 `--normal-sheet-line`，同时核对浅色和深色主题。
- 保持 Ratio 表头显示值与插值输入分离；网格标题和数据行继续共用一个 CSS Grid，避免横向滚动时错列。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 均通过。
- 尚未在 Tauri 窗口目视检查窄窗口和深浅主题。

### 2026-10-24：LCE 普通选中态不显示黑色描边

**亮点**

- `ToneNumberCell` 仅在开启热力图时对命中单元格显示内阴影边框；普通模式继续通过背景色和文字色标识选中项。

**痛点**

- FDTH 样式同步后，LCE 单元格无条件显示黑色边框，普通模式下视觉过重。

**闭坑**

- 调整 LCE 选中样式时区分 `heat` 是否存在，避免热力图的命中边框泄漏到普通模式。

**验证**

- `npm run typecheck`、`git diff --check` 均通过。
- 未在 Tauri 窗口目视验证两种模式。

### 2026-10-24：笛卡尔热力图命中描边跟随主题

**亮点**

- `ChartMapMode.tsx` 的 Face/Face_FLT 与 HS Area 共用热力图样式、`ToneChartMapMode.tsx` 的 LCE 命中样式统一以 `--colorBrandStroke1` 绘制选中描边，随当前主题变化。

**痛点**

- 命中描边原先使用 `--colorNeutralForeground1`，在浅色主题中接近黑色，压过热力图色阶。

**闭坑**

- 更改笛卡尔热力图选中态时同时核对 `faceBvDrHeatCellStyle` 和 `ToneNumberCell`；LCE 普通模式仍不得显示命中描边。

**验证**

- `npm run typecheck`、`git diff --check` 均通过。
- 未在 Tauri 窗口核对浅色和深色主题下的命中描边。

### 2026-10-24：v0.2.10 发布

**亮点**

- 从 `v0.2.8..HEAD` 的历史提交整理 `src/data/changelog.json` 首条内容，并以 `src-tauri/tauri.conf.json` 为版本源同步 npm 和 Cargo 元数据。
- `v0.2.10` 标签触发 `.github/workflows/release.yml`，由 CI 检查签名、构建 NSIS/MSI、生成 `latest.json` 并发布。

**痛点**

- 本机缺少 `gh` 命令；发布是否完成必须以 GitHub Actions 运行结果及公开 Release 资产为准，不能以标签推送成功代替。

**闭坑**

- 标签前核对 `npm run version:check`、`npm run release:test`、变更日志版本与工作区状态；标签后核对工作流、五个资产及更新清单版本。

**验证**

- `npm run version:check`、`npm run release:test`（27 项）、`npm run build`、`cargo test --locked --manifest-path src-tauri/Cargo.toml --lib`（13 项通过、1 项忽略）和 `git diff --check` 均通过。
- 本机完整 `cargo test --locked --manifest-path src-tauri/Cargo.toml` 因运行中的 `src-tauri/target/debug/luxe-tauri.exe` 被占用而无法替换可执行文件；GitHub Actions 将在独立环境重新运行。
- GitHub Actions `Publish Windows release`（run 40085363348）成功；公开的 `v0.2.10` Release 包含 NSIS、`.sig`、MSI、`latest.json` 和 `SHA256SUMS.txt` 五项资产。
- 发布工作流完成了独立环境的完整 Rust 测试与安装包校验；本机未执行真实安装升级。

### 2026-10-26：LCE 表格居中与源码路径层级

**亮点**

- `ToneChartMapMode.tsx` 的 LCE 数值输入格、行标签和横轴表头统一居中，Ratio、Target、Prob、Strength 和 Face 共用该样式。
- `ParamMapMode.tsx` 的共用源码路径栏移除整栏原生悬浮提示，保留完整路径的无障碍名称；将直接父文件夹加粗，并为路径使用 Cascadia Code/Consolas 等宽字体栈。

**痛点**

- 原路径栏只有一段可截断的目录文字，无法突出最接近文件的文件夹；整栏 `title` 会在鼠标悬浮时遮挡源码区域。

**闭坑**

- 更改源码映射路径栏时检查 AE Basic、ToneMap 和 CA-LTM 共用的 `SourcePathBreadcrumb`，并核对较长路径下父目录与文件名的截断。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 均通过。
- 未在 Tauri 窗口目视核对窄窗口下的路径截断与 LCE 表格对齐。

### 2026-10-26：Face_LCE 补齐 L0 数据行

**亮点**

- `src/views/mtk/isp6s/ImagePane/ToneChartMapMode.tsx` 将 `Face_LCE` 的行路径扩展为 `[0][0][0][4][0]` 至 `[0][0][0][4][15]`，L0 通过现有字段提取、编辑、保存、热力图和源码跳转链路读取 `.0` 至 `.18` 数值。
- 原 L1 的说明提示继续关联 L1；`src-tauri/tests/tone_cpp_paths.rs` 对可用的真实 TONE.cpp 样本增加 L0 的 19 列断言。

**痛点**

- 原路径列表从 `[4][1]` 开始，导致 L0 被整体遗漏；行名和第一行说明提示均依赖列表索引，增加首行时需要同步调整。

**闭坑**

- 新增 LCE 行时核对路径、行名、说明提示与解析字段数是否一一对应；L0 的 19 个字段仍由同一表格网格显示，不另建数据副本。

**验证**

- `npm run typecheck`、`npm run build` 和 `git diff --check` 均通过。
- `cargo test --locked --manifest-path src-tauri/Cargo.toml --test tone_cpp_paths` 因运行中的 `src-tauri/target/debug/luxe-tauri.exe` 被占用，在编译阶段报“拒绝访问 (os error 5)”，未执行到测试；没有结束正在运行的程序。
- 项目根目录没有 `TONE.cpp` 样本，无法核验真实 L0 的 19 列数据；未在 Tauri 窗口目视核对表格效果。

### 2026-10-26：Face_LCE L0 独立列结构

**亮点**

- `src/views/mtk/isp6s/ImagePane/ToneChartMapMode.tsx` 将 L0 单独显示为两组 `LV0、LV2、...、LV16` 与末尾 `rsv`；列值按 `[0][0][0][4][0].0` 至 `.18` 精确匹配，缺失字段不会使后续列错位。
- L0 的热力图按步长为 2 的 LV 列同时映射到两组，`rsv` 始终显示源码值；L1-L15 继续使用原有 LV0-LV18 表格与命中逻辑。Face_LCE 的保存及源码跳转仍覆盖全部行。

**痛点**

- L0 虽有 19 个字段，但字段含义不是连续的 19 个 LV；直接复用普通行表头会错标第二组和 `rsv`。

**闭坑**

- 后续调整 Face_LCE 时分别核对 L0 的 `.0-.8`、`.9-.17`、`.18` 和普通行的 LV0-LV18；保存按钮的脏状态必须包含 L0。

**验证**

- `npm run typecheck`、`npm run build` 和 `git diff --check` 均通过。
- 项目根目录没有 `TONE.cpp` 样本，未核验真实数值或 Tauri 窗口显示。

### 2026-10-27：Face_FLT EXIF 权重来源与 Cal_FLT 对齐

**亮点**

- `ChartMapMode.tsx` 的 FDSZ_RA 标题栏提供来源切换按钮；EXIF 公式可选图片关键字 `AE_TAG_FLT_FDSZ_RA` 或源码表格的参数插值，选择通过 `isp6s_ae_visual.chart_face_flt_exif_use_parameter_fdsz_ra` 保存。
- `TablePane.tsx` 为所有图片使用同一来源选择重新计算 Face Link Target EXIF 值；切换会更新计算器标识，使列表派生结果及列宽缓存重新计算。`src-tauri/resources/face_table.toml` 的 `Cal_FLT` 改为 `FLT.Link_FACE_CWR`。

**痛点**

- 原 EXIF 权重直接取图片关键字，参数计算权重来自源码表格，两者不同但界面未提供来源选择；若只改当前卡片，图片列表仍会按旧来源计算。

**闭坑**

- 后续调整 FDSZ_RA 时检查当前卡片、`loadFaceLinkTargetCalculator`、列表的批量与可见行计算；仅 EXIF 权重应受来源选择影响，参数插值仍使用源码表格结果。旧 `state.toml` 缺少新字段时默认使用图片关键字。

**验证**

- `npm run typecheck`、`npm run build` 通过；`cargo test --locked --manifest-path src-tauri/Cargo.toml --lib` 通过（15 项通过、1 项忽略），覆盖状态默认值与回读，以及 `Cal_FLT` 公式来源。
- `npm run rust:test` 未通过：集成测试编译遇到 Windows 页文件不足（os error 1455），随后运行中的 `luxe-tauri.exe` 被占用，无法替换（os error 5）；未结束用户程序。
- 16 份语言 JSON 均能解析，新增文案键均存在；未在 Tauri 窗口目视验证按钮与图片列表交互。

### 2026-10-27：Face_LCE L0 与普通行对齐

**亮点**

- `src/views/mtk/isp6s/ImagePane/ToneChartMapMode.tsx` 将 `i4LCEfaceTbL0` 放到跨三行的左侧标签单元格；L0 与 L1-L15 共用 `128px + 19` 列的网格宽度，保留两组 LV 标题与 `rsv` 列。

**痛点**

- L0 原先使用单独的行名条和 19 等分列，下方表格另有 128px 标签列，导致列边界无法对齐。

**闭坑**

- 调整 L0 样式时检查首列宽度、三行合并位置和各组 9/9/1 列排列；字段路径 `[0][0][0][4][0].0` 至 `.18`、LV 命中与插值逻辑不得随布局变更。

**验证**

- `npm run typecheck`、`npm run build` 和 `git diff --check` 均通过；尚未在 Tauri 窗口目视核对布局。

### 2026-10-27：列设置规则定位与多字段来源

**亮点**

- `ColumnSettingsWindow.tsx` 打开规则详情时将列表滚动容器定位到顶部；规则区补充多个 TOML 字段的显示与计算示例。
- `imageTableCustomColumns.ts` 增加 `=join(字段1, 字段2)` 与 `=list(字段1, 字段2)`：前者用逗号连接，后者额外包裹方括号。字段重复出现时按填写顺序重复显示；16 份语言资源均提供规则说明。

**痛点**

- 规则详情渲染在可滚动列表顶部，滚动到底部再展开时保持原滚动位置，导致详情不在可视区；原有解析器仅处理单字段或数值表达式，无法按原样组合多个字段值。

**闭坑**

- 调整列设置帮助时检查实际滚动容器 `listRef`，并核对新增语法在保存识别、字段预取、表格显示三个入口一致；`join`/`list` 只接受 TOML 字段名，数值计算继续使用原有四则运算公式。

**验证**

- `node --test src/views/mtk/isp6s/TablePane/imageTableCustomColumns.test.mjs`、`npm run typecheck`、`npm run build`、`git diff --check` 通过；16 份语言 JSON 均可解析且包含新键。
- 未在 Tauri 窗口手动核对滚动与规则展示。

### 2026-10-27：列设置 join 自定义分隔符

**亮点**

- `imageTableCustomColumns.ts` 的 `join` 可把带引号的文字当作分隔内容，例如 `=join(A, "-", B)` 显示 `值A-值B`，`=join(A, "|", B)` 显示 `值A|值B`；无文字参数的旧规则继续用逗号加空格连接。字段预取只提取 TOML 字段名，不把分隔文字当字段。

**痛点**

- 原解析器只识别标识符、数字和算术符号，带引号的分隔符在保存校验阶段就会被拒绝；只改显示逻辑无法使规则生效。

**闭坑**

- 新增列公式语法时同步检查保存识别、字段预取和表格显示；`list` 仍只接受 TOML 字段，`join` 使用引号文字时按原样连接，无引号文字时沿用默认逗号分隔。

**验证**

- `node --test src/views/mtk/isp6s/TablePane/imageTableCustomColumns.test.mjs` 7 项通过，`npm run typecheck` 通过；16 份语言 JSON 可解析且包含更新的规则说明。未在 Tauri 窗口目视核对。

### 2026-10-27：列设置支持嵌套拼接

**亮点**

- `imageTableCustomColumns.ts` 使用同一递归解析结果完成保存校验、字段提取和显示，支持 `=list(join(Normal_old,"|",Normal_new),BackTar_new,FLinkTar_new)`；字段别名继续由 `TablePane.tsx` 的 `imageTableFormulaAlias` 解析。

**痛点**

- 先前 `join`/`list` 只接受直接字段或文字参数，外层 `list` 遇到内层 `join(...)` 即拒绝保存；即使单独放行校验，字段预取与显示也会遗漏嵌套字段。

**闭坑**

- 调整复合规则时同步验证嵌套的保存识别、字段预取、未知字段提示和显示结果；`list` 仍不接受直接文字参数，算术表达式仍走原有数值公式解析。

**验证**

- `node --test src/views/mtk/isp6s/TablePane/imageTableCustomColumns.test.mjs` 8 项、`npm run typecheck`、`npm run build` 和 `git diff --check` 均通过；16 份语言 JSON 可解析且包含嵌套示例。
- 尚未在 Tauri 窗口目视验证。

### 2026-10-27：列设置帮助文案精简

**亮点**

- `ColumnSettingsWindow.tsx` 将 `ΔCWR` 与 `ΔEV` 的说明合为第 4 条，帮助区从 9 条缩为 8 条；16 份语言资源同步缩短字段、拼接、别名和保存说明。

**痛点**

- 新增 `join/list` 示例后，第 3 条过长；`ΔCWR` 和 `ΔEV` 分占两条，重复解释同一组 `Normal|BackTar|FLinkTar` 顺序。

**闭坑**

- 精简规则时保留默认逗号、自定义分隔符、嵌套写法、旧新值别名及差值精度等行为要点；删除展示项时同时清理 16 份资源中的旧键。

**验证**

- `npm run typecheck`、`npm run build` 通过；16 份语言 JSON 均可解析，合并规则包含 `log2`，旧 `column_source_help_ev` 键无剩余引用。未在 Tauri 窗口目视核对帮助区排版。

### 2026-10-27：首次解析后刷新图片详情数据

**亮点**

- `Isp6sAeVisual.tsx` 在解析完成并重扫图片目录后，将当前图片新生成的 TOML 数据同步到详情面板与会话缓存；配对的 AE Basic/ToneMap 页面清除旧会话缓存，并在目录条目更新时重新读取。

**痛点**

- 初次导入时同名 TOML 不存在，`selectedTomlData` 首次读取失败后保持空对象。解析完成虽更新了共享 `imageDir.tomlData`，Normal、Face、LCE、bcompare 仍读取独立的 `selectedTomlData`；原 effect 只监听图片和目录路径，路径未变时不会重读。EXIF 标签自行按路径加载文件，因此切换过去能看到数据。

**闭坑**

- 生成或重写同路径 TOML 后，同时更新详情数据、失效配对页面缓存并隔离解析前的异步读取；读取失败时不得把空结果永久缓存。目录切换后不得提交旧目录的解析结果。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 通过。未在 Tauri 窗口用真实 DP 解析工具及图片目录复现并目视核对全部详情标签。

### 2026-10-27：热力图命中边框与图片列表列分隔线

**亮点**

- `ChartMapMode.tsx` 与 `ToneChartMapMode.tsx` 的笛卡尔热力图命中项统一使用 1px 主题色内描边；`TablePane.tsx` 在图片列表选中行使用 1px 主题混合色列分隔线，保持原有选中行外框。

**痛点**

- Face BV/DR、HS Area 与 Tone LCE 的热力图命中边框原为 2px；FaceProb、FDSZ_RA、FDDR_RA、base_exp_tbl 开启热力图时只有命中配色。图片列表选中行仍用中性色列线，选中背景降低了竖线对比度。

**闭坑**

- 新增笛卡尔热力图表格时同时检查参数值和命中数两种显示状态；命中描边只在热力图开启时出现，并使用主题色令牌。图片列表列分隔线只增强当前选中行，不能改变普通行和选中外框。

**验证**

- `npm run typecheck` 和 `git diff --check` 通过。未在 Tauri 窗口目视核对不同主题下的线条对比度。

### 2026-10-27：图片列表悬浮预览适配图片比例

**亮点**

- `TablePane.tsx` 的悬浮预览使用全局深浅主题背景令牌，预览框随图片原始比例收紧，并限制最大宽高与屏幕边界。

**痛点**

- 预览通过 Portal 挂在 `document.body`，`App.tsx` 禁用了 Fluent 令牌向 Portal 透传；原背景 `--colorNeutralBackground1` 在预览节点处未定义，导致列表内容从空白区域透出。固定 208px 正方形也给竖幅图片留下多余空间。

**闭坑**

- 后续在 `document.body` 下创建 Portal 时，先检查主题变量是否能在该节点解析；图片预览同时限制宽高，并让容器跟随图片比例，避免固定正方形。

**验证**

- `npm run typecheck` 通过；未在 Tauri 窗口目视核对横幅、竖幅图片及深浅主题。

### 2026-10-27：关于页版本与更新结果核对

**亮点**

- `useShellBootstrap.ts` 和 `updateCheck.ts` 从 Tauri 运行时读取当前安装版本；首页、设置页与近期更新共用该值。updater 返回无更新时，`updateCheck.ts` 再读取带时间参数的 `latest.json` 核对远端版本；若远端更高，首页与标题栏提供对应 Release 页入口。

**痛点**

- 原页面只使用编译进前端的版本号。截图中的 v0.2.8 说明当前窗口加载的是旧前端资源；更新插件返回 `null` 时，界面未核对远端清单就把这个值写成“最新版本”。公开 v0.2.10 Release 及代理清单已核实为 v0.2.10，但截图时 updater 为何返回 `null` 仍需在该旧窗口查看运行时日志才能确认。

**闭坑**

- 当前安装版本以 Tauri `getVersion()` 为准；`check()` 返回 `null` 不能单独证明远端没有新版本。自动安装仍须通过 Tauri updater 及签名验证，清单版本高于运行时版本但无安装对象时只提供官方 Release 链接。

**验证**

- GitHub API 最新 Release 为 v0.2.10，代理 `latest.json` 的版本也为 0.2.10；`npm run typecheck` 通过。尚未在用户截图对应的旧程序窗口复现 updater 返回值，也未实际安装升级。

### 2026-10-27：图片列表列宽持久化与自适应测量

**亮点**

- `TablePane.tsx` 将手动列宽写入现有 `image_table_columns`，按 `isp6s/tone` 和 `all/face/normal` 作用域保存；自动宽度通过复用 Canvas 上下文并缓存最多 4096 个文本测量结果，减少重复测量。

**痛点**

- 手动宽度原来只存在 `TablePane` 本地 React 状态，组件卸载后消失；自动测量每次遇到重复文本都会调用 Canvas。

**闭坑**

- 维护 `ImageTableScopeColumns.widths` 时同步检查 TypeScript IPC 类型、Rust serde schema、旧 TOML 默认值与规范化逻辑。自动测量宽度只能作为后备，不能覆盖持久化的手动宽度。

**验证**

- `npm run typecheck`、`npm run build` 和 `git diff --check` 通过。Rust 测试命令因当前构建产物缺少 `luxe_tauri_lib` 及若干依赖的 rlib 格式而失败；尚未在 Tauri 窗口实际拖拽并切页验收。

- 补充验证：`cargo test --locked --manifest-path src-tauri/Cargo.toml --lib config::state_schema::image_table_column_tests` 与 `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib config::state_file::image_table_mode_tests` 均通过；此前未限定 `--lib` 的测试命令触发了本地集成测试链接错误。

### 2026-10-27：整理并准备发布 v0.2.12

**亮点**

- 从 v0.2.10 到发布候选提交整理功能记录，排除仅记录上次发布验证的提交；更新 `src/data/changelog.json`，汇总 i4LCEfaceTbL0、表格规则拼接、图片选择与列宽、Face_FLT 数据源、详情页解析及更新检查改动。

**痛点**

- 工作区在版本发布前干净，应用版本此前仍为 0.2.10；本机完整 Rust 测试受 Windows 页面文件不足及目标可执行文件占用影响，未能完成。

**闭坑**

- 正式推送版本标签前确认 `tauri.conf.json`、npm/Cargo 清单与锁文件同步，更新记录中包含唯一且完整的版本项；标签推送会触发 Windows 发布工作流，由 runner 执行完整 Rust 测试、签名构建和 GitHub Release 发布。

**验证**

- `npm run version:check`、`npm run release:test`（27 项）、`npm run build`、`git diff --check` 通过。`cargo test --locked --manifest-path src-tauri/Cargo.toml` 在本机失败：并行构建遇到页面文件不足（OS error 1455），单线程重试遇到 `luxe-tauri.exe` 占用（OS error 5）。

### 2026-10-28：Apply image 左右键计算与变化标识

**亮点**

- `TablePane.tsx` 将 Apply 按钮左键绑定全量计算、右键绑定当前图片计算；单图模式只读取一个 TOML，并复用旧计算器保留其余行结果。
- 计算完成后只替换结果映射，变化行自动关闭 idx 与其他列排序，并使用主题警示色标记 idx 数字。

**痛点**

- 单图更新期间新旧计算器会短暂并存，必须保留旧计算器引用，否则未更新行会显示为空或被新参数重算。

**闭坑**

- 以后修改 Apply 链路需同时检查 `applyMode`、`applySingleIndex`、解析路径和 `visibleFaceValues` 的回退逻辑，禁止通过重建 `entries` 或 `tableReloadVersion` 刷新整表。

**验证**

- `npm run typecheck` 通过；`npm run build` 通过；`git diff --check` 通过。尚未在 Tauri 窗口实测鼠标右键交互。

### 2026-10-28：移除 idx 排序开关并保持计算结果局部更新

**亮点**

- `TablePane.tsx` 将 idx 列数字改为纯文本，删除其排序开关、持久化状态和提示；表头排序保留，计算结果变化时清空现有排序。
- 全量计算以旧计算器重算旧值作为缺失快照的比较基准，避免首次计算记录缺失时把所有行误标为变化；稳定行 key 使 React 仅更新变化单元格内容。

**痛点**

- 旧 idx 控制项通过 localStorage 记住开关状态；移除开关后需同时清掉读写逻辑，避免留下不可见但仍生效的排序门控。

**闭坑**

- 调整计算显示时保持图片行 `key={e.jpg_path}` 不变，勿修改 entries 顺序或增加整表 reload 状态；排序清除只处理 sortState、排序值和加载态。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 通过。尚未在 Tauri 窗口实测右键计算交互。

### 2026-10-28：避免 Apply 全量计算期间表格闪动

**亮点**

- `TablePane.tsx` 保留解析完成时的 `parsedTomls` 快照，直到新一轮批量解析全部成功后再一次性替换；请求期间继续以之前的 TOML 字段和旧计算器展示表格。
- 将当前显示计算器与本次 Apply 所请求的计算器分开；新计算器异步加载期间使用基线计算器，完成回调必须等待本次版本的计算器和解析数据都就绪。
- 计算差异不再清除排序及排序缓存，保持行顺序和滚动位置稳定。

**痛点**

- 之前 `applyAllVersion` 变化让旧计算器暂时不匹配，且解析 effect 立即执行 `setParsedTomls(null)`；列表分类、计算值和列宽依赖因此出现空值再恢复，形成闪动。差异时重置排序还可能改变可见行位置。

**闭坑**

- Apply 异步期间不要清空仍有效的解析快照；请求版本的完成判定与屏幕当前显示的回退计算器必须分开。改变计算值时保留行 key、排序态和滚动位置。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 通过。尚未在 Tauri 窗口实测实际闪动是否消失。

### 2026-10-28：Apply 时保持图片表格列设置缓存稳定

**亮点**

- `TablePane.tsx` 的图片类型分类和全量列宽测量缓存改为由图片数组、TOML 字段签名及数据版本判定，不再要求计算器函数对象引用相同；Apply 生成新计算器时保留列作用域和缓存宽度。

**痛点**

- 旧校验把 calculator 函数引用当作列缓存有效性条件。每次 Apply 的 `useMemo` 会生成不同函数对象，造成分类缓存临时失效，`columnScope` 切回 All 并切换手动宽度，随后分类完成又切回 Face/Normal，表现为整表横向闪动。

**闭坑**

- 派生 UI 缓存只依赖与数据内容相关的稳定签名；计算策略函数身份变化不应清空图片类型分类或列宽测量。手动宽度仍由既有作用域配置控制。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 通过。尚未在用户的 Tauri 窗口再次实测 Apply 闪动。

### 2026-10-28：单图计算隔离全表派生数据

**亮点**

- `TablePane.tsx` 在单图 Apply 期间继续使用基线计算器做图片分类和列宽测量，单图的新计算器只用于当前行目标值；沿用已缓存的全表分类及宽度，不触发全量派生重算。

**痛点**

- 单图解析原本只加载一行，但图片分类 effect 仍会因计算器函数变化重新遍历并请求全表字段，造成其他行派生值短暂变化，看起来像整表数值闪烁。

**闭坑**

- 单图路径必须隔离“目标行更新”与“全表分类/测宽”计算器；检查所有依赖 apply 版本或 calculator 引用的全表 effect。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 通过。尚未在 Tauri 窗口实测单图数值刷新范围。

### 2026-10-28：单图 Apply 仅替换目标行结果

**亮点**

- `TablePane.tsx` 的单图 `allTargets` 现在只计算当前 TOML 路径；单图 Apply 跳过全表分类与列宽测量 effect。其他可见行优先使用计算前缓存结果，单图期间不再调用新计算器重算其数值。

**痛点**

- 单图解析虽只有一张图片，但旧 `allTargets` 仍遍历所有 entries；`visibleFaceValues` 也在父组件更新时重新生成并调用基线计算器，造成未选行数值派生重复、用户观察为闪动。

**闭坑**

- 单图计算需同时限定解析路径、目标结果映射和派生缓存更新范围；不能只限制 TOML IPC 请求。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 通过。尚未在 Tauri 窗口验证未选行不闪动。

### 2026-11-04：图片表格排序取消与多选层级、散点轴样式

**亮点**

- `TablePane.tsx` 仅在当前排序列标题上提供取消排序动作；方向按钮继续负责正序/逆序。当前图片行使用较深的品牌背景，多选图片行使用较浅的品牌混色，sticky 单元格沿用对应行背景。
- `ChartMapMode.tsx` 为散点模式的 DR/BV 轴标题添加专属标记；`globals.css` 将该标记从数据格淡化和虚线规则中排除，轴标题保持默认样式。

**痛点**

- 原表格行选择状态共用单一背景色，当前图片与范围/热图多选的层级不易辨识；散点 CSS 规则按所有直接子元素应用，连带改变了坐标轴标题的显示。

**闭坑**

- 维护散点表格选择器时，数据格视觉效果不得隐式覆盖 DR/BV 表头；增删行选择状态时，sticky 单元格背景必须与行级选择优先级一致。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 通过。尚未在 Tauri 窗口实测列标题取消排序、颜色层级和散点轴样式。

### 2026-11-04：散点悬浮显示 BV/DR 数值

**亮点**

- `ChartMapMode.tsx` 在表格区域复用散点最近点命中逻辑，悬浮命中时显示 BV/DR 浮层并在 Canvas 中绘制品牌色环；移出图表、关闭散点或点集变化后清除悬浮状态。
- `globals.css` 使用 Fluent 主题令牌绘制提示边框、文字、背景和阴影，提供短淡入效果并遵守 `prefers-reduced-motion`。

**痛点**

- 散点坐标映射到表格轴的连续位置，相同或相近 BV/DR 值会真实重叠；原悬浮和点击分别使用 8 CSS px 命中循环，等距时优先返回数组靠前但绘制在下层的点，10px 外环也会包住邻近散点。

**闭坑**

- 修改 Canvas 提示时维持图层不拦截单元格编辑和点击路径；悬浮与点击共用 7px 最近点判定，等距点按绘制层级优先命中顶层；悬浮外环应明显小于邻近点距离。悬浮点离开、数据失效或功能关闭后必须释放 React 引用，并保留 ResizeObserver 卸载清理。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 通过；尚未在 Tauri 窗口实测悬浮命中、边缘提示定位和主题动效。

### 2026-11-04：多选图片右键切换当前项并收敛散点悬浮标识

**亮点**

- `TablePane.tsx` 在多选集合内的图片行响应右键时调用 `onPick(index, { preserveHeatmapSelection: true })`，只切换当前图片；表格单元格的输入框、按钮仍保留自己的右键行为。
- `ChartMapMode.tsx` 使用统一最近点命中结果，其他散点先绘制，悬浮点及单个小环最后绘制；每次悬浮只生成一个 hover 环。

**痛点**

- 图片切换默认会清理热力图集合，直接调用普通选择流程会丢失多选；重叠散点若在循环中混合绘制悬浮装饰，标识可能被后绘制的点覆盖，视觉上像多个目标。

**闭坑**

- 多选状态下切换当前图片要走 `preserveHeatmapSelection` 路径，不要通过替换 `selectedHeatmapPaths` 来设置焦点；Canvas 悬浮装饰按单一命中对象绘制一次并置于点集顶层。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 通过；尚未在 Tauri 窗口实测右键保留多选和重叠散点单环。

### 2026-11-04：区分散点图中的当前图片与其他多选图片

**亮点**

- `ImagePane.tsx` 将当前图片的 TOML 路径传给 `ChartMapMode.tsx`；散点在原有多选品牌色上增加当前图片状态，当前点以 Fluent 黄色系语义令牌描边并略微增大，其他已选点保持原颜色。
- 悬浮点仍置于绘制顶层；当前点同时悬浮时复用同一描边圆周，避免叠出两个相似高亮环。

**痛点**

- 散点模型先前只有多选布尔值，没有接收当前图片路径，因此当前图片与其他多选图片显示相同品牌色。

**闭坑**

- 多选散点要分别表达“集合成员”和“当前焦点”；切换当前图片后应只更新当前标记，不改变多选集合，且主题区分必须使用语义令牌。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 通过；尚未在 Tauri 窗口实测当前点颜色对比度和多选切换。

### 2026-11-04：统一散点图与笛卡尔热力颜色

**亮点**

- `ChartMapMode.tsx` 的 Face 散点复用 `--face-heat-high` 颜色令牌，普通点与多选点使用 `#AAC7BE`，通过点径和当前图片描边区分状态；Face、BV/DR、Tone 与 MainT 热力格统一使用该色相。
- `globals.css` 为深浅主题配置同色系强度低值和指定高值；高强度单元格切换深色文字以保持可读性。

**痛点**

- 同一浅青绿色在深色与浅色背景上的对比不同，不能让深色主题高强度格继续使用白字。

**闭坑**

- 调整图表颜色时同步检查 Face/Tone 热力渲染器和 MainT 笛卡尔热力格；核对深浅主题文本对比，并保留当前图片与多选点的既有状态标识。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 均通过；未在 Tauri 窗口实测深浅主题视觉效果。

### 2026-11-04：按主题回调散点与笛卡尔图配色

**亮点**

- `ChartMapMode.tsx` 的散点使用 Fluent `--colorPaletteYellowForeground2`；当前图片描边改用主题品牌色，继续与普通及多选点区分。
- `globals.css` 恢复 Face/Tone 热力图原有深浅主题渐变；MainT 笛卡尔热力图恢复 `#f59e0b` 橙色强度渐变。

**痛点**

- 将不同用途的图表统一到同一青绿色会覆盖现有主题色表达，用户反馈 MainT 图表的橙色与主题更匹配。

**闭坑**

- 按图表类型分别沿用已建立的主题色；调整散点主色时重新检查当前图片描边与点色的区分。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 均通过；未在 Tauri 窗口实测散点黄色在深浅主题下的表现。

### 2026-11-04：区分黄色普通散点与主题色选中散点

**亮点**

- `ChartMapMode.tsx` 按 `point.selected` 分别使用 Fluent 黄色令牌和 `--colorBrandForeground1`；悬浮重绘使用相同分支，避免悬浮时颜色状态跳变。当前图片继续使用黄色描边单独提示。

**痛点**

- 选中状态只增大点径时，在多选图片较多的情况下不够醒目；黄色与品牌色分层后能够同时表达普通点、已选点和当前图片。

**闭坑**

- 修改 Canvas 散点状态色时同时检查普通绘制和悬浮重绘分支，并确保当前图片描边不与选中填充色重复。

**验证**

- `npm run typecheck`、`git diff --check` 通过；未在 Tauri 窗口实测不同主题的选中点对比度。

### 2026-11-04：为 ns_fd_th_tbl 复刻 Face BV/DR 散点图

**亮点**

- `ChartMapMode.tsx` 将 `FaceBvDrTableCard` 的散点按钮可见条件从仅 `fdTh` 扩展为 `fdTh` 与 `nsFdTh`；NS 表直接复用已有轴定位、最近点悬浮、点击选图、多选和颜色标识逻辑。
- NS 表继续使用自身 `source` 的 BV/DR 轴和 `FaceFbtTableKey` 对应的持久化开关键，不会覆盖 `fd_th_tbl` 的散点状态。

**痛点**

- 散点渲染与交互已经封装在通用卡片中，原先仅由标题栏条件隐藏，容易造成 NS 表功能缺失而误以为需要复制一套 Canvas 逻辑。

**闭坑**

- 后续新增同类 Face BV/DR 表时，先检查 `canShowScatter`、`eligibleHeatmapPoints` 和独立 `heatmapKey`，避免重复创建 Canvas 监听器或复用错误的轴数据。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 均通过；未在 Tauri 窗口手动点击 NS 表散点按钮和散点选图。

### 2026-11-05：FaceProb 参数插值与 Face 页面曲线展示

**亮点**

- `ChartMapMode.tsx` 从 AE 参数路径 `[0][4][1][3].0/.1` 和 `[0][4][1][5].0/.1` 加载 `face_sts_sz`、`face_sts_loc` 轴端点；使用当前图片的 `AE_TAG_FACE_STS_SIZE`、`AE_TAG_FACE_STS_LOC` 对 FaceProb 表格四个插值结果进行线性插值，并按 `sz_prob * loc_prob / 1024` 计算参数 FaceProb。
- FaceProb 标题栏显示四个 BV 插值结果和最终参数值，卡片下方增加 SZ Prob、LOC Prob 曲线，Back Scene Target 的 Calculation 行复用同一参数计算结果。
- 两张曲线图使用独立的视觉轴布局：真实端点仍用于计算，`sz` 端点增加水平留白、`loc` 端点收紧间距；坐标轴增加箭头，当前输入使用紫色引导线和读数。源代码草稿同步覆盖 `faceStsSize/faceStsLoc` 轴字段，表格或参数修改后立即重新计算标题和 Calculation 行。

**痛点**

- FaceProb 表格的 BV 行仅用于选择列，`interpolateFaceProbRows` 返回的数组从 `sz_small` 开始；此前按包含 BV 行的下标读取，导致 SZ/LOC 端点错位。轴端点逆序时也需要按归一化比例插值，不能直接使用大小比较截断。
- 曲线 SVG 原先复用了带 `minHeight` 的通用样式，导致视图比例和文字位置被拉伸；改为独立自适应高度后，箭头和标签按同一 viewBox 定位。

**闭坑**

- 修改 FaceProb 插值时必须确认 `rows.slice(1)` 的返回约定：下标 `0/1` 为 SZ，`2/3` 为 LOC；图表折线端点必须使用真实 `x0/x1`，并对逆序或超范围输入统一夹紧比例。
- 修改 FaceProb 或参数源字段后，必须同时更新 `FaceFbtSource.fields` 和对应 `faceStsSize/faceStsLoc` 对象，否则草稿文本变化不会触发最终值和曲线端点刷新。
- 仅 `npm run build` 不能证明 Tauri 页面交互已验收，后续需在 Face 页面核对曲线、标题读数和 Calculation 行。

**验证**

- `npm run typecheck` 通过。
- `npm run build` 通过（Vite 6.4.3，2214 个模块完成构建）。
- `git diff --check` 通过。
- 未在 Tauri 窗口中手动验证 FaceProb 曲线和 Back Scene Target 交互。

### 2026-11-05：FaceProb 边界命中与概率曲线可读性

**亮点**

- FaceProb 标题栏补充 `AE_TAG_FACE_PROB` 和当前 `bv`，曲线当前点下方显示完整的 `AE_TAG_FACE_STS_SIZE`/`AE_TAG_FACE_STS_LOC` 关键字和值。
- BV 超过表格范围时只标识最近边界列；范围内仍标识插值使用的两列。Loc Prob 统一使用标题大小写，移除纵轴 `prob` 文本并细化坐标轴线。

**痛点**

- `boundsForTableAxis` 本身已对越界值返回单列，但 FaceProb 专用的视觉命中函数又无条件补了相邻列，造成越界时错误高亮两列。

**闭坑**

- 调整命中显示时要区分“插值计算点”和“越界边界点”：只有严格位于首尾之间才补充第二列；完整关键字标签需单独预留底部空间，避免与端点数值重叠。

**验证**

- `npm run typecheck` 通过。
- 本轮追加的 EXIF 展示及概率图排版尚未单独执行构建；尚未在 Tauri 窗口手动验收视觉布局。

### 2026-11-05：FaceProb EXIF 字段与曲线端点标注

**亮点**

- Back Scene Target 的 EXIF 混合权重明确读取 `AE_TAG_FACE_PROB`；FaceProb 卡片标题只展示该关键字和 BV，避免重复的 EXIF 数值。
- FDDR_RA 标题把 FDDR 与插值 RA 以字段名、主题色数值和分隔符并排显示；SZ/Loc Prob 标题展示对应 EXIF 关键字和数值。
- 两条概率曲线为两个端点增加水平、垂直虚线投影，当前点使用短轴名和值；通过纵向留白降低 1024 概率点贴近箭头的问题，并让曲线区域贴合卡片边缘。

**痛点**

- 图表底部需要同时放端点刻度和当前坐标提示；完整 EXIF 关键字放在 SVG 内会与刻度重叠，因此完整关键字应放在卡片标题栏，SVG 保留短轴标签。

**闭坑**

- 核对 EXIF 公式权重时使用明确的 `AE_TAG_FACE_PROB` 字段，避免复用 `FACE_PROB_KEYS` 中的兼容别名导致展示和计算来源不一致。
- SVG 改动后检查端点投影线、当前点标签和曲线区域缩放，完整关键字不可挤进坐标刻度区。

**验证**

- `npm run typecheck` 通过。
- `npm run build` 和 `git diff --check` 在本次最终改动后执行。
- 未在 Tauri 窗口中手动验收图表排版。

### 2026-11-05：FaceProb 公式栏与图表读数防裁切

**亮点**

- FaceProb 标题栏右侧仅保留最终结果；标题下新增两行公式信息，第一行显示 BV 插值的四项结果，第二行显示 `sz_prob × loc_prob / 1024` 的代入与最终值。
- SZ Prob 与 Loc Prob 图表卡片间增加间距；概率结果靠标题栏右侧显示。SVG 的 P 标签根据文字长度计算安全范围并夹在绘图区内，顶部空间不足时改放到点下方，避免边缘裁切。

**痛点**

- 当前图点会因轴输入超界而贴近图表边缘，文本若继续以点为中心锚定就会越过 SVG 视口；纵轴数值接近上界时，固定向上放置也会与箭头区域冲突。

**闭坑**

- 给 SVG 数据点添加文字时应估算标签宽度并限制锚点范围；标签靠近顶部时需切换到点下方。公式展示与标题结果应保持单一数据源，避免双处格式数值不一致。

**验证**

- `npm run typecheck`、`npm run build`、`git diff --check` 在本次改动后执行。
- 未在 Tauri 窗口手动验收当前图片点的极值与图表标签位置。

### 2026-11-05：FaceProb 曲线标签留白与参数轴值表

**亮点**

- `FaceProbabilityCurveChart` 为 x 轴下方的当前图片坐标标签增加 SVG 底部留白，避免基线贴近 viewBox 边界后被 SVG 或父卡片裁切。
- SZ/Loc 曲线右侧增加参数轴值与插值概率表；横坐标单元格沿用 `EditableNumberTableCell`、参数草稿更新和源码跳转，纵坐标 Prob 单元格只读并使用主题品牌背景色。
- 两张曲线的绘图区略向左收，右侧表格有独立网格列，不覆盖曲线和标签。

**痛点**

- 原曲线高度为 210，x 轴下方提示文字基线位于 `axisY + 36`，底部视口只剩约 9px；`faceProbabilityCurveCardStyle` 的 `overflow: hidden` 会裁掉字体下沿。
- 轴端点数值来自 `FaceProbabilityAxis.fields`，而不是直接从曲线展示文本生成；新增可编辑值必须同时更新 axis 数字、源字段和源码草稿，否则插值点不会实时变化。

**闭坑**

- SVG 文字应给字体下沿留出实际空白，不能仅把 baseline 放在 viewBox 的最后几像素内；父级 `overflow: hidden` 时尤其要核对。
- 参数轴数值修改必须经 `replaceSourceFieldInSourceText` 写回草稿，并调用 `updateFaceFbtProbabilityAxisField` 更新内存轴；右键跳转需携带字段路径和行号。
- Prob 结果直接取 FaceProb 表格插值值，禁止将只读显示单元格接入编辑回调。

**验证**

- `npm run typecheck` 通过。
- `npm run build` 通过，Vite 完成 2214 个模块构建。
- `git diff --check` 通过；尚未在 Tauri 窗口人工核对窄窗口排版、右键源码定位和极端坐标标签。

### 2026-11-05：FaceProb 主表下移与曲线读数独立布局

**亮点**

- `FaceProbTableCard` 将 BV 概率主表放在 SZ/Loc 曲线区域之后，避免主表占据卡片中段并挤压图表标题。
- 两张曲线之间新增独立窄栏，SZ_Small2Big 与 Loc_Near2Far 参数/概率表纵向排列；曲线各自占据左右栏，不再把表格挤在图表右上角。
- 当前图片坐标读数从 SVG 内移到图表下方独立的 HTML 读数区，避免 SVG viewBox 和图表卡片裁边截断；纵轴 P 读数调整为与横轴标题相同的 13px。

**痛点**

- 将参数表放在图表右上角会缩窄绘图区，并与曲线点标签争用空间；截图中主表紧邻图表标题，也让两个区域视觉上相互覆盖。
- 仅扩大 SVG viewBox 无法保证不同实际宽度下的点坐标提示都不和端点刻度重叠。

**闭坑**

- 同一卡片同时展示宽表和多张曲线时，按“公式、曲线和关联参数、主数据表”的顺序布置；共享参数表放独立列，不叠放在绘图区上。
- 需要确保显示的坐标读数不应依赖 SVG 文本边界；用独立 DOM 行承载，并按当前点水平坐标定位。

**验证**

- `npm run typecheck` 通过。
- `npm run build` 通过，Vite 完成 2214 个模块构建。
- `git diff --check` 通过；未在 Tauri 窗口人工验收实际宽度、点标签与参数编辑交互。

### 2026-11-05：FaceProb 当前点读数与双轴表格边界

**亮点**

- 当前图片的横坐标标签直接放在散点正下方，P 值放在点上方；两者按绘图区边界限制，并使用浅底描边确保虚线背景下可读。
- 当前点靠近横轴标题时，垂直投影线向左偏移 18 SVG 单位，点本身仍保持按参数计算出的实际位置。
- SZ/Loc 参数表使用一致的 100px 行标题列和共享数值列模板，表头禁止折行；中央参数栏加宽至 230–250px。

**痛点**

- 图表外部坐标胶囊虽然避开裁切，但在 SVG 下方形成额外视觉层，和散点的几何位置关联不够直接。
- 中央栏过窄时，`SZ_Small2Big` 和 `Loc_Near2Far` 会被折成多行，使两张 2×2 表格高度和边界不一致。

**闭坑**

- 当前点坐标标签须按真实散点 x/y 定位，并分别限制 x、y 边界；接近轴标题时仅偏移投影线，不能移动真实数据点。
- 并排的小型参数表应共用同一个 grid 列模板，对长标签明确设置不换行和足够标签列宽。

**验证**

- `npm run typecheck` 通过。
- `npm run build` 通过，Vite 完成 2214 个模块构建。
- `git diff --check` 通过；未在 Tauri 窗口人工核对两轴极值下的标签边界。

### 2026-11-05：FaceProb 超界散点投影对齐

**亮点**

- 当当前 x 值靠近横轴标题、投影线需要左移时，散点圆标、P 值和水平/垂直投影线统一使用偏移后的绘制坐标，避免投影交点与点标记分离。
- `sz/loc` 当前值标签固定在横轴上方内侧，保持其与横轴的间距；FaceProb 最终结果移除 hover title，避免重复悬浮预览。

**痛点**

- 只移动投影虚线会让真实点标记留在旧位置，用户看到的点与虚线交点不一致。

**闭坑**

- 图表为避让轴标题调整点的展示位置时，要同步当前点标记、投影线和 P 标签的绘制 x 坐标；插值计算继续使用原参数值。
- 点的横坐标文本与绘图区边界冲突时，先限制标签 x，再将标签放在轴线内侧并留出刻度文本间距。

**验证**

- `npm run typecheck` 通过。
- `npm run build` 通过，Vite 完成 2214 个模块构建。
- `git diff --check` 通过；未在 Tauri 窗口人工复核超界散点显示。

### 2026-11-05：FaceProb 端点间距与零值原点

**亮点**

- SZ 概率图视觉端点比例缩至 0.28–0.70，Loc 概率图扩展到 0.22–0.78，使 LOC 端点间距大于 SZ 端点间距；真实参数插值逻辑不变。
- 曲线横坐标值为 0 时映射到坐标轴原点；轴中间栏新增“参数表格映射”主题标题，行标题采用浅品牌色，可编辑参数格维持默认底色，表格字号与标签列宽增加并禁止换行。
- SZ 图表靠近右侧轴标题时，将当前点及其投影整体向左移 32 SVG 单位。

**痛点**

- 通用的轴端点比例会使 SZ 端点间距视觉上大于 Loc；统一的轻微原点夹紧会使 0 值显示在轴线右侧，而非原点。
- 窄参数表下长行标题折行，表格行高不一；参数输入格沿用绿色轴标题底色会使可编辑单元格被误认为静态表头。

**闭坑**

- 若图轴采用视觉比例映射，分别核对各轴端点间距与业务期望；坐标值 0 若代表图表原点，需在视觉映射中显式归零。
- 参数表必须区分行标题、可编辑输入和只读结果：仅行标题用主题品牌浅底，可编辑格用中性底色，只读结果用独立浅品牌色。

**验证**

- `npm run typecheck` 通过。
- `npm run build` 通过，Vite 完成 2214 个模块构建。
- `git diff --check` 通过；未在 Tauri 窗口人工检查端点比例和零点落位。

### 2026-11-05：参数表格映射标题与折叠控制

**亮点**

- 中间参数映射栏标题使用与 SZ/Loc 曲线标题栏一致的主题背景、边框和 38px 盒高，右侧提供带 aria 状态的折叠/展开按钮。
- 折叠仅隐藏中间两张参数映射表，不影响左右图表和底部 FaceProb 主表。
- SZ/Loc 参数表行标题使用明确的 `#E1F5D1`，Prob 单元格的悬浮提示显示对应 `sz_small`、`sz_big`、`loc_near` 或 `loc_far` 及插值值。

**痛点**

- 中间栏的标题此前是无按钮的独立小标签，视觉上没有和两侧曲线标题栏对齐，也无法单独收起映射表。
- Prob 单元格悬浮只显示数字，无法判断该数值对应四项插值结果中的哪一项。

**闭坑**

- 中间工具栏标题应复用左右卡片标题栏的高度与主题样式，折叠按钮必须带有可读名称及 `aria-expanded` 状态。
- 概率值工具提示应包含映射键名与数值，不能仅显示数值。

**验证**

- `npm run typecheck` 通过。
- `npm run build` 通过，Vite 完成 2214 个模块构建。
- `git diff --check` 通过；未在 Tauri 窗口人工验收折叠按钮和鼠标提示。

### 2026-11-05：参数映射标题顶对齐与联合折叠

**亮点**

- 参数映射栏使用独立的 38px 顶部标题条，与两侧 `faceProbabilityCurveHeaderStyle` 的实际盒高一致；映射区域背景改回 `colorNeutralBackground1`。
- 同一折叠状态控制两侧曲线绘图区和中间映射表格，折叠后保留 SZ Prob、参数表格映射、Loc Prob 三个标题条。
- 参数映射行标题延用 FaceProb 主表使用的 `#E1F5D1`，与 face_dr 行标签的浅绿底一致。

**痛点**

- 参数映射栏垂直居中时，标题相对两侧曲线标题栏下沉；仅折叠参数表格会留下两侧图表内容，折叠层级不一致。

**闭坑**

- 三栏并排图表的标题条都从容器顶边开始且盒高一致；中央栏不得使用垂直居中把标题推离顶部。
- 共享折叠按钮需隐藏所有并列内容面板，但保留三栏标题以提供明确的再次展开入口。

**验证**

- `npm run typecheck` 通过。
- `npm run build` 通过，Vite 完成 2214 个模块构建。
- `git diff --check` 通过；未在 Tauri 窗口人工确认折叠后的三栏高度。

### 2026-11-05：FaceProb 曲线区域统一视觉层级

**亮点**

- SZ/Loc 曲线、中央轴值表收纳在同一圆角面板中，使用细分隔线表达三列关系；移除两张重复的独立卡片边框和 SVG 内重复标题。
- 中央轴值表改用中性表头与更浅的品牌色 Prob 背景，保留可编辑轴值和只读结果的颜色区分。
- 将当前图片坐标读数放在曲线下方紧邻的胶囊标签中，并缩短坐标轴下方空白，降低读数脱离曲线的观感。

**痛点**

- 独立卡片的边框、紫色标题背景和主面板边界叠加，产生多层框线；SVG 标题与 HTML 卡片标题重复，增加不必要的视觉噪声。
- 为解决 SVG 文字裁切保留过大的底部区域，会让坐标读数和坐标轴之间产生明显空洞。

**闭坑**

- 组合图表应只保留一个容器边界，通过内部细分隔线建立分区；图表标题由卡片头单点呈现。
- 坐标读数放到 SVG 外部后，应缩减 SVG 的底部空白，并给读数提供独立但紧邻的行，兼顾不裁切和视觉关联。

**验证**

- 本轮样式调整后运行 `npm run typecheck`、`npm run build` 和 `git diff --check`；桌面窗口人工验收待执行。
### 2026-11-05：FaceProb 映射卡片与图片列表计算输入贯通

**亮点**

- 中间参数映射区域改成与 SZ/Loc 曲线一致的独立卡片，标题更名为“参数插值结果映射”，并加入固定显示的保存按钮和联动折叠按钮；保存复用现有 `FaceTableSaveButton` 草稿入口。
- 图片列表 Face 目标计算读取图片元数据时，将 `AE_TAG_FACE_STS_SIZE` 和 `AE_TAG_FACE_STS_LOC` 纳入 `FACE_LINK_TARGET_IMAGE_KEYS`，使列表计算器能够使用与图表相同的插值横坐标并计算最新 Back Scene Target。

**痛点**

- 目标计算器已实现参数化 FaceProb 插值，但图片列表读取键集合漏掉尺寸和位置元数据，造成列表端计算输入缺失；只修正公式而未核对数据采集键集合不足以打通计算链路。

**闭坑**

- FaceProb 的 `sz_prob`、`loc_prob` 与 `BackTar_new` 必须统一依赖参数文件轴值和图片 `AE_TAG_FACE_STS_SIZE`、`AE_TAG_FACE_STS_LOC`；扩展公式计算时同时检查图片列表键集合、批量计算器和自定义列别名。
- 参数映射卡片保存沿用共享源码草稿回调，折叠状态同时控制两侧曲线和中间表格。

**验证**

- `npm run typecheck`、`npm run build` 和 `git diff --check` 通过；未在 Tauri 桌面窗口人工验收。

### 2026-11-05：FaceProb 卡片间距与自适应布局

**亮点**

- 三张 FaceProb 子卡片底部改为直角；中间映射卡片两侧及两张 2×2 映射表之间共用 6px 间距，并将映射表组垂直居中。
- SVG 曲线图以卡片宽度 `100%` 渲染，随容器宽度和分割器变化自适应；卡片标题栏固定单行并在窄宽度下裁切。
- 保存按钮的脏状态现在合并检查映射轴字段的草稿值与保存值，用户编辑轴参数后会高亮保存入口。

**痛点**

- 原保存按钮只以 FaceProb 主表的数据作为脏状态来源，独立映射轴字段编辑后无法提示待保存。

**闭坑**

- 新增共享源码中的可编辑轴字段时，必须将这些字段纳入卡片保存脏状态检查；响应式图表要基于 SVG viewBox 配合容器宽度，而不是固定像素宽度。

**验证**

- `npm run typecheck` 通过；本轮通过 `npm run build` 与 `git diff --check`；未进行 Tauri 窗口人工验收。

### 2026-11-05：参数映射卡片标题栏定位与保存状态修复

**亮点**

- 参数映射卡片拆分为固定 38px 标题栏和可伸展内容区；表格只在内容区垂直居中，避免标题受整体居中布局影响而下沉。
- 轴参数保存状态直接比较可编辑映射轴的当前 `field.value` 与源码保存版本的字段值，确保单元格提交后标题栏保存按钮及时启用。

**痛点**

- 此前将 `justify-content: center` 放在包含标题栏和表格的整卡 flex 容器，导致标题栏偏离顶部；保存提示依赖草稿文本读取，未及时反映组件内更新的轴字段值。

**闭坑**

- 垂直居中应只作用于卡片标题栏下方内容容器；编辑控件的待保存状态应比较当前编辑模型和持久化基线，不依赖异步草稿回调先行更新。

**验证**

- `npm run typecheck` 通过；本轮通过 `npm run build` 和 `git diff --check`；未在 Tauri 桌面窗口人工验收。

### 2026-11-05：FaceProb 等比例列宽、参数保存状态与公式字体统一

**亮点**

- 三列图表/参数卡片使用 `repeat(3, minmax(0, 1fr))`，移除中间列 270–290px 固定宽度约束，分割器缩窄时三列等比收缩。
- 参数映射保存按钮根据源码草稿与保存基线是否不同判断待保存状态，覆盖单元格失焦提交导致的本地模型与草稿更新时序差。
- FaceProb 公式栏复用 Back Scene Target 的公式字体族和字号。

**痛点**

- 中间列设置固定最小宽度后会阻止其随窄分割器继续缩小；保存状态只检查参数模型字段时，失焦提交中的草稿同步时序可能导致按钮仍显示禁用。

**闭坑**

- 可拖动分割器中的并列列轨道需使用 `minmax(0, 1fr)`，并检查子表格的最小内容宽度不会反向撑开轨道。
- 草稿保存按钮使用共享源码文本和已保存文本作为 dirty 基线，保存后基线同步更新即可清除提示。
- 新增公式栏应复用 `thresholdFormulaStyle` 字体族、字号，保持 Back Scene Target 与 FaceProb 读数一致。

**验证**

- `npm run typecheck`、`npm run build` 和 `git diff --check` 通过；未在 Tauri 窗口实测分割器拖动和参数保存交互。

### 2026-11-05：FaceProb 参数映射比例、即时保存提示与结果强调

**亮点**

- SZ/参数映射/Loc 三列改为 `4fr:2fr:4fr`；中间表格区单独管理表间距，并用内容区上下留白将上表顶部靠近曲线纵轴箭头、下表底部靠近横坐标轴。
- 参数轴表格的有效输入预览直接调用源码字段提交更新逻辑，逐次更新共享草稿文本，因此保存按钮在用户输入时立即启用。
- FaceProb 字样与最终数值突出显示，FaceProb 最终数值使用当前主题色；四项 BV 插值结果加粗。

**痛点**

- 轴表格之前只在输入提交/失焦时更新共享源码草稿，按钮脏状态读取共享草稿，导致必须先提交单元格才启用。
- 三列等分未满足两侧图表宽于参数区域的比例要求。

**闭坑**

- 即时保存状态依赖共享草稿时，表格的每次有效 `onPreview` 都必须写入同一草稿更新入口；保留提交回调以支持键盘确认及失焦。
- 三列比例使用 `minmax(0, 4fr) minmax(0, 2fr) minmax(0, 4fr)` 防止子内容撑开中间轨道；两张表间距由独立常量管理。

**验证**

- `npm run typecheck`、`npm run build` 和 `git diff --check` 通过；未在 Tauri 桌面窗口实测输入过程、图表轴对齐和主题色。

### 2026-11-05：FaceProb 概率图自适应与数值精度

**亮点**

- SZ Prob 和 Loc Prob 的 SVG 保持 `xMidYMid meet`，图表容器作为卡片剩余空间的弹性居中区域；分割器调整造成卡片宽高变化时，绘图区在中心按容器比例缩放。
- FaceProb 标题结果、BV 插值结果、公式参与值、概率图 P 读数和映射表 Prob 行统一格式化为小数点后一位；映射轴输入仍保留源码中的原始数值文本。
- 参数插值映射表的外框改用主题描边令牌并加强边界对比，区分表格边界与卡片背景。

**痛点**

- 图表 SVG 仅使用 `width: 100%` 和自动高度时，横向缩放受轨道宽度影响，不能充分利用参数卡片形成的可用高度。
- 通用数值格式会省略整数的小数位，与 FaceProb 公式中要求统一展示精度的阅读方式不一致。

**闭坑**

- 可缩放 SVG 应确认父级具有可分配的弹性空间，并设置 `preserveAspectRatio="xMidYMid meet"`；Tauri 窗口仍需人工检查宽高变化时的实际布局。
- 只对概率结果应用一位小数格式，映射轴坐标与可编辑源码文本保留原精度，避免显示精度改动污染参数数据。

**验证**

- `npm run typecheck` 通过。
- `npm run build` 通过（Vite 6.4.3，2214 个模块完成构建）。
- 尚未在 Tauri 窗口手动拖动分割器核对图表居中缩放和表格边框的显示效果。

### 2026-11-05：ISP6S 表格源码跳转的滚动定位

**亮点**

- 各 ISP6S 表格的源码跳转共用 `SourceCodeView`；在该入口按目标行的中心像素计算纵向滚动位置，因此表格、参数检查及 Tone 参数跳转统一获得视口垂直居中的代码位置。
- 精确选择源码数值时，使用 textarea 的实际字体和 Canvas `measureText` 计算 token 横坐标；仅在 token 超出代码可视区域时改动 `scrollLeft`，已可见时保留现有横向位置。超长 token 无法完整显示时将其起点对齐可视代码区。

**痛点**

- 旧跳转逻辑固定使用 `(line - 6) * LINE_H`，把代码行置于视口上方附近，而非垂直中心；按 `(tokenStart - 12) * 7` 推测横向偏移，无法判断目标代码当前是否已完整可见。

**闭坑**

- 共享源码跳转的滚动逻辑必须放在 `SourceCodeView.tsx` 的统一入口，避免 ISP6S 各表格分别实现产生不同定位行为。
- 横向可见性判断须考虑固定宽度的 sticky gutter、代码区左 padding、可视 clientWidth 和实际字体宽度；输入中文或非等宽文本时不可用固定字符宽度估算。

**验证**

- `npm run typecheck` 通过。
- `npm run build` 通过（Vite 6.4.3，2214 个模块）。
- `git diff --check` 通过。
- 尚未在 Tauri 窗口手动逐类验证 ISP6S 表格右键跳转的纵向居中与横向保留/滚动行为。

### 2026-11-05：FaceProb 映射数值列与概率图可用空间

**亮点**

- `FaceProbabilityAxisValuesTable` 将标签列从固定 `122px` 最小宽度改为可压缩的 `1.15fr`，两列数值各占 `1fr`；长行标题允许换行，收窄组件时优先保证参数输入和插值结果列的宽度。
- SZ/Loc 图表收紧 SVG 坐标轴留白，并分别扩大端点映射区间，增加曲线、端点和当前值标识在卡片中的占用面积。

**痛点**

- 中间卡片在 4:2:4 布局下本就窄于两侧图表，标签列固定最小宽度后挤压两个数值列，导致单元格显示省略号。
- 坐标轴边距和端点比例偏保守，图表绘图区没有充分利用可用宽度。

**闭坑**

- 三列比例布局中的窄列不能包含大于轨道实际宽度的固定 `min-width`；检查数据表首列文本换行和数字列最窄宽度。
- 扩大坐标绘图区需同步检查首尾标签、箭头及当前值提示是否裁切，SZ 与 Loc 可使用不同端点分布比例。

**验证**

- 尚未运行本轮代码验证；需执行 `npm run typecheck`、`npm run build` 和 `git diff --check`。
- 尚未在 Tauri 窗口核对窄屏下两张参数表数字完整性及曲线边缘显示。

**本轮边界修正（同日）**

- 参数映射表标题列不换行，改为 `2fr:1fr:1fr` 的标题/数值列比例；标题列在极窄卡片中单行省略，两个数值列继续均分剩余宽度。标题及表格字号分别收至 9px / 10px，减少标题对数值空间的占用。
- `npm run typecheck`、`npm run build`（2214 个模块）和 `git diff --check` 均通过；尚未在 Tauri 窗口检查极窄宽度下实际省略及数值可读性。

### 2026-11-06：语言资源收敛为五种并迁移旧索引

**亮点**

- 前端 `src/locales/index.ts`、Rust `LANGUAGE_LOCALES` 和设置选择器统一为 `zh_CN`、`zh_TW`、`en_US`、`ja_JP`、`tr_TR`；Rust 资源加载器只接受白名单文件。
- `StateStore::load` 在读取 TOML 后执行 `migrate_locale_index`：旧版土耳其语索引 11 映射到新索引 4，其他已删除语言回退简体中文，并写入 `locale_schema_version = 1`。

**痛点**

- 仅缩短语言数组会让旧索引 11 静默指向错误语言；资源目录中的旧 JSON 即使不显示在下拉框中仍会被打包。

**闭坑**

- 修改语言列表必须同时检查 `src/locales/index.ts`、`src-tauri/src/config/translations.rs`、`src-tauri/resources/translations/`、`src/types/ipc.ts` 和状态迁移测试。
- 语言资源集合必须与白名单完全相等；当前目录仅保留五个 JSON，非法及历史索引均回退到 0。

**验证**

- `npm run typecheck` 通过。
- `npm run build` 通过（Vite 6.4.3，2214 个模块）。
- 独立 `CARGO_TARGET_DIR` 下的 `cargo test --locked --manifest-path src-tauri/Cargo.toml` 通过（19 个单元测试及全部集成测试通过，1 个性能测试 ignored）。
- `git diff --check` 通过；尚未进行 Tauri 窗口内语言切换和重启后的人工验收。

### 2026-11-09：首页平台与关于卡片接入多语言

**亮点**

- `src/views/HomeView.tsx` 的平台卡片以稳定翻译键描述标题和说明；分区标题、关于卡片的版本、更新操作、更新状态和进度辅助文本均由 `t()` 渲染。
- `src-tauri/resources/translations/{zh_CN,zh_TW,en_US,ja_JP,tr_TR}.json` 同步提供首页所需键，使现有 Rust 启动加载的翻译 bundle 可直接覆盖首页文案。

**痛点**

- 首页已经调用 `useTranslation()`，但卡片和更新信息仍有中文字面量，造成设置语言切换后首页中英文混杂。

**闭坑**

- 修改首页文案需检查静态卡片配置、更新按钮各状态、更新详情及 aria-label，并保证五个当前语言资源含相同首页键。
- 下载进度通过 `home_update_downloading` 的 `{{progress}}` 插值传入；无总字节数时传空字符串，避免拼接语言相关标点。

**验证**

- `npm run typecheck` 通过。
- Python 标准库解析五个翻译 JSON 通过；`git diff --check` 通过。
- 尚未在 Tauri 窗口手动切换五种语言验收实际排版和措辞。

### 2026-11-09：更新通知操作区与标题栏进度环

**亮点**

- `src/components/shell/TitleBar.tsx` 的更新通知操作按钮改为底部右对齐，避免主按钮占满通知卡片宽度。
- 标题栏更新入口复用 `useUpdateStore` 的下载字节和总字节状态，下载时显示百分比环，安装或未知进度时显示旋转环，并为环形控件提供可访问名称。

**痛点**

- 原通知按钮使用 `w-full`，视觉上占据整个底部；更新进行时标题栏仍显示普通更新图标，用户无法快速判断下载进度。

**闭坑**

- 环形进度必须读取 `downloadedBytes` / `totalBytes`，不能从展示文案反向解析百分比；`totalBytes` 为空时使用不确定进度状态。
- 更新按钮在 `downloading` 和 `installing` 状态保持禁用，避免重复调用现有 `installAvailableUpdate()`。

**验证**

- `npm run typecheck`、`npm run build`（2214 个模块）和 `git diff --check` 均通过。
- 尚未在 Tauri 窗口中手动验证下载、安装状态下标题栏环形动画和通知卡片定位。
### 2026-11-09：ISP6S 表格右键源码定位

**亮点**

- MainT、HS、NS、Face 与 Tone 表格的数值单元格通过现有源码跳转入口定位；可编辑单元格先提交有效草稿，再携带源码行、字段序号及数值列范围选中对应 token。
- Tone 和 MTWV 表格行/列及 HS Weight、HS Area、Face 热力图计数格不再暴露源文件路径悬浮文本；无源码映射的热力图格仍可按原有行为筛选命中图片。

**痛点**

- 右键交互分散在可编辑数值格、热力图计数格和 Tone 专用单元格中；增加表格入口时容易只处理普通数值模式，遗漏计数模式或源码字段序号。

**闭坑**

- 新表格单元格应传入字段映射与 `selection`，按源码行计算 `ordinal`；带编辑草稿时使用 `commitBeforeSourceJump`，无字段映射时不应伪造跳转。
- 检查表格内 `title` 是否拼入 `.path` 或 `paths=`；普通状态提示可以保留，源文件路径不应作为悬浮提示。

**验证**

- `npm run typecheck` 通过；`git diff --check` 通过。
- 尚未在 Tauri 桌面窗口逐页实测 MainT、HS、NS、Face 与 Tone 的右键定位和数值高亮。
### 2026-11-09：NS 表格右键跳转选中当前数值

**亮点**

- NS Probability、NS NorT/BT、NS EVD define 和 NS DT 参数单元格统一复用 `EditableNumberTableCell` 的 `commitBeforeSourceJump` 与 `commitPreviewedValue`，右键跳转前先提交有效草稿，再把当前值传给源码编辑器。
- `sourceJumpDetails` 从完整的 NS 字段集合计算源码行内 `ordinal`，跳转只携带行号、当前值和序号，避免编辑后旧列偏移覆盖新值定位。

**痛点**

- 原 NS 单元格回调没有接收当前值，且右键路径未提交草稿，导致源码视图只能跳转到行而不能稳定选中单元格数值；Probability 曲线此前还只从当前曲线的四个字段计算序号。

**闭坑**

- 新增 NS 可编辑表格右键跳转时必须传递 `(value: string)`，并开启 `commitBeforeSourceJump`；行内序号必须基于对应源码块的完整字段集合，不能依赖表格显示顺序或编辑前的列偏移。

**验证**

- `npm run typecheck` 通过。
- `npm run build` 通过（Vite 6.4.3，2214 个模块）。
- `git diff --check` 通过。
- 尚未在 Tauri 实际窗口逐个右键验收 NS 页面；需重点核对已编辑数字和同一源码行存在多个数字时的选中范围。
### 2026-11-09：NS Area 卡片分割器默认比例与持久化

**亮点**

- NS NorT Area、NS BT Area 和 NS DT Area 的双面板统一使用 `defaultSize={50}`，三张卡片分别使用独立的 `autoSaveId`，用户拖动后的比例会按卡片持久化。
- NS NorT/BT 左侧最小尺寸调整为 `40%`，确保 `50:50` 默认布局不会被最小尺寸约束覆盖；NS DT 保留现有两侧最小尺寸约束。

**痛点**

- 原 NS NorT/BT 使用 `76:24`，NS DT 使用 `58:42`，且旧的自动保存键可能继续恢复历史比例，导致首次使用或升级后不是 1:1。

**闭坑**

- 修改默认分割比例时必须检查 `minSize` 是否小于等于默认值；需要改变已有保存布局的默认行为时同步升级 `autoSaveId`，否则旧布局会覆盖新的默认比例。

**验证**

- 待运行 `npm run typecheck`、`npm run build` 和 `git diff --check`。
- 尚未在 Tauri 实际窗口拖动三张卡片的分割器并重启验证持久化效果。

### 2026-11-09：全局同步宿主语言支持数量

**亮点**

- `AGENTS.md`、`README.md` 与 `src-tauri/src/lib.rs` 已统一为宿主当前支持五种语言，并列出 `zh_CN`、`zh_TW`、`en_US`、`ja_JP`、`tr_TR`；插件文档保留 manifest 的 16 语言容量限制并明确其与宿主语言契约的边界。

**痛点**

- 运行时代码和翻译资源已经收敛为五种语言，但项目说明、启动注释及插件限制描述使用了容易混淆的“16 种语言”表述，可能让维护者误判宿主支持范围。

**闭坑**

- 修改语言数量说明时必须同时搜索根目录文档、Rust 启动注释、插件 manifest 文档和经验账本；插件的独立容量上限不得误改成宿主语言列表。

**验证**

- `npm run typecheck`、`git diff --check` 通过；全局搜索确认宿主文档和启动注释不再宣称支持 16 种语言，剩余 16 仅为插件 manifest 的独立容量上限。
- 未进行 Tauri 窗口内语言切换的人工验收；本次仅同步文档和注释，不改变运行时语言逻辑。

### 2026-11-09：跨进程图片联动规则边界

**亮点**

- 在 `.codex/rules/06-通信与数据获取规范.md` 区分 HiViewer 插件宿主快照输入与 LUXE 独立回传适配层；双向回传不依赖 HiViewer v1 尚未开放的 `host/*` callback。
- 规则将 Windows Named Pipe 设为原生进程通信的优先评估项，并要求与 loopback TCP/WebSocket、文件协议比较权限、断线、部署和测试成本。
- `.codex/rules/03-目录与架构规范.md`、`.codex/rules/08-数据库与状态管理规范.md` 明确绝对路径、`imageDir` workspace 目录匹配和既有 Zustand 索引更新边界。

**痛点**

- 当前 LUXE 没有跨进程消息服务或图片选择 API；HiViewer 插件指南中的 `ViewerSnapshot` 方向为宿主到插件，`selection.get()` 是固定快照，不能单独满足反向同步。
- 本次只新增架构规则，尚未实现协议、Named Pipe、插件包或安装包；传输方案和 HiViewer 双向行为尚未实测。

**闭坑**

- 实施前先定义版本、sourceInstance、sequence、绝对路径、ACK、未匹配结果及 remote-origin 标记；验证旧序号、重复事件和回环不会改变较新的选择。
- HiViewer 插件收到 `viewer/update` 后若要反向同步，应显式连接 LUXE 的独立适配层；不得调用未实现的宿主 callback。
- LUXE 仅按路径父目录定位唯一已扫描 workspace，并以 `ImageEntry.jpg_path` 找索引；零个或多个 workspace 命中均不得猜测或自动扫描。

**验证**

- `git diff --check`：通过。
- 未运行 typecheck、Rust 测试、插件构建/打包或 Tauri 安装包；本次变更只涉及规则与经验文档。
- 未在实际 HiViewer 与 LUXE 进程间验证双向切图。

### 2026-11-09：本地低内存环境的 Rust 编译边界与联动消息限流

**亮点**

- `.codex/rules/01-人设与开发准则.md`、`02-技术栈与核心库.md`、`04-核心铁律与避坑.md`、`AGENTS.md` 统一规定：本地只做 `npm run typecheck`、Node 22 脚本测试和不触发编译的 Rust 格式/静态检查；前端打包、Rust 编译/测试及 Windows 安装包交给 `.github/workflows/ci.yml` 和发布工作流。
- README、性能维护文档和本地状态文档同步改为 CI 产物验收，避免示例命令诱导本地执行 `cargo build/check/test` 或 `tauri:dev`。
- `src/services/imageSyncService.ts` 按 `sourceInstance + sequence` 拒绝重复/过期图片选择并限制来源缓存为 32 个；`src-tauri/src/image_sync.rs` 将 Named Pipe 单帧读取限制为 16 KiB，并限制每连接的来源序号表。

**痛点**

- 本机 Rust/Tauri 编译会造成高内存占用和资源释放滞后；本轮未执行 Cargo 编译或测试，因此新增 Rust 代码的 Windows 编译兼容性仍需 CI 结果确认。
- 全仓 `cargo fmt --check` 仍包含既有格式差异；只对本轮新增 `image_sync.rs` 与 `image_sync_cmds.rs` 执行格式化，避免无关格式噪声。

**闭坑**

- 后续 Rust 改动先运行 `rustfmt --check --edition 2021` 指向受影响文件，再提交让 GitHub Actions 执行 `cargo test --locked --manifest-path src-tauri/Cargo.toml`。
- 跨进程消息必须先做有界读取，再解析 JSON；前端必须在应用状态前按来源序号去重，且远程应用动作不能再次发布为本地选择。
- 插件/应用双向联动仍需从 CI 产物安装后，在真实 HiViewer 与 LUXE 进程间验收；类型检查和脚本测试不能替代该验收。

**验证**

- `npm run typecheck`：通过。
- `npm run release:test`：27 项通过。
- `rustfmt --check --edition 2021 src-tauri/src/image_sync.rs src-tauri/src/commands/image_sync_cmds.rs`：通过。
- `git diff --check`：通过。
- 未运行 `cargo build`、`cargo check`、`cargo test`、`npm run rust:test`、`npm run tauri:build` 或 `npm run tauri:dev`；未完成 CI 和真实双进程桌面验收。

### 2026-11-09：HiViewer 图片联动插件 CI 打包

**亮点**

- `plugins/luxe-image-sync/` 将能力限定为 HiViewer 快照驱动 LUXE、插件窗口按 A/D 控制 LUXE；manifest 声明 Windows x64 `bin/luxe-image-sync.exe`，`.github/workflows/plugin.yml` 在 Windows runner 编译并上传 `.hvp` 与 SHA-256。
- `scripts/plugin-package.mjs` 使用 Node 22 内置模块检查 manifest、资源路径、sidecar 和包预算，并生成根目录含 `checksums.json` 的 ZIP 格式 `.hvp`。
- 插件只允许从当前 HiViewer 快照列表选择路径，并以有界队列和逐帧 16 KiB Named Pipe 读取限制跨进程消息。

**痛点**

- 现有仓库文档曾引用缺失的 `plugins/tools/cli.mjs`，无法实际执行插件校验或打包；补充仓库内 Node 工具避免工作流依赖缺失 CLI。
- 本机没有 `gh` CLI，也没有 GitHub Actions API 授权工具；当前只能准备工作流，无法由终端触发或查看运行结果。
- 插件宿主与 LUXE 的 Named Pipe 行为尚未在桌面进程中实测，插件包构建也依赖新增 Actions 首次编译验证。

**闭坑**

- 插件发布前核对 `.hvp` 包根、manifest 平台和 sidecar 路径一致；从 Actions artifact 解压核对 `.hvp`、校验文件清单摘要，再通过 HiViewer“设置 → 自定义插件 → 从包安装”手动安装。
- 确认 HiViewer 当前版本接受生成的 `checksums.json` schema；如宿主校验拒绝安装，使用 HiViewer 仓库实际 pack CLI/格式修正打包器后重跑 CI。
- LUXE 必须先扫描唯一匹配目录；桌面验收覆盖 HiViewer 切图驱动 LUXE、插件 A/D 驱动 LUXE、LUXE 本地切图更新插件及 LUXE 离线重连。

**验证**

- 本轮待完成：Node 插件包检查/ZIP 可读性、npm typecheck、发布脚本测试、Rust 受影响文件 rustfmt、git diff --check。
- 未在本机运行任何 Cargo/Tauri 编译命令；Windows Rust 编译、插件包检查与 `.hvp` 生成交由 `.github/workflows/plugin.yml`。
### 2026-11-10：HiViewer 插件包 ZIP 与 checksum schema 修复

**亮点**

- `scripts/plugin-package.mjs` 生成标准 ZIP 本地文件头和中央目录，`checksums.json` 与 HiViewer 宿主要求的“相对路径到 SHA-256” map 一致；`.github/workflows/plugin.yml` 使用 Windows `Expand-Archive` 和 checksum map 检查验证最终 `.hvp`。

**痛点**

- 旧打包器在 ZIP 头中多写一个 `u16(0)`，HiViewer 报 `Invalid Central Directory header`；修正 ZIP 后，宿主继续暴露 checksum 从对象包装层到直接 map 的 schema 不兼容，说明仅检查 ZIP 头不能替代宿主源码 schema 验证。

**闭坑**

- 以后修改 `.hvp` 前必须同时检查 ZIP 标准解压、`manifest.json`、`checksums.json` 的字段结构和 HiViewer 实际安装错误；artifact 外层 ZIP 必须先解压，安装时选择内部 `.hvp`。

**验证**

- Windows 临时 fixture 使用 `Expand-Archive` 解出 4 个文件，确认 checksum map 覆盖全部 payload 且 SHA-256 无不匹配项。
- `npm run typecheck`、`node --check scripts/plugin-package.mjs`、`git diff --check` 通过；GitHub Actions 运行 `42743035184` 的插件编译、标准解压校验和 artifact 上传成功。
- 未在本机运行 Cargo/Tauri 编译，也未在本机 HiViewer 实际安装；最终宿主安装仍需使用最新 artifact 验收。

### 2026-11-10：HiViewer 多候选图片联动匹配

**亮点**

- `plugins/luxe-image-sync/native/src/main.rs` 将活动主图与测试机对应焦点图作为有序候选发送，`src-tauri/src/image_sync.rs` 保留旧 `imagePath` 并限制候选数量；`src/services/imageSyncService.ts` 优先对全部焦点候选精确路径匹配，再对全局唯一文件名回退，复用既有 `setExternalImageSelection` 和 TOML 加载流程。

**痛点**

- HiViewer `ViewerSnapshot.files` 是导航列表而非选择单元格集合，不能直接把全部列表当作当前多选；当前插件协议可可靠获得主焦点图和测试机焦点图，任意多选集合仍需宿主增加 selected paths 字段。

**闭坑**

- 新增跨进程候选字段时必须同时更新 TypeScript 类型、Rust envelope、插件 sidecar，并保留 `imagePath` 兼容；文件名回退必须要求全局唯一，歧义时保持原索引不动。

**验证**

- `npm run typecheck`、受影响 Rust 文件 `rustfmt --check`、插件 Rust `rustfmt --check`、`git diff --check` 均通过；GitHub Actions `42758868085` 与 `42758867958` 成功，artifact `luxe-image-sync-windows-x86_64` 已上传。

### 2026-11-10：插件窗口命令状态注入修复

**亮点**

- 插件 Tauri `select_image` 命令改为读取已注册的 `Arc<BridgeState>`，与 `.manage(state.clone())` 的实际类型一致；窗口新增 LUXE 连接状态和禁用态按钮，错误信息直接显示发送阶段。

**痛点**

- 旧包能启动并接收 HiViewer 快照，但 A/D 调用在 Tauri 命令解析阶段报 `state: not managed`，因此用户看到窗口却无法反向控制 LUXE。

**闭坑**

- Tauri 命令的 `State<T>` 必须与 `Builder.manage(...)` 注册的精确类型一致；使用 `Arc<T>` 管理共享后台状态时，命令签名必须使用 `State<Arc<T>>`。

**验证**

- `npm run typecheck`、插件 Rust `rustfmt --check`、`git diff --check` 均通过；没有运行本地 Cargo/Tauri 编译。`npm run plugin -- check plugins/luxe-image-sync` 因本地没有 CI 生成的 `bin/luxe-image-sync.exe` 而失败，完整包检查由 Actions 执行；`.hvp` 安装和按钮现场交互仍需用户验收。

### 2026-11-10：插件后台同步与测试机列路由

**亮点**

- manifest 收敛为单一 `sync` native-view 命令；插件窗口的关闭事件只隐藏窗口，sidecar 进程继续接收 HiViewer 快照；`testMachineColumnPath` 存在时只发送 `testMachineCurrentPath`，否则只发送主图焦点。
- Named Pipe 发送队列改为 Tokio `watch` 最新值通道，快速切图时新选择覆盖旧待发送内容，减少 LUXE 追赶过期图片的延迟。

**痛点**

- 旧 manifest 同时暴露 `view/open` 和 `viewer/update`，用户会看到两个实际打开同一窗口的入口；关闭 native 窗口还会结束宿主会话，导致后续快照无法抵达插件。

**闭坑**

- native-view 后台同步必须保证至少一个宿主会话持续存在；关闭 UI 应隐藏窗口而不是销毁进程。测试机列是否启用必须由 `testMachineColumnPath` 判断，不能把主图和测试机图同时作为同步候选。

**验证**

- 本轮运行 `npm run typecheck`、插件 Rust `rustfmt --check`、`git diff --check`；Rust/Tauri 编译、包检查和现场关闭窗口/快速切图验收交由 GitHub Actions 与 HiViewer 实机完成。

### 2026-11-10：HiViewer A/D 切图与快照更新顺序保护

**亮点**

- `plugins/luxe-image-sync/native/src/main.rs` 的 `select_image` 在同一个快照读锁周期内校验路径并写入发送队列，避免校验后新 HiViewer 快照先更新、旧 A/D 指令随后覆盖新选择。

**痛点**

- 旧流程在路径校验后释放快照读锁，再单独加锁写入队列；新快照与旧 A/D 指令的并发时序可能让旧选择最后入队。

**闭坑**

- `select_image` 的快照校验和入队必须处于同一个快照读锁保护周期；宿主更新快照后再入队，确保新快照选择拥有较新队列序号。

**验证**

- `npm run sync:test` 17 项通过，`npm run typecheck` 通过，受影响 Rust 文件 `rustfmt --check --edition 2021` 通过，插件 `bridge.js` 的 `node --check` 通过，`git diff --check` 通过。未运行 Cargo/Tauri 编译或测试；HiViewer 与 LUXE 桌面双向验收未执行。

### 2026-11-10：更新检查代理失败回退与版本清单校验

**亮点**

- `src/services/updateCheck.ts` 保留 Tauri updater 的签名更新路径；当 updater 因代理、清单或签名读取异常失败时，改为读取代理和 GitHub 直连的 `latest.json` 元数据，并返回 Release 手动更新入口，避免网络故障直接显示通用失败。
- 远端清单与当前版本比较前同时校验两侧稳定语义版本，异常版本不再被误判为“已是最新”。

**痛点**

- 旧流程只在 `check()` 返回空值时读取清单；`check()` 抛出网络或签名异常会直接结束，代理临时不可用时无法获得 Release 入口。

**闭坑**

- 元数据 fallback 只负责发现版本和打开 Release 页面，不执行未签名安装；实际下载与安装仍必须由 Tauri updater 完成签名校验。代理端点失败后才尝试 GitHub 直连，并记录两次请求错误。

**验证**

- `npm run release:test` 29 项通过，`npm run typecheck` 通过，`git diff --check` 通过。当前环境无法访问 GitHub/gh-proxy，未进行远端 `latest.json` 实时读取；桌面更新下载和安装未实测。

### 2026-11-10：收敛 GitHub Actions 为三条工作流

**亮点**

- `.github/workflows/` 保留 `ci.yml` 代码验证、`plugin.yml` HiViewer `.hvp` 构建、`release.yml` LUXE 正式发布三条职责独立的工作流；README 的触发条件、产物与发版步骤与实际 YAML 对齐。
- 删除 Star 事件触发并覆盖稳定 Release 资产的 `star-release.yml`，同步移除只供该流程使用的 `prepare-star-version` 脚本、测试和 `prepare-release.mjs` Star 分支。

**痛点**

- Star 工作流使用带预发布版本的构建产物替换稳定 Release 的安装包和 `latest.json`，让用户事件可以改变正式更新通道，且产生的行为与固定稳定 tag 的发版说明不一致。
- README 在许可声明之后残留英文 Star-triggered build 章节，工作流表和方案依据也继续描述已取消的覆盖行为。

**闭坑**

- 新增、删除或合并 workflow 时，同步检查 README 自动化流程、触发路径、artifact、脚本入口和 package scripts；正式 Release 资产只允许 `release.yml` 产生。

**验证**

- `npm run release:test` 24 项通过，`npm run typecheck`、`npm run version:check`、`git diff --check` 通过；`.github/workflows/` 仅剩 `ci.yml`、`plugin.yml` 和 `release.yml`，README、package scripts 与 scripts 中无 Star workflow/版本脚本引用。本次未触发远端 GitHub Actions。

### 2026-11-11：MTK JPEG 私有 EXIF 内置解析与 DP 兜底

**亮点**

- `src-tauri/src/image_scan/mtk_exif.rs` 依据 `MTK_3A_EXIF_Extraction_Guide.md` 接入 APP5/APP6/APP7、模块目录、版本/签名、分片 KV/顺序数组和 AF 重复值；以 `include_str!` 从 `src-tauri/resources/mtk_exif/headers/` 内嵌 18 份指南使用的 M149、Samsung A06、Redmi 14C 精确枚举资源，不复制完整约 25 MiB 的资源目录，也不增加 Python/DLL 运行时依赖。
- `metadata_source.rs` 让既有全字段、分组和按键 IPC 在缺少同名 TOML 时按需直接读取 JPEG，无需先点解析；已有 TOML 继续作为兼容覆盖。数据源路径/类型与文件签名隔离缓存，DP 生成 TOML 后可切换来源而不命中旧 JPEG 缓存。
- `image_scan/mod.rs` 在 SOS/EOI 停止、限制元数据/文本读取为 16 MiB，不解码像素；复用缓存并增加全字段 16 MiB、按键 8 MiB 的估算载荷预算，LRU 与 `trimMemory(true)` 代次清理保持一致，当前图片全字段缓存可直接提供批量所需键。
- 手动按钮只复制需要 DP 的图片；部分直接结果不落盘，避免下一次导入 DP 后被已有部分 TOML 挡住重试。`commands/image_cmds.rs` 限制元数据 2 个任务、手动解析 1 个任务；五种语言显示直接/兜底/未补全统计，目录刷新保留完成时的当前选择并隔离过期结果。

**痛点**

- 仓库没有真实 MTK JPEG 与 DebugParser 对照样本，无法在本地确认各固件字段逐项一致；未覆盖的签名/头文件仍需 DP 兜底。曾在实现阶段考虑落盘部分 TOML，但它会阻断以后配置 DP 的重试，最终改为只通过按需读取提供部分字段、不生成部分 sidecar。
- 解析任务不能由发起它的 React 组件负责共享收尾：切换 AE/Tone 会卸载旧组件；共用的图片选择代次还会被“配对选中同一路径”递增，导致正常元数据加载无法退出 loading。最终将刷新移入 `imageExifService.ts`，分离实际加载 `loadRevision`、共享内容 `metadataRevision` 与原有远端选择代次；EXIF 详情和会话缓存也必须带内容代次，否则同路径 DP 补全后仍显示旧字段。
- 项目规定本地不得运行 Cargo/Tauri 编译或测试；Rust 行为测试、真实 DP、桌面按钮与内存/CPU 降幅尚未实测。此次只执行了前端/Node 可观察回归与 Rust 静态检查，不把参考项目的历史样本结果当成本次验证。

**闭坑**

- 增加新 MTK 固件时，必须同时更新 `mtk_exif.rs` 的段签名/版本映射、对应 `headers/` 变体和真实 JPEG 对照；同名 ISP 头文件不能按文件名替代签名变体。
- 修改解析流程时检查已存在 TOML 保留、直接解析优先/EXIF 文本兜底、部分结果不落盘、同 stem 多图片拒绝猜测、DP 路径可选、临时目录清理及原子落盘。
- 共享 EXIF 任务跨切页仍须更新既有图片索引；新目录和真实 A→B→A 加载应隔离旧结果，但配对选中意图不应阻断加载收尾。运行 `scripts/image-exif.test.mjs`，检查同路径详情重读、内容代次和配对会话缓存。

**验证**

- `npm run typecheck`：通过。
- 隔离 Node 22.23.4 执行 `node --test scripts/image-sync.test.mjs scripts/workspace-persistence.test.mjs scripts/image-exif.test.mjs scripts/image-table-mapping.test.mjs src/views/mtk/isp6s/TablePane/*.test.mjs`：最终 57 项通过，含新增 8 项 EXIF 回归；新脚本已加入 `npm run sync:test` 的 CI 入口。
- 五份 EXIF 翻译键与统计插值：通过。18 份内嵌资源首次标签/索引对照通过；最终 Node 22 复核 18 份 UTF-8/路径/空白与 ISP 1649/1647 项变体通过，17 份仍可读取的参考头文件再次比对通过。最终复核时参考目录的 `ISP/variants/a56121c4/ISP_6_10_2.h` 已不可读取（ENOENT）；保留之前已复制并比对过的内嵌变体，未修改参考目录。
- `rustfmt --check --edition 2021`：新增 `mtk_exif.rs`、`metadata_source.rs`、`image_direct_exif.rs` 通过；旧 `mod.rs`、`image_cmds.rs`、`image_exif_parse.rs` 的 HEAD 与当前版本均报告全文件格式差异、无语法解析错误，未为本次功能重排无关代码。
- `git diff --check`：通过（仅报告工作树现有 LF/CRLF 转换提示）。
- 未运行 `cargo build/check/test`、`npm run rust:test`、`tauri:dev` 或桌面交互；真实 MTK 样本逐字段比对、DebugParser 兜底实机和内存/CPU 采样交由 GitHub Actions/Windows 桌面验收。

### 2026-11-11：原生 EXIF 目录与模块完整性边界补强

**亮点**

- `image_scan/mtk_exif.rs` 优先使用有界、对齐的有效目录长度，不再将首个模块的零值推测为额外目录记录；备用模块数和保留字扫描均有界。数组读取在有效模块偏移表下限制到所属容器，不借用后续容器填充枚举。
- AWB/ISP 顺序数组要求精确枚举的全部数值；未找到完整数组时将不完整状态传到 `needs_fallback`，即使 AE 能解析也不将结果落盘为完整 TOML。
- 重复同模块目录声明不再以首条胜出，重复 index-0 KV 数据块不再跨块覆盖；受影响模块停止命名解码，块版本与所选头文件版本保持一致。未知非零 APP5/6/7 声明已在此前修订中保留兜底资格，本轮增加回归保护。

**痛点**

- 旧 `max(目录头长度, 保留字扫描长度)` 会在合法 8 容器 APP7 中吞掉全零 ISP 数组的版本锚点；只用 2 容器或首批字段非零的 fixture 看不到该边界。
- 旧数组读取的 `min(剩余字数, 枚举字数)` 加最小标签数阈值会将截短块当成完整结果；只返回空字段也不够，若 AE 正常仍会写出不完整 sidecar，因此必须传播模块失败状态。
- 重复声明的首个枚举与分片合并后保留的后块数值可能来自不同版本；对于当前按模块展平的 IPC，拒绝猜测比输出看似合理的错误字段更安全。

**闭坑**

- 修改目录识别时同时检查目录头长度、模块数、首个模块零值和容器偏移，不把首个偏移值当成目录扫描长度。修改顺序数组时覆盖“短块 + 足量后续填充”，并检查 AE 成功时仍保持 partial。
- 修改 KV 链接或目录去重时同时覆盖同版本/不同版本的多个 index-0 块及重复声明。`image_direct_exif.rs` 应确认部分结果不生成 TOML，后来添加 `.jpg.exif` 后仍能完成兜底并切换缓存源。

**验证**

- `rustfmt --check --edition 2021 src-tauri/src/image_scan/mtk_exif.rs src-tauri/src/image_scan/metadata_source.rs src-tauri/tests/image_direct_exif.rs`：通过。
- `npm run typecheck`：通过；隔离 Node 22.23.4 重跑图片联动、工作区、EXIF、列映射与表格用例：57 项通过。
- 新增 7 个 Rust 单元测试和 1 个 Rust 集成测试，等待 `.github/workflows/ci.yml` 执行；未在本地运行 Cargo/Tauri 编译或测试，未使用真实 JPEG 或 DP 实机验收。
- `git diff --check` 和未跟踪文件空白检查：通过，仅有仓库既有 CRLF 转换提示；未新增密钥、构建产物或本地状态文件。

### 2026-11-11：共享 EXIF 任务的工作区选择与内容代次收敛

**亮点**

- `src/services/imageExifService.ts` 将进度订阅改为每个调用方独立的监听集合，并支持视图通过 `AbortSignal` 主动解绑；AE Basic 或 ToneMap 卸载不会覆盖另一页的进度回调，也不会让已卸载组件闭包一直挂在长任务上。任务仍只保留进行中的 Promise，完成后清空监听并释放工作区槽位，不缓存图片或完成结果。
- EXIF 刷新携带发起任务的 workspace key，完成时优先保留该视图的最新图片选择；`src/stores/mtkStore.ts` 的 `metadataRevision` 在目录/条目刷新时递增，单纯切换当前图片不递增，避免同路径会话和 EXIF 详情缓存显示旧数据。
- EXIF 搜索、历史、空状态和进度的用户可见文本统一进入五份翻译资源，并保持 Rust 内嵌头文件与 Tauri resource 清单的既有发布配置一致。

**痛点**

- AE Basic 和 ToneMap 共用一个 `imageDir`，但 `imageSelection` 允许两页在关闭同步时各自选图；仅使用全局 `image.current` 会让后台刷新完成后错误地偏向另一页。原先同目录重新扫描也没有内容代次，旧的同路径会话缓存可以继续命中。
- 共享任务只有一个 `onProgress` 回调时，后挂载的页面会抢走前一个页面的回调；页面切换期间若不隔离回调，过期组件仍可能收到任务进度。

**闭坑**

- 新增共享异步任务时，任务状态、监听器和视图选择意图分开管理：监听器使用集合，视图卸载通过 `AbortSignal` 解绑，任务结束再清理剩余订阅；完成选择使用稳定 workspace key，并验证路径仍在刷新前后的条目中；数据集刷新才递增 `metadataRevision`，普通 selection load 不触发内容失效。
- 修改 `setImageDir` 时不要把 selection patch 同时当作条目刷新；调用方若替换 `entries` 或目录必须允许内容代次变化。新增或迁移 EXIF 头文件时同时核对 `include_str!` 路径与 Tauri resource 清单。

**验证**

- `npm run typecheck`：通过。
- `npm run sync:test`：28 项通过，覆盖共享任务双回调、卸载订阅解绑、发起视图选择保留、数据集代次与既有联动/工作区回归。
- Node JSON 校验：五份翻译资源与 `src-tauri/tauri.conf.json` 解析通过。
- `rustfmt --check --edition 2021`：新增 `mtk_exif.rs`、`metadata_source.rs`、`image_direct_exif.rs` 的既有检查通过；`mod.rs`、`image_cmds.rs`、`image_exif_parse.rs` 仍报告仓库既有全文件格式差异，未为本轮重排无关代码。
- `git diff --check`：通过，仅报告工作区既有 LF/CRLF 转换提示。未运行 Cargo 编译/测试、Tauri 构建或桌面交互验收；真实 JPEG、DebugParser 和性能采样仍需 CI/Windows x64 产物验证。

### 2026-11-11：JPEG→TOML 刷新时的字段请求与列表代次隔离

**亮点**

- `src/ipc/imageScan.ts` 的 `loadImageTomlFieldsBatchShared` 强制接收 `{ entries, revision }`；以索引弱引用分组，并将内容代次、键和路径组成合并身份。进行中请求成功或失败后释放槽位，不保留完成结果，不向 Rust IPC 添加参数，也不改变现有缓存预算。
- `TablePane.tsx` 的可见行与预取请求在布局提交/卸载时同步失效，每代持有独立 loading 集合；旧成功、旧失败和旧 `finally` 均不能回填新缓存或清除新请求标记。缓存恢复仍放在普通 effect 中，避免把全目录遍历放入阻塞绘制的 layout effect。
- 分类、排序、Apply、`ImagePane.tsx`、`ChartMapMode.tsx` 和 `ToneChartMapMode.tsx` 传递同一内容代次；即使索引数组未替换，热力图和已解析 Apply 数据也不会被当成新内容。排序的异步完成随卸载失效。

**痛点**

- 后端以 JPEG/TOML 来源区分缓存并不足以保证前端刷新：原合并键只有路径和字段，新的 effect 会复用仍在进行的旧 JPEG 请求。列表原来只检查 keySignature，原地刷新时甚至不会重新运行字段 effect，旧请求也能写入已经重置的局部缓存。
- 仅忽略旧 `then` 不够：旧 `catch` 可写空行，旧 `finally` 可删除新代次正在使用的路径标记；仅在每个滚动 effect cleanup 中取消请求也会丢弃仍可复用的同代结果。因此分别隔离数据集代次与可见窗口变化。

**闭坑**

- 字段合并必须同时校验索引身份和内容代次；所有调用方必须提供上下文，不能只给路径和键。缓存写入、失败回退、loading 清理与组件卸载都要检查对应生命周期，普通同代滚动仍允许回填有预算的缓存。
- `scripts/image-exif.test.mjs` 通过 TypeScript AST 提取实际列表和热力图加载 effect 执行回归，不用另一份状态机模拟实现；保留“同路径/同键/只变 revision”“换 entries”“旧失败后返回”“卸载后返回”及旧请求不得移除新请求槽位的用例。

**验证**

- 修复前隔离 Node 22.23.4 运行新增回归：11 项既有用例通过、5 项新增用例失败，复现了跨代合并和刷新后未重新发起字段读取；修复并扩展后 EXIF 脚本 20 项通过（新增 9 项）。
- `npm run typecheck`、`npm run sync:test`（37 项）、`npm run version:check`：通过。
- 隔离 Node 22.23.4 执行 `node --test --test-reporter=spec scripts/image-sync.test.mjs scripts/workspace-persistence.test.mjs scripts/image-exif.test.mjs scripts/image-table-mapping.test.mjs src/views/mtk/isp6s/TablePane/*.test.mjs`：69 项通过。
- `git diff --check`：通过，仅有既有 LF/CRLF 转换提示。本条只覆盖前端字段链路；未执行 Rust 编译/测试或 Tauri/Windows 桌面交互验收，不将回归测试通过表述为性能降幅或真实 DP/JPEG 字段已验收。

### 2026-11-12：EXIF 声明容器归属与空模块兜底修复

**亮点**

- `src-tauri/src/image_scan/mtk_exif.rs` 的 `Declaration` 保留自身 APP 段和目录序号对应的 payload，AWB/ISP 顺序数组只在该模块所属容器内搜索。空 payload 不再从范围列表过滤，避免后续模块序号前移；非法多容器偏移不再退化为整段数组搜索，单声明单容器旧布局继续兼容。
- 模块解码结果为空时显式传播 `needs_fallback`；AF 查找首条锚点前确认其数值完整，避免只含版本和 key 的截断块被输出成成功模块。其他支持字段可继续按需读取，手动导出不会落成不完整 TOML 阻断 DP 重试。
- 新增 7 个 Rust 单元测试和 2 个集成测试：包含 ISP/AWB 内部伪版本交叉命中、空范围槽位、非法偏移、多个 APP 段归属，以及 AE 正常但 AF/Common/MFNR 缺失/截断时不落盘并可后续文本兜底（含第 5 代场景）。

**痛点**

- 原数组读取仅要求候选落在任意合法 payload，无法证明字段属于当前模块：短 ISP 后的完整 AWB 普通字段恰好含 ISP 版本和零值时，可能被重新命名为完整 `SW_LCE_*` 字段；两个模块都是支持版本，不能依赖未知模块自动触发兜底。
- AF/Common/MFNR 的失败分支返回空向量并被包装成 `Some`，通用调用方却把它当成功。只要 AE 正常即可生成只有 AE 的 TOML，之后有完整 `.jpg.exif` 也会因已有 TOML 被跳过；必须在解码结果层修复完整性，而不只是隐藏空标签。

**闭坑**

- 修改容器解析必须保留目录记录原始序号、空容器槽位与所属 APP 段。验证“某个容器剩余空间够长”不能代替验证“该声明拥有该容器”；不要在非法 offset 表下偷偷退回整段搜索。
- 修改模块返回值时同时检查空字段、截断首条记录与 `needs_fallback`，并让 `image_direct_exif.rs` 证明不生成部分 sidecar、后续 `.jpg.exif` 可补全且缓存正确切换源。

**验证**

- `rustfmt --check --edition 2021 src-tauri/src/image_scan/mtk_exif.rs src-tauri/src/image_scan/metadata_source.rs src-tauri/tests/image_direct_exif.rs`：通过。
- 已核对上述新增测试与实际公开加载/导出入口的断言；Rust 测试未在本地执行，等待 `.github/workflows/ci.yml`。审计阶段的 Python `-I` 逻辑镜像只用于展示旧算法的候选误选，不当作修复后的 Rust 行为实测。
- 前端 `npm run typecheck`、`npm run sync:test`（37 项）、`npm run version:check` 通过；隔离 Node 22.23.4 扩展回归 69 项通过。`git diff --check` 与未跟踪文本行尾空白检查通过，只有既有 LF/CRLF 提示。
- 未运行 Cargo/Tauri 编译、构建或开发服务器；真实 JPEG 逐字段对照、真实 DebugParser 调用、桌面交互和性能采样仍未验收。

### 2026-11-12：EXIF 模块导航、AE_Table 与 Detail 来源契约

**亮点**

- `src/types/ipc.ts`、`src/ipc/imageScan.ts` 与 `src-tauri/src/image_scan/exif_document.rs` 增加结构化的 `load_image_exif` 契约，复用原 2 任务元数据队列，不增加详情缓存、工作区持久状态或 capability 权限。旧的字段、批量和分组 API 保持兼容。
- `ExifTable.tsx`、`ExifMetadataViews.tsx`、`ExifRows.tsx`、`exifPresentation.ts` 将模块导航、普通虚拟字段表、单块/全部统计矩阵及七列诊断分开；只挂载当前子页。搜索不移除导航，DP 的 ISP_HW_*/MF/CMN/RESVA 等节按模块合并但保留原始字段前缀；矩阵通过等宽文本保留形状和全部数值，TOML 排序不会把 15×15 放到 5×5 之前。
- EXIF 来源区分实际 JPEG 直读、DP 生成的 TOML、内置解析导出的 TOML 与来源未知的旧 TOML。新导出写入 `[__luxe_exif]` schema 1；没有记录时不根据文件扩展名猜生成工具，也不拿图片的诊断/统计混充 TOML 内容。
- `debug_parser_to_toml` 单独处理 `[AE_Table]` 下的 `<<块名>>` 纯数字行，保留第 5 代含空格的块名和重复 AF 值。来源节、统计形状和数值不进入扁平关键字命名空间，避免 `parser`、`rows`、`values` 等通用叶名遮住真实图片字段。
- `src-tauri/build.rs` 自动收集 13 模块的 353 份第 5/6 代头文件（22,037,931 字节），以固定预算嵌入；`mtk_headers.rs` 按版本、签名、受限条件枚举选择真实索引，不再手写 18 份匹配表。头文件向量随单次读取释放，没有全目录枚举缓存；保留 Samsung 精确变体，显式拒绝 13 份已知无效定义，资源审计进入 CI 既有 `sync:test` 入口。

**痛点**

- 普通 `TAG:value` 转换器无法提取没有冒号的统计网格；已有 TOML 如果此前已经丢弃这些行，不能靠界面修改恢复数据。旧 TOML 也没有足以证明生成工具的来源标记，因此必须如实显示“生成来源未记录”。
- 头文件“已匹配”、模块“已解码”、版本识别来源与标签读取来源是不同维度。参考 IPEParser 的旧指南已删除，当前 ISP 同名版本采用签名条件枚举；不能继续把旧指南中的 variants 路径和历史测试数量当作当前实现或本次实测。
- 合并 DP 子节后，显示键带上原始节前缀会改变 `^SW_LCE_` 等已收藏正则的匹配位置；字段搜索同时匹配完整路径与裸标签，保留来源可读性而不破坏原有锚定搜索。
- 统计内容及来源数组会触发原快读器的完整 TOML 回退，也可能让全字段叶名别名污染列表。快读入口须识别保留节/数组表与根级 dotted key；新增测试必须先请求按键字段，再读取全字段，避免已有全字段缓存遮住快读回归。
- 收尾发现 type10 统计头不足 16 字节、尺寸未知或 revision 未支持时，若只是跳过统计而不标记未补全，同图正常 AE 会让导出被误判完整。`mtk_ae_tables.rs` 对已识别统计族的这些失败显式传播 `incomplete`；新增单元与公开导出集成断言，保证有正常 AE 的图片也不会落下遮住 DP 重试的部分 TOML（Rust 行为待 CI）。

**闭坑**

- 修改详情契约同时检查 Rust 导出类型、`src/types/ipc.ts`、IPC 封装、命令注册和 capability；检查切图/同路径 revision/卸载后的迟到结果、搜索不隐藏 Detail、未知版本仍可诊断、已有 TOML 的显式覆盖与原字段缓存切源。
- 修改统计必须校验真实形状、值数量和边界；type8 的 u24 直方图、type10 的通道容量与实际 6×8，以及第 5 代枚举声明但缺失的数据不能混用。缺失块不伪造零矩阵，来源未知不伪造 DP 归属。
- 新增 `.h` 只意味着增加候选枚举，不能代表所有新布局或所有资源版本已支持。头文件匹配与解码状态分开；Rust 合成行为测试仍由 CI 执行，真实私有 EXIF 需同一 JPEG 的原生输出对照。

**验证**

- `npm run typecheck`：通过。隔离 Node 22.23.5 执行 `npx --yes --package=node@22 -c "npm run sync:test"`：48 项通过；EXIF 脚本为 27 项，包含来源、固定导航、诊断过滤、DP 节别名/锚定搜索、矩阵完整性/顺序与统计块选择的实际组件/逻辑回归；新增 4 项头文件资源审计一并通过。
- 隔离 Node 22.23.5 执行 `node --test --test-reporter=spec scripts/image-sync.test.mjs scripts/workspace-persistence.test.mjs scripts/image-exif.test.mjs scripts/mtk-headers.test.mjs scripts/image-table-mapping.test.mjs src/views/mtk/isp6s/TablePane/*.test.mjs`：80 项通过。`npm run version:check`：通过。
- `rustfmt --check --edition 2021 --config skip_children=true` 检查 `build.rs`、`mtk_exif.rs`、`mtk_headers.rs`、`mtk_ae_tables.rs`、`exif_document.rs`、`metadata_source.rs`、`image_exif_details.rs`、`image_direct_exif.rs`：通过；修改过的 `mod.rs`、`image_cmds.rs`、`lib.rs` 用 `rustfmt --emit stdout --edition 2021 --config skip_children=true` 非编译静态解析通过。新增 Rust 集成测试覆盖来源切换、未知旧 TOML、DP 统计/重复值、未知版本诊断、保留节不能污染字段命名空间，以及正常 AE 不得遮住 type10 未补全统计，尚未执行。
- `git diff --check`：通过，仅有既有 LF/CRLF 转换提示；367 个未跟踪文件的文本行尾空白检查通过，未发现新增禁止产物、updater 私钥/密码或本地 `state.toml` 文件名。
- 未运行 Cargo/Tauri 编译、Rust 测试、前端打包或桌面交互验收；未生成实际窗口截图。真实 JPEG、DebugParser.exe、安装包、深浅主题/滚动交互和分进程性能采样仍需 GitHub Actions 产物或用户桌面验收。

### 2026-11-12：移除嵌入枚举的安装资源重复副本

**亮点**

- `src-tauri/tauri.conf.json` 的 `bundle.resources` 移除 `resources/mtk_exif/headers/**/*`，保留翻译和三个运行期 TOML；353 份头文件继续由 `build.rs` 的 `include_str!` 嵌入，不额外部署一份 22,037,931 字节原始头文件库。`scripts/mtk-headers.test.mjs` 的打包断言同时检查头文件及其目录祖先，防止以后用宽泛资源 glob 或父目录递归复制重新引入副本。

**痛点**

- 枚举从磁盘资源改成编译嵌入后，旧 Tauri resources glob 仍保留，造成同一数据既进入二进制又作为安装资源复制。仅检查 glob 字符串是否含 `mtk_exif` 不足以拦截 `resources/**/*` 之类的间接重复；安装包压缩后的体积变化不能用原始文件字节数冒充实测。

**闭坑**

- 改动资源清单前确认运行期仅引用内嵌 `HEADER_SOURCES`、没有磁盘头文件读入入口；运行资源打包审计，确保翻译与配置仍保留、宽泛目录/文件匹配均会被拦截。updater 的代理、公钥和版本不在本次调整范围。

**验证**

- Node 22.23.5 执行 `node --test --test-reporter=spec scripts/mtk-headers.test.mjs`：4 项通过，含递归父目录/宽泛 glob 检测；`npm run version:check`、`npm run typecheck`：通过。
- Node 22.23.5 重跑原 80 项扩展回归（`--test-reporter=dot`）：80 项通过；`git diff --check`：通过，仅有既有 LF/CRLF 提示。
- 未进行 Rust/Tauri 构建或安装包大小实测；实际产物及桌面验收仍等待 GitHub Actions/用户环境。

### 2026-11-12：EXIF 左置、空模块导航收敛与安全清理/真实进度

**亮点**

- `Isp6sAeVisual.tsx` 把 AE Basic 与 ToneMap 的 EXIF 标签排到最左侧，保留原标签 ID、默认选择和滚动会话；`exifPresentation.ts` 仅为实际字段与有效统计生成导航，未解码/仅识别版本的模块保留在 Detail。`ExifMetadataViews.tsx` 移除识别来源列，六列共用布局；来源路径不占用行内空间，改为来源徽标的悬浮提示。
- `TablePane.tsx` 的 EXIF 图标使用 Fluent `Menu openOnContext`：左键进入 DebugParser 覆盖确认，右键进入 JPEG 直读补缺合并；两种写入模式清晰分离，不提供删除 TOML/EXIF 的入口。`imageExifService.ts` 复用共享刷新，目录身份/加载代次变化时旧结果不能覆盖新工作区。
- `mtk_exif.rs`、`metadata_source.rs`、`exif_document.rs` 与 `load_image_toml_with_progress` 在真实读取/模块/统计/结果投影步骤上发出 Channel 进度；`MetadataProgress.tsx` 统一当前图片、EXIF 详情和既有目录解析的 Fluent 进度条。排队不确定、缓存直接完成，不引入计时器、模拟百分比、额外图片缓存或强制全目录预解析。

**痛点**

- 匹配头文件/识别版本并不意味着有字段；用诊断行建立导航会产生 Sensor/MFNR/N3D 等空页面。现在以实际 payload 字段和通过形状验证的统计建立标签，仍保留失败诊断方便排查。
- 本轮不再提供删除文件操作，右键只做 JPEG→TOML 补缺合并，避免误删用户手工 TOML/EXIF；左键 DP 覆盖在目录级确认后执行，并由后端保留写失败原文件。- `Option<Channel<T>>` 不能按普通 serde 参数推导，编辑器给出 `CommandArg`/`Deserialize` 错误；最终 Rust 命令接收具体 Channel，TypeScript 包装始终提供通道，无订阅方时使用空回调，原有 TS 调用方式保持兼容。旧请求的 Channel 回调与 Promise 结果须一起失效，否则只隔离结果仍可能让旧 JPEG 进度回写新图片。

**闭坑**

- 清理只能经“只读预览→明确确认→执行前重验→受限删除→清缓存与共享刷新”；确认后换目录拒绝执行，已发出请求允许完成但不得刷新新工作区。不得在本次开发或验收中真实删除用户目录内容。
- 后端清理与 EXIF 写出复用 `EXIF_TASKS`，命令结束调用 `clear_memory_caches()` 防止旧读取回填；前端仅刷新同一索引快照。检查清理失败/部分失败后任务标记释放、选择保留、同路径详情与列表/热力图重新读取。
- 读取进度是工作单位而非字节或耗时百分比；每条成功/失败回调、缓存命中、切图、同路径 revision、完成后迟到消息和卸载都要有回归。新增权限不需要扩大 capability，五语言文案与参数插值保持一致。

**验证**

- `npm run typecheck`：通过；Node 22.23.5 执行同步入口同四脚本 `node --test --test-reporter=spec scripts/image-sync.test.mjs scripts/workspace-persistence.test.mjs scripts/image-exif.test.mjs scripts/mtk-headers.test.mjs`：61 项通过（EXIF 为 40 项）；加上列映射与 `TablePane/*.test.mjs` 的扩展回归：93 项通过。新增 Node 回归执行实际组件/共享服务/工作区读取 effect，覆盖标签顺序、空模块、六列对齐、路径只进 tooltip、右键范围、确认取消、失败刷新与过期进度。
- `npm run version:check`：通过。`rustfmt --check --edition 2021 --config skip_children=true` 检查 `metadata_import.rs`、`metadata_pipeline_tests.rs`、`mtk_exif.rs`、`metadata_source.rs`、`exif_document.rs`、`image_prepared_reads.rs`：通过；`mod.rs`、`image_cmds.rs`、`lib.rs` 经 `rustfmt --emit stdout --edition 2021 --config skip_children=true` 非编译静态解析通过。
- `git diff --check`：通过，仅有既有 LF/CRLF 提示；371 个未跟踪文件文本行尾空白检查通过，没有新增禁止的生成产物、updater 私钥/密码或本地 state.toml 文件名。
- 新增 Rust 对账/DP pipeline fixture 测试覆盖自动复用、native 合并、DP 强制覆盖、空/失败输出、原子写入、临时目录隔离、图片变化和 source 选择；进度集成用例覆盖真实步骤与失败不得报告成功，均未本地执行，等待 CI。
- 未运行 Cargo/Tauri 编译、Rust 行为测试、前端打包或实际窗口验收；未生成本轮桌面截图，也未对用户真实图片执行删除。右键菜单、确认对话框、悬浮提示、真实 JPEG/DP 进度和 Windows 删除句柄行为仍需 GitHub Actions 产物/用户桌面验收。

### 2026-11-12：导入期 JPEG 优先对账与统一 TOML 磁盘缓存

**亮点**

- `src-tauri/src/image_scan/metadata_import.rs` 新增 `prepare_image_metadata`，逐图处理、只保留单图结果；有旧 TOML 也先核验 JPEG，实际字段身份、值类型/重复数组基数和完整统计块形状构成严格超集时才升级，不能只比总条数。等量/缺字段/未知节保留旧数据，已读 partial 以真实 `needs_fallback` 落盘，普通 JPEG/PNG 可保存 metadata-only 失败状态，后续点击不重复解码。
- 自动导入优先复用合法 TOML，不再计算或依赖全量准备指纹；仅右键 native merge 主动读取 JPEG，固定 Rayon 1–2 worker 和有界完成通道。不新增长期全目录内存缓存。
- `MtkView.tsx` 的导入与启动恢复统一调用 `imageExifService.ts::prepareWorkspaceImageDirectory`，目录全部准备后才发布 entries。进度/摘要/任务状态属于共享 `imageDir`，同任务去重、切 AE/Tone/卸载后仍完成收尾；旧目录/旧加载代次回调不能写回新数据集，普通点击不再创建 JPEG 进度通道。`src-tauri/src/commands/image_cmds.rs` 的字段/批量字段/分组/详情全部调用严格 prepared TOML 投影，即使文件缺失也不退回隐式 JPEG。
- `exif_document.rs` 与 `src/types/ipc.ts` 统一输出当前 TOML 的 parser/content_mode 来源；`ExifMetadataViews.tsx` 只在 Detail 显示一个描述性来源徽标，不再显示首次/最新历史。`ExifTable.tsx` 将白底内置搜索栏放回模块标签上方，轻品牌色标签/交替行通过语义令牌跟随主题，普通字段列标题保留无障碍文本但不占一行。
- 手动 `parse_debug_parser_directory` 是左键 DP 权威覆盖：同批复用目录 scope/inventory、使用新空临时输入、只采用本次生成的 payload。右键 `merge_image_metadata` 是 JPEG 补缺合并：已有值和未知节优先，只有有效增量原子写入。两者均不删除图片或用户已有 EXIF，失败保留原 TOML。

**痛点**

- 原先详情每次挂载都会重新解码同一 JPEG，工作区字段和详情各自展示进度；仅去掉进度条不能减少解析。必须在导入期统一保存并把全部 UI 投影约束为 TOML-only，写失败或外部删除时也不能偷偷回读 JPEG。
- 把 partial 直接保存为已有 TOML 会被原“文件存在即跳过”逻辑锁死。需要持久化未补全状态、手动任务显式纳入、DP 仅补缺且保留 JPEG 权威值；失败/未知结果也要有签名，避免同一不支持图片每次点击重复尝试，而头文件/策略升级又必须自动失效旧签名。
- 根级 `AE_TAG_*` 与 `[AE]` 字段若按原始路径比较会永远互不覆盖，兜底合并还可能生成裸键/嵌套键重复并让大小写别名结果不一致。仅对明确标签前缀进行模块归一化，保留未知原节；DP合并把同一身份放回唯一旧位置，不用新值改写既有裸键/嵌套值。
- 自动覆盖前需保护旧文件并发编辑、只读/占用、损坏/非UTF8/超限、同stem多图片和link/reparse。实现保持明确失败，使用有界已检查句柄读取、`create_new` 临时文件+sync、已有文件原子rename/新文件no-clobber发布，不remove后重建，不把写入失败表述为缓存已建立。

**闭坑**

- 任何新的页面/字段读取都走 `src/ipc/imageScan.ts` 严格 TOML 命令；不要把底层为兼容测试保留的显式lazy JPEG helper重新接回普通点击。准备完成前不发布旧entries供列表/热力图抢读。
- 覆盖比较须忽略 AE_DISPLAY/Detail/来源元信息的“数量优势”，但不能丢失未知旧业务字段、缩短AF重复项或用部分统计覆盖完整块。已有真实读取失败/损坏文件不得当空文件覆写，具体边界以Rust临时fixture测试为准。
- 自动导入不因头文件或策略变化自动重扫已有 TOML；用户需要右键主动复查 JPEG。Detail 只显示当前 TOML 的 parser/content_mode；普通切图不重新读取图片。磁盘 TOML 复用不是性能测量结果。

**验证**

- `npm run typecheck`、`npm run version:check`：通过。Node 22.23.5 执行同步入口同四脚本：66 项通过（EXIF 45 项），加列映射与 `TablePane/*.test.mjs` 的扩展回归：98 项通过。实际组件/入口/服务回归覆盖搜索置顶、普通点击无进度通道、当前来源徽标、TOML优先复用、JPEG合并/DP覆盖、准备去重与切页收尾、迟到进度、失败重试、目录替换及原字段/联动隔离。
- `rustfmt --check --edition 2021 --config skip_children=true` 对 `build.rs`、`metadata_import.rs`、`metadata_source.rs`、`exif_document.rs`、`image_metadata_import.rs`、`image_prepared_reads.rs`：通过；`mod.rs`、`image_cmds.rs`、`lib.rs` 以 `rustfmt --emit stdout` 非编译静态解析通过。新Rust测试包含自动TOML复用、缺失时native生成、右键补缺合并、左键DP权威覆盖、单图进度/工作线程、严格TOML投影及裸键身份边界，尚未执行，交CI。
- `git diff --check`：通过，仅有既有 LF/CRLF 提示；374 个未跟踪文件的文本行尾空白检查通过，没有新增禁止生成产物、updater 私钥/密码或本地 state.toml 文件名。
- 未运行 Cargo/Tauri 编译、Rust 行为测试、前端打包或桌面交互；没有在用户真实目录运行准备/合并/覆盖，也未生成实际窗口截图。真实 JPEG/DebugParser逐字段对照、安装包与深浅主题/进度体验、Windows原子写行为和内存/响应耗时仍需GitHub Actions产物或用户桌面验收。

### 2026-11-12：EXIF TOML优先复用、JPEG补缺与DP权威覆盖及有界加速

**亮点**

- `metadata_import.rs` 将自动导入改为合法已有 TOML 直接复用（来源/字节不变、cached计数），仅缺失文件才native生成；去掉原全量指纹与既有文件背后的JPEG复查，`build.rs` 同步移除不再使用的源码/头库指纹计算。手动 `merge_image_metadata` 才主动native读取、保留旧值/重复数组前缀/未知节/统计块并补缺，无有效增量不写。新文件直接root写来源，仅native文本parse一次、最终serialize一次；不盲目升级当前 `toml 0.8.2`。
- 元数据处理复用 `Rayon 1.10.0` 固定1–2 worker池，每worker循环处理一图、有界channel只传完成消息，调用线程单调汇总进度；没有每图无限spawn或全目录完整payload collect。可观察批次日志包含operation、total、reused、native_parsed、written、failed与elapsed_ms，不将代码改动当作已测性能结果。
- `mod.rs::read_jpeg_metadata` 在SOS/EOI停止，只保留APP5/6/7并seek跳过标准EXIF/缩略图/像素表。`mtk_exif.rs` 与 `mtk_ae_tables.rs` 用锁定 `memchr 2.8.0` 运行时CPU分派的有界word搜索替代逐字节候选比较；保持未对齐/重叠命中与完整尾部/容器校验，不强制AVX2或target-cpu=native。type8优先标准尺寸候选但不再对APP6做两遍全扫，数值数组直接写String、KV分片复用map。
- `mtk_headers.rs` 每次inspection用至多16身份/2MiB估算枚举向量的局部缓存复用infer→resolve、重复声明及失败解析，调用结束释放；缓存key含实际头路径和签名，不混淆ISP1649/1647布局。候选选择不再构造多份Vec，枚举索引为有界向量、先前符号为哈希查找。
- `parse_image_exif` 命令接到新的 `parse_debug_parser_directory`：左键明确确认后强制fresh工具解析，不native解码、不借旧sidecar、不跳过已有完整TOML；同批 `DebugParserMetadataWriter` 只扫描/固定目录一次，逐图预检、成功只用新DP业务覆盖，坏/空输出或写失败保留原文件。右键菜单变为当前/全部/已选图片JPEG比较合并，旧删除TOML/EXIF的commands、IPC、services、组件、Rust实现和测试已移除。
- `ExifMetadataViews.tsx` 仅显示描述性来源徽标，区分读TOML及内容来自native/native_merge/DP replace/旧未知/metadata-only，取消首次/最新来源字段；新TOML保留schema1的parser/content_mode/needs_fallback，旧history兼容但不展示。五语言文案、类型和capability边界核对，未扩大权限。CI可选手动参数metadata_benchmarks会用release运行ignored benchmark_ fixture，默认正常CI不运行基准。

**痛点**

- 首次导入原流程的可确认浪费不仅是串行读取，还包括已存在TOML背后的native复查、多轮TOML stamp/serialize/parse、全payload指纹和重复段扫描；仅换TOML库或加线程不会去掉这些工作。TurboJPEG require-simd属于像素预览，不是私有EXIF APP元数据加速。
- 用户本轮把左键由“补缺”改成“DP权威覆盖”、右键由“删除”改为“native合并”，两种写语义必须分离。JPEG同键不改旧值、DP成功则不保留旧业务；旧文件缺来源不能猜为DP，已有partial/metadata-only必须忠实显示兜底资格。
- 两线程会让单图中间对象最多两份，SIMD也只加速候选查找，不代表读取硬盘本身AVX2加速。局部cache对大header失败/变体要有上限，不能为提速降低重复声明、完整枚举跨度或所属payload校验。真实Windows字段、工具及吞吐仍待CI/桌面采样。

**闭坑**

- 自动导入valid TOML必须字节不变、无JPEG读取、无来源历史重戳；手动native merge才重试未知/旧固件。添加头文件后不会自动重扫全部已有TOML，需右键主动复查，不把不再使用的准备签名接回热路径。
- DP覆盖只能使用本次新空临时目录中的正常输出，空/失败不能清空已有TOML；只读/占用/链接/同stem/超限/并发改动保护均保留，损坏旧文本只在明确DP替换中允许覆盖。主线程metadata_pipeline_tests通过注入工具回调验证，不在开发时执行真实用户工具或写真实图片目录。
- 新增memchr直接依赖复用锁文件已有2.8.0，手工同步Cargo root依赖、AGENTS与02技术表，不本地运行Cargo；编译/ABI/行为结果须由CI确认。版本表不根据清单范围猜实际版本。

**验证**

- 本轮 `npm run typecheck`、Node22.23.5 `npm run sync:test`（66项）、扩展图片/工作区/EXIF/资源/表格回归（98项）、`npm run version:check` 均已通过；新增/改写Node回归覆盖取消删除API、native current/all/selected范围、与DP互斥、缺parser不降级、单一来源徽标、DP覆盖确认取消和目录代次失效。
- 受影响Rust文件使用 `rustfmt --check --edition 2021 --config skip_children=true`，未统一格式的既有 `mod.rs` / `image_cmds.rs` / `lib.rs` 用 `rustfmt --emit stdout` 非编译静态解析。新增Rust fixture覆盖auto reuse/native merge/DP replace/单线程进度回调、APP段跳过、DP本次新结果与空失败隔离，均待CI。ignored benchmark尚未运行，CI手动参数只提供可复现执行入口，不声明提速百分比。
- 未运行 Cargo/Tauri 编译、Rust测试、前端打包、真实JPEG/DebugParser调用或桌面截图/交互验收；不宣称安装包已验证或测得真实内存/耗时降幅。独立只读审查的一次任务因工具API错误提前终止，不将其算作已通过审查。

### 2026-11-12：合并诊断按当前内容聚合与DP转换减少往返

**亮点**

- `exif_document.rs::merged_content_modules` 统一按当前 TOML 聚合模块的实际保存观测数，归一化明确根级标签和 ISP/MF/CMN 等模块别名；重复数组按实际值计数，排除 AE_DISPLAY/Detail/统计/保留元信息。`metadata_import.rs::stamp_root` 对 native_merge 替换而非追加历史模块列表；合并业务每模块一行，清除无法归属于整个混合结果的 header/version/signature，保留最新 native 的诊断-only模块及去重未知/冲突记录，总行数仍受256预算限制。
- 旧 native_merge 文件在 `load_prepared_image_exif` 的读取投影中也按内容归一化，不改原文件；对外已有来源契约不变，不增加图片/目录缓存。读取投影直接取走来源对象中的 modules 向量复用，避免再克隆一份历史诊断。
- `merge_observations` 对重复数组延长改为值前缀匹配：旧数组与 incoming 同位置必须一致，标量提升为数组也要求第一项相同；不同日志保留旧数组整条，不再只按类型与长度拼成混合数据。兼容原“已有值优先、只补缺”行为，但对冲突样本更保守。
- `debug_parser_to_toml` 直接在已有解析 root 写入来源并最终序列化，复用内容聚合获得真实重复观测计数；删除展示字段字符串构造及旧 `to_string → from_str → to_string` 往返。完整输出与原文本/统计解析契约保留，不新增格式依赖。

**痛点**

- 只对历史诊断完全相同的条目去重并不等于同模块内容合并：DP AE 行和新 JPEG AE 行会并列，decoded_fields只是各次解析计数，旧文件里的Vendor字段也可能完全没有诊断。纯native与混合结果的头文件归属不同，不能让新native枚举替保留的DP/手改字段背书。
- 已有 AF `[10,20]` 与新日志 `[90,80,30,40]` 只按类型补尾会制造 `[10,20,30,40]`；标量10和新数组 `[99,11]` 同理。该风险与普通同键标量优先保留不是一回事，需要显式前缀一致断言。
- 核对时修正文档中过度表述：自动复用 TOML 仍要做一次有界读取与解析校验，并非完全跳过 TOML 解析；真正跳过的是 JPEG I/O/native解码、指纹比较、重序列化和来源重写。未测量前不能写成速度或内存降幅。

**闭坑**

- 合并后反复读取/再次合并要验证每模块一行、计数对应当前保存数据、数组重复项数量、未知业务节可见、摘要/统计不计入字段、混合业务不伪称精确头文件；旧累计文件的读取修正不得触发自动重写。
- 诊断归一化维持真实未知/冲突与未支持模块，不能通过隐藏失败或将它们标为decoded消除重复。诊断模块名/行数/观测数超预算时明确失败，不能输出前后端不能接受的列表。
- DP转换优化应保持有效数值/重复项/AE_Table、source.parser及needs_fallback契约，减少序列化不等于取消可观察回归；Rust测试仍交CI。

**验证**

- `npm run typecheck`、`npm run version:check`：通过；Node22.23.5四脚本同步入口：66项通过，扩展图片/联动/工作区/EXIF/资源/表格回归：98项通过。此轮无UI/IPC协议变更，既有自动导入/右键merge/左键DP交互仍通过前端回归。
- 实际运行 `rustfmt --check --edition 2021 --config skip_children=true` 检查 `exif_document.rs`、`metadata_import.rs`、`image_metadata_import.rs`、`image_prepared_reads.rs`：通过；`mod.rs`、`image_cmds.rs`、`lib.rs` 仍用 `rustfmt --emit stdout` 非编译静态解析通过。新Rust单元用例覆盖内容计数/去重/歧义/上限、冲突数组前缀和DP重复项计数，集成用例覆盖连续合并与旧累计文件读取不改字节，未执行，待CI。
- `git diff --check`：通过，仅有既有LF/CRLF提示；2个未跟踪文件文本空白检查通过，未发现新增禁止生成物、updater私钥/密码或本地state.toml文件名。
- 本轮没有运行Cargo/Rust编译或测试、Tauri启动、真实工具/图片处理、桌面截图及性能benchmark。未声称真实字段一致性、速度倍数或内存降幅已验收；未提交或推送。

### 2026-11-12：EXIF 右键直读覆盖、悬浮换行与 DP 分阶段进度

**亮点**

- `TablePane.tsx` 将 EXIF 操作改为直接 `onContextMenu`：右键立刻调用当前目录的 `replaceWorkspaceImageMetadata`，不经过菜单，也不再调用比较合并 IPC；左键保留 DP 覆盖确认。三行操作提示复用 `GlobalTitleTooltip` 委托入口，明确 `below-start`、`wrap=true`、最大宽度 360，不为每行/单元格新增 tooltip 实例。
- `replace_image_metadata` 复用 `metadata_import.rs` 的有界 1–2 worker、目录 scope、原字节快照和原子写入，以本次 native 有效业务完整替换旧内容，标记 `parser=native / content_mode=native`；不解析旧业务文档或合并数组/统计。无可用新数据、非 JPEG 或失败时保留已有文件，partial 仍保留真实待 DP 状态。旧 Rust 合并 API/旧来源投影仅兼容既有文件和测试，不再暴露给按钮/IPC；自动导入 TOML 优先与普通切图 TOML-only 不变。
- `parse_debug_parser_directory_with` 在逐张安全检查/复制时发 `PREPARE`，阻塞工具调用前发未知百分比的 `DP 0/0`，逐张转换/写入发真实 `TOML` 计数；排队、完成后刷新分别为 `QUEUED / REFRESH`。`imageExifService.ts` 在工具返回后屏蔽迟到 Channel 消息，刷新仍匹配的数据集并保留完成时选中项。
- `MetadataProgress.tsx` 移入共用图片列表卡片内部，以语义主题背景/边框、图标、阶段标题、右对齐等宽计数和 Fluent 进度条替换工作区全宽薄条；AE Basic/ToneMap 共用入口，左右卡片顶边不再随解析进度整体移位。DP/排队/刷新使用不确定动画和说明，不新增定时器、监听器或完成结果缓存。五语言补齐阶段及操作说明。

**痛点**

- 悬浮长提示仅设置 `title`，委托 tooltip 默认 `white-space: nowrap`，即使外框有最大宽度，文字仍会越出；修复点应是该长提示的换行/定位契约，不是降低字体或扩大所有全局 tooltip。
- `main.tsx` 的捕获监听会 `preventDefault()` 禁用浏览器原生右键菜单；Fluent `MenuTrigger` 看到 `event.isDefaultPrevented()` 又直接退出，导致原业务菜单没有出现。直接事件处理有意不以该标志拦截业务，并独立检查空目录/任务忙状态，不能为恢复一个按钮而放开全应用原生菜单。
- 原 DP 在复制全部图片和等待外部工具期间只发一个 `DP 0/N`，前端把它当确定零进度；现有调用链没有收到外部工具的可靠百分比，不能用轮询时间或输出文件大小编造百分比。此改动改善阶段可见性，不声称缩短 DebugParser 本身的计算耗时。

**闭坑**

- 右键覆盖范围是当前目录全部图片，提示必须明确新内容替换旧业务；不恢复删除 sidecar 或补缺合并菜单。损坏旧 TOML 可在明确覆盖时替换，但只读/占用/link/reparse/同 stem/16 MiB/并发改动保护不放宽；不能用空 native 输出覆盖有效旧 TOML。
- 检查真实按钮 JSX 与全局 capture 处理一起执行的回归；只调用自造 onClick 不能覆盖 `defaultPrevented` 导致的菜单故障。进度用例需断言工具调用前已发布 DP 状态、PREPARE/TOML 含失败图数、工具失败不发假完成；晚到消息和卸载订阅不得重开进度。
- UI 静态/行为回归不能代替 Windows/WebView2 桌面截图及真实 JPEG/DP 验收。性能收益目前只限于取消旧业务解析和比较合并的代码路径，未测量速度倍数、峰值内存或工具耗时。

**验证**

- `npm run typecheck`、`npm run version:check`：通过。Node 22.23.5 的 EXIF 单脚本 49 项通过；图片联动/工作区/EXIF/头库/表格五脚本组合 72 项通过（`npx --yes --package=node@22 node --test --test-reporter=spec scripts/image-sync.test.mjs scripts/workspace-persistence.test.mjs scripts/image-exif.test.mjs scripts/mtk-headers.test.mjs scripts/image-table-mapping.test.mjs`），覆盖五语言插值一致、直接右键覆盖范围、全局取消菜单后仍触发、未知 DP 百分比、REFRESH 屏蔽晚到消息、目录切换清理进度/确认及原有内容代次隔离。
- `rustfmt --check --edition 2021 --config skip_children=true src-tauri/src/image_scan/metadata_import.rs src-tauri/tests/image_metadata_import.rs src-tauri/src/image_scan/metadata_pipeline_tests.rs`：通过；既有未统一格式的 `mod.rs` / `image_cmds.rs` / `lib.rs` 用 `rustfmt --emit stdout --edition 2021 --config skip_children=true` 非编译静态解析通过。新增 7 项 native 覆盖用例、既有安全用例的 replace 路径及 DP 阶段 Rust 行为用例尚未执行，等待 GitHub Actions。
- `git diff --check`：通过（仅 LF/CRLF 提示）。检查 21 个改动文件、0 个未跟踪文件，新增路径无禁止产物/本地 state/updater 密钥文件名，新增文本无常见私钥/GitHub token 标记。未运行本地 Cargo/Tauri 编译、Rust 行为测试、真实用户图片/DP 工具、性能 benchmark 或桌面截图；不把类型检查当作桌面交互验收。未提交或推送。

### 2026-11-12：Face Link Target 加权后极值限制与双来源边界

**亮点**

- `src-tauri/resources/face_table.toml` 在 `FLT.Link_FACE_CWR` 原加权公式外包 `limit(...)`，直接引用已有 `TOP.极值限制_low / TOP.极值限制_high`，与详情表范围同源；不新增一套求值器或先四舍五入范围。`FaceTable.tsx` 既有表达式/悬浮代入自动展示新公式，`Cal_FLT / Cal_Gain` 跟随钳制后结果。
- `ChartMapMode.tsx::calculateFaceTargetMetrics` 保留 raw blend 与 EXIF/参数两套实际上下限，FLT 模式在加权结束后调用既有 `limitNumber`；EXIF 使用图片 `AE_TAG_FACE_LOW_BOUND / AE_TAG_FACE_HIGH_BOUND`，参数使用 AE.cpp 标量 `[0][4][1].19 / [0][4][1].20`，两者范围基数均为 `AE_TAG_AE_TARGET`。标题/公式栏和图片列表复用最终结果，FBT `Back Scene Target` 行为不变。
- `loadFaceCwrBounds` 在已有源码加载中只读取两个精确标量，字段并入 `FaceFbtSource.fields`，`previewFaceCwrBoundsFromDraft` 按既有源码 token 映射响应草稿修改；无新全局缓存/后台任务/持久化设置。`TablePane.tsx` 的批量键列表补入基数和两个 EXIF 系数，避免当前图可算、批量列表却缺边界。
- 新增 `scripts/face-link-target.test.mjs` 并加入 `npm run sync:test`：直接执行实际资源公式/Face 求值器/卡片计算器/加载器/草稿映射/公式 JSX，而不是维护另一份测试用计算逻辑。新增 Rust schema 断言验证 limit 与上下限引用资源契约，等待 CI。

**痛点**

- 顶部“极值限制”此前仅展示范围，`Link_FACE_CWR` 和卡片最终混合值没有消费它，不能只改公式文字。限制必须位于整条加权表达式外，不能先钳制 FLTCwrTarget 再混合；也不能用 NormalTarget 替代截图公式的 AE Target 基数。
- AE.cpp 的 `.19 / .20` 标量与同编号 `[19] / [20]` 数组职责不同；读取宽泛父路径或对缺失值取首个邻接字段会误用 BV/DR 轴。缺少参数边界不能借 EXIF 边界填补，否则“参数计算”来源错误；EXIF 无参数文件仍应独立计算。
- 原值显示有整数/一位小数格式化，新增钳制须保留内部精度，只在显示时格式化；缺失边界不能当零或无限范围，真正零边界仍有效。首次 rustfmt 检查发现既有两行及新测试路径行格式差异，格式化该小文件后复查通过。

**闭坑**

- 用例必须覆盖低于/高于/恰好位于边界、混合后才限制、颠倒/相等/零边界、缺基数/系数、两来源范围不同、FDSZ 来源切换、源码标量与数组区分、草稿同一行多个 token、批量键齐全及 FBT 不受影响。
- 公式栏要同时保留 raw 中间值与 final 值，标题/列表使用 final；Face 表 `Cal_Gain` 不能绕过已钳制的 `FLT.Link_FACE_CWR`。无效输入显示 `-`，不静默返回未钳制数值。
- 此次仅新增公式/标签/路径等原始数学标识，无新自然语言 UI 文案、IPC 命令或状态持久化字段。桌面截图、真实 AE.cpp 与 EXIF 数据对照仍需 Windows CI 产物验收，不将 Node JSX 逻辑测试等同于实际布局验收。

**验证**

- `npm run typecheck`、`npm run version:check`：通过；`npx --yes --package=node@22 node --test --test-reporter=spec scripts/face-link-target.test.mjs`：21 项通过；`npx --yes --package=node@22 -c "node --version && npm run sync:test"`：Node 22.23.5，91 项通过。
- `rustfmt --check --edition 2021 --config skip_children=true src-tauri/src/config/face_table.rs`：首次仅格式差异；使用 rustfmt 格式化后复查通过。没有本地执行 Cargo build/check/test、Tauri 启动/编译、Rust 行为测试或真实图片/参数交互。
- `git diff --check`：通过（仅 LF/CRLF 提示）；新增测试文件另外检查空白/语法。未提交或推送；实际桌面显示及新增 Rust 测试仍待 CI/产物验收。

### 2026-11-13：Face Link 公式摘要与参数路径超链接

**亮点**

- 新增同目录 `ImagePane/FaceLinkFormula.tsx`，将 Face Link 原八行展开式改成 EXIF/参数两行“加权值、限制范围、最终值”对照，显示范围内/抬至下限/压至上限/数据不全状态。只格式化显示一位小数，不修改上一轮共享计算器；未四舍五入的完整公式、代入数值、系数来源和实际 FDSZ_RA 来源保存在行 `title` 中，复用 `GlobalTitleTooltip` 的换行/宽度/焦点委托，不新增监听器或逐行 tooltip 状态。
- 下限 `.19`、上限 `.20` 保持可见路径，使用 Fluent `Link as="button"` 调用 `ChartMapMode.tsx::jumpToFaceCwrBoundSource`，复用 `sourceFieldToken / sourceJumpDetails → onSourceJump → ImagePane.handleSourceJump → param_map`，传精确标量路径、行号、当前草稿 token 与行内 ordinal；不打开外部链接、不保存参数、不新增 IPC。
- 新摘要组件独立负责只读展示，FBT 的原公式展示不变；缺少可用字段/正行号/跳转回调时禁用对应链接。五语言补齐 15 个摘要、状态与跳转说明键；专题文档更新当前展示和路由契约。

**痛点**

- 直接列出每条加权、上下限和钳制代入式导致重复值占据八行；必须区分“日常摘要”和“排查详情”，不能为精简而删除中间结果或缩短内部数值精度。摘要中的范围可排序显示，悬浮仍保留原始 low/high 系数方向。
- 参数路径不能用浏览器 href 处理，也不能只跳到整段源码：低/高值可能在同一行，或在多个位置数值重复；缺少行内 ordinal 或使用旧字段值会选错 token。点击时读取 `sourceDraftTextRef.current`，而非闭包中的旧数值。
- EXIF 的 FDSZ_RA 可切到参数插值，悬浮来源必须随开关变化，但不能同时误切 EXIF 边界来源。未在真实桌面中验收字体/宽度/多语言换行，单元测试不替代 UI 截图。

**闭坑**

- 路径链接应从实际 `cwrBounds.fields` 取 `.19/.20`，拒绝空字段、非正行号及同编号数组路径。复查实际组件调用点、跳转 helper 和 ImagePane 路由整链；缺跳转能力时不能显示可点击的假链接。
- 回归需覆盖摘要只显示两行、可 Tab 聚焦的详细提示、未舍入代入值、逆序/缺失边界状态、两链接分别进入 param_map、同一行两个当前草稿 token、无回调/无字段禁用和五语言插值一致。保留原加权后钳制及 FBT 行为用例。
- 继续使用 Fluent 语义令牌、原有路由/全局 tooltip，不增加数据缓存或后台任务；不借 UI 精简更改计算、持久化或发布权限。

**验证**

- `npm run typecheck`、`npm run version:check`：通过。Node 22 的 `scripts/face-link-target.test.mjs` 专项 25 项通过；`npx --yes --package=node@22 node --test --test-reporter=spec scripts/image-sync.test.mjs scripts/workspace-persistence.test.mjs scripts/image-exif.test.mjs scripts/mtk-headers.test.mjs scripts/face-link-target.test.mjs`：95 项通过。
- `git diff --check`：通过，仅既有 LF/CRLF 提示；新增文件另查空白与脚本语法。保留上一轮尚未提交的计算/资源/Rust 测试变更，没有本地 Cargo/Tauri 编译、真实桌面定位/截图验收；相关桌面交互仍待 CI 产物或用户桌面验收。未提交或推送。

### 2026-11-13：Face 公式整数摘要与等宽悬浮来源对照

**亮点**

- `FaceLinkFormula.tsx` 将摘要行的加权值、限制范围和最终值统一四舍五入为整数；悬浮及参数链接提示统一用 `formulaNumber` 保留一位小数。只在展示边界格式化，不修改传入数据、原始计算精度、钳制状态或跳转使用的真实源码 token。
- 悬浮按“加权计算 / 极值范围 / 最终结果 / 来源”分区，来源对照以等宽“名称、数值 | EXIF 标签或 AE.cpp 路径”列出 AE Target、FDSZ_RA、Normal Target、low/high；`ChartMapMode.tsx` 分别传入上下限来源，参数 FDSZ_RA 显示实际 `face_sz / face_sz_ra` 的 `[0][4][1][47] / [0][4][1][48]` 路径，而不是笼统的“AE.cpp FDSZ_RA”。
- `HoverTooltip.tsx` 新增 opt-in `data-tooltip-monospace="true"`，仅公式和参数路径提示使用 Consolas/Cascadia Mono 等宽字体、tabular 数字、较宽松字号/行距/内边距；既有普通 tooltip 的默认字体和尺寸不变。字体标记参与委托状态比较和重新测量，仍复用原监听器与 portal。
- 五语言新增 4 个分区标题键，保留之前的路径超链接及键盘聚焦能力；当前专题文档同步整数摘要/一位小数悬浮的契约。

**痛点**

- 原 `String(value)` 将 1509.9675516224188 等浮点尾数直接展示，且 tooltip 没有等宽 opt-in，运算与来源混在一起难以核对。不能仅缩小字号或在计算阶段截断数值来解决展示问题。
- 单一 `boundSource` 串同时列两个标签/路径，不易确认数值分别对应谁；来源改成独立 low/high 字段，并把系数值与路径放在同一行。FDSZ_RA 来源随现有开关变化，但 EXIF 上下限仍保持 EXIF 来源。
- 摘要舍入后的端点不等于内部约束端点，不能把显示字符串重新参与 clamp 或参数跳转；边界状态仍按真实未舍入数值判定。未实测 Windows 高 DPI/多语言长路径的实际字体和定位。

**闭坑**

- 新样式必须 opt-in：公式行和链接显式传标记，普通 tooltip 不被全局改成等宽。切换锚点/标记后要重新比较状态，防止上一个提示的字体留到下一个提示。
- 回归需覆盖整数摘要、一位小数代入、分区与“值 | 来源”关联、无长浮点尾数、默认/等宽 portal 样式隔离；既有同一行低/高链接和当前草稿 token 定位仍需通过，不能改成用舍入值检索源码。
- 本轮无新增缓存、观察器、后台任务、IPC 或持久化字段。实际桌面截图/高 DPI/深浅主题验收仍交 CI 产物或用户环境，不以 JSX 和类型测试替代。

**验证**

- `npm run typecheck`、`npm run version:check`：通过；Node 22 的 Face 专项 27 项通过。`npx --yes --package=node@22 node --test --test-reporter=spec scripts/image-sync.test.mjs scripts/workspace-persistence.test.mjs scripts/image-exif.test.mjs scripts/mtk-headers.test.mjs scripts/face-link-target.test.mjs`：97 项通过。
- `git diff --check`：通过，仅既有 LF/CRLF 提示；新增文件另检查空白和脚本语法。保留已有未提交改动，未本地运行 Cargo/Tauri 编译或桌面截图验收；未提交或推送。

### 2026-11-13：Face 原始边界系数对照与数值点击定位

**亮点**

- `FaceLinkFormula.tsx` 在摘要下分两行列出“EXIF 边界 / 参数边界”的原始下限、上限系数，整数展示；EXIF 使用只读、可聚焦的值，悬浮展示独立来源标签和一位小数值。参数行以系数数值本身作为 Fluent Link，路径移至悬浮与无障碍名称，复用此前 `.19/.20` 参数映射和当前草稿 token 选中链路，不新增跳转 API 或计算。
- 原有“整数摘要 / 一位小数等宽悬浮”契约不变，新增非有限系数禁用链接的保护，零值仍可跳转；五语言新增 EXIF 边界名称与系数来源提示，专题文档同步区分原始系数和计算后的限制范围。

**痛点**

- 之前只露出 `.19/.20` 路径，用户无法直接比较 EXIF 与参数的系数；上方 `[66, 6609]` 是乘以 AE Target 后的范围，不能把它放进原始边界栏或代替 `90/9000` 等系数。
- 数值来源必须按行隔离：EXIF 只读值不能绑定 AE.cpp 跳转，参数也不能在缺失时借用 EXIF 值。点击定位须使用真实源码 token，不使用整数显示或悬浮的一位小数文本检索。

**闭坑**

- 回归验证两组系数不同情况下的展示、EXIF 标签关联、参数路径仅悬浮可见、数值本身点击后进入 param_map 并选中同一行正确 token；保留缺字段/缺回调/无效行禁用断言。非有限值显示 `-` 且不绑定点击，零值保持有效。
- 本轮不改变共享计算器、持久化数据或字体委托入口，不为展示系数新增请求、缓存、监听器；真实桌面与截图效果仍需产物验收。

**验证**

- `npm run typecheck`、`npm run version:check`：通过。Node 22 的 `scripts/face-link-target.test.mjs`：29 项通过；`npx --yes --package=node@22 node --test --test-reporter=spec scripts/image-sync.test.mjs scripts/workspace-persistence.test.mjs scripts/image-exif.test.mjs scripts/mtk-headers.test.mjs scripts/face-link-target.test.mjs`：99 项通过。
- `git diff --check`：通过，仅 LF/CRLF 提示。未本地执行 Cargo/Tauri 编译、真实桌面参数选中或截图验收；未提交或推送。

### 2026-11-13：Face 边界并入来源表格与悬浮卡片

**亮点**

- `src/views/mtk/isp6s/ImagePane/FaceLinkFormula.tsx` 将两组原始系数合入对应 EXIF/参数计算行，在加权值右侧增加“边界显示”列，删除表格下重复的边界区域。五列表头和数据继续共用 `colgroup`；系数和计算后的限制范围分别展示，较窄列内下限/上限可换行。
- 参数数值继续使用 Fluent Link，直接复用 `.19/.20 → jumpToFaceCwrBoundSource → param_map` 的当前源码 token、行号与 ordinal 选中链路；EXIF 只读，参数零值有效，非有限系数或缺少跳转能力时禁用。
- 原行 title 长文本改为两行各一个 Fluent Tooltip 卡片，计算分区、最终结果背景强调、来源按名称/数值/路径三列对齐；公式和数值保持等宽、一位小数，路径独立换行。卡片宽高受视口限制并允许纵向滚动，使用 Fluent 语义令牌。复用组件的定位、键盘和清理逻辑，未添加自定义全局监听器或数据请求。
- 五种语言补齐“边界显示”列名并精简来源标题；同步 `docs/features/FACE_TABLE_HEATMAP.md` 与既有 `scripts/face-link-target.test.mjs` 的展示契约。

**痛点**

- 原始边界系数和乘以 AE Target 后的限制范围含义不同，合并列时必须消费 `lowBound/highBound`，不能挪用 `lowLimit/highLimit`。格式化只用于显示，参数定位仍由原回调读取真实草稿 token。
- 行 Tooltip 与全局 title 委托若同时启用，会出现重叠提示；新行显式标记 `data-tooltip-disabled="true"` 并移除子值 title，路径在卡片和链接无障碍名称中保留。局部 Tooltip 仅用于此处固定的两行，不推广到大图片列表。
- 系统默认 Node 为 24，按项目要求以 npx Node 22 运行专项测试；首次被沙箱阻止写入工作区外 npm 缓存，获准后通过。实际 Windows 窗口、高 DPI、深浅主题和短视口滚动未实测。

**闭坑**

- 回归检查五列顺序、每行四个数据单元格、两组系数均在表格内部，原始系数与缩放范围数值不同仍各自正确展示。
- 保留参数链接进入 `param_map` 并选中同一行不同草稿 token 的测试；同时检查缺回调/缺字段/无效行号禁用、零值可点击、五语言键与插值一致，以及悬浮数值未降低计算精度。
- Tooltip 必须同时支持行悬浮和 Tab 聚焦，阻止全局重复提示；长路径与较小视口保留换行/滚动入口，避免隐藏排查所需来源。

**验证**

- `npm run typecheck`：通过；`npx --yes --package=node@22 node --test --test-reporter=spec scripts/face-link-target.test.mjs`：29 项通过。
- `git diff --check`：通过，仅 LF/CRLF 提示。未执行本地 Cargo/Tauri 编译、桌面截图或真实参数映射选中验收；未提交或推送。

### 2026-11-13：ToneMap LCE 原始输入计算链与 Target Weight

**亮点**

- 新增 `ImagePane/toneLceTarget.ts` 集中读取原始 `SW_LCE_LumaProb / SW_LCE_LumaTarget`，修复误用已混合字段的问题；混合目标补 `/1000`，最终混合消费实际重算中间目标，LV 参数插值复用同一链路。保留原概率/最终值取整约定，中间目标不做显示舍入。
- `ToneChartMapMode.tsx` 的 Cal 按概率、混合目标、最终值顺序显示，分别列出 EXIF 记录和重算差值。“LV 参数混合”明确只替换 LVTarget；不把重算值标作设备记录值。
- 新增 `ToneLceTargetWeight.tsx`，放在 Target 参数表下，以原生 SVG/Fluent 蓝绿红语义令牌显示 LV/Luma/Flat 系数占比，图例旁展示四个概率关键字。绘图使用 EXIF 记录的 LVProb/LumaFlatProb；参考值 715/253 显示 71.5%/21.3%/7.2%。无额外 IPC、图表依赖、观察器或持久化设置。
- 新增八项实际计算与 JSX 测试并加入 `npm run sync:test`；五语言补齐对照和异常文案，新增功能专题并更新文档索引。

**痛点**

- 原组件把 `LumaFlatProb` 当作 `LumaProb` 再乘 FlatProb，把 `LumaFlatTarget` 当作 LumaTarget 再混合；底部还缺归一化且未接入顶部，导致错误推导与看似正常的顶部结果并存。修改必须连通整个链路，不能只换一个 key 或改公式字符串。
- 参考图按展示公式重算的中间目标是 1836.973，EXIF 记录为 1774；现有证据无法证明设备是否有其他处理，不能为了数值相等而猜测限制或截断。界面保留差值，权重图明确使用记录概率，不暗中使用另一来源。
- 首次经 Windows PowerShell 管道写入新翻译时非 ASCII 文本被编码成问号；读取后发现，立即以 apply_patch 修复五语言文本，并加入翻译无问号替换校验。既有 Face 未提交改动保持保留。

**闭坑**

- 原始输入、重算中间值、记录中间值必须有独立名称；缺失原始输入显示 `-`，不能借记录值填空而伪装全链路重算成功。记录字段变更不能影响重算结果。
- 图中 LV=v、Flat=(1-v)p、Luma=(1-v)(1-p)，p 来自记录 LumaFlatProb；三项合计 100%，不把概率本身或目标贡献误作最终权重。缺失/越界概率不绘制假分量，零和单分量 100% 均合法。
- 需要验证真实桌面的窄布局、深浅主题、切图以及草稿插值联动；本地类型/JSX 检查不能宣称 Windows UI 已验收。设备后续限制、平滑与整数截断策略仍待算法实现证据。

**验证**

- `npm run typecheck`、`npm run version:check`：通过。使用已缓存 Node 22.23.5 运行 `scripts/tone-lce-target.test.mjs`：8 项通过；Node 22 执行 `sync:test` 对应六个脚本：107 项通过。
- `git diff --check`：通过，仅 LF/CRLF 提示。未执行本地 Cargo/Rust/Tauri 编译或桌面截图验收；未提交或推送。

### 2026-11-13：GBK AE.cpp 加载失败与源码编码统一

**亮点**

- `src-tauri/src/source_text.rs` 集中提供严格源码解码和保留编码写入；编辑器加载、tree-sitter 文件解析、卡片关键词定位三个入口均使用同一份解码文本。支持 UTF-8、UTF-8 BOM、UTF-16 LE/BE BOM，以及 Windows CP936/GBK 无损回退。
- 复用锁定的 `windows 0.61.3`，仅启用 `Win32_Globalization` feature；不增加第三方依赖、编码状态缓存或 IPC。GBK 编码禁止 best-fit，解码/编码分别做往返校验，保存前完成编码，不可表示字符不会截断原文件。
- 新增 `src-tauri/tests/source_text_encoding.rs` 的六项夹具测试覆盖显示/解析/关键词定位/UTF-8 草稿坐标、保留 BOM/换行/GBK 中文、编辑保存、无法表示字符不覆盖及新另存为 UTF-8，由 Windows CI 自动发现。专题文档和核心避坑规则同步记录入口。

**痛点**

- 现场 AE.cpp 共 143444 字节，在 UTF-8 偏移 54239 处失败；Python GBK 与 Windows CP936 严格解码后重新编码均与原字节一致。此前三个读取点使用 `read_to_string`，错误发生在解析前；只替换编辑器读取会让参数映射和卡片跳转继续失败。
- 直接容错解码会把中文替换为乱码，直接 UTF-8 写入会改变参数文件编码；必须同时处理加载、解析坐标和保存。BOM 在统一入口移除，UTF-8 草稿和解析器均基于相同文本计算坐标。
- 未自动猜测其他代码页、无 BOM UTF-16 或 GB18030 四字节扩展；无法确定的编码保持报错。此次不增加原子写入/并发外部编辑保护；保留已有保存接口边界。

**闭坑**

- 后续参数源码读取必须走 `source_text::read_source`；不得使用 `from_utf8_lossy`、原始 GBK 字节列或零散编码回退。图片 TOML/配置 JSON 等仍遵守各自严格 UTF-8 契约。
- 新增 GBK 注释或数值编辑须测无修改字节往返、中文关键词跳转与同一行 token 坐标；无法表示字符和非法原文件必须在写入前失败。新另存为/临时草稿与覆盖已有文件的编码行为应分别验证。
- 现场文件仅被只读诊断，没有转码或覆盖。Rust 修复需要包含改动的 Windows CI 应用产物才能验收；不得把 rustfmt 或前端检查表述为编码行为/桌面加载已经通过。

**验证**

- Python 严格 UTF-8/GBK 检查和 Windows CP936 `System.Text.Encoding` 严格往返：确认现场根因和字节可逆；没有写入原文件。
- 通过 Python ctypes 直接调用与实现相同标志的 `MultiByteToWideChar(CP936, MB_ERR_INVALID_CHARS)` / `WideCharToMultiByte(CP936, WC_NO_BEST_FIT_CHARS)`：现场文件往返字节一致，原文件 SHA-256 保持不变。此检查验证系统 API 与数据，不代替 Rust 行为测试。
- 新模块/测试的 `rustfmt --check --edition 2021`：通过；受影响既有 Rust 文件用 `rustfmt --emit stdout --config skip_children=true` 做语法静态检查：通过，未重排既有文件。
- `npm run typecheck`、`npm run version:check`：通过。Rust 编译与六项行为测试未在本地运行，待 Windows CI；未执行 Tauri 编译或桌面加载/编辑/保存验收；未提交或推送。
- `git diff --check`：通过，仅 LF/CRLF 提示；三个源码读取入口已无 `read_to_string`。
