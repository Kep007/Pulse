import { useState } from "react";
import { revealExtensionFolder } from "../../lib/tauri";

// Guida all'attivazione del tracciamento browser (estensione companion).
// Su Chrome consumer l'installazione automatica non è possibile (vedi
// nsis-hooks.nsh), quindi l'unica via a costo zero è il caricamento manuale
// in modalità sviluppatore: questa card apre la cartella dell'estensione
// (inclusa nell'installer) e spiega i passi.
export function BrowserTrackingSetting() {
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function openFolder() {
    setError(false);
    try {
      setPath(await revealExtensionFolder());
    } catch {
      setError(true);
    }
  }

  return (
    <div className="settings-row settings-row-stacked">
      <div>
        <strong>Tracciamento browser (WhatsApp e Pinterest)</strong>
        <p>
          Un'estensione per Chrome (o Edge) permette a Pulse di riconoscere la chat WhatsApp Web
          aperta e di ignorare Pinterest. Va attivata una sola volta:
        </p>
        <ol className="browser-tracking-steps">
          <li>
            Premi <strong>Apri la cartella dell'estensione</strong> qui sotto (si apre Esplora
            risorse).
          </li>
          <li>
            In Chrome vai su <code>chrome://extensions</code> e attiva la <strong>Modalità
            sviluppatore</strong> (in alto a destra).
          </li>
          <li>
            Premi <strong>Carica estensione non pacchettizzata</strong> e seleziona la cartella
            aperta al passo 1.
          </li>
          <li>Fatto: l'estensione resta attiva anche dopo il riavvio del browser.</li>
        </ol>
        <button type="button" className="browser-tracking-button" onClick={() => void openFolder()}>
          Apri la cartella dell'estensione
        </button>
        {path && <p className="browser-tracking-path">{path}</p>}
        {error && (
          <p className="browser-tracking-error">
            Impossibile aprire la cartella. Reinstalla Pulse o carica l'estensione manualmente.
          </p>
        )}
      </div>
    </div>
  );
}
