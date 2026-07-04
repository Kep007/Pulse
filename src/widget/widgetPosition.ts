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
  const monitorSize = monitor.size.toLogical(scale);
  const monitorPosition = monitor.position.toLogical(scale);

  const isRight = corner.includes("right");
  const isBottom = corner.includes("bottom");

  const x = isRight
    ? monitorPosition.x + monitorSize.width - width - MARGIN
    : monitorPosition.x + MARGIN;
  const y = isBottom
    ? monitorPosition.y + monitorSize.height - height - MARGIN
    : monitorPosition.y + MARGIN;

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

  const monitorSize = monitor.size.toLogical(scale);
  const monitorPosition = monitor.position.toLogical(scale);

  const minX = monitorPosition.x + MARGIN;
  const minY = monitorPosition.y + MARGIN;
  const maxX = Math.max(minX, monitorPosition.x + monitorSize.width - size.width - MARGIN);
  const maxY = Math.max(minY, monitorPosition.y + monitorSize.height - size.height - MARGIN);

  const clampedX = Math.min(Math.max(position.x, minX), maxX);
  const clampedY = Math.min(Math.max(position.y, minY), maxY);

  if (clampedX !== position.x || clampedY !== position.y) {
    await win.setPosition(new LogicalPosition(clampedX, clampedY));
  }
}

