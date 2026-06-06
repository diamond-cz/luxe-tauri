import {
  Button,
  Dialog,
  DialogSurface,
} from "@fluentui/react-components";
import {
  ArrowDownload24Regular,
  Dismiss24Regular,
  Open24Regular,
} from "@fluentui/react-icons";

import {
  CURRENT_VERSION,
  GITHUB_RELEASES_URL,
  GITHUB_REPOSITORY_URL,
} from "@/services/updateCheck";

interface UpdateLogItem {
  title: string;
  desc: string;
}

interface UpdateLogSection {
  title: string;
  items: UpdateLogItem[];
}

interface UpdateLogEntry {
  version: string;
  date: string;
  sections: UpdateLogSection[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onOpenRelease: (url: string) => void;
}

const UPDATE_LOGS: UpdateLogEntry[] = [
  {
    version: "0.1.2",
    date: "2026-06-05",
    sections: [
      {
        title: "新增",
        items: [
          {
            title: "应用内更新记录",
            desc: "主页更新日志改为弹窗展示，可直接查看版本变更并跳转下载页面。",
          },
        ],
      },
      {
        title: "优化",
        items: [
          {
            title: "主页信息区",
            desc: "调整关于区域的版本、更新状态和操作入口，减少外链跳转带来的割裂感。",
          },
        ],
      },
      {
        title: "修复",
        items: [
          {
            title: "ISP6S 图片列表",
            desc: "修复图片列表状态异常，提升导入、切换和浏览过程的稳定性。",
          },
        ],
      },
    ],
  },
  {
    version: "0.1.1",
    date: "2026-06-05",
    sections: [
      {
        title: "新增",
        items: [
          {
            title: "版本发布流程",
            desc: "补齐 Tauri 打包、版本同步、GitHub Release 发布和安装包上传说明。",
          },
          {
            title: "自动检查更新",
            desc: "启动后可检查 GitHub 最新版本，并将结果同步到首页更新卡片与侧边栏提示点。",
          },
        ],
      },
      {
        title: "优化",
        items: [
          {
            title: "ISP6S 可视化工作区",
            desc: "调整参数文件、图片列表、可视化卡片和源代码卡片的布局与显示逻辑。",
          },
          {
            title: "LCE 图片能力",
            desc: "将图片、三段图相关能力归拢到图片列表卡片的 LCE 区域，并优化折线图显示。",
          },
          {
            title: "基础交互",
            desc: "优化设置界面、悬浮提示、关闭窗口行为和多处卡片细节。",
          },
        ],
      },
      {
        title: "修复",
        items: [
          {
            title: "MTK 页面中文显示",
            desc: "修复 MTK 平台页面中文乱码问题。",
          },
        ],
      },
    ],
  },
];

const SECTION_TONES: Record<string, { bg: string; border: string; fg: string }> = {
  新增: {
    bg: "rgba(45, 123, 244, 0.12)",
    border: "rgba(45, 123, 244, 0.28)",
    fg: "#2D7BF4",
  },
  优化: {
    bg: "rgba(149, 88, 193, 0.12)",
    border: "rgba(149, 88, 193, 0.3)",
    fg: "#9558C1",
  },
  修复: {
    bg: "rgba(232, 58, 58, 0.1)",
    border: "rgba(232, 58, 58, 0.24)",
    fg: "#D13438",
  },
};

function releaseUrlFor(version: string) {
  return `${GITHUB_REPOSITORY_URL}/releases/tag/v${version}`;
}

export function UpdateLogDialog({ open, onClose, onOpenRelease }: Props) {
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
          width: "min(900px, calc(100vw - 56px))",
          maxWidth: 900,
          height: "min(660px, calc(100vh - 72px))",
          maxHeight: "calc(100vh - 72px)",
          padding: 0,
          borderRadius: 18,
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
            <div className="min-w-0">
              <h2
                className="text-xl font-bold"
                style={{ color: "var(--colorNeutralForeground1)" }}
              >
                更新记录
              </h2>
              <div
                className="mt-1 truncate text-xs"
                style={{ color: "var(--colorNeutralForeground3)" }}
              >
                当前版本 v{CURRENT_VERSION} · 已收录 {UPDATE_LOGS.length} 个版本
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
            className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-7 sm:py-6"
            style={{ background: "var(--colorNeutralBackground2)" }}
          >
            <div className="flex flex-col gap-5">
              {UPDATE_LOGS.map((entry) => {
                const isCurrent = entry.version === CURRENT_VERSION;

                return (
                  <article
                    key={entry.version}
                    className="rounded-xl border px-5 py-4 shadow-sm"
                    style={{
                      background: "var(--colorNeutralBackground1)",
                      borderColor: "var(--colorNeutralStroke2)",
                    }}
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span
                          className="rounded-full border px-2.5 py-1 text-xs font-semibold"
                          style={{
                            background: isCurrent
                              ? "var(--colorBrandBackground2)"
                              : "var(--colorNeutralBackground3)",
                            borderColor: isCurrent
                              ? "var(--colorBrandStroke1)"
                              : "var(--colorNeutralStroke2)",
                            color: isCurrent
                              ? "var(--colorBrandForeground1)"
                              : "var(--colorNeutralForeground2)",
                          }}
                        >
                          v{entry.version}
                        </span>
                        <time
                          className="text-xs font-semibold"
                          dateTime={entry.date}
                          style={{ color: "var(--colorNeutralForeground4)" }}
                        >
                          {entry.date}
                        </time>
                        {isCurrent && (
                          <span
                            className="rounded-full px-2 py-0.5 text-xs font-semibold"
                            style={{
                              background: "var(--colorPaletteGreenBackground2)",
                              color: "var(--colorPaletteGreenForeground1)",
                            }}
                          >
                            当前版本
                          </span>
                        )}
                      </div>

                      <Button
                        appearance="secondary"
                        size="small"
                        icon={isCurrent ? <ArrowDownload24Regular /> : <Open24Regular />}
                        onClick={() => onOpenRelease(releaseUrlFor(entry.version))}
                      >
                        {isCurrent ? "下载此版本" : "查看版本"}
                      </Button>
                    </div>

                    <div className="mt-4 flex flex-col gap-4">
                      {entry.sections.map((section) => {
                        const tone = SECTION_TONES[section.title] ?? SECTION_TONES.优化;

                        return (
                          <section key={`${entry.version}-${section.title}`}>
                            <h3>
                              <span
                                className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold"
                                style={{
                                  background: tone.bg,
                                  borderColor: tone.border,
                                  color: tone.fg,
                                }}
                              >
                                <span
                                  aria-hidden
                                  className="h-1.5 w-1.5 rounded-full"
                                  style={{ background: tone.fg }}
                                />
                                {section.title}
                              </span>
                            </h3>
                            <ul
                              className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6"
                              style={{ color: "var(--colorNeutralForeground2)" }}
                            >
                              {section.items.map((item) => (
                                <li key={`${entry.version}-${section.title}-${item.title}`}>
                                  <span
                                    className="font-semibold"
                                    style={{ color: "var(--colorNeutralForeground1)" }}
                                  >
                                    {item.title}
                                  </span>
                                  ：{item.desc}
                                </li>
                              ))}
                            </ul>
                          </section>
                        );
                      })}
                    </div>
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
