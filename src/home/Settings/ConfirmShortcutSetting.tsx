import { useEffect, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { formatAccelerator } from "../../lib/shortcutFormat";
import { getConfirmShortcut, setConfirmShortcut } from "../../lib/tauri";

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

export function ConfirmShortcutSetting() {
  const [shortcut, setShortcut] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [heldModifiers, setHeldModifiers] = useState<HeldModifiers>(NO_MODIFIERS);

  useEffect(() => {
    getConfirmShortcut().then(setShortcut);
  }, []);

  async function apply(accelerator: string) {
    setRecording(false);
    setHeldModifiers(NO_MODIFIERS);
    setSaving(true);
    setError(null);
    try {
      const applied = await setConfirmShortcut(accelerator);
      setShortcut(applied);
    } catch (err) {
      // Surface the backend's actual reason (e.g. "Tasto non supportato:
      // ForwardSlash", or the OS rejecting it because another app already
      // holds that combination) instead of a generic message that hides
      // which of those it actually was.
      setError(typeof err === "string" ? err : "Scorciatoia non valida o già in uso.");
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    event.preventDefault();
    if (IGNORED_CODES.has(event.code)) {
      // Only modifiers held so far — show a live "Ctrl + " preview and keep
      // waiting for the key that completes the combo.
      setHeldModifiers({
        ctrl: event.ctrlKey || event.metaKey,
        shift: event.shiftKey,
        alt: event.altKey,
      });
      return;
    }
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      // A bare key with no modifier would be registered as a system-wide
      // hotkey for that key alone — hijacking it from every other app's
      // normal typing the moment it's set.
      setError("Serve almeno un modificatore: Ctrl, Alt o Shift.");
      return;
    }

    // `code` is the physical key, independent of keyboard layout and of
    // Shift/AltGr changing what character is produced — unlike `key` (e.g.
    // on an Italian layout the physical ";" key's `key` is "è", which the
    // Rust-side parser has no entry for). `code` values (KeyA, Digit1,
    // Comma, ArrowUp, Space, F5, ...) match what that parser expects
    // natively regardless of layout.
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

  function handleMouseDown(event: MouseEvent<HTMLInputElement>) {
    if (!recording) {
      return;
    }
    // Side buttons (back/forward) work standalone, unlike keyboard keys —
    // an accidental press doesn't type into whatever else has focus the way
    // a bare letter key would, so there's no equivalent hijacking risk.
    if (event.button === 3) {
      event.preventDefault();
      void apply("Mouse4");
    } else if (event.button === 4) {
      event.preventDefault();
      void apply("Mouse5");
    }
  }

  const displayValue = recording
    ? modifierPreview(heldModifiers) || "Premi i tasti (o un tasto laterale del mouse)…"
    : (shortcut && formatAccelerator(shortcut)) ?? "…";

  return (
    <div className="settings-row">
      <div>
        <strong>Scorciatoia conferma cambio rilevato</strong>
        <p>
          Premi questa combinazione (o un tasto laterale del mouse, es. Mouse4/Mouse5)
          ovunque per confermare rapidamente un cambio di progetto/attività rilevato
          automaticamente, senza dover cliccare sul popup.
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
        onMouseDown={handleMouseDown}
      />
    </div>
  );
}
