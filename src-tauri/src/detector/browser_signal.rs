use super::win::ForegroundInfo;
use super::AppState;
use serde::Deserialize;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

/// Chrome and Edge both derive the extension's ID from the public key in
/// `extension/manifest.json`'s `key` field, which is what lets this be a
/// hardcoded constant instead of something negotiated at runtime. The
/// private half of that keypair lives in `~/.tauri/pulse-extension.pem`
/// (back it up like the updater key): regenerating it changes this ID and
/// breaks both this allowlist and any install-by-policy entry.
const ALLOWED_ORIGIN: &str = "chrome-extension://bbbcjbccdgokheffchfkgdllkneahgnd";

/// Arbitrary unregistered/unassigned port. Fixed rather than negotiated
/// because the extension has no other way to discover it — no handshake
/// protocol exists (or is needed) for a value this low-stakes.
const PORT: u16 = 47771;

/// A user sitting on the same unchanged WhatsApp chat for minutes is exactly
/// the case where the last-reported signal is still 100% correct, but a
/// purely change-event-driven extension would never re-send it — so the
/// extension also heartbeats even when nothing changed. The slowest
/// heartbeat it can guarantee is 30s: MV3's `chrome.alarms` silently clamps
/// anything shorter, and the service worker may be suspended between
/// alarms (WhatsApp pages heartbeat every 3s on their own via the content
/// script, but generic pages — the Pinterest case — only have the alarm).
/// Two missed alarms plus margin, so a live extension never goes "stale"
/// but a dead/uninstalled one stops being trusted within about a minute.
/// Cheap staleness is fine here: tab *changes* are event-driven and land
/// immediately — this threshold only decides how long the last report
/// survives when nothing is arriving at all.
const STALE_AFTER: Duration = Duration::from_secs(65);

/// The active browser tab's URL/title, plus (for WhatsApp Web specifically)
/// the open chat's contact/group name scraped from the DOM — see
/// `extension/whatsapp-content.js`. Populated by the local HTTP server
/// below; `None` for the app's entire lifetime whenever the companion
/// extension isn't installed, which is what makes every consumer of this
/// fall back to the pre-existing window-title behavior with zero code
/// changes on that path.
#[derive(Debug, Clone)]
pub struct BrowserSignal {
    pub url: String,
    pub contact_name: Option<String>,
    pub received_at: Instant,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignalPayload {
    url: String,
    #[serde(default)]
    contact_name: Option<String>,
}

/// What `tick()` should actually match against, given the current
/// foreground window and (if any) the freshest browser signal.
#[derive(Debug, PartialEq, Eq)]
pub enum MatchIntent {
    /// The foreground page is known to title itself after content that has
    /// nothing to do with which project the user is on (a Pinterest pin
    /// named after something else entirely) — treat this tick as an
    /// unmatched window, the same as e.g. File Explorer, rather than ever
    /// matching the page title.
    Skip,
    /// Match against this text instead of the OS window title (the
    /// WhatsApp contact/group name).
    UseText(String),
    /// No browser-specific signal applies — match the OS window title
    /// exactly as before.
    UseWindowTitle,
}

/// Resolves what `tick()` should match against. Pure and independent of
/// Win32/HTTP so it's unit-testable directly.
pub fn resolve_match_text(
    info: &ForegroundInfo,
    signal: Option<&BrowserSignal>,
    now: Instant,
) -> MatchIntent {
    let is_browser = info.process_name.eq_ignore_ascii_case("chrome")
        || info.process_name.eq_ignore_ascii_case("msedge");
    if !is_browser {
        return MatchIntent::UseWindowTitle;
    }

    let Some(signal) = signal else {
        return MatchIntent::UseWindowTitle;
    };
    if now.saturating_duration_since(signal.received_at) > STALE_AFTER {
        return MatchIntent::UseWindowTitle;
    }

    let Some(host) = extract_host(&signal.url) else {
        return MatchIntent::UseWindowTitle;
    };

    if is_pinterest_host(host) {
        return MatchIntent::Skip;
    }

    if is_whatsapp_host(host) {
        return match &signal.contact_name {
            Some(contact) if !contact.trim().is_empty() => MatchIntent::UseText(contact.clone()),
            // No chat open yet (or the content script hasn't reported one)
            // — nothing wrong to correct for, fall back as usual.
            _ => MatchIntent::UseWindowTitle,
        };
    }

    MatchIntent::UseWindowTitle
}

/// Minimal scheme/userinfo/port/path stripping — enough to compare against
/// two known domains. Not a general-purpose URL parser (deliberately: this
/// codebase avoids pulling in a dependency this narrow a need doesn't
/// justify, see e.g. `matcher.rs`'s own hand-rolled normalization).
fn extract_host(url: &str) -> Option<&str> {
    let after_scheme = url.split_once("://").map_or(url, |(_, rest)| rest);
    let host_port_and_beyond = after_scheme
        .rsplit_once('@')
        .map_or(after_scheme, |(_, rest)| rest);
    let host_and_port = host_port_and_beyond
        .split(['/', '?', '#'])
        .next()
        .unwrap_or(host_port_and_beyond);
    let host = host_and_port.split(':').next().unwrap_or(host_and_port);
    if host.is_empty() {
        None
    } else {
        Some(host)
    }
}

fn is_pinterest_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("pinterest.com") || host_ends_with(host, ".pinterest.com")
}

fn is_whatsapp_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("web.whatsapp.com")
}

