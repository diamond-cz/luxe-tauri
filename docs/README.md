# 开发维护文档

专题文档按领域维护，项目介绍、开发与发布命令统一见[项目 README](../README.md)。

| 领域 | 文档 | 内容 |
| --- | --- | --- |
| 功能 | [Face 表格与热力图](features/FACE_TABLE_HEATMAP.md) | 表格数据、编辑、轴命中和热力图接入约定 |
| 功能 | [ToneMap LCE Target](features/TONE_LCE_TARGET.md) | 顶部双图横向适配、TOML分割比例、公式栏与Target/LVTarget/Prob层级、计算链与验证 |
| 工程 | [ToneTool LCE 曲线分析](engineering/TONE_TOOL_CURVE_ANALYSIS.md) | REA 归档证据、Python 3.5 静态字节码、P/O/Gain、对数上下界和项目实现边界 |
| 功能 | [参数源码编码兼容](features/SOURCE_ENCODING.md) | AE/Tone/CA-LTM 的 GBK/Unicode 加载、统一坐标、保留编码保存及回归验证 |
| 功能 | [MTK JPEG 私有 EXIF](features/MTK_NATIVE_EXIF.md) | TOML优先复用、JPEG补缺合并/DP权威覆盖、单一来源、SIMD/有界并发与验证 |
| 性能 | [CPU 与内存维护](performance/MEMORY_RECOVERY.md) | 缓存预算、异步请求隔离、清理入口及验证方法 |
| 配置 | [本地工作状态](config/LOCAL_STATE.md) | 状态文件位置、迁移和开发验证 |
| 工程 | [实现亮点与痛点账本](engineering/IMPLEMENTATION_LESSONS.md) | 可复用方案、实际根因、闭坑条件和验证记录 |
| 工程 | [证据目录用途与清理](engineering/EVIDENCE_MAINTENANCE.md) | 截图/分析脚本的作用、清理范围、运行影响与历史材料恢复边界 |
| 插件 | [LUXE 图片联动插件安装与验收](../plugins/luxe-image-sync/README.md) | 0.1.5 卡片更新/状态命令、代理目录查询、main 自动发布、测试机同步及宿主生命周期待接线范围 |
| 插件 | [HiViewer 后续插件改造指南](engineering/HIVIEWER_PLUGIN_INTEGRATION_GUIDE.md) | 宿主启用即同步、会话复用、代理更新与安装确认的代码证据、接线方案和验收矩阵；本轮不修改宿主 |

新增专题文档放入对应领域目录，并更新本索引。文档中的 `src/`、`src-tauri/` 等代码路径均相对于项目根目录；Markdown 链接相对于当前文档。根目录保留项目入口、工具约定和构建工具要求的配置文件。
