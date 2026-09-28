import { createPortal } from "react-dom";
import { useState } from "react";
import { deleteTimeEntries, saveTimeRange } from "../../lib/tauri";
import type { ProjectDto } from "../../lib/types";

export type TimeEntryDraft = {
  /** Rows being edited — empty when adding a new session. */
  ids: number[];
  projectId: number | null;
  start: string; // "HH:MM", local
  end: string;
};

type TimeEntryEditorProps = {
  date: Date;
  draft: TimeEntryDraft;
  projects: ProjectDto[];
  onClose: () => void;
};

function toIso(date: Date, hhmm: string) {
  const [hours, minutes] = hhmm.split(":").map(Number);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hours, minutes).toISOString();
}

// Saving writes the range "like a calendar": anything else recorded in it is
// trimmed away (see db::write_time_range), so the hint below says so.
export function TimeEntryEditor({ date, draft, projects, onClose }: TimeEntryEditorProps) {
  const [projectId, setProjectId] = useState<number | null>(draft.projectId ?? projects[0]?.id ?? null);
  const [start, setStart] = useState(draft.start);
  const [end, setEnd] = useState(draft.end);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isEdit = draft.ids.length > 0;
  const valid = projectId !== null && start !== "" && end !== "" && start < end;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (err) {
      setError(typeof err === "string" ? err : "Operazione non riuscita.");
    } finally {
      setBusy(false);
    }
  }

  // Portaled to <body>: rendered in place, a dialog opened from inside a
  // dashboard card was clipped by that card and sat under the pinned filter bar.
  return createPortal(
    <div className="confirm-overlay" role="presentation" onClick={onClose}>
      <div
        className="confirm-dialog export-dialog entry-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby="entry-editor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="entry-editor-title">{isEdit ? "Modifica sessione" : "Aggiungi sessione"}</h2>
        <p>
          {date.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}. Quello
          che era registrato in questo intervallo viene sostituito.
        </p>
        <label className="export-project-field">
          <span>Progetto</span>
          <select
            className="card-filter-select"
            value={projectId ?? ""}
            onChange={(event) => setProjectId(Number(event.target.value))}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <div className="export-custom-range">
          <label>
            Dalle
            <input type="time" value={start} onChange={(event) => setStart(event.target.value)} />
          </label>
          <label>
            Alle
            <input type="time" value={end} onChange={(event) => setEnd(event.target.value)} />
          </label>
        </div>
        {error && <p className="entry-editor-error">{error}</p>}
        <div className="confirm-actions">
          {isEdit && (
            <button
              type="button"
              className="danger entry-editor-delete"
              disabled={busy}
              onClick={() => void run(() => deleteTimeEntries(draft.ids))}
            >
              Elimina
            </button>
          )}
          <button type="button" className="secondary" onClick={onClose}>
            Annulla
          </button>
          <button
            type="button"
            className="primary"
            disabled={!valid || busy}
            onClick={() =>
              void run(() =>
                saveTimeRange(draft.ids, projectId, toIso(date, start), toIso(date, end)),
              )
            }
          >
            Salva
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
