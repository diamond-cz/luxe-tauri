import { useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
} from "@fluentui/react-components";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import {
  ArrowSync24Regular,
  ArrowDownload24Regular,
  DocumentText24Regular,
  Sparkle24Regular,
} from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import logo from "@/assets/luxe-logo.png";
import { SortableCard } from "@/components/common/SortableCard";
import { UpdateLogDialog } from "@/components/common/UpdateLogDialog";
import { FluentIcon, type LuxeIconName } from "@/components/icons/FluentIcon";
import { openUrl } from "@/ipc/shell";
import {
  checkForUpdate,
  CURRENT_VERSION,
  GITHUB_RELEASES_URL,
  GITHUB_REPOSITORY_URL,
} from "@/services/updateCheck";
import { usePoetryStore } from "@/stores/poetryStore";
import { useUpdateStore } from "@/stores/updateStore";
import { installAvailableUpdate } from "@/services/installUpdate";

interface PlatformCard {
  to: string;
  icon: LuxeIconName;
  title: string;
  subtitle: string;
  accent: string;
}

const PLATFORM_CARDS: PlatformCard[] = [
  {
    to: "/mtk",
    icon: "ic_fluent_window_location_target_filled",
    title: "MTK 平台",
    subtitle: "AE.cpp / ToneMap 解析与可视化",
    accent: "#9558C1",
  },
  {
    to: "/qualcomm",
    icon: "ic_fluent_window_shield_filled",
    title: "Qualcomm 平台",
    subtitle: "xml 参数文件导入(待扩展)",
    accent: "#2D7BF4",
  },
  {
    to: "/unisoc",
    icon: "ic_fluent_window_brush_filled",
    title: "Unisoc 平台",
    subtitle: "xml 参数文件导入(待扩展)",
    accent: "#E94B7A",
  },
];

