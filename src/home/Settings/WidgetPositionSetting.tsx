import { emit } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { getSavedCorner, setSavedCorner } from "../../widget/widgetPosition";

const CORNERS = [
  { value: "top-left", label: "Alto sinistra" },
  { value: "top-right", label: "Alto destra" },
  { value: "bottom-left", label: "Basso sinistra" },
  { value: "bottom-right", label: "Basso destra" },
];

export function WidgetPositionSetting() {
  const [corner, setCorner] = useState<string | null>(null);

  useEffect(() => {
    void getSavedCorner().then(setCorner);
  }, []);

  async function choose(value: string) {
    setCorner(value);
    await setSavedCorner(value);
    // The widget window is no longer draggable, so this is the only way its
    // position ever changes — it needs telling right away rather than
    // waiting for its next launch to notice the store changed.
    await emit("widget-corner-changed");
  }

  return (
    <div className="settings-row">
      <div>
        <strong>Posizione widget</strong>
        <p>
          La finestrina del timer è fissa: scegli l'angolo dello schermo dove tenerla
          ancorata.
        </p>
      </div>
      <div className="corner-picker">
        {CORNERS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={corner === option.value ? "corner-option active" : "corner-option"}
            onClick={() => void choose(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
