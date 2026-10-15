# LUXE GitHub Actions 发布与应用内更新实施方案

> 状态：待实施。本文是下一次开发的执行依据，不表示自动更新或发布工作流已经接入。

## 目标与固定约定

| 项目 | 约定 |
| --- | --- |
| 发布仓库 | `diamond-cz/luxe-tauri`，沿用当前 Git remote 和更新检查地址 |
| 目标平台 | Windows x64 |
| 应用内更新包 | NSIS 安装包 |
| 手动下载包 | MSI 安装包 |
| 发布触发 | 推送 `vX.Y.Z` tag；支持手动重跑已有 tag |
| 发布时机 | 构建、签名、上传和校验完成后，再发布正式 Release |
| 客户端行为 | 可在启动时自动检查；发现新版后由用户确认下载、安装和重启 |
| 版本规则 | 稳定版使用 `vX.Y.Z`；预发布版本暂不进入自动更新通道 |

首个接入 Tauri updater 的版本需要用户通过现有 Release 页面手动安装。其后的版本才能通过应用内更新进行升级。

## 当前项目状态

- `src-tauri/tauri.conf.json` 是版本号唯一来源。 `scripts/sync-version.mjs` 会在开发和构建前同步 `package.json`、`package-lock.json`、`Cargo.toml` 和 `Cargo.lock`。
- `src/services/updateCheck.ts` 请求 GitHub Releases API，并比较最新 tag 与当前版本。首页可以手动检查；`src/hooks/useShellBootstrap.ts` 在 `auto_update` 开启时执行启动检查。
- 当前发现新版后只显示提示、发送可选通知并打开 Release 页面。`auto_update` 默认关闭，尚无下载、签名验证或安装能力。
- 仓库目前没有 `.github/workflows/`。`README.md` 已记录本地打包流程和 updater 接入方向，但其中部分示例版本号会随发版过时。

## 实施步骤

### 1. 接入 Tauri updater

1. 增加前端 `@tauri-apps/plugin-updater`、`@tauri-apps/plugin-process` 和对应 Rust 插件；在 `src-tauri/src/lib.rs` 注册插件。
2. 在 `src-tauri/tauri.conf.json` 配置 updater 公钥、以下 endpoint，并启用 updater 签名产物生成：

   ```text
   https://github.com/diamond-cz/luxe-tauri/releases/latest/download/latest.json
   ```

   公钥可以提交，私钥绝不可提交。
3. 在 `src-tauri/capabilities/default.json` 加入最小 updater 权限和 `process:allow-restart`，只授予主窗口必需的能力。
4. 用 updater 的检查结果作为首页和启动检查的统一版本来源。保留 Release 页面链接，供安装失败或用户选择手动下载时使用；不要让 GitHub API 检查和 updater 检查各自决定“最新版本”。
5. 扩展现有更新状态和首页按钮，至少覆盖：检查中、有新版本、下载中、安装中、失败、已是最新。显示下载进度，防止重复启动安装；用户确认后执行下载与安装，成功后重启。
6. 保持现有 `auto_update` 设置语义为“启动时自动检查”，不是静默安装；更新设置页和 README 文案。`update_notify` 继续控制系统通知和侧边栏提示。

### 2. 签名密钥和 GitHub Secrets

在可信的本地环境生成 Tauri updater 密钥对，保管私钥及其密码，并将公钥写入应用配置。

| 密钥 | 用途 | 是否提交仓库 |
| --- | --- | --- |
| updater 公钥 | 客户端验证更新包 | 可以提交配置 |
| updater 私钥 | Actions 生成更新签名 | 不得提交 |
| 私钥密码 | 解锁签名私钥 | 不得提交 |
| Windows 代码签名证书 | SmartScreen/安装包签名 | 本方案暂不强制 |

GitHub Secrets：

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

缺少签名材料时，workflow 必须失败，禁止发布无签名更新。Tauri updater 签名与 Windows 代码签名证书是两套机制，后者不能替代前者。

### 3. GitHub Actions 设计

使用单个 Windows x64 job，不引入当前项目不需要的 macOS、Qt、ONNX 或跨仓库发布逻辑。

