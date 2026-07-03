import { useEffect, useState } from "react";
import { getAutostartStatus, setAutostart } from "../../lib/tauri";

export function AutostartToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    getAutostartStatus().then(setEnabled);
  }, []);

  async function toggle() {
    if (enabled === null || pending) {
      return;
    }

    setPending(true);
    try {
      const next = await setAutostart(!enabled);
      setEnabled(next);
    } finally {
      setPending(false);
    }
  }

  return (
    <label className="settings-row">
      <div>
        <strong>Avvio automatico</strong>
        <p>Avvia Pulse all'accensione del computer.</p>
      </div>
      <input
        type="checkbox"
        checked={enabled ?? false}
        disabled={enabled === null || pending}
        onChange={toggle}
      />
    </label>
  );
}
