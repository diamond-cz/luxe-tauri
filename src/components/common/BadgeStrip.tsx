import { HoverTooltip } from "@/components/common/HoverTooltip";

interface BadgePair {
  label: string;
  value: string;
  /** Optional tooltip to show the underlying AE_TAG_* key on hover. */
  hint?: string;
}

interface Props {
  items: BadgePair[];
  /** Pixel font-size overrides for the value text. */
  valueSize?: number;
}

/**
 * Compact key:value badge strip used in CollapsibleCard / AeParamCard headers.
 * Each item is split into label + value spans, joined by `|`.
 *
 * Example: [{label:"CWR", value:"2307"}, {label:"LCE_Gain", value:"1.57"}]
 *   → "CWR:2307 | LCE_Gain:1.57"
 */
export function BadgeStrip({ items, valueSize = 12 }: Props) {
  return (
    <span className="flex items-center gap-1 text-xs"
          style={{ color: "var(--colorNeutralForeground2)" }}>
      {items.map((it, i) => (
        <BadgeItem key={`${it.label}-${i}`} item={it} index={i} valueSize={valueSize} />
      ))}
    </span>
  );
}

function BadgeItem({
  item, index, valueSize,
}: { item: BadgePair; index: number; valueSize: number }) {
  const body = (
    <span className="flex items-center">
      {index > 0 && (
        <span className="mx-1 opacity-40">|</span>
      )}
      <span style={{ color: "var(--colorNeutralForeground3)" }}>
        {item.label}:
      </span>
      <span
        className="ml-0.5 font-mono font-semibold"
        style={{
          fontSize: valueSize,
          color: "var(--colorBrandForeground1)",
        }}
      >
        {item.value}
      </span>
    </span>
  );

  if (!item.hint) return body;

  return (
    <HoverTooltip
      content={item.hint}
      positioning="below-center"
      wrap
      maxWidth={260}
      inline
    >
      {body}
    </HoverTooltip>
  );
}
