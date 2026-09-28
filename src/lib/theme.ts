export type ThemePreference = "system" | "light" | "dark";

const STORAGE_KEY = "pulse.theme";
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export function loadThemePreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") {
      return saved;
    }
  } catch {
    // Storage unavailable: fall back to following Windows.
  }
  return "system";
}

function apply(preference: ThemePreference) {
  const dark = preference === "dark" || (preference === "system" && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function setThemePreference(preference: ThemePreference) {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Applied for this session only.
  }
  apply(preference);
}

/** Applies the saved theme and keeps "Sistema" in step with Windows. */
export function initTheme() {
  apply(loadThemePreference());
  darkQuery.addEventListener("change", () => apply(loadThemePreference()));
}
