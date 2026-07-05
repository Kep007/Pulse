import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  archiveProject,
  createProject,
  listProjects,
  reorderProjects,
  setProjectAliases,
  updateProject,
} from "../../lib/tauri";
import type { ProjectDto } from "../../lib/types";

// Splits "sidial, sdl , SID" into ["sidial", "sdl", "SID"], dropping blanks
// left over from stray/trailing commas.
function parseAliasesText(text: string) {
  return text
    .split(",")
    .map((alias) => alias.trim())
    .filter((alias) => alias.length > 0);
}

const REFLOW_TRANSITION = "transform 180ms ease";

type DragState = {
  id: number;
  startIndex: number;
  startY: number;
  rowHeight: number;
};

export function ProjectsView() {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editAliasesText, setEditAliasesText] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<ProjectDto | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());
  const projectsRef = useRef<ProjectDto[]>([]);
  const dragRef = useRef<DragState | null>(null);
  // Rects captured just before a reorder, so the layout effect below can
  // measure how far each row actually jumped and animate away that jump —
  // the classic FLIP technique (First, Last, Invert, Play).
  const preReorderRects = useRef(new Map<number, DOMRect>());

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

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
    setEditAliasesText(project.aliases.join(", "));
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
    await setProjectAliases(editingId, parseAliasesText(editAliasesText));
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

  // Applies the FLIP animation to every row except the dragged one (which
  // is driven directly by the pointer move handler instead): each row
  // jumped straight to its new slot when React re-rendered, so this offsets
  // it right back to where it visually was, then releases the offset on the
  // next frame with a transition — reading as a smooth slide into place
  // rather than a snap.
  useLayoutEffect(() => {
    const prevRects = preReorderRects.current;
    if (prevRects.size === 0) {
      return;
    }
    preReorderRects.current = new Map();

    for (const [id, row] of rowRefs.current) {
      if (id === dragRef.current?.id) {
        continue;
      }
      const prevRect = prevRects.get(id);
      if (!prevRect) {
        continue;
      }
      const newRect = row.getBoundingClientRect();
      const deltaY = prevRect.top - newRect.top;
      if (deltaY === 0) {
        continue;
      }
      row.style.transition = "none";
      row.style.transform = `translateY(${deltaY}px)`;
      requestAnimationFrame(() => {
        row.style.transition = REFLOW_TRANSITION;
        row.style.transform = "";
      });
    }
  }, [projects]);

  // Pointer listeners live on window (added on pointerdown, removed on
  // pointerup) rather than on the handle element itself — the standard
  // pattern for pointer-driven dragging, since it keeps working regardless
  // of the element being dragged getting reordered in the DOM mid-drag.
  //
  // The dragged row's target position is computed from the cumulative
  // pixel distance travelled since pointerdown, divided by a fixed row
  // height, rather than by comparing live getBoundingClientRect() reads
  // against other rows: those reads include the FLIP animation's own
  // in-flight transform, so mid-animation they report a row's transiently
  // *animating* position rather than its true layout slot — which was
  // making the drag miscompute what it was hovering over. Pure arithmetic
  // against the fixed starting point sidesteps that entirely.
  function handlePointerDown(
    event: PointerEvent<HTMLTableCellElement>,
    projectId: number,
    index: number,
  ) {
    event.preventDefault();
    const row = rowRefs.current.get(projectId);
    const rowHeight = row?.getBoundingClientRect().height ?? 0;
    dragRef.current = { id: projectId, startIndex: index, startY: event.clientY, rowHeight };
    setDraggingId(projectId);

    function handlePointerMove(moveEvent: globalThis.PointerEvent) {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }

      const deltaY = moveEvent.clientY - drag.startY;

      if (drag.rowHeight > 0) {
        const targetIndex = Math.min(
          Math.max(drag.startIndex + Math.round(deltaY / drag.rowHeight), 0),
          projectsRef.current.length - 1,
        );

        setProjects((current) => {
          const currentIndex = current.findIndex((project) => project.id === drag.id);
          if (currentIndex === -1 || currentIndex === targetIndex) {
            return current;
          }
          const rects = new Map<number, DOMRect>();
          for (const [id, row] of rowRefs.current) {
            rects.set(id, row.getBoundingClientRect());
          }
          preReorderRects.current = rects;

          const next = current.slice();
          const [moved] = next.splice(currentIndex, 1);
          next.splice(targetIndex, 0, moved);
          return next;
        });

        // The row's own DOM slot just shifted by (targetIndex - startIndex)
        // row heights because of the splice above — without subtracting
        // that back out, the transform would stack on top of the slot's own
        // move instead of replacing it, making the row run away from the
        // cursor at roughly double speed after every reorder. targetIndex
        // is used here (not a value read back from state) so this stays
        // exactly in sync even though the splice above hasn't rendered yet.
        const indexShift = targetIndex - drag.startIndex;
        const draggedRow = rowRefs.current.get(drag.id);
        if (draggedRow) {
          draggedRow.style.transition = "none";
          draggedRow.style.transform = `translateY(${deltaY - indexShift * drag.rowHeight}px)`;
        }
      }
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);

      const drag = dragRef.current;
      dragRef.current = null;
      setDraggingId(null);
      if (!drag) {
        return;
      }

      const draggedRow = rowRefs.current.get(drag.id);
      if (draggedRow) {
        draggedRow.style.transition = REFLOW_TRANSITION;
        draggedRow.style.transform = "";
      }
      void reorderProjects(projectsRef.current.map((project) => project.id));
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  return (
    <div className={draggingId !== null ? "projects-view dragging-active" : "projects-view"}>
      <section className="dashboard-card">
        <h2>Progetti</h2>
        <table className="projects-table">
          <thead>
            <tr>
              <th className="drag-handle" aria-hidden="true" />
              <th>Nome</th>
              <th>Alias</th>
              <th>Azioni</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project, index) => (
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
                  onPointerDown={(event) => handlePointerDown(event, project.id, index)}
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
                <td className="project-alias-cell">
                  {editingId === project.id ? (
                    <input
                      type="text"
                      placeholder="Alias separati da virgola"
                      value={editAliasesText}
                      onChange={(event) => setEditAliasesText(event.target.value)}
                      onKeyDown={handleEditKeyDown}
                    />
                  ) : project.aliases.length > 0 ? (
                    <span>{project.aliases.join(", ")}</span>
                  ) : (
                    <span className="project-alias-empty">—</span>
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
