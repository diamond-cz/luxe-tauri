# LUXE 图片联动插件

当前插件版本 **0.1.5**，仅支持 Windows x64。HiViewer 通过 `native-view` 快照推送图片路径，LUXE 将路径映射到已扫描工作区中的图片 index；两个应用的列表排序可以不同，不直接复制数字 index。

设置测试机列后，跟随宿主快照的 `testMachineCurrentPath`：点击参考机图片时，同步同一行的测试机图片；该行缺少测试机图片时停止该次同步，不跳首图或参考机。未设置测试机列时跟随 `currentPath`。关闭插件窗口会隐藏窗口并保持后台同步；A/D 和上一张/下一张按钮控制 LUXE 的图片选择。

LUXE 必须运行且图片目录已被扫描。路径必须命中唯一的已索引图片；未匹配或多个工作区匹配时不会猜测、扫描或改写工作区。

## 0.1.5 更新与状态命令

插件清单新增可见命令 `check-update / updater/open`。现有 HiViewer 根据清单自动在插件卡片的状态命令旁显示“检查插件更新”；点击后打开状态窗口并自动检查，窗口尚未就绪时通过恢复状态保留检查请求。原 `sync / view/open` 的文字改为“检查 LUXE 图片联动状态”，命令 ID 保留。

检查目录优先走 gh-proxy.com，单次目录请求限制 15 秒；代理网络失败或 404 后尝试 GitHub 原地址，同样 15 秒。两者都为 404 时显示“更新目录尚未发布”，不能把未发布或网络失败当成已是最新版。包下载继续使用目录中的代理 URL，180 秒总限时、128 MiB 上限及 SHA-256/包身份验证保持不变。

线上曾只运行 main 的构建 job，发布 job 被跳过，导致固定目录与版本 Release 均不存在，这是 0.1.4 检查更新报 404 的实际原因。0.1.5 的 workflow 改为 **main 推送构建成功后自动发布**，先发布版本包，再更新稳定目录；PR 和非 main 手动运行仍不发布。源码变更未推送并成功完成发布前，旧客户端的 404 不会仅因本地改码而消失。

## 0.1.4 修复说明

新版 HiViewer 的 `userCommands()` 会隐藏 `viewer/update`，该方法仅用于已打开会话的内部刷新。旧插件只有这个命令，导致打开入口消失，无法建立持续接收图片快照的会话。

此版本保留贡献点引用的 `sync` 命令 ID，将方法改为可见的 `view/open`；另声明隐藏的 `viewer/update`。原生进程已分别处理这两种调用。打包检查拦截仅有刷新命令、贡献点引用隐藏命令和 Manifest/Cargo/Tauri 版本不一致；后者会造成宿主握手失败。

快照处理提取到 `native/src/viewer_snapshot.rs`，测试覆盖测试机行映射、缺图不回退、清除测试机配置和 Windows 路径规范化。宿主 JSON 帧上限对齐到 8 MiB，图片路径列表各不超过 1000 项、单路径不超过 8192 字节。

## 首次获取与安装

1. 从 GitHub Actions 的 **Build HiViewer plugin** 下载 artifact `luxe-image-sync-windows-x86_64` 并解压，取出 `luxe-image-sync-0.1.5-windows-x86_64.hvp`。选择内部 `.hvp`，不要选择 artifact 外层 ZIP。
2. 发布 job 完成后也可从 Release `luxe-image-sync-v0.1.5` 获取同名 `.hvp`。构建 job 成功与发布 job 成功需要分别核对。
3. 在 HiViewer **设置 → 自定义插件 → 从插件包安装／更新** 选择 `.hvp`，确认安装，启用 **LUXE 图片联动** 并授权 `selection.read` / `native.execute`。
4. 启动 LUXE 并加载图片工作区。在目前尚未扩展生命周期的 HiViewer 上，首次仍需点击 **检查 LUXE 图片联动状态** 建立会话，之后隐藏窗口可继续同步。只修改清单文字不等于宿主启用时已经自动启动。

## 后续更新

插件窗口提供 **检查插件更新**。发现较新版本后按钮变为 **下载 v版本号**；下载完成校验 SHA-256、包内插件 ID、版本及平台，在资源管理器定位 `.hvp`，窗口显示完整路径。然后在 HiViewer **从插件包安装／更新** 选择该文件并确认安装，再启用并打开插件，无需卸载旧版。

更新需要 Windows 自带的 Windows PowerShell 5.1；下载在隐藏进程中进行，流式读写、限时与限额，失败后可重试。包保存在宿主授权的 `HIVIEWER_PLUGIN_DATA_DIR/updates/`，只复用同一版本且摘要一致的文件，不覆盖已有文件。该目录保留已下载版本用于手动安装；不存入已安装包目录。

Windows PowerShell 5.1 启动时将 `PSModulePath` 限定为自身 `$PSHOME/Modules`，仅影响更新子进程；避免从 PowerShell 7 经 Node 或宿主继承不兼容模块路径，导致 `Get-FileHash` 无法使用。`npm run plugin:test` 包含带不兼容模块路径的完整校验测试；CI 仍使用 Node 22，不能通过跳过更新脚本测试解决此问题。

