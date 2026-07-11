// Per-project chart colors: a fixed, pre-validated pool + assignment
// helpers. Colors are NEVER generated at runtime — arbitrary hue-wheel math
// can't guarantee colorblind-safe separation (orange and green at equal
// lightness are literally identical to a protanope). This pool was produced
// offline by a greedy max-min search over the dataviz skill validator's own
// metrics (OKLCH lightness band, chroma floor, Machado-2009 CVD ΔE under
// protanopia/deuteranopia/tritanopia AND normal vision, WCAG contrast) with
// hue-family quotas for aesthetic balance. Validated result (all-pairs mode,
// white surface): every check PASS — worst pair ΔE 13.3 (deutan) / 11.2
// (tritan) / 24.7 (normal), all 12 colors ≥ 3:1 contrast on white (WCAG
// 1.4.11), which also keeps every one of them far from the light neutral
// grays used for empty timeline stretches and the "Altro" bucket.
// "Randomizing" therefore means shuffling the ASSIGNMENT of this pool, not
// inventing new colors: every roll changes which project wears which color,
// while the set itself stays provably distinct.
//
// Order matters for the sequential fallback (projects with no stored color):
// it's interleaved so adjacent slots are also maximally far apart
// (validated in adjacent mode: same 13.3 worst pair).
export const PROJECT_COLOR_POOL = [
  "#2a78d6", // blue
  "#e34948", // red
  "#008300", // green
  "#8019e6", // purple
  "#729c11", // olive
  "#872657", // wine
  "#19a96f", // emerald
  "#c7389c", // magenta
  "#356321", // forest
  "#179bd3", // cyan
  "#7e2687", // plum
  "#4a3aa7", // violet
];

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// One color per project, all distinct while count ≤ pool size; beyond that
// the shuffled pool repeats (13+ simultaneously distinct colorblind-safe
// colors don't exist — the dataviz guidance caps identity work well below
// that, and every chart pairs color with a label/tooltip anyway).
export function randomProjectColors(count: number): string[] {
  const colors: string[] = [];
  while (colors.length < count) {
    colors.push(...shuffled(PROJECT_COLOR_POOL));
  }
  return colors.slice(0, count);
}

// Color for a newly created project: the pool color least used by existing
// projects (random among ties), so new projects stay distinct from the
// current set for as long as the pool allows.
export function pickNewProjectColor(existingColors: (string | null)[]): string {
  const usage = new Map(PROJECT_COLOR_POOL.map((color) => [color, 0]));
  for (const color of existingColors) {
    const normalized = color?.toLowerCase();
    if (normalized && usage.has(normalized)) {
      usage.set(normalized, (usage.get(normalized) ?? 0) + 1);
    }
  }
  const minUsage = Math.min(...usage.values());
  const leastUsed = PROJECT_COLOR_POOL.filter((color) => usage.get(color) === minUsage);
  return leastUsed[Math.floor(Math.random() * leastUsed.length)];
}

// The single source of truth every chart and the Progetti table must use:
// the project's stored color when present and valid, else a stable pool
// fallback by catalog position — so charts stay in sync with the swatches
// shown in the Progetti tab even before the user ever touches colors.
export function projectColorMap(
  projects: { id: number; color: string | null }[],
): Map<number, string> {
  const colors = new Map<number, string>();
  projects.forEach((project, index) => {
    colors.set(
      project.id,
      project.color && HEX_COLOR.test(project.color)
        ? project.color
        : PROJECT_COLOR_POOL[index % PROJECT_COLOR_POOL.length],
    );
  });
  return colors;
}
