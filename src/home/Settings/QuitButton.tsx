import { quitApp } from "../../lib/tauri";

export function QuitButton() {
  return (
    <div className="settings-row">
      <div>
        <strong>Esci da Pulse</strong>
        <p>Chiude completamente l'applicazione, incluso il tracciamento in background.</p>
      </div>
      <button type="button" className="danger" onClick={() => void quitApp()}>
        Esci
      </button>
    </div>
  );
}
