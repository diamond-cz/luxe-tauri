# HiViewer 插件启用、状态检查与更新安装改造指南

## 0.1.7：卡片触发一键流程，插件窗口展示进度

本轮继续只读HiViewer。`src/hiviewer/plugins/PluginCenter.tsx` 的卡片仅显示清单命令按钮；`PluginProvider.executeContext` 对native-view直接调用 `pluginIpc.openNative` 并返回，不创建 `PluginRunDialog` 任务。虽然sidecar支持plugin/progress，现有卡片没有订阅native-view进度；将命令改为sidecar还会转为独立运行流程，受到普通任务60秒期限且不等同原生视图会话交接。因此0.1.7保持manifest契约不变，在现有updater/open处理返回accepted后由原进程 `start_from_host` 启动一次后台任务，并打开插件进度窗口。

`get_bridge_state.updateProgress` 与plugin-update-progress事件共享递增sequence快照；WebView只呈现任务，不再通过恢复状态重发更新。下载进度来自实际HTTP读取字节，校验/安装不确定，不伪造百分比。同一进程内重复请求或窗口按钮点击不启动并行任务，更新不依赖窗口就绪；错误/无更新/手动包路径/已安装均为明确终态。当前 `native_view::open_inner` 仍会结束旧会话再新建，重复点击宿主卡片不能保证保留原任务；需宿主实现后文的会话复用后才能保证跨卡片重复调用幂等。

如果后续必须在截图所示卡片内直接显示进度条，需要在HiViewer另行实现以下宿主变更，本仓库未代为实现：

| 宿主入口 | 建议接线及可验证要求 |
| --- | --- |
| `src-tauri/src/plugins/native_view.rs / sidecar.rs` | 基于当前owner/plugin/revision关联运行会话，公开受限的native-view进度查询或事件；不能接受任意插件指定其他session/token读取状态 |
| `src/hiviewer/plugins/pluginIpc.ts / PluginProvider.tsx` | 订阅该宿主进度，按插件ID/revision隔离任务；事件解绑、窗口关闭、停用/卸载时清理；重开时读取最新快照 |
| `src/hiviewer/plugins/PluginCenter.tsx` | 在对应卡片命令栏下渲染阶段、下载字节和进度条；未知total用indeterminate，不用普通sidecar任务60秒期限强杀长下载 |
| 安装交接 | commit成功后刷新安装记录及版本；旧revision进度不能覆盖新revision，结束旧任务时不展示正常交接为安装失败 |

0.1.6→0.1.7不新增权限、命令或数据版本，原自更新接口可直接导入；旧版0.1.6仍先检查再点击下载，新的一键及进度能力在0.1.7运行后生效。

## 2026-11-18：新版宿主自更新接口已接入 LUXE 插件0.1.6

本节优先于下方2026-11-14的历史分析。只读核对 `D:/Image_process/hiviewer_rs` 提交 `faa06671`：`docs/plugins/native-updates.md`、`plugins/sdk/rust/src/lib.rs`、`src-tauri/src/plugins/{sidecar,update_rpc,native_update}.rs` 已定义可用的原生自更新契约，旧结论“无host安装回调”不再适用于支持该能力的宿主。当前修改仅在LUXE仓库，不改HiViewer。

| 环节 | 当前实际接口与LUXE实现 |
| --- | --- |
| 首次接入 | 0.1.6完整包声明native.update；从0.1.5首次升级须完整包安装并授予新增权限 |
| 能力协商 | plugin/initialize.params中的host.capabilities含plugin.update.v1且permissions含native.update；缺少任一项仅提供手动包安装 |
| 下载校验 | 固定gh-proxy目录、原地址回退、SHA256及manifest身份校验保持原逻辑；独立安装还比较除版本外的全部manifest声明，变更契约须完整包审查 |
| 文件准备 | update.ps1将bin文件解至HIVIEWER_PLUGIN_DATA_DIR/updates/runtime-版本-随机值，仅运行目录导入；拒绝路径穿越、链接、重名和过大解包内容，不执行安装器 |
| prepare | 原插件进程通过当前stdout发送字符串ID请求host/plugin.update.prepare，只含executable/version；宿主检查并返回规范路径、版本、digest |
| commit | 同一会话发送host/plugin.update.commit，只含prepare返回的executable/version及expectedDigest；校验回执pluginId/version/enabled/status/revision |
| complete | 消费commit回执、尽力保存本地回执并清理已复制候选后，发送无ID的host/plugin.update.complete；之后可能立即被宿主结束，不依赖UI invoke返回判断安装是否成功 |
| 并发 | host_update.rs单个在途回调、唯一字符串ID、60秒超时；stdin主循环继续处理数字ID的viewer/update，响应按ID送回等待线程；stdout互斥串行写入 |
| 恢复 | 宿主复用授权、数据及集成声明，管理新revision并尝试恢复打开的native-view及最新viewer快照；commit成功不代表新版握手或UI一定成功，须分别验收 |

