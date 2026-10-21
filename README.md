# LUXE

LUXE 是面向 Camera Tuning 工程师的 AE（自动曝光）算法可视化工具，将厂商参数文件与单帧 `jpg + toml` 数据放在同一界面中，帮助核对参数、分析异常帧。

## 功能

- MTK ISP6S AE 可视化：Normal、Face/Touch、LCE、ToneMap、参数对比和源码定位。
- 图片目录扫描、JPG/TOML 配对、搜索、表格和多种预览模式。
- 使用 tree-sitter-c 解析参数文件；Qualcomm/Unisoc 已支持文件导入与解析。
- 16 种语言、主题、界面缩放、托盘、快捷键和应用内更新。

## 开发

当前自动构建目标为 **Windows x64**。环境参照 CI：Node.js 22、Rust 1.95.0、Visual Studio 2022 的 C++ 桌面开发工具及 Windows SDK；包管理器使用 npm。运行应用需要 WebView2 Runtime；Tauri 首次打包会下载 WiX/NSIS 工具。

```powershell
git clone https://github.com/diamond-cz/luxe-tauri.git
cd luxe-tauri
npm ci
npm run tauri:dev
```

使用 npm 和已提交的锁文件；Tauri CLI 已包含在开发依赖中。


| 命令                   | 用途                              |
| ---------------------- | --------------------------------- |
| `npm run dev`          | 仅启动 Vite，完整桌面功能需 Tauri |
| `npm run tauri:dev`    | 启动桌面开发模式                  |
| `npm run typecheck`    | TypeScript 类型检查               |
| `npm run build`        | 类型检查并生成前端`dist/`         |
| `npm run rust:test`    | Rust 测试                         |
| `npm run release:test` | 版本同步与发布清单脚本测试        |
| `npm run tauri:build`  | 本地构建 NSIS + MSI               |
| `npm run tauri:msi`    | 仅构建 MSI                        |
| `npm run tauri:debug`  | 构建调试安装包                    |

Rust 测试需要先运行 `npm run build` 生成 `dist/`。若开发进程锁定可执行文件，先停止 `tauri:dev`。解析器外部 AE.cpp 样例通过 `LUXE_AE_CPP_FIXTURE` 指定；缺少外部样例时会跳过对应断言。

### 代码导航


| 路径                                       | 内容                          |
| ------------------------------------------ | ----------------------------- |
| `src/views/`、`src/components/`            | React 页面和通用组件          |
| `src/stores/`、`src/ipc/`、`src/services/` | Zustand 状态、IPC 和服务      |
| `src-tauri/src/`                           | Rust 命令、解析器、窗口与配置 |
| `src-tauri/resources/`                     | 随应用打包的表格、映射和翻译  |
| `src-tauri/tests/`、`scripts/`             | 集成测试与构建/发布脚本       |
| `docs/`                                   | 功能实现与性能维护文档，见[文档索引](docs/README.md) |

技术栈为 React 18、TypeScript、Vite 6、Fluent UI 9、Tauri 2 和 Rust。开发时状态保存到 `src-tauri/resources/state.toml`，与 `Isp6s.toml` 等可维护配置放在一起；发布版使用程序旁的 `resources/state.toml`，目录不可写时回退到用户配置目录。首次使用自动迁移旧位置的状态文件。状态包含 DP 工具、各页面参数文件、图片目录、当前选中图片和页面；启动时按需检查、加载，不会自动执行 DP。可从应用设置打开实际配置目录，详见 [本地工作状态](src-tauri/resources/README.md)。

新增预览、详情面板、缓存、观察器或后台任务前，先阅读 [CPU 与内存性能维护约定](docs/performance/MEMORY_RECOVERY.md)。Face 表格与热力图实现见[功能维护说明](docs/features/FACE_TABLE_HEATMAP.md)。提交 PR 时说明影响范围和验证命令，UI 改动附截图。

## 打包与发布

### 本地打包与签名

`npm run tauri:build` 默认读取根目录的 `.tauri-updater.key` 和 `.tauri-updater.password`；同名环境变量 `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 优先。GitHub Secrets 仅用于云端构建。

产物位于 `src-tauri/target/release/bundle/` 的 `nsis/` 和 `msi/`；调试包位于 `target/debug/bundle/`。仅打 NSIS 可运行 `npm run tauri:build -- --bundles nsis`。

在仓库 **Settings → Secrets and variables → Actions** 配置：


| Secret                               | 值                                      |
| ------------------------------------ | --------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY`          | `.tauri-updater.key` 的完整 Base64 内容 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | `.tauri-updater.password` 的单行内容    |

私钥和密码须备份，不要提交或输出到日志。Secret 应填文件内容，不能填路径、公钥或额外引号。工作流会先试签临时文件，确认密钥可用后再构建。客户端公钥位于 `src-tauri/tauri.conf.json`；不要通过重新生成密钥来修复 Secret，否则已安装客户端将无法验证新更新。

