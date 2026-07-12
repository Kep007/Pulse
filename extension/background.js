// Pulse Companion — service worker.
//
// Riporta al server locale di Pulse (src-tauri/src/detector/browser_signal.rs)
// l'URL/titolo del tab attivo della finestra browser piu' recentemente a
// fuoco. L'estensione resta volutamente "generica": tutta la logica di
// dominio (salta Pinterest, usa il contatto WhatsApp) vive lato Rust in
// resolve_match_text, cosi' aggiungere un sito non richiede di ripubblicare
// l'estensione.
//
// Liveness: oltre agli eventi di cambio tab/finestra c'e' un heartbeat via
// chrome.alarms (30s: il minimo che MV3 consente — periodi piu' brevi
// vengono silenziosamente arrotondati a 30s) perche' un utente fermo sulla
// stessa pagina non genera eventi ma il suo segnale e' ancora valido; il
// content script di WhatsApp aggiunge il proprio heartbeat da 3s (vive nella
// pagina, non viene mai sospeso come questo worker). STALE_AFTER lato Rust
// e' tarato sul caso peggiore: 2 alarm da 30s piu' margine.

const ENDPOINT = "http://127.0.0.1:47771/signal";

// Ultimo nome contatto/gruppo riportato dal content script di WhatsApp.
// Vive nello stato del worker: se il worker viene sospeso e risvegliato lo
// stato riparte da null, ma il content script lo rimanda entro ~3s.
let whatsappContact = null;

async function send() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  } catch {
    return;
  }
  if (!tab || !tab.url || !/^https?:/.test(tab.url)) {
    return;
  }

  const isWhatsApp = tab.url.startsWith("https://web.whatsapp.com");
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: tab.url,
        title: tab.title ?? "",
        contactName: isWhatsApp ? whatsappContact : null,
      }),
    });
  } catch {
    // Pulse non in esecuzione: normale, nessun rumore.
  }
}

chrome.tabs.onActivated.addListener(() => void send());
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.title)) {
    void send();
  }
});
chrome.windows.onFocusChanged.addListener(() => void send());

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === "whatsapp-contact") {
    whatsappContact = message.contactName ?? null;
    void send();
  }
});

chrome.alarms.create("pulse-heartbeat", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "pulse-heartbeat") {
    void send();
  }
});

// Primo segnale subito all'avvio del worker (installazione, avvio browser,
// risveglio dopo sospensione).
void send();