不移动安装目录中的旧EXE，不自行改宿主安装记录；host API安装失败保留原安装，超时不盲目重发commit。候选目录最多保留2份未解决记录，明确失败/成功的候选会尝试清理，超时保留供核对宿主状态。权限、命令、Worker、dataVersion或其他声明变化时不走独立更新。自更新不推定存在host/image.select，也不证明启用生命周期已经接线。

验证入口为 `npm run plugin:test / sync:test` 和原有插件CI：PowerShell实际ZIP测试覆盖资源层级、契约变化及路径拒绝；JS测试覆盖“下载并安装”、旧宿主回退和安装状态；Rust新增能力/权限、交错viewer消息、原会话prepare/commit/complete顺序、错误与断开测试。本地Rust只做rustfmt静态检查；尚未发布的0.1.6包、真实跨版本安装及视图恢复仍需CI产物与Windows宿主验收。

## 以下为2026-11-14宿主改造历史分析

## 范围与当前结论

本文供后续在 `D:/Image_process/hiviewer_rs` 中实施优化使用。本轮只修改 `D:/Image_process/luxe-tauri`，没有把本文中的宿主方案写入 HiViewer，也没有声明宿主功能已完成。

LUXE 插件 0.1.5 已提供卡片上的“检查 LUXE 图片联动状态”和“检查插件更新”命令、隐藏后台启动方法、代理更新查询及更新包校验。当前 HiViewer 仍需要至少执行一次原生命令建立同步会话；下载后的包仍需通过宿主“从插件包安装／更新”确认安装。

后续目标：用户授权启用后后台立即同步；查看状态或检查更新不重启同步进程；检查更新后在宿主内完成下载、安装确认和升级；重启 HiViewer 后恢复已授权插件。现有权限、摘要、平台、数据版本和 revision 检查必须保留。

## 代码证据与根因

以下路径均位于 `D:/Image_process/hiviewer_rs/`，以 2026-11-14 只读检查的代码为依据，实施前重新核对实际分支。

| 入口 | 已确认行为 | 对用户操作的影响 |
| --- | --- | --- |
| `src-tauri/src/commands/hiviewer_plugins.rs::hiviewer_plugins_configure` | 保存 enabled/grants/settings 和新 revision，停止旧插件会话、刷新格式；没有启动 native-view | 点击“启用”不会创建图片同步进程 |
| `src-tauri/src/commands/hiviewer_plugins.rs::hiviewer_plugins_open_native` | 检查 revision、安装摘要、可见 native-view 命令，再调用 `native_view::open` | 只有点击命令后才建立同步链路 |
| `src-tauri/src/plugins/native_view.rs::open` | 结束相同插件旧会话，创建新会话、握手、调用方法并注册窗口订阅 | 每次查看状态或检查更新会重启插件，短暂打断同步 |
| `src-tauri/src/plugins/native_view.rs::publish` | 将宿主快照推送到已注册窗口会话 | 没注册的插件即使处于 enabled 也收不到快照 |
| `src/hiviewer/plugins/registry.ts::userCommands` | 过滤 hidden 命令和 `viewer/update` | 不能把内部刷新命令当作用户打开入口 |
| `src/hiviewer/plugins/PluginCenter.tsx` | 根据清单渲染命令按钮；启用只 configure，在线下载和安装共用确认对话框 | 新增清单命令能显示按钮，但插件无权自行接管宿主安装 |
| `src-tauri/src/plugins/sidecar.rs` | 不支持 sidecar 发起 `host/*` 安装回调 | 插件不能靠发送一个不存在的 RPC 请求安装自身 |
| `src-tauri/src/plugins/store.rs::verify_installed` | 对已安装包重算摘要与记录比较 | 插件直接覆盖自己的 EXE 会触发安装摘要失败 |
| `src-tauri/src/plugins/manifest.rs::Manifest` | v1 使用 deny_unknown_fields | 不能仅给插件清单添加未被宿主支持的 autoStart/updateUrl 字段 |

