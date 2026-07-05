import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { listProjects } from "./tauri";
import type { ProjectDto } from "./types";

// Refetches whenever the Progetti tab creates/renames/archives/reorders a
// project ("catalog-changed", emitted from src-tauri/src/commands/projects.rs),
// so other already-mounted consumers — the widget's ProjectPicker, the
// dashboard's filter dropdowns — don't keep showing a stale list until they
// happen to remount (switching tabs, closing/reopening the picker).
export function useProjects() {
  const [projects, setProjects] = useState<ProjectDto[]>([]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    function refresh() {
      listProjects().then((next) => {
        if (!cancelled) {
          setProjects(next);
        }
      });
    }

    refresh();
    listen("catalog-changed", refresh).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return projects;
}
