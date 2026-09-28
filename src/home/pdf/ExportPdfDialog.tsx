import { useState } from "react";
import { useProjects } from "../../lib/useProjects";
import { loadSavedFilter } from "../Dashboard/DashboardView";
import type { ExportOptions, ExportRange } from "./exportPdf";

type PeriodId = "all" | "year" | "months6" | "months3" | "custom";

const PERIOD_OPTIONS: { id: PeriodId; label: string }[] = [
  { id: "all", label: "Tutto lo storico" },
  { id: "year", label: "Intero anno" },
  { id: "months6", label: "Ultimi 6 mesi" },
  { id: "months3", label: "Ultimi 3 mesi" },
  { id: "custom", label: "Periodo personalizzato" },
];

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

type ExportPdfDialogProps = {
  onCancel: () => void;
  onConfirm: (options: ExportOptions) => void;
};

// Starts on whatever project the dashboard is filtered to — the usual flow
// is "I'm looking at this client, give me their report".
function initialProjectId() {
  const saved = loadSavedFilter();
  return saved.metric === "project" ? saved.filterId : null;
}

export function ExportPdfDialog({ onCancel, onConfirm }: ExportPdfDialogProps) {
  const projects = useProjects();
  const [period, setPeriod] = useState<PeriodId>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [projectId, setProjectId] = useState<number | null>(initialProjectId);

  const today = new Date();
  const todayIso = isoDate(today);
  const customValid = customFrom !== "" && customTo !== "" && customFrom <= customTo;
  const canSave = period !== "custom" || customValid;
  const selectedProjectId =
    projectId !== null && projects.some((project) => project.id === projectId) ? projectId : null;

  function resolveRange(): ExportRange | null {
    switch (period) {
      case "all":
        return null;
      case "year":
        return { from: `${today.getFullYear()}-01-01`, to: todayIso };
      case "months6":
      case "months3": {
        const from = new Date(today);
        from.setMonth(from.getMonth() - (period === "months6" ? 6 : 3));
        return { from: isoDate(from), to: todayIso };
      }
      case "custom":
        return { from: customFrom, to: customTo };
    }
  }

  return (
    <div className="confirm-overlay" role="presentation" onClick={onCancel}>
      <div
        className="confirm-dialog export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="export-dialog-title">Esporta report PDF</h2>
        <p>Scegli cosa includere nel report.</p>
        <label className="export-project-field">
          <span>Progetto</span>
          <select
            className="card-filter-select"
            value={selectedProjectId ?? "all"}
            onChange={(event) =>
              setProjectId(event.target.value === "all" ? null : Number(event.target.value))
            }
          >
            <option value="all">Tutti i progetti</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <div className="export-period-options">
          {PERIOD_OPTIONS.map((option) => (
            <label key={option.id} className="export-period-option">
              <input
                type="radio"
                name="export-period"
                checked={period === option.id}
                onChange={() => setPeriod(option.id)}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
        {period === "custom" && (
          <div className="export-custom-range">
            <label>
              Dal
              <input
                type="date"
                value={customFrom}
                max={customTo || todayIso}
                onChange={(event) => setCustomFrom(event.target.value)}
              />
            </label>
            <label>
              Al
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                max={todayIso}
                onChange={(event) => setCustomTo(event.target.value)}
              />
            </label>
          </div>
        )}
        <div className="confirm-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            Cancella
          </button>
          <button
            type="button"
            className="primary"
            disabled={!canSave}
            onClick={() => onConfirm({ range: resolveRange(), projectId: selectedProjectId })}
          >
            Salva
          </button>
        </div>
      </div>
    </div>
  );
}