更新 404 是独立问题：LUXE 0.1.4 只有 Actions artifact，固定目录和版本 Release 均未发布。LUXE 0.1.5 的 main 构建成功后会自动发布；宿主代码改造不能代替真正发布目录和 `.hvp`。

## LUXE 0.1.5 可复用契约

| 命令 ID | method | 可见性 | 插件行为 |
| --- | --- | --- | --- |
| `start` | `viewer/start` | hidden | 接收快照并启动后台同步，初始窗口隐藏 |
| `sync` | `view/open` | 可见 | 应用快照并显示联动状态窗口 |
| `check-update` | `updater/open` | 可见 | 应用快照、显示窗口，WebView 就绪后自动检查更新 |
| `update` | `viewer/update` | hidden | 刷新快照并同步活动图片，不主动显示窗口 |

这些方法均走已经授权的 sidecar stdio JSONL。`plugin/initialize` 的协议版本仍为 1，插件 ID 为 `luxe.image-sync`；握手版本必须等于清单版本。`viewer/start` 已在插件实现，但当前宿主没有自动调用它。

调用入参示例，字段与宿主 `ViewerSnapshot` 保持一致：

```json
{
  "viewer": {
    "source": "hiviewer",
    "sequence": 12,
    "files": ["D:/reference/42.jpg"],
    "currentPath": "D:/reference/42.jpg",
    "testMachineColumnPath": "D:/device",
    "testMachineFiles": ["D:/device/42.jpg"],
    "testMachineCurrentPath": "D:/device/42.jpg"
  },
  "configuration": {}
}
```

宿主负责把参考机当前行映射为测试机对应图片。该行无图时 `testMachineCurrentPath` 为 null，不能回退首图。插件发送绝对路径，LUXE 在自己的已扫描工作区映射 index；不要求两端数字 index 相同。

## 阶段一：启用即同步与重启恢复

### 1. 按声明识别后台插件

在 native-view 层根据现有命令声明检测 `viewer/start`，不要按 `luxe.image-sync` 写专用分支。旧插件没有声明该方法时维持原行为。

以下为拟新增的宿主设计示例，不是当前已有 API：

```rust
fn background_method(record: &Record) -> Option<&str> {
    record.manifest.commands.iter().find_map(|command| {
        (command.handler == "native-view"
            && command.hidden
            && command.method.as_deref() == Some("viewer/start"))
            .then_some("viewer/start")
    })
}
```

启动前必须确认 enabled、grants 完整、平台兼容、当前 revision 和安装摘要。不能绕过 `user_invocable()` 去扩大用户可执行命令范围；后台方法应由宿主内部生命周期专用路径调用。

### 2. 为会话增加幂等协调入口

修改 `src-tauri/src/plugins/native_view.rs`，将“创建会话”和“向现有会话执行命令”拆开，增加以插件 ID 和 revision 为键的幂等协调。重复启用、列表刷新、设置窗口与主窗口并发调用只能创建一个活动进程。

预期状态：

```text
Disabled --授权启用--> Starting --握手与快照成功--> Running
Starting --失败--> Failed --用户重试或有界退避--> Starting
Running --状态/更新命令--> Running（同 token、同进程）
Running --禁用/卸载/更新/配置新 revision--> Stopping --> Disabled 或 Starting
```

实现要求：

