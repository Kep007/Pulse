import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  archiveProject,
  createProject,
  listProjects,
  reorderProjects,
  updateProject,
} from "../../lib/tauri";
import type { ProjectDto } from "../../lib/types";

export function ProjectsView() {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<ProjectDto | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());

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
    await createProject(name, null);
    setNewName("");
    await refresh();
  }

  function startEdit(project: ProjectDto) {
    setEditingId(project.id);
    setEditName(project.name);
  }

  async function saveEdit() {
    if (editingId === null) {
      return;
    }
    const name = editName.trim();
    if (!name) {
      return;
    }
    await updateProject(editingId, name, null);
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

  function handleEditKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      void saveEdit();
    } else if (event.key === "Escape") {
      setEditingId(null);
    }
  }

  // Pointer events (not native HTML5 drag-and-drop, which WebView2 supports
  // inconsistently — dragover would fire on the row but the visual reorder
  // never actually applied) with explicit pointer capture: once captured,
  // every subsequent move/up for that pointer keeps routing to the handle
  // that started the drag, regardless of what element the cursor is
  // physically over, so hovering another row while still holding down still
  // reports moves correctly.
  function handlePointerDown(event: PointerEvent<HTMLTableCellElement>, projectId: number) {
    event.preventDefault();
    setDraggingId(projectId);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLTableCellElement>) {
    if (draggingId === null) {
      return;
    }
    let overId: number | null = null;
    for (const [id, row] of rowRefs.current) {
      const rect = row.getBoundingClientRect();
      if (event.clientY >= rect.top && event.clientY <= rect.bottom) {
        overId = id;
        break;
      }
    }
    if (overId === null || overId === draggingId) {
      return;
    }
    setProjects((current) => {
      const from = current.findIndex((project) => project.id === draggingId);
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

  async function handlePointerUp() {
    if (draggingId === null) {
      return;
    }
    setDraggingId(null);
    await reorderProjects(projects.map((project) => project.id));
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
                ref={(el) => {
                  if (el) {
                    rowRefs.current.set(project.id, el);
                  } else {
                    rowRefs.current.delete(project.id);
                  }
                }}
                className={draggingId === project.id ? "project-row dragging" : "project-row"}
              >
                <td
                  className="drag-handle"
                  title="Trascina per riordinare"
                  onPointerDown={(event) => handlePointerDown(event, project.id)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={() => void handlePointerUp()}
                >
                  ⠿
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
