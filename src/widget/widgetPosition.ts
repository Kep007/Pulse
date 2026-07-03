import { LogicalPosition } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { LazyStore } from "@tauri-apps/plugin-store";

const store = new LazyStore("widget-position.json");
const MARGIN = 16;
const DEFAULT_CORNER = "bottom-right";

/** Docks the widget to its last-used screen corner (bottom-right on first run). */
export async function dockToSavedCorner(width: number, height: number) {
  const corner = (await store.get<string>("corner")) ?? DEFAULT_CORNER;
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

export async function saveCurrentCornerFromPosition() {
  const win = getCurrentWindow();
  const scale = await win.scaleFactor();
  const [physicalPosition, physicalSize, monitor] = await Promise.all([
    win.outerPosition(),
    win.outerSize(),
    currentMonitor(),
  ]);
  if (!monitor) {
    return;
  }

  const position = physicalPosition.toLogical(scale);
  const size = physicalSize.toLogical(scale);
  const monitorSize = monitor.size.toLogical(scale);
  const monitorPosition = monitor.position.toLogical(scale);

  const centerX = position.x + size.width / 2;
  const centerY = position.y + size.height / 2;
  const isRight = centerX - monitorPosition.x > monitorSize.width / 2;
  const isBottom = centerY - monitorPosition.y > monitorSize.height / 2;

  const corner = `${isBottom ? "bottom" : "top"}-${isRight ? "right" : "left"}`;
  await store.set("corner", corner);
  await store.save();
}