- 不持有 STORE_LOCK 或全局窗口 Mutex 跨 sidecar RPC await；锁内只做记录检查/会话身份更新，耗时调用移到锁外。
- 用现有 opening guard 或等价 per-plugin guard 合并并发启动；所有成功、失败、取消路径释放 guard。
- 启动中记录收到的最新快照，初始化成功后补发，沿用现有 open 中的 latest.sequence 比较；不能丢失启动期间的切图。
- 最后提交会话前重新核对 revision 和授权；用户在启动中禁用/卸载时，旧启动结果必须撤销，不能重新加入订阅。
- 重复执行同一声明命令复用活动 token；只有 revision 改变、进程失效、授权撤销等情况才重启。
- 失败状态包含插件身份、阶段和可读错误；退避有上限、可取消，不能无限创建线程/进程或在每次 pointer move 都重试。

### 3. 接入启用与应用启动

`hiviewer_plugins_configure` 的授权保存成功后，通过协调入口启动声明了 `viewer/start` 的插件。建议授权状态与运行状态分开：启动失败返回/显示“已启用但启动失败”，提供重试；不能返回一切成功却不显示失败原因。

在 HiViewer 主进程插件服务初始化时恢复 enabled 且已授权的后台插件，不依赖 `PluginCenter` 或设置窗口挂载。主窗口快照生产者仍是 `PluginProvider`/viewer 发布链路；初始化期间没有图片也可以先启动，后续快照再更新。

恢复与启用共用协调入口。不能让主窗口、设置窗口和 Rust 启动钩子各自拉起独立进程。

### 4. 禁用、更新和卸载

继续复用 `sessions::stop_plugin`、`native_view::forget_session` 和 revision 失效机制。禁用或卸载后立即停止同步，后台任务、句柄和重试一起取消。安装新包后的权限行为保持现有“安装后停用、用户确认启用”，除非未来另有明确的权限保持设计与测试；不要在升级代码中自动授予新权限。

## 阶段二：状态检查不打断同步

将 `hiviewer_plugins_open_native` 的授权/命令检查保留，再由幂等协调入口取得已有会话，向同一进程发送 `view/open` 或 `updater/open`。不要继续调用会先结束旧会话的无条件 open 路径。

验收时记录：启用后 PID/token；打开状态后 PID/token；检查更新后 PID/token。三次身份必须一致，且期间连续切图应被 LUXE 接受。关闭状态窗口只隐藏；禁用才终止后台同步。

## 阶段三：宿主内检查更新、确认与安装

### 1. 复用已有下载和安装 IPC

无需为此开放任意 sidecar 的 `host/install`。在 `PluginCenter.tsx` 增加宿主管理的检查更新动作，按 ID、backend.target 与数值版本号查找较新包，然后继续使用现有流程：

```text
用户点击更新
  -> pluginIpc.catalog(代理目录地址)
  -> 按已安装插件 ID/平台挑选更高版本
  -> pluginIpc.download(artifact)
  -> setConfirmation({ kind: "install", path, manifest, digest, previous })
  -> 用户确认
  -> pluginIpc.install(path, digest, previous.revision)
  -> 刷新插件列表
  -> 用户确认启用
  -> 阶段一的后台启动
```

这里的 `digest` 使用 download/inspect 返回的包 fingerprint，不要拿目录中的 ZIP SHA-256 直接代替：宿主当前 install 校验的是展开文件映射生成的 fingerprint。ZIP SHA-256 和安装 fingerprint 各有职责，两者都应保留。

重复点击检查/下载/安装必须被 busy 或每插件任务锁拦截；失败后可重试。下载期间另一个窗口更改了插件 revision，安装必须报冲突并刷新，不能强制覆盖。

### 2. 插件目录与代理

LUXE 固定目录：

```text
https://gh-proxy.com/https://github.com/diamond-cz/luxe-tauri/releases/download/luxe-plugin-updates/plugins.json
```

当前目录结构：

```json
{
  "version": 1,
  "plugins": [{
    "id": "luxe.image-sync",
    "name": "LUXE 图片联动",
    "version": "0.1.5",
    "target": "windows-x86_64",
    "url": "https://gh-proxy.com/https://github.com/diamond-cz/luxe-tauri/releases/download/luxe-image-sync-v0.1.5/luxe-image-sync-0.1.5-windows-x86_64.hvp",
    "sha256": "此处必须使用发布目录内实际的64位十六进制摘要"
  }]
}
```