**边界：现有 HiViewer v1 未开放插件安装回调。仅修改本插件可增加卡片上的命令按钮、自动检查、下载、校验和定位；直接进入宿主安装确认和“启用即同步”仍需要宿主生命周期/安装接口扩展。本次没有修改 `D:\Image_process\hiviewer_rs`，不会覆盖正在运行的 EXE 或改写宿主安装记录。**

## 启用即同步需要的宿主接线

后续实施文档：[HiViewer 插件启用、状态检查与更新安装改造指南](../../docs/engineering/HIVIEWER_PLUGIN_INTEGRATION_GUIDE.md)。本轮只交付该指南，不修改宿主代码。

插件已准备隐藏 `start / viewer/start` 命令：接收同样的 `{viewer}` 快照并启动同步，原生窗口默认隐藏；`view/open` 与 `updater/open` 才显示窗口。现有宿主不会自动调用该命令，因此这个插件侧入口是接线准备，不能作为自动启动已完成的验收结果。

需要修改的宿主边界（尚未授权修改，以下为待接线契约）：

- `D:/Image_process/hiviewer_rs/src-tauri/src/commands/hiviewer_plugins.rs` 的 configure 在启用并保存授权后，调用声明的后台启动方法并注册持续快照会话；禁用、卸载与更新继续撤销会话，授权/版本检查不能省略。
- `D:/Image_process/hiviewer_rs/src-tauri/src/plugins/native_view.rs` 为后台会话增加幂等启动/复用，状态和更新命令复用活动会话，避免当前 `open()` 先结束旧进程造成同步中断。宿主启动时恢复已授权插件，不能依赖设置页先打开；启动失败可观察、可重试。
- `D:/Image_process/hiviewer_rs/src/hiviewer/plugins/PluginCenter.tsx` 的更新入口复用宿主 catalog → download → 安装确认 → install 流程，以旧 revision 与摘要核对安装，完成后按授权契约恢复同步。插件 v1 没有可从 sidecar 直接调用的安装 callback，不能伪造 `host/install`。
- 若新增公共插件 API 或清单字段，需要同步宿主 Schema、SDK、CLI、校验器与测试；当前 `viewer/start` 使用已有 method 声明格式，不向 v1 清单加入未知字段。

当前项目的命令声明让按钮出现在命令区，但具体像素位置由宿主布局决定。自动启动、会话复用与宿主内安装的验收需要宿主代码获准修改后完成。

HiViewer 已有在线目录输入框也可填写以下地址并刷新，然后点击对应包的“下载安装”，复用宿主的检查和确认流程：

```text
https://gh-proxy.com/https://github.com/diamond-cz/luxe-tauri/releases/download/luxe-plugin-updates/plugins.json
```

固定目录必须先通过下面的发布流程生成。尚未发布、网络失败或目录返回 404 时显示更新失败，不显示“已是最新版”。

## 发布流程

版本同时修改 `manifest.json`、`native/Cargo.toml`、`native/Cargo.lock` 和 `native/tauri.conf.json`；插件版本独立于 LUXE 主应用版本。

- main 推送 / PR：Windows CI 运行同步测试、包与更新脚本测试、Rust 测试及 release 构建；生成 `.hvp`、`.sha256`、`plugins.json` 和安装说明 artifact。
- 正式发布：main 推送构建成功后自动执行；也支持推送匹配 Manifest 的 `luxe-image-sync-v<版本>` tag 或在 main 手动运行并勾选 `publish`。手动运行默认发布；PR 与其他分支不发布。
- 发布 job 先把 `.hvp` 上传到对应的版本 Release，完成后更新固定 Release `luxe-plugin-updates` 的 `plugins.json`。两类 Release 均设置 `latest=false`，不替代 LUXE 应用更新 Release。
- 包的 URL 包含版本 tag；目录 SHA-256 来自实际构建的 `.hvp`。已发布同版包不允许换字节，固定目录不允许降级；更改插件内容必须增加版本。发布 job 串行执行，PR 不发布。

本次代码修改本身没有上传 Release；只有上述工作流成功完成后，线上更新地址才可用。

## 验证与验收

本机禁止 Rust/Tauri 编译。轻量检查：

```powershell
npm run typecheck
npm run sync:test
npm run plugin:test
rustfmt --check --edition 2021 plugins/luxe-image-sync/native/src/main.rs plugins/luxe-image-sync/native/src/viewer_snapshot.rs plugins/luxe-image-sync/native/src/plugin_update.rs
```

完整 `npm run plugin -- check plugins/luxe-image-sync` 和 `pack` 需要 `bin/luxe-image-sync.exe`，由 CI 构建后执行。本地包测试使用不执行的二进制夹具验证真实打包、目录生成及摘要；更新脚本测试用本地 ZIP 和模拟传输覆盖真实校验、下载、复用与失败清理，不代表远程下载或安装包已验收。

安装产物后应检查：主窗口/对比窗口切图、设置测试机并切换参考机同一行、测试机缺图、取消测试机配置、隐藏插件窗口继续同步、LUXE 晚启动重连、A/D、更新失败重试，以及较新版本下载后从宿主安装并重新启用。Windows 实际安装、网络和桌面交互需要单独验收。

stdout 只用于 HiViewer JSON-RPC，日志写入 stderr。LUXE 联动使用 Windows Named Pipe `\\.\pipe\luxe-image-sync-v1` 与有界 JSONL。
