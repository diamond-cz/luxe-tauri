# 开发维护文档

专题文档按领域维护，项目介绍、开发与发布命令统一见[项目 README](../README.md)。

| 领域 | 文档 | 内容 |
| --- | --- | --- |
| 功能 | [Face 表格与热力图](features/FACE_TABLE_HEATMAP.md) | 表格数据、编辑、轴命中和热力图接入约定 |
| 性能 | [CPU 与内存维护](performance/MEMORY_RECOVERY.md) | 缓存预算、异步请求隔离、清理入口及验证方法 |
| 配置 | [本地工作状态](../src-tauri/resources/README.md) | 状态文件位置、迁移和开发验证；与配置文件就近维护 |
| 工程 | [实现亮点与痛点账本](engineering/IMPLEMENTATION_LESSONS.md) | 可复用方案、实际根因、闭坑条件和验证记录 |

新增专题文档放入对应领域目录，并更新本索引。文档中的 `src/`、`src-tauri/` 等代码路径均相对于项目根目录；Markdown 链接相对于当前文档。根目录保留项目入口、工具约定和构建工具要求的配置文件。
