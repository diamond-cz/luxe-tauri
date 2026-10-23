import type { UpdateNoteItem } from "@/services/updateNotes";

interface Props {
  items: readonly UpdateNoteItem[];
  compact?: boolean;
}

export function UpdateNoteList({ items, compact = false }: Props) {
  return (
    <ul className={compact ? "space-y-2" : "space-y-2.5"}>
      {items.map((item, index) => (
        <li key={`${index}-${item.content}`} className="flex min-w-0 items-start gap-2.5">
          {item.type && (
            <span
              className="mt-0.5 min-w-8 shrink-0 rounded px-1.5 py-0.5 text-center text-xs leading-4"
              style={{ background: "var(--colorNeutralBackground3)", color: "var(--colorNeutralForeground2)" }}
            >
              {item.type}
            </span>
          )}
          <span
            className={`min-w-0 flex-1 break-words ${compact ? "text-xs leading-5" : "text-sm leading-6"}`}
            style={{ color: "var(--colorNeutralForeground1)" }}
          >
            {item.content}
          </span>
        </li>
      ))}
    </ul>
  );
}