export function HomeView() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const poetry = usePoetryStore((s) => s.line);
  const updateStatus = useUpdateStore((s) => s.status);
  const latestVersion = useUpdateStore((s) => s.latestVersion);
  const downloadBytes = useUpdateStore((s) => s.downloadedBytes);
  const downloadTotal = useUpdateStore((s) => s.totalBytes);
  const setUpdateChecking = useUpdateStore((s) => s.setChecking);
  const setUpdateResult = useUpdateStore((s) => s.setResult);
  const setUpdateError = useUpdateStore((s) => s.setError);
  const [platformOrder, setPlatformOrder] = useState(
    PLATFORM_CARDS.map((card) => card.to),
  );
  const [updateLogOpen, setUpdateLogOpen] = useState(false);
  const [overwriteConfirmOpen, setOverwriteConfirmOpen] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const updateBusy = updateStatus === "checking" || updateStatus === "downloading" || updateStatus === "installing";
  const primaryUpdateLabel = updateStatus === "checking"
    ? "检查中"
    : updateStatus === "downloading"
      ? "下载中"
      : updateStatus === "installing"
        ? "安装中"
        : updateStatus === "available"
          ? "下载并安装"
      : "检查更新";

  const orderedCards = platformOrder
    .map((id) => PLATFORM_CARDS.find((card) => card.to === id))
    .filter((card): card is PlatformCard => Boolean(card));

  const onPlatformDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setPlatformOrder((current) => {
      const oldIdx = current.indexOf(String(active.id));
      const newIdx = current.indexOf(String(over.id));
      if (oldIdx < 0 || newIdx < 0) return current;
      return arrayMove(current, oldIdx, newIdx);
    });
  };

  const openGithub = () => {
    openUrl(GITHUB_REPOSITORY_URL).catch((err) => setUpdateError(err, "manual"));
  };

  const openReleaseUrl = (url: string) => {
    openUrl(url)
      .catch((err) => setUpdateError(err, "manual"));
  };

  const checkUpdate = async () => {
    if (updateBusy) return;
    const oldUpdate = useUpdateStore.getState().update;
    if (oldUpdate) await oldUpdate.close().catch(() => {});
    setUpdateChecking("manual");
    try {
      const result = await checkForUpdate();
      setUpdateResult(result, "manual");
    } catch (err) {
      setUpdateError(err, "manual");
    }
  };

  const confirmOverwriteUpdate = async () => {
    if (updateBusy) return;
    setOverwriteConfirmOpen(false);
    const oldUpdate = useUpdateStore.getState().update;
    if (oldUpdate) await oldUpdate.close().catch(() => {});
    setUpdateChecking("manual");
    try {
      const result = await checkForUpdate();
      setUpdateResult(result, "manual");
      if (result.status === "available") {
        await installAvailableUpdate();
      }
    } catch (err) {
      setUpdateError(err, "manual");
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto overflow-x-hidden">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-10 py-10">
        <header className="flex items-center gap-5">
          <img src={logo} alt="LUXE" className="h-16 w-16 rounded-lg" />
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight"
                style={{ color: "var(--colorNeutralForeground1)" }}>
              LUXE
            </h1>
            <p className="mt-1 text-sm"
               style={{ color: "var(--colorNeutralForeground3)" }}>
              {t("app_desc", { defaultValue: "影像效果跨平台AE算法可视化" })}
              <span className="mx-2">·</span>
              <span style={{ color: "var(--colorBrandForeground1)" }}>
                {poetry}
              </span>
            </p>
          </div>
        </header>

        <section className="flex flex-col gap-3">
          <h2 className="flex items-center gap-3 text-base font-semibold">
            <span aria-hidden className="inline-block h-4 w-1 rounded-sm"
                  style={{ background: "var(--colorBrandBackground)" }} />
            <span style={{ color: "var(--colorNeutralForeground1)" }}>平台</span>
          </h2>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onPlatformDragEnd}
          >
            <SortableContext items={platformOrder} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {orderedCards.map((card) => (
                  <SortableCard key={card.to} id={card.to}>
                    <button
                      type="button"
                      onClick={() => navigate(card.to)}
                      className="group flex h-full w-full flex-col gap-3 rounded-lg border p-5 pl-8 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
                      style={{
                        background: "var(--colorNeutralBackground2)",
                        borderColor: "var(--colorNeutralStroke2)",
                      }}
                    >
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-md"
                        style={{ background: `${card.accent}33`, color: card.accent }}
                      >
                        <FluentIcon name={card.icon} />
                      </div>
                      <div className="text-base font-semibold"
                           style={{ color: "var(--colorNeutralForeground1)" }}>
                        {card.title}
                      </div>
                      <div className="text-xs"
                           style={{ color: "var(--colorNeutralForeground3)" }}>
                        {card.subtitle}
                      </div>
                    </button>
                  </SortableCard>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="flex items-center gap-3 text-base font-semibold">
            <span aria-hidden className="inline-block h-4 w-1 rounded-sm"
                  style={{ background: "var(--colorBrandBackground)" }} />
            <span style={{ color: "var(--colorNeutralForeground1)" }}>关于</span>
          </h2>

          <div
            className="relative flex min-h-28 flex-col gap-4 overflow-hidden rounded-xl border p-5 shadow-sm"
            style={{
              background: "var(--colorNeutralBackground2)",
              borderColor: "var(--colorNeutralStroke2)",
            }}
          >
            <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div className="min-w-0">
              <div className="text-2xl font-semibold"
                   style={{ color: "var(--colorNeutralForeground1)" }}>
                LUXE
              </div>
              <div className="mt-1 text-sm"
                   style={{ color: "var(--colorNeutralForeground3)" }}>
                版本 v{CURRENT_VERSION}
              </div>
              <div className="mt-2 flex items-center gap-2 text-sm"
                   style={{ color: updateStatus === "error" ? "var(--colorPaletteRedForeground1)" : updateStatus === "ok" ? "var(--colorPaletteGreenForeground1)" : "var(--colorNeutralForeground2)" }}>
                {updateStatus === "ok" ? <span aria-hidden>✓</span> : updateStatus === "available" ? <span aria-hidden>✦</span> : null}
                {updateStatus === "checking" ? "正在检查更新…" : updateStatus === "downloading" ? `正在下载更新${downloadTotal ? ` · ${Math.min(100, Math.floor(downloadBytes / downloadTotal * 100))}%` : "…"}` : updateStatus === "installing" ? "正在安装更新，完成后应用将重新启动" : updateStatus === "available" ? `发现新版本 v${latestVersion}` : updateStatus === "ok" ? `当前已是最新版本 v${CURRENT_VERSION}` : updateStatus === "error" ? "检查更新失败，请重试或查看 Release" : "检查 GitHub Releases 获取最新版本"}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Button
                appearance="primary"
                icon={updateStatus === "available"
                  ? <ArrowDownload24Regular />
                  : <ArrowSync24Regular className={updateStatus === "checking" ? "animate-spin motion-reduce:animate-none" : undefined} />}
                disabled={updateBusy}
                onClick={updateStatus === "available" ? () => void installAvailableUpdate() : checkUpdate}
              >
                {primaryUpdateLabel}
              </Button>
            </div>
            </div>

            <div
              className="flex flex-wrap items-center gap-2 border-t pt-3"
              style={{ borderColor: "var(--colorNeutralStroke2)" }}
            >
              <Button
                className="transition-all duration-150 ease-out hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.97] motion-reduce:transform-none motion-reduce:transition-none"
                appearance="secondary"
                icon={
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M12 0C5.37 0 0 5.37 0 12c0 5.3 3.438 9.8 8.205 11.385.6.11.82-.26.82-.577v-2.234c-3.338.726-4.043-1.416-4.043-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.73.083-.73 1.205.085 1.84 1.237 1.84 1.237 1.07 1.835 2.807 1.305 3.492.998.108-.776.418-1.305.762-1.605-2.665-.3-5.467-1.334-5.467-5.93 0-1.31.468-2.38 1.235-3.22-.123-.303-.535-1.523.117-3.176 0 0 1.008-.322 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.873.12 3.176.77.84 1.233 1.91 1.233 3.22 0 4.61-2.807 5.625-5.48 5.92.43.372.823 1.103.823 2.222v3.293c0 .32.216.694.825.576C20.565 21.796 24 17.3 24 12 24 5.37 18.63 0 12 0z"
                    />
                  </svg>
                }
                onClick={openGithub}
                style={{ background: "var(--colorNeutralBackground1)" }}
              >
                GitHub
              </Button>
              <Button
                className="transition-all duration-150 ease-out hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.97] motion-reduce:transform-none motion-reduce:transition-none"
                appearance="secondary"
                icon={<DocumentText24Regular />}
                onClick={() => openReleaseUrl(GITHUB_RELEASES_URL)}
                style={{ background: "var(--colorNeutralBackground1)" }}
              >
                更新日志
              </Button>
              <Button
                className="transition-all duration-150 ease-out hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.97] motion-reduce:transform-none motion-reduce:transition-none"
                appearance="secondary"
                icon={<Sparkle24Regular />}
                onClick={() => setUpdateLogOpen(true)}
                style={{ background: "var(--colorNeutralBackground1)" }}
              >
                近期更新
              </Button>
              <Button
                className="shrink-0 whitespace-nowrap transition-all duration-150 ease-out hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.97] motion-reduce:transform-none motion-reduce:transition-none"
                appearance="secondary"
                icon={<ArrowDownload24Regular />}
                onClick={() => setOverwriteConfirmOpen(true)}
                disabled={updateBusy}
                style={{ background: "var(--colorNeutralBackground1)" }}
              >
                覆盖更新
              </Button>
            </div>

            {updateStatus === "downloading" && (
              <progress
                className="absolute inset-x-0 bottom-0 block h-1 w-full"
                value={downloadTotal ? Math.min(downloadBytes, downloadTotal) : undefined}
                max={downloadTotal ?? undefined}
                aria-label="更新下载进度"
                style={{ accentColor: "var(--colorBrandBackground)" }}
              />
            )}
          </div>
        </section>
      </div>

      {updateLogOpen && (
        <UpdateLogDialog
          open
          onClose={() => setUpdateLogOpen(false)}
          onOpenRelease={openReleaseUrl}
        />
      )}

      <Dialog
        open={overwriteConfirmOpen}
        modalType="modal"
        onOpenChange={(_, data) => {
          if (!data.open) setOverwriteConfirmOpen(false);
        }}
      >
        <DialogSurface
          style={{
            maxWidth: 520,
            padding: 0,
            overflow: "hidden",
            borderRadius: 14,
            background: "var(--colorNeutralBackground1)",
            border: "1px solid var(--colorNeutralStroke2)",
          }}
        >
          <DialogBody>
            <DialogTitle
              style={{
                padding: "20px 24px",
                borderBottom: "1px solid var(--colorNeutralStroke2)",
                color: "var(--colorNeutralForeground1)",
                fontSize: 20,
                fontWeight: 600,
              }}
            >
              确认覆盖更新
            </DialogTitle>
            <DialogContent
              style={{
                margin: 0,
                padding: "20px 24px",
                color: "var(--colorNeutralForeground2)",
                lineHeight: 1.6,
              }}
            >
              将检查并下载 GitHub 上的最新版本，安装后替换当前版本并重新启动应用。是否继续？
            </DialogContent>
            <DialogActions
              style={{
                padding: "14px 24px 18px",
                borderTop: "1px solid var(--colorNeutralStroke2)",
              }}
            >
              <Button appearance="secondary" onClick={() => setOverwriteConfirmOpen(false)} style={{ minWidth: 88 }}>
                取消
              </Button>
              <Button appearance="primary" icon={<ArrowDownload24Regular />} onClick={() => void confirmOverwriteUpdate()} style={{ minWidth: 132, whiteSpace: "nowrap" }}>
                覆盖更新
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
