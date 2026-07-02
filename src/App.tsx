import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { PROJECTS } from "./projects";

function formatElapsed(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
}

export function App() {
  const [activeProjectIndex, setActiveProjectIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [projectSeconds, setProjectSeconds] = useState<Record<string, number>>(
    () => Object.fromEntries(PROJECTS.map((project) => [project.id, 0])),
  );

  const activeProject = PROJECTS[activeProjectIndex];
  const elapsed = useMemo(
    () => formatElapsed(projectSeconds[activeProject.id] ?? 0),
    [activeProject.id, projectSeconds],
  );

  useEffect(() => {
    if (isPaused) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setProjectSeconds((currentSeconds) => ({
        ...currentSeconds,
        [activeProject.id]: (currentSeconds[activeProject.id] ?? 0) + 1,
      }));
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [activeProject.id, isPaused]);

  function startDrag(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }

    if (event.target instanceof Element && event.target.closest("button")) {
      return;
    }

    event.preventDefault();
    void getCurrentWindow().startDragging().catch((error) => {
      console.error("Unable to start window drag", error);
    });
  }

  function changeProject() {
    setActiveProjectIndex((currentIndex) => (currentIndex + 1) % PROJECTS.length);
  }

  return (
    <main className="widget" data-tauri-drag-region onMouseDown={startDrag}>
      <section className="drag-zone" data-tauri-drag-region>
        <div
          className={isPaused ? "status-dot paused" : "status-dot"}
          data-tauri-drag-region
        />
        <div className="project" data-tauri-drag-region>
          <span className="label" data-tauri-drag-region>
            {isPaused ? "In pausa" : "Manuale"}
          </span>
          <strong data-tauri-drag-region title={activeProject.aliases.join(", ")}>
            {activeProject.name}
          </strong>
        </div>
        <time data-tauri-drag-region>{elapsed}</time>
      </section>

      <nav className="actions" aria-label="Controlli timer">
        <button
          className="secondary"
          type="button"
          title="Cambia progetto"
          onClick={changeProject}
        >
          Cambia
        </button>
        <button
          className="primary"
          type="button"
          title={isPaused ? "Riprendi timer" : "Pausa timer"}
          onClick={() => setIsPaused((currentValue) => !currentValue)}
        >
          {isPaused ? "Riprendi" : "Pausa"}
        </button>
      </nav>
    </main>
  );
}
