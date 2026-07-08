# Repository Guidelines

## 项目结构与模块组织

本仓库是一个 Tauri 2 桌面应用，前端使用 React/Vite，后端使用 Rust。

- `src/` 存放 TypeScript React 前端代码。
- `src/components/` 存放可复用 UI 组件，按 `common`、`settings`、`shell` 等领域分组。
- `src/views/` 存放页面级视图和功能界面，MTK 相关视图位于 `src/views/mtk/`。
- `src/stores/`、`src/ipc/`、`src/services/`、`src/types/` 分别存放状态管理、Tauri IPC 封装、服务逻辑和共享类型。
- `src/styles/`、`src/theme/`、`src/assets/` 存放全局样式、Fluent UI 主题 token 和静态资源。
- `src-tauri/src/` 存放 Rust 后端逻辑，包括命令、配置解析、托盘、窗口和业务模块。
- `src-tauri/resources/` 存放随应用打包的 TOML 表和翻译 JSON。
- `src-tauri/tests/` 存放 Rust 集成测试。

## 构建、测试与开发命令

常用命令来自 `package.json`：

- `npm run dev`：启动 Vite 前端开发服务。
- `npm run tauri:dev`：启动完整 Tauri 桌面开发应用。
- `npm run build`：执行 TypeScript 检查并构建前端。
- `npm run tauri:build`：构建生产版 Tauri 应用。
- `npm run tauri:msi`：构建 Windows MSI 安装包。
- `npm run typecheck`：执行 `tsc --noEmit` 类型检查。
- `npm run rust:test`：通过 `cargo test --manifest-path src-tauri/Cargo.toml` 运行 Rust 测试。

开发和构建相关命令会通过 `scripts/sync-version.mjs` 自动同步版本号。

## 编码风格与命名规范

优先沿用现有 TypeScript、React 函数组件和本地代码模式。React 组件使用 `PascalCase`，函数和变量使用 `camelCase`，文件名应清晰表达所属功能。`src/ipc/` 中的 IPC 封装应与 `src-tauri/src/commands/` 中的 Rust 命令保持对应。Rust 代码遵循 2021 edition 习惯，模块使用 `snake_case`，错误处理保持显式。

## 测试指南

前端改动至少运行 `npm run typecheck`，后端逻辑改动运行 `npm run rust:test`。涉及解析器、配置或命令行为时，在 `src-tauri/tests/` 下补充 Rust 集成测试。测试应聚焦可观察行为和边界情况。

## 提交与 Pull Request 规范

近期提交多使用简短祈使句摘要，常见中文描述，也包含 `chore:`、`perf:` 等前缀。提交应保持范围清晰，例如 `优化图片列表加载性能` 或 `perf: optimize image table loading`。

PR 应包含简洁说明、影响范围、已运行的验证命令；UI 改动应附截图。有关联 issue 时请链接，并明确说明迁移、配置变更或平台相关行为。

## 安全与配置提示

不要提交本地密钥、生成产物或大型临时资源。新增 Tauri 命令时，应同步检查 `src-tauri/capabilities/` 中的权限配置，保持文件系统、shell 和通知权限尽量收敛。
