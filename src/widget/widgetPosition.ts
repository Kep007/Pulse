import type { Monitor } from "@tauri-apps/api/window";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { availableMonitors, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { LazyStore } from "@tauri-apps/plugin-store";

const store = new LazyStore("widget-position.json");
const MARGIN = 16;
const DEFAULT_CORNER = "bottom-right";

export async function getSavedCorner(): Promise<string> {
  return (await store.get<string>("corner")) ?? DEFAULT_CORNER;
}

export async function setSavedCorner(corner: string) {
  await store.set("corner", corner);
  await store.save();
}

const DEFAULT_SCALE = 1;

/** Widget size multiplier (CSS transform, not a layout change — see App.tsx). */
export async function getSavedScale(): Promise<number> {
  return (await store.get<number>("scale")) ?? DEFAULT_SCALE;
}

export async function setSavedScale(scale: number) {
  await store.set("scale", scale);
  await store.save();
}

/** Docks the widget to its last-used screen corner (bottom-right on first run). */
export async function dockToSavedCorner(width: number, height: number) {
  const corner = await getSavedCorner();
  await positionAtCorner(corner, width, height);
}

async function positionAtCorner(corner: string, width: number, height: number) {
  const monitor = await currentMonitor();
  if (!monitor) {
    return;
  }

  const scale = await getCurrentWindow().scaleFactor();
  // `workArea` excludes the taskbar (unlike the monitor's full bounds) — a
  // "bottom" corner anchored to the raw monitor height lands the widget
  // right where the taskbar sits, so it ends up covered by it.
  const workAreaSize = monitor.workArea.size.toLogical(scale);
  const workAreaPosition = monitor.workArea.position.toLogical(scale);

  const isRight = corner.includes("right");
  const isBottom = corner.includes("bottom");

  const x = isRight
    ? workAreaPosition.x + workAreaSize.width - width - MARGIN
    : workAreaPosition.x + MARGIN;
  const y = isBottom
    ? workAreaPosition.y + workAreaSize.height - height - MARGIN
    : workAreaPosition.y + MARGIN;

  await getCurrentWindow().setPosition(new LogicalPosition(x, y));
}

/**
 * `currentMonitor()` returns null once the window's origin falls in a gap
 * that belongs to no monitor — e.g. below a short monitor that sits beside a
 * taller one. Falls back to whichever monitor is geometrically closest to
 * the window so it always has somewhere to clamp back onto.
 */
async function findNearestMonitor(x: number, y: number, scale: number): Promise<Monitor | null> {
  const direct = await currentMonitor();
  if (direct) {
    return direct;
  }

  const monitors = await availableMonitors();
  let closest: Monitor | null = null;
  let closestDistance = Infinity;

  for (const monitor of monitors) {
    const size = monitor.size.toLogical(scale);
    const position = monitor.position.toLogical(scale);
    const dx = Math.max(position.x - x, 0, x - (position.x + size.width));
    const dy = Math.max(position.y - y, 0, y - (position.y + size.height));
    const distance = dx * dx + dy * dy;
    if (distance < closestDistance) {
      closestDistance = distance;
      closest = monitor;
    }
  }

  return closest;
}

/**
 * Pulls the widget back onto a real monitor if it's drifted off every
 * screen — e.g. unplugging the monitor it was docked to — so it always has
 * somewhere to land. Keeps a margin so it never sits flush against (or
 * past) the edge.
 */
export async function clampToScreen() {
  const win = getCurrentWindow();
  const scale = await win.scaleFactor();
  const [physicalPosition, physicalSize] = await Promise.all([win.outerPosition(), win.outerSize()]);
  const position = physicalPosition.toLogical(scale);
  const size = physicalSize.toLogical(scale);

  const monitor = await findNearestMonitor(position.x, position.y, scale);
  if (!monitor) {
    return;
  }

  const workAreaSize = monitor.workArea.size.toLogical(scale);
  const workAreaPosition = monitor.workArea.position.toLogical(scale);

  const minX = workAreaPosition.x + MARGIN;
  const minY = workAreaPosition.y + MARGIN;
  const maxX = Math.max(minX, workAreaPosition.x + workAreaSize.width - size.width - MARGIN);
  const maxY = Math.max(minY, workAreaPosition.y + workAreaSize.height - size.height - MARGIN);

  const clampedX = Math.min(Math.max(position.x, minX), maxX);
  const clampedY = Math.min(Math.max(position.y, minY), maxY);

  if (clampedX !== position.x || clampedY !== position.y) {
    await win.setPosition(new LogicalPosition(clampedX, clampedY));
  }
}

