// A tiny local HTTP file server for artifact previews. Serving workspace files
// over real http://127.0.0.1 with correct MIME lets the webview use its NATIVE
// viewers (WKWebView and WebView2 both render PDF, images, HTML, media inline) —
// no JS rendering engines, no format conversion. Std-only; GET/HEAD; sandboxed
// to the workspace root; loopback-bound so nothing off-machine can reach it.
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, State};

use crate::artifact_file::{locate_under, mime_for, resolve_under, scoped_root};
use crate::runtime::workspace_dir;

#[derive(Default)]
pub struct PreviewState(Mutex<Option<(u16, String)>>);

/// Percent-decode a URL path (%XX and '+' are the only forms we accept).
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                let hex = bytes
                    .get(i + 1..i + 3)
                    .and_then(|h| std::str::from_utf8(h).ok());
                if let Some(v) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    out.push(v);
                    i += 3;
                } else {
                    out.push(b'%');
                    i += 1;
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Percent-encode one path segment for a URL.
fn encode_segment(seg: &str) -> String {
    let mut out = String::new();
    for b in seg.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Put a validated session directory in one URL path segment. A path segment,
/// instead of a query parameter, lets relative HTML/media subresources inherit
/// the same session scope. Hex is deliberately boring and path-safe.
fn encode_dir_scope(dir: &str) -> String {
    let mut out = String::with_capacity(2 + dir.len() * 2);
    out.push_str("d-");
    for byte in dir.as_bytes() {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

fn decode_dir_scope(scope: &str) -> Option<String> {
    let encoded = scope.strip_prefix("d-")?;
    if encoded.is_empty() || encoded.len() % 2 != 0 {
        return None;
    }
    let bytes = encoded
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let text = std::str::from_utf8(pair).ok()?;
            u8::from_str_radix(text, 16).ok()
        })
        .collect::<Option<Vec<_>>>()?;
    String::from_utf8(bytes).ok()
}

// No Access-Control-Allow-Origin on purpose: previews render in <iframe>/<img>
// (never cross-origin fetch), so advertising CORS would only let a foreign
// page that learned a URL read workspace files.
fn write_response(stream: &mut TcpStream, status: &str, mime: &str, body: &[u8], head_only: bool) {
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    if !head_only {
        let _ = stream.write_all(body);
    }
}

fn handle<F: Fn(&str) -> Option<PathBuf>>(mut stream: TcpStream, token: &str, root_of: &F) {
    // Read the full request head (until \r\n\r\n) — it may arrive in several
    // TCP segments. We only serve GET/HEAD; bodies are ignored.
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                buf.extend_from_slice(&chunk[..n]);
                if buf.windows(4).any(|w| w == b"\r\n\r\n") || buf.len() > 16 * 1024 {
                    break;
                }
            }
            Err(_) => return,
        }
    }
    if buf.is_empty() {
        return;
    }
    let head = String::from_utf8_lossy(&buf);
    let mut parts = head.lines().next().unwrap_or("").split_whitespace();
    let method = parts.next().unwrap_or("");
    let raw_path = parts.next().unwrap_or("/");
    let head_only = method == "HEAD";
    if method != "GET" && method != "HEAD" {
        write_response(
            &mut stream,
            "405 Method Not Allowed",
            "text/plain",
            b"method not allowed",
            false,
        );
        return;
    }
    let decoded = percent_decode(
        raw_path
            .split('?')
            .next()
            .unwrap_or("/")
            .trim_start_matches('/'),
    );
    // The per-run token is the FIRST path segment (`/<token>/w/…`). A path
    // prefix — rather than a query param or cookie — so relative subresources
    // inside a previewed HTML file inherit it, and the sandboxed iframe
    // (opaque origin, no cookies) still works. Anything without it is refused
    // before any filesystem work.
    let after_token = match decoded.split_once('/') {
        Some((tok, rest)) if tok == token => rest.to_string(),
        _ => {
            write_response(
                &mut stream,
                "403 Forbidden",
                "text/plain",
                b"forbidden",
                head_only,
            );
            return;
        }
    };
    // URLs are scope-prefixed: /w/<path> serves the active workspace, /b/<path>
    // the base folder — each resolved (and sandboxed) against its own root.
    let (root, rel) = match after_token.split_once('/') {
        Some((scope, rest)) if !rest.is_empty() => match root_of(scope) {
            Some(root) => (root, rest.to_string()),
            None => {
                write_response(
                    &mut stream,
                    "404 Not Found",
                    "text/plain",
                    b"not found",
                    head_only,
                );
                return;
            }
        },
        _ => {
            write_response(
                &mut stream,
                "404 Not Found",
                "text/plain",
                b"not found",
                head_only,
            );
            return;
        }
    };
    let full = match resolve_under(&root, &rel) {
        Ok(p) if p.is_file() => p,
        _ => {
            write_response(
                &mut stream,
                "404 Not Found",
                "text/plain",
                b"not found",
                head_only,
            );
            return;
        }
    };
    let ext = full.extension().and_then(|s| s.to_str()).unwrap_or("");
    let (mime, _) = mime_for(ext);
    // A Range header (video seeking, large media) is answered with 206 Partial
    // Content; without one we serve the whole file but still advertise ranges.
    let range = head
        .lines()
        .find(|l| l.to_ascii_lowercase().starts_with("range:"))
        .and_then(|l| l.split_once(':').map(|(_, v)| v.trim()))
        .and_then(parse_range);
    serve_file(&mut stream, &full, mime, range, head_only);
}

