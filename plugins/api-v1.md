# Host API v1 参考

[返回开发指南](README.md) · [Manifest](manifest.md) · [错误排查](development.md)

公开类型以 [`plugins/sdk/typescript/index.ts`](../../plugins/sdk/typescript/index.ts) 为准。下列方法由 Worker 的命令参数 `api` 或 View 的 `window.hiviewer` 提供；View 先 `await api.ready`。不要直接调用宿主私有 IPC 或自己构造会话身份。

宿主校验错误通常带 `plugins/<code>`；底层 IO、JSON 解析和插件业务错误也可能是原始文本。API 失败通过 Promise 拒绝传递，调用方应捕获并显示可理解的错误。

| API | 权限 | 输入 / 输出 |
| --- | --- | --- |
| `selection.get(): Promise<MediaFile[]>` | selection.read | 本次执行的选择快照；不是实时选择订阅 |
| `metadata.read(path: string): Promise<Record<string, string>>` | metadata.read | 所选路径的元数据；字段可能缺失 |
| `media.preview(path: string): Promise<ImagePreview>` | media.read | 所选图片的 PNG 资源描述，不是像素数组 |
| `media.video(path: string): Promise<VideoResource>` | media.read | 所选视频的流式 URL |
| `media.readBytes(resourceId: string): Promise<ArrayBuffer>` | media.read | 读取图片资源；视频返回 use-stream-url |
| `media.release(resourceId: string): Promise<void>` | media.read | 提前释放；会话结束也会统一回收 |
| `viewer.compare(paths: string[]): Promise<void>` | viewer.compare | 快照中 1–64 个路径；重复路径去重后打开 |
| `storage.get<T = unknown>(key: string): Promise<T \| null>` | storage | 不存在返回 null；泛型不执行运行时类型校验 |
| `storage.set(key: string, value: unknown): Promise<void>` | storage | 保存 JSON 值；不保存函数、BigInt、循环引用、媒体句柄 |
| `storage.remove(key: string): Promise<void>` | storage | 删除私有键 |
| `notifications.show(message: string): Promise<void>` | notifications | 宿主短通知，最长 1000 字符 |
| `backend.invoke<T = unknown>(method: string, params?: unknown): Promise<T>` | native.execute | 调用 manifest 白名单方法，结果需要自行校验 |
| `backend.readBinary(channel: string): Promise<ArrayBuffer>` | native.execute | 消费一次已到达的二进制帧；不是等待下一帧的订阅 |
| `backend.logs(): Promise<string[]>` | native.execute | 当前会话最近 500 条日志 |
| `assets.read(relativePath: string): Promise<ArrayBuffer>` | 无附加权限 | 本插件 ui/ 下资源，例如 ui/data.json，单次最多 16 MiB |
| `exports.save(filename: string, data: ArrayBuffer): Promise<string \| null>` | files.export | 保存成功返回路径，取消返回 null；拒绝任何已有目标 |

UI bridge 初始化包含 locale、theme tokens、configuration、capabilities（已授予权限的布尔映射）。插件 UI 可以订阅 environment.changed。v1 使用打开视图时的固定选择快照，不发出 context.changed；重新打开创建新会话和资源。

## 数据结构与环境

```ts
interface MediaFile {
  path: string;
  filename: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}
interface ImagePreview {
  resourceId: string;
  url: string;
  mime: string; // 当前为 image/png
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  colorSpace: 'srgb';
  orientation: 1;
  mediaVersion: 1;
}
interface VideoResource {
  resourceId: string;
  url: string;
  mime: string;
  timeBase: 'seconds';
  mediaVersion: 1;
}
```

不要假设 selection 已有尺寸；未知时 width/height 为 null。图片预览的尺寸与源尺寸分别读取。资源 URL 绑定当前会话，不保存到 storage，也不传给其他窗口。

| 对象 | 额外字段 |
| --- | --- |
| HostApi（两种运行环境共有） | `version: 1`、`locale: string`、只读 `configuration: Record<string, string \| number \| boolean>` |
| CommandApi（Worker） | `progress(fraction: number, message?: string): void`；fraction 使用 0–1，进度会节流 |
| ViewApi（iframe） | `ready: Promise<void>`、`capabilities: Record<string, boolean>`、`events.on('environment.changed', callback): () => void` |

environment.changed 回调参数为 `{locale, theme, configuration}`，theme 是 CSS token 映射，返回函数用于取消订阅。不要在 View 调用 progress，或在 Worker 访问 ready/events/DOM。配置变更会撤销已有会话，需要重新运行/打开。

## 命令与结果

Manifest commands 声明 id/title/contexts/requiresSelection/handler（worker、sidecar、view）/method。Worker 默认导出 `{activate?, commands, deactivate?}`。命令可返回 `{title,text?,columns?,rows?}`，宿主用文本节点安全渲染。

```ts
interface Report {
  title: string;
  text?: string;
  columns?: string[];
  rows?: (string | number | boolean | null)[][];
}
```

