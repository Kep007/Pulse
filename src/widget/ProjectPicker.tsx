import { useEffect, useRef } from "react";
import { IconCheck } from "../components/icons";
import { setActiveProject } from "../lib/tauri";
import { useProjects } from "../lib/useProjects";

type ProjectPickerProps = {
  activeProjectId: number | null;
  onClose: () => void;
};

export function ProjectPicker({ activeProjectId, onClose }: ProjectPickerProps) {
  const projects = useProjects();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose]);

  function choose(projectId: number | null) {
    void setActiveProject(projectId);
    onClose();
  }

  return (
    <div className="picker" ref={rootRef} role="listbox" aria-label="Seleziona progetto">
      <button
        type="button"
        className={activeProjectId === null ? "picker-item active" : "picker-item"}
        onClick={() => choose(null)}
      >
        <span>Nessun progetto</span>
        {activeProjectId === null && <IconCheck size={14} />}
      </button>
      {projects.map((project) => (
        <button
          key={project.id}
          type="button"
          className={project.id === activeProjectId ? "picker-item active" : "picker-item"}
          onClick={() => choose(project.id)}
        >
          <span>{project.name}</span>
          {project.id === activeProjectId && <IconCheck size={14} />}
        </button>
      ))}
    </div>
  );
}
