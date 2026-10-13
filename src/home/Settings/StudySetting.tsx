import { useEffect, useState } from "react";
import { closeStudy, exportStudy, getStudyStatus, startStudy } from "../../lib/tauri";
import type { StudyStatus } from "../../lib/types";

const STUDY_DAYS = 31;

export function StudySetting() {
  const [status, setStatus] = useState<StudyStatus | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getStudyStatus().then(setStatus);
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setNote(null);
    try {
      await action();
    } catch (err) {
      setNote(typeof err === "string" ? err : "Operazione non riuscita.");
    } finally {
      setBusy(false);
    }
  }

  async function doExport() {
    const result = await exportStudy();
    setNote(
      result.uploadedTo
        ? `Salvato in Documenti e caricato su GitHub (${result.uploadedTo}).`
        : result.uploadError
          ? `Salvato in Documenti. Caricamento su GitHub non riuscito: ${result.uploadError}`
          : "Salvato in Documenti (sincronizzazione non configurata, nessun caricamento).",
    );
    setStatus(await getStudyStatus());
  }

  const active = status?.active ?? false;
  const remaining = status ? Math.max(0, STUDY_DAYS - status.daysElapsed) : STUDY_DAYS;

  return (
    <div className={status?.due ? "settings-row settings-row-stacked study-setting due" : "settings-row settings-row-stacked study-setting"}>
      <label className="break-schedule-header">
        <div>
          <strong>Studio del rilevamento (Fase 1)</strong>
          <p>
            Per {STUDY_DAYS} giorni Pulse registra, solo su questo PC, ogni finestra su cui ti fermi,
            cosa ha riconosciuto e quando lo correggi tu. Al {STUDY_DAYS}° giorno il registro viene
            caricato da solo nel tuo repository GitHub privato (se la sincronizzazione è
            configurata) e a ogni avvio compare un avviso rosso per passare alla Fase 2. I dati
            più vecchi di 35 giorni si cancellano da soli.
          </p>
        </div>
        <input
          type="checkbox"
          checked={active}
          disabled={status === null || busy}
          onChange={() =>
            void run(async () => setStatus(await (active ? closeStudy() : startStudy())))
          }
          aria-label="Attiva lo studio del rilevamento"
        />
      </label>
      {active && status && (
        <div className="sync-footer">
          <span className={status.due ? "sync-state error" : "sync-state"}>
            {status.due
              ? `Studio completato (${status.daysElapsed} giorni): esporta il registro e passa alla Fase 2.`
              : `Giorno ${status.daysElapsed + 1} di ${STUDY_DAYS} · mancano ${remaining} giorni · ${status.windowsLogged} finestre registrate`}
            {status.uploadedAt ? " · già caricato su GitHub" : ""}
          </span>
          <div className="sync-actions">
            <button type="button" className="primary" disabled={busy} onClick={() => void run(doExport)}>
              Esporta registro
            </button>
          </div>
        </div>
      )}
      {note && <p className="settings-note">{note}</p>}
    </div>
  );
}
