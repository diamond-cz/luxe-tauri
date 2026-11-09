# 在线插件目录

宿主插件中心支持用户确认后读取 HTTPS JSON 目录并下载平台对应的 `.hvp` 包。目录格式固定为：

```json
{
  "version": 1,
  "plugins": [{
    "id": "hiviewer.unisoc-debugger",
    "name": "Unisoc 辅助调试",
    "version": "0.1.0",
    "target": "windows-x86_64",
    "url": "https://example.invalid/unisoc-debugger-0.1.0-windows-x86_64.hvp",
    "sha256": "<64 lowercase hexadecimal characters>"
  }]
}
```

`target` 必须匹配当前操作系统和架构。宿主对目录和包使用 HTTPS、大小限制、SHA-256、Manifest 身份/版本/平台一致性检查；下载完成后仍进入现有“检查 → 确认 → 安装但禁用 → 授权启用”流程。在线目录不会执行任意下载内容，也不会替代应用更新签名链路。

插件发布使用 `plugins/unisoc-debugger/build.mjs`，Windows x64 生成 IQT 解析能力包，macOS 生成读取、调试和 XML 回写能力包；macOS 包不包含 Windows IQT 解析器。
