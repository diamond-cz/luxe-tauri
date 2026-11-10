# LUXE 图片联动插件

功能范围：HiViewer 主窗口的当前焦点图片通过 `native-view` 宿主快照同步到 LUXE；当测试机文件夹列处于活动状态时，只同步该列当前焦点图片。插件窗口关闭时隐藏但保持后台同步；用户可用 A/D 或按钮控制当前活动文件夹中的图片索引。

插件仅支持 Windows x64。LUXE 必须运行，且图片目录已被 LUXE 扫描；LUXE 只会应用唯一已索引工作区中的匹配图片路径。

## 获取插件包

GitHub Actions 的 artifact `luxe-image-sync-windows-x86_64` 是一个下载容器，下载后必须先解压 artifact，再从里面取出 `luxe-image-sync-0.1.2-windows-x86_64.hvp`。HiViewer 安装时选择这个 `.hvp` 文件，不要直接选择 artifact 外层 ZIP；旧版本包如果提示 `Invalid Central Directory header`，请删除后重新下载最新 Actions artifact。

每次推送 main 且插件文件有变化时，GitHub Actions 的 **Build HiViewer plugin** workflow 会构建并校验 `.hvp`。在该次运行的 Artifacts 下载 `luxe-image-sync-0.1.2-windows-x86_64.hvp`。workflow_dispatch 也可手动构建指定分支。

## 手动安装 SOP

1. 从 GitHub Actions 构建运行下载 `.hvp`，解压 ZIP 后应看到根目录 `manifest.json`、`checksums.json`、`main.js`、`ui/` 和 `bin/luxe-image-sync.exe`；不要手动改包内容。
2. 打开 HiViewer，进入 **设置 → 自定义插件 → 从包安装**，选择 `.hvp` 并确认安装。
3. 在插件列表启用 **LUXE 图片联动**，确认 `selection.read` 和 `native.execute` 权限请求。
4. 先启动 LUXE 并打开已扫描的图片工作区；在 HiViewer 打开图片并调用插件的 **打开 LUXE 图片联动** 命令。
5. 验收 HiViewer 切换图片后 LUXE 跳转到相同图片；在 HiViewer 选择测试机文件夹后，切换该列图片只应同步该列焦点；在插件窗口按 D/A 后 LUXE 切换到活动文件夹的下一张/上一张。关闭插件窗口后继续切换 HiViewer 图片，LUXE 仍应联动；LUXE 本地切图也会更新插件状态。

若 LUXE 未运行，插件会重试 Named Pipe 连接；启动 LUXE 后重新切换图片。若路径不在 LUXE 已扫描且唯一匹配的工作区中，LUXE 会忽略该选择。插件从包安装后默认禁用，必须手动启用。升级时在插件管理界面安装新版本包并重新启用。

## 构建与验证

本机不要运行 Cargo 编译。GitHub Actions 执行 Rust release 编译、manifest/包检查和 `.hvp` 打包；本地可运行 `npm run plugin -- check plugins/luxe-image-sync` 做轻量校验。

插件 Rust 进程只将 stdout 用于 HiViewer JSON-RPC，诊断日志写入 stderr。协议经 Windows Named Pipe `\\.\pipe\luxe-image-sync-v1` 与 LUXE 通信，消息采用有界 JSONL。
