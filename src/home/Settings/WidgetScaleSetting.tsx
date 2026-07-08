import { emit } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { getSavedScale, setSavedScale } from "../../widget/widgetPosition";

const MIN_SCALE = 0.75;
const MAX_SCALE = 1.5;
const STEP = 0.05;

export function WidgetScaleSetting() {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    void getSavedScale().then(setScale);
  }, []);

  async function choose(value: number) {
    setScale(value);
    await setSavedScale(value);
    // The widget is a live window, not a page reload — it needs telling
    // right away, same as widget-corner-changed above.
    await emit("widget-scale-changed", value);
  }

  return (
    <div className="settings-row">
      <div>
        <strong>Dimensione widget</strong>
        <p>Ingrandisci o rimpicciolisci la finestrina del timer.</p>
      </div>
      <div className="scale-picker">
        <input
          type="range"
          min={MIN_SCALE}
          max={MAX_SCALE}
          step={STEP}
          value={scale}
          onChange={(event) => void choose(Number(event.target.value))}
        />
        <span className="scale-value">{Math.round(scale * 100)}%</span>
      </div>
    </div>
  );
}
