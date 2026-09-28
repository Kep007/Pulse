import { useEffect, useState } from "react";
import { getDayRecap, setDayRecap } from "../../lib/tauri";
import type { DayRecapSettings } from "../../lib/types";

export function DayRecapSetting() {
  const [settings, setSettings] = useState<DayRecapSettings | null>(null);

  useEffect(() => {
    getDayRecap().then(setSettings);
  }, []);

  async function save(next: DayRecapSettings) {
    setSettings(next);
    setSettings(await setDayRecap(next));
  }

  return (
    <div className="settings-row">
      <div>
        <strong>Rivedi la giornata</strong>
        <p>
          Dal lunedì al venerdì, all'orario scelto, un riepilogo del tempo di oggi per progetto, da
          cui aprire la timeline e correggere quello che non torna.
        </p>
      </div>
      <div className="settings-inline-controls">
        <input
          type="time"
          className="settings-time-input"
          value={settings?.time ?? "18:00"}
          disabled={!settings?.enabled}
          onChange={(event) =>
            settings && event.target.value && void save({ ...settings, time: event.target.value })
          }
          aria-label="Orario del riepilogo"
        />
        <input
          type="checkbox"
          checked={settings?.enabled ?? false}
          disabled={settings === null}
          onChange={() => settings && void save({ ...settings, enabled: !settings.enabled })}
          aria-label="Attiva il riepilogo di fine giornata"
        />
      </div>
    </div>
  );
}
