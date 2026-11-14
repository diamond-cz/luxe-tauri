# LUXE 图片联动插件

当前插件版本 **0.1.4**，仅支持 Windows x64。HiViewer 通过 `native-view` 快照推送图片路径，LUXE 将路径映射到已扫描工作区中的图片 index；两个应用的列表排序可以不同，不直接复制数字 index。

设置测试机列后，跟随宿主快照的 `testMachineCurrentPath`：点击参考机图片时，同步同一行的测试机图片；该行缺少测试机图片时停止该次同步，不跳首图或参考机。未设置测试机列时跟随 `currentPath`。关闭插件窗口会隐藏窗口并保持后台同步；A/D 和上一张/下一张按钮控制 LUXE 的图片选择。

LUXE 必须运行且图片目录已被扫描。路径必须命中唯一的已索引图片；未匹配或多个工作区匹配时不会猜测、扫描或改写工作区。

## 0.1.4 修复说明

新版 HiViewer 的 `userCommands()` 会隐藏 `viewer/update`，该方法仅用于已打开会话的内部刷新。旧插件只有这个命令，导致打开入口消失，无法建立持续接收图片快照的会话。

此版本保留贡献点引用的 `sync` 命令 ID，将方法改为可见的 `view/open`；另声明隐藏的 `viewer/update`。原生进程已分别处理这两种调用。打包检查拦截仅有刷新命令、贡献点引用隐藏命令和 Manifest/Cargo/Tauri 版本不一致；后者会造成宿主握手失败。

快照处理提取到 `native/src/viewer_snapshot.rs`，测试覆盖测试机行映射、缺图不回退、清除测试机配置和 Windows 路径规范化。宿主 JSON 帧上限对齐到 8 MiB，图片路径列表各不超过 1000 项、单路径不超过 8192 字节。

## 首次获取与安装

1. 从 GitHub Actions 的 **Build HiViewer plugin** 下载 artifact `luxe-image-sync-windows-x86_64` 并解压，取出 `luxe-image-sync-0.1.4-windows-x86_64.hvp`。选择内部 `.hvp`，不要选择 artifact 外层 ZIP。
2. 正式发布后也可从 Release `luxe-image-sync-v0.1.4` 获取同名 `.hvp`。普通 main 推送仅构建 artifact，不等于已发布。
3. 在 HiViewer **设置 → 自定义插件 → 从插件包安装／更新** 选择 `.hvp`，确认安装，启用 **LUXE 图片联动** 并授权 `selection.read` / `native.execute`。
4. 启动 LUXE 并加载图片工作区，在 HiViewer 插件中点击 **打开 LUXE 图片联动**。只安装、启用插件不会自动打开原生会话；每次重新启动 HiViewer 或更新插件后需再次打开。

## 后续更新

插件窗口提供 **检查插件更新**。发现较新版本后按钮变为 **下载 v版本号**；下载完成校验 SHA-256、包内插件 ID、版本及平台，在资源管理器定位 `.hvp`，窗口显示完整路径。然后在 HiViewer **从插件包安装／更新** 选择该文件并确认安装，再启用并打开插件，无需卸载旧版。

更新需要 Windows 自带的 Windows PowerShell 5.1；下载在隐藏进程中进行，流式读写、限时与限额，失败后可重试。包保存在宿主授权的 `HIVIEWER_PLUGIN_DATA_DIR/updates/`，只复用同一版本且摘要一致的文件，不覆盖已有文件。该目录保留已下载版本用于手动安装；不存入已安装包目录。

**边界：现有 HiViewer v1 未开放插件安装回调。仅修改本插件无法实现点击一次便直接安装到宿主；当前实现自动检查、下载、校验和定位，最后的安装由宿主确认。插件不会覆盖正在运行的 EXE 或改写宿主安装记录，否则会触发 `plugins/installed-package-modified`。`D:\Image_process\hiviewer_rs` 代码不需要改动。**

HiViewer 已有在线目录输入框也可填写以下地址并刷新，然后点击对应包的“下载安装”，复用宿主的检查和确认流程：

```text
https://gh-proxy.com/https://github.com/diamond-cz/luxe-tauri/releases/download/luxe-plugin-updates/plugins.json
```

固定目录必须先通过下面的发布流程生成。尚未发布、网络失败或目录返回 404 时显示更新失败，不显示“已是最新版”。

## 发布流程

版本同时修改 `manifest.json`、`native/Cargo.toml`、`native/Cargo.lock` 和 `native/tauri.conf.json`；插件版本独立于 LUXE 主应用版本。

- main 推送 / PR：Windows CI 运行同步测试、包与更新脚本测试、Rust 测试及 release 构建；生成 `.hvp`、`.sha256`、`plugins.json` 和安装说明 artifact。
- 正式发布：推送与 Manifest 一致的 `luxe-image-sync-v<版本>` tag，或在 main 手动运行该 workflow 并勾选 `publish`。手动运行默认发布；在其他分支仅构建。
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
