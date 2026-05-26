import { useState } from "react";
import type { ImageEntry } from "@/ipc/imageScan";
import type { Isp6sSchemaRoot } from "@/ipc/cppParser";
import { ImageMode } from "./ImageMode";
import { ImageSplitMode } from "./ImageSplitMode";
import { ParaCheckMode } from "./ParaCheckMode";
import { ParamMapMode } from "./ParamMapMode";
import {
  Image24Regular,
  ChartMultiple24Regular,
  PreviewLink24Regular,
  Code24Regular,
} from "@fluentui/react-icons";

export type PreviewMode = "image" | "image_split" | "para_check" | "param_map";

interface Props {
  mode:        PreviewMode;
  onMode:      (m: PreviewMode) => void;
  filePath:    string;
  schema:      Isp6sSchemaRoot;
  entry:       ImageEntry | undefined;
  tomlData:    Record<string, string>;
  activeCard?: string;
}

const TABS: { id: PreviewMode; label: string; Icon: React.ComponentType }[] = [
  { id: "image",       label: "图片",     Icon: Image24Regular },
  { id: "image_split", label: "三段式",   Icon: ChartMultiple24Regular },
  { id: "para_check",  label: "参数对比", Icon: PreviewLink24Regular },
  { id: "param_map",   label: "源码映射", Icon: Code24Regular },
];

export function ImagePane({
  mode, onMode, filePath, schema, entry, tomlData, activeCard,
}: Props) {
  const [internalCard] = useState<string | undefined>(undefined);
  void internalCard;

  return (
    <div className="flex h-full w-full flex-col"
         style={{
           background:  "var(--colorNeutralBackground2)",
           border:      "1px solid var(--colorNeutralStroke2)",
           borderRadius: 12,
           overflow:    "hidden",
         }}>
      {/* Mode tabs */}
      <div className="flex shrink-0 items-center gap-1 px-2 py-1.5"
           style={{ borderBottom: "1px solid var(--colorNeutralStroke2)" }}>
        {TABS.map(({ id, label, Icon }) => {
          const active = id === mode;
          return (
            <button
              key={id}
              type="button"
              onClick={() => onMode(id)}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors"
              style={{
                background: active ? "var(--colorBrandBackground)" : "transparent",
                color:      active
                  ? "var(--colorNeutralForegroundOnBrand)"
                  : "var(--colorNeutralForeground2)",
                fontWeight: active ? 600 : 500,
              }}
            >
              <Icon />
              {label}
            </button>
          );
        })}
      </div>

      {/* Mode content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {mode === "image"       && <ImageMode      entry={entry} />}
        {mode === "image_split" && <ImageSplitMode entry={entry} schema={schema} tomlData={tomlData} />}
        {mode === "para_check"  && <ParaCheckMode  filePath={filePath} schema={schema} tomlData={tomlData} />}
        {mode === "param_map"   && <ParamMapMode   filePath={filePath} schema={schema} activeCard={activeCard} />}
      </div>
    </div>
  );
}
