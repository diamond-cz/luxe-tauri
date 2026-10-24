# 实现亮点与痛点账本

## 用途

每次完成修改后，记录已验证的可复用方案、实际遇到的根因和后续修改的闭坑条件；没有新经验时明确记录“无新增亮点或痛点”。本文不替代 .codex/rules/ 中的规范断言。新记录应包含日期、主题、亮点、痛点、闭坑和验证；每项写出具体路径、行为或命令。未运行的验证必须标为“未验证”。

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
