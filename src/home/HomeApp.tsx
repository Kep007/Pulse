import { useState } from "react";
import { DashboardView } from "./Dashboard/DashboardView";
import { SettingsView } from "./Settings/SettingsView";
import "./home.css";

type Tab = "dashboard" | "settings";

export function HomeApp() {
  const [tab, setTab] = useState<Tab>("dashboard");

  return (
    <div className="home">
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
          className={tab === "settings" ? "home-tab active" : "home-tab"}
          onClick={() => setTab("settings")}
        >
          Impostazioni
        </button>
      </nav>
      <div className="home-content">
        {tab === "dashboard" ? <DashboardView /> : <SettingsView />}
      </div>
    </div>
  );
}
