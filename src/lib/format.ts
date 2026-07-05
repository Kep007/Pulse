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

function capitalize(text: string) {
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

export function formatMonthIt(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  return date.toLocaleDateString("it-IT", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}
