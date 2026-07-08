import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState } from "react";
import { IconClose, IconMinimize } from "../components/icons";
import { DashboardView } from "./Dashboard/DashboardView";
import { ProjectsView } from "./Projects/ProjectsView";
import { SettingsView } from "./Settings/SettingsView";
import "./home.css";

type Tab = "dashboard" | "projects" | "settings";

export function HomeApp() {
  const [tab, setTab] = useState<Tab>("dashboard");

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
      </nav>
      <div className="home-content">
        {tab === "dashboard" && <DashboardView />}
        {tab === "projects" && <ProjectsView />}
        {tab === "settings" && <SettingsView />}
      </div>
    </div>
  );
}
