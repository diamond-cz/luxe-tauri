import { type ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ReOrderDotsVertical24Regular } from "@fluentui/react-icons";

interface Props {
  id:         string;
  children:   ReactNode;
  className?: string;
  /** When true, attaches the drag listeners to the whole tile rather than
   *  only the handle icon. Useful for nested grids where space is tight. */
  fullCardHandle?: boolean;
  /** Header height in px. Used to vertically center the drag handle on the
   *  card's header. Defaults to 48 (CollapsibleCard h-12); pass 44 for
   *  AeParamCard h-11. */
  headerHeight?: number;
}

/**
 * Generic dnd-kit Sortable wrapper. Provides a tiny drag handle in the
 * top-left corner; the rest of the card is normal click area.
 *
 * Visual nice-to-haves:
 *   - `isDragging` adds opacity + brand outline + raised shadow
 *   - keyboard support comes free with `useSortable`
 */
export function SortableCard({
  id, children, className, fullCardHandle, headerHeight = 48,
}: Props) {
  const {
    attributes, listeners, setNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
    boxShadow: isDragging
      ? "0 8px 18px rgba(0,0,0,0.35), 0 0 0 1px var(--colorBrandStroke1)"
      : undefined,
    cursor: fullCardHandle ? "grab" : "default",
    position: "relative",
  };

  /* When fullCardHandle is on, the whole element is a drag handle. When off,
   * we expose listeners only on the small grip icon. */
  const wholeCardProps = fullCardHandle ? { ...attributes, ...listeners } : {};
  const handleProps    = fullCardHandle ? {} : { ...attributes, ...listeners };

  /* Vertically centre the 24px handle inside the card header. */
  const handleTop = Math.max(0, (headerHeight - 24) / 2);

  return (
    <div ref={setNodeRef} style={style} className={className} {...wholeCardProps}>
      {!fullCardHandle && (
        <button
          type="button"
          {...handleProps}
          title="拖拽换位"
          className="absolute left-1 z-10 flex h-6 w-6 cursor-grab items-center justify-center rounded transition-opacity opacity-30 hover:opacity-100"
          style={{
            top:        handleTop,
            color:      "var(--colorNeutralForeground3)",
            touchAction: "none",
          }}
          onClick={(e) => { e.stopPropagation(); }}
        >
          <ReOrderDotsVertical24Regular className="h-4 w-4" />
        </button>
      )}
      {children}
    </div>
  );
}
