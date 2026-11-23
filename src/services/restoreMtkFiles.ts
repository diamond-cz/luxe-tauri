import { isFile } from "@/ipc/shell";
import type { Mtk } from "@/types/ipc";

/** Validate saved imports before they enter the visible workspace state. */
export async function validateMtkFilePaths(saved: Mtk): Promise<Mtk> {
  const paths = [...new Set([
    ...Object.values(saved.cpp_paths ?? {}), saved.cpp_path, saved.debug_parser_path,
  ].filter((path): path is string => typeof path === "string"))];
  const missing = new Set<string>();
  await Promise.all(paths.map(async (path) => {
    if (!path.trim()) { missing.add(path); return; }
    try {
      if (!(await isFile(path))) missing.add(path);
    } catch (error) {
      // An IPC failure does not establish that the original file is missing.
      console.warn("check saved MTK file failed", path, error);
    }
  }));
  if (missing.size === 0) return saved;
  const restored: Mtk = { ...saved };
  if (saved.cpp_paths) {
    restored.cpp_paths = Object.fromEntries(Object.entries(saved.cpp_paths)
      .filter(([, path]) => !missing.has(path)));
  }
  if (saved.cpp_path != null && missing.has(saved.cpp_path)) restored.cpp_path = null;
  if (saved.debug_parser_path != null && missing.has(saved.debug_parser_path)) restored.debug_parser_path = null;
  return restored;
}
