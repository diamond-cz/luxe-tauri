# LUXE

> Camera Tuning 工程师的多平台 AE（自动曝光）算法可视化工具 ── Rust + Tauri 重构版

LUXE 把厂商参数文件（MTK / Qualcomm / Unisoc 的 `AE.cpp` / `Tone.cpp` 等）和
单帧 3A 抓拍数据（`xxx.jpg` + 同名 `xxx.toml`）放在同一界面里联调，方便 tuning
工程师快速核对算法输出与参数文件的一致性、定位异常帧的成因。本仓库是
[hiz / LUXE PyQt5 版](../hiz) 的 Rust + Tauri 重构版（MVP）。

---

## 一、项目作用

| 场景 | LUXE 帮你做什么 |
|---|---|
| 解析参数文件 | tree-sitter-c 直接解析 `AE.cpp` 的嵌套结构初始化列表，无需头文件，全字段路径 `[i][j].k` 化，6163 字段秒级展示 |
| 可视化 AE 卡片 | Normal（MainT/HS/ABL/NS）+ Face·Touch 两张折叠卡，徽章值实时来自当前抓拍图的 TOML + Isp6s.toml schema + 公式（`tar_abl_mt_hs`、`Cal`、`LCE_Gain`、`WT=max(...)`) |
| 文件夹遍历 | 拖入图片目录后自动配对 jpg+toml，下拉切图 + 表格全览（带搜索过滤） |
| 参数核对 | "参数对比" 模式按 `[para_check.items]` 把 `AE.cpp` 字段值与图片 TOML 关键字两栏并排，不一致行红色高亮 |
| 源码定位 | 点任意子卡 → 自动切到 "源码映射" 模式 → 调 `cpp_resolve_card_source` 按 `[card_source.X]` 的 keywords / paths / line_ranges + `re:` 正则解析出代码段 → 黄底高亮 + 平滑滚动到对应行 |
| LCE 折线图 | TablePane 的 LCE Tab 把当前图的 8 个 `SW_LCE_P{n}` / `SW_LCE_O{n}` 画成 canvas 折线 |
| 多平台扩展 | MTK 已完整接入；Qualcomm / Unisoc 复用通用 `CppImportCard` 做参数文件导入 + 解析；后续可在同一外壳里继续加平台 |
| 工程师友好 | 16 种界面语言（hiz 原版同 schema）/ 4 个可热更新的全局快捷键 / 系统托盘最小化 / 多屏自适应窗口 / 深浅色主题 / 界面缩放 90/100/110/125/150% |

---

## 二、技术栈

| 层 | 选型 | 备注 |
|---|---|---|
| 后端 | Rust + Tauri v2.1 | `protocol-asset` + `tray-icon` + `image-png` features |
| 解析 | tree-sitter 0.22 + tree-sitter-c 0.21 | 与 hiz Python 端 7 项契约 diff 测试一致 |
| 缓存 | DashMap + mtime | parser 实例按 canonical path 缓存，超 8 个文件淘汰最旧 |
| HTTP | reqwest + rustls | 异步拉今日诗词 |
| 前端 | React 18 + TypeScript + Vite 5 + Tailwind 3 + Fluent UI v9 | makeStyles 严格只用 longhand，规避 Griffel shorthand 陷阱 |
| 拖拽 | @dnd-kit/core + sortable | 嵌套 DndContext，rAF 提交避重排 |
| 分栅 | react-resizable-panels | 比例 onResize 直接写持久化 |
| 状态 | Zustand + immer | 单字段选择器，禁用对象字面量 selector |
| i18n | i18next + react-i18next | 模块顶层同步 init，避免 hook queue 形态错位 |
| 源码视图 | 自写 line-numbered `<pre>` + 行级高亮 | 6000 行 AE.cpp 流畅滚动 |

---

## 三、环境准备

### Windows（开发 + 打包都需要）

| 工具 | 用途 | 安装方式 |
|---|---|---|
| Node.js 18+ | 前端构建 | https://nodejs.org/ |
| pnpm | 包管理（用 Node 自带 corepack 启用） | `corepack enable && corepack prepare pnpm@latest --activate` |
| Rust 1.77+ | Tauri 后端 | https://rustup.rs/ |
| Tauri CLI v2 | `cargo tauri ...` | `cargo install --version "^2.0" tauri-cli --locked` |
| Visual Studio Build Tools 2022 | Windows 链接器 + Win32 SDK | https://visualstudio.microsoft.com/visual-cpp-build-tools/ 选 "Desktop development with C++" |
| WiX Toolset v3.14 | msi 打包（首次 `tauri build` 时 Tauri 会自动下载，也可手动装） | https://github.com/wixtoolset/wix3/releases |
| WebView2 Runtime | 应用运行时 | Win10 1809+ 一般已自带；Win10/Win11 Evergreen 自动更新 |

