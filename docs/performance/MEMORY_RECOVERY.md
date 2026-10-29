# LUXE CPU、内存回收与性能维护

本文记录当前项目已有的回收链路和前端性能约束，供新增功能时直接沿用；本文件以仓库现有代码为准。

| 层级 | 现有入口 | 职责 |
| --- | --- | --- |
| 前端触发 | `src/hooks/useIdleMemoryTrim.ts` | 可见窗口空闲 8 秒调用轻量回收；窗口隐藏或离开 MTK 页面时要求清理缓存 |
| IPC 限流 | `src/ipc/memory.ts` | `trimMemory(clearCaches)` 合并并发请求；普通回收至少间隔 30 秒，清缓存至少间隔 5 秒 |
| Rust 回收 | `src-tauri/src/memory_trim.rs` | 后台线程按 `clearCaches` 决定是否清理图片和 C++ 解析缓存，再调用 `mi_collect(true)`；Windows 上临时将 WebView2 内存目标设为 LOW，1.5 秒后恢复 NORMAL |
| 图片缓存 | `src-tauri/src/image_scan/mod.rs` | 按既有预算限制缓存；清理时淘汰缓存并隔离旧任务结果 |

## 新功能接入规则

1. 大对象要有明确的所有者和生命周期。图片、Canvas 像素、Blob URL、解析结果等，在切换文件或卸载组件时释放；异步任务用取消标志或代次忽略过期结果。
2. Rust 缓存应设置容量预算，并在 `clear_memory_caches()` 或对应缓存的 `clear()` 中纳入清理。避免缓存锁跨磁盘读取、解码或耗时计算。
3. 前端清理触发统一使用 `trimMemory()`；需要释放跨页面缓存时调用 `trimMemory(true)`。不要直接调用 WebView2 API，也不要在高频事件中反复请求回收。
4. 所有 `ResizeObserver`、滚动和指针监听都要在卸载时解绑；更新 React 状态前比较测量值。持续的观察器、状态、布局反馈会同时推高 CPU 与 renderer 内存。
5. 区分“可回收缓存”和“仍被引用的对象”。`mi_collect` 或 WebView2 LOW 只能促使已无用内存归还；不能替代取消任务、关闭资源或清除引用。

## 图片列表和详情面板的性能约定

新增图片字段、预览模式或详情卡片时，沿用以下处理方法：

| 场景与风险 | 处理方法与现有入口 |
| --- | --- |
| 大图片列表全量挂载、解码或预加载 | `TablePane.tsx` 已实现固定行高、可视窗口切片和有限 overscan；新增列也应按窗口加载必要 TOML 字段，控制预取范围与并发，不把整目录解码结果常驻内存 |
| 固定详情表反复渲染 | `Isp6sAeVisual.tsx` 的 `DetailsPanel` 使用 `memo` 和稳定 props 隔离图片列表、解析进度及分隔条更新；Normal、Face、LCE、bcompare 只挂载当前标签内容 |
| 折叠后组件和监听器仍占资源 | 详情面板折叠时卸载子树，展开时恢复滚动位置；观察器、事件监听和定时器随卸载清理，异步 IPC 返回用取消标志忽略；滚动恢复观察器找到目标后断开，等待超时或卸载时也断开 |
| 子组件回传 binding 引发父子反馈循环 | 使用 `useCallback` 稳定父级 `onMode`，避免“父渲染 → 回调引用变化 → 子 binding effect → 父 setState → 父渲染”；effect 仍保留必要依赖，不能通过删除依赖掩盖问题；源码绑定只传给使用它的 bcompare 面板 |
| 每个单元格各自创建 tooltip 状态和节点 | Normal/Face 使用已有 `GlobalTitleTooltip` 的委托入口：`title`、`data-tooltip-position="below-start"`、`data-tooltip-wrap="true"`、`data-tooltip-max-width={520}`；需要局部 tooltip 时先评估实例数与清理成本 |
| 尺寸观察触发布局与状态循环 | `ResizeObserver` 仅在宽高变化时更新状态；异步 schema 加载后才出现的 viewport 要重新绑定观察器，参照 `FaceTable.tsx` 的 `[schema]` 依赖 |

虚拟化优先用于行数很多的同构列表。固定详情表包含合并单元格、折叠区块和编辑操作，优先隔离渲染与按需挂载；若实测仍有大量节点开销，再评估虚拟表，并验证合并单元格、键盘操作、滚动恢复和可访问性。

缓存预算以代码常量为准。当前 `TablePane.tsx` 的下拉缩略图上限为 160 项，局部字段缓存为 768 项，共享字段缓存为 4096 项；图片列表悬浮预览延迟请求源图生成 448px 图像，Rust 缓存最多保留 8 张，滚动、离开或卸载时前端清除引用并隔离过期结果；批量缩略图使用固定 2 线程 Rayon 池，避免按图片数量无限创建解码任务；`workspaceSession.ts` 最多保留 16 个工作区，每个工作区最多保留 8 个源码滚动位置。新增缓存应同时说明容量、淘汰条件和清理入口，避免只限制条目数却存入完整大对象。

本次 Isp6s 优化的直接教训是：虚拟列表不能修复渲染反馈循环；应先用 DevTools 的 React/Performance 记录确认空闲时是否仍在提交、布局或绘制，再决定是否增加虚拟化。

## 验证方法

- 在相同页面和相同数据集下，记录打开页面、切换页面、隐藏窗口、空闲 30 秒后的宿主与 WebView2 各子进程工作集和 CPU 增量；重复多轮，关注基线是否持续上升。
- 用父子进程关系及命令行确认 WebView2 归属，并区分 browser、renderer、GPU 进程。`Get-Process` 的 `CPU` 是累计 CPU 秒数；采样间隔内的 CPU 秒差除以实际间隔才反映负载，不能把累计值当占用率。比较时固定是否按逻辑处理器数归一化，并记录工作集及私有字节。
- 先用 WebView2 DevTools Performance 定位空闲时仍在运行的脚本、布局或绘制，再修改对应组件。任务管理器的 LUXE 汇总值不能区分 renderer 与 Rust 宿主。
- UI 回归覆盖加载源码后空闲、切换图片和详情标签、折叠再展开、切换文件、离开页面及隐藏再恢复窗口；确认空闲提交次数收敛、滚动可恢复、提示与编辑仍可用，过期请求不覆盖新文件。性能数值必须使用相同构建模式比较；类型检查或构建通过不代表已经测得 CPU、内存降幅。
- 前端改动运行 `npm run typecheck`，必要时运行 `npm run build`；Rust 回收或托盘退出链路改动运行 `npm run rust:test`。多开时验证托盘重启仅替换当前实例，其他实例继续运行；切换图片目录只清理当前进程的缩略图目录。
