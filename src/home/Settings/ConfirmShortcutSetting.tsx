import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import { getConfirmShortcut, setConfirmShortcut } from "../../lib/tauri";

const IGNORED_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

function accelaratorFromEvent(event: KeyboardEvent<HTMLInputElement>): string | null {
  if (IGNORED_KEYS.has(event.key)) {
    return null;
  }

  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) {
    parts.push("CommandOrControl");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }
  if (event.altKey) {
    parts.push("Alt");
  }

  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  parts.push(key);
  return parts.join("+");
}

export function ConfirmShortcutSetting() {
  const [shortcut, setShortcut] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getConfirmShortcut().then(setShortcut);
  }, []);

  async function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const accelerator = accelaratorFromEvent(event);
    if (!accelerator) {
      return;
    }

    setRecording(false);
    setSaving(true);
    setError(null);
    try {
      const applied = await setConfirmShortcut(accelerator);
      setShortcut(applied);
    } catch (err) {
      setError("Scorciatoia non valida o già in uso.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-row">
      <div>
        <strong>Scorciatoia conferma cambio rilevato</strong>
        <p>
          Premi questa combinazione ovunque per confermare rapidamente un cambio di
          progetto/attività rilevato automaticamente, senza dover cliccare sul popup.
        </p>
        {error && <p className="settings-error">{error}</p>}
      </div>
      <input
        type="text"
        className="shortcut-input"
        readOnly
        value={recording ? "Premi i tasti…" : shortcut ?? "…"}
        disabled={saving}
        onFocus={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={(event) => void handleKeyDown(event)}
      />
    </div>
  );
}