fn host_ends_with(host: &str, suffix: &str) -> bool {
    host.len() > suffix.len() && host[host.len() - suffix.len()..].eq_ignore_ascii_case(suffix)
}

/// Starts the loopback-only HTTP server the companion extension posts to.
/// Runs on its own OS thread for the app's lifetime — a dedicated blocking
/// thread (rather than folding this into the existing tokio-based poller)
/// matches how `mouse_hook.rs` already handles its own OS-level listener
/// rather than routing everything through one async runtime.
pub fn spawn_server(app: AppHandle) {
    std::thread::spawn(move || {
        let server = match tiny_http::Server::http(("127.0.0.1", PORT)) {
            Ok(server) => server,
            Err(err) => {
                log::error!("failed to start browser signal server on port {PORT}: {err}");
                return;
            }
        };

        for request in server.incoming_requests() {
            handle_request(&app, request);
        }
    });
}

fn handle_request(app: &AppHandle, mut request: tiny_http::Request) {
    use tiny_http::{Method, Response, StatusCode};

    if *request.method() != Method::Post || request.url() != "/signal" {
        let _ = request.respond(Response::empty(StatusCode(404)));
        return;
    }

    // The only access control this endpoint has — no token, no user-facing
    // config. Acceptable because the data itself is low-sensitivity (a URL
    // used only for local time-tracking classification, not credentials)
    // and the server only ever listens on 127.0.0.1: this check exists to
    // keep out other loopback processes/tabs, not to guard a secret.
    let origin_ok = request
        .headers()
        .iter()
        .any(|header| header.field.equiv("Origin") && header.value == ALLOWED_ORIGIN);
    if !origin_ok {
        let _ = request.respond(Response::empty(StatusCode(403)));
        return;
    }

    let mut body = String::new();
    if request.as_reader().read_to_string(&mut body).is_err() {
        let _ = request.respond(Response::empty(StatusCode(400)));
        return;
    }

    let Ok(payload) = serde_json::from_str::<SignalPayload>(&body) else {
        let _ = request.respond(Response::empty(StatusCode(400)));
        return;
    };

    if let Some(state) = app.try_state::<AppState>() {
        *state.browser_signal.lock().unwrap() = Some(BrowserSignal {
            url: payload.url,
            contact_name: payload.contact_name,
            received_at: Instant::now(),
        });
    }

    let _ = request.respond(Response::empty(StatusCode(204)));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info(process_name: &str) -> ForegroundInfo {
        ForegroundInfo {
            window_title: "irrelevant".to_string(),
            process_name: process_name.to_string(),
        }
    }

    fn signal(url: &str, contact_name: Option<&str>, age: Duration) -> (BrowserSignal, Instant) {
        let now = Instant::now();
        (
            BrowserSignal {
                url: url.to_string(),
                contact_name: contact_name.map(str::to_string),
                received_at: now - age,
            },
            now,
        )
    }

    #[test]
    fn non_browser_process_always_uses_window_title() {
        let (sig, now) = signal("https://www.pinterest.com/pin/1", None, Duration::ZERO);
        assert_eq!(
            resolve_match_text(&info("figma"), Some(&sig), now),
            MatchIntent::UseWindowTitle
        );
    }

    #[test]
    fn no_signal_uses_window_title() {
        assert_eq!(
            resolve_match_text(&info("chrome"), None, Instant::now()),
            MatchIntent::UseWindowTitle
        );
    }

    #[test]
    fn stale_signal_uses_window_title() {
        let (sig, now) = signal(
            "https://web.whatsapp.com/",
            Some("Cliente X"),
            STALE_AFTER + Duration::from_secs(1),
        );
        assert_eq!(
            resolve_match_text(&info("chrome"), Some(&sig), now),
            MatchIntent::UseWindowTitle
        );
    }

    #[test]
    fn pinterest_is_skipped() {
        let (sig, now) = signal("https://www.pinterest.com/pin/123", None, Duration::ZERO);
        assert_eq!(
            resolve_match_text(&info("chrome"), Some(&sig), now),
            MatchIntent::Skip
        );
        let (sig, now) = signal("https://pinterest.com/pin/123", None, Duration::ZERO);
        assert_eq!(
            resolve_match_text(&info("msedge"), Some(&sig), now),
            MatchIntent::Skip
        );
    }

    #[test]
    fn whatsapp_with_contact_uses_contact_name() {
        let (sig, now) = signal("https://web.whatsapp.com/", Some("Cliente X"), Duration::ZERO);
        assert_eq!(
            resolve_match_text(&info("chrome"), Some(&sig), now),
            MatchIntent::UseText("Cliente X".to_string())
        );
    }

    #[test]
    fn whatsapp_without_contact_uses_window_title() {
        let (sig, now) = signal("https://web.whatsapp.com/", None, Duration::ZERO);
        assert_eq!(
            resolve_match_text(&info("chrome"), Some(&sig), now),
            MatchIntent::UseWindowTitle
        );
    }

    #[test]
    fn unrelated_site_uses_window_title() {
        let (sig, now) = signal("https://example.com/", None, Duration::ZERO);
        assert_eq!(
            resolve_match_text(&info("chrome"), Some(&sig), now),
            MatchIntent::UseWindowTitle
        );
    }

    #[test]
    fn host_extraction_ignores_scheme_port_path_and_query() {
        assert_eq!(extract_host("https://web.whatsapp.com:443/abc?x=1"), Some("web.whatsapp.com"));
        assert_eq!(extract_host("http://user:pass@it.pinterest.com/foo"), Some("it.pinterest.com"));
    }
}
