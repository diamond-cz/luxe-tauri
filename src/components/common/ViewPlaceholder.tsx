interface Props {
  title:     string;
  subtitle?: string;
  children?: React.ReactNode;
}

/**
 * Generic placeholder for views that haven't been built yet. Replaced
 * milestone-by-milestone (HomeView in M2, MtkView in M4, etc.).
 */
export function ViewPlaceholder({ title, subtitle, children }: Props) {
  return (
    <div className="flex h-full w-full flex-col gap-2 p-8 overflow-auto">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {subtitle && <p className="text-sm text-neutral-400">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}