| 阶段 | 必须完成的动作 |
| --- | --- |
| 触发 | `push.tags: ["v*"]`；`workflow_dispatch` 可手动指定已有 tag；不使用 `watch.started`。 |
| 权限和并发 | 仅发布任务授予 `contents: write`；以 tag 为 concurrency group；同一 tag 禁止并行发布。 |
| 版本校验 | 校验 tag 为 `vX.Y.Z`，且去掉 `v` 后等于 `tauri.conf.json.version`；运行版本同步后确认没有产生未提交差异。 |
| 依赖与检查 | 固定 Node/Rust 工具链版本，运行 `npm ci`、`npm run typecheck`、`npm run rust:test`。工具链版本写入 workflow，后续更新需显式修改。 |
| 构建 | 在 `windows-2022` x64 环境构建 NSIS、MSI 和 updater 签名产物；构建失败即终止。 |
| 更新清单 | 从本次 NSIS 产物及对应 `.sig` 生成 `latest.json`。`version` 等于 tag，`platforms.windows-x86_64.url` 指向本次 Release 中的 NSIS 更新包，`signature` 使用对应签名文件内容。不得把 MSI 地址写入自动更新字段。 |
| 发布 | 构建和本地校验全部通过后创建 Draft Release；上传 NSIS、MSI、签名和 `latest.json`，核对 Release 资产与清单引用，再自动发布正式版。 |
| 重跑保护 | 若该 tag 已有正式 Release，workflow 报错并停止，不静默覆盖用户可能已经下载的安装包或更新清单。 |

发布到当前仓库时，使用 `GITHUB_TOKEN` 即可承担 Release 写入，不需要参考配置中的跨仓库 `RELEASE_REPO_TOKEN`。`latest.json` 是固定 updater endpoint 的关键资产；只有正式 Release 发布后，`/releases/latest/download/latest.json` 才应指向本次版本。

### 4. 客户端更新交互

推荐流程如下：

1. 启动检查或手动检查调用 updater。
2. 无更新时显示当前版本已是最新。
3. 有更新时显示版本号、Release 说明和“下载并安装”按钮。
4. 用户确认后下载，显示进度并锁定重复操作。
5. 下载完成后执行安装；安装成功后调用 process 插件重启。
6. 用户取消、网络失败或签名校验失败时保留当前应用运行状态，显示错误并提供重试或打开 Release 页面。

启动时自动检查只负责发现和提醒，不应在后台静默安装，避免打断正在编辑的内容。

## 发版操作流程

应用版本唯一来源仍是 `src-tauri/tauri.conf.json`：

```bash
# 1. 修改 src-tauri/tauri.conf.json 的 version

# 2. 同步 npm / Cargo 版本
npm run version:sync

# 3. 本地验证
npm run typecheck
npm run rust:test
npm run tauri:build

# 4. 提交版本文件
git add src-tauri/tauri.conf.json package.json package-lock.json \
  src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "chore: release vX.Y.Z"

# 5. 创建并推送 tag
git tag vX.Y.Z
git push origin main --tags
```

Actions 应检出该 tag，而不是构建随后可能变化的 `main`。手动触发时也必须输入已经存在且版本一致的 tag。

## 验收清单

| 场景 | 预期结果 |
| --- | --- |
| tag 与配置版本不一致 | workflow 失败，不发布 Release。 |
| TypeScript 或 Rust 测试失败 | workflow 失败，不发布 Release。 |
| 签名私钥或密码缺失 | workflow 失败，不发布 Release。 |
| NSIS、MSI 或签名产物缺失 | workflow 失败，不发布 Release。 |
| 正常发布 | Release 同时包含 NSIS、MSI、签名和 `latest.json`。 |
| 清单检查 | 版本、URL、签名与实际 Release 资产一致；URL 指向 NSIS。 |
| 启动检查和手动检查 | 都能识别新版；关闭启动检查后仍可手动检查。 |
| 用户取消安装 | 不下载、不安装、不退出应用，可以再次尝试。 |
| 网络失败 | 显示错误，可重试或打开 Release 页面。 |
| 签名验证失败 | 拒绝安装，不执行重启。 |
| 真实升级 | 从上一版已安装的 NSIS 客户端确认更新、下载、安装并重启；重启后显示新版本。 |

## 首次上线注意事项

- 首个接入 updater 的版本必须先手动安装。
- 首次发布后先用测试版本验证 `latest.json`、签名和 NSIS 升级，再依赖它发布下一版。
- 不要提交私钥、安装包、`dist` 或 `target`。
- 当前工作区可能包含其他未提交改动，执行发版准备时不能覆盖或清理这些改动。
- README 中已有旧的 updater 示例，后续应以本文为准，并同步修正过时的版本号示例。

## 完成标准

以下条件全部满足后，才算完成本方案：

1. `.github/workflows` 中存在可运行的 Windows x64 发布 workflow。
2. updater 插件、公钥、权限和前端确认安装流程已接入。
3. GitHub Release 能稳定生成 NSIS、MSI、签名和 `latest.json`。
4. 已使用上一版 NSIS 安装包完成一次真实升级测试。

