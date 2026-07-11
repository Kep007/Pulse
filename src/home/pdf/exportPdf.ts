import { save } from "@tauri-apps/plugin-dialog";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { capitalize, formatDayMonthYearIt, formatHoursMinutes, formatMonthIt } from "../../lib/format";
import { projectColorMap } from "../../lib/projectColors";
import {
  getActivityDetectionEnabled,
  getDailySummary,
  getMonthlySummary,
  listActivityTypes,
  listProjects,
  saveReportPdf,
} from "../../lib/tauri";
import type { BreakdownEntry, DayBucket, MonthBucket } from "../../lib/types";
import { assignCategoricalColors, OTHER_COLOR } from "../Dashboard/categoricalPalette";
import { computeEntityStats, sumAllTimeTotals } from "../Dashboard/timeAnalysis";

// Same lower bound the dashboard uses: the summary commands only return
// buckets that actually contain data, so this is a safe "everything ever".
const ALL_TIME_FROM = "2000-01-01";

// Beyond this many slices the pie becomes unreadable; the rest is grouped
// into "Altro", mirroring the dashboard's own breakdown behavior.
const MAX_PIE_SLICES = 8;
const CHART_MONTHS = 12;

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 16;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const FOOTER_Y = PAGE_HEIGHT - 10;
// Content must stop above the footer line, or the last row of a section
// overlaps the page number.
const CONTENT_BOTTOM = FOOTER_Y - 8;

const INK: [number, number, number] = [16, 24, 40]; // #101828
const MUTED: [number, number, number] = [102, 112, 133]; // #667085
const BORDER: [number, number, number] = [226, 232, 240]; // #e2e8f0
const CARD_BG: [number, number, number] = [248, 250, 252]; // #f8fafc
const ACCENT: [number, number, number] = [42, 120, 214]; // #2a78d6
const FALLBACK_SLICE = "#98a2b3";

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ];
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function percentLabel(seconds: number, total: number) {
  return `${Math.round((seconds / total) * 100)}%`;
}

type PieSlice = { label: string; seconds: number; color: string };

/** Draws the pie on an offscreen canvas at 4x the printed size, so it stays
 *  crisp in the PDF. White separators between slices, percentage labels
 *  inside the big ones. */
function renderPieChart(slices: PieSlice[]): string {
  const size = 640;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D non disponibile");
  }

  const total = slices.reduce((sum, slice) => sum + slice.seconds, 0);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 14;

  let angle = -Math.PI / 2;
  for (const slice of slices) {
    const sweep = (slice.seconds / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, angle, angle + sweep);
    ctx.closePath();
    ctx.fillStyle = slice.color;
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    angle += sweep;
  }

  // Percentage labels, only where the slice is wide enough to host them.
  angle = -Math.PI / 2;
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 34px Helvetica, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const slice of slices) {
    const share = slice.seconds / total;
    const sweep = share * Math.PI * 2;
    if (share >= 0.055) {
      const mid = angle + sweep / 2;
      ctx.fillText(
        `${Math.round(share * 100)}%`,
        cx + Math.cos(mid) * radius * 0.62,
        cy + Math.sin(mid) * radius * 0.62,
      );
    }
    angle += sweep;
  }

  return canvas.toDataURL("image/png");
}

/** Monthly bar chart (last CHART_MONTHS months with data). */
function renderBarChart(months: { label: string; seconds: number }[]): string {
  const width = 1424;
  const height = 480;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D non disponibile");
  }

  const top = 60;
  const bottom = height - 56;
  const left = 16;
  const right = width - 16;
  const max = Math.max(...months.map((month) => month.seconds), 1);
  const slot = (right - left) / months.length;
  const barWidth = Math.min(slot * 0.58, 96);

  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.stroke();

  ctx.textAlign = "center";
  months.forEach((month, index) => {
    const x = left + slot * index + slot / 2;
    const barHeight = Math.max((month.seconds / max) * (bottom - top), 3);

    ctx.fillStyle = "#2a78d6";
    ctx.fillRect(x - barWidth / 2, bottom - barHeight, barWidth, barHeight);

    ctx.fillStyle = "#344054";
    ctx.font = "bold 24px Helvetica, Arial, sans-serif";
    ctx.fillText(formatHoursMinutes(month.seconds), x, bottom - barHeight - 16);

    ctx.fillStyle = "#667085";
    ctx.font = "24px Helvetica, Arial, sans-serif";
    ctx.fillText(month.label, x, bottom + 34);
  });

  return canvas.toDataURL("image/png");
}

