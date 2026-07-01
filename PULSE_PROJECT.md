# Pulse – Time Tracker Automatico per Agenzie

## Descrizione del progetto

Pulse è un'applicazione desktop per Windows pensata per social media manager e designer che lavorano su più clienti contemporaneamente. Il problema che risolve è il tracking automatico del tempo per progetto/cliente, senza che l'utente debba avviare o fermare manualmente un timer ogni volta che cambia contesto di lavoro.

Il sistema monitora in background le finestre attive sul desktop e deduce automaticamente su quale progetto sta lavorando l'utente, basandosi sul titolo della finestra di Figma (pattern `LT – NomeCliente`) e sui dati recuperati in tempo reale dall'API di Asana. Un widget flottante sempre visibile mostra il progetto attivo e il timer in corso. Se il rilevamento automatico non è corretto, l'utente può correggere con un solo click.

---

## Obiettivo principale

Tracciare le ore lavorate per cliente con il minimo attrito possibile, per produrre:

- **Ore totali mensili per cliente** – quanto tempo è stato dedicato a ciascun progetto nel mese
- **Benchmark per tipo di attività** – quanto tempo in media richiede un calendario editoriale, un design di homepage, un'identità visiva, ecc. calcolato su sessioni storiche

---

## Come funziona il rilevamento automatico

### Layer 1 – Figma (priorità principale, ~60% del tempo)

L'utente lavora prevalentemente su Figma. Tutti i file Figma seguono la convenzione di naming:

```
LT – NomeCliente
```

Il titolo della finestra di Figma rispecchia il nome del file aperto. Pulse legge il titolo della finestra attiva ogni N secondi, cerca il pattern `LT – `, estrae la stringa dopo il trattino e la usa per identificare il cliente attivo. Il timer switcha automaticamente quando cambia il progetto Figma in primo piano.

### Layer 2 – Asana API (priorità secondaria, ~40% del tempo)

L'utente usa l'app desktop di Asana. Il titolo della finestra Asana è sempre `Asana` e non contiene informazioni utili. Il rilevamento avviene quindi tramite API:

- Pulse si connette all'API REST di Asana tramite Personal Access Token
- Quando la finestra Asana diventa attiva, Pulse interroga l'endpoint per recuperare la task più recentemente visualizzata o in corso
- Da quella task estrae: nome del progetto Asana (cliente) + nome della task (tipo di attività)
- Il timer viene associato a quel progetto e quella categoria di attività

**Workflow atteso dall'utente:** prima di iniziare a lavorare su un'attività, l'utente apre la relativa task in Asana. Questo è il trigger che Pulse usa per settarsi sul progetto corretto.

### Layer 3 – Widget flottante (fallback manuale)

Un overlay sempre visibile in un angolo dello schermo (posizione configurabile) mostra:

- Nome progetto attivo
- Timer in corso (hh:mm:ss)
- Pulsante per cambiare progetto manualmente con un click
- Pulsante pausa (es. pausa pranzo, riunione non tracciata)

---

## Stack tecnico

### Framework principale

**Electron** – applicazione desktop cross-platform (target: Windows). Permette di:
- Accedere alle API native di Windows per leggere i titoli delle finestre attive
- Creare finestre trasparenti always-on-top (widget flottante)
- Girare in background come process di sistema (system tray)

### Frontend

**React** (con Vite come bundler) – usato per:
- Il widget flottante (componente leggero, sempre visibile)
- Il pannello report (dashboard mensile con grafici)
- Le impostazioni (mapping clienti, token API, ecc.)

**Tailwind CSS** – styling utility-first, rapido da usare

**Recharts** – grafici per il pannello report (ore per cliente, benchmark attività)

### Database

**SQLite** via `better-sqlite3` – database locale sul PC dell'utente, nessun dato in cloud. Schema principale:

