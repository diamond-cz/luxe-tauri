import { type ReactNode } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ReOrderDotsVertical24Regular } from "@fluentui/react-icons";

interface Props {
  id:         string;
  children:   ReactNode;
  className?: string;
  /** When true, the whole tile becomes the drag handle. */
  fullCardHandle?: boolean;
  /** When false, hides the handle icon entirely. */
  showHandle?: boolean;
  /** Header height in px. Used to vertically center the drag handle on the
   *  card's header. Defaults to 48 (CollapsibleCard h-12); pass 44 for
   *  AeParamCard h-11. */
  headerHeight?: number;
  /** Left offset for the floating handle, in px. */
  handleLeft?: number;
  /** Outer radius used by the drag wrapper so drag shadow matches card shape. */
  borderRadius?: number;
}

/**
 * Generic dnd-kit Sortable wrapper. Supports either a small drag handle or
 * whole-card dragging for denser card layouts.
 */
export function SortableCard({
  id,
  children,
  className,
  fullCardHandle,
  showHandle = true,
  headerHeight = 48,
  handleLeft = 4,
  borderRadius = 12,
}: Props) {
  const {
    attributes, listeners, setNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id });

  const useWholeCardHandle = fullCardHandle || !showHandle;
  const handleSize = 20;

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : 1,
    boxShadow: isDragging
      ? "0 8px 18px rgba(0,0,0,0.35), 0 0 0 1px var(--colorBrandStroke1)"
      : undefined,
    cursor: useWholeCardHandle ? "grab" : "default",
    position: "relative",
    borderRadius,
  };

  const wholeCardProps = useWholeCardHandle ? { ...attributes, ...listeners } : {};
  const handleProps = useWholeCardHandle ? {} : { ...attributes, ...listeners };
  const handleTop = Math.max(0, (headerHeight - handleSize) / 2);

  return (
    <div ref={setNodeRef} style={style} className={className} {...wholeCardProps}>
      {showHandle && !useWholeCardHandle && (
        <button
          type="button"
          {...handleProps}
          title="拖拽换位"
          className="absolute z-10 flex h-5 w-5 cursor-grab items-center justify-center rounded transition-opacity opacity-45 hover:opacity-100"
          style={{
            top: handleTop,
            left: handleLeft,
            color: "var(--colorNeutralForeground3)",
            touchAction: "none",
          }}
          onClick={(e) => { e.stopPropagation(); }}
        >
          <ReOrderDotsVertical24Regular className="h-3.5 w-3.5" />
        </button>
      )}
      {children}
    </div>
  );
}