/** "Lug 25" — compact month tick for the bar chart. */
function shortMonthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, 1));
  const name = date.toLocaleDateString("it-IT", { month: "short", timeZone: "UTC" });
  return `${capitalize(name.replace(".", ""))} ${String(year).slice(2)}`;
}

function topEntryOf(entries: BreakdownEntry[]): BreakdownEntry | null {
  let best: BreakdownEntry | null = null;
  for (const entry of entries) {
    if (entry.seconds > 0 && (best === null || entry.seconds > best.seconds)) {
      best = entry;
    }
  }
  return best;
}

export type ExportOutcome = "saved" | "cancelled" | "empty";

export type ExportRange = { from: string; to: string };

/** `range` omesso = tutto lo storico. Everything in the report derives from
 *  the daily/monthly buckets, so narrowing the fetch window is all it takes
 *  to scope the whole document. */
export async function exportPdfReport(range?: ExportRange): Promise<ExportOutcome> {
  const today = isoDate(new Date());
  const from = range?.from ?? ALL_TIME_FROM;
  const to = range?.to ?? today;
  const [daily, monthly, projects, activityTypes, activityEnabled] = await Promise.all([
    getDailySummary(from, to),
    getMonthlySummary(from, to),
    listProjects(),
    listActivityTypes(),
    getActivityDetectionEnabled(),
  ]);

  const projectTotals = sumAllTimeTotals(daily, "project").filter((entry) => entry.seconds > 0);
  if (projectTotals.length === 0 || monthly.length === 0) {
    return "empty";
  }

  // Ask where to save *before* the (slower) rendering work — cancelling
  // costs nothing.
  const path = await save({
    title: "Esporta report PDF",
    defaultPath: `Pulse-report-${today}.pdf`,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!path) {
    return "cancelled";
  }

  const doc = buildReport({ daily, monthly, projects, activityTypes, activityEnabled, projectTotals });
  const bytes = new Uint8Array(doc.output("arraybuffer"));
  await saveReportPdf(path, Array.from(bytes));
  return "saved";
}

type ReportInput = {
  daily: DayBucket[];
  monthly: MonthBucket[];
  projects: { id: number; name: string; color: string | null }[];
  activityTypes: { id: number; name: string }[];
  activityEnabled: boolean;
  projectTotals: BreakdownEntry[];
};

function buildReport(input: ReportInput): jsPDF {
  const { daily, monthly, projects, activityTypes, activityEnabled, projectTotals } = input;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let cursorY = MARGIN;

  const projectColors = projectColorMap(projects);
  const activityColors = assignCategoricalColors(activityTypes.map((activity) => activity.id));
  const colorOf = (entry: BreakdownEntry, palette: Map<number, string>) =>
    palette.get(entry.id) ?? entry.color ?? FALLBACK_SLICE;

  const grandTotal = projectTotals.reduce((sum, entry) => sum + entry.seconds, 0);
  const overall = computeEntityStats(daily, monthly, "project", null);
  const dates = daily.filter((bucket) => bucket.totalSeconds > 0).map((bucket) => bucket.date);
  const firstDate = dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b)) : null;
  const lastDate = dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : null;

  function ensureSpace(height: number) {
    if (cursorY + height > CONTENT_BOTTOM) {
      doc.addPage();
      cursorY = MARGIN;
    }
  }

  function sectionTitle(text: string) {
    ensureSpace(18);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...INK);
    doc.text(text, MARGIN, cursorY + 5);
    cursorY += 9;
  }

  // ---- Header -------------------------------------------------------------
  doc.setFont("helvetica", "bold");
  doc.setFontSize(21);
  doc.setTextColor(...INK);
  doc.text("Report attività", MARGIN, cursorY + 7);
  doc.setTextColor(...ACCENT);
  doc.text("Pulse", PAGE_WIDTH - MARGIN, cursorY + 7, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  const now = new Date();
  const generatedAt = `${formatDayMonthYearIt(isoDate(now))} alle ${now
    .getHours()
    .toString()
    .padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  const period =
    firstDate && lastDate
      ? `Periodo: ${formatDayMonthYearIt(firstDate)} – ${formatDayMonthYearIt(lastDate)}`
      : "Tutto lo storico";
  doc.text(`${period}  ·  Generato il ${generatedAt}`, MARGIN, cursorY + 14);

  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, cursorY + 18, PAGE_WIDTH - MARGIN, cursorY + 18);
  cursorY += 24;

  // ---- Riepilogo ----------------------------------------------------------
  sectionTitle("Riepilogo");

  const stats: { label: string; value: string; sub?: string }[] = [
    {
      label: "Tempo totale",
      value: formatHoursMinutes(overall.totalSeconds),
      sub:
        firstDate && lastDate
          ? `${formatDayMonthYearIt(firstDate)} – ${formatDayMonthYearIt(lastDate)}`
          : undefined,
    },
    { label: "Progetti tracciati", value: String(projectTotals.length) },
    { label: "Giorni attivi", value: String(overall.activeDays) },
  ];

  const cardGap = 4;
  const cardWidth = (CONTENT_WIDTH - cardGap * 2) / 3;
  const cardHeight = 22;
  ensureSpace(cardHeight);
  stats.forEach((stat, index) => {
    const x = MARGIN + index * (cardWidth + cardGap);
    const y = cursorY;

    doc.setFillColor(...CARD_BG);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, cardWidth, cardHeight, 2, 2, "FD");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(stat.label, x + 5, y + 6.5);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12.5);
    doc.setTextColor(...INK);
    doc.text(stat.value, x + 5, y + 13.5);

    if (stat.sub) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(stat.sub, x + 5, y + 18.5);
    }
  });
  cursorY += cardHeight + cardGap;

  // Full-width row: the most demanding project, with its own insights.
  const topProject = projectTotals[0];
  const topStats = computeEntityStats(daily, monthly, "project", topProject.id);
  const monthsActive = monthly.filter((bucket) =>
    bucket.byProject.some((entry) => entry.id === topProject.id && entry.seconds > 0),
  ).length;
  const monthlyAverage = monthsActive > 0 ? topStats.totalSeconds / monthsActive : 0;
  let hardestDay: { date: string; seconds: number } | null = null;
  for (const bucket of daily) {
    const entry = bucket.byProject.find((item) => item.id === topProject.id);
    if (entry && entry.seconds > 0 && (hardestDay === null || entry.seconds > hardestDay.seconds)) {
      hardestDay = { date: bucket.date, seconds: entry.seconds };
    }
  }

  const rowHeight = 29;
  ensureSpace(rowHeight);
  doc.setFillColor(...CARD_BG);
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.25);
  doc.roundedRect(MARGIN, cursorY, CONTENT_WIDTH, rowHeight, 2, 2, "FD");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("Progetto più impegnativo", MARGIN + 5, cursorY + 6.5);

  const [dotR, dotG, dotB] = hexToRgb(colorOf(topProject, projectColors));
  doc.setFillColor(dotR, dotG, dotB);
  doc.circle(MARGIN + 7, cursorY + 12.3, 1.8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  doc.setTextColor(...INK);
  doc.text(topProject.name, MARGIN + 11, cursorY + 13.7);

  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  doc.text(
    `${formatHoursMinutes(topProject.seconds)}  ·  ${percentLabel(topProject.seconds, grandTotal)} del totale`,
    MARGIN + CONTENT_WIDTH - 5,
    cursorY + 13.7,
    { align: "right" },
  );

  const miniStats: { label: string; value: string }[] = [
    { label: "Media mensile", value: formatHoursMinutes(monthlyAverage) },
    { label: "Media giornaliera", value: formatHoursMinutes(topStats.avgSecondsPerActiveDay) },
    {
      label: "Mese più impegnativo",
      value: topStats.bestMonth
        ? `${capitalize(formatMonthIt(topStats.bestMonth.month))} · ${formatHoursMinutes(topStats.bestMonth.seconds)}`
        : "—",
    },
    {
      label: "Giorno più impegnativo",
      value: hardestDay
        ? `${formatDayMonthYearIt(hardestDay.date)} · ${formatHoursMinutes(hardestDay.seconds)}`
        : "—",
    },
  ];
  // Columns sized on their real text width so the *gaps* between them come
  // out equal — fixed equal-width slots leave visibly uneven whitespace.
  const miniWidths = miniStats.map((mini) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    const labelWidth = doc.getTextWidth(mini.label);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    return Math.max(labelWidth, doc.getTextWidth(mini.value));
  });
  const miniGap =
    (CONTENT_WIDTH - 10 - miniWidths.reduce((sum, width) => sum + width, 0)) /
    (miniStats.length - 1);
  let miniX = MARGIN + 5;
  miniStats.forEach((mini, index) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text(mini.label, miniX, cursorY + 20.5);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    doc.text(mini.value, miniX, cursorY + 25.5);

    miniX += miniWidths[index] + miniGap;
  });

  cursorY += rowHeight + 10;

  // ---- Ripartizione del tempo (torta progetti) ----------------------------
  drawPieSection(
    "Ripartizione del tempo per progetto",
    projectTotals.map((entry) => ({
      label: entry.name,
      seconds: entry.seconds,
      color: colorOf(entry, projectColors),
    })),
  );

  // ---- Torta attività (solo se la rilevazione attività è in uso) ----------
  if (activityEnabled) {
    const activityTotals = sumAllTimeTotals(daily, "activity").filter((entry) => entry.seconds > 0);
    if (activityTotals.length > 0) {
      drawPieSection(
        "Ripartizione del tempo per attività",
        activityTotals.map((entry) => ({
          label: entry.name,
          seconds: entry.seconds,
          color: colorOf(entry, activityColors),
        })),
      );
    }
  }

  function drawPieSection(title: string, entries: PieSlice[]) {
    const slices =
      entries.length > MAX_PIE_SLICES
        ? [
            ...entries.slice(0, MAX_PIE_SLICES),
            {
              label: "Altro",
              seconds: entries.slice(MAX_PIE_SLICES).reduce((sum, entry) => sum + entry.seconds, 0),
              color: OTHER_COLOR,
            },
          ]
        : entries;
    const total = slices.reduce((sum, slice) => sum + slice.seconds, 0);

    const pieSize = 72;
    const legendLine = 7;
    const blockHeight = Math.max(pieSize, slices.length * legendLine) + 6;
    ensureSpace(blockHeight + 12);
    sectionTitle(title);

    const pieX = MARGIN;
    const pieY = cursorY + 2;
    doc.addImage(renderPieChart(slices), "PNG", pieX, pieY, pieSize, pieSize);

    const legendX = MARGIN + pieSize + 12;
    const legendWidth = CONTENT_WIDTH - pieSize - 12;
    const legendHeight = slices.length * legendLine;
    let legendY = pieY + Math.max(0, (pieSize - legendHeight) / 2) + 4;
    for (const slice of slices) {
      const [r, g, b] = hexToRgb(slice.color);
      doc.setFillColor(r, g, b);
      doc.roundedRect(legendX, legendY - 3, 3.6, 3.6, 0.8, 0.8, "F");

      const amount = `${formatHoursMinutes(slice.seconds)}  ·  ${percentLabel(slice.seconds, total)}`;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(...MUTED);
      doc.text(amount, legendX + legendWidth, legendY, { align: "right" });

      const amountWidth = doc.getTextWidth(amount);
      let name = slice.label;
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...INK);
      const maxNameWidth = legendWidth - amountWidth - 10;
      while (doc.getTextWidth(name) > maxNameWidth && name.length > 3) {
        name = `${name.slice(0, -2).trimEnd()}…`;
      }
      doc.text(name, legendX + 6, legendY);

      legendY += legendLine;
    }

    cursorY = pieY + blockHeight + 6;
  }

  // ---- Insights per progetto ----------------------------------------------
  sectionTitle("Insights per progetto");

  const projectRows = projectTotals.map((entry) => {
    const stats = computeEntityStats(daily, monthly, "project", entry.id);
    return {
      color: colorOf(entry, projectColors),
      cells: [
        entry.name,
        formatHoursMinutes(stats.totalSeconds),
        percentLabel(stats.totalSeconds, grandTotal),
        String(stats.activeDays),
        formatHoursMinutes(stats.avgSecondsPerActiveDay),
        stats.bestMonth
          ? `${capitalize(formatMonthIt(stats.bestMonth.month))} (${formatHoursMinutes(stats.bestMonth.seconds)})`
          : "—",
      ],
    };
  });

  autoTable(doc, {
    startY: cursorY,
    margin: { left: MARGIN, right: MARGIN, bottom: PAGE_HEIGHT - CONTENT_BOTTOM },
    head: [["Progetto", "Tempo totale", "Quota", "Giorni attivi", "Media giornaliera", "Mese più impegnativo"]],
    body: projectRows.map((row) => row.cells),
    styles: {
      font: "helvetica",
      fontSize: 8.5,
      textColor: INK,
      cellPadding: { top: 2.4, bottom: 2.4, left: 2.5, right: 2.5 },
      lineColor: BORDER,
      lineWidth: 0.15,
    },
    headStyles: { fillColor: [242, 244, 247], textColor: [52, 64, 84], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [252, 253, 254] },
    columnStyles: {
      0: { fontStyle: "bold", cellPadding: { top: 2.4, bottom: 2.4, left: 7, right: 2.5 } },
    },
    didDrawCell: (data) => {
      if (data.section === "body" && data.column.index === 0) {
        const [r, g, b] = hexToRgb(projectRows[data.row.index].color);
        doc.setFillColor(r, g, b);
        doc.circle(data.cell.x + 3.4, data.cell.y + data.cell.height / 2, 1.4, "F");
      }
    },
  });
  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

  // ---- Insights mensili -----------------------------------------------------
  sectionTitle("Insights mensili");

  const chartMonths = monthly.slice(-CHART_MONTHS).map((bucket) => ({
    label: shortMonthLabel(bucket.month),
    seconds: bucket.totalSeconds,
  }));
  const chartHeight = (CONTENT_WIDTH * 480) / 1424;
  ensureSpace(chartHeight + 6);
  doc.addImage(renderBarChart(chartMonths), "PNG", MARGIN, cursorY, CONTENT_WIDTH, chartHeight);
  cursorY += chartHeight + 6;

  const monthRows = monthly.map((bucket, index) => {
    const previous = index > 0 ? monthly[index - 1] : null;
    let delta = "—";
    let deltaSign = 0;
    if (previous && previous.totalSeconds > 0) {
      const ratio = (bucket.totalSeconds - previous.totalSeconds) / previous.totalSeconds;
      const rounded = Math.round(ratio * 100);
      deltaSign = Math.sign(rounded);
      delta = `${rounded > 0 ? "+" : ""}${rounded}%`;
    }
    const top = topEntryOf(bucket.byProject);
    return {
      deltaSign,
      cells: [
        capitalize(formatMonthIt(bucket.month)),
        formatHoursMinutes(bucket.totalSeconds),
        top ? `${top.name} (${formatHoursMinutes(top.seconds)})` : "—",
        delta,
      ],
    };
  });
  monthRows.reverse(); // newest first

  autoTable(doc, {
    startY: cursorY,
    margin: { left: MARGIN, right: MARGIN, bottom: PAGE_HEIGHT - CONTENT_BOTTOM },
    head: [["Mese", "Tempo totale", "Progetto principale", "Vs mese precedente"]],
    body: monthRows.map((row) => row.cells),
    styles: {
      font: "helvetica",
      fontSize: 8.5,
      textColor: INK,
      cellPadding: { top: 2.4, bottom: 2.4, left: 2.5, right: 2.5 },
      lineColor: BORDER,
      lineWidth: 0.15,
    },
    headStyles: { fillColor: [242, 244, 247], textColor: [52, 64, 84], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [252, 253, 254] },
    columnStyles: { 0: { fontStyle: "bold" } },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 3) {
        const sign = monthRows[data.row.index].deltaSign;
        if (sign > 0) {
          data.cell.styles.textColor = [7, 118, 66]; // green
        } else if (sign < 0) {
          data.cell.styles.textColor = [180, 35, 24]; // red
        }
      }
    },
  });

  // ---- Footer (every page) --------------------------------------------------
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text("Generato da Pulse", MARGIN, FOOTER_Y);
    doc.text(`Pagina ${page} di ${pageCount}`, PAGE_WIDTH - MARGIN, FOOTER_Y, { align: "right" });
  }

  return doc;
}
