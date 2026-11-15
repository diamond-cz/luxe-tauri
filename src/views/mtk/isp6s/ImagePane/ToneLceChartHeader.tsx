import { Button } from "@fluentui/react-components";
import { ChevronDown20Regular, ChevronUp20Regular } from "@fluentui/react-icons";
import { useTranslation } from "react-i18next";

export function ToneLceChartHeader({ title, source, expanded, controls, onToggle }: {
  title: string;
  source?: string;
  expanded: boolean;
  controls: string;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const label = t(expanded ? "tone_lce.hide_formula" : "tone_lce.show_formula", { title });
  return <div className="tone-lce-chart-header">
    <strong title={source}>{title}</strong>
    <Button appearance="subtle" size="small" icon={expanded ? <ChevronUp20Regular /> : <ChevronDown20Regular />}
      aria-label={label} title={label} aria-expanded={expanded} aria-controls={controls} onClick={onToggle}
      style={{ minWidth: 24, width: 24, height: 24, padding: 0, color: "var(--colorNeutralForeground2)" }} />
  </div>;
}
