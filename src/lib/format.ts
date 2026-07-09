export function formatElapsed(totalSeconds: number) {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = clamped % 60;

  return [hours, minutes, seconds]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
}

export function formatHoursMinutes(totalSeconds: number) {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);

  if (hours === 0 && minutes === 0) {
    return "0m";
  }

  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

// Same as formatHoursMinutes but drops down to seconds under a minute
// instead of collapsing to "0m" — used where sub-minute sessions are
// common enough that "0m" would be indistinguishable from "didn't happen"
// (e.g. individual blocks on the daily timeline).
export function formatDuration(totalSeconds: number) {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  if (clamped < 60) {
    return `${clamped}s`;
  }
  return formatHoursMinutes(clamped);
}

export function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// e.g. "4 Luglio (Sab)" — short enough for the heatmap tooltip title. The
// year is dropped since the tooltip is always about a recent, unambiguous
// date; Intl.DateTimeFormat lowercases both the month and the weekday
// abbreviation in it-IT, so both get capitalized by hand.
export function formatDateIt(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const monthName = date.toLocaleDateString("it-IT", { month: "long", timeZone: "UTC" });
  const weekday = date.toLocaleDateString("it-IT", { weekday: "short", timeZone: "UTC" });
  return `${day} ${capitalize(monthName)} (${capitalize(weekday)})`;
}

// e.g. "4 Luglio" — for a day listed inside a breakdown whose title already
// names the month/year (a "days in this month" list), so repeating the year
// would be noise.
export function formatDayMonthIt(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const monthName = date.toLocaleDateString("it-IT", { month: "long", timeZone: "UTC" });
  return `${day} ${capitalize(monthName)}`;
}

// e.g. "4 Luglio 2026" — for a day listed inside a breakdown that can span
// multiple years (an "every Saturday ever" list), where the year is load-
// bearing context.
export function formatDayMonthYearIt(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const monthName = date.toLocaleDateString("it-IT", { month: "long", timeZone: "UTC" });
  return `${day} ${capitalize(monthName)} ${year}`;
}

export function formatMonthIt(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleDateString("it-IT", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
