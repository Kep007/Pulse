import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  pickNewProjectColor,
  projectColorMap,
  PROJECT_COLOR_POOL,
  randomProjectColors,
} from "../../lib/projectColors";
import {
  archiveProject,
  createProject,
  getCompany,
  listProjects,
  reorderProjects,
  setCompany,
  setProjectAliases,
  setProjectColors,
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

// "2a78D6" / "#2a78d6" → "#2a78d6"; anything not a 6-digit hex → null.
function normalizeHex(text: string): string | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(text.trim());
  return match ? `#${match[1].toLowerCase()}` : null;
}

const REFLOW_TRANSITION = "transform 180ms ease";

/// La sezione "La tua azienda" sopra la lista progetti: nome + alias
/// dell'azienda per cui si lavora. Questi termini compaiono spesso accanto
/// ai nomi dei veri progetti (gruppi WhatsApp tipo "LT TEAM / OG MOTORS"),
/// quindi il matcher li usa come de-prioritizzatori: vincono solo quando
/// nel testo non compare nessun altro progetto.
function CompanyCard() {
  const [name, setName] = useState("");
  const [aliasesText, setAliasesText] = useState("");
  const [saved, setSaved] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getCompany().then((company) => {
      setName(company.name);
      setAliasesText(company.aliases.join(", "));
      setLoaded(true);
    });
  }, []);

  async function save() {
    await setCompany(name.trim(), parseAliasesText(aliasesText));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  }

  return (
    <section className="dashboard-card company-card">
      <div className="projects-header">
        <h2>La tua azienda</h2>
        {saved && <span className="company-saved-note">Salvato ✓</span>}
      </div>
      <p className="company-hint">
        Il nome e gli alias dell'azienda per cui lavori (es. LT, LT TEAM, LT CONSULTING). L'azienda
        compare automaticamente come progetto nell'elenco qui sotto e nel widget. Quando in una
        finestra o chat compaiono sia l'azienda sia un altro progetto (es. "LT TEAM / OG MOTORS"),
        il tempo va all'altro progetto; se compare solo l'azienda, il tempo va al progetto azienda.
      </p>
      <div className="company-fields">
        <input
          type="text"
          placeholder="Nome azienda"
          value={name}
          disabled={!loaded}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && void save()}
        />
        <input
          type="text"
          placeholder="Alias separati da virgola"
          value={aliasesText}
          disabled={!loaded}
          onChange={(event) => setAliasesText(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && void save()}
        />
        <button type="button" className="primary" disabled={!loaded} onClick={() => void save()}>
          Salva
        </button>
      </div>
    </section>
  );
}

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
  // Which project's color-picker popover is open, plus the free-form hex
  // field's draft text (kept as typed; validated only on commit).
  const [colorPickerFor, setColorPickerFor] = useState<number | null>(null);
  const [hexDraft, setHexDraft] = useState("");
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

  // Swatch colors shown in the table — the exact same resolution every chart
  // uses (stored color, else stable pool fallback), so what the user sees
  // here always matches the timeline/breakdown colors.
  const colorById = useMemo(() => projectColorMap(projects), [projects]);

  async function handleAdd() {
    const name = newName.trim();
    if (!name) {
      return;
    }
    // Assign a real color at birth (least-used pool color) instead of null,
    // so a new project is immediately distinct in every chart.
    await createProject(name, pickNewProjectColor(projects.map((project) => project.color)));
    setNewName("");
    await refresh();
  }

  async function randomizeColors() {
    if (projects.length === 0) {
      return;
    }
    const colors = randomProjectColors(projects.length);
    await setProjectColors(projects.map((project, index) => ({ id: project.id, color: colors[index] })));
    await refresh();
  }

  function openColorPicker(project: ProjectDto) {
    setColorPickerFor((current) => (current === project.id ? null : project.id));
    setHexDraft(colorById.get(project.id) ?? "");
  }

  async function applyColor(projectId: number, color: string) {
    setColorPickerFor(null);
    await setProjectColors([{ id: projectId, color }]);
    await refresh();
  }

  function commitHexDraft(projectId: number) {
    const color = normalizeHex(hexDraft);
    if (color) {
      void applyColor(projectId, color);
    }
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
    // Renaming must not wipe the stored color — pass the current one through.
    const currentColor = projects.find((project) => project.id === editingId)?.color ?? null;
    await updateProject(editingId, name, currentColor);
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
      <CompanyCard />
      <section className="dashboard-card">
        <div className="projects-header">
          <h2>Progetti</h2>
          <button
            type="button"
            className="randomize-colors"
            title="Riassegna casualmente i colori dei progetti (palette a contrasto verificato)"
            onClick={() => void randomizeColors()}
          >
            🎲 Colori casuali
          </button>
        </div>
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
                    <span className="project-name-with-color">
                      <button
                        type="button"
                        className="project-color-swatch"
                        style={{ background: colorById.get(project.id) }}
                        title="Cambia colore"
                        aria-label={`Cambia colore di ${project.name}`}
                        onClick={() => openColorPicker(project)}
                      />
                      {project.name}
                      {colorPickerFor === project.id && (
                        <>
                          <div
                            className="color-picker-backdrop"
                            onClick={() => setColorPickerFor(null)}
                          />
                          <div className="color-picker-pop" role="dialog" aria-label="Scegli colore">
                            <div className="color-picker-grid">
                              {PROJECT_COLOR_POOL.map((color) => (
                                <button
                                  key={color}
                                  type="button"
                                  className={
                                    color === (colorById.get(project.id) ?? "").toLowerCase()
                                      ? "color-cell active"
                                      : "color-cell"
                                  }
                                  style={{ background: color }}
                                  title={color}
                                  onClick={() => void applyColor(project.id, color)}
                                />
                              ))}
                            </div>
                            <div className="color-picker-custom">
                              <input
                                type="color"
                                value={normalizeHex(hexDraft) ?? colorById.get(project.id) ?? "#2a78d6"}
                                onChange={(event) => setHexDraft(event.target.value)}
                                title="Selettore colore"
                              />
                              <input
                                type="text"
                                value={hexDraft}
                                placeholder="#RRGGBB"
                                onChange={(event) => setHexDraft(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    commitHexDraft(project.id);
                                  } else if (event.key === "Escape") {
                                    setColorPickerFor(null);
                                  }
                                }}
                              />
                              <button
                                type="button"
                                disabled={normalizeHex(hexDraft) === null}
                                onClick={() => commitHexDraft(project.id)}
                              >
                                OK
                              </button>
                            </div>
                          </div>
                        </>
                      )}
                    </span>
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
