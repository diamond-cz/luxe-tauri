# ToneTool LCE 曲线分析与实现依据

## 结论

参考图的 Final LCE Curve 是 **8 对实际 P/O 数值的二维折线**：横轴为 P，纵轴为 O；下方 Gain 为 `O − P`。当前 LCE 详情小图把 P、O 分别作为两条随节点序号变化的曲线，因此同一组数据可以呈现不同形状。新 ToneMap 曲线使用参考工具的 P→O 坐标定义，详情小图维持原行为。

人脸上下界是线性亮度值，在绘图前转换为：

```text
bound = 0 → x = 0
bound > 0 → x = floor(log10(bound) × 1024 + 0.5)
```

P/O 节点本身已经是曲线域坐标，不再取对数。参考工具的坐标范围为 `0..3700`，基准线为 `(0, 0) → (3699, 3699)`。截图节点 `P=2510 / O=2667` 的 Gain 为 `157`；边界 `523 / 1910` 转换为 `2784 / 3360`，与图上两条竖线相符。

## 来源与证据类型

用户指定目标：

```text
D:\Tuning\Santiago\04_tool\ImagiqSimulator_MT6885_20230425_tonetool\Scripts_pythonnet\Source\ToneTool
```

使用 reverse-engineer-anything 技能进行分析。本次仅静态分析，不启动 ToneTool、不调用其算法库，不将目标文件作为模块执行。

REA 6.9.0 CLI 在 Node 22.23.5 下分析 `Common/ToneToolLib.pyc`，确认它实际上是一个 ZIP 包，共 31 个文件成员。完整原始证据保存在本地 `docs/engineering/evidence/TONE_TOOL_CURVE_REA.json`，作为分析产物通过 `.gitignore` 排除；仓库保留以下身份摘要和与实现有关的观察：

- 操作：`inspect_artifact`。
- 父 Evidence：`ev_1b468058f520b407cbd424d6f2be273ada6deccb007772a1e28c3b5f90c1c740`。
- summary Evidence：`ev_b359b25f8b700930281d27ed3f2b20428130893249b415493c871622080cb866`。
- 档案 SHA-256：`813eba2a22a169fb1a8f2914ab923cdf631afe8f8ccaf011a59784a5fde7df80`。
- 覆盖：ZIP 成员清单完整；该 REA 证据本身不建立函数语义或运行时行为。

`inspect_python_pyc` 对同目录 PETRUS 主模块返回 `unsupported_target`：magic 3350 为 CPython 3.5，不在当前 REA 固定支持的 3.7–3.13 范围。后续函数语义来自普通 Python 工具的只读 marshal/字节码检查，**不是 REA 已完成反编译的结果**。

本地 `docs/engineering/evidence/inspect_tonetool_pyc.py` 是此次固定目标使用的静态检查辅助脚本，未加载任何第三方依赖，也不执行目标代码；聚焦反汇编记录为同目录 `TONE_TOOL_CURVE_DISASSEMBLY.txt`。两者属于本地分析材料，不随代码提交；可复查的函数、行号、数据映射和成员身份汇总如下：

| 成员 | SHA-256 | 作用 |
| --- | --- | --- |
| `view/LceWidget.pyc` | `f8034b026d59a5699f5b45cd33c714c5e2ba7eee1704571958edf0f6617347e0` | 图、曲线 ViewModel、P/O/Gain 表格 |
| `model/LceModel.pyc` | `eb2de05746f66e3380b4005b286d23fcd8cd080796e83fcad3d9930679ab9a4e` | 硬件字段到 LCE/GCE 节点的改名映射 |
| `model/ExifParser.pyc` | `e9a7f0a7c7ff2b8570383fb95a03795b6ec0d177e4e7162df342d75ea406ac4c` | 软件 tag 回退赋值及 GCEO 打包值处理 |

## 字节码观察

