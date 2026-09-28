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

/** Applies the saved theme and keeps it current: "Sistema" follows Windows,
 *  and a change made in another Pulse window (they share localStorage)
 *  arrives through the storage event. */
export function initTheme() {
  const refresh = () => apply(loadThemePreference());
  refresh();
  darkQuery.addEventListener("change", refresh);
  window.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) {
      refresh();
    }
  });
}

/** Re-reads the saved preference — for windows that stay hidden between
 *  uses (the toast), in case a storage event was missed. */
export function refreshTheme() {
  apply(loadThemePreference());
}
