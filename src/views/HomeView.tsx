import { useState } from "react";
import { Button } from "@fluentui/react-components";
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
  Code24Regular,
  DocumentText24Regular,
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
  const releaseUrl = useUpdateStore((s) => s.releaseUrl);
  const updateNotes = useUpdateStore((s) => s.notes);
  const downloadBytes = useUpdateStore((s) => s.downloadedBytes);
  const downloadTotal = useUpdateStore((s) => s.totalBytes);
  const setUpdateChecking = useUpdateStore((s) => s.setChecking);
  const setUpdateResult = useUpdateStore((s) => s.setResult);
  const setUpdateError = useUpdateStore((s) => s.setError);
  const [platformOrder, setPlatformOrder] = useState(
    PLATFORM_CARDS.map((card) => card.to),
  );
  const [updateLogOpen, setUpdateLogOpen] = useState(false);
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

  const openLatestRelease = () => {
    openReleaseUrl(releaseUrl || GITHUB_RELEASES_URL);
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
            className="relative flex min-h-28 flex-col justify-between gap-5 overflow-hidden rounded-xl border p-5 shadow-sm md:flex-row md:items-center"
            style={{
              background: "var(--colorNeutralBackground1)",
              borderColor: "var(--colorNeutralStroke2)",
            }}
          >
            <div className="min-w-0">
              <div className="text-2xl font-semibold"
                   style={{ color: "var(--colorNeutralForeground1)" }}>
                LUXE
              </div>
              <div className="mt-1 text-sm"
                   style={{ color: "var(--colorNeutralForeground3)" }}>
                当前版本 v{CURRENT_VERSION}
              </div>
              <div className="mt-2 flex items-center gap-2 text-sm"
                   style={{ color: updateStatus === "error" ? "var(--colorPaletteRedForeground1)" : updateStatus === "ok" ? "var(--colorPaletteGreenForeground1)" : "var(--colorNeutralForeground2)" }}>
                {updateStatus === "ok" ? <span aria-hidden>✓</span> : updateStatus === "available" ? <span aria-hidden>✦</span> : null}
                {updateStatus === "checking" ? "正在检查更新…" : updateStatus === "downloading" ? `正在下载更新${downloadTotal ? ` · ${Math.min(100, Math.floor(downloadBytes / downloadTotal * 100))}%` : "…"}` : updateStatus === "installing" ? "正在安装更新，完成后应用将重新启动" : updateStatus === "available" ? `发现新版本 v${latestVersion}` : updateStatus === "ok" ? `当前已是最新版本 v${CURRENT_VERSION}` : updateStatus === "error" ? "检查更新失败，请重试或查看 Release" : "检查 GitHub Releases 获取最新版本"}
              </div>
              {updateStatus === "available" && updateNotes && (
                <details className="mt-3 max-w-lg rounded-lg px-3 py-2 text-sm" style={{ background: "var(--colorNeutralBackground2)", color: "var(--colorNeutralForeground2)" }}>
                  <summary className="cursor-pointer">版本说明</summary>
                  <p className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap break-words">{updateNotes}</p>
                </details>
              )}
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Button appearance="secondary" icon={<Code24Regular />} onClick={openGithub}>
                GitHub
              </Button>
              <Button appearance="secondary" icon={<DocumentText24Regular />} onClick={() => setUpdateLogOpen(true)}>
                更新日志
              </Button>
              {(updateStatus === "available" || updateStatus === "error") && (
                <Button appearance="secondary" onClick={openLatestRelease}>
                  打开 Release
                </Button>
              )}
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
    </div>
  );
}
