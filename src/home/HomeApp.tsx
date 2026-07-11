import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";
import { IconClose, IconMinimize, IconPdf } from "../components/icons";
import { DashboardView } from "./Dashboard/DashboardView";
import { exportPdfReport } from "./pdf/exportPdf";
import type { ExportRange } from "./pdf/exportPdf";
import { ExportPdfDialog } from "./pdf/ExportPdfDialog";
import { ProjectsView } from "./Projects/ProjectsView";
import { SettingsView } from "./Settings/SettingsView";
import "./home.css";

type Tab = "dashboard" | "projects" | "settings";

export function HomeApp() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [exporting, setExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const noteTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (noteTimer.current !== null) {
        window.clearTimeout(noteTimer.current);
      }
    };
  }, []);

  function showNote(text: string) {
    if (noteTimer.current !== null) {
      window.clearTimeout(noteTimer.current);
    }
    setExportNote(text);
    noteTimer.current = window.setTimeout(() => setExportNote(null), 4000);
  }

  async function handleExportPdf(range: ExportRange | null) {
    setExportDialogOpen(false);
    if (exporting) {
      return;
    }
    setExporting(true);
    try {
      const outcome = await exportPdfReport(range ?? undefined);
      if (outcome === "empty") {
        showNote("Nessun dato da esportare nel periodo scelto.");
      }
    } catch (error) {
      console.error("Esportazione PDF non riuscita", error);
      showNote("Errore durante l'esportazione.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="home">
      <div className="home-titlebar" data-tauri-drag-region>
        <span className="home-titlebar-title" data-tauri-drag-region>
          Pulse
        </span>
        <div className="home-titlebar-controls">
          <button
            type="button"
            className="home-titlebar-btn"
            aria-label="Riduci a icona"
            onClick={() => void getCurrentWindow().minimize()}
          >
            <IconMinimize size={14} />
          </button>
          <button
            type="button"
            className="home-titlebar-btn home-titlebar-btn-close"
            aria-label="Chiudi"
            onClick={() => void getCurrentWindow().close()}
          >
            <IconClose size={14} />
          </button>
        </div>
      </div>
      <nav className="home-tabs">
        <button
          type="button"
          className={tab === "dashboard" ? "home-tab active" : "home-tab"}
          onClick={() => setTab("dashboard")}
        >
          Dashboard
        </button>
        <button
          type="button"
          className={tab === "projects" ? "home-tab active" : "home-tab"}
          onClick={() => setTab("projects")}
        >
          Progetti
        </button>
        <button
          type="button"
          className={tab === "settings" ? "home-tab active" : "home-tab"}
          onClick={() => setTab("settings")}
        >
          Impostazioni
        </button>
        <div className="home-tabs-actions">
          {exportNote && <span className="export-pdf-note">{exportNote}</span>}
          <button
            type="button"
            className="export-pdf-button"
            onClick={() => setExportDialogOpen(true)}
            disabled={exporting}
          >
            <IconPdf size={15} />
            {exporting ? "Esportazione…" : "Esporta PDF"}
          </button>
        </div>
      </nav>
      <div className="home-content">
        {tab === "dashboard" && <DashboardView />}
        {tab === "projects" && <ProjectsView />}
        {tab === "settings" && <SettingsView />}
      </div>
      {exportDialogOpen && (
        <ExportPdfDialog
          onCancel={() => setExportDialogOpen(false)}
          onConfirm={(range) => void handleExportPdf(range)}
        />
      )}
    </div>
  );
}
