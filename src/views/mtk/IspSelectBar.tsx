import { Select } from "@fluentui/react-components";

import { ISP_LIST, ISP_TABS, type IspId, type IspTab } from "./ispTabs";

interface Props {
  isp:        IspId;
  tabIdx:     number;
  onIspChange:(id: IspId) => void;
  onTabChange:(idx: number) => void;
}

/**
 * Replaces the old vertical ISP nav rail with a compact horizontal bar:
 * "ISP  [▼ ISP6S]    [AE Basic] [ToneMap]"
 */
export function IspSelectBar({ isp, tabIdx, onIspChange, onTabChange }: Props) {
  const tabs = ISP_TABS[isp];
  return (
    <div
      className="flex shrink-0 items-stretch gap-3 px-5 pt-2"
      style={{ borderBottom: "1px solid var(--colorNeutralStroke2)" }}
    >
      <div className="flex items-center">
        <Select
          value={isp}
          onChange={(_, d) => onIspChange(d.value as IspId)}
          style={{ minWidth: 140 }}
        >
          {ISP_LIST.map((it) => (
            <option key={it.id} value={it.id}>{it.label}</option>
          ))}
        </Select>
      </div>

      <div className="flex flex-1 items-stretch overflow-x-hidden">
        {tabs.map((t, i) => (
          <TabButton
            key={`${t.label}-${i}`}
            tab={t}
            active={i === tabIdx}
            onClick={() => onTabChange(i)}
          />
        ))}
      </div>
    </div>
  );
}

function TabButton({
  tab, active, onClick,
}: { tab: IspTab; active: boolean; onClick: () => void }) {
  const stub = tab.fileHint === null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex items-center gap-2 px-4 text-sm transition-colors"
      style={{
        color: active
          ? "var(--colorBrandForeground1)"
          : "var(--colorNeutralForeground2)",
        fontWeight: active ? 600 : 500,
      }}
    >
      <span>{tab.label}</span>
      {stub && (
        <span
          className="rounded px-1.5 py-0.5 text-[10px]"
          style={{
            background: "var(--colorNeutralBackground3)",
            color:      "var(--colorNeutralForeground3)",
          }}
        >
          待开发
        </span>
      )}
      {active && (
        <span
          aria-hidden
          className="absolute bottom-0 left-2 right-2 h-0.5 rounded"
          style={{ background: "var(--colorBrandForeground1)" }}
        />
      )}
    </button>
  );
}
