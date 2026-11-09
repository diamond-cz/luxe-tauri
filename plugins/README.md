# Hiviewer 自定义插件开发

插件入口：**设置 → 自定义插件**，或 **Ctrl/Cmd + Shift + P**。选中文件后，也可从右键菜单的工具分组执行插件命令。

本指南面向插件作者、安装用户和协助开发的 AI，描述当前已实现的接口。接口基线：Host API 1.0.0、manifestVersion 1、apiVersion 1、Sidecar Protocol 1、Media Protocol 1；SDK 的 `api.version` 是数字 `1`。工具链基线：Node 24.4.0、npm 11.4.2、TypeScript 7.0.2；原生示例使用 Rust 1.96.0 / Edition 2024。

## 阅读导航

| 目标 | 文档 |
| --- | --- |
| 从零完成一个可安装插件 | [快速入门：文件报告插件](quick-start.md) |
| 查字段、权限、包目录和数据版本 | [Manifest 参考](manifest.md) |
| 开发图片处理界面或视频工具 | [视图与媒体处理](views.md) |
| 在图片、视频详情侧栏增加内容 | [详情面板扩展](details-panels.md) |
| 编写或调用 Rust 程序 | [Rust sidecar 开发](native-sidecars.md) |
| 让主列表和看图支持 PSD 等格式 | [自动图片格式开发](image-decoders.md) |
| 调试、迭代、打包和解决错误 | [开发与发布](development.md) |
| 将任务交给其他 AI | [AI 开发交接指南与任务模板](ai-development.md) |
| 查 API 签名和资源限额 | [Host API v1](api-v1.md) |
| 修改宿主或了解实际测试范围 | [架构](architecture.md) / [验收记录](verification.md) |

所有命令默认在 Hiviewer 源码仓库根目录执行。CLI 和 SDK 位于本仓库 `plugins/`，不是需要从 npm / crates.io 安装的同名 SDK。桌面安装用户只需插件包。参考 DBX 架构不表示 DBX 插件能够直接安装，Hiviewer 有自己的 manifest 和媒体协议。

开发路径：选择模板 → 修改 manifest 与代码 → 类型检查/单测 → 构建 → CLI check → 桌面安装启用 → 真实文件验收 → pack → 从包安装复测。

## 已实现的扩展方式

| 类型 | 执行方式 | 示例目录 |
| --- | --- | --- |
| 图片分析 | Worker、OffscreenCanvas、宿主预览 API | `plugins/examples/image-analysis` |
| 图片显示与处理 | 隔离 HTML 视图、Canvas、导出新文件 | `plugins/examples/image-viewer` |
| 视频显示 | 隔离 HTML 视图、受限媒体 URL、HTMLVideoElement | `plugins/examples/video-viewer` |
| EXIF 扩展 | 读取元数据、返回报告，也可注册到图片详情侧栏 | `plugins/examples/exif-provider` |
| 详情扩展 | 图片/视频详情侧栏内嵌报告或隔离 HTML 界面 | `plugins/examples/details-panel` |
| 自动图片格式 | Rust sidecar，主列表缩略图及双击看图 | `plugins/examples/psd-decoder` |
| 原生计算 | Rust sidecar、JSON-RPC、二进制输出 | `plugins/examples/rust-analysis` |

宿主与 SDK 分别维护在 `src/hiviewer/plugins/`、`src-tauri/src/plugins/` 和 `plugins/sdk/`，既有主窗口仅负责接入。设计依据见 [architecture.md](architecture.md)，接口细节见 [api-v1.md](api-v1.md)，实际验证记录见 [verification.md](verification.md)。

## 1. 运行示例

在仓库根目录执行；沿用项目的 npm、Node 和 Rust 环境：

```powershell
npm install
node plugins/tools/build-examples.mjs
```

在插件中心选择“从包安装”，选择下载好的 `.hvp` 或 ZIP 包；开发时也可选择示例目录安装。安装完成后点击“启用”并确认权限。格式插件会自动刷新当前目录，其他插件通过命令面板或文件右键菜单运行。

Rust 示例会在当前平台编译到 `bin/`，构建脚本同步更新 manifest 的平台字段。二进制产物不提交到仓库。Windows 与 macOS 的二进制不能混用，需要分别构建、分别发布。

## 2. 创建 JS/TS 插件

