# 本地工作状态

开发环境使用 `src-tauri/resources/state.toml` 保存 DP 工具路径、各页面参数路径、图片目录、当前图片和页面等轻量状态，与其他可维护 TOML 配置放在同一目录。发布版使用程序旁的 `resources/state.toml`；目录不可写时回退到用户配置目录。

首次启动按以下顺序读取：本目录已有的 `state.toml`、旧项目根目录 `resources/state.toml`、用户配置目录的状态。迁移保留旧文件作为备份；开发目录不可写时直接使用用户配置目录，不继续写旧位置。损坏的状态文件不会被默认值覆盖。应用会校验路径并按需重新扫描或解析，不会自动运行 DP 工具。

状态包含本机路径，已加入 Git 忽略，也不在打包资源清单内。`src-tauri/.taurignore` 排除状态和临时文件，避免保存触发开发应用重启。请退出应用后再手动编辑。

开发验证命令（在项目根目录运行）：

| 命令 | 验证内容 |
| --- | --- |
| `npm run typecheck` | 前端类型检查 |
| `node --test scripts/workspace-persistence.test.mjs` | 选图、参数路径、保存队列和失败恢复 |
| `cargo test --manifest-path src-tauri/Cargo.toml --test workspace_persistence` | 临时目录下的迁移优先级、回退、连续保存和重新加载 |
| `cargo test --manifest-path src-tauri/Cargo.toml --test workspace_persistence migrate_current_development_state -- --ignored --exact` | 显式迁移当前本地状态并核对字段一致性；保留旧文件 |

界面验收：运行 `npm run tauri:dev`，选择 DP 工具、AE/ToneMap 参数文件和图片目录，切换到非首张图片，再正常退出并重新启动。核对路径、页面、选中图片及按需解析结果；也可通过设置打开实际状态目录。无桌面交互的自动测试仅验证状态与 IPC 边界，不代表已完成界面重启验收。
