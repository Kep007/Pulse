// Fixed-order categorical palette (8 hues), validated per the dataviz skill:
// node scripts/validate_palette.js "<these 8>" --mode light → all checks
// PASS (worst adjacent CVD ΔE 24.2). Three slots (aqua, yellow, magenta) sit
// below 3:1 contrast on a light surface — the relief rule applies, so every
// consumer must pair a swatch with a visible text label, never color alone.
export const CATEGORICAL_COLORS = [
  "#2a78d6", // blue
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
  "#e87ba4", // magenta
  "#eb6834", // orange
];

// Color follows the entity, never its rank — so a filter or a re-sort must
// not repaint the survivors. `orderedIds` should be a stable ordering (e.g.
// every known project/activity id, in catalog order), not the current
// sorted-by-value display order.
export function assignCategoricalColors(orderedIds: number[]): Map<number, string> {
  const colors = new Map<number, string>();
  orderedIds.forEach((id, index) => {
    if (index < CATEGORICAL_COLORS.length) {
      colors.set(id, CATEGORICAL_COLORS[index]);
    }
  });
  return colors;
}

// Muted gray for whatever doesn't get one of the 8 fixed slots (the "Other"
// bucket beyond the series-count ladder's ceiling) — distinct from every
// categorical hue, never a generated 9th color.
export const OTHER_COLOR = "#c3c2b7";