Tauri updater 签名用于更新验证；Windows 代码签名用于安装包身份认证，需另行配置。

### 发版步骤

版本唯一来源为 `src-tauri/tauri.conf.json.version`。修改后运行 `version:sync`，同步 npm 和 Cargo 的清单及锁文件；`version:check` 只检查，不改文件。

```powershell
# 1. 修改 tauri.conf.json 的 version 为 X.Y.Z，然后同步
npm run version:sync
npm run version:check

# 2. 验证；CI 也会执行这些检查
npm run release:test
npm run build
npm run rust:test

# 3. 提交已验证的代码和版本文件，再推送目标 tag
git add src-tauri/tauri.conf.json package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: release vX.Y.Z"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

发布稳定版使用 `vX.Y.Z`，tag 版本须与配置一致；不要使用 `git push --tags`。源码变更应在打 tag 前提交；预发布版本暂不进入自动更新通道。

### 自动化流程


| 工作流                                                   | 触发与行为                                                                       |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Validate changes](.github/workflows/ci.yml)             | PR、`main` 推送或手动运行；检查版本、发布脚本、前端和 Rust。仅 Markdown 变更跳过 |
| [Publish Windows release](.github/workflows/release.yml) | 推送`v*` tag 或手动指定已有 tag；严格校验稳定版本后构建、签名、上传并发布        |

发布任务固定 Node.js 22、Rust 1.95.0，复用 npm/Rust 依赖缓存，并按以下顺序执行：

1. 核对 tag 对应提交、版本文件、Secret 和 Release 状态，试签密钥。
2. 执行脚本测试；通过 `tauri build --no-bundle` 一次构建前端和应用，再运行 Rust 测试。
3. 使用 `tauri bundle` 生成 NSIS/MSI，检查产物版本、架构和签名文件，生成更新清单及 SHA-256 校验清单。
4. 将五项产物存入 Actions artifact（保留 14 天），再上传 Draft Release；确认资产名称、数量和大小后公开。

Release 包含 NSIS `.exe`、对应 `.exe.sig`、MSI、`latest.json` 和 `SHA256SUMS.txt`。NSIS 用于应用内更新；MSI 用于手动/企业分发。应用内更新日志、更新清单和 Release 说明统一读取 `src/data/changelog.json`，发版前须新增对应版本记录。

### 更新行为与失败恢复

客户端从 [最新 Release 的 latest.json](https://github.com/diamond-cz/luxe-tauri/releases/latest/download/latest.json) 检查更新；清单中的 NSIS 地址使用 `gh-proxy.com` 加速，Tauri updater 验证安装包签名。

`auto_update` 只控制启动检查，默认关闭；`update_notify` 控制更新提示。用户点击“下载并安装”后才执行升级。首次接入 updater 的旧版本需手动安装；真实升级须从上一版已安装的 NSIS 客户端验证。


| 情况                 | 处理                                                                     |
| -------------------- | ------------------------------------------------------------------------ |
| 构建或上传临时失败   | 在 Actions 重跑任务，或手动输入原 tag；Draft 可复用                      |
| Draft 有多余的旧资产 | 删除 Draft 中多余资产后重试；工作流会覆盖同名文件                        |
| 已公开 Release       | 工作流拒绝覆盖；源码或工作流修复使用新版本、新 tag                       |
| 更新下载失败         | 重试或打开 Release 页面手动安装；清单直连 GitHub，安装包代理可能独立失效 |

并发组避免同时发布；正式公开前失败会中止发布。云端产物校验不能替代安装/升级验收。

### 方案依据

采用 tag + GitHub Actions + Draft 校验后发布，适合当前单应用、人工选择版本的节奏。[release-please](https://github.com/googleapis/release-please) 通过规范提交生成版本 PR，[semantic-release](https://github.com/semantic-release/semantic-release) 通过提交信息自动决定版本；后续统一提交规范并需要更高发布频率时可再引入。

- [Tauri GitHub Actions 发布指南](https://v2.tauri.app/distribute/pipelines/github/)：工具链、缓存、构建与 Release。
- [Tauri updater](https://v2.tauri.app/plugin/updater/)：签名、安装包与更新清单。
- [GitHub 自动发布说明](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes)：生成变更记录。

## 许可

© 2026 diamond-cz · 仅内部 Camera Tuning 使用。


### Star-triggered build

A Star by the repository owner runs `.github/workflows/star-release.yml`. It checks out the latest default-branch source, finds the highest stable `vX.Y.Z` tag, and builds signed NSIS/MSI installers using the unique version `X.Y.(Z+1)-star.<Actions run number>`. After verification it replaces the updater assets and `latest.json` on that stable release without creating a new stable tag. Only the repository owner's Star event runs the publishing job, protecting signing secrets from public-trigger abuse. The client Overwrite Update action checks for and installs this build.
