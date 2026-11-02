import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@fluentui/react-components";
import {
  PanelLeftContract20Regular,
  PanelLeftExpand20Regular,
  PanelRightContract20Regular,
  PanelRightExpand20Regular,
  PanelBottomContract20Regular,
} from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";
import { Panel, PanelGroup, type ImperativePanelGroupHandle, type ImperativePanelHandle } from "react-resizable-panels";
import { ResizeHandle } from "@/components/common/ResizeHandle";
import type { WorkspaceSession } from "./workspaceSession";
import { usePanelCollapseTransition } from "./usePanelCollapseTransition";

type Side = "images" | "source" | "details";

export function WorkspaceHideButton({ side, onHide }: { side: Side; onHide: () => void }) {
  const { t } = useTranslation();
  const [highlighted, setHighlighted] = useState(false);
  const label = side === "details" ? "隐藏图片详情卡片" : t(side === "images" ? "workspace_hide_images" : "workspace_hide_source");
  return <Button size="small" appearance="subtle" title={label} aria-label={label}
    icon={side === "images" ? <PanelLeftContract20Regular /> : side === "source" ? <PanelRightContract20Regular /> : <PanelBottomContract20Regular />}
    onClick={onHide} onMouseEnter={() => setHighlighted(true)} onMouseLeave={() => setHighlighted(false)}
    onFocus={() => setHighlighted(true)} onBlur={() => setHighlighted(false)}
    style={{ width: 28, minWidth: 28, height: 28, padding: 0, flexShrink: 0,
      color: highlighted ? "var(--colorBrandForeground1)" : "var(--colorNeutralForeground2)",
      transition: "color 120ms ease" }} />;
}

