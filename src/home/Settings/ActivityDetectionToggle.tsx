import { useEffect, useState } from "react";
import { getActivityDetectionEnabled, setActivityDetectionEnabled } from "../../lib/tauri";

export function ActivityDetectionToggle() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    getActivityDetectionEnabled().then(setEnabled);
  }, []);

  async function toggle() {
    if (enabled === null || pending) {
      return;
    }

    setPending(true);
    try {
      const next = await setActivityDetectionEnabled(!enabled);
      setEnabled(next);
    } finally {
      setPending(false);
    }
  }

  return (
    <label className="settings-row">
      <div>
        <strong>Rilevamento attività</strong>
        <p>Riconosci automaticamente l'attività (es. Sviluppo, Design) oltre al progetto.</p>
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
