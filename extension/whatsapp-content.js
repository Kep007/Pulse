// Pulse Companion — content script per web.whatsapp.com.
//
// Legge il nome della chat aperta (contatto o gruppo) dall'header e lo
// inoltra al service worker, che lo gira al server locale di Pulse. Il tab
// di WhatsApp Web si intitola sempre e solo "WhatsApp", quindi questo e'
// l'unico modo per sapere per quale cliente si sta scrivendo.
//
// ATTENZIONE — costo di manutenzione ricorrente accettato: il selettore
// qui sotto dipende dal DOM di WhatsApp Web e SI ROMPERA' a ogni loro
// redesign. Se il tracciamento WhatsApp smette di funzionare, il primo
// posto da controllare e' questo selettore.
//
// Un semplice polling (niente MutationObserver): il detector di Pulse
// campiona ogni 2s e debounce-a su ~3 campioni, quindi qualunque immediatezza
// sotto i 2-3 secondi non cambia nulla. Il polling fa anche da heartbeat:
// il messaggio ogni 3s tiene "fresco" il segnale lato Rust mentre l'utente
// resta a lungo sulla stessa chat (il caso d'uso principale), e risveglia
// il service worker se era stato sospeso.

const POLL_MS = 3000;

function readContactName() {
  // Header della conversazione aperta: il primo span con testo "auto" dentro
  // l'header di #main e' il nome del contatto/gruppo. Nessuna chat aperta =
  // nessun #main header = null (Pulse ricade sul titolo finestra).
  const el = document.querySelector("#main header span[dir='auto']");
  const text = el ? el.textContent.trim() : "";
  return text.length > 0 ? text : null;
}

setInterval(() => {
  try {
    chrome.runtime.sendMessage({
      type: "whatsapp-contact",
      contactName: readContactName(),
    });
  } catch {
    // Il worker puo' essere momentaneamente non raggiungibile (riavvio
    // dell'estensione): il prossimo tick riprova.
  }
}, POLL_MS);
