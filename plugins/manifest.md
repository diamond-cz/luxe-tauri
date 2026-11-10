# Manifest 与包结构参考

[返回开发指南](README.md) · [Host API](api-v1.md)

编辑器 Schema：[`manifest.v1.json`](../../plugins/schema/manifest.v1.json)。CLI 校验器：[`package.mjs`](../../plugins/tools/package.mjs)。桌面最终由 [`manifest.rs`](../../src-tauri/src/plugins/manifest.rs) 和 [`package.rs`](../../src-tauri/src/plugins/package.rs) 校验；编辑器提示不能代替安装验证。

## 顶层字段

| 字段 | 必填 | 当前契约 |
| --- | --- | --- |
| `manifestVersion` / `apiVersion` | 是 | 均为数字 `1` |
| `id` | 是 | 1–96 个小写 ASCII 字母、数字、点、连字符；字母开头，不含 `..`，不以点结尾 |
| `name` / `author` | 是 | 非空、各最多 120 UTF-8 字节，无控制字符 |
| `description` | 是 | 非空，最多 2000 UTF-8 字节 |
| `version` | 是 | `major.minor.patch`，每段最多 8 位；无前导零、`v` 或预发布后缀 |
| `entry` | 是 | 固定 `main.js` |
| `permissions` | 是 | 权限数组，可以为空，不能重复 |
| `commands` | 是 | 最多 32 个；只有存在 `imageDecoders` 时才允许为空 |
| `configuration` | 否 | 最多 32 个 string / number / boolean 配置项 |
| `backend` | 否 | executable 位于 bin/、target 为平台标识；transport 为 stdio-jsonl（默认）或 stdio-framed；需要 `native.execute` |
| `ui` | 否 | entry 必须为 `ui/` 下的 `.html` |
| `contributions` | 否 | 最多 64 个功能入口，引用已声明命令 |
| `imageDecoders` | 否 | 最多 16 个[自动格式提供器](image-decoders.md) |
| `dataVersion` | 否 | 默认 1，范围 1–1000000 |
| `localizations` | 否 | 插件自带的 `locale -> key -> string` 覆盖；最多 16 个语言，每语言最多 128 项（这是插件 manifest 上限，不代表宿主当前仅支持或必须支持 16 种语言） |
| `$schema` | 否 | 编辑器提示地址，与运行时 API 版本无关 |

未知字段会被拒绝，不自行增加 `hooks`、`activateOn`、`network`、`workflow`、`repository`、`signature` 等未实现字段。实际上限以 Rust 的 UTF-8 字节校验为准，中文不能按字符数估算。

`entry` 始终必填；只含 view / sidecar 命令或纯格式声明的包可以没有实际 `main.js` 文件。有 Worker 命令时，`main.js` 必须存在且不超过 2 MiB。

## commands 与 contributions

下面是需合并到完整 manifest 的字段片段：

```json
{
  "commands": [
    { "id": "inspect", "title": "%command.inspect%", "contexts": ["selection"], "requiresSelection": true, "handler": "worker" }
  ],
  "contributions": [
    { "id": "metadata-report", "kind": "exif-provider", "title": "%command.inspect%", "command": "inspect" }
  ],
  "localizations": {
    "zh-CN": { "command.inspect": "查看元数据报告" },
    "zh-TW": { "command.inspect": "查看中繼資料報告" },
    "en-US": { "command.inspect": "Inspect metadata" }
  }
}
```

- 各 ID 使用插件 ID 的字符规则，同一数组内唯一。
- `contexts` 当前只接受 `selection`，可以为空，不授予读取权限。
- `requiresSelection` 默认 false；设为 true 仅控制无选择时禁用入口，不自动读取文件。
- `handler` 默认 `worker`：执行 `main.js` 默认导出的 `commands[id]`。`view` 打开 `ui.entry`；`sidecar` 调用 `method`。
- `method` 最长 128 字节，只含 ASCII 字母、数字、`/_.-`，禁止 `host/`、`plugin/` 前缀。sidecar 命令必填。Worker / View 调用后端的方法也需通过 manifest 声明进入白名单。
- `kind` 接受 `image-analysis`、`image-viewer`、`video-viewer`、`exif-provider`、`details-panel`。前四类组织工具入口；`details-panel` 将命令挂载到图片/视频详情侧栏，见[详情面板扩展](details-panels.md)。
- `mediaTypes` 仅用于 `details-panel`，可填写 `["image"]`、`["video"]` 或 `["image", "video"]`；省略时支持两类。空数组、重复值和其他类型无效。每个贡献的 `command` 必须引用已声明命令。

