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

## 3. Il timer non riprende da dove era rimasto nello stesso giorno

**Difficoltà: media** — oggi il timer del widget mostra solo la durata del
segmento *corrente*: se lavori su IFO, poi GENERAL, poi torni su IFO, il
widget riparte da ~0 invece di continuare dal totale già accumulato su IFO
quella giornata (il dato nel database è comunque corretto — ogni passaggio è
una riga separata sommata correttamente nei report — è solo il numero
*live* nel widget a non essere cumulativo).

Per risolverlo serve: quando si (ri)attiva un progetto/attività, calcolare
quanti secondi sono già stati tracciati su quell'entità *oggi* (somma delle
righe già chiuse) e passare questo totale al frontend come base di partenza,
sommandolo poi al conteggio live del segmento aperto.

## 4. Eseguibile .exe distribuibile per altri PC

**Difficoltà: bassa-media** — Tauri include già un bundler che produce un
installer NSIS (`tauri build`), completo e autonomo (non serve un
"download completo" separato, l'installer contiene già tutto). Il lavoro
vero è:

- configurare `tauri.conf.json` per il bundle Windows (icona, nome, versione);
- pubblicare l'installer come **GitHub Release** (non va committato nel
  repo — i binari nella cronologia git gonfiano il repository);
- opzionale ma da tenere presente: senza firma del codice, Windows
  SmartScreen mostra un avviso "editore sconosciuto" al primo avvio — non
  blocca l'installazione ma è meno professionale; risolvibile solo con un
  certificato di code-signing (a pagamento).

Percorso più semplice dei quattro, in gran parte configurazione più che
sviluppo.
