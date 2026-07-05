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

Tauri produce già installer NSIS + MSI autonomi (`npm run build`). Prima
release pubblicata su GitHub:
https://github.com/Kep007/Pulse/releases/tag/v0.1.0

Nota che resta valida: senza firma del codice, Windows SmartScreen mostra un
avviso "editore sconosciuto" al primo avvio — non blocca l'installazione ma
richiede "Ulteriori informazioni" > "Esegui comunque"; risolvibile solo con
un certificato di code-signing (a pagamento).
