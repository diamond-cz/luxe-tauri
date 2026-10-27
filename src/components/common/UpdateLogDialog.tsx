import UPDATE_LOGS from "@/data/changelog.json";
import { UpdateNoteList } from "@/components/common/UpdateNoteList";
import {
  Button,
  Dialog,
  DialogSurface,
} from "@fluentui/react-components";
import {
  Dismiss24Regular,
  Open24Regular,
  Sparkle24Regular,
} from "@fluentui/react-icons";

import { GITHUB_RELEASES_URL, GITHUB_REPOSITORY_URL } from "@/services/updateCheck";
import { useUpdateStore } from "@/stores/updateStore";

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenRelease: (url: string) => void;
}

function releaseUrlFor(version: string) {
  return `${GITHUB_REPOSITORY_URL}/releases/tag/v${version}`;
}

export function UpdateLogDialog({ open, onClose, onOpenRelease }: Props) {
  const currentVersion = useUpdateStore((state) => state.currentVersion);
  return (
    <Dialog
      open={open}
      modalType="modal"
      onOpenChange={(_, data) => {
        if (!data.open) onClose();
      }}
    >
      <DialogSurface
        aria-label="更新记录"
        backdrop={{ className: "luxe-update-log-backdrop" }}
        className="luxe-update-log-surface"
        style={{
          width: "min(640px, calc(100vw - 32px))",
          maxWidth: 640,
          height: "min(760px, calc(100vh - 32px))",
          maxHeight: "calc(100vh - 32px)",
          padding: 0,
          borderRadius: 8,
          overflow: "hidden",
          background: "var(--colorNeutralBackground1)",
          borderColor: "var(--colorNeutralStroke2)",
        }}
      >
        <div className="flex h-full min-h-0 flex-col">
          <header
            className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b px-5 py-4 sm:min-h-20 sm:px-7"
            style={{ borderColor: "var(--colorNeutralStroke2)" }}
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md" style={{ background: "var(--colorBrandBackground2)", color: "var(--colorBrandForeground1)" }}>
                <Sparkle24Regular className="h-6 w-6" />
              </span>
              <div className="min-w-0">
              <h2
                className="text-xl font-bold"
                style={{ color: "var(--colorNeutralForeground1)" }}
              >
                近期更新
              </h2>
              <div
                className="mt-1 truncate text-xs"
                style={{ color: "var(--colorNeutralForeground3)" }}
              >
                当前版本 v{currentVersion} · 已收录 {UPDATE_LOGS.length} 个版本
              </div>
              </div>
            </div>
            <Button
              appearance="subtle"
              size="small"
              icon={<Dismiss24Regular />}
              onClick={onClose}
              aria-label="关闭更新记录"
            />
          </header>

          <div
            className="min-h-0 flex-1 overflow-y-auto px-5 py-2 sm:px-7"
            style={{ background: "var(--colorNeutralBackground1)" }}
          >
            <div>
              {UPDATE_LOGS.map((entry) => {
                const isCurrent = entry.version === currentVersion;

                return (
                  <article
                    key={entry.version}
                    className="border-b py-5 last:border-b-0"
                    style={{ borderColor: "var(--colorNeutralStroke2)" }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span
                          className="text-base font-semibold tabular-nums"
                          style={{ color: "var(--colorNeutralForeground1)" }}
                        >
                          v{entry.version}
                        </span>
                        <time
                          className="text-xs"
                          dateTime={entry.date}
                          style={{ color: "var(--colorNeutralForeground4)" }}
                        >
                          {entry.date}
                        </time>
                        {isCurrent && (
                          <span
                            className="text-xs"
                            style={{
                              color: "var(--colorPaletteGreenForeground1)",
                            }}
                          >
                            当前版本
                          </span>
                        )}
                      </div>

                      <Button
                        appearance="subtle"
                        size="small"
                        icon={<Open24Regular />}
                        iconPosition="after"
                        onClick={() => onOpenRelease(releaseUrlFor(entry.version))}
                      >
                        查看版本
                      </Button>
                    </div>

                    <div className="mt-3"><UpdateNoteList items={entry.items} /></div>
                  </article>
                );
              })}
            </div>
          </div>

          <footer
            className="flex shrink-0 flex-col gap-3 border-t px-5 py-4 sm:min-h-20 sm:flex-row sm:items-center sm:justify-between sm:px-7"
            style={{
              background: "var(--colorNeutralBackground2)",
              borderColor: "var(--colorNeutralStroke2)",
            }}
          >
            <div
              className="text-xs"
              style={{ color: "var(--colorNeutralForeground3)" }}
            >
              发布包与完整历史记录以 GitHub Releases 为准
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                appearance="secondary"
                icon={<Open24Regular />}
                onClick={() => onOpenRelease(GITHUB_RELEASES_URL)}
              >
                查看全部 Releases
              </Button>
              <Button appearance="secondary" onClick={onClose}>
                关闭
              </Button>
            </div>
          </footer>
        </div>
      </DialogSurface>
    </Dialog>
  );
}
