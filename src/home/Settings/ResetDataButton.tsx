import { useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { resetAllData } from "../../lib/tauri";

export function ResetDataButton() {
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function confirmReset() {
    setConfirmOpen(false);
    await resetAllData();
  }

  return (
    <div className="settings-row">
      <div>
        <strong>Reset dati</strong>
        <p>Cancella tutto lo storico tracciato. Progetti e attività restano invariati.</p>
      </div>
      <button type="button" className="danger" onClick={() => setConfirmOpen(true)}>
        Reset
      </button>

      {confirmOpen && (
        <ConfirmDialog
          title="Azzerare tutti i dati tracciati?"
          message="Questa azione elimina in modo permanente lo storico del tempo tracciato. Non può essere annullata."
          confirmLabel="Azzera dati"
          onConfirm={() => void confirmReset()}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}
