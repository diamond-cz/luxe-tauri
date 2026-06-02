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
import { usePoetryStore } from "@/stores/poetryStore";
import pkg from "../../package.json";

const GITHUB_URL = "https://github.com/diamond-cz/LUXE";
const LATEST_RELEASE_URL = "https://api.github.com/repos/diamond-cz/LUXE/releases/latest";
const CURRENT_VERSION = pkg.version;

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

type UpdateState =
  | { status: "idle"; message: string }
  | { status: "checking"; message: string }
  | { status: "ok"; message: string }
  | { status: "available"; message: string }
  | { status: "error"; message: string };

interface GithubRelease {
  tag_name?: string;
  html_url?: string;
}

export function HomeView() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const poetry = usePoetryStore((s) => s.line);
  const [platformOrder, setPlatformOrder] = useState(
    PLATFORM_CARDS.map((card) => card.to),
  );
  const [update, setUpdate] = useState<UpdateState>({
    status: "idle",
    message: "可检查 GitHub 最新发布版本",
  });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
    openUrl(GITHUB_URL).catch((err) => {
      setUpdate({ status: "error", message: `无法打开链接：${String(err)}` });
    });
  };

  const checkUpdate = async () => {
    setUpdate({ status: "checking", message: "正在检查更新..." });
    try {
      const res = await fetch(LATEST_RELEASE_URL, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!res.ok) throw new Error(`GitHub 返回 ${res.status}`);
      const data = await res.json() as GithubRelease;
      const latest = normaliseVersion(data.tag_name ?? "");
      if (!latest) throw new Error("未找到最新版本号");

      if (compareVersions(latest, CURRENT_VERSION) > 0) {
        setUpdate({
          status: "available",
          message: `发现新版本 ${latest}，当前版本 ${CURRENT_VERSION}`,
        });
        return;
      }
      setUpdate({
        status: "ok",
        message: `当前已是最新版本 ${CURRENT_VERSION}`,
      });
    } catch (err) {
      setUpdate({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
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
                     color: update.status === "error"
                       ? "var(--colorPaletteRedForeground1)"
                       : update.status === "available"
                         ? "var(--colorBrandForeground1)"
                         : "var(--colorNeutralForeground3)",
                   }}>
                {update.message}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <Button appearance="secondary" icon={<Code24Regular />} onClick={openGithub}>
                GitHub
              </Button>
              <Button appearance="secondary" icon={<DocumentText24Regular />} onClick={openGithub}>
                更新日志
              </Button>
              <Button
                appearance="primary"
                icon={<ArrowSync24Regular />}
                disabled={update.status === "checking"}
                onClick={checkUpdate}
              >
                {update.status === "checking" ? "检查中" : "检查更新"}
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function normaliseVersion(raw: string): string | null {
  const match = raw.trim().match(/^v?(\d+(?:\.\d+){0,2})/i);
  return match?.[1] ?? null;
}

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map((part) => Number.parseInt(part, 10));
  const right = b.split(".").map((part) => Number.parseInt(part, 10));
  const len = Math.max(left.length, right.length, 3);
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}
