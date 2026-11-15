import { useCallback } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";
import { ResizeHandle } from "@/components/common/ResizeHandle";
import { useIsp6sVisualStore } from "@/stores/isp6sVisualStore";
import { ToneLceCurve } from "./ToneLceCurve";
import { ToneLceTargetWeight } from "./ToneLceTargetWeight";
import { calculateLceTarget } from "./toneLceTarget";

/** Store the layout with the other visual preferences, including across app restarts. */
export function ToneLceCharts({ tomlData }: { tomlData: Record<string, string> }) {
  const saved = useIsp6sVisualStore((state) => state.visual.tone_lce_curve_ratio);
  const patch = useIsp6sVisualStore((state) => state.patch);
  const curveSize = typeof saved === "number" && Number.isFinite(saved) ? Math.min(75, Math.max(25, saved)) : 50;
  const onLayout = useCallback((sizes: number[]) => {
    if (sizes.length !== 2 || sizes.some((size) => !Number.isFinite(size) || size < 25 || size > 75)
      || Math.abs(sizes[0] + sizes[1] - 100) > 0.1) return;
    if (Math.abs(sizes[0] - curveSize) > 0.05) patch({ tone_lce_curve_ratio: sizes[0] });
  }, [curveSize, patch]);

  return <div className="tone-lce-chart-pair">
    <PanelGroup direction="horizontal" onLayout={onLayout}
      style={{ height: "calc(42px + var(--tone-lce-formula-height) + var(--tone-lce-plot-height))" }}>
      <Panel id="tone-lce-curve" order={1} defaultSize={curveSize} minSize={25} className="min-w-0">
        <ToneLceCurve tomlData={tomlData} />
      </Panel>
      <ResizeHandle id="tone-lce-charts-divider" />
      <Panel id="tone-lce-weight" order={2} defaultSize={100 - curveSize} minSize={25} className="min-w-0">
        <ToneLceTargetWeight calculation={calculateLceTarget(tomlData, NaN)} />
      </Panel>
    </PanelGroup>
  </div>;
}