```sql
-- Progetti/clienti
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,          -- es. "SoFly"
  figma_pattern TEXT,          -- es. "LT – SoFly"
  asana_project_id TEXT,
  color TEXT,                  -- colore identificativo nel widget
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sessioni di lavoro tracciate
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  activity_name TEXT,          -- nome della task Asana o label manuale
  activity_category TEXT,      -- es. "Calendario editoriale", "Design homepage"
  started_at DATETIME NOT NULL,
  ended_at DATETIME,
  duration_seconds INTEGER,    -- calcolato alla chiusura della sessione
  source TEXT,                 -- "figma" | "asana" | "manual"
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Integrazione Asana

**Asana REST API v1** – autenticazione tramite Personal Access Token (PAT).

Endpoint principali usati:
- `GET /users/me/user_task_list` – task recenti dell'utente
- `GET /tasks/{task_gid}` – dettaglio task (nome, progetto, assignee)
- `GET /projects` – lista progetti per mappare i nomi ai clienti

La chiamata API avviene quando Pulse rileva che la finestra Asana è tornata in primo piano (con debounce di ~3 secondi per evitare chiamate eccessive).

### Monitoraggio finestre attive

Modulo nativo Node.js per leggere la finestra attiva su Windows:

**`active-win`** (npm package) – restituisce titolo, processo e ID della finestra attualmente in focus. Polling ogni 2 secondi con logica di debounce: il progetto cambia solo se la nuova finestra è rimasta attiva per almeno 5 secondi (evita switch accidentali mentre si passa rapidamente sopra una finestra).

---

## Struttura cartelle del progetto

```
pulse/
├── electron/
│   ├── main.js              # Processo principale Electron
│   ├── preload.js           # Bridge sicuro tra main e renderer
│   ├── window-tracker.js    # Logica monitoraggio finestre attive
│   ├── asana-client.js      # Wrapper API Asana
│   └── db.js                # Connessione e query SQLite
├── src/
│   ├── components/
│   │   ├── Widget.jsx        # Overlay flottante always-on-top
│   │   ├── Dashboard.jsx     # Pannello report mensile
│   │   ├── ProjectList.jsx   # Lista e gestione progetti
│   │   └── Settings.jsx      # Configurazione token, mapping, ecc.
│   ├── App.jsx
│   └── main.jsx
├── public/
├── package.json
├── vite.config.js
└── PULSE_PROJECT.md         # Questo file
```

---

## Funzionalità previste (MVP)

### Must have

- [ ] Rilevamento automatico progetto da Figma (titolo finestra)
- [ ] Rilevamento automatico progetto da Asana (API)
- [ ] Widget flottante always-on-top con timer
- [ ] Switch manuale progetto dal widget (un click)
- [ ] Pausa manuale timer
- [ ] Avvio automatico con Windows (system tray)
- [ ] Dashboard: ore totali per cliente nel mese corrente
- [ ] Dashboard: storico sessioni per cliente

### Nice to have (post-MVP)

- [ ] Benchmark attività (tempo medio per tipo di task, calcolato su storico)
- [ ] Export report mensile in CSV o PDF
- [ ] Alert se una sessione dura più di X ore senza pausa
- [ ] Grafico distribuzione ore per cliente (visual tipo pie chart o bar chart)
- [ ] Gestione manuale sessioni (modifica o aggiunta retroattiva)

---

## Setup iniziale richiesto

1. Installare Node.js v20+
2. Clonare il repository
3. `npm install` nella root
4. Creare il file `.env` con:
   ```
   ASANA_PAT=your_personal_access_token_here
   ```
5. `npm run dev` per avviare in modalità sviluppo

Per ottenere il Personal Access Token Asana:
- Vai su [app.asana.com/0/developer-console](https://app.asana.com/0/developer-console)
- Sezione "Personal access tokens" → "Create new token"
- Copia il token nel file `.env`

---

## Note di design

- Il widget flottante deve essere **minimalista e non invasivo**: mostra solo progetto attivo + timer + due pulsanti (cambia / pausa). Dimensione massima 280x70px.
- Il pannello report si apre cliccando sull'icona nel system tray o dal widget.
- Tutta la logica di tracking gira nel processo main di Electron, non nel renderer, per garantire continuità anche quando il pannello è chiuso.
- Il database SQLite è salvato in `%APPDATA%/Pulse/pulse.db` su Windows.
