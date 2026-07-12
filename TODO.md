# Todo

## 1. Ottimizzazione dell'app a livello di risorse PC

**Difficoltà: media** — prima di tutto va misurato dove va davvero la CPU/RAM
(Task Manager durante uso normale vs idle), perché a occhio l'attuale polling
del detector (ogni 2s, poche chiamate Win32 leggere) non dovrebbe pesare
molto. I sospetti principali sono altrove:

- tre finestre WebView2 attive insieme (widget, Home, toast) — ciascuna è
  un processo di rendering a sé;
- eventuali re-render React non necessari nel widget o nella dashboard;
- il matcher rigenera le regex ad ogni `refresh_matcher` (create/edit/archive
  progetto) — non un problema in polling continuo, ma da verificare.

Prossimo passo concreto: profilare prima di ottimizzare, altrimenti si rischia
di ottimizzare la parte sbagliata.

## 2. Rilevamento chat WhatsApp specifica

**Difficoltà: alta** — il titolo della finestra/tab di WhatsApp Web resta
sempre "WhatsApp", non cambia in base alla chat aperta (a differenza di
Figma). Il detector legge solo titolo finestra + nome processo a livello di
sistema operativo, non ha accesso al contenuto della pagina.

Per sapere su quale chat si sta scrivendo servirebbe una **estensione
browser** (Chrome/Edge) che legga il nome della chat dal DOM e lo trasmetta a
Pulse tramite un canale locale (es. un piccolo server HTTP/WebSocket
nell'app). È un componente nuovo, non un fix — richiede: estensione
(manifest, content script, permessi), lato Rust un endpoint locale che riceva
l'informazione, e la logica per far vincere questo segnale sul rilevamento
via titolo finestra quando WhatsApp è in primo piano.

Nel frattempo, col fix del debounce (le finestre non riconosciute non
azzerano più il progetto), il tempo su WhatsApp resta accreditato al progetto
già attivo prima di aprirlo — non si perde tempo, ma può finire sul progetto
sbagliato se si scrive per un progetto diverso da quello tracciato.

Deciso di rimandare la decisione su come procedere.

## 3. Il timer non riprende da dove era rimasto nello stesso giorno — ✅ fatto

Quando un progetto/attività viene (ri)attivato, il backend somma i secondi
già tracciati su quell'entità *oggi* (segmenti già chiusi) ed espone il
totale come `todaySecondsBeforeSegment`; il widget lo usa come base di
partenza per il conteggio live invece di ripartire da zero.

## 4. Eseguibile .exe distribuibile per altri PC — ✅ fatto

Tauri produce già installer NSIS + MSI autonomi (`npm run build`). Release su
GitHub: https://github.com/Kep007/Pulse/releases

Nota che resta valida: senza firma del codice, Windows SmartScreen mostra un
avviso "editore sconosciuto" al primo avvio — non blocca l'installazione ma
richiede "Ulteriori informazioni" > "Esegui comunque"; risolvibile solo con
un certificato di code-signing (a pagamento). Deciso di lasciarlo così per
ora.

### Aggiornamenti automatici — ✅ fatto

L'app controlla da sola all'avvio se c'è una versione più recente su GitHub
Releases (via `tauri-plugin-updater`) e, se sì, la scarica, verifica, installa
e riavvia senza bisogno di scaricare nulla manualmente. Lo storico dati non è
mai a rischio: vive in `%LOCALAPPDATA%\app.pulse.desktop\` (database, log e
impostazioni tutti nella stessa cartella dalla v2.0.2), separato dalla
cartella di installazione (`%LOCALAPPDATA%\Programs\Pulse\`).

Per farlo funzionare il repo **Pulse è stato reso pubblico** (era privato —
gli URL di download delle release di un repo privato non sono raggiungibili
dall'app senza autenticazione).

**Importante**: la chiave privata che firma gli aggiornamenti è in
`~/.tauri/pulse-updater.key` su questo PC, generata senza password. Se si
perde, gli aggiornamenti futuri non potranno più essere firmati con la stessa
identità (l'updater rifiuterebbe pacchetti firmati con una chiave diversa) —
vale la pena farne un backup. Ogni nuova release va ricreata con:

```
# aggiornare la versione a mano in tutti e tre: package.json,
# src-tauri/tauri.conf.json, src-tauri/Cargo.toml (non c'è un unico posto)
export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/pulse-updater.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
npm run build
# poi generare latest.json (vedi comandi usati per v0.1.1) e pubblicarlo
# come GitHub Release insieme ai due installer
```

### Estensione companion Chrome/Edge (cartella `extension/`)

L'estensione riporta a Pulse (server locale, porta 47771) l'URL del tab
attivo e il contatto WhatsApp aperto — vedi
`src-tauri/src/detector/browser_signal.rs`. ID fisso
`bbbcjbccdgokheffchfkgdllkneahgnd`, derivato dalla chiave
**`~/.tauri/pulse-extension.pem`** (sensibile, da backuppare come la chiave
updater: persa quella, cambia l'ID e si rompono allowlist Origin e policy di
installazione).

Per pubblicare una NUOVA versione dell'estensione (non serve una release di
Pulse):

```
# 1. aggiornare "version" in extension/manifest.json
# 2. ri-impacchettare il crx con la stessa chiave:
chrome --pack-extension=extension --pack-extension-key=%USERPROFILE%\.tauri\pulse-extension.pem
# 3. aggiornare version/codebase in extension/update.xml
# 4. ricaricare crx + update.xml sugli asset della release fissa
#    "extension-updates" (marcata PRERELEASE di proposito: releases/latest
#    deve continuare a puntare alle release dell'app per l'updater!)
gh release upload extension-updates pulse-companion-X.Y.Z.crx extension/update.xml --clobber
```

L'installer NSIS (`src-tauri/nsis-hooks.nsh`) registra l'estensione via
ExtensionInstallForcelist in HKCU e la rimuove alla disinstallazione. Nota:
su macchine consumer non gestite Chrome/Edge possono ignorare quella policy
(e limitano comunque l'install silenziosa fuori dagli store) — se lo spike
lo conferma, il percorso supportato è pubblicare su Chrome Web Store / Edge
Add-ons e passare alle chiavi "external extensions"
(`Software\Google\Chrome\Extensions\<id>`), che mostrano un prompt di
abilitazione una tantum.
