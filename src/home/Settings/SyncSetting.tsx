import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { forgetSyncToken, getSyncStatus, setSyncConfig, syncNow } from "../../lib/tauri";
import type { SyncStatus } from "../../lib/types";

function formatWhen(iso: string) {
  const date = new Date(iso);
  return date.toLocaleString("it-IT", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function SyncSetting() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [repo, setRepo] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getSyncStatus().then((value) => {
      setStatus(value);
      setRepo(value.repo ?? "");
    });
    const unlistenPromise = listen<SyncStatus>("sync-status", (event) => setStatus(event.payload));
    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
    };
  }, []);

  async function run(action: () => Promise<SyncStatus>) {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setStatus(next);
      setRepo(next.repo ?? "");
      setToken("");
    } catch (err) {
      setError(typeof err === "string" ? err : "Operazione non riuscita.");
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(status?.repo && status.hasToken);

  return (
    <div className="settings-row settings-row-stacked sync-setting">
      <label className="break-schedule-header">
        <div>
          <strong>Sincronizza tra i tuoi PC</strong>
          <p>
            Ogni PC salva le proprie sessioni in un tuo repository GitHub privato e legge quelle
            degli altri: dashboard, timeline ed export mostrano il totale di tutti i PC. I dati di
            questo PC non vengono mai modificati dalla sincronizzazione. Avviene all'avvio e ogni
            15 minuti.
          </p>
        </div>
        <input
          type="checkbox"
          checked={status?.enabled ?? false}
          disabled={status === null || busy || !ready}
          onChange={() =>
            status && void run(() => setSyncConfig(status.repo ?? "", null, !status.enabled))
          }
          aria-label="Attiva la sincronizzazione"
        />
      </label>

      <div className="sync-fields">
        <label>
          Repository
          <input
            type="text"
            placeholder="utente/pulse-sync"
            value={repo}
            onChange={(event) => setRepo(event.target.value)}
          />
        </label>
        <label>
          Token GitHub
          <input
            type="password"
            placeholder={status?.hasToken ? "Salvato ✓ (scrivi per sostituirlo)" : "github_pat_…"}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="off"
          />
        </label>
        <button
          type="button"
          disabled={busy || repo.trim() === ""}
          onClick={() => void run(() => setSyncConfig(repo, token || null, status?.enabled ?? false))}
        >
          Salva
        </button>
      </div>

      <div className="sync-footer">
        <span className={status?.lastError ? "sync-state error" : "sync-state"}>
          {status?.running
            ? "Sincronizzazione in corso…"
            : status?.lastError
              ? status.lastError
              : status?.lastSync
                ? `Ultima sincronizzazione: ${formatWhen(status.lastSync)} · questo PC: ${status.deviceName}`
                : ready
                  ? `Pronto · questo PC: ${status?.deviceName}`
                  : "Inserisci repository e token, poi Salva."}
        </span>
        <div className="sync-actions">
          {status?.hasToken && (
            <button type="button" disabled={busy} onClick={() => void run(forgetSyncToken)}>
              Rimuovi token
            </button>
          )}
          <button
            type="button"
            className="primary"
            disabled={busy || !ready || status?.running}
            onClick={() => void run(syncNow)}
          >
            Sincronizza ora
          </button>
        </div>
      </div>
      {error && <p className="settings-error">{error}</p>}
      <details className="sync-help">
        <summary>Come creare il token</summary>
        <ol>
          <li>Su GitHub: Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.</li>
          <li>Repository access: "Only select repositories" e scegli solo il repository di sincronizzazione.</li>
          <li>Permissions → Repository permissions → Contents: "Read and write".</li>
          <li>Genera, copia il token e incollalo qui (su ogni PC). Viene salvato nel Gestore credenziali di Windows.</li>
        </ol>
      </details>
    </div>
  );
}
