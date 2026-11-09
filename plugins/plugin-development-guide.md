# Hiviewer 插件开发手册

> 基于 `plugins/schema/manifest.v1.json`、`plugins/sdk/`、`src-tauri/src/plugins/` 和 `src/hiviewer/plugins/` 的完整开发参考。

---

## 目录

1. [概述](#1-概述)
2. [插件目录结构](#2-插件目录结构)
3. [manifest.json 详解](#3-manifestjson-详解)
4. [权限系统](#4-权限系统)
5. [命令与 Handler 类型](#5-命令与-handler-类型)
6. [扩展点（contributions）](#6-扩展点contributions)
7. [TypeScript Worker 插件开发](#7-typescript-worker-插件开发)
8. [Rust Sidecar 插件开发](#8-rust-sidecar-插件开发)
9. [native-view 插件开发（Tauri 应用）](#9-native-view-插件开发tauri-应用)
10. [图片格式解码器插件](#10-图片格式解码器插件)
11. [宿主 API 参考](#11-宿主-api-参考)
12. [配置项（configuration）](#12-配置项configuration)
13. [国际化（localizations）](#13-国际化localizations)
14. [打包与分发](#14-打包与分发)
15. [开发工具与 CLI](#15-开发工具与-cli)
16. [测试与验证](#16-测试与验证)
17. [限制与约束](#17-限制与约束)
18. [示例插件解析：qualcomm-aecx](#18-示例插件解析qualcomm-aecx)

---

## 1. 概述

Hiviewer 插件系统允许第三方开发者通过标准接口扩展宿主的图片分析、格式解码、EXIF 提供和自定义看图能力。

**核心设计原则：**

- 插件与宿主之间通过 **JSON-RPC 2.0 协议**通信，不共享内存
- 生命周期、授权和资源所有权统一由 **Rust 宿主**管理
- JS/TS Worker 运行在 **iframe sandbox** 中（CSP `connect-src none`）
- native sidecar 进程通过 **stdin/stdout** 传输协议帧，stderr 保留给日志
- 同一扩展名只能被一个已启用的解码器声明，冲突时安装失败

---

## 2. 插件目录结构

一个最简单的 TypeScript Worker 插件结构如下：

```
my-plugin/
├── manifest.json      # 必须：插件描述符
├── main.js            # 必须：捆绑后的 ES 模块入口（由 main.ts 编译）
├── main.ts            # 开发源文件（编译后删除或保留均可）
└── sdk/               # 可选：SDK 类型定义（开发时）
```

含原生 sidecar 的插件结构：

```
my-plugin/
├── manifest.json
├── main.js
├── bin/
│   └── my-plugin.exe  # 原生可执行文件（路径必须以 bin/ 开头）
└── ui/
    └── panel.html     # view handler 所需的 HTML 入口（可选）
```

打包后生成 `.hvp` 文件（本质是 ZIP），额外包含：

```
my-plugin-1.0.0-windows-x86_64.hvp
├── manifest.json
├── main.js
├── bin/my-plugin.exe
└── checksums.json     # 打包工具自动生成
```

---

## 3. manifest.json 详解

`manifest.json` 是插件的核心描述符，由宿主在安装、启用、每次调用前校验。

### 完整字段说明

```jsonc
{
  "$schema": "...",            // 可选，IDE 智能提示用
  "manifestVersion": 1,        // 固定值 1
  "apiVersion": 1,             // 固定值 1
  "id": "hiviewer.my-plugin",  // 唯一 ID：小写字母开头，只含 [a-z0-9.-]，≤96 字符
  "name": "我的插件",           // 显示名称，1~120 字符
  "version": "1.0.0",          // semver：major.minor.patch（不带前缀 v）
  "author": "作者名",           // 作者，1~120 字符
  "description": "插件功能描述", // 1~2000 字符
  "entry": "main.js",          // 固定值 "main.js"，必须是捆绑 ES 模块
  "dataVersion": 1,            // 数据版本，升级时递增（1~1000000）
  "permissions": [...],        // 见第 4 节
  "commands": [...],           // 见第 5 节
  "contributions": [...],      // 可选，见第 6 节
  "imageDecoders": [...],      // 可选，见第 10 节
  "backend": {...},            // 可选，sidecar/native-view 需要
  "ui": {...},                 // 可选，view handler 需要
  "configuration": [...],      // 可选，见第 12 节
  "localizations": {...}       // 可选，见第 13 节
}
```

### ID 命名规范

```
格式：^[a-z][a-z0-9.-]{0,95}$
推荐：<组织>.<插件名>
示例：hiviewer.qualcomm-aecx
      acme.psd-decoder
      my-org.custom-exif
```

### backend 字段

声明原生可执行文件，`sidecar` 和 `native-view` handler 必须有此字段。

```jsonc
"backend": {
  "executable": "bin/my-plugin.exe",   // 必须以 bin/ 开头，相对于插件根目录
  "target": "windows-x86_64",          // 平台标识（见下表）
  "transport": "stdio-jsonl"           // "stdio-jsonl"（默认）或 "stdio-framed"
}
```

支持的 `target` 值：

| 值 | 平台 |
|---|---|
| `windows-x86_64` | Windows x64 |
| `windows-aarch64` | Windows ARM64 |
| `macos-x86_64` | macOS Intel |
| `macos-aarch64` | macOS Apple Silicon |
| `linux-x86_64` | Linux x64 |
| `linux-aarch64` | Linux ARM64 |

> 图片解码器插件必须使用 `"transport": "stdio-framed"`（用于传输二进制 PNG 帧）。

### ui 字段

`view` handler 需要提供 HTML 入口文件。

```jsonc
"ui": {
  "entry": "ui/panel.html"   // 必须以 ui/ 开头，以 .html 结尾
}
```

---

## 4. 权限系统

所有权限须在 `permissions` 数组中显式声明，未声明的 Host API 方法调用会被拒绝。

| 权限 | 说明 |
|---|---|
| `selection.read` | 读取当前选中的文件列表 |
| `metadata.read` | 读取图片/视频 EXIF 元数据 |
| `media.read` | 获取图片预览或视频资源 |
| `viewer.compare` | 触发宿主打开 Compare 窗口 |
| `storage` | 插件专属的持久化键值存储 |
| `notifications` | 显示系统通知 |
| `native.execute` | 启动 sidecar 原生进程（有 backend 时必须声明） |
| `files.export` | 导出/保存文件到用户选择路径 |
| `image.decode` | 注册自定义图片格式解码器 |

**典型权限组合：**

```jsonc
// 只读分析插件
"permissions": ["selection.read", "metadata.read"]

// 需要看图协同
"permissions": ["selection.read", "media.read", "viewer.compare"]

// 原生 sidecar 分析
"permissions": ["selection.read", "native.execute"]

// 图片格式解码器（必须同时有两个）
"permissions": ["native.execute", "image.decode"]
```

---

## 5. 命令与 Handler 类型

`commands` 数组定义了插件暴露的入口。每个命令对应一种执行方式（handler）。

```jsonc
"commands": [
  {
    "id": "analyze",               // 命令 ID，同插件内唯一
    "title": "分析图片",            // 显示名称
    "handler": "worker",           // 执行方式（见下）
    "method": "image/analyze",     // sidecar/native-view 必须声明；worker/view 可选
    "contexts": ["selection"],     // 可选，声明上下文
    "requiresSelection": true      // 可选，是否要求有文件选中
  }
]
```

### Handler 类型对比

| Handler | 运行环境 | 适用场景 |
|---|---|---|
| `worker` | iframe sandbox 内的 Web Worker | 纯 JS/TS 分析，不需要原生能力 |
| `view` | 宿主内嵌 WebView 面板 | 需要自定义 UI 面板（配合 `ui` 字段） |
| `sidecar` | 独立原生进程（JSON-RPC over stdio） | 需要原生计算能力，无 UI 窗口 |
| `native-view` | 独立 Tauri 应用进程（有自己的窗口） | 需要独立 UI 窗口（如调试工具） |

### method 命名规则

```
格式：^(?!(?:plugin|host)/)[A-Za-z0-9/_.-]+$，≤128 字符
示例：image/analyze
      view/open
      viewer/update
      psd/probe
      psd/decode
禁止：plugin/* 和 host/* 开头（协议保留前缀）
```

---

## 6. 扩展点（contributions）

`contributions` 将命令注册到宿主的特定 UI 位置，最多 64 个。

```jsonc
"contributions": [
  {
    "id": "my-analysis",          // 扩展点唯一 ID
    "kind": "image-analysis",     // 扩展类型（见下表）
    "title": "我的图片分析",        // 在宿主 UI 中显示的名称
    "command": "analyze",         // 引用的命令 ID（必须在 commands 中存在）
    "mediaTypes": ["image"]       // 仅 details-panel 需要，限定媒体类型
  }
]
```

| `kind` | 宿主显示位置 |
|---|---|
| `image-analysis` | 图片右键菜单"分析"子菜单 |
| `image-viewer` | 自定义图片查看器入口 |
| `video-viewer` | 自定义视频查看器入口 |
| `exif-provider` | EXIF 面板数据提供者 |
| `details-panel` | 详情侧边栏面板（`mediaTypes` 指定适用类型） |

---

## 7. TypeScript Worker 插件开发

Worker 插件是最简单的插件类型，运行在隔离的 iframe sandbox 内，适合纯逻辑分析。

### 7.1 创建项目

```bash
node plugins/tools/cli.mjs create my-analysis-plugin image-analysis
cd my-analysis-plugin
```

### 7.2 manifest.json 示例

```json
{
  "manifestVersion": 1,
  "apiVersion": 1,
  "id": "acme.image-analysis",
  "name": "图片分析",
  "version": "1.0.0",
  "author": "Acme",
  "description": "分析选中图片并返回报告。",
  "entry": "main.js",
  "permissions": ["selection.read", "metadata.read"],
  "commands": [
    {
      "id": "analyze",
      "title": "分析图片",
      "handler": "worker",
      "contexts": ["selection"],
      "requiresSelection": true
    }
  ],
  "contributions": [
    { "id": "analyze", "kind": "image-analysis", "title": "图片分析", "command": "analyze" }
  ]
}
```

### 7.3 main.ts 示例

```typescript
import { definePlugin } from "./sdk/index";

export default definePlugin({
  async activate(api) {
    // 插件激活时调用（可选）
    console.log("插件激活，locale:", api.locale);
  },

  commands: {
    analyze: async (api) => {
      // 1. 读取选中文件
      const files = await api.selection.get();
      if (files.length === 0) return;

      // 2. 上报进度
      api.progress(0.1, "正在读取元数据...");

      // 3. 读取 EXIF
      const meta = await api.metadata.read(files[0].path);

      api.progress(0.9, "生成报告...");

      // 4. 返回报告（Report 类型）
      return {
        title: "图片分析结果",
        text: `文件：${files[0].filename}\n尺寸：${files[0].width}×${files[0].height}`,
        columns: ["字段", "值"],
        rows: Object.entries(meta).map(([k, v]) => [k, v]),
      };
    },
  },

  deactivate() {
    // 插件停用时调用（可选）
  },
});
```

### 7.4 Report 类型

命令可以返回 `Report` 对象，宿主会在报告面板中展示：

```typescript
interface Report {
  title: string;           // 1~200 字符，必须
  text?: string;           // 纯文本，≤100000 字符
  columns?: string[];      // 表头，1~32 列，每列 ≤200 字符
  rows?: (string | number | boolean | null)[][];  // ≤2000 行，每格 ≤4096 字符
}
```

### 7.5 构建

```bash
# 编译 main.ts → main.js
node plugins/tools/cli.mjs build my-analysis-plugin

# 验证 manifest 和文件完整性
node plugins/tools/cli.mjs check my-analysis-plugin
```

---

## 8. Rust Sidecar 插件开发

Sidecar 插件以独立进程运行，通过 JSON-RPC over stdio 与宿主通信。适合需要原生计算的场景。

### 8.1 创建项目

```bash
node plugins/tools/cli.mjs create my-rust-plugin rust-analysis
```

### 8.2 manifest.json 示例

```json
{
  "manifestVersion": 1,
  "apiVersion": 1,
  "id": "acme.rust-analysis",
  "name": "Rust 分析插件",
  "version": "1.0.0",
  "author": "Acme",
  "description": "使用 Rust 进行高性能图片分析。",
  "entry": "main.js",
  "permissions": ["selection.read", "native.execute"],
  "commands": [
    {
      "id": "analyze",
      "title": "Rust 分析",
      "handler": "sidecar",
      "method": "image/analyze",
      "contexts": ["selection"],
      "requiresSelection": true
    }
  ],
  "backend": {
    "executable": "bin/my-rust-plugin.exe",
    "target": "windows-x86_64",
    "transport": "stdio-jsonl"
  },
  "contributions": [
    { "id": "analyze", "kind": "image-analysis", "title": "Rust 分析", "command": "analyze" }
  ]
}
```

### 8.3 Rust SDK 使用

在 `Cargo.toml` 中引用 SDK：

```toml
[dependencies]
hiviewer-plugin-sdk = { path = "sdk" }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

### 8.4 main.rs 示例

```rust
use hiviewer_plugin_sdk::{json, serve, Transport, Value, Result};
use serde::Deserialize;

const PLUGIN_ID: &str = "acme.rust-analysis";
const PLUGIN_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzeParams {
    configuration: serde_json::Map<String, Value>,
    files: Vec<FileInfo>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileInfo {
    path: String,
    filename: String,
    size_bytes: u64,
    width: Option<u32>,
    height: Option<u32>,
}

fn main() -> Result<()> {
    // stdout 只用于协议帧，诊断日志用 stderr
    serve(
        PLUGIN_ID,
        PLUGIN_VERSION,
        Transport::JsonLines,  // 与 manifest 中 transport 对应
        |method, params, ctx| {
            match method {
                "image/analyze" => {
                    let p: AnalyzeParams = serde_json::from_value(params)?;

                    // 上报进度（非阻塞，宿主轮询）
                    ctx.progress(0.2, "正在分析...")?;

                    let Some(file) = p.files.first() else {
                        return Ok(json!(null));
                    };

                    // 执行分析逻辑...
                    eprintln!("分析文件: {}", file.path);  // 用 stderr 记录日志

                    ctx.progress(1.0, "完成")?;

                    // 返回 Report 格式
                    Ok(json!({
                        "title": format!("分析: {}", file.filename),
                        "columns": ["属性", "值"],
                        "rows": [
                            ["大小", file.size_bytes.to_string()],
                            ["宽度", file.width.map(|w| w.to_string()).unwrap_or_default()],
                            ["高度", file.height.map(|h| h.to_string()).unwrap_or_default()],
                        ]
                    }))
                }
                _ => Err(format!("未知方法: {method}").into()),
            }
        },
    )
}
```

### 8.5 JSON-RPC 协议握手

宿主在第一次调用前发送初始化请求，SDK 的 `serve()` 函数自动处理：

```jsonl
// 宿主 → 插件（stdin）
{"jsonrpc":"2.0","id":1,"method":"plugin/initialize","params":{"host":{"apiVersion":"1.0.0","protocolVersions":[1]},"plugin":{"id":"acme.rust-analysis","version":"1.0.0"},"permissions":["selection.read","native.execute"]}}

// 插件 → 宿主（stdout）
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"plugin":{"id":"acme.rust-analysis","version":"1.0.0"},"capabilities":[]}}

// 宿主调用插件方法
{"jsonrpc":"2.0","id":2,"method":"image/analyze","params":{...}}

// 插件上报进度（通知，无 id）
{"jsonrpc":"2.0","method":"plugin/progress","params":{"value":0.5,"message":"分析中..."}}

// 插件返回结果
{"jsonrpc":"2.0","id":2,"result":{...}}

// 宿主关闭插件
{"jsonrpc":"2.0","method":"plugin/shutdown"}
```

### 8.6 进程环境变量

宿主启动 sidecar 时注入以下环境变量（其余环境变量被清除）：

| 变量 | 内容 |
|---|---|
| `HIVIEWER_PLUGIN_DATA_DIR` | 插件专属数据目录（持久化存储） |
| `HIVIEWER_PLUGIN_ID` | 插件 ID（来自 manifest） |
| `HIVIEWER_PLUGIN_VERSION` | 插件版本 |
| `PATH`, `SystemRoot`, `WINDIR`, `TEMP`, `TMP` | 系统路径（Windows） |
| `LANG`, `TMPDIR` | 系统路径（Unix） |

---

## 9. native-view 插件开发（Tauri 应用）

`native-view` 插件是独立的 Tauri 应用进程，有自己的 WebView 窗口。宿主通过 stdio JSON-RPC 推送当前选中图片的快照，插件实时响应并更新 UI。

### 9.1 manifest.json 要求

`native-view` 插件有额外的 manifest 约束：

1. 必须声明 `selection.read` 权限
2. 必须有实现 `viewer/update` 方法的命令
3. 必须有 `backend` 字段

```json
{
  "permissions": ["native.execute", "selection.read"],
  "commands": [
    { "id": "open", "title": "打开窗口", "handler": "native-view", "method": "view/open" },
    { "id": "update", "title": "同步图片", "handler": "native-view", "method": "viewer/update" }
  ],
  "backend": {
    "executable": "bin/my-native-plugin.exe",
    "target": "windows-x86_64",
    "transport": "stdio-jsonl"
  }
}
```

> 对于 `native-view` 插件，`main.js` 通常是空的存根：
> ```js
> // main.js — native-view 插件不需要 JS 逻辑
> export default { commands: {} };
> ```

### 9.2 ViewerSnapshot 数据结构

宿主推送的快照包含当前看图状态：

```typescript
interface ViewerSnapshot {
  source: string;           // "hiviewer" 或 "hiviewer-compare"
  sequence: number;         // 单调递增的版本号（旧快照必须丢弃）
  files: string[];          // 当前目录下的所有图片路径（≤1000 条）
  currentPath: string | null;  // 当前选中图片的绝对路径

  // Test Machine 模式（测试机列）
  testMachineColumnPath: string | null;
  testMachineFiles: string[];
  testMachineCurrentPath: string | null;

  // 主题色彩令牌（可为 null）
  theme: {
    dark: boolean;
    background: string;     // #rrggbb 格式
    foreground: string;
    border: string;
    primary: string;
    muted: string;
    mutedForeground: string;
    popover: string;
    popoverForeground: string;
  } | null;
}
```

### 9.3 协议方法约定

| 方法 | 触发时机 | params | 返回值 |
|---|---|---|---|
| `view/open` | 用户首次打开插件窗口 | `{ viewer: ViewerSnapshot, configuration }` | `{ accepted: boolean }` |
| `viewer/update` | 每次图片选择变化 | `{ viewer: ViewerSnapshot }` | `{ accepted: boolean }` |

**关键行为规则：**
- 若收到的 `sequence < 当前持有的 sequence`，返回 `{ accepted: false }` 并丢弃该快照
- stdin 关闭 (EOF) 意味着宿主已吊销会话，进程必须退出（`std::process::exit(0)`）
- `view/open` 时应将已有窗口恢复到前台（`window.unminimize()` + `window.set_focus()`）

### 9.4 Tauri 应用中的协议集成

```rust
use hiviewer_plugin_sdk::{json, serve, Transport};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

const PLUGIN_ID: &str = "acme.my-native-plugin";

fn main() {
    let shared_state = Arc::new(Mutex::new(MyState::default()));
    let protocol_state = shared_state.clone();

    tauri::Builder::default()
        .manage(shared_state)
        .setup(move |app| {
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let result = serve(
                    PLUGIN_ID,
                    env!("CARGO_PKG_VERSION"),
                    Transport::JsonLines,
                    move |method, params, _ctx| {
                        match method {
                            "view/open" | "viewer/update" => {
                                let update: serde_json::Value = params;
                                let sequence = update["viewer"]["sequence"]
                                    .as_u64().unwrap_or(0);

                                {
                                    let mut state = protocol_state.lock().unwrap();
                                    if sequence < state.sequence {
                                        return Ok(json!({"accepted": false}));
                                    }
                                    state.sequence = sequence;
                                    state.current_path = update["viewer"]["currentPath"]
                                        .as_str().map(String::from);
                                }

                                // 通知 Tauri 前端更新
                                let _ = handle.emit("selection-changed", sequence);

                                if method == "view/open" {
                                    if let Some(window) = handle.get_webview_window("main") {
                                        let _ = window.unminimize();
                                        let _ = window.set_focus();
                                    }
                                }

                                Ok(json!({"accepted": true}))
                            }
                            _ => Err(format!("未知方法: {method}").into()),
                        }
                    },
                );
                if let Err(e) = result {
                    eprintln!("Protocol error: {e}");
                }
                // stdin EOF → 宿主已吊销会话，必须退出
                std::process::exit(0);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to run plugin");
}
```

---

## 10. 图片格式解码器插件

解码器插件让宿主能够打开自定义图片格式（如 PSD、RAW 等）。

### 10.1 特殊要求

- 必须使用 `"transport": "stdio-framed"` 传输（支持二进制 PNG 帧）
- 必须同时声明 `native.execute` 和 `image.decode` 权限
- 同一扩展名只能被一个已启用插件声明，冲突时安装失败
- 解码结果必须是**已归一方向的 sRGB RGB8/RGBA8 PNG**
- 格式解码只能在阻塞工作线程中调度

### 10.2 manifest.json 示例

```json
{
  "manifestVersion": 1,
  "apiVersion": 1,
  "id": "acme.psd-decoder",
  "name": "PSD 解码器",
  "version": "1.0.0",
  "author": "Acme",
  "description": "解码 Adobe Photoshop PSD 文件。",
  "entry": "main.js",
  "permissions": ["native.execute", "image.decode"],
  "commands": [
    { "id": "probe", "title": "探测 PSD", "handler": "sidecar", "method": "psd/probe" },
    { "id": "decode", "title": "解码 PSD", "handler": "sidecar", "method": "psd/decode" }
  ],
  "backend": {
    "executable": "bin/psd-decoder.exe",
    "target": "windows-x86_64",
    "transport": "stdio-framed"
  },
  "imageDecoders": [
    {
      "id": "psd",
      "extensions": ["psd", "psb"],
      "probe": "psd/probe",
      "decode": "psd/decode"
    }
  ]
}
```

### 10.3 Rust 解码器实现

```rust
use hiviewer_plugin_sdk::{image, serve, Transport};

fn main() {
    serve(
        "acme.psd-decoder",
        env!("CARGO_PKG_VERSION"),
        Transport::Framed,  // 必须是 Framed
        |method, params, ctx| {
            let path = params["path"].as_str().ok_or("missing path")?;

            match method {
                // probe: 快速读取尺寸，不需要完整解码
                "psd/probe" => {
                    let (width, height) = read_psd_dimensions(path)?;
                    Ok(image::probe(width, height))
                }
                // decode: 完整解码并返回 PNG
                "psd/decode" => {
                    let (png_bytes, width, height, src_w, src_h) = decode_psd_to_png(path)?;
                    // 先发 binary 帧，再返回 JSON 描述符
                    image::png(ctx, &png_bytes, (width, height), (src_w, src_h))
                }
                _ => Err(format!("未知方法: {method}").into()),
            }
        },
    ).unwrap();
}
```

**probe 方法的 params：**
```json
{ "path": "/absolute/path/to/image.psd" }
```

**probe 方法的返回值（由 `image::probe()` 生成）：**
```json
{ "width": 1920, "height": 1080, "colorSpace": "srgb", "orientation": 1 }
```

**decode 方法返回值（由 `image::png()` 生成）：**
先发送二进制帧（channel = `"image"`，内容为 PNG 字节），然后返回：
```json
{
  "channel": "image",
  "mime": "image/png",
  "width": 1920, "height": 1080,
  "sourceWidth": 1920, "sourceHeight": 1080,
  "colorSpace": "srgb", "orientation": 1
}
```

**限制：**
- 最大像素数：32 Mi（32 × 1024 × 1024）
- 最大源文件：256 MiB
- 最大输出 PNG 帧：64 MiB
- 最大并发解码请求：2
- 总超时：35 秒

---

## 11. 宿主 API 参考

Worker 插件（TypeScript）通过 `api` 参数访问宿主能力。

```typescript
interface HostApi {
  readonly version: 1;
  readonly locale: string;        // 当前语言，如 "zh-CN"
  readonly configuration: Readonly<Record<string, string | number | boolean>>;

  // 选择
  selection: {
    get(): Promise<MediaFile[]>;  // 返回当前选中文件
  };

  // 元数据（EXIF 等）
  metadata: {
    read(path: string): Promise<Record<string, string>>;
  };

  // 媒体资源
  media: {
    preview(path: string): Promise<ImagePreview>;   // 获取图片预览
    video(path: string): Promise<VideoResource>;    // 获取视频资源
    readBytes(resourceId: string): Promise<ArrayBuffer>;
    release(resourceId: string): Promise<void>;
  };

  // Sidecar 后端通信
  backend: {
    invoke<T>(method: string, params?: unknown): Promise<T>;
    readBinary(channel: string): Promise<ArrayBuffer>;
    logs(): Promise<string[]>;
  };

  // 插件自带资源文件
  assets: {
    read(relativePath: string): Promise<ArrayBuffer>;
  };

  // 文件导出
  exports: {
    save(filename: string, data: ArrayBuffer): Promise<string | null>;
  };

  // 看图协同
  viewer: {
    compare(paths: string[]): Promise<void>;
  };

  // 持久化键值存储（按插件隔离）
  storage: {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
  };

  // 系统通知
  notifications: {
    show(message: string): Promise<void>;
  };
}

// Worker 命令的 api 额外提供进度上报
interface CommandApi extends HostApi {
  progress(fraction: number, message?: string): void;  // fraction: 0~1
}
```

### MediaFile 类型

```typescript
interface MediaFile {
  path: string;
  filename: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
}
```

---

## 12. 配置项（configuration）

插件可声明用户可配置的参数，最多 32 个。

```jsonc
"configuration": [
  {
    "key": "api-endpoint",       // 键名，格式同 id
    "title": "API 端点",          // 显示名称
    "type": "string",            // "string" | "number" | "boolean"
    "default": ""                // 默认值（类型必须与 type 一致）
  },
  {
    "key": "max-results",
    "title": "最大结果数",
    "type": "number",
    "default": 100
  },
  {
    "key": "debug-mode",
    "title": "调试模式",
    "type": "boolean",
    "default": false
  }
]
```

- **string 类型**：用户输入的字符串，最长 4096 字符
- **number 类型**：任意 JSON 数值
- **boolean 类型**：开关值

在插件内读取配置：

```typescript
// TypeScript Worker
const endpoint = api.configuration["api-endpoint"] as string;
const maxResults = api.configuration["max-results"] as number;
```

```rust
// Rust Sidecar（params 中的 configuration 字段）
let config = params["configuration"].as_object().unwrap();
let endpoint = config.get("api-endpoint").and_then(|v| v.as_str()).unwrap_or("");
```

---

## 13. 国际化（localizations）

`localizations` 支持按语言覆盖 manifest 中的显示文本，最多 16 种语言，每种最多 128 个键值对。该数量是插件 manifest 的独立上限；LUXE 宿主当前支持的语言仍以 `src/locales/index.ts` 和 Rust `LANGUAGE_LOCALES` 中的五种语言为准。

```jsonc
"localizations": {
  "en-US": {
    "name": "My Plugin",
    "description": "Analyzes selected images.",
    "commands.analyze.title": "Analyze Image",
    "contributions.analyze.title": "Image Analysis"
  },
  "zh-CN": {
    "name": "我的插件",
    "description": "分析选中的图片。"
  }
}
```

键名最长 128 字符，值最长 2000 字符。宿主根据系统语言自动选择最佳匹配。

---

## 14. 打包与分发

### 14.1 插件包格式

插件包是后缀为 `.hvp` 的 ZIP 文件，包含：

```
my-plugin-1.0.0-windows-x86_64.hvp
├── manifest.json        # 插件描述符
├── main.js              # 捆绑后的入口
├── bin/
│   └── my-plugin.exe    # 原生可执行文件（如有）
├── ui/
│   └── panel.html       # WebView UI（如有）
└── checksums.json       # 文件摘要（打包工具自动生成）
```

### 14.2 打包命令

```bash
# 构建 JS 入口
node plugins/tools/cli.mjs build my-plugin/

# 验证 manifest 合法性和文件完整性
node plugins/tools/cli.mjs check my-plugin/

# 打包为 .hvp
node plugins/tools/cli.mjs pack my-plugin/ my-plugin-1.0.0-windows-x86_64.hvp
```

打包命令会输出 `.hvp` 文件的 SHA-256 摘要，在线分发时需要将此摘要填入 catalog：

```
my-plugin-1.0.0-windows-x86_64.hvp: 102400 bytes, SHA-256 a3f1c2d4...
```

### 14.3 本地安装流程

1. 用户在设置中选择本地 `.hvp` 文件
2. 宿主解压并校验 `checksums.json`
3. 显示 manifest 信息和权限请求，等待用户确认
4. 安装为"已禁用"状态
5. 用户在设置中手动启用插件

### 14.4 在线分发（插件中心）

在线分发需要提供 catalog 文件：

```json
{
  "version": 1,
  "plugins": [
    {
      "id": "acme.my-plugin",
      "name": "我的插件",
      "version": "1.0.0",
      "target": "windows-x86_64",
      "url": "https://example.com/my-plugin-1.0.0-windows-x86_64.hvp",
      "sha256": "a3f1c2d4..."
    }
  ]
}
```

宿主下载时：
- 严格限额和速率控制
- 下载后核对 SHA-256
- 沿用与本地安装相同的检查/安装/启用授权流程

---

## 15. 开发工具与 CLI

所有开发工具位于 `plugins/tools/`，通过以下命令调用：

```bash
# 从模板创建新插件
node plugins/tools/cli.mjs create <目录> [模板名]

# 可用模板：
#   image-analysis   - TypeScript Worker，图片分析
#   image-viewer     - TypeScript Worker，自定义图片查看器
#   video-viewer     - TypeScript Worker，自定义视频查看器
#   exif-provider    - TypeScript Worker，EXIF 数据提供者
#   details-panel    - TypeScript Worker，详情面板
#   rust-analysis    - Rust Sidecar，图片分析
#   psd-decoder      - Rust 图片格式解码器

# 编译 TypeScript 入口（仅构建 main.js）
node plugins/tools/cli.mjs build <目录>

# 校验插件（manifest 合法性 + 文件检查）
node plugins/tools/cli.mjs check <目录>

# 打包为 .hvp
node plugins/tools/cli.mjs pack <目录> <输出路径.hvp>

# 启动开发服务器（热重载）
node plugins/tools/cli.mjs dev <目录>
```

---

## 16. 测试与验证

### 16.1 TypeScript 插件

```bash
# 类型检查
npx tsc --noEmit -p my-plugin/tsconfig.json

# 单元测试（如有 .test.ts 文件）
npx vitest run my-plugin/

# 构建检查
node plugins/tools/cli.mjs build my-plugin/
node plugins/tools/cli.mjs check my-plugin/
```

### 16.2 Rust 插件

```bash
# 类型检查
cargo check --manifest-path my-plugin/Cargo.toml --locked

# 单元测试
cargo test --manifest-path my-plugin/Cargo.toml --locked
```

### 16.3 宿主集成测试

```bash
# 构建完整前端
npm run build

# i18n 测试
npm run test:i18n

# 插件系统测试
npm run test:plugins

# Rust 宿主检查
cargo check --manifest-path src-tauri/Cargo.toml

# 宿主定向测试
./plugins/tools/test-host.ps1
```

### 16.4 注意事项

- 验收结果必须记录到 `docs/plugins/verification.md`
- **未在真实桌面环境测试的平台不能标为通过**（模拟器或编译通过不算）
- 跨平台支持必须在对应平台上实际验证

---

## 17. 限制与约束

### 协议限制

| 项目 | 限制 |
|---|---|
| JSON 消息最大体积 | 8 MiB |
| 二进制帧最大体积 | 64 MiB |
| 进度更新最小间隔 | 100ms（宿主节流） |
| 命令超时 | 60 秒 |
| Sidecar 单次请求超时 | 30 秒 |
| 进度轮询间隔 | 500ms |
| 最大并发 sidecar 进程 | 8 个 |
| 最大并发 Worker 请求 | 8 个（同一 session） |
| 最大 Worker 请求总数 | 512 次（同一 session） |

### Manifest 限制

| 字段 | 限制 |
|---|---|
| `commands` | 最多 32 个 |
| `contributions` | 最多 64 个 |
| `imageDecoders` | 最多 16 个 |
| `configuration` | 最多 32 个 |
| `localizations` | 最多 16 种语言，每种最多 128 个键（插件 manifest 上限） |
| `id` | 最长 96 字符 |
| `name` / `author` | 最长 120 字符 |
| `description` | 最长 2000 字符 |
| `version` | semver，major/minor/patch 各最长 8 位 |

### 图片解码器限制

| 项目 | 限制 |
|---|---|
| 最大像素数 | 32 Mi（32 × 1024 × 1024） |
| 最大源文件 | 256 MiB |
| 最大输出 PNG | 64 MiB |
| 最大并发请求 | 2 个 |
| 总超时 | 35 秒 |
| 每个扩展名 | 只能被一个启用插件声明 |

### 安全约束

- sidecar 可执行文件必须位于 `bin/` 目录下（不能是符号链接）
- sidecar 工作目录为插件根目录
- sidecar 环境变量被清除（只保留白名单）
- Worker 运行在 CSP `connect-src none` 的 iframe sandbox 中
- native-view 收到 stdin EOF 必须退出，不能留下孤立进程

---

## 18. 示例插件解析：qualcomm-aecx

`plugins/qualcomm-aecx/` 是一个完整的 `native-view` 插件，展示了实际项目的完整结构。

### 18.1 插件架构

```
plugins/qualcomm-aecx/
├── manifest.json          # 声明 native-view handler
├── main.js                # 存根（native-view 不需要 JS 逻辑）
├── src-tauri/             # Tauri 应用（完整 WebView 窗口）
│   ├── src/
│   │   ├── main.rs        # 协议处理 + Tauri 应用入口
│   │   ├── aecx.rs        # 核心业务逻辑（XML 加载/解析）
│   │   ├── parser/        # AECX 数据结构解析
│   │   ├── qcparse/       # 高通 XML 解析器
│   │   └── payload.rs     # 报告数据结构
│   └── tauri.conf.json
└── web/                   # Tauri 前端（React/TypeScript）
    ├── App.tsx
    ├── ipc.ts
    └── panels/            # UI 面板组件
```

### 18.2 关键设计要点

**1. 序号保护（防止旧结果覆盖新图片）**

```rust
// aecx_load 命令：提交时校验序号
if sequence < latest {
    return Err(aecx::STALE.to_string());
}
// ... 执行耗时操作 ...
if sequence < current {
    return Err(aecx::STALE.to_string());
}
```

**2. 协议线程与 Tauri 线程分离**

stdin/stdout 协议处理在独立线程中运行，通过 Tauri `emit` 事件通知前端：

```rust
std::thread::spawn(move || {
    serve(PLUGIN_ID, version, Transport::JsonLines, move |method, params, _| {
        // 更新共享状态
        let _ = handle.emit(SELECTION_EVENT, selection);
        Ok(json!({"accepted": true}))
    });
    // stdin 关闭 → 退出
    std::process::exit(0);
});
```

**3. 主题色彩令牌**

宿主推送的 `theme` 字段包含 `#rrggbb` 格式的语义色彩令牌，插件用于保持与宿主主题一致。

### 18.3 验证步骤

```powershell
# TypeScript 类型检查
npx tsc --noEmit -p plugins/qualcomm-aecx/tsconfig.json

# 前端逻辑单测
npx vitest run plugins/qualcomm-aecx/web/panels/calculationHighlight.test.ts

# Rust 测试和检查
cargo test --manifest-path plugins/qualcomm-aecx/src-tauri/Cargo.toml --locked
cargo check --manifest-path plugins/qualcomm-aecx/src-tauri/Cargo.toml --locked

# 构建并打包
node plugins/qualcomm-aecx/build.mjs
node plugins/tools/cli.mjs check plugins/qualcomm-aecx/dist/windows-x86_64
```

---

## 附录：目录索引

| 路径 | 内容 |
|---|---|
| `plugins/schema/manifest.v1.json` | manifest JSON Schema |
| `plugins/sdk/typescript/index.ts` | TypeScript Host API 类型定义 |
| `plugins/sdk/rust/src/lib.rs` | Rust 协议 SDK |
| `plugins/sdk/rust/src/image.rs` | Rust 图片解码器辅助函数 |
| `plugins/tools/cli.mjs` | 开发工具 CLI |
| `plugins/qualcomm-aecx/` | 示例插件（native-view） |
| `src/hiviewer/plugins/` | 宿主前端插件运行时 |
| `src/hiviewer/plugins/pluginIpc.ts` | 宿主插件 IPC 封装 |
| `src/hiviewer/plugins/runtime.ts` | Worker 插件执行器 |
| `src/hiviewer/plugins/sandbox.ts` | iframe sandbox 创建 |
| `src-tauri/src/plugins/` | 宿主 Rust 插件运行时 |
| `src-tauri/src/plugins/manifest.rs` | manifest 解析与校验 |
| `src-tauri/src/plugins/sidecar.rs` | sidecar 进程管理 |
| `src-tauri/src/plugins/native_view.rs` | native-view 状态机 |
| `src-tauri/src/plugins/sessions.rs` | 会话授权管理 |
| `docs/plugins/verification.md` | 验收记录 |
