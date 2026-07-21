import { useEffect, useState } from "react";
import { getIdleTimeout, setIdleTimeout } from "../../lib/tauri";

// Presets in seconds. The backend clamps anything outside 30s–1h, but the UI
// only ever offers this list.
const OPTIONS: { seconds: number; label: string }[] = [
  { seconds: 60, label: "1 minuto" },
  { seconds: 120, label: "2 minuti" },
  { seconds: 180, label: "3 minuti" },
  { seconds: 300, label: "5 minuti" },
  { seconds: 600, label: "10 minuti" },
  { seconds: 900, label: "15 minuti" },
  { seconds: 1800, label: "30 minuti" },
];

export function IdleTimeoutSetting() {
  const [seconds, setSeconds] = useState<number | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    getIdleTimeout().then(setSeconds);
  }, []);

  async function handleChange(next: number) {
    if (pending) {
      return;
    }
    setPending(true);
    try {
      const applied = await setIdleTimeout(next);
      setSeconds(applied);
    } finally {
      setPending(false);
    }
  }

  // A stored value that isn't one of the presets (an older custom setting)
  // still needs to appear selected rather than silently snapping the picker
  // to the first option.
  const showsCustom = seconds !== null && !OPTIONS.some((option) => option.seconds === seconds);

  return (
    <label className="settings-row">
      <div>
        <strong>Inattività dopo</strong>
        <p>
          Dopo quanto tempo senza tastiera/mouse Pulse smette di conteggiare il tempo. Il blocco
          inattività ignora comunque questo limite finché è attivo.
        </p>
      </div>
      <select
        className="card-filter-select"
        value={seconds ?? ""}
        disabled={seconds === null || pending}
        onChange={(event) => void handleChange(Number(event.target.value))}
      >
        {showsCustom && seconds !== null && (
          <option value={seconds}>{Math.round(seconds / 60)} min</option>
        )}
        {OPTIONS.map((option) => (
          <option key={option.seconds} value={option.seconds}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
