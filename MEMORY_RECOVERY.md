# LUXE 内存回收与性能维护

本文记录当前项目已有的回收链路，供新增功能时直接沿用。参考资料 `WebView2与主程序内存回收实现指南.md` 是通用指南；本文件以仓库现有代码为准。

| 层级 | 现有入口 | 职责 |
| --- | --- | --- |
| 前端触发 | `src/hooks/useIdleMemoryTrim.ts` | 可见窗口空闲 8 秒调用轻量回收；窗口隐藏或离开 MTK 页面时要求清理缓存 |
| IPC 限流 | `src/ipc/memory.ts` | `trimMemory(clearCaches)` 合并并发请求；普通回收至少间隔 30 秒，清缓存至少间隔 5 秒 |
| Rust 回收 | `src-tauri/src/memory_trim.rs` | 后台线程清理图片和 C++ 解析缓存，并调用 `mi_collect(true)`；Windows 上临时将 WebView2 内存目标设为 LOW，1.5 秒后恢复 NORMAL |
| 图片缓存 | `src-tauri/src/image_scan/mod.rs` | 按既有预算限制缓存；清理时淘汰缓存并隔离旧任务结果 |

## 新功能接入规则

1. 大对象要有明确的所有者和生命周期。图片、Canvas 像素、Blob URL、解析结果等，在切换文件或卸载组件时释放；异步任务用取消标志或代次忽略过期结果。
2. Rust 缓存应设置容量预算，并在 `clear_memory_caches()` 或对应缓存的 `clear()` 中纳入清理。避免缓存锁跨磁盘读取、解码或耗时计算。
3. 前端清理触发统一使用 `trimMemory()`；需要释放跨页面缓存时调用 `trimMemory(true)`。不要直接调用 WebView2 API，也不要在高频事件中反复请求回收。
4. 所有 `ResizeObserver`、滚动和指针监听都要在卸载时解绑；更新 React 状态前比较测量值。持续的观察器、状态、布局反馈会同时推高 CPU 与 renderer 内存。
5. 区分“可回收缓存”和“仍被引用的对象”。`mi_collect` 或 WebView2 LOW 只能促使已无用内存归还；不能替代取消任务、关闭资源或清除引用。

## 验证方法

- 在相同页面和相同数据集下，记录打开页面、切换页面、隐藏窗口、空闲 30 秒后的宿主与 WebView2 各子进程工作集和 CPU 增量；重复多轮，关注基线是否持续上升。
- 先用 WebView2 DevTools Performance 定位空闲时仍在运行的脚本、布局或绘制，再修改对应组件。任务管理器的 LUXE 汇总值不能区分 renderer 与 Rust 宿主。
- 前端改动运行 `npm run typecheck`；Rust 回收或托盘退出链路改动运行 `npm run rust:test`。验证托盘重启后状态仍已落盘、只有一个应用实例。
