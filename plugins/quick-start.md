# 快速入门：第一个 JS/TS 插件

[返回开发指南](README.md) · [Manifest 参考](manifest.md) · [调试与发布](development.md)

目标：选中文件，运行“文件概览”，得到文件名和大小报告。以下 manifest 与源码可完整复制，仅需 `selection.read` 权限。

## 1. 创建目录

在 Hiviewer 仓库根目录执行，使用 Node 24.4.0、npm 11.4.2：

```powershell
npm ci
npm run plugin -- create plugins/local-file-summary image-analysis
```

已有依赖可跳过 `npm ci`。`create` 拒绝覆盖现有目录，会复制本地 SDK 并修正类型导入。

```text
plugins/local-file-summary/
  manifest.json        # 身份、权限、命令与配置
  main.ts              # 开发源码
  main.js              # 构建生成，宿主实际执行
  sdk/                 # create 复制的公开 SDK
```

模板使用示例身份，请替换为自己的 `id`，避免被视为示例插件的更新。

## 2. 替换 manifest.json

```json
{
  "manifestVersion": 1,
  "apiVersion": 1,
  "id": "com.example.file-summary",
  "name": "文件概览",
  "version": "1.0.0",
  "author": "Your name",
  "description": "显示当前选中文件的名称和大小。",
  "entry": "main.js",
  "permissions": ["selection.read"],
  "commands": [
    { "id": "run", "title": "文件概览", "contexts": ["selection"], "requiresSelection": true, "handler": "worker" }
  ],
  "configuration": [
    { "key": "show-size", "title": "显示文件大小", "type": "boolean", "default": true }
  ],
  "contributions": [
    { "id": "summary", "kind": "image-analysis", "title": "文件概览", "command": "run" }
  ],
  "dataVersion": 1
}
```

命令 `id: "run"` 对应 `commands.run`；`contributions[].command` 引用这个命令。

## 3. 替换 main.ts

```ts
import type { Plugin, Report } from './sdk/index';

export default {
  commands: {
    async run(api) {
      const files = await api.selection.get();
      if (!files.length) return { title: '文件概览', text: '请先选中文件。' };
      // 模拟器不注入 manifest 默认配置，使用相同默认值回退。
      const showSize = api.configuration['show-size'] !== false;
      const rows: NonNullable<Report['rows']> = [];
      for (const [index, file] of files.entries()) {
        rows.push(showSize ? [file.filename, file.sizeBytes] : [file.filename]);
        api.progress((index + 1) / files.length, file.filename);
      }
      return {
        title: '文件概览',
        text: `共 ${files.length} 个文件`,
        columns: showSize ? ['文件名', '字节数'] : ['文件名'],
        rows,
      };
    },
  },
} satisfies Plugin;
```

类型导入在构建后消失，不依赖宿主内部组件。不要导入 Node `fs`、`@tauri-apps/api` 或 `src/hiviewer/` 私有实现。

## 4. 类型检查、构建与检查

```powershell
npx tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2022 --module ESNext --moduleResolution Bundler --lib ES2022,WebWorker plugins/local-file-summary/main.ts
npm run plugin -- build plugins/local-file-summary
npm run plugin -- check plugins/local-file-summary
```

预期：类型检查无错误，生成 `main.js`，CLI 输出 `OK com.example.file-summary@1.0.0` 和文件数量。`--ignoreConfig` 用于本项目 TypeScript 7 的独立文件检查，避免误用宿主 tsconfig；有插件专用 tsconfig 时改为 `tsc --noEmit -p <插件目录>`。`build` 只转译/打包，不运行 `tsc`；`check` 不执行业务逻辑。

纯 JS 插件可直接提供默认导出的单文件 ESM `main.js`，不需要 `main.ts` 和 TypeScript 构建。

## 5. 浏览器试运行

```powershell
npm run plugin -- dev plugins/local-file-summary
```

访问 `http://127.0.0.1:4179/__plugin`，选择测试文件和 `run` 命令，点击运行。预期出现带 `title`、`columns`、`rows` 的结果。`Stop` 取消执行。

模拟器使用模拟 Host API。修改 `main.ts` 后在另一终端重新 `build`，刷新页面；修改 manifest 后重启 `dev`。完整模拟能力差异见[调试指南](development.md)。

## 6. 桌面安装和验收

1. 设置 → 自定义插件 → 从目录安装，选择 `plugins/local-file-summary`。
2. 确认安装，再点击“启用”并授予读取选择的权限。
3. 主窗口选中一张或多张图片，通过插件命令面板执行“文件概览”。
4. 核对文件名、数量和字节数。
5. 插件配置中关闭“显示文件大小”，重新运行，确认报告只剩文件名列。

宿主安装的是版本副本。每次迭代重复“类型检查 → build → check → 重新安装 → 启用 → 运行”，不直接编辑安装目录。

## 7. 打包交付

```powershell
New-Item -ItemType Directory -Force plugins/artifacts | Out-Null
npm run plugin -- pack plugins/local-file-summary plugins/artifacts/file-summary-1.0.0.hvp
```

`pack` 不创建输出父目录、不覆盖已有文件，也不自动构建。发布 `1.0.1` 时同步修改 manifest 版本，重新构建/检查，再换用新的输出文件名。

交付前从 `.hvp` 安装并重复桌面验收。接收者无需 Node 和源码，直接安装并启用即可。另附说明文件，列出功能、权限用途、支持平台、输入限制和版本变化；根目录 README 不会被 `pack` 自动包含。

## 下一步

- 像素分析：[`image-analysis/main.ts`](../../plugins/examples/image-analysis/main.ts)。
- EXIF 报告：[`exif-provider/main.ts`](../../plugins/examples/exif-provider/main.ts)。
- 图片处理和视频界面：[视图指南](views.md)。
- 本机计算：[Rust sidecar](native-sidecars.md)。
- PSD 等新格式：[自动解码器](image-decoders.md)。
- 使用 AI 开发：[任务模板](ai-development.md)。
