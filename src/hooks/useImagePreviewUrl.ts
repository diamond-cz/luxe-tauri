import { useEffect, useState } from "react";
import { loadImagePreview } from "@/ipc/imageScan";

type PreviewState = { path: string; url: string | null; error: boolean };

export function useImagePreview(path: string | undefined): { url: string | null; loading: boolean; error: boolean } {
  const [loaded, setLoaded] = useState<PreviewState | null>(null);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      loadImagePreview(path)
        .then((url) => { if (!cancelled) setLoaded({ path, url, error: false }); })
        .catch(() => { if (!cancelled) setLoaded({ path, url: null, error: true }); });
    }, 80);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [path]);

  if (!path) return { url: null, loading: false, error: false };
  if (loaded?.path !== path) return { url: null, loading: true, error: false };
  return { url: loaded.url, loading: false, error: loaded.error };
}

export function useImagePreviewUrl(path: string | undefined): string | null {
  return useImagePreview(path).url;
}