title 最长 200 字符；text 最长 100000 字符。columns 与 rows 必须同时提供，1–32 列、最多 2000 行，每行长度与列数相同；列名最多 200 字符，字符串单元格最多 4096 字符，数字必须有限。总大小仍受消息限额约束。没有报告时可返回 void；报告文本不会作为 HTML 执行。

activate 在命令前执行，正常结束调用 deactivate；强制取消直接销毁 Worker，不能依赖退出钩子持久化。完整可运行示例见[快速入门](quick-start.md)。

## Sidecar

握手 `plugin/initialize` 返回 `{protocolVersion:1,plugin:{id,version},capabilities:[]}`；初始化后可以分派 Manifest 声明的 method。Rust SDK 能接受 plugin/shutdown 通知；宿主 v1 在取消、关闭、禁用或到期时直接结束进程树，插件必须采用可中断的持久化方式。取消先撤销 session，并释放待处理响应。

JSONL 每行一个 JSON-RPC 消息。Framed 格式为 `u32 little-endian payloadLength + u8 kind + payload`，kind 0 为 UTF-8 JSON，kind 1 为 `u16 LE channelLength + UTF-8 channel + bytes`。长度包含 kind。v1 的二进制通道方向为后端到宿主。保留 host/ 前缀，但当前返回 -32601，不发布 host callback capability。发送 plugin/progress 通知可更新原生命令进度。

独立 sidecar 命令接收 `{files, configuration}`；files 仅在 selection.read 已授权时提供。Worker/View 的 backend.invoke 只发送自己传入的 params。Rust 完整示例、目标平台和二进制复制步骤见 [native-sidecars.md](native-sidecars.md)。

## 自动图片格式

Manifest 可声明 `imageDecoders: [{id, extensions, probe, decode}]`。要求 `native.execute` 和 `image.decode` 授权，backend.transport 为 `stdio-framed`；纯格式插件可以使用空 commands。该权限允许浏览目录时自动读取声明格式的文件，不受用户手动选择快照限制。

probe 接收 `{path, configuration, maxEdge: null, maxPixels}`，返回 `{width,height,colorSpace:"srgb",orientation:1}`。decode 接收相同参数；maxEdge 为 null 表示全尺寸，为正整数表示缩略图。先发送 PNG 二进制帧，再返回 `{channel,mime:"image/png",width,height,sourceWidth,sourceHeight,colorSpace:"srgb",orientation:1}`。

PNG 必须为 RGB8/RGBA8，已完成方向与色彩归一。宿主验证实际 PNG 尺寸、颜色类型、输出上限和会话版本。请求总期限 35 秒（含排队/握手），单 RPC 30 秒，同时最多两个请求；源文件不超过 256 MiB，源/输出不超过 32 Mi 像素，单边不超过 32768，二进制帧不超过 64 MiB。

Rust SDK 的 `image::probe` 和 `image::png` 构造响应；详细说明见 [image-decoders.md](image-decoders.md)。

## 媒体与限额

metadata.read 返回 Record<string,string>。media.preview 返回 resourceId/url/mime/width/height/sourceWidth/sourceHeight/colorSpace/orientation/mediaVersion，输出为 sRGB、Orientation 1、最长边 2048 的 PNG。media.video 返回 resourceId/url/mime/timeBase/mediaVersion，timeBase 为 seconds；仅暴露系统 WebView 支持的容器，未知容器报错，不自动转码。

| 项目 | 当前限制 |
| --- | --- |
| 普通消息/报告 | 512 KiB 级别；前端按序列化字符串长度、后端按字节校验，应预留余量 |
| 选择/会话 | 选择最多 1000 个文件，全局最多 8 个活动会话 |
| Host API 请求 | 单会话最多 8 个待处理请求；Worker 每次运行最多 512 次请求，常驻 View 每分钟最多 512 次 |
| 时限 | Worker/普通命令 60 秒，sidecar 单 RPC 30 秒；自动格式总期限 35 秒 |
| 原生传输 | JSON 8 MiB，二进制帧载荷 64 MiB（含通道头部）；不使用 Base64 携带像素 |
| 私有 storage | 每插件序列化总计 256 KiB；key 非空且最多 128 UTF-8 字节 |
| 导出 | data 最多 32 MiB，filename 不含目录、最多 200 字符并满足包路径命名规则 |
| 图片预览 | 输入文件最多 256 MiB；输出最长边 2048，sRGB/Orientation 1 PNG |
| 媒体资源 | 全局最多 128 个，内存字节总计 128 MiB，每会话最多 32 个；文件流不按整段视频计入内存字节 |
| 视频 Range | 单响应最多 4 MiB；不带 Range 的 GET 最多 16 MiB，超出 413；HEAD 返回完整长度，非法 Range 返回 416 |

导出 filename 是建议文件名，实际位置由用户选择。保存对话框打开期间也可能超时或会话失效，应按错误处理，不能假设用户最终一定保存。读取多个媒体时控制并发，使用 finally 释放已取得资源。
