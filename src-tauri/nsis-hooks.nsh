; Hook dell'installer NSIS di Pulse (vedi bundle.windows.nsis.installerHooks
; in tauri.conf.json).
;
; ESITO SPIKE REGISTRO / DISTRIBUZIONE ESTENSIONE (2026-07-12):
;  1) HKCU\Software\Policies e' di SOLA LETTURA per l'utente normale su Win 11
;     Home reale (ACL: utente = ReadKey; scrittura solo Administrators/SYSTEM).
;     Una WriteRegStr li' da un installer per-utente fallisce.
;  2) Verificato inoltre (docs Chrome Enterprise): il force-install di
;     un'estensione OSPITATA FUORI DALLO STORE (update_url self-hosted, il
;     nostro caso) e' consentito SOLO su macchine domain-joined / Azure AD /
;     Chrome Enterprise Core. Su un PC consumer NON funziona nemmeno da HKLM,
;     nemmeno con UAC. La policy forcelist self-hosted e' quindi un vicolo
;     cieco per i clienti consumer, indipendentemente dall'hive.
;
; Conseguenza: l'unica via consumer e' pubblicare l'estensione su uno store
; (Edge Add-ons e' gratuito; Chrome Web Store ha una tassa una-tantum di 5$) e
; registrare le chiavi "external extensions"
; HKCU\Software\...\Extensions\<id> (NON sotto \Policies, quindi scrivibili
; dall'utente senza UAC): il browser mostra un prompt "abilita estensione"
; una tantum, poi si auto-aggiorna dallo store. Quelle chiavi richiedono pero'
; l'ID definitivo assegnato dallo store (diverso dall'attuale, derivato dalla
; nostra key locale), quindi vanno scritte solo DOPO la pubblicazione.
;
; Le macro qui sotto (forcelist self-hosted) NON sono efficaci su consumer e
; restano solo come riferimento per ambienti gestiti/aziendali. Finche'
; l'estensione non e' su uno store, si carica a mano in modalita'
; sviluppatore (cartella extension/).

!define PULSE_EXT_ID "bbbcjbccdgokheffchfkgdllkneahgnd"
!define PULSE_EXT_UPDATE_URL "https://github.com/Kep007/Pulse/releases/download/extension-updates/update.xml"
!define PULSE_EXT_FORCELIST_VALUE "419"

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Policies\Google\Chrome\ExtensionInstallForcelist" "${PULSE_EXT_FORCELIST_VALUE}" "${PULSE_EXT_ID};${PULSE_EXT_UPDATE_URL}"
  WriteRegStr HKCU "Software\Policies\Microsoft\Edge\ExtensionInstallForcelist" "${PULSE_EXT_FORCELIST_VALUE}" "${PULSE_EXT_ID};${PULSE_EXT_UPDATE_URL}"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegValue HKCU "Software\Policies\Google\Chrome\ExtensionInstallForcelist" "${PULSE_EXT_FORCELIST_VALUE}"
  DeleteRegValue HKCU "Software\Policies\Microsoft\Edge\ExtensionInstallForcelist" "${PULSE_EXT_FORCELIST_VALUE}"
!macroend