### 检查

```bash
node --version            # >= 18
pnpm --version            # >= 8
rustc --version           # >= 1.77
cargo tauri --version     # 2.x
```

---

## 四、开发模式

```bash
git clone <repo> luxe-tauri
cd luxe-tauri

pnpm install              # 第一次拉依赖（首次约 1 分钟）
pnpm tauri:dev            # 启动 Tauri dev，Vite 在 :1420 提供 HMR
```

第一次 `tauri:dev` 会编译 Rust 端（约 3-5 分钟），之后增量编译 < 30 秒。前端
改动走 Vite HMR，几乎瞬间。

### 调试快捷键

| 快捷键 | 作用 |
|---|---|
| `Ctrl+R` | webview 强制刷新（清空 i18n / Zustand store） |
| `Ctrl+Shift+I` | 打开 WebView2 DevTools（仅 dev 模式） |
| 自定义 | 设置 → 快捷键 自配 home / settings / exit / poetry |

### 单独运行测试

```bash
pnpm typecheck            # 前端 TS 类型检查（0 错误为通过）
pnpm rust:test            # Rust 单测 + AE.cpp diff 测试（12 项）
```

注：跑 `rust:test` 前需要先停掉 `pnpm tauri:dev`（exe 被占用无法重链）。

---

## 五、打包发布

### 5.1 一键打包（最常用）

```bash
pnpm tauri:build          # Windows: 同时输出 msi + nsis
```

构建产物路径：

```
src-tauri/target/release/bundle/
├── msi/
│   └── LUXE_0.1.0_x64_zh-CN.msi          ← 推荐分发（WiX 生成）
├── nsis/
│   └── LUXE_0.1.0_x64-setup.exe          ← 备选（体积更小）
└── ...
```

首次构建：Rust release 优化大约需要 5-8 分钟（取决于 CPU）。后续增量 < 1 分钟。

### 5.2 仅打 msi（推荐企业分发）

```bash
pnpm tauri:msi
```

WiX 会自动下载到 `%LOCALAPPDATA%\tauri\WixTools`（首次执行）。如果下载失败，
按 §三 手动装 WiX Toolset v3.14。

`tauri.conf.json` 里的 WiX 参数：

```json
"bundle": {
  "windows": {
    "wix": {
      "language": "zh-CN"     // 安装向导界面用中文
    }
  }
}
```

### 5.3 仅打 nsis（体积更小、自带卸载器）

```bash
pnpm tauri --bundles nsis
```

### 5.4 带 debug 信息的版本（用于排查 release 模式 only 的 crash）

```bash
pnpm tauri:debug
```

产物在 `src-tauri/target/debug/bundle/...`，运行慢但带符号。

### 5.5 升级版本号

每次发版前同步以下三个位置：

| 文件 | 字段 |
|---|---|
| `package.json` | `"version"` |
| `src-tauri/Cargo.toml` | `[package].version` |
| `src-tauri/tauri.conf.json` | `"version"` |