| 函数 / code-object 起始行 | 直接观察 | 推导 |
| --- | --- | --- |
| `LceChartWidget.InitUI` / 58 | 标题 Final LCE Curve；x/y 范围 0、3700；轴名 P、O | 图不是以分位后缀为 x 的两条序列 |
| `LceChartViewModel.__init__` / 244 | pname 为 `LCE_P0..7`，oname 为 `GCE_O0..7` | 最终显示使用 LCE 输入和 GCE 输出 |
| `LceChartViewModel.Parse` / 274 | 从 EXIF 字典读取 pcurve/ocurve；`curve['FromExif']=(pcurve,ocurve)`；另读模拟 `LceDbgInfo` 形成 NewResult | EXIF 与模拟结果是两种独立数据，不能复制 EXIF 当 NewResult |
| `LceChartWidget.UpdateView` / 103 | `ax.plot(curve[0], curve[1])`；蓝色 FromExif，红色 NewResult；额外画灰色虚线 `[0,3699]` 对角线 | 逐索引成对连接 P/O |
| `Linear2LogDomain` / 97 | 非零输入调用 `int(log10(x)*1024+0.5)`；零返回 0 | EXIF 人脸边界须从线性值转换 |
| `LceCurveTableWidget.UpdateView` / 444 | 三行分别写入 p、o、`o-p` | Gain 是偏移量，不是比值或百分数 |
| `LceModel.RenameTag` / 11 | `LCE_D1A_TC_P* → LCE_P0..7`；`LCE_D1A_HLR_TC_O* → GCE_O0..7` | LCE O 与最终 GCE O 有区别 |
| `ExifParser.ParseExif` / 355，字节码 2560–3111 | 当硬件 LCE 字段无效且软件 tag 可用时，将 `SW_LCE_P*` 与 `SW_LCE_O*` 写入 TC；`SW_LCE_GCEP*` 和 `SW_LCE_GCEO*` 取 `%10000` 后写入 HLR | 软件 GCEO 在此路径需去掉高位打包信息 |

模块同样存在 `LceManualCurveViewModel` 等编辑功能，本次只定位显示所需路径，没有复刻完整模拟、手动曲线编辑或原图处理。

## 项目落地与边界

- `toneLceCurveModel.ts` 读取后缀 `0/1/50/250/500/750/950/999` 的 8 个 `SW_LCE_P*`；有任意有效 `SW_LCE_GCEO*` 时整条输出选择 GCEO 家族并 `%10000`，保留缺失节点，不按节点掺入普通 O。完全没有有效 GCEO 时回退来源 `SW_LCE_O*`，节点与单元格提示保留实际关键字。
- 项目当前使用准备好的软件 EXIF TOML，不直接复刻参考工具的 ISP 硬件寄存器解析；GCEO 与普通 O 回退是有明确字段提示的兼容策略。按后续界面要求，标题只显示 LCE Curve，来源信息不再占用标题栏。
- 只读显示 EXIF 曲线；没有运行模拟器，因此不展示虚构的红色 NewResult 或模拟边界。曲线上的 EXIF 节点支持悬浮和键盘聚焦提示，表格保留所有 8 个点及字段来源。
- 缺失/越界点不当零，缺口和逆序/重复 P 不跨段连接。有效 0 值仍绘图。人脸边界不可用或变换后超出坐标范围时不绘制。
- 不新增请求、缓存、图表依赖或观察器；SVG 用固定 viewBox 随容器缩放，表格窄窗口横向滚动。当前曲线不响应参数编辑生成模拟结果；Ratio 参数表的编辑/保存/热力图链路继续保留。

## 验证与未知

Node 22 测试直接执行实际 TS 模型和 JSX，覆盖截图 P/O/Gain、log 上下界、GCEO packed 值和整族选择、缺失/逆序/越界点、有效 0、曲线/表格结构、五语言一致性。前端类型检查通过。

静态观察能建立上述数据到绘图的代码路径；没有实际运行目标应用或检查相机固件、模拟 DLL 内的曲线生成过程。没有在 Windows Tauri 窗口进行最终 UI/DPI/手动对照验收，不将静态或 Node 测试表述为桌面行为已验收。
