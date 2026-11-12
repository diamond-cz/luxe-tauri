import { mergeImageMetadata, loadImageToml, parseImageExif, prepareImageMetadata, scanImageDir, type ExifParseProgress, type ExifParseSummary, type ImageEntry, type ImageMetadataPreparationResult } from "@/ipc/imageScan";
import { useMtkStore } from "@/stores/mtkStore";
import type { IspId } from "@/views/mtk/ispTabs";

export class ImageExifTaskError extends Error {
  constructor(readonly code: "empty" | "busy" | "changed" | "parser_required") { super(code); }
}

type ExifListener = {
  callback: (progress: ExifParseProgress) => void;
  remove: () => void;
};

type ExifJob = {
  dir: string;
  entries: ImageEntry[];
  /** Workspace whose selection should survive the shared refresh. */
  selectionWorkspaceKey?: string;
  listeners: Set<ExifListener>;
  lastProgress?: ExifParseProgress;
  promise: Promise<ExifParseSummary>;
};

// Only live jobs are retained; no image data or completed results are cached.
// AE Basic and ToneMap share their imageDir key and therefore the same job.
// Each caller subscribes independently so unmounting one view does not steal
// progress updates from the other view.
const EXIF_JOB_LIMIT = 16;
const jobs = new Map<string, ExifJob>();
const mergeJobs = new Set<string>();
// Only live import jobs. Completion is on disk; never retain directory-sized EXIF.
type ImportJob = { dir: string; generation: number; promise: Promise<ImageMetadataPreparationResult> };
const imports = new Map<string, ImportJob>();
type MetadataSnapshot = Pick<ExifJob, "dir" | "entries" | "selectionWorkspaceKey">;

/** Import owns its shared state to survive AE/Tone switches and view unmounts. */
export function prepareWorkspaceImageDirectory(
  isp: IspId, tabIdx: number, dir: string, selectedImage?: string | null,
): Promise<ImageMetadataPreparationResult> {
  const key = `${isp}|${tabIdx}`;
  const store = useMtkStore.getState();
  const previous = store.imageDir[key];
  const live = imports.get(key);
  if (live?.dir === dir && previous?.metadataPreparing && previous.loadRevision === live.generation) return live.promise;
  // A new folder explicitly supersedes the stale view generation. Its Rust
  // work remains serialized by EXIF_TASKS, but cannot republish old progress.
  if (jobs.has(key) || mergeJobs.has(key) || (!live && imports.size >= EXIF_JOB_LIMIT)) return Promise.reject(new ImageExifTaskError("busy"));
  const restorePath = selectedImage ?? (previous?.dir === dir ? previous.entries[previous.current]?.jpg_path
    ?? store.mtk.image_workspaces?.[key]?.selected_image : null);
  store.setImageDir(isp, tabIdx, { dir, entries: [], current: 0, tomlData: {}, status: "scanning", message: null,
    metadataPreparing: true, preparationProgress: { stage: "JPEG", completed: 0, total: 0 }, preparationSummary: null });
  const generation = useMtkStore.getState().imageDir[key].loadRevision;
  const active = () => {
    const image = useMtkStore.getState().imageDir[key];
    return image?.dir === dir && image.loadRevision === generation && image.metadataPreparing;
  };
  const job: ImportJob = { dir, generation, promise: Promise.resolve().then(async () => {
    try {
      const result = await prepareImageMetadata(dir, (progress) => {
        if (active()) useMtkStore.getState().setImageDir(isp, tabIdx, { preparationProgress: progress });
      });
      if (!active()) return result;
      const entries = result.entries;
      const current = Math.max(0, entries.findIndex((entry) => entry.jpg_path === restorePath));
      const selected = entries[current];
      useMtkStore.getState().setImageDir(isp, tabIdx, { entries, current, tomlData: {},
        metadataPreparing: false, preparationProgress: null, preparationSummary: result.summary,
        status: selected ? "loading" : "error", message: selected ? null : "image_exif.error.empty" });
      const snapshot = useMtkStore.getState().imageDir[key];
      if (selected) {
        const data = await loadImageToml(selected.toml_path).catch((): Record<string, string> => ({}));
        const latest = useMtkStore.getState().imageDir[key];
        if (latest?.entries === entries && latest.loadRevision === snapshot.loadRevision) {
          useMtkStore.getState().setImageDir(isp, tabIdx, { tomlData: data, status: "done" });
        }
      }
      return result;
    } catch (error) {
      if (active()) useMtkStore.getState().setImageDir(isp, tabIdx, { status: "error", message: String(error),
        metadataPreparing: false, preparationProgress: null });
      throw error;
    } finally {
      if (imports.get(key) === job) imports.delete(key);
    }
  }) };
  imports.set(key, job);
  return job.promise;
}

