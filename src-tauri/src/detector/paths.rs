//! Turning file locations (File Explorer folders, `file://` browser tabs,
//! PDF URLs) into text the project matcher can search. A folder or file
//! path usually names the client somewhere along it — `E:\SOFLY\Reels\...`
//! — even when the window title (just the last folder, or a PDF's internal
//! title) doesn't.

/// `%XX` decoding, UTF-8 aware (so `%C3%A0` becomes `à`). Malformed escapes
/// are kept as-is rather than failing the whole string.
pub fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = &bytes[index + 1..index + 3];
            let parsed = std::str::from_utf8(hex)
                .ok()
                .and_then(|hex| u8::from_str_radix(hex, 16).ok());
            if let Some(byte) = parsed {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// `file:///E:/SOFLY/Reels` → `E:\SOFLY\Reels`, `file://server/share/x` →
/// `\\server\share\x`. None for anything that isn't a `file:` URL.
pub fn file_url_to_path(url: &str) -> Option<String> {
    let rest = url
        .strip_prefix("file:///")
        .map(|local| local.to_string())
        .or_else(|| url.strip_prefix("file://").map(|unc| format!("//{unc}")))?;
    let path = rest.split(['?', '#']).next().unwrap_or(&rest);
    let decoded = percent_decode(path).replace('/', "\\");
    (!decoded.is_empty()).then_some(decoded)
}

/// The path part of an http(s) URL, decoded — used for PDFs served from the
/// web, whose tab title is only the file name or the PDF's metadata title.
pub fn url_path(url: &str) -> Option<String> {
    let after_scheme = url.split_once("://")?.1;
    let path = after_scheme.split_once('/')?.1;
    let path = path.split(['?', '#']).next().unwrap_or(path);
    (!path.is_empty()).then(|| percent_decode(path))
}

pub fn is_pdf_url(url: &str) -> bool {
    let path = url.split(['?', '#']).next().unwrap_or(url);
    path.to_ascii_lowercase().ends_with(".pdf")
}

/// Window title plus any location text, as one string for the matcher.
pub fn with_location(title: &str, location: Option<&str>) -> String {
    match location {
        Some(location) if !location.is_empty() => format!("{title} {location}"),
        _ => title.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_spaces_and_accents() {
        assert_eq!(percent_decode("Caff%C3%A8%20Rossi"), "Caffè Rossi");
        assert_eq!(percent_decode("100%"), "100%");
        assert_eq!(percent_decode("%zz"), "%zz");
    }

    #[test]
    fn file_urls_become_windows_paths() {
        assert_eq!(
            file_url_to_path("file:///E:/SOFLY/Reels/Redazionali/2026/Ottobre").as_deref(),
            Some(r"E:\SOFLY\Reels\Redazionali\2026\Ottobre")
        );
        assert_eq!(
            file_url_to_path("file:///C:/Clienti/Caff%C3%A8%20Rossi/preventivo.pdf").as_deref(),
            Some(r"C:\Clienti\Caffè Rossi\preventivo.pdf")
        );
        assert_eq!(
            file_url_to_path("file://nas/progetti/OG/brief.pdf").as_deref(),
            Some(r"\\nas\progetti\OG\brief.pdf")
        );
        assert_eq!(file_url_to_path("https://example.com/a.pdf"), None);
    }

    #[test]
    fn web_pdf_paths_are_extracted() {
        assert!(is_pdf_url("https://cdn.example.com/clienti/SOFLY/listino.PDF?v=2"));
        assert!(!is_pdf_url("https://example.com/pdf-guide"));
        assert_eq!(
            url_path("https://cdn.example.com/clienti/SOFLY/listino.pdf?v=2").as_deref(),
            Some("clienti/SOFLY/listino.pdf")
        );
    }
}