/// Parse a single-range `Range` value into (start, end), each optional. Only one
/// range is supported: a multi-range value (contains ',') returns None so the
/// caller falls back to a full 200. `bytes=500-` → (Some(500), None);
/// `bytes=0-99` → (Some(0), Some(99)); `bytes=-500` (suffix) → (None, Some(500)).
fn parse_range(v: &str) -> Option<(Option<u64>, Option<u64>)> {
    let spec = v.strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None;
    }
    let (s, e) = spec.split_once('-')?;
    let (s, e) = (s.trim(), e.trim());
    if s.is_empty() && e.is_empty() {
        return None;
    }
    let start = if s.is_empty() {
        None
    } else {
        Some(s.parse().ok()?)
    };
    let end = if e.is_empty() {
        None
    } else {
        Some(e.parse().ok()?)
    };
    Some((start, end))
}

/// Serve a file body: 206 for a satisfiable Range, 416 for an unsatisfiable one,
/// else a full 200. Ranged reads stream only the requested slice, so a large
/// video never loads whole into memory.
fn serve_file(
    stream: &mut TcpStream,
    path: &Path,
    mime: &str,
    range: Option<(Option<u64>, Option<u64>)>,
    head_only: bool,
) {
    use std::io::{Seek, SeekFrom};
    let total = match std::fs::metadata(path) {
        Ok(m) => m.len(),
        Err(_) => {
            write_response(
                stream,
                "500 Internal Server Error",
                "text/plain",
                b"read failed",
                head_only,
            );
            return;
        }
    };

    if let Some((start_opt, end_opt)) = range {
        // Resolve an inclusive [start, end] within [0, total-1].
        let (start, end) = match (start_opt, end_opt) {
            (Some(s), Some(e)) => (s, e.min(total.saturating_sub(1))),
            (Some(s), None) => (s, total.saturating_sub(1)),
            // Suffix range `bytes=-N`: the last N bytes.
            (None, Some(n)) => (total.saturating_sub(n), total.saturating_sub(1)),
            (None, None) => (0, total.saturating_sub(1)),
        };
        if total == 0 || start > end || start >= total {
            let header = format!(
                "HTTP/1.1 416 Range Not Satisfiable\r\nContent-Range: bytes */{total}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            let _ = stream.write_all(header.as_bytes());
            return;
        }
        let len = end - start + 1;
        let mut body = vec![0u8; len as usize];
        let read_ok = std::fs::File::open(path).and_then(|mut f| {
            f.seek(SeekFrom::Start(start))?;
            f.read_exact(&mut body)?;
            Ok(())
        });
        if read_ok.is_err() {
            write_response(
                stream,
                "500 Internal Server Error",
                "text/plain",
                b"read failed",
                head_only,
            );
            return;
        }
        let header = format!(
            "HTTP/1.1 206 Partial Content\r\nContent-Type: {mime}\r\nContent-Length: {len}\r\nContent-Range: bytes {start}-{end}/{total}\r\nAccept-Ranges: bytes\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n"
        );
        let _ = stream.write_all(header.as_bytes());
        if !head_only {
            let _ = stream.write_all(&body);
        }
        return;
    }

    match std::fs::read(path) {
        Ok(body) => {
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nAccept-Ranges: bytes\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(header.as_bytes());
            if !head_only {
                let _ = stream.write_all(&body);
            }
        }
        Err(_) => write_response(
            stream,
            "500 Internal Server Error",
            "text/plain",
            b"read failed",
            head_only,
        ),
    }
}

/// Serve files on a fresh loopback port, gated by `token` (the URL's first
/// path segment). Each request then names its scope (`/w/…` or `/b/…`) and
/// `root_of(scope)` resolves the root AT THAT MOMENT — the active workspace
/// moves when the user switches sessions, so a root captured at start-up
/// would go stale. Returns the port; runs for the app's lifetime.
pub fn serve<F>(token: &str, root_of: F) -> std::io::Result<u16>
where
    F: Fn(&str) -> Option<PathBuf> + Send + Sync + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    let root_of = std::sync::Arc::new(root_of);
    let token = std::sync::Arc::new(token.to_string());
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let root_of = root_of.clone();
            let token = token.clone();
            std::thread::spawn(move || handle(stream, &token, root_of.as_ref()));
        }
    });
    Ok(port)
}

