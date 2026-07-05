import { BUCKET_COLORS } from "./Heatmap";

// Scales a mark's color with its share of the largest value in the set (not
// the raw number, since what counts as "a lot" varies by user) — reusing the
// heatmap's own ramp so every chart in the dashboard reads as one visual
// language instead of each picking its own hue.
export function intensityColor(ratio: number) {
  if (ratio <= 0) {
    return BUCKET_COLORS[0];
  }
  if (ratio < 0.25) {
    return BUCKET_COLORS[1];
  }
  if (ratio < 0.5) {
    return BUCKET_COLORS[2];
  }
  if (ratio < 0.75) {
    return BUCKET_COLORS[3];
  }
  return BUCKET_COLORS[4];
}