```powershell
npm run plugin -- create plugins/my-analysis image-analysis
npm run plugin -- build plugins/my-analysis
npm run plugin -- check plugins/my-analysis
npm run plugin -- dev plugins/my-analysis
```

`create` 复制模板和所需 SDK，拒绝覆盖已有目录。修改 `manifest.json` 中的 `id`、名称、作者、版本及权限。`main.ts` 构建为单文件 ESM `main.js`；纯 JS 可以直接提供 `main.js`。禁止依赖宿主的 React 组件或私有 IPC。

`build` 不运行 TypeScript 类型检查；`check` 不执行插件；`dev` 不支持原生 sidecar。完整类型检查命令和可复制的 manifest 见[快速入门](quick-start.md)。开发目录安装会复制版本内容，修改源码后必须重新构建、重新安装并启用。

```ts
import type { Plugin } from './sdk/index';

export default {
  commands: {
    async run(api) {
      const files = await api.selection.get();
      api.progress(1, 'Done');
      return {
        title: 'Selected files',
        columns: ['Name', 'Bytes'],
        rows: files.map(file => [file.filename, file.sizeBytes]),
      };
    },
  },
} satisfies Plugin;
```

对应命令必须在 manifest 声明，读取选中项需要 `selection.read`。可选的 `activate(api)` 在命令前调用，`deactivate()` 在正常结束或异常返回时调用。强制取消会直接销毁 Worker，不能依赖 `deactivate()` 做必需的持久化。

Schema 位于 `plugins/schema/manifest.v1.json`。JSON Schema 提供编辑器提示；Rust 校验器同时执行跨字段、平台路径和包完整性检查，是安装时的最终判定。

## 3. 自定义视图

声明 `ui.entry: "ui/index.html"`，命令 `handler: "view"`。所有静态资源放在 `ui/` 下。HTML 的 base 指向包根资源地址，因此脚本引用为 `src="ui/view.js"`，可使用任意框架构建静态产物。

```js
const api = window.hiviewer;
await api.ready;
const [file] = await api.selection.get();
const preview = await api.media.preview(file.path);
try {
  const pixels = await api.media.readBytes(preview.resourceId);
  // Blob / createImageBitmap / Canvas / WebGL 处理 pixels。
} finally {
  await api.media.release(preview.resourceId);
}
```

视图运行在 `sandbox="allow-scripts"` 的 iframe 中。通过消息桥调用 API；不能访问宿主 DOM、Tauri invoke、宿主 localStorage 或直接联网。网络能力可由用户明确授权的原生 sidecar 实现。

主题变量：`--hiviewer-background`、`--hiviewer-text`、`--hiviewer-accent`、`--hiviewer-border`、`--hiviewer-font`。宿主实时同步主题和语言；可订阅 `api.events.on('environment.changed', callback)`，返回值用于取消订阅。命令标题支持 `%key%`，在 `manifest.localizations[locale][key]` 中声明翻译。

工作区支持多标签、停靠和独立窗口。停靠切换保持视图实例；移到独立窗口会重新创建会话，需使用 `storage` 保存要跨会话恢复的业务状态。选择上下文在打开视图时固定，重新打开可读取新的选择。

## 4. Rust sidecar

```powershell
npm run plugin -- create plugins/my-native rust-analysis
cargo build --manifest-path plugins/my-native/Cargo.toml
```

将编译产物复制到 manifest 声明的 `bin/` 路径，设置当前平台 `target`，并同时修改 Rust `serve(id, version, ...)` 与 manifest 中的身份和版本。

```rust
use hiviewer_plugin_sdk::{serve, Transport, json};

fn main() -> hiviewer_plugin_sdk::Result<()> {
    serve("your.plugin", "1.0.0", Transport::Framed, |method, params, ctx| {
        if method != "analyze/files" { return Err("unknown method".into()); }
        ctx.progress(0.5, "Analyzing")?;
        ctx.binary("result.bin", &[1, 2, 3])?;
        Ok(json!({"title":"Analysis","text":params.to_string()}))
    })
}
```

`commands[].method` 与 `imageDecoders[].probe/decode` 是可调用方法的白名单。Worker 和视图可以调用 `api.backend.invoke(method, params)`；独立 sidecar 命令由宿主传入 `{files, configuration}`。stdout 只输出协议，日志写 stderr。`api.backend.readBinary(channel)` 读取并消费一次二进制输出；`api.backend.logs()` 返回本会话最近日志。

