import type { ImageEntry, ImageMetadataContext } from "@/ipc/imageScan";

export type ImageSortDirection = "asc" | "desc";
type FieldBatch = Record<string, Record<string, string>>;
type ReadBatch = (paths: string[], keys: string[], context: ImageMetadataContext) => Promise<FieldBatch>;
export const IMAGE_SORT_BATCH_SIZE = 1024;

export function parseImageSortNumber(value: string | undefined): number | null {
  const text = (value ?? "").trim();
  if (!text || text === "-") return null;
  const normalised = text.replace(/[,_\s]/g, "");
  const direct = Number(normalised);
  if (Number.isFinite(direct)) return direct;
  const matched = text.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/i)?.[0];
  if (!matched) return null;
  const parsed = Number(matched);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Sort the caller's newly-created row array; values are parsed once when loaded. */
export function sortImageRows<T extends { i: number }>(rows: T[], values: Float64Array, direction: ImageSortDirection): T[] {
  const sign = direction === "asc" ? 1 : -1;
  return rows.sort((a, b) => {
    const av = values[a.i], bv = values[b.i];
    const aValid = Number.isFinite(av), bValid = Number.isFinite(bv);
    if (!aValid || !bValid) return aValid ? -1 : bValid ? 1 : a.i - b.i;
    return av === bv ? a.i - b.i : av < bv ? -sign : sign;
  });
}

export interface ImageSortSnapshot {
  entries: ImageEntry[];
  revision: number;
  key: string;
  values: Float64Array;
}

interface SortJob {
  context: { entries: ImageEntry[]; revision: number };
  key: string;
  keys: string[];
  readValue: (data: Record<string, string>) => string;
  resolve: (snapshot: ImageSortSnapshot | null) => void;
  reject: (error: unknown) => void;
  generation: number;
}

/** One active 1024-row IPC and one latest pending job per mounted table.
 * Cancellation cannot abort a Tauri invoke already in progress, but prevents
 * all remaining batches and drops superseded pending column selections.
 * Completed results belong to React state; this loader keeps no result cache.
 */
export function createImageTableSortLoader(readBatch: ReadBatch) {
  let generation = 0;
  let running = false;
  let pending: SortJob | null = null;
  const cancel = () => {
    generation++;
    pending?.resolve(null);
    pending = null;
  };
  const read = async (job: SortJob): Promise<ImageSortSnapshot | null> => {
    const { entries, revision } = job.context;
    const values = new Float64Array(entries.length).fill(NaN);
    for (let start = 0; start < entries.length; start += IMAGE_SORT_BATCH_SIZE) {
      if (generation !== job.generation) return null;
      const end = Math.min(entries.length, start + IMAGE_SORT_BATCH_SIZE);
      const paths = entries.slice(start, end).map((entry) => entry.toml_path);
      const batch = await readBatch(paths, job.keys, job.context);
      if (generation !== job.generation) return null;
      for (let index = start; index < end; index++) {
        values[index] = parseImageSortNumber(job.readValue(batch[entries[index].toml_path] ?? {})) ?? NaN;
      }
    }
    return { entries, revision, key: job.key, values };
  };
  const drain = async () => {
    if (running) return;
    running = true;
    try {
      while (pending) {
        const job = pending;
        pending = null;
        try { job.resolve(await read(job)); }
        catch (error) {
          if (generation === job.generation) job.reject(error);
          else job.resolve(null);
        }
      }
    } finally { running = false; }
  };
  return {
    cancel,
    load(context: SortJob["context"], key: string, keys: string[], readValue: SortJob["readValue"]) {
      cancel();
      return new Promise<ImageSortSnapshot | null>((resolve, reject) => {
        pending = { context, key, keys, readValue, resolve, reject, generation };
        void drain();
      });
    },
  };
}
