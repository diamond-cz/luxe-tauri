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
  Code24Regular,
  DocumentText24Regular,
} from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import logo from "@/assets/luxe-logo.png";
import { SortableCard } from "@/components/common/SortableCard";
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
    subtitle: "C++ 参数文件导入（待扩展）",
    accent: "#2D7BF4",
  },
  {
    to: "/unisoc",
    icon: "ic_fluent_window_brush_filled",
    title: "Unisoc 平台",
    subtitle: "C++ 参数文件导入（待扩展）",
    accent: "#E94B7A",
  },
];

export function HomeView() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const poetry = usePoetryStore((s) => s.line);
  const updateStatus = useUpdateStore((s) => s.status);
  const updateMessage = useUpdateStore((s) => s.message);
  const releaseUrl = useUpdateStore((s) => s.releaseUrl);
  const setUpdateChecking = useUpdateStore((s) => s.setChecking);
  const setUpdateResult = useUpdateStore((s) => s.setResult);
  const setUpdateError = useUpdateStore((s) => s.setError);
  const [platformOrder, setPlatformOrder] = useState(
    PLATFORM_CARDS.map((card) => card.to),
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const primaryUpdateLabel = updateStatus === "checking"
    ? "检查中"
    : updateStatus === "available"
      ? "打开新版"
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

  const openLatestRelease = () => {
    openUrl(releaseUrl || GITHUB_RELEASES_URL)
      .catch((err) => setUpdateError(err, "manual"));
  };

  const checkUpdate = async () => {
    if (updateStatus === "checking") return;
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
              {t("app_desc", { defaultValue: "多平台 AE 算法可视化工具" })}
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
            className="flex min-h-28 flex-col justify-between gap-5 rounded-lg border p-5 md:flex-row md:items-center"
            style={{
              background: "var(--colorNeutralBackground2)",
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
              <div className="mt-2 text-xs"
                   style={{
                     color: updateStatus === "error"
                       ? "var(--colorPaletteRedForeground1)"
                       : updateStatus === "available"
                         ? "var(--colorBrandForeground1)"
                         : "var(--colorNeutralForeground3)",
                   }}>
                {updateMessage}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Button appearance="secondary" icon={<Code24Regular />} onClick={openGithub}>
                GitHub
              </Button>
              <Button appearance="secondary" icon={<DocumentText24Regular />} onClick={openLatestRelease}>
                更新日志
              </Button>
              <Button
                appearance="primary"
                icon={<ArrowSync24Regular />}
                disabled={updateStatus === "checking"}
                onClick={updateStatus === "available" ? openLatestRelease : checkUpdate}
              >
                {primaryUpdateLabel}
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