## 权限选择

| 权限 | 行为 |
| --- | --- |
| `selection.read` | `selection.get()`；原生独立命令接收文件列表 |
| `metadata.read` | 读取所选文件元数据，通常配合 selection.read |
| `media.read` | 获取/释放图片预览、视频和媒体字节，通常配合 selection.read |
| `viewer.compare` | 在比较窗口打开选择快照中的路径 |
| `storage` | 私有 JSON 键值读写 |
| `notifications` | 显示宿主短通知；返回报告不需要此权限 |
| `files.export` | 保存对话框创建新文件 |
| `native.execute` | 后端 RPC、二进制与日志；与 backend 声明配套 |
| `image.decode` | 浏览时自动解码声明格式；还需要 native.execute 和 framed backend |

用户启用时授予全部声明权限，当前没有“仅授予部分后降级启用”的流程。只声明实际需要的权限。`assets.read()` 仅访问本插件 `ui/` 资源，无需附加权限。

## 配置与版本

```json
{
  "configuration": [
    { "key": "threshold", "title": "阈值", "type": "number", "default": 128 },
    { "key": "include-details", "title": "包含明细", "type": "boolean", "default": false }
  ],
  "dataVersion": 1
}
```

配置 `key` 遵守上述 ID 规则，不能包含大写字母或下划线。JS 从 `api.configuration.threshold` 或 `api.configuration['include-details']` 读取，Rust 从请求 `configuration` 读取。配置没有 `min`、`max`、枚举或嵌套对象声明；业务范围由插件校验，string 值最多 4096 UTF-8 字节。保存配置会改变 revision 并撤销旧会话，重新运行/打开视图获取新配置。

`version` 表示代码版本，`dataVersion` 表示持久化数据兼容版本，`revision` 由宿主生成，作者不填写。改插件 ID 会创建独立安装和数据。

当前没有数据迁移回调。已有安装或保留数据与新包的 `dataVersion` 不同，更新/重装会被拒绝；回滚也要求一致。普通升级应保持数据兼容；确需重置时，说明影响并让用户在卸载时选择删除数据，不能静默清空。

## 包结构与限制

```text
plugin.hvp                 # ZIP，manifest 直接位于包根
  manifest.json
  checksums.json           # pack 生成
  main.js                  # 有 Worker 时必需
  ui/                      # 页面、样式、模块、图片、字体
  bin/                     # 原生可执行文件与随包依赖
```

`pack` 只收集 manifest、main.js、ui/、bin/。main.ts、sdk/、Cargo.toml、target/、根目录 README 不会自动包含。运行资源放在 ui/ 或 bin/，不要引用开发机器的绝对路径。

`checksums.json` 由打包器生成，必须是“包内相对路径到 SHA-256 字符串”的直接映射；不能添加 `version`、`files` 等包装字段。宿主安装时会将该 map 与除 `checksums.json`、`signature.json` 外的全部包文件逐项比较。

```json
{
  "manifest.json": "...",
  "main.js": "...",
  "bin/plugin.exe": "..."
}
```

包文件最多 128 MiB，解压后最多 256 MiB，单文件最多 128 MiB，文件数最多 2048，manifest 最多 64 KiB。路径使用 `/`，拒绝绝对路径、`..`、链接、Windows 设备名和仅大小写不同的重复文件。不要手工改摘要或已安装文件；重新打包和安装。

JS/TS 包通常可跨桌面平台使用，仍需核对 WebView API。原生包每份只声明一个平台，见 [Rust sidecar 指南](native-sidecars.md)。