示例中的摘要说明不能直接用作生产目录。下载必须使用线上真实 SHA-256，不从版本号或文件名推测摘要。

建议先在宿主已有插件目录列表中纳入 LUXE 目录，或使用用户可配置的目录列表；不要在安装器里按插件 ID 写特殊路径。检查优先代理，单次目录请求 15 秒、总尝试次数有界；代理失败可回退同一 HTTPS GitHub 源地址。包下载沿用宿主 catalog.rs 的大小/HTTPS/摘要校验。双 404 显示“目录未发布”，网络错误不显示“已经最新”。

按 `[major, minor, patch]` 数值比较版本，`0.1.10 > 0.1.9`；平台必须等于当前平台，不给 Windows 提供 macOS 包，不提供降级/同版重装。多个目录给出同版本不同摘要时拒绝并报告冲突。

### 3. 避免两个同名更新入口

LUXE 0.1.5 的 `check-update` 已由清单显示为普通命令，会打开插件自己的更新窗口。未来宿主若提供通用安装更新按钮，应明确区分“宿主管理更新”和“插件自有命令”，或者制定公共契约替代，不能直接按 ID 偷换命令行为。

清单新增字段或公共能力时，同时更新：`plugins/schema/manifest.v1.json`、`plugins/sdk/`、`plugins/tools/`、Rust manifest 校验器、前端 types、示例与文档。当前 v1 不支持未知字段，只修改 JSON 会导致安装失败。

## 验收矩阵

| 场景 | 必须观察的结果 |
| --- | --- |
| 首次安装后未启用 | 不启动原生进程，不同步 |
| 授权启用且 LUXE 已启动 | 不点击任何命令即可切图同步，状态窗口不弹出 |
| LUXE 未启动时启用，稍后启动 | 后台有界重连，后续选图同步，无额外进程 |
| 主窗口与设置窗口同时刷新 | 只有一个进程和一个活动会话 |
| 启动期间切图 | 最后快照补发，旧快照不覆盖新选择 |
| 启动期间禁用或卸载 | 不提交过期会话，无残留进程和重试 |
| 查看状态/检查更新 | PID/token 保持不变，同步不中断 |
| 关闭状态窗口 | 只隐藏，继续同步 |
| 重启 HiViewer，未打开设置 | 已授权后台插件恢复，接收新快照 |
| 设置测试机并点击参考机另一行 | LUXE 显示该行测试机图片，缺图不回退 |
| 检查目录双 404/超时 | 显示明确错误，可重试，不伪报最新 |
| 更新包摘要不符/平台不符 | 拒绝安装，旧插件继续可用 |
| 用户取消安装 | 不更改安装记录、权限或活动代码 |
| 下载期间 revision 改变 | 安装冲突可见，刷新后重试 |
| 确认升级、重新启用 | 旧进程结束、数据保留、新 revision 仅启动一个进程 |

## 后续实施前的检查命令

在 HiViewer 工作区先读取其 AGENTS.md 和插件规则，再按该仓库当时的工具链执行。下面仅列出验证入口，不代表本轮已经运行：

```powershell
git status --short
npm run build
npm run test:i18n
npm run test:plugins
```

宿主 Rust 的编译/定向测试安排到允许的环境或 CI，禁止在本轮 LUXE 会话为此触发本地 Rust/Tauri 编译。补充 native-view 会话生命周期测试、安装冲突测试和失败恢复测试；真实 Windows 安装、启用、关闭窗口、应用重启及更新必须从构建产物验收，不能以单元测试代替。

## 本轮本地验证方法

在现有未改造的 HiViewer 上安装 LUXE 0.1.5 后，确认卡片显示两个可见命令。点击“检查 LUXE 图片联动状态”建立会话，关闭窗口继续切图；点击“检查插件更新”应显示窗口并自动检查。固定目录成功发布后，0.1.5 应提示没有更高版本，0.1.4 应能发现并下载 0.1.5；安装仍需宿主确认。

本轮不能把“启用即同步、状态命令复用进程、宿主内一键安装”列为已通过，它们正是本文留给后续 HiViewer 改造的内容。
