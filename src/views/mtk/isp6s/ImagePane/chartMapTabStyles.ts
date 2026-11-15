import type { CSSProperties } from "react";

export const tabStripWrapStyle: CSSProperties = {
  height: 32,
  borderBottom: "1px solid var(--colorNeutralStroke2)",
  scrollbarWidth: "none",
  msOverflowStyle: "none",
};

export function tabButtonStyle(active: boolean): CSSProperties {
  return {
    minWidth: 88,
    height: 30,
    padding: "0 14px",
    border: active ? "1px solid var(--colorBrandStroke1)" : "1px solid var(--colorNeutralStroke2)",
    borderBottomColor: active ? "var(--colorBrandStroke1)" : "var(--colorNeutralStroke2)",
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    background: active ? "var(--colorBrandBackground)" : "var(--colorNeutralBackground3)",
    color: active ? "var(--colorNeutralForegroundOnBrand)" : "var(--colorNeutralForeground2)",
    fontSize: 12,
    fontWeight: active ? 600 : 500,
    cursor: "pointer",
    transform: active ? "translateY(1px)" : "none",
    boxShadow: active ? "0 2px 6px color-mix(in srgb, var(--colorBrandBackground) 28%, transparent)" : "none",
  };
}
