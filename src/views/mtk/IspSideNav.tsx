import { ISP_LIST, type IspId } from "./ispTabs";

interface Props {
  current:  IspId;
  onChange: (id: IspId) => void;
}

/**
 * Vertical ISP nav — left column inside MtkView.
 *
 * Default selection is ISP6S to match hiz's ISPWorkspaceWidget which sets
 * `nav.setCurrentIndex(1)` on construction.
 */
export function IspSideNav({ current, onChange }: Props) {
  return (
    <div
      className="flex w-24 shrink-0 flex-col"
      style={{
        background:  "var(--colorNeutralBackground2)",
        borderRight: "1px solid var(--colorNeutralStroke2)",
      }}
    >
      <div className="flex h-10 items-center justify-center text-xs"
           style={{ color: "var(--colorNeutralForeground3)" }}>
        ISP
      </div>
      <div className="flex flex-col py-2">
        {ISP_LIST.map(({ id, label }) => {
          const active = id === current;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              className="mx-2 my-0.5 rounded-md px-3 py-2 text-left text-sm transition-colors"
              style={{
                background: active ? "var(--colorBrandBackground)" : "transparent",
                color:      active
                  ? "var(--colorNeutralForegroundOnBrand)"
                  : "var(--colorNeutralForeground2)",
                fontWeight: active ? 600 : 400,
              }}
              onMouseEnter={(e) => {
                if (!active) (e.currentTarget as HTMLButtonElement).style.background =
                  "var(--colorNeutralBackground3)";
              }}
              onMouseLeave={(e) => {
                if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
