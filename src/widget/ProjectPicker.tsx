import { useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconCheck } from "../components/icons";
import { setActiveProject } from "../lib/tauri";
import { useProjects } from "../lib/useProjects";

type ProjectPickerProps = {
  activeProjectId: number | null;
  onClose: () => void;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// With an empty search only the projects marked "nel widget" (Progetti tab)
// are listed — the ones worked on day to day. Typing searches every project
// and its aliases, so a colleague's or an old project is still one word away.
export function ProjectPicker({ activeProjectId, onClose }: ProjectPickerProps) {
  const projects = useProjects();
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose]);

  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    if (!needle) {
      return projects.filter((project) => project.inPicker || project.id === activeProjectId);
    }
    return projects.filter((project) =>
      [project.name, ...project.aliases].some((term) => normalize(term).includes(needle)),
    );
  }, [projects, query, activeProjectId]);

  useEffect(() => setHighlight(0), [query]);

  // The widget is an always-on-top utility window that normally never takes
  // focus; it has to here, or typing would go to the app underneath.
  useEffect(() => {
    void getCurrentWindow().setFocus();
  }, []);

  const hiddenCount = query.trim() ? 0 : projects.length - visible.length;

  function choose(projectId: number | null) {
    void setActiveProject(projectId);
    onClose();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((index) => Math.min(index + 1, visible.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && visible[highlight]) {
      choose(visible[highlight].id);
    } else if (event.key === "Escape") {
      onClose();
    }
  }

  return (
    <div className="picker" ref={rootRef} role="listbox" aria-label="Seleziona progetto">
      <input
        className="picker-search"
        type="search"
        placeholder="Cerca progetto…"
        value={query}
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {!query.trim() && (
        <button
          type="button"
          className={activeProjectId === null ? "picker-item active" : "picker-item"}
          onClick={() => choose(null)}
        >
          <span>Nessun progetto</span>
          {activeProjectId === null && <IconCheck size={14} />}
        </button>
      )}
      {visible.map((project, index) => (
        <button
          key={project.id}
          type="button"
          className={[
            "picker-item",
            project.id === activeProjectId && "active",
            query.trim() && index === highlight && "highlighted",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => choose(project.id)}
        >
          <span>{project.name}</span>
          {project.id === activeProjectId && <IconCheck size={14} />}
        </button>
      ))}
      {query.trim() && visible.length === 0 && <p className="picker-empty">Nessun progetto trovato</p>}
      {hiddenCount > 0 && (
        <p className="picker-empty">Altri {hiddenCount} progetti: scrivi per cercarli</p>
      )}
    </div>
  );
}