async function refreshMetadata(isp: IspId, tabIdx: number, job: MetadataSnapshot, prepared?: ImageMetadataPreparationResult) {
  const key = `${isp}|${tabIdx}`;
  const unchanged = () => {
    const image = useMtkStore.getState().imageDir[key];
    return image?.dir === job.dir && image.entries === job.entries;
  };
  if (!unchanged()) return;
  const entries = prepared?.entries ?? await scanImageDir(job.dir);
  if (!unchanged()) return;

  const store = useMtkStore.getState();
  const image = store.imageDir[key];
  // Preserve the selection belonging to the view that started the shared job.
  // AE Basic and ToneMap can intentionally have different selections even
  // though they share one imageDir index.
  const requestedPath = job.selectionWorkspaceKey
    ? store.imageSelection[job.selectionWorkspaceKey]
    : null;
  const selectedPath = requestedPath && image.entries.some((entry) => entry.jpg_path === requestedPath)
    ? requestedPath
    : image.entries[image.current]?.jpg_path;
  const current = Math.max(0, entries.findIndex((entry) => entry.jpg_path === selectedPath));
  const selected = entries[current];
  const metadataRevision = (image.metadataRevision ?? 0) + 1;
  store.setImageDir(isp, tabIdx, {
    entries, current, tomlData: {}, metadataRevision,
    ...(prepared ? { preparationSummary: prepared.summary } : {}),
    status: selected ? "loading" : "done", message: null,
  });
  const loadRevision = useMtkStore.getState().imageDir[key].loadRevision;
  if (selected) {
    const data = await loadImageToml(selected.toml_path).catch((): Record<string, string> => ({}));
    const latest = useMtkStore.getState().imageDir[key];
    // Paired selection/sync preferences do not invalidate a metadata load.
    // A real new load (including A -> B -> A) still supersedes this result.
    if (latest?.entries === entries && latest.metadataRevision === metadataRevision
      && latest.loadRevision === loadRevision) {
      useMtkStore.getState().setImageDir(isp, tabIdx, { tomlData: data, status: "done" });
    }
  }
}

async function runJob(isp: IspId, tabIdx: number, parserPath: string | null, job: ExifJob) {
  const result = await parseImageExif(parserPath, job.dir, (progress) => {
    job.lastProgress = progress;
    for (const listener of job.listeners) listener.callback(progress);
  });
  await refreshMetadata(isp, tabIdx, job);
  return result;
}

/** Explicit native merge is additive and never removes a metadata file. */
export async function mergeWorkspaceImageMetadata(
  isp: IspId, tabIdx: number, imagePaths: string[], onProgress?: (progress: ExifParseProgress) => void,
  selectionWorkspaceKey?: string, signal?: AbortSignal,
): Promise<ImageMetadataPreparationResult> {
  const key = `${isp}|${tabIdx}`;
  const image = useMtkStore.getState().imageDir[key];
  if (!image?.dir || !image.entries.length) throw new ImageExifTaskError("empty");
  if (imports.has(key) || jobs.has(key) || mergeJobs.has(key) || mergeJobs.size >= EXIF_JOB_LIMIT) throw new ImageExifTaskError("busy");
  const paths = [...new Set(imagePaths)];
  if (!paths.every((path) => image.entries.some((entry) => entry.jpg_path === path))) throw new ImageExifTaskError("changed");
  const snapshot = { dir: image.dir, entries: image.entries, selectionWorkspaceKey };
  let settled = false;
  const unchanged = () => {
    const latest = useMtkStore.getState().imageDir[key];
    return latest?.dir === snapshot.dir && latest.entries === snapshot.entries;
  };
  mergeJobs.add(key);
  try {
    const result = await mergeImageMetadata(snapshot.dir, paths, (progress) => {
      if (!settled && !signal?.aborted && unchanged()) onProgress?.(progress);
    });
    settled = true;
    await refreshMetadata(isp, tabIdx, snapshot, result);
    return result;
  } catch (error) {
    settled = true;
    await refreshMetadata(isp, tabIdx, snapshot);
    throw error;
  } finally { mergeJobs.delete(key); }
}

function subscribeProgress(
  job: ExifJob,
  onProgress: ((progress: ExifParseProgress) => void) | undefined,
  signal: AbortSignal | undefined,
) {
  if (!onProgress || signal?.aborted) return;
  let listener: ExifListener;
  const remove = () => {
    if (!job.listeners.delete(listener)) return;
    signal?.removeEventListener("abort", remove);
  };
  listener = { callback: onProgress, remove };
  job.listeners.add(listener);
  signal?.addEventListener("abort", remove, { once: true });
  if (job.lastProgress) onProgress(job.lastProgress);
}

/** Shared refresh survives React unmounts; only progress/toasts belong to the view. */
export function parseWorkspaceImageExif(
  isp: IspId,
  tabIdx: number,
  parserPath: string | null,
  onProgress?: (progress: ExifParseProgress) => void,
  selectionWorkspaceKey?: string,
  signal?: AbortSignal,
): Promise<ExifParseSummary> {
  const key = `${isp}|${tabIdx}`;
  const image = useMtkStore.getState().imageDir[key];
  if (!image?.dir || image.entries.length === 0) return Promise.reject(new ImageExifTaskError("empty"));
  if (!parserPath) return Promise.reject(new ImageExifTaskError("parser_required"));
  if (imports.has(key) || mergeJobs.has(key)) return Promise.reject(new ImageExifTaskError("busy"));
  const existing = jobs.get(key);
  if (existing?.dir === image.dir && existing.entries === image.entries) {
    subscribeProgress(existing, onProgress, signal);
    return existing.promise;
  }
  if (existing) return Promise.reject(new ImageExifTaskError("busy"));
  if (jobs.size >= EXIF_JOB_LIMIT) return Promise.reject(new ImageExifTaskError("busy"));
  const job: ExifJob = {
    dir: image.dir,
    entries: image.entries,
    selectionWorkspaceKey,
    listeners: new Set(),
    promise: Promise.resolve().then(() => runJob(isp, tabIdx, parserPath, job)).finally(() => {
      for (const listener of job.listeners) listener.remove();
      if (jobs.get(key) === job) jobs.delete(key);
    }),
  };
  jobs.set(key, job);
  subscribeProgress(job, onProgress, signal);
  return job.promise;
}
