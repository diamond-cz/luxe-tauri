# LUXE 项目执行规范

## 规范入口

本文件是项目级执行入口。后续修改先读取本文件，再按改动范围读取 [.codex/rules/](.codex/rules/) 中的可验证规则。规则文件的“断言”为合规标准，“示例”给出落地方式，“违规特征”用于审查。

| 改动范围 | 必读规则 |
| --- | --- |
| 所有改动 | [01-人设与开发准则](.codex/rules/01-人设与开发准则.md)、[02-技术栈与核心库](.codex/rules/02-技术栈与核心库.md)、[03-目录与架构规范](.codex/rules/03-目录与架构规范.md) |
| 性能、缓存、图片、异步任务、发布安全 | [04-核心铁律与避坑](.codex/rules/04-核心铁律与避坑.md) |
| React、Fluent UI、窗口、表格、主题 | [05-UI与组件规范](.codex/rules/05-UI与组件规范.md) |
| Tauri IPC、事件、capability、更新下载 | [06-通信与数据获取规范](.codex/rules/06-通信与数据获取规范.md) |
| 用户可见文案、语言资源 | [07-i18n多语言规范](.codex/rules/07-i18n多语言规范.md) |
| Zustand、TOML、持久化配置 | [08-数据库与状态管理规范](.codex/rules/08-数据库与状态管理规范.md) |

如规则与当前代码不一致，先以实际代码和锁文件查证，再在同一改动中修正规则；不得默默绕过断言。规则文件只放在 .codex/rules/，专题维护文档放在 docs/。

## 项目边界

LUXE 是面向 Camera Tuning 工程师的 Windows x64 Tauri 桌面应用。前端使用 React/Vite/Fluent UI，后端使用 Rust/Tauri，通过 Tauri IPC 通信；持久化状态使用 TOML，当前支持 16 种语言。

| 路径 | 职责 |
| --- | --- |
| src/views/、src/components/ | 页面视图、跨页面组件 |
| src/stores/、src/ipc/、src/services/、src/types/ | Zustand 状态、Tauri 封装、服务、共享契约 |
| src/theme/、src/styles/ | 主题令牌与全局样式 |
| src-tauri/src/commands/、src-tauri/src/config/ | Rust 命令、状态模型与配置 |
| src-tauri/resources/、src-tauri/tests/ | TOML 与翻译资源、Rust 集成测试 |
| scripts/、.github/workflows/ | 版本与发布脚本、CI 和发布工作流 |
| docs/ | 专题维护文档，索引为 docs/README.md |

TypeScript 路径别名 @/* 指向 src/*。新增 Rust 命令须同时核对 src-tauri/src/lib.rs、src/ipc/、src/types/ 和 src-tauri/capabilities/。

React 组件使用 PascalCase，函数与变量使用 camelCase；Rust 模块使用 snake_case，错误处理保持显式。提交摘要保持简短且范围清晰；PR 说明影响范围、验证命令、配置或平台行为变化，UI 改动附截图。

## 固定工具链

版本以 package-lock.json 和 Cargo.lock 为准，不以 package.json 中的范围推断安装版本。

| 工具或库 | 当前版本 |
| --- | --- |
| npm / Node.js CI / Rust CI | 11.12.1 / 22 / 1.95.0 |
| React / TypeScript / Vite | 18.3.1 / 5.9.3 / 6.4.3 |
| Fluent UI React Components / Zustand | 9.72.9 / 5.0.9 |
| Tauri Rust / Tauri JS API | 2.12.4 / 2.12.4 |
| i18next / react-i18next | 23.16.8 / 15.7.4 |

安装依赖使用 npm ci。依赖升级时同步核对本表与 02-技术栈与核心库.md。正式版本从 src-tauri/tauri.conf.json 修改，再运行 npm run version:sync 和 npm run version:check。

## 修改流程

1. 运行 git status --short，阅读受影响入口、类型、IPC、测试和相关专题文档；保留已有用户改动。
2. 确定模块和持久化边界，复用现有 API、Fluent 语义令牌、状态写入队列与缓存清理入口。
3. 前端改动至少运行 npm run typecheck；Rust 行为改动运行 npm run rust:test；脚本行为使用 Node 22 的 node:test。配置、解析器和命令变更补充可观察行为测试。
4. 窗口、主题、拖拽、多显示器及更新交互在 npm run tauri:dev 中核对；无法实测时在结果中说明。UI PR 附截图。
5. 完成后运行 git diff --check，检查未跟踪文件、密钥、生成产物和本地状态文件，并更新下述经验账本。

## 性能与安全红线

- 新增图片、Canvas、Blob URL、解析缓存、观察器或后台任务前，必须阅读 docs/performance/MEMORY_RECOVERY.md。
- 缓存须有预算、淘汰条件和清理入口；跨页面清理调用 src/ipc/memory.ts 的 trimMemory(true)。
- 异步结果隔离过期请求；观察器和监听器随卸载解绑。性能问题按 Tauri 宿主、WebView2 browser、renderer、GPU 进程分别测量。
- 更新清单及安装包使用现有 gh-proxy.com 代理与 Tauri updater 签名验证。
- 不提交 .tauri-updater.key、.tauri-updater.password、dist/、src-tauri/target/ 或本地 state.toml。

## 修改经验账本

每次完成修改时，必须更新 [实现亮点与痛点账本](docs/engineering/IMPLEMENTATION_LESSONS.md)；没有新经验时明确记录“无新增亮点或痛点”。新增专题文档时同步维护 [文档索引](docs/README.md)。每条记录包含：

| 字段 | 内容要求 |
| --- | --- |
| 亮点 | 实际方案、可复用入口和受影响路径 |
| 痛点 | 遇到的根因、失败方案、边界条件或残余风险 |
| 闭坑 | 后续修改前要检查的断言、文件或测试 |
| 验证 | 实际运行的命令和结果；未实测项明确标注 |

记录必须对应实际发生的工作；不得把历史背景或计划写成已经验证的结果。只写“优化体验”“修复问题”等不可验证描述不合格。新增专题文档时，同步更新 docs/README.md。

## 交付要求

最终说明使用中文，包含改动文件与行为、可复用亮点、实际痛点与闭坑、已运行的验证命令及未验证项。不要把编译通过表述为桌面交互已验收。
