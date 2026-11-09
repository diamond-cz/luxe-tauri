# 视图与媒体处理

[返回开发指南](README.md) · [Host API](api-v1.md) · [排错](development.md)

需要交互面板、Canvas 或视频控件时使用 View；一次性计算并返回表格使用 Worker。自动支持新文件格式则使用 [imageDecoders](image-decoders.md)。

## 1. 创建图片视图

```powershell
npm run plugin -- create plugins/local-image-tool image-viewer
```

修改 manifest 的 ID、名称、作者和版本。模板已有 `selection.read`、`media.read`、`files.export`，命令 handler 为 `view`，`ui.entry` 为 `ui/index.html`。

```text
plugins/local-image-tool/
  manifest.json
  ui/
    index.html
    view.js
```

View 无需 Worker `main.ts`。宿主为 HTML 注入 SDK 和指向**包根**的 base；因此 HTML 内脚本写 `ui/view.js`。`view.js` 内的 ESM 相对 import 则按 JS 模块自身地址解析。框架构建器必须输出包内静态文件，不依赖 CDN 或开发服务器。

## 2. 可运行的预览与导出

将 `ui/index.html` 替换为：

```html
<style>
  main { padding: 16px; color: var(--hiviewer-text); background: var(--hiviewer-background); }
  canvas { display: block; max-width: 100%; max-height: 65vh; border: 1px solid var(--hiviewer-border); }
  button { margin-top: 12px; color: var(--hiviewer-text); background: var(--hiviewer-background); border: 1px solid var(--hiviewer-accent); }
  button:focus-visible { outline: 2px solid var(--hiviewer-accent); }
</style>
<main>
  <p id="status" role="status">正在读取预览…</p>
  <canvas id="preview"></canvas>
  <button id="save" disabled>导出预览 PNG</button>
</main>
<script type="module" src="ui/view.js"></script>
```

将 `ui/view.js` 替换为：

```js
const api = window.hiviewer;
const canvas = document.querySelector('#preview');
const status = document.querySelector('#status');
const save = document.querySelector('#save');

try {
  await api.ready;
  const [file] = await api.selection.get();
  if (!file) throw new Error('请先选中图片。');
  const preview = await api.media.preview(file.path);
  try {
    const bytes = await api.media.readBytes(preview.resourceId);
    const bitmap = await createImageBitmap(new Blob([bytes], { type: preview.mime }));
    try {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('当前环境无法创建 Canvas。');
      context.drawImage(bitmap, 0, 0);
      // 自定义处理在这里执行；当前画布是预览尺寸。
    } finally {
      bitmap.close();
    }
    status.textContent = `${file.filename}：预览 ${preview.width}×${preview.height}，原图 ${preview.sourceWidth}×${preview.sourceHeight}`;
    save.disabled = false;
  } finally {
    await api.media.release(preview.resourceId);
  }
} catch (error) {
  status.textContent = String(error);
}

save.addEventListener('click', async () => {
  save.disabled = true;
  try {
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG 编码失败。');
    const saved = await api.exports.save('processed-preview.png', await blob.arrayBuffer());
    status.textContent = saved ?? '已取消导出。';
  } catch (error) {
    status.textContent = String(error);
  } finally {
    save.disabled = false;
  }
});
```

```powershell
npm run plugin -- check plugins/local-image-tool
npm run plugin -- dev plugins/local-image-tool
```

随后在桌面从目录安装、启用并验收保存对话框。导出的是预览尺寸，最长边不超过 2048，不应标注为“全分辨率无损处理”。`exports.save` 最多接收 32 MiB，文件名不能包含目录，取消返回 null，任何已存在目标都会被拒绝覆盖。

## 3. 图片分析与 EXIF

Worker 中没有 `document` / DOM Canvas；使用 `OffscreenCanvas`、`createImageBitmap`。参考 [`image-analysis/main.ts`](../../plugins/examples/image-analysis/main.ts)，获取预览 → 读取字节 → 计算 → `bitmap.close()` → `media.release()` → 返回报告。

预览为 sRGB 8 位显示数据，不是 RAW 传感器值或 HDR 浮点帧。计算亮度、噪声或锐度时，应说明缩放和色彩空间条件；图像尺寸用 `width/height`，原尺寸用 `sourceWidth/sourceHeight`。

EXIF 使用 `api.metadata.read(file.path)`，返回 `Record<string, string>`，字段不保证存在。参考 [`exif-provider/main.ts`](../../plugins/examples/exif-provider/main.ts)。大报告应限制行数，缺失字段显示明确占位。扩展结果以报告或视图呈现，不自动合并进内置 EXIF，也不提供原文件元数据写入 API。

## 4. 视频视图

```powershell
npm run plugin -- create plugins/local-video-tool video-viewer
npm run plugin -- check plugins/local-video-tool
npm run plugin -- dev plugins/local-video-tool
```

修改插件身份后使用模板中的 `api.media.video(path)`，将返回的 `url` 交给 `<video>`。不要通过 `media.readBytes` 把整段大视频读入内存。资源应保持到停止播放或视图关闭，不能在赋值 `src` 后立即 release。

替换视频时先 `pause()`、移除 src、`load()`，再释放旧资源；关闭视图时宿主会统一回收。自建 Blob URL 必须由插件 `URL.revokeObjectURL()`。用户主动播放以满足浏览器自动播放策略。

当前媒体 API 接受 MP4/M4V/WebM/MOV/OGV，实际编码能否播放取决于 WebView。容器名称不能保证 H.265 等编码可用。v1 不自动转码；模拟器视频上传另有 16 MiB 限制，不等于桌面流媒体文件上限。

## 5. 主题、语言与生命周期

| 环境 | 使用方式 |
| --- | --- |
| 初始化 | `await api.ready` 后调用 API |
| 主题 | CSS 使用 `--hiviewer-background`、`--hiviewer-text`、`--hiviewer-accent`、`--hiviewer-border`、`--hiviewer-font` |
| 语言 | `api.locale`；界面文字由插件按 locale 翻译 |
| 配置 | `api.configuration`；配置保存后旧会话撤销，重新打开读取 |
| 已授予权限 | View 的 `api.capabilities` 布尔映射 |
| 环境变化 | `api.events.on('environment.changed', callback)`，返回取消订阅函数 |
| 选择 | 打开时固定快照；不提供 `context.changed` 事件 |

命令标题可以使用 manifest `%key%` 翻译；这不会自动翻译报告、配置标题或 HTML 文本。Worker 的 `CommandApi` 有 `progress`，View 的 `ViewApi` 有 `ready/capabilities/events`，不要混用。

视图支持标签、停靠和独立窗口；停靠切换保持实例，移到独立窗口会创建新会话。跨会话保存业务状态使用 `storage`，不要保存会话 token、resourceId、媒体 URL、Blob URL 或 Canvas 像素。

## 6. 隔离约束

iframe 使用 `sandbox="allow-scripts"`。插件可操作自己的 DOM，通过消息桥调用公开 API；不能访问父窗口 DOM、Tauri invoke、宿主 localStorage、任意网络或嵌入子 iframe。不要使用 eval、动态 Function 或要求放宽 CSP 的构建方式。

本地附加资源放入 `ui/`；程序读取使用 `api.assets.read('ui/data.json')`。浏览器模拟器目前没有实现此 API，需在桌面验证。需要原生计算时按 [sidecar 指南](native-sidecars.md) 声明方法并调用，不能直接从页面启动程序。
