import { ViewPlaceholder } from "@/components/common/ViewPlaceholder";
import { useWindowStore } from "@/stores/windowStore";

export function HomeView() {
  const main_window = useWindowStore((s) => s.main_window);
  return (
    <ViewPlaceholder title="LUXE" subtitle="MTK / Qualcomm / Unisoc 多平台 AE 算法可视化（Rust + Tauri 重构版 MVP）">
      <pre className="rounded bg-neutral-900/60 p-3 text-xs">
{JSON.stringify(main_window, null, 2)}
      </pre>
      <p className="mt-4 text-xs text-neutral-500">
        M1：脚手架 + 自适应几何 ✓ &nbsp; — 后续里程碑会接入完整的设置 / 托盘 / 国际化 / ISP6S 可视化。
      </p>
    </ViewPlaceholder>
  );
}