可以加一条 `pnpm run` 脚本统一替换，或用 [tauri-action](https://github.com/tauri-apps/tauri-action) CI。

### 5.6 代码签名（可选，企业分发推荐）

LUXE 默认不签名，安装时 Windows SmartScreen 会提示"未识别的应用"。生产分发
建议用 EV 代码签名证书：

1. 把 `signtool.exe` 加入 PATH（来自 Windows SDK）
2. `tauri.conf.json` 添加：
   ```json
   "bundle": {
     "windows": {
       "certificateThumbprint": "<EV 证书指纹大写无空格>",
       "digestAlgorithm": "sha256",
       "timestampUrl": "http://timestamp.digicert.com"
     }
   }
   ```
3. 再 `pnpm tauri:build`，msi/exe/dll 全部自动签

### 5.7 图标与品牌

替换以下文件即可定制图标（保持文件名与尺寸）：

```
src-tauri/icons/
├── icon.png            (256×256 RGBA, 用于 Win 类图标 + bundle.icon)
├── icon.ico            (multi-size ICO, 用于 .exe / 安装包)
├── 32x32.png
├── 128x128.png
├── 128x128@2x.png      (256×256)
└── tray-icon.png       (256×256 RGBA, 系统托盘)
```

`bundle.publisher / copyright / shortDescription / longDescription` 在
`tauri.conf.json` 修改后下次 `tauri:build` 生效。

### 5.8 macOS / Linux

LUXE 主要面向 Windows，但 Tauri 本身跨平台：

```bash
# macOS（在 Mac 上）
pnpm tauri:build        # 输出 .dmg + .app

# Linux（在 Linux 上）
pnpm tauri:build        # 输出 .deb / .rpm / .AppImage
```

需相应平台原生工具链（Xcode CLT / dpkg / rpm-build）。Windows 上**不能**交叉
编译 macOS / Linux 安装包。

---

## 六、状态持久化

运行时状态存到 `%APPDATA%\luxe-tauri\state.toml`（Windows）/ `~/.config/luxe-tauri/state.toml`（Linux）。

| Section | 字段 |
|---|---|
| `[main_window]` | width / height / screen_w / screen_h（用于跨屏等比缩放） |
| `[settings]` | close_behavior (0/1/2) / language (0-15) / theme / scale (50-200) / cache_path / auto_update / update_notify |
| `[shortcuts]` | home / settings / exit / poetry |
| `[homepage]` | card_order |
| `[mtk]` | current_isp / current_tab + 分割器尺寸 |
| `[isp6s_ae_visual]` | split_mode / split_ratio / split_cards_on_left / image_splitter_ratio / image_splitter_orientation / image_inner_ratios / preview_mode / top_card_order / normal_collapsed / face_collapsed / normal_wf_row_mode / face_wf_row_mode / normal_card_order / face_card_order / normal_col_ratios / face_col_ratios / normal_sub_order |

写盘策略：每次 store 变更后 200ms 防抖，进程退出前 `RunEvent::ExitRequested`
里同步 flush（即使非正常关闭也尽量保住状态）。

---

## 七、目录结构

```
luxe-tauri/
├── README.md                          ← 本文件
├── package.json                       ← pnpm scripts 入口
├── vite.config.ts / tsconfig.json     ← 前端构建
├── tailwind.config.ts
│
├── src/                               ← React 前端
│   ├── main.tsx                       (入口，同步 init i18n)
│   ├── App.tsx                        (路由 + 主题 + 自定义标题栏)
│   ├── locales/                       (16 locale + i18next bootstrap)
│   ├── theme/fluent-tokens.ts         (Fluent v9 brand ramp)
│   ├── stores/                        (Zustand: settings / shortcuts / mtk / isp6sVisual / poetry / window)
│   ├── ipc/                           (typed wrappers for every Tauri command)
│   ├── hooks/useShellBootstrap.ts     (启动 hydrate + 事件监听)
│   ├── components/
│   │   ├── shell/                     (SideNav / TitleBar / CloseBehaviorDialog)
│   │   ├── common/                    (CollapsibleCard / SortableCard / BadgeStrip / CppImportCard / ErrorBoundary ...)
│   │   ├── settings/                  (SectionTitle / SettingRow / KeyRecorder)
│   │   └── icons/FluentIcon.tsx
│   ├── views/
│   │   ├── HomeView.tsx               (Hero + 三张平台卡 + 进度卡)
│   │   ├── QualcommView.tsx / UnisocView.tsx
│   │   ├── settings/                  (通用 / 快捷键 / 关于 三 Tab)
│   │   └── mtk/
│   │       ├── MtkView.tsx
│   │       ├── IspSideNav / IspTabBar / CppImportPanel
│   │       └── isp6s/
│   │           ├── Isp6sAeVisual.tsx  (主可视化容器)
│   │           ├── AeParamCard.tsx
│   │           ├── badges.ts          (徽章值公式)
│   │           ├── SourceCodeView.tsx
│   │           ├── ImagePane/         (4 模式：image / image_split / para_check / param_map)
│   │           └── TablePane/         (5 Tab：Image / Normal / Face / LCE / All + LceChart)
│   ├── assets/luxe-logo.png
│   └── styles/globals.css
│
└── src-tauri/                         ← Rust 后端
    ├── Cargo.toml                     (tauri "2.1" + protocol-asset/tray-icon/image-png)
    ├── tauri.conf.json
    ├── capabilities/default.json      (权限白名单：fs / dialog / window / shortcut / tray)
    ├── icons/                         (多尺寸应用图标 + tray-icon)
    ├── resources/                     (运行时打包：16 locale JSON + Isp6s.toml)
    └── src/
        ├── main.rs / lib.rs           (Tauri builder 装配)
        ├── error.rs                   (AppError + thiserror)
        ├── state.rs                   (tauri::State<AppState>)
        ├── events.rs                  (事件名常量与前端对齐)
        ├── window_geom.rs             (多屏自适应几何算法 + 5 项单测)
        ├── poetry.rs                  (今日诗词拉取)
        ├── shortcuts.rs               (全局快捷键 register/pause/resume)
        ├── tray.rs                    (系统托盘 + 双击恢复)
        ├── config/
        │   ├── state_file.rs          (state.toml 读写 + 200ms 防抖)
        │   ├── state_schema.rs        (持久化字段强类型)
        │   ├── isp6s_schema.rs        (Isp6s.toml schema 反序列化)
        │   └── translations.rs        (16 locale JSON 加载)
        ├── cpp_parser/
        │   ├── parser.rs              (tree-sitter-c 三遍扫描)
        │   ├── types.rs               (FieldEntry / StructNode 与 hiz 对齐)
        │   ├── path_query.rs          (get_fields_at_path 前缀匹配)
        │   ├── search.rs              (by_comment / by_value / by_line / by_range)
        │   ├── card_source.rs         (re: 正则 + block/line/int context + jump_to/highlight)
        │   └── mod.rs                 (DashMap mtime 缓存)
        ├── image_scan/mod.rs          (jpg + toml 配对扫描 + flatten)
        └── commands/                  (所有 #[tauri::command] IPC)
            ├── cpp_cmds.rs            (12 个解析相关命令)
            ├── image_cmds.rs          (scan + load_image_toml)
            ├── state_cmds.rs          (load / save / flush)
            ├── window_cmds.rs         (几何 + show / hide / always-on-top)
            ├── shortcut_cmds.rs       (热更新 + pause/resume)
            ├── close_cmds.rs          (resolve_close_decision + quit_app)
            ├── i18n_cmds.rs           (locale bundle 查询)
            ├── poetry_cmds.rs         (fetch_poetry + emit)
            ├── fs_cmds.rs             (get_config_dir + open_path)
            └── text_cmds.rs           (read_text_file，用于源码视图)
```

---

## 八、与 hiz Python 版的契约保留

LUXE 把 hiz 关键契约 1:1 端口过来，便于把 hiz 端的测试数据直接喂到新版做对比：

| 契约 | 来源 | 保留细节 |
|---|---|---|
| cpp_parser 路径语法 | `hiz/src/core/cpp_parser.py` | `[i][j].k` + `FieldEntry { path, value, comment, line, depth, index, value_type }` + `StructNode` 字段名 |
| Isp6s.toml schema | `hiz/configs/Isp6s.toml` | `card.* / Image / LCE.group / para_check.items / preview_info.items / card_source.*` 字段名 + `context = "block"\|"line"\|<int>` + `jump_to = "first"\|"min"` + `highlight = "ranges"\|"union"` + `re:` 前缀正则 |
| 16 locale 顺序 | `hiz/src/core/i18n.py::_LANGUAGE_LOCALES` | 索引 0=zh_CN … 15=ar_SA 完全一致 |
| close_behavior | `hiz_main.py::closeEvent` | 0/1/2 = ask/tray/quit 语义 |
| 自适应几何算法 | `hiz_main.py::_compute_adaptive_geometry` | `min(curr_w/saved_sw, curr_h/saved_sh)` 夹到 `[1024×380, avail*0.95]`，5 项单测覆盖 |
| 今日诗词 | `hiz/src/core/poetry.py` | 同一 `X-User-Token` + 同一默认句 |

详见 `D:\Image_process\hiz\CLAUDE.md` 中的对照说明。

---

## 九、已知限制 / Roadmap

| 项 | 状态 |
|---|---|
| MTK / ISP6S / AE Basic 可视化（6 卡 + dnd + 分栅 + 4 预览模式 + 5 Tab） | ✅ |
| Qualcomm / Unisoc 参数文件导入 + 解析 | ✅ |
| Normal/Face 表格（normal_table.toml / face_table.toml 映射） | ⏳ |
| 缩略图异步加载（Image Tab 行内 jpg 预览） | ⏳ |
| 6000 行源码视图虚拟滚动 | ⏳（当前直接渲染，AE.cpp 体积下流畅，更大文件可能需优化） |
| ToneMap 可视化 | ⏳ |
| 自动更新 | ⏳（state.toml 已留字段，UI 已暴露开关） |

提交 issue / PR 欢迎走 `[card_source.X]` 这类静态映射的扩展，避免改 Rust 端
即可适配新厂商参数文件。

---

## 十、许可

© 2026 diamond-cz · 仅内部 Camera Tuning 使用。