/** Keep both cards mounted so collapsing never discards edits or Apply results. */
export function WorkspaceColumns({
  session, sourceSize, onSourceSizeChange, dividerId, renderImages, renderSource,
}: {
  session: WorkspaceSession;
  sourceSize: number;
  onSourceSizeChange: (size: number) => void;
  dividerId: string;
  renderImages: (hide: () => void) => ReactNode;
  renderSource: (hide: () => void) => ReactNode;
}) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<ImperativePanelGroupHandle>(null);
  const imagesRef = useRef<ImperativePanelHandle>(null);
  const sourceRef = useRef<ImperativePanelHandle>(null);
  const imagesContentRef = useRef<HTMLDivElement>(null);
  const sourceContentRef = useRef<HTMLDivElement>(null);
  const showButtonRef = useRef<HTMLButtonElement>(null);
  const focusAfterCollapseRef = useRef<"images" | "source" | null>(null);
  const expandedSourceSizeRef = useRef(sourceSize);
  const [collapsedSide, setCollapsedSide] = useState(session.collapsedWorkspaceSide);
  const [animatedPanel, setAnimatedPanel] = useState<{ side: "images" | "source"; width: number } | null>(null);
  const { transitioning, motion, collapse, expand, onTransitionEnd } = usePanelCollapseTransition();
  const initialSide = useRef(session.collapsedWorkspaceSide).current;
  useLayoutEffect(() => {
    if (!transitioning && collapsedSide && focusAfterCollapseRef.current === collapsedSide) {
      focusAfterCollapseRef.current = null;
      showButtonRef.current?.focus();
    }
  }, [collapsedSide, transitioning]);
  useLayoutEffect(() => {
    if (!transitioning && animatedPanel) setAnimatedPanel(null);
  }, [animatedPanel, transitioning]);
  const hide = (side: "images" | "source") => {
    focusAfterCollapseRef.current = side;
    const content = side === "images" ? imagesContentRef.current : sourceContentRef.current;
    setAnimatedPanel({ side, width: content?.getBoundingClientRect().width ?? 0 });
    collapse(() => (side === "images" ? imagesRef : sourceRef).current?.collapse());
  };
  const restore = () => {
    const size = expandedSourceSizeRef.current;
    if (collapsedSide) {
      const availableWidth = Math.max(0, (rootRef.current?.clientWidth ?? 0) - 12);
      const panelRatio = collapsedSide === "images" ? 100 - size : size;
      setAnimatedPanel({ side: collapsedSide, width: availableWidth * panelRatio / 100 });
    }
    expand(() => groupRef.current?.setLayout([100 - size, size]));
  };
  const showLabel = t(collapsedSide === "images" ? "workspace_show_images" : "workspace_show_source");

  return (
    <div ref={rootRef} className="relative min-h-0 w-full min-w-0 flex-1">
      <PanelGroup ref={groupRef} direction="horizontal" className="h-full w-full min-w-0"
        onLayout={(sizes) => {
          const [images, source] = sizes;
          const side = images === 0 ? "images" : source === 0 ? "source" : null;
          session.collapsedWorkspaceSide = side;
          setCollapsedSide((current) => current === side ? current : side);
          // A collapsed layout (0/100 or 100/0) must never replace the restore ratio.
          if (images >= 30 && source >= 24 && source <= 70) {
            expandedSourceSizeRef.current = source;
            onSourceSizeChange(source);
          }
        }}>
        <Panel ref={imagesRef} id="workspace-images" order={1} collapsible collapsedSize={0} minSize={30}
          defaultSize={initialSide === "images" ? 0 : initialSide === "source" ? 100 : 100 - sourceSize}
          className={`relative min-w-0 overflow-hidden ${transitioning ? "transition-[flex-grow] duration-300 ease-out motion-reduce:transition-none" : ""}`}
          onTransitionEnd={onTransitionEnd}>
          <div ref={imagesContentRef} hidden={collapsedSide === "images" && !transitioning}
            className={`h-full min-w-0 ${animatedPanel?.side === "images" && transitioning ? "absolute inset-y-0 left-0" : "w-full"}`}
            style={animatedPanel?.side === "images" && transitioning ? { width: animatedPanel.width } : undefined}>
            {renderImages(() => hide("images"))}
          </div>
        </Panel>
        <ResizeHandle id={dividerId} direction="horizontal" size={collapsedSide ? 0 : 12}
          className={`overflow-hidden ${transitioning ? "transition-[width] duration-300 ease-out motion-reduce:transition-none" : ""}`} />
        <Panel ref={sourceRef} id="workspace-source" order={2} collapsible collapsedSize={0} minSize={24}
          defaultSize={initialSide === "source" ? 0 : initialSide === "images" ? 100 : sourceSize}
          className={`relative min-w-0 overflow-hidden ${transitioning ? "transition-[flex-grow] duration-300 ease-out motion-reduce:transition-none" : ""}`}
          onTransitionEnd={onTransitionEnd}>
          <div ref={sourceContentRef} hidden={collapsedSide === "source" && !transitioning}
            className={`h-full min-w-0 ${animatedPanel?.side === "source" && transitioning ? "absolute inset-y-0 right-0" : "w-full"}`}
            style={animatedPanel?.side === "source" && transitioning ? { width: animatedPanel.width } : undefined}>
            {renderSource(() => hide("source"))}
          </div>
        </Panel>
      </PanelGroup>
      {collapsedSide && (!transitioning || motion === "expanding") && <Button ref={showButtonRef} size="small" appearance="subtle" title={showLabel} aria-label={showLabel}
        onClick={restore}
        icon={collapsedSide === "images" ? <PanelLeftExpand20Regular /> : <PanelRightExpand20Regular />}
        className={`absolute top-1/2 z-20 -translate-y-1/2 ${collapsedSide === "images" ? "left-1" : "right-1"}`}
        style={{ width: 28, minWidth: 28, height: 28, padding: 0, border: "1px solid var(--colorNeutralStroke2)",
          borderRadius: 8, background: "var(--colorNeutralBackground1)", color: "var(--colorBrandForeground1)" }} />}
    </div>
  );
}
