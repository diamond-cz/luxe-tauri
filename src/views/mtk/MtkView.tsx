import { useEffect } from "react";
import { useMtkStore } from "@/stores/mtkStore";
import { saveStateSection } from "@/ipc/stateIo";
import { IspSideNav } from "./IspSideNav";
import { IspTabBar } from "./IspTabBar";
import { CppImportPanel } from "./CppImportPanel";
import { ISP_LIST, ISP_TABS, type IspId } from "./ispTabs";

/**
 * MTK workspace — top-level page for the MTK platform tab.
 *
 * Layout (matches hiz `ISPWorkspaceWidget` + `ISPContentPanel`):
 *   [vertical ISP nav] | [horizontal ISP tab bar]
 *                      | [import panel content]
 *
 * mtk slice is hydrated by `useShellBootstrap` so by the time this view
 * mounts it already has the persisted current_isp / current_tab values.
 * Each mtk change is debounced and pushed back to `state.toml [mtk]`.
 */
export function MtkView() {
  /* Selectors: ONE primitive/object per call. Returning an object literal
   * here (`{ mtk, setCurrentIsp, setCurrentTab }`) collides with Zustand's
   * useSyncExternalStore snapshot equality (`Object.is`) and triggers an
   * infinite render loop — see "Maximum update depth exceeded" symptom. */
  const mtk            = useMtkStore((s) => s.mtk);
  const setCurrentIsp  = useMtkStore((s) => s.setCurrentIsp);
  const setCurrentTab  = useMtkStore((s) => s.setCurrentTab);

  /* Debounced persistence — `mtk` ref only changes when something inside
   * actually changed (immer guarantees a new top-level object). */
  useEffect(() => {
    const t = setTimeout(() => {
      saveStateSection("mtk", mtk).catch((err) => console.warn("save mtk", err));
    }, 200);
    return () => clearTimeout(t);
  }, [mtk]);

  const ispId: IspId = ISP_LIST[Math.max(0, Math.min(mtk.current_isp, ISP_LIST.length - 1))].id;
  const tabs   = ISP_TABS[ispId];
  const tabIdx = Math.max(0, Math.min(mtk.current_tab, tabs.length - 1));
  const tab    = tabs[tabIdx];

  return (
    <div className="flex h-full w-full">
      <IspSideNav
        current={ispId}
        onChange={(id) => setCurrentIsp(ISP_LIST.findIndex((i) => i.id === id))}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <IspTabBar
          tabs={tabs}
          current={tabIdx}
          onChange={setCurrentTab}
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          <CppImportPanel isp={ispId} tabIdx={tabIdx} tab={tab} />
        </div>
      </div>
    </div>
  );
}
