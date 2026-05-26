import { useNavigate } from "react-router-dom";
import logo from "@/assets/luxe-logo.png";
import { useTranslation } from "react-i18next";
import { usePoetryStore } from "@/stores/poetryStore";
import { FluentIcon, type LuxeIconName } from "@/components/icons/FluentIcon";

interface PlatformCard {
  to:       string;
  icon:     LuxeIconName;
  title:    string;
  subtitle: string;
  accent:   string;
}

const CARDS: PlatformCard[] = [
  {
    to: "/mtk",
    icon: "ic_fluent_window_location_target_filled",
    title:    "MTK 平台",
    subtitle: "AE.cpp / ToneMap 解析与可视化",
    accent:   "#9558C1",
  },
  {
    to: "/qualcomm",
    icon: "ic_fluent_window_shield_filled",
    title:    "Qualcomm 平台",
    subtitle: "C++ 参数文件导入（待扩展）",
    accent:   "#2D7BF4",
  },
  {
    to: "/unisoc",
    icon: "ic_fluent_window_brush_filled",
    title:    "Unisoc 平台",
    subtitle: "C++ 参数文件导入（待扩展）",
    accent:   "#E94B7A",
  },
];

export function HomeView() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const poetry = usePoetryStore((s) => s.line);

  return (
    <div className="h-full w-full overflow-y-auto overflow-x-hidden">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-10 py-10">

        {/* ───── Hero ───── */}
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

        {/* ───── Platform quick-nav ───── */}
        <section className="flex flex-col gap-3">
          <h2 className="flex items-center gap-3 text-base font-semibold">
            <span aria-hidden className="inline-block h-4 w-1 rounded-sm"
                  style={{ background: "var(--colorBrandBackground)" }} />
            <span style={{ color: "var(--colorNeutralForeground1)" }}>平台</span>
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {CARDS.map((card) => (
              <button
                key={card.to}
                type="button"
                onClick={() => navigate(card.to)}
                className="group flex flex-col gap-3 rounded-xl border p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md"
                style={{
                  background:  "var(--colorNeutralBackground2)",
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
            ))}
          </div>
        </section>

        {/* ───── Roadmap ───── */}
        <section className="flex flex-col gap-3">
          <h2 className="flex items-center gap-3 text-base font-semibold">
            <span aria-hidden className="inline-block h-4 w-1 rounded-sm"
                  style={{ background: "var(--colorBrandBackground)" }} />
            <span style={{ color: "var(--colorNeutralForeground1)" }}>开发进度</span>
          </h2>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {ROADMAP.map(([label, status, detail]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-3 rounded-md border px-4 py-2.5"
                style={{
                  background:  "var(--colorNeutralBackground2)",
                  borderColor: "var(--colorNeutralStroke2)",
                }}
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold"
                       style={{ color: "var(--colorNeutralForeground1)" }}>
                    {label}
                  </div>
                  <div className="mt-0.5 text-xs"
                       style={{ color: "var(--colorNeutralForeground3)" }}>
                    {detail}
                  </div>
                </div>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                  style={{
                    background: status === "done" ? "#1f8a4c33" : "#ad721433",
                    color:      status === "done" ? "#3fb56c" : "#e0a23f",
                  }}
                >
                  {status === "done" ? "✓ 完成" : "进行中"}
                </span>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}

const ROADMAP: Array<[string, "done" | "wip", string]> = [
  ["M1 脚手架 + 自适应几何", "done", "Tauri + React + 多屏自适应窗口算法"],
  ["M2 主壳完整化",          "done", "16 语言 / 4 快捷键 / 托盘 / 关闭对话框 / 一句诗"],
  ["M3 cpp_parser 服务化",   "done", "tree-sitter-c + Isp6s.toml schema · 与 Python 端 7/7 一致"],
  ["M4 PageMTK 工作区",      "done", "ISP46/6S/7S 导航 + 文件导入 + 解析联动"],
  ["M5 Isp6sAeVisual 主体",  "wip",  "可视化卡片 / 拖拽 / 分栅 / 图表 / 缩略图"],
  ["M6 设置 / msi 收尾",     "wip",  "Qualcomm / Unisoc 占位 · Windows 安装包"],
];
