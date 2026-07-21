import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import { formatAccelerator } from "../../lib/shortcutFormat";
import { getLockShortcut, setLockShortcut } from "../../lib/tauri";

const IGNORED_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

type HeldModifiers = { ctrl: boolean; shift: boolean; alt: boolean };
const NO_MODIFIERS: HeldModifiers = { ctrl: false, shift: false, alt: false };

function modifierPreview(held: HeldModifiers): string {
  const parts: string[] = [];
  if (held.ctrl) {
    parts.push("Ctrl");
  }
  if (held.shift) {
    parts.push("Shift");
  }
  if (held.alt) {
    parts.push("Alt");
  }
  return parts.length > 0 ? `${parts.join(" + ")} + ` : "";
}

// Keyboard-only twin of ConfirmShortcutSetting: the idle lock lives entirely
// in the keyboard hotkey path (no mouse-side-button equivalent), so this
// recorder never listens for mouse buttons.
export function LockShortcutSetting() {
  const [shortcut, setShortcut] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heldModifiers, setHeldModifiers] = useState<HeldModifiers>(NO_MODIFIERS);

  useEffect(() => {
    getLockShortcut().then(setShortcut);
  }, []);

  async function apply(accelerator: string) {
    setRecording(false);
    setHeldModifiers(NO_MODIFIERS);
    setSaving(true);
    setError(null);
    try {
      const applied = await setLockShortcut(accelerator);
      setShortcut(applied);
    } catch (err) {
      setError(typeof err === "string" ? err : "Scorciatoia non valida o già in uso.");
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.preventDefault();
    if (IGNORED_CODES.has(event.code)) {
      setHeldModifiers({
        ctrl: event.ctrlKey || event.metaKey,
        shift: event.shiftKey,
        alt: event.altKey,
      });
      return;
    }
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      setError("Serve almeno un modificatore: Ctrl, Alt o Shift.");
      return;
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
    parts.push(event.code);
    void apply(parts.join("+"));
  }

  function handleKeyUp(event: KeyboardEvent<HTMLInputElement>) {
    if (IGNORED_CODES.has(event.code)) {
      setHeldModifiers({
        ctrl: event.ctrlKey || event.metaKey,
        shift: event.shiftKey,
        alt: event.altKey,
      });
    }
  }

  const displayValue = recording
    ? modifierPreview(heldModifiers) || "Premi i tasti…"
    : (shortcut && formatAccelerator(shortcut)) ?? "…";

  return (
    <div className="settings-row">
      <div>
        <strong>Scorciatoia blocco inattività</strong>
        <p>
          Premi questa combinazione ovunque per attivare/disattivare il blocco: mentre è attivo
          Pulse non va in pausa per inattività, utile durante riunioni o mentre stai pensando.
        </p>
        {error && <p className="settings-error">{error}</p>}
      </div>
      <input
        type="text"
        className="shortcut-input"
        readOnly
        value={displayValue}
        disabled={saving}
        onFocus={() => setRecording(true)}
        onBlur={() => {
          setRecording(false);
          setHeldModifiers(NO_MODIFIERS);
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
      />
    </div>
  );
}