原生程序以当前用户权限运行，`native.execute` 是启动前的明确信任授权，**不构成操作系统沙箱**。需要访问文件时使用传入的选择快照，持久化数据使用环境变量 `HIVIEWER_PLUGIN_DATA_DIR`。单次 RPC 截止 30 秒，命令截止 60 秒；长时间服务应由视图分步调用，不应阻塞一次 RPC。

## 5. 新图片格式（PSD 等）

原生格式插件声明 `imageDecoders`，启用后接入目录扫描、主列表/文件夹缩略图、大图、直方图与 ROI 解码。宿主保留内置格式优先权；两个启用的插件不能注册相同扩展名。

示例 `plugins/examples/psd-decoder` 支持 PSD v1 RGB 8 位合成图、未压缩/RLE/ZIP/ZIP 预测压缩、嵌入 ICC 转 sRGB。它不提供图层编辑、PSB、CMYK/Lab/灰度或 16/32 位解码。这些能力可由另一个遵守同一协议的 sidecar 实现。

完整契约、资源限制与开发步骤见 [image-decoders.md](image-decoders.md)。自动格式解码使用 Rust sidecar；JS/TS Worker 用于分析、EXIF、界面和已有预览处理，不能独立注册宿主解码器。

## 6. 本地打包、安装与更新

`npm run plugin -- pack plugins/my-analysis analysis-1.0.0.hvp`

打包包含 manifest、main.js、ui/、bin/ 和文件摘要，不包含 SDK、源码、target。已有输出文件拒绝覆盖。用户自行下载包后，在设置中选择本地包安装；不需要签名或密钥，也没有仓库安装和工作流功能。

文件摘要用于发现损坏及确认后包被替换，不代表发布者身份验证。安装采用不可变版本目录和原子激活；更新默认停用、撤销旧会话并保留上一版本。回滚同样停用，且要求 `dataVersion` 相同；重新启用后格式即时刷新。

当前没有数据迁移回调；更新或保留数据后重装时，`dataVersion` 不同也会被拒绝。保持兼容的数据版本，或明确让用户选择重置数据，详见 [Manifest 参考](manifest.md)。

卸载默认保留私有数据，也可选择删除。保留数据的版本标记随数据保留，重装时继续检查兼容性。JSON storage 限额 256 KiB；原生数据目录由插件负责自身数据规模。

## 能力边界

- 图片 API 输出已归一朝向的 sRGB PNG，长边最多 2048；不提供 RAW 传感器像素或 HDR 浮点帧，分析报告应说明使用预览数据。
- 视频 API 暴露 MP4/M4V/WebM/MOV/OGV 的受限文件流，实际编解码支持取决于 WebView。v1 不自动调用 FFmpeg 转码；额外编解码可由 sidecar 提供。媒体 URL 需要会话存活，大文件使用 Range 请求。
- EXIF API 为只读；扩展内容以插件报告/视图呈现，不改写原文件字段。导出通过保存对话框创建新文件，拒绝覆盖任何已存在文件。
- Sidecar 支持 JSON-RPC 和后端向前端的二进制输出。`host/*` 回调、宿主向 sidecar 的二进制输入、OS 级原生沙箱未在 v1 开放。
- 安装仅使用本地文件或目录；开发者负责为各操作系统和 CPU 架构提供对应的原生包。

## 验证命令

```powershell
npm run build
npm run test:i18n
npm run test:plugins
node plugins/tools/build-examples.mjs
./plugins/tools/test-host.ps1
cargo check --manifest-path src-tauri/Cargo.toml
```

Windows 测试脚本只给生成的测试 EXE 嵌入 Common Controls v6 manifest，解决 Tauri 对话框依赖的 `TaskDialogIndirect` 加载问题。其他平台使用 `cargo test --manifest-path src-tauri/Cargo.toml plugins --lib -- --test-threads=1`。浏览器模拟器使用真实隔离容器和模拟 Host API；它不能替代 Tauri 桌面媒体与保存对话框验证。

Windows Edge 浏览器检查：先运行某个示例的 `dev` 命令，在另一个终端执行 `node plugins/tools/browser-check.mjs`。图片处理视图使用参数 `view`，视频视图使用参数 `view video`。检查使用独立的临时浏览器 profile，不操作日常浏览器会话。Worker 检查同时覆盖 EXIF 示例和死循环终止。
