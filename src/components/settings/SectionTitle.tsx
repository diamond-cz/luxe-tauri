interface Props {
  title:    string;
  className?: string;
}

/** "I {title}" pattern — purple vertical bar + bold title. */
export function SectionTitle({ title, className }: Props) {
  return (
    <h2
      className={`flex items-center gap-3 text-lg font-semibold ${className ?? ""}`}
    >
      <span
        aria-hidden
        className="inline-block h-5 w-1 rounded-sm"
        style={{ background: "var(--colorBrandBackground)" }}
      />
      <span>{title}</span>
    </h2>
  );
}
