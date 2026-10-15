import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import {
  loadState,
  computeAdaptiveGeometry,
  currentAvailRect,
  applyWindowGeometry,
  saveWindowGeometry,
} from "@/ipc/stateIo";
import {
  fetchPoetry,
  resolveCloseDecision,
  hideMainWindow,
  quitApp,
  type CloseDecision,
} from "@/ipc/shell";
import { useWindowStore } from "@/stores/windowStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useShortcutStore } from "@/stores/shortcutStore";
import { useMtkStore } from "@/stores/mtkStore";
import { useIsp6sVisualStore } from "@/stores/isp6sVisualStore";
import { usePoetryStore } from "@/stores/poetryStore";
import { useUpdateStore } from "@/stores/updateStore";
import { checkForUpdate } from "@/services/updateCheck";
import { bootstrapI18n } from "@/locales/i18n";
import { localeAt } from "@/locales";
import {
  EVT_POETRY_UPDATED,
  EVT_SHORTCUT_TRIGGERED,
  EVT_TRAY_ACTION,
} from "@/ipc/client";
import { sendNotification } from "@tauri-apps/plugin-notification";

type DebouncedVoid = (() => void) & { cancel: () => void };

interface ShellHandlers {
  onNavigate?: (path: string) => void;
  onRequestCloseAsk?: () => void; // open the "remember choice" dialog
  onPoetryChanged?: (line: string) => void;
}

/**
 * Boots the window + shell. Returns nothing; consumers wire side-effects via
 * the handlers passed in.
 */
export function useShellBootstrap(handlers: ShellHandlers) {
  const setMainWindow = useWindowStore((s) => s.setMainWindow);
  const setSettings   = useSettingsStore((s) => s.setSettings);
  const setShortcuts  = useShortcutStore((s) => s.setAll);
  const handlersRef   = useRef(handlers);
  handlersRef.current = handlers;
  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    let cancelPersist: (() => void) | undefined;
    const win = getCurrentWindow();
    const track = async (registration: Promise<() => void>) => {
      const unlisten = await registration;
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    };

    (async () => {
      /* 1. Load persistent state, hydrate stores. */
      const root = await loadState();
      if (disposed) return;
      setMainWindow(root.main_window);
      setSettings(root.settings);
      setShortcuts(root.shortcuts);
      useMtkStore.setState((s) => { s.mtk = root.mtk; });
      useIsp6sVisualStore.getState().setVisual(root.isp6s_ae_visual);
      void win.show().catch((err) => console.warn("show main window failed", err));

      /* 2. Load translations without delaying the first visible frame. */
      const lang = localeAt(root.settings.language);
      void bootstrapI18n(lang).catch((err) => console.warn("i18n bootstrap failed", err));

      /* 3. Compute & apply adaptive geometry, then reveal the window. */
      const avail = await currentAvailRect();
      if (disposed) return;
      const target = await computeAdaptiveGeometry(root.main_window, avail);
      if (disposed) return;
      await applyWindowGeometry(target);
      if (disposed) return;

      /* 4. Wire close handler: backend decision → quit / hide / ask. */
      await track(win.onCloseRequested(async (event) => {
        const decision: CloseDecision = await resolveCloseDecision();
        if (decision === "tray") {
          event.preventDefault();
          await hideMainWindow();
          try {
            await sendNotification({
              title: "LUXE",
              body:  "已最小化到托盘 · 双击托盘图标恢复",
            });
          } catch {/* notifications optional */}
        } else if (decision === "ask") {
          event.preventDefault();
          handlersRef.current.onRequestCloseAsk?.();
        } else {
          // "quit" — the tray icon keeps the process alive when only the
          // window closes (Tauri v2 doesn't auto-exit while a tray is
          // registered). Force a full process exit via app.exit(0).
          event.preventDefault();
          await quitApp().catch(() => {});
        }
      }));
      if (disposed) return;

      /* 5. Listen for global shortcut & tray events. */
      await track(listen<{ action: string }>(
        EVT_SHORTCUT_TRIGGERED,
        ({ payload }) => {
          switch (payload.action) {
            case "home":     handlersRef.current.onNavigate?.("/home");     break;
            case "settings": handlersRef.current.onNavigate?.("/settings"); break;
            case "exit":     quitApp().catch(() => {});                     break;
            case "poetry":   fetchPoetry().catch(() => {});                  break;
          }
        },
      ));
      if (disposed) return;

      await track(listen<{ kind: string }>(
        EVT_TRAY_ACTION,
        ({ payload }) => {
          switch (payload.kind) {
            case "show":           // backend already shows/focuses
              break;
            case "refresh_poetry": fetchPoetry().catch(() => {});       break;
            case "settings":       handlersRef.current.onNavigate?.("/settings"); break;
            case "quit":           // backend already exits
              break;
          }
        },
      ));
      if (disposed) return;

      await track(listen<string>(EVT_POETRY_UPDATED, ({ payload }) => {
        usePoetryStore.getState().setLine(payload);
        handlersRef.current.onPoetryChanged?.(payload);
        // Keep window title in sync too — taskbar tooltip / Alt+Tab still uses it.
        win.setTitle(`👀 ${payload}`).catch(() => {});
      }));
      if (disposed) return;

      /* 6. Persist geometry on resize / move (debounced). */
      const persist = debounceVoid(() => {
        saveWindowGeometry().catch((err) =>
          console.warn("save geom failed", err),
        );
      }, 300);
      cancelPersist = persist.cancel;
      await track(win.onResized(() => persist()));
      if (disposed) return;
      await track(win.onMoved(() => persist()));
      if (disposed) return;

      /* 7. Initial poetry fetch (don't block boot if it fails). */
      fetchPoetry().catch(() => {});

      /* 8. Startup checks only notify. Installation requires a user action. */
      if (root.settings.auto_update) {
        const updateStore = useUpdateStore.getState();
        updateStore.setChecking("startup");
        checkForUpdate()
          .then((result) => {
            useUpdateStore.getState().setResult(result, "startup");
            if (result.status === "available" && root.settings.update_notify) {
              try {
                sendNotification({
                  title: "LUXE 有新版本",
                  body: `v${result.latestVersion ?? "未知版本"} 可用，当前 v${result.currentVersion}`,
                });
              } catch {/* notifications optional */}
            }
          })
          .catch((err) => {
            useUpdateStore.getState().setError(err, "startup");
          });
      }
    })().catch((err) => {
      if (disposed) return;
      console.error("[bootstrap]", err);
      win.show().catch(() => {});
    });

    return () => {
      disposed = true;
      unlisteners.forEach((fn) => fn());
      cancelPersist?.();
    };
  }, [setMainWindow, setSettings, setShortcuts]);
}

function debounceVoid(fn: () => void, delayMs: number): DebouncedVoid {
  let timer: number | undefined;
  const debounced = (() => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      fn();
    }, delayMs);
  }) as DebouncedVoid;
  debounced.cancel = () => {
    if (timer === undefined) return;
    window.clearTimeout(timer);
    timer = undefined;
  };
  return debounced;
}
