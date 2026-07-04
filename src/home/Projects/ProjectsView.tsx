import { useEffect, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  archiveProject,
  createProject,
  listProjects,
  reorderProjects,
  updateProject,
} from "../../lib/tauri";
import type { ProjectDto } from "../../lib/types";

const DEFAULT_COLOR = "#2563eb";

export function ProjectsView() {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(DEFAULT_COLOR);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState(DEFAULT_COLOR);
  const [archiveTarget, setArchiveTarget] = useState<ProjectDto | null>(null);
  const [draggedId, setDraggedId] = useState<number | null>(null);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    setProjects(await listProjects());
  }

  async function handleAdd() {
    const name = newName.trim();
    if (!name) {
      return;
    }
    await createProject(name, newColor);
    setNewName("");
    setNewColor(DEFAULT_COLOR);
    await refresh();
  }

  function startEdit(project: ProjectDto) {
    setEditingId(project.id);
    setEditName(project.name);
    setEditColor(project.color ?? DEFAULT_COLOR);
  }

  async function saveEdit() {
    if (editingId === null) {
      return;
    }
    const name = editName.trim();
    if (!name) {
      return;
    }
    await updateProject(editingId, name, editColor);
    setEditingId(null);
    await refresh();
  }

  async function confirmArchive() {
    if (!archiveTarget) {
      return;
    }
    await archiveProject(archiveTarget.id);
    setArchiveTarget(null);
    await refresh();
  }

  function handleDragOver(event: DragEvent<HTMLTableRowElement>, overId: number) {
    event.preventDefault();
    if (draggedId === null || draggedId === overId) {
      return;
    }
    setProjects((current) => {
      const from = current.findIndex((project) => project.id === draggedId);
      const to = current.findIndex((project) => project.id === overId);
      if (from === -1 || to === -1) {
        return current;
      }
      const next = current.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function handleDrop() {
    if (draggedId === null) {
      return;
    }
    setDraggedId(null);
    await reorderProjects(projects.map((project) => project.id));
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      void saveEdit();
    } else if (event.key === "Escape") {
      setEditingId(null);
    }
  }

  return (
    <div className="projects-view">
      <section className="dashboard-card">
        <h2>Progetti</h2>
        <table className="projects-table">
          <tbody>
            {projects.map((project) => (
              <tr
                key={project.id}
                draggable
                className={draggedId === project.id ? "project-row dragging" : "project-row"}
                onDragStart={() => setDraggedId(project.id)}
                onDragOver={(event) => handleDragOver(event, project.id)}
                onDrop={() => void handleDrop()}
                onDragEnd={() => setDraggedId(null)}
              >
                <td className="drag-handle" title="Trascina per riordinare">
                  ⠿
                </td>
                <td className="project-color-cell">
                  <span
                    className="color-swatch"
                    style={{ background: project.color ?? "#d0d5dd" }}
                  />
                </td>
                <td className="project-name-cell">
                  {editingId === project.id ? (
                    <input
                      type="text"
                      value={editName}
                      autoFocus
                      onChange={(event) => setEditName(event.target.value)}
                      onKeyDown={handleEditKeyDown}
                    />
                  ) : (
                    <span>{project.name}</span>
                  )}
                </td>
                <td className="project-actions-cell">
                  {editingId === project.id ? (
                    <>
                      <input
                        type="color"
                        className="color-input"
                        value={editColor}
                        onChange={(event) => setEditColor(event.target.value)}
                      />
                      <button type="button" onClick={() => void saveEdit()}>
                        Salva
                      </button>
                      <button type="button" onClick={() => setEditingId(null)}>
                        Annulla
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => startEdit(project)}>
                        Modifica
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => setArchiveTarget(project)}
                      >
                        Elimina
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="add-project-row">
          <input
            type="color"
            className="color-input"
            value={newColor}
            onChange={(event) => setNewColor(event.target.value)}
          />
          <input
            type="text"
            placeholder="Nome nuovo progetto"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && void handleAdd()}
          />
          <button type="button" className="primary" onClick={() => void handleAdd()}>
            Aggiungi
          </button>
        </div>
      </section>

      {archiveTarget && (
        <ConfirmDialog
          title="Eliminare questo progetto?"
          message={`"${archiveTarget.name}" verrà nascosto dalla lista progetti e dal widget. Lo storico tracciato resterà intatto.`}
          confirmLabel="Elimina"
          onConfirm={() => void confirmArchive()}
          onCancel={() => setArchiveTarget(null)}
        />
      )}
    </div>
  );
}
