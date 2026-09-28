import { useState } from "react";
import { loadThemePreference, setThemePreference, type ThemePreference } from "../../lib/theme";

const OPTIONS: { id: ThemePreference; label: string }[] = [
  { id: "system", label: "Sistema" },
  { id: "light", label: "Chiaro" },
  { id: "dark", label: "Scuro" },
];

export function ThemeSetting() {
  const [preference, setPreference] = useState(loadThemePreference);

  function choose(next: ThemePreference) {
    setPreference(next);
    setThemePreference(next);
  }

  return (
    <div className="settings-row">
      <div>
        <strong>Tema</strong>
        <p>"Sistema" segue il tema chiaro/scuro di Windows.</p>
      </div>
      <div className="metric-switcher" role="radiogroup" aria-label="Tema">
        {OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={preference === option.id}
            className={preference === option.id ? "metric-tab active" : "metric-tab"}
            onClick={() => choose(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
