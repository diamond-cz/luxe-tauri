import { useEffect, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import type { ImageEntry } from "@/ipc/imageScan";
import type { Isp6sSchemaRoot } from "@/ipc/cppParser";
import { HoverTooltip } from "@/components/common/HoverTooltip";
import { ParaCheckMode } from "./ParaCheckMode";
import { ParamMapMode } from "./ParamMapMode";
import {
  PreviewLink24Regular,
  Code24Regular,
  CodeBlock24Regular,
} from "@fluentui/react-icons";

export type PreviewMode = "para_check" | "param_map";

interface Props {
  mode:        PreviewMode | "image" | "image_split";
  onMode:      (m: PreviewMode) => void;
  filePath:    string;
  schema:      Isp6sSchemaRoot;
  entry:       ImageEntry | undefined;
  tomlData:    Record<string, string>;
  activeCard?: string;
}

const TABS: { id: PreviewMode; label: string; Icon: React.ComponentType }[] = [
  { id: "param_map",   label: "源码映射", Icon: Code24Regular },
  { id: "para_check",  label: "参数对比", Icon: PreviewLink24Regular },
];

export function ImagePane({
  mode, onMode, filePath, schema, entry, tomlData, activeCard,
}: Props) {
  const [internalCard] = useState<string | undefined>(undefined);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [showModeLabels, setShowModeLabels] = useState(true);
  const effectiveMode: PreviewMode =
    mode === "image" || mode === "image_split" ? "param_map" : mode;
  void internalCard;
  void entry;

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;

    const update = () => {
      setShowModeLabels(header.getBoundingClientRect().width >= 500);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex h-full w-full flex-col"
         style={{
           background: "var(--colorNeutralBackground2)",
           border: "1px solid var(--colorNeutralStroke2)",
           borderRadius: 12,
           overflow: "hidden",
         }}>
      <div ref={headerRef}
           className="flex h-11 shrink-0 items-center justify-between gap-3 px-4"
           style={{ borderBottom: "1px solid var(--colorNeutralStroke2)" }}>
        <div className="flex shrink-0 items-center gap-2 text-xs"
             style={{ color: "var(--colorNeutralForeground2)" }}>
          <CodeBlock24Regular className="h-4 w-4"
                              style={{ color: "var(--colorBrandForeground1)" }} />
          <span>源代码卡片</span>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden">
          {TABS.map(({ id, label, Icon }) => {
            const active = id === effectiveMode;
            return (
              <HoverTooltip key={id} content={label} positioning="below-center" inline>
                <Button
                  size="small"
                  appearance={active ? "primary" : "subtle"}
                  icon={<Icon />}
                  onClick={() => onMode(id)}
                  className="h-8"
                  style={{
                    minWidth: showModeLabels ? undefined : 32,
                    paddingLeft: showModeLabels ? undefined : 8,
                    paddingRight: showModeLabels ? undefined : 8,
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  {showModeLabels ? label : null}
                </Button>
              </HoverTooltip>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {effectiveMode === "para_check"  && <ParaCheckMode  filePath={filePath} schema={schema} tomlData={tomlData} />}
        {effectiveMode === "param_map"   && <ParamMapMode   filePath={filePath} schema={schema} activeCard={activeCard} />}
      </div>
    </div>
  );
}
