import { IconInfo } from "../../components/icons";
import { TooltipTrigger } from "./TooltipTrigger";

type DashboardCardTitleProps = {
  title: string;
  info: string;
};

// The "i" bubble reuses TooltipTrigger's hover/focus portal (same
// above/below auto-placement as the chart tooltips) so it behaves
// consistently, just with plain explanatory text instead of a value
// breakdown.
export function DashboardCardTitle({ title, info }: DashboardCardTitleProps) {
  return (
    <div className="dashboard-card-title">
      <h2>{title}</h2>
      <TooltipTrigger
        className="card-info-button"
        ariaLabel={`Informazioni su ${title}`}
        renderTooltip={() => (
          <div className="cell-tooltip info-tooltip">
            <p className="info-tooltip-text">{info}</p>
          </div>
        )}
      >
        <IconInfo size={14} />
      </TooltipTrigger>
    </div>
  );
}