fn relative_path(root: &Path, full: &Path) -> Result<String, String> {
    let rel = full
        .strip_prefix(root)
        .map_err(|_| "path is outside the workspace".to_string())?;
    let parts: Vec<String> = rel
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    Ok(parts.join("/"))
}

/// A workspace-relative form of `path` for the preview URL. Write-tool artifact
/// paths are absolute and must live under `root`; relative paths are first
/// checked literally, then resolved by basename like prose artifact links.
pub fn relativize(root: &Path, path: &str) -> Result<String, String> {
    let p = Path::new(path);
    let root = root
        .canonicalize()
        .map_err(|e| format!("root unavailable: {e}"))?;
    if !p.is_absolute() {
        let rel = path.trim_start_matches('/');
        if let Ok(full) = resolve_under(&root, rel) {
            if full.is_file() {
                return relative_path(&root, &full);
            }
        }
        return locate_under(&root, rel).ok_or_else(|| "file not found".to_string());
    }
    if let Ok(full) = p.canonicalize() {
        if let Ok(relative) = relative_path(&root, &full) {
            return Ok(relative);
        }
    }
    // A session output may have been migrated from a legacy root after the
    // assistant recorded its old absolute path. Resolve that stale reference
    // by basename, but only inside the validated session root.
    locate_under(&root, path).ok_or_else(|| "file not found".to_string())
}

