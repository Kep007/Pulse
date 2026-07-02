import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent } from "react";

const activeProject = {
  name: "Nessun progetto",
  source: "Manuale",
  elapsed: "00:00:00",
};

export function App() {
  function startDrag(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    void getCurrentWindow().startDragging().catch((error) => {
      console.error("Unable to start window drag", error);
    });
  }

  return (
    <main className="widget" data-tauri-drag-region onMouseDown={startDrag}>
      <section
        className="drag-zone"
        data-tauri-drag-region
      >
        <div className="status-dot" data-tauri-drag-region />
        <div className="project" data-tauri-drag-region>
          <span className="label" data-tauri-drag-region>
            {activeProject.source}
          </span>
          <strong data-tauri-drag-region>{activeProject.name}</strong>
        </div>
        <time data-tauri-drag-region>{activeProject.elapsed}</time>
      </section>

      <nav className="actions" aria-label="Controlli timer">
        <button type="button" title="Cambia progetto">
          Cambia
        </button>
        <button type="button" title="Pausa timer">
          Pausa
        </button>
      </nav>
    </main>
  );
}
