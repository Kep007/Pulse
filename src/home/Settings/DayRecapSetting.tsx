import { useEffect, useState } from "react";
import { getDayRecap, setDayRecap, showDayRecapNow } from "../../lib/tauri";
import type { DayRecapSettings } from "../../lib/types";

export function DayRecapSetting() {
  const [settings, setSettings] = useState<DayRecapSettings | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function preview() {
    const shown = await showDayRecapNow();
    setNote(shown ? "Guarda accanto al widget." : "Oggi non c'è ancora tempo registrato.");
  }

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
          Dal lunedì al venerdì, all'orario scelto, compare da solo un popup accanto al widget con
          il tempo di oggi per progetto. «Rivedi» apre la Home, dove nella Timeline giornaliera puoi
          cliccare una sessione per correggerla; «OK» lo chiude.
        </p>
        {note && <p className="settings-note">{note}</p>}
      </div>
      <div className="settings-inline-controls">
        <button type="button" onClick={() => void preview()}>
          Mostra ora
        </button>
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