/// URL a file is previewable at (starts the server on first use). `root`
/// chooses the tree: the active workspace (default) or the base folder.
#[tauri::command]
pub fn preview_url(
    app: AppHandle,
    state: State<'_, PreviewState>,
    path: String,
    root: Option<String>,
    dir: Option<String>,
) -> Result<String, String> {
    let mut guard = state.0.lock().unwrap();
    let (port, token) = match guard.clone() {
        Some(pt) => pt,
        None => {
            let handle = app.clone();
            let token = crate::runtime::random_hex(16);
            let p = serve(&token, move |scope| match scope {
                "w" => workspace_dir(&handle).ok(),
                "b" => crate::runtime::base_workspace_dir(&handle).ok(),
                scoped => decode_dir_scope(scoped).and_then(|value| {
                    crate::artifact_file::session_scope_root(&handle, &value).ok()
                }),
            })
            .map_err(|e| e.to_string())?;
            *guard = Some((p, token.clone()));
            (p, token)
        }
    };
    let scope = match (root.as_deref().unwrap_or("workspace"), dir.as_deref()) {
        ("workspace", Some(directory)) if !directory.is_empty() => encode_dir_scope(directory),
        ("workspace", _) => "w".to_string(),
        ("base", None) => "b".to_string(),
        ("base", Some(_)) => return Err("dir can only be used with the workspace root".into()),
        (other, _) => return Err(format!("unknown root scope: {other}")),
    };
    let rel = relativize(&scoped_root(&app, root.as_deref(), dir.as_deref())?, &path)?;
    let encoded: Vec<String> = rel.split('/').map(encode_segment).collect();
    Ok(format!(
        "http://127.0.0.1:{port}/{token}/{scope}/{}",
        encoded.join("/")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn session_directory_scope_round_trips_unicode_and_spaces() {
        let dir = r"C:\Users\researcher\Open Science\sessions\2026-08-16-1423";
        assert_eq!(
            decode_dir_scope(&encode_dir_scope(dir)).as_deref(),
            Some(dir)
        );
    }

    fn get(port: u16, path: &str) -> (String, Vec<u8>) {
        get_with(port, path, None)
    }

    fn get_with(port: u16, path: &str, range: Option<&str>) -> (String, Vec<u8>) {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        let range_line = range.map(|r| format!("Range: {r}\r\n")).unwrap_or_default();
        s.write_all(format!("GET {path} HTTP/1.1\r\nHost: x\r\n{range_line}\r\n").as_bytes())
            .unwrap();
        let mut resp = Vec::new();
        s.read_to_end(&mut resp).unwrap();
        let split = resp.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        (
            String::from_utf8_lossy(&resp[..split]).into_owned(),
            resp[split + 4..].to_vec(),
        )
    }

    #[test]
    fn range_requests_get_206_partial_content() {
        let root = std::env::temp_dir().join(format!("ai4s-preview-range-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("v.mp4"), b"0123456789").unwrap(); // 10 bytes

        let port = serve("tok", {
            let root = root.clone();
            move |scope| (scope == "w").then(|| root.clone())
        })
        .unwrap();

        // Full file advertises range support.
        let (h, body) = get(port, "/tok/w/v.mp4");
        assert!(h.starts_with("HTTP/1.1 200"), "{h}");
        assert!(h.contains("Content-Type: video/mp4"), "{h}");
        assert!(h.contains("Accept-Ranges: bytes"), "{h}");
        assert_eq!(body, b"0123456789");

        // Closed range returns exactly the slice, with Content-Range.
        let (h, body) = get_with(port, "/tok/w/v.mp4", Some("bytes=2-5"));
        assert!(h.starts_with("HTTP/1.1 206"), "{h}");
        assert!(h.contains("Content-Range: bytes 2-5/10"), "{h}");
        assert_eq!(body, b"2345");

        // Open-ended range (the webview's initial `bytes=0-`) serves to the end.
        let (h, body) = get_with(port, "/tok/w/v.mp4", Some("bytes=0-"));
        assert!(h.starts_with("HTTP/1.1 206"), "{h}");
        assert!(h.contains("Content-Range: bytes 0-9/10"), "{h}");
        assert_eq!(body, b"0123456789");

        // Suffix range: the last N bytes.
        let (h, body) = get_with(port, "/tok/w/v.mp4", Some("bytes=-3"));
        assert!(h.starts_with("HTTP/1.1 206"), "{h}");
        assert!(h.contains("Content-Range: bytes 7-9/10"), "{h}");
        assert_eq!(body, b"789");

        // Unsatisfiable range → 416 with the total size.
        let (h, _) = get_with(port, "/tok/w/v.mp4", Some("bytes=50-60"));
        assert!(h.starts_with("HTTP/1.1 416"), "{h}");
        assert!(h.contains("Content-Range: bytes */10"), "{h}");

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn relativize_maps_absolute_workspace_paths_and_rejects_escapes() {
        let root =
            std::env::temp_dir().join(format!("ai4s-relativize-test-{}", std::process::id()));
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("sub/index.html"), b"<h1>hi</h1>").unwrap();

        // Write-tool artifact paths are absolute — they must come back workspace-relative.
        let abs = root.join("sub/index.html");
        assert_eq!(
            relativize(&root, &abs.to_string_lossy()).as_deref(),
            Ok("sub/index.html")
        );
        // Relative paths pass through untouched.
        assert_eq!(
            relativize(&root, "sub/index.html").as_deref(),
            Ok("sub/index.html")
        );
        // Absolute paths outside the workspace are rejected (sandbox).
        assert!(relativize(&root, "/etc/hosts").is_err());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn relativize_resolves_bare_preview_names_before_building_urls() {
        let root =
            std::env::temp_dir().join(format!("ai4s-relativize-bare-test-{}", std::process::id()));
        let nested = root.join("results").join("run-1");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("humanoid_walk.gif"), b"GIF89a").unwrap();

        assert_eq!(
            relativize(&root, "humanoid_walk.gif").as_deref(),
            Ok("results/run-1/humanoid_walk.gif")
        );
        let legacy_absolute = root
            .parent()
            .unwrap()
            .join("legacy-root")
            .join("humanoid_walk.gif");
        assert_eq!(
            relativize(&root, &legacy_absolute.to_string_lossy()).as_deref(),
            Ok("results/run-1/humanoid_walk.gif")
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn serves_from_the_current_root_of_each_request() {
        // The active workspace moves when the user switches sessions — the
        // server must resolve against the root as it is NOW, not at start-up.
        use std::sync::{Arc, Mutex};
        let a = std::env::temp_dir().join(format!("ai4s-preview-root-a-{}", std::process::id()));
        let b = std::env::temp_dir().join(format!("ai4s-preview-root-b-{}", std::process::id()));
        std::fs::create_dir_all(&a).unwrap();
        std::fs::create_dir_all(&b).unwrap();
        std::fs::write(a.join("f.html"), b"in-a").unwrap();
        std::fs::write(b.join("f.html"), b"in-b").unwrap();

        let current = Arc::new(Mutex::new(a.clone()));
        let for_server = current.clone();
        let port = serve("tok", move |scope| {
            (scope == "w").then(|| for_server.lock().unwrap().clone())
        })
        .unwrap();

        let (h, body) = get(port, "/tok/w/f.html");
        assert!(h.starts_with("HTTP/1.1 200"), "{h}");
        assert_eq!(body, b"in-a");

        *current.lock().unwrap() = b.clone();
        let (h, body) = get(port, "/tok/w/f.html");
        assert!(h.starts_with("HTTP/1.1 200"), "{h}");
        assert_eq!(body, b"in-b");

        // An unknown scope (or a bare unscoped path) never serves anything.
        let (h, _) = get(port, "/tok/x/f.html");
        assert!(h.starts_with("HTTP/1.1 404"), "{h}");
        let (h, _) = get(port, "/tok/f.html");
        assert!(h.starts_with("HTTP/1.1 404"), "{h}");

        let _ = std::fs::remove_dir_all(a);
        let _ = std::fs::remove_dir_all(b);
    }

    #[test]
    fn requires_the_per_run_token_and_sends_no_cors_header() {
        // The token is the URL's first path segment, so a page that guessed the
        // port still cannot read workspace files — and relative subresources in
        // a previewed HTML file inherit it automatically. Responses carry no
        // Access-Control-Allow-Origin: previews render in <iframe>/<img>, never
        // via cross-origin fetch, so no other origin ever needs to read them.
        let root = std::env::temp_dir().join(format!("ai4s-preview-token-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("f.html"), b"secret").unwrap();

        let port = serve("sekret", {
            let root = root.clone();
            move |scope| (scope == "w").then(|| root.clone())
        })
        .unwrap();

        // Correct token serves — without advertising CORS to foreign origins.
        let (h, body) = get(port, "/sekret/w/f.html");
        assert!(h.starts_with("HTTP/1.1 200"), "{h}");
        assert_eq!(body, b"secret");
        assert!(!h.contains("Access-Control-Allow-Origin"), "{h}");

        // Tokenless (the pre-token URL shape) and wrong-token requests are refused.
        let (h, _) = get(port, "/w/f.html");
        assert!(h.starts_with("HTTP/1.1 403"), "{h}");
        let (h, _) = get(port, "/guess/w/f.html");
        assert!(h.starts_with("HTTP/1.1 403"), "{h}");
        let (h, _) = get(port, "/sekret");
        assert!(h.starts_with("HTTP/1.1 403"), "{h}");

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn serves_files_with_mime_and_blocks_traversal() {
        let root = std::env::temp_dir().join(format!("ai4s-preview-test-{}", std::process::id()));
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("sub/a.pdf"), b"%PDF-1.4 fake").unwrap();
        std::fs::write(root.join("b.html"), b"<h1>hi</h1>").unwrap();

        let port = serve("tok", {
            let root = root.clone();
            move |scope| (scope == "w").then(|| root.clone())
        })
        .unwrap();

        let (h, body) = get(port, "/tok/w/sub/a.pdf");
        assert!(h.starts_with("HTTP/1.1 200"), "{h}");
        assert!(h.contains("Content-Type: application/pdf"), "{h}");
        assert_eq!(body, b"%PDF-1.4 fake");

        let (h, _) = get(port, "/tok/w/b.html");
        assert!(h.contains("Content-Type: text/html"), "{h}");

        // Traversal out of the root must 404.
        let (h, _) = get(port, "/tok/w/../../../etc/hosts");
        assert!(h.starts_with("HTTP/1.1 404"), "{h}");
        let (h, _) = get(port, "/tok/w/%2e%2e/%2e%2e/etc/hosts");
        assert!(h.starts_with("HTTP/1.1 404"), "{h}");

        let (h, _) = get(port, "/tok/w/missing.pdf");
        assert!(h.starts_with("HTTP/1.1 404"), "{h}");

        let _ = std::fs::remove_dir_all(root);
    }
}
