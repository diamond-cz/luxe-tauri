# 参数源码编码兼容

## 根因与入口

AE.cpp 的“stream did not contain valid UTF-8”由 Rust `std::fs::read_to_string` 拒绝非 UTF-8 字节引起，发生于语法解析之前。此次现场文件共 143444 字节，UTF-8 在偏移 54239 处失败；Python GBK 和 Windows CP936 严格解码均成功，重新编码后的字节与原文件一致。只读检查未修改现场参数文件。

以下三个入口统一调用 `src-tauri/src/source_text.rs::read_source`：

| 入口 | 用途 |
| --- | --- |
| `commands/text_cmds.rs::read_text_file` | 源码编辑器和草稿初始文本 |
| `cpp_parser/parser.rs::parse_file` | tree-sitter 解析、参数字段和源码坐标 |
| `cpp_parser/card_source.rs::resolve` | 卡片关键词搜索与源码行定位 |

后端统一输出 Unicode 字符串，tree-sitter 在解码后的 UTF-8 上计算字节列，与 IPC 文本一致；不能用原 GBK 字节列去索引编辑器文本。所有 BOM 在解码入口移除，不占编辑器和解析器第一行的列位置。

## 支持范围

1. 显式 UTF-8 BOM：严格验证后解码；带 BOM 的坏 UTF-8 直接报错。
2. UTF-16 LE/BE BOM：严格验证长度和代理对后解码；保存时保留 BOM 与字节序。
3. 无 BOM：优先严格 UTF-8，失败后在 Windows 使用 CP936/GBK；必须能无损还原原始字节，不使用替换字符。
4. 非法输入、NUL、UTF-32 或无法识别的编码报错，不静默丢字；无 BOM UTF-16、GB18030 四字节扩展及其他本地代码页不在自动猜测范围。

GBK 通过已锁定的 `windows 0.61.3` 的 `Win32_Globalization` API 实现，不增加 crate 或依赖版本。解码用 `MB_ERR_INVALID_CHARS`，编码禁用 best-fit，并将编码结果严格解码与输入逐字比较，以拒绝问号替换及不可表示的字符。Win32 长度转换前检查 i32 范围。

## 编辑与保存

- `write_text_file` 调用 `write_source`，读取现有目标的编码，再完成全部严格编码，最后写入；GBK 文件不会因普通参数编辑而自动转为 UTF-8。
- 例如在 GBK 文件中插入无法表示的 emoji，保存失败且不触碰原始文件。非法编码的现有文件同样不能通过普通保存静默覆盖。
- 目标不存在时的新建另存为使用 UTF-8；已存在目标保留目标编码。临时解析草稿始终使用 UTF-8，与解码后的原始源码具有相同文本和字段坐标。
- 换行仍由已有 `normalizeSourceText / serializeSourceText` 保存路径处理；解码层不自行改换行。此改动不新增并发编辑检查或文件系统原子写入保证，保持已有保存接口边界。
- IPC 命令、参数和返回类型不变；不新增权限、全局编码缓存、后台任务或数据请求。

## 验证

`src-tauri/tests/source_text_encoding.rs` 使用独立构造的小型夹具覆盖：UTF-8/UTF-8 BOM/UTF-16 LE/BE 的无修改字节往返；GBK 加载、解析、中文关键词定位及 UTF-8 临时草稿坐标一致；编辑数值后中文与编码保留；无法表示的新字符拒绝且原文件字节不变；非法输入拒绝和新另存为 UTF-8。

Rust 行为测试交由 `.github/workflows/ci.yml` 的 Windows x64 `cargo test --locked` 自动发现并执行。本地仅运行 rustfmt 静态检查、前端类型检查及现场文件只读编码诊断，不执行 Rust/Tauri 编译。安装现有旧版本不会获得此 Rust 修复，需使用包含此改动的 CI 安装包验收：导入同一 AE.cpp、检查中文注释、参数映射/跳转、编辑保存及重新打开。
